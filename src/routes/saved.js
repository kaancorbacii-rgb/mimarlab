import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { findCanonicalRowByNaturalKey } from '../lib/canonicalSync.js';
import { findProductsByKeys } from './product.js';
import { checkRateLimit } from '../lib/rateLimit.js';

export const ITEM_TYPES = new Set(['project', 'product', 'material', 'news', 'job', 'architect', 'office']);

// saved_items görsel/başlık alanlarını kaydedildiği andaki haliyle tutar (bkz. createSaved) — hedef
// sonradan gizlenir/silinirse bu satır D1'de bozulmadan kalır ve "Kaydettiklerim" bunu göstermeye
// devam ederdi. src/routes/ratings.js#myRatings'teki AYNI canonical-satır kontrolüyle (bkz. o
// dosyadaki gerekçe) hedefi olmayan/gizli/silinmiş kayıtları burada da sessizce atlıyoruz — news/job
// için hide sistemi olmadığından (bkz. ratings.js'in de bu ikisini kapsamaması) kontrol dışı bırakıldı.
const CANONICAL_TYPE_BY_ITEM = { project: 'projects', architect: 'architects', office: 'offices' };

// live + (yalnızca item_type='project' için) GÜNCEL build_status — saved_items'ın kaydedildiği
// andaki item_href'ine GÜVENEMEZ (bu sütun eski kayıtlarda /yapi/ önekiyle yazılmış olabilir) —
// bunun yerine her satır için zaten TEK sorguda okunan canonical satırdan
// (findCanonicalRowByNaturalKey#SELECT *) build_status'u da aynı round-trip'te alırız, ayrı bir
// sorguya gerek kalmaz. product/material için satır artık listSaved'de TOPLU olarak önceden
// çözülüp buraya doğrudan verilir (bkz. aşağıdaki gerçek bulgu yorumu) — burada AYRICA sorgulanmaz.
function shapeSavedTargetInfo(itemType, row) {
  if (itemType === 'product' || itemType === 'material') {
    return { live: !!row && !row.deleted_at && !row.hidden_at, buildStatus: null };
  }
  return {
    live: !!row && !row.deleted_at && !row.hidden_at,
    buildStatus: (itemType === 'project' && row) ? row.build_status : null,
  };
}

export async function handleSavedRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "saved", ...]

  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  if (segments.length === 2 && request.method === 'GET') return listSaved(env, user);
  if (segments.length === 2 && request.method === 'POST') return createSaved(request, env, user);
  if (segments.length === 4 && request.method === 'DELETE') return deleteSaved(env, user, segments[2], segments[3]);
  return errorJson('Bulunamadı', 404);
}

// admin.js#listUserSavedAdmin de bunu (env, {id: targetUserId}) ile çağırır — bkz. kullanıcı
// isteği: admin Üyeler listesinden bir üyenin Kaydettiklerim'ini görebilsin.
export async function listSaved(env, user) {
  const { results } = await env.DB.prepare(
    'SELECT item_type, item_key, item_title, item_meta, item_image, item_href, created_at FROM saved_items WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all();

  // gerçek bulgu: her kaydedilen ürün/malzeme için ayrı ayrı findProductByKey çağrılıyordu —
  // src/routes/ratings.js#myRatings'te düzeltilen AYNI hata (legacy_static ürünlerde canonical slug
  // id sonekli olduğundan birincil eşleşme hep kaçırıyor, N kez ayrı bir tam-tablo taraması
  // tetikleniyordu). product.js#findProductsByKeys ile AYNI toplu çözüm burada da uygulanır.
  const productKeys = results
    .filter(r => r.item_type === 'product' || r.item_type === 'material')
    .map(r => r.item_key);
  const productRows = await findProductsByKeys(env, productKeys);

  const info = await Promise.all(results.map(r => {
    if (r.item_type === 'product' || r.item_type === 'material') {
      return shapeSavedTargetInfo(r.item_type, productRows.get(r.item_key) || null);
    }
    const canonicalType = CANONICAL_TYPE_BY_ITEM[r.item_type];
    if (!canonicalType) return { live: true, buildStatus: null }; // news/job — hide sistemi yok
    return findCanonicalRowByNaturalKey(env, canonicalType, r.item_key).then(row => shapeSavedTargetInfo(r.item_type, row));
  }));
  const items = results
    .map((r, i) => (info[i].buildStatus ? { ...r, item_build_status: info[i].buildStatus } : r))
    .filter((_, i) => info[i].live);
  return json({ items });
}

async function createSaved(request, env, user) {
  // gerçek bulgu: bu uçta hiç hız sınırı yoktu — aynı hedef için mükerrer satır oluşmasa da (bkz.
  // aşağıdaki 'existing' kontrolü) tek bir hesap FARKLI onlarca hedefi saniyeler içinde kaydedip
  // saved_items'ı şişirebilirdi. İşlem ucuz/sık kullanılan bir eylem olduğundan (bir oturumda birçok
  // proje/ürün kaydetmek meşru bir kullanım) diğer uçlara göre daha cömert bir üst sınır.
  if (!(await checkRateLimit(env, 'saved-item', user.id, 100, 60 * 60 * 1000))) {
    return errorJson('Çok fazla kaydetme işlemi yaptın. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }

  const body = await readJson(request);
  const itemType = body.type;
  const itemKey = (body.key || '').trim();
  if (!ITEM_TYPES.has(itemType) || !itemKey) return errorJson('Geçersiz istek.');

  const existing = await env.DB.prepare(
    'SELECT id FROM saved_items WHERE user_id = ? AND item_type = ? AND item_key = ?'
  ).bind(user.id, itemType, itemKey).first();
  if (existing) return json({ ok: true, alreadySaved: true });

  const id = newId();
  await env.DB.prepare(
    `INSERT INTO saved_items (id, user_id, item_type, item_key, item_title, item_meta, item_image, item_href, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, user.id, itemType, itemKey,
    (body.title || '').slice(0, 300) || null,
    (body.meta || '').slice(0, 300) || null,
    (body.image || '').slice(0, 500) || null,
    (body.href || '').slice(0, 500) || null,
    Date.now()
  ).run();

  return json({ ok: true }, 201);
}

async function deleteSaved(env, user, itemType, itemKey) {
  if (!ITEM_TYPES.has(itemType)) return errorJson('Geçersiz istek.');
  await env.DB.prepare(
    'DELETE FROM saved_items WHERE user_id = ? AND item_type = ? AND item_key = ?'
  ).bind(user.id, itemType, decodeURIComponent(itemKey)).run();
  return json({ ok: true });
}
