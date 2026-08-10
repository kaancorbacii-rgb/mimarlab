-- proje.html "Kategori" filtresi (bkz. kullanıcı isteği: "Proje sayfasındaki filtrelere Kategori
-- filtresi aç ve altına öğrenci, yarışma, fikir, konsept seçeneklerini ekle") — build_status
-- (migrations/0037) yalnızca 'built' / 'concept' ikili ayrımını taşıyor, konsept projelerin
-- kendi içindeki alt tür (öğrenci/yarışma/fikir/konsept) hiç kayıtlı değildi. NULLable: mevcut
-- TÜM konsept projeler bu migration'dan sonra kategorisiz kalır (kullanıcı isteğiyle geriye dönük
-- etiketleme sonraya bırakıldı), yalnızca yeni/düzenlenen gönderilerde doldurulur.
ALTER TABLE projects ADD COLUMN concept_category TEXT;
ALTER TABLE project_submissions ADD COLUMN conceptCategory TEXT;
