-- Additive migration for the live D1 database (no migrations runner exists yet,
-- so this is applied by hand with `wrangler d1 execute --file`). Matches the
-- schema.sql change:
--   - r2_usage table: single-row cumulative counter for the mimarlab-uploads R2
--     bucket, checked by src/lib/r2Quota.js before every write so the bucket
--     never crosses R2's free tier (10 GB storage / 1M Class A ops per month) —
--     see kullanıcı isteği: "R2 Paid'in asla para çekmesini istemiyorum".
--   - Seeded with the bucket's real current size (`wrangler r2 bucket info
--     mimarlab-uploads` reported 726 kB / 10 objects on 2026-08-01) so the
--     counter starts accurate instead of at zero.

CREATE TABLE IF NOT EXISTS r2_usage (
  id TEXT PRIMARY KEY,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  ops_count INTEGER NOT NULL DEFAULT 0,
  ops_month TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0
);

INSERT INTO r2_usage (id, total_bytes, ops_count, ops_month, updated_at)
VALUES ('singleton', 750000, 0, '', 0)
ON CONFLICT(id) DO NOTHING;
