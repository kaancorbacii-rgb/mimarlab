-- Yalnızca admin'in proje ekle/düzenle sayfasından değiştirebildiği "Yayın Tarihi" (bkz. kullanıcı
-- isteği: bu tarih değişince projenin listelerdeki/gönderilerdeki sırası da değişsin). Boşsa
-- (NULL) mevcut davranış (created_at'e göre, en son eklenen ilk) hiç değişmeden korunur — bkz.
-- src/lib/projectPool.js/src/routes/project.js#fetchProjectPageRows'daki COALESCE(publish_date,
-- created_at) DESC sıralaması.
ALTER TABLE project_submissions ADD COLUMN publishDate TEXT;
ALTER TABLE projects ADD COLUMN publish_date TEXT;
