#!/usr/bin/env python3
"""Ersa Mobilya toplu ürün içe aktarımı — 203 URL -> 141 ANA ÜRÜN / 194 versiyon (2026-09-05).

import-batch114.py'nin family+variants mimarisini kullanır (import-archello-products.py'nin
yardımcıları: d1/d1_file/http_get/to_webp/r2_put/note_derivatives — TEK kaynak orada, kopyalanmaz).

import-batch114.py'den (INSERT-only, "zaten varsa ATLA") AYRILDIĞI nokta — kullanıcı isteği
"fresh overwrite": marka zaten ersa-mobilya (offices.id=769) olduğundan ve markanın 10 canlı ürünü
olduğundan, fold_tr(title) eşleşmesi bulunan satırlar import-koleksiyon4.py'deki AYNI "TAM EZME"
UPDATE deseniyle güncellenir (images/specs/variants/files/description/designer hepsi YENİ veriyle
DEĞİŞTİRİLİR, yalnızca boş alan doldurma DEĞİL) — kaynak site güncellendiğinde eski/düşük çözünürlüklü
içerik kalıntısı bırakmamak için. Eşleşme yoksa yeni INSERT.

Marka profiline (offices.id=769) DOKUNULMAZ — about/logo/cover zaten dolu (bkz. 2026-09-05 kontrolü).

Kullanım:
  python3 scripts/import-ersa.py --payload scripts/output/ersa-payload.json [--dry-run] [--skip-images]
"""
import argparse
import concurrent.futures
import importlib.util as _ilu
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

_spec = _ilu.spec_from_file_location('import_archello_products',
                                     os.path.join(HERE, 'import-archello-products.py'))
imp = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(imp)

q = imp.q
d1 = imp.d1
d1_file = imp.d1_file
fold_tr = imp.fold_tr
http_get = imp.http_get
to_webp = imp.to_webp
r2_put = imp.r2_put
webp_width = imp.webp_width
note_derivatives = imp.note_derivatives
flush_derivative_queue = imp.flush_derivative_queue

R2_PREFIX = 'import/products'
ERSA_OFFICE_ID = 769


def upload_variant_images(slug, vi, urls, dry_run, skip_images):
    if skip_images or not urls:
        return []

    def one(job):
        idx, url = job
        raw = http_get(url)
        if not raw:
            return (idx, None, f'indirilemedi: {url}')
        try:
            webp = to_webp(raw, imp.MAX_IMG_W)
        except Exception as ex:
            return (idx, None, f'webp hatası: {ex}')
        key = f'{R2_PREFIX}/{slug}/v{vi}-{idx}.webp'
        if dry_run:
            return (idx, f'/media/{key}', None)
        ok, err = r2_put(key, webp)
        if ok:
            note_derivatives(key, webp_width(webp))
        return (idx, f'/media/{key}', None) if ok else (idx, None, f'R2: {err}')

    paths = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        for idx, path, err in sorted(ex.map(one, list(enumerate(urls, start=1)))):
            if err:
                print(f'    UYARI [{slug} v{vi}#{idx}]: {err}')
            else:
                paths.append(path)
    return paths


def unique_slug(base, taken):
    if base not in taken:
        taken.add(base)
        return base
    i = 2
    while f'{base}-{i}' in taken:
        i += 1
    s = f'{base}-{i}'
    taken.add(s)
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--payload', required=True)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--skip-images', action='store_true')
    args = ap.parse_args()

    payload = json.load(open(args.payload, encoding='utf8'))
    items = payload['products']
    nvar = sum(len(p['variants']) for p in items)
    print(f"{len(items)} ana ürün / {nvar} versiyon{'  [DRY-RUN]' if args.dry_run else ''}\n")

    print('--- 1) Mevcut Ersa ürünleri (fresh-overwrite eşleşmesi) ---')
    existing = d1(f'SELECT id, slug, title FROM products '
                  f'WHERE brand_office_id = {ERSA_OFFICE_ID} AND deleted_at IS NULL')
    by_title = {fold_tr(r['title']): r for r in existing}
    all_slugs = {r['slug'] for r in d1('SELECT slug FROM products WHERE deleted_at IS NULL')}
    print(f'  canlıda {len(existing)} Ersa ürünü var.')

    to_update, to_insert = [], []
    for it in items:
        m = by_title.get(fold_tr(it['title']))
        if m:
            it['update_id'] = m['id']
            it['keep_slug'] = m['slug']
            to_update.append(it)
        else:
            it['final_slug'] = unique_slug(it['slug'], all_slugs)
            to_insert.append(it)
    for it in to_update:
        print(f"  ~ GÜNCELLENECEK #{it['update_id']:4} {it['title'][:30]:32} "
              f"({len(it['variants'])} versiyon)")
    print(f'  güncellenecek: {len(to_update)}, yeni eklenecek: {len(to_insert)}')

    print('\n--- 2) Görseller (kaynak -> WebP -> R2) + D1 yazımı ---')
    update_stmts, insert_stmts, report = [], [], []

    def build_variants(it, slug_for_images):
        variants, total_img = [], 0
        for vi, v in enumerate(it['variants'], start=1):
            paths = upload_variant_images(slug_for_images, vi, v['srcImages'], args.dry_run, args.skip_images)
            total_img += len(paths)
            variants.append({'label': v['label'], 'options': v['options'], 'images': paths,
                              'specs': v['specs'], 'files': v['files'], 'sourceUrl': v['sourceUrl']})
        return variants, total_img

    for it in to_update:
        variants, total_img = build_variants(it, it['keep_slug'])
        head = variants[0]
        sets = {
            'title': q(it['title']),
            'category': q(it['category']),
            'description': q(it['description']),
            'images': q(json.dumps(head['images'], ensure_ascii=False)),
            'specs': q(json.dumps(head['specs'], ensure_ascii=False)),
            'files': q(json.dumps(head['files'], ensure_ascii=False)),
            'variants': q(json.dumps(variants, ensure_ascii=False)),
            'designer': q(it['designer']),
            'source_url': q(it['source_url']),
            'website': q(it['source_url']),
        }
        clause = ', '.join(f'{k} = {v}' for k, v in sets.items())
        update_stmts.append(f"UPDATE products SET {clause}, updated_at = datetime('now') "
                             f"WHERE id = {it['update_id']};")
        report.append({'action': 'update', 'id': it['update_id'], 'slug': it['keep_slug'],
                       'title': it['title'], 'variants': len(variants), 'images': total_img})
        print(f"  ~ {it['title'][:42]:44} versiyon={len(variants):2} görsel={total_img:3} "
              f"(#{it['update_id']})")

    for it in to_insert:
        variants, total_img = build_variants(it, it['final_slug'])
        head = variants[0]
        cols = ['slug', 'kind', 'title', 'brand_office_id', 'brand_name_raw', 'website', 'category',
                'description', 'images', 'specs', 'source_url', 'source', 'legacy_key',
                'designer', 'files', 'variants']
        vals = [q(it['final_slug']), "'product'", q(it['title']), str(ERSA_OFFICE_ID),
                q(it['brand']), q(it['source_url']), q(it['category']),
                q(it['description']),
                q(json.dumps(head['images'], ensure_ascii=False)),
                q(json.dumps(head['specs'], ensure_ascii=False)),
                q(it['source_url']), "'admin'",
                q(f"{it['brand']}|||{it['title']}"),
                q(it['designer']),
                q(json.dumps(head['files'], ensure_ascii=False)),
                q(json.dumps(variants, ensure_ascii=False))]
        insert_stmts.append(f"INSERT INTO products ({', '.join(cols)})\nVALUES ({', '.join(vals)});")
        report.append({'action': 'insert', 'slug': it['final_slug'], 'title': it['title'],
                       'variants': len(variants), 'images': total_img})
        print(f"  + {it['title'][:42]:44} versiyon={len(variants):2} görsel={total_img:3} "
              f"({it['final_slug']})")

    print('\n--- 3) D1 yazımı ---')
    if args.dry_run:
        print(f'  [dry-run] {len(update_stmts)} UPDATE, {len(insert_stmts)} INSERT yazılmadı.')
    else:
        if update_stmts:
            d1_file('\n'.join(update_stmts))
            print(f'  {len(update_stmts)} ürün güncellendi.')
        if insert_stmts:
            # Tek tek DEĞİL tek batch: sıra korunur (spread-display-order script'i bu sırayı
            # id ARTAN olarak okuyup mevcut katalog satırları arasına serpiştirecek).
            d1_file('\n'.join(insert_stmts))
            print(f'  {len(insert_stmts)} ürün eklendi.')

    print('\n--- 4) Responsive türev kuyruğu ---')
    flush_derivative_queue(args.dry_run)

    out = os.path.join(HERE, 'output', 'ersa-import-report.json')
    json.dump(report, open(out, 'w', encoding='utf8'), ensure_ascii=False, indent=2)
    print(f'\nRapor: {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
