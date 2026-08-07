-- Phase 4A — D1 Query Profiling & Index Optimization. Her indeks aşağıda EXPLAIN QUERY PLAN ile
-- ÖLÇÜLEREK doğrulandı (yerel dev DB: /Users/kaancorbaci/.mimarlab-dev-state, gerçek üretim verisi
-- boyutuna yakın: architects 810, offices 672, projects 632 satır). Ölçülmeden/tahminle eklenmiş
-- HİÇBİR indeks yok — mimar.html/firma.html/proje.html/urun.html'in ana liste sorguları (WHERE
-- deleted_at IS NULL AND hidden_at IS NULL — satırların ~%100'üyle eşleşiyor, düşük seçicilik)
-- KASITLI OLARAK indekssiz bırakıldı; SCAN TABLE zaten en ucuz plan (bkz. proje raporu).
--
-- 1) *_submissions(status, created_at DESC) — admin panelindeki "Bekleyen Gönderiler" kuyruğu
--    (src/routes/admin.js#handleSubmissionsAdmin: SELECT * FROM <tablo> WHERE status = ? ORDER BY
--    created_at DESC) ÖNCESİ: SEARCH ... (status=?) + USE TEMP B-TREE FOR ORDER BY. SONRASI: TEK
--    SEARCH, temp b-tree yok (composite indeks zaten created_at DESC sırasında). Tek-kolonlu eski
--    idx_*_status indeksleri bu composite'in soldan-öneki (leftmost prefix) ile TAMAMEN kapsandığı
--    için (COUNT(*)/eşitlik sorguları hâlâ covering index olarak çalışıyor, bkz. src/routes/
--    admin.js#handleAdminSummary) düşürüldü — aynı satırı iki ayrı indekste tutmanın INSERT/UPDATE
--    maliyetine hiçbir okuma faydası karşılığı yoktu.
DROP INDEX IF EXISTS idx_architect_status;
DROP INDEX IF EXISTS idx_office_status;
DROP INDEX IF EXISTS idx_project_status;
DROP INDEX IF EXISTS idx_product_status;
DROP INDEX IF EXISTS idx_material_status;
DROP INDEX IF EXISTS idx_job_status;
DROP INDEX IF EXISTS idx_news_sub_status;

CREATE INDEX IF NOT EXISTS idx_architect_status_created ON architect_submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_office_status_created ON office_submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_status_created ON project_submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_status_created ON product_submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_material_status_created ON material_submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_status_created ON job_submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_sub_status_created ON news_submissions(status, created_at DESC);

-- 2) architects/offices/projects/products — GET /api/public/hidden (src/routes/legacyContent.js
--    #fetchHiddenMap: SELECT * FROM <tablo> WHERE hidden_at IS NOT NULL OR deleted_at IS NOT NULL)
--    proje.html/mimar.html/firma.html/urun.html'in HER sayfa yüklemesinde çağrılır (edge cache
--    arkasında, ama cache miss'lerinde gerçek D1 isteği). ÖNCESİ: SCAN TABLE (tüm satırlar
--    okunuyor). Bu koşul yukarıdakinin TAM TERSİ seçicilikte: gizli/silinmiş satır sayısı normalde
--    ~0 (yerel veride 4 tabloda da 0/810, 0/672, 0/632, 0/82) — bu yüzden PARTIAL index (yalnızca
--    eşleşen nadir satırları tutar, normal ekleme/güncellemede indekse hiç dokunulmaz, yazma
--    maliyeti neredeyse sıfır). SONRASI: SCAN ... USING INDEX (tablo değil, birkaç satırlık partial
--    indeksin kendisi taranıyor). NOT: hidden_at/deleted_at ayrı ayrı tek-kolonlu partial indeksler
--    denendi, SQLite'ın OR-optimizasyonu bunları BİRLEŞTİRMEDİ (ANALYZE sonrası bile hâlâ SCAN
--    TABLE) — yalnızca WHERE koşuluyla BİREBİR eşleşen tek bir composite partial indeks işe yaradı.
CREATE INDEX IF NOT EXISTS idx_architects_hidden_or_deleted ON architects(hidden_at, deleted_at) WHERE hidden_at IS NOT NULL OR deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_offices_hidden_or_deleted ON offices(hidden_at, deleted_at) WHERE hidden_at IS NOT NULL OR deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_hidden_or_deleted ON projects(hidden_at, deleted_at) WHERE hidden_at IS NOT NULL OR deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_hidden_or_deleted ON products(hidden_at, deleted_at) WHERE hidden_at IS NOT NULL OR deleted_at IS NOT NULL;
