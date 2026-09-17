// /fotograf sayfasının (kullanıcı isteği, 2026-09-17) veri uçları:
//   GET /api/photos                      — havuzu mekan filtresine göre süzer ve sayfalar
//   GET /api/photos/space-for-query?q=   — serbest metni bir mekan etiketine eşler (AI, madde 11)
//
// Havuz src/lib/photoPool.js#fetchPhotoPool'dan gelir (KV-önbellekli). Bu uç süzer, sayfalar ve
// sayfa başına proje künyesini görsele birleştirir (expand).
//
// ARAMA SIRALAMASI (2026-09-18, kullanıcı isteği: "tuvalet & banyo araması yaptım ama hiç görsel
// bulamadı ... Arama motoru sonuçlarını proje künyelerini de kullanarak geliştir"):
//   1) AI etiketi o mekanı taşıyan görseller (asıl sonuç), yükleme sırasıyla;
//   2) ardından AI'ın HENÜZ BAKMADIĞI (spaces === null) görsellerden, projesinin KÜNYESİNDE o mekanın
//      anahtar kelimeleri geçenler (photoPool.js#keywordSpaces) — `via: 'kunye'` işaretiyle.
//   AI'ın bakıp "yok" dediği görseller (spaces === []) hiçbir zaman ikincil sonuca girmez.
// Böylece etiketleme turu henüz tamamlanmamışken bile sayfa boş kalmaz ve "Daha Fazla Göster"
// doğal olarak belirir; etiketleme ilerledikçe 1. küme büyür, 2. küme küçülür.
import { json, errorJson } from '../lib/http.js';
import { cachedPublicJson } from '../lib/publicCache.js';
import { fetchPhotoPool } from '../lib/photoPool.js';
import { callOnce, isAiProviderConfigured } from '../lib/aiProvider.js';
import { AI_MODEL } from '../lib/aiConfig.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { spaceQuerySystemPrompt, SPACE_QUERY_SCHEMA, normalizeQuerySpace, PHOTO_SPACE_OPTIONS } from '../lib/photoSpaceClassify.js';

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 120;

function expand(pool, it, via) {
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
    spaces: it.spaces || [],
    ...(via ? { via } : {}),
  };
}

export function selectPhotos(pool, space) {
  if (!space || !PHOTO_SPACE_OPTIONS.includes(space)) return pool.items.map(it => ({ it, via: null }));
  const primary = [];
  const secondary = [];
  for (const it of pool.items) {
    if (Array.isArray(it.spaces)) {
      if (it.spaces.includes(space)) primary.push({ it, via: null });
      continue;
    }
    const p = pool.projects[it.projectSlug];
    if (p && p.keywordSpaces && p.keywordSpaces.includes(space)) secondary.push({ it, via: 'kunye' });
  }
  return primary.concat(secondary);
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
    const items = selected.slice(offset, offset + limit).map(({ it, via }) => expand(pool, it, via));
    return { items, total: selected.length, hasMore: offset + limit < selected.length, spaces: PHOTO_SPACE_OPTIONS };
  });
}

// SERBEST METİN -> ETİKET (kullanıcı isteği madde 11). İstemci önce listeyi + anahtar kelimeleri
// kendi süzer; yalnızca hiçbiri eşleşmeyince buraya gelir. Herkese açık bir LLM ucu olduğu için
// IP bazlı hız sınırı ŞART (comments.js#createComment ile AYNI checkRateLimit deseni).
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
