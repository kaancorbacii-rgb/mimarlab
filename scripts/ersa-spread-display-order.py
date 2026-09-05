#!/usr/bin/env python3
"""135 yeni Ersa ürününü mevcut katalog sayfaları arasına serpiştirir — koleksiyon2-spread-
display-order.py ile BİREBİR AYNI algoritma (bkz. o dosyanın kendi yorumu ve migrations/0089_
product_display_order.sql): src/routes/product.js#fetchProductPool'un varsayılan `ORDER BY id DESC`
sıralamasında TÜM yeni satırlar en yüksek id'ye sahip olduğundan /urun'ün 1. sayfasına YIĞILIR.

GÜNCELLENEN 6 Ersa ürünü (Steam/Aura/Trapeze/Twins/Envelope/Armor) BURAYA DAHİL DEĞİL — kendi
id'leri ve mevcut display_order'ları zaten vardı, katalogdaki konumları değişmiyor (yalnızca içerik
"fresh overwrite" ile güncellendi, konum/sıra dokunulmadı).

Önkoşul: scripts/import-ersa.py ÇALIŞMIŞ ve scripts/output/ersa-import-report.json üretilmiş olmalı.

Kullanım:
  python3 scripts/ersa-spread-display-order.py [--dry-run]
"""
import argparse
import importlib.util as _ilu
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = _ilu.spec_from_file_location('import_archello_products',
                                     os.path.join(HERE, 'import-archello-products.py'))
imp = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(imp)
d1, d1_file = imp.d1, imp.d1_file


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    report = json.load(open(os.path.join(HERE, 'output', 'ersa-import-report.json'), encoding='utf8'))
    new_slugs = [r['slug'] for r in report if r['action'] == 'insert']
    print(f'{len(new_slugs)} yeni ürün slug\'ı rapordan okundu ({len(report) - len(new_slugs)} güncelleme hariç).')

    all_rows = d1('SELECT id, slug FROM products WHERE deleted_at IS NULL AND hidden_at IS NULL '
                  'ORDER BY COALESCE(display_order, 0) ASC, id DESC')
    new_slug_set = set(new_slugs)
    new_ids_by_slug = {r['slug']: r['id'] for r in all_rows if r['slug'] in new_slug_set}
    missing = new_slug_set - set(new_ids_by_slug)
    if missing:
        print(f'UYARI: D1de bulunamayan yeni slug: {missing}')
    new_ids = [new_ids_by_slug[s] for s in new_slugs if s in new_ids_by_slug]
    existing_ids = [r['id'] for r in all_rows if r['slug'] not in new_slug_set]

    print(f'mevcut (eski) satır: {len(existing_ids)}, yeni satır: {len(new_ids)}, '
          f'toplam: {len(existing_ids) + len(new_ids)}')

    total_old, total_new = len(existing_ids), len(new_ids)
    combined = []
    if total_new == 0:
        combined = existing_ids
    else:
        step = total_old / total_new
        next_insert_at = step
        old_i = new_i = pos = 0
        while old_i < total_old or new_i < total_new:
            if new_i < total_new and (old_i >= total_old or pos >= next_insert_at):
                combined.append(new_ids[new_i])
                new_i += 1
                next_insert_at += step
            else:
                combined.append(existing_ids[old_i])
                old_i += 1
            pos += 1

    assert sorted(combined) == sorted(existing_ids + new_ids), 'kayıp/mükerrer id — algoritma hatası'
    print(f'birleşik sıra uzunluğu: {len(combined)}')

    if args.dry_run:
        newpos = [i + 1 for i, pid in enumerate(combined) if pid in set(new_ids)]
        print(f'[dry-run] yeni ürünlerin atanacağı display_order pozisyonları (ilk 15): {newpos[:15]}')
        print(f'[dry-run] toplam sayfa sayısı tahmini (24/sayfa varsayımıyla): '
              f'{(len(combined) + 23) // 24}')
        return 0

    chunk = 300
    for i in range(0, len(combined), chunk):
        part = combined[i:i + chunk]
        rows_sql = ',\n'.join(f'({pid}, {i + j + 1})' for j, pid in enumerate(part))
        stmt = (f'''
WITH new_order(id, ord) AS (VALUES
{rows_sql}
)
UPDATE products SET display_order = (SELECT ord FROM new_order WHERE new_order.id = products.id)
WHERE id IN (SELECT id FROM new_order);
''')
        d1_file(stmt)
        print(f'  display_order yazıldı: {min(i + chunk, len(combined))}/{len(combined)}')

    print('\nBitti.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
