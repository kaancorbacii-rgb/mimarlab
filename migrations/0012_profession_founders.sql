-- architect_submissions: yeni "Meslek" alanı (mimar-ekle.html) — mevcut "position" (Pozisyon)
-- kolonundan ayrı, Mimar/İç Mimar/Peyzaj Mimarı vb. serbest bir meslek etiketi tutar.
ALTER TABLE architect_submissions ADD COLUMN profession TEXT;

-- office_submissions: yeni "Kurucular" alanı (ofis-ekle.html) — awards ile aynı şekilde JSON
-- dizisi olarak saklanan, siteye kayıtlı mimar isimlerinden oluşan bir liste.
ALTER TABLE office_submissions ADD COLUMN founders TEXT;
