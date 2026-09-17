// /fotograf sayfasının (kullanıcı isteği, 2026-09-17) veri uçları:
//   GET /api/photos                      — havuzu mekan filtresine göre süzer ve sayfalar
//   GET /api/photos/stats                — etiketleme/ipucu kapsamı + mekan başına sonuç sayıları
//   GET /api/photos/space-for-query?q=   — serbest metni bir mekan etiketine eşler (AI)
//
// Havuz src/lib/photoPool.js#fetchPhotoPool'dan gelir (KV-önbellekli). Bu uç süzer, sıralar,
// sayfalar ve sayfa başına proje künyesini görsele birleştirir (expand).
//
// ============================================================================================
// MEKAN FİLTRESİ — ÜÇ SİNYAL, TEK SIRALAMA (2026-09-18 beşinci tur, kullanıcı isteği: "arama
// filtreleri için en doğru ve en çok sonuç için gereken en iyi sistemi kur")
// ============================================================================================
// Sinyaller (bkz. photoPool.js dosya başı): vision-LLM etiketi (en isabetli, kapsamı etiketleme
// turuyla büyür), CLIP sıfır-atış ipucu (anlık, her görselde var) ve proje künyesi (ön bilgi).
//
// KADEMELER — küçük numara ÖNCE; her kademe kendi içinde YÜKLEME SIRASINI korur ("en yeni proje
// önce" ilkesi bozulmaz, yalnızca daha az kesin eşleşmeler kümenin sonuna iner):
//   1  LLM birincil/yüksek güven  +  CLIP de aynı mekanı destekliyor   ("çifte onay")
//   2  LLM birincil/yüksek güven
//   3  LLM HENÜZ BAKMADI, CLIP güçlü (sınıf başına ölçülmüş eşik, ~%85-95 isabet)
//   4  LLM ikincil etiket  +  CLIP destekliyor
//   5  LLM ikincil etiket (güveni >= SECONDARY_MIN)
//   6  LLM HENÜZ BAKMADI, CLIP orta + KÜNYE o mekanı anıyor (yalnızca ölçümün desteklediği sınıflar)
//   0  eşleşmez
//
// HÜKÜM LLM'İNDİR: LLM bir görsele bakıp o mekanı SAYMADIYSA, CLIP ne derse desin görsel sonuca
// girmez. CLIP yalnızca LLM'in bakmadığı görselde (yeni yükleme / süren tur) sonuç üretir — böylece
// filtreler hiçbir zaman boş kalmaz ve etiketleme ilerledikçe 3/6 kademeleri kendiliğinden erir.
//
// KÜNYE TEK BAŞINA SONUÇ ÜRETMEZ (2026-09-18 üçüncü turda kaldırılan ikincil sonuç GERİ GELMEDİ):
// ölçüm photoSpaceClip.js dosya başında — bir proje seviyesi sinyal görsel seçemiyor.
// Çizimler havuza hiç girmez (photoPool.js), dolayısıyla hiçbir sonuçta çıkmaz.
import { json, errorJson } from '../lib/http.js';
import { cachedPublicJson } from '../lib/publicCache.js';
import { fetchPhotoPool } from '../lib/photoPool.js';
import { callOnce, isAiProviderConfigured } from '../lib/aiProvider.js';
import { AI_MODEL } from '../lib/aiConfig.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { spaceQuerySystemPrompt, SPACE_QUERY_SCHEMA, normalizeQuerySpace, PHOTO_SPACE_OPTIONS } from '../lib/photoSpaceClassify.js';
import { clipProbOf, clipVerdict, CLIP_AGREE_MIN } from '../lib/photoSpaceClip.js';

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 120;
export const PRIMARY_MIN = 0.7;
export const SECONDARY_MIN = 0.55;
export const TIER_COUNT = 6;

// Bir görselin bir mekana eşleşme kademesi (dosya başındaki tablo). project: havuzdaki künye kaydı.
export function spaceTier(item, space, project) {
  const spaces = item && item.spaces;
  if (Array.isArray(spaces)) {
    const hit = spaces.find(s => s.label === space);
    if (!hit) return 0;
    const c = hit.confidence;
    const agrees = clipProbOf(item.clip, space) >= CLIP_AGREE_MIN;
    if (hit.primary || (c != null && c >= PRIMARY_MIN)) return agrees ? 1 : 2;
    if (c == null || c >= SECONDARY_MIN) return agrees ? 4 : 5;
    return 0;
  }
  const kunyeHas = !!(project && Array.isArray(project.kunye) && project.kunye.includes(space));
  const verdict = clipVerdict(item && item.clip, space, kunyeHas);
  if (verdict === 'strong') return 3;
  if (verdict === 'kunye') return 6;
  return 0;
}

export function selectPhotos(pool, space) {
  if (!space || !PHOTO_SPACE_OPTIONS.includes(space)) return pool.items.slice();
  const tiers = Array.from({ length: TIER_COUNT }, () => []);
  for (const it of pool.items) {
    const t = spaceTier(it, space, pool.projects && pool.projects[it.projectSlug]);
    if (t) tiers[t - 1].push(it);
  }
  return [].concat(...tiers);
}

// Lightbox çipleri: LLM baktıysa onun ARANABİLİR etiketleri; bakmadıysa CLIP'in GÜÇLÜ dediği mekan
// (çeldirici/çizim etiketi hiçbir zaman çip olmaz).
function displaySpaces(it, project) {
  if (Array.isArray(it.spaces)) return it.spaces.map(s => s.label).filter(l => PHOTO_SPACE_OPTIONS.includes(l));
  const top = it.clip && it.clip.t;
  return top && PHOTO_SPACE_OPTIONS.includes(top) && spaceTier(it, top, project) === 3 ? [top] : [];
}

function expand(pool, it) {
  const p = pool.projects[it.projectSlug] || {};
  return {
    url: it.url,
    projectSlug: it.projectSlug,
    projectTitle: p.title || '',
    projectLocation: p.location || null,
    projectDate: p.date || null,
    discipline: p.discipline || [], category: p.category || [], type: p.type || [], awards: p.awards || [],
    architects: p.architects || [], offices: p.offices || [],
    credit: p.credit || null,
    creditType: p.creditType || null,
    // gallery.js#paintCredit ile AYNI düşüş: görsel başına etiket yoksa projenin künyesi.
    photographer: it.photographer || p.photoCredit || null,
    spaces: displaySpaces(it, p),
  };
}

// Kapsam raporu — etiketleme turunun ilerleyişini ve filtrelerin doluluğunu İZLEMEK için
// (scripts/smoke-test.sh de okur). Hiçbir kişisel/özel veri taşımaz: sayılardan ibarettir.
function poolStats(pool) {
  const perSpace = {};
  for (const space of PHOTO_SPACE_OPTIONS) {
    const byTier = new Array(TIER_COUNT).fill(0);
    for (const it of pool.items) {
      const t = spaceTier(it, space, pool.projects && pool.projects[it.projectSlug]);
      if (t) byTier[t - 1]++;
    }
    perSpace[space] = { total: byTier.reduce((a, b) => a + b, 0), byTier };
  }
  return { ...(pool.stats || {}), spaces: perSpace };
}

export async function handlePhotosRoute(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorJson('Bulunamadı', 404);
  if (url.pathname === '/api/photos/space-for-query') return spaceForQuery(request, env, url);
  if (url.pathname === '/api/photos/stats') {
    return cachedPublicJson(request, env, url.pathname, async () => poolStats(await fetchPhotoPool(env)));
  }
  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    const pool = await fetchPhotoPool(env);
    const space = (url.searchParams.get('space') || '').trim();
    const selected = selectPhotos(pool, space);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const items = selected.slice(offset, offset + limit).map(it => expand(pool, it));
    return { items, total: selected.length, hasMore: offset + limit < selected.length, spaces: PHOTO_SPACE_OPTIONS };
  });
}

// SERBEST METİN -> ETİKET. İstemci önce listeyi + anahtar kelimeleri kendi süzer; yalnızca hiçbiri
// eşleşmeyince buraya gelir. Herkese açık bir LLM ucu olduğu için IP bazlı hız sınırı ŞART.
async function spaceForQuery(request, env, url) {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
  if (q.length < 2) return json({ space: null });
  if (!isAiProviderConfigured(env)) return json({ space: null, reason: 'ai_unavailable' });
  const ip = request.headers.get('cf-connecting-ip') || 'anon';
  if (!(await checkRateLimit(env, 'photo-space-query', ip, 20, 10 * 60 * 1000))) {
    return errorJson('Çok fazla arama. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '600' });
  }
  try {
    const parsed = await callOnce(env, {
      system: spaceQuerySystemPrompt(),
      userText: `Arama metni: "${q}"`,
      schema: SPACE_QUERY_SCHEMA,
      model: AI_MODEL,
      maxTokens: 60,
    });
    return json({ space: normalizeQuerySpace(parsed) });
  } catch {
    return json({ space: null, reason: 'ai_error' });
  }
}
