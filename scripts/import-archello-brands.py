#!/usr/bin/env python3
"""Archello marka toplu içe aktarımı — kazıma + çeviri sonrası TOHUMLAMA adımı.

`scripts/import-archello-projects.js`'in marka tarafındaki eşi; aynı güvenlik ilkeleri geçerli.
Üç iş yapar:

  1. Logo + kapak görsellerini Archello S3'ten çeker, WebP'ye çevirir ve R2'ye yazar
     (`u/archello-brands/<slug>-logo.webp` / `-cover.webp`). /media/* SADECE env.UPLOADS'tan
     okunur — görselleri git'e commit etmek onları CANLIYA GETİRMEZ (bkz.
     [[project_media_projects_route_is_r2_not_static]]).
  2. `offices` satırlarını UPSERT eder (marka = brand cats taşıyan bir offices satırı; ayrı bir
     `brands` tablosu YOKTUR, bkz. office-kind.js).
  3. `project_brands` kenarlarını yazar (bkz. migrations/0085_project_brands.sql).

UPSERT SEMANTİĞİ — "zenginleştir, EZME":
Var olan bir marka kaydında yalnızca BOŞ alanlar doldurulur; dolu bir alanın üzerine yazılmaz.
Gerekçe: canlıdaki 6 eşleşen kaydın `about`/`website`/`loc` değerleri elle küratörlükten geçmiş ve
Archello'nun İngilizce/eksik verisinden DAHA İYİ (ör. Ersa'nın `loc`'u "Ankara" — fabrikanın yeri;
Archello İstanbul'daki showroom adresini veriyor). TEK istisna `cats`: değeri yalnızca eski
yer tutucu 'Ürün' ise (bkz. office-kind.js#LEGACY_BRAND_CAT) gerçek marka kategorileriyle
DEĞİŞTİRİLİR — bu bir veri kaybı değil, yer tutucunun çözülmesidir ve marka filtrelerini çalışır
hâle getirir.

Kullanım:
  python3 scripts/import-archello-brands.py --brands <payload.json> --specs <specs.json> \
      [--dry-run] [--skip-images]
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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_NAME = 'mimarlab-db'
BUCKET = 'mimarlab-uploads'
R2_PREFIX = 'u/archello-brands'

# Marka kartı/logosu hiçbir yerde 800 px'ten geniş çizilmiyor (bkz. image-cdn.js türev merdiveni:
# 400/800/1600); kapak ise firma pop-up'ının tam genişlikli bandında 1600 px'e kadar kullanılıyor.
MAX_LOGO_W = 800
MAX_COVER_W = 1600
WEBP_QUALITY = 82

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')

# Archello künyesindeki yapı elemanı etiketlerinin Türkçesi. 'Manufacturers' ve benzeri GENEL rol
# etiketleri bir eleman DEĞİLDİR (Archello, eleman girilmemiş künyelerde bunu yazıyor) — None'a
# eşlenir ve kenar elemansız yazılır; "Üreticiler" diye çevrilseydi marka kartının altında bilgi
# taşımayan bir alt satır belirirdi.
ELEMENT_TR = {
    'manufacturers': None,
    'interior designer, industrial designer, manufacturer': None,
    'furniture': 'Mobilya',
    'furnitures': 'Mobilya',
    'interior furniture': 'İç Mekân Mobilyası',
    'fixed furnitures': 'Sabit Mobilya',
    'movable furnitures': 'Hareketli Mobilya',
    'furniture & accessories': 'Mobilya ve Aksesuar',
    'furniture and accessory': 'Mobilya ve Aksesuar',
    'chair': 'Sandalye',
    'dining chairs': 'Yemek Sandalyeleri',
    'office chairs': 'Ofis Koltukları',
    'armchair': 'Koltuk',
    'armchair, coffee table, social area table': 'Koltuk, Sehpa ve Ortak Alan Masası',
    'stool': 'Tabure',
    'tables': 'Masalar',
    'parquet': 'Parke',
    'tile': 'Karo',
    'ceramic tile': 'Seramik Karo',
    'ceramic tiles': 'Seramik Karo',
    'ceramic elements': 'Seramik Elemanlar',
    'vitrified': 'Vitrifiye',
    'sanitary ware': 'Vitrifiye',
    'sanitaryware and ceramics': 'Vitrifiye ve Seramik',
    'concealed cistern+bathroom, sanitaries+ceramic': 'Gömme Rezervuar, Banyo Vitrifiyesi ve Seramik',
    'wet area': 'Islak Hacim',
    'glass partitions': 'Cam Bölücüler',
    'glass walls+lightings': 'Cam Duvarlar ve Aydınlatma',
    'baffle and mesh ceiling': 'Baffle ve File Asma Tavan',
    'facade cladding': 'Cephe Kaplaması',
    'façade': 'Cephe',
}

# Archello'da ayrı sayfası olup MİMARLAB'da tek kayda düşen slug'lar (bkz.
# scripts/archello-brands-translations.py#BRAND_ALIASES — Archello'daki `/brand/vitra`nın İSVİÇRE
# Vitra AG olduğu ve buraya EKLENMEMESİ gerektiği oradaki uzun notta açıklanmıştır).
BRAND_ALIASES = {'vitra-bathrooms': 'vitra', 'vitra-karo': 'vitra'}

LEGACY_BRAND_CAT = 'Ürün'   # office-kind.js#LEGACY_BRAND_CAT


def wrangler(args, **kw):
    return subprocess.run(['npx', 'wrangler', *args], cwd=ROOT, capture_output=True, **kw)


def d1(sql: str):
    """Tek bir SELECT/DDL çalıştırır ve results dizisini döndürür.

    DİKKAT (import-archello-projects.js#d1 ile AYNI tuzak): SQL'i tek satıra indirmek için
    `\\s+ -> ' '` YAPMA — string literal'lerin İÇİNDEKİ satır sonlarını da yer yapar ve çok
    paragraflı `about` alanları sessizce tek paragrafa çöker.
    """
    p = wrangler(['d1', 'execute', DB_NAME, '--remote', '--json', '--command', sql.strip()])
    out = p.stdout.decode('utf8', 'replace')
    i = out.find('[')
    if p.returncode != 0 or i < 0:
        raise RuntimeError(f'd1 hatası: {p.stderr.decode("utf8", "replace")[-2000:]}\n{out[-2000:]}')
    return json.loads(out[i:])[0]['results']


def d1_file(sql_text: str):
    """Çok ifadeli SQL'i dosyadan çalıştırır — uzun batch'ler için (argv sınırı yok)."""
    with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False, encoding='utf8') as f:
        f.write(sql_text)
        path = f.name
    try:
        p = wrangler(['d1', 'execute', DB_NAME, '--remote', '--file', path, '--json'])
        if p.returncode != 0:
            raise RuntimeError(f'd1 batch hatası: {p.stderr.decode("utf8", "replace")[-3000:]}')
    finally:
        os.unlink(path)


def q(v):
    if v is None or v == '':
        return 'NULL'
    return "'" + str(v).replace("'", "''") + "'"


def fetch_bytes(url: str, tries: int = 3) -> bytes:
    for _ in range(tries):
        p = subprocess.run(['curl', '-sS', '-L', '--compressed', '-A', UA, '--max-time', '90', url],
                           capture_output=True)
        if p.returncode == 0 and len(p.stdout) > 500:
            return p.stdout
    return b''


def to_webp(data: bytes, max_w: int) -> bytes:
    """WebP'ye çevirir; ŞEFFAFLIĞI KORUR (logolarda arka plan saydam, RGB'ye düzleştirmek
    onları beyaz/siyah bir kutu içinde gösterirdi) ve ASLA BÜYÜTMEZ."""
    from PIL import Image
    im = Image.open(io.BytesIO(data))
    im.load()
    if im.mode in ('P', 'LA'):
        im = im.convert('RGBA')
    elif im.mode not in ('RGB', 'RGBA'):
        im = im.convert('RGB')
    if im.width > max_w:
        im = im.resize((max_w, max(1, round(im.height * max_w / im.width))), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=WEBP_QUALITY, method=6)
    return buf.getvalue()


def r2_put(key: str, data: bytes) -> bool:
    with tempfile.NamedTemporaryFile(suffix='.webp', delete=False) as f:
        f.write(data)
        path = f.name
    try:
        for _ in range(3):
            p = wrangler(['r2', 'object', 'put', f'{BUCKET}/{key}', '--file', path,
                          '--content-type', 'image/webp', '--remote'])
            if p.returncode == 0:
                return True
        print(f'    ! R2 yazılamadı: {key}', file=sys.stderr)
        return False
    finally:
        os.unlink(path)


def process_images(records, dry_run: bool, skip: bool):
    """Her marka için logo/kapak → WebP → R2. Sonuç: rec['logoPath']/rec['coverPath'] (/media/...)."""
    if skip:
        for r in records:
            r['logoPath'] = r['coverPath'] = None
        return

    def work(r):
        r['logoPath'] = r['coverPath'] = None
        for kind, src, max_w in (('logo', r.get('logoUrl'), MAX_LOGO_W),
                                 ('cover', r.get('coverUrl'), MAX_COVER_W)):
            if not src:
                continue
            raw = fetch_bytes(src)
            if not raw:
                print(f'    ! indirilemedi ({kind}): {r["canonicalSlug"]}', file=sys.stderr)
                continue
            try:
                webp = to_webp(raw, max_w)
            except Exception as e:  # bozuk/desteklenmeyen kaynak — kırık görsel yazmaktansa atla
                print(f'    ! dönüştürülemedi ({kind}) {r["canonicalSlug"]}: {e}', file=sys.stderr)
                continue
            key = f'{R2_PREFIX}/{r["canonicalSlug"]}-{kind}.webp'
            if dry_run:
                print(f'    [dry] {key}  {len(raw) // 1024}KB -> {len(webp) // 1024}KB')
                r[f'{kind}Path'] = f'/media/{key}'
                continue
            if r2_put(key, webp):
                r[f'{kind}Path'] = f'/media/{key}'
                print(f'    {key}  {len(raw) // 1024}KB -> {len(webp) // 1024}KB')
        return r

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        list(ex.map(work, records))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--brands', required=True)
    ap.add_argument('--specs', required=True)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--skip-images', action='store_true')
    args = ap.parse_args()

    records = json.load(open(args.brands, encoding='utf8'))
    specs = json.load(open(args.specs, encoding='utf8'))
    print(f'{len(records)} marka kaydı, {len(specs)} projenin künyesi')

    # ---- 1. Mevcut kayıtları çöz (slug VE ada göre — bkz. duplicate-name-key sınırlaması) -------
    slugs = ','.join(q(r['canonicalSlug']) for r in records)
    names = ','.join(q(r['name']) for r in records)
    existing = d1(f"""SELECT id, slug, name, loc, cats, yil, website, about, logo_url, cover_url
FROM offices
WHERE deleted_at IS NULL AND (slug IN ({slugs}) OR name COLLATE NOCASE IN ({names}))""")
    by_slug = {e['slug']: e for e in existing}
    by_name = {e['name'].casefold(): e for e in existing}
    print(f'  eşleşen mevcut kayıt: {len(existing)}')

    for r in records:
        r['existing'] = by_slug.get(r['canonicalSlug']) or by_name.get(r['name'].casefold())

    # ---- 2. Görseller ---------------------------------------------------------------------------
    print('görseller (Archello S3 -> WebP -> R2):')
    process_images(records, args.dry_run, args.skip_images)

    # ---- 3. offices UPSERT ----------------------------------------------------------------------
    stmts, n_ins, n_upd = [], 0, 0
    for r in records:
        cats_str = ' · '.join(r['cats'])
        e = r['existing']
        if not e:
            n_ins += 1
            stmts.append(f"""INSERT INTO offices (slug, name, loc, cats, yil, website, about, logo_url, cover_url, source)
VALUES ({q(r['canonicalSlug'])}, {q(r['name'])}, {q(r['loc'])}, {q(json.dumps(cats_str, ensure_ascii=False))},
        {q(r['yil'])}, {q(r['website'])}, {q(r['about'])}, {q(r['logoPath'])}, {q(r['coverPath'])}, 'admin');""")
            continue

        # Zenginleştirme: yalnızca BOŞ alanlar. cats için tek istisna, yer tutucu 'Ürün'.
        sets = []
        for col, val in (('loc', r['loc']), ('yil', r['yil']), ('website', r['website']),
                         ('about', r['about']), ('logo_url', r['logoPath']),
                         ('cover_url', r['coverPath'])):
            if val and not (e.get(col) or '').strip():
                sets.append(f'{col} = {q(val)}')
        # cats BİRLEŞTİRİLİR, ezilmez: bir ofis satırı hem FİRMA hem MARKA listesinde yer alabilir
        # (bkz. office-kind.js dosya başı — "Autoban ... marka sayfasında da görünebilir sorun
        # yok"). Canlıdaki Designnobis tam bu durumda: cats'i "Mimarlık" olan bir mimarlık firması
        # ama Archello'da aynı zamanda bir ürün tasarımı markası. Ezseydik firma dizininden
        # düşerdi; hiç dokunmasaydık marka dizinine hiç girmezdi.
        # Tek istisna, yer tutucu 'Ürün': gerçek kategoriler eklenirken DÜŞÜRÜLÜR — hiçbir bilgi
        # taşımıyor ve marka-ekle.html'de seçilebilir bir seçenek değil.
        cur_cats = (e.get('cats') or '').strip()
        try:
            parsed = json.loads(cur_cats) if cur_cats else None
        except json.JSONDecodeError:
            parsed = cur_cats
        cur_list = parsed if isinstance(parsed, list) else [c.strip() for c in str(parsed or '').split(' · ') if c.strip()]
        merged = [c for c in cur_list if c != LEGACY_BRAND_CAT]
        for c in r['cats']:
            if c not in merged:
                merged.append(c)
        if merged != cur_list:
            sets.append(f"cats = {q(json.dumps(' · '.join(merged), ensure_ascii=False))}")
        if sets:
            n_upd += 1
            sets.append("updated_at = datetime('now')")
            stmts.append(f"UPDATE offices SET {', '.join(sets)} WHERE id = {e['id']};")
            print(f"  ~ güncellenecek: {e['name']} ({', '.join(s.split(' =')[0] for s in sets[:-1])})")
        else:
            print(f"  = dokunulmayacak (tüm alanlar dolu): {e['name']}")

    print(f'offices: {n_ins} yeni, {n_upd} güncelleme')

    if args.dry_run:
        print('[dry-run] SQL yazılmadı.')
    elif stmts:
        d1_file('\n'.join(stmts))
        print('  offices yazıldı.')

    # ---- 4. project_brands kenarları ------------------------------------------------------------
    # Marka çözümlemesi: Archello marka slug'ı -> canonicalSlug -> offices.id. Kenar yalnızca HEM
    # proje HEM marka MİMARLAB'da varsa yazılır (kullanıcı talimatı: "Proje veritabanında henüz
    # yoksa ... temiz geç, veri bütünlüğünü bozma").
    canon_by_ah = {r['archelloSlug']: r['canonicalSlug'] for r in records}
    canon_by_ah.update(BRAND_ALIASES)
    office_ids = {o['slug']: o['id'] for o in d1(
        f"SELECT id, slug FROM offices WHERE deleted_at IS NULL AND slug IN ({slugs})")}

    edges, unknown_elements, skipped = {}, set(), 0
    for prj in specs:
        for s in prj['specs']:
            canon = canon_by_ah.get(s['brandSlug'])
            if not canon:
                continue
            oid = office_ids.get(canon)
            if not oid:
                skipped += 1
                continue
            key = (prj['id'], oid)
            raw_el = s['element'].strip()
            if raw_el.casefold() in ELEMENT_TR:
                el = ELEMENT_TR[raw_el.casefold()]
            else:
                unknown_elements.add(raw_el)
                el = None
            # Aynı (proje, marka) çiftinde birden fazla eleman varsa TEK satırda ' · ' ile birleşir
            # (PRIMARY KEY tek satıra zorluyor, bkz. migrations/0085_project_brands.sql).
            prev = edges.setdefault(key, None)
            if el and not prev:
                edges[key] = el
            elif el and el not in prev.split(' · '):
                edges[key] = f'{prev} · {el}'

    if unknown_elements:
        print(f'  ! ELEMENT_TR sözlüğünde olmayan eleman etiketleri (elemansız yazıldı): '
              f'{sorted(unknown_elements)}')
    print(f'project_brands: {len(edges)} kenar ({skipped} kenar markası MİMARLAB’da yok, atlandı)')

    if args.dry_run:
        for (pid, oid), el in list(edges.items())[:10]:
            print(f'  [dry] proje {pid} <-> marka {oid}  element={el}')
        return 0

    if edges:
        rows = ',\n'.join(f'({pid}, {oid}, {q(el)}, \'admin\')' for (pid, oid), el in edges.items())
        # Yeniden çalıştırılabilirlik: aynı kenar ikinci kez yazılırsa eleman güncellenir.
        d1_file(f"""INSERT INTO project_brands (project_id, office_id, element, source)
VALUES
{rows}
ON CONFLICT(project_id, office_id) DO UPDATE SET element = excluded.element;""")
        print('  project_brands yazıldı.')

    return 0


if __name__ == '__main__':
    sys.exit(main())
