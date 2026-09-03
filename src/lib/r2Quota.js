// R2 (mimarlab-uploads) harcama tavanı koruması.
//
// TARİHÇE — bu dosya başlangıçta "ücretsiz kotayı ASLA aşma" kuralını uyguluyordu (kullanıcı
// isteği: "Cloudflare'daki R2 Paid'in benden asla para çekmesini istemiyorum"). 2026-09-03'te
// kullanıcı bu kuralı BİLEREK GEVŞETTİ: sitenin görsel arşivi büyüdükçe 10 GB'ın aşılması
// kaçınılmaz ve R2'nin GB-ay başına $0.015'lik fiyatı (100 GB'da ayda ~$1.35) kabul edilebilir
// bulundu. Artık amaç ücretsiz kotada kalmak DEĞİL, faturanın öngörülebilir kalması (bkz.
// SAFE_STORAGE_BYTES).
//
// Cloudflare'ın hesap düzeyinde sabit bir "harcama tavanı" özelliği yok — kota aşıldığında otomatik
// faturalandırır, bunu durduran bir anahtar yoktur. Bu yüzden tavan burada, UYGULAMA katmanında:
// her R2 yazımından ÖNCE kümülatif kullanım kontrol edilir, eşiği aşacaksa yazma denemesi hiç
// yapılmadan reddedilir. Bu kontrol yalnızca BU UYGULAMANIN ürettiği kullanımı sınırlar; wrangler
// CLI ile doğrudan yapılan yazımlar (ör. scripts/generate-image-derivatives.py) buradan GEÇMEZ ve
// sayacı kendiliğinden güncellemez — böyle bir toplu işten sonra r2_usage.total_bytes'ın gerçek kova
// boyutuna elle senkronlanması gerekir, aksi halde tavan gerçekte olduğundan daha uzakta sanılır.
import { errorJson } from './http.js';

// POLİTİKA DEĞİŞİKLİĞİ (kullanıcı kararı, 2026-09-03): depolamada ücretsiz kotanın aşılması artık
// KABUL EDİLİYOR. Gerekçe kullanıcının kendi hesabı: R2 depolama 10 GB'ın üstünde GB-ay başına
// $0.015 (developers.cloudflare.com/r2/pricing üzerinden doğrulandı; egress ücretsiz), yani 100 GB'a
// çıkıldığında faturalanan 90 GB x $0.015 = ayda ~$1.35. Kullanıcı bu tutarı açıkça kabul etti ve
// sitenin görsel arşivinin zamanla bugünkünün iki katına çıkmasını bekliyor.
//
// EŞİK NEDEN HÂLÂ VAR: kaçak/döngüsel bir yazımın faturayı sessizce büyütmesini engellemek için.
// 100 GB, kullanıcının açıkça "sorun değil" dediği tutara (~$1.35/ay) denk gelen tavandır — ücretsiz
// kotayı korumak için DEĞİL, beklenmeyen büyümeyi yakalamak için konmuştur.
//
// 2026-09-03 tarihinde bu eşiğin yükseltilmesi ZORUNLUYDU: türev üretimi (scripts/
// generate-image-derivatives.py) wrangler ile DOĞRUDAN yazdığından bu sayaçtan geçmiyor; gerçek
// kova ~9.5 GB'a çıkmıştı. Sayaç gerçeğe senkronlanırken eşik 9 GiB'de bırakılsaydı, ilk kullanıcı
// yüklemesinden itibaren TÜM yüklemeler 403 ile reddedilirdi.
//
// Bayt cinsinden ondalık GB (Cloudflare faturalandırması da ondalık GB üzerinden) — bilerek 1024
// tabanı kullanılmadı ki 100 GB tavanı kullanıcının konuştuğu sayıyla birebir örtüşsün.
// export edildi — src/routes/admin.js#handlePerformanceAdmin bunu Performans sekmesinde
// kullanılan/limit gösterimi için okur (bkz. o dosyadaki çağrı noktası).
export const SAFE_STORAGE_BYTES = 100 * 1000 * 1000 * 1000; // 100 GB (~$1.35/ay)
// İşlem (Class A) tarafı DEĞİŞMEDİ — kullanıcının kararı depolama maliyetiyle ilgiliydi. Class A
// $4.50/milyon olduğundan burada aynı gevşetme çok daha hızlı para yakar; ayrı bir karar gerektirir.
export const SAFE_OPS_PER_MONTH = 900000; // 900k

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
// file.size ÜST SINIR olarak rezerve edilir, R2 yazımından SONRA finalizeR2Reservation ile gerçek
// boyuta düzeltilir (bkz. upload.js). Görselin kendisi ZATEN İSTEMCİDE küçültülüp WebP'ye çevrilmiş
// olarak gelir (bkz. image-upload.js) — sunucu baytları olduğu gibi yazar, dolayısıyla rezerve
// edilen ve yazılan boyut normalde eşittir; düzeltme adımı yine de korunur çünkü bu fonksiyon
// türev yazımları gibi boyutun önceden tam bilindiği çağrılarla da paylaşılır.
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

// gerçek bulgu (denetim raporu): bir görsel R2'den silindiğinde (bkz. canonicalSync.js#deleteR2MediaKeys)
// total_bytes hiç düşürülmüyordu — sayaç yalnızca artıyor, gerçek kullanımdan sürekli uzaklaşıp
// yükseliyor, bu da olması gerekenden ÇOK ÖNCE yeni yüklemeleri (yanlışlıkla) bloke edebiliyordu.
// ops_count'a dokunulmaz: R2'de DeleteObject ücretsizdir/Class A-B sayaçlarına dahil değildir, bkz.
// reserveR2Usage'ın yalnızca PUT rezervasyonunda ops_count artırması.
export async function releaseR2StorageBytes(env, freedBytes) {
  if (!freedBytes) return;
  await env.DB.prepare(
    `UPDATE r2_usage SET total_bytes = MAX(total_bytes - ?, 0), updated_at = ? WHERE id = 'singleton'`
  ).bind(freedBytes, Date.now()).run();
}
