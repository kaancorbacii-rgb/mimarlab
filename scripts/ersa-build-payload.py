#!/usr/bin/env python3
"""ersa-raw.json (kazıma) -> ersa-payload.json (203 URL -> ~108 ANA ÜRÜN, migrations/0086 variants
mimarisi — import-batch114.py'nin AYNI deseni, bkz. o dosyanın başlığındaki 4 karar).

Bu betiğin ek kararları (Ersa'ya özgü):

1. **Aile gruplaması = kazınan `title` (normalize edilmiş).** WooCommerce'in kendi "Varyantlar"
   carousel'i yalnızca `/urun/x/x/` iç içe URL desenini yakalıyor (impero-2/4/6 gibi AYRI post'ları
   HİÇ göstermiyor, canlıda doğrulandı) — güvenilir aile sinyali DEĞİL. Buna karşılık aynı ürünün
   farklı beden/tip sayfaları WordPress'te AYNI `title`'ı taşıyor (Polka-3/Polka-5 ikisi de "Polka"),
   bu da kullanıcının 20 aile için elle verdiği eşlemeyle BİREBİR örtüşüyor — otomatik anahtar.

2. **TITLE_MERGE**: tam title eşleşmesinin YAKALAYAMADIĞI 3 çift, kullanıcının Meliades/Meliades Tv
   örneğiyle AYNI ilkeyle (ana ürün + TV ünitesi/varyant alt tipi tek aile) elle eklendi: Polar C
   (kantilever ayaklı alt seri) -> Polar, Eclipse Tv -> Eclipse. Kullanıcının kendi listesindeki
   Meliades Tv -> Meliades zaten bu tabloda.

3. **Versiyon etiketi**: sayfada TEK "Boyutlar" satırı varsa (ör. Impero'nun "Yönetici Koltuğu"),
   o satırın kendi adı; birden fazla satır varsa slug'ın aile köküne göre FARKI (ör. "-toplanti-
   masasi" -> "Toplantı Masası") elle çevrilmiş bir sözlükten; hiçbiri yoksa (çıplak aile slug'ı,
   ör. "impero") "Standart".

4. **Baş versiyon** (ana satırın images/specs/files'ı, bkz. import-batch114.py madde 1): ailenin
   ÇIPLAK slug'ına (ör. "impero", "terra") sahip sayfa varsa o, yoksa kazıma sırasındaki ilk sayfa.

5. **Kategori**: TÜMÜ "Ofis Mobilyası" — Ersa saf bir ofis mobilyası üreticisi (bkz. offices.about),
   taksonomide (catalog-taxonomy.js) daha ince bir ofis alt kırılımı yok; bir "Terra Kanepe"yi ev
   kanepesi kategorisine ("Koltuk & Kanepe") koymak markanın bağlamını (ortak alan/bekleme mobilyası)
   yanlış temsil ederdi.

6. **Dosyalar dış bağlantı kalır** — import-archello-products.py'deki AYNI R2-bütçe gerekçesi:
   Ersa'nın PDF/ZIP'leri zaten kendi CDN'inden serbestçe iniyor, R2'ye kopyalamanın maliyeti yok.

Kullanım:
  python3 scripts/ersa-build-payload.py
"""
import json
import os
import re
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'output', 'ersa-raw.json')
OUT = os.path.join(HERE, 'output', 'ersa-payload.json')

TR_MAP = {'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'I': 'i', 'İ': 'i', 'ö': 'o',
          'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u'}


def fold_tr(s):
    return ''.join(TR_MAP.get(c, c) for c in str(s or '')).lower().strip()


def slugify(t):
    t = fold_tr(t)
    return re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', t))


BRAND = 'Ersa Mobilya'
BRAND_SLUG = 'ersa-mobilya'
CATEGORY = 'Ofis Mobilyası'

# DB'deki `title` alanı MEVCUT satırlarla AYNI kuralı izler (bkz. offices.id=769'un canlıdaki 10
# ürünü: "Impero", "Terra", "Aura" — "X Ailesi/Serisi/Koleksiyonu" DEĞİL). Kullanıcının isteğindeki
# "Andante Masa Ailesi" gibi adlar konsolidasyon KAVRAMINI anlatıyordu, literal ürün adı değil;
# gerçek title HER ZAMAN baş versiyonun kazınan title'ı (aşağıda head seçiminden SONRA atanır).
# Tek istisna: "Polar" ailesinde çıplak "/urun/polar/" sayfası YOK (yalnızca "Polar C" alt serisi +
# polar-3/5 var), o yüzden baş versiyon rastgele "Polar C" başlığını taşıyabilir — kullanıcının
# "Polar Koltuk Koleksiyonu" ifadesindeki asıl adı (Polar) elle düzeltiyoruz.
TITLE_OVERRIDE = {
    'polar': 'Polar',
}

# Tam title eşleşmesinin yakalamadığı ek birleşmeler (bkz. dosya başı madde 2).
TITLE_MERGE = {
    'polar c': 'polar',
    'meliades tv': 'meliades',
    'eclipse tv': 'eclipse',
}

# Slug'ın aile kökünden FARKINI okunur bir versiyon etiketine çeviren sözlük — büyükten küçüğe
# denenir (ör. "ziyaretci-bekleme-sandalyeleri" "sandalyeleri"nden ÖNCE eşleşmeli).
SUFFIX_LABELS = [
    ('toplanti-masasi', 'Toplantı Masası'),
    ('toplanti-sandalyeleri', 'Toplantı Sandalyesi'),
    ('ziyaretci-bekleme-sandalyeleri', 'Ziyaretçi & Bekleme Sandalyesi'),
    ('operasyonel-koltuk', 'Operasyonel Koltuk'),
    ('yonetici-koltugu', 'Yönetici Koltuğu'),
    ('yonetici', 'Yönetici'),
    ('toplanti', 'Toplantı'),
    ('konsol', 'Konsol'),
    ('kanepe', 'Kanepe'),
    ('sehpa', 'Sehpa'),
    ('puf', 'Puf'),
    ('tv', 'TV Ünitesi'),
    ('4lu-boru-ayakli', "4'lü Boru Ayaklı"),
    ('4-yildiz-duz-ayak', '4 Yıldız Düz Ayak'),
    ('4-yildiz-ayak', '4 Yıldız Ayak'),
    ('c-2', 'Tip 2'),
]


def variant_label(family_base, slug, dims):
    # Kaynağın KENDİ "Boyutlar" satır adı, sayfa çok satırlı olsa BİLE, suffix sözlüğünden daha
    # güvenilir/betimleyici — çok satırlı sayfalarda satırlar genelde AYNI fiziksel varyantın
    # farklı ebat/tip alt seçenekleri, ilk satırın adı sayfayı temsil etmeye yeter.
    if dims:
        return dims[0]['label']
    rest = slug
    if rest == family_base:
        return 'Standart'
    for pat, label in SUFFIX_LABELS:
        if pat in rest:
            return label
    m = re.search(r'-(\d+)$', rest)
    if m:
        return f'Tip {m.group(1)}'
    return rest.replace('-', ' ').strip().title() or 'Standart'


def dims_value_set(dims):
    """Tüm satırların (ad, değer) çiftlerinin KÜMESİ — etiket/önek metninden bağımsız, saf içerik
    karşılaştırması için (bkz. dosya başı madde: WooCommerce'in aynı ürünü /x/ ve /x/x/ altında
    İKİ KEZ yayınladığı durumlar, ör. Rhea/Hemera/Terra — ikinci sayfa BİREBİR aynı ölçüleri taşır)."""
    return frozenset((v['name'], v['value']) for row in dims for v in row['values'])


def flatten_specs(dims):
    specs = []
    multi = len(dims) > 1
    for row in dims:
        prefix = f"{row['label']} — " if multi else ''
        for v in row['values']:
            specs.append({'label': f"{prefix}{v['name']}", 'value': v['value']})
    return specs


def full_path_key(url):
    """Aile-içi tekillik için TAM yol (yalnızca son segment DEĞİL) — impero/impero ile impero-2
    aynı 'impero' son segmentine sahip değil ama impero/impero'nun kendi son segmenti de 'impero'
    olduğundan (ana sayfayla ÇAKIŞIR), tam yol gerekir."""
    path = urllib.parse.urlsplit(url).path.strip('/')
    return path


def main():
    raw = json.load(open(RAW, encoding='utf8'))

    groups = {}  # family_key -> list of raw records
    for r in raw:
        norm = r['title'].strip().lower()
        family_key = slugify(TITLE_MERGE.get(norm, norm))
        groups.setdefault(family_key, []).append(r)

    products = []
    total_variants = 0
    for family_key, recs in groups.items():
        product_slug = family_key

        # Baş versiyon: ailenin çıplak slug'ına sahip sayfa (ör. "impero"), yoksa ilk kazınan.
        head_idx = 0
        for i, r in enumerate(recs):
            if r['slug'] == family_key or full_path_key(r['source_url']) == family_key:
                head_idx = i
                break
        recs = [recs[head_idx]] + recs[:head_idx] + recs[head_idx + 1:]
        family_title = TITLE_OVERRIDE.get(family_key) or recs[0]['title'].strip()

        variants = []
        kept_value_sets = []
        designer = ''
        description = ''
        for r in recs:
            vset = dims_value_set(r['dims'])
            # Aynı fiziksel varyantın WooCommerce'te İKİ AYRI URL altında (bkz. dosya başı) BİREBİR
            # AYNI ölçü tablosuyla yayınlandığı durumlar (Rhea, Hemera, Terra/terra, Caligo-3) —
            # TAM eşitlik arandı, ALT KÜME değil: Aura'nın "aura-puf" sayfası, bare "aura" sayfasının
            # özet tablosundaki BİR satırın (Puf) alt kümesi olduğu için subset kontrolü onu YANLIŞ
            # biçimde mükerrer sayardı — oysa kullanıcının isteği aura-puf'u AYRI bir versiyon olarak
            # istiyor (bkz. dosya başı FAMILY_DISPLAY_NAMES üstündeki kullanıcı listesi).
            if vset and any(vset == kept for kept in kept_value_sets):
                continue
            label = variant_label(family_key, r['slug'], r['dims'])
            variants.append({
                'label': label,
                # BOŞ DİZİ, boş NESNE değil — src/lib/seo.js#variantGroups `(v.options || []).forEach`
                # çağırıyor; `{}` JS'te TRUTHY olduğundan fallback devreye girmez ve `{}.forEach`
                # 2+ versiyonlu HER ürünün SSR sayfasını 503 ile çökertir (2026-09-05 canlı olayı,
                # bkz. scripts/ersa-fix-options-shape.py).
                'options': [],
                'srcImages': r['images'],
                'specs': flatten_specs(r['dims']),
                'files': [{'url': f['url'], 'filename': f['label'] or f['url'].rsplit('/', 1)[-1],
                           'format': f['url'].rsplit('.', 1)[-1].lower()} for f in r['files']],
                'sourceUrl': r['source_url'],
            })
            kept_value_sets.append(vset)
            if not designer and r['designer']:
                designer = r['designer']
            if not description and r['description']:
                description = r['description']
        total_variants += len(variants)

        products.append({
            'slug': product_slug,
            'title': family_title,
            'brand': BRAND,
            'brand_slug': BRAND_SLUG,
            'category': CATEGORY,
            'description': description,
            'designer': designer,
            'source_url': variants[0]['sourceUrl'],
            'variants': variants,
        })
        print(f"  {family_title[:44]:46} versiyon={len(variants):2}  "
              f"{'[TEK]' if len(variants) == 1 else ''}")

    payload = {'brands': {}, 'products': products}
    json.dump(payload, open(OUT, 'w', encoding='utf8'), ensure_ascii=False, indent=2)
    print(f"\n{len(raw)} kaynak URL -> {len(products)} ana ürün / {total_variants} versiyon")
    print(f'Çıktı: {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
