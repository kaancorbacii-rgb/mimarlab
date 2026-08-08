-- Danışman Ekle self-serve başvuru formu (bkz. kullanıcı isteği: /danisman sidebar'ına "Danışman
-- Ekle" pop-up'ı) — migrations/0031_architect_consultant.sql/0033_consultant_experience.sql'in
-- bilinçli olarak "self-serve giriş ekranı YOK" bıraktığı yeri dolduruyor. Ayrı bir tablo yerine
-- mevcut architect_submissions'a eklenir: bu tablo zaten "yeni bir mimar kaydı öner, admin onaylasın"
-- akışını (src/routes/submissions.js#createSubmission, src/lib/canonicalSync.js#syncArchitect)
-- yürütüyor — danışmanlık, o akışın üzerine binen ek bir bayrak + birkaç ek alan. consultant_request
-- ayırt edici bayrak: normal bir "beni mimar olarak ekle" gönderisiyle karışmasın (bkz.
-- src/lib/submissionTypes.js#normalizeSubmission'daki ai_generated ile AYNI boolean-coerce deseni).
-- Onaylandığında bu alanlar architects.is_consultant/hourly_rate/session_duration_min/
-- expertise_tags/available_slots/consultant_experience_years'e kopyalanır (bkz.
-- src/lib/canonicalSync.js#syncArchitect).
ALTER TABLE architect_submissions ADD COLUMN consultant_request INTEGER NOT NULL DEFAULT 0;
ALTER TABLE architect_submissions ADD COLUMN hourly_rate INTEGER;
ALTER TABLE architect_submissions ADD COLUMN session_duration_min INTEGER;
ALTER TABLE architect_submissions ADD COLUMN expertise_tags TEXT;
ALTER TABLE architect_submissions ADD COLUMN available_slots TEXT;
ALTER TABLE architect_submissions ADD COLUMN consultant_experience_years INTEGER;
CREATE INDEX IF NOT EXISTS idx_architect_submissions_consultant ON architect_submissions(consultant_request) WHERE consultant_request = 1;
