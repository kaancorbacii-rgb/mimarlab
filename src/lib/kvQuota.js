// Workers KV (FACET_CACHE) ücretsiz kota koruması — bkz. src/lib/r2Quota.js'teki AYNI gerekçe
// (kullanıcı isteği: "asla ücretli kota kullanımına geçme"). R2'nin aksine burada yazma
// BAŞARISIZLIĞI hiçbir kullanıcı işlemini engellemez: FACET_CACHE yalnızca performans amaçlı bir
// önbellektir (getCachedPool/facetCounts.js), kota sınırına ulaşıldığında yazma sessizce atlanır —
// bir sonraki istek KV MISS olarak D1'den okumaya devam eder, hiçbir şey bozulmaz, yalnızca yavaşlar.
// Bu yüzden R2 guard'ındaki gibi bir errorJson(403) reddi YOK — çağıran taraf true/false alır.

export const SAFE_WRITES_PER_DAY = 900; // ücretsiz kotanın (1000/gün) altında güvenlik payı

function currentDayKey() {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

// bkz. r2Quota.js#reserveR2Usage'daki AYNI TOCTOU-güvenli tek atomik UPDATE...RETURNING deseni —
// artış VE limit kontrolü aynı SQLite ifadesinde gerçekleşir.
export async function reserveKvWrite(env) {
  if (!env || !env.DB) return true;
  const day = currentDayKey();
  const now = Date.now();
  try {
    const row = await env.DB.prepare(
      `UPDATE kv_usage
       SET writes_count = CASE WHEN writes_day = ? THEN writes_count + 1 ELSE 1 END,
           writes_day = ?,
           updated_at = ?
       WHERE id = 'singleton'
         AND (CASE WHEN writes_day = ? THEN writes_count + 1 ELSE 1 END) <= ?
       RETURNING writes_count`
    ).bind(day, day, now, day, SAFE_WRITES_PER_DAY).first();
    // gerçek bulgu (denetim raporu, 2026-08-16): kota aşıldığında yazma sessizce D1'e düşüyordu,
    // hiçbir yerde loglanmıyordu — "önbellek neden hep MISS/yavaş" teşhisi Workers Logs'ta hiçbir
    // iz bırakmadığından zorlaşıyordu. Kullanıcı işlemini ENGELLEMİYOR (dosya başı yorum), yalnızca
    // gözlemlenebilirlik için yapılandırılmış (bkz. logger.js'teki AYNI JSON satır deseni) bir uyarı.
    if (!row) console.warn(JSON.stringify({ timestamp: new Date().toISOString(), event: 'kv_quota_exhausted', writes_day: day, limit: SAFE_WRITES_PER_DAY }));
    return !!row;
  } catch {
    // kv_usage tablosu henüz migrate edilmemişse (ör. yerel dev) yazmayı ENGELLEME — bu yalnızca
    // bir koruma katmanı, yokluğu KV'nin kendisini bozmamalı.
    return true;
  }
}
