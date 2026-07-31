-- Additive migration for the live D1 database (no migrations runner exists yet,
-- so this is applied by hand with `wrangler d1 execute --file`). Matches the
-- schema.sql change:
--   - project_submissions.claimed_slug (admin editing an existing static project
--     from projeler-data.js — same pattern as architect/office claimed_profile_key,
--     but admin-only: projects have no owner-claim flow for regular members).

ALTER TABLE project_submissions ADD COLUMN claimed_slug TEXT;
CREATE INDEX IF NOT EXISTS idx_project_claimed_slug ON project_submissions(claimed_slug);
