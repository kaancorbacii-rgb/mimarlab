#!/usr/bin/env python3
"""Ersa proje payload'ını CANLI D1 + R2'ye yazar (2026-09-05).

import-archello-projects.js İLKESİ (aynı desen, Python): (1) R2 yüklemesi TAMAMEN bitmeden HİÇBİR
D1 satırı yazılmaz (kırık galeri linki bırakmamak için); (2) eşleşmeyen ofis/mimar künyesine YENİ
PROFİL AÇILMAZ, migration_name_conflicts'e düşer; (3) 'enrich' aksiyonları mevcut projeye SADECE
EKLER (images append, product edge upsert) — hiçbir mevcut alan silinmez/ezilmez.

Kullanım:
  python3 scripts/import-ersa-projects.py --dry-run   # hiçbir şey yazmaz, sadece planı basar
  python3 scripts/import-ersa-projects.py             # gerçek yazım
"""
import argparse
import concurrent.futures
import importlib.util as _ilu
import json
import os
import time

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = _ilu.spec_from_file_location('import_archello_products',
                                     os.path.join(HERE, 'import-archello-products.py'))
imp = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(imp)
d1, d1_file, q, r2_put = imp.d1, imp.d1_file, imp.q, imp.r2_put

BRAND_OFFICE_ID = 769  # Ersa Mobilya


def j(v):
    return q(json.dumps(v, ensure_ascii=False))


def upload_all(manifest, dry):
    if dry:
        print(f'[dry-run] R2: {len(manifest)} nesne yüklenecek (atlandı)')
        return []
    fails = []
    done = 0

    def put_one(job):
        with open(job['local_path'], 'rb') as f:
            data = f.read()
        for attempt in range(4):
            if attempt:
                time.sleep(1.5 * (2 ** (attempt - 1)))
            ok, err = r2_put(job['r2_key'], data)
            if ok:
                return None
        return job['r2_key']

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        for res in ex.map(put_one, manifest):
            done += 1
            if res:
                fails.append(res)
            if done % 100 == 0:
                print(f'  R2 {done}/{len(manifest)}')
    return fails


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    payload = json.load(open('scripts/output/ersa-projects-payload.json', encoding='utf8'))
    manifest = json.load(open('scripts/output/ersa-projects-image-manifest.json', encoding='utf8'))
    by_owner = {}
    for m in manifest:
        by_owner.setdefault(tuple(m['owner']), []).append(m)

    print(f'{len(manifest)} görsel, {len(payload["create"])} yeni proje, {len(payload["enrich"])} zenginleştirme girdisi')

    fails = upload_all(manifest, args.dry_run)
    if fails:
        print(f'R2 YÜKLEME HATASI: {len(fails)} nesne başarısız, D1 YAZILMIYOR.')
        for k in fails:
            print('  FAIL', k)
        return 1
    print(f'R2: tüm nesneler yüklendi (veya dry-run).')

    # ---- CREATE ------------------------------------------------------------------
    created = 0
    for p in payload['create']:
        jobs = by_owner.get(('create', p['ersa_slug']), [])
        jobs.sort(key=lambda j: j['r2_key'])
        final_urls = [j['final_url'] for j in jobs]
        if args.dry_run:
            print(f"[dry] INSERT {p['slug']} ({len(final_urls)} görsel, ürün {p['product_ids']})")
            continue

        exists = d1(f"SELECT id FROM projects WHERE slug = {q(p['slug'])}")
        if exists:
            print(f"  ! zaten var, atlandı: {p['slug']} (#{exists[0]['id']})")
            continue

        sql = f"""INSERT INTO projects
            (slug, title, category, type, discipline, location, location_detail, project_date,
             date_bucket, period, description, images, photo_credit_text, source_url,
             ai_generated, source, build_status, created_at, updated_at)
          VALUES ({q(p['slug'])}, {q(p['title'])}, {j(p['category'])}, {j(p['type'])}, {j(p['discipline'])},
             {q(p['location'])}, NULL, {q(p['project_date'])}, {q(p['date_bucket'])}, {j([])},
             {q(p['description'])}, {j(final_urls)}, {q(p['photo_credit_text'])}, {q(p['source_url'])},
             0, 'admin', 'built', datetime('now'), datetime('now'))"""
        d1(sql)
        pid = d1(f"SELECT id FROM projects WHERE slug = {q(p['slug'])}")[0]['id']

        for oid in p['office_ids']:
            d1(f"INSERT INTO project_designers (project_id, office_id) VALUES ({pid}, {oid})")
        for aid in p['architect_ids']:
            d1(f"INSERT INTO project_designers (project_id, architect_id) VALUES ({pid}, {aid})")
        if not p['office_ids'] and not p['architect_ids']:
            for name in p['unmatched_credits']:
                d1(f"""INSERT INTO migration_name_conflicts (entity_type, conflict_key, context, candidates, status)
                    VALUES ('project_designer', {q(name)}, {q(f"{p['slug']} (Ersa referans projesi)")}, '[]', 'pending')""")
        for prod_id in p['product_ids']:
            d1(f"""INSERT INTO project_products (project_id, product_id, from_project, from_product)
                VALUES ({pid}, {prod_id}, 1, 1)
                ON CONFLICT(project_id, product_id) DO UPDATE SET from_project=1, from_product=1""")
        d1(f"""INSERT INTO project_brands (project_id, office_id, element, source)
            VALUES ({pid}, {BRAND_OFFICE_ID}, NULL, 'admin')
            ON CONFLICT(project_id, office_id) DO NOTHING""")
        created += 1
        print(f"  + {p['slug']} -> id {pid} ({len(final_urls)} görsel, ürün: {p['product_ids']}, "
              f"ofis: {p['office_ids']}, mimar: {p['architect_ids']})")

    # ---- ENRICH (aynı project_id'ye birden fazla Ersa sayfası düşebilir -> BİRLEŞTİR) ----
    merged = {}
    for p in payload['enrich']:
        m = merged.setdefault(p['project_id'], {'slug': p['project_slug'], 'title': p['project_title'],
                                                 'ersa_slugs': [], 'product_ids': set()})
        m['ersa_slugs'].append(p['ersa_slug'])
        m['product_ids'].update(p['product_ids'])

    enriched = 0
    for pid, m in merged.items():
        jobs = []
        for es in m['ersa_slugs']:
            jobs.extend(by_owner.get(('enrich', es), []))
        jobs.sort(key=lambda j: j['r2_key'])
        new_urls = [j['final_url'] for j in jobs]
        if args.dry_run:
            print(f"[dry] ENRICH #{pid} {m['slug']} (+{len(new_urls)} görsel, ürün {sorted(m['product_ids'])})")
            continue

        cur = d1(f"SELECT images FROM projects WHERE id = {pid}")[0]
        cur_images = json.loads(cur['images'] or '[]')
        d1(f"UPDATE projects SET images = {j(cur_images + new_urls)}, updated_at = datetime('now') WHERE id = {pid}")
        for prod_id in m['product_ids']:
            d1(f"""INSERT INTO project_products (project_id, product_id, from_project, from_product)
                VALUES ({pid}, {prod_id}, 1, 1)
                ON CONFLICT(project_id, product_id) DO UPDATE SET from_project=1, from_product=1""")
        d1(f"""INSERT INTO project_brands (project_id, office_id, element, source)
            VALUES ({pid}, {BRAND_OFFICE_ID}, NULL, 'admin')
            ON CONFLICT(project_id, office_id) DO NOTHING""")
        enriched += 1
        print(f"  ~ #{pid} {m['slug']} +{len(new_urls)} görsel ({cur_images and len(cur_images)}->"
              f"{len(cur_images)+len(new_urls)}), ürün: {sorted(m['product_ids'])}")

    if args.dry_run:
        print(f"\n[dry-run] bitti: {len(payload['create'])} create + {len(merged)} enrich görüntülendi, hiçbir şey yazılmadı.")
    else:
        print(f'\nbitti: {created} yeni proje, {enriched} zenginleştirilen proje.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
