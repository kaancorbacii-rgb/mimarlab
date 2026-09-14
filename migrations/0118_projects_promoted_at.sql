-- Additive migration (bkz. migrations/0111'deki AYNI not: d1_migrations tablosu 0014'te takılı
-- kaldığından 'wrangler d1 migrations apply' yerine 'wrangler d1 execute --file' ile uygulanır;
-- uzak/telefon oturumundan .github/workflows/migrate.yml ile).
--
-- KULLANICI İSTEĞİ (2026-09-14): "Bir firmaya daha önce bir yönetici atanmışsa ve yönetici atanınca
-- son eklenen projeleri proje sayfasında ilk sıraya oturmuşsa, ya da admin tarafından firmanın
-- bluru kaldırılıp yayına alındıysa, firmaya tekrar yeni bir yönetici atanınca firmanın son
-- projesini tekrar proje sayfasında 1. sıraya koymana gerek yok."
--
-- SORUN: src/routes/admin.js#promoteOfficeProjectsOnAssignment (bkz. migrations/0108 + 0111'in
-- sıralama sözleşmesi) atamanın HER seferinde firmanın en son yayınlanan projesini relisted_at=now
-- + display_order=NULL ile proje sayfasının 1. sırasına taşıyordu. Kural "bir profil ilk kez
-- görünürlük kazandığında öne çıksın" diye yazılmıştı, ama tetikleyicisi (atama / admin'in blur
-- kaldırması) TEKRARLANABİLİR: aynı firmaya ikinci bir yönetici eklemek ya da bir claim'i yeniden
-- onaylamak, AYLAR ÖNCE yayınlanmış bir projeyi tekrar 1. sıraya oturtup gerçekten yeni içeriği
-- aşağı itiyordu.
--
-- ÇÖZÜM: promosyon artık PROFİL BAŞINA BİR KEREliktir. projects_promoted_at, o profilin projeleri
-- 1. sıraya İLK KEZ taşındığı anı tutar; dolu olan bir profil için promosyon bir daha çalışmaz.
-- Damga İKİ tetikleyicide de düşer (ikisi de activateProfileGraph'tan geçer): admin ataması
-- (POST/PATCH /api/admin/claims) ve admin'in blur kaldırıp yayına alması (activateProfilesOnPublish).
ALTER TABLE offices ADD COLUMN projects_promoted_at TEXT;
ALTER TABLE architects ADD COLUMN projects_promoted_at TEXT;

-- GERİYE DÖNÜK DOLDURMA: bu migration'dan ÖNCE atanmış profiller promosyonlarını zaten aldı —
-- damgasız bırakılırlarsa kuralın engellemek istediği ŞEY (mevcut bir firmaya ikinci bir yönetici
-- eklemek) tam olarak bir kez daha olurdu. profile_claims.profile_key kanonik `name` tutar
-- (bkz. src/routes/admin.js#handleClaimsAdmin -> resolveCanonicalName), yani ada göre eşleşir.
-- Zaman damgası olarak bu migration'ın tarihi kullanılır: gerçek promosyon anı kayıtlı değil ve
-- kolon yalnızca "damgalı mı" diye okunuyor (bkz. profilesPromotedBefore).
UPDATE offices SET projects_promoted_at = '2026-09-14T00:00:00.000Z'
 WHERE projects_promoted_at IS NULL
   AND name IN (SELECT profile_key FROM profile_claims WHERE profile_type = 'office' AND status = 'approved');
UPDATE architects SET projects_promoted_at = '2026-09-14T00:00:00.000Z'
 WHERE projects_promoted_at IS NULL
   AND name IN (SELECT profile_key FROM profile_claims WHERE profile_type = 'architect' AND status = 'approved');
