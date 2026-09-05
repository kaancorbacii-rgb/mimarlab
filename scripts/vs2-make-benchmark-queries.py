#!/usr/bin/env python3
"""VISUAL SEARCH V2 — benchmark SORGU VEKTÖRLERİ üreteci (TEST A-H, brief madde 19).

Gerçek production görsellerinden, gerçek CLIP modeliyle sorgu embedding'leri üretir. Hiçbir şey
uydurulmaz: her sorgu, D1'de kayıtlı GERÇEK bir proje/ürün görselinin kendisidir (ya da onun
resize/re-encode/crop edilmiş hâli).

TEST SENARYOLARI (brief madde 19 ile birebir):
  A  cover OLMAYAN 2./3. galeri görseli            -> ilgili proje Top1
  B  aynı projenin BAŞKA bir galeri görseli        -> Top1/Top5
  B2 6. INDEKSTEN SONRAKİ görsel (eski sistemin    -> Top1  (V2'nin ana hedefi; eski indekste
     hiç göremediği kare)                              bu görseller YOKTU)
  C  %50 resize edilmiş aynı görsel                -> Top1
  D  JPEG->WebP yeniden kodlama                    -> yüksek sıra
  E  %70 merkez crop                               -> Top5
  F  aynı yapının FARKLI açıdan karesi (aynı proje  -> yüksek sıra
     içindeki uzak indeksli başka kare ile temsil)
  G  tamamen ilgisiz görsel (sentetik gürültü)     -> eşik altı (no-result)
  H  benzer mimari ama FARKLI proje (aynı kategori/ -> gerçek eşleşme daha yüksek
     şehirdeki başka projenin karesi)

ÇIKTI: scripts/output/vs2-bench-queries.json
  [{id, test, expectSlug, kind:'project'|'product', vec:[512 float], srcUrl, imageIndex}]

KULLANIM (venv ŞART — onnxruntime + pillow):
  /tmp/clip_env/bin/python3 scripts/vs2-make-benchmark-queries.py [--projects 60] [--products 20]
"""
import argparse
import importlib.util as _ilu
import io
import json
import os
import random
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))

# build-image-embeddings.py'yi MODÜL olarak yükle — Embedder/quantize/D1/URL çözümleme mantığının
# TEK kaynağı orası olsun (kopyalanırsa iki taraf zamanla ayrışır ve benchmark yalan söyler).
_spec = _ilu.spec_from_file_location('bie', os.path.join(HERE, 'build-image-embeddings.py'))
bie = _ilu.module_from_spec(_spec)
sys.argv = [sys.argv[0]]          # modülün kendi argparse'ı tetiklenmesin
_spec.loader.exec_module(bie)

OUT = os.path.join(HERE, 'output', 'vs2-bench-queries.json')
random.seed(20260905)             # tekrarlanabilir örneklem


def load_bytes(url):
    return bie.fetch_image_bytes(url)


def variant(img_bytes, kind):
    """Aynı görselin dönüştürülmüş hâli. CLIP'e giden baytları üretir."""
    im = Image.open(io.BytesIO(img_bytes))
    im = im.convert('RGB')
    buf = io.BytesIO()
    if kind == 'resize':
        im = im.resize((max(32, im.width // 2), max(32, im.height // 2)), Image.LANCZOS)
        im.save(buf, format='JPEG', quality=90)
    elif kind == 'webp':
        im.save(buf, format='WEBP', quality=80)
    elif kind == 'crop':
        w, h = im.size
        cw, ch = int(w * 0.70), int(h * 0.70)
        left, top = (w - cw) // 2, (h - ch) // 2
        im.crop((left, top, left + cw, top + ch)).save(buf, format='JPEG', quality=92)
    else:
        im.save(buf, format='JPEG', quality=95)
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--projects', type=int, default=60)
    ap.add_argument('--products', type=int, default=20)
    args = ap.parse_args()

    print('D1 okunuyor...')
    prows = bie.d1_query(
        "SELECT slug, images, category, location FROM projects "
        "WHERE deleted_at IS NULL AND hidden_at IS NULL AND build_status='built' "
        "AND images IS NOT NULL AND images NOT IN ('','[]') ORDER BY id")
    drows = bie.d1_query(
        "SELECT slug, images FROM products WHERE deleted_at IS NULL AND hidden_at IS NULL "
        "AND images IS NOT NULL AND images NOT IN ('','[]') ORDER BY id")

    def urls_of(row):
        try:
            arr = json.loads(row['images']) or []
        except Exception:
            return []
        out, seen = [], set()
        for p in arr:
            u = bie.resolve_image_url(p)
            if u and u not in seen:
                seen.add(u)
                out.append(u)
        return out

    projects = [(r, urls_of(r)) for r in prows]
    rich = [(r, u) for r, u in projects if len(u) >= 8]      # A/B/B2/C/D/E/F için yeterli kare
    print(f'{len(prows)} proje, {len(rich)} tanesi >=8 görselli')
    sample = random.sample(rich, min(args.projects, len(rich)))

    embedder = bie.Embedder()
    queries = []

    def add(qid, test, slug, kind, vec, src, idx):
        queries.append({'id': qid, 'test': test, 'expectSlug': slug, 'kind': kind,
                        'vec': [float(x) for x in vec], 'srcUrl': src, 'imageIndex': idx})

    def embed_url(url, transform=None):
        raw = load_bytes(url)
        return embedder.embed(variant(raw, transform) if transform else raw)

    for n, (row, urls) in enumerate(sample, 1):
        slug = row['slug']
        try:
            # A: 2. görsel (cover DEĞİL, eski indekste VARDI)
            add(f'A{n}', 'A', slug, 'project', embed_url(urls[1]), urls[1], 1)
            # B: 4. görsel (eski indekste VARDI)
            add(f'B{n}', 'B', slug, 'project', embed_url(urls[3]), urls[3], 3)
            # B2: 8. görsel — eski indeksin GÖREMEDİĞİ bölge (V2'nin ana hedefi)
            add(f'B2{n}', 'B2', slug, 'project', embed_url(urls[7]), urls[7], 7)
            # C/D/E: 3. görselin dönüşümleri
            raw = load_bytes(urls[2])
            add(f'C{n}', 'C', slug, 'project', embedder.embed(variant(raw, 'resize')), urls[2], 2)
            add(f'D{n}', 'D', slug, 'project', embedder.embed(variant(raw, 'webp')), urls[2], 2)
            add(f'E{n}', 'E', slug, 'project', embedder.embed(variant(raw, 'crop')), urls[2], 2)
            # F: aynı projenin EN UZAK karesi — "farklı açı" vekili (gerçek farklı-açı çekimi
            #    etiketli bir veri kümemiz yok; aynı projenin son karesi pratikte farklı açı/mekân)
            add(f'F{n}', 'F', slug, 'project', embed_url(urls[-1]), urls[-1], len(urls) - 1)
        except Exception as e:
            print(f'  atlandı {slug}: {e}')
        if n % 5 == 0:
            print(f'  {n}/{len(sample)} proje işlendi ({len(queries)} sorgu)')

    # G: tamamen ilgisiz — deterministik sentetik gürültü (hiçbir projeye ait DEĞİL)
    rng = np.random.default_rng(7)
    for i in range(5):
        noise = (rng.random((320, 320, 3)) * 255).astype('uint8')
        buf = io.BytesIO()
        Image.fromarray(noise).save(buf, format='JPEG', quality=88)
        add(f'G{i+1}', 'G', None, 'project', embedder.embed(buf.getvalue()), 'synthetic-noise', -1)

    # Ürün tarafı — REGRESYON koruması (brief madde 16: ürün pipeline'ı bozulmamalı)
    prich = [(r, u) for r, u in ((r, urls_of(r)) for r in drows) if len(u) >= 2]
    for n, (row, urls) in enumerate(random.sample(prich, min(args.products, len(prich))), 1):
        try:
            add(f'P{n}', 'PROD', row['slug'], 'product', embed_url(urls[0]), urls[0], 0)
            add(f'P{n}b', 'PROD', row['slug'], 'product', embed_url(urls[1]), urls[1], 1)
        except Exception as e:
            print(f'  ürün atlandı {row["slug"]}: {e}')

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(queries, open(OUT, 'w'), ensure_ascii=False)
    from collections import Counter
    print(f'\n{len(queries)} sorgu -> {OUT}')
    print('test dağılımı:', dict(Counter(q["test"] for q in queries)))


if __name__ == '__main__':
    main()
