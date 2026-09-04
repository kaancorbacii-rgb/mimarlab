#!/usr/bin/env python3
"""Archello toplu ÜRÜN içe aktarımı (2026-09-04, 27 ürün / 5 marka).

`scripts/import-archello-brands.py`'nin ürün tarafındaki eşi; aynı güvenlik ilkeleri geçerli.
Dört iş yapar:

  1. Eksik MARKA profillerini açar (marka = brand cats taşıyan bir `offices` satırı; ayrı bir
     `brands` tablosu YOKTUR, bkz. office-kind.js). Mevcut markalara "zenginleştir, EZME"
     semantiğiyle dokunulur — import-archello-brands.py ile aynı kural.
  2. Ürün görsellerini Archello'dan çeker, WebP'ye çevirir ve R2'ye yazar
     (`import/products/<slug>/<n>.webp`). /media/* SADECE env.UPLOADS'tan okunur — görselleri
     git'e commit etmek onları CANLIYA GETİRMEZ (bkz. [[project_media_projects_route_is_r2_not_static]]).
  3. `products` satırlarını INSERT eder, `brand_office_id` ile marka profiline bağlar.
  4. Mükerrer kontrolü: slug + (marka|||başlık) TR-fold anahtarı.

DOSYALAR (CAD/BIM/PDF) NEDEN R2'YE ALINMIYOR:
Archello'nun indirme uçları (`/attachment/product/download-document?...`) dosyayı DEĞİL, bir
lead-capture formu (text/html, ~10 KB) döndürüyor — hem broşür hem `bim_cad=1` varyantı için
doğrulandı (2026-09-04). Dosya baytlarına erişim yok, dolayısıyla `files` girdileri Archello'daki
indirme sayfasına DIŞ BAĞLANTI olarak yazılır. Bu, import-furniture-set2.js'teki
`uploaded || {url: f.url, ...}` fallback deseniyle aynı; product-modal.js#renderFilesSection
harici URL'leri zaten safeUrl()+target=_blank ile açıyor.

Kullanım:
  python3 scripts/import-archello-products.py --payload scripts/output/archello-products-payload.json [--dry-run] [--skip-images]
"""

import argparse
import concurrent.futures
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_NAME = 'mimarlab-db'
BUCKET = 'mimarlab-uploads'
R2_PRODUCT_PREFIX = 'import/products'
R2_BRAND_PREFIX = 'u/archello-brands'

MAX_IMG_W = 1600          # image-cdn.js türev merdiveninin üst basamağı (400/800/1600)
MAX_LOGO_W = 800
WEBP_QUALITY = 82

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')

TR_MAP = {'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'I': 'i', 'İ': 'i', 'ö': 'o',
          'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u'}


def fold_tr(s):
    """js/data.js#foldTr'nin Python karşılığı — dedup anahtarları için."""
    return ''.join(TR_MAP.get(c, c) for c in str(s or '')).lower().strip()


def q(v):
    """SQL string literal (NULL güvenli)."""
    if v is None or v == '':
        return 'NULL'
    return "'" + str(v).replace("'", "''") + "'"


def wrangler(args, **kw):
    return subprocess.run(['npx', 'wrangler', *args], cwd=ROOT, capture_output=True, **kw)


def d1(sql):
    """Tek bir SELECT çalıştırır ve results dizisini döndürür.

    DİKKAT (import-archello-brands.py#d1 ile AYNI tuzak): SQL'i tek satıra indirmek için
    `\\s+ -> ' '` YAPMA — string literal'lerin İÇİNDEKİ satır sonlarını da yer yapar ve çok
    paragraflı `about`/`description` alanları sessizce tek paragrafa çöker.
    """
    p = wrangler(['d1', 'execute', DB_NAME, '--remote', '--json', '--command', sql.strip()])
    out = p.stdout.decode('utf8', 'replace')
    i = out.find('[')
    if p.returncode != 0 or i < 0:
        raise RuntimeError(f'd1 hatası: {p.stderr.decode("utf8", "replace")[-2000:]}\n{out[-2000:]}')
    return json.loads(out[i:])[0]['results']


def d1_file(sql_text):
    """Çok ifadeli SQL'i dosyadan çalıştırır — uzun batch'ler için (argv sınırı yok)."""
    with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False, encoding='utf8') as f:
        f.write(sql_text)
        path = f.name
    try:
        p = wrangler(['d1', 'execute', DB_NAME, '--remote', '--file', path])
        if p.returncode != 0:
            raise RuntimeError(f'd1 batch hatası: {p.stderr.decode("utf8", "replace")[-3000:]}')
    finally:
        os.unlink(path)


def http_get(url, tries=3):
    """urllib Archello'dan 403 alıyor (bot filtresi); curl geçiyor."""
    for _ in range(tries):
        p = subprocess.run(['curl', '-sL', '--compressed', '-A', UA, '--max-time', '60', url],
                           capture_output=True)
        if p.returncode == 0 and len(p.stdout) > 500:
            return p.stdout
    return None


def to_webp(data, max_w):
    from PIL import Image
    im = Image.open(io.BytesIO(data))
    # Saydam görsel BEYAZ zemine YAPIŞTIRILIR; alfa kanalı düpedüz DÜŞÜRÜLMEZ.
    #
    # 2026-09-04 CANLI HATASI: eski kod `im.convert('RGB')` diyordu. Bu, alfayı atıp RGB'yi
    # olduğu gibi bırakır — Koleksiyon'un modül render'ları ise **LA** kipinde ve görüntünün
    # TAMAMI alfa kanalında kodlanmış (parlaklık kanalı her pikselde 0). Sonuç: 2000x1577'lik
    # perspektif render'ı düpedüz SİYAH BİR SİLUET olarak R2'ye yazıldı ve canlıdaki ürün
    # pop-up'ında öyle göründü (batch67'de 621 kaynağın 192'si alfalı: 137 RGBA + 55 LA).
    # Beyaza yapıştırmak her iki kipte de doğrudur: LA'da siyah çizim beyaz zemine oturur,
    # RGBA'da saydam bölgelerin altındaki çöp piksel siyah hâle bulaşmaz.
    if im.mode in ('RGBA', 'LA', 'PA') or (im.mode == 'P' and 'transparency' in im.info):
        rgba = im.convert('RGBA')
        flat = Image.new('RGB', rgba.size, (255, 255, 255))
        flat.paste(rgba, mask=rgba.getchannel('A'))
        im = flat
    elif im.mode != 'RGB':
        im = im.convert('RGB')
    if im.width > max_w:
        im = im.resize((max_w, max(1, round(im.height * max_w / im.width))), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=WEBP_QUALITY, method=6)
    return buf.getvalue()


def r2_put(key, data, content_type='image/webp'):
    with tempfile.NamedTemporaryFile(suffix='.webp', delete=False) as f:
        f.write(data)
        path = f.name
    try:
        p = wrangler(['r2', 'object', 'put', f'{BUCKET}/{key}',
                      '--file', path, '--content-type', content_type, '--remote'])
        return p.returncode == 0, p.stderr.decode('utf8', 'replace')[-400:]
    finally:
        os.unlink(path)


def webp_width(data):
    """Kodlanmış WebP'nin GERÇEK genişliği — note_derivatives'in "asla büyütme" kararı için."""
    from PIL import Image
    try:
        return Image.open(io.BytesIO(data)).width
    except Exception:
        return 0


# image-cdn.js#DERIVATIVE_WIDTHS / src/lib/derivativeIngest.js#DERIVATIVE_WIDTHS ile BİREBİR AYNI.
DERIVATIVE_WIDTHS = [400, 800, 1600]
# Bu koşuda R2'ye yazılan her ORİJİNAL için üretilmesi gereken (r2_key, width) çiftleri.
_pending_derivatives = []


def note_derivatives(key, src_width):
    """Yazılan bir orijinali responsive türev kuyruğuna aday olarak biriktirir.

    DENETİM BULGUSU (2026-09-04): bu betik (ve import-archello-brands.py) R2'ye yalnızca ORİJİNALİ
    yazıyor, ne türev üretiyor ne de D1'deki image_derivative_queue'ya iş bırakıyordu. Tarayıcı
    üzerinden yapılan yüklemelerde bu boşluk yok (image-upload.js türevleri üretir, üretemediğini
    src/lib/derivativeIngest.js kuyruğa yazar) — ama içe aktarma betikleri o yolun TAMAMEN dışında
    çalışıyor. Sonuç: 2026-09-04'te içe aktarılan 27 Archello ürününün kapak görselleri ana sayfa
    ürün ızgarasında w800 türevi bulunamadığı için ORİJİNALE geri düşüyordu — 380 CSS px'lik bir
    kart için 401 KB'lık 1600 px'lik dosya (türev üretildiğinde 117 KB; %71 tasarruf).

    Kuyruğa yazmak yeterli: scripts/drain-derivative-queue.py artımlı olarak boşaltır ve
    generate-image-derivatives.py ile TAM TARAMA yapmak (26.500 kaynak, saatler) gerekmez.
    ASLA BÜYÜTME kuralı burada da geçerli — kaynaktan geniş basamak kuyruğa hiç girmez.
    """
    for w in DERIVATIVE_WIDTHS:
        if src_width > w:
            _pending_derivatives.append((key, w))


def flush_derivative_queue(dry_run):
    """Biriken çiftleri tek bir batch ile image_derivative_queue'ya yazar (INSERT OR IGNORE —
    src/lib/derivativeIngest.js#queueDerivatives ile AYNI idempotent desen)."""
    if not _pending_derivatives:
        return 0
    if dry_run:
        print(f'  [dry-run] türev kuyruğuna {len(_pending_derivatives)} iş yazılmazdı.')
        return 0
    now = int(time.time() * 1000)
    rows = ',\n'.join(
        f'({q(k)}, {w}, {now})' for k, w in _pending_derivatives)
    d1_file('INSERT OR IGNORE INTO image_derivative_queue (r2_key, width, created_at) VALUES\n'
            + rows + ';\n')
    n = len(_pending_derivatives)
    _pending_derivatives.clear()
    print(f'  türev kuyruğuna {n} iş yazıldı — boşaltmak için: '
          'python3 scripts/drain-derivative-queue.py')
    return n


# --------------------------------------------------------------------------------------------
# 1) Markalar
# --------------------------------------------------------------------------------------------
def sync_brands(payload, dry_run, skip_images):
    brands = payload['brands']
    # Archello marka slug'ı -> ürünlerdeki görünen ad
    logo_by_slug = {}
    for p in payload['products']:
        logo_by_slug.setdefault(p['brand_slug'], p.get('brand_logo'))

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
                key = f'{R2_BRAND_PREFIX}/{slug}-logo.webp'
                if dry_run:
                    logo_path = f'/media/{key}'
                    print(f'    [dry] logo {key} ({len(raw)//1024} KB)')
                else:
                    logo_webp = to_webp(raw, MAX_LOGO_W)
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
                f"{q(json.dumps(b['cats'], ensure_ascii=False))}, {q(b['website'])}, "
                f"{q(b['about'])}, {q(logo_path)}, 'admin');")
            print(f"  + yeni marka: {b['name']} ({slug})")
            continue

        # "Zenginleştir, EZME" — yalnızca BOŞ alanlar doldurulur (import-archello-brands.py ile aynı).
        sets = []
        for col, val in (('loc', b['loc']), ('website', b['website']),
                         ('about', b['about']), ('logo_url', logo_path)):
            if val and not (e.get(col) or '').strip():
                sets.append(f'{col} = {q(val)}')
        if sets:
            sets.append("updated_at = datetime('now')")
            stmts.append(f"UPDATE offices SET {', '.join(sets)} WHERE id = {e['id']};")
            print(f"  ~ güncellenecek: {e['name']} ({', '.join(s.split(' =')[0] for s in sets[:-1])})")
        else:
            print(f"  = dokunulmayacak (tüm alanlar dolu): {e['name']}")

    if stmts and not dry_run:
        d1_file('\n'.join(stmts))
        print(f'  offices yazıldı ({len(created)} yeni).')
    elif dry_run:
        print(f'  [dry-run] offices yazılmadı ({len(created)} yeni olurdu).')
    return created


# --------------------------------------------------------------------------------------------
# 2) Ürünler
# --------------------------------------------------------------------------------------------
def upload_images(item, dry_run, skip_images):
    """Ürünün görsellerini indirir, WebP'ye çevirir, R2'ye yazar; /media/... yollarını döndürür."""
    if skip_images:
        return []
    paths = []

    def one(idx_url):
        idx, url = idx_url
        raw = http_get(url)
        if not raw:
            return (idx, None, f'indirilemedi: {url}')
        try:
            webp = to_webp(raw, MAX_IMG_W)
        except Exception as ex:
            return (idx, None, f'webp hatası: {ex}')
        key = f"{R2_PRODUCT_PREFIX}/{item['slug']}/{idx}.webp"
        if dry_run:
            return (idx, f'/media/{key}', None)
        ok, err = r2_put(key, webp)
        if ok:
            note_derivatives(key, webp_width(webp))
        return (idx, f'/media/{key}', None) if ok else (idx, None, f'R2: {err}')

    jobs = list(enumerate(item['images'], start=1))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        for idx, path, err in sorted(ex.map(one, jobs)):
            if err:
                print(f"    UYARI [{item['slug']} #{idx}]: {err}")
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
    print(f"{len(items)} ürün, {len(payload['brands'])} marka adayı"
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

    print('\n--- 4) Görseller (Archello -> WebP -> R2) ---')
    stmts, report = [], []
    for it in todo:
        img_paths = upload_images(it, args.dry_run, args.skip_images)
        office_id = by_slug.get(it['brand_slug']) or by_fold.get(fold_tr(it['brand']))

        files = [{'url': f['url'],
                  'filename': f.get('filename') or f"{it['slug']}.{f.get('format') or 'bin'}",
                  'format': f.get('format') or '',
                  'size': f.get('size')} for f in it['files']]

        cols = ['slug', 'kind', 'title', 'brand_office_id', 'brand_name_raw', 'website', 'category',
                'description', 'images', 'specs', 'source_url', 'source', 'legacy_key',
                'designer', 'files']
        vals = [q(it['slug']), "'product'", q(it['title']),
                str(office_id) if office_id else 'NULL',
                q(it['brand']), q(it['source_url']), q(it['category']),
                q(it['description']),
                q(json.dumps(img_paths, ensure_ascii=False)),
                q(json.dumps(it['specs'], ensure_ascii=False)),
                q(it['source_url']), "'admin'",
                q(f"{it['brand']}|||{it['title']}"),
                q(it['designer']),
                q(json.dumps(files, ensure_ascii=False))]
        stmts.append(f"INSERT INTO products ({', '.join(cols)})\nVALUES ({', '.join(vals)});")
        report.append({'slug': it['slug'], 'title': it['title'], 'brand': it['brand'],
                       'images': len(img_paths), 'files': len(files), 'office_id': office_id})
        print(f"  {it['title'][:44]:46} görsel={len(img_paths):2}/{len(it['images']):2} "
              f"dosya={len(files)} office_id={office_id}")

    print('\n--- 5) D1 INSERT ---')
    if args.dry_run:
        print(f'  [dry-run] {len(stmts)} INSERT yazılmadı.')
    else:
        d1_file('\n'.join(stmts))
        print(f'  {len(stmts)} ürün yazıldı.')

    # Responsive türev kuyruğu — bkz. note_derivatives dosya içi notu. Ürün satırları YAZILDIKTAN
    # sonra çalışır: kuyruğu boşaltan betik türevi üretirken kaynağı public /media/ üzerinden
    # indirir, o da yalnızca R2'de duran nesneye bakar (D1 satırına değil), ama sıralamayı yine de
    # "önce içerik, sonra optimizasyon" tutmak akışı okunur kılıyor.
    print('\n--- 6) Responsive türev kuyruğu ---')
    flush_derivative_queue(args.dry_run)

    out = os.path.join(ROOT, 'scripts', 'output', 'archello-products-import-report.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(report, open(out, 'w', encoding='utf8'), ensure_ascii=False, indent=2)
    print(f'\nRapor: {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
