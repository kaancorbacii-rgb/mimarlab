#!/usr/bin/env python3
"""Koleksiyon 2. parti (63 URL / 53 aile) içe aktarımı — import-batch67.py'nin sadeleştirilmiş eşi.

Tek marka (Koleksiyon, office id sabit KOLEKSIYON_OFFICE_ID), yeni marka senkronu YOK. Yardımcılar
(d1/d1_file/http_get/to_webp/r2_put/webp_width/note_derivatives/q/fold_tr) import-archello-products.py'
den import edilir — tek kaynak orasıdır (bkz. import-batch67.py'deki AYNI desen).

Güncelleme semantiği (GÖREV TALİMATI — "mevcut varyantı SİLME/EZME, EKLE"):
  - variants : eski + (etiketi eski listede OLMAYAN) yeni versiyonlar. Boş yeni versiyon varsa
               eski liste AYNEN kalır.
  - images   : eski + yeni, sırayla, tekrarsız, ilk 14 ile sınırlı.
  - specs    : eski KORUNUR; yeni spec'lerden eski etiketlerde OLMAYANLAR sona eklenir.
  - description/designer/files : yalnızca mevcut alan BOŞSA yazılır.
  - slug/title/category/kind/claimed_by_user_id/created_at: HİÇ ellenmez.

Kullanım:
  python3 scripts/import-koleksiyon2.py --payload scripts/output/koleksiyon2-payload.json [--dry-run] [--skip-images]
"""
import argparse
import concurrent.futures
import importlib.util as _ilu
import json
import os
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

_spec = _ilu.spec_from_file_location('import_archello_products',
                                     os.path.join(HERE, 'import-archello-products.py'))
imp = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(imp)

q = imp.q
d1 = imp.d1
d1_file = imp.d1_file
http_get = imp.http_get
to_webp = imp.to_webp
r2_put = imp.r2_put
webp_width = imp.webp_width
note_derivatives = imp.note_derivatives

KOLEKSIYON_OFFICE_ID = 717
R2_PREFIX = 'import/products'
_lock = threading.Lock()


def safe_url(url):
    """Koleksiyon modül render'ları boşluklu path'lerde durabiliyor (bkz. import-batch67.py'deki
    AYNI not) — yalnızca boşluk yüzde-kodlanır, zaten kodlanmış '%20' bozulmaz."""
    return url.replace(' ', '%20') if ' ' in url else url


def upload_product_images(it, folder_slug, dry_run, skip_images):
    urls = list(dict.fromkeys(
        list(it['images']) + [u for v in it['variants'] for u in v['srcImages']]))
    if skip_images or not urls:
        return {}

    def one(job):
        idx, url = job
        raw = http_get(safe_url(url))
        if not raw:
            return (url, None, f'indirilemedi: {url}')
        try:
            webp = to_webp(raw, imp.MAX_IMG_W)
        except Exception as ex:
            return (url, None, f'webp hatası: {ex}')
        key = f'{R2_PREFIX}/{folder_slug}/{idx}.webp'
        if dry_run:
            return (url, f'/media/{key}', None)
        ok, err = r2_put(key, webp)
        if ok:
            with _lock:
                note_derivatives(key, webp_width(webp))
            return (url, f'/media/{key}', None)
        return (url, None, f'R2: {err}')

    paths = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
        for url, path, err in ex.map(one, list(enumerate(urls, start=1))):
            if err:
                print(f'    UYARI [{folder_slug}]: {err}')
            else:
                paths[url] = path
    return paths


def flush_derivatives_chunked(dry_run, chunk=200):
    pend = imp._pending_derivatives
    if not pend:
        return 0
    if dry_run:
        print(f'  [dry-run] türev kuyruğuna {len(pend)} iş yazılmazdı.')
        return 0
    now = int(time.time() * 1000)
    total = len(pend)
    for i in range(0, total, chunk):
        rows = ',\n'.join(f'({q(k)}, {w}, {now})' for k, w in pend[i:i + chunk])
        d1_file('INSERT OR IGNORE INTO image_derivative_queue (r2_key, width, created_at) VALUES\n'
                + rows + ';\n')
        print(f'    kuyruk {min(i + chunk, total)}/{total}')
    pend.clear()
    print(f'  türev kuyruğuna {total} iş yazıldı.')
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--payload', required=True)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--skip-images', action='store_true')
    args = ap.parse_args()

    payload = json.load(open(args.payload, encoding='utf8'))
    items = payload['products']
    nvar = sum(len(p['variants']) for p in items)
    upd = sum(1 for p in items if p.get('update_id'))
    print(f"{len(items)} aile ({len(items) - upd} yeni / {upd} güncelle) / {nvar} versiyon"
          f"{'  [DRY-RUN]' if args.dry_run else ''}\n")

    print('--- 1) Güncellenecek satırların mevcut hali ---')
    upd_ids = [it['update_id'] for it in items if it.get('update_id')]
    prior = {}
    if upd_ids:
        for r in d1('SELECT id, slug, images, specs, variants, description, designer, files '
                    f"FROM products WHERE id IN ({','.join(str(i) for i in upd_ids)})"):
            prior[r['id']] = r
    for it in items:
        if it.get('update_id') and it['update_id'] not in prior:
            print(f"  UYARI: id={it['update_id']} D1'de bulunamadı, YENİ ürün olarak eklenecek: {it['title']}")
            it['update_id'] = None

    print('\n--- 2) Mükerrer kontrolü (yeni ürünler için) ---')
    existing = d1('SELECT slug FROM products WHERE deleted_at IS NULL')
    existing_slugs = {r['slug'] for r in existing}
    for it in items:
        if it.get('update_id'):
            continue
        base = it['slug']
        slug, n = base, 2
        while slug in existing_slugs:
            slug, n = f'{base}-{n}', n + 1
        it['slug'] = slug
        existing_slugs.add(slug)

    print('\n--- 3) Görseller (kaynak -> WebP -> R2) ---')
    insert_stmts, update_stmts, report = [], [], []
    for it in items:
        folder_slug = it.get('update_slug') or it['slug']
        paths = upload_product_images(it, folder_slug, args.dry_run, args.skip_images)

        parent_images = [paths[u] for u in it['images'] if u in paths]
        new_variants = []
        for v in it['variants']:
            new_variants.append({
                'label': v['label'],
                'options': v['options'],
                'images': [paths[u] for u in v['srcImages'] if u in paths],
                'specs': list(v['specs']),
                'files': v['files'],
                'description': v.get('description'),
                'sourceUrl': v['sourceUrl'],
            })

        old = prior.get(it.get('update_id') or -1)
        if old:
            old_images = json.loads(old['images'] or '[]')
            old_specs = json.loads(old['specs'] or '[]')
            old_variants = json.loads(old['variants'] or '[]')
            merged_images = list(dict.fromkeys(old_images + parent_images))[:14]
            have_labels = {v.get('label') for v in old_variants}
            appended = [v for v in new_variants if v['label'] not in have_labels]
            final_variants = old_variants + appended
            head_specs = new_variants[0]['specs'] if new_variants else []
            merged_specs = old_specs + [s for s in head_specs
                                        if s.get('label') not in {o.get('label') for o in old_specs}]

            upd = {
                'images': q(json.dumps(merged_images, ensure_ascii=False)),
                'variants': q(json.dumps(final_variants, ensure_ascii=False)),
                'specs': q(json.dumps(merged_specs, ensure_ascii=False)),
            }
            for col, new_val in (('description', it['description']),
                                 ('designer', it['designer']),
                                 ('files', json.dumps(it['files'], ensure_ascii=False) if it['files'] else None)):
                cur = (old.get(col) or '').strip()
                if not cur or (col == 'files' and cur == '[]'):
                    if new_val:
                        upd[col] = q(new_val)
            sets = ', '.join(f'{k} = {v}' for k, v in upd.items())
            update_stmts.append(
                f"UPDATE products SET {sets}, updated_at = datetime('now') WHERE id = {it['update_id']};")
            report.append({'action': 'update', 'id': it['update_id'], 'slug': old['slug'],
                           'title': it['title'], 'appended_variants': len(appended),
                           'total_variants': len(final_variants), 'images': len(paths)})
            print(f"  ~ GÜNCELLE id={it['update_id']:4} {it['title'][:24]:26} "
                  f"+{len(appended)} versiyon (toplam {len(final_variants)}) görsel={len(paths)}")
        else:
            vals = {
                'title': q(it['title']),
                'brand_office_id': str(KOLEKSIYON_OFFICE_ID),
                'brand_name_raw': q(it['brand']),
                'website': q(it['source_url']),
                'category': q(it['category']),
                'description': q(it['description']),
                'images': q(json.dumps(parent_images, ensure_ascii=False)),
                'specs': q(json.dumps(it['specs'], ensure_ascii=False)),
                'source_url': q(it['source_url']),
                'designer': q(it['designer']),
                'files': q(json.dumps(it['files'], ensure_ascii=False)),
                'variants': q(json.dumps(new_variants, ensure_ascii=False)) if new_variants else 'NULL',
            }
            cols = ['slug', 'kind', 'legacy_key', 'source'] + list(vals)
            vv = [q(it['slug']), "'product'", q(f"{it['brand']}|||{it['title']}"), "'admin'"] \
                + list(vals.values())
            insert_stmts.append(f"INSERT INTO products ({', '.join(cols)})\nVALUES ({', '.join(vv)});")
            report.append({'action': 'insert', 'slug': it['slug'], 'title': it['title'],
                           'variants': len(new_variants), 'images': len(paths)})
            print(f"  + YENİ {it['title'][:24]:26} versiyon={len(new_variants):2} görsel={len(paths):3}")

    print('\n--- 4) D1 yazımı ---')
    if args.dry_run:
        print(f'  [dry-run] {len(insert_stmts)} INSERT + {len(update_stmts)} UPDATE yazılmadı.')
    else:
        # D1 tek-ifade ~100KB sınırı (bkz. CLAUDE.md/proje notları): büyük varyant JSON'lu satırlar
        # (Alpsee=18 versiyon, Alcove=10) TEK TEK yazılır; küçükler batch'lenebilir ama güvenli
        # tarafta kalmak için hepsi teker teker yazılıyor (53+16=69 ifade, hız sorun değil).
        for i, stmt in enumerate(insert_stmts, 1):
            d1_file(stmt)
            print(f'    INSERT {i}/{len(insert_stmts)}')
        for i, stmt in enumerate(update_stmts, 1):
            d1_file(stmt)
            print(f'    UPDATE {i}/{len(update_stmts)}')

    print('\n--- 5) Responsive türev kuyruğu ---')
    flush_derivatives_chunked(args.dry_run)

    out = os.path.join(HERE, 'output', 'koleksiyon2-import-report.json')
    json.dump(report, open(out, 'w', encoding='utf8'), ensure_ascii=False, indent=2)
    print(f'\nRapor: {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
