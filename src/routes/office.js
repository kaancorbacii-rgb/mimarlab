import { errorJson } from '../lib/http.js';
import { slugify } from '../lib/slugify.js';
import { cachedPublicJson, getCachedPool, getCachedFingerprint } from '../lib/publicCache.js';
import { parseCanonicalRow } from '../lib/canonicalRead.js';
import { serializePublicEntity } from '../lib/serializePublicEntity.js';
import { resolveSlugRedirect } from '../lib/slugRedirects.js';
import { fetchAdjacentEntity } from '../lib/adjacentEntity.js';
// bkz. src/routes/product.js'teki AYNI CJS-interop yorumu — canonical veri DEĞİL, salt statik bir
// sınıflandırma referansı (hangi hizmet alanı firmaya, hangisi markaya ait).
import officeKindJs from '../../office-kind.js';

const { isBrandOffice, isPureBrandOffice, officeCatList, OFFICE_SERVICE_CATS, BRAND_CATS, LEGACY_BRAND_CAT } = officeKindJs;
const OFFICE_SERVICE_CAT_SET = new Set(OFFICE_SERVICE_CATS);
const BRAND_CAT_SET = new Set([...BRAND_CATS, LEGACY_BRAND_CAT]);

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

// trLower Türkçe BÜYÜK->küçük eşlemesini doğru yapar ama bu yüzden ASCII "I" (ör. Türkçe olmayan/
// ALL-CAPS yazılmış isimlerde) noktasız 'ı'ya döner — kullanıcı normal klavyeyle (düz 'i' ile)
// yazdığında eşleşme kaçırılabiliyordu (bkz. src/routes/project.js#foldTr'deki AYNI gerçek bulgu/
// gerekçe — SANKAI proje arama hatası). Sorgu VE hedef metin AYNI foldTr'den geçirilir.
function foldTr(s) {
  return trLower(s).replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o');
}

// src/routes/project.js#parseProjectDateYear ile AYNI serbest-metin project_date ayrıştırma
// mantığı — firma popup'ındaki "Projeler" kartlarını en yeniden en eskiye sıralamak için burada
// da gerekiyor (bkz. kullanıcı isteği: popup'taki proje kartları soldan sağa en son tasarlanandan
// en eskiye doğru dizilsin, src/routes/architect.js'teki AYNI mantık).
function parseProjectDateYear(dateStr) {
  if (!dateStr) return null;
  const hasCenturyWordAnywhere = /yuzyil|\byy\b/.test(foldTr(dateStr));
  let best = null;
  for (const rawSegment of String(dateStr).split('/')) {
    const folded = foldTr(rawSegment);
    const isBC = /\bmo\b/.test(folded);
    const isCenturyFragment = hasCenturyWordAnywhere && /^\s*(ms\s*)?\d{1,2}\.\s*$/.test(folded);
    const isCentury = isCenturyFragment || /yuzyil|\byy\b/.test(folded);
    const nums = (rawSegment.match(/\d+/g) || []).map(n => parseInt(n, 10));
    if (!nums.length) continue;
    let year;
    if (isCentury) {
      const century = isBC ? Math.max(...nums) : Math.min(...nums);
      year = isBC ? -(century * 100) : (century - 1) * 100 + 1;
    } else {
      const magnitude = isBC ? Math.max(...nums) : Math.min(...nums);
      year = isBC ? -magnitude : magnitude;
    }
    if (best === null || year < best) best = year;
  }
  return best;
}

// GET /api/offices/search?q=... — src/routes/architect.js#handleArchitectSearchRoute'un firma
// karşılığı; proje-ekle.html'deki Firma/Marka autocomplete kutularının canlı D1 sorgusu. Türkçe
// harf duyarlılığı için SQL LIKE yerine tüm adaylar çekilip foldTr ile JS tarafında filtrelenir
// (tablo küçük olduğundan, bkz. findOffice'teki AYNI tam-tarama gerekçesi).
export async function handleOfficeSearchRoute(request, env, url) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    const q = foldTr((url.searchParams.get('q') || '').trim());
    // D1 audit (2026-08-25) P1-6 — bkz. product.js#handleProductSearchRoute'taki AYNI gerekçe.
    if (!q || q.length < 2) return { items: [] };
    const { results } = await env.DB.prepare(
      `SELECT name, loc FROM offices WHERE deleted_at IS NULL AND hidden_at IS NULL ORDER BY name`
    ).all();
    const items = results.filter(r => foldTr(r.name).includes(q)).slice(0, 20).map(r => ({ label: r.name, sub: r.loc || '' }));
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

// GET /api/offices — firma.html#render()'ın sayfalanmış sunucu karşılığı (bkz. src/routes/
// architect.js#handleArchitectListRoute'daki AYNI desen).
export async function handleOfficeListRoute(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorJson('Bulunamadı', 404);

  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
    const limit = Math.min(96, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 24));
    const sort = url.searchParams.get('sort') || '';
    const locParam = url.searchParams.get('loc') || '';
    const catParam = url.searchParams.get('cat') || '';
    const expParam = url.searchParams.get('exp') || '';
    const searchQuery = foldTr((url.searchParams.get('search') || '').trim());
    // ?brands=1 — marka.html (kullanıcı isteği, 2026-08-31: "FİRMA sayfasının aynısını kopyala ve
    // ismini MARKA koy. Bu sayfada üretici ürün firmaları yayınlanacak"). Havuz AYNI (tek bir
    // 'offices' KV havuzu, iki sayfa için iki ayrı sorgu yok); yalnızca kataloğunda en az bir
    // ürün/malzeme bulunan firmalar (product_count > 0, bkz. aşağıdaki alt sorgu) geçirilir. firma.html
    // bu parametreyi HİÇ göndermediğinden davranışı bit-bit aynı kalır.
    const brandsOnly = url.searchParams.get('brands') === '1';

    // Varsayılan sıralama artık "en popüler" (en çok projesi olan firma önce) — bkz. kullanıcı
    // isteği: "Default Popularity-Based Sorting". ?sort=newest EXPLICIT olarak eski "son eklenen
    // ilk" (id DESC) davranışını korur — anasayfa Firma carousel'i (bkz. index.html) artık bu
    // değeri açıkça göndererek kendi "son eklenen 6 firma" beklentisini korur (bkz. src/routes/
    // architect.js#handleArchitectListRoute'daki AYNI gerekçe).
    // Faz 4A — Projection Optimization: kart listesi yalnızca aşağıdaki alanları render eder (bkz.
    // aşağıdaki pool.map) — about/awards gibi yalnızca tekil profil sayfasında (buildOfficePayload,
    // burada dokunulmayan ayrı bir sorgu) gereken kolonlar bu listeye dahil edilmiyor. project_count
    // — idx_project_designers_office indeksi üzerinden ucuz bir correlated subquery (bkz. src/routes/
    // architect.js#handleArchitectListRoute'daki AYNI desen).
    // gerçek bulgu: bkz. src/routes/architect.js#handleArchitectListRoute'daki AYNI gerekçe/desen —
    // sidebar sayaçları (loc/cat) TÜM havuzdan hesaplandığından D1 LIMIT/OFFSET burada işe yaramaz,
    // bunun yerine ham sorgu+şekillendirme sonucu KV'de önbelleklenir (bkz. publicCache.js#
    // getCachedPool). Filtre/sıralama mantığı DEĞİŞMEDİ.
    const pool = await getCachedPool(env, 'offices', async () => {
      const { results } = await env.DB.prepare(
        `SELECT o.slug, o.name, o.loc, o.cats, o.yil, o.website, o.logo_url,
           (SELECT COUNT(*) FROM project_designers pd JOIN projects p ON p.id = pd.project_id
            WHERE pd.office_id = o.id AND p.deleted_at IS NULL AND p.hidden_at IS NULL) AS project_count,
           (SELECT COUNT(*) FROM products pr WHERE pr.deleted_at IS NULL AND pr.hidden_at IS NULL
            AND (pr.brand_office_id = o.id OR pr.brand_name_raw = o.name COLLATE NOCASE)) AS product_count
         FROM offices o WHERE o.deleted_at IS NULL AND o.hidden_at IS NULL ORDER BY o.id DESC`
      ).all();
      return results.map(row => {
        const o = parseCanonicalRow('offices', row);
        // gerçek bulgu: bazı üye gönderisi kökenli ofislerde `cats` bir dizi olarak (JSON.stringify(["a · b"]))
        // yazılmış, statik/legacy kayıtlarda ise düz string ("a · b") — parseCanonicalRow ikisini de
        // olduğu gibi döner (bkz. o dosyadaki JSON_FIELDS notu). firma.html'in her yerde beklediği
        // düz " · "-ayrımlı string biçimine burada TEK noktadan normalize edilir. Yalnızca dizi/string
        // değil (bkz. gerçek bulgu: bir kayıtta cats JSON.parse sonrası ne dizi ne string bir değere
        // çözülmüştü, `(o.cats || '').split` TypeError fırlatıyordu) — typeof kontrolü her ihtimalde
        // (sayı/boolean/obje) güvenli bir düz metne düşer.
        const cats = Array.isArray(o.cats) ? o.cats.join(' · ') : (typeof o.cats === 'string' ? o.cats : '');
        // productCount — ?brands=1 (marka.html) filtresinin tek kaynağı; buildOfficePayload'daki
        // brandProductsRes ile AYNI eşleşme kuralı (brand_office_id VEYA marka adı), böylece "Marka
        // sayfasında görünen firma"nın popup'ında mutlaka dolu bir "Ürünler" bölümü olur.
        return { slug: o.slug, name: o.name, loc: o.loc, cats, yil: o.yil, website: o.website, logo: o.logo_url, projectCount: row.project_count || 0, productCount: row.product_count || 0, badges: [] };
      });
    });

    // FİRMA/MARKA ayrımı — bkz. office-kind.js dosya başı yorumu. brandsOnly (marka.html) marka
    // olan HER ofisi gösterir (Autoban gibi hem firma hem marka olanlar dahil); firma.html ise
    // yalnızca SAF markaları (hiçbir mimarlık hizmeti sunmayan üretici) dışlar.
    function passes(o) {
      if (brandsOnly) { if (!isBrandOffice(o.cats, o.productCount)) return false; }
      else if (isPureBrandOffice(o.cats, o.productCount)) return false;
      if (locParam && cityOf(o.loc) !== locParam) return false;
      if (catParam && !(o.cats || '').includes(catParam)) return false;
      if (expParam && expBucketOf(o.yil) !== expParam) return false;
      if (searchQuery && !foldTr(o.name).includes(searchQuery)) return false;
      return true;
    }

    const filtered = pool.filter(passes);

    // sort boşsa (varsayılan) ya da 'popular' ise en çok projesi olan firma önce gelir, eşitlikte
    // isim A-Z (bkz. src/routes/architect.js#handleArchitectListRoute'daki AYNI desen). 'newest' —
    // id DESC — anasayfa carousel'inin AÇIKÇA istediği eski varsayılan davranış.
    filtered.sort((a, b) => {
      switch (sort) {
        case 'name_asc': return a.name.localeCompare(b.name, 'tr');
        case 'year_desc': return (b.yil || 0) - (a.yil || 0);
        case 'year_asc': return (a.yil || 9999) - (b.yil || 9999);
        case 'newest': return 0; // pool zaten id DESC ile geldi, ek bir JS sıralaması gerekmiyor
        case 'popular':
        default:
          return (b.projectCount - a.projectCount) || a.name.localeCompare(b.name, 'tr');
      }
    });

    // firma.html#populateFilters — sayaçlar tüm havuz üzerinden, aktif filtrelerden bağımsız
    // (mimar.html#handleArchitectListRoute'daki AYNI gerekçe). Türkiye tek başına bir konum
    // seçeneği olarak listelenmez (bkz. firma.html#populateFilters'daki AYNI `city === 'Türkiye'` atlama).
    const locCounts = {}, catCounts = {};
    // Sayaçlar da sayfanın KENDİ havuzundan hesaplanır — aksi halde marka.html'in kenar çubuğu o
    // sayfada hiç listelenmeyen firmaları, firma.html'inki ise oradan çıkarılmış saf markaları
    // içeren sayılar gösterirdi. Hizmet Alanı seçenekleri ayrıca sayfaya AİT kümeye göre süzülür
    // (kullanıcı isteği: "Firma sayfasındaki filtrelerdeki ürün seçeneğini kaldır") — saf markalar
    // zaten havuzdan düştüğü için 'Ürün' pratikte hiç sayılmaz, ama bu süzgeç ileride 'Mimarlık ·
    // Ürün' gibi karma bir kayıt oluşsa bile firma filtresine marka kategorisi sızdırmaz.
    const countPool = pool.filter(o => (brandsOnly
      ? isBrandOffice(o.cats, o.productCount)
      : !isPureBrandOffice(o.cats, o.productCount)));
    const allowedCatSet = brandsOnly ? BRAND_CAT_SET : OFFICE_SERVICE_CAT_SET;
    countPool.forEach(o => {
      const city = cityOf(o.loc);
      if (city && city !== 'Türkiye') locCounts[city] = (locCounts[city] || 0) + 1;
      officeCatList(o.cats).forEach(cat => {
        if (!allowedCatSet.has(cat)) return;
        catCounts[cat] = (catCounts[cat] || 0) + 1;
      });
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (Math.min(page, totalPages) - 1) * limit;
    const items = filtered.slice(start, start + limit).map(({ projectCount, productCount, ...rest }) => rest);

    return {
      items: serializePublicEntity(items), total, page: Math.min(page, totalPages), totalPages,
      filters: {
        loc: Object.keys(locCounts).sort((a, b) => locCounts[b] - locCounts[a] || a.localeCompare(b, 'tr')).map(v => ({ value: v, count: locCounts[v] })),
        cat: Object.keys(catCounts).sort((a, b) => catCounts[b] - catCounts[a] || a.localeCompare(b, 'tr')).map(v => ({ value: v, count: catCounts[v] })),
      },
    };
  }, () => officeListFingerprint(env));
}

// Faz 4B — Conditional Requests: bkz. src/routes/architect.js#architectListFingerprint'teki AYNI
// desen.
// D1 audit (2026-08-25) P0-3 — bkz. project.js#projectListFingerprint'teki AYNI gerekçe.
function officeListFingerprint(env) {
  return getCachedFingerprint(env, 'offices', () => env.DB.prepare(
    `SELECT COUNT(*) AS cnt, MAX(updated_at) AS latest FROM offices WHERE deleted_at IS NULL AND hidden_at IS NULL`
  ).first().then(row => `${row?.cnt ?? 0}:${row?.latest ?? ''}`));
}

// GET /api/office/:key — ofis-detay.html'nin TEK istekte aldığı birleşik yanıt. Dönen şekil:
// { item, founders, team, relatedProjects, hidden } — `team` (bkz. kullanıcı isteği: "Ekip kısmı"),
// onaylı profile_claims('office') sahibi olup pozisyonu Kurucu/Kurucu Ortak OLMAYAN kullanıcılar.
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

// firma-ekle.html'deki opsiyonel "Ekip" kutusu (bkz. migrations/0048_office_team.sql, kullanıcı
// isteği) — fetchRawFounderNames ile AYNI desen, ama office_founders'a hiç bağlanmaz (bu kişiler
// kurucu/ortak DEĞİL, sadece firmada çalışabilecek serbest bir isim listesi).
async function fetchRawTeamNames(env, o) {
  const submissionId = (o.legacy_key || '').startsWith('submission:') ? o.legacy_key.slice('submission:'.length) : '';
  const row = await env.DB.prepare(
    `SELECT team FROM office_submissions WHERE claimed_profile_key = ?1 OR claimed_profile_key = ?2 OR id = ?3 ORDER BY updated_at DESC LIMIT 1`
  ).bind(o.name, o.legacy_key || '', submissionId).first();
  if (!row || !row.team) return [];
  try { return JSON.parse(row.team) || []; } catch { return []; }
}

// Önceki/Sonraki Firma — bkz. src/routes/architect.js#fetchAdjacentArchitect'teki AYNI desen.
async function fetchAdjacentOffice(env, id) {
  const { prev, next } = await fetchAdjacentEntity(env, 'offices', id, { titleCol: 'name', imageCol: 'logo_url' });
  return { prevItem: prev, nextItem: next };
}

async function buildOfficePayload(env, key) {
  let row = await findOffice(env, key);
  // Mükerrer kayıt birleştirmesi: satır gizlendiyse ama bu slug için kanonik bir kayda
  // slug_redirects girişi varsa (bkz. migrations/0041_slug_redirects.sql), gerçek "gizle"
  // (moderasyon) yerine burada sessizce kanonik kayda düş — eski slug/link "bulunamadı" göstermesin.
  if (row && row.hidden_at) {
    const newSlug = await resolveSlugRedirect(env, 'offices', row.slug);
    if (newSlug && newSlug !== row.slug) {
      const canonical = await env.DB.prepare(
        `SELECT * FROM offices WHERE slug = ? AND deleted_at IS NULL AND hidden_at IS NULL`
      ).bind(newSlug).first();
      if (canonical) row = canonical;
    }
  }
  // bkz. src/routes/architect.js#buildArchitectPayload'daki AYNI gerçek bulgu — silinmiş/eşleşmeyen
  // bir key için en düşük id'li ofisin profiline sessizce düşen fallback kaldırıldı.
  if (!row) return { item: null, founders: [], team: [], relatedProjects: [], relatedOffices: [], relatedProducts: [], relatedMaterials: [], projectProducts: [], relatedBrands: [], hidden: false };
  // gerçek bulgu (denetim raporu): satır yukarıdaki redirect-birleştirmeden SONRA hâlâ hidden_at
  // taşıyorsa (yani gerçekten gizli, yeniden adlandırma/birleştirme DEĞİL) bu uç item'ı yine de tam
  // olarak döndürüyordu — yalnızca `hidden:true` bayrağı ekleniyordu, veri gizlenmiyordu. Client-side
  // (office-modal.js) bu bayrağı kontrol edip "bulunamadı" gösteriyor, ama /api/office/:key'i
  // DOĞRUDAN çağıran biri gizlenmiş bir ofisin TAM verisini alabiliyordu — src/routes/project.js#
  // handleProjectDetailRoute'un AYNI durumda zaten yaptığı gibi item burada da null'lanır.
  if (row.hidden_at) return { item: null, founders: [], team: [], relatedProjects: [], relatedOffices: [], relatedProducts: [], relatedMaterials: [], projectProducts: [], relatedBrands: [], hidden: true };
  const o = parseCanonicalRow('offices', row);
  // MİMARLAB AI, Faz 2 — Knowledge Graph katmanı Firma↔Şehir ilişkisi (bkz. kullanıcı isteği:
  // Proje↔Mimar↔Firma↔Şehir↔Yıl↔Tipoloji↔Grup ilişkileri proje/mimar/firma sayfalarında yüzeye
  // çıkarılsın). cityOf() zaten firma.html'nin "Yer" filtresi için var olan AYNI "İl / İlçe" ayrıştırma
  // kuralı (bkz. dosya başı tanım) — yeni bir ayrıştırma mantığı EKLENMEDİ.
  const officeCity = cityOf(o.loc);

  const [foundersRes, relatedRes, relatedOfficesRes, brandProductsRes, projectProductsRes, relatedBrandsRes, rawFounderNames, teamClaimRows, rawTeamNames] = await Promise.all([
    env.DB.prepare(
      `SELECT ar.* FROM office_founders f JOIN architects ar ON ar.id = f.architect_id
       WHERE f.office_id = ? AND ar.deleted_at IS NULL AND ar.hidden_at IS NULL`
    ).bind(o.id).all(),
    env.DB.prepare(
      `SELECT DISTINCT p.* FROM project_designers pd JOIN projects p ON p.id = pd.project_id
       WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL AND pd.office_id = ?`
    ).bind(o.id).all(),
    // relatedOffices — bkz. yukarıdaki officeCity yorumu. loc = 'İl / İlçe' ya da bazen bare 'İl'
    // olarak saklandığından (bkz. cityOf()'un aynı iki durumu ele alması) hem tam eşleşme hem
    // 'İl / %' öneki eşleştirilir. officeCity boşsa (loc hiç girilmemiş) sorgu hiç çalıştırılmaz.
    // D1 audit (2026-08-25) P1-4 — `ORDER BY RANDOM()` (loc index'siz olduğundan zaten `SCAN
    // offices` gerektiren bu sorguda) canlıda doğrulandı: SQLite'ın RANDOM() için kurduğu geçici
    // b-tree sıralaması, ölçülen rows_read'i taban tablo satır sayısının (752) BİLE üzerine
    // çıkarıyordu (1209 rows_read/çağrı) — bkz. audit raporu D#1. Sıralama artık D1'de DEĞİL,
    // proje.js#handleProjectListRoute'taki `sort=random` dalıyla AYNI Fisher-Yates deseniyle
    // (kullanıcı isteği: mevcut yerleşik desen tekrar kullanılsın) Worker belleğinde yapılıyor —
    // WHERE koşulu/eşleşen kayıt kümesi DEĞİŞMEDİ, yalnızca "rastgele 12 tanesi" artık D1'e
    // sıralatılmıyor. LIMIT 50 — aynı şehirdeki firma sayısı make-sense bir üst sınırla
    // kısıtlanır (İstanbul gibi en kalabalık şehirde bile onlarca değil yüzlerce firma olması
    // beklenmez); şehir gerçekten 12'den azsa davranış AYNI (tüm eşleşenler döner).
    // cats/product_count da çekilir: aday listesi, PROFİLİN KENDİ türüne göre süzülür (bir markanın
    // popup'ında "Şehirdeki Diğer Markalar", bir firmanınkinde "Şehirdeki Diğer Firmalar", bkz.
    // kullanıcı isteği 2026-08-31 ve office-kind.js).
    officeCity ? env.DB.prepare(
      `SELECT o2.slug, o2.name, o2.loc, o2.cats, o2.logo_url, o2.website,
         (SELECT COUNT(*) FROM products pr WHERE pr.deleted_at IS NULL AND pr.hidden_at IS NULL
          AND (pr.brand_office_id = o2.id OR pr.brand_name_raw = o2.name COLLATE NOCASE)) AS product_count
       FROM offices o2
       WHERE o2.deleted_at IS NULL AND o2.hidden_at IS NULL AND o2.id != ? AND (o2.loc = ? OR o2.loc LIKE ?)
       LIMIT 50`
    ).bind(o.id, officeCity, officeCity + ' / %').all() : Promise.resolve({ results: [] }),
    // Ürün/malzeme markası olarak bu firmaya ait katalog — brand_office_id yalnızca onaylanan bir
    // gönderi üzerinden sync edilirken doldurulur (bkz. canonicalSync.js#syncProduct), toplu/legacy
    // eklenen satırlarda boş kalır; bu yüzden client-side tryOfficeChip'teki (product-modal.js) AYNI
    // isim eşleşmesi burada da kullanılır (brand_office_id VARSA o da OR ile kabul edilir, isim
    // değişse bile eski eşleşme kaybolmasın diye).
    env.DB.prepare(
      `SELECT * FROM products WHERE deleted_at IS NULL AND hidden_at IS NULL
       AND (brand_office_id = ? OR brand_name_raw = ? COLLATE NOCASE)
       ORDER BY title COLLATE NOCASE`
    ).bind(o.id, o.name).all(),
    // "Projelerde Kullanılan Ürünler" (kullanıcı isteği, 2026-08-31: "Projelerde kullanılan ürünler;
    // projenin sahibi mimarlık firması popupında da 'Projelerde Kullanılan Ürünler' kısmı açılarak
    // bu başlığın altında paylaşılsınlar") — yukarıdaki brandProductsRes'ten TAMAMEN AYRI bir küme:
    // o, firmanın KENDİ ürettiği katalog (brand_office_id/brand_name_raw eşleşmesi); bu ise firmanın
    // TASARLADIĞI projelerde KULLANILAN, başka markalara ait olabilen ürünler. Zincir:
    // project_designers (firma → proje) ⋈ project_products (proje → ürün, bkz. migrations/
    // 0072_product_project_links.sql — kenar hangi taraftan kurulmuş olursa olsun sayılır).
    env.DB.prepare(
      `SELECT DISTINCT pr.slug, pr.title, pr.brand_name_raw, pr.category, pr.kind, pr.images
       FROM project_designers pd
       JOIN projects p ON p.id = pd.project_id AND p.deleted_at IS NULL AND p.hidden_at IS NULL
       JOIN project_products pp ON pp.project_id = p.id
       JOIN products pr ON pr.id = pp.product_id AND pr.deleted_at IS NULL AND pr.hidden_at IS NULL
       WHERE pd.office_id = ?
       ORDER BY pr.title COLLATE NOCASE`
    ).bind(o.id).all(),
    // "İlgili Markalar" (kullanıcı isteği, 2026-08-31: "bir firma projelerinde hangi markaların
    // ürünlerini kullanmışsa firma popupında İlgili Markalar kısmında bu markalar sıralansın") —
    // yukarıdaki projectProducts zincirinin BİR HALKA DEVAMI: ürün → markası (offices). Ürün
    // satırının markası önce brand_office_id ile, o boşsa marka ADIYLA eşleştirilir (toplu/legacy
    // eklenen ürünlerde brand_office_id boş kalır, bkz. brandProductsRes'teki AYNI gerekçe).
    // used_count: o markanın ürünlerinden kaç tanesinin bu firmanın projelerinde kullanıldığı —
    // sıralama bununla yapılır, en çok tercih edilen marka başa gelir.
    env.DB.prepare(
      `SELECT b.slug, b.name, b.loc, b.logo_url, COUNT(DISTINCT pr.id) AS used_count
       FROM project_designers pd
       JOIN projects p ON p.id = pd.project_id AND p.deleted_at IS NULL AND p.hidden_at IS NULL
       JOIN project_products pp ON pp.project_id = p.id
       JOIN products pr ON pr.id = pp.product_id AND pr.deleted_at IS NULL AND pr.hidden_at IS NULL
       JOIN offices b ON b.deleted_at IS NULL AND b.hidden_at IS NULL
         AND (b.id = pr.brand_office_id OR (pr.brand_office_id IS NULL AND b.name = pr.brand_name_raw COLLATE NOCASE))
       WHERE pd.office_id = ? AND b.id != ?
       GROUP BY b.id
       ORDER BY used_count DESC, b.name COLLATE NOCASE`
    ).bind(o.id, o.id).all(),
    fetchRawFounderNames(env, o),
    // Kullanıcı hesabından "Profili Düzenle > Firma" ile ya da firma sayfasındaki "Bu firma sana mı
    // ait?" kutusundan gönderilip admin tarafından onaylanan profile_claims('office') satırları —
    // bkz. kullanıcı isteği: "Pozisyon ile firma danışıklı çalışan bir sistem olmalı". Pozisyonu
    // Kurucu/Kurucu Ortak olanlar aşağıda foundersFromClaims'e (Kurucular/Ortaklar'a karışır, isim
    // eşleşmesi office_founders'daki gibi bir architects kaydına dayanmadığından hep `unregistered`
    // rozet olarak render edilir), diğerleri Ekip'e (team) düşer.
    env.DB.prepare(
      `SELECT u.name, u.position, u.photo_url FROM profile_claims c JOIN users u ON u.id = c.user_id
       WHERE c.profile_type = 'office' AND c.profile_key = ? AND c.status = 'approved'
       ORDER BY u.name COLLATE NOCASE ASC`
    ).bind(o.name).all(),
    fetchRawTeamNames(env, o),
  ]);

  const founders = foundersRes.results.map(x => ({ name: x.name, role: x.position, photo: x.photo_url, badges: [] }));
  const knownFounderNames = new Set(founders.map(f => trLower(f.name)));
  for (const name of rawFounderNames) {
    if (!name || knownFounderNames.has(trLower(name))) continue;
    knownFounderNames.add(trLower(name));
    founders.push({ name, role: null, photo: null, badges: [], unregistered: true });
  }
  const FOUNDER_POSITIONS = new Set(['Kurucu', 'Kurucu Ortak']);
  const team = [];
  for (const row of teamClaimRows.results || []) {
    if (!row.name || knownFounderNames.has(trLower(row.name))) continue;
    if (FOUNDER_POSITIONS.has(row.position)) {
      knownFounderNames.add(trLower(row.name));
      founders.push({ name: row.name, role: row.position, photo: null, badges: [], unregistered: true });
    } else {
      team.push({ name: row.name, role: row.position || null, photo: row.photo_url || null });
    }
  }
  // firma-ekle.html'deki opsiyonel "Ekip" kutusuna serbest metin girilen isimler — foundersFromClaims
  // ile AYNI dedup (kurucu ya da hesap üzerinden zaten eklenmiş biriyle çakışan isim atlanır).
  const knownTeamNames = new Set(team.map(t => trLower(t.name)));
  for (const name of rawTeamNames) {
    if (!name || knownFounderNames.has(trLower(name)) || knownTeamNames.has(trLower(name))) continue;
    knownTeamNames.add(trLower(name));
    team.push({ name, role: null, photo: null });
  }
  // En yeniden en eskiye sırala (bkz. src/routes/project.js#date_desc AYNI "tarihi çözülemeyen
  // sona düşer" davranışı) — kullanıcı isteği: popup'taki proje kartları soldan sağa en son
  // tasarlanandan en eskiye doğru dizilsin.
  const relatedProjects = relatedRes.results
    .map(p => {
      const parsed = parseCanonicalRow('projects', p);
      return { slug: parsed.slug, title: parsed.title, images: parsed.images, category: parsed.category, lat: parsed.lat, lng: parsed.lng, _year: parseProjectDateYear(p.project_date) };
    })
    .sort((a, b) => {
      if (a._year == null && b._year == null) return 0;
      if (a._year == null) return 1;
      if (b._year == null) return -1;
      return b._year - a._year;
    })
    .map(({ _year, ...rest }) => rest);
  // Bu profil bir MARKA mı? (bkz. office-kind.js) — yalnızca hiçbir mimarlık hizmeti sunmayan saf
  // üreticiler için true. Popup'taki başlıkları ("Şehirdeki Diğer Markalar"), claim kutusunun
  // metnini ("Bu marka sana mı ait?") ve Düzenle bağlantısının hedefini (marka-ekle.html) bu belirler
  // — Autoban gibi hem mimarlık yapıp hem ürün tasarlayan firmalar FİRMA kimliğini korur.
  const isBrand = isPureBrandOffice(o.cats, brandProductsRes.results.length);

  // D1 audit (2026-08-25) P1-4 — yukarıdaki sorgu artık ORDER BY RANDOM() içermiyor, bkz. o
  // yorum: eşleşen kayıtlar (en fazla 50) burada Fisher-Yates ile karıştırılıp ilk 12'si alınır —
  // "her açılışta farklı 12 firma" davranışı DEĞİŞMEDİ, yalnızca karıştırma D1'den JS'e taşındı.
  const shuffledOffices = [...relatedOfficesRes.results];
  for (let i = shuffledOffices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledOffices[i], shuffledOffices[j]] = [shuffledOffices[j], shuffledOffices[i]];
  }
  // Aday listesi profilin KENDİ türüne göre süzülür: bir marka popup'ında yalnızca markalar
  // ("Şehirdeki Diğer Markalar"), bir firma popup'ında saf markalar hariç firmalar (bkz.
  // office-kind.js, kullanıcı isteği 2026-08-31). Süzme KARIŞTIRMADAN ÖNCE yapılır ki "rastgele 10"
  // her zaman doğru türden 10 kayıt olsun.
  // GERÇEK BULGU: `r.cats` burada HAM sütun değeridir — offices.cats JSON olarak saklanır
  // ('"Mimarlık · İç Mimarlık"' ya da '["Mobilya"]'), bu yüzden parseCanonicalRow'dan geçirilmeden
  // officeCatList'e verilirse tırnaklar/köşeli parantezler kategori adının parçası sayılır ve HİÇBİR
  // kategori eşleşmez. Sonuç sessizce yanlış olurdu: saf markalar bir firmanın "Şehirdeki Diğer
  // Firmalar" listesine sızar, bir markanınkinde ise firmalar görünürdü (yerel doğrulamada yakalandı).
  const relatedOffices = shuffledOffices
    .filter(r => {
      const cats = parseCanonicalRow('offices', r).cats;
      return isBrand
        ? isBrandOffice(cats, r.product_count || 0)
        : !isPureBrandOffice(cats, r.product_count || 0);
    })
    .slice(0, 10)
    .map(r => ({ slug: r.slug, name: r.name, loc: r.loc, logo: r.logo_url, website: r.website }));
  const brandCatalog = brandProductsRes.results.map(p => {
    const parsed = parseCanonicalRow('products', p);
    return { slug: parsed.slug, title: parsed.title, images: parsed.images, category: parsed.category, kind: parsed.kind };
  });
  // İlgili Markalar — kartlar firma kartlarıyla AYNI şekle sahiptir (slug/name/loc/logo), böylece
  // office-modal.js'teki mevcut cardHtml/logoUrl yolu değişmeden kullanılabilir.
  const relatedBrands = relatedBrandsRes.results.map(b => ({ slug: b.slug, name: b.name, loc: b.loc, logo: b.logo_url, usedCount: b.used_count || 0 }));
  const relatedProducts = brandCatalog.filter(p => p.kind !== 'material');
  const relatedMaterials = brandCatalog.filter(p => p.kind === 'material');
  // brandCatalog ile AYNI şekillendirme; ürün/malzeme ayrımı YAPILMAZ — bölüm tek başlık altında
  // ("Projelerde Kullanılan Ürünler") gösterilir, marka adı kartın alt satırında yer alır.
  const projectProducts = projectProductsRes.results.map(p => {
    const parsed = parseCanonicalRow('products', p);
    return { slug: parsed.slug, title: parsed.title, images: parsed.images, category: parsed.category, brand: parsed.brand_name_raw, kind: parsed.kind };
  });

  const item = {
    name: o.name, slug: o.slug, loc: o.loc, cats: o.cats, yil: o.yil, website: o.website, about: o.about,
    logo: o.logo_url, awards: o.awards, social_links: o.social_links || [], badges: [], isBrand,
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

  return { item, founders, team, relatedProjects, relatedOffices, relatedProducts, relatedMaterials, projectProducts, relatedBrands, prevItem: adjacent.prevItem, nextItem: adjacent.nextItem, hidden: !!o.hidden_at };
}
