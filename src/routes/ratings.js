import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { findCanonicalRowByNaturalKey } from '../lib/canonicalSync.js';
import { parseCanonicalRow } from '../lib/canonicalRead.js';
import { findProductsByKeys } from './product.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { invalidatePublicCache } from '../lib/publicCache.js';

const TARGET_TYPES = new Set(['project', 'product', 'material', 'architect', 'office']);

export async function handleRatingsRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "ratings", "bulk"?/"mine"?]

  if (segments.length === 3 && segments[2] === 'bulk' && request.method === 'GET') {
    return bulkRatings(env, url);
  }
  if (segments.length === 3 && segments[2] === 'mine' && request.method === 'GET') {
    return myRatings(request, env);
  }
  if (segments.length === 2 && request.method === 'GET') return getRating(request, env, url);
  if (segments.length === 2 && request.method === 'POST') return upsertRating(request, env);
  return errorJson('Bulunamadı', 404);
}

async function summarize(env, targetType, targetId) {
  const row = await env.DB.prepare(
    'SELECT AVG(stars) AS average, COUNT(*) AS count FROM ratings WHERE target_type = ? AND target_id = ?'
  ).bind(targetType, targetId).first();
  return { average: row && row.count ? row.average : 0, count: row ? row.count : 0 };
}

async function getRating(request, env, url) {
  const targetType = url.searchParams.get('targetType');
  const targetId = url.searchParams.get('targetId');
  if (!TARGET_TYPES.has(targetType) || !targetId) return errorJson('Geçersiz istek.');

  const { average, count } = await summarize(env, targetType, targetId);

  let mine = null;
  const user = await getSessionUser(request, env);
  if (user) {
    const row = await env.DB.prepare(
      'SELECT stars FROM ratings WHERE target_type = ? AND target_id = ? AND user_id = ?'
    ).bind(targetType, targetId, user.id).first();
    mine = row ? row.stars : null;
  }

  return json({ average, count, mine });
}

async function upsertRating(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Puan vermek için giriş yapmalısın.', 401);

  // gerçek bulgu: bu uçta hiç hız sınırı yoktu. saved.js#createSaved ile AYNI gerekçe/oran —
  // bir oturumda birçok proje/ürünü puanlamak meşru bir kullanım olduğundan cömert bir üst sınır.
  if (!(await checkRateLimit(env, 'rating', user.id, 100, 60 * 60 * 1000))) {
    return errorJson('Çok fazla puanlama işlemi yaptın. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }

  const body = await readJson(request);
  const targetType = body.targetType;
  const targetId = (body.targetId || '').trim();
  const stars = parseInt(body.stars, 10);

  if (!TARGET_TYPES.has(targetType) || !targetId) return errorJson('Geçersiz istek.');
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return errorJson('Puan 1 ile 5 arasında olmalı.');

  const existing = await env.DB.prepare(
    'SELECT id FROM ratings WHERE user_id = ? AND target_type = ? AND target_id = ?'
  ).bind(user.id, targetType, targetId).first();

  const now = Date.now();
  if (existing) {
    await env.DB.prepare('UPDATE ratings SET stars = ?, updated_at = ? WHERE id = ?')
      .bind(stars, now, existing.id).run();
  } else {
    await env.DB.prepare(
      'INSERT INTO ratings (id, target_type, target_id, user_id, stars, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(newId(), targetType, targetId, user.id, stars, now, now).run();
  }

  const { average, count } = await summarize(env, targetType, targetId);
  // gerçek bulgu (denetim raporu): puanlama yazımı invalidatePublicCache() hiç tetiklemiyordu —
  // proje/mimar/firma/ürün liste uçlarının "Puan" facet/sıralaması listFingerprint'in izlemediği
  // (yalnızca ana tablonun updated_at'ini izler, bkz. cachedPublicJson yorumu) bu değişikliği hiç
  // görmüyor, en kötü durumda POOL_CACHE_TTL_SECONDS/s-maxage (5dk) kadar bayat kalabiliyordu. Diğer
  // tüm admin/onay/gizleme yazma yollarıyla AYNI global temizlik burada da uygulanır.
  await invalidatePublicCache(env);
  return json({ average, count, mine: stars });
}

// bkz. src/lib/canonicalSync.js#canonicalKeyFor — target_id ratings tablosunda HER ZAMAN doğal
// anahtar (mimar/firma için bare isim, proje için slug) olarak saklanır, bkz. rating-widget.js#
// dataset.key/js/components/project-modal.js#renderItem. product/material İSTİSNA: target_id
// src/routes/product.js#ratingKeyFor'un ürettiği ayrı bir anahtar (m-<id> ya da eski
// slugify(title-brand) biçimi) — bu yüzden onlar findProductsByKeys ile (findCanonicalRowByNaturalKey
// DEĞİL) ayrıca çözülür, bkz. aşağıdaki myRatings.
const CANONICAL_TYPE_BY_TARGET = { project: 'projects', architect: 'architects', office: 'offices' };
const HREF_BASE_BY_TARGET = { project: '/proje/', product: '/urun/', material: '/urun/', architect: '/mimar/', office: '/firma/' };

function ratingCardShape(targetType, row) {
  if (targetType === 'project') {
    const p = parseCanonicalRow('projects', row);
    return { title: p.title, meta: [p.location, p.project_date].filter(Boolean).join(' · '), image: (p.images && p.images[0]) || null };
  }
  if (targetType === 'architect') {
    return { title: row.name, meta: [row.school, row.dept].filter(Boolean).join(' · '), image: row.photo_url || null };
  }
  if (targetType === 'office') {
    return { title: row.name, meta: row.loc || '', image: row.logo_url || null };
  }
  // product/material
  const p = parseCanonicalRow('products', row);
  return { title: p.title, meta: [p.brand_name_raw, p.category].filter(Boolean).join(' · '), image: (p.images && p.images[0]) || null };
}

// GET /api/ratings/mine — hesabim.html'in "Beğendiklerim" kutusu için, giriş yapmış kullanıcının
// puanladığı TÜM kayıtları (bkz. kullanıcı isteği: "Kullanıcının beğendiği/puanladığı gönderiler
// burada listelensin") başlık/görsel/bağlantıyla zenginleştirip döner — saved_items'ın aksine
// ratings tablosu bu görüntüleme alanlarını kaydetmediğinden (yalnızca stars + doğal anahtar),
// canonical satır bulunup findCanonicalRowByNaturalKey ile eşleştirilir; sonradan silinmiş/gizlenmiş
// bir hedefse (canonical satır artık yok ya da hidden_at/deleted_at doluysa) sessizce atlanır.
async function myRatings(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  const { results } = await env.DB.prepare(
    'SELECT target_type, target_id, stars, updated_at FROM ratings WHERE user_id = ? ORDER BY updated_at DESC'
  ).bind(user.id).all();

  // gerçek bulgu: burada eskiden her puanlanan ürün için ayrı ayrı findProductByKey çağrılıyordu —
  // legacy_static ürünlerde bu HER SEFERİNDE bir tam-tablo taraması tetikliyordu (bkz. product.js#
  // findProductsByKeys yorumu). Tek bir toplu sorguyla N ayrı tarama 1'e indirilir.
  const productKeys = results
    .filter(r => r.target_type === 'product' || r.target_type === 'material')
    .map(r => r.target_id);
  const productRows = await findProductsByKeys(env, productKeys);

  const items = [];
  for (const r of results) {
    const row = (r.target_type === 'product' || r.target_type === 'material')
      ? (productRows.get(r.target_id) || null)
      : (CANONICAL_TYPE_BY_TARGET[r.target_type] ? await findCanonicalRowByNaturalKey(env, CANONICAL_TYPE_BY_TARGET[r.target_type], r.target_id) : null);
    if (!row || row.deleted_at || row.hidden_at) continue;
    const shaped = ratingCardShape(r.target_type, row);
    const hrefBase = HREF_BASE_BY_TARGET[r.target_type];
    items.push({
      type: r.target_type, key: r.target_id, stars: r.stars, updatedAt: r.updated_at,
      href: hrefBase + encodeURIComponent(row.slug || r.target_id),
      buildStatus: r.target_type === 'project' ? row.build_status : null,
      ...shaped,
    });
  }
  return json({ items });
}

async function bulkRatings(env, url) {
  const targetType = url.searchParams.get('targetType');
  if (!TARGET_TYPES.has(targetType)) return errorJson('Geçersiz istek.');

  const { results } = await env.DB.prepare(
    'SELECT target_id, AVG(stars) AS average, COUNT(*) AS count FROM ratings WHERE target_type = ? GROUP BY target_id'
  ).bind(targetType).all();

  return json({ items: results });
}
