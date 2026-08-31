-- Ürün ↔ Proje ilişkisi ÇİFT YÖNLÜ hale getiriliyor (kullanıcı isteği, 2026-08-31: "Proje
-- popuplarında 'Kullanılan Ürünler' kısmı olduğu gibi Ürün popuplarında da 'Kullanılan Projeler'
-- kısmı ekle ... bir ürün popupında Kullanılan Projeler kısmına bir proje eklenmişse o projenin
-- popupında da Kullanılan Ürünler kısmında o ürün gözüksün").
--
-- 1) product_submissions/material_submissions.projects — urun-ekle.html'deki YENİ "Kullanılan
--    Projeler (opsiyonel)" kutusunun JSON dizisi ([{slug,title}]), project_submissions.brands ile
--    BİREBİR aynı desen (bkz. src/lib/submissionTypes.js#SUBMISSION_TYPES).
--
-- 2) project_products.from_project / from_product — kenar ARTIK iki taraftan da yazılabildiğinden
--    hangi tarafın o kenarı talep ettiği ayrı ayrı işaretlenir. Bu OLMADAN çift yönlülük imkânsız:
--    src/lib/canonicalSync.js#syncProject bir projenin TÜM project_products satırlarını silip
--    brands'ten yeniden kuruyordu; syncProduct'ın aynısını ürün tarafında yapması, karşı tarafın
--    kurduğu kenarları sessizce siler. Her sync artık yalnızca KENDİ bayrağını sıfırlayıp yeniden
--    kurar, iki bayrağı da düşen satır silinir (bkz. o dosyadaki setProjectProductLinks).
--
-- Mevcut satırların hepsi proje tarafından kurulmuştu → from_project=1, from_product=0 (DEFAULT'lar
-- bu yüzden böyle seçildi, ayrı bir backfill UPDATE'ine gerek kalmıyor).

ALTER TABLE product_submissions ADD COLUMN projects TEXT;
ALTER TABLE material_submissions ADD COLUMN projects TEXT;

ALTER TABLE project_products ADD COLUMN from_project INTEGER NOT NULL DEFAULT 1;
ALTER TABLE project_products ADD COLUMN from_product INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_project_products_product ON project_products(product_id);
