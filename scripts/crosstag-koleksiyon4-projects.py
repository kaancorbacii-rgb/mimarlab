#!/usr/bin/env python3
"""Koleksiyon 4. parti (2026-09-05) referans proje çapraz etiketlemesi.

crosstag-koleksiyon2-projects.py'nin devamı — AYNI ilke: OTOMATİK bulanık eşleştirme YOK, her
satır elle doğrulanır ve dayanağı yazılır (yanlış marka etiketi, etiketsizlikten kötüdür).

=============================================================================================
GÖREV METNİNDEKİ REFERANS BAĞLANTISI YANLIŞ MARKAYA AİT — ve bilerek kullanılmadı.
=============================================================================================
Görev metni referans projeler kaynağı olarak `https://bt.design/projeler/` veriyor. O sayfa
B&T DESIGN markasının referans listesi; bu parti ise KOLEKSİYON ürünlerini içe aktarıyor
(önceki B&T partisinden kalan bir kopyala-yapıştır olduğu değerlendirildi). B&T'nin referans
projelerine Koleksiyon ürünü/markası etiketlemek, gerçek mimarların proje künyelerine YANLIŞ
bilgi yazmak olurdu. Bu yüzden kaynak olarak markanın KENDİ referans listesi kullanıldı:
`https://www.koleksiyondesign.com/tr/projeler/` (sitemap.xml'den 34 proje).

=============================================================================================
ÜRÜN DÜZEYİ KENAR — BU DOSYADAKİ İLK SONUÇ YANLIŞTI, DÜZELTİLDİ
=============================================================================================
Bu dosyanın ilk sürümü "koleksiyondesign.com proje sayfalarında ürün ızgarası YOK" diyerek hiç
`project_products` yazmamıştı. **YANLIŞTI — ÖRNEKLEM HATASI:** yalnızca DÖRT projeye bakılmıştı
(unilever/tbwa/sahibinden/mercedes-benz) ve dördü de ürünsüz sayfalardı. Ayrıca kullanılan regex
sondaki '/' karakterini zorunlu tutuyordu, sayfadaki bağlantılar ise onu taşımıyor.

34 projenin TAMAMI yeniden tarandığında 4 projede gerçek ürün listesi bulundu (11 bağlantı) ve
bunlardan MİMARLAB'da karşılığı olan tek proje için ürün kenarları YAZILDI —
bkz. `crosstag-koleksiyon4-project-products.py` (Villa Topos <- Terna/Homer/Milos).

Bu dosya artık YALNIZCA marka↔proje (project_brands) kenarından sorumludur.

=============================================================================================
BU PARTİDE EKLENEN TEK YENİ EŞLEŞME
=============================================================================================
34 referans projeden 19'unun kenarı önceki partilerde zaten yazılmıştı. Bu turda yeniden
tarandığında bir tanesi daha kanıta bağlandı:

  * `dogus-otomotiv` -> products#636 "Doğuş Otomotiv Genel Merkezi" (2013-2018, Kartal)
    DAYANAK: koleksiyondesign.com'un proje hero görselinin dosya adı
    `2014-era-dogus-oto-hq-06-1740727722.jpg` — "hq" (genel merkez) ibaresi ve 2014 tarihi.
    D1'de 6 "Doğuş ..." adayı var; "hq"/genel merkez olan TEK aday #636 ve 2014 onun
    2013-2018 aralığının içinde. Elenen adaylar: #502 Teknoloji Merkezi (2012-2014 — tarih
    tutuyor ama "Teknoloji Merkezi", HQ değil), #529 Doğuş HOLDING (farklı tüzel kişi),
    #821 Eğitim ve Gelişim Merkezi (2023-2025), #1431 Bursa (2012, şube), #1662 Maslak Kulesi.
    Bu, önceki partide Allianz için kullanılan AYNI dosya-adı dayanağı yöntemidir.

ELENENLER (kanıt yetersiz — hiçbiri yazılmadı): acibadem-kartal-hastanesi, acibadem-universitesi,
okan-universitesi, fi, x-office, mavi-genel-mudurluk, polisan, ernst-young, etiler-dunyagoz,
abbvie, bakraz-evleri, bilge-adam-koleji, cesme-dalyan-panorama, clyde-co, cognita, covidien,
croda, gcgra, gt-law, kuwait-universitesi, mercer, pelit-insaat, savills.
  - "Mavi Genel Müdürlük" için D1'deki "Bebek Mavi Ev" ve "Sultanahmet Camii (Mavi Cami)"
    yalnızca kelime çakışması — ikisi de konut/cami, ELENDİ.
  - "Mercer" için D1'deki "The Mercer" (İzmir) bir otel/karma yapı; kaynak ise bir danışmanlık
    ofisi — önceki partide de aynı gerekçeyle elenmişti.
  - Kalanların D1'de hiç adayı yok.

Kullanım: python3 scripts/crosstag-koleksiyon4-projects.py [--dry-run]
"""
import argparse
import importlib.util as _ilu
import os

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = _ilu.spec_from_file_location('import_archello_products',
                                     os.path.join(HERE, 'import-archello-products.py'))
imp = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(imp)
d1, d1_file = imp.d1, imp.d1_file

KOLEKSIYON_OFFICE_ID = 717

# (project_id, dayanak) — yalnızca ELLE doğrulanmış satırlar.
MATCHES = [
    (636, 'dogus-otomotiv -> hero görseli "2014-era-dogus-oto-hq-06": hq + 2014'),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    # d1() DOĞRUDAN results dizisini döndürür (bkz. import-archello-products.py#d1) —
    # ne json.loads ne [0]['results'] gerekir.
    existing = d1(f'SELECT project_id FROM project_brands WHERE office_id = {KOLEKSIYON_OFFICE_ID}')
    have = {r['project_id'] for r in existing}
    print(f'Koleksiyon (#{KOLEKSIYON_OFFICE_ID}) mevcut marka-proje kenarı: {len(have)}')

    todo = [(pid, why) for pid, why in MATCHES if pid not in have]
    for pid, why in MATCHES:
        state = 'ZATEN VAR' if pid in have else 'EKLENECEK'
        print(f'  #{pid:<5} {state:10} {why}')
    if not todo:
        print('Eklenecek yeni kenar yok.')
        return

    if args.dry_run:
        print(f'[dry-run] {len(todo)} kenar yazılmadı.')
        return

    # project_brands: (project_id, office_id) benzersiz — ON CONFLICT ile tekrar çalıştırılabilir.
    stmts = [
        f'INSERT INTO project_brands (project_id, office_id) VALUES ({pid}, {KOLEKSIYON_OFFICE_ID}) '
        f'ON CONFLICT(project_id, office_id) DO NOTHING'
        for pid, _ in todo
    ]
    # Çok ifadeli yazım d1_file ile (d1 tek SELECT içindir).
    d1_file(';\n'.join(stmts) + ';')
    print(f'{len(todo)} kenar yazıldı.')

    after = d1(f'SELECT COUNT(*) AS n FROM project_brands WHERE office_id = {KOLEKSIYON_OFFICE_ID}')
    print(f'Toplam kenar: {after[0]["n"]}')


if __name__ == '__main__':
    main()
