-- KULLANICI İSTEĞİ (2026-09-15 madde 2): "Proje sayfasındaki mimar filtresinde projelerin mimar
-- künyesinde yazan tüm isimler görülmeli. Bu sorunu düzelt."
--
-- KÖK NEDEN. /proje listesinin Mimar / Mimarlık Firması filtreleri (bkz. src/lib/projectPool.js#
-- buildFilterGroups) yalnızca `project_designers` join tablosundan gelen adları görüyordu. O tablo
-- ise şema gereği (CHECK ((architect_id IS NOT NULL) != (office_id IS NOT NULL))) YALNIZCA sitede
-- gerçekten bir kaydı olan mimar/firmalar için satır taşıyabiliyor: proje-ekle formunun Mimar/Firma
-- kutusuna yazılan ama architects/offices'te karşılığı olmayan her isim (bkz. src/lib/canonicalSync.js
-- #syncProject — resolveArchitectLink/resolveOfficeLink eşleşme bulamazsa sessizce atlar) filtreye
-- HİÇ düşmüyordu. Proje pop-up'ının künyesi bu isimleri zaten gösteriyordu (src/routes/project.js#
-- fetchRawDesignerNames onları project_submissions satırından geri okuyor), yani liste ile künye
-- birbiriyle çelişiyordu.
--
-- ÇÖZÜM. Künyeye YAZILDIĞI HÂLİYLE ad listesi canonical satırın kendisinde de dursun: iki yeni JSON
-- dizi kolonu. Bu, products.brand_name_raw'ın (eşleşmeyen marka adı için fallback) proje karşılığıdır
-- — aynı sorun, aynı desen. syncProject bundan sonra her künye yazımında ikisini birlikte tazeler
-- (bkz. o dosyadaki project_designers batch'i), okuma tarafı (shapeProjectItem) eşleşen adlarla
-- birleştirip tekilleştirir. project_designers DEĞİŞMEDİ: profil bağlantısı/çipler hâlâ oradan gelir,
-- bu kolonlar yalnızca "künyede ne yazıyordu" sorusunun cevabıdır.
--
-- BU MIGRATION KOD DEPLOY'UNDAN ÖNCE UYGULANMALIDIR: liste/havuz sorguları kolonları açıkça
-- SELECT ediyor, kolon yokken /api/projects ve /api/projects/filters hata verir.
ALTER TABLE projects ADD COLUMN designer_names_raw TEXT;
ALTER TABLE projects ADD COLUMN office_names_raw TEXT;

-- GERİ DOLUM — mevcut satırlar için kaynak, künyeyi oluşturan/son düzenleyen gönderi satırıdır.
-- Eşleştirme src/routes/project.js#fetchRawDesignerNames ile BİREBİR AYNI iki yoldan yapılır
-- (claimed_slug = slug YA DA legacy_key = 'submission:<id>'), en son güncellenen satır kazanır —
-- syncProject her düzenlemede künyeyi baştan yazdığından doğru olan odur.
-- project_submissions.designer / .office zaten JSON dizidir, olduğu gibi kopyalanır.
-- Gönderi satırı olmayan (legacy_static içe aktarım) projelerde kolonlar NULL kalır; okuma tarafı
-- o durumda eskisi gibi yalnızca eşleşen adları gösterir — davranış değişmez.
UPDATE projects
   SET designer_names_raw = (
         SELECT ps.designer FROM project_submissions ps
          WHERE ps.claimed_slug = projects.slug
             OR ('submission:' || ps.id) = projects.legacy_key
          ORDER BY ps.updated_at DESC LIMIT 1),
       office_names_raw = (
         SELECT ps.office FROM project_submissions ps
          WHERE ps.claimed_slug = projects.slug
             OR ('submission:' || ps.id) = projects.legacy_key
          ORDER BY ps.updated_at DESC LIMIT 1)
 WHERE deleted_at IS NULL;
