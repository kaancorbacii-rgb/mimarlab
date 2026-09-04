#!/usr/bin/env python3
"""import-koleksiyon3.py'nin DÜŞÜRDÜĞÜ aşırı büyük görselleri kurtarır (2026-09-05).

SORUN: Koleksiyon CDN'inde birkaç kaynak görsel ~200 megapiksel. Pillow'un
`Image.MAX_IMAGE_PIXELS` eşiği (89.5 MP) AŞILDIĞINDA yalnızca uyarır, ama eşiğin İKİ KATI
aşıldığında `DecompressionBombError` FIRLATIR — import'ta 5 görsel tam bu yüzden düştü
(Convivium 1, Porte 4) ve o ürünlerin galerisinde eksik kaldı.

Kaynak bu projenin bilerek kazıdığı markanın kendi CDN'i olduğundan bomba riski yok; burada
sınır kaldırılıp YALNIZCA eksik kalan anahtarlar yazılır. Anahtar şeması import ile AYNI
(`import/products/<slug>/k3-<idx>.webp`, idx = payload'daki birleşik URL listesindeki 1-tabanlı
sıra) — yani bu görsellerin anahtarları ilk çalıştırmada HİÇ yazılmadı, üzerine yazma ve
/media immutable önbellek sorunu YOK.

Kullanım: python3 scripts/repair-koleksiyon3-oversized.py [--dry-run]
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

_k3spec = _ilu.spec_from_file_location('import_koleksiyon3',
                                       os.path.join(HERE, 'import-koleksiyon3.py'))
K3 = _ilu.module_from_spec(_k3spec)
_k3spec.loader.exec_module(K3)      # argparse'ı `if __name__` altında, import güvenli

q, d1, d1_file = imp.q, imp.d1, imp.d1_file


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None                   # bkz. dosya başı gerekçesi

    payload = json.load(open(os.path.join(HERE, 'output', 'koleksiyon3-payload.json'),
                             encoding='utf8'))['products']
    report = json.load(open(os.path.join(HERE, 'output', 'koleksiyon3-import-report.json'),
                            encoding='utf8'))
    slug_of, id_of = {}, {}
    for r in report:
        if r['action'] == 'update':
            id_of[r['title']] = r['id']
            slug_of[r['title']] = r['slug']
        else:
            slug_of[r['title']] = r['slug']

    fixed_rows = 0
    for it in payload:
        title = it['title']
        folder = slug_of[title]
        urls = list(dict.fromkeys(
            list(it['images']) + [u for v in it['variants'] for u in v['srcImages']]))
        expected = {u: f'/media/{K3.R2_PREFIX}/{folder}/{K3.BATCH_TAG}-{i}.webp'
                    for i, u in enumerate(urls, start=1)}

        pid = id_of.get(title)
        row = d1(f'SELECT id, images, variants FROM products WHERE '
                 + (f'id = {pid}' if pid else f'slug = {q(folder)}'))
        if not row:
            print(f'  ATLANDI (satır yok): {title}')
            continue
        row = row[0]
        have = set(json.loads(row['images'] or '[]'))
        for v in json.loads(row['variants'] or '[]'):
            have |= set(v.get('images') or [])
        missing = [u for u, path in expected.items() if path not in have]
        if not missing:
            continue

        print(f"== {title} (#{row['id']}, {folder}): {len(missing)} eksik görsel")
        recovered = {}
        for u in missing:
            raw = imp.http_get(K3.safe_url(u))
            if not raw:
                print(f'   indirilemedi: {u}')
                continue
            try:
                webp = imp.to_webp(raw, imp.MAX_IMG_W)
            except Exception as ex:
                print(f'   webp hatası ({ex}): {u}')
                continue
            key = expected[u].removeprefix('/media/')
            if args.dry_run:
                print(f'   [dry-run] {key} ({len(webp)} bayt) yazılmazdı')
                recovered[u] = expected[u]
                continue
            ok, err = imp.r2_put(key, webp)
            if not ok:
                print(f'   R2 hatası: {err}')
                continue
            imp.note_derivatives(key, imp.webp_width(webp))
            recovered[u] = expected[u]
            print(f'   + {key}')

        if not recovered:
            continue

        # Diziler payload SIRASINA göre yeniden kurulur — kurtarılan görsel doğru yere girer.
        images = [expected[u] for u in it['images'] if expected[u] in have or u in recovered]
        variants = json.loads(row['variants'] or '[]')
        by_src = {}
        for v in it['variants']:
            by_src.setdefault(v['sourceUrl'], []).append(v)
        for v in variants:
            match = next((f for f in by_src.get(v.get('sourceUrl'), [])
                          if f['label'] == v.get('label')), None)
            if not match:
                continue
            v['images'] = [expected[u] for u in match['srcImages']
                           if expected[u] in have or u in recovered]
        if args.dry_run:
            print(f'   [dry-run] images={len(images)} yazılmazdı')
            continue
        d1_file(f"UPDATE products SET images = {q(json.dumps(images, ensure_ascii=False))}, "
                f"variants = {q(json.dumps(variants, ensure_ascii=False))}, "
                f"updated_at = datetime('now') WHERE id = {row['id']};")
        print(f"   satır güncellendi: images={len(images)}")
        fixed_rows += 1

    print(f'\n{fixed_rows} satır onarıldı.')
    K3.flush_derivatives_chunked(args.dry_run)
    return 0


if __name__ == '__main__':
    sys.exit(main())
