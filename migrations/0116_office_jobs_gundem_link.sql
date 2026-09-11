-- İŞ / STAJ İLANI -> GÜNDEM (kullanıcı isteği, 2026-09-12: "Firma ve marka popuplarında yayınlanan
-- ilanlar [Gündem'deki İş ve Staj İlanları'nda] da yayınlansın").
--
-- Popup'tan yayınlanan her ilan ayrıca gundem_items'a category='ilan', status='published' bir satır
-- olarak yazılır (src/routes/officeJobs.js#createJob) — Gündem listesi, kartı, /gundem/:slug sayfası
-- ve firmanın Gündem şeridi (gundem_entities) HİÇBİR değişiklik olmadan onu gösterir. Bu kolon o
-- satırın id'sidir: ilan popup'tan kaldırılınca Gündem kopyası da silinir.
ALTER TABLE office_jobs ADD COLUMN gundem_item_id TEXT;
