import { json, errorJson, readJson } from '../lib/http.js';
import { scrubLockedMediaPayload } from '../lib/mediaRights.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { checkRateLimit, clientIp } from '../lib/rateLimit.js';
import { createNotification } from '../lib/notify.js';
import { sendConsultationMessage } from './messages.js';
// Güvenli Görüşme Gateway'i / Google Meet (kullanıcı isteği, 2026-09-08) — bkz. src/lib/consultationMeet.js.
import {
  ROOM_UUID_RE, roomPath, meetingWindow, resolveConsultationAccess, ensureRoomUuid, maybeRetryMeetOnAccess,
  consultationStartMs, rescheduleMeetForConsultation,
  CONSULTATION_DURATION_MIN, JOIN_EARLY_MIN, CONSULTATION_TIMEZONE,
} from '../lib/consultationMeet.js';

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

  // GET /api/consultations/room/:room_uuid — Güvenli Görüşme Gateway'inin TEK veri ucu (bkz.
  // gorusme.html). Yetki her istekte sunucuda yeniden kurulur; Meet adresi yalnızca katılım
  // penceresinde ve yalnızca yetkili tarafa döner (bkz. getRoomState).
  if (segments.length === 4 && segments[2] === 'room' && request.method === 'GET') {
    return getRoomState(request, env, user, segments[3]);
  }
  if (segments.length === 2 && request.method === 'POST') return createConsultationRequest(request, env, user);
  if (segments.length === 3 && request.method === 'PATCH') return updateConsultationRequest(request, env, user, segments[2]);
  if (segments.length === 3 && request.method === 'GET') return getConsultationDetail(env, user, segments[2]);
  if (segments.length === 4 && segments[3] === 'actions' && request.method === 'POST') {
    return createConsultationAction(request, env, user, segments[2]);
  }
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
// İptal kapanış eşiği (kullanıcı isteği, 2026-09-06): "görüşmeden en az 2 gün öncesine kadar" —
// bu, MIN_NOTICE_MS'den (yeni tarih için 24 saat) FARKLI bir kontrol: ORİJİNAL randevu anına göre
// hesaplanır, yeni seçilecek tarihe göre DEĞİL. DEĞİŞMEDİ.
const CANCEL_MIN_NOTICE_MS = 2 * 24 * 60 * 60 * 1000;
// Yeniden planlama kapanış eşiği AYRI ve DAHA UZUN: 3 gün (kullanıcı isteği, 2026-09-08: "sadece
// 1 kez görüşmeden en az 3 gün önce tarih değiştirilebilsin"). Önceden iptalle AYNI sabiti
// paylaşıyordu (2 gün); ayrıştırıldı ki biri değişince diğeri sessizce kaymasın.
const RESCHEDULE_MIN_NOTICE_MS = 3 * 24 * 60 * 60 * 1000;
// 'completed' ("Görüşme Gerçekleşti") KALDIRILDI (kullanıcı isteği, 2026-09-06) — yerini 'message'
// ("Mesaj Gönder") aldı ve bu tür admin kuyruğuna DÜŞMEZ, doğrudan karşı tarafın mesaj kutusuna
// gider (bkz. createConsultationAction'ın 'message' dalı). 'cancel' ve 'review' eskisi gibi
// consultation_actions'a yazılıp admin değerlendirmesine gider.
const CONSULTATION_ACTION_TYPES = new Set(['message', 'review', 'cancel']);
const MAX_ACTION_NOTE_LEN = 2000;

// Aksiyon zaman kapıları (kullanıcı isteği, 2026-09-06, yeniden planlama 2026-09-08'de güncellendi):
//   * Tarihi Değiştir (1 kez) -> yalnızca görüşmeye 3 GÜNDEN FAZLA varken,
//   * İptal Et                -> yalnızca görüşmeye 2 GÜNDEN FAZLA varken,
//   * Değerlendir             -> yalnızca görüşme ANINDAN SONRA,
//   * Mesaj Gönder            -> her zaman (kapısı yok).
// Tek kaynak burasıdır; istemci aynı bayrakları getConsultationDetail'den okuyup butonları
// pasifleştirir (yalnızca UX), sunucu her POST'ta TEKRAR doğrular.
//
// "Görüşme ne zaman başlıyor" sorusunun TEK yanıtı consultationMeet.js#consultationStartMs'tir
// (İstanbul, sabit +03:00 — bkz. o dosyanın başındaki gerekçe). Burada eskiden slot ayrı olarak
// `...T HH:MM:00Z` ile, yani UTC sayılarak ayrıştırılıyordu; görüşme odasının katılım penceresiyle
// 3 saat ayrışıyordu. İki farklı "başlangıç anı" tanımı bu depodaki klasik sessiz ayrışma
// tuzağıdır, bu yüzden tek kaynağa bağlandı.
function isBeforeCancelCutoff(row) {
  return consultationStartMs(row) - Date.now() >= CANCEL_MIN_NOTICE_MS;
}
function isBeforeRescheduleCutoff(row) {
  return consultationStartMs(row) - Date.now() >= RESCHEDULE_MIN_NOTICE_MS;
}
function isAfterMeeting(row) {
  return Date.now() >= consultationStartMs(row);
}

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
  const host = await env.DB.prepare(`SELECT name, claimed_by_user_id FROM architects WHERE slug = ?`).bind(row.host_slug).first();
  const isHost = !isBuyer && !!(host && host.claimed_by_user_id && host.claimed_by_user_id === user.id);
  if (!isBuyer && !isHost) {
    return errorJson('Bu görüşme detayını görüntüleme yetkin yok.', 403);
  }
  // Yeniden planlama gösterge kapısı (kullanıcı isteği, 2026-09-06) — istemci "Tarihi Değiştir"
  // butonunu bu üç koşulla gizler/gösterir; sunucu updateConsultationRequest'te AYNI kontrolleri
  // tek gerçek kaynak olarak TEKRAR uygular (istemci burada yalnızca UX içindir).
  const openStatus = row.status === 'pending' || row.status === 'approved';
  // Tarihi Değiştir: yalnızca ALICIDA, henüz değiştirilmemişse, talep hâlâ AÇIKKEN (pending VEYA
  // approved — kullanıcı isteği, 2026-09-08: onaylanmış randevuda da buton görünür) ve 3 gün
  // kapısı açıkken. İptal Et: iki tarafta da, talep açıkken ve 2 gün kapısı açıkken.
  // Değerlendir: iki tarafta da, YALNIZCA görüşme anı geçtikten sonra.
  const canReschedule = isBuyer && openStatus && !row.has_rescheduled && isBeforeRescheduleCutoff(row);
  const canCancel = openStatus && isBeforeCancelCutoff(row);
  const canReview = isAfterMeeting(row);
  // Buton artık ızgarada HER ZAMAN görünür (kullanıcı isteği, 2026-09-08) — pasifse SEBEBİ de
  // gösterilmeli. Metin tek kaynak burada üretilir; istemci yalnızca gösterir (bkz.
  // consultation-detail-modal.js#actionsHtml) ve sunucu updateConsultationRequest'te AYNI sırayla
  // tekrar doğrular.
  const rescheduleReason = canReschedule ? null
    : !isBuyer ? 'Tarih değişikliğini yalnızca görüşmeyi satın alan kişi yapabilir.'
    : !openStatus ? 'Bu talep artık değiştirilemez.'
    : row.has_rescheduled ? 'Görüşme tarihi yalnızca bir kez değiştirilebilir.'
    : 'Görüşmeye 3 günden az kaldığı için tarih değiştirilemez.';
  // Görüşme odası (Google Meet gateway'i, 2026-09-08): oda kimliği bu özellikten önce açılmış
  // satırlara burada tembel atanır; bağlantı yalnızca ONAYLI rezervasyonda döner. Meet adresinin
  // KENDİSİ bu uçtan HİÇ çıkmaz — yalnızca gateway ucu, yalnızca katılım penceresinde döndürür.
  let roomUrl = null;
  let meetStatus = null;
  if (row.status === 'approved') {
    await ensureRoomUuid(env, row);
    const fresh = await maybeRetryMeetOnAccess(env, row);
    roomUrl = roomPath(fresh.room_uuid || row.room_uuid);
    meetStatus = fresh.meet_link ? 'ready' : (fresh.meet_status || 'pending');
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
    hostSlug: row.host_slug,
    hostName: host ? host.name : row.host_slug,
    isBuyer,
    isHost,
    canReschedule,
    rescheduleReason,
    canCancel,
    canReview,
    roomUrl,
    roomUuid: row.status === 'approved' ? (row.room_uuid || null) : null,
    meetStatus,
  });
}

// GET /api/consultations/room/:room_uuid — gateway sayfasının durumu. Kurallar (kullanıcı isteği,
// 2026-09-08):
//   * room_uuid TEK BAŞINA yetki vermez: oturum + alıcı/danışman eşleşmesi her istekte sunucuda.
//   * Zaman kararı SUNUCU saatiyle (meetingWindow); istemci saatine güvenilmez, istemci yalnızca
//     geri sayımı sunucunun `serverNow` değerine göre çizer.
//   * meetLink YALNIZCA rezervasyon onaylı + Meet hazır + katılım penceresi (başlangıç-15dk ..
//     başlangıç+45dk) içindeyken döner; diğer her durumda alan hiç yazılmaz.
//   * Geçersiz/bilinmeyen oda -> 404, yetkisiz kullanıcı -> 403 (varlığı da sızdırılmaz denemedi:
//     403 yalnızca gerçek bir odada döner ama oda kimliği zaten tahmin edilemez).
async function getRoomState(request, env, user, roomUuid) {
  if (!ROOM_UUID_RE.test(roomUuid || '')) return errorJson('Görüşme odası bulunamadı.', 404);
  if (!(await checkRateLimit(env, 'meet-room', user.id, 120, 10 * 60 * 1000))) {
    return errorJson('Çok fazla istek. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '600' });
  }
  let row = await env.DB.prepare(`SELECT * FROM consultation_requests WHERE room_uuid = ?`).bind(roomUuid).first();
  if (!row) return errorJson('Görüşme odası bulunamadı.', 404);
  const access = await resolveConsultationAccess(env, user, row);
  if (!access.allowed) return errorJson('Bu görüşmeye erişim yetkin yok.', 403);
  // TELİF KİLİDİ (2026-09-09 ikinci tur) — danışmanın profil fotoğrafı kilitli olabilir; ham yol
  // kapıdan 404 döndüğü için taranmazsa görsel KIRIK görünürdü (bkz. src/routes/messages.js).
  return json(await scrubLockedMediaPayload(env, buildRoomState(env, row, access, await maybeRetryMeetOnAccess(env, row))));
}

// Saf/yan etkisiz yanıt gövdesi — scripts/test-meet-gateway.mjs sahte saatle doğrudan bunu test eder.
export function buildRoomState(env, row, access, freshRow, nowMs = Date.now()) {
  const r = freshRow || row;
  const win = meetingWindow(r, nowMs);
  const meetReady = !!r.meet_link && r.meet_status === 'ready';
  const meetStatus = meetReady ? 'ready' : (r.meet_status || 'pending');
  const host = access.host || {};
  const out = {
    id: r.id,
    roomUuid: r.room_uuid,
    status: r.status,
    date: r.requested_date,
    time: r.requested_time,
    timezone: CONSULTATION_TIMEZONE,
    durationMin: CONSULTATION_DURATION_MIN,
    joinEarlyMin: JOIN_EARLY_MIN,
    startsAt: win.startsAt,
    endsAt: win.endsAt,
    joinOpensAt: win.joinOpensAt,
    serverNow: nowMs,
    phase: r.status === 'approved' ? win.phase : 'not_approved',
    meetStatus,
    isBuyer: access.isBuyer,
    isHost: access.isHost,
    contactName: r.contact_name || null,
    host: {
      slug: r.host_slug,
      name: host.name || r.host_slug,
      photoUrl: host.photo_url || null,
      position: host.position || host.profession || null,
    },
  };
  if (r.status === 'approved' && meetReady && win.joinable) out.meetLink = r.meet_link;
  return out;
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
  // room_uuid — Güvenli Görüşme Gateway'inin adresi (/gorusme/:room_uuid), crypto.randomUUID()
  // (CSPRNG). Rezervasyon anında atanır; tek başına yetki VERMEZ (bkz. consultationMeet.js).
  const roomUuid = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO consultation_requests
       (id, user_id, host_slug, requested_date, requested_time, price_try, status, created_at, updated_at, payment_provider, contact_name, contact_email, contact_phone, note, room_uuid)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, 'havale', ?, ?, ?, ?, ?)`
  ).bind(id, user.id, hostSlug, body.date, body.time, CONSULTATION_PRICE_TRY, now, now, contactName, contactEmail, contactPhone, note, roomUuid).run();

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

  // Alıcıya bilgilendirme bildirimi (kullanıcı isteği, 2026-09-06): "danışmanlık satın alan
  // kullanıcıya da bir bilgilendirme bildirimi gitsin" — host'a giden yukarıdaki bildirimden AYRI,
  // talebi oluşturan kişinin (user.id) kendisine gider. Aynı `consultation:<id>` bağlantı deseni
  // (bkz. auth-modal.js#consultationIdFromLink) ConsultationDetailModal'ı açar; oradan hem "Tarihi
  // Değiştir" hem Görüşme Gerçekleşti/Değerlendir/İptal Et aksiyonlarına erişilir.
  await createNotification(
    env, user.id, 'consultation_request_received',
    'Danışmanlık talebin alındı',
    `${body.date} ${body.time} için randevu talebin alındı. Ödemen onaylandığında sana bildirim göndereceğiz.`,
    `consultation:${id}`,
  );

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
  // 'approved' de değiştirilebilir (kullanıcı isteği, 2026-09-08) — onaylı randevunun Google Meet
  // odası KORUNUR, yalnızca takvimdeki saati güncellenir (bkz. aşağıdaki rescheduleMeetForConsultation).
  if (row.status !== 'pending' && row.status !== 'approved') return errorJson('Bu talep artık değiştirilemez.');
  if (row.has_rescheduled) return errorJson('Görüşme tarihi yalnızca bir kez değiştirilebilir.');
  // "en az 3 gün öncesine kadar" (kullanıcı isteği, 2026-09-08) — ORİJİNAL randevu anına göre,
  // yeni seçilecek tarihe göre DEĞİL (bkz. dosya başı RESCHEDULE_MIN_NOTICE_MS yorumu).
  if (!isBeforeRescheduleCutoff(row)) {
    return errorJson('Görüşmeye 3 günden az kaldığı için tarih değiştirilemez.');
  }

  const body = await readJson(request);
  if (!isAllowedSlot(body.date, body.time)) return errorJson('Lütfen listelenen uygun gün ve saatlerden birini seç.');
  if (await hasBookingClash(env, row.host_slug, body.date, body.time, id)) {
    return errorJson('Bu saat başka biri tarafından alınmış, lütfen başka bir saat seç.');
  }

  await env.DB.prepare(
    `UPDATE consultation_requests SET requested_date = ?, requested_time = ?, has_rescheduled = 1, updated_at = ? WHERE id = ? AND user_id = ?`
  ).bind(body.date, body.time, Date.now(), id, user.id).run();

  // Google Takvim etkinliğinin saatini yeni randevuya taşı (kullanıcı isteği, 2026-09-08 —
  // onaylı randevu da değiştirilebildiğinden). Meet ADRESİ ve oda kimliği DEĞİŞMEZ; yalnızca
  // etkinliğin start/end'i güncellenir. Best-effort: başarısız olursa tarih değişikliği GEÇERLİDİR
  // (gateway'in katılım penceresi zaten D1'deki tarihten hesaplanır, takvimden değil) — hata
  // yalnızca meet_error'a yazılır. ASLA fırlatmaz (bkz. rescheduleMeetForConsultation).
  await rescheduleMeetForConsultation(env, id);

  // Danışmana bildirim (kullanıcı isteği, 2026-09-06): "danışmana tarih değiştirilirse tarih
  // değiştirildi diye bildirim gitsin" — host_request bildirimiyle AYNI architects.claimed_by_
  // user_id çözümü (bkz. createConsultationRequest).
  const host = await env.DB.prepare(`SELECT claimed_by_user_id FROM architects WHERE slug = ?`).bind(row.host_slug).first();
  if (host && host.claimed_by_user_id) {
    await createNotification(
      env, host.claimed_by_user_id, 'consultation_rescheduled',
      'Danışmanlık randevusu tarihi değişti',
      `${row.contact_name || 'Kullanıcı'}, randevu tarihini ${body.date} ${body.time} olarak değiştirdi.`,
      `consultation:${id}`,
    );
  }

  return json({ ok: true });
}

// POST /api/consultations/:id/actions — "Görüşme Gerçekleşti" / "Değerlendir" / "İptal Et"
// (kullanıcı isteği, 2026-09-06): alıcı ya da danışman bir sebep yazıp admin değerlendirmesine
// gönderir — profile_corrections İLE AYNI desen (bkz. src/routes/claims.js#handleCorrectionsRoute).
async function createConsultationAction(request, env, user, consultationId) {
  if (!(await checkRateLimit(env, 'consultation-action', user.id, 10, 60 * 60 * 1000))) {
    return errorJson('Çok fazla talep gönderdin. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }
  const row = await env.DB.prepare(`SELECT * FROM consultation_requests WHERE id = ?`).bind(consultationId).first();
  if (!row) return errorJson('Bulunamadı', 404);
  const isBuyer = row.user_id === user.id;
  const host = await env.DB.prepare(`SELECT name, claimed_by_user_id FROM architects WHERE slug = ?`).bind(row.host_slug).first();
  const isHost = !isBuyer && !!(host && host.claimed_by_user_id && host.claimed_by_user_id === user.id);
  if (!isBuyer && !isHost) return errorJson('Bu görüşme için talepte bulunma yetkin yok.', 403);

  const body = await readJson(request);
  const actionType = typeof body.actionType === 'string' ? body.actionType : '';
  if (!CONSULTATION_ACTION_TYPES.has(actionType)) return errorJson('Geçersiz aksiyon türü.');
  const note = trimOrNull(body.note, MAX_ACTION_NOTE_LEN);
  if (!note) return errorJson('Lütfen bir açıklama yaz.');

  // Zaman kapıları — istemcinin butonu pasifleştirmesinden BAĞIMSIZ, tek gerçek kaynak (bkz.
  // dosya başındaki isBeforeCutoff/isAfterMeeting yorumu).
  if (actionType === 'cancel' && !isBeforeCancelCutoff(row)) {
    return errorJson('Görüşmeye 2 günden az kaldığı için iptal edilemez.');
  }
  if (actionType === 'review' && !isAfterMeeting(row)) {
    return errorJson('Değerlendirme yalnızca görüşme gerçekleştikten sonra yapılabilir.');
  }

  // "Mesaj Gönder" (kullanıcı isteği, 2026-09-06) — admin kuyruğuna DÜŞMEZ, doğrudan karşı tarafın
  // mesaj kutusuna gider (bkz. messages.js#sendConsultationMessage). Alıcı yazarsa danışmana,
  // danışman yazarsa alıcıya ulaşır; ikisi de AYNI konuşma balonunda toplanır.
  if (actionType === 'message') {
    if (!host || !host.claimed_by_user_id) return errorJson('Bu danışmana şu anda mesaj gönderilemiyor.');
    const buyer = await env.DB.prepare('SELECT id, name, email FROM users WHERE id = ?').bind(row.user_id).first();
    if (!buyer) return errorJson('Bu görüşme için mesaj gönderilemiyor.');
    const result = await sendConsultationMessage(env, {
      actor: user,
      buyer: { id: buyer.id, name: row.contact_name || buyer.name, email: row.contact_email || buyer.email, phone: row.contact_phone },
      hostUserId: host.claimed_by_user_id,
      hostName: host.name,
      text: note,
    });
    if (result.error) return errorJson(result.error);
    return json({ ok: true, threadId: result.id, sent: true }, 201);
  }

  const now = Date.now();
  const id = newId();
  await env.DB.prepare(
    `INSERT INTO consultation_actions (id, consultation_id, requested_by_user_id, requested_by_role, action_type, note, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(id, consultationId, user.id, isBuyer ? 'buyer' : 'host', actionType, note, now, now).run();

  return json({ id, status: 'pending' }, 201);
}
