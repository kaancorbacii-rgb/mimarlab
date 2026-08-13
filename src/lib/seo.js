import { slugify } from './slugify.js';
import { parseCanonicalRow } from './canonicalRead.js';
// data.js/projeler-data.js/urunler-data.js/malzemeler-data.js BİLEREK burada YOK — mimar/firma/
// proje/ürün SSR meta + JSON-LD üretimi artık doğrudan canonical D1 (architects/offices/projects/
// products) tablolarından okunuyor, src/routes/architect.js|office.js|project.js|product.js'in
// zaten yaptığı AYNI geçiş (o dosyalarda da request-time overlay YOK, bkz. src/routes/
// architect.js dosya başı yorumu: onaylı submission'lar artık merge-time'da (scripts/
// merge-submissions-to-id-first.js, src/lib/canonicalSync.js#syncApprovedSubmissionToCanonical —
// admin onayında CANLI çalışır) canonical satıra yazılıyor). urunler-data.js/malzemeler-data.js
// kaldırıldı (kullanıcı isteği) — bkz. aşağıdaki buildProductMeta.
// src/routes/project.js'teki AYNI CJS-interop yorumu — il/ilçe çözümlemesini proje konumundan
// (Place/PostalAddress JSON-LD için) tekrar tanımlamak yerine paylaşılan referans tablosundan alır.
import ilIlceJs from '../../il-ilce-data.js';

const { parseLocationFull } = ilIlceJs;

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
  office: { label: 'Firmalar', path: '/firma' },
  project: { label: 'Projeler', path: '/proje' },
  product: { label: 'Ürün', path: '/urun' },
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

// office_founders (bkz. src/routes/office.js#handleOfficeRoute'un AYNI join'i, src/lib/
// officeFounderCascade.js) — canonical bir ofis kaydı henüz yoksa ya da isim eşleşmezse sessizce
// boş dizi döner; JSON-LD'nin sayfada görünenle (ofis-detay.html'in kendi founders sorgusuyla)
// tutarsız kalması yerine hiç göstermemesi tercih edildi.
// ar.slug de döner (bkz. officeMetaFromRecord'daki denetim notu) — founder[].url artık slugify(name)
// tahmini yerine kurucunun GERÇEK a.slug'ını kullanabilsin diye.
async function fetchFounderNames(env, officeName) {
  if (!env || !env.DB || !officeName) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT ar.name, ar.slug FROM office_founders f
       JOIN offices o ON o.id = f.office_id AND o.deleted_at IS NULL
       JOIN architects ar ON ar.id = f.architect_id AND ar.deleted_at IS NULL
       WHERE o.name = ?`
    ).bind(officeName).all();
    return results.filter(r => r.name).map(r => ({ name: r.name, slug: r.slug || null }));
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
  // o.slug AS office_slug — audit bulgusu (2026-08-14): canonicalUrl/worksFor.url önceden bu
  // sorgunun eşleştiği kayıttan bağımsız, çağıranın ham URL parametresinden/slugify(name)'den
  // kuruluyordu; name/slug/legacy_key alias'larının HER BİRİ 200 döndüğünden bu, aynı kaydın kendi
  // kendine canonical olduğu birden çok URL'ye (duplicate content) yol açıyordu. Artık her zaman bu
  // sorgunun bulduğu satırın GERÇEK a.slug/o.slug'ı kullanılır (bkz. buildArchitectMeta).
  const joinSql = `FROM architects a LEFT JOIN offices o ON o.id = a.office_id AND o.deleted_at IS NULL`;
  const row = await env.DB.prepare(
    `SELECT a.*, o.name AS office_name, o.slug AS office_slug ${joinSql}
     WHERE a.deleted_at IS NULL AND a.hidden_at IS NULL AND (a.name = ? OR a.slug = ? OR a.legacy_key = ?) LIMIT 1`
  ).bind(key, key, key).first();
  if (row) return row;
  const { results } = await env.DB.prepare(`SELECT id, name FROM architects WHERE deleted_at IS NULL AND hidden_at IS NULL`).all();
  const match = results.find(r => slugify(r.name) === key);
  if (!match) return null;
  return env.DB.prepare(`SELECT a.*, o.name AS office_name, o.slug AS office_slug ${joinSql} WHERE a.id = ?`).bind(match.id).first();
}

async function findOfficeRow(env, key) {
  if (!env || !env.DB) return null;
  const row = await env.DB.prepare(
    `SELECT * FROM offices WHERE deleted_at IS NULL AND hidden_at IS NULL AND (name = ? OR slug = ? OR legacy_key = ?) LIMIT 1`
  ).bind(key, key, key).first();
  if (row) return row;
  const { results } = await env.DB.prepare(`SELECT id, name FROM offices WHERE deleted_at IS NULL AND hidden_at IS NULL`).all();
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
     WHERE p.slug = ? AND p.deleted_at IS NULL AND p.hidden_at IS NULL
     GROUP BY p.id`
  ).bind(slug).first();
}

async function findProductRow(env, key) {
  if (!env || !env.DB) return null;
  const row = await env.DB.prepare(`SELECT * FROM products WHERE slug = ? AND deleted_at IS NULL AND hidden_at IS NULL`).bind(key).first();
  if (row) return row;
  const { results } = await env.DB.prepare(`SELECT id, title, brand_name_raw FROM products WHERE deleted_at IS NULL AND hidden_at IS NULL`).all();
  const match = results.find(r => slugify(`${r.title}-${r.brand_name_raw || ''}`) === key);
  if (!match) return null;
  return env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(match.id).first();
}

// slug: kaydın GERÇEK canonical a.slug'ı (bkz. findArchitectRow'daki denetim notu) — çağıranın URL'de
// kullandığı ham anahtar (name/legacy_key alias'ı olabilir) DEĞİL, aksi halde aynı kayıt birden çok
// URL'den kendi kendine canonical olur (duplicate content). officeSlug de aynı gerekçeyle GERÇEK
// o.slug'tır; eşleşen bir ofis kaydı yoksa (ör. serbest metin ofis adı) slugify(officeName) fallback'ine
// düşer — önceki (tek) davranışla aynı, yalnızca gerçek bir eşleşme varken daha doğru URL üretir.
function architectMetaFromRecord(a, officeName, slug, officeSlug) {
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
  if (officeName) jsonLd.worksFor = { '@type': 'Organization', name: officeName, url: `${SITE_ORIGIN}/firma/${encodeURIComponent(officeSlug || slugify(officeName))}` };
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
  return architectMetaFromRecord({ name: a.name, role: a.position, photo: a.photo_url, school: a.school, dept: a.dept }, row.office_name || null, row.slug, row.office_slug || null);
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
  const founders = await fetchFounderNames(env, o.name);
  if (founders.length) {
    // founder.slug — bulunan kurucunun GERÇEK a.slug'ı (bkz. fetchFounderNames); eşleşen bir
    // architects satırı yoksa (teoride olmaz, join zaten architects üzerinden geliyor) slugify(name)
    // fallback'ine düşer — audit bulgusu: önceden HER ZAMAN slugify(name) kullanılıyordu, legacy
    // city-suffixed slug'larla (bkz. proje memory notu) uyuşmayabiliyordu.
    jsonLd.founder = founders.map(f => ({ '@type': 'Person', name: f.name, url: `${SITE_ORIGIN}/mimar/${encodeURIComponent(f.slug || slugify(f.name))}` }));
  }
  return { title, description, canonicalUrl, image: logoUrl || DEFAULT_IMAGE, jsonLd, breadcrumbJsonLd: breadcrumbJsonLd('office', o.name, canonicalUrl) };
}

// slug: kaydın GERÇEK canonical o.slug'ı — bkz. findArchitectRow'daki AYNI denetim notu
// (2026-08-14); çağıranın URL'de kullandığı ham anahtar (name/legacy_key alias'ı olabilir) DEĞİL.
async function buildOfficeMeta(slug, env) {
  const row = await findOfficeRow(env, slug);
  if (!row) return null;
  const o = parseCanonicalRow('offices', row);
  return officeMetaFromRecord({ name: o.name, about: o.about, yil: o.yil, loc: o.loc, logo: o.logo_url, website: o.website }, row.slug, env);
}

async function buildProjectMeta(slug, env) {
  const row = await findProjectRow(env, slug);
  if (!row) return null;
  const p = parseCanonicalRow('projects', row);
  const title = `${p.title} — MİMARLAB`;
  const rawDesc = p.description || `${p.title}${p.location ? ' — ' + p.location : ''}. MİMARLAB'da proje detaylarını incele.`;
  const description = truncate(rawDesc, 200);
  // Proje (eski "Yapı") tek URL öneki: /proje/:slug (bkz. kullanıcı isteği: Yapı sayfası Proje
  // adını aldı, eski konsept "Proje" kategorisi tamamen kaldırıldı — artık tek kategori var).
  const canonicalUrl = `${SITE_ORIGIN}/proje/${encodeURIComponent(p.slug)}`;
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
  // audit bulgusu: og:type tüm detay sayfalarında sabit "website" kalıyordu — proje sayfaları
  // editoryal/içerik niteliğinde olduğundan (Open Graph çekirdek sözlüğünde "creative_work" gibi bir
  // tip yok) sosyal önizlemelerde en yakın karşılığı "article"dır (bkz. src/index.js#injectMeta).
  return { title, description, canonicalUrl, image: images[0] || DEFAULT_IMAGE, jsonLd, ogType: 'article', breadcrumbJsonLd: breadcrumbJsonLd('project', p.title, canonicalUrl) };
}

// Ürün/malzeme künyesinden ({title, brand, category, description, images}) ortak meta şekli üretir —
// hem canonical `products` tablosu satırları hem eski üye-gönderisi kökenli product_submissions/
// material_submissions satırları (bkz. buildProductMeta) aynı şekli taşıdığından paylaşılabilir.
function productMetaFromRecord(record, canonicalUrl) {
  const title = `${record.title} — MİMARLAB`;
  const rawDesc = record.description || `${record.title}${record.brand ? ' — ' + record.brand : ''}. MİMARLAB'da ürün detaylarını incele.`;
  const description = truncate(rawDesc, 200);
  const images = (record.images || []).map(absoluteUrl).filter(Boolean);
  const jsonLd = { '@context': 'https://schema.org', '@type': 'Product', name: record.title, url: canonicalUrl };
  if (record.description) jsonLd.description = record.description;
  // gerçek bulgu (denetim raporu): fotoğrafsız bir ürün/malzeme kaydında (spec-sheet-only başvuru)
  // bu satır jsonLd.image'ı hiç set etmiyordu — Google Rich Results Product tipi için `image`'ı
  // zorunlu görüyor. meta.image (OG/Twitter) zaten DEFAULT_IMAGE'a düşüyor, JSON-LD de AYNI görsel
  // varsayılanını kullanmalı ki sayfada görünen içerikle tutarlı, geçerli bir Product şeması olsun.
  jsonLd.image = images.length ? images : [DEFAULT_IMAGE];
  if (record.brand) jsonLd.brand = { '@type': 'Brand', name: record.brand };
  // audit bulgusu: bu obje daha önce offers/aggregateRating/review'dan HİÇBİRİNİ taşımıyordu — Google
  // Product zengin sonuçları için (2023'ten beri) en az birini şart koşuyor. `products` tablosunda
  // fiyat kolonu hiç yok (ürün kataloğu bir e-ticaret listesi değil, bkz. schema.sql) — bu yüzden
  // `offers` UYDURULMUYOR (yanlış/eksik fiyat markup'ı Google'da manuel işlem riski taşır); bunun
  // yerine, ürünün GERÇEK kullanıcı puanlaması varsa (bkz. fetchProductAggregateRating) aggregateRating
  // eklenir — bu tek başına zengin sonuç uygunluğu için yeterli VE her zaman doğrulanabilir gerçek
  // veriye dayanır. Puanı olmayan ürünlerde Product şeması hâlâ bu üç alandan hiçbirini taşımaz.
  if (record.rating && record.rating.count > 0) {
    jsonLd.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Math.round(record.rating.average * 10) / 10,
      reviewCount: record.rating.count,
    };
  }
  // bkz. buildProjectMeta'daki AYNI og:type gerekçesi — ürün sayfaları için Open Graph'ın kendi
  // "product" tipi zaten var.
  return { title, description, canonicalUrl, image: images[0] || DEFAULT_IMAGE, jsonLd, ogType: 'product', breadcrumbJsonLd: breadcrumbJsonLd('product', record.title, canonicalUrl) };
}

// urun.html/rating-widget.js'in target_id olarak kullandığı ANAHTARLA (bkz. src/routes/product.js#
// ratingKeyFor) BİREBİR aynı üretim — buradan bilerek AYRI/yerel tutulur (proje.js/product.js'teki
// trLower/foldTr'nin her dosyada yerel tanımlı olmasıyla AYNI gerekçe, bkz. o dosyalardaki yorum):
// seo.js dosya başı notu route dosyalarından hiç import YAPMAMA kararını zaten açıklıyor.
function productRatingKeyFor(title, brand, submissionId) {
  if (submissionId) return `m-${submissionId}`;
  return slugify(`${title}-${brand || ''}`);
}

async function fetchProductAggregateRating(env, targetType, targetId) {
  if (!env || !env.DB || !targetId) return null;
  const row = await env.DB.prepare(
    `SELECT AVG(stars) AS average, COUNT(*) AS count FROM ratings WHERE target_type = ? AND target_id = ?`
  ).bind(targetType, targetId).first();
  if (!row || !row.count) return null;
  return { average: row.average, count: row.count };
}

// key: urun.html#productKey ile birebir aynı üretim — canonical D1 kayıtlarında slugify(title +
// '-' + brand) ya da doğrudan `slug`, eski üye-gönderisi kökenli kayıtlarda "m-<submissionId>".
// Önce "m-" biçimini eski submission tablolarında dener, yoksa canonical `products` tablosuna
// bakar (bkz. src/routes/product.js#handleProductDetailRoute'taki AYNI arama deseni: önce doğrudan
// slug eşleşmesi, yoksa id'siz eski anahtar formatıyla tam tarama). Statik urunler-data.js/
// malzemeler-data.js dizileri kaldırıldı (kullanıcı isteği) — Faz 3 migrasyonundan beri gerçek
// ürün/malzeme kataloğu zaten yalnızca burada (canonical products tablosu) yaşıyor.
async function buildProductMeta(key, env) {
  // "m-<submissionId>" biçimi kendi başına zaten canonical (submission satırlarının slug'ı yok) —
  // bu dal için key'den kurulan URL doğru. Aşağıdaki canonical `products` dalı ise artık row.slug
  // kullanır (bkz. findArchitectRow'daki AYNI denetim notu, 2026-08-14): findProductRow name/slug/
  // legacy_key/slugify(title-brand) alias'larından HERHANGİ biriyle eşleşebildiğinden, önceden
  // olduğu gibi ham `key`'i canonical sanmak aynı ürünün birden çok URL'den kendi kendine canonical
  // olmasına (duplicate content) yol açıyordu.
  const m = /^m-(.+)$/.exec(key);
  if (m && env && env.DB) {
    const id = m[1];
    const productRow = await env.DB.prepare(`SELECT * FROM product_submissions WHERE id = ? AND status = 'approved'`).bind(id).first();
    const isMaterial = !productRow;
    const row = productRow || await env.DB.prepare(`SELECT * FROM material_submissions WHERE id = ? AND status = 'approved'`).bind(id).first();
    if (row) {
      let images = [];
      try { images = row.images ? JSON.parse(row.images) : []; } catch { images = []; }
      const rating = await fetchProductAggregateRating(env, isMaterial ? 'material' : 'product', `m-${id}`);
      const canonicalUrl = `${SITE_ORIGIN}/urun/${encodeURIComponent(key)}`;
      return productMetaFromRecord({ title: row.title, brand: row.brand, description: row.description, images, rating }, canonicalUrl);
    }
  }

  const row = await findProductRow(env, key);
  if (!row) return null;
  const p = parseCanonicalRow('products', row);
  const canonicalUrl = `${SITE_ORIGIN}/urun/${encodeURIComponent(row.slug)}`;
  // rating-widget.js/product.js#handleProductListRoute'daki AYNI iki yol: legacy_key "submission:"
  // ile başlıyorsa gerçek anahtar m-<submissionId>'dir, aksi halde slugify(title-brand) türetilir.
  const isSubmissionMarker = typeof row.legacy_key === 'string' && row.legacy_key.startsWith('submission:');
  const submissionId = isSubmissionMarker ? row.legacy_key.slice('submission:'.length) : null;
  const ratingKey = productRatingKeyFor(p.title, p.brand_name_raw, submissionId);
  const rating = await fetchProductAggregateRating(env, row.kind === 'material' ? 'material' : 'product', ratingKey);
  return productMetaFromRecord({ title: p.title, brand: p.brand_name_raw, description: p.description, images: p.images, rating }, canonicalUrl);
}

const BUILDERS = { architect: buildArchitectMeta, office: buildOfficeMeta, project: buildProjectMeta, product: buildProductMeta };

// type: 'architect' | 'office' | 'project' | 'product'; slugOrId: URL'den çözülen slug/id.
// Kayıt bulunamazsa (veya D1 sorgusu hata verirse, bkz. aşağıdaki try/catch) null döner — çağıran
// taraf (src/index.js#serveDetailPage) mevcut jenerik placeholder meta'yı (şablonun kendi <title>/
// meta description'ı) olduğu gibi bırakır, ASLA 500 üretmez ya da boş/kırık etiket enjekte etmez.
// env artık dördü için de TEK veri kaynağı (bkz. yukarıdaki import yorumu) — product yalnızca
// eski "m-<submissionId>" biçimini önce eski submission tablolarında dener, aksi halde canonical
// `products` tablosuna bakar (bkz. buildProductMeta).
export async function buildMeta(type, slugOrId, env) {
  const builder = BUILDERS[type];
  if (!builder) return null;
  try { return await builder(slugOrId, env); } catch { return null; }
}

// /sitemap.xml için — mimar/ofis/proje URL'leri artık yalnızca D1'de yaşadığından (bkz. yukarıdaki
// Legacy Bundle Elimination Faz 1 yorumu) src/index.js#listCanonicalEntityUrls'ten gelir, burada
// eklenecek statik bir kaynak kalmadı.
export function listEntityUrls() {
  return [];
}
