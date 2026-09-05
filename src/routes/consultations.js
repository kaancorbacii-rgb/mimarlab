import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { checkRateLimit, clientIp } from '../lib/rateLimit.js';
import { createNotification } from '../lib/notify.js';

// "Danışmanlık Al" — kişi popup'ında tek bir profile (kaan-corbaci) özel birebir görüşme randevusu
// talebi. Ödeme yöntemi badges.js#createBadgeRequest İLE AYNI desen: havale/EFT, admin banka
// ekstresinden doğrulayıp D1'de status'u elle 'approved' yapar (henüz ayrı bir admin ekranı yok).
// Fiyat sunucu tarafında sabittir (istemciden asla alınmaz/güvenilmez — bkz. badges.js#getBadgePrice
// AYNI gerekçe).
const CONSULTATION_PRICE_TRY = 1500;
const ALLOWED_HOST_SLUGS = new Set(['kaan-corbaci']);
// Uygun günler/saatler (kullanıcı isteği, 2026-09-05): Pazartesi/Çarşamba/Cuma, 18:00/19:00/20:00.
// getUTCDay() ile kontrol edilir (0=Pazar…6=Cumartesi) — bir takvim gününün haftanın hangi gününe
// denk geldiği saat dilimine bağlı değildir, bu yüzden "YYYY-MM-DDT00:00:00Z" olarak ayrıştırıp
// UTC gün adını okumak istemcinin yerel hesabıyla HER ZAMAN aynı sonucu verir (bkz.
// consultation-modal.js#isoDateLocal'daki AYNI gerekçe).
const ALLOWED_WEEKDAYS = new Set([1, 3, 5]);
const ALLOWED_TIMES = new Set(['18:00', '19:00', '20:00']);
const MAX_CONTACT_LEN = 120;
const MAX_NOTE_LEN = 2000;

export async function handleConsultationsRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "consultations", maybe id]
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  if (segments.length === 2 && request.method === 'POST') return createConsultationRequest(request, env, user);
  if (segments.length === 3 && request.method === 'PATCH') return updateConsultationRequest(request, env, user, segments[2]);
  return errorJson('Bulunamadı', 404);
}

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

function isAllowedSlot(dateStr, timeStr) {
  if (!isValidDate(dateStr) || !ALLOWED_TIMES.has(timeStr)) return false;
  const d = new Date(`${dateStr}T00:00:00Z`);
  return ALLOWED_WEEKDAYS.has(d.getUTCDay());
}

function trimOrNull(value, maxLen) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  if (!isAllowedSlot(body.date, body.time)) return errorJson('Lütfen listelenen uygun gün ve saatlerden birini seç.');

  const contactName = trimOrNull(body.contactName, MAX_CONTACT_LEN);
  const contactEmail = trimOrNull(body.contactEmail, MAX_CONTACT_LEN);
  const contactPhone = trimOrNull(body.contactPhone, MAX_CONTACT_LEN);
  const note = trimOrNull(body.note, MAX_NOTE_LEN);
  if (!contactName) return errorJson('Ad soyad gerekli.');
  if (!contactEmail || !EMAIL_RE.test(contactEmail)) return errorJson('Geçerli bir e-posta adresi gir.');
  if (!contactPhone) return errorJson('Telefon numarası gerekli.');

  const now = Date.now();
  const id = newId();
  await env.DB.prepare(
    `INSERT INTO consultation_requests
       (id, user_id, host_slug, requested_date, requested_time, price_try, status, created_at, updated_at, payment_provider, contact_name, contact_email, contact_phone, note)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, 'havale', ?, ?, ?, ?)`
  ).bind(id, user.id, hostSlug, body.date, body.time, CONSULTATION_PRICE_TRY, now, now, contactName, contactEmail, contactPhone, note).run();

  // Kaan Çorbacı'ya bildirim (kullanıcı isteği, 2026-09-05: "Bir kişi danışmanlık satın alımı
  // yaptığında Kaan Çorbacı'ya bildirim gitsin"). Hedef kullanıcı architects.claimed_by_user_id'den
  // çözülür — bu profilin profile_claims'te ONAYLI bir talebi yok (doğrudan admin ataması), o yüzden
  // badges.js/getProfileBadgesForUser'daki profile_claims sorgusu YERİNE architects tablosunun kendi
  // sahiplik alanı kullanılır. Kayıt yoksa bildirim sessizce atlanır (özellik BOZULMAZ, sadece
  // bildirim gitmez) — bkz. createNotification'ın kendi try/catch'i, burada AYRICA sarmalanmaz.
  const host = await env.DB.prepare(`SELECT claimed_by_user_id FROM architects WHERE slug = ?`).bind(hostSlug).first();
  if (host && host.claimed_by_user_id) {
    await createNotification(
      env, host.claimed_by_user_id, 'consultation_request',
      'Yeni danışmanlık talebi',
      `${contactName}, ${body.date} ${body.time} için danışmanlık randevusu talep etti.`,
      '/hesabim',
    );
  }

  return json({ id, status: 'pending', priceTry: CONSULTATION_PRICE_TRY }, 201);
}

// PATCH /api/consultations/:id — "Görüşme Tarihini Değiştir" (kullanıcı isteği, 2026-09-05).
// Yalnızca talebin sahibi VE talep hâlâ 'pending' iken tarih/saat değiştirilebilir — onaylandıktan
// (admin havaleyi doğruladıktan) sonra randevu sabitlenmiş sayılır, değişiklik için iletişime
// geçilmesi gerekir (bu ekranda ayrıca bir "iptal/tekrar aç" akışı yok, kapsam dışı bırakıldı).
async function updateConsultationRequest(request, env, user, id) {
  const row = await env.DB.prepare(`SELECT * FROM consultation_requests WHERE id = ? AND user_id = ?`).bind(id, user.id).first();
  if (!row) return errorJson('Bulunamadı', 404);
  if (row.status !== 'pending') return errorJson('Bu talep artık değiştirilemez.');

  const body = await readJson(request);
  if (!isAllowedSlot(body.date, body.time)) return errorJson('Lütfen listelenen uygun gün ve saatlerden birini seç.');

  await env.DB.prepare(
    `UPDATE consultation_requests SET requested_date = ?, requested_time = ?, updated_at = ? WHERE id = ? AND user_id = ?`
  ).bind(body.date, body.time, Date.now(), id, user.id).run();

  return json({ ok: true });
}
