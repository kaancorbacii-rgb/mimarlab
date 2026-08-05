import { errorJson } from '../lib/http.js';
import { cachedPublicJson } from '../lib/publicCache.js';
import { parseCanonicalRow } from '../lib/canonicalRead.js';
import { getCachedFacetCounts } from '../lib/facetCounts.js';
// bkz. src/routes/architect.js'teki AYNI CJS-interop yorumu — il-ilce-data.js proje.html'deki
// parseLocationFull ile BİREBİR aynı il/ilçe çözümlemesini kullanmak için (~970 ilçelik veriyi
// burada tekrar tanımlamak yerine) aynı guard'lı module.exports bloğuyla import ediliyor. Bu dosya
// canonical veri DEĞİL, salt statik bir referans tablosu olduğundan (data.js/projeler-data.js'in
// aksine) Faz 3 kapsamı dışında bırakıldı.
import ilIlceJs from '../../il-ilce-data.js';

const { parseLocationFull } = ilIlceJs;

// Faz 3 — statik projeler-data.js + project_submissions overlay yerine doğrudan canonical
// `projects`/`project_designers` tablolarından okur (bkz. src/routes/architect.js'teki AYNI
// "overlay merge-time'da zaten uygulandı" yorumu, docs/architecture-roadmap.md Faz3 madde 1).

const DESIGNER_SEP = '';

// bir projenin tasarımcı adları dizisini (mimar VEYA ofis adı, project_designers join'inden) tek
// bir GROUP_CONCAT sütununa toplayan ortak sorgu parçası — hem tekil proje hem filtre listesi
// sorgusu bunu kullanır.
const DESIGNER_JOIN_SQL = `
  LEFT JOIN project_designers pd ON pd.project_id = p.id
  LEFT JOIN architects ar ON ar.id = pd.architect_id AND ar.deleted_at IS NULL
  LEFT JOIN offices ofc ON ofc.id = pd.office_id AND ofc.deleted_at IS NULL
`;

function designerNamesFrom(concat) {
  return concat ? concat.split(DESIGNER_SEP).filter(Boolean) : [];
}

function shapeProjectItem(row) {
  const p = parseCanonicalRow('projects', row);
  return {
    slug: p.slug, title: p.title, category: p.category, type: p.type, discipline: p.discipline,
    location: p.location, locationDetail: p.location_detail, date: p.project_date, dateBucket: p.date_bucket,
    period: p.period, designer: designerNamesFrom(row.designer_names),
    photoCredit: { text: p.photo_credit_text || '', url: p.photo_credit_url || '' },
    description: p.description, images: p.images,
    // "Kullanılan Ürünler/Malzemeler" (project_products) doldurulması Faz 2/3'te kapsam dışı
    // bırakıldı (bkz. docs/architecture-roadmap.md §4.4) — proje-detay.html henüz bu API'ye bağlı
    // olmadığından gözlemlenebilir bir etkisi yok.
    brands: [],
  };
}

// GET /api/project/:slug — proje-detay.html henüz bu uca bağlanmadı (bkz. eski yorum, bu durum
// Faz 3'te de değişmedi), ama Faz 1'in "overlay worker katmanına taşınsın" hedefiyle tutarlı,
// çalışır bir uç nokta olarak korunuyor.
export async function handleProjectDetailRoute(request, env, url, rawSlug) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  const slug = decodeURIComponent(rawSlug || '');
  if (!slug) return errorJson('Geçersiz istek.');

  return cachedPublicJson(request, env, url.pathname, async () => {
    const row = await env.DB.prepare(
      `SELECT p.*, GROUP_CONCAT(COALESCE(ar.name, ofc.name), '${DESIGNER_SEP}') AS designer_names
       FROM projects p ${DESIGNER_JOIN_SQL}
       WHERE p.slug = ? AND p.deleted_at IS NULL GROUP BY p.id`
    ).bind(slug).first();
    if (!row) return { item: null, hidden: false };
    if (row.hidden_at) return { item: null, hidden: true };
    return { item: shapeProjectItem(row), hidden: false };
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

// bkz. src/lib/facetCounts.js#recomputeProjectFacets — facet_counts'ın "hiçbir filtre aktif değil"
// anlık görüntüsünü üretmek için handleProjectFiltersRoute ile AYNI havuzu (aktif/gizli olmayan
// projeler + designer isim dizisi) paylaşır, tek sorgu mantığını burada tekilleştirir.
export async function fetchActiveProjectPool(env) {
  // ORDER BY p.id DESC — proje.html#render()'daki varsayılan sıralamayla (sort seçilmemişse "son
  // eklenen ilk sırada") birebir aynı; facet sayaçları (bu havuzun diğer tüketicisi,
  // handleProjectFiltersRoute/recomputeProjectFacets) sıradan bağımsız olduğundan etkilenmez.
  const { results } = await env.DB.prepare(
    `SELECT p.*, GROUP_CONCAT(COALESCE(ar.name, ofc.name), '${DESIGNER_SEP}') AS designer_names
     FROM projects p ${DESIGNER_JOIN_SQL}
     WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL GROUP BY p.id ORDER BY p.id DESC`
  ).all();
  return results.map(shapeProjectItem);
}

// proje.html#FILTER_GROUPS ile BİREBİR aynı alan çıkarımı — yalnızca `field` fonksiyonları burada
// (parseLocation/isOfficeName/ratingBuckets sunucu tarafı karşılıklarıyla) yeniden ifade edilir.
export function buildFilterGroups(ratingByProject) {
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

// GET /api/projects/filters — proje.html#computeOptions'ın TAM karşılığı: her filtre grubunun
// sayacı, O GRUP HARİÇ diğer TÜM aktif filtrelerle eşleşen projeler üzerinden hesaplanır
// (faceted/bağımlı sayaç). Bu "diğer aktif filtrelerle bağımlı" hesap, facet_counts tablosunun (bkz.
// src/lib/facetCounts.js, Faz3 madde 5) düz global sayaç şekliyle KARŞILANAMAZ — o tablo yalnızca
// hiçbir filtre seçili değilken (ilk sayfa yüklemesindeki "Mimari (461)" durumu) hızlı bir KV
// önbelleği sağlar (bkz. handleProjectFiltersRoute'un facet_counts fast-path'i, aynı dosyada
// tanımlı); herhangi bir filtre aktifken bu tam tarama (artık canonical tablo üzerinden) çalışmaya
// devam eder — mevcut canlı davranışla birebir aynı.
export async function handleProjectFiltersRoute(request, env, url) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);

  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    // Hızlı yol: HİÇBİR filtre/arama aktif değilse (proje.html'in ilk sayfa yüklemesindeki durum),
    // facet_counts + KV'den (bkz. src/lib/facetCounts.js) anlık oku — tam tarama gerekmez. Yalnızca
    // o tablonun kapsadığı grupları (rating/district hariç, bkz. facetCounts.js dosya başı kapsam
    // notu) doldurur; istemci taraf zaten bu iki grup için kendi anlık hesabını korur, TAM sayaç
    // seti yalnızca herhangi bir filtre aktifken (aşağıdaki tam tarama yoluyla) hesaplanır.
    if ([...url.searchParams.keys()].length === 0) {
      const cached = await getCachedFacetCounts(env, 'projects');
      if (Object.keys(cached).length) {
        const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM projects WHERE deleted_at IS NULL AND hidden_at IS NULL`).first();
        const out = {};
        for (const [key, counts] of Object.entries(cached)) {
          out[key] = { counts, options: Object.keys(counts).sort((a, b) => (key === 'dateBucket' ? dateBucketSortKey(b) - dateBucketSortKey(a) : counts[b] - counts[a] || a.localeCompare(b))) };
        }
        return { filters: out, total: totalRow?.n || 0 };
      }
    }

    const [projectsRes, ratingRows] = await Promise.all([
      env.DB.prepare(
        `SELECT p.*, GROUP_CONCAT(COALESCE(ar.name, ofc.name), '${DESIGNER_SEP}') AS designer_names
         FROM projects p ${DESIGNER_JOIN_SQL}
         WHERE p.deleted_at IS NULL AND p.hidden_at IS NULL GROUP BY p.id`
      ).all(),
      env.DB.prepare(`SELECT target_id, AVG(stars) AS average FROM ratings WHERE target_type = 'project' GROUP BY target_id`).all(),
    ]);

    const ratingByProject = new Map(ratingRows.results.map(r => [r.target_id, { average: r.average }]));
    const pool = projectsRes.results.map(shapeProjectItem);

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

// GET /api/projects — proje.html#render()'ın sayfalanmış sunucu karşılığı. `/api/projects/filters`
// (yukarıda) sidebar sayaçlarını döndürmeye devam eder; bu uç YALNIZCA mevcut sayfanın kartlarını
// döner (bkz. kullanıcı isteği: "Bütün sayfaların verisini tek seferde DOM'a yükleme"). Filtre
// eşleştirme mantığı handleProjectFiltersRoute'daki İLE BİREBİR AYNI (kasıtlı yerel kopya — iki
// handler farklı closure'lar taşıdığından paylaşılan bir fonksiyona çıkarmak bu dosyanın mevcut
// desenini bozardı, bkz. trLower'ın da her route dosyasında yerel tanımlı olması).
export async function handleProjectListRoute(request, env, url) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);

  return cachedPublicJson(request, env, url.pathname + url.search, async () => {
    const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
    const limit = Math.min(96, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 24));
    const sort = url.searchParams.get('sort') || '';

    const [pool, ratingRows] = await Promise.all([
      fetchActiveProjectPool(env),
      env.DB.prepare(`SELECT target_id, AVG(stars) AS average, COUNT(*) AS count FROM ratings WHERE target_type = 'project' GROUP BY target_id`).all(),
    ]);
    const ratingBySlug = new Map();
    // ratings.target_id proje slug'ı değil id'si olabilir — proje.html#ratingOf ile aynı slug
    // anahtarlı sözlük bekleniyor; bu yüzden pool üzerinden slug eşlemesi kurulur (slug tekil).
    // NOT: target_id burada projects.id DEĞİL, mevcut ratings şeması proje tarafında slug tutuyorsa
    // (bkz. handleProjectFiltersRoute'daki AYNI target_id kullanımı, orada da doğrudan slug/id
    // karışık ele alınmıyor) — burada handleProjectFiltersRoute ile TUTARLI kalmak için aynı
    // target_id anahtarını kullanıyoruz, yalnızca dizi yerine Map'e çeviriyoruz.
    ratingRows.results.forEach(r => ratingBySlug.set(r.target_id, { average: r.average, count: r.count }));

    const FILTER_GROUPS = buildFilterGroups(new Map(ratingRows.results.map(r => [r.target_id, { average: r.average }])));
    const activeFilters = {};
    FILTER_GROUPS.forEach(g => { activeFilters[g.key] = new Set(url.searchParams.getAll(g.key)); });
    const searchQuery = trLower((url.searchParams.get('search') || '').trim());

    function matchesLocalSearch(p) {
      if (!searchQuery) return true;
      const fields = [p.title, p.location, p.locationDetail, ...(p.designer || [])];
      return fields.some(v => v && trLower(String(v)).includes(searchQuery));
    }
    function passesFilters(p) {
      if (!matchesLocalSearch(p)) return false;
      return FILTER_GROUPS.every(g => {
        const sel = activeFilters[g.key];
        if (sel.size === 0) return true;
        const vals = g.field(p);
        return vals.some(v => sel.has(v));
      });
    }

    let filtered = pool.filter(p => passesFilters(p));

    // proje.html#render()'daki sort switch'in BİREBİR aynısı — sort boşsa fetchActiveProjectPool
    // zaten ORDER BY p.id DESC döndürdüğünden (en son eklenen ilk) ek bir sıralama gerekmez.
    if (sort) {
      filtered = [...filtered].sort((a, b) => {
        switch (sort) {
          case 'name_asc': return a.title.localeCompare(b.title, 'tr');
          case 'date_desc': return (parseInt(b.date, 10) || 0) - (parseInt(a.date, 10) || 0);
          case 'date_asc': return (parseInt(a.date, 10) || 0) - (parseInt(b.date, 10) || 0);
          case 'rating_desc': {
            const ra = ratingBySlug.get(a.slug) || { count: 0 }, rb = ratingBySlug.get(b.slug) || { count: 0 };
            if (!ra.count && !rb.count) return 0;
            if (!ra.count) return 1;
            if (!rb.count) return -1;
            return rb.average - ra.average;
          }
          default: return 0;
        }
      });
    }

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (Math.min(page, totalPages) - 1) * limit;
    const items = filtered.slice(start, start + limit);
    return { items, total, page: Math.min(page, totalPages), totalPages };
  });
}
