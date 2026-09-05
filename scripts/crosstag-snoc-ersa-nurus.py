#!/usr/bin/env python3
"""SNOC / Ersa Mobilya / Nurus referans projelerini MİMARLAB projeleriyle eşleştirir (2026-09-05).

crosstag-koleksiyon*-projects.py ile AYNI ilke: OTOMATİK bulanık eşleştirme SONUÇ OLARAK
KULLANILMAZ — yalnızca aday üretmek için kullanılır, her satır ELLE doğrulanır ve dayanağı
yazılır. Yanlış marka etiketi, etiketsizlikten kötüdür (bir mimarın proje künyesine kullanmadığı
bir markayı yazmış oluruz).

KAYNAKLAR (üçü de JS ile render ediliyor; proje adları ham HTML'de YOK, tarayıcıda okundu):
  SNOC  https://www.snoc.com.tr/pages/projeler1   -> 34 referans (otel/marina/konut, dış mekan)
  Ersa  https://www.ersamobilya.com/projeler/     ->  4 referans
  Nurus https://nurus.com/tr/referans-galerisi/   -> 41 referans (ofis mobilyası)

OTOMATİK ADAYLARDAN ELENENLER (hepsi elle bakılıp REDDEDİLDİ — token eşleşmesi yanıltıcıydı):
  * "ARGOS HOTEL | KAPADOKYA"      -> #1078 "Argos Yapı Kavak Konak": "Argos Yapı" bir MÜTEAHHİT
    firma, Kapadokya'daki "Argos in Cappadocia" oteli DEĞİL. Farklı tüzel kişi.
  * "ST. REGIS | KATAR"            -> #167 "St. Regis İstanbul": aynı otel zinciri, FARKLI ÜLKE.
  * "FOUR POINTS BY SHERATON | İSTANBUL" -> #287 "Sheraton Grand Samsun": farklı şehir + farklı
    marka basamağı.
  * "ARMADA PRAXIS | MUĞLA"        -> #832 Armada Foods (Mersin) / #1165 Armada AVM (Ankara):
    ikisi de Muğla değil.
  * "VİLLA BOSPHORUS | İSTANBUL"   -> #21 "Shangri-La Bosphorus Hotel": otel, villa değil.
  * "HOUSE OF Q | BURSA" / "İSTİNYE | İSTANBUL": D1'de birden çok belirsiz aday, hiçbiri kesin.
  * "Unilever Kazakistan"          -> #1759 "Unilever Türkiye Genel Merkezi": FARKLI ÜLKE.
  * "Turkcell HQ"                  -> #1092 "Turkcell AR-GE Binası" (Kocaeli): HQ (Maltepe) ile
    AR-GE binası farklı yapılar.
  * "Philip Morris" / "Abdullah Gül Üniversitesi": D1'de 2-3 aday var, kaynak HANGİSİ olduğunu
    söylemiyor — belirsiz olduğu için hiçbiri yazılmadı.

ERSA: 4 referansının (Burcu Gıda, Europower Enerji, EBSO Merkez Binası, İlber Ortaylı
Kütüphanesi) HİÇBİRİ MİMARLAB'da yok — hedefli arama ile doğrulandı. Marka kaydı (#769) sitede
var ama bağlanacak proje yok. Bu projeler ileride eklenirse buraya eklenmeli.

ÜRÜN DÜZEYİ KENAR YAZILMIYOR: üç kaynağın da referans sayfası "bu projede şu MODEL kullanıldı"
bilgisi vermiyor, yalnızca proje adı/görseli listeliyor. Kanıtsız ürün kenarı, künyede
doğrulanamaz bir iddia olurdu (bkz. crosstag-koleksiyon4-project-products.py'deki AYNI gerekçe).

Kullanım: python3 scripts/crosstag-snoc-ersa-nurus.py [--dry-run]
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

# office_id -> [(project_id, dayanak)] — YALNIZCA elle doğrulanmış satırlar.
EDGES = {
    775: [  # SNOC — dış mekan mobilyası
        (182,  'THE BANK HOTEL | İSTANBUL -> "The Bank Hotel Istanbul", ad + şehir birebir'),
        (1547, 'ASCENT OF URLA | İZMİR -> "Ascent of Urla", ad + şehir (İzmir/Urla) birebir'),
        (253,  'MANDARIN ORIENTAL BODRUM | MUĞLA -> "Mandarin Oriental Hotel ve Villaları Bodrum"'),
        (378,  'YALIKAVAK MARİNA | MUĞLA -> "Yalıkavak Palmarina" (Bodrum): Yalıkavak marinasının '
               'ticari adı Palmarina Yalıkavak\'tır, aynı tesis'),
        (627,  'SIX SENSES KOCATAS MANSIONS | İSTANBUL -> "Kocataş Mansions İstanbul" (Sarıyer): '
               'Six Senses bu yalıların işletmecisi, aynı yapı'),
    ],
    724: [  # Nurus — ofis mobilyası
        (696,  'Allianz Kampüs, İzmir -> "Allianz Kampüs İzmir", birebir'),
        (490,  'Selçuk Ecza Genel Müdürlük -> "Selçuk Ecza Genel Müdürlük Binası", birebir'),
        (65,   'İstanbul Havalimanı -> "İstanbul Havalimanı", birebir'),
        (1316, 'Milas-Bodrum Havalimanı -> "Bodrum Milas Havalimanı Yeni Dış Hatlar Terminali", '
               'aynı havalimanı'),
        (1122, 'Hepsiburada.com -> "hepsiburada.com Operasyon Merkezi", aynı kurum'),
        (1493, 'EnerjiSA -> "Enerjisa Ataşehir Ofisi": aynı kurum ve OFİS projesi (Nurus ofis '
               'mobilyası üreticisi)'),
        (82,   'Vodafone Arena -> "Beşiktaş Stadyumu (Vodafone Park)": Vodafone Arena, stadın '
               '2016-2021 arasındaki adıdır, aynı yapı'),
        (1743, 'Arıkan Grup & Konyalı Saat -> "Konyalı Saat Genel Merkezi", referansın '
               'Konyalı Saat ayağı'),
    ],
    # 769 (Ersa Mobilya): eşleşen proje YOK — bkz. dosya başı.
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    office_ids = ','.join(str(o) for o in EDGES)
    offices = {r['id']: r['name'] for r in d1(f'SELECT id, name FROM offices WHERE id IN ({office_ids})')}
    pids = {p for lst in EDGES.values() for p, _ in lst}
    projects = {r['id']: r['title'] for r in
                d1(f"SELECT id, title FROM projects WHERE id IN ({','.join(map(str, pids))})")}
    existing = {(r['project_id'], r['office_id']) for r in d1(
        f'SELECT project_id, office_id FROM project_brands WHERE office_id IN ({office_ids})')}

    todo = []
    for oid, lst in EDGES.items():
        print(f'--- {offices.get(oid, oid)} (#{oid}) ---')
        for pid, why in lst:
            if pid not in projects:
                print(f'  #{pid:<5} ATLANDI  proje D1\'de yok/silinmiş')
                continue
            state = 'ZATEN VAR' if (pid, oid) in existing else 'EKLENECEK'
            print(f'  #{pid:<5} {state:10} {projects[pid][:40]:<42} {why[:60]}')
            if (pid, oid) not in existing:
                todo.append((pid, oid))

    if not todo:
        print('\nEklenecek yeni kenar yok.')
        return
    if args.dry_run:
        print(f'\n[dry-run] {len(todo)} kenar yazılmadı.')
        return

    stmts = [f'INSERT INTO project_brands (project_id, office_id) VALUES ({p}, {o}) '
             f'ON CONFLICT(project_id, office_id) DO NOTHING' for p, o in todo]
    d1_file(';\n'.join(stmts) + ';')
    print(f'\n{len(todo)} kenar yazıldı.')
    for oid in EDGES:
        n = d1(f'SELECT COUNT(*) AS n FROM project_brands WHERE office_id = {oid}')[0]['n']
        print(f'  {offices.get(oid, oid)}: toplam {n} proje kenarı')


if __name__ == '__main__':
    main()
