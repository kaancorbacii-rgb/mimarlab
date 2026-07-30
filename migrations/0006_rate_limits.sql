-- Additive migration for the live D1 database (no migrations runner exists yet,
-- so this is applied by hand with `wrangler d1 execute --file`). Matches the
-- schema.sql change: rate_limits table for src/lib/rateLimit.js (login/signup/
-- forgot-password/contact brute-force & spam protection).

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at);
