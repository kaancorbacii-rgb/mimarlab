-- 0077 — Liste uçlarının "parmak izi" (fingerprint) sorguları için kısmi (partial) index'ler.
--
-- Kök neden (production audit, 2026-09-01): src/routes/{project,architect,office,product}.js'teki
-- *ListFingerprint() fonksiyonlarının hepsi
--     SELECT COUNT(*), MAX(updated_at) FROM <tablo> WHERE deleted_at IS NULL AND hidden_at IS NULL
-- çalıştırıyor. Mevcut idx_*_hidden_or_deleted index'leri BU koşulun TERSİNİ kapsıyor
-- (`WHERE hidden_at IS NOT NULL OR deleted_at IS NOT NULL` — yalnızca gizli/silinmiş satırlar),
-- yani planlayıcı bu sorgu için onları KULLANAMIYOR. Canlıda ve yerelde EXPLAIN QUERY PLAN ile
-- doğrulandı: "SCAN projects" — yani her çalıştırmada TAM tablo taranıyor ve projects/architects/
-- offices/products satırları geniş (images/description/JSON sütunları) olduğundan bu, okunan satır
-- başına gereksiz büyük bir I/O maliyeti demek.
--
-- 2026-08-25 D1 denetimi bu sorgunun ÖNÜNE 60 saniyelik bir KV önbelleği (getCachedFingerprint)
-- koymuştu — bu, sorgunun NE SIKLIKLA çalıştığını azalttı ama KENDİSİNİ ucuzlatmadı: her PoP kendi
-- KV MISS'inde, ayrıca her içerik mutasyonundan sonra (invalidatePublicCache fingerprint
-- anahtarlarını da siler) yeniden tam tarama yapılıyor.
--
-- Çözüm: sorgunun TAM koşulunu kapsayan, tek sütunlu (updated_at) kısmi index'ler. Planlayıcı artık
-- COUNT(*) ve MAX(updated_at)'i tabloya hiç dokunmadan yalnızca bu dar index üzerinden karşılıyor
-- (canlıda doğrulandı: "SCAN projects" -> "SCAN projects USING INDEX idx_projects_live_updated").
--
-- DÜRÜST SINIR — bu index D1'in rows_read SAYACINI DÜŞÜRMEZ: COUNT(*) hâlâ canlı satırların
-- tamamına dokunmak zorunda (canlıda ölçüldü: 1542 satır, index'ten önce de sonra da aynı).
-- Kazanç okunan SAYFA sayısında ve gecikmede: projects/products satırları geniş (images JSON,
-- description, hotspots...), bu index ise tek sütunluk dar bir B-tree — aynı satır sayısı çok daha
-- az sayfa okumasıyla taranır. 50.000-100.000 kayıt ölçeğinde (bkz. kullanıcı isteği) rows_read
-- maliyetini GERÇEKTEN sabitlemenin tek yolu, yazma yolunda güncellenen bir sayaç/özet tablosudur
-- (tetikleyici ya da mutasyon noktalarında elle) — bu, kapsamı bu denetimin "güvenli düzeltme"
-- sınırının dışında kalan bir şema değişikliği olduğundan rapora yol haritası maddesi olarak yazıldı.
--
-- Tamamen EK bir yapı — hiçbir sorgu/satır/sonuç değişmez, yalnızca planlayıcıya daha ucuz bir yol
-- açılır; geri alınması `DROP INDEX` ile tek adımdır.
--
-- NOT: sitemap üretimi (src/index.js#listCanonicalEntityUrls) de BİREBİR aynı
-- `deleted_at IS NULL AND hidden_at IS NULL` koşulunu kullanır (4 tablo için 4 SELECT) — o sorgular
-- slug de okuduğundan bu index'i "covering" olarak kullanamaz, ama kısmi index yine de taranacak
-- satır kümesini daraltır.

CREATE INDEX IF NOT EXISTS idx_projects_live_updated
  ON projects(updated_at) WHERE deleted_at IS NULL AND hidden_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_architects_live_updated
  ON architects(updated_at) WHERE deleted_at IS NULL AND hidden_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_offices_live_updated
  ON offices(updated_at) WHERE deleted_at IS NULL AND hidden_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_products_live_updated
  ON products(updated_at) WHERE deleted_at IS NULL AND hidden_at IS NULL;
