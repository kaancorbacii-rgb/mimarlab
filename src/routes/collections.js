import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { ITEM_TYPES } from './saved.js';

// KOLEKSİYONUM (kullanıcı isteği, 2026-08-31: "Kullanıcılar Pinterest'teki gibi Koleksiyon
// oluşturabilsin ... birden çok şey kaydederek ya da kendi bilgisayarından görsel, metin vs
// yükleyerek burada kendi çalışmasını oluşturabilecek") — bkz. migrations/0073_collections.sql.
//
// src/routes/saved.js ile AYNI iskelet (segment sayısına göre dallanan tek handler, her istekte
// getSessionUser, sahiplik kontrolü her sorgunun WHERE'inde) — ayrı bir yetkilendirme katmanı YOK,
// her sorgu user_id ile sınırlandığından başka bir kullanıcının koleksiyonuna erişilemez.
// Koleksiyonlar herkese açık DEĞİLDİR: bu dosyada oturumsuz okunabilen tek bir uç bile yok.

const ITEM_KINDS = new Set(['saved', 'image', 'note']);
// Kötüye kullanım/D1 satır şişmesi sınırları — src/lib/submissionTypes.js#findOversizedField'daki
// AYNI "sunucu tarafı da doğrulasın, sadece UI'a güvenme" ilkesi.
const MAX_COLLECTIONS_PER_USER = 100;
const MAX_ITEMS_PER_COLLECTION = 500;
const MAX_TITLE_LEN = 120;
const MAX_DESCRIPTION_LEN = 1000;
const MAX_NOTE_LEN = 4000;
const MAX_URLISH_LEN = 600;

function trimOrNull(value, maxLen) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

// Kullanıcı üretimi bağlantı/görsel yolları — save-widget.js'in saved_items'a yazdığı değerlerle
// AYNI biçimde SİTE İÇİ olmalı ("/media/...", "/proje/...", "logos-thumb/...", tam mimarlab.com
// URL'si). Dış kaynaklı mutlak URL'ler reddedilir: bu alanlar İçeriklerim/Koleksiyonum panosunda
// doğrudan <img src>/<a href> olarak render ediliyor, dışarıdan gelen bir değer izleme pikseli ya da
// kimlik avı bağlantısı olabilirdi.
function safeInternalPath(value) {
  const v = trimOrNull(value, MAX_URLISH_LEN);
  if (!v) return null;
  if (v.startsWith('/') && !v.startsWith('//')) return v;
  if (/^https?:\/\/(www\.)?mimarlab\.com\//i.test(v)) return v;
  // Şemasız/göreli ("logos-thumb/x.jpg", "miras/y.webp") — legacy_static kayıtların saved_items'ta
  // saklandığı biçim (bkz. js/components/auth-modal.js#safeUrl'deki AYNI gerçek bulgu).
  if (/^[\w][\w\-./]*$/.test(v) && !v.includes('..')) return v;
  return null;
}

export async function handleCollectionsRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "collections", ...]

  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  if (segments.length === 2 && request.method === 'GET') return listCollections(env, user);
  if (segments.length === 2 && request.method === 'POST') return createCollection(request, env, user);
  if (segments.length === 3 && request.method === 'GET') return getCollection(env, user, segments[2]);
  if (segments.length === 3 && request.method === 'PATCH') return updateCollection(request, env, user, segments[2]);
  if (segments.length === 3 && request.method === 'DELETE') return deleteCollection(env, user, segments[2]);
  if (segments.length === 4 && segments[3] === 'items' && request.method === 'POST') return addItem(request, env, user, segments[2]);
  if (segments.length === 5 && segments[3] === 'items' && request.method === 'DELETE') return deleteItem(env, user, segments[2], segments[4]);
  return errorJson('Bulunamadı', 404);
}

// Koleksiyonun kullanıcıya ait olduğunu doğrular — TÜM alt işlemlerin (öğe ekleme/silme, düzenleme)
// tek giriş kapısı; başka bir kullanıcının id'si verilirse null döner ve çağıran 404 üretir
// (403 DEĞİL: var olup olmadığı bilgisini de sızdırmamak için).
function findOwnCollection(env, user, id) {
  return env.DB.prepare(`SELECT * FROM collections WHERE id = ? AND user_id = ?`).bind(id, user.id).first();
}

function shapeCollection(row, itemCount, previewImages) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    coverImage: row.cover_image || previewImages[0] || null,
    itemCount,
    previewImages,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function shapeItem(row) {
  return {
    id: row.id, kind: row.kind, itemType: row.item_type, itemKey: row.item_key,
    title: row.title || '', meta: row.meta || '', image: row.image || null,
    href: row.href || null, note: row.note || '', created_at: row.created_at,
  };
}

async function listCollections(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM collections WHERE user_id = ? ORDER BY created_at DESC`
  ).bind(user.id).all();
  if (!results.length) return json({ items: [] });

  // Kapak önizlemeleri — koleksiyon başına ayrı bir sorgu (N+1) yerine TEK sorguda tüm öğeler
  // çekilip JS'te gruplanır (bkz. src/routes/office.js#fetchFoundersForOffices'teki AYNI N+1
  // düzeltmesi). Yalnızca görselli satırlar ve id/collection_id/image sütunları okunur.
  const ids = results.map(r => r.id);
  const { results: itemRows } = await env.DB.prepare(
    `SELECT collection_id, image FROM collection_items
     WHERE collection_id IN (${ids.map(() => '?').join(',')})
     ORDER BY position, created_at`
  ).bind(...ids).all();

  const countByCollection = new Map();
  const previewByCollection = new Map();
  for (const row of itemRows) {
    countByCollection.set(row.collection_id, (countByCollection.get(row.collection_id) || 0) + 1);
    if (!row.image) continue;
    const preview = previewByCollection.get(row.collection_id) || [];
    if (preview.length < 4) { preview.push(row.image); previewByCollection.set(row.collection_id, preview); }
  }

  return json({
    items: results.map(r => shapeCollection(r, countByCollection.get(r.id) || 0, previewByCollection.get(r.id) || [])),
  });
}

async function getCollection(env, user, id) {
  const row = await findOwnCollection(env, user, id);
  if (!row) return errorJson('Bulunamadı', 404);
  const { results } = await env.DB.prepare(
    `SELECT * FROM collection_items WHERE collection_id = ? ORDER BY position, created_at`
  ).bind(id).all();
  const previewImages = results.filter(r => r.image).slice(0, 4).map(r => r.image);
  return json({ item: shapeCollection(row, results.length, previewImages), items: results.map(shapeItem) });
}

async function createCollection(request, env, user) {
  // saved.js#createSaved / upload.js ile AYNI hız sınırı deseni — otomatik/kötüye kullanım kaynaklı
  // koleksiyon patlamalarına karşı ikinci savunma katmanı (MAX_COLLECTIONS_PER_USER birincisi).
  if (!(await checkRateLimit(env, 'collection-create', user.id, 30, 10 * 60 * 1000))) {
    return errorJson('Çok fazla koleksiyon oluşturdun, birkaç dakika sonra tekrar dene.', 429, { 'Retry-After': '600' });
  }
  const body = await readJson(request);
  const title = trimOrNull(body.title, MAX_TITLE_LEN);
  if (!title) return errorJson('Koleksiyon adı zorunlu.');

  const existing = await env.DB.prepare(`SELECT COUNT(*) AS c FROM collections WHERE user_id = ?`).bind(user.id).first();
  if ((existing?.c || 0) >= MAX_COLLECTIONS_PER_USER) {
    return errorJson(`En fazla ${MAX_COLLECTIONS_PER_USER} koleksiyon oluşturabilirsin.`);
  }

  const id = newId();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO collections (id, user_id, title, description, cover_image, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?)`
  ).bind(id, user.id, title, trimOrNull(body.description, MAX_DESCRIPTION_LEN), now, now).run();
  return json({ item: shapeCollection({ id, title, description: body.description || '', cover_image: null, created_at: now, updated_at: now }, 0, []) }, 201);
}

async function updateCollection(request, env, user, id) {
  const row = await findOwnCollection(env, user, id);
  if (!row) return errorJson('Bulunamadı', 404);
  const body = await readJson(request);

  const sets = [];
  const vals = [];
  if ('title' in body) {
    const title = trimOrNull(body.title, MAX_TITLE_LEN);
    if (!title) return errorJson('Koleksiyon adı zorunlu.');
    sets.push('title = ?'); vals.push(title);
  }
  if ('description' in body) { sets.push('description = ?'); vals.push(trimOrNull(body.description, MAX_DESCRIPTION_LEN)); }
  if ('coverImage' in body) { sets.push('cover_image = ?'); vals.push(safeInternalPath(body.coverImage)); }
  if (!sets.length) return errorJson('Güncellenecek alan yok.');

  sets.push('updated_at = ?'); vals.push(Date.now());
  await env.DB.prepare(`UPDATE collections SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).bind(...vals, id, user.id).run();
  return json({ ok: true });
}

async function deleteCollection(env, user, id) {
  const row = await findOwnCollection(env, user, id);
  if (!row) return errorJson('Bulunamadı', 404);
  // Çocuk satırlar açıkça silinir — bkz. src/lib/cascadeDelete.js#cascadeDeleteAccount'taki AYNI
  // gerekçe (ON DELETE CASCADE tanımlı olsa da bu kod tabanı hiçbir yerde ona güvenmiyor).
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM collection_items WHERE collection_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM collections WHERE id = ? AND user_id = ?`).bind(id, user.id),
  ]);
  return json({ ok: true });
}

async function addItem(request, env, user, collectionId) {
  const collection = await findOwnCollection(env, user, collectionId);
  if (!collection) return errorJson('Bulunamadı', 404);

  const body = await readJson(request);
  const kind = ITEM_KINDS.has(body.kind) ? body.kind : null;
  if (!kind) return errorJson('Geçersiz öğe türü.');

  const countRow = await env.DB.prepare(`SELECT COUNT(*) AS c, MAX(position) AS maxPos FROM collection_items WHERE collection_id = ?`).bind(collectionId).first();
  if ((countRow?.c || 0) >= MAX_ITEMS_PER_COLLECTION) {
    return errorJson(`Bir koleksiyona en fazla ${MAX_ITEMS_PER_COLLECTION} öğe ekleyebilirsin.`);
  }

  const image = safeInternalPath(body.image);
  const href = safeInternalPath(body.href);
  const note = trimOrNull(body.note, MAX_NOTE_LEN);
  const title = trimOrNull(body.title, MAX_TITLE_LEN);

  // Her tür kendi minimum içeriğini taşımalı — aksi halde panoda hiçbir şey göstermeyen boş bir
  // kutu oluşurdu.
  if (kind === 'image' && !image) return errorJson('Görsel bulunamadı.');
  if (kind === 'note' && !note) return errorJson('Not boş olamaz.');
  let itemType = null;
  let itemKey = null;
  if (kind === 'saved') {
    itemType = ITEM_TYPES.has(body.itemType) ? body.itemType : null;
    itemKey = trimOrNull(body.itemKey, MAX_URLISH_LEN);
    if (!itemType || !itemKey) return errorJson('Geçersiz kayıt.');
    // Aynı kaydı aynı panoya iki kez eklemek anlamsız — sessizce mevcut satır döner.
    const dupe = await env.DB.prepare(
      `SELECT * FROM collection_items WHERE collection_id = ? AND kind = 'saved' AND item_type = ? AND item_key = ?`
    ).bind(collectionId, itemType, itemKey).first();
    if (dupe) return json({ item: shapeItem(dupe), duplicate: true });
  }

  const id = newId();
  const now = Date.now();
  const position = (countRow?.maxPos ?? -1) + 1;
  await env.DB.prepare(
    `INSERT INTO collection_items (id, collection_id, kind, item_type, item_key, title, meta, image, href, note, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, collectionId, kind, itemType, itemKey, title, trimOrNull(body.meta, MAX_TITLE_LEN), image, href, note, position, now).run();
  await env.DB.prepare(`UPDATE collections SET updated_at = ? WHERE id = ?`).bind(now, collectionId).run();

  return json({
    item: shapeItem({ id, kind, item_type: itemType, item_key: itemKey, title, meta: body.meta || '', image, href, note, created_at: now }),
  }, 201);
}

async function deleteItem(env, user, collectionId, itemId) {
  const collection = await findOwnCollection(env, user, collectionId);
  if (!collection) return errorJson('Bulunamadı', 404);
  await env.DB.prepare(`DELETE FROM collection_items WHERE id = ? AND collection_id = ?`).bind(itemId, collectionId).run();
  await env.DB.prepare(`UPDATE collections SET updated_at = ? WHERE id = ?`).bind(Date.now(), collectionId).run();
  return json({ ok: true });
}
