#!/usr/bin/env python3
"""koleksiyon4-raw.json (kazıma) + koleksiyon4-groups.py (gruplama) -> koleksiyon4-payload.json.

koleksiyon3-build-payload.py'nin İKİ EKSENLİ versiyon üretim desenini izler; bu partiye özgü
ÜÇ fark var:

1) EKSEN ADLARI ÜRÜN TİPİNE GÖRE DEĞİŞİR (görev metnindeki şartname):
     oturma grupları -> "Tip"       (Kanepe / Koltuk / Tabure & Puf)   + "Modül"
     masalar         -> "Fonksiyon" (Operasyonel Çalışma İstasyonu /
                                     Yönetici Masası / Toplantı Masası /
                                     Seminer Masası)                   + "Ölçü / Model"
   Masa modüllerinin hap etiketine ÖLÇÜ de eklenir ("A0814K · 140×80"), çünkü çıplak ürün kodu
   ("A0814K") bir "ebat seçici" olarak okunamıyor. Oturma gruplarında çıplak kod KORUNUR —
   o ailelerin D1'de zaten çıplak kodlu versiyonları var (bkz. import-koleksiyon4.py'deki
   sayfa-bazlı overwrite), etiket biçimini değiştirmek aynı üründe iki farklı biçim üretirdi.

2) ÖLÜ DOSYA BAĞLANTISI AYIKLANIR — GERÇEK BULGU (2026-09-05). Kazınan 370 modülün HEPSİNİN
   `spec_file` alanı AYNI değeri taşıyor: `https://pim.koleksiyon.com.tr/product-type-code/pdf`.
   Bu bir teknik föy DEĞİL; `{"error":"Product Not Found"}` JSON'u dönen bir placeholder
   (curl ile doğrulandı). Modal'da bu bir "indir" butonu olarak çizilirdi -> DÜŞÜRÜLÜR.
   (D1'de bu bağlantıyı taşıyan 56 mevcut Koleksiyon satırı da import-koleksiyon4.py tarafından
   temizlenir.)

3) DOSYA TÜRLERİ DÜZELTİLİR. parse_koleksiyon her dosyayı '.pdf' diye etiketliyor ama gerçek
   Content-Type'lar (curl ile doğrulandı) şöyle:
     product-group/download?file_type=2D|3D -> application/zip        (AutoCAD arşivi)
     api/product/specs?seo=...              -> application/x-zip      (teknik föy arşivi)
     static/content/....rar                 -> application/x-rar      (Revit ailesi)
   Yanlış uzantı, modal'daki indirme butonunda yanlış ikon/ad üretir.

AYRICA: sayfa düzeyindeki dosyalar (2D/3D/Revit/föy) O SAYFADAN gelen HER versiyona kopyalanır.
Bu arşivler ürün-grubu geneli olduğundan her modül için geçerlidir; modal versiyon seçiliyken
ana ürünün dosyalarına BİLEREK düşmediğinden (bkz. product-modal.js#renderDetailBody yorumu)
kopyalanmazsa versiyon seçili haldeyken "Yüklenen dosya yok" görünürdü.

Kullanım:
  python3 scripts/koleksiyon4-build-payload.py
"""
import importlib.util as _ilu
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

_gspec = _ilu.spec_from_file_location('koleksiyon4_groups', os.path.join(HERE, 'koleksiyon4-groups.py'))
G = _ilu.module_from_spec(_gspec)
_gspec.loader.exec_module(G)

RAW = json.load(open(os.path.join(HERE, 'output', 'koleksiyon4-raw.json'), encoding='utf8'))

TR_MAP = {'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'I': 'i', 'İ': 'i', 'ö': 'o',
          'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u'}

MAX_GALLERY = 8
MAX_PARENT_IMAGES = 10

# Ölü placeholder — bkz. dosya başı (2).
DEAD_FILE_URL = 'pim.koleksiyon.com.tr/product-type-code/pdf'

# Bu parti masalar/sehpalar, depolama, yatak odası, bölücü panel ve dış mekan sayfalarından
# oluşuyor — koleksiyon3'ün oturma/masa ikilisi burada YETMEZ. Segment -> insan-okur tip etiketi.
# Ekseni "Tip" olan her aile için bu harita tek kaynaktır; eksik bir segment düşerse
# type_label_for segmentin kendisini döndürür (görünür ama çirkin) — bu yüzden aşağıdaki
# __main__ bloğunda "ham segment etiketi" için ayrı bir uyarı var.
SEATING_TYPES = {
    # masalar
    'evde-ofis-masalari': 'Evde Ofis Masası',
    'yemek-masalari': 'Yemek Masası',
    'sehpalar': 'Sehpa',
    # depolama
    'kitaplik-ve-tv-uniteleri': 'Kitaplık & TV Ünitesi',
    'dolaplar-ve-bufeler': 'Dolap & Büfe',
    'operasyonel-depolama': 'Keson / Pedestal',
    # yatak odası
    'yataklar': 'Yatak',
    'komodinler': 'Komodin',
    'gece-sehpalari-ve-sifonyerler': 'Gece Sehpası & Şifonyer',
    # mekansal bölücüler
    'bolucu-panel': 'Bölücü Panel',
    # dış mekan
    'sandalyeler': 'Sandalye',
    'kanepeler': 'Kanepe',
    'masalar': 'Masa',
    'tabureler-ve-puflar': 'Tabure & Puf',
}
# Bu partide "Fonksiyon" eksenli (masa sistemi) sayfa YOK; sözlük, is_desk_group'un ve
# koleksiyon3'ten devralınan ölçü-sonekli etiket mantığının çalışır kalması için BOŞ bırakıldı.
DESK_TYPES = {}


def slugify(t):
    t = ''.join(TR_MAP.get(c, c) for c in (t or ''))
    return re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', t.lower()))


def url_segment(url):
    """.../urunler/<üst>/<segment>/<slug>/ -> segment (SEATING_TYPES/DESK_TYPES anahtarı)."""
    return [p for p in url.split('/') if p][-2]


def is_desk_group(group):
    return url_segment(G.BASE + group['urls'][0]) in DESK_TYPES


def type_label_for(url):
    seg = url_segment(url)
    return DESK_TYPES.get(seg) or SEATING_TYPES.get(seg) or seg


def type_labels_for_group(group):
    """Ailedeki HER url için tip etiketi — çakışmaları çözerek.

    GERÇEK BULGU (bu parti): "Colos Stecca" ailesinin İKİ sayfası da aynı segmentten geliyor
    (`.../tabureler-ve-puflar/colos-stecca-7-...` ve `...-8-...`), yani type_label_for ikisine de
    "Tabure & Puf" der. Sonuç: tip ekseninin tek bir değeri olur (eksen tek değerliyse
    product-modal.js#buildVariantGroups onu ELER) ve iki sayfanın versiyonları birbirinden
    ayırt edilemez hâle gelir — kullanıcı Stecca 7 ile 8 arasında geçiş YAPAMAZ.

    Çakışma varsa etiket, sayfanın KENDİ slug'ının aile adından arta kalan kısmından üretilir
    (`colos-stecca-7-tabureler-ve-puflar` -> "Stecca 7"). Çakışma yoksa davranış değişmez."""
    labels = [type_label_for(G.BASE + u) for u in group['urls']]
    if len(set(labels)) == len(labels):
        return labels
    fam = slugify(group['name'])
    out = []
    for u, lbl in zip(group['urls'], labels):
        page_slug = [p for p in u.split('/') if p][-1]          # colos-stecca-7-tabureler-ve-puflar
        seg = url_segment(G.BASE + u)                            # tabureler-ve-puflar
        rest = page_slug[:-(len(seg) + 1)] if page_slug.endswith('-' + seg) else page_slug
        # Aile adı önekini at ("colos-stecca-7" -> "7" ise ailenin tamamı önek demektir; o
        # durumda tüm slug'ı kullan ki etiket boş kalmasın).
        trimmed = rest[len(fam) + 1:] if rest.startswith(fam + '-') and len(rest) > len(fam) + 1 else rest
        pretty = ' '.join(w.capitalize() if not w.isdigit() else w for w in trimmed.split('-'))
        # Aile önekini attıktan sonra geriye yalnızca bir sayı/kısa kod kalabiliyor
        # (colos-stecca-7 -> "7"). Hap üzerinde çıplak "7" hiçbir şey anlatmaz; ailenin SON
        # kelimesi öne alınır -> "Stecca 7".
        if pretty and (pretty.isdigit() or len(pretty) <= 2):
            pretty = f"{group['name'].split()[-1]} {pretty}"
        out.append(pretty or lbl)
    return out


def normalize_files(files, family):
    """Ölü placeholder'ı düşürür, gerçek formatı/adı yazar (bkz. dosya başı (2) ve (3))."""
    out, seen = [], set()
    for f in files or []:
        url = (f.get('url') or '').strip()
        if not url or DEAD_FILE_URL in url or url in seen:
            continue
        seen.add(url)
        low = url.lower()
        name = (f.get('filename') or '')
        if 'file_type=2d' in low:
            fmt, label = 'zip', f'{family} AutoCAD 2D'
        elif 'file_type=3d' in low:
            fmt, label = 'zip', f'{family} AutoCAD 3D'
        elif '/api/product/specs' in low:
            fmt, label = 'zip', f'{family} Teknik Föyler'
        else:
            fmt = 'rar' if low.split('?')[0].endswith('.rar') else 'zip'
            label = f'{family} Revit' if 'revit' in name.lower() else f'{family} Teknik Dosya'
        out.append({'url': url, 'filename': f'{label}.{fmt}', 'format': fmt,
                    'size': None, 'kind': 'cad'})
    return out


def dedupe_specs(specs):
    out, seen = [], set()
    for s in specs:
        k = (s['label'], s['value'])
        if k not in seen:
            seen.add(k)
            out.append(s)
    return out


def size_suffix(specs):
    """'Genişlik 1400 mm' + 'Derinlik 800 mm' -> '140×80' (cm). Ölçü yoksa ''."""
    by = {s['label']: s['value'] for s in specs}
    nums = []
    for lbl in ('Genişlik', 'Derinlik'):
        m = re.search(r'(\d+)', by.get(lbl, '') or '')
        if not m:
            return ''
        nums.append(str(round(int(m.group(1)) / 10)))
    return '×'.join(nums)


def build_family(group):
    urls = [G.BASE + u for u in group['urls']]
    pages = [RAW[u] for u in urls]
    multi_type = len(pages) > 1
    desk = is_desk_group(group)
    type_axis = 'Fonksiyon' if desk else 'Tip'
    module_axis = 'Ölçü / Model' if desk else 'Modül'

    designers = []
    for p in pages:
        d = (p.get('designer') or '').strip()
        if d and d not in designers:
            designers.append(d)
    designer = ', '.join(designers) or None

    variants = []
    type_labels = type_labels_for_group(group)
    for u, p, type_label in zip(urls, pages, type_labels):
        gallery = list(dict.fromkeys(p.get('images') or []))[:MAX_GALLERY]
        page_files = normalize_files(p.get('files'), group['name'])
        mods = p.get('kol_variants') or []

        common = []
        if p.get('designer'):
            common.append({'label': 'Tasarımcı', 'value': p['designer']})

        if mods:
            for m in mods:
                code = (m.get('name') or '').strip()
                specs = dedupe_specs((m.get('specs') or []) + common)
                mod_name = code
                if desk and code:
                    sfx = size_suffix(m.get('specs') or [])
                    if sfx:
                        mod_name = f'{code} · {sfx}'
                if multi_type:
                    label = f'{type_label} · {mod_name}' if mod_name else type_label
                    options = [{'label': type_axis, 'value': type_label}]
                    if mod_name:
                        options.append({'label': module_axis, 'value': mod_name})
                else:
                    label = mod_name or type_label
                    options = [{'label': module_axis, 'value': mod_name}] if mod_name else []
                images = ([m['image']] if m.get('image') else []) + gallery
                variants.append({
                    'label': label,
                    'options': options,
                    'srcImages': list(dict.fromkeys([x for x in images if x])),
                    'specs': specs,
                    # Modül düzeyi dosyalar ÖLÜ placeholder'dı (dosya başı (2)) -> sayfanın gerçek
                    # arşivleri her modüle kopyalanır.
                    'files': list(page_files),
                    'description': None,
                    'sourceUrl': p['source_url'],
                })
        else:
            # Modülsüz sayfa: yine de bir versiyon açılır ki o sayfanın görselleri/dosyaları
            # kaybolmasın (koleksiyon3-build-payload.py'deki AYNI gerekçe).
            variants.append({
                'label': type_label if multi_type else group['name'],
                'options': [{'label': type_axis, 'value': type_label}] if multi_type else [],
                'srcImages': list(gallery),
                'specs': dedupe_specs(common),
                'files': list(page_files),
                'description': (p.get('description_src') or None),
                'sourceUrl': p['source_url'],
            })

    # Açıklama: sayfaların FARKLI açıklamaları birleştirilir (ilki tekrar edilmeden).
    descs = []
    for p in pages:
        d = (p.get('description_src') or '').strip()
        if d and d not in descs:
            descs.append(d)
    description = '\n\n'.join(descs)
    if not description:
        # KAYNAKTA AÇIKLAMA YOK. 2026-09-05 partisinde 11 ailenin koleksiyondesign.com sayfasında
        # hiç tanıtım metni bulunmuyor (kazıyıcı hatası değil — sayfada gerçekten yok, ham JSON'da
        # description_src, features_src ve materials_src'nin ÜÇÜ de boş). Pazarlama metni UYDURMAK
        # yerine yalnızca ELDEKİ GERÇEK alanlardan (marka + tip + tasarımcı) olgusal tek cümle
        # kurulur; modal'da boş bir açıklama bloğu bırakmaz ve hiçbir doğrulanmamış iddia içermez.
        types = [t for t in dict.fromkeys(type_labels_for_group(group))]
        tpart = ' ve '.join(t.lower() for t in types) if types else 'mobilya'
        description = f"Koleksiyon imzalı {group['name']} {tpart} serisi."
        if designer:
            description += f" Tasarım: {designer}."


    all_images = list(dict.fromkeys(i for p in pages for i in (p.get('images') or [])))
    all_files = normalize_files([f for p in pages for f in (p.get('files') or [])], group['name'])

    return {
        'name': group['name'],
        'title': group['name'],
        'brand': 'Koleksiyon',
        'category': group['category'],
        'designer': designer,
        'description': description,
        'source_url': pages[0]['source_url'],
        'images': all_images[:MAX_PARENT_IMAGES],
        'specs': (variants[0]['specs'] if variants else []),
        'files': all_files,
        'variants': variants,
        'batch_urls': urls,          # sayfa-bazlı overwrite için (import-koleksiyon4.py)
        'update_id': group['merge_id'],
        'slug': slugify(f"{group['name']}-koleksiyon"),
    }


def shuffle_by_category(items):
    """koleksiyon3-build-payload.py#shuffle_by_type ile AYNI algoritma — INSERT sırası art arda
    aynı kategoriden yığın üretmesin (katalogda ORDER BY id DESC'te görünen sıra)."""
    queues = {}
    for it in items:
        queues.setdefault(it['category'], []).append(it)
    out, prev = [], None
    while any(queues.values()):
        avail = [s for s in queues if queues[s] and s != prev] or [s for s in queues if queues[s]]
        pick = min(avail, key=lambda s: (-len(queues[s]), s))
        out.append(queues[pick].pop(0))
        prev = pick
    return out


if __name__ == '__main__':
    items = shuffle_by_category([build_family(g) for g in G.GROUPS])
    slugs = set()
    for it in items:
        base, slug, n = it['slug'], it['slug'], 2
        while slug in slugs:
            slug, n = f'{base}-{n}', n + 1
        slugs.add(slug)
        it['slug'] = slug

    path = os.path.join(HERE, 'output', 'koleksiyon4-payload.json')
    json.dump({'products': items}, open(path, 'w', encoding='utf8'), ensure_ascii=False, indent=2)

    nvar = sum(len(p['variants']) for p in items)
    nimg = len({i for p in items for v in p['variants'] for i in v['srcImages']} |
               {i for p in items for i in p['images']})
    nfile = len({f['url'] for p in items for f in p['files']})
    upd = sum(1 for p in items if p['update_id'])
    print(f'{len(items)} aile ({len(items) - upd} yeni / {upd} güncelle) / {nvar} versiyon / '
          f'{nimg} benzersiz kaynak görsel / {nfile} benzersiz dosya -> {path}\n')
    for p in items:
        flag = f"[GÜNCELLE #{p['update_id']}]" if p['update_id'] else '[YENİ]'
        print(f"  {p['title'][:22]:24} {p['category'][:16]:18} versiyon={len(p['variants']):3} "
              f"dosya={len(p['files'])} görsel={len(p['images'])} "
              f"{str(p['designer'])[:20]:22}{flag}")

    print(f"\nToplam kaynak sayfa: {sum(len(p['batch_urls']) for p in items)} (64 beklenir)")
    for bad, why in ((lambda p: not p['images'], 'kapak görseli yok'),
                     (lambda p: not p['description'], 'açıklama yok'),
                     (lambda p: not p['variants'], 'versiyon yok')):
        hits = [p['title'] for p in items if bad(p)]
        if hits:
            print(f'UYARI — {why}: {hits}')
    dead = [p['title'] for p in items
            if any(DEAD_FILE_URL in f['url'] for f in p['files'])
            or any(DEAD_FILE_URL in f['url'] for v in p['variants'] for f in v['files'])]
    print(f"ölü placeholder bağlantısı kalan ürün: {dead or 'YOK (beklenen)'}")
