import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { checkRateLimit, clientIp } from '../lib/rateLimit.js';

// "Danışmanlık Al" — kişi popup'ında tek bir profile (kaan-corbaci) özel birebir görüşme randevusu
// talebi. Ödeme yöntemi badges.js#createBadgeRequest İLE AYNI desen: havale/EFT, admin banka
// ekstresinden doğrulayıp D1'de status'u elle 'approved' yapar (henüz ayrı bir admin ekranı yok).
// Fiyat sunucu tarafında sabittir (istemciden asla alınmaz/güvenilmez — bkz. badges.js#getBadgePrice
// AYNI gerekçe).
const CONSULTATION_PRICE_TRY = 1500;
const ALLOWED_HOST_SLUGS = new Set(['kaan-corbaci']);

export async function handleConsultationsRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "consultations"]
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  if (segments.length === 2 && request.method === 'POST') return createConsultationRequest(request, env, user);
  return errorJson('Bulunamadı', 404);
}

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

function isValidTime(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

async function createConsultationRequest(request, env, user) {
  if (!(await checkRateLimit(env, 'consultation-request', user.id, 8, 60 * 60 * 1000))) {
    return errorJson('Çok fazla talep gönderdin. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }
  if (!(await checkRateLimit(env, 'consultation-request-ip', clientIp(request), 20, 60 * 60 * 1000))) {
    return errorJson('Çok fazla talep gönderdin. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }

  const body = await readJson(request);
  const hostSlug = typeof body.hostSlug === 'string' ? body.hostSlug.trim() : '';
  if (!ALLOWED_HOST_SLUGS.has(hostSlug)) return errorJson('Bu profil için danışmanlık randevusu şu an açık değil.');
  if (!isValidDate(body.date)) return errorJson('Geçerli bir tarih seç.');
  if (!isValidTime(body.time)) return errorJson('Geçerli bir saat seç.');

  const now = Date.now();
  const id = newId();
  await env.DB.prepare(
    `INSERT INTO consultation_requests (id, user_id, host_slug, requested_date, requested_time, price_try, status, created_at, updated_at, payment_provider)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, 'havale')`
  ).bind(id, user.id, hostSlug, body.date, body.time, CONSULTATION_PRICE_TRY, now, now).run();

  return json({ id, status: 'pending', priceTry: CONSULTATION_PRICE_TRY }, 201);
}
