import { hmacSha256Hex } from './crypto.js';

// Google / LinkedIn Sosyal Giriş (bkz. kullanıcı isteği) — mevcut kimlik doğrulama altyapısına
// (bkz. src/lib/auth.js#createSession, D1 `sessions` tablosu, mimarlab_session çerezi) dokunmadan
// eklenen bir OAuth Authorization Code akışı. iyzico entegrasyonuyla (bkz. src/lib/iyzico.js) AYNI
// desen: bir `isXConfigured(env)` bekçisi, secret'lar yalnızca `wrangler secret put` ile tanımlanır
// (bkz. wrangler.jsonc'daki IYZICO_* yorumu), burada asla sabit yazılmaz.
//
// State (CSRF) koruması: sunucu tarafında hiçbir ek depolama (KV/DB) GEREKMEZ — state,
// HMAC-SHA256 ile imzalı, kısa ömürlü (10 dk) bir zaman damgası + `next` yönlendirme hedefi taşır;
// imza her sağlayıcının KENDİ client secret'ıyla atılır (yalnızca sunucu bilir), callback'te aynı
// secret'la yeniden hesaplanıp karşılaştırılır (bkz. verifyState).
const STATE_TTL_MS = 10 * 60 * 1000;

export function isGoogleConfigured(env) {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function isLinkedInConfigured(env) {
  return !!(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET);
}

function b64urlEncode(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  return decodeURIComponent(escape(atob(padded)));
}

async function signState(secret, provider, next) {
  const payload = JSON.stringify({ ts: Date.now(), next: next || '', nonce: crypto.randomUUID() });
  const encoded = b64urlEncode(payload);
  const sig = await hmacSha256Hex(secret, `${provider}.${encoded}`);
  return `${encoded}.${sig}`;
}

async function verifyState(secret, provider, state) {
  if (!state || !state.includes('.')) return null;
  const [encoded, sig] = state.split('.');
  const expectedSig = await hmacSha256Hex(secret, `${provider}.${encoded}`);
  if (sig !== expectedSig) return null;
  let payload;
  try { payload = JSON.parse(b64urlDecode(encoded)); } catch { return null; }
  if (!payload.ts || Date.now() - payload.ts > STATE_TTL_MS) return null;
  return payload;
}

function redirectUriFor(request, provider) {
  return `${new URL(request.url).origin}/api/auth/${provider}/callback`;
}

export async function buildGoogleAuthUrl(request, env, next) {
  const state = await signState(env.GOOGLE_CLIENT_SECRET, 'google', next);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUriFor(request, 'google'),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function handleGoogleCallback(request, env, url) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const payload = await verifyState(env.GOOGLE_CLIENT_SECRET, 'google', state);
  if (!code || !payload) return { error: 'invalid_state' };

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUriFor(request, 'google'),
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) return { error: 'token_exchange_failed' };
  const tokenData = await tokenRes.json();

  const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!profileRes.ok) return { error: 'profile_fetch_failed' };
  const profile = await profileRes.json();
  if (!profile.email || profile.email_verified === false) return { error: 'email_not_verified' };

  return { profile: { email: profile.email, name: profile.name || '', photoUrl: profile.picture || null }, next: payload.next };
}

export async function buildLinkedInAuthUrl(request, env, next) {
  const state = await signState(env.LINKEDIN_CLIENT_SECRET, 'linkedin', next);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.LINKEDIN_CLIENT_ID,
    redirect_uri: redirectUriFor(request, 'linkedin'),
    scope: 'openid email profile',
    state,
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
}

export async function handleLinkedInCallback(request, env, url) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const payload = await verifyState(env.LINKEDIN_CLIENT_SECRET, 'linkedin', state);
  if (!code || !payload) return { error: 'invalid_state' };

  const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.LINKEDIN_CLIENT_ID,
      client_secret: env.LINKEDIN_CLIENT_SECRET,
      redirect_uri: redirectUriFor(request, 'linkedin'),
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) return { error: 'token_exchange_failed' };
  const tokenData = await tokenRes.json();

  // LinkedIn "Sign In with LinkedIn using OpenID Connect" ürünü — /v2/userinfo OIDC standart ucu.
  const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!profileRes.ok) return { error: 'profile_fetch_failed' };
  const profile = await profileRes.json();
  if (!profile.email) return { error: 'email_not_verified' };

  // users tablosunda ayrı ad/soyad kolonu yok (tek `name` alanı, bkz. schema.sql) — LinkedIn OIDC
  // userinfo'da `name` genelde dolu gelir, boş geldiği nadir durumda given_name/family_name'den
  // birleştirilir (bkz. kullanıcı isteği: given_name/family_name de eşleştirilsin).
  const fullName = profile.name || [profile.given_name, profile.family_name].filter(Boolean).join(' ');

  return { profile: { email: profile.email, name: fullName || '', photoUrl: profile.picture || null }, next: payload.next };
}
