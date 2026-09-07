-- GÜNDEM SIRALAMASI: gösterilen tarihe göre (kullanıcı isteği, 2026-09-07:
-- "Gündem içeriklerini her zaman en yakın tarihten en eski tarihe doğru sırala").
--
-- SORUN: liste sorguları published_at'e (MİMARLAB'a yazılma anı) göre sıralıyordu, ama kart ve
-- JSON-LD source_published_at'i (kaynağın kendi yayın tarihi) gösteriyor. Cron turunda ikisi
-- dakikalar içinde birbirini izlediğinden fark görünmüyordu; toplu bir yazımda (2026-09-07'de 154
-- kayıt) kartlar tarihsiz sırada göründü.
--
-- ÇÖZÜM: sıralama artık COALESCE(source_published_at, published_at) ifadesine göre yapılıyor
-- (bkz. src/routes/gundem.js#GUNDEM_SORT). Bu index'ler o ifadeyi karşılar; olmasaydı her liste
-- isteği tam tablo taraması + geçici sıralama yapardı.
--
-- ESKİ INDEX'LER DÜŞÜRÜLMEDİ: idx_gundem_items_published ve idx_gundem_items_category hâlâ
-- kullanılıyor — ingest tarafındaki günlük yayın tavanı ve siteler arası mükerrer penceresi
-- (published_at >= ?) ingest anına bakmaya devam ediyor (bkz. src/lib/gundemIngest.js).
CREATE INDEX IF NOT EXISTS idx_gundem_items_sorted
  ON gundem_items(status, COALESCE(source_published_at, published_at) DESC);

CREATE INDEX IF NOT EXISTS idx_gundem_items_cat_sorted
  ON gundem_items(status, category, COALESCE(source_published_at, published_at) DESC);
