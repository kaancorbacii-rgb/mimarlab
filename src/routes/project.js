import { errorJson } from '../lib/http.js';
import { parseSubmissionRow } from '../lib/submissionTypes.js';
import { cachedPublicJson } from '../lib/publicCache.js';
// bkz. src/routes/architect.js'teki AYNI CJS-interop yorumu. il-ilce-data.js'e de proje.html'deki
// parseLocationFull ile BİREBİR aynı il/ilçe çözümlemesini kullanmak için (~970 ilçelik veriyi
// burada tekrar tanımlamak yerine) aynı guard'lı module.exports bloğu eklendi.
import projeJs from '../../projeler-data.js';
import ilIlceJs from '../../il-ilce-data.js';

const { projects } = projeJs;
const { parseLocationFull } = ilIlceJs;

// ÖNEMLİ: bkz. src/routes/architect.js'teki AYNI "paylaşılan diziler mutasyona uğratılmaz" yorumu.

async function fetchApprovedRows(env, table, whereExtra, params = []) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM ${table} WHERE status = 'approved' ${whereExtra}`
  ).bind(...params).all();
  return results;
}

function memberRowToProject(row) {
  const p = parseSubmissionRow('projects', row);
  return {
    slug: p.slug, title: p.title, category: p.category, type: p.type, discipline: p.discipline,
    location: p.location, locationDetail: p.locationDetail, date: p.date, dateBucket: p.dateBucket,
    period: p.period, designer: p.designer, images: p.images, brands: p.brands,
    photoCredit: { text: p.photoCreditText || '', url: p.photoCreditUrl || '' },
    description: p.description, submissionId: p.id, createdAt: p.created_at,
  };
}

async function fetchHiddenProjectSlugs(env) {
  const { results } = await env.DB.prepare(
    `SELECT content_key FROM legacy_content_hidden WHERE content_type = 'projects'`
  ).all();
  return new Set(results.map(r => r.content_key));
}

// GET /api/project/:slug — proje-detay.html henüz bu uca bağlanmadı (bu tur yalnızca mimar-detay.html/
// ofis-detay.html/proje.html değiştirildi, bkz. docs/architecture-roadmap.md) ama Faz 1'in "overlay
// worker katmanına taşınsın" hedefiyle tutarlı, çalışır bir uç nokta olarak eklendi — statik
// projeler-data.js kaydı + onaylı claimed_slug düzenlemesi (src/routes/public.js#handlePublicProjectEdits
// ile AYNI alan seti) ya da yalnızca DB'de var olan bir üye projesi.
export async function handleProjectDetailRoute(request, env, url, rawSlug) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  const slug = decodeURIComponent(rawSlug || '');
  if (!slug) return errorJson('Geçersiz istek.');

  return cachedPublicJson(request, env, url.pathname, async () => {
    const base = projects.find(p => p.slug === slug);
    if (base) {
      const editRow = await env.DB.prepare(
        `SELECT * FROM project_submissions WHERE claimed_slug = ? AND status = 'approved' ORDER BY updated_at DESC LIMIT 1`
      ).bind(slug).first();
      let item = base;
      if (editRow) {
        const p = parseSubmissionRow('projects', editRow);
        item = {
          ...base, title: p.title || base.title, category: p.category, type: p.type, discipline: p.discipline,
          location: p.location, locationDetail: p.locationDetail, date: p.date, dateBucket: p.dateBucket,
          period: p.period, designer: (p.designer && p.designer.length) ? p.designer : base.designer,
          photoCredit: { text: p.photoCreditText || '', url: p.photoCreditUrl || '' },
          description: p.description, images: (p.images && p.images.length) ? p.images : base.images, brands: p.brands,
        };
      }
      const hiddenSlugs = await fetchHiddenProjectSlugs(env);
      if (hiddenSlugs.has(slug)) return { item: null, hidden: true };
      return { item, hidden: false };
    }

    const row = await env.DB.prepare(`SELECT * FROM project_submissions WHERE slug = ? AND status = 'approved'`).bind(slug).first();
    if (!row) return { item: null, hidden: false };
    return { item: memberRowToProject(row), hidden: false };
  });
}

// proje.html#OFFICE_NAME_OVERRIDES/OFFICE_KEYWORDS ile BİREBİR aynı liste — "Mimar" (kişi) /
// "Mimarlık Ofisi" (firma) ayrımı iki tarafta da aynı sonucu vermeli, aksi halde sayaçlar
// (designer/designerOffice) istemcinin gerçekte gösterdiği listeyle uyuşmaz.
const OFFICE_NAME_OVERRIDES = new Set(["Autoban","Escapefromsofa","Per Se","Grimshaw","SOM","REX","ACPV Antonio Citterio & Patricia Viel","Salon Alper Derinboğaz",
  "AOMTD","Gensler","KPF","OMA","FXCollaborative","Chapman Taylor","Powerhouse Company","Carve",
  "GEOMIM","Ofist","Ofisvesaire","FREA","MuuM","Neowe","Nēowe","Superpool","PLUG",
  "SdARCH Trivelli & Associati","T-ingénierie","UN Architectural Services","ZAAS","ŞANALarc",
  "GEO_ID","ARK-Itecture","Acararch","Dolmus AG","caps.","the | work","indissoluble","Lazzoni",
]);
const OFFICE_KEYWORDS = ["mimarlık","architecture","architects","architekten","studio","design","partner","group","proje","workshop","associates","concept","ortaklığı","mühendislik","danışmanlık","atölye","işliği","tasarım","grubu"];
function isOfficeName(name) {
  if (OFFICE_NAME_OVERRIDES.has(name)) return true;
  return OFFICE_KEYWORDS.some(k => name.toLowerCase().includes(k));
}

// proje.html#FILTER_GROUPS ile BİREBİR aynı alan çıkarımı — yalnızca `field` fonksiyonları burada
// (parseLocation/isOfficeName/ratingBuckets sunucu tarafı karşılıklarıyla) yeniden ifade edilir.
function buildFilterGroups(ratingByProject) {
  return [
    { key: 'discipline', label: 'Tür', nested: false, field: p => p.discipline || [] },
    { key: 'category', label: 'Tip', nested: false, field: p => p.category || [] },
    { key: 'type', label: 'Tip Grubu', nested: false, field: p => p.type || [] },
    { key: 'location', label: 'Yer', nested: false, field: p => [parseLocationFull(p.location).city] },
    { key: 'district', label: 'İlçe', nested: true, parentKey: 'location', parentValue: 'İstanbul', field: p => {
        const info = parseLocationFull(p.location);
        return (info.district && info.city === 'İstanbul') ? [info.district] : [];
      } },
    { key: 'dateBucket', label: 'Yıl', nested: false, field: p => [p.dateBucket] },
    { key: 'designer', label: 'Mimar', nested: false, field: p => (p.designer || []).filter(d => !isOfficeName(d)) },
    { key: 'designerOffice', label: 'Mimarlık Firması', nested: false, field: p => (p.designer || []).filter(d => isOfficeName(d)) },
    { key: 'rating', label: 'Puan', nested: false, field: p => ratingBuckets((ratingByProject.get(p.slug) || { average: 0 }).average) },
  ];
}

function ratingBuckets(average) {
  if (!average) return [];
  const buckets = [];
  for (let n = Math.floor(average); n >= 1; n--) buckets.push(`${n}+ Yıldız`);
  return buckets;
}

function trLower(s) {
  return (s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/Ş/g, 'ş').replace(/Ğ/g, 'ğ').replace(/Ü/g, 'ü').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç').toLowerCase();
}

function dateBucketSortKey(s) {
  let m = /^(\d+)\.\s*Yüzyıl$/.exec(s);
  if (m) return (parseInt(m[1], 10) - 1) * 100;
  m = /^(\d{4})'l/.exec(s);
  if (m) return parseInt(m[1], 10);
  m = /^(\d{4})-\d{2}$/.exec(s);
  if (m) return parseInt(m[1], 10);
  return 0;
}

// GET /api/projects/filters — proje.html#computeOptions'ın (bkz. o dosyadaki passesFilters/
// computeOptions) TAM karşılığı: her filtre grubunun sayacı, O GRUP HARİÇ diğer TÜM aktif
// filtrelerle eşleşen projeler üzerinden hesaplanır (faceted/bağımlı sayaç — "İstanbul" seçiliyken
// "Konut" sayacı yalnızca İstanbul'daki konut projelerini sayar). İstemci mevcut activeFilters
// durumunu tekrarlanan query param'larla gönderir (ör. ?discipline=Mimari&location=İstanbul).
export async function handleProjectFiltersRoute(request, env, url) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);

  // cachedPublicJson (bkz. src/lib/publicCache.js), pathname'i sabit CACHEABLE_PATHS listesinde
  // olmayan uçlar için otomatik olarak kısa ömürlü ANON_CACHE_HEADERS (ya da admin isteğiyse
  // no-store) döner — /api/projects/filters'ın anlamı tamamen query string'e (aktif filtreler)
  // bağlı olduğundan bilerek o listeye EKLENMEDİ, bu yüzden ek bir sarmalayıcıya gerek yok.
  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    const [memberRows, projectOverlayRows, hiddenSlugs, ratingRows] = await Promise.all([
      fetchApprovedRows(env, 'project_submissions', 'AND claimed_slug IS NULL'),
      fetchApprovedRows(env, 'project_submissions', 'AND claimed_slug IS NOT NULL'),
      fetchHiddenProjectSlugs(env),
      env.DB.prepare(`SELECT target_id, AVG(stars) AS average FROM ratings WHERE target_type = 'project' GROUP BY target_id`).all(),
    ]);

    const ratingByProject = new Map(ratingRows.results.map(r => [r.target_id, { average: r.average }]));
    const overlayBySlug = new Map(projectOverlayRows.map(r => [r.claimed_slug, parseSubmissionRow('projects', r)]));

    const pool = projects
      .filter(p => !hiddenSlugs.has(p.slug))
      .map(p => {
        const o = overlayBySlug.get(p.slug);
        return o ? { ...p, category: o.category, type: o.type, discipline: o.discipline, location: o.location, dateBucket: o.dateBucket, designer: o.designer } : p;
      })
      .concat(memberRows.map(memberRowToProject).filter(p => !hiddenSlugs.has(p.slug)));

    const FILTER_GROUPS = buildFilterGroups(ratingByProject);
    const activeFilters = {};
    FILTER_GROUPS.forEach(g => { activeFilters[g.key] = new Set(url.searchParams.getAll(g.key)); });
    const searchQuery = trLower((url.searchParams.get('search') || '').trim());

    function matchesLocalSearch(p) {
      if (!searchQuery) return true;
      const fields = [p.title, p.location, p.locationDetail, ...(p.designer || [])];
      return fields.some(v => v && trLower(String(v)).includes(searchQuery));
    }
    function passesFilters(p, exceptKey) {
      if (!matchesLocalSearch(p)) return false;
      return FILTER_GROUPS.every(g => {
        if (g.key === exceptKey) return true;
        const sel = activeFilters[g.key];
        if (sel.size === 0) return true;
        const vals = g.field(p);
        return vals.some(v => sel.has(v));
      });
    }

    const out = {};
    for (const g of FILTER_GROUPS) {
      const passing = pool.filter(p => passesFilters(p, g.key));
      const counts = {};
      passing.forEach(p => { g.field(p).forEach(v => { if (v) counts[v] = (counts[v] || 0) + 1; }); });
      const options = Object.keys(counts).sort((a, b) => {
        if (g.key === 'dateBucket') return dateBucketSortKey(b) - dateBucketSortKey(a);
        return counts[b] - counts[a] || a.localeCompare(b);
      });
      out[g.key] = { counts, options };
    }
    return { filters: out, total: pool.filter(p => passesFilters(p, null)).length };
  });
}
