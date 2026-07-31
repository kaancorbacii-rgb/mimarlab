import { slugify } from './slugify.js';
// data.js/projeler-data.js/haberler-data.js tarayıcıda classic <script> olarak yüklenen, export
// içermeyen dosyalar; Worker tarafında okunabilmeleri için dosya sonlarına eklenen guard'lı
// `module.exports` bloğu sayesinde esbuild bunları CJS modülü olarak paketler (bkz. o dosyalardaki
// yorum). Tarayıcı davranışı değişmez çünkü `typeof module !== 'undefined'` orada hep false'tur.
import dataJs from '../../data.js';
import projeJs from '../../projeler-data.js';
import haberJs from '../../haberler-data.js';

const { offices, architects } = dataJs;
const { projects } = projeJs;
const { newsItems } = haberJs;

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

// Her build* fonksiyonu, ilgili *-detay.html'deki mevcut client-side meta/JSON-LD üretimiyle
// birebir aynı alan eşlemesini kullanır (bkz. plan dosyası) — yalnızca sunucuda, aynı sonuç.
function buildArchitectMeta(slug) {
  const a = getArchitectMap().get(slug);
  if (!a) return null;
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

function buildOfficeMeta(slug) {
  const o = getOfficeMap().get(slug);
  if (!o) return null;
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

function buildProjectMeta(slug) {
  const p = projects.find(x => x.slug === slug);
  if (!p) return null;
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

const BUILDERS = { architect: buildArchitectMeta, office: buildOfficeMeta, project: buildProjectMeta, news: buildNewsMeta };

// type: 'architect' | 'office' | 'project' | 'news'; slugOrId: URL'den çözülen slug/id.
// Kayıt bulunamazsa null döner — çağıran taraf mevcut jenerik placeholder meta'yı olduğu gibi bırakır.
export function buildMeta(type, slugOrId) {
  const builder = BUILDERS[type];
  if (!builder) return null;
  try { return builder(slugOrId); } catch { return null; }
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
