-- FİRMA/MARKA OFİS–MAĞAZA KONUMLARI (kullanıcı isteği, 2026-09-11: "Firma ekle/düzenle ve marka
-- ekle/düzenle sayfalarında aynı proje ekle sayfasında olduğu gibi firma ve markalar ofislerinin ya
-- da mağazalarının bulunduğu konumları seçsinler. Birden fazla konum seçebilirler.").
--
-- projects.lat/lng (bkz. 0066_project_lat_lng.sql) TEK nokta taşır; burada birden fazla nokta
-- gerektiğinden social_links ile AYNI desen: JSON dizi, [{lat,lng,label?}]. Doğrulama/temizleme
-- src/lib/submissionTypes.js#sanitizeOfficeLocations'ta. Taslakta NULL = "form bu alanı hiç
-- göndermedi, canonical'a dokunma" (nullableArrayFields), '[]' = "tüm konumlar silindi".
-- İl/İlçe (offices.loc) ayrı kalır — liste filtreleri ve künye onu okur.
ALTER TABLE offices ADD COLUMN locations TEXT;
ALTER TABLE office_submissions ADD COLUMN locations TEXT;
