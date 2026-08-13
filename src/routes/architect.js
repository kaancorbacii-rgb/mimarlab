import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { slugify } from '../lib/slugify.js';
import { cachedPublicJson, getCachedPool } from '../lib/publicCache.js';
import { parseCanonicalRow } from '../lib/canonicalRead.js';
import { serializePublicEntity } from '../lib/serializePublicEntity.js';
import { purgeSsrDetailCache } from '../lib/ssrCache.js';

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

// trLower Türkçe BÜYÜK->küçük eşlemesini doğru yapar ama bu yüzden ASCII "I" (ör. Türkçe olmayan/
// ALL-CAPS yazılmış isimlerde) noktasız 'ı'ya döner — kullanıcı normal klavyeyle (düz 'i' ile)
// yazdığında eşleşme kaçırılabiliyordu (bkz. src/routes/project.js#foldTr'deki AYNI gerçek bulgu/
// gerekçe — SANKAI proje arama hatası). Sorgu VE hedef metin AYNI foldTr'den geçirilir.
function foldTr(s) {
  return trLower(s).replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o');
}

// GET /api/architects/search?q=...&office=<tam ofis adı> — proje-ekle.html/urun-ekle.html gibi
// formlardaki Mimar autocomplete kutularının canlı D1 sorgusu (bkz. kullanıcı isteği: "Admin
// panelinden yeni eklenen mimarlar Proje Ekle'deki öneri kutusunda görünmüyor" — eski hâli data.js'
// teki statik architects[] dizisini kullanıyordu, D1'e yeni eklenen kayıtları hiç görmüyordu).
// Türkçe harf duyarlılığı için SQL LIKE yerine tüm adaylar çekilip trLower ile JS tarafında
// filtrelenir (tablo küçük olduğundan, bkz. findArchitect'teki AYNI tam-tarama gerekçesi).
// office parametresi (q ile birlikte DEĞİL, onun yerine kullanılır) — urun-ekle.html'in "Marka"
// alanından bir firma seçildiğinde o firmanın bünyesindeki TÜM mimarları (architects.office_id
// eşleşmesi) döner; Legacy Bundle Elimination Faz 3'ten önce bu istemci tarafında data.js'in statik
// architects[] dizisi üzerinde `a.office === seçilenFirma` filtresiyle yapılıyordu (bkz. kullanıcı
// isteği).
export async function handleArchitectSearchRoute(request, env, url) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    const officeParam = (url.searchParams.get('office') || '').trim();
    const q = foldTr((url.searchParams.get('q') || '').trim());
    if (!q && !officeParam) return { items: [] };
    const { results } = await env.DB.prepare(
      `SELECT a.name AS name, o.name AS office_name FROM architects a
       LEFT JOIN offices o ON o.id = a.office_id AND o.deleted_at IS NULL
       WHERE a.deleted_at IS NULL AND a.hidden_at IS NULL ORDER BY a.name`
    ).all();
    const filtered = officeParam
      ? results.filter(r => r.office_name === officeParam)
      : results.filter(r => foldTr(r.name).includes(q));
    const items = filtered.slice(0, 20).map(r => ({ label: r.name, sub: r.office_name || '' }));
    return { items };
  });
}

// GET /api/architects/schools — uye-ol.html (kayıt formu) / mimar-ekle.html'deki "Üniversite"
// otomatik tamamlama kutusu için canonical D1'deki tüm mimarların KAYITLI OLDUĞU okulların
// tekilleştirilmiş listesini döner (bkz. kullanıcı isteği: Legacy Bundle Elimination Faz 3 —
// eskiden data.js'in statik architects[] dizisi üzerinde `[...new Set(architects.map(a=>a.school))]`
// ile istemci tarafında hesaplanıyordu). Sonuç istemci tarafında zaten yerel/senkron substring
// filtrelendiğinden (bkz. o sayfalardaki wireAutocomplete — canlı arama DEĞİL, tek seferlik tam
// liste + yerel filtre) burada sayfalama/arama parametresi yok, tek seferlik tam liste döner.
export async function handleArchitectSchoolsRoute(request, env, url) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  return cachedPublicJson(request, env, url.pathname, async () => {
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT school FROM architects WHERE deleted_at IS NULL AND school IS NOT NULL AND school != ''`
    ).all();
    const items = results.map(r => r.school).sort((a, b) => a.localeCompare(b, 'tr'));
    return { items };
  });
}

// Pozisyon filtre kovası — "Kurucu"/"Kurucu Ortak" tarihsel olarak tek "Kurucu" kovasında
// gruplanır (bkz. eski yorum: 485 "Kurucu Ortak" + 312 "Kurucu"), "İş arıyor"/"İş Arıyor" normalize
// edilip "İşsiz" olur. GERÇEK BULGU: eski sürüm burada tanınmayan HER değeri (ör. "Ortak",
// "Akademisyen", "Freelance", "Ekip Lideri") sessizce "Çalışan" kovasına düşürüyordu — bir mimarın
// profili "Ortak"/"Akademisyen" olarak düzenlense bile mimar.html filtresinde hâlâ "Çalışan" altında
// görünüyordu (bkz. kullanıcı isteği: Melkan Gürsel/Nur Urfalıoğlu). Artık tanınmayan her değer
// OLDUĞU GİBİ kendi kovasına döner — mimar-ekle.html#POZISYON_OPTIONS'a yeni bir değer eklendiğinde
// bile sessizce yanlış kovaya düşme riski kalmaz.
export function positionOf(position) {
  if (!position) return null;
  if (position === 'İş arıyor' || position === 'İş Arıyor') return 'İşsiz';
  if (position.startsWith('Kurucu')) return 'Kurucu';
  return position;
}

// GET /api/architects — mimar.html#render()'ın sayfalanmış sunucu karşılığı (bkz. kullanıcı isteği:
// "Bütün sayfaların verisini tek seferde DOM'a yükleme"). mimar.html#populateFilters()'ın dob/award/
// position sayaçlarını `filters` alanında birlikte döner — tablo küçük (~800 satır) olduğundan tam
// tarama ucuz (bkz. handleArchitectSearchRoute'daki AYNI gerekçe).
export async function handleArchitectListRoute(request, env, url) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);

  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
    const limit = Math.min(96, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 24));
    const sort = url.searchParams.get('sort') || '';
    const dobParam = url.searchParams.get('dob') || '';
    const awardParam = url.searchParams.get('award') || '';
    const positionParam = url.searchParams.get('position') || '';
    const searchQuery = foldTr((url.searchParams.get('search') || '').trim());

    // Varsayılan sıralama artık "en popüler" (en çok projesi olan mimar önce) — bkz. kullanıcı
    // isteği: "Default Popularity-Based Sorting". ?sort=newest EXPLICIT olarak eski "son eklenen
    // ilk" (id DESC) davranışını korur — anasayfa Mimar carousel'i (bkz. index.html) artık bu
    // değeri açıkça göndererek kendi "son eklenen 6 mimar" beklentisini korur (aksi halde sort
    // parametresiz istekler artık popülerlik sıralı döneceğinden carousel sessizce bozulurdu).
    // Faz 4A — Projection Optimization: kart listesi yalnızca aşağıdaki alanları render eder (bkz.
    // aşağıdaki pool.map) — about/school/dept/profession/awards gibi yalnızca tekil profil
    // sayfasında (buildArchitectPayload, a.* ile ayrı okunur) gereken kolonlar bu listeye dahil
    // edilmiyor. project_count — idx_project_designers_architect indeksi üzerinden ucuz bir
    // correlated subquery (bkz. migrations/0022_id_first_entities.sql) — yalnızca DOĞRUDAN o mimara
    // atanmış projeler sayılır (ofisi üzerinden ilişkili olduğu projeler DEĞİL; mimar-detay.html'deki
    // relatedProjects'in aksine, popülerlik burada kişisel proje sayısını yansıtır).
    // gerçek bulgu: bu sorgu (JOIN + satır başı correlated subquery) ve aşağıdaki .map() dönüşümü
    // önceden HER istekte (filtre/sort/sayfa fark etmeksizin) yeniden çalışıyordu — sidebar sayaçları
    // (dob/award/position) TÜM havuzdan hesaplandığından project.js#fetchProjectListPageFromD1'deki
    // D1 LIMIT/OFFSET deseni burada uygulanamaz (bkz. publicCache.js#getCachedPool dosya başı
    // yorumu). Bunun yerine ham sorgu+şekillendirme sonucu (pool) KV'de önbelleklenir — farklı sayfa/
    // sort/filtre kombinasyonları (farklı TAM URL, farklı caches.default anahtarı) AYNI pool'u
    // paylaşır. Filtre/sıralama mantığı (aşağısı) DEĞİŞMEDİ, hâlâ her istekte JS'te çalışır.
    const pool = await getCachedPool(env, 'architects', async () => {
      const { results } = await env.DB.prepare(
        `SELECT a.id, a.slug, a.name, a.dob, a.photo_url, a.position, o.name AS office_name, o.awards AS office_awards,
           (SELECT COUNT(*) FROM project_designers pd JOIN projects p ON p.id = pd.project_id
            WHERE pd.architect_id = a.id AND p.deleted_at IS NULL AND p.hidden_at IS NULL) AS project_count
         FROM architects a LEFT JOIN offices o ON o.id = a.office_id AND o.deleted_at IS NULL
         WHERE a.deleted_at IS NULL AND a.hidden_at IS NULL ORDER BY a.id DESC`
      ).all();

      return results.map(row => {
        const a = parseCanonicalRow('architects', row);
        let officeAwards = [];
        if (row.office_awards) { try { officeAwards = JSON.parse(row.office_awards) || []; } catch { officeAwards = []; } }
        // positionRaw: mimar.html kartında ofis yoksa gösterilen alt-etiket (eski data.js#a.status
        // fallback'inin karşılığı) — bucketed `position` (bkz. positionOf) filtre eşleştirme için,
        // ham metin ise kart altyazısı için ayrı tutulur.
        return { slug: a.slug, name: a.name, dob: a.dob, photo: a.photo_url, office: row.office_name || null, position: positionOf(a.position), positionRaw: a.position || null, officeAwards, projectCount: row.project_count || 0, badges: [] };
      });
    });

    function passes(a) {
      if (dobParam && String(a.dob) !== dobParam) return false;
      if (awardParam && !a.officeAwards.includes(awardParam)) return false;
      if (positionParam && a.position !== positionParam) return false;
      if (searchQuery && !foldTr(a.name).includes(searchQuery)) return false;
      return true;
    }

    const filtered = pool.filter(passes);

    // sort boşsa (varsayılan) ya da 'popular' ise en çok projesi olan mimar önce gelir, eşitlikte
    // isim A-Z (bkz. yukarıdaki "Varsayılan sıralama" notu). 'newest' — id DESC — anasayfa
    // carousel'inin AÇIKÇA istediği eski varsayılan davranış.
    filtered.sort((x, y) => {
      switch (sort) {
        case 'name_asc': return x.name.localeCompare(y.name, 'tr');
        case 'year_desc': return (y.dob || 0) - (x.dob || 0);
        case 'year_asc': return (x.dob || 9999) - (y.dob || 9999);
        case 'newest': return 0; // pool zaten id DESC ile geldi, ek bir JS sıralaması gerekmiyor
        case 'popular':
        default:
          return (y.projectCount - x.projectCount) || x.name.localeCompare(y.name, 'tr');
      }
    });

    // mimar.html#populateFilters — sayaçlar aktif filtrelerden BAĞIMSIZ, tüm havuz üzerinden
    // (proje.html'deki bağımlı/faceted sayaçların aksine; mimar.html'de zaten hiç öyle çalışmıyordu).
    const dobCounts = {}, awardCounts = {}, positionCounts = {};
    pool.forEach(a => {
      if (a.dob) dobCounts[a.dob] = (dobCounts[a.dob] || 0) + 1;
      a.officeAwards.forEach(award => { awardCounts[award] = (awardCounts[award] || 0) + 1; });
      if (a.position) positionCounts[a.position] = (positionCounts[a.position] || 0) + 1;
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (Math.min(page, totalPages) - 1) * limit;
    const items = filtered.slice(start, start + limit).map(({ officeAwards, projectCount, ...rest }) => rest);

    return {
      items: serializePublicEntity(items), total, page: Math.min(page, totalPages), totalPages,
      filters: {
        dob: Object.keys(dobCounts).sort((x, y) => y - x).map(v => ({ value: v, count: dobCounts[v] })),
        award: Object.keys(awardCounts).sort((x, y) => awardCounts[y] - awardCounts[x] || x.localeCompare(y, 'tr')).map(v => ({ value: v, count: awardCounts[v] })),
        position: positionCounts,
      },
    };
  }, () => architectListFingerprint(env));
}

// Faz 4B — Conditional Requests: yukarıdaki tam liste sorgusundan (JOIN + JS filtre/sırala/sayfala)
// çok daha ucuz bir "içerik değişti mi" özeti — bkz. src/lib/publicCache.js#cachedPublicJson
// listFingerprint parametresi.
function architectListFingerprint(env) {
  return env.DB.prepare(
    `SELECT COUNT(*) AS cnt, MAX(updated_at) AS latest FROM architects WHERE deleted_at IS NULL AND hidden_at IS NULL`
  ).first().then(row => `${row?.cnt ?? 0}:${row?.latest ?? ''}`);
}

// GET /api/architect/:key — mimar-detay.html'nin TEK istekte aldığı birleşik yanıt. Dönen şekil:
// { item, office, colleagues, relatedProjects, hidden } — eski overlay tabanlı sürümle BİREBİR aynı.
export async function handleArchitectRoute(request, env, url, rawKey) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  const key = decodeURIComponent(rawKey || '');
  if (!key) return errorJson('Geçersiz istek.');

  return cachedPublicJson(request, env, url.pathname, () => buildArchitectPayload(env, key));
}

// Mimar Ekle formundaki Firma alanına yazılıp offices tablosunda karşılığı bulunamadığı için
// office_id/office_founders'a hiç bağlanamamış (bkz. src/lib/canonicalSync.js#syncArchitect —
// eşleşmeyen isim officeId=null bırakılır) firma adını/adlarını kurtarır — src/routes/office.js#
// fetchRawFounderNames ile AYNI desen. architect_submissions.office, founders'ın aksine JSON dizi
// değil virgülle ayrılmış DÜZ TEK bir string (bkz. src/lib/submissionTypes.js#architects.fields),
// bu yüzden canonicalSync.js#syncArchitect'teki AYNI split(',') burada da uygulanmalı — aksi halde
// "GEOMIM, GEO_ID" gibi çok firmalı bir giriş, hiçbir canonical isimle eşleşmeyen TEK bir sahte
// "unregistered" firma olarak (gerçek bulgu: her iki firma da zaten kayıtlıyken bile) render edilir.
async function fetchRawOfficeNames(env, a) {
  const submissionId = (a.legacy_key || '').startsWith('submission:') ? a.legacy_key.slice('submission:'.length) : '';
  const row = await env.DB.prepare(
    `SELECT office FROM architect_submissions WHERE claimed_profile_key = ?1 OR claimed_profile_key = ?2 OR id = ?3 ORDER BY updated_at DESC LIMIT 1`
  ).bind(a.name, a.legacy_key || '', submissionId).first();
  if (!row || !row.office) return [];
  return row.office.split(',').map(s => s.trim()).filter(Boolean);
}

// Önceki/Sonraki Mimar — bkz. src/routes/project.js#fetchAdjacentProject'teki AYNI dairesel/sıralı
// id-tabanlı desen (kullanıcı isteği: proje.html'deki gezinme yapısının birebir aynısı mimar/firma/
// ürün pop-up'larına da eklensin).
async function fetchAdjacentArchitect(env, id) {
  const where = `deleted_at IS NULL AND hidden_at IS NULL`;
  let prev = await env.DB.prepare(`SELECT id, slug, name, photo_url FROM architects WHERE ${where} AND id < ? ORDER BY id DESC LIMIT 1`).bind(id).first();
  let next = await env.DB.prepare(`SELECT id, slug, name, photo_url FROM architects WHERE ${where} AND id > ? ORDER BY id ASC LIMIT 1`).bind(id).first();
  if (!prev) prev = await env.DB.prepare(`SELECT id, slug, name, photo_url FROM architects WHERE ${where} ORDER BY id DESC LIMIT 1`).first();
  if (!next) next = await env.DB.prepare(`SELECT id, slug, name, photo_url FROM architects WHERE ${where} ORDER BY id ASC LIMIT 1`).first();
  if (prev && prev.id === id) prev = null;
  if (next && next.id === id) next = null;
  return {
    prevItem: prev ? { slug: prev.slug, title: prev.name, image: prev.photo_url || null } : null,
    nextItem: next ? { slug: next.slug, title: next.name, image: next.photo_url || null } : null,
  };
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
  // gerçek bulgu (denetim raporu): findArchitect yalnızca deleted_at IS NULL filtreliyor, hidden_at'a
  // hiç bakmıyor — bu uç gizlenmiş bir mimarın TAM verisini `hidden:true` bayrağıyla birlikte ama
  // item NULL'lanmadan döndürüyordu. Client-side (architect-modal.js) bayrağı kontrol edip
  // "bulunamadı" gösteriyor, ama /api/architect/:key'i doğrudan çağıran biri tam veriyi alabiliyordu
  // — src/routes/project.js#handleProjectDetailRoute'un AYNI durumda zaten yaptığı gibi item burada
  // da null'lanır.
  if (row.hidden_at) return { item: null, hidden: true };
  const a = parseCanonicalRow('architects', row);

  const officeRow = a.office_id
    ? await env.DB.prepare(`SELECT * FROM offices WHERE id = ? AND deleted_at IS NULL AND hidden_at IS NULL`).bind(a.office_id).first()
    : null;
  const office = officeRow ? parseCanonicalRow('offices', officeRow) : null;

  // Mimarın kurucu/ortak olduğu TÜM firmalar — yalnızca kendi office_id'siyle bağlı olduğu firma
  // değil, office_founders join tablosundaki TÜM bağlantılar (bkz. gerçek bulgu: Han Tümertekin'in
  // profilinde "Pozisyon: Kurucu" yazmasına rağmen office_id'si boş olduğundan, yalnızca office_id
  // okunsaydı Tümertekin Architects hiç görünmezdi — firma tarafında Kurucular listesine eklenerek
  // office_founders'a bağlanmış olsa bile). Tekilleştirilmiş, office_id'deki varsa önce o sırayla.
  const { results: founderOfficeRows } = await env.DB.prepare(
    `SELECT o.* FROM office_founders f JOIN offices o ON o.id = f.office_id
     WHERE f.architect_id = ? AND o.deleted_at IS NULL AND o.hidden_at IS NULL`
  ).bind(a.id).all();
  const officesById = new Map();
  if (office) officesById.set(office.id, office);
  for (const row of founderOfficeRows) {
    const parsed = parseCanonicalRow('offices', row);
    if (!officesById.has(parsed.id)) officesById.set(parsed.id, parsed);
  }
  const offices = [...officesById.values()];

  const rawOfficeNames = await fetchRawOfficeNames(env, a);
  const knownOfficeNames = new Set(offices.map(o => trLower(o.name)));
  const unregisteredOffices = [];
  for (const name of rawOfficeNames) {
    if (!name || knownOfficeNames.has(trLower(name))) continue;
    knownOfficeNames.add(trLower(name));
    unregisteredOffices.push({ name, unregistered: true });
  }

  const [colleaguesRes, relatedRes] = await Promise.all([
    office
      ? env.DB.prepare(
          `SELECT ar.* FROM office_founders f JOIN architects ar ON ar.id = f.architect_id
           WHERE f.office_id = ? AND ar.deleted_at IS NULL AND ar.hidden_at IS NULL AND ar.id != ?`
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

  const item = {
    name: a.name, dob: a.dob, school: a.school, dept: a.dept, profession: a.profession,
    role: a.position, awards: a.awards, about: a.about, photo: a.photo_url, office: office ? office.name : null,
    social_links: a.social_links || [],
    badges: [],
  };
  // bkz. src/routes/office.js#buildOfficePayload'daki AYNI _claimKey gerekçesi — renderProfileEditButton'ın
  // "claim=" linki HER ZAMAN orijinal statik anahtarı (legacy_key) kullanmalı, a.name bir yeniden
  // adlandırmadan sonra değişmiş olabilir. Aksi halde mimar-ekle.html'in ?claim= prefill'i eski
  // claimed_profile_key ile eşleşmez, PATCH yerine POST'a düşer ve mükerrer bir architect_submissions/
  // canonical satır oluşur (gerçek bulgu: bu, ofis tarafında zaten önlenmişken mimar tarafında eksikti).
  const isSubmissionMarker = typeof a.legacy_key === 'string' && a.legacy_key.startsWith('submission:');
  if (a.legacy_key && !isSubmissionMarker && a.legacy_key !== a.name) item._claimKey = a.legacy_key;

  const adjacent = await fetchAdjacentArchitect(env, a.id);

  return {
    item,
    office: office ? { name: office.name, loc: office.loc, cats: office.cats, yil: office.yil, logo: office.logo_url, badges: [] } : null,
    offices: [
      ...offices.map(o => ({ name: o.name, loc: o.loc, cats: o.cats, yil: o.yil, logo: o.logo_url, badges: [] })),
      ...unregisteredOffices,
    ],
    colleagues,
    relatedProjects,
    prevItem: adjacent.prevItem,
    nextItem: adjacent.nextItem,
    hidden: !!a.hidden_at,
  };
}

// PATCH /api/profile/office — kullanıcının sahiplendiği (approved) mimar profilinin GÖRÜNEN
// firmasını (architects.office_id) değiştirir, ama yalnızca office_founders'ta zaten "ortak/kurucu"
// olarak bağlı olduğu firmalar arasında (bkz. buildArchitectPayload'daki AYNI office_founders
// sorgusu, mimar-detay sayfasındaki "kurucu/ortak olduğu firmalar" listesiyle birebir aynı kaynak).
// Rastgele bir firma adı YAZILAMAZ, yalnızca zaten bağlı olduğu firmalardan biri seçilebilir ya da
// boş bırakılıp firma bağlantısı kaldırılabilir. Not: js/components/auth-modal.js "Profili Düzenle"
// içindeki Firma kutusu bunu ÇAĞIRMIYOR — o kutu artık POST /api/claims ile "Bu firma sana mı ait?"
// kutusuyla AYNI profile_claims('office') admin-onay talebini oluşturuyor (bkz. kullanıcı isteği:
// "iki talep de admin panelinde onaya sunulsun"); bu route başka bir istemci ihtiyacı için canlı
// bırakıldı, mevcut mimar-detay davranışını (architects.office_id) etkilemeye devam ediyor.
export async function handleArchitectPrimaryOfficeRoute(request, env, url) {
  if (url.pathname !== '/api/profile/office' || request.method !== 'PATCH') return errorJson('Bulunamadı', 404);
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  const claim = await env.DB.prepare(
    `SELECT profile_key FROM profile_claims WHERE user_id = ? AND profile_type = 'architect' AND status = 'approved' LIMIT 1`
  ).bind(user.id).first();
  if (!claim) return errorJson('Önce bir mimar profili sahiplenmen gerekiyor.', 403);

  const architect = await findArchitect(env, claim.profile_key);
  if (!architect) return errorJson('Mimar profili bulunamadı.', 404);

  const body = await readJson(request);
  const officeName = (body.office || '').trim();

  if (!officeName) {
    await env.DB.prepare(`UPDATE architects SET office_id = NULL, updated_at = datetime('now') WHERE id = ?`).bind(architect.id).run();
  } else {
    const officeRow = await env.DB.prepare(
      `SELECT o.id FROM office_founders f JOIN offices o ON o.id = f.office_id
       WHERE f.architect_id = ? AND o.name = ? AND o.deleted_at IS NULL LIMIT 1`
    ).bind(architect.id, officeName).first();
    if (!officeRow) return errorJson('Yalnızca ortağı olduğun bir firmayı seçebilirsin.');
    await env.DB.prepare(`UPDATE architects SET office_id = ?, updated_at = datetime('now') WHERE id = ?`).bind(officeRow.id, architect.id).run();
  }

  await purgeSsrDetailCache('architect', architect.slug);
  if (architect.legacy_key && architect.legacy_key !== architect.slug) await purgeSsrDetailCache('architect', architect.legacy_key);
  return json({ ok: true });
}
