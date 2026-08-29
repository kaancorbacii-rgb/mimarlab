import { json, errorJson, readJson } from '../lib/http.js';
import { newId, randomToken } from '../lib/crypto.js';
import { checkRateLimit, clientIp } from '../lib/rateLimit.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function unsubscribePage(message) {
  return `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MİMARLAB — Bülten</title>
<style>body{margin:0;background:#EDF0F3;color:#1B2A3D;font-family:'Instrument Sans', sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px;box-sizing:border-box;}
.box{max-width:420px;}h1{font-size:20px;margin:0 0 12px;}p{font-size:14.5px;color:#4E6478;line-height:1.6;}
a{color:#5B7A9B;font-weight:600;text-decoration:none;}</style></head>
<body><div class="box"><h1>MİMARLAB Bülten</h1><p>${message}</p><p><a href="/">Ana sayfaya dön →</a></p></div></body></html>`;
}

// POST /api/newsletter/subscribe — footer'daki bülten formu (bkz. js/components/site-chrome.js#
// wireFooterNewsletter, kullanıcı isteği: "Sitede bültene abonel ol özelliği getirelim"). Tek adımlı
// opt-in — çift onay maili YOK, form gönderilince direkt kaydolur. auth gerektirmez.
//
// Yeni proje/ürün/mimar/firma yayına girdiğinde src/lib/newsletterNotify.js abone listesine mail
// gönderir (bkz. o dosya + src/routes/submissions.js/admin.js'teki çağrı noktaları).
export async function handleNewsletterRoute(request, env, url) {
  if (url.pathname === '/api/newsletter/subscribe' && request.method === 'POST') {
    if (!(await checkRateLimit(env, 'newsletter_subscribe', clientIp(request), 8, 60 * 60 * 1000))) {
      return errorJson('Çok fazla deneme yaptın. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
    }

    const body = await readJson(request);
    const email = (body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return errorJson('Geçerli bir e-posta adresi gir.');
    if (email.length > 320) return errorJson('Geçerli bir e-posta adresi gir.');

    // E-posta zaten kayıtlıysa (aboneyken tekrar formu doldurdu ya da daha önce abonelikten
    // çıkmıştı) sessizce başarı döner — abone olup olmadığını numaralandırmaya (enumeration) izin
    // vermemek için hem yeni kayıt hem "zaten abone" aynı { ok: true } cevabını verir.
    const existing = await env.DB.prepare('SELECT id, unsubscribed_at FROM newsletter_subscribers WHERE email = ?').bind(email).first();
    if (existing) {
      if (existing.unsubscribed_at) {
        await env.DB.prepare('UPDATE newsletter_subscribers SET unsubscribed_at = NULL WHERE id = ?').bind(existing.id).run();
      }
      return json({ ok: true });
    }

    await env.DB.prepare(
      'INSERT INTO newsletter_subscribers (id, email, unsubscribe_token, created_at) VALUES (?, ?, ?, ?)'
    ).bind(newId(), email, randomToken(), Date.now()).run();

    return json({ ok: true }, 201);
  }

  // GET /api/newsletter/unsubscribe?token=... — abonelik mailinin altındaki linkten tıklanır (bkz.
  // src/lib/newsletterNotify.js), bu yüzden JSON değil doğrudan basit bir onay sayfası döner.
  if (url.pathname === '/api/newsletter/unsubscribe' && request.method === 'GET') {
    const token = url.searchParams.get('token') || '';
    if (token) {
      await env.DB.prepare(
        'UPDATE newsletter_subscribers SET unsubscribed_at = ? WHERE unsubscribe_token = ? AND unsubscribed_at IS NULL'
      ).bind(Date.now(), token).run();
    }
    return new Response(unsubscribePage('Abonelikten çıktın. Dilediğin zaman footer\'daki formdan tekrar abone olabilirsin.'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  return errorJson('Bulunamadı', 404);
}
