-- Kişi profillerinde "Danışmanlık Al" (birebir mentörlük randevusu) — kullanıcı isteği,
-- 2026-09-05. Şimdilik yalnızca "kaan-corbaci" (id 20) profilinde gösteriliyor (bkz.
-- js/components/architect-modal.js#renderItem — a.slug === 'kaan-corbaci' kapısı), bu yüzden
-- host_slug şu an sabit tek değer taşıyor ama gelecekte başka mimar profillerine açılabilmesi
-- için satıra gömülü (kod tarafında hardcode edilmiş TEK kapı; tablo tasarımı bunu varsaymıyor).
--
-- Ödeme akışı badge_requests İLE AYNI desen (bkz. migrations/0001_profession_claims_badges.sql):
-- havale/EFT bildirimi 'pending' oluşturur, admin banka ekstresinden doğrulayıp elle onaylar/
-- reddeder — henüz bir admin ekranı YOK (kullanıcı isteği bunu kapsam dışı bıraktı), onay şimdilik
-- doğrudan D1 üzerinden (`status` kolonu) yapılabilir.
CREATE TABLE IF NOT EXISTS consultation_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  host_slug TEXT NOT NULL,
  requested_date TEXT NOT NULL,
  requested_time TEXT NOT NULL,
  price_try INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_provider TEXT NOT NULL DEFAULT 'havale',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_consultation_requests_user ON consultation_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consultation_requests_host_status ON consultation_requests(host_slug, status, requested_date);
