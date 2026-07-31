-- Additive migration for the live D1 database (no migrations runner exists yet,
-- so this is applied by hand with `wrangler d1 execute --file`). Matches the
-- schema.sql change: users.position, so the account edit screen can capture the
-- same "Kurucu/Çalışan/Akademisyen/Freelance/Öğrenci/Emekli/İş Arıyor" position
-- concept already used in mimar-ekle.html, alongside the existing profession field.

ALTER TABLE users ADD COLUMN position TEXT;
