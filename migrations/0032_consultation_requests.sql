-- "Görüşme Ayarla" Havale/EFT talep kaydı (bkz. kullanıcı isteği: satin-al.html'in badge_requests
-- akışıyla AYNI desen — ödeme henüz iyzico ile OTOMATİK doğrulanmıyor, kullanıcı "Ödemeyi Yaptım"
-- dediğinde 'pending' bir kayıt oluşur). consultant_key mimarın architects.name doğal anahtarı
-- (bkz. ratings/claims'teki AYNI desen) — ayrı bir foreign key değil, mevcut architects.slug/id
-- yeniden adlandırmalardan bağımsız kalması için.
CREATE TABLE consultation_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  consultant_key TEXT NOT NULL,
  requested_date TEXT NOT NULL,
  requested_time TEXT NOT NULL,
  price_try INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected','cancelled')),
  payment_provider TEXT NOT NULL DEFAULT 'havale',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_consultation_requests_user ON consultation_requests(user_id);
CREATE INDEX idx_consultation_requests_consultant ON consultation_requests(consultant_key);
