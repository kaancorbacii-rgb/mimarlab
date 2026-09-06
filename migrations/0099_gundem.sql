-- GÜNDEM — otomatik toplanan mimarlık/tasarım gündemi (kullanıcı isteği, 2026-09-06).
--
-- TASARIM KARARI (kullanıcı isteği madde 6, "İÇERİK KOPYALAMA POLİTİKASI"): bu tablo bir MAKALE
-- ARŞİVİ DEĞİLDİR. Kaynak makalenin gövdesi HİÇBİR ZAMAN buraya yazılmaz — yalnızca (a) MİMARLAB'ın
-- kendi ürettiği özgün Türkçe başlık + tek paragraflık özet, (b) kaynağa geri götüren metadata,
-- (c) kaynağın KENDİ CDN'inde duran önizleme görselinin URL'i saklanır. Görsel R2'ye KOPYALANMAZ
-- (bkz. src/lib/gundemSources.js#imageHosts ve src/index.js#CSP img-src) — kaynak görseli
-- kaldırırsa bizde de kaybolur, bu bilinçli ve doğru davranıştır.
--
-- original_title/original_language yalnızca DENETİM içindir (AI'nin ürettiği Türkçe başlığın
-- kaynakla ilişkisini sonradan doğrulayabilmek için) — hiçbir public uçtan dönmez.
CREATE TABLE IF NOT EXISTS gundem_items (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  -- AI üretimi, Türkçe. Kaynak başlığının birebir çevirisi olmak ZORUNDA değil (bkz. kullanıcı
  -- isteği madde 9) ama kalite kapısı kaynakla anlamsal örtüşmeyi zorunlu tutar (bkz.
  -- src/lib/gundemQuality.js#titleOverlapsSource).
  title TEXT NOT NULL,
  original_title TEXT,
  -- AI üretimi, Türkçe, TEK paragraf, 40-80 kelime (kalite kapısında zorunlu tutulur).
  summary TEXT NOT NULL,
  -- Kaynağın kendi sunucusundaki önizleme görseli. NOT NULL: görselsiz bir kart bu sayfanın
  -- tasarımında yoktur (bkz. kullanıcı isteği madde 2), görselsiz içerik hiç yayınlanmaz.
  image_url TEXT NOT NULL,
  image_host TEXT NOT NULL,
  -- src/lib/gundemSources.js#GUNDEM_SOURCES[].id — kaynak yapılandırması KOD tarafında yaşar,
  -- bu kolon yalnızca o yapılandırmaya işaret eden kararlı bir anahtardır.
  source_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_domain TEXT NOT NULL,
  -- UNIQUE — mükerrer kontrolünün 1. basamağı (bkz. src/lib/gundemIngest.js#findDuplicate).
  -- Yönlendirme sonrası NİHAİ URL yazılır (safeFetch#finalUrl mantığı), feed'deki ham URL değil.
  source_url TEXT NOT NULL UNIQUE,
  -- Kaynak sayfanın kendi <link rel="canonical"> değeri (varsa) — aynı haberin farklı takip/
  -- kampanya URL'leriyle ikinci kez gelmesini yakalar (mükerrer kontrolü 2. basamak).
  canonical_url TEXT,
  source_published_at INTEGER,
  published_at INTEGER NOT NULL,
  -- Yalnızca src/lib/gundemCategories.js#GUNDEM_CATEGORIES whitelist'i (haber/etkinlik/gorus/
  -- yarisma/kariyer). AI önerse bile whitelist dışı bir değer buraya asla yazılmaz.
  category TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'tr',
  original_language TEXT,
  author TEXT,
  -- Mükerrer kontrolü 3. basamak: normalize edilmiş (başlık + özet kaynağı) içerik parmak izi.
  content_hash TEXT NOT NULL,
  -- Mükerrer kontrolü 4. basamak: aksan/noktalama/durak-kelime arındırılmış başlık anahtarı —
  -- AYNI haberi FARKLI URL ve farklı kaynaktan ikinci kez yayınlamayı engeller.
  title_key TEXT NOT NULL,
  -- 'published' | 'archived'. Kalite kapısından geçemeyen içerik hiç INSERT EDİLMEZ (satır olarak
  -- da tutulmaz) — bu kolon yalnızca yayındaki bir içeriği sonradan gizlemek içindir.
  status TEXT NOT NULL DEFAULT 'published',
  ai_model TEXT,
  ai_generated_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Liste ucunun (GET /api/gundem) varsayılan sıralaması + kategori filtresi.
CREATE INDEX IF NOT EXISTS idx_gundem_items_published ON gundem_items(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_gundem_items_category ON gundem_items(status, category, published_at DESC);
-- Mükerrer kontrolünün 3./4. basamakları (source_url ve slug zaten UNIQUE index taşıyor).
CREATE INDEX IF NOT EXISTS idx_gundem_items_content_hash ON gundem_items(content_hash);
CREATE INDEX IF NOT EXISTS idx_gundem_items_title_key ON gundem_items(title_key);
CREATE INDEX IF NOT EXISTS idx_gundem_items_canonical ON gundem_items(canonical_url);
-- Kaynak başına günlük/tur limitleri ve "bu kaynaktan en son ne zaman içerik geldi" sorgusu.
CREATE INDEX IF NOT EXISTS idx_gundem_items_source ON gundem_items(source_id, published_at DESC);

-- GÜNDEM -> MİMARLAB BİLGİ GRAFİĞİ KENARI (kullanıcı isteği madde 12).
--
-- KRİTİK KURAL: buraya YALNIZCA D1'de HÂLİHAZIRDA VAR OLAN bir kaydın canonical slug'ı yazılır.
-- AI'nin metinde gördüğü bir isim mevcut bir kayda TAM eşleşmiyorsa satır HİÇ oluşturulmaz —
-- yeni entity YARATILMAZ (bkz. src/lib/gundemEntities.js). Bu yüzden entity_key'e FOREIGN KEY
-- konmadı: dört farklı tabloya (offices/architects/projects/products) işaret edebiliyor; bütünlük
-- yazma anında eşleştirme ile, okuma anında da JOIN ile sağlanır (bkz. src/routes/gundem.js).
CREATE TABLE IF NOT EXISTS gundem_entities (
  item_id TEXT NOT NULL REFERENCES gundem_items(id),
  entity_type TEXT NOT NULL, -- 'office' | 'architect' | 'project' | 'product'
  entity_key TEXT NOT NULL,  -- ilgili tablodaki canonical slug
  entity_name TEXT NOT NULL, -- kaydın o anki görünen adı (link etiketi)
  created_at INTEGER NOT NULL,
  PRIMARY KEY (item_id, entity_type, entity_key)
);
CREATE INDEX IF NOT EXISTS idx_gundem_entities_target ON gundem_entities(entity_type, entity_key);

-- KAYNAK SAĞLIĞI (kullanıcı isteği madde 18) — kasıtlı olarak MİNİMAL: kaynak başına TEK satır,
-- geçmiş tutulmaz. Amaç ağır bir monitoring sistemi kurmak değil, sürekli hata veren bir kaynağın
-- her turda tekrar tekrar denenip cron bütçesini yemesini engellemek (bkz.
-- src/lib/gundemIngest.js#shouldSkipUnhealthy — üst üste N hatadan sonra kaynak soğutma
-- penceresine alınır, kendiliğinden tekrar dener).
CREATE TABLE IF NOT EXISTS gundem_source_health (
  source_id TEXT PRIMARY KEY,
  last_success_at INTEGER,
  last_error_at INTEGER,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_run_at INTEGER,
  updated_at INTEGER NOT NULL
);

-- KILL SWITCH (kullanıcı isteği madde 17) — mevcut site_settings altyapısına eklenir, YENİ bir
-- yapılandırma mekanizması kurulmaz. '1' = otomasyon açık (varsayılan), '0' = cron çalışır ama
-- HİÇBİR içerik yayınlamaz (bkz. src/lib/gundemIngest.js#runGundemIngestion).
-- src/lib/siteSettings.js#DEFAULT_SETTINGS bu anahtarı zaten tanır; satırın burada oluşturulması
-- admin panelinin Site Ayarları sekmesinde değerin ilk okumada da görünmesini sağlar.
INSERT OR IGNORE INTO site_settings (key, value, updated_at)
VALUES ('gundem_automation_enabled', '1', unixepoch() * 1000);
