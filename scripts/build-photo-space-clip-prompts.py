#!/usr/bin/env python3
"""FOTOĞRAF sayfası — CLIP sıfır-atış (zero-shot) mekan sınıflarının METİN vektörlerini üretir.

NE İÇİN (kullanıcı isteği, 2026-09-18: "arama filtreleri için en doğru ve en çok sonuç için gereken
en iyi sistemi kur"): sitede ZATEN her proje görselinin CLIP embedding'i var (görsel arama dizini,
bkz. src/lib/imageEmbedIndex.js — KV'de `vsearch:imgindex:project:v1`). CLIP'in metin kodlayıcısı
AYNI uzaya yazar; "a photo of a bathroom" cümlesinin vektörü ile bir görselin vektörü arasındaki
kosinüs, o görselin banyo olma olasılığını verir. Yani GÖRSEL BAŞINA çalışan, ücretsiz ve anlık bir
mekan sinyali — künyenin (proje seviyesi) yapamadığı şey (bkz. src/lib/photoSpaceClip.js).

Workers metin kodlayıcısını çalıştıramaz; cümleler SABİT olduğundan buna gerek de yok: vektörler BİR
KEZ burada (offline) hesaplanır ve ÜRETİLMİŞ bir modül olarak depoya girer
(src/lib/photoSpaceClipVectors.js). Worker yalnızca nokta çarpımı yapar.

GİRDİ : scripts/photo-space-clip-classes.json  (sınıflar + İngilizce alt-kavram cümleleri + şablonlar)
ÇIKTI : src/lib/photoSpaceClipVectors.js       (int16 nicemlenmiş birim vektörler, base64)

NEDEN int16 (int8 DEĞİL): görsel tarafı zaten int8 (dizin biçimi, değiştirilemez) ve tek başına
olasılıklarda ~0,02'lik bir gürültü üretiyor; metin tarafını da int8 yapmak bunu ~0,04'e (p99 0,14)
çıkarıyordu (ölçüldü, 11.058 görsel). int16'da metin tarafının katkısı ölçülemeyecek kadar küçük.

MODEL: `Xenova/clip-vit-base-patch32` metin kodlayıcısı (fp32 ONNX) — görsel dizinini üreten görsel
kodlayıcının (bkz. scripts/build-image-embeddings.py) EŞİ. Başka bir CLIP sürümünün metin vektörleri
bu dizinle ANLAMSIZ sonuç verir.

KULLANIM (izole venv — depoya hiçbir bağımlılık EKLEMEZ, build-image-embeddings.py ile aynı desen):
    python3 -m venv /tmp/clip_env
    /tmp/clip_env/bin/pip install onnxruntime numpy tokenizers huggingface_hub
    /tmp/clip_env/bin/python scripts/build-photo-space-clip-prompts.py
"""
import base64
import hashlib
import json
import os

import numpy as np
import onnxruntime as ort
from huggingface_hub import hf_hub_download
from tokenizers import Tokenizer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLASSES_PATH = os.path.join(ROOT, 'scripts', 'photo-space-clip-classes.json')
OUT_PATH = os.path.join(ROOT, 'src', 'lib', 'photoSpaceClipVectors.js')
MODEL_DIR = os.environ.get('CLIP_MODEL_DIR', '/tmp/clip-model')
MODEL_LABEL = 'Xenova/clip-vit-base-patch32 (text, fp32)'
DIM = 512


def ensure_model():
    for f in ['tokenizer.json', 'onnx/text_model.onnx']:
        if not os.path.exists(os.path.join(MODEL_DIR, f)):
            print(f'indiriliyor: {f}')
            hf_hub_download(repo_id='Xenova/clip-vit-base-patch32', filename=f, local_dir=MODEL_DIR)


def main():
    ensure_model()
    raw = open(CLASSES_PATH, 'rb').read()
    cfg = json.loads(raw)
    tok = Tokenizer.from_file(os.path.join(MODEL_DIR, 'tokenizer.json'))
    sess = ort.InferenceSession(os.path.join(MODEL_DIR, 'onnx', 'text_model.onnx'), providers=['CPUExecutionProvider'])

    def embed(text):
        # Tek cümle, dolgusuz: CLIP metin kodlayıcısı nedensel (causal) dikkat kullanır ve havuzlama
        # EOS konumundan yapılır — dolgu gerekmediğinde sonuç dolgudan etkilenmez.
        ids = tok.encode(text).ids
        v = sess.run(None, {'input_ids': np.array([ids], dtype=np.int64)})[0][0]
        return v / np.linalg.norm(v)

    classes = list(cfg['classes'].keys())
    class_of, vecs = [], []
    for ci, name in enumerate(classes):
        for phrase in cfg['classes'][name]:
            # Şablon topluluğu (prompt ensembling): aynı alt-kavramın üç cümlesinin ortalaması.
            v = np.mean([embed(t.format(phrase)) for t in cfg['templates']], axis=0)
            v /= np.linalg.norm(v)
            class_of.append(ci)
            vecs.append(v)
    mat = np.stack(vecs).astype(np.float64)
    q = np.clip(np.round(mat * 32767), -32767, 32767).astype('<i2')
    b64 = base64.b64encode(q.tobytes()).decode('ascii')
    digest = hashlib.sha256(raw).hexdigest()[:16]

    lines = [
        '// ÜRETİLMİŞ DOSYA — ELLE DÜZENLEMEYİN.',
        '// Kaynak: scripts/photo-space-clip-classes.json -> scripts/build-photo-space-clip-prompts.py',
        '// (CLIP metin kodlayıcısı offline çalışır; Worker yalnızca bu sabit vektörlerle nokta çarpımı yapar —',
        '// gerekçe ve biçim için bkz. src/lib/photoSpaceClip.js).',
        f"export const CLIP_PROMPT_MODEL = '{MODEL_LABEL}';",
        f'export const CLIP_PROMPT_DIM = {DIM};',
        f"export const CLIP_PROMPT_SOURCE_SHA = '{digest}';",
        f'export const CLIP_PROMPT_CLASSES = {json.dumps(classes, ensure_ascii=False)};',
        f'export const CLIP_PROMPT_CLASS_OF = {json.dumps(class_of)};',
        '// int16 LE, birim vektör × 32767, satır başına CLIP_PROMPT_DIM bileşen.',
        "export const CLIP_PROMPT_VECTORS_B64 =",
    ]
    chunks = [b64[i:i + 120] for i in range(0, len(b64), 120)]
    body = ' +\n'.join(f"  '{c}'" for c in chunks) + ';\n'
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n' + body)
    print(f'{len(vecs)} vektör / {len(classes)} sınıf -> {OUT_PATH} ({os.path.getsize(OUT_PATH) // 1024} KB), kaynak özeti {digest}')


if __name__ == '__main__':
    main()
