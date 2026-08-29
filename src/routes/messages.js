import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { createNotification } from '../lib/notify.js';

// Kullanıcı isteği: doğrulanmış mimar/firma profillerine kullanıcıların mesaj gönderebilmesi —
// mimar için tek alıcı (o profili claim eden onaylı kullanıcı), firma için BİRDEN FAZLA alıcı
// (kurucu/kurucu ortak/ortak/ekip lideri) olabilir. src/lib/projectClaimAccess.js#
// OFFICE_EDIT_POSITIONS İLE BİREBİR AYNI küme — firma profilini düzenleyebilen pozisyonlarla
// firmaya gelen mesajları görebilen pozisyonlar kasıtlı olarak eşleşir.
const PROFILE_TYPES = new Set(['architect', 'office']);
const OFFICE_MESSAGE_POSITIONS = new Set(['Kurucu', 'Kurucu Ortak', 'Ortak', 'Ekip Lideri']);
const MAX_BODY_LEN = 4000;

export async function handleMessagesRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "messages", ...]

  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  if (segments.length === 3 && segments[2] === 'threads' && request.method === 'POST') {
    return createThread(request, env, user);
  }
  if (segments.length === 4 && segments[2] === 'threads' && request.method === 'GET') {
    return getThread(env, user, segments[3]);
  }
  if (segments.length === 5 && segments[2] === 'threads' && segments[4] === 'reply' && request.method === 'POST') {
    return replyThread(request, env, user, segments[3]);
  }
  if (segments.length === 5 && segments[2] === 'threads' && segments[4] === 'close' && request.method === 'POST') {
    return closeThread(env, user, segments[3]);
  }
  return errorJson('Bulunamadı', 404);
}

// Bir mimar/firma profiline mesaj gönderebilecek kullanıcılar — profile_claims'teki (bkz.
// schema.sql) ONAYLI sahiplik kayıtları. Gönderenin kendisi (zaten claim sahibiyse) hariç tutulur —
// kendine mesaj göndermenin anlamı yok.
async function resolveRecipients(env, profileType, profileKey, excludeUserId) {
  if (profileType === 'architect') {
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT user_id FROM profile_claims WHERE profile_type = 'architect' AND profile_key = ? AND status = 'approved'`
    ).bind(profileKey).all();
    return results.map(r => r.user_id).filter(id => id !== excludeUserId);
  }
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT user_id, office_position FROM profile_claims WHERE profile_type = 'office' AND profile_key = ? AND status = 'approved'`
  ).bind(profileKey).all();
  return results.filter(r => OFFICE_MESSAGE_POSITIONS.has(r.office_position)).map(r => r.user_id).filter(id => id !== excludeUserId);
}

async function createThread(request, env, user) {
  // saved.js/follows.js#createSaved,createFollow İLE AYNI cömert üst sınır gerekçesi — ucuz/sık
  // kullanılan bir eylem, asıl kötüye kullanım engeli aşağıdaki 'message-send' sınırı.
  if (!(await checkRateLimit(env, 'message-thread', user.id, 20, 60 * 60 * 1000))) {
    return errorJson('Çok fazla mesaj gönderdin. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }

  const body = await readJson(request);
  const profileType = body.profileType;
  const profileKey = (body.profileKey || '').trim();
  const description = (body.description || '').trim();
  const senderName = (body.name || '').trim();
  const senderEmail = (body.email || '').trim();
  const senderCity = (body.city || '').trim();
  const senderCompany = (body.company || '').trim();
  const senderPhone = (body.phone || '').trim();

  if (!PROFILE_TYPES.has(profileType) || !profileKey) return errorJson('Geçersiz istek.');
  if (!description || description.length > MAX_BODY_LEN) return errorJson('Mesaj metni boş olamaz.');
  if (!senderName || !senderEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) {
    return errorJson('Ad Soyad ve geçerli bir e-posta adresi gerekli.');
  }

  const recipients = await resolveRecipients(env, profileType, profileKey, user.id);
  if (!recipients.length) return errorJson('Bu profile şu anda mesaj gönderilemiyor.', 400);

  const now = Date.now();
  const threadId = newId();
  await env.DB.prepare(
    `INSERT INTO message_threads (id, profile_type, profile_key, sender_user_id, sender_name, sender_email, sender_city, sender_company, sender_phone, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
  ).bind(threadId, profileType, profileKey, user.id, senderName.slice(0, 200), senderEmail.slice(0, 200),
    senderCity.slice(0, 200) || null, senderCompany.slice(0, 200) || null, senderPhone.slice(0, 60) || null, now, now).run();

  const messageId = newId();
  await env.DB.prepare(
    `INSERT INTO messages (id, thread_id, sender_user_id, body, created_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(messageId, threadId, user.id, description, now).run();

  for (const recipientId of recipients) {
    await env.DB.prepare(
      `INSERT INTO message_thread_recipients (thread_id, user_id) VALUES (?, ?)`
    ).bind(threadId, recipientId).run();
  }

  const preview = description.length > 140 ? description.slice(0, 140) + '…' : description;
  for (const recipientId of recipients) {
    await createNotification(env, recipientId, 'message', '1 Yeni Mesaj', `${senderName}: ${preview}`, `msg:${threadId}`);
  }

  return json({ id: threadId }, 201);
}

async function assertParticipant(env, threadId, userId) {
  const thread = await env.DB.prepare('SELECT * FROM message_threads WHERE id = ?').bind(threadId).first();
  if (!thread) return { thread: null };
  if (thread.sender_user_id === userId) return { thread, isParticipant: true };
  const recipient = await env.DB.prepare(
    'SELECT 1 FROM message_thread_recipients WHERE thread_id = ? AND user_id = ?'
  ).bind(threadId, userId).first();
  return { thread, isParticipant: !!recipient };
}

async function getThread(env, user, threadId) {
  const { thread, isParticipant } = await assertParticipant(env, threadId, user.id);
  if (!thread) return errorJson('Bulunamadı', 404);
  if (!isParticipant) return errorJson('Bu konuşmaya erişimin yok.', 403);

  const { results: messageRows } = await env.DB.prepare(
    `SELECT m.id, m.sender_user_id, m.body, m.created_at, u.name AS sender_display_name
     FROM messages m JOIN users u ON u.id = m.sender_user_id
     WHERE m.thread_id = ? ORDER BY m.created_at ASC`
  ).bind(threadId).all();

  return json({
    id: thread.id,
    profileType: thread.profile_type,
    profileKey: thread.profile_key,
    status: thread.status,
    isSender: thread.sender_user_id === user.id,
    sender: {
      name: thread.sender_name,
      email: thread.sender_email,
      city: thread.sender_city,
      company: thread.sender_company,
      phone: thread.sender_phone,
    },
    messages: messageRows.map(m => ({
      id: m.id,
      body: m.body,
      createdAt: m.created_at,
      senderName: m.sender_display_name,
      isMe: m.sender_user_id === user.id,
    })),
  });
}

async function replyThread(request, env, user, threadId) {
  if (!(await checkRateLimit(env, 'message-reply', user.id, 60, 60 * 60 * 1000))) {
    return errorJson('Çok fazla mesaj gönderdin. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }
  const { thread, isParticipant } = await assertParticipant(env, threadId, user.id);
  if (!thread) return errorJson('Bulunamadı', 404);
  if (!isParticipant) return errorJson('Bu konuşmaya erişimin yok.', 403);
  if (thread.status === 'closed') return errorJson('Bu görüşme sonlandırılmış.', 400);

  const body = await readJson(request);
  const text = (body.body || '').trim();
  if (!text || text.length > MAX_BODY_LEN) return errorJson('Mesaj metni boş olamaz.');

  const now = Date.now();
  const messageId = newId();
  await env.DB.prepare(
    `INSERT INTO messages (id, thread_id, sender_user_id, body, created_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(messageId, threadId, user.id, text, now).run();
  await env.DB.prepare('UPDATE message_threads SET updated_at = ? WHERE id = ?').bind(now, threadId).run();

  const { results: recipientRows } = await env.DB.prepare(
    'SELECT user_id FROM message_thread_recipients WHERE thread_id = ?'
  ).bind(threadId).all();
  const otherPartyIds = new Set([thread.sender_user_id, ...recipientRows.map(r => r.user_id)]);
  otherPartyIds.delete(user.id);

  const preview = text.length > 140 ? text.slice(0, 140) + '…' : text;
  for (const recipientId of otherPartyIds) {
    await createNotification(env, recipientId, 'message', '1 Yeni Mesaj', `${user.name}: ${preview}`, `msg:${threadId}`);
  }

  return json({ ok: true }, 201);
}

async function closeThread(env, user, threadId) {
  const { thread, isParticipant } = await assertParticipant(env, threadId, user.id);
  if (!thread) return errorJson('Bulunamadı', 404);
  if (!isParticipant) return errorJson('Bu konuşmaya erişimin yok.', 403);
  await env.DB.prepare(`UPDATE message_threads SET status = 'closed', updated_at = ? WHERE id = ?`).bind(Date.now(), threadId).run();
  return json({ ok: true });
}
