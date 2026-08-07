import { errorJson } from '../lib/http.js';
import { slugify } from '../lib/slugify.js';
import { cachedPublicJson } from '../lib/publicCache.js';
import { parseCanonicalRow } from '../lib/canonicalRead.js';

// Faz 3 — bkz. src/routes/architect.js'teki AYNI "canonical tablodan doğrudan okuma, overlay
// merge-time'da zaten uygulandı" yorumu.

async function findOffice(env, key) {
  const row = await env.DB.prepare(
    `SELECT * FROM offices WHERE deleted_at IS NULL AND (name = ? OR slug = ? OR legacy_key = ?) LIMIT 1`
  ).bind(key, key, key).first();
  if (row) return row;
  // bkz. src/routes/architect.js#findArchitect'teki AYNI slugify-tarama fallback'i.
  const { results } = await env.DB.prepare(`SELECT id, name FROM offices WHERE deleted_at IS NULL`).all();
  const match = results.find(r => slugify(r.name) === key);
  if (!match) return null;
  return env.DB.prepare(`SELECT * FROM offices WHERE id = ?`).bind(match.id).first();
}

// SQL LIKE yalnızca ASCII harfleri case-insensitive katlar — Türkçe İ/I/ı/i çiftlerini bilmediğinden
// D1 tarafında bu normalizasyon yapılamıyor (bkz. gerçek bulgu: küçük harfle "birim" yazınca "BİRİM
// Design" çıkmıyordu). src/routes/project.js#trLower/src/routes/legacyContent.js#trLower ile BİREBİR
// aynı — bu dosyalarda da aynı sebeple yerel olarak tekrar tanımlanmış.
function trLower(s) {
  return (s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/Ş/g, 'ş').replace(/Ğ/g, 'ğ').replace(/Ü/g, 'ü').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç').toLowerCase();
}

// GET /api/offices/search?q=... — src/routes/architect.js#handleArchitectSearchRoute'un firma
// karşılığı; proje-ekle.html'deki Firma/Marka autocomplete kutularının canlı D1 sorgusu. Türkçe
// harf duyarlılığı için SQL LIKE yerine tüm adaylar çekilip trLower ile JS tarafında filtrelenir
// (tablo küçük olduğundan, bkz. findOffice'teki AYNI tam-tarama gerekçesi).
export async function handleOfficeSearchRoute(request, env, url) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    const q = trLower((url.searchParams.get('q') || '').trim());
    if (!q) return { items: [] };
    const { results } = await env.DB.prepare(
      `SELECT name, loc FROM offices WHERE deleted_at IS NULL AND hidden_at IS NULL ORDER BY name`
    ).all();
    const items = results.filter(r => trLower(r.name).includes(q)).slice(0, 20).map(r => ({ label: r.name, sub: r.loc || '' }));
    return { items };
  });
}

// firma.html#FOREIGN_LOC_TO_COUNTRY/cityOf ile BİREBİR aynı — Türkiye dışındaki markalar için konum
// filtresinde şehir değil ülke adı gösterilir.
const FOREIGN_LOC_TO_COUNTRY = {
  'Almanya': 'Almanya', 'Amsterdam, Hollanda': 'Hollanda', 'Chicago, ABD': 'ABD', 'Ljubljana': 'Slovenya',
  'Londra, İngiltere': 'İngiltere', 'Los Angeles, ABD': 'ABD', 'Milano, İtalya': 'İtalya', 'Moskova': 'Rusya',
  'New York, ABD': 'ABD', 'Paris': 'Fransa', 'Paris, Fransa': 'Fransa', 'Roma': 'İtalya', 'Rotterdam': 'Hollanda',
  'Rotterdam, Hollanda': 'Hollanda', 'Stuttgart': 'Almanya', 'Stuttgart, Almanya': 'Almanya', 'Tokyo, Japonya': 'Japonya',
};
function cityOf(loc) {
  if (!loc) return '';
  if (FOREIGN_LOC_TO_COUNTRY[loc]) return FOREIGN_LOC_TO_COUNTRY[loc];
  return loc.split(' / ')[0];
}

// firma.html#expBucketOf ile BİREBİR aynı.
function expBucketOf(yil) {
  if (!yil) return null;
  const years = new Date().getFullYear() - yil;
  if (years < 1) return null;
  if (years <= 5) return '1-5';
  if (years <= 10) return '6-10';
  if (years <= 20) return '11-20';
  if (years <= 30) return '21-30';
  return '30+';
}

function trLowerSearch(s) {
  return (s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/Ş/g, 'ş').replace(/Ğ/g, 'ğ').replace(/Ü/g, 'ü').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç').toLowerCase();
}

// GET /api/offices — firma.html#render()'ın sayfalanmış sunucu karşılığı (bkz. src/routes/
// architect.js#handleArchitectListRoute'daki AYNI desen).
export async function handleOfficeListRoute(request, env, url) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);

  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
    const limit = Math.min(96, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 24));
    const sort = url.searchParams.get('sort') || '';
    const locParam = url.searchParams.get('loc') || '';
    const catParam = url.searchParams.get('cat') || '';
    const expParam = url.searchParams.get('exp') || '';
    const searchQuery = trLowerSearch((url.searchParams.get('search') || '').trim());

    // ORDER BY id DESC — src/routes/project.js#handleProjectsRoute'daki AYNI varsayılan sıralama
    // (sort seçilmemişse "son eklenen ilk") — anasayfa Firma carousel'i (bkz. index.html) bu
    // varsayılana güvenerek ?limit=6 ile doğrudan son eklenen 6 firmayı çeker.
    // Faz 4A — Projection Optimization: kart listesi yalnızca aşağıdaki alanları render eder (bkz.
    // aşağıdaki pool.map) — about/awards gibi yalnızca tekil profil sayfasında (buildOfficePayload,
    // burada dokunulmayan ayrı bir sorgu) gereken kolonlar bu listeye dahil edilmiyor.
    const { results } = await env.DB.prepare(
      `SELECT slug, name, loc, cats, yil, website, logo_url FROM offices WHERE deleted_at IS NULL AND hidden_at IS NULL ORDER BY id DESC`
    ).all();
    const pool = results.map(row => {
      const o = parseCanonicalRow('offices', row);
      // gerçek bulgu: bazı üye gönderisi kökenli ofislerde `cats` bir dizi olarak (JSON.stringify(["a · b"]))
      // yazılmış, statik/legacy kayıtlarda ise düz string ("a · b") — parseCanonicalRow ikisini de
      // olduğu gibi döner (bkz. o dosyadaki JSON_FIELDS notu). firma.html'in her yerde beklediği
      // düz " · "-ayrımlı string biçimine burada TEK noktadan normalize edilir. Yalnızca dizi/string
      // değil (bkz. gerçek bulgu: bir kayıtta cats JSON.parse sonrası ne dizi ne string bir değere
      // çözülmüştü, `(o.cats || '').split` TypeError fırlatıyordu) — typeof kontrolü her ihtimalde
      // (sayı/boolean/obje) güvenli bir düz metne düşer.
      const cats = Array.isArray(o.cats) ? o.cats.join(' · ') : (typeof o.cats === 'string' ? o.cats : '');
      return { slug: o.slug, name: o.name, loc: o.loc, cats, yil: o.yil, website: o.website, logo: o.logo_url, badges: [] };
    });

    function passes(o) {
      if (locParam && cityOf(o.loc) !== locParam) return false;
      if (catParam && !(o.cats || '').includes(catParam)) return false;
      if (expParam && expBucketOf(o.yil) !== expParam) return false;
      if (searchQuery && !trLowerSearch(o.name).includes(searchQuery)) return false;
      return true;
    }

    const filtered = pool.filter(passes);

    if (sort) {
      filtered.sort((a, b) => {
        switch (sort) {
          case 'name_asc': return a.name.localeCompare(b.name, 'tr');
          case 'year_desc': return (b.yil || 0) - (a.yil || 0);
          case 'year_asc': return (a.yil || 9999) - (b.yil || 9999);
          default: return 0;
        }
      });
    }

    // firma.html#populateFilters — sayaçlar tüm havuz üzerinden, aktif filtrelerden bağımsız
    // (mimar.html#handleArchitectListRoute'daki AYNI gerekçe). Türkiye tek başına bir konum
    // seçeneği olarak listelenmez (bkz. firma.html#populateFilters'daki AYNI `city === 'Türkiye'` atlama).
    const locCounts = {}, catCounts = {};
    pool.forEach(o => {
      const city = cityOf(o.loc);
      if (city && city !== 'Türkiye') locCounts[city] = (locCounts[city] || 0) + 1;
      (o.cats || '').split(' · ').map(s => s.trim()).filter(Boolean).forEach(cat => { catCounts[cat] = (catCounts[cat] || 0) + 1; });
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (Math.min(page, totalPages) - 1) * limit;
    const items = filtered.slice(start, start + limit);

    return {
      items, total, page: Math.min(page, totalPages), totalPages,
      filters: {
        loc: Object.keys(locCounts).sort((a, b) => locCounts[b] - locCounts[a] || a.localeCompare(b, 'tr')).map(v => ({ value: v, count: locCounts[v] })),
        cat: Object.keys(catCounts).sort((a, b) => catCounts[b] - catCounts[a] || a.localeCompare(b, 'tr')).map(v => ({ value: v, count: catCounts[v] })),
      },
    };
  });
}

// GET /api/office/:key — ofis-detay.html'nin TEK istekte aldığı birleşik yanıt. Dönen şekil:
// { item, founders, relatedProjects, hidden } — eski overlay tabanlı sürümle BİREBİR aynı.
export async function handleOfficeRoute(request, env, url, rawKey) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  const key = decodeURIComponent(rawKey || '');
  if (!key) return errorJson('Geçersiz istek.');

  return cachedPublicJson(request, env, url.pathname, () => buildOfficePayload(env, key));
}

// Kurucular kutusuna yazılıp architects tablosunda karşılığı bulunamadığı için office_founders'a
// hiç bağlanamamış (bkz. src/lib/canonicalSync.js#syncOfficeFoundersFromNames — eşleşmeyen isim
// sessizce atlanır) isimleri kurtarır — js/components/project-meta.js'nin designerDetails
// `unregistered: true` deseninin (bkz. src/routes/project.js#fetchRawDesignerNames) ofis
// karşılığı. En son (varsa onaylı) office_submissions satırı, ofisin claimed_profile_key'i ya da
// (bağımsız kayıtlarda) submissionMarker id'si üzerinden bulunur.
async function fetchRawFounderNames(env, o) {
  const submissionId = (o.legacy_key || '').startsWith('submission:') ? o.legacy_key.slice('submission:'.length) : '';
  const row = await env.DB.prepare(
    `SELECT founders FROM office_submissions WHERE claimed_profile_key = ?1 OR claimed_profile_key = ?2 OR id = ?3 ORDER BY updated_at DESC LIMIT 1`
  ).bind(o.name, o.legacy_key || '', submissionId).first();
  if (!row || !row.founders) return [];
  try { return JSON.parse(row.founders) || []; } catch { return []; }
}

// Önceki/Sonraki Firma — bkz. src/routes/architect.js#fetchAdjacentArchitect'teki AYNI desen.
async function fetchAdjacentOffice(env, id) {
  const where = `deleted_at IS NULL AND hidden_at IS NULL`;
  let prev = await env.DB.prepare(`SELECT id, slug, name FROM offices WHERE ${where} AND id < ? ORDER BY id DESC LIMIT 1`).bind(id).first();
  let next = await env.DB.prepare(`SELECT id, slug, name FROM offices WHERE ${where} AND id > ? ORDER BY id ASC LIMIT 1`).bind(id).first();
  if (!prev) prev = await env.DB.prepare(`SELECT id, slug, name FROM offices WHERE ${where} ORDER BY id DESC LIMIT 1`).first();
  if (!next) next = await env.DB.prepare(`SELECT id, slug, name FROM offices WHERE ${where} ORDER BY id ASC LIMIT 1`).first();
  if (prev && prev.id === id) prev = null;
  if (next && next.id === id) next = null;
  return {
    prevItem: prev ? { slug: prev.slug, title: prev.name } : null,
    nextItem: next ? { slug: next.slug, title: next.name } : null,
  };
}

async function buildOfficePayload(env, key) {
  const row = await findOffice(env, key);
  // bkz. src/routes/architect.js#buildArchitectPayload'daki AYNI gerçek bulgu — silinmiş/eşleşmeyen
  // bir key için en düşük id'li ofisin profiline sessizce düşen fallback kaldırıldı.
  if (!row) return { item: null, founders: [], relatedProjects: [], hidden: false };
  const o = parseCanonicalRow('offices', row);

  const [foundersRes, relatedRes, rawFounderNames] = await Promise.all([
    env.DB.prepare(
      `SELECT ar.* FROM office_founders f JOIN architects ar ON ar.id = f.architect_id
       WHERE f.office_id = ? AND ar.deleted_at IS NULL`
    ).bind(o.id).all(),
    env.DB.prepare(
      `SELECT DISTINCT p.* FROM project_designers pd JOIN projects p ON p.id = pd.project_id
       WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL AND pd.office_id = ?`
    ).bind(o.id).all(),
    fetchRawFounderNames(env, o),
  ]);

  const founders = foundersRes.results.map(x => ({ name: x.name, role: x.position, photo: x.photo_url, badges: [] }));
  const knownFounderNames = new Set(founders.map(f => trLower(f.name)));
  for (const name of rawFounderNames) {
    if (!name || knownFounderNames.has(trLower(name))) continue;
    knownFounderNames.add(trLower(name));
    founders.push({ name, role: null, photo: null, badges: [], unregistered: true });
  }
  const relatedProjects = relatedRes.results.map(p => {
    const parsed = parseCanonicalRow('projects', p);
    return { slug: parsed.slug, title: parsed.title, images: parsed.images, category: parsed.category };
  });

  const item = {
    name: o.name, loc: o.loc, cats: o.cats, yil: o.yil, website: o.website, about: o.about,
    logo: o.logo_url, awards: o.awards, badges: [],
  };
  // renderProfileEditButton'ın "claim=" linki HER ZAMAN orijinal statik anahtarı (legacy_key)
  // kullanmalı — o.name bir yeniden adlandırmadan sonra değişmiş olabilir (bkz. ofis-detay.html
  // #renderProfileEditButton'daki AYNI _claimKey gerekçesi, eski koddaki AYNI davranış). AMA
  // legacy_key, src/lib/canonicalSync.js#submissionMarker tarafından yazılan dahili "submission:
  // <id>" idempotency işareti de OLABİLİR — bu insan tarafından okunabilir bir anahtar değil,
  // yalnızca "bu gönderi hangi canonical satırı oluşturdu" sorusunu tekrar bulmak için var (bkz.
  // gerçek bulgu: BİRİM Design gibi doğrudan bir gönderiden oluşmuş firmalarda claim= linki ham
  // "submission:3caa1398-..." string'iyle açılıyor, firma-ekle.html bunu Firma Adı kutusuna
  // olduğu gibi yazıyordu). Böyle bir işaretse _claimKey set edilmez, aşağıdaki o.name'e düşülür.
  const isSubmissionMarker = typeof o.legacy_key === 'string' && o.legacy_key.startsWith('submission:');
  if (o.legacy_key && !isSubmissionMarker && o.legacy_key !== o.name) item._claimKey = o.legacy_key;

  const adjacent = await fetchAdjacentOffice(env, o.id);

  return { item, founders, relatedProjects, prevItem: adjacent.prevItem, nextItem: adjacent.nextItem, hidden: !!o.hidden_at };
}
