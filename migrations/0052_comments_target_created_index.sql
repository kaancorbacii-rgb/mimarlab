-- Genel hız taraması bulgusu (production audit, 2026-08-17) — src/routes/comments.js#listComments
-- (WHERE target_type=? AND target_id=? AND status='approved' ORDER BY created_at ASC) yalnızca
-- idx_comments_target(target_type, target_id) index'ini kullanabiliyordu; bu index ORDER BY
-- created_at'i kapsamadığından EXPLAIN QUERY PLAN her çağrıda "USE TEMP B-TREE FOR ORDER BY"
-- gösteriyordu. Bugün comments tablosu küçük olduğundan zararsız ama popüler proje/mimar/firma
-- sayfalarında yorum sayısı arttıkça sıralama maliyeti oluşur. created_at eklenmiş composite index
-- bu sıralamayı doğrudan index'ten karşılar.
--
-- Eski idx_comments_target(target_type, target_id) artık gereksiz: composite index'in soldan ilk iki
-- kolonu (target_type, target_id) aynı önceliği taşıdığından yalnızca bu ikisiyle filtreleyen diğer
-- tüm sorgular (src/lib/cascadeDelete.js#DELETE, canonicalSync.js/officeFounderCascade.js#UPDATE —
-- hiçbiri ORDER BY kullanmıyor) composite index'in önek (prefix) eşleşmesiyle AYNI şekilde
-- karşılanır; iki ayrı index tutmanın ek yazma/depolama maliyeti gereksizdir.
DROP INDEX IF EXISTS idx_comments_target;
CREATE INDEX IF NOT EXISTS idx_comments_target_created ON comments(target_type, target_id, created_at);
