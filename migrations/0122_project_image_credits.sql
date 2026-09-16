-- GÖRSEL BAŞINA FOTOĞRAFÇI + "Fotoğraf bana ait" ONAY KUYRUĞU (kullanıcı isteği, 2026-09-16
-- ikinci tur madde 1 ve 2):
--   (1) "Proje ekle/düzenle sayfasında eğer fotoğrafçı kısmına birden fazla fotoğrafçı yazıldıysa
--       fotoğrafların üstüne tıklanınca açılan lightboxta hangi fotoğrafı hangi fotoğrafçının
--       çektiği seçilebilsin."
--   (2) "Proje popuplarındaki lightboxta 'Fotoğraf bana ait' butonu olsun ve bu butona tıklayınca
--       görseldeki ismin değişmesi için firma yöneticilerine ve admine bildirim gitsin. Firma
--       yöneticileri veya admin bildirimi onaylarsa fotoğrafçı bilgisi lightboxa ve proje
--       künyesine eklensin."
--
-- ============================================================================================
-- 1) image_credits — GÖRSEL BAŞINA fotoğrafçı adı
-- ============================================================================================
-- Veri biçimi (her iki tabloda da AYNI): görsel URL'sine göre anahtarlanmış düz bir JSON nesnesi —
--   { "<görsel url>": "Fotoğrafçı Adı" }
-- image_hotspots (bkz. migrations/0076_project_image_hotspots.sql) ile BİREBİR AYNI anahtarlama ve
-- AYNI gerekçe: indeks DEĞİL URL, çünkü proje-ekle.html'de görseller sürükle-bırak ile yeniden
-- sıralanabiliyor (bkz. o dosyadaki mediaItems) — indeks tabanlı bir eşleme her sıralama
-- değişiminde sessizce yanlış fotoğrafçıyı gösterirdi.
--
-- NEDEN AYRI BİR KOLON (projects.photo_credit_text'i parçalamak yerine): photo_credit_text
-- PROJENİN künyesidir — virgülle ayrılmış TÜM fotoğrafçıları taşır, project_photographers kenarını
-- besler (bkz. canonicalSync.js#syncProject), arama/SEO gövdesi onu okur ve tek bir fotoğrafçı
-- yazıldığında bugünkü davranış hiç değişmemeli. Bu kolon o künyenin ALT KIRILIMIDIR: "künyedeki
-- hangi ad, hangi kareyi çekti". Boş bırakılan bir kare künyenin tamamına düşer (lightbox'ta eski
-- davranış: "© A, B"), yani kolon hiç yazılmamış TÜM mevcut projeler bugünkü görünümünü korur.
--
-- DEĞER SERBEST METİNDİR, bir foreign key DEĞİL: künyeye yazılan fotoğrafçıların büyük çoğunluğunun
-- sitede profili yok (bkz. canonicalSync.js#syncProject'teki "logConflict BİLEREK çağrılmaz" notu)
-- ve profili olanlar zaten project_photographers üzerinden ayrıca bağlı. Bu kolon "künyede ne
-- yazıyordu" sorusunun görsel bazındaki cevabıdır — projects.designer_names_raw ile aynı desen
-- (bkz. migrations/0120_project_designer_names_raw.sql).
ALTER TABLE projects ADD COLUMN image_credits TEXT;
ALTER TABLE project_submissions ADD COLUMN imageCredits TEXT;

-- ============================================================================================
-- 2) project_photo_claims — "Fotoğraf bana ait" onay kuyruğu
-- ============================================================================================
-- project_hotspot_tags (bkz. migrations/0091_project_hotspot_tags.sql) ile BİREBİR AYNI desen ve
-- AYNI üç gerekçe: (a) onay/red kararı, karar veren ve zaman damgası denetlenebilir kalmalı;
-- (b) aynı görsel için birden fazla kişi talep açabilir ve bunlar birbirini ezmeden sıraya girmeli;
-- (c) proje sahibi projesini düzenlediğinde (canonicalSync projects.image_credits'i gönderi
-- taslağından BAŞTAN yazar) bekleyen talepler sessizce KAYBOLMAMALI.
--
-- Onaylanana kadar HİÇBİR ŞEY görünmez: yayındaki fotoğrafçı bilgisinin tek kaynağı hâlâ
-- projects.photo_credit_text + projects.image_credits'tir. Onay anında talep O İKİ YERE birden
-- yazılır (bkz. src/routes/photoClaims.js#applyPhotoClaim) — künyeye VE lightbox'a, kullanıcı
-- isteğinin ikinci cümlesi tam olarak bunu istiyor.
--
-- claimed_name: künyeye YAZILACAK ad. Varsayılan olarak talep edenin hesap adıdır ama kutuda
-- düzenlenebilir — bir fotoğrafçı stüdyo adıyla ("ALTKAT Architectural Photography") anılmayı
-- seçebilir, hesap adı ile künyede görünmek istediği ad AYNI ŞEY DEĞİLDİR (bkz. CLAUDE.md
-- "Hesap üyeliği ile kişi profili AYRIDIR").
--
-- image_url NULL OLABİLİR: talep TÜM projenin künyesi için de açılabilir (kullanıcı görseli tek tek
-- değil, projenin fotoğraflarının tamamını çektiyse). NULL = "künyeye ekle, tek bir kareye bağlama".
CREATE TABLE IF NOT EXISTS project_photo_claims (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  image_url TEXT,
  claimed_name TEXT NOT NULL,
  note TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by_user_id TEXT REFERENCES users(id),
  decided_at INTEGER,
  created_at INTEGER NOT NULL
);

-- "Bana düşen bekleyen talepler" sorgusu status + project_slug üzerinden çalışır.
CREATE INDEX IF NOT EXISTS idx_ppc_status_created ON project_photo_claims(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ppc_project ON project_photo_claims(project_slug);
CREATE INDEX IF NOT EXISTS idx_ppc_creator ON project_photo_claims(created_by_user_id);

-- Aynı kullanıcının AYNI görsel için bekleyen ikinci bir talebi olmasın (iki kez gönderirse
-- ikincisi hata alır, onay kuyruğu mükerrer satırla şişmez). Kısmi indeks: karara bağlanmış
-- (approved/rejected) satırlar kısıtın dışındadır — reddedilen bir talep, eksik bilgisi
-- tamamlanıp yeniden açılabilmeli.
--
-- COALESCE(image_url, '') ŞART: SQLite'ta NULL'lar UNIQUE kısıtını hiç tetiklemez, yani
-- image_url NULL olan (proje künyesinin tamamı için açılmış) talepler sınırsız tekrarlanabilirdi.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ppc_pending_unique
  ON project_photo_claims(project_slug, COALESCE(image_url, ''), created_by_user_id)
  WHERE status = 'pending';
