-- owner_user_id NOT NULL REFERENCES users(id) → nullable + ON DELETE SET NULL, 7 *_submissions
-- tablosunda (office/project/product/material/job/architect/news_submissions). D1 varsayılan
-- olarak FK enforcement'ı açık tutar (SQLite PRAGMA foreign_keys=ON ile eşdeğer) — bu yüzden
-- cascadeDeleteAccount() (bkz. src/lib/cascadeDelete.js) artık batch() olduğundan, onaylı bir
-- gönderisi olan HERHANGİ bir kullanıcı "Hesabımı Sil" dediğinde `DELETE FROM users` adımı FK
-- constraint hatasıyla başarısız olup TÜM hesap silme işlemini rollback ediyordu (gerçek bulgu).
--
-- Model: canlı/onaylı içerik hesap silinse bile KORUNUR (bkz. cascadeDeleteAccount dosya başı
-- yorumu) — bu, architects/offices/projects/products.claimed_by_user_id'nin ZATEN kullandığı
-- "nullable FK, hesap silinirken NULL'lanır" deseniyle birebir aynı ilke. owner_user_id bu deseni
-- 7 tabloda da izleyecek şekilde değiştiriliyor; claimed_by_user_id/resolved_by_user_id'ye
-- DOKUNULMUYOR (kapsam dışı, davranışları zaten doğru).
--
-- SQLite/D1 ALTER TABLE, NOT NULL kaldırmayı ya da FK action eklemeyi desteklemediğinden standart
-- "tablo yeniden oluşturma" deseni kullanılıyor: yeni şema ile _new tablo → veriyi taşı → eskiyi
-- sil → yeniden adlandır → index'leri yeniden kur. Her tablonun kolonu/CHECK'i/DEFAULT'u production
-- D1'deki GERÇEK haliyle (sqlite_master.sql, 2026-08-21 tarihinde doğrulandı) birebir korunuyor —
-- schema.sql bu tablolarda güncel değildi (bkz. aşağıdaki notlar), o yüzden schema.sql değil
-- production'ın kendisi kaynak alındı.
--
-- NOT (architect_submissions): production'da consultant_request/hourly_rate/session_duration_min/
-- expertise_tags/available_slots/consultant_experience_years hâlâ mevcut — migrations/
-- 0040_remove_consultant_schema.sql kendi dosya başı yorumunda "LOCAL'de test edilmiştir,
-- PRODUCTION'a UYGULANMAMIŞTIR" diyor ve doğrulandı: gerçekten uygulanmamış. Bu migration o
-- kapsam dışı durumu DEĞİŞTİRMİYOR, yalnızca mevcut kolonları olduğu gibi taşıyor.
--
-- NOT (local dev DB): local'deki gerçek şema burada YOK — local'de 0040 uygulanmış olduğundan
-- architect_submissions'ta yukarıdaki consultant_* kolonları hiç yok, project_submissions'ta ise
-- prod'da olmayan bir `kind` kolonu var. Bu dosya PRODUCTION şemasını taban alır (schema.sql'in de
-- taban aldığı kaynak). Local'e uygulanırken bu dosyanın AYNISI değil, local'in kendi gerçek
-- kolon listesiyle üretilmiş bire bir aynı mantıktaki (yalnızca owner_user_id satırı değişen) bir
-- varyantı çalıştırıldı — kapsam dışı local/prod şema farkını bu migration'ın büyütmemesi için
-- (bkz. final rapor).

PRAGMA defer_foreign_keys=ON;

-- ============================================================
-- office_submissions
-- ============================================================
CREATE TABLE office_submissions_new (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  name TEXT NOT NULL,
  loc TEXT,
  cats TEXT,
  yil INTEGER,
  website TEXT,
  about TEXT,
  logo_url TEXT,
  awards TEXT,
  claimed_profile_key TEXT,
  founders TEXT,
  social_platform TEXT,
  social_url TEXT,
  social_links TEXT,
  team TEXT
);
INSERT INTO office_submissions_new (id, owner_user_id, status, created_at, updated_at, name, loc, cats, yil, website, about, logo_url, awards, claimed_profile_key, founders, social_platform, social_url, social_links, team)
SELECT id, owner_user_id, status, created_at, updated_at, name, loc, cats, yil, website, about, logo_url, awards, claimed_profile_key, founders, social_platform, social_url, social_links, team FROM office_submissions;
DROP TABLE office_submissions;
ALTER TABLE office_submissions_new RENAME TO office_submissions;
CREATE INDEX IF NOT EXISTS idx_office_owner ON office_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_office_status_created ON office_submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_office_claimed_key ON office_submissions(claimed_profile_key);

-- ============================================================
-- project_submissions
-- ============================================================
CREATE TABLE project_submissions_new (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  slug TEXT,
  title TEXT NOT NULL,
  category TEXT,
  type TEXT,
  location TEXT,
  locationDetail TEXT,
  date TEXT,
  dateBucket TEXT,
  period TEXT,
  designer TEXT,
  photoCreditText TEXT,
  photoCreditUrl TEXT,
  description TEXT,
  images TEXT,
  brands TEXT,
  claimed_slug TEXT,
  source_url TEXT,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  discipline TEXT,
  office TEXT,
  build_status TEXT NOT NULL DEFAULT 'built',
  conceptCategory TEXT,
  awards TEXT
);
INSERT INTO project_submissions_new (id, owner_user_id, status, created_at, updated_at, slug, title, category, type, location, locationDetail, date, dateBucket, period, designer, photoCreditText, photoCreditUrl, description, images, brands, claimed_slug, source_url, ai_generated, discipline, office, build_status, conceptCategory, awards)
SELECT id, owner_user_id, status, created_at, updated_at, slug, title, category, type, location, locationDetail, date, dateBucket, period, designer, photoCreditText, photoCreditUrl, description, images, brands, claimed_slug, source_url, ai_generated, discipline, office, build_status, conceptCategory, awards FROM project_submissions;
DROP TABLE project_submissions;
ALTER TABLE project_submissions_new RENAME TO project_submissions;
CREATE INDEX IF NOT EXISTS idx_project_owner ON project_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_project_status_created ON project_submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_claimed_slug ON project_submissions(claimed_slug);

-- ============================================================
-- product_submissions
-- ============================================================
CREATE TABLE product_submissions_new (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  title TEXT NOT NULL,
  brand TEXT,
  website TEXT,
  category TEXT,
  description TEXT,
  images TEXT,
  source_url TEXT,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  specs TEXT,
  architect TEXT,
  designer TEXT,
  year TEXT
);
INSERT INTO product_submissions_new (id, owner_user_id, status, created_at, updated_at, title, brand, website, category, description, images, source_url, ai_generated, specs, architect, designer, year)
SELECT id, owner_user_id, status, created_at, updated_at, title, brand, website, category, description, images, source_url, ai_generated, specs, architect, designer, year FROM product_submissions;
DROP TABLE product_submissions;
ALTER TABLE product_submissions_new RENAME TO product_submissions;
CREATE INDEX IF NOT EXISTS idx_product_owner ON product_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_product_status_created ON product_submissions(status, created_at DESC);

-- ============================================================
-- material_submissions
-- ============================================================
CREATE TABLE material_submissions_new (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  title TEXT NOT NULL,
  brand TEXT,
  website TEXT,
  category TEXT,
  description TEXT,
  images TEXT,
  source_url TEXT,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  specs TEXT,
  architect TEXT,
  designer TEXT,
  year TEXT
);
INSERT INTO material_submissions_new (id, owner_user_id, status, created_at, updated_at, title, brand, website, category, description, images, source_url, ai_generated, specs, architect, designer, year)
SELECT id, owner_user_id, status, created_at, updated_at, title, brand, website, category, description, images, source_url, ai_generated, specs, architect, designer, year FROM material_submissions;
DROP TABLE material_submissions;
ALTER TABLE material_submissions_new RENAME TO material_submissions;
CREATE INDEX IF NOT EXISTS idx_material_owner ON material_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_material_status_created ON material_submissions(status, created_at DESC);

-- ============================================================
-- job_submissions
-- ============================================================
CREATE TABLE job_submissions_new (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  title TEXT NOT NULL,
  office TEXT,
  loc TEXT,
  level TEXT,
  role TEXT,
  tags TEXT,
  domain TEXT,
  description TEXT,
  apply TEXT,
  image_url TEXT,
  published_at INTEGER
);
INSERT INTO job_submissions_new (id, owner_user_id, status, created_at, updated_at, title, office, loc, level, role, tags, domain, description, apply, image_url, published_at)
SELECT id, owner_user_id, status, created_at, updated_at, title, office, loc, level, role, tags, domain, description, apply, image_url, published_at FROM job_submissions;
DROP TABLE job_submissions;
ALTER TABLE job_submissions_new RENAME TO job_submissions;
CREATE INDEX IF NOT EXISTS idx_job_owner ON job_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_job_status_created ON job_submissions(status, created_at DESC);

-- ============================================================
-- architect_submissions
-- ============================================================
CREATE TABLE architect_submissions_new (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  name TEXT NOT NULL,
  dob TEXT,
  school TEXT,
  office TEXT,
  position TEXT,
  awards TEXT,
  photo_url TEXT,
  dept TEXT,
  claimed_profile_key TEXT,
  profession TEXT,
  about TEXT,
  consultant_request INTEGER NOT NULL DEFAULT 0,
  hourly_rate INTEGER,
  session_duration_min INTEGER,
  expertise_tags TEXT,
  available_slots TEXT,
  consultant_experience_years INTEGER,
  social_platform TEXT,
  social_url TEXT,
  social_links TEXT
);
INSERT INTO architect_submissions_new (id, owner_user_id, status, created_at, updated_at, name, dob, school, office, position, awards, photo_url, dept, claimed_profile_key, profession, about, consultant_request, hourly_rate, session_duration_min, expertise_tags, available_slots, consultant_experience_years, social_platform, social_url, social_links)
SELECT id, owner_user_id, status, created_at, updated_at, name, dob, school, office, position, awards, photo_url, dept, claimed_profile_key, profession, about, consultant_request, hourly_rate, session_duration_min, expertise_tags, available_slots, consultant_experience_years, social_platform, social_url, social_links FROM architect_submissions;
DROP TABLE architect_submissions;
ALTER TABLE architect_submissions_new RENAME TO architect_submissions;
CREATE INDEX IF NOT EXISTS idx_architect_owner ON architect_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_architect_status_created ON architect_submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_architect_claimed_key ON architect_submissions(claimed_profile_key);
CREATE INDEX IF NOT EXISTS idx_architect_submissions_consultant ON architect_submissions(consultant_request) WHERE consultant_request = 1;

-- ============================================================
-- news_submissions
-- ============================================================
CREATE TABLE news_submissions_new (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  title TEXT NOT NULL,
  category TEXT,
  source TEXT,
  description TEXT,
  image_url TEXT
);
INSERT INTO news_submissions_new (id, owner_user_id, status, created_at, updated_at, title, category, source, description, image_url)
SELECT id, owner_user_id, status, created_at, updated_at, title, category, source, description, image_url FROM news_submissions;
DROP TABLE news_submissions;
ALTER TABLE news_submissions_new RENAME TO news_submissions;
CREATE INDEX IF NOT EXISTS idx_news_sub_owner ON news_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_news_sub_status_created ON news_submissions(status, created_at DESC);
