-- Fotoğrafçı ↔ proje bağlantısı (kullanıcı isteği, 2026-09-01 madde 6: "Fotoğrafçılar için de
-- popuplar olsun ... kişinin popupında Fotoğraflarım kısmı olsun ... proje ekle/düzenle sayfasında
-- fotoğrafçılar kutucuğu da mimar kutucuğuyla aynı mantıkta çalışsın").
--
-- NEDEN AYRI BİR TABLO DEĞİL DE architects'e BAĞLANIYOR: fotoğrafçı da bir KİŞİ profilidir; site
-- zaten kişileri tek bir tabloda (architects) tutuyor ve aynı isteğin son cümlesi "bir kullanıcı ...
-- birden fazla meslek seçebilsin" diyor — yani bir kişi hem Mimar hem Fotoğrafçı olabilir. Ayrı bir
-- `photographers` tablosu, aynı insanı iki satıra bölüp popup/rozet/sahiplenme/mesaj sistemlerinin
-- HEPSİNİ ikiye çatallardı. Bu yüzden fotoğrafçılar architects satırlarıdır, yalnızca
-- architects.profession alanı "Fotoğrafçı" (ya da "Mimar, Fotoğrafçı") etiketini taşır.
--
-- projects.photo_credit_text (serbest metin) KALDIRILMADI: eşleşmeyen/profilsiz fotoğrafçı adları
-- için hâlâ tek kaynak odur ve /api/photographers/search onun üzerinden çalışır (bkz.
-- src/routes/project.js). Bu tablo yalnızca o metindeki isimlerden GERÇEK bir profile karşılık
-- gelenler için ayrıca bir kenar tutar — project_designers'ın fotoğrafçı karşılığı.
CREATE TABLE IF NOT EXISTS project_photographers (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  architect_id INTEGER NOT NULL REFERENCES architects(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, architect_id)
);
CREATE INDEX IF NOT EXISTS idx_project_photographers_architect ON project_photographers(architect_id);
