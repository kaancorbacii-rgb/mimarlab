-- Additive migration for the live D1 database (no migrations runner exists yet,
-- so this is applied by hand with `wrangler d1 execute --file`). Matches the
-- schema.sql change: project_submissions.brands (JSON array of brand/product
-- names used in the project — matched against offices[].name on proje-detay.html
-- to link to that brand's MİMARLAB profile, same convention as the designer field).

ALTER TABLE project_submissions ADD COLUMN brands TEXT;
