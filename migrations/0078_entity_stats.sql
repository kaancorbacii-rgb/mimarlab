-- 0078 — entity_stats: liste uçlarının "parmak izi" (fingerprint) değerini O(1) okunabilir hale getirir.
--
-- KÖK NEDEN (production audit, 2026-09-01, madde A). src/routes/{project,architect,office,product}.js
-- içindeki 4 *ListFingerprint() fonksiyonu şunu çalıştırıyor:
--     SELECT COUNT(*), MAX(updated_at) FROM <tablo> WHERE deleted_at IS NULL AND hidden_at IS NULL
-- Bu sorgu, tanımı gereği CANLI SATIR SAYISIYLA DOĞRUSAL büyür: COUNT(*) her canlı satıra dokunmak
-- zorundadır. 0077'deki kısmi index okunan SAYFA sayısını düşürdü ama rows_read'i düşüremez
-- (canlıda ölçüldü: index'ten önce de sonra da 1542 satır).
--
-- Ölçek matematiği (bkz. kullanıcı isteği: 10k/50k/100k entity hedefi): sorgu 60 saniyelik bir KV
-- önbelleğinin (getCachedFingerprint) arkasında, AMA caches.default/KV PoP-BAŞINADIR — her aktif
-- Cloudflare PoP'u kendi MISS'inde bu sorguyu yeniden çalıştırır, ayrıca her içerik mutasyonu
-- (invalidatePublicCache) tüm fingerprint anahtarlarını siler. 100.000 projede, ~20 aktif PoP ile
-- dakikada 20 × 100.000 = 2.000.000 rows_read — yalnızca "bir şey değişti mi?" sorusunu yanıtlamak için.
--
-- ÇÖZÜM: 4 tablo için canlı satır sayısı + en son updated_at + monoton bir revizyon sayacı tutan
-- tek satırlık bir özet tablosu. Fingerprint artık TEK bir PRIMARY KEY araması (1 satır okuma),
-- kayıt sayısından tamamen bağımsız.
--
-- NEDEN TRIGGER, NEDEN UYGULAMA KODU DEĞİL: özet tabloyu mutasyon noktalarında elle güncellemek
-- 13'ten fazla çağrı noktasına dokunmayı gerektirirdi (admin.js, submissions.js, legacyContent.js,
-- canonicalSync.js, officeFounderCascade.js, cascadeDelete.js, payments.js ...) ve İLERİDE eklenecek
-- bir yazma yolunun bunu unutması sessiz bir bayatlık hatası üretirdi — bu tam olarak bu depoda daha
-- önce yaşanmış bir hata sınıfı (bkz. publicCache.js#DEFAULT_FIRST_PAGE_PATHS yorumundaki
-- "invalidation sessizce no-op'a dönüyordu" bulgusu). SQLite trigger'ları HER INSERT/UPDATE/DELETE'te
-- çalışır — uygulama kodundan, `wrangler d1 execute` ile atılan elle SQL'den ve scripts/*.js toplu
-- içe aktarımlarından gelen yazımlar dahil. Yani bu, mevcut elle invalidation'dan DAHA kapsamlı.
--
-- GÜVENLİ GERİ DÜŞÜŞ: src/lib/entityStats.js, entity_stats'ta satır BULAMAZSA eski COUNT(*) sorgusuna
-- düşer (bkz. o dosya). Bu migration uygulanmamış bir ortamda (ör. yeni bir yerel D1) davranış
-- ESKİSİYLE BİREBİR AYNI kalır, hiçbir şey kırılmaz.

CREATE TABLE IF NOT EXISTS entity_stats (
  kind TEXT PRIMARY KEY,                 -- 'projects' | 'architects' | 'offices' | 'products'
  live_count INTEGER NOT NULL DEFAULT 0, -- deleted_at IS NULL AND hidden_at IS NULL olan satır sayısı
  latest_updated_at TEXT,                -- canlı satırlar arasındaki en büyük updated_at
  -- rev: HER trigger tetiklenmesinde artan monoton sayaç. live_count + latest_updated_at ikilisi tek
  -- başına yeterli DEĞİL — gerçek bulgu: bir satırı gizleyip (count -1) başka bir satırı görünür
  -- yapmak (count +1) ikiliyi eski değerine geri döndürebilir ve bayat bir ETag'i "taze" gösterirdi.
  -- Ayrıca latest_updated_at bilerek monoton tutuluyor (bir satır gizlendiğinde AZALTILMIYOR — bu,
  -- her gizleme işleminde tekrar bir MAX() taraması gerektirirdi, yani çözmeye çalıştığımız O(n)
  -- maliyetini geri getirirdi); rev bu gevşekliği telafi eder.
  rev INTEGER NOT NULL DEFAULT 0
);

-- Başlangıç değerleri gerçek veriden hesaplanır (tek seferlik tam tarama — kabul edilebilir).
-- INSERT OR REPLACE: migration yeniden çalıştırılırsa değerler yeniden senkronlanır (idempotent).
INSERT OR REPLACE INTO entity_stats (kind, live_count, latest_updated_at, rev)
  SELECT 'projects', COUNT(*), MAX(updated_at), 0 FROM projects WHERE deleted_at IS NULL AND hidden_at IS NULL;
INSERT OR REPLACE INTO entity_stats (kind, live_count, latest_updated_at, rev)
  SELECT 'architects', COUNT(*), MAX(updated_at), 0 FROM architects WHERE deleted_at IS NULL AND hidden_at IS NULL;
INSERT OR REPLACE INTO entity_stats (kind, live_count, latest_updated_at, rev)
  SELECT 'offices', COUNT(*), MAX(updated_at), 0 FROM offices WHERE deleted_at IS NULL AND hidden_at IS NULL;
INSERT OR REPLACE INTO entity_stats (kind, live_count, latest_updated_at, rev)
  SELECT 'products', COUNT(*), MAX(updated_at), 0 FROM products WHERE deleted_at IS NULL AND hidden_at IS NULL;

-- Her tablo için 3 trigger (INSERT / UPDATE / DELETE). UPDATE trigger'ı canlılık geçişini İKİ YÖNLÜ
-- ele alır: yeni durum canlıysa +1, eski durum canlıydıysa -1 (ikisi de canlıysa net 0). Bu yüzden
-- "gizle", "gizlemeyi kaldır", "sil", "geri yükle" işlemlerinin hepsi doğru sayılır.
-- DROP IF EXISTS: migration'ın yeniden çalıştırılabilir olması için (CREATE TRIGGER IF NOT EXISTS
-- eski SQLite sürümlerinde davranış farkı gösterebildiğinden açık DROP tercih edildi).

DROP TRIGGER IF EXISTS trg_projects_stats_ins;
CREATE TRIGGER trg_projects_stats_ins AFTER INSERT ON projects BEGIN
  UPDATE entity_stats SET
    live_count = live_count + (CASE WHEN NEW.deleted_at IS NULL AND NEW.hidden_at IS NULL THEN 1 ELSE 0 END),
    latest_updated_at = CASE WHEN NEW.deleted_at IS NULL AND NEW.hidden_at IS NULL
      AND (latest_updated_at IS NULL OR COALESCE(NEW.updated_at, '') > latest_updated_at)
      THEN NEW.updated_at ELSE latest_updated_at END,
    rev = rev + 1
  WHERE kind = 'projects';
END;
DROP TRIGGER IF EXISTS trg_projects_stats_upd;
CREATE TRIGGER trg_projects_stats_upd AFTER UPDATE ON projects BEGIN
  UPDATE entity_stats SET
    live_count = live_count
      + (CASE WHEN NEW.deleted_at IS NULL AND NEW.hidden_at IS NULL THEN 1 ELSE 0 END)
      - (CASE WHEN OLD.deleted_at IS NULL AND OLD.hidden_at IS NULL THEN 1 ELSE 0 END),
    latest_updated_at = CASE WHEN NEW.deleted_at IS NULL AND NEW.hidden_at IS NULL
      AND (latest_updated_at IS NULL OR COALESCE(NEW.updated_at, '') > latest_updated_at)
      THEN NEW.updated_at ELSE latest_updated_at END,
    rev = rev + 1
  WHERE kind = 'projects';
END;
DROP TRIGGER IF EXISTS trg_projects_stats_del;
CREATE TRIGGER trg_projects_stats_del AFTER DELETE ON projects BEGIN
  UPDATE entity_stats SET
    live_count = live_count - (CASE WHEN OLD.deleted_at IS NULL AND OLD.hidden_at IS NULL THEN 1 ELSE 0 END),
    rev = rev + 1
  WHERE kind = 'projects';
END;

DROP TRIGGER IF EXISTS trg_architects_stats_ins;
CREATE TRIGGER trg_architects_stats_ins AFTER INSERT ON architects BEGIN
  UPDATE entity_stats SET
    live_count = live_count + (CASE WHEN NEW.deleted_at IS NULL AND NEW.hidden_at IS NULL THEN 1 ELSE 0 END),
    latest_updated_at = CASE WHEN NEW.deleted_at IS NULL AND NEW.hidden_at IS NULL
      AND (latest_updated_at IS NULL OR COALESCE(NEW.updated_at, '') > latest_updated_at)
      THEN NEW.updated_at ELSE latest_updated_at END,
    rev = rev + 1
  WHERE kind = 'architects';
END;
DROP TRIGGER IF EXISTS trg_architects_stats_upd;
CREATE TRIGGER trg_architects_stats_upd AFTER UPDATE ON architects BEGIN
  UPDATE entity_stats SET
    live_count = live_count
      + (CASE WHEN NEW.deleted_at IS NULL AND NEW.hidden_at IS NULL THEN 1 ELSE 0 END)
      - (CASE WHEN OLD.deleted_at IS NULL AND OLD.hidden_at IS NULL THEN 1 ELSE 0 END),
    latest_updated_at = CASE WHEN NEW.deleted_at IS NULL AND NEW.hidden_at IS NULL
      AND (latest_updated_at IS NULL OR COALESCE(NEW.updated_at, '') > latest_updated_at)
      THEN NEW.updated_at ELSE latest_updated_at END,
    rev = rev + 1
  WHERE kind = 'architects';
END;
DROP TRIGGER IF EXISTS trg_architects_stats_del;
CREATE TRIGGER trg_architects_stats_del AFTER DELETE ON architects BEGIN
  UPDATE entity_stats SET
    live_count = live_count - (CASE WHEN OLD.deleted_at IS NULL AND OLD.hidden_at IS NULL THEN 1 ELSE 0 END),
    rev = rev + 1
  WHERE kind = 'architects';
END;

DROP TRIGGER IF EXISTS trg_offices_stats_ins;
CREATE TRIGGER trg_offices_stats_ins AFTER INSERT ON offices BEGIN
  UPDATE entity_stats SET
    live_count = live_count + (CASE WHEN NEW.deleted_at IS NULL AND NEW.hidden_at IS NULL THEN 1 ELSE 0 END),
    latest_updated_at = CASE WHEN NEW.deleted_at IS NULL AND NEW.hidden_at IS NULL
      AND (latest_updated_at IS NULL OR COALESCE(NEW.updated_at, '') > latest_updated_at)
      THEN NEW.updated_at ELSE latest_updated_at END,
    rev = rev + 1
  WHERE kind = 'offices';
END;
DROP TRIGGER IF EXISTS trg_offices_stats_upd;
CREATE TRIGGER trg_offices_stats_upd AFTER UPDATE ON offices BEGIN
  UPDATE entity_stats SET
    live_count = live_count
      + (CASE WHEN NEW.deleted_at IS NULL AND NEW.hidden_at IS NULL THEN 1 ELSE 0 END)
      - (CASE WHEN OLD.deleted_at IS NULL AND OLD.hidden_at IS NULL THEN 1 ELSE 0 END),
    latest_updated_at = CASE WHEN NEW.deleted_at IS NULL AND NEW.hidden_at IS NULL
      AND (latest_updated_at IS NULL OR COALESCE(NEW.updated_at, '') > latest_updated_at)
      THEN NEW.updated_at ELSE latest_updated_at END,
    rev = rev + 1
  WHERE kind = 'offices';
END;
DROP TRIGGER IF EXISTS trg_offices_stats_del;
CREATE TRIGGER trg_offices_stats_del AFTER DELETE ON offices BEGIN
  UPDATE entity_stats SET
    live_count = live_count - (CASE WHEN OLD.deleted_at IS NULL AND OLD.hidden_at IS NULL THEN 1 ELSE 0 END),
    rev = rev + 1
  WHERE kind = 'offices';
END;

DROP TRIGGER IF EXISTS trg_products_stats_ins;
CREATE TRIGGER trg_products_stats_ins AFTER INSERT ON products BEGIN
  UPDATE entity_stats SET
    live_count = live_count + (CASE WHEN NEW.deleted_at IS NULL AND NEW.hidden_at IS NULL THEN 1 ELSE 0 END),
    latest_updated_at = CASE WHEN NEW.deleted_at IS NULL AND NEW.hidden_at IS NULL
      AND (latest_updated_at IS NULL OR COALESCE(NEW.updated_at, '') > latest_updated_at)
      THEN NEW.updated_at ELSE latest_updated_at END,
    rev = rev + 1
  WHERE kind = 'products';
END;
DROP TRIGGER IF EXISTS trg_products_stats_upd;
CREATE TRIGGER trg_products_stats_upd AFTER UPDATE ON products BEGIN
  UPDATE entity_stats SET
    live_count = live_count
      + (CASE WHEN NEW.deleted_at IS NULL AND NEW.hidden_at IS NULL THEN 1 ELSE 0 END)
      - (CASE WHEN OLD.deleted_at IS NULL AND OLD.hidden_at IS NULL THEN 1 ELSE 0 END),
    latest_updated_at = CASE WHEN NEW.deleted_at IS NULL AND NEW.hidden_at IS NULL
      AND (latest_updated_at IS NULL OR COALESCE(NEW.updated_at, '') > latest_updated_at)
      THEN NEW.updated_at ELSE latest_updated_at END,
    rev = rev + 1
  WHERE kind = 'products';
END;
DROP TRIGGER IF EXISTS trg_products_stats_del;
CREATE TRIGGER trg_products_stats_del AFTER DELETE ON products BEGIN
  UPDATE entity_stats SET
    live_count = live_count - (CASE WHEN OLD.deleted_at IS NULL AND OLD.hidden_at IS NULL THEN 1 ELSE 0 END),
    rev = rev + 1
  WHERE kind = 'products';
END;
