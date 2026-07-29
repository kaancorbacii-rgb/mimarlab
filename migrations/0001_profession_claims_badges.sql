-- Additive migration for the live D1 database (no migrations runner exists yet,
-- so this is applied by hand with `wrangler d1 execute --file`). Matches the
-- schema.sql changes: users.profession/kvkk_accepted_at, profile_claims, badge_requests.

ALTER TABLE users ADD COLUMN profession TEXT;
ALTER TABLE users ADD COLUMN kvkk_accepted_at INTEGER;

CREATE TABLE IF NOT EXISTS profile_claims (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  profile_type TEXT NOT NULL,
  profile_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, profile_type, profile_key)
);
CREATE INDEX IF NOT EXISTS idx_claims_status ON profile_claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_key ON profile_claims(profile_type, profile_key);

CREATE TABLE IF NOT EXISTS badge_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  badge_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  price_try REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_badge_user ON badge_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_badge_status ON badge_requests(status);
