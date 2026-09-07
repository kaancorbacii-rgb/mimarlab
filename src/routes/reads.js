// OKUNDU İŞARETİ (kullanıcı isteği, 2026-09-07): "Gündem sayfasına Kaydet/Paylaş'ın en soluna
// Okundu butonu da koy. Kullanıcı bildirimi okursa okunduya tıklar ve hangi bildirimleri görüp
// görmediğini anlar. Ama bunun için kullanıcı girişi yapılması lazım ki veri kullanıcı hesabında
// kayıtlı olabilsin."
//
//   GET    /api/reads              — bu kullanıcının TÜM okundu anahtarları ("type:key" listesi)
//   POST   /api/reads              — {type, key} işaretle
//   DELETE /api/reads/:type/:key   — işareti kaldır (yanlışlıkla tıklayan geri alabilsin)
//
// DESEN: src/routes/saved.js ile BİREBİR aynı — tamamen oturum arkasında, public önbelleğe hiç
// girmez. Gündem'in public gövdesi (GET /api/gundem) herkes için AYNI bayt kalmalıdır (bkz. o
// dosyanın başındaki not: paylaşılan edge önbelleğinde tutulabilmesi buna bağlı), bu yüzden
// kullanıcıya özel okundu durumu O YANITA KARIŞTIRILMAZ; ayrı bir kimlik doğrulamalı uçtan gelir
// ve yalnızca istemcide birleştirilir.
//
// GİRİŞ ŞARTI: uç, giriş yapılmamışsa 401 döner (aşağıdaki tek kapı). İstemci tarafında da buton
// giriş yoksa /giris'e yönlendirir (bkz. js/pages/gundem.js) — ama asıl kural BURADADIR; istemci
// kontrolü yalnızca kullanıcıya boş yere hata göstermemek içindir.
//
// NEDEN saved_items'a YENİ BİR item_type DEĞİL: bkz. migrations/0101_read_items.sql dosya başı.

import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { checkRateLimit } from '../lib/rateLimit.js';

// Şu an TEK tip: 'gundem'. Tablo şekli (bkz. migration) başka tipleri de taşıyabilir, ama bir tip
// bu listeye EKLENMEDEN kabul edilmez — saved.js#ITEM_TYPES ile aynı "beyaz liste" sözleşmesi.
export const READ_ITEM_TYPES = new Set(['gundem']);

export async function handleReadsRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "reads", ...]

  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  if (segments.length === 2 && request.method === 'GET') return listReads(env, user);
  if (segments.length === 2 && request.method === 'POST') return createRead(request, env, user);
  if (segments.length === 4 && request.method === 'DELETE') return deleteRead(env, user, segments[2], segments[3]);
  return errorJson('Bulunamadı', 404);
}

// Sayfa başına BİR kez çağrılır (bkz. js/pages/gundem.js#loadReadKeys) — kart başına ayrı istek
// atmak (N+1) bu depodaki bilinen tuzaktır.
//
// SAYFALAMA YOK, ama sınırsız da değil: LIMIT, kullanıcının işaretleyebileceği makul üst sınırın
// çok üstünde tutulur ve yanıtı kelepçeler. Gündem listesi zaten en yeni içerikleri gösterir;
// binlerce eski işaretin istemciye taşınmasının hiçbir faydası olmaz. En YENİ işaretler öncelikli
// döner ki kesme yaşanırsa ekranda görünen kartlar doğru boyansın.
const READS_LIMIT = 2000;

async function listReads(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT item_type, item_key FROM read_items WHERE user_id = ?
     ORDER BY created_at DESC LIMIT ${READS_LIMIT}`
  ).bind(user.id).all();
  return json({ keys: (results || []).map(r => `${r.item_type}:${r.item_key}`) });
}

async function createRead(request, env, user) {
  // saved.js#createSaved ile aynı gerekçe ve aynı cömertlik: ucuz ve sık kullanılan bir eylem
  // (bir oturumda gündemin tamamını okundu işaretlemek meşru bir kullanımdır), ama tek bir hesap
  // tabloyu saniyeler içinde şişirebilmemeli.
  if (!(await checkRateLimit(env, 'read-item', user.id, 200, 60 * 60 * 1000))) {
    return errorJson('Çok fazla işaretleme yaptın. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }

  const body = await readJson(request);
  const itemType = body.type;
  const itemKey = (body.key || '').trim();
  if (!READ_ITEM_TYPES.has(itemType) || !itemKey) return errorJson('Geçersiz istek.');

  // INSERT OR IGNORE — UNIQUE(user_id, item_type, item_key) zaten mükerrer satırı engelliyor;
  // önce SELECT atmak (saved.js'in tarihsel deseni) burada gereksiz bir round-trip olurdu.
  // Çift tıklama/yarış durumunda da hata DEĞİL, sessiz no-op üretir.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO read_items (id, user_id, item_type, item_key, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(newId(), user.id, itemType, itemKey, Date.now()).run();

  return json({ ok: true });
}

async function deleteRead(env, user, itemType, itemKey) {
  if (!READ_ITEM_TYPES.has(itemType)) return errorJson('Geçersiz istek.');
  await env.DB.prepare(
    'DELETE FROM read_items WHERE user_id = ? AND item_type = ? AND item_key = ?'
  ).bind(user.id, itemType, decodeURIComponent(itemKey)).run();
  return json({ ok: true });
}
