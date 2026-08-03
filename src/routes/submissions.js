import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { SUBMISSION_TYPES, normalizeSubmission, parseSubmissionRow, validateRequired, findInvalidUrlField } from '../lib/submissionTypes.js';
import { getActiveBadge, periodStart, PRODUCT_MONTHLY_LIMITS, MATERIAL_MONTHLY_LIMITS, JOB_MONTHLY_LIMITS } from '../lib/badgeAccess.js';
import { invalidatePublicCache } from '../lib/publicCache.js';
import { purgeSsrDetailCache, ssrPurgeTargetFor } from '../lib/ssrCache.js';
import { cascadeRemovedFounders } from '../lib/officeFounderCascade.js';
import { setLegacyHidden } from './legacyContent.js';
// projeler-data.js tarayıcıda classic <script> olarak yüklenen, export içermeyen bir dosya; dosya
// sonundaki guard'lı `module.exports` bloğu sayesinde esbuild bunu CJS modülü olarak paketler (bkz.
// src/lib/seo.js'teki aynı desen — orada da SSR meta için kullanılıyor).
import projeJs from '../../projeler-data.js';

const TYPE_BY_PATH = {
  offices: 'offices', projects: 'projects', products: 'products', materials: 'materials', jobs: 'jobs',
  architects: 'architects', news: 'news',
};

// architects/offices gönderileri, claimed_profile_key doluysa yeni bir kayıt değil, o kullanıcının
// onaylı bir profile_claims kaydına sahip olduğu STATİK bir profile (architects[]/offices[].name)
// yapılan bir düzenleme talebidir — sahtecilik olmasın diye onay kontrolü burada yapılır.
const CLAIM_PROFILE_TYPE = { architects: 'architect', offices: 'office' };

// bkz. src/routes/public.js#CLAIMED_COLUMN_BY_TYPE (aynı eşleme) — bir statik kaydı admin panelinden
// arşivleyip (bkz. src/routes/legacyContent.js#handleContentAction/handleProjectAction) sonra bu
// GENEL uç noktadan (Admin Arşiv sekmesindeki özel "Yayınla" butonu DIŞINDA, ör. proje-ekle.html/
// mimar-ekle.html/ofis-ekle.html'in normal ?claim= düzenleme formundan) tekrar onaylarsak, aşağıdaki
// unhideIfClaimedApproved çağrısı olmadan satır 'approved' olur ama statik kayıt legacy_content_hidden
// içinde gizli KALIRDI — canlıda ne overlay ne statik hali görünmeyen, veritabanında "onaylı" ama
// sitede hiç var olmayan bir kayıt (gerçek bulgu: GAD Architecture'ı arşivleyip normal formdan
// düzenleyince firma sitede tamamen kayboluyordu, admin panelinde her şey normal görünüyordu).
const CLAIMED_COLUMN_BY_TYPE = { architects: 'claimed_profile_key', offices: 'claimed_profile_key', projects: 'claimed_slug' };

async function unhideIfClaimedApproved(env, user, typeKey, status, claimedValue) {
  if (status !== 'approved' || !claimedValue) return;
  const claimedColumn = CLAIMED_COLUMN_BY_TYPE[typeKey];
  if (!claimedColumn) return;
  await setLegacyHidden(env, user, typeKey, claimedValue, false);
}

async function verifyClaimedProfileKey(env, user, typeKey, profileKey) {
  if (user.role === 'admin') return null; // admin, sahiplenmiş olsun olmasın her mimar/marka profilini düzenleyebilir
  const profileType = CLAIM_PROFILE_TYPE[typeKey];
  if (!profileType) return errorJson('Bu tip için profil düzenleme desteklenmiyor.');
  const claim = await env.DB.prepare(
    `SELECT id FROM profile_claims WHERE user_id = ? AND profile_type = ? AND profile_key = ? AND status = 'approved'`
  ).bind(user.id, profileType, profileKey).first();
  if (!claim) return errorJson('Bu profili düzenlemek için önce profili sahiplenip onayının geçmesi gerekiyor.', 403);
  return null;
}

// Statik projeler (projeler-data.js) için mimar/ofis'teki profile_claims'e karşılık gelen bir
// sahiplenme/onay akışı YOK — projelerin bir "sahibi" kavramı yok, bu yüzden bu tamamen admin'e
// özel (bkz. kullanıcı isteği: "admin hesabına tüm projeleri düzenleyebilme yetkisi ver"). Sıradan
// üyeler claimed_slug göndermeye çalışırsa reddedilir.
async function verifyClaimedSlug(env, user, slug) {
  if (user.role !== 'admin') return errorJson('Bu işlem için yetkin yok.', 403);
  const project = projeJs.projectBySlug(slug);
  if (!project) return errorJson('Böyle bir statik proje bulunamadı.', 404);
  return null;
}

// Ürün ve iş ilanı gönderimi rozet sahipliğine bağlıdır (yalnızca yeni gönderiler için — mevcut
// bir gönderiyi düzenlemek aylık hakkı harcamaz, bkz. updateOwnSubmission). Ürün: her üç rozet
// kademesi de farklı aylık limitle yükleyebilir. İş ilanı: yalnızca Altın/Elmas Üye yayınlayabilir.
async function checkSubmissionQuota(env, user, typeKey) {
  if (typeKey === 'products') {
    const badge = await getActiveBadge(env, user.id);
    const limit = badge ? PRODUCT_MONTHLY_LIMITS[badge.badge_type] : undefined;
    if (!limit) return errorJson('Ürün eklemek için Doğrulanmış Üye, Altın Üye ya da Elmas Üye rozetine sahip olmalısın. Hesabım sayfandan rozet satın alabilirsin.', 403);
    const since = periodStart(badge);
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM product_submissions WHERE owner_user_id = ? AND created_at >= ?`
    ).bind(user.id, since).first();
    if (row.count >= limit) return errorJson(`Bu ayki ürün yükleme hakkını kullandın (${limit}/${limit}). Yeni hak için bir sonraki döneme kadar bekleyebilir ya da daha üst bir rozete geçebilirsin.`, 403);
    return null;
  }
  if (typeKey === 'jobs') {
    const badge = await getActiveBadge(env, user.id);
    const limit = badge ? JOB_MONTHLY_LIMITS[badge.badge_type] : undefined;
    if (!limit) return errorJson('İş ilanı yayınlamak için Altın Üye ya da Elmas Üye rozetine sahip olmalısın. Hesabım sayfandan rozet satın alabilirsin.', 403);
    const since = periodStart(badge);
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM job_submissions WHERE owner_user_id = ? AND created_at >= ?`
    ).bind(user.id, since).first();
    if (row.count >= limit) return errorJson(`Bu ayki iş ilanı yayınlama hakkını kullandın (${limit}/${limit}).`, 403);
    return null;
  }
  if (typeKey === 'materials') {
    const badge = await getActiveBadge(env, user.id);
    const limit = badge ? MATERIAL_MONTHLY_LIMITS[badge.badge_type] : undefined;
    if (!limit) return errorJson('Malzeme eklemek için Doğrulanmış Üye, Altın Üye ya da Elmas Üye rozetine sahip olmalısın. Hesabım sayfandan rozet satın alabilirsin.', 403);
    const since = periodStart(badge);
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM material_submissions WHERE owner_user_id = ? AND created_at >= ?`
    ).bind(user.id, since).first();
    if (row.count >= limit) return errorJson(`Bu ayki malzeme yükleme hakkını kullandın (${limit}/${limit}). Yeni hak için bir sonraki döneme kadar bekleyebilir ya da daha üst bir rozete geçebilirsin.`, 403);
    return null;
  }
  return null;
}

export async function handleSubmissionRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "offices", ...]
  const typeKey = TYPE_BY_PATH[segments[1]];
  if (!typeKey) return errorJson('Bulunamadı', 404);

  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  if (segments.length === 2 && request.method === 'POST') return createSubmission(request, env, user, typeKey);
  if (segments.length === 3 && segments[2] === 'mine' && request.method === 'GET') return listMine(env, user, typeKey);
  if (segments.length === 3 && segments[2] !== 'mine' && request.method === 'GET') return getOwnSubmission(env, user, typeKey, segments[2]);
  if (segments.length === 3 && segments[2] !== 'mine' && request.method === 'PATCH') return updateOwnSubmission(request, env, user, typeKey, segments[2]);
  return errorJson('Bulunamadı', 404);
}

async function createSubmission(request, env, user, typeKey) {
  const body = await readJson(request);
  const missing = validateRequired(typeKey, body);
  if (missing.length) return errorJson(`Eksik alan(lar): ${missing.join(', ')}`);
  const invalidUrlField = findInvalidUrlField(typeKey, body);
  if (invalidUrlField) return errorJson(`"${invalidUrlField}" alanı geçerli bir bağlantı değil.`);

  if (body.claimed_profile_key) {
    const err = await verifyClaimedProfileKey(env, user, typeKey, body.claimed_profile_key);
    if (err) return err;
    body.name = body.claimed_profile_key; // isim, eşleşen statik profille birebir aynı kalmalı
  }
  if (typeKey === 'projects' && body.claimed_slug) {
    const err = await verifyClaimedSlug(env, user, body.claimed_slug);
    if (err) return err;
  }

  const quotaErr = await checkSubmissionQuota(env, user, typeKey);
  if (quotaErr) return quotaErr;

  const config = SUBMISSION_TYPES[typeKey];
  const row = normalizeSubmission(typeKey, body);
  if (typeKey === 'projects' && body.claimed_slug) row.slug = body.claimed_slug; // normalizeSubmission slug'ı title'dan yeniden üretir, statik projeyle eşleşen slug'ı koru
  const id = newId();
  const now = Date.now();
  // Admin'in kendi gönderisi/düzenlemesi başka bir onaycıya muhtaç değil — admin zaten onaycının
  // kendisi olduğundan doğrudan yayına girer (bkz. kullanıcı isteği: "admin tüm sitede tüm
  // yetkilere sahip olsun ... admin canlıdaki siteden yaptığı değişiklikler doğrudan canlı siteye
  // yansısın"). Diğer tüm kullanıcıların gönderileri eskisi gibi 'pending'.
  const status = user.role === 'admin' ? 'approved' : 'pending';

  const columns = ['id', 'owner_user_id', 'status', 'created_at', 'updated_at', ...config.fields];
  const placeholders = columns.map(() => '?').join(', ');
  const values = [id, user.id, status, now, now, ...config.fields.map(f => row[f])];

  await env.DB.prepare(
    `INSERT INTO ${config.table} (${columns.join(', ')}) VALUES (${placeholders})`
  ).bind(...values).run();

  // Bu, önceden arşivlenmiş (bkz. handleContentAction/handleProjectAction) bir statik kaydın
  // taslağıysa (nadir — normalde prefillForClaim mevcut taslağı bulup PATCH'e düşer) statik kayıt
  // hâlâ gizli olabilir; onaylandığı an tekrar görünür olmalı (bkz. unhideIfClaimedApproved).
  await unhideIfClaimedApproved(env, user, typeKey, status, typeKey === 'projects' ? body.claimed_slug : body.claimed_profile_key);

  // Yalnızca admin'in kendi gönderisi anında 'approved' olarak yayına girdiğinden (yukarıdaki
  // yorum) public önbelleği yalnızca bu durumda değişir — sıradan üye gönderileri 'pending' kalıp
  // onay bekleyene dek zaten hiçbir public uçta görünmez, gereksiz yere temizlemeye gerek yok.
  if (status === 'approved') {
    await invalidatePublicCache();
    // claimed_slug/claimed_profile_key'liyse bu, ziyaretçilerin ZATEN görüntülemiş olabileceği
    // statik bir sayfaya bindirilen bir düzenlemedir — o sayfanın SSR önbelleğini temizle (bkz.
    // src/lib/ssrCache.js). Marka yeni (claim'siz) bir kayıt için bu bir no-op'tur (henüz hiç
    // önbelleklenmemiş bir anahtarı silmeye çalışmak zararsızdır).
    const target = ssrPurgeTargetFor(typeKey, { ...row, id });
    if (target) await purgeSsrDetailCache(target.type, target.key);
  }
  return json({ id, status }, 201);
}

async function listMine(env, user, typeKey) {
  const config = SUBMISSION_TYPES[typeKey];
  const { results } = await env.DB.prepare(
    `SELECT * FROM ${config.table} WHERE owner_user_id = ? ORDER BY created_at DESC`
  ).bind(user.id).all();
  return json({ items: results.map(r => parseSubmissionRow(typeKey, r)) });
}

// Sahiplik kontrolü admin için atlanır — admin herhangi bir kullanıcının gönderisini görüntüleyip
// düzenleyebilir (bkz. kullanıcı isteği: "admin hesabının tüm gönderilerin düzenleme yetkisi olsun").
async function getOwnSubmission(env, user, typeKey, id) {
  const config = SUBMISSION_TYPES[typeKey];
  const row = await env.DB.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).bind(id).first();
  if (!row || (row.owner_user_id !== user.id && user.role !== 'admin')) return errorJson('Bulunamadı', 404);
  return json({ item: parseSubmissionRow(typeKey, row) });
}

async function updateOwnSubmission(request, env, user, typeKey, id) {
  const config = SUBMISSION_TYPES[typeKey];
  const existing = await env.DB.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).bind(id).first();
  if (!existing || (existing.owner_user_id !== user.id && user.role !== 'admin')) return errorJson('Bulunamadı', 404);

  const body = await readJson(request);
  const missing = validateRequired(typeKey, body);
  if (missing.length) return errorJson(`Eksik alan(lar): ${missing.join(', ')}`);
  const invalidUrlField = findInvalidUrlField(typeKey, body);
  if (invalidUrlField) return errorJson(`"${invalidUrlField}" alanı geçerli bir bağlantı değil.`);

  if (body.claimed_profile_key) {
    const err = await verifyClaimedProfileKey(env, user, typeKey, body.claimed_profile_key);
    if (err) return err;
    body.name = body.claimed_profile_key; // isim, eşleşen statik profille birebir aynı kalmalı
  }
  if (typeKey === 'projects' && body.claimed_slug) {
    const err = await verifyClaimedSlug(env, user, body.claimed_slug);
    if (err) return err;
  }

  const row = normalizeSubmission(typeKey, body);
  if (typeKey === 'projects') row.slug = existing.slug; // düzenlemede slug'ı (ve ona bağlı bağlantıları/yorumları) koru

  const now = Date.now();
  // bkz. createSubmission'daki aynı yorum — admin'in kendi düzenlemesi anında yayına girer.
  const status = user.role === 'admin' ? 'approved' : 'pending';
  const updates = config.fields.map(f => `${f} = ?`);
  const values = config.fields.map(f => row[f]);
  updates.push('status = ?', 'updated_at = ?');
  values.push(status, now, id);

  await env.DB.prepare(
    `UPDATE ${config.table} SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  // Kurucular listesinden çıkarılan bir isim varsa, o kişinin kendi office alanını temizle (bkz.
  // src/lib/officeFounderCascade.js — gerçek "kurucu/ortak" görünürlüğü bu alandan gelir, founders
  // dizisinin kendisi yalnızca kozmetiktir).
  if (typeKey === 'offices' && 'founders' in body) {
    const oldFounders = parseSubmissionRow('offices', existing).founders;
    await cascadeRemovedFounders(env, user, existing.name, oldFounders, Array.isArray(body.founders) ? body.founders : []);
  }

  // bkz. createSubmission'daki aynı çağrı/yorum — bu satır önceden arşivlenmiş bir statik kaydın
  // taslağıysa, düzenleme onaylanır onaylanmaz statik kayıt tekrar görünür olmalı.
  await unhideIfClaimedApproved(env, user, typeKey, status, typeKey === 'projects' ? row.claimed_slug : row.claimed_profile_key);

  // Onaylı içerik ya şimdi onaylandı ya da (sıradan üye kendi onaylı içeriğini düzenlediğinde,
  // bkz. yukarıdaki status ataması) tekrar onay bekler duruma düşüp public'ten kalkmış olabilir —
  // her iki yönde de public önbellek eskimiş olacağından temizlenir.
  if (status === 'approved' || existing.status === 'approved') {
    await invalidatePublicCache();
    // Değişiklik ÖNCESİ kaydın kimliğini hedefler (görüntülenen sayfa hâlâ bu anahtar altında
    // önbelleklenmiş olabilir) — bkz. src/lib/ssrCache.js.
    const target = ssrPurgeTargetFor(typeKey, existing);
    if (target) await purgeSsrDetailCache(target.type, target.key);
  }
  return json({ id, status });
}
