#!/usr/bin/env python3
"""Bürotime partisi (183 URL / 137 aile) içe aktarımı — import-koleksiyon4.py'nin eşi (2026-09-07).

GÜNCELLEME SEMANTİĞİ: görev metni açıkça FRESH OVERWRITE istiyor ("...bu linklerdeki güncel
verileri ve görselleri ile revize et"). Körü körüne ezmek veri kaybettirirdi, bu yüzden
koleksiyon4'teki SAYFA BAZINDA overwrite uygulanır — her versiyon `sourceUrl` taşır:
  - sourceUrl'i BU PARTİDE olan eski versiyonlar SİLİNİR ve taze halleriyle değiştirilir,
  - sourceUrl'i bu partide OLMAYAN (ya da hiç sourceUrl'i olmayan) versiyonlara DOKUNULMAZ.
`images` de aynı mantıkla: satırın eski içeriğinin geldiği TÜM sayfalar bu partide yeniden
kazındıysa (`fully_covered`) görsel listesi TAZESİYLE DEĞİŞTİRİLİR, değilse taze görseller
eskilerin ARDINA eklenir.

R2 ANAHTARI — KRİTİK: mevcut 27 Bürotime satırının görselleri `import/products/<slug>/<n>.webp`
ve `<n>-w.webp` anahtarlarında duruyor. `/media` yanıtları 30 gün `immutable` önbellekli
olduğundan AYNI anahtara yazmak canlıyı DEĞİŞTİRMEZ (bkz. proje notu "purge değil yeniden
adresle") ve bu partide <n> BAŞKA bir kaynak görsele denk geleceğinden YANLIŞ görsel servis
edilirdi. Bu yüzden bu partinin anahtarları `import/products/<slug>/bt-<n>.webp`.

EŞLEŞTİRME (hangi aile hangi mevcut satırı günceller) ÜÇ ADIMDA yapılır ve İLK eşleşen kazanır:
  1. slug birebir (`opera-burotime`)
  2. TR-fold başlık (`hey!` -> `hey!`)
  3. mevcut satırın `source_url`'ü bu partinin sayfalarından biriyse
Üçüncü adım "Synergy" -> "Syn.Ergy" gibi ADI DEĞİŞMİŞ satırları yakalar: products#480'in slug'ı
`synergy-burotime`, yeni başlık ise kaynağın kendi yazımıyla "Syn.Ergy" (slug `syn-ergy-...`),
yani ilk iki adım tutmaz — ama satırın source_url'ü `.../urunler/synergy-masa` bu partide.

Kullanım:
  python3 scripts/import-burotime.py --payload scripts/output/burotime-payload.json
      [--dry-run] [--skip-images] [--limit N]
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
_spec = _ilu.spec_from_file_location('import_archello_products',
                                     os.path.join(HERE, 'import-archello-products.py'))
imp = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(imp)

q, d1, d1_file = imp.q, imp.d1, imp.d1_file
http_get, to_webp, r2_put = imp.http_get, imp.to_webp, imp.r2_put
webp_width, note_derivatives = imp.webp_width, imp.note_derivatives
fold_tr = imp.fold_tr

BUROTIME_OFFICE_ID = 771
R2_PREFIX = 'import/products'
BATCH_TAG = 'bt'
MAX_IMAGES = 12
_lock = threading.Lock()


def upload_product_images(it, folder_slug, dry_run, skip_images):
    urls = list(dict.fromkeys(
        list(it['images']) + [u for v in it['variants'] for u in v['srcImages']]))
    if skip_images or not urls:
        return {}

    def one(job):
        idx, url = job
        raw = http_get(url)
        if not raw:
            return (url, None, f'indirilemedi: {url}')
        try:
            webp = to_webp(raw, imp.MAX_IMG_W)
        except Exception as ex:
            return (url, None, f'webp hatası: {ex}')
        key = f'{R2_PREFIX}/{folder_slug}/{BATCH_TAG}-{idx}.webp'
        if dry_run:
            return (url, f'/media/{key}', None)
        ok, err = r2_put(key, webp)
        if ok:
            with _lock:
                note_derivatives(key, webp_width(webp))
            return (url, f'/media/{key}', None)
        return (url, None, f'R2: {err}')

    paths, failed = {}, []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        for url, path, err in ex.map(one, list(enumerate(urls, start=1))):
            if err:
                failed.append(err)
            else:
                paths[url] = path
    for err in failed[:3]:
        print(f'    UYARI [{folder_slug}]: {err}')
    if len(failed) > 3:
        print(f'    UYARI [{folder_slug}]: +{len(failed) - 3} görsel daha atlandı')
    return paths


def flush_derivatives_chunked(dry_run, chunk=200):
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
    print(f'  türev kuyruğuna {total} iş yazıldı.')
    return total


def match_existing(items, rows, batch_urls):
    """Bkz. dosya başı "EŞLEŞTİRME". Bir mevcut satır EN FAZLA bir aileye bağlanır."""
    by_slug = {r['slug']: r for r in rows}
    by_fold = {}
    for r in rows:
        by_fold.setdefault(fold_tr(r['title']), []).append(r)
    by_src = {}
    for r in rows:
        if (r.get('source_url') or '') in batch_urls:
            by_src.setdefault(r['source_url'], []).append(r)

    taken, report = set(), []
    for it in items:
        hit, how = None, None
        r = by_slug.get(it['slug'])
        if r and r['id'] not in taken:
            hit, how = r, 'slug'
        if hit is None:
            for r in by_fold.get(fold_tr(it['title']), []):
                if r['id'] not in taken:
                    hit, how = r, 'başlık'
                    break
        if hit is None:
            for u in it['batch_urls']:
                for r in by_src.get(u, []):
                    if r['id'] not in taken:
                        hit, how = r, f'source_url({u.rsplit("/", 1)[-1]})'
                        break
                if hit:
                    break
        if hit:
            taken.add(hit['id'])
            it['update_id'] = hit['id']
            report.append((it['title'], hit['id'], hit['title'], how))
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--payload', required=True)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--skip-images', action='store_true')
    ap.add_argument('--limit', type=int)
    # Tek bir aileyi yeniden yazmak için (ör. payload'da yalnızca o ailenin versiyon eksenleri
    # değiştiğinde) — TÜM partiyi baştan yüklemeden. R2 anahtarları belirlenimci olduğundan
    # yeniden yazım aynı adreslere aynı içeriği koyar, canlıyı bozmaz.
    ap.add_argument('--only-titles', help='virgülle ayrılmış ürün başlıkları')
    args = ap.parse_args()

    all_items = json.load(open(args.payload, encoding='utf8'))['products']
    items = all_items
    if args.limit:
        items = items[:args.limit]
    if args.only_titles:
        keep = {t.strip() for t in args.only_titles.split(',')}
        items = [it for it in items if it['title'] in keep]
        if len(items) != len(keep):
            raise SystemExit(f'başlık bulunamadı: {keep - {it["title"] for it in items}}')
    # Sayfa bazlı overwrite elemesi PARTİNİN TAMAMINA göre yapılır (--limit/--only-titles ile
    # süzülmüş alt kümeye göre DEĞİL) — aksi halde süzülmüş bir koşuda, başka bir ailenin
    # sayfasından gelen eski bir versiyon "bu partide yok" sayılıp korunurdu.
    all_batch_urls = {u for it in all_items for u in it['batch_urls']}
    if args.skip_images and not args.dry_run:
        # --skip-images ile paths BOŞ döner; "tam kapsamlı" satırlarda images TAZESİYLE
        # DEĞİŞTİRİLDİĞİNDEN gerçek bir yazımda bu, mevcut görselleri SİLERDİ.
        raise SystemExit('--skip-images yalnızca --dry-run ile kullanılabilir.')

    print('--- 1) Marka profili (offices#771) ---')
    off = d1(f'SELECT id, name, yil, website FROM offices WHERE id = {BUROTIME_OFFICE_ID}')
    if not off:
        raise SystemExit('Bürotime marka profili (offices#771) bulunamadı!')
    print(f'  {off[0]["name"]} — {off[0]["website"]} (kuruluş {off[0]["yil"]})')
    # "1997.0" bir tablo aktarımından kalma float artığı; görünen künyede "1997" olmalı.
    if (off[0]['yil'] or '').endswith('.0') and not args.dry_run:
        d1_file(f"UPDATE offices SET yil = {q(off[0]['yil'][:-2])} WHERE id = {BUROTIME_OFFICE_ID};")
        print(f"  yil düzeltildi: {off[0]['yil']} -> {off[0]['yil'][:-2]}")

    print('\n--- 2) Mevcut Bürotime satırlarıyla eşleştirme ---')
    rows = d1('SELECT id, slug, title, source_url, images, specs, variants, description, '
              f'designer, files FROM products WHERE deleted_at IS NULL '
              f'AND brand_office_id = {BUROTIME_OFFICE_ID}')
    print(f'  D1de {len(rows)} canlı Bürotime satırı var.')
    matched = match_existing(items, rows, all_batch_urls)
    for title, rid, old_title, how in matched:
        print(f'  {title[:22]:24} -> #{rid:<5} "{old_title[:22]}" ({how})')
    unmatched = [r for r in rows if r['id'] not in {m[1] for m in matched}]
    if unmatched:
        print(f'  EŞLEŞMEYEN mevcut satır ({len(unmatched)}) — DOKUNULMAYACAK: '
              + ', '.join(f'#{r["id"]} {r["title"]}' for r in unmatched))
    prior = {r['id']: r for r in rows}

    print('\n--- 3) Mükerrer slug kontrolü (yeni ürünler) ---')
    existing_slugs = {r['slug'] for r in d1('SELECT slug FROM products WHERE deleted_at IS NULL')}
    for it in items:
        if it.get('update_id'):
            continue
        base, slug, n = it['slug'], it['slug'], 2
        while slug in existing_slugs:
            slug, n = f'{base}-{n}', n + 1
        if slug != it['slug']:
            print(f"  slug çakışması: {it['slug']} -> {slug}")
        it['slug'] = slug
        existing_slugs.add(slug)

    nupd = sum(1 for p in items if p.get('update_id'))
    print(f"\n{len(items)} aile ({len(items) - nupd} yeni / {nupd} güncelle) / "
          f"{sum(len(p['variants']) for p in items)} versiyon"
          f"{'  [DRY-RUN]' if args.dry_run else ''}")

    print('\n--- 4) Görseller (kaynak -> WebP -> R2) ---')
    insert_stmts, update_stmts, report = [], [], []
    for n, it in enumerate(items, 1):
        old = prior.get(it.get('update_id') or -1)
        folder_slug = old['slug'] if old else it['slug']
        paths = upload_product_images(it, folder_slug, args.dry_run, args.skip_images)

        parent_images = [paths[u] for u in it['images'] if u in paths]
        new_variants = [{
            'label': v['label'],
            'options': v['options'],
            'images': [paths[u] for u in v['srcImages'] if u in paths],
            'specs': v['specs'],
            'files': v['files'],
            'description': v.get('description'),
            'sourceUrl': v['sourceUrl'],
        } for v in it['variants']]

        if old:
            old_variants = json.loads(old['variants'] or '[]')
            kept = [v for v in old_variants if (v or {}).get('sourceUrl') not in all_batch_urls]
            fully_covered = len(kept) == 0
            fresh_labels = {v['label'] for v in new_variants}
            kept = [v for v in kept if (v or {}).get('label') not in fresh_labels]
            final_variants = kept + new_variants

            old_images = json.loads(old['images'] or '[]')
            images = (parent_images if fully_covered
                      else list(dict.fromkeys(old_images + parent_images)))[:MAX_IMAGES]

            sets = {
                'title': q(it['title']),
                'category': q(it['category']),
                'images': q(json.dumps(images, ensure_ascii=False)),
                'variants': q(json.dumps(final_variants, ensure_ascii=False)),
                'source_url': q(it['source_url']),
                'website': q(it['source_url']),
                'brand_name_raw': q(it['brand']),
                'brand_office_id': str(BUROTIME_OFFICE_ID),
            }
            # FRESH OVERWRITE: taze veri VARSA ezilir, YOKSA eskisi korunur.
            if it['specs']:
                sets['specs'] = q(json.dumps(it['specs'], ensure_ascii=False))
            if it['description']:
                sets['description'] = q(it['description'])
            if it['designer']:
                sets['designer'] = q(it['designer'])
            if it['files']:
                sets['files'] = q(json.dumps(it['files'], ensure_ascii=False))

            clause = ', '.join(f'{k} = {v}' for k, v in sets.items())
            update_stmts.append(
                f"UPDATE products SET {clause}, updated_at = datetime('now') "
                f"WHERE id = {it['update_id']};")
            report.append({'action': 'update', 'id': it['update_id'], 'slug': old['slug'],
                           'title': it['title'], 'kept_variants': len(kept),
                           'fresh_variants': len(new_variants),
                           'total_variants': len(final_variants), 'images': len(images),
                           'fully_covered': fully_covered})
            print(f"  [{n:3}/{len(items)}] ~ GÜNCELLE #{it['update_id']:4} {it['title'][:20]:22} "
                  f"versiyon {len(old_variants)}->{len(final_variants)} görsel={len(images)}"
                  f"{' [tam-kapsam]' if fully_covered else ' [kısmi]'}")
        else:
            vals = {
                'title': q(it['title']),
                'brand_office_id': str(BUROTIME_OFFICE_ID),
                'brand_name_raw': q(it['brand']),
                'website': q(it['source_url']),
                'category': q(it['category']),
                'description': q(it['description']),
                'images': q(json.dumps(parent_images, ensure_ascii=False)),
                'specs': q(json.dumps(it['specs'], ensure_ascii=False)),
                'source_url': q(it['source_url']),
                'designer': q(it['designer']),
                'files': q(json.dumps(it['files'], ensure_ascii=False)),
                'variants': q(json.dumps(new_variants, ensure_ascii=False)) if new_variants else 'NULL',
            }
            cols = ['slug', 'kind', 'legacy_key', 'source'] + list(vals)
            vv = [q(it['slug']), "'product'", q(f"{it['brand']}|||{it['title']}"), "'admin'"] \
                + list(vals.values())
            insert_stmts.append(f"INSERT INTO products ({', '.join(cols)})\nVALUES ({', '.join(vv)});")
            report.append({'action': 'insert', 'slug': it['slug'], 'title': it['title'],
                           'variants': len(new_variants), 'images': len(parent_images)})
            print(f"  [{n:3}/{len(items)}] + YENİ {it['title'][:20]:22} "
                  f"versiyon={len(new_variants):3} görsel={len(parent_images)}")

    print('\n--- 5) D1 yazımı ---')
    sizes = [len(s.encode()) for s in insert_stmts + update_stmts]
    print(f'  en büyük ifade: {max(sizes, default=0)} bayt; 90KB üstü: '
          f'{sum(1 for s in sizes if s > 90_000)}')
    if args.dry_run:
        print(f'  [dry-run] {len(insert_stmts)} INSERT + {len(update_stmts)} UPDATE yazılmadı.')
    else:
        # D1 tek-ifade ~100 KB sınırı (proje notu) -> her ifade TEK TEK yazılır.
        for i, stmt in enumerate(insert_stmts, 1):
            d1_file(stmt)
            if i % 10 == 0 or i == len(insert_stmts):
                print(f'    INSERT {i}/{len(insert_stmts)}')
        for i, stmt in enumerate(update_stmts, 1):
            d1_file(stmt)
            if i % 10 == 0 or i == len(update_stmts):
                print(f'    UPDATE {i}/{len(update_stmts)}')

    print('\n--- 6) Responsive türev kuyruğu ---')
    flush_derivatives_chunked(args.dry_run)

    print('\n--- Görsel arama dizini (product) ---')
    imp.sync_visual_index('product', args.dry_run)

    # Süzülmüş koşularda rapor ÜZERİNE YAZILMAZ — burotime-spread-display-order.py partinin
    # TAMAMINI bu rapordan okur.
    out = os.path.join(HERE, 'output', 'burotime-import-report.json'
                       if not (args.limit or args.only_titles)
                       else 'burotime-import-report-partial.json')
    json.dump(report, open(out, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print(f'\nRapor: {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
