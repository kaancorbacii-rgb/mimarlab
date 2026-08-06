-- Eksik performans indeksleri — architects/offices/office_founders/comments sütun adları
-- schema.sql (comments) ve migrations/0022_id_first_entities.sql (architects, offices,
-- office_founders) okunarak doğrulandı, tahmine dayalı sütun adı kullanılmadı.
--
-- saved_items(user_id) BİLEREK dahil edilmedi: schema.sql:228'de `idx_saved_user ON
-- saved_items(user_id)` zaten mevcut — ikinci bir indeks eklemek yalnızca yazma maliyetine
-- yol açardı, okuma performansına katkısı olmazdı.

CREATE INDEX IF NOT EXISTS idx_architects_name ON architects(name);
CREATE INDEX IF NOT EXISTS idx_offices_name ON offices(name);
-- office_founders'ın PRIMARY KEY (office_id, architect_id) bileşik indeksi architect_id'yi
-- soldan başlamadığı için "bu mimar hangi ofislerin kurucusu" sorgularında kullanılamaz.
CREATE INDEX IF NOT EXISTS idx_office_founders_architect ON office_founders(architect_id);
CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id);
