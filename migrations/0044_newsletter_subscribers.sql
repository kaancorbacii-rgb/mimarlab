-- Bülten aboneliği (bkz. kullanıcı isteği: "Sitede bültene abonel ol özelliği getirelim. Paylaşılan
-- her içerik kullanıcılara mail olarak gitsin"). Tek adımlı opt-in (çift onay YOK) — src/routes/
-- newsletter.js#handleNewsletterRoute POST /api/newsletter/subscribe ile satır ekler.
--
-- unsubscribe_token: e-postalardaki "Abonelikten çık" linkinin anahtarı (bkz. src/lib/
-- newsletterNotify.js) — her abone için rastgele/benzersiz, e-postanın kendisinden tahmin
-- edilemez olması için ayrı bir sütun (bkz. src/lib/crypto.js#randomToken).
--
-- unsubscribed_at: satırı SİLMEK yerine yumuşak işaretler — aynı e-posta tekrar abone olursa
-- (bkz. handleNewsletterRoute) satır geri açılır, UNIQUE(email) çakışması yaşanmaz.
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  unsubscribe_token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  unsubscribed_at INTEGER
);
