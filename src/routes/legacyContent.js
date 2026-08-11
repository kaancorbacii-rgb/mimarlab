import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { SUBMISSION_TYPES, parseSubmissionRow } from '../lib/submissionTypes.js';
import { cachedPublicJson, invalidatePublicCache } from '../lib/publicCache.js';
import { purgeSsrDetailCache, ssrPurgeTargetFor } from '../lib/ssrCache.js';
import { slugify } from '../lib/slugify.js';
import { cascadeDeleteArchitect, cascadeDeleteOffice, cascadeDeleteProject, cascadeDeleteProduct } from '../lib/cascadeDelete.js';
import {
  findCanonicalRowByNaturalKey, syncApprovedSubmissionToCanonical, CANONICAL_TABLE_BY_TYPE, canonicalKeyFor,
  hardDeleteCanonicalRow, blacklistLegacyKey, collectR2MediaKeys, deleteR2MediaKeys, MEDIA_IMAGE_FIELDS_BY_TYPE,
} from '../lib/canonicalSync.js';
import { parseCanonicalRow } from '../lib/canonicalRead.js';
import { bumpFacetCounts } from '../lib/facetCounts.js';

const FACET_TYPES = new Set(['projects', 'products', 'materials']);

// Faz 3 — architects/offices/projects/products/materials artık canonical tablolardan (bkz.
// migrations/0022_id_first_entities.sql) okunuyor/gizleniyor/siliniyor; legacy_content_hidden bu 5
// tip için ARTIK KULLANILMIYOR (bkz. migrations/0025_drop_legacy_content_hidden.sql'deki gerekçe —
// tablo yalnızca 'news' için, o tipin kendi ID-first karşılığı henüz olmadığından, canlı kalıyor).
// "Gizle" (hidden_at, geri alınabilir) ile "Sil" (deleted_at, kalıcı + cascade) artık canonical
// satırın KENDİSİNDE tutulur — ayrı bir moderasyon tablosuna gerek kalmadı.

async function runContentCascadeDelete(env, user, type, { id, row, key }) {
  const name = row ? row.name : key;
  if (type === 'architects') return cascadeDeleteArchitect(env, name);
  if (type === 'offices') return cascadeDeleteOffice(env, user, name);
  if (type === 'products' || type === 'materials') {
    const engagementType = type === 'products' ? 'product' : 'material';
    if (id && row) return cascadeDeleteProduct(env, engagementType, `m-${id}`);
    const [brand, title] = (key || '').split('|||');
    return cascadeDeleteProduct(env, engagementType, slugify(`${title || ''}-${brand || ''}`));
  }
}

const CANONICAL_NAME_COL = { architects: 'name', offices: 'name', projects: 'title', products: 'title', materials: 'title' };
const CANONICAL_KEY_COL = { architects: 'name', offices: 'name', projects: 'slug' }; // products: legacy_key ("marka|||başlık")

function shapeCanonicalCard(type, row) {
  if (type === 'projects') {
    const p = parseCanonicalRow('projects', row);
    return { title: p.title, subtitle: [p.location, p.project_date].filter(Boolean).join(' · '), image: (p.images && p.images[0]) || null };
  }
  if (type === 'architects') {
    return { title: row.name, subtitle: [row.school].filter(Boolean).join(' · '), image: row.photo_url || null };
  }
  if (type === 'offices') {
    const cats = (() => { try { return row.cats ? JSON.parse(row.cats) : null; } catch { return null; } })();
    return { title: row.name, subtitle: [row.loc, cats].filter(Boolean).join(' · '), image: row.logo_url || null };
  }
  // products/materials
  const p = parseCanonicalRow('products', row);
  return { title: p.title, subtitle: [p.brand_name_raw, p.category].filter(Boolean).join(' · '), image: (p.images && p.images[0]) || null };
}

function trLower(s) {
  return (s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/Ş/g, 'ş').replace(/Ğ/g, 'ğ').replace(/Ü/g, 'ü').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç').toLowerCase();
}

// trLower zaten BÜYÜK->küçük Türkçe eşlemesini doğru yapıyor (İ/I/Ş/Ğ/Ü/Ö/Ç) — foldTr onun üstüne
// Türkçe harflerin ASCII benzerlerine de indirger (i/ı, s/ş, c/ç, g/ğ, u/ü, o/ö) ki kullanıcı Türkçe
// karakter olmadan yazsa da ("sirket") ya da tam tersi eşleşsin (bkz. kullanıcı isteği: "Türkçe
// karakter toleransı"). Sorgu VE hedef metin AYNI foldTr'den geçirilerek tutarlı karşılaştırılır.
function foldTr(s) {
  return trLower(s).replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o');
}

// Sorgu kelimelere bölünür, hedef metin HER kelimeyi (bitişik olmasına gerek kalmadan, herhangi bir
// sırada) içeriyorsa eşleşme sayılır (bkz. kullanıcı isteği: "kelime parçalamalı esnek arama") — ör.
// "sefik mimarlik" sorgusu aralarında başka kelime geçse de "Şefik Birkiye Mimarlık" başlığıyla eşleşir.
function fuzzyMatch(text, queryWords) {
  if (!queryWords.length) return false;
  const folded = foldTr(text || '');
  return queryWords.every(w => folded.includes(w));
}

// /api/admin/legacy?type=<tip>&q=<arama>  (GET: kayıtlarda başlık/isim araması)
// /api/admin/legacy/hidden  (PATCH: {type, key, hidden} — gizle/tekrar göster)
// requireAdmin kontrolü çağıran (src/routes/admin.js#handleAdminRoute) tarafından zaten yapıldı.
export async function handleLegacyAdmin(request, env, url, segments, user) {
  if (segments.length === 3 && request.method === 'GET') return searchLegacy(env, url);
  if (segments.length === 4 && segments[3] === 'hidden' && request.method === 'PATCH') return toggleLegacyHidden(request, env, user);
  if (segments.length === 4 && segments[3] === 'project-action' && request.method === 'POST') return handleProjectAction(request, env, user);
  if (segments.length === 4 && segments[3] === 'content-action' && request.method === 'POST') return handleContentAction(request, env, user);
  return errorJson('Bulunamadı', 404);
}

async function searchLegacy(env, url) {
  const type = url.searchParams.get('type');
  const q = (url.searchParams.get('q') || '').trim();
  if (!['projects', 'architects', 'offices', 'products', 'materials'].includes(type)) return errorJson('Geçersiz tip.');
  if (q.length < 2) return json({ items: [] });

  const table = CANONICAL_TABLE_BY_TYPE[type];
  const nameCol = CANONICAL_NAME_COL[type];
  const kindClause = (type === 'products' || type === 'materials') ? `AND kind = '${type === 'products' ? 'product' : 'material'}'` : '';
  const { results } = await env.DB.prepare(
    `SELECT * FROM ${table} WHERE deleted_at IS NULL ${kindClause} AND ${nameCol} LIKE ? ORDER BY ${nameCol} LIMIT 50`
  ).bind(`%${q}%`).all();

  return json({
    items: results.map(row => ({ key: canonicalKeyFor(type, row), hidden: !!row.hidden_at, ...shapeCanonicalCard(type, row) })),
  });
}

// canonical satırın hidden_at kolonunu set/temizler.
export async function setLegacyHidden(env, user, type, key, hidden) {
  const row = await findCanonicalRowByNaturalKey(env, type, key);
  if (!row) return; // henüz canonical karşılığı yoksa sessizce atla (ör. bozuk/eski bir anahtar)
  const table = CANONICAL_TABLE_BY_TYPE[type];
  await env.DB.prepare(`UPDATE ${table} SET hidden_at = ? WHERE id = ?`).bind(hidden ? new Date().toISOString() : null, row.id).run();
  if (FACET_TYPES.has(type)) await bumpFacetCounts(env, type);
}

async function toggleLegacyHidden(request, env, user) {
  const body = await readJson(request);
  if (!['projects', 'architects', 'offices', 'products', 'materials'].includes(body.type)) return errorJson('Geçersiz tip.');
  const key = (body.key || '').trim();
  if (!key) return errorJson('Geçersiz kayıt.');
  await setLegacyHidden(env, user, body.type, key, !!body.hidden);
  await invalidatePublicCache();
  return json({ ok: true });
}

// GET /api/public/hidden — proje.html/mimar.html/firma.html/urun.html gibi statik sayfaların
// hardcoded data.js dizilerini (projeler-data.js vb.) filtrelemek için kullandığı TEK D1 sinyali
// (bkz. proje.html/proje-detay.html/mimar.html/firma.html/urun.html — hepsi bu uçtan dönen
// slug/name/"marka|||başlık" setini statik diziden çıkarmak için kullanır). Bu yüzden her tip için
// İKİ ayrı "artık gösterme" kaynağını BİRLEŞTİRİR:
//   1) canonical satırın kendisi hâlâ duruyor ama hidden_at (Gizle/Arşivle, geri alınabilir) veya
//      (bu koddan ÖNCE silinmiş, eski) deleted_at set edilmiş,
//   2) canonical satır artık YOK (hardDeleteCanonicalRow ile hard-delete edildi) — bu durumda
//      TEK kalıntı iz legacy_content_hidden'daki blacklist damgasıdır (bkz.
//      src/lib/canonicalSync.js#blacklistLegacyKey/hardDeleteCanonicalRow).
// Önceki hata: bu sorgu yalnızca "hidden_at IS NOT NULL AND deleted_at IS NULL" arıyordu — bir
// kayıt SİLİNDİĞİNDE (deleted_at set edildiğinde, hidden_at hiç dokunulmadığından NULL kalır) bu
// koşulla EŞLEŞMİYOR, yani silinen statik kayıt hiçbir zaman bu listeye girmiyor, dolayısıyla
// data.js'teki karşılığı sitede sonsuza kadar görünmeye devam ediyordu (gerçek bulgu: "Galata
// Apartmanı" silinip "Silindi" mesajı alınmasına rağmen /proje'de kalmaya devam etmesi).
// Faz 4A — Projection Optimization: canonicalKeyFor() yalnızca aşağıdaki kolonları okur (name/slug/
// legacy_key+brand_name_raw+title) — SELECT * ile satırın tamamını (about/awards/description/specs
// gibi bu uçta hiç kullanılmayan ağır metin kolonları dahil) çekmenin okuma tarafında hiçbir faydası
// yoktu; WHERE'deki hidden_at/deleted_at zaten migrations/0028'deki partial indeksle karşılanıyor.
const HIDDEN_MAP_PROJECTION = { architects: 'name', offices: 'name', projects: 'slug', products: 'legacy_key, brand_name_raw, title', materials: 'legacy_key, brand_name_raw, title' };

async function fetchHiddenMap(env) {
  const out = { projects: [], architects: [], offices: [], products: [], materials: [] };
  for (const type of ['projects', 'architects', 'offices', 'products', 'materials']) {
    const table = CANONICAL_TABLE_BY_TYPE[type];
    const kindClause = (type === 'products' || type === 'materials') ? `AND kind = '${type === 'products' ? 'product' : 'material'}'` : '';
    const { results } = await env.DB.prepare(`SELECT ${HIDDEN_MAP_PROJECTION[type]} FROM ${table} WHERE (hidden_at IS NOT NULL OR deleted_at IS NOT NULL) ${kindClause}`).all();
    const keys = new Set(results.map(row => canonicalKeyFor(type, row)).filter(Boolean));
    const { results: blacklisted } = await env.DB.prepare(`SELECT content_key FROM legacy_content_hidden WHERE content_type = ?`).bind(type).all();
    for (const row of blacklisted) keys.add(row.content_key);
    out[type] = [...keys];
  }
  return out;
}

export async function handlePublicHidden(request, env) {
  return cachedPublicJson(request, env, '/api/public/hidden', () => fetchHiddenMap(env));
}

// GET /api/public/search-suggest?q=<metin> — auth gerektirmez. Üst navigasyondaki arama kutusunun
// canlı öneri açılır penceresini besler — artık canonical tablolardan (statik + üye içeriğinin
// TAMAMINI kapsayan tek kaynak) arar, statik dizi taramasına gerek kalmadı.
const SEARCH_SUGGEST_PER_GROUP = 3;
const SEARCH_SUGGEST_TOTAL = 8;

export async function handlePublicSearchSuggest(request, env, url) {
  const rawQ = (url.searchParams.get('q') || '').trim();
  if (!rawQ) return json({ items: [], total: 0 });
  const queryWords = foldTr(rawQ).split(/\s+/).filter(Boolean);

  return cachedPublicJson(request, env, url.pathname, async () => {
    // SQL LIKE Türkçe diakritik foldlamasını (i/ı, s/ş, c/ç, g/ğ, u/ü, o/ö) bilmediğinden ve
    // kelime-parçalamalı eşleşme (bkz. fuzzyMatch) tek bir LIKE deseniyle ifade edilemediğinden,
    // her tablo TAMAMEN çekilip fuzzyMatch ile JS tarafında filtrelenir — tablolar küçük olduğundan
    // (mimar/ofis/proje ~600-800, ürün ~80 satır, bkz. src/routes/architect.js#handleArchitectSearchRoute
    // ile AYNI "tablo küçük, tam tarama ucuz" gerekçesi) bu tam tarama ucuzdur.
    const [archRes, officeRes, projRes, prodRes] = await Promise.all([
      env.DB.prepare(`SELECT name, office_id FROM architects WHERE deleted_at IS NULL AND hidden_at IS NULL`).all(),
      env.DB.prepare(`SELECT name, loc FROM offices WHERE deleted_at IS NULL AND hidden_at IS NULL`).all(),
      env.DB.prepare(`SELECT slug, title, location, project_date FROM projects WHERE deleted_at IS NULL AND hidden_at IS NULL`).all(),
      env.DB.prepare(`SELECT slug, title, category, brand_name_raw FROM products WHERE deleted_at IS NULL AND hidden_at IS NULL`).all(),
    ]);

    const archMatches = archRes.results.filter(a => fuzzyMatch(a.name, queryWords)).slice(0, 20);
    const officeMatches = officeRes.results.filter(o => fuzzyMatch(o.name, queryWords)).slice(0, 20);
    const projMatches = projRes.results.filter(p => fuzzyMatch(p.title, queryWords) || fuzzyMatch(p.location, queryWords)).slice(0, 20);
    const prodMatches = prodRes.results.filter(p => fuzzyMatch(p.title, queryWords) || fuzzyMatch(p.category, queryWords) || fuzzyMatch(p.brand_name_raw, queryWords)).slice(0, 20);

    const officeNameById = new Map();
    const officeIds = archMatches.map(r => r.office_id).filter(Boolean);
    if (officeIds.length) {
      const { results } = await env.DB.prepare(`SELECT id, name FROM offices WHERE id IN (${officeIds.map(() => '?').join(', ')})`).bind(...officeIds).all();
      results.forEach(o => officeNameById.set(o.id, o.name));
    }

    const groups = [
      { label: 'Mimar', items: archMatches.map(a => ({ title: a.name, meta: officeNameById.get(a.office_id) || 'Mimar', href: `/mimar/${encodeURIComponent(slugify(a.name))}` })) },
      { label: 'Firma', items: officeMatches.map(o => ({ title: o.name, meta: o.loc || '', href: `/firma/${encodeURIComponent(slugify(o.name))}` })) },
      { label: 'Proje', items: projMatches.map(p => ({ title: p.title, meta: [p.location, p.project_date].filter(Boolean).join(' · '), href: `/proje/${encodeURIComponent(p.slug)}` })) },
      { label: 'Ürün', items: prodMatches.map(p => ({ title: p.title, meta: [p.category, p.brand_name_raw].filter(Boolean).join(' · '), href: `/urun/${encodeURIComponent(p.slug)}` })) },
    ];

    const items = [];
    for (const g of groups) {
      for (const it of g.items.slice(0, SEARCH_SUGGEST_PER_GROUP)) items.push({ ...it, label: g.label });
    }
    const total = groups.reduce((sum, g) => sum + g.items.length, 0);
    return { items: items.slice(0, SEARCH_SUGGEST_TOTAL), total };
  });
}

// GET /api/public/search?q=<metin> — arama.html'in tam sonuç sayfası için, handlePublicSearchSuggest
// (üst nav'ın küçük açılır penceresi, 3/grup + 8 toplam sınırı) ile AYNI D1 sorgu/fuzzyMatch
// altyapısını paylaşır ama grup başına daha yüksek bir sınırla (bkz. SEARCH_FULL_PER_GROUP) ham
// alanları (fotoğraf/logo/görsel dahil) döner — arama.html kendi avatar/kart render mantığını
// (officeColor/initials/logoUrl, bkz. badge-shared.js) bu alanlar üzerinde çalıştırır. Legacy Bundle
// Elimination Faz 3 kapsamı yalnızca data.js/projeler-data.js olduğundan (bkz. kullanıcı isteği)
// yalnızca mimar/firma/proje kapsanır — ürün/haber arama.html'de İSTEĞE BAĞLI olarak statik
// urunler-data.js/malzemeler-data.js/haberler-data.js üzerinde İSTEMCİ tarafında aranmaya devam
// eder (bu turun kapsamı dışında).
const SEARCH_FULL_PER_GROUP = 20;

const PROJECT_DESIGNER_JOIN_SQL = `
  LEFT JOIN project_designers pd ON pd.project_id = p.id
  LEFT JOIN architects ar ON ar.id = pd.architect_id AND ar.deleted_at IS NULL
  LEFT JOIN offices ofc ON ofc.id = pd.office_id AND ofc.deleted_at IS NULL
`;
const DESIGNER_SEP = '';

export async function handlePublicSearchFull(request, env, url) {
  const rawQ = (url.searchParams.get('q') || '').trim();
  if (!rawQ) return json({ architects: [], offices: [], projects: [], totals: { architects: 0, offices: 0, projects: 0 } });
  const queryWords = foldTr(rawQ).split(/\s+/).filter(Boolean);

  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    const [archRes, officeRes, projRes] = await Promise.all([
      env.DB.prepare(
        `SELECT a.name, a.slug, a.photo_url, o.name AS office_name FROM architects a
         LEFT JOIN offices o ON o.id = a.office_id AND o.deleted_at IS NULL
         WHERE a.deleted_at IS NULL AND a.hidden_at IS NULL`
      ).all(),
      env.DB.prepare(`SELECT name, slug, loc, logo_url FROM offices WHERE deleted_at IS NULL AND hidden_at IS NULL`).all(),
      env.DB.prepare(
        `SELECT p.slug, p.title, p.location, p.project_date, p.images,
                GROUP_CONCAT(COALESCE(ar.name, ofc.name), '${DESIGNER_SEP}') AS designer_names
         FROM projects p ${PROJECT_DESIGNER_JOIN_SQL}
         WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL GROUP BY p.id`
      ).all(),
    ]);

    const archMatches = archRes.results.filter(a => fuzzyMatch(a.name, queryWords) || fuzzyMatch(a.office_name, queryWords));
    const officeMatches = officeRes.results.filter(o => fuzzyMatch(o.name, queryWords) || fuzzyMatch(o.loc, queryWords));
    const projMatches = projRes.results.filter(p => {
      if (fuzzyMatch(p.title, queryWords) || fuzzyMatch(p.location, queryWords)) return true;
      const designers = p.designer_names ? p.designer_names.split(DESIGNER_SEP) : [];
      return designers.some(d => fuzzyMatch(d, queryWords));
    });

    return {
      architects: archMatches.slice(0, SEARCH_FULL_PER_GROUP).map(a => ({ name: a.name, slug: a.slug, photo: a.photo_url, office: a.office_name || null })),
      offices: officeMatches.slice(0, SEARCH_FULL_PER_GROUP).map(o => ({ name: o.name, slug: o.slug, loc: o.loc, logo: o.logo_url })),
      projects: projMatches.slice(0, SEARCH_FULL_PER_GROUP).map(p => {
        let images = [];
        try { images = p.images ? JSON.parse(p.images) : []; } catch { images = []; }
        return { slug: p.slug, title: p.title, location: p.location, date: p.project_date, image: images[0] || null };
      }),
      totals: { architects: archMatches.length, offices: officeMatches.length, projects: projMatches.length },
    };
  });
}

// Bir projenin "şu an canlıda görünen" hâli, canonical satırdan doğrudan okunur (artık statik +
// overlay birleştirmesi gerekmiyor — bkz. src/routes/project.js'teki AYNI okuma). Arşivleme, projeyi
// bu haliyle bir project_submissions taslağına kopyalar ki admin panelde düzenlerken en son
// görünen içerikten devam etsin.
const PROJECT_FIELD_KEYS = ['title', 'category', 'type', 'discipline', 'location', 'locationDetail', 'date', 'dateBucket', 'period', 'designer', 'photoCreditText', 'photoCreditUrl', 'description', 'images', 'brands', 'build_status'];

async function currentCanonicalProjectFields(env, slug) {
  const row = await env.DB.prepare(`SELECT * FROM projects WHERE (slug = ? OR legacy_key = ?) AND deleted_at IS NULL`).bind(slug, slug).first();
  if (!row) return null;
  const p = parseCanonicalRow('projects', row);
  const { results: designerRows } = await env.DB.prepare(
    `SELECT COALESCE(ar.name, ofc.name) AS name FROM project_designers pd
     LEFT JOIN architects ar ON ar.id = pd.architect_id AND ar.deleted_at IS NULL
     LEFT JOIN offices ofc ON ofc.id = pd.office_id AND ofc.deleted_at IS NULL
     WHERE pd.project_id = ?`
  ).bind(row.id).all();
  return {
    title: p.title, category: p.category, type: p.type, discipline: p.discipline,
    location: p.location, locationDetail: p.location_detail,
    date: p.project_date, dateBucket: p.date_bucket, period: p.period,
    designer: designerRows.map(d => d.name).filter(Boolean),
    photoCreditText: p.photo_credit_text || null, photoCreditUrl: p.photo_credit_url || null,
    description: p.description, images: p.images, brands: [], // bkz. src/routes/project.js#shapeProjectItem'daki AYNI kapsam notu
    build_status: p.build_status === 'concept' ? 'concept' : 'built',
  };
}

function bindProjectFields(fields) {
  return PROJECT_FIELD_KEYS.map(f =>
    SUBMISSION_TYPES.projects.arrayFields.includes(f) ? JSON.stringify(fields[f] || []) : fields[f]
  );
}

// POST /api/admin/legacy/project-action  body: {action:'delete'|'archive'|'publish', id?, slug?}
// requireAdmin kontrolü çağıran (handleAdminRoute) tarafından zaten yapıldı — gövde parse edilip
// runProjectAction'a (aşağıda, gerçek işlem mantığı) devredilir.
async function handleProjectAction(request, env, user) {
  const body = await readJson(request);
  return runProjectAction(env, user, body);
}

// runProjectAction: handleProjectAction'ın (admin, yukarıda) VE handleSelfProjectDelete'in (proje
// sahibi kendi popup'ından "Sil"e bastığında, bkz. kullanıcı isteği "Kullanıcı Gönderi Düzenleme &
// Silme İzinleri") paylaştığı gerçek işlem mantığı — iki çağıran da (request gövdesi parse edilmiş
// biçimde) BURAYA gelmeden önce KENDİ yetki kontrolünü (admin rolü / proje sahipliği) yapmış olmalı,
// bu fonksiyon kendi başına hiçbir yetki kontrolü YAPMAZ.
export async function runProjectAction(env, user, { action, id, slug } = {}) {
  id = (id || '').trim();
  slug = (slug || '').trim();
  if (!['delete', 'archive', 'publish'].includes(action)) return errorJson('Geçersiz işlem.');
  if (!id && !slug) return errorJson('Geçersiz istek.');

  if (id) {
    const row = await env.DB.prepare(`SELECT * FROM project_submissions WHERE id = ?`).bind(id).first();
    if (!row) return errorJson('Bulunamadı.', 404);
    const now = Date.now();
    const targetSlug = row.claimed_slug || row.slug;
    if (action === 'delete') {
      await deleteR2MediaKeys(env, collectR2MediaKeys(row, MEDIA_IMAGE_FIELDS_BY_TYPE.projects));
      await env.DB.prepare(`DELETE FROM project_submissions WHERE id = ?`).bind(id).run();
      await cascadeDeleteProject(env, targetSlug);
      // Bu içeriği CANLIDAN kaldırmak — hem bağımsız üye projesi hem (arşivlenmiş) claimed_slug'lı
      // bir taslak için de canonical satırı KALICI olarak (hard delete) siler + statik data.js
      // karşılığının bir daha görünmemesi için blacklist'e damgalar.
      const canonRow = await findCanonicalRowByNaturalKey(env, 'projects', targetSlug);
      if (canonRow) await hardDeleteCanonicalRow(env, 'projects', canonRow, user.id);
      else await blacklistLegacyKey(env, user.id, 'projects', targetSlug);
      await bumpFacetCounts(env, 'projects');
    } else if (action === 'archive') {
      await env.DB.prepare(`UPDATE project_submissions SET status = 'archived', updated_at = ? WHERE id = ?`).bind(now, id).run();
      if (row.claimed_slug) await setLegacyHidden(env, user, 'projects', row.claimed_slug, true);
      else await bumpFacetCounts(env, 'projects');
    } else {
      await env.DB.prepare(`UPDATE project_submissions SET status = 'approved', updated_at = ? WHERE id = ?`).bind(now, id).run();
      await syncApprovedSubmissionToCanonical(env, 'projects', parseSubmissionRow('projects', { ...row, status: 'approved' }));
      if (row.claimed_slug) await setLegacyHidden(env, user, 'projects', row.claimed_slug, false);
      else await bumpFacetCounts(env, 'projects');
    }
    await invalidatePublicCache();
    await purgeSsrDetailCache('project', targetSlug);
    return json({ ok: true });
  }

  // slug ile: statik/canonical bir proje, henüz kendine ait bir project_submissions satırı olmayabilir.
  if (action === 'publish') return errorJson('Geçersiz istek.');

  if (action === 'delete') {
    const canonRow = await findCanonicalRowByNaturalKey(env, 'projects', slug);
    if (canonRow) await hardDeleteCanonicalRow(env, 'projects', canonRow, user.id);
    // canonical satır hiç yoksa (ör. statik migration hiç çalıştırılmadıysa) bile blacklist'e
    // damgalamak GEREKİR — aksi halde data.js'teki karşılığı asla gizlenmeyecek bir "hayalet" olur.
    else await blacklistLegacyKey(env, user.id, 'projects', slug);
    const { results: draftRows } = await env.DB.prepare(`SELECT * FROM project_submissions WHERE claimed_slug = ?`).bind(slug).all();
    for (const draft of draftRows) await deleteR2MediaKeys(env, collectR2MediaKeys(draft, MEDIA_IMAGE_FIELDS_BY_TYPE.projects));
    await env.DB.prepare(`DELETE FROM project_submissions WHERE claimed_slug = ?`).bind(slug).run();
    await cascadeDeleteProject(env, slug);
    await bumpFacetCounts(env, 'projects');
    await invalidatePublicCache();
    await purgeSsrDetailCache('project', slug);
    return json({ ok: true });
  }

  const fields = await currentCanonicalProjectFields(env, slug);
  if (!fields) return errorJson('Böyle bir proje bulunamadı.', 404);
  const now = Date.now();
  const existing = await env.DB.prepare(
    `SELECT id FROM project_submissions WHERE claimed_slug = ? ORDER BY created_at DESC LIMIT 1`
  ).bind(slug).first();
  if (existing) {
    await env.DB.prepare(
      `UPDATE project_submissions SET ${PROJECT_FIELD_KEYS.map(f => `${f} = ?`).join(', ')}, status = 'archived', owner_user_id = ?, updated_at = ? WHERE id = ?`
    ).bind(...bindProjectFields(fields), user.id, now, existing.id).run();
  } else {
    const columns = ['id', 'owner_user_id', 'status', 'created_at', 'updated_at', 'slug', 'claimed_slug', ...PROJECT_FIELD_KEYS];
    const placeholders = columns.map(() => '?').join(', ');
    await env.DB.prepare(
      `INSERT INTO project_submissions (${columns.join(', ')}) VALUES (${placeholders})`
    ).bind(newId(), user.id, 'archived', now, now, slug, slug, ...bindProjectFields(fields)).run();
  }
  await setLegacyHidden(env, user, 'projects', slug, true);
  await invalidatePublicCache();
  await purgeSsrDetailCache('project', slug);
  return json({ ok: true });
}

// DELETE /api/project/:slug — proje sahibinin (admin-panel DIŞINDA, doğrudan proje pop-up'ından)
// kendi projesini silmesi (bkz. kullanıcı isteği: "Kullanıcı Gönderi Düzenleme & Silme İzinleri").
// Admin'in /api/admin/legacy/project-action'ından farkı: burası admin ÖN-YETKİ KONTROLÜNDEN
// (handleAdminRoute) GEÇMİYOR, dolayısıyla admin olmayan bir çağıran için sahiplik BURADA açıkça
// doğrulanır — proje-comments.js#canModerate ile AYNI kaynağı (project_submissions.owner_user_id,
// slug YA DA claimed_slug ile eşleşen) kullanır; bu, proje.html'in "Sil" butonunu göstermeden ÖNCE
// istemci tarafında yaptığı AYNI kontrolün sunucu tarafı garantisidir — istemci kontrolü tek başına
// güvenlik sağlamaz. Admin isteği ownership kontrolüne takılmadan geçer (mevcut admin uçlarıyla aynı
// davranış). İşlem her zaman slug tabanlı silme yolunu (runProjectAction action:'delete', id YOK)
// kullanır — sıradan bir kullanıcının kendi project_submissions.id'sini bilmesi gerekmez.
export async function handleSelfProjectDelete(request, env, slug) {
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);
  if (user.role !== 'admin') {
    const owns = await env.DB.prepare(
      `SELECT 1 FROM project_submissions WHERE owner_user_id = ? AND (slug = ? OR claimed_slug = ?) LIMIT 1`
    ).bind(user.id, slug, slug).first();
    if (!owns) return errorJson('Bu projeyi silme yetkin yok.', 403);
  }
  return runProjectAction(env, user, { action: 'delete', slug });
}

// architects/offices için "arşivle" — canonical satırın GÜNCEL hâlini bir *_submissions taslağına
// kopyalar (admin'in mevcut düzenleme formlarıyla düzenleyebilmesi için), sonra canonical satırı
// hidden_at ile canlıdan çeker. "Yayınla" taslağı onaylar (canonical'a senkronlar) ve hidden_at'i temizler.
const CONTENT_ACTION_TYPES = {
  architects: {
    table: 'architect_submissions',
    claimedColumn: 'claimed_profile_key',
    copyFields: ['name', 'dob', 'school', 'dept', 'office', 'position', 'profession', 'awards', 'photo_url', 'about'],
    async canonicalFields(env, key) {
      const row = await findCanonicalRowByNaturalKey(env, 'architects', key);
      if (!row) return null;
      const a = parseCanonicalRow('architects', row);
      const office = a.office_id ? await env.DB.prepare(`SELECT name FROM offices WHERE id = ?`).bind(a.office_id).first() : null;
      return {
        name: a.name, dob: a.dob, school: a.school, dept: a.dept, office: office ? office.name : null,
        position: a.position, profession: a.profession, awards: a.awards, photo_url: a.photo_url, about: a.about,
      };
    },
  },
  offices: {
    table: 'office_submissions',
    claimedColumn: 'claimed_profile_key',
    copyFields: ['name', 'loc', 'cats', 'yil', 'website', 'about', 'logo_url', 'awards', 'founders'],
    async canonicalFields(env, key) {
      const row = await findCanonicalRowByNaturalKey(env, 'offices', key);
      if (!row) return null;
      const o = parseCanonicalRow('offices', row);
      return {
        name: o.name, loc: o.loc, cats: o.cats, yil: o.yil, website: o.website,
        about: o.about, logo_url: o.logo_url, awards: o.awards, founders: [],
      };
    },
  },
  products: {
    table: 'product_submissions',
    claimedColumn: null,
    copyFields: ['title', 'brand', 'designer', 'year', 'website', 'category', 'description', 'images', 'specs'],
    async canonicalFields(env, key) {
      const row = await findCanonicalRowByNaturalKey(env, 'products', key);
      if (!row) return null;
      const p = parseCanonicalRow('products', row);
      return { title: p.title, brand: p.brand_name_raw, designer: row.designer || null, year: row.year || null, website: p.website, category: p.category, description: p.description, images: p.images, specs: p.specs };
    },
  },
  materials: {
    table: 'material_submissions',
    claimedColumn: null,
    copyFields: ['title', 'brand', 'designer', 'year', 'website', 'category', 'description', 'images', 'specs'],
    async canonicalFields(env, key) {
      const row = await findCanonicalRowByNaturalKey(env, 'materials', key);
      if (!row) return null;
      const p = parseCanonicalRow('products', row);
      return { title: p.title, brand: p.brand_name_raw, designer: row.designer || null, year: row.year || null, website: p.website, category: p.category, description: p.description, images: p.images, specs: p.specs };
    },
  },
};

function bindContentFields(type, fields) {
  const { copyFields } = CONTENT_ACTION_TYPES[type];
  const arrayFields = SUBMISSION_TYPES[type].arrayFields;
  return copyFields.map(f => (arrayFields.includes(f) ? JSON.stringify(fields[f] || []) : (fields[f] ?? null)));
}

// POST /api/admin/legacy/content-action  body: {type:'architects'|'offices'|'products'|'materials', action:'delete'|'archive'|'publish', id?, key?}
async function handleContentAction(request, env, user) {
  const body = await readJson(request);
  return runContentAction(env, user, { type: body.type, action: body.action, id: body.id, key: body.key });
}

// runProjectAction (bu dosyada aşağıda) ile AYNI desen — bu fonksiyon kendi başına hiçbir yetki
// kontrolü YAPMAZ, çağıranı (handleContentAction, admin dispatcher) kendi yetki kontrolünü yapıp
// buraya düşer.
export async function runContentAction(env, user, { type, action, id, key }) {
  const config = CONTENT_ACTION_TYPES[type];
  if (!config) return errorJson('Geçersiz tip.');
  id = (id || '').trim();
  key = (key || '').trim();
  if (!['delete', 'archive', 'publish'].includes(action)) return errorJson('Geçersiz işlem.');
  if (!id && !key) return errorJson('Geçersiz istek.');

  if (id) {
    const row = await env.DB.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).bind(id).first();
    if (!row) return errorJson('Bulunamadı.', 404);
    const now = Date.now();
    // products/materials'ın claimedColumn'u yok (bkz. CONTENT_ACTION_TYPES) — canonical satırları
    // legacy_key = 'submission:<id>' işaretiyle bulunur (bkz. src/lib/canonicalSync.js#syncProduct).
    // GERÇEK BULGU: targetKey eskiden yalnızca claimedColumn/key'e düşüyordu, ikisi de products/
    // materials'ta hep boş olduğundan Sil (canonical satır HİÇ silinmiyor/karalisteye alınmıyordu,
    // yalnızca moderasyon satırı gidiyordu — ürün canlıda kalmaya devam ediyordu) VE Arşivle
    // (hidden_at HİÇ set edilmiyordu, yalnızca facet sayaçları güncelleniyordu — ürün canlıdan asla
    // kalkmıyordu) products/materials için sessizce hiçbir şey yapmıyordu.
    const legacyKeyFallback = (type === 'products' || type === 'materials') ? `submission:${id}` : null;
    const targetKey = (config.claimedColumn && row[config.claimedColumn]) || key || legacyKeyFallback;
    if (action === 'delete') {
      await deleteR2MediaKeys(env, collectR2MediaKeys(row, MEDIA_IMAGE_FIELDS_BY_TYPE[type] || {}));
      await env.DB.prepare(`DELETE FROM ${config.table} WHERE id = ?`).bind(id).run();
      await runContentCascadeDelete(env, user, type, { id, row });
      const canonRow = targetKey ? await findCanonicalRowByNaturalKey(env, type, targetKey) : null;
      if (canonRow) await hardDeleteCanonicalRow(env, type, canonRow, user.id);
      else if (targetKey) await blacklistLegacyKey(env, user.id, type, targetKey);
      if (FACET_TYPES.has(type)) await bumpFacetCounts(env, type);
    } else if (action === 'archive') {
      await env.DB.prepare(`UPDATE ${config.table} SET status = 'archived', updated_at = ? WHERE id = ?`).bind(now, id).run();
      if (targetKey) await setLegacyHidden(env, user, type, targetKey, true);
      else if (FACET_TYPES.has(type)) await bumpFacetCounts(env, type);
    } else {
      await env.DB.prepare(`UPDATE ${config.table} SET status = 'approved', updated_at = ? WHERE id = ?`).bind(now, id).run();
      await syncApprovedSubmissionToCanonical(env, type, parseSubmissionRow(type, { ...row, status: 'approved' }));
      if (targetKey) await setLegacyHidden(env, user, type, targetKey, false);
      else if (FACET_TYPES.has(type)) await bumpFacetCounts(env, type);
    }
    await invalidatePublicCache();
    const target = ssrPurgeTargetFor(type, row);
    if (target) await purgeSsrDetailCache(target.type, target.key);
    return json({ ok: true });
  }

  // key ile: canonical bir kayıt, henüz kendine ait bir *_submissions satırı olmayabilir.
  if (action === 'publish') return errorJson('Geçersiz istek.');

  if (action === 'delete') {
    const canonRow = await findCanonicalRowByNaturalKey(env, type, key);
    if (canonRow) await hardDeleteCanonicalRow(env, type, canonRow, user.id);
    else await blacklistLegacyKey(env, user.id, type, key);
    if (config.claimedColumn) {
      const { results: draftRows } = await env.DB.prepare(`SELECT * FROM ${config.table} WHERE ${config.claimedColumn} = ?`).bind(key).all();
      for (const draft of draftRows) await deleteR2MediaKeys(env, collectR2MediaKeys(draft, MEDIA_IMAGE_FIELDS_BY_TYPE[type] || {}));
      await env.DB.prepare(`DELETE FROM ${config.table} WHERE ${config.claimedColumn} = ?`).bind(key).run();
    }
    await runContentCascadeDelete(env, user, type, { key });
    if (FACET_TYPES.has(type)) await bumpFacetCounts(env, type);
    await invalidatePublicCache();
    const target = ssrPurgeTargetFor(type, { name: key });
    if (target) await purgeSsrDetailCache(target.type, target.key);
    return json({ ok: true });
  }

  const fields = await config.canonicalFields(env, key);
  if (!fields) return errorJson('Böyle bir kayıt bulunamadı.', 404);
  const now = Date.now();
  const boundValues = bindContentFields(type, fields);

  if (config.claimedColumn) {
    const existing = await env.DB.prepare(
      `SELECT id FROM ${config.table} WHERE ${config.claimedColumn} = ? ORDER BY created_at DESC LIMIT 1`
    ).bind(key).first();
    if (existing) {
      await env.DB.prepare(
        `UPDATE ${config.table} SET ${config.copyFields.map(f => `${f} = ?`).join(', ')}, status = 'archived', owner_user_id = ?, updated_at = ? WHERE id = ?`
      ).bind(...boundValues, user.id, now, existing.id).run();
    } else {
      const columns = ['id', 'owner_user_id', 'status', 'created_at', 'updated_at', config.claimedColumn, ...config.copyFields];
      const placeholders = columns.map(() => '?').join(', ');
      await env.DB.prepare(
        `INSERT INTO ${config.table} (${columns.join(', ')}) VALUES (${placeholders})`
      ).bind(newId(), user.id, 'archived', now, now, key, ...boundValues).run();
    }
  } else {
    const columns = ['id', 'owner_user_id', 'status', 'created_at', 'updated_at', ...config.copyFields];
    const placeholders = columns.map(() => '?').join(', ');
    await env.DB.prepare(
      `INSERT INTO ${config.table} (${columns.join(', ')}) VALUES (${placeholders})`
    ).bind(newId(), user.id, 'archived', now, now, ...boundValues).run();
  }

  await setLegacyHidden(env, user, type, key, true);
  await invalidatePublicCache();
  const target = ssrPurgeTargetFor(type, { name: key });
  if (target) await purgeSsrDetailCache(target.type, target.key);
  return json({ ok: true });
}
