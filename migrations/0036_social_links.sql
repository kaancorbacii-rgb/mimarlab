-- Mimar/danışman (architects) ve firma (offices) profillerine birden fazla sosyal medya bağlantısı
-- eklenebilsin diye (bkz. kullanıcı isteği: "sosyal medya kutusunun yanına ekle butonu koy") —
-- awards ile AYNI JSON dizi deseni: [{"platform":"instagram","url":"https://..."}, ...].
-- Hem canonical tablolara hem de bekleyen düzenlemelerin geçtiği *_submissions tablolarına eklenir
-- (bkz. src/lib/canonicalSync.js#syncArchitect/syncOffice — submission alanları canonical satıra
-- kopyalanırken bu alan da kopyalanmalı).
ALTER TABLE architects ADD COLUMN social_links TEXT;
ALTER TABLE offices ADD COLUMN social_links TEXT;
ALTER TABLE architect_submissions ADD COLUMN social_links TEXT;
ALTER TABLE office_submissions ADD COLUMN social_links TEXT;
