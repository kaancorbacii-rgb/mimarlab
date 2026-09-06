import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { findCanonicalRowByNaturalKey } from '../lib/canonicalSync.js';
import { findProductsByKeys } from './product.js';
import { checkRateLimit } from '../lib/rateLimit.js';

// 'news' ve 'job' KALDIRILDI (2026-09-05): Haber/İş İlanı özellikleri yayından çekilmişti ve
// ilgili tablolar migrations/0090_drop_dead_feature_tables.sql ile düşürüldü. Canlıda bu iki
// tipte TEK BİR saved_items satırı bile yoktu (doğrulandı), yani mevcut hiçbir kayıt etkilenmez;
// bu yalnızca yeni yazımlar için geçerli bir doğrulama daralmasıdır.
// 'gundem' EKLENDİ (kullanıcı isteği, 2026-09-06 madde 15): Gündem kartındaki Kaydet butonu YENİ
// bir kaydetme altyapısı kurmaz — mevcut saved_items tablosunu ve mevcut /api/saved uçlarını aynen
// kullanır, yalnızca yeni bir item_type olarak katılır. Böylece "Benim Alanım > Kaydedilenler"
// listesi, panolar (collection_items) ve save-widget.js'in buton durumu hiç değiştirilmeden çalışır.
export const ITEM_TYPES = new Set(['project', 'product', 'material', 'architect', 'office', 'gundem']);

// saved_items görsel/başlık alanlarını kaydedildiği andaki haliyle tutar (bkz. createSaved) — hedef
// sonradan gizlenir/silinirse bu satır D1'de bozulmadan kalır ve "Kaydettiklerim" bunu göstermeye
// devam ederdi. src/routes/ratings.js#myRatings'teki AYNI canonical-satır kontrolüyle (bkz. o
// dosyadaki gerekçe) hedefi olmayan/gizli/silinmiş kayıtları burada da sessizce atlıyoruz.
// (news/job istisnası 2026-09-05'te kaldırıldı — o iki tip artık hiç kabul edilmiyor.)
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
  // gundem_items'ta deleted_at/hidden_at YOK, görünürlük tek bir `status` kolonuyla yönetilir
  // (bkz. migrations/0099_gundem.sql) — satır `status='published'` filtresiyle zaten çözüldüğü
  // için (bkz. listSaved) burada varlığı yeterli.
  if (itemType === 'gundem') return { live: !!row, buildStatus: null };
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

  // Gündem içerikleri de TOPLU çözülür (ürünlerdeki AYNI N+1 gerekçesi) — kaydedilen her Gündem
  // kartı için ayrı bir SELECT atmak yerine tek sorgu.
  const gundemKeys = results.filter(r => r.item_type === 'gundem').map(r => r.item_key);
  const gundemRows = new Map();
  if (gundemKeys.length) {
    const placeholders = gundemKeys.map(() => '?').join(',');
    const { results: rows } = await env.DB.prepare(
      `SELECT slug FROM gundem_items WHERE status = 'published' AND slug IN (${placeholders})`
    ).bind(...gundemKeys).all();
    rows.forEach(r => gundemRows.set(r.slug, r));
  }

  const info = await Promise.all(results.map(r => {
    if (r.item_type === 'product' || r.item_type === 'material') {
      return shapeSavedTargetInfo(r.item_type, productRows.get(r.item_key) || null);
    }
    if (r.item_type === 'gundem') return shapeSavedTargetInfo('gundem', gundemRows.get(r.item_key) || null);
    const canonicalType = CANONICAL_TYPE_BY_ITEM[r.item_type];
    if (!canonicalType) return { live: true, buildStatus: null }; // beklenmedik/eski bir item_type — satırı gizleme
    return findCanonicalRowByNaturalKey(env, canonicalType, r.item_key).then(row => shapeSavedTargetInfo(r.item_type, row));
  }));
  const items = results
    .map((r, i) => (info[i].buildStatus ? { ...r, item_build_status: info[i].buildStatus } : r))
    .filter((_, i) => info[i].live);

  // collectionKeys — kullanıcının PANOLARINDA ("Koleksiyonum > Panolarım", bkz.
  // src/routes/collections.js) bulunan içeriklerin "type:key" listesi. Kullanıcı isteği
  // (2026-09-01 madde 10): "bir proje ya da ürün kaydet butonuna tıklayıp PANOYA kaydedilince de
  // kaydedildi rengine dönüşsün" — Kaydet butonunun rengi eskiden yalnızca saved_items'a bakıyordu,
  // panolar ayrı bir tablo olduğundan panoya eklenen içerik kaydedilmemiş gibi görünüyordu. Bu uç
  // save-widget.js tarafından sayfa başına ZATEN bir kez çağrıldığından ek bir round-trip yok.
  const { results: collectionRows } = await env.DB.prepare(
    `SELECT DISTINCT ci.item_type, ci.item_key FROM collection_items ci
     JOIN collections c ON c.id = ci.collection_id
     WHERE c.user_id = ? AND ci.kind = 'saved' AND ci.item_type IS NOT NULL AND ci.item_key IS NOT NULL`
  ).bind(user.id).all();
  const collectionKeys = collectionRows.map(r => `${r.item_type}:${r.item_key}`);

  return json({ items, collectionKeys });
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
