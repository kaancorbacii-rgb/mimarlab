#!/usr/bin/env python3
"""batch114 partisinin 64 satırını katalog sırası için YENİDEN dizer (2026-09-04).

NEDEN GEREKTİ: katalog/anasayfa varsayılanı `ORDER BY id DESC` (bkz. src/routes/product.js), yani
ekranda görünen sıra INSERT sırasının TERSİ. İlk karıştırma algoritması "her turda tüm markalardan
birer tane" alıyordu; kalan tek marka (20 ürünlü Nurus) listenin SONUNDA kümeleniyor, ters
çevrilince katalogun EN ÜSTÜNDE beş Nurus ürünü peş peşe çıkıyordu — kullanıcının açıkça
istemediği "marka marka peş peşe" görüntüsü. Algoritma sıfır komşu tekrar üretecek şekilde
düzeltildi (bkz. batch114-build-payload.py#shuffle_by_brand); bu betik de ZATEN YAZILMIŞ satırları
yeni sıraya taşır.

NASIL: satırlar D1'den TAM olarak okunur (görsel yolları dahil — içe aktarımda 11 görsel
indirilemediğinden payload'daki liste ile D1'deki liste birebir aynı DEĞİL, bu yüzden payload'dan
yeniden üretmek veri kaybı olurdu), silinir ve yeni sırayla yeniden yazılır. `id` yeniden atanır;
bu satırlar parti yeni yazıldığı için hiçbir yerden id ile referans almıyor (project_products /
image_hotspots boş; ratings/saved_items zaten id değil metin anahtar kullanıyor).

Kullanım:
  python3 scripts/reorder-batch114-rows.py [--dry-run]
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
q, d1, d1_file = imp.q, imp.d1, imp.d1_file

COLS = ['slug', 'kind', 'title', 'brand_office_id', 'brand_name_raw', 'website', 'category',
        'description', 'images', 'specs', 'source_url', 'ai_generated', 'source', 'legacy_key',
        'claimed_by_user_id', 'created_at', 'updated_at', 'hidden_at', 'designer', 'year',
        'files', 'variants']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    payload = json.load(open(os.path.join(HERE, 'output', 'batch114-payload.json'), encoding='utf8'))
    want = [p['slug'] for p in payload['products']]

    rows = d1(f"SELECT id, {', '.join(COLS)} FROM products WHERE variants IS NOT NULL "
              "AND deleted_at IS NULL")
    by_slug = {r['slug']: r for r in rows}
    print(f'D1: {len(rows)} varyantlı satır | payload: {len(want)} ürün')

    missing = [s for s in want if s not in by_slug]
    extra = [s for s in by_slug if s not in want]
    if missing or extra:
        print(f'DURDURULDU — eşleşmeyen satırlar var. eksik={missing} fazla={extra}', file=sys.stderr)
        return 1

    current = [r['slug'] for r in sorted(rows, key=lambda r: r['id'])]
    if current == want:
        print('Sıra zaten doğru, yapılacak bir şey yok.')
        return 0
    print(f'Mevcut sıra farklı — yeniden yazılacak.')

    stmts = ['DELETE FROM products WHERE id IN (%s);' % ','.join(str(r['id']) for r in rows)]
    for slug in want:
        r = by_slug[slug]
        vals = []
        for c in COLS:
            v = r[c]
            vals.append('NULL' if v is None else (str(v) if isinstance(v, (int, float)) else q(v)))
        stmts.append(f"INSERT INTO products ({', '.join(COLS)})\nVALUES ({', '.join(vals)});")

    if args.dry_run:
        print(f'[dry-run] 1 DELETE + {len(want)} INSERT yazılmadı.')
        return 0
    d1_file('\n'.join(stmts))
    print(f'{len(want)} satır yeni sırayla yeniden yazıldı.')

    check = d1('SELECT slug, brand_name_raw FROM products WHERE variants IS NOT NULL '
               'AND deleted_at IS NULL ORDER BY id DESC')
    runs = sum(1 for a, b in zip(check, check[1:]) if a['brand_name_raw'] == b['brand_name_raw'])
    print(f'Katalog sırasında (id DESC) art arda aynı marka: {runs} (0 beklenir)')
    for r in check[:8]:
        print(f"  {r['brand_name_raw']:12} {r['slug']}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
