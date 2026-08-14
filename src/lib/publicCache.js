import { json } from './http.js';
import { getSessionUser } from './auth.js';
import { reserveKvWrite } from './kvQuota.js';

// Admin oturumu taşıyan istekler (mimarlab_session çerezi + role==='admin') hiçbir zaman
// önbelleklenmez — admin panelinden yapılan bir değişikliğin aynı oturumda anında görünmesi için
// (bkz. kullanıcı isteği: "Admin ise ... no-store"). Anonim ziyaretçiler için Cloudflare edge'inde
// (Workers Cache API, caches.default) gerçek bir paylaşımlı önbellek kullanılır; admin bir yazma
// işlemi yaptığında bu önbellek topluca temizlenir (bkz. invalidatePublicCache). getSessionUser
// çerez yoksa hiç DB'ye gitmeden null döner (bkz. src/lib/auth.js) — bu yüzden anonim istekler için
// bu kontrolün kendisi ek bir sorgu maliyeti getirmez.
async function isAdminRequest(request, env) {
  const user = await getSessionUser(request, env);
  return !!user && user.role === 'admin';
}

// Faz 4B — kullanıcı isteğindeki standart değer (private/no-store/must-revalidate). lib/http.js#json
// artık AYNI değeri varsayılan olarak zaten uyguluyor (admin.js/auth.js gibi bu sarmalayıcıdan hiç
// geçmeyen uçlar için) — burada AYRICA tanımlı tutulması, bu dosyanın admin dalının kendi başına
// okunabilir/eksiksiz kalması içindir.
const ADMIN_CACHE_HEADERS = { 'Cache-Control': 'private, no-store, must-revalidate' };
// caches.default PoP-başınadır (bkz. Cloudflare Workers Cache API dokümantasyonu) — invalidatePublicCache()
// bir yazma isteğini işleyen PoP'un kendi girdisini temizler, ama BAŞKA bir PoP'taki (ör. admin
// Frankfurt'tan, bir sonraki okuyucu İstanbul'dan bağlanırsa) eski girdi kendi süresi dolana kadar
// yaşamaya devam eder — tek global "purge" garantisi yok. Önceki max-age=60/s-maxage=300 (5 dk),
// gerçek bulgu: admin bir projenin kapak görselini/sıralamasını değiştirip kaydettikten hemen sonra
// (özellikle admin oturumu dışında, ör. gizli sekmeden) bazen hâlâ eski hâli görüyordu — "kaydedildi"
// diyip hiçbir değişikliğin görünmemesi olarak yorumlandı. Bu uçların arkasındaki D1 sorguları hafif
// olduğundan (bkz. aşağıdaki yorum) süreyi kısaltmanın maliyeti düşük; birkaç saniyeye indirmek en
// kötü durumdaki bayatlık penceresini insan algısı için "anında" sayılabilecek bir aralığa çeker.
const ANON_CACHE_HEADERS = { 'Cache-Control': 'public, max-age=5, s-maxage=15' };
// Faz 4B — sayfalanmış liste uçları (kullanıcı isteği): ANON_CACHE_HEADERS'tan (yukarıdaki gerçek
// bulgu nedeniyle bilerek kısa) FARKLI, daha uzun bir TTL. Bu uçlar için bayatlık riski iki şekilde
// sınırlanır: (1) her admin/onay/gizleme yazma işleminde invalidatePublicCache() bu 4 listenin
// PARAMETRESİZ (bare, en sık görülen "sayfa 1/filtresiz" görünüm) varyantını aktif temizler — bkz.
// aşağıdaki BARE_LIST_PATHS; (2) sayfalanmış/filtrelenmiş/sıralanmış varyantlar (ör. ?page=3&sort=..)
// tek tek temizlenmez (kombinasyon sayısı pratikte sınırsız), bunlar en kötü durumda s-maxage (5dk)
// kadar bayat kalabilir — stale-while-revalidate bu süreyi arka planda tazeler, kullanıcı asla 24
// saatlik değer kadar eski veri GÖRMEZ (yalnızca Cloudflare'in arkaplan yenileme penceresi budur).
// KÖKTEN BULGU (2026-08-13): burada daha önce `stale-while-revalidate=86400` de vardı. Bu direktif
// caches.default'un kendi iç davranışını ETKİLEMİYOR (Cloudflare Cache API swr'yi uygulamıyor,
// yalnızca max-age/s-maxage'a bakıyor) — ama AYNI header, yanıtla birlikte doğrudan TARAYICIYA da
// gidiyordu, ve modern Chrome/Firefox swr'yi harfiyen uyguluyor: bir sekme /api/projects'i daha önce
// çekmişse, sonraki her açılışta max-age (60sn) geçmiş olsa bile TAMAMEN BAYAT yanıtı ANINDA (ağa hiç
// gitmeden) gösterip arka planda sessizce yeniliyordu — kullanıcıya hiçbir "yenileniyor" sinyali
// olmadan. Bu pencere 24 saate kadar çıkabiliyordu. Gerçek bulgu: yeni eklenen "Aselsan Konya"
// projesi normal sekmede 1. sırada görünmüyordu ve "1215 proje listeleniyor" yazıyordu (gizli
// sekmede — hiç tarayıcı önbelleği yokken — doğru "1216" ve doğru sıralama görünüyordu). cachedPublicJson
// zaten her caches.default HIT'inde bir fingerprint kontrolüyle PoP-düzeyinde bayatlığa karşı koruma
// sağlıyor (bkz. aşağıdaki cachedPublicJson yorumu); swr'nin CDN tarafında sağladığı ek fayda yok,
// yalnızca tarayıcıda bu görünmez 24 saatlik bayatlık riskini yaratıyordu — bu yüzden tamamen kaldırıldı.
const PUBLIC_LIST_CACHE_HEADERS = { 'Cache-Control': 'public, max-age=60, s-maxage=300' };

// Sorgu dizesi taşımayan (dolayısıyla sonlu/sabit) public uçların tam listesi — her biri
// caches.default'ta kendi URL'siyle anahtarlanır ve bir admin yazma işleminden sonra tek seferde
// temizlenir (bkz. invalidatePublicCache). profile-content/claim-status/save-count gibi profil ya
// da kayıt anahtarına göre parametrelenen uçlar bilerek dahil değildir — olası anahtar sayısı
// sınırsız olduğundan (her mimar/proje için ayrı bir URL) paylaşımlı önbelleğe pratik biçimde
// alınıp güvenilir şekilde temizlenemez; onlar yalnızca ANON_CACHE_HEADERS başlığıyla (tarayıcı
// düzeyinde, kendiliğinden dolan) önbelleklenir.
const CACHEABLE_PATHS = [
  '/api/public/hidden', '/api/public/project-edits', '/api/public/profile-edits',
  '/api/public/news',
  // gerçek bulgu: bu uç önceden hiç önbelleklenmiyordu — badge-shared.js onu index.html/mimar.html/
  // firma.html/proje.html/urun.html/arama.html olmak üzere 6 çekirdek sayfanın HER açılışında fetch
  // ediyordu, sorgu iki JOIN (profile_claims × badge_requests + admin_badges tam taraması) içeriyor.
  // Admin rozet mutasyon uçları (handleBadgesAdmin/handleProfileBadgeAdmin, bkz. admin.js) artık
  // invalidatePublicCache() çağırıyor, bu yüzden buraya eklenmesi güvenli.
  '/api/public/badges',
];

// Faz 4B — GET /api/projects, /api/architects, /api/offices, /api/products, /api/news (sayfalama/
// filtre query string'i taşıyan liste uçları — /api/news, Faz 4B doğrulama turunda routing
// çakışması bulunup düzeltildikten sonra buraya eklendi, bkz. src/routes/public.js#
// handleNewsListRoute). CACHEABLE_PATHS'teki sabit yollardan farkı: anahtar TAM URL'dir (pathname +
// query string BİRLİKTE) — sayfa/limit/sıralama/filtre kombinasyonu, profil anahtarları gibi
// sınırsız DEĞİL (pratikte kullanıcılar birkaç sayfa/filtre kombinasyonunu ziyaret eder), bu yüzden
// her kombinasyon kendi caches.default girdisi olarak güvenle tutulabilir. NOT: `/api/news` prefix'i
// `/api/public/news` ile ÇAKIŞMAZ — farklı path segmentleri (bkz. isListPath'teki tam-önek eşleşmesi).
const CACHEABLE_LIST_PREFIXES = ['/api/projects', '/api/architects', '/api/offices', '/api/products', '/api/news'];
// Ana sayfanın (index.html) mini-carousel'leri BARE (sorgu dizesiz) varyantı DEĞİL, kendi
// ?limit=N varyantını çeker (bkz. index.html#PROJECT_CAROUSEL_FETCH_LIMIT/Promise.all) — bu da
// caches.default'ta AYRI bir anahtar altında saklanır (bkz. cacheKeyFor). Yalnızca BARE_LIST_PATHS
// temizlenirse bu varyantlar hiçbir zaman aktif geçersiz kılınmaz, en kötü durumda s-maxage (5dk)
// dolana kadar bayat kalır (gerçek bulgu: "ana sayfa Proje carousel'i yeni eklenen projeyi
// göstermiyor" — bkz. kullanıcı isteği). Bu yüzden en sık ziyaret edilen ana sayfa varyantları da
// AÇIKÇA listelenip her yazma işleminde birlikte temizlenir.
const HOMEPAGE_LIST_PATHS = [
  '/api/projects?limit=24', '/api/architects?limit=6', '/api/offices?limit=6', '/api/products?limit=6',
];
// proje.html/urun.html'in filtresiz/sıralamasız ilk ziyarette gerçekten çektiği TAM URL (bkz.
// proje.html#render/urun.html#render — page=1&limit=24, hiçbir filtre/arama/sort aktif değilken) —
// bu, HOMEPAGE_LIST_PATHS'teki `?limit=24` varyantından FARKLI bir cache anahtarı (query string
// birebir eşleşmeli). Bu satır BARE_LIST_PATHS'te yoksa yeni onaylanan bir proje/ürün, admin
// onayından sonra bu en sık görülen "1. sayfa" görünümünde en fazla s-maxage (5dk) kadar hiç
// görünmeyebilirdi (gerçek bulgu: kullanıcı isteği — "yeni yüklenen proje 1. sayfaya 1. post
// olarak gelmedi"). proje.js#currentQueryParams HER ZAMAN `buildStatus=built`'i ilk parametre
// olarak set ediyor (proje.js:77) — bu yüzden gerçek istek `/api/projects?page=1&limit=24` DEĞİL,
// `/api/projects?buildStatus=built&page=1&limit=24`'tür; cacheKeyFor TAM STRING eşleşmesi
// aradığından ('=='), buildStatus'süz eski hali burada hiçbir zaman gerçek trafikle eşleşmiyor ve
// bu proje için invalidation'ı sessizce no-op'a çeviriyordu (kökten bulgu — kullanıcı bu sorunu
// "daha önce de yaşadığını" bildirdi; yalnızca ayrı bir fingerprint/ETag kontrolü sayesinde birkaç
// istek içinde kendiliğinden düzeliyordu, bu satır olmadan gerçek "anında" invalidation hiç
// çalışmıyordu). /api/products için urun.html#currentQueryParams böyle sabit bir varsayılan
// parametre SET ETMİYOR, bu yüzden o girdi zaten doğru.
const DEFAULT_FIRST_PAGE_PATHS = ['/api/projects?buildStatus=built&page=1&limit=24', '/api/products?page=1&limit=24'];
const BARE_LIST_PATHS = [...CACHEABLE_LIST_PREFIXES, ...HOMEPAGE_LIST_PATHS, ...DEFAULT_FIRST_PAGE_PATHS];

function isListPath(pathname) {
  return CACHEABLE_LIST_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '?'));
}

function cacheKeyFor(pathname) {
  // caches.default sabit bir Request nesnesi ister; sabit CACHEABLE_PATHS'te sorgu dizesi
  // olmadığından pathname'in kendisi zaten benzersiz bir anahtardır; liste uçlarında pathname
  // çağıran tarafından ZATEN `url.pathname + url.search` olarak geçirilir (bkz. src/routes/
  // architect.js#handleArchitectListRoute vb.) — gerçek istek origin'inden bağımsız, sabit bir
  // origin kullanılır (host'a göre değişen bir anahtar üretmemek için).
  return new Request(`https://mimarlab.com${pathname}`, { method: 'GET' });
}

// FNV-1a 32-bit — kriptografik değil, yalnızca ETag için hızlı/determinist bir içerik parmak izi
// (bkz. kullanıcı isteği: "içerik hash'i"). ETag her zaman aynı girdiden (pathname+search+
// fingerprint) üretildiğinden hem yanıtı YAZARKEN hem de daha sonra bir If-None-Match'i kontrol
// EDERKEN birebir aynı değeri üretir.
function contentHash(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

// Tekil kayıt uçları (mimar/firma/proje/ürün detay) computeData() sonucunda {item:null,...}
// döndürdüğünde artık gerçek bir HTTP 404 dönülür (gerçek bulgu: önceden hep 200 OK dönüyordu —
// arama motorları bunu "soft 404" olarak işaretleyip tarama bütçesini/indeksleme güvenini
// düşürüyordu; istemci tarafı zaten item:null'ı "bulunamadı" olarak render ediyordu, yalnızca
// durum kodu yanlıştı). Liste uçlarının gövdesi bu şekli hiç almadığından (dizi döner, `item`
// alanı yok) yalnızca proje.js/architect.js/office.js/product.js'teki tekil detay uçlarını etkiler.
// denetim bulgusu (2026-08-14): item:null iken data.hidden'a hiç bakılmıyordu, "hiç var olmamış"
// bir slug ile "admin tarafından bilerek gizlenmiş" bir kayıt (bkz. yukarıdaki route'ların
// `{item:null, hidden:true}` dönüşü) AYNI 404'ü alıyordu. 410, arama motorlarına 404'ten daha
// güçlü, kalıcı bir "bu içerik bilerek kaldırıldı" sinyali verir — src/index.js#serveDetailPage'in
// (SSR sayfa) AYNI ayrımının API karşılığı.
function statusFor(data) {
  if (!data || data.item !== null) return 200;
  return data.hidden ? 410 : 404;
}

// Cache-stampede koruması (audit bulgusu — bkz. kullanıcı isteği "kritik maddeleri düzelt"):
// caches.default/FACET_CACHE'de MISS anında eşzamanlı gelen N istek, kilit/memoization olmadan
// AYNI pahalı computeData()/fetchPool()'u N kez paralel çalıştırıyordu (ör. viral paylaşım sonrası
// ani trafik artışında). Bir Workers isolate'ı TEK bir istekten fazlasını eşzamanlı işleyebildiğinden
// (aynı colo'da gelen art arda istekler genelde aynı isolate'i paylaşır) modül-scope'lu bu Map, AYNI
// isolate içindeki eşzamanlı çağrıları tek bir in-flight Promise'e yönlendirir — hesaplama BİR KEZ
// çalışır, sonucu bekleyen herkese paylaşılır. Bu, isolate/colo sınırları ARASI bir kilit DEĞİLDİR
// (Workers'ta paylaşımlı bir mutex birincil olarak yok) — yine de en sık görülen "aynı PoP'ta art arda
// gelen çoklu istek" senaryosunu (asıl stampede riski) kapsar, ek altyapı (Durable Object vb.)
// gerektirmez.
const inFlight = new Map();
async function withSingleFlight(key, fn) {
  if (inFlight.has(key)) return inFlight.get(key);
  const promise = (async () => {
    try {
      return await fn();
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}

// GET /api/public/* + sayfalanmış liste uçlarının ortak sarmalayıcısı. computeData(), yanıt
// gövdesini (JSON'a çevrilecek düz obje) üreten async bir fonksiyondur.
//
// listFingerprint (opsiyonel) — verildiğinde Faz 4B Conditional Requests desteğini açar: ucuz bir
// COUNT(*)+MAX(updated_at) agregasyon sorgusu (computeData()'nın çalıştırdığı JOIN/GROUP_CONCAT/JS
// filtre-sırala-sayfala hattından ÇOK daha ucuz) döner. Bu değer pathname+search ile birleştirilip
// ETag üretir. İstemci aynı ETag'i If-None-Match ile gönderirse computeData() HİÇ ÇAĞRILMADAN 304
// dönülür — yalnızca ucuz parmak izi sorgusu çalışır, tam liste sorgusu/JSON serialization'ı
// atlanır (bkz. kullanıcı isteği madde 3). NOT — bilinen sınırlama: fingerprint yalnızca ANA
// tablonun (ör. `projects`) kendi updated_at'ini izler; JOIN edilen ilişkili tablolardaki
// değişiklikler (ör. bir mimarın profili güncellenince proje kartındaki "Mimar" adının değişmesi,
// ya da bir puanlama eklenmesi) bu parmak izine YANSIMAZ — bu durumlarda en kötü ihtimalle
// s-maxage (5dk) sona erene kadar (ya da bir admin yazma işlemi invalidatePublicCache()'i
// tetikleyene kadar) eski değer görünmeye devam edebilir. listFingerprint verilmezse (mevcut tüm
// eski çağıranlar) davranış ÖNCEKİYLE BİREBİR AYNI kalır — yalnızca cache HIT yolunda (D1'e hiç
// gidilmeden) ETag eklenir.
export async function cachedPublicJson(request, env, pathname, computeData, listFingerprint) {
  const admin = await isAdminRequest(request, env);
  if (admin) { const data = await computeData(); return json(data, statusFor(data), ADMIN_CACHE_HEADERS); }

  const listPath = isListPath(pathname);
  const cacheable = CACHEABLE_PATHS.includes(pathname) || listPath;
  const headers = listPath ? PUBLIC_LIST_CACHE_HEADERS : ANON_CACHE_HEADERS;

  if (!cacheable) { const data = await withSingleFlight(`json:${pathname}`, computeData); return json(data, statusFor(data), headers); }

  const cacheKey = cacheKeyFor(pathname);

  // ETag HER ZAMAN hesaplanır (yalnızca istek zaten If-None-Match taşıyorsa DEĞİL) — aksi halde
  // ilk istekte (henüz hiçbir ETag'i olmayan bir istemci) hiç ETag dönülmez, istemcinin bir sonraki
  // istekte gönderecek bir değeri olmaz ve conditional request akışı hiçbir zaman devreye giremez
  // (gerçek bulgu: ilk sürümde tam olarak bu hataya düşülmüştü — bkz. Faz 4B doğrulama notları).
  // NOT bu değer artık cache HIT yolunda da hesaplanır (aşağıya bkz.) — MISS yolunda tekrar
  // hesaplanmasın diye burada bir kez üretilip paylaşılır.
  let freshEtag = null;
  async function computeFreshEtag() {
    if (freshEtag !== null) return freshEtag;
    if (!listFingerprint) return null;
    const fp = await listFingerprint();
    freshEtag = `W/"${contentHash(`${pathname}::${fp}`)}"`;
    return freshEtag;
  }

  try {
    // caches.default.match() Cache-Control/max-age'e göre kendi taze/bayat kontrolünü zaten yapar
    // (süresi geçmiş bir girdi asla dönmez) — ama bu yalnızca YAZILDIĞI ANDAKİ s-maxage'a göredir;
    // aradan geçen sürede invalidatePublicCache() bu PoP'u ATLAMIŞSA (ör. başka bir PoP'tan yazma,
    // ya da invalidatePublicCache() hiç çağrılmayan bir yazma yolu — ör. doğrudan D1 script/migration)
    // caches.default hâlâ "taze" sayıp bayat içeriği dönmeye devam eder (gerçek bulgu: bir projenin
    // kapak görseli D1'de güncellenmiş olsa bile /api/projects bu PoP'ta hâlâ eski sırayı dönüyordu —
    // bkz. kullanıcı isteği "SANKAI kapak görseli senkron hatası"). listFingerprint verilen uçlarda
    // (/api/projects, /api/architects, /api/offices, /api/products — dördü de kendi listFingerprint
    // fonksiyonlarını geçirir, bkz. project.js/architect.js/office.js/product.js) bu yüzden HIT
    // yolunda da ucuz parmak izi sorgusuyla gerçek tazelik doğrulanır — fingerprint uyuşmuyorsa bu
    // girdi bayat sayılıp MISS gibi devam edilir.
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      const cachedEtag = cached.headers.get('ETag');
      const currentEtag = await computeFreshEtag();
      const stale = listFingerprint && cachedEtag && currentEtag && cachedEtag !== currentEtag;
      if (!stale) {
        const ifNoneMatch = request.headers.get('If-None-Match');
        if (cachedEtag && ifNoneMatch === cachedEtag) {
          return new Response(null, { status: 304, headers: { ETag: cachedEtag, 'Cache-Control': cached.headers.get('Cache-Control') || '' } });
        }
        return cached;
      }
    }
  } catch { /* caches API bazı ortamlarda (ör. yerel wrangler dev http://) kullanılamayabilir */ }

  const etag = await computeFreshEtag();
  if (etag) {
    const ifNoneMatch = request.headers.get('If-None-Match');
    if (ifNoneMatch === etag) {
      return new Response(null, { status: 304, headers: { ...headers, ETag: etag } });
    }
  }

  const responseHeaders = etag ? { ...headers, ETag: etag } : headers;
  const data = await withSingleFlight(`json:${pathname}`, computeData);
  const response = json(data, 200, responseHeaders);
  try { await caches.default.put(cacheKey, response.clone()); } catch {}
  return response;
}

// gerçek bulgu: architect.js/office.js/product.js liste uçları, sidebar filtre sayaçlarını (dob/
// award/position; loc/cat; group/category/brand/rating) AYNI yanıtın içinde, HER İSTEKTE tüm
// havuzdan (filtresiz) hesaplıyor — project.js'in aksine (orada filtreler AYRI bir uçta, /api/
// projects/filters) bu üç uç sayaçları liste yanıtından ayıramaz (bkz. kullanıcı isteği: mevcut API
// şekli korunsun). Bu yüzden project.js#fetchProjectListPageFromD1'in D1 LIMIT/OFFSET deseni burada
// işe yaramaz — sayaçlar için zaten TÜM havuzun taranması gerekir, ayrı bir sayfalanmış sorgu
// yalnızca EK bir D1 çağrısı olurdu. Bunun yerine PAHALI kısmın kendisi (JOIN + correlated subquery
// ile ham/filtresiz havuzu çekmek) KV'de önbelleklenir — sayfa/sort/filtre kombinasyonu farklı bir
// TAM URL üretse bile (bkz. cacheKeyFor, üstteki önbellek TAM URL anahtarlıdır) hepsi AYNI havuzu
// paylaşır; D1'e yalnızca KV boşken gidilir, filtre/sıralama/sayfalama mantığının kendisi (Türkçe
// locale tie-break dahil) JS'te DEĞİŞMEDEN kalır — SQL'de güvenle yeniden üretilemeyecek bir sıralama
// riskine (ör. Ç/Ğ/İ/Ö/Ş/Ü harfli isimlerin SQLite'ın collation'ı olmadığı için yanlış sırada
// çıkması) hiç girilmez.
// audit bulgusu: 300sn (5dk) idi — bu TTL yalnızca invalidatePublicCache()'in KV delete()'i bu okuyan
// PoP'a HENÜZ ulaşmadığı nadir durum için bir GÜVENLİK AĞI (asıl tazelik, her yazımda çağrılan
// env.FACET_CACHE.delete() ile SESLİCE sağlanır, bkz. invalidatePublicCache aşağısı) — mutasyon
// noktalarının hepsi zaten bunu çağırdığından (bkz. kullanıcı isteği "kritik/orta maddeleri düzelt"
// turlarında eklenen/doğrulanan invalidation'lar) süreyi uzatmak asıl okuma trafiğindeki KV MISS
// (dolayısıyla pahalı JOIN+subquery) sıklığını azaltır, gerçek bayatlık riskini ARTIRMAZ.
const POOL_CACHE_TTL_SECONDS = 1800;
// 'projects:built'/'projects:concept' — bkz. src/routes/project.js#fetchActiveProjectPoolCached
// (audit bulgusu: proje havuzu daha önce hiç KV'de önbelleklenmiyordu, her filtreli/aramalı istekte
// TAM tablo taranıyordu). facetCounts.js#recomputeProjectFacets bu önbelleği ATLAYIP ham
// fetchActiveProjectPool'u çağırmaya devam eder (bir yazma sonrası her zaman TAZE veri gerekir).
const POOL_CACHE_KINDS = ['architects', 'offices', 'products', 'projects:built', 'projects:concept'];
function poolCacheKey(kind) { return `pool:${kind}`; }

// fetchPool() yalnızca KV boşsa çağrılır (pahalı JOIN+subquery sorgusu) — dönen değer, çağıranın
// zaten filtre/sırala/sayfala için kullandığı ŞEKİLLENDİRİLMİŞ (map edilmiş) pool dizisidir, ham D1
// satırları DEĞİL; böylece cache HIT'te satır->obje dönüşümü de atlanır.
export async function getCachedPool(env, kind, fetchPool) {
  if (env.FACET_CACHE) {
    const cached = await env.FACET_CACHE.get(poolCacheKey(kind), 'json');
    if (cached) return cached;
  }
  // withSingleFlight — bkz. dosya başı yorumu: KV MISS anında AYNI isolate'e düşen eşzamanlı
  // istekler pahalı fetchPool()'u tek seferde paylaşır.
  const pool = await withSingleFlight(`pool:${kind}`, fetchPool);
  // gerçek bulgu (denetim raporu): R2 için var olan r2Quota.js'e benzer bir KV yazma-kotası koruması
  // yoktu — 5 havuz türü her PoP'ta bağımsız MISS/yeniden-yazma yapabildiğinden ("read-your-own-write"
  // PoP-başına), ücretsiz kotanın (günde 1000 yazma) sanılandan önce zorlanması riski vardı (bkz.
  // src/lib/kvQuota.js). reserveKvWrite false dönerse yazma sessizce atlanır — bir sonraki istek
  // yalnızca tekrar D1'den okur, hiçbir kullanıcı işlemi bozulmaz.
  if (env.FACET_CACHE && await reserveKvWrite(env)) {
    await env.FACET_CACHE.put(poolCacheKey(kind), JSON.stringify(pool), { expirationTtl: POOL_CACHE_TTL_SECONDS });
  }
  return pool;
}

// Admin panelinden bir POST/PATCH/DELETE ile içerik değiştiğinde çağrılır (bkz. src/routes/
// admin.js#handleSubmissionsAdmin, src/routes/submissions.js, src/routes/legacyContent.js,
// src/routes/payments.js). Hangi public uç(lar)ın etkilendiğini tek tek izlemek yerine (7 gönderi
// tipi + statik içerik + claimed_slug/claimed_profile_key çapraz etkileri nedeniyle kolayca eksik/
// hatalı olurdu) sabit anahtar listesinin TAMAMI (4 sabit yol + 4 liste ucunun PARAMETRESİZ
// varyantı) VE yukarıdaki üç pool cache anahtarı BİRLİKTE temizlenir — bu uçlar hafif D1 sorguları
// olduğundan gereksiz yere temizlenmelerinin maliyeti düşük (bkz. kullanıcı isteği: "ilgili cache
// tag'ini invalidation yapacak ... mantığı kur"). `env` parametresi — yukarıdaki pool cache KV
// binding'ine (FACET_CACHE) erişmek için gerekli, öncesinde bu fonksiyon parametresizdi; TÜM çağıran
// noktalar (13 tanesi) buna göre güncellendi.
export async function invalidatePublicCache(env) {
  await Promise.all([
    ...[...CACHEABLE_PATHS, ...BARE_LIST_PATHS].map(async p => {
      try { await caches.default.delete(cacheKeyFor(p)); } catch {}
    }),
    ...(env && env.FACET_CACHE ? POOL_CACHE_KINDS.map(async kind => {
      try { await env.FACET_CACHE.delete(poolCacheKey(kind)); } catch {}
    }) : []),
  ]);
}
