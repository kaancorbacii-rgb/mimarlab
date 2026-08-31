#!/usr/bin/env python3
"""Archello görsellerini tam çözünürlükte indirip webp'e çevirir + teknik çizim metrikleri üretir.

`scripts/scrape-archello-projects.py` çıktısındaki mutlak URL'ler ZATEN query'siz (tam boy).
İndirmede de tarayıcı UA'sı şart — Archello aksi halde 403 döner.

Teknik çizim (plan/kesit/görünüş/aksonometri/pafta) tespiti için her görselden ucuz metrikler
çıkarılır; sınıflandırmanın kendisi değil, YALNIZCA aday listesi üretilir (kesin karar kontakt
sayfası üzerinden gözle verilir — bkz. [[project_archello_import_2026_08_31]]):
  white  : neredeyse beyaz piksel oranı (çizimlerde yüksek)
  sat    : ortalama doygunluk (çizimlerde düşük)
  colors : 32-kovalı renk histogramında baskın olmayan kova oranı

Kullanım:
  python3 scripts/fetch-archello-images.py --manifest <manifest.json> --outdir <dizin>
"""

import argparse
import concurrent.futures
import io
import json
import os
import subprocess

from PIL import Image, ImageStat

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')
MAX_DIM = 2400
QUALITY = 82


def download(url: str, tries: int = 3) -> bytes:
    for _ in range(tries):
        p = subprocess.run(['curl', '-sS', '-L', '--compressed', '-A', UA, '--max-time', '120', url],
                           capture_output=True)
        if p.returncode == 0 and len(p.stdout) > 2000:
            return p.stdout
    return b''


def metrics(im: Image.Image) -> dict:
    small = im.convert('RGB').resize((160, 160))
    hsv = small.convert('HSV')
    sat = ImageStat.Stat(hsv.split()[1]).mean[0]
    px = list(small.getdata())
    white = sum(1 for r, g, b in px if r > 235 and g > 235 and b > 235) / len(px)
    buckets = {}
    for r, g, b in px:
        buckets[(r >> 5, g >> 5, b >> 5)] = buckets.get((r >> 5, g >> 5, b >> 5), 0) + 1
    top = max(buckets.values()) / len(px)
    return {'white': round(white, 3), 'sat': round(sat, 1), 'top': round(top, 3),
            'w': im.width, 'h': im.height}


def handle(job: dict) -> dict:
    out = job['path']
    if os.path.exists(out) and os.path.getsize(out) > 3000:
        with Image.open(out) as im:
            return {**job, 'ok': True, **metrics(im), 'bytes': os.path.getsize(out)}
    raw = download(job['url'])
    if not raw:
        return {**job, 'ok': False, 'error': 'download'}
    try:
        im = Image.open(io.BytesIO(raw))
        im.load()
    except Exception as e:  # bozuk/eksik dosya
        return {**job, 'ok': False, 'error': f'decode: {e}'}
    if im.mode not in ('RGB', 'L'):
        im = im.convert('RGB')
    m = metrics(im)
    if max(im.size) > MAX_DIM:
        im.thumbnail((MAX_DIM, MAX_DIM), Image.LANCZOS)
    im.save(out, 'WEBP', quality=QUALITY, method=5)
    return {**job, 'ok': True, **m, 'bytes': os.path.getsize(out)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--manifest', required=True)
    ap.add_argument('--outdir', required=True)
    ap.add_argument('--workers', type=int, default=8)
    a = ap.parse_args()
    os.makedirs(a.outdir, exist_ok=True)

    projects = json.load(open(a.manifest, encoding='utf8'))
    jobs = []
    for p in projects:
        for n, im in enumerate(p['images'], 1):
            jobs.append({'slug': p['slug'], 'n': n, 'url': im['url'],
                         'path': os.path.join(a.outdir, f"{p['slug']}-{n}.webp")})
    print(f'{len(jobs)} görsel indirilecek')

    done = []
    with concurrent.futures.ThreadPoolExecutor(a.workers) as ex:
        for i, r in enumerate(ex.map(handle, jobs), 1):
            done.append(r)
            if i % 100 == 0:
                print(f'  {i}/{len(jobs)}', flush=True)
    fails = [r for r in done if not r['ok']]
    print(f'bitti: {len(done) - len(fails)} başarılı, {len(fails)} hata')
    for f in fails:
        print('  HATA', f['slug'], f['n'], f.get('error'), f['url'])
    json.dump(done, open(os.path.join(a.outdir, '_metrics.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
