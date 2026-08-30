import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { getActiveBadge, getPersonalAdminBadgesForUsers, higherRankBadge } from '../lib/badgeAccess.js';
import { createNotification } from '../lib/notify.js';
import { findCanonicalRowByNaturalKey } from '../lib/canonicalSync.js';
import { parseCanonicalRow } from '../lib/canonicalRead.js';
import { checkRateLimit } from '../lib/rateLimit.js';

const TARGET_TYPES = new Set(['project', 'news', 'architect', 'office']);

export async function handleCommentsRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "comments", maybe "mine"/id]

  if (segments.length === 3 && segments[2] === 'mine' && request.method === 'GET') {
    const user = await getSessionUser(request, env);
    if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);
    return myComments(env, user);
  }
  if (segments.length === 2) {
    if (request.method === 'GET') return listComments(env, url);
    if (request.method === 'POST') return createComment(request, env);
  }
  if (segments.length === 3 && request.method === 'DELETE') return deleteComment(request, env, segments[2]);
  return errorJson('Bulunamadı', 404);
}

// user_badge: yorumu yapan kişinin KENDİSİ için aldığı (target_type='self') aktif rozeti —
// profile_claims'ten tamamen bağımsız, mimar/marka profili olmasa bile ismi yanında gözükür
// (bkz. kullanıcı talebi). 'destekci' hiçbir görünür rozet vermediği için hariç tutulur.
//
// commenterProfile: yorumu yapan kullanıcının hesabı bir mimar/firma profiline BAĞLIYSA (bkz.
// architects/offices.claimed_by_user_id — profile_claims onayında kanonik satıra yazılır) o
// profilin fotoğrafı/adı/slug'ı (kullanıcı isteği: yorumda varsayılan avatar yerine profil fotosu,
// tıklanınca /mimar veya /firma'ya git). Bir hesap teorik olarak hem bir mimar HEM bir firma
// kaydını claim etmiş olabilir — architects/offices'ten en fazla BİRER satırı garanti eden
// korelasyonlu alt sorgularla (LIMIT 1) satır çoğalması önlenir, ikisi de doluysa proje.html
// #DESIGNER_JOIN_SQL'deki COALESCE(ar, ofc) ile AYNI önceliğe (mimar > firma) uyulur.
//
// GERÇEK BULGU (bkz. kullanıcı isteği: "Admin hesabından ... yorumum Renzo Piano hesabıyla
// gözüktü ... kökten çöz"): admin (kurumsal mimarlabcom@gmail.com hesabı) platform içeriği olarak
// onlarca mimar/firma profili eklemişti; eskiden syncArchitect/syncOffice bunların HEPSİNİN
// claimed_by_user_id'sini admin'e yazıyordu (bkz. src/lib/canonicalSync.js#resolveClaimedByUserId
// — kök neden orada düzeltildi, artık admin'in eklediği yeni kayıtlarda bu alan hep NULL). Bu JOIN'e
// eklenen "AND u.role != 'admin'" ise İKİNCİ bir savunma katmanı: admin kurumsal/platform hesabı
// olduğundan (kişisel bir mimar/firma kimliği DEĞİL) admin'in yorumları geçmişte oluşmuş ya da
// ileride farklı bir yoldan (ör. profile_claims onayı) oluşabilecek HERHANGİ bir claimed_by_user_id
// bağından bağımsız olarak HER ZAMAN kendi adıyla ("MİMARLAB") görünür.
async function listComments(env, url) {
  const targetType = url.searchParams.get('targetType');
  const targetId = url.searchParams.get('targetId');
  if (!TARGET_TYPES.has(targetType) || !targetId) return errorJson('Geçersiz istek.');

  // Onay bekleyen (status='pending') ya da reddedilen yorumlar kamuya açık listede hiç görünmez
  // (bkz. kullanıcı isteği: yorum moderasyonu, migrations/0029_comment_moderation.sql) — admin
  // panelindeki src/routes/admin.js#handleCommentsAdmin bu filtreden ETKİLENMEZ, tüm statüleri görür.
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.body, c.created_at, u.name AS user_name, u.id AS user_id, u.photo_url AS user_photo, b.badge_type AS user_badge,
            ar.name AS profile_ar_name, ar.photo_url AS profile_ar_photo,
            ofc.name AS profile_ofc_name, ofc.logo_url AS profile_ofc_logo
     FROM comments c JOIN users u ON u.id = c.user_id
     LEFT JOIN badge_requests b ON b.user_id = c.user_id AND b.target_type = 'self' AND b.status = 'active'
       AND b.badge_type != 'destekci' AND (b.expires_at IS NULL OR b.expires_at > ?)
     LEFT JOIN architects ar ON ar.id = (SELECT id FROM architects WHERE claimed_by_user_id = c.user_id AND deleted_at IS NULL LIMIT 1) AND u.role != 'admin'
     LEFT JOIN offices ofc ON ofc.id = (SELECT id FROM offices WHERE claimed_by_user_id = c.user_id AND deleted_at IS NULL LIMIT 1) AND u.role != 'admin'
     WHERE c.target_type = ? AND c.target_id = ? AND c.status = 'approved'
     ORDER BY c.created_at ASC`
  ).bind(Date.now(), targetType, targetId).all();

  // bkz. badgeAccess.js#getPersonalAdminBadgesForUsers yorumu — yukarıdaki sorgu yalnızca satın
  // alınan (badge_requests) rozeti taşır, admin'in verdiği rozetleri (ör. bir firmanın Kurucusu
  // olarak sahiplenilen admin rozeti) kapsamaz; burada ikisinin arasından yüksek kademeli olan seçilir.
  const adminBadgeByUser = await getPersonalAdminBadgesForUsers(env, results.map(r => r.user_id));
  const items = results.map(r => {
    const badge = higherRankBadge(r.user_badge, adminBadgeByUser.get(r.user_id));
    const item = { id: r.id, body: r.body, created_at: r.created_at, user_name: r.user_name, user_id: r.user_id, user_photo: r.user_photo || null, user_badge: badge };
    if (r.profile_ar_name) item.commenterProfile = { type: 'architect', name: r.profile_ar_name, photo: r.profile_ar_photo || null };
    else if (r.profile_ofc_name) item.commenterProfile = { type: 'office', name: r.profile_ofc_name, photo: r.profile_ofc_logo || null };
    return item;
  });

  return json({ items });
}

// GET /api/comments/mine — hesabim.html'in "Yorumlarım" kutusu için, giriş yapmış kullanıcının
// yaptığı TÜM yorumları (statüden bağımsız — kendi yorumu, onay bekleyen de dahil) hedefin başlık/
// görsel/bağlantısıyla zenginleştirip döner. ratings.js#myRatings ile AYNI desen: ratings tablosu
// gibi comments da hedefi yalnızca (target_type, target_id) doğal anahtarıyla tutuyor, görüntüleme
// alanlarını KAYDETMİYOR — bu yüzden her satır için canonical satır ayrıca bulunur; 'news' hariç
// (CANONICAL_TYPE_BY_TARGET'te yok, kendi 'news' tablosundan id'yle çekilir — bkz. haber-detay.html
// targetId=news.id kullanımı). Sonradan silinmiş/gizlenmiş bir hedefse sessizce atlanır.
const CANONICAL_TYPE_BY_TARGET = { project: 'projects', architect: 'architects', office: 'offices' };
const HREF_BASE_BY_TARGET = { project: '/proje/', architect: '/mimar/', office: '/firma/' };

function commentCardShape(targetType, row) {
  if (targetType === 'project') {
    const p = parseCanonicalRow('projects', row);
    return { title: p.title, image: (p.images && p.images[0]) || null, href: HREF_BASE_BY_TARGET.project + encodeURIComponent(p.slug) };
  }
  return { title: row.name, image: (targetType === 'architect' ? row.photo_url : row.logo_url) || null, href: HREF_BASE_BY_TARGET[targetType] + encodeURIComponent(row.slug) };
}

// admin.js#listUserCommentsAdmin de bunu (env, {id: targetUserId}) ile çağırır — bkz. kullanıcı
// isteği: admin Üyeler listesinden bir üyenin Yorumlarım'ını görebilsin.
export async function myComments(env, user) {
  const { results } = await env.DB.prepare(
    'SELECT id, target_type, target_id, body, status, created_at FROM comments WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all();

  // gerçek bulgu: 'news' hedefleri eskiden her satır için ayrı bir SELECT ... WHERE id = ? atıyordu
  // (ucuz, tek satır primary-key sorgusu olsa da N ayrı round-trip anlamına geliyordu) — burada tek
  // bir IN(...) sorgusuyla toplu çözülür. project/architect/office için AYNI batching yapılmadı:
  // findCanonicalRowByNaturalKey mimar/firma'da BARE isimle eşleşiyor ([[project_duplicate_name_key_
  // limitation]]) — aynı isme sahip iki kayıt varsa hangi satırın hangi target_id'ye ait olduğu
  // IN(...) sonucunda güvenle geri eşlenemez; zaten tek satırlık indeksli sorgular olduğundan (tam
  // tablo taraması DEĞİL) bu riski göze almaya değecek bir performans kazancı da yok.
  const newsIds = [...new Set(results.filter(r => r.target_type === 'news').map(r => r.target_id))];
  const newsById = new Map();
  if (newsIds.length) {
    const placeholders = newsIds.map(() => '?').join(',');
    const { results: newsRows } = await env.DB.prepare(
      `SELECT id, title, image_url FROM news WHERE id IN (${placeholders})`
    ).bind(...newsIds).all();
    for (const n of newsRows) newsById.set(n.id, n);
  }

  const items = [];
  for (const r of results) {
    let shaped = null;
    if (r.target_type === 'news') {
      const n = newsById.get(r.target_id);
      if (n) shaped = { title: n.title, image: n.image_url || null, href: '/haberler/' + encodeURIComponent(n.id) };
    } else {
      const canonicalType = CANONICAL_TYPE_BY_TARGET[r.target_type];
      const row = canonicalType ? await findCanonicalRowByNaturalKey(env, canonicalType, r.target_id) : null;
      if (row && !row.deleted_at && !row.hidden_at) shaped = commentCardShape(r.target_type, row);
    }
    if (!shaped) continue;
    items.push({ id: r.id, type: r.target_type, body: r.body, status: r.status, createdAt: r.created_at, ...shaped });
  }
  return json({ items });
}

async function createComment(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Yorum yapmak için giriş yapmalısın.', 401);

  // gerçek bulgu: bu uçta hiç hız sınırı yoktu — her yorum notifyCommentOwner ile hedef sahibine
  // bildirim gönderdiğinden, tek bir hesap hem comments moderasyon kuyruğunu hem hedef kullanıcıların
  // bildirim kutusunu spam'leyebilirdi. upload.js#checkRateLimit ile AYNI "yalnızca kullanıcı bazlı"
  // desen (yorum yapmak oturum gerektirir, IP bazlı ayrıca gerek yok).
  if (!(await checkRateLimit(env, 'comment', user.id, 30, 60 * 60 * 1000))) {
    return errorJson('Çok fazla yorum gönderdin. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }

  const body = await readJson(request);
  const targetType = body.targetType;
  const targetId = (body.targetId || '').trim();
  const text = (body.body || '').trim();

  if (!TARGET_TYPES.has(targetType) || !targetId) return errorJson('Geçersiz istek.');
  if (!text) return errorJson('Yorum boş olamaz.');
  if (text.length > 2000) return errorJson('Yorum en fazla 2000 karakter olabilir.');

  const id = newId();
  const now = Date.now();
  // status='pending' — admin onaylayana kadar listComments()'te GÖRÜNMEZ (bkz. yukarısı,
  // migrations/0029_comment_moderation.sql, kullanıcı isteği: yorum moderasyonu).
  await env.DB.prepare(
    "INSERT INTO comments (id, target_type, target_id, user_id, body, created_at, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')"
  ).bind(id, targetType, targetId, user.id, text, now).run();

  // gerçek bulgu: yorum zaten DB'ye başarıyla yazıldıktan SONRA çalışan bu best-effort bildirim
  // adımı sarmalanmamıştı — atarsa istemci 500 görüyordu, kullanıcı muhtemelen formu tekrar
  // gönderiyor ve yorumun moderasyon kuyruğunda mükerrer bir satırı oluşuyordu. payments.js#
  // handleCallback'teki AYNI "logla, yut" deseni.
  try {
    await notifyCommentOwner(env, user, targetType, targetId, text);
  } catch (err) {
    console.error('notifyCommentOwner failed', err);
  }

  return json({ id, body: text, created_at: now, user_name: user.name, user_id: user.id, status: 'pending' }, 201);
}

// Yorum gelen içeriğin sahibine/sahiplerine bildirim düşer: mimar/marka profillerinde onaylı
// profile_claims sahibine; proje/haberlerde gönderiyi yükleyen owner_user_id'ye. Projede ayrıca
// projenin tasarımcısı olan mimar/firma hesaplarına da (project_designers → architects/offices
// .claimed_by_user_id, bkz. migrations/0022_id_first_entities.sql) bildirim gider — gönderiyi
// yükleyen kişi ile projenin künyesindeki mimar/firma FARKLI hesaplar olabilir (bkz. kullanıcı
// isteği: "projenin sahibi olan firma ve mimar kullanıcı kimliklerine bildirim gönder"). Kendi
// yorumuna bildirim gitmez; aynı kullanıcı birden çok rolle eşleşse bile Set ile tekilleştirilir.
async function notifyCommentOwner(env, commenter, targetType, targetId, commentBody) {
  const recipients = new Set();
  let subjectLabel = '';
  if (targetType === 'architect' || targetType === 'office') {
    const row = await env.DB.prepare(
      "SELECT user_id FROM profile_claims WHERE profile_type = ? AND profile_key = ? AND status = 'approved'"
    ).bind(targetType, targetId).first();
    if (row) recipients.add(row.user_id);
    subjectLabel = targetType === 'architect' ? 'mimar profiline' : 'firma profiline';
  } else if (targetType === 'project') {
    const submissionRow = await env.DB.prepare('SELECT owner_user_id FROM project_submissions WHERE slug = ?').bind(targetId).first();
    if (submissionRow) recipients.add(submissionRow.owner_user_id);
    const { results: designerRows } = await env.DB.prepare(
      `SELECT ar.claimed_by_user_id AS arch_uid, ofc.claimed_by_user_id AS office_uid
       FROM project_designers pd
       JOIN projects p ON p.id = pd.project_id
       LEFT JOIN architects ar ON ar.id = pd.architect_id AND ar.deleted_at IS NULL
       LEFT JOIN offices ofc ON ofc.id = pd.office_id AND ofc.deleted_at IS NULL
       WHERE p.slug = ?`
    ).bind(targetId).all();
    for (const d of designerRows) {
      if (d.arch_uid) recipients.add(d.arch_uid);
      if (d.office_uid) recipients.add(d.office_uid);
    }
    subjectLabel = 'projene';
  } else if (targetType === 'news') {
    const row = await env.DB.prepare('SELECT owner_user_id FROM news_submissions WHERE id = ?').bind(targetId).first();
    if (row) recipients.add(row.owner_user_id);
    subjectLabel = 'haberine';
  }
  recipients.delete(commenter.id);
  recipients.delete(null);
  recipients.delete(undefined);
  if (!recipients.size) return;
  const preview = commentBody.length > 120 ? commentBody.slice(0, 117) + '…' : commentBody;
  for (const userId of recipients) {
    await createNotification(
      env, userId, 'comment_received',
      `${commenter.name} ${subjectLabel} yorum yaptı`,
      preview,
      null
    );
  }
}

async function deleteComment(request, env, id) {
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  const comment = await env.DB.prepare(
    'SELECT id, target_type, target_id, user_id FROM comments WHERE id = ?'
  ).bind(id).first();
  if (!comment) return errorJson('Bulunamadı', 404);

  if (!(await canDeleteComment(env, user, comment))) {
    return errorJson('Bu yorumu silme yetkin yok.', 403);
  }

  await env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

// Bir yorumu kim silebilir: yorumun sahibi; admin; kendi gönderdiği (onaylı/onaysız fark etmez)
// bir proje ya da habere gelen yorumlarda, rozet sahibi olmak şartıyla o içeriğin sahibi; ya da
// profile_claims'de o mimar/ofis profili için onaylı sahiplik iddiası olan kullanıcı (bu, rozet
// gerektirmez — ayrı bir hak, bkz. mimar-detay.html/ofis-detay.html "Bu profil bana ait").
async function canDeleteComment(env, user, comment) {
  if (comment.user_id === user.id) return true;
  if (user.role === 'admin') return true;

  if (comment.target_type === 'project' || comment.target_type === 'news') {
    const table = comment.target_type === 'project' ? 'project_submissions' : 'news_submissions';
    const idField = comment.target_type === 'project' ? 'slug' : 'id';
    const row = await env.DB.prepare(
      `SELECT id FROM ${table} WHERE owner_user_id = ? AND ${idField} = ?`
    ).bind(user.id, comment.target_id).first();
    if (!row) return false;
    // 'destekci' herhangi bir hak vermez (bkz. src/routes/badges.js#BADGE_PRICES yorumu) —
    // yalnızca gerçek rozet kademeleri (verified/gold/platinum) yorum silme hakkı doğurur.
    const badge = await getActiveBadge(env, user.id);
    return !!(badge && badge.badge_type !== 'destekci');
  }

  if (comment.target_type === 'architect' || comment.target_type === 'office') {
    const row = await env.DB.prepare(
      "SELECT id FROM profile_claims WHERE user_id = ? AND profile_type = ? AND profile_key = ? AND status = 'approved'"
    ).bind(user.id, comment.target_type, comment.target_id).first();
    return !!row;
  }

  return false;
}
