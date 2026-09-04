#!/usr/bin/env python3
"""batch67-raw.json (kazıma) + batch67_translations.py (küratörlük) -> batch67-payload.json.

67 kaynak bağlantı, 61 ANA ÜRÜNE indirgenir; her ana ürün `variants` alanında kendi versiyonlarını
taşır (bkz. migrations/0086_product_variants.sql, product-modal.js#buildVariantGroups).

Bu betiğin dört kararı
----------------------

1. **Versiyonlar İKİ EKSENDEN üretilir.** Bir ailede birden çok SAYFA varsa (Synergy masa/depolama/
   tabure, Madrigal + Madrigal Chester, Ithaca + Ithaca Light) sayfa ekseni `axis` adıyla
   ("Tip"/"Model"/"Kullanım") kurulur; her sayfanın kendi içindeki MODÜLLERİ de ikinci eksendir
   ("Modül": TIP 1, Üçlü Kanepe, 150 SOFA...). buildVariantGroups tek değerli eksenleri kendisi
   eliyor, o yüzden tek sayfalı/tek modüllü ailelerde fazladan hap-buton çıkmaz.

2. **Ana satırın `images` alanı = SAYFANIN KENDİ GALERİSİ, versiyon 0'ınki değil.** batch114'te ana
   satır birinci versiyondan kopyalanıyordu; orada her versiyonun kendi ÜRÜN FOTOĞRAFI vardı, bu
   partide yok: Koleksiyon'un modül görseli beyaz zeminde bir render, Bürotime'ınki ölçülendirilmiş
   bir TEKNİK ÇİZİM. Katalog kapağı ve OG görseli olarak markanın kendi seçtiği kapak fotoğrafı
   (og:image) doğru olandır; kuralın amacı (kapak = düzgün ürün görseli) böyle korunur.
   Versiyon görselleri ise "önce o versiyona ait olan" sırasıyla dizilir: [modül render / teknik
   çizim] + aile galerisi. Böylece kullanıcı versiyon değiştirdiğinde galeri GERÇEKTEN değişir
   (kullanıcı isteğinin 1. maddesi) ama katalogda schematik bir çizim kapak olmaz.
   `specs`/`files` için batch114 kuralı aynen geçerli: ana satır ilk versiyonunkini taşır.

3. **Dosyalar R2'ye ALINMAZ, dış bağlantı yazılır** (batch114 ile aynı gerekçe, bkz.
   [[project_r2_free_tier_guard]]): Bürotime'ın tek bir SKP arşivi 47 MB, Koleksiyon'un föyleri ise
   `pim.koleksiyon.com.tr` üzerinde dinamik üretilen PDF'ler. product-modal.js#renderFilesSection
   harici URL'leri safeUrl()+target=_blank ile zaten açıyor.

4. **Karıştırma (shuffle)**: batch114-build-payload.py#shuffle_by_brand ile AYNI algoritma ve aynı
   gerekçe — katalog `ORDER BY id DESC` olduğundan INSERT sırası ekrana TERS yansır; komşu tekrar
   sıfırlanırsa yön fark etmez. Burada en kalabalık marka 27/61 (< 31) olduğundan sıfır komşu
   tekrar garanti edilir.

Kullanım:
  python3 scripts/batch67-build-payload.py
"""

import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from batch67_translations import (BRANDS, CASA_SPEC_TR, CASA_VALUE_TR,  # noqa: E402
                                  DESCRIPTIONS, FAMILIES, UPDATE_EXISTING)

RAW = {r['source_url']: r for r in
       json.load(open(os.path.join(HERE, 'output', 'batch67-raw.json'), encoding='utf8'))}

TR_MAP = {'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'I': 'i', 'İ': 'i', 'ö': 'o',
          'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u'}

MAX_GALLERY = 8          # aile galerisinden versiyon başına taşınacak azami kare
MAX_PARENT_IMAGES = 10


def slugify(t):
    t = ''.join(TR_MAP.get(c, c) for c in (t or ''))
    return re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', t.lower()))


def casa_specs(raw):
    """Casa teknik tablosunu Türkçeye çevirir; sözlükte olmayan girdi AYNEN korunur."""
    out = []
    for s in raw.get('specs_src') or []:
        label = CASA_SPEC_TR.get(s['label'].strip().lower(), s['label'].strip().capitalize())
        value = CASA_VALUE_TR.get(s['value'].strip(), s['value'].strip())
        out.append({'label': label, 'value': value})
    return out


def common_specs(fam, raw):
    """Ürünün her versiyonunda tekrar eden künye satırları."""
    out = []
    if raw['source'] == 'burotime':
        if raw.get('product_type'):
            out.append({'label': 'Ürün Tipi', 'value': raw['product_type']})
        if raw.get('usage_areas'):
            out.append({'label': 'Kullanım Alanları', 'value': ', '.join(raw['usage_areas'])})
        if raw.get('color_groups'):
            out.append({'label': 'Renk ve Malzeme Seçenekleri', 'value': ', '.join(raw['color_groups'])})
        if raw.get('awards'):
            out.append({'label': 'Sertifikalar', 'value': ', '.join(raw['awards'])})
    if raw['source'] == 'casa' and raw.get('design_year'):
        out.append({'label': 'Tasarım Yılı', 'value': str(raw['design_year'])})
    out.append({'label': 'Marka', 'value': fam['_brand_name']})
    designer = fam.get('_designer')
    if designer:
        out.append({'label': 'Tasarımcı', 'value': designer})
    return out


def dedupe_specs(specs):
    out, seen = [], set()
    for s in specs:
        k = (s['label'], s['value'])
        if k in seen:
            continue
        seen.add(k)
        out.append(s)
    return out


def page_modules(raw):
    """Sayfanın MODÜL listesi — kaynak türüne göre farklı bloktan gelir.

    Koleksiyon: `allVariants[type=all_variants]` öğeleri (kendi render'ı + ölçüleri + föyü).
    Bürotime:   `technicalDrawings` öğeleri (etiket + ölçülendirilmiş teknik çizim).
    Casa:       modül YOK — sayfanın kendisi tek versiyondur.
    """
    if raw['source'] == 'koleksiyon':
        return [{'name': v['name'], 'image': v.get('image'), 'specs': v.get('specs') or [],
                 'files': v.get('files') or []} for v in raw.get('kol_variants') or []]
    if raw['source'] == 'burotime':
        return [{'name': t['label'], 'image': t.get('image'), 'specs': t.get('specs') or [],
                 'files': []} for t in raw.get('bur_drawings') or [] if t.get('label')]
    return []


def build_one(fam):
    pages = fam['pages']
    first_raw = RAW[pages[0]['url']]

    fam['_brand_name'] = {'koleksiyon': 'Koleksiyon', 'casa': 'Casa',
                          'burotime': 'Bürotime'}[fam['brand']]
    # Tasarımcı: kaynaktan gelir; aile içindeki sayfalar farklı tasarımcı gösterirse hepsi yazılır.
    designers = []
    for p in pages:
        d = (RAW[p['url']].get('designer') or '').strip()
        if d and d not in designers:
            designers.append(d)
    fam['_designer'] = ', '.join(designers) or None

    axis = fam.get('axis')
    module_axis = fam.get('module_axis', 'Modül')

    variants = []
    for p in pages:
        raw = RAW[p['url']]
        model = p.get('model')
        gallery = list(dict.fromkeys(raw['images']))[:MAX_GALLERY]
        base_specs = casa_specs(raw) if raw['source'] == 'casa' else []
        page_files = list(raw.get('files') or [])
        page_desc = DESCRIPTIONS[p['desc']] if p.get('desc') else None

        mods = page_modules(raw)
        if mods:
            for m in mods:
                label = f"{model} · {m['name']}" if model else m['name']
                options = ([{'label': axis, 'value': model}] if (axis and model) else [])
                options.append({'label': module_axis, 'value': m['name']})
                images = [m['image']] + gallery if m.get('image') else list(gallery)
                variants.append({
                    'label': label,
                    'options': options,
                    'srcImages': list(dict.fromkeys([i for i in images if i])),
                    'specs': dedupe_specs(m['specs'] + base_specs + common_specs(fam, raw)),
                    'files': m['files'] + page_files,
                    'description': page_desc,
                    'sourceUrl': raw['source_url'],
                })
        else:
            variants.append({
                'label': model or fam['title'],
                'options': ([{'label': axis, 'value': model}] if (axis and model) else []),
                'srcImages': list(gallery),
                'specs': dedupe_specs(base_specs + common_specs(fam, raw)),
                'files': page_files,
                'description': page_desc,
                'sourceUrl': raw['source_url'],
            })

    description = DESCRIPTIONS[fam['desc']] if fam.get('desc') else first_raw['description_src']
    head = variants[0]
    return {
        'key': fam['key'],
        'title': fam['title'],
        'brand': fam['_brand_name'],
        'brand_slug': fam['brand'],
        'brand_logo': first_raw.get('brand_logo'),
        'category': fam['cat'],
        'designer': fam['_designer'],
        'description': description,
        'source_url': first_raw['source_url'],
        # Ana satır görseli = sayfanın KENDİ galerisi (bkz. dosya başı 2. karar), spec/dosya ise
        # ilk versiyonunki (batch114 kuralı).
        'images': list(dict.fromkeys(first_raw['images']))[:MAX_PARENT_IMAGES],
        'specs': head['specs'],
        'files': head['files'],
        'variants': variants,
        'update_id': None,
    }


def build():
    by_key = {}
    items, slugs = [], set()
    for fam in FAMILIES:
        it = build_one(fam)
        base = slugify(f"{it['title']}-{it['brand']}")
        slug, n = base, 2
        while slug in slugs:
            slug, n = f'{base}-{n}', n + 1
        slugs.add(slug)
        it['slug'] = slug
        by_key[it['key']] = it
        items.append(it)

    # D1'de zaten var olan satırlar: yeni satır AÇILMAZ, mevcut id güncellenir.
    for pid, key in UPDATE_EXISTING.items():
        if key in by_key:
            by_key[key]['update_id'] = pid
    return items


def shuffle_by_brand(items):
    """batch114-build-payload.py#shuffle_by_brand ile aynı algoritma (gerekçe: dosya başı 4)."""
    queues = {}
    for it in items:
        queues.setdefault(it['brand_slug'], []).append(it)
    out, prev = [], None
    while any(queues.values()):
        avail = [s for s in queues if queues[s] and s != prev]
        if not avail:
            avail = [s for s in queues if queues[s]]
        pick = min(avail, key=lambda s: (-len(queues[s]), s))
        out.append(queues[pick].pop(0))
        prev = pick
    return out


if __name__ == '__main__':
    items = shuffle_by_brand(build())
    path = os.path.join(HERE, 'output', 'batch67-payload.json')
    json.dump({'products': items, 'brands': BRANDS}, open(path, 'w', encoding='utf8'),
              ensure_ascii=False, indent=2)

    nvar = sum(len(p['variants']) for p in items)
    nimg = len({i for p in items for v in p['variants'] for i in v['srcImages']})
    nfile = sum(len(v['files']) for p in items for v in p['variants'])
    upd = sum(1 for p in items if p['update_id'])
    print(f'{len(items)} ana ürün / {nvar} versiyon / {nimg} benzersiz görsel / {nfile} dosya '
          f'/ {len(BRANDS)} yeni marka / {upd} mevcut satır güncellenecek -> {path}\n')
    for p in items:
        flag = f" [GÜNCELLE id={p['update_id']}]" if p['update_id'] else ''
        print(f"  {p['brand'][:10]:11} {p['title'][:26]:28} {p['category'][:16]:18} "
              f"versiyon={len(p['variants']):2} görsel={len({i for v in p['variants'] for i in v['srcImages']}):2} "
              f"dosya={sum(len(v['files']) for v in p['variants']):2}{flag}")

    runs = sum(1 for a, b in zip(items, items[1:]) if a['brand_slug'] == b['brand_slug'])
    print(f'\nArt arda aynı markadan gelen komşu çift sayısı: {runs} (0 = tam karışık)')
    noimg = [p['title'] for p in items if not p['images']]
    if noimg:
        print(f'UYARI — kapak görseli olmayan ürün: {noimg}')
