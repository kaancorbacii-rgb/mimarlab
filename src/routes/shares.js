import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { findCanonicalRowByNaturalKey } from '../lib/canonicalSync.js';
import { findProductsByKeys } from './product.js';
import { checkRateLimit } from '../lib/rateLimit.js';

// Paylaştıklarım (kullanıcı isteği, 2026-08-31): Aktivitelerim'in 2. satır 2. sütunundaki kutu —
// "kullanıcıların paylaş butonuna tıklayarak başkalarına ilettikleri gönderiler". src/routes/saved.js
// ile BİREBİR aynı iskelet (aynı ITEM_TYPES evreni, aynı anlık-görüntü alanları, aynı "hedefi artık
// yayında olmayan satırı sessizce atla" kuralı) — farklar migrations/0074_shared_items.sql'in başında.
export const SHARE_ITEM_TYPES = new Set(['project', 'product', 'material', 'news', 'job', 'architect', 'office']);
// share-button.js'in gönderdiği kanallar; whitelist dışı bir değer sessizce null'a düşürülür (ham
// kullanıcı/istemci girdisi Aktivitelerim satırının alt metnine basıldığından serbest metin olamaz).
const SHARE_CHANNELS = new Set(['copy', 'whatsapp', 'x', 'linkedin', 'native']);

const CANONICAL_TYPE_BY_ITEM = { project: 'projects', architect: 'architects', office: 'offices' };

export async function handleSharesRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "shares", ...]

  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  if (segments.length === 2 && request.method === 'GET') return listShares(env, user);
  if (segments.length === 2 && request.method === 'POST') return createShare(request, env, user);
  if (segments.length === 3 && request.method === 'DELETE') return deleteShare(env, user, segments[2]);
  return errorJson('Bulunamadı', 404);
}

export async function listShares(env, user) {
  // Aynı hedef birden çok kez paylaşılmış olabilir (bkz. migration yorumu) — Aktivitelerim'de aynı
  // proje alt alta beş kez görünmesin diye hedef başına EN SON paylaşım satırı gösterilir. GROUP BY +
  // MAX(created_at): SQLite'ta bare sütunlar aynı satırdan gelir (bare columns in an aggregate query),
  // yani başlık/görsel/kanal da o en son paylaşımın kendi değerleridir.
  const { results } = await env.DB.prepare(
    `SELECT id, item_type, item_key, item_title, item_meta, item_image, item_href, channel, MAX(created_at) AS created_at
       FROM shared_items
      WHERE user_id = ?
      GROUP BY item_type, item_key
      ORDER BY created_at DESC`
  ).bind(user.id).all();

  // saved.js#listSaved ile AYNI toplu çözümleme (N ayrı tam-tablo taraması yerine tek sorgu).
  const productKeys = results
    .filter(r => r.item_type === 'product' || r.item_type === 'material')
    .map(r => r.item_key);
  const productRows = await findProductsByKeys(env, productKeys);

  const rows = await Promise.all(results.map(r => {
    if (r.item_type === 'product' || r.item_type === 'material') {
      return Promise.resolve(productRows.get(r.item_key) || null);
    }
    const canonicalType = CANONICAL_TYPE_BY_ITEM[r.item_type];
    if (!canonicalType) return Promise.resolve(undefined); // news/job — hide sistemi yok, filtrelenmez
    return findCanonicalRowByNaturalKey(env, canonicalType, r.item_key);
  }));

  const items = results.filter((_, i) => {
    const row = rows[i];
    if (row === undefined) return true;
    return !!row && !row.deleted_at && !row.hidden_at;
  });
  return json({ items });
}

async function createShare(request, env, user) {
  // saved.js#createSaved ile AYNI gerekçe/cömertlik: paylaşmak ucuz ve meşru şekilde sık yapılan bir
  // eylem, ama sınırsız bırakılırsa tek bir hesap tabloyu şişirebilir.
  if (!(await checkRateLimit(env, 'share-item', user.id, 100, 60 * 60 * 1000))) {
    return errorJson('Çok fazla paylaşım işlemi yaptın. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }

  const body = await readJson(request);
  const itemType = body.type;
  const itemKey = (body.key || '').trim();
  if (!SHARE_ITEM_TYPES.has(itemType) || !itemKey) return errorJson('Geçersiz istek.');

  await env.DB.prepare(
    `INSERT INTO shared_items (id, user_id, item_type, item_key, item_title, item_meta, item_image, item_href, channel, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    newId(), user.id, itemType, itemKey,
    (body.title || '').slice(0, 300) || null,
    (body.meta || '').slice(0, 300) || null,
    (body.image || '').slice(0, 500) || null,
    (body.href || '').slice(0, 500) || null,
    SHARE_CHANNELS.has(body.channel) ? body.channel : null,
    Date.now()
  ).run();

  return json({ ok: true }, 201);
}

// Aktivitelerim satırındaki ✕ — listShares hedef başına TEK satır döndürdüğünden (bkz. GROUP BY),
// kullanıcının gördüğü satırı kaldırmak o hedefe ait TÜM paylaşım kayıtlarını silmek demektir;
// aksi halde bir önceki paylaşım hemen listeye geri gelirdi.
async function deleteShare(env, user, id) {
  const row = await env.DB.prepare(
    'SELECT item_type, item_key FROM shared_items WHERE id = ? AND user_id = ?'
  ).bind(decodeURIComponent(id), user.id).first();
  if (!row) return json({ ok: true });
  await env.DB.prepare(
    'DELETE FROM shared_items WHERE user_id = ? AND item_type = ? AND item_key = ?'
  ).bind(user.id, row.item_type, row.item_key).run();
  return json({ ok: true });
}
