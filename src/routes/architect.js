import { json, errorJson } from '../lib/http.js';
import { parseSubmissionRow } from '../lib/submissionTypes.js';
import { slugify } from '../lib/slugify.js';
import { cachedPublicJson } from '../lib/publicCache.js';
// data.js/projeler-data.js tarayıcıda classic <script> olarak yüklenen, export içermeyen
// dosyalar; dosya sonlarındaki guard'lı `module.exports` bloğu sayesinde esbuild bunları CJS
// modülü olarak paketler (bkz. src/lib/seo.js'teki AYNI desen).
import dataJs from '../../data.js';
import projeJs from '../../projeler-data.js';

const { architects, offices } = dataJs;
const { projects } = projeJs;

// ÖNEMLİ: architects/offices/projects, esbuild tarafından modül kapsamına BİR KEZ yüklenen
// paylaşılan dizilerdir — Cloudflare Workers isolate'ı istekler arasında sıcak tutulduğundan
// (bkz. src/lib/seo.js#getArchitectMap gibi salt-okunur önbellekler), bu dizilerin ÜZERİNE
// YAZMAK (push/Object.assign/alan mutasyonu) bir isteğin yaptığı değişikliği isolate canlı
// kaldığı sürece TÜM SONRAKİ isteklere sızdırır (mimar-detay.html'nin tarayıcıda her sayfa
// yüklemesinde taze bir data.js kopyasıyla yaptığı mutasyonların AKSİNE). Bu dosyadaki hiçbir
// fonksiyon bu dizileri mutasyona uğratmaz; overlay her zaman yeni bir kopya ({ ...kayıt })
// üzerinde uygulanır.

function findByNameOrSlug(list, key) {
  return list.find(x => x.name === key) || list.find(x => slugify(x.name) === key);
}

async function fetchApprovedRows(env, table, whereExtra, params = []) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM ${table} WHERE status = 'approved' ${whereExtra}`
  ).bind(...params).all();
  return results;
}

// architect_submissions'ta claimed_profile_key IS NULL olan satırlar, hiçbir statik kayda
// bağlı olmayan "sırf üye" mimar profilleridir (bkz. GET /api/public/architects'teki AYNI
// filtre) — architects[] ile aynı şekle (name/dob/school/.../office/role) çevrilir ki isim/slug
// eşleştirmesi statik kayıtlarla birebir aynı şekilde çalışsın.
function memberRowToArchitect(row) {
  const p = parseSubmissionRow('architects', row);
  return {
    name: p.name, dob: p.dob, school: p.school, dept: p.dept, office: p.office,
    role: p.position, profession: p.profession, awards: p.awards, photo: p.photo_url,
    about: p.about, submissionId: p.id,
  };
}

function memberRowToProject(row) {
  const p = parseSubmissionRow('projects', row);
  return {
    slug: p.slug, title: p.title, category: p.category, images: p.images,
    designer: p.designer, submissionId: p.id,
  };
}

// GET /api/architect/:key — mimar-detay.html'nin eskiden 6-7 ayrı fetch'le (statik dizi +
// /api/public/architects fallback + fetchProfileEdits overlay + meslektaş office/role senk. +
// ofis overlay + /api/public/hidden + /api/public/projects + /api/public/project-edits) yaptığı
// birleştirmenin TEK istekte, sunucu tarafında yapılmış hâli. Dönen şekil: { item, office,
// colleagues, relatedProjects, hidden }.
export async function handleArchitectRoute(request, env, url, rawKey) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  const key = decodeURIComponent(rawKey || '');
  if (!key) return errorJson('Geçersiz istek.');

  return cachedPublicJson(request, env, url.pathname, () => buildArchitectPayload(env, key));
}

async function buildArchitectPayload(env, key) {
  const [memberRows, architectOverlayRows, officeOverlayRows, hiddenRows, memberProjectRows, projectOverlayRows] = await Promise.all([
    fetchApprovedRows(env, 'architect_submissions', 'AND claimed_profile_key IS NULL'),
    fetchApprovedRows(env, 'architect_submissions', 'AND claimed_profile_key IS NOT NULL'),
    fetchApprovedRows(env, 'office_submissions', 'AND claimed_profile_key IS NOT NULL'),
    env.DB.prepare(`SELECT content_type, content_key FROM legacy_content_hidden WHERE content_type IN ('architects', 'projects')`).all(),
    fetchApprovedRows(env, 'project_submissions', 'AND claimed_slug IS NULL'),
    fetchApprovedRows(env, 'project_submissions', 'AND claimed_slug IS NOT NULL'),
  ]);

  const memberArchitects = memberRows.map(memberRowToArchitect);
  const architectOverlayByName = new Map(architectOverlayRows.map(r => [r.claimed_profile_key, parseSubmissionRow('architects', r)]));
  const officeOverlayByName = new Map(officeOverlayRows.map(r => [r.claimed_profile_key, parseSubmissionRow('offices', r)]));
  const hidden = { results: hiddenRows.results };
  const hiddenArchitects = new Set(hidden.results.filter(r => r.content_type === 'architects').map(r => r.content_key));
  const hiddenProjects = new Set(hidden.results.filter(r => r.content_type === 'projects').map(r => r.content_key));

  const pool = [...architects, ...memberArchitects];
  let base = findByNameOrSlug(pool, key);
  let overlay = null;
  let staticKeyForHidden = null;
  let matched = !!base;

  if (base && !base.submissionId) {
    overlay = architectOverlayByName.get(base.name) || null;
    staticKeyForHidden = base.name;
  } else if (!base) {
    // Yeniden adlandırılmış statik mimar: overlay satırlarının YENİ adı slugify edilince
    // istenen key'e denk geliyorsa, o statik kaydı (eski adıyla) kaynak alıp overlay'i uygula
    // (bkz. mimar-detay.html'deki AYNI "if(!explicitMatch && mimarSlug)" bloğu).
    for (const [staticName, parsed] of architectOverlayByName) {
      if (parsed.name && slugify(parsed.name) === key) {
        const staticArch = architects.find(x => x.name === staticName);
        if (staticArch) { base = staticArch; overlay = parsed; staticKeyForHidden = staticName; matched = true; }
        break;
      }
    }
  }
  if (!base) base = architects[0]; // mevcut client davranışıyla birebir aynı fallback (explicitMatch || architects[0])

  const a = { ...base };
  if (overlay) {
    if (overlay.name) a.name = overlay.name;
    if (overlay.dob) a.dob = overlay.dob;
    if (overlay.school) a.school = overlay.school;
    if (overlay.dept) a.dept = overlay.dept;
    if (overlay.profession) a.profession = overlay.profession;
    if (overlay.awards && overlay.awards.length) a.awards = overlay.awards;
    if (overlay.photo_url) a.photo = overlay.photo_url;
    if (overlay.about !== undefined && overlay.about !== null) a.about = overlay.about;
    if (overlay.position) a.role = overlay.position;
    // office alanı üye düzenleme formunda her zaman gönderilir (boşsa da) — bkz.
    // handlePublicProfileEdits'teki AYNI davranış, admin bir bağlantıyı kasıtlı olarak
    // kaldırabilsin diye truthy kontrolü YOK.
    a.office = overlay.office || null;
  }

  let office = a.office ? offices.find(x => x.name === a.office) || null : null;
  if (office) {
    const officeOverlay = officeOverlayByName.get(office.name);
    if (officeOverlay) {
      const patched = { ...office };
      if (officeOverlay.name) patched.name = officeOverlay.name;
      if (officeOverlay.logo_url) patched.logo = officeOverlay.logo_url;
      office = patched;
    }
  }

  // Meslektaşlar: aynı (overlay uygulanmış) ofise bağlı diğer mimarlar. Her adayın KENDİ
  // overlay'i varsa office/role için o kullanılır (bkz. mimar-detay.html#applyProfileEdits'teki
  // "for(const arch of architects)" döngüsü) — isim/foto senkronu YOK (bu asimetri ofis-detay.html
  // #applyProfileEdits'teki kurucu fotoğrafı senkronundan farklı, iki dosyanın mevcut davranışı
  // birebir korunuyor).
  const colleagues = office ? pool
    .filter(x => x.name !== a.name)
    .map(x => {
      const xOverlay = !x.submissionId ? architectOverlayByName.get(x.name) : null;
      const effectiveOffice = xOverlay ? (xOverlay.office || null) : x.office;
      const effectiveRole = (xOverlay && xOverlay.position) || x.role;
      return { name: x.name, role: effectiveRole, photo: x.photo, badges: x.badges, office: effectiveOffice };
    })
    .filter(x => x.office === office.name) : [];

  // İlgili projeler: statik projeler-data.js + onaylı üye gönderisi projeleri (bkz. mimar-detay.html
  // #loadMemberRelatedProjects), statik olanlara varsa onaylı claimed_slug düzenlemesi bindirilir
  // (bkz. #applyRelatedProjectEdits), admin-hidden olanlar çıkarılır, sonra designer listesi
  // mimarın ya da ofisin GÜNCEL adıyla eşleşenler filtrelenir.
  const projectOverlayBySlug = new Map(projectOverlayRows.map(r => [r.claimed_slug, parseSubmissionRow('projects', r)]));
  const projectPool = projects
    .filter(p => !hiddenProjects.has(p.slug))
    .map(p => {
      const po = projectOverlayBySlug.get(p.slug);
      return po ? { ...p, title: po.title || p.title, category: po.category, images: po.images, designer: po.designer } : p;
    })
    .concat(memberProjectRows.map(memberRowToProject).filter(p => !hiddenProjects.has(p.slug)));

  const relatedProjects = projectPool
    .filter(p => (p.designer || []).includes(a.name) || (office && (p.designer || []).includes(office.name)))
    .map(p => ({ slug: p.slug, title: p.title, images: p.images, category: p.category }));

  return {
    item: a,
    office: office ? { name: office.name, loc: office.loc, cats: office.cats, yil: office.yil, logo: office.logo, badges: office.badges } : null,
    colleagues: colleagues.map(({ office: _drop, ...c }) => c),
    relatedProjects,
    hidden: matched && staticKeyForHidden ? hiddenArchitects.has(staticKeyForHidden) : false,
  };
}
