-- Additive migration (applied by hand, bkz. migrations/0020_product_architect.sql'deki AYNI not —
-- d1_migrations tablosu 0014'te takılı kaldığından burada da `wrangler d1 migrations apply` yerine
-- `wrangler d1 execute --file` kullanılmalı). urun-ekle.html'deki Mimar kutusunun yerini alan Yıl +
-- Tasarımcı kutucukları (bkz. kullanıcı isteği) için product_submissions/material_submissions VE
-- canonical products tablosuna yeni sütunlar ekler — architect sütunu (bkz. 0020) hiçbir zaman
-- canonical satıra taşınmadığından (product_architects join tablosu doldurulur ama hiçbir okuma
-- yolu onu tüketmiyordu — gerçek bulgu) silinmeden bırakılır, yalnızca artık yazılmıyor.

ALTER TABLE product_submissions ADD COLUMN designer TEXT;
ALTER TABLE product_submissions ADD COLUMN year TEXT;
ALTER TABLE material_submissions ADD COLUMN designer TEXT;
ALTER TABLE material_submissions ADD COLUMN year TEXT;
ALTER TABLE products ADD COLUMN designer TEXT;
ALTER TABLE products ADD COLUMN year TEXT;

-- Backfill — gerçek bulgu: src/lib/canonicalSync.js#syncProduct hiçbir zaman legacy_key yazmıyordu,
-- bu yüzden ürün/malzeme gönderisi kökenli HİÇBİR canonical satırda "submission:<id>" işareti yoktu
-- ve src/routes/product.js#shapeProductItem'ın item.submissionId'si HER ZAMAN null geliyordu — hem
-- "Gönderiyi Düzenle" butonu hem de (bu görevle eklenen) sahibin Sil/Arşivle yetkisi bu satırlarda
-- hiç görünmüyordu. syncProduct artık marker'ı yazıyor (kod değişikliği); bu satır zaten canlıdaki
-- mevcut gönderi kökenli ürünleri de aynı işaretle geriye dönük etiketler. slug='m-<submissionId>'
-- deseni (bkz. syncProduct yorumu) submissionId'yi slug'ın kendisinden güvenle çıkarır.
UPDATE products SET legacy_key = 'submission:' || substr(slug, 3)
WHERE source = 'submission' AND legacy_key IS NULL AND slug LIKE 'm-%';
