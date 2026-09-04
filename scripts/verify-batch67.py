#!/usr/bin/env python3
"""batch67 içe aktarımının D1'deki sonucunu doğrular (salt okunur).

Kontrol ettikleri:
  1. 61 ana ürünün hepsi var mı, versiyon sayıları payload ile birebir tutuyor mu?
  2. Her ürünün kapak görseli (images[0]) dolu mu — katalog kartı boş kalmaz mı?
  3. Versiyon görselleri /media/import/products/... yoluna yazılmış mı, kırık yol var mı?
  4. Katalog sırası (id DESC) markalar arasında karışık mı — komşu aynı-marka çifti sayısı?
  5. Güncellenen 3 satırda ESKİ küratörlü spec'ler (Garanti/Üretim Süresi) korunmuş mu?
  6. Casa marka profili açıldı mı, ürünleri ona bağlandı mı (brand_office_id)?

Kullanım:
  python3 scripts/verify-batch67.py
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

payload = json.load(open(os.path.join(HERE, 'output', 'batch67-payload.json'), encoding='utf8'))
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
       variants, files, description
FROM products WHERE deleted_at IS NULL AND (slug IN ({slugs}) OR id IN ({','.join(str(i) for i in upd_ids)}))""")
by_slug = {r['slug']: r for r in rows}
check(len(rows) == len(want), f'{len(rows)}/{len(want)} satır bulundu')

bad_var, bad_cover, bad_img = [], [], []
for slug, w in want.items():
    r = by_slug.get(slug)
    if not r:
        bad_var.append(f'{slug}: SATIR YOK')
        continue
    v = json.loads(r['variants'] or '[]')
    if len(v) != len(w['variants']):
        bad_var.append(f"{slug}: {len(v)} != beklenen {len(w['variants'])}")
    imgs = json.loads(r['images'] or '[]')
    if not imgs:
        bad_cover.append(slug)
    for x in v:
        for p in (x.get('images') or []):
            if not str(p).startswith('/media/'):
                bad_img.append(f'{slug}: {p}')

check(not bad_var, f'versiyon sayıları tutuyor (sapma: {bad_var[:5]})')
check(not bad_cover, f'her üründe kapak görseli var (boş: {bad_cover[:8]})')
check(not bad_img, f'versiyon görsel yolları geçerli (bozuk: {bad_img[:5]})')

nvar = sum(len(json.loads(r['variants'] or '[]')) for r in rows)
nimg = sum(len(json.loads(r['images'] or '[]')) for r in rows)
print(f'  toplam {nvar} versiyon, ana satırlarda {nimg} kapak/galeri karesi')

print('\n--- 2) Katalog sırası (ORDER BY id DESC) ---')
# GERÇEK katalog sorgusuyla bakılır, yalnızca bu partinin satırlarıyla DEĞİL: zenginleştirilen üç
# satır (Odette/Dilim/Ikaros) ESKİ id'lerini koruyor (119/205/227), yani katalogda eskiden
# durdukları yerde kalıyorlar. Partiyi kendi içinde id'ye göre sıralamak onları listenin sonuna
# yığıp yanlış bir "komşu tekrar" alarmı üretir; kullanıcının gördüğü sıra bu sorgudur.
order = d1('SELECT id, title, brand_name_raw FROM products '
           'WHERE deleted_at IS NULL AND hidden_at IS NULL ORDER BY id DESC LIMIT 58')
runs = [(a['title'], b['title'], a['brand_name_raw']) for a, b in zip(order, order[1:])
        if a['brand_name_raw'] == b['brand_name_raw']]
check(len(runs) == 0, f'katalogun ilk 58 kartında komşu aynı-marka çifti: {len(runs)} {runs[:4]}')
print('  ilk 8: ' + ' | '.join(f"{r['brand_name_raw'][:9]}:{r['title'][:14]}" for r in order[:8]))

print('\n--- 3) Güncellenen satırlarda küratörlü veri korundu mu ---')
# Sabit bir etiket listesine bakmak YANLIŞ olur (Odette'te hiç "Garanti" satırı yoktu, Dilim'de
# vardı). Ölçüt şu: içe aktarımdan ÖNCEKİ her spec etiketi ve her görsel HÂLÂ duruyor mu?
PRIOR = {  # koşudan önce D1'den okunan durum (bkz. bu betiğin yanındaki import raporu)
    119: {'labels': {'Tasarımcı', 'Ölçüler (165 Sofa)', 'Ölçüler (225 Sofa)'},
          'images': ['/media/products/koleksiyon/odette.jpg',
                     '/media/products/koleksiyon/odette-2.jpg']},
    205: {'labels': {'Genişlik (KSP72PUF)', 'Derinlik (KSP72PUF)', 'Yükseklik (KSP72PUF)',
                     'Genişlik (YD02YS140YD02)', 'Derinlik (YD02YS140YD02)',
                     'Yükseklik (YD02YS140YD02)', 'Koltuk Genişliği (YD02YS140YD02)',
                     'Koltuk Derinliği (YD02YS140YD02)', 'Garanti', 'Üretim Süresi'},
          'images': [f'/media/products/koleksiyon/dilim{s}.webp'
                     for s in ('', '-2', '-3', '-4', '-5', '-6')]},
    227: {'labels': {'Tasarımcı', '240SOFA ölçüleri', 'Oturma genişliği / derinliği',
                     'Kol yüksekliği', 'Garanti', 'Üretim süresi', 'Döşeme seçenekleri'},
          'images': [f'/media/import/products/ikaros-koleksiyon/{i}.webp' for i in (1, 2, 3, 4)]},
}
for r in rows:
    p = PRIOR.get(r['id'])
    if not p:
        continue
    labels = {s.get('label') for s in json.loads(r['specs'] or '[]')}
    imgs = json.loads(r['images'] or '[]')
    v = json.loads(r['variants'] or '[]')
    lost_l = p['labels'] - labels
    # `-w` soneki bir KAYIP değil, yeniden adreslemedir: alfa düzeltmesi sonrası kareler
    # `<n>-w.webp` anahtarlarına taşındı (bkz. rekey-batch67-alpha-images.py — uç önbelleği
    # `immutable` olduğu için içerik değil ADRES değiştirildi).
    def norm(path):
        return path.replace('-w.webp', '.webp')
    have = {norm(i) for i in imgs}
    lost_i = [i for i in p['images'] if norm(i) not in have]
    # Küratörlü etiketler her VERSİYONA da taşınmalı: versiyonun kendi spec'i dolu olduğundan
    # ana satıra düşülmez, taşınmazsa versiyon seçilince ekrandan kaybolurlar.
    missing_in_var = [x.get('label') for x in v
                      if p['labels'] - {s.get('label') for s in (x.get('specs') or [])}]
    check(not lost_l, f"id={r['id']} {r['title']}: eski spec etiketleri korundu (kayıp: {sorted(lost_l)})")
    check(not lost_i, f"id={r['id']} {r['title']}: eski görseller korundu (kayıp: {lost_i})")
    check(not missing_in_var,
          f"id={r['id']} {r['title']}: eski spec'ler her versiyonda var (eksik: {missing_in_var[:3]})")
    print(f"      -> {len(labels)} spec, {len(imgs)} görsel, {len(v)} versiyon")

print('\n--- 4) Casa marka profili ---')
casa = d1("SELECT id, slug, name, website, about, logo_url, cover_url FROM offices "
          "WHERE deleted_at IS NULL AND slug = 'casa'")
check(len(casa) == 1, 'offices tablosunda casa satırı var')
if casa:
    c = casa[0]
    check(bool((c['about'] or '').strip()), 'Türkçe tanıtım metni dolu')
    check(bool(c['logo_url']), f"logo: {c['logo_url']}")
    check(bool(c['cover_url']), f"kapak: {c['cover_url']}")
    linked = d1(f"SELECT COUNT(*) n FROM products WHERE deleted_at IS NULL "
                f"AND brand_office_id = {c['id']}")[0]['n']
    check(linked >= 14, f'Casa ürünleri markaya bağlı: {linked}')

unlinked = [r['slug'] for r in rows if not r['brand_office_id']]
check(not unlinked, f'tüm ürünler bir markaya bağlı (bağsız: {unlinked[:6]})')

print('\n' + ('TÜM KONTROLLER GEÇTİ' if not fail else f'{len(fail)} KONTROL BAŞARISIZ'))
sys.exit(0 if not fail else 1)
