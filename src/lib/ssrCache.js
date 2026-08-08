import { slugify } from './slugify.js';

// src/index.js#serveDetailPage bu sürümü SSR HTML önbelleğinin (caches.default) anahtarına ekler
// (bkz. o dosyadaki withVersionedCacheKey/SSR_CACHE_VERSION yorumu) — koda gömülü *-detay.html
// şablonlarından biri değiştiğinde bu değer artırılır. Tek kaynak burada tutulur ki purgeSsrDetailCache
// (aşağıda) index.js'in kullandığıyla AYNI anahtarı üretsin.
export const SSR_CACHE_VERSION = 'v62';

const PREFIX_BY_TYPE = {
  project: '/projeler/',
  architect: '/mimar/',
  office: '/firma/',
  product: '/urun/',
  news: '/haberler/',
  // /danisman modülü (eski adı "/danismanlik") — bu turda çağıran yok (admin/self-serve düzenleme
  // akışı henüz eklenmedi, bkz. kullanıcı isteği), ileride bir purge noktası eklendiğinde diğer
  // tiplerle AYNI eşleme hazır olsun diye eklendi.
  consultant: '/danisman/',
};

// architect/office temiz URL'leri isimden slugify edilir (bkz. src/index.js#CLEAN_URL_REDIRECTS
// slugifyValue:true) — project/news zaten kendi slug/id'sini, product zaten kendi anahtarını (ör.
// "m-<submissionId>") kullanır, ayrıca slugify edilmez.
const SLUGIFY_TYPES = new Set(['architect', 'office', 'consultant']);

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
  const prefix = PREFIX_BY_TYPE[type];
  if (!prefix || !rawKey) return;
  const slug = SLUGIFY_TYPES.has(type) ? slugify(rawKey) : rawKey;
  if (!slug) return;
  try {
    const keyUrl = new URL(`https://mimarlab.com${prefix}${encodeURIComponent(slug)}`);
    keyUrl.searchParams.set('__cv', SSR_CACHE_VERSION);
    await caches.default.delete(new Request(keyUrl));
  } catch { /* caches API bazı ortamlarda (ör. yerel wrangler dev) kullanılamayabilir */ }
}

// src/lib/submissionTypes.js#SUBMISSION_TYPES anahtarlarını (offices/projects/products/materials/
// architects/news) yukarıdaki PREFIX_BY_TYPE anahtarlarına eşler — materials, products ile
// aynı /urun/ modalını (urun.html + js/components/product-modal.js) paylaşır.
const SSR_TYPE_BY_SUBMISSION_TYPE = {
  projects: 'project', architects: 'architect', offices: 'office',
  products: 'product', materials: 'product', news: 'news',
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
  if (typeKey === 'news') return { type, key: row.id };
  return null;
}
