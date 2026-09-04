#!/usr/bin/env python3
"""bt.design proje sayfalarından GERÇEK galeri görsellerini (kapak swiper'ı + detay galerisi)
çıkarır. "Bu Projedeki Ürünler" simge PNG'leri ve "İlgili Projeler" önerisi decoy'ları HARİÇ
tutulur (bkz. scrape-btdesign-projects.py'nin ürün sayfası decoy notuyla aynı desen).

Yapı (2026-09-04'te 43-proje partisi için canlı sayfadan doğrulandı):
  1. Kapak: <div class="cover-dtl static"> ... (data-swiper="main3" başlamadan önce) içinde
     hide_on_mobile img'leri (timthumb.php?src=uploads/projeler/... sarmalı).
  2. Detay galerisi: <... data-swiper="main3" ...> ... </ul> içinde düz <img src="uploads/
     projeler/...">; ARADA banner reklamı (assets/images/UPLOAD/BANNERS/...) sıkışmış, hariç.
  "İlgili Projeler" şeridi <picture><source ...> yapısı kullanır, yukarıdaki iki bölgenin
  DIŞINDA kalır — ayrıca filtrelemeye gerek yok.

Kullanım:
  python3 scripts/scrape-btdesign-project-images.py --slugs a,b,c --out output/btdesign-images.json
"""
import argparse
import json
import re
import subprocess
import sys

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')


def fetch(url, tries=3):
    for _ in range(tries):
        p = subprocess.run(['curl', '-sS', '-L', '-A', UA, '--max-time', '30', url],
                          capture_output=True)
        if p.returncode == 0 and len(p.stdout) > 2000:
            return p.stdout.decode('utf8', errors='ignore')
    return ''


def extract_images(html):
    urls = []
    seen_ids = set()

    def add(u):
        u = u.split('?')[0].split('&')[0]
        if not u.startswith('http'):
            u = 'https://bt.design/' + u.lstrip('/')
        # aynı fotoğrafın masaüstü/mobil kırpması genelde aynı sayısal-id son ekini paylaşır
        # (ör. ..._01-13276.jpg / ..._01m-13276.jpg) — ilk görüleni tut, kırpma varyantını atla.
        m = re.search(r'-(\d+)\.\w+$', u)
        ident = m.group(1) if m else u
        if ident not in seen_ids:
            seen_ids.add(ident)
            urls.append(u)

    # "widgetAuto" swiper adı iki AYRI yerde tekrar kullanılıyor (hem küçük "Bu Projedeki
    # Ürünler" ikon şeridinde HEM DE sayfa sonundaki "Diğer ... Projeleri" öneri şeridinde) —
    # bölge sınırı olarak GÜVENİLMEZ. Bunun yerine kapak bölgesinde YALNIZCA gerçek galeri
    # markup'ının iki bilinen somut kalıbını arıyoruz; decoy'lar bu kalıplara denk gelmiyor,
    # bölge main3'e (veya sayfa sonuna) kadar geniş tutulsa bile güvenli.
    m3 = re.search(r'data-swiper="main3".*?</ul>', html, re.S)
    cover_end = m3.start() if m3 else len(html)
    cover_start = html.find('cover-dtl static')
    if cover_start != -1 and cover_start < cover_end:
        region = html[cover_start:cover_end]
        # varyant A: <img class="hide_on_mobile" src="...timthumb.php?src=uploads/projeler/X.jpg">
        for m in re.finditer(r'<img class="hide_on_mobile"\s+src="[^"]*src=([^"&]+)', region):
            add(m.group(1))
        # varyant B: <div class="cover-bt-inr cover hide_on_mobile" ...><img src="uploads/...">
        for m in re.finditer(
                r'<div class="cover-bt-inr cover hide_on_mobile"[^>]*>\s*<img src="([^"]+)"', region):
            add(m.group(1))

    if m3:
        block = m3.group(0)
        for m in re.finditer(r'<img src="([^"]+)"', block):
            u = m.group(1)
            if '/uploads/projeler/' in u and '/BANNERS/' not in u:
                add(u)

    return urls


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--slugs', required=True, help='virgülle ayrılmış proje url-slug listesi')
    ap.add_argument('--out', required=True)
    args = ap.parse_args()

    slugs = args.slugs.split(',')
    result = {}
    for i, slug in enumerate(slugs, 1):
        url = f'https://bt.design/projeler/{slug}/'
        html = fetch(url)
        if not html:
            print(f'[{i}/{len(slugs)}] {slug}: FETCH FAILED', file=sys.stderr)
            result[slug] = {'url': url, 'images': [], 'error': 'fetch_failed'}
            continue
        imgs = extract_images(html)
        print(f'[{i}/{len(slugs)}] {slug}: {len(imgs)} görsel', file=sys.stderr)
        result[slug] = {'url': url, 'images': imgs}

    json.dump(result, open(args.out, 'w'), indent=2, ensure_ascii=False)
    print(f'yazıldı: {args.out}', file=sys.stderr)


if __name__ == '__main__':
    main()
