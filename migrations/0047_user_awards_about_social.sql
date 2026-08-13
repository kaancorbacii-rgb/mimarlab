-- Additive migration for the live D1 database (no migrations runner exists yet,
-- so this is applied by hand with `wrangler d1 execute --file`). Matches the
-- schema.sql change: users.awards/about/social_links — bkz. kullanıcı isteği:
-- "Mimar profiliyle henüz eşleşmemiş kullanıcılar da ödül, sosyal medya ve
-- açıklama ekleyebilsinler" — bu alanların artık her kullanıcının hesap
-- profilinde (architects tablosundan bağımsız) bir yuvası var; onaylı bir
-- mimar profili sahiplenildiğinde AYRICA architect_submissions/architects
-- kaydına da senkronize yazılır (bkz. js/components/auth-modal.js).
-- awards/social_links, architects.awards/social_links ile AYNI kalıpla JSON
-- dizi metni olarak saklanır (bkz. migrations/0022_id_first_entities.sql,
-- migrations/0036_social_links.sql).

ALTER TABLE users ADD COLUMN awards TEXT;
ALTER TABLE users ADD COLUMN about TEXT;
ALTER TABLE users ADD COLUMN social_links TEXT;
