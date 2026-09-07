-- OKUNDU İŞARETİ (kullanıcı isteği, 2026-09-07): Gündem kartlarına Kaydet/Paylaş'ın SOLUNA bir
-- "Okundu" butonu. Kullanıcı bir içeriği okuduğunda işaretler ve hangi içerikleri görüp görmediğini
-- tek bakışta ayırt eder. Durum kullanıcı HESABINDA tutulur (isteğin açık şartı) — localStorage
-- DEĞİL, çünkü kullanıcının telefonda okuduğu içerik masaüstünde de okunmuş görünmeli.
--
-- NEDEN AYRI TABLO, NEDEN saved_items'a YENİ BİR item_type DEĞİL:
-- "Kaydet" ile "Okundu" anlamları taban tabana zıttır — Kaydet "sonra dönmek istiyorum", Okundu
-- "işim bitti" demektir. İkisini aynı tabloda toplamak "Benim Alanım > Kaydedilenler" listesini
-- okunmuş içeriklerle doldururdu; saved_items'ı okuyan HER yer (routes/saved.js, collections.js,
-- analytics.js#saved sayımları, public.js#save count, admin'in üye Kaydettiklerim görünümü)
-- item_type'a göre ayrıca filtrelemek zorunda kalırdı ve biri unutulursa hata SESSİZ olurdu.
-- Bu depoda tam olarak bu kök neden tekrar ediyor (bkz. "iki yerde tutulan liste ayrıştı").
--
-- ŞEKİL saved_items ile BİLİNÇLİ OLARAK AYNI (user_id + item_type + item_key + UNIQUE): okundu
-- işareti ileride başka bir içerik tipine de gerekirse (ör. bildirimler) tablo hazır. Ama başlık/
-- görsel/href KOPYALANMAZ — saved_items onları hedef silinse bile listeyi gösterebilmek için
-- saklar; okundu işaretinin böyle bir listesi YOKTUR, yalnızca bir evet/hayır durumudur.
CREATE TABLE IF NOT EXISTS read_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  item_type TEXT NOT NULL,
  item_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, item_type, item_key)
);

-- Tek sorgu deseni: "bu kullanıcının bu tipteki TÜM okundu anahtarları" (bkz. routes/reads.js
-- #listReads — sayfa başına BİR kez çağrılır, /api/saved ile aynı desen). UNIQUE kısıtının örtük
-- index'i (user_id, item_type, item_key) bu sorguyu zaten karşılar, ek index GEREKMEZ.
