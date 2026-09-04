#!/usr/bin/env python3
"""67 bağlantılık toplu ürün içe aktarımı — 61 ANA ÜRÜN + 216 VERSİYON (2026-09-04).

`import-batch114.py`'nin devamı; yardımcılar (d1/r2_put/to_webp/türev kuyruğu…) yine
`import-archello-products.py`'den modül olarak import edilir — tek kaynak orasıdır.

Bu betiğin ondan AYRILDIĞI dört nokta
-------------------------------------

1. **Ürün içi görsel tekilleştirme.** Bu partide versiyonlar aile galerisini PAYLAŞIYOR
   (bkz. batch67-build-payload.py 2. karar: versiyon görselleri = [modül render/teknik çizim] +
   aile galerisi). Kaynak URL başına TEK yükleme yapılır ve aynı R2 yolu tüm versiyonlarda yeniden
   kullanılır; aksi hâlde 28 versiyonlu Chora'da aile galerisi 28 kez R2'ye yazılırdı
   (216 versiyon × ~9 kare = ~1.900 yükleme yerine 580 benzersiz kare).

2. **SVG marka logosu.** Casa'nın logosu SVG; Pillow SVG açamaz. macOS'un Quick Look'u
   (`qlmanage -t`) ile PNG'ye çevrilir, beyaz zemin kırpılır, sonra normal WebP yoluna girer.
   Bu ortamda rsvg-convert/cairosvg/inkscape/ImageMagick'in HİÇBİRİ kurulu değil (doğrulandı).

3. **Mevcut satırlar EZİLMEZ, ZENGİNLEŞTİRİLİR.** batch114'te mükerrer bulunan satır yalnızca
   ATLANIYORDU. Burada Koleksiyon'un Odette/Dilim/Ikaros satırları (id 119/205/227) D1'de zaten
   var ama versiyonsuz; kullanıcı isteği "varsa eski kayıtları güncelle" olduğundan bu üçü UPDATE
   edilir (bkz. batch67_translations.py#UPDATE_EXISTING).

   DİKKAT — düz UPDATE bir GERİLEME olurdu: mevcut satırlarda bu kazımada BULUNMAYAN küratörlü
   veriler var ("Garanti: 5 yıl sınırlı garanti", "Üretim Süresi: 6-8 hafta", "Döşeme
   seçenekleri: Suni deri A, Camira Vita S") ve Dilim'in 6 görseli varken kaynak sayfasında 3
   kare kaldı. Bu yüzden UPDATE şu semantikle yazılır:
     - `variants`  : HER ZAMAN yazılır (zaten yeni yetenek, mevcut satırda yok).
     - `images`    : mevcut + yeni, sırayla ve tekrarsız (mevcut kareler R2'de duruyor, silinmez).
     - `specs`     : mevcut satırın spec'leri KORUNUR, yalnızca yeni ETİKETLER eklenir; ayrıca
                     mevcut aile-geneli spec'ler HER VERSİYONUN tablosuna da eklenir, aksi hâlde
                     versiyon seçilince (versiyon spec'i dolu olduğu için ana satıra düşmez)
                     garanti/üretim süresi ekrandan kaybolurdu.
     - description/designer/files : yalnızca mevcut alan BOŞSA yazılır.
   `slug`/`title`/`category`/`claimed_by_user_id`/`created_at` hiç ellenmez — slug değişirse
   canlı bağlantılar kırılır.

4. **Türev kuyruğu PARÇALI yazılır.** 580 görsel × 3 basamak = ~1.700 satır; D1 tek bir INSERT'te
   bu kadar VALUES satırını reddedebiliyor (bkz. commit 1783e98f — aynı ailenin bir başka
   sınırı). 200'lük parçalara bölünür.

Kullanım:
  python3 scripts/import-batch67.py --payload scripts/output/batch67-payload.json [--dry-run] [--skip-images]
"""

import argparse
import concurrent.futures
import glob
import importlib.util as _ilu
import json
import os
import shutil
import subprocess
import sys
import tempfile
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
fold_tr = imp.fold_tr
http_get = imp.http_get
to_webp = imp.to_webp
r2_put = imp.r2_put
webp_width = imp.webp_width
note_derivatives = imp.note_derivatives

R2_PREFIX = 'import/products'
_lock = threading.Lock()


def safe_url(url):
    """URL yolundaki BOŞLUKLARI yüzde-kodlar.

    Koleksiyon'un modül render'ları `/static/content/perspectives/126 SOFA.png` gibi BOŞLUKLU
    yollarda duruyor; curl bunu kodlamadan gönderince bağlantı hiç kurulmuyor (http=000, 0 bayt).
    2026-09-04 koşusunda 5 üründe (Roma/Duende/Serdivan/Vienna/Odette) 13 modül görseli tam bu
    yüzden indirilemedi. Yalnızca boşluk kodlanır — zaten kodlanmış `%20`'leri tekrar kodlayıp
    (`%2520`) bozmamak için genel bir quote() KULLANILMAZ.
    """
    return url.replace(' ', '%20') if ' ' in url else url

# Casa marka kapağı: markanın kendi ürün fotoğrafçılığından, yatay ve mekân içeren bir kare.
CASA_COVER = 'https://www.casa.com.tr/wp-content/uploads/2025/03/Casa-Albalonga-1.jpg'


# --------------------------------------------------------------------------------------------
# SVG -> PNG (yalnızca marka logosu için)
# --------------------------------------------------------------------------------------------
def svg_to_png(data):
    """SVG baytlarını PNG baytlarına çevirir (macOS Quick Look) ve beyaz kenarları kırpar.

    qlmanage kare bir tuvale render ediyor; logo o tuvalin ortasında ince bir şerit kalıyor,
    bu yüzden mürekkep sınır kutusuna kırpmak ŞART (kırpılmazsa 1200x1200'lük görselin %75'i
    boş beyaz olur ve katalogda logo minik görünür).
    """
    from PIL import Image, ImageChops
    tmpd = tempfile.mkdtemp()
    try:
        src = os.path.join(tmpd, 'logo.svg')
        with open(src, 'wb') as f:
            f.write(data)
        subprocess.run(['qlmanage', '-t', '-s', '1200', '-o', tmpd, src],
                       capture_output=True, timeout=60)
        out = glob.glob(os.path.join(tmpd, '*.png'))
        if not out:
            return None
        im = Image.open(out[0]).convert('RGB')
        bg = Image.new('RGB', im.size, (255, 255, 255))
        diff = ImageChops.difference(im, bg).convert('L').point(lambda p: 255 if p > 12 else 0)
        box = diff.getbbox()
        if box:
            im = im.crop(box)
        buf = __import__('io').BytesIO()
        im.save(buf, 'PNG')
        return buf.getvalue()
    except Exception as e:
        print(f'    UYARI: SVG dönüştürülemedi: {e}')
        return None
    finally:
        shutil.rmtree(tmpd, ignore_errors=True)


def fetch_raster(url):
    """Görseli indirir; SVG ise PNG'ye çevirir. Dönen bayt PIL ile açılabilir."""
    raw = http_get(safe_url(url))
    if not raw:
        return None
    if url.lower().endswith('.svg') or raw[:200].lstrip()[:5].lower() in (b'<svg ', b'<?xml'):
        return svg_to_png(raw)
    return raw


# --------------------------------------------------------------------------------------------
# 1) Markalar — YALNIZCA payload['brands'] (bu partide tek yeni marka: Casa).
#    Koleksiyon (id 717) ve Bürotime (id 771) zaten kayıtlı ve payload'da yer almadıkları için
#    hiç sorgulanmaz; mevcut about/logo alanları kesinlikle EZİLMEZ.
# --------------------------------------------------------------------------------------------
def sync_brands(payload, dry_run, skip_images):
    brands = payload['brands']
    if not brands:
        print('  yeni marka yok.')
        return []

    slugs = ','.join(q(s) for s in brands)
    names = ','.join(q(b['name']) for b in brands.values())
    existing = d1(f"""SELECT id, slug, name, loc, cats, website, about, logo_url, cover_url
FROM offices
WHERE deleted_at IS NULL AND (slug IN ({slugs}) OR name COLLATE NOCASE IN ({names}))""")
    by_slug = {e['slug']: e for e in existing}
    by_name = {e['name'].casefold(): e for e in existing}

    stmts, created = [], []
    for slug, b in brands.items():
        e = by_slug.get(slug) or by_name.get(b['name'].casefold())

        logo_path = cover_path = None
        if not skip_images:
            for key_suffix, src, max_w, target in (
                    ('logo', b.get('logo_src'), imp.MAX_LOGO_W, 'logo'),
                    ('cover', b.get('cover_src'), imp.MAX_IMG_W, 'cover')):
                if not src:
                    continue
                if e and (e.get(f'{target}_url') or '').strip():
                    continue                      # dolu alanı EZME
                raw = fetch_raster(src)
                if not raw:
                    print(f'    UYARI: {target} indirilemedi: {src}')
                    continue
                key = f'u/brands/{slug}-{key_suffix}.webp'
                if dry_run:
                    path = f'/media/{key}'
                else:
                    webp = to_webp(raw, max_w)
                    ok, err = r2_put(key, webp)
                    if not ok:
                        print(f'    UYARI: {target} yüklenemedi ({slug}): {err}')
                        continue
                    note_derivatives(key, webp_width(webp))
                    path = f'/media/{key}'
                    print(f'    {target} yüklendi: {key}')
                if target == 'logo':
                    logo_path = path
                else:
                    cover_path = path

        if not e:
            created.append(b['name'])
            stmts.append(
                "INSERT INTO offices (slug, name, loc, cats, website, about, logo_url, cover_url, source)\n"
                f"VALUES ({q(slug)}, {q(b['name'])}, {q(b['loc'])}, "
                # cats: import-archello-products.py ile AYNI biçim (düz string JSON'u).
                f"{q(json.dumps(b['cats'], ensure_ascii=False))}, {q(b['website'])}, "
                f"{q(b['about'])}, {q(logo_path)}, {q(cover_path)}, 'admin');")
            print(f"  + yeni marka: {b['name']} ({slug})")
            continue

        sets = []
        for col, val in (('loc', b['loc']), ('website', b['website']), ('about', b['about']),
                         ('logo_url', logo_path), ('cover_url', cover_path)):
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
# 2) Görseller — ÜRÜN başına kaynak URL'i tekilleştirilerek (bkz. dosya başı 1. madde)
# --------------------------------------------------------------------------------------------
def upload_product_images(it, dry_run, skip_images):
    """Ürünün tüm (ana + versiyon) görsellerini yükler; kaynak URL -> R2 yolu haritası döndürür."""
    urls = list(dict.fromkeys(
        list(it['images']) + [u for v in it['variants'] for u in v['srcImages']]))
    if skip_images or not urls:
        return {}

    slug = it['slug']

    def one(job):
        idx, url = job
        raw = http_get(safe_url(url))
        if not raw:
            return (url, None, f'indirilemedi: {url}')
        try:
            webp = to_webp(raw, imp.MAX_IMG_W)
        except Exception as ex:
            return (url, None, f'webp hatası: {ex}')
        key = f'{R2_PREFIX}/{slug}/{idx}.webp'
        if dry_run:
            return (url, f'/media/{key}', None)
        ok, err = r2_put(key, webp)
        if ok:
            with _lock:
                note_derivatives(key, webp_width(webp))
            return (url, f'/media/{key}', None)
        return (url, None, f'R2: {err}')

    paths = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        for url, path, err in ex.map(one, list(enumerate(urls, start=1))):
            if err:
                print(f'    UYARI [{slug}]: {err}')
            else:
                paths[url] = path
    return paths


def flush_derivatives_chunked(dry_run, chunk=200):
    """imp.flush_derivative_queue'nun PARÇALI hâli (bkz. dosya başı 4. madde)."""
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
    print(f'  türev kuyruğuna {total} iş yazıldı — boşaltmak için: '
          'python3 scripts/drain-derivative-queue.py')
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--payload', required=True)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--skip-images', action='store_true')
    args = ap.parse_args()

    payload = json.load(open(args.payload, encoding='utf8'))
    items = payload['products']
    # Casa'nın logo/kapak kaynakları payload'da değil, burada tanımlı (marka sayfası kazınmadı).
    if 'casa' in payload['brands']:
        payload['brands']['casa']['logo_src'] = \
            'https://www.casa.com.tr/wp-content/uploads/2024/05/casa-logo-1.svg'
        payload['brands']['casa']['cover_src'] = CASA_COVER

    nvar = sum(len(p['variants']) for p in items)
    print(f"{len(items)} ana ürün / {nvar} versiyon, {len(payload['brands'])} yeni marka adayı"
          f"{'  [DRY-RUN]' if args.dry_run else ''}\n")

    print('--- 1) Markalar ---')
    sync_brands(payload, args.dry_run, args.skip_images)

    print('\n--- 2) Mükerrer kontrolü ---')
    existing = d1('SELECT id, slug, title, brand_name_raw FROM products WHERE deleted_at IS NULL')
    # Güncellenecek satırların MEVCUT içeriği — zenginleştirme için (bkz. dosya başı 3. madde).
    upd_ids = [it['update_id'] for it in items if it.get('update_id')]
    prior = {}
    if upd_ids:
        for r in d1('SELECT id, images, specs, files, description, designer FROM products '
                    f"WHERE id IN ({','.join(str(i) for i in upd_ids)})"):
            prior[r['id']] = r
    existing_slugs = {r['slug'] for r in existing}
    existing_keys = {f"{fold_tr(r['brand_name_raw'])}|||{fold_tr(r['title'])}": r['id']
                     for r in existing}
    known_ids = {r['id'] for r in existing}
    print(f'  D1 canlı ürün satırı: {len(existing)}')

    todo, updates, skipped = [], [], []
    for it in items:
        if it.get('update_id'):
            if it['update_id'] not in known_ids:
                print(f"  UYARI: güncellenecek id={it['update_id']} bulunamadı, YENİ eklenecek: "
                      f"{it['title']}")
                it['update_id'] = None
            else:
                updates.append(it)
                continue
        key = f"{fold_tr(it['brand'])}|||{fold_tr(it['title'])}"
        if it['slug'] in existing_slugs or key in existing_keys:
            skipped.append(it)
        else:
            existing_slugs.add(it['slug'])
            existing_keys[key] = None
            todo.append(it)
    for it in skipped:
        print(f"  ATLANDI (zaten var): {it['brand']} — {it['title']}")
    print(f'  eklenecek: {len(todo)}, güncellenecek: {len(updates)}, atlanan: {len(skipped)}')
    if not todo and not updates:
        print('\nYapılacak iş yok.')
        return 0

    print('\n--- 3) offices eşleşmesi (brand_office_id) ---')
    offices = d1('SELECT id, name, slug FROM offices WHERE deleted_at IS NULL')
    by_fold = {fold_tr(o['name']): o['id'] for o in offices}
    by_slug = {o['slug']: o['id'] for o in offices}

    print('\n--- 4) Görseller (kaynak -> WebP -> R2) ---')
    insert_stmts, update_stmts, report = [], [], []
    for it in todo + updates:
        office_id = by_slug.get(it['brand_slug']) or by_fold.get(fold_tr(it['brand']))
        paths = upload_product_images(it, args.dry_run, args.skip_images)

        parent_images = [paths[u] for u in it['images'] if u in paths]
        variants = []
        for v in it['variants']:
            variants.append({
                'label': v['label'],
                'options': v['options'],
                'images': [paths[u] for u in v['srcImages'] if u in paths],
                'specs': list(v['specs']),
                'files': v['files'],
                'description': v.get('description'),
                'sourceUrl': v['sourceUrl'],
            })

        # --- Mevcut satırı ZENGİNLEŞTİR (ezme) ---
        old = prior.get(it.get('update_id') or -1)
        old_specs = []
        if old:
            old_images = json.loads(old['images'] or '[]')
            old_specs = json.loads(old['specs'] or '[]')
            parent_images = list(dict.fromkeys(old_images + parent_images))[:12]
            # Aile-geneli küratörlü spec'ler (Garanti/Üretim Süresi/Döşeme...) her versiyona da
            # eklenir; yoksa versiyon seçilir seçilmez ekrandan kaybolurlar.
            for v in variants:
                have = {s['label'] for s in v['specs']}
                v['specs'] += [s for s in old_specs if s.get('label') not in have]

        head = variants[0]
        vals = {
            'title': q(it['title']),
            'brand_office_id': str(office_id) if office_id else 'NULL',
            'brand_name_raw': q(it['brand']),
            'website': q(it['source_url']),
            'category': q(it['category']),
            'description': q(it['description']),
            'images': q(json.dumps(parent_images, ensure_ascii=False)),
            'specs': q(json.dumps(head['specs'], ensure_ascii=False)),
            'source_url': q(it['source_url']),
            'designer': q(it['designer']),
            'files': q(json.dumps(head['files'], ensure_ascii=False)),
            'variants': q(json.dumps(variants, ensure_ascii=False)),
        }

        if it.get('update_id'):
            # Ezilmemesi gereken alanlar çıkarılır; description/designer/files yalnızca BOŞSA yazılır.
            upd = {'images': vals['images'], 'variants': vals['variants'],
                   'brand_office_id': vals['brand_office_id']}
            merged_specs = old_specs + [s for s in head['specs']
                                        if s['label'] not in {o.get('label') for o in old_specs}]
            upd['specs'] = q(json.dumps(merged_specs, ensure_ascii=False))
            for col, new_val in (('description', vals['description']),
                                 ('designer', vals['designer']),
                                 ('files', vals['files'])):
                cur = (old or {}).get(col) if col != 'files' else (old or {}).get('files')
                if not (cur or '').strip() or (col == 'files' and (cur or '').strip() in ('[]',)):
                    upd[col] = new_val
            sets = ', '.join(f'{k} = {v}' for k, v in upd.items())
            update_stmts.append(
                f"UPDATE products SET {sets}, updated_at = datetime('now') "
                f"WHERE id = {it['update_id']};")
        else:
            cols = ['slug', 'kind', 'legacy_key', 'source'] + list(vals)
            vv = [q(it['slug']), "'product'", q(f"{it['brand']}|||{it['title']}"), "'admin'"] \
                + list(vals.values())
            insert_stmts.append(f"INSERT INTO products ({', '.join(cols)})\n"
                                f"VALUES ({', '.join(vv)});")

        report.append({'slug': it['slug'], 'title': it['title'], 'brand': it['brand'],
                       'variants': len(variants), 'images': len(paths),
                       'office_id': office_id, 'update_id': it.get('update_id')})
        tag = f"GÜNCELLE id={it['update_id']}" if it.get('update_id') else 'YENİ'
        print(f"  {it['title'][:34]:36} versiyon={len(variants):2} görsel={len(paths):3} "
              f"office_id={office_id} {tag}")

    print('\n--- 5) D1 yazımı ---')
    if args.dry_run:
        print(f'  [dry-run] {len(insert_stmts)} INSERT + {len(update_stmts)} UPDATE yazılmadı.')
    else:
        # INSERT'ler TEK batch: sıra korunur (katalog sırası = id sırası, shuffle buna dayanıyor).
        if insert_stmts:
            d1_file('\n'.join(insert_stmts))
            print(f'  {len(insert_stmts)} ana ürün eklendi.')
        if update_stmts:
            d1_file('\n'.join(update_stmts))
            print(f'  {len(update_stmts)} mevcut ürün güncellendi.')

    print('\n--- 6) Responsive türev kuyruğu ---')
    flush_derivatives_chunked(args.dry_run)

    out = os.path.join(HERE, 'output', 'batch67-import-report.json')
    json.dump(report, open(out, 'w', encoding='utf8'), ensure_ascii=False, indent=2)
    print(f'\nRapor: {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
