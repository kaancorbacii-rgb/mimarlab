import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';

// GET /api/notifications/mine — en yeni 50 bildirim.
// PATCH /api/notifications/:id — { is_read: true } ile okundu işaretler.
// DELETE /api/notifications/:id — tek bir bildirimi kalıcı olarak siler (bkz. kullanıcı isteği:
// "Bildirimler ve mesajların yanında X yani silme işareti olsun" — satır-bazlı silme).
// POST /api/notifications/read-all — kullanıcının tüm bildirimlerini okundu yapar.
// POST /api/notifications/delete-all — kullanıcının tüm bildirimlerini kalıcı olarak siler.
export async function handleNotificationsRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "notifications", ...]

  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  if (segments.length === 3 && segments[2] === 'mine' && request.method === 'GET') {
    return listMine(env, user);
  }
  if (segments.length === 3 && segments[2] === 'read-all' && request.method === 'POST') {
    return markAllRead(env, user);
  }
  if (segments.length === 3 && segments[2] === 'delete-all' && request.method === 'POST') {
    return deleteAll(env, user);
  }
  if (segments.length === 3 && segments[2] !== 'mine' && segments[2] !== 'read-all' && segments[2] !== 'delete-all' && request.method === 'PATCH') {
    return markRead(request, env, user, segments[2]);
  }
  if (segments.length === 3 && segments[2] !== 'mine' && segments[2] !== 'read-all' && segments[2] !== 'delete-all' && request.method === 'DELETE') {
    return deleteOne(env, user, segments[2]);
  }
  return errorJson('Bulunamadı', 404);
}

async function listMine(env, user) {
  const { results } = await env.DB.prepare(
    'SELECT id, type, title, body, link, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).bind(user.id).all();
  return json({ items: results });
}

async function markRead(request, env, user, id) {
  const body = await readJson(request);
  const row = await env.DB.prepare('SELECT id FROM notifications WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!row) return errorJson('Bulunamadı', 404);
  await env.DB.prepare('UPDATE notifications SET is_read = ? WHERE id = ?').bind(body.is_read === false ? 0 : 1, id).run();
  return json({ ok: true });
}

async function deleteOne(env, user, id) {
  const row = await env.DB.prepare('SELECT id FROM notifications WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!row) return errorJson('Bulunamadı', 404);
  await env.DB.prepare('DELETE FROM notifications WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

async function markAllRead(env, user) {
  await env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').bind(user.id).run();
  return json({ ok: true });
}

async function deleteAll(env, user) {
  await env.DB.prepare('DELETE FROM notifications WHERE user_id = ?').bind(user.id).run();
  return json({ ok: true });
}
