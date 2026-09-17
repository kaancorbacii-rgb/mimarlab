// FOTOĞRAF sayfasının (bkz. /fotograf, src/routes/photos.js, kullanıcı isteği 2026-09-17) ham veri
// havuzu — projectPool.js#fetchActiveProjectPool İLE AYNI KV-önbellekli "havuz" deseni
// (getCachedPool, publicCache.js#POOL_CACHE_KINDS'e 'photos' olarak eklendi).
//
// ŞEKİL (2026-09-18): { projects: { [slug]: meta }, items: [{ url, projectSlug, spaces, photographer }] }
// — proje künyesi (mimarlar/firmalar/tür/tip/grup/yer/yıl/ödül, bkz. lightbox künyesi) HER GÖRSELDE
// tekrarlansaydı 11.000+ görsellik havuz KV'de gereksiz şişerdi; künye proje başına BİR kez tutulur,
// uç sayfalama sonrası birleştirir (src/routes/photos.js#expand).
//
// SIRALAMA PROJE SEVİYESİNDEDİR: en son eklenen PROJENİN tüm görselleri önce (`created_at DESC,
// id DESC` — /proje'nin editoryal COALESCE(relisted_at, ...) zinciri BİLEREK değil: bu sayfa
// "yükleme sırası"nı soruyor). Bir projenin kendi görselleri images[] sırasındadır.
//
// keywordSpaces (2026-09-18, kullanıcı isteği: "Arama motoru sonuçlarını proje künyelerini de
// kullanarak geliştir"): projenin KÜNYE METNİNDE (başlık + açıklama + tip/grup) hangi mekan
// anahtar kelimeleri geçiyorsa o etiketler (photo-space-taxonomy.js#keywords). Uç, AI etiketi
// OLMAYAN görsellerde bunu İKİNCİL sonuç olarak kullanır — AI etiketiyle asla çelişmez (etiketi
// olan görsel yalnızca AI etiketine göre süzülür).
import { getCachedPool } from './publicCache.js';
import { foldTr } from './textMatch.js';
import photoSpaceTaxonomyJs from '../../photo-space-taxonomy.js';

const { PHOTO_SPACE_TAXONOMY } = photoSpaceTaxonomyJs;

function parseJsonSafe(text, fallback) {
  if (!text) return fallback;
  try { const v = JSON.parse(text); return v == null ? fallback : v; } catch { return fallback; }
}
const strList = (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : []);

export function keywordSpacesFor(text) {
  const hay = foldTr(String(text || ''));
  if (!hay) return [];
  const out = [];
  for (const t of PHOTO_SPACE_TAXONOMY) {
    if ((t.keywords || []).some(k => hay.includes(foldTr(k)))) out.push(t.label);
  }
  return out;
}

async function fetchPhotoPoolRaw(env) {
  // BLURLU (önizleme) PROJELER GÖSTERİLMEZ (kullanıcı isteği, 2026-09-17 madde 10) — projectPool.js'in
  // "(hidden_at IS NULL OR preview_at IS NOT NULL)" kuralından BİLEREK ayrılır. Blur kalkınca
  // invalidatePublicCache havuzu tazeler.
  const [{ results: projects }, { results: designerRows }] = await Promise.all([
    env.DB.prepare(
      `SELECT id, slug, title, location, project_date, discipline, category, type, awards, description,
              images, image_spaces, image_credits, photo_credit_text, designer_names_raw, office_names_raw
       FROM projects
       WHERE deleted_at IS NULL AND hidden_at IS NULL
       ORDER BY created_at DESC, id DESC`
    ).all(),
    env.DB.prepare(
      `SELECT pd.project_id, ofc.name AS office_name, ar.name AS architect_name
       FROM project_designers pd
       LEFT JOIN offices ofc ON ofc.id = pd.office_id AND ofc.deleted_at IS NULL AND ofc.hidden_at IS NULL
       LEFT JOIN architects ar ON ar.id = pd.architect_id AND ar.deleted_at IS NULL AND ar.hidden_at IS NULL
       ORDER BY pd.rowid ASC`
    ).all(),
  ]);

  const officesByProject = new Map();
  const architectsByProject = new Map();
  for (const r of designerRows || []) {
    if (r.office_name) { if (!officesByProject.has(r.project_id)) officesByProject.set(r.project_id, []); officesByProject.get(r.project_id).push(r.office_name); }
    if (r.architect_name) { if (!architectsByProject.has(r.project_id)) architectsByProject.set(r.project_id, []); architectsByProject.get(r.project_id).push(r.architect_name); }
  }
  const uniq = (arr) => { const seen = new Set(); return arr.filter(v => { const k = foldTr(v); if (seen.has(k)) return false; seen.add(k); return true; }); };

  const projectsOut = {};
  const items = [];
  for (const row of projects || []) {
    const images = parseJsonSafe(row.images, []);
    if (!Array.isArray(images) || !images.length) continue;
    const spacesByUrl = parseJsonSafe(row.image_spaces, {});
    const creditsByUrl = parseJsonSafe(row.image_credits, {});
    // Bağ (project_designers) + künyeye yazıldığı hâliyle ham adlar (bkz. migrations/0120) — bağ
    // kurulamamış adlar da künyede görünmeli (projectPool.js#shapeProjectItem ile AYNI ilke).
    const offices = uniq([...(officesByProject.get(row.id) || []), ...strList(parseJsonSafe(row.office_names_raw, []))]);
    const architects = uniq([...(architectsByProject.get(row.id) || []), ...strList(parseJsonSafe(row.designer_names_raw, []))])
      .filter(a => !offices.some(o => foldTr(o) === foldTr(a)));
    const discipline = strList(parseJsonSafe(row.discipline, []));
    const category = strList(parseJsonSafe(row.category, []));
    const type = strList(parseJsonSafe(row.type, []));
    const awards = strList(parseJsonSafe(row.awards, []));
    const keywordText = [row.title, row.description, ...category, ...type].join(' ');
    projectsOut[row.slug] = {
      title: row.title,
      location: row.location || null,
      date: row.project_date || null,
      discipline, category, type, awards,
      architects, offices,
      credit: offices[0] || architects[0] || null,
      creditType: offices[0] ? 'office' : (architects[0] ? 'architect' : null),
      photoCredit: (row.photo_credit_text || '').trim() || null,
      keywordSpaces: keywordSpacesFor(keywordText),
    };
    for (const url of images) {
      if (!url || typeof url !== 'string') continue;
      const tags = Array.isArray(spacesByUrl[url]) ? spacesByUrl[url].filter(s => typeof s === 'string') : null;
      const perImage = typeof creditsByUrl[url] === 'string' ? creditsByUrl[url].trim() : '';
      // spaces: null = AI HİÇ BAKMADI (etiketsiz), [] = AI baktı ve mekan bulamadı. İkincil
      // (künye) eşleşme yalnızca null olanlara uygulanır — AI "burada banyo yok" dediyse künyede
      // "banyo" geçmesi o kareyi banyo yapmaz.
      items.push({ url, projectSlug: row.slug, spaces: tags, photographer: perImage || null });
    }
  }
  return { projects: projectsOut, items };
}

export async function fetchPhotoPool(env) {
  return getCachedPool(env, 'photos', () => fetchPhotoPoolRaw(env));
}
