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

// SQL LIKE yalnızca ASCII harfleri case-insensitive katlar — Türkçe İ/I/ı/i çiftlerini bilmediğinden
// D1 tarafında bu normalizasyon yapılamıyor (bkz. src/routes/office.js#trLower'daki AYNI gerekçe/
// gerçek bulgu). project.js/legacyContent.js'deki AYNI trLower ile birebir aynı — her dosyada
// yerel olarak tekrar tanımlanmış.
function trLower(s) {
  return (s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/Ş/g, 'ş').replace(/Ğ/g, 'ğ').replace(/Ü/g, 'ü').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç').toLowerCase();
}

// GET /api/architects/search?q=... — proje-ekle.html/urun-ekle.html gibi formlardaki Mimar
// autocomplete kutularının canlı D1 sorgusu (bkz. kullanıcı isteği: "Admin panelinden yeni
// eklenen mimarlar Proje Ekle'deki öneri kutusunda görünmüyor" — eski hâli data.js'teki statik
// architects[] dizisini kullanıyordu, D1'e yeni eklenen kayıtları hiç görmüyordu). Türkçe harf
// duyarlılığı için SQL LIKE yerine tüm adaylar çekilip trLower ile JS tarafında filtrelenir
// (tablo küçük olduğundan, bkz. findArchitect'teki AYNI tam-tarama gerekçesi).
export async function handleArchitectSearchRoute(request, env, url) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    const q = trLower((url.searchParams.get('q') || '').trim());
    if (!q) return { items: [] };
    const { results } = await env.DB.prepare(
      `SELECT a.name AS name, o.name AS office_name FROM architects a
       LEFT JOIN offices o ON o.id = a.office_id AND o.deleted_at IS NULL
       WHERE a.deleted_at IS NULL AND a.hidden_at IS NULL ORDER BY a.name`
    ).all();
    const items = results.filter(r => trLower(r.name).includes(q)).slice(0, 20).map(r => ({ label: r.name, sub: r.office_name || '' }));
    return { items };
  });
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
  const row = await findArchitect(env, key);
  // bkz. gerçek bulgu: eski "eşleşme yoksa ilk kaydı döndür" fallback'i, silinmiş/eşleşmeyen bir key
  // için sessizce BAŞKA bir mimarın (her zaman en düşük id'li, silinmemiş satır) profilini
  // döndürüyordu — ör. architects id 1-6 silindiğinde /mimar/gokhan-avcioglu id 7'nin (Seyhan
  // Özdemir Sarper) verisini gösteriyordu. src/routes/project.js#handleProjectDetailRoute'un
  // AYNI durumdaki "item: null, hidden: false" dönüşüyle tutarlı hale getirildi — istemci
  // (mimar-detay.html) bunu zaten "bulunamadı" olarak ele alıp mimar.html'e yönlendiriyor.
  if (!row) return { item: null, hidden: false };
  const a = parseCanonicalRow('architects', row);

  const officeRow = a.office_id
    ? await env.DB.prepare(`SELECT * FROM offices WHERE id = ? AND deleted_at IS NULL`).bind(a.office_id).first()
    : null;
  const office = officeRow ? parseCanonicalRow('offices', officeRow) : null;

  // Mimarın kurucu/ortak olduğu TÜM firmalar — yalnızca kendi office_id'siyle bağlı olduğu firma
  // değil, office_founders join tablosundaki TÜM bağlantılar (bkz. gerçek bulgu: Han Tümertekin'in
  // profilinde "Pozisyon: Kurucu" yazmasına rağmen office_id'si boş olduğundan, yalnızca office_id
  // okunsaydı Tümertekin Architects hiç görünmezdi — firma tarafında Kurucular listesine eklenerek
  // office_founders'a bağlanmış olsa bile). Tekilleştirilmiş, office_id'deki varsa önce o sırayla.
  const { results: founderOfficeRows } = await env.DB.prepare(
    `SELECT o.* FROM office_founders f JOIN offices o ON o.id = f.office_id
     WHERE f.architect_id = ? AND o.deleted_at IS NULL`
  ).bind(a.id).all();
  const officesById = new Map();
  if (office) officesById.set(office.id, office);
  for (const row of founderOfficeRows) {
    const parsed = parseCanonicalRow('offices', row);
    if (!officesById.has(parsed.id)) officesById.set(parsed.id, parsed);
  }
  const offices = [...officesById.values()];

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
    offices: offices.map(o => ({ name: o.name, loc: o.loc, cats: o.cats, yil: o.yil, logo: o.logo_url, badges: [] })),
    colleagues,
    relatedProjects,
    hidden: !!a.hidden_at,
  };
}
