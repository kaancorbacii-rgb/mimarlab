-- Kullanıcı isteği: Archello (archello.com/brand/ofist) benzeri "Takip Et" özelliği — mimar/firma
-- profillerinde bir Takip Et butonu, takip edilen profile ait yeni proje/ürün Aktivitelerim'deki
-- "Takip Ettiklerim" kutusunda görünür. saved_items (bkz. schema.sql) ile AYNI şekil/gerekçe.
CREATE TABLE IF NOT EXISTS follows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  followed_type TEXT NOT NULL,
  followed_key TEXT NOT NULL,
  followed_title TEXT,
  followed_ref_id INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, followed_type, followed_key)
);
CREATE INDEX IF NOT EXISTS idx_follows_user ON follows(user_id);
CREATE INDEX IF NOT EXISTS idx_follows_type_key ON follows(followed_type, followed_key);
