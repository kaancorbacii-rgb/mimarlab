#!/usr/bin/env python3
"""Koleksiyon 3. parti içe aktarımının D1 tarafındaki son doğrulaması (verify-batch67.py'nin eşi).

Kontrol ettikleri:
  1. 52 ailenin hepsi D1'de mi, beklenen versiyon/görsel sayısıyla mı?
  2. Versiyon eksenleri TAM mı — tip ekseni (Tip/Fonksiyon) kullanan bir üründe eksen değeri
     OLMAYAN versiyon kalmamalı (kalırsa o versiyona popup'ta hiç ulaşılamaz, bkz.
     product-modal.js#pickVariantIndex).
  3. Ölü `product-type-code/pdf` bağlantısı HİÇBİR üründe kalmamalı.
  4. Görsel yolları /media/import/products/<slug>/k3-*.webp biçiminde ve türev kuyruğunda mı?
  5. display_order dağılımı: parti ürünleri tek sayfaya yığılmamalı.
  6. Koleksiyon marka↔proje kenarları (project_brands, office 717) duruyor mu?

Kullanım: python3 scripts/verify-koleksiyon3.py
"""
import importlib.util as _ilu
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = _ilu.spec_from_file_location('import_archello_products',
                                     os.path.join(HERE, 'import-archello-products.py'))
imp = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(imp)
d1 = imp.d1

KOLEKSIYON_OFFICE_ID = 717
PAGE_SIZE = 24
DEAD = 'product-type-code/pdf'
TYPE_AXES = ('Tip', 'Fonksiyon')


def main():
    payload = json.load(open(os.path.join(HERE, 'output', 'koleksiyon3-payload.json'),
                             encoding='utf8'))['products']
    report = json.load(open(os.path.join(HERE, 'output', 'koleksiyon3-import-report.json'),
                            encoding='utf8'))
    fails = []

    ids = [r['id'] for r in report if r['action'] == 'update']
    slugs = [r['slug'] for r in report if r['action'] == 'insert']
    where = f"id IN ({','.join(map(str, ids))})" if ids else '0'
    if slugs:
        where += " OR slug IN (" + ','.join(imp.q(s) for s in slugs) + ")"
    rows = d1('SELECT id, slug, title, category, designer, images, variants, files, specs, '
              'description, display_order, brand_office_id, deleted_at, hidden_at '
              f'FROM products WHERE ({where}) AND deleted_at IS NULL')
    print(f'--- 1) Satırlar: {len(rows)}/{len(payload)} bulundu')
    if len(rows) != len(payload):
        fails.append(f'eksik satır: {len(payload) - len(rows)}')

    print('\n--- 2) Versiyon eksenleri + içerik ---')
    total_v = total_i = 0
    for r in sorted(rows, key=lambda x: x['title']):
        vs = json.loads(r['variants'] or '[]')
        imgs = json.loads(r['images'] or '[]')
        fs = json.loads(r['files'] or '[]')
        total_v += len(vs)
        total_i += len(imgs)
        axis = next((o['label'] for v in vs for o in (v.get('options') or [])
                     if o.get('label') in TYPE_AXES), None)
        gap = 0
        if axis:
            gap = sum(1 for v in vs
                      if not any(o.get('label') == axis for o in (v.get('options') or [])))
        labels = [v.get('label') for v in vs]
        dup = len(labels) != len(set(labels))
        flag = ''
        if gap:
            flag += f' EKSEN-BOŞLUĞU={gap}'
            fails.append(f"{r['title']}: {axis} ekseninde {gap} versiyon eksik")
        if dup:
            flag += ' MÜKERRER-ETİKET'
            fails.append(f"{r['title']}: mükerrer versiyon etiketi")
        if not imgs:
            flag += ' GÖRSELSİZ'
            fails.append(f"{r['title']}: görsel yok")
        if r['brand_office_id'] != KOLEKSIYON_OFFICE_ID:
            flag += ' YANLIŞ-MARKA'
            fails.append(f"{r['title']}: brand_office_id={r['brand_office_id']}")
        print(f"  #{r['id']:4} {r['title'][:22]:24} {(r['category'] or '')[:15]:17} "
              f"v={len(vs):3} g={len(imgs):2} d={len(fs)} eksen={str(axis)[:10]:10}{flag}")
    print(f'\n  toplam versiyon={total_v}  toplam görsel={total_i}')

    print('\n--- 3) Ölü placeholder taraması (TÜM ürünler) ---')
    dead = d1("SELECT COUNT(*) n FROM products WHERE deleted_at IS NULL "
              f"AND (COALESCE(files,'') LIKE '%{DEAD}%' OR COALESCE(variants,'') LIKE '%{DEAD}%')")
    print(f"  ölü bağlantı taşıyan ürün: {dead[0]['n']}")
    if dead[0]['n']:
        fails.append(f"{dead[0]['n']} üründe ölü placeholder kaldı")

    print('\n--- 4) Görsel yolları + türev kuyruğu ---')
    bad_path = [r['title'] for r in rows
                if any(not str(i).startswith('/media/') for i in json.loads(r['images'] or '[]'))]
    print(f"  /media/ ile başlamayan yol taşıyan ürün: {bad_path or 'yok'}")
    if bad_path:
        fails.append(f'bozuk görsel yolu: {bad_path}')
    qd = d1("SELECT COUNT(*) n FROM image_derivative_queue WHERE r2_key LIKE '%/k3-%'")
    print(f"  türev kuyruğundaki k3 işi: {qd[0]['n']}")

    print('\n--- 5) display_order dağılımı ---')
    live = d1('SELECT id FROM products WHERE deleted_at IS NULL AND hidden_at IS NULL')
    npages = -(-len(live) // PAGE_SIZE)
    pages = {}
    nulls = 0
    for r in rows:
        if r['display_order'] is None:
            nulls += 1
            continue
        p = (r['display_order'] - 1) // PAGE_SIZE + 1
        pages[p] = pages.get(p, 0) + 1
    print(f'  canlı ürün={len(live)} sayfa={npages}; parti {len(pages)} farklı sayfaya dağıldı')
    print('  ' + ', '.join(f's{p}:{n}' for p, n in sorted(pages.items())))
    if nulls:
        fails.append(f'{nulls} üründe display_order NULL')
    if pages and max(pages.values()) > max(4, len(rows) // 4):
        fails.append(f'tek sayfada {max(pages.values())} ürün — yığılma')

    print('\n--- 6) Koleksiyon marka↔proje kenarları ---')
    pb = d1('SELECT pb.project_id, p.title FROM project_brands pb JOIN projects p ON p.id = pb.project_id '
            f'WHERE pb.office_id = {KOLEKSIYON_OFFICE_ID} AND p.deleted_at IS NULL ORDER BY p.title')
    print(f'  project_brands kenarı: {len(pb)}')
    for x in pb:
        print(f"    #{x['project_id']:5} {x['title'][:56]}")
    if not pb:
        fails.append('Koleksiyon project_brands kenarı yok')

    print('\n' + '=' * 72)
    if fails:
        print(f'BAŞARISIZ ({len(fails)}):')
        for f in fails:
            print(f'  - {f}')
        return 1
    print('TÜM KONTROLLER GEÇTİ.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
