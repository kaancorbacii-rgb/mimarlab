-- Proje ekle/düzenle sayfasındaki opsiyonel harita konumu (bkz. kullanıcı isteği: "Konum
-- başlığının altındaki il/ilçe kutucuklarının altına bir Google Maps haritası koy, projenin
-- konumu bu haritadan işaretlenebilsin"). Google Maps JS API key/billing gerektirmediğinden
-- (bkz. mevcut ücretsiz maps.google.com iframe embed deseni, worker secret listesinde hiç
-- Maps key'i yok) istemci tarafında Leaflet + OpenStreetMap kullanılıyor; bu iki kolon yalnızca
-- kullanıcının haritada işaretlediği ondalık enlem/boylamı saklar. İkisi de opsiyonel — il/ilçe
-- seçimi tek başına yeterli, harita işaretlemesi zorunlu değil.
ALTER TABLE project_submissions ADD COLUMN lat REAL;
ALTER TABLE project_submissions ADD COLUMN lng REAL;
ALTER TABLE projects ADD COLUMN lat REAL;
ALTER TABLE projects ADD COLUMN lng REAL;
