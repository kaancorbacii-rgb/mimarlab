#!/usr/bin/env python3
"""Bürotime ürünleri için proje galerisi üzerinde görsel işaretçileri (hotspot) yazar.

Şema (migrations/0076_project_image_hotspots.sql): `projects.image_hotspots` =
`{ "<görsel URL>": [ {x,y,slug,title} ] }`. x/y GÖRSELİN KENDİSİNE göre yüzdedir (kapsayıcıya
göre değil — bkz. js/components/image-hotspots.js "katman kutusu"). URL anahtarı, projenin
`images` dizisindeki DEĞERİN BİREBİR AYNISI olmalıdır; sıralama değişebildiği için indeks
kullanılmaz.

İŞARETÇİ NEDEN AZ (3 adet)
--------------------------
İşaretçi koymak "bu piksel bu üründür" iddiasıdır; marka etiketinden daha güçlü bir iddia.
Bu turda 6 proje eşleşti, ancak yalnızca ÜÇ karede bir Bürotime ürünü fotoğraftan KESİN olarak
tanınabildi (ürün fotoğrafıyla birebir karşılaştırılarak):
  * Mersin Şehir Hastanesi'nin oditoryum/eğitim salonu kareleri -> "Crab" seminer sandalyesi:
    file sırt + sağ kolçakta katlanır yazı tablası + krom dört ayak + tekerlek; Bürotime'ın
    crab ürün fotoğraflarıyla birebir.
  * Çukurova Kalkınma Ajansı yönetici odası -> "Hills": ince siyah metal kızak kasa üzerinde
    köşeli kolçaklı üçlü kanepe; Bürotime'ın hills fotoğraflarıyla aynı tasarım dili ve
    Bürotime'ın KENDİ proje fotoğrafı (cukurova-kalkinma-ajansi-7) aynı odayı gösteriyor.
Talu Tekstil'in toplantı odasındaki deve tüyü deri koltuklar için Bürotime hem "Foldit
Operasyonel" hem "Magnate Operasyonel"i listeliyor; fotoğraftan hangisi olduğu ayırt
EDİLEMEDİĞİNDEN işaretçi KONMADI (yanlış ürünü işaretlemek, işaretlememekten kötüdür). Troya
Müzesi'nin D1 galerisi yalnızca dış cephe + fuayeyi içeriyor, Bürotime'ın döşediği oditoryum ve
kütüphane kareleri galeride YOK.

Mevcut `image_hotspots` içeriği KORUNUR; yalnızca bu betiğin ürettiği anahtarlar eklenir.
Görsel başına en fazla 4 işaretçi (submissionTypes.js#sanitizeImageHotspots ile aynı tavan).

Kullanım: python3 scripts/import-burotime-hotspots.py [--dry-run]
"""
import argparse
import importlib.util as _ilu
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = _ilu.spec_from_file_location('import_archello_products',
                                     os.path.join(HERE, 'import-archello-products.py'))
imp = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(imp)
d1, d1_file, q = imp.d1, imp.d1_file, imp.q

MAX_HOTSPOTS_PER_IMAGE = 4

# proje id -> [(görselin `images` dizisindeki 1-tabanlı sırası, x%, y%, ürün başlığı, dayanak)]
SPOTS = {
    710: [
        (24, 63.0, 79.0, 'Crab', 'oditoryum: file sırtlı, katlanır yazı tablalı seminer sandalyesi'),
        (25, 60.0, 86.0, 'Crab', 'eğitim salonu ön sıra: aynı sandalye, kolçak tablası açık'),
    ],
    1119: [
        (25, 17.0, 73.0, 'Hills', 'yönetici odası: ince metal kızak kasalı kırmızı üçlü kanepe'),
    ],
}
BUROTIME_OFFICE_ID = 771


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    titles = sorted({t for lst in SPOTS.values() for _, _, _, t, _ in lst})
    lst = ', '.join("'" + t.replace("'", "''") + "'" for t in titles)
    prod = {r['title']: r for r in d1(
        f'SELECT id, slug, title FROM products WHERE deleted_at IS NULL '
        f'AND brand_office_id = {BUROTIME_OFFICE_ID} AND title IN ({lst})')}
    missing = [t for t in titles if t not in prod]
    if missing:
        raise SystemExit(f'D1de bulunamayan Bürotime ürünü: {missing}')
    for t, r in prod.items():
        print(f"  ürün {t:10} -> #{r['id']} /{r['slug']}")

    rows = {r['id']: r for r in d1(
        'SELECT id, title, images, image_hotspots FROM projects '
        f"WHERE id IN ({','.join(map(str, SPOTS))}) AND deleted_at IS NULL")}

    stmts, total = [], 0
    for pid, spots in SPOTS.items():
        r = rows.get(pid)
        if r is None:
            print(f'  UYARI: proje #{pid} D1de yok — ATLANDI')
            continue
        images = json.loads(r['images'] or '[]')
        current = json.loads(r['image_hotspots'] or '{}')
        if not isinstance(current, dict):
            current = {}
        for idx, x, y, title, why in spots:
            if not (1 <= idx <= len(images)):
                print(f'  UYARI: #{pid} görsel sırası {idx} yok ({len(images)} görsel) — ATLANDI')
                continue
            url = images[idx - 1]
            bucket = current.setdefault(url, [])
            p = prod[title]
            if any(h.get('slug') == p['slug'] for h in bucket):
                print(f"  #{pid} {url.rsplit('/', 1)[-1]:44} {title} ZATEN VAR")
                continue
            if len(bucket) >= MAX_HOTSPOTS_PER_IMAGE:
                print(f'  #{pid} {url} tavan doldu — ATLANDI')
                continue
            bucket.append({'x': x, 'y': y, 'slug': p['slug'], 'title': p['title']})
            total += 1
            print(f"  #{pid} {url.rsplit('/', 1)[-1]:44} + {title} @({x},{y})  {why}")
        stmts.append(f"UPDATE projects SET image_hotspots = "
                     f"{q(json.dumps(current, ensure_ascii=False))}, updated_at = datetime('now') "
                     f'WHERE id = {pid};')

    print(f'\n{total} yeni işaretçi, {len(stmts)} proje güncellenecek.')
    if args.dry_run:
        print('[dry-run] yazılmadı.')
        return 0
    if stmts:
        d1_file('\n'.join(stmts))
        print('yazıldı.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
