-- Additive migration (bkz. migrations/0016_r2_usage_guard.sql'deki AYNI desen ve gerekçe — kullanıcı
-- isteği: "asla ücretli kotaya geçme" R2'ye özgü değildi, FACET_CACHE (Workers KV) için de geçerli).
--
-- gerçek bulgu (denetim raporu): src/lib/publicCache.js#getCachedPool ve src/lib/facetCounts.js her
-- cache MISS'te FACET_CACHE.put() çağırıyor, R2'nin aksine hiçbir yazma-kotası koruması yok. KV'nin
-- ücretsiz kotası günde 1000 yazma/hesap; birden fazla PoP'un aynı anahtarı bağımsız olarak
-- MISS/yeniden-yazma yapabilmesi (KV'nin PoP-başına tutarlılığı) nedeniyle bu limit sanılandan
-- önce zorlanabilir. kv_usage: tek satırlık, GÜNLÜK sıfırlanan kümülatif sayaç (R2'nin AYLIK
-- total_bytes/ops_month'unun aksine KV'nin günlük kotasıyla eşleşir), src/lib/kvQuota.js tarafından
-- her FACET_CACHE.put() öncesi atomik UPDATE...RETURNING ile kontrol edilir.

CREATE TABLE IF NOT EXISTS kv_usage (
  id TEXT PRIMARY KEY,
  writes_count INTEGER NOT NULL DEFAULT 0,
  writes_day TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0
);

INSERT INTO kv_usage (id, writes_count, writes_day, updated_at)
VALUES ('singleton', 0, '', 0)
ON CONFLICT(id) DO NOTHING;
