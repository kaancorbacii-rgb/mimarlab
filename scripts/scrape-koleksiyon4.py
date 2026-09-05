#!/usr/bin/env python3
"""82 Koleksiyon URL-lik dördüncü parti (masa/sehpa/depolama/yatak odası/bölücü/dış mekan) kazıyıcı.

scrape-koleksiyon2.py'nin birebir eşi: `parse_koleksiyon` (RSC flight ayrıştırıcı)
scrape-batch67.py'den MODÜL OLARAK import edilir, gruplama koleksiyon4-groups.py'dedir.

Çıktı: scripts/output/koleksiyon4-raw.json — {url: parsed_dict}. Aile birleştirme BURADA
YAPILMAZ (koleksiyon4-build-payload.py'nin işi).

Kullanım: python3 scripts/scrape-koleksiyon4.py
"""
import concurrent.futures
import importlib.util as _ilu
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

_spec = _ilu.spec_from_file_location('scrape_batch67', os.path.join(HERE, 'scrape-batch67.py'))
b67 = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(b67)

_gspec = _ilu.spec_from_file_location('koleksiyon4_groups', os.path.join(HERE, 'koleksiyon4-groups.py'))
groups = _ilu.module_from_spec(_gspec)
_gspec.loader.exec_module(groups)

OUT = os.path.join(HERE, 'output', 'koleksiyon4-raw.json')


def scrape_one(url):
    try:
        h = b67.fetch(url)
    except Exception as e:
        return url, {'error': str(e)}
    try:
        return url, b67.parse_koleksiyon(url, h)
    except Exception as e:
        return url, {'error': f'parse: {e}'}


def main():
    urls = groups.ALL_URLS
    print(f'{len(urls)} URL kazınacak...')
    results = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
        futs = {ex.submit(scrape_one, u): u for u in urls}
        done = 0
        for fut in concurrent.futures.as_completed(futs):
            url, d = fut.result()
            results[url] = d
            done += 1
            status = 'HATA: ' + d['error'] if 'error' in d else \
                (f"ok title={d.get('title_src')!r} imgs={len(d.get('images') or [])} "
                 f"mod={len(d.get('kol_variants') or [])} dsn={d.get('designer')!r}")
            print(f'[{done}/{len(urls)}] {url.rsplit("/urunler/", 1)[-1]}\n    {status}')

    json.dump(results, open(OUT, 'w', encoding='utf8'), ensure_ascii=False, indent=2)
    errs = [u for u, d in results.items() if 'error' in d]
    print(f'\nBitti. {len(results)} sonuç -> {OUT}')
    if errs:
        print(f'HATALI ({len(errs)}):')
        for u in errs:
            print(f'  {u}: {results[u]["error"]}')
    noimg = [u for u, d in results.items() if 'error' not in d and not d.get('images')]
    if noimg:
        print(f'GÖRSELSİZ ({len(noimg)}):')
        for u in noimg:
            print(f'  {u}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
