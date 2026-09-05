#!/usr/bin/env python3
"""Ersa proje payload'ındaki TÜM galeri görsellerini indirir, WebP'ye çevirir, YEREL diske yazar.

R2'ye YÜKLEMEZ (bu adım import-ersa-projects.py'de) — görselleri yerelde tutmamızın nedeni,
sonraki adımda (hotspot vision-tagging) aynı dosyaların Read/vision ile TEKRAR incelenmesi
gerekiyor; R2'den geri indirmek yerine tek seferde indirip iki adımda da kullanıyoruz.

R2 anahtar / final URL şeması:
  create : projects/<yeni-slug>-<n>.webp      -> https://mimarlab.com/media/projects/<yeni-slug>-<n>.webp
  enrich : projects/<mevcut-slug>-ersa-<n>.webp -> https://mimarlab.com/media/projects/<mevcut-slug>-ersa-<n>.webp
           ("-ersa-" eki: mevcut galerinin anahtar şeması karışık (miras/*, projects/proje-*.jpg,
           /media/u/<uuid>/*) — YENİ eklenen görsel index'i mevcutlarla ÇAKIŞMASIN diye ayrı ad
           alanı, mevcut hiçbir şeye dokunulmuyor, sadece EKLENİYOR).

Kullanım: python3 scripts/ersa-projects-fetch-images.py
Çıktı: <scratch>/ersa-images/*.webp + scripts/output/ersa-projects-image-manifest.json
"""
import concurrent.futures
import importlib.util as _ilu
import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = _ilu.spec_from_file_location('import_archello_products',
                                     os.path.join(HERE, 'import-archello-products.py'))
imp = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(imp)
http_get, to_webp = imp.http_get, imp.to_webp

SCRATCH = '/private/tmp/claude-501/-Users-kaancorbaci-Projects-mimarlab--claude-worktrees-product-popup-similar-company-products-806073/f618073b-a1cf-4c18-8b1f-e52ed7282b36/scratchpad/ersa-images'
MAX_W = 1600
CDN_PREFIX = 'https://mimarlab.com/media/'


def build_jobs(payload):
    jobs = []
    for p in payload['create']:
        for i, url in enumerate(p['image_urls'], start=1):
            key = f"projects/{p['slug']}-{i}.webp"
            jobs.append({'src_url': url, 'r2_key': key, 'final_url': CDN_PREFIX + key,
                         'owner': ('create', p['ersa_slug'])})
    # aynı MİMARLAB projesine birden fazla ersa sayfası zenginleştirebilir (Rami x2) — index
    # bu proje için TÜM enrich girdileri arasında SÜREKLİ artmalı, çakışma olmasın.
    per_project_counter = {}
    for p in payload['enrich']:
        pid = p['project_id']
        for url in p['new_image_urls']:
            n = per_project_counter.get(pid, 0) + 1
            per_project_counter[pid] = n
            key = f"projects/{p['project_slug']}-ersa-{n}.webp"
            jobs.append({'src_url': url, 'r2_key': key, 'final_url': CDN_PREFIX + key,
                         'owner': ('enrich', p['ersa_slug'])})
    return jobs


def process(job):
    fname = job['r2_key'].replace('/', '__') + '.local.webp'
    local_path = os.path.join(SCRATCH, fname)
    if os.path.exists(local_path):
        job['local_path'] = local_path
        job['ok'] = True
        return job
    raw = http_get(job['src_url'])
    if not raw:
        job['ok'] = False
        job['error'] = 'fetch-failed'
        return job
    try:
        webp = to_webp(raw, MAX_W)
    except Exception as e:
        job['ok'] = False
        job['error'] = f'convert-failed: {e}'
        return job
    with open(local_path, 'wb') as f:
        f.write(webp)
    job['local_path'] = local_path
    job['ok'] = True
    return job


def main():
    os.makedirs(SCRATCH, exist_ok=True)
    payload = json.load(open('scripts/output/ersa-projects-payload.json', encoding='utf8'))
    jobs = build_jobs(payload)
    print(f'{len(jobs)} görsel işlenecek...')

    done, fails = 0, []
    manifest = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        for job in ex.map(process, jobs):
            done += 1
            if job['ok']:
                manifest.append(job)
            else:
                fails.append(job)
            if done % 50 == 0:
                print(f'  {done}/{len(jobs)}  (hata: {len(fails)})')

    json.dump(manifest, open('scripts/output/ersa-projects-image-manifest.json', 'w', encoding='utf8'),
               ensure_ascii=False, indent=2)
    print(f'\nbitti: {len(manifest)} başarılı, {len(fails)} hata')
    for f in fails:
        print('  HATA', f['owner'], f['src_url'], f.get('error'))
    print('Manifest: scripts/output/ersa-projects-image-manifest.json')


if __name__ == '__main__':
    main()
