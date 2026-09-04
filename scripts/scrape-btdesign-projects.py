#!/usr/bin/env python3
"""bt.design/projeler/ referans projelerini kazır (77 proje) — çapraz etiketleme girdisi.

Her proje sayfasından çıkarılanlar:
  h1                                 → proje adı
  .fe-ul li (PROJE TİPİ/KONUM/…)     → tip, konum, İÇ TASARIM (ofis), MİMARİ, FOTOĞRAF
  .ems-prd-list-projects .ems-prd    → "Bu Projedeki Ürünler" — ürün sayfası bağlantıları

DİKKAT — sayfada ürün listesi İKİ yerde geçiyor: üstteki arama kutusunun "Önerilen Ürünler"
bloğu (her sayfada AYNI üç ürün: Ferno/Bonny/Roller) ve gerçek "Bu Projedeki Ürünler" ızgarası.
Yalnızca `.ems-prd-list-projects` kapsayıcısının İÇİ okunur; genel `.ems-prd` seçicisi
kullanılırsa her projeye aynı üç sahte ürün etiketlenirdi (Archello'nun "More products by"
tuzağının bu kaynaktaki karşılığı).

Çıktı: scripts/output/btdesign-projects.json
"""
import html as H
import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'output', 'btdesign-projects.json')
INDEX = 'https://bt.design/projeler/'
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0 Safari/537.36')


def get(url):
    p = subprocess.run(['curl', '-sL', '--compressed', '-A', UA, '--max-time', '60', url],
                       capture_output=True)
    return p.stdout.decode('utf8', 'replace') if p.returncode == 0 else ''


def txt(s):
    s = re.sub(r'(?s)<[^>]+>', ' ', s)
    return re.sub(r'\s+', ' ', H.unescape(s)).replace('\xa0', ' ').strip()


def parse_index(h):
    """Kart başına (url, ad, konum, tip) — detay sayfası açılamazsa yedek kaynak."""
    out = {}
    for m in re.finditer(
            r'(?is)<li class="slide[^"]*"[^>]*rel="([^"]*)"[^>]*data-uri="([^"]*)">\s*'
            r'<a href="(https://bt\.design/projeler/[^"]+/)"(.*?)</li>', h):
        rel, name, url, inner = m.group(1), H.unescape(m.group(2)), m.group(3), m.group(4)
        loc = re.search(r'(?is)<span class="font-5">(.*?)</span>', inner)
        out[url] = {'url': url, 'name': name.strip(), 'rel': rel,
                    'location_src': txt(loc.group(1)) if loc else ''}
    return out


def parse_detail(url, h):
    d = {'url': url}
    m = re.search(r'(?is)<div class="fe-tt">.*?<h1>(.*?)</h1>', h)
    d['name'] = txt(m.group(1)) if m else ''

    credits = {}
    block = re.search(r'(?is)<ul class="fe-ul">(.*?)</ul>', h)
    if block:
        for li in re.finditer(
                r'(?is)<span class="block fe-tml f-sBold">(.*?)</span>\s*'
                r'<span class="block fe-tdl">(.*?)</span>', block.group(1)):
            credits[txt(li.group(1))] = txt(li.group(2))
    d['credits'] = credits
    d['type'] = credits.get('PROJE TİPİ', '')
    d['location_src'] = credits.get('KONUM', '')
    d['office'] = credits.get('İÇ TASARIM', '') or credits.get('MİMARİ', '')
    d['photographer'] = credits.get('FOTOĞRAF', '')

    # "Bu Projedeki Ürünler" — YALNIZCA bu kapsayıcının içi (bkz. dosya başı uyarı).
    prods = []
    grid = re.search(r'(?is)<div class="ems-prd-list ems-prd-list-projects">(.*?)</ul>', h)
    if grid:
        for a in re.finditer(
                r'(?is)<div class="ems-prd-name">\s*<a href="(https://bt\.design/([^"/]+)\.html)"[^>]*>'
                r'(.*?)</a>', grid.group(1)):
            prods.append({'url': a.group(1), 'slug': a.group(2), 'name': txt(a.group(3))})
    d['products'] = prods

    # Konumdan şehir/ülke ayrıştırması ("Londra - İngiltere", "İstanbul - Türkiye")
    loc = d['location_src']
    if ' - ' in loc:
        d['city'], d['country'] = [p.strip() for p in loc.split(' - ', 1)]
    else:
        d['city'], d['country'] = loc.strip(), ''
    return d


def main():
    print(f'index: {INDEX}')
    idx = parse_index(get(INDEX))
    urls = sorted(idx)
    print(f'  {len(urls)} proje bağlantısı')

    rows = []
    for i, url in enumerate(urls, 1):
        h = get(url)
        if not h or len(h) < 5000:
            print(f'  [{i}/{len(urls)}] İNDİRİLEMEDİ {url}')
            rows.append({**idx[url], 'products': [], 'office': '', 'type': '', 'credits': {},
                         'city': '', 'country': '', 'photographer': ''})
            continue
        d = parse_detail(url, h)
        if not d['name']:
            d['name'] = idx[url]['name']
        if not d['location_src']:
            d['location_src'] = idx[url]['location_src']
        rows.append(d)
        print(f"  [{i}/{len(urls)}] {d['name'][:38]:40} {d['city'][:14]:16} "
              f"ofis={d['office'][:26]:28} ürün={len(d['products'])}")

    Path(OUT).parent.mkdir(parents=True, exist_ok=True)
    json.dump(rows, open(OUT, 'w', encoding='utf8'), ensure_ascii=False, indent=2)
    tr = sum(1 for r in rows if 'türkiye' in (r.get('country') or '').lower())
    print(f"\n{len(rows)} proje -> {OUT}")
    print(f"  Türkiye'de: {tr} / yurt dışı: {len(rows) - tr}")
    print(f"  ofis künyesi olan: {sum(1 for r in rows if r.get('office'))}")
    print(f"  ürün bağlantısı olan: {sum(1 for r in rows if r.get('products'))} "
          f"(toplam {sum(len(r.get('products') or []) for r in rows)} kenar)")


if __name__ == '__main__':
    sys.exit(main())
