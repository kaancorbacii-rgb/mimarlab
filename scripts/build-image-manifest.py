#!/usr/bin/env python3
"""scripts/generate-image-derivatives.py için iş listesi (manifest) üretir.

Kaynak: canlı D1 — sitenin GERÇEKTEN render ettiği görsel referansları (projects.images,
products.images, architects.photo_url, offices.logo_url/cover_url). R2 nesnelerini listelemek
YERİNE D1 okunur; böylece hiçbir satırdan referans edilmeyen "orphan" R2 nesnelerine (bkz.
src/lib/r2Reconcile.js) boşuna türev üretilmez.

İKİ AŞAMA — sıralama performans önceliğine göre (bkz. kullanıcı isteği 2026-09-01, madde 18):
  stage1  images[0] (kart/karusel kapakları) + mimar fotoğrafları + firma logo/kapakları.
          Ana sayfa, TÜM liste sayfaları, arama sonuçları, En İyi 100 ve pop-up'lardaki ilgili-
          içerik ızgaraları YALNIZCA bu görselleri gösterir — yani ölçülebilir kazancın neredeyse
          tamamı buradadır.
  stage2  images[1:] (yalnızca proje/ürün pop-up'ı açıldığında görünen galeri kareleri).

Mutlak yazılmış AMA bize ait URL'ler ("https://mimarlab.com/media/...") göreli yola indirgenip
LİSTEYE DAHİL EDİLİR (bkz. to_local) — canlıda kapakların 443'ü, galeri karelerinin 7.503'ü bu
biçimde saklanmış. Gerçekten BAŞKA bir host'a ait URL'ler hariç tutulur: onları R2'ye kopyalamak
hem telif hem depolama açısından yanlış olur.

YENİ YÜKLEMELER: bu script yeniden çalıştırıldığında yeni eklenen görseller kendiliğinden listeye
girer ve generate-image-derivatives.py idempotent olduğundan yalnızca EKSİK türevler üretilir.

KULLANIM
    python3 scripts/build-image-manifest.py --outdir /tmp/derivmanifest
"""

import argparse
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def d1(sql):
    p = subprocess.run(
        ['npx', 'wrangler', 'd1', 'execute', 'mimarlab-db', '--remote', '--json', '--command', sql],
        cwd=ROOT, capture_output=True, text=True)
    if p.returncode != 0:
        raise SystemExit(f'D1 sorgusu başarısız:\n{p.stderr[:800]}')
    return json.loads(p.stdout)[0]['results']


SITE_HOSTS = {'mimarlab.com', 'www.mimarlab.com'}


def to_local(u):
    """Bizim servis ettiğimiz bir yola indirger, değilse None.

    GERÇEK BULGU: projects.images / products.images KARIŞIK yazılmış — bazı satırlarda mutlak
    ("https://mimarlab.com/media/projects/x.webp"), bazılarında göreli ("/media/u/.../x.webp").
    Bu normalizasyon olmadan mutlak yazılmış satırlar (canlıda 443 kapak + 7.503 galeri karesi,
    yani tümü BİZE ait görseller) "harici" sanılıp iş listesinden tamamen düşüyordu — ana sayfanın
    LCP görseli tam olarak bu gruptaydı. image-cdn.js#toLocalPath ile AYNI kural.
    """
    if not isinstance(u, str) or not u:
        return None
    if u.startswith(('data:', 'blob:')):
        return None
    if u.startswith(('http://', 'https://', '//')):
        from urllib.parse import urlparse
        parsed = urlparse(u if not u.startswith('//') else 'https:' + u)
        if parsed.netloc not in SITE_HOSTS:
            return None
        return parsed.path
    return u


def is_local(u):
    return to_local(u) is not None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--outdir', required=True)
    args = ap.parse_args()
    os.makedirs(args.outdir, exist_ok=True)

    covers, gallery = [], []
    for table in ('projects', 'products'):
        rows = d1(f"SELECT images FROM {table} WHERE deleted_at IS NULL "
                  f"AND images IS NOT NULL AND images != '[]'")
        for r in rows:
            try:
                arr = [p for p in (to_local(x) for x in (json.loads(r['images']) or [])) if p]
            except (ValueError, TypeError):
                arr = []
            if arr:
                covers.append(arr[0])
                gallery.extend(arr[1:])

    profiles = []
    for sql in ("SELECT photo_url AS u FROM architects WHERE deleted_at IS NULL AND photo_url IS NOT NULL AND photo_url != ''",
                "SELECT logo_url AS u FROM offices WHERE deleted_at IS NULL AND logo_url IS NOT NULL AND logo_url != ''",
                "SELECT cover_url AS u FROM offices WHERE deleted_at IS NULL AND cover_url IS NOT NULL AND cover_url != ''"):
        profiles.extend(p for p in (to_local(r.get('u')) for r in d1(sql)) if p)

    stage1 = sorted(set(covers) | set(profiles))
    stage2 = sorted(set(gallery) - set(stage1))

    p1 = os.path.join(args.outdir, 'manifest-stage1.txt')
    p2 = os.path.join(args.outdir, 'manifest-stage2.txt')
    with open(p1, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(stage1))
    with open(p2, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(stage2))
    print(f'stage1 (kapak + profil/logo): {len(stage1):6d} -> {p1}')
    print(f'stage2 (galeri kareleri)    : {len(stage2):6d} -> {p2}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
