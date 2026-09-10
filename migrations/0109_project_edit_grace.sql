-- Proje künyesinden çıkarılan firma/kişi için 1 GÜNLÜK düzenleme yetkisi ödemesizlik süresi
-- (kullanıcı isteği, 2026-09-10 madde 2):
--
--   "Renzo Piano Building Workshop firmasının yöneticisi Galataport projesinden Renzo Piano
--    Building Workshop firmasının ismini sildi. Böyle bir durum olduğunda 1 gün sonra bu projeden
--    düzenleme yetkisinin bu kullanıcıdan kalkması gerekiyor."
--
-- BUGÜNKÜ DAVRANIŞ VE İKİ AYRI HATASI (canlıda doğrulandı):
--   * src/lib/projectClaimAccess.js#canUserEditProjectBySlug yetkiyi project_designers'tan CANLI
--     türetir. Firma künyeden çıkar çıkmaz yetki ANINDA gider — kullanıcı yanlışlıkla sildiği ismi
--     geri koyamaz bile, çünkü düzenleme sayfasına artık giremez. ("1 gün sonra" değil, "hemen".)
--   * Buna karşılık src/routes/submissions.js#canAccessSubmissionRow'un owner_user_id dalı, o
--     projeyi bir kez düzenlemiş kullanıcıya SÜRESİZ erişim bırakır — künyeyle hiçbir bağı
--     kalmasa bile. ("1 gün sonra" değil, "hiçbir zaman".)
-- Bu tablo ikisini de tek bir kurala bağlar: künyeden çıkarılma ANINDA bir revoke_at damgası
-- yazılır (şimdi + 24 saat); o ana kadar yetki SÜRER (yanlışlıkla silmeyi geri almak için),
-- o andan sonra HER İKİ yol da kapanır.
--
-- KAYIT NE ZAMAN SİLİNİR: firma/kişi künyeye geri eklenirse (bkz. src/lib/projectEditGrace.js#
-- clearProjectEditGrace) — yetki yeniden canlı künyeden gelir, damganın bir anlamı kalmaz. Bu,
-- "yanlışlıkla sildim, geri koydum" senaryosunun kendiliğinden düzelmesini sağlar.
--
-- NEDEN AYRI TABLO (profile_claims'e kolon eklemek yerine): kısıt PROJE BAŞINADIR. Bir kullanıcı
-- bir firmayı sahiplenmeye devam eder (claim satırı aynen durur, firmanın diğer projelerini
-- düzenleyebilir); yalnızca künyesinden çıkarıldığı O projedeki yetkisi biter.
CREATE TABLE IF NOT EXISTS project_edit_grace (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Yetkinin BİTECEĞİ an (ms epoch). revoke_at > now → hâlâ düzenleyebilir (geri alma penceresi);
  -- revoke_at <= now → yetki kalktı.
  revoke_at INTEGER NOT NULL,
  -- Hangi künye adının çıkarılması bu damgayı doğurdu — yalnızca denetim/izlenebilirlik için.
  removed_key TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_project_edit_grace_user ON project_edit_grace(user_id);
