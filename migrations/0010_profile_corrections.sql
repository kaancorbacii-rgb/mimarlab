-- Matches the schema.sql addition: a profile_corrections table for the new "Düzeltme Öner"
-- box under "Bilgi kaynağı" on mimar-detay.html/ofis-detay.html — distinct from profile_claims
-- (ownership claims), no uniqueness constraint since a user can send more than one suggestion.

CREATE TABLE IF NOT EXISTS profile_corrections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  profile_type TEXT NOT NULL,
  profile_key TEXT NOT NULL,
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_corrections_status ON profile_corrections(status);
CREATE INDEX IF NOT EXISTS idx_corrections_key ON profile_corrections(profile_type, profile_key);
