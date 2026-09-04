#!/usr/bin/env python3
"""Koleksiyon 64-URL partisi (2026-09-05, 3. parti: kanepe/puf/masa sistemleri) grup tanımları.

koleksiyon2-groups.py ile AYNI sözleşme (scrape-koleksiyon3.py ve koleksiyon3-build-payload.py
bu modülü import eder), iki farkla:

1) `merge_id` ARTIK TAHMİN DEĞİL. koleksiyon2'de "merge_title" ile D1'de başlığa göre arama
   yapılıyordu; burada hedef satırların id'leri 2026-09-05'te D1 sorgusuyla ELLE doğrulandı:
   64 sayfanın 26'sı mevcut bir `products` satırının source_url'i ile BİREBİR eşleşiyor, geri
   kalan merge hedefleri (Odette/Ikaros/Madrigal Chester/Alcove/Vienna/Dilim/Halia/Savio/Line/
   Anatole/Simplissimo/Partita/Convivium) aynı ailenin BAŞKA bir sayfasından gelen satırlar —
   her biri dosya içinde `# dayanak:` yorumuyla gerekçelendirildi.

2) Bu parti ağırlıklı olarak bir GÜNCELLEME partisi (52 aileden 34'ü zaten D1'de var). Görev
   metnindeki "fresh overwrite" bu yüzden SAYFA BAZINDA uygulanır — bkz. import-koleksiyon3.py
   dosya başı yorumu (aynı sourceUrl'li eski versiyon SİLİNİR ve tazesiyle değiştirilir, BAŞKA
   sayfalardan gelen versiyonlara dokunulmaz).

TUZAK — Gazel: `gazel-kanepeler` (products#437, Koltuk & Kanepe) ile `gazel-yonetici-masalari`
AYNI isimde ama FARKLI ürün tipleridir. Görev metni de bunu ayrıca şart koşuyor ("Fonksiyon
ayrımı net yapılarak doğru ürün ailelerine işlenmeli") — masa sayfası #437'ye BİRLEŞTİRİLMEZ,
"Gazel Yönetici Masası" adıyla YENİ bir ürün açar.
"""

BASE = 'https://www.koleksiyondesign.com/tr/urunler/'

# Her grup: {'name', 'urls': [path...], 'merge_id': <products.id ya da None>, 'category': <katalog>}
# category YALNIZCA yeni satırlarda kullanılır; mevcut satırın kategorisi ellenmez.

SEATING = [
    # --- Çok sayfalı (konsolide) oturma aileleri ---
    {'name': 'Dilim', 'merge_id': 205, 'category': 'Koltuk & Kanepe', 'urls': [
        'oturma-gruplari/kanepeler/dilim-kanepeler/',        # dayanak: #205 source_url birebir
        'oturma-gruplari/koltuklar/dilim-koltuklar/',
        'oturma-gruplari/tabureler-ve-puflar/dilim-tabureler-ve-puflar/',
    ]},
    {'name': 'Vienna', 'merge_id': 473, 'category': 'Koltuk & Kanepe', 'urls': [
        'oturma-gruplari/kanepeler/vienna-kanepeler/',       # dayanak: #473 source_url birebir
        'oturma-gruplari/tabureler-ve-puflar/vienna-tabureler-ve-puflar/',
    ]},
    {'name': 'Savio', 'merge_id': 454, 'category': 'Koltuk & Kanepe', 'urls': [
        'oturma-gruplari/kanepeler/savio-kanepeler/',        # dayanak: #454 source_url birebir
        'oturma-gruplari/tabureler-ve-puflar/savio-tabureler-ve-puflar/',
    ]},
    {'name': 'Line', 'merge_id': 450, 'category': 'Koltuk & Kanepe', 'urls': [
        'oturma-gruplari/kanepeler/line-kanepeler/',         # dayanak: #450 source_url birebir
        'oturma-gruplari/tabureler-ve-puflar/line-tabureler-ve-puflar/',
    ]},
    {'name': 'Simplissimo', 'merge_id': 482, 'category': 'Koltuk & Kanepe', 'urls': [
        'oturma-gruplari/kanepeler/simplissimo-kanepeler/',  # dayanak: #482 source_url birebir
        'oturma-gruplari/tabureler-ve-puflar/simplissimo-tabureler-ve-puflar/',
    ]},

    # --- Tek sayfalı, mevcut satıra eklenen oturma aileleri ---
    {'name': 'Chora', 'merge_id': 431, 'category': 'Koltuk & Kanepe',
     'urls': ['oturma-gruplari/kanepeler/chora-kanepeler/']},
    {'name': 'Play', 'merge_id': 433, 'category': 'Koltuk & Kanepe',
     'urls': ['oturma-gruplari/kanepeler/play-kanepeler/']},
    {'name': 'Bean', 'merge_id': 435, 'category': 'Koltuk & Kanepe',
     'urls': ['oturma-gruplari/kanepeler/bean-kanepeler/']},
    {'name': 'Gazel', 'merge_id': 437, 'category': 'Koltuk & Kanepe',
     'urls': ['oturma-gruplari/kanepeler/gazel-kanepeler/']},
    {'name': 'Roma', 'merge_id': 439, 'category': 'Koltuk & Kanepe',
     'urls': ['oturma-gruplari/kanepeler/roma-kanepeler/']},
    {'name': 'Obelix', 'merge_id': 441, 'category': 'Koltuk & Kanepe',
     'urls': ['oturma-gruplari/kanepeler/obelix-kanepeler/']},
    {'name': 'Almond', 'merge_id': 443, 'category': 'Koltuk & Kanepe',
     'urls': ['oturma-gruplari/kanepeler/almond-kanepeler/']},
    {'name': 'Duende', 'merge_id': 445, 'category': 'Koltuk & Kanepe',
     'urls': ['oturma-gruplari/kanepeler/duende-kanepeler/']},
    {'name': 'Capella', 'merge_id': 447, 'category': 'Koltuk & Kanepe',
     'urls': ['oturma-gruplari/kanepeler/capella-kanepeler/']},
    {'name': 'Diner', 'merge_id': 452, 'category': 'Koltuk & Kanepe',
     'urls': ['oturma-gruplari/kanepeler/diner-kanepeler/']},
    {'name': 'Oscar', 'merge_id': 456, 'category': 'Koltuk & Kanepe',
     'urls': ['oturma-gruplari/kanepeler/oscar-kanepeler/']},
    {'name': 'Laura', 'merge_id': 458, 'category': 'Koltuk & Kanepe',
     'urls': ['oturma-gruplari/kanepeler/laura-kanepeler/']},
    {'name': 'Alona', 'merge_id': 460, 'category': 'Koltuk & Kanepe',
     'urls': ['oturma-gruplari/kanepeler/alona-kanepeler/']},
    {'name': 'Evora', 'merge_id': 463, 'category': 'Koltuk & Kanepe',
     'urls': ['oturma-gruplari/kanepeler/evora-kanepeler/']},
    {'name': 'Serhas', 'merge_id': 465, 'category': 'Koltuk & Kanepe',
     'urls': ['oturma-gruplari/kanepeler/serhas-kanepeler/']},
    {'name': 'Serdivan', 'merge_id': 468, 'category': 'Koltuk & Kanepe',
     'urls': ['oturma-gruplari/kanepeler/serdivan-kanepeler/']},
    {'name': 'Madrigal', 'merge_id': 488, 'category': 'Koltuk & Kanepe',
     'urls': ['oturma-gruplari/kanepeler/madrigal-kanepeler/']},
    {'name': 'Tellasmar', 'merge_id': 476, 'category': 'Koltuk & Kanepe',
     'urls': ['oturma-gruplari/kanepeler/tellasmar-kanepeler/']},
    {'name': 'Tulip', 'merge_id': 479, 'category': 'Koltuk & Kanepe',
     'urls': ['oturma-gruplari/kanepeler/tulip-kanepeler/']},
    # dayanak: #485 source_url birebir 'poema-kanepeler'. DİKKAT: #226 "Poema" AYRI bir üründür
    # (source_url .../masalar/calisma-masalari/poema/ — bir MASA), ona dokunulmaz.
    {'name': 'Poema Kanepe', 'merge_id': 485, 'category': 'Koltuk & Kanepe',
     'urls': ['oturma-gruplari/kanepeler/poema-kanepeler/']},
    # dayanak: #119 source_url .../en/products/seating/sofas/odette-sofas/ — AYNI ailenin İngilizce
    # sayfası (tasarımcı Faruk Malhan; TR sayfası bu partide, kayıt İngilizce sayfadan gelmişti).
    {'name': 'Odette', 'merge_id': 119, 'category': 'Koltuk & Kanepe',
     'urls': ['oturma-gruplari/kanepeler/odette-kanepeler/']},
    # dayanak: #227 source_url .../tr/urunler/oturma-gruplari/kanepeler/ikaros/ — aynı ailenin eski
    # (kategorisiz) URL'i; bu parti kanonik '...-kanepeler/' sayfasını getiriyor.
    {'name': 'Ikaros', 'merge_id': 227, 'category': 'Koltuk & Kanepe',
     'urls': ['oturma-gruplari/kanepeler/ikaros-kanepeler/']},
    # dayanak: #554 source_url .../koltuklar/madrigal-chester-koltuklar/ — aynı ailenin koltuk
    # sayfası (koleksiyon2 partisinde eklendi), bu parti kanepe sayfasını ekliyor.
    {'name': 'Madrigal Chester', 'merge_id': 554, 'category': 'Koltuk & Kanepe',
     'urls': ['oturma-gruplari/kanepeler/madrigal-chester-kanepeler/']},

    # --- Tabure/puf sayfaları mevcut oturma ailelerine ekleniyor ---
    # dayanak: #582 source_url .../koltuklar/alcove-koltuklar/ (Defne Koz / Marco Susani)
    {'name': 'Alcove', 'merge_id': 582, 'category': 'Koltuk & Kanepe',
     'urls': ['oturma-gruplari/tabureler-ve-puflar/alcove-tabureler-ve-puflar/']},
    # dayanak: #206 source_url .../sandalyeler/halia-sandalyeler/ (Studio Kairos, 13 versiyon)
    {'name': 'Halia', 'merge_id': 206, 'category': 'Koltuk & Kanepe',
     'urls': ['oturma-gruplari/tabureler-ve-puflar/halia-tabureler-ve-puflar/']},
    # dayanak: #581 source_url .../calisma-sandalyeleri/anatole-calisma-sandalyeleri/ (Wilmotte)
    {'name': 'Anatole', 'merge_id': 581, 'category': 'Ofis Mobilyası',
     'urls': ['oturma-gruplari/tabureler-ve-puflar/anatole-tabureler-ve-puflar/']},
    # dayanak: #207 source_url birebir 'suri-tabureler-ve-puflar'
    {'name': 'Suri', 'merge_id': 207, 'category': 'Sandalye & Tabure',
     'urls': ['oturma-gruplari/tabureler-ve-puflar/suri-tabureler-ve-puflar/']},

    # --- Yeni tabure/puf aileleri ---
    # URL slug'ı 'rooutopos' ama sayfanın og:title'ı ve teknik föy dosya adı ("outoposstoolspoufs
    # .zip") ürünün GERÇEK adının "OuTopos" olduğunu gösteriyor — aile adı kaynağa uyduruldu.
    {'name': 'OuTopos', 'merge_id': None, 'category': 'Sandalye & Tabure',
     'urls': ['oturma-gruplari/tabureler-ve-puflar/rooutopos-tabureler-ve-puflar/']},
    {'name': 'Carlina', 'merge_id': None, 'category': 'Sandalye & Tabure',
     'urls': ['oturma-gruplari/tabureler-ve-puflar/carlina-tabureler-ve-puflar/']},
    {'name': 'Solis', 'merge_id': None, 'category': 'Sandalye & Tabure',
     'urls': ['oturma-gruplari/tabureler-ve-puflar/solis-tabureler-ve-puflar/']},
    {'name': 'Arcade', 'merge_id': None, 'category': 'Sandalye & Tabure',
     'urls': ['oturma-gruplari/tabureler-ve-puflar/arcade-tabureler-ve-puflar/']},
    {'name': 'Redlac', 'merge_id': None, 'category': 'Sandalye & Tabure',
     'urls': ['oturma-gruplari/tabureler-ve-puflar/redlac-tabureler-ve-puflar/']},
]

# Masa aileleri — hepsi 'Ofis Mobilyası' (operasyonel/yönetici/toplantı/seminer masaları).
DESKS = [
    # dayanak: #122 source_url .../en/products/tables/desks-benches/partita-desks-benches/ —
    # AYNI ailenin İngilizce sayfası, kayıt versiyonsuz (v=0) ve 2 görselli; bu parti üç TR
    # sayfasını (operasyonel/yönetici/toplantı) tek çatı altında getiriyor.
    {'name': 'Partita', 'merge_id': 122, 'category': 'Ofis Mobilyası', 'urls': [
        'masalar/masa-sistemleri/partita-masa-sistemleri/',
        'masalar/yonetici-masalari/partita-yonetici-masalari/',
        'masalar/toplanti-masalari/partita-toplanti-masalari/',
    ]},
    # dayanak: #120 source_url .../en/products/tables/meeting-tables/convivium-conference-tables/
    {'name': 'Convivium', 'merge_id': 120, 'category': 'Ofis Mobilyası', 'urls': [
        'masalar/yonetici-masalari/convivium-yonetici-masalari/',
        'masalar/toplanti-masalari/convivium-toplanti-masalari/',
    ]},
    {'name': 'Borges', 'merge_id': None, 'category': 'Ofis Mobilyası', 'urls': [
        'masalar/masa-sistemleri/borges-masa-sistemleri/',
        'masalar/yonetici-masalari/borges-yonetici-masalari/',
    ]},
    {'name': 'Porte', 'merge_id': None, 'category': 'Ofis Mobilyası', 'urls': [
        'masalar/masa-sistemleri/porte-masa-sistemleri/',
        'masalar/toplanti-masalari/porte-toplanti-masalari/',
    ]},
    {'name': 'Teorema', 'merge_id': None, 'category': 'Ofis Mobilyası', 'urls': [
        'masalar/yonetici-masalari/teorema-yonetici-masalari/',
        'masalar/toplanti-masalari/teorema-toplanti-masalari/',
    ]},
    {'name': 'Minipod', 'merge_id': None, 'category': 'Ofis Mobilyası',
     'urls': ['masalar/masa-sistemleri/minipod-masa-sistemleri/']},
    {'name': 'Hai', 'merge_id': None, 'category': 'Ofis Mobilyası',
     'urls': ['masalar/masa-sistemleri/hai-masa-sistemleri/']},
    {'name': 'Threshold', 'merge_id': None, 'category': 'Ofis Mobilyası',
     'urls': ['masalar/masa-sistemleri/threshold-masa-sistemleri/']},
    {'name': 'Calvino', 'merge_id': None, 'category': 'Ofis Mobilyası',
     'urls': ['masalar/masa-sistemleri/calvino-masa-sistemleri/']},
    # Gazel MASASI — products#437 "Gazel" bir KANEPEDİR, oraya birleştirilmez (dosya başı tuzak notu).
    {'name': 'Gazel Yönetici Masası', 'merge_id': None, 'category': 'Ofis Mobilyası',
     'urls': ['masalar/yonetici-masalari/gazel-yonetici-masalari/']},
    {'name': 'Quo Vadis', 'merge_id': None, 'category': 'Ofis Mobilyası',
     'urls': ['masalar/yonetici-masalari/quo-vadis-yonetici-masalari/']},
    {'name': 'Akkadian', 'merge_id': None, 'category': 'Ofis Mobilyası',
     'urls': ['masalar/yonetici-masalari/akkadian-yonetici-masalari/']},
    {'name': 'Era', 'merge_id': None, 'category': 'Ofis Mobilyası',
     'urls': ['masalar/yonetici-masalari/era-yonetici-masalari/']},
    {'name': 'Glenn', 'merge_id': None, 'category': 'Ofis Mobilyası',
     'urls': ['masalar/toplanti-masalari/glenn-toplanti-masalari/']},
    {'name': 'Swan', 'merge_id': None, 'category': 'Ofis Mobilyası',
     'urls': ['masalar/seminer-masalari/swan-seminer-masalari/']},
]

ALL_GROUPS = SEATING + DESKS
ALL_URLS = [BASE + u for g in ALL_GROUPS for u in g['urls']]

# Sayfa->aile eşlemesi (import-koleksiyon3.py sayfa bazlı overwrite'ta kullanır).
URL_TO_FAMILY = {BASE + u: g['name'] for g in ALL_GROUPS for u in g['urls']}

assert len(ALL_URLS) == 64, f'beklenen 64 sayfa, bulunan {len(ALL_URLS)}'
assert len(set(ALL_URLS)) == 64, 'mükerrer URL var'
assert len({g['name'] for g in ALL_GROUPS}) == len(ALL_GROUPS), 'mükerrer aile adı var'

if __name__ == '__main__':
    upd = sum(1 for g in ALL_GROUPS if g['merge_id'])
    print(f'{len(ALL_GROUPS)} aile ({len(ALL_GROUPS) - upd} yeni / {upd} güncelle) / {len(ALL_URLS)} URL')
    for g in ALL_GROUPS:
        tag = f"GÜNCELLE #{g['merge_id']}" if g['merge_id'] else 'YENİ'
        print(f"  {g['name'][:24]:26} {g['category'][:16]:18} sayfa={len(g['urls'])} {tag}")
