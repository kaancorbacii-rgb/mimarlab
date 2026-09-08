-- Kişi profili — PORTFOLYO (kullanıcı isteği, 2026-09-08): "Kişi ekle/düzenle sayfasında Profil
-- Fotoğrafı bölümünün altına Portfolyo kutusu ekle. Buraya görsel ya da pdf yüklenecek.
-- Görsellerin ya da pdf sayfalarının sırası değiştirilebilsin."
--
-- projects.images / products.images İLE AYNI desen: sıralı bir JSON dizisi, elemanları düz
-- /media/... URL'leri (bkz. src/lib/canonicalRead.js#JSON_FIELDS ve src/lib/submissionTypes.js#
-- arrayFields|urlArrayFields). Ayrı bir tablo AÇILMADI — kişi başına en fazla 30 öğe tutulur, her
-- öğe yalnızca bir URL'dir ve tek okuma yolu (kişi pop-up'ı) satırı zaten bütün olarak çekiyor.
--
-- PDF: yüklenen PDF'in HER SAYFASI tarayıcıda (js/vendor/pdfjs, bkz. image-upload.js dosya başındaki
-- "türevleri TARAYICI üretir" gerekçesi) bir WebP görsele çevrilip AYRI bir öğe olarak yazılır — bu
-- yüzden bu kolon PDF saklamaz, yalnızca görsel URL'leri taşır. Böylece pop-up tarafı hiçbir PDF
-- çalışma zamanı yüklemez ve sıralama/lightbox görsellerle PDF sayfaları arasında ayrım yapmaz.
--
-- İki tablo birden: canonical satır (architects) + gönderi taslağı (architect_submissions) — biri
-- eksik kalırsa portfolyo ya onaydan geçemez ya da onaylandıktan sonra profilde görünmez.
ALTER TABLE architects ADD COLUMN portfolio TEXT;
ALTER TABLE architect_submissions ADD COLUMN portfolio TEXT;
