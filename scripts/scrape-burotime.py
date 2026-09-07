#!/usr/bin/env python3
"""Bürotime (burotime.com) — 183 kurumsal ürün sayfasının ham kazıması (2026-09-07).

Site Next.js App Router + Strapi. HTML sınıf adları her derlemede değişen hash'ler taşıdığından
onlara ÇAPA ATILMAZ; bunun yerine `self.__next_f.push([1,"..."])` RSC "flight" akışı birleştirilip
sayfanın React bileşenlerine geçirilen PROP NESNELERİ (`["$","$L12e",null,{...}]`) tek tek JSON
olarak çözülür ve anahtar kümelerine göre tanınır. Sayfa Türkçe geldiği için ÇEVİRİ GEREKMEZ.

scripts/scrape-batch67.py#parse_burotime'ın halefi. O dosya `json_after(buf, key)` ile flight
metnindeki İLK `"key":` eşleşmesini alıyordu; bu sayfalarda `"description"` 55 kez, `"products"`
onlarca kez geçtiğinden hangi bileşene ait olduğu GARANTİ DEĞİL. Prop-nesnesi tanıma yöntemi
(anahtar kümesi eşleştirmesi) bu belirsizliği ortadan kaldırır ve ayrıca eski yolun hiç okumadığı
üç alanı kazanır: `tabs.specifications` (malzeme/teknik metin), `familyTitle` + aile üyeleri
(kaynağın KENDİ aile tanımı) ve `quote` (tasarımcı ağzından tasarım hikâyesi).

ÖLÇÜ AYRIŞTIRMADAKİ GERÇEK HATA (bu dosyada düzeltildi)
-------------------------------------------------------
`technicalDrawings[].caption` İKİ FARKLI biçimde geliyor:
    "H:82\nW:98\nL:150"                       (İngilizce kısaltma — Stripe, Hey! Kanepe)
    "Yükseklik:74\nGenişlik:90\nUzunluk:180"  (Türkçe tam ad — Opera, Throne Puf, T50)
scrape-batch67.py yalnızca birinci biçimi tanıyordu; ikinci biçimdeki sayfaların TÜM ölçüleri
sessizce düşüyordu (canlıdaki products#455 Opera'nın üç versiyonunda da tek bir ölçü satırı yok).
Burada iki biçim de tanınır ve Türkçe biçimde etiket KAYNAKTAKİ HALİYLE korunur — "Genişlik"i
"Derinlik"e çevirmek gibi bir yeniden yorumlama YAPILMAZ (masalarda kaynak "Genişlik"i derinlik,
"Uzunluk"u uzun kenar anlamında kullanıyor; kendi yorumumuzu yazmak veriyi bozardı).

Çıktı: scripts/output/burotime-raw.json — {url: kayıt}. Aile birleştirme BURADA YAPILMAZ
(scripts/burotime-groups.py + burotime-build-payload.py'nin işi).

Kullanım: python3 scripts/scrape-burotime.py [--workers 4] [--only slug,slug]
"""
import argparse
import concurrent.futures
import html
import json
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
URLS_FILE = os.path.join(HERE, 'output', 'burotime-urls.txt')
OUT = os.path.join(HERE, 'output', 'burotime-raw.json')
CACHE = os.path.join(HERE, 'output', 'burotime-html')

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/125.0 Safari/537.36')

_DEC = json.JSONDecoder()


def fetch(url, tries=4):
    """urllib bot filtresine takılıyor, curl geçiyor (scrape-batch67.py#fetch ile aynı desen)."""
    last = None
    for n in range(tries):
        p = subprocess.run(['curl', '-sL', '--compressed', '-A', UA, '-H', 'Accept-Language: tr,en',
                            '-w', '\n%{http_code}', '--max-time', '90', url], capture_output=True)
        out = p.stdout.decode('utf8', 'replace')
        body, _, code = out.rpartition('\n')
        if p.returncode == 0 and code.strip() == '200' and len(body) > 20000:
            return body
        last = f'http={code.strip()} rc={p.returncode} len={len(body)}'
        time.sleep(2.0 * (n + 1))
    raise RuntimeError(f'{url}: {last}')


def txt(s):
    s = re.sub(r'<br\s*/?>', '\n', s or '')
    s = re.sub(r'</p\s*>', '\n\n', s)
    s = re.sub(r'<[^>]+>', ' ', s)
    s = html.unescape(s).replace('\xa0', ' ')
    s = re.sub(r'[ \t]+', ' ', s)
    return re.sub(r'\n{3,}', '\n\n', s).strip()


def flight(h):
    """`self.__next_f.push([1,"<parça>"])` akışını tek metinde birleştirir (Next.js RSC)."""
    buf = ''
    for c in re.findall(r'self\.__next_f\.push\(\[1,(".*?")\]\)</script>', h, re.S):
        try:
            buf += json.loads(c)
        except Exception:
            pass
    return buf


def lazy_chunks(buf):
    """RSC "lazy" metin parçaları: `12f:T4ac,<metin>` (uzunluk ONALTILIK ve BAYT cinsinden).

    GERÇEK BULGU (2026-09-07): iki sayfanın (`synergy-masa`, `days`) ürün açıklaması prop
    nesnesinde düz metin değil `"description":"$12f"` referansı olarak geliyor. Referans
    çözülmezse D1'e açıklama olarak dört karakterlik `$12f` yazılırdı — ilk turda tam olarak bu
    oldu ve payload denetiminde yakalandı.
    """
    table = {}
    for m in re.finditer(r'(?m)^([0-9a-f]{1,4}):T([0-9a-f]+),', buf):
        start = m.end()
        nbytes = int(m.group(2), 16)
        tail = buf[start:].encode('utf8', 'surrogatepass')[:nbytes]
        table[m.group(1)] = tail.decode('utf8', 'replace')
    for m in re.finditer(r'(?m)^([0-9a-f]{1,4}):(".*)$', buf):
        if m.group(1) in table:
            continue
        try:
            table[m.group(1)] = _DEC.raw_decode(m.group(2))[0]
        except Exception:
            pass
    return table


def deref(val, table):
    """`"$12f"` biçimli RSC referansını çözer; referans değilse değeri aynen döndürür."""
    if isinstance(val, str) and re.fullmatch(r'\$[0-9a-f]{1,4}', val):
        return table.get(val[1:], '')
    return val


def component_props(buf):
    """Flight akışındaki `["$","$L<id>",null,{...}]` prop nesnelerini JSON olarak çözer.

    Bileşen kimliği (`$L12e`) her derlemede değiştiğinden ONA ÇAPA ATILMAZ — dönen nesneler
    ANAHTAR KÜMESİNE göre tanınır (bkz. parse()).
    """
    out = []
    for m in re.finditer(r'\["\$","\$L[0-9a-f]+",null,', buf):
        i = buf.find('{', m.end() - 1)
        if i < 0:
            continue
        try:
            v, _ = _DEC.raw_decode(buf, i)
        except Exception:
            continue
        if isinstance(v, dict):
            out.append(v)
    return out


# caption ölçü ayrıştırması — bkz. dosya başı "ÖLÇÜ AYRIŞTIRMADAKİ GERÇEK HATA".
_ABBR_DIM = [('SH', 'Oturum Yüksekliği'), ('AH', 'Kolçak Yüksekliği'),
             ('H', 'Yükseklik'), ('W', 'Derinlik'), ('D', 'Derinlik'), ('L', 'Genişlik')]
_TR_DIM_KEYS = ('Yükseklik', 'Genişlik', 'Derinlik', 'Uzunluk', 'Oturum Yüksekliği',
                'Kolçak Yüksekliği', 'Çap', 'Sırt Yüksekliği')


def parse_caption(cap):
    """"H:82\\nW:98" ya da "Yükseklik:74\\nGenişlik:90" -> [{label,value}] (cm)."""
    cap = (cap or '').replace('\\n', '\n')
    dims, seen = [], set()
    # Önce Türkçe tam adlar (kısaltma regex'i "Yükseklik" içindeki 'H'yi yakalamaz ama
    # "Derinlik"teki 'D'yi de yakalamamalı — bu yüzden Türkçe tarama ÖNCE yapılır ve
    # eşleşen parçalar metinden düşürülür).
    rest = cap
    for key in _TR_DIM_KEYS:
        m = re.search(re.escape(key) + r'\s*:\s*([0-9][0-9.,/x×\- ]*)', rest)
        if m:
            val = m.group(1).strip().rstrip('.,')
            if key not in seen and val:
                seen.add(key)
                dims.append({'label': key, 'value': f'{val} cm'})
            rest = rest[:m.start()] + rest[m.end():]
    for abbr, label in _ABBR_DIM:
        m = re.search(r'(?<![A-Za-zĞÜŞİÖÇğüşıöç])' + abbr + r'\s*:\s*([0-9][0-9.,/x×\- ]*)', rest)
        if m:
            val = m.group(1).strip().rstrip('.,')
            if label not in seen and val:
                seen.add(label)
                dims.append({'label': label, 'value': f'{val} cm'})
            rest = rest[:m.start()] + rest[m.end():]
    return dims


def parse(url, h):
    buf = flight(h)
    lazy = lazy_chunks(buf)
    props = component_props(buf)
    d = {'source': 'burotime', 'source_url': url, 'brand_name': 'Bürotime',
         'slug': url.rstrip('/').rsplit('/', 1)[-1]}

    main = gallery = colors = awards = quote = family = related = None
    for p in props:
        ks = set(p.keys())
        if main is None and 'tabs' in ks and 'productType' in ks:
            main = p
        elif gallery is None and ks == {'backgroundColor', 'gallery'}:
            gallery = p
        elif colors is None and ks == {'colorGroups'}:
            colors = p
        elif awards is None and ks == {'awards'}:
            awards = p
        elif quote is None and ks == {'quote'}:
            quote = p
        elif family is None and {'familyTitle', 'products'} <= ks and 'banner' in ks:
            family = p
        elif related is None and ks == {'labelKey', 'products'}:
            related = p

    if main is None:
        raise RuntimeError('ürün prop bloğu bulunamadı (tabs+productType)')

    tabs = main.get('tabs') or {}
    d['title_src'] = (main.get('name') or '').strip()
    # h1 = "<span class=font-billie>Opera</span><span> Yönetici Masası</span>" — aile adı + alt
    # başlık. `name` alanı ("Opera Yönetici") kanonik olduğundan başlık ondan alınır; h1'in ikinci
    # yarısı yalnızca ÜRÜN ALT TİPİ ipucu olarak saklanır.
    m = re.search(r'"__html":"\s*<span class=\\"font-billie\\"><span>(.*?)</span></span>(.*?)"', buf)
    d['h1_family'] = txt(m.group(1).replace('\\"', '"')) if m else None
    d['h1_suffix'] = txt(m.group(2).replace('\\"', '"')) if m else None
    if not d['title_src']:
        mm = re.search(r'<meta property="og:title" content="([^"]*)"', h)
        d['title_src'] = html.unescape(mm.group(1)).strip() if mm else d['slug']

    pt = main.get('productType') or {}
    d['product_type'] = pt.get('title') if isinstance(pt, dict) else None

    d['description_src'] = txt(deref(tabs.get('description'), lazy))
    d['specifications_src'] = txt(deref(tabs.get('specifications'), lazy))

    d['designer'] = ', '.join(dict.fromkeys(
        re.sub(r'\s+', ' ', (x.get('title') or '')).strip()
        for x in (main.get('designers') or []) if isinstance(x, dict) and x.get('title'))) or None

    d['usage_areas'] = [x['title'] for x in (main.get('usageAreas') or [])
                        if isinstance(x, dict) and x.get('title')]
    d['care_src'] = [{'title': x.get('title'), 'text': txt(x.get('description'))}
                     for x in (main.get('careRecommendations') or []) if isinstance(x, dict)]

    # Dosyalar (PDF föy / RAR CAD arşivi) — R2'ye ALINMAZ, dış bağlantı yazılır (batch67'deki
    # aynı gerekçe: tek bir SKP arşivi 1.8 GB).
    files = []
    for it in (tabs.get('documents') or []):
        if not isinstance(it, dict) or not it.get('fileUrl'):
            continue
        ext = (it.get('fileExt') or '').lower()
        kb = it.get('fileSize')
        title = (it.get('title') or 'Döküman').strip()
        files.append({'url': it['fileUrl'],
                      'filename': f'{title}.{ext}' if ext else title,
                      'format': ext or None,
                      'size': int(kb * 1024) if isinstance(kb, (int, float)) else None,
                      'kind': 'cad' if ext in ('rar', 'zip', 'dwg', 'skp', '3ds') else 'spec'})
    # Kaynakta AYNI ADI taşıyan farklı dosyalar var (swan-*: "Swan 3d Dwg" iki kez — 15 MB ve
    # 31 MB, iki ayrı arşiv). Aynı adresi tekrarlayanlar elenir; adı çakışıp adresi FARKLI olanlar
    # ise korunur ve ayırt edilebilsin diye numaralanır (indirme listesinde iki özdeş satır
    # kullanıcıya hangisinin hangisi olduğunu söylemiyordu).
    seen_urls, seen_names, uniq = set(), {}, []
    for f in files:
        if f['url'] in seen_urls:
            continue
        seen_urls.add(f['url'])
        n = seen_names.get(f['filename'], 0) + 1
        seen_names[f['filename']] = n
        if n > 1:
            stem, _, ext = f['filename'].rpartition('.')
            f['filename'] = f'{stem} ({n}).{ext}' if stem else f'{f["filename"]} ({n})'
        uniq.append(f)
    d['files'] = uniq

    # Teknik çizimler = MODÜL adayları (etiket + ölçülendirilmiş çizim + ölçüler).
    drawings = []
    for it in (tabs.get('technicalDrawings') or []) + (tabs.get('cadImages') or []):
        if not isinstance(it, dict):
            continue
        label = (it.get('label') or it.get('alt') or '').strip()
        if not label:
            continue
        drawings.append({'label': label, 'image': it.get('imageUrl'),
                         'specs': parse_caption(it.get('caption')),
                         'caption': (it.get('caption') or '').replace('\\n', '\n')})
    d['drawings'] = drawings

    imgs = []
    for it in ((gallery or {}).get('gallery') or []):
        if isinstance(it, dict) and it.get('desktopImageUrl'):
            imgs.append(it['desktopImageUrl'])
    mm = re.search(r'<meta property="og:image" content="([^"]*)"', h)
    if mm:
        imgs.append(html.unescape(mm.group(1)))
    d['images'] = [u for u in dict.fromkeys(imgs) if u]

    # Kartela — versiyon EKSENİ DEĞİL, "hangi malzeme grupları var" künye satırı.
    mats = []
    for grp in ((colors or {}).get('colorGroups') or []):
        if isinstance(grp, dict) and grp.get('materialType'):
            n = len(grp.get('colors') or [])
            mats.append(f"{grp['materialType']} ({n} renk)" if n else grp['materialType'])
    d['color_groups'] = list(dict.fromkeys(mats))

    d['awards'] = [x['title'] for x in ((awards or {}).get('awards') or [])
                   if isinstance(x, dict) and x.get('title')]

    qq = (quote or {}).get('quote') or {}
    qtext = txt(deref(qq.get('quote'), lazy)).strip()
    # Kaynakta boş/tek karakterlik alıntılar var (zoom-saksi: 2 karakter) — anlamlı olmayanı at.
    d['quote'] = {'text': qtext, 'author': (qq.get('author') or '').strip()} if len(qtext) > 60 else None

    d['family_title'] = (family or {}).get('familyTitle')
    d['family_members'] = [x['slug'] for x in ((family or {}).get('products') or [])
                           if isinstance(x, dict) and x.get('slug')]
    d['related'] = [x['slug'] for x in ((related or {}).get('products') or [])
                    if isinstance(x, dict) and x.get('slug')]
    return d


def scrape_one(url, use_cache=True):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, url.rstrip('/').rsplit('/', 1)[-1] + '.html')
    h = None
    if use_cache and os.path.exists(path) and os.path.getsize(path) > 20000:
        h = open(path, encoding='utf8', errors='replace').read()
    if h is None:
        h = fetch(url)
        open(path, 'w', encoding='utf8').write(h)
    return parse(url, h)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--no-cache', action='store_true')
    ap.add_argument('--only')
    args = ap.parse_args()

    urls = [l.strip() for l in open(URLS_FILE, encoding='utf8') if l.strip()]
    if args.only:
        keep = set(args.only.split(','))
        urls = [u for u in urls if u.rsplit('/', 1)[-1] in keep]

    results, errors = {}, {}
    print(f'{len(urls)} URL kazınacak ({args.workers} eşzamanlı)...')
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(scrape_one, u, not args.no_cache): u for u in urls}
        done = 0
        for fut in concurrent.futures.as_completed(futs):
            u = futs[fut]
            done += 1
            try:
                d = fut.result()
            except Exception as e:
                errors[u] = str(e)
                print(f'[{done}/{len(urls)}] {u.rsplit("/",1)[-1]:26} HATA: {e}')
                continue
            results[u] = d
            print(f'[{done}/{len(urls)}] {u.rsplit("/",1)[-1]:26} '
                  f'{d["title_src"][:24]:26} gorsel={len(d["images"]):2} cizim={len(d["drawings"]):2} '
                  f'dosya={len(d["files"]):2} tip={str(d["product_type"])[:14]:15} '
                  f'aile={str(d["family_title"])[:18]:20} dsn={str(d["designer"])[:22]}')

    ordered = {u: results[u] for u in urls if u in results}
    json.dump(ordered, open(OUT, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print(f'\n{len(ordered)}/{len(urls)} kayıt -> {OUT}')
    if errors:
        print(f'HATALI ({len(errors)}):')
        for u, e in errors.items():
            print(f'  {u}: {e}')
    noimg = [u for u, d in ordered.items() if not d['images']]
    if noimg:
        print(f'GÖRSELSİZ ({len(noimg)}): ' + ', '.join(u.rsplit("/", 1)[-1] for u in noimg))
    nodesc = [u for u, d in ordered.items() if not d['description_src']]
    if nodesc:
        print(f'AÇIKLAMASIZ ({len(nodesc)}): ' + ', '.join(u.rsplit("/", 1)[-1] for u in nodesc))
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
