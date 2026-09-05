#!/usr/bin/env python3
"""Ersa Mobilya (ersamobilya.com) — 84 referans PROJESİ sayfasının ham kazıması (2026-09-05).

scrape-ersa.py (ürün kazıması) ile AYNI site, AYNI teknik: WordPress, tamamen sunucu taraflı
render. "Overview / Gallery / Products" sekmeleri saf CSS `.is-active` toggle'ı — JS render
GEREKMİYOR, curl ile çekilen ham HTML'in TAMAMI zaten DOM'da (doğrulandı: /proje/*/ sayfalarında
tarayıcıda "Gallery"/"Products" sekmesine tıklamak network isteği ATMIYOR).

Her sayfadan çekilenler:
  - title (h1), overview alanları (div.item > p.title/p.value: Sektör, Konum, Yıl, Mimari Ofis,
    Uygulanan Alanlar, ...), description (ilk uzun paragraf metni)
  - gallery images: data-src-img taşıyan TÜM <img>, HARİÇ:
      * ersa-beyaz/siyah.png (paylaşılan header logo ikonu, her sayfada tekrarlanır)
      * wp-content/themes/.../webintek.png (ajans logosu, footer)
      * class="full-contain" olanlar (bunlar galeri DEĞİL, Products sekmesindeki ürün fotoğrafı)
  - products: sayfadaki /urun/<slug>/ bağlantılarının img[alt] metninden "Ersa Mobilya | <Ad>"
    kalıbıyla çekilen AİLE adı (site varyant bazlı URL kullanıyor — ör. /urun/mikado-toplanti-masasi/
    — ama img alt HER ZAMAN temiz aile adını taşıyor: "Mikado". Bu, MİMARLAB kataloğundaki
    1-aile-1-ürün-kartı modeliyle DOĞRUDAN eşleşir, slug'ları DEĞİL alt metnini eşleştirme
    anahtarı olarak kullanıyoruz).

Kullanım:
  python3 scripts/scrape-ersa-projects.py [--limit N] [--workers 8]
"""
import argparse
import concurrent.futures
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'output', 'ersa-projects-raw.json')
URLS_FILE = os.path.join(HERE, 'output', 'ersa-projects-urls.txt')

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')


def http_get(url, tries=3):
    for i in range(tries):
        p = subprocess.run(['curl', '-sL', '--compressed', '-A', UA, '--max-time', '30', url],
                            capture_output=True)
        if p.returncode == 0 and len(p.stdout) > 2000:
            return p.stdout
        time.sleep(1 + i)
    return None


def slug_from_url(url):
    return urllib.parse.urlsplit(url).path.strip('/').split('/')[-1]


def parse_page(url):
    from bs4 import BeautifulSoup

    raw = http_get(url)
    if not raw:
        return {'source_url': url, 'error': 'fetch-failed'}
    soup = BeautifulSoup(raw, 'html.parser')

    h1 = soup.select_one('h1')
    title = h1.get_text(strip=True) if h1 else slug_from_url(url)

    overview = {}
    for item in soup.select('div.item'):
        t = item.select_one('p.title')
        v = item.select_one('p.value')
        if t and v:
            overview[t.get_text(strip=True)] = v.get_text(' ', strip=True)

    desc = ''
    for p in soup.select('p'):
        t = p.get_text(' ', strip=True)
        if len(t) > 120 and 'Bu projedeki ürünler' not in t:
            desc = t
            break

    def in_full_contain(tag):
        # Products sekmesindeki ürün fotoğrafı: class="full-contain" (galeri kareleri
        # "full-cover"). Ebeveyn zincirinde kontrol etmeye gerek yok, doğrudan img class'ında var.
        cls = tag.get('class') or []
        return 'full-contain' in cls

    def is_real_photo(src):
        if not src or 'wp-content/uploads' not in src:
            return False
        fname = src.rsplit('/', 1)[-1].lower()
        return not (fname.startswith('ersa-beyaz') or fname.startswith('ersa-siyah'))

    seen, images = set(), []
    for img in soup.select('img[data-src-img]'):
        src = img.get('data-src-img') or ''
        if not is_real_photo(src) or src in seen or in_full_contain(img):
            continue
        seen.add(src)
        images.append(src)

    products = []
    pseen = set()
    for a in soup.select('a[href*="/urun/"]'):
        href = a.get('href') or ''
        if '/urun-kategori/' in href:
            continue
        img = a.select_one('img[alt]')
        alt = (img.get('alt') if img else '') or ''
        m = re.match(r'^Ersa\s*Mobilya\s*\|\s*(.+)$', alt.strip(), re.I)
        name = (m.group(1).strip() if m else '').strip()
        if not name or name in pseen:
            continue
        pseen.add(name)
        products.append({'name': name, 'url': href})

    return {
        'source_url': url,
        'slug': slug_from_url(url),
        'title': title,
        'overview': overview,
        'description': desc,
        'images': images,
        'products': products,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--workers', type=int, default=8)
    args = ap.parse_args()

    urls = [u.strip() for u in open(URLS_FILE, encoding='utf8') if u.strip()]
    if args.limit:
        urls = urls[:args.limit]
    print(f'{len(urls)} URL taranacak...')

    results = []
    errors = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(parse_page, u): u for u in urls}
        done = 0
        for fut in concurrent.futures.as_completed(futs):
            r = fut.result()
            done += 1
            if r.get('error'):
                errors.append(r['source_url'])
                print(f'  [{done}/{len(urls)}] HATA: {r["source_url"]}')
            else:
                results.append(r)
                print(f'  [{done}/{len(urls)}] {r["title"][:40]:42} img={len(r["images"]):2} '
                      f'urun={len(r["products"])} ({", ".join(p["name"] for p in r["products"])})')

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(results, open(OUT, 'w', encoding='utf8'), ensure_ascii=False, indent=2)
    print(f'\n{len(results)} sayfa kazındı, {len(errors)} hata.')
    if errors:
        print('HATALI URL\'ler:')
        for e in errors:
            print(' ', e)
    print(f'Çıktı: {OUT}')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
