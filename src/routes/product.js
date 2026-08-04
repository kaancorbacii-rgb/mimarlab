import { errorJson } from '../lib/http.js';
import { parseSubmissionRow } from '../lib/submissionTypes.js';
import { slugify } from '../lib/slugify.js';
import { cachedPublicJson } from '../lib/publicCache.js';
// bkz. src/routes/architect.js'teki AYNI CJS-interop yorumu.
import urunJs from '../../urunler-data.js';
import malzemeJs from '../../malzemeler-data.js';

const { products } = urunJs;
const { materials } = malzemeJs;

// ÖNEMLİ: bkz. src/routes/architect.js'teki AYNI "paylaşılan diziler mutasyona uğratılmaz" yorumu.

// urun.html/urun-detay.html#productKey ile BİREBİR aynı üretim (bkz. src/lib/seo.js#staticProductKey'
// deki AYNI yorum) — statik kayıtlarda slugify(title + '-' + brand), D1 kayıtlarında "m-<submissionId>".
function staticProductKey(x) { return slugify(`${x.title}-${x.brand || ''}`); }

function shapeRow(kind, row) {
  const p = parseSubmissionRow(kind, row);
  return {
    title: p.title, brand: p.brand, architect: p.architect, website: p.website, category: p.category,
    description: p.description, images: p.images, specs: p.specs, kind, submissionId: p.id,
  };
}

// GET /api/product/:key — urun-detay.html henüz bu uca bağlanmadı (bkz. docs/architecture-roadmap.md,
// bu turda yalnızca mimar-detay.html/ofis-detay.html/proje.html değiştirildi) ama Faz 1'in "overlay
// worker katmanına taşınsın" hedefiyle tutarlı, çalışır bir uç nokta olarak eklendi. products/materials
// arasında claim/profile-edit overlay sistemi yok (bkz. schema.sql#profile_submissions yorumu) — bu
// yüzden burada statik+DB birleştirmesi diğer üç dosyadan daha basit, yalnızca doğru kaydı bulup
// döndürür.
export async function handleProductDetailRoute(request, env, url, rawKey) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  const key = decodeURIComponent(rawKey || '');
  if (!key) return errorJson('Geçersiz istek.');

  return cachedPublicJson(request, env, url.pathname, async () => {
    const staticMatch = products.find(x => staticProductKey(x) === key)
      || materials.find(x => staticProductKey(x) === key);
    if (staticMatch) {
      const kind = products.includes(staticMatch) ? 'products' : 'materials';
      const hidden = await env.DB.prepare(
        `SELECT 1 FROM legacy_content_hidden WHERE content_type = ? AND content_key = ? LIMIT 1`
      ).bind(kind, `${staticMatch.brand || ''}|||${staticMatch.title}`).first();
      return { item: { ...staticMatch, kind }, hidden: !!hidden };
    }

    const m = /^m-(.+)$/.exec(key);
    if (!m) return { item: null, hidden: false };
    const id = m[1];
    const productRow = await env.DB.prepare(`SELECT * FROM product_submissions WHERE id = ? AND status = 'approved'`).bind(id).first();
    const row = productRow || await env.DB.prepare(`SELECT * FROM material_submissions WHERE id = ? AND status = 'approved'`).bind(id).first();
    if (!row) return { item: null, hidden: false };
    return { item: shapeRow(productRow ? 'products' : 'materials', row), hidden: false };
  });
}
