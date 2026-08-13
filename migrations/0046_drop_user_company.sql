-- Reverts migrations/0045_user_company.sql — that free self-tag "hangi firmada çalışıyorsun" field
-- was replaced (same session, before any real user data existed in it) by routing the "Profili
-- Düzenle" Firma seçimi through the existing profile_claims (office) request/admin-approval flow
-- instead, so the column is dropped rather than left unused.

ALTER TABLE users DROP COLUMN company;
