-- Additive migration for the live D1 database (no migrations runner exists yet,
-- so this is applied by hand with `wrangler d1 execute --file`). Matches the
-- schema.sql change: users.company — a free, unverified self-tag ("hangi
-- firmada çalışıyorsun") chosen from the full firma list in the account edit
-- screen, unrelated to the profile_claims ownership/verification system.

ALTER TABLE users ADD COLUMN company TEXT;
