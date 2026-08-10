-- Görüşme Ayarla ödeme ekranında telefon numarası zorunlu hale getirildi (bkz. kullanıcı isteği:
-- satın alım yaparken kişiden telefon numarası istensin, hem danışmana hem admine iletilsin) —
-- src/routes/consultantBookings.js#handleConsultantBookingsRoute artık phone alanını zorunlu
-- okuyup burada saklıyor.
ALTER TABLE consultation_requests ADD COLUMN phone TEXT;
