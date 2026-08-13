// Faz 3 — canlı filtre sayaçları (bkz. docs/architecture-roadmap.md §2b/Faz3 madde 3,
// migrations/0024_facet_counts.sql). Sayaçlar `facet_counts` D1 tablosunda TUTULUR (kalıcı, gerçek
// kaynak) ve `env.FACET_CACHE` KV'de ÖNBELLEKLENİR (hızlı okuma — Workers Cache API'nin aksine KV
// global replikasyon sağlar, bkz. src/lib/ssrCache.js#purgeSsrDetailCache'teki AYNI "caches.default
// PoP-başınadır" gerekçesi).
//
// ÖNEMLİ KAPSAM NOTU: yalnızca 'projects' için dolduruluyor — kullanıcının verdiği örneklerle
// ("Mimari (461)") birebir örtüşen, sayfasında gerçek bir GENEL (filtresiz) kategori facet'i olan
// tip. 'architects' (mimar.html'in "Kurucu/Çalışan" pozisyon sayacı ve OFİSİN ödüllerinden türetilen
// bambaşka bir sayaç) ve 'offices' (firma.html'de hiç per-option sayaç YOK, yalnızca toplam sonuç
// sayısı) bu düz list_type/facet_key/facet_value modeline doğal olarak oturmuyor — bu iki tip
// kapsam dışı bırakıldı. 'products' bir süre dolduruluyordu ama HİÇBİR okuyucusu yoktu (urun.html
// kendi facet sayaçlarını client-side, çekilen havuzdan hesaplıyor) — gerçek bulgu (denetim raporu):
// her ürün/malzeme yazımında D1 DELETE+INSERT + KV temizliği olarak boşuna çalışıyordu, kaldırıldı.
//
// bumpFacetCounts() "gerçek delta" (belirli bir yazma işleminin ETKİLEDİĞİ tek tek facet_value'ları
// +1/-1 güncelleme) yerine BİLEREK tam yeniden hesaplama yapar: mevcut veri ölçeğinde (yüzlerce-
// binlerce satır) tek bir GROUP BY sorgusu zaten milisaniyeler sürüyor, buna karşın gerçek bir delta
// sistemi (bir projenin kategorisi değiştiğinde eskisini -1, yenisini +1 yapmak, JSON dizi alanları
// için her elemanı ayrı ayrı izlemek vb.) çok daha fazla kod ve çift-sayma/eksik-azaltma riski
// taşırdı — doğruluk, "gerçek incremental" olmaktan daha öncelikli.

import { fetchActiveProjectPool, buildFilterGroups } from './projectPool.js';
import { reserveKvWrite } from './kvQuota.js';

const KV_TTL_SECONDS = 300;
function kvKey(listType) { return `facet_counts:${listType}`; }

async function replaceFacetCounts(env, listType, groups) {
  const now = new Date().toISOString();
  const statements = [env.DB.prepare(`DELETE FROM facet_counts WHERE list_type = ?`).bind(listType)];
  for (const [facetKey, counts] of Object.entries(groups)) {
    for (const [facetValue, count] of Object.entries(counts)) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO facet_counts (list_type, facet_key, facet_value, count, updated_at) VALUES (?, ?, ?, ?, ?)`
        ).bind(listType, facetKey, facetValue, count, now)
      );
    }
  }
  await env.DB.batch(statements);
  if (env.FACET_CACHE) await env.FACET_CACHE.delete(kvKey(listType));
}

async function recomputeProjectFacets(env) {
  const pool = await fetchActiveProjectPool(env);
  const FILTER_GROUPS = buildFilterGroups(new Map()); // rating hariç — bkz. dosya başı kapsam notu, facet_counts filtresiz/rating'siz genel sayım için
  const groups = {};
  for (const g of FILTER_GROUPS) {
    if (g.key === 'rating' || g.key === 'district') continue; // rating puanlara bağlı (ayrı sorgu gerektirir), district nested bir alt-facet — bu turda kapsam dışı
    const counts = {};
    pool.forEach(p => { g.field(p).forEach(v => { if (v) counts[v] = (counts[v] || 0) + 1; }); });
    groups[g.key] = counts;
  }
  await replaceFacetCounts(env, 'projects', groups);
}

// Bir yazma işleminden (onay/silme/güncelleme/gizleme) sonra çağrılır — bkz. src/routes/admin.js,
// src/routes/legacyContent.js, src/lib/officeFounderCascade.js çağrı noktaları. listType
// 'products'/'materials' (dosya başı kapsam notu — okuyucusu yok) ve 'architects'/'offices' için
// no-op'tur.
export async function bumpFacetCounts(env, listType) {
  if (listType === 'projects') return recomputeProjectFacets(env);
}

// src/routes/project.js#handleProjectFiltersRoute'un "hiçbir filtre aktif değil" hızlı yolu için
// KV/facet_counts'tan anlık okur (bkz. o dosyadaki çağrı noktası) — yalnızca listType='projects'
// ile çağrılır.
export async function getCachedFacetCounts(env, listType) {
  if (env.FACET_CACHE) {
    const cached = await env.FACET_CACHE.get(kvKey(listType), 'json');
    if (cached) return cached;
  }
  const { results } = await env.DB.prepare(`SELECT facet_key, facet_value, count FROM facet_counts WHERE list_type = ?`).bind(listType).all();
  const out = {};
  for (const row of results) {
    if (!out[row.facet_key]) out[row.facet_key] = {};
    out[row.facet_key][row.facet_value] = row.count;
  }
  // gerçek bulgu (denetim raporu): R2 için var olan r2Quota.js'e benzer bir KV yazma-kotası koruması
  // yoktu — bkz. src/lib/kvQuota.js. reserveKvWrite false dönerse (günlük güvenlik payı aşıldıysa)
  // yazma sessizce atlanır, bir sonraki okuma D1'den devam eder (bkz. o dosyadaki gerekçe).
  if (env.FACET_CACHE && await reserveKvWrite(env)) {
    await env.FACET_CACHE.put(kvKey(listType), JSON.stringify(out), { expirationTtl: KV_TTL_SECONDS });
  }
  return out;
}
