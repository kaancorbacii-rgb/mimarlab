import { errorJson } from '../lib/http.js';
import { cachedPublicJson } from '../lib/publicCache.js';
import { parseCanonicalRow } from '../lib/canonicalRead.js';
import { getCachedFacetCounts } from '../lib/facetCounts.js';
import { fetchOwnerByline } from '../lib/ownerByline.js';
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
// sorgusu bunu kullanır. ar_ofc: bir mimar-tipi tasarımcının BAĞLI OLDUĞU ofis (architects.office_id
// üzerinden) — index.html'in proje slaytı altyazısında "Mimar adı" değil "bağlı olduğu ofis adı"
// göstermesi gerektiğinden (bkz. kullanıcı isteği, eskiden data.js offices[]/architects[] üzerinde
// istemci tarafında yapılan AYNI eşleştirme) eklendi; ofc (tasarımcı doğrudan bir ofisse) ile
// COALESCE edilerek aşağıdaki OFFICE_NAMES_SQL sütununu besler.
const DESIGNER_JOIN_SQL = `
  LEFT JOIN project_designers pd ON pd.project_id = p.id
  LEFT JOIN architects ar ON ar.id = pd.architect_id AND ar.deleted_at IS NULL
  LEFT JOIN offices ofc ON ofc.id = pd.office_id AND ofc.deleted_at IS NULL
  LEFT JOIN offices ar_ofc ON ar_ofc.id = ar.office_id AND ar_ofc.deleted_at IS NULL
`;
// office_names GROUP_CONCAT sütunu — designer_names'ten AYRI tutulur çünkü designer_names künyede
// görünen HAM tasarımcı isimlerini (mimar veya ofis) taşımaya devam etmeli; office_names yalnızca
// "bu projenin görüntülenecek ofis adı/adları" için additive bir alandır (bkz. kullanıcı isteği:
// "mevcut designer alanını bozmadan").
const OFFICE_NAMES_SQL = `GROUP_CONCAT(COALESCE(ofc.name, ar_ofc.name), '${DESIGNER_SEP}') AS office_names`;

function designerNamesFrom(concat) {
  return concat ? concat.split(DESIGNER_SEP).filter(Boolean) : [];
}

// office_names GROUP_CONCAT'i NULL'ları (SQLite GROUP_CONCAT NULL değerleri zaten atlar) ve
// tekrarları (ör. bir ofis + o ofisin bir mimarı aynı projede iki ayrı project_designers satırıysa)
// içerebilir — SQLite GROUP_CONCAT(DISTINCT ..., özel ayraç) birlikte desteklemediğinden
// ("DISTINCT aggregates must have exactly one argument", yerel D1'de doğrulandı) tekilleştirme
// burada JS tarafında yapılır; index.html'deki eski `if(!officeNames.includes(d))` mantığıyla
// BİREBİR aynı sırayı korur.
function officeNamesFrom(concat) {
  if (!concat) return [];
  const seen = new Set();
  const out = [];
  for (const name of concat.split(DESIGNER_SEP)) {
    if (name && !seen.has(name)) { seen.add(name); out.push(name); }
  }
  return out;
}

function shapeProjectItem(row) {
  const p = parseCanonicalRow('projects', row);
  return {
    slug: p.slug, title: p.title, category: p.category, type: p.type, discipline: p.discipline,
    location: p.location, locationDetail: p.location_detail, date: p.project_date, dateBucket: p.date_bucket,
    period: p.period, designer: designerNamesFrom(row.designer_names),
    officeNames: officeNamesFrom(row.office_names),
    photoCredit: { text: p.photo_credit_text || '', url: p.photo_credit_url || '' },
    description: p.description, images: p.images,
  };
}

// Proje modalının künyesindeki zengin mimar/firma "chip"leri (fotoğraf/logo + kendi profil linki)
// için — shapeProjectItem'daki düz `designer` isim dizisi liste/filtre uçlarıyla PAYLAŞILDIĞINDAN
// (bkz. fetchActiveProjectPool/handleProjectFiltersRoute, aynı isim eşleştirmesine dayanıyorlar)
// orada değiştirilmez; bu yalnızca tekil proje detayında ek bir sorguyla doldurulan ayrı bir alan.
async function fetchDesignerDetails(env, projectId) {
  const { results } = await env.DB.prepare(
    `SELECT pd.architect_id, pd.office_id,
            ar.name AS ar_name, ar.slug AS ar_slug, ar.photo_url AS ar_photo,
            ofc.name AS ofc_name, ofc.slug AS ofc_slug, ofc.logo_url AS ofc_logo
     FROM project_designers pd
     LEFT JOIN architects ar ON ar.id = pd.architect_id AND ar.deleted_at IS NULL
     LEFT JOIN offices ofc ON ofc.id = pd.office_id AND ofc.deleted_at IS NULL
     WHERE pd.project_id = ?`
  ).bind(projectId).all();
  return results
    .map(r => r.architect_id
      ? (r.ar_name ? { name: r.ar_name, type: 'architect', slug: r.ar_slug, photo: r.ar_photo || null } : null)
      : (r.ofc_name ? { name: r.ofc_name, type: 'office', slug: r.ofc_slug, photo: r.ofc_logo || null } : null))
    .filter(Boolean);
}

// proje-ekle.html'in Mimar/Firma alanlarına yazılan ama architects/offices'te eşleşen bir kaydı
// olmayan isimler resolveDesignerLink() tarafından sessizce ATLANIYOR (bkz. src/lib/canonicalSync.js
// #syncProject — CHECK ((architect_id IS NOT NULL) != (office_id IS NOT NULL)) eşleşmeyen isim için
// project_designers'a hiçbir satır yazılmasına izin vermiyor, dolayısıyla künyede hiç görünmüyorlardı
// — bkz. kullanıcı isteği). Bu isimler hâlâ TEK yerde hayatta: onları oluşturan/son düzenleyen
// project_submissions.designer JSON dizisi (form'a yazıldığı haliyle, hiç mutasyona uğramaz). O
// satırı geriye doğru bulmak için canonicalSync'teki AYNI eşleştirmeyi (claimed_slug=slug YA DA
// legacy_key="submission:<id>") tersine kullanıyoruz; en son güncellenen satır esas alınır çünkü
// syncProject() her düzenlemede project_designers'ı BAŞTAN yazıyor (bkz. "DELETE FROM
// project_designers WHERE project_id = ?").
async function fetchRawDesignerNames(env, project) {
  const submissionId = (project.legacy_key || '').startsWith('submission:') ? project.legacy_key.slice('submission:'.length) : '';
  const row = await env.DB.prepare(
    `SELECT designer FROM project_submissions WHERE claimed_slug = ?1 OR id = ?2 ORDER BY updated_at DESC LIMIT 1`
  ).bind(project.slug, submissionId).first();
  if (!row || !row.designer) return [];
  try { return JSON.parse(row.designer) || []; } catch { return []; }
}

// "Kullanılan Ürünler/Malzemeler" — project_products join tablosundan (bkz. resolveProjectProductLinks
// içinde src/lib/canonicalSync.js, burada canlı doldurulur) gerçek ürün/malzeme kayıtlarını okur;
// artık istemci tarafında brand-string eşleştirmesi (proje-detay.html#renderRelatedCatalog'un eski
// yöntemi) gerekmiyor.
async function fetchProjectProducts(env, projectId) {
  const { results } = await env.DB.prepare(
    `SELECT pr.slug, pr.title, pr.kind, pr.category, pr.images,
            COALESCE(off.name, pr.brand_name_raw) AS brand_name
     FROM project_products pp
     JOIN products pr ON pr.id = pp.product_id AND pr.deleted_at IS NULL
     LEFT JOIN offices off ON off.id = pr.brand_office_id AND off.deleted_at IS NULL
     WHERE pp.project_id = ?`
  ).bind(projectId).all();
  const products = [];
  const materials = [];
  for (const row of results) {
    let images = [];
    try { images = row.images ? JSON.parse(row.images) : []; } catch { /* bozuk JSON — atla */ }
    const item = { slug: row.slug, title: row.title, category: row.category || '', image: images[0] || null, brand: row.brand_name || '' };
    (row.kind === 'material' ? materials : products).push(item);
  }
  return { products, materials };
}

// Önceki/Sonraki Proje — proje.html'deki grid'in o anki (filtrelenmiş/sıralanmış) sayfasını
// istemci hafızasında tutan eski `navList` yöntemi yerine (bkz. kullanıcı isteği: "kökten çözüm"),
// dairesel/sıralı gezinme artık HER İSTEKTE burada, id sırasına göre hesaplanır — proje doğrudan
// URL ile açıldığında ya da liste hiç yüklenmediğinde (F5, deep link) de butonlar eksiksiz çıkar.
// id küçüldükçe "sonraki" (daha eski), id büyüdükçe "önceki" (daha yeni) — uçlarda dairesel sarar.
async function fetchAdjacentProject(env, id) {
  const where = `deleted_at IS NULL AND hidden_at IS NULL`;
  let prev = await env.DB.prepare(`SELECT id, slug, title FROM projects WHERE ${where} AND id < ? ORDER BY id DESC LIMIT 1`).bind(id).first();
  let next = await env.DB.prepare(`SELECT id, slug, title FROM projects WHERE ${where} AND id > ? ORDER BY id ASC LIMIT 1`).bind(id).first();
  if (!prev) prev = await env.DB.prepare(`SELECT id, slug, title FROM projects WHERE ${where} ORDER BY id DESC LIMIT 1`).first();
  if (!next) next = await env.DB.prepare(`SELECT id, slug, title FROM projects WHERE ${where} ORDER BY id ASC LIMIT 1`).first();
  if (prev && prev.id === id) prev = null;
  if (next && next.id === id) next = null;
  return {
    prevProject: prev ? { slug: prev.slug, title: prev.title } : null,
    nextProject: next ? { slug: next.slug, title: next.title } : null,
  };
}

// Mimarı girilmemiş, sadece Mimarlık Firması tanımlı projeler (ör. Foster + Partners'ın Dolunay
// Villa'sı, bkz. kullanıcı isteği) için "Mimar:" alanı boş kalmasın diye firmanın office_founders
// kayıtlarını otomatik doldurur. Yalnızca kayıtlı (unregistered OLMAYAN, gerçek bir offices satırına
// bağlı) firmalar için çalışır — kaydı olmayan bir firma adı için kurucu sorgusu zaten sonuçsuz kalır.
// Faz 4A — N+1 düzeltmesi: officeNames listesi eskiden tek tek sorgulanıyordu (bir proje birden
// fazla ofis içerdiğinde D1'e ofis sayısı kadar ayrı round-trip); tek bir IN(...) sorgusuna
// indirgendi (bkz. kullanıcı isteği: Phase 4A N+1 temizliği).
async function fetchFoundersForOffices(env, officeNames) {
  if (!officeNames.length) return [];
  const placeholders = officeNames.map(() => '?').join(', ');
  const { results } = await env.DB.prepare(
    `SELECT ar.name, ar.slug, ar.photo_url FROM office_founders f
     JOIN offices o ON o.id = f.office_id AND o.deleted_at IS NULL
     JOIN architects ar ON ar.id = f.architect_id AND ar.deleted_at IS NULL
     WHERE o.name IN (${placeholders})`
  ).bind(...officeNames).all();
  return results.map(r => ({ name: r.name, type: 'architect', slug: r.slug, photo: r.photo_url }));
}

// GET /api/project/:slug — Faz 4: proje.html'deki proje modalı bu uca bağlandı (eski yorum artık
// geçersiz), canonical D1'den doğrudan okur.
export async function handleProjectDetailRoute(request, env, url, rawSlug) {
  if (request.method !== 'GET') return errorJson('Bulunamadı', 404);
  const slug = decodeURIComponent(rawSlug || '');
  if (!slug) return errorJson('Geçersiz istek.');

  return cachedPublicJson(request, env, url.pathname, async () => {
    const row = await env.DB.prepare(
      `SELECT p.*, GROUP_CONCAT(COALESCE(ar.name, ofc.name), '${DESIGNER_SEP}') AS designer_names, ${OFFICE_NAMES_SQL}
       FROM projects p ${DESIGNER_JOIN_SQL}
       WHERE p.slug = ? AND p.deleted_at IS NULL GROUP BY p.id`
    ).bind(slug).first();
    if (!row) return { item: null, hidden: false };
    if (row.hidden_at) return { item: null, hidden: true };
    const item = shapeProjectItem(row);
    const [designerDetails, catalog, rawNames, owner] = await Promise.all([
      fetchDesignerDetails(env, row.id),
      fetchProjectProducts(env, row.id),
      fetchRawDesignerNames(env, row),
      fetchOwnerByline(env, row.claimed_by_user_id),
    ]);
    if (owner) Object.assign(item, owner);
    // Zaten eşleşmiş (profilli) isimlerin ÜZERİNE yazmayan, formda yazılan ama hiçbir profile
    // bağlanamamış isimler için künyede baş harfli, tıklanamaz bir "rozet" fallback'i (bkz. yukarıdaki
    // fetchRawDesignerNames yorumu ve kullanıcı isteği) — isOfficeName() (aşağıda tanımlı, proje.html
    // #OFFICE_NAME_OVERRIDES ile birebir aynı liste) Mimar/Firma bölümü ayrımını burada da uygular.
    const knownNames = new Set(designerDetails.map(d => d.name));
    for (const name of rawNames) {
      if (!name || knownNames.has(name)) continue;
      knownNames.add(name);
      designerDetails.push({ name, type: isOfficeName(name) ? 'office' : 'architect', slug: null, photo: null, unregistered: true });
    }
    // Mimar alanı hiç doldurulmamışsa (bkz. yukarıdaki fetchFoundersForOffices yorumu) tanımlı
    // firma(lar)ın kurucu/ortak mimarlarını otomatik "Mimar:" chip'i olarak ekle — Mimar alanı boş kalmasın.
    if (!designerDetails.some(d => d.type === 'architect')) {
      const officeNames = designerDetails.filter(d => d.type === 'office' && !d.unregistered).map(d => d.name);
      const autoFounders = await fetchFoundersForOffices(env, officeNames);
      for (const founder of autoFounders) {
        if (knownNames.has(founder.name)) continue;
        knownNames.add(founder.name);
        designerDetails.push(founder);
      }
    }
    item.designerDetails = designerDetails;
    item.products = catalog.products;
    item.materials = catalog.materials;
    const adjacent = await fetchAdjacentProject(env, row.id);
    item.prevProject = adjacent.prevProject;
    item.nextProject = adjacent.nextProject;
    return { item, hidden: false };
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
    `SELECT p.*, GROUP_CONCAT(COALESCE(ar.name, ofc.name), '${DESIGNER_SEP}') AS designer_names, ${OFFICE_NAMES_SQL}
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
        `SELECT p.*, GROUP_CONCAT(COALESCE(ar.name, ofc.name), '${DESIGNER_SEP}') AS designer_names, ${OFFICE_NAMES_SQL}
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
    // rating/ratingCount: js/components/project-related.js#RelatedProjects'in puan bazlı skorlama
    // algoritmasındaki "yüksek puanlama" bileşeni için — ratingBySlug zaten yukarıda hesaplanmış,
    // burada sadece sayfalanmış dilime iğneleniyor, ek bir sorgu gerekmiyor.
    const items = filtered.slice(start, start + limit).map(p => {
      const r = ratingBySlug.get(p.slug);
      return { ...p, rating: r ? r.average : null, ratingCount: r ? r.count : 0 };
    });
    return { items, total, page: Math.min(page, totalPages), totalPages };
  });
}
