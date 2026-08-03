-- Additive migration for the live D1 database (no migrations runner exists yet,
-- so this is applied by hand with `wrangler d1 execute --file`). Matches the
-- schema.sql change: project_submissions gains a "discipline" column (JSON
-- array, same convention as category/type) for the new proje.html/proje-detay.html
-- "Tür" facet (Mimari / İç Mekan / Peyzaj ve Kentsel Tasarım / Restorasyon).

ALTER TABLE project_submissions ADD COLUMN discipline TEXT;
