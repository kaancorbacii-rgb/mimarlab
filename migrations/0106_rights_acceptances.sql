-- Telif ve Sorumluluk Beyanı onay kaydı (kullanıcı isteği, 2026-09-10 madde 1 ve 3).
--
-- NEDEN AYRI BİR TABLO (beş *_submissions tablosuna kolon eklemek yerine): beyan hukuki bir
-- taahhüttür, "en son hâli" değil GEÇMİŞİ tutulmalı — aynı içerik yıllar içinde birden çok kez
-- (farklı kullanıcılar tarafından, farklı metin sürümleriyle) yayınlanabilir ve hangi onayın hangi
-- yayına dayandığı sonradan sorulabilir. Ayrıca arşivden yayına alma akışında (bkz.
-- src/routes/archive.js) onay, HENÜZ bir gönderi satırı bulunmayan canonical kayıtlar için de
-- verilebiliyor; kolon yaklaşımı bu durumu hiç karşılayamazdı.
--
-- content_type: 'projects' | 'architects' | 'offices' | 'products' | 'materials'
-- content_key : canonical doğal anahtar (proje slug'ı / kişi-firma adı / ürün legacy_key'i) — bir
--               gönderi satırına bağlı olmayan onaylarda TEK kimliktir.
-- submission_id: varsa ilgili *_submissions satırı (silinirse kayıt kalır, FK YOK — denetim izi
--               gönderi satırından daha uzun ömürlü olmalı).
-- text_version: onaylanan metnin sürümü (bkz. js/components/rights-consent.js#TEXT_VERSION ve
--               src/lib/rightsConsent.js#RIGHTS_TEXT_VERSION).
CREATE TABLE IF NOT EXISTS rights_acceptances (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  content_type TEXT NOT NULL,
  content_key TEXT,
  submission_id TEXT,
  text_version TEXT NOT NULL,
  source TEXT NOT NULL, -- 'submit' (ekleme/düzenleme formu) | 'archive-publish' (Arşivim > Yayına Al)
  accepted_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rights_acceptances_user ON rights_acceptances(user_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS idx_rights_acceptances_content ON rights_acceptances(content_type, content_key);
CREATE INDEX IF NOT EXISTS idx_rights_acceptances_submission ON rights_acceptances(submission_id);
