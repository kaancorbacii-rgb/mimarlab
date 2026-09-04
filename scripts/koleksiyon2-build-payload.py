#!/usr/bin/env python3
"""koleksiyon2-raw.json (kazıma) + koleksiyon2-groups.py (gruplama) -> koleksiyon2-payload.json.

batch67-build-payload.py'nin İKİ EKSENLİ (sayfa="Tip" + sayfa-içi modül) versiyon üretim
desenini birebir izler; buradaki fark D1'de zaten var olan hedeflerin GERÇEK id/slug/title'la
elle doğrulanmış olması (bkz. UPDATE_EXISTING — 2026-09-05 D1 sorgusuyla teyit edildi, sadece
görev metnindeki "sofa merge" listesi değil, TÜM 54 aile adı brand_office_id=717 altında
aranarak 4 EK eşleşme bulundu: Monte Cristo/Satie/Simplissimo/Tristan zaten kayıtlıydı —
"Independent new" etiketine körü körüne güvenilmedi, tasarımcı adı eşleşmesiyle doğrulandı).

Kategori ataması: sayfa gruplarındaki URL segmentlerine göre —
  'koltuklar' varsa      -> 'Koltuk & Kanepe' (armchair/lounge ailesi baskın kabul edilir)
  'sandalyeler'/'tabure'/'seminer' varsa -> 'Sandalye & Tabure'
  yalnızca 'calisma-sandalyeleri' varsa  -> 'Ofis Mobilyası'
catalog-taxonomy.js#CATALOG_TAXONOMY['Mobilya'] ile AYNI üç değer.

Kullanım:
  python3 scripts/koleksiyon2-build-payload.py
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import importlib.util as _ilu
_gspec = _ilu.spec_from_file_location('koleksiyon2_groups', os.path.join(HERE, 'koleksiyon2-groups.py'))
groups_mod = _ilu.module_from_spec(_gspec)
_gspec.loader.exec_module(groups_mod)

RAW = json.load(open(os.path.join(HERE, 'output', 'koleksiyon2-raw.json'), encoding='utf8'))

TR_MAP = {'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'I': 'i', 'İ': 'i', 'ö': 'o',
          'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u'}

MAX_GALLERY = 8
MAX_PARENT_IMAGES = 10

# D1'de 2026-09-05'te elle doğrulanan mevcut satırlar (brand_office_id=717). Anahtar = aile adı
# (koleksiyon2-groups.py#ALL_GROUPS'taki 'name' ile birebir), değer = (products.id, mevcut slug).
# Tristan/Simplissimo/Satie/Monte Cristo: tasarımcı adı BİREBİR eşleşmesiyle doğrulandı (bkz.
# dosya başı yorumu) — yalnızca başlık eşleşmesine güvenilmedi.
UPDATE_EXISTING = {
    'Capella': (447, 'capella-koleksiyon'),
    'Serdivan': (468, 'serdivan-koleksiyon'),
    'İkaros': (227, 'ikaros-koleksiyon'),
    'Madrigal': (488, 'madrigal-koleksiyon'),
    'Duende': (445, 'duende-koleksiyon'),
    'Serhas': (465, 'serhas-koleksiyon'),
    'Poema': (226, 'poema-koleksiyon'),
    'Tellasmar': (476, 'tellasmar-koleksiyon'),
    'Vienna': (473, 'vienna-koleksiyon'),
    'Line': (450, 'line-koleksiyon'),
    'Obelix': (441, 'obelix-koleksiyon'),
    'Halia': (206, 'halia-koleksiyon'),
    'Monte Cristo': (225, 'monte-cristo-koleksiyon'),
    'Satie': (131, 'satie-koleksiyon'),
    'Simplissimo': (482, 'simplissimo-koleksiyon'),
    'Tristan': (208, 'tristan-koleksiyon'),
}
# Madrigal Chester ve Botero GÖREV METNİNDE "muhtemel merge" olarak işaretlenmişti ama D1'de böyle
# bir satır YOK (doğrulandı) -> bağımsız yeni ürün olarak işlenirler (UPDATE_EXISTING'de YOK).

TYPE_LABEL = {
    'koltuklar': 'Koltuk',
    'sandalyeler': 'Sandalye',
    'calisma-sandalyeleri': 'Çalışma Sandalyesi',
    'tabureler-ve-puflar': 'Tabure',
    'seminer-sandalyeleri': 'Seminer Sandalyesi',
}


def slugify(t):
    t = ''.join(TR_MAP.get(c, c) for c in (t or ''))
    return re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', t.lower()))


def url_segment(url):
    """.../urunler/<üst-kategori>/<segment>/<slug>/ -> segment (TYPE_LABEL anahtarı)."""
    parts = [p for p in url.split('/') if p]
    return parts[-2]


def category_for(group):
    segs = {url_segment(groups_mod.BASE + u) for u in group['urls']}
    if 'koltuklar' in segs:
        return 'Koltuk & Kanepe'
    if segs & {'sandalyeler', 'tabureler-ve-puflar', 'seminer-sandalyeleri'}:
        return 'Sandalye & Tabure'
    if segs == {'calisma-sandalyeleri'}:
        return 'Ofis Mobilyası'
    return 'Sandalye & Tabure'


def dedupe_specs(specs):
    out, seen = [], set()
    for s in specs:
        k = (s['label'], s['value'])
        if k in seen:
            continue
        seen.add(k)
        out.append(s)
    return out


def clean_title(name, first_raw):
    """Kaynak og:title bazen bozuk (bkz. Obelix Koltuklar / jenerik 'Koleksiyon' sorunu,
    scrape-batch67.py#parse_koleksiyon yorumu) — kanonik aile adı olarak GÖREV METNİNDEKİ isim
    (koleksiyon2-groups.py#name) kullanılır, kazınan title_src yalnızca teşhis için okunur."""
    return name


def build_family(group):
    urls = [groups_mod.BASE + u for u in group['urls']]
    pages = [RAW[u] for u in urls]
    multi_type = len(pages) > 1

    designers = []
    for p in pages:
        d = (p.get('designer') or '').strip()
        if d and d not in designers:
            designers.append(d)
    designer = ', '.join(designers) or None

    variants = []
    for i, (u, p) in enumerate(zip(urls, pages)):
        seg = url_segment(u)
        type_label = TYPE_LABEL.get(seg, seg)
        gallery = list(dict.fromkeys(p.get('images') or []))[:MAX_GALLERY]
        page_files = list(p.get('files') or [])
        mods = p.get('kol_variants') or []

        common = []
        if p.get('designer'):
            common.append({'label': 'Tasarımcı', 'value': p['designer']})

        if mods:
            for m in mods:
                mod_name = (m.get('name') or '').strip()
                if multi_type:
                    label = f"{type_label} · {mod_name}" if mod_name else type_label
                    options = [{'label': 'Tip', 'value': type_label}]
                    if mod_name:
                        options.append({'label': 'Modül', 'value': mod_name})
                else:
                    label = mod_name or type_label
                    options = [{'label': 'Modül', 'value': mod_name}] if mod_name else []
                images = ([m['image']] if m.get('image') else []) + gallery
                variants.append({
                    'label': label,
                    'options': options,
                    'srcImages': list(dict.fromkeys([x for x in images if x])),
                    'specs': dedupe_specs((m.get('specs') or []) + common),
                    'files': (m.get('files') or []) + page_files,
                    'description': None,
                    'sourceUrl': p['source_url'],
                })
        elif multi_type:
            # Bu TİP'in kendi modül verisi yok (ör. tek sabit ölçülü sayfa) — yine de TİP başına
            # bir versiyon açılır, aksi halde o sayfanın görselleri/açıklaması hiç yansımaz.
            variants.append({
                'label': type_label,
                'options': [{'label': 'Tip', 'value': type_label}],
                'srcImages': list(gallery),
                'specs': dedupe_specs(common),
                'files': page_files,
                'description': (p.get('description_src') or None),
                'sourceUrl': p['source_url'],
            })
        # tek sayfalı + modülsüz aile: variants HİÇ açılmaz (görev talimatı — "tek varyantlı ürün
        # de olur"), ürün kendi images/specs/description/designer/files'ını doğrudan taşır.

    first = pages[0]
    description = first.get('description_src') or ''
    # Birden çok sayfanın açıklaması varsa ve farklıysa BİRLEŞTİR (ilkini tekrar etmeden).
    if multi_type:
        seen_desc = {description.strip()}
        extra = []
        for p in pages[1:]:
            dsc = (p.get('description_src') or '').strip()
            if dsc and dsc not in seen_desc:
                extra.append(dsc)
                seen_desc.add(dsc)
        if extra:
            description = '\n\n'.join([description] + extra) if description else '\n\n'.join(extra)

    all_images = list(dict.fromkeys([img for p in pages for img in (p.get('images') or [])]))
    all_files = list({(f['url']): f for p in pages for f in (p.get('files') or [])}.values())

    return {
        'name': group['name'],
        'title': clean_title(group['name'], first),
        'brand': 'Koleksiyon',
        'brand_slug': 'koleksiyon',
        'category': category_for(group),
        'designer': designer,
        'description': description,
        'source_url': first['source_url'],
        'images': all_images[:MAX_PARENT_IMAGES],
        'specs': (variants[0]['specs'] if variants else []),
        'files': (variants[0]['files'] if variants else all_files),
        'variants': variants,
        'update_id': None,
        'update_slug': None,
    }


def build():
    items, slugs = [], set()
    for group in groups_mod.ALL_GROUPS:
        # Halia görünür 2 kez (koltuk grubunda + sandalye-konsolide grubunda) — 3 sayfası TEK
        # aile olarak birleştirilir, iki kez ürün AÇILMAZ.
        if group['name'] == 'Halia' and any(it['name'] == 'Halia' for it in items):
            continue
        if group['name'] == 'Halia':
            # Üç Halia sayfasını (koltuk + sandalye + çalışma sandalyesi) TEK grupta topla.
            halia_urls = []
            for g in groups_mod.ALL_GROUPS:
                if g['name'] == 'Halia':
                    halia_urls.extend(g['urls'])
            group = {'name': 'Halia', 'urls': halia_urls, 'merge_title': 'Halia'}

        it = build_family(group)
        base = slugify(f"{it['title']}-koleksiyon")
        slug, n = base, 2
        while slug in slugs:
            slug, n = f'{base}-{n}', n + 1
        slugs.add(slug)
        it['slug'] = slug

        if it['name'] in UPDATE_EXISTING:
            pid, pslug = UPDATE_EXISTING[it['name']]
            it['update_id'] = pid
            it['update_slug'] = pslug
        items.append(it)
    return items


def shuffle_by_type(items):
    """batch114/67#shuffle_by_brand ile AYNI fikir — burada tek marka (Koleksiyon) olduğundan
    kategoriye göre karıştırılır ki INSERT sırası (ORDER BY id DESC'te ekrana yansıyan sıra)
    art arda aynı kategoriden yığın üretmesin."""
    queues = {}
    for it in items:
        queues.setdefault(it['category'], []).append(it)
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
    items = shuffle_by_type(build())
    path = os.path.join(HERE, 'output', 'koleksiyon2-payload.json')
    json.dump({'products': items, 'brands': {}}, open(path, 'w', encoding='utf8'),
              ensure_ascii=False, indent=2)

    nvar = sum(len(p['variants']) for p in items)
    nimg = len({i for p in items for v in p['variants'] for i in v['srcImages']} |
                {i for p in items for i in p['images']})
    upd = sum(1 for p in items if p['update_id'])
    new = len(items) - upd
    print(f'{len(items)} aile ({new} yeni / {upd} güncelle) / {nvar} versiyon / '
          f'~{nimg} benzersiz kaynak görsel -> {path}\n')
    for p in items:
        flag = f" [GÜNCELLE id={p['update_id']} slug={p['update_slug']}]" if p['update_id'] else ' [YENİ]'
        print(f"  {p['title'][:22]:24} {p['category'][:16]:18} versiyon={len(p['variants']):2} "
              f"tasarımcı={str(p['designer'])[:24]:26}{flag}")

    total_pages = sum(len(g['urls']) for g in groups_mod.ALL_GROUPS)
    print(f'\nToplam kaynak sayfa: {total_pages} (63 beklenir)')
    noimg = [p['title'] for p in items if not p['images']]
    if noimg:
        print(f'UYARI — kapak görseli olmayan ürün: {noimg}')
