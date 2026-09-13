-- DANIŞMANLIK ÖDEMESİ — ÖDEME SEÇENEKLERİ GERİ GETİRİLDİ (kullanıcı isteği, 2026-09-13:
-- "Danışmanlık Al ekranı için ödeme seçeneklerini geri getir"). 2026-09-08'de ("şimdilik ödeme
-- almıyoruz; IBAN bilgilerini siteden sil") yalnızca ARAYÜZ kaldırılmıştı; tablo zaten price_try
-- ve payment_provider taşıyordu. Eksik olan, ödemenin DURUMUNU ve iyzico referanslarını tutacak
-- kolonlardı — badge_requests'in 0009_payment_fields.sql ile aldığı AYNI alanların danışmanlık
-- karşılığı (bkz. src/routes/payments.js, iki tablo AYNI callback'i paylaşır).
--
-- payment_status sözleşmesi (tek gerçek kaynak src/routes/consultations.js#PAYMENT_STATUS):
--   NULL        -> talep açıldı, kullanıcı henüz bir ödeme yöntemi seçmedi
--   'pending'   -> iyzico hosted sayfasına yönlendirildi, sonuç henüz dönmedi
--   'declared'  -> kullanıcı havale/EFT için "Ödemeyi Yaptım" dedi (BEYAN, doğrulanmadı —
--                  admin banka ekstresinden doğrulayıp talebi onaylar)
--   'paid'      -> iyzico sunucu-sunucu doğrulaması başarılı (TEK otomatik doğrulanmış durum)
--   'failed'    -> iyzico ödemesi başarısız/iptal
--
-- DİKKAT: payment_status 'paid' olmak talebin status'unu OTOMATİK 'approved' YAPMAZ. Google Meet
-- odası yalnızca admin onayında kurulur (bkz. src/lib/consultationMeet.js dosya başı akışı) —
-- ödeme doğrulaması o kapının YERİNE geçmez, önüne eklenir.
ALTER TABLE consultation_requests ADD COLUMN payment_status TEXT;
ALTER TABLE consultation_requests ADD COLUMN payment_token TEXT;
ALTER TABLE consultation_requests ADD COLUMN payment_id TEXT;
ALTER TABLE consultation_requests ADD COLUMN paid_at INTEGER;
