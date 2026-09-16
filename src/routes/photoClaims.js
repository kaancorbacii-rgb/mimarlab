import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { createNotification } from '../lib/notify.js';
import { invalidatePublicCache } from '../lib/publicCache.js';
import { purgeSsrDetailCache } from '../lib/ssrCache.js';
import { sanitizeImageCredits } from '../lib/submissionTypes.js';
import { foldTr } from '../lib/textMatch.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { findOneByName, splitPhotographerNames } from '../lib/canonicalSync.js';
import { fetchOfficeManagers } from '../lib/claimedProfiles.js';
import { OFFICE_EDIT_POSITIONS } from '../lib/projectClaimAccess.js';

// ============================================================================================
// "FOTOĞRAF BANA AİT" — FOTOĞRAFÇI KÜNYESİ TALEBİ + ONAY AKIŞI (kullanıcı isteği, 2026-09-16
// ikinci tur madde 2)
// ============================================================================================
// "Proje popuplarındaki lightboxta 'Fotoğraf bana ait' butonu olsun ve bu butona tıklayınca
// görseldeki ismin değişmesi için firma yöneticilerine ve admine bildirim gitsin. Firma
// yöneticileri veya admin bildirimi onaylarsa fotoğrafçı bilgisi lightboxa ve proje künyesine
// eklensin."
//
// Bu dosya src/routes/hotspotTags.js'in KARDEŞİDİR ve onun desenini birebir izler (aynı uç
// isimleri, aynı 'pending'/'approved'/'rejected' sözlüğü, aynı "admin onaya düşmez" kısayolu,
// aynı bildirim→pop-up bağlantı biçimi). Ayrı bir dosya olmasının gerekçesi: etiketlenen şey bir
// ÜRÜN değil bir AD, karar verenler ürünün markası değil PROJENİN FİRMA YÖNETİCİLERİ ve yazma
// hedefi image_hotspots değil photo_credit_text + image_credits.
//
// TASARIM KARARLARI (ve NEDEN):
//
// 1) KİM TALEP AÇABİLİR — giriş yapmış HER kullanıcı. hotspotTags.js tasarım notu 1'deki AYNI
//    gerekçe: talep KENDİLİĞİNDEN yayına girmediği için yetkiyi daraltmanın bir faydası yok, ama
//    talep bir HESABA bağlanamazsa ne karar bildirimi gönderilebilir ne kötüye kullanım
//    izlenebilir — bu yüzden oturum şartı korunur (401). Kuyruk spam'ine karşı kullanıcı başına
//    saatlik tavan (CLAIM_HOURLY_LIMIT): her bekleyen talep TÜM adminlere birer bildirim üretir.
//
// 2) KİM KARAR VERİR — admin VEYA projenin künyesindeki firmaların YÖNETİCİLERİ. Karar kümesi ile
//    BİLDİRİM ALICILARI TEK BİR fonksiyondan (decisionRecipients) türer; iki liste ayrı ayrı
//    hesaplanırsa biri diğerinde olmayan bir kullanıcıya "onayına sunuldu" bildirimi gider ve o
//    kişi butona bastığında 403 alırdı. Yöneticinin tanımı da bu depodaki TEK kaynaktan okunur
//    (claimedProfiles.js#fetchOfficeManagers + OFFICE_EDIT_POSITIONS) — yani "Hesabım > Yetkili
//    Kullanıcılar" listesinde görünen kümeyle birebir aynıdır.
//
//    PROJEYİ EKLEYEN ÜYE ve KÜNYEDEKİ MİMARLAR BİLEREK DIŞARIDA: kullanıcı isteği "firma
//    yöneticilerine ve admine" diyor. Eklenecekse tek yer decisionRecipients'tır.
//
// 3) ONAY KUYRUĞU ATLATILAMAZ — POST, status'ü İSTEMCİDEN HİÇ OKUMAZ; yalnızca isteği yapanın
//    rolüne bakar (admin -> 'approved' + anında uygula, diğer herkes -> 'pending'). Karar verme
//    (decide) TAMAMEN AYRI bir uçtur ve kendi yetki kontrolü var. Bkz. hotspotTags.js tasarım
//    notu 3 ve proje notu [[project_submission_moderation_bypass_2026_09_05]].
//
// 4) ONAYLANINCA NEREYE YAZILIR — kullanıcı isteği iki hedef sayıyor ("lightboxa ve proje
//    künyesine"), bu yüzden İKİSİ birden yazılır:
//      * projects.image_credits[<görsel>] = ad   -> lightbox'ın "© ..." etiketi (madde 1),
//      * projects.photo_credit_text             -> künyedeki "Fotoğraf" satırı,
//    ve AYRICA varsa projenin project_submissions taslağı. Yalnızca canonical'a yazmak SESSİZ VERİ
//    KAYBI olurdu: proje sahibi projesini bir daha kaydettiğinde canonicalSync#syncProject
//    canonical satırın bu iki alanını taslaktan BAŞTAN yazar ve onaylanmış ad iz bırakmadan
//    silinirdi (bkz. hotspotTags.js tasarım notu 4 — AYNI tuzak).
//    Ad sitede bir KİŞİ kaydıyla eşleşiyorsa project_photographers kenarı da kurulur, aksi halde
//    künyedeki ad tıklanamaz düz metin olarak kalırdı (bkz. src/routes/project.js#
//    fetchPhotographerDetails). Eşleşme kuralı canonicalSync#syncProject'teki ile AYNI
//    (findOneByName) — iki yol ayrışırsa aynı ad bir yolda çipe, diğerinde metne dönerdi.
// ============================================================================================

const PENDING = 'pending';

// Kullanıcı başına SAATLİK talep tavanı (bkz. tasarım notu 1). 10: gerçek bir fotoğrafçının bir
// oturumda birkaç projedeki karelerini sahiplenmesine yeter, tek hesabın admin bildirim kutusunu
// doldurmasını engeller.
const CLAIM_HOURLY_LIMIT = 10;

// Künyeye yazılacak adın üst sınırı — sanitizeImageCredits'in kendi sınırıyla (200) AYNI olmak
// zorunda: ad İKİ alana birden yazılıyor (photo_credit_text ve image_credits) ve biri diğerinden
// farklı kırpılırsa lightbox ile künye sessizce ayrışırdı.
const MAX_NAME_LEN = 200;

function isAdmin(user) { return !!user && user.role === 'admin'; }

function parseJsonObject(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function parseImages(raw) {
  try { const arr = raw ? JSON.parse(raw) : []; return Array.isArray(arr) ? arr : []; } catch { return []; }
}

async function adminUserIds(env) {
  const { results } = await env.DB.prepare("SELECT id FROM users WHERE role = 'admin'").all();
  return (results || []).map(r => r.id);
}

// Projenin künyesindeki FİRMA adları — project_designers'ın office tarafı (bkz.
// src/routes/project.js#fetchDesignerDetails'teki AYNI kenar). Arşivdeki/gizli firmalar da
// okunur: bir firmanın yöneticisi, firma o an yayında olmasa bile künyesindeki fotoğraf
// talebine karar verebilmeli.
async function projectOfficeNames(env, projectId) {
  const { results } = await env.DB.prepare(
    `SELECT ofc.name AS name
       FROM project_designers pd
       JOIN offices ofc ON ofc.id = pd.office_id AND ofc.deleted_at IS NULL
      WHERE pd.project_id = ?`
  ).bind(projectId).all();
  return [...new Set((results || []).map(r => r.name).filter(Boolean))];
}

// KARAR KÜMESİ + BİLDİRİM ALICILARI — TEK kaynak (bkz. tasarım notu 2). Döner: Set<userId>
// (adminler DAHİL DEĞİL; onlar ayrıca ve koşulsuz eklenir/yetkilidir).
async function officeManagerUserIds(env, projectId) {
  const names = await projectOfficeNames(env, projectId);
  const ids = new Set();
  for (const name of names) {
    const managers = await fetchOfficeManagers(env, name, OFFICE_EDIT_POSITIONS);
    for (const m of managers) if (m && m.userId) ids.add(m.userId);
  }
  return ids;
}

// Bu talebi kim karara bağlayabilir. Bildirim alıcılarıyla AYNI kümeden türer (bkz. tasarım
// notu 2) — ayrışırsa bildirimi alan kişi butona bastığında 403 alırdı.
async function canDecide(env, user, projectId) {
  if (isAdmin(user)) return true;
  if (!user || !projectId) return false;
  return (await officeManagerUserIds(env, projectId)).has(user.id);
}

// ---------------------------------------------------------------------------------------------
// Onaylanmış bir talebi GERÇEKTEN uygular (bkz. tasarım notu 4).
// Döndürür: { ok: true, projectSlug } | { ok: false, error: '<kullanıcıya gösterilecek sebep>' }
// ---------------------------------------------------------------------------------------------
async function applyPhotoClaim(env, claim) {
  const project = await env.DB.prepare(
    `SELECT id, slug, legacy_key, images, image_credits, photo_credit_text
       FROM projects WHERE slug = ? AND deleted_at IS NULL`
  ).bind(claim.project_slug).first();
  if (!project) return { ok: false, error: 'Proje artık yayında değil.' };

  const name = String(claim.claimed_name || '').trim().slice(0, MAX_NAME_LEN);
  if (!name) return { ok: false, error: 'Künyeye yazılacak bir ad yok.' };

  const images = parseImages(project.images);
  // Görsel hâlâ projenin galerisinde mi? Proje sahibi bu arada o kareyi kaldırmış olabilir — o
  // durumda ad hiçbir zaman görünmeyecek bir URL'ye yazılırdı (hotspotTags.js#applyHotspot'taki
  // AYNI kontrol). image_url NULL olan talep (künyenin tamamı) bu kontrolün DIŞINDA.
  if (claim.image_url && images.length && !images.includes(claim.image_url)) {
    return { ok: false, error: 'Bu görsel projenin galerisinde artık yok.' };
  }

  // (a) Künye metni — ad zaten varsa DOKUNULMAZ. Karşılaştırma foldTr ile: "Ayça"/"Ayca" bu depoda
  // AYNI addır (bkz. CLAUDE.md "Bir projede aynı ad künyeye İKİ KEZ yazılamaz") ve birebir metin
  // karşılaştırması aynı kişiyi künyeye ikinci kez yazardı.
  const existingNames = splitPhotographerNames(project.photo_credit_text);
  const alreadyCredited = existingNames.some(n => foldTr(n) === foldTr(name));
  const creditText = alreadyCredited ? (project.photo_credit_text || '') : [...existingNames, name].join(', ');

  // (b) Görsel bazlı eşleme — yalnızca tek bir kare talep edildiyse. sanitizeImageCredits, yazılan
  // haritayı normalizeSubmission'ın uyguladığı AYNI sınırlardan geçirir (form dışı bu yol da o
  // sınırların dışında kalmamalı).
  const credits = parseJsonObject(project.image_credits);
  if (claim.image_url) credits[claim.image_url] = name;
  const cleanCredits = sanitizeImageCredits(credits);
  const creditsJson = Object.keys(cleanCredits).length ? JSON.stringify(cleanCredits) : null;

  await env.DB.prepare(
    `UPDATE projects SET photo_credit_text = ?, image_credits = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(creditText || null, creditsJson, project.id).run();

  // (c) Tıklanabilir fotoğrafçı çipi — ad sitede bir KİŞİ kaydıyla eşleşiyorsa kenar kurulur.
  // Kural canonicalSync#syncProject'teki ile AYNI (bkz. tasarım notu 4).
  if (!alreadyCredited) {
    const match = await findOneByName(env, 'architects', name);
    if (match.row) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO project_photographers (project_id, architect_id) VALUES (?, ?)`
      ).bind(project.id, match.row.id).run();
    }
  }

  // (d) Taslak(lar) — bkz. tasarım notu 4. Eşleştirme hotspotTags.js#applyHotspot ile BİREBİR aynı
  // iki yoldan yapılır (claimed_slug ya da legacy_key="submission:<id>") ve birden fazla taslak
  // aynı projeye bağlı olabileceğinden HEPSİ güncellenir.
  const marker = /^submission:(.+)$/.exec(project.legacy_key || '');
  const drafts = await env.DB.prepare(
    `SELECT id, photoCreditText, imageCredits FROM project_submissions
      WHERE claimed_slug IN (?, ?) OR (? IS NOT NULL AND id = ?)`
  ).bind(project.slug, project.legacy_key || '', marker ? marker[1] : null, marker ? marker[1] : '').all();
  for (const draft of (drafts.results || [])) {
    const draftNames = splitPhotographerNames(draft.photoCreditText);
    const draftHas = draftNames.some(n => foldTr(n) === foldTr(name));
    const draftText = draftHas ? (draft.photoCreditText || '') : [...draftNames, name].join(', ');
    const draftCredits = parseJsonObject(draft.imageCredits);
    if (claim.image_url) draftCredits[claim.image_url] = name;
    const draftClean = sanitizeImageCredits(draftCredits);
    await env.DB.prepare('UPDATE project_submissions SET photoCreditText = ?, imageCredits = ? WHERE id = ?')
      .bind(draftText || null, Object.keys(draftClean).length ? JSON.stringify(draftClean) : null, draft.id).run();
  }

  // invalidatePublicCache() TEK BAŞINA YETMEZ — /api/project/:slug detay yanıtı caches.default'ta
  // 5 dakikalık s-maxage ile durur ve listFingerprint TAŞIMAZ, yani HIT yolunda tazelik
  // DOĞRULANMAZ: onay veren kişi "onayladım ama görünmüyor" diye bakakalırdı. Bkz.
  // hotspotTags.js#applyHotspot'taki AYNI gerçek bulgu ve purgeSsrDetailCache gerekçesi.
  await Promise.all([
    invalidatePublicCache(env),
    purgeSsrDetailCache('project', project.slug, env),
  ]);
  return { ok: true, projectSlug: project.slug };
}

// ---------------------------------------------------------------------------------------------
// Router. /access dışındaki TÜM uçlar oturum ister (bkz. hotspotTags.js'teki AYNI desen):
// bekleyen talepler yayında görünmeyen içeriktir.
// ---------------------------------------------------------------------------------------------
export async function handlePhotoClaimsRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "photo-claims", ...]

  const user = await getSessionUser(request, env);

  // GET .../access — YALNIZCA "bu ziyaretçiye 'Fotoğraf bana ait' butonu gösterilsin mi" sorusunu
  // yanıtlar (bkz. js/components/gallery.js). Oturumsuz istekte 401 DEĞİL {canClaim:false} döner:
  // giriş yapmamış ziyaretçi için "hayır" doğru ve beklenen yanıttır, 401 ise her proje
  // sayfasında gereksiz bir konsol hatası üretirdi. Hiçbir yetki VERMEZ — gerçek kapı
  // createClaim'deki oturum kontrolüdür. `name` de döner: kutu, künyeye yazılacak adı kullanıcının
  // hesap adıyla ÖNDEN DOLDURUR (düzenlenebilir — bkz. migrations/0122'deki claimed_name notu).
  if (segments.length === 3 && segments[2] === 'access' && request.method === 'GET') {
    if (!user) return json({ canClaim: false, name: '' });
    return json({ canClaim: true, name: user.name || '' });
  }

  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  if (segments.length === 3 && segments[2] === 'pending' && request.method === 'GET') {
    return listPending(env, user);
  }
  if (segments.length === 2 && request.method === 'POST') {
    return createClaim(request, env, user);
  }
  if (segments.length === 4 && segments[3] === 'decide' && request.method === 'POST') {
    return decideClaim(request, env, user, segments[2]);
  }
  if (segments.length === 3 && request.method === 'GET') {
    return getClaim(env, user, segments[2]);
  }
  return errorJson('Bulunamadı', 404);
}

// POST /api/photo-claims — yeni künye talebi. Admin'de anında uygulanır (hotspotTags.js'teki AYNI
// kullanıcı kuralı: "Admin hesaplarından yapılanların onaya düşmesine gerek yok").
async function createClaim(request, env, user) {
  // KUYRUK SPAM'İ KAPISI (bkz. tasarım notu 1). Adminler muaf: onların talebi kuyruğa hiç düşmez.
  if (!isAdmin(user) && !(await checkRateLimit(env, 'photo-claim', user.id, CLAIM_HOURLY_LIMIT, 60 * 60 * 1000))) {
    return errorJson(`Saatte en fazla ${CLAIM_HOURLY_LIMIT} fotoğraf talebi gönderebilirsin. Biraz sonra tekrar dene.`, 429);
  }
  const body = await readJson(request);
  const projectSlug = String(body.projectSlug || '').trim();
  // imageUrl BOŞ GEÇİLEBİLİR: talep tek bir kare için değil, projenin künyesinin tamamı için de
  // açılabilir (bkz. migrations/0122'deki image_url notu).
  const imageUrl = String(body.imageUrl || '').trim();
  const claimedName = String(body.name || user.name || '').trim().slice(0, MAX_NAME_LEN);
  const note = String(body.note || '').trim().slice(0, 600);
  if (!projectSlug) return errorJson('Eksik bilgi.');
  if (!claimedName) return errorJson('Künyeye yazılacak adı gir.');

  const project = await env.DB.prepare(
    `SELECT id, slug, title, images FROM projects
      WHERE slug = ? AND deleted_at IS NULL AND (hidden_at IS NULL OR preview_at IS NOT NULL)`
  ).bind(projectSlug).first();
  if (!project) return errorJson('Proje bulunamadı.', 404);
  const images = parseImages(project.images);
  if (imageUrl && !images.includes(imageUrl)) return errorJson('Bu görsel bu projeye ait değil.');

  const now = Date.now();
  const id = newId();
  const claimRow = { project_slug: project.slug, image_url: imageUrl || null, claimed_name: claimedName };

  // ADMIN: onaya hiç düşmez — doğrudan uygulanır ve 'approved' olarak kaydedilir (denetim izi:
  // kimin, ne zaman eklediği kayıtlı kalır).
  if (isAdmin(user)) {
    const applied = await applyPhotoClaim(env, claimRow);
    if (!applied.ok) return errorJson(applied.error);
    await env.DB.prepare(
      `INSERT INTO project_photo_claims (id, project_slug, image_url, claimed_name, note, created_by_user_id, status, decided_by_user_id, decided_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?)`
    ).bind(id, project.slug, imageUrl || null, claimedName, note || null, user.id, user.id, now, now).run();
    return json({ ok: true, status: 'approved' });
  }

  try {
    await env.DB.prepare(
      `INSERT INTO project_photo_claims (id, project_slug, image_url, claimed_name, note, created_by_user_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, '${PENDING}', ?)`
    ).bind(id, project.slug, imageUrl || null, claimedName, note || null, user.id, now).run();
  } catch (err) {
    // migrations/0122'deki kısmi UNIQUE indeks — bu kullanıcının bu görsel için bekleyen bir
    // talebi zaten var.
    if (String(err && err.message || '').includes('UNIQUE')) {
      return errorJson('Bu görsel için onay bekleyen bir talebin zaten var.');
    }
    throw err;
  }

  // Bildirimler: projenin künyesindeki firmaların YÖNETİCİLERİ + TÜM adminler (kullanıcı isteği:
  // "firma yöneticilerine ve admine bildirim gitsin"). Karar kümesiyle AYNI kaynaktan türer (bkz.
  // tasarım notu 2). Talebi açan hesap kümede olabilir — o kişi aynı zamanda onaylayıcıdır ve
  // bildirim onun için "onayına sunuldu" satırıdır.
  const recipients = new Set([
    ...(await officeManagerUserIds(env, project.id)),
    ...(await adminUserIds(env)),
  ]);
  for (const uid of recipients) {
    await createNotification(
      env, uid, 'photo_claim',
      'Fotoğraf künyesi talebi onay bekliyor',
      `${user.name || 'Bir üye'}, “${project.title}” projesinin ${imageUrl ? 'bir görselinin' : 'fotoğraflarının'} kendisine ait olduğunu bildirdi ve künyeye “${claimedName}” yazılmasını istiyor. Onaylarsan bu ad künyede ve büyütülmüş görselde görünür olur.`,
      `photo-claim:${id}`
    );
  }

  return json({ ok: true, status: PENDING });
}

// GET /api/photo-claims/:id — Hesabım'daki onay pop-up'ının gösterdiği tek kayıt (bkz.
// js/components/auth-modal.js#openPhotoClaimPrompt).
async function getClaim(env, user, id) {
  const claim = await env.DB.prepare('SELECT * FROM project_photo_claims WHERE id = ?').bind(id).first();
  if (!claim) return errorJson('Bulunamadı', 404);
  const project = await env.DB.prepare(
    'SELECT id, slug, title, location, photo_credit_text FROM projects WHERE slug = ? AND deleted_at IS NULL'
  ).bind(claim.project_slug).first();
  // Talebi AÇAN kişi de görebilir (kendi talebinin durumunu görmek için) ama karar yetkisi ayrı
  // bir bayrakla söylenir (hotspotTags.js#getTag ile AYNI desen).
  const mayDecide = await canDecide(env, user, project ? project.id : null);
  if (!mayDecide && claim.created_by_user_id !== user.id) return errorJson('Bulunamadı', 404);
  const creator = await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(claim.created_by_user_id).first();
  return json({
    item: {
      id: claim.id,
      status: claim.status,
      imageUrl: claim.image_url || null,
      claimedName: claim.claimed_name,
      note: claim.note || '',
      createdAt: claim.created_at,
      createdBy: creator?.name || '',
      project: project
        ? { slug: project.slug, title: project.title, location: project.location || '', credit: project.photo_credit_text || '' }
        : null,
    },
    canDecide: mayDecide,
  });
}

// GET /api/photo-claims/pending — kullanıcının karara bağlayabileceği tüm bekleyen talepler.
// Hesabım'daki bildirim satırından bağımsız bir "toplu bakış" için (bildirim silinmiş olsa bile
// talep kaybolmaz) — hotspotTags.js#listPending ile AYNI gerekçe.
//
// SÜZGEÇ SQL'DE DEĞİL BURADA: "bu kullanıcı bu projenin firma yöneticisi mi" sorusunun cevabı iki
// ayrı tabloyu (profile_claims + office_founders) birleştiren bir fonksiyondan geliyor (bkz.
// fetchOfficeManagers) ve onu tek bir WHERE'e gömmek kuralın İKİNCİ bir kopyasını yaratırdı.
// Bekleyen talep sayısı tanımı gereği küçük olduğundan (kullanıcı başına saatlik tavan var) son
// 200 satırı okuyup elemek güvenli ve tek kurallı olan yol.
async function listPending(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.project_slug, c.image_url, c.claimed_name, c.note, c.created_at,
            pr.id AS project_id, pr.title AS project_title
       FROM project_photo_claims c
       LEFT JOIN projects pr ON pr.slug = c.project_slug AND pr.deleted_at IS NULL
      WHERE c.status = 'pending'
      ORDER BY c.created_at DESC LIMIT 200`
  ).all();
  const rows = results || [];
  if (isAdmin(user)) return json({ items: rows.slice(0, 50).map(stripProjectId) });
  const out = [];
  // Proje başına TEK yetki sorgusu — aynı projede birden fazla bekleyen talep olabilir.
  const decidable = new Map();
  for (const r of rows) {
    if (!r.project_id) continue;
    if (!decidable.has(r.project_id)) decidable.set(r.project_id, await canDecide(env, user, r.project_id));
    if (decidable.get(r.project_id)) out.push(stripProjectId(r));
    if (out.length >= 50) break;
  }
  return json({ items: out });
}

function stripProjectId(row) {
  const { project_id, ...rest } = row;
  return rest;
}

// POST /api/photo-claims/:id/decide { approve: true|false }
async function decideClaim(request, env, user, id) {
  const body = await readJson(request);
  const approve = body.approve === true;
  const claim = await env.DB.prepare('SELECT * FROM project_photo_claims WHERE id = ?').bind(id).first();
  if (!claim) return errorJson('Bulunamadı', 404);
  if (claim.status !== PENDING) return errorJson('Bu talep zaten karara bağlanmış.');

  const project = await env.DB.prepare(
    'SELECT id, slug, title FROM projects WHERE slug = ? AND deleted_at IS NULL'
  ).bind(claim.project_slug).first();
  if (!(await canDecide(env, user, project ? project.id : null))) {
    return errorJson('Bu talebi onaylama yetkin yok.', 403);
  }

  if (approve) {
    const applied = await applyPhotoClaim(env, claim);
    if (!applied.ok) return errorJson(applied.error);
  }
  await env.DB.prepare(
    'UPDATE project_photo_claims SET status = ?, decided_by_user_id = ?, decided_at = ? WHERE id = ?'
  ).bind(approve ? 'approved' : 'rejected', user.id, Date.now(), id).run();

  // Talebi açan kişi kararı öğrensin — kendi kararıysa kendine bildirim göndermeye gerek yok.
  if (claim.created_by_user_id !== user.id) {
    await createNotification(
      env, claim.created_by_user_id, 'photo_claim',
      approve ? 'Fotoğraf künyesi talebin onaylandı' : 'Fotoğraf künyesi talebin reddedildi',
      approve
        ? `“${claim.claimed_name}” artık ${project ? `“${project.title}”` : 'bu'} projesinin fotoğraf künyesinde görünüyor.`
        : `“${claim.claimed_name}” için gönderdiğin künye talebi onaylanmadı.`,
      // Onaylanan talep için doğru hedef, adın GÖRÜNDÜĞÜ projedir (bkz. auth-modal.js#
      // notifEntityPath). Reddedilende açılacak bir şey yok, link boş kalır.
      approve && claim.project_slug ? `/proje/${encodeURIComponent(claim.project_slug)}` : null
    );
  }

  return json({ ok: true, status: approve ? 'approved' : 'rejected' });
}
