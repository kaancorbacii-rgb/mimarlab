#!/usr/bin/env python3
"""Archello proje sayfalarının "Product spec sheet" tablosunu kazır — MARKA ↔ PROJE kenarlarının
ham kaynağı (bkz. `scripts/import-archello-brands.js`).

NEDEN AYRI BİR KAZIYICI: Archello marka sayfası "bu markanın ürünleri şu projelerde kullanıldı"
listesini verir ama HANGİ ürün/eleman olduğunu SÖYLEMEZ. Eleman adı yalnızca projenin kendi
sayfasındaki spec sheet tablosunda var ("Sanitary Elements → VitrA Bathrooms"). Kenarları proje
tarafından toplamak ayrıca çok daha ucuz: MİMARLAB'da zaten var olan 256 Archello projesi tek tek
gezilir, marka başına 143 sayfalık liste gezmeye gerek kalmaz.

Archello'ya özgü tuzaklar:

  * Proje sayfasındaki gömülü spec listesi KIRPILMIŞ (IzQ: 6 satır) — tam tablo ayrı bir
    "attachment" sayfasındadır (`/story/<id>/attachments/product-spec-sheet`, IzQ: 10 satır).
    Yalnızca gömülü listeye bakmak kenarların ~%40'ını sessizce kaybeder.
  * `ah-project-details__item` class'ı spec sheet'e ÖZEL DEĞİL; "Project credits" bloğu da aynı
    class'ı kullanır (bkz. scrape-archello-projects.py#parse_credits). Bu yüzden gömülü liste
    ayrıştırılırken başlıktan sonraki dilime kırpılır.
  * Attachment tablosunun 3. sütunu ("Specified By") da /brand/ linkleri içerir — bunlar o
    elemanın markası DEĞİL, aynı markayı kullanmış BAŞKA mimarlardır. Yalnızca 2. sütun
    (`<td>` içindeki `a.link`) markadır; 3. sütun alınırsa her projeye onlarca yanlış marka bağlanır.

Kullanım:
  python3 scripts/scrape-archello-project-specs.py --projects <ml-projects.json> --out <out.json>

`--projects` şekli: [{id, slug, title, source_url}]  (D1'den: `SELECT id,slug,title,source_url
FROM projects WHERE deleted_at IS NULL AND source_url LIKE '%archello.com/project/%'`)
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
    for _ in range(tries):
        p = subprocess.run(['curl', '-sS', '-L', '--compressed', '-A', UA, '--max-time', '60', url],
                           capture_output=True)
        if p.returncode == 0 and len(p.stdout) > 3000:
            return p.stdout.decode('utf8', 'replace')
    return ''


def strip_tags(s: str) -> str:
    return html.unescape(re.sub(r'<[^>]+>', ' ', s)).strip()


def parse_inline_specs(h: str) -> list:
    """Proje sayfasına gömülü (kırpılmış) spec listesi — attachment sayfası yoksa yedek."""
    i = h.find('Product spec sheet')
    if i < 0:
        return []
    j = h.find('ah-project-details__button', i)
    seg = h[i:j if j > 0 else i + 8000]
    out = []
    for m in re.finditer(
            r'__item-title">(.*?)</div>\s*<div class="ah-project-details__item-text">(.*?)</div>',
            seg, re.S):
        element = strip_tags(m.group(1))
        a = re.search(r'href="/brand/([^"?#]+)"[^>]*>(.*?)</a>', m.group(2), re.S)
        if element and a:
            out.append({'element': element, 'brandSlug': a.group(1), 'brandName': strip_tags(a.group(2))})
    return out


def parse_attachment_specs(h: str) -> list:
    """Tam spec tablosu — yalnızca 2. sütun (marka) okunur, 3. sütun ("Specified By") ATLANIR."""
    i = h.find('ah-project-attachment-specs__table')
    if i < 0:
        return []
    body = h[h.find('<tbody', i):h.find('</table>', i)]
    out = []
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', body, re.S):
        tds = re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)
        if len(tds) < 2:
            continue
        element = strip_tags(tds[0])
        a = re.search(r'href="/brand/([^"?#]+)"[^>]*>(.*?)</a>', tds[1], re.S)
        if element and a:
            out.append({'element': element, 'brandSlug': a.group(1), 'brandName': strip_tags(a.group(2))})
    return out


def dedupe(specs: list) -> list:
    seen, out = set(), []
    for s in specs:
        k = (s['brandSlug'], s['element'].lower())
        if k not in seen:
            seen.add(k)
            out.append(s)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--projects', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--workers', type=int, default=4)
    args = ap.parse_args()

    projects = json.load(open(args.projects, encoding='utf8'))

    def work(p):
        ah_slug = p['source_url'].rstrip('/').rsplit('/', 1)[-1].split('?')[0]
        h = fetch(f'https://archello.com/project/{ah_slug}')
        if not h:
            print(f'  ! FETCH FAIL {ah_slug}', file=sys.stderr)
            return {**p, 'archelloSlug': ah_slug, 'specs': [], 'error': 'fetch failed'}
        specs = parse_inline_specs(h)
        # Tam tabloyu dene — gömülü liste kırpılmış olabilir (bkz. dosya başı notu).
        m = re.search(r'href="(/story/\d+/attachments/product-spec-sheet)"', h)
        if m:
            hh = fetch(f'https://archello.com{m.group(1)}')
            if hh:
                full = parse_attachment_specs(hh)
                if len(full) >= len(specs):
                    specs = full
        specs = dedupe(specs)
        print(f'  {ah_slug} — {len(specs)} spec', file=sys.stderr)
        return {**p, 'archelloSlug': ah_slug, 'specs': specs}

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
        out = list(ex.map(work, projects))

    json.dump(out, open(args.out, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    n = sum(len(r['specs']) for r in out)
    print(f'{len(out)} proje, {n} spec satırı → {args.out}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
