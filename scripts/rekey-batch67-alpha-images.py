#!/usr/bin/env python3
"""Alfa düzeltmesi yapılan görselleri YENİ R2 anahtarlarına taşır (tek seferlik onarım, 2/2).

Neden gerekti
-------------
`fix-batch67-alpha-images.py` düzeltilmiş WebP'leri AYNI anahtarların üzerine yazdı ve R2'deki
nesneler gerçekten düzeldi — ama canlıda hâlâ SİYAH görünüyorlardı:

    cf-cache-status: HIT | age: 1415 | cache-control: public, max-age=31536000,
                                       s-maxage=2592000, immutable

`/media/...` yanıtları `immutable` ve 30 GÜN s-maxage ile uç (edge) önbelleğinde duruyor; aynı
URL'e yeni içerik yazmak önbelleği geçersizleştirmiyor. Cloudflare purge API'si ise bu ortamda
kullanılamıyor: wrangler'ın OAuth token'ı zone'ları OKUYABİLİYOR ama `purge_cache` çağrısında
401 dönüyor (Zone.Cache Purge izni yok) ve projede CF_PURGE_TOKEN secret'ı tanımlı değil
(bkz. [[project_global_cache_purge_needs_secrets]]).

Çözüm: içeriği DEĞİŞTİRMEK yerine ADRESİ değiştirmek. Düzeltilmiş kareler `<n>-w.webp` ("white
composited") anahtarlarına yazılır ve D1'deki yollar güncellenir; yeni URL uç önbelleğinde hiç
bulunmadığı için ilk istekte R2'den taze gelir. Bu, `immutable` sözleşmesine de UYGUN davranıştır
— içerik değiştiyse URL de değişmelidir.

Eski (siyah) nesneler ve türevleri işin sonunda SİLİNİR: artık hiçbir D1 satırı onlara işaret
etmiyor ve R2'de yer kaplamalarının anlamı yok.

Kullanım:
  python3 scripts/rekey-batch67-alpha-images.py [--dry-run]
"""

import argparse
import concurrent.futures
import importlib.util as _ilu
import io
import json
import os
import subprocess
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
_spec = _ilu.spec_from_file_location('import_batch67', os.path.join(HERE, 'import-batch67.py'))
ib = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(ib)

d1, d1_file, q = ib.d1, ib.d1_file, ib.q
DERIVATIVE_WIDTHS = [400, 800, 1600]
_lock = threading.Lock()


def has_alpha(data):
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    try:
        im = Image.open(io.BytesIO(data))
    except Exception:
        return False
    return im.mode in ('RGBA', 'LA', 'PA') or (im.mode == 'P' and 'transparency' in im.info)


def r2_delete(key):
    p = subprocess.run(['npx', 'wrangler', 'r2', 'object', 'delete', f'{ib.imp.BUCKET}/{key}',
                        '--remote'], cwd=ROOT, capture_output=True)
    return p.returncode == 0


def align(src, got):
    return zip(src[max(0, len(src) - len(got)):], got[max(0, len(got) - len(src)):])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    payload = json.load(open(os.path.join(HERE, 'output', 'batch67-payload.json'), encoding='utf8'))
    want = {p['slug']: p for p in payload['products']}
    slugs = ','.join(q(s) for s in want)
    rows = d1(f'SELECT id, slug, images, variants FROM products '
              f'WHERE deleted_at IS NULL AND slug IN ({slugs})')

    src_to_path = {}
    for r in rows:
        w = want[r['slug']]
        live = json.loads(r['variants'] or '[]')
        for pv, lv in zip(w['variants'], live):
            for u, p in align(list(pv['srcImages']), list(lv.get('images') or [])):
                src_to_path[u] = p
        for u, p in align(list(w['images']), json.loads(r['images'] or '[]')):
            src_to_path.setdefault(u, p)

    print(f'{len(rows)} satır, {len(src_to_path)} kaynak. Alfalı kareler taranıyor...')

    def scan(u):
        raw = ib.http_get(ib.safe_url(u))
        return (u, raw, has_alpha(raw) if raw else None)

    todo = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        for u, raw, alpha in ex.map(scan, list(src_to_path)):
            if raw is None:
                print(f'  UYARI indirilemedi: {u}')
            elif alpha:
                todo.append((u, raw))
    print(f'  yeniden adreslenecek: {len(todo)}')
    if not todo:
        print('Yapılacak iş yok.')
        return 0

    # eski yol -> yeni yol
    remap = {}
    for u, _ in todo:
        old = src_to_path[u]
        base, ext = old.rsplit('.', 1)
        remap[old] = f'{base}-w.{ext}'

    if args.dry_run:
        print(f'\n[dry-run] {len(remap)} yol değişecekti, ör.:')
        for o, n in list(remap.items())[:6]:
            print(f'   {o}\n-> {n}')
        return 0

    print('\n--- 1) Düzeltilmiş kareler YENİ anahtarlara yazılıyor ---')
    written = {}

    def put(job):
        u, raw = job
        newpath = remap[src_to_path[u]]
        key = newpath.replace('/media/', '', 1)
        try:
            webp = ib.to_webp(raw, ib.imp.MAX_IMG_W)
        except Exception as e:
            return (u, None, f'webp: {e}')
        ok, err = ib.r2_put(key, webp)
        if ok:
            with _lock:
                ib.note_derivatives(key, ib.webp_width(webp))
            return (u, newpath, None)
        return (u, None, f'R2: {err}')

    fails = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        for u, newpath, err in ex.map(put, todo):
            if err:
                fails += 1
                print(f'  HATA {u[:70]}: {err}')
            else:
                written[src_to_path[u]] = newpath
    print(f'  yazıldı: {len(written)}, hatalı: {fails}')
    if fails:
        print('  HATALI KARE VAR — D1 güncellenmeyecek, sorunu giderip tekrar çalıştırın.')
        return 1

    print('\n--- 2) D1 yolları güncelleniyor ---')
    stmts = 0
    for r in rows:
        imgs = json.loads(r['images'] or '[]')
        vs = json.loads(r['variants'] or '[]')
        new_imgs = [written.get(p, p) for p in imgs]
        changed = new_imgs != imgs
        for v in vs:
            old = list(v.get('images') or [])
            new = [written.get(p, p) for p in old]
            if new != old:
                v['images'] = new
                changed = True
        if not changed:
            continue
        d1_file(f"UPDATE products SET images = {q(json.dumps(new_imgs, ensure_ascii=False))}, "
                f"variants = {q(json.dumps(vs, ensure_ascii=False))}, "
                f"updated_at = datetime('now') WHERE id = {r['id']};")
        stmts += 1
    print(f'  {stmts} ürün satırı güncellendi.')

    print('\n--- 3) Türev kuyruğu ---')
    ib.flush_derivatives_chunked(False)

    print('\n--- 4) Eski (siyah) nesneler ve türevleri siliniyor ---')
    dead = []
    for old in written:
        k = old.replace('/media/', '', 1)
        dead.append(k)
        dead += [f'_derived/w{w}/r2/{k}' for w in DERIVATIVE_WIDTHS]
    done = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        for _ in ex.map(r2_delete, dead):
            done += 1
            if done % 200 == 0:
                print(f'  {done}/{len(dead)}')
    print(f'  {len(dead)} eski anahtar silindi.')
    print('\nŞimdi: python3 scripts/drain-derivative-queue.py')
    return 0


if __name__ == '__main__':
    sys.exit(main())
