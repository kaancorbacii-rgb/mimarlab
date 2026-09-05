#!/usr/bin/env python3
"""import-ersa.py'nin son adımı (responsive türev kuyruğu) SQLITE_TOOBIG ile düştü — 2843 görsel x
en fazla 3 basamak tek bir INSERT'e sığmadı (bkz. [[project_d1_statement_size_limit]]). Ürün
satırları ZATEN yazıldı (D1 yazımı başarılıydı, yalnızca bu son kuyruklama adımı düştü), bu yüzden
görselleri YENİDEN İNDİRİP yüklemek yerine D1'deki `products.images`/`variants[].images`'ı OKUYUP
aynı işi PARÇALI (chunked) INSERT'lerle tamamlar.

Gerçek piksel genişliği bilinmiyor (yükleme sırasındaki bellek-içi webp_width() sonucu betik çöktüğü
için kayboldu) — TÜM basamaklar (400/800/1600) körlemesine kuyruğa yazılır; drain-derivative-
queue.py zaten HER basamak için kendi "asla büyütme + kazanç <%10 ise atla" güvenlik kontrolünü
kaynaktan yeniden okuyarak yapıyor (bkz. o betiğin başlığı), yani fazladan kuyruklanan bir basamak
zararsızca atlanır.

Kullanım:
  python3 scripts/ersa-queue-derivatives.py [--dry-run]
"""
import argparse
import importlib.util as _ilu
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = _ilu.spec_from_file_location('import_archello_products',
                                     os.path.join(HERE, 'import-archello-products.py'))
imp = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(imp)
d1, d1_file, q = imp.d1, imp.d1_file, imp.q

DERIVATIVE_WIDTHS = [400, 800, 1600]
ERSA_OFFICE_ID = 769


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    rows = d1(f'SELECT slug, images, variants FROM products '
              f'WHERE brand_office_id = {ERSA_OFFICE_ID} AND deleted_at IS NULL')
    keys = set()
    for r in rows:
        for src in (r.get('images'), r.get('variants')):
            if not src:
                continue
            try:
                data = json.loads(src)
            except (TypeError, ValueError):
                continue
            paths = data if isinstance(data, list) and data and isinstance(data[0], str) else None
            if paths:
                for p in paths:
                    keys.add(p)
            elif isinstance(data, list):
                for variant in data:
                    for p in variant.get('images', []) or []:
                        keys.add(p)

    r2_keys = [k[len('/media/'):] for k in keys if k.startswith('/media/import/products/')]
    print(f'{len(rows)} Ersa ürünü, {len(r2_keys)} benzersiz R2 anahtarı bulundu.')

    pairs = [(k, w) for k in r2_keys for w in DERIVATIVE_WIDTHS]
    print(f'{len(pairs)} (anahtar, genişlik) çifti kuyruğa yazılacak.')
    if args.dry_run:
        print('[dry-run] yazılmadı.')
        return 0

    now = int(time.time() * 1000)
    chunk = 400  # ~100 KB D1 ifade sınırının altında kalacak şekilde (bkz. dosya başı)
    for i in range(0, len(pairs), chunk):
        part = pairs[i:i + chunk]
        rows_sql = ',\n'.join(f'({q(k)}, {w}, {now})' for k, w in part)
        d1_file('INSERT OR IGNORE INTO image_derivative_queue (r2_key, width, created_at) VALUES\n'
                + rows_sql + ';\n')
        print(f'  yazıldı: {min(i + chunk, len(pairs))}/{len(pairs)}')

    print('\nBitti. Boşaltmak için: python3 scripts/drain-derivative-queue.py')
    return 0


if __name__ == '__main__':
    sys.exit(main())
