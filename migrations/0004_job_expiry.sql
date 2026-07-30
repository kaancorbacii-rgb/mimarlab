-- Additive migration for the live D1 database (no migrations runner exists yet,
-- so this is applied by hand with `wrangler d1 execute --file`). Matches the
-- schema.sql change: job_submissions.published_at (30-day job listing expiry).

ALTER TABLE job_submissions ADD COLUMN published_at INTEGER;
