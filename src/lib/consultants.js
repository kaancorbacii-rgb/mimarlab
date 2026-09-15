// DANIŞMAN KADROSU — "kim danışmandır ve teklifi nedir" sorusunun TEK kaynağı.
// (kullanıcı isteği, 2026-09-15: "Danışman Ol sayfasını tasarla ... kişiler kaç dakikalık görüşme
//  verebileceklerini (30, 45 veya 60dk), bu görüşme saatlerinin kaç TL olduğunu ve hangi tarihlerde
//  müsait olduklarını seçsinler.")
//
// ÖNCEDEN bu bilgi KAYNAK KODDAYDI ve TEK bir teklif vardı: consultations.js#ALLOWED_HOST_SLUGS
// (yalnızca 'kaan-corbaci'), CONSULTATION_PRICE_TRY, CONSULTATION_DURATION_MIN, ALLOWED_WEEKDAYS,
// ALLOWED_TIMES. Yeni bir danışman eklemek DEPLOY gerektiriyordu ve iki danışmanın farklı
// süre/ücret sunması imkânsızdı. Artık kaynak `consultants` tablosudur (bkz.
// migrations/0121_consultants.sql).
//
// ESKİ SABİTLER SİLİNMEDİ, VARSAYILAN OLDULAR (DEFAULT_OFFER): tablo boşken ya da bir satır
// okunamazken akış çökmesin, bugünkü davranışa düşsün. Bu bir "sessizce eski değere dön" tuzağı
// DEĞİL — kapı (approved satırı var mı) ayrı ve ASLA varsayılana düşmez; yalnızca teklifin
// alanları düşer.
import { fetchOwnArchitectRows } from './claimedProfiles.js';

// Kullanıcının seçebileceği görüşme süreleri (kullanıcı isteği: 30, 45 veya 60dk). SQL tarafındaki
// kopya migrations/0121_consultants.sql#CHECK — ayrışırsa D1 yazmayı reddeder, yani sessiz kalmaz.
export const CONSULTANT_DURATIONS = [30, 45, 60];
// Seçilebilir saatler — tam saatler. Danışman bunların bir ALT KÜMESİNİ seçer.
export const CONSULTANT_TIME_SLOTS = [
  '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00',
  '16:00', '17:00', '18:00', '19:00', '20:00', '21:00',
];
// Date#getUTCDay uzayı: 0=Pazar … 6=Cumartesi (consultations.js'in gün kontrolü zaten burada).
export const CONSULTANT_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
export const WEEKDAY_NAMES_TR = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

export const MAX_PRICE_TRY = 100000;
export const MAX_EXPERTISE_LEN = 1500;
export const MAX_INTRO_LEN = 400;

// Tablo satırı bulunamadığında kullanılan teklif — 2026-09-15 öncesinin GLOBAL sabitleriyle birebir
// aynı (bkz. dosya başı). Buradaki değerler consultations.js/consultationMeet.js'teki sabitlerden
// KOPYALANMAZ, onlar buradan okur: tek kaynak burasıdır.
export const DEFAULT_OFFER = Object.freeze({
  durationMin: 45,
  priceTry: 1500,
  weekdays: Object.freeze([1, 3, 5]),
  times: Object.freeze(['18:00', '19:00', '20:00']),
});

export const CONSULTANT_STATUSES = new Set(['pending', 'approved', 'rejected']);

// Randevu saatlerinin zaman dilimi. BURADA durmasının sebebi bağımlılık yönüdür: consultationMeet.js
// bu modülden DEFAULT_OFFER'ı okuyor, dolayısıyla tersine bir import (buradan oraya) iki modül
// arasında döngü yaratırdı. consultationMeet.js bunu kendi adıyla yeniden dışa aktarır, yani
// mevcut çağıranların hiçbiri değişmedi.
export const CONSULTATION_TIMEZONE = 'Europe/Istanbul';

// Danışmanın teklifinin HERKESE AÇIK gösterimi. Tek yerde toplanır çünkü ÜÇ uç birden döndürüyor
// (/api/consultants, /api/consultations/availability, /api/architect/:slug) ve alanların adı/şekli
// ayrışırsa istemcideki tek çizim kodu iki yanıttan birini sessizce yanlış okur.
export function publicOffer(consultant) {
  const c = consultant || DEFAULT_OFFER;
  return {
    priceTry: c.priceTry,
    durationMin: c.durationMin,
    timezone: CONSULTATION_TIMEZONE,
    // Pazartesi=1 … Pazar=0 (Date#getUTCDay) — istemci etiketleri bu sayılardan üretir.
    weekdays: [...(c.weekdays || DEFAULT_OFFER.weekdays)].sort((a, b) => a - b),
    times: [...(c.times || DEFAULT_OFFER.times)].sort(),
  };
}

// "{Ad}; mimarlık kariyeri, ..." — başvuruda kendi tanıtım cümlesini yazmayan danışman için
// üretilen VARSAYILAN cümle. js/components/consultation-modal.js#open aynı cümleyi hâlâ kendi
// içinde taşır ama YALNIZCA geri düşüş olarak; iki kopyanın ayrışmasını
// scripts/test-2026-09-15-danismanlik-page.mjs kelepçeler.
export function consultationIntro(name) {
  return `${name}; mimarlık kariyeri, portföy geliştirme ve dijital ürün/yayıncılık alanlarında birebir online mentörlük görüşmesi sunar.`;
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const out = JSON.parse(value);
    return Array.isArray(out) ? out : null;
  } catch { return null; }
}

// D1 satırı -> istemciye/akışa verilen teklif nesnesi. Bozuk/boş bir JSON kolonu satırı ÇÖPE ATMAZ,
// yalnızca o alanı varsayılana düşürür — bir danışmanın saat listesi bozulduğu için randevu
// sisteminin tamamen kapanması, sessiz ve orantısız bir hata olurdu.
export function parseConsultantRow(row) {
  if (!row) return null;
  const weekdays = (parseJsonArray(row.weekdays) || [])
    .map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
  const times = (parseJsonArray(row.times) || [])
    .map(t => String(t || '').trim()).filter(t => CONSULTANT_TIME_SLOTS.includes(t));
  const durationMin = CONSULTANT_DURATIONS.includes(Number(row.duration_min))
    ? Number(row.duration_min) : DEFAULT_OFFER.durationMin;
  const priceTry = Number.isFinite(Number(row.price_try)) && Number(row.price_try) >= 0
    ? Number(row.price_try) : DEFAULT_OFFER.priceTry;
  return {
    slug: row.architect_slug,
    userId: row.user_id || null,
    status: row.status || 'pending',
    durationMin,
    priceTry,
    weekdays: weekdays.length ? [...new Set(weekdays)].sort((a, b) => a - b) : [...DEFAULT_OFFER.weekdays],
    times: times.length ? [...new Set(times)].sort() : [...DEFAULT_OFFER.times],
    expertise: row.expertise || null,
    intro: row.intro || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    approvedAt: row.approved_at || null,
  };
}

// RANDEVU KAPISI. Yalnızca 'approved' satır döner — bir başvurunun (pending) ya da reddedilmiş bir
// kaydın randevu alması imkânsızdır. consultations.js'teki HER randevu yolu (uygunluk, oluşturma,
// yeniden planlama, ödeme) bu fonksiyondan geçer.
export async function fetchApprovedConsultant(env, slug) {
  const key = String(slug || '').trim();
  if (!key) return null;
  const row = await env.DB.prepare(
    `SELECT * FROM consultants WHERE architect_slug = ? AND status = 'approved'`
  ).bind(key).first();
  return parseConsultantRow(row);
}

// /danismanlik listesinin havuzu — onaylı danışmanlar, kişi künyesiyle birlikte.
// hidden_at/deleted_at kapısı BURADA: gizlenmiş bir kişi kaydı listede görünmemeli, ama
// `consultants` satırı silinmemeli (admin kaydı geri yayına alınca danışmanlık da geri gelsin).
export async function fetchApprovedConsultantRows(env) {
  const { results } = await env.DB.prepare(
    // directory_listed kapısı BİLEREK YOK — danışman olmak, /kisi dizininde listelenmekten
    // bağımsızdır (bkz. src/routes/architect.js#handleArchitectNamesRoute'taki AYNI gerekçe).
    `SELECT c.*, a.id AS architect_id, a.name, a.dob, a.photo_url, a.position, a.profession,
            a.school, a.awards, o.name AS office_name, o.awards AS office_awards
       FROM consultants c
       JOIN architects a ON a.slug = c.architect_slug
       LEFT JOIN offices o ON o.id = a.office_id AND o.deleted_at IS NULL
      WHERE c.status = 'approved' AND a.deleted_at IS NULL AND a.hidden_at IS NULL
      ORDER BY c.approved_at ASC, c.created_at ASC`
  ).all();
  return results || [];
}

// Başvuru/düzenleme girdisini doğrular. İSTEMCİYE GÜVENİLMEZ: danisman-ol.html de admin paneli de
// AYNI bu fonksiyondan geçer, yani iki yüzeyin kuralı ayrışamaz.
// Dönüş: { ok: true, value } | { ok: false, error }
export function normalizeConsultantOffer(input) {
  const src = input || {};

  const durationMin = Number(src.durationMin);
  if (!CONSULTANT_DURATIONS.includes(durationMin)) {
    return { ok: false, error: `Görüşme süresi ${CONSULTANT_DURATIONS.join(', ')} dakikadan biri olmalı.` };
  }

  // Ücret: tam sayı TL. 0 serbesttir (ücretsiz danışmanlık) — üst sınır yalnızca yazım hatasına
  // (fazladan sıfır) karşı.
  const priceTry = Math.round(Number(src.priceTry));
  if (!Number.isFinite(priceTry) || priceTry < 0 || priceTry > MAX_PRICE_TRY) {
    return { ok: false, error: `Ücret 0 ile ${MAX_PRICE_TRY.toLocaleString('tr-TR')} TL arasında olmalı.` };
  }

  const weekdays = [...new Set((Array.isArray(src.weekdays) ? src.weekdays : [])
    .map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b);
  if (!weekdays.length) return { ok: false, error: 'En az bir müsait gün seç.' };

  const times = [...new Set((Array.isArray(src.times) ? src.times : [])
    .map(t => String(t || '').trim()).filter(t => CONSULTANT_TIME_SLOTS.includes(t)))].sort();
  if (!times.length) return { ok: false, error: 'En az bir müsait saat seç.' };

  const expertise = String(src.expertise || '').trim().slice(0, MAX_EXPERTISE_LEN);
  if (expertise.length < 30) {
    return { ok: false, error: 'Hangi alanlarda danışmanlık verdiğini en az 30 karakterle anlat.' };
  }
  const intro = String(src.intro || '').trim().slice(0, MAX_INTRO_LEN) || null;

  return { ok: true, value: { durationMin, priceTry, weekdays, times, expertise, intro } };
}

// Bir kullanıcının BAŞVURABİLECEĞİ kişi kayıtları: sitede kendi adına sahiplendiği (claimed) ya da
// kendi eklediği canonical `architects` satırları.
//
// DANIŞMAN OLMAK KİŞİ KAYDI GEREKTİRİR ve bu bir tercih değil YAPISAL bir zorunluluktur:
// consultation_requests.host_slug bir architects.slug'dır, görüşme odasının yetkisi
// architects.claimed_by_user_id'den kurulur ve "Danışmanlık Al" düğmesi kişi pop-up'ında yaşar.
// Kaydı olmayan bir başvuru sahibi /kisi-ekle'ye yönlendirilir (bkz. danisman-ol.html).
export async function fetchUserConsultantCandidates(env, user) {
  if (!user) return [];
  // Sahiplik kararı BURADA YENİDEN VERİLMEZ: claimedProfiles.js#fetchOwnArchitectRows zaten
  // sitenin "bu kişi kaydı bu hesabındır" tanımıdır (admin ataması + kaydı kendi açmış olmak; ad
  // eşleşmesi YOK — bkz. CLAUDE.md 2026-09-14 ikinci tur). İkinci bir sorgu yazmak, o tanımın
  // sessizce ayrışabileceği ikinci bir yer açardı. Burada yalnızca kart için gereken alanlar
  // (fotoğraf/meslek) ayrıca okunur.
  const { claimed, selfNamed } = await fetchOwnArchitectRows(env, user);
  const rows = [...claimed, ...selfNamed].filter(r => r.slug);
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const { results } = await env.DB.prepare(
    `SELECT id, slug, name, profession, position, photo_url FROM architects
      WHERE id IN (${ids.map(() => '?').join(', ')}) ORDER BY name`
  ).bind(...ids).all();
  const seen = new Set();
  const out = [];
  for (const r of results || []) {
    if (!r.slug || seen.has(r.slug)) continue;
    seen.add(r.slug);
    out.push({ slug: r.slug, name: r.name, profession: r.profession || null, position: r.position || null, photo: r.photo_url || null });
  }
  return out;
}
