-- D1 audit (2026-08-25) P1-5 — src/routes/public.js#handlePublicSaveCount (GET /api/public/save-count)
-- her proje/ürün detay sayfası açılışında `SELECT COUNT(*) FROM saved_items WHERE item_type = ?
-- AND item_key = ?` çalıştırıyor. saved_items üzerinde yalnızca idx_saved_user(user_id) vardı
-- (bkz. schema.sql) — (item_type, item_key) için bir index olmadığından bu sorgu tam tablo
-- taraması yapıyordu (audit raporu B5/D#9). UNIQUE(user_id, item_type, item_key) kısıtı
-- item_type/item_key'i baştan KAPSAMIYOR (leftmost kolon user_id), bu yüzden ayrı bir index
-- gerekiyor. İdempotent: CREATE INDEX IF NOT EXISTS, mevcut veriyi değiştirmez.
CREATE INDEX IF NOT EXISTS idx_saved_items_type_key ON saved_items(item_type, item_key);
