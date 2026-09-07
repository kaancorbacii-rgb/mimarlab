-- GÜNDEM: ANLAMSAL MÜKERRER BİRLEŞTİRME + ÇOKLU KAYNAK + TOPLAMA MODU
-- (kullanıcı isteği, 2026-09-07: "aynı içeriği iki farklı kaynaktan çekmişsin ... birbirine
-- %70'ten fazla benzeyen içerikleri tek bir gönderide iki farklı kaynak belirterek paylaş")
--
-- SORUN (canlıda ölçüldü): Foster + Partners'ın robot sürüsü haberi DÖRT ayrı kaynaktan (Arkitera,
-- Architects' Journal, Dezeen, Archiproducts) dört ayrı kart olarak yayınlandı. Mevcut siteler-arası
-- mükerrer kapısı (gundemQuality.js#findCrossSourceDuplicate) BAŞLIK KELİMELERİNİN jaccard'ına
-- bakıyor ve bu dört başlığın ikili benzerliği yalnızca 0,23-0,30 çıkıyor — çünkü her kaynağın
-- Türkçe başlığını AI bağımsız yazıyor ve kelimeler tutmuyor. Eşiği düşürmek çözüm DEĞİL: alakasız
-- ama aynı kelimeleri taşıyan içerikler (aynı gün iki ayrı Foster haberi daha vardı) birleşirdi.
--
-- ÇÖZÜM: ANLAM düzeyinde karşılaştırma. Her yayının başlık+özeti @cf/baai/bge-m3 ile gömülüyor
-- (repo'da görsel arama için ZATEN kullanılan model — yeni bağımlılık/servis yok, çok dilli olduğu
-- için Türkçe-İngilizce karşılaştırma da doğru çalışır) ve kosinüs benzerliği ölçülüyor.
--
-- ÖLÇÜM (210 canlı kayıt, tüm çiftler): gerçek mükerrerler 0,82-0,93 bandında (Foster dörtlüsünün
-- altı çifti, Kengo Kuma ödülü, Lucas müzesi); farklı-ama-ilgili içerikler 0,74 ve altında
-- (Londra Kulesi haberleri). Eşik 0,82 bu iki kümeyi ayırıyor.
--
-- embedding: int8'e nicelenmiş 1024 boyutlu vektör, base64. Ham float32 satır başına ~5,5 KB
-- tutardı ve her turda 7 günlük pencere (~300 satır) okunduğu için 1,6 MB'lık bir D1 yanıtı
-- demekti; niceleme bunu ~1,4 KB'a indiriyor (kosinüs sıralaması korunur).
ALTER TABLE gundem_items ADD COLUMN embedding TEXT;

-- extra_sources: birleştirilen İKİNCİL kaynaklar. JSON dizi: [{"name","domain","url"}].
-- Birincil kaynak (source_name/source_url) DEĞİŞMEZ — ilk yayınlayan orada kalır; bu kolon yalnızca
-- "aynı haberi şu kaynaklar da yazdı" bilgisini taşır ve kartta ek atıf olarak gösterilir.
-- NEDEN AYRI TABLO DEĞİL: her satırda en fazla birkaç öğe olur, hiçbir sorgu bunlara göre
-- filtrelemez/JOIN'lemez ve liste ucu satırı zaten tek seferde okur — ayrı tablo yalnızca her
-- kart için ikinci bir sorgu getirirdi.
ALTER TABLE gundem_items ADD COLUMN extra_sources TEXT;

-- ingest_mode: satırı hangi yol yazdı — 'cron' (otomatik tur) ya da 'backfill' (elle çalıştırılan
-- scripts/gundem-backfill.mjs).
--
-- NEDEN GEREKLİ (canlıda yaşandı, 2026-09-07): günlük yayın tavanı (GUNDEM_LIMITS.maxPublishPerDay
-- = 50) SON 24 SAATİ sayar. Yeni bir kaynak eklenip bir haftalık geçmişi çekildiğinde (Archiproducts
-- 40 + Bigumigu 9) tavan tek seferde doluyor ve SONRAKİ CRON TURLARININ TAMAMI, hiçbir kaynağa
-- dokunmadan "daily_cap_reached" ile dönüyor — sistem yaklaşık bir gün boyunca yeni içerik
-- toplamıyor. Tavanın amacı OTOMATİK hattın kaçmasını engellemek; elle başlatılan bir geri
-- doldurma zaten bilinçli bir insan kararıdır ve o kotayı yemesi anlamsızdır.
-- Bu yüzden tavan sayımı artık yalnızca 'cron' satırlarını sayar.
--
-- Var olan satırlar NULL kalır ve sayımda 'cron' gibi davranır (COALESCE) — geçmiş davranış
-- korunur; yalnızca bundan sonraki geri doldurmalar muaf olur.
ALTER TABLE gundem_items ADD COLUMN ingest_mode TEXT;
