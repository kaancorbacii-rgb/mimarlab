-- Additive migration (applied by hand — bkz. migrations/0111'in üstündeki AYNI not, d1_migrations
-- tablosu 0014'te takılı kaldığından 'wrangler d1 migrations apply' yerine 'wrangler d1 execute
-- --file' kullanılmalı).
--
-- KULLANICI İSTEĞİ (2026-09-11): "Mesaj kutusunda gönderilen mesaj üzerine tıklanıp görüldüğü zaman
-- karşı taraflarda görüldü yazsın." — bkz. src/routes/messages.js#getThread. Her (thread, kullanıcı)
-- çifti için konuşmanın EN SON ne zaman açıldığını tutar; bir thread'i kimin hangi mesajı "gördüğü"
-- değil, kullanıcının o thread'i EN SON ne zaman gördüğü tutulur — bu, mesaj başına satır tutmaktan
-- daha ucuz ve firma grup konuşmaları (birden fazla alıcı) için de doğrudan çalışır: bir mesajın
-- "görüldü" sayılması için TEK bir karşı tarafın last_read_at'inin o mesajın created_at'inden SONRA
-- olması yeterli (bkz. getThread'deki MAX(last_read_at) sorgusu).
CREATE TABLE IF NOT EXISTS message_reads (
  thread_id TEXT NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  last_read_at INTEGER NOT NULL,
  PRIMARY KEY (thread_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_message_reads_thread ON message_reads(thread_id);
