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
  if (office) jsonLd.worksFor = { '@type': 'Organization', name: office.name, url: `${SITE_ORIGIN}/markalar/${encodeURIComponent(slugify(office.name))}` };
  return { title, description, canonicalUrl, image: photoUrl || DEFAULT_IMAGE, jsonLd };
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
  const canonicalUrl = `${SITE_ORIGIN}/markalar/${encodeURIComponent(slug)}`;
  const logoUrl = o.logo ? absoluteUrl(o.logo) : null;
  const jsonLd = { '@context': 'https://schema.org', '@type': 'Organization', name: o.name, url: canonicalUrl };
  if (o.about) jsonLd.description = o.about;
  if (o.yil) jsonLd.foundingDate = String(o.yil);
  if (o.loc) jsonLd.address = { '@type': 'PostalAddress', addressLocality: o.loc };
  if (logoUrl) jsonLd.logo = logoUrl;
  const site = safeHttpUrl(o.website);
  if (site) jsonLd.sameAs = [site];
  return { title, description, canonicalUrl, image: logoUrl || DEFAULT_IMAGE, jsonLd };
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
  if (p.location) jsonLd.locationCreated = { '@type': 'Place', address: p.location };
  const creators = [];
  for (const d of (p.designer || [])) {
    const arch = architects.find(a => a.name === d);
    if (arch) { creators.push({ '@type': 'Person', name: arch.name }); continue; }
    const off = offices.find(o => o.name === d);
    if (off) { creators.push({ '@type': 'Organization', name: off.name }); continue; }
    creators.push({ '@type': 'Organization', name: d });
  }
  if (creators.length) jsonLd.creator = creators.length === 1 ? creators[0] : creators;
  return { title, description, canonicalUrl, image: images[0] || DEFAULT_IMAGE, jsonLd };
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
  return { title, description, canonicalUrl, image: images[0] || DEFAULT_IMAGE, jsonLd };
}

// key: urun.html/urun-detay.html#productKey ile birebir aynı üretim — statik kayıtlarda
// slugify(title + '-' + brand), D1 kayıtlarında "m-<submissionId>" (bkz. urun-detay.html). Önce iki
// statik dizide (products/materials) arar; orada yoksa D1'e (önce product_submissions, sonra
// material_submissions) bakar — statik arama zaten senkron olduğundan yalnızca D1 dalı gerçekten
// async'tir, bu yüzden fonksiyon her koşulda Promise döner.
function staticProductKey(x) { return slugify(`${x.title}-${x.brand || ''}`); }
async function buildProductMeta(key, env) {
  const canonicalUrl = `${SITE_ORIGIN}/urunler/${encodeURIComponent(key)}`;
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
  return { title, description, canonicalUrl, image: imageUrl || DEFAULT_IMAGE, jsonLd };
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
  for (const o of offices) urls.push(`/markalar/${encodeURIComponent(slugify(o.name))}`);
  for (const p of projects) urls.push(`/projeler/${encodeURIComponent(p.slug)}`);
  for (const n of newsItems) urls.push(`/haberler/${encodeURIComponent(n.id)}`);
  return urls;
}
