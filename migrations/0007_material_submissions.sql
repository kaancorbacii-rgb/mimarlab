-- Additive migration for the live D1 database. Matches the schema.sql change:
-- material_submissions table for the new Malzeme (yapı malzemeleri) page/flow,
-- parallel to product_submissions (bkz. src/lib/submissionTypes.js#materials).

CREATE TABLE IF NOT EXISTS material_submissions (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  title TEXT NOT NULL,
  brand TEXT,
  website TEXT,
  category TEXT,
  description TEXT,
  images TEXT
);
CREATE INDEX IF NOT EXISTS idx_material_owner ON material_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_material_status ON material_submissions(status);
