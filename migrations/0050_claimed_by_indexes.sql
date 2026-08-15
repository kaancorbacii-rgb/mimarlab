-- Genel hız taraması bulgusu — src/routes/comments.js#listComments her yorum satırı için
-- architects/offices tablolarında claimed_by_user_id üzerinden korelasyonlu subquery çalıştırıyor
-- (yorum sahibinin mimar/firma profili var mı kontrolü), bu kolonlarda index yoktu → her proje/mimar/
-- firma/haber detay sayfası görüntülemesinde N adet full table scan.
CREATE INDEX IF NOT EXISTS idx_architects_claimed_by ON architects(claimed_by_user_id);
CREATE INDEX IF NOT EXISTS idx_offices_claimed_by ON offices(claimed_by_user_id);
