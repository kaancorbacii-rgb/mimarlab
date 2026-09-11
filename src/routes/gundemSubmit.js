// GÜNDEM — KULLANICI GÖNDERİLERİ (kullanıcı isteği, 2026-09-11: "Gündem sayfasında kullanıcılar da
// haber, etkinlik, yarışma ekleyebilsinler ... Max 1000 harflik bir metin yazılabilsin ve en fazla 3
// tane görsel eklenebilsin ... gönderilen içerikler admin panelinde onaya düşsünler ... içeriği kim
// gönderdiyse o firma, marka veya kişi profilinde ... yayınlansın").
//
// GET    /api/gundem-submissions/mine  — kendi gönderilerim + adına gönderebileceğim profiller
// GET    /api/gundem-submissions/:id   — düzenleme formu için tek kayıt (sahibi ya da admin)
// POST   /api/gundem-submissions       — yeni gönderi → status='pending' (admin onayına düşer)
// PATCH  /api/gundem-submissions/:id   — düzenleme; sahibi düzenlerse kayıt YENİDEN onaya düşer
// DELETE /api/gundem-submissions/:id   — sahibi ya da admin siler
//
// NEDEN /api/gundem/... ALTINDA DEĞİL: orada /api/gundem/:slug eşleşmesi var ve "mine" adlı bir
// slug ikisini çakıştırırdı (src/routes/gundem.js'teki entity filtresi için verilen AYNI gerekçe).
//
// YAYIN KAPISI: bu dosya HİÇBİR ZAMAN status='published' yazmaz. Yayına alma yalnızca admin'in
// POST /api/admin/gundem/:id/moderate ucundan geçer (bkz. gundemAdmin.js) — bu depoda "PATCH
// koşulsuz approved yazıyordu" diye kayda geçmiş moderasyon atlatma hatasının tekrarı olmasın diye.
// Tek istisna: ADMIN kendi düzenlemesinde kaydın mevcut durumunu KORUR (yayındaki içeriğin yazım
// hatasını düzeltmek onu listeden düşürmesin).

import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { newId } from '../lib/crypto.js';
import { slugify } from '../lib/slugify.js';
import { fetchOwnArchitectRows, fetchOfficeFounderLinks } from '../lib/claimedProfiles.js';
import { purgeGundemCache } from '../lib/gundemCache.js';
import { purgeSsrDetailCache } from '../lib/ssrCache.js';
import { parseGundemImages, GUNDEM_USER_CATEGORIES } from '../lib/gundemSsr.js';

export const GUNDEM_TEXT_MAX = 1000;
export const GUNDEM_TITLE_MAX = 140;
export const GUNDEM_MAX_IMAGES = 3;
const SITE_ORIGIN = 'https://mimarlab.com';

// Kendi R2 yüklemelerimiz (src/routes/upload.js: `u/<userId>/<uuid>.<ext>`). Mutlak
// https://mimarlab.com/media/... biçimi de kabul edilir ve göreli yola indirilir — kart, OG ve
// cdnImg() türev çözümü göreli yolu bekler.
const MEDIA_PATH_RE = /^\/media\/u\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(webp|jpe?g|png|gif)$/i;
export function normalizeOwnMediaPath(value) {
  if (typeof value !== 'string') return null;
  let v = value.trim();
  if (v.startsWith(SITE_ORIGIN + '/')) v = v.slice(SITE_ORIGIN.length);
  else if (v.startsWith('https://www.mimarlab.com/')) v = v.slice('https://www.mimarlab.com'.length);
  return MEDIA_PATH_RE.test(v) ? v : null;
}

// "1000 harf" — kod noktası sayısı (emoji/birleşik karakter bir "harf" sayılır, UTF-16 birimi değil).
// NFC: bu depoda Türkçe karakterin iki kod noktasıyla gelmesi kayda geçmiş bir kök neden (bkz. proje
// notu "NFD Unicode") — sayım ve kayıt aynı biçim üzerinden yapılır.
function cleanText(value) {
  return typeof value === 'string' ? value.normalize('NFC').replace(/\r\n?/g, '\n').trim() : '';
}
function charCount(s) { return [...s].length; }

// Kullanıcının ADINA gönderi yapabileceği profiller. Yetki gevşek tutulabilir çünkü her gönderi
// admin onayından geçer — ama liste yine de YALNIZCA kullanıcıya bağlı kayıtlardan kurulur, rastgele
// bir firmanın adına gönderi hazırlanamaz.
//   kişi  — onaylı profile_claims('architect') + kendi adıyla eşleşen kişi satırı
//   firma — onaylı profile_claims('office') + kişi profilinin kurucu/ekip bağıyla bağlı firmalar
async function allowedProfiles(env, user) {
  const out = [];
  const seen = new Set();
  const push = (type, key, name) => {
    if (!key || !name) return;
    const k = `${type}:${key}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ type, key, name });
  };
  const [{ claimed, selfNamed }, claimOffices, founderLinks] = await Promise.all([
    fetchOwnArchitectRows(env, user),
    env.DB.prepare(
      `SELECT DISTINCT o.name, o.slug FROM profile_claims c
         JOIN offices o ON (o.name = c.profile_key OR o.legacy_key = c.profile_key) AND o.deleted_at IS NULL
        WHERE c.user_id = ? AND c.profile_type = 'office' AND c.status = 'approved'`
    ).bind(user.id).all().then(r => r.results || []).catch(() => []),
    fetchOfficeFounderLinks(env, user, new Set()).catch(() => []),
  ]);
  [...claimed, ...selfNamed].forEach(r => push('architect', r.slug, r.name));
  claimOffices.forEach(r => push('office', r.slug, r.name));
  founderLinks.forEach(r => push('office', r.slug, r.name));
  return out;
}

// export: src/routes/officeJobs.js (popup'tan yayınlanan ilanın Gündem satırı) AYNI slug kuralını kullanır.
export async function allocateSlug(env, title) {
  const base = slugify(title).slice(0, 70).replace(/-+$/, '') || 'gundem';
  for (let attempt = 0; attempt < 4; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${newId().slice(0, 6)}`;
    const clash = await env.DB.prepare('SELECT 1 FROM gundem_items WHERE slug = ? LIMIT 1').bind(slug).first();
    if (!clash) return slug;
  }
  return `${base}-${newId().slice(0, 12)}`;
}

async function purgeItem(env, slug) {
  await Promise.all([purgeGundemCache(env), purgeSsrDetailCache('gundem', slug, env)]).catch(() => {});
}

// Gövdeyi doğrular. `existingImages`: düzenlenen kaydın ŞU ANKİ görselleri — başka bir kullanıcı
// klasöründeki görsel yalnızca zaten kayıtta duruyorsa kabul edilir (admin'in değiştirdiği kapak
// sahibin düzenlemesinde kaybolmasın), yeni eklenen her görsel kullanıcının KENDİ yüklemesi olmalı.
function validateBody(body, user, existingImages = []) {
  const category = typeof body.category === 'string' ? body.category : '';
  if (!GUNDEM_USER_CATEGORIES.some(c => c.key === category)) return { error: 'Kategori seç: Haber, Etkinlik, Yarışma ya da İş veya Staj İlanı.' };

  const title = cleanText(body.title).replace(/\s+/g, ' ');
  if (charCount(title) < 3) return { error: 'Başlık en az 3 karakter olmalı.' };
  if (charCount(title) > GUNDEM_TITLE_MAX) return { error: `Başlık en fazla ${GUNDEM_TITLE_MAX} karakter olabilir.` };

  const text = cleanText(body.text).replace(/\n{3,}/g, '\n\n');
  if (charCount(text) < 20) return { error: 'Metin en az 20 karakter olmalı.' };
  if (charCount(text) > GUNDEM_TEXT_MAX) return { error: `Metin en fazla ${GUNDEM_TEXT_MAX} karakter olabilir.` };

  const rawImages = Array.isArray(body.images) ? body.images : [];
  const images = [];
  const existing = new Set(existingImages);
  const isAdmin = user.role === 'admin';
  for (const raw of rawImages) {
    const path = normalizeOwnMediaPath(raw);
    if (!path) return { error: 'Görsellerden biri geçersiz. Lütfen görseli yeniden yükle.' };
    if (!isAdmin && !existing.has(path) && !path.startsWith(`/media/u/${user.id}/`)) {
      return { error: 'Görsellerden biri geçersiz. Lütfen görseli yeniden yükle.' };
    }
    if (!images.includes(path)) images.push(path);
  }
  // Kart tasarımı görselsiz içerik taşımıyor (migrations/0099: image_url NOT NULL) — en az bir görsel.
  if (!images.length) return { error: 'En az bir görsel ekle.' };
  if (images.length > GUNDEM_MAX_IMAGES) return { error: `En fazla ${GUNDEM_MAX_IMAGES} görsel ekleyebilirsin.` };

  return { category, title, text, images };
}

// İstemciye dönen şekil — düzenleme formu ve "Gönderilerim" listesi.
function shapeOwn(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    text: row.summary,
    category: row.category,
    status: row.status,
    images: parseGundemImages(row),
    profile: row.submitter_type && row.submitter_type !== 'user'
      ? { type: row.submitter_type, key: row.submitter_key, name: row.submitter_name }
      : null,
    submitterName: row.submitter_name || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const OWN_COLUMNS = `id, slug, title, summary, category, status, image_url, images, submitted_by,
  submitter_type, submitter_key, submitter_name, created_at, updated_at`;

async function loadOwnRow(env, id) {
  return env.DB.prepare(`SELECT ${OWN_COLUMNS} FROM gundem_items WHERE id = ? AND source_id = 'user'`).bind(id).first();
}

function canTouch(user, row) {
  return !!row && (user.role === 'admin' || row.submitted_by === user.id);
}

// Seçilen profil kullanıcının listesinde mi? Boş seçim = profilsiz, kullanıcının kendi adıyla.
function resolveSubmitter(body, profiles, user) {
  const p = body.profile;
  if (!p || !p.type || !p.key) return { type: 'user', key: null, name: (user.name || '').trim() || 'MİMARLAB üyesi' };
  const match = profiles.find(x => x.type === p.type && x.key === p.key);
  if (!match) return null;
  return { type: match.type, key: match.key, name: match.name };
}

export async function handleGundemSubmitRoute(request, env, url) {
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  const rest = url.pathname.slice('/api/gundem-submissions'.length).replace(/^\/+|\/+$/g, '');
  const method = request.method;

  if (rest === 'mine' && method === 'GET') {
    const [profiles, { results }] = await Promise.all([
      allowedProfiles(env, user),
      env.DB.prepare(
        `SELECT ${OWN_COLUMNS} FROM gundem_items WHERE submitted_by = ? AND source_id = 'user' ORDER BY created_at DESC LIMIT 100`
      ).bind(user.id).all(),
    ]);
    return json({
      profiles,
      items: (results || []).map(shapeOwn),
      categories: GUNDEM_USER_CATEGORIES,
      limits: { text: GUNDEM_TEXT_MAX, title: GUNDEM_TITLE_MAX, images: GUNDEM_MAX_IMAGES },
      userName: user.name || '',
    }, 200, { 'Cache-Control': 'no-store' });
  }

  if (!rest && method === 'POST') {
    if (!(await checkRateLimit(env, 'gundem-submit', user.id, 10, 60 * 60 * 1000))) {
      return errorJson('Çok fazla gönderi yaptın, bir süre sonra tekrar dene.', 429, { 'Retry-After': '3600' });
    }
    const body = await readJson(request);
    const v = validateBody(body, user);
    if (v.error) return errorJson(v.error);
    const submitter = resolveSubmitter(body, await allowedProfiles(env, user), user);
    if (!submitter) return errorJson('Bu profil adına gönderi yapamazsın.', 403);

    const now = Date.now();
    const id = newId();
    const slug = await allocateSlug(env, v.title);
    await env.DB.prepare(
      `INSERT INTO gundem_items (
         id, slug, title, summary, image_url, image_host, source_id, source_name, source_domain,
         source_url, published_at, category, language, content_hash, title_key, status, ingest_mode,
         images, submitted_by, submitter_type, submitter_key, submitter_name, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'mimarlab.com', 'user', ?, 'mimarlab.com', ?, ?, ?, 'tr', ?, ?, 'pending', 'user', ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, slug, v.title, v.text, v.images[0], submitter.name, `${SITE_ORIGIN}/gundem/${slug}`, now,
      v.category, `user:${id}`, `user:${id}`, JSON.stringify(v.images), user.id,
      submitter.type, submitter.key, submitter.name, now, now,
    ).run();
    return json({ ok: true, id, slug, status: 'pending' }, 201);
  }

  if (!rest || rest.includes('/')) return errorJson('Bulunamadı', 404);
  const id = rest;
  const row = await loadOwnRow(env, id);
  if (!canTouch(user, row)) return errorJson('Bulunamadı', 404);

  if (method === 'GET') {
    const profiles = row.submitted_by === user.id ? await allowedProfiles(env, user) : [];
    return json({ item: shapeOwn(row), profiles, categories: GUNDEM_USER_CATEGORIES,
      limits: { text: GUNDEM_TEXT_MAX, title: GUNDEM_TITLE_MAX, images: GUNDEM_MAX_IMAGES } },
      200, { 'Cache-Control': 'no-store' });
  }

  if (method === 'PATCH') {
    if (!(await checkRateLimit(env, 'gundem-edit', user.id, 30, 60 * 60 * 1000))) {
      return errorJson('Çok fazla düzenleme yaptın, bir süre sonra tekrar dene.', 429, { 'Retry-After': '3600' });
    }
    const body = await readJson(request);
    const v = validateBody(body, user, parseGundemImages(row));
    if (v.error) return errorJson(v.error);

    // Profil yalnızca SAHİBİ tarafından değiştirilebilir (admin başkasının gönderisini düzenlerken
    // onun adına hangi profillerin geçerli olduğunu bilemez — mevcut gönderen korunur).
    let submitter = { type: row.submitter_type, key: row.submitter_key, name: row.submitter_name };
    if (row.submitted_by === user.id && 'profile' in body) {
      submitter = resolveSubmitter(body, await allowedProfiles(env, user), user);
      if (!submitter) return errorJson('Bu profil adına gönderi yapamazsın.', 403);
    }

    const isAdmin = user.role === 'admin';
    // Sahibin düzenlemesi YENİDEN onaya düşer (yayındaki içerik de) — admin'inki durumu korur.
    const nextStatus = isAdmin ? row.status : 'pending';
    const now = Date.now();
    const stmts = [
      env.DB.prepare(
        `UPDATE gundem_items SET title = ?, summary = ?, category = ?, image_url = ?, images = ?,
           source_name = ?, submitter_type = ?, submitter_key = ?, submitter_name = ?, status = ?, updated_at = ?
         WHERE id = ?`
      ).bind(v.title, v.text, v.category, v.images[0], JSON.stringify(v.images), submitter.name,
        submitter.type, submitter.key, submitter.name, nextStatus, now, id),
    ];
    // Gönderen değiştiyse eski profilin Gündem şeridindeki kenar kalkar; yeni kenar onayda yazılır
    // (admin düzenlemesinde kayıt zaten yayındaysa hemen yazılır).
    const changedSubmitter = submitter.type !== row.submitter_type || submitter.key !== row.submitter_key;
    if (changedSubmitter && row.submitter_key) {
      stmts.push(env.DB.prepare('DELETE FROM gundem_entities WHERE item_id = ? AND entity_type = ? AND entity_key = ?')
        .bind(id, row.submitter_type, row.submitter_key));
    }
    if (changedSubmitter && nextStatus === 'published' && (submitter.type === 'architect' || submitter.type === 'office') && submitter.key) {
      stmts.push(env.DB.prepare(
        'INSERT OR IGNORE INTO gundem_entities (item_id, entity_type, entity_key, entity_name, created_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(id, submitter.type, submitter.key, submitter.name, now));
    }
    await env.DB.batch(stmts);
    if (row.status === 'published') await purgeItem(env, row.slug);
    return json({ ok: true, status: nextStatus, slug: row.slug });
  }

  if (method === 'DELETE') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM gundem_entities WHERE item_id = ?').bind(id),
      env.DB.prepare('DELETE FROM gundem_items WHERE id = ?').bind(id),
    ]);
    if (row.status === 'published') await purgeItem(env, row.slug);
    return json({ ok: true });
  }

  return errorJson('Bulunamadı', 404);
}
