#!/usr/bin/env python3
"""Koleksiyon 63-URL partisi (2026-09-05) için grup tanımları — tek kaynak burasıdır.

scrape-koleksiyon2.py VE koleksiyon2-build-payload.py bu modülü import eder; URL listesi ile
"hangi sayfalar hangi ürün ailesine düşüyor" eşlemesi burada elle kodlanmıştır (kullanıcı
isteğindeki gruplandırmanın birebir transkripsiyonu — bkz. görev metni).

Her grup bir dict:
  {'name': <aile adı>, 'urls': [<path>, ...], 'merge_title': <D1'de aranacak title veya None>}

`merge_title` doluysa build-payload D1'de o başlıkla (brand_office_id=717) satır arayıp
bulursa MEVCUT satırı günceller (variants APPEND); bulamazsa YENİ bağımsız ürün açar (görev
talimatı: "sahte birleştirme yapma").
"""

BASE = 'https://www.koleksiyondesign.com/tr/urunler/'

# 1) Kanepe/koltuk aileleri — büyük ihtimalle D1'de zaten var (önceki "Koleksiyon kanepe" partisi).
SOFA_MERGE_CANDIDATES = [
    {'name': 'Capella', 'urls': ['oturma-gruplari/koltuklar/capella-koltuklar/'], 'merge_title': 'Capella'},
    {'name': 'Serdivan', 'urls': ['oturma-gruplari/koltuklar/serdivan-koltuklar/'], 'merge_title': 'Serdivan'},
    {'name': 'İkaros', 'urls': ['oturma-gruplari/koltuklar/ikaros-koltuklar/'], 'merge_title': 'Ikaros'},
    {'name': 'Madrigal', 'urls': ['oturma-gruplari/koltuklar/madrigal-koltuklar/'], 'merge_title': 'Madrigal'},
    {'name': 'Madrigal Chester', 'urls': ['oturma-gruplari/koltuklar/madrigal-chester-koltuklar/'], 'merge_title': 'Madrigal Chester'},
    {'name': 'Duende', 'urls': ['oturma-gruplari/koltuklar/duende-koltuklar/'], 'merge_title': 'Duende'},
    {'name': 'Serhas', 'urls': ['oturma-gruplari/koltuklar/serhas-koltuklar/'], 'merge_title': 'Serhas'},
    {'name': 'Poema', 'urls': ['oturma-gruplari/koltuklar/poema-koltuklar/'], 'merge_title': 'Poema'},
    {'name': 'Tellasmar', 'urls': ['oturma-gruplari/koltuklar/tellasmar-koltuklar/'], 'merge_title': 'Tellasmar'},
    {'name': 'Vienna', 'urls': ['oturma-gruplari/koltuklar/vienna-koltuklar/'], 'merge_title': 'Vienna'},
    {'name': 'Line', 'urls': ['oturma-gruplari/koltuklar/line-koltuklar/'], 'merge_title': 'Line'},
    {'name': 'Obelix', 'urls': ['oturma-gruplari/koltuklar/obelix-koltuklar/'], 'merge_title': 'Obelix'},
    {'name': 'Halia', 'urls': ['oturma-gruplari/koltuklar/halia-koltuklar/'], 'merge_title': 'Halia'},
    {'name': 'Botero', 'urls': ['oturma-gruplari/koltuklar/botero-koltuklar/'], 'merge_title': 'Botero'},
]

# 2) Sandalye/çalışma-sandalyesi/tabure aileleri — konsolide (birden çok URL -> tek aile).
#    Halia burada YİNE görünür (yukarıdaki koltuk sayfasıyla AYNI aileye eklenir).
CHAIR_CONSOLIDATE = [
    {'name': 'Halia', 'urls': [
        'oturma-gruplari/sandalyeler/halia-sandalyeler/',
        'oturma-gruplari/calisma-sandalyeleri/halia-calisma-sandalyeleri/',
    ], 'merge_title': 'Halia'},
    {'name': 'Helen', 'urls': [
        'dis-mekan/tabureler-ve-puflar/helen-tabureler-ve-puflar/',
        'oturma-gruplari/sandalyeler/helen-sandalyeler/',
    ], 'merge_title': None},
    {'name': 'Sava', 'urls': [
        'oturma-gruplari/sandalyeler/sava-sandalyeler/',
        'oturma-gruplari/calisma-sandalyeleri/sava-calisma-sandalyeleri/',
    ], 'merge_title': None},
    {'name': 'Dastan', 'urls': [
        'oturma-gruplari/sandalyeler/dastan-sandalyeler/',
        'oturma-gruplari/calisma-sandalyeleri/dastan-calisma-sandalyeleri/',
    ], 'merge_title': None},
    {'name': 'Merlin', 'urls': [
        'oturma-gruplari/sandalyeler/merlin-sandalyeler/',
        'oturma-gruplari/calisma-sandalyeleri/merlin-calisma-sandalyeleri/',
    ], 'merge_title': None},
    {'name': 'Miranda', 'urls': [
        'oturma-gruplari/sandalyeler/miranda-sandalyeler/',
        'oturma-gruplari/calisma-sandalyeleri/miranda-calisma-sandalyeleri/',
    ], 'merge_title': None},
    {'name': 'Zenith', 'urls': [
        'dis-mekan/tabureler-ve-puflar/zenith-tabureler-ve-puflar/',
        'oturma-gruplari/calisma-sandalyeleri/zenith-calisma-sandalyeleri/',
    ], 'merge_title': None},
    {'name': 'Asanda', 'urls': [
        'oturma-gruplari/sandalyeler/asanda-sandalyeler/',
        'oturma-gruplari/seminer-sandalyeleri/asanda-seminer-sandalyeleri/',
    ], 'merge_title': None},
    {'name': 'Cantata', 'urls': [
        'oturma-gruplari/sandalyeler/cantata-sandalyeler/',
        'oturma-gruplari/seminer-sandalyeleri/cantata-seminer-sandalyeleri/',
    ], 'merge_title': None},
]

# 3) Bağımsız yeni aileler — her biri TEK sayfa, TEK ürün (sayfa içi seçenekler varsa build-payload
#    kendi varyant eksenini üretir).
INDEPENDENT_KOLTUK = ['Laluna', 'Kardinal', 'Yulia', 'Monte Cristo', 'Homer', 'Sole', 'Tome',
                       'Oxalis', 'Samba', 'Norma', 'Alcove', 'Boomerang', 'Nabucco', 'Milos']
INDEPENDENT_SANDALYE = ['Satie', 'Pera', 'Papillon', 'Simplissimo', 'Tristan', 'Demre']
INDEPENDENT_CALISMA = ['Tone', 'Kind', 'Allegro', 'Axis', 'Mono', 'Clarus', 'Alpsee', 'Anitta',
                        'Tola', 'Anatole']
INDEPENDENT_SEMINER = ['Oxymore']


def _slugify_name(name):
    return name.lower().replace('ı', 'i').replace('ğ', 'g').replace('ü', 'u').replace('ş', 's') \
        .replace('ö', 'o').replace('ç', 'c').replace(' ', '-')


INDEPENDENT = (
    [{'name': n, 'urls': [f'oturma-gruplari/koltuklar/{_slugify_name(n)}-koltuklar/'], 'merge_title': None}
     for n in INDEPENDENT_KOLTUK]
    + [{'name': n, 'urls': [f'oturma-gruplari/sandalyeler/{_slugify_name(n)}-sandalyeler/'], 'merge_title': None}
       for n in INDEPENDENT_SANDALYE]
    + [{'name': n, 'urls': [f'oturma-gruplari/calisma-sandalyeleri/{_slugify_name(n)}-calisma-sandalyeleri/'],
        'merge_title': None} for n in INDEPENDENT_CALISMA]
    + [{'name': n, 'urls': [f'oturma-gruplari/seminer-sandalyeleri/{_slugify_name(n)}-seminer-sandalyeleri/'],
        'merge_title': None} for n in INDEPENDENT_SEMINER]
)

ALL_GROUPS = SOFA_MERGE_CANDIDATES + CHAIR_CONSOLIDATE + INDEPENDENT

# Halia görünür İKİ KEZ (koltuk grubunda + sandalye-konsolide grubunda) — kasıtlı, aynı aileye
# ekleniyor. Diğer tüm aileler tekil.
ALL_URLS = []
for g in ALL_GROUPS:
    for u in g['urls']:
        ALL_URLS.append(BASE + u)

if __name__ == '__main__':
    print(f'{len(ALL_GROUPS)} aile / {len(ALL_URLS)} URL')
    npages = sum(len(g['urls']) for g in ALL_GROUPS)
    assert npages == 63, f'beklenen 63 sayfa, bulunan {npages}'
