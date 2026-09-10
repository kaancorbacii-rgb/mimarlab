-- ÜRÜN VERSİYONLARI ARTIK FORMDAN DA DÜZENLENEBİLİR (kullanıcı isteği, 2026-09-10 on birinci tur
-- madde 2: "Ürün popuplarında otomatik yüklediğimiz Versiyonlar künyesini kullanıcılar ürün
-- ekle/düzenle sayfasında da ayarlayabilsinler. Varyasyon seçimi opsiyonel olsun.").
--
-- products.variants (bkz. migrations/0086_product_variants.sql) şimdiye kadar YALNIZCA içe aktarma
-- betikleriyle yazılıyordu; gönderi tabloları bu alanı hiç taşımıyordu, bu yüzden hiçbir yazma yolu
-- ona dokunmuyordu (0086'nın "bir üye/admin düzenlemesi içe aktarılan versiyonları SİLMEZ" güvencesi).
-- Bu güvence KORUNUR: kolon NULL ise ("form bu alanı hiç göndermedi") canonicalSync `variants`'a
-- dokunmaz (yalnızca galeri düzenlemesini uyarlar, bkz. reconcileVariantImages); JSON dizi ise
-- (boş dizi dahil) kullanıcının niyeti olduğu gibi yazılır — bkz. src/lib/submissionTypes.js#
-- nullableArrayFields ve src/lib/canonicalSync.js#syncProduct.
--
-- Biçim products.variants ile BİREBİR aynı ([{label, options:[{label,value}], images, specs,
-- description, sourceUrl}]) — okuma tarafı (product-modal.js) tek bir sözleşme görür.
ALTER TABLE product_submissions ADD COLUMN variants TEXT;
ALTER TABLE material_submissions ADD COLUMN variants TEXT;
