import { json, errorJson } from './lib/http.js';
import { logRequest } from './lib/logger.js';
import { buildMeta, listEntityUrls } from './lib/seo.js';
import { handleAuthRoute, handleProfileRoute, handleAccountDeleteRoute } from './routes/auth.js';
import { handleSubmissionRoute } from './routes/submissions.js';
import { handlePublicRoute } from './routes/public.js';
import { handleArchitectRoute, handleArchitectSearchRoute, handleArchitectListRoute, handleArchitectSchoolsRoute, handleArchitectPrimaryOfficeRoute } from './routes/architect.js';
import { handleOfficeRoute, handleOfficeSearchRoute, handleOfficeListRoute } from './routes/office.js';
import { handleProjectDetailRoute, handleProjectFiltersRoute, handleProjectListRoute } from './routes/project.js';
import { handleProductDetailRoute, handleProductListRoute, handleProductSearchRoute } from './routes/product.js';
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
import { handleNewsletterRoute } from './routes/newsletter.js';
import { handleCspReportRoute } from './routes/cspReport.js';
import { handleNotificationsRoute } from './routes/notifications.js';
import { slugify } from './lib/slugify.js';
import { SSR_CACHE_VERSION } from './lib/ssrCache.js';
import { resolveSlugRedirect } from './lib/slugRedirects.js';

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
// form-action'a ayrıca eklenmedi. Sitede hiçbir <iframe> yok (bkz. X-Frame-Options: DENY yorumu),
// frame-src/object-src bu yüzden 'none'.
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
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com https://static.cloudflareinsights.com",
  "frame-src 'none'",
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
  '/mimar-detay': { param: 'mimar', prefix: '/mimar/', slugifyValue: true },
  '/ofis-detay': { param: 'ofis', prefix: '/firma/', slugifyValue: true },
};
// Yeni temiz yol önekini, aynı içeriği render eden gerçek statik HTML dosyasına eşler — istemci
// tarafındaki sayfa JS'i slug'ı URL yolundan okuyacak şekilde ayrıca güncellenmiştir (bkz. ilgili
// *-detay.html dosyalarındaki path-tabanlı fallback lookup). Uzantısız yol kullanılır çünkü
// env.ASSETS.fetch'e ".html" ile biten bir istek verilirse Cloudflare Assets kendi html_handling
// (auto-trailing-slash) davranışıyla bunu tekrar uzantısız hale 301 yönlendirir — bu da orijinal
// /yapi/:slug isteğimizin path bilgisini kaybederdi; uzantısız istemek doğrudan içeriği döner.
const CLEAN_URL_ASSETS = [
  // /proje/:slug, /mimar/:slug, /firma/:slug, /urun/:slug artık kendi listeleme sayfalarına
  // eşleniyor (proje-detay.html/mimar-detay.html/ofis-detay.html/urun-detay.html kaldırıldı) — her
  // sayfa kendi JS'inde bu yolu algılayıp ilgili modalı (ProjectModal/ArchitectModal/OfficeModal/
  // ProductModal, bkz. js/components/) doğrudan açar, injectMeta() ise AYNI HTMLRewriter
  // mekanizmasıyla o listeleme sayfasının <head>'indeki id'li meta etiketlerini hedefler (bkz.
  // proje.html/mimar.html/firma.html/urun.html#meta-description vb.).
  // Eskiden "Yapı" (buildStatus='built', /yapi/:slug) ve "Proje" (buildStatus='concept', /proje/:slug)
  // ayrı sayfa/önek çiftiydi (bkz. kullanıcı isteği) — konsept kategori tamamen kaldırıldı, Yapı
  // sayfası "Proje" adını aldı, tek önek kaldı. Eski /yapi/:slug bağlantıları PREFIX_RENAME_REDIRECTS'te
  // buraya 301'lenir.
  { prefix: '/proje/', asset: '/proje', type: 'project' },
  { prefix: '/mimar/', asset: '/mimar', type: 'architect' },
  { prefix: '/firma/', asset: '/firma', type: 'office' },
  { prefix: '/urun/', asset: '/urun', type: 'product' },
];

// serveDetailPage#type ('project'/'architect'/'office') -> slug_redirects.entity_type (bkz.
// migrations/0041_slug_redirects.sql) — src/lib/canonicalSync.js/officeFounderCascade.js'teki AYNI
// çoğul isimlendirme ('projects'/'architects'/'offices').
const ENTITY_TYPE_BY_DETAIL_TYPE = { project: 'projects', architect: 'architects', office: 'offices' };

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
};

// Giriş/Üye Ol/Hesabım modallarının doğrudan URL ile açılması (F5/deep-link) — CLEAN_URL_ASSETS'in
// aksine bir slug'a değil TEK bir sabit yola karşılık geldiklerinden ayrı, basit bir eşleme yeterli.
// index.html HER sayfada zaten yüklü olan auth-modal.js'i barındırdığından burada "ana sayfa" servis
// edilir, o da location.pathname'e bakıp ilgili modalı kendisi açar (bkz. auth-modal.js). Bu 3 sayfa
// zaten noindex olduğundan (bkz. giris-yap.html/uye-ol.html/hesabim.html <meta name="robots">)
// serveDetailPage'deki HTMLRewriter/meta enjeksiyonuna burada ihtiyaç yok.
const AUTH_MODAL_ROUTES = new Set(['/giris', '/uye-ol', '/hesabim', '/sifremi-unuttum']);

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
const INFO_MODAL_META = {
  '/rozet-al': { title: 'Rozet Satın Al — MİMARLAB', description: 'MİMARLAB rozet satın al — profilini doğrulanmış üye, altın üye ya da elmas üye rozetiyle öne çıkar.', noindex: true },
  '/iade-et': { title: 'Rozet İadesi Talep Et — MİMARLAB', description: 'MİMARLAB rozet iadesi talep et — satın aldığın rozet için iade talebinde bulun.', noindex: true },
  '/iletisim': { title: 'İletişim — MİMARLAB', description: 'MİMARLAB ile iletişime geç — soru, öneri ve iş birliği için bize ulaş.', noindex: false },
  '/hakkinda': { title: 'Hakkında — MİMARLAB', description: 'MİMARLAB hakkında — Türkiye\'nin mimarlık, iç mimarlık ve peyzaj mimarlığı platformu.', noindex: false },
  '/gizlilik-politikasi': { title: 'Gizlilik Politikası — MİMARLAB', description: 'MİMARLAB gizlilik politikası — hangi verileri topladığımız, üyelik/profil yönetimi, favoriler, mimar/firma sahiplik talepleri, kullanıcı içerikleri, Cloudflare altyapısı ve KVKK/GDPR haklarınız.', noindex: false },
  '/hizmet-sartlari': { title: 'Hizmet Şartları — MİMARLAB', description: 'MİMARLAB hizmet şartları — üyelik, kullanıcı içerikleri ve telif hakları, mimar/firma sahiplik talepleri, rozet/üyelik paketleri, topluluk kuralları ve sorumluluk sınırları.', noindex: false },
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
];

// Statik (build adımı olmayan) üst seviye sayfalar — bkz. eski kök dizindeki sitemap.xml (artık
// /sitemap.xml Worker route'u tarafından üretiliyor, bu dosya kaldırıldı).
const SITEMAP_STATIC_PAGES = [
  { loc: '/', changefreq: 'daily', priority: '1.0' },
  { loc: '/mimar', changefreq: 'daily', priority: '0.9' },
  { loc: '/firma', changefreq: 'daily', priority: '0.9' },
  { loc: '/proje', changefreq: 'daily', priority: '0.9' },
  { loc: '/urun', changefreq: 'weekly', priority: '0.7' },
  { loc: '/hakkinda', changefreq: 'monthly', priority: '0.5' },
  { loc: '/iletisim', changefreq: 'monthly', priority: '0.5' },
  // gerçek bulgu: bu ikisi indexlenebilir (robots noindex YOK, bkz. INFO_MODAL_META) ama sitemap'te
  // hiç yer almıyordu — Rozet Al/İade Et bilerek dışında bırakıldı, onlar noindex.
  { loc: '/gizlilik-politikasi', changefreq: 'yearly', priority: '0.2' },
  { loc: '/hizmet-sartlari', changefreq: 'yearly', priority: '0.2' },
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
// audit bulgusu: bu 5 liste sayfası tamamen statik bir HTML kabuğu döner (veri her zaman istemci
// tarafında /api/* uçlarından çekilir, bkz. proje.js/mimar.js vb. — SSR_PAGE_CACHE_HEADERS'ın aksine
// burada D1'e bağlı hiçbir enjeksiyon/purge gereksinimi yok), ama Cloudflare Assets'in varsayılan
// `max-age=0, must-revalidate` başlığıyla serviliyordu — her ziyaret tam bir round-trip'e mal
// oluyordu. SSR_PAGE_CACHE_HEADERS'la AYNI süreler kullanılır (tutarlılık); içerik değişimi zaten
// istemci tarafı fetch'lerle (kendi kısa TTL'li önbellekleriyle) yansıdığından kabuğun birkaç dakika
// bayat kalması sorun yaratmaz.
const LIST_PAGE_CACHE_HEADERS = SSR_PAGE_CACHE_HEADERS;
const LIST_PAGE_PATHS = new Set(['/', '/proje', '/mimar', '/firma', '/urun']);
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
        response = await routeApi(request, env, url);
      } else if (url.pathname.startsWith('/media/')) {
        response = await handleMediaRoute(request, env, url);
      } else if (url.pathname === '/sitemap.xml') {
        response = await handleSitemapRoute(request, env, ctx);
      } else {
        response = await routeAsset(request, env, url, ctx);
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
};

async function routeAsset(request, env, url, ctx) {
  if (isDisabledPagePath(url.pathname)) return notFoundPageResponse();

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

  const cleanRoute = CLEAN_URL_ASSETS.find(r => url.pathname.startsWith(r.prefix) && url.pathname.length > r.prefix.length);
  if (cleanRoute) return serveDetailPage(request, env, url, cleanRoute, ctx);

  if (AUTH_MODAL_ROUTES.has(url.pathname)) {
    // gerçek bulgu: '/index' Cloudflare Assets tarafından kanonik doküman (index.html'in kendi
    // kanonik yolu '/'dir) olarak özel ele alınıyor ve '/'e 307 yönlendiriliyor — CLEAN_URL_ASSETS'teki
    // '/proje' gibi sıradan bir sayfa adı DEĞİL. '/' doğrudan istenirse bu ek yönlendirme hiç olmaz.
    const assetUrl = new URL(url);
    assetUrl.pathname = '/';
    const response = await env.ASSETS.fetch(new Request(assetUrl, request));
    return withStaticImageCacheHeaders(url, response);
  }

  const infoMeta = INFO_MODAL_META[url.pathname];
  if (infoMeta) return serveInfoModalPage(request, env, url, infoMeta);

  const response = await env.ASSETS.fetch(request);
  if (request.method === 'GET' && response.status === 200 && LIST_PAGE_PATHS.has(url.pathname)) {
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(LIST_PAGE_CACHE_HEADERS)) headers.set(k, v);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  return withStaticImageCacheHeaders(url, response);
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
body{font-family:'Inter',sans-serif; background:#F5F3EF; color:#1B2A3D; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; text-align:center; padding:24px;}
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
function notFoundDetailPageResponse(assetResponse) {
  const rewritten = new HTMLRewriter()
    .on('head', { element(el) { el.append('<meta name="robots" content="noindex, follow">', { html: true }); } })
    .transform(assetResponse);
  return new Response(rewritten.body, { status: 404, statusText: 'Not Found', headers: rewritten.headers });
}

function withStaticImageCacheHeaders(url, response) {
  if (response.status !== 200 || !IMAGE_EXT_RE.test(url.pathname)) return response;
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(STATIC_IMAGE_CACHE_HEADERS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// /mimar/:slug, /firma/:slug, /yapi/:slug, /haberler/:id — statik şablonu ASSETS'ten alır,
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
  // Slug bulunamadıysa, bu bir yeniden adlandırma sonrası bayatlamış (paylaşılmış/indekslenmiş) bir
  // eski URL olabilir (bkz. migrations/0041_slug_redirects.sql, kullanıcı isteği: "ismi değişirse
  // URL'si de değişmeli ... eski URL'ler kırılmasın") — varsa güncel slug'a 301 ile yönlendirilir.
  if (!meta && rawSlug) {
    const entityType = ENTITY_TYPE_BY_DETAIL_TYPE[cleanRoute.type];
    const newSlug = entityType ? await resolveSlugRedirect(env, entityType, rawSlug) : null;
    if (newSlug) {
      const newMeta = await buildMeta(cleanRoute.type, newSlug, env);
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
  if (!meta) return notFoundDetailPageResponse(assetResponse);

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
    // audit bulgusu: og:type tüm detay sayfalarında şablondaki sabit "website" değerinde kalıyordu —
    // meta.ogType YALNIZCA proje ('article')/ürün ('product') üreticilerinde set edilir (bkz.
    // src/lib/seo.js#buildProjectMeta/productMetaFromRecord); mimar/firma için Open Graph çekirdek
    // sözlüğünde kuruma/kişiye uyan iyi bir tip yok, "website" doğru varsayılan olarak kalır.
    .on('meta#og-type', { element(el) { el.setAttribute('content', meta.ogType || 'website'); } })
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
  // İki kaynak da bir Map üzerinden (url -> lastmod) birleştirilip aynı slug için TEKİL bir <url>
  // üretilir — listEntityUrls() lastmod taşımadığından (statik/build-zamanlı) null ile eklenir,
  // canonical D1 kaynağı kendi updated_at'ini taşır (audit bulgusu: <lastmod> daha önce hiç yoktu).
  const entityUrls = new Map([...listEntityUrls().map(loc => [loc, null]), ...await listCanonicalEntityUrls(env)]);
  const lastmodTag = lastmod => lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : '';
  const urls = [
    ...SITEMAP_STATIC_PAGES.map(p => `  <url>\n    <loc>${SITE_ORIGIN}${p.loc}</loc>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`),
    ...[...entityUrls].map(([loc, lastmod]) => `  <url>\n    <loc>${SITE_ORIGIN}${loc}</loc>${lastmodTag(lastmod)}\n    <changefreq>monthly</changefreq>\n  </url>`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
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
    ...archRes.results.map(r => [`/mimar/${encodeURIComponent(r.slug)}`, toLastmod(r.updated_at)]),
    ...officeRes.results.map(r => [`/firma/${encodeURIComponent(r.slug)}`, toLastmod(r.updated_at)]),
    ...projRes.results.map(r => [`/proje/${encodeURIComponent(r.slug)}`, toLastmod(r.updated_at)]),
    ...prodRes.results.map(r => [`/urun/${encodeURIComponent(r.slug)}`, toLastmod(r.updated_at)]),
  ];
}

async function routeApi(request, env, url) {
  const path = url.pathname;
  // Faz 4D — deploy sonrası sağlık kontrolü (bkz. scripts/health-check.sh) deploy edilen
  // worker_version'ın gerçekten değiştiğini bu uçtan teyit eder. Auth gerektirmez, hassas veri
  // dönmez (version id/tag secret DEĞİLDİR).
  if (path === '/api/_health' && request.method === 'GET') return handleHealthRoute(env);
  if (path.startsWith('/api/auth/')) return handleAuthRoute(request, env, url);
  if (path === '/api/profile') return handleProfileRoute(request, env, url);
  if (path === '/api/profile/office') return handleArchitectPrimaryOfficeRoute(request, env, url);
  if (path === '/api/account') return handleAccountDeleteRoute(request, env, url);
  if (path === '/api/uploads') return handleUploadRoute(request, env);
  if (path === '/api/contact') return handleContactRoute(request, env, url);
  if (path.startsWith('/api/newsletter/')) return handleNewsletterRoute(request, env, url);
  if (path === '/api/csp-report') return handleCspReportRoute(request);
  if (path.startsWith('/api/admin/')) return handleAdminRoute(request, env, url);
  if (path === '/api/public/badges') return handlePublicBadges(request, env, url);
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
  if (path === '/api/architects/schools') return handleArchitectSchoolsRoute(request, env, url);
  if (path === '/api/offices/search') return handleOfficeSearchRoute(request, env, url);
  if (path === '/api/products/search') return handleProductSearchRoute(request, env, url);
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
  // Ürün detay — js/components/product-modal.js#fetchItem bu uca bağlanır (urun.html'in ProductModal'ı
  // urun-detay.html'i tamamen ikame ettiği desenin ürün karşılığı).
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
    path.startsWith('/api/architects')
  ) return handleSubmissionRoute(request, env, url);
  return errorJson('Bulunamadı', 404);
}

function handleHealthRoute(env) {
  return json({
    status: 'ok',
    version: env.CF_VERSION_METADATA ? { id: env.CF_VERSION_METADATA.id, tag: env.CF_VERSION_METADATA.tag } : null,
    environment: env.ENVIRONMENT ?? null,
    timestamp: new Date().toISOString(),
  });
}
