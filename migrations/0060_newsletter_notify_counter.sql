-- Bülten bildirimlerini "5 gönderiden 1'i" olacak şekilde kısar (bkz. kullanıcı isteği,
-- src/lib/newsletterNotify.js). rate_limits(key, count, ...)#checkRateLimit ile AYNI atomik
-- INSERT...ON CONFLICT DO UPDATE...RETURNING deseni — pencere/expires_at semantiği YOK, sayaç
-- hiç sıfırlanmadan sürekli artar, yalnızca mod 5 == 0 olduğunda gerçek bir mail gönderilir.
CREATE TABLE IF NOT EXISTS newsletter_notify_counter (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);
