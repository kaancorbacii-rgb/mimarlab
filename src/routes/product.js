import { errorJson } from '../lib/http.js';
import { slugify } from '../lib/slugify.js';
import { cachedPublicJson } from '../lib/publicCache.js';
import { parseCanonicalRow } from '../lib/canonicalRead.js';
import { fetchOwnerByline } from '../lib/ownerByline.js';
import { serializePublicEntity } from '../lib/serializePublicEntity.js';
// bkz. src/routes/project.js'teki AYNI CJS-interop yorumu (il-ilce-data.js için) — bu dosya da
// canonical veri DEĞİL, salt statik bir taksonomi referans tablosu.
import catalogTaxonomyJs from '../../catalog-taxonomy.js';

const { CATALOG_TAXONOMY, taxonomyGroupOf } = catalogTaxonomyJs;

// Faz 3 — statik urunler-data.js/malzemeler-data.js + product_submissions/material_submissions
// yerine doğrudan canonical `products` tablosundan okur (kind='product'/'material' ile ayrılır,
// bkz. migrations/0022_id_first_entities.sql). bkz. src/routes/architect.js'teki AYNI "overlay
// merge-time'da zaten uygulandı" yorumu — products/materials'ta zaten claim/overlay sistemi
// olmadığından (bkz. schema.sql yorumu) bu dosya diğer üçünden daha basit kalmaya devam ediyor.

// isSubmissionMarker: handleProductListRoute'taki (aşağıda) AYNI "legacy_key 'submission:' ile
// başlıyorsa üye/marka gönderisi kökenli" kontrolü — js/components/product-modal.js#mountAdminActions
// admin Arşivle/Sil isteğinde id (üye gönderisi) mi key (statik kayıt) mi göndereceğine bununla karar verir.
function shapeProductItem(row) {
  const p = parseCanonicalRow('products', row);
  const isSubmissionMarker = typeof row.legacy_key === 'string' && row.legacy_key.startsWith('submission:');
  return {
    title: p.title, brand: p.brand_name_raw, website: p.website, category: p.category,
    description: p.description, images: p.images, specs: p.specs, kind: p.kind,
    submissionId: isSubmissionMarker ? row.legacy_key.slice('submission:'.length) : null,
  };
}

// GET /api/products/search?q=... — src/routes/office.js#handleOfficeSearchRoute'un ürün karşılığı;
// proje-ekle.html'deki "Kullanılan Ürünler / Firmalar" kutusundaki Ürün autocomplete'inin canlı D1
// sorgusu (bkz. kullanıcı isteği: "Kullanılan ürünler kısmını geri getir").
export async function handleProductSearchRoute(request, env, url) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    const q = foldTr((url.searchParams.get('q') || '').trim());
    if (!q) return { items: [] };
    const { results } = await env.DB.prepare(
      `SELECT slug, title, brand_name_raw FROM products WHERE deleted_at IS NULL AND hidden_at IS NULL ORDER BY title`
    ).all();
    const items = results
      .filter(r => foldTr(r.title).includes(q))
      .slice(0, 20)
      .map(r => ({ label: r.title, sub: r.brand_name_raw || '', brand: r.brand_name_raw || '' }));
    return { items };
  });
}

// Önceki/Sonraki Ürün — bkz. src/routes/architect.js#fetchAdjacentArchitect'teki AYNI desen. kind
// (product/material) sınırı GÖZETİLMEZ — id sırası tüm `products` tablosu üzerinden dairesel/sıralı.
// bkz. kullanıcı isteği: Önceki/Sonraki butonlarına önizleme görseli eklenmesi.
function firstImage(imagesJson) {
  try { const arr = imagesJson ? JSON.parse(imagesJson) : []; return arr[0] || null; } catch { return null; }
}

async function fetchAdjacentProduct(env, id) {
  const where = `deleted_at IS NULL AND hidden_at IS NULL`;
  let prev = await env.DB.prepare(`SELECT id, slug, title, images FROM products WHERE ${where} AND id < ? ORDER BY id DESC LIMIT 1`).bind(id).first();
  let next = await env.DB.prepare(`SELECT id, slug, title, images FROM products WHERE ${where} AND id > ? ORDER BY id ASC LIMIT 1`).bind(id).first();
  if (!prev) prev = await env.DB.prepare(`SELECT id, slug, title, images FROM products WHERE ${where} ORDER BY id DESC LIMIT 1`).first();
  if (!next) next = await env.DB.prepare(`SELECT id, slug, title, images FROM products WHERE ${where} ORDER BY id ASC LIMIT 1`).first();
  if (prev && prev.id === id) prev = null;
  if (next && next.id === id) next = null;
  return {
    prevItem: prev ? { slug: prev.slug, title: prev.title, image: firstImage(prev.images) } : null,
    nextItem: next ? { slug: next.slug, title: next.title, image: firstImage(next.images) } : null,
  };
}

// GET /api/product/:key — js/components/product-modal.js#fetchItem bu uca bağlanır (proje.html'in
// ProjectModal'ı proje-detay.html'i tamamen ikame ettiği desenin ürün karşılığı, bkz. plan dosyası).
// `key`, ya doğrudan canonical `slug` (statik kayıtlarda "<başlık-marka>-<id>", üye
// kökenli kayıtlarda "m-<eski submission id>") ya da urun.html/urun-detay.html#productKey'in ÜRETTİĞİ
// eski biçim (id'siz `slugify(title + '-' + brand)`, bkz. o dosyalardaki AYNI fonksiyon) olabilir —
// ikincisi için tabloyu tarayıp aynı fonksiyonla yeniden üretilen anahtarla karşılaştırma yapılır
// (tablo küçük olduğundan ucuz, bkz. src/routes/architect.js#findArchitect'teki AYNI fallback deseni).
// bkz. yukarıdaki dosya başı yorumu — hem GET /api/product/:key hem de src/routes/ratings.js#myRatings
// (Beğendiklerim kutusu, ratingKeyFor'un ürettiği AYNI eski/yeni biçimli anahtarları çözmesi gerekiyor)
// tarafından paylaşılır — iki ayrı kopya, biri güncellenip diğeri unutulursa sessizce ayrışabilirdi.
export async function findProductByKey(env, key) {
  let row = await env.DB.prepare(`SELECT * FROM products WHERE slug = ? AND deleted_at IS NULL`).bind(key).first();
  if (!row) {
    const { results } = await env.DB.prepare(`SELECT id, title, brand_name_raw FROM products WHERE deleted_at IS NULL`).all();
    const match = results.find(r => slugify(`${r.title}-${r.brand_name_raw || ''}`) === key);
    if (match) row = await env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(match.id).first();
  }
  return row || null;
}

export async function handleProductDetailRoute(request, env, url, rawKey) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  const key = decodeURIComponent(rawKey || '');
  if (!key) return errorJson('Geçersiz istek.');

  return cachedPublicJson(request, env, url.pathname, async () => {
    const row = await findProductByKey(env, key);
    if (!row) return { item: null, hidden: false };
    const item = shapeProductItem(row);
    const [adjacent, owner] = await Promise.all([
      fetchAdjacentProduct(env, row.id),
      fetchOwnerByline(env, row.claimed_by_user_id),
    ]);
    item.prevItem = adjacent.prevItem;
    item.nextItem = adjacent.nextItem;
    if (owner) Object.assign(item, owner);
    return { item, hidden: !!row.hidden_at };
  });
}

function trLower(s) {
  return (s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/Ş/g, 'ş').replace(/Ğ/g, 'ğ').replace(/Ü/g, 'ü').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç').toLowerCase();
}

// trLower Türkçe BÜYÜK->küçük eşlemesini doğru yapar ama bu yüzden ASCII "I" (ör. Türkçe olmayan/
// ALL-CAPS yazılmış isimlerde) noktasız 'ı'ya döner — kullanıcı normal klavyeyle (düz 'i' ile)
// yazdığında eşleşme kaçırılabiliyordu (bkz. src/routes/project.js#foldTr'deki AYNI gerçek bulgu/
// gerekçe — SANKAI proje arama hatası). Sorgu VE hedef metin AYNI foldTr'den geçirilir.
function foldTr(s) {
  return trLower(s).replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o');
}

// rating-widget.js#ratingBuckets ile BİREBİR aynı — "en az N yıldız" kovaları.
function ratingBuckets(average) {
  if (!average) return [];
  const buckets = [];
  for (let n = Math.floor(average); n >= 1; n--) buckets.push(`${n}+ Yıldız`);
  return buckets;
}

// urun.html#productKey ile BİREBİR aynı üretim — canonical `slug` (legacy_static satırlarda
// `slugify(title+brand)-<id>`, bkz. scripts/migrate-to-id-first.js) DEĞİL, bu eski biçim kullanılır;
// aksi halde bu turdan önce verilmiş puan/kaydetme kayıtları (target_id bu eski anahtarla yazıldı)
// yetim kalırdı. `submissionId` yalnızca bu satır bir üye gönderisinden geldiyse (bkz.
// src/routes/office.js#buildOfficePayload'daki AYNI "submission:" marker kontrolü) dolu olur.
function ratingKeyFor(title, brand, submissionId) {
  if (submissionId) return `m-${submissionId}`;
  return slugify(`${title}-${brand || ''}`);
}

// GET /api/products — urun.html#render()'ın sayfalanmış sunucu karşılığı. `kind` alanı sayesinde
// (canonical `products` tablosu zaten 'product'/'material' ayrımını tutuyor) urun.html'in bugün
// client'ta yaptığı `products.push(...materials)` birleştirmesi gerekmiyor — tek sorgu ikisini de
// döner (kullanıcı isteği: "Artık sadece ürün sayfası yayında olsun", tek liste).
export async function handleProductListRoute(request, env, url) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);

  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
    const limit = Math.min(96, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 24));
    const sort = url.searchParams.get('sort') || '';
    const groupParam = url.searchParams.get('group') || '';
    const categoryParam = url.searchParams.get('category') || '';
    const brandParam = url.searchParams.get('brand') || '';
    const ratingParam = url.searchParams.get('rating') || '';
    const searchQuery = foldTr((url.searchParams.get('search') || '').trim());

    // ORDER BY id DESC — src/routes/project.js#handleProjectsRoute'daki AYNI varsayılan sıralama
    // (sort seçilmemişse "son eklenen ilk") — anasayfa Ürün carousel'i (bkz. index.html) bu
    // varsayılana güvenerek ?limit=6 ile doğrudan son eklenen 6 ürünü çeker.
    // Faz 4A — Projection Optimization: kart listesi title/brand/category/kind/ilk görsel/
    // submissionId'yi render eder (bkz. aşağıdaki pool.map) — description/specs/website gibi
    // yalnızca tekil ürün sayfasında (handleProductDetailRoute, ayrı bir sorgu) gereken ağır metin
    // kolonları bu listeye dahil edilmiyor.
    const [productsRes, ratingRows] = await Promise.all([
      env.DB.prepare(`SELECT slug, title, brand_name_raw, category, kind, images, legacy_key FROM products WHERE deleted_at IS NULL AND hidden_at IS NULL ORDER BY id DESC`).all(),
      env.DB.prepare(`SELECT target_type, target_id, AVG(stars) AS average, COUNT(*) AS count FROM ratings WHERE target_type IN ('product','material') GROUP BY target_type, target_id`).all(),
    ]);
    const ratingByKey = new Map(ratingRows.results.map(r => [`${r.target_type}:${r.target_id}`, { average: r.average, count: r.count }]));

    const pool = productsRes.results.map(row => {
      const p = shapeProductItem(row);
      const isSubmissionMarker = typeof row.legacy_key === 'string' && row.legacy_key.startsWith('submission:');
      const submissionId = isSubmissionMarker ? row.legacy_key.slice('submission:'.length) : null;
      const ratingKey = ratingKeyFor(p.title, p.brand, submissionId);
      const group = taxonomyGroupOf(CATALOG_TAXONOMY, p.category);
      const ratingKind = p.kind === 'material' ? 'material' : 'product';
      const rating = ratingByKey.get(`${ratingKind}:${ratingKey}`) || { average: 0, count: 0 };
      return {
        slug: row.slug, title: p.title, brand: p.brand, category: p.category, kind: p.kind,
        image: (p.images && p.images[0]) || null, group, ratingKey, submissionId, rating,
      };
    });

    // urun.html#passesFilters ile BİREBİR aynı — exceptKey ile o grubun kendi seçimi hariç tutularak
    // faceted (diğer aktif filtrelerle bağımlı) sayaç üretir (bkz. proje.html#passesFilters'daki AYNI desen).
    function passes(p, exceptKey) {
      if (groupParam && exceptKey !== 'group' && p.group !== groupParam) return false;
      if (categoryParam && exceptKey !== 'category' && p.category !== categoryParam) return false;
      if (brandParam && exceptKey !== 'brand' && p.brand !== brandParam) return false;
      if (ratingParam && exceptKey !== 'rating' && !ratingBuckets(p.rating.average).includes(ratingParam)) return false;
      if (searchQuery) {
        const fields = [p.title, p.category, p.brand];
        if (!fields.some(v => v && foldTr(String(v)).includes(searchQuery))) return false;
      }
      return true;
    }

    const filtered = pool.filter(p => passes(p, null));

    if (sort) {
      filtered.sort((a, b) => {
        switch (sort) {
          case 'name_asc': return a.title.localeCompare(b.title, 'tr');
          case 'rating_desc': case 'rating_asc': {
            const ra = a.rating, rb = b.rating;
            if (!ra.count && !rb.count) return 0;
            if (!ra.count) return 1;
            if (!rb.count) return -1;
            return sort === 'rating_desc' ? rb.average - ra.average : ra.average - rb.average;
          }
          default: return 0;
        }
      });
    }

    // urun.html#buildSidebar — her grubun sayacı, O GRUP HARİÇ diğer aktif filtrelerle eşleşen
    // ürünler üzerinden hesaplanır (proje.html#handleProjectFiltersRoute'daki AYNI faceted desen).
    function countsFor(key, fieldFn) {
      const passing = pool.filter(p => passes(p, key));
      const counts = {};
      passing.forEach(p => { (fieldFn(p) || []).forEach(v => { if (v) counts[v] = (counts[v] || 0) + 1; }); });
      return Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b, 'tr')).map(v => ({ value: v, count: counts[v] }));
    }

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (Math.min(page, totalPages) - 1) * limit;
    const items = filtered.slice(start, start + limit).map(({ group, rating, ...rest }) => rest);

    return {
      items: serializePublicEntity(items), total, page: Math.min(page, totalPages), totalPages,
      filters: {
        group: countsFor('group', p => [p.group]),
        category: countsFor('category', p => [p.category]),
        brand: countsFor('brand', p => [p.brand]),
        rating: countsFor('rating', p => ratingBuckets(p.rating.average)),
      },
    };
  }, () => productListFingerprint(env));
}

// Faz 4B — Conditional Requests: bkz. src/routes/architect.js#architectListFingerprint'teki AYNI
// desen.
function productListFingerprint(env) {
  return env.DB.prepare(
    `SELECT COUNT(*) AS cnt, MAX(updated_at) AS latest FROM products WHERE deleted_at IS NULL AND hidden_at IS NULL`
  ).first().then(row => `${row?.cnt ?? 0}:${row?.latest ?? ''}`);
}
