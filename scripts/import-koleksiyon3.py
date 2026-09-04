#!/usr/bin/env python3
"""Koleksiyon 3. parti (64 URL / 52 aile) içe aktarımı — import-koleksiyon2.py'nin eşi.

GÜNCELLEME SEMANTİĞİ koleksiyon2'DEN FARKLIDIR. koleksiyon2 "mevcut varyantı SİLME, EKLE"
diyordu; bu partinin görev metni ise açıkça FRESH OVERWRITE istiyor ("...bu linklerdeki güncel
durumlarına göre ez"). Körü körüne ezmek ise veri kaybettirirdi: ör. Halia'nın (#206) 13
versiyonu koltuk/sandalye/çalışma-sandalyesi sayfalarından geliyor, bu partide ise SADECE
tabure sayfası var — `variants`'ı komple ezmek o 13 versiyonu SİLERDİ.

Çözüm SAYFA BAZINDA overwrite: her versiyon `sourceUrl` taşır (bkz. migrations/0086) —
  - sourceUrl'i BU PARTİDE olan eski versiyonlar SİLİNİR ve taze halleriyle değiştirilir,
  - sourceUrl'i bu partide OLMAYAN (ya da hiç sourceUrl'i olmayan) versiyonlara DOKUNULMAZ.

`images` de aynı mantıkla: satırın eski içeriğinin geldiği TÜM sayfalar bu partide yeniden
kazındıysa (`fully_covered`) görsel listesi TAZESİYLE DEĞİŞTİRİLİR; satırın bu partide olmayan
başka bir sayfadan gelen içeriği de varsa taze görseller eskilerin ARDINA eklenir (o sayfanın
görselleri aksi halde kaybolurdu).

description/designer/specs/files: kaynak taze veri VARSA EZİLİR (görev talimatı). files ayrıca
ölü placeholder'dan temizlenir — bkz. koleksiyon3-build-payload.py dosya başı (2).

R2 ANAHTARI — KRİTİK: mevcut satırların görselleri `import/products/<slug>/<n>.webp`
anahtarlarında duruyor. `/media` yanıtları 30 gün `immutable` önbellekli olduğundan AYNI
anahtara yazmak canlıyı DEĞİŞTİRMEZ (bkz. proje notu: "purge değil yeniden adresle") ve bu
partide <n> BAŞKA bir kaynak görsele denk geleceğinden yanlış görsel servis edilirdi. Bu yüzden
bu partinin anahtarları `import/products/<slug>/k3-<n>.webp` — çakışmayan YENİ adresler.

Kullanım:
  python3 scripts/import-koleksiyon3.py --payload scripts/output/koleksiyon3-payload.json \
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

_spec = _ilu.spec_from_file_location('import_archello_products',
                                     os.path.join(HERE, 'import-archello-products.py'))
imp = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(imp)

q, d1, d1_file = imp.q, imp.d1, imp.d1_file
http_get, to_webp, r2_put = imp.http_get, imp.to_webp, imp.r2_put
webp_width, note_derivatives = imp.webp_width, imp.note_derivatives

KOLEKSIYON_OFFICE_ID = 717
R2_PREFIX = 'import/products'
BATCH_TAG = 'k3'          # anahtar öneki — bkz. dosya başı "R2 ANAHTARI"
MAX_IMAGES = 14
DEAD_FILE_URL = 'pim.koleksiyon.com.tr/product-type-code/pdf'
TYPE_AXES = ('Tip', 'Fonksiyon')
_lock = threading.Lock()

# Koleksiyon URL segmenti -> insan okunur tip etiketi. koleksiyon3-build-payload.py'deki
# SEATING_TYPES/DESK_TYPES'ın ÜST KÜMESİ: burada ESKİ versiyonların (önceki partilerden gelen,
# bu partide olmayan sayfalar) segmentleri de bulunmalı, yoksa tip ekseni geri doldurulamaz.
SEGMENT_TYPE = {
    'kanepeler': 'Kanepe', 'koltuklar': 'Koltuk', 'tabureler-ve-puflar': 'Tabure & Puf',
    'sandalyeler': 'Sandalye', 'calisma-sandalyeleri': 'Çalışma Sandalyesi',
    'seminer-sandalyeleri': 'Seminer Sandalyesi', 'berjerler': 'Berjer',
    'masa-sistemleri': 'Operasyonel Çalışma İstasyonu', 'yonetici-masalari': 'Yönetici Masası',
    'toplanti-masalari': 'Toplantı Masası', 'seminer-masalari': 'Seminer Masası',
    'calisma-masalari': 'Çalışma Masası',
}


def segment_of(url):
    """.../urunler/<üst>/<segment>/<slug>/ -> segment."""
    parts = [p for p in (url or '').split('/') if p]
    return parts[-2] if len(parts) >= 2 else None


def type_from_source(url):
    return SEGMENT_TYPE.get(segment_of(url))


DESK_SEGMENTS = {'masa-sistemleri', 'yonetici-masalari', 'toplanti-masalari', 'seminer-masalari',
                 'calisma-masalari'}


def normalize_type_axis(variants):
    """Birleşmiş listede versiyonların BİR KISMI tip eksenli, bir kısmı eksensizse hap satırı
    eksik kalır: eksensiz versiyon hiçbir "Tip" hapına karşılık gelmez, o hap'a basınca ona
    ulaşılamaz (bkz. product-modal.js#pickVariantIndex — eşleşmeyen versiyon hiç seçilemez).

    Bu yüzden listede tip ekseni KULLANILIYORSA, eksik olan versiyonlara sourceUrl'lerinden
    türetilen tip DEĞERİ geri doldurulur ve etiketleri "<Tip> · <modül>" biçimine getirilir.

    Tip ekseni HİÇ yoksa da, birleşmiş versiyonlar BİRDEN ÇOK tipten geliyorsa eksen SIFIRDAN
    açılır: ör. products#582 Alcove'un eski 9 versiyonu `koltuklar`, bu partinin 3 versiyonu
    `tabureler-ve-puflar` sayfasından — iki taraf da tek eksenli olduğundan kural aksi halde
    hiç tetiklenmez ve kullanıcı berjerle pufu ayırt edemezdi. Tek tipli aileler (gerçekten
    tek sayfalı) DOKUNULMADAN kalır.
    """
    axis = next((o['label'] for v in variants for o in (v.get('options') or [])
                 if o.get('label') in TYPE_AXES), None)
    if not axis:
        segs = {segment_of(v.get('sourceUrl')) for v in variants} - {None}
        if len({SEGMENT_TYPE[s] for s in segs if s in SEGMENT_TYPE}) < 2:
            return variants
        axis = 'Fonksiyon' if segs <= DESK_SEGMENTS else 'Tip'
    for v in variants:
        opts = v.get('options') or []
        if any(o.get('label') == axis for o in opts):
            continue
        tl = type_from_source(v.get('sourceUrl'))
        if not tl:
            continue
        v['options'] = [{'label': axis, 'value': tl}] + opts
        label = (v.get('label') or '').strip()
        v['label'] = f'{tl} · {label}' if label and not label.startswith(f'{tl} ·') else (label or tl)
    return variants


def safe_url(url):
    """Koleksiyon modül render'ları boşluklu path'lerde durabiliyor (import-batch67.py'deki AYNI
    not) — yalnızca boşluk yüzde-kodlanır, zaten kodlanmış '%20' bozulmaz."""
    return url.replace(' ', '%20') if ' ' in url else url


def upload_product_images(it, folder_slug, dry_run, skip_images):
    urls = list(dict.fromkeys(
        list(it['images']) + [u for v in it['variants'] for u in v['srcImages']]))
    if skip_images or not urls:
        return {}

    def one(job):
        idx, url = job
        raw = http_get(safe_url(url))
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

    paths = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
        for url, path, err in ex.map(one, list(enumerate(urls, start=1))):
            if err:
                print(f'    UYARI [{folder_slug}]: {err}')
            else:
                paths[url] = path
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


def strip_dead_files(raw_json):
    """Eski satırlardaki ölü `product-type-code/pdf` bağlantılarını ayıklar. None -> None."""
    try:
        arr = json.loads(raw_json or 'null')
    except Exception:
        return None
    if not isinstance(arr, list):
        return None
    return [f for f in arr if not (isinstance(f, dict) and DEAD_FILE_URL in (f.get('url') or ''))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--payload', required=True)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--skip-images', action='store_true')
    args = ap.parse_args()

    items = json.load(open(args.payload, encoding='utf8'))['products']
    # Parti geneli sayfa kümesi — eski versiyon elemesi buna göre yapılır (aşağıdaki yorum).
    all_batch_urls = {u for it in items for u in it['batch_urls']}
    if args.skip_images:
        # --skip-images ile paths BOŞ döner; "tam kapsamlı" satırlarda images TAZESİYLE
        # DEĞİŞTİRİLDİĞİNDEN gerçek bir yazımda bu, mevcut görselleri SİLERDİ.
        if not args.dry_run:
            raise SystemExit('--skip-images yalnızca --dry-run ile kullanılabilir: gerçek yazımda '
                             'tam-kapsamlı satırların görsellerini boşaltırdı.')
    nupd = sum(1 for p in items if p.get('update_id'))
    print(f"{len(items)} aile ({len(items) - nupd} yeni / {nupd} güncelle) / "
          f"{sum(len(p['variants']) for p in items)} versiyon"
          f"{'  [DRY-RUN]' if args.dry_run else ''}\n")

    print('--- 1) Güncellenecek satırların mevcut hali ---')
    upd_ids = [it['update_id'] for it in items if it.get('update_id')]
    prior = {}
    if upd_ids:
        for r in d1('SELECT id, slug, title, images, specs, variants, description, designer, files '
                    f"FROM products WHERE id IN ({','.join(str(i) for i in upd_ids)}) "
                    'AND deleted_at IS NULL'):
            prior[r['id']] = r
    for it in items:
        if it.get('update_id') and it['update_id'] not in prior:
            print(f"  UYARI: id={it['update_id']} D1'de yok, YENİ ürün olarak eklenecek: {it['title']}")
            it['update_id'] = None
    print(f'  {len(prior)}/{len(upd_ids)} hedef satır bulundu.')

    print('\n--- 2) Mükerrer slug kontrolü (yeni ürünler) ---')
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

    print('\n--- 3) Görseller (kaynak -> WebP -> R2) ---')
    insert_stmts, update_stmts, report = [], [], []
    for it in items:
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
            # Sayfa bazlı overwrite (dosya başı): bu partinin sayfalarından gelen eski versiyonlar
            # düşer, diğer sayfalardan gelenler AYNEN kalır.
            #
            # Eleme TÜM PARTİNİN url kümesine (all_batch_urls) göre yapılır, yalnızca BU ailenin
            # sayfalarına göre DEĞİL — GERÇEK BULGU (2026-09-05): products#488 "Madrigal"
            # `madrigal-chester-kanepeler` sayfasından gelen 2 versiyon taşıyor (önceki parti
            # Chester'ı yanlışlıkla Madrigal'e katmış). O sayfa bu partide #554 "Madrigal
            # Chester"a atandığından, aile-yerel bir elemede aynı içerik İKİ üründe birden
            # kalırdı. Parti geneli eleme, her sayfayı tek bir aileye bağlar.
            kept = [v for v in old_variants if (v or {}).get('sourceUrl') not in all_batch_urls]
            fully_covered = len(kept) == 0
            # Taze versiyon etiketiyle çakışan (başka sayfadan gelmiş) eski versiyon varsa taze olan
            # kazanır — aksi halde popup'ta aynı etiketten iki hap çıkardı.
            fresh_labels = {v['label'] for v in new_variants}
            kept = [v for v in kept if (v or {}).get('label') not in fresh_labels]
            final_variants = normalize_type_axis(kept + new_variants)

            old_images = json.loads(old['images'] or '[]')
            images = (parent_images if fully_covered
                      else list(dict.fromkeys(old_images + parent_images)))[:MAX_IMAGES]

            sets = {
                'images': q(json.dumps(images, ensure_ascii=False)),
                'variants': q(json.dumps(final_variants, ensure_ascii=False)),
            }
            # FRESH OVERWRITE: taze veri varsa ezilir. Taze veri YOKSA eskisi korunur (ör. Halia'nın
            # tabure sayfasında açıklama yok — mevcut açıklaması silinmemeli).
            if it['specs']:
                sets['specs'] = q(json.dumps(it['specs'], ensure_ascii=False))
            if it['description']:
                sets['description'] = q(it['description'])
            if it['designer']:
                sets['designer'] = q(it['designer'])
            if it['files']:
                sets['files'] = q(json.dumps(it['files'], ensure_ascii=False))
            else:
                cleaned = strip_dead_files(old['files'])
                if cleaned is not None and cleaned != json.loads(old['files'] or '[]'):
                    sets['files'] = q(json.dumps(cleaned, ensure_ascii=False))
            # source_url kanonik TR sayfasına taşınır (eskiler /en/ ya da eski slug'lardı).
            sets['source_url'] = q(it['source_url'])
            sets['website'] = q(it['source_url'])

            clause = ', '.join(f'{k} = {v}' for k, v in sets.items())
            update_stmts.append(
                f"UPDATE products SET {clause}, updated_at = datetime('now') "
                f"WHERE id = {it['update_id']};")
            report.append({'action': 'update', 'id': it['update_id'], 'slug': old['slug'],
                           'title': it['title'], 'kept_variants': len(kept),
                           'fresh_variants': len(new_variants),
                           'total_variants': len(final_variants), 'images': len(images),
                           'fully_covered': fully_covered})
            print(f"  ~ GÜNCELLE #{it['update_id']:4} {it['title'][:22]:24} "
                  f"versiyon {len(old_variants)}->{len(final_variants)} "
                  f"(taze {len(new_variants)}, korunan {len(kept)}) görsel={len(images)}"
                  f"{' [tam-kapsam]' if fully_covered else ' [kısmi]'}")
        else:
            vals = {
                'title': q(it['title']),
                'brand_office_id': str(KOLEKSIYON_OFFICE_ID),
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
            print(f"  + YENİ {it['title'][:22]:24} versiyon={len(new_variants):3} "
                  f"görsel={len(parent_images)}")

    print('\n--- 4) D1 yazımı ---')
    # D1 tek-ifade ~100KB sınırı (proje notu): Threshold=47/Porte=37 versiyonlu satırlar büyük
    # JSON taşır -> her ifade TEK TEK yazılır.
    if args.dry_run:
        big = [s for s in insert_stmts + update_stmts if len(s.encode()) > 90_000]
        print(f'  [dry-run] {len(insert_stmts)} INSERT + {len(update_stmts)} UPDATE yazılmadı.')
        print(f'  en büyük ifade: {max((len(s.encode()) for s in insert_stmts + update_stmts), default=0)} bayt'
              f' — 90KB üstü: {len(big)}')
    else:
        for i, stmt in enumerate(insert_stmts, 1):
            d1_file(stmt)
            print(f'    INSERT {i}/{len(insert_stmts)}')
        for i, stmt in enumerate(update_stmts, 1):
            d1_file(stmt)
            print(f'    UPDATE {i}/{len(update_stmts)}')

    print('\n--- 5) Ölü placeholder temizliği (bu partide olmayan Koleksiyon satırları) ---')
    stale = d1("SELECT id, title, files, variants FROM products WHERE deleted_at IS NULL "
               "AND (COALESCE(files,'') LIKE '%product-type-code/pdf%' "
               "  OR COALESCE(variants,'') LIKE '%product-type-code/pdf%')")
    print(f'  {len(stale)} satırda ölü bağlantı kaldı.')
    if stale and not args.dry_run:
        for r in stale:
            f = strip_dead_files(r['files'])
            vs = json.loads(r['variants'] or 'null')
            if isinstance(vs, list):
                for v in vs:
                    if isinstance(v, dict) and isinstance(v.get('files'), list):
                        v['files'] = [x for x in v['files']
                                      if DEAD_FILE_URL not in (x.get('url') or '')]
            sets = []
            if f is not None:
                sets.append(f"files = {q(json.dumps(f, ensure_ascii=False))}")
            if isinstance(vs, list):
                sets.append(f"variants = {q(json.dumps(vs, ensure_ascii=False))}")
            if sets:
                d1_file(f"UPDATE products SET {', '.join(sets)} WHERE id = {r['id']};")
        print(f'  {len(stale)} satır temizlendi.')

    print('\n--- 6) Responsive türev kuyruğu ---')
    flush_derivatives_chunked(args.dry_run)

    out = os.path.join(HERE, 'output', 'koleksiyon3-import-report.json')
    json.dump(report, open(out, 'w', encoding='utf8'), ensure_ascii=False, indent=2)
    print(f'\nRapor: {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
