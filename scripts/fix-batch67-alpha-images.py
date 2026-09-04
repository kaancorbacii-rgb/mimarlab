#!/usr/bin/env python3
"""Alfa kanallı kaynaklardan SİYAH olarak yazılmış görselleri yeniden üretir (tek seferlik onarım).

Hata
----
`import-archello-products.py#to_webp` saydam görselleri `im.convert('RGB')` ile düzleştiriyordu;
bu alfayı ATAR ve RGB'yi olduğu gibi bırakır. Koleksiyon'un modül render'ları **LA** kipinde ve
görüntünün TAMAMI alfa kanalında kodlanmış (parlaklık kanalı her pikselde 0) — sonuç, ürün
pop-up'ında SİYAH BİR SİLUET oldu. batch67'nin 621 kaynağının 192'si alfalı (137 RGBA + 55 LA).

Düzeltme `to_webp` içinde kalıcı olarak yapıldı (beyaz zemine yapıştırma). Bu betik yalnızca
ZATEN YAZILMIŞ R2 nesnelerini yeni kodlayıcıyla ÜZERİNE YAZAR — D1'e hiç dokunmaz, çünkü yollar
değişmiyor (aynı anahtar, düzeltilmiş içerik).

Türevler de bayat: `_derived/w{400,800,1600}/r2/<key>` nesneleri siyah orijinalden üretildi ve
drain betiği "zaten var" diyip atlar. Bu yüzden önce SİLİNİR, sonra kuyruğa yeniden yazılır.

Kullanım:
  python3 scripts/fix-batch67-alpha-images.py [--dry-run]
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

d1, q = ib.d1, ib.q
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    payload = json.load(open(os.path.join(HERE, 'output', 'batch67-payload.json'), encoding='utf8'))
    want = {p['slug']: p for p in payload['products']}
    slugs = ','.join(q(s) for s in want)
    rows = d1(f'SELECT id, slug, images, variants FROM products '
              f'WHERE deleted_at IS NULL AND slug IN ({slugs})')

    # Kaynak URL -> R2 anahtarı haritası (D1'deki gerçek yollardan geri kurulur).
    def align(src, got):
        return zip(src[max(0, len(src) - len(got)):], got[max(0, len(got) - len(src)):])

    src_to_key = {}
    for r in rows:
        w = want[r['slug']]
        live = json.loads(r['variants'] or '[]')
        for pv, lv in zip(w['variants'], live):
            for u, p in align(list(pv['srcImages']), list(lv.get('images') or [])):
                src_to_key[u] = p.replace('/media/', '', 1)
        for u, p in align(list(w['images']), json.loads(r['images'] or '[]')):
            src_to_key.setdefault(u, p.replace('/media/', '', 1))

    print(f'{len(rows)} satır, {len(src_to_key)} kaynak->anahtar eşlemesi.\n'
          'Alfa kanallı kaynaklar taranıyor...')

    def scan(u):
        raw = ib.http_get(ib.safe_url(u))
        if not raw:
            return (u, None, None)
        return (u, raw, has_alpha(raw))

    todo = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        for u, raw, alpha in ex.map(scan, list(src_to_key)):
            if raw is None:
                print(f'  UYARI indirilemedi: {u}')
            elif alpha:
                todo.append((u, raw))
    print(f'  alfalı (yeniden üretilecek): {len(todo)}\n')
    if not todo:
        print('Yapılacak iş yok.')
        return 0

    if args.dry_run:
        print(f'[dry-run] {len(todo)} nesne yeniden yazılmazdı.')
        for u, _ in todo[:8]:
            print(f'   {src_to_key[u]}  <- {u[:80]}')
        return 0

    print('--- 1) Orijinaller yeniden kodlanıp üzerine yazılıyor ---')
    written, failed = [], []

    def redo(job):
        u, raw = job
        key = src_to_key[u]
        try:
            webp = ib.to_webp(raw, ib.imp.MAX_IMG_W)
        except Exception as e:
            return (key, False, f'webp: {e}')
        ok, err = ib.r2_put(key, webp)
        if ok:
            with _lock:
                ib.note_derivatives(key, ib.webp_width(webp))
        return (key, ok, err if not ok else None)

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        for key, ok, err in ex.map(redo, todo):
            (written if ok else failed).append(key)
            if not ok:
                print(f'  HATA {key}: {err}')
    print(f'  yazıldı: {len(written)}, hatalı: {len(failed)}')

    print('\n--- 2) Bayat türevler siliniyor ---')
    dels = [f'_derived/w{w}/r2/{k}' for k in written for w in DERIVATIVE_WIDTHS]
    done = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        for ok in ex.map(r2_delete, dels):
            done += 1
            if done % 100 == 0:
                print(f'  {done}/{len(dels)}')
    print(f'  {len(dels)} türev anahtarı silindi (yoksa da sorun değil).')

    print('\n--- 3) Türev kuyruğu ---')
    ib.flush_derivatives_chunked(False)
    print('\nŞimdi: python3 scripts/drain-derivative-queue.py')
    return 0


if __name__ == '__main__':
    sys.exit(main())
