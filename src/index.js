import { json, errorJson } from './lib/http.js';
import { logRequest } from './lib/logger.js';
import { buildMeta, listEntityUrls, isKnownButHidden } from './lib/seo.js';
import { handleAuthRoute, handleProfileRoute, handleAccountDeleteRoute } from './routes/auth.js';
import { handleSubmissionRoute } from './routes/submissions.js';
import { handlePublicRoute } from './routes/public.js';
import { handleArchitectRoute, handleArchitectSearchRoute, handleArchitectListRoute, handleArchitectSchoolsRoute, handleArchitectPrimaryOfficeRoute, fetchArchitectPool } from './routes/architect.js';
import { handleOfficeRoute, handleOfficeSearchRoute, handleOfficeListRoute, fetchOfficePool } from './routes/office.js';
import { handleProjectDetailRoute, handleProjectFiltersRoute, handleProjectListRoute, handleProjectCanEditRoute, handlePhotographerSearchRoute, handleProjectSearchRoute, fetchActiveProjectPoolCached } from './routes/project.js';
import { handleProductDetailRoute, handleProductListRoute, handleProductSearchRoute, handleProductBrandSearchRoute, handleProductCanEditRoute, fetchProductPool } from './routes/product.js';
import { handleAiSearchRoute } from './routes/ai.js';
import { handleVisualSearchRoute, handleImageEmbedAppendRoute } from './routes/visualSearch.js';
import { rebuildIndex } from './lib/visualIndexStore.js';
import { handleGeocodeRoute } from './routes/geocode.js';
import { handleAdminRoute } from './routes/admin.js';
import { handleSelfProjectDelete, handleSelfProjectModerate } from './routes/legacyContent.js';
import { handleUploadRoute, handleFileUploadRoute, handleMediaRoute } from './routes/upload.js';
import { derivedImageUrl } from './lib/imageDerivative.js';
import { handleCommentsRoute } from './routes/comments.js';
import { handleSavedRoute } from './routes/saved.js';
import { handleSharesRoute } from './routes/shares.js';
import { handleCollectionsRoute } from './routes/collections.js';
import { handleFollowRoute } from './routes/follows.js';
import { handleAnalyticsRoute } from './routes/analytics.js';
import { handleRatingsRoute } from './routes/ratings.js';
import { handleClaimsRoute, handleCorrectionsRoute } from './routes/claims.js';
import { handleBadgesRoute, handlePublicBadges } from './routes/badges.js';
import { handleTop100Route } from './routes/top100.js';
import { handlePaymentsRoute } from './routes/payments.js';
import { handleContactRoute } from './routes/contact.js';
import { handleNewsletterRoute } from './routes/newsletter.js';
import { handleCspReportRoute } from './routes/cspReport.js';
import { handleNotificationsRoute } from './routes/notifications.js';
import { handleHotspotTagsRoute } from './routes/hotspotTags.js';
import { handleMessagesRoute } from './routes/messages.js';
import { handleAiRoute } from './routes/ai.js';
import { slugify } from './lib/slugify.js';
import { SSR_CACHE_VERSION } from './lib/ssrCache.js';
// Hub sayfalarının SSR iç link grafiği (SEO denetimi, 2026-09-05) — bkz. o dosyanın başındaki ölçüm.
import { isHubPath, hubItemListJsonLd } from './lib/hubLinks.js';
// office-kind.js — FİRMA/MARKA ayrımının tek kaynağı (bkz. loadHubPool).
import officeKindJs from '../office-kind.js';
import { resolveSlugRedirect } from './lib/slugRedirects.js';
import { getSessionUser } from './lib/auth.js';
import { getSiteSettings } from './lib/siteSettings.js';
import { isGlobalPurgeConfigured } from './lib/globalPurge.js';

const SITE_ORIGIN = 'https://mimarlab.com';

// X-Frame-Options bilerek DENY olarak korunuyor (spec Faz 5'in önerdiği SAMEORIGIN yerine) — sitede
// hiçbir yerde <iframe>/<frame> kullanılmıyor (bkz. depo çapında arama), yani kendi kendini
// çerçeveleme ihtiyacı yok; DENY, SAMEORIGIN'in sağladığı hiçbir işlevsellik kaybı olmadan strictly
// daha güvenli. Strict-Transport-Security kasıtlı olarak includeSubDomains/preload İÇERMİYOR (bkz.
// kullanıcı isteği) — tüm alt alan adlarının HTTPS desteği doğrulanmadan bunlar geri dönüşü zor bir
// risk taşır (preload listesine girmek ayları bulan bir kaldırma süreci gerektirir, includeSubDomains
// HTTPS'siz bir alt alan adını anında kırar).
// Enforce CSP — repo çapında origin taraması (script/link/fetch/iframe) sonucu: Google
// Fonts (fonts.googleapis.com/fonts.gstatic.com), Google Tag Manager (gtag.js + GA4 collect
// uçları), ve site genelindeki HTML sayfalarının kendi inline <script>/<style> bloklarından
// (bu depoda henüz nonce/hash altyapısı yok, script-src/style-src bu yüzden 'unsafe-inline'
// içeriyor). Google/LinkedIn OAuth ve iyzico ödeme sayfası ikisi de düz <a href>/window.location
// İLE üst seviye yönlendirme (top-level navigation) — CSP bunu kısıtlamaz, bu yüzden connect-src/
// form-action'a ayrıca eklenmedi. object-src hâlâ 'none' — sitede hiçbir <object>/<embed> yok.
// frame-src YOK — project-modal.js'in Harita akordeonu ARTIK bir Google Maps iframe embed'i
// kullanmıyor (bkz. kullanıcı isteği: "Google Maps iframe'ini tamamen kaldır"), doğrudan aynı
// Leaflet+Esri haritasını kendi div'i içine kuruyor (bkz. aşağıdaki not) — sitede yeniden hiçbir
// yerde <iframe>/<frame> yok, X-Frame-Options: DENY yorumundaki "hiçbir yerde iframe yok" ifadesi
// tekrar birebir doğru.
// report-to — ihlaller artık yalnızca o anki sekmenin DevTools konsoluna değil, aşağıdaki
// Reporting-Endpoints header'ının gösterdiği POST /api/csp-report'a da gönderilir (bkz.
// src/routes/cspReport.js) — enforce modunda da AÇIK bırakıldı, böylece ileride ortaya çıkabilecek
// yeni bir üçüncü taraf kaynağı sessizce kırılmak yerine loglanır.
// Faz 4C: canlıda kısa bir `wrangler tail` örneklemesi (proje/mimar/firma sayfaları, filtreler,
// yorum/puanlama/kaydet widget'ları gezilerek) TEK gerçek ihlal buldu: Cloudflare'ın zone
// panelinden otomatik enjekte ettiği kendi RUM/Analytics beacon'ı (static.cloudflareinsights.com/
// beacon.min.js) script-src tarafından engelleniyordu — bu repo'da hiçbir yerde referans edilmediği
// için önceki origin taramasında görünmüyordu (edge'in kendisi enjekte ediyor). Bu meşru bir
// Cloudflare servisi olduğundan script-src'ye eklendi; beacon'ın kendi telemetri POST'u da aynı
// origin'e gittiğinden connect-src'ye de eklendi. Düzeltme SONRASI canlıda ikinci bir örnekleme
// (proje/ofis/mimar sayfaları, karışık gerçek+test trafiği, ~40sn) SIFIR ihlal buldu — bu temiz
// örneklem üzerine Report-Only'den Enforce'a geçildi (bkz. kullanıcı isteği: Faz 4C kapanışı).
// Proje Ekle/Düzenle + Projeler sayfası + proje popupundaki harita (bkz. kullanıcı isteği) — bir
// Google Maps API key denendi ama key'in Cloud Console taraflı kısıtlamaları (Places/Geocoding
// API'lerin key seviyesinde engellenmiş olması) yüzünden kullanıcı isteğiyle TAMAMEN anahtarsız/
// ücretsiz bir yığına geçildi: Leaflet + Esri World Imagery (uydu karoları) + Nominatim (arama/ters
// jeokodlama). unpkg.com Leaflet'in CSS/JS/marker ikon dosyalarını, server.arcgisonline.com/
// services.arcgisonline.com Esri'nin uydu karolarını, *.tile.openstreetmap.org (yedek/olası ileride
// kullanım için, bkz. kullanıcı isteği) standart OSM karolarını sağlar. Üç kullanım noktası da
// (proje-ekle.html, js/pages/proje.js#loadLeaflet, js/components/project-modal.js#loadLeaflet) AYNI
// yığını, birbirinden bağımsız kendi script yükleyicileriyle kullanır. nominatim.openstreetmap.org
// artık connect-src'de DEĞİL — gerçek bulgu: Nominatim'in paylaşılan CDN önbelleği bazı sorgularda
// Access-Control-Allow-Origin başlığını tutarsız dönüyordu (tarayıcıdan doğrudan çağrıldığında
// sessizce CORS hatasına yol açıyordu), bu yüzden arama/ters-jeokodlama artık tarayıcıdan değil
// src/routes/geocode.js üzerinden sunucu-sunucu proxy'leniyor (bkz. o dosyanın başındaki not) — bu
// origin'e artık hiçbir sayfadan doğrudan tarayıcı isteği atılmıyor.
// 'wasm-unsafe-eval' (kullanıcı isteği, 2026-09-03 — gerçek görsel-görsel CLIP embedding):
// tarayıcı WebAssembly.instantiate() çağırırken modern Chrome/Firefox bu direktifi ARAR, yoksa
// WASM derlemesini CSP SESSİZCE ENGELLER (bkz. js/vendor/ort/ — self-host edilmiş onnxruntime-web,
// image-clip-embed.js). 'unsafe-eval' DEĞİL — yalnızca WASM derlemesine izin verir, JS eval()'e değil.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://www.googletagmanager.com https://static.cloudflareinsights.com https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://unpkg.com https://server.arcgisonline.com https://services.arcgisonline.com https://*.tile.openstreetmap.org",
  "connect-src 'self' https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com https://static.cloudflareinsights.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "report-to csp-endpoint",
].join('; ');

// Reporting API (bkz. yukarıdaki report-to yorumu) — "csp-endpoint" grup adı CSP direktifindeki
// report-to değeriyle BİREBİR aynı olmalı, tarayıcı bu isim üzerinden eşleştirir.
const REPORTING_ENDPOINTS_HEADER = 'csp-endpoint="https://mimarlab.com/api/csp-report"';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), accelerometer=(), gyroscope=(), magnetometer=(), payment=(), usb=(), bluetooth=(), midi=()',
  'Strict-Transport-Security': 'max-age=31536000',
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'Reporting-Endpoints': REPORTING_ENDPOINTS_HEADER,
};

// Temiz URL yapısı: eski ?param= sorgu dizesi yerine yol tabanlı adresler (SEO ve paylaşılabilirlik
// için, bkz. kullanıcı isteği). Cloudflare Assets zaten .html uzantısını otomatik kaldırıyor
// (html_handling varsayılanı auto-trailing-slash) — burada yalnızca sorgu parametresini yol
// segmentine taşıyoruz. Mimar/marka isimleri slugify edilir (save-widget.js/src/lib/slugify.js ile
// birebir aynı algoritma); proje slug'ı ve haber id'si zaten URL-güvenli olduğundan dönüştürülmez.
// '/haber-detay' burada YOK — bkz. DISABLED_PAGE_PATHS'teki yorum, artık isDisabledPagePath()
// tarafından bu tablo hiç kontrol edilmeden doğrudan 404'e yönlendiriliyor.
const CLEAN_URL_REDIRECTS = {
  '/proje-detay': { param: 'proje', prefix: '/proje/', slugifyValue: false },
  '/mimar-detay': { param: 'mimar', prefix: '/kisi/', slugifyValue: true },
  '/ofis-detay': { param: 'ofis', prefix: '/firma/', slugifyValue: true },
};
// Yeni temiz yol önekini, aynı içeriği render eden gerçek statik HTML dosyasına eşler — istemci
// tarafındaki sayfa JS'i slug'ı URL yolundan okuyacak şekilde ayrıca güncellenmiştir (bkz. ilgili
// *-detay.html dosyalarındaki path-tabanlı fallback lookup). Uzantısız yol kullanılır çünkü
// env.ASSETS.fetch'e ".html" ile biten bir istek verilirse Cloudflare Assets kendi html_handling
// (auto-trailing-slash) davranışıyla bunu tekrar uzantısız hale 301 yönlendirir — bu da orijinal
// /yapi/:slug isteğimizin path bilgisini kaybederdi; uzantısız istemek doğrudan içeriği döner.
const CLEAN_URL_ASSETS = [
  // /proje/:slug, /kisi/:slug, /firma/:slug, /urun/:slug artık kendi listeleme sayfalarına
  // eşleniyor (proje-detay.html/mimar-detay.html/ofis-detay.html/urun-detay.html kaldırıldı) — her
  // sayfa kendi JS'inde bu yolu algılayıp ilgili modalı (ProjectModal/ArchitectModal/OfficeModal/
  // ProductModal, bkz. js/components/) doğrudan açar, injectMeta() ise AYNI HTMLRewriter
  // mekanizmasıyla o listeleme sayfasının <head>'indeki id'li meta etiketlerini hedefler (bkz.
  // proje.html/kisi.html/firma.html/urun.html#meta-description vb.).
  // Eskiden "Yapı" (buildStatus='built', /yapi/:slug) ve "Proje" (buildStatus='concept', /proje/:slug)
  // ayrı sayfa/önek çiftiydi (bkz. kullanıcı isteği) — konsept kategori tamamen kaldırıldı, Yapı
  // sayfası "Proje" adını aldı, tek önek kaldı. Eski /yapi/:slug bağlantıları PREFIX_RENAME_REDIRECTS'te
  // buraya 301'lenir.
  { prefix: '/proje/', asset: '/proje', type: 'project' },
  { prefix: '/kisi/', asset: '/kisi', type: 'architect' },
  { prefix: '/firma/', asset: '/firma', type: 'office' },
  { prefix: '/urun/', asset: '/urun', type: 'product' },
];

// serveDetailPage#type ('project'/'architect'/'office') -> slug_redirects.entity_type (bkz.
// migrations/0041_slug_redirects.sql) — src/lib/canonicalSync.js/officeFounderCascade.js'teki AYNI
// çoğul isimlendirme ('projects'/'architects'/'offices').
// product: eklendi (2026-08-17) — ürün/malzeme slug'ı artık başlık+marka'dan üretiliyor (bkz.
// src/lib/canonicalSync.js#syncProduct), bu yüzden eski "m-<id>" tam sayfa yüklemeleri de diğer
// üç tip gibi slug_redirects üzerinden 301 alabilsin (bkz. scripts/backfill-product-slugs.js'in
// yazdığı girdiler) — client-taraflı GET /api/product/:key zaten legacy_key ile ayrıca çözülüyor
// (bkz. src/routes/product.js#findProductByLegacyMarker), bu yalnızca tam sayfa/bot yüklemesi içindir.
const ENTITY_TYPE_BY_DETAIL_TYPE = { project: 'projects', architect: 'architects', office: 'offices', product: 'products' };

// Kariyer — yayında değil (bkz. kullanıcı isteği). Ürün/Danışman/Haber'in aksine sayfası hâlâ
// repoda duruyor (bkz. kariyer.html) ama bu görevin kapsamı dışında bırakıldı — yalnızca public
// erişim burada kapatılıyor. Hem uzantısız hem ".html" biten biçim eşlenir.
// /haber-detay — audit bulgusu: haber özelliği yayından tamamen kaldırıldığından (CLEAN_URL_ASSETS'te
// '/haberler/' girişi yok) aşağıdaki CLEAN_URL_REDIRECTS'teki eski kural bu isteği /haberler/:id'ye
// 301'liyor, oraya giden istek de gerçek 404'e düşüyordu (301→404 zinciri, eski indekslenmiş/
// paylaşılmış linkler için gereksiz bir ekstra hop). Burada listelenmesi bu zinciri kısa devre
// yaptırıp doğrudan (markalı) 404 döndürür — CLEAN_URL_REDIRECTS'teki '/haber-detay' girişi bu
// yüzden artık erişilemez, o da kaldırıldı.
const DISABLED_PAGE_PATHS = new Set(['/kariyer', '/haber-detay']);

function isDisabledPagePath(pathname) {
  const bare = pathname.replace(/\.html$/, '');
  return DISABLED_PAGE_PATHS.has(bare);
}

// Admin panelden (Site Ayarları) açılıp kapatılan bakım modu (bkz. src/lib/siteSettings.js) —
// bu YOLLAR her koşulda geçer, oturumu düşmüş/hiç açmamış bir admin'in bile giriş yapıp panele
// geri dönebilmesi için: '/' + '/giris' (auth-modal.js'in yaşadığı ana sayfa, giriş formu burada
// açılır), '/giris-yap'(.html) (eski URL, '/giris'e 301'lenir — bu yönlendirmenin KENDİSİ de
// engellenmemeli), '/admin' (panelin kendisi).
const MAINTENANCE_BYPASS_PATHS = new Set(['/', '/admin', '/admin.html', '/giris', '/giris-yap', '/giris-yap.html']);

// Yalnızca "sayfa" isteklerini hedefler (son yol parçasında nokta YOKSA) — .css/.js/.png/.svg/.woff
// gibi statik varlıklar bakım modundan HİÇ etkilenmez (maintenanceResponse'un kendi inline stili
// zaten bunlara bağımlı değil, ama site JS'inin bakım sırasında bile normal çalışması istenmeyen bir
// yan etki yaratmasın diye bu ayrım bilinçli).
function isPageRequestPath(pathname) {
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
  return !lastSegment.includes('.');
}

function maintenanceResponse() {
  const html = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Bakımdayız — MİMARLAB</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f1ea;color:#1b2a3d;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}main{max-width:420px}h1{font-size:22px;margin:0 0 12px}p{font-size:15px;line-height:1.5;color:#5a6472;margin:0}</style>
</head><body><main><h1>Kısa bir bakımdayız</h1><p>MİMARLAB şu anda planlı bir bakım çalışması nedeniyle geçici olarak erişime kapalı. Kısa süre içinde geri döneceğiz.</p></main></body></html>`;
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '1800', 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store' } });
}

// null dönerse (bakım modu kapalı/muaf yol/admin oturumu) çağıran normal routeAsset akışına devam
// eder — bkz. fetch()'teki çağrı noktası. getSiteSettings KV-önbellekli olduğundan (bkz.
// src/lib/siteSettings.js) bu kontrol her sayfa isteğinde ek bir D1 sorgusu YARATMAZ.
async function maybeServeMaintenancePage(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  if (!isPageRequestPath(url.pathname)) return null;
  if (MAINTENANCE_BYPASS_PATHS.has(url.pathname)) return null;
  const settings = await getSiteSettings(env);
  if (settings.maintenance_mode !== '1') return null;
  const user = await getSessionUser(request, env);
  if (user && user.role === 'admin') return null;
  return maintenanceResponse();
}

async function handleRobotsTxt(env) {
  const settings = await getSiteSettings(env);
  if (!settings.robots_txt) return null;
  return new Response(settings.robots_txt, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=60' } });
}

// Sayfa yeniden adlandırmaları (301) — eski URL/dosya adı kaldırılıp yerine yenisi geçtiğinde
// (bkz. kullanıcı isteği: /ofis -> /firma, Malzeme'nin Ürün'e taşınması) eski bağlantıların/
// yer imlerinin kırılmaması için. Hem uzantısız hem ".html" biten biçim eşlenir.
const PATH_RENAME_REDIRECTS = {
  // "Yapı" listeleme sayfası "Proje" adını aldı, eski konsept "Proje" sayfası kaldırıldı (bkz.
  // kullanıcı isteği) — eski /yapi bağlantıları/yer imleri kırılmasın diye 301'lenir.
  '/yapi': '/proje',
  '/yapi.html': '/proje',
  '/ofis': '/firma',
  '/ofis.html': '/firma',
  '/ofis-ekle': '/firma-ekle',
  '/ofis-ekle.html': '/firma-ekle',
  // "Mimar" dizini "Kişi" oldu (kullanıcı isteği, 2026-09-01): dizin artık yalnızca mimarları değil
  // fotoğrafçı/tasarımcı/öğrencileri de barındırıyor (bkz. kisi-ekle.html#MESLEK_OPTIONS); dosyalar
  // mimar.html -> kisi.html, mimar-ekle.html -> kisi-ekle.html olarak yeniden adlandırıldı.
  // Liste sayfası burada, PROFİL sayfaları (/mimar/:slug) ise PREFIX_RENAME_REDIRECTS'te 301'lenir —
  // ikisi de indexlenmiş/backlink almış URL'ler olduğundan yönlendirme kalıcı olmalı.
  '/mimar': '/kisi',
  '/mimar.html': '/kisi',
  '/mimar-ekle': '/kisi-ekle',
  '/mimar-ekle.html': '/kisi-ekle',
  '/malzeme': '/urun',
  '/malzeme.html': '/urun',
  '/malzeme-ekle': '/urun-ekle',
  '/malzeme-ekle.html': '/urun-ekle',
  // Giriş Yap/Üye Ol/Hesabım artık bağımsız sayfalar değil, her sayfada açılabilen popup modallar
  // (bkz. kullanıcı isteği, js/components/auth-modal.js) — eski dosya adlarına gelen istekler/
  // yer imleri temiz yol adlarına yönlendirilir, oradan AUTH_MODAL_ROUTES devralır (bkz. aşağısı).
  '/giris-yap': '/giris',
  '/giris-yap.html': '/giris',
  '/uye-ol.html': '/uye-ol',
  '/hesabim.html': '/hesabim',
  '/aktivitelerim.html': '/aktivitelerim',
  // Koleksiyonum — Aktivitelerim ile AYNI desen (bkz. js/components/auth-modal.js#VIEW_PATH).
  '/koleksiyonum.html': '/koleksiyonum',
  // İçeriklerim sayfası kaldırıldı (kullanıcı isteği, 2026-09-05): "Eklediklerim" kutusu
  // Aktivitelerim'e taşındı. Eski /iceriklerim bağlantıları/yer imleri kırılmasın diye Aktivitelerim'e
  // 301'lenir (bkz. aşağıdaki PREFIX olmayan sabit yol yönlendirmesi).
  '/iceriklerim': '/aktivitelerim',
  '/iceriklerim.html': '/aktivitelerim',
  '/sifremi-unuttum.html': '/sifremi-unuttum',
  // Rozet Al/İade Et/İletişim/Hakkında/Gizlilik Politikası/Hizmet Şartları/Kariyer de artık popup
  // modallar (bkz. kullanıcı isteği, js/components/info-modal.js) — AYNI gerekçe. "Rozet Al" ile
  // kod tabanındaki tek ödeme/checkout sayfası (satin-al.html) aynı şey olduğundan (ayrı bir "ödeme
  // sayfası" yok — kart bilgisi iyzico'nun hosted sayfasında girilir) kullanıcı isteğindeki yeni
  // /rozet-al yolu burada satin-al'ın kanonik adı olur.
  '/satin-al': '/rozet-al',
  '/satin-al.html': '/rozet-al',
  '/iade-et.html': '/iade-et',
  '/iletisim.html': '/iletisim',
  '/hakkinda.html': '/hakkinda',
  '/gizlilik-politikasi.html': '/gizlilik-politikasi',
  '/hizmet-sartlari.html': '/hizmet-sartlari',
  '/cerez-politikasi.html': '/cerez-politikasi',
  // "Neden MİMARLAB?" (bkz. neden-mimarlab.html) — INFO_MODAL_META'daki popup sayfalarının aksine
  // GERÇEK, kendi <head>'ini/gövdesini taşıyan bağımsız bir statik sayfa (uzun kaydırmalı editoryal
  // içerik bir modal kabuğuna sığmaz, ayrıca sunum olarak paylaşılabilir olması isteniyor). Bu
  // yüzden ek bir meta enjeksiyonu GEREKMEZ — Cloudflare Assets '/neden-mimarlab' isteğini doğrudan
  // dosyaya eşler; burada yalnızca ".html"li eski/elle yazılmış biçim kanonik yola 301'lenir.
  '/neden-mimarlab.html': '/neden-mimarlab',
};

// Giriş/Üye Ol/Hesabım modallarının doğrudan URL ile açılması (F5/deep-link) — CLEAN_URL_ASSETS'in
// aksine bir slug'a değil TEK bir sabit yola karşılık geldiklerinden ayrı, basit bir eşleme yeterli.
// index.html HER sayfada zaten yüklü olan auth-modal.js'i barındırdığından burada "ana sayfa" servis
// edilir, o da location.pathname'e bakıp ilgili modalı kendisi açar (bkz. auth-modal.js).
//
// SEO denetimi (2026-09-03) — GERÇEK BULGU: burada eskiden "bu sayfalar zaten noindex (bkz.
// giris-yap.html/uye-ol.html/hesabim.html <meta name=robots>), meta enjeksiyonuna gerek yok" yazan
// bir not vardı ve bu YANLIŞTI. O statik dosyalar bu yollar için HİÇ servis edilmiyor — servis
// edilen index.html'dir ve index.html tamamen indexlenebilir. Sonuç: bu 7 URL, ana sayfayla
// neredeyse birebir aynı gövdeyi robots etiketi OLMADAN dönüyordu; üstelik /giris ve /uye-ol
// sitedeki HER sayfanın footer/nav'ında gerçek <a href> olarak duruyor (bkz. js/components/
// site-chrome.js), yani Googlebot'un en sık gördüğü iç bağlantılardan ikisi. Canlıda doğrulandı:
// GET /giris -> 200, <meta name="robots"> YOK, <title> ana sayfanınkiyle aynı.
//
// Çözüm, INFO_MODAL_META'nın (aşağısı) Rozet Al/İade Et için ZATEN kullandığı kanıtlanmış desenin
// birebir aynısı: kendi title/description'ı + KENDİ yoluna işaret eden canonical + noindex. Ayrı
// bir mekanizma icat edilmez, serveInfoModalPage yeniden kullanılır. canonical'ın ana sayfaya
// DEĞİL kendi yoluna işaret etmesi bilinçli: "noindex + başka bir URL'e canonical" çelişkili bir
// sinyaldir ve Google'ın canonical HEDEFİNİ (burada ana sayfayı) de indeksten düşürme riski taşır.
const AUTH_MODAL_META = {
  '/giris': { title: 'Giriş Yap — MİMARLAB', description: 'MİMARLAB hesabına giriş yap; projelerini, kaydettiklerini ve profilini yönet.', noindex: true },
  '/uye-ol': { title: 'Üye Ol — MİMARLAB', description: 'MİMARLAB\'a ücretsiz üye ol; proje, kişi, firma ve ürün ekle, içerikleri kaydet ve takip et.', noindex: true },
  '/hesabim': { title: 'Hesabım — MİMARLAB', description: 'MİMARLAB hesap ayarların, profil bilgilerin ve üyelik yönetimin.', noindex: true },
  '/aktivitelerim': { title: 'Aktivitelerim — MİMARLAB', description: 'MİMARLAB\'da kaydettiklerin, takip ettiklerin, puanladıkların, yorumların ve eklediklerin.', noindex: true },
  '/koleksiyonum': { title: 'Koleksiyonum — MİMARLAB', description: 'MİMARLAB panoların ve koleksiyonların.', noindex: true },
  '/sifremi-unuttum': { title: 'Şifremi Unuttum — MİMARLAB', description: 'MİMARLAB şifreni sıfırla; e-posta adresine sıfırlama bağlantısı gönderelim.', noindex: true },
};
// (Bu yollar artık ayrı bir Set üzerinden değil, doğrudan AUTH_MODAL_META üzerinden eşleşiyor —
// bkz. routeAsset'teki `AUTH_MODAL_META[url.pathname] || INFO_MODAL_META[url.pathname]`.)

// Rozet Al/İade Et/İletişim/Hakkında/Gizlilik Politikası/Hizmet Şartları/Kariyer — AYNI "ana sayfayı
// servis et, istemci JS'i (bkz. js/components/info-modal.js) location.pathname'e göre ilgili modalı
// kendisi açsın" yaklaşımı (bkz. AUTH_MODAL_ROUTES yukarısı, AYNI gerekçe). AUTH_MODAL_ROUTES'un
// aksine Rozet Al/İade Et dışındakiler (İletişim/Hakkında/Gizlilik Politikası/Hizmet Şartları/
// Kariyer) GERÇEKTEN indexlenen, sitemap'te yer alan sayfalar (bkz. SITEMAP_STATIC_PAGES) — index.html
// homepage içeriğini serveceğinden title/description/canonical/OG enjekte edilmezse Google bu
// sayfaları ana sayfayla AYNI başlık/açıklamayla görürdü (gerçek bulgu). Bu yüzden her giriş kendi
// title/description'ını taşır, injectInfoPageMeta() ile serveDetailPage'in injectMeta()'sıyla AYNI
// HTMLRewriter tekniğiyle enjekte edilir; noindex:true olanlar (Rozet Al/İade Et, satin-al.html/
// iade-et.html'deki <meta name="robots" content="noindex, follow"> ile AYNI, giriş gerektiren
// işlemsel sayfalar) ayrıca bir robots meta etiketi de alır — index.html'in kendisi tamamen
// indexlenebilir olduğundan üzerine yazılacak bir robots etiketi yoktur.
// h1: SEO denetimi (2026-09-05) — GERÇEK BULGU. Bu yollar index.html'i (ana sayfa gövdesini)
// servis edip yalnızca <title>/description/canonical/OG'yi enjekte ediyordu; sayfanın <h1>'i ham
// HTML'de ana sayfanınki ("Türkiye'nin En Gelişmiş Mimarlık ve Ürün Rehberi") olarak kalıyordu.
// Bu 5 URL (iletisim/hakkinda/gizlilik-politikasi/hizmet-sartlari/cerez-politikasi) noindex DEĞİL
// ve sitemap'te (bkz. SITEMAP_STATIC_PAGES) yer alıyor — yani arama motorları beş ayrı indexlenebilir
// URL'yi ana sayfayla AYNI H1 ile görüyordu. injectMeta'nın ZATEN var olan 'h1#entity-h1' kuralı
// yeniden kullanılır (bkz. index.html#entity-h1) — yeni bir mekanizma icat edilmez. Görsel etki
// yok: bu yollarda InfoModal tam ekran overlay'i hero'nun üstünü zaten kapatıyor (canlıda
// doğrulandı), ayrıca modalın kendi başlığı da aynı metni taşıyor.
const INFO_MODAL_META = {
  '/rozet-al': { title: 'Rozet Satın Al — MİMARLAB', description: 'MİMARLAB rozet satın al — profilini doğrulanmış üye, altın üye ya da elmas üye rozetiyle öne çıkar.', h1: 'Rozet Satın Al', noindex: true },
  '/iade-et': { title: 'Rozet İadesi Talep Et — MİMARLAB', description: 'MİMARLAB rozet iadesi talep et — satın aldığın rozet için iade talebinde bulun.', h1: 'Rozet İadesi Talep Et', noindex: true },
  '/iletisim': { title: 'İletişim — MİMARLAB', description: 'MİMARLAB ile iletişime geç — soru, öneri ve iş birliği için bize ulaş.', h1: 'İletişim', noindex: false },
  '/hakkinda': { title: 'Hakkında — MİMARLAB', description: 'MİMARLAB hakkında — Türkiye\'nin mimarlık, iç mimarlık ve peyzaj mimarlığı platformu.', h1: 'Hakkında', noindex: false },
  '/gizlilik-politikasi': { title: 'Gizlilik Politikası — MİMARLAB', description: 'MİMARLAB gizlilik politikası — hangi verileri topladığımız, üyelik/profil yönetimi, favoriler, mimar/firma sahiplik talepleri, kullanıcı içerikleri, Cloudflare altyapısı ve KVKK/GDPR haklarınız.', h1: 'Gizlilik Politikası', noindex: false },
  '/hizmet-sartlari': { title: 'Hizmet Şartları — MİMARLAB', description: 'MİMARLAB hizmet şartları — üyelik, kullanıcı içerikleri ve telif hakları, mimar/firma sahiplik talepleri, rozet/üyelik paketleri, topluluk kuralları ve sorumluluk sınırları.', h1: 'Hizmet Şartları', noindex: false },
  '/cerez-politikasi': { title: 'Çerez Politikası — MİMARLAB', description: 'MİMARLAB çerez politikası — çerez nedir, hangi çerezleri (oturum, tercih, Google Analytics) kullandığımız, üçüncü taraf çerezleri ve çerezleri nasıl devre dışı bırakabileceğiniz.', h1: 'Çerez Politikası', noindex: false },
  // Kariyer artık yayında değil (bkz. kullanıcı isteği, DISABLED_PAGE_PATHS) — /kariyer isteği
  // routeAsset()'in en başındaki isDisabledPagePath() kontrolünde 404'e düştüğünden buraya hiç
  // ulaşmaz.
};

// Eski /markalar/:slug firma detay URL'leri artık /firma/:slug (bkz. kullanıcı isteği: SEO/backlink
// koruması) — slug segmenti dinamik olduğundan tam eşleşme yerine önek (prefix) bazlı yönlendirme
// gerekiyor; slug/sorgu string'i olduğu gibi korunur. Bu kontrol routeAsset() içinde CLEAN_URL_ASSETS
// eşleşmesinden ÖNCE çalıştığından eski linkler önce yeni öneke 301'lenir, sonra normal şekilde servis edilir.
const PREFIX_RENAME_REDIRECTS = [
  { from: '/markalar/', to: '/firma/' },
  { from: '/urunler/', to: '/urun/' },
  // Proje detay URL öneki artık /proje/:slug (bkz. kullanıcı isteği: Yapı sayfası Proje adını aldı)
  // — eski /projeler/:slug ve /yapi/:slug bağlantıları/yer imleri/indexlenmiş sonuçlar kırılmasın
  // diye AYNI desenle 301'lenir.
  { from: '/projeler/', to: '/proje/' },
  { from: '/yapi/', to: '/proje/' },
  // Kişi profil URL öneki (kullanıcı isteği, 2026-09-01): /mimar/:slug -> /kisi/:slug. Bu, sitedeki
  // EN ÇOK indexlenmiş ikinci URL ailesi (bkz. SITEMAP'teki architects girdileri) — 301 şart.
  // PATH_RENAME_REDIRECTS'teki '/mimar' girdisi yalnızca TAM eşleşen liste sayfasını yakalar,
  // slug'lı yollar buraya düşer (routeAsset'te PATH_RENAME'den hemen SONRA çalışır).
  { from: '/mimar/', to: '/kisi/' },
];

// Statik (build adımı olmayan) üst seviye sayfalar — bkz. eski kök dizindeki sitemap.xml (artık
// /sitemap.xml Worker route'u tarafından üretiliyor, bu dosya kaldırıldı).
const SITEMAP_STATIC_PAGES = [
  { loc: '/', changefreq: 'daily', priority: '1.0' },
  { loc: '/kisi', changefreq: 'daily', priority: '0.9' },
  { loc: '/firma', changefreq: 'daily', priority: '0.9' },
  { loc: '/proje', changefreq: 'daily', priority: '0.9' },
  { loc: '/urun', changefreq: 'weekly', priority: '0.7' },
  // marka.html — bkz. o dosyanın başındaki yorum (firma.html'in ?brands=1 ile daraltılmış kopyası).
  { loc: '/marka', changefreq: 'weekly', priority: '0.7' },
  { loc: '/en-iyi-100', changefreq: 'weekly', priority: '0.7' },
  // "Neden MİMARLAB?" — platformun mimarlara/ofislere/markalara kendini anlattığı ana sunum
  // sayfası; kurumsal sayfalardan daha yüksek öncelik, içeriği (canlı sayaçlar) haftalık değişir.
  { loc: '/neden-mimarlab', changefreq: 'weekly', priority: '0.8' },
  { loc: '/hakkinda', changefreq: 'monthly', priority: '0.5' },
  { loc: '/iletisim', changefreq: 'monthly', priority: '0.5' },
  // gerçek bulgu: bu ikisi indexlenebilir (robots noindex YOK, bkz. INFO_MODAL_META) ama sitemap'te
  // hiç yer almıyordu — Rozet Al/İade Et bilerek dışında bırakıldı, onlar noindex.
  { loc: '/gizlilik-politikasi', changefreq: 'yearly', priority: '0.2' },
  { loc: '/hizmet-sartlari', changefreq: 'yearly', priority: '0.2' },
  { loc: '/cerez-politikasi', changefreq: 'yearly', priority: '0.2' },
];

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|avif|gif|svg)$/i;
// Repo'ya gömülü statik görseller (logos/, mimarlar/, projects/, miras/) aynı path'te üzerine
// yazılabildiği için tam `immutable` değil — 7 gün tarayıcı + 30 gün stale-while-revalidate.
// /media/* (R2 upload) zaten UUID key'li, gerçekten immutable ve handleMediaRoute'ta ayrıca ayarlı.
const STATIC_IMAGE_CACHE_HEADERS = { 'Cache-Control': 'public, max-age=604800, stale-while-revalidate=2592000' };
// denetim bulgusu (2026-08-24, ücretsiz-katman performans turu): kök seviyesi paylaşılan .js
// dosyaları (auth-nav.js, js/components/*.js vb. — neredeyse her sayfada 16-23 tanesi <script defer>
// ile yükleniyor) Cloudflare Assets'in markasız varsayılanı olan `max-age=0, must-revalidate` ile
// serviliyordu; ETag DOĞRU olsa da (deploy'da içerik değişince otomatik değişir) bu her navigasyonda
// HER script dosyası için TAM bir koşullu-GET round-trip'e (304 bile olsa) mal oluyordu — ör. proje.html
// üzerinde art arda birkaç proje popup'ı açan bir ziyaretçi aynı 20+ değişmemiş dosya için tekrar
// tekrar ağa gidiyordu. LIST_PAGE_CACHE_HEADERS'taki (aşağısı) AYNI 60sn/300sn değerleri kullanılır —
// bu repo'da zaten kanıtlanmış, tazelik/round-trip dengesi — yeni bir politika icat ETMEK yerine.
const SCRIPT_EXT_RE = /\.js$/i;
const STATIC_SCRIPT_CACHE_HEADERS = { 'Cache-Control': 'public, max-age=60, s-maxage=300' };
// .wasm/.onnx (kullanıcı isteği, 2026-09-03 — tarayıcı-taraflı CLIP embedding, bkz. models/ ve
// js/vendor/ort/) GERÇEKTEN değişmez içeriktir: bir model/çalışma zamanı güncellemesi her zaman
// YENİ bir dosya adına gider (bu depodaki sürüm disiplini — bkz. src/lib/imageEmbedIndex.js#
// IMAGE_INDEX_VERSION), aynı yol asla farklı bayt döndürmez. STATIC_SCRIPT_CACHE_HEADERS'ın 60sn'lik
// kısa TTL'i burada anlamsız olurdu — 88,6 MB'lık model dosyası ARAMA KULLANAN her ziyaretçide
// tekrar tekrar koşullu-GET'e zorlanırdı. `immutable` tarayıcıya revalidate'i TAMAMEN atlatır.
const LARGE_BINARY_EXT_RE = /\.(wasm|onnx)$/i;
const LARGE_BINARY_CACHE_HEADERS = { 'Cache-Control': 'public, max-age=31536000, immutable' };

// GET /models/<dosya> — GERÇEK GÖRSEL EMBEDDING (kullanıcı isteği, 2026-09-03 ikinci tur, bkz.
// image-clip-embed.js dosya başı yorumu) için self-host edilen CLIP görsel kodlayıcısı (88,6 MB).
// R2'den servis edilir, statik ASSETS'ten DEĞİL — Cloudflare Workers statik varlıkları tek dosya
// başına 25 MiB ile sınırlıdır (resmi limit, doğrulandı) ve bu dosya onu aşıyor. js/vendor/ort/
// altındaki WASM çalışma zamanı (~11 MB, sınırın altında) sıradan statik varlık olarak kalmaya
// devam ediyor — yalnızca bu TEK büyük dosya için R2 yolu gerekti.
async function handleModelAssetRoute(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorJson('Bulunamadı', 404);
  const key = url.pathname.slice(1); // "models/clip-vision-uint8.onnx" — R2'deki anahtarla AYNI
  // Path traversal/istenmeyen erişim yüzeyi: yalnızca "models/" öneki + güvenli dosya adı karakterleri.
  if (!/^models\/[a-z0-9_-]+\.(onnx|wasm)$/i.test(key)) return errorJson('Bulunamadı', 404);
  const object = await env.UPLOADS.get(key);
  if (!object) return errorJson('Bulunamadı', 404);
  const headers = new Headers();
  headers.set('Content-Type', 'application/octet-stream');
  headers.set('Content-Length', String(object.size));
  for (const [k, v] of Object.entries(LARGE_BINARY_CACHE_HEADERS)) headers.set(k, v);
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(object.body, { status: 200, headers });
}
// SSR enjeksiyonu yapılmış detay sayfaları için: kısa tarayıcı cache'i + edge'de daha uzun ömür.
// Ayrıca Cache API (caches.default) ile edge'e de yazılıyor (bkz. serveDetailPage) — yüksek
// trafikte her istek ASSETS.fetch + HTMLRewriter çalıştırmak zorunda kalmaz. s-maxage önceden 3600
// (1 saat) idi; admin bir kaydı değiştirdiğinde artık aynı anda purgeSsrDetailCache (bkz. src/lib/
// ssrCache.js) çağrılıyor olsa da caches.default PoP-başına olduğundan bu yalnızca YAZMA isteğini
// işleyen edge node'u temizler — başka bir PoP'taki eski girdi kendi süresi dolana kadar yaşar
// (bkz. publicCache.js#ANON_CACHE_HEADERS'taki aynı gerekçeyle önceden 300'den 15'e indirilmesi).
// 300'e (5 dk) indirmek, purge'ün kaçırdığı PoP'lar için de en kötü durumdaki bayatlık penceresini
// makul bir aralığa çeker.
// KÖKTEN BULGU (2026-08-13): burada daha önce `stale-while-revalidate=86400` de vardı — publicCache.js
// #PUBLIC_LIST_CACHE_HEADERS'ta tam bu sebeple kaldırılmış aynı direktif, buraya hiç sıçratılmamıştı.
// Bu header doğrudan tarayıcıya gidiyor ve modern Chrome/Firefox swr'yi harfiyen uyguluyor: bir sekme
// bir detay/liste sayfasını daha önce açmışsa, max-age (60sn) geçmiş olsa bile TAMAMEN BAYAT HTML'i
// (eski title/OG/JSON-LD dahil) ağa hiç gitmeden ANINDA gösterip arka planda sessizce yeniliyordu —
// bu pencere 24 saate kadar çıkabiliyordu. Kaldırılması yeni bir ağ isteğine yol açar ama edge zaten
// s-maxage=300 ile Cache API'de tutuluyor, bu yüzden CDN tarafında ek maliyet yok.
const SSR_PAGE_CACHE_HEADERS = { 'Cache-Control': 'public, max-age=60, s-maxage=300' };
// audit bulgusu: bu 5 liste sayfası tamamen statik bir HTML kabuğu döner (veri her zaman istemci
// tarafında /api/* uçlarından çekilir, bkz. proje.js/mimar.js vb. — SSR_PAGE_CACHE_HEADERS'ın aksine
// burada D1'e bağlı hiçbir enjeksiyon/purge gereksinimi yok), ama Cloudflare Assets'in varsayılan
// `max-age=0, must-revalidate` başlığıyla serviliyordu — her ziyaret tam bir round-trip'e mal
// oluyordu. SSR_PAGE_CACHE_HEADERS'la AYNI süreler kullanılır (tutarlılık); içerik değişimi zaten
// istemci tarafı fetch'lerle (kendi kısa TTL'li önbellekleriyle) yansıdığından kabuğun birkaç dakika
// bayat kalması sorun yaratmaz.
const LIST_PAGE_CACHE_HEADERS = SSR_PAGE_CACHE_HEADERS;
// '/neden-mimarlab' de AYNI gerekçeyle burada: tamamen statik bir HTML kabuğu (canlı sayaçlar
// istemci tarafında /api/public/platform'dan çekilir, sayfada D1'e bağlı hiçbir SSR enjeksiyonu
// yok), ama Assets'in markasız `max-age=0, must-revalidate` varsayılanıyla servis ediliyordu.
const LIST_PAGE_PATHS = new Set(['/', '/proje', '/kisi', '/firma', '/urun', '/marka', '/neden-mimarlab']);
// audit bulgusu: max-age=3600 + stale-while-revalidate=21600 (önceki), sitemap'in yeni onaylanan bir
// kayıttan sonra 1-7 saat bayat kalabilmesine yol açıyordu (canlıda doğrulandı: sitemap 1191 proje
// gösterirken D1'de 1192 vardı — duplicate slug DEĞİL, salt bu TTL penceresi). Sitemap üretimi ağır
// olmadığından (4 basit SELECT) süre kısaltılır; <lastmod> eklenmesiyle birlikte (bkz.
// handleSitemapRoute) Google'ın kendi tarama sıklığı da artık gerçek veriye dayanabilir.
const SITEMAP_CACHE_HEADERS = { 'Cache-Control': 'public, max-age=600, stale-while-revalidate=3600' };

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
    const startedAt = performance.now();
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
    let response;
    let errorMessage = null;
    // Faz 4D — bu try/catch artık YALNIZCA /api/ dalını değil TÜM dalları (asset/media/sitemap)
    // sarmalıyor: öncesinde /api/ dışındaki bir dalda fırlayan beklenmeyen bir hata Worker'ı
    // çökertip Cloudflare'in kendi genel hata sayfasını döndürürdü, hem de hiç loglanmadan.
    try {
      if (url.pathname.startsWith('/api/')) {
        response = await routeApi(request, env, url, ctx);
      } else if (url.pathname.startsWith('/media/')) {
        response = await handleMediaRoute(request, env, url, ctx);
      } else if (url.pathname.startsWith('/models/')) {
        response = await handleModelAssetRoute(request, env, url);
      } else if (url.pathname === '/sitemap.xml') {
        response = await handleSitemapRoute(request, env, ctx);
      } else if (SITEMAP_CHUNK_PATH_RE.test(url.pathname)) {
        response = await handleSitemapChunkRoute(request, env, ctx, Number(url.pathname.match(SITEMAP_CHUNK_PATH_RE)[1]));
      } else if (url.pathname === '/robots.txt') {
        // Admin panelden (Site Ayarları) düzenlenebilir robots.txt (bkz. src/lib/siteSettings.js) —
        // ayar boşsa (varsayılan) statik kök dosyaya AYNEN düşer, davranış değişmez.
        response = await handleRobotsTxt(env) || await routeAsset(request, env, url, ctx);
      } else {
        response = await maybeServeMaintenancePage(request, env, url) || await routeAsset(request, env, url, ctx);
      }
    } catch (err) {
      errorMessage = err?.message || String(err);
      response = errorJson('Sunucu hatası oluştu.', 500);
    }
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
    logRequest({ request, url, env, requestId, startedAt, status: response.status, errorMessage });
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },

  // ---------------------------------------------------------------------------------------------
  // CRON — GÖRSEL ARAMA VARLIK DİZİNİNİN ARTIMLI BAKIMI (kullanıcı isteği, 2026-09-03 madde 18:
  // "Yeni proje/ürün eklendiğinde otomatik olarak visual-search index'e dahil edilmeli").
  //
  // NEDEN CRON, NEDEN İSTEK ANINDA DEĞİL: bir projeyi kaydeden kullanıcı, embedding üretilmesini
  // beklememeli; ayrıca yükleme/düzenleme yollarının HEPSİNE (admin, submissions, canonicalSync,
  // toplu import betikleri, doğrudan D1 migration'ları) tek tek kanca takmak, ilerideki bir yeni
  // yolun sessizce dizini bozuk bırakmasına açık kapı bırakırdı — bu tam olarak bu depodaki
  // tekrar eden kök nedendir (bkz. proje notu: "doğru yardımcı, kod yolu taşınınca bypass edildi").
  // Cron bunun yerine GERÇEĞİ (D1'in kendisini) okur: belge hash'i değişmiş her satırı yakalar,
  // hangi kod yolundan değiştiğinden bağımsız olarak.
  //
  // MALİYET: değişiklik yoksa AI çağrısı ve KV yazımı SIFIRDIR (bkz. rebuildIndex). Tur başına
  // en fazla 400 embedding sınırı, kötü bir durumda (toplu import) maliyeti de süreyi de kelepçeler.
  // ---------------------------------------------------------------------------------------------
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      for (const type of ['project', 'product']) {
        try {
          const res = await rebuildIndex(env, type, { maxEmbeds: 400 });
          console.log('visualIndex cron', JSON.stringify(res));
        } catch (err) {
          console.error('visualIndex cron başarısız', type, err && err.message);
        }
      }
    })());
  },
};

async function routeAsset(request, env, url, ctx) {
  // Trailing-slash normalizasyonu (denetim bulgusu, 2026-08-14): /proje/:slug/ (sondaki eğik
  // çizgiyle) ile /proje/:slug birebir AYNI içeriği 200 ile döndürüyordu — serveDetailPage zaten
  // slug'ı ayıklarken sondaki eğik çizgiyi siliyordu (bkz. aşağıdaki rawSlug), ama gerçek bir 301
  // hiçbir zaman yoktu, yalnızca canonical <link> etiketi duplicate-content'i HAFİFLETİYORDU,
  // ORTADAN KALDIRMIYORDU. Kök '/' hariç (o zaten kanonik biçim) tüm sondaki eğik çizgileri (birden
  // fazlaysa TEK adımda) 301 ile kaldırır — sorgu dizesi korunur. GET+HEAD (redirect'in anlamlı
  // olduğu iki yöntem — POST bu dallara zaten hiç ulaşmaz, tümü /api/ altında).
  if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.length > 1 && url.pathname.endsWith('/')) {
    const dest = new URL(url);
    dest.pathname = url.pathname.replace(/\/+$/, '');
    return Response.redirect(dest.href, 301);
  }

  if (isDisabledPagePath(url.pathname)) return notFoundPageResponse();

  // /favicon.ico — denetim bulgusu (2026-09-05): canlıda 404 dönüyordu. Site sayfaları ikonu
  // <link rel="icon" href="/logos/site/favicon-32.png"> ile bildiriyor, ama o etiketi HİÇ
  // görmeyen istemciler kök /favicon.ico'yu ister: (a) tarayıcıların bu depoda <link> taşımayan
  // Worker-üretimi sayfaları — notFoundPageResponse ve maintenanceResponse, (b) RSS/okuyucu,
  // sohbet/paylaşım önizlemeleri ve ikonu yalnızca kök yoldan arayan tarayıcılar. Yönlendirme
  // yerine İÇ YENİDEN YAZMA kullanılır (ekstra bir 301 hop'u yok); PNG baytları .ico uzantısıyla
  // servis edilse de Content-Type doğru (image/png) döndüğünden tüm modern tarayıcılar kabul eder.
  if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/favicon.ico') {
    const iconUrl = new URL(url);
    iconUrl.pathname = '/logos/site/favicon-32.png';
    const iconRes = await env.ASSETS.fetch(new Request(iconUrl, request));
    return withStaticAssetCacheHeaders(iconUrl, iconRes);
  }

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

  // audit bulgusu: /proje.html?slug=X (ve mimar/firma/urun eşdeğerleri) gibi eski sorgu-dizesi
  // biçimindeki linkler artık site içinde HİÇ üretilmiyor (bkz. js/pages/proje.js#"/proje/${slug}"
  // path-tabanlı linkleme) ama olası eski dış bağlantılar/yer imleri için canlıda hâlâ erişilebilirdi
  // — CLEAN_URL_ASSETS'teki '/proje/' öneki bir sorgu dizesiyle EŞLEŞMEDİĞİNDEN bu istek aşağıdaki
  // ASSETS.fetch'e düşüp o projeye özgü DEĞİL, GENERİK liste sayfası title/meta/canonical'ıyla
  // serviliyordu (redirectKey burada zaten '/proje' olur, bu yüzden yukarısı yakalayamaz — o yalnızca
  // CLEAN_URL_REDIRECTS'teki '-detay' önekli eski anahtarları hedefler).
  const legacySlugAsset = CLEAN_URL_ASSETS.find(r => r.asset === redirectKey);
  const legacySlugValue = legacySlugAsset ? url.searchParams.get('slug') : null;
  if (legacySlugValue) {
    return Response.redirect(new URL(`${legacySlugAsset.asset}/${encodeURIComponent(legacySlugValue)}`, url.origin).href, 301);
  }

  // /pano/:token — paylaşılan pano (kullanıcı isteği, 2026-09-02). CLEAN_URL_ASSETS'ten AYRI
  // tutulur çünkü serveDetailPage D1'den SEO meta üretip SSR gövdesi enjekte eder; panolar ise
  // KİŞİSEL içeriktir, noindex'tir (bkz. pano.html) ve arama motoru meta'sı istenmez. Sayfa
  // token'ı kendi JS'inde URL'den okuyup GET /api/collections/shared/:token ile doldurur.
  if (url.pathname.startsWith('/pano/') && url.pathname.length > '/pano/'.length) {
    const panoUrl = new URL(url);
    panoUrl.pathname = '/pano';
    const panoRes = await env.ASSETS.fetch(new Request(panoUrl, request));
    return withStaticAssetCacheHeaders(url, panoRes);
  }

  const cleanRoute = CLEAN_URL_ASSETS.find(r => url.pathname.startsWith(r.prefix) && url.pathname.length > r.prefix.length);
  if (cleanRoute) return serveDetailPage(request, env, url, cleanRoute, ctx);

  // AUTH_MODAL_META ve INFO_MODAL_META artık AYNI yolu paylaşıyor (bkz. AUTH_MODAL_META'daki SEO
  // denetimi notu) — serveInfoModalPage zaten "ana sayfayı servis et + kendi meta'sını enjekte et"
  // işini yapıyor; auth yolları için ayrıca bir '/index' 307 tuzağı da yok, çünkü o fonksiyon da
  // assetUrl.pathname'i doğrudan '/' yapar.
  const infoMeta = AUTH_MODAL_META[url.pathname] || INFO_MODAL_META[url.pathname];
  if (infoMeta) return serveInfoModalPage(request, env, url, infoMeta);

  const response = await env.ASSETS.fetch(request);
  if (request.method === 'GET' && response.status === 200 && LIST_PAGE_PATHS.has(url.pathname)) {
    // HUB SAYFALARINA ItemList YAPILANDIRILMIŞ VERİSİ (SEO). Bu beş sayfanın ham HTML'inde detay
    // sayfalarına dair HİÇBİR sinyal yoktu — 4.000 detay sayfasının keşfi tamamen sitemap'e
    // bağlıydı. Sinyal artık sayfanın GÖVDESİNE değil, sayfanın kendi SEO meta bloğuna (<head>
    // içindeki JSON-LD, detay sayfalarındaki injectMeta ile AYNI mekanizma) yazılır; görünen
    // tasarım hiç değişmez. Tam gerekçe + veri kaynağı: src/lib/hubLinks.js. Hata durumunda null
    // döner ve sayfa eskisi gibi servis edilir — SEO iyileştirmesi sayfayı ASLA düşürmemeli.
    let hubJsonLd = null;
    if (isHubPath(url.pathname)) {
      hubJsonLd = await hubItemListJsonLd(url.pathname, () => loadHubPool(env, url.pathname));
    }
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(LIST_PAGE_CACHE_HEADERS)) headers.set(k, v);
    if (hubJsonLd) {
      // injectMeta'daki AYNI kaçış kuralı: '<' escape edilmezse veri script bağlamından çıkabilir.
      const ld = JSON.stringify(hubJsonLd).replace(/</g, '\\u003c');
      const rewritten = new HTMLRewriter()
        .on('head', { element(el) { el.append(`<script type="application/ld+json">${ld}</script>`, { html: true }); } })
        .transform(response);
      return new Response(rewritten.body, { status: response.status, statusText: response.statusText, headers });
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  // denetim bulgusu: DISABLED_PAGE_PATHS/detay-slug 404'lerinin (notFoundPageResponse/
  // notFoundDetailPageResponse) aksine, buraya kadar hiçbir kurala uymayan TAMAMEN rastgele bir yol
  // (ör. /rastgele-yol) Cloudflare Assets'in markasız varsayılan 404 sayfasına düşüyordu. Yalnızca
  // gerçek sayfa/navigasyon istekleri (Accept: text/html) için markalı 404'e çevrilir — eksik statik
  // dosyalar (görsel/CSS/JS/favicon vb.) hâlâ sade bir 404 alır, HTML gövdesiyle "onarılmaz".
  if (response.status === 404 && request.method === 'GET' && (request.headers.get('Accept') || '').includes('text/html')) {
    return notFoundPageResponse();
  }
  return withStaticAssetCacheHeaders(url, response);
}

// Rozet Al/İade Et/İletişim/Hakkında/Gizlilik Politikası/Hizmet Şartları/Kariyer — AUTH_MODAL_ROUTES
// ile AYNI "ana sayfayı servis et" yaklaşımı ama title/description/canonical/OG enjeksiyonu da
// eklenir (bkz. INFO_MODAL_META yukarısındaki yorum — bu sayfaların çoğu, Rozet Al/İade Et'in aksine
// gerçekten indexlenir). serveDetailPage'in Cache API katmanını (D1'den okuyan buildMeta çağrısına
// bağımlı, admin bir kayıt değiştirdiğinde purge edilmesi gereken) BİLEREK kullanmaz — buradaki meta
// tamamen statik (INFO_MODAL_META), yalnızca kod deploy edildiğinde değişir; Worker zaten her
// deploy'da yeniden başladığından ayrı bir sürüm/cache-invalidasyon mekanizmasına gerek yok.
async function serveInfoModalPage(request, env, url, meta) {
  const assetUrl = new URL(url);
  assetUrl.pathname = '/';
  const assetResponse = await env.ASSETS.fetch(new Request(assetUrl, request));
  if (assetResponse.status !== 200) return assetResponse;

  const canonicalUrl = `${SITE_ORIGIN}${url.pathname}`;
  const rewritten = injectMeta(assetResponse, {
    title: meta.title,
    description: meta.description,
    // bkz. INFO_MODAL_META yukarısındaki h1 notu — index.html#entity-h1'i bu yolun kendi başlığına
    // çevirir. AUTH_MODAL_META girdilerinde h1 YOKTUR (hepsi noindex hesap ekranları), injectMeta'nın
    // h1 kuralı da `if (meta.h1)` ile korunduğundan orada sessizce hiçbir şey yapmaz.
    h1: meta.h1,
    canonicalUrl,
    image: `${SITE_ORIGIN}/logos/site/mimarlab-og-image.png`,
    jsonLd: { '@context': 'https://schema.org', '@type': 'WebPage', name: meta.title, url: canonicalUrl, isPartOf: { '@type': 'WebSite', name: 'MİMARLAB', url: `${SITE_ORIGIN}/` } },
  });
  const headers = new Headers(rewritten.headers);
  for (const [k, v] of Object.entries(SSR_PAGE_CACHE_HEADERS)) headers.set(k, v);
  let finalResponse = new Response(rewritten.body, { status: rewritten.status, statusText: rewritten.statusText, headers });
  if (meta.noindex) {
    finalResponse = new HTMLRewriter()
      .on('head', { element(el) { el.append('<meta name="robots" content="noindex, follow">', { html: true }); } })
      .transform(finalResponse);
  }
  return finalResponse;
}

// DISABLED_PAGE_PATHS/PREFIXES için basit, markalı bir 404 — site genelinde ayrı bir statik
// 404.html dosyası olmadığından (Cloudflare Assets varsayılanı kullanılıyordu) burada minimal
// bir sayfa döndürülür.
function notFoundPageResponse() {
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, follow">
<title>Sayfa Bulunamadı — MİMARLAB</title>
<style>
body{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#F5F3EF; color:#1B2A3D; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; text-align:center; padding:24px;}
.box{max-width:420px;}
h1{font-size:22px; margin:0 0 12px;}
p{font-size:14.5px; color:rgba(27,42,61,0.7); margin:0 0 24px;}
a{display:inline-block; background:#1B2A3D; color:#F5F3EF; text-decoration:none; padding:11px 22px; border-radius:100px; font-size:14px; font-weight:600;}
</style></head><body>
<div class="box"><h1>Bu sayfa artık yayında değil</h1><p>Aradığınız içerik kaldırılmış olabilir.</p><a href="/">Ana Sayfaya Dön</a></div>
</body></html>`;
  return new Response(html, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// /proje|mimar|firma|urun/:slug altında eşleşmeyen bir slug için serveDetailPage tarafından
// çağrılır — listeleme şablonunun AYNI HTML gövdesi korunur (client JS zaten doğru "bulunamadı"
// durumunu kendi başına render ediyor), yalnızca durum kodu 404'e çevrilir ve bot'ların bu boş
// kabuğu indekslememesi için noindex meta'sı eklenir.
// status: 404 (hiç var olmamış/yanlış yazılmış slug) | 410 (denetim bulgusu, 2026-08-14: kayıt
// GERÇEKTEN vardı, admin tarafından bilerek gizlendi/silindi — bkz. çağıran taraftaki
// isKnownButHidden kontrolü). 410 arama motorlarına 404'ten daha güçlü, kalıcı bir "bu içerik
// bilerek kaldırıldı, tekrar deneme" sinyali verir.
function notFoundDetailPageResponse(assetResponse, status = 404) {
  const rewritten = new HTMLRewriter()
    .on('head', { element(el) { el.append('<meta name="robots" content="noindex, follow">', { html: true }); } })
    .transform(assetResponse);
  const statusText = status === 410 ? 'Gone' : 'Not Found';
  return new Response(rewritten.body, { status, statusText, headers: rewritten.headers });
}

// eskiden yalnızca görselleri kapsıyordu (withStaticImageCacheHeaders) — artık .js dosyalarını da
// (bkz. STATIC_SCRIPT_CACHE_HEADERS yukarısı) kapsadığından adı genelleştirildi; iki çağıran taraf da
// (aşağısı) güncellendi.
function withStaticAssetCacheHeaders(url, response) {
  if (response.status !== 200) return response;
  const extHeaders = IMAGE_EXT_RE.test(url.pathname) ? STATIC_IMAGE_CACHE_HEADERS
    : LARGE_BINARY_EXT_RE.test(url.pathname) ? LARGE_BINARY_CACHE_HEADERS
    : SCRIPT_EXT_RE.test(url.pathname) ? STATIC_SCRIPT_CACHE_HEADERS
    : null;
  if (!extHeaders) return response;
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(extHeaders)) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// /kisi/:slug, /firma/:slug, /yapi/:slug, /haberler/:id — statik şablonu ASSETS'ten alır,
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

  const rawSlug = decodeURIComponent(url.pathname.slice(cleanRoute.prefix.length).replace(/\/$/, ''));
  // gerçek bulgu (production audit, 2026-08-17): ASSETS.fetch (statik şablon) ve buildMeta (D1
  // sorgusu) birbirinden bağımsızdır ama sıralı await ediliyordu — cache MISS'te (ilk istek/
  // SSR_CACHE_VERSION bump sonrası/TTL sonrası) TTFB'ye gereksiz bir D1 round-trip'i ekliyordu.
  // metaResult — buildMeta artık "kayıt yok"u (null) "aramada hata oldu"dan (MetaLookupError,
  // bkz. src/lib/seo.js) AYIRT EDİYOR (kullanıcı isteği, 2026-09-01 madde 4). Geçici bir D1
  // hatası eskiden yayındaki GERÇEK bir kaydı 404'e düşürüyordu — bu, arama motoru için kalıcı
  // bir "bu URL yok" sinyalidir ve sayfa indeksten düşerdi. Promise.all reddi asset fetch'ini de
  // boşa çıkarmasın diye hata BURADA sarılıp aşağıda 503'e çevrilir.
  const [assetResponse, metaResult] = await Promise.all([
    env.ASSETS.fetch(new Request(assetUrl, request)),
    rawSlug
      ? buildMeta(cleanRoute.type, rawSlug, env).then(m => ({ meta: m }), (err) => ({ error: err }))
      : Promise.resolve({ meta: null }),
  ]);
  if (metaResult.error) {
    // 503 + Retry-After: arama motorlarına "geçici, URL'yi düşürme, sonra tekrar dene" der
    // (404/410'un aksine). Cache-Control:no-store — bu yanıt HİÇBİR katmanda saklanmamalı,
    // yoksa geçici bir kesinti s-maxage boyunca dondurulmuş olurdu.
    return new Response('Bu sayfa şu an yüklenemedi, lütfen birazdan tekrar dene.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '60', 'Cache-Control': 'no-store' },
    });
  }
  const meta = metaResult.meta;

  // gerçek bulgu (production audit, 2026-08-17): slug büyük/küçük harf duyarlıydı — ör.
  // /proje/Khalkedon-Kalintilari canonical küçük-harf slug'a değil düz 404'e düşüyordu. Depolanan
  // tüm slug'lar zaten slugify() ile üretilip yalnızca [a-z0-9-] içerir (bkz. slugify.js) —
  // rawSlug'ın slugify'lanmış hâli KENDİSİNDEN FARKLIYSA ve bu normalize edilmiş slug gerçekten bir
  // kayıtla eşleşiyorsa canonical URL'e 301 ile yönlendirilir. slugify() idempotent olduğundan
  // (normalizedSlug'ı tekrar slugify etmek aynı sonucu verir) bu redirect döngü oluşturmaz —
  // eşleşmezse mevcut slug_redirects/404 akışı DEĞİŞMEDEN aşağıda devam eder.
  if (!meta && rawSlug) {
    const normalizedSlug = slugify(rawSlug);
    if (normalizedSlug && normalizedSlug !== rawSlug) {
      // .catch(() => null): buildMeta artık hata fırlatıyor (bkz. yukarıdaki metaResult yorumu) —
      // burada asıl arama ZATEN "kayıt yok" demişti, bu yalnızca ek bir redirect yoklaması; hata
      // durumunda "yönlendirme yok" varsayılıp mevcut 404 akışı DEĞİŞMEDEN sürer.
      const normalizedMeta = await buildMeta(cleanRoute.type, normalizedSlug, env).catch(() => null);
      if (normalizedMeta) {
        const dest = new URL(normalizedMeta.canonicalUrl);
        dest.search = url.search;
        return Response.redirect(dest.href, 301);
      }
    }
  }
  // Slug bulunamadıysa, bu bir yeniden adlandırma sonrası bayatlamış (paylaşılmış/indekslenmiş) bir
  // eski URL olabilir (bkz. migrations/0041_slug_redirects.sql, kullanıcı isteği: "ismi değişirse
  // URL'si de değişmeli ... eski URL'ler kırılmasın") — varsa güncel slug'a 301 ile yönlendirilir.
  if (!meta && rawSlug) {
    const entityType = ENTITY_TYPE_BY_DETAIL_TYPE[cleanRoute.type];
    const newSlug = entityType ? await resolveSlugRedirect(env, entityType, rawSlug) : null;
    if (newSlug) {
      const newMeta = await buildMeta(cleanRoute.type, newSlug, env).catch(() => null); // bkz. bir üstteki .catch gerekçesi
      if (newMeta) {
        const dest = new URL(newMeta.canonicalUrl);
        dest.search = url.search;
        return Response.redirect(dest.href, 301);
      }
    }
  }
  if (assetResponse.status !== 200) return assetResponse;
  // gerçek bulgu: slug hiçbir kayıtla eşleşmiyorsa (silinmiş/yeniden adlandırılmış/yanlış yazılmış,
  // yukarıdaki slug-redirect kontrolü de boşsa) burası önceden hep 200 OK ile çıplak listeleme
  // şablonunu dönüyordu — istemci tarafı (bkz. js/components/project-modal.js#renderNotFound vb.)
  // zaten item:null'ı doğru şekilde "bulunamadı" modalıyla render ediyordu, yalnızca HTTP durum kodu
  // yanlıştı. Arama motorları bunu "soft 404" olarak işaretleyip tarama bütçesini/indeksleme
  // güvenini düşürüyordu (bkz. src/lib/publicCache.js#statusFor — /api/project|architect|office|
  // product/:slug uçlarındaki AYNI düzeltmenin sayfa-seviyesi karşılığı).
  if (!meta) {
    const wasHidden = await isKnownButHidden(cleanRoute.type, rawSlug, env);
    return notFoundDetailPageResponse(assetResponse, wasHidden ? 410 : 404);
  }

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

// Hub yoluna karşılık gelen KV ÖNBELLEKLİ havuzu döndürür (ek D1 maliyeti yok — bkz.
// src/lib/hubLinks.js "VERİ KAYNAĞI"). /marka, /firma ile AYNI havuzu kullanır; marka/firma ayrımı
// office-kind.js'in tek kaynağıyla yapılır (bkz. src/routes/platform.js'teki AYNI kural — ayrı bir
// predicate yazmak listede görünen kümeden sapan bir bağlantı listesi üretirdi).
async function loadHubPool(env, pathname) {
  if (pathname === '/proje') return fetchActiveProjectPoolCached(env, 'built');
  if (pathname === '/kisi') return fetchArchitectPool(env);
  if (pathname === '/urun') return fetchProductPool(env);
  if (pathname === '/firma' || pathname === '/marka') {
    const offices = await fetchOfficePool(env);
    const { isBrandOffice, isPureBrandOffice } = officeKindJs;
    return pathname === '/marka'
      ? offices.filter(o => isBrandOffice(o.cats, o.productCount))
      : offices.filter(o => !isPureBrandOffice(o.cats, o.productCount));
  }
  return [];
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
  // denetim bulgusu (2026-08-14): proje/mimar/firma/urun.html'in paylaşılan listeleme şablonundaki
  // statik <h1> ("Projeler"/"Mimarlar"/"Firmalar"/"Ürünler") bu fonksiyon SSR'da title/canonical/OG/
  // JSON-LD'yi kayda göre güncellerken HİÇ dokunulmadan kalıyordu — botlar/sosyal önizlemeler için
  // <title> kayıt adını, <h1> jenerik liste başlığını gösteriyordu. meta.h1 YALNIZCA architect/office/
  // project/product üreticilerinde set edilir (bkz. src/lib/seo.js) — INFO_MODAL_META gibi h1'i
  // olmayan/güncellenmesi gerekmeyen çağrılarda kural sessizce hiçbir şey yapmaz.
  const h1Handler = { element(el) { if (meta.h1) el.setInnerContent(meta.h1); } };
  // denetim bulgusu (2026-08-22): proje/mimar/firma/ürün detay sayfalarının ham HTML body'si
  // <head>'deki bu fonksiyonun ürettiği JSON-LD dışında hiçbir gerçek içerik taşımıyordu — JS
  // çalışmadan (crawler/paylaşım botu/yavaş bağlantı) sayfa yalnızca boş bir liste kabuğu olarak
  // görünüyordu (bkz. src/lib/seo.js#bodyHtml yorumu). #ssr-entity-body, proje/mimar/firma/urun.html
  // şablonlarının hepsinde `.page-head` altında BOŞ duran, listeleme sayfasında (meta yokken) hiç
  // dokunulmayan bir konteyner — client-side modal (bkz. js/components/*-modal.js) bunun üstüne tam
  // ekran bir overlay açtığından hydration sonrası çakışma olmaz, yalnızca JS'ten önce görünen
  // gerçek bir SSR fallback'tir.
  const escapeForAttr = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bodyHandler = {
    element(el) {
      if (!meta.bodyHtml) return;
      // Görsel performans optimizasyonu (2026-09-01) — bu görsel CSS'te 160x160 px (mobilde en fazla
      // 280 px) render ediliyor (bkz. proje.html#.ssr-entity img) ama ORİJİNALİ yükleniyordu:
      // /proje/y-evi-bodrum'a doğrudan girildiğinde (Google/paylaşım linki — yani sayfanın en yaygın
      // GİRİŞ noktası) 160 px'lik bir küçük resim için 2400 px / 640 KB indiriliyordu, üstelik
      // loading="eager" ile. En küçük türev basamağı (400 px) 160 px'lik slot için 2,5x yeterli.
      // meta.image (OG/Twitter paylaşım görseli) BİLEREK DEĞİŞMEDİ — sosyal medya crawler'ları büyük
      // görsel bekler, orası küçültülmemeli.
      const img = meta.bodyImage
        ? `<img src="${escapeForAttr(derivedImageUrl(meta.bodyImage, 400))}" alt="${escapeForAttr(meta.bodyImageAlt)}" loading="eager">`
        : '';
      el.setInnerContent(`${img}<div class="ssr-entity-text">${meta.bodyHtml}</div>`, { html: true });
    },
  };
  return new HTMLRewriter()
    .on('title', { element(el) { el.setInnerContent(meta.title); } })
    .on('h1#entity-h1', h1Handler)
    .on('h1#page-title', h1Handler)
    .on('#ssr-entity-body', bodyHandler)
    .on('meta#meta-description', { element(el) { el.setAttribute('content', meta.description); } })
    .on('link#canonical-link', { element(el) { el.setAttribute('href', meta.canonicalUrl); } })
    // audit bulgusu: og:type tüm detay sayfalarında şablondaki sabit "website" değerinde kalıyordu —
    // meta.ogType YALNIZCA proje ('article')/ürün ('product') üreticilerinde set edilir (bkz.
    // src/lib/seo.js#buildProjectMeta/productMetaFromRecord); mimar/firma için Open Graph çekirdek
    // sözlüğünde kuruma/kişiye uyan iyi bir tip yok, "website" doğru varsayılan olarak kalır.
    .on('meta#og-type', { element(el) { el.setAttribute('content', meta.ogType || 'website'); } })
    // gerçek bulgu (denetim raporu, 2026-08-16): og:type="article" article:published_time'sız
    // kalıyordu (bkz. src/lib/seo.js#buildProjectMeta) — meta.publishedTime YALNIZCA proje
    // üreticisinde set edilir, diğer tüm çağrılarda (mimar/firma/ürün/liste sayfaları) etiket
    // anlamsız boş content taşımasın diye tamamen kaldırılır.
    .on('meta#og-article-published-time', { element(el) { if (meta.publishedTime) el.setAttribute('content', meta.publishedTime); else el.remove(); } })
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

// denetim bulgusu (2026-08-13): sitemap tek <urlset> içinde TÜM kayıtları dönüyordu, sitemaps.org
// protokolünün 50.000 URL limitine karşı hiçbir bölme/kontrol yoktu — bugünkü kayıt sayısı limitin
// çok altında olsa da mimari büyümeye karşı kırılgandı. SITEMAP_CHUNK_SIZE limitin altında güvenli
// bir pay bırakır; toplam URL sayısı bunu aşarsa /sitemap.xml artık <sitemapindex>'e geçer ve gerçek
// URL'ler /sitemap-1.xml, /sitemap-2.xml ... üzerinden dağıtılır (bkz. handleSitemapChunkRoute).
// Aşmadığı sürece (bugünkü durum) /sitemap.xml eskisi gibi TEK <urlset> döner — mevcut davranış/
// Google Search Console'daki kayıtlı URL DEĞİŞMEZ.
const SITEMAP_CHUNK_SIZE = 40000;
const SITEMAP_CHUNK_PATH_RE = /^\/sitemap-(\d+)\.xml$/;

// listEntityUrls() yalnızca statik data.js/projeler-data.js/haberler-data.js dizilerini okur —
// Faz 3 migrasyonundan sonra yalnızca canonical D1'de yaşayan (admin panelinden eklenmiş) mimar/
// ofis/proje/ürün kayıtları bu dizilerde HİÇ görünmez, dolayısıyla sitemap'te de eksik kalırdı
// (bkz. kullanıcı isteği: "sitemap.xml ... eksiksiz servis edildiğinden emin ol" — gerçek bulgu).
// İki kaynak da bir Map üzerinden (url -> lastmod) birleştirilip aynı slug için TEKİL bir <url>
// üretilir — listEntityUrls() lastmod taşımadığından (statik/build-zamanlı) null ile eklenir,
// canonical D1 kaynağı kendi updated_at'ini taşır (audit bulgusu: <lastmod> daha önce hiç yoktu).
async function buildSitemapUrlBlocks(env) {
  const entityUrls = new Map([...listEntityUrls().map(loc => [loc, null]), ...await listCanonicalEntityUrls(env)]);
  const lastmodTag = lastmod => lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : '';
  return [
    ...SITEMAP_STATIC_PAGES.map(p => `  <url>\n    <loc>${SITE_ORIGIN}${p.loc}</loc>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`),
    ...[...entityUrls].map(([loc, lastmod]) => `  <url>\n    <loc>${SITE_ORIGIN}${loc}</loc>${lastmodTag(lastmod)}\n    <changefreq>monthly</changefreq>\n  </url>`),
  ];
}

async function handleSitemapRoute(request, env, ctx) {
  const cached = await cacheMatch(request);
  if (cached) return cached;

  const urls = await buildSitemapUrlBlocks(env);
  let xml;
  if (urls.length > SITEMAP_CHUNK_SIZE) {
    const chunkCount = Math.ceil(urls.length / SITEMAP_CHUNK_SIZE);
    const now = new Date().toISOString();
    const sitemaps = Array.from({ length: chunkCount }, (_, i) =>
      `  <sitemap>\n    <loc>${SITE_ORIGIN}/sitemap-${i + 1}.xml</loc>\n    <lastmod>${now}</lastmod>\n  </sitemap>`
    );
    xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemaps.join('\n')}\n</sitemapindex>\n`;
  } else {
    xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
  }
  const response = new Response(xml, { status: 200, headers: { 'Content-Type': 'application/xml; charset=utf-8', ...SITEMAP_CACHE_HEADERS } });

  if (ctx) ctx.waitUntil(cachePut(request, response.clone()));
  return response;
}

// SITEMAP_CHUNK_SIZE aşıldığında handleSitemapRoute'un <sitemapindex>'te işaret ettiği alt
// sitemap'ler — geçersiz/aralık dışı bir chunk index'i için düz 404 döner.
async function handleSitemapChunkRoute(request, env, ctx, chunkIndex) {
  const cached = await cacheMatch(request);
  if (cached) return cached;

  const urls = await buildSitemapUrlBlocks(env);
  // SEO denetimi (2026-09-03): parçalama EŞİĞİN ALTINDAYKEN de /sitemap-1.xml 200 dönüyordu ve
  // /sitemap.xml'in TAMAMINI (canlıda 3.586 URL) tekrar servis ediyordu — yani aynı sitemap iki
  // ayrı URL'den erişilebilirdi. handleSitemapRoute bu durumda <sitemapindex> üretmediği için
  // hiçbir yerden bağlantı verilmiyor, ama URL yine de tahmin edilebilir/taranabilir. Parçalar
  // YALNIZCA gerçekten parçalanmış sitemap için anlamlıdır.
  if (urls.length <= SITEMAP_CHUNK_SIZE) return new Response('Bulunamadı', { status: 404 });
  const start = (chunkIndex - 1) * SITEMAP_CHUNK_SIZE;
  const slice = chunkIndex >= 1 ? urls.slice(start, start + SITEMAP_CHUNK_SIZE) : [];
  if (!slice.length) return new Response('Bulunamadı', { status: 404 });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${slice.join('\n')}\n</urlset>\n`;
  const response = new Response(xml, { status: 200, headers: { 'Content-Type': 'application/xml; charset=utf-8', ...SITEMAP_CACHE_HEADERS } });

  if (ctx) ctx.waitUntil(cachePut(request, response.clone()));
  return response;
}

// D1'in `datetime('now')` varsayılanı "YYYY-MM-DD HH:MM:SS" (UTC, boşluk ayraçlı) üretir — W3C
// datetime (sitemap <lastmod> için gereken biçim) ISO 8601 ister; yalnızca ayracı 'T'ye çevirip
// 'Z' eklemek yeterlidir (zaten UTC).
function toLastmod(sqliteDatetime) {
  return sqliteDatetime ? `${sqliteDatetime.replace(' ', 'T')}Z` : null;
}

// listEntityUrls (yalnızca statik diziler) ile birleştirilen canonical D1 kaynağı — architects/
// offices/projects/products tablolarının TAMAMI (statik + admin panelinden eklenenler) buradan
// gelir. lastmod: audit bulgusu — sitemap'in tarama önceliklendirmesi için Google'a hangi sayfaların
// güncellendiğini bildirmenin tek yolu, bkz. handleSitemapRoute.
async function listCanonicalEntityUrls(env) {
  if (!env || !env.DB) return [];
  const where = `deleted_at IS NULL AND hidden_at IS NULL`;
  const [archRes, officeRes, projRes, prodRes] = await Promise.all([
    env.DB.prepare(`SELECT slug, updated_at FROM architects WHERE ${where}`).all(),
    env.DB.prepare(`SELECT slug, updated_at FROM offices WHERE ${where}`).all(),
    env.DB.prepare(`SELECT slug, updated_at FROM projects WHERE ${where}`).all(),
    env.DB.prepare(`SELECT slug, updated_at FROM products WHERE ${where}`).all(),
  ]);
  return [
    ...archRes.results.map(r => [`/kisi/${encodeURIComponent(r.slug)}`, toLastmod(r.updated_at)]),
    ...officeRes.results.map(r => [`/firma/${encodeURIComponent(r.slug)}`, toLastmod(r.updated_at)]),
    ...projRes.results.map(r => [`/proje/${encodeURIComponent(r.slug)}`, toLastmod(r.updated_at)]),
    ...prodRes.results.map(r => [`/urun/${encodeURIComponent(r.slug)}`, toLastmod(r.updated_at)]),
  ];
}

async function routeApi(request, env, url, ctx) {
  const path = url.pathname;
  // Faz 4D — deploy sonrası sağlık kontrolü (bkz. scripts/health-check.sh) deploy edilen
  // worker_version'ın gerçekten değiştiğini bu uçtan teyit eder. Auth gerektirmez, hassas veri
  // dönmez (version id/tag secret DEĞİLDİR).
  if (path === '/api/_health' && request.method === 'GET') return handleHealthRoute(env);
  if (path.startsWith('/api/auth/')) return handleAuthRoute(request, env, url);
  if (path === '/api/profile') return handleProfileRoute(request, env, url);
  if (path === '/api/profile/office') return handleArchitectPrimaryOfficeRoute(request, env, url);
  if (path === '/api/account') return handleAccountDeleteRoute(request, env, url);
  // ctx: türev yazımları yanıt döndükten SONRA ctx.waitUntil ile tamamlanır (bkz.
  // src/routes/upload.js#handleUploadRoute) — yükleme yanıtı bekletilmez.
  if (path === '/api/uploads') return handleUploadRoute(request, env, ctx);
  if (path === '/api/uploads/file') return handleFileUploadRoute(request, env);
  if (path === '/api/contact') return handleContactRoute(request, env, url);
  if (path.startsWith('/api/newsletter/')) return handleNewsletterRoute(request, env, url);
  if (path === '/api/csp-report') return handleCspReportRoute(request, env);
  if (path.startsWith('/api/admin/')) return handleAdminRoute(request, env, url);
  if (path === '/api/public/badges') return handlePublicBadges(request, env, url);
  if (path === '/api/public/top100') return handleTop100Route(request, env, url);
  if (path.startsWith('/api/public/')) return handlePublicRoute(request, env, url);
  // Faz 1 — mimar-detay.html/ofis-detay.html/proje.html'nin eskiden istemci tarafında yaptığı
  // statik veri + onaylı gönderi overlay birleştirmesinin sunucu tarafı karşılığı (bkz.
  // docs/architecture-roadmap.md). Tekil (architect/office/project/product) yollar, aşağıdaki
  // /api/architects, /api/offices, /api/projects, /api/products ÇOĞUL gönderi CRUD uçlarıyla
  // (handleSubmissionRoute) ÇAKIŞMAZ — yalnızca /api/projects/filters, /api/projects prefix'iyle
  // başladığından o genel eşleşmeden ÖNCE burada özel olarak yakalanmalı.
  if (path === '/api/projects/filters') return handleProjectFiltersRoute(request, env, url);
  // proje.html/kisi.html/firma.html/urun.html'in yeni sayfalanmış (?page=&limit=) liste uçları —
  // BARE /api/projects/architects/offices/products, method GET iken buraya düşer; aynı path'lere
  // POST (yeni gönderi oluşturma) her zaman aşağıdaki handleSubmissionRoute'a gider (bkz. o dosyadaki
  // segments.length===2 dalı, yalnızca POST'u işliyor — GET için hiçbir dal eşleşmediğinden bu
  // path'ler GET için önceden zaten boştu, çakışma yok).
  // P3-1 hardening: HEAD, GET ile AYNI route'a düşer (monitoring/uptime araçları için standart HTTP
  // semantiği) — handler'ların kendisi HEAD'de body'siz aynı header'ları döner, GET davranışı değişmez.
  if (path === '/api/projects' && (request.method === 'GET' || request.method === 'HEAD')) return handleProjectListRoute(request, env, url);
  if (path === '/api/architects' && (request.method === 'GET' || request.method === 'HEAD')) return handleArchitectListRoute(request, env, url);
  if (path === '/api/offices' && (request.method === 'GET' || request.method === 'HEAD')) return handleOfficeListRoute(request, env, url);
  if (path === '/api/products' && (request.method === 'GET' || request.method === 'HEAD')) return handleProductListRoute(request, env, url);
  // /api/architects, /api/offices ÇOĞUL prefix'i aşağıda handleSubmissionRoute'a (üye gönderi
  // CRUD'u) düşüyor — bu iki arama ucu o genel eşleşmeden ÖNCE özel olarak yakalanmalı, aksi
  // halde 'search' bir submission id'si gibi yorumlanıp 404/401 dönerdi (bkz. yukarıdaki
  // /api/projects/filters'daki AYNI çakışma önleme deseni).
  if (path === '/api/architects/search') return handleArchitectSearchRoute(request, env, url);
  if (path === '/api/architects/schools') return handleArchitectSchoolsRoute(request, env, url);
  if (path === '/api/offices/search') return handleOfficeSearchRoute(request, env, url);
  if (path === '/api/products/search') return handleProductSearchRoute(request, env, url);
  // Ürün markaları (proje-ekle.html'deki Firma kutusu) — bkz. handleProductBrandSearchRoute'un
  // "kaynak offices değil products" gerekçesi.
  if (path === '/api/products/brands') return handleProductBrandSearchRoute(request, env, url);
  if (path === '/api/photographers/search') return handlePhotographerSearchRoute(request, env, url);
  // urun-ekle.html'deki "Kullanılan Projeler" kutusunun autocomplete'i — /api/projects/:id gibi
  // dinamik uçlardan ÖNCE yakalanmalı (bkz. yukarıdaki /api/architects/search ile AYNI gerekçe).
  if (path === '/api/projects/search') return handleProjectSearchRoute(request, env, url);
  if (path === '/api/ai/search') return handleAiSearchRoute(request, env, url);
  // Görsel arama — /api/ai/ genel eşleşmesinden (handleAiRoute) ÖNCE yakalanmalı, tıpkı
  // /api/ai/search gibi (bkz. o satırın gerekçesi).
  if (path === '/api/ai/visual-search') return handleVisualSearchRoute(request, env, url);
  if (path === '/api/ai/image-embed') return handleImageEmbedAppendRoute(request, env, url);
  if (path.startsWith('/api/geocode/')) return handleGeocodeRoute(request, env, url);
  if (path.startsWith('/api/architect/')) return handleArchitectRoute(request, env, url, path.slice('/api/architect/'.length));
  if (path.startsWith('/api/office/')) return handleOfficeRoute(request, env, url, path.slice('/api/office/'.length));
  if (path.startsWith('/api/project/')) {
    const projectSlug = path.slice('/api/project/'.length);
    // DELETE: proje sahibinin (ya da admin'in) proje-ekle.html?claim=/?edit= sayfasından (bkz.
    // mountProjectAdminActions, kullanıcı isteği: Arşivle/Sil artık pop-up'ta değil, orada) kendi
    // projesini silmesi — GET (yukarıdaki handleProjectDetailRoute, herkese açık detay) ile AYNI
    // path'i paylaşır, method'a göre ayrılır.
    if (request.method === 'DELETE') return handleSelfProjectDelete(request, env, decodeURIComponent(projectSlug));
    // POST .../moderate {action:'archive'}: sahibin/admin'in proje-ekle.html'den (bkz. yukarısı
    // mountProjectAdminActions) "Arşivle"ye basması — GET'ten ÖNCE özel olarak yakalanmalı,
    // aksi halde handleProjectDetailRoute slug'ı "some-slug/moderate" olarak arardı.
    if (projectSlug.endsWith('/moderate') && request.method === 'POST') {
      return handleSelfProjectModerate(request, env, decodeURIComponent(projectSlug.slice(0, -'/moderate'.length)));
    }
    // GET .../can-edit: sahiplik/claim tabanlı düzenleme yetkisi kontrolü (bkz. js/components/
    // project-actions.js#mountOwnerActions, proje-ekle.html#prefillForClaim) — yukarıdaki iki dal
    // gibi GET handleProjectDetailRoute'tan ÖNCE özel olarak yakalanmalı.
    if (projectSlug.endsWith('/can-edit') && request.method === 'GET') {
      return handleProjectCanEditRoute(request, env, projectSlug.slice(0, -'/can-edit'.length));
    }
    return handleProjectDetailRoute(request, env, url, projectSlug);
  }
  // Ürün detay — js/components/product-modal.js#fetchItem bu uca bağlanır (urun.html'in ProductModal'ı
  // urun-detay.html'i tamamen ikame ettiği desenin ürün karşılığı).
  if (path.startsWith('/api/product/')) {
    const productSlug = path.slice('/api/product/'.length);
    // GET .../can-edit — src/index.js'teki AYNI /api/project/.../can-edit deseninin ürün karşılığı
    // (bkz. handleProductCanEditRoute dosya başı yorumu) — handleProductDetailRoute'tan ÖNCE
    // özel olarak yakalanmalı, aksi halde slug'ı "some-slug/can-edit" olarak arardı.
    if (productSlug.endsWith('/can-edit') && request.method === 'GET') {
      return handleProductCanEditRoute(request, env, productSlug.slice(0, -'/can-edit'.length));
    }
    return handleProductDetailRoute(request, env, url, productSlug);
  }
  if (path.startsWith('/api/comments')) return handleCommentsRoute(request, env, url);
  if (path.startsWith('/api/saved')) return handleSavedRoute(request, env, url);
  // Paylaştıklarım (bkz. src/routes/shares.js) — /api/saved ile AYNI desen ve AYNI gerekçe:
  // tamamen oturum korumalı, herkese açık hiçbir okuma ucu yok.
  if (path.startsWith('/api/shares')) return handleSharesRoute(request, env, url);
  // Koleksiyonum (bkz. src/routes/collections.js) — /api/saved ile AYNI desen: tamamen oturum
  // korumalı, herkese açık hiçbir okuma ucu yok.
  if (path.startsWith('/api/collections')) return handleCollectionsRoute(request, env, url);
  if (path.startsWith('/api/follows')) return handleFollowRoute(request, env, url);
  // Profil İstatistikleri (bkz. src/routes/analytics.js). İKİ AYRI yetki seviyesi taşır ve bu yüzden
  // /api/saved gibi tek blokta korunamaz: /track herkese açıktır (giriş yapmamış ziyaretçilerin
  // görüntülenmeleri de sayılmalı, IP başına rate-limit ile korunur), /summary ise oturum + AKTİF
  // ROZET ister ve yalnızca isteği yapan kullanıcının kendi verisini döner.
  if (path.startsWith('/api/analytics')) return handleAnalyticsRoute(request, env, url);
  if (path.startsWith('/api/ratings')) return handleRatingsRoute(request, env, url);
  if (path.startsWith('/api/claims')) return handleClaimsRoute(request, env, url);
  if (path.startsWith('/api/corrections')) return handleCorrectionsRoute(request, env, url);
  if (path.startsWith('/api/badges')) return handleBadgesRoute(request, env, url);
  if (path.startsWith('/api/payments/')) return handlePaymentsRoute(request, env, url);
  if (path.startsWith('/api/notifications')) return handleNotificationsRoute(request, env, url);
  // Marka sahibi ürün etiketleme önerileri (bkz. src/routes/hotspotTags.js). /api/projects/... ALTINA
  // DEĞİL, kendi kök yoluna konuldu: /api/projects prefix'i aşağıda handleSubmissionRoute'un (üye
  // gönderi CRUD'u) genel eşleşmesine düşüyor ve oradaki her yeni alt yol için ayrıca çakışma önleme
  // satırı yazmak gerekiyor (bkz. /api/projects/filters, /api/projects/search). Tamamen oturum
  // korumalı, herkese açık okuma ucu yok — /api/saved ile AYNI desen.
  if (path.startsWith('/api/hotspot-tags')) return handleHotspotTagsRoute(request, env, url);
  if (path.startsWith('/api/messages')) return handleMessagesRoute(request, env, url);
  if (path.startsWith('/api/ai/')) return handleAiRoute(request, env, url);
  if (
    path.startsWith('/api/offices') || path.startsWith('/api/projects') ||
    path.startsWith('/api/products') || path.startsWith('/api/materials') ||
    path.startsWith('/api/architects')
  ) return handleSubmissionRoute(request, env, url);
  return errorJson('Bulunamadı', 404);
}

function handleHealthRoute(env) {
  return json({
    status: 'ok',
    version: env.CF_VERSION_METADATA ? { id: env.CF_VERSION_METADATA.id, tag: env.CF_VERSION_METADATA.tag } : null,
    environment: env.ENVIRONMENT ?? null,
    // production audit (2026-09-01, madde E): zone-geneli önbellek temizliği YALNIZCA CF_ZONE_ID +
    // CF_PURGE_TOKEN secret'ları tanımlıysa çalışır (bkz. src/lib/globalPurge.js). Bu bayrak,
    // secret'ların gerçekten yüklenip yüklenmediğini dışarıdan (scripts/health-check.sh) tek
    // bakışta görebilmek için — token'ın KENDİSİ değil, yalnızca var/yok bilgisi döner.
    globalCachePurge: isGlobalPurgeConfigured(env),
    timestamp: new Date().toISOString(),
  });
}
