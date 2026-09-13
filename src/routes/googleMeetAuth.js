// GOOGLE MEET — TEK SEFERLİK OAuth KURULUM AKIŞI (kullanıcı kararı, 2026-09-13).
//
// NEDEN VAR: mimarlab kişisel bir Gmail hesabıyla yönetiliyor. Servis hesabı yolu Meet konferansı
// ÜRETEMEZ (Google "Invalid conference type value" döner) ve bunu aşan domain-wide delegation
// YALNIZCA Workspace'te vardır. Bu yüzden Meet odaları artık gerçek bir kullanıcının yetkisiyle
// açılır (bkz. src/lib/googleMeet.js#meetAuthMode 'oauth').
//
// BU AKIŞ YALNIZCA REFRESH TOKEN'I ÜRETİR, SAKLAMAZ. Token admin'e BİR KEZ gösterilir; admin onu
// `wrangler secret put GOOGLE_REFRESH_TOKEN` ile Cloudflare sırrı olarak tanımlar. D1'e YAZILMAZ:
// bu depodaki kural, kimlik bilgisinin veritabanında değil sırlarda durmasıdır (bkz.
// src/lib/bankTransfer.js ve src/lib/googleMeet.js dosya başı gerekçeleri) — D1'e yazsaydık
// yedeklerde, ekstrelerde ve her admin sorgusunda dolaşan kalıcı bir kimlik bilgisi olurdu.
//
// YETKİ: bu iki uç /api/admin/ altındadır, yani handleAdminRoute'un requireAdmin kapısından
// GEÇMİŞ olarak çağrılır. Google'dan dönüş üst seviye bir GET navigasyonudur ve oturum çerezi
// SameSite=Lax olduğundan callback'te de admin kimliği kurulur (bkz. src/lib/http.js).
import { errorJson, json } from '../lib/http.js';
import { signState, verifyState } from '../lib/oauth.js';
import { meetAuthMode, missingMeetSecrets, meetCalendarId, MEET_OAUTH_SECRETS } from '../lib/googleMeet.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
// googleMeet.js#SCOPE İLE AYNI olmalı: burada onaylanmayan bir kapsam orada 403 olarak döner.
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const STATE_PROVIDER = 'google-meet-setup';

function redirectUri(request) {
  return `${new URL(request.url).origin}/api/admin/google-meet/callback`;
}

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Kurulum sayfası/JSON'u da dahil, bu uçların HİÇBİR yanıtı önbelleğe alınmamalı.
const NO_STORE = { 'Cache-Control': 'no-store' };

function page(title, bodyHtml, status = 200) {
  return new Response(
    `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} — MİMARLAB</title>
<style>
  body{margin:0; padding:32px 20px; background:#F4F5F7; color:#1B2A3D; font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
  .wrap{max-width:680px; margin:0 auto; background:#fff; border-radius:14px; padding:28px 26px; box-shadow:0 10px 30px rgba(0,0,0,0.08);}
  h1{font-size:20px; margin:0 0 14px;}
  code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
  pre{background:#1B2A3D; color:#F4F5F7; padding:14px 16px; border-radius:10px; overflow-x:auto; font-size:12.5px; white-space:pre-wrap; word-break:break-all;}
  ol{padding-left:20px;} li{margin-bottom:8px;}
  .warn{background:rgba(224,138,62,0.12); border:1px solid #E08A3E; border-radius:10px; padding:12px 14px; font-size:13.5px; margin:16px 0;}
  a{color:#1B2A3D;}
</style></head><body><div class="wrap">${bodyHtml}</div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_STORE } },
  );
}

export async function handleGoogleMeetAuthAdmin(request, env, url, segments) {
  // GET /api/admin/google-meet — kurulum durumu + yetkilendirme bağlantısı (admin paneli okur).
  if (segments.length === 3 && request.method === 'GET') {
    const mode = meetAuthMode(env);
    const canStart = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
    let authorizeUrl = null;
    if (canStart) {
      const state = await signState(env.GOOGLE_CLIENT_SECRET, STATE_PROVIDER, '');
      const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID.trim(),
        redirect_uri: redirectUri(request),
        response_type: 'code',
        scope: SCOPE,
        // access_type=offline + prompt=consent: refresh_token'ı GOOGLE YALNIZCA bu ikisiyle döner.
        // prompt=consent olmadan, daha önce onay verilmiş bir hesapta refresh_token GELMEZ ve
        // akış sessizce yarım kalır (klasik tuzak).
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'false',
        state,
      });
      authorizeUrl = `${AUTH_URL}?${params.toString()}`;
    }
    return json({
      mode,                                   // 'oauth' | 'service_account' | null
      missing: missingMeetSecrets(env),
      calendarId: meetCalendarId(env) || null,
      oauthSecrets: MEET_OAUTH_SECRETS,
      redirectUri: redirectUri(request),      // Google Console'a birebir bu yazılmalı
      canStart,
      authorizeUrl,
    }, 200, NO_STORE);
  }

  // GET /api/admin/google-meet/callback — Google'ın onay sonrası döndüğü adres.
  if (segments.length === 4 && segments[3] === 'callback' && request.method === 'GET') {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      return page('Kurulum', '<h1>Eksik yapılandırma</h1><p>GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET tanımlı değil.</p>', 503);
    }
    const err = url.searchParams.get('error');
    if (err) {
      return page('Yetkilendirme iptal edildi', `<h1>Yetkilendirme tamamlanmadı</h1><p>Google şu yanıtı döndü: <code>${esc(err)}</code></p><p>Yeniden denemek için admin panelindeki bağlantıyı tekrar kullan.</p>`, 400);
    }
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code) return page('Yetkilendirme', '<h1>Kod gelmedi</h1><p>Akışı baştan başlat.</p>', 400);
    if (!(await verifyState(env.GOOGLE_CLIENT_SECRET, STATE_PROVIDER, state))) {
      return page('Yetkilendirme', '<h1>Geçersiz ya da süresi dolmuş istek</h1><p>Akışı baştan başlat (state doğrulanamadı).</p>', 400);
    }

    let data;
    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID.trim(),
          client_secret: env.GOOGLE_CLIENT_SECRET.trim(),
          redirect_uri: redirectUri(request),
          grant_type: 'authorization_code',
        }).toString(),
      });
      data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data.error_description || data.error || `HTTP ${res.status}`;
        return page('Yetkilendirme', `<h1>Belirteç alınamadı</h1><p>Google: <code>${esc(detail)}</code></p>`, 502);
      }
    } catch {
      return page('Yetkilendirme', '<h1>Google\'a ulaşılamadı</h1><p>Lütfen tekrar dene.</p>', 502);
    }

    if (!data.refresh_token) {
      // En sık sebep: bu hesap uygulamaya DAHA ÖNCE onay vermiş ve Google refresh_token'ı yalnızca
      // İLK onayda döndürüyor. prompt=consent bunu zorlar; yine de gelmediyse hesabın erişim
      // izinlerini kaldırmak gerekir.
      return page('Yetkilendirme', `<h1>refresh_token dönmedi</h1>
        <p>Google bu onayda kalıcı bir yenileme belirteci vermedi. Bu neredeyse her zaman, bu Google hesabının uygulamaya <strong>daha önce</strong> onay vermiş olmasından kaynaklanır.</p>
        <ol>
          <li><a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">Google Hesabı → Üçüncü taraf erişimi</a> sayfasından bu uygulamanın erişimini kaldır.</li>
          <li>Admin panelindeki yetkilendirme bağlantısını tekrar kullan.</li>
        </ol>`, 400);
    }

    return page('Google Meet yetkilendirildi', `<h1>Yenileme belirteci hazır</h1>
      <p>Bu değer <strong>kaydedilmedi</strong> — yalnızca burada, bir kez gösteriliyor. Aşağıdaki komutu yerel makinende çalıştırıp Cloudflare sırrı olarak tanımla:</p>
      <pre>npx wrangler secret put GOOGLE_REFRESH_TOKEN</pre>
      <p>İstendiğinde yapıştırılacak değer:</p>
      <pre>${esc(data.refresh_token)}</pre>
      <div class="warn"><strong>Bu sayfayı kimseyle paylaşma.</strong> Bu belirteç, yetkilendirdiğin Google hesabının takvimine etkinlik açma yetkisi verir. Yanlışlıkla paylaşılırsa Google Hesabı → Üçüncü taraf erişimi sayfasından erişimi kaldır ve akışı tekrarla.</div>
      <p>Sır tanımlandıktan sonra deploy et; ardından admin panelindeki <em>“Meet Oluştur (yeniden dene)”</em> düğmesiyle bekleyen randevuların odası oluşturulur (cron da kendiliğinden yeniden dener).</p>
      <div class="warn">OAuth onay ekranın <strong>“Testing”</strong> durumundaysa Google bu belirteci <strong>7 günde</strong> geçersiz kılar. Kalıcı olması için onay ekranını <strong>“In production”</strong> durumuna al.</div>`);
  }

  return errorJson('Bulunamadı', 404);
}
