#!/usr/bin/env python3
"""scripts/output/btdesign-project-images.json'daki gerçek proje fotoğraflarını indirip
webp'e çevirir (bkz. fetch-archello-images.py ile aynı desen: tam çözünürlük, MAX_DIM/QUALITY).

Çıktı: <outdir>/<proje-slug>-<n>.webp + <outdir>/manifest.json
  {proje-slug: [{n, local_path, src_url}]}

Kullanım:
  python3 scripts/fetch-btdesign-project-images.py --slugs a,b,c --outdir <dizin>
"""
import argparse
import concurrent.futures
import io
import json
import os
import subprocess

from PIL import Image

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')
MAX_DIM = 2400
QUALITY = 82


def download(url, tries=3):
    for _ in range(tries):
        p = subprocess.run(['curl', '-sS', '-L', '--compressed', '-A', UA, '--max-time', '60', url],
                          capture_output=True)
        if p.returncode == 0 and len(p.stdout) > 2000:
            return p.stdout
    return b''


def handle(job):
    out = job['path']
    if os.path.exists(out) and os.path.getsize(out) > 3000:
        return {**job, 'ok': True, 'bytes': os.path.getsize(out), 'cached': True}
    data = download(job['url'])
    if not data:
        return {**job, 'ok': False, 'error': 'download_failed'}
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
    except Exception as e:
        return {**job, 'ok': False, 'error': f'decode_failed: {e}'}
    im = im.convert('RGB')
    if max(im.width, im.height) > MAX_DIM:
        ratio = MAX_DIM / max(im.width, im.height)
        im = im.resize((max(1, int(im.width * ratio)), max(1, int(im.height * ratio))), Image.LANCZOS)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    im.save(out, 'WEBP', quality=QUALITY)
    return {**job, 'ok': True, 'bytes': os.path.getsize(out)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--images-json', default='scripts/output/btdesign-project-images.json')
    ap.add_argument('--slugs', required=True)
    ap.add_argument('--outdir', required=True)
    ap.add_argument('--slug-map', default=None,
                    help='JSON {url-slug: mimarlab-slug} — proje slug adı bt.design url slug'
                         "'ından farklıysa (yeni açılan projeler için)")
    args = ap.parse_args()

    images = json.load(open(args.images_json))
    slug_map = json.load(open(args.slug_map)) if args.slug_map else {}
    slugs = args.slugs.split(',')

    jobs = []
    for s in slugs:
        entry = images.get(s)
        if not entry or not entry.get('images'):
            print(f'  ! {s}: görsel yok, atlandı')
            continue
        out_slug = slug_map.get(s, s)
        for n, url in enumerate(entry['images'], 1):
            jobs.append({'proj': s, 'out_slug': out_slug, 'n': n, 'url': url,
                        'path': os.path.join(args.outdir, f'{out_slug}-{n}.webp')})

    print(f'{len(jobs)} görsel indirilecek ({len(slugs)} proje)')
    manifest = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        for i, res in enumerate(ex.map(handle, jobs), 1):
            manifest.setdefault(res['proj'], []).append(res)
            status = 'OK' if res['ok'] else f"FAIL {res.get('error')}"
            if i % 20 == 0 or not res['ok']:
                print(f'  [{i}/{len(jobs)}] {res["proj"]}-{res["n"]}: {status}')

    fails = [r for rs in manifest.values() for r in rs if not r['ok']]
    print(f'bitti: {len(jobs)-len(fails)} ok, {len(fails)} hata')
    for f in fails:
        print('  FAIL', f['proj'], f['n'], f.get('error'))

    os.makedirs(args.outdir, exist_ok=True)
    json.dump(manifest, open(os.path.join(args.outdir, 'manifest.json'), 'w'), indent=2, ensure_ascii=False)


if __name__ == '__main__':
    main()
