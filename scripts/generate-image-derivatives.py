#!/usr/bin/env python3
"""R2'ye önceden üretilmiş responsive görsel türevleri yazar (ücretli Image Transform YERİNE).

NEDEN: 2026-08-22'de Cloudflare "Images Transformed" faturalandırması (~$16/ay) yüzünden serve-time
resize kapatıldı (bkz. image-cdn.js dosya başı). O tarihten beri sitedeki her görsel tam
çözünürlükte iniyordu — ana sayfanın LCP görseli 2400 px / 640 KB, 760 CSS px'lik bir slot için.
Bu script aynı sonucu TEK SEFERLİK bir maliyetle (yalnızca R2 depolama) üretir.

ÇIKTI ANAHTARLARI (bkz. image-cdn.js#derivativeUrl, src/routes/upload.js#DERIVED_KEY_RE):
    _derived/w<genişlik>/r2/<r2-anahtarı>     kaynak bir R2 nesnesi     ("/media/projects/x.webp")
    _derived/w<genişlik>/s/<statik-yol>       kaynak bir statik varlık  ("projects/x.webp")

GÜVENLİK İLKELERİ
  * ORİJİNALLER ASLA SİLİNMEZ/ÜZERİNE YAZILMAZ — script yalnızca "_derived/" önekine yazar.
  * IDEMPOTENT — bir türev zaten varsa (HEAD 200) atlanır; yarım kalan çalıştırma tekrar
    başlatılabilir, iş listesi her seferinde yeniden hesaplanır.
  * ASLA BÜYÜTMEZ — kaynaktan geniş bir basamak üretilmez (yalnızca dosya boyutunu şişirirdi).
  * KAZANÇ YOKSA YAZMAZ — türev, orijinalin %90'ından büyükse atlanır (bkz. MIN_SAVING_RATIO);
    zaten optimize edilmiş küçük görsellere gereksiz R2 yazımı yapılmaz.
  * Başarısızlar loglanır ve çıkış kodunu ETKİLEMEZ — kısmi ilerleme korunur, tekrar çalıştırılır.
  * Kaynak indirme production'ın PUBLIC /media/ + statik varlık yollarından yapılır (R2 okuma
    kotası yerine edge cache'ten okur; ayrıca ek bir kimlik bilgisi gerektirmez).

KULLANIM
    python3 scripts/generate-image-derivatives.py --manifest <dosya> [--limit N] [--concurrency 8]
    python3 scripts/generate-image-derivatives.py --manifest <dosya> --dry-run

Manifest: her satırda bir kaynak yol ("/media/projects/x.webp" ya da "projects/x.webp").
"""

import argparse
import concurrent.futures
import io
import json
import os
import subprocess
import sys
import threading
import time

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUCKET = 'mimarlab-uploads'
SITE = 'https://mimarlab.com'
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0 Safari/537.36')

# image-cdn.js#DERIVATIVE_WIDTHS ile BİREBİR AYNI olmalı — ikisi farklılaşırsa istemci var olmayan
# bir türev ister ve (kırılmaz ama) her seferinde orijinale geri düşer, yani iyileştirme sessizce
# devre dışı kalır.
WIDTHS = [400, 800, 1600]

# Mimari fotoğraf + ürün görselleri için kalite. 82: WebP'de gözle görülür artefakt üretmeyen,
# yaygın olarak "görsel olarak kayıpsıza yakın" kabul edilen bant (repo'daki mevcut Archello içe
# aktarma script'i de aynı değeri kullanıyor, bkz. scripts/fetch-archello-images.py#QUALITY).
QUALITY = 82

# Bir türev orijinalin bu oranından büyükse yazılmaz — kazanç yoksa R2 yazma/depolama harcama.
MIN_SAVING_RATIO = 0.90
# Bu boyutun altındaki kaynaklar hiç işlenmez (küçük logo/thumbnail: türev kazancı ihmal edilebilir,
# 3 ek R2 nesnesi ise net kayıp).
MIN_SOURCE_BYTES = 40 * 1024

SKIP_EXT = {'.svg', '.gif'}

_print_lock = threading.Lock()


def log(msg):
    with _print_lock:
        print(msg, flush=True)


def r2_key_for(path, width):
    """image-cdn.js#derivativeUrl ile BİREBİR aynı anahtar üretimi."""
    clean = path.lstrip('/')
    if clean.startswith('media/'):
        return f'_derived/w{width}/r2/{clean[len("media/"):]}'
    return f'_derived/w{width}/s/{clean}'


def public_url(path):
    clean = path.lstrip('/')
    return f'{SITE}/{clean}'


def curl_bytes(url, tries=3, timeout=90):
    for attempt in range(tries):
        if attempt:
            time.sleep(1.0 * (2 ** (attempt - 1)))
        p = subprocess.run(
            ['curl', '-sS', '-L', '--compressed', '-A', UA, '--max-time', str(timeout), url],
            capture_output=True)
        if p.returncode == 0 and len(p.stdout) > 200:
            return p.stdout
    return b''


def r2_head_exists(key):
    """Türev zaten var mı? Public /media/ yolundan HEAD — R2 okuma kotası harcamaz, edge'den döner.

    DİKKAT: /media/_derived/... yolu, türev YOKSA orijinale geri düşüp yine 200 döner (bkz.
    src/routes/upload.js#DERIVED_KEY_RE güvenlik ağı). Bu yüzden "200 geldi = türev var" DEMEK
    DEĞİLDİR. Geri düşülen yanıt kısa ömürlü cache header'ı taşır (max-age=3600), gerçek türev ise
    immutable — ayrım bu header üzerinden yapılır.
    """
    url = f'{SITE}/media/{key}'
    p = subprocess.run(['curl', '-sI', '-A', UA, '--max-time', '30', url],
                       capture_output=True, text=True)
    if ' 200' not in p.stdout.split('\n')[0]:
        return False
    return 'immutable' in p.stdout.lower()


def r2_put(key, data, content_type='image/webp', tries=4):
    """`wrangler r2 object put` — repo'daki mevcut toplu yükleme deseni (bkz.
    scripts/import-archello-projects.js#putOnce): üstel geri çekilmeli 4 deneme, çünkü Cloudflare
    tarafındaki geçici 5xx'ler ardışık dosyaları tek bir kesinti penceresinde düşürebiliyor."""
    tmp = os.path.join('/tmp', f'deriv-{os.getpid()}-{threading.get_ident()}.webp')
    with open(tmp, 'wb') as fh:
        fh.write(data)
    try:
        for attempt in range(tries):
            if attempt:
                time.sleep(1.5 * (2 ** (attempt - 1)))
            p = subprocess.run(
                ['npx', 'wrangler', 'r2', 'object', 'put', f'{BUCKET}/{key}',
                 '--remote', '--file', tmp, '--content-type', content_type],
                cwd=ROOT, capture_output=True, text=True)
            if p.returncode == 0:
                return True
        return False
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


def load_source(path):
    """Kaynak baytları: statik varlıklar önce YEREL diskten okunur (repo'da zaten duruyorlar —
    ağ turu ve production yükü yok), R2 nesneleri public /media/ üzerinden indirilir."""
    clean = path.lstrip('/')
    if not clean.startswith('media/'):
        local = os.path.join(ROOT, clean)
        if os.path.isfile(local):
            with open(local, 'rb') as fh:
                return fh.read()
    return curl_bytes(public_url(path))


def process_one(path, dry_run=False):
    result = {'path': path, 'written': 0, 'skipped': 0, 'failed': 0, 'bytes': 0, 'note': ''}
    ext = os.path.splitext(path.split('?')[0])[1].lower()
    if ext in SKIP_EXT:
        result['note'] = 'skip-ext'
        return result

    # Hangi basamaklar EKSİK? Hepsi zaten varsa kaynağı indirmeye bile gerek yok (idempotentlik
    # burada ayrıca bant genişliği de kazandırır — tekrar çalıştırmalar neredeyse bedava).
    missing = [w for w in WIDTHS if not r2_head_exists(r2_key_for(path, w))]
    if not missing:
        result['skipped'] = len(WIDTHS)
        result['note'] = 'already-complete'
        return result

    raw = load_source(path)
    if not raw:
        result['failed'] = len(missing)
        result['note'] = 'source-fetch-failed'
        return result
    if len(raw) < MIN_SOURCE_BYTES:
        result['skipped'] = len(missing)
        result['note'] = f'source-too-small({len(raw)})'
        return result

    try:
        im = Image.open(io.BytesIO(raw))
        im.load()
    except Exception as exc:                                  # noqa: BLE001
        result['failed'] = len(missing)
        result['note'] = f'decode-failed:{exc.__class__.__name__}'
        return result

    # Alfa kanalı korunur (şeffaf PNG logolar); diğer her şey RGB'ye indirilir (CMYK/paletli
    # kaynaklar WebP encoder'ında hataya yol açabiliyor).
    if im.mode in ('RGBA', 'LA'):
        im = im.convert('RGBA')
    elif im.mode != 'RGB':
        im = im.convert('RGB')

    src_w = im.width
    for w in missing:
        # ASLA BÜYÜTME: kaynak zaten bu basamaktan darsa türev üretmek dosyayı büyütmekten başka
        # işe yaramaz. İstemci bu URL'yi yine isteyebilir; Worker o zaman orijinale geri düşer ve
        # doğru (zaten küçük) görseli servis eder.
        if src_w <= w:
            result['skipped'] += 1
            continue
        h = max(1, round(im.height * w / src_w))
        out = io.BytesIO()
        im.resize((w, h), Image.LANCZOS).save(out, 'WEBP', quality=QUALITY, method=6)
        data = out.getvalue()
        if len(data) > len(raw) * MIN_SAVING_RATIO:
            result['skipped'] += 1
            continue
        if dry_run:
            result['written'] += 1
            result['bytes'] += len(data)
            continue
        if r2_put(r2_key_for(path, w), data):
            result['written'] += 1
            result['bytes'] += len(data)
        else:
            result['failed'] += 1
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--manifest', required=True)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--concurrency', type=int, default=8)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--report', default='')
    # Galeri kareleri (stage2) için yalnızca küçük basamaklar üretmek üzere: o görseller SADECE
    # pop-up'ın 480 px'lik galeri şeridinde ve 240 px'lik küçük resimlerinde kullanılıyor; 1600 px
    # yalnızca tam ekran lightbox içindir ve orada zaten ORİJİNAL istenir (bkz. image-cdn.js
    # merdiven yorumu). Basamak sayısını 3'ten 2'ye indirmek R2 yazma sayısını ~%33 azaltır.
    ap.add_argument('--widths', default='',
                    help='virgülle ayrılmış genişlikler (varsayılan: 400,800,1600)')
    args = ap.parse_args()

    if args.widths:
        global WIDTHS
        WIDTHS = [int(w) for w in args.widths.split(',') if w.strip()]

    paths = [l.strip() for l in open(args.manifest, encoding='utf-8') if l.strip()]
    if args.limit:
        paths = paths[:args.limit]
    log(f'{len(paths)} kaynak, {len(WIDTHS)} basamak, concurrency={args.concurrency}, '
        f'dry_run={args.dry_run}')

    totals = {'written': 0, 'skipped': 0, 'failed': 0, 'bytes': 0}
    failures = []
    done = 0
    started = time.time()
    with concurrent.futures.ThreadPoolExecutor(args.concurrency) as ex:
        futs = {ex.submit(process_one, p, args.dry_run): p for p in paths}
        for fut in concurrent.futures.as_completed(futs):
            r = fut.result()
            for k in totals:
                totals[k] += r[k]
            if r['failed']:
                failures.append({'path': r['path'], 'note': r['note']})
            done += 1
            if done % 25 == 0 or done == len(paths):
                el = time.time() - started
                rate = done / el if el else 0
                eta = (len(paths) - done) / rate if rate else 0
                log(f'  {done}/{len(paths)}  yazılan={totals["written"]} '
                    f'atlanan={totals["skipped"]} hatalı={totals["failed"]} '
                    f'+{totals["bytes"]/1e6:.0f} MB  ETA {eta/60:.0f} dk')

    log(f'BİTTİ: yazılan={totals["written"]} atlanan={totals["skipped"]} '
        f'hatalı={totals["failed"]} eklenen depolama={totals["bytes"]/1e6:.1f} MB '
        f'süre={(time.time()-started)/60:.1f} dk')
    if failures:
        log(f'  {len(failures)} kaynak başarısız (tekrar çalıştırılabilir):')
        for f in failures[:15]:
            log(f'    {f["path"]}  {f["note"]}')
    if args.report:
        with open(args.report, 'w', encoding='utf-8') as fh:
            json.dump({'totals': totals, 'failures': failures}, fh, ensure_ascii=False, indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
