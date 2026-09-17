// FOTOĞRAF sayfasının (bkz. /fotograf, src/routes/photos.js, kullanıcı isteği 2026-09-17) ham veri
// havuzu — projectPool.js#fetchActiveProjectPool İLE AYNI KV-önbellekli "havuz" deseni
// (getCachedPool, publicCache.js#POOL_CACHE_KINDS'e 'photos' olarak eklendi).
//
// ŞEKİL: { projects: { [slug]: künye }, items: [{ url, projectSlug, spaces, photographer }] } —
// künye proje başına BİR kez tutulur (11.000+ görselde tekrarlansaydı KV'de şişerdi), uç sayfalama
// sonrası birleştirir (src/routes/photos.js#expand).
//
// SIRALAMA PROJE SEVİYESİNDEDİR: en son eklenen PROJENİN tüm görselleri önce (`created_at DESC,
// id DESC` — /proje'nin editoryal COALESCE(relisted_at, ...) zinciri BİLEREK değil: bu sayfa
// "yükleme sırası"nı soruyor). Bir projenin kendi görselleri images[] sırasındadır.
//
// items[].spaces: null = AI HİÇ BAKMADI; [] = AI baktı, mekan yok; [{label, confidence|null}] =
// etiketler (D1'de hem eski düz-string hem yeni {label,confidence} biçimi olabilir, ikisi de burada
// normalize edilir). ÇİZİM etiketi (photo-space-taxonomy.js kind:'drawing') taşıyan görsel havuza
// HİÇ GİRMEZ (2026-09-18: "arama sonuçlarında çizimler de çıkmasın") — bu bir fotoğraf sayfasıdır.
//
// KÜNYE-ANAHTAR KELİME İKİNCİL SONUCU KALDIRILDI (2026-09-18 üçüncü tur, kullanıcı isteği: "bazen
// filtreye göre alakasız fotoğraflar geliyor"): projenin açıklamasında "banyo" geçmesi o projenin
// TÜM etiketsiz görsellerini banyo yapıyordu (ör. bir ofis projesinin dış cephe kareleri "Tuvalet &
// Banyo" altında) — proje seviyesinde bir sinyal görsel seçemez. Artık yalnızca AI'ın görsel
// başına verdiği etiket sonuç üretir; künye, sınıflandırıcıya BAĞLAM olarak verilir (bkz.
// photoSpaceClassify.js#buildContextNote), sonuç olarak değil.
import { getCachedPool } from './publicCache.js';
import { foldTr } from './textMatch.js';
import photoSpaceTaxonomyJs from '../../photo-space-taxonomy.js';

const { PHOTO_SPACE_LABELS, PHOTO_SPACE_DRAWING_LABELS } = photoSpaceTaxonomyJs;
const DRAWING_SET = new Set(PHOTO_SPACE_DRAWING_LABELS);
const LABEL_SET = new Set(PHOTO_SPACE_LABELS);

function parseJsonSafe(text, fallback) {
  if (!text) return fallback;
  try { const v = JSON.parse(text); return v == null ? fallback : v; } catch { return fallback; }
}
const strList = (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : []);

// D1'deki image_spaces girdisi: ["Mutfak"] (eski) ya da [{label:"Mutfak",confidence:0.9}] (yeni).
export function normalizeStoredSpaces(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const s of raw) {
    const label = typeof s === 'string' ? s : (s && typeof s.label === 'string' ? s.label : '');
    if (!LABEL_SET.has(label) || out.some(o => o.label === label)) continue;
    const c = typeof s === 'object' && s && Number.isFinite(Number(s.confidence)) ? Number(s.confidence) : null;
    out.push({ label, confidence: c });
  }
  return out;
}

async function fetchPhotoPoolRaw(env) {
  // BLURLU (önizleme) PROJELER GÖSTERİLMEZ (kullanıcı isteği, 2026-09-17 madde 10).
  const [{ results: projects }, { results: designerRows }, { results: founderRows }] = await Promise.all([
    env.DB.prepare(
      `SELECT id, slug, title, location, project_date, discipline, category, type, awards,
              images, image_spaces, image_credits, photo_credit_text, designer_names_raw, office_names_raw
       FROM projects
       WHERE deleted_at IS NULL AND hidden_at IS NULL
       ORDER BY created_at DESC, id DESC`
    ).all(),
    // Künye bağları — proje pop-up'ının fetchDesignerDetails'i ile AYNI görünürlük (önizlemedeki
    // profil de adıyla görünür; yalnızca silinmiş ya da tam arşivdeki profil düşer).
    env.DB.prepare(
      `SELECT pd.project_id, ofc.name AS office_name, ar.name AS architect_name
       FROM project_designers pd
       LEFT JOIN offices ofc ON ofc.id = pd.office_id AND ofc.deleted_at IS NULL AND (ofc.hidden_at IS NULL OR ofc.preview_at IS NOT NULL)
       LEFT JOIN architects ar ON ar.id = pd.architect_id AND ar.deleted_at IS NULL AND (ar.hidden_at IS NULL OR ar.preview_at IS NOT NULL)
       ORDER BY pd.rowid ASC`
    ).all(),
    // "Mimar:" satırı için firma KURUCULARI — src/routes/project.js#fetchFoundersForOffices ile
    // AYNI kural (kullanıcı isteği, 2026-09-18: "Künye kısmında mimar bilgisi de olsun"): mimarı
    // girilmemiş, yalnızca firması tanımlı projede pop-up firmanın kurucularını Mimar olarak
    // gösterir; lightbox da aynısını yapmalı ki iki künye ayrışmasın.
    env.DB.prepare(
      `SELECT o.name AS office_name, ar.name AS architect_name FROM office_founders f
       JOIN offices o ON o.id = f.office_id AND o.deleted_at IS NULL AND (o.hidden_at IS NULL OR o.preview_at IS NOT NULL)
       JOIN architects ar ON ar.id = f.architect_id AND ar.deleted_at IS NULL AND (ar.hidden_at IS NULL OR ar.preview_at IS NOT NULL)
       ORDER BY f.rowid ASC`
    ).all(),
  ]);

  const officesByProject = new Map();
  const architectsByProject = new Map();
  for (const r of designerRows || []) {
    if (r.office_name) { if (!officesByProject.has(r.project_id)) officesByProject.set(r.project_id, []); officesByProject.get(r.project_id).push(r.office_name); }
    if (r.architect_name) { if (!architectsByProject.has(r.project_id)) architectsByProject.set(r.project_id, []); architectsByProject.get(r.project_id).push(r.architect_name); }
  }
  const foundersByOffice = new Map();
  for (const r of founderRows || []) {
    const k = foldTr(r.office_name);
    if (!foundersByOffice.has(k)) foundersByOffice.set(k, []);
    foundersByOffice.get(k).push(r.architect_name);
  }
  const uniq = (arr) => { const seen = new Set(); return arr.filter(v => { const k = foldTr(v); if (seen.has(k)) return false; seen.add(k); return true; }); };

  const projectsOut = {};
  const items = [];
  for (const row of projects || []) {
    const images = parseJsonSafe(row.images, []);
    if (!Array.isArray(images) || !images.length) continue;
    const spacesByUrl = parseJsonSafe(row.image_spaces, {});
    const creditsByUrl = parseJsonSafe(row.image_credits, {});
    // Bağ (project_designers) + künyeye yazıldığı hâliyle ham adlar (bkz. migrations/0120).
    const offices = uniq([...(officesByProject.get(row.id) || []), ...strList(parseJsonSafe(row.office_names_raw, []))]);
    let architects = uniq([...(architectsByProject.get(row.id) || []), ...strList(parseJsonSafe(row.designer_names_raw, []))])
      .filter(a => !offices.some(o => foldTr(o) === foldTr(a)));
    // Mimar yoksa firmanın kurucuları (pop-up ile AYNI düşüş).
    if (!architects.length) architects = uniq(offices.flatMap(o => foundersByOffice.get(foldTr(o)) || []));
    projectsOut[row.slug] = {
      title: row.title,
      location: row.location || null,
      date: row.project_date || null,
      discipline: strList(parseJsonSafe(row.discipline, [])),
      category: strList(parseJsonSafe(row.category, [])),
      type: strList(parseJsonSafe(row.type, [])),
      awards: strList(parseJsonSafe(row.awards, [])),
      architects, offices,
      credit: offices[0] || architects[0] || null,
      creditType: offices[0] ? 'office' : (architects[0] ? 'architect' : null),
      photoCredit: (row.photo_credit_text || '').trim() || null,
    };
    for (const url of images) {
      if (!url || typeof url !== 'string') continue;
      const tags = normalizeStoredSpaces(spacesByUrl[url]);
      // Çizim (plan/kesit/cephe) etiketi taşıyan görsel bu sayfada HİÇ görünmez.
      if (tags && tags.some(t => DRAWING_SET.has(t.label))) continue;
      const perImage = typeof creditsByUrl[url] === 'string' ? creditsByUrl[url].trim() : '';
      items.push({ url, projectSlug: row.slug, spaces: tags, photographer: perImage || null });
    }
  }
  return { projects: projectsOut, items };
}

export async function fetchPhotoPool(env) {
  return getCachedPool(env, 'photos', () => fetchPhotoPoolRaw(env));
}
