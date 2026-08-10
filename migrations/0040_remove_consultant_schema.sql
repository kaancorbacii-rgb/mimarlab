-- Danışman/danışmanlık sisteminin TAMAMEN kaldırılması (bkz. kullanıcı isteği: "final objective is
-- actual code removal, not just URL blocking") — bu sistem hiçbir zaman production'a deploy
-- edilmedi (bkz. audit: production nav/route'larında danışman hiç görünmüyor), bu yüzden burada
-- DROP edilen tablo/kolonlarda gerçek kullanıcı verisi kaybı riski yoktur.
--
-- Kaldırılanlar:
--   - consultation_requests tablosu (migrations/0032_consultation_requests.sql,
--     migrations/0039_consultation_request_phone.sql)
--   - architects.is_consultant/hourly_rate/session_duration_min/expertise_tags/available_slots/
--     consultant_bio/consultant_total_minutes/consultant_sessions_completed
--     (migrations/0031_architect_consultant.sql)
--   - architects.consultant_experience_years (migrations/0033_consultant_experience.sql)
--   - architect_submissions.consultant_request/hourly_rate/session_duration_min/expertise_tags/
--     available_slots/consultant_experience_years (migrations/0034_consultant_submission_fields.sql)
--
-- ÖNEMLİ: migrations/0031-0034 ve 0039 dosyaları SİLİNMEDİ/yeniden numaralandırılmadı — geçmiş
-- migration zincirinin bir parçası olarak repoda kalırlar (bkz. kullanıcı isteği: mevcut migration
-- history'yi sırf temiz görünmesi için değiştirme). Bu migration yalnızca onların oluşturduğu
-- şemayı geri alır, tarihi silmez.
--
-- Bu dosya LOCAL'de test edilmiştir. PRODUCTION'a UYGULANMAMIŞTIR — bkz. final rapor.

DROP TABLE IF EXISTS consultation_requests;

DROP INDEX IF EXISTS idx_architects_consultant;

ALTER TABLE architects DROP COLUMN is_consultant;
ALTER TABLE architects DROP COLUMN hourly_rate;
ALTER TABLE architects DROP COLUMN session_duration_min;
ALTER TABLE architects DROP COLUMN expertise_tags;
ALTER TABLE architects DROP COLUMN available_slots;
ALTER TABLE architects DROP COLUMN consultant_bio;
ALTER TABLE architects DROP COLUMN consultant_total_minutes;
ALTER TABLE architects DROP COLUMN consultant_sessions_completed;
ALTER TABLE architects DROP COLUMN consultant_experience_years;

-- architect_submissions.consultant_request/hourly_rate/session_duration_min/expertise_tags/
-- available_slots/consultant_experience_years (migrations/0034_consultant_submission_fields.sql)
-- KASITLI OLARAK BURADA YOK: yerel geliştirme D1'inde (bkz. final rapor) bu kolonlar hiç mevcut
-- değildi — 0034 hiçbir ortamda gerçekten uygulanmamış görünüyor. Bu satırı çalıştırmak
-- "no such column" hatasıyla başarısız olur. Eğer bu migration ileride 0034'ün GERÇEKTEN
-- uygulandığı bir ortamda çalıştırılacaksa, önce bu ortamda architect_submissions şemasını
-- (PRAGMA table_info(architect_submissions)) kontrol edip gerekirse aşağıdaki 6 satırı ayrı bir
-- takip migration'ında ekleyin — burada tahmine dayalı eklemedik.
