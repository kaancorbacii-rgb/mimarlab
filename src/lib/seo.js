import { slugify } from './slugify.js';
import { parseCanonicalRow } from './canonicalRead.js';
// haberler-data.js/urunler-data.js/malzemeler-data.js tarayıcıda classic <script> olarak yüklenen,
// export içermeyen dosyalar; Worker tarafında okunabilmeleri için dosya sonlarına eklenen guard'lı
// `module.exports` bloğu sayesinde esbuild bunları CJS modülü olarak paketler (bkz. o dosyalardaki
// yorum). Tarayıcı davranışı değişmez çünkü `typeof module !== 'undefined'` orada hep false'tur.
// data.js/projeler-data.js BİLEREK burada YOK — Legacy Bundle Elimination Faz 1 (bkz. kullanıcı
// isteği): mimar/firma/proje SSR meta + JSON-LD üretimi artık doğrudan canonical D1 (architects/
// offices/projects) tablolarından okunuyor, src/routes/architect.js|office.js|project.js'in Faz
// 3'te zaten yaptığı AYNI geçiş (o dosyalarda da request-time overlay YOK, bkz. src/routes/
// architect.js dosya başı yorumu: onaylı submission'lar artık merge-time'da (scripts/
// merge-submissions-to-id-first.js, src/lib/canonicalSync.js#syncApprovedSubmissionToCanonical —
// admin onayında CANLI çalışır) canonical satıra yazılıyor). haberler-data.js/urunler-data.js/
// malzemeler-data.js sonraki Legacy Bundle Elimination fazlarının kapsamında, burada dokunulmadı.
import haberJs from '../../haberler-data.js';
import urunJs from '../../urunler-data.js';
import malzemeJs from '../../malzemeler-data.js';
// src/routes/project.js'teki AYNI CJS-interop yorumu — il/ilçe çözümlemesini proje konumundan
// (Place/PostalAddress JSON-LD için) tekrar tanımlamak yerine paylaşılan referans tablosundan alır.
import ilIlceJs from '../../il-ilce-data.js';

const { parseLocationFull } = ilIlceJs;

const { newsItems } = haberJs;
const { products } = urunJs;
const { materials } = malzemeJs;

const SITE_ORIGIN = 'https://mimarlab.com';
const DEFAULT_IMAGE = `${SITE_ORIGIN}/logos/site/mimarlab-og-image.png`;

function absoluteUrl(path) {
  if (!path) return null;
  try { return new URL(path, SITE_ORIGIN).href; } catch { return null; }
}

// mimar-detay.html/ofis-detay.html'deki inline safeUrl() ile aynı: yalnızca http(s) kabul eder.
function safeHttpUrl(u) {
  if (!u) return null;
  try {
    const parsed = new URL(u, SITE_ORIGIN);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch { return null; }
}

function truncate(text, max) {
  return text && text.length > max ? text.slice(0, max - 1) + '…' : text;
}

// Katalog sayfası etiket/yolu — ilgili *-detay.html'deki görünür .breadcrumb-bar zinciriyle
// (ör. proje-detay.html "Ana Sayfa › Projeler › <başlık>") BİREBİR aynı olmalı; Google yapılandırılmış
// verinin sayfada görünen içerikle tutarlı olmasını bekler (bkz. structured data guidelines).
const CATALOG_CRUMB = {
  architect: { label: 'Mimarlar', path: '/mimar' },
  consultant: { label: 'Danışmanlık', path: '/danisman' },
  office: { label: 'Firmalar', path: '/firma' },
  project: { label: 'Projeler', path: '/proje' },
  product: { label: 'Ürün', path: '/urun' },
  news: { label: 'Haberler', path: '/haber' },
};
function breadcrumbJsonLd(type, name, canonicalUrl) {
  const catalog = CATALOG_CRUMB[type];
  if (!catalog) return null;
  const items = [
    { name: 'Ana Sayfa', url: `${SITE_ORIGIN}/` },
    { name: catalog.label, url: `${SITE_ORIGIN}${catalog.path}` },
    { name, url: canonicalUrl },
  ];
  return {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
  };
}

let newsById;
function getNewsMap() {
  if (!newsById) {
    newsById = new Map();
    for (const n of newsItems) newsById.set(n.id, n);
  }
  return newsById;
}

// office_founders (bkz. src/routes/office.js#handleOfficeRoute'un AYNI join'i, src/lib/
// officeFounderCascade.js) — canonical bir ofis kaydı henüz yoksa ya da isim eşleşmezse sessizce
// boş dizi döner; JSON-LD'nin sayfada görünenle (ofis-detay.html'in kendi founders sorgusuyla)
// tutarsız kalması yerine hiç göstermemesi tercih edildi.
async function fetchFounderNames(env, officeName) {
  if (!env || !env.DB || !officeName) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT ar.name FROM office_founders f
       JOIN offices o ON o.id = f.office_id AND o.deleted_at IS NULL
       JOIN architects ar ON ar.id = f.architect_id AND ar.deleted_at IS NULL
       WHERE o.name = ?`
    ).bind(officeName).all();
    return results.map(r => r.name).filter(Boolean);
  } catch { return []; }
}

// D1 canonical tablolardan tekil mimar/firma kaydı bulma — src/routes/architect.js#findArchitect/
// src/routes/office.js#findOffice/src/routes/product.js#handleProductDetailRoute ile BİREBİR aynı
// arama deseni (name/slug/legacy_key eşleşmesi, yoksa slugify-tarama fallback'i). O dosyalardan
// import ETMİYORUZ (route handler'ları başka bağımlılıklar taşıyor, seo.js'in yalnızca DB'ye
// ihtiyacı var). findArchitectRow, mimarın bağlı olduğu ofis adını (architects.office_id → offices)
// AYRI bir round-trip AÇMADAN tek sorguda LEFT JOIN ile getirir (bkz. kullanıcı isteği: "N+1 sorgu
// oluşturma" — eski sürüm önce mimarı, sonra office_id'siyle ayrı bir SELECT ile ofisi okuyordu).
async function findArchitectRow(env, key) {
  if (!env || !env.DB) return null;
  const joinSql = `FROM architects a LEFT JOIN offices o ON o.id = a.office_id AND o.deleted_at IS NULL`;
  const row = await env.DB.prepare(
    `SELECT a.*, o.name AS office_name ${joinSql}
     WHERE a.deleted_at IS NULL AND (a.name = ? OR a.slug = ? OR a.legacy_key = ?) LIMIT 1`
  ).bind(key, key, key).first();
  if (row) return row;
  const { results } = await env.DB.prepare(`SELECT id, name FROM architects WHERE deleted_at IS NULL`).all();
  const match = results.find(r => slugify(r.name) === key);
  if (!match) return null;
  return env.DB.prepare(`SELECT a.*, o.name AS office_name ${joinSql} WHERE a.id = ?`).bind(match.id).first();
}

async function findOfficeRow(env, key) {
  if (!env || !env.DB) return null;
  const row = await env.DB.prepare(
    `SELECT * FROM offices WHERE deleted_at IS NULL AND (name = ? OR slug = ? OR legacy_key = ?) LIMIT 1`
  ).bind(key, key, key).first();
  if (row) return row;
  const { results } = await env.DB.prepare(`SELECT id, name FROM offices WHERE deleted_at IS NULL`).all();
  const match = results.find(r => slugify(r.name) === key);
  if (!match) return null;
  return env.DB.prepare(`SELECT * FROM offices WHERE id = ?`).bind(match.id).first();
}

// project_designers'a bağlı mimar/firma isimlerini TEK sorguda, tipine göre ÖNCEDEN ayrılmış
// (architect_names / office_names) iki GROUP_CONCAT sütunu olarak döner — src/routes/project.js#
// fetchDesignerDetails'teki AYNI architect_id/office_id tip ayrımını ikinci bir round-trip AÇMADAN
// sağlar (bkz. kullanıcı isteği: "N+1 sorgu oluşturma"). JSON-LD'nin `creator` alanı Person/
// Organization ayrımını bu yüzden GERÇEK project_designers.architect_id/office_id'den alır — eski
// statik projeler-data.js#designer[] dizisinin data.js#architects[]/offices[] üzerinde AD
// EŞLEŞTİRMESİYLE (isim çakışması riski taşıyan) yaptığı dolaylı çıkarımın yerini alır. Ayraç olarak
// src/routes/project.js#DESIGNER_SEP ile AYNI görünmez kontrol karakteri () kullanılır — isim
// içinde geçmesi imkansız olduğundan virgül/boşluk gibi ayraçların aksine isimleri asla bölmez.
const DESIGNER_SEP = '';
function namesFromConcat(concat) {
  return concat ? concat.split(DESIGNER_SEP).filter(Boolean) : [];
}
async function findProjectRow(env, slug) {
  if (!env || !env.DB) return null;
  return env.DB.prepare(
    `SELECT p.*,
            GROUP_CONCAT(ar.name, '${DESIGNER_SEP}') AS architect_names,
            GROUP_CONCAT(ofc.name, '${DESIGNER_SEP}') AS office_names
     FROM projects p
     LEFT JOIN project_designers pd ON pd.project_id = p.id
     LEFT JOIN architects ar ON ar.id = pd.architect_id AND ar.deleted_at IS NULL
     LEFT JOIN offices ofc ON ofc.id = pd.office_id AND ofc.deleted_at IS NULL
     WHERE p.slug = ? AND p.deleted_at IS NULL
     GROUP BY p.id`
  ).bind(slug).first();
}

async function findProductRow(env, key) {
  if (!env || !env.DB) return null;
  const row = await env.DB.prepare(`SELECT * FROM products WHERE slug = ? AND deleted_at IS NULL`).bind(key).first();
  if (row) return row;
  const { results } = await env.DB.prepare(`SELECT id, title, brand_name_raw FROM products WHERE deleted_at IS NULL`).all();
  const match = results.find(r => slugify(`${r.title}-${r.brand_name_raw || ''}`) === key);
  if (!match) return null;
  return env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(match.id).first();
}

function architectMetaFromRecord(a, officeName, slug) {
  const title = `${a.name} — MİMARLAB`;
  const description = officeName
    ? `${a.name}, ${officeName} bünyesinde ${a.role || 'mimar'} olarak görev yapmaktadır. MİMARLAB'da profilini incele.`
    : `${a.name} — MİMARLAB'da mimar profilini incele.`;
  const canonicalUrl = `${SITE_ORIGIN}/mimar/${encodeURIComponent(slug)}`;
  const photoUrl = a.photo ? absoluteUrl(a.photo) : null;
  const jsonLd = { '@context': 'https://schema.org', '@type': 'Person', name: a.name, url: canonicalUrl };
  if (a.role) jsonLd.jobTitle = a.role;
  if (photoUrl) jsonLd.image = photoUrl;
  if (a.school) jsonLd.alumniOf = { '@type': 'CollegeOrUniversity', name: a.school };
  if (officeName) jsonLd.worksFor = { '@type': 'Organization', name: officeName, url: `${SITE_ORIGIN}/firma/${encodeURIComponent(slugify(officeName))}` };
  // Schema.org'da ayrı bir "Architect" tipi yok (bkz. vocabulary) — Person kalıp uzmanlık alanını
  // knowsAbout ile ifade ediyoruz, aksi halde geçersiz @type Google'ın yapılandırılmış veri
  // ayrıştırıcısı tarafından sessizce yok sayılırdı.
  if (a.dept) jsonLd.knowsAbout = [a.dept];
  return { title, description, canonicalUrl, image: photoUrl || DEFAULT_IMAGE, jsonLd, breadcrumbJsonLd: breadcrumbJsonLd('architect', a.name, canonicalUrl) };
}

async function buildArchitectMeta(slug, env) {
  const row = await findArchitectRow(env, slug);
  if (!row) return null;
  const a = parseCanonicalRow('architects', row);
  return architectMetaFromRecord({ name: a.name, role: a.position, photo: a.photo_url, school: a.school, dept: a.dept }, row.office_name || null, slug);
}

// /danismanlik/:slug — architectMetaFromRecord ile AYNI kaynak satır (findArchitectRow), ama
// AYRI title/canonical/breadcrumb üretir (bkz. kullanıcı isteği: danışmanlık sayfası kendi SEO
// kimliğini taşısın) ve is_consultant=1 olmayan/silinmiş satırlar için null döner — çağıran
// (src/index.js#serveDetailPage) null'da meta enjeksiyonunu atlar, danismanlik.html ham haliyle
// servis edilir (istemci tarafında ConsultantModal "bulunamadı" durumunu kendisi ele alır, bkz.
// js/components/consultant-modal.js#renderNotFound).
async function buildConsultantMeta(slug, env) {
  const row = await findArchitectRow(env, slug);
  if (!row || !row.is_consultant) return null;
  const a = parseCanonicalRow('architects', row);
  const officeName = row.office_name || null;
  const title = `${a.name} — Online Danışmanlık | MİMARLAB`;
  const description = a.consultant_bio || a.about
    ? truncate(a.consultant_bio || a.about, 200)
    : `${a.name}${officeName ? `, ${officeName}` : ''} ile MİMARLAB'da online mimari danışmanlık/mentörlük seansı ayırt.`;
  const canonicalUrl = `${SITE_ORIGIN}/danisman/${encodeURIComponent(slug)}`;
  const photoUrl = a.photo_url ? absoluteUrl(a.photo_url) : null;
  const jsonLd = { '@context': 'https://schema.org', '@type': 'Person', name: a.name, url: canonicalUrl };
  if (a.position) jsonLd.jobTitle = a.position;
  if (photoUrl) jsonLd.image = photoUrl;
  if (officeName) jsonLd.worksFor = { '@type': 'Organization', name: officeName, url: `${SITE_ORIGIN}/firma/${encodeURIComponent(slugify(officeName))}` };
  if (a.expertise_tags && a.expertise_tags.length) jsonLd.knowsAbout = a.expertise_tags;
  return { title, description, canonicalUrl, image: photoUrl || DEFAULT_IMAGE, jsonLd, breadcrumbJsonLd: breadcrumbJsonLd('consultant', a.name, canonicalUrl) };
}

// architectMetaFromRecord ile AYNI paylaşım deseni — canonical D1 offices satırı ortak şekle
// ({name, about, yil, loc, logo, website}) indirgenip tek fonksiyondan geçirilir.
async function officeMetaFromRecord(o, slug, env) {
  const title = `${o.name} — MİMARLAB`;
  const description = o.about ? truncate(o.about, 200) : `${o.name} — MİMARLAB'da firma profilini incele.`;
  const canonicalUrl = `${SITE_ORIGIN}/firma/${encodeURIComponent(slug)}`;
  const logoUrl = o.logo ? absoluteUrl(o.logo) : null;
  const jsonLd = { '@context': 'https://schema.org', '@type': 'Organization', name: o.name, url: canonicalUrl };
  if (o.about) jsonLd.description = o.about;
  if (o.yil) jsonLd.foundingDate = String(o.yil);
  if (o.loc) jsonLd.address = { '@type': 'PostalAddress', addressLocality: o.loc };
  if (logoUrl) jsonLd.logo = logoUrl;
  const site = safeHttpUrl(o.website);
  if (site) jsonLd.sameAs = [site];
  const founderNames = await fetchFounderNames(env, o.name);
  if (founderNames.length) {
    jsonLd.founder = founderNames.map(n => ({ '@type': 'Person', name: n, url: `${SITE_ORIGIN}/mimar/${encodeURIComponent(slugify(n))}` }));
  }
  return { title, description, canonicalUrl, image: logoUrl || DEFAULT_IMAGE, jsonLd, breadcrumbJsonLd: breadcrumbJsonLd('office', o.name, canonicalUrl) };
}

async function buildOfficeMeta(slug, env) {
  const row = await findOfficeRow(env, slug);
  if (!row) return null;
  const o = parseCanonicalRow('offices', row);
  return officeMetaFromRecord({ name: o.name, about: o.about, yil: o.yil, loc: o.loc, logo: o.logo_url, website: o.website }, slug, env);
}

async function buildProjectMeta(slug, env) {
  const row = await findProjectRow(env, slug);
  if (!row) return null;
  const p = parseCanonicalRow('projects', row);
  const title = `${p.title} — MİMARLAB`;
  const rawDesc = p.description || `${p.title}${p.location ? ' — ' + p.location : ''}. MİMARLAB'da proje detaylarını incele.`;
  const description = truncate(rawDesc, 200);
  const canonicalUrl = `${SITE_ORIGIN}/projeler/${encodeURIComponent(p.slug)}`;
  const images = (p.images || []).map(absoluteUrl).filter(Boolean);
  const jsonLd = { '@context': 'https://schema.org', '@type': 'CreativeWork', name: p.title, url: canonicalUrl };
  if (p.description) jsonLd.description = p.description;
  if (images.length) jsonLd.image = images;
  if (p.location) {
    // Şehir/ilçe kırılımı proje.html#FILTER_GROUPS'un location/district filtrelerinde zaten
    // kullanılan AYNI parseLocationFull ile — düz metin yerine yapılandırılmış PostalAddress
    // arama motorlarının konumu güvenilir şekilde ayrıştırmasını sağlar.
    const info = parseLocationFull(p.location);
    const address = { '@type': 'PostalAddress', addressCountry: 'TR' };
    if (info.district) address.addressLocality = info.district;
    if (info.city) address.addressRegion = info.city;
    if (!info.district && !info.city) address.addressLocality = p.location;
    jsonLd.locationCreated = { '@type': 'Place', address };
  }
  const creators = [
    ...namesFromConcat(row.architect_names).map(name => ({ '@type': 'Person', name })),
    ...namesFromConcat(row.office_names).map(name => ({ '@type': 'Organization', name })),
  ];
  if (creators.length) jsonLd.creator = creators.length === 1 ? creators[0] : creators;
  return { title, description, canonicalUrl, image: images[0] || DEFAULT_IMAGE, jsonLd, breadcrumbJsonLd: breadcrumbJsonLd('project', p.title, canonicalUrl) };
}

// Ürün/malzeme künyesinden ({title, brand, category, description, images}) ortak meta şekli üretir —
// hem statik urunler-data.js/malzemeler-data.js kayıtları hem D1'deki onaylı product_submissions/
// material_submissions satırları (bkz. buildProductMeta) aynı şekli taşıdığından paylaşılabilir.
function productMetaFromRecord(record, canonicalUrl) {
  const title = `${record.title} — MİMARLAB`;
  const rawDesc = record.description || `${record.title}${record.brand ? ' — ' + record.brand : ''}. MİMARLAB'da ürün detaylarını incele.`;
  const description = truncate(rawDesc, 200);
  const images = (record.images || []).map(absoluteUrl).filter(Boolean);
  const jsonLd = { '@context': 'https://schema.org', '@type': 'Product', name: record.title, url: canonicalUrl };
  if (record.description) jsonLd.description = record.description;
  if (images.length) jsonLd.image = images;
  if (record.brand) jsonLd.brand = { '@type': 'Brand', name: record.brand };
  return { title, description, canonicalUrl, image: images[0] || DEFAULT_IMAGE, jsonLd, breadcrumbJsonLd: breadcrumbJsonLd('product', record.title, canonicalUrl) };
}

// key: urun.html/urun-detay.html#productKey ile birebir aynı üretim — statik kayıtlarda
// slugify(title + '-' + brand), D1 kayıtlarında "m-<submissionId>" (bkz. urun-detay.html). Önce iki
// statik dizide (products/materials) arar; orada yoksa D1'e (önce product_submissions, sonra
// material_submissions) bakar — statik arama zaten senkron olduğundan yalnızca D1 dalı gerçekten
// async'tir, bu yüzden fonksiyon her koşulda Promise döner.
function staticProductKey(x) { return slugify(`${x.title}-${x.brand || ''}`); }
async function buildProductMeta(key, env) {
  const canonicalUrl = `${SITE_ORIGIN}/urun/${encodeURIComponent(key)}`;
  const staticMatch = products.find(x => staticProductKey(x) === key)
    || materials.find(x => staticProductKey(x) === key);
  if (staticMatch) return productMetaFromRecord(staticMatch, canonicalUrl);

  const m = /^m-(.+)$/.exec(key);
  if (m && env && env.DB) {
    const id = m[1];
    const productRow = await env.DB.prepare(`SELECT * FROM product_submissions WHERE id = ? AND status = 'approved'`).bind(id).first();
    const row = productRow || await env.DB.prepare(`SELECT * FROM material_submissions WHERE id = ? AND status = 'approved'`).bind(id).first();
    if (row) {
      let images = [];
      try { images = row.images ? JSON.parse(row.images) : []; } catch { images = []; }
      return productMetaFromRecord({ title: row.title, brand: row.brand, description: row.description, images }, canonicalUrl);
    }
  }

  // Ne statik dizide ne eski üye-gönderisi tablolarında bulundu — canonical `products` tablosuna
  // bak (bkz. src/routes/product.js#handleProductDetailRoute'taki AYNI arama deseni: önce doğrudan
  // slug eşleşmesi, yoksa id'siz eski anahtar formatıyla tam tarama). Faz 3 migrasyonundan sonra
  // gerçek ürün/malzeme kataloğunun büyük kısmı yalnızca burada yaşıyor, statik dizilerde değil.
  const row = await findProductRow(env, key);
  if (!row) return null;
  const p = parseCanonicalRow('products', row);
  return productMetaFromRecord({ title: p.title, brand: p.brand_name_raw, description: p.description, images: p.images }, canonicalUrl);
}

function buildNewsMeta(id) {
  const n = getNewsMap().get(id);
  if (!n) return null;
  const title = `${n.title} — MİMARLAB`;
  const rawDesc = n.description || `${n.title}${n.category ? ' — ' + n.category : ''}. MİMARLAB'da haberin devamını oku.`;
  const description = truncate(rawDesc, 200);
  const canonicalUrl = `${SITE_ORIGIN}/haberler/${encodeURIComponent(n.id)}`;
  const imageUrl = n.image ? absoluteUrl(n.image) : null;
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'NewsArticle',
    headline: n.title, url: canonicalUrl,
    publisher: { '@type': 'Organization', name: 'MİMARLAB', logo: { '@type': 'ImageObject', url: DEFAULT_IMAGE } },
  };
  if (n.description) jsonLd.description = n.description;
  if (imageUrl) jsonLd.image = [imageUrl];
  if (n.createdAt) jsonLd.datePublished = new Date(n.createdAt).toISOString();
  return { title, description, canonicalUrl, image: imageUrl || DEFAULT_IMAGE, jsonLd, breadcrumbJsonLd: breadcrumbJsonLd('news', n.title, canonicalUrl) };
}

const BUILDERS = { architect: buildArchitectMeta, consultant: buildConsultantMeta, office: buildOfficeMeta, project: buildProjectMeta, product: buildProductMeta, news: buildNewsMeta };

// type: 'architect' | 'office' | 'project' | 'product' | 'news'; slugOrId: URL'den çözülen slug/id.
// Kayıt bulunamazsa (veya D1 sorgusu hata verirse, bkz. aşağıdaki try/catch) null döner — çağıran
// taraf (src/index.js#serveDetailPage) mevcut jenerik placeholder meta'yı (şablonun kendi <title>/
// meta description'ı) olduğu gibi bırakır, ASLA 500 üretmez ya da boş/kırık etiket enjekte etmez.
// env artık architect/office/project'in TEK veri kaynağı (Legacy Bundle Elimination Faz 1, bkz.
// yukarıdaki import yorumu) — yalnızca product hâlâ statik urunler-data.js/malzemeler-data.js'i
// önce dener (D1'e ikinci bir round-trip açmadan), news hâlâ tamamen statik haberler-data.js okur
// (bu iki tip bu turun kapsamı dışında, bkz. kullanıcı isteği: yalnızca data.js/projeler-data.js).
export async function buildMeta(type, slugOrId, env) {
  const builder = BUILDERS[type];
  if (!builder) return null;
  try { return await builder(slugOrId, env); } catch { return null; }
}

// /sitemap.xml için: statik haberler-data.js'teki haber URL'leri. Haber artık yayında değil (bkz.
// kullanıcı isteği, src/index.js#DISABLED_PAGE_PATHS) — /haberler/:id 404 döndüğünden burada boş
// dizi döner, newsItems/haberler-data.js DOKUNULMADAN kalır. Mimar/ofis/proje URL'leri artık
// yalnızca D1'de yaşadığından (bkz. yukarıdaki Legacy Bundle Elimination Faz 1 yorumu) zaten
// buradan değil src/index.js#listCanonicalEntityUrls'ten gelir.
export function listEntityUrls() {
  return [];
}
