#!/usr/bin/env python3
"""B&T Design versiyon galerilerini DOĞRU sıraya oturtur (fotoğraflar → dekupe → teknik çizim).

KULLANICI BULGUSU (2026-09-04): "Senin yüklediğin ürün görsellerinde kapak fotoğrafı ayrıyken
neden ürün popupının medya kısmında ürün çizimi gözüküyor?"

SEBEP: `btdesign-build-payload.py` versiyon galerisini `[teknik çizim] + fotoğraflar + dekupe`
sırasıyla kuruyordu. Popup açılışta versiyon 0'ı seçili gösterdiği için medya alanının İLK karesi
ölçü çizimi oluyordu. Üstelik çizim, sayfanın TÜM konfigürasyonlarında AYNI karedir (B&T tek föyde
bütün varyantları ölçülendiriyor), yani versiyonlar arası ayırt edici bilgi de taşımıyor.

YANLIŞ İLK DENEME — NEDEN BURADA ANLATILIYOR: bu betiğin ilk sürümü föyü "ana satırın galerisinde
BULUNMAYAN kare" diye tanıyordu ve `images`i bir kaydırıyordu. Bu sezgi TEK SAYFALI ürünlerde
doğru ama ÇOK SAYFALI ailelerde (Rego 4, Lamy/Pera/Dupont 3, 14 aile 2 sayfa) YANLIŞ: ikinci
sayfanın fotoğrafları da ana galeride yoktur. Sonuç: 18 üründe 116 versiyon "hâlâ bozuk"
sanıldı, her koşuda bir daha döndürüldü ve gerçek fotoğrafların sırası karıştı. Bu sürüm
kaydırma YAPMAZ — her versiyonun görsel listesini KAYNAKTAN yeniden kurar, yani kaç kez
çalıştırılırsa çalıştırılsın aynı doğru sonuca yakınsar (idempotent) ve önceki karıştırmayı da
onarır.

R2 anahtarları DETERMİNİSTİK (`import/products/<slug>/<idx>.webp`, idx yüklemeden önce atanır),
bu yüzden hiçbir görsel yeniden yüklenmez: yalnızca ESKİ sıralamayla kurulan url->idx haritası
yeniden hesaplanır ve YENİ sırayla dizilir.

Kullanım:
  python3 scripts/fix-btdesign-variant-image-order.py [--dry-run]
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

from btdesign_families import BRAND_OFFICE_ID, FAMILIES, PAGE_ONLY  # noqa: E402

R2_PREFIX = 'import/products'
MAX_STMT_BYTES = 80_000     # bkz. [[project_d1_statement_size_limit]]
VARIANTS_CHUNK = 40_000
MAX_GALLERY, MAX_CUTOUTS, MAX_PARENT = 6, 2, 10

RAW = {r['slug']: r for r in json.load(
    open(os.path.join(HERE, 'output', 'btdesign-scraped.json'), encoding='utf8'))}
_ITEMS = json.load(open(os.path.join(HERE, 'output', 'btdesign-payload.json'),
                        encoding='utf8'))['products']
PAYLOAD = {p['slug']: p for p in _ITEMS}
# ZENGİNLEŞTİRİLEN dört satır (Pera/Rest Klasik/Roller/To Be) D1'de KENDİ eski slug'ını korur —
# içe aktarım slug'a hiç dokunmaz, yoksa canlı bağlantılar kırılırdı. Bu yüzden payload'a slug'la
# değil `update_id` ile de erişilebilmeli; aksi halde tam da düzeltilmesi gereken satırlar
# "payload'da yok" diye atlanır.
PAYLOAD_BY_ID = {p['update_id']: p for p in _ITEMS if p.get('update_id')}


def dedupe(xs):
    return list(dict.fromkeys(xs))


def old_url_index(fam_pages, product_slug):
    """İÇE AKTARIM SIRASINDA kullanılan url -> R2 yolu haritasını birebir yeniden kurar.

    O sıradaki (ESKİ) kurallar: versiyon görselleri `ds[:1] + gallery + cutouts`, ana satır
    görselleri ilk sayfanın `gallery + cutouts`ı, yükleme listesi ise
    `dedupe(ana + tüm versiyonların srcImages'i)`. idx bu listedeki 1 tabanlı sıradır.
    """
    first = RAW[fam_pages[0][0]]
    parent = dedupe(list(first['gallery']) + list(first['cutouts']))[:MAX_PARENT]
    per_page_src = []
    for slug, _ in fam_pages:
        raw = RAW[slug]
        gallery = dedupe(raw['gallery'])[:MAX_GALLERY]
        cutouts = dedupe(raw['cutouts'])[:MAX_CUTOUTS]
        ds = dedupe(raw['dimensionImages'])
        src = dedupe([i for i in (ds[:1] + gallery + cutouts) if i])
        # aynı sayfanın her konfigürasyonu AYNI src listesini taşıyordu
        n_cfg = len(PAGE_ONLY.get(slug) or []) or None
        per_page_src.append((slug, src, n_cfg))
    urls = list(parent)
    for _, src, _ in per_page_src:
        urls += src
    urls = dedupe(urls)
    return {u: f'/media/{R2_PREFIX}/{product_slug}/{i}.webp' for i, u in enumerate(urls, start=1)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    fam_by_key = {f['key']: f for f in FAMILIES}
    rows = d1(f'SELECT id, slug, title, images, variants FROM products '
              f'WHERE brand_office_id = {BRAND_OFFICE_ID} AND variants IS NOT NULL '
              f'AND deleted_at IS NULL')
    print(f'{len(rows)} versiyonlu ürün bulundu')

    stmts, touched, fixed, unmatched = [], 0, 0, []
    for r in rows:
        p = PAYLOAD.get(r['slug']) or PAYLOAD_BY_ID.get(r['id'])
        if not p:
            unmatched.append(r['title'])
            continue
        idx = old_url_index(fam_by_key[p['key']]['pages'], p['slug'])
        want_by_label = {v['label']: [idx[u] for u in v['srcImages'] if u in idx]
                         for v in p['variants']}

        variants = json.loads(r['variants'])
        changed = False
        for v in variants:
            want = want_by_label.get(v.get('label'))
            if not want:
                continue
            if v.get('images') != want:
                v['images'] = want
                fixed += 1
                changed = True
        if not changed:
            continue
        touched += 1
        vjson = json.dumps(variants, ensure_ascii=False)
        stmt = (f"UPDATE products SET variants = {q(vjson)}, updated_at = datetime('now') "
                f"WHERE id = {r['id']};")
        if len(stmt.encode()) <= MAX_STMT_BYTES:
            stmts.append((r['id'], [stmt]))
        else:
            group = [f"UPDATE products SET variants = '', updated_at = datetime('now') "
                     f"WHERE id = {r['id']};"]
            for i in range(0, len(vjson), VARIANTS_CHUNK):
                group.append(f"UPDATE products SET variants = variants || "
                             f"{q(vjson[i:i + VARIANTS_CHUNK])} WHERE id = {r['id']};")
            stmts.append((r['id'], group))
            print(f"    ! {r['title']}: {len(vjson) // 1024} KB > tavan, parçalı yazılacak")

    if unmatched:
        print(f'  UYARI payload\'da bulunamayan ürün: {unmatched}')
    print(f'  düzeltilecek ürün: {touched}, yeniden dizilen versiyon: {fixed}')
    if args.dry_run:
        print('[dry-run] yazılmadı.')
        return 0
    if not stmts:
        print('Yapılacak iş yok — tüm galeriler zaten doğru sırada.')
        return 0

    # Ürün başına AYRI çağrı: 1,2 MB'lık toplu `--file` yazımı bir koşuda
    # `ERROR Not currently importing anything.` verdi, bir başkasında sıfır dönüş koduyla
    # "başarılı" deyip satırları DEĞİŞTİRMEDİ. Küçük ve bağımsız çağrılar hem uygulanıyor hem de
    # biri düşerse ötekileri etkilemiyor.
    for i, (pid, group) in enumerate(stmts, 1):
        d1_file('\n'.join(group))
        if i % 10 == 0 or i == len(stmts):
            print(f'    yazıldı {i}/{len(stmts)} ürün')

    # DOĞRULAMA: D1'deki her versiyonun görsel listesi, payload'dan beklenenin AYNISI olmalı.
    bad = []
    for r in d1(f'SELECT id, slug, title, variants FROM products '
                f'WHERE brand_office_id = {BRAND_OFFICE_ID} AND variants IS NOT NULL '
                f'AND deleted_at IS NULL'):
        p = PAYLOAD.get(r['slug']) or PAYLOAD_BY_ID.get(r['id'])
        if not p:
            continue
        idx = old_url_index(fam_by_key[p['key']]['pages'], p['slug'])
        want_by_label = {v['label']: [idx[u] for u in v['srcImages'] if u in idx]
                         for v in p['variants']}
        for v in json.loads(r['variants']):
            want = want_by_label.get(v.get('label'))
            if want and v.get('images') != want:
                bad.append((r['title'], v['label']))
    print(f'doğrulama: beklenen sıradan sapan versiyon = {len(bad)} (0 olmalı) {bad[:4]}')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
