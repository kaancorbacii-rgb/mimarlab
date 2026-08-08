-- Yeni "/danismanlik" modülü (bkz. kullanıcı isteği: ADPList tarzı ücretli danışmanlık/mentörlük
-- keşif sayfası) — ayrı bir consultants tablosu yerine mevcut architects satırına bir bayrak
-- eklenir, böylece mevcut rozet sistemi (badge-shared.js#verifiedBadgeHtml('architect', ...)) ve
-- /api/architect/:slug altyapısı yeniden kullanılabilir; aynı mimar hem /mimar/:slug hem
-- /danismanlik/:slug altında AYNI kaydı temsil eder. Bu turda admin/self-serve giriş ekranı YOK
-- (bkz. kullanıcı isteği) — bu kolonlar yalnızca migration/seed SQL ile elle doldurulur.
ALTER TABLE architects ADD COLUMN is_consultant INTEGER NOT NULL DEFAULT 0;
ALTER TABLE architects ADD COLUMN hourly_rate INTEGER;
ALTER TABLE architects ADD COLUMN session_duration_min INTEGER NOT NULL DEFAULT 45;
ALTER TABLE architects ADD COLUMN expertise_tags TEXT;
ALTER TABLE architects ADD COLUMN available_slots TEXT;
ALTER TABLE architects ADD COLUMN consultant_bio TEXT;
ALTER TABLE architects ADD COLUMN consultant_total_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE architects ADD COLUMN consultant_sessions_completed INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_architects_consultant ON architects(is_consultant) WHERE is_consultant = 1;
