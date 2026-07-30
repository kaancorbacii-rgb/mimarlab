import { errorJson } from './lib/http.js';
import { handleAuthRoute, handleProfileRoute } from './routes/auth.js';
import { handleSubmissionRoute } from './routes/submissions.js';
import { handlePublicRoute } from './routes/public.js';
import { handleAdminRoute } from './routes/admin.js';
import { handleUploadRoute, handleMediaRoute } from './routes/upload.js';
import { handleCommentsRoute } from './routes/comments.js';
import { handleSavedRoute } from './routes/saved.js';
import { handleRatingsRoute } from './routes/ratings.js';
import { handleClaimsRoute } from './routes/claims.js';
import { handleBadgesRoute, handlePublicBadges } from './routes/badges.js';
import { handleContactRoute } from './routes/contact.js';
import { handleNotificationsRoute } from './routes/notifications.js';
import { slugify } from './lib/slugify.js';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

// Temiz URL yapısı: eski ?param= sorgu dizesi yerine yol tabanlı adresler (SEO ve paylaşılabilirlik
// için, bkz. kullanıcı isteği). Cloudflare Assets zaten .html uzantısını otomatik kaldırıyor
// (html_handling varsayılanı auto-trailing-slash) — burada yalnızca sorgu parametresini yol
// segmentine taşıyoruz. Mimar/marka isimleri slugify edilir (save-widget.js/src/lib/slugify.js ile
// birebir aynı algoritma); proje slug'ı ve haber id'si zaten URL-güvenli olduğundan dönüştürülmez.
const CLEAN_URL_REDIRECTS = {
  '/proje-detay': { param: 'proje', prefix: '/projeler/', slugifyValue: false },
  '/mimar-detay': { param: 'mimar', prefix: '/mimar/', slugifyValue: true },
  '/ofis-detay': { param: 'ofis', prefix: '/markalar/', slugifyValue: true },
  '/haber-detay': { param: 'haber', prefix: '/haberler/', slugifyValue: false },
};
// Yeni temiz yol önekini, aynı içeriği render eden gerçek statik HTML dosyasına eşler — istemci
// tarafındaki sayfa JS'i slug'ı URL yolundan okuyacak şekilde ayrıca güncellenmiştir (bkz. ilgili
// *-detay.html dosyalarındaki path-tabanlı fallback lookup). Uzantısız yol kullanılır çünkü
// env.ASSETS.fetch'e ".html" ile biten bir istek verilirse Cloudflare Assets kendi html_handling
// (auto-trailing-slash) davranışıyla bunu tekrar uzantısız hale 301 yönlendirir — bu da orijinal
// /projeler/:slug isteğimizin path bilgisini kaybederdi; uzantısız istemek doğrudan içeriği döner.
const CLEAN_URL_ASSETS = [
  { prefix: '/projeler/', asset: '/proje-detay' },
  { prefix: '/mimar/', asset: '/mimar-detay' },
  { prefix: '/markalar/', asset: '/ofis-detay' },
  { prefix: '/haberler/', asset: '/haber-detay' },
];

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
    } else {
      response = await routeAsset(request, env, url);
    }
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};

async function routeAsset(request, env, url) {
  const redirectKey = url.pathname.replace(/\.html$/, '');
  const redirectRule = CLEAN_URL_REDIRECTS[redirectKey];
  const paramVal = redirectRule ? url.searchParams.get(redirectRule.param) : null;
  if (redirectRule && paramVal) {
    const slugValue = redirectRule.slugifyValue ? slugify(paramVal) : paramVal;
    const dest = new URL(redirectRule.prefix + encodeURIComponent(slugValue), url.origin);
    return Response.redirect(dest.href, 301);
  }

  const cleanRoute = CLEAN_URL_ASSETS.find(r => url.pathname.startsWith(r.prefix) && url.pathname.length > r.prefix.length);
  if (cleanRoute) {
    const assetUrl = new URL(url);
    assetUrl.pathname = cleanRoute.asset;
    return env.ASSETS.fetch(new Request(assetUrl, request));
  }

  return env.ASSETS.fetch(request);
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
  if (path.startsWith('/api/comments')) return handleCommentsRoute(request, env, url);
  if (path.startsWith('/api/saved')) return handleSavedRoute(request, env, url);
  if (path.startsWith('/api/ratings')) return handleRatingsRoute(request, env, url);
  if (path.startsWith('/api/claims')) return handleClaimsRoute(request, env, url);
  if (path.startsWith('/api/badges')) return handleBadgesRoute(request, env, url);
  if (path.startsWith('/api/notifications')) return handleNotificationsRoute(request, env, url);
  if (
    path.startsWith('/api/offices') || path.startsWith('/api/projects') ||
    path.startsWith('/api/products') || path.startsWith('/api/jobs') ||
    path.startsWith('/api/architects') || path.startsWith('/api/news')
  ) return handleSubmissionRoute(request, env, url);
  return errorJson('Bulunamadı', 404);
}
