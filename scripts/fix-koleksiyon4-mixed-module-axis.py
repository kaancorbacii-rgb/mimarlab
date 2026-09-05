#!/usr/bin/env python3
"""4. parti sonrası düzeltme: AYNI üründe iki farklı MODÜL EKSENİ adı kalmasını giderir.

GERÇEK BULGU (2026-09-05, import sonrası canlı doğrulamada yakalandı). Bir ürünün versiyonları
iki eksen taşır: tip ekseni ("Tip" / "Fonksiyon") ve modül ekseni. Modül ekseninin ADI partiye
göre değişiyor:

  * koleksiyon3 (masa sistemleri) -> "Ölçü / Model"   (kod + ebat: "A0814K · 140×80")
  * koleksiyon4 (bu parti)        -> "Modül"          (çıplak kod: "PBM200")

Mevcut bir satıra bu partiden versiyon EKLENDİĞİNDE ikisi yan yana kalıyor ve
product-modal.js#buildVariantGroups İKİ AYRI hap grubu çiziyor:

    #122 Partita   : "Ölçü / Model" (33 hap) + "Modül" (4 hap)
    #592 Threshold : "Ölçü / Model" (47 hap) + "Modül" (17 hap)
    #599 Era       : "Ölçü / Model" (1)      + "Modül" (1)

Kırık değil (pickVariantIndex en yakın versiyona düşer) ama kullanıcıya AYNI şeyin iki farklı
seçicisi gösteriliyor: "Modül" grubundaki bir hapa basınca "Ölçü / Model" grubu boşta kalıyor.
İki grup tek bir eksende birleştirilir.

HANGİ AD KAZANIR: satırda ÇOĞUNLUKTA olan ad. Üçünde de "Ölçü / Model" çoğunlukta (33/4, 47/17,
1/1 -> eşitlikte mevcut/eski ad korunur), yani bu partinin 22 versiyonu "Ölçü / Model"e taşınır.
Etiket metinlerine DOKUNULMAZ — yalnızca options[].label değişir.

Kullanım: python3 scripts/fix-koleksiyon4-mixed-module-axis.py [--dry-run]
"""
import argparse
import importlib.util as _ilu
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = _ilu.spec_from_file_location('import_archello_products',
                                     os.path.join(HERE, 'import-archello-products.py'))
imp = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(imp)
d1, d1_file, q = imp.d1, imp.d1_file, imp.q

TYPE_AXES = {'Tip', 'Fonksiyon'}
IDS = [121, 122, 132, 133, 134, 228, 450, 473, 488, 561, 592, 599]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    rows = d1(f"SELECT id, title, variants FROM products WHERE id IN ({','.join(map(str, IDS))})")
    stmts = []
    for r in rows:
        variants = json.loads(r['variants'] or '[]')
        counts = {}
        for v in variants:
            for o in (v.get('options') or []):
                if o['label'] not in TYPE_AXES:
                    counts[o['label']] = counts.get(o['label'], 0) + 1
        if len(counts) < 2:
            continue
        # Çoğunluk kazanır; eşitlikte "Ölçü / Model" (eski/mevcut ad) korunur.
        winner = max(counts, key=lambda k: (counts[k], k == 'Ölçü / Model'))
        moved = 0
        for v in variants:
            for o in (v.get('options') or []):
                if o['label'] not in TYPE_AXES and o['label'] != winner:
                    o['label'] = winner
                    moved += 1
        print(f"  #{r['id']:<4} {r['title'][:16]:<16} {counts} -> '{winner}' ({moved} versiyon taşındı)")
        stmts.append(f"UPDATE products SET variants = {q(json.dumps(variants, ensure_ascii=False))} "
                     f"WHERE id = {r['id']}")

    if not stmts:
        print('Karışık eksenli satır yok.')
        return
    if args.dry_run:
        print(f'[dry-run] {len(stmts)} UPDATE yazılmadı.')
        return
    d1_file(';\n'.join(stmts) + ';')
    print(f'{len(stmts)} satır güncellendi.')


if __name__ == '__main__':
    main()
