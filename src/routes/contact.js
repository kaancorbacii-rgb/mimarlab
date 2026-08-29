import { json, errorJson, readJson } from '../lib/http.js';
import { newId } from '../lib/crypto.js';
import { checkRateLimit, clientIp } from '../lib/rateLimit.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_NOTIFY_TO = 'mimarlabcom@gmail.com';

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// src/routes/auth.js#sendPasswordResetEmail ile AYNI RESEND_API_KEY üzerinden gönderim deseni —
// tanımlı değilse (yerel geliştirme) sessizce hiçbir şey yapmaz, mesaj yine de contact_messages'a
// kaydedilmiş olur (bkz. aşağısı). reply_to formu dolduran kişinin adresine ayarlanır ki admin
// doğrudan Yanıtla ile cevap yazabilsin.
async function sendContactNotificationEmail(env, { name, email, message }) {
  if (!env.RESEND_API_KEY) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.RESEND_FROM || 'MİMARLAB <no-reply@mimarlab.com>',
        to: CONTACT_NOTIFY_TO,
        reply_to: email,
        subject: `MİMARLAB İletişim — ${name}`,
        html: `<p><strong>Ad Soyad:</strong> ${escapeHtml(name)}</p><p><strong>E-posta:</strong> ${escapeHtml(email)}</p><p><strong>Mesaj:</strong></p><p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`,
      }),
    });
  } catch (err) {
    console.error('sendContactNotificationEmail failed', err);
  }
}

// POST /api/contact — İletişim sayfasındaki formdan gelen mesajları kaydeder (auth gerektirmez).
// Admin panelinde "Mesajlar" sekmesinden okunur, ayrıca (bkz. kullanıcı isteği) CONTACT_NOTIFY_TO'ya
// bildirim e-postası gönderilir.
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
  if (name.length > 200) return errorJson('Ad soyad çok uzun.');
  if (!EMAIL_RE.test(email)) return errorJson('Geçerli bir e-posta adresi gir.');
  if (!message) return errorJson('Mesaj gerekli.');
  if (message.length > 4000) return errorJson('Mesaj çok uzun.');

  const id = newId();
  await env.DB.prepare(
    'INSERT INTO contact_messages (id, name, email, message, is_read, created_at) VALUES (?, ?, ?, ?, 0, ?)'
  ).bind(id, name, email, message, Date.now()).run();

  await sendContactNotificationEmail(env, { name, email, message });

  return json({ ok: true }, 201);
}
