#!/usr/bin/env python3
"""67 ürün bağlantısı için ÜÇ KAYNAKLI kazıyıcı (2026-09-04): Koleksiyon + Casa + Bürotime.

Çıktı: scripts/output/batch67-raw.json — her URL için TEK ham kayıt. Aile/versiyon gruplaması
BURADA YAPILMAZ; o iş scripts/batch67_translations.py + batch67-build-payload.py'de.

Kaynak başına ayrıştırma notları
--------------------------------
* **Koleksiyon** — Next.js App Router. HTML'deki hash'li CSS modülü sınıflarına
  (`Slide_allVariantsName__w11Hb`) ÇAPA ATILMAZ; onlar her derlemede değişir. Bunun yerine
  `self.__next_f.push([1,"..."])` RSC "flight" akışı birleştirilip içindeki JSON nesneleri
  DENGELİ PARANTEZ taramasıyla çıkarılır. Sayfa Türkçe geldiği için ÇEVİRİ GEREKMEZ.
    - `"allVariants":[{...,"items":[...]}]` → ailenin TÜM modülleri; her öğede kendi `image`,
      kendi `specs` sözlüğü (Genişlik/Derinlik/Koltuk Genişliği... zaten Türkçe) ve kendi
      `spec_file` teknik föy PDF'i var. MİMARLAB versiyon şemasının birebir karşılığı budur.
      DİKKAT: specs sözlüğünde SADECE `height` anahtarı İngilizce kalmış (kaynak hatası),
      KOL_SPEC_TR ile "Yükseklik"e çevrilir.
    - `"resources":[{"title":"İndirilebilir Dökümanlar","items":[{name,file}]}]` → aile geneli föy.
    - Ürün metni: flight'taki `"title"/"description"/"designer"` üçlüsü + `images` galerisi.
      `ProductRecommendations` bloğundaki YABANCI ürün kartları alınmaz (yalnızca ürünün kendi
      `images` dizisi okunur) — Archello'daki "More products by" tuzağının buradaki karşılığı.

* **Casa** — WordPress + Elementor, sayfalar İNGİLİZCE (çeviri gerekir, bkz. batch67_translations).
    - İçerik `elementor-widget-heading` kutularında: ad, "Design: <ad>, <yıl>", 1-2 paragraf
      tanıtım, ardından "TECHNICAL SPECIFICATION" başlığı ve İKİ SÜTUNLU tablo.
      Tablo DOM'da önce TÜM etiketler sonra TÜM değerler olarak akıyor (kasa/oturum/... →
      fiberglass/D35 HR sünger/...), konum eşlemesiyle çiftlenir; sayılar tutmazsa tablo ATILIR.
      İLGİNÇ: bu etiket/değerler İngilizce sayfada bile ZATEN TÜRKÇE, çevrilmez.
    - Görseller: `wp-content/uploads/.../Casa-<Ürün>-N.jpg`. WordPress her görselin
      `-300x300`/`-1024x1024`/`-150x150`... türevlerini de sayfaya basıyor; ÖLÇÜ SONEKİ KIRPILIP
      tekilleştirilir, yoksa aynı fotoğraf 5 kez R2'ye yüklenir.

* **Bürotime** — Next.js + Strapi; Koleksiyon ile AYNI flight tekniği.
    - `h1` içinde `<span class="font-billie">Fab</span><span> Kanepe</span>` → ad + ürün tipi.
    - `tabs`: `description` (HTML), `documents[]` (PDF/RAR — DWG/SKP/3dsmax/Greenguard),
      `technicalDrawings[]` → **versiyon verisi burada**: `label` ("Üçlü Kanepe"/"İkili Kanepe")
      ve `caption` "H:85\\nW:94\\nL:240" ölçüleri taşır.
    - `designers[]`, `usageAreas[]`, `careRecommendations[]`, `productType`, `awards[]`,
      `colorGroups[]` (kumaş kartelası — versiyon ekseni DEĞİL, spec satırı olarak taşınır).

Kullanım:
  python3 scripts/scrape-batch67.py
"""

import concurrent.futures
import html
import json
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')
URLS = [l.strip() for l in open(os.path.join(HERE, 'output', 'batch67-urls.txt'), encoding='utf8')
        if l.strip()]

# Koleksiyon specs sözlüğünde çevrilmeden kalmış anahtarlar (kaynak hatası).
KOL_SPEC_TR = {'height': 'Yükseklik', 'width': 'Genişlik', 'depth': 'Derinlik',
               'seat_height': 'Oturum Yüksekliği', 'length': 'Uzunluk'}


def fetch(url, tries=4):
    """scrape-batch114.py#fetch ile AYNI desen — urllib bot filtrelerine takılıyor, curl geçiyor."""
    last = None
    for n in range(tries):
        p = subprocess.run(['curl', '-sL', '--compressed', '-A', UA, '-H', 'Accept-Language: tr,en',
                            '-w', '\n%{http_code}', '--max-time', '60', url], capture_output=True)
        out = p.stdout.decode('utf8', 'replace')
        body, _, code = out.rpartition('\n')
        if p.returncode == 0 and code.strip() == '200' and len(body) > 1000:
            return body
        last = f'http={code.strip()} rc={p.returncode} len={len(body)}'
        time.sleep(1.5 * (n + 1))
    raise RuntimeError(f'{url}: {last}')


def txt(s):
    s = re.sub(r'<br\s*/?>', '\n', s or '')
    s = re.sub(r'<[^>]+>', ' ', s)
    return re.sub(r'[ \t]+', ' ', html.unescape(s)).replace('\xa0', ' ').strip()


def flight(h):
    """`self.__next_f.push([1,"<parça>"])` akışını tek bir metinde birleştirir (Next.js RSC)."""
    buf = ''
    for c in re.findall(r'self\.__next_f\.push\(\[1,(".*?")\]\)</script>', h, re.S):
        try:
            buf += json.loads(c)
        except Exception:
            pass
    return buf


def balanced(s, i):
    """s[i] '['/'{' ise DENGELİ kapanışına kadar olan dilimi döndürür (string/escape farkında)."""
    if i < 0 or i >= len(s) or s[i] not in '[{':
        return None
    depth, ins, esc = 0, False, False
    for j in range(i, len(s)):
        ch = s[j]
        if esc:
            esc = False
            continue
        if ch == '\\':
            esc = True
            continue
        if ch == '"':
            ins = not ins
            continue
        if ins:
            continue
        if ch in '[{':
            depth += 1
        elif ch in ']}':
            depth -= 1
            if depth == 0:
                return s[i:j + 1]
    return None


def json_after(buf, key, start=0):
    """`"key":[...]` / `"key":{...}` değerini JSON olarak çözer (ilk geçerli olanı)."""
    for m in re.finditer(re.escape(f'"{key}":'), buf[start:]):
        i = start + m.end()
        while i < len(buf) and buf[i] in ' \n':
            i += 1
        blk = balanced(buf, i)
        if not blk:
            continue
        try:
            return json.loads(blk)
        except Exception:
            continue
    return None


# --------------------------------------------------------------------------------------------
# Koleksiyon
# --------------------------------------------------------------------------------------------
def parse_koleksiyon(url, h):
    buf = flight(h)
    d = {'source': 'koleksiyon', 'source_url': url, 'brand_name': 'Koleksiyon',
         'brand_slug': 'koleksiyon', 'brand_logo': None, 'features_src': [], 'materials_src': []}

    m = re.search(r'<meta property="og:title" content="([^"]*)"', h)
    title = html.unescape(m.group(1)).strip() if m else ''
    # KAYNAK HATASI: vienna-kanepeler sayfasının og:title'ı ürün adı değil "Koleksiyon" (markanın
    # kendi adı) — batch114'teki Nurus toya-2 vakasının birebir eşi. Marka adına düşen başlıklarda
    # URL slug'ından türetilir ("vienna-kanepeler" -> "Vienna").
    if not title or title.casefold() in ('koleksiyon', 'koleksiyon design'):
        stem = re.sub(r'-(kanepeler|sandalyeler|tabureler|masalar|berjerler)$', '',
                      url.rstrip('/').rsplit('/', 1)[-1])
        title = ' '.join(w.capitalize() for w in stem.split('-'))
    d['title_src'] = title
    d['family_src'] = title

    # Ürün düğümü: seo/title/description/designer aynı nesnede.
    node = None
    for mm in re.finditer(r'\{"id":"product-\d+","seo":', buf):
        blk = balanced(buf, mm.start())
        if not blk:
            continue
        try:
            node = json.loads(blk)
            break
        except Exception:
            continue
    if node is None:
        node = {}

    d['description_src'] = (node.get('description') or '').strip()
    if not d['description_src']:
        m = re.search(r'<meta property="og:description" content="([^"]*)"', h)
        d['description_src'] = html.unescape(m.group(1)).strip() if m else ''
    d['designer'] = (node.get('designer') or '').strip() or None
    d['long_text'] = (json_after(buf, 'longText') or '') if isinstance(json_after(buf, 'longText'), str) else ''

    # Kapak + galeri (ürünün KENDİ görselleri; öneri kartları alınmaz)
    imgs = []
    cover = node.get('image')
    if isinstance(cover, dict) and cover.get('src'):
        imgs.append(cover['src'])
    gal = node.get('images')
    if isinstance(gal, list):
        for g in gal:
            if isinstance(g, dict) and g.get('src'):
                imgs.append(g['src'])
    d['images'] = list(dict.fromkeys(imgs))

    # --- Versiyonlar: allVariants -> items ---
    # DİKKAT: `allVariants` anahtarı İKİ farklı blok için kullanılıyor —
    #   type="all_variants" → ailenin GERÇEK modülleri (TIP 1, 150 SOFA...)   ← istediğimiz
    #   type="more_series"  → "Diğer Seriler", BAŞKA ürünlerin kartları        ← alınmamalı
    # (Archello'daki "More products by" / Nurus comp-97 tuzağının buradaki karşılığı; ör. Line
    # sayfasında YALNIZCA more_series var, o yüzden modül sayısı haklı olarak 0 çıkar.)
    # Sayfada her iki blok da bulunabildiğinden İLK eşleşmeyle yetinilmez, TÜMÜ taranır.
    variants = []
    groups = []
    for mm in re.finditer(r'"allVariants":', buf):
        i = mm.end()
        while i < len(buf) and buf[i] in ' \n':
            i += 1
        blk = balanced(buf, i)
        if not blk:
            continue
        try:
            v = json.loads(blk)
        except Exception:
            continue
        if isinstance(v, list):
            groups.extend(v)
    if groups:
        seen_names = set()
        for grp in groups:
            if not isinstance(grp, dict) or grp.get('type') != 'all_variants':
                continue
            for it in grp.get('items') or []:
                if not isinstance(it, dict):
                    continue
                name = (it.get('name') or '').strip()
                if not name or name in seen_names:
                    continue
                seen_names.add(name)
                img = it.get('image') or {}
                specs = []
                for k, v in (it.get('specs') or {}).items():
                    if not v:
                        continue
                    specs.append({'label': KOL_SPEC_TR.get(k, k), 'value': str(v)})
                files = []
                sf = it.get('spec_file') or it.get('all_spec_files')
                if sf:
                    files.append({'url': sf, 'filename': f'{name} Teknik Föy.pdf',
                                  'format': 'pdf', 'size': None, 'kind': 'spec'})
                variants.append({'name': name, 'image': img.get('src'),
                                 'alt': img.get('alt') or '', 'specs': specs, 'files': files})
    d['kol_variants'] = variants

    # Aile geneli dökümanlar
    files = []
    res = json_after(buf, 'resources')
    if isinstance(res, list):
        for grp in res:
            if not isinstance(grp, dict):
                continue
            for it in grp.get('items') or []:
                if isinstance(it, dict) and it.get('file'):
                    files.append({'url': it['file'], 'filename': f"{d['title_src']} {it.get('name') or 'Teknik Föy'}.pdf",
                                  'format': 'pdf', 'size': None, 'kind': 'spec'})
    d['files'] = files
    d['specs_src'] = []
    return d


# --------------------------------------------------------------------------------------------
# Casa (WordPress + Elementor, İngilizce)
# --------------------------------------------------------------------------------------------
CASA_NAV = {'life style', 'design', 'projects', 'stores', 'about us', 'products', 'news',
            'contact', 'follow us', 'allover', 'allover 2025', 'mare nostrum', 'italia',
            'sofa', 'armchair', 'chair', 'table', 'sideboard & bookcase', 'low table',
            'nightstand & chest of drawers', 'bed', 'complements', 'outdoor',
            'yasal bilgilendirmeler', 'technical specification'}

# Elementor'un DOLDURULMAMIŞ başlık widget'ının varsayılan metni. 15 Casa sayfasının 10'unda
# teknik tablonun hemen ardında duruyor ve sayıyı tek'e düşürüp sütun eşlemesini bozuyor.
CASA_PLACEHOLDER = 'başlık metninizi buraya ekleyin'


def is_title_case(s):
    """"Low Arm Sofas" / "Compositions" gibi BÖLÜM BAŞLIKLARINI ayırt eder.

    Casa'nın teknik tablosundaki hücreler istisnasız küçük harfle başlayan ifadeler
    ("wooden frame", "zig-zag spring systems", "kasa"); tablodan sonra gelen modül/kompozisyon
    başlıkları ise Başlık Düzeninde. Yalnızca "ilk harf büyük" bakmak yetmez — "M1 bakır, M2
    bronz..." gerçek bir DEĞER ve büyük harfle başlıyor; bu yüzden 2 harften uzun TÜM kelimelerin
    büyük harfle başlaması aranır.
    """
    w = [x for x in re.split(r'\s+', s.strip()) if len(x) > 2]
    return bool(w) and all(x[0].isupper() for x in w)


def parse_casa(url, h):
    d = {'source': 'casa', 'source_url': url, 'brand_name': 'Casa', 'brand_slug': 'casa',
         'brand_logo': None, 'files': [], 'features_src': [], 'materials_src': [],
         'family_src': '', 'designer': None}

    m = re.search(r'<meta property="og:title" content="([^"]*)"', h)
    d['title_src'] = html.unescape(m.group(1)).strip().title() if m else ''
    m = re.search(r'<meta property="og:description" content="([^"]*)"', h)
    d['casa_type'] = html.unescape(m.group(1)).strip() if m else ''

    heads = []
    for mm in re.finditer(r'elementor-widget-heading[^>]*>(.*?)(?=<div class="elementor-element|</section)',
                          h, re.S):
        t = txt(mm.group(1))
        if t:
            heads.append(t)

    body = [x for x in heads if x.strip().lower() not in CASA_NAV]

    # "Design: Mauro Lipparini, 2025"
    for x in list(body):
        dm = re.match(r'^Design\s*:\s*(.+?)(?:,\s*(\d{4}))?$', x, re.I)
        if dm:
            d['designer'] = dm.group(1).strip()
            d['design_year'] = dm.group(2)
            body.remove(x)

    # Teknik tablo: "TECHNICAL SPECIFICATION"tan sonraki başlıklar İKİ SÜTUN hâlinde akıyor —
    # önce TÜM etiketler, sonra TÜM değerler (kasa/oturum/... -> fiberglass/D35 HR sünger/...).
    # Konum eşlemesiyle çiftlenir; sayı tek kalırsa tablo ATILIR (yanlış eşlenmiş bir teknik föy,
    # hiç föy olmamasından kötüdür — bkz. batch114'teki "yanlış katalog" kararı).
    specs = []
    ti = next((i for i, x in enumerate(heads) if x.strip().lower() == 'technical specification'), None)
    if ti is not None:
        tail = []
        for x in heads[ti + 1:]:
            low = x.strip().lower()
            if low == CASA_PLACEHOLDER:      # boş Elementor widget'ı — yok say, tabloyu bitirme
                continue
            if (low in CASA_NAV or low.startswith('(') or is_title_case(x)
                    or re.match(r'^(T:|\+\d)', x) or '@' in x):
                break                        # modül/kompozisyon başlığı ya da alt bilgi: tablo bitti
            tail.append(x)
        if len(tail) >= 2 and len(tail) % 2 == 0:
            half = len(tail) // 2
            labels, values = tail[:half], tail[half:]
            if all(len(l) < 45 for l in labels):
                specs = [{'label': l.strip(), 'value': v.strip()}
                         for l, v in zip(labels, values) if l.strip() and v.strip()]
        for x in tail:
            if x in body:
                body.remove(x)
    d['specs_src'] = specs

    # Açıklama: kalan uzun paragraflar (ürün adının kendisi tekrar ediyor, elenir)
    name_l = d['title_src'].lower()
    paras = [x for x in body if len(x) > 70 and x.lower() != name_l]
    d['description_src'] = '\n\n'.join(dict.fromkeys(paras))

    # Görseller — WordPress ölçü sonekleri kırpılıp tekilleştirilir
    seen, imgs = set(), []
    slug_hint = re.sub(r'[^a-z0-9]+', '', d['title_src'].lower())
    for u in re.findall(r'https://www\.casa\.com\.tr/wp-content/uploads/[^"\' )]+?\.(?:jpg|jpeg|png|webp)', h, re.I):
        base = re.sub(r'-\d{2,4}x\d{2,4}(?=\.[a-z]+$)', '', u)
        if base in seen:
            continue
        low = base.lower()
        if any(t in low for t in ('icon', 'logo', 'cropped-', '/casa.jpg')):
            continue
        # Yalnızca BU ürünün görselleri (dosya adı ürün adını içermeli)
        fname = re.sub(r'[^a-z0-9]+', '', low.rsplit('/', 1)[-1])
        if slug_hint and slug_hint[:6] not in fname:
            continue
        seen.add(base)
        imgs.append(base)
    d['images'] = imgs
    return d


# --------------------------------------------------------------------------------------------
# Bürotime (Next.js + Strapi)
# --------------------------------------------------------------------------------------------
def parse_burotime(url, h):
    buf = flight(h)
    d = {'source': 'burotime', 'source_url': url, 'brand_name': 'Bürotime',
         'brand_slug': 'burotime', 'brand_logo': None, 'materials_src': []}

    # h1: "<span class="font-billie"><span>Fab</span></span><span> Kanepe</span>"
    name, ptype = '', ''
    m = re.search(r'"__html":"\s*<span class=\\"font-billie\\"><span>(.*?)</span></span>(.*?)"', buf)
    if m:
        name = txt(m.group(1).replace('\\"', '"'))
        ptype = txt(m.group(2).replace('\\"', '"'))
    if not name:
        mm = re.search(r'<meta property="og:title" content="([^"]*)"', h)
        name = html.unescape(mm.group(1)).strip() if mm else ''
    d['title_src'] = name
    d['family_src'] = name
    pt = json_after(buf, 'productType')
    d['product_type'] = (pt or {}).get('title') if isinstance(pt, dict) else (ptype or None)

    desc = json_after(buf, 'description')
    d['description_src'] = txt(desc) if isinstance(desc, str) else ''
    if not d['description_src']:
        mm = re.search(r'<meta property="og:description" content="([^"]*)"', h)
        d['description_src'] = html.unescape(mm.group(1)).strip() if mm else ''

    # Galeriler: ana galeri + "Ürün Detayları" ikinci galerisi
    imgs = []
    for key in ('gallery', 'slides'):
        g = json_after(buf, key)
        if isinstance(g, list):
            for it in g:
                if isinstance(it, dict) and it.get('desktopImageUrl'):
                    imgs.append(it['desktopImageUrl'])
    mm = re.search(r'<meta property="og:image" content="([^"]*)"', h)
    if mm:
        imgs.append(html.unescape(mm.group(1)))
    d['images'] = list(dict.fromkeys(imgs))

    # Dosyalar
    files = []
    docs = json_after(buf, 'documents')
    if isinstance(docs, list):
        for it in docs:
            if not isinstance(it, dict) or not it.get('fileUrl'):
                continue
            ext = (it.get('fileExt') or '').lower()
            kb = it.get('fileSize')
            files.append({'url': it['fileUrl'],
                          'filename': f"{it.get('title') or 'Döküman'}.{ext}" if ext else it.get('title'),
                          'format': ext, 'size': int(kb * 1024) if isinstance(kb, (int, float)) else None,
                          'kind': 'cad' if ext in ('rar', 'zip', 'dwg', 'skp') else 'spec'})
    d['files'] = files

    # Teknik çizimler = versiyon adayları (label + H/W/L ölçüleri)
    tds = []
    td = json_after(buf, 'technicalDrawings')
    if isinstance(td, list):
        for it in td:
            if not isinstance(it, dict):
                continue
            cap = (it.get('caption') or '').replace('\\n', '\n')
            dims = []
            for k, lab in (('H', 'Yükseklik'), ('W', 'Derinlik'), ('L', 'Genişlik'), ('D', 'Derinlik'),
                           ('SH', 'Oturum Yüksekliği')):
                cm = re.search(r'\b%s\s*:\s*([\d.,]+)' % k, cap)
                if cm:
                    dims.append({'label': lab, 'value': f'{cm.group(1)} cm'})
            tds.append({'label': (it.get('label') or '').strip(), 'image': it.get('imageUrl'),
                        'specs': dims})
    d['bur_drawings'] = tds

    dz = json_after(buf, 'designers')
    d['designer'] = None
    if isinstance(dz, list) and dz:
        names = [re.sub(r'\s+', ' ', (x.get('title') or '')).strip() for x in dz if isinstance(x, dict)]
        names = [n for n in names if n]
        d['designer'] = ', '.join(dict.fromkeys(names)) or None

    ua = json_after(buf, 'usageAreas')
    d['usage_areas'] = [x.get('title') for x in ua if isinstance(x, dict) and x.get('title')] \
        if isinstance(ua, list) else []

    cr = json_after(buf, 'careRecommendations')
    d['care_src'] = [{'title': x.get('title'), 'text': txt(x.get('description'))}
                     for x in cr if isinstance(x, dict)] if isinstance(cr, list) else []

    aw = json_after(buf, 'awards')
    d['awards'] = [x.get('title') for x in aw if isinstance(x, dict) and x.get('title')] \
        if isinstance(aw, list) else []

    # Kartela — versiyon ekseni DEĞİL, yalnızca "hangi malzeme grupları var" bilgisi
    cg = json_after(buf, 'colorGroups')
    mats = []
    if isinstance(cg, list):
        for grp in cg:
            if isinstance(grp, dict) and grp.get('materialType'):
                n = len(grp.get('colors') or [])
                mats.append(f"{grp['materialType']} ({n} renk)" if n else grp['materialType'])
    d['color_groups'] = list(dict.fromkeys(mats))

    d['features_src'] = []
    d['specs_src'] = []
    return d


# --------------------------------------------------------------------------------------------
def scrape(url):
    host = url.split('/')[2]
    h = fetch(url)
    if 'koleksiyondesign' in host:
        return parse_koleksiyon(url, h)
    if 'casa.com.tr' in host:
        return parse_casa(url, h)
    return parse_burotime(url, h)


def main():
    print(f'{len(URLS)} URL indiriliyor (3 eşzamanlı)...\n')
    out = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
        futs = {ex.submit(scrape, u): u for u in URLS}
        for f in concurrent.futures.as_completed(futs):
            u = futs[f]
            try:
                out[u] = f.result()
            except Exception as e:
                print(f'  HATA {u}: {e}')

    rows = [out[u] for u in URLS if u in out]
    print('--- Özet ---')
    for i, r in enumerate(rows):
        extra = ''
        if r['source'] == 'koleksiyon':
            extra = f"modul={len(r['kol_variants']):2}"
        elif r['source'] == 'burotime':
            extra = f"cizim={len(r['bur_drawings']):2}"
        print(f'  [{i:02d}] {r["source"]:11} {r["title_src"][:30]:32} '
              f'gorsel={len(r["images"]):2} spec={len(r["specs_src"]):2} '
              f'dosya={len(r["files"]):2} {extra} tasarimci={str(r.get("designer"))[:22]}')

    path = os.path.join(HERE, 'output', 'batch67-raw.json')
    with open(path, 'w', encoding='utf8') as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
    print(f'\n{path} yazıldı ({len(rows)}/{len(URLS)} kayıt).')
    return 0 if len(rows) == len(URLS) else 1


if __name__ == '__main__':
    sys.exit(main())
