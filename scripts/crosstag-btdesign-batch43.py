#!/usr/bin/env python3
"""bt.design 43-proje partisi: MEVCUT MİMARLAB projeleriyle eşleşen 14 tanesi için
project_products + project_brands kenarlarını yazar (2026-09-04, ikinci tur).

Bu script crosstag-btdesign-projects.py'nin devamıdır — aynı 12 eşleşmeyi (MATCHES) ve aynı
from_project=0/from_product=1 + COALESCE element kuralını yeniden kullanır, ayrıca kullanıcının
verdiği 43 URL'lik listeden YENİ doğrulanan 2 eşleşmeyi ekler:
  * TEB -> D1 1695 (TEB Arval Ofisi): office_id=94 Mürekkep Tasarım Atölyesi ↔ bt.design künyesi
    "Mürekkep Tasarım Atölyesi - Antre Design" AYNI; photo_credit_text İbrahim Özbunar ↔ AYNI.
  * Anadolu Hayat Emeklilik - Private Pension -> D1 1702 (zaten "Anadolu Hayat Emeklilik" için
    eşleşmiş): aynı ofis (Yalın Tan + Partners), aynı bina; bt.design'da HQ'nun farklı bir
    departman sayfası, ikinci bir D1 satırı AÇILMAZ.

Kasıtlı olarak DIŞARIDA bırakılan: "Ventera Partners Ofis" (D1'de Ventera Ofis I/II iki aday var,
hiçbiri fotoğraf/ofis bilgisiyle ayırt edilemiyor — yanlış eşleştirmek boş bırakmaktan kötü).

Ürün eşleştirmesi scripts/output/ (import-report + variants sourceUrl + aile ismi kökü) taban
alınarak scratchpad'de hesaplandı (per_project_products_v2.json); 242 ürün referansından 235'i
(%97) çözüldü, 3 sayfa (Boom, Go Large, Morph) hâlâ katalogda yok, atlandı.

Kullanım: python3 scripts/crosstag-btdesign-batch43.py [--dry-run]
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

BRAND_OFFICE_ID = 770
ELEMENT = 'Mobilya'

SCRATCH = ('/private/tmp/claude-501/-Users-kaancorbaci-Projects-mimarlab--claude-worktrees-'
           'product-popup-similar-company-products-806073/0e88621c-e2c6-412f-a0ac-8bf9fb1fae4d/'
           'scratchpad')

# bt.design url-slug (proje) -> (MİMARLAB projects.id listesi, dayanak)
# NOT: yalnızca kullanıcının verdiği 43'lük listedeki projeler burada; akbankhq/loomgames gibi
# ilk turdan (77-proje taramasının geneli) 43'lük listede OLMAYAN eşleşmeler kasıtlı atlandı.
MATCHES = {
    'agavegames': ([1485], 'ad+şehir; künye BuildUp ↔ Build Up Aac'),
    'amadeus': ([748], 'ad+şehir; künye Udesign Architecture ↔ tasarımcı Udesign'),
    'anadoluhayatemeklilik': ([1702], 'ad+şehir; künye Yalın Tan + Partners ↔ aynı'),
    'canyayinlari': ([929], 'ad+şehir (D1 satırında ofis künyesi yok)'),
    'concentrixoffice': ([1510], 'ad+şehir; künye Altıpatlar Architects ↔ aynı'),
    'enoctaistanbulmerkezofisi': ([926, 1718], 'ad+şehir; D1de aynı projenin iki kaydı var'),
    'goodjobgames': ([302], 'ad+şehir'),
    'ingbank': ([407], 'ad+şehir (D1: ING Bank Türkiye Genel Müdürlüğü, Maslak)'),
    'medicanahastanesikadikoy': (
        [709], 'D1: Medicana Hastanesi Kızıltoprak (Kızıltoprak Kadıköy içindedir); '
               'künye Zoom TPU ↔ tasarımcı Atilla Kuzu (Zoom TPU kurucusu)'),
    'nokia': ([1642], 'ad+şehir; künye Yalın Tan + Partners ↔ Yalin Tan + Partners'),
    'sahinormetekstilhq': ([301], 'D1: Şahin Örme Ofis ve Yemekhane Alanları, aynı şehir'),
    'yvesrocherhq': ([1484], 'D1: Yves Rocher Ofisleri, İstanbul (Beşiktaş)'),
    # --- bu turda yeni doğrulanan 2 eşleşme ---
    'teb': ([1695], 'office_id=94 Mürekkep Tasarım Atölyesi ↔ aynı; photog İbrahim Özbunar ↔ aynı'),
    'anadoluhayatemeklilikprivatepension': (
        [1702], 'aynı ofis+bina; Anadolu Hayat Emeklilik ile aynı D1 satırı, farklı departman sayfası'),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    projects_by_slug = {d['url'].rstrip('/').split('/')[-1]: d
                        for d in json.load(open(os.path.join(HERE, 'output', 'btdesign-projects.json'),
                                                 encoding='utf8'))}
    per_project = json.load(open(os.path.join(SCRATCH, 'per_project_products_v2.json'), encoding='utf8'))

    pp_edges, pb_edges = set(), set()
    lines = []
    for url_slug, (pids, why) in MATCHES.items():
        entry = per_project.get(url_slug)
        name = projects_by_slug.get(url_slug, {}).get('name', url_slug)
        prod_ids = entry['ids'] if entry else []
        for proj_id in pids:
            pb_edges.add(proj_id)
            for pid in prod_ids:
                pp_edges.add((proj_id, pid))
        lines.append(f"  {name[:38]:40} -> D1 {pids}  ürün={len(prod_ids)}\n      dayanak: {why}")

    print('\n--- Eşleşen projeler (bu turun MATCHES tablosu, üst-küme) ---')
    print('\n'.join(lines))
    print(f'\nproject_products: {len(pp_edges)} kenar / project_brands: {len(pb_edges)} kenar')

    if args.dry_run:
        print('[dry-run] yazılmadı.')
        return 0

    stmts = []
    if pp_edges:
        rows_sql = ',\n'.join(f'({a}, {b}, 0, 1)' for a, b in sorted(pp_edges))
        stmts.append(
            'INSERT INTO project_products (project_id, product_id, from_project, from_product)\n'
            f'VALUES\n{rows_sql}\n'
            'ON CONFLICT(project_id, product_id) DO UPDATE SET from_product = 1;')
    if pb_edges:
        rows_sql = ',\n'.join(f'({pid}, {BRAND_OFFICE_ID}, {q(ELEMENT)}, \'admin\')'
                              for pid in sorted(pb_edges))
        stmts.append('INSERT INTO project_brands (project_id, office_id, element, source)\n'
                     f'VALUES\n{rows_sql}\n'
                     'ON CONFLICT(project_id, office_id) DO UPDATE SET\n'
                     '  element = COALESCE(project_brands.element, excluded.element);')
    d1_file('\n'.join(stmts))
    print('yazıldı.')

    got = d1(f'SELECT COUNT(*) n FROM project_brands WHERE office_id = {BRAND_OFFICE_ID}')
    print(f"doğrulama: B&T Design project_brands satırı (toplam) = {got[0]['n']}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
