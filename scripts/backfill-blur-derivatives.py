#!/usr/bin/env python3
"""GATED (önizleme / sahiplenilmemiş fotoğrafçı) görseller için BLUR türevi backfill'i.

NEDEN (kullanıcı isteği, 2026-09-11): CSS blur yalnızca ekranda — "sağ tık > görseli yeni sekmede
aç" ya da bir indirme eklentisi, /media/... adresinden NET baytları alıyordu. Cloudflare görsel
dönüşümü bu zone'da kapalı (/cdn-cgi/image 404) ve Workers'ta decode yok; tek çare, gated her
görsel için önceden üretilmiş küçük+bulanık bir türev (R2: _derived/blur/<r2|s>/<yol>.webp) ve
Worker'ın gated isteklerde NET dosya yerine bunu servis etmesi (bkz. src/lib/gatedMedia.js).
Kayıt sahiplenilip yayına alınınca gated kümeden düşer, Worker yine net dosyayı verir — türev
R2'de zararsız durur.

KURALLAR
  * KAYNAK: statik yollar (miras/, projects/, mimarlar/, logos/...) yerel diskten okunur; R2
    nesneleri public /media/_derived/w400/... üzerinden indirilir (küçük türev yeterli — sonuç
    48 px'lik bir bulanık kare olacak).
  * ÇIKTI: genişlik 48 px (en-boy korunur), GaussianBlur(2), WebP q=55. Hiçbir ayrıntı geri
    kazanılamaz; dosya ~1 KB.
  * IDEMPOTENT: işlenen anahtarlar bir manifest dosyasına yazılır; tekrar koşu atlar. R2'ye HEAD
    atılmaz (generate-image-derivatives.py'nin 79.000 istek dersi).
  * ORİJİNALLERE ASLA DOKUNULMAZ — yalnızca _derived/blur/ önekine yazılır.
  * Anahtar normalizasyonu src/lib/gatedMedia.js#normalizeImageKey ile BİREBİR aynı olmalı.

KULLANIM
    python3 scripts/backfill-blur-derivatives.py [--limit N] [--dry-run] [--concurrency 6]
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
from urllib.parse import urlparse, unquote

from PIL import Image, ImageFile, ImageFilter

ImageFile.LOAD_TRUNCATED_IMAGES = True

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUCKET = 'mimarlab-uploads'
DB = 'mimarlab-db'
SITE = 'https://mimarlab.com'
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0 Safari/537.36')
SITE_HOSTS = {'mimarlab.com', 'www.mimarlab.com'}
BLUR_WIDTH = 48
BLUR_RADIUS = 2
QUALITY = 55
MANIFEST = os.path.join(ROOT, '.blur-derivatives-manifest.txt')  # gitignore'lu değilse de zararsız; commit ETME

_print_lock = threading.Lock()


def log(msg):
    with _print_lock:
        print(msg, flush=True)


# --- src/lib/gatedMedia.js#normalizeImageKey ile BİREBİR aynı ---------------------------------
def normalize_image_key(path):
    if not isinstance(path, str):
        return None
    p = path.strip()
    if not p or p.startswith('data:') or p.startswith('blob:'):
        return None
    if p.startswith('//'):
        p = 'https:' + p
    if p.lower().startswith('http://') or p.lower().startswith('https://'):
        u = urlparse(p)
        if u.hostname not in SITE_HOSTS:
            return None
        p = u.path
    p = unquote(p).lstrip('/')
    if not p:
        return None
    if p.startswith('media/'):
        return 'r2:' + p[len('media/'):]
    return 's:' + p


def blur_key(image_key):
    source, path = image_key.split(':', 1)
    return f'_derived/blur/{source}/{path}.webp'


def d1_json(sql):
    p = subprocess.run(['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--json', '--command', sql],
                       cwd=ROOT, capture_output=True, text=True)
    if p.returncode != 0:
        raise SystemExit(f'D1 sorgusu başarısız: {p.stderr[-800:]}')
    out = json.loads(p.stdout)
    return out[0]['results']


def gated_sources():
    """Gated görsel URL'leri — src/lib/gatedMedia.js#loadGatedImageSet ile AYNI kaynaklar."""
    urls = []
    for r in d1_json("SELECT images FROM projects WHERE preview_at IS NOT NULL AND deleted_at IS NULL"):
        try:
            urls += [u for u in (json.loads(r['images'] or '[]') or []) if isinstance(u, str)]
        except Exception:
            pass
    for r in d1_json("SELECT images, variants FROM products WHERE preview_at IS NOT NULL AND deleted_at IS NULL"):
        try:
            urls += [u for u in (json.loads(r['images'] or '[]') or []) if isinstance(u, str)]
        except Exception:
            pass
        try:
            for v in (json.loads(r['variants'] or '[]') or []):
                urls += [u for u in ((v or {}).get('images') or []) if isinstance(u, str)]
        except Exception:
            pass
    for r in d1_json("SELECT logo_url, cover_url FROM offices WHERE preview_at IS NOT NULL AND deleted_at IS NULL"):
        urls += [r.get('logo_url'), r.get('cover_url')]
    for r in d1_json("SELECT photo_url FROM architects WHERE preview_at IS NOT NULL AND deleted_at IS NULL"):
        urls.append(r.get('photo_url'))
    # Sahiplenilmemiş fotoğrafçılar — src/lib/claimedProfiles.js#fetchUnclaimedPhotographers ile aynı SQL.
    for r in d1_json(
        "SELECT a.photo_url FROM architects a WHERE a.deleted_at IS NULL AND a.photo_url IS NOT NULL"
        " AND a.profession LIKE '%Fotoğrafçı%'"
        " AND NOT EXISTS (SELECT 1 FROM profile_claims c WHERE c.status = 'approved'"
        "   AND (c.profile_key = a.name OR (a.legacy_key IS NOT NULL AND c.profile_key = a.legacy_key)))"
        " AND NOT EXISTS (SELECT 1 FROM offices o JOIN profile_claims c ON c.status = 'approved' AND c.profile_type = 'office'"
        "   AND (c.profile_key = o.name OR (o.legacy_key IS NOT NULL AND c.profile_key = o.legacy_key))"
        "   WHERE o.deleted_at IS NULL AND (o.id = a.office_id OR o.id IN (SELECT f.office_id FROM office_founders f WHERE f.architect_id = a.id)))"
        " AND NOT EXISTS (SELECT 1 FROM architect_submissions s JOIN users u ON u.id = s.owner_user_id"
        "   WHERE ('submission:' || s.id) = a.legacy_key AND s.status = 'approved' AND u.name IS NOT NULL AND a.name = u.name COLLATE NOCASE)"):
        urls.append(r.get('photo_url'))
    keys = []
    seen = set()
    for u in urls:
        k = normalize_image_key(u)
        if k and k not in seen:
            seen.add(k)
            keys.append(k)
    return keys


def curl_bytes(url, tries=3, timeout=60):
    for attempt in range(tries):
        if attempt:
            time.sleep(1.0 * (2 ** (attempt - 1)))
        p = subprocess.run(['curl', '-sS', '-L', '--compressed', '-A', UA, '--max-time', str(timeout),
                            '-H', f'X-ML-Blur-Backfill: {TOKEN}', url],
                           capture_output=True)
        if p.returncode == 0 and len(p.stdout) > 200:
            return p.stdout
    return b''


def load_source(image_key):
    source, path = image_key.split(':', 1)
    if source == 's':
        local = os.path.join(ROOT, path)
        if os.path.isfile(local):
            with open(local, 'rb') as fh:
                return fh.read()
        return curl_bytes(f'{SITE}/media/_derived/w400/s/{path}')
    return curl_bytes(f'{SITE}/media/_derived/w400/r2/{path}')


def make_blur(data):
    im = Image.open(io.BytesIO(data))
    im.load()
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        bg = Image.new('RGB', im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[-1])
        im = bg
    else:
        im = im.convert('RGB')
    w, h = im.size
    if w <= 0 or h <= 0:
        return None
    nh = max(1, round(h * BLUR_WIDTH / w))
    im = im.resize((BLUR_WIDTH, nh), Image.LANCZOS).filter(ImageFilter.GaussianBlur(BLUR_RADIUS))
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=QUALITY, method=4)
    return buf.getvalue()


# --- HIZLI YOL: Worker'daki toplu yükleme ucu (POST /api/admin/blur-derivatives, bkz. src/routes/
# upload.js#handleBlurBackfillRoute). `wrangler r2 object put` nesne başına ~2,6 sn + hesap düzeyi
# API hız sınırı (1200 istek/5 dk) → 33.000 görsel için ~3-4 saat. Uç ise R2 binding'iyle yazar
# (API sınırı yok); 150'lik partiler → dakikalar. Token BLUR_BACKFILL_TOKEN ortam değişkeninden
# (Worker secret ile aynı). Aynı token, indirme isteklerinde gate'i de atlatır (X-ML-Blur-Backfill)
# — aksi halde gate canlıyken w400 türevi yerine bulanık türev iner ve "blur'un bluru" üretilirdi.
TOKEN = os.environ.get('BLUR_BACKFILL_TOKEN', '').strip()
BATCH = 150


def api_put_batch(items, tries=5):
    """items: [(blur_key, bytes)] — hepsi tek multipart istekte."""
    import uuid
    boundary = '----mlblur' + uuid.uuid4().hex
    body = bytearray()
    for key, data in items:
        body += (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{key}"\r\n'
                 f'Content-Type: image/webp\r\n\r\n').encode()
        body += data
        body += b'\r\n'
    body += f'--{boundary}--\r\n'.encode()
    tmp = os.path.join('/tmp', f'blur-batch-{os.getpid()}-{threading.get_ident()}.bin')
    with open(tmp, 'wb') as fh:
        fh.write(body)
    try:
        for attempt in range(tries):
            if attempt:
                time.sleep(3 * (2 ** (attempt - 1)))
            p = subprocess.run(['curl', '-sS', '--max-time', '120', '-X', 'POST',
                                '-H', f'Authorization: Bearer {TOKEN}',
                                '-H', f'Content-Type: multipart/form-data; boundary={boundary}',
                                '--data-binary', f'@{tmp}', f'{SITE}/api/admin/blur-derivatives'],
                               capture_output=True, text=True)
            try:
                out = json.loads(p.stdout)
            except Exception:
                out = None
            if p.returncode == 0 and out and out.get('ok'):
                return out.get('written', 0), out.get('rejected', [])
        return 0, [k for k, _ in items]
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


def r2_put(key, data, tries=7):
    tmp = os.path.join('/tmp', f'blur-{os.getpid()}-{threading.get_ident()}.webp')
    with open(tmp, 'wb') as fh:
        fh.write(data)
    try:
        for attempt in range(tries):
            if attempt:
                time.sleep(3 * (2 ** (attempt - 1)))
            p = subprocess.run(['npx', 'wrangler', 'r2', 'object', 'put', f'{BUCKET}/{key}',
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


def process_one(image_key, dry_run):
    try:
        data = load_source(image_key)
        if not data:
            return image_key, 'kaynak-yok'
        blur = make_blur(data)
        if not blur:
            return image_key, 'decode-hata'
        if dry_run:
            return image_key, f'dry({len(blur)}B)'
        if TOKEN:
            return image_key, ('blob', blur)
        return image_key, ('yazildi' if r2_put(blur_key(image_key), blur) else 'r2-hata')
    except Exception as e:  # noqa: BLE001
        return image_key, f'hata:{str(e)[:80]}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--concurrency', type=int, default=6)
    args = ap.parse_args()

    done = set()
    if os.path.isfile(MANIFEST):
        with open(MANIFEST, encoding='utf-8') as fh:
            done = {ln.strip() for ln in fh if ln.strip()}
    keys = [k for k in gated_sources() if k not in done]
    log(f'gated görsel: {len(keys)} bekliyor (manifestte {len(done)} tamam)')
    if args.limit:
        keys = keys[:args.limit]
    counts = {}
    started = time.time()
    pending_batch = []

    def flush_batch(mf):
        if not pending_batch:
            return
        written, rejected = api_put_batch([(blur_key(k), b) for k, b in pending_batch])
        rejected = set(rejected)
        for k, _ in pending_batch:
            if blur_key(k) in rejected:
                counts['api-red'] = counts.get('api-red', 0) + 1
            else:
                counts['yazildi'] = counts.get('yazildi', 0) + 1
                mf.write(k + '\n')
        mf.flush()
        pending_batch.clear()

    with open(MANIFEST, 'a', encoding='utf-8') as mf, \
            concurrent.futures.ThreadPoolExecutor(args.concurrency) as ex:
        for i, (key, status) in enumerate(ex.map(lambda k: process_one(k, args.dry_run), keys), 1):
            if isinstance(status, tuple):
                pending_batch.append((key, status[1]))
                if len(pending_batch) >= BATCH:
                    flush_batch(mf)
            else:
                tag = status.split('(')[0].split(':')[0]
                counts[tag] = counts.get(tag, 0) + 1
                if status.startswith('yazildi') or status == 'kaynak-yok' or status == 'decode-hata':
                    # kaynak-yok/decode-hata KESİN sonuç: tekrar denemek boşuna (Worker o görselde
                    # placeholder servis eder). r2-hata/hata geçici olabilir — manifeste yazılmaz.
                    mf.write(key + '\n')
                    mf.flush()
            if i % 200 == 0 or i == len(keys):
                log(f'[{i}/{len(keys)}] {counts} ({time.time() - started:.0f}s)')
        flush_batch(mf)
    log(f'BİTTİ {counts}')


if __name__ == '__main__':
    main()
