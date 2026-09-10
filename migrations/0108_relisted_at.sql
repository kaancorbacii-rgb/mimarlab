-- "Yeniden yayına alındı" damgası — kullanıcı isteği, 2026-09-10:
-- "Eğer üzeri blurlu bir gönderi telif hakkı onayı verilip paylaşılırsa yeni bir paylaşım gibi
--  ilk sıraya yerleşsin."
--
-- Önizlemeden çıkan bir kayıt, kendi ESKİ tarihine (publish_date/created_at/id) göre sıralandığında
-- listenin ortasında bir yere düşerdi — kullanıcı onu göremez. relisted_at, yayına alma ANINI
-- tutar ve liste sıralamasında canlı kayıtlar arasında EN ÖNE geçirir.
--
-- SIRALAMA SÖZLEŞMESİ (dört havuzda da AYNI):
--   ORDER BY (preview_at IS NOT NULL) ASC,   -- yayındakiler önce, soluk önizlemeler sonra
--            relisted_at DESC,               -- SQLite'ta DESC sıralamada NULL'lar SONA düşer,
--                                            -- yani yeni yayına alınanlar en başa gelir
--            <havuzun kendi mevcut ölçütleri>
ALTER TABLE architects ADD COLUMN relisted_at TEXT;
ALTER TABLE offices ADD COLUMN relisted_at TEXT;
ALTER TABLE projects ADD COLUMN relisted_at TEXT;
ALTER TABLE products ADD COLUMN relisted_at TEXT;
