#!/usr/bin/env python3
"""Archello ürün kazıyıcı v2 — kanonik çapalara dayalı, iki sayfa düzenini de destekler.

v1'in üç hatası burada düzeltildi:
  1. Görseller: v1 fallback'i "More products by X" bölümündeki YABANCI ürün görsellerini de
     topluyordu (thara: 3 gerçek + 14 yabancı). v2 tek yetkili kaynak olarak
     /product/<id>/attachments/photos-videos sayfasını kullanır.
  2. Dosyalar: v1 fallback'i yine yabancı ürünlerin download linklerini topluyordu. v2 yalnızca
     #product-brochure-company ve .ah-product-detail-files bloklarını okur (ikisi de bu ürüne ait).
  3. Açıklama: SNOC düzeninde (#ah-product-page-grid__main) v1'in aradığı grid__content kutusu YOK.
     v2 iki düzende de bulunan #product-description'ı kullanır.
"""
import json, os, re, html, subprocess, time, concurrent.futures

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')
HERE = os.path.dirname(os.path.abspath(__file__))
URLS = [l.strip() for l in open(os.path.join(HERE, 'output', 'archello-products-urls.txt'), encoding='utf8') if l.strip()]


def fetch(url, tries=4):
    last = None
    for n in range(tries):
        p = subprocess.run(['curl', '-sL', '--compressed', '-A', UA, '-H', 'Accept-Language: en',
                            '-w', '\n%{http_code}', '--max-time', '60', url], capture_output=True)
        out = p.stdout.decode('utf8', 'replace')
        body, _, code = out.rpartition('\n')
        if p.returncode == 0 and code.strip() == '200' and len(body) > 3000:
            return body
        last = f'http={code.strip()} rc={p.returncode} len={len(body)}'
        time.sleep(1.5 * (n + 1))
    raise RuntimeError(last)


def txt(s):
    s = re.sub(r'<br\s*/?>', '\n', s)
    s = re.sub(r'<[^>]+>', '', s)
    return html.unescape(s).replace('\xa0', ' ').strip()


def slice_div(h, start_pat):
    """start_pat eşleşmesinden başlayıp <div> derinliği 0'a dönene kadar olan bloğu döndürür."""
    m = re.search(start_pat, h)
    if not m:
        return ''
    i = m.start()
    depth, j = 0, i
    for tm in re.finditer(r'<div\b|</div>', h[i:]):
        depth += 1 if tm.group(0) != '</div>' else -1
        if depth == 0:
            j = i + tm.end()
            break
    return h[i:j]


def parse(url, h, pid_pages):
    d = {'source_url': url}
    m = re.search(r'<h1[^>]*>(.*?)</h1>', h, re.S)
    d['title_en'] = re.sub(r'\s+', ' ', txt(m.group(1))).strip() if m else ''

    m = re.search(r'/product/(\d+)/attachments/', h)
    d['product_id'] = m.group(1) if m else None
    pid = d['product_id']

    # --- açıklama ---
    # ID'ye DEĞİL class'a çapalanır: Landscape Forms düzeninde açıklama kutusunun id'si
    # "pjax-product-description", üstelik aynı sayfada "More products by" sarmalayıcısının id'si
    # "product-description" — id'ye bakan bir çapa sessizce YANLIŞ kutuyu (0 paragraf) seçiyordu.
    # ah-product-detail-description class'ı üç düzende de açıklama kutusunda ve YALNIZCA orada.
    dblock = slice_div(h, r'<div[^>]*class="[^"]*ah-product-detail-description[^"]*"[^>]*>')
    # sayfaya sızmış yabancı <article> bloğunu (Archello editör artığı) kes
    dblock = re.split(r'<article\b', dblock)[0]
    paras = []
    for pm in re.finditer(r'<p[^>]*>(.*?)</p>', dblock, re.S):
        t = txt(pm.group(1))
        if t and len(t) > 1:
            paras.append(t)
    d['description_en'] = '\n\n'.join(paras)

    # açıklama gövdesindeki figürler de bu ürünün görselleridir
    body_imgs = []
    for fm in re.finditer(r'<figure class="image[^"]*"><img[^>]+src="([^"]+)"', dblock):
        body_imgs.append(html.unescape(fm.group(1)).split('?')[0])

    # --- görseller: yetkili kaynak = attachments/photos-videos ---
    gallery = []
    if pid and pid in pid_pages:
        ph = pid_pages[pid]
        for um in re.finditer(r'(https://archello\.com/thumbs/images/[^"?\s]+)', ph):
            u = html.unescape(um.group(1))
            if u not in gallery:
                gallery.append(u)
    for u in body_imgs:
        if u not in gallery:
            gallery.append(u)
    d['images'] = gallery

    # --- marka ---
    m = re.search(r'grid-item-label">Manufacturer</div><div class="ah-epd__grid-item-value">'
                  r'<a[^>]+href="/brand/([^"]+)"[^>]*>(.*?)</a>', h, re.S)
    if m:
        d['brand_slug'], d['brand_name'] = m.group(1), txt(m.group(2))
    else:
        m = re.search(r'class="ah-product-page-brand__name-text"[^>]*href="/brand/([^"]+)"[^>]*>(.*?)</a>', h, re.S)
        d['brand_slug'] = m.group(1) if m else None
        d['brand_name'] = txt(m.group(2)) if m else None
    m = re.search(r'class="ah-product-page-brand__logo-img lazy"[^>]+src="([^"]+)"', h)
    d['brand_logo'] = html.unescape(m.group(1)).split('?')[0] if m else None

    # --- spesifikasyonlar ---
    specs = []
    sblock = slice_div(h, r'<div id="product-specification">')
    for im in re.finditer(r'<div class="ah-epd__grid-item"><div class="ah-epd__grid-item-label">(.*?)</div>'
                          r'<div class="ah-epd__grid-item-value">(.*?)</div></div>', sblock, re.S):
        label, value = txt(im.group(1)), re.sub(r'\s+', ' ', txt(im.group(2)))
        if label and value:
            specs.append({'label': label, 'value': value})
    d['specs_en'] = specs

    # --- tasarımcı ---
    designer = next((s['value'] for s in specs if s['label'].lower() == 'designer'), None)
    # Archello verisi bozuk olabiliyor (Soleva Sunbed'in "Designer" satırı ÜRÜN ADINI tekrarlıyor)
    if designer and designer.strip().lower() == d['title_en'].strip().lower():
        designer = None
    if not designer:
        pm = re.search(r'\bDesigned by ([A-Z][A-Za-zÀ-ÿ.\'’-]+(?: [A-Z][A-Za-zÀ-ÿ.\'’-]+){0,3})',
                       d['description_en'])
        if pm:
            designer = pm.group(1).strip()
    d['designer'] = designer

    # --- kategoriler ---
    cats = []
    for cm in re.finditer(r'href="/products/([a-z0-9\-]+)/guide"[^>]*>(.*?)</a>', h):
        c = txt(cm.group(2))
        if c and c not in cats:
            cats.append(c)
    d['archello_categories'] = cats

    # --- broşürler (PDF) — yalnızca bu ürünün bloğu ---
    files = []
    bblock = slice_div(h, r'<div id="product-brochure-company"')
    for cm in re.finditer(r'<div class="ah-product-detail-catalog-item"[^>]*>(.*?)</a>', bblock, re.S):
        blk = cm.group(1)
        hm = re.search(r'href="([^"]+)"', blk)
        tm = re.search(r'catalog-item__title">(.*?)</h5>', blk, re.S)
        wm = re.search(r'catalog-item__weight">(.*?)</div>', blk, re.S)
        if hm:
            name = txt(tm.group(1)) if tm else None
            files.append({'url': 'https://archello.com' + html.unescape(hm.group(1)),
                          'filename': name,
                          'format': (name.rsplit('.', 1)[-1].lower() if name and '.' in name else 'pdf'),
                          'size': txt(wm.group(1)) if wm else None,
                          'kind': 'brochure'})

    # --- BIM & CAD dosyaları ---
    fblock = slice_div(h, r'<div class="ah-product-detail-files">')
    for fm in re.finditer(r'href="/product/(\d+)/attachments/files\?extension=([a-z0-9]+)"(.*?)</a>',
                          fblock, re.S):
        ext, tail = fm.group(2), fm.group(3)
        cm = re.search(r'<b[^>]*>\s*(\d+)\s*</b>', tail)
        count = int(cm.group(1)) if cm else 1
        for pos in range(1, count + 1):
            files.append({
                'url': f'https://archello.com/attachment/product/download-document'
                       f'?id={pid}&category=files&position={pos}&bim_cad=1',
                'filename': None, 'format': ext, 'size': None, 'kind': 'bim_cad'})
    d['files'] = files
    return d


def main():
    print('1) Ürün sayfaları indiriliyor...')
    pages = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
        for u, h in zip(URLS, ex.map(fetch, URLS)):
            pages[u] = h

    pids = {}
    for u, h in pages.items():
        m = re.search(r'/product/(\d+)/attachments/', h)
        if m:
            pids[u] = m.group(1)
    print(f'   {len(pages)} sayfa, {len(set(pids.values()))} benzersiz ürün id')

    print('2) attachments/photos-videos sayfaları indiriliyor...')
    uniq = sorted(set(pids.values()))
    pid_pages = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
        futs = {ex.submit(fetch, f'https://archello.com/product/{p}/attachments/photos-videos'): p
                for p in uniq}
        for f in concurrent.futures.as_completed(futs):
            p = futs[f]
            try:
                pid_pages[p] = f.result()
            except Exception as e:
                print(f'   UYARI: {p} foto sayfası alınamadı: {e}')

    print('3) Ayrıştırılıyor...')
    out = []
    for i, u in enumerate(URLS):
        r = parse(u, pages[u], pid_pages)
        out.append(r)
        print(f'  [{i:02d}] {r["title_en"]!r:52} marka={r["brand_name"]!r:18} '
              f'görsel={len(r["images"])} spec={len(r["specs_en"])} dosya={len(r["files"])} '
              f'tasarımcı={r["designer"]!r}')

    with open(os.path.join(HERE, 'output', 'archello-products-raw.json'), 'w', encoding='utf8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print('\nscripts/output/archello-products-raw.json yazıldı.')


main()
