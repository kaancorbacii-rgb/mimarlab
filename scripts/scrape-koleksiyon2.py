#!/usr/bin/env python3
"""63 Koleksiyon URL'lik ikinci parti (koltuk/sandalye/çalışma sandalyesi/tabure) kazıyıcı.

scrape-batch67.py'deki `parse_koleksiyon` (RSC flight ayrıştırıcı) MODÜL OLARAK import edilir —
Koleksiyon Next.js şeması aynı, tekrar yazmaya gerek yok. Gruplama scripts/koleksiyon2-groups.py'de.

Çıktı: scripts/output/koleksiyon2-raw.json — {url: parsed_dict}. Aile birleştirme BURADA
YAPILMAZ (koleksiyon2-build-payload.py'nin işi).

Kullanım: python3 scripts/scrape-koleksiyon2.py
"""
import concurrent.futures
import importlib.util as _ilu
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))

_spec = _ilu.spec_from_file_location('scrape_batch67', os.path.join(HERE, 'scrape-batch67.py'))
b67 = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(b67)

_gspec = _ilu.spec_from_file_location('koleksiyon2_groups', os.path.join(HERE, 'koleksiyon2-groups.py'))
groups = _ilu.module_from_spec(_gspec)
_gspec.loader.exec_module(groups)

OUT = os.path.join(HERE, 'output', 'koleksiyon2-raw.json')


def scrape_one(url):
    try:
        h = b67.fetch(url)
    except Exception as e:
        return url, {'error': str(e)}
    try:
        d = b67.parse_koleksiyon(url, h)
        return url, d
    except Exception as e:
        return url, {'error': f'parse: {e}'}


def main():
    urls = groups.ALL_URLS
    print(f'{len(urls)} URL kazınacak...')
    results = {}
    # Nazik hız: 3 eşzamanlı istek, batchler arası kısa bekleme.
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
        futs = {ex.submit(scrape_one, u): u for u in urls}
        done = 0
        for fut in concurrent.futures.as_completed(futs):
            url, d = fut.result()
            results[url] = d
            done += 1
            status = 'HATA: ' + d['error'] if 'error' in d else \
                f"ok title={d.get('title_src')!r} imgs={len(d.get('images') or [])} variants={len(d.get('kol_variants') or [])}"
            print(f'[{done}/{len(urls)}] {url}\n    {status}')

    json.dump(results, open(OUT, 'w', encoding='utf8'), ensure_ascii=False, indent=2)
    errs = [u for u, d in results.items() if 'error' in d]
    print(f'\nBitti. {len(results)} sonuç -> {OUT}')
    if errs:
        print(f'HATALI ({len(errs)}):')
        for u in errs:
            print(f'  {u}: {results[u]["error"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
