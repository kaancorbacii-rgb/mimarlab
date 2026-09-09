-- TELİF/YAYIN HAKKI KİLİTLEME SİSTEMİ (kullanıcı isteği, 2026-09-09).
--
-- NEDEN AYRI BİR TABLO, NEDEN `projects.images` JSON'ına EK ALAN DEĞİL:
-- Bu depoda bir "medya" varlığı hiç olmadı — bir projenin görselleri `projects.images` içinde düz
-- URL dizesi dizisidir (bkz. schema.sql#projects.images) ve o dizideki URL'ler canlıda MUTLAK
-- ("https://mimarlab.com/media/...") ve GÖRELİ ("/media/...", "projects/x.webp") biçimlerde KARIŞIK
-- yazılmıştır (bkz. image-cdn.js#toLocalPath'teki aynı gerçek bulgu). Hak durumunu o JSON'un içine
-- gömmek üç şeyi imkânsız kılardı: (1) tek bir görselin durumunu index'li sorgulamak — kapının
-- (aşağıda) HER görsel isteğinde yapması gereken tam olarak budur; (2) bir görsele KALICI, opak bir
-- kimlik vermek — /api/media/:mediaId'nin varlık sebebi, orijinal yolu HİÇ açığa vurmadan bir
-- görseli adresleyebilmektir; (3) durum değişikliklerini denetim kaydına bağlamak.
--
-- KİMLİK (media_rights.id): opak, tahmin edilemez bir UUID. Orijinal R2 anahtarından/yolundan
-- TÜRETİLMEZ — türetilseydi (ör. hash) opaklık korunurdu ama kimlik, yol değiştiğinde kayardı;
-- daha önemlisi, deterministik bir kimlik ileride bir sızıntı analizinde "aynı dosya mı" sorusunu
-- yanıtlayarak kilitli içeriğin eşlenmesine yardım ederdi.
--
-- KAPSAM: bu migration YALNIZCA proje görsellerini kaydeder (entity_type='project'). entity_type
-- kolonu jeneriktir — ürün galerileri ve kişi/firma avatarları ileride ŞEMA DEĞİŞMEDEN eklenebilir.
-- Avatarlar (architects.photo_url / offices.logo_url / offices.cover_url) bilerek dışarıda: onlar
-- 48-400 px kimlik görselleridir, lisanslı fotoğraf eseri değil; kilitlenmeleri /kisi dizinini
-- bulanık yüzler duvarına çevirirdi. (Bkz. src/lib/mediaRights.js#REGISTERED_ENTITY_TYPES.)

-- ---------------------------------------------------------------------------------------------
-- 1) PROJE DÜZEYİ ONAY
-- ---------------------------------------------------------------------------------------------
-- is_copyright_approved: "bu projenin yayın hakları yetkili bir kullanıcı tarafından beyan edildi
-- ve sistem tarafından onaylandı". TEK BAŞINA hiçbir görselin telifini onaylamaz — o karar görsel
-- bazındadır (media_rights.rights_status + public_original_allowed). İki düzeyin ayrı olmasının
-- somut sebebi: bir proje künyesi doğru ve sahiplenilmiş olabilir ama galerideki tek bir
-- fotoğrafın hakkı bir başkasına (mimari fotoğrafçı) ait olabilir.
ALTER TABLE projects ADD COLUMN is_copyright_approved INTEGER NOT NULL DEFAULT 0;

-- rights_bucket: SIRALAMA için denormalize edilmiş "telif güvenliği grubu" (kullanıcı isteği
-- madde 13/14). Sıralama liste uçlarında SQL tarafında (LIMIT/OFFSET ile sayfalanan hızlı yolda)
-- yapılmak zorunda olduğundan, bucket'ın her satırda hazır durması gerekir; her istekte
-- media_rights üzerinde bir toplama yapmak o sorguyu index'siz bırakırdı (bkz. proje notu:
-- "Ofis ürün sayacı A OR B alt sorgusu" — havuz D1 maliyetinin %98'i tam olarak bu kalıptı).
--   0 = onaylı        : is_copyright_approved=1 VE en az bir approved+public_original_allowed medya
--   1 = güvenli       : onaylı değil ama gösterilebilir (disputed/removed olmayan) medyası var,
--                       ya da hiç medyası yok (nötr — kilitlenecek bir şey yok)
--   2 = ihtilaflı     : medyası var ve HEPSİ disputed/removed
-- Varsayılan 1: migration ANINDA (aşağıdaki backfill çalışmadan önce) hiçbir proje "ihtilaflı"
-- grubuna düşmesin; backfill ve trigger'lar gerçek değeri yazar.
ALTER TABLE projects ADD COLUMN rights_bucket INTEGER NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------------------------------------
-- 2) GÖRSEL BAZINDA HAK DURUMU
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_rights (
  id TEXT PRIMARY KEY,                 -- opak mediaId (UUID) — /api/media/:mediaId
  entity_type TEXT NOT NULL CHECK (entity_type IN ('project','product','architect','office')),
  entity_id INTEGER NOT NULL,
  -- media_url: kaydın `images` dizisinde GÖRÜNDÜĞÜ hâli (mutlak/göreli, olduğu gibi) — serileştirme
  -- sırasında URL -> hak satırı eşlemesi bu değerle yapılır, yani veri normalize edilmeden de
  -- eşleşme tutar.
  media_url TEXT NOT NULL,
  -- media_path: aynı görselin NORMALİZE edilmiş yerel yolu ("/media/..." | "/projects/...").
  -- Doğrudan-erişim kapısının (src/lib/mediaRights.js#lookupRightsByPath) index'li anahtarı budur.
  -- Harici (başka host) URL'lerde NULL — o baytlar zaten bizim origin'imizde değil.
  media_path TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  rights_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (rights_status IN ('unknown','pending','approved','disputed','removed')),
  -- public_original_allowed: rights_status='approved' OLSA BİLE orijinal tam çözünürlüklü dosyanın
  -- herkese açık servis edilip edilmeyeceği AYRI bir karardır (fotoğrafçı "yayınla" der ama "tam
  -- çözünürlüklü dosyayı dağıt" demez). approved olmayan bir satırda bu alan HER ZAMAN 0 olmalıdır;
  -- okuma tarafı yine de iki koşulu birlikte arar (savunma derinliği).
  public_original_allowed INTEGER NOT NULL DEFAULT 0,
  photographer TEXT,
  copyright_holder TEXT,
  source_url TEXT,
  rights_verified_at TEXT,
  rights_verified_by TEXT REFERENCES users(id),
  rights_declaration_version TEXT,
  content_origin TEXT NOT NULL DEFAULT 'platform_curated'
    CHECK (content_origin IN ('platform_curated','owner_submitted','photographer_submitted','user_submitted')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (entity_type, entity_id, media_url)
);

-- Kapının sıcak yolu: bir /media/... veya /projects/... isteği geldiğinde "bu yol kilitli mi?".
CREATE INDEX IF NOT EXISTS idx_media_rights_path ON media_rights(media_path) WHERE media_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_media_rights_entity ON media_rights(entity_type, entity_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_media_rights_status ON media_rights(rights_status);

-- ---------------------------------------------------------------------------------------------
-- 3) DENETİM KAYDI
-- ---------------------------------------------------------------------------------------------
-- consultation_actions / profile_corrections ile AYNI desen (bkz. migrations/0098). Fiziksel silme
-- YERİNE durum + kayıt: bir takedown talebinin sonradan haksız çıkması hâlinde geri alınabilmesi,
-- ve "ne zaman, kimin talebiyle, kimin kararıyla kapandı" sorusunun yanıtlanabilmesi için.
CREATE TABLE IF NOT EXISTS media_rights_audit (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL,            -- media_rights.id (content_type='media') | projects.id (='project')
  content_type TEXT NOT NULL CHECK (content_type IN ('media','project')),
  action TEXT NOT NULL CHECK (action IN ('declare','approve','revoke','dispute','takedown','remove','restore')),
  reason TEXT,
  requested_by TEXT,                   -- users.id ya da serbest metin (dış hak sahibi bildirimi)
  processed_by TEXT REFERENCES users(id),
  previous_status TEXT,
  new_status TEXT,
  -- Beyanın kanıt değeri taşıyabilmesi için (kullanıcı isteği madde 4): hangi metin sürümü
  -- onaylandı ve isteğin geldiği IP. IP yalnızca 'declare' satırlarında doldurulur.
  declaration_version TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL,
  processed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_media_rights_audit_content ON media_rights_audit(content_type, content_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_rights_audit_action ON media_rights_audit(action, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 4) rights_bucket'I HER ZAMAN GERÇEĞE EŞİT TUTAN TRIGGER'LAR
-- ---------------------------------------------------------------------------------------------
-- NEDEN TRIGGER, NEDEN UYGULAMA KODU: bu depodaki tekrar eden kök neden, doğru yardımcının bir kod
-- yolu taşındığında sessizce bypass edilmesidir (bkz. proje notu: "Tam sistem denetimi 2026-09-03").
-- media_rights'a yazan yollar zaten birden fazla (onay API'si, gönderi senkronu, toplu import
-- betikleri, elle D1 müdahalesi) — bucket'ı D1'in kendisinde tutmak, hangi yoldan yazıldığından
-- BAĞIMSIZ olarak sıralamanın doğru kalmasını garanti eder. entity_stats (0078) ile aynı gerekçe.
--
-- Hesap TEK bir ifadede: alt sorgular yalnızca o projenin medya satırlarını tarar (entity index'li).
DROP TRIGGER IF EXISTS trg_media_rights_bucket_ins;
CREATE TRIGGER trg_media_rights_bucket_ins AFTER INSERT ON media_rights
WHEN NEW.entity_type = 'project' BEGIN
  UPDATE projects SET rights_bucket = (
    CASE
      WHEN is_copyright_approved = 1 AND EXISTS (
        SELECT 1 FROM media_rights m WHERE m.entity_type = 'project' AND m.entity_id = NEW.entity_id
          AND m.rights_status = 'approved' AND m.public_original_allowed = 1) THEN 0
      WHEN EXISTS (
        SELECT 1 FROM media_rights m WHERE m.entity_type = 'project' AND m.entity_id = NEW.entity_id
          AND m.rights_status NOT IN ('disputed','removed')) THEN 1
      WHEN EXISTS (
        SELECT 1 FROM media_rights m WHERE m.entity_type = 'project' AND m.entity_id = NEW.entity_id) THEN 2
      ELSE 1
    END)
  WHERE id = NEW.entity_id;
END;

DROP TRIGGER IF EXISTS trg_media_rights_bucket_upd;
CREATE TRIGGER trg_media_rights_bucket_upd AFTER UPDATE ON media_rights
WHEN NEW.entity_type = 'project' BEGIN
  UPDATE projects SET rights_bucket = (
    CASE
      WHEN is_copyright_approved = 1 AND EXISTS (
        SELECT 1 FROM media_rights m WHERE m.entity_type = 'project' AND m.entity_id = NEW.entity_id
          AND m.rights_status = 'approved' AND m.public_original_allowed = 1) THEN 0
      WHEN EXISTS (
        SELECT 1 FROM media_rights m WHERE m.entity_type = 'project' AND m.entity_id = NEW.entity_id
          AND m.rights_status NOT IN ('disputed','removed')) THEN 1
      WHEN EXISTS (
        SELECT 1 FROM media_rights m WHERE m.entity_type = 'project' AND m.entity_id = NEW.entity_id) THEN 2
      ELSE 1
    END)
  WHERE id = NEW.entity_id;
END;

DROP TRIGGER IF EXISTS trg_media_rights_bucket_del;
CREATE TRIGGER trg_media_rights_bucket_del AFTER DELETE ON media_rights
WHEN OLD.entity_type = 'project' BEGIN
  UPDATE projects SET rights_bucket = (
    CASE
      WHEN is_copyright_approved = 1 AND EXISTS (
        SELECT 1 FROM media_rights m WHERE m.entity_type = 'project' AND m.entity_id = OLD.entity_id
          AND m.rights_status = 'approved' AND m.public_original_allowed = 1) THEN 0
      WHEN EXISTS (
        SELECT 1 FROM media_rights m WHERE m.entity_type = 'project' AND m.entity_id = OLD.entity_id
          AND m.rights_status NOT IN ('disputed','removed')) THEN 1
      WHEN EXISTS (
        SELECT 1 FROM media_rights m WHERE m.entity_type = 'project' AND m.entity_id = OLD.entity_id) THEN 2
      ELSE 1
    END)
  WHERE id = OLD.entity_id;
END;

-- Proje düzeyi onay değiştiğinde de bucket yeniden hesaplanmalı (0 <-> 1 geçişi buradan doğar).
-- KOŞUL ŞART: projects üzerinde koşulsuz bir AFTER UPDATE trigger'ı, kendi içindeki UPDATE ile
-- sonsuz özyinelemeye girer. `WHEN NEW.is_copyright_approved IS NOT OLD.is_copyright_approved`
-- hem özyinelemeyi keser (iç UPDATE bu kolona dokunmaz) hem de her proje yazımında gereksiz
-- yere çalışmasını önler.
DROP TRIGGER IF EXISTS trg_projects_rights_bucket_upd;
CREATE TRIGGER trg_projects_rights_bucket_upd AFTER UPDATE ON projects
WHEN NEW.is_copyright_approved IS NOT OLD.is_copyright_approved BEGIN
  UPDATE projects SET rights_bucket = (
    CASE
      WHEN NEW.is_copyright_approved = 1 AND EXISTS (
        SELECT 1 FROM media_rights m WHERE m.entity_type = 'project' AND m.entity_id = NEW.id
          AND m.rights_status = 'approved' AND m.public_original_allowed = 1) THEN 0
      WHEN EXISTS (
        SELECT 1 FROM media_rights m WHERE m.entity_type = 'project' AND m.entity_id = NEW.id
          AND m.rights_status NOT IN ('disputed','removed')) THEN 1
      WHEN EXISTS (
        SELECT 1 FROM media_rights m WHERE m.entity_type = 'project' AND m.entity_id = NEW.id) THEN 2
      ELSE 1
    END)
  WHERE id = NEW.id;
END;

-- ---------------------------------------------------------------------------------------------
-- 5) SIRALAMA INDEX'İ
-- ---------------------------------------------------------------------------------------------
-- idx_projects_build_status_order (0087) artık liste sıralamasını KARŞILAMAZ: sıralamanın başına
-- rights_bucket geldi. Eski index bırakılır (başka sorgular hâlâ display_order öncelikli sırayı
-- kullanabilir), yanına bucket'lı olanı eklenir — ORDER BY ile BİREBİR aynı kolon sırası.
CREATE INDEX IF NOT EXISTS idx_projects_rights_order
  ON projects(build_status, rights_bucket ASC, COALESCE(display_order, 0) ASC,
              COALESCE(publish_date, created_at) DESC, id DESC)
  WHERE deleted_at IS NULL AND hidden_at IS NULL;

-- ---------------------------------------------------------------------------------------------
-- 6) GÖNDERİ TARAFINDAKİ BEYAN
-- ---------------------------------------------------------------------------------------------
-- rights_declaration_version: proje-ekle.html'deki ZORUNLU telif beyanı kutusunun, gönderi
-- kaydedilirken onaylanmış olduğu metin sürümü (bkz. src/lib/mediaRights.js#
-- RIGHTS_DECLARATION_VERSION). Beyanın KENDİSİ (kim, ne zaman, hangi IP, hangi sürüm) denetim
-- kaydına yazılır; bu kolon yalnızca canonical senkronun "bu içerik beyanla mı geldi" sorusunu
-- yanıtlayabilmesi için taslak satırda durur. NULL = beyan yok (0106'dan önceki taslaklar).
ALTER TABLE project_submissions ADD COLUMN rights_declaration_version TEXT;
