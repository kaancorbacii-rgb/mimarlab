#!/usr/bin/env python3
"""Koleksiyon 82-URL partisi (2026-09-05, 4. parti: masalar/sehpalar/depolama/yatak odası/
bölücü paneller/dış mekan) grup tanımları.

koleksiyon3-groups.py ile AYNI sözleşme (scrape-koleksiyon4.py ve koleksiyon4-build-payload.py
bu modülü import eder): her grup {'name', 'urls': [path...], 'merge_id': <products.id|None>,
'category': <katalog kategorisi>}.

`merge_id` TAHMİN DEĞİL — 2026-09-05'te canlı D1'den çekilen 95 Koleksiyon satırı üzerinde
doğrulandı. Her merge hedefi altında `# dayanak:` yorumu var. merge_id None olanlar YENİ satır
açar.

GÖREV METNİNDEKİ KONSOLİDASYON TALİMATLARI birebir uygulandı; aşağıdaki her çok-URL'li grup o
talimatların karşılığıdır (Partita/Cantata/Guamba/Platon/Madrigal/Vienna/Line/Song/Path/Doffice/
Archi/Juliet/Mestre/Terna/Baha/Elisse/Threshold/Era/Ena/Lily/Cage/Hug/Laluce).

ÜÇ TUZAK (bu partiye özel, hepsi D1 verisiyle doğrulandı):

1) **Narcissus (#132) ve Plato (#121), Song (#133), Suenios (#134), Satie (#131)** gibi ESKİ
   satırların source_url'i `/en/products/...` (İNGİLİZCE) biçiminde. Bu partideki sayfalar
   `/tr/urunler/...`. Yani sourceUrl bazlı eleme onları EŞLEŞTİREMEZ ve versiyonları silmez —
   istenen de bu (bkz. koleksiyon3 notu: eleme sourceUrl'e göre yapılır). Ama merge_id ile
   doğru satıra bağlanmaları ŞART, aksi halde katalogda ikinci bir "Narcissus" kartı açılır.

2) **Cantata (#561) bir SANDALYE satırı**, bu partide gelen `cantata-yemek-masalari` ise masa.
   Görev metni açıkça "Cantata Serisi ile konsolide edilmeli veya masa varyantı olarak
   ilişkilendirilmeli" diyor → #561'e masa varyantı olarak eklenir. Kategori DEĞİŞTİRİLMEZ
   (mevcut satırın kategorisine dokunulmaz, bkz. build-payload).

3) **Terna / Baha / Laluce / Archi / Juliet** sehpa+komodin(+dolap) çiftleri: ikisi de bu
   partide, ikisi de YENİ. Tek satır açılır, tip ekseni (`Tip`) iki sayfayı ayırır.
"""

BASE = 'https://www.koleksiyondesign.com/tr/urunler/'

# ---------------------------------------------------------------------------------------------
# MASALAR — evde ofis / yemek / sehpa
# ---------------------------------------------------------------------------------------------
TABLES = [
    {'name': 'Nabu', 'merge_id': None, 'category': 'Masa', 'urls': [
        'masalar/evde-ofis-masalari/nabu-evde-ofis-masalari/']},
    {'name': 'Rialto', 'merge_id': None, 'category': 'Masa', 'urls': [
        'masalar/evde-ofis-masalari/rialto-evde-ofis-masalari/']},
    {'name': 'Ilanna', 'merge_id': None, 'category': 'Masa', 'urls': [
        'masalar/evde-ofis-masalari/ilanna-evde-ofis-masalari/']},

    # Cantata: masa sayfası mevcut SANDALYE satırına varyant olarak katılır (bkz. tuzak 2).
    {'name': 'Cantata', 'merge_id': 561, 'category': 'Sandalye & Tabure', 'urls': [  # dayanak: #561 Cantata, sandalyeler sayfası
        'masalar/yemek-masalari/cantata-yemek-masalari/']},

    # Guamba: yemek masası + sehpa TEK ailede (görev metni).
    {'name': 'Guamba', 'merge_id': None, 'category': 'Masa', 'urls': [
        'masalar/yemek-masalari/guamba-yemek-masalari/',
        'masalar/sehpalar/guamba-sehpalar/']},

    {'name': 'Iris', 'merge_id': None, 'category': 'Masa', 'urls': [
        'masalar/yemek-masalari/iris-yemek-masalari/']},
    {'name': 'Tango', 'merge_id': None, 'category': 'Masa', 'urls': [
        'masalar/yemek-masalari/tango-yemek-masalari/']},
    {'name': 'Adola', 'merge_id': None, 'category': 'Masa', 'urls': [
        'masalar/yemek-masalari/adola-yemek-masalari/']},

    # Platon: yemek masası + sehpa TEK ailede (görev metni).
    {'name': 'Platon', 'merge_id': None, 'category': 'Masa', 'urls': [
        'masalar/yemek-masalari/platon-yemek-masalari/',
        'masalar/sehpalar/platon-sehpalar/']},

    # Partita: mevcut masa sistemleri ailesine yemek masası fonksiyonu olarak eklenir (görev metni).
    {'name': 'Partita', 'merge_id': 122, 'category': 'Ofis Mobilyası', 'urls': [  # dayanak: #122 Partita, masa-sistemleri, 33 versiyon
        'masalar/yemek-masalari/partita-yemek-masalari/']},

    # --- Sehpalar ---
    {'name': 'Stilos', 'merge_id': None, 'category': 'Masa', 'urls': ['masalar/sehpalar/stilos-sehpalar/']},
    {'name': 'Ray', 'merge_id': None, 'category': 'Masa', 'urls': ['masalar/sehpalar/ray-sehpalar/']},
    {'name': 'Diamond', 'merge_id': None, 'category': 'Masa', 'urls': ['masalar/sehpalar/diamond-sehpalar/']},
    {'name': 'Plan', 'merge_id': None, 'category': 'Masa', 'urls': ['masalar/sehpalar/plan-sehpalar/']},
    {'name': 'Sihirli Kare', 'merge_id': None, 'category': 'Masa', 'urls': ['masalar/sehpalar/sihirlikare-sehpalar/']},
    {'name': 'Milva', 'merge_id': None, 'category': 'Masa', 'urls': ['masalar/sehpalar/milva-sehpalar/']},
    {'name': 'Cross', 'merge_id': None, 'category': 'Masa', 'urls': ['masalar/sehpalar/cross-sehpalar/']},
    {'name': 'Rondo', 'merge_id': None, 'category': 'Masa', 'urls': ['masalar/sehpalar/rondo-sehpalar/']},
    {'name': 'Tetraedo', 'merge_id': None, 'category': 'Masa', 'urls': ['masalar/sehpalar/tetraedo-sehpalar/']},

    # Narcissus: mevcut satırın source_url'i İngilizce (bkz. tuzak 1) — merge_id şart.
    {'name': 'Narcissus', 'merge_id': 132, 'category': 'Masa', 'urls': [  # dayanak: #132 Narcissus, /en/products/tables/coffee-t...
        'masalar/sehpalar/narcissus-sehpalar/']},

    # Line / Madrigal / Vienna sehpaları mevcut oturma ailelerine sehpa varyantı olarak (görev metni).
    {'name': 'Line', 'merge_id': 450, 'category': 'Koltuk & Kanepe', 'urls': [  # dayanak: #450 Line, kanepeler
        'masalar/sehpalar/line-sehpalar/']},
    {'name': 'Madrigal', 'merge_id': 488, 'category': 'Koltuk & Kanepe', 'urls': [  # dayanak: #488 Madrigal, kanepeler
        'masalar/sehpalar/madrigal-sehpalar/']},
    {'name': 'Vienna', 'merge_id': 473, 'category': 'Koltuk & Kanepe', 'urls': [  # dayanak: #473 Vienna, kanepeler
        'masalar/sehpalar/vienna-sehpalar/']},

    # Terna / Baha: sehpa + komodin çifti, ikisi de bu partide ve YENİ (bkz. tuzak 3).
    {'name': 'Terna', 'merge_id': None, 'category': 'Masa', 'urls': [
        'masalar/sehpalar/terna-sehpalar/',
        'yataklar-ve-gardiroplar/komodinler/terna-gece-sehpalari-ve-sifonyerler/']},
    {'name': 'Baha', 'merge_id': None, 'category': 'Masa', 'urls': [
        'masalar/sehpalar/baha-sehpalar/',
        'yataklar-ve-gardiroplar/komodinler/baha-gece-sehpalari-ve-sifonyerler/']},

    # Laluce: sehpa + dolap/büfe (görev metnindeki "depolama tamamlayıcısı" mantığı).
    {'name': 'Laluce', 'merge_id': None, 'category': 'Masa', 'urls': [
        'masalar/sehpalar/laluce-sehpalar/',
        'depolama/dolaplar-ve-bufeler/laluce-dolaplar-ve-bufeler/']},

    # Hug: iç mekan sehpası + dış mekan sandalyesi TEK Hug Koleksiyonu (görev metni).
    {'name': 'Hug', 'merge_id': None, 'category': 'Masa', 'urls': [
        'masalar/sehpalar/hug-sehpalar/',
        'dis-mekan/sandalyeler/hug-sandalyeler/']},
]

# ---------------------------------------------------------------------------------------------
# DEPOLAMA — kitaplık/TV, dolap/büfe, keson (pedestal)
# ---------------------------------------------------------------------------------------------
STORAGE = [
    {'name': 'Plato', 'merge_id': 121, 'category': 'Dolap & Depolama', 'urls': [  # dayanak: #121 Plato, /en/products/storage/bookcas...
        'depolama/kitaplik-ve-tv-uniteleri/plato-kitaplik-ve-tv-uniteleri/']},

    # Elisse: kitaplık/TV + dolap/büfe TEK depolama sistemi (görev metni).
    {'name': 'Elisse', 'merge_id': None, 'category': 'Dolap & Depolama', 'urls': [
        'depolama/kitaplik-ve-tv-uniteleri/elisse-kitaplik-ve-tv-uniteleri/',
        'depolama/dolaplar-ve-bufeler/elisse-dolaplar-ve-bufeler/']},

    {'name': 'Threshold', 'merge_id': 592, 'category': 'Ofis Mobilyası', 'urls': [  # dayanak: #592 Threshold, masa-sistemleri, 47 versiyon
        'depolama/dolaplar-ve-bufeler/threshold-dolaplar-ve-bufeler/']},

    # Path / Doffice / Song: dolap/büfe + keson TEK ailede (görev metni).
    {'name': 'Path', 'merge_id': None, 'category': 'Dolap & Depolama', 'urls': [
        'depolama/dolaplar-ve-bufeler/path-dolaplar-ve-bufeler/',
        'depolama/operasyonel-depolama/path-pedestal-operasyonel-depolama/']},
    {'name': 'Doffice', 'merge_id': None, 'category': 'Dolap & Depolama', 'urls': [
        'depolama/dolaplar-ve-bufeler/doffice-dolaplar-ve-bufeler/',
        'depolama/operasyonel-depolama/doffice-pedestal-operasyonel-depolama/']},
    {'name': 'Song', 'merge_id': 133, 'category': 'Dolap & Depolama', 'urls': [  # dayanak: #133 Song, /en/products/storage/cabinet...
        'depolama/dolaplar-ve-bufeler/song-dolaplar-ve-bufeler/',
        'depolama/operasyonel-depolama/song-pedestal-operasyonel-depolama/']},

    # Archi / Juliet: dolap/büfe + komodin TEK koleksiyon (görev metni).
    {'name': 'Archi', 'merge_id': None, 'category': 'Dolap & Depolama', 'urls': [
        'depolama/dolaplar-ve-bufeler/archi-dolaplar-ve-bufeler/',
        'yataklar-ve-gardiroplar/komodinler/archi-komodinler/']},
    {'name': 'Juliet', 'merge_id': None, 'category': 'Dolap & Depolama', 'urls': [
        'depolama/dolaplar-ve-bufeler/juliet-dolaplar-ve-bufeler/',
        'yataklar-ve-gardiroplar/komodinler/juliet-gece-sehpalari-ve-sifonyerler/']},

    {'name': 'Babil Ağacı', 'merge_id': 228, 'category': 'Dolap & Depolama', 'urls': [  # dayanak: #228 Babil Ağacı, depolama/babil-agaci/
        'depolama/dolaplar-ve-bufeler/babil-dolaplar-ve-bufeler/']},
    {'name': 'Era', 'merge_id': 599, 'category': 'Ofis Mobilyası', 'urls': [  # dayanak: #599 Era, yonetici-masalari
        'depolama/dolaplar-ve-bufeler/era-dolaplar-ve-bufeler/']},
    {'name': 'Rarum', 'merge_id': None, 'category': 'Dolap & Depolama', 'urls': [
        'depolama/dolaplar-ve-bufeler/rarum-dolaplar-ve-bufeler/']},
    {'name': 'Karnaval', 'merge_id': None, 'category': 'Dolap & Depolama', 'urls': [
        'depolama/dolaplar-ve-bufeler/karnaval-dolaplar-ve-bufeler/']},
]

# ---------------------------------------------------------------------------------------------
# YATAK ODASI
# ---------------------------------------------------------------------------------------------
BEDROOM = [
    {'name': 'Virasana', 'merge_id': None, 'category': 'Yatak & Baza', 'urls': [
        'yataklar-ve-gardiroplar/komodinler/virasana-komodinler/']},
    # Mestre: yatak + gece sehpası TEK yatak odası koleksiyonu (görev metni).
    {'name': 'Mestre', 'merge_id': None, 'category': 'Yatak & Baza', 'urls': [
        'yataklar-ve-gardiroplar/yataklar/mestre-yataklar/',
        'yataklar-ve-gardiroplar/gece-sehpalari-ve-sifonyerler/mestre-gece-sehpalari-ve-sifonyerler/']},
    {'name': 'Aba', 'merge_id': None, 'category': 'Yatak & Baza', 'urls': [
        'yataklar-ve-gardiroplar/komodinler/aba-gece-sehpalari-ve-sifonyerler/']},
    {'name': 'Suenios', 'merge_id': 134, 'category': 'Yatak & Baza', 'urls': [  # dayanak: #134 Suenios, /en/products/beds-wardrobes/...
        'yataklar-ve-gardiroplar/yataklar/suenios-yataklar/']},
    {'name': 'Amos', 'merge_id': None, 'category': 'Yatak & Baza', 'urls': [
        'yataklar-ve-gardiroplar/yataklar/amos-yataklar/']},
]

# ---------------------------------------------------------------------------------------------
# MEKANSAL BÖLÜCÜLER — görev metni: bağımsız ana ürünler, modül/ebat seçenekleri varyant
# ---------------------------------------------------------------------------------------------
DIVIDERS = [
    {'name': 'Mudita', 'merge_id': None, 'category': 'Ofis Mobilyası', 'urls': ['mekansal-boluculer/bolucu-panel/mudita-bolucu-panel/']},
    {'name': 'Megaron', 'merge_id': None, 'category': 'Ofis Mobilyası', 'urls': ['mekansal-boluculer/bolucu-panel/megaron-bolucu-panel/']},
    {'name': 'Teamwall', 'merge_id': None, 'category': 'Ofis Mobilyası', 'urls': ['mekansal-boluculer/bolucu-panel/teamwall-bolucu-panel/']},
]

# ---------------------------------------------------------------------------------------------
# DIŞ MEKAN
# ---------------------------------------------------------------------------------------------
OUTDOOR = [
    # Ena: sandalye + sehpa TEK dış mekan ailesi (görev metni).
    {'name': 'Ena', 'merge_id': None, 'category': 'Dış Mekan', 'urls': [
        'dis-mekan/sandalyeler/ena-sandalyeler/',
        'dis-mekan/sehpalar/ena-sehpalar/']},
    {'name': 'Knot', 'merge_id': None, 'category': 'Dış Mekan', 'urls': ['dis-mekan/sandalyeler/knot-sandalyeler/']},
    {'name': 'Hybrid', 'merge_id': None, 'category': 'Dış Mekan', 'urls': ['dis-mekan/sandalyeler/hybrid-sandalyeler/']},
    {'name': 'Louise', 'merge_id': None, 'category': 'Dış Mekan', 'urls': ['dis-mekan/kanepeler/louise-kanepeler/']},
    # Lily: kanepe + sehpa TEK dış mekan ailesi (görev metni).
    {'name': 'Lily', 'merge_id': None, 'category': 'Dış Mekan', 'urls': [
        'dis-mekan/kanepeler/lily-kanepeler/',
        'dis-mekan/sehpalar/lily-sehpalar/']},
    {'name': 'Relax', 'merge_id': None, 'category': 'Dış Mekan', 'urls': ['dis-mekan/kanepeler/relax-kanepeler/']},
    {'name': 'Nomad', 'merge_id': None, 'category': 'Dış Mekan', 'urls': ['dis-mekan/kanepeler/nomad-kanepeler/']},
    {'name': 'Rotunda', 'merge_id': None, 'category': 'Dış Mekan', 'urls': ['dis-mekan/masalar/rotunda-masalar/']},
    {'name': 'Calix', 'merge_id': None, 'category': 'Dış Mekan', 'urls': ['dis-mekan/masalar/calix-masalar/']},
    {'name': 'Emma', 'merge_id': None, 'category': 'Dış Mekan', 'urls': ['dis-mekan/masalar/emma-masalar/']},
    {'name': 'Pablo', 'merge_id': None, 'category': 'Dış Mekan', 'urls': ['dis-mekan/sehpalar/pablo-sehpalar/']},
    {'name': 'Castillo', 'merge_id': None, 'category': 'Dış Mekan', 'urls': ['dis-mekan/sehpalar/castillo-sehpalar/']},
    {'name': 'Manta', 'merge_id': None, 'category': 'Dış Mekan', 'urls': ['dis-mekan/sehpalar/manta-sehpalar/']},
    # Cage: sehpa + tabure TEK dış mekan ailesi (görev metni: "Ena / Lily / Cage ... tekil aileler").
    {'name': 'Cage', 'merge_id': None, 'category': 'Dış Mekan', 'urls': [
        'dis-mekan/sehpalar/cage-sehpalar/',
        'dis-mekan/tabureler-ve-puflar/cage-tabureler-ve-puflar/']},
    {'name': 'Dante', 'merge_id': None, 'category': 'Dış Mekan', 'urls': ['dis-mekan/tabureler-ve-puflar/dante-tabureler-ve-puflar/']},

    # COLOS (İtalyan iş birliği). Görev metni: "kendi içindeki form/ayak türevleriyle
    # varyantlandırılmalı (Colos Stecca 7/8, Colos TA, Pigreco)" — parantez içi liste ÜÇ ayrı ana
    # ürün sayıyor, Stecca'nın 7 ve 8'i ise TEK ürünün ayak/form türevi. Bire bir böyle kuruldu.
    {'name': 'Colos Stecca', 'merge_id': None, 'category': 'Dış Mekan', 'urls': [
        'dis-mekan/tabureler-ve-puflar/colos-stecca-7-tabureler-ve-puflar/',
        'dis-mekan/tabureler-ve-puflar/colos-stecca-8-tabureler-ve-puflar/']},
    {'name': 'Colos Pigreco', 'merge_id': None, 'category': 'Dış Mekan', 'urls': [
        'dis-mekan/tabureler-ve-puflar/colos-pigreco-tabureler-ve-puflar/']},
    {'name': 'Colos TA', 'merge_id': None, 'category': 'Dış Mekan', 'urls': [
        'dis-mekan/masalar/colos-ta-20-1q-700-masalar/']},
]

GROUPS = TABLES + STORAGE + BEDROOM + DIVIDERS + OUTDOOR

ALL_URLS = [BASE + p for g in GROUPS for p in g['urls']]

if __name__ == '__main__':
    seen = {}
    for g in GROUPS:
        for p in g['urls']:
            seen.setdefault(p, []).append(g['name'])
    dupes = {p: n for p, n in seen.items() if len(n) > 1}
    print(f'{len(GROUPS)} aile, {len(ALL_URLS)} URL, {len(seen)} tekil path')
    print(f'merge (mevcut satır): {sum(1 for g in GROUPS if g["merge_id"])}, yeni: {sum(1 for g in GROUPS if not g["merge_id"])}')
    if dupes:
        print('!! MÜKERRER PATH:', dupes)
