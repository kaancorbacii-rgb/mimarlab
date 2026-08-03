-- Additive migration for the live D1 database (no migrations runner exists yet,
-- so this is applied by hand with `wrangler d1 execute --file`). Matches the
-- schema.sql change: architect_submissions gains an "about" column (free-text
-- bio), mirroring office_submissions.about — mimar-ekle.html's Kişisel Bilgiler
-- section gains an Açıklama textarea, shown on mimar-detay.html under the name.

ALTER TABLE architect_submissions ADD COLUMN about TEXT;
