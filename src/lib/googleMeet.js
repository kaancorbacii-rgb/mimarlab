// Google Calendar API üzerinden Google Meet oluşturma — YALNIZCA sunucu tarafı (Cloudflare Worker).
// Kullanıcı isteği (2026-09-08): "Güvenli Görüşme Gateway'i". Çağıran taraf src/lib/consultationMeet.js
// (idempotency, D1 yazımı, bildirim orada); bu dosya SADECE Google ile konuşur.
//
// KİMLİK: Google servis hesabı (Service Account) — JWT (RS256) ile OAuth2 erişim belirteci alınır
// (https://developers.google.com/identity/protocols/oauth2/service-account). Yeni bir npm
// bağımlılığı YOK (bu repo'nun hiç npm bağımlılığı yok, bkz. wrangler.jsonc#ai yorumu): imza Web
// Crypto (crypto.subtle) ile atılır, iyzico/oauth.js ile AYNI tarz.
//
// SECRET'LAR (`wrangler secret put` ile, bkz. wrangler.jsonc#vars yorumu):
//   GOOGLE_CLIENT_EMAIL   — servis hesabının e-postası (…@….iam.gserviceaccount.com)
//   GOOGLE_PRIVATE_KEY    — servis hesabı JSON'undaki private_key (PEM, PKCS#8). Satır sonları
//                           gerçek "\n" ya da kaçışlı "\\n" olabilir; ikisi de kabul edilir.
//   GOOGLE_CALENDAR_ID    — etkinliklerin yazılacağı takvim (servis hesabına "Etkinlikleri
//                           değiştirme" yetkisiyle paylaşılmış olmalı). "primary" YALNIZCA
//                           impersonation ile anlamlıdır.
//   GOOGLE_IMPERSONATE_USER (opsiyonel) — Workspace alan-geneli yetkilendirme (domain-wide
//                           delegation) ile taklit edilecek kullanıcı. Google, Meet konferansını
//                           SADECE gerçek bir kullanıcı adına oluşturur; çıplak bir servis hesabı
//                           conferenceData.createRequest gönderdiğinde çoğu kurulumda "Invalid
//                           conference type value" döner. Bu yüzden Workspace hesabı olan
//                           kurulumlarda bu değer ŞARTTIR; verilirse JWT'ye `sub` olarak girer.
//
// GÜVENLİK: bu dosyadaki hiçbir değer (private key, erişim belirteci, Authorization başlığı)
// loglanmaz, hata mesajına yazılmaz, yanıtla dışarı çıkmaz. Hatalar safeErrorMessage ile
// KISALTILIP TEMİZLENEREK döner (bkz. aşağısı) — meet_error kolonuna yazılan da odur.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
// Google'a giden her çağrı için duvar-saati sınırı — Worker'ı (ve admin onay isteğini) asılı
// bırakmamak için (bkz. kullanıcı isteği: "Worker execution limitlerini dikkate al").
const FETCH_TIMEOUT_MS = 12000;

export const MEET_REQUIRED_SECRETS = ['GOOGLE_CLIENT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_CALENDAR_ID'];

export function missingMeetSecrets(env) {
  return MEET_REQUIRED_SECRETS.filter((k) => !(env && typeof env[k] === 'string' && env[k].trim()));
}

export function isGoogleMeetConfigured(env) {
  return missingMeetSecrets(env).length === 0;
}

// ---- yardımcılar --------------------------------------------------------------------------------

function base64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlJson(obj) {
  return base64Url(new TextEncoder().encode(JSON.stringify(obj)));
}

function pemToDer(pem) {
  const normalized = String(pem).replace(/\\n/g, '\n');
  const body = normalized
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Hata metni: uzun/opak dizeler (belirteç, anahtar, JWT parçaları) tamamen çıkarılır, e-posta
// adresleri maskelenir, 240 karakterle sınırlanır. Google'ın kendi hata mesajı ("Invalid conference
// type value" gibi) korunur — teşhis için gereken tam olarak odur.
export function safeErrorMessage(err, prefix) {
  let msg = err && err.message ? String(err.message) : String(err || 'unknown');
  msg = msg
    .replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, '[key]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9_\-.]{48,}/g, '[redacted]')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\s+/g, ' ')
    .trim();
  const out = prefix ? `${prefix}: ${msg}` : msg;
  return out.slice(0, 240);
}

async function fetchWithTimeout(fetchImpl, url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---- OAuth2 servis hesabı belirteci --------------------------------------------------------------

// Isolate-içi kısa ömürlü önbellek: aynı Worker isolate'i içinde art arda gelen çağrılar (ör. cron
// yeniden deneme turu) her seferinde JWT imzalayıp token ucuna gitmesin. Belirtecin kendisi
// asla D1/KV'ye yazılmaz.
let cachedToken = null; // { value, expiresAt }

export async function getServiceAccountToken(env, { fetchImpl = fetch, now = Date.now } = {}) {
  const missing = missingMeetSecrets(env);
  if (missing.length) throw new Error(`config_missing: ${missing.join(', ')}`);

  const nowMs = now();
  if (cachedToken && cachedToken.expiresAt - 60_000 > nowMs && cachedToken.email === env.GOOGLE_CLIENT_EMAIL) {
    return cachedToken.value;
  }

  const iat = Math.floor(nowMs / 1000);
  const claims = {
    iss: env.GOOGLE_CLIENT_EMAIL.trim(),
    scope: SCOPE,
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600,
  };
  const impersonate = typeof env.GOOGLE_IMPERSONATE_USER === 'string' ? env.GOOGLE_IMPERSONATE_USER.trim() : '';
  if (impersonate) claims.sub = impersonate;

  let key;
  try {
    key = await crypto.subtle.importKey(
      'pkcs8', pemToDer(env.GOOGLE_PRIVATE_KEY),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
    );
  } catch (err) {
    // Anahtarın kendisi HİÇBİR ZAMAN mesaja girmez — yalnızca "biçim bozuk" bilgisi.
    throw new Error('config_invalid: GOOGLE_PRIVATE_KEY PKCS#8 PEM olarak ayrıştırılamadı');
  }
  const signingInput = `${base64UrlJson({ alg: 'RS256', typ: 'JWT' })}.${base64UrlJson(claims)}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const assertion = `${signingInput}.${base64Url(new Uint8Array(signature))}`;

  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion });
  const res = await fetchWithTimeout(fetchImpl, TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const detail = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(`google_token_error: ${detail}`);
  }
  cachedToken = {
    value: data.access_token,
    email: env.GOOGLE_CLIENT_EMAIL,
    expiresAt: nowMs + (Number(data.expires_in) || 3600) * 1000,
  };
  return cachedToken.value;
}

// Testler için: önbelleği sıfırla (fake fetch'ler arasında sızıntı olmasın).
export function _resetTokenCacheForTests() { cachedToken = null; }

// ---- Takvim etkinliği + Meet ---------------------------------------------------------------------

function extractMeetLink(event) {
  if (!event) return null;
  if (typeof event.hangoutLink === 'string' && event.hangoutLink) return event.hangoutLink;
  const entries = event.conferenceData && Array.isArray(event.conferenceData.entryPoints) ? event.conferenceData.entryPoints : [];
  const video = entries.find((e) => e && e.entryPointType === 'video' && typeof e.uri === 'string');
  return video ? video.uri : null;
}

async function googleJson(fetchImpl, token, url, init) {
  const res = await fetchWithTimeout(fetchImpl, url, {
    ...init,
    headers: { ...(init && init.headers), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data && data.error && (data.error.message || data.error.status)) || `HTTP ${res.status}`;
    const err = new Error(`google_http_${res.status}: ${detail}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Bir Meet'li takvim etkinliği oluşturur ve { eventId, meetLink } döner.
//   startIso / endIso : yerel duvar saati ("2026-09-14T20:00:00"), timeZone ile birlikte yorumlanır
//   requestId         : Google'ın kendi idempotency anahtarı — AYNI requestId ile ikinci istek
//                       yeni konferans ÜRETMEZ (bkz. conferenceData.createRequest.requestId).
export async function createMeetEvent(env, {
  summary, description, startIso, endIso, timeZone, requestId, privateProps,
}, { fetchImpl = fetch, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const token = await getServiceAccountToken(env, { fetchImpl, now });
  const calendarId = encodeURIComponent(env.GOOGLE_CALENDAR_ID.trim());
  const base = `${CALENDAR_API}/calendars/${calendarId}/events`;

  const payload = {
    summary,
    description,
    start: { dateTime: startIso, timeZone },
    end: { dateTime: endIso, timeZone },
    conferenceData: {
      createRequest: { requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } },
    },
    reminders: { useDefault: false },
    guestsCanInviteOthers: false,
    guestsCanSeeOtherGuests: false,
  };
  if (privateProps) payload.extendedProperties = { private: privateProps };

  // conferenceDataVersion=1 ŞART — aksi halde Google conferenceData alanını sessizce yok sayar.
  let event = await googleJson(fetchImpl, token, `${base}?conferenceDataVersion=1&sendUpdates=none`, {
    method: 'POST', body: JSON.stringify(payload),
  });

  let meetLink = extractMeetLink(event);
  // Konferans oluşturma asenkron olabilir (createRequest.status.statusCode = "pending"): bir kez
  // kısa bekleyip etkinliği yeniden okuruz. Hâlâ yoksa çağıran taraf 'failed' yazar ve daha sonra
  // yeniden dener (aynı requestId ile — Google ikinci konferans üretmez).
  if (!meetLink && event && event.id) {
    await sleep(1500);
    event = await googleJson(fetchImpl, token, `${base}/${encodeURIComponent(event.id)}?conferenceDataVersion=1`, { method: 'GET' });
    meetLink = extractMeetLink(event);
  }
  if (!event || !event.id) throw new Error('google_event_missing: etkinlik kimliği dönmedi');
  if (!meetLink) {
    const status = event.conferenceData && event.conferenceData.createRequest && event.conferenceData.createRequest.status;
    throw new Error(`meet_link_missing: konferans durumu ${status && status.statusCode ? status.statusCode : 'bilinmiyor'}`);
  }
  return { eventId: event.id, meetLink };
}
