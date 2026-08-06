import { slugify } from './slugify.js';
import { parseSubmissionRow } from './submissionTypes.js';
// data.js/projeler-data.js/haberler-data.js tarayıcıda classic <script> olarak yüklenen, export
// içermeyen dosyalar; Worker tarafında okunabilmeleri için dosya sonlarına eklenen guard'lı
// `module.exports` bloğu sayesinde esbuild bunları CJS modülü olarak paketler (bkz. o dosyalardaki
// yorum). Tarayıcı davranışı değişmez çünkü `typeof module !== 'undefined'` orada hep false'tur.
import dataJs from '../../data.js';
import projeJs from '../../projeler-data.js';
import haberJs from '../../haberler-data.js';
import urunJs from '../../urunler-data.js';
import malzemeJs from '../../malzemeler-data.js';
// src/routes/project.js'teki AYNI CJS-interop yorumu — il/ilçe çözümlemesini proje konumundan
// (Place/PostalAddress JSON-LD için) tekrar tanımlamak yerine paylaşılan referans tablosundan alır.
import ilIlceJs from '../../il-ilce-data.js';

const { parseLocationFull } = ilIlceJs;

const { offices, architects } = dataJs;
const { projects } = projeJs;
const { newsItems } = haberJs;
const { products } = urunJs;
const { materials } = malzemeJs;

const SITE_ORIGIN = 'https://mimarlab.com';
const DEFAULT_IMAGE = `${SITE_ORIGIN}/logos/site/mimarlab-logo.png`;

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

let architectBySlug;
function getArchitectMap() {
  if (!architectBySlug) {
    architectBySlug = new Map();
    for (const a of architects) architectBySlug.set(slugify(a.name), a);
  }
  return architectBySlug;
}

let officeBySlug;
function getOfficeMap() {
  if (!officeBySlug) {
    officeBySlug = new Map();
    for (const o of offices) officeBySlug.set(slugify(o.name), o);
  }
  return officeBySlug;
}

let newsById;
function getNewsMap() {
  if (!newsById) {
    newsById = new Map();
    for (const n of newsItems) newsById.set(n.id, n);
  }
  return newsById;
}

// claimed_profile_key/claimed_slug'lı onaylı bir düzenleme varsa (bkz. src/routes/public.js#
// handlePublicProfileEdits/handlePublicProjectEdits — *-detay.html sayfalarının istemci tarafında
// yaptığı AYNI bindirme), statik kaydın üzerine son onaylı hâlini bindirir. Önceden build*Meta
// fonksiyonları yalnızca statik data.js/projeler-data.js okuyordu — admin bir kapak görselini/
// açıklamayı değiştirip onayladığında SSR'a gömülü <title>/og:image/JSON-LD eski kalmaya devam
// ediyordu (gerçek bulgu, bkz. src/lib/ssrCache.js'teki purge ile birlikte çözülen aynı sorun).
async function fetchApprovedOverlay(env, table, claimedColumn, key) {
  if (!env || !env.DB || !key) return null;
  try {
    return await env.DB.prepare(
      `SELECT * FROM ${table} WHERE ${claimedColumn} = ? AND status = 'approved' ORDER BY updated_at DESC LIMIT 1`
    ).bind(key).first();
  } catch { return null; }
}

// office_founders (bkz. src/routes/office.js#handleOfficeRoute'un AYNI join'i, src/lib/
// officeFounderCascade.js) — canonical bir ofis kaydı henüz yoksa (yalnızca statik data.js'te var)
// ya da isim eşleşmezse sessizce boş dizi döner; JSON-LD'nin sayfada görünenle (ofis-detay.html'in
// kendi founders sorgusuyla) tutarsız kalması yerine hiç göstermemesi tercih edildi.
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

// Her build* fonksiyonu, ilgili *-detay.html'deki mevcut client-side meta/JSON-LD üretimiyle
// birebir aynı alan eşlemesini kullanır (bkz. plan dosyası) — yalnızca sunucuda, aynı sonuç.
async function buildArchitectMeta(slug, env) {
  const base = getArchitectMap().get(slug);
  if (!base) return null;
  let a = base;
  const editRow = await fetchApprovedOverlay(env, 'architect_submissions', 'claimed_profile_key', base.name);
  if (editRow) {
    const parsed = parseSubmissionRow('architects', editRow);
    a = {
      ...base,
      dob: parsed.dob ?? base.dob, school: parsed.school ?? base.school, dept: parsed.dept ?? base.dept,
      office: parsed.office ?? base.office, role: parsed.position ?? base.role,
      photo: parsed.photo_url || base.photo, about: parsed.about || base.about,
    };
  }
  const office = offices.find(x => x.name === a.office);
  const title = `${a.name} — MİMARLAB`;
  const description = office
    ? `${a.name}, ${office.name} bünyesinde ${a.role || 'mimar'} olarak görev yapmaktadır. MİMARLAB'da profilini incele.`
    : `${a.name} — MİMARLAB'da mimar profilini incele.`;
  const canonicalUrl = `${SITE_ORIGIN}/mimar/${encodeURIComponent(slug)}`;
  const photoUrl = a.photo ? absoluteUrl(a.photo) : null;
  const jsonLd = { '@context': 'https://schema.org', '@type': 'Person', name: a.name, url: canonicalUrl };
  if (a.role) jsonLd.jobTitle = a.role;
  if (photoUrl) jsonLd.image = photoUrl;
  if (a.school) jsonLd.alumniOf = { '@type': 'CollegeOrUniversity', name: a.school };
  if (office) jsonLd.worksFor = { '@type': 'Organization', name: office.name, url: `${SITE_ORIGIN}/firma/${encodeURIComponent(slugify(office.name))}` };
  // Schema.org'da ayrı bir "Architect" tipi yok (bkz. vocabulary) — Person kalıp uzmanlık alanını
  // knowsAbout ile ifade ediyoruz, aksi halde geçersiz @type Google'ın yapılandırılmış veri
  // ayrıştırıcısı tarafından sessizce yok sayılırdı.
  if (a.dept) jsonLd.knowsAbout = [a.dept];
  return { title, description, canonicalUrl, image: photoUrl || DEFAULT_IMAGE, jsonLd, breadcrumbJsonLd: breadcrumbJsonLd('architect', a.name, canonicalUrl) };
}

async function buildOfficeMeta(slug, env) {
  const base = getOfficeMap().get(slug);
  if (!base) return null;
  let o = base;
  const editRow = await fetchApprovedOverlay(env, 'office_submissions', 'claimed_profile_key', base.name);
  if (editRow) {
    const parsed = parseSubmissionRow('offices', editRow);
    o = {
      ...base,
      loc: parsed.loc ?? base.loc, cats: parsed.cats ?? base.cats, yil: parsed.yil ?? base.yil,
      website: parsed.website || base.website, about: parsed.about || base.about, logo: parsed.logo_url || base.logo,
    };
  }
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

async function buildProjectMeta(slug, env) {
  const base = projects.find(x => x.slug === slug);
  if (!base) return null;
  let p = base;
  const editRow = await fetchApprovedOverlay(env, 'project_submissions', 'claimed_slug', base.slug);
  if (editRow) {
    const parsed = parseSubmissionRow('projects', editRow);
    p = {
      ...base,
      title: parsed.title || base.title, description: parsed.description ?? base.description,
      location: parsed.location ?? base.location, designer: (parsed.designer && parsed.designer.length) ? parsed.designer : base.designer,
      images: (parsed.images && parsed.images.length) ? parsed.images : base.images,
    };
  }
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
  const creators = [];
  for (const d of (p.designer || [])) {
    const arch = architects.find(a => a.name === d);
    if (arch) { creators.push({ '@type': 'Person', name: arch.name }); continue; }
    const off = offices.find(o => o.name === d);
    if (off) { creators.push({ '@type': 'Organization', name: off.name }); continue; }
    creators.push({ '@type': 'Organization', name: d });
  }
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
  if (!m || !env || !env.DB) return null;
  const id = m[1];
  const productRow = await env.DB.prepare(`SELECT * FROM product_submissions WHERE id = ? AND status = 'approved'`).bind(id).first();
  const row = productRow || await env.DB.prepare(`SELECT * FROM material_submissions WHERE id = ? AND status = 'approved'`).bind(id).first();
  if (!row) return null;
  let images = [];
  try { images = row.images ? JSON.parse(row.images) : []; } catch { images = []; }
  return productMetaFromRecord({ title: row.title, brand: row.brand, description: row.description, images }, canonicalUrl);
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

const BUILDERS = { architect: buildArchitectMeta, office: buildOfficeMeta, project: buildProjectMeta, product: buildProductMeta, news: buildNewsMeta };

// type: 'architect' | 'office' | 'project' | 'product' | 'news'; slugOrId: URL'den çözülen slug/id.
// Kayıt bulunamazsa null döner — çağıran taraf mevcut jenerik placeholder meta'yı olduğu gibi bırakır.
// env yalnızca buildProductMeta tarafından (D1'deki üye/marka gönderisi ürünlerini bulmak için)
// kullanılır — diğer builder'lar senkron kalır, ikinci parametreyi yok sayar.
export async function buildMeta(type, slugOrId, env) {
  const builder = BUILDERS[type];
  if (!builder) return null;
  try { return await builder(slugOrId, env); } catch { return null; }
}

// /sitemap.xml için: statik verideki tüm mimar/ofis/proje/haber detay URL'leri.
export function listEntityUrls() {
  const urls = [];
  for (const a of architects) urls.push(`/mimar/${encodeURIComponent(slugify(a.name))}`);
  for (const o of offices) urls.push(`/firma/${encodeURIComponent(slugify(o.name))}`);
  for (const p of projects) urls.push(`/projeler/${encodeURIComponent(p.slug)}`);
  for (const n of newsItems) urls.push(`/haberler/${encodeURIComponent(n.id)}`);
  return urls;
}
