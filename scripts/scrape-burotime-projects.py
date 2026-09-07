#!/usr/bin/env python3
"""Bürotime referans projeleri (burotime.com/kurumsal/projeler) — liste + 213 detay sayfası.

Neden HEPSİ taranıyor: koleksiyon4 turunda "proje sayfalarında ürün listesi yok" sonucu YALNIZCA
dört sayfaya bakılarak çıkarılmış ve YANLIŞ çıkmıştı (bkz. proje notu "ÖRNEKLEM HATASI"). Burada
213 sayfanın TAMAMI taranır ve bulunan/bulunmayan ayrı ayrı raporlanır.

Her detay sayfasından çıkanlar (hepsi RSC flight prop nesnelerinden, bkz. scrape-burotime.py):
  - `header.projectName` + `header.items` -> ["Çanakkale, 2018", "Mimari Proje: Yalın Mimarlık",
    "Fotoğraf: Mehmed Arda"] — KONUM, YIL, MİMARLIK OFİSİ ve FOTOĞRAFÇI. Eşleştirme kanıtı bu
    satırlardır; ad benzerliği TEK BAŞINA yeterli sayılmaz.
  - `text` -> proje tanıtım metni
  - `slides[]` -> proje galerisi (hotspot yerleştirmede kullanılacak kaynak görseller)
  - "Kullanılan Ürünler" bloğu (`title` + `initialItems`) -> projede kullanılan ÜRÜN SLUG'LARI.
    Blok `pageSize: 12` ile sayfalanıyor; 12'den fazlası varsa `initialPagination` sayısı da
    kaydedilir ki eksik olduğu raporda görünsün.

Çıktı: scripts/output/burotime-projects.json
Kullanım: python3 scripts/scrape-burotime-projects.py [--workers 5]
"""
import argparse
import concurrent.futures
import importlib.util as _ilu
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = _ilu.spec_from_file_location('scrape_burotime', os.path.join(HERE, 'scrape-burotime.py'))
bt = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(bt)

LIST_URL = 'https://www.burotime.com/kurumsal/projeler'
BASE = 'https://www.burotime.com'
CACHE = os.path.join(HERE, 'output', 'burotime-project-html')
OUT = os.path.join(HERE, 'output', 'burotime-projects.json')


def cached(url, name):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name + '.html')
    if os.path.exists(path) and os.path.getsize(path) > 20000:
        return open(path, encoding='utf8', errors='replace').read()
    h = bt.fetch(url)
    open(path, 'w', encoding='utf8').write(h)
    return h


def parse_list(h):
    buf = bt.flight(h)
    for p in bt.component_props(buf):
        if set(p.keys()) == {'cards', 'className', 'facets'}:
            return p
    raise RuntimeError('proje kartları bulunamadı')


def parse_detail(url, h):
    buf = bt.flight(h)
    lazy = bt.lazy_chunks(buf)
    d = {'source_url': url, 'slug': url.rstrip('/').rsplit('/', 1)[-1]}
    header = text = slides = used = None
    for p in bt.component_props(buf):
        ks = set(p.keys())
        if header is None and 'header' in ks and isinstance(p.get('header'), dict) \
                and 'projectName' in p['header']:
            header = p['header']
        elif text is None and {'highlightedTitle', 'text'} <= ks:
            text = p
        elif slides is None and 'slides' in ks:
            slides = p
        elif used is None and 'initialItems' in ks and 'scope' in ks:
            used = p

    header = header or {}
    d['title'] = (header.get('projectName') or '').strip()
    d['header_items'] = [x for x in (header.get('items') or []) if x]
    d['description'] = bt.txt(bt.deref((text or {}).get('text'), lazy))
    d['highlighted_title'] = (text or {}).get('highlightedTitle')
    d['images'] = [s['desktopImageUrl'] for s in ((slides or {}).get('slides') or [])
                   if isinstance(s, dict) and s.get('desktopImageUrl')]
    if header.get('desktopImageUrl'):
        d['images'] = list(dict.fromkeys([header['desktopImageUrl']] + d['images']))
    d['products'] = [{'slug': x['slug'], 'name': x.get('name')}
                     for x in ((used or {}).get('initialItems') or [])
                     if isinstance(x, dict) and x.get('slug')]
    pag = (used or {}).get('initialPagination') or {}
    d['products_total'] = pag.get('total') if isinstance(pag, dict) else None

    # header_items ayrıştırması — "Çanakkale, 2018" / "Mimari Proje: X" / "Fotoğraf: Y"
    d['location'], d['year'], d['architect'], d['photographer'] = None, None, None, None
    for it in d['header_items']:
        m = re.match(r'^\s*Mimari Proje\s*:\s*(.+)$', it, re.I)
        if m:
            d['architect'] = m.group(1).strip()
            continue
        m = re.match(r'^\s*Fotoğraf\s*:\s*(.+)$', it, re.I)
        if m:
            d['photographer'] = m.group(1).strip()
            continue
        m = re.match(r'^\s*(.+?)\s*,\s*((?:19|20)\d{2})\s*$', it)
        if m:
            d['location'], d['year'] = m.group(1).strip(), m.group(2)
        elif re.fullmatch(r'\s*((?:19|20)\d{2})\s*', it):
            d['year'] = it.strip()
        elif not d['location']:
            d['location'] = it.strip()
    return d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--workers', type=int, default=5)
    args = ap.parse_args()

    cards = parse_list(cached(LIST_URL, '_list'))['cards']
    print(f'{len(cards)} referans proje listelendi.')

    def one(c):
        url = BASE + c['link']
        try:
            return parse_detail(url, cached(url, c['link'].rstrip('/').rsplit('/', 1)[-1]))
        except Exception as e:
            return {'source_url': url, 'title': c['title'], 'error': str(e)}

    out, done = [], 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
        for d in ex.map(one, cards):
            done += 1
            out.append(d)
            if 'error' in d:
                print(f'[{done}/{len(cards)}] {d["title"][:32]:34} HATA: {d["error"]}')
            else:
                print(f'[{done}/{len(cards)}] {d["title"][:32]:34} '
                      f'{str(d["location"])[:16]:18} {str(d["year"]):6} '
                      f'urun={len(d["products"]):2}/{d["products_total"]} '
                      f'gorsel={len(d["images"]):2} mimar={str(d["architect"])[:24]}')

    json.dump(out, open(OUT, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    withp = [d for d in out if d.get('products')]
    print(f'\n{len(out)} proje -> {OUT}')
    print(f'ÜRÜN LİSTESİ OLAN: {len(withp)}/{len(out)} '
          f'(toplam {sum(len(d["products"]) for d in withp)} ürün bağlantısı)')
    trunc = [d for d in withp if (d.get('products_total') or 0) > len(d['products'])]
    if trunc:
        print(f'SAYFALANMIŞ (12+ ürün, eksik): ' + ', '.join(
            f'{d["title"]}({len(d["products"])}/{d["products_total"]})' for d in trunc))
    return 0


if __name__ == '__main__':
    sys.exit(main())
