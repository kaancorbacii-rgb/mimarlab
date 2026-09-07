-- Güvenli Görüşme Gateway'i — Google Meet (kullanıcı isteği, 2026-09-08).
--
-- NOT: bu depoda "consultation_bookings" diye bir tablo YOK; danışmanlık rezervasyonu
-- consultation_requests tablosudur (bkz. migrations/0092_consultation_requests.sql). Alanlar oraya
-- eklenir.
--
-- room_uuid  : /gorusme/:room_uuid adresinin TEK anahtarı — crypto.randomUUID() (Web Crypto,
--              CSPRNG) ile üretilir, tahmin edilemez. TEK BAŞINA erişim yetkisi VERMEZ: sayfa ve
--              API her istekte oturumu doğrulayıp alıcı/danışman eşleşmesini sunucuda yeniden
--              yapar (bkz. src/routes/consultations.js#resolveConsultationAccess).
-- meet_link  : Google'ın döndürdüğü Meet adresi. YALNIZCA yetkili tarafa ve YALNIZCA katılım
--              penceresinde (başlangıç-15dk .. başlangıç+45dk) döner; hiçbir public uçtan çıkmaz.
-- meet_event_id / meet_status ('creating'|'ready'|'failed') / meet_error (hassas bilgi içermeyen
--              kısa hata özeti) / meet_created_at (ISO) — bkz. src/lib/consultationMeet.js.
--
-- SQLite ALTER TABLE ... ADD COLUMN UNIQUE kısıtı ekleyemez; teklik ayrı bir UNIQUE INDEX ile
-- sağlanır (NULL değerler SQLite'ta tekillik kısıtına takılmaz — mevcut/henüz oda atanmamış
-- satırlar sorunsuz kalır).
ALTER TABLE consultation_requests ADD COLUMN room_uuid TEXT;
ALTER TABLE consultation_requests ADD COLUMN meet_link TEXT;
ALTER TABLE consultation_requests ADD COLUMN meet_event_id TEXT;
ALTER TABLE consultation_requests ADD COLUMN meet_status TEXT;
ALTER TABLE consultation_requests ADD COLUMN meet_error TEXT;
ALTER TABLE consultation_requests ADD COLUMN meet_created_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_consultation_requests_room_uuid ON consultation_requests(room_uuid);
