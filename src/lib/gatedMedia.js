// GATED GÖRSELLER — sunucu tarafı blur (kullanıcı isteği, 2026-09-11: "Blurlasan bile sağ tıklayıp
// görseli yeni sekmeden aç deyince ya da indirme eklentisi çalıştırınca görselleri görebiliyoruz;
// bunları da engelle — ama profil sahiplenince blurlar kalkıp sistem normale dönmeli").
//
// KÖK NEDEN: CSS blur (.preview-blur / .ml-photo-blur) yalnızca EKRANDA; /media/... ve statik
// görsel adresleri NET baytları servis ediyordu. Cloudflare görsel dönüşümü bu zone'da KAPALI
// (/cdn-cgi/image 404, bkz. wrangler.jsonc'deki kalıcı karar) ve Workers'ta decode/kodek yok —
// istek anında bulanıklaştırma imkânsız. Bu yüzden:
//   1. Gated her görsel için önceden üretilmiş küçük+bulanık bir türev R2'de durur:
//      `_derived/blur/<r2|s>/<yol>.webp` (scripts/backfill-blur-derivatives.py mevcut kayıtlar
//      için; yeni yüklemelerde tarayıcı üretir, bkz. image-upload.js + derivativeIngest.js#dblur).
//   2. Worker, GATED bir görsele giden HER isteği (orijinal /media/<k>, herhangi bir /media/_derived/
//      wN/... basamağı, statik /miras|projects|mimarlar|logos/... yolu) bu türeve yönlendirir.
//      Türev henüz yoksa NET dosya ASLA verilmez — nötr bir SVG placeholder döner.
//   3. Gated yanıtlar `Cache-Control: no-store`: sahiplenme onaylanınca (kayıt gated kümeden
//      düşünce) ne tarayıcı ne edge eski bulanık kopyayı tutar; net dosya yine normal, immutable
//      yolundan gelir. Net yanıtlar ise HİÇ önbelleklenmeden önce burada kontrol edildiğinden
//      (fetch handler'ın başı — handleMediaRoute'un caches.default araması bundan SONRA) edge'de
//      bekleyen eski bir net kopya gated bir kayda sızamaz.
//
// GATED KÜME = önizleme (preview_at DOLU) projelerin/ürünlerin (versiyon görselleri dahil)/
// firmaların (logo+kapak)/kişilerin (fotoğraf) görselleri + sahiplenilmemiş fotoğrafçıların profil
// fotoğrafları (src/lib/claimedProfiles.js#fetchUnclaimedPhotographers — /api/public/preview
// #photographerBlur ile AYNI kural). İzole başına 120 sn'lik memo + Cache API'de 300 sn (KV YAZMAZ:
// günlük KV yazma kotası tükeniyor, bkz. kv_quota_exhausted). invalidatePublicCache() her içerik
// mutasyonunda (sahiplenme onayı, arşiv/yayın) memo+cache'i düşürür — blur en geç 5 dk içinde,
// aynı PoP'ta anında kalkar.
//
// ANAHTAR NORMALİZASYONU scripts/backfill-blur-derivatives.py#normalize_image_key ile BİREBİR
// AYNI olmalı — ayrışırlarsa türev başka bir anahtara yazılır, Worker onu bulamaz ve placeholder
// servis eder (yine sızıntı olmaz ama görsel kaybolur).
const SITE_HOSTS = new Set(['mimarlab.com', 'www.mimarlab.com']);
const IMAGE_PATH_RE = /\.(jpe?g|png|webp|avif|gif)$/i;
const DERIVED_PATH_RE = /^\/media\/_derived\/w\d+\/(r2|s)\/(.+)$/;
const BLUR_PATH_RE = /^\/media\/_derived\/blur\//;
const MEMO_TTL_MS = 120 * 1000;
const CACHE_TTL_S = 300;
const CACHE_KEY_URL = 'https://mimarlab.com/__internal/gated-media-set';

// "r2:<anahtar>" | "s:<statik yol>" | null (dış host / data URL / boş).
export function normalizeImageKey(path) {
  if (typeof path !== 'string') return null;
  let p = path.trim();
  if (!p || p.startsWith('data:') || p.startsWith('blob:')) return null;
  if (p.startsWith('//')) p = `https:${p}`;
  if (/^https?:\/\//i.test(p)) {
    try {
      const u = new URL(p);
      if (!SITE_HOSTS.has(u.hostname)) return null;
      p = u.pathname;
    } catch { return null; }
  }
  try { p = decodeURIComponent(p); } catch { /* bozuk encoding — olduğu gibi */ }
  p = p.replace(/^\/+/, '');
  if (!p) return null;
  if (p.startsWith('media/')) return `r2:${p.slice('media/'.length)}`;
  return `s:${p}`;
}

// İstek yolundan aynı anahtar: /media/<k>, /media/_derived/wN/(r2|s)/<p>, statik görsel /<p>.
// Görsel olmayan yollar (sayfalar, JS, API) null.
export function keyForRequestPath(pathname) {
  let path;
  try { path = decodeURIComponent(pathname); } catch { return null; }
  if (BLUR_PATH_RE.test(path)) return null; // blur türevinin kendisi hiçbir zaman gated değildir
  const derived = DERIVED_PATH_RE.exec(path);
  if (derived) return `${derived[1]}:${derived[2]}`;
  if (path.startsWith('/media/')) return `r2:${path.slice('/media/'.length)}`;
  if (IMAGE_PATH_RE.test(path)) return `s:${path.replace(/^\/+/, '')}`;
  return null;
}

export function blurDerivativeKey(imageKey) {
  const i = imageKey.indexOf(':');
  return `_derived/blur/${imageKey.slice(0, i)}/${imageKey.slice(i + 1)}.webp`;
}

function parseList(raw) {
  try { const v = JSON.parse(raw || 'null'); return Array.isArray(v) ? v : []; } catch { return []; }
}

// Gated görsel URL'lerini D1'den toplar — backfill betiği ile AYNI kaynaklar/sıra.
export async function fetchGatedImageKeys(env, fetchUnclaimedPhotographers) {
  const urls = [];
  const [projects, products, offices, architects] = await Promise.all([
    env.DB.prepare(`SELECT images FROM projects WHERE preview_at IS NOT NULL AND deleted_at IS NULL`).all(),
    env.DB.prepare(`SELECT images, variants FROM products WHERE preview_at IS NOT NULL AND deleted_at IS NULL`).all(),
    env.DB.prepare(`SELECT logo_url, cover_url FROM offices WHERE preview_at IS NOT NULL AND deleted_at IS NULL`).all(),
    env.DB.prepare(`SELECT photo_url FROM architects WHERE preview_at IS NOT NULL AND deleted_at IS NULL`).all(),
  ]);
  for (const r of projects.results || []) urls.push(...parseList(r.images));
  for (const r of products.results || []) {
    urls.push(...parseList(r.images));
    for (const v of parseList(r.variants)) urls.push(...((v && Array.isArray(v.images)) ? v.images : []));
  }
  for (const r of offices.results || []) urls.push(r.logo_url, r.cover_url);
  for (const r of architects.results || []) urls.push(r.photo_url);
  if (fetchUnclaimedPhotographers) {
    for (const p of await fetchUnclaimedPhotographers(env)) urls.push(p.photo_url);
  }
  const keys = new Set();
  for (const u of urls) { const k = normalizeImageKey(u); if (k) keys.add(k); }
  return keys;
}

let memo = { set: null, at: 0 };
let inFlight = null;

async function loadGatedImageSet(env, deps) {
  const now = Date.now();
  if (memo.set && now - memo.at < MEMO_TTL_MS) return memo.set;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      let cache = null;
      try { cache = caches.default; } catch { /* yerel dev */ }
      const cacheKey = new Request(CACHE_KEY_URL, { method: 'GET' });
      if (cache) {
        try {
          const hit = await cache.match(cacheKey);
          if (hit) {
            const arr = await hit.json();
            if (Array.isArray(arr)) { memo = { set: new Set(arr), at: Date.now() }; return memo.set; }
          }
        } catch { /* okunamadıysa D1'den kur */ }
      }
      const set = await fetchGatedImageKeys(env, deps && deps.fetchUnclaimedPhotographers);
      memo = { set, at: Date.now() };
      if (cache) {
        try {
          await cache.put(cacheKey, new Response(JSON.stringify([...set]), {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_TTL_S}` },
          }));
        } catch { /* önbelleğe yazılamaması davranışı değiştirmez */ }
      }
      return set;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

// invalidatePublicCache() çağırır — memo ve bu PoP'un Cache API girdisi düşer.
export async function invalidateGatedMediaCache() {
  memo = { set: null, at: 0 };
  try { await caches.default.delete(new Request(CACHE_KEY_URL, { method: 'GET' })); } catch { /* yerel dev */ }
}

// Nötr placeholder — türev henüz üretilmemiş gated görsel için. Net dosya HİÇBİR koşulda verilmez.
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 36" width="48" height="36"><defs><radialGradient id="g" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#c9cfd6"/><stop offset="1" stop-color="#9aa3ae"/></radialGradient></defs><rect width="48" height="36" fill="url(#g)"/></svg>`;

const GATED_HEADERS_BASE = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-ML-Gated': '1',
};

// fetch handler'ın BAŞINDA çağrılır (bkz. src/index.js) — gated bir görsel isteğiyse Response döner,
// değilse null ve normal yol devam eder. deps.fetchUnclaimedPhotographers dışarıdan geçirilir
// (claimedProfiles.js bu modülü import etmesin diye — döngü olmasın).
export async function serveGatedMedia(request, env, url, deps) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  if (!env || !env.DB || !env.UPLOADS) return null;
  const key = keyForRequestPath(url.pathname);
  if (!key) return null;
  let set;
  try { set = await loadGatedImageSet(env, deps); } catch { return null; } // küme okunamadıysa normal yol
  if (!set.has(key)) return null;

  let object = null;
  try { object = await env.UPLOADS.get(blurDerivativeKey(key)); } catch { object = null; }
  if (object) {
    const headers = new Headers({ ...GATED_HEADERS_BASE, 'Content-Type': 'image/webp' });
    if (typeof object.size === 'number') headers.set('Content-Length', String(object.size));
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
    return new Response(object.body, { status: 200, headers });
  }
  const headers = new Headers({ ...GATED_HEADERS_BASE, 'Content-Type': 'image/svg+xml' });
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(PLACEHOLDER_SVG, { status: 200, headers });
}

// Testler için: memo'yu sıfırla.
export function _resetGatedMediaMemo() { memo = { set: null, at: 0 }; inFlight = null; }
