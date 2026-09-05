#!/usr/bin/env python3
"""Ersa Mobilya (ersamobilya.com) — 203 ürün sayfasının ham kazıması (2026-09-05).

Site WooCommerce/WordPress, tamamen sunucu taraflı render (bkz. curl ile 200 KB+ düz HTML —
Archello/BTDesign'ın aksine JS render GEREKMİYOR). BeautifulSoup ile ayrıştırılır.

Her sayfadan çekilenler:
  - title, designer ("by X" satırı), description (ilk text-editor paragrafı)
  - images: hero swiper + galeri sekmesindeki TÜM data-src-img (CDN orijinali, .webp EKİ DEĞİL —
    o eio (ewww) türevi, orijinal jpg/png en yüksek çözünürlük)
  - dims: "Boyutlar" sekmesindeki her "option" bloğu -> {label, W/D/H (+ olası ek alanlar)}
  - files: sayfadaki TÜM .pdf/.zip/.dwg/.rar bağlantıları (dedup)
  - variant_links: site'nin KENDİ "Varyantlar" carousel'indeki kardeş URL'ler (aile doğrulaması için)

Kullanım:
  python3 scripts/scrape-ersa.py [--limit N] [--workers 8]
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
OUT = os.path.join(HERE, 'output', 'ersa-raw.json')
URLS_FILE = os.path.join(HERE, 'output', 'ersa-urls.txt')

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

    title_el = soup.select_one('p.title.text-mine-shaft-950.text-\\[20px\\]') or soup.select_one('h1')
    title = (title_el.get_text(strip=True) if title_el else '') or slug_from_url(url)

    author_el = soup.select_one('p.author')
    designer = ''
    if author_el:
        designer = re.sub(r'^by\s+', '', author_el.get_text(strip=True), flags=re.I).strip()

    desc = ''
    for te in soup.select('.text-editor'):
        t = te.get_text(' ', strip=True)
        if t and 'Teknik dokümanlarda' not in t:
            desc = t
            break

    # Görseller: data-src-img (orijinal CDN dosyası) olan TÜM <img>, wp-content/uploads altında.
    # ersa-beyaz.png/ersa-siyah.png HER sayfada tekrar eden paylaşılan malzeme-rengi ikonlarıdır
    # (gerçek ürün fotoğrafı DEĞİL) — kapak görseli olarak seçilmesini önlemek için ATLANIR.
    #
    # GERÇEK BULGU (2026-09-05): "Malzemeler" sekmesindeki KUMAŞ/DÖŞEMELİK renk-doku örnekleri
    # (ör. "alpina-612.jpg", "KING-FLEX-9268.jpg", "Sealife-8532.jpg" — hepsi döşemelik kumaş
    # koleksiyon adları) da data-src-img taşıyor ve ürün fotoğrafıyla AYNI selector'a düşüyordu;
    # Terra'nın 93 data-src-img'inin 65'i bu kumaş örnekleriydi (kapak görseli riskiyle birlikte).
    # Bunların TEK ayırt edici işareti class='type-panels' taşıyan bir atadan gelmeleri (kumaş
    # ızgarası bu sarmalayıcının içinde render ediliyor, ana galeri/hero'nun DIŞINDA) — bu yüzden
    # her img için üst 10 seviye içinde 'type-panels' sınıfı arayıp o dalı ATLIYORUZ.
    def in_type_panels(tag):
        p = tag
        for _ in range(10):
            p = p.parent
            if p is None or getattr(p, 'name', None) is None:
                return False
            if 'type-panels' in (p.get('class') or []):
                return True
        return False

    def is_real_photo(src):
        if not src or 'wp-content/uploads' not in src:
            return False
        fname = src.rsplit('/', 1)[-1].lower()
        return not (fname.startswith('ersa-beyaz') or fname.startswith('ersa-siyah'))

    seen, images = set(), []
    for img in soup.select('img[data-src-img]'):
        src = img.get('data-src-img') or ''
        if not is_real_photo(src) or src in seen or in_type_panels(img):
            continue
        seen.add(src)
        images.append(src)
    # noscript fallback'leri de yakala (bazı bloklar data-src-img taşımayabilir)
    for tag in soup.select('img[src]'):
        src = tag.get('src') or ''
        if is_real_photo(src) and not src.startswith('data:') and src not in seen and not in_type_panels(tag):
            seen.add(src)
            images.append(src)

    # Boyutlar: her "option" bloğu (Yönetici Koltuğu, Konsol, 4'lü Boru Ayaklı ...)
    dims = []
    for opt in soup.select('.option'):
        title_div = opt.select_one('.title')
        sizes = opt.select('.sizes .item')
        if not title_div or not sizes:
            continue
        row = {'label': title_div.get_text(strip=True), 'values': []}
        for it in sizes:
            name = it.select_one('.name')
            val = it.select_one('.value')
            if name and val:
                row['values'].append({'name': name.get_text(strip=True), 'value': val.get_text(strip=True)})
        if row['values']:
            dims.append(row)

    # Dosyalar: sayfadaki TÜM pdf/zip/dwg/rar bağlantıları (dedup by URL).
    files = []
    fseen = set()
    for a in soup.select('a[href]'):
        href = a.get('href') or ''
        if re.search(r'\.(pdf|zip|dwg|rar|3dm|skp)$', href, re.I) and href not in fseen:
            fseen.add(href)
            name_el = a.select_one('.name')
            files.append({'url': href, 'label': name_el.get_text(strip=True) if name_el else ''})

    # Varyantlar carousel'i: sitenin kendi aile gruplaması (çapraz doğrulama için).
    variant_links = []
    vseen = set()
    for a in soup.select('.variant-carousel a[href]'):
        href = a.get('href') or ''
        if '/urun/' in href and href not in vseen:
            vseen.add(href)
            variant_links.append(href)

    return {
        'source_url': url,
        'slug': slug_from_url(url),
        'title': title,
        'designer': designer,
        'description': desc,
        'images': images,
        'dims': dims,
        'files': files,
        'variant_links': variant_links,
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
                      f'dim={len(r["dims"])} file={len(r["files"])} varyant={len(r["variant_links"])}')

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
