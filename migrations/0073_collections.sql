-- KOLEKSİYONUM (kullanıcı isteği, 2026-08-31: "Kullanıcılar Pinterest'teki gibi Koleksiyon
-- oluşturabilsin ... kullanıcı birden çok şey kaydederek ya da kendi bilgisayarından görsel, metin
-- vs yükleyerek burada kendi çalışmasını oluşturabilecek").
--
-- saved_items'tan (Kaydettiklerim) AYRI bir sistem: saved_items bir kaydın "bir kez kaydedildi mi"
-- bayrağıdır (kullanıcı+tip+anahtar başına tekil), koleksiyonlar ise kullanıcının kendi düzenlediği,
-- birden çok olabilen, site dışı içerik de (kendi yüklediği görsel, serbest metin notu) barındıran
-- panolardır. Bu yüzden collection_items saved_items'a YABANCI ANAHTARLA BAĞLANMAZ — bir öğe
-- koleksiyona eklendiği andaki başlık/görsel/bağlantısıyla kopyalanır (saved_items'ın kendi
-- item_title/item_image/item_href sütunlarındaki AYNI "anlık görüntü" deseni), böylece kaynak kayıt
-- sonradan silinse/gizlense bile pano bozulmaz.

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  -- cover_image: kullanıcı açıkça bir kapak seçmediyse NULL kalır; liste görünümü bu durumda
  -- koleksiyondaki ilk görselli öğeye düşer (bkz. src/routes/collections.js#listCollections).
  cover_image TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collections_user ON collections(user_id, created_at DESC);

-- kind: 'saved' (sitedeki bir kayıt), 'image' (kullanıcının kendi yüklediği görsel, /media/... R2
-- anahtarı), 'note' (serbest metin). item_type/item_key yalnızca kind='saved' satırlarda dolu olur
-- ve src/routes/saved.js#ITEM_TYPES ile AYNI enum'u kullanır.
CREATE TABLE IF NOT EXISTS collection_items (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  item_type TEXT,
  item_key TEXT,
  title TEXT,
  meta TEXT,
  image TEXT,
  href TEXT,
  note TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collection_items_collection ON collection_items(collection_id, position, created_at);
