// Güvenli Görüşme Gateway'i — danışmanlık rezervasyonu ↔ Google Meet orkestrasyonu (kullanıcı
// isteği, 2026-09-08). Google'la konuşan tek yer src/lib/googleMeet.js; BU dosya D1 tarafını
// (idempotency, durum makinesi, oda kimliği, zaman penceresi, erişim kararı, bildirim) taşır.
//
// AKIŞ: admin havaleyi onaylar (src/routes/admin.js#handleConsultationsAdmin, status -> 'approved')
//   -> createMeetForConsultation -> Google Meet -> D1 (meet_link/meet_event_id/meet_status='ready')
//   -> alıcı + danışmana bildirim (link /gorusme/:room_uuid — Meet adresi ASLA bildirime yazılmaz).
//
// İDEMPOTENCY (kullanıcı isteği: "onay/ödeme geri çağrısı iki kez gelirse ikinci Meet
// oluşturulmasın") üç katmanlı:
//   1. meet_link doluysa hiç Google'a gidilmez.
//   2. Tek satırlık koşullu UPDATE ile 'creating' kilidi alınır (meta.changes === 1 olan tek
//      çağıran devam eder; eşzamanlı ikinci çağıran 'in_progress' ile döner).
//   3. Google tarafında conferenceData.createRequest.requestId = oda kimliğinden türetilir; aynı
//      requestId ile ikinci istek Google'da yeni konferans ÜRETMEZ.
//
// HATA: Google başarısız olursa rezervasyon/onay GERİ ALINMAZ ve satır bozulmaz — yalnızca
// meet_status='failed' + kısa/temiz meet_error yazılır, sonra (a) cron turunda, (b) yetkili taraf
// odayı açtığında (5 dk'da en fazla 1 deneme) ve (c) admin panelindeki düğmeyle yeniden denenir.
// Bu fonksiyonlar ASLA fırlatmaz (onay isteği ya da gateway isteği bu yüzden 500'e düşmemeli).

import { createMeetEvent, isGoogleMeetConfigured, missingMeetSecrets, safeErrorMessage } from './googleMeet.js';
import { createNotification } from './notify.js';
import { checkRateLimit } from './rateLimit.js';

// Takvim/saat sözleşmesi mevcut rezervasyon sistemiyle AYNI: saatler İstanbul (GMT+3) — bkz.
// js/components/consultation-modal.js'teki "Görüşme süresi 45 dakikadır. Saatler İstanbul (GMT+3)
// zaman dilimine göredir." uyarısı. Türkiye 2016'dan beri yaz saati uygulamıyor, ofset SABİT +03:00
// (bkz. wrangler.jsonc#triggers yorumundaki aynı gerekçe).
export const CONSULTATION_TIMEZONE = 'Europe/Istanbul';
export const CONSULTATION_UTC_OFFSET = '+03:00';
export const CONSULTATION_DURATION_MIN = 45;
export const JOIN_EARLY_MIN = 15;
// 'creating' kilidi bu süreden eskiyse (çökmüş/zaman aşımına uğramış bir deneme) devralınabilir.
const CREATING_LOCK_STALE_MS = 2 * 60 * 1000;
// Yetkili taraf odayı açtığında yapılan fırsatçı yeniden deneme: rezervasyon başına 5 dk'da 1.
const ACCESS_RETRY_WINDOW_MS = 5 * 60 * 1000;

export const ROOM_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function roomPath(roomUuid) {
  return `/gorusme/${encodeURIComponent(roomUuid)}`;
}

// Görüşmenin GERÇEK başlangıç anı (epoch ms). requested_date 'YYYY-MM-DD', requested_time 'HH:MM'.
export function consultationStartMs(row) {
  return Date.parse(`${row.requested_date}T${row.requested_time}:00${CONSULTATION_UTC_OFFSET}`);
}

// Zaman penceresi — TEK gerçek kaynak sunucu saatidir (nowMs parametresi yalnızca testler ve cron
// için; istemci saati HİÇBİR karara girmez).
//   waiting : katılım penceresi henüz açılmadı (başlangıç - 15 dk'dan önce)
//   soon    : başlangıç - 15 dk .. başlangıç  ("15 dakika içinde başlayacak", buton AKTİF)
//   open    : başlangıç .. başlangıç + 45 dk  (buton AKTİF)
//   ended   : başlangıç + 45 dk sonrası
export function meetingWindow(row, nowMs = Date.now()) {
  const startsAt = consultationStartMs(row);
  const endsAt = startsAt + CONSULTATION_DURATION_MIN * 60 * 1000;
  const joinOpensAt = startsAt - JOIN_EARLY_MIN * 60 * 1000;
  let phase;
  if (Number.isNaN(startsAt)) phase = 'invalid';
  else if (nowMs < joinOpensAt) phase = 'waiting';
  else if (nowMs < startsAt) phase = 'soon';
  else if (nowMs < endsAt) phase = 'open';
  else phase = 'ended';
  return { startsAt, endsAt, joinOpensAt, phase, joinable: phase === 'soon' || phase === 'open' };
}

// Erişim kararı — getConsultationDetail/createConsultationAction ile AYNI kural (bkz.
// src/routes/consultations.js): yalnızca rezervasyonu satın alan (row.user_id) VEYA host profilini
// sahiplenmiş kullanıcı (architects.claimed_by_user_id). Kimlikler hard-code edilmez, satırdan
// türetilir. Host satırı gateway sayfasındaki danışman künyesi için de döner.
export async function resolveConsultationAccess(env, user, row) {
  const host = await env.DB.prepare(
    `SELECT slug, name, photo_url, position, profession, claimed_by_user_id FROM architects WHERE slug = ?`
  ).bind(row.host_slug).first();
  const isBuyer = !!user && row.user_id === user.id;
  const isHost = !!user && !isBuyer && !!(host && host.claimed_by_user_id && host.claimed_by_user_id === user.id);
  return { isBuyer, isHost, allowed: isBuyer || isHost, host: host || null };
}

// Oda kimliği: crypto.randomUUID() (Web Crypto CSPRNG, 122 bit rastgelelik). Yeni rezervasyonlar
// oluşturulurken atanır; bu özellikten ÖNCE açılmış satırlar için ilk ihtiyaç anında (onay/Meet
// oluşturma/detay) burada tembel atanır. Koşullu UPDATE + yeniden okuma, eşzamanlı iki çağıranın
// farklı kimlik yazmasını engeller (UNIQUE index ikinci yazımı zaten reddederdi).
export async function ensureRoomUuid(env, row) {
  if (row.room_uuid) return row.room_uuid;
  const candidate = crypto.randomUUID();
  await env.DB.prepare(
    `UPDATE consultation_requests SET room_uuid = ? WHERE id = ? AND room_uuid IS NULL`
  ).bind(candidate, row.id).run();
  const fresh = await env.DB.prepare(`SELECT room_uuid FROM consultation_requests WHERE id = ?`).bind(row.id).first();
  row.room_uuid = (fresh && fresh.room_uuid) || candidate;
  return row.room_uuid;
}

function localWallClock(row, offsetMin) {
  // 'YYYY-MM-DDTHH:MM:00' — Google'a timeZone ile birlikte verilir; +45 dk için Date üzerinden
  // ilerletip yeniden İstanbul duvar saatine çeviririz (gece yarısı taşması dahil doğru).
  const ms = consultationStartMs(row) + offsetMin * 60 * 1000;
  const d = new Date(ms + 3 * 60 * 60 * 1000); // +03:00 -> UTC alanlarını duvar saati olarak oku
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00`;
}

async function markFailed(env, id, message, nowMs) {
  await env.DB.prepare(
    `UPDATE consultation_requests SET meet_status = 'failed', meet_error = ?, updated_at = ? WHERE id = ? AND meet_link IS NULL`
  ).bind(message, nowMs, id).run();
}

async function notifyMeetReady(env, row, host) {
  const link = roomPath(row.room_uuid);
  await createNotification(
    env, row.user_id, 'consultation_meet_ready',
    'Danışmanlık görüşmen hazır',
    'Danışmanlık görüşmeniz hazır. Görüşme saatinde katılabilirsiniz.',
    link,
  );
  if (host && host.claimed_by_user_id && host.claimed_by_user_id !== row.user_id) {
    await createNotification(
      env, host.claimed_by_user_id, 'consultation_meet_ready',
      'Danışmanlık görüşmesi hazır',
      `${row.contact_name || 'Kullanıcı'} ile ${row.requested_date} ${row.requested_time} görüşmesi için Google Meet odası hazır.`,
      link,
    );
  }
}

// Sonuç: { status: 'ready'|'failed'|'skipped', meetLink?, error?, reason? } — ASLA fırlatmaz.
export async function createMeetForConsultation(env, consultationId, {
  fetchImpl = fetch, now = Date.now, sleep, origin = 'https://mimarlab.com',
} = {}) {
  try {
    const row = await env.DB.prepare(`SELECT * FROM consultation_requests WHERE id = ?`).bind(consultationId).first();
    if (!row) return { status: 'skipped', reason: 'not_found' };
    if (row.status !== 'approved') return { status: 'skipped', reason: 'not_approved' };
    // 1) Zaten var — ikinci Meet ASLA oluşturulmaz.
    if (row.meet_link) return { status: 'ready', meetLink: row.meet_link, alreadyExisted: true };

    const nowMs = now();
    await ensureRoomUuid(env, row);

    // 2) Kilit — tek satırlık koşullu UPDATE. Eşzamanlı ikinci çağıran changes=0 görür ve çekilir.
    const claim = await env.DB.prepare(
      `UPDATE consultation_requests SET meet_status = 'creating', updated_at = ?
       WHERE id = ? AND meet_link IS NULL
         AND (meet_status IS NULL OR meet_status = 'failed' OR (meet_status = 'creating' AND updated_at < ?))`
    ).bind(nowMs, row.id, nowMs - CREATING_LOCK_STALE_MS).run();
    const changes = claim && claim.meta ? Number(claim.meta.changes) : 0;
    if (changes !== 1) return { status: 'skipped', reason: 'in_progress' };

    // 3) Yapılandırma eksikse uygulama BOZULMAZ: net bir hata kaydı, satır olduğu gibi kalır.
    if (!isGoogleMeetConfigured(env)) {
      const message = `config_missing: ${missingMeetSecrets(env).join(', ')}`;
      await markFailed(env, row.id, message, nowMs);
      return { status: 'failed', error: message };
    }

    const { host } = await resolveConsultationAccess(env, null, row);
    const hostName = host && host.name ? host.name : row.host_slug;
    try {
      const { eventId, meetLink } = await createMeetEvent(env, {
        summary: `MİMARLAB Danışmanlık — ${row.contact_name || 'Kullanıcı'} & ${hostName}`,
        description: `MİMARLAB danışmanlık görüşmesi (${CONSULTATION_DURATION_MIN} dk).\nGüvenli görüşme odası: ${origin}${roomPath(row.room_uuid)}`,
        startIso: localWallClock(row, 0),
        endIso: localWallClock(row, CONSULTATION_DURATION_MIN),
        timeZone: CONSULTATION_TIMEZONE,
        requestId: `mimarlab-${row.room_uuid}`,
        privateProps: { mimarlab_consultation_id: row.id },
      }, { fetchImpl, now, sleep });

      const saved = await env.DB.prepare(
        `UPDATE consultation_requests
           SET meet_link = ?, meet_event_id = ?, meet_status = 'ready', meet_error = NULL, meet_created_at = ?, updated_at = ?
         WHERE id = ? AND meet_link IS NULL`
      ).bind(meetLink, eventId, new Date(now()).toISOString(), now(), row.id).run();
      if (!(saved && saved.meta && Number(saved.meta.changes) === 1)) {
        // Yarış: bir başkası bu arada yazmış — onunkini döndür, ikinci bir bildirim de gitmesin.
        const other = await env.DB.prepare(`SELECT meet_link FROM consultation_requests WHERE id = ?`).bind(row.id).first();
        return { status: 'ready', meetLink: other && other.meet_link, alreadyExisted: true };
      }
      await notifyMeetReady(env, row, host);
      return { status: 'ready', meetLink, eventId };
    } catch (err) {
      const message = safeErrorMessage(err);
      console.error('meet create failed', JSON.stringify({ consultation_id: row.id, error: message }));
      await markFailed(env, row.id, message, now());
      return { status: 'failed', error: message };
    }
  } catch (err) {
    // D1 gibi beklenmeyen bir hata — çağıran akışı (admin onayı / gateway) KESİNLİKLE düşürmez.
    const message = safeErrorMessage(err);
    console.error('meet orchestration failed', JSON.stringify({ consultation_id: consultationId, error: message }));
    return { status: 'failed', error: message };
  }
}

// Yetkili taraf odayı/detayı açtığında fırsatçı yeniden deneme — yalnızca onaylı, Meet'siz ve
// görüşmesi henüz bitmemiş satırlar için, rezervasyon başına 5 dk'da 1 (rate_limits tablosu
// zaten var olan kelepçe mekanizmasıdır, yeni kolon gerekmez). Güncel satırı döner.
export async function maybeRetryMeetOnAccess(env, row, options = {}) {
  const now = options.now || Date.now;
  if (row.status !== 'approved' || row.meet_link) return row;
  if (row.meet_status === 'creating') return row;
  if (meetingWindow(row, now()).phase === 'ended') return row;
  if (!(await checkRateLimit(env, 'meet-retry', row.id, 1, ACCESS_RETRY_WINDOW_MS))) return row;
  await createMeetForConsultation(env, row.id, options);
  const fresh = await env.DB.prepare(`SELECT * FROM consultation_requests WHERE id = ?`).bind(row.id).first();
  return fresh || row;
}

// Cron turu (bkz. src/index.js#handleScheduled): onaylı ama Meet'i olmayan, görüşmesi henüz
// geçmemiş satırları toplu olarak yeniden dener. Tur başına en fazla `limit` satır.
export async function retryPendingMeets(env, { now = Date.now, fetchImpl = fetch, limit = 10, sleep } = {}) {
  const nowMs = now();
  // requested_date bugünden (İstanbul) en fazla 1 gün geride olanlar — kesin süzme JS'te.
  const cutoffDate = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(
    `SELECT * FROM consultation_requests
      WHERE status = 'approved' AND meet_link IS NULL AND (meet_status IS NULL OR meet_status = 'failed')
        AND requested_date >= ?
      ORDER BY requested_date ASC, requested_time ASC LIMIT ?`
  ).bind(cutoffDate, limit).all();
  const stats = { scanned: 0, ready: 0, failed: 0, skipped: 0 };
  for (const row of results || []) {
    stats.scanned++;
    if (meetingWindow(row, nowMs).phase === 'ended') { stats.skipped++; continue; }
    const res = await createMeetForConsultation(env, row.id, { now, fetchImpl, sleep });
    if (res.status === 'ready') stats.ready++;
    else if (res.status === 'failed') stats.failed++;
    else stats.skipped++;
  }
  return stats;
}
