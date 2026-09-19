import { errorJson } from '../lib/http.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function unsubscribePage(message) {
  return `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MİMARLAB — Bülten</title>
<style>body{margin:0;background:#EDF0F3;color:#1B2A3D;font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px;box-sizing:border-box;}
.box{max-width:420px;}h1{font-size:20px;margin:0 0 12px;}p{font-size:14.5px;color:#4E6478;line-height:1.6;}
a{color:#5B7A9B;font-weight:600;text-decoration:none;}</style></head>
<body><div class="box"><h1>MİMARLAB Bülten</h1><p>${message}</p><p><a href="/">Ana sayfaya dön →</a></p></div></body></html>`;
}

// POST /api/newsletter/subscribe — footer'daki bülten formu (bkz. js/components/site-chrome.js#
// wireFooterNewsletter, kullanıcı isteği: "Sitede bültene abonel ol özelliği getirelim"). Tek adımlı
// opt-in — çift onay maili YOK, form gönderilince direkt kaydolur. auth gerektirmez.
//
// Yeni proje/ürün yayına girdiğinde ve yeni bir gündem gönderisi yayımlandığında
// src/lib/newsletterNotify.js abone listesine mail gönderir (bkz. o dosya + src/routes/
// submissions.js/admin.js + src/lib/gundemIngest.js/src/routes/gundemAdmin.js'teki çağrı
// noktaları). Kişi/firma/marka BİLEREK kapsam dışı (kullanıcı isteği, 2026-09-12 madde 2).
export async function handleNewsletterRoute(request, env, url) {
  // ABONELİK KAPALI (2026-09-19, kullanıcı isteği: "Bülteni iptal et"): footer'daki form kaldırıldı,
  // gönderim src/lib/newsletterNotify.js#NEWSLETTER_ENABLED ile kapalı. Eski sayfa kopyaları için 410.
  // Abonelikten ÇIKMA ucu aşağıda DURUYOR — daha önce gönderilmiş maillerdeki bağlantılar çalışsın.
  if (url.pathname === '/api/newsletter/subscribe') return errorJson('Bülten aboneliği kapatıldı.', 410);
  // GET /api/newsletter/unsubscribe?token=... — abonelik mailinin altındaki linkten tıklanır (bkz.
  // src/lib/newsletterNotify.js), bu yüzden JSON değil doğrudan basit bir onay sayfası döner.
  if (url.pathname === '/api/newsletter/unsubscribe' && request.method === 'GET') {
    const token = url.searchParams.get('token') || '';
    if (token) {
      await env.DB.prepare(
        'UPDATE newsletter_subscribers SET unsubscribed_at = ? WHERE unsubscribe_token = ? AND unsubscribed_at IS NULL'
      ).bind(Date.now(), token).run();
    }
    return new Response(unsubscribePage('Abonelikten çıktın.'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  return errorJson('Bulunamadı', 404);
}
