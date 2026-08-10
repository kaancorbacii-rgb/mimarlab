-- Bir yapı/proje/mimar/firma admin panelinden yeniden adlandırıldığında (bkz. src/lib/
-- officeFounderCascade.js#renameOfficeEverywhere/renameArchitectEverywhere, src/lib/
-- canonicalSync.js#syncProject) slug'ı da değişir (bkz. kullanıcı isteği: "ismi değişirse URL'si de
-- değişmeli"). Eski URL'lerin (paylaşılmış linkler, arama motoru indeksi) kırılmaması için eski
-- slug -> yeni slug eşlemesi burada tutulur, src/index.js#serveDetailPage bir slug'ı bulamadığında
-- bu tabloya bakıp 301 ile yeni adrese yönlendirir. Zincirlenme (A->B->C) oluşmasın diye rename
-- fonksiyonları, yeni bir yönlendirme eklerken eski hedefi (B) gösteren önceki kayıtları (A->B) da
-- doğrudan yeni hedefe (A->C) günceller — bkz. src/lib/slugRedirects.js#recordSlugRedirect.
CREATE TABLE IF NOT EXISTS slug_redirects (
  entity_type TEXT NOT NULL, -- 'projects' | 'architects' | 'offices'
  old_slug TEXT NOT NULL,
  new_slug TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (entity_type, old_slug)
);
