import { errorJson } from '../lib/http.js';
import { parseSubmissionRow } from '../lib/submissionTypes.js';
import { slugify } from '../lib/slugify.js';
import { cachedPublicJson } from '../lib/publicCache.js';
// bkz. src/routes/architect.js'teki AYNI CJS-interop yorumu.
import dataJs from '../../data.js';
import projeJs from '../../projeler-data.js';

const { architects, offices } = dataJs;
const { projects } = projeJs;

// ÖNEMLİ: bkz. src/routes/architect.js'teki AYNI "paylaşılan diziler mutasyona uğratılmaz"
// yorumu — bu isolate'ın ömrü boyunca TÜM istekler arasında paylaşılan architects/offices/
// projects dizileri burada da yalnızca okunur, hiçbir yerde push/Object.assign/alan ataması
// yapılmaz.

function findByNameOrSlug(list, key) {
  return list.find(x => x.name === key) || list.find(x => slugify(x.name) === key);
}

async function fetchApprovedRows(env, table, whereExtra, params = []) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM ${table} WHERE status = 'approved' ${whereExtra}`
  ).bind(...params).all();
  return results;
}

function memberRowToOffice(row) {
  const p = parseSubmissionRow('offices', row);
  return {
    name: p.name, loc: p.loc, cats: p.cats, yil: p.yil, website: p.website,
    about: p.about, logo: p.logo_url, awards: p.awards, submissionId: p.id,
  };
}

function memberRowToProject(row) {
  const p = parseSubmissionRow('projects', row);
  return { slug: p.slug, title: p.title, category: p.category, images: p.images, designer: p.designer };
}

// GET /api/office/:key — ofis-detay.html'nin eskiden ayrı ayrı yaptığı fetch'lerin (statik dizi +
// /api/public/offices fallback + fetchProfileEdits overlay + kurucu mimarların office/role/foto
// senk. + /api/public/hidden + /api/public/projects + /api/public/project-edits) TEK istekte,
// sunucu tarafında birleştirilmiş hâli. Dönen şekil: { item, founders, relatedProjects, hidden }.
export async function handleOfficeRoute(request, env, url, rawKey) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  const key = decodeURIComponent(rawKey || '');
  if (!key) return errorJson('Geçersiz istek.');

  return cachedPublicJson(request, env, url.pathname, () => buildOfficePayload(env, key));
}

async function buildOfficePayload(env, key) {
  const [memberRows, officeOverlayRows, architectOverlayRows, hiddenRows, memberProjectRows, projectOverlayRows] = await Promise.all([
    fetchApprovedRows(env, 'office_submissions', 'AND claimed_profile_key IS NULL'),
    fetchApprovedRows(env, 'office_submissions', 'AND claimed_profile_key IS NOT NULL'),
    fetchApprovedRows(env, 'architect_submissions', 'AND claimed_profile_key IS NOT NULL'),
    env.DB.prepare(`SELECT content_type, content_key FROM legacy_content_hidden WHERE content_type IN ('offices', 'projects')`).all(),
    fetchApprovedRows(env, 'project_submissions', 'AND claimed_slug IS NULL'),
    fetchApprovedRows(env, 'project_submissions', 'AND claimed_slug IS NOT NULL'),
  ]);

  const memberOffices = memberRows.map(memberRowToOffice);
  const officeOverlayByName = new Map(officeOverlayRows.map(r => [r.claimed_profile_key, parseSubmissionRow('offices', r)]));
  const architectOverlayByName = new Map(architectOverlayRows.map(r => [r.claimed_profile_key, parseSubmissionRow('architects', r)]));
  const hiddenOffices = new Set(hiddenRows.results.filter(r => r.content_type === 'offices').map(r => r.content_key));
  const hiddenProjects = new Set(hiddenRows.results.filter(r => r.content_type === 'projects').map(r => r.content_key));

  const pool = [...offices, ...memberOffices];
  let base = findByNameOrSlug(pool, key);
  let overlay = null;
  let staticKeyForHidden = null;
  let claimKey = null;
  let matched = !!base;

  if (base && !base.submissionId) {
    overlay = officeOverlayByName.get(base.name) || null;
    staticKeyForHidden = base.name;
    claimKey = base.name;
  } else if (!base) {
    // Yeniden adlandırılmış statik firma: bkz. src/routes/architect.js'teki AYNI desen.
    for (const [staticName, parsed] of officeOverlayByName) {
      if (parsed.name && slugify(parsed.name) === key) {
        const staticOff = offices.find(x => x.name === staticName);
        if (staticOff) { base = staticOff; overlay = parsed; staticKeyForHidden = staticName; claimKey = staticName; matched = true; }
        break;
      }
    }
  }
  if (!base) base = offices[0]; // mevcut client davranışıyla birebir aynı fallback (found || offices[0])

  const o = { ...base };
  if (overlay) {
    if (overlay.name) o.name = overlay.name;
    if (overlay.loc) o.loc = overlay.loc;
    if (overlay.cats) o.cats = overlay.cats;
    if (overlay.yil) o.yil = overlay.yil;
    if (overlay.website) o.website = overlay.website;
    if (overlay.about !== undefined && overlay.about !== null) o.about = overlay.about;
    if (overlay.logo_url) o.logo = overlay.logo_url;
  }
  // renderProfileEditButton'ın "claim=" linki HER ZAMAN orijinal statik anahtarı (claimed_profile_key)
  // kullanmalı — o.name bir yeniden adlandırmadan sonra değişmiş olabilir (bkz. ofis-detay.html
  // #renderProfileEditButton'daki AYNI _claimKey gerekçesi).
  if (claimKey && claimKey !== o.name) o._claimKey = claimKey;

  // Kurucular/Ortaklar: architects[].office bu (overlay uygulanmış) firmanın adına eşit olan
  // TÜM mimarlar — statik office.founders alanı zaten kullanılmıyor (bkz. ofis-detay.html
  // #renderFoundersGrid). Her adayın KENDİ overlay'i varsa office/role/foto için o kullanılır
  // (bkz. ofis-detay.html#applyProfileEdits'teki döngü — mimar-detay.html'deki meslektaş
  // senkronundan FARKLI olarak burada foto da senkronlanır, mevcut davranış korunuyor).
  const founders = architects
    .map(x => {
      const xOverlay = architectOverlayByName.get(x.name);
      const effectiveOffice = xOverlay ? (xOverlay.office || null) : x.office;
      const effectiveRole = (xOverlay && xOverlay.position) || x.role;
      const effectivePhoto = (xOverlay && xOverlay.photo_url) || x.photo;
      return { name: x.name, role: effectiveRole, photo: effectivePhoto, badges: x.badges, office: effectiveOffice };
    })
    .filter(x => x.office === o.name)
    .map(({ office: _drop, ...f }) => f);

  // İlgili projeler: bkz. src/routes/architect.js'teki AYNI desen, yalnızca ofis adıyla eşleşme.
  const projectOverlayBySlug = new Map(projectOverlayRows.map(r => [r.claimed_slug, parseSubmissionRow('projects', r)]));
  const projectPool = projects
    .filter(p => !hiddenProjects.has(p.slug))
    .map(p => {
      const po = projectOverlayBySlug.get(p.slug);
      return po ? { ...p, title: po.title || p.title, category: po.category, images: po.images, designer: po.designer } : p;
    })
    .concat(memberProjectRows.map(memberRowToProject).filter(p => !hiddenProjects.has(p.slug)));

  const relatedProjects = projectPool
    .filter(p => (p.designer || []).includes(o.name))
    .map(p => ({ slug: p.slug, title: p.title, images: p.images, category: p.category }));

  return {
    item: o,
    founders,
    relatedProjects,
    hidden: matched && staticKeyForHidden ? hiddenOffices.has(staticKeyForHidden) : false,
  };
}
