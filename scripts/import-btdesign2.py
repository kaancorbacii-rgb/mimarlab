#!/usr/bin/env python3
"""B&T Design 2. partisi — 17 OUTDOOR sayfası (2026-09-04, beşinci ürün partisi).

17 sayfanın tamamı DIŞ MEKAN ürünü. İkiye ayrılır:

  * 11 sayfa MEVCUT ailelere KATILIR (yeni satır AÇILMAZ): rego, rest, globe(masa+sehpa),
    elusive(masa+sehpa), sini, fly, drage, sorbe, tori. Bu satırlara `Kullanım Alanı` ekseni
    eklenir — eski versiyonlar "İç Mekan", yenileri "Dış Mekan" değerini alır. Böylece popup'ta
    tek bir hap satırıyla iç/dış mekan arasında geçilir.
  * 6 sayfa YENİ ana ürün olur: Set, Plat, Dor, Clap (kanepe), Roy (sandalye), Vivi (masa).

KATALOG DAĞITIMI (kullanıcı isteği: "tek bloğa yığma, farklı sayfalara rastgele serpiştir"):
katalog `ORDER BY id DESC` sıralı, yani ardışık id'lerle eklenen 6 ürün 1. sayfada arka arkaya
çıkardı. Bunun yerine id'ler, D1'de KULLANILMAYAN id boşluklarından ve en üstten seçilerek
kataloğun FARKLI sayfalarına düşecek şekilde dağıtılır. Boşluk id'si güvenlidir: o id'de hiç satır
yoktur, dolayısıyla ona işaret eden bir yabancı anahtar da olamaz (project_products FK'sı yalnızca
var olan satırı gösterebilir; ratings/saved_items slug tabanlıdır, hotspot'lar da slug taşır).

Kullanım:
  python3 scripts/import-btdesign2.py [--dry-run] [--skip-images]
"""

import argparse
import concurrent.futures
import importlib.util as _ilu
import json
import os
import re
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

_spec = _ilu.spec_from_file_location('import_archello_products',
                                     os.path.join(HERE, 'import-archello-products.py'))
imp = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(imp)
q, d1, d1_file = imp.q, imp.d1, imp.d1_file
http_get, to_webp, r2_put = imp.http_get, imp.to_webp, imp.r2_put
webp_width, note_derivatives = imp.webp_width, imp.note_derivatives

from PIL import Image  # noqa: E402
Image.MAX_IMAGE_PIXELS = None      # bkz. import-btdesign.py — B&T'nin A0 föyleri Pillow tavanını aşıyor

BRAND_OFFICE_ID = 770
BRAND_NAME = 'B&T Design'
R2_PREFIX = 'import/products'
MAX_STMT_BYTES, VARIANTS_CHUNK = 80_000, 40_000
MAX_GALLERY, MAX_CUTOUTS = 6, 2
USAGE_AXIS = 'Kullanım Alanı'
INDOOR, OUTDOOR = 'İç Mekan', 'Dış Mekan'
_lock = threading.Lock()

RAW = {r['slug']: r for r in json.load(
    open(os.path.join(HERE, 'output', 'btdesign2-scraped.json'), encoding='utf8'))}
DIMS = json.load(open(os.path.join(HERE, 'btdesign2-dimensions.json'), encoding='utf8'))

# --- Bu partinin sayfaları -> hedef ---------------------------------------------------------
# ('extend', <mevcut ürünün slug'ı>)  ya da  ('new', <başlık>, <kategori>)
TARGETS = {
    'rego-play-klasik-outdoor':  ('extend', 'rego-koltuk-ve-sandalye-serisi-b-t-design'),
    'rest-klasik-kollu-outdoor': ('extend', 'rest-klasik-b-t-design'),
    'globe-masa-outdoor':        ('extend', 'globe-masa-sehpa-grubu-b-t-design'),
    'globe-sehpa-outdoor':       ('extend', 'globe-masa-sehpa-grubu-b-t-design'),
    'elusive-masa-outdoor':      ('extend', 'elusive-masa-b-t-design'),
    'elusive-sehpa-outdoor':     ('extend', 'elusive-masa-b-t-design'),
    'sini-sehpa-outdoor':        ('extend', 'sini-sehpa-b-t-design'),
    'fly-sehpa-outdoor':         ('extend', 'fly-sehpa-b-t-design'),
    'drage-sehpa-outdoor':       ('extend', 'drage-sehpa-ve-ortak-oturum-ailesi-b-t-design'),
    'sorbe-puf':                 ('extend', 'sorbe-puf-b-t-design'),
    'tori-masa':                 ('extend', 'tori-masa-b-t-design'),
    'set-kanepe':   ('new', 'Set Outdoor Kanepe Serisi', 'Koltuk & Kanepe'),
    'plat-kanepe':  ('new', 'Plat Outdoor Kanepe Serisi', 'Koltuk & Kanepe'),
    'dor-kanepe':   ('new', 'Dor Outdoor Kanepe Serisi', 'Koltuk & Kanepe'),
    'clap-kanepe':  ('new', 'Clap Outdoor Kanepe Serisi', 'Koltuk & Kanepe'),
    'roy-sandalye-outdoor': ('new', 'Roy Outdoor Sandalye', 'Sandalye & Tabure'),
    'vivi-masa':    ('new', 'Vivi Outdoor Masa', 'Masa'),
}

# Föy konfigürasyon adının bölüneceği eksenler (bkz. btdesign_families.py#CONFIG_AXES aynı desen)
CONFIG_AXES = {
    'set-kanepe': ('Modül', None), 'plat-kanepe': ('Modül', None),
    'dor-kanepe': ('Modül', None), 'clap-kanepe': ('Modül', None),
    'roy-sandalye-outdoor': ('Versiyon', None), 'vivi-masa': ('Ölçü', None),
    'rego-play-klasik-outdoor': ('Ayak Tipi', 'Döşeme'),
    'rest-klasik-kollu-outdoor': ('Ayak Tipi / Döşeme', 'Kolçak'),
    'globe-masa-outdoor': ('Ölçü', None), 'globe-sehpa-outdoor': ('Ölçü', None),
    'elusive-masa-outdoor': ('Ölçü', 'Tabla Malzemesi'),
    'elusive-sehpa-outdoor': ('Ölçü', 'Tabla Malzemesi'),
    'sini-sehpa-outdoor': ('Ölçü', None), 'fly-sehpa-outdoor': ('Ölçü', None),
    'drage-sehpa-outdoor': ('Ölçü', None), 'sorbe-puf': ('Ölçü', None),
    'tori-masa': ('Ölçü', 'Tabla Malzemesi'),
}
# Aynı aileye giden İKİ sayfa varsa (Globe masa+sehpa, Elusive masa+sehpa) hangi TİP olduğu
SUBTYPE = {'globe-masa-outdoor': 'Masa', 'globe-sehpa-outdoor': 'Sehpa',
           'elusive-masa-outdoor': 'Masa', 'elusive-sehpa-outdoor': 'Sehpa'}

TR = {'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'I': 'i', 'İ': 'i', 'ö': 'o', 'Ö': 'o',
      'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u'}


def slugify(t):
    t = ''.join(TR.get(c, c) for c in (t or ''))
    return re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', t.lower()))


def num(v):
    if v is None:
        return None
    if isinstance(v, str):
        return v
    return str(int(v)) if float(v).is_integer() else f'{v:.1f}'.replace('.', ',')


def clean_name(raw):
    """h1'de ürün adının altında "OUTDOOR" rozeti de yer alıyor — ilk satır gerçek addır."""
    return (raw or '').split('\n')[0].strip()


def dim_specs(cfg):
    out = []
    for label, key in (('Genişlik', 'W'), ('Derinlik', 'D'), ('Yükseklik', 'H'),
                       ('Oturum Yüksekliği', 'SH')):
        v = cfg.get(key)
        if v is not None:
            out.append({'label': label, 'value': f'{num(v)} cm'})
    for label, v in (cfg.get('extra') or {}).items():
        if v is not None:
            out.append({'label': label, 'value': f'{num(v)} cm'
                        if not isinstance(v, str) else str(v)})
    return out


def common_specs(raw):
    out = [{'label': 'Marka', 'value': BRAND_NAME},
           {'label': 'Kullanım Alanı', 'value': 'Dış Mekan (Outdoor)'}]
    if raw.get('designer'):
        out.append({'label': 'Tasarımcı', 'value': raw['designer']})
    if raw.get('year'):
        out.append({'label': 'Tasarım Yılı', 'value': raw['year']})
    if raw.get('code'):
        out.append({'label': 'Ürün Kodu', 'value': raw['code']})
    if raw.get('tags'):
        out.append({'label': 'Malzeme Seçenekleri', 'value': ', '.join(raw['tags'])})
    return out


def split_cfg(slug, label):
    ax1, ax2 = CONFIG_AXES.get(slug, ('Versiyon', None))
    if ax2 is None or ' — ' not in label:
        return [{'label': ax1, 'value': label}]
    a, b = label.split(' — ', 1)
    return [{'label': ax1, 'value': a}, {'label': ax2, 'value': b}]


def upload_images(slug, urls, dry_run, skip):
    """R2 anahtarı bu partiye ÖZEL bir önek alır (`<slug>-outdoor`), böylece aynı ürünün önceki
    partide yazılmış `<slug>/<idx>.webp` anahtarlarıyla ÇAKIŞMAZ."""
    if skip or not urls:
        return {}
    key_base = f'{R2_PREFIX}/{slug}-outdoor'

    def one(job):
        idx, url = job
        raw = http_get(url)
        if not raw:
            return (url, None, f'indirilemedi: {url}')
        try:
            webp = to_webp(raw, imp.MAX_IMG_W)
        except Exception as ex:
            return (url, None, f'webp hatası: {ex}')
        key = f'{key_base}/{idx}.webp'
        if dry_run:
            return (url, f'/media/{key}', None)
        ok, err = r2_put(key, webp)
        if not ok:
            return (url, None, f'R2: {err}')
        with _lock:
            note_derivatives(key, webp_width(webp))
        return (url, f'/media/{key}', None)

    paths = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        for url, path, err in ex.map(one, list(enumerate(urls, start=1))):
            if err:
                print(f'    UYARI [{slug}]: {err}')
            else:
                paths[url] = path
    return paths


def spread_ids(count):
    """Kataloğun FARKLI sayfalarına düşecek, KULLANILMAYAN id'ler seç (bkz. dosya başı)."""
    rows = d1('SELECT id FROM products ORDER BY id')
    used = sorted(r['id'] for r in rows)
    gaps = []
    for a, b in zip(used, used[1:]):
        gaps.extend(range(a + 1, b))
    live = [r['id'] for r in d1('SELECT id FROM products WHERE deleted_at IS NULL '
                                'AND hidden_at IS NULL ORDER BY id DESC')]
    page_of = {pid: i // 24 + 1 for i, pid in enumerate(live)}
    # Her boşluk id'sinin hangi sayfaya düşeceğini hesapla: kendisinden BÜYÜK canlı id sayısı.
    by_page = {}
    for g in gaps:
        page = sum(1 for x in live if x > g) // 24 + 1
        by_page.setdefault(page, []).append(g)
    # SAYFA BAŞINA EN FAZLA BİR ürün: amaç "farklı sayfalara dağıt", aynı sayfaya yığmak değil.
    # Boşluklar kataloğun derinlerinde kümelendiği için (canlıda 8/15/16. sayfalar) elde edilebilen
    # DAĞITIM BUNUNLA SINIRLIDIR — kalanlar en üste (taze id, 1. sayfa) yazılır. Bunun teknik nedeni
    # kataloğun `ORDER BY id DESC` olması: 1-4. sayfalara yerleştirmek MEVCUT satırların id'lerini
    # yeniden numaralandırmayı gerektirirdi ki bu, onlara işaret eden project_products kenarlarını
    # ve canlı bağlantıları riske atardı.
    picked = []
    pages_sorted = sorted(by_page)
    step = max(1, len(pages_sorted) // max(1, count))
    for j in range(0, len(pages_sorted), step):
        if len(picked) >= count:
            break
        page = pages_sorted[j]
        picked.append((by_page[page][len(by_page[page]) // 2], page))
    while len(picked) < count:
        picked.append((None, 1))          # taze id -> kataloğun en üstü
    # Boşluk yetmezse kalanlar en üste (yeni id) eklenir.
    return picked


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--skip-images', action='store_true')
    args = ap.parse_args()

    extends = {s: t[1] for s, t in TARGETS.items() if t[0] == 'extend'}
    news = {s: t for s, t in TARGETS.items() if t[0] == 'new'}
    print(f'{len(RAW)} sayfa: {len(extends)} mevcut aileye katılacak, {len(news)} yeni ürün')

    target_slugs = ','.join(q(v) for v in set(extends.values()))
    existing = {r['slug']: r for r in d1(
        f'SELECT id, slug, title, images, variants, specs FROM products '
        f'WHERE slug IN ({target_slugs}) AND deleted_at IS NULL')}
    missing = set(extends.values()) - set(existing)
    if missing:
        raise SystemExit(f'HEDEF ÜRÜN BULUNAMADI: {sorted(missing)}')

    # ---- 1) YENİ versiyonları kur (her sayfa için) ----
    new_variants_by_target, new_images_by_target = {}, {}
    stmts, report = [], []
    for slug in RAW:
        raw = RAW[slug]
        gallery = list(dict.fromkeys(raw['gallery']))[:MAX_GALLERY]
        cutouts = list(dict.fromkeys(raw['cutouts']))[:MAX_CUTOUTS]
        ds = list(dict.fromkeys(raw['dimensionImages']))
        srcs = list(dict.fromkeys(gallery + cutouts + ds))
        paths = upload_images(slug, srcs, args.dry_run, args.skip_images)
        imgs = [paths[u] for u in srcs if u in paths]

        base = common_specs(raw)
        sub = SUBTYPE.get(slug)
        vs = []
        for cfg in DIMS[slug]['configs']:
            opts = [{'label': USAGE_AXIS, 'value': OUTDOOR}]
            if sub:
                opts.append({'label': 'Tip', 'value': sub})
            opts += split_cfg(slug, cfg['label'])
            label = f"{OUTDOOR} · {sub + ' · ' if sub else ''}{cfg['label']}"
            vs.append({'label': label, 'options': opts, 'images': imgs,
                       'specs': dim_specs(cfg) + base, 'files': raw.get('files') or [],
                       'description': raw.get('description') or raw.get('tagline') or None,
                       'sourceUrl': raw['sourceUrl']})
        tgt = TARGETS[slug]
        key = tgt[1] if tgt[0] == 'extend' else slug
        new_variants_by_target.setdefault(key, []).extend(vs)
        new_images_by_target.setdefault(key, []).extend(imgs)
        print(f"  {slug:<28} versiyon={len(vs):2} görsel={len(imgs):2} -> "
              f"{'EKLE ' + key if tgt[0] == 'extend' else 'YENİ ' + tgt[1]}")

    # ---- 2) MEVCUT satırları genişlet ----
    for tslug, row in existing.items():
        old = json.loads(row['variants'] or '[]')
        for v in old:                       # eski versiyonlar artık "İç Mekan"
            opts = [o for o in (v.get('options') or []) if o.get('label') != USAGE_AXIS]
            v['options'] = [{'label': USAGE_AXIS, 'value': INDOOR}] + opts
        merged = old + new_variants_by_target.get(tslug, [])
        imgs = list(dict.fromkeys(json.loads(row['images'] or '[]')
                                  + new_images_by_target.get(tslug, [])))[:16]
        vj = json.dumps(merged, ensure_ascii=False)
        ij = json.dumps(imgs, ensure_ascii=False)
        s1 = (f"UPDATE products SET images = {q(ij)}, variants = {q(vj)}, "
              f"updated_at = datetime('now') WHERE id = {row['id']};")
        if len(s1.encode()) <= MAX_STMT_BYTES:
            stmts.append((row['id'], [s1]))
        else:
            g = [f"UPDATE products SET images = {q(ij)}, variants = '', "
                 f"updated_at = datetime('now') WHERE id = {row['id']};"]
            for i in range(0, len(vj), VARIANTS_CHUNK):
                g.append(f"UPDATE products SET variants = variants || "
                         f"{q(vj[i:i + VARIANTS_CHUNK])} WHERE id = {row['id']};")
            stmts.append((row['id'], g))
        report.append({'slug': tslug, 'id': row['id'], 'mode': 'extend',
                       'variants': len(merged), 'added': len(merged) - len(old)})

    # ---- 3) YENİ ürünler (dağıtılmış id'lerle) ----
    picks = spread_ids(len(news)) if not args.dry_run or True else []
    for i, (slug, (_, title, cat)) in enumerate(news.items()):
        raw = RAW[slug]
        vs = new_variants_by_target[slug]
        pslug = slugify(f'{title}-{BRAND_NAME}')
        pid, page = picks[i] if i < len(picks) else (None, '?')
        imgs = json.dumps(vs[0]['images'][:10], ensure_ascii=False)
        cols = ['slug', 'kind', 'legacy_key', 'source', 'title', 'brand_office_id',
                'brand_name_raw', 'website', 'category', 'description', 'images', 'specs',
                'source_url', 'designer', 'year', 'files', 'variants']
        vals = [q(pslug), "'product'", q(f'{BRAND_NAME}|||{title}'), "'admin'", q(title),
                str(BRAND_OFFICE_ID), q(BRAND_NAME), q(raw['sourceUrl']), q(cat),
                q(raw.get('description') or raw.get('tagline')), q(imgs),
                q(json.dumps(vs[0]['specs'], ensure_ascii=False)), q(raw['sourceUrl']),
                q(raw.get('designer')), q(raw.get('year')),
                q(json.dumps(raw.get('files') or [], ensure_ascii=False)),
                q(json.dumps(vs, ensure_ascii=False))]
        if pid:
            cols.insert(0, 'id'); vals.insert(0, str(pid))
        stmts.append((pid or 0, [f"INSERT INTO products ({', '.join(cols)})\n"
                                 f"VALUES ({', '.join(vals)});"]))
        report.append({'slug': pslug, 'id': pid, 'mode': 'new', 'page': page,
                       'variants': len(vs), 'title': title})
        print(f"  YENİ {title[:32]:34} id={pid} -> katalog sayfası ~{page}")

    print(f'\n{len(stmts)} yazma işlemi')
    if args.dry_run:
        print('[dry-run] yazılmadı.')
        return 0
    for i, (_, group) in enumerate(stmts, 1):
        d1_file('\n'.join(group))      # satır başına ayrı çağrı (bkz. [[project_d1_statement_size_limit]])
        if i % 5 == 0 or i == len(stmts):
            print(f'    yazıldı {i}/{len(stmts)}')

    pend = imp._pending_derivatives
    if pend:
        now = int(time.time() * 1000)
        for i in range(0, len(pend), 200):
            rows = ',\n'.join(f'({q(k)}, {w}, {now})' for k, w in pend[i:i + 200])
            d1_file('INSERT OR IGNORE INTO image_derivative_queue (r2_key, width, created_at) '
                    f'VALUES\n{rows};\n')
        print(f'  türev kuyruğuna {len(pend)} iş yazıldı')

    out = os.path.join(HERE, 'output', 'btdesign2-import-report.json')
    json.dump(report, open(out, 'w', encoding='utf8'), ensure_ascii=False, indent=2)
    print(f'Rapor: {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
