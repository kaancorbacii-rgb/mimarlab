#!/usr/bin/env python3
"""114 bağlantılık toplu ürün içe aktarımı — 64 ANA ÜRÜN + 114 VERSİYON (2026-09-04).

`scripts/import-archello-products.py`'nin varyant mimarisine uyarlanmış hâli; o dosyanın
yardımcıları (d1/r2_put/to_webp/türev kuyruğu…) KOPYALANMAZ, modül olarak import edilir — tek
kaynak orasıdır, oradaki bir düzeltme buraya da yansır.

Bu betiğin ondan AYRILDIĞI üç nokta:

1. **Bir `products` satırı = bir AİLE.** Görseller versiyon başına ayrı klasörlenir
   (`import/products/<slug>/v<n>-<k>.webp`) ve `variants` JSON kolonuna yazılır (bkz.
   migrations/0086_product_variants.sql). Ana satırın `images`/`specs`/`files` alanları İLK
   versiyonunkiyle doldurulur — popup açılışta zaten ilk versiyonu seçili gösteriyor.

2. **Dosyalar R2'ye ALINMAZ, dış bağlantı olarak yazılır.** Archello'nunkiler zaten lead-form
   arkasında (bkz. [[project_archello_product_import_2026_09_04]]). Nurus'unkiler DOĞRUDAN
   indirilebilir ama tek bir SKP 50 MB, tek bir MAX 16 MB — 43 Nurus versiyonu × ~5 dosya
   ≈ 3 GB eder. Bu, R2 tavanının (100 GB, ~$1.35/ay bütçe) anlamsız biçimde büyük bir dilimini
   üreticinin kendi CDN'inden zaten ücretsiz servis edilen dosyalar için harcamak olurdu.
   product-modal.js#renderFilesSection harici URL'leri safeUrl()+target=_blank ile zaten açıyor.

3. **Sıra karıştırılmış hâlde gelir.** payload.json'daki dizi sırası markalar arası dönüşümlüdür
   (bkz. batch114-build-payload.py#shuffle_by_brand) ve INSERT'ler o sırayla yazılır; katalog
   varsayılanı `ORDER BY id DESC` olduğundan sıra doğrudan ekrana yansır.

Kullanım:
  python3 scripts/import-batch114.py --payload scripts/output/batch114-payload.json [--dry-run] [--skip-images]
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

R2_PREFIX = 'import/products'


# --------------------------------------------------------------------------------------------
# 1) Markalar — import-archello-products.py#sync_brands ile AYNI "zenginleştir, EZME" semantiği,
#    ama marka listesi burada payload['brands'] (yalnızca YENİ markalar; Nurus/Normod/SNOC/
#    Flexform zaten sitede kayıtlı ve onlara hiç dokunulmaz).
# --------------------------------------------------------------------------------------------
def sync_brands(payload, dry_run, skip_images):
    brands = payload['brands']
    logo_by_slug = {}
    for p in payload['products']:
        if p.get('brand_logo'):
            logo_by_slug.setdefault(p['brand_slug'], p['brand_logo'])

    slugs = ','.join(q(s) for s in brands)
    names = ','.join(q(b['name']) for b in brands.values())
    existing = d1(f"""SELECT id, slug, name, loc, cats, website, about, logo_url
FROM offices
WHERE deleted_at IS NULL AND (slug IN ({slugs}) OR name COLLATE NOCASE IN ({names}))""")
    by_slug = {e['slug']: e for e in existing}
    by_name = {e['name'].casefold(): e for e in existing}

    stmts, created = [], []
    for slug, b in brands.items():
        e = by_slug.get(slug) or by_name.get(b['name'].casefold())
        logo_path = None
        src_logo = logo_by_slug.get(slug)
        if src_logo and not skip_images and not (e and (e.get('logo_url') or '').strip()):
            raw = http_get(src_logo)
            if raw:
                key = f'u/archello-brands/{slug}-logo.webp'
                if dry_run:
                    logo_path = f'/media/{key}'
                else:
                    logo_webp = to_webp(raw, imp.MAX_LOGO_W)
                    ok, err = r2_put(key, logo_webp)
                    if ok:
                        note_derivatives(key, webp_width(logo_webp))
                        logo_path = f'/media/{key}'
                        print(f'    logo yüklendi: {key}')
                    else:
                        print(f'    UYARI: logo yüklenemedi ({slug}): {err}')
            else:
                print(f'    UYARI: logo indirilemedi: {src_logo}')

        if not e:
            created.append(b['name'])
            stmts.append(
                "INSERT INTO offices (slug, name, loc, cats, website, about, logo_url, source)\n"
                f"VALUES ({q(slug)}, {q(b['name'])}, {q(b['loc'])}, "
                # cats: DÜZ string olarak JSON'lanır (-> "Mobilya"). Canlıdaki marka satırları da
                # bu biçimde (bkz. flexform/nurus/normod/snoc) ve office-kind.js#officeCatList
                # üç biçimi de tanıyor; import-archello-products.py ile AYNI çıktı üretilir.
                f"{q(json.dumps(b['cats'], ensure_ascii=False))}, {q(b['website'])}, "
                f"{q(b['about'])}, {q(logo_path)}, 'admin');")
            print(f"  + yeni marka: {b['name']} ({slug})")
            continue

        sets = []
        for col, val in (('loc', b['loc']), ('website', b['website']),
                         ('about', b['about']), ('logo_url', logo_path)):
            if val and not (e.get(col) or '').strip():
                sets.append(f'{col} = {q(val)}')
        if sets:
            sets.append("updated_at = datetime('now')")
            stmts.append(f"UPDATE offices SET {', '.join(sets)} WHERE id = {e['id']};")
            print(f"  ~ güncellenecek: {e['name']}")
        else:
            print(f"  = dokunulmayacak (tüm alanlar dolu): {e['name']}")

    if stmts and not dry_run:
        d1_file('\n'.join(stmts))
        print(f'  offices yazıldı ({len(created)} yeni).')
    elif dry_run:
        print(f'  [dry-run] offices yazılmadı ({len(created)} yeni olurdu).')
    return created


# --------------------------------------------------------------------------------------------
# 2) Görseller — versiyon başına ayrı klasör
# --------------------------------------------------------------------------------------------
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
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        for idx, path, err in sorted(ex.map(one, list(enumerate(urls, start=1)))):
            if err:
                print(f'    UYARI [{slug} v{vi}#{idx}]: {err}')
            else:
                paths.append(path)
    return paths


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--payload', required=True)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--skip-images', action='store_true')
    args = ap.parse_args()

    payload = json.load(open(args.payload, encoding='utf8'))
    items = payload['products']
    nvar = sum(len(p['variants']) for p in items)
    print(f"{len(items)} ana ürün / {nvar} versiyon, {len(payload['brands'])} yeni marka adayı"
          f"{'  [DRY-RUN]' if args.dry_run else ''}\n")

    print('--- 1) Markalar ---')
    sync_brands(payload, args.dry_run, args.skip_images)

    print('\n--- 2) Mükerrer kontrolü ---')
    existing = d1('SELECT slug, title, brand_name_raw FROM products WHERE deleted_at IS NULL')
    existing_slugs = {r['slug'] for r in existing}
    existing_keys = {f"{fold_tr(r['brand_name_raw'])}|||{fold_tr(r['title'])}" for r in existing}
    print(f'  D1 canlı ürün satırı: {len(existing)}')

    todo, skipped = [], []
    for it in items:
        key = f"{fold_tr(it['brand'])}|||{fold_tr(it['title'])}"
        if it['slug'] in existing_slugs or key in existing_keys:
            skipped.append(it)
        else:
            existing_slugs.add(it['slug'])
            existing_keys.add(key)
            todo.append(it)
    for it in skipped:
        print(f"  ATLANDI (zaten var): {it['brand']} — {it['title']}")
    print(f'  eklenecek: {len(todo)}, atlanan: {len(skipped)}')
    if not todo:
        print('\nEklenecek ürün yok.')
        return 0

    print('\n--- 3) offices eşleşmesi (brand_office_id) ---')
    offices = d1('SELECT id, name, slug FROM offices WHERE deleted_at IS NULL')
    by_fold = {fold_tr(o['name']): o['id'] for o in offices}
    by_slug = {o['slug']: o['id'] for o in offices}

    print('\n--- 4) Görseller (kaynak -> WebP -> R2) ---')
    stmts, report = [], []
    for it in todo:
        office_id = by_slug.get(it['brand_slug']) or by_fold.get(fold_tr(it['brand']))

        variants, total_img = [], 0
        for vi, v in enumerate(it['variants'], start=1):
            paths = upload_variant_images(it['slug'], vi, v['srcImages'], args.dry_run, args.skip_images)
            total_img += len(paths)
            variants.append({
                'label': v['label'],
                'options': v['options'],
                'images': paths,
                'specs': v['specs'],
                'files': v['files'],
                'sourceUrl': v['sourceUrl'],
            })

        # Ana satırın görsel/spec/dosya alanları = İLK versiyonunki (bkz. dosya başı 1. madde).
        head = variants[0]
        cols = ['slug', 'kind', 'title', 'brand_office_id', 'brand_name_raw', 'website', 'category',
                'description', 'images', 'specs', 'source_url', 'source', 'legacy_key',
                'designer', 'files', 'variants']
        vals = [q(it['slug']), "'product'", q(it['title']),
                str(office_id) if office_id else 'NULL',
                q(it['brand']), q(it['source_url']), q(it['category']),
                q(it['description']),
                q(json.dumps(head['images'], ensure_ascii=False)),
                q(json.dumps(head['specs'], ensure_ascii=False)),
                q(it['source_url']), "'admin'",
                q(f"{it['brand']}|||{it['title']}"),
                q(it['designer']),
                q(json.dumps(head['files'], ensure_ascii=False)),
                q(json.dumps(variants, ensure_ascii=False))]
        stmts.append(f"INSERT INTO products ({', '.join(cols)})\nVALUES ({', '.join(vals)});")
        report.append({'slug': it['slug'], 'title': it['title'], 'brand': it['brand'],
                       'variants': len(variants), 'images': total_img, 'office_id': office_id})
        print(f"  {it['title'][:42]:44} versiyon={len(variants):2} görsel={total_img:3} "
              f"office_id={office_id}")

    print('\n--- 5) D1 INSERT ---')
    if args.dry_run:
        print(f'  [dry-run] {len(stmts)} INSERT yazılmadı.')
    else:
        # Tek tek DEĞİL tek batch: sıra korunur (katalog sırası = id sırası, bkz. dosya başı 3).
        d1_file('\n'.join(stmts))
        print(f'  {len(stmts)} ana ürün yazıldı.')

    print('\n--- 6) Responsive türev kuyruğu ---')
    imp.flush_derivative_queue(args.dry_run)

    out = os.path.join(HERE, 'output', 'batch114-import-report.json')
    json.dump(report, open(out, 'w', encoding='utf8'), ensure_ascii=False, indent=2)
    print(f'\nRapor: {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
