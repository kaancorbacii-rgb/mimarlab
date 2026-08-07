-- Yorum moderasyonu (bkz. kullanıcı isteği): BUNDAN SONRAKİ tüm yeni yorumlar varsayılan 'pending'
-- statüsüyle kaydedilir, yalnızca admin onayladıktan (status='approved') sonra kamuya açık
-- listelerde/modallarda görünür (bkz. src/routes/comments.js#listComments). admin_seen (migrations/
-- 0027_comment_admin_seen.sql) ayrı bir alan olarak kalır — o "admin gördü mü", bu "admin onayladı mı".
ALTER TABLE comments ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status);
-- ALTER'ın DEFAULT'u bu satırda mevcut TÜM satırlara da 'pending' yazdı — ama bu migration
-- ÇALIŞMADAN ÖNCE girilmiş yorumlar zaten canlıda görünür haldeydi (moderasyon geriye dönük
-- işlemez). Bu tek seferlik UPDATE, migration ANINDA var olan (henüz yeni kod deploy edilmediği
-- için hiçbir 'gerçek' pending yorum olamaz) tüm satırları geriye dönük 'approved' işaretler.
UPDATE comments SET status = 'approved';
