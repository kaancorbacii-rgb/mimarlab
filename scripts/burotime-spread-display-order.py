#!/usr/bin/env python3
"""Bürotime partisinin 137 ürününü katalog sayfalarına eşit aralıklarla serpiştirir.

koleksiyon4-spread-display-order.py'nin eşi. Görev metni "yeni eklenen VEYA revize edilen
modellerin katalog sıralama indekslerini farklı sayfalara rastgele serpiştirilecek şekilde
dağıt" diyor — bu yüzden YENİ (111) + GÜNCELLENEN (26) satırların HEPSİ yeniden dağıtılır.
Ölçüm (2026-09-07, parti öncesi): mevcut 27 Bürotime satırının 20'si display_order 116-184
aralığında, yani katalogda 5-8. sayfalarda ARDIŞIK KÜMELENMİŞ durumdaydı.

Parti dışındaki satırların GÖRELİ sırası korunur (migrations/0087 ve 0089 ile aynı ilke);
sonda tüm canlı satırlara 1..N ardışık display_order yazılır.

Parti sırası = burotime-import-report.json sırası, o da burotime-build-payload.py
#shuffle_by_category ile kategori bakımından ZATEN karıştırılmıştır — serpiştirme art arda aynı
kategoriden kart koymaz.

Önkoşul: import-burotime.py çalışmış ve burotime-import-report.json üretilmiş olmalı.

Kullanım: python3 scripts/burotime-spread-display-order.py [--dry-run]
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

PAGE_SIZE = 24  # urun.html#PAGE_SIZE


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    report = json.load(open(os.path.join(HERE, 'output', 'burotime-import-report.json'),
                            encoding='utf8'))
    new_slugs = [r['slug'] for r in report if r['action'] == 'insert']
    upd_ids = [r['id'] for r in report if r['action'] == 'update']
    print(f'rapordan: {len(new_slugs)} yeni slug, {len(upd_ids)} güncellenen id')

    all_rows = d1('SELECT id, slug FROM products WHERE deleted_at IS NULL AND hidden_at IS NULL '
                  'ORDER BY COALESCE(display_order, 0) ASC, id DESC')
    slug_to_id = {r['slug']: r['id'] for r in all_rows}
    missing = [s for s in new_slugs if s not in slug_to_id]
    if missing:
        raise SystemExit(f'D1de bulunamayan yeni slug: {missing}')

    batch_ids, seen = [], set()
    for r in report:
        pid = slug_to_id[r['slug']] if r['action'] == 'insert' else r['id']
        if pid in seen:
            continue
        seen.add(pid)
        batch_ids.append(pid)
    live = {r['id'] for r in all_rows}
    batch_ids = [i for i in batch_ids if i in live]
    seen = set(batch_ids)
    other_ids = [r['id'] for r in all_rows if r['id'] not in seen]

    print(f'parti: {len(batch_ids)}, parti dışı: {len(other_ids)}, '
          f'toplam: {len(batch_ids) + len(other_ids)} (canlı {len(all_rows)})')

    # ÖNCESİ ölçümü — raporda "kümelenmişti" iddiasının kanıtı
    before = {}
    for i, r in enumerate(all_rows):
        if r['id'] in seen:
            before.setdefault(i // PAGE_SIZE + 1, 0)
            before[i // PAGE_SIZE + 1] += 1
    print('ÖNCE  -> ' + ', '.join(f's{p}:{n}' for p, n in sorted(before.items())))

    combined, total_old, total_new = [], len(other_ids), len(batch_ids)
    if not total_new:
        combined = other_ids
    else:
        step = total_old / total_new
        next_at, oi, ni, pos = step, 0, 0, 0
        while oi < total_old or ni < total_new:
            if ni < total_new and (oi >= total_old or pos >= next_at):
                combined.append(batch_ids[ni]); ni += 1; next_at += step
            else:
                combined.append(other_ids[oi]); oi += 1
            pos += 1

    assert sorted(combined) == sorted(other_ids + batch_ids), 'kayıp/mükerrer id — algoritma hatası'

    after = {}
    for i, pid in enumerate(combined):
        if pid in seen:
            after.setdefault(i // PAGE_SIZE + 1, 0)
            after[i // PAGE_SIZE + 1] += 1
    print(f'SONRA -> {len(after)} farklı sayfa (toplam {-(-len(combined) // PAGE_SIZE)} sayfa)')
    print('   ' + ', '.join(f's{p}:{n}' for p, n in sorted(after.items())))

    if args.dry_run:
        print('\n[dry-run] display_order yazılmadı.')
        return 0

    chunk = 300
    for i in range(0, len(combined), chunk):
        part = combined[i:i + chunk]
        rows_sql = ',\n'.join(f'({pid}, {i + j + 1})' for j, pid in enumerate(part))
        d1_file(f'''
WITH new_order(id, ord) AS (VALUES
{rows_sql}
)
UPDATE products SET display_order = (SELECT ord FROM new_order WHERE new_order.id = products.id)
WHERE id IN (SELECT id FROM new_order);
''')
        print(f'  display_order yazıldı: {min(i + chunk, len(combined))}/{len(combined)}')
    print('\nBitti.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
