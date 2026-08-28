-- Prod audit bulgusu (2026-08-29): src/routes/project.js#fetchProjectPageRows (D1 hızlı-yolu,
-- filtre/arama aktif değilken varsayılan /api/projects listesini besler) her cache-miss'te
-- `WHERE build_status = ? ORDER BY COALESCE(publish_date, created_at) DESC, id DESC` çalıştırıyordu.
-- idx_projects_build_status (0037) yalnızca WHERE'i karşılıyordu, ORDER BY için ayrı bir temp
-- B-tree sort gerekiyordu (idx_*_status_created deseninin 0028'de submissions tabloları için
-- zaten kurulmuş olmasına rağmen projects'in kendisinde eşdeğeri yoktu). COALESCE ifadesini
-- BİREBİR yansıtan bir expression index ile (sqlite3 EXPLAIN QUERY PLAN ile doğrulandı: sort
-- adımı ortadan kalkıyor) sıralama artık indexten doğrudan gelir.
CREATE INDEX IF NOT EXISTS idx_projects_build_status_order
  ON projects(build_status, COALESCE(publish_date, created_at) DESC, id DESC)
  WHERE deleted_at IS NULL AND hidden_at IS NULL;
