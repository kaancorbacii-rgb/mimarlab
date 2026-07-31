import { hmacSha256Hex } from './crypto.js';

// iyzico Checkout Form entegrasyonu (bkz. src/routes/payments.js). Kart bilgisi hiçbir zaman
// bizim sunucumuza gelmez: kullanıcı iyzico'nun kendi barındırdığı ödeme sayfasına yönlendirilir
// (paymentPageUrl), ödeme sonucu yalnızca sunucudan sunucuya "detail" çağrısıyla doğrulanır
// (bkz. handleCallback) — istemciden gelen hiçbir query/redirect parametresi tek başına güvenilmez.
//
// Kimlik doğrulama: IYZWSv2 HMAC-SHA256 imza şeması.
// Authorization: "IYZWSv2 " + base64("apiKey:"+apiKey+"&randomKey:"+randomKey+"&signature:"+hmac)
// hmac = HMACSHA256(randomKey + uriPath + rawRequestBody, secretKey), hex string olarak.

export function isIyzicoConfigured(env) {
  return !!(env.IYZICO_API_KEY && env.IYZICO_SECRET_KEY && env.IYZICO_BASE_URL);
}

function makeRandomKey() {
  return Date.now().toString() + Math.floor(Math.random() * 1e9).toString().padStart(9, '0');
}

function base64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

async function buildAuthHeader(env, uriPath, rawBody) {
  const randomKey = makeRandomKey();
  const signature = await hmacSha256Hex(env.IYZICO_SECRET_KEY, randomKey + uriPath + rawBody);
  const authString = `apiKey:${env.IYZICO_API_KEY}&randomKey:${randomKey}&signature:${signature}`;
  return { authorization: `IYZWSv2 ${base64Utf8(authString)}`, randomKey };
}

async function iyzicoPost(env, uriPath, payload) {
  const rawBody = JSON.stringify(payload);
  const { authorization, randomKey } = await buildAuthHeader(env, uriPath, rawBody);
  const res = await fetch(env.IYZICO_BASE_URL + uriPath, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authorization,
      'x-iyzi-rnd': randomKey,
    },
    body: rawBody,
  });
  if (!res.ok) throw new Error(`iyzico HTTP ${res.status}`);
  return res.json();
}

export async function initializeCheckoutForm(env, payload) {
  return iyzicoPost(env, '/payment/iyzipos/checkoutform/initialize/auth/ecom', payload);
}

export async function retrieveCheckoutForm(env, token) {
  return iyzicoPost(env, '/payment/iyzipos/checkoutform/auth/ecom/detail', {
    locale: 'tr',
    token,
  });
}
