import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { findCanonicalRowByNaturalKey } from '../lib/canonicalSync.js';

export const ITEM_TYPES = new Set(['project', 'product', 'material', 'news', 'job', 'architect', 'office']);

// saved_items görsel/başlık alanlarını kaydedildiği andaki haliyle tutar (bkz. createSaved) — hedef
// sonradan gizlenir/silinirse bu satır D1'de bozulmadan kalır ve "Kaydettiklerim" bunu göstermeye
// devam ederdi. src/routes/ratings.js#myRatings'teki AYNI canonical-satır kontrolüyle (bkz. o
// dosyadaki gerekçe) hedefi olmayan/gizli/silinmiş kayıtları burada da sessizce atlıyoruz — news/job
// için hide sistemi olmadığından (bkz. ratings.js'in de bu ikisini kapsamaması) kontrol dışı bırakıldı.
const CANONICAL_TYPE_BY_ITEM = { project: 'projects', architect: 'architects', office: 'offices' };

// live + (yalnızca item_type='project' için) GÜNCEL build_status — hesabim.html'in "Kaydettiklerim"
// kutusundaki Yapı/Proje filtre butonları (bkz. kullanıcı isteği) saved_items'ın kaydedildiği andaki
// item_href'ine GÜVENEMEZ (bu sütun eski kayıtlarda hep /yapi/ önekiyle yazılmıştı, proje-modal.js#
// detailPrefix eklenmeden önce) — bunun yerine her satır için zaten TEK sorguda okunan canonical
// satırdan (findCanonicalRowByNaturalKey#SELECT *) build_status'u da aynı round-trip'te alırız,
// ayrı bir sorguya gerek kalmaz.
async function fetchSavedTargetInfo(env, itemType, itemKey) {
  // Ürün/malzeme sayfası artık yayında değil (bkz. kullanıcı isteği) — bu tiplerdeki eski
  // saved_items kayıtları her zaman "artık mevcut değil" olarak işaretlenir, gidilecek canlı bir
  // sayfa kalmadı.
  if (itemType === 'product' || itemType === 'material') {
    return { live: false, buildStatus: null };
  }
  const canonicalType = CANONICAL_TYPE_BY_ITEM[itemType];
  if (!canonicalType) return { live: true, buildStatus: null }; // news/job — hide sistemi yok
  const row = await findCanonicalRowByNaturalKey(env, canonicalType, itemKey);
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

async function listSaved(env, user) {
  const { results } = await env.DB.prepare(
    'SELECT item_type, item_key, item_title, item_meta, item_image, item_href, created_at FROM saved_items WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all();
  const info = await Promise.all(results.map(r => fetchSavedTargetInfo(env, r.item_type, r.item_key)));
  const items = results
    .map((r, i) => (info[i].buildStatus ? { ...r, item_build_status: info[i].buildStatus } : r))
    .filter((_, i) => info[i].live);
  return json({ items });
}

async function createSaved(request, env, user) {
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
