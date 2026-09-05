import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { ITEM_TYPES } from './saved.js';
import { hasAnyActiveBadge } from '../lib/badgeAccess.js';
import { createNotification } from '../lib/notify.js';

// KOLEKSİYONUM (kullanıcı isteği, 2026-08-31: "Kullanıcılar Pinterest'teki gibi Koleksiyon
// oluşturabilsin ... birden çok şey kaydederek ya da kendi bilgisayarından görsel, metin vs
// yükleyerek burada kendi çalışmasını oluşturabilecek") — bkz. migrations/0073_collections.sql.
//
// 2026-09-05 madde 2: Serbest tuval (moodboard) mimarisine çevrildi — collection_items artık
// pos_x/pos_y/width/height/z_index taşır (bkz. migrations/0094_board_canvas_and_sharing.sql), ve
// panolar başka MİMARLAB üyeleriyle rol bazlı (viewer/editor) paylaşılabilir (board_shares).
//
// Yetkilendirme artık İKİ katmanlı: sahiplik (collections.user_id) VE ortak çalışma (board_shares).
// resolveAccess() TEK giriş kapısı — sahip 'owner', davetli 'viewer'/'editor', ikisi de değilse null
// (404, 403 DEĞİL — var/yok bilgisini sızdırmamak için, eski findOwnCollection İLE AYNI gerekçe).

const ITEM_KINDS = new Set(['saved', 'image', 'note']);
const COLLAB_ROLES = new Set(['viewer', 'editor']);
const ORIENTATIONS = new Set(['landscape', 'portrait']);
const FONT_WEIGHTS = new Set(['normal', 'bold']);
// Kötüye kullanım/D1 satır şişmesi sınırları — src/lib/submissionTypes.js#findOversizedField'daki
// AYNI "sunucu tarafı da doğrulasın, sadece UI'a güvenme" ilkesi.
const MAX_COLLECTIONS_PER_USER = 100;
const MAX_ITEMS_PER_COLLECTION = 500;
const MAX_TITLE_LEN = 120;
const MAX_DESCRIPTION_LEN = 1000;
const MAX_NOTE_LEN = 4000;
const MAX_URLISH_LEN = 600;
// Tuval yüzde sınırları — image-hotspots.js'teki AYNI "yüzde, piksel değil" gerekçesi (bkz. dosya
// başı yorumu). Öğeler konteynerin biraz dışına taşabilir (ör. bir köşeyi kaydırırken) ama
// tamamen kaybolamaz/absürt büyüklüğe ulaşamaz diye gevşek ama sonlu bir aralık.
const POS_MIN = -20, POS_MAX = 120;
const SIZE_MIN = 4, SIZE_MAX = 100;
const FONT_SIZE_MIN = 8, FONT_SIZE_MAX = 72;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
// Çizim Aracı (kullanıcı isteği, 2026-09-06 madde 2) sınırları — bir kalem izi çok uzun bir dizi
// olabileceğinden (uzun bir sürükleme) hem nokta sayısı hem pano başına toplam çizim sayısı ayrı
// ayrı sınırlanır (bkz. migrations/0095_board_a4_canvas_and_strokes.sql).
const MAX_STROKES_PER_COLLECTION = 400;
const MAX_STROKE_POINTS = 800;
const STROKE_WIDTH_MIN = 1, STROKE_WIDTH_MAX = 40;

function trimOrNull(value, maxLen) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handleCollectionsRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "collections", ...]

  // GET /api/collections/shared/:token — TEK oturumsuz uç (kullanıcı isteği, 2026-09-02: "Pano
  // başkalarının da görebileceği şekilde paylaşılabilsin"). getSessionUser'dan ÖNCE ele alınır;
  // aşağıdaki 401 kapısı diğer TÜM işlemler için aynen yerinde kalır. Yalnızca sahibi paylaşımı
  // açmışsa (share_token dolu) veri döner — bkz. getSharedCollection.
  if (segments.length === 4 && segments[2] === 'shared' && request.method === 'GET') {
    return getSharedCollection(env, segments[3]);
  }

  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  if (segments.length === 2 && request.method === 'GET') return listCollections(env, user);
  if (segments.length === 2 && request.method === 'POST') return createCollection(request, env, user);
  if (segments.length === 3 && request.method === 'GET') return getCollection(env, user, segments[2]);
  if (segments.length === 3 && request.method === 'PATCH') return updateCollection(request, env, user, segments[2]);
  if (segments.length === 3 && request.method === 'DELETE') return deleteCollection(env, user, segments[2]);
  if (segments.length === 4 && segments[3] === 'items' && request.method === 'POST') return addItem(request, env, user, segments[2]);
  // PATCH .../items — GÖVDEYE göre iki farklı işlem: { order: [...] } eski sıra-yeniden-yazma
  // (grid görünümü artık kullanmıyor ama geriye dönük zararsız), { layout: [...] } YENİ serbest
  // tuval konum/boyut/z-index toplu kaydı (bkz. saveLayout). Tek tek öğe PATCH'i BİLEREK yok:
  // sürükleme/boyutlandırma bittiğinde SADECE o öğe gönderilir ama uç noktası aynı kalır.
  if (segments.length === 4 && segments[3] === 'items' && request.method === 'PATCH') return reorderItems(request, env, user, segments[2]);
  if (segments.length === 5 && segments[3] === 'items' && request.method === 'DELETE') return deleteItem(env, user, segments[2], segments[4]);
  // PATCH .../items/:itemId — TEK öğenin STİLİ (kullanıcı isteği madde 2: not renk/punto/kalınlık).
  // reorderItems'ın YUKARIDAKİ "tek tek PATCH yok" kuralı SIRAYA özeldi (çakışan pozisyon riski) —
  // stil alanları bağımsız/çakışmasız olduğundan burada tek öğe PATCH'i doğaldır.
  if (segments.length === 5 && segments[3] === 'items' && request.method === 'PATCH') return updateItemStyle(request, env, user, segments[2], segments[4]);
  // Çizim Aracı (kullanıcı isteği madde 2) — serbest el kalem izleri, collection_items'tan AYRI
  // (bkz. migrations/0095_board_a4_canvas_and_strokes.sql dosya başı yorumu).
  if (segments.length === 4 && segments[3] === 'strokes' && request.method === 'POST') return addStroke(request, env, user, segments[2]);
  if (segments.length === 5 && segments[3] === 'strokes' && request.method === 'DELETE') return deleteStroke(env, user, segments[2], segments[4]);
  // POST/DELETE .../share — herkese açık, tahmin edilemez bağlantı (aç/kapat). Rozet şartlı
  // (kullanıcı isteği, 2026-09-05 madde 3: "Paylaş butonu ... SADECE rozet sahibi kullanıcılar
  // için aktif olmalı") — bkz. shareCollection.
  if (segments.length === 4 && segments[3] === 'share' && request.method === 'POST') return shareCollection(env, user, segments[2]);
  if (segments.length === 4 && segments[3] === 'share' && request.method === 'DELETE') return unshareCollection(env, user, segments[2]);
  // Ortak çalışma (kullanıcı isteği madde 3) — belirli bir MİMARLAB üyesini viewer/editor olarak
  // davet et. Bu, yukarıdaki herkese açık share_token bağlantısından TAMAMEN AYRI bir mekanizma.
  if (segments.length === 4 && segments[3] === 'collaborators' && request.method === 'GET') return listCollaborators(env, user, segments[2]);
  if (segments.length === 4 && segments[3] === 'collaborators' && request.method === 'POST') return inviteCollaborator(request, env, user, segments[2]);
  if (segments.length === 5 && segments[3] === 'collaborators' && request.method === 'PATCH') return updateCollaboratorRole(request, env, user, segments[2], segments[4]);
  if (segments.length === 5 && segments[3] === 'collaborators' && request.method === 'DELETE') return removeCollaborator(env, user, segments[2], segments[4]);
  return errorJson('Bulunamadı', 404);
}

// TEK giriş kapısı — dosya başı yorumundaki gerekçe. role: 'owner' | 'editor' | 'viewer' | null.
async function resolveAccess(env, user, id) {
  const row = await env.DB.prepare(`SELECT * FROM collections WHERE id = ?`).bind(id).first();
  if (!row) return null;
  if (row.user_id === user.id) return { collection: row, role: 'owner' };
  const share = await env.DB.prepare(`SELECT role FROM board_shares WHERE collection_id = ? AND user_id = ?`).bind(id, user.id).first();
  if (share) return { collection: row, role: share.role };
  return null;
}

// Eski ad korunuyor (owner-only işlemler için) — sahiplik gerektiren uçlar (silme, davet yönetimi,
// herkese açık paylaşım) hâlâ TEK BAŞINA bu fonksiyonu çağırır.
function findOwnCollection(env, user, id) {
  return env.DB.prepare(`SELECT * FROM collections WHERE id = ? AND user_id = ?`).bind(id, user.id).first();
}

function shapeCollection(row, itemCount, previewImages, role) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    coverImage: row.cover_image || previewImages[0] || null,
    itemCount,
    previewImages,
    // Paylaşım durumu — istemci "Paylaş" / "Paylaşımı Durdur" ayrımını buradan yapar.
    shareToken: row.share_token || null,
    // 'owner' | 'editor' | 'viewer' — istemci düzenleme kontrollerini (sürükle/boyutlandır/ekle/sil,
    // paylaş/davet et) bu alana göre gösterir/gizler. listCollections'ta HER ZAMAN dolu; getCollection
    // resolveAccess'ten geleni geçirir.
    role: role || 'owner',
    // A4 kağıt yönü (kullanıcı isteği, 2026-09-06 madde 1) — istemci baseline piksel boyutlarını
    // (794x1123 @96dpi) buna göre seçer, bkz. js/components/auth-modal.js#CANVAS_PAGE_SIZES.
    canvasOrientation: ORIENTATIONS.has(row.canvas_orientation) ? row.canvas_orientation : 'landscape',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function shapeItem(row) {
  return {
    id: row.id, kind: row.kind, itemType: row.item_type, itemKey: row.item_key,
    title: row.title || '', meta: row.meta || '', image: row.image || null,
    href: row.href || null, note: row.note || '', created_at: row.created_at,
    // Serbest tuval konumu — pos_x -1 ise istemci bunu "hiç konumlandırılmamış" sayıp otomatik
    // yerleştirir (bkz. migrations/0094_board_canvas_and_sharing.sql dosya başı yorumu).
    x: row.pos_x, y: row.pos_y, width: row.width, height: row.height, zIndex: row.z_index,
    // Not stili (kullanıcı isteği madde 2) — NULL ise istemci varsayılanı (ink/14px/normal) uygular.
    textColor: row.text_color || null, fontSize: row.font_size || null, fontWeight: row.font_weight || null,
  };
}

function shapeStroke(row) {
  let points = [];
  try { points = JSON.parse(row.points || '[]'); } catch { /* bozuk JSON — boş çizim olarak render edilir */ }
  return { id: row.id, points, color: row.color, strokeWidth: row.stroke_width, createdAt: row.created_at };
}

async function listCollections(env, user) {
  const { results: ownRows } = await env.DB.prepare(
    `SELECT * FROM collections WHERE user_id = ? ORDER BY created_at DESC`
  ).bind(user.id).all();
  // Başkasının panosunda davetli olduğum satırlar (kullanıcı isteği madde 3) — Koleksiyonum
  // listesinde kendi panolarımla birlikte görünmeli, rolüm 'owner' DEĞİL bs.role olarak işaretlenir.
  const { results: sharedRows } = await env.DB.prepare(
    `SELECT c.*, bs.role AS shared_role FROM collections c
     JOIN board_shares bs ON bs.collection_id = c.id
     WHERE bs.user_id = ? ORDER BY c.created_at DESC`
  ).bind(user.id).all();

  const all = [...ownRows.map(r => ({ row: r, role: 'owner' })), ...sharedRows.map(r => ({ row: r, role: r.shared_role }))];
  if (!all.length) return json({ items: [] });

  const ids = all.map(r => r.row.id);
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
    items: all.map(({ row, role }) => shapeCollection(row, countByCollection.get(row.id) || 0, previewByCollection.get(row.id) || [], role)),
  });
}

async function getCollection(env, user, id) {
  const access = await resolveAccess(env, user, id);
  if (!access) return errorJson('Bulunamadı', 404);
  const [{ results }, { results: strokeRows }] = await Promise.all([
    env.DB.prepare(`SELECT * FROM collection_items WHERE collection_id = ? ORDER BY position, created_at`).bind(id).all(),
    env.DB.prepare(`SELECT * FROM board_strokes WHERE collection_id = ? ORDER BY created_at`).bind(id).all(),
  ]);
  const previewImages = results.filter(r => r.image).slice(0, 4).map(r => r.image);
  return json({
    item: shapeCollection(access.collection, results.length, previewImages, access.role),
    items: results.map(shapeItem),
    strokes: strokeRows.map(shapeStroke),
  });
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
  return json({ item: shapeCollection({ id, title, description: body.description || '', cover_image: null, created_at: now, updated_at: now }, 0, [], 'owner') }, 201);
}

async function updateCollection(request, env, user, id) {
  // Ad/açıklama/kapak değişikliği — editor de yapabilir (tuval üzerinde çalışan bir işbirlikçi
  // panonun görünümünü düzenleyebilmeli), yalnızca DAVET/SİLME sahipte kalır.
  const access = await resolveAccess(env, user, id);
  if (!access || access.role === 'viewer') return errorJson('Bulunamadı', 404);
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
  if ('canvasOrientation' in body) {
    if (!ORIENTATIONS.has(body.canvasOrientation)) return errorJson('Geçersiz kağıt yönü.');
    sets.push('canvas_orientation = ?'); vals.push(body.canvasOrientation);
  }
  if (!sets.length) return errorJson('Güncellenecek alan yok.');

  sets.push('updated_at = ?'); vals.push(Date.now());
  await env.DB.prepare(`UPDATE collections SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
  return json({ ok: true });
}

async function deleteCollection(env, user, id) {
  const row = await findOwnCollection(env, user, id);
  if (!row) return errorJson('Bulunamadı', 404);
  // Çocuk satırlar açıkça silinir — bkz. src/lib/cascadeDelete.js#cascadeDeleteAccount'taki AYNI
  // gerekçe (ON DELETE CASCADE tanımlı olsa da bu kod tabanı hiçbir yerde ona güvenmiyor).
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM collection_items WHERE collection_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM board_shares WHERE collection_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM board_strokes WHERE collection_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM collections WHERE id = ? AND user_id = ?`).bind(id, user.id),
  ]);
  return json({ ok: true });
}

async function addItem(request, env, user, collectionId) {
  const access = await resolveAccess(env, user, collectionId);
  if (!access || access.role === 'viewer') return errorJson('Bulunamadı', 404);

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
  // Yeni öğe konumsuz (-1) eklenir — istemci ilk açılışta otomatik yerleştirip PATCH .../items
  // {layout:[...]} ile kaydeder (bkz. shapeItem yorumu). Sunucu tarafında rastgele bir varsayılan
  // konum ÜRETİLMEZ: aynı anda birden çok kişi (editör) öğe eklerse çakışan tahminler yerine
  // istemcinin GÖRDÜĞÜ tuvale göre yerleştirmesi daha tutarlı.
  await env.DB.prepare(
    `INSERT INTO collection_items (id, collection_id, kind, item_type, item_key, title, meta, image, href, note, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, collectionId, kind, itemType, itemKey, title, trimOrNull(body.meta, MAX_TITLE_LEN), image, href, note, position, now).run();
  await env.DB.prepare(`UPDATE collections SET updated_at = ? WHERE id = ?`).bind(now, collectionId).run();

  return json({
    item: shapeItem({ id, kind, item_type: itemType, item_key: itemKey, title, meta: body.meta || '', image, href, note, created_at: now, pos_x: -1, pos_y: -1, width: 22, height: 22, z_index: 0 }),
  }, 201);
}

// PATCH /api/collections/:id/items  body: { order: [itemId, ...] }  VEYA  { layout: [{id,x,y,width,height,zIndex}, ...] }
async function reorderItems(request, env, user, collectionId) {
  const access = await resolveAccess(env, user, collectionId);
  if (!access || access.role === 'viewer') return errorJson('Bulunamadı', 404);
  const body = await readJson(request);
  if (Array.isArray(body.layout)) return saveLayout(env, collectionId, body.layout);
  if (Array.isArray(body.order)) return saveOrder(env, collectionId, body.order);
  return errorJson('Geçersiz istek.');
}

// Serbest tuval konum/boyut/yığın-sırası toplu kaydı (kullanıcı isteği madde 1: "konumları
// asenkron olarak kaydet"). İstemci yalnızca o an sürüklenen/boyutlandırılan öğeyi gönderir (tek
// elemanlı bir dizi de olabilir) — TÜM panoyu her hareket sonrası yeniden göndermek gereksiz.
async function saveLayout(env, collectionId, layout) {
  const { results } = await env.DB.prepare(`SELECT id FROM collection_items WHERE collection_id = ?`).bind(collectionId).all();
  const owned = new Set(results.map(r => r.id));
  const updates = [];
  for (const entry of layout) {
    if (!entry || typeof entry.id !== 'string' || !owned.has(entry.id)) continue;
    const x = clampNum(entry.x, POS_MIN, POS_MAX, 0);
    const y = clampNum(entry.y, POS_MIN, POS_MAX, 0);
    const width = clampNum(entry.width, SIZE_MIN, SIZE_MAX, 22);
    const height = clampNum(entry.height, SIZE_MIN, SIZE_MAX, 22);
    const zIndex = Math.trunc(clampNum(entry.zIndex, 0, 100000, 0));
    updates.push(env.DB.prepare(
      `UPDATE collection_items SET pos_x = ?, pos_y = ?, width = ?, height = ?, z_index = ? WHERE id = ? AND collection_id = ?`
    ).bind(x, y, width, height, zIndex, entry.id, collectionId));
  }
  if (!updates.length) return json({ ok: true });
  updates.push(env.DB.prepare(`UPDATE collections SET updated_at = ? WHERE id = ?`).bind(Date.now(), collectionId));
  await env.DB.batch(updates);
  return json({ ok: true });
}

// Eski sıra-yeniden-yazma — grid görünümü kaldırıldı ama uç nokta geriye dönük zararsız bırakıldı.
async function saveOrder(env, collectionId, order) {
  const { results } = await env.DB.prepare(
    `SELECT id FROM collection_items WHERE collection_id = ? ORDER BY position, created_at`
  ).bind(collectionId).all();
  const owned = new Set(results.map(r => r.id));

  const ordered = [];
  const seen = new Set();
  for (const id of order) {
    if (typeof id !== 'string' || !owned.has(id) || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  for (const row of results) {
    if (!seen.has(row.id)) ordered.push(row.id);
  }
  if (!ordered.length) return json({ ok: true });

  await env.DB.batch([
    ...ordered.map((id, index) => env.DB.prepare(
      `UPDATE collection_items SET position = ? WHERE id = ? AND collection_id = ?`
    ).bind(index, id, collectionId)),
    env.DB.prepare(`UPDATE collections SET updated_at = ? WHERE id = ?`).bind(Date.now(), collectionId),
  ]);
  return json({ ok: true });
}

async function deleteItem(env, user, collectionId, itemId) {
  const access = await resolveAccess(env, user, collectionId);
  if (!access || access.role === 'viewer') return errorJson('Bulunamadı', 404);
  await env.DB.prepare(`DELETE FROM collection_items WHERE id = ? AND collection_id = ?`).bind(itemId, collectionId).run();
  await env.DB.prepare(`UPDATE collections SET updated_at = ? WHERE id = ?`).bind(Date.now(), collectionId).run();
  return json({ ok: true });
}

// Paylaşımı açar ve TAHMİN EDİLEMEZ bir token üretir (newId — createCollection'ın id'leriyle AYNI
// kaynak). Zaten paylaşılmışsa mevcut token KORUNUR: kullanıcı butona tekrar bastığında daha önce
// dağıttığı bağlantı ölmemeli. Rozet şartlı (kullanıcı isteği madde 3) — badges.js/hotspotTags.js
// ile AYNI hasAnyActiveBadge kaynağı, ayrı bir "board share badge" kontrolü İCAT EDİLMEDİ.
async function shareCollection(env, user, id) {
  const row = await findOwnCollection(env, user, id);
  if (!row) return errorJson('Bulunamadı', 404);
  if (!(await hasAnyActiveBadge(env, user.id))) {
    return errorJson('Bu özellik rozetli kullanıcılara özeldir.', 403);
  }
  let token = row.share_token;
  if (!token) {
    token = newId();
    await env.DB.prepare(`UPDATE collections SET share_token = ?, shared_at = ? WHERE id = ? AND user_id = ?`)
      .bind(token, Date.now(), id, user.id).run();
  }
  return json({ shareToken: token, shareUrl: `/pano/${token}` });
}

// Paylaşımı geri alır — token silinir, dağıtılmış bağlantı çalışmaz hale gelir (bkz.
// migrations/0082_collection_share.sql tasarım notu). Rozet kontrolü BİLEREK yok: rozeti
// dolan/iptal olan bir kullanıcı zaten dağıtılmış bir bağlantıyı KAPATABİLMELİDİR.
async function unshareCollection(env, user, id) {
  const row = await findOwnCollection(env, user, id);
  if (!row) return errorJson('Bulunamadı', 404);
  await env.DB.prepare(`UPDATE collections SET share_token = NULL, shared_at = NULL WHERE id = ? AND user_id = ?`)
    .bind(id, user.id).run();
  return json({ shareToken: null });
}

// Herkese açık okuma. Yalnızca token ile bulunur (id ile DEĞİL) ve yalnızca paylaşımı AÇIK panolar
// döner. Sahibin kimliği/e-postası KASITLI olarak dönmez — yalnızca panonun kendi içeriği.
async function getSharedCollection(env, token) {
  if (!token) return errorJson('Bulunamadı', 404);
  const row = await env.DB.prepare(
    `SELECT * FROM collections WHERE share_token = ? LIMIT 1`
  ).bind(token).first();
  if (!row) return errorJson('Bulunamadı', 404);
  const [{ results }, { results: strokeRows }] = await Promise.all([
    env.DB.prepare(`SELECT * FROM collection_items WHERE collection_id = ? ORDER BY position, created_at`).bind(row.id).all(),
    env.DB.prepare(`SELECT * FROM board_strokes WHERE collection_id = ? ORDER BY created_at`).bind(row.id).all(),
  ]);
  const previewImages = results.filter(r => r.image).slice(0, 4).map(r => r.image);
  const shaped = shapeCollection(row, results.length, previewImages, 'viewer');
  // Paylaşılan görünümde pano id'si sızdırılmaz: id'yi bilen biri yazma uçlarını deneyemesin
  // (denese de findOwnCollection user_id ile eşleşmediğinden 404 alırdı — bu ek bir savunma katmanı).
  delete shaped.id;
  return json({ item: shaped, items: results.map(shapeItem), strokes: strokeRows.map(shapeStroke) });
}

// Not stili (kullanıcı isteği madde 2) — TEK öğe PATCH'i, yalnızca gönderilen alanlar güncellenir.
async function updateItemStyle(request, env, user, collectionId, itemId) {
  const access = await resolveAccess(env, user, collectionId);
  if (!access || access.role === 'viewer') return errorJson('Bulunamadı', 404);
  const body = await readJson(request);
  const sets = [];
  const vals = [];
  if ('textColor' in body) {
    if (body.textColor !== null && !HEX_COLOR_RE.test(body.textColor)) return errorJson('Geçersiz renk.');
    sets.push('text_color = ?'); vals.push(body.textColor);
  }
  if ('fontSize' in body) {
    const size = Math.trunc(clampNum(body.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX, 14));
    sets.push('font_size = ?'); vals.push(size);
  }
  if ('fontWeight' in body) {
    if (!FONT_WEIGHTS.has(body.fontWeight)) return errorJson('Geçersiz yazı kalınlığı.');
    sets.push('font_weight = ?'); vals.push(body.fontWeight);
  }
  if (!sets.length) return errorJson('Güncellenecek alan yok.');
  await env.DB.prepare(`UPDATE collection_items SET ${sets.join(', ')} WHERE id = ? AND collection_id = ?`).bind(...vals, itemId, collectionId).run();
  return json({ ok: true });
}

// ---- Çizim Aracı (kullanıcı isteği madde 2) ----

async function addStroke(request, env, user, collectionId) {
  const access = await resolveAccess(env, user, collectionId);
  if (!access || access.role === 'viewer') return errorJson('Bulunamadı', 404);
  if (!(await checkRateLimit(env, 'board-stroke', user.id, 300, 60 * 60 * 1000))) {
    return errorJson('Çok fazla çizim yaptın, birkaç dakika sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }
  const countRow = await env.DB.prepare(`SELECT COUNT(*) AS c FROM board_strokes WHERE collection_id = ?`).bind(collectionId).first();
  if ((countRow?.c || 0) >= MAX_STROKES_PER_COLLECTION) {
    return errorJson(`Bir panoya en fazla ${MAX_STROKES_PER_COLLECTION} çizim eklenebilir.`);
  }

  const body = await readJson(request);
  if (!Array.isArray(body.points) || body.points.length < 2) return errorJson('Geçersiz çizim.');
  const points = body.points.slice(0, MAX_STROKE_POINTS)
    .filter(p => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map(([x, y]) => [clampNum(x, POS_MIN, POS_MAX, 0), clampNum(y, POS_MIN, POS_MAX, 0)]);
  if (points.length < 2) return errorJson('Geçersiz çizim.');
  const color = HEX_COLOR_RE.test(body.color) ? body.color : '#1B2A3D';
  const strokeWidth = clampNum(body.strokeWidth, STROKE_WIDTH_MIN, STROKE_WIDTH_MAX, 3);

  const id = newId();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO board_strokes (id, collection_id, points, color, stroke_width, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, collectionId, JSON.stringify(points), color, strokeWidth, user.id, now).run();
  await env.DB.prepare(`UPDATE collections SET updated_at = ? WHERE id = ?`).bind(now, collectionId).run();
  return json({ item: { id, points, color, strokeWidth, createdAt: now } }, 201);
}

async function deleteStroke(env, user, collectionId, strokeId) {
  const access = await resolveAccess(env, user, collectionId);
  if (!access || access.role === 'viewer') return errorJson('Bulunamadı', 404);
  await env.DB.prepare(`DELETE FROM board_strokes WHERE id = ? AND collection_id = ?`).bind(strokeId, collectionId).run();
  return json({ ok: true });
}

// ---- Ortak çalışma / davetler (kullanıcı isteği madde 3) ----

async function listCollaborators(env, user, id) {
  const access = await resolveAccess(env, user, id);
  if (!access || access.role === 'viewer') return errorJson('Bulunamadı', 404);
  const { results } = await env.DB.prepare(
    `SELECT bs.user_id, bs.role, bs.created_at, u.name, u.email FROM board_shares bs
     JOIN users u ON u.id = bs.user_id WHERE bs.collection_id = ? ORDER BY bs.created_at`
  ).bind(id).all();
  return json({ items: results.map(r => ({ userId: r.user_id, name: r.name, email: r.email, role: r.role, createdAt: r.created_at })) });
}

// Davet — SADECE sahip, VE sahip rozetli olmalı (kullanıcı isteği madde 3: "ortak çalışma başlatma
// yetkisi SADECE rozet sahibi kullanıcılar için aktif olmalı"). E-posta ile aranır (bu kod
// tabanında "kullanıcı adı" diye ayrı bir alan yok, users tek başına e-postayla anahtarlanır).
async function inviteCollaborator(request, env, user, id) {
  const row = await findOwnCollection(env, user, id);
  if (!row) return errorJson('Bulunamadı', 404);
  if (!(await hasAnyActiveBadge(env, user.id))) {
    return errorJson('Bu özellik rozetli kullanıcılara özeldir.', 403);
  }
  if (!(await checkRateLimit(env, 'board-invite', user.id, 30, 60 * 60 * 1000))) {
    return errorJson('Çok fazla davet gönderdin, birkaç dakika sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }

  const body = await readJson(request);
  const email = trimOrNull(body.email, 190)?.toLowerCase();
  const role = COLLAB_ROLES.has(body.role) ? body.role : 'viewer';
  if (!email || !EMAIL_RE.test(email)) return errorJson('Geçerli bir e-posta adresi gir.');

  const target = await env.DB.prepare(`SELECT id, name FROM users WHERE email = ?`).bind(email).first();
  if (!target) return errorJson('Bu e-postayla kayıtlı bir MİMARLAB üyesi bulunamadı.', 404);
  if (target.id === user.id) return errorJson('Kendini davet edemezsin.');

  const existing = await env.DB.prepare(`SELECT id FROM board_shares WHERE collection_id = ? AND user_id = ?`).bind(id, target.id).first();
  const now = Date.now();
  if (existing) {
    await env.DB.prepare(`UPDATE board_shares SET role = ? WHERE id = ?`).bind(role, existing.id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO board_shares (id, collection_id, user_id, role, invited_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(newId(), id, target.id, role, user.id, now).run();
    await createNotification(
      env, target.id, 'board_invite',
      'Bir panoya davet edildin',
      `${user.name || 'Bir MİMARLAB üyesi'} seni "${row.title}" panosuna ${role === 'editor' ? 'editör' : 'görüntüleyici'} olarak ekledi.`,
      '/koleksiyonum',
    );
  }
  return json({ ok: true, role }, existing ? 200 : 201);
}

async function updateCollaboratorRole(request, env, user, id, targetUserId) {
  const row = await findOwnCollection(env, user, id);
  if (!row) return errorJson('Bulunamadı', 404);
  const body = await readJson(request);
  if (!COLLAB_ROLES.has(body.role)) return errorJson('Geçersiz yetki türü.');
  await env.DB.prepare(`UPDATE board_shares SET role = ? WHERE collection_id = ? AND user_id = ?`).bind(body.role, id, targetUserId).run();
  return json({ ok: true });
}

// Erişimi kaldır — sahip herkesi çıkarabilir; bir davetli KENDİ erişimini de bırakabilir ("panodan
// ayrıl") — bu yüzden owner-only DEĞİL, ya sahip ya da hedefin kendisi olmak yeterli.
async function removeCollaborator(env, user, id, targetUserId) {
  const collection = await env.DB.prepare(`SELECT * FROM collections WHERE id = ?`).bind(id).first();
  if (!collection) return errorJson('Bulunamadı', 404);
  const isOwner = collection.user_id === user.id;
  if (!isOwner && user.id !== targetUserId) return errorJson('Bulunamadı', 404);
  await env.DB.prepare(`DELETE FROM board_shares WHERE collection_id = ? AND user_id = ?`).bind(id, targetUserId).run();
  return json({ ok: true });
}
