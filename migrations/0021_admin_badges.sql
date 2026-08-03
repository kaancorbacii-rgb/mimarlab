-- Additive migration for the live D1 database (no migrations runner exists yet,
-- so this is applied by hand with `wrangler d1 execute --file`). Matches the
-- schema.sql change: new admin_badges table lets the admin grant a badge
-- directly to any architect/office profile without a purchase or claim
-- (mimar-ekle.html/ofis-ekle.html admin-only badge picker, src/routes/admin.js
-- handleProfileBadgeAdmin, src/routes/badges.js#handlePublicBadges merge).

CREATE TABLE IF NOT EXISTS admin_badges (
  profile_type TEXT NOT NULL,
  profile_key TEXT NOT NULL,
  badge_type TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_type, profile_key)
);
