-- Additive migration (applied by hand — bkz. migrations/0071_product_files.sql'deki AYNI not,
-- d1_migrations tablosu 0014'te takılı kaldığından burada da 'wrangler d1 migrations apply' yerine
-- 'wrangler d1 execute --file' kullanılmalı).
--
-- Kullanıcı isteği (2026-09-04): 43'lük B&T Design partisiyle açılan 27 yeni proje, varsayılan
-- ORDER BY COALESCE(publish_date, created_at) DESC altında hepsi EN YENİ oldukları için proje
-- listesinin 1. sayfasına YIĞILIYORDU. scripts/import-btdesign2.py'nin ürün kataloğu için aynı
-- sorunu id-gap trick'iyle (yalnızca "sayfa başına en fazla bir ürün", 1-4. sayfalara tam dağılım
-- YAPILAMADI — mevcut satırları yeniden numaralandırmak project_products kenarlarını riske atardı)
-- çözdüğü commit (99c5c248) kendi notunda bunun geçici bir çözüm olduğunu, gerçek çözümün AÇIK BİR
-- SIRALAMA KOLONU olduğunu yazmıştı. Bu migration onu projects için uygular.
--
-- Tasarım: display_order INTEGER, NULL = "henüz atanmamış". ORDER BY
-- COALESCE(display_order, 0) ASC, COALESCE(publish_date, created_at) DESC, id DESC kullanılacak
-- (bkz. src/routes/project.js#fetchProjectPageRows, src/lib/projectPool.js#fetchActiveProjectPool).
-- 0 değeri MEVCUT/atanmış her display_order'dan (>=1) küçük olduğundan, display_order'ı HİÇ
-- atanmamış (NULL) her gelecekteki normal proje submission/admin ekleme akışı otomatik olarak en
-- üstte (en yeni pozisyonda) görünmeye devam eder — submission/insert kod yoluna DOKUNULMADI,
-- yalnızca BU partinin 1730 canlı satırına (1703 eski + 27 yeni) elle bir display_order atandı;
-- eski 1703 satır MEVCUT bağıl sırasını korudu, 27 yeni satır aralarına ~63 satırda bir olacak
-- şekilde eşit aralıklarla serpiştirildi (bkz. backfill script, bu migration'ın kapsamı dışında).
ALTER TABLE projects ADD COLUMN display_order INTEGER;

-- idx_projects_build_status_order'ın YERİNİ alır (aynı isim, yeni ifade) — eski index yeni ORDER
-- BY'ı karşılayamaz (SQLite EXPLAIN QUERY PLAN'da "USE TEMP B-TREE FOR ORDER BY"ya döner), bkz.
-- migrations/0067_project_list_order_index.sql'deki performans notunun AYNISI burada da geçerli.
DROP INDEX IF EXISTS idx_projects_build_status_order;
CREATE INDEX IF NOT EXISTS idx_projects_build_status_order
  ON projects(build_status, COALESCE(display_order, 0) ASC, COALESCE(publish_date, created_at) DESC, id DESC)
  WHERE deleted_at IS NULL AND hidden_at IS NULL;
