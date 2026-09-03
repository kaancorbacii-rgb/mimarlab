#!/usr/bin/env python3
"""MİMARLAB görsel arama — GERÇEK GÖRSEL EMBEDDING BACKFILL (bir kerelik, offline).

NEDEN BU BETİK VAR (bkz. src/lib/imageEmbedIndex.js dosya başı yorumu — TAM gerekçe orada)
Cloudflare Workers AI'nin görsel embedding modeli YOK ve harici bir API (Jina/Vertex AI/HF) için
YENİ BİR HESAP açmak Claude'un asla yapamayacağı bir eylem. Bu yüzden mevcut ~11.000 proje/ürün
görselinin embedding'i BİR KEZ, bu makinede, açık kaynak CLIP modeliyle (OpenAI'nin MIT lisanslı
CLIP'inin `Xenova/clip-vit-base-patch32` ONNX dışa aktarımı, görsel kodlayıcı, uint8 nicemlenmiş,
88,6 MB) hesaplanır. Model + kodun tamamı MIT lisanslı, ticari kullanım serbest.

Bu betikten SONRAKİ yeni görseller (yeni proje/ürün eklendiğinde) SUNUCU tarafında DEĞİL,
TARAYICIDA hesaplanır (bkz. image-clip-embed.js, aynı ONNX modeli self-host edilmiş halde) —
Workers CNN çalıştıramadığı için bu tek sürdürülebilir "hesap açmadan otomatik indeksleme" yolu.

ÇIKTI BİÇİMİ src/lib/imageEmbedIndex.js#packImageIndex İLE BİREBİR AYNI OLMAK ZORUNDADIR — iki
taraf farklılaşırsa Worker paketi okuyamaz. Format:
  [0:4]   uint32 LE  — başlık JSON uzunluğu
  [4:4+n] UTF-8 JSON — {v,type,dim,model,built,entities:[{s:slug,c:satır sayısı,k:[imageKey,...]}]}
  [4+n:]  int8[]     — Σc × dim bayt, entities[] sırasıyla ARDIŞIK bloklar halinde

KULLANIM
    python3 scripts/build-image-embeddings.py --type project
    python3 scripts/build-image-embeddings.py --type product
    python3 scripts/build-image-embeddings.py --type project --limit 20   # hızlı deneme
    python3 scripts/build-image-embeddings.py --type project --dry-run   # indirme+embed, KV'ye yazma

GEREKSİNİMLER (izole venv, bkz. /tmp/clip_env — proje deposuna hiçbir npm/pip bağımlılığı EKLEMEZ):
    python3 -m venv /tmp/clip_env
    /tmp/clip_env/bin/pip install onnxruntime pillow numpy transformers huggingface_hub requests
"""

import argparse
import io
import json
import os
import re
import struct
import subprocess
import sys
import time
import concurrent.futures
import threading

import numpy as np
import requests
from PIL import Image, ImageFile
from transformers import CLIPImageProcessor
import onnxruntime as ort
from huggingface_hub import hf_hub_download

ImageFile.LOAD_TRUNCATED_IMAGES = True  # bkz. generate-image-derivatives.py'deki AYNI gerekçe

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ACCOUNT_ID = '2e3cd3c1a471552e19436913b2368c4f'
DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246'
KV_NAMESPACE_ID = '9a8a1cfde13447a498bc5dcc4bc7d4ae'  # FACET_CACHE
SITE_ORIGIN = 'https://mimarlab.com'

MODEL_DIR = '/tmp/clip-model'
VISION_MODEL_PATH = f'{MODEL_DIR}/onnx/vision_model_uint8.onnx'
DIM = 512
INDEX_VERSION = 'v1'
MODEL_LABEL = 'Xenova/clip-vit-base-patch32 (vision, uint8)'

# Varlık başına en fazla kaç görsel embed edilir. Projeler ortalama 16,3 görsel taşıyor (D1 ölçümü,
# 2026-09-03) — HEPSİNİ embed etmek indirme+CPU süresini ~3x büyütürdü, oysa images[] dizisinin
# BAŞI zaten kapak + en temsil edici kareler (proje-ekle.html'de kullanıcı bu sırayı kendi seçiyor).
# Ürünler ortalama 3,3 görsel taşıdığından pratikte bu sınıra neredeyse hiç değmiyor.
MAX_IMAGES_PER_ENTITY = 6

def oauth_token():
    path = os.path.expanduser('~/Library/Preferences/.wrangler/config/default.toml')
    with open(path) as f:
        toml = f.read()
    m = re.search(r'oauth_token\s*=\s*"([^"]+)"', toml)
    if not m:
        raise RuntimeError('wrangler OAuth token bulunamadı — `npx wrangler login` çalıştırın.')
    return m.group(1)

TOKEN = oauth_token()

def d1_query(sql):
    res = requests.post(
        f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/d1/database/{DATABASE_ID}/query',
        headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'},
        json={'sql': sql}, timeout=30)
    body = res.json()
    if not body.get('success'):
        raise RuntimeError(f'D1 hatası: {body.get("errors")}')
    return body['result'][0]['results']

# image-cdn.js#toLocalPath/derivativeUrl İLE AYNI URL çözümleme mantığı (bkz. o dosyanın dosya başı
# yorumu: "images kolonu mutlak/göreli KARIŞIK") — üç biçim de canlıda gerçekten var:
#   "miras/hagia-sophia-grand-mosque-1.webp"       -> statik varlık, KÖKTEN servis edilir (media/ YOK)
#   "/media/products/lazzoni/mony-sofa.jpg"        -> R2 nesnesi, zaten media/ önekli
#   "https://mimarlab.com/media/projects/x.webp"   -> mutlak URL, aynı origin
def resolve_image_url(path):
    if not isinstance(path, str) or not path:
        return None
    if path.startswith('data:') or path.startswith('blob:'):
        return None
    if re.match(r'^https?://', path):
        return path  # mutlak URL (aynı ya da harici origin) — olduğu gibi indirilir
    return SITE_ORIGIN + ('' if path.startswith('/') else '/') + path

def fetch_image_bytes(url, timeout=20):
    r = requests.get(url, timeout=timeout, headers={'User-Agent': 'MimarlabImageEmbedBackfill/1.0'})
    r.raise_for_status()
    return r.content

def quantize_unit(vec):
    """src/lib/imageEmbedIndex.js#quantizeUnit İLE BİREBİR AYNI formül."""
    norm = float(np.linalg.norm(vec))
    if not norm or not np.isfinite(norm):
        return np.zeros(len(vec), dtype=np.int8)
    q = np.round((vec / norm) * 127)
    return np.clip(q, -127, 127).astype(np.int8)

def ensure_model():
    """Model /tmp'te yoksa (ör. yeni bir makine/oturum — /tmp oturumlar arası KALICI DEĞİL)
    Xenova/clip-vit-base-patch32'den (MIT lisanslı, bkz. dosya başı yorumu) otomatik indirir.
    Zaten varsa yeniden indirmez — hf_hub_download kendi önbelleğini kullanır."""
    if not (os.path.exists(VISION_MODEL_PATH) and os.path.exists(f'{MODEL_DIR}/preprocessor_config.json')):
        print('Model bulunamadı, Xenova/clip-vit-base-patch32\'den indiriliyor (~89 MB, bir kerelik)...')
        for f in ['preprocessor_config.json', 'config.json', 'onnx/vision_model_uint8.onnx']:
            hf_hub_download(repo_id='Xenova/clip-vit-base-patch32', filename=f, local_dir=MODEL_DIR)

class Embedder:
    """Thread-safe değil — onnxruntime InferenceSession thread-safe'dir (belgelenmiş), ama
    CLIPImageProcessor çağrısı da stateless olduğundan tüm işçi thread'leri TEK bir örneği
    paylaşabilir (model tekrar tekrar yüklenmesin diye)."""
    def __init__(self):
        ensure_model()
        self.proc = CLIPImageProcessor.from_pretrained(MODEL_DIR)
        self.sess = ort.InferenceSession(VISION_MODEL_PATH, providers=['CPUExecutionProvider'])
        self.input_name = self.sess.get_inputs()[0].name

    def embed(self, image_bytes):
        img = Image.open(io.BytesIO(image_bytes))
        # decompression bomb koruması (brief madde 25 — bu betik offline/local olsa da aynı disiplin)
        if img.width * img.height > 60_000_000:
            raise ValueError('görsel çok büyük')
        img = img.convert('RGB')
        inputs = self.proc(images=img, return_tensors='np')
        out = self.sess.run(None, {self.input_name: inputs['pixel_values'].astype(np.float32)})[0][0]
        return quantize_unit(out)

def pack_index(entities_with_keys, all_vectors, entity_type):
    """src/lib/imageEmbedIndex.js#packImageIndex İLE BİREBİR AYNI ikili biçim."""
    header = {
        'v': INDEX_VERSION, 'type': entity_type, 'dim': DIM, 'model': MODEL_LABEL,
        'built': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'entities': [{'s': e['slug'], 'c': e['count'], 'k': e['keys']} for e in entities_with_keys],
    }
    header_bytes = json.dumps(header, ensure_ascii=False).encode('utf-8')
    body = b''.join(v.tobytes() for v in all_vectors)
    return struct.pack('<I', len(header_bytes)) + header_bytes + body

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--type', choices=['project', 'product'], required=True)
    ap.add_argument('--limit', type=int, default=None, help='yalnızca ilk N varlık (deneme için)')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--workers', type=int, default=8)
    args = ap.parse_args()

    print(f'[{args.type}] D1\'den okunuyor...')
    if args.type == 'project':
        rows = d1_query(
            "SELECT slug, images FROM projects WHERE deleted_at IS NULL AND hidden_at IS NULL "
            "ORDER BY id")
    else:
        rows = d1_query(
            "SELECT slug, images FROM products WHERE deleted_at IS NULL AND hidden_at IS NULL "
            "ORDER BY id")
    if args.limit:
        rows = rows[:args.limit]
    print(f'[{args.type}] {len(rows)} varlık')

    # Her varlık için (slug, [url, url, ...]) — MAX_IMAGES_PER_ENTITY ile kelepçeli, boş/bozuk
    # images JSON'u sessizce atlanır (0 görselli varlık dizine hiç girmez).
    jobs = []  # (entity_index, img_index_within_entity, slug, url)
    entities = []
    for ei, row in enumerate(rows):
        try:
            imgs = json.loads(row['images']) if row['images'] else []
            if not isinstance(imgs, list):
                imgs = []
        except Exception:
            imgs = []
        urls = []
        seen = set()
        for p in imgs:
            u = resolve_image_url(p)
            if not u or u in seen:
                continue
            seen.add(u)
            urls.append(u)
            if len(urls) >= MAX_IMAGES_PER_ENTITY:
                break
        entities.append({'slug': row['slug'], 'urls': urls, 'count': 0, 'keys': []})
        for ii, u in enumerate(urls):
            jobs.append((ei, ii, u))

    total_images = len(jobs)
    print(f'[{args.type}] toplam indirilecek/embed edilecek görsel: {total_images}')
    if not total_images:
        print(f'[{args.type}] hiç görsel yok, çıkılıyor.')
        return

    embedder = Embedder()
    vectors_by_entity = {ei: {} for ei in range(len(entities))}  # ei -> {ii: vector}
    lock = threading.Lock()
    done = [0]
    failed = [0]

    def worker(job):
        ei, ii, url = job
        try:
            img_bytes = fetch_image_bytes(url)
            vec = embedder.embed(img_bytes)
            with lock:
                vectors_by_entity[ei][ii] = vec
        except Exception as e:
            with lock:
                failed[0] += 1
            if failed[0] <= 20:
                print(f'\n  UYARI: {url} -> {e}', file=sys.stderr)
        with lock:
            done[0] += 1
            if done[0] % 50 == 0 or done[0] == total_images:
                print(f'\r[{args.type}] {done[0]}/{total_images} (hata: {failed[0]})   ', end='', flush=True)

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
        list(ex.map(worker, jobs))
    print()

    # Ardışık paketleme: yalnızca GERÇEKTEN embed edilmiş görseller yazılır (indirilemeyen/bozuk
    # olanlar o varlığın satır sayısını sessizce azaltır — brief madde 13: "missing/corrupt image"
    # tüm backfill'i düşürmemeli).
    all_vectors = []
    packed_entities = []
    empty_entities = 0
    for ei, e in enumerate(entities):
        vecs = vectors_by_entity[ei]
        ordered = [vecs[ii] for ii in sorted(vecs.keys())]
        if not ordered:
            empty_entities += 1
            continue
        packed_entities.append({'slug': e['slug'], 'count': len(ordered), 'keys': e['urls'][:len(ordered)]})
        all_vectors.extend(ordered)

    print(f'[{args.type}] {len(packed_entities)} varlık embed edildi, {empty_entities} varlığın hiç kullanılabilir görseli yok')
    print(f'[{args.type}] toplam satır: {len(all_vectors)}, paket boyutu ~{len(all_vectors)*DIM/1048576:.2f} MB')

    if args.dry_run:
        print(f'[{args.type}] --dry-run: KV\'ye yazılmadı.')
        return

    buf = pack_index(packed_entities, all_vectors, args.type)
    out_path = f'/tmp/imgindex-{args.type}.bin'
    with open(out_path, 'wb') as f:
        f.write(buf)
    print(f'[{args.type}] paket yazıldı: {out_path} ({len(buf)/1048576:.2f} MB)')

    kv_key = f'vsearch:imgindex:{args.type}:{INDEX_VERSION}'
    subprocess.run([
        'npx', 'wrangler', 'kv', 'key', 'put', kv_key,
        '--path', out_path, '--binding', 'FACET_CACHE', '--remote',
    ], cwd=ROOT, check=True)
    print(f'[{args.type}] KV\'ye yazıldı: {kv_key}')

if __name__ == '__main__':
    main()
