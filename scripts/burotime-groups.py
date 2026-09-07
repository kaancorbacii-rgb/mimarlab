#!/usr/bin/env python3
"""Bürotime 183 sayfasının AİLE (ana ürün) tanımları — burotime-build-payload.py'nin girdisi.

Aile birleştirmesi ÜÇ KAYNAKTAN gelir; sonrakiler öncekini ezer:

1. **Kaynağın kendi aile tanımı** (`familyTitle` + "Ailesi Diğer Üyeleri" bloğu). 183 sayfanın
   45'i bir aile beyan ediyor (Opera, Stripe, Stripe Arc, Puzzle, Note, Era, Bliss, Throne,
   Zoom, Syn.Ergy). Bu, tahmin değil markanın KENDİ sınıflandırmasıdır ve önceliklidir.
2. **Slug soneki kuralı** — `<taban>-<sonek>` biçimindeki sayfalar, aynı tabanı paylaşan en az
   bir başka sayfa varsa birleşir (assist-operasyonel + assist-yonetici -> Assist). Sonek
   listesi SABİTTİR (SUFFIX_AXIS); bilinmeyen bir sonek birleşme ÜRETMEZ, sayfa kendi ürünü
   olarak kalır. Böylece "marin-puf" (tek başına) yanlışlıkla "Marin" diye adsız bir aileye
   dönüşmez, adı "Marin Puf" olarak korunur.
3. **Görev metnindeki açık istekler** (FORCE_MERGE) — kaynağın AYIRDIĞI iki aileyi birleştirir.
   Tek örnek: görev "Stripe Serisi" altında `stripe-*` ve `stripe-arc-*` sayfalarının HEPSİNİ
   istiyor; kaynak ise bunları iki ayrı aile ("Stripe Ailesi" / "Stripe Arc Ailesi") sayıyor.
   Ayrım KAYBOLMASIN diye birleşik ailede ayrıca bir "Seri" ekseni açılır (Stripe / Stripe Arc).

EKSEN ADLARI — mevcut satırlarla UYUMLU OLMAK ZORUNDA. Canlıdaki Bürotime satırları sayfa
eksenini "Tip", çizim eksenini "Modül" adıyla taşıyor (ör. products#480 Syn.Ergy). Yeni bir ad
seçmek, birleşen satırlarda AYNI ŞEYİN İKİ AYRI hap grubunu doğururdu — bkz. proje notu
"partiler arası MODÜL EKSENİ ADI ayrışması". Bu yüzden:
    * modül/ürün-tipi soneki taşıyan aileler  -> sayfa ekseni "Tip"
    * kullanım soneki taşıyan aileler         -> sayfa ekseni "Kullanım"
    * çizim (technicalDrawings) ekseni        -> HER ZAMAN "Modül"
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
RAW_PATH = os.path.join(HERE, 'output', 'burotime-raw.json')

# sonek -> (eksen türü, hap değeri). Eksen türü 'kullanim' | 'tip'.
SUFFIX_AXIS = {
    'operasyonel': ('kullanim', 'Operasyonel'),
    'yonetici': ('kullanim', 'Yönetici'),
    'toplanti': ('kullanim', 'Toplantı'),
    'high': ('kullanim', 'High'),
    'home': ('kullanim', 'Home'),
    'saloon': ('kullanim', 'Saloon'),
    'masa': ('tip', 'Masa'),
    'sehpa': ('tip', 'Sehpa'),
    'depolama': ('tip', 'Depolama'),
    'tabure': ('tip', 'Tabure'),
    'kanepe': ('tip', 'Kanepe'),
    'puf': ('tip', 'Puf'),
    'askilik': ('tip', 'Askılık'),
    'saksi': ('tip', 'Saksı'),
    'divan': ('tip', 'Divan'),
    'wave': ('tip', 'Wave'),
}

# Kaynağın ayırdığı iki aileyi görev metni uyarınca birleştirir: <aile anahtarı> -> <hedef anahtar>
FORCE_MERGE = {'stripe-arc': 'stripe'}
# FORCE_MERGE ile gelen sayfaların ayırt edici ikinci ekseni.
SERIES_AXIS = {'stripe-arc': 'Stripe Arc', 'stripe': 'Stripe'}

# Kaynak aile başlığı ("Syn.Ergy Ailesi") -> MİMARLAB ürün başlığı. Yalnızca kaynak başlığın
# slug tabanından türetilenden FARKLI olduğu yerlerde gerekir.
TITLE_OVERRIDE = {
    'synergy': 'Syn.Ergy',
    'hey': 'Hey!',
    't50': 'T50',
    'usb': 'USB',
    'pi-home': 'Pi Home',
    'stripe': 'Stripe',
}

# Bürotime `productType` / h1 alt başlığı -> MİMARLAB katalog kategorisi (catalog-taxonomy.js).
TYPE_CATEGORY = {
    'Masa': 'Masa', 'Toplantı Masası': 'Masa', 'Yönetici Masası': 'Masa',
    'Eğitim Masası': 'Masa', 'Yükseklik Ayarlı Masa': 'Masa', 'Sehpa': 'Masa',
    'Çalışma Sistemi': 'Ofis Mobilyası', 'Workshop ve Eğitim Alanları': 'Ofis Mobilyası',
    'Elektirifikasyon': 'Ofis Mobilyası', 'Panel': 'Akustik Panel',
    'Çalışma Koltuğu': 'Ofis Mobilyası', 'Yönetici Koltuğu': 'Ofis Mobilyası',
    'Kanepe': 'Koltuk & Kanepe', 'Koltuk': 'Koltuk & Kanepe', 'Bekleme': 'Koltuk & Kanepe',
    'Koltuk - Kanepe': 'Koltuk & Kanepe', 'Çok Amaçlı Koltuk': 'Koltuk & Kanepe',
    'Sandalye': 'Sandalye & Tabure', 'Çok Amaçlı Sandalye': 'Sandalye & Tabure',
    'Bar Taburesi': 'Sandalye & Tabure', 'Tabure': 'Sandalye & Tabure',
    'Puf': 'Sandalye & Tabure',
    'Depolama': 'Dolap & Depolama', 'Keson': 'Dolap & Depolama', 'Askılık': 'Dolap & Depolama',
    'Saksı': 'Vazo & Obje',
}
# productType'ı OLMAYAN b.aksesuar sayfalarında h1 alt başlığı kullanılır.
H1_CATEGORY = {
    'Vazo': 'Vazo & Obje', 'Dekoratif Obje': 'Vazo & Obje', 'Dekoratif Kase': 'Vazo & Obje',
    'Dekoratif Tepsi': 'Vazo & Obje', 'Kitap Tutucu': 'Vazo & Obje',
    'Kitap Tututcu': 'Vazo & Obje',           # kaynakta yazım hatası, aynen eşlenir
    'Tablo': 'Duvar Objeleri', 'Lambader': 'İç Mekan Aydınlatma',
}
# Ne `productType` ne de h1 alt başlığı taşıyan iki b.aksesuar sayfası — kategori sayfa
# metninden okundu (urban: "Urban Fiction serisi ... tablo", botte: "el yapımı camın ...").
SLUG_CATEGORY = {'urban': 'Duvar Objeleri', 'botte': 'Vazo & Obje'}
DEFAULT_CATEGORY = 'Ofis Mobilyası'


def load_raw():
    return json.load(open(RAW_PATH, encoding='utf8'))


def split_suffix(slug):
    """`stripe-arc-operasyonel` -> ('stripe-arc', 'operasyonel'); soneksizse (slug, None)."""
    for suf in SUFFIX_AXIS:
        if slug.endswith('-' + suf):
            return slug[: -len(suf) - 1], suf
    return slug, None


def title_case(base):
    if base in TITLE_OVERRIDE:
        return TITLE_OVERRIDE[base]
    return ' '.join(w.capitalize() for w in base.split('-'))


def category_for(recs):
    """Ailenin kategorisi: sayfalarının kategorileri arasında EN SIK olan.

    Beraberlikte sıralama, ailenin İLK sayfasının (görev metnindeki sıra) kategorisine öncelik
    verir — böylece 'Bliss' (koltuk + masa + sehpa) sehpa sayfasından değil ana üründen etiketlenir.
    """
    def cat_of(r):
        return (TYPE_CATEGORY.get(r.get('product_type') or '')
                or H1_CATEGORY.get((r.get('h1_suffix') or '').strip())
                or SLUG_CATEGORY.get(r.get('slug')))

    counts = {}
    for r in recs:
        c = cat_of(r)
        if c:
            counts[c] = counts.get(c, 0) + 1
    if not counts:
        return DEFAULT_CATEGORY
    best = max(counts.values())
    for r in recs:
        c = cat_of(r)
        if c and counts[c] == best:
            return c
    return DEFAULT_CATEGORY


def build_groups(raw=None):
    """{aile anahtarı: {title, category, page_axis, pages:[{url, slug, axis_value, series}]}}"""
    raw = raw or load_raw()
    by_slug = {d['slug']: d for d in raw.values()}
    order = [d['slug'] for d in raw.values()]          # burotime-urls.txt sırası

    # 1) taban -> sayfalar
    base_of, suffix_of = {}, {}
    for s in order:
        b, suf = split_suffix(s)
        base_of[s], suffix_of[s] = b, suf
    base_pages = {}
    for s in order:
        base_pages.setdefault(base_of[s], []).append(s)

    # Soneki olan ama tabanını PAYLAŞMAYAN tek sayfa kendi ürünüdür (marin-puf, pi-home,
    # loria-tabure gibi) -> tabanı kendi slug'ına geri alınır ki adı "Marin" değil "Marin Puf"
    # kalsın. AMA loria-tabure'nin tabanı `loria` ve o da listede -> birleşir.
    fam_key = {}
    for s in order:
        b = base_of[s]
        fam_key[s] = b if len(base_pages.get(b, [])) > 1 else s

    # 2) kaynağın kendi aile beyanı — aynı familyTitle'ı paylaşan sayfaları TEK anahtara toplar
    src_family = {}
    for s in order:
        ft = by_slug[s].get('family_title')
        if ft:
            src_family.setdefault(ft, []).append(s)
    for ft, members in src_family.items():
        if len(members) < 2:
            continue
        # anahtar = üyelerin en kısa ortak slug tabanı (hepsi aynı tabana düşüyorsa o, değilse
        # ilk üyenin tabanı)
        bases = {fam_key[m] for m in members}
        key = sorted(bases, key=len)[0]
        for m in members:
            fam_key[m] = key

    # 3) görev metninin açık birleştirmeleri
    for s in order:
        fam_key[s] = FORCE_MERGE.get(fam_key[s], fam_key[s])

    groups = {}
    for s in order:
        groups.setdefault(fam_key[s], []).append(s)

    out = {}
    for key, slugs in groups.items():
        recs = [by_slug[s] for s in slugs]
        kinds = {SUFFIX_AXIS[suffix_of[s]][0] for s in slugs if suffix_of[s]}
        # "Kullanım" ekseni yalnızca TÜM sayfalar bir kullanım soneki taşıdığında kurulur.
        # Ailede soneksiz bir ana sayfa varsa (Nexus, Dem, Runner) o sayfanın hap değeri bir
        # KULLANIM değil bir ÜRÜN TİPİ olacağından ("Yönetici Masası" / "Kanepe"), eksen adı
        # "Tip" olmak zorunda — aksi halde hap satırı "Kullanım: Yönetici Masası | Toplantı"
        # gibi kendi içinde tutarsız okunurdu.
        all_suffixed = all(suffix_of[s] for s in slugs)
        page_axis = ('Kullanım' if (all_suffixed and kinds == {'kullanim'})
                     else ('Tip' if kinds else None))
        # FORCE_MERGE ile gelen ailelerde ikinci eksen (Seri) — bkz. dosya başı 3.
        needs_series = len({base_of[s] for s in slugs}) > 1 and \
            all(base_of[s] in SERIES_AXIS for s in slugs)

        pages = []
        for s in slugs:
            suf = suffix_of[s]
            if suf:
                val = SUFFIX_AXIS[suf][1]
            else:
                # Soneksiz ana sayfa: hap değeri kendi ÜRÜN TİPİNDEN gelir. h1 alt başlığı
                # (`<span> Bekleme Koltuğu</span>`) `productType`'tan daha ayırt edici — kaynağın
                # productType'ı Bliss'te "Koltuk - Kanepe", Fast/Loria/Surf/Quick'te düpedüz
                # "Sandalye" iken h1 "Bekleme Koltuğu" / "Çok Amaçlı Sandalye" diyor.
                h1s = (by_slug[s].get('h1_suffix') or '').strip()
                val = (h1s if 0 < len(h1s) <= 28 else '') \
                    or (by_slug[s].get('product_type') or '').strip() or title_case(key)
            pages.append({'url': by_slug[s]['source_url'], 'slug': s, 'axis_value': val,
                          'series': SERIES_AXIS.get(base_of[s]) if needs_series else None})

        # ÇAKIŞMA KORUMASI: iki sayfa AYNI hap değerini alırsa eksen tek değerli görünür ve
        # product-modal.js#buildVariantGroups onu tamamen ELER — iki sayfa birbirinden ayırt
        # edilemez hale gelir (koleksiyon4'teki "Stecca 7/8" tuzağının aynısı). Çakışan
        # sayfalarda değer, slug sonekinin insan okunur haline döndürülür.
        seen_vals = {}
        for p in pages:
            seen_vals.setdefault(p['axis_value'], []).append(p)
        for val, group in seen_vals.items():
            if len(group) < 2:
                continue
            for p in group:
                suf = suffix_of[p['slug']]
                p['axis_value'] = SUFFIX_AXIS[suf][1] if suf else title_case(p['slug'])
        out[key] = {
            'key': key,
            'title': title_case(key),
            'category': category_for(recs),
            'page_axis': page_axis if len(slugs) > 1 else None,
            'series_axis': 'Seri' if needs_series else None,
            'pages': pages,
        }
    return out


if __name__ == '__main__':
    g = build_groups()
    multi = {k: v for k, v in g.items() if len(v['pages']) > 1}
    print(f'{sum(len(v["pages"]) for v in g.values())} sayfa -> {len(g)} aile '
          f'({len(multi)} çok sayfalı)\n')
    for k, v in sorted(g.items()):
        if len(v['pages']) == 1:
            continue
        print(f"{v['title']:16} [{v['category']:18}] eksen={str(v['page_axis']):9} "
              f"seri={str(v['series_axis']):5} -> " +
              ', '.join(f"{p['slug']}={p['axis_value']}" +
                        (f"/{p['series']}" if p['series'] else '') for p in v['pages']))
    print('\nTEK SAYFALI AİLELER:')
    singles = [f"{v['title']}[{v['category']}]" for k, v in sorted(g.items()) if len(v['pages']) == 1]
    for i in range(0, len(singles), 4):
        print('  ' + '  '.join(x.ljust(34) for x in singles[i:i + 4]))
