// /fotograf sayfasının (kullanıcı isteği, 2026-09-17: "Ekteki görseldeki ve
// https://co-architecture.com/photos bu linkteki şekilde ... yükleme sırasına göre en son
// yüklenenden ilk yüklenene doğru sıralanacağı bir sayfa") veri uçları:
//   GET /api/photos                      — havuzu mekan filtresine göre süzer ve sayfalar
//   GET /api/photos/space-for-query?q=   — serbest metni bir mekan etiketine eşler (AI, madde 11)
//
// Havuz src/lib/photoPool.js#fetchPhotoPool'dan gelir (KV-önbellekli, proje eklendiğinde/
// düzenlendiğinde/gizlendiğinde invalidatePublicCache() ile tazelenir). Kart altı etiketi (firma/
// mimar) ve fotoğrafçı adı havuzda hazır gelir; bu uç yalnızca süzer ve sayfalar.
import { json, errorJson } from '../lib/http.js';
import { cachedPublicJson } from '../lib/publicCache.js';
import { fetchPhotoPool } from '../lib/photoPool.js';
import { callOnce, isAiProviderConfigured } from '../lib/aiProvider.js';
import { AI_MODEL } from '../lib/aiConfig.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { spaceQuerySystemPrompt, SPACE_QUERY_SCHEMA, normalizeQuerySpace, PHOTO_SPACE_OPTIONS } from '../lib/photoSpaceClassify.js';

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 120;

export async function handlePhotosRoute(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorJson('Bulunamadı', 404);
  if (url.pathname === '/api/photos/space-for-query') return spaceForQuery(request, env, url);
  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    const pool = await fetchPhotoPool(env);
    // Mekan filtresi — yalnızca sabit listedeki (photo-space-taxonomy.js) bir değer kabul edilir,
    // aksi halde (yazım hatası/uydurma değer) filtre SESSİZCE yok sayılır ve TÜM havuz döner.
    const space = (url.searchParams.get('space') || '').trim();
    const filtered = space && PHOTO_SPACE_OPTIONS.includes(space)
      ? pool.filter(p => p.spaces.includes(space))
      : pool;
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const items = filtered.slice(offset, offset + limit);
    return { items, total: filtered.length, hasMore: offset + limit < filtered.length, spaces: PHOTO_SPACE_OPTIONS };
  });
}

// SERBEST METİN -> ETİKET (kullanıcı isteği madde 11: "Filtreleme özelliğini yapay zekayı
// kullanarak geliştir"). İstemci önce listeyi kendi süzer (birebir/alt dize eşleşmesi); yalnızca
// hiçbir etiket eşleşmeyince (ör. "salon", "wc", "çocuk odası") buraya gelir. Metin modeli JSON
// Mode ile tek bir etiket ya da null döner; sonuç whitelist'ten geçer.
//
// Herkese açık bir LLM ucu olduğu için IP bazlı hız sınırı ŞART (comments.js#createComment ile
// AYNI checkRateLimit deseni): dakikada birkaç sorgu bir insan için fazlasıyla yeterli, bir
// döngüde çağıran bir betik nöron kotasını tüketemez.
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
    // AI hatası aramayı kırmasın — istemci "eşleşme yok" davranışına düşer.
    return json({ space: null, reason: 'ai_error' });
  }
}
