-- GÜNDEM — KULLANICI GÖNDERİLERİ (kullanıcı isteği, 2026-09-11: "Gündem sayfasında kullanıcılar
-- da haber, etkinlik, yarışma ekleyebilsinler ... gönderilen içerikler admin panelinde onaya
-- düşsünler ... içeriği kim gönderdiyse o firma, marka veya kişi profilinde ... yayınlansın").
--
-- AYRI TABLO DEĞİL: kullanıcı gönderisi yayına girince otomatik içerikle AYNI listede, AYNI kart,
-- AYNI Kaydet/Paylaş/Okundu, AYNI /gundem/:slug adresi, AYNI popup şeridi (gundem_entities) ile
-- görünür. İkinci bir tablo tüm bu okuma yollarını ikiye bölerdi.
--
-- Kullanıcı satırının kimliği: source_id = 'user' + ingest_mode = 'user'.
--   * ingest_mode='user' → günlük cron tavanı (COALESCE(ingest_mode,'cron')='cron') bunu SAYMAZ.
--   * content_hash / title_key 'user:<id>' yazılır → cron'un mükerrer kapısı bir kullanıcı
--     gönderisini "zaten var" sayıp gerçek bir haberi ELEMEZ (ve tersi).
--   * source_url = kalıcı /gundem/:slug adresi (NOT NULL UNIQUE sözleşmesi korunur).
--   * status: 'pending' (onay bekliyor) | 'published' | 'rejected' | 'archived'. Public uçların
--     hepsi zaten status='published' süzüyor — pending/rejected hiçbir yerde görünmez.

-- Tüm görseller (en fazla 3) JSON dizi olarak. image_url İLK görseldir (kapak) ve NOT NULL
-- sözleşmesi aynen sürer — otomatik içerik bu kolonu hiç doldurmaz, tek görselle devam eder.
ALTER TABLE gundem_items ADD COLUMN images TEXT;
-- Gönderen kullanıcı (users.id). Yalnızca sahiplik/düzenleme yetkisi için — public uçlardan dönmez.
ALTER TABLE gundem_items ADD COLUMN submitted_by TEXT;
-- Kimin adına gönderildi: 'architect' | 'office' | 'user' (profilsiz). architect/office ise
-- submitter_key o tablodaki canonical slug'dır ve onayda gundem_entities'e kenar olarak yazılır —
-- kişi/firma/marka popup'ındaki Gündem şeridi (loadGundemStrip) içeriği buradan bulur.
ALTER TABLE gundem_items ADD COLUMN submitter_type TEXT;
ALTER TABLE gundem_items ADD COLUMN submitter_key TEXT;
ALTER TABLE gundem_items ADD COLUMN submitter_name TEXT;

-- "Gönderilerim" listesi (gundem-ekle.html) — kullanıcının kendi satırları.
CREATE INDEX IF NOT EXISTS idx_gundem_items_submitted_by ON gundem_items(submitted_by, created_at DESC);
