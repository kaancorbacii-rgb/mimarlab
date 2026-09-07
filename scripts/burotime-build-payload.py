#!/usr/bin/env python3
"""burotime-raw.json (kazıma) + burotime-groups.py (aile tanımı) -> burotime-payload.json.

183 kaynak bağlantı 137 ANA ÜRÜNE indirgenir; her ana ürün `variants` alanında kendi
versiyonlarını taşır (bkz. migrations/0086_product_variants.sql,
product-modal.js#buildVariantGroups).

Bu betiğin BEŞ kararı
---------------------

1. **Versiyon eksenleri ÜÇ katmandan gelir.**
   * `Seri`     — yalnızca Stripe'ta (kaynak iki aile sayıyor, görev metni tek ürün istiyor).
   * `Kullanım` / `Tip` — sayfa ekseni (burotime-groups.py'nin kararı).
   * `Modül`    — sayfanın `technicalDrawings` girdileri; her modülün KENDİ ölçülendirilmiş
                  çizimi ve ölçüleri var.
   Tek değerli eksenleri buildVariantGroups zaten eliyor, o yüzden tek sayfalı/tek modüllü
   ailelerde fazladan hap satırı çıkmaz.

2. **"Ayak Tipi" ekseni TÜREVDİR ve HEPSİ-YA-DA-HİÇBİRİ kuralıyla açılır.** Görev metni çalışma
   koltuklarında ayak tipi hap satırı istiyor. Kaynakta böyle bir alan YOK; bilgi modül
   etiketlerinin içinde ("Misafir Alüminyum Ayak", "Krom Ayak"). Ayrıştırma yalnızca bir
   sayfanın modül etiketlerinin TAMAMI bir ayak deseni içeriyorsa yapılır. Kısmi ayrıştırma
   YAPILMAZ: eksenin bir kısmı boş kalsaydı o hap satırından bazı versiyonlara HİÇ ulaşılamazdı
   (bkz. product-modal.js#pickVariantIndex — eşleşmeyen versiyon seçilemez). Desen tutmayan
   sayfalarda modül etiketi KAYNAKTAKİ HALİYLE tek hap değeri olarak kalır.

3. **Ana satırın `images` alanı = İLK SAYFANIN KENDİ GALERİSİ**, versiyon 0'ınki değil — batch67
   ile aynı gerekçe: versiyon görseli burada beyaz zeminli ölçülendirilmiş bir TEKNİK ÇİZİM,
   katalog kapağı ve OG görseli olarak markanın kendi kapak fotoğrafı doğru olandır. Versiyon
   görselleri "önce o versiyonun çizimi, sonra sayfanın galerisi" sırasıyla dizilir ki versiyon
   değiştirince galeri GERÇEKTEN değişsin.

4. **Dosyalar R2'ye ALINMAZ, dış bağlantı yazılır.** Bürotime'ın tek bir SKP arşivi 1,8 GB
   (`Opera Skp.rar`, fileSize alanından). product-modal.js#renderFilesSection harici URL'leri
   zaten safeUrl()+target=_blank ile açıyor. Aynı ilke batch67/batch114'te de uygulandı.

5. **BÜTÇE MERDİVENİ — D1'in ~100 KB'lık tek-ifade sınırı.** Stripe ailesi 6 sayfa × 101 çizim
   taşıyor; her versiyona açıklama + galeri + dosya + spec yazılsa TEK BİR UPDATE ifadesi
   ~260 KB olur ve D1 SQLITE_TOOBIG ile TÜM batch'i düşürür (bkz. proje notu "D1 tek ifade boyut
   sınırı"). Bu yüzden aile JSON'u sırayla şu basamaklarla küçültülür ve İLK sığan basamakta
   durulur — böylece küçük aileler tam veriyle kalır, yalnızca dev aileler kırpılır:
       0. tam veri
       1. versiyon açıklamaları düşer (modal ana ürünün açıklamasına düşer — güvenli)
       2. versiyon galerisi 5 -> 2 kareye iner (çizim + kapak)
       3. teknik özellik satırları versiyonlardan düşer (ana satırda kalır)
       4. versiyon spec'i YALNIZCA ÖLÇÜLERE iner (marka/tasarımcı/kartela ana satırda kalır —
          versiyona özgü olan zaten ölçüdür)
       5. sayfa başına modül sayısı 40 -> 24 -> 16 -> 12 -> 8'e iner
   Kırpılan her aile rapora yazılır (`burotime-payload.json#budget_notes`).

Kullanım: python3 scripts/burotime-build-payload.py
"""
import importlib.util as _ilu
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_gspec = _ilu.spec_from_file_location('burotime_groups', os.path.join(HERE, 'burotime-groups.py'))
groups_mod = _ilu.module_from_spec(_gspec)
_gspec.loader.exec_module(groups_mod)

RAW = json.load(open(os.path.join(HERE, 'output', 'burotime-raw.json'), encoding='utf8'))
BY_SLUG = {d['slug']: d for d in RAW.values()}
OUT = os.path.join(HERE, 'output', 'burotime-payload.json')

BRAND = 'Bürotime'
MAX_PARENT_IMAGES = 10
MAX_VARIANT_GALLERY = 4          # çizimin ARDINA eklenecek galeri karesi sayısı
MAX_SPEC_ROWS = 14
STATEMENT_BUDGET = 80_000        # bayt; D1 sınırı ~100 KB, güvenlik payıyla

TR_MAP = {'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'I': 'i', 'İ': 'i', 'ö': 'o',
          'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u'}

# Koltuk/sandalye ailelerinde modül etiketinden ayrıştırılan ayak desenleri. SIRA ÖNEMLİ —
# en uzun/en özel desen önce denenir ("Sabit Piramit Ayak", "Piramit Ayak"tan önce).
LEG_PATTERNS = [
    (r'Dörtlü\s+Sabit\s+Ayak(?:lı)?', 'Dörtlü Sabit Ayak'),
    (r'Dörtlü\s+Mobil\s+Ayak(?:lı)?', 'Dörtlü Mobil Ayak'),
    (r'Tekerlekli\s+Dört\s+Ayak(?:lı)?', 'Tekerlekli Dört Ayak'),
    (r'Sabit\s+Piramit\s+Ayak', 'Sabit Piramit Ayak'),
    (r'Mobil\s+Piramit\s+Ayak', 'Mobil Piramit Ayak'),
    (r'Piramit\s+Ayak', 'Piramit Ayak'),
    (r'Alüminyum\s+Ayak', 'Alüminyum Ayak'),
    (r'Krom\s+Ayak', 'Krom Ayak'),
    (r'Yıldız\s+Ayak(?:\s*Krom\s*/\s*Plastik)?', 'Yıldız Ayak'),
    (r'Kızak\s+Ayak(?:lı)?', 'Kızak Ayak'),
    (r'Flanş\s+Ayak(?:lı)?', 'Flanş Ayak'),
    (r'\bU\s+Ayak\b', 'U Ayak'),
    (r'Metal\s+Boyalı\s+Ayak', 'Metal Boyalı Ayak'),
    (r'Metal\s+Ayak', 'Metal Ayak'),
    (r'Ahşap\s+Ayak', 'Ahşap Ayak'),
    (r'Plastik\s+Ayak', 'Plastik Ayak'),
    (r'Boyalı\s+Ayak', 'Boyalı Ayak'),
    (r'Sabit\s+Ayak', 'Sabit Ayak'),
    (r'Tekerlekli\s+Ayak', 'Tekerlekli Ayak'),
    (r'Misafir\s+Ayak', 'Misafir Ayak'),
]
SEATING_CATEGORIES = {'Ofis Mobilyası', 'Sandalye & Tabure', 'Koltuk & Kanepe'}

# Görev metni çalışma koltuklarında ayrıca bir "Sırt Tipi" hap satırı istiyor. Kaynakta böyle bir
# alan YOK, ama TEK bir ailenin (Foldit) modül etiketleri bunu düpedüz yazıyor:
#   "Yüksek sırtlı, metal kollu çalışma koltuğu" / "Kısa sırtlı, kolsuz çalışma koltuğu"
# Bu etiketler Sırt Tipi + Kol Tipi olarak ayrıştırılır — ayak ayrıştırmasıyla AYNI
# HEPSİ-YA-DA-HİÇBİRİ kuralı geçerlidir. Diğer ailelerde sırt yüksekliği kaynakta HİÇ
# belirtilmediğinden UYDURULMAZ; oralarda hap satırı çıkmaz.
BACK_RE = re.compile(r'^\s*(Yüksek|Kısa|Orta|Alçak)\s+sırtlı\s*,?\s*(.*?)\s*$', re.I)
ARM_MAP = {'metal kollu': 'Metal Kollu', 'kolsuz': 'Kolsuz', 'kollu': 'Kollu'}


# Kaynakta 13 sayfanın 30 çizim etiketi TAMAMEN BÜYÜK HARF ("STRIPE ARC TOPLANTI",
# "PUNTO YÖNETİCİ"); diğer 380 etiket normal yazımda. Hap butonlarında yan yana geldiklerinde
# tutarsız görünüyor, bu yüzden yalnızca TAMAMI büyük olanlar başlık yazımına çevrilir (anlam
# değişmez, kısmi büyük harfli etiketlere DOKUNULMAZ).
#
# TUZAK — TÜRKÇE 'I' İKİ YÖNLÜ: Python'un `.lower()`'ı Türkçe farkında değil ('İ'.lower() 'i' +
# birleşik nokta U+0307 üretir), ama körü körüne Türkçe kural uygulamak da YANLIŞ: 'I'->'ı'
# eşlemesi "TOPLANTI"yı doğru ("Toplantı") çevirirken markanın YABANCI adlarını bozar
# ("STRIPE" -> "Strıpe", "MARIN" -> "Marın"). Bu yüzden kelime bazında karar verilir:
#   * Türkçe'ye özgü bir harf taşıyorsa (İÖÜŞĞÇ) ya da bilinen bir Türkçe sözcükse -> TR kuralı
#   * aksi halde düz ASCII küçültme (yabancı ürün/aile adları)
# TR_WORDS yalnızca bu partide GERÇEKTEN geçen ve 'I' içeren Türkçe sözcükleri barındırır;
# listeye körü körüne ekleme yapma, her giriş bir yabancı adı bozma riski taşır.
_TR_LOWER = str.maketrans({'İ': 'i', 'I': 'ı'})
_TR_UPPER_FIRST = {'i': 'İ', 'ı': 'I'}
_TR_SPECIFIC = set('İÖÜŞĞÇ')
TR_WORDS = {'TOPLANTI', 'SAKSI', 'ASKILIK', 'AYAKLI', 'KAPI'}


def tr_title(s):
    out = []
    for w in s.split(' '):
        if not w:
            out.append(w)
            continue
        turkish = bool(_TR_SPECIFIC & set(w)) or w.upper() in TR_WORDS
        low = (w.translate(_TR_LOWER) if turkish else w).lower()
        out.append(_TR_UPPER_FIRST.get(low[0], low[0].upper()) + low[1:])
    return ' '.join(out)


def normalize_label(s):
    letters = [c for c in s if c.isalpha()]
    if len(letters) > 3 and all(c == c.upper() for c in letters):
        return tr_title(s)
    return s


def slugify(t):
    t = ''.join(TR_MAP.get(c, c) for c in (t or ''))
    return re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', t.lower()))


def fold_tr(s):
    return ''.join(TR_MAP.get(c, c) for c in str(s or '')).lower().strip()


def parse_specifications(text):
    """`specifications` sekmesi -> [{label,value}].

    Metin paragraf paragraf geliyor; çoğu "Etiket: değer" biçiminde (bold-yonetici: "Kollar:
    Yükseklik ayarlı..."), bir kısmı düz cümle (agent, surf). Etiketli olanlar ayrı satır olur,
    kalanlar TEK bir "Teknik Özellikler" satırında toplanır — hiçbir cümle ATILMAZ.
    """
    rows, loose = [], []
    for part in re.split(r'\n\s*\n|\n', text or ''):
        part = part.strip()
        if not part:
            continue
        m = re.match(r'^([^:]{2,40})\s*:\s*(.+)$', part, re.S)
        if m and not m.group(1).strip().endswith('.'):
            rows.append({'label': m.group(1).strip(), 'value': re.sub(r'\s+', ' ', m.group(2)).strip()})
        else:
            loose.append(re.sub(r'\s+', ' ', part))
    if loose:
        rows.append({'label': 'Teknik Özellikler', 'value': ' '.join(loose)})
    return rows


def decompose_legs(labels):
    """[etiket] -> [(ayak, model)] ya da None (HEPSİ-YA-DA-HİÇBİRİ, bkz. dosya başı 2)."""
    out = []
    for lab in labels:
        hit = None
        for pat, name in LEG_PATTERNS:
            m = re.search(pat, lab, re.I)
            if m:
                hit = (name, (lab[:m.start()] + ' ' + lab[m.end():]))
                break
        if not hit:
            return None
        leg, rest = hit
        rest = re.sub(r'\s{2,}', ' ', rest).strip(' -/,')
        out.append((leg, rest or 'Standart'))
    # En az iki farklı ayak değeri yoksa yeni eksen açmanın anlamı yok.
    if len({leg for leg, _ in out}) < 2:
        return None
    return out


def decompose_back(labels):
    """[etiket] -> [(sırt, kol)] ya da None (HEPSİ-YA-DA-HİÇBİRİ, bkz. BACK_RE yorumu)."""
    out = []
    for lab in labels:
        m = BACK_RE.match(lab)
        if not m:
            return None
        back = m.group(1).capitalize() + ' Sırt'
        rest = re.sub(r'çalışma koltuğu|koltuk|sandalye', '', m.group(2) or '', flags=re.I)
        rest = re.sub(r'\s{2,}', ' ', rest).strip(' -/,')
        out.append((back, ARM_MAP.get(rest.lower(), rest.title() if rest else 'Standart')))
    if len({b for b, _ in out}) < 2:
        return None
    return out


def common_specs(raw, designer):
    out = []
    if raw.get('product_type'):
        out.append({'label': 'Ürün Tipi', 'value': raw['product_type']})
    if raw.get('usage_areas'):
        out.append({'label': 'Kullanım Alanları', 'value': ', '.join(raw['usage_areas'])})
    if raw.get('color_groups'):
        out.append({'label': 'Renk ve Malzeme Seçenekleri', 'value': ', '.join(raw['color_groups'])})
    if raw.get('awards'):
        out.append({'label': 'Sertifikalar', 'value': ', '.join(raw['awards'])})
    out.append({'label': 'Marka', 'value': BRAND})
    if designer:
        out.append({'label': 'Tasarımcı', 'value': designer})
    return out


def dedupe_specs(specs, limit=MAX_SPEC_ROWS):
    out, seen = [], set()
    for s in specs:
        k = (s['label'], s['value'])
        if k in seen:
            continue
        seen.add(k)
        out.append(s)
    return out[:limit]


def build_family(g, opts):
    """opts: {drop_desc, gallery, drop_tech, max_modules}"""
    pages = g['pages']
    recs = [BY_SLUG[p['slug']] for p in pages]
    first = recs[0]

    designers = []
    for r in recs:
        for d in re.split(r',\s*', r.get('designer') or ''):
            d = d.strip()
            if d and d not in designers:
                designers.append(d)
    designer = ', '.join(designers) or None

    # Açıklama: ailenin ilk DOLU sayfa açıklaması (swan-yonetici gibi açıklamasız sayfalar var).
    description = next((r['description_src'] for r in recs if r['description_src']), '')
    # Tasarım hikâyesi (kaynağın `quote` bloğu) açıklamanın ARDINA eklenir — markanın kendi
    # metni, uydurma DEĞİL; tırnak içinde ve tasarımcı adıyla verilir.
    quote = next((r['quote'] for r in recs if r.get('quote')), None)
    # Bazı b.aksesuar sayfalarında `quote` metni açıklamanın AYNISIYLA başlıyor (urban, sign,
    # forest). Ham `in` testi boşluk/tırnak farkları yüzünden tutmuyordu; normalize edilmiş ilk
    # 60 karakter üzerinden bakılır, aksi halde aynı paragraf iki kez yazılırdı.
    def _norm(t):
        return re.sub(r'[^0-9a-zçğıöşü]+', '', (t or '').lower())

    if quote and _norm(quote['text'])[:60] not in _norm(description):
        who = quote['author'] or designer or BRAND
        description = (description + '\n\n“' + re.sub(r'\s+', ' ', quote['text']).strip()
                       + '” — ' + who).strip()

    variants = []
    for p, raw in zip(pages, recs):
        page_opts = []
        if g.get('series_axis') and p.get('series'):
            page_opts.append({'label': g['series_axis'], 'value': p['series']})
        if g.get('page_axis'):
            page_opts.append({'label': g['page_axis'], 'value': p['axis_value']})

        gallery = [u for u in dict.fromkeys(raw['images'])]
        tech = [] if opts['drop_tech'] else parse_specifications(raw['specifications_src'])
        base = common_specs(raw, designer)
        page_files = list(raw.get('files') or [])
        page_desc = None if opts['drop_desc'] else (raw['description_src'] or None)

        mods = [dict(m, label=normalize_label(m['label']))
                for m in raw['drawings'][:opts['max_modules']]]
        legs = backs = None
        if g['category'] in SEATING_CATEGORIES and len(mods) > 1:
            backs = decompose_back([m['label'] for m in mods])
            if not backs:
                legs = decompose_legs([m['label'] for m in mods])

        if not mods:
            variants.append({
                'label': p['axis_value'] if g.get('page_axis') else g['title'],
                'options': page_opts,
                'srcImages': gallery[:opts['gallery'] + 1],
                'specs': dedupe_specs(tech if opts.get('slim_specs') else base + tech),
                'files': page_files,
                'description': page_desc,
                'sourceUrl': raw['source_url'],
            })
            continue

        for i, m in enumerate(mods):
            opt = list(page_opts)
            if backs:
                back, arm = backs[i]
                opt.append({'label': 'Sırt Tipi', 'value': back})
                opt.append({'label': 'Kol Tipi', 'value': arm})
                mod_label = f'{back} · {arm}'
            elif legs:
                leg, model = legs[i]
                opt.append({'label': 'Ayak Tipi', 'value': leg})
                opt.append({'label': 'Modül', 'value': model})
                mod_label = f'{model} · {leg}'
            else:
                opt.append({'label': 'Modül', 'value': m['label']})
                mod_label = m['label']
            prefix = ' · '.join(x['value'] for x in page_opts)
            images = ([m['image']] if m.get('image') else []) + gallery[:opts['gallery']]
            variants.append({
                'label': f'{prefix} · {mod_label}' if prefix else mod_label,
                'options': opt,
                'srcImages': list(dict.fromkeys(u for u in images if u)),
                'specs': dedupe_specs(m['specs'] if opts.get('slim_specs')
                                      else m['specs'] + base + tech),
                'files': page_files,
                'description': page_desc,
                'sourceUrl': raw['source_url'],
            })

    # AYNI hap kombinasyonuna düşen iki versiyon olursa (kaynakta aynı etiketli iki çizim var:
    # note-operasyonel'de 5 kez "Masa") ikincisi ulaşılamaz kalırdı — etiketler sıralanır.
    seen = {}
    for v in variants:
        key = tuple((o['label'], o['value']) for o in v['options'])
        seen.setdefault(key, []).append(v)
    for key, grp in seen.items():
        if len(grp) < 2:
            continue
        for n, v in enumerate(grp, 1):
            for o in v['options']:
                if o['label'] == 'Modül':
                    o['value'] = f"{o['value']} {n}"
            v['label'] = f'{v["label"]} {n}'

    head = variants[0]
    parent_specs = dedupe_specs(
        (head['specs'] if head['specs'] else [])
        + parse_specifications(first['specifications_src'])
        + common_specs(first, designer), limit=20)
    return {
        'key': g['key'],
        'title': g['title'],
        'slug': f"{slugify(g['title'])}-burotime",
        'brand': BRAND,
        'category': g['category'],
        'designer': designer,
        'description': description,
        'source_url': first['source_url'],
        'batch_urls': [p['url'] for p in pages],
        'images': [u for u in dict.fromkeys(first['images'])][:MAX_PARENT_IMAGES],
        'specs': parent_specs,
        'files': list(first.get('files') or []),
        'variants': variants,
        'update_id': None,
    }


LADDER = [
    dict(drop_desc=False, gallery=MAX_VARIANT_GALLERY, drop_tech=False, slim_specs=False, max_modules=40),
    dict(drop_desc=True, gallery=MAX_VARIANT_GALLERY, drop_tech=False, slim_specs=False, max_modules=40),
    dict(drop_desc=True, gallery=1, drop_tech=False, slim_specs=False, max_modules=40),
    dict(drop_desc=True, gallery=1, drop_tech=True, slim_specs=False, max_modules=40),
    dict(drop_desc=True, gallery=1, drop_tech=True, slim_specs=True, max_modules=40),
    dict(drop_desc=True, gallery=1, drop_tech=True, slim_specs=True, max_modules=24),
    dict(drop_desc=True, gallery=1, drop_tech=True, slim_specs=True, max_modules=16),
    dict(drop_desc=True, gallery=1, drop_tech=True, slim_specs=True, max_modules=12),
    dict(drop_desc=True, gallery=1, drop_tech=True, slim_specs=True, max_modules=8),
]


def estimate_sql_bytes(item):
    """Yazılacak SQL ifadesinin kaba boyutu.

    Payload'daki KAYNAK görsel adresleri (cloudfront, ~75 karakter) yazımda R2 yoluyla
    (`/media/import/products/<slug>/bt-<n>.webp`, ~50 karakter) DEĞİŞTİRİLECEĞİNDEN ham JSON
    boyutu olduğu gibi kullanılamaz; her http adresi 50 karakterlik bir yer tutucuya indirgenir.
    Kalan pay (JSON içi tırnak kaçışları + SQL '' kaçışları) için 1.15x uygulanır.
    """
    blob = json.dumps(item, ensure_ascii=False)
    blob = re.sub(r'https://d3b3f8x27fn472\.cloudfront\.net/[^"]+', 'x' * 50, blob)
    return int(len(blob.encode()) * 1.15)


def build_with_budget(g, notes):
    for step, opts in enumerate(LADDER):
        item = build_family(g, opts)
        size = estimate_sql_bytes(item)
        if size <= STATEMENT_BUDGET or step == len(LADDER) - 1:
            if step:
                notes.append({'title': g['title'], 'step': step, 'approx_bytes': size,
                              'variants': len(item['variants']), 'opts': opts})
            return item


def shuffle_by_category(items):
    """Katalogda art arda aynı kategoriden kart çıkmasın diye aileler kategori bazlı serpiştirilir.

    batch114-build-payload.py#shuffle_by_brand ile AYNI algoritma: her adımda EN KALABALIK
    kalan kategoriden bir öğe alınır, bir önceki öğeyle aynı kategoriyse ikinci en kalabalıktan
    alınır. Katalog `display_order` ile sıralandığından bu sıra ekrana doğrudan yansır ve
    burotime-spread-display-order.py bunu sayfalara dağıtır.
    """
    buckets = {}
    for it in items:
        buckets.setdefault(it['category'], []).append(it)
    out, prev = [], None
    while any(buckets.values()):
        order = sorted((k for k, v in buckets.items() if v), key=lambda k: -len(buckets[k]))
        pick = next((k for k in order if k != prev), order[0])
        out.append(buckets[pick].pop(0))
        prev = pick
    return out


def main():
    g = groups_mod.build_groups(RAW)
    notes = []
    items = [build_with_budget(v, notes) for v in g.values()]

    dup = {}
    for it in items:
        dup.setdefault(it['slug'], []).append(it)
    for slug, lst in dup.items():
        if len(lst) > 1:
            raise SystemExit(f'aynı slug iki ailede: {slug} -> {[x["title"] for x in lst]}')

    items = shuffle_by_category(items)
    payload = {'brand': BRAND, 'products': items, 'budget_notes': notes}
    json.dump(payload, open(OUT, 'w', encoding='utf8'), ensure_ascii=False, indent=1)

    nvar = sum(len(x['variants']) for x in items)
    nimg = len({u for x in items for u in x['images']}
               | {u for x in items for v in x['variants'] for u in v['srcImages']})
    print(f'{len(RAW)} sayfa -> {len(items)} ana ürün / {nvar} versiyon / {nimg} tekil görsel')
    print(f'bütçe merdiveninde kırpılan aile: {len(notes)}')
    for n in notes:
        print(f"  {n['title']:12} basamak={n['step']} versiyon={n['variants']:3} "
              f"~{n['approx_bytes'] // 1024} KB  {n['opts']}")
    big = sorted(items, key=lambda x: -estimate_sql_bytes(x))[:6]
    print('en büyük aileler (tahmini SQL): ' + ', '.join(
        f'{x["title"]}={estimate_sql_bytes(x) // 1024}KB' for x in big))
    print(f'\n{OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
