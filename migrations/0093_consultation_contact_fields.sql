-- Danışmanlık talebine iletişim bilgisi + opsiyonel not (kullanıcı isteği, 2026-09-05): Ödeme
-- Yöntemi'nden önce ad soyad/e-posta/telefon istenir, "Görüşme isteği hakkında" kutusu opsiyoneldir.
-- Kaan Çorbacı bu bilgilerle iletişime geçebilsin diye ayrı sütunlar (users tablosundaki hesap
-- bilgisiyle KARIŞTIRILMAZ — talebi yapan kişi hesabından farklı bir iletişim bilgisi girebilir).
ALTER TABLE consultation_requests ADD COLUMN contact_name TEXT;
ALTER TABLE consultation_requests ADD COLUMN contact_email TEXT;
ALTER TABLE consultation_requests ADD COLUMN contact_phone TEXT;
ALTER TABLE consultation_requests ADD COLUMN note TEXT;
