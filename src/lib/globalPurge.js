// Cloudflare zone-geneli (TÜM PoP'lar) önbellek temizliği — production audit 2026-09-01, madde E.
//
// PROBLEM. `caches.default` PoP-BAŞINADIR. invalidatePublicCache() (publicCache.js) ve
// purgeSsrDetailCache() (ssrCache.js) yalnızca YAZMA isteğini işleyen edge node'un kendi girdisini
// siler. Admin Frankfurt'tan bir kaydı düzenlerse, İstanbul PoP'undaki eski kopya kendi s-maxage'ı
// (liste/detay için 5 dk) dolana kadar yaşamaya devam eder — "kaydettim ama değişmedi" şikâyetinin
// kök nedeni budur (bkz. publicCache.js#ANON_CACHE_HEADERS ve ssrCache.js'teki aynı not).
//
// DEĞERLENDİRİLEN SEÇENEKLER ve NEDEN BU:
//   * Cache Tags (purge-by-tag): yalnızca Enterprise planında. Bu hesapta yok.
//   * Durable Objects ile paylaşımlı invalidation state'i: Workers ÜCRETLİ planı gerektirir ve
//     istek başına faturalanır. Bu depoda beklenmedik faturalandırma DAHA ÖNCE yaşandı ve kullanıcı
//     isteğiyle geri alındı (bkz. wrangler.jsonc'taki "images" binding'i notu: ~$16/ay) — bu yüzden
//     otomatik olarak UYGULANMADI, bilinçli bir maliyet kararı gerektirir.
//   * s-maxage'ı daha da kısaltmak: tazeliği D1 okuma maliyetiyle takas eder, asıl sorunu çözmez.
//   * >> Purge-by-URL REST API'si: TÜM planlarda (Free dahil) mevcut, çalışma zamanı ücreti YOK,
//     tek çağrıda 30 URL'ye kadar zone-geneli temizler. Doğru araç bu.
//
// ETKİNLEŞTİRME (kullanıcı tarafından yapılmalı — API token'ı yalnızca hesap sahibi üretebilir):
//     npx wrangler secret put CF_ZONE_ID        # Cloudflare > mimarlab.com > Overview > Zone ID
//     npx wrangler secret put CF_PURGE_TOKEN    # My Profile > API Tokens > Create Token
//                                               # izin: Zone > Cache Purge > Purge
// İKİ secret DE tanımlı değilse bu modül HİÇBİR ŞEY YAPMAZ ve mevcut davranış BİREBİR korunur —
// yani kod bugün deploy edilebilir, secret'lar eklendiği an kendiliğinden devreye girer. Hiçbir
// çağrı noktası bir hata durumunda kullanıcı işlemini bozmaz (tamamı try/catch + fire-and-forget).
const PURGE_ENDPOINT = 'https://api.cloudflare.com/client/v4/zones';
// Enterprise dışı planlarda purge-by-URL isteği başına en fazla 30 URL kabul edilir.
const MAX_URLS_PER_CALL = 30;

export function isGlobalPurgeConfigured(env) {
  return !!(env && env.CF_ZONE_ID && env.CF_PURGE_TOKEN);
}

// urls: tam mutlak URL dizisi (ör. "https://mimarlab.com/api/projects"). Dönen değer yalnızca
// gözlemlenebilirlik içindir (bkz. GET /api/_health) — çağıranların hiçbiri sonucu beklemek
// ZORUNDA değildir; hepsi ctx.waitUntil benzeri bir "fire and forget" bağlamında kullanılabilir.
export async function purgeGlobalUrls(env, urls) {
  if (!isGlobalPurgeConfigured(env)) return { skipped: true };
  const unique = [...new Set((urls || []).filter(Boolean))];
  if (!unique.length) return { skipped: true };

  let ok = 0;
  let failed = 0;
  for (let i = 0; i < unique.length; i += MAX_URLS_PER_CALL) {
    const chunk = unique.slice(i, i + MAX_URLS_PER_CALL);
    try {
      const res = await fetch(`${PURGE_ENDPOINT}/${env.CF_ZONE_ID}/purge_cache`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.CF_PURGE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ files: chunk }),
      });
      if (res.ok) ok += chunk.length; else failed += chunk.length;
    } catch {
      // Ağ hatası/timeout — purge yalnızca bir HIZLANDIRMADIR: başarısız olursa mevcut s-maxage
      // tabanlı tazelik davranışına düşülür, hiçbir kullanıcı işlemi etkilenmez.
      failed += chunk.length;
    }
  }
  return { purged: ok, failed };
}
