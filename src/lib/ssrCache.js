import { slugify } from './slugify.js';
import { cacheKeyFor } from './publicCache.js';

// src/index.js#serveDetailPage bu sürümü SSR HTML önbelleğinin (caches.default) anahtarına ekler
// (bkz. o dosyadaki withVersionedCacheKey/SSR_CACHE_VERSION yorumu) — koda gömülü *-detay.html
// şablonlarından biri değiştiğinde bu değer artırılır. Tek kaynak burada tutulur ki purgeSsrDetailCache
// (aşağıda) index.js'in kullandığıyla AYNI anahtarı üretsin.
export const SSR_CACHE_VERSION = 'v93';

const PREFIX_BY_TYPE = {
  project: '/proje/',
  architect: '/mimar/',
  office: '/firma/',
  product: '/urun/',
};

// D1 audit (2026-08-25) P0-1 — publicCache.js#CACHEABLE_DETAIL_PREFIXES ile BİREBİR aynı 4 yol.
// purgeSsrDetailCache zaten her içerik-mutasyon noktasında (type, key) ile çağrılıyor (bkz. aşağıdaki
// export'un tüm çağıranları — admin.js, submissions.js, legacyContent.js, officeFounderCascade.js,
// canonicalSync.js, architect.js/product.js kendi profil güncellemeleri) — SSR HTML sayfa cache'i
// (caches.default) İLE AYNI anda, aynı (type, key) çiftiyle yeni JSON detay cache girdisini de
// temizlemek için bu haritayı ayrı bir çağıran zinciri kurmadan burada kullanmak yeterli.
const API_DETAIL_PREFIX_BY_TYPE = {
  project: '/api/project/',
  architect: '/api/architect/',
  office: '/api/office/',
  product: '/api/product/',
};

// architect/office temiz URL'leri isimden slugify edilir (bkz. src/index.js#CLEAN_URL_REDIRECTS
// slugifyValue:true) — project/product zaten kendi slug/anahtarını (ör. "m-<submissionId>")
// kullanır, ayrıca slugify edilmez.
const SLUGIFY_TYPES = new Set(['architect', 'office']);

// Admin panelinden (ya da admin'in kendi gönderisinin anında yayına girmesiyle) bir proje/mimar/
// firma/ürün değiştiğinde, o kaydın SSR HTML önbelleğini (bkz. src/index.js#serveDetailPage)
// hemen temizlemeye çalışır. invalidatePublicCache (bkz. publicCache.js) yalnızca istemcinin
// çalışma zamanında okuduğu /api/public/* JSON uçlarını temizler — SSR katmanına gömülü <title>/
// og:image/JSON-LD gibi meta etiketler bundan etkilenmiyordu (gerçek bulgu: admin bir projenin
// kapak görselini değiştirdikten hemen sonra paylaşım önizlemesi/SEO meta'sı s-maxage=3600 boyunca
// eski kalabiliyordu). caches.default PoP-başınadır (bkz. publicCache.js#invalidatePublicCache'teki
// aynı sınırlama) — bu yalnızca YAZMA isteğini işleyen edge node'un kendi girdisini temizler, tam
// bir garanti değildir; bu yüzden src/index.js'teki SSR_PAGE_CACHE_HEADERS s-maxage'ı da kısa
// tutulur, bu purge sadece en yaygın durumda (aynı PoP'a düşen sonraki istek) anlık bir düzeltme
// sağlar. rawKey boşsa ya da tip tanınmıyorsa sessizce hiçbir şey yapmaz.
export async function purgeSsrDetailCache(type, rawKey) {
  const prefixes = PREFIX_BY_TYPE[type];
  if (!prefixes || !rawKey) return;
  const slug = SLUGIFY_TYPES.has(type) ? slugify(rawKey) : rawKey;
  if (!slug) return;
  for (const prefix of Array.isArray(prefixes) ? prefixes : [prefixes]) {
    try {
      const keyUrl = new URL(`https://mimarlab.com${prefix}${encodeURIComponent(slug)}`);
      keyUrl.searchParams.set('__cv', SSR_CACHE_VERSION);
      await caches.default.delete(new Request(keyUrl));
    } catch { /* caches API bazı ortamlarda (ör. yerel wrangler dev) kullanılamayabilir */ }
  }
  // D1 audit (2026-08-25) P0-1 — /api/project|architect|office|product/:key JSON detay cache'i
  // (bkz. publicCache.js#cachedPublicJson'daki yeni isDetailPath dalı) yukarıdaki SSR HTML
  // girdisiyle AYNI anahtar biçimini (slugify edilmiş architect/office adı, ham project/product
  // slug'ı) paylaşır — cacheKeyFor() publicCache.js'ten içe aktarılır ki iki dosyanın anahtar
  // üretimi zamanla birbirinden SAPMASIN. __cv sürüm parametresi YOK — JSON detay cache'i
  // SSR_CACHE_VERSION'dan bağımsız (yalnızca SSR şablonu değiştiğinde artan bir sürüm, JSON yanıt
  // şeklini etkilemez).
  const apiPrefix = API_DETAIL_PREFIX_BY_TYPE[type];
  if (apiPrefix) {
    try {
      await caches.default.delete(cacheKeyFor(`${apiPrefix}${encodeURIComponent(slug)}`));
    } catch { /* caches API bazı ortamlarda (ör. yerel wrangler dev) kullanılamayabilir */ }
  }
}

// src/lib/submissionTypes.js#SUBMISSION_TYPES anahtarlarını (offices/projects/products/materials/
// architects) yukarıdaki PREFIX_BY_TYPE anahtarlarına eşler — materials, products ile aynı /urun/
// modalını (urun.html + js/components/product-modal.js) paylaşır.
const SSR_TYPE_BY_SUBMISSION_TYPE = {
  projects: 'project', architects: 'architect', offices: 'office',
  products: 'product', materials: 'product',
};

// Bir <tip>_submissions satırından (claimed_slug/claimed_profile_key varsa statik kaydın kendi
// anahtarı, yoksa satırın kendi slug/name/id'si) purgeSsrDetailCache'e verilecek {type, key} çiftini
// çıkarır. Ürün/malzeme için satırın kendi id'sinden türeyen "m-<id>" anahtarı kullanılır (bkz.
// js/components/product-modal.js#fetchItem — üye gönderili kayıtlar için aynı desen). Eşlemede
// karşılığı olmayan tipler için null döner.
export function ssrPurgeTargetFor(typeKey, row) {
  const type = SSR_TYPE_BY_SUBMISSION_TYPE[typeKey];
  if (!type || !row) return null;
  if (typeKey === 'projects') return { type, key: row.claimed_slug || row.slug };
  if (typeKey === 'architects' || typeKey === 'offices') return { type, key: row.claimed_profile_key || row.name };
  if (typeKey === 'products' || typeKey === 'materials') return row.id ? { type, key: `m-${row.id}` } : null;
  return null;
}
