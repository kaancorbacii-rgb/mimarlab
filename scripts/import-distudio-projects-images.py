#!/usr/bin/env python3
"""diStudio Mimarlık 10 proje — GÖRSEL adımı (kullanıcı isteği, 2026-09-19).

scripts/import-distudio-projects.data.json'daki her proje için distudio.com.tr'deki TAM BOYUTLU
görselleri (thumb değil, `images/project/<ad>.jpg`) indirir, WebP'ye çevirir ve R2'ye
(`mimarlab-uploads`) yazar:

  <r2Prefix>/<slug>/<NN>.webp                         master (uzun kenar en fazla MAX_EDGE)
  _derived/w<400|800|1600>/r2/<r2Prefix>/<slug>/<NN>.webp   responsive türevler

Türev kuralları image-upload.js#prepareImage ile AYNI: asla büyütülmez, %10'dan az kazanç
sağlayan türev yazılmaz (yoksa /media/ yolu zaten orijinale düşer, bkz. upload.js#handleMediaRoute).
Saydam kaynaklar beyaz zemine yapıştırılır (import-archello-products.py#to_webp'teki 2026-09-04
siyah siluet hatası).

Yazım Cloudflare'ın R2 nesne REST ucuyla yapılır — wrangler'ın `r2 object put`'unun kullandığı
UÇ ile aynı (`/accounts/:id/r2/buckets/:bucket/objects/:key`, PUT), ama nesne başına bir wrangler
süreci başlatmadan. AI YOK; maliyet: ~470 R2 Class A yazımı + ~100 MB depolama (ücretsiz kota içinde).

Çıktı: --manifest dosyası {slug: ["/media/<anahtar>", ...]} — proje kayıt adımı
(scripts/import-distudio-projects.mjs) görselleri buradan okur. Varsayılan DRY-RUN: görseller
indirilip dönüştürülür ama R2'ye YAZILMAZ; yazmak için --apply.
"""

import argparse
import concurrent.futures
import io
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BUCKET = 'mimarlab-uploads'
MAX_EDGE = 2400
QUALITY = 85
DERIVATIVE_WIDTHS = (400, 800, 1600)
DERIVATIVE_QUALITY = 82
MIN_SAVING_RATIO = 0.90
MIN_SOURCE_BYTES = 40 * 1024
UA = 'Mozilla/5.0 (compatible; MIMARLAB-import/1.0; +https://mimarlab.com)'


def http_get(url, tries=4):
    for attempt in range(1, tries + 1):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        except Exception as e:  # ağ/5xx — birkaç kez daha dene
            if attempt == tries:
                raise
            time.sleep(1.5 * attempt)


def flatten(im):
    from PIL import Image
    if im.mode in ('RGBA', 'LA', 'PA') or (im.mode == 'P' and 'transparency' in im.info):
        rgba = im.convert('RGBA')
        bg = Image.new('RGB', rgba.size, (255, 255, 255))
        bg.paste(rgba, mask=rgba.split()[-1])
        return bg
    return im.convert('RGB')


def encode(im, width, quality):
    from PIL import Image
    w, h = im.size
    if width < w:
        im = im.resize((width, max(1, round(h * width / w))), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=quality, method=6)
    return buf.getvalue(), im.size


def prepare(raw):
    """(master_bytes, (w,h), {genişlik: bytes}) — image-upload.js#prepareImage'in Python karşılığı."""
    from PIL import Image, ImageOps
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(raw)))
    im = flatten(im)
    w, h = im.size
    scale = min(1.0, MAX_EDGE / max(w, h))
    box_w = max(1, round(w * scale))
    master, size = encode(im, box_w, QUALITY)
    derivatives = {}
    if len(master) >= MIN_SOURCE_BYTES:
        for step in DERIVATIVE_WIDTHS:
            if size[0] <= step:
                continue  # ASLA BÜYÜTME
            blob, _ = encode(im, step, DERIVATIVE_QUALITY)
            if len(blob) >= len(master) * MIN_SAVING_RATIO:
                continue  # KAZANÇ YOKSA YAZMA
            derivatives[step] = blob
    return master, size, derivatives


def r2_put(account, token, key, data, tries=5):
    url = f'https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/{BUCKET}/objects/{key}'
    for attempt in range(1, tries + 1):
        req = urllib.request.Request(url, data=data, method='PUT', headers={
            'Authorization': f'Bearer {token}',
            'Content-Type': 'image/webp',
        })
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                if 200 <= r.status < 300:
                    return
        except urllib.error.HTTPError as e:
            body = e.read()[:300]
            if attempt == tries or e.code in (400, 401, 403):
                raise RuntimeError(f'R2 PUT {key} -> HTTP {e.code}: {body!r}')
        except Exception:
            if attempt == tries:
                raise
        time.sleep(2 * attempt)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--manifest', default='import-distudio-manifest.json')
    ap.add_argument('--only', default='', help='virgüllü slug listesi')
    args = ap.parse_args()

    data = json.load(open(os.path.join(HERE, 'import-distudio-projects.data.json'), encoding='utf8'))
    only = {s.strip() for s in args.only.split(',') if s.strip()}
    account = (os.environ.get('CLOUDFLARE_ACCOUNT_ID') or '').strip()
    token = (os.environ.get('CLOUDFLARE_API_TOKEN') or '').strip()
    if args.apply and not (account and token):
        sys.exit('CLOUDFLARE_ACCOUNT_ID ve CLOUDFLARE_API_TOKEN gerekli (--apply).')
    print('MOD:', 'APPLY — R2\'ye yazılacak' if args.apply else 'DRY-RUN — R2\'ye yazılmayacak')

    jobs = []
    for p in data['projects']:
        if only and p['slug'] not in only:
            continue
        for i, name in enumerate(p['images'], 1):
            key = f"{data['r2Prefix']}/{p['slug']}/{i:02d}.webp"
            jobs.append((p['slug'], i, data['imageBase'] + name, key))

    stats = {'images': 0, 'objects': 0, 'bytes': 0, 'failed': []}

    def work(job):
        slug, i, src, key = job
        raw = http_get(src)
        master, size, derivatives = prepare(raw)
        objects = [(key, master)] + [(f'_derived/w{w}/r2/{key}', b) for w, b in derivatives.items()]
        if args.apply:
            for k, b in objects:
                r2_put(account, token, k, b)
        return slug, i, key, size, len(raw), objects

    manifest = {}
    with concurrent.futures.ThreadPoolExecutor(6) as ex:
        futs = {ex.submit(work, j): j for j in jobs}
        for fut in concurrent.futures.as_completed(futs):
            slug, i, src, key = futs[fut]
            try:
                slug, i, key, size, raw_len, objects = fut.result()
            except Exception as e:
                stats['failed'].append(f'{slug}#{i} {src}: {e}')
                print(f'  HATA {slug}#{i}: {e}', flush=True)
                continue
            manifest.setdefault(slug, {})[i] = f'/media/{key}'
            stats['images'] += 1
            stats['objects'] += len(objects)
            stats['bytes'] += sum(len(b) for _, b in objects)
            print(f'  {slug}#{i:02d} {size[0]}x{size[1]} kaynak {raw_len // 1024} KB -> master '
                  f'{len(objects[0][1]) // 1024} KB + {len(objects) - 1} türev', flush=True)

    ordered = {slug: [urls[i] for i in sorted(urls)] for slug, urls in manifest.items()}
    for p in data['projects']:
        if p['slug'] in ordered and len(ordered[p['slug']]) != len(p['images']):
            stats['failed'].append(f"{p['slug']}: {len(ordered[p['slug']])}/{len(p['images'])} görsel")
    with open(args.manifest, 'w', encoding='utf8') as f:
        json.dump(ordered, f, ensure_ascii=False, indent=2)
    print(f"\nÖZET: {stats['images']} görsel, {stats['objects']} R2 nesnesi, "
          f"{stats['bytes'] / 1048576:.1f} MB{'' if args.apply else ' (yazılmadı)'}; manifest -> {args.manifest}")
    if stats['failed']:
        print('BAŞARISIZ:\n  ' + '\n  '.join(stats['failed']))
        sys.exit(1)


if __name__ == '__main__':
    main()
