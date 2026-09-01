-- Pano paylaşımı (kullanıcı isteği, 2026-09-02): "panolarım kısmında yeniden adlandır butonunun
-- yanında bir de paylaş butonu olsun. Pano başkalarının da görebileceği şekilde paylaşılabilsin."
--
-- Tasarım: paylaşım AÇIKÇA açılır (varsayılan KAPALI) ve bağlantı TAHMİN EDİLEMEZ bir token taşır.
-- Panonun kendi id'sini herkese açık bir adres olarak kullanmak, id'yi bilen/deneyen herkese tüm
-- panoları açardı; ayrı bir token sahibin paylaşımı geri alabilmesini de mümkün kılar (token
-- sıfırlanır, eski bağlantı ölür).
--
-- share_token NULL = paylaşılmamış (bugünkü tüm panolar). UNIQUE index yalnızca NULL OLMAYAN
-- değerleri kapsar (SQLite'ta birden çok NULL, UNIQUE'i ihlal etmez) — yani mevcut satırların
-- hiçbiri etkilenmez, geriye dönük tamamen uyumludur.
ALTER TABLE collections ADD COLUMN share_token TEXT;
ALTER TABLE collections ADD COLUMN shared_at INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_share_token
  ON collections(share_token) WHERE share_token IS NOT NULL;
