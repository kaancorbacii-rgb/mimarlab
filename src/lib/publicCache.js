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

const ADMIN_CACHE_HEADERS = { 'Cache-Control': 'no-store, no-cache' };
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

// Sorgu dizesi taşımayan (dolayısıyla sonlu/sabit) public uçların tam listesi — her biri
// caches.default'ta kendi URL'siyle anahtarlanır ve bir admin yazma işleminden sonra tek seferde
// temizlenir (bkz. invalidatePublicCache). profile-content/claim-status/save-count gibi profil ya
// da kayıt anahtarına göre parametrelenen uçlar bilerek dahil değildir — olası anahtar sayısı
// sınırsız olduğundan (her mimar/proje için ayrı bir URL) paylaşımlı önbelleğe pratik biçimde
// alınıp güvenilir şekilde temizlenemez; onlar yalnızca ANON_CACHE_HEADERS başlığıyla (tarayıcı
// düzeyinde, kendiliğinden dolan) önbelleklenir.
const CACHEABLE_PATHS = [
  '/api/public/offices', '/api/public/projects', '/api/public/products',
  '/api/public/materials', '/api/public/jobs', '/api/public/architects',
  '/api/public/hidden', '/api/public/project-edits', '/api/public/profile-edits',
  '/api/public/news',
];

function cacheKeyFor(pathname) {
  // caches.default sabit bir Request nesnesi ister; bu uçlarda sorgu dizesi olmadığından
  // pathname'in kendisi zaten benzersiz bir anahtardır — gerçek istek origin'inden bağımsız,
  // sabit bir origin kullanılır (host'a göre değişen bir anahtar üretmemek için).
  return new Request(`https://mimarlab.com${pathname}`, { method: 'GET' });
}

// GET /api/public/* handler'larının ortak sarmalayıcısı. computeData(), yanıt gövdesini
// (JSON'a çevrilecek düz obje) üreten async bir fonksiyondur. pathname CACHEABLE_PATHS
// listesindeyse VE istek admin'den gelmiyorsa Workers Cache API üzerinden gerçek bir paylaşımlı
// (edge) önbellek kullanılır; admin istekleri veya listede olmayan yollar için her zaman taze
// hesaplanır.
export async function cachedPublicJson(request, env, pathname, computeData) {
  const admin = await isAdminRequest(request, env);
  if (admin) return json(await computeData(), 200, ADMIN_CACHE_HEADERS);

  if (!CACHEABLE_PATHS.includes(pathname)) {
    return json(await computeData(), 200, ANON_CACHE_HEADERS);
  }

  const cacheKey = cacheKeyFor(pathname);
  try {
    const cached = await caches.default.match(cacheKey);
    if (cached) return cached;
  } catch { /* caches API bazı ortamlarda (ör. yerel wrangler dev http://) kullanılamayabilir */ }

  const response = json(await computeData(), 200, ANON_CACHE_HEADERS);
  try { await caches.default.put(cacheKey, response.clone()); } catch {}
  return response;
}

// Admin panelinden bir POST/PATCH/DELETE ile içerik değiştiğinde çağrılır (bkz. src/routes/
// admin.js#handleSubmissionsAdmin, src/routes/submissions.js, src/routes/legacyContent.js).
// Hangi public uç(lar)ın etkilendiğini tek tek izlemek yerine (7 gönderi tipi + statik içerik +
// claimed_slug/claimed_profile_key çapraz etkileri nedeniyle kolayca eksik/hatalı olurdu)
// yukarıdaki sabit anahtar listesinin TAMAMI temizlenir — bu uçlar hafif D1 sorguları olduğundan
// gereksiz yere temizlenmelerinin maliyeti düşük (bkz. kullanıcı isteği: "ilgili cache tag'ini
// invalidation yapacak ... mantığı kur").
export async function invalidatePublicCache() {
  await Promise.all(CACHEABLE_PATHS.map(async p => {
    try { await caches.default.delete(cacheKeyFor(p)); } catch {}
  }));
}
