-- Mimar/Firma/Danışman profillerine tek bir sosyal medya bağlantısı (bkz. kullanıcı isteği: ekle/
-- düzenle sayfalarındaki Kişisel Bilgiler kutusunun en altına platform seçimi + link kutusu).
-- Danışman ayrı bir tablo değil (bkz. migrations/0031_architect_consultant.sql), architects
-- satırına eklenen kolonlar mimar-ekle.html/danisman-ekle.html'in ikisini de kapsar.
ALTER TABLE architects ADD COLUMN social_platform TEXT;
ALTER TABLE architects ADD COLUMN social_url TEXT;
ALTER TABLE offices ADD COLUMN social_platform TEXT;
ALTER TABLE offices ADD COLUMN social_url TEXT;
ALTER TABLE architect_submissions ADD COLUMN social_platform TEXT;
ALTER TABLE architect_submissions ADD COLUMN social_url TEXT;
ALTER TABLE office_submissions ADD COLUMN social_platform TEXT;
ALTER TABLE office_submissions ADD COLUMN social_url TEXT;
