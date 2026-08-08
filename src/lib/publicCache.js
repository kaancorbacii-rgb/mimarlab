import { json } from './http.js';
import { getSessionUser } from './auth.js';

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
const PUBLIC_LIST_CACHE_HEADERS = { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400' };

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
const BARE_LIST_PATHS = [...CACHEABLE_LIST_PREFIXES, ...HOMEPAGE_LIST_PATHS];

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
  if (admin) return json(await computeData(), 200, ADMIN_CACHE_HEADERS);

  const listPath = isListPath(pathname);
  const cacheable = CACHEABLE_PATHS.includes(pathname) || listPath;
  const headers = listPath ? PUBLIC_LIST_CACHE_HEADERS : ANON_CACHE_HEADERS;

  if (!cacheable) return json(await computeData(), 200, headers);

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
    // (bugün yalnızca /api/projects) bu yüzden HIT yolunda da ucuz parmak izi sorgusuyla gerçek
    // tazelik doğrulanır — fingerprint uyuşmuyorsa bu girdi bayat sayılıp MISS gibi devam edilir.
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
  const response = json(await computeData(), 200, responseHeaders);
  try { await caches.default.put(cacheKey, response.clone()); } catch {}
  return response;
}

// Admin panelinden bir POST/PATCH/DELETE ile içerik değiştiğinde çağrılır (bkz. src/routes/
// admin.js#handleSubmissionsAdmin, src/routes/submissions.js, src/routes/legacyContent.js).
// Hangi public uç(lar)ın etkilendiğini tek tek izlemek yerine (7 gönderi tipi + statik içerik +
// claimed_slug/claimed_profile_key çapraz etkileri nedeniyle kolayca eksik/hatalı olurdu)
// sabit anahtar listesinin TAMAMI (4 sabit yol + 4 liste ucunun PARAMETRESİZ varyantı) temizlenir
// — bu uçlar hafif D1 sorguları olduğundan gereksiz yere temizlenmelerinin maliyeti düşük (bkz.
// kullanıcı isteği: "ilgili cache tag'ini invalidation yapacak ... mantığı kur").
export async function invalidatePublicCache() {
  await Promise.all([...CACHEABLE_PATHS, ...BARE_LIST_PATHS].map(async p => {
    try { await caches.default.delete(cacheKeyFor(p)); } catch {}
  }));
}
