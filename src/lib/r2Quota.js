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

export function r2QuotaErrorResponse(reason) {
  return errorJson(reason, 403);
}

// gerçek bulgu: eskiden ayrı bir checkR2Quota() (SELECT) + recordR2Usage() (SELECT+UPDATE) çifti
// vardı — ikisi arasında bir R2 yazımı geçtiğinden, aynı anda başlayan iki yükleme ikisi de
// checkR2Quota'yı kotanın altındayken geçebilir, ikisi de yazar, ikisinin recordR2Usage'ı da
// kotayı fiilen aşırdı (TOCTOU). Burada tek bir atomik UPDATE...RETURNING ile "rezervasyon" yapılır:
// artış VE limit kontrolü aynı SQLite ifadesinde gerçekleşir, D1/SQLite bir satırı aynı anda yalnızca
// tek bir yazma ifadesiyle güncelleyebildiğinden iki eşzamanlı istek asla ikisi birden "geçti"
// sonucunu alamaz — WHERE koşulunu sağlamayan istek RETURNING'de hiçbir satır almaz (row === null).
// Optimize edilmemiş orijinal file.size ÜST SINIR olarak rezerve edilir (optimizeUploadedImage
// henüz çalışmadığından gerçek yazılacak boyut bilinmez, WebP dönüşümü boyutu KÜÇÜLTÜR ya da
// olduğu gibi bırakır — büyütmez, bkz. imageOptimize.js MAX_DIMENSION/fit:'scale-down'), R2
// yazımından SONRA finalizeR2Reservation ile gerçek boyuta düzeltilir (bkz. upload.js).
export async function reserveR2Usage(env, estimatedBytes) {
  const month = currentMonthKey();
  const now = Date.now();
  const row = await env.DB.prepare(
    `UPDATE r2_usage
     SET total_bytes = total_bytes + ?,
         ops_count = CASE WHEN ops_month = ? THEN ops_count + 1 ELSE 1 END,
         ops_month = ?,
         updated_at = ?
     WHERE id = 'singleton'
       AND (total_bytes + ?) <= ?
       AND (CASE WHEN ops_month = ? THEN ops_count + 1 ELSE 1 END) <= ?
     RETURNING total_bytes`
  ).bind(
    estimatedBytes, month, month, now,
    estimatedBytes, SAFE_STORAGE_BYTES,
    month, SAFE_OPS_PER_MONTH,
  ).first();

  if (row) return { ok: true, reservedBytes: estimatedBytes };

  // Reddedildi — hangi sınırın aşıldığını bulup kullanıcıya doğru mesajı vermek için sadece
  // OKUMA amaçlı bir takip sorgusu (yarış riski yok, hiçbir şey yazmıyor).
  const usage = await loadUsageRow(env);
  if (usage.total_bytes + estimatedBytes > SAFE_STORAGE_BYTES) {
    return { ok: false, reason: 'Ücretsiz R2 depolama kotasının güvenlik sınırına ulaşıldı, yeni görsel yüklenemiyor. Bu, ücretli kullanıma geçilmesini önlemek için bilinçli bir sınırdır.' };
  }
  return { ok: false, reason: 'Bu ayki ücretsiz R2 işlem kotasının güvenlik sınırına ulaşıldı, yeni görsel yüklenemiyor. Gelecek ay tekrar dene.' };
}

// R2'ye başarıyla yazıldıktan SONRA çağrılır — rezerve edilen üst sınır (estimatedBytes) gerçekte
// yazılan boyuta (actualBytes, optimize edildiyse genelde daha küçük) düzeltilir. Fark her zaman
// <= 0 olacağından (yukarıdaki yorum) yeniden limit kontrolüne gerek yok, yalnızca düzeltme.
export async function finalizeR2Reservation(env, reservedBytes, actualBytes) {
  const delta = actualBytes - reservedBytes;
  if (delta === 0) return;
  await env.DB.prepare(
    `UPDATE r2_usage SET total_bytes = total_bytes + ?, updated_at = ? WHERE id = 'singleton'`
  ).bind(delta, Date.now()).run();
}

// R2 yazımı BAŞARISIZ olursa çağrılır — rezervasyon tamamen geri alınır (byte VE bu isteğin
// ops_count artışı), aksi halde hiç gerçekleşmemiş bir yükleme kotayı kalıcı olarak tüketirdi.
export async function releaseR2Reservation(env, reservedBytes) {
  const month = currentMonthKey();
  await env.DB.prepare(
    `UPDATE r2_usage
     SET total_bytes = total_bytes - ?,
         ops_count = CASE WHEN ops_month = ? THEN MAX(ops_count - 1, 0) ELSE ops_count END,
         updated_at = ?
     WHERE id = 'singleton'`
  ).bind(reservedBytes, month, Date.now()).run();
}
