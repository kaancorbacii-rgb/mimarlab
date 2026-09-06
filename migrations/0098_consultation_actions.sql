-- Danışmanlık görüşme aksiyonu talepleri (kullanıcı isteği, 2026-09-06): "Görüşme Gerçekleşti",
-- "Değerlendir", "İptal Et" butonlarından biri tıklanınca alıcı/danışman bir sebep yazıp admin
-- değerlendirmesine gönderir — profile_corrections İLE AYNI desen (bkz. src/routes/claims.js#
-- handleCorrectionsRoute, src/routes/admin.js#handleCorrectionsAdmin). Admin onay/red verince
-- talebi gönderen kişiye (danışman ya da kullanıcı — requested_by_user_id) bildirim gider.
CREATE TABLE IF NOT EXISTS consultation_actions (
  id TEXT PRIMARY KEY,
  consultation_id TEXT NOT NULL REFERENCES consultation_requests(id),
  requested_by_user_id TEXT NOT NULL REFERENCES users(id),
  requested_by_role TEXT NOT NULL, -- 'buyer' | 'host'
  action_type TEXT NOT NULL, -- 'completed' | 'review' | 'cancel'
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  admin_response TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_consultation_actions_consultation ON consultation_actions(consultation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consultation_actions_status ON consultation_actions(status, created_at DESC);
