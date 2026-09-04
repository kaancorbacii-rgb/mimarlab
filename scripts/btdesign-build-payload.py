#!/usr/bin/env python3
"""btdesign-scraped.json + btdesign-dimensions.json + btdesign_families.py -> btdesign-payload.json

85 kaynak sayfa -> 62 ANA ÜRÜN, her biri `variants` alanında kendi versiyonlarını taşır
(bkz. migrations/0086_product_variants.sql, product-modal.js#buildVariantGroups).

Bu betiğin beş kararı
---------------------

1. **Versiyon = SAYFA × TEKNİK FÖY KONFİGÜRASYONU.** B&T'nin föyleri (`dimension-images`)
   ürünün her konfigürasyonunu ayrı ayrı ölçülendiriyor; 85 sayfadan 431 konfigürasyon okundu.
   Seçenek eksenleri üç kaynaktan gelir: aile ekseni (`FAMILIES[].axis`, ör. Tip=Sandalye/Bar) +
   konfigürasyon adının bölünmesiyle çıkan bir ya da iki eksen (`CONFIG_AXES`).

2. **Ölçüler YALNIZCA teknik föyden gelir.** bt.design ürün sayfalarında METİN olarak ölçü
   YOK (doğrulandı: hiçbir sayfada cm/mm/H:/Genişlik geçmiyor) — tek kaynak föy görselleridir.
   Bu yüzden ölçü spec'leri uydurulmaz; föyde okunamayan alan (ör. Matt modüllerinin yüksekliği,
   Dia 50'nin oturum yüksekliği) BOŞ bırakılır.

3. **Ana satırın `images` alanı = sayfanın KENDİ galerisi** (batch67 kuralı). B&T'de her
   konfigürasyonun ayrı ürün fotoğrafı YOK; föy görseli ölçülendirilmiş teknik çizimdir ve
   katalog kapağı olamaz. Versiyon görselleri ise `[o versiyonun teknik çizimi] + sayfa
   galerisi + dekupe render'lar` sırasındadır — versiyon değişince galeri gerçekten değişir
   ama kapak her zaman düzgün bir ürün fotoğrafı olur.

4. **Dosyalar R2'ye ALINMAZ, dış bağlantı yazılır** (batch114/batch67 ile aynı gerekçe,
   bkz. [[project_r2_free_tier_guard]]): 773 dosyanın tamamı `bt.design/download/<id>/`
   altında ZIP. Marka geneli katalog tuzağı BU KAYNAKTA YOK — 773 dosya etiketinin 773'ü de
   kendi ürün adını taşıyor (doğrulandı), bu yüzden batch114'teki `pick_files` elemesine
   gerek kalmadı.

5. **Karıştırma (shuffle)**: bu partide TEK marka var, bu yüzden markalar arası serpiştirme
   anlamsız. Bunun yerine KATEGORİ serpiştirilir (aynı gerekçe: katalog `ORDER BY id DESC`,
   yani INSERT sırası ekrana TERS yansır; komşu tekrar sıfırlanırsa yön fark etmez) — aksi
   hâlde katalogun tepesinde art arda 9 sehpa görünürdü.

Kullanım:
  python3 scripts/btdesign-build-payload.py
"""

import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from btdesign_families import (BRAND_NAME, BRAND_OFFICE_ID, BRAND_WEBSITE,  # noqa: E402
                               CONFIG_AXES, FAMILIES, PAGE_ONLY, SINGLE_AXIS, UPDATE_EXISTING)

OUT_DIR = os.path.join(HERE, 'output')
RAW = {r['slug']: r for r in json.load(open(os.path.join(OUT_DIR, 'btdesign-scraped.json'),
                                            encoding='utf8'))}
# Ölçüler `scripts/output/` altında DEĞİL, repoda VERSİYONLU tutulur: bu dosya bir betiğin
# çıktısı değil, 156 teknik föy görselinin TEK TEK GÖZLE okunmasıyla üretilmiş küratörlü veridir
# (431 konfigürasyon). bt.design hiçbir sayfasında ölçüyü METİN olarak yayımlamıyor, yani
# kaybolursa yeniden üretmenin otomatik bir yolu YOK.
DIMS = json.load(open(os.path.join(HERE, 'btdesign-dimensions.json'), encoding='utf8'))

TR_MAP = {'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'I': 'i', 'İ': 'i', 'ö': 'o',
          'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u'}

MAX_GALLERY = 6        # sayfa galerisinden versiyon başına taşınacak azami fotoğraf
MAX_CUTOUTS = 2        # + dekupe render (saydam zeminli ürün görseli)
MAX_PARENT_IMAGES = 10


def slugify(t):
    t = ''.join(TR_MAP.get(c, c) for c in (t or ''))
    return re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', t.lower()))


def num(v):
    """Ölçüyü ekrana yazılacak metne çevirir: 57.0 -> '57', 46.5 -> '46,5' (Türkçe ondalık)."""
    if v is None:
        return None
    if isinstance(v, str):
        return v
    return (str(int(v)) if float(v).is_integer() else f'{v:.1f}'.replace('.', ',')) + ''


def dim_specs(cfg):
    """Bir konfigürasyonun ölçülerini spec satırlarına çevirir (hepsi cm)."""
    out = []
    for label, key in (('Genişlik', 'W'), ('Derinlik', 'D'), ('Yükseklik', 'H'),
                       ('Oturum Yüksekliği', 'SH')):
        v = cfg.get(key)
        if v is None:
            continue
        out.append({'label': label, 'value': f'{num(v)} cm'})
    for label, v in (cfg.get('extra') or {}).items():
        if v is None:
            continue
        out.append({'label': label, 'value': f'{num(v)} cm' if not isinstance(v, str) or
                    re.fullmatch(r'[\d,\s\-]+', v) else str(v)})
    return out


def common_specs(raw):
    """Her versiyonda tekrar eden künye satırları."""
    out = [{'label': 'Marka', 'value': BRAND_NAME}]
    if raw.get('designer'):
        out.append({'label': 'Tasarımcı', 'value': raw['designer']})
    if raw.get('year'):
        out.append({'label': 'Tasarım Yılı', 'value': raw['year']})
    if raw.get('code'):
        out.append({'label': 'Ürün Kodu', 'value': raw['code']})
    if raw.get('tags'):
        out.append({'label': 'Malzeme Seçenekleri', 'value': ', '.join(raw['tags'])})
    if raw.get('breadcrumbs') and len(raw['breadcrumbs']) > 1:
        out.append({'label': 'Ürün Tipi', 'value': raw['breadcrumbs'][-2]})
    return out


def split_config(slug, label):
    """Konfigürasyon adını eksen (label, value) çiftlerine böler."""
    ax1, ax2 = CONFIG_AXES.get(slug, ('Versiyon', None))
    if slug in SINGLE_AXIS or ax2 is None or ' — ' not in label:
        return [{'label': ax1, 'value': label}]
    a, b = label.split(' — ', 1)
    return [{'label': ax1, 'value': a}, {'label': ax2, 'value': b}]


def page_configs(slug):
    """Sayfanın kendi konfigürasyonları (aynı föyü paylaşan sayfalarda PAGE_ONLY ile bölünür)."""
    cfgs = DIMS[slug]['configs']
    only = PAGE_ONLY.get(slug)
    if only:
        by_label = {c['label']: c for c in cfgs}
        picked = [by_label[l] for l in only if l in by_label]
        missing = [l for l in only if l not in by_label]
        if missing:
            raise SystemExit(f'PAGE_ONLY[{slug}] içinde föyde bulunmayan etiket: {missing}')
        return picked
    return cfgs


def build_one(fam):
    pages = fam['pages']
    first = RAW[pages[0][0]]

    designers, years = [], []
    for slug, _ in pages:
        r = RAW[slug]
        if r.get('designer') and r['designer'] not in designers:
            designers.append(r['designer'])
        if r.get('year') and r['year'] not in years:
            years.append(r['year'])

    axis = fam['axis']
    variants = []
    for slug, model in pages:
        raw = RAW[slug]
        gallery = list(dict.fromkeys(raw['gallery']))[:MAX_GALLERY]
        cutouts = list(dict.fromkeys(raw['cutouts']))[:MAX_CUTOUTS]
        ds = list(dict.fromkeys(raw['dimensionImages']))
        base = common_specs(raw)
        files = list(raw.get('files') or [])
        desc = raw.get('description') or raw.get('tagline') or None

        for cfg in page_configs(slug):
            options = ([{'label': axis, 'value': model}] if (axis and model) else [])
            options += split_config(slug, cfg['label'])
            label = f"{model} · {cfg['label']}" if model else cfg['label']
            # Versiyon galerisi: önce O versiyonun teknik çizimi, sonra sayfa fotoğrafları,
            # sonra dekupe render'lar (bkz. dosya başı 3. karar).
            images = ds[:1] + gallery + cutouts
            variants.append({
                'label': label,
                'options': options,
                'srcImages': list(dict.fromkeys([i for i in images if i])),
                'specs': dedupe_specs(dim_specs(cfg) + base),
                'files': files,
                'description': desc,
                'sourceUrl': raw['sourceUrl'],
            })

    head = variants[0]
    parent_images = list(dict.fromkeys(
        list(first['gallery']) + list(first['cutouts'])))[:MAX_PARENT_IMAGES]
    return {
        'key': fam['key'],
        'title': fam['title'],
        'brand': BRAND_NAME,
        'brand_office_id': BRAND_OFFICE_ID,
        'website': BRAND_WEBSITE,
        'category': fam['cat'],
        'designer': ', '.join(designers) or None,
        'year': years[0] if len(years) == 1 else None,
        'description': first.get('description') or first.get('tagline') or None,
        'source_url': first['sourceUrl'],
        'images': parent_images,
        'specs': head['specs'],
        'files': head['files'],
        'variants': variants,
        'update_id': None,
        # bt.design'ın "Ürünün Yer Aldığı Projeler" bloğu — çapraz etiketleme için taşınır.
        'source_projects': sorted({p['url'] for slug, _ in pages
                                   for p in RAW[slug]['projects']}),
    }


def dedupe_specs(specs):
    out, seen = [], set()
    for s in specs:
        k = (s['label'], s['value'])
        if k in seen:
            continue
        seen.add(k)
        out.append(s)
    return out


def assert_axis_names():
    """Aile ekseni ile konfigürasyon ekseni AYNI adı taşıyamaz.

    product-modal.js#buildVariantGroups grupları ETİKETE göre birleştirir; aynı ad iki farklı
    anlamı (ör. Round'da sayfa 'Model'i ile föy 'Model'i) tek bir hap grubunda toplar ve
    kullanıcı birbirini dışlamayan değerler arasında seçim yapmaya zorlanırdı.
    """
    for fam in FAMILIES:
        if not fam['axis']:
            continue
        for slug, _ in fam['pages']:
            for name in CONFIG_AXES.get(slug, ('Versiyon', None)):
                if name == fam['axis']:
                    raise SystemExit(
                        f"eksen adı çakışması: {fam['key']} ailesinin ekseni {name!r} ile "
                        f"{slug} sayfasının konfigürasyon ekseni aynı")


def build():
    assert_axis_names()
    by_key, items, slugs = {}, [], set()
    for fam in FAMILIES:
        it = build_one(fam)
        base = slugify(f"{it['title']}-{BRAND_NAME}")
        slug, n = base, 2
        while slug in slugs:
            slug, n = f'{base}-{n}', n + 1
        slugs.add(slug)
        it['slug'] = slug
        by_key[it['key']] = it
        items.append(it)
    for pid, key in UPDATE_EXISTING.items():
        if key not in by_key:
            raise SystemExit(f'UPDATE_EXISTING[{pid}] -> bilinmeyen aile anahtarı {key!r}')
        by_key[key]['update_id'] = pid
    return items


def shuffle_by_category(items):
    """Komşu tekrarı sıfırlayan serpiştirme (bkz. dosya başı 5. karar).

    batch114/batch67'deki `shuffle_by_brand` ile AYNI algoritma; tek fark, bu partide tek marka
    olduğu için kova anahtarı marka yerine KATEGORİ. Her adımda kalanı en çok olan kategori
    seçilir ama bir öncekiyle aynısı asla arka arkaya seçilmez.

    GÜNCELLENECEK satırlar serpiştirmeye HİÇ GİRMEZ, sona alınır. Gerekçe (2026-09-04 koşusunda
    yaşandı): `update_id` taşıyan satır ESKİ id'sini korur, yani yeni id bloğunda hiç yer almaz —
    serpiştirmenin içine konursa ekrandaki dizide bir "hayalet ayırıcı" olur ve kaldırıldığında
    iki yanındaki aynı kategoriden komşu yan yana düşer. batch67'nin "eski id'sini koruyan satır
    sahte komşu-tekrar alarmı üretir" notunun ters yönden aynısı.
    """
    fresh = [it for it in items if not it.get('update_id')]
    kept = [it for it in items if it.get('update_id')]
    queues = {}
    for it in fresh:
        queues.setdefault(it['category'], []).append(it)
    out, prev = [], None
    while any(queues.values()):
        avail = [c for c in queues if queues[c] and c != prev]
        if not avail:
            avail = [c for c in queues if queues[c]]
        pick = min(avail, key=lambda c: (-len(queues[c]), c))
        out.append(queues[pick].pop(0))
        prev = pick
    return out + kept


if __name__ == '__main__':
    items = shuffle_by_category(build())
    path = os.path.join(OUT_DIR, 'btdesign-payload.json')
    json.dump({'products': items, 'brand_office_id': BRAND_OFFICE_ID},
              open(path, 'w', encoding='utf8'), ensure_ascii=False, indent=2)

    nvar = sum(len(p['variants']) for p in items)
    nimg = len({i for p in items for v in p['variants'] for i in v['srcImages']} |
               {i for p in items for i in p['images']})
    nfile = sum(len(v['files']) for p in items for v in p['variants'])
    upd = sum(1 for p in items if p['update_id'])
    print(f'{len(items)} ana ürün / {nvar} versiyon / {nimg} benzersiz görsel / {nfile} dosya '
          f'/ {upd} mevcut satır güncellenecek -> {path}\n')
    for p in items:
        flag = f" [GÜNCELLE id={p['update_id']}]" if p['update_id'] else ''
        print(f"  {p['title'][:38]:40} {p['category'][:17]:19} "
              f"versiyon={len(p['variants']):2} görsel={len({i for v in p['variants'] for i in v['srcImages']}):2} "
              f"dosya={len(p['files']):2} proje={len(p['source_projects']):2}{flag}")

    runs = sum(1 for a, b in zip(items, items[1:]) if a['category'] == b['category'])
    print(f'\nArt arda aynı kategoriden gelen komşu çift sayısı: {runs} (0 = tam karışık)')
    noimg = [p['title'] for p in items if not p['images']]
    if noimg:
        print(f'UYARI — kapak görseli olmayan ürün: {noimg}')
    nodim = [(p['title'], v['label']) for p in items for v in p['variants']
             if not any(s['label'] == 'Genişlik' for s in v['specs'])]
    if nodim:
        print(f'UYARI — ölçüsüz versiyon: {len(nodim)} ({nodim[:5]})')
