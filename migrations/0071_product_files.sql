-- Additive migration (applied by hand — bkz. migrations/0042_product_designer_year.sql'deki AYNI not,
-- d1_migrations tablosu 0014'te takılı kaldığından `wrangler d1 migrations apply` yerine
-- `wrangler d1 execute --file` kullanılmalı). Ürün pop-up'ındaki "Dosyalar (BIM, CAD, 3D, Katalog)"
-- açılır bölümüne (bkz. js/components/product-modal.js#renderFilesSection, kullanıcı isteği: "Ürün
-- Ekle/Düzenle sayfasında ... dosya yükleme kutusu ekle") gerçek veri sağlamak için
-- product_submissions/material_submissions VE canonical products tablosuna yeni bir sütun eklenir —
-- JSON dizi [{url, filename, format, size}], images/specs İLE AYNI desen (bkz. src/lib/
-- submissionTypes.js#SUBMISSION_TYPES.products.arrayFields).
ALTER TABLE product_submissions ADD COLUMN files TEXT;
ALTER TABLE material_submissions ADD COLUMN files TEXT;
ALTER TABLE products ADD COLUMN files TEXT;
