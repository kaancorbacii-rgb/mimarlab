-- DANIŞMAN OL — DANIŞMAN KADROSU ARTIK VERİTABANINDA (kullanıcı isteği, 2026-09-15:
-- "Danışman Ol sayfasını tasarla, kullanıcılar kişi ekle sayfasındaki gibi başvuru yapsınlar ...
--  Bu sayfada kişiler kaç dakikalık görüşme verebileceklerini (30, 45 veya 60dk), bu görüşme
--  saatlerinin kaç TL olduğunu ve hangi tarihlerde müsait olduklarını seçsinler.")
--
-- ÖNCEKİ DURUM: kim danışmandır sorusunun cevabı KAYNAK KODDA tek bir Set'ti
-- (src/routes/consultations.js#ALLOWED_HOST_SLUGS = {'kaan-corbaci'}) ve teklifin TAMAMI global
-- sabitlerdi: CONSULTATION_PRICE_TRY (1500), CONSULTATION_DURATION_MIN (45), ALLOWED_WEEKDAYS
-- ({1,3,5}), ALLOWED_TIMES ({18:00,19:00,20:00}). Yani yeni bir danışman eklemek DEPLOY
-- gerektiriyordu ve iki danışmanın farklı süre/ücret/saat sunması İMKÂNSIZDI.
--
-- ARTIK: bu tablo hem KAPIDIR (status='approved' olmayan bir satır randevu kabul etmez) hem de
-- TEKLİFİN KENDİSİDİR (süre/ücret/gün/saat). Koddaki sabitler SİLİNMEDİ; yalnızca bu tabloda satır
-- bulunamadığında kullanılan VARSAYILAN oldular (bkz. src/lib/consultants.js#DEFAULT_OFFER) —
-- böylece tablo boşken ya da bir satır bozukken akış çökmez, eski davranışa düşer.
--
-- architect_slug BİRİNCİL ANAHTAR ve architects.slug'a bakar: danışmanlığın tamamı o kaydın
-- üzerine kuruludur (consultation_requests.host_slug, erişim yetkisi
-- architects.claimed_by_user_id, kişi pop-up'ındaki "Danışmanlık Al" düğmesi). Bu yüzden bir
-- danışmanın SİTEDE KİŞİ KAYDI OLMAK ZORUNDADIR — başvuru akışı da bunu şart koşar
-- (bkz. danisman-ol.html).
CREATE TABLE IF NOT EXISTS consultants (
  architect_slug TEXT PRIMARY KEY,
  -- Başvuruyu yapan hesap. architects.claimed_by_user_id ile AYNI kişi olmalıdır; onay anında
  -- (admin) yeniden doğrulanır — burada tutulması yalnızca başvuru sahibini izlemek içindir.
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- 30 | 45 | 60 (kullanıcı isteği). Tek gerçek kaynak src/lib/consultants.js#CONSULTANT_DURATIONS;
  -- CHECK burada da var ki bir admin/D1 düzenlemesi listeyi sessizce aşamasın.
  duration_min INTEGER NOT NULL CHECK (duration_min IN (30, 45, 60)),
  price_try INTEGER NOT NULL CHECK (price_try >= 0),
  -- JSON dizi. weekdays: Date#getUTCDay değerleri (0=Pazar … 6=Cumartesi) — consultations.js'in
  -- gün kontrolü zaten bu uzayda çalışıyor. times: "HH:MM" (yalnızca tam saat).
  weekdays TEXT NOT NULL,
  times TEXT NOT NULL,
  -- "hangi alanda danışmanlık verdiklerini vs. bilgi olarak yazsınlar" (kullanıcı isteği).
  expertise TEXT,
  -- Danışmanlık modalindeki tanıtım cümlesi. Boşsa consultations.js#consultationIntro üretir —
  -- yani eski metin davranışı korunur.
  intro TEXT,
  -- pending | approved | rejected. Randevu kapısı YALNIZCA 'approved' satırı tanır.
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  approved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_consultants_status ON consultants(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_consultants_user ON consultants(user_id);

-- Görüşme SÜRESİ ARTIK TALEBİN KENDİSİNDE. Süre danışman başına değiştiğine göre, sonradan
-- değiştirilebilir bir danışman ayarından okunması YANLIŞ olurdu: alıcı 30 dakikalık bir görüşme
-- satın aldıktan sonra danışman süresini 60'a çekerse hem Google Meet etkinliğinin bitişi hem de
-- görüşme odasının katılım penceresi GEÇMİŞE DÖNÜK kayardı. price_try ile BİREBİR aynı gerekçe
-- (o da rezervasyon anında talebe yazılıyor).
-- Varsayılan 45: bu kolon eklenmeden önce açılmış TÜM randevular 45 dakikalıktı.
ALTER TABLE consultation_requests ADD COLUMN duration_min INTEGER NOT NULL DEFAULT 45;

-- Mevcut TEK danışmanı (kaan-corbaci) bugünkü teklifiyle taşı — kod sabitleriyle BİREBİR aynı
-- değerler. Bu satır olmadan tablo boş kalır ve kapı herkese kapanırdı.
-- INSERT OR IGNORE: migration yeniden çalıştırılırsa elle düzenlenmiş satırı EZMEZ.
INSERT OR IGNORE INTO consultants
  (architect_slug, user_id, duration_min, price_try, weekdays, times, expertise, intro, status, created_at, updated_at, approved_at)
VALUES
  ('kaan-corbaci', NULL, 45, 1500, '[1,3,5]', '["18:00","19:00","20:00"]', NULL, NULL, 'approved',
   strftime('%s','now') * 1000, strftime('%s','now') * 1000, strftime('%s','now') * 1000);
