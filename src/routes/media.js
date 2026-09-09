// GET /api/media/:mediaId — KİLİTLİ MEDYANIN TEK ÇIKIŞ KAPISI (kullanıcı isteği, 2026-09-09 madde 5).
//
// Bu uç, orijinal dosyanın YOLUNU/ANAHTARINI hiçbir koşulda istemciye vermez: ne gövdede, ne bir
// header'da, ne de bir yönlendirmeyle. Özellikle 302/301 KULLANILMAZ — bir yönlendirme, Location
// header'ında tam olarak gizlemeye çalıştığımız URL'i taşırdı. Baytlar her zaman Worker üzerinden
// PROXY edilir.
//
// KARAR AĞACI
//   1. mediaId çözülür (media_rights satırı ya da "p<projeId>-<index>" emniyet biçimi).
//   2. Kayıt + proje okunur. Proje silinmiş/gizlenmişse 404.
//   3. isOriginalPublic (üç koşul: medya approved + public_original_allowed + proje onaylı)
//        EVET -> orijinal baytlar proxy edilir. (Bu URL normalde hiç üretilmez; onaylı medya
//                mevcut /media/ /projects/ yolunda kalır. Yine de tutarlı davranır: eski bir
//                bağlantı ya da onay sonrası cache'ten gelen bir istek kırılmaz.)
//        HAYIR -> YALNIZCA güvenli sürüm (w400 türevi). Türev yoksa yer tutucu; ORİJİNALE ASLA
//                 GERİ DÜŞÜLMEZ.
//
// ÖNBELLEK
// Yanıt Cache API'ye YAZILIR ama anahtarına hak epoch'u karışır (bkz. mediaRights.js#rightsEpoch):
// bir onay kaldırıldığında/verildiğinde epoch artar ve edge'deki tüm eski kopyalar tek hamlede
// yetim kalır. Tarayıcı tarafı bilerek kısa (5 dk): kilitli bir görselin durumu değişebilir ve
// "yıllarca saklanan bir kopya" kavramı bu uçta anlamsızdır.

import { errorJson } from '../lib/http.js';
import {
  LOCKED_PLACEHOLDER_SVG, SAFE_MEDIA_PREFIX, isOriginalPublic, normalizeMediaPath,
  SAFE_DERIVATIVE_WIDTH_LADDER, originalR2KeyFor, parseFallbackMediaId, rightsEpoch, safeDerivativeKeyFor,
} from '../lib/mediaRights.js';

const SAFE_CACHE_SECONDS = 300;
const SAFE_EDGE_CACHE_SECONDS = 3600;
// Onaylı orijinal bu uçtan servis edildiğinde de tarayıcı ömrü SINIRLI tutulur (1 gün): bu URL
// biçimi hak durumuna bağlıdır, "immutable" sözleşmesi burada doğru olmaz.
const ORIGINAL_CACHE_SECONDS = 86400;

const MEDIA_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

function imageHeaders(contentType, maxAge, edgeMaxAge) {
  const headers = new Headers();
  headers.set('Content-Type', contentType || 'application/octet-stream');
  headers.set('Cache-Control', `public, max-age=${maxAge}, s-maxage=${edgeMaxAge}`);
  headers.set('X-Content-Type-Options', 'nosniff');
  // Kilitli/kontrollü medya arama motoru görsel dizinine girmemeli — indexlenirse Google'ın kendi
  // önbelleğinde bizim kapımızın dışında bir kopya oluşur.
  headers.set('X-Robots-Tag', 'noindex, noimageindex');
  return headers;
}

function placeholderResponse() {
  const headers = imageHeaders('image/svg+xml', 60, 60);
  return new Response(LOCKED_PLACEHOLDER_SVG, { status: 200, headers });
}

// Bir yerel yolun baytlarını kaynağından okur. R2 anahtarı ise UPLOADS'tan, statik varlık ise
// env.ASSETS'ten. env.ASSETS.fetch İÇ bir çağrıdır — dış istek kapısından (routeAsset'teki
// lookupGateDecision) geçmez, bu yüzden kilitli bir yolun güvenli türevi burada okunabilir.
async function readLocalBytes(env, request, localPath) {
  const r2Key = originalR2KeyFor(localPath);
  if (r2Key !== null) {
    const object = await env.UPLOADS.get(r2Key);
    if (!object) return null;
    return { body: object.body, contentType: object.httpMetadata?.contentType || 'application/octet-stream' };
  }
  const assetUrl = new URL(request.url);
  assetUrl.pathname = localPath;
  assetUrl.search = '';
  const res = await env.ASSETS.fetch(new Request(assetUrl, { method: 'GET' }));
  if (!res.ok) return null;
  return { body: res.body, contentType: res.headers.get('Content-Type') || 'application/octet-stream' };
}

// Güvenli sürümü okur. Merdiven küçükten büyüğe denenir (bkz. SAFE_DERIVATIVE_WIDTH_LADDER) ve
// hiçbiri yoksa null döner — ORİJİNALE ASLA DÜŞÜLMEZ. handleMediaRoute'un normal güvenlik ağının
// (türev yoksa orijinali ver) TAM TERSİ: orada amaç görselin kırılmaması, burada orijinalin
// sızmamasıdır ve bu ikisi çakıştığında sızmama kazanır.
async function readSafeBytes(env, localPath) {
  for (const width of SAFE_DERIVATIVE_WIDTH_LADDER) {
    const key = safeDerivativeKeyFor(localPath, width);
    if (!key) return null;
    const object = await env.UPLOADS.get(key);
    if (object) return { body: object.body, contentType: object.httpMetadata?.contentType || 'image/webp' };
  }
  return null;
}

export async function handleSafeMediaRoute(request, env, url, ctx) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorJson('Bulunamadı', 404);
  const mediaId = decodeURIComponent(url.pathname.slice(SAFE_MEDIA_PREFIX.length));
  if (!mediaId || !MEDIA_ID_RE.test(mediaId)) return errorJson('Bulunamadı', 404);

  const epoch = await rightsEpoch(env);
  const cacheKey = new Request(`${url.origin}${url.pathname}?__rv=${encodeURIComponent(epoch)}`, { method: 'GET' });
  let cache = null;
  try { cache = caches.default; } catch { /* yerel wrangler dev'de Cache API olmayabilir */ }
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) return request.method === 'HEAD' ? new Response(null, { status: hit.status, headers: hit.headers }) : hit;
    } catch { /* okunamazsa aşağıdaki taze yola düş */ }
  }

  const fallback = parseFallbackMediaId(mediaId);
  let row = null;
  let project = null;

  if (fallback) {
    // EMNİYET BİÇİMİ — hak satırı olmayan bir görsel. Bu daldan ASLA "izin verildi" çıkmaz:
    // orijinali serbest bırakma kararı yalnızca gerçek bir media_rights satırından doğabilir.
    project = await env.DB.prepare(
      `SELECT id, images, is_copyright_approved, deleted_at, hidden_at FROM projects WHERE id = ?`
    ).bind(fallback.projectId).first();
    if (!project || project.deleted_at || project.hidden_at) return errorJson('Bulunamadı', 404);
    let images = [];
    try { images = project.images ? JSON.parse(project.images) : []; } catch { images = []; }
    const raw = images[fallback.index];
    const localPath = normalizeMediaPath(raw);
    if (!localPath) return placeholderResponse();
    const safe = await readSafeBytes(env, localPath);
    const response = safe
      ? new Response(safe.body, { status: 200, headers: imageHeaders(safe.contentType, SAFE_CACHE_SECONDS, SAFE_EDGE_CACHE_SECONDS) })
      : placeholderResponse();
    return finish(request, response, cache, cacheKey, ctx);
  }

  row = await env.DB.prepare(
    `SELECT m.id, m.entity_type, m.entity_id, m.media_url, m.media_path, m.rights_status,
            m.public_original_allowed, p.is_copyright_approved, p.deleted_at, p.hidden_at
       FROM media_rights m
       LEFT JOIN projects p ON m.entity_type = 'project' AND p.id = m.entity_id
      WHERE m.id = ?`
  ).bind(mediaId).first();
  if (!row) return errorJson('Bulunamadı', 404);
  // Silinmiş/gizlenmiş projenin medyası hiçbir biçimde (güvenli sürüm dahil) servis edilmez.
  if (row.deleted_at || row.hidden_at) return errorJson('Bulunamadı', 404);
  // 'removed' = takedown. Güvenli sürüm bile verilmez (bkz. kullanıcı isteği madde 11: içerik
  // "tamamen gizlenebilir"); yükte zaten hiç görünmez (bkz. applyProjectImageRights).
  if (row.rights_status === 'removed') return errorJson('Bulunamadı', 404);

  const localPath = row.media_path || normalizeMediaPath(row.media_url);
  if (!localPath) {
    // Harici (başka host) bir görsel: baytları bizde değil, güvenli sürümünü üretemeyiz. Kilitliyse
    // yer tutucu döner — harici URL'i istemciye vermek, kilidi anlamsız kılardı.
    return finish(request, placeholderResponse(), cache, cacheKey, ctx);
  }

  const allowed = isOriginalPublic(row, Number(row.is_copyright_approved) === 1);
  if (allowed) {
    const original = await readLocalBytes(env, request, localPath);
    if (original) {
      const response = new Response(original.body, { status: 200, headers: imageHeaders(original.contentType, ORIGINAL_CACHE_SECONDS, SAFE_EDGE_CACHE_SECONDS) });
      return finish(request, response, cache, cacheKey, ctx);
    }
  }

  const safe = await readSafeBytes(env, localPath);
  const response = safe
    ? new Response(safe.body, { status: 200, headers: imageHeaders(safe.contentType, SAFE_CACHE_SECONDS, SAFE_EDGE_CACHE_SECONDS) })
    : placeholderResponse();
  return finish(request, response, cache, cacheKey, ctx);
}

function finish(request, response, cache, cacheKey, ctx) {
  if (cache && response.status === 200) {
    const toCache = response.clone();
    const put = cache.put(cacheKey, toCache).catch(() => {});
    if (ctx) ctx.waitUntil(put);
  }
  if (request.method === 'HEAD') return new Response(null, { status: response.status, headers: response.headers });
  return response;
}
