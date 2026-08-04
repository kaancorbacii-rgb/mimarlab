-- Faz 2 — ID-first canonical varlık tabloları (bkz. docs/architecture-roadmap.md §2).
-- Mevcut statik dosyalar (data.js/projeler-data.js/urunler-data.js/malzemeler-data.js) ve
-- *_submissions tabloları bare-name/free-text ile birbirine bağlanıyor (bkz. "Duplicate name key
-- limitation" — architects/offices adla anahtarlanıyor, aynı isimli kayıtlar ayırt edilemiyor).
-- Bu migration SADECE yeni ID-first tabloları ekler; mevcut hiçbir tabloyu değiştirmez/silmez —
-- statik dosyalar ve *_submissions, bu tablolar dolana ve tüm okuma yolları taşınana kadar
-- birincil kaynak olmaya devam eder (bkz. scripts/migrate-to-id-first.js, migration_name_conflicts).
--
-- KAPSAM DARALTMASI (kullanıcı isteği): Faz 3'te planlanan ayrı `photographers` varlığı ve
-- `projects.photographer_id` FK'si bu turda YOK — fotoğrafçı bilgisi mevcut haliyle serbest metin
-- fallback olarak kalıyor (photo_credit_text/photo_credit_url), roadmap'teki photographers tablosu
-- şimdilik uygulanmıyor.

CREATE TABLE IF NOT EXISTS architects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  dob TEXT,
  school TEXT,
  dept TEXT,
  profession TEXT,
  position TEXT,
  awards TEXT,                        -- JSON dizi (serbest metin ödül adları)
  about TEXT,
  photo_url TEXT,
  office_id INTEGER REFERENCES offices(id),
  role_at_office TEXT,
  source TEXT NOT NULL DEFAULT 'legacy_static' CHECK (source IN ('legacy_static','submission','admin')),
  legacy_key TEXT,                    -- eski bare-name key; migration izlenebilirliği + eski URL redirect'leri için
  claimed_by_user_id TEXT REFERENCES users(id),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_architects_legacy_key ON architects(legacy_key);
CREATE INDEX IF NOT EXISTS idx_architects_office ON architects(office_id);

CREATE TABLE IF NOT EXISTS offices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  loc TEXT,
  cats TEXT,                          -- JSON
  yil TEXT,
  website TEXT,
  about TEXT,
  logo_url TEXT,
  awards TEXT,                        -- JSON
  source TEXT NOT NULL DEFAULT 'legacy_static' CHECK (source IN ('legacy_static','submission','admin')),
  legacy_key TEXT,
  claimed_by_user_id TEXT REFERENCES users(id),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_offices_legacy_key ON offices(legacy_key);

-- offices.founders JSON-of-names yerine; canlı hesaplama mantığı zaten architects[].office ===
-- offices[].name eşleşmesiydi (bkz. ofis-detay.html#renderFoundersGrid) — migration bu eşleşmeyi
-- birebir join tablosuna aktarır.
CREATE TABLE IF NOT EXISTS office_founders (
  office_id INTEGER NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  architect_id INTEGER NOT NULL REFERENCES architects(id) ON DELETE CASCADE,
  PRIMARY KEY (office_id, architect_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  category TEXT,                      -- JSON
  type TEXT,                          -- JSON
  discipline TEXT,                    -- JSON
  location TEXT,
  location_detail TEXT,
  project_date TEXT,
  date_bucket TEXT,
  period TEXT,                        -- JSON
  description TEXT,
  images TEXT,                        -- JSON
  -- Fotoğrafçı: ayrı bir varlık/FK yok (bkz. dosya başındaki kapsam daraltma notu) — mevcut
  -- serbest metin + opsiyonel kaynak URL'si fallback olarak aynen korunuyor.
  photo_credit_text TEXT,
  photo_credit_url TEXT,
  source_url TEXT,
  ai_generated INTEGER DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'legacy_static' CHECK (source IN ('legacy_static','submission','admin')),
  legacy_key TEXT,                    -- eski slug (yeniden adlandırma/izlenebilirlik için)
  claimed_by_user_id TEXT REFERENCES users(id),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_projects_legacy_key ON projects(legacy_key);

-- projects.designer JSON-of-names yerine — bir tasarımcı adı ya bir mimara ya bir ofise eşleşir
-- (mimar-detay.html/ofis-detay.html'de ikisi de "tasarımcı" olarak render ediliyordu), bu yüzden
-- architect_id/office_id'den tam olarak biri dolu olmalı.
CREATE TABLE IF NOT EXISTS project_designers (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  architect_id INTEGER REFERENCES architects(id) ON DELETE CASCADE,
  office_id INTEGER REFERENCES offices(id) ON DELETE CASCADE,
  CHECK ((architect_id IS NOT NULL) != (office_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_project_designers_project ON project_designers(project_id);
CREATE INDEX IF NOT EXISTS idx_project_designers_architect ON project_designers(architect_id);
CREATE INDEX IF NOT EXISTS idx_project_designers_office ON project_designers(office_id);

-- product_submissions + material_submissions birleşimi (kind ile ayrılır); statik
-- urunler-data.js/malzemeler-data.js kayıtları da buraya taşınır.
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('product','material')),
  title TEXT NOT NULL,
  brand_office_id INTEGER REFERENCES offices(id),
  brand_name_raw TEXT,                -- eşleşmeyen marka adları için fallback (bkz. migration_name_conflicts)
  website TEXT,
  category TEXT,
  description TEXT,
  images TEXT,                        -- JSON
  specs TEXT,                         -- JSON [{label,value}]
  source_url TEXT,
  ai_generated INTEGER DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'legacy_static' CHECK (source IN ('legacy_static','submission','admin')),
  legacy_key TEXT,                    -- "marka|||başlık" (bkz. src/routes/legacyContent.js#productLegacyKey)
  claimed_by_user_id TEXT REFERENCES users(id),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_legacy_key ON products(legacy_key);
CREATE INDEX IF NOT EXISTS idx_products_brand_office ON products(brand_office_id);

-- product_submissions.architect (serbest metin, virgülle ayrılmış) yerine.
CREATE TABLE IF NOT EXISTS product_architects (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  architect_id INTEGER NOT NULL REFERENCES architects(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, architect_id)
);

-- "Kullanılan Ürünler/Malzemeler" graph kenarı (bkz. project_submissions.brands JSON) — Faz 2'de
-- yalnızca tablo eklenir, dolum Faz 3'e bırakılır (proje/ürün eşleştirmesi şu an serbest metin
-- marka adıyla yapılıyor, bkz. proje-detay.html#brandEntryOf).
CREATE TABLE IF NOT EXISTS project_products (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, product_id)
);

CREATE TABLE IF NOT EXISTS awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  organizer TEXT,
  year INTEGER
);
CREATE TABLE IF NOT EXISTS project_awards (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  award_id INTEGER NOT NULL REFERENCES awards(id) ON DELETE CASCADE,
  category TEXT,
  PRIMARY KEY (project_id, award_id)
);

-- ============================================================
-- MİGRASYON ÇAKIŞMA RAPORU — admin panelinde kontrol edilebilecek eşleştirme akışı
-- ============================================================
-- scripts/migrate-to-id-first.js, statik dizilerde/join alanlarında OTOMATİK eşleştiremediği her
-- durumu (aynı isimde birden fazla mimar/ofis, project.designer/office_founders/product.architect
-- içinde adı hiçbir kayda tam eşleşmeyen bir isim, brand adı hiçbir ofisle eşleşmeyen bir ürün) bu
-- tabloya bir satır olarak yazar; hiçbir satırı "tahminle" otomatik çözmez. Admin panelindeki
-- "Migrasyon Çakışmaları" ekranı (bkz. src/routes/migrationConflicts.js) bu tabloyu okur/yazar.
CREATE TABLE IF NOT EXISTS migration_name_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,          -- 'architect' | 'office' | 'project_designer' | 'office_founder' | 'product_brand' | 'product_architect'
  conflict_key TEXT NOT NULL,         -- çakışan/eşleşmeyen isim
  context TEXT,                       -- ilişkili kaydın anahtarı (ör. proje slug'ı) — join tipi çakışmalarda hangi kayıttan geldiğini gösterir
  candidates TEXT NOT NULL,           -- JSON dizi: eşleşme adayı olan canonical kayıtların özetleri ([] ise "hiç eşleşme yok" demektir)
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','ignored')),
  resolved_target_id INTEGER,         -- admin bir aday seçtiyse o kaydın id'si
  resolved_by_user_id TEXT REFERENCES users(id),
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_migration_conflicts_status ON migration_name_conflicts(entity_type, status);
