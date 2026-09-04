#!/usr/bin/env python3
"""B&T Design ürünlerini proje fotoğraflarının ÜZERİNDE daire işaretçiyle etiketler.

KULLANICI İSTEĞİ (2026-09-04): "B&T Design için projelerde yaptığın marka ve ürün seçimlerini
proje görsellerinde etiketle. Yani görsellerde ürünleri tespit et ve üzerlerine hangi ürün
olduklarını gösteren daire etiketlemesinden yap."

Veri biçimi `projects.image_hotspots` (bkz. migrations/0076_project_image_hotspots.sql):
  { "<görsel url>": [ {"x": 0-100, "y": 0-100, "slug": "urun-slug", "title": "Ürün Adı"} ] }
x/y GÖRSELİN KENDİ kutusuna göre yüzdedir.

İŞARETÇİLER ELLE KONULUR, OTOMATİK DEĞİL. Her kare tek tek incelendi ve yalnızca ürün MODELİ
kesin teşhis edilebildiğinde işaretçi konuldu. Teşhisi kolaylaştıran iki şey: (a) o projede
kullanıldığı bt.design'ın kendi proje sayfasından bilinen ADAY ÜRÜN listesi, (b) markanın dekupe
render'larından üretilen referans föyü. Emin olunmayan kareye işaretçi KONULMADI — yanlış yere
konmuş bir daire, hiç işaretçi olmamasından kötüdür (aynı gerekçe: crosstag-btdesign-projects.py).

Betik YENİDEN ÇALIŞTIRILABİLİR: aynı (görsel, slug) çifti iki kez yazılmaz, mevcut işaretçiler
korunur (başka bir markanın işaretçileri de dahil).

Kullanım:
  python3 scripts/btdesign-project-hotspots.py [--dry-run]
"""

import argparse
import importlib.util as _ilu
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

_spec = _ilu.spec_from_file_location('import_archello_products',
                                     os.path.join(HERE, 'import-archello-products.py'))
imp = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(imp)
q, d1, d1_file = imp.q, imp.d1, imp.d1_file

# proje id -> { görsel indeksi: [ (x%, y%, ürün slug) ] }
# Görsel indeksi projects.images dizisindeki sıradır; URL'ye betik içinde çevrilir.
HOTSPOTS = {
    # --- Agave Games Ofisleri (BuildUp) ------------------------------------------------------
    1485: {
        0: [  # açık ofis — ön planda üç Zenger puf
            (59.4, 68.5, 'zenger-puf-b-t-design'),
            (71.7, 76.7, 'zenger-puf-b-t-design'),
            (79.1, 68.5, 'zenger-puf-b-t-design'),
        ],
        2: [  # giriş/lounge — kavisli gri kanepe + yuvarlak puf
            (60.6, 70.5, 'zen-kanepe-b-t-design'),
            (43.9, 64.9, 'drage-sehpa-ve-ortak-oturum-ailesi-b-t-design'),
        ],
        4: [  # çalışma alanı — oturan kişinin altındaki Zenger + sağda yuvarlak puf
            (37.8, 60.1, 'zenger-puf-b-t-design'),
            (79.8, 63.1, 'drage-sehpa-ve-ortak-oturum-ailesi-b-t-design'),
        ],
    },
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    ids = ','.join(str(i) for i in HOTSPOTS)
    projects = {r['id']: r for r in d1(
        f'SELECT id, slug, title, images, image_hotspots FROM projects WHERE id IN ({ids})')}
    titles = {r['slug']: r['title'] for r in d1(
        'SELECT slug, title FROM products WHERE brand_office_id = 770 AND deleted_at IS NULL')}

    stmts, added = [], 0
    for pid, per_image in HOTSPOTS.items():
        pr = projects.get(pid)
        if not pr:
            print(f'  UYARI proje yok: {pid}')
            continue
        images = json.loads(pr['images'] or '[]')
        cur = json.loads(pr['image_hotspots'] or '{}') if pr['image_hotspots'] else {}
        for idx, dots in per_image.items():
            if idx >= len(images):
                print(f'  UYARI {pid}: görsel indeksi {idx} yok ({len(images)} görsel)')
                continue
            url = images[idx]
            lst = cur.setdefault(url, [])
            for x, y, slug in dots:
                if slug not in titles:
                    print(f'  UYARI ürün yok: {slug}')
                    continue
                # Aynı görselde aynı ürün iki kez işaretlenebilir (ör. üç Zenger puf) — bu yüzden
                # tekilleştirme (slug, x, y) üçlüsüne göre yapılır, yalnızca slug'a göre DEĞİL.
                if any(abs(d.get('x', -1) - x) < 0.5 and abs(d.get('y', -1) - y) < 0.5
                       and d.get('slug') == slug for d in lst):
                    continue
                lst.append({'x': x, 'y': y, 'slug': slug, 'title': titles[slug]})
                added += 1
        blob = json.dumps(cur, ensure_ascii=False)
        stmts.append(f"UPDATE projects SET image_hotspots = {q(blob)}, "
                     f"updated_at = datetime('now') WHERE id = {pid};")
        print(f"  {pr['title'][:44]:46} işaretçi taşıyan görsel: {len(cur)}")

    print(f'\n{added} yeni işaretçi / {len(stmts)} proje')
    if args.dry_run:
        print('[dry-run] yazılmadı.')
        return 0
    for st in stmts:
        d1_file(st)          # proje başına ayrı çağrı (bkz. fix-btdesign-variant-image-order.py)
    print('yazıldı.')

    for pid in HOTSPOTS:
        r = d1(f'SELECT title, image_hotspots FROM projects WHERE id = {pid}')[0]
        h = json.loads(r['image_hotspots'] or '{}')
        print(f"  doğrulama {r['title'][:40]:42} {sum(len(v) for v in h.values())} işaretçi "
              f"/ {len(h)} görsel")
    return 0


if __name__ == '__main__':
    sys.exit(main())
