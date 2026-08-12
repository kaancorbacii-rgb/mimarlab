function toHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

const PBKDF2_ITERATIONS = 100000;

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await deriveBits(password, salt);
  return `${toHex(salt)}:${toHex(derived)}`;
}

// gerçek bulgu (denetim raporu): `===` ile karşılaştırma sabit-zamanlı DEĞİL — JS motorları string
// eşitliğini genelde ilk farklı karakterde durur, bu yüzden teorik olarak doğru hash'e ne kadar
// "yakın" bir tahminin süresi ölçülerek sızdırılabilir. Pratikte PBKDF2'nin kendi maliyeti (100k
// iterasyon, milisaniyeler) bu farkı ağ üzerinden ölçülemez ölçüde gürültüye boğar, ama en az
// maliyetli yerde doğru olanı yapmak için burası tüm karakterleri HER ZAMAN gezen, erken çıkışsız
// bir karşılaştırmaya çevrildi.
function constantTimeEqual(a, b) {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (i < a.length ? a.charCodeAt(i) : 0) ^ (i < b.length ? b.charCodeAt(i) : 0);
  }
  return diff === 0;
}

export async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = (stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  const derived = await deriveBits(password, fromHex(saltHex));
  return constantTimeEqual(toHex(derived), hashHex);
}

async function deriveBits(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial, 256
  );
}

export function randomToken() {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return toHex(digest);
}

export async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return toHex(signature);
}

export function newId() {
  return crypto.randomUUID();
}
