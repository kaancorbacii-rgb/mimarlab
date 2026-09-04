#!/usr/bin/env python3
"""koleksiyondesign.com/tr/projeler/ referans projelerini MİMARLAB projeleriyle eşleştirir
(2026-09-05, Koleksiyon 2. parti — bkz. scripts/scrape-koleksiyon2.py).

crosstag-btdesign-projects.py İLE AYNI ilke: OTOMATİK bulanık eşleştirme kullanılmaz, her satır
ELLE doğrulanır ve dayanağı yazılır (yanlış marka etiketi, etiketsizlikten kötüdür).

KAYNAK FARKI — bt.design'ın aksine koleksiyondesign.com'un proje detay sayfalarında "Bu Projedeki
Ürünler" ızgarası YOK (yalnızca hero görseli + "Year"/"Architect" stats, çoğu BOŞ) — bu yüzden
yalnızca project_brands (marka↔proje) kenarı yazılır, project_products YAZILMAZ (somut ürün
kimliği yok).

34 referans projeden (sitemap.xml + /tr/projeler/ sayfası, kategoriler: Çalışma/Sağlık/Yaşam/
Eğitim/Karşılama — Karşılama'da hâlâ hiç proje yok) yalnızca 10'u D1'de bulundu:

  - Başlık BİREBİR/ÇOK YAKIN eşleşen 7'si: Acıbadem Ataşehir Hastanesi, Yemeksepeti Park ("Yemek
    Sepeti"), Unilever Türkiye Genel Merkezi, TBWA İstanbul Ofisi, Sahibinden.com Ofisi,
    Mercedes-Benz İstanbul Genel Merkezi, Piri Reis Üniversitesi Denizcilik Kampüsü.
  - Kelime sırası değişmiş 1'i: "Topos Villa" -> D1'de "Villa Topos" (İzmir, aynı proje).
  - Ad+bağlam eşleşmesi 1'i: "Tema" -> D1'de "TEMA Vakfı Genel Müdürlüğü İç Mekan Projesi"
    (TEMA Vakfı çevre STK'sı, başka aday yok).
  - Görsel dosya adı ipucu 1'i: "Allianz" -> D1'de 3 aday (Kampüs İzmir/Türkiye HQ/Tower) vardı;
    koleksiyondesign.com'un hero görseli "2015-allianz-hq-*.jpg" adında ("hq" ibaresi) ve D1'deki
    "Allianz Türkiye HQ" (2016, İstanbul) hem isim hem tarih olarak en yakın aday — diğer ikisi
    (Kampüs İzmir 2016-2018, Tower 2010-2014) elendi.

DIŞARIDA BIRAKILANLAR (24) — ya D1'de hiç aday yok (Okan Üniversitesi, Etiler Dünyagöz, Covidien,
Cognita, Clyde&Co, Savills, GT Law, GCGRA, AbbVie, Çeşme Dalyan Panorama, Bakraz Evleri, Pelit
İnşaat, Polisan, Croda, Mavi Genel Müdürlük, Kuwait Üniversitesi, Acıbadem Üniversitesi, Bilge Adam
Koleji, Acıbadem Kartal Hastanesi, Ernst & Young) ya da aday VAR ama BELİRSİZ ve koleksiyondesign.
com'un kendi "Architect" alanı D1'deki hiçbir adayla eşleşmiyor:
  * "Mercer"/"GT Law"/"GCGRA"/"Savills"/"Cognita"/"Clyde&Co" hepsi kaynakta AYNI "MILO Interiors
    LLC" mimarlık ofisi + 2024 tarihini taşıyor — MILO Interiors D1'de HİÇ YOK, "Mercer" için tek
    aday olan D1'deki "The Mercer" (İzmir) ise bir OTEL/karma yapı, danışmanlık ofisiyle alakasız
    (isim çakışması) — ELENDİ.
  * "X Office" -> kaynakta "Architect: X office" (kendi adı), D1'de "X Office" başlıklı proje YOK,
    8 aday hepsi "office" kelimesinden yakalanan alakasız projeler — ELENDİ.
  * "AbbVie" -> kaynak mimarı "Jeyan Ülkü"; Jeyan Ülkü Mimarlık'ın D1'deki 5 projesinden HİÇBİRİ
    "AbbVie" adını taşımıyor (Good Job Games/İş Yatırım/Yves Rocher/Informa/Brown-Forman) — ELENDİ.
  * "Doğuş Otomotiv" -> kaynak mimarı "Oğuz Bayazıt"; D1'deki 3 "Doğuş Otomotiv ..." projesinden
    hiçbirinin künyesinde bu isim yok, hangisi olduğu BELİRLENEMEDİ — ELENDİ.
  * "Mavi Genel Müdürlük" -> kaynak mimarı "Erginoğlu & Çalışlar" (2025); D1'de bu ofisin künyeli
    hiçbir "Mavi" projesi yok (yalnızca alakasız "Mavi Cami"/"Yedimavi"/"Mavi Ev") — ELENDİ.
  * "Fi" -> D1'de başlığı TAM OLARAK "Fi" olan proje yok, iki harfli ad aşırı jenerik — ELENDİ.

Kullanım:
  python3 scripts/crosstag-koleksiyon2-projects.py [--dry-run]
"""
import argparse
import importlib.util as _ilu
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = _ilu.spec_from_file_location('import_archello_products',
                                     os.path.join(HERE, 'import-archello-products.py'))
imp = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(imp)
q, d1, d1_file = imp.q, imp.d1, imp.d1_file

KOLEKSIYON_OFFICE_ID = 717
ELEMENT = 'Mobilya'

# koleksiyondesign.com proje adı -> (MİMARLAB projects.id, dayanak)
MATCHES = {
    'Acıbadem Ataşehir Hastanesi': (571, 'başlık birebir'),
    'Yemek Sepeti': (358, 'D1: Yemeksepeti Park, Beşiktaş — aynı şirketin kampüsü'),
    'Unilever': (1759, 'D1: Unilever Türkiye Genel Merkezi'),
    'TBWA': (361, 'D1: TBWA İstanbul Ofisi'),
    'Tema': (1124, 'D1: TEMA Vakfı Genel Müdürlüğü İç Mekan Projesi (TEMA Vakfı)'),
    'Sahibinden': (242, 'D1: Sahibinden.com Ofisi'),
    'Mercedes-Benz': (1603, 'D1: Mercedes-Benz İstanbul Genel Merkezi'),
    'Topos Villa': (894, 'D1: Villa Topos, İzmir (kelime sırası ters)'),
    'Piri Reis Üniversitesi': (263, 'D1: Piri Reis Üniversitesi Denizcilik Kampüsü, Tuzla'),
    'Allianz': (1118, 'D1: Allianz Türkiye HQ (2016, İstanbul); kaynak hero görseli '
                       '"2015-allianz-hq-*.jpg" — diğer 2 aday (Kampüs İzmir/Tower) elendi'),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    ids = sorted({pid for pid, _ in MATCHES.values()})
    rows = d1(f"SELECT id, title FROM projects WHERE id IN ({','.join(str(i) for i in ids)}) "
              "AND deleted_at IS NULL")
    found = {r['id']: r['title'] for r in rows}
    missing = set(ids) - set(found)
    if missing:
        raise SystemExit(f'D1de bulunamayan proje id leri: {sorted(missing)}')

    print(f'{len(MATCHES)} eşleşme:')
    for name, (pid, why) in MATCHES.items():
        print(f"  {name[:30]:32} -> D1 #{pid} {found[pid][:40]:42} dayanak: {why}")

    if args.dry_run:
        print('\n[dry-run] project_brands yazılmadı.')
        return 0

    rows_sql = ',\n'.join(f'({pid}, {KOLEKSIYON_OFFICE_ID}, {q(ELEMENT)}, \'admin\')'
                          for pid in ids)
    stmt = ('INSERT INTO project_brands (project_id, office_id, element, source)\n'
            f'VALUES\n{rows_sql}\n'
            'ON CONFLICT(project_id, office_id) DO UPDATE SET\n'
            '  element = COALESCE(project_brands.element, excluded.element);')
    d1_file(stmt)
    print(f'\n{len(ids)} project_brands kenarı yazıldı (Koleksiyon, office_id={KOLEKSIYON_OFFICE_ID}).')

    got = d1(f'SELECT COUNT(*) n FROM project_brands WHERE office_id = {KOLEKSIYON_OFFICE_ID}')
    print(f"doğrulama: Koleksiyon'un toplam project_brands satırı = {got[0]['n']}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
