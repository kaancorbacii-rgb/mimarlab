-- Additive migration for the live D1 database (no migrations runner exists yet,
-- so this is applied by hand with `wrangler d1 execute --file`). Matches the
-- schema.sql change:
--   - legacy_content_hidden table (admin hides/unhides a legacy static record —
--     project/architect/office/product/material/news — that has no DB row of its
--     own, keyed by the record's natural key, same pattern as profile_claims).

CREATE TABLE IF NOT EXISTS legacy_content_hidden (
  id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL, -- 'projects' | 'architects' | 'offices' | 'products' | 'materials' | 'news'
  content_key TEXT NOT NULL,
  hidden_by_user_id TEXT NOT NULL REFERENCES users(id),
  hidden_at INTEGER NOT NULL,
  UNIQUE(content_type, content_key)
);
CREATE INDEX IF NOT EXISTS idx_legacy_hidden_type ON legacy_content_hidden(content_type);
