-- Additive migration for the live D1 database (no migrations runner exists yet,
-- so this is applied by hand with `wrangler d1 execute --file`). Matches the
-- schema.sql change: product_submissions/material_submissions gain a "specs"
-- column (JSON array of {label, value} pairs, same convention as images) for
-- the new urun-detay.html "Teknik Özellikler" table.

ALTER TABLE product_submissions ADD COLUMN specs TEXT;
ALTER TABLE material_submissions ADD COLUMN specs TEXT;
