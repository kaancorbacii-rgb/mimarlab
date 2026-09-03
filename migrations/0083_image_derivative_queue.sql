-- Responsive görsel türevleri için BEKLEYEN İŞ kuyruğu (bkz. src/lib/derivativeIngest.js).
--
-- NEDEN: türevler (w400/w800/w1600 WebP) ücretli Cloudflare Image Transformations YERİNE önceden
-- üretilip R2'ye yazılır. Yeni yüklemelerde bunları TARAYICI üretir (bkz. image-upload.js) —
-- Workers runtime'ında canvas/kodek olmadığı ve env.IMAGES kalıcı olarak kapalı olduğu için sunucu
-- üretemez. Tarayıcının üretemediği (çok eski tarayıcı, decode hatası, AI/sunucu kaynaklı kopya)
-- basamaklar BURAYA yazılır ve scripts/generate-image-derivatives.py tarafından toplu olarak
-- tamamlanır.
--
-- BU TABLONUN ASIL DEĞERİ ARTIMLILIK: betiğin eski çalışma biçimi, sitedeki HER kaynak için basamak
-- başına bir HEAD isteğiyle "bu türev var mı?" diye taramaktı — 26.333 kaynak x 3 basamak ≈ 79.000
-- istek ve 2026-09-03 turunda 9,5 saat. Zaten üretilmiş 23.767 türev her koşuda yeniden
-- sorgulanıyordu. Kuyrukla betik aramaz, okur: yalnızca gerçekten eksik olan iş işlenir.
--
-- Satırlar iş tamamlanınca betik tarafından silinir; kaynağın kendisi silinirse
-- src/lib/derivativeIngest.js#clearPendingForKeys temizler (aksi halde var olmayan bir kaynak için
-- sonsuza kadar iş taşınırdı).
CREATE TABLE IF NOT EXISTS image_derivative_queue (
  -- Orijinalin R2 anahtarı, "/media/" öneki OLMADAN: "u/<userId>/<uuid>.webp".
  r2_key     TEXT    NOT NULL,
  -- 400 / 800 / 1600 — image-cdn.js#DERIVATIVE_WIDTHS ile aynı merdiven.
  width      INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  -- Bileşik birincil anahtar: aynı (kaynak, basamak) çifti iki kez kuyruğa giremez; bu sayede
  -- derivativeIngest.js "INSERT OR IGNORE" ile idempotent yazabilir (eşzamanlı iki yükleme ya da
  -- betiğin yarım kalmış bir koşusu mükerrer iş üretmez).
  PRIMARY KEY (r2_key, width)
);

-- Betik kuyruğu eskiden yeniye doğru boşaltır (en uzun bekleyen görsel önce düzelir).
CREATE INDEX IF NOT EXISTS idx_image_derivative_queue_created
  ON image_derivative_queue (created_at);
