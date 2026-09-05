#!/usr/bin/env python3
"""Koleksiyon referans projelerindeki ÜRÜN listelerini MİMARLAB projelerine bağlar.

=============================================================================================
ÖNCEKİ TURUN HATASI VE DÜZELTMESİ (2026-09-05)
=============================================================================================
crosstag-koleksiyon4-projects.py "koleksiyondesign.com proje sayfalarında ürün ızgarası YOK"
diyerek hiç `project_products` kenarı yazmamıştı. **BU YANLIŞTI — ÖRNEKLEM HATASI.** O sonuç
yalnızca DÖRT projeye (unilever / tbwa / sahibinden / mercedes-benz) bakılarak çıkarılmıştı ve
dördü de ürünsüz sayfalardı. Kullanıcı uyarınca 34 projenin TAMAMI tarandı: 4 projede GERÇEK
ürün listesi var (11 bağlantı).

Ayrıca ilk taramadaki regex `/urunler/<a>/<b>/<c>/` deseni sondaki '/' zorunlu tutuyordu ve
sayfadaki bağlantılar sonda '/' TAŞIMIYOR — bu yüzden 0 sonuç dönüyordu. Doğru desen:
`/tr/urunler/([a-z0-9-]+/[a-z0-9-]+/[a-z0-9-]+)/?`

TARAMA SONUCU (34/34 proje, kategori listelerinden doğru <kategori>/<slug> yoluyla):
  cognita                    4 ürün  (hug-sehpalar, terna-sehpalar, lilia-kanepeler, helen-sandalyeler)
  topos-villa                3 ürün  (terna-sehpalar, homer-koltuklar, milos-koltuklar)
  kuwait-universitesi        3 ürün  (narcissus-sehpalar, ikaros-kanepeler, suri-tabureler-ve-puflar)
  acibadem-kartal-hastanesi  1 ürün  (helen-ofis-sandalyeleri)
  diğer 30 proje             0 ürün

=============================================================================================
YALNIZCA 1 PROJE YAZILABİLİR — diğer 3'ünün MİMARLAB'da karşılığı YOK
=============================================================================================
Ürün kenarı yazabilmek için projenin D1'de bulunması ŞART:
  * topos-villa              -> #894 "Villa Topos" (İzmir, 2018) ✓ EŞLEŞTİ
      (önceki partide kelime sırası değişimiyle doğrulanmıştı: "Topos Villa" -> "Villa Topos",
       aynı şehir; marka kenarı da zaten var)
  * cognita                  -> D1'de "Cognita" adayı YOK (aranan: %Cognita%)
  * kuwait-universitesi      -> D1'de "Kuwait/Kuveyt" adayı YOK
  * acibadem-kartal-hastanesi-> D1'de Acıbadem Kartal Hastanesi YOK. "%Kartal%" üç kayıt döner
      (Kartal Dragos Kahramanlar Camii, Kartal Haftasonu Evi, Siemens Kartal Kampüsü) — hiçbiri
      bir Acıbadem hastanesi değil, ELENDİ.

Villa Topos'un üç ürününün ÜÇÜ DE MİMARLAB'da (source_url ile birebir eşleşti):
  terna-sehpalar   -> #643 Terna     (bu partide eklendi)
  homer-koltuklar  -> #572 Homer
  milos-koltuklar  -> #586 Milos

=============================================================================================
NEDEN from_product = 1
=============================================================================================
Bu kenarın kanıtı MARKANIN kendi referans sayfası, yani ÜRÜN tarafı. Bayrak seçimi kozmetik
DEĞİL, kalıcılık meselesi: `canonicalSync.js#setProjectProductLinks` proje tarafından bir
kayıt geldiğinde ÖNCE o projenin tüm satırlarında `from_project = 0` yapar, sonra iki bayrağı
da 0 olan satırları SİLER. from_project=1 yazsaydık, proje sahibi projesini bir kez
kaydettiğinde bu üç kenar sessizce yok olurdu. from_product=1 onları korur (ürün tarafından
kurulmuş kenar olarak).

Kullanım: python3 scripts/crosstag-koleksiyon4-project-products.py [--dry-run]
"""
import argparse
import importlib.util as _ilu
import os

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = _ilu.spec_from_file_location('import_archello_products',
                                     os.path.join(HERE, 'import-archello-products.py'))
imp = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(imp)
d1, d1_file = imp.d1, imp.d1_file

# project_id -> [(product_id, dayanak)]
EDGES = {
    894: [  # Villa Topos (İzmir, 2018) <- koleksiyondesign.com/tr/projeler/yasam/topos-villa/
        (643, 'terna-sehpalar'),
        (572, 'homer-koltuklar'),
        (586, 'milos-koltuklar'),
    ],
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    pairs = [(pid, prid, why) for pid, lst in EDGES.items() for prid, why in lst]
    ids = ','.join(str(p) for p in {x[1] for x in pairs})
    prods = {r['id']: r['title'] for r in d1(f'SELECT id, title FROM products WHERE id IN ({ids})')}
    projs = {r['id']: r['title'] for r in
             d1(f"SELECT id, title FROM projects WHERE id IN ({','.join(map(str, EDGES))})")}
    existing = {(r['project_id'], r['product_id']) for r in d1(
        f"SELECT project_id, product_id FROM project_products "
        f"WHERE project_id IN ({','.join(map(str, EDGES))})")}

    todo = []
    for pid, prid, why in pairs:
        state = 'ZATEN VAR' if (pid, prid) in existing else 'EKLENECEK'
        print(f"  {projs.get(pid, '?')[:20]:<22} <- {prods.get(prid, '?')[:16]:<16} "
              f"#{prid:<5} {state:10} {why}")
        if (pid, prid) not in existing:
            todo.append((pid, prid))

    if not todo:
        print('Eklenecek yeni ürün kenarı yok.')
        return
    if args.dry_run:
        print(f'[dry-run] {len(todo)} kenar yazılmadı.')
        return

    # from_product=1 / from_project=0 — bkz. dosya başı "NEDEN from_product = 1".
    stmts = [f'INSERT INTO project_products (project_id, product_id, from_project, from_product) '
             f'VALUES ({pid}, {prid}, 0, 1) '
             f'ON CONFLICT(project_id, product_id) DO UPDATE SET from_product = 1'
             for pid, prid in todo]
    d1_file(';\n'.join(stmts) + ';')
    print(f'{len(todo)} ürün kenarı yazıldı.')


if __name__ == '__main__':
    main()
