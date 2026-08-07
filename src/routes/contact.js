import { json, errorJson, readJson } from '../lib/http.js';
import { newId } from '../lib/crypto.js';
import { checkRateLimit, clientIp } from '../lib/rateLimit.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/contact — İletişim sayfasındaki formdan gelen mesajları kaydeder (auth gerektirmez).
// Admin panelinde "Mesajlar" sekmesinden okunur.
export async function handleContactRoute(request, env, url) {
  if (url.pathname !== '/api/contact' || request.method !== 'POST') return errorJson('Bulunamadı', 404);

  if (!(await checkRateLimit(env, 'contact', clientIp(request), 8, 60 * 60 * 1000))) {
    return errorJson('Çok fazla mesaj gönderdin. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }

  const body = await readJson(request);
  const name = (body.name || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const message = (body.message || '').trim();

  if (!name) return errorJson('Ad soyad gerekli.');
  if (!EMAIL_RE.test(email)) return errorJson('Geçerli bir e-posta adresi gir.');
  if (!message) return errorJson('Mesaj gerekli.');
  if (message.length > 4000) return errorJson('Mesaj çok uzun.');

  const id = newId();
  await env.DB.prepare(
    'INSERT INTO contact_messages (id, name, email, message, is_read, created_at) VALUES (?, ?, ?, ?, 0, ?)'
  ).bind(id, name, email, message, Date.now()).run();

  return json({ ok: true }, 201);
}
