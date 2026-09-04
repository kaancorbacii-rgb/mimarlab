#!/usr/bin/env python3
"""B&T Design partisi — 62 ANA ÜRÜN + 403 VERSİYON içe aktarımı (2026-09-04, dördüncü parti).

`import-batch67.py`'nin devamı; yardımcılar (d1/r2_put/to_webp/türev kuyruğu…) yine
`import-archello-products.py`'den modül olarak import edilir — tek kaynak orasıdır.

Bu betiğin batch67'den AYRILDIĞI üç nokta
-----------------------------------------

1. **Marka AÇILMAZ.** B&T Design D1'de zaten kayıtlı (offices.id=770, slug `b-t-design`) ve
   about/logo/kapak/website alanlarının HEPSİ dolu. Bu yüzden `sync_brands` adımı yok; yalnızca
   satırın hâlâ orada olduğu doğrulanır ve tüm ürünler bu id'ye bağlanır. (batch67'de yeni marka
   açma yolu vardı; burada çalıştırılsaydı "tüm alanlar dolu, dokunulmayacak" deyip geçerdi —
   yine de yanlışlıkla ikinci bir `b-t-design` satırı açma riskini tamamen kaldırmak için
   adım tümden kaldırıldı.)

2. **Dekupe (saydam) PNG oranı YÜKSEK.** 960 kaynağın 449'u `image-resize/dekupe/...` altında
   saydam zeminli ürün render'ı. `imp.to_webp` bunları BEYAZA yapıştırır — bu davranış
   batch67'de eklendi ve orada 621 kaynağın 192'sini kurtarmıştı; burada oran çok daha yüksek
   olduğu için import sonrası `--verify-alpha` ile ÖRNEKLEME yapılır (siyah siluet kontrolü).

3. **Ürün başına görsel tekilleştirme** batch67 ile aynı: bir sayfanın galerisi o sayfanın TÜM
   konfigürasyonlarında paylaşıldığından (403 versiyon × ~9 kare = ~3.600 yükleme yerine 960
   benzersiz kare) kaynak URL başına tek yükleme yapılır.

Kullanım:
  python3 scripts/import-btdesign.py --payload scripts/output/btdesign-payload.json \
      [--dry-run] [--skip-images]
"""

import argparse
import concurrent.futures
import importlib.util as _ilu
import json
import os
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

_spec = _ilu.spec_from_file_location('import_archello_products',
                                     os.path.join(HERE, 'import-archello-products.py'))
imp = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(imp)

q = imp.q
d1 = imp.d1
d1_file = imp.d1_file
fold_tr = imp.fold_tr
http_get = imp.http_get
to_webp = imp.to_webp
r2_put = imp.r2_put
webp_width = imp.webp_width
note_derivatives = imp.note_derivatives

from btdesign_families import BRAND_NAME, BRAND_OFFICE_ID  # noqa: E402

R2_PREFIX = 'import/products'
_lock = threading.Lock()

# Pillow'un "decompression bomb" koruması B&T'nin BÜYÜK teknik föylerini reddediyor: Matt'in
# modül föyü 12402x17539 = 217,5 MP ve Pillow'un varsayılan tavanı 179 MP. Bu bir saldırı değil,
# markanın kendi A0 boyutundaki ölçü çizimi — 2026-09-04 ilk koşusunda TEK başarısız görsel buydu
# (import/products/matt-.../11.webp). Sınır kaldırılır; to_webp zaten MAX_IMG_W'ye küçültüyor.
def _lift_pillow_bomb_limit():
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None


_lift_pillow_bomb_limit()

# D1'in tek ifade (statement) boyut tavanı ~100 KB; bu sınırı aşan INSERT
# `SQLITE_TOOBIG: statement too long` ile REDDEDİLİR ve TÜM parti yazılmaz (2026-09-04'te tam
# olarak bu oldu: Rego ailesinin 36 versiyonluk `variants` JSON'u 116 KB). Bu tavanın altında
# kalan ürünler tek INSERT ile yazılır; aşanlar için satır önce `variants = ''` ile açılır, sonra
# JSON `||` ile parça parça eklenir (bkz. build_statements).
MAX_STMT_BYTES = 80_000
VARIANTS_CHUNK = 40_000


def safe_url(url):
    """URL yolundaki BOŞLUKLARI yüzde-kodlar (batch67 ile aynı gerekçe)."""
    return url.replace(' ', '%20') if ' ' in url else url


# --------------------------------------------------------------------------------------------
# Görseller — ÜRÜN başına kaynak URL'i tekilleştirilerek
# --------------------------------------------------------------------------------------------
def upload_product_images(it, dry_run, skip_images, reuse=False):
    """Ürünün tüm (ana + versiyon) görsellerini yükler; kaynak URL -> R2 yolu haritası döndürür.

    `reuse=True` iken HİÇBİR indirme/yükleme yapılmaz, yalnızca yol haritası yeniden kurulur.
    Bu güvenlidir çünkü R2 anahtarı DETERMİNİSTİK: `import/products/<slug>/<idx>.webp` ve idx
    yüklemeden ÖNCE `enumerate(urls, 1)` ile atanır — yani başarısız bir görsel diğerlerinin
    indisini KAYDIRMAZ. Görseller yüklendikten sonra D1 yazımı düşerse (2026-09-04: Rego'nun
    116 KB'lık INSERT'i SQLITE_TOOBIG) 880 görseli yeniden yüklemek yerine bu mod kullanılır.
    """
    urls = list(dict.fromkeys(
        list(it['images']) + [u for v in it['variants'] for u in v['srcImages']]))
    if skip_images or not urls:
        return {}

    slug = it['slug']
    if reuse:
        out = {}
        for i, u in enumerate(urls, start=1):
            key = f'{R2_PREFIX}/{slug}/{i}.webp'
            out[u] = f'/media/{key}'
            # Türev kuyruğu: reuse modunda WebP'nin gerçek genişliği elimizde YOK (dosya R2'de,
            # 880 nesneyi indirip ölçmek onlarca dakika sürerdi). Her basamağı koşulsuz kuyruğa
            # koymak GÜVENLİ, çünkü scripts/drain-derivative-queue.py#process_source kaynağı
            # kendisi okuyup `im.width <= w` olduğunda 'no-upscale' sayıp ATLIYOR — yani "asla
            # büyütme" kuralı kuyrukta değil, boşaltmada uygulanıyor.
            with _lock:
                for w in imp.DERIVATIVE_WIDTHS:
                    imp._pending_derivatives.append((key, w))
        return out

    def one(job):
        idx, url = job
        raw = http_get(safe_url(url))
        if not raw:
            return (url, None, f'indirilemedi: {url}')
        try:
            webp = to_webp(raw, imp.MAX_IMG_W)
        except Exception as ex:
            return (url, None, f'webp hatası: {ex}')
        key = f'{R2_PREFIX}/{slug}/{idx}.webp'
        if dry_run:
            return (url, f'/media/{key}', None)
        ok, err = r2_put(key, webp)
        if ok:
            with _lock:
                note_derivatives(key, webp_width(webp))
            return (url, f'/media/{key}', None)
        return (url, None, f'R2: {err}')

    paths = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        for url, path, err in ex.map(one, list(enumerate(urls, start=1))):
            if err:
                print(f'    UYARI [{slug}]: {err}')
            else:
                paths[url] = path
    return paths


def flush_derivatives_chunked(dry_run, chunk=200):
    """imp.flush_derivative_queue'nun PARÇALI hâli (D1 tek INSERT'te ~1.700 VALUES kabul etmiyor)."""
    pend = imp._pending_derivatives
    if not pend:
        return 0
    if dry_run:
        print(f'  [dry-run] türev kuyruğuna {len(pend)} iş yazılmazdı.')
        return 0
    now = int(time.time() * 1000)
    total = len(pend)
    for i in range(0, total, chunk):
        rows = ',\n'.join(f'({q(k)}, {w}, {now})' for k, w in pend[i:i + chunk])
        d1_file('INSERT OR IGNORE INTO image_derivative_queue (r2_key, width, created_at) VALUES\n'
                + rows + ';\n')
        print(f'    kuyruk {min(i + chunk, total)}/{total}')
    pend.clear()
    print(f'  türev kuyruğuna {total} iş yazıldı — boşaltmak için: '
          'python3 scripts/drain-derivative-queue.py')
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--payload', required=True)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--skip-images', action='store_true')
    ap.add_argument('--reuse-uploads', action='store_true',
                    help='R2 yüklemesini ATLA, deterministik anahtarlardan yol haritasını yeniden kur (görseller yüklendikten sonra D1 yazımı düştüyse)')
    args = ap.parse_args()

    payload = json.load(open(args.payload, encoding='utf8'))
    items = payload['products']
    nvar = sum(len(p['variants']) for p in items)
    print(f"{len(items)} ana ürün / {nvar} versiyon"
          f"{'  [DRY-RUN]' if args.dry_run else ''}\n")

    print('--- 1) Marka doğrulaması ---')
    office = d1(f'SELECT id, name, slug, logo_url, cover_url, about FROM offices '
                f'WHERE id = {BRAND_OFFICE_ID} AND deleted_at IS NULL')
    if not office:
        raise SystemExit(f'HATA: offices.id={BRAND_OFFICE_ID} ({BRAND_NAME}) bulunamadı — '
                         'marka silinmiş ya da id değişmiş olabilir.')
    o = office[0]
    print(f"  = {o['name']} (id={o['id']}, slug={o['slug']}) — logo:"
          f"{'var' if o['logo_url'] else 'YOK'} kapak:{'var' if o['cover_url'] else 'YOK'} "
          f"tanıtım:{len(o['about'] or '')} karakter")

    print('\n--- 2) Mükerrer kontrolü ---')
    existing = d1('SELECT id, slug, title, brand_name_raw FROM products WHERE deleted_at IS NULL')
    upd_ids = [it['update_id'] for it in items if it.get('update_id')]
    prior = {}
    if upd_ids:
        for r in d1('SELECT id, images, specs, files, description, designer FROM products '
                    f"WHERE id IN ({','.join(str(i) for i in upd_ids)})"):
            prior[r['id']] = r
    existing_slugs = {r['slug'] for r in existing}
    existing_keys = {f"{fold_tr(r['brand_name_raw'])}|||{fold_tr(r['title'])}": r['id']
                     for r in existing}
    known_ids = {r['id'] for r in existing}
    print(f'  D1 canlı ürün satırı: {len(existing)}')

    todo, updates, skipped = [], [], []
    for it in items:
        if it.get('update_id'):
            if it['update_id'] not in known_ids:
                print(f"  UYARI: güncellenecek id={it['update_id']} bulunamadı, YENİ eklenecek: "
                      f"{it['title']}")
                it['update_id'] = None
            else:
                updates.append(it)
                continue
        key = f"{fold_tr(it['brand'])}|||{fold_tr(it['title'])}"
        if it['slug'] in existing_slugs or key in existing_keys:
            skipped.append(it)
        else:
            existing_slugs.add(it['slug'])
            existing_keys[key] = None
            todo.append(it)
    for it in skipped:
        print(f"  ATLANDI (zaten var): {it['brand']} — {it['title']}")
    print(f'  eklenecek: {len(todo)}, güncellenecek: {len(updates)}, atlanan: {len(skipped)}')
    if not todo and not updates:
        print('\nYapılacak iş yok.')
        return 0

    print('\n--- 3) Görseller (kaynak -> WebP -> R2) ---')
    insert_stmts, update_stmts, report = [], [], []
    for it in todo + updates:
        paths = upload_product_images(it, args.dry_run, args.skip_images,
                                      reuse=args.reuse_uploads)

        parent_images = [paths[u] for u in it['images'] if u in paths]
        variants = []
        for v in it['variants']:
            variants.append({
                'label': v['label'],
                'options': v['options'],
                'images': [paths[u] for u in v['srcImages'] if u in paths],
                'specs': list(v['specs']),
                'files': v['files'],
                'description': v.get('description'),
                'sourceUrl': v['sourceUrl'],
            })

        # --- Mevcut satırı ZENGİNLEŞTİR (ezme) — batch67 ile aynı semantik ---
        old = prior.get(it.get('update_id') or -1)
        old_specs = []
        if old:
            old_images = json.loads(old['images'] or '[]')
            old_specs = json.loads(old['specs'] or '[]')
            parent_images = list(dict.fromkeys(old_images + parent_images))[:12]
            # Küratörlü aile-geneli spec'ler (İskelet/Dolgu/Ayak/Malzeme Seçenekleri) HER
            # versiyona kopyalanır; kopyalanmazsa versiyon seçilir seçilmez ekrandan kaybolurlar
            # (versiyonun kendi spec'i dolu olduğu için ana satıra düşülmez).
            for v in variants:
                have = {s['label'] for s in v['specs']}
                v['specs'] += [s for s in old_specs if s.get('label') not in have]

        head = variants[0]
        vals = {
            'title': q(it['title']),
            'brand_office_id': str(BRAND_OFFICE_ID),
            'brand_name_raw': q(it['brand']),
            'website': q(it['source_url']),
            'category': q(it['category']),
            'description': q(it['description']),
            'images': q(json.dumps(parent_images, ensure_ascii=False)),
            'specs': q(json.dumps(head['specs'], ensure_ascii=False)),
            'source_url': q(it['source_url']),
            'designer': q(it['designer']),
            'year': q(it.get('year')),
            'files': q(json.dumps(head['files'], ensure_ascii=False)),
            'variants': q(json.dumps(variants, ensure_ascii=False)),
        }

        if it.get('update_id'):
            upd = {'images': vals['images'], 'variants': vals['variants'],
                   'brand_office_id': vals['brand_office_id']}
            merged_specs = old_specs + [s for s in head['specs']
                                        if s['label'] not in {o.get('label') for o in old_specs}]
            upd['specs'] = q(json.dumps(merged_specs, ensure_ascii=False))
            for col in ('description', 'designer', 'files'):
                cur = (old or {}).get(col)
                if not (cur or '').strip() or (col == 'files' and (cur or '').strip() == '[]'):
                    upd[col] = vals[col]
            sets = ', '.join(f'{k} = {v}' for k, v in upd.items())
            update_stmts.append(
                f"UPDATE products SET {sets}, updated_at = datetime('now') "
                f"WHERE id = {it['update_id']};")
        else:
            cols = ['slug', 'kind', 'legacy_key', 'source'] + list(vals)
            vv = [q(it['slug']), "'product'", q(f"{it['brand']}|||{it['title']}"), "'admin'"] \
                + list(vals.values())
            stmt = f"INSERT INTO products ({', '.join(cols)})\nVALUES ({', '.join(vv)});"
            if len(stmt.encode()) <= MAX_STMT_BYTES:
                insert_stmts.append(stmt)
            else:
                # D1 tavanını aşan satır: `variants` boş açılır, sonra JSON metni `||` ile parça
                # parça eklenir. Parçalar HAM JSON metninin dilimleridir (UTF-8 sınırında değil,
                # Python str seviyesinde bölünür — q() kaçışı her parçaya ayrı uygulanır).
                small = dict(vals, variants="''")
                cols2 = ['slug', 'kind', 'legacy_key', 'source'] + list(small)
                vv2 = [q(it['slug']), "'product'", q(f"{it['brand']}|||{it['title']}"), "'admin'"] \
                    + list(small.values())
                insert_stmts.append(f"INSERT INTO products ({', '.join(cols2)})\n"
                                    f"VALUES ({', '.join(vv2)});")
                vjson = json.dumps(variants, ensure_ascii=False)
                parts = [vjson[i:i + VARIANTS_CHUNK]
                         for i in range(0, len(vjson), VARIANTS_CHUNK)]
                for part in parts:
                    insert_stmts.append(
                        f"UPDATE products SET variants = variants || {q(part)} "
                        f"WHERE slug = {q(it['slug'])};")
                print(f"    ! {it['title']}: variants {len(vjson) // 1024} KB > tavan, "
                      f"{len(parts)} parçaya bölündü")

        report.append({'slug': it['slug'], 'title': it['title'], 'key': it['key'],
                       'variants': len(variants), 'images': len(paths),
                       'office_id': BRAND_OFFICE_ID, 'update_id': it.get('update_id'),
                       'source_projects': it.get('source_projects') or []})
        tag = f"GÜNCELLE id={it['update_id']}" if it.get('update_id') else 'YENİ'
        print(f"  {it['title'][:34]:36} versiyon={len(variants):3} görsel={len(paths):3} {tag}")

    print('\n--- 4) D1 yazımı ---')
    if args.dry_run:
        print(f'  [dry-run] {len(insert_stmts)} INSERT + {len(update_stmts)} UPDATE yazılmadı.')
    else:
        # INSERT'ler SIRAYLA yazılır: katalog `ORDER BY id DESC` olduğundan INSERT sırası ekrana
        # ters yansır ve serpiştirme (shuffle) buna dayanır. Tek bir d1_file çağrısına ~1,2 MB SQL
        # sığdırmak yerine kümülatif boyuta göre parçalanır — parça SINIRI ifadeleri bölmez, yalnızca
        # gruplar; sıra korunur.
        if insert_stmts:
            batch, size, nbatch = [], 0, 0
            for st in insert_stmts:
                if batch and size + len(st) > 400_000:
                    d1_file('\n'.join(batch)); nbatch += 1
                    batch, size = [], 0
                batch.append(st); size += len(st)
            if batch:
                d1_file('\n'.join(batch)); nbatch += 1
            n_rows = sum(1 for st in insert_stmts if st.startswith('INSERT INTO products'))
            print(f'  {n_rows} ana ürün eklendi ({len(insert_stmts)} ifade, {nbatch} parça).')
        if update_stmts:
            d1_file('\n'.join(update_stmts))
            print(f'  {len(update_stmts)} mevcut ürün güncellendi.')

    print('\n--- 5) Responsive türev kuyruğu ---')
    flush_derivatives_chunked(args.dry_run)

    out = os.path.join(HERE, 'output', 'btdesign-import-report.json')
    json.dump(report, open(out, 'w', encoding='utf8'), ensure_ascii=False, indent=2)
    print(f'\nRapor: {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
