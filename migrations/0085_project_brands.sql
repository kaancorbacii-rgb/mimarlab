-- MARKA ↔ PROJE doğrudan kenarı (kullanıcı isteği, 2026-09-04: 58 Archello markası içe aktarılırken
-- "markanın ürünlerinin yer aldığı referans projeleri tespit et ... ilişkiyi çift taraflı bağla").
--
-- NEDEN YENİ BİR TABLO — mevcut zincir bu veriyi TEMSİL EDEMİYOR:
-- Bugüne kadar "bu projede hangi markalar kullanıldı" sorusunun TEK cevabı ürün üzerinden geçen bir
-- zincirdi:  project_products → products → offices  (bkz. src/routes/project.js#fetchProjectProducts
-- ve src/routes/office.js#brandProductProjectsRes). Yani bir markayı bir projeye bağlamanın tek yolu
-- araya bir `products` satırı koymaktı.
--
-- Archello'nun künyesi ise ürün DEĞİL, YAPI ELEMANI düzeyinde: "Sanitary Elements → VitrA Bathrooms",
-- "Glazed Partitions → ASPEN". Ortada model adı olan bir katalog ürünü YOK. Bu veriyi eski zincire
-- sığdırmanın tek yolu her kenar için "Sanitary Elements" adında sahte bir `products` satırı açmaktı;
-- bu satırlar ürün kataloğunda (/urun), marka popup'ının "Ürünler" bölümünde ve arama sonuçlarında
-- gerçek ürünmüş gibi görünürdü. Katalogu kirletmemek için kenar KENDİ tablosuna yazılır.
--
-- İKİ KENAR TÜRÜ BİRLİKTE OKUNUR, BİRBİRİNİ EZMEZ: ürün üzerinden gelen (project_products) kenarlar
-- olduğu gibi kalır; bu tablo onların ÜZERİNE eklenir. Okuma tarafında ikisi UNION'lanır (bkz.
-- src/routes/project.js#fetchProjectProducts, src/routes/office.js#buildOfficePayload) — böylece bir
-- marka hem kataloglu ürünüyle hem de eleman künyesiyle aynı projede görünüyorsa TEK kart olur.
CREATE TABLE IF NOT EXISTS project_brands (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  office_id  INTEGER NOT NULL REFERENCES offices(id)  ON DELETE CASCADE,
  -- Künyedeki yapı elemanı, Türkçeleştirilmiş ("Vitrifiye Elemanları", "Camlı Bölücüler").
  -- İsteğe bağlı: kenar, eleman adı bilinmese de geçerlidir.
  element    TEXT,
  -- Kenarın nereden geldiği. 'admin' = toplu içe aktarım (Archello künyesi), 'submission' =
  -- ileride proje/marka formundan gelecek kullanıcı girişi. `offices`/`projects`'teki `source`
  -- kolonuyla AYNI sözlük.
  source     TEXT NOT NULL DEFAULT 'admin' CHECK (source IN ('legacy_static','submission','admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- (proje, marka) TEKİL: aynı marka bir projede birden fazla elemanla geçebilir (Archello'da
  -- oluyor), ama popup'ta TEK kart olarak görünmeli. Elemanlar tek satırda ' · ' ile birleştirilir.
  PRIMARY KEY (project_id, office_id)
);

-- project_products'taki idx_project_products_product ile AYNI gerekçe: proje→marka yönü zaten
-- PRIMARY KEY'in soluyla karşılanıyor, ters yön (marka→projeleri, marka popup'ı) kendi index'ini
-- ister — aksi halde her marka popup'ı tam tablo tarar.
CREATE INDEX IF NOT EXISTS idx_project_brands_office ON project_brands(office_id);
