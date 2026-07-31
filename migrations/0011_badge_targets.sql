-- Matches the schema.sql addition: badge_requests gains target_type/target_key so a person can
-- hold a personal ('self') badge and one or more brand ('office') badges independently, instead
-- of a single badge leaking onto every profile the user has an approved claim for.

ALTER TABLE badge_requests ADD COLUMN target_type TEXT NOT NULL DEFAULT 'self';
ALTER TABLE badge_requests ADD COLUMN target_key TEXT;
CREATE INDEX IF NOT EXISTS idx_badge_target ON badge_requests(target_type, target_key);
