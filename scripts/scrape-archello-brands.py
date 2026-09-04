#!/usr/bin/env python3
"""Archello MARKA (`/brand/<slug>`) sayfalarını kazır — `scripts/import-archello-brands.js`'in
beslendiği ham veri. `scripts/scrape-archello-projects.py`'nin marka tarafındaki eşi; oradaki
Archello tuzakları (403 → curl, tam çözünürlük için query string'i atmak) burada da geçerli.

Marka sayfasına ÖZGÜ notlar (2026-09-04 partisinde bulundu):

  * Marka sayfası iki şablonla geliyor: "client" (ödemeli, web sitesi/sosyal bağlantıları olan) ve
    "non-client" (yalnızca ad + adres + açıklama). Listedeki Türk markalarının çoğu non-client —
    bu yüzden `website`/sosyal alanları çoğu markada YOK ve zorlanmaz, null bırakılır.
  * Kapak `.profile-cover img[srcset]` — tam çözünürlük srcset'in EN GENİŞ adayıdır (zaten
    `archello.s3...` orijinali). Logo ise `.profile-photo img[src]` ile SADECE 150×150 thumbs
    olarak geliyor ve thumbs URL'sinden query'yi atmak 403 verir (proje görsellerindeki kural
    burada GEÇERSİZ). Tam boy logo, thumbs yolunu S3 kovasına çevirerek alınır:
    `archello.com/thumbs/images/…` → `archello.s3.eu-central-1.amazonaws.com/images/…`.
  * Açıklama İKİ şablonda geliyor: bazı markalarda `#brand-description` iç div'i var, bazılarında
    (Gotwob gibi) metin doğrudan `#pjax-brand-description` içinde. Yalnızca ilkine bakan bir
    regex, ikinci gruptaki markalarda SESSİZCE boş açıklama döndürür — ikisi de denenir.
  * Adres tek satır serbest metin ("Esentepe mah. Ali Kaya sok. No:5, Istanbul, Turkey"),
    yapılandırılmış değil; ülke/şehir ayrıştırması çeviri adımına bırakılır.
  * Markanın kategorisi ("Manufacturers" vb.) marka sayfasında DEĞİL, yalnızca ona link veren
    kartlarda görünüyor; bu yüzden kategori Archello'dan alınmaz, açıklamadan türetilir.

Kullanım:  python3 scripts/scrape-archello-brands.py --urls <dosya> --out <dosya.json>
"""

import argparse
import concurrent.futures
import html
import json
import re
import subprocess
import sys

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')


def fetch(url: str, tries: int = 3) -> str:
    """curl ile çeker — urllib, UA verilse bile Archello'da 403 alıyor."""
    for _ in range(tries):
        p = subprocess.run(['curl', '-sS', '-L', '--compressed', '-A', UA, '--max-time', '60', url],
                           capture_output=True)
        if p.returncode == 0 and len(p.stdout) > 5000:
            return p.stdout.decode('utf8', 'replace')
    return ''


def strip_tags(s: str) -> str:
    return html.unescape(re.sub(r'<[^>]+>', ' ', s)).strip()


def widest_srcset(srcset: str) -> str:
    """srcset'in en geniş adayı — Archello'da bu, thumbs değil S3 orijinalidir."""
    best, best_w = '', -1
    for part in html.unescape(srcset).split(','):
        bits = part.strip().rsplit(' ', 1)
        if len(bits) != 2 or not bits[1].endswith('w'):
            continue
        try:
            w = int(bits[1][:-1])
        except ValueError:
            continue
        if w > best_w:
            best, best_w = bits[0].strip(), w
    return best


def full_res_asset(url: str) -> str:
    """Archello thumbs URL'sini S3 orijinaline çevirir; query string'i atar.

    `archello.com/thumbs/images/X?fit=fill&w=150` → `archello.s3.…/images/X`. Thumbs yolundan
    yalnızca query'yi atmak 403 döner (doğrulandı), bu yüzden host+yol da değiştirilir.
    """
    u = html.unescape(url).split('?')[0]
    m = re.match(r'https?://(?:www\.)?archello\.com/thumbs/(images/.+)$', u)
    if m:
        return f'https://archello.s3.eu-central-1.amazonaws.com/{m.group(1)}'
    return u


def parse_brand(slug: str, h: str) -> dict:
    """Marka sayfasından tek satırlık ham kayıt."""
    name = ''
    m = re.search(r'<h1 class="h4 profile-name[^"]*"[^>]*>(.*?)</h1>', h, re.S)
    if m:
        name = strip_tags(m.group(1))
    if not name:
        m = re.search(r'<meta property="og:title" content="([^"]*)"', h)
        if m:
            name = html.unescape(m.group(1)).split(' products,')[0].split(' | Archello')[0].strip()

    # Açıklama: önce iç `#brand-description`, yoksa sarmalayıcı `#pjax-brand-description`ın
    # bölüm sonuna kadarki gövdesi (bkz. dosya başındaki iki-şablon notu).
    desc = ''
    m = re.search(r'<div id="brand-description"[^>]*>(.*?)</div>', h, re.S)
    raw = m.group(1) if m else ''
    if not raw.strip():
        m = re.search(r'<div id="pjax-brand-description"[^>]*>(.*?)</section>', h, re.S)
        raw = m.group(1) if m else ''
    if raw.strip():
        # Paragraf sınırlarını koru: <br>/<p>/<div> → satır sonu, sonra etiketleri at.
        raw = re.sub(r'<br\s*/?>|</p>|</div>', '\n', raw)
        desc = re.sub(r'[ \t]+\n', '\n', re.sub(r'\n{3,}', '\n\n', strip_tags(raw))).strip()

    address = ''
    m = re.search(r'<button[^>]*ah-brand-non-client-map-button[^>]*>(.*?)</button>', h, re.S)
    if m:
        address = strip_tags(m.group(1))
    if not address:
        m = re.search(r'<i class="icon icon-location">\s*</i>\s*([^<]{4,160})', h)
        if m:
            address = html.unescape(m.group(1)).strip()

    # DİKKAT — `.*?` ile serbest bırakılan bir arama BURADA SESSİZ VERİ BOZULMASI üretir: logosu
    # OLMAYAN markalarda (YAAZ) tembel joker `profile-photo` div'ini aşıp sayfanın ilerisindeki bir
    # görseli yakalıyordu; sonuç, YAAZ'a BAŞKA bir markanın (SNOC'un) kapak görselinin logo diye
    # atanmasıydı. Bu yüzden img, `profile-photo > span.photo` içinde ARADA BAŞKA ETİKET OLMADAN
    # aranır — bulunamazsa logo yoktur ve boş bırakılır.
    logo = ''
    m = re.search(r'<div class="profile-photo[^"]*"[^>]*>\s*<span class="photo[^"]*"[^>]*>\s*<img[^>]*src="([^"]+)"', h)
    if m:
        logo = full_res_asset(m.group(1))

    cover = ''
    m = re.search(r'<div class="profile-cover">\s*<img[^>]*srcset="([^"]+)"', h, re.S)
    if m:
        cover = full_res_asset(widest_srcset(m.group(1)))
    if not cover:
        m = re.search(r'<div class="profile-cover">\s*<img[^>]*src="([^"]+)"', h, re.S)
        if m:
            cover = full_res_asset(m.group(1))

    # Web sitesi / sosyal — yalnızca "client" şablonunda var. Archello'nun KENDİ altyapı
    # bağlantıları (fonts.googleapis, CDN'ler, kendi sosyal hesapları) her sayfada bulunduğundan
    # elenmezse 58 markanın 58'i de "web sitesi var" görünür — bu yüzden bir kara liste şart.
    INFRA = re.compile(
        r'archello|ogp\.me|googleapis|gstatic|google(tagmanager|-analytics|adservices)?\.com|'
        r'doubleclick|facebook\.com/(archello|sharer)|twitter\.com/(archello|intent)|'
        r'linkedin\.com/(shareArticle|company/archello)|pinterest\.com/pin|schema\.org|w3\.org|'
        r'youtube\.com/(archello|embed)|cloudflare|jsdelivr|jquery|bootstrapcdn|typekit|'
        r'instagram\.com/archello|apple\.com|whatsapp\.com|/cdn-cgi/', re.I)
    links = []
    for m in re.finditer(r'href="(https?://(?!(?:www\.)?archello\.com)[^"]+)"', h):
        u = html.unescape(m.group(1))
        if INFRA.search(u):
            continue
        links.append(u)

    # Marka sayfasının kendi tanıtım bloğundaki örnek projeler (tam liste ayrı sekmede).
    sample_projects = []
    i = h.find('Projects with Products from')
    if i > 0:
        seg = h[i:h.find('Manufacturer Case Studies', i) if h.find('Manufacturer Case Studies', i) > 0 else i + 12000]
        for m in re.finditer(r'href="(/project/[^"?#]+)"[^>]*>(.*?)</a>', seg, re.S):
            t = strip_tags(m.group(2))
            if t:
                sample_projects.append({'slug': m.group(1).rsplit('/', 1)[-1], 'title': t})

    return {
        'archelloSlug': slug,
        'archelloUrl': f'https://archello.com/brand/{slug}',
        'name': name,
        'descriptionEn': desc,
        'address': address,
        'logoUrl': logo,
        'coverUrl': cover,
        'externalLinks': sorted(set(links)),
        'sampleProjects': sample_projects,
        'ok': bool(name),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--urls', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--workers', type=int, default=4)
    args = ap.parse_args()

    urls = [l.strip() for l in open(args.urls, encoding='utf8') if l.strip()]
    slugs = [u.rstrip('/').rsplit('/', 1)[-1] for u in urls]

    def work(slug):
        h = fetch(f'https://archello.com/brand/{slug}')
        if not h:
            print(f'  ! FETCH FAIL {slug}', file=sys.stderr)
            return {'archelloSlug': slug, 'ok': False, 'error': 'fetch failed'}
        rec = parse_brand(slug, h)
        print(f'  {"ok " if rec["ok"] else "?? "} {slug} — {rec.get("name","")} '
              f'[desc {len(rec.get("descriptionEn",""))}ch, logo {"y" if rec.get("logoUrl") else "n"}, '
              f'cover {"y" if rec.get("coverUrl") else "n"}]', file=sys.stderr)
        return rec

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
        out = list(ex.map(work, slugs))

    json.dump(out, open(args.out, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print(f'{sum(1 for r in out if r.get("ok"))}/{len(out)} marka → {args.out}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
