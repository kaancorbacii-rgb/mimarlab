import { errorJson } from '../lib/http.js';
import { slugify } from '../lib/slugify.js';
import { cachedPublicJson } from '../lib/publicCache.js';
import { parseCanonicalRow } from '../lib/canonicalRead.js';

// Faz 3 — statik urunler-data.js/malzemeler-data.js + product_submissions/material_submissions
// yerine doğrudan canonical `products` tablosundan okur (kind='product'/'material' ile ayrılır,
// bkz. migrations/0022_id_first_entities.sql). bkz. src/routes/architect.js'teki AYNI "overlay
// merge-time'da zaten uygulandı" yorumu — products/materials'ta zaten claim/overlay sistemi
// olmadığından (bkz. schema.sql yorumu) bu dosya diğer üçünden daha basit kalmaya devam ediyor.

function shapeProductItem(row) {
  const p = parseCanonicalRow('products', row);
  return {
    title: p.title, brand: p.brand_name_raw, website: p.website, category: p.category,
    description: p.description, images: p.images, specs: p.specs, kind: p.kind,
  };
}

// GET /api/product/:key — urun-detay.html henüz bu uca bağlanmadı (bkz. eski yorum, Faz 3'te de
// değişmedi). `key`, ya doğrudan canonical `slug` (statik kayıtlarda "<başlık-marka>-<id>", üye
// kökenli kayıtlarda "m-<eski submission id>") ya da urun.html/urun-detay.html#productKey'in ÜRETTİĞİ
// eski biçim (id'siz `slugify(title + '-' + brand)`, bkz. o dosyalardaki AYNI fonksiyon) olabilir —
// ikincisi için tabloyu tarayıp aynı fonksiyonla yeniden üretilen anahtarla karşılaştırma yapılır
// (tablo küçük olduğundan ucuz, bkz. src/routes/architect.js#findArchitect'teki AYNI fallback deseni).
export async function handleProductDetailRoute(request, env, url, rawKey) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  const key = decodeURIComponent(rawKey || '');
  if (!key) return errorJson('Geçersiz istek.');

  return cachedPublicJson(request, env, url.pathname, async () => {
    let row = await env.DB.prepare(`SELECT * FROM products WHERE slug = ? AND deleted_at IS NULL`).bind(key).first();
    if (!row) {
      const { results } = await env.DB.prepare(`SELECT id, title, brand_name_raw FROM products WHERE deleted_at IS NULL`).all();
      const match = results.find(r => slugify(`${r.title}-${r.brand_name_raw || ''}`) === key);
      if (match) row = await env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(match.id).first();
    }
    if (!row) return { item: null, hidden: false };
    return { item: shapeProductItem(row), hidden: !!row.hidden_at };
  });
}
