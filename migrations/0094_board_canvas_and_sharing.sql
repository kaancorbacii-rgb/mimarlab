-- Koleksiyonum panolarını serbest tuval (moodboard) mimarisine çevirir (kullanıcı isteği, 2026-09-05).
--
-- pos_x/pos_y/width/height CANVAS YÜZDESİ olarak tutulur (0-100), image-hotspots.js'teki AYNI
-- gerekçeyle: piksel yerine yüzde, panonun konteyneri duyarlı (responsive) genişlik değiştirdiğinde
-- konumların bozulmadan ölçeklenmesini sağlar. Varsayılan -1 "hiç konumlandırılmamış" anlamına gelir
-- (geçerli bir konum her zaman >= 0'dır) — istemci bunu görünce panodaki eski (sıra bazlı) öğeleri
-- ilk açılışta basit bir ızgaraya otomatik yerleştirip konumu hemen kaydeder (bkz.
-- js/components/auth-modal.js#autoArrangeIfNeeded). Böylece SQL tarafında kırılgan bir geriye dönük
-- doldurma (backfill) sorgusuna gerek kalmaz.
ALTER TABLE collection_items ADD COLUMN pos_x REAL NOT NULL DEFAULT -1;
ALTER TABLE collection_items ADD COLUMN pos_y REAL NOT NULL DEFAULT -1;
ALTER TABLE collection_items ADD COLUMN width REAL NOT NULL DEFAULT 22;
ALTER TABLE collection_items ADD COLUMN height REAL NOT NULL DEFAULT 22;
ALTER TABLE collection_items ADD COLUMN z_index INTEGER NOT NULL DEFAULT 0;

-- Ortak çalışma (kullanıcı isteği madde 3): panonun sahibi diğer kullanıcıları görüntüleyici/editör
-- olarak davet edebilir. Panonun KENDİ herkese açık paylaşım bağlantısı (collections.share_token,
-- bkz. migrations/0082_collection_share.sql) bundan TAMAMEN AYRIDIR — biri "bağlantısı olan herkes
-- salt-okunur görsün", diğeri "belirli bir MİMARLAB üyesine rol ver" senaryosunu çözer, ikisi birlikte
-- var olabilir.
CREATE TABLE IF NOT EXISTS board_shares (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer', -- 'viewer' | 'editor'
  invited_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  UNIQUE(collection_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_board_shares_collection ON board_shares(collection_id);
CREATE INDEX IF NOT EXISTS idx_board_shares_user ON board_shares(user_id, created_at DESC);
