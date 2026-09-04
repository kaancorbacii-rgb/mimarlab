#!/usr/bin/env python3
"""B&T Design partisinin D1'deki sonucunu doğrular (salt okunur).

Kontrol ettikleri:
  1. 62 ana ürünün hepsi var mı, versiyon sayıları payload ile birebir tutuyor mu?
  2. Her ürünün kapak görseli (images[0]) dolu mu — katalog kartı boş kalmaz mı?
  3. Versiyon görselleri /media/import/products/... yoluna yazılmış mı, kırık/boş var mı?
  4. Her versiyonda ÖLÇÜ spec'i (Genişlik) var mı — versiyon seçicisinin asıl vaadi bu.
  5. Seçenek eksenleri (options) en az iki değerli mi — hap butonları gerçekten çıkacak mı?
  6. Güncellenen 4 satırda ESKİ küratörlü spec'ler (İskelet/Dolgu/Ayak) korunmuş mu?
  7. Tüm ürünler B&T Design'a (offices.id=770) bağlı mı?
  8. Katalog sırası (id DESC) kategoriler arası karışık mı?
  9. Çapraz etiketleme: project_products + project_brands kenarları yazıldı mı, çift yönlü mü?

Kullanım:
  python3 scripts/verify-btdesign.py
"""

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
d1 = imp.d1

from btdesign_families import BRAND_OFFICE_ID  # noqa: E402

payload = json.load(open(os.path.join(HERE, 'output', 'btdesign-payload.json'), encoding='utf8'))
want = {p['slug']: p for p in payload['products']}
upd_ids = {p['update_id'] for p in payload['products'] if p.get('update_id')}

fail = []


def check(cond, msg):
    print(('  OK   ' if cond else '  HATA ') + msg)
    if not cond:
        fail.append(msg)


print('--- 1) Ürünler ve versiyon sayıları ---')
slugs = ','.join("'" + s.replace("'", "''") + "'" for s in want)
rows = d1(f"""SELECT id, slug, title, brand_name_raw, brand_office_id, category, images, specs,
       variants, files, description, designer
FROM products WHERE deleted_at IS NULL
  AND (slug IN ({slugs}) OR id IN ({','.join(str(i) for i in upd_ids)}))""")
by_slug = {r['slug']: r for r in rows}
by_id = {r['id']: r for r in rows}
check(len(rows) == len(want), f"{len(rows)}/{len(want)} ürün satırı bulundu")

bad_count = []
for s, w in want.items():
    r = by_slug.get(s) or by_id.get(w.get('update_id'))
    if not r:
        bad_count.append(f'{s} (satır yok)')
        continue
    n = len(json.loads(r['variants'] or '[]'))
    if n != len(w['variants']):
        bad_count.append(f"{r['title']}: D1={n} payload={len(w['variants'])}")
check(not bad_count, f'versiyon sayıları tutuyor{"" if not bad_count else ": " + str(bad_count[:5])}')

print('\n--- 2) Kapak görselleri ---')
nocover = [r['title'] for r in rows if not json.loads(r['images'] or '[]')]
check(not nocover, f'kapağı olmayan ürün: {len(nocover)} {nocover[:5]}')

print('\n--- 3) Görsel yolları ---')
bad_paths, total_imgs = [], 0
for r in rows:
    imgs = json.loads(r['images'] or '[]')
    for v in json.loads(r['variants'] or '[]'):
        imgs = imgs + (v.get('images') or [])
    total_imgs += len(imgs)
    for p in imgs:
        if not isinstance(p, str) or not p.startswith('/media/'):
            bad_paths.append(f"{r['title']}: {p}")
check(not bad_paths, f'{total_imgs} görsel yolu; hatalı: {len(bad_paths)} {bad_paths[:3]}')
novimg = [(r['title'], v['label']) for r in rows for v in json.loads(r['variants'] or '[]')
          if not (v.get('images') or [])]
check(not novimg, f'görselsiz versiyon: {len(novimg)} {novimg[:4]}')

print('\n--- 4) Ölçü spec\'leri (teknik föyden okunan) ---')
nodim = [(r['title'], v['label']) for r in rows for v in json.loads(r['variants'] or '[]')
         if not any(s.get('label') == 'Genişlik' for s in (v.get('specs') or []))]
check(not nodim, f'ölçüsüz versiyon: {len(nodim)} {nodim[:4]}')

print('\n--- 5) Versiyon seçicisi eksenleri ---')
noswitch = []
for r in rows:
    vs = json.loads(r['variants'] or '[]')
    if len(vs) < 2:
        continue                      # tek versiyonlu üründe seçici zaten gizlenir
    groups = {}
    for v in vs:
        for o in (v.get('options') or []):
            groups.setdefault(o['label'], set()).add(o['value'])
    if not any(len(vals) > 1 for vals in groups.values()):
        noswitch.append(r['title'])   # buildVariantGroups "Versiyon" adlarına düşer, yine çalışır
check(not noswitch, f'çok değerli ekseni olmayan (etiket listesine düşecek) ürün: '
                    f'{len(noswitch)} {noswitch[:4]}')

print('\n--- 6) Güncellenen satırlarda küratörlü spec korunumu ---')
KEEP = {189: 'İskelet', 191: 'Tip', 192: 'İskelet', 193: 'İskelet'}
for pid, label in KEEP.items():
    r = by_id.get(pid)
    if not r:
        check(False, f'id={pid} satırı bulunamadı')
        continue
    specs = json.loads(r['specs'] or '[]')
    has = any(s.get('label') == label for s in specs)
    check(has, f"id={pid} ({r['title']}) ana spec'lerinde {label!r} korunmuş")
    vs = json.loads(r['variants'] or '[]')
    inv = all(any(s.get('label') == label for s in (v.get('specs') or [])) for v in vs)
    check(inv, f"id={pid} her versiyonuna {label!r} kopyalanmış ({len(vs)} versiyon)")

print('\n--- 7) Marka bağı ---')
wrong = [r['title'] for r in rows if r['brand_office_id'] != BRAND_OFFICE_ID]
check(not wrong, f'offices.id={BRAND_OFFICE_ID} dışına bağlı ürün: {len(wrong)} {wrong[:4]}')

print('\n--- 8) Katalog sırası (id DESC) ---')
# ÖLÇÜM PENCERESİ BU PARTİNİN KENDİ id BLOĞUDUR. İlk sürüm "katalogun ilk 80 satırı" diye
# ölçüyordu ve 11 tekrar sayıp düşüyordu — ama 10'u batch67'nin (id 467-488) kendi içindeki
# tekrarlarıydı, bu içe aktarımın ne sebebi ne de sorumluluğu. Bir partinin serpiştirmesi
# yalnızca KENDİ yazdığı satırların sırasını kontrol edebilir; blok sınırındaki tek komşuluk
# (bu partinin en eski satırı ile önceki partinin en yeni satırı) da hiçbir shuffle'ın
# etkileyemeyeceği bir sınır olayıdır, ayrıca raporlanır.
new_ids = [r['id'] for r in rows if r['id'] not in upd_ids]
lo, hi = min(new_ids), max(new_ids)
block = d1(f'SELECT id, category FROM products WHERE deleted_at IS NULL AND hidden_at IS NULL '
           f'AND id BETWEEN {lo} AND {hi} ORDER BY id DESC')
runs = sum(1 for a, b in zip(block, block[1:]) if a['category'] == b['category'])
check(runs <= 1, f'bu partinin id bloğunda ({lo}-{hi}, {len(block)} satır, {len(block) - 1} '
                 f'komşuluk) aynı-kategori çifti: {runs}')
prev_row = d1(f'SELECT category FROM products WHERE deleted_at IS NULL AND hidden_at IS NULL '
              f'AND id < {lo} ORDER BY id DESC LIMIT 1')
if prev_row and block:
    same = prev_row[0]['category'] == block[-1]['category']
    print(f"  bilgi  blok sınırı (önceki parti ile): "
          f"{'aynı kategori' if same else 'farklı kategori'} — shuffle'ın kontrolü dışında")

print('\n--- 9) Çapraz etiketleme ---')
ids = ','.join(str(r['id']) for r in rows)
pp = d1(f'SELECT COUNT(*) n, COUNT(DISTINCT project_id) np FROM project_products '
        f'WHERE product_id IN ({ids})')[0]
pb = d1(f'SELECT COUNT(*) n FROM project_brands WHERE office_id = {BRAND_OFFICE_ID}')[0]
check(pp['n'] > 0, f"project_products: {pp['n']} kenar / {pp['np']} proje")
check(pb['n'] > 0, f"project_brands: {pb['n']} proje")
# Çift yönlülük: proje popup'ı ürünü, marka popup'ı projeyi görüyor mu (okuma sorgularının aynısı)
seen = d1(f"""SELECT p.title, COUNT(DISTINCT pr.id) urun
FROM projects p JOIN project_products pp ON pp.project_id = p.id
JOIN products pr ON pr.id = pp.product_id AND pr.deleted_at IS NULL AND pr.hidden_at IS NULL
WHERE pr.brand_office_id = {BRAND_OFFICE_ID} AND p.deleted_at IS NULL
GROUP BY p.id ORDER BY urun DESC""")
print(f"  proje popup'ında B&T ürünü görünecek proje sayısı: {len(seen)}")
for s in seen:
    print(f"      {s['title'][:46]:48} ürün={s['urun']}")
brandside = d1(f"""SELECT COUNT(DISTINCT pid) n FROM (
  SELECT pp.project_id pid FROM project_products pp JOIN products pr ON pr.id = pp.product_id
    WHERE pr.brand_office_id = {BRAND_OFFICE_ID} AND pr.deleted_at IS NULL
  UNION
  SELECT pb.project_id pid FROM project_brands pb WHERE pb.office_id = {BRAND_OFFICE_ID})""")[0]
check(brandside['n'] > 0, f"marka popup'ındaki 'Kullanıldığı Projeler' = {brandside['n']} proje")

print('\n' + ('TÜM KONTROLLER GEÇTİ' if not fail else f'{len(fail)} KONTROL BAŞARISIZ:'))
for f in fail:
    print('  - ' + f)
sys.exit(1 if fail else 0)
