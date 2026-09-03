#!/usr/bin/env python3
"""BEKLEYEN türev işlerini boşaltır — ARTIMLI, yalnızca gerçekten eksik olanları işler.

NEDEN AYRI BİR BETİK
generate-image-derivatives.py bir MIGRATION aracıdır: sitedeki TÜM görselleri kapsayan bir manifest
alır ve her kaynak için basamak başına bir HEAD isteğiyle "bu türev zaten var mı?" diye tarar.
26.333 kaynak x 3 basamak ≈ 79.000 istek eder; 2026-09-03 turu 9,5 SAAT sürdü. Geçmiş veri için bu
kabul edilebilirdi (bir kez çalıştı, 23.767 türev üretti, hatalı=0) ama YENİ görseller için tamamen
israftır: her koşuda zaten üretilmiş 23.767 türev yeniden sorgulanır.

Bu betik aramaz, OKUR. İş listesi D1'deki image_derivative_queue tablosudur (bkz. migrations/
0083_image_derivative_queue.sql): bir görsel yüklendiğinde tarayıcının üretemediği basamaklar oraya
yazılır (bkz. src/lib/derivativeIngest.js#recordPendingWidths). Yani çalışma süresi sitenin
büyüklüğüyle değil, YALNIZCA bekleyen iş sayısıyla ölçeklenir ve mevcut türevlere HİÇ dokunulmaz.

NORMAL DURUMDA KUYRUK BOŞTUR: yeni yüklemelerin türevlerini tarayıcı üretir (bkz. image-upload.js),
sunucu doğrulayıp doğrudan R2'ye yazar. Kuyruğa yalnızca istisnalar düşer — WebP kodlayamayan çok
eski bir tarayıcı, decode edilemeyen bir dosya, /api/ai/copy-images'in indirdiği ve tarayıcıda
yeniden yüklenemeyen ham kopyalar.

GÜVENLİK İLKELERİ generate-image-derivatives.py İLE AYNI (kurallar farklılaşırsa aynı R2 anahtarı
altında farklı içerik oluşur):
  * ORİJİNALLER ASLA SİLİNMEZ/ÜZERİNE YAZILMAZ — yalnızca "_derived/" önekine yazılır.
  * ASLA BÜYÜTME — kaynaktan geniş bir basamak üretilmez.
  * KAZANÇ YOKSA YAZMA — türev, orijinalin %90'ından büyükse atlanır.
  * IDEMPOTENT — türev zaten varsa atlanır; yarım kalan koşu tekrar başlatılabilir.
  * Kuyruk satırı YALNIZCA iş kesin olarak sonuçlandığında (yazıldı / bilinçli atlandı / kaynak
    artık yok) silinir. Geçici bir hatada (ağ, R2 5xx) satır KALIR ve sonraki koşuda tekrar denenir.

KULLANIM
    python3 scripts/drain-derivative-queue.py                 # tümünü boşalt
    python3 scripts/drain-derivative-queue.py --limit 200
    python3 scripts/drain-derivative-queue.py --dry-run
"""

import argparse
import collections
import concurrent.futures
import io
import json
import os
import subprocess
import sys
import threading
import time

from PIL import Image, ImageFile

# generate-image-derivatives.py'deki AYNI gerekçe: eksik yazılmış (truncated) dosyalar tarayıcıda
# sorunsuz görüntülenir; bu bayrak olmadan Pillow hata verip o görsele hiç türev üretmez.
ImageFile.LOAD_TRUNCATED_IMAGES = True

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUCKET = 'mimarlab-uploads'
DB = 'mimarlab-db'
SITE = 'https://mimarlab.com'
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0 Safari/537.36')

# image-cdn.js#DERIVATIVE_WIDTHS / src/lib/derivativeIngest.js#DERIVATIVE_WIDTHS /
# image-upload.js#DERIVATIVE_WIDTHS / generate-image-derivatives.py#WIDTHS ile BİREBİR AYNI.
WIDTHS = [400, 800, 1600]
QUALITY = 82
MIN_SAVING_RATIO = 0.90
MIN_SOURCE_BYTES = 40 * 1024

_print_lock = threading.Lock()


def log(msg):
    with _print_lock:
        print(msg, flush=True)


def d1(sql):
    """scripts/build-image-manifest.py#d1 ile AYNI desen — wrangler'ın mevcut oturumuyla kimlik
    doğrular, ayrı bir API anahtarı/uç noktası gerektirmez."""
    p = subprocess.run(
        ['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--json', '--command', sql],
        cwd=ROOT, capture_output=True, text=True)
    if p.returncode != 0:
        raise SystemExit(f'D1 sorgusu başarısız:\n{p.stderr[:800]}')
    return json.loads(p.stdout)[0]['results']


def sql_quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def derived_key(r2_key, width):
    """image-cdn.js#derivativeUrl / src/lib/derivativeIngest.js#derivedKeyFor ile AYNI biçim.
    Kuyruktaki kaynaklar her zaman R2 nesneleridir ("u/<uid>/<uuid>.webp"), bu yüzden ayraç "r2"."""
    return f'_derived/w{width}/r2/{r2_key}'


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


def derivative_exists(r2_key, width):
    """DİKKAT: /media/_derived/... yolu, türev YOKSA orijinale geri düşüp yine 200 döner (bkz.
    src/routes/upload.js#DERIVED_KEY_RE güvenlik ağı). "200 geldi = türev var" DEMEK DEĞİLDİR —
    geri düşülen yanıt kısa ömürlüdür (max-age=3600), gerçek türev "immutable" taşır."""
    url = f'{SITE}/media/{derived_key(r2_key, width)}'
    p = subprocess.run(['curl', '-sI', '-A', UA, '--max-time', '30', url],
                       capture_output=True, text=True)
    if not p.stdout or ' 200' not in p.stdout.split('\n')[0]:
        return False
    return 'immutable' in p.stdout.lower()


def r2_put(key, data, tries=7):
    """generate-image-derivatives.py#r2_put ile AYNI: üstel geri çekilmeli denemeler. Cloudflare
    HESAP DÜZEYİNDE API hız sınırı uygular (1200 istek/5dk) ve pencere DAKİKALAR sürebilir; 7
    deneme + 3*2^n toplam ~190 saniye bekleme o pencereyi atlatmaya yeter."""
    tmp = os.path.join('/tmp', f'drain-{os.getpid()}-{threading.get_ident()}.webp')
    with open(tmp, 'wb') as fh:
        fh.write(data)
    try:
        for attempt in range(tries):
            if attempt:
                time.sleep(3 * (2 ** (attempt - 1)))
            p = subprocess.run(
                ['npx', 'wrangler', 'r2', 'object', 'put', f'{BUCKET}/{key}',
                 '--remote', '--file', tmp, '--content-type', 'image/webp'],
                cwd=ROOT, capture_output=True, text=True)
            if p.returncode == 0:
                return True
        return False
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


def process_source(r2_key, widths, dry_run=False):
    """Bir kaynağın bekleyen TÜM basamaklarını tek bir indirme + tek bir decode ile işler.

    Döner: (sonuçlanan_basamaklar, sayaçlar). "Sonuçlanan" = kuyruktan silinebilir: yazıldı, ya da
    kural gereği (büyütme/kazanç yok/çok küçük/kaynak yok) hiç yazılmayacağı KESİN. Geçici hatalar
    (indirme/R2 yazımı başarısız) listeye GİRMEZ, satır kuyrukta kalır ve sonra tekrar denenir."""
    settled = []
    counts = collections.Counter()

    todo = []
    for w in widths:
        if derivative_exists(r2_key, w):
            # Zaten var (ör. tarayıcı üretti ama kuyruk satırı temizlenemedi) — iş bitmiş sayılır.
            settled.append(w)
            counts['already'] += 1
        else:
            todo.append(w)
    if not todo:
        return settled, counts

    raw = curl_bytes(f'{SITE}/media/{r2_key}')
    if not raw:
        # Kaynak gerçekten silinmiş mi, yoksa geçici bir ağ hatası mı? HEAD ile ayırt edilir: 404
        # ise satır kalıcı olarak anlamsızdır ve temizlenir, aksi halde tekrar denenmek üzere kalır.
        p = subprocess.run(['curl', '-sI', '-A', UA, '--max-time', '30', f'{SITE}/media/{r2_key}'],
                           capture_output=True, text=True)
        if p.stdout and ' 404' in p.stdout.split('\n')[0]:
            settled.extend(todo)
            counts['source-gone'] += len(todo)
        else:
            counts['fetch-failed'] += len(todo)
        return settled, counts

    if len(raw) < MIN_SOURCE_BYTES:
        settled.extend(todo)
        counts['source-too-small'] += len(todo)
        return settled, counts

    try:
        im = Image.open(io.BytesIO(raw))
        im.load()
    except Exception as exc:                                      # noqa: BLE001
        # Decode edilemeyen bir kaynak sonraki koşularda da decode edilemez — sonsuza kadar tekrar
        # denemek yerine kuyruktan düşürülür (görsel kırılmaz: /media/_derived/... orijinale düşer).
        settled.extend(todo)
        counts['decode-failed'] += len(todo)
        log(f'    decode başarısız: {r2_key} ({exc.__class__.__name__})')
        return settled, counts

    # Alfa korunur (şeffaf PNG logolar); diğer her şey RGB'ye indirilir — CMYK/paletli kaynaklar
    # WebP encoder'ında hataya yol açabiliyor (generate-image-derivatives.py'deki AYNI kural).
    if im.mode in ('RGBA', 'LA'):
        im = im.convert('RGBA')
    elif im.mode != 'RGB':
        im = im.convert('RGB')

    for w in todo:
        if im.width <= w:
            settled.append(w)                                     # ASLA BÜYÜTME
            counts['no-upscale'] += 1
            continue
        h = max(1, round(im.height * w / im.width))
        out = io.BytesIO()
        im.resize((w, h), Image.LANCZOS).save(out, 'WEBP', quality=QUALITY, method=6)
        data = out.getvalue()
        if len(data) > len(raw) * MIN_SAVING_RATIO:
            settled.append(w)                                     # KAZANÇ YOKSA YAZMA
            counts['no-saving'] += 1
            continue
        if dry_run:
            counts['would-write'] += 1
            counts['bytes'] += len(data)
            continue
        if r2_put(derived_key(r2_key, w), data):
            settled.append(w)
            counts['written'] += 1
            counts['bytes'] += len(data)
        else:
            counts['put-failed'] += 1                             # satır kuyrukta KALIR
    return settled, counts


def clear_queue_rows(pairs):
    """Sonuçlanan (kaynak, basamak) çiftlerini kuyruktan siler. Tek bir devasa ifade yerine
    parçalara bölünür — D1'in ifade uzunluğu sınırına takılmamak için."""
    for i in range(0, len(pairs), 200):
        chunk = pairs[i:i + 200]
        conds = ' OR '.join(f'(r2_key = {sql_quote(k)} AND width = {int(w)})' for k, w in chunk)
        d1(f'DELETE FROM image_derivative_queue WHERE {conds}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0, help='en fazla kaç KAYNAK işlensin (0 = tümü)')
    ap.add_argument('--concurrency', type=int, default=6,
                    help='generate-image-derivatives.py deneyimi: sürekli koşularda ~6 güvenli tavan')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    rows = d1('SELECT r2_key, width FROM image_derivative_queue ORDER BY created_at, r2_key, width')
    if not rows:
        log('Kuyruk boş — üretilecek yeni türev yok.')
        return 0

    by_source = collections.OrderedDict()
    for row in rows:
        by_source.setdefault(row['r2_key'], []).append(int(row['width']))
    sources = list(by_source.items())
    if args.limit:
        sources = sources[:args.limit]

    log(f'{len(rows)} bekleyen basamak / {len(by_source)} kaynak; bu koşuda {len(sources)} kaynak '
        f'işlenecek (concurrency={args.concurrency}, dry_run={args.dry_run})')

    totals = collections.Counter()
    settled_pairs = []
    done = 0
    started = time.time()
    with concurrent.futures.ThreadPoolExecutor(args.concurrency) as ex:
        futs = {ex.submit(process_source, key, widths, args.dry_run): key
                for key, widths in sources}
        for fut in concurrent.futures.as_completed(futs):
            key = futs[fut]
            try:
                settled, counts = fut.result()
            except Exception as exc:                              # noqa: BLE001
                log(f'    beklenmedik hata: {key} ({exc})')
                continue
            totals.update(counts)
            settled_pairs.extend((key, w) for w in settled)
            done += 1
            if done % 25 == 0 or done == len(sources):
                el = time.time() - started
                log(f'  {done}/{len(sources)}  yazılan={totals["written"]} '
                    f'atlanan={totals["no-upscale"] + totals["no-saving"] + totals["source-too-small"]} '
                    f'hatalı={totals["put-failed"] + totals["fetch-failed"]} '
                    f'+{totals["bytes"] / 1e6:.1f} MB  {el / 60:.1f} dk')

    # Kuyruk temizliği EN SONA bırakılır: koşu yarıda kesilirse (Ctrl-C) hiçbir satır kaybolmaz ve
    # iş bir sonraki koşuda aynen tekrar edilir — türev üretimi idempotent olduğundan zararsızdır.
    if settled_pairs and not args.dry_run:
        clear_queue_rows(settled_pairs)

    log(f'BİTTİ: yazılan={totals["written"]} zaten-vardı={totals["already"]} '
        f'büyütme-yok={totals["no-upscale"]} kazanç-yok={totals["no-saving"]} '
        f'çok-küçük={totals["source-too-small"]} kaynak-silinmiş={totals["source-gone"]} '
        f'decode-hatası={totals["decode-failed"]} '
        f'tekrar-denenecek={totals["put-failed"] + totals["fetch-failed"]} '
        f'eklenen depolama={totals["bytes"] / 1e6:.1f} MB süre={(time.time() - started) / 60:.1f} dk')
    if args.dry_run:
        log(f'  (dry-run: {totals["would-write"]} türev yazılacaktı, kuyruk DEĞİŞMEDİ)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
