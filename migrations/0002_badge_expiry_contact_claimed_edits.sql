-- Additive migration for the live D1 database (no migrations runner exists yet,
-- so this is applied by hand with `wrangler d1 execute --file`). Matches the
-- schema.sql changes:
--   - badge_requests.expires_at (monthly badge rental expiry)
--   - contact_messages table (İletişim sayfası formu -> admin panel)
--   - architect_submissions.claimed_profile_key / office_submissions.claimed_profile_key
--     (owner-editing an existing claimed static profile from hesabim.html)

ALTER TABLE badge_requests ADD COLUMN expires_at INTEGER;

CREATE TABLE IF NOT EXISTS contact_messages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contact_read ON contact_messages(is_read);

ALTER TABLE architect_submissions ADD COLUMN claimed_profile_key TEXT;
CREATE INDEX IF NOT EXISTS idx_architect_claimed_key ON architect_submissions(claimed_profile_key);

ALTER TABLE office_submissions ADD COLUMN claimed_profile_key TEXT;
CREATE INDEX IF NOT EXISTS idx_office_claimed_key ON office_submissions(claimed_profile_key);
