// FİRMA/MARKA İŞ / STAJ İLANLARI (kullanıcı isteği, 2026-09-11) — bkz. migrations/0115_office_jobs.sql.
//
//   GET    /api/office-jobs?office=<slug|ad>  -> { items: [{id, title, image}], canManage }
//   POST   /api/office-jobs                   { office, title, image } -> { item }
//   DELETE /api/office-jobs/:id
//
// canManage oturuma bağlı olduğundan yanıtlar HİÇBİR katmanda önbelleklenmez (no-store) — ilan
// listesi zaten tek bir indeksli sorgu, public önbellek kazancı yok.
//
// YETKİ: künyeyi "Düzenle" ile açabilen herkes (src/routes/submissions.js#verifyClaimedProfileKey
// ile AYNI kural) — admin; onaylı profile_claims('office') + admin'in DONDURDUĞU office_position
// OFFICE_EDIT_POSITIONS içinde; ya da firmanın Kurucular listesindeki onaylı kişi profili
// (claimedProfiles.js#canEditOfficeViaFounderLink). Ekip Üyesi pozisyonuyla sahiplenen biri ilan
// YAYINLAYAMAZ — künyeyi de düzenleyemediği gibi.
import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { canEditOfficeViaFounderLink } from '../lib/claimedProfiles.js';
import { OFFICE_EDIT_POSITIONS } from '../lib/projectClaimAccess.js';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_TITLE_LEN = 140;
// Bir firmanın aynı anda yayında tutabileceği ilan tavanı — kötüye kullanıma karşı emniyet supabı.
const MAX_JOBS_PER_OFFICE = 24;

async function findOffice(env, key) {
  if (!key) return null;
  return env.DB.prepare(
    `SELECT id, name, legacy_key FROM offices WHERE deleted_at IS NULL AND (slug = ? OR name = ? OR legacy_key = ?) LIMIT 1`
  ).bind(key, key, key).first();
}

export async function canManageOffice(env, user, office) {
  if (!user || !office) return false;
  if (user.role === 'admin') return true;
  const keys = [office.name, office.legacy_key].filter(Boolean);
  const claim = await env.DB.prepare(
    `SELECT office_position FROM profile_claims
      WHERE user_id = ? AND profile_type = 'office' AND status = 'approved'
        AND profile_key IN (${keys.map(() => '?').join(', ')})`
  ).bind(user.id, ...keys).all();
  if ((claim.results || []).some(r => OFFICE_EDIT_POSITIONS.has(r.office_position || ''))) return true;
  return canEditOfficeViaFounderLink(env, user, office.name, OFFICE_EDIT_POSITIONS);
}

function publicJob(row) {
  return { id: row.id, title: row.title, image: row.image_url };
}

async function listJobs(request, env, url) {
  const office = await findOffice(env, (url.searchParams.get('office') || '').trim());
  if (!office) return json({ items: [], canManage: false }, 200, NO_STORE);
  const [{ results }, user] = await Promise.all([
    env.DB.prepare(`SELECT id, title, image_url FROM office_jobs WHERE office_id = ? ORDER BY created_at DESC LIMIT ?`)
      .bind(office.id, MAX_JOBS_PER_OFFICE).all(),
    getSessionUser(request, env),
  ]);
  const canManage = await canManageOffice(env, user, office);
  return json({ items: (results || []).map(publicJob), canManage }, 200, NO_STORE);
}

async function createJob(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401, NO_STORE);
  if (!(await checkRateLimit(env, 'office-job', user.id, 20, 60 * 60 * 1000))) {
    return errorJson('Çok fazla ilan yayınlamaya çalıştın, biraz sonra tekrar dene.', 429, { ...NO_STORE, 'Retry-After': '3600' });
  }
  const body = await readJson(request);
  const title = String((body && body.title) || '').trim().replace(/\s+/g, ' ');
  const image = String((body && body.image) || '').trim();
  if (!title) return errorJson('İlan başlığı boş olamaz.', 400, NO_STORE);
  if (title.length > MAX_TITLE_LEN) return errorJson(`İlan başlığı en fazla ${MAX_TITLE_LEN} karakter olabilir.`, 400, NO_STORE);
  // Yalnızca kullanıcının KENDİ /api/uploads yüklemesi — dış URL ya da başkasının dosyası kabul edilmez.
  // Kuyruk upload.js#handleUploadRoute'un yazdığı anahtar biçimiyle BİREBİR: `<uuid>.<uzantı>` —
  // "../" gibi bir yol parçası bu kalıptan geçemez.
  const ownPrefix = `/media/u/${user.id}/`;
  if (!image.startsWith(ownPrefix) || !/^[A-Za-z0-9-]{8,64}\.(webp|jpg|png|gif)$/.test(image.slice(ownPrefix.length))) {
    return errorJson('İlan görseli geçersiz, lütfen görseli yeniden yükle.', 400, NO_STORE);
  }
  const office = await findOffice(env, String((body && body.office) || '').trim());
  if (!office) return errorJson('Firma bulunamadı.', 404, NO_STORE);
  if (!(await canManageOffice(env, user, office))) {
    return errorJson('Bu firma/marka adına ilan yayınlama yetkin yok.', 403, NO_STORE);
  }
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM office_jobs WHERE office_id = ?`).bind(office.id).first();
  if (count && count.n >= MAX_JOBS_PER_OFFICE) {
    return errorJson(`Aynı anda en fazla ${MAX_JOBS_PER_OFFICE} ilan yayında olabilir, önce eski bir ilanı kaldır.`, 400, NO_STORE);
  }
  const row = { id: crypto.randomUUID(), title, image_url: image };
  await env.DB.prepare(
    `INSERT INTO office_jobs (id, office_id, title, image_url, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(row.id, office.id, title, image, user.id, Date.now()).run();
  return json({ item: publicJob(row) }, 201, NO_STORE);
}

async function deleteJob(request, env, id) {
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401, NO_STORE);
  const job = await env.DB.prepare(`SELECT id, office_id FROM office_jobs WHERE id = ?`).bind(id).first();
  if (!job) return errorJson('İlan bulunamadı.', 404, NO_STORE);
  const office = await env.DB.prepare(`SELECT id, name, legacy_key FROM offices WHERE id = ?`).bind(job.office_id).first();
  if (!(await canManageOffice(env, user, office))) return errorJson('Bu ilanı kaldırma yetkin yok.', 403, NO_STORE);
  await env.DB.prepare(`DELETE FROM office_jobs WHERE id = ?`).bind(id).run();
  return json({ ok: true }, 200, NO_STORE);
}

export async function handleOfficeJobsRoute(request, env, url) {
  const path = url.pathname.replace(/\/+$/, '');
  if (path === '/api/office-jobs') {
    if (request.method === 'GET') return listJobs(request, env, url);
    if (request.method === 'POST') return createJob(request, env);
    return errorJson('Bulunamadı', 404);
  }
  const m = path.match(/^\/api\/office-jobs\/([A-Za-z0-9-]{1,64})$/);
  if (m && request.method === 'DELETE') return deleteJob(request, env, m[1]);
  return errorJson('Bulunamadı', 404);
}
