#!/usr/bin/env python3
"""Archello proje sayfalarını kazır — `scripts/import-archello-projects.js`'in beslendiği ham veri.

Archello'ya özgü tuzaklar (2026-08-31 partisinde bulundu, bkz.
[[project_archello_import_2026_08_31]] — Arkitera parser'ı buraya UYMUYOR):

  * `urllib` tarayıcı UA'sıyla bile 403 alıyor → `curl` alt süreci ile çekilir.
  * Tam çözünürlük = thumbs URL'sinden query string'i TAMAMEN atmak. `?w=2400` daha büyük
    ama upscale edilmiş bir dosya döndürür; `/images/` (thumbs'sız) yolu 404'tür.
  * Açıklama gövdesi class-anchored regex ile SESSİZCE boş döner (sarmalayıcı div'in attribute
    sırası projeden projeye değişiyor) → index-slice kullanılır.
  * Galeri, görsellerin bir ALT KÜMESİ; hikâye gövdesindeki <figure> görselleri ek kareler
    içerir. İkisi de aynı ekin (attachment) sırasına işaret ettiğinden — galeride anchor
    href'i, gövdede img title'ı — tekilleştirme URL'e değil ek numarasına göre yapılır
    (aynı fotoğrafın iki bloktaki dosya adı/timestamp'i FARKLI, URL ile tekilleşmez).
  * Fotoğrafçı: "Project credits > Photographers" 37 projenin yalnızca 5'inde doluydu;
    gerçek kaynak galerideki <b class="image-author"> etiketi.

Kullanım:  python3 scripts/scrape-archello-projects.py --urls <dosya> --out <dosya.json>
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
    for attempt in range(tries):
        p = subprocess.run(['curl', '-sS', '-L', '--compressed', '-A', UA, '--max-time', '60', url],
                           capture_output=True)
        if p.returncode == 0 and len(p.stdout) > 5000:
            return p.stdout.decode('utf8', 'replace')
    return ''


def strip_tags(s: str) -> str:
    return html.unescape(re.sub(r'<[^>]+>', '', s)).strip()


def full_res(url: str) -> str:
    """Query string'i at — Archello'da tam çözünürlüklü orijinali bu verir."""
    return html.unescape(url).split('?')[0]


def parse_credits(h: str) -> dict:
    """'Project credits' bloğu: {rol: [{name, href}]}."""
    i = h.find('Project credits')
    if i < 0:
        return {}
    j = h.find('ah-project-sustainability', i)
    block = h[i:j if j > 0 else i + 6000]
    out = {}
    for m in re.finditer(r'__item-title">(.*?)</div>\s*<div class="ah-project-details__item-text">(.*?)</div>',
                         block, re.S):
        role = strip_tags(m.group(1))
        people = [{'name': strip_tags(a.group(2)), 'href': a.group(1)}
                  for a in re.finditer(r'<a href="([^"]*)"[^>]*>(.*?)</a>', m.group(2), re.S)]
        if not people:
            txt = strip_tags(m.group(2))
            people = [{'name': t.strip(), 'href': None} for t in txt.split(',') if t.strip()]
        if role and people:
            out.setdefault(role, []).extend(people)
    return out


def parse_data(h: str) -> dict:
    """'Project data' tanım listesi: {alan: metin}."""
    i = h.find('grid-product-detail-general')
    if i < 0:
        return {}
    block = h[i:h.find('</dl>', i)]
    out = {}
    for m in re.finditer(r'<dt>(.*?)</dt>\s*<dd>(.*?)</dd>', block, re.S):
        out[strip_tags(m.group(1))] = strip_tags(m.group(2)).replace(' | View Map', '').strip()
    return out


def parse_latlng(h: str):
    m = re.search(r'latitude=([\d.\-]+)&amp;longitude=([\d.\-]+)', h)
    return (float(m.group(1)), float(m.group(2))) if m else (None, None)


def parse_body(h: str):
    """Açıklama paragrafları + gövde içi <figure> görselleri (ek numarası ile).

    class-anchored regex DEĞİL index-slice: sarmalayıcı div'in attribute sırası değişken,
    regex 37/37 projede sessizce boş dönmüştü.
    """
    i = h.find('ah-project-story__body')
    if i < 0:
        return [], {}
    j = h.find('ah-project-story__gallery', i)
    block = h[i:j if j > 0 else i + 60000]

    paragraphs = []
    for m in re.finditer(r'<p[^>]*>(.*?)</p>', block, re.S):
        t = strip_tags(m.group(1)).replace('\xa0', ' ').strip()
        if t:
            paragraphs.append(t)

    figures = {}
    for m in re.finditer(r'<img[^>]*>', block):
        tag = m.group(0)
        src = re.search(r'\ssrc="([^"]+)"', tag)
        title = re.search(r'\stitle="([^"]*)"', tag)
        alt = re.search(r'\salt="([^"]*)"', tag)
        if not src or 'thumbs/images' not in src.group(1):
            continue
        idx = None
        if title:
            n = re.search(r'/photos-videos/(\d+)', title.group(1))
            if n:
                idx = int(n.group(1))
        author = None
        if alt and alt.group(1).startswith('photo_credit'):
            author = html.unescape(alt.group(1)[len('photo_credit'):]).strip()
        figures[idx if idx is not None else -len(figures) - 1] = {
            'url': full_res(src.group(1)), 'author': author,
        }
    return paragraphs, figures


def parse_gallery(h: str):
    """Galeri: ek numarası -> {url, author}. Sıra = ek numarası sırası."""
    i = h.find('ah-project-story__gallery')
    if i < 0:
        return {}
    block = h[i:]
    out = {}
    for m in re.finditer(r'<a class="image" href="([^"]*?)/photos-videos/(\d+)"(.*?)</a>', block, re.S):
        idx = int(m.group(2))
        inner = m.group(3)
        src = re.search(r'data-src="([^"]+)"', inner)
        if not src:
            continue
        author = re.search(r'image-author">(.*?)</b>', inner, re.S)
        out[idx] = {'url': full_res(src.group(1)),
                    'author': strip_tags(author.group(1)) if author else None}
    return out


def scrape(url: str) -> dict:
    h = fetch(url)
    if not h:
        return {'sourceUrl': url, 'error': 'fetch failed'}

    og_title = re.search(r'<meta property="og:title" content="([^"]*)"', h)
    og_desc = re.search(r'<meta property="og:description" content="([^"]*)"', h, re.S)
    title_raw = html.unescape(og_title.group(1)) if og_title else ''
    parts = [p.strip() for p in title_raw.split('|')]
    title_en = parts[0] if parts else ''
    office_en = parts[1] if len(parts) > 2 else ''

    paragraphs, figures = parse_body(h)
    gallery = parse_gallery(h)

    merged = dict(figures)
    for idx, item in gallery.items():
        if idx in merged:
            # Galeri URL'sini tercih et: gövdedeki <figure> varyantları eski bir yüklemeye işaret
            # edebiliyor ve 404 dönüyor (tol-a'da 7 görsel böyle kayboldu). İki blok da aynı ekin
            # farklı dosya adına/timestamp'ine işaret ettiğinden yalnızca biri canlı olabiliyor.
            merged[idx] = {'url': item['url'],
                           'author': item['author'] or merged[idx].get('author')}
        else:
            merged[idx] = item
    order = sorted(merged, key=lambda k: (k < 0, k))
    images = [{'index': k, **merged[k]} for k in order]

    credits = parse_credits(h)
    authors = [im['author'] for im in images if im.get('author')]
    photographer = max(set(authors), key=authors.count) if authors else None
    if not photographer and credits.get('Photographers'):
        photographer = credits['Photographers'][0]['name']

    lat, lng = parse_latlng(h)
    return {
        'sourceUrl': url,
        'archelloSlug': url.rstrip('/').split('/')[-1],
        'titleEn': title_en,
        'officeEn': office_en,
        'ogDescription': html.unescape(og_desc.group(1)).strip() if og_desc else '',
        'paragraphs': paragraphs,
        'credits': credits,
        'data': parse_data(h),
        'lat': lat, 'lng': lng,
        'photographer': photographer,
        'images': images,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--urls', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--workers', type=int, default=6)
    a = ap.parse_args()

    urls = [ln.strip() for ln in open(a.urls, encoding='utf8') if ln.strip().startswith('http')]
    print(f'{len(urls)} URL kazınacak', file=sys.stderr)
    with concurrent.futures.ThreadPoolExecutor(a.workers) as ex:
        results = list(ex.map(scrape, urls))
    for r in results:
        status = r.get('error') or f"{len(r['images'])} görsel, {len(r['paragraphs'])} paragraf"
        print(f"  {r.get('titleEn') or r['sourceUrl']}: {status}", file=sys.stderr)
    json.dump(results, open(a.out, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print(f"-> {a.out}", file=sys.stderr)


if __name__ == '__main__':
    main()
