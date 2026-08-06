import { errorJson } from './lib/http.js';
import { buildMeta, listEntityUrls } from './lib/seo.js';
import { handleAuthRoute, handleProfileRoute } from './routes/auth.js';
import { handleSubmissionRoute } from './routes/submissions.js';
import { handlePublicRoute } from './routes/public.js';
import { handleArchitectRoute, handleArchitectSearchRoute, handleArchitectListRoute } from './routes/architect.js';
import { handleOfficeRoute, handleOfficeSearchRoute, handleOfficeListRoute } from './routes/office.js';
import { handleProjectDetailRoute, handleProjectFiltersRoute, handleProjectListRoute } from './routes/project.js';
import { handleProductDetailRoute, handleProductListRoute } from './routes/product.js';
import { handleFacetsRoute } from './routes/facets.js';
import { handleAdminRoute } from './routes/admin.js';
import { handleSelfProjectDelete } from './routes/legacyContent.js';
import { handleUploadRoute, handleMediaRoute } from './routes/upload.js';
import { handleCommentsRoute } from './routes/comments.js';
import { handleSavedRoute } from './routes/saved.js';
import { handleRatingsRoute } from './routes/ratings.js';
import { handleClaimsRoute, handleCorrectionsRoute } from './routes/claims.js';
import { handleBadgesRoute, handlePublicBadges } from './routes/badges.js';
import { handlePaymentsRoute } from './routes/payments.js';
import { handleContactRoute } from './routes/contact.js';
import { handleNotificationsRoute } from './routes/notifications.js';
import { slugify } from './lib/slugify.js';
import { SSR_CACHE_VERSION } from './lib/ssrCache.js';

const SITE_ORIGIN = 'https://mimarlab.com';

// X-Frame-Options bilerek DENY olarak korunuyor (spec Faz 5'in önerdiği SAMEORIGIN yerine) — sitede
// hiçbir yerde <iframe>/<frame> kullanılmıyor (bkz. depo çapında arama), yani kendi kendini
// çerçeveleme ihtiyacı yok; DENY, SAMEORIGIN'in sağladığı hiçbir işlevsellik kaybı olmadan strictly
// daha güvenli. Strict-Transport-Security kasıtlı olarak includeSubDomains/preload İÇERMİYOR (bkz.
// kullanıcı isteği) — tüm alt alan adlarının HTTPS desteği doğrulanmadan bunlar geri dönüşü zor bir
// risk taşır (preload listesine girmek ayları bulan bir kaldırma süreci gerektirir, includeSubDomains
// HTTPS'siz bir alt alan adını anında kırar).
// Report-Only CSP — repo çapında origin taraması (script/link/fetch/iframe) sonucu: Google
// Fonts (fonts.googleapis.com/fonts.gstatic.com), Google Tag Manager (gtag.js + GA4 collect
// uçları), ve site genelindeki HTML sayfalarının kendi inline <script>/<style> bloklarından
// (bu depoda henüz nonce/hash altyapısı yok, script-src/style-src bu yüzden 'unsafe-inline'
// içeriyor — bu ilk denetim aşamasında hiçbir şeyi bloklamamak öncelikli, sıkılaştırma ayrı
// bir adım). Google/LinkedIn OAuth ve iyzico ödeme sayfası ikisi de düz <a href>/window.location
// İLE üst seviye yönlendirme (top-level navigation) — CSP bunu kısıtlamaz, bu yüzden connect-src/
// form-action'a ayrıca eklenmedi. Sitede hiçbir <iframe> yok (bkz. X-Frame-Options: DENY yorumu),
// frame-src/object-src bu yüzden 'none'. BİLEREK sadece Report-Only: canlıda hiçbir kaynağı
// bloklamaz, yalnızca ihlalleri tarayıcı konsoluna loglar — enforce moduna geçiş ayrı bir karar.
const CONTENT_SECURITY_POLICY_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000',
  'Content-Security-Policy-Report-Only': CONTENT_SECURITY_POLICY_REPORT_ONLY,
};

// Temiz URL yapısı: eski ?param= sorgu dizesi yerine yol tabanlı adresler (SEO ve paylaşılabilirlik
// için, bkz. kullanıcı isteği). Cloudflare Assets zaten .html uzantısını otomatik kaldırıyor
// (html_handling varsayılanı auto-trailing-slash) — burada yalnızca sorgu parametresini yol
// segmentine taşıyoruz. Mimar/marka isimleri slugify edilir (save-widget.js/src/lib/slugify.js ile
// birebir aynı algoritma); proje slug'ı ve haber id'si zaten URL-güvenli olduğundan dönüştürülmez.
const CLEAN_URL_REDIRECTS = {
  '/proje-detay': { param: 'proje', prefix: '/projeler/', slugifyValue: false },
  '/mimar-detay': { param: 'mimar', prefix: '/mimar/', slugifyValue: true },
  '/ofis-detay': { param: 'ofis', prefix: '/firma/', slugifyValue: true },
  '/haber-detay': { param: 'haber', prefix: '/haberler/', slugifyValue: false },
};
// Yeni temiz yol önekini, aynı içeriği render eden gerçek statik HTML dosyasına eşler — istemci
// tarafındaki sayfa JS'i slug'ı URL yolundan okuyacak şekilde ayrıca güncellenmiştir (bkz. ilgili
// *-detay.html dosyalarındaki path-tabanlı fallback lookup). Uzantısız yol kullanılır çünkü
// env.ASSETS.fetch'e ".html" ile biten bir istek verilirse Cloudflare Assets kendi html_handling
// (auto-trailing-slash) davranışıyla bunu tekrar uzantısız hale 301 yönlendirir — bu da orijinal
// /projeler/:slug isteğimizin path bilgisini kaybederdi; uzantısız istemek doğrudan içeriği döner.
const CLEAN_URL_ASSETS = [
  // /projeler/:slug, /mimar/:slug, /firma/:slug, /urun/:slug artık kendi listeleme sayfalarına
  // eşleniyor (proje-detay.html/mimar-detay.html/ofis-detay.html/urun-detay.html kaldırıldı) — her
  // sayfa kendi JS'inde bu yolu algılayıp ilgili modalı (ProjectModal/ArchitectModal/OfficeModal/
  // ProductModal, bkz. js/components/) doğrudan açar, injectMeta() ise AYNI HTMLRewriter
  // mekanizmasıyla o listeleme sayfasının <head>'indeki id'li meta etiketlerini hedefler (bkz.
  // proje.html/mimar.html/firma.html/urun.html#meta-description vb.).
  { prefix: '/projeler/', asset: '/proje', type: 'project' },
  { prefix: '/mimar/', asset: '/mimar', type: 'architect' },
  { prefix: '/firma/', asset: '/firma', type: 'office' },
  { prefix: '/urun/', asset: '/urun', type: 'product' },
  { prefix: '/haberler/', asset: '/haber-detay', type: 'news' },
];

// Sayfa yeniden adlandırmaları (301) — eski URL/dosya adı kaldırılıp yerine yenisi geçtiğinde
// (bkz. kullanıcı isteği: /ofis -> /firma, Malzeme'nin Ürün'e taşınması) eski bağlantıların/
// yer imlerinin kırılmaması için. Hem uzantısız hem ".html" biten biçim eşlenir.
const PATH_RENAME_REDIRECTS = {
  '/ofis': '/firma',
  '/ofis.html': '/firma',
  '/ofis-ekle': '/firma-ekle',
  '/ofis-ekle.html': '/firma-ekle',
  '/malzeme': '/urun',
  '/malzeme.html': '/urun',
  '/malzeme-ekle': '/urun-ekle',
  '/malzeme-ekle.html': '/urun-ekle',
};

// Eski /markalar/:slug firma detay URL'leri artık /firma/:slug (bkz. kullanıcı isteği: SEO/backlink
// koruması) — yukarıdaki PATH_RENAME_REDIRECTS'in aksine slug segmenti dinamik olduğundan tam eşleşme
// yerine önek (prefix) bazlı yönlendirme gerekiyor; slug/sorgu string'i olduğu gibi korunur. Aynı
// desenle eski /urunler/:key ürün detay URL'leri de artık /urun/:key'e (bkz. kullanıcı isteği: ürün
// modalının URL öneki /urun olsun) — bu kontrol routeAsset() içinde CLEAN_URL_ASSETS eşleşmesinden
// ÖNCE çalıştığından eski linkler önce yeni öneke 301'lenir, sonra normal şekilde servis edilir.
const PREFIX_RENAME_REDIRECTS = [
  { from: '/markalar/', to: '/firma/' },
  { from: '/urunler/', to: '/urun/' },
];

// Statik (build adımı olmayan) üst seviye sayfalar — bkz. eski kök dizindeki sitemap.xml (artık
// /sitemap.xml Worker route'u tarafından üretiliyor, bu dosya kaldırıldı).
const SITEMAP_STATIC_PAGES = [
  { loc: '/', changefreq: 'daily', priority: '1.0' },
  { loc: '/mimar', changefreq: 'daily', priority: '0.9' },
  { loc: '/firma', changefreq: 'daily', priority: '0.9' },
  { loc: '/proje', changefreq: 'daily', priority: '0.9' },
  { loc: '/urun', changefreq: 'weekly', priority: '0.7' },
  { loc: '/haber', changefreq: 'daily', priority: '0.7' },
  { loc: '/is-ilani', changefreq: 'daily', priority: '0.7' },
  { loc: '/hakkinda', changefreq: 'monthly', priority: '0.5' },
  { loc: '/iletisim', changefreq: 'monthly', priority: '0.5' },
  { loc: '/kariyer', changefreq: 'monthly', priority: '0.4' },
  { loc: '/reklam', changefreq: 'monthly', priority: '0.3' },
];

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|avif|gif|svg)$/i;
// Repo'ya gömülü statik görseller (logos/, mimarlar/, projects/, miras/) aynı path'te üzerine
// yazılabildiği için tam `immutable` değil — 7 gün tarayıcı + 30 gün stale-while-revalidate.
// /media/* (R2 upload) zaten UUID key'li, gerçekten immutable ve handleMediaRoute'ta ayrıca ayarlı.
const STATIC_IMAGE_CACHE_HEADERS = { 'Cache-Control': 'public, max-age=604800, stale-while-revalidate=2592000' };
// SSR enjeksiyonu yapılmış detay sayfaları için: kısa tarayıcı cache'i + edge'de daha uzun ömür.
// Ayrıca Cache API (caches.default) ile edge'e de yazılıyor (bkz. serveDetailPage) — yüksek
// trafikte her istek ASSETS.fetch + HTMLRewriter çalıştırmak zorunda kalmaz. s-maxage önceden 3600
// (1 saat) idi; admin bir kaydı değiştirdiğinde artık aynı anda purgeSsrDetailCache (bkz. src/lib/
// ssrCache.js) çağrılıyor olsa da caches.default PoP-başına olduğundan bu yalnızca YAZMA isteğini
// işleyen edge node'u temizler — başka bir PoP'taki eski girdi kendi süresi dolana kadar yaşar
// (bkz. publicCache.js#ANON_CACHE_HEADERS'taki aynı gerekçeyle önceden 300'den 15'e indirilmesi).
// 300'e (5 dk) indirmek, purge'ün kaçırdığı PoP'lar için de en kötü durumdaki bayatlık penceresini
// makul bir aralığa çeker.
const SSR_PAGE_CACHE_HEADERS = { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400' };
const SITEMAP_CACHE_HEADERS = { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=21600' };

// Cache API girdileri deploy'dan bağımsızdır — kod/şablon değiştiğinde eski deploy'dan kalan
// cache girdileri otomatik geçersizleşmez (s-maxage boyunca eski HTML sunulmaya devam eder).
// injectMeta()/*-detay.html şablonlarından biri değiştiğinde bu değeri artırmak, gerçek istek
// URL'sini DEĞİŞTİRMEDEN yalnızca cache anahtarını değiştirip önceki girdileri "yetim" bırakarak
// (silmeye gerek kalmadan) anında geçersiz kılar. Tek kaynak src/lib/ssrCache.js'te — admin bir
// kaydı değiştirdiğinde o dosyadaki purgeSsrDetailCache AYNI anahtarı hedef alır (bkz. o dosyadaki
// yorum).
// (SSR_CACHE_VERSION yukarıda src/lib/ssrCache.js'ten import edilir.)

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let response;
    if (url.pathname.startsWith('/api/')) {
      try {
        response = await routeApi(request, env, url);
      } catch (err) {
        console.error(err);
        response = errorJson('Sunucu hatası oluştu.', 500);
      }
    } else if (url.pathname.startsWith('/media/')) {
      response = await handleMediaRoute(request, env, url);
    } else if (url.pathname === '/sitemap.xml') {
      response = await handleSitemapRoute(request, env, ctx);
    } else {
      response = await routeAsset(request, env, url, ctx);
    }
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};

async function routeAsset(request, env, url, ctx) {
  const renameTarget = PATH_RENAME_REDIRECTS[url.pathname];
  if (renameTarget) {
    const dest = new URL(renameTarget, url.origin);
    dest.search = url.search;
    return Response.redirect(dest.href, 301);
  }

  const prefixRename = PREFIX_RENAME_REDIRECTS.find(r => url.pathname.startsWith(r.from) && url.pathname.length > r.from.length);
  if (prefixRename) {
    const dest = new URL(prefixRename.to + url.pathname.slice(prefixRename.from.length), url.origin);
    dest.search = url.search;
    return Response.redirect(dest.href, 301);
  }

  const redirectKey = url.pathname.replace(/\.html$/, '');
  const redirectRule = CLEAN_URL_REDIRECTS[redirectKey];
  const paramVal = redirectRule ? url.searchParams.get(redirectRule.param) : null;
  if (redirectRule && paramVal) {
    const slugValue = redirectRule.slugifyValue ? slugify(paramVal) : paramVal;
    const dest = new URL(redirectRule.prefix + encodeURIComponent(slugValue), url.origin);
    return Response.redirect(dest.href, 301);
  }

  const cleanRoute = CLEAN_URL_ASSETS.find(r => url.pathname.startsWith(r.prefix) && url.pathname.length > r.prefix.length);
  if (cleanRoute) return serveDetailPage(request, env, url, cleanRoute, ctx);

  const response = await env.ASSETS.fetch(request);
  return withStaticImageCacheHeaders(url, response);
}

function withStaticImageCacheHeaders(url, response) {
  if (response.status !== 200 || !IMAGE_EXT_RE.test(url.pathname)) return response;
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(STATIC_IMAGE_CACHE_HEADERS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// /mimar/:slug, /firma/:slug, /projeler/:slug, /haberler/:id — statik şablonu ASSETS'ten alır,
// slug data.js/projeler-data.js/haberler-data.js'te bulunuyorsa title/meta/OG/Twitter/JSON-LD'yi
// HTMLRewriter ile (Google/sosyal medya botları JS çalıştırmadan da) doğru değerlerle değiştirir.
// Bulunamazsa (ör. yalnızca D1'de var olan, henüz bu detay sayfalarını desteklemeyen bir kayıt)
// şablonu olduğu gibi döner — mevcut davranışta regresyon yok.
async function serveDetailPage(request, env, url, cleanRoute, ctx) {
  const isGet = request.method === 'GET';
  // Yalnızca cache.match/put anahtarı için kullanılır — gerçek istek/yanıt URL'si (ve dolayısıyla
  // canonical/OG URL'leri) etkilenmez, bkz. SSR_CACHE_VERSION yorumu.
  const cacheKeyRequest = isGet ? withVersionedCacheKey(request, url) : null;
  if (cacheKeyRequest) {
    const cached = await cacheMatch(cacheKeyRequest);
    if (cached) return cached;
  }

  const assetUrl = new URL(url);
  assetUrl.pathname = cleanRoute.asset;
  const assetResponse = await env.ASSETS.fetch(new Request(assetUrl, request));

  const rawSlug = decodeURIComponent(url.pathname.slice(cleanRoute.prefix.length).replace(/\/$/, ''));
  const meta = rawSlug ? await buildMeta(cleanRoute.type, rawSlug, env) : null;
  if (!meta || assetResponse.status !== 200) return assetResponse;

  const rewritten = injectMeta(assetResponse, meta);
  const headers = new Headers(rewritten.headers);
  for (const [k, v] of Object.entries(SSR_PAGE_CACHE_HEADERS)) headers.set(k, v);
  const finalResponse = new Response(rewritten.body, { status: rewritten.status, statusText: rewritten.statusText, headers });

  if (cacheKeyRequest && ctx) ctx.waitUntil(cachePut(cacheKeyRequest, finalResponse.clone()));
  return finalResponse;
}

function withVersionedCacheKey(request, url) {
  const keyUrl = new URL(url);
  keyUrl.searchParams.set('__cv', SSR_CACHE_VERSION);
  return new Request(keyUrl, request);
}

// caches.default yalnızca https istekleri için çalışır ve bazı ortamlarda (ör. yerel `wrangler dev`
// http://localhost) hata fırlatabilir — cache tamamen opsiyonel bir hızlandırma katmanı olduğundan
// bir hata sayfayı bozmamalı, sessizce "cache yok" gibi davranıyoruz.
async function cacheMatch(request) {
  try { return await caches.default.match(request); } catch { return undefined; }
}
async function cachePut(request, response) {
  try { await caches.default.put(request, response); } catch {}
}

function injectMeta(response, meta) {
  // </script> içeren bir değer HTML'e ham olarak enjekte edilirse script bağlamından çıkabilir;
  // JSON-LD içeriği data.js/projeler-data.js/haberler-data.js'ten (site sahibi kontrolünde) geldiği
  // için düşük risk ama yine de savunmacı olarak escape ediyoruz (bkz. XSS escaping convention).
  const ldJson = JSON.stringify(meta.jsonLd).replace(/</g, '\\u003c');
  // BreadcrumbList (bkz. src/lib/seo.js#breadcrumbJsonLd) — yalnızca meta üreticisi bunu döndürdüyse
  // (tüm tipler için geçerli) ayrı bir <script> bloğu olarak eklenir; ayrı blok kullanmak (tek bir
  // @graph yerine) Google'ın çoklu JSON-LD bloklarını sayfa başına desteklemesiyle tutarlı ve mevcut
  // ana jsonLd şeklini bozmaz.
  const breadcrumbScript = meta.breadcrumbJsonLd
    ? `<script type="application/ld+json">${JSON.stringify(meta.breadcrumbJsonLd).replace(/</g, '\\u003c')}</script>`
    : '';
  return new HTMLRewriter()
    .on('title', { element(el) { el.setInnerContent(meta.title); } })
    .on('meta#meta-description', { element(el) { el.setAttribute('content', meta.description); } })
    .on('link#canonical-link', { element(el) { el.setAttribute('href', meta.canonicalUrl); } })
    .on('meta#og-title', { element(el) { el.setAttribute('content', meta.title); } })
    .on('meta#og-description', { element(el) { el.setAttribute('content', meta.description); } })
    .on('meta#og-url', { element(el) { el.setAttribute('content', meta.canonicalUrl); } })
    .on('meta#og-image', { element(el) { el.setAttribute('content', meta.image); } })
    .on('meta#twitter-title', { element(el) { el.setAttribute('content', meta.title); } })
    .on('meta#twitter-description', { element(el) { el.setAttribute('content', meta.description); } })
    .on('meta#twitter-image', { element(el) { el.setAttribute('content', meta.image); } })
    .on('head', { element(el) { el.append(`<script type="application/ld+json">${ldJson}</script>${breadcrumbScript}`, { html: true }); } })
    .transform(response);
}

async function handleSitemapRoute(request, env, ctx) {
  const cached = await cacheMatch(request);
  if (cached) return cached;

  // listEntityUrls() yalnızca statik data.js/projeler-data.js/haberler-data.js dizilerini okur —
  // Faz 3 migrasyonundan sonra yalnızca canonical D1'de yaşayan (admin panelinden eklenmiş) mimar/
  // ofis/proje/ürün kayıtları bu dizilerde HİÇ görünmez, dolayısıyla sitemap'te de eksik kalırdı
  // (bkz. kullanıcı isteği: "sitemap.xml ... eksiksiz servis edildiğinden emin ol" — gerçek bulgu).
  // İki kaynak da bir Set üzerinden birleştirilip aynı slug için TEKİL bir <url> üretilir.
  const entityUrls = new Set([...listEntityUrls(), ...await listCanonicalEntityUrls(env)]);
  const urls = [
    ...SITEMAP_STATIC_PAGES.map(p => `  <url>\n    <loc>${SITE_ORIGIN}${p.loc}</loc>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`),
    ...[...entityUrls].map(loc => `  <url>\n    <loc>${SITE_ORIGIN}${loc}</loc>\n    <changefreq>monthly</changefreq>\n  </url>`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
  const response = new Response(xml, { status: 200, headers: { 'Content-Type': 'application/xml; charset=utf-8', ...SITEMAP_CACHE_HEADERS } });

  if (ctx) ctx.waitUntil(cachePut(request, response.clone()));
  return response;
}

// listEntityUrls (yalnızca statik diziler) ile birleştirilen canonical D1 kaynağı — architects/
// offices/projects/products tablolarının TAMAMI (statik + admin panelinden eklenenler) buradan
// gelir. products, listEntityUrls()'te hiç yoktu (ürün/malzeme detay sayfaları sitemap'te hiç
// listelenmiyordu) — buildMeta('product', ...) SSR meta'sı zaten destekliyor (bkz. src/lib/seo.js#
// buildProductMeta), yalnızca sitemap'e eklenmemişti.
async function listCanonicalEntityUrls(env) {
  if (!env || !env.DB) return [];
  const where = `deleted_at IS NULL AND hidden_at IS NULL`;
  const [archRes, officeRes, projRes, prodRes] = await Promise.all([
    env.DB.prepare(`SELECT slug FROM architects WHERE ${where}`).all(),
    env.DB.prepare(`SELECT slug FROM offices WHERE ${where}`).all(),
    env.DB.prepare(`SELECT slug FROM projects WHERE ${where}`).all(),
    env.DB.prepare(`SELECT slug FROM products WHERE ${where}`).all(),
  ]);
  return [
    ...archRes.results.map(r => `/mimar/${encodeURIComponent(r.slug)}`),
    ...officeRes.results.map(r => `/firma/${encodeURIComponent(r.slug)}`),
    ...projRes.results.map(r => `/projeler/${encodeURIComponent(r.slug)}`),
    ...prodRes.results.map(r => `/urun/${encodeURIComponent(r.slug)}`),
  ];
}

async function routeApi(request, env, url) {
  const path = url.pathname;
  if (path.startsWith('/api/auth/')) return handleAuthRoute(request, env, url);
  if (path === '/api/profile') return handleProfileRoute(request, env, url);
  if (path === '/api/uploads') return handleUploadRoute(request, env);
  if (path === '/api/contact') return handleContactRoute(request, env, url);
  if (path.startsWith('/api/admin/')) return handleAdminRoute(request, env, url);
  if (path === '/api/public/badges') return handlePublicBadges(env);
  if (path.startsWith('/api/public/')) return handlePublicRoute(request, env, url);
  // Faz 1 — mimar-detay.html/ofis-detay.html/proje.html'nin eskiden istemci tarafında yaptığı
  // statik veri + onaylı gönderi overlay birleştirmesinin sunucu tarafı karşılığı (bkz.
  // docs/architecture-roadmap.md). Tekil (architect/office/project/product) yollar, aşağıdaki
  // /api/architects, /api/offices, /api/projects, /api/products ÇOĞUL gönderi CRUD uçlarıyla
  // (handleSubmissionRoute) ÇAKIŞMAZ — yalnızca /api/projects/filters, /api/projects prefix'iyle
  // başladığından o genel eşleşmeden ÖNCE burada özel olarak yakalanmalı.
  if (path === '/api/projects/filters') return handleProjectFiltersRoute(request, env, url);
  // proje.html/mimar.html/firma.html/urun.html'in yeni sayfalanmış (?page=&limit=) liste uçları —
  // BARE /api/projects/architects/offices/products, method GET iken buraya düşer; aynı path'lere
  // POST (yeni gönderi oluşturma) her zaman aşağıdaki handleSubmissionRoute'a gider (bkz. o dosyadaki
  // segments.length===2 dalı, yalnızca POST'u işliyor — GET için hiçbir dal eşleşmediğinden bu
  // path'ler GET için önceden zaten boştu, çakışma yok).
  if (path === '/api/projects' && request.method === 'GET') return handleProjectListRoute(request, env, url);
  if (path === '/api/architects' && request.method === 'GET') return handleArchitectListRoute(request, env, url);
  if (path === '/api/offices' && request.method === 'GET') return handleOfficeListRoute(request, env, url);
  if (path === '/api/products' && request.method === 'GET') return handleProductListRoute(request, env, url);
  // /api/architects, /api/offices ÇOĞUL prefix'i aşağıda handleSubmissionRoute'a (üye gönderi
  // CRUD'u) düşüyor — bu iki arama ucu o genel eşleşmeden ÖNCE özel olarak yakalanmalı, aksi
  // halde 'search' bir submission id'si gibi yorumlanıp 404/401 dönerdi (bkz. yukarıdaki
  // /api/projects/filters'daki AYNI çakışma önleme deseni).
  if (path === '/api/architects/search') return handleArchitectSearchRoute(request, env, url);
  if (path === '/api/offices/search') return handleOfficeSearchRoute(request, env, url);
  if (path.startsWith('/api/facets/')) return handleFacetsRoute(request, env, url, path.slice('/api/facets/'.length));
  if (path.startsWith('/api/architect/')) return handleArchitectRoute(request, env, url, path.slice('/api/architect/'.length));
  if (path.startsWith('/api/office/')) return handleOfficeRoute(request, env, url, path.slice('/api/office/'.length));
  if (path.startsWith('/api/project/')) {
    const projectSlug = path.slice('/api/project/'.length);
    // DELETE: proje sahibinin (ya da admin'in) pop-up içinden kendi projesini silmesi (bkz.
    // js/components/project-actions.js#runOwnerDelete, kullanıcı isteği) — GET (yukarıdaki
    // handleProjectDetailRoute, herkese açık detay) ile AYNI path'i paylaşır, method'a göre ayrılır.
    if (request.method === 'DELETE') return handleSelfProjectDelete(request, env, decodeURIComponent(projectSlug));
    return handleProjectDetailRoute(request, env, url, projectSlug);
  }
  if (path.startsWith('/api/product/')) return handleProductDetailRoute(request, env, url, path.slice('/api/product/'.length));
  if (path.startsWith('/api/comments')) return handleCommentsRoute(request, env, url);
  if (path.startsWith('/api/saved')) return handleSavedRoute(request, env, url);
  if (path.startsWith('/api/ratings')) return handleRatingsRoute(request, env, url);
  if (path.startsWith('/api/claims')) return handleClaimsRoute(request, env, url);
  if (path.startsWith('/api/corrections')) return handleCorrectionsRoute(request, env, url);
  if (path.startsWith('/api/badges')) return handleBadgesRoute(request, env, url);
  if (path.startsWith('/api/payments/')) return handlePaymentsRoute(request, env, url);
  if (path.startsWith('/api/notifications')) return handleNotificationsRoute(request, env, url);
  if (
    path.startsWith('/api/offices') || path.startsWith('/api/projects') ||
    path.startsWith('/api/products') || path.startsWith('/api/materials') ||
    path.startsWith('/api/architects') || path.startsWith('/api/news')
  ) return handleSubmissionRoute(request, env, url);
  return errorJson('Bulunamadı', 404);
}
