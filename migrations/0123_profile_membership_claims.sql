-- KİŞİ ↔ FİRMA ÜYELİK TALEPLERİ — ONAY KUYRUĞU (kullanıcı isteği, 2026-09-16 yedinci tur madde 5/6)
--
-- madde 5: "Bir kullanıcı bir firmaya bir kişiyi eklemek istediği zaman eğer ekleyeceği kişi zaten
--   başka bir firmada gözüküyorsa, o firmanın yöneticisine ve admine bildirim gitsin ve yönetici ya
--   da admin o bildirimi onaylarsa kişi firmaya da dahil olsun ... Firma profili yayınlansın ama
--   onay gelene kadar kişi kısmı boş kalsın."
-- madde 6: "Bir kullanıcı bir kişiye bir firma eklemek istediği zaman eğer ekleyeceği firmanın
--   zaten bir yöneticisi varsa, o firmanın yöneticisine ve admine bildirim gitsin ... Kişi profili
--   yayınlansın ama onay gelene kadar firma kısmı boş kalsın."
--
-- Bu tablo, src/routes/hotspotTags.js ve src/routes/photoClaims.js kuyruklarının KARDEŞİDİR: aynı
-- durum sözlüğü ('pending'/'approved'/'rejected'), aynı "karar kümesi = bildirim kümesi" kuralı,
-- aynı <tip>:<id> bildirim → pop-up bağlantısı. Ayrı bir tablo olmasının gerekçesi: talebin konusu
-- bir künye METNİ değil bir YAPISAL BAĞ (office_founders) ve karar verenler her iki yönde de
-- BELİRLİ BİR FİRMANIN yöneticileridir (decider_office_name).
CREATE TABLE IF NOT EXISTS profile_membership_claims (
  id TEXT PRIMARY KEY,
  -- Kurulacak bağ: bu kişi ↔ bu firma.
  office_id INTEGER NOT NULL,
  office_name TEXT NOT NULL,
  architect_id INTEGER NOT NULL,
  architect_name TEXT NOT NULL,
  -- Talep hangi formdan doğdu: 'office' (firma-ekle/düzenle, madde 5) | 'architect' (kişi-ekle/
  -- düzenle, madde 6). Onayda adın geri yazılacağı yeri bu belirler.
  source TEXT NOT NULL CHECK (source IN ('office', 'architect')),
  -- Onayda adın geri yazılacağı TASLAK (bkz. membershipClaims.js#applyMembershipClaim): canonical
  -- kayda yazmak TEK BAŞINA yetmez, canonicalSync künyeyi taslaktan BAŞTAN yazdığı için bir sonraki
  -- kaydetmede sessiz veri kaybı olurdu (hotspotTags/photoClaims'teki AYNI tuzak).
  submission_type TEXT NOT NULL CHECK (submission_type IN ('offices', 'architects')),
  submission_id TEXT,
  -- Yalnızca source='office': ad firma künyesinin hangi kutusundan geldi — 'founders' | 'team'.
  -- Firma pop-up'ında Kurucular/Ortaklar ile Ekip ayrımını bu kutular belirler (bkz.
  -- src/routes/office.js#buildOfficePeople), yani onayda ad DOĞRU kutuya dönmelidir.
  slot TEXT,
  -- Yöneticileri KARAR VEREN firma: madde 5'te kişinin ZATEN göründüğü DİĞER firma, madde 6'da
  -- eklenmek istenen firmanın kendisi. Tek kolon olması, canDecide'ın tek kurala inmesini sağlar.
  decider_office_name TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by_user_id TEXT REFERENCES users(id),
  decided_at INTEGER,
  created_at INTEGER NOT NULL
);
-- Aynı kullanıcı aynı bağ için birden fazla BEKLEYEN talep açamaz (kısmi indeks — karara bağlanmış
-- satırlar denetim izi olarak kalır ve yeni bir talebi engellemez).
CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_claims_pending
  ON profile_membership_claims (office_id, architect_id, requested_by_user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_membership_claims_status
  ON profile_membership_claims (status, created_at DESC);
