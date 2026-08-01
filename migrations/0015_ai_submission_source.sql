-- Additive migration for the live D1 database (no migrations runner exists yet,
-- so this is applied by hand with `wrangler d1 execute --file`). Matches the
-- schema.sql change:
--   - project_submissions/product_submissions/material_submissions.source_url +
--     ai_generated: AI destekli otomatik ekleme akışının (bkz. src/routes/ai.js)
--     çıkarım yaptığı kaynak sayfa ve moderasyonda görünür bir işaret bırakması
--     için. Manuel gönderimlerde her iki alan da NULL kalır.

ALTER TABLE project_submissions ADD COLUMN source_url TEXT;
ALTER TABLE project_submissions ADD COLUMN ai_generated INTEGER NOT NULL DEFAULT 0;

ALTER TABLE product_submissions ADD COLUMN source_url TEXT;
ALTER TABLE product_submissions ADD COLUMN ai_generated INTEGER NOT NULL DEFAULT 0;

ALTER TABLE material_submissions ADD COLUMN source_url TEXT;
ALTER TABLE material_submissions ADD COLUMN ai_generated INTEGER NOT NULL DEFAULT 0;
