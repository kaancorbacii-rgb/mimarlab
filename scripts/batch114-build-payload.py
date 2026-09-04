#!/usr/bin/env python3
"""batch114-raw.json (kazıma) + batch114_translations.py (küratörlük) -> batch114-payload.json.

114 kaynak bağlantı, 64 ANA ÜRÜNE indirgenir; her ana ürün `variants` alanında kendi
versiyonlarını taşır (bkz. migrations/0086_product_variants.sql).

Bu betiğin dört kararı:

1. **Ana ürünün görseli/spec'i/dosyası = İLK VERSİYONUNKİ.** Popup açıldığında zaten ilk versiyon
   seçili geliyor (product-modal.js#renderItem, currentVariantIndex = 0), yani ana ürünün alanları
   ile ekranda ilk görünen içerik BİREBİR aynı olur. Ayrıca katalog kartının kapak görseli
   (`images[0]`) ve OG görseli de bu alandan okunuyor — tüm versiyonların görsellerini ana ürüne
   yığmak kartın kapağını rastgele bir versiyona kaydırabilirdi.

2. **Ölçüler kaynak metinden PROGRAMATİK ayrıştırılır, elle kopyalanmaz** — Archello (SNOC)
   satırlarında açıklamanın DIMENSIONS bloğundan, Normod'da Shopify açıklamasındaki ölçü
   tablosundan. Emperyal sütun BİLEREK atılır (kaynakta hatalı, bkz.
   archello-products-build-payload.py#parse_dimensions'taki AYNI gerekçe).

3. **Dosya filtresi**: Archello'nun "Download Catalogs" kutusu ürüne özel PDF'lerle MARKA GENELİ
   katalogları aynı listede veriyor (TON'un Delta sehpasında 12 dosyanın 12'si başka
   koleksiyonların kataloğu). Ürün/aile adıyla eşleşmeyen broşürler ATILIR — hiç eşleşme yoksa
   dosya listesi boş kalır, çünkü yanlış katalog hiç katalog olmamasından kötüdür.
   BIM/CAD girdileri her zaman korunur (onlar ürünün kendi bloğundan geliyor).

4. **Karıştırma (shuffle)**: katalog ve anasayfa varsayılan sıralaması `ORDER BY id DESC` olduğundan
   (bkz. src/routes/product.js) INSERT sırası = katalog sırası. Aileler markalar arasında dönüşümlü
   (round robin) diziler; böylece hiçbir noktada aynı markadan iki ürün peş peşe gelmez. Sorgu
   tarafında rastgelelik YOK: RANDOM() ile sıralamak sayfalamayı ve KV önbelleğini tutarsızlaştırırdı.
   Deterministik olması da bilinçli — aynı payload iki kez üretilince aynı sıra çıkar.

Kullanım:
  python3 scripts/batch114-build-payload.py
"""

import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from batch114_translations import BRANDS, DESCRIPTIONS, FAMILIES  # noqa: E402
from archello_products_translations import DIM_LABELS  # noqa: E402

RAW = {r['source_url']: r for r in
       json.load(open(os.path.join(HERE, 'output', 'batch114-raw.json'), encoding='utf8'))}

TR_MAP = {'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'I': 'i', 'İ': 'i', 'ö': 'o',
          'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u',
          'ř': 'r', 'č': 'c', 'ě': 'e', 'ž': 'z', 'š': 's', 'ý': 'y', 'á': 'a', 'é': 'e', 'í': 'i'}

# Markanın kayıtlı adı (offices.name) — RAW'daki Archello görünen adı her zaman doğru değil
# (ör. Archello "Ton Design" diyor, markanın kendi adı TON). BRANDS'te tanımlıysa oradaki ad,
# değilse RAW'daki ad kullanılır (Nurus/Normod/SNOC/Flexform zaten sitede kayıtlı).
BRAND_NAME_BY_SLUG = {slug: b['name'] for slug, b in BRANDS.items()}


def slugify(t):
    t = ''.join(TR_MAP.get(c, c) for c in (t or ''))
    return re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', t.lower()))


def num_tr(v):
    return v.replace('.', ',')


def parse_dimensions_en(desc_en):
    """Archello (SNOC) açıklamasındaki DIMENSIONS bloğu -> Türkçe ölçü satırları."""
    m = re.search(r'\bDIMENSIONS\b(.*)', desc_en or '', re.S)
    if not m:
        return []
    labels = '|'.join(sorted(DIM_LABELS, key=len, reverse=True))
    out, seen = [], set()
    for dm in re.finditer(r'(?i)\b(' + labels + r')\s*:\s*([\d.,]+)\s*(cm|mm|kg)\b', m.group(1)):
        label_en, value, unit = dm.group(1).lower(), dm.group(2), dm.group(3)
        if label_en in seen:
            continue
        seen.add(label_en)
        out.append({'label': DIM_LABELS[label_en], 'value': f'{num_tr(value)} {unit}'})
    return out


def parse_codes_en(desc_en):
    m = re.search(r'\bPRODUCT CODE\b(.*?)(?:\bPRODUCT DETAILS\b|\bDIMENSIONS\b|$)', desc_en or '', re.S)
    if not m:
        return []
    colors = []
    for cm in re.finditer(r'[A-Z]{2,4}-[A-Z0-9\-]+\s*[-–]\s*([A-Za-z][A-Za-z ]{1,20})', m.group(1)):
        c = cm.group(1).strip()
        if c not in colors:
            colors.append(c)
    return colors


def pick_files(raw, family_title, variant_label):
    """Ürüne AİT dosyalar — marka geneli kataloglar elenir (bkz. dosya başı 3. karar)."""
    toks = {t.lower() for t in re.split(r'[\s·×/-]+', f'{family_title} {variant_label}') if len(t) > 2}
    toks |= {''.join(TR_MAP.get(c, c) for c in t).lower() for t in toks}
    out, seen = [], set()
    for f in raw.get('files') or []:
        if not f.get('url'):
            continue
        if f.get('kind') in ('bim_cad', 'cad'):
            if f['url'] in seen:
                continue
            seen.add(f['url'])
            out.append(f)
            continue
        name = (f.get('filename') or '').lower()
        if not name or name in seen:
            continue
        if any(t in name for t in toks):
            seen.add(name)
            out.append(f)
    return [{'url': f['url'], 'filename': f.get('filename'), 'format': f.get('format') or '',
             'size': f.get('size')} for f in out]


def variant_specs(raw, fam, variant):
    """Versiyonun teknik özellik tablosu — kaynak türüne göre farklı yerlerden toplanır."""
    specs = []
    src = raw['source']

    # Ölçüler önce: teknik föyün en çok aranan satırı bu.
    if src == 'archello':
        specs += parse_dimensions_en(raw['description_src'])
        colors = parse_codes_en(raw['description_src'])
        if colors:
            specs.append({'label': 'Renk Seçenekleri', 'value': ', '.join(colors)})
        made = next((s['value'] for s in raw['specs_src'] if s['label'] == 'Manufactured'), None)
        if made:
            made_tr = {'Czech Republic': 'Çekya', 'Italy': 'İtalya', 'Portugal': 'Portekiz',
                       'United States': 'Amerika Birleşik Devletleri'}.get(made, made)
            specs.append({'label': 'Üretim Yeri', 'value': made_tr})
        mat = next((s['value'] for s in raw['specs_src'] if s['label'] == 'Material'), None)
        if mat:
            specs.append({'label': 'Malzeme',
                          'value': {'Wood': 'Ahşap', 'Metal': 'Metal', 'Plastic': 'Plastik'}.get(mat, mat)})
    elif src == 'normod':
        specs += raw['specs_src']            # Shopify ölçü tablosu + kumaş/ayak seçenekleri
    elif src == 'nurus':
        for line in raw.get('materials_src') or []:
            specs.append({'label': 'Malzeme / Donanım', 'value': line})

    # Versiyonun kendi seçenek ekseni de bir teknik özelliktir (ör. "Sırt Yüksekliği: Orta Sırt") —
    # seçici zaten üstte duruyor ama tablo tek başına okunduğunda da anlamlı kalmalı.
    for label, value in variant.get('options') or []:
        specs.insert(0, {'label': label, 'value': value})

    specs.append({'label': 'Marka', 'value': fam['_brand_name']})
    if fam.get('designer'):
        specs.append({'label': 'Tasarımcı', 'value': fam['designer']})

    # Aynı etiketin tekrarı (ör. Nurus'ta çok satırlı "Malzeme / Donanım") KORUNUR; yalnızca
    # birebir aynı (etiket, değer) çifti tekrarlanırsa elenir.
    out, seen = [], set()
    for s in specs:
        k = (s['label'], s['value'])
        if k in seen:
            continue
        seen.add(k)
        out.append(s)
    return out


MAX_IMAGES_PER_VARIANT = 10


def build():
    families, slugs = [], set()
    for fam in FAMILIES:
        brand_slug = fam['brand']
        first_raw = RAW[fam['variants'][0]['url']]
        fam['_brand_name'] = BRAND_NAME_BY_SLUG.get(brand_slug) or first_raw['brand_name']
        description = DESCRIPTIONS[fam['desc']] if fam.get('desc') else fam['desc_tr']

        variants = []
        for v in fam['variants']:
            raw = RAW[v['url']]
            variants.append({
                'label': v['label'],
                'options': [{'label': a, 'value': b} for a, b in (v.get('options') or [])],
                'srcImages': raw['images'][:MAX_IMAGES_PER_VARIANT],
                'specs': variant_specs(raw, fam, v),
                'files': pick_files(raw, fam['title'], v['label']),
                'sourceUrl': raw['source_url'],
            })

        base = slugify(f"{fam['title']}-{fam['_brand_name']}")
        slug, n = base, 2
        while slug in slugs:
            slug, n = f'{base}-{n}', n + 1
        slugs.add(slug)

        families.append({
            'key': fam['key'],
            'slug': slug,
            'title': fam['title'],
            'brand': fam['_brand_name'],
            'brand_slug': brand_slug,
            'brand_logo': first_raw.get('brand_logo'),
            'category': fam['cat'],
            'designer': fam.get('designer'),
            'description': description,
            'source_url': first_raw['source_url'],
            'variants': variants,
        })
    return families


def shuffle_by_brand(items):
    """Markalar arasında dönüşümlü diziliş (bkz. dosya başı 4. karar).

    Algoritma: her adımda KALAN ÜRÜNÜ EN ÇOK olan markadan bir ürün alınır, ama bir önceki adımda
    seçilen marka ASLA arka arkaya ikinci kez seçilmez (o marka tek kalmışsa mecburen seçilir).
    Bu, "en kalabalık olanı önce tüket" ilkesi sayesinde hiçbir markanın listenin sonunda blok
    hâlinde birikmemesini garanti eder; 64 üründe en kalabalık marka 20 ürünle sınırlı olduğundan
    (20 <= 32) sonuç HİÇ komşu tekrar içermez.

    Komşu tekrarın SIFIR olması sadece estetik değil, ZORUNLU: katalog varsayılanı `ORDER BY
    id DESC`, yani INSERT sırasının TERSİ ekrana çıkıyor. İlk sürüm "her turda tüm kuyruklardan
    birer tane" alıyordu ve kalan tek markanın ürünleri listenin SONUNDA kümeleniyordu — ters
    çevrilince tam da katalogun ve anasayfa carousel'inin EN ÜSTÜNDE beş Nurus ürünü peş peşe
    çıkıyordu (yerel doğrulamada görüldü). Komşu tekrar sıfırsa liste her iki yönde de karışıktır.
    """
    queues = {}
    for it in items:
        queues.setdefault(it['brand_slug'], []).append(it)
    out, prev = [], None
    while any(queues.values()):
        avail = [s for s in queues if queues[s] and s != prev]
        if not avail:                       # yalnızca önceki marka kaldı — mecburen o
            avail = [s for s in queues if queues[s]]
        pick = min(avail, key=lambda s: (-len(queues[s]), s))
        out.append(queues[pick].pop(0))
        prev = pick
    return out


if __name__ == '__main__':
    items = shuffle_by_brand(build())
    path = os.path.join(HERE, 'output', 'batch114-payload.json')
    json.dump({'products': items, 'brands': BRANDS}, open(path, 'w', encoding='utf8'),
              ensure_ascii=False, indent=2)

    nvar = sum(len(p['variants']) for p in items)
    nimg = sum(len(v['srcImages']) for p in items for v in p['variants'])
    nfile = sum(len(v['files']) for p in items for v in p['variants'])
    print(f'{len(items)} ana ürün / {nvar} versiyon / {nimg} görsel / {nfile} dosya '
          f'/ {len(BRANDS)} yeni marka adayı -> {path}\n')
    for p in items:
        print(f"  {p['brand'][:11]:12} {p['title'][:40]:42} {p['category'][:16]:18} "
              f"versiyon={len(p['variants']):2} görsel={sum(len(v['srcImages']) for v in p['variants']):3} "
              f"dosya={sum(len(v['files']) for v in p['variants']):2}")
    # Karıştırmanın gerçekten işe yaradığını göster: peş peşe aynı markadan kaç ürün var?
    runs = sum(1 for a, b in zip(items, items[1:]) if a['brand_slug'] == b['brand_slug'])
    print(f'\nArt arda aynı markadan gelen komşu çift sayısı: {runs} (0 = tam karışık)')
