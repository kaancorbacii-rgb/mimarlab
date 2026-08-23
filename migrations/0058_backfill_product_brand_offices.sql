-- Kullanıcı isteği: "Siteye eklenen yeni ürün firmaları için firma profilleri aç ve gerekli
-- bilgileri ve logoyu ekle." — canlı D1'de products.brand_office_id IS NULL AND brand_name_raw
-- IS NOT NULL olan 20 farklı marka bulundu (2026-08-23). Bunların 16'sı offices tablosunda ZATEN
-- tam bir profille (logo/about/loc) mevcuttu, sadece products.brand_office_id linki hiç
-- kurulmamıştı (veri bağlama eksikliği, profil eksikliği değil). Gerçekten offices'ta hiç kaydı
-- olmayan 4 marka (Ersa Mobilya, B&T Design, Bürotime, Hamm Design — hepsi source='admin' ile
-- eklenmiş ürünlerin markası) için yeni offices satırı açıldı; about/loc/yil/website resmi
-- kurumsal kaynaklardan (şirketlerin kendi "hakkımızda" sayfaları) araştırılıp yazıldı, logo
-- resmi sitelerinden indirilip webp'e çevrilip R2'ye (mimarlab-uploads) yüklendi.
--
-- İdempotent: her UPDATE zaten brand_office_id IS NULL şartını taşır (daha önce uygulanmışsa
-- tekrar çalıştırılması hiçbir satırı etkilemez), her INSERT slug üzerinden NOT EXISTS ile korunur.

-- 1) Mevcut ama bağlanmamış 16 marka — isim tam eşleşmesiyle brand_office_id backfill.
UPDATE products SET brand_office_id = (SELECT id FROM offices WHERE offices.name = products.brand_name_raw)
WHERE brand_office_id IS NULL AND brand_name_raw IN (
  'Lazzoni','Nurus','Koleksiyon','VitrA','Şişecam','Tuna Office','Fibrobeton','Normod',
  'Kaleseramik','NG Kütahya Seramik','Autoban','İstikbal','Marshall','Kastamonu Entegre',
  'Kalebodur','Bellona'
);

-- 2) Offices'ta hiç kaydı olmayan 4 gerçek yeni firma.
INSERT INTO offices (slug, name, loc, cats, yil, website, about, logo_url, source)
SELECT 'ersa-mobilya', 'Ersa Mobilya', 'Ankara', '["Ürün"]', '1958', 'https://www.ersamobilya.com',
  'Ersa, 1958 yılında Metin Atabey Ata tarafından kurulan, bugün ailenin 3. kuşağının yönetiminde yer aldığı köklü bir Türk ofis mobilyası markasıdır. 2014''ten bu yana dünyanın önde gelen ofis mobilyası markalarından Haworth''ün Türkiye''deki tek yetkili satıcısı olan Ersa, Red Dot ve Good Design gibi 50''nin üzerinde ulusal/uluslararası ödüle sahiptir. Ankara''daki üretim tesisinde kurumsal ofis, otel ve kamusal alan projeleri için tasarım mobilyalar üretir.',
  '/media/u/admin-backfill/1fb87e07-c862-480b-8e0b-7707cadff494.webp', 'admin'
WHERE NOT EXISTS (SELECT 1 FROM offices WHERE slug = 'ersa-mobilya');

INSERT INTO offices (slug, name, loc, cats, yil, website, about, logo_url, source)
SELECT 'b-t-design', 'B&T Design', 'İstanbul', '["Ürün"]', '1995', 'https://bt.design',
  'B&T Design, 1995 yılından bu yana çalışma, toplantı, yönetici, bekleme ve misafir koltukları başta olmak üzere ofis mobilyaları üreten bir Türk markasıdır. İstanbul ve Ankara''daki showroomlarıyla ofis, otel ve hastane gibi farklı sektörlere yönelik koltuk, masa ve saklama sistemleri sunar. Türkiye''nin önde gelen tasarımcılarıyla çalışarak estetik ve işlevselliği bir araya getiren ürünler geliştirir.',
  '/media/u/admin-backfill/9855297e-030b-4348-b431-3af2577aa546.webp', 'admin'
WHERE NOT EXISTS (SELECT 1 FROM offices WHERE slug = 'b-t-design');

INSERT INTO offices (slug, name, loc, cats, yil, website, about, logo_url, source)
SELECT 'burotime', 'Bürotime', 'Konya', '["Ürün"]', '1997', 'https://www.burotime.com',
  '1997 yılında Konya Organize Sanayi Bölgesi''nde, Tosunoğulları A.Ş.''nin 1980''lere uzanan tecrübesiyle kurulan Bürotime, Türkiye''nin en büyük ofis mobilyası üreticisidir. Fonksiyonel tasarımları ve modüler ofis mobilyası çözümleriyle tanınan firma, ürünlerini dünya çapında ihraç etmektedir.',
  '/media/u/admin-backfill/5a861832-3583-4785-a9e0-f258ebb198c7.webp', 'admin'
WHERE NOT EXISTS (SELECT 1 FROM offices WHERE slug = 'burotime');

INSERT INTO offices (slug, name, loc, cats, yil, website, about, logo_url, source)
SELECT 'hamm-design', 'Hamm Design', 'İstanbul', '["Ürün"]', '2010', 'https://www.hamm.com.tr',
  '2010 yılında kurulan Hamm Design, doğal ve kaliteli malzemeler kullanarak özgün mobilya, aydınlatma ve aksesuar tasarımları üreten bir stüdyodur. Ekibinde mimarlık, iç mimarlık ve ürün tasarımı disiplinlerinden gelen isimler yer alır; mimarlık ofislerine ve kurumsal projelere yönelik "Hamm Plus" hizmetiyle mekân çözümleri de sunar. İstanbul''da Şişli ve Kadıköy''deki showroomlarıyla hizmet vermektedir.',
  '/media/u/admin-backfill/7dba0d28-5ad7-4fa6-978b-90b252fb138f.webp', 'admin'
WHERE NOT EXISTS (SELECT 1 FROM offices WHERE slug = 'hamm-design');

-- 3) Yeni açılan 4 firmayı da ürünlerine bağla.
UPDATE products SET brand_office_id = (SELECT id FROM offices WHERE offices.name = products.brand_name_raw)
WHERE brand_office_id IS NULL AND brand_name_raw IN ('Ersa Mobilya','B&T Design','Bürotime','Hamm Design');
