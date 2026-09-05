-- Danışmanlık randevusu tarih değiştirme limiti (kullanıcı isteği, 2026-09-06): "Görüşme Tarihini
-- Değiştir" yalnızca BİR kez kullanılabilsin. src/routes/consultations.js#updateConsultationRequest
-- bu kolon true ise PATCH'i reddeder, başarılı ilk değişiklikte 1 yapar.
ALTER TABLE consultation_requests ADD COLUMN has_rescheduled INTEGER NOT NULL DEFAULT 0;
