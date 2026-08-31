import { errorJson } from '../lib/http.js';
import { slugify } from '../lib/slugify.js';
import { cachedPublicJson, getCachedPool, getCachedFingerprint } from '../lib/publicCache.js';
import { parseCanonicalRow } from '../lib/canonicalRead.js';
import { fetchOwnerByline } from '../lib/ownerByline.js';
import { serializePublicEntity } from '../lib/serializePublicEntity.js';
import { fetchAdjacentEntity } from '../lib/adjacentEntity.js';
// bkz. src/routes/project.js'teki AYNI CJS-interop yorumu (il-ilce-data.js için) — bu dosya da
// canonical veri DEĞİL, salt statik bir taksonomi referans tablosu.
import catalogTaxonomyJs from '../../catalog-taxonomy.js';

const { CATALOG_TAXONOMY, CATALOG_MENU_COLUMNS, taxonomyGroupOf } = catalogTaxonomyJs;

// urun.html#buildSidebar'daki Grup/Kategori filtre sırası, ürün SAYISINA göre değil (bkz. aşağıdaki
// countsFor'un varsayılan sıralaması) mega menünün (js/components/nav-product-menu.js) okuma
// sırasına göre olsun istendi (bkz. kullanıcı isteği: "Ürün sayfasındaki filtreleri de mega menüdeki
// gibi güncelle") — CATALOG_MENU_COLUMNS zaten mega menünün kolon/sıra düzenini taşıyor, burada
// düzleştirilip her Grup'a ve (Grup içindeki CATALOG_TAXONOMY sırasına göre) her kategoriye bir
// sıra numarası atanır. Menüde yer almayan bir değer (olması beklenmez, CATALOG_MENU_COLUMNS her
// zaman CATALOG_TAXONOMY'nin tüm anahtarlarını kapsamalı) listenin sonuna düşer.
const CATALOG_GROUP_ORDER = new Map(CATALOG_MENU_COLUMNS.flat().map((g, i) => [g, i]));
const CATALOG_CATEGORY_ORDER = new Map(
  CATALOG_MENU_COLUMNS.flat().flatMap(g => CATALOG_TAXONOMY[g] || []).map((c, i) => [c, i])
);

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
    id: p.id, title: p.title, brand: p.brand_name_raw, website: p.website, category: p.category,
    designer: p.designer || null, year: p.year || null,
    description: p.description, images: p.images, specs: p.specs, files: p.files, kind: p.kind,
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
    // D1 audit (2026-08-25) P1-6 — 2 karakter altı sorgular hiç D1'e gitmez: istemci tarafında
    // (wireAutocompleteLive) bir minimum uzunluk kontrolü yoktu, her tuş vuruşu (1 karakter dahil)
    // tam tablo taramasını tetikliyordu (bkz. audit raporu D#5). 1 karakterlik bir aramanın önerisi
    // zaten pratikte kullanışsız kalabalık bir liste olurdu — bu eşik UX'i bozmaz, gürültüyü azaltır.
    if (!q || q.length < 2) return { items: [] };
    const { results } = await env.DB.prepare(
      `SELECT slug, title, brand_name_raw FROM products WHERE deleted_at IS NULL AND hidden_at IS NULL ORDER BY title`
    ).all();
    const items = results
      .filter(r => foldTr(r.title).includes(q))
      .slice(0, 20)
      // slug: proje-ekle.html'deki görsel işaretçisi editörü (bkz. migrations/
      // 0076_project_image_hotspots.sql) seçilen ürünü slug'ıyla bağlar — "Kullanılan Ürünler"
      // kutusunun kendisi hâlâ yalnızca label/brand kullanır, bu alan ona zarar vermeden eklenir.
      .map(r => ({ label: r.title, sub: r.brand_name_raw || '', brand: r.brand_name_raw || '', slug: r.slug }));
    return { items };
  });
}

// Önceki/Sonraki Ürün — bkz. src/lib/adjacentEntity.js. kind (product/material) sınırı GÖZETİLMEZ —
// id sırası tüm `products` tablosu üzerinden dairesel/sıralı. bkz. kullanıcı isteği: Önceki/Sonraki
// butonlarına önizleme görseli eklenmesi.
// "Kullanılan Projeler" (bkz. js/components/product-modal.js#renderUsedInProjects) — src/routes/
// project.js#fetchProjectProducts'ın AYNADAKİ karşılığı, AYNI project_products join'i ters yönde
// okunur. Kenar iki taraftan da kurulmuş olabilir (proje-ekle.html'deki "Kullanılan Ürünler /
// Firmalar" kutusu ya da urun-ekle.html'deki "Kullanılan Projeler" kutusu, bkz. migrations/
// 0072_product_project_links.sql) — burada ayrım YAPILMAZ, iki kaynak da aynı listeye düşer.
function firstImage(imagesJson) {
  try { const arr = imagesJson ? JSON.parse(imagesJson) : []; return arr[0] || null; } catch { return null; }
}
async function fetchProductProjects(env, productId) {
  const { results } = await env.DB.prepare(
    `SELECT p.slug, p.title, p.location, p.images FROM project_products pp
     JOIN projects p ON p.id = pp.project_id
     WHERE pp.product_id = ? AND p.deleted_at IS NULL AND p.hidden_at IS NULL
     ORDER BY p.id DESC`
  ).bind(productId).all();
  return results.map(row => ({ slug: row.slug, title: row.title, location: row.location, image: firstImage(row.images) }));
}

async function fetchAdjacentProduct(env, id) {
  const { prev, next } = await fetchAdjacentEntity(env, 'products', id, { titleCol: 'title', imageCol: 'images', imageIsJsonArray: true });
  return { prevItem: prev, nextItem: next };
}

// GET /api/product/:key — js/components/product-modal.js#fetchItem bu uca bağlanır (proje.html'in
// ProjectModal'ı proje-detay.html'i tamamen ikame ettiği desenin ürün karşılığı, bkz. plan dosyası).
// `key`, ya doğrudan canonical `slug` (statik kayıtlarda "<başlık-marka>-<id>", üye
// kökenli kayıtlarda "m-<eski submission id>") ya da urun.html/urun-detay.html#productKey'in ÜRETTİĞİ
// eski biçim (id'siz `slugify(title + '-' + brand)`, bkz. o dosyalardaki AYNI fonksiyon) olabilir —
// ikincisi için tabloyu tarayıp aynı fonksiyonla yeniden üretilen anahtarla karşılaştırma yapılır
// (tablo küçük olduğundan ucuz, bkz. src/routes/architect.js#findArchitect'teki AYNI fallback deseni).
// bkz. yukarıdaki dosya başı yorumu — GET /api/product/:key gibi TEK bir anahtarı çözen çağıranlar
// için kullanılır (bkz. aşağıdaki handleProductDetailRoute). Birden çok anahtarı aynı anda çözen
// çağıranlar (ratings.js#myRatings, saved.js#listSaved) bunun yerine aşağıdaki toplu karşılığı
// findProductsByKeys'i kullanır — AYNI iki-aşamalı eşleştirme mantığı, iki ayrı kopya değil.
// bkz. src/lib/canonicalSync.js#syncProduct dosya başı yorumu (2026-08-17, kullanıcı isteği: "Ürün
// sayfalarındaki ürünlerin URL'lerini ürün adları olarak düzgünce düzelt") — ürün/malzeme slug'ı
// artık başlık+marka'dan üretiliyor, önceki "m-<submissionId>" biçimi DEĞİL. Zaten paylaşılmış/
// indekslenmiş eski "/urun/m-<id>" bağlantılarının kırılmaması için (bkz. scripts/
// backfill-product-slugs.js'in canonical `products.slug`ı bu geçişte yeniden yazdığı satırlar)
// "m-<id>" biçimi hâlâ legacy_key='submission:<id>' üzerinden bir kerelik ayrıca denenir.
// "submission:<id>" biçimi de doğrudan denenir — src/routes/architect.js#findArchitect/office.js#
// findOffice'in name/slug/legacy_key alias'larıyla AYNI "submission:" işareti (bkz. hesabim.html#
// itemDetailUrl'in mimar/firma satırları için ürettiği AYNI biçim, ürün/malzeme artık aynısını kullanır).
function findProductByLegacyMarker(env, key) {
  const m = /^m-(.+)$/.exec(key);
  const legacyKey = m ? `submission:${m[1]}` : (key.startsWith('submission:') ? key : null);
  if (!legacyKey) return null;
  return env.DB.prepare(`SELECT * FROM products WHERE legacy_key = ? AND deleted_at IS NULL`).bind(legacyKey).first();
}

export async function findProductByKey(env, key) {
  let row = await env.DB.prepare(`SELECT * FROM products WHERE slug = ? AND deleted_at IS NULL`).bind(key).first();
  if (!row) row = await findProductByLegacyMarker(env, key);
  if (!row) {
    const { results } = await env.DB.prepare(`SELECT id, title, brand_name_raw FROM products WHERE deleted_at IS NULL`).all();
    const match = results.find(r => slugify(`${r.title}-${r.brand_name_raw || ''}`) === key);
    if (match) row = await env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(match.id).first();
  }
  return row || null;
}

// findProductByKey'in TOPLU karşılığı — src/routes/ratings.js#myRatings (Beğendiklerim kutusu) ve
// src/routes/saved.js#listSaved (Kaydettiklerim kutusu) her puanlanan/kaydedilen ürün için
// findProductByKey'i ayrı ayrı çağırıyordu; legacy_static ürünlerde canonical `slug` id sonekli
// olduğundan (yukarıdaki yorum) birincil `WHERE slug = ?` HER ZAMAN kaçırıyor ve N kez ayrı bir
// tam-tablo taraması + JS karşılaştırması tetikleniyordu (gerçek bulgu — kullanıcının puanladığı/
// kaydettiği her ürün için ayrı bir O(tablo) tarama, katalog büyüdükçe çarpımsal). Bu fonksiyon AYNI
// iki-aşamalı eşleştirmeyi (önce doğrudan slug, sonra eski id'siz `slugify(title-brand)` anahtarı)
// TEK bir sorgu + tek bir JS taramasıyla, istenen TÜM anahtarlar için bir kerede çözer.
// findProductByKey'in kendisi (tek seferlik çağrılarda, ör. handleProductDetailRoute) DEĞİŞTİRİLMEDİ.
export async function findProductsByKeys(env, keys) {
  const map = new Map();
  const wanted = new Set(keys.filter(Boolean));
  if (!wanted.size) return map;

  // gerçek bulgu (production audit, 2026-08-17): bu fonksiyon eşleştirme anahtarını hesaplamak için
  // TÜM ürün/malzeme satırlarını (images/specs/description dahil) `SELECT *` ile çekiyordu — istenen
  // anahtar sayısı (genelde birkaç Beğenilen/Kaydedilen ürün) kaç olursa olsun, HER çağrıda
  // katalogdaki her satırın tüm sütunları D1'den taşınıyordu. findProductByKey'deki AYNI iki-aşamalı
  // desen (önce dar sütunlarla tara, sonra yalnızca eşleşen id'ler için tam satırı çek) burada da
  // uygulanır: eşleştirme mantığı/önceliği (slug > submission marker > eski title-brand) ve dönen
  // sonuç birebir AYNI kalır, yalnızca eşleşmeyen satırların ağır sütunları artık hiç okunmaz.
  const { results } = await env.DB.prepare(`SELECT id, slug, title, brand_name_raw, legacy_key FROM products WHERE deleted_at IS NULL`).all();
  const bySlug = new Map();
  const byLegacyKey = new Map();
  const bySubmissionMarker = new Map();
  for (const row of results) {
    bySlug.set(row.slug, row.id);
    byLegacyKey.set(slugify(`${row.title}-${row.brand_name_raw || ''}`), row.id);
    // bkz. yukarıdaki findProductByLegacyMarker'daki AYNI gerekçe — eski "m-<id>" anahtarları
    // (ör. ratingKeyFor'un submission-kökenli satırlar için ürettiği target_id) artık slug'la
    // eşleşmiyor, legacy_key'den yeniden üretilip ayrıca aranmalı.
    if (typeof row.legacy_key === 'string' && row.legacy_key.startsWith('submission:')) {
      bySubmissionMarker.set(`m-${row.legacy_key.slice('submission:'.length)}`, row.id);
    }
  }

  const idByKey = new Map();
  for (const key of wanted) {
    const id = bySlug.get(key) ?? bySubmissionMarker.get(key) ?? byLegacyKey.get(key);
    if (id != null) idByKey.set(key, id);
  }
  if (!idByKey.size) { for (const key of wanted) map.set(key, null); return map; }

  const uniqueIds = [...new Set(idByKey.values())];
  const { results: fullRows } = await env.DB.prepare(
    `SELECT * FROM products WHERE id IN (${uniqueIds.map(() => '?').join(',')})`
  ).bind(...uniqueIds).all();
  const rowById = new Map(fullRows.map(r => [r.id, r]));

  for (const key of wanted) map.set(key, rowById.get(idByKey.get(key)) || null);
  return map;
}

export async function handleProductDetailRoute(request, env, url, rawKey) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  const key = decodeURIComponent(rawKey || '');
  if (!key) return errorJson('Geçersiz istek.');

  return cachedPublicJson(request, env, url.pathname, async () => {
    const row = await findProductByKey(env, key);
    if (!row) return { item: null, hidden: false };
    // gerçek bulgu (denetim raporu): findProductByKey yalnızca deleted_at IS NULL filtreliyor,
    // hidden_at'a hiç bakmıyor — bu uç gizlenmiş bir ürünün TAM verisini `hidden:true` bayrağıyla
    // birlikte ama item NULL'lanmadan döndürüyordu. Client-side (product-modal.js) bayrağı kontrol
    // edip "bulunamadı" gösteriyor, ama /api/product/:key'i doğrudan çağıran biri tam veriyi
    // alabiliyordu — src/routes/project.js#handleProjectDetailRoute'un AYNI durumda zaten yaptığı
    // gibi item burada da null'lanır.
    if (row.hidden_at) return { item: null, hidden: true };
    const item = shapeProductItem(row);
    // ratingKey: puanlama/kaydetme (ratings.target_id / saved_items.item_key) hâlâ BURADAKİ
    // ratingKeyFor ile üretilen eski anahtarı kullanıyor (bkz. dosya başı yorumu — slug'dan BİLEREK
    // ayrık). GERÇEK BULGU (2026-08-17, kullanıcı isteği: ürün URL'lerinin isme dönmesi): item.slug
    // artık ratingKey'den FARKLI olabildiğinden, js/components/product-modal.js buraya kadar
    // istemeden URL slug'ını rating/kaydetme hedef anahtarı olarak (dataset.key üzerinden) kullanıyordu
    // — yeni bir puanlama/kaydetme SessizCE yanlış bir target_id'ye yazılıp mevcut ortalamadan/sayaçtan
    // kopardı. Doğru anahtar burada AYRICA döndürülüp istemci tarafında slug yerine bu kullanılmalı.
    item.ratingKey = ratingKeyFor(item.title, item.brand, item.submissionId);
    const [adjacent, owner, usedInProjects] = await Promise.all([
      fetchAdjacentProduct(env, row.id),
      fetchOwnerByline(env, row.claimed_by_user_id),
      fetchProductProjects(env, row.id),
    ]);
    item.prevItem = adjacent.prevItem;
    item.nextItem = adjacent.nextItem;
    item.projects = usedInProjects;
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
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorJson('Bulunamadı', 404);

  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
    const limit = Math.min(96, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 24));
    const sort = url.searchParams.get('sort') || '';
    const groupParam = url.searchParams.get('group') || '';
    const categoryParam = url.searchParams.get('category') || '';
    const brandParam = url.searchParams.get('brand') || '';
    const ratingParam = url.searchParams.get('rating') || '';
    const yearParam = url.searchParams.get('year') || '';
    const designerParam = url.searchParams.get('designer') || '';
    const searchQuery = foldTr((url.searchParams.get('search') || '').trim());

    // ORDER BY id DESC — src/routes/project.js#handleProjectsRoute'daki AYNI varsayılan sıralama
    // (sort seçilmemişse "son eklenen ilk") — anasayfa Ürün carousel'i (bkz. index.html) bu
    // varsayılana güvenerek ?limit=6 ile doğrudan son eklenen 6 ürünü çeker.
    // Faz 4A — Projection Optimization: kart listesi title/brand/category/kind/ilk görsel/
    // submissionId'yi render eder (bkz. aşağıdaki pool.map) — description/specs/website gibi
    // yalnızca tekil ürün sayfasında (handleProductDetailRoute, ayrı bir sorgu) gereken ağır metin
    // kolonları bu listeye dahil edilmiyor.
    // gerçek bulgu: bkz. src/routes/architect.js#handleArchitectListRoute'daki AYNI gerekçe/desen —
    // sidebar sayaçları (group/category/brand/rating) TÜM havuzdan hesaplandığından D1 LIMIT/OFFSET
    // burada işe yaramaz, bunun yerine ham sorgu+şekillendirme sonucu KV'de önbelleklenir (bkz.
    // publicCache.js#getCachedPool). NOT — pool'a gömülen `rating` alanı (ratings tablosundan) yalnızca
    // dahili filtre/sıralama için kullanılır, ASLA `items` çıktısına yansımaz (bkz. aşağıdaki
    // `.map(({ group, rating, ...rest }) => rest)`) — bu yüzden yeni bir puanlama, ürün/mimar/firma
    // içerik yazmalarıyla AYNI invalidatePublicCache() tetiklenmediğinden ("Puan" filtre sayacı VE
    // rating_desc/rating_asc sıralaması için) en fazla POOL_CACHE_TTL_SECONDS (5dk) kadar bayat
    // kalabilir — facet_counts.js'in kendi KV_TTL_SECONDS'ı ile AYNI kabul edilebilir pencere.
    const pool = await getCachedPool(env, 'products', async () => {
      const [productsRes, ratingRows] = await Promise.all([
        env.DB.prepare(`SELECT slug, title, brand_name_raw, category, kind, images, legacy_key, designer, year FROM products WHERE deleted_at IS NULL AND hidden_at IS NULL ORDER BY id DESC`).all(),
        env.DB.prepare(`SELECT target_type, target_id, AVG(stars) AS average, COUNT(*) AS count FROM ratings WHERE target_type IN ('product','material') GROUP BY target_type, target_id`).all(),
      ]);
      const ratingByKey = new Map(ratingRows.results.map(r => [`${r.target_type}:${r.target_id}`, { average: r.average, count: r.count }]));

      return productsRes.results.map(row => {
        const p = shapeProductItem(row);
        const isSubmissionMarker = typeof row.legacy_key === 'string' && row.legacy_key.startsWith('submission:');
        const submissionId = isSubmissionMarker ? row.legacy_key.slice('submission:'.length) : null;
        const ratingKey = ratingKeyFor(p.title, p.brand, submissionId);
        const group = taxonomyGroupOf(CATALOG_TAXONOMY, p.category);
        const ratingKind = p.kind === 'material' ? 'material' : 'product';
        const rating = ratingByKey.get(`${ratingKind}:${ratingKey}`) || { average: 0, count: 0 };
        const designers = (p.designer || '').split(',').map(s => s.trim()).filter(Boolean);
        return {
          slug: row.slug, title: p.title, brand: p.brand, category: p.category, kind: p.kind,
          image: (p.images && p.images[0]) || null, group, ratingKey, submissionId, rating,
          year: p.year || null, designers,
        };
      });
    });

    // urun.html#passesFilters ile BİREBİR aynı — exceptKey ile o grubun kendi seçimi hariç tutularak
    // faceted (diğer aktif filtrelerle bağımlı) sayaç üretir (bkz. proje.html#passesFilters'daki AYNI desen).
    function passes(p, exceptKey) {
      if (groupParam && exceptKey !== 'group' && p.group !== groupParam) return false;
      if (categoryParam && exceptKey !== 'category' && p.category !== categoryParam) return false;
      if (brandParam && exceptKey !== 'brand' && p.brand !== brandParam) return false;
      if (ratingParam && exceptKey !== 'rating' && !ratingBuckets(p.rating.average).includes(ratingParam)) return false;
      if (yearParam && exceptKey !== 'year' && p.year !== yearParam) return false;
      if (designerParam && exceptKey !== 'designer' && !p.designers.includes(designerParam)) return false;
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
    // orderIndex (opsiyonel) verilirse sayaç yerine o sıraya göre sıralanır — bkz. yukarıdaki
    // CATALOG_GROUP_ORDER/CATALOG_CATEGORY_ORDER yorumu (Grup/Kategori mega menü sırasını izler).
    function countsFor(key, fieldFn, orderIndex) {
      const passing = pool.filter(p => passes(p, key));
      const counts = {};
      passing.forEach(p => { (fieldFn(p) || []).forEach(v => { if (v) counts[v] = (counts[v] || 0) + 1; }); });
      const keys = Object.keys(counts);
      if (key === 'year') {
        keys.sort((a, b) => (parseInt(b, 10) || 0) - (parseInt(a, 10) || 0));
      } else if (orderIndex) {
        keys.sort((a, b) => {
          const ia = orderIndex.has(a) ? orderIndex.get(a) : Infinity;
          const ib = orderIndex.has(b) ? orderIndex.get(b) : Infinity;
          return ia !== ib ? ia - ib : a.localeCompare(b, 'tr');
        });
      } else {
        keys.sort((a, b) => counts[b] - counts[a] || a.localeCompare(b, 'tr'));
      }
      return keys.map(v => ({ value: v, count: counts[v] }));
    }

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (Math.min(page, totalPages) - 1) * limit;
    const items = filtered.slice(start, start + limit).map(({ group, rating, designers, ...rest }) => rest);

    return {
      items: serializePublicEntity(items), total, page: Math.min(page, totalPages), totalPages,
      filters: {
        group: countsFor('group', p => [p.group], CATALOG_GROUP_ORDER),
        category: countsFor('category', p => [p.category], CATALOG_CATEGORY_ORDER),
        brand: countsFor('brand', p => [p.brand]),
        rating: countsFor('rating', p => ratingBuckets(p.rating.average)),
        year: countsFor('year', p => [p.year]),
        designer: countsFor('designer', p => p.designers),
      },
    };
  }, () => productListFingerprint(env));
}

// Faz 4B — Conditional Requests: bkz. src/routes/architect.js#architectListFingerprint'teki AYNI
// desen.
function productListFingerprint(env) {
  return getCachedFingerprint(env, 'products', () => env.DB.prepare(
    `SELECT COUNT(*) AS cnt, MAX(updated_at) AS latest FROM products WHERE deleted_at IS NULL AND hidden_at IS NULL`
  ).first().then(row => `${row?.cnt ?? 0}:${row?.latest ?? ''}`));
}
