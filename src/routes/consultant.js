import { errorJson } from '../lib/http.js';
import { slugify } from '../lib/slugify.js';
import { cachedPublicJson } from '../lib/publicCache.js';
import { parseCanonicalRow } from '../lib/canonicalRead.js';
import { serializePublicEntity } from '../lib/serializePublicEntity.js';

// "/danismanlik" modülü (bkz. kullanıcı isteği: ADPList tarzı ücretli danışmanlık/mentörlük keşif
// sayfası) — ayrı bir tablo değil, architects.is_consultant=1 satırları (bkz. migrations/
// 0031_architect_consultant.sql). src/routes/architect.js#handleArchitectListRoute/
// handleArchitectRoute ile AYNI okuma desenleri, yalnızca is_consultant=1 filtresi eklenir. Bu
// turda admin/self-serve giriş ekranı yok — hourly_rate/expertise_tags/available_slots yalnızca
// migration/seed SQL ile elle doldurulur (bkz. kullanıcı isteği).

function trLower(s) {
  return (s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/Ş/g, 'ş').replace(/Ğ/g, 'ğ').replace(/Ü/g, 'ü').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç').toLowerCase();
}
function foldTr(s) {
  return trLower(s).replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o');
}

// available_slots içinde en az bir available:true saat varsa "Müsait" — kart rozetinde ve
// Müsaitlik sıralamasında kullanılır.
function hasOpenSlot(slots) {
  return (slots || []).some(day => (day.times || []).some(t => t.available));
}

async function findConsultant(env, key) {
  const row = await env.DB.prepare(
    `SELECT * FROM architects WHERE deleted_at IS NULL AND hidden_at IS NULL AND is_consultant = 1 AND (name = ? OR slug = ? OR legacy_key = ?) LIMIT 1`
  ).bind(key, key, key).first();
  if (row) return row;
  const { results } = await env.DB.prepare(
    `SELECT id, name FROM architects WHERE deleted_at IS NULL AND hidden_at IS NULL AND is_consultant = 1`
  ).all();
  const match = results.find(r => slugify(r.name) === key);
  if (!match) return null;
  return env.DB.prepare(`SELECT * FROM architects WHERE id = ?`).bind(match.id).first();
}

// GET /api/consultants — danismanlik.html#render()'ın sayfalanmış sunucu karşılığı — mimar.html'in
// /api/architects'iyle AYNI desen (bkz. handleArchitectListRoute), yalnızca is_consultant=1 filtresi
// ve danışmanlığa özgü alanlar (hourly_rate/expertise_tags/available_slots) eklenir.
export async function handleConsultantListRoute(request, env, url) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);

  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
    const limit = Math.min(96, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 24));
    const sort = url.searchParams.get('sort') || '';
    // proje.html#FILTER_GROUPS ile AYNI çok-seçmeli desen (bkz. kullanıcı isteği: "/danismanlik
    // sayfa yapısını birebir /projeler sayfasının mizanpajına dönüştür") — grup İÇİNDE OR (herhangi
    // bir seçili etiketi taşıyan danışman geçer), tek grup olduğundan gruplar arası AND yok.
    const tagParams = new Set(url.searchParams.getAll('tag').filter(Boolean));
    const minPrice = parseInt(url.searchParams.get('minPrice'), 10);
    const maxPrice = parseInt(url.searchParams.get('maxPrice'), 10);
    const searchQuery = foldTr((url.searchParams.get('search') || '').trim());

    const { results } = await env.DB.prepare(
      `SELECT a.id, a.slug, a.name, a.photo_url, a.position, a.hourly_rate, a.session_duration_min,
         a.expertise_tags, a.available_slots, a.consultant_total_minutes, a.consultant_sessions_completed,
         o.name AS office_name
       FROM architects a LEFT JOIN offices o ON o.id = a.office_id AND o.deleted_at IS NULL
       WHERE a.deleted_at IS NULL AND a.hidden_at IS NULL AND a.is_consultant = 1
       ORDER BY a.id DESC`
    ).all();

    const pool = results.map(row => {
      const a = parseCanonicalRow('architects', row);
      return {
        slug: a.slug, name: a.name, photo: a.photo_url, office: row.office_name || null,
        positionRaw: a.position || null, hourlyRate: a.hourly_rate || null,
        sessionDurationMin: a.session_duration_min || 45, expertiseTags: a.expertise_tags || [],
        availableSlots: a.available_slots || [], totalMinutes: a.consultant_total_minutes || 0,
        sessionsCompleted: a.consultant_sessions_completed || 0, badges: [],
      };
    });

    function passes(a) {
      if (tagParams.size && !a.expertiseTags.some(t => tagParams.has(t))) return false;
      if (!Number.isNaN(minPrice) && (a.hourlyRate == null || a.hourlyRate < minPrice)) return false;
      if (!Number.isNaN(maxPrice) && (a.hourlyRate == null || a.hourlyRate > maxPrice)) return false;
      if (searchQuery) {
        const haystack = foldTr(`${a.name} ${a.positionRaw || ''} ${a.office || ''} ${a.expertiseTags.join(' ')}`);
        if (!haystack.includes(searchQuery)) return false;
      }
      return true;
    }

    const filtered = pool.filter(passes);

    filtered.sort((x, y) => {
      switch (sort) {
        case 'price_asc': return (x.hourlyRate ?? Infinity) - (y.hourlyRate ?? Infinity);
        case 'price_desc': return (y.hourlyRate ?? -Infinity) - (x.hourlyRate ?? -Infinity);
        case 'availability': return Number(hasOpenSlot(y.availableSlots)) - Number(hasOpenSlot(x.availableSlots));
        case 'sessions':
        default:
          return (y.sessionsCompleted - x.sessionsCompleted) || x.name.localeCompare(y.name, 'tr');
      }
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (Math.min(page, totalPages) - 1) * limit;
    const items = filtered.slice(start, start + limit).map(a => ({ ...a, available: hasOpenSlot(a.availableSlots), availableSlots: undefined }));

    const tagCounts = {};
    pool.forEach(a => a.expertiseTags.forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));

    return {
      items: serializePublicEntity(items), total, page: Math.min(page, totalPages), totalPages,
      filters: { tags: Object.keys(tagCounts).sort((x, y) => tagCounts[y] - tagCounts[x]).map(v => ({ value: v, count: tagCounts[v] })) },
    };
  }, () => consultantListFingerprint(env));
}

function consultantListFingerprint(env) {
  return env.DB.prepare(
    `SELECT COUNT(*) AS cnt, MAX(updated_at) AS latest FROM architects WHERE deleted_at IS NULL AND hidden_at IS NULL AND is_consultant = 1`
  ).first().then(row => `${row?.cnt ?? 0}:${row?.latest ?? ''}`);
}

// GET /api/consultant/:key — consultant-modal.js'in tek istekte aldığı birleşik yanıt: { item,
// office, similar, hidden } — src/routes/architect.js#buildArchitectPayload'ın küçültülmüş
// karşılığı (meslektaş/ilgili proje listeleri yerine "benzer danışmanlar").
export async function handleConsultantRoute(request, env, url, rawKey) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  const key = decodeURIComponent(rawKey || '');
  if (!key) return errorJson('Geçersiz istek.');

  return cachedPublicJson(request, env, url.pathname, () => buildConsultantPayload(env, key));
}

async function buildConsultantPayload(env, key) {
  const row = await findConsultant(env, key);
  if (!row) return { item: null, hidden: false };
  const a = parseCanonicalRow('architects', row);

  const officeRow = a.office_id
    ? await env.DB.prepare(`SELECT * FROM offices WHERE id = ? AND deleted_at IS NULL`).bind(a.office_id).first()
    : null;
  const office = officeRow ? parseCanonicalRow('offices', officeRow) : null;

  // "Projeler" bölümü (bkz. kullanıcı isteği) — src/routes/architect.js#buildArchitectPayload'ın
  // AYNI relatedProjects sorgusu (mimarın kendisine YA DA bağlı olduğu ofise atanmış projeler).
  const { results: relatedProjectRows } = await env.DB.prepare(
    `SELECT DISTINCT p.* FROM project_designers pd JOIN projects p ON p.id = pd.project_id
     WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL AND (pd.architect_id = ? OR pd.office_id = ?)`
  ).bind(a.id, office ? office.id : -1).all();
  const relatedProjects = relatedProjectRows.map(p => {
    const parsed = parseCanonicalRow('projects', p);
    return { slug: parsed.slug, title: parsed.title, images: parsed.images, category: parsed.category };
  });

  // Benzer danışmanlar: aynı ofis VEYA en az bir ortak uzmanlık etiketi paylaşan diğer
  // is_consultant=1 kayıtlar (bkz. plan: "Benzer Danışmanlar" carousel) — LIMIT 6.
  const { results: candidateRows } = await env.DB.prepare(
    `SELECT ar.* FROM architects ar
     WHERE ar.deleted_at IS NULL AND ar.hidden_at IS NULL AND ar.is_consultant = 1 AND ar.id != ?
     ORDER BY ar.id DESC LIMIT 40`
  ).bind(a.id).all();
  const tagSet = new Set(a.expertise_tags || []);
  const similar = candidateRows
    .map(r => parseCanonicalRow('architects', r))
    .filter(c => (a.office_id && c.office_id === a.office_id) || (c.expertise_tags || []).some(t => tagSet.has(t)))
    .slice(0, 6)
    .map(c => ({
      slug: c.slug, name: c.name, photo: c.photo_url, hourlyRate: c.hourly_rate || null,
      sessionDurationMin: c.session_duration_min || 45, expertiseTags: c.expertise_tags || [], badges: [],
    }));

  const item = {
    name: a.name, role: a.position, photo: a.photo_url, office: office ? office.name : null,
    about: a.consultant_bio || a.about, expertiseTags: a.expertise_tags || [],
    hourlyRate: a.hourly_rate || null, sessionDurationMin: a.session_duration_min || 45,
    availableSlots: a.available_slots || [], totalMinutes: a.consultant_total_minutes || 0,
    sessionsCompleted: a.consultant_sessions_completed || 0, badges: [],
  };

  return {
    item,
    office: office ? { name: office.name, loc: office.loc, logo: office.logo_url, badges: [] } : null,
    relatedProjects,
    similar,
    hidden: !!a.hidden_at,
  };
}
