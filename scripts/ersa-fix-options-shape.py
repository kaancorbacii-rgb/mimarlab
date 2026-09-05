#!/usr/bin/env python3
"""ACİL DÜZELTME (2026-09-05): import-ersa.py her variant'a `options: {}` (BOŞ NESNE) yazdı, ama
src/lib/seo.js#variantGroups `(v.options || []).forEach(...)` çağırıyor — `{}` JS'te TRUTHY
olduğundan `|| []` fallback'i devreye girmiyor ve `{}.forEach` TypeError fırlatıyor. Bu, 2+ versiyonlu
HER Ersa ürününün SSR detay sayfasını (`/urun/<slug>`) 503 ile ÇÖKERTİYORDU (tek versiyonlu ürünler
`variants.length < 2` koruması sayesinde etkilenmedi — bkz. seo.js:151).

Canlıda zaten yazılmış TÜM Ersa (brand_office_id=769) satırlarının `variants` JSON'unu okuyup her
elemanın `options` alanını `{}` -> `[]` olarak düzeltir. images/specs/files/label'a DOKUNULMAZ.

Kullanım:
  python3 scripts/ersa-fix-options-shape.py [--dry-run]
"""
import argparse
import importlib.util as _ilu
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = _ilu.spec_from_file_location('import_archello_products',
                                     os.path.join(HERE, 'import-archello-products.py'))
imp = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(imp)
d1, d1_file, q = imp.d1, imp.d1_file, imp.q

ERSA_OFFICE_ID = 769


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    rows = d1(f'SELECT id, slug, variants FROM products '
              f'WHERE brand_office_id = {ERSA_OFFICE_ID} AND deleted_at IS NULL AND variants IS NOT NULL')
    print(f'{len(rows)} varyantlı Ersa ürünü bulundu.')

    stmts, fixed = [], 0
    for r in rows:
        try:
            variants = json.loads(r['variants'])
        except (TypeError, ValueError):
            continue
        changed = False
        for v in variants:
            if isinstance(v.get('options'), dict):
                v['options'] = []
                changed = True
        if changed:
            fixed += 1
            stmts.append(f"UPDATE products SET variants = {q(json.dumps(variants, ensure_ascii=False))} "
                         f"WHERE id = {r['id']};")
            print(f"  düzeltilecek: #{r['id']} {r['slug']}")

    print(f'\n{fixed} ürünün variants.options şekli düzeltilecek.')
    if args.dry_run:
        print('[dry-run] yazılmadı.')
        return 0
    if stmts:
        d1_file('\n'.join(stmts))
        print('Yazıldı.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
