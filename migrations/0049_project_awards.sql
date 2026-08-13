-- proje-ekle.html'e "Ödül" alanı eklendi (bkz. kullanıcı isteği: proje adı/tarih düzeni değişikliği
-- ile birlikte) — architect_submissions/office_submissions.awards ile AYNI JSON dizi deseni, iki
-- tabloda: taslak tarafı (project_submissions, bkz. src/lib/submissionTypes.js#
-- SUBMISSION_TYPES.projects) ve canonical okuma tarafı (projects, bkz.
-- migrations/0022_id_first_entities.sql + src/lib/canonicalSync.js#syncProject/
-- src/lib/canonicalRead.js#JSON_FIELDS).
ALTER TABLE project_submissions ADD COLUMN awards TEXT;
ALTER TABLE projects ADD COLUMN awards TEXT;
