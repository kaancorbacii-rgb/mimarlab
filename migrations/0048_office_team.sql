-- office_submissions: yeni "Ekip" alanı (firma-ekle.html) — Kurucular ile aynı şekilde JSON
-- dizisi olarak saklanan, firmada çalışabilecek kişilerin serbest metin isim listesi (kurucu
-- değiller, opsiyonel bir alan; girilen isimler mimar profiliyle eşleşirse firma sayfasında
-- Ekip bölümünde görünür — bkz. src/routes/office.js#buildOfficePayload).
ALTER TABLE office_submissions ADD COLUMN team TEXT;
