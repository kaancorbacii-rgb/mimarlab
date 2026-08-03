-- Additive migration for the live D1 database (no migrations runner exists yet,
-- so this is applied by hand with `wrangler d1 execute --file`). Matches the
-- schema.sql change: product_submissions/material_submissions gain an
-- "architect" column (free-text, comma-separated names allowed) — urun-ekle.html
-- gains a Mimar field next to Firma, auto-filled from the picked firma's roster.

ALTER TABLE product_submissions ADD COLUMN architect TEXT;
ALTER TABLE material_submissions ADD COLUMN architect TEXT;
