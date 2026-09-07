#!/usr/bin/env python3
"""GÖRSEL ARAMA — CANLI UÇTAN UCA YOKLAMA.

Tarayıcının yaptığını birebir taklit eder: görseli GERÇEK CLIP modeliyle (build-image-embeddings.py
ile aynı Embedder, aynı ONNX) embed eder ve /api/ai/visual-search'e hem dosyayı hem 512 boyutlu
vektörü gönderir — yani sunucu tarafında vision + görsel kanal + kimlik eşleşmesi TAMAMI çalışır.
scripts/vs2-benchmark.mjs yalnızca görsel kanalı (vision'sız) ölçer; bu betik ise kullanıcının
gerçekte gördüğü yanıtı ölçer (matchType, eşleşen proje/ürün, gerekçe).

Canlı uç IP başına 5 dakikada 6 istekle sınırlı (bkz. src/routes/visualSearch.js) — bu yüzden
sorgu seti küçük tutulur ve her sorgu bir kez atılır.

KULLANIM (venv ŞART):
  /tmp/clip_env/bin/python3 scripts/visual-search-live-probe.py --base https://mimarlab.com \
      --case "<etiket>=<görsel URL ya da yerel dosya>" ...
"""
import argparse
import importlib.util as _ilu
import io
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = _ilu.spec_from_file_location('bie', os.path.join(HERE, 'build-image-embeddings.py'))
bie = _ilu.module_from_spec(_spec)
_argv = sys.argv
sys.argv = [sys.argv[0]]
_spec.loader.exec_module(bie)
sys.argv = _argv


def load_bytes(src):
    if src.startswith('http://') or src.startswith('https://'):
        return bie.fetch_image_bytes(src)
    with open(src, 'rb') as f:
        return f.read()


def post_multipart(url, fields, file_field, filename, file_bytes, mime):
    boundary = '----mimarlabprobe%d' % int(time.time() * 1000)
    body = io.BytesIO()
    for k, v in fields.items():
        body.write(('--%s\r\nContent-Disposition: form-data; name="%s"\r\n\r\n%s\r\n' % (boundary, k, v)).encode())
    body.write(('--%s\r\nContent-Disposition: form-data; name="%s"; filename="%s"\r\nContent-Type: %s\r\n\r\n' % (boundary, file_field, filename, mime)).encode())
    body.write(file_bytes)
    body.write(('\r\n--%s--\r\n' % boundary).encode())
    req = urllib.request.Request(url, data=body.getvalue(), method='POST')
    req.add_header('Content-Type', 'multipart/form-data; boundary=%s' % boundary)
    req.add_header('User-Agent', 'Mozilla/5.0 (mimarlab visual-search probe)')
    try:
        with urllib.request.urlopen(req, timeout=90) as res:
            return res.status, json.loads(res.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode('utf-8'))
        except Exception:
            return e.code, {'error': str(e)}


def sniff_mime(b):
    if b[:3] == b'\xff\xd8\xff':
        return 'image/jpeg'
    if b[:8] == b'\x89PNG\r\n\x1a\n':
        return 'image/png'
    if b[:4] == b'RIFF' and b[8:12] == b'WEBP':
        return 'image/webp'
    return 'application/octet-stream'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='https://mimarlab.com')
    ap.add_argument('--case', action='append', default=[], help='etiket=kaynak')
    ap.add_argument('--no-embed', action='store_true', help='CLIP vektörü GÖNDERME (metin yedek kanalını ölç)')
    ap.add_argument('--sleep', type=float, default=2.0)
    args = ap.parse_args()
    if not args.case:
        print('en az bir --case ver'); sys.exit(1)

    emb = None if args.no_embed else bie.Embedder()
    for spec in args.case:
        label, src = spec.split('=', 1)
        b = load_bytes(src)
        mime = sniff_mime(b)
        fields = {}
        if emb is not None:
            # Embedder.embed int8 NİCEMLENMİŞ (×127) birim vektör döner (dizin paketi biçimi);
            # sunucu ise tarayıcının gönderdiği ham float vektörü bekler ve |v|>50'yi reddeder
            # (bkz. visualSearch.js#parseImageEmbedding). /127 ile birim vektöre geri dönülür —
            # kosinüs ölçekten bağımsızdır, sonuç tarayıcı yoluyla birebir aynıdır.
            vec = emb.embed(b)
            fields['imageEmbedding'] = json.dumps([float(x) / 127.0 for x in vec])
        status, data = post_multipart(args.base + '/api/ai/visual-search', fields, 'image', 'probe.' + mime.split('/')[-1], b, mime)
        print('\n=== %s  (%s, %d B, %s)' % (label, src[:90], len(b), mime))
        if status != 200 or not data.get('ok'):
            print('  HTTP', status, data.get('error'))
            time.sleep(args.sleep)
            continue
        a = data.get('analysis') or {}
        print('  matchType:', data.get('matchType'), '| cached:', data.get('cached'), '| aiCalls:', data.get('aiCalls'),
              '| kanal:', a.get('visualChannel'), '| dizin:', a.get('indexed'))
        print('  vision: subject=%s space=%s disc=%s materials=%s identity=%s text=%s place=%s' % (
            a.get('subject'), a.get('spaceType'), a.get('discipline'), a.get('materials'),
            [(g.get('name'), g.get('kind'), g.get('confidence')) for g in (a.get('identity') or [])],
            a.get('visibleText'), a.get('place')))
        m = data.get('match') or {}
        if m.get('project'):
            p = m['project']; print('  EŞLEŞEN PROJE:', p['title'], p.get('signals'), 'conf', p.get('confidence'), 'evidence', p.get('visualEvidence'))
        if m.get('product'):
            p = m['product']; print('  EŞLEŞEN ÜRÜN:', p['title'], p.get('brand'), p.get('signals'), 'conf', p.get('confidence'))
        print('  projeler:', [(p['title'], p['score'], (p.get('visualEvidence') or {}).get('matchType')) for p in data.get('projects', [])][:6])
        print('  ürünler:', [(p['title'], p.get('brand'), p['score']) for p in data.get('products', [])][:6], '| suppressed:', data.get('productsSuppressed'))
        if data.get('message'):
            print('  mesaj:', data['message'])
        time.sleep(args.sleep)


if __name__ == '__main__':
    main()
