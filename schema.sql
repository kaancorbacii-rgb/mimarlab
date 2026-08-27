-- MİMARLAB üyelik / gönderi sistemi şeması (D1 / SQLite)
--
-- Denetim bulgusu (2026-08-22): bu dosya önceden yalnızca aşağıdaki eski üyelik/gönderi alt
-- sistemini kapsıyordu — sitenin gerçek çekirdek kataloğu (architects/offices/projects/products
-- ve bunlara bağlı Faz 2/3 tabloları) hiç belgelenmemişti (bkz. dosya sonundaki yeni bölüm).
-- Bu READ-ONLY bir dokümantasyon/parity düzeltmesidir — production D1 şeması bu düzeltmeyle
-- HİÇ değiştirilmedi, yalnızca bu dosya production'ın gerçek sqlite_master dökümüyle eşleştirildi.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  dob TEXT,
  school TEXT,
  dept TEXT,
  photo_url TEXT,
  profession TEXT,
  position TEXT,
  awards TEXT,
  about TEXT,
  social_links TEXT,
  kvkk_accepted_at INTEGER,
  role TEXT NOT NULL DEFAULT 'user',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- claimed_profile_key doluysa bu satır yeni bir ofis kaydı değil, o profile_key'e (offices[].name)
-- sahip statik bir profile onaylı bir profile_claims üzerinden yapılan bir DÜZENLEME talebidir;
-- onaylanınca /api/public/profile-edits üzerinden ilgili statik profile bindirilir, genel yeni-
-- kayıt listesine (/api/public/offices) dahil edilmez (bkz. src/routes/submissions.js, public.js).
CREATE TABLE IF NOT EXISTS office_submissions (
  id TEXT PRIMARY KEY,
  -- owner_user_id: nullable + ON DELETE SET NULL (bkz. migrations/
  -- 0055_submissions_owner_user_id_nullable.sql) — hesap silinse bile onaylı gönderi KORUNUR,
  -- yalnızca sahiplik bağı kopar (architects/offices/projects/products.claimed_by_user_id ile
  -- AYNI ilke). Önceden NOT NULL'du: D1 varsayılan olarak FK enforcement'ı açık tuttuğundan
  -- (PRAGMA foreign_keys=ON ile eşdeğer), onaylı bir gönderisi olan kullanıcının hesabını silmek
  -- cascadeDeleteAccount()'un DELETE FROM users adımında FK constraint hatasıyla başarısız olup
  -- TÜM işlemi rollback ediyordu (gerçek bulgu).
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
  social_platform TEXT, -- bkz. migrations/0035_social_media.sql
  social_url TEXT, -- bkz. migrations/0035_social_media.sql
  social_links TEXT, -- bkz. migrations/0036_social_links.sql
  team TEXT -- Kurucular dışındaki ekip üyeleri (bkz. migrations/0048_office_team.sql)
);
CREATE INDEX IF NOT EXISTS idx_office_owner ON office_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_office_status_created ON office_submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_office_claimed_key ON office_submissions(claimed_profile_key);

-- claimed_slug doluysa bu satır yeni bir proje kaydı değil, projeler[]'deki (projeler-data.js,
-- statik) mevcut bir projenin slug'ına bağlı bir düzenleme talebidir — mimar/ofis'teki
-- claimed_profile_key ile aynı fikir, ama admin'e özel: sıradan üyeler için bir "projemi
-- sahiplen" akışı yok (bkz. src/routes/submissions.js#verifyClaimedSlug), bu yüzden ayrı bir
-- profile_claims benzeri onay tablosu gerekmiyor; admin'in oluşturduğu satır doğrudan
-- status='approved' yazılır.
CREATE TABLE IF NOT EXISTS project_submissions (
  id TEXT PRIMARY KEY,
  -- owner_user_id: bkz. office_submissions üzerindeki aynı alanın açıklaması — nullable + ON
  -- DELETE SET NULL (migrations/0055_submissions_owner_user_id_nullable.sql).
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
  source_url TEXT, -- AI ile otomatik ekleme akışının çıkarım yaptığı kaynak sayfa (bkz. src/routes/ai.js)
  ai_generated INTEGER NOT NULL DEFAULT 0, -- moderasyonda görünür bir işaret; manuel gönderimlerde 0/NULL
  discipline TEXT, -- "Tür" facet: Mimari/İç Mekan/Peyzaj ve Kentsel Tasarım/Restorasyon (bkz. migrations/0017_project_discipline.sql)
  office TEXT, -- bkz. migrations/0030_project_submission_office.sql
  build_status TEXT NOT NULL DEFAULT 'built', -- bkz. migrations/0037_project_build_status.sql
  conceptCategory TEXT, -- bkz. migrations/0038_project_concept_category.sql
  awards TEXT, -- JSON dizi (serbest metin ödül adları) — architect_submissions/office_submissions.awards ile AYNI desen, bkz. migrations/0049_project_awards.sql
  publishDate TEXT -- yalnızca admin tarafından ayarlanır, bkz. migrations/0061_project_publish_date.sql
);
CREATE INDEX IF NOT EXISTS idx_project_owner ON project_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_project_status_created ON project_submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_claimed_slug ON project_submissions(claimed_slug);

CREATE TABLE IF NOT EXISTS product_submissions (
  id TEXT PRIMARY KEY,
  -- owner_user_id: bkz. office_submissions üzerindeki aynı alanın açıklaması — nullable + ON
  -- DELETE SET NULL (migrations/0055_submissions_owner_user_id_nullable.sql).
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
  specs TEXT, -- JSON dizi [{label, value}] — urun-detay.html "Teknik Özellikler" tablosu (bkz. migrations/0018_product_specs.sql)
  source_url TEXT,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  architect TEXT, -- artık urun-ekle.html'de kutusu yok, hiçbir yazma yolu yok (bkz. migrations/0020_product_architect.sql) — yalnızca eski satırlar için korunuyor
  designer TEXT, -- serbest metin ürün tasarımcısı adı — bkz. migrations/0042_product_designer_year.sql
  year TEXT -- serbest metin üretim/tasarım yılı — bkz. migrations/0042_product_designer_year.sql
);
CREATE INDEX IF NOT EXISTS idx_product_owner ON product_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_product_status_created ON product_submissions(status, created_at DESC);

-- Yapı malzemeleri (doğal taş, boya, seramik vb.) — mobilya gibi tüketici ürünlerinden ayrı bir
-- kategori/sayfa (Malzeme) olarak product_submissions ile aynı şemayı kullanır (bkz. urun.html/
-- malzeme.html, src/lib/submissionTypes.js#materials).
CREATE TABLE IF NOT EXISTS material_submissions (
  id TEXT PRIMARY KEY,
  -- owner_user_id: bkz. office_submissions üzerindeki aynı alanın açıklaması — nullable + ON
  -- DELETE SET NULL (migrations/0055_submissions_owner_user_id_nullable.sql).
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
  specs TEXT, -- bkz. product_submissions.specs açıklaması
  source_url TEXT,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  architect TEXT, -- bkz. product_submissions.architect açıklaması
  designer TEXT, -- bkz. product_submissions.designer açıklaması
  year TEXT -- bkz. product_submissions.year açıklaması
);
CREATE INDEX IF NOT EXISTS idx_material_owner ON material_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_material_status_created ON material_submissions(status, created_at DESC);

-- published_at: ilan onaylanıp (yeniden) yayına alındığı an (bkz. src/routes/admin.js). İlan yayında
-- kalma süresi 30 gündür; /api/public/jobs, published_at + 30 günü geçmiş satırları listeye dahil
-- etmeyerek yayından kaldırır (durum DB'de 'approved' kalır, sadece herkese açık listeden düşer).
CREATE TABLE IF NOT EXISTS job_submissions (
  id TEXT PRIMARY KEY,
  -- owner_user_id: bkz. office_submissions üzerindeki aynı alanın açıklaması — nullable + ON
  -- DELETE SET NULL (migrations/0055_submissions_owner_user_id_nullable.sql).
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
CREATE INDEX IF NOT EXISTS idx_job_owner ON job_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_job_status_created ON job_submissions(status, created_at DESC);

-- claimed_profile_key: bkz. office_submissions üzerindeki aynı alanın açıklaması (architects[].name
-- ile eşleşen statik bir profile onaylı profile_claims üzerinden yapılan düzenleme talebi).
CREATE TABLE IF NOT EXISTS architect_submissions (
  id TEXT PRIMARY KEY,
  -- owner_user_id: bkz. office_submissions üzerindeki aynı alanın açıklaması — nullable + ON
  -- DELETE SET NULL (migrations/0055_submissions_owner_user_id_nullable.sql).
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
  about TEXT, -- serbest metin biyografi, office_submissions.about ile aynı desen (bkz. migrations/0019_architect_about.sql)
  -- consultant_request/hourly_rate/session_duration_min/expertise_tags/available_slots/
  -- consultant_experience_years: danışmanlık modülü başvuru alanları (bkz. migrations/
  -- 0031_architect_consultant.sql, 0033_consultant_experience.sql, 0034_consultant_submission_
  -- fields.sql). migrations/0040_remove_consultant_schema.sql bu kolonları kaldırmak için
  -- yazıldı ama kendi dosya başı yorumunda belirttiği gibi YALNIZCA LOCAL'de uygulandı,
  -- PRODUCTION'da hâlâ mevcutlar (doğrulandı, bkz. 0055 migration dosya başı notu) — bu tablo
  -- production'ın gerçek şemasını yansıtıyor, bu yüzden burada duruyorlar.
  consultant_request INTEGER NOT NULL DEFAULT 0,
  hourly_rate INTEGER,
  session_duration_min INTEGER,
  expertise_tags TEXT,
  available_slots TEXT,
  consultant_experience_years INTEGER,
  social_platform TEXT, -- bkz. migrations/0035_social_media.sql
  social_url TEXT, -- bkz. migrations/0035_social_media.sql
  social_links TEXT -- bkz. migrations/0036_social_links.sql
);
CREATE INDEX IF NOT EXISTS idx_architect_owner ON architect_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_architect_status_created ON architect_submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_architect_claimed_key ON architect_submissions(claimed_profile_key);
CREATE INDEX IF NOT EXISTS idx_architect_submissions_consultant ON architect_submissions(consultant_request) WHERE consultant_request = 1;

CREATE TABLE IF NOT EXISTS news_submissions (
  id TEXT PRIMARY KEY,
  -- owner_user_id: bkz. office_submissions üzerindeki aynı alanın açıklaması — nullable + ON
  -- DELETE SET NULL (migrations/0055_submissions_owner_user_id_nullable.sql).
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
CREATE INDEX IF NOT EXISTS idx_news_sub_owner ON news_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_news_sub_status_created ON news_submissions(status, created_at DESC);

CREATE TABLE IF NOT EXISTS news (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT,
  source TEXT,
  description TEXT,
  image_url TEXT,
  published INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- admin_seen/status (migrations/0027_comment_admin_seen.sql, 0029_comment_moderation.sql) — bu
-- dosya denetim bulgusu (2026-08-22) sonrası production sqlite_master ile eşleştirildi, önceden
-- burada eksikti. idx_comments_target da migrations/0052 ile idx_comments_target_created'a
-- (created_at eklenmiş hâli) genişletildiği için production'da artık yok, aşağıda güncellendi.
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  admin_seen INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS idx_comments_target_created ON comments(target_type, target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_admin_seen ON comments(admin_seen);
CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status);
CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id);

CREATE TABLE IF NOT EXISTS saved_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  item_type TEXT NOT NULL,
  item_key TEXT NOT NULL,
  item_title TEXT,
  item_meta TEXT,
  item_image TEXT,
  item_href TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, item_type, item_key)
);
CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_items(user_id);
-- bkz. migrations/0059_saved_items_type_key_index.sql
CREATE INDEX IF NOT EXISTS idx_saved_items_type_key ON saved_items(item_type, item_key);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

CREATE TABLE IF NOT EXISTS ratings (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  stars INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_ratings_target ON ratings(target_type, target_id);

-- Bir kullanıcının bir mimar/ofis profilinin sahibi olduğu iddiası; admin onayından geçer.
-- Onaylandığında o profile gelen yorumları silme ve rozet satın alma hakkı bu kullanıcıya bağlanır.
CREATE TABLE IF NOT EXISTS profile_claims (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  profile_type TEXT NOT NULL, -- 'architect' | 'office'
  profile_key TEXT NOT NULL, -- architects[].name ya da offices[].name ile birebir eşleşir
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, profile_type, profile_key)
);
CREATE INDEX IF NOT EXISTS idx_claims_status ON profile_claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_key ON profile_claims(profile_type, profile_key);

-- Bir mimar/marka profilindeki "Bilgi kaynağı" kutucuğundan gönderilen, sahiplenme iddiası
-- OLMAYAN düzeltme önerileri (ör. yanlış bilgi bildirimi). profile_claims'ten ayrı: aynı kullanıcı
-- aynı profil için birden fazla öneri gönderebilir (unique kısıtı yok), admin manuel düzeltip
-- 'resolved' işaretler. Admin panelinde profile_claims ile aynı "Profil Talepleri" sekmesinde okunur.
CREATE TABLE IF NOT EXISTS profile_corrections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  profile_type TEXT NOT NULL, -- 'architect' | 'office'
  profile_key TEXT NOT NULL,
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | resolved | dismissed
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_corrections_status ON profile_corrections(status);
CREATE INDEX IF NOT EXISTS idx_corrections_key ON profile_corrections(profile_type, profile_key);

-- Doğrulanmış Profil rozeti satın alma (aylık kiralama) talepleri. Ödeme altyapısı bağlanana
-- kadar admin panelinden elle 'active' yapılır ve expires_at = onay anı + 30 gün olarak
-- ayarlanır; aktif olduğunda ilgili kullanıcının onaylı profile_claims kaydı üzerinden rozet,
-- ilgili mimar/ofis profilinde gösterilir. Bir kullanıcı aynı (target_type, target_key) hedefi
-- için aynı anda yalnızca 1 rozet tutabilir — farklı hedefler (kendisi + her marka) için ayrı
-- ayrı aktif rozeti olabilir (bkz. src/routes/badges.js, src/routes/admin.js).
CREATE TABLE IF NOT EXISTS badge_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  badge_type TEXT NOT NULL, -- destekci | verified | gold | platinum
  target_type TEXT NOT NULL DEFAULT 'self', -- 'self' (kişisel) | 'office' (belirli bir marka)
  target_key TEXT, -- yalnızca target_type='office' iken dolu; offices[].name ile birebir eşleşir
  status TEXT NOT NULL DEFAULT 'pending', -- pending | active | rejected
  price_try REAL NOT NULL,
  expires_at INTEGER, -- yalnızca status='active' iken dolu; aylık kiralamanın bitiş tarihi
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  payment_provider TEXT, -- 'iyzico' | NULL (admin tarafından elle onaylandıysa)
  payment_token TEXT, -- iyzico Checkout Form token'ı (bkz. src/routes/payments.js)
  payment_id TEXT -- iyzico paymentId (iade işlemleri için)
);
CREATE INDEX IF NOT EXISTS idx_badge_user ON badge_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_badge_status ON badge_requests(status);
CREATE INDEX IF NOT EXISTS idx_badge_target ON badge_requests(target_type, target_key);

-- Admin'in bir mimar/firma profiline satın alma/sahiplenme olmadan DOĞRUDAN verdiği rozet (bkz.
-- kullanıcı isteği: "Admin mimar veya marka profilini düzenlerken istediği rozeti seçebilsin ve
-- profile ekleyebilsin"). badge_requests'ten farklı olarak bir user_id/profile_claims gerektirmez —
-- statik (hiç sahiplenilmemiş) bir profile bile uygulanabilir. Profil başına tek satır (admin
-- rozeti değiştirirse üzerine yazılır); src/routes/badges.js#handlePublicBadges bunu satın alınan
-- rozetlerle aynı çıktıya birleştirir.
CREATE TABLE IF NOT EXISTS admin_badges (
  profile_type TEXT NOT NULL, -- 'architect' | 'office'
  profile_key TEXT NOT NULL, -- architects[].name ya da offices[].name
  badge_type TEXT NOT NULL, -- verified | gold | platinum
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_type, profile_key)
);

-- Ziyaretçilerin İletişim sayfasındaki formdan gönderdiği mesajlar; admin panelinde okunur.
CREATE TABLE IF NOT EXISTS contact_messages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contact_read ON contact_messages(is_read);

-- Hesabım sayfasındaki "Bildirimler" kutusunu besler: profil/rozet talebi onaylandı/reddedildi,
-- gönderi onaylandı/reddedildi, sahiplenilen bir profile ya da kendi proje/haberine yorum geldi
-- gibi olaylarda src/lib/notify.js#createNotification ile buraya bir satır eklenir (bkz.
-- src/routes/admin.js, src/routes/comments.js). link, varsa ilgili sayfaya götürür.
-- Basit sabit pencereli hız sınırlama sayaçları (bkz. src/lib/rateLimit.js): login, signup,
-- forgot-password ve contact endpoint'lerinde brute-force/numaralandırma/spam'e karşı.
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at);

-- bkz. migrations/0060_newsletter_notify_counter.sql, src/lib/newsletterNotify.js — "5 gönderiden
-- 1'i" bülten kısıtlaması için atomik sayaç, rate_limits İLE AYNI desen ama pencere/expires_at yok.
CREATE TABLE IF NOT EXISTS newsletter_notify_counter (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);

-- Statik (miras) proje/mimar/ofis/ürün/malzeme/haber kayıtları (projeler-data.js, data.js,
-- urunler-data.js, malzemeler-data.js, haberler-data.js) veritabanında bir satıra sahip değil —
-- bu tablo admin panelinden bu kayıtları canlı siteden gizlemek/tekrar göstermek için kullanılan
-- bir moderasyon bayrağı, profile_claims/profile_corrections'taki gibi kaydın DOĞAL anahtarıyla
-- eşleşir (bkz. kullanıcı isteği: "admin tüm sitede tüm yetkilere sahip olsun ... arşivleme").
-- content_key: projects->slug, architects/offices->name, news->id, products/materials->"marka|||başlık".
CREATE TABLE IF NOT EXISTS legacy_content_hidden (
  id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL, -- 'projects' | 'architects' | 'offices' | 'products' | 'materials' | 'news'
  content_key TEXT NOT NULL,
  hidden_by_user_id TEXT NOT NULL REFERENCES users(id),
  hidden_at INTEGER NOT NULL,
  UNIQUE(content_type, content_key)
);
CREATE INDEX IF NOT EXISTS idx_legacy_hidden_type ON legacy_content_hidden(content_type);

-- R2'nin (mimarlab-uploads) ücretsiz kotasını (10 GB depolama / ayda 1M Class A işlem) hiç
-- aşmaması için tek satırlık bir kümülatif kullanım sayacı (bkz. kullanıcı isteği: "R2 Paid'in
-- asla para çekmesini istemiyorum ... asla ücretli kota kullanımına geçme", src/lib/r2Quota.js).
-- R2'de hiçbir yerde .delete() çağrılmadığından (bkz. src/routes/upload.js, src/routes/ai.js)
-- total_bytes hiç azalmaz, gerçek kullanımı hep doğru yansıtır. ops_month değiştiğinde ops_count
-- uygulama tarafında sıfırlanır (ücretsiz işlem kotası aylık yenilenir).
CREATE TABLE IF NOT EXISTS r2_usage (
  id TEXT PRIMARY KEY,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  ops_count INTEGER NOT NULL DEFAULT 0,
  ops_month TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0
);

-- ============================================================
-- Faz 2/3 — Canonical ID-first varlıklar (architects/offices/projects/products) ve
-- ilişkili tablolar (bkz. migrations/0022_id_first_entities.sql ve sonrası).
-- Denetim bulgusu (2026-08-22): bu bölüm önceden schema.sql'de HİÇ yoktu — dosyanın
-- yalnızca eski üyelik/gönderi alt sistemini kapsadığı, sitenin gerçek çekirdek
-- katalog tablolarının (architects/offices/projects/products) ise hiç belgelenmediği
-- anlamına geliyordu. Aşağıdaki tüm CREATE TABLE/INDEX ifadeleri production'ın gerçek
-- sqlite_master dökümünden birebir alınmıştır (2026-08-22).
-- ============================================================

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
, hidden_at TEXT, is_consultant INTEGER NOT NULL DEFAULT 0, hourly_rate INTEGER, session_duration_min INTEGER NOT NULL DEFAULT 45, expertise_tags TEXT, available_slots TEXT, consultant_bio TEXT, consultant_total_minutes INTEGER NOT NULL DEFAULT 0, consultant_sessions_completed INTEGER NOT NULL DEFAULT 0, consultant_experience_years INTEGER, social_platform TEXT, social_url TEXT, social_links TEXT);
CREATE INDEX IF NOT EXISTS idx_architects_claimed_by ON architects(claimed_by_user_id);
CREATE INDEX IF NOT EXISTS idx_architects_consultant ON architects(is_consultant) WHERE is_consultant = 1;
CREATE INDEX IF NOT EXISTS idx_architects_hidden_or_deleted ON architects(hidden_at, deleted_at) WHERE hidden_at IS NOT NULL OR deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_architects_legacy_key ON architects(legacy_key);
CREATE INDEX IF NOT EXISTS idx_architects_name ON architects(name);
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
, hidden_at TEXT, social_platform TEXT, social_url TEXT, social_links TEXT);
CREATE INDEX IF NOT EXISTS idx_offices_claimed_by ON offices(claimed_by_user_id);
CREATE INDEX IF NOT EXISTS idx_offices_hidden_or_deleted ON offices(hidden_at, deleted_at) WHERE hidden_at IS NOT NULL OR deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_offices_legacy_key ON offices(legacy_key);
CREATE INDEX IF NOT EXISTS idx_offices_name ON offices(name);

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
, hidden_at TEXT, build_status TEXT NOT NULL DEFAULT 'built', concept_category TEXT, awards TEXT, publish_date TEXT);
CREATE INDEX IF NOT EXISTS idx_projects_build_status ON projects(build_status);
CREATE INDEX IF NOT EXISTS idx_projects_hidden_or_deleted ON projects(hidden_at, deleted_at) WHERE hidden_at IS NOT NULL OR deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_legacy_key ON projects(legacy_key);

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
, hidden_at TEXT, designer TEXT, year TEXT);
CREATE INDEX IF NOT EXISTS idx_products_brand_office ON products(brand_office_id);
CREATE INDEX IF NOT EXISTS idx_products_hidden_or_deleted ON products(hidden_at, deleted_at) WHERE hidden_at IS NOT NULL OR deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_legacy_key ON products(legacy_key);

-- ---------- İlişki / bağlantı tabloları ----------

CREATE TABLE IF NOT EXISTS office_founders (
  office_id INTEGER NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  architect_id INTEGER NOT NULL REFERENCES architects(id) ON DELETE CASCADE,
  PRIMARY KEY (office_id, architect_id)
);
CREATE INDEX IF NOT EXISTS idx_office_founders_architect ON office_founders(architect_id);

CREATE TABLE IF NOT EXISTS project_designers (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  architect_id INTEGER REFERENCES architects(id) ON DELETE CASCADE,
  office_id INTEGER REFERENCES offices(id) ON DELETE CASCADE,
  CHECK ((architect_id IS NOT NULL) != (office_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_project_designers_architect ON project_designers(architect_id);
CREATE INDEX IF NOT EXISTS idx_project_designers_office ON project_designers(office_id);
CREATE INDEX IF NOT EXISTS idx_project_designers_project ON project_designers(project_id);

CREATE TABLE IF NOT EXISTS project_products (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, product_id)
);

CREATE TABLE IF NOT EXISTS project_awards (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  award_id INTEGER NOT NULL REFERENCES awards(id) ON DELETE CASCADE,
  category TEXT,
  PRIMARY KEY (project_id, award_id)
);

CREATE TABLE IF NOT EXISTS product_architects (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  architect_id INTEGER NOT NULL REFERENCES architects(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, architect_id)
);

CREATE TABLE IF NOT EXISTS awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  organizer TEXT,
  year INTEGER
);

-- ---------- Slug / rename / SEO / site config ----------

CREATE TABLE IF NOT EXISTS slug_redirects (
  entity_type TEXT NOT NULL, -- 'projects' | 'architects' | 'offices'
  old_slug TEXT NOT NULL,
  new_slug TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (entity_type, old_slug)
);

CREATE TABLE IF NOT EXISTS seo_overrides (
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  meta_title TEXT,
  meta_description TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (entity_type, entity_key)
);

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

-- ---------- En İyi 100 (editoryal, sabit taban + gerçek puanlarla harmanlanır) ----------

CREATE TABLE IF NOT EXISTS top100_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rnk INTEGER NOT NULL,
  name TEXT NOT NULL,
  slug TEXT,
  base_avg REAL NOT NULL,
  base_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_top100_entries_rnk ON top100_entries(rnk);

CREATE TABLE IF NOT EXISTS top100_rank_snapshot (
  target_key TEXT PRIMARY KEY,
  rnk INTEGER NOT NULL,
  snapshot_at INTEGER NOT NULL
);

-- ---------- Facet/arama önbelleği, kota takibi, bülten ----------

CREATE TABLE IF NOT EXISTS facet_counts (
  list_type TEXT NOT NULL,            -- 'architects' | 'offices' | 'projects' | 'products'
  facet_key TEXT NOT NULL,            -- 'category' | 'position' | 'award' | ...
  facet_value TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (list_type, facet_key, facet_value)
);

CREATE TABLE IF NOT EXISTS kv_usage (
  id TEXT PRIMARY KEY,
  writes_count INTEGER NOT NULL DEFAULT 0,
  writes_day TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  unsubscribe_token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  unsubscribed_at INTEGER
);

-- ---------- Migrasyon çakışma takibi (bkz. src/routes/migrationConflicts.js) ----------
-- Denetim bulgusu (2026-08-22): bu tabloyu okuyan/güncelleyen API (GET/PATCH
-- /api/admin/migration-conflicts) production'da TAM ÇALIŞIR durumda ama hiçbir admin
-- ekranından tüketilmiyor — production'da 1017 pending kayıt birikmiş durumda.

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

-- ---------- Kaldırılmış "danışmanlık" özelliği (bkz. migrations/0040) ----------
-- 2026-08-10'da üründen kaldırıldı; hiçbir canlı route bu tabloyu okumuyor/yazmıyor.
-- migrations/0040_remove_consultant_schema.sql bu tabloyu (ve architects/
-- architect_submissions'daki consultant_* kolonlarını) DROP etmek için yazıldı ama
-- kendi başlığında belirttiği gibi PRODUCTION'a hiç uygulanmadı — production hâlâ bu
-- şemayı taşıyor, bu yüzden parity için burada belgeleniyor.

CREATE TABLE IF NOT EXISTS consultation_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  consultant_key TEXT NOT NULL,
  requested_date TEXT NOT NULL,
  requested_time TEXT NOT NULL,
  price_try INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected','cancelled')),
  payment_provider TEXT NOT NULL DEFAULT 'havale',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
, phone TEXT);
CREATE INDEX IF NOT EXISTS idx_consultation_requests_consultant ON consultation_requests(consultant_key);
CREATE INDEX IF NOT EXISTS idx_consultation_requests_user ON consultation_requests(user_id);

-- ---------- Düello (bkz. migrations/0062_duel_system.sql) ----------

CREATE TABLE IF NOT EXISTS project_duel_stats (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  duel_score INTEGER NOT NULL DEFAULT 0,
  total_comparisons INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_duel_stats_score ON project_duel_stats(duel_score DESC);

CREATE TABLE IF NOT EXISTS duel_matches (
  id TEXT PRIMARY KEY,
  actor_key TEXT NOT NULL,
  project_a_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  project_b_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  winner_project_id INTEGER REFERENCES projects(id),
  voted_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_duel_matches_actor ON duel_matches(actor_key, created_at DESC);

CREATE TABLE IF NOT EXISTS duel_sessions (
  actor_key TEXT PRIMARY KEY,
  active_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  streak INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id TEXT PRIMARY KEY,
  actor_key TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  day TEXT NOT NULL,
  question_type TEXT NOT NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  correct INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_actor_day ON quiz_attempts(actor_key, day);

CREATE TABLE IF NOT EXISTS duel_analyses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  choice_count INTEGER NOT NULL,
  project_slugs_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_duel_analyses_user ON duel_analyses(user_id, created_at DESC);

