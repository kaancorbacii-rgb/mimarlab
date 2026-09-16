import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { checkRateLimit, clientIp } from '../lib/rateLimit.js';
import { createNotification } from '../lib/notify.js';
import { sendConsultationMessage } from './messages.js';
// Ödeme (kullanıcı isteği, 2026-09-13) — kart tarafı rozet satışıyla AYNI altyapıyı kullanır
// (src/lib/iyzico.js); havale/EFT hesap bilgisi yalnızca sırlardan okunur (src/lib/bankTransfer.js).
import { initializeCheckoutForm, isIyzicoConfigured } from '../lib/iyzico.js';
import { getBankTransferAccount, isBankTransferConfigured } from '../lib/bankTransfer.js';
import { isValidTcKimlik, normalizeGsm } from '../lib/iyzicoBuyer.js';
// /danismanlik sayfasının (danismanlik.html) liste ucu için — kişi kartı, kişi listesindekiyle
// AYNI alanlardan çizilsin diye kova/etiket dönüşümleri kisi.html'in okuduğu yerden alınır. Bu
// içe aktarma DÖNGÜ YARATMAZ: consultations.js'i yalnızca payments.js import eder ve architect.js
// zincirinde (office.js/auth.js) payments.js yoktur.
import { cachedPublicJson, invalidatePublicCache } from '../lib/publicCache.js';
import { parseCanonicalRow } from '../lib/canonicalRead.js';
import { schoolNameList } from '../lib/universities.js';
import { positionOf, professionLabelList } from './architect.js';
// DANIŞMAN KADROSU ARTIK D1'DE (kullanıcı isteği, 2026-09-15) — bkz. src/lib/consultants.js.
import {
  fetchApprovedConsultant, fetchApprovedConsultantRows, parseConsultantRow, DEFAULT_OFFER,
  publicOffer, consultationIntro, normalizeConsultantOffer, fetchUserConsultantCandidates,
  CONSULTANT_DURATIONS, CONSULTANT_TIME_SLOTS, CONSULTANT_WEEKDAYS, WEEKDAY_NAMES_TR,
} from '../lib/consultants.js';
// Geriye dönük yeniden dışa aktarım: bu ikisinin tanımı artık src/lib/consultants.js'tedir
// (src/routes/architect.js oradan okuyor — buradan okusaydı iki route modülü arasında döngü olurdu).
export { publicOffer, consultationIntro };
// Güvenli Görüşme Gateway'i / Google Meet (kullanıcı isteği, 2026-09-08) — bkz. src/lib/consultationMeet.js.
import {
  ROOM_UUID_RE, roomPath, meetingWindow, resolveConsultationAccess, ensureRoomUuid, maybeRetryMeetOnAccess,
  consultationStartMs, rescheduleMeetForConsultation,
  CONSULTATION_DURATION_MIN, JOIN_EARLY_MIN, CONSULTATION_TIMEZONE,
} from '../lib/consultationMeet.js';

// "Danışmanlık Al" — kişi popup'ında tek bir profile (kaan-corbaci) özel birebir görüşme randevusu
// talebi. Fiyat sunucu tarafında sabittir (istemciden asla alınmaz/güvenilmez — bkz.
// badges.js#getBadgePrice AYNI gerekçe).
//
// ÖDEME (kullanıcı isteği, 2026-09-13: "ödeme seçeneklerini geri getir"). İKİ yöntem sunulur ve
// seçilen AKIŞ "önce talep, sonra ödeme"dir (kullanıcı kararı):
//   1. Talep 'pending' olarak açılır ve SLOT O ANDA TUTULUR (hasBookingClash bunu 'pending'
//      satırlar üzerinden okur) — ödeme akışı çökse/yarıda kalsa bile kullanıcı saatini kaybetmez.
//   2. Kullanıcı ödeme yöntemini seçer: 'iyzico' (kart, hosted Checkout Form) ya da 'havale'
//      (IBAN + "Ödemeyi Yaptım" beyanı).
//   3. Admin talebi onaylar -> Google Meet odası kurulur (bkz. src/lib/consultationMeet.js).
//
// KRİTİK: iyzico ödemesinin BAŞARILI dönmesi talebi OTOMATİK 'approved' YAPMAZ, yalnızca
// payment_status'u 'paid' yapar. Onay kapısı (ve dolayısıyla Meet odasının kurulması) admin'de
// kalır — ödeme doğrulaması o kapının YERİNE geçmez, ÖNÜNE eklenir. Aksi halde ödemesi geçmiş ama
// admin'in henüz bakmadığı bir talep kendiliğinden takvime/Meet'e düşerdi.
// ÜCRET ARTIK DANIŞMAN BAŞINA (kullanıcı isteği, 2026-09-15: "bu görüşme saatlerinin kaç TL
// olduğunu ... seçsinler"). Bu sabit yalnızca `consultants` satırı OKUNAMADIĞINDA kullanılan geri
// düşüştür ve değeri tek kaynaktan (consultants.js#DEFAULT_OFFER) gelir — iki yerde iki farklı
// "varsayılan fiyat" olmasın.
export const CONSULTATION_PRICE_TRY = DEFAULT_OFFER.priceTry;
// payment_status sözleşmesi — bkz. migrations/0117_consultation_payment.sql (AYNI liste).
const PAYMENT_STATUS = new Set(['pending', 'declared', 'paid', 'failed']);
// iyzico callback'i (src/routes/payments.js#handleCallback) rozet ve danışmanlık taleplerini AYNI
// uçtan alır; hangi tabloya bakacağını conversationId'nin bu önekinden anlar. newId() çıplak bir
// UUID ürettiğinden (bkz. src/lib/crypto.js) önek belirsizlik YARATMAZ — rozet conversationId'si
// hiçbir zaman '_' içermez.
export const CONSULTATION_CONVERSATION_PREFIX = 'cns_';
// TC Kimlik No/adres/şehir SADECE iyzico'ya iletilir, D1'e YAZILMAZ (veri minimizasyonu) —
// src/routes/payments.js#startCheckout'taki AYNI kural.
// RANDEVU KAPISI ARTIK BU SET DEĞİL, `consultants` TABLOSUDUR (status='approved' —
// bkz. src/lib/consultants.js#fetchApprovedConsultant). Set yalnızca TOHUM olarak duruyor:
// migrations/0121_consultants.sql bu slug'ı bugünkü teklifiyle tabloya taşıdı. Kodda hiçbir kapı
// artık buna bakmaz; silinmemesinin tek sebebi, tablonun nereden doğduğunun kayıtta kalmasıdır.
export const SEED_HOST_SLUGS = new Set(['kaan-corbaci']);
// Uygun günler/saatler (kullanıcı isteği, 2026-09-05): Pazartesi/Çarşamba/Cuma, 18:00/19:00/20:00.
// getUTCDay() ile kontrol edilir (0=Pazar…6=Cumartesi) — bir takvim gününün haftanın hangi gününe
// denk geldiği saat dilimine bağlı değildir, bu yüzden "YYYY-MM-DDT00:00:00Z" olarak ayrıştırıp
// UTC gün adını okumak istemcinin yerel hesabıyla HER ZAMAN aynı sonucu verir (bkz.
// consultation-modal.js#isoDateLocal'daki AYNI gerekçe).
// Uygun gün/saatler de DANIŞMAN BAŞINADIR; bunlar yalnızca geri düşüştür (yukarıdaki ücretle
// AYNI gerekçe ve AYNI tek kaynak).
export const ALLOWED_WEEKDAYS = new Set(DEFAULT_OFFER.weekdays);
export const ALLOWED_TIMES = new Set(DEFAULT_OFFER.times);
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
  // Ödeme adımı (kullanıcı isteği, 2026-09-13). Talep ZATEN açılmış olmalıdır — bu uç bir
  // rezervasyon OLUŞTURMAZ, yalnızca var olan bir talebe ödeme yöntemi bağlar.
  if (segments.length === 4 && segments[3] === 'payment' && request.method === 'POST') {
    return startConsultationPayment(request, env, user, segments[2]);
  }
  return errorJson('Bulunamadı', 404);
}


// GET /api/consultants — danismanlik.html'in TEK veri ucu (kullanıcı isteği, 2026-09-15:
// "DANIŞMANLIK diye bir sayfa tasarla ... Danışman olarak Kaan Çorbacı'yı koy ve Kaan Çorbacı'nın
// profilindeki Danışmanlık Al butonundaki bilgileri kullan").
//
// KİMİN DANIŞMAN OLDUĞU BURADA YENİDEN TANIMLANMAZ: liste, randevu talebini kabul eden kapının
// (`consultants` tablosu, status='approved' — bkz. src/lib/consultants.js) TA KENDİSİNDEN
// türetilir. Sayfaya elle bir slug yazılsaydı, kapı değiştiği gün sayfa sessizce ayrışır ve
// "Danışmanlık Al" düğmesi çalışmayan bir kart gösterirdi.
//
// TEKLİF KART BAŞINADIR (2026-09-15, "Danışman Ol" turu): her kartın kendi `offer` alanı vardır
// (süre/ücret/uygun gün-saat) çünkü her danışman kendi teklifini seçer. Değerler randevuyu
// DOĞRULAYAN satırın ta kendisinden okunur — sayfada hiçbir teklif değeri tekrar yazılmaz.
//
// SAYFALAMA/FİLTRE PARAMETRESİ YOK: havuz küratörlüdür (admin onaylı başvurular) ve küçüktür;
// danismanlik.html filtreleme/sıralama/sayfalamayı bu tam yanıt üzerinde istemcide yapar. Yanıt
// hiçbir kişisel veri taşımaz (randevu satırlarına HİÇ bakılmaz), bu yüzden herkese açıktır.
export async function handleConsultantsRoute(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorJson('Bulunamadı', 404);
  return cachedPublicJson(request, env, url.pathname, () => fetchConsultantList(env));
}

// Yanıtın SAF gövdesi — önbellek/oturum katmanından ayrı tutulur ki birim testi (bkz.
// scripts/test-2026-09-15-danismanlik-page.mjs) sahte bir env ile doğrudan çağırabilsin
// (cachedPublicJson, Node'da bulunmayan `caches` global'ine ve oturum okumasına dokunur).
// ---------------------------------------------------------------------------------------------
// DANIŞMAN OL — BAŞVURU UCU  (kullanıcı isteği, 2026-09-15)
// ---------------------------------------------------------------------------------------------
// GET  /api/consultant-applications  -> başvuru sayfasının TEK açılış isteği:
//      { candidates, application, options }
// POST /api/consultant-applications  -> başvuruyu oluşturur/günceller (her zaman 'pending')
//
// KİŞİ KAYDI ŞARTTIR ve bu bir tercih değil YAPISAL bir zorunluluktur: danışmanlığın tamamı bir
// architects satırının üzerine kuruludur (consultation_requests.host_slug, görüşme odası yetkisi
// architects.claimed_by_user_id, "Danışmanlık Al" düğmesinin yaşadığı kişi pop-up'ı). Kaydı
// olmayan başvuru sahibi /kisi-ekle'ye yönlendirilir; `candidates` boş dönmesi bu durumun
// istemciye verilen sinyalidir.
//
// ONAY KAPISI ADMİNDEDİR: bu uç status'u ASLA 'approved' yapmaz. Kendi kendini onaylayabilen bir
// başvuru, randevu kapısını (fetchApprovedConsultant) tamamen anlamsız kılardı.
export async function handleConsultantApplicationsRoute(request, env, url) {
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);
  if (request.method === 'GET') return getConsultantApplication(env, user);
  if (request.method === 'POST') return submitConsultantApplication(request, env, user);
  return errorJson('Bulunamadı', 404);
}

// Formun seçeneklerini SUNUCU bildirir (süreler, saat listesi, gün listesi). İstemcide ikinci bir
// kopya tutulsaydı, bir seçenek eklendiğinde form onu göstermeye devam eder ama sunucu reddederdi.
function consultantFormOptions() {
  return {
    durations: CONSULTANT_DURATIONS,
    times: CONSULTANT_TIME_SLOTS,
    weekdays: CONSULTANT_WEEKDAYS.map(n => ({ value: n, label: WEEKDAY_NAMES_TR[n] })),
  };
}

async function getConsultantApplication(env, user) {
  const candidates = await fetchUserConsultantCandidates(env, user);
  let application = null;
  if (candidates.length) {
    const slugs = candidates.map(c => c.slug);
    // Kullanıcının kendi kişi kayıtlarından HERHANGİ birine bağlı bir başvuru varsa onu düzenler.
    const row = await env.DB.prepare(
      `SELECT * FROM consultants WHERE architect_slug IN (${slugs.map(() => '?').join(',')})
        ORDER BY updated_at DESC LIMIT 1`
    ).bind(...slugs).first();
    if (row) {
      const parsed = parseConsultantRow(row);
      application = {
        slug: parsed.slug, status: parsed.status,
        durationMin: parsed.durationMin, priceTry: parsed.priceTry,
        weekdays: parsed.weekdays, times: parsed.times,
        expertise: parsed.expertise, intro: parsed.intro,
        adminNote: row.admin_note || null,
      };
    }
  }
  return json({ candidates, application, options: consultantFormOptions() });
}

async function submitConsultantApplication(request, env, user) {
  if (!(await checkRateLimit(env, 'consultant-apply', user.id, 10, 60 * 60 * 1000))) {
    return errorJson('Çok fazla deneme yaptın. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }
  const body = await readJson(request);
  const slug = String(body.architectSlug || '').trim();

  // SAHİPLİK KAPISI: başvurulan kişi kaydı GERÇEKTEN bu hesabın olmalı. İstemcinin gönderdiği
  // slug'a güvenilmez — aksi halde herkes başkasının profilini danışmanlığa açabilirdi.
  const candidates = await fetchUserConsultantCandidates(env, user);
  const candidate = candidates.find(c => c.slug === slug);
  if (!candidate) {
    return errorJson('Bu kişi kaydı senin hesabına bağlı değil. Önce kendi kişi kaydını oluştur ya da sahiplen.', 403);
  }

  const parsed = normalizeConsultantOffer(body);
  if (!parsed.ok) return errorJson(parsed.error);
  const v = parsed.value;
  const now = Date.now();

  const existing = await env.DB.prepare(`SELECT status FROM consultants WHERE architect_slug = ?`).bind(slug).first();
  // ONAYLI BİR DANIŞMAN KENDİ TEKLİFİNİ GÜNCELLEYEBİLİR ve bu onayı DÜŞÜRMEZ: süre/ücret/saat
  // değiştirmek yeni bir başvuru değildir, aksi halde fiyatını güncelleyen danışman kendini
  // yayından düşürürdü. Değişiklik yalnızca BUNDAN SONRAKİ randevuları etkiler — mevcut randevular
  // kendi price_try/duration_min değerlerini taşır (bkz. createConsultationRequest).
  const nextStatus = existing && existing.status === 'approved' ? 'approved' : 'pending';
  await env.DB.prepare(
    `INSERT INTO consultants
       (architect_slug, user_id, duration_min, price_try, weekdays, times, expertise, intro, status, created_at, updated_at, approved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(architect_slug) DO UPDATE SET
       user_id = excluded.user_id, duration_min = excluded.duration_min, price_try = excluded.price_try,
       weekdays = excluded.weekdays, times = excluded.times, expertise = excluded.expertise,
       intro = excluded.intro, status = excluded.status, updated_at = excluded.updated_at`
  ).bind(
    slug, user.id, v.durationMin, v.priceTry, JSON.stringify(v.weekdays), JSON.stringify(v.times),
    v.expertise, v.intro, nextStatus, now, now,
  ).run();

  // Liste ucu herkese açık ve önbelleklidir — onaylı bir danışman teklifini güncellediğinde
  // /danismanlik kartının bayat kalmaması için temizlenir.
  await invalidatePublicCache(env);

  return json({ status: nextStatus, slug }, existing ? 200 : 201);
}

export async function fetchConsultantList(env) {
  const rows = await fetchApprovedConsultantRows(env);
  const items = [];
  for (const row of rows) {
    const consultant = parseConsultantRow(row);
    const a = parseCanonicalRow('architects', row);
    let officeAwards = [];
    if (row.office_awards) { try { officeAwards = JSON.parse(row.office_awards) || []; } catch { officeAwards = []; } }
    const ownAwards = Array.isArray(a.awards) ? a.awards : [];
    items.push({
      slug: consultant.slug,
      name: row.name,
      dob: a.dob || null,
      photo: a.photo_url || null,
      office: row.office_name || null,
      position: positionOf(a.position),
      positionRaw: a.position || null,
      professions: professionLabelList(a.profession),
      // ÇOKLU ÜNİVERSİTE (2026-09-16 altıncı tur madde 4) — kişi havuzuyla AYNI şekil
      // (bkz. src/routes/architect.js#fetchArchitectPool). /danismanlik sayfasının Üniversite
      // filtresi bu diziyi okur; tek okullu eski kayıtlar tek elemanlı dizi olur.
      schools: schoolNameList(a.school),
      // Kişi kartındakiyle AYNI birleşim (kendi ödülleri + bağlı firmanın ödülleri) — bkz.
      // src/routes/architect.js#fetchArchitectPool.
      awards: [...new Set([...ownAwards, ...officeAwards])],
      // Başvuruda yazılan tanıtım cümlesi varsa o, yoksa eski üretilen cümle (davranış korunur).
      intro: consultant.intro || consultationIntro(row.name),
      // "hangi alanda danışmanlık verdiklerini vs. bilgi olarak yazsınlar" (kullanıcı isteği).
      expertise: consultant.expertise || null,
      // TEKLİF ARTIK KART BAŞINA: iki danışman farklı süre/ücret/saat sunabilir, bu yüzden liste
      // düzeyinde TEK bir `offer` alanı YANLIŞ olurdu.
      offer: publicOffer(consultant),
    });
  }
  return { items, total: items.length };
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

// Slot kontrolü artık DANIŞMANIN KENDİ teklifine bakar (kullanıcı isteği, 2026-09-15: her danışman
// kendi gün ve saatlerini seçer). `consultant`, fetchApprovedConsultant'ın döndürdüğü nesnedir —
// çağıran onu ZATEN okumuş olmak zorundadır, yani kapıdan (approved mı) geçmeden buraya gelinemez.
export function isAllowedSlot(consultant, dateStr, timeStr) {
  const offer = consultant || DEFAULT_OFFER;
  const times = offer.times || DEFAULT_OFFER.times;
  const weekdays = offer.weekdays || DEFAULT_OFFER.weekdays;
  if (!isValidDate(dateStr) || !times.includes(timeStr)) return false;
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (!weekdays.includes(d.getUTCDay())) return false;
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
  const consultant = await fetchApprovedConsultant(env, hostSlug);
  if (!consultant) return errorJson('Bu profil için danışmanlık randevusu şu an açık değil.');
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
  // Teklif de dönüyor: takvim, danışmanın gün/saatlerini istemcideki bir sabitten DEĞİL buradan
  // çizsin (aksi halde iki danışmanın farklı saatleri aynı sabitle çizilirdi).
  return json({ booked, offer: publicOffer(consultant) });
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
    // Ödeme bilgisi (kullanıcı isteği, 2026-09-13). paymentProvider/paymentStatus İKİ tarafa da
    // döner (alıcı kendi durumunu görsün, danışman "ödendi mi" bilsin); havale HESAP BİLGİSİ ise
    // YALNIZCA alıcıya ve YALNIZCA ödeme hâlâ alınabilirken döner — danışmanın ekranında IBAN'ın
    // hiç işi yok ve ödenmiş bir talepte gösterilmesi ikinci bir ödemeye davet olurdu.
    paymentProvider: row.payment_provider || null,
    paymentStatus: row.payment_status || null,
    canPay: isBuyer && isPayableStatus(row),
    payment: isBuyer && isPayableStatus(row)
      ? { ...paymentOptions(env, row.price_try), account: getBankTransferAccount(env), status: row.payment_status || null }
      : null,
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
  return json(buildRoomState(env, row, access, await maybeRetryMeetOnAccess(env, row)));
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
    // Süre TALEBİN KENDİSİNDEN (0121) — danışman teklifini sonradan değiştirse bile bu odanın
    // katılım penceresi satın alındığı andaki süreyle kalır (bkz. consultationMeet.js#meetingWindow).
    durationMin: Number(r.duration_min) || CONSULTATION_DURATION_MIN,
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
  // KAPI: yalnızca ONAYLI bir `consultants` satırı randevu kabul eder (kullanıcı isteği,
  // 2026-09-15). Başvurusu onay bekleyen ya da reddedilmiş bir kişi bu noktadan geçemez.
  const consultant = await fetchApprovedConsultant(env, hostSlug);
  if (!consultant) return errorJson('Bu profil için danışmanlık randevusu şu an açık değil.');
  if (!isAllowedSlot(consultant, body.date, body.time)) return errorJson('Lütfen listelenen uygun gün ve saatlerden birini seç.');
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
  // FİYAT VE SÜRE REZERVASYON ANINDA TALEBE YAZILIR (istemciden ASLA alınmaz). Danışman sonradan
  // teklifini değiştirse bile bu randevu, satın alındığı andaki süre ve ücretle kalır — Meet
  // etkinliğinin bitişi ve görüşme odasının katılım penceresi geçmişe dönük kaymaz.
  await env.DB.prepare(
    `INSERT INTO consultation_requests
       (id, user_id, host_slug, requested_date, requested_time, price_try, duration_min, status, created_at, updated_at, payment_provider, contact_name, contact_email, contact_phone, note, room_uuid)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 'havale', ?, ?, ?, ?, ?)`
  ).bind(id, user.id, hostSlug, body.date, body.time, consultant.priceTry, consultant.durationMin, now, now, contactName, contactEmail, contactPhone, note, roomUuid).run();

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

  // Ödeme adımı (kullanıcı isteği, 2026-09-13) istemcide talep AÇILDIKTAN SONRA gösterilir, bu
  // yüzden hangi yöntemlerin GERÇEKTEN açık olduğu ve havale hesabı bu yanıtla birlikte döner —
  // istemci ayrı bir istek atmak zorunda kalmasın. Hesap bilgisi yalnızca talebi AZ ÖNCE açan,
  // giriş yapmış kullanıcıya gider (bkz. src/lib/bankTransfer.js dosya başı gerekçe).
  return json({
    id,
    status: 'pending',
    priceTry: consultant.priceTry,
    durationMin: consultant.durationMin,
    payment: { ...paymentOptions(env, consultant.priceTry), account: getBankTransferAccount(env), status: null },
  }, 201);
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
  // Yeni tarih, randevunun DANIŞMANININ güncel gün/saatlerine uymalı. Danışman onaydan çıkmışsa
  // (başvuru geri alındı/reddedildi) tarih değiştirilemez — mevcut randevu durur, yenisi yazılmaz.
  const consultant = await fetchApprovedConsultant(env, row.host_slug);
  if (!consultant) return errorJson('Bu danışman şu anda randevu kabul etmiyor.');
  if (!isAllowedSlot(consultant, body.date, body.time)) return errorJson('Lütfen listelenen uygun gün ve saatlerden birini seç.');
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

// =================================================================================================
// ÖDEME (kullanıcı isteği, 2026-09-13: "Danışmanlık Al ekranı için ödeme seçeneklerini geri getir")
// =================================================================================================

// Hangi ödeme yöntemleri GERÇEKTEN sunulabilir — sırlar tanımlı değilse yöntem HİÇ görünmez ve
// sunucu da reddeder (yarı yapılandırılmış "IBAN yok ama Ödemeyi Yaptım var" durumu oluşamaz).
// bankTransfer.account YALNIZCA talebin sahibine, yalnızca kendi talebinin ödeme adımında döner —
// IBAN kaynak kodda ya da anonim bir uçta DURMAZ (bkz. src/lib/bankTransfer.js dosya başı gerekçe).
// KART İLE ÖDEME ŞİMDİLİK KAPALI (kullanıcı isteği, 2026-09-15: "2 tane ödeme seçeneği çıksın
// 1- Havele / Eft  2- Kart ile Ödeme (Henüz aktif değil.)"). Bu bir YAPILANDIRMA durumu değil bir
// ÜRÜN KARARIDIR, bu yüzden isIyzicoConfigured'dan AYRI bir bayrak olarak durur: iyzico sırları
// tanımlı olsa bile seçenek kapalıdır. Açmak için tek satır (`false` -> isIyzicoConfigured(env)).
//
// KAPI YALNIZCA ARAYÜZDE DEĞİL: startConsultationPayment de bu bayrağa bakar ve kapalıyken
// 'iyzico' yöntemini REDDEDER — aksi halde elle hazırlanmış bir istek hâlâ checkout başlatabilirdi.
export const IYZICO_ENABLED = false;

function paymentOptions(env, priceTry) {
  return {
    priceTry: Number.isFinite(Number(priceTry)) ? Number(priceTry) : CONSULTATION_PRICE_TRY,
    iyzico: IYZICO_ENABLED && isIyzicoConfigured(env),
    // Kart seçeneği arayüzde HER ZAMAN görünür ama kapalıyken seçilemez (kullanıcı isteği:
    // "Henüz aktif değil."). İstemci bu iki bayrağı ayrı okur: `iyzico` seçilebilirliği,
    // `iyzicoComingSoon` ise kartın pasif olarak ÇİZİLECEĞİNİ söyler.
    iyzicoComingSoon: !IYZICO_ENABLED,
    bankTransfer: isBankTransferConfigured(env),
  };
}

// Ödeme hâlâ alınabilir mi? Kapalı/bitmiş bir talebe ödeme bağlanmaz ve ZATEN ödenmiş bir talep
// ikinci kez ödetilmez (kullanıcı çift ödeme yapamasın — iyzico tarafında iade süreci gerektirirdi).
function isPayableStatus(row) {
  return (row.status === 'pending' || row.status === 'approved') && row.payment_status !== 'paid';
}

// POST /api/consultations/:id/payment — { method: 'iyzico' | 'havale', ...iyzico alıcı alanları }
//
// Bu uç REZERVASYON OLUŞTURMAZ: talep zaten createConsultationRequest ile açılmış ve slot tutulmuş
// olmalıdır ("önce talep, sonra ödeme" — kullanıcı kararı, bkz. dosya başı akış notu). Yetki her
// istekte yeniden kurulur: yalnızca talebin SAHİBİ ödeyebilir (host bile ödeyemez).
async function startConsultationPayment(request, env, user, consultationId) {
  if (!(await checkRateLimit(env, 'consultation-payment', user.id, 10, 60 * 60 * 1000))) {
    return errorJson('Çok fazla deneme yaptın. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }

  const row = await env.DB.prepare(
    `SELECT id, user_id, host_slug, status, price_try, payment_status, requested_date, requested_time, contact_name, contact_phone
     FROM consultation_requests WHERE id = ?`
  ).bind(consultationId).first();
  // Var olmayan ve "bana ait olmayan" talep AYNI yanıtı döner — başkasının talep kimliğinin geçerli
  // olup olmadığı sızdırılmaz (getConsultationDetail'deki AYNI kural).
  if (!row || row.user_id !== user.id) return errorJson('Görüşme talebi bulunamadı.', 404);
  if (row.payment_status === 'paid') return errorJson('Bu görüşmenin ödemesi zaten alınmış.');
  if (!isPayableStatus(row)) return errorJson('Bu talep için ödeme alınamaz.');

  const body = await readJson(request);
  const method = typeof body.method === 'string' ? body.method.trim() : '';
  const now = Date.now();

  // ---- Havale/EFT: kullanıcı BEYANI -------------------------------------------------------------
  // "Ödemeyi Yaptım" bir DOĞRULAMA DEĞİLDİR, yalnızca admin'e "ekstreye bak" sinyalidir — bu yüzden
  // payment_status 'declared' olur, ASLA 'paid'. Tek otomatik 'paid' yolu iyzico'nun sunucu-sunucu
  // doğrulamasıdır (bkz. settleConsultationPayment).
  if (method === 'havale') {
    if (!isBankTransferConfigured(env)) return errorJson('Havale/EFT şu anda kullanılamıyor.', 503);
    await env.DB.prepare(
      `UPDATE consultation_requests SET payment_provider = 'havale', payment_status = 'declared', updated_at = ? WHERE id = ?`
    ).bind(now, row.id).run();
    // Host'a bilgi: ekstreden doğrulanacak bir beyan var. createNotification kendi try/catch'ini
    // taşır (bkz. src/lib/notify.js) — beyanın KAYDI bu adıma bağlı değildir.
    const host = await env.DB.prepare(`SELECT claimed_by_user_id FROM architects WHERE slug = ?`).bind(row.host_slug).first();
    if (host && host.claimed_by_user_id) {
      await createNotification(
        env, host.claimed_by_user_id, 'consultation_payment_declared',
        'Danışmanlık ödemesi beyan edildi',
        `${row.contact_name || 'Bir kullanıcı'}, ${row.requested_date} ${row.requested_time} randevusu için havale/EFT yaptığını bildirdi. Banka ekstresinden doğrulayıp talebi onaylayabilirsin.`,
        `consultation:${row.id}`,
      );
    }
    return json({ method: 'havale', paymentStatus: 'declared' });
  }

  // ---- iyzico: hosted Checkout Form -------------------------------------------------------------
  if (method !== 'iyzico') return errorJson('Geçersiz ödeme yöntemi.');
  // Ürün kararı kapısı (bkz. IYZICO_ENABLED) — arayüzdeki "Henüz aktif değil." etiketinin sunucu
  // tarafındaki karşılığı. Arayüzü gizlemek tek başına bir kapı DEĞİLDİR.
  if (!IYZICO_ENABLED) {
    return errorJson('Kart ile ödeme henüz aktif değil. Lütfen havale/EFT seçeneğini kullan.', 503);
  }
  if (!isIyzicoConfigured(env)) {
    return errorJson('Kart ile ödeme şu anda kullanılamıyor. Lütfen havale/EFT seçeneğini kullan ya da daha sonra tekrar dene.', 503);
  }

  // Alıcı alanları iyzico'nun ZORUNLU alanlarıdır; D1'e YAZILMAZ, yalnızca iyzico'ya iletilir
  // (src/routes/payments.js#startCheckout ile AYNI veri minimizasyonu kuralı).
  const name = String(body.name || '').trim().slice(0, 100);
  const surname = String(body.surname || '').trim().slice(0, 100);
  const identityNumber = String(body.identityNumber || '').trim();
  const address = String(body.address || '').trim().slice(0, 300);
  const city = String(body.city || '').trim().slice(0, 80);
  // Telefon: ödeme formunda boş bırakılırsa talebin kendi iletişim telefonuna düşülür — kullanıcı
  // aynı numarayı iki kez yazmak zorunda kalmasın.
  const gsmNumber = normalizeGsm(body.phone || row.contact_phone);

  if (!name || !surname) return errorJson('Ad ve soyad gerekli.');
  if (!isValidTcKimlik(identityNumber)) return errorJson('Geçerli bir T.C. Kimlik Numarası gir.');
  if (!gsmNumber) return errorJson('Geçerli bir cep telefonu numarası gir.');
  if (!address || address.length < 8) return errorJson('Geçerli bir adres gir.');
  if (!city) return errorJson('Şehir gerekli.');

  // Tutar İSTEMCİDEN asla alınmaz: talebin D1'deki price_try'ı esastır (rezervasyon anında sunucu
  // yazdı). Böylece fiyat sabiti sonradan değişse bile kullanıcı, talebi açtığı andaki fiyatı öder.
  const price = Number(row.price_try || CONSULTATION_PRICE_TRY);
  const priceStr = price.toFixed(2);
  const origin = new URL(request.url).origin;
  const fullName = `${name} ${surname}`;
  const payload = {
    locale: 'tr',
    conversationId: `${CONSULTATION_CONVERSATION_PREFIX}${row.id}`,
    price: priceStr,
    paidPrice: priceStr,
    currency: 'TRY',
    paymentGroup: 'PRODUCT',
    enabledInstallments: [1],
    callbackUrl: `${origin}/api/payments/callback`,
    buyer: {
      id: user.id,
      name, surname,
      identityNumber,
      email: user.email,
      gsmNumber,
      registrationAddress: address,
      city,
      country: 'Turkey',
      ip: clientIp(request),
    },
    billingAddress: { address, contactName: fullName, city, country: 'Turkey' },
    shippingAddress: { address, contactName: fullName, city, country: 'Turkey' },
    basketItems: [
      { id: 'consultation', price: priceStr, name: 'MİMARLAB birebir danışmanlık görüşmesi (45 dk)', category1: 'Danışmanlık', itemType: 'VIRTUAL' },
    ],
  };

  let result;
  try {
    result = await initializeCheckoutForm(env, payload);
  } catch (err) {
    console.error('iyzico consultation initialize failed', err);
    return errorJson('Ödeme başlatılamadı, lütfen tekrar dene.', 502);
  }
  if (result.status !== 'success' || !result.paymentPageUrl) {
    return errorJson(result.errorMessage || 'Ödeme başlatılamadı, lütfen tekrar dene.', 502);
  }

  // gerçek bulgu / rozet akışından FARK: burada talep 'rejected' YAPILMAZ. Rozet akışında
  // badge_requests satırı ödemenin KENDİSİ için açılır, danışmanlıkta satır RANDEVUDUR — başarısız
  // bir kart denemesi randevuyu iptal etmemeli, yalnızca ödeme durumunu işaretlemeli.
  await env.DB.prepare(
    `UPDATE consultation_requests SET payment_provider = 'iyzico', payment_status = 'pending', payment_token = ?, updated_at = ? WHERE id = ?`
  ).bind(result.token || null, now, row.id).run();

  return json({ method: 'iyzico', paymentPageUrl: result.paymentPageUrl });
}

// iyzico callback'inin danışmanlık dalı (src/routes/payments.js#handleCallback çağırır). Ödemenin
// başarılı olup olmadığı ORADA, token ile sunucu-sunucu doğrulanmıştır; burada yalnızca D1 yazımı
// ve bildirim var. Dönüş: satır bulunup güncellendiyse true.
//
// İDEMPOTENCY: koşullu UPDATE (payment_status != 'paid') — callback iki kez gelirse ikinci çağrı
// satırı ZATEN 'paid' bulur, tekrar yazmaz ve İKİNCİ bildirim gitmez (consultationMeet.js'in
// "onay/ödeme geri çağrısı iki kez gelirse" kuralıyla AYNI gerekçe).
export async function settleConsultationPayment(env, consultationId, paid, paymentId) {
  const row = await env.DB.prepare(
    `SELECT id, user_id, host_slug, requested_date, requested_time, contact_name, payment_status
     FROM consultation_requests WHERE id = ?`
  ).bind(consultationId).first();
  if (!row) return false;
  if (row.payment_status === 'paid') return true; // çift callback — sessizce başarı

  const now = Date.now();
  if (!paid) {
    await env.DB.prepare(
      `UPDATE consultation_requests SET payment_status = 'failed', updated_at = ? WHERE id = ? AND payment_status != 'paid'`
    ).bind(now, row.id).run();
    return true;
  }

  const res = await env.DB.prepare(
    `UPDATE consultation_requests SET payment_status = 'paid', payment_id = ?, paid_at = ?, updated_at = ?
     WHERE id = ? AND payment_status != 'paid'`
  ).bind(paymentId, now, now, row.id).run();
  if (!res.meta || res.meta.changes !== 1) return true; // eşzamanlı ikinci callback yazdı

  // Bildirimler best-effort: ödeme ZATEN doğrulanıp yazıldıktan sonra çalışır, atarsa kullanıcı
  // parası çekilmiş olmasına rağmen çıplak bir hataya düşmemeli (payments.js'teki AYNI gerekçe).
  try {
    await createNotification(
      env, row.user_id, 'consultation_payment_received',
      'Danışmanlık ödemen alındı',
      `${row.requested_date} ${row.requested_time} randevun için ödemen alındı. Talebin onaylandığında görüşme odan Hesabım > Bildirimler'e düşecek.`,
      `consultation:${row.id}`,
    );
    const host = await env.DB.prepare(`SELECT claimed_by_user_id FROM architects WHERE slug = ?`).bind(row.host_slug).first();
    if (host && host.claimed_by_user_id) {
      await createNotification(
        env, host.claimed_by_user_id, 'consultation_payment_received',
        'Danışmanlık ödemesi alındı',
        `${row.contact_name || 'Bir kullanıcı'}, ${row.requested_date} ${row.requested_time} randevusunun ödemesini kartla tamamladı.`,
        `consultation:${row.id}`,
      );
    }
  } catch (err) {
    console.error('consultation payment notification failed', err);
  }
  return true;
}
