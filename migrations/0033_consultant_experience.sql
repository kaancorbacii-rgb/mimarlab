-- "Tecrübe" filtresi (bkz. kullanıcı isteği: 0-5/5-10/10+ Yıl aralıkları) — diğer danışmanlık
-- kolonlarıyla AYNI desen (migrations/0031_architect_consultant.sql), yalnızca migration/seed SQL
-- ile elle doldurulur, admin/self-serve giriş ekranı yok.
ALTER TABLE architects ADD COLUMN consultant_experience_years INTEGER;
