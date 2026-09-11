// FİRMA/MARKA İŞ / STAJ İLANLARI (kullanıcı isteği, 2026-09-11) — bkz. migrations/0115_office_jobs.sql.
//
//   GET    /api/office-jobs?office=<slug|ad>  -> { items: [{id, title, image, removable}], canManage }
//   POST   /api/office-jobs                   { office, title, image } -> { item }
//   DELETE /api/office-jobs/:id
//
// canManage oturuma bağlı olduğundan yanıtlar HİÇBİR katmanda önbelleklenmez (no-store) — ilan
// listesi zaten iki indeksli sorgu, public önbellek kazancı yok.
//
// YETKİ: künyeyi "Düzenle" ile açabilen herkes (src/routes/submissions.js#verifyClaimedProfileKey
// ile AYNI kural) — admin; onaylı profile_claims('office') + admin'in DONDURDUĞU office_position
// OFFICE_EDIT_POSITIONS içinde; ya da firmanın Kurucular listesindeki onaylı kişi profili
// (claimedProfiles.js#canEditOfficeViaFounderLink). Ekip Üyesi pozisyonuyla sahiplenen biri ilan
// YAYINLAYAMAZ — künyeyi de düzenleyemediği gibi.
//
// GÜNDEM İLE İKİ YÖNLÜ BAĞ (kullanıcı isteği, 2026-09-12 — migrations/0116):
//   * popup'tan yayınlanan ilan AYRICA gundem_items'a category='ilan', status='published' olarak
//     yazılır ve firmaya gundem_entities kenarıyla bağlanır — Gündem'in "İş ve Staj İlanları" çipi,
//     kartı, /gundem/:slug sayfası ve popup'ın Gündem şeridi onu kendiliğinden gösterir. Onay kuyruğu
//     YOK: yayınlayan zaten firmayı düzenleme yetkisi olan kişidir (gundemSubmit.js'in "bu dosya asla
//     published yazmaz" kuralı kimliği doğrulanmamış GÖNDERİLER içindir; buradaki yazım yetki
//     kapısından sonra gelir).
//   * İçerik Ekle'den "İş veya Staj İlanı" olarak gönderilip admin onayından geçen ve bu firmaya
//     bağlanan içerik de popup'taki listede görünür (removable:false — o içerik Gündem gönderileri
//     üzerinden yönetilir, popup'taki × onu silmez).
import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { newId } from '../lib/crypto.js';
import { canEditOfficeViaFounderLink } from '../lib/claimedProfiles.js';
import { OFFICE_EDIT_POSITIONS } from '../lib/projectClaimAccess.js';
import { purgeGundemCache } from '../lib/gundemCache.js';
import { purgeSsrDetailCache } from '../lib/ssrCache.js';
import { parseGundemImages } from '../lib/gundemSsr.js';
import { allocateSlug } from './gundemSubmit.js';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_TITLE_LEN = 140;
// Bir firmanın aynı anda yayında tutabileceği ilan tavanı — kötüye kullanıma karşı emniyet supabı.
const MAX_JOBS_PER_OFFICE = 24;
const SITE_ORIGIN = 'https://mimarlab.com';
export const JOB_GUNDEM_CATEGORY = 'ilan';

async function findOffice(env, key) {
  if (!key) return null;
  return env.DB.prepare(
    `SELECT id, slug, name, legacy_key FROM offices WHERE deleted_at IS NULL AND (slug = ? OR name = ? OR legacy_key = ?) LIMIT 1`
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

async function purgeGundem(env, slug) {
  // Node testlerinde ve önbellek erişimi olmayan ortamlarda sessizce atlanır — yayın/silme D1'de
  // zaten tamamlandı; önbellek ETag fingerprint'iyle de tazelenir (bkz. gundemCache.js dosya başı).
  try { await Promise.all([purgeGundemCache(env), slug ? purgeSsrDetailCache('gundem', slug, env) : null]); } catch { /* opsiyonel */ }
}

async function listJobs(request, env, url) {
  const office = await findOffice(env, (url.searchParams.get('office') || '').trim());
  if (!office) return json({ items: [], canManage: false }, 200, NO_STORE);
  const [{ results: jobRows }, { results: gundemRows }, user] = await Promise.all([
    env.DB.prepare(`SELECT id, title, image_url, gundem_item_id, created_at FROM office_jobs WHERE office_id = ? ORDER BY created_at DESC LIMIT ?`)
      .bind(office.id, MAX_JOBS_PER_OFFICE).all(),
    env.DB.prepare(
      `SELECT g.id, g.title, g.image_url, g.images, COALESCE(g.source_published_at, g.published_at) AS ts
         FROM gundem_entities e JOIN gundem_items g ON g.id = e.item_id
        WHERE e.entity_type = 'office' AND e.entity_key = ? AND g.status = 'published' AND g.category = ?
        ORDER BY ts DESC LIMIT ?`
    ).bind(office.slug, JOB_GUNDEM_CATEGORY, MAX_JOBS_PER_OFFICE).all(),
    getSessionUser(request, env),
  ]);
  const mirrored = new Set((jobRows || []).map(r => r.gundem_item_id).filter(Boolean));
  const items = [
    ...(jobRows || []).map(r => ({ id: r.id, title: r.title, image: r.image_url, removable: true, ts: r.created_at })),
    ...(gundemRows || []).filter(r => !mirrored.has(r.id)).map(r => ({
      id: `g-${r.id}`, title: r.title, image: parseGundemImages(r)[0] || r.image_url, removable: false, ts: r.ts,
    })),
  ].sort((a, b) => (b.ts || 0) - (a.ts || 0)).map(({ ts, ...rest }) => rest);
  const canManage = await canManageOffice(env, user, office);
  return json({ items, canManage }, 200, NO_STORE);
}

async function createJob(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401, NO_STORE);
  if (!(await checkRateLimit(env, 'office-job', user.id, 20, 60 * 60 * 1000))) {
    return errorJson('Çok fazla ilan yayınlamaya çalıştın, biraz sonra tekrar dene.', 429, { ...NO_STORE, 'Retry-After': '3600' });
  }
  const body = await readJson(request);
  const title = String((body && body.title) || '').normalize('NFC').trim().replace(/\s+/g, ' ');
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

  const now = Date.now();
  const id = crypto.randomUUID();
  const gid = newId();
  const slug = await allocateSlug(env, title);
  const summary = `${office.name} tarafından yayınlanan iş / staj ilanı.`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO office_jobs (id, office_id, title, image_url, created_by, created_at, gundem_item_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, office.id, title, image, user.id, now, gid),
    // gundemSubmit.js#POST ile AYNI kolon düzeni (kullanıcı satırı sözleşmesi, bkz. migrations/0113);
    // tek fark status='published' ve category='ilan'.
    env.DB.prepare(
      `INSERT INTO gundem_items (
         id, slug, title, summary, image_url, image_host, source_id, source_name, source_domain,
         source_url, published_at, category, language, content_hash, title_key, status, ingest_mode,
         images, submitted_by, submitter_type, submitter_key, submitter_name, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'mimarlab.com', 'user', ?, 'mimarlab.com', ?, ?, ?, 'tr', ?, ?, 'published', 'user', ?, ?, 'office', ?, ?, ?, ?)`
    ).bind(
      gid, slug, title, summary, image, office.name, `${SITE_ORIGIN}/gundem/${slug}`, now,
      JOB_GUNDEM_CATEGORY, `user:${gid}`, `user:${gid}`, JSON.stringify([image]), user.id,
      office.slug, office.name, now, now,
    ),
    env.DB.prepare(
      'INSERT OR IGNORE INTO gundem_entities (item_id, entity_type, entity_key, entity_name, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(gid, 'office', office.slug, office.name, now),
  ]);
  await purgeGundem(env, slug);
  return json({ item: { id, title, image, removable: true } }, 201, NO_STORE);
}

async function deleteJob(request, env, id) {
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401, NO_STORE);
  const job = await env.DB.prepare(`SELECT id, office_id, gundem_item_id FROM office_jobs WHERE id = ?`).bind(id).first();
  if (!job) return errorJson('İlan bulunamadı.', 404, NO_STORE);
  const office = await env.DB.prepare(`SELECT id, slug, name, legacy_key FROM offices WHERE id = ?`).bind(job.office_id).first();
  if (!(await canManageOffice(env, user, office))) return errorJson('Bu ilanı kaldırma yetkin yok.', 403, NO_STORE);
  const g = job.gundem_item_id
    ? await env.DB.prepare(`SELECT slug FROM gundem_items WHERE id = ?`).bind(job.gundem_item_id).first()
    : null;
  const stmts = [env.DB.prepare(`DELETE FROM office_jobs WHERE id = ?`).bind(id)];
  if (job.gundem_item_id) {
    stmts.push(env.DB.prepare('DELETE FROM gundem_entities WHERE item_id = ?').bind(job.gundem_item_id));
    stmts.push(env.DB.prepare(`DELETE FROM gundem_items WHERE id = ? AND source_id = 'user'`).bind(job.gundem_item_id));
  }
  await env.DB.batch(stmts);
  if (g) await purgeGundem(env, g.slug);
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
