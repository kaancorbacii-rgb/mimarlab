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
  cover_url TEXT, -- bkz. migrations/0075_office_cover_url.sql (marka kapak görseli)
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
  publishDate TEXT, -- yalnızca admin tarafından ayarlanır, bkz. migrations/0061_project_publish_date.sql
  lat REAL, lng REAL, -- proje-ekle.html haritadan opsiyonel konum işaretleme, bkz. migrations/0066_project_lat_lng.sql
  imageHotspots TEXT -- görsel üzerindeki ürün işaretçileri, görsel URL'sine göre anahtarlı JSON nesnesi, bkz. migrations/0076_project_image_hotspots.sql
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
  year TEXT, -- serbest metin üretim/tasarım yılı — bkz. migrations/0042_product_designer_year.sql
  files TEXT, -- JSON dizi [{url,filename,format,size}] — "Dosyalar (BIM, CAD, 3D, Katalog)" ekleri, images İLE AYNI desen (bkz. migrations/0071_product_files.sql)
  projects TEXT, -- JSON dizi [{slug,title}] — urun-ekle.html'deki "Kullanılan Projeler" kutusu, project_submissions.brands ile AYNI desen (bkz. migrations/0072_product_project_links.sql)
  claimed_slug TEXT -- project_submissions.claimed_slug İLE AYNI desen — bkz. migrations/0088_product_claimed_slug.sql
);
CREATE INDEX IF NOT EXISTS idx_product_owner ON product_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_product_status_created ON product_submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_claimed_slug ON product_submissions(claimed_slug);

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
  year TEXT, -- bkz. product_submissions.year açıklaması
  files TEXT, -- bkz. product_submissions.files açıklaması
  projects TEXT, -- bkz. product_submissions.projects açıklaması
  claimed_slug TEXT -- bkz. product_submissions.claimed_slug açıklaması
);
CREATE INDEX IF NOT EXISTS idx_material_owner ON material_submissions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_material_claimed_slug ON material_submissions(claimed_slug);
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

-- PAYLAŞTIKLARIM — bkz. migrations/0074_shared_items.sql (kullanıcı isteği, 2026-08-31):
-- Aktivitelerim'in "kullanıcıların paylaş butonuna tıklayarak başkalarına ilettikleri gönderiler"
-- kutusu. saved_items ile AYNI anlık-görüntü deseni, ama UNIQUE kısıtı YOK (paylaşım bir bayrak
-- değil, tekrarlanabilir bir olaydır) ve hangi kanaldan paylaşıldığını (channel) da tutar.
CREATE TABLE IF NOT EXISTS shared_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  item_type TEXT NOT NULL,
  item_key TEXT NOT NULL,
  item_title TEXT,
  item_meta TEXT,
  item_image TEXT,
  item_href TEXT,
  channel TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shared_items_user ON shared_items(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shared_items_type_key ON shared_items(item_type, item_key);

-- KOLEKSİYONUM — bkz. migrations/0073_collections.sql (kullanıcı isteği: Pinterest benzeri panolar).
-- saved_items'tan AYRI: orası "kaydettim mi" bayrağı (kullanıcı+tip+anahtar başına tekil), burası
-- kullanıcının kendi düzenlediği, kendi yüklediği görsel/notu da barındırabilen panolar.
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  cover_image TEXT,
  -- Pano paylaşımı (bkz. migrations/0082_collection_share.sql, kullanıcı isteği 2026-09-02):
  -- NULL = paylaşılmamış (varsayılan). Doluysa /pano/<share_token> adresinden herkese açık.
  share_token TEXT,
  shared_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collections_user ON collections(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_share_token
  ON collections(share_token) WHERE share_token IS NOT NULL;

-- kind: 'saved' | 'image' | 'note'. item_type/item_key yalnızca 'saved' satırlarda dolu (bkz.
-- src/routes/saved.js#ITEM_TYPES ile AYNI enum). Başlık/görsel/bağlantı, öğe eklendiği andaki
-- haliyle kopyalanır (saved_items'taki AYNI anlık-görüntü deseni).
CREATE TABLE IF NOT EXISTS collection_items (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  item_type TEXT,
  item_key TEXT,
  title TEXT,
  meta TEXT,
  image TEXT,
  href TEXT,
  note TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collection_items_collection ON collection_items(collection_id, position, created_at);

-- bkz. migrations/0069_follows.sql — kullanıcı isteği: Archello benzeri "Takip Et" özelliği.
-- saved_items ile AYNI şekil/gerekçe: followed_key = slugify(name) (rename cascade'i
-- officeFounderCascade.js#renameOfficeEverywhere/renameArchitectEverywhere'de saved_items ile
-- birlikte güncellenir). followed_ref_id, follow anında bir kez çözülüp saklanan architects.id/
-- offices.id — Aktivitelerim'deki "Takip Ettiklerim" feed sorgusu her istekte isim taraması
-- yapmak yerine doğrudan bununla JOIN/IN yapabilsin diye.
CREATE TABLE IF NOT EXISTS follows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  followed_type TEXT NOT NULL,
  followed_key TEXT NOT NULL,
  followed_title TEXT,
  followed_ref_id INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, followed_type, followed_key)
);
CREATE INDEX IF NOT EXISTS idx_follows_user ON follows(user_id);
CREATE INDEX IF NOT EXISTS idx_follows_type_key ON follows(followed_type, followed_key);

-- bkz. migrations/0070_profile_messages.sql — kullanıcı isteği: doğrulanmış mimar/firma profillerine
-- kullanıcıların mesaj gönderebilmesi. Alıcılar her gönderimde profile_claims'ten (firma için
-- OFFICE_EDIT_POSITIONS'a göre) çözülüp message_thread_recipients'a donmuş bir kopya olarak yazılır.
CREATE TABLE IF NOT EXISTS message_threads (
  id TEXT PRIMARY KEY,
  profile_type TEXT NOT NULL, -- 'architect' | 'office'
  profile_key TEXT NOT NULL,  -- architects[].name / offices[].name ile birebir eşleşir
  sender_user_id TEXT NOT NULL REFERENCES users(id),
  sender_name TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  sender_city TEXT,
  sender_company TEXT,
  sender_phone TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- open | closed
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_message_threads_sender ON message_threads(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_message_threads_profile ON message_threads(profile_type, profile_key);

CREATE TABLE IF NOT EXISTS message_thread_recipients (
  thread_id TEXT NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (thread_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_message_thread_recipients_user ON message_thread_recipients(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  sender_user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);

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
  -- P1 güvenlik düzeltmesi (migrations/0068): profile_type='office' için, admin bu claim'i
  -- onayladığı ANDAKİ users.position değerinin dondurulmuş kopyası — firma düzenleme yetkisi
  -- (bkz. src/lib/projectClaimAccess.js#OFFICE_EDIT_POSITIONS) artık kullanıcının sonradan
  -- kendi PATCH /api/profile ile değiştirebildiği CANLI position'a değil, buna bakar.
  office_position TEXT,
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
-- 0077 — liste uçlarının fingerprint sorgusu (COUNT(*)+MAX(updated_at) WHERE deleted_at IS NULL
-- AND hidden_at IS NULL) yukarıdaki TERS koşullu kısmi index'i kullanamıyordu, tam tablo
-- taraması yapıyordu (bkz. migrations/0077_live_row_fingerprint_indexes.sql).
CREATE INDEX IF NOT EXISTS idx_architects_live_updated ON architects(updated_at) WHERE deleted_at IS NULL AND hidden_at IS NULL;
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
, hidden_at TEXT, social_platform TEXT, social_url TEXT, social_links TEXT, cover_url TEXT);
CREATE INDEX IF NOT EXISTS idx_offices_claimed_by ON offices(claimed_by_user_id);
CREATE INDEX IF NOT EXISTS idx_offices_hidden_or_deleted ON offices(hidden_at, deleted_at) WHERE hidden_at IS NOT NULL OR deleted_at IS NOT NULL;
-- 0077 — liste uçlarının fingerprint sorgusu (COUNT(*)+MAX(updated_at) WHERE deleted_at IS NULL
-- AND hidden_at IS NULL) yukarıdaki TERS koşullu kısmi index'i kullanamıyordu, tam tablo
-- taraması yapıyordu (bkz. migrations/0077_live_row_fingerprint_indexes.sql).
CREATE INDEX IF NOT EXISTS idx_offices_live_updated ON offices(updated_at) WHERE deleted_at IS NULL AND hidden_at IS NULL;
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
, hidden_at TEXT, build_status TEXT NOT NULL DEFAULT 'built', concept_category TEXT, awards TEXT, publish_date TEXT, lat REAL, lng REAL, image_hotspots TEXT, display_order INTEGER);
CREATE INDEX IF NOT EXISTS idx_projects_build_status ON projects(build_status);
CREATE INDEX IF NOT EXISTS idx_projects_hidden_or_deleted ON projects(hidden_at, deleted_at) WHERE hidden_at IS NOT NULL OR deleted_at IS NOT NULL;
-- 0077 — liste uçlarının fingerprint sorgusu (COUNT(*)+MAX(updated_at) WHERE deleted_at IS NULL
-- AND hidden_at IS NULL) yukarıdaki TERS koşullu kısmi index'i kullanamıyordu, tam tablo
-- taraması yapıyordu (bkz. migrations/0077_live_row_fingerprint_indexes.sql).
CREATE INDEX IF NOT EXISTS idx_projects_live_updated ON projects(updated_at) WHERE deleted_at IS NULL AND hidden_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_projects_legacy_key ON projects(legacy_key);
-- 0087 — display_order NULL = atanmamış, COALESCE(...,0) ile mevcut/atanmış her değerden (>=1)
-- küçük olduğundan gelecekteki normal proje ekleme akışı dokunulmadan en üstte kalmaya devam eder
-- (bkz. migrations/0087_project_display_order.sql).
CREATE INDEX IF NOT EXISTS idx_projects_build_status_order
  ON projects(build_status, COALESCE(display_order, 0) ASC, COALESCE(publish_date, created_at) DESC, id DESC)
  WHERE deleted_at IS NULL AND hidden_at IS NULL;

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
-- variants: ürünün "Versiyonlar" listesi (JSON dizi) — bkz. migrations/0086_product_variants.sql
-- (neden ayrı bir product_variants tablosu DEĞİL + alan sözleşmesi orada anlatılıyor).
, hidden_at TEXT, designer TEXT, year TEXT, files TEXT, variants TEXT);
CREATE INDEX IF NOT EXISTS idx_products_brand_office ON products(brand_office_id);
CREATE INDEX IF NOT EXISTS idx_products_hidden_or_deleted ON products(hidden_at, deleted_at) WHERE hidden_at IS NOT NULL OR deleted_at IS NOT NULL;
-- 0077 — liste uçlarının fingerprint sorgusu (COUNT(*)+MAX(updated_at) WHERE deleted_at IS NULL
-- AND hidden_at IS NULL) yukarıdaki TERS koşullu kısmi index'i kullanamıyordu, tam tablo
-- taraması yapıyordu (bkz. migrations/0077_live_row_fingerprint_indexes.sql).
CREATE INDEX IF NOT EXISTS idx_products_live_updated ON products(updated_at) WHERE deleted_at IS NULL AND hidden_at IS NULL;
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

-- from_project/from_product: kenarı hangi tarafın talep ettiği (bkz. migrations/
-- 0072_product_project_links.sql) — proje-ekle.html'deki "Kullanılan Ürünler / Firmalar" kutusu
-- from_project'i, urun-ekle.html'deki "Kullanılan Projeler" kutusu from_product'ı yazar; her sync
-- yalnızca KENDİ bayrağını sıfırlayıp yeniden kurar (bkz. src/lib/canonicalSync.js#
-- setProjectProductLinks), böylece iki taraf birbirinin kenarlarını silmez.
CREATE TABLE IF NOT EXISTS project_products (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  from_project INTEGER NOT NULL DEFAULT 1,
  from_product INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_project_products_product ON project_products(product_id);

-- MARKA ↔ PROJE doğrudan kenarı — project_products'ın ÜRÜNSÜZ karşılığı. Archello künyesi ürün
-- değil YAPI ELEMANI düzeyinde ("Vitrifiye Elemanları → VitrA"), yani araya bir products satırı
-- koymadan kurulan bir kenar gerekiyordu; tam gerekçe için bkz. migrations/0085_project_brands.sql.
-- Okuma tarafında project_products zinciriyle UNION'lanır (src/routes/project.js#fetchProjectProducts,
-- src/routes/office.js#buildOfficePayload), yani iki kenar türü birbirini EZMEZ, birikir.
CREATE TABLE IF NOT EXISTS project_brands (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  office_id  INTEGER NOT NULL REFERENCES offices(id)  ON DELETE CASCADE,
  element    TEXT,                 -- künyedeki yapı elemanı, Türkçe ("Camlı Bölücüler")
  source     TEXT NOT NULL DEFAULT 'admin' CHECK (source IN ('legacy_static','submission','admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, office_id)
);
CREATE INDEX IF NOT EXISTS idx_project_brands_office ON project_brands(office_id);

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

CREATE TABLE IF NOT EXISTS duel_analyses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  choice_count INTEGER NOT NULL,
  project_slugs_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_duel_analyses_user ON duel_analyses(user_id, created_at DESC);

-- ===================== entity_stats (0078) =====================
-- Liste uçlarının parmak izi (fingerprint) kaynağı — COUNT(*) tam taramasının O(1) karşılığı.
-- Bakımı SQLite trigger'larıyla otomatik yapılır; tam gerekçe, trigger gövdeleri ve `rev` alanının
-- neden gerekli olduğu için bkz. migrations/0078_entity_stats.sql (bu dosyada tekrarlanmaz).
-- Okuyucu: src/lib/entityStats.js (tablo yoksa eski COUNT sorgusuna güvenle düşer).
CREATE TABLE IF NOT EXISTS entity_stats (
  kind TEXT PRIMARY KEY,
  live_count INTEGER NOT NULL DEFAULT 0,
  latest_updated_at TEXT,
  rev INTEGER NOT NULL DEFAULT 0
);

-- Arama katlama kolonları (0079) — architects.name_fold, offices.name_fold, products.title_fold,
-- products.brand_fold, projects.title_fold, projects.photo_credit_fold: foldTr()'nin birebir SQL
-- karşılığını hesaplayan VIRTUAL generated column'lar + index'leri. İfadeler uzun olduğundan burada
-- TEKRARLANMAZ; tek kaynak migrations/0079_search_fold_columns.sql'dir (sıfırdan kurulumda o dosya
-- bu şemadan SONRA uygulanmalıdır). NOT: pragma_table_info() generated kolonları göstermez,
-- doğrulama için pragma_table_xinfo() kullanın.

-- ===================== analytics_daily (0084) =====================
-- Profil İstatistikleri (kullanıcı isteği, 2026-09-04) — rozetli üyelerin Hesabım > İstatistikler
-- bölümünü besleyen tek yeni tablo: yalnızca GÖRÜNTÜLENME ve ARAMA GÖSTERİMİ sayaçları. Kaydetme/
-- takip/mesaj metrikleri zaten saved_items/follows/messages'ta durduğundan burada TEKRARLANMAZ.
-- Olay başına satır değil GÜNLÜK KOVA tutulur (1000 görüntülenme de 1 satır) ve satır varlığın
-- SAHİBİNE değil KENDİSİNE (slug) göre anahtarlanır — sahiplik çözümlemesi okuma yolundadır.
-- Tam gerekçe: migrations/0084_analytics_daily.sql; okuyucu/yazıcı: src/routes/analytics.js.
CREATE TABLE IF NOT EXISTS analytics_daily (
  day          TEXT    NOT NULL,
  subject_type TEXT    NOT NULL,
  subject_key  TEXT    NOT NULL,
  metric       TEXT    NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, subject_type, subject_key, metric)
);
CREATE INDEX IF NOT EXISTS idx_analytics_daily_subject
  ON analytics_daily (subject_type, subject_key, day);
