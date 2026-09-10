-- ÖNİZLEME ("soluk") DURUMU — kullanıcı isteği, 2026-09-10 (dördüncü tur):
-- "Arşivlediğin Kişi, firma, marka, ürün ve projeleri canlıya geri al ama bunlar sadece ilgili
--  sayfalarda ve popuplarda önizleme şeklinde soluk olarak görünsünler. Yani üzerlerine
--  tıklanamasın."
--
-- ÜÇ DURUM (hidden_at + preview_at birlikte okunur):
--   hidden_at NULL,     preview_at NULL      -> normal yayında
--   hidden_at DOLU,     preview_at DOLU      -> ÖNİZLEME: liste havuzlarında soluk/tıklanamaz kart
--   hidden_at DOLU,     preview_at NULL      -> tam arşiv: hiçbir yerde görünmez (bkz. istisnalar)
--
-- NEDEN hidden_at DOLU KALIYOR: bu depoda 129 ayrı sorgu `hidden_at IS NULL` ile filtreliyor
-- (sitemap, detay uçları, arama, JSON-LD, hub bağlantıları, istatistikler...). Önizleme satırları
-- oralara SIZMAMALI — detay sayfası 410 dönmeli, sitemap'e girmemeli, aramada çıkmamalı. hidden_at'i
-- temizlemek 129 çağrı noktasının hepsini tek tek gözden geçirmeyi gerektirirdi; bunun yerine
-- yalnızca DÖRT liste havuzu sorgusu (`(hidden_at IS NULL OR preview_at IS NOT NULL)`) önizleme
-- satırlarını bilerek geri alır ve kartı `preview:true` ile işaretler.
ALTER TABLE architects ADD COLUMN preview_at TEXT;
ALTER TABLE offices ADD COLUMN preview_at TEXT;
ALTER TABLE projects ADD COLUMN preview_at TEXT;
ALTER TABLE products ADD COLUMN preview_at TEXT;

CREATE INDEX IF NOT EXISTS idx_architects_preview ON architects(preview_at) WHERE preview_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_offices_preview ON offices(preview_at) WHERE preview_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_preview ON projects(preview_at) WHERE preview_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_preview ON products(preview_at) WHERE preview_at IS NOT NULL;
