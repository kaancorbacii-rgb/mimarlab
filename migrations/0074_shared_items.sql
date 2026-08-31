-- Paylaştıklarım (kullanıcı isteği, 2026-08-31): Aktivitelerim'e "kullanıcıların paylaş butonuna
-- tıklayarak başkalarına ilettikleri gönderiler" kutusu eklendi (bkz. js/components/auth-modal.js#
-- activitiesTemplate, src/routes/shares.js).
--
-- saved_items ile AYNI anlık-görüntü deseni (başlık/görsel/bağlantı paylaşıldığı andaki haliyle
-- kopyalanır) ama İKİ önemli farkla:
--   1) UNIQUE(user_id, item_type, item_key) YOK — "kaydettim mi" bir bayraktır, paylaşım ise bir
--      OLAYDIR; aynı projeyi iki gün arayla WhatsApp'tan ve LinkedIn'den paylaşmak iki ayrı satırdır.
--      Bu yüzden liste sorgusu da hedef başına en son paylaşımı gösterecek şekilde tekilleştirilir
--      (bkz. src/routes/shares.js#listShares), kayıt katmanında değil.
--   2) channel: hangi yoldan paylaşıldığı ('copy' | 'whatsapp' | 'x' | 'linkedin' | 'native') —
--      Aktivitelerim satırının alt metninde gösterilir.
CREATE TABLE IF NOT EXISTS shared_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  item_type TEXT NOT NULL,
  item_key TEXT NOT NULL,
  item_title TEXT,
  item_meta TEXT,
  item_image TEXT,
  item_href TEXT,
  channel TEXT,
  created_at INTEGER NOT NULL
);
-- Tek sorgu deseni var: "bu kullanıcının paylaşımları, en yeniden eskiye" (bkz. listShares).
CREATE INDEX IF NOT EXISTS idx_shared_items_user ON shared_items(user_id, created_at DESC);
-- İçerik silinince/gizlenince bu satırların da temizlenmesi için (bkz. src/lib/cascadeDelete.js) —
-- saved_items'ın idx_saved_items_type_key indeksiyle AYNI gerekçe.
CREATE INDEX IF NOT EXISTS idx_shared_items_type_key ON shared_items(item_type, item_key);
