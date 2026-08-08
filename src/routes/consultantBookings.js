import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { parseCanonicalRow } from '../lib/canonicalRead.js';
import { invalidatePublicCache } from '../lib/publicCache.js';
import { purgeSsrDetailCache } from '../lib/ssrCache.js';

// GET /api/consultant-bookings/mine — hesabim.html'in "Danışmanlık" sekmesi: kullanıcının SAHİP
// OLDUĞU danışman profil(ler)ine (is_consultant=1 + profile_claims'te 'approved' sahiplik, bkz.
// src/routes/consultant.js#authorizeConsultantSelf ile AYNI mülkiyet kontrolü) gelen TÜM görüşme/
// satın alma taleplerini döner. isConsultant:false ise sekme hiç gösterilmez (bkz. kullanıcı
// isteği: "Danışman profili olanlar için... 1 sekme daha açıp").
async function myConsultantBookings(env, user) {
  const { results: ownedRows } = await env.DB.prepare(
    `SELECT a.name FROM architects a
     JOIN profile_claims c ON c.profile_type = 'architect' AND c.profile_key = a.name AND c.status = 'approved'
     WHERE a.deleted_at IS NULL AND a.is_consultant = 1 AND c.user_id = ?`
  ).bind(user.id).all();
  const names = ownedRows.map(r => r.name);
  if (!names.length) return json({ isConsultant: false, items: [] });
  const placeholders = names.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT cr.*, u.name AS buyer_name, u.email AS buyer_email FROM consultation_requests cr
     JOIN users u ON u.id = cr.user_id
     WHERE cr.consultant_key IN (${placeholders}) ORDER BY cr.created_at DESC`
  ).bind(...names).all();
  return json({ isConsultant: true, items: results });
}

// POST /api/consultant-bookings — "Görüşme Ayarla" Havale/EFT talep akışı (bkz. kullanıcı isteği,
// src/routes/badges.js#createBadgeRequest ile AYNI desen: giriş zorunlu, talep 'pending' oluşur,
// admin havaleyi banka ekstresinden doğrulayıp elle onaylar — bu turda admin tarafı/onay ekranı
// EKLENMEDİ, yalnızca kayıt oluşturma). Gerçek slot rezervasyonu (available_slots'ta o saati
// available:false yapma) KASITLI olarak kapsam dışı — bkz. proje hafızası: ilk /danismanlik
// planında da aynı sınır çizilmişti. GET .../mine yukarıdaki myConsultantBookings'e (kullanıcının
// KENDİ danışman profiline gelen talepler) düşer, aynı path'in AYNI dosyadaki AYNI dispatcher'ı
// (bkz. src/routes/consultant.js#handleConsultantRoute'daki AYNI method-bazlı ayrım deseni).
export async function handleConsultantBookingsRoute(request, env, url) {
  if (url.pathname === '/api/consultant-bookings/mine' && request.method === 'GET') {
    const user = await getSessionUser(request, env);
    if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);
    return myConsultantBookings(env, user);
  }
  if (request.method !== 'POST') return errorJson('Bulunamadı', 404);

  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  const body = await readJson(request);
  const consultantKey = (body.consultantKey || '').trim();
  const requestedDate = (body.requestedDate || '').trim();
  const requestedTime = (body.requestedTime || '').trim();
  if (!consultantKey || !requestedDate || !requestedTime) return errorJson('Geçersiz istek.');

  const row = await env.DB.prepare(
    `SELECT * FROM architects WHERE deleted_at IS NULL AND hidden_at IS NULL AND is_consultant = 1 AND (name = ? OR slug = ? OR legacy_key = ?) LIMIT 1`
  ).bind(consultantKey, consultantKey, consultantKey).first();
  if (!row) return errorJson('Danışman bulunamadı.');
  const a = parseCanonicalRow('architects', row);

  // available_slots artık haftalık tekrarlayan şablon ({weekday, times}) — bkz. kullanıcı isteği:
  // haftalık dinamik takvim. requestedDate'in haftanın hangi gününe denk geldiği hesaplanıp
  // şablonda o gün aranır; istemci tarafındaki AYNI kontrol (consultant-modal.js#renderSlots)
  // burada sunucu tarafında tekrarlanır.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) return errorJson('Geçersiz istek.');
  const requestedMoment = new Date(`${requestedDate}T${requestedTime}:00`);
  if (Number.isNaN(requestedMoment.getTime()) || requestedMoment.getTime() <= Date.now()) {
    return errorJson('Seçilen görüşme saati artık uygun değil.');
  }
  const weekday = new Date(`${requestedDate}T00:00:00`).getDay();
  const day = (a.available_slots || []).find(d => d.weekday === weekday);
  const slot = day && (day.times || []).find(t => t.time === requestedTime);
  if (!slot || !slot.available) return errorJson('Seçilen görüşme saati artık uygun değil.');

  const now = Date.now();
  const id = newId();
  await env.DB.prepare(
    `INSERT INTO consultation_requests (id, user_id, consultant_key, requested_date, requested_time, price_try, status, payment_provider, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 'havale', ?, ?)`
  ).bind(id, user.id, a.name, requestedDate, requestedTime, a.hourly_rate || null, now, now).run();

  // Dinamik dakika/seans sayacı (bkz. kullanıcı isteği: yeni görüşme talebi oluştukça artsın) —
  // sistemde ayrı bir "ödeme onaylandı" adımı olmadığından (bkz. dosya başı yorumu), talep
  // oluşturulduğu an tek mantıklı tetikleyici budur.
  await env.DB.prepare(
    `UPDATE architects SET consultant_total_minutes = consultant_total_minutes + ?, consultant_sessions_completed = consultant_sessions_completed + 1 WHERE id = ?`
  ).bind(a.session_duration_min || 45, a.id).run();
  await invalidatePublicCache();
  await purgeSsrDetailCache('consultant', a.name);

  return json({ id, status: 'pending' }, 201);
}
