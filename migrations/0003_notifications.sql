-- Additive migration for the live D1 database (no migrations runner exists yet,
-- so this is applied by hand with `wrangler d1 execute --file`). Matches the
-- schema.sql change: notifications table for hesabim.html's "Bildirimler" box.

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
