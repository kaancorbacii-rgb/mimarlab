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
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "consultations", maybe id/"availability"]

  // Takvimdeki yeşil/kırmızı nokta ve dolu saat bilgisi (kullanıcı isteği, 2026-09-06) — buyer
  // henüz giriş yapmadan da hangi günlerin uygun olduğunu görebilsin diye (mevcut akışla aynı: giriş
  // zorunluluğu yalnızca "Ödemeyi Yaptım"da devreye girer, bkz. consultation-modal.js) bu uç auth
  // GATE'İNDEN ÖNCE ele alınır ve hiçbir kişisel veri (isim/e-posta/telefon) DÖNDÜRMEZ, yalnızca
  // tarih+saat çiftleri.
  if (segments.length === 3 && segments[2] === 'availability' && request.method === 'GET') {
    return getAvailability(env, url);
  }

  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  if (segments.length === 2 && request.method === 'POST') return createConsultationRequest(request, env, user);
  if (segments.length === 3 && request.method === 'PATCH') return updateConsultationRequest(request, env, user, segments[2]);
  if (segments.length === 3 && request.method === 'GET') return getConsultationDetail(env, user, segments[2]);
  return errorJson('Bulunamadı', 404);
}

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

// Minimum bildirim süresi (kullanıcı isteği, 2026-09-06): "bugünden itibaren ilk 24 saat"
// tıklanamaz. Slot anını (tarih+saat) UTC olarak ayrıştırmak — weekday kontrolündeki AYNI
// gerekçeyle (bkz. dosya başındaki yorum) — istemcinin yerel saatinden bağımsız, tutarlı bir
// karşılaştırma sağlar; consultation-modal.js#isSlotTooSoon istemci tarafında AYNI mantığı uygular
// (yalnızca kullanıcı deneyimi için — asıl doğrulama HER ZAMAN burada, sunucuda yapılır).
const MIN_NOTICE_MS = 24 * 60 * 60 * 1000;

function isAllowedSlot(dateStr, timeStr) {
  if (!isValidDate(dateStr) || !ALLOWED_TIMES.has(timeStr)) return false;
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (!ALLOWED_WEEKDAYS.has(d.getUTCDay())) return false;
  const slotMs = new Date(`${dateStr}T${timeStr}:00Z`).getTime();
  return slotMs - Date.now() >= MIN_NOTICE_MS;
}

// Aynı host+tarih+saat için başka bir aktif (iptal/reddedilmemiş) talep var mı — çifte rezervasyonu
// engeller (kullanıcı isteği, 2026-09-06: "randevu alınabilecek... zaten alınmış saat"). `excludeId`
// yeniden planlamada talebin KENDİSİYLE çakışma sayılmaması için.
async function hasBookingClash(env, hostSlug, dateStr, timeStr, excludeId) {
  const row = await env.DB.prepare(
    `SELECT id FROM consultation_requests
     WHERE host_slug = ? AND requested_date = ? AND requested_time = ? AND status IN ('pending','approved') AND id != ?`
  ).bind(hostSlug, dateStr, timeStr, excludeId || '').first();
  return !!row;
}

async function getAvailability(env, url) {
  const hostSlug = (url.searchParams.get('hostSlug') || '').trim();
  const from = url.searchParams.get('from') || '';
  const to = url.searchParams.get('to') || '';
  if (!ALLOWED_HOST_SLUGS.has(hostSlug)) return errorJson('Bu profil için danışmanlık randevusu şu an açık değil.');
  if (!isValidDate(from) || !isValidDate(to)) return errorJson('Geçersiz tarih aralığı.');
  // Tek seferde en fazla ~2 aylık ufuk — takvim zaten ay bazında istek atıyor, geniş bir aralık
  // istenmesinin tek nedeni kötüye kullanım olurdu.
  if (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime() > 70 * 24 * 60 * 60 * 1000) {
    return errorJson('Tarih aralığı çok geniş.');
  }
  const { results } = await env.DB.prepare(
    `SELECT requested_date, requested_time FROM consultation_requests
     WHERE host_slug = ? AND requested_date >= ? AND requested_date <= ? AND status IN ('pending','approved')`
  ).bind(hostSlug, from, to).all();
  const booked = {};
  for (const r of results || []) {
    (booked[r.requested_date] ||= []).push(r.requested_time);
  }
  return json({ booked });
}

// GET /api/consultations/:id — "Görüşme Detayı": danışmanı "yeni talep" bildiriminden, ALICIYI ise
// "ödeme onaylandı/reddedildi" bildiriminden (kullanıcı isteği, 2026-09-06: admin onayı sonrası
// bildirim) bu ekrana yönlendirir. Güvenlik: SADECE talebin KENDİ SAHİBİ (buyer, user_id) VEYA
// host'unu (architects.claimed_by_user_id) CLAIM ETMİŞ kullanıcı görebilir — başka herkese 403.
async function getConsultationDetail(env, user, id) {
  const row = await env.DB.prepare(`SELECT * FROM consultation_requests WHERE id = ?`).bind(id).first();
  if (!row) return errorJson('Bulunamadı', 404);
  const isBuyer = row.user_id === user.id;
  let isHost = false;
  if (!isBuyer) {
    const host = await env.DB.prepare(`SELECT claimed_by_user_id FROM architects WHERE slug = ?`).bind(row.host_slug).first();
    isHost = !!(host && host.claimed_by_user_id && host.claimed_by_user_id === user.id);
  }
  if (!isBuyer && !isHost) {
    return errorJson('Bu görüşme detayını görüntüleme yetkin yok.', 403);
  }
  return json({
    id: row.id,
    date: row.requested_date,
    time: row.requested_time,
    status: row.status,
    priceTry: row.price_try,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    note: row.note,
    hasRescheduled: !!row.has_rescheduled,
  });
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
  if (await hasBookingClash(env, hostSlug, body.date, body.time)) {
    return errorJson('Bu saat başka biri tarafından alınmış, lütfen başka bir saat seç.');
  }

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
    // link formatı diğer bildirim türleriyle AYNI desen — bkz. src/routes/messages.js'in
    // `msg:${threadId}` biçimi. hesabim.html#renderNotifications bu öneki görünce doğrudan
    // ConsultationDetailModal.open(id) çağırır (kullanıcı isteği, 2026-09-06, Aşama 4).
    await createNotification(
      env, host.claimed_by_user_id, 'consultation_request',
      'Yeni danışmanlık talebi',
      `${contactName}, ${body.date} ${body.time} için danışmanlık randevusu talep etti.`,
      `consultation:${id}`,
    );
  }

  return json({ id, status: 'pending', priceTry: CONSULTATION_PRICE_TRY }, 201);
}

// PATCH /api/consultations/:id — "Görüşme Tarihini Değiştir" (kullanıcı isteği, 2026-09-05, limit
// eklendi 2026-09-06). Yalnızca talebin sahibi VE talep hâlâ 'pending' iken tarih/saat
// değiştirilebilir — onaylandıktan (admin havaleyi doğruladıktan) sonra randevu sabitlenmiş sayılır,
// değişiklik için iletişime geçilmesi gerekir (bu ekranda ayrıca bir "iptal/tekrar aç" akışı yok,
// kapsam dışı bırakıldı). has_rescheduled zaten 1 ise İKİNCİ değişiklik reddedilir (kullanıcı isteği:
// "yalnızca 1 kez") — bu kontrol istemcinin buton gizleme/pasifleştirmesinden BAĞIMSIZ, tek gerçek
// kaynak burasıdır.
async function updateConsultationRequest(request, env, user, id) {
  const row = await env.DB.prepare(`SELECT * FROM consultation_requests WHERE id = ? AND user_id = ?`).bind(id, user.id).first();
  if (!row) return errorJson('Bulunamadı', 404);
  if (row.status !== 'pending') return errorJson('Bu talep artık değiştirilemez.');
  if (row.has_rescheduled) return errorJson('Görüşme tarihi yalnızca bir kez değiştirilebilir.');

  const body = await readJson(request);
  if (!isAllowedSlot(body.date, body.time)) return errorJson('Lütfen listelenen uygun gün ve saatlerden birini seç.');
  if (await hasBookingClash(env, row.host_slug, body.date, body.time, id)) {
    return errorJson('Bu saat başka biri tarafından alınmış, lütfen başka bir saat seç.');
  }

  await env.DB.prepare(
    `UPDATE consultation_requests SET requested_date = ?, requested_time = ?, has_rescheduled = 1, updated_at = ? WHERE id = ? AND user_id = ?`
  ).bind(body.date, body.time, Date.now(), id, user.id).run();

  return json({ ok: true });
}
