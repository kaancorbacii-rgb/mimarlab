-- MİMARLAB üyelik / gönderi sistemi şeması (D1 / SQLite)

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
  owner_user_id TEXT NOT NULL REFERENCES users(id),
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
  founders TEXT,
  claimed_profile_key TEXT
);
CREATE INDEX IF NOT EXISTS idx_office_owner ON office_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_office_status ON office_submissions(status);
CREATE INDEX IF NOT EXISTS idx_office_claimed_key ON office_submissions(claimed_profile_key);

-- claimed_slug doluysa bu satır yeni bir proje kaydı değil, projeler[]'deki (projeler-data.js,
-- statik) mevcut bir projenin slug'ına bağlı bir düzenleme talebidir — mimar/ofis'teki
-- claimed_profile_key ile aynı fikir, ama admin'e özel: sıradan üyeler için bir "projemi
-- sahiplen" akışı yok (bkz. src/routes/submissions.js#verifyClaimedSlug), bu yüzden ayrı bir
-- profile_claims benzeri onay tablosu gerekmiyor; admin'in oluşturduğu satır doğrudan
-- status='approved' yazılır.
CREATE TABLE IF NOT EXISTS project_submissions (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
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
  ai_generated INTEGER NOT NULL DEFAULT 0 -- moderasyonda görünür bir işaret; manuel gönderimlerde 0/NULL
);
CREATE INDEX IF NOT EXISTS idx_project_owner ON project_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_project_status ON project_submissions(status);
CREATE INDEX IF NOT EXISTS idx_project_claimed_slug ON project_submissions(claimed_slug);

CREATE TABLE IF NOT EXISTS product_submissions (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
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
  ai_generated INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_product_owner ON product_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_product_status ON product_submissions(status);

-- Yapı malzemeleri (doğal taş, boya, seramik vb.) — mobilya gibi tüketici ürünlerinden ayrı bir
-- kategori/sayfa (Malzeme) olarak product_submissions ile aynı şemayı kullanır (bkz. urun.html/
-- malzeme.html, src/lib/submissionTypes.js#materials).
CREATE TABLE IF NOT EXISTS material_submissions (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
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
  ai_generated INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_material_owner ON material_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_material_status ON material_submissions(status);

-- published_at: ilan onaylanıp (yeniden) yayına alındığı an (bkz. src/routes/admin.js). İlan yayında
-- kalma süresi 30 gündür; /api/public/jobs, published_at + 30 günü geçmiş satırları listeye dahil
-- etmeyerek yayından kaldırır (durum DB'de 'approved' kalır, sadece herkese açık listeden düşer).
CREATE TABLE IF NOT EXISTS job_submissions (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER,
  title TEXT NOT NULL,
  office TEXT,
  loc TEXT,
  level TEXT,
  role TEXT,
  tags TEXT,
  domain TEXT,
  description TEXT,
  apply TEXT,
  image_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_owner ON job_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_job_status ON job_submissions(status);

-- claimed_profile_key: bkz. office_submissions üzerindeki aynı alanın açıklaması (architects[].name
-- ile eşleşen statik bir profile onaylı profile_claims üzerinden yapılan düzenleme talebi).
CREATE TABLE IF NOT EXISTS architect_submissions (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  name TEXT NOT NULL,
  dob TEXT,
  school TEXT,
  dept TEXT,
  office TEXT,
  position TEXT,
  profession TEXT,
  awards TEXT,
  photo_url TEXT,
  claimed_profile_key TEXT
);
CREATE INDEX IF NOT EXISTS idx_architect_owner ON architect_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_architect_status ON architect_submissions(status);
CREATE INDEX IF NOT EXISTS idx_architect_claimed_key ON architect_submissions(claimed_profile_key);

CREATE TABLE IF NOT EXISTS news_submissions (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
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
CREATE INDEX IF NOT EXISTS idx_news_sub_status ON news_submissions(status);

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

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, target_id);

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
