#!/usr/bin/env python3
"""raw2.json (kazıma) + tr.py (çeviri) -> payload.json (D1'e yazılmaya hazır 27 ürün)."""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from archello_products_translations import DESCRIPTIONS, MATERIALS, PRODUCTS, DIM_LABELS, BRANDS  # noqa: E402

RAW = json.load(open(os.path.join(HERE, 'output', 'archello-products-raw.json'), encoding='utf8'))

TR_MAP = {'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'I': 'i', 'İ': 'i', 'ö': 'o',
          'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u'}


def slugify(t):
    t = ''.join(TR_MAP.get(c, c) for c in (t or ''))
    return re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', t.lower()))


def num_tr(v):
    """'82.5' / '82,5' -> '82,5' (Türkçe ondalık ayırıcı virgül)."""
    return v.replace('.', ',')


def parse_dimensions(desc_en):
    """İngilizce açıklamanın DIMENSIONS bloğundan ölçüleri çıkarır.

    Kaynak iki biçimde yazıyor: satır başına bir ölçü, ya da hepsi TEK satırda bitişik
    ('Height: 63 cm | 248”Width: 195 cm...'). Tek regex ikisini de yakalar çünkü etikete kadar
    olan kısmı tüketip bir sonraki etikette duruyor. Emperyal kısım ('| 248”') BİLEREK atılır —
    kaynakta birden çok satırda hatalı ve kullanıcı metrik istedi.
    """
    m = re.search(r'\bDIMENSIONS\b(.*)', desc_en, re.S)
    if not m:
        return []
    block = m.group(1)
    labels = '|'.join(sorted(DIM_LABELS, key=len, reverse=True))
    out, seen = [], set()
    for dm in re.finditer(r'(?i)\b(' + labels + r')\s*:\s*([\d.,]+)\s*(cm|mm|kg)\b', block):
        label_en, value, unit = dm.group(1).lower(), dm.group(2), dm.group(3)
        if label_en in seen:
            continue
        seen.add(label_en)
        out.append({'label': DIM_LABELS[label_en], 'value': f'{num_tr(value)} {unit}'})
    return out


def parse_codes(desc_en):
    """PRODUCT CODE bloğundan '<KOD> - <Renk>' satırlarını çıkarır."""
    m = re.search(r'\bPRODUCT CODE\b(.*?)(?:\bPRODUCT DETAILS\b|\bDIMENSIONS\b|$)', desc_en, re.S)
    if not m:
        return [], []
    codes, colors = [], []
    for cm in re.finditer(r'([A-Z]{2,4}-[A-Z0-9\-]+)\s*[-–]\s*([A-Za-z][A-Za-z ]{1,20})', m.group(1)):
        code, color = cm.group(1).strip(), cm.group(2).strip()
        if code not in [c[0] for c in codes]:
            codes.append((code, color))
        if color not in colors:
            colors.append(color)
    return codes, colors


def collection_tokens(tr_title):
    """Ürün adının ilk kelimesi = koleksiyon adı; dosya filtrelemede kullanılır."""
    return [w for w in re.split(r'[\s-]+', tr_title) if len(w) > 2][:2]


def pick_files(raw, tr_title, outdoor):
    """Markanın TÜM kataloglarını değil, bu ÜRÜNE ait dosyaları seçer.

    Archello'nun "Download Catalogs" kutusu ürüne özel PDF'lerle marka geneli katalogları AYNI
    listede veriyor: Tara Dining Tables'ta 12 dosyanın 11'i 'Flexform Camelot', 'Flexform Perry'
    gibi ALAKASIZ koleksiyon kataloğu. Ürün/koleksiyon adıyla eşleşenler önce alınır; hiç eşleşme
    yoksa marka kataloglarından en alakalı 2 tanesi korunur — "en alakalı", ürün dış mekân ise
    'outdoor' geçen katalog demek (Soleva şezlong için 'Outdoor' kataloğu doğru, alfabetik/pozisyon
    sırasının verdiği 'Sleeping'/'Sofas' değil).
    """
    toks = [t.lower() for t in collection_tokens(tr_title)]
    matched, generic = [], []
    seen_names = set()
    for f in raw['files']:
        if f['kind'] == 'bim_cad':
            matched.append(f)
            continue
        name = (f.get('filename') or '').lower()
        if name in seen_names:      # Archello aynı broşürü iki ayrı position'da tekrarlayabiliyor
            continue
        seen_names.add(name)
        (matched if any(t in name for t in toks) else generic).append(f)

    if not any(f['kind'] == 'brochure' for f in matched):
        want = 'outdoor' if outdoor else 'indoor'
        def rank(f):
            n = (f.get('filename') or '').lower()
            return (0 if want in n else 1,
                    0 if re.search(r'catalog|news|collection', n) else 1)
        matched += sorted(generic, key=rank)[:2]
    return matched


def build():
    out, slugs = [], set()
    for spec in PRODUCTS:
        raw = RAW[spec['i']]
        title = spec['title']
        brand = raw['brand_name']
        desc_en = raw['description_en']

        specs = [{'label': 'Marka', 'value': brand}]
        if spec['designer']:
            specs.append({'label': 'Tasarımcı', 'value': spec['designer']})
        if spec['mat']:
            specs.append({'label': 'Malzeme', 'value': MATERIALS[spec['mat']]})
        specs.append({'label': 'Kullanım Alanı', 'value': 'Dış Mekan' if spec['outdoor'] else 'İç Mekan'})

        codes, colors = parse_codes(desc_en)
        if colors:
            specs.append({'label': 'Renk Seçenekleri', 'value': ', '.join(colors)})
        specs += parse_dimensions(desc_en)
        if codes:
            specs.append({'label': 'Ürün Kodu', 'value': ' · '.join(f'{c} ({k})' for c, k in codes)})
        made = next((s['value'] for s in raw['specs_en'] if s['label'] == 'Manufactured'), None)
        if made:
            specs.append({'label': 'Üretim Yeri', 'value': {'United States': 'Amerika Birleşik Devletleri'}.get(made, made)})

        base = slugify(f'{title}-{brand}')
        slug, n = base, 2
        while slug in slugs:
            slug, n = f'{base}-{n}', n + 1
        slugs.add(slug)

        out.append({
            'slug': slug,
            'title': title,
            'brand': brand,
            'brand_slug': raw['brand_slug'],
            'brand_logo': raw['brand_logo'],
            'group': spec['group'],
            'category': spec['cat'],
            'description': DESCRIPTIONS[spec['desc']],
            'designer': spec['designer'],
            'specs': specs,
            'images': raw['images'],
            'files': pick_files(raw, title, spec['outdoor']),
            'source_url': raw['source_url'],
            'archello_id': raw['product_id'],
        })
    return out


if __name__ == '__main__':
    items = build()
    json.dump({'products': items, 'brands': BRANDS},
              open(os.path.join(HERE, 'output', 'archello-products-payload.json'), 'w', encoding='utf8'),
              ensure_ascii=False, indent=2)
    print(f'{len(items)} ürün, {len(BRANDS)} yeni marka -> payload.json\n')
    for p in items:
        dims = [s['label'] for s in p['specs'] if s['label'] in DIM_LABELS.values()]
        print(f"  {p['slug'][:52]:54} {p['category'][:18]:20} görsel={len(p['images']):2} "
              f"dosya={len(p['files'])} spec={len(p['specs']):2} ölçü={len(dims)}")
