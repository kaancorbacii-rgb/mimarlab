import { errorJson } from '../lib/http.js';
import { slugify } from '../lib/slugify.js';
import { cachedPublicJson } from '../lib/publicCache.js';
import { parseCanonicalRow } from '../lib/canonicalRead.js';

// Faz 3 — statik data.js/projeler-data.js dizileri + *_submissions overlay yerine doğrudan
// canonical `architects`/`offices`/`projects` tablolarından okur (bkz. docs/architecture-roadmap.md
// Faz3 madde 1). Onaylı submission overlay'i artık request-time'da değil, scripts/
// merge-submissions-to-id-first.js tarafından merge-time'da BİR KEZ uygulanıp canonical satıra
// yazılmış durumda — bu yüzden burada ayrı bir overlay birleştirme adımı YOK, doğrudan kolon okuma.

async function findArchitect(env, key) {
  const row = await env.DB.prepare(
    `SELECT * FROM architects WHERE deleted_at IS NULL AND (name = ? OR slug = ? OR legacy_key = ?) LIMIT 1`
  ).bind(key, key, key).first();
  if (row) return row;
  // Yeniden adlandırma sonrası `slug` kolonu güncel tutulur (bkz. src/lib/officeFounderCascade.js),
  // ama birden fazla art arda yeniden adlandırma ya da eski bir bağlantı yine de üretilen slug'la
  // eşleşmeyebilir — bkz. eski #findByNameOrSlug'daki AYNI slugify-tarama fallback'i. Tablo küçük
  // olduğundan (yüzlerce satır) bu tam tarama ucuzdur.
  const { results } = await env.DB.prepare(`SELECT id, name FROM architects WHERE deleted_at IS NULL`).all();
  const match = results.find(r => slugify(r.name) === key);
  if (!match) return null;
  return env.DB.prepare(`SELECT * FROM architects WHERE id = ?`).bind(match.id).first();
}

// GET /api/architect/:key — mimar-detay.html'nin TEK istekte aldığı birleşik yanıt. Dönen şekil:
// { item, office, colleagues, relatedProjects, hidden } — eski overlay tabanlı sürümle BİREBİR aynı.
export async function handleArchitectRoute(request, env, url, rawKey) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  const key = decodeURIComponent(rawKey || '');
  if (!key) return errorJson('Geçersiz istek.');

  return cachedPublicJson(request, env, url.pathname, () => buildArchitectPayload(env, key));
}

async function buildArchitectPayload(env, key) {
  let row = await findArchitect(env, key);
  if (!row) {
    // eski davranışla birebir aynı fallback (explicitMatch || architects[0]) — bozuk/eski bir key
    // geldiğinde çökmek yerine ilk kaydı döner.
    row = await env.DB.prepare(`SELECT * FROM architects WHERE deleted_at IS NULL ORDER BY id LIMIT 1`).first();
  }
  const a = parseCanonicalRow('architects', row);

  const officeRow = a.office_id
    ? await env.DB.prepare(`SELECT * FROM offices WHERE id = ? AND deleted_at IS NULL`).bind(a.office_id).first()
    : null;
  const office = officeRow ? parseCanonicalRow('offices', officeRow) : null;

  const [colleaguesRes, relatedRes] = await Promise.all([
    office
      ? env.DB.prepare(
          `SELECT ar.* FROM office_founders f JOIN architects ar ON ar.id = f.architect_id
           WHERE f.office_id = ? AND ar.deleted_at IS NULL AND ar.id != ?`
        ).bind(office.id, a.id).all()
      : Promise.resolve({ results: [] }),
    env.DB.prepare(
      `SELECT DISTINCT p.* FROM project_designers pd JOIN projects p ON p.id = pd.project_id
       WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL AND (pd.architect_id = ? OR pd.office_id = ?)`
    ).bind(a.id, office ? office.id : -1).all(),
  ]);

  // Meslektaşlar/ilgili projeler: role/photo/awards gibi alanlar artık canonical satırın kendisinden
  // gelir (overlay merge-time'da zaten uygulandı) — eski request-time overlay hesaplaması gerekmiyor.
  const colleagues = colleaguesRes.results.map(x => ({ name: x.name, role: x.position, photo: x.photo_url, badges: [] }));
  const relatedProjects = relatedRes.results.map(p => {
    const parsed = parseCanonicalRow('projects', p);
    return { slug: parsed.slug, title: parsed.title, images: parsed.images, category: parsed.category };
  });

  return {
    item: {
      name: a.name, dob: a.dob, school: a.school, dept: a.dept, profession: a.profession,
      role: a.position, awards: a.awards, about: a.about, photo: a.photo_url, office: office ? office.name : null,
      badges: [],
    },
    office: office ? { name: office.name, loc: office.loc, cats: office.cats, yil: office.yil, logo: office.logo_url, badges: [] } : null,
    colleagues,
    relatedProjects,
    hidden: !!a.hidden_at,
  };
}
