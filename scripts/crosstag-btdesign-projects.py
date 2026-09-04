#!/usr/bin/env python3
"""bt.design referans projelerini MİMARLAB projeleriyle ÇİFT YÖNLÜ eşleştirir (2026-09-04).

İki kenar türü birden yazılır (bkz. [[project_project_brands_edge_2026_09_04]]):

  project_products  — projede kullanılan SOMUT ürünler. bt.design'ın proje sayfasındaki
                      "Bu Projedeki Ürünler" ızgarası kaynaktır. Bu kenar tek başına
                      proje popup'ında hem ürün kartlarını hem "Kullanılan Markalar"
                      altında B&T Design kartını üretir (src/routes/project.js#brandRows,
                      ürün → offices zinciri).
  project_brands    — marka ↔ proje DOĞRUDAN kenarı. Ürün satırı ileride gizlenir/silinirse
                      marka kartının kaybolmaması için yazılır; okuma tarafı iki kenarı
                      UNION'layıp TEK karta indirger.

`from_project` / `from_product` bayrakları
------------------------------------------
`from_project = 0, from_product = 1` yazılır. Gerekçe: sütun DEFAULT'ları (1, 0) bırakılsaydı
kenar "proje tarafının talep ettiği" sayılırdı ve o proje bir daha kaydedildiğinde
`canonicalSync.js#setProjectProductLinks(side='project')` from_project'i sıfırlayıp yalnızca
proje formundaki markalardan yeniden kurardı — bu içe aktarımın kenarları sessizce SİLİNİRDİ
(iki bayrağı da 0 olan satır siliniyor). Kenarın kaynağı gerçekten de ÜRÜN/marka tarafıdır
(iddiayı B&T Design'ın kendi proje sayfası ortaya koyuyor), o yüzden from_product=1 hem doğru
hem dayanıklı.

EŞLEŞTİRME ELLE DOĞRULANDI (MATCHES): 77 referans projeden 14'ü MİMARLAB'da bulundu. Otomatik
bulanık eşleştirme KULLANILMAZ — yanlış bir projeye marka etiketlemek, etiketlememekten kötüdür.
Her satırın yanında dayanağı yazılıdır. Belirsiz kalan iki aday bilerek DIŞARIDA bırakıldı:
  * "Ventera Partners Ofis" -> D1'de Ventera Ofis I (1509) ve II (1501) var, ikisi de aynı
    stüdyonun (Dam Design Studio) işi; bt.design tek sayfa taşıyor, hangisi olduğu belirlenemedi.
  * "Double Tree Hilton" / "Feyzi Gıda" / "Akbank HQ" -> ad ya da künye örtüşmüyor.

Kullanım:
  python3 scripts/crosstag-btdesign-projects.py [--dry-run]
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

from btdesign_families import BRAND_OFFICE_ID, FAMILIES  # noqa: E402

# bt.design proje adı -> (MİMARLAB projects.id listesi, dayanak)
MATCHES = {
    'Agave Games': ([1485], 'ad+şehir; künye BuildUp ↔ Build Up Aac'),
    'Amadeus': ([748], 'ad+şehir; künye Udesign Architecture ↔ tasarımcı Udesign'),
    'Anadolu Hayat Emeklilik': ([1702], 'ad+şehir; künye Yalın Tan + Partners ↔ aynı'),
    'Can Yayınları': ([929], 'ad+şehir (D1 satırında ofis künyesi yok)'),
    'Concentrix Office': ([1510], 'ad+şehir; künye Altıpatlar Architects ↔ aynı'),
    # D1'de aynı gerçek proje İKİ satır: 926 Arkitera'dan, 1718 Archello'dan içe aktarılmış
    # (ikisi de Enocta Ofis / Beykoz). Mükerrer bir D1 kaydı olduğu için ikisi de etiketlenir.
    'Enocta İstanbul Merkez Ofisi': ([926, 1718], 'ad+şehir; D1de aynı projenin iki kaydı var'),
    'Good Job Games': ([302], 'ad+şehir'),
    'ING Bank': ([407], 'ad+şehir (D1: ING Bank Türkiye Genel Müdürlüğü, Maslak)'),
    'İş Marmaris Eğitim ve Dinlenme Tesisi': (
        [1445], 'ad birebir; künye Erginoğlu & Çalışlar ↔ Erginoğlu & Çalışlar Mimarlık'),
    'Loom Games': ([1479], 'ad birebir; künye Habif Architects ↔ Habif Mimarlık'),
    'Medicana Hastanesi Kadıköy': (
        [709], 'D1: Medicana Hastanesi Kızıltoprak (Kızıltoprak Kadıköy içindedir); '
               'künye Zoom TPU ↔ tasarımcı Atilla Kuzu (Zoom TPU kurucusu)'),
    'Nokia': ([1642], 'ad+şehir; künye Yalın Tan + Partners ↔ Yalin Tan + Partners'),
    'Şahin Örme Tekstil HQ': ([301], 'D1: Şahin Örme Ofis ve Yemekhane Alanları, aynı şehir'),
    'Yves Rocher HQ': ([1484], 'D1: Yves Rocher Ofisleri, İstanbul (Beşiktaş)'),
}

ELEMENT = 'Mobilya'


def page_to_key():
    """bt.design ürün sayfası slug'ı -> aile anahtarı."""
    out = {}
    for fam in FAMILIES:
        for slug, _ in fam['pages']:
            out[slug] = fam['key']
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    projects = {p['name']: p for p in json.load(
        open(os.path.join(HERE, 'output', 'btdesign-projects.json'), encoding='utf8'))}
    report = json.load(open(os.path.join(HERE, 'output', 'btdesign-import-report.json'),
                            encoding='utf8'))
    key_to_slug = {r['key']: r['slug'] for r in report}
    slug_to_key = page_to_key()

    # Ürün slug'ı -> D1 id (yeni satırlar slug'la, güncellenenler update_id ile bulunur)
    slugs = ','.join(q(r['slug']) for r in report)
    rows = d1(f'SELECT id, slug FROM products WHERE deleted_at IS NULL AND slug IN ({slugs})')
    id_by_slug = {r['slug']: r['id'] for r in rows}
    for r in report:
        if r.get('update_id'):
            id_by_slug.setdefault(r['slug'], r['update_id'])
    print(f'ürün satırı çözümlendi: {len(id_by_slug)} / {len(report)}')

    missing_products = set()
    pp_edges, pb_edges = set(), set()
    lines = []
    for name, (pids, why) in MATCHES.items():
        p = projects.get(name)
        if not p:
            raise SystemExit(f'MATCHES içindeki proje kazımada yok: {name!r}')
        prod_ids = []
        for src in p['products']:
            key = slug_to_key.get(src['slug'])
            if not key:
                missing_products.add(src['slug'])
                continue
            pid = id_by_slug.get(key_to_slug.get(key, ''))
            if pid:
                prod_ids.append(pid)
        prod_ids = sorted(set(prod_ids))
        for proj_id in pids:
            pb_edges.add(proj_id)
            for pid in prod_ids:
                pp_edges.add((proj_id, pid))
        lines.append(f"  {name[:36]:38} -> D1 {pids}  ürün={len(prod_ids)}/{len(p['products'])}"
                     f"\n      dayanak: {why}")

    print('\n--- Eşleşen projeler ---')
    print('\n'.join(lines))
    if missing_products:
        # Bu partide OLMAYAN bt.design ürünleri (kullanıcının verdiği 85'lik listede yoklar).
        print(f'\n  not: bu partide bulunmayan {len(missing_products)} ürün sayfası atlandı: '
              f'{sorted(missing_products)[:10]}…')

    print(f'\nproject_products: {len(pp_edges)} kenar / project_brands: {len(pb_edges)} kenar')
    if args.dry_run:
        print('[dry-run] yazılmadı.')
        return 0

    stmts = []
    if pp_edges:
        rows_sql = ',\n'.join(f'({a}, {b}, 0, 1)' for a, b in sorted(pp_edges))
        # from_product=1 gerekçesi için bkz. dosya başı. Yeniden çalıştırılabilir: mevcut kenarda
        # yalnızca from_product yükseltilir, karşı tarafın bayrağına DOKUNULMAZ.
        stmts.append(
            'INSERT INTO project_products (project_id, product_id, from_project, from_product)\n'
            f'VALUES\n{rows_sql}\n'
            'ON CONFLICT(project_id, product_id) DO UPDATE SET from_product = 1;')
    if pb_edges:
        rows_sql = ',\n'.join(f'({pid}, {BRAND_OFFICE_ID}, {q(ELEMENT)}, \'admin\')'
                              for pid in sorted(pb_edges))
        # DİKKAT — B&T Design'ın project_brands kenarları BU PARTİDEN ÖNCE de vardı: 2026-09-04
        # Archello marka içe aktarımı 15 kenar yazmış ve bazılarında ELEMAN KÜNYESİ bizimkinden
        # DAHA ZENGİN ('Hareketli Mobilya', 'Ofis Koltukları', 'Sandalye', 'İç Mekân Mobilyası').
        # `SET element = excluded.element` deseydik bunları jenerik 'Mobilya' ile EZERDİK; bu bir
        # gerilemedir (bkz. batch67'nin "mükerrer = ezme değil zenginleştirme" kuralı). COALESCE
        # yalnızca BOŞ elemanı doldurur, doluya dokunmaz.
        stmts.append('INSERT INTO project_brands (project_id, office_id, element, source)\n'
                     f'VALUES\n{rows_sql}\n'
                     'ON CONFLICT(project_id, office_id) DO UPDATE SET\n'
                     '  element = COALESCE(project_brands.element, excluded.element);')
    d1_file('\n'.join(stmts))
    print('yazıldı.')

    got = d1(f'SELECT COUNT(*) n FROM project_products WHERE product_id IN '
             f"({','.join(str(i) for i in sorted(set(id_by_slug.values())))})")
    print(f"doğrulama: bu partinin ürünlerine bağlı project_products satırı = {got[0]['n']}")
    got = d1(f'SELECT COUNT(*) n FROM project_brands WHERE office_id = {BRAND_OFFICE_ID}')
    print(f"doğrulama: B&T Design project_brands satırı = {got[0]['n']}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
