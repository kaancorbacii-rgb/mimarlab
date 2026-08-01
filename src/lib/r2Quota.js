// R2 (mimarlab-uploads) ücretsiz kota koruması (bkz. kullanıcı isteği: "Cloudflare'daki R2 Paid'in
// benden asla para çekmesini istemiyorum ... asla ama asla ücretli kota kullanımına geçme").
// Cloudflare'ın hesap düzeyinde sabit bir "harcama tavanı" özelliği yok — ücretsiz kota (10 GB
// depolama, ayda 1M Class A / 10M Class B işlem) aşıldığında otomatik faturalandırır, bunu
// durduran bir anahtar yok. Bu yüzden koruma burada, UYGULAMA katmanında: her R2 yazımından ÖNCE
// kümülatif kullanım kontrol edilir; ücretsiz kotanın belirgin bir güvenlik payıyla altında kalan
// bir eşiği aşacaksa yazma denemesi hiç yapılmadan reddedilir. Cloudflare R2'nin kendi tarafında
// hâlâ ücretsiz kota bitince faturalandırmaya geçme İHTİMALİ vardır (bu kontrol sadece BU
// UYGULAMANIN üretebileceği kullanımı sınırlar) — hesapta R2 için ödeme yöntemi olup olmadığını
// Cloudflare panelinden ayrıca kontrol etmek gerekir, bu koddan görülemez/değiştirilemez.
import { errorJson } from './http.js';

// Ücretsiz kotanın (10 GB / 1M işlem) altında bilinçli bir güvenlik payı — kalan pay diğer
// olası kullanım kaynaklarını (ör. wrangler CLI ile elle yüklenen dosyalar) da tolere eder.
const SAFE_STORAGE_BYTES = 9 * 1024 * 1024 * 1024; // 9 GB
const SAFE_OPS_PER_MONTH = 900000; // 900k

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7); // 'YYYY-MM'
}

async function loadUsageRow(env) {
  const row = await env.DB.prepare(`SELECT * FROM r2_usage WHERE id = 'singleton'`).first();
  const month = currentMonthKey();
  if (!row) return { total_bytes: 0, ops_count: 0, ops_month: month };
  if (row.ops_month !== month) return { ...row, ops_count: 0, ops_month: month };
  return row;
}

// upload.js/ai.js, env.UPLOADS.put() ÇAĞRISINDAN ÖNCE bunu çağırır — {ok:false} dönerse hiçbir
// yazma denemesi yapılmaz, kullanıcıya reason mesajıyla net bir hata döner.
export async function checkR2Quota(env, additionalBytes) {
  const usage = await loadUsageRow(env);
  if (usage.total_bytes + additionalBytes > SAFE_STORAGE_BYTES) {
    return { ok: false, reason: 'Ücretsiz R2 depolama kotasının güvenlik sınırına ulaşıldı, yeni görsel yüklenemiyor. Bu, ücretli kullanıma geçilmesini önlemek için bilinçli bir sınırdır.' };
  }
  if (usage.ops_count + 1 > SAFE_OPS_PER_MONTH) {
    return { ok: false, reason: 'Bu ayki ücretsiz R2 işlem kotasının güvenlik sınırına ulaşıldı, yeni görsel yüklenemiyor. Gelecek ay tekrar dene.' };
  }
  return { ok: true };
}

export function r2QuotaErrorResponse(reason) {
  return errorJson(reason, 403);
}

// Başarılı bir env.UPLOADS.put()'tan SONRA çağrılır — sayaç ancak yazma gerçekten başarılı
// olduysa artırılır (bkz. checkR2Quota'nın hemen öncesinde çağrıldığı yerler).
export async function recordR2Usage(env, bytes) {
  const month = currentMonthKey();
  const existing = await env.DB.prepare(`SELECT * FROM r2_usage WHERE id = 'singleton'`).first();
  const now = Date.now();
  if (!existing) {
    await env.DB.prepare(
      `INSERT INTO r2_usage (id, total_bytes, ops_count, ops_month, updated_at) VALUES ('singleton', ?, 1, ?, ?)`
    ).bind(bytes, month, now).run();
    return;
  }
  const opsCount = existing.ops_month === month ? existing.ops_count + 1 : 1;
  await env.DB.prepare(
    `UPDATE r2_usage SET total_bytes = total_bytes + ?, ops_count = ?, ops_month = ?, updated_at = ? WHERE id = 'singleton'`
  ).bind(bytes, opsCount, month, now).run();
}
