#!/usr/bin/env python3
"""Bürotime referans projelerinin (burotime.com/kurumsal/projeler) MİMARLAB projeleriyle
çapraz etiketlenmesi — marka kenarı (project_brands) + ürün kenarı (project_products).

İLKE (koleksiyon4/ersa turlarıyla aynı): OTOMATİK BULANIK EŞLEŞTİRME YOK. Ad benzerliği tek
başına yeterli sayılmaz; her satırın dayanağı aşağıda yazılıdır ve doğrulanmayan aday
ELENMİŞTİR — yanlış marka etiketi, gerçek mimarların proje künyesine yanlış bilgi yazmak
demektir.

TARAMA (tam küme, örneklem DEĞİL — bkz. proje notu "ÖRNEKLEM HATASI")
--------------------------------------------------------------------
213 referans projenin TAMAMI çekildi (scripts/scrape-burotime-projects.py). 182'sinde
"Kullanılan Ürünler" listesi var (1113 ürün bağlantısı). Başlıklar D1'deki 1813 canlı projeye
karşı iki ayrı yöntemle tarandı: (a) TR-fold token kapsaması, (b) her başlığın ayırt edici ilk
kelimesinin ML başlıklarında alt dize araması. İki tarama 17 + 70 aday üretti; hepsi elle
incelendi.

KABUL EDİLEN 6 EŞLEŞME (dayanaklarıyla)
---------------------------------------
  #414  Troya Müzesi
        Bürotime: "Çanakkale, 2018 / Mimari Proje: Yalın Mimarlık".
        D1 açıklaması: "...yarışmada birincilik ödülü kazanan Yalın Mimarlık tasarımıdır",
        Çanakkale, 2011-2018. AYNI MİMAR + AYNI ŞEHİR + yıl aralık içinde.
  #710  Mersin Şehir Hastanesi
        Bürotime "Mersin Şehir Eğitim ve Araştırma Hastanesi / Mersin" — tesisin resmî tam adı;
        D1'deki kayıt aynı hastanenin kısa adı. Türkiye'de bu adı taşıyan tek tesis.
  #998  Döhler Natural Food & Beverage Ingredients Türkiye Merkez Ofis
        Bürotime "Döhler Gıda Türkiye Merkez Ofisi / Mimari Proje: Udesign Mimarlık". Aynı
        şirketin AYNI "Türkiye Merkez Ofis"i, aynı şehir (İstanbul), aynı yıl (2018).
  #1119 Çukurova Kalkınma Ajansı Hizmet Binası
        Bürotime "Çukurova Kalkınma Ajansı / Adana". Aynı kurum + aynı şehir; kurumun tek
        hizmet binası. Bürotime'ın kendi proje fotoğrafı (cukurova-kalkinma-ajansi-7) D1
        galerisindeki 25. kare ile AYNI yönetici odasını gösteriyor (kırmızı kanepe + ahşap
        panel + gri koltuklar) — görsel doğrulama.
  #1179 Gübretaş Genel Müdürlük Merkez Ofisi
        BAŞLIK BİREBİR AYNI + İstanbul + 2014 ∈ 2013-2014 + **FOTOĞRAFÇI HER İKİ TARAFTA DA
        Ömer Kanıpak**. Bu turun en güçlü kanıtı.
  #1576 Talu Tekstil Ofisi
        Bürotime "Talu Tekstil / İstanbul, 2022 / XYZ Mimarlık & Paratoner"; D1 kaydı XYZ Design,
        Bağcılar, 2022. Bürotime'ın kendi fotoğrafı (talu-tekstil-4) D1 galerisinin 12. karesiyle
        AYNI toplantı odası (kırmızı terrazzo tezgâhlı konsol + yeşil kemerler + deve tüyü deri
        koltuklar) — görsel doğrulama. Aynı binadaki showroom kaydı (#837) AYRI bir proje
        olduğundan ETİKETLENMEDİ.

ELENENLER (neden)
-----------------
  Amadeus            -> #748 farklı proje: Bürotime 2018/Pimodek, D1 2023-2024/Udesign+Altun.
  Unilever           -> #1759 (B&T Design referansı, Yalın Tan+Partners) ve #1825 (Ersa
                        referansı) — Bürotime'ın verdiği mimar (Stüdyo 13) İKİSİYLE DE tutmuyor.
  Ernst & Young      -> Bürotime kayıtları Cidde 2016 ve Riyad 2015; D1'deki #1770 İzmir 2024.
  Türk Hava Yolları  -> Bürotime sayfası ITB Berlin / Dubai ATM FUAR STANDI; #1666 ise Operasyon
                        Merkezi ve Ekip Terminali binası. Farklı yapı.
  BMC                -> #1818 (İzmir, Ersa referansı) ile #1500 (Ankara Ar-Ge) arasında ayırt
                        edici kanıt YOK; Bürotime sayfasında şehir/yıl yok, tek ipucu bir
                        müteahhit adının içindeki "İzmir" kelimesi. Yetersiz — ELENDİ.
  Ziraat Bankası, Medicana, The İstanbul, Divalin Hotel, Ve-ge, Platform Office, Memorial
  (Göztepe/Bodrum), Turkcell Call Center, Bureau Veritas, Trend GYO: ya D1'de karşılığı yok ya
  da yalnızca kelime çakışması (farklı şube/yapı/kurum).

ÜRÜN KENARI BAYRAĞI — from_product=1, from_project=0
---------------------------------------------------
Kanıt MARKANIN kendi referans sayfası, yani ÜRÜN tarafı. `canonicalSync.js#setProjectProductLinks`
proje tarafından bir kayıt geldiğinde önce `from_project = 0` yapıp İKİ bayrağı da 0 olan
satırları SİLER; from_project=1 yazsaydık proje sahibi projesini bir kez kaydettiğinde bu
kenarlar sessizce yok olurdu.

Kullanım: python3 scripts/crosstag-burotime-projects.py [--dry-run]
"""
import argparse
import importlib.util as _ilu
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def _load(name, path):
    spec = _ilu.spec_from_file_location(name, os.path.join(HERE, path))
    mod = _ilu.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


imp = _load('import_archello_products', 'import-archello-products.py')
groups_mod = _load('burotime_groups', 'burotime-groups.py')
d1, d1_file = imp.d1, imp.d1_file

BUROTIME_OFFICE_ID = 771

# MİMARLAB proje id -> (Bürotime proje slug'ı, dayanak). Yalnızca ELLE doğrulanmış satırlar.
MATCHES = [
    (414, 'troya-muzesi', 'aynı mimar (Yalın Mimarlık) + Çanakkale + 2018 ∈ 2011-2018'),
    (710, 'mersin-sehir-egitim-ve-arastirma-hastanesi', 'tesisin resmî tam adı; Mersin'),
    (998, 'dohler-gida-turkiye-merkez-ofisi', 'aynı şirketin Türkiye Merkez Ofisi; İstanbul 2018'),
    (1119, 'cukurova-kalkinma-ajansi', 'aynı kurum + Adana; yönetici odası görsel eşleşmesi'),
    (1179, 'gubretas-genel-mudurluk-merkez-ofisi',
     'başlık birebir + İstanbul + 2014 + fotoğrafçı Ömer Kanıpak İKİ TARAFTA DA'),
    (1576, 'talu-tekstil', 'XYZ Design + İstanbul + 2022; toplantı odası görsel eşleşmesi'),
]


def burotime_slug_to_family():
    """Bürotime ÜRÜN sayfası slug'ı -> MİMARLAB ana ürün başlığı (aile)."""
    g = groups_mod.build_groups()
    out = {}
    for fam in g.values():
        for p in fam['pages']:
            out[p['slug']] = fam['title']
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    projects = {p['slug']: p for p in json.load(
        open(os.path.join(HERE, 'output', 'burotime-projects.json'), encoding='utf8'))
        if p.get('slug')}
    fam_of = burotime_slug_to_family()

    print('--- 1) Marka kenarı (project_brands) ---')
    have = {r['project_id'] for r in
            d1(f'SELECT project_id FROM project_brands WHERE office_id = {BUROTIME_OFFICE_ID}')}
    print(f'  Bürotime (#{BUROTIME_OFFICE_ID}) mevcut kenar: {len(have)}')
    titles = {r['id']: r['title'] for r in d1(
        f"SELECT id, title FROM projects WHERE id IN ({','.join(str(m[0]) for m in MATCHES)}) "
        'AND deleted_at IS NULL')}
    todo_brand = []
    for pid, bslug, why in MATCHES:
        if pid not in titles:
            print(f'  UYARI: #{pid} D1de bulunamadı (silinmiş?) — ATLANDI')
            continue
        state = 'ZATEN VAR' if pid in have else 'EKLENECEK'
        print(f'  #{pid:<5} {titles[pid][:38]:40} {state:10} {why}')
        if pid not in have:
            todo_brand.append(pid)

    print('\n--- 2) Ürün kenarı (project_products) ---')
    # Bürotime proje sayfalarındaki ürün slug'ları -> MİMARLAB ana ürün id'si
    fam_titles = set()
    per_project = {}
    for pid, bslug, _ in MATCHES:
        if pid not in titles:
            continue
        bp = projects.get(bslug)
        if bp is None:
            print(f'  UYARI: kazınmış Bürotime projesi yok: {bslug}')
            continue
        fams = []
        for pr in bp.get('products') or []:
            fam = fam_of.get(pr['slug'])
            if not fam:
                # Bu partide OLMAYAN bir Bürotime ürünü (görev metnindeki 183 bağlantı dışında)
                print(f"    atlandı (bu partide yok): {bslug} <- {pr['slug']}")
                continue
            if fam not in fams:
                fams.append(fam)
        per_project[pid] = fams
        fam_titles.update(fams)

    prod_by_title = {}
    if fam_titles:
        lst = ', '.join("'" + t.replace("'", "''") + "'" for t in sorted(fam_titles))
        for r in d1(f'SELECT id, slug, title FROM products WHERE deleted_at IS NULL '
                    f'AND brand_office_id = {BUROTIME_OFFICE_ID} AND title IN ({lst})'):
            prod_by_title[r['title']] = r

    existing_pp = set()
    if per_project:
        ids = ','.join(str(p) for p in per_project)
        existing_pp = {(r['project_id'], r['product_id']) for r in d1(
            f'SELECT project_id, product_id FROM project_products WHERE project_id IN ({ids})')}

    todo_pp = []
    for pid, fams in per_project.items():
        for fam in fams:
            row = prod_by_title.get(fam)
            if row is None:
                print(f'  UYARI: D1de Bürotime ürünü bulunamadı: {fam!r} (proje #{pid})')
                continue
            state = 'ZATEN VAR' if (pid, row['id']) in existing_pp else 'EKLENECEK'
            print(f"  #{pid:<5} {titles[pid][:24]:26} <- #{row['id']:<5} {row['title'][:18]:20} {state}")
            if (pid, row['id']) not in existing_pp:
                todo_pp.append((pid, row['id']))

    print(f'\nÖZET: {len(todo_brand)} marka kenarı, {len(todo_pp)} ürün kenarı eklenecek.')
    if args.dry_run:
        print('[dry-run] yazılmadı.')
        return 0
    stmts = [f'INSERT INTO project_brands (project_id, office_id) '
             f'VALUES ({pid}, {BUROTIME_OFFICE_ID}) ON CONFLICT(project_id, office_id) DO NOTHING'
             for pid in todo_brand]
    stmts += [f'INSERT INTO project_products (project_id, product_id, from_project, from_product) '
              f'VALUES ({pid}, {prid}, 0, 1) '
              f'ON CONFLICT(project_id, product_id) DO UPDATE SET from_product = 1'
              for pid, prid in todo_pp]
    if stmts:
        d1_file(';\n'.join(stmts) + ';')
        print(f'{len(stmts)} satır yazıldı.')
    n = d1(f'SELECT COUNT(*) AS n FROM project_brands WHERE office_id = {BUROTIME_OFFICE_ID}')
    print(f'Toplam Bürotime marka kenarı: {n[0]["n"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
