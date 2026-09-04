#!/usr/bin/env python3
"""37 yeni Koleksiyon ürününü mevcut katalog sayfaları arasına serpiştirir.

migrations/0089_product_display_order.sql'in "backfill script ayrı" kararı (0087_project_display_
order.sql'deki AYNI desen — bkz. o migration'ın kendi yorumu): mevcut satırlar (display_order NULL)
BUGÜNE KADARKİ göreli sırasını (ORDER BY id DESC) korur, yeni satırlar aralarına EŞİT ARALIKLARLA
serpiştirilir; sonunda TÜM canlı ürün satırlarına (eski+yeni) 1..N ardışık display_order yazılır.

Önkoşul: scripts/import-koleksiyon2.py ÇALIŞMIŞ ve scripts/output/koleksiyon2-import-report.json
üretilmiş olmalı (yeni eklenen satırların slug'larını buradan okur).

Kullanım:
  python3 scripts/koleksiyon2-spread-display-order.py [--dry-run]
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

    report = json.load(open(os.path.join(HERE, 'output', 'koleksiyon2-import-report.json'),
                            encoding='utf8'))
    new_slugs = [r['slug'] for r in report if r['action'] == 'insert']
    print(f'{len(new_slugs)} yeni ürün slug\'ı rapordan okundu.')

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

    # existing_ids ZATEN "ORDER BY COALESCE(display_order,0) ASC, id DESC" sırasında — yani BUGÜNE
    # KADARKİ göreli katalog sırası. new_ids'i aralarına eşit aralıklarla serpiştir (0087'deki
    # AYNI algoritma).
    total_old = len(existing_ids)
    total_new = len(new_ids)
    combined = []
    if total_new == 0:
        combined = existing_ids
    else:
        step = total_old / total_new
        next_insert_at = step
        old_i = 0
        new_i = 0
        pos = 0
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

    # display_order = 1..N (kombine sıradaki pozisyon). id DESC tiebreak'i artık işe yaramaz hale
    # gelir çünkü her satırın KENDİ display_order'ı var — bu istenen sonuç.
    if args.dry_run:
        sample = combined[:20]
        print(f'[dry-run] ilk 20 id sırası: {sample}')
        newpos = [i + 1 for i, pid in enumerate(combined) if pid in set(new_ids)]
        print(f'[dry-run] yeni ürünlerin atanacağı display_order pozisyonları (ilk 10): {newpos[:10]}')
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
