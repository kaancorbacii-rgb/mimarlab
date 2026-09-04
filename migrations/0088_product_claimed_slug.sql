-- Ürün/malzeme sahiplenme (claim) desteği — kullanıcı isteği (2026-09-05): "Ürün ekle ile ürün
-- düzenle birbiriyle entegre değil mi? Proje ekle ve proje düzenle de kurduğumuz entegre sistemin
-- ürün ekle/düzenle için de aynı olması gerekiyor." Şimdiye dek products/materials'ta architects/
-- offices/projects'teki gibi bir "statik bir kaydı onaylı bir profile_claims ile sahiplenip
-- düzenleme" akışı YOKTU (bkz. src/lib/canonicalSync.js#syncProduct'taki eski "products/
-- materials'ta claim sistemi yok" yorumu) — bir markanın (offices satırı) sahibi, o markaya ait
-- toplu içe aktarılmış (legacy_static) bir ürünü/malzemeyi "bu ürün bana ait" diyip düzenleyemiyordu,
-- yalnızca admin urun-ekle.html?adminedit= ile doğrudan düzenleyebiliyordu.
--
-- project_submissions.claimed_slug İLE AYNI şekil/gerekçe: dolu olduğunda bu satır yeni bir ürün
-- DEĞİL, canonical products tablosundaki (slug veya legacy_key eşleşmesiyle) statik bir kaydın
-- ÜZERİNE bindirilen bir düzenlemedir (bkz. src/lib/canonicalSync.js#syncProduct'a eklenen
-- claimedSlug dalı, src/routes/submissions.js#verifyProductClaimedSlug).
ALTER TABLE product_submissions ADD COLUMN claimed_slug TEXT;
ALTER TABLE material_submissions ADD COLUMN claimed_slug TEXT;

CREATE INDEX IF NOT EXISTS idx_product_claimed_slug ON product_submissions(claimed_slug);
CREATE INDEX IF NOT EXISTS idx_material_claimed_slug ON material_submissions(claimed_slug);
