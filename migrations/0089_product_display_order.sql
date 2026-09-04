-- Additive migration (elle uygulanır — bkz. migrations/0071_product_files.sql/0085_project_brands.sql'
-- deki AYNI not, d1_migrations tablosu 0014'te takılı kaldığından 'wrangler d1 migrations apply'
-- YERİNE 'wrangler d1 execute --file' kullanılmalı).
--
-- Kullanıcı isteği (2026-09-05): 63 URL'lik Koleksiyon koltuk/sandalye partisi (53 aile, 37 yeni
-- satır) src/routes/product.js#fetchProductPool'un varsayılan `ORDER BY id DESC` sıralamasında
-- hepsi EN YENİ (en yüksek id) oldukları için /urun'ün 1. sayfasına YIĞILIYORDU —
-- migrations/0087_project_display_order.sql'in projects için çözdüğü SORUNUN BİREBİR AYNISI,
-- burada products için uygulanır (0087'nin kendi notu: "gerçek çözüm AÇIK BİR SIRALAMA KOLONU").
--
-- Tasarım 0087 ile BİREBİR AYNI: display_order INTEGER, NULL = "henüz atanmamış". ORDER BY
-- COALESCE(display_order, 0) ASC, id DESC kullanılacak (bkz. src/routes/product.js#fetchProductPool).
-- 0 değeri MEVCUT/atanmış her display_order'dan (>=1) küçük olduğundan, display_order'ı HİÇ
-- atanmamış (NULL) her gelecekteki normal ürün submission/admin ekleme akışı otomatik olarak en
-- üstte (en yeni pozisyonda) görünmeye devam eder — submission/insert kod yoluna DOKUNULMADI,
-- yalnızca BU partinin 37 yeni satırına elle bir display_order atanıp mevcut canlı satırların
-- arasına serpiştirildi (bkz. scripts/koleksiyon2-spread-display-order.py, bu migration'ın
-- kapsamı dışında — 0087'nin "backfill script ayrı" kararıyla AYNI).
ALTER TABLE products ADD COLUMN display_order INTEGER;

-- fetchProductPool tam tablo taraması yapıyor (LIMIT/OFFSET YOK, bkz. dosya başı yorumu — sonuç
-- KV'de önbelleklenir), bu yüzden yeni sıralama ifadesini karşılayacak bir index EKLEMEK ZORUNLU
-- değil (0067/0087'deki projects.build_status filtreli sorgunun aksine, products sorgusunda WHERE
-- deleted_at IS NULL AND hidden_at IS NULL dışında filtre yok ve zaten tüm satırlar okunuyor) —
-- yine de aynı iki kolonu kapsayan bir index, gelecekte LIMIT/OFFSET'e geçilirse "USE TEMP B-TREE
-- FOR ORDER BY"yı önler (bkz. migrations/0067_project_list_order_index.sql'deki performans notu).
CREATE INDEX IF NOT EXISTS idx_products_list_order
  ON products(COALESCE(display_order, 0) ASC, id DESC)
  WHERE deleted_at IS NULL AND hidden_at IS NULL;
