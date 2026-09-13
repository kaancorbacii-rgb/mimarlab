-- SİTE ÇEVİRİSİ (kullanıcı isteği, 2026-09-13 madde 1: "EN'e tıklayınca site İngilizce'ye dönsün").
--
-- NEDEN TAM BİR i18n DEĞİL: sitede 32 HTML sayfası ve ~40 JS bileşeni var, metinlerin neredeyse
-- tamamı JS şablon dizelerinin İÇİNDE üretiliyor (bkz. js/components/*.js) ve asıl içerik (proje
-- başlıkları, açıklamalar, gündem metinleri) zaten D1'de YALNIZCA Türkçe duruyor. Yani bir anahtar/
-- katalog tabanlı i18n, arayüz metinlerini çevirse bile SİTENİN İÇERİĞİNİ çeviremezdi — kullanıcının
-- istediği ise "sitedeki içerikleri İngilizce'ye çevirebilen EN". Bu yüzden çeviri, sunucuda
-- Workers AI ile çalışan ve sonucu KALICI olarak burada biriktiren bir katman olarak kuruldu.
--
-- NEDEN D1, KV DEĞİL: KV günlük YAZMA kotası bu projede daha önce tükendi (bkz. src/lib/kvQuota.js
-- ve gatedMedia.js'teki "KV YAZMAZ" notu) ve çeviri önbelleği doğası gereği yazma ağırlıklı bir
-- ısınma dönemi yaşar — ilk haftalarda her yeni dize bir yazmadır. D1'de bu satırlar sıradan
-- INSERT'lerdir ve kota baskısı yaratmaz.
--
-- NEDEN KULLANICIYA DEĞİL KAYNAK METNE ANAHTARLI (küresel önbellek): "Proje" dizesi kim isterse
-- istesin aynı İngilizce karşılığa sahiptir. Önbellek küresel olduğu için ikinci ziyaretçiden
-- itibaren AI'ya HİÇ gidilmez; site sözlüğü birkaç gün içinde doyar ve çeviri maliyeti sıfıra iner.
--
-- hash = sha256Hex(target_lang + '\n' + source_text) — bkz. src/lib/translateStore.js#translationHash.
-- Kaynak metnin kendisini birincil anahtar yapmak D1'de uzun metinlerde indeks şişmesi demekti;
-- source_text yine de saklanıyor çünkü hatalı bir çeviriyi bulup silmek (invalidate) için okunabilir
-- olması şart.
CREATE TABLE IF NOT EXISTS translations (
  hash TEXT PRIMARY KEY,
  target_lang TEXT NOT NULL,
  source_text TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Dil bazlı toplu temizlik/denetim için (ör. "EN çevirilerini sıfırla"). Sıcak yol yalnızca birincil
-- anahtarı kullanır, bu indeks okuma yolunda HİÇ kullanılmaz.
CREATE INDEX IF NOT EXISTS idx_translations_lang ON translations(target_lang, created_at);
