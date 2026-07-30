import { newId } from './crypto.js';

// Hesabım sayfasındaki "Bildirimler" kutusuna bir satır ekler. type, istemci tarafında ikon/etiket
// seçimi için kullanılabilir (bkz. hesabim.html#NOTIFICATION_TYPE_LABELS); link varsa "Bildirimler"
// listesindeki satır tıklanabilir olur.
export async function createNotification(env, userId, type, title, body, link) {
  const id = newId();
  await env.DB.prepare(
    'INSERT INTO notifications (id, user_id, type, title, body, link, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
  ).bind(id, userId, type, title, body || null, link || null, Date.now()).run();
}
