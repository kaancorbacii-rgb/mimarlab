#!/usr/bin/env python3
"""114 ürün bağlantısı için ÜÇ KAYNAKLI kazıyıcı (2026-09-04): Archello + Nurus + Normod.

Çıktı: scripts/output/batch114-raw.json — her URL için TEK bir ham kayıt. Gruplama (aynı ürün
ailesinin varyantlarını tek ana ürün altında toplama) BU DOSYADA YAPILMAZ; o iş
scripts/batch114-build-payload.py'de, çeviri sözlüğüyle birlikte yapılır.

Kaynak başına ayrıştırma notları
--------------------------------
* **Archello** — ayrıştırıcı KOPYALANMAZ, scripts/scrape-archello-products.py'den import edilir
  (o dosya bu iş için modül olarak import edilebilir hâle getirildi). Üç kalıcı tuzağı orada
  çözülü: (1) açıklama kutusu id'ye DEĞİL `ah-product-detail-description` class'ına çapalanır,
  (2) görseller yalnızca `/product/<id>/attachments/photos-videos` sayfasından alınır — ürün
  sayfasındaki <img> taraması "More products by X" bölümündeki YABANCI ürünleri de toplar,
  (3) "Download Catalogs" kutusu ürüne özel PDF'lerle MARKA GENELİ katalogları karıştırır.

* **Nurus** — WordPress; sayfa `<section class="comp-NN">` bloklarından kurulu ve bu numaralar
  tüm ürün sayfalarında AYNI anlamı taşıyor:
    comp-1  → ürün AİLESİ adı (ör. "TOYA")
    comp-13 → hero: ailenin tanıtım metni + BU VARYANTA ait ürün render'ları (swiper)
    comp-95 → varyantın öne çıkan özellik cümleleri
    comp-96 → "Ölçü ve Malzemeler" madde listesi (Nurus ölçüleri mm/cm olarak vermiyor,
              malzeme/mekanizma maddeleri veriyor — spec satırı olarak bunlar yazılır)
    comp-12 → "Kaynaklar": GERÇEK dosya bağlantıları (DWG/MAX/3DS/SKP) — Archello'nun aksine
              lead-form arkasında DEĞİL, doğrudan indirilebilir (bkz. import betiği R2'ye alır)
    comp-97 → "Galeri": KULLANILMAZ. Bu blok referans/mekan fotoğraflarını taşıyor ve içine
              BAŞKA ürün ailelerinin (barry, han, spyke) görselleri karışmış durumda —
              Archello'daki "More products by" tuzağının Nurus'taki birebir karşılığı.
  Ürün adı `og:title`'dan alınır; Nurus onu " |" ile bitiriyor, sonek kırpılır.

* **Normod** — Shopify. HTML kazımak yerine `/products/<handle>.js` JSON ucu kullanılır: başlık,
  açıklama (ölçü tablosu HTML'i içinde), görseller, `options`/`variants` hepsi orada.
  DİKKAT: Shopify `variants` alanı KUMAŞ/AYAK RENGİ kombinasyonlarıdır (tek üründe 90 tanesi
  var) — MİMARLAB'daki "Versiyonlar" bunlar DEĞİL, kullanıcı listesindeki MODEL türevleridir
  (Tekli/İkili/Üçlü/Slim/Köşe). Renk seçenekleri burada yalnızca spec satırı olarak taşınır.

Kullanım:
  python3 scripts/scrape-batch114.py
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
sys.path.insert(0, HERE)

# 'scrape-archello-products' dosya adı tire içerdiğinden düz `import` ile alınamaz.
import importlib.util as _ilu
_spec = _ilu.spec_from_file_location('scrape_archello_products',
                                     os.path.join(HERE, 'scrape-archello-products.py'))
arch = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(arch)

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')
URLS = [l.strip() for l in open(os.path.join(HERE, 'output', 'batch114-urls.txt'), encoding='utf8')
        if l.strip()]


def fetch(url, tries=4):
    """scrape-archello-products.py#fetch ile AYNI desen — urllib bot filtrelerine takılıyor, curl geçiyor."""
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
    s = re.sub(r'<br\s*/?>', '\n', s)
    s = re.sub(r'<[^>]+>', '', s)
    return html.unescape(s).replace('\xa0', ' ').strip()


# --------------------------------------------------------------------------------------------
# Nurus
# --------------------------------------------------------------------------------------------
def nurus_section(h, name):
    """<section class="comp-NN ..."> bloğunu bir SONRAKİ <section'a kadar döndürür.

    Derinlik saymak yerine "sonraki section"a kadar kesmek yeterli: Nurus şablonu section'ları
    iç içe GEÇİRMİYOR (doğrulandı, 2026-09-04) ve bu yöntem class'a eklenen stil ekleriyle
    (ör. `comp-1 style-2`) da çalışır.
    """
    m = re.search(r'<section class="%s(?:[ "])' % re.escape(name), h)
    if not m:
        return ''
    n = h.find('<section', m.end())
    return h[m.start(): n if n > 0 else len(h)]


def block_text_lines(block):
    """Bloktaki metni <script>/<svg> gürültüsünden arındırıp SATIRLARA böler."""
    b = re.sub(r'<script.*?</script>', ' ', block, flags=re.S)
    b = re.sub(r'<svg.*?</svg>', ' ', b, flags=re.S)
    b = re.sub(r'<(?:/?(?:p|div|li|h\d|td|tr|br))\b[^>]*>', '\n', b)
    b = re.sub(r'<[^>]+>', ' ', b)
    lines = [re.sub(r'\s+', ' ', html.unescape(x)).strip() for x in b.split('\n')]
    return [x for x in lines if x]


def parse_nurus(url, h):
    d = {'source': 'nurus', 'source_url': url}

    m = re.search(r'<meta property="og:title" content="([^"]*)"', h)
    title = html.unescape(m.group(1)) if m else ''
    d['title_src'] = re.sub(r'\s*\|\s*$', '', title).strip()

    # aile adı — comp-1 (ör. "TOYA"); ailesiz ürünlerde ürünün kendi adı gelir
    fam = block_text_lines(nurus_section(h, 'comp-1'))
    d['family_src'] = fam[0] if fam else ''

    hero = nurus_section(h, 'comp-13')
    # comp-13 metni: ilk cümle bloğu ailenin tanıtımı; ardından varyant seçici etiketleri gelir
    # (ör. "Toya Alçak Sırt 5 Yıldız Ayak / Hareketli Kullanım / ..."), onlar açıklama DEĞİL —
    # yalnızca 60 karakterden uzun satırlar gerçek metindir.
    d['description_src'] = '\n\n'.join(x for x in block_text_lines(hero) if len(x) > 60)

    imgs = []
    for src in re.findall(r'<img[^>]+src="([^"]+)"', hero):
        u = html.unescape(src).split('?')[0]
        if '/wp-content/uploads/' in u and not u.lower().endswith(('.svg', '.mp4')):
            if u not in imgs:
                imgs.append(u)
    d['images'] = imgs

    # comp-95: varyantın özellik cümleleri — açıklamanın devamı olarak taşınır
    d['features_src'] = [x for x in block_text_lines(nurus_section(h, 'comp-95')) if len(x) > 30]

    # comp-96: "Ölçü ve Malzemeler" — ilk satır bölüm başlığı, ikinci satır varyant adı,
    # kalanlar malzeme/mekanizma maddeleri; "Konfigüratöre Git" bir buton, veri değil.
    mat = [x for x in block_text_lines(nurus_section(h, 'comp-96'))
           if x not in ('Ölçü ve Malzemeler', 'Konfigüratöre Git')]
    if mat and mat[0].lower().startswith(d['title_src'].lower()[:8]):
        mat = mat[1:]
    d['materials_src'] = mat

    # comp-12: gerçek indirilebilir CAD/3D dosyaları
    files, seen = [], set()
    for fm in re.finditer(r'<a class="btn-download" href="([^"]+)"[^>]*>\s*<span>(.*?)</span>',
                          nurus_section(h, 'comp-12'), re.S):
        u = html.unescape(fm.group(1))
        if u in seen:
            continue
        seen.add(u)
        name = txt(fm.group(2))
        ext = u.rsplit('.', 1)[-1].lower() if '.' in u.rsplit('/', 1)[-1] else ''
        files.append({'url': u, 'filename': f'{name}.{ext}' if ext else name,
                      'format': ext, 'size': None, 'kind': 'cad'})
    d['files'] = files

    d['brand_name'] = 'Nurus'
    d['brand_slug'] = 'nurus'
    d['brand_logo'] = None
    d['designer'] = None
    d['specs_src'] = []
    return d


# --------------------------------------------------------------------------------------------
# Normod (Shopify)
# --------------------------------------------------------------------------------------------
def parse_normod(url):
    handle = url.rstrip('/').rsplit('/', 1)[-1].split('?')[0]
    raw = fetch(f'https://normod.com/products/{handle}.js')
    j = json.loads(raw)
    d = {'source': 'normod', 'source_url': f'https://normod.com/products/{handle}',
         'title_src': j.get('title') or '', 'family_src': '',
         'brand_name': j.get('vendor') or 'Normod', 'brand_slug': 'normod',
         'brand_logo': None, 'designer': None, 'files': [], 'features_src': [],
         'materials_src': [], 'shopify_type': j.get('type') or ''}

    desc = j.get('description') or ''
    # Ölçü tablosu: <tr><td>Genişlik</td><td>108 cm</td></tr> — spec satırlarına birebir çevrilir.
    specs = []
    for tm in re.finditer(r'<tr[^>]*>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>\s*</tr>', desc, re.S):
        label, value = txt(tm.group(1)), txt(tm.group(2))
        if label and value and len(label) < 60:
            specs.append({'label': label, 'value': value})
    d['specs_src'] = specs

    # Kumaş/Ayak/Minder seçenekleri — MİMARLAB varyant ekseni DEĞİL (bkz. dosya başı notu),
    # yalnızca "hangi seçenekler var" bilgisi olarak spec satırına eklenir.
    for opt in j.get('options') or []:
        vals = [v for v in (opt.get('values') or []) if v]
        if vals and len(vals) > 1:
            d['specs_src'].append({'label': f"{opt.get('name')} Seçenekleri",
                                   'value': ', '.join(vals)})

    # Açıklama metni: tablo/görsel dışı paragraflar
    body = re.sub(r'<table.*?</table>', ' ', desc, flags=re.S)
    paras = [x for x in block_text_lines(body) if len(x) > 60]
    d['description_src'] = '\n\n'.join(dict.fromkeys(paras))

    # Görseller: Shopify tek üründe 200'ü aşkın renk kombinasyonu görseli taşıyor. Kapak
    # (featured_image) + ürünün KENDİ ilk görselleri yeterli; hepsini almak hem R2'yi hem
    # galeriyi anlamsızca şişirirdi.
    imgs, seen = [], set()
    for src in ([j.get('featured_image')] + list(j.get('images') or [])):
        if not src:
            continue
        u = ('https:' + src) if src.startswith('//') else src
        u = u.split('?')[0]
        if u in seen:
            continue
        seen.add(u)
        imgs.append(u)
    d['images'] = imgs[:8]
    return d


# --------------------------------------------------------------------------------------------
def main():
    by_host = {'archello.com': [], 'normod.com': [], 'nurus.com': []}
    for u in URLS:
        host = u.split('/')[2]
        by_host[host].append(u)
    print(f'{len(URLS)} URL — ' + ', '.join(f'{k}:{len(v)}' for k, v in by_host.items()))

    out = {}

    # --- Archello (scrape-archello-products.py'nin ayrıştırıcısı) ---
    a_urls = by_host['archello.com']
    print(f'\n1) Archello: {len(a_urls)} ürün sayfası indiriliyor...')
    pages = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
        for u, h in zip(a_urls, ex.map(arch.fetch, a_urls)):
            pages[u] = h
    pids = {}
    for u, h in pages.items():
        m = re.search(r'/product/(\d+)/attachments/', h)
        if m:
            pids[u] = m.group(1)
    print(f'   {len(pages)} sayfa, {len(set(pids.values()))} benzersiz ürün id')
    print('   attachments/photos-videos sayfaları indiriliyor...')
    pid_pages = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
        futs = {ex.submit(arch.fetch, f'https://archello.com/product/{p}/attachments/photos-videos'): p
                for p in sorted(set(pids.values()))}
        for f in concurrent.futures.as_completed(futs):
            p = futs[f]
            try:
                pid_pages[p] = f.result()
            except Exception as e:
                print(f'   UYARI: {p} foto sayfası alınamadı: {e}')
    for u in a_urls:
        r = arch.parse(u, pages[u], pid_pages)
        r['source'] = 'archello'
        r['title_src'] = r.pop('title_en')
        r['description_src'] = r.pop('description_en')
        r['specs_src'] = r.pop('specs_en')
        r['family_src'] = ''
        r['features_src'] = []
        r['materials_src'] = []
        out[u] = r

    # --- Nurus ---
    n_urls = by_host['nurus.com']
    print(f'\n2) Nurus: {len(n_urls)} sayfa...')
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
        for u, h in zip(n_urls, ex.map(fetch, n_urls)):
            out[u] = parse_nurus(u, h)

    # --- Normod ---
    m_urls = by_host['normod.com']
    print(f'\n3) Normod: {len(m_urls)} Shopify JSON...')
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
        for u, r in zip(m_urls, ex.map(parse_normod, m_urls)):
            out[u] = r

    print('\n--- Özet ---')
    rows = [out[u] for u in URLS]
    for i, r in enumerate(rows):
        print(f'  [{i:03d}] {r["source"]:8} {r["title_src"][:44]:46} '
              f'marka={str(r.get("brand_name"))[:14]:15} görsel={len(r["images"]):2} '
              f'spec={len(r["specs_src"]):2} dosya={len(r["files"]):2}')

    path = os.path.join(HERE, 'output', 'batch114-raw.json')
    with open(path, 'w', encoding='utf8') as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
    print(f'\n{path} yazıldı ({len(rows)} kayıt).')


if __name__ == '__main__':
    main()
