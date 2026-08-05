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

// GET /api/office/:key — ofis-detay.html'nin TEK istekte aldığı birleşik yanıt. Dönen şekil:
// { item, founders, relatedProjects, hidden } — eski overlay tabanlı sürümle BİREBİR aynı.
export async function handleOfficeRoute(request, env, url, rawKey) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  const key = decodeURIComponent(rawKey || '');
  if (!key) return errorJson('Geçersiz istek.');

  return cachedPublicJson(request, env, url.pathname, () => buildOfficePayload(env, key));
}

async function buildOfficePayload(env, key) {
  const row = await findOffice(env, key);
  // bkz. src/routes/architect.js#buildArchitectPayload'daki AYNI gerçek bulgu — silinmiş/eşleşmeyen
  // bir key için en düşük id'li ofisin profiline sessizce düşen fallback kaldırıldı.
  if (!row) return { item: null, founders: [], relatedProjects: [], hidden: false };
  const o = parseCanonicalRow('offices', row);

  const [foundersRes, relatedRes] = await Promise.all([
    env.DB.prepare(
      `SELECT ar.* FROM office_founders f JOIN architects ar ON ar.id = f.architect_id
       WHERE f.office_id = ? AND ar.deleted_at IS NULL`
    ).bind(o.id).all(),
    env.DB.prepare(
      `SELECT DISTINCT p.* FROM project_designers pd JOIN projects p ON p.id = pd.project_id
       WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL AND pd.office_id = ?`
    ).bind(o.id).all(),
  ]);

  const founders = foundersRes.results.map(x => ({ name: x.name, role: x.position, photo: x.photo_url, badges: [] }));
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

  return { item, founders, relatedProjects, hidden: !!o.hidden_at };
}
