#!/usr/bin/env python3
"""batch67 koşusunda indirilemeyen modül görsellerini tamamlar (tek seferlik onarım).

Neden gerekti
-------------
İlk koşuda 5 üründe (Roma, Duende, Serdivan, Vienna, Odette) 13 modül render'ı indirilemedi:
Koleksiyon bu görselleri `/static/content/perspectives/126 SOFA.png` gibi BOŞLUKLU yollarda
tutuyor ve curl, boşluk yüzde-kodlanmadan gönderildiğinde bağlantıyı hiç kurmuyor (http=000).
Düzeltme `import-batch67.py#safe_url`'de kalıcı olarak yapıldı; bu betik yalnızca ZATEN YAZILMIŞ
satırların eksik karelerini tamamlar.

Ne yapar
--------
Payload'daki her versiyonun `srcImages` listesini D1'deki gerçek versiyon görselleriyle
karşılaştırır; eksik olan kaynak URL'leri indirip R2'ye yazar ve versiyonun `images` dizisinde
DOĞRU SIRAYA (modül render'ı en başa) yerleştirir. Ana satırın `images` alanına DOKUNMAZ —
oradaki kapak zaten aile galerisinden geliyor ve eksiksiz.

Idempotent: eksik kare kalmadıysa hiçbir şey yazmaz.

Kullanım:
  python3 scripts/repair-batch67-missing-images.py [--dry-run]
"""

import argparse
import concurrent.futures
import importlib.util as _ilu
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = _ilu.spec_from_file_location('import_batch67', os.path.join(HERE, 'import-batch67.py'))
ib = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(ib)

d1, d1_file, q = ib.d1, ib.d1_file, ib.q
R2_PREFIX = ib.R2_PREFIX


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    payload = json.load(open(os.path.join(HERE, 'output', 'batch67-payload.json'), encoding='utf8'))
    want = {p['slug']: p for p in payload['products']}

    slugs = ','.join(q(s) for s in want)
    rows = d1(f'SELECT id, slug, title, images, variants FROM products '
              f'WHERE deleted_at IS NULL AND slug IN ({slugs})')
    print(f'{len(rows)} satır okundu.\n')

    stmts = 0
    for r in rows:
        w = want.get(r['slug'])
        if not w:
            continue
        live = json.loads(r['variants'] or '[]')
        if len(live) != len(w['variants']):
            print(f"  ATLANDI {r['slug']}: versiyon sayısı tutmuyor ({len(live)} != {len(w['variants'])})")
            continue

        # Kaynak URL -> yazılmış R2 yolu haritasını mevcut satırdan geri kur: payload'daki
        # srcImages sırası ile D1'deki images sırası, YAZILABİLENLER için birebir aynıdır.
        # Hizalama SONDAN yapılır: indirilemeyen kare her zaman listenin BAŞINDAKİ modül
        # render'ıdır (aile galerisi eksiksiz yazıldı), yani son N eleman birebir örtüşür.
        # max(0, ...) şart: GÜNCELLENEN satırlarda (Odette) ana `images` alanı ESKİ kareleri de
        # taşıdığından canlı liste payload'dakinden UZUN olabilir; çıplak çıkarma negatif indeks
        # üretip payload URL'lerini yanlış (eski) R2 yollarına eşlerdi.
        def align(src, got):
            return zip(src[max(0, len(src) - len(got)):], got[max(0, len(got) - len(src)):])

        known = {}
        for pv, lv in zip(w['variants'], live):
            for u, p in align(list(pv['srcImages']), list(lv.get('images') or [])):
                known[u] = p
        for u, p in align(list(w['images']), json.loads(r['images'] or '[]')):
            known.setdefault(u, p)

        missing = [u for pv in w['variants'] for u in pv['srcImages'] if u not in known]
        missing = list(dict.fromkeys(missing))
        if not missing:
            continue

        print(f"  {r['slug']}: {len(missing)} eksik kare indiriliyor...")
        # Anahtar çakışmasını önlemek için mevcut en yüksek indeksin ardından numaralandır.
        used = {int(p.rsplit('/', 1)[-1].split('.')[0])
                for p in known.values() if p.rsplit('/', 1)[-1].split('.')[0].isdigit()}
        nxt = max(used) + 1 if used else 1

        def one(job):
            idx, url = job
            raw = ib.http_get(ib.safe_url(url))
            if not raw:
                return (url, None, 'indirilemedi')
            try:
                webp = ib.to_webp(raw, ib.imp.MAX_IMG_W)
            except Exception as ex:
                return (url, None, f'webp: {ex}')
            key = f"{R2_PREFIX}/{r['slug']}/{idx}.webp"
            if args.dry_run:
                return (url, f'/media/{key}', None)
            ok, err = ib.r2_put(key, webp)
            if ok:
                ib.note_derivatives(key, ib.webp_width(webp))
                return (url, f'/media/{key}', None)
            return (url, None, f'R2: {err}')

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
            for url, path, err in ex.map(one, list(enumerate(missing, start=nxt))):
                if err:
                    print(f'    UYARI: {err}: {url}')
                else:
                    known[url] = path
                    print(f'    + {path}')

        # Versiyonların images dizisini payload sırasına göre yeniden kur.
        for pv, lv in zip(w['variants'], live):
            lv['images'] = [known[u] for u in pv['srcImages'] if u in known]

        if not args.dry_run:
            d1_file(f"UPDATE products SET variants = {q(json.dumps(live, ensure_ascii=False))}, "
                    f"updated_at = datetime('now') WHERE id = {r['id']};")
        stmts += 1
        print(f"    {r['slug']} versiyonları güncellendi.")

    print(f'\n{stmts} ürün onarıldı.')
    if not args.dry_run:
        ib.flush_derivatives_chunked(False)
    return 0


if __name__ == '__main__':
    sys.exit(main())
