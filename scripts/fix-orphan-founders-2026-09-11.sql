-- KURUCU ↔ FİRMA BAĞI HİÇ KURULMAMIŞ KİŞİLER (kullanıcı bildirimi, 2026-09-11: "neden Tago
-- Architects'in popupında kurucusu Gökhan Aktan Altuğ'un profili ve Gökhan Aktan Altuğ'un profilinde
-- de Tago Architects gözükmüyor? ... diğer kurucu, ortaklarda da ve firmalarda da böyle bir sorun
-- varsa çöz.")
--
-- KÖK: toplu içe aktarımda bu kişilerle firmaları arasında firma↔kişi bağının DÖRT yerinden hiçbiri
-- kurulmamıştı (office_founders, architects.office_id, office_submissions.founders metni,
-- architect_submissions.office metni) — ikisi yalnızca aynı projelerin künyesinde yan yana duruyordu.
--
-- SEÇİM (canlı D1 taraması): hiçbir firmaya bağı OLMAYAN kişi × firma çiftleri; firmanın "Hakkında"
-- metni kişiyi kurucu/yönetici olarak ADIYLA anıyor (Gökhan Aktan Altuğ ayrıca 3/3 projede aynı
-- firmayla). Metinde adı geçmeyen proje ortaklıkları (DB Architects/TeCe–Ozan Özdilek, EPA üçlüsü,
-- Kazmaoğlu–Onur Dayıoğlu, Tabanlıoğlu/EAA tarihî adlar) BİLEREK bağlanmadı — bir projede birlikte
-- çalışmak kurucu olmak demek değil.
--
-- DÖRT YERİN HEPSİ yazılır: yalnızca office_founders yazılsaydı kişi formu kaydedildiğinde
-- canonicalSync#syncOfficeFounderLink (Firma metninde OLMAYAN bağı siler) bağı geri silebilirdi.
-- updated_at artırılır: liste fingerprint'i COUNT+MAX(updated_at) (bkz. proje notu, AAW/merzigo).

INSERT OR IGNORE INTO office_founders (office_id, architect_id) VALUES
  (665, 700),  -- Tago Architects ← Gökhan Aktan Altuğ
  (665, 701),  -- Tago Architects ← Tatsuya Yamamoto
  (583, 444),  -- 2x1 Architects ← Hakan Evkaya
  (583, 443),  -- 2x1 Architects ← Kutlu İnanç Bal
  (696, 982),  -- Ko-Arch ← Evren Öztürk
  (661, 843),  -- Roni S. Ruso Mimarlık ← Roni Ruso
  (592, 922);  -- Aslihan Demirtas Architecture, Design & Research Studio | KHORA ← Aslıhan Demirtaş

UPDATE architects SET office_id = 665, updated_at = datetime('now') WHERE id IN (700, 701) AND office_id IS NULL;
UPDATE architects SET office_id = 583, updated_at = datetime('now') WHERE id IN (443, 444) AND office_id IS NULL;
UPDATE architects SET office_id = 696, updated_at = datetime('now') WHERE id = 982 AND office_id IS NULL;
UPDATE architects SET office_id = 661, updated_at = datetime('now') WHERE id = 843 AND office_id IS NULL;
UPDATE architects SET office_id = 592, updated_at = datetime('now') WHERE id = 922 AND office_id IS NULL;

UPDATE office_submissions SET founders = '["Gökhan Aktan Altuğ","Tatsuya Yamamoto"]' WHERE claimed_profile_key = 'Tago Architects' AND (founders IS NULL OR founders = '[]');
UPDATE office_submissions SET founders = '["Hakan Evkaya","Kutlu İnanç Bal"]' WHERE claimed_profile_key = '2x1 Architects' AND (founders IS NULL OR founders = '[]');
UPDATE office_submissions SET founders = '["Evren Öztürk"]' WHERE claimed_profile_key = 'Ko-Arch' AND (founders IS NULL OR founders = '[]');
UPDATE office_submissions SET founders = '["Roni Ruso"]' WHERE claimed_profile_key = 'Roni S. Ruso Mimarlık' AND (founders IS NULL OR founders = '[]');
UPDATE office_submissions SET founders = '["Aslıhan Demirtaş"]' WHERE claimed_profile_key = 'Aslihan Demirtas Architecture, Design & Research Studio | KHORA' AND (founders IS NULL OR founders = '[]');

UPDATE architect_submissions SET office = 'Tago Architects' WHERE claimed_profile_key IN ('Gökhan Aktan Altuğ', 'Tatsuya Yamamoto') AND (office IS NULL OR office = '');
UPDATE architect_submissions SET office = '2x1 Architects' WHERE claimed_profile_key IN ('Hakan Evkaya', 'Kutlu İnanç Bal') AND (office IS NULL OR office = '');
UPDATE architect_submissions SET office = 'Ko-Arch' WHERE claimed_profile_key = 'Evren Öztürk' AND (office IS NULL OR office = '');
UPDATE architect_submissions SET office = 'Roni S. Ruso Mimarlık' WHERE claimed_profile_key = 'Roni Ruso' AND (office IS NULL OR office = '');
UPDATE architect_submissions SET office = 'Aslihan Demirtas Architecture, Design & Research Studio | KHORA' WHERE claimed_profile_key = 'Aslıhan Demirtaş' AND (office IS NULL OR office = '');

UPDATE offices SET updated_at = datetime('now') WHERE id IN (665, 583, 696, 661, 592);
