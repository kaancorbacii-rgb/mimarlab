#!/usr/bin/env python3
"""Vision-tagging ajanlarının ürettiği hotspot önerilerini (scripts/output/hotspots/group-*.json)
projects.image_hotspots'a yazar (2026-09-05).

Şema (bkz. migrations/0076_project_image_hotspots.sql): { "<görsel URL>": [ {x,y,slug,title} ] }.
x/y görselin KENDİSİNE göre yüzde. `title` yalnızca silme fallback'i — canlı render her istekte
brand/görsel/title'ı products'tan yeniden okur (src/routes/project.js#enrichImageHotspots),
yine de tutarlılık için burada da doğru title yazılıyor.

Güvenlik kuralları (submissionTypes.js#sanitizeImageHotspots ile AYNI):
  - proje başına en fazla 60 görsel işlenir (burada zaten çok altındayız)
  - görsel başına en fazla 4 hotspot
  - AYNI görselde aynı ürün slug'ı bir kez (tekillik GÖRSEL bazında, projede değil)

Mevcut image_hotspots içeriği KORUNUR, yalnızca bu betiğin ürettiği YENİ anahtarlar/görseller
eklenir (ör. Nokia projesinde önceden var olan hotspot'lara dokunulmaz).

Kullanım: python3 scripts/import-ersa-hotspots.py [--dry-run]
"""
import argparse
import glob
import importlib.util as _ilu
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = _ilu.spec_from_file_location('import_archello_products',
                                     os.path.join(HERE, 'import-archello-products.py'))
imp = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(imp)
d1, q = imp.d1, imp.q

MAX_HOTSPOTS_PER_IMAGE = 4


def j(v):
    return q(json.dumps(v, ensure_ascii=False))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    tasks = json.load(open('scripts/output/ersa-hotspot-tasks.json', encoding='utf8'))
    url_to_slug = {}
    for t in tasks:
        for im in t['images']:
            url_to_slug[im['final_url']] = t['target_slug']

    prod_refs = json.load(open('scripts/output/ersa-product-ref-manifest.json', encoding='utf8'))
    title_by_slug = {p['slug']: p['title'] for p in prod_refs}

    # görsel URL -> [{x,y,slug,title}] (proje slug'ı bilgisiyle birlikte gruplanacak)
    per_project = {}  # project_slug -> {image_url: [hotspot,...]}
    skipped_unknown_url, skipped_over_limit, skipped_dup = 0, 0, 0

    for f in sorted(glob.glob('scripts/output/hotspots/group-*.json')):
        entries = json.load(open(f, encoding='utf8'))
        for e in entries:
            url = e['final_url']
            pslug = url_to_slug.get(url)
            if not pslug:
                skipped_unknown_url += 1
                continue
            bucket = per_project.setdefault(pslug, {}).setdefault(url, [])
            seen_slugs = {h['slug'] for h in bucket}
            for hs in e['hotspots']:
                if len(bucket) >= MAX_HOTSPOTS_PER_IMAGE:
                    skipped_over_limit += 1
                    break
                if hs['slug'] in seen_slugs:
                    skipped_dup += 1
                    continue
                title = title_by_slug.get(hs['slug'])
                if not title:
                    continue
                bucket.append({'x': round(float(hs['x']), 1), 'y': round(float(hs['y']), 1),
                                'slug': hs['slug'], 'title': title})
                seen_slugs.add(hs['slug'])

    print(f'{len(per_project)} proje için hotspot verisi hazırlandı '
          f'(atlanan: bilinmeyen url={skipped_unknown_url}, limit-aşımı={skipped_over_limit}, mükerrer={skipped_dup})')

    updated = 0
    for pslug, images in per_project.items():
        n_hotspots = sum(len(v) for v in images.values())
        if args.dry_run:
            print(f'[dry] {pslug}: {len(images)} görsel, {n_hotspots} hotspot')
            continue
        row = d1(f"SELECT id, image_hotspots FROM projects WHERE slug = {q(pslug)}")
        if not row:
            print(f'  ! proje bulunamadı, atlandı: {pslug}')
            continue
        row = row[0]
        current = json.loads(row['image_hotspots'] or '{}')
        current.update(images)  # bu betiğin ürettiği anahtarlar zaten proje-özel yeni görseller
        d1(f"UPDATE projects SET image_hotspots = {j(current)}, updated_at = datetime('now') WHERE id = {row['id']}")
        updated += 1
        print(f'  ~ {pslug} (#{row["id"]}): +{len(images)} görsel, +{n_hotspots} hotspot')

    if args.dry_run:
        total_imgs = sum(len(v) for v in per_project.values())
        total_hs = sum(len(h) for v in per_project.values() for h in v.values())
        print(f'\n[dry-run] toplam {len(per_project)} proje, {total_imgs} görsel, {total_hs} hotspot yazılacaktı.')
    else:
        print(f'\nbitti: {updated} proje güncellendi.')


if __name__ == '__main__':
    main()
