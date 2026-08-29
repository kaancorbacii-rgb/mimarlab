-- Kullanıcı isteği: doğrulanmış mimar/firma profillerine kullanıcıların mesaj gönderebilmesi.
-- message_threads bir konuşmayı, messages o konuşmadaki tek tek mesajları, message_thread_recipients
-- ise (firma profillerinde kurucu/kurucu ortak/ortak/ekip lideri gibi BİRDEN FAZLA claim sahibi
-- olabildiğinden) bir konuşmayı görebilecek/cevaplayabilecek kullanıcıları tutar. Alıcılar her
-- gönderimde profile_claims'ten (bkz. schema.sql#profile_claims, src/lib/projectClaimAccess.js#
-- OFFICE_EDIT_POSITIONS) o anki onaylı sahiplere göre çözülüp burada donmuş bir kopya olarak saklanır
-- — sonradan claim değişse bile geçmiş bir konuşmanın katılımcıları değişmez.
CREATE TABLE IF NOT EXISTS message_threads (
  id TEXT PRIMARY KEY,
  profile_type TEXT NOT NULL, -- 'architect' | 'office'
  profile_key TEXT NOT NULL,  -- architects[].name / offices[].name ile birebir eşleşir
  sender_user_id TEXT NOT NULL REFERENCES users(id),
  sender_name TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  sender_city TEXT,
  sender_company TEXT,
  sender_phone TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- open | closed
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_message_threads_sender ON message_threads(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_message_threads_profile ON message_threads(profile_type, profile_key);

CREATE TABLE IF NOT EXISTS message_thread_recipients (
  thread_id TEXT NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (thread_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_message_thread_recipients_user ON message_thread_recipients(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  sender_user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
