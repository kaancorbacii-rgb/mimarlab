-- Ölü özellik tablolarının kaldırılması (kullanıcı isteği, 2026-09-05 — tam sistem denetiminin
-- "Remaining risks" maddesi 3'ün kapatılması).
--
-- KAPSAM — yayından KALDIRILMIŞ üç özelliğin geride bıraktığı 7 tablo:
--   Düello  : project_duel_stats, duel_matches, duel_sessions, duel_analyses
--             (migrations/0062_duel_system.sql + 0064_duel_analyses.sql ile eklenmişti;
--              src/routes/duel.js ve duello.html artık depoda YOK, /duello canlıda 404)
--   Haber   : news, news_submissions
--             (haber özelliği kaldırıldı — bkz. src/index.js#DISABLED_PAGE_PATHS'teki
--              '/haber-detay', CLEAN_URL_ASSETS'te '/haberler/' girdisi yok, canlıda 404)
--   İş İlanı: job_submissions
--             (kariyer/iş ilanı özelliği kaldırıldı — bkz. DISABLED_PAGE_PATHS'teki '/kariyer')
--
-- ÖNCE YEDEK ALINDI: production D1'in TAM export'u (14.702.164 bayt,
-- sha256 b9c2b6984445dc19b08d29c550c426be9597db822dcfe0985d5ba79842dc1d90) alındı ve yedeğin bu 7
-- tablonun CREATE + INSERT satırlarını gerçekten içerdiği doğrulandı:
--   duel_matches 250, project_duel_stats 215, duel_sessions 8, duel_analyses 2,
--   news 0, news_submissions 0, job_submissions 0   (toplam 475 veri satırı)
-- Yedek scripts/output/ altında tutulur — .gitignore'ludur ve gerçek üretim verisi barındırdığı
-- için ASLA commit edilmemelidir (bkz. scripts/d1-backup-drill.sh dosya başı notu).
--
-- BAĞLI CANLI VERİ YOK (DROP'tan önce production'da tek tek doğrulandı — hepsi 0):
--   comments WHERE target_type='news'            0
--   saved_items WHERE item_type='news'           0
--   saved_items WHERE item_type='job'            0
--   shared_items WHERE item_type IN('news','job') 0
--   collection_items WHERE item_type IN(...)      0
--   ratings WHERE target_type IN('news','job')    0
-- Yani bu DROP hiçbir kullanıcının kaydettiği/paylaştığı/yorumladığı içeriği yetim bırakmaz.
--
-- KOD REFERANSLARI BU MIGRATION'DAN ÖNCE KALDIRILDI — sırası ÖNEMLİYDİ, aksi halde tablolar
-- düşer düşmez şu üç akış "no such table" ile ANINDA kırılırdı:
--   1. src/lib/cascadeDelete.js#cascadeDeleteProject  -> admin'in HER proje silme işlemi
--   2. src/lib/cascadeDelete.js#cascadeDeleteAccount  -> "Hesabımı Sil" (KVKK/GDPR silme hakkı);
--      burası TEK bir env.DB.batch() (tek transaction) olduğundan tek bir hatalı ifade tüm hesap
--      silmeyi atomik olarak başarısız kılardı
--   3. src/routes/admin.js#handleCommentsAdmin        -> admin yorum panelindeki koşulsuz
--      "LEFT JOIN news" (admin.html zaten news_title alanını hiç kullanmıyordu)
--   ayrıca: src/lib/r2Reconcile.js#SOURCES (orphan R2 taramasının tamamı ölürdü),
--           src/routes/comments.js (TARGET_TYPES + 3 ayrı 'news' dalı),
--           src/routes/saved.js#ITEM_TYPES, src/routes/shares.js#SHARE_ITEM_TYPES
--
-- Elle uygulanır (`wrangler d1 execute --file`) — bkz. migrations/0087..0089'daki AYNI not ve
-- scripts/sync-d1-migrations-2026-09-05.sql; bookkeeping satırı ayrıca eklenir.

DROP TABLE IF EXISTS duel_analyses;
DROP TABLE IF EXISTS duel_matches;
DROP TABLE IF EXISTS duel_sessions;
DROP TABLE IF EXISTS project_duel_stats;
DROP TABLE IF EXISTS news_submissions;
DROP TABLE IF EXISTS news;
DROP TABLE IF EXISTS job_submissions;

INSERT OR IGNORE INTO d1_migrations (id, name, applied_at)
VALUES (90, '0090_drop_dead_feature_tables.sql', datetime('now'));
