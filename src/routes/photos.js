// /fotograf sayfasının (kullanıcı isteği, 2026-09-17) veri uçları:
//   GET /api/photos                      — havuzu mekan filtresine göre süzer ve sayfalar
//   GET /api/photos/space-for-query?q=   — serbest metni bir mekan etiketine eşler (AI)
//
// Havuz src/lib/photoPool.js#fetchPhotoPool'dan gelir (KV-önbellekli). Bu uç süzer, sıralar,
// sayfalar ve sayfa başına proje künyesini görsele birleştirir (expand).
//
// ARAMA KALİTESİ (2026-09-18 üçüncü tur, kullanıcı isteği: "bazen filtreye göre alakasız
// fotoğraflar geliyor ... farklı yollar da bul"):
//   * Yalnızca AI'ın GÖRSEL BAŞINA verdiği etiket sonuç üretir — proje künyesindeki anahtar kelime
//     ikincil sonucu KALDIRILDI (proje seviyesinde bir sinyal görsel seçemiyordu, bkz. photoPool.js).
//   * İKİ KADEME: (1) mekan görselin BİRİNCİL etiketi (modelin "ana konu" dediği, listenin ilki) ya da
//     güveni ≥ PRIMARY_MIN; (2) ikincil etiket, güveni ≥ SECONDARY_MIN (güven bilinmiyorsa eski
//     kayıttır, kabul). Her kademe kendi içinde YÜKLEME SIRASINI korur — yani "en yeni proje önce"
//     ilkesi bozulmaz, yalnızca zayıf eşleşmeler kümenin sonuna iner.
//   * Çizimler havuza hiç girmez (photoPool.js), dolayısıyla hiçbir sonuçta çıkmaz.
import { json, errorJson } from '../lib/http.js';
import { cachedPublicJson } from '../lib/publicCache.js';
import { fetchPhotoPool } from '../lib/photoPool.js';
import { callOnce, isAiProviderConfigured } from '../lib/aiProvider.js';
import { AI_MODEL } from '../lib/aiConfig.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { spaceQuerySystemPrompt, SPACE_QUERY_SCHEMA, normalizeQuerySpace, PHOTO_SPACE_OPTIONS } from '../lib/photoSpaceClassify.js';

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 120;
export const PRIMARY_MIN = 0.7;
export const SECONDARY_MIN = 0.55;

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
    spaces: (it.spaces || []).map(s => s.label),
  };
}

// Bir görselin bir mekana eşleşme kademesi: 1 (birincil/yüksek güven), 2 (ikincil), 0 (eşleşmez).
export function matchTier(spaces, space) {
  if (!Array.isArray(spaces)) return 0;
  const idx = spaces.findIndex(s => s.label === space);
  if (idx < 0) return 0;
  const c = spaces[idx].confidence;
  if (idx === 0 || (c != null && c >= PRIMARY_MIN)) return 1;
  if (c == null || c >= SECONDARY_MIN) return 2;
  return 0;
}

export function selectPhotos(pool, space) {
  if (!space || !PHOTO_SPACE_OPTIONS.includes(space)) return pool.items.slice();
  const tier1 = [];
  const tier2 = [];
  for (const it of pool.items) {
    const t = matchTier(it.spaces, space);
    if (t === 1) tier1.push(it);
    else if (t === 2) tier2.push(it);
  }
  return tier1.concat(tier2);
}

export async function handlePhotosRoute(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorJson('Bulunamadı', 404);
  if (url.pathname === '/api/photos/space-for-query') return spaceForQuery(request, env, url);
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
