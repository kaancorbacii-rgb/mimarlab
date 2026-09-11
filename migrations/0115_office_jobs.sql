-- FİRMA/MARKA İŞ / STAJ İLANLARI (kullanıcı isteği, 2026-09-11: "Firma ve Marka popuplarında Geri
-- Bildirim butonlarının üstüne açılır kapanır 'İş / Staj İlanları' butonu ekle ... sadece firma
-- veya markanın yetkilendirdiği kullanıcıların görebileceği 'İlan Yayınla' butonu ... ilan başlığı
-- girsinler ve ilan görseli yüklesinler").
--
-- Onay kuyruğu YOK: ilanı yalnızca firmayı düzenleme yetkisi olanlar (admin, onaylı sahiplenme +
-- OFFICE_EDIT_POSITIONS, ya da Kurucular listesindeki onaylı kişi profili — bkz. src/routes/
-- officeJobs.js#canManageOffice) yayınlayabilir; künyeyi zaten doğrudan düzenleyebilen biri için
-- ikinci bir onay kapısı anlamsız olurdu.
--
-- image_url her zaman /media/u/<yükleyen>/... (kendi R2 yüklemesi) — dış URL kabul edilmez.
-- r2Reconcile.js bu kolonu referans kaynağı olarak tarar, yetim sayıp silmez.
CREATE TABLE IF NOT EXISTS office_jobs (
  id TEXT PRIMARY KEY,
  office_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  image_url TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_office_jobs_office ON office_jobs(office_id, created_at DESC);
