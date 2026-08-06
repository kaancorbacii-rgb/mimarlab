-- Admin panelinde yeni yorumların "okunmadı" olarak düşmesi için (bkz. kullanıcı isteği: "yorum
-- admin paneline düşsün") — contact_messages.is_read ile AYNI desen (bkz. schema.sql:329).
ALTER TABLE comments ADD COLUMN admin_seen INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_comments_admin_seen ON comments(admin_seen);
