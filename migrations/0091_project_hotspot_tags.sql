-- Marka sahiplerinin PROJE GÖRSELLERİNDE kendi ürünlerini işaretleme önerileri (kullanıcı isteği,
-- 2026-09-05 madde 5). Onaylanana kadar HİÇBİR ŞEY görünmez: yayındaki işaretçilerin tek kaynağı
-- hâlâ projects.image_hotspots'tur (bkz. migrations/0076_project_image_hotspots.sql). Bu tablo
-- yalnızca "onay bekleyen / karara bağlanmış" öneri kayıtlarını tutar; onaylandığı anda öneri
-- projects.image_hotspots'a (ve varsa projenin project_submissions taslağına) YAZILIR.
--
-- Neden ayrı bir tablo (projects satırında "pending" bir JSON alanı değil): (a) onay/red kararı,
-- karar veren ve zaman damgası denetlenebilir kalmalı; (b) aynı görsele birden fazla marka aynı
-- anda öneri gönderebilir, bunlar birbirini ezmeden sıraya girmeli; (c) proje sahibi projesini
-- düzenlediğinde (canonicalSync projects.image_hotspots'u gönderi taslağından baştan yazar) bekleyen
-- öneriler sessizce KAYBOLMAMALI.
--
-- image_url: işaretçinin ait olduğu görselin URL'si — projects.image_hotspots ile AYNI anahtarlama
-- (indeks DEĞİL, çünkü proje-ekle.html'de görseller sürükle-bırak ile yeniden sıralanabiliyor).
-- status: 'pending' | 'approved' | 'rejected'. Admin'in yaptığı etiketlemeler hiç 'pending'
-- olmadan doğrudan 'approved' yazılır (kullanıcı isteği: "Admin hesaplarından yapılan
-- etiketlemelerin onaya düşmesine gerek yok").
CREATE TABLE IF NOT EXISTS project_hotspot_tags (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  image_url TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  product_slug TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by_user_id TEXT REFERENCES users(id),
  decided_at INTEGER,
  created_at INTEGER NOT NULL
);

-- "Bana düşen bekleyen öneriler" sorgusu status + product_slug üzerinden çalışır.
CREATE INDEX IF NOT EXISTS idx_pht_status_created ON project_hotspot_tags(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pht_product ON project_hotspot_tags(product_slug);
CREATE INDEX IF NOT EXISTS idx_pht_project ON project_hotspot_tags(project_slug);
CREATE INDEX IF NOT EXISTS idx_pht_creator ON project_hotspot_tags(created_by_user_id);
-- Aynı ürünün AYNI görselde bekleyen ikinci bir önerisi olmasın (kullanıcı iki kez gönderirse
-- ikincisi hata alır, onay kuyruğu mükerrer satırla şişmez). Kısmi indeks: karara bağlanmış
-- (approved/rejected) satırlar kısıtın dışındadır — aynı ürün reddedildikten sonra yeniden
-- önerilebilmeli.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pht_pending_unique
  ON project_hotspot_tags(project_slug, image_url, product_slug)
  WHERE status = 'pending';
