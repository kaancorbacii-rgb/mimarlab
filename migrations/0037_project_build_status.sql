-- Yapı (inşa edilmiş eser) / Proje (öğrenci, yarışma, fikir, konsept — inşa edilmemiş) ayrımı
-- (bkz. kullanıcı isteği: yapi.html sadece inşa edilmiş eserleri, proje.html yalnızca bu yeni
-- kategoriyi listesin). Canlıda halihazırda var olan TÜM satırlar inşa edilmiş yapılar olarak
-- sergileniyordu, bu yüzden varsayılan/geriye dönük değer 'built'.
ALTER TABLE projects ADD COLUMN build_status TEXT NOT NULL DEFAULT 'built';
ALTER TABLE project_submissions ADD COLUMN build_status TEXT NOT NULL DEFAULT 'built';
CREATE INDEX IF NOT EXISTS idx_projects_build_status ON projects(build_status);
