-- Additive migration (applied by hand — bkz. migrations/0071_product_files.sql'deki AYNI not,
-- d1_migrations tablosu 0014'te takılı kaldığından burada da 'wrangler d1 migrations apply' yerine
-- 'wrangler d1 execute --file' kullanılmalı).
--
-- GERÇEK BULGU (kullanıcı bildirimi, 2026-09-11 — "Withco CoWorking Central yeniden yüklendi ama
-- proje sayfasında 1. sıraya yerleşmedi"). migrations/0108_relisted_at.sql'in belgelediği sözleşme
-- ("ORDER BY (preview_at IS NOT NULL) ASC, relisted_at DESC, <havuzun kendi ölçütü>") relisted_at'i
-- AYRI ve HER ZAMAN daha yüksek öncelikli bir sıralama anahtarı yapıyordu. SQLite'ta DESC
-- sıralamada NULL SONA düşer, yani relisted_at'i BİR KEZ damgalanmış herhangi bir satır (tarihi ne
-- kadar eski olursa olsun) relisted_at'i hiç set edilmemiş herhangi bir satırdan (created_at ne
-- kadar yeni olursa olsun) SÜRESİZ önde kalıyordu. Canlıda 2026-09-10 tarihli bir admin işleminden
-- kalma 12 proje, bugün (09-11) onaylanan gerçekten yeni bir projeyi (Withco) bu yüzden geçiyordu.
--
-- DÜZELTME: relisted_at artık ayrı bir anahtar değil, publish_date/created_at ile AYNI COALESCE
-- zincirinde karşılaştırılıyor (bkz. src/routes/project.js#fetchProjectPageRows,
-- src/lib/projectPool.js#fetchActiveProjectPool, src/routes/office.js#fetchOfficePool,
-- src/routes/architect.js, src/routes/product.js#fetchProductPool — dört havuzda da AYNI yeni
-- sözleşme). Bir kayıt yeniden yayına alındığında (relisted_at=now) yine en öne geçer
-- (migrations/0108'in asıl amacı korunur), ama bu üstünlük artık SÜRESİZ değil — gerçekten daha
-- yeni bir created_at/relisted_at'e sahip başka bir satır çıkınca yerini ona bırakır.
--
-- idx_projects_build_status_order YENİ ifadeyi kapsayacak şekilde yeniden oluşturulur (bkz.
-- migrations/0067 ve 0087'deki AYNI "ORDER BY değişince index de değişmeli" gerekçesi) — bu index
-- fetchProjectPageRows/fetchProjectListPageFromD1'in her istekte çalışan D1 hızlı yolu için kritik.
DROP INDEX IF EXISTS idx_projects_build_status_order;
CREATE INDEX IF NOT EXISTS idx_projects_build_status_order
  ON projects(build_status, COALESCE(display_order, 0) ASC, COALESCE(relisted_at, publish_date, created_at) DESC, id DESC)
  WHERE deleted_at IS NULL AND hidden_at IS NULL;
