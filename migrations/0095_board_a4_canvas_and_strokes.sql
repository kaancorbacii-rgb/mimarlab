-- Koleksiyonum panolarını A4 pafta standardında bir eskiz/moodboard aracına genişletir (kullanıcı
-- isteği, 2026-09-06). collection_items.pos_x/pos_y/width/height/z_index ZATEN VAR (bkz.
-- migrations/0094_board_canvas_and_sharing.sql) — burada yalnızca YENİ alanlar eklenir.

-- Pano başına kağıt yönü — "Yatay A4"/"Dikey A4" araç çubuğu düğmesi (bkz. js/components/
-- auth-modal.js#renderDetail). Baseline piksel boyutları (794x1123 @96dpi) istemcide sabit,
-- burada yalnızca hangisinin seçili olduğu saklanır.
ALTER TABLE collections ADD COLUMN canvas_orientation TEXT NOT NULL DEFAULT 'landscape';

-- Not (kind='note') öğelerinin dinamik stili (kullanıcı isteği madde 2: "Kalem" ikonuyla renk/punto/
-- kalınlık değiştirme). NULL ise istemci varsayılan (ink rengi, 14px, normal) uygular — her not
-- oluşturulduğunda bu üç sütunu doldurmaya ZORLAMAK gereksiz, yalnızca DÜZENLENEN notlarda dolar.
ALTER TABLE collection_items ADD COLUMN text_color TEXT;
ALTER TABLE collection_items ADD COLUMN font_size INTEGER;
ALTER TABLE collection_items ADD COLUMN font_weight TEXT;

-- Çizim Aracı (Pen Tool, kullanıcı isteği madde 2) — serbest el çizim yolları. Panodaki
-- collection_items'tan AYRI bir tablo: bunlar dikdörtgen/konumlanabilir "öğeler" değil, vektörel
-- kalem izleridir (bkz. js/components/auth-modal.js#renderDetail — her zaman öğelerin ÜSTÜNDE, tek
-- bir "çizim katmanı" olarak render edilir). points, pano paftasının KENDİ genişlik/yüksekliğine göre
-- yüzde (0-100) koordinat çiftleri taşıyan bir JSON dizisidir ([[x,y],...]) — collection_items'ın
-- pos_x/pos_y'siyle AYNI "piksel değil yüzde" gerekçesi (bkz. o migration'ın dosya başı yorumu).
CREATE TABLE IF NOT EXISTS board_strokes (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  points TEXT NOT NULL,
  color TEXT NOT NULL,
  stroke_width REAL NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_board_strokes_collection ON board_strokes(collection_id, created_at);
