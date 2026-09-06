import { slugify } from './slugify.js';
import { parseCanonicalRow } from './canonicalRead.js';
// isOfficeName — bkz. fetchUnlinkedProjectCredits aşağısı. src/routes/project.js#
// handleProjectDetailRoute ZATEN aynı fonksiyonu aynı amaçla (eski, office sütunu NULL olan
// project_submissions satırlarında bir ismin mimar mı firma mı olduğunu kestirmek) kullanıyor —
// ikinci bir sezgi yazmak yerine AYNI kaynak paylaşılır, aksi halde popup ile SSR farklı
// sınıflandırma üretebilirdi.
import { isOfficeName } from './projectPool.js';
import { officePath, isBrandUrlOffice } from './officeUrl.js';
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
// office-kind.js — bir `offices` satırının FİRMA mı MARKA mı olduğunun TEK kaynağı (bkz. o dosyanın
// başı). Popup künyesi bu ayrıma göre "Hizmet Alanı" ya da "Ürün Kategorisi" yazar ve marka
// profilinde tamamen farklı bölümler gösterir (Ürünler / Markanın Kullanıldığı Projeler) — SSR
// meta'sı popup'ın gösterdiğini yansıtacaksa AYNI kaynaktan karar vermek zorunda (bkz. src/index.js#
// loadHubPool ve src/routes/office.js'teki AYNI import).
import officeKindJs from '../../office-kind.js';

const { parseLocationFull } = ilIlceJs;
const { isBrandOffice, officeCatList } = officeKindJs;

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

// denetim bulgusu (2026-08-22): proje/mimar/firma/ürün detay sayfalarının ham HTML body'si hiçbir
// gerçek içerik taşımıyordu — yalnızca <head>'deki JSON-LD'de vardı, JS çalışmadan (crawler/paylaşım
// botu/yavaş bağlantı) sayfa boş bir liste kabuğu olarak görünüyordu. Bu yardımcılar, injectMeta()'nın
// zaten D1'den okuduğu AYNI veriyle (yeni bir sorgu AÇMADAN) görünür, escape'lenmiş bir HTML parçası
// üretir — src/index.js#injectMeta bunu #ssr-entity-body konteynerine enjekte eder. Client-side modal
// (bkz. js/components/*-modal.js) bunun üstüne tam ekran bir overlay açtığından (modal-shell.js#
// .modal-shell-overlay: position:fixed, inset:0, z-index:150) bu içerik JS yüklendikten sonra
// görsel olarak kaybolur — çakışma yok, yalnızca JS'ten ÖNCE/JS'siz gösterilen gerçek bir fallback.
// escapeHtml burada da (bkz. src/lib/newsletterNotify.js/src/routes/contact.js'teki AYNI yerel kopya
// deseni — proje kuralı gereği merkezi bir yardımcı modüle taşınmıyor) tek, tüm bağlamlar için
// (metin + öznitelik) yeterli tek-fonksiyonlu escape kalıbını izler.
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// facts: [label, valueHtml][] — valueHtml zaten escape edilmiş/güvenli olmalı (çağıran taraf
// sorumlu). null/boş value'lu satırlar sessizce atlanır.
function factsListHtml(facts) {
  const rows = facts.filter(([, v]) => v);
  if (!rows.length) return '';
  return `<dl class="ssr-facts">${rows.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
}

function internalLink(path, name) {
  return `<a href="${escapeHtml(path)}">${escapeHtml(name)}</a>`;
}

// =============================================================================================
// POPUP KÜNYE SÖZLEŞMESİ (kullanıcı isteği, 2026-09-05: "her popupın SEO verisi popupın içinden
// alınsın")
// =============================================================================================
// Bu dosyanın ürettiği SSR gövdesi + JSON-LD, kullanıcının GERÇEKTE gördüğü popup künyesiyle aynı
// alanları, AYNI ETİKETLERLE ve aynı biçimde taşımalı. Denetimde (2026-09-05, canlı popup'lar tek
// tek açılarak) ayrıştıkları yerler:
//   kişi  : popup "Doğum Tarihi / Üniversite / Meslek / Ödüller" gösterirken SSR "Okul / Bölüm"
//           yazıyordu; dob ve ödüller HİÇ yoktu (bkz. js/components/architect-modal.js#infoFacts).
//   firma : popup "Konum"u ilçe-önce biçimliyor (Sarıyer, İstanbul) ve cats satırını gösteriyordu;
//           SSR ham "İstanbul / Sarıyer" yazıyor, cats'i hiç göstermiyordu.
//   marka : popup MARKA kimliğiyle açılıyor (Ürün Kategorisi + Ürünler + Markanın Kullanıldığı
//           Projeler); SSR bunu sıradan bir firma sanıyordu — markanın 148 ürününe giden TEK bir
//           iç bağlantı bile yoktu.
//   ürün  : popup "Versiyonlar / Marka / Tasarımcı / Kategori / Yıl" gösterirken SSR yalnızca
//           "Marka / Kategori" taşıyordu (bkz. js/components/product-modal.js).
//   proje : popup üç AYRI eksen gösteriyor — Tür=discipline, Tip=category, Grup=type (bkz.
//           js/components/project-meta.js#renderMeta) — SSR ise category+type'ı tek bir "Tür"
//           satırında birleştiriyordu, yani ekrandaki eksen adlarıyla ÇELİŞİYORDU. Fotoğrafçı ve
//           "Kullanılan Ürünler/Markalar" da SSR'de hiç yoktu.
// Aşağıdaki yardımcılar, ilgili popup dosyasındaki mantığın sunucu tarafı eşleridir; her birinin
// üstünde hangi dosyadaki hangi fonksiyonu yansıttığı yazılıdır — ikisi ayrışırsa hangisinin
// güncelleneceği belli olsun diye.

// js/components/office-modal.js#formatLocationDistrictFirst ile BİREBİR aynı: "İstanbul / Sarıyer"
// → "Sarıyer, İstanbul". (parseLocationFull burada KULLANILMAZ: o, il/ilçe referans tablosuna
// bakıp eşleşmeyen değeri düşürür; popup ise ham metni her zaman gösterir.)
function locationDistrictFirst(loc) {
  const m = /^([^/]+?)\s*\/\s*(.+)$/.exec(loc || '');
  return m ? `${m[2].trim()}, ${m[1].trim()}` : (loc || '');
}

// js/components/project-meta.js#renderMeta'nın "Yer:" satırı — ofis künyesinden FARKLI bir kaynak
// kullanır: proje konumu il/ilçe referans tablosuyla ayrıştırılır (parseLocationFull) ve ilçe önce
// yazılır ("Güzelbahçe, İzmir"). Tablo hiçbir şehir çözemezse (ör. yurt dışı konumlar) ham metne
// düşülür — popup'ta boş kalan satır yerine SSR'de bilgiyi korumak tercih edilir.
function projectLocationText(loc) {
  if (!loc) return '';
  const info = parseLocationFull(loc);
  if (info.city) return info.district ? `${info.district}, ${info.city}` : info.city;
  return loc;
}

// js/components/architect-modal.js#DEPT_TO_PROFESSION — popup'ın "Meslek" satırı profession boşsa
// bölümden türetir; SSR aynı satırı ürettiğine göre aynı tabloya ihtiyacı var.
const DEPT_TO_PROFESSION = {
  'Mimarlık': 'Mimar',
  'İç Mimarlık': 'İç Mimar',
  'İç Mimarlık ve Çevre Tasarımı': 'İç Mimar',
  'Peyzaj Mimarlığı': 'Peyzaj Mimarı',
  'Şehir ve Bölge Planlama': 'Şehir Plancısı',
  'Restorasyon': 'Restoratör',
};

// awards/cats gibi "JSON dizi ya da düz metin" olabilen alanları popup'ın gösterdiği tek satıra
// indirger (bkz. canonicalRead.js#JSON_FIELDS — parse edilmiş olabilir, edilmemiş de olabilir).
function textList(value, sep = ', ') {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean).join(sep);
  const text = String(value == null ? '' : value).trim();
  return text || '';
}

// social_links: [{platform, url}] (bkz. src/routes/office.js#handleOfficeRoute yanıtı). Popup bu
// bağlantıları ikon satırı olarak gösterir — JSON-LD'de karşılığı sameAs'tir.
function socialUrls(socialLinks) {
  if (!Array.isArray(socialLinks)) return [];
  return socialLinks.map(s => safeHttpUrl(s && s.url)).filter(Boolean);
}

// js/components/product-modal.js#buildVariantGroups'un sunucu eşi — versiyon eksenlerini (Ölçü,
// Ayak Tipi…) varyant dizisinden türetir, TEK DEĞERLİ eksenleri eler (popup'ta da tıklanabilir bir
// seçim olmadıkları için gösterilmezler), hiç eksen yoksa versiyon adlarının kendisine düşer.
function variantGroups(variants) {
  if (!Array.isArray(variants) || variants.length < 2) return [];
  const groups = [];
  const byLabel = new Map();
  variants.forEach(v => ((v && v.options) || []).forEach(o => {
    if (!o || !o.label || !o.value) return;
    let g = byLabel.get(o.label);
    if (!g) { g = { label: o.label, values: [] }; byLabel.set(o.label, g); groups.push(g); }
    if (!g.values.includes(o.value)) g.values.push(o.value);
  }));
  const multi = groups.filter(g => g.values.length > 1);
  if (multi.length) return multi;
  const labels = variants.map(v => (v && v.label) || '').filter(Boolean);
  return labels.length > 1 ? [{ label: 'Versiyon', values: labels }] : [];
}

// SEO denetimi (2026-09-03, D1'de doğrudan sayıldı): 736 görünür firma kaydının 82'sinde `about`
// alanı 60 karakterin ALTINDA ve neredeyse tamamı FİRMANIN KENDİ ADININ TEKRARI — offices.about =
// "Designnobis", "MDM Mimarlık", "Tures Mimarlık". Bu değerler `about || fallback` kalıbıyla
// okunduğu için meta description olarak aynen servis ediliyordu, yani /firma/designnobis sayfasının
// Google'a anlattığı tek şey "Designnobis" idi. Aynı durum 1 proje kaydında var, ürünlerde yok.
//
// Eşik veriyi DEĞİŞTİRMEZ — yalnızca "bu alan meta description olarak kullanılabilir mi" sorusunu
// yanıtlar; kısa metin sayfanın kendi görünür gövdesinde (bodyHtml) gösterilmeye devam eder.
const MIN_MEANINGFUL_DESCRIPTION = 60;
function meaningfulText(value) {
  const text = String(value == null ? '' : value).trim();
  return text.length >= MIN_MEANINGFUL_DESCRIPTION ? text : null;
}

// gerçek bulgu (denetim raporu, 2026-08-16): <title> hiçbir yerde uzunluk sınırına kırpılmıyordu —
// çok uzun mimar/firma/proje/ürün adlarında (ör. cümle uzunluğunda proje başlıkları) Google'ın SERP'te
// gösterdiği pratik ~60 karakterlik sınırı aşılıp başlık ortasından kesilebiliyordu. Sabit " — MİMARLAB"
// soneki HER ZAMAN görünür kalsın diye kırpma yalnızca ada/başlığa uygulanır, sonek payı düşülerek.
const TITLE_SUFFIX = ' — MİMARLAB';
const TITLE_MAX = 60;
function pageTitle(name) {
  return `${truncate(name, TITLE_MAX - TITLE_SUFFIX.length)}${TITLE_SUFFIX}`;
}

// created_at kolonu SQLite datetime('now') formatındadır ('YYYY-MM-DD HH:MM:SS', UTC, T/Z yok) —
// Open Graph'ın article:published_time'ı ISO 8601 bekler (bkz. aşağıdaki buildProjectMeta).
function toIso8601(sqliteDatetime) {
  if (!sqliteDatetime) return null;
  return sqliteDatetime.includes('T') ? sqliteDatetime : `${sqliteDatetime.replace(' ', 'T')}Z`;
}

// Katalog sayfası etiket/yolu — ilgili *-detay.html'deki görünür .breadcrumb-bar zinciriyle
// (ör. proje-detay.html "Ana Sayfa › Projeler › <başlık>") BİREBİR aynı olmalı; Google yapılandırılmış
// verinin sayfada görünen içerikle tutarlı olmasını bekler (bkz. structured data guidelines).
const CATALOG_CRUMB = {
  architect: { label: 'Kişiler', path: '/kisi' },
  office: { label: 'Firmalar', path: '/firma' },
  project: { label: 'Projeler', path: '/proje' },
  product: { label: 'Ürün', path: '/urun' },
};
// crumbOverride: saf marka profillerinde ikinci basamak "Firmalar › /firma" değil "Markalar ›
// /marka" olmalı — kanonik URL de /marka/:slug (bkz. src/lib/officeUrl.js), aksi halde
// yapılandırılmış veri sayfanın kendi kimliğiyle çelişirdi.
function breadcrumbJsonLd(type, name, canonicalUrl, crumbOverride) {
  const catalog = crumbOverride || CATALOG_CRUMB[type];
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

// SEO denetimi (2026-09-03, canlı Googlebot taraması): kişi ve firma profillerinin SSR gövdesi
// SADECE firma↔kurucu bağını taşıyordu — bir mimarın/ofisin KENDİ PROJELERİNE tek bir crawlable
// bağlantısı yoktu. Sonuç: 1.697 proje sayfası crawl grafiğinde YETİM kalıyor, Google'a yalnızca
// sitemap üzerinden ulaşıyor; entity ilişkisi (Person→CreativeWork, Organization→CreativeWork)
// hiçbir yerde HTML olarak ifade edilmiyordu. project_designers zaten bu kenarı taşıyor (2.832
// satır; 463 mimar + 384 ofis proje bağı var), yani üretilen her bağlantı GERÇEK bir D1 ilişkisidir
// — uydurma/tahmini link yoktur.
//
// hidden_at/deleted_at filtresi ZORUNLU: arşivlenmiş projeler canlıda 410 döner (bkz. 2026-09-03
// manifest düzeltmesi), sitemap'te de yoklar — profilden onlara link vermek Google'a 410'a giden
// ölü bağlantı sunardı.
const RELATED_PROJECT_LIMIT = 12;
async function fetchDesignerProjects(env, { architectId = null, officeId = null }) {
  if (!env || !env.DB) return [];
  const id = architectId || officeId;
  if (!id) return [];
  // Kolon adı sabit iki değerden biri (kullanıcı girdisi DEĞİL) — id her zaman bind edilir.
  const column = architectId ? 'architect_id' : 'office_id';
  try {
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT p.slug, p.title FROM project_designers pd
       JOIN projects p ON p.id = pd.project_id
       WHERE pd.${column} = ? AND p.deleted_at IS NULL AND p.hidden_at IS NULL
         AND p.slug IS NOT NULL AND p.slug != '' AND p.title IS NOT NULL AND p.title != ''
       ORDER BY COALESCE(p.project_date, '') DESC, p.title
       LIMIT ${RELATED_PROJECT_LIMIT}`
    ).bind(id).all();
    return (results || []).map(r => ({ slug: r.slug, title: r.title }));
  } catch { return []; }
}

function projectLinksHtml(projects) {
  if (!projects || !projects.length) return null;
  return projects.map(p => internalLink(`/proje/${encodeURIComponent(p.slug)}`, p.title)).join(', ');
}

// Popup'taki yatay şeritler (Ürünler / Markanın Kullanıldığı Projeler / Kullanılan Ürünler) SSR
// gövdesinde düz bağlantı listesine iner. RELATED_PROJECT_LIMIT ile AYNI gerekçe: bir marka
// sayfasına 148 bağlantının tamamını basmak sayfa ağırlığını ve "link spam" görüntüsünü artırır;
// listenin devamına popup'ın kendi "Tümünü gör" şeridinden ulaşılır. Kesme YAPILDIYSA gövdede
// "+N daha" olarak GÖRÜNÜR yazılır — sessizce kırpılmış bir liste, kullanıcıya popup'ta 148 ürün
// gösterilirken Google'a 24 göstermek demek olurdu.
const RELATED_ITEM_LIMIT = 24;
// Ürün künyesindeki "Teknik Özellikler" popup'ta katlanabilir bir bölümdür ve onlarca satır
// olabilir (ölçüler, malzemeler, sertifikalar) — meta gövdesi bir veri sayfası değil, künye
// özetidir; ilk satırlar ürünü tanımlamaya yeter.
const SPEC_LIMIT = 8;
function moreSuffix(total, shown) {
  return total > shown ? ` <span>+${total - shown} daha</span>` : '';
}

// src/routes/office.js#brandProductsRes ile AYNI eşleşme kuralı (brand_office_id VEYA marka adı) —
// popup'ın "Ürünler (148)" şeridi bu kümedir. total ayrı bir COUNT ile değil, LIMIT'siz slug/title
// seçiminden sayılır: aynı kümeden iki farklı sayı çıkma ihtimali olmasın (bkz. AYNI "tek kaynak"
// kuralı, src/routes/platform.js).
async function fetchBrandProducts(env, officeId, officeName) {
  if (!env || !env.DB || !officeId) return { items: [], total: 0 };
  try {
    const { results } = await env.DB.prepare(
      `SELECT slug, title FROM products
       WHERE deleted_at IS NULL AND hidden_at IS NULL AND slug IS NOT NULL AND slug != ''
         AND (brand_office_id = ? OR brand_name_raw = ? COLLATE NOCASE)
       ORDER BY title COLLATE NOCASE`
    ).bind(officeId, officeName).all();
    const all = (results || []).filter(r => r.slug && r.title);
    return { items: all.slice(0, RELATED_ITEM_LIMIT), total: all.length };
  } catch { return { items: [], total: 0 }; }
}

// src/routes/office.js#brandProjectsRes ile AYNI iki kenar türünün UNION'ı (ürün üzerinden +
// project_brands doğrudan kenarı) — popup'ın "Markanın Kullanıldığı Projeler" şeridi.
async function fetchBrandProjects(env, officeId, officeName) {
  if (!env || !env.DB || !officeId) return { items: [], total: 0 };
  try {
    const { results } = await env.DB.prepare(
      `SELECT p.slug, p.title, p.id AS pid
       FROM products pr
       JOIN project_products pp ON pp.product_id = pr.id
       JOIN projects p ON p.id = pp.project_id AND p.deleted_at IS NULL AND p.hidden_at IS NULL
       WHERE pr.deleted_at IS NULL AND pr.hidden_at IS NULL
         AND (pr.brand_office_id = ?1 OR pr.brand_name_raw = ?2 COLLATE NOCASE)
       UNION
       SELECT p.slug, p.title, p.id AS pid
       FROM project_brands pb
       JOIN projects p ON p.id = pb.project_id AND p.deleted_at IS NULL AND p.hidden_at IS NULL
       WHERE pb.office_id = ?1
       ORDER BY pid DESC`
    ).bind(officeId, officeName).all();
    const all = (results || []).filter(r => r.slug && r.title);
    return { items: all.slice(0, RELATED_ITEM_LIMIT), total: all.length };
  } catch { return { items: [], total: 0 }; }
}

// src/routes/project.js#fetchProjectProducts ile AYNI iki küme — popup'ın "Kullanılan Ürünler" ve
// "Kullanılan Markalar" sütunları. Marka eşleşmesi orada olduğu gibi önce brand_office_id, o boşsa
// marka ADI üzerinden kurulur; project_brands doğrudan kenarı UNION'lanır.
async function fetchProjectProductsAndBrands(env, projectId) {
  const empty = { products: { items: [], total: 0 }, brands: { items: [], total: 0 } };
  if (!env || !env.DB || !projectId) return empty;
  try {
    const [prodRes, brandRes] = await Promise.all([
      env.DB.prepare(
        `SELECT p.slug, p.title FROM project_products pp
         JOIN products p ON p.id = pp.product_id AND p.deleted_at IS NULL AND p.hidden_at IS NULL
         WHERE pp.project_id = ? AND p.slug IS NOT NULL AND p.slug != ''
         ORDER BY p.title COLLATE NOCASE`
      ).bind(projectId).all(),
      env.DB.prepare(
        `SELECT DISTINCT b.slug, b.name FROM project_products pp
         JOIN products pr ON pr.id = pp.product_id AND pr.deleted_at IS NULL AND pr.hidden_at IS NULL
         JOIN offices b ON b.deleted_at IS NULL AND b.hidden_at IS NULL
           AND (b.id = pr.brand_office_id OR (pr.brand_office_id IS NULL AND b.name = pr.brand_name_raw COLLATE NOCASE))
         WHERE pp.project_id = ?1
         UNION
         SELECT DISTINCT b.slug, b.name FROM project_brands pb
         JOIN offices b ON b.id = pb.office_id AND b.deleted_at IS NULL AND b.hidden_at IS NULL
         WHERE pb.project_id = ?1`
      ).bind(projectId).all(),
    ]);
    const products = (prodRes.results || []).filter(r => r.slug && r.title);
    const brands = (brandRes.results || []).filter(r => r.slug && r.name);
    return {
      products: { items: products.slice(0, RELATED_ITEM_LIMIT), total: products.length },
      brands: { items: brands.slice(0, RELATED_ITEM_LIMIT), total: brands.length },
    };
  } catch { return empty; }
}

// js/components/project-meta.js#photographerChipList'in sunucu eşi: künye metnindeki isimler
// (photo_credit_text, virgülle ayrılmış) + project_photographers kenarındaki kayıtlı fotoğrafçılar,
// AYNI sırayla ve AYNI tekilleştirmeyle (Türkçe küçük harf anahtarı). Kenarda eşleşen isim gerçek
// /kisi/:slug bağlantısı olur, eşleşmeyen düz metin kalır — popup'ın `unregistered` davranışı.
async function fetchProjectPhotographers(env, projectId, photoCreditText) {
  const text = String(photoCreditText || '').trim();
  let matched = [];
  if (env && env.DB && projectId) {
    try {
      const { results } = await env.DB.prepare(
        `SELECT a.name, a.slug FROM project_photographers pf
         JOIN architects a ON a.id = pf.architect_id AND a.deleted_at IS NULL AND a.hidden_at IS NULL
         WHERE pf.project_id = ?`
      ).bind(projectId).all();
      matched = (results || []).filter(r => r.name);
    } catch { matched = []; }
  }
  const byName = new Map(matched.map(r => [r.name.trim().toLocaleLowerCase('tr'), r]));
  const out = [];
  const seen = new Set();
  const push = (name, hit) => {
    const key = name.toLocaleLowerCase('tr');
    if (!name || seen.has(key)) return;
    seen.add(key);
    out.push({ name: hit ? hit.name : name, slug: hit ? hit.slug : null });
  };
  text.split(',').map(s => s.trim()).filter(Boolean).forEach(n => push(n, byName.get(n.toLocaleLowerCase('tr'))));
  matched.forEach(r => push(r.name.trim(), r));
  return out;
}

// js/components/product-modal.js#renderDesignerSection'ın sunucu eşi: products.designer SERBEST
// METİNDİR (virgülle ayrılmış), FK değil — popup her ismi architects tablosunda arar ve bulursa
// chip'i /kisi/:slug bağlantısına çevirir. Aynı eşleştirme burada TEK sorguda yapılır; eşleşmeyen
// isim düz metin kalır, tahmini/kırık bir URL üretilmez.
async function fetchDesignerLinks(env, designerText) {
  const names = String(designerText || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!names.length) return [];
  if (!env || !env.DB) return names.map(name => ({ name, slug: null }));
  try {
    const placeholders = names.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT name, slug FROM architects
       WHERE deleted_at IS NULL AND hidden_at IS NULL AND name IN (${placeholders})`
    ).bind(...names).all();
    const bySlug = new Map((results || []).map(r => [r.name.trim().toLocaleLowerCase('tr'), r.slug]));
    return names.map(name => ({ name, slug: bySlug.get(name.toLocaleLowerCase('tr')) || null }));
  } catch { return names.map(name => ({ name, slug: null })); }
}

function personLinksHtml(people) {
  if (!people || !people.length) return null;
  return people.map(p => (p.slug ? internalLink(`/kisi/${encodeURIComponent(p.slug)}`, p.name) : escapeHtml(p.name))).join(', ');
}
function productLinksHtml(list) {
  if (!list || !list.items.length) return null;
  return list.items.map(p => internalLink(`/urun/${encodeURIComponent(p.slug)}`, p.title)).join(', ') + moreSuffix(list.total, list.items.length);
}
function officeLinksHtml(list) {
  if (!list || !list.items.length) return null;
  return list.items.map(o => internalLink(`/firma/${encodeURIComponent(o.slug)}`, o.name)).join(', ') + moreSuffix(list.total, list.items.length);
}
function relatedProjectLinksHtml(list) {
  if (!list || !list.items.length) return null;
  return list.items.map(p => internalLink(`/proje/${encodeURIComponent(p.slug)}`, p.title)).join(', ') + moreSuffix(list.total, list.items.length);
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
// architect_slugs/office_slugs — SSR body'deki mimar/firma isimlerini gerçek `<a>` linkine
// çevirebilmek için (bkz. buildProjectMeta#bodyHtml) AYNI sorguya eklenen iki GRUP_CONCAT sütunu
// daha — yeni bir round-trip AÇMADAN, architect_names/office_names ile birebir aynı sırada döner
// (her ikisi de aynı LEFT JOIN'den, aynı GROUP BY p.id altında gelir).
async function findProjectRow(env, slug) {
  if (!env || !env.DB) return null;
  return env.DB.prepare(
    `SELECT p.*,
            GROUP_CONCAT(ar.name, '${DESIGNER_SEP}') AS architect_names,
            GROUP_CONCAT(ar.slug, '${DESIGNER_SEP}') AS architect_slugs,
            GROUP_CONCAT(ofc.name, '${DESIGNER_SEP}') AS office_names,
            GROUP_CONCAT(ofc.slug, '${DESIGNER_SEP}') AS office_slugs
     FROM projects p
     LEFT JOIN project_designers pd ON pd.project_id = p.id
     LEFT JOIN architects ar ON ar.id = pd.architect_id AND ar.deleted_at IS NULL
     LEFT JOIN offices ofc ON ofc.id = pd.office_id AND ofc.deleted_at IS NULL
     WHERE p.slug = ? AND p.deleted_at IS NULL AND p.hidden_at IS NULL
     GROUP BY p.id`
  ).bind(slug).first();
}

// SEO denetimi (2026-09-03) — GERÇEK BULGU, canlıda doğrulandı: findProjectRow künyeyi YALNIZCA
// project_designers'tan okuyor, oysa /api/project/:slug (popup) AYRICA project_submissions'ın
// serbest metin designer/office dizilerini de gösteriyor (bkz. src/routes/project.js#
// fetchRawDesignerNames — bir isim canonical bir architects/offices satırıyla eşleşmiyorsa
// canonicalSync onu project_designers'a HİÇ yazmaz, bkz. o dosyadaki CHECK kısıtı notu).
// Sonuç: canlıdaki 1.697 yayın projesinin 188'inde (%11) kullanıcı sayfada tam künyeyi GÖRÜYOR
// ama Googlebot'un gördüğü SSR gövdesinde "Mimar / Firma" satırı BOŞ, JSON-LD'de `creator` HİÇ
// YOK ve meta description'daki "... imzalı." cümlesi eksik. Örnek: /proje/villa-neox — popup'ta
// 4 mimar + Neos Studio görünürken JSON-LD'de creator alanı hiç üretilmiyordu.
//
// Bu fonksiyon YALNIZCA project_designers hiçbir isim vermediğinde çağrılır (188/1697 kayıt) ve
// yalnızca SSR cache MISS'inde çalışır — yani ek D1 maliyeti marjinaldir. Dönen isimlerin
// canonical bir slug'ı YOKTUR (zaten bu yüzden bağlanamadılar), bu yüzden ne JSON-LD'de `url`
// alırlar ne de gövdede <a> olurlar; popup'ın `unregistered: true` rozetsiz düz metin gösterimiyle
// BİREBİR aynı davranış. Uydurma/tahmini hiçbir URL üretilmez.
async function fetchUnlinkedProjectCredits(env, projectRow) {
  const submissionId = (projectRow.legacy_key || '').startsWith('submission:') ? projectRow.legacy_key.slice('submission:'.length) : '';
  // src/routes/project.js#fetchRawDesignerNames ile BİREBİR AYNI sorgu/eşleştirme (claimed_slug ya
  // da legacy_key="submission:<id>", en son güncellenen satır) — iki katman aynı künyeyi göstermeli.
  const row = await env.DB.prepare(
    `SELECT designer, office FROM project_submissions WHERE claimed_slug = ?1 OR id = ?2 ORDER BY updated_at DESC LIMIT 1`
  ).bind(projectRow.slug, submissionId).first().catch(() => null);
  if (!row) return { architectNames: [], officeNames: [] };
  const parseArr = (v) => { try { const p = v ? JSON.parse(v) : []; return Array.isArray(p) ? p.filter(n => typeof n === 'string' && n.trim()) : []; } catch { return []; } };
  const designers = parseArr(row.designer);
  // office sütunu NULL = migration 0030 ÖNCESİ kaydedilmiş satır; o dönemde Mimar/Firma kutuları
  // TEK bir designer dizisinde birleştiriliyordu, bu yüzden ayrım isOfficeName sezgisine düşer —
  // src/routes/project.js#handleProjectDetailRoute'un yaptığının AYNISI (bkz. oradaki "geriye
  // dönük bozmama amaçlı, TEK istisna" notu).
  if (row.office == null) {
    return {
      architectNames: designers.filter(n => !isOfficeName(n)),
      officeNames: designers.filter(n => isOfficeName(n)),
    };
  }
  return { architectNames: designers, officeNames: parseArr(row.office) };
}

// brand_office_name/brand_office_slug — ürünün brand_office_id'si eşleşen bir firma kaydına
// bağlıysa (bkz. buildProductMeta#bodyHtml) marka adını gerçek /firma/:slug linkine çevirebilmek
// için AYNI sorguya eklenen tek bir LEFT JOIN; eşleşme yoksa (serbest metin marka adı, bkz.
// products.brand_name_raw kolon yorumu) ikisi de NULL kalır, yeni bir round-trip AÇILMAZ.
async function findProductRow(env, key) {
  if (!env || !env.DB) return null;
  // bo.cats + markanın ürün SAYISI: markanın kanonik URL öneki (/firma/ mi /marka/ mi) buna bağlı
  // (bkz. src/lib/officeUrl.js, kullanıcı isteği 2026-09-06 madde 2). Bir ürünün markası tipik
  // olarak SAF markadır, yani bu bağlantı düzeltilmeseydi ürün sayfasındaki en önemli iç bağlantı
  // (ve JSON-LD Brand url'i) kalıcı olarak bir 301'e işaret ederdi.
  const joinSql = `FROM products p LEFT JOIN offices bo ON bo.id = p.brand_office_id AND bo.deleted_at IS NULL`;
  const row = await env.DB.prepare(
    `SELECT p.*, bo.name AS brand_office_name, bo.slug AS brand_office_slug, bo.cats AS brand_office_cats,
       (SELECT COUNT(*) FROM products pr WHERE pr.deleted_at IS NULL AND pr.hidden_at IS NULL
          AND (pr.brand_office_id = bo.id OR pr.brand_name_raw = bo.name COLLATE NOCASE)) AS brand_office_product_count
     ${joinSql} WHERE p.slug = ? AND p.deleted_at IS NULL AND p.hidden_at IS NULL`
  ).bind(key).first();
  if (row) return row;
  const { results } = await env.DB.prepare(`SELECT id, title, brand_name_raw FROM products WHERE deleted_at IS NULL AND hidden_at IS NULL`).all();
  const match = results.find(r => slugify(`${r.title}-${r.brand_name_raw || ''}`) === key);
  if (!match) return null;
  return env.DB.prepare(`SELECT p.*, bo.name AS brand_office_name, bo.slug AS brand_office_slug, bo.cats AS brand_office_cats,
       (SELECT COUNT(*) FROM products pr WHERE pr.deleted_at IS NULL AND pr.hidden_at IS NULL
          AND (pr.brand_office_id = bo.id OR pr.brand_name_raw = bo.name COLLATE NOCASE)) AS brand_office_product_count
     ${joinSql} WHERE p.id = ?`).bind(match.id).first();
}

// slug: kaydın GERÇEK canonical a.slug'ı (bkz. findArchitectRow'daki denetim notu) — çağıranın URL'de
// kullandığı ham anahtar (name/legacy_key alias'ı olabilir) DEĞİL, aksi halde aynı kayıt birden çok
// URL'den kendi kendine canonical olur (duplicate content). officeSlug de aynı gerekçeyle GERÇEK
// o.slug'tır; eşleşen bir ofis kaydı yoksa (ör. serbest metin ofis adı) slugify(officeName) fallback'ine
// düşer — önceki (tek) davranışla aynı, yalnızca gerçek bir eşleşme varken daha doğru URL üretir.
function architectMetaFromRecord(a, officeName, slug, officeSlug, projects = []) {
  const title = pageTitle(a.name);
  // SEO denetimi (2026-09-03): 953 kişi kaydının 767'sinde (%80) `about` boş ve bu kayıtlar meta
  // description olarak yalnızca "<ad> — MİMARLAB'da mimar profilini incele." şablonunu alıyordu.
  // 140 sayfalık canlı örneklemde 60 karakterin altında kalan 15 açıklamanın TAMAMI bu şablondu.
  // (Ölçüm notu: bunlar teknik olarak DUPLICATE DEĞİL — ad her sayfada farklı; örneklemde birebir
  // duplicate description sayısı sıfır. Sorun benzersizlik değil, açıklamanın arama sonucunda
  // hiçbir bilgi taşımaması.) Artık kişinin GERÇEK projelerinden (fetchDesignerProjects) örnek
  // başlıklar eklenir — uydurma değil, arama niyetiyle ("<mimar> projeleri") doğrudan örtüşen
  // içerik. Projesi olmayan kayıtlarda eski şablon aynen korunur.
  const sampleTitles = (projects || []).slice(0, 3).map(p => p.title).filter(Boolean);
  const baseDescription = officeName
    ? `${a.name}, ${officeName} bünyesinde ${a.role || 'mimar'} olarak görev yapmaktadır.`
    : `${a.name} — ${a.role || 'mimar'}.`;
  const description = truncate(
    sampleTitles.length
      ? `${baseDescription} MİMARLAB'da projeleri: ${sampleTitles.join(', ')}.`
      : `${baseDescription} MİMARLAB'da profilini incele.`,
    200);
  const canonicalUrl = `${SITE_ORIGIN}/kisi/${encodeURIComponent(slug)}`;
  const photoUrl = a.photo ? absoluteUrl(a.photo) : null;
  const jsonLd = { '@context': 'https://schema.org', '@type': 'Person', name: a.name, url: canonicalUrl };
  if (a.role) jsonLd.jobTitle = a.role;
  if (photoUrl) jsonLd.image = photoUrl;
  if (a.school) jsonLd.alumniOf = { '@type': 'CollegeOrUniversity', name: a.school };
  if (officeName) jsonLd.worksFor = { '@type': 'Organization', name: officeName, url: `${SITE_ORIGIN}/firma/${encodeURIComponent(officeSlug || slugify(officeName))}` };
  // Schema.org'da ayrı bir "Architect" tipi yok (bkz. vocabulary) — Person kalıp uzmanlık alanını
  // knowsAbout ile ifade ediyoruz, aksi halde geçersiz @type Google'ın yapılandırılmış veri
  // ayrıştırıcısı tarafından sessizce yok sayılırdı.
  // POPUP HİZALAMASI (bkz. "POPUP KÜNYE SÖZLEŞMESİ"): popup'ın Meslek satırı profession'ı, o boşsa
  // bölümden türetilmiş karşılığını gösterir — knowsAbout da artık AYNI değeri taşır (eskiden ham
  // a.dept'ti, yani ekranda "Mimar" yazarken yapılandırılmış veride "Mimarlık" duruyordu).
  const profession = a.profession || DEPT_TO_PROFESSION[a.dept] || null;
  if (profession) jsonLd.knowsAbout = [profession];
  else if (a.dept) jsonLd.knowsAbout = [a.dept];
  // dob canlıda YIL biçiminde tutuluyor ("1963") — ISO 8601 yıl gösterimi geçerli bir birthDate'tir.
  // Beklenmedik bir biçimde (serbest metin) alan HİÇ eklenmez: geçersiz bir tarih, eksik bir
  // tarihten kötüdür.
  if (a.dob && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(String(a.dob).trim())) jsonLd.birthDate = String(a.dob).trim();
  // Ödüller popup künyesinde GÖRÜNÜR bir satır; schema.org Person'da doğrudan karşılığı `award`.
  const awardList = Array.isArray(a.awards) ? a.awards.map(x => String(x).trim()).filter(Boolean) : [];
  if (awardList.length) jsonLd.award = awardList;
  const officeLink = officeName ? internalLink(`/firma/${encodeURIComponent(officeSlug || slugify(officeName))}`, officeName) : null;
  const bodyHtml = [
    a.about ? `<p>${escapeHtml(a.about)}</p>` : `<p>${escapeHtml(description)}</p>`,
    // Etiketler ve sıra js/components/architect-modal.js#infoFacts ile birebir: Doğum Tarihi,
    // Üniversite, Meslek, Ödüller. "Bölüm" (a.dept) popup künyesinden BİLEREK çıkarılmıştı (bkz. o
    // dosyadaki kullanıcı isteği notu) — SSR gövdesi de artık göstermez. Ünvan/Firma popup'ın
    // BAŞLIK satırında ("Kurucu · EAA (Emre Arolat Architecture)") görünür, bu yüzden kalır.
    factsListHtml([
      ['Ünvan', a.role ? escapeHtml(a.role) : null],
      ['Firma', officeLink],
      ['Doğum Tarihi', a.dob ? escapeHtml(String(a.dob)) : null],
      ['Üniversite', a.school ? escapeHtml(a.school) : null],
      ['Meslek', profession ? escapeHtml(profession) : null],
      ['Ödüller', awardList.length ? escapeHtml(awardList.join(', ')) : null],
      ['Projeler', projectLinksHtml(projects)],
    ]),
  ].filter(Boolean).join('');
  return { title, h1: a.name, description, canonicalUrl, image: photoUrl || DEFAULT_IMAGE, jsonLd, breadcrumbJsonLd: breadcrumbJsonLd('architect', a.name, canonicalUrl), bodyHtml, bodyImage: photoUrl, bodyImageAlt: a.name };
}

async function buildArchitectMeta(slug, env) {
  const row = await findArchitectRow(env, slug);
  if (!row) return null;
  const a = parseCanonicalRow('architects', row);
  const projects = await fetchDesignerProjects(env, { architectId: row.id });
  // dob/profession/awards — popup künyesinin gösterdiği alanlar (bkz. POPUP KÜNYE SÖZLEŞMESİ);
  // hepsi ZATEN okunan `architects` satırında, ek sorgu yok. awards parseCanonicalRow tarafından
  // JSON'dan diziye çevrilmiştir.
  return architectMetaFromRecord({
    name: a.name, role: a.position, photo: a.photo_url, school: a.school, dept: a.dept, about: a.about,
    dob: a.dob, profession: a.profession, awards: a.awards,
  }, row.office_name || null, row.slug, row.office_slug || null, projects);
}

// architectMetaFromRecord ile AYNI paylaşım deseni — canonical D1 offices satırı ortak şekle
// ({name, about, yil, loc, logo, website}) indirgenip tek fonksiyondan geçirilir.
async function officeMetaFromRecord(o, slug, env) {
  const title = pageTitle(o.name);
  const logoUrl = o.logo ? absoluteUrl(o.logo) : null;
  const jsonLd = { '@context': 'https://schema.org', '@type': 'Organization', name: o.name };
  if (o.about) jsonLd.description = o.about;
  if (o.yil) jsonLd.foundingDate = String(o.yil);
  if (o.loc) {
    // Popup "Konum"u ilçe-önce gösterir (Sarıyer, İstanbul); JSON-LD ise ham metin yerine
    // yapılandırılmış PostalAddress taşır. DİKKAT: offices.loc "İl / İlçe" biçimindedir
    // ("İstanbul / Sarıyer") — projelerin "İl (İlçe)" biçimini çözen parseLocationFull bunu TEK
    // parça sanıp addressRegion'a ham metni yazıyordu (uzak veriyle doğrulandı). Bu yüzden önce
    // eğik çizgi biçimi denenir (office-modal.js#formatLocationDistrictFirst ile AYNI ayrıştırma),
    // eşleşmezse referans tablosuna düşülür.
    const slash = /^([^/]+?)\s*\/\s*(.+)$/.exec(o.loc);
    const info = slash ? { city: slash[1].trim(), district: slash[2].trim() } : parseLocationFull(o.loc);
    const address = { '@type': 'PostalAddress' };
    if (info.district) address.addressLocality = info.district;
    if (info.city) address.addressRegion = info.city;
    if (!info.district && !info.city) address.addressLocality = o.loc;
    jsonLd.address = address;
  }
  if (logoUrl) jsonLd.logo = logoUrl;
  const site = safeHttpUrl(o.website);
  // sameAs — popup künyesinde GÖRÜNEN sosyal ikon satırının karşılığı (Instagram/Facebook/LinkedIn/
  // X/YouTube). Eskiden yalnızca website taşınıyordu; oysa bu bağlantılar Google'ın varlık
  // eşleştirmesi (entity reconciliation) için sameAs'in birincil kullanımıdır.
  const sameAs = [site, ...socialUrls(o.social_links)].filter(Boolean);
  if (sameAs.length) jsonLd.sameAs = [...new Set(sameAs)];
  // İki bağımsız okuma tek turda — kurucular ve firmanın projeleri birbirini beklemesin (bkz.
  // findArchitectRow'daki AYNI "N+1/sıralı round-trip açma" gerekçesi). Marka kataloğu da aynı
  // tura eklenir: FİRMA/MARKA ayrımı (office-kind.js#isBrandOffice) ürün SAYISINA bağlı olduğundan
  // bu okuma her ofis için zaten gerekli — popup'ın kendi isBrand kararı da aynı sayıdan gelir
  // (bkz. src/routes/office.js#handleOfficeRoute).
  const [founders, projects, brandProducts] = await Promise.all([
    fetchFounderNames(env, o.name),
    fetchDesignerProjects(env, { officeId: o.id }),
    fetchBrandProducts(env, o.id, o.name),
  ]);
  const isBrand = isBrandOffice(o.cats, brandProducts.total);
  // KANONİK URL burada — Promise.all'dan SONRA — hesaplanır, çünkü önek ürün SAYISINA bağlıdır:
  // saf markalar (office-kind.js#isPureBrandOffice: hiçbir mimarlık hizmeti sunmayan üreticiler)
  // /marka/:slug altında yaşar (kullanıcı isteği, 2026-09-06 madde 2, bkz. src/lib/officeUrl.js).
  // isBrand ile AYNI ŞEY DEĞİL: Autoban gibi hem mimarlık yapıp hem ürün tasarlayan kayıtlar
  // popup'ta marka bölümlerini görür ama URL'i /firma/:slug OLARAK KALIR.
  // src/index.js#serveDetailPage bu değeri okuyup yanlış önekle gelen istekleri 301'ler.
  const isBrandUrl = isBrandUrlOffice(o.cats, brandProducts.total);
  const canonicalUrl = `${SITE_ORIGIN}${officePath(slug, o.cats, brandProducts.total)}`;
  jsonLd.url = canonicalUrl;
  const catsText = textList(o.cats, ' · ');
  const catList = officeCatList(o.cats);
  if (isBrand) {
    // Bu profil popup'ta MARKA olarak açılıyor (başlık, claim metni, Düzenle hedefi hep marka
    // tarafı) — yapılandırılmış veri de bunu söylemeli. Organization'ı BIRAKMADAN çoklu tip
    // verilir: founder/foundingDate/address gibi alanlar Brand'de tanımlı değildir, tek tipe
    // geçmek onları geçersizleştirirdi.
    jsonLd['@type'] = ['Organization', 'Brand'];
  }
  if (catList.length) jsonLd.knowsAbout = catList;
  // Markanın kullanıldığı projeler YALNIZCA marka profillerinde okunur (canlıda 83 kayıt) — sıradan
  // bir firma sayfasına ek sorgu maliyeti getirmez.
  const brandProjects = isBrand ? await fetchBrandProjects(env, o.id, o.name) : { items: [], total: 0 };
  // description, projects'e bağlı olduğu için BURADA (Promise.all'dan sonra) hesaplanır — bkz.
  // architectMetaFromRecord'daki AYNI duplicate-description gerekçesi. `about` dolu olan 736
  // firmanın 661'inde eski davranış birebir korunur; yalnızca about'suz 75 kayıt gerçek proje
  // başlıklarıyla benzersizleşir.
  const officeSamples = projects.slice(0, 3).map(p => p.title).filter(Boolean);
  const officeBase = [o.name, o.loc || null, o.yil ? `${o.yil} kuruluşlu` : null].filter(Boolean).join(' — ');
  // Marka profillerinde örnek olarak PROJE değil ÜRÜN başlıkları verilir — popup'ta da öne çıkan
  // şerit "Ürünler"dir; bir mobilya markasının arama sonucunda proje adı sayması yanıltıcı olurdu.
  const brandSamples = brandProducts.items.slice(0, 3).map(p => p.title).filter(Boolean);
  const description = truncate(
    meaningfulText(o.about)
      || (isBrand && brandSamples.length
        ? `${officeBase}. MİMARLAB'da ürünleri: ${brandSamples.join(', ')}.`
        : officeSamples.length
          ? `${officeBase}. MİMARLAB'da projeleri: ${officeSamples.join(', ')}.`
          : `${officeBase}. MİMARLAB'da ${isBrand ? 'marka' : 'firma'} profilini incele.`),
    200);
  if (founders.length) {
    // founder.slug — bulunan kurucunun GERÇEK a.slug'ı (bkz. fetchFounderNames); eşleşen bir
    // architects satırı yoksa (teoride olmaz, join zaten architects üzerinden geliyor) slugify(name)
    // fallback'ine düşer — audit bulgusu: önceden HER ZAMAN slugify(name) kullanılıyordu, legacy
    // city-suffixed slug'larla (bkz. proje memory notu) uyuşmayabiliyordu.
    jsonLd.founder = founders.map(f => ({ '@type': 'Person', name: f.name, url: `${SITE_ORIGIN}/kisi/${encodeURIComponent(f.slug || slugify(f.name))}` }));
  }
  const foundersHtml = founders.length
    ? founders.map(f => internalLink(`/kisi/${encodeURIComponent(f.slug || slugify(f.name))}`, f.name)).join(', ')
    : null;
  const bodyHtml = [
    o.about ? `<p>${escapeHtml(o.about)}</p>` : `<p>${escapeHtml(description)}</p>`,
    // Etiketler ve sıra js/components/office-modal.js#infoFacts + popup bölüm başlıkları ile
    // birebir: Kurucular / Ortaklar, Kuruluş Yılı, Konum (ilçe-önce), Hizmet Alanı ya da MARKA
    // profilinde Ürün Kategorisi, ardından markanın ürünleri ve kullanıldığı projeler.
    factsListHtml([
      ['Kurucular / Ortaklar', foundersHtml],
      ['Kuruluş Yılı', o.yil ? escapeHtml(String(o.yil)) : null],
      ['Konum', o.loc ? escapeHtml(locationDistrictFirst(o.loc)) : null],
      [isBrand ? 'Ürün Kategorisi' : 'Hizmet Alanı', catsText ? escapeHtml(catsText) : null],
      ['Ürünler', isBrand ? productLinksHtml(brandProducts) : null],
      ['Projeler', projectLinksHtml(projects)],
      ['Markanın Kullanıldığı Projeler', isBrand ? relatedProjectLinksHtml(brandProjects) : null],
      ['Website', site ? `<a href="${escapeHtml(site)}" rel="nofollow noopener" target="_blank">${escapeHtml(site.replace(/^https?:\/\//, ''))}</a>` : null],
    ]),
  ].filter(Boolean).join('');
  return { title, h1: o.name, description, canonicalUrl, image: logoUrl || DEFAULT_IMAGE, jsonLd, breadcrumbJsonLd: breadcrumbJsonLd('office', o.name, canonicalUrl, isBrandUrl ? { label: 'Markalar', path: '/marka' } : null), bodyHtml, bodyImage: logoUrl, bodyImageAlt: o.name };
}

// slug: kaydın GERÇEK canonical o.slug'ı — bkz. findArchitectRow'daki AYNI denetim notu
// (2026-08-14); çağıranın URL'de kullandığı ham anahtar (name/legacy_key alias'ı olabilir) DEĞİL.
async function buildOfficeMeta(slug, env) {
  const row = await findOfficeRow(env, slug);
  if (!row) return null;
  const o = parseCanonicalRow('offices', row);
  // cats/social_links — popup künyesinin gösterdiği alanlar (Hizmet Alanı / Ürün Kategorisi satırı
  // ve sosyal ikon şeridi); ikisi de ZATEN okunan `offices` satırında, ek sorgu yok.
  return officeMetaFromRecord({
    id: row.id, name: o.name, about: o.about, yil: o.yil, loc: o.loc, logo: o.logo_url, website: o.website,
    cats: o.cats, social_links: o.social_links,
  }, row.slug, env);
}

async function buildProjectMeta(slug, env) {
  const row = await findProjectRow(env, slug);
  if (!row) return null;
  const p = parseCanonicalRow('projects', row);
  const title = pageTitle(p.title);
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
  // SEO denetimi (2026-09-03) — `creator` girdileri yalnızca `name` taşıyordu, oysa AYNI sorgu
  // (findProjectRow) mimar/firma slug'larını da getiriyor ve bunlar zaten aşağıdaki görünür
  // designerLinksHtml'de gerçek /kisi/:slug ve /firma/:slug bağlantılarına çevriliyor. `url`
  // eklemek, Google'ın "Villa NeoX'un yaratıcısı" düğümünü sitedeki GERÇEK mimar/firma sayfasıyla
  // aynı varlık olarak birleştirmesini sağlar (entity reconciliation) — yeni hiçbir sorgu, uydurma
  // hiçbir veri gerektirmez; slug yoksa (teoride olmaz, aynı LEFT JOIN'den gelir) alan eklenmez,
  // kırık URL üretilmez. AYNI iki dizi aşağıda designerLinksHtml için de kullanıldığından burada
  // bir kez ayrıştırılıp paylaşılır.
  let architectNames = namesFromConcat(row.architect_names);
  let architectSlugs = namesFromConcat(row.architect_slugs);
  let officeNames = namesFromConcat(row.office_names);
  let officeSlugs = namesFromConcat(row.office_slugs);
  // bkz. fetchUnlinkedProjectCredits — project_designers HİÇBİR isim vermediyse künye serbest
  // metin olarak yalnızca project_submissions'ta yaşıyor olabilir (canlıdaki 188 proje). Slug
  // dizileri BİLEREK boş bırakılır: bu isimlerin canonical bir kaydı yok, aşağıdaki creator/
  // designerLinksHtml üreticileri slug yokken zaten url'siz/linksiz düz metne düşüyor.
  if (!architectNames.length && !officeNames.length) {
    const fallback = await fetchUnlinkedProjectCredits(env, row);
    architectNames = fallback.architectNames;
    officeNames = fallback.officeNames;
    architectSlugs = [];
    officeSlugs = [];
  }
  const creators = [
    ...architectNames.map((name, i) => architectSlugs[i]
      ? { '@type': 'Person', name, url: `${SITE_ORIGIN}/kisi/${encodeURIComponent(architectSlugs[i])}` }
      : { '@type': 'Person', name }),
    ...officeNames.map((name, i) => officeSlugs[i]
      ? { '@type': 'Organization', name, url: `${SITE_ORIGIN}/firma/${encodeURIComponent(officeSlugs[i])}` }
      : { '@type': 'Organization', name }),
  ];
  if (creators.length) jsonLd.creator = creators.length === 1 ? creators[0] : creators;
  // audit bulgusu: og:type tüm detay sayfalarında sabit "website" kalıyordu — proje sayfaları
  // editoryal/içerik niteliğinde olduğundan (Open Graph çekirdek sözlüğünde "creative_work" gibi bir
  // tip yok) sosyal önizlemelerde en yakın karşılığı "article"dır (bkz. src/index.js#injectMeta).
  // gerçek bulgu (denetim raporu, 2026-08-16): og:type="article" set edilirken Open Graph'ın article
  // ad alanı (article:published_time) hiç eşlik etmiyordu — Facebook/LinkedIn gibi paylaşım kartları
  // bu alanı bekleyebilir. article:author kasıtlı olarak EKLENMEDİ: OG'nin bu alanı bir Facebook
  // Profile URL'si bekler, mimar/firma sayfalarımız bu değil — yanlış/anlamsız bir değer uydurmak
  // eksik bırakmaktan daha kötü olurdu (JSON-LD'deki creator zaten doğru yazarlığı taşıyor).
  // architectLinksHtml/officeDesignerLinksHtml — isimleri (varsa) GERÇEK a.slug/o.slug'a (bkz. yukarıdaki
  // findProjectRow#architect_slugs/office_slugs) `<a>` linkine çevirir; bir isim için (teoride
  // olmaz, aynı LEFT JOIN'den gelir) slug yoksa düz escape'lenmiş metne düşer, kırık link üretmez.
  // (architectNames/architectSlugs/officeNames/officeSlugs yukarıda jsonLd.creator için zaten
  // ayrıştırıldı — aynı diziler burada tekrar kullanılır.)
  // Popup künyesinde bunlar İKİ AYRI çip grubudur ("Mimar:" ve "Mimarlık Firması:") — SSR gövdesi
  // de artık iki ayrı satır üretir; tek bir "Mimar / Firma" satırı, ekranda ayrılmış olan bilgiyi
  // birleştiriyordu.
  const architectLinksHtml = architectNames
    .map((name, i) => architectSlugs[i] ? internalLink(`/kisi/${encodeURIComponent(architectSlugs[i])}`, name) : escapeHtml(name))
    .join(', ') || null;
  const officeDesignerLinksHtml = officeNames
    .map((name, i) => officeSlugs[i] ? internalLink(`/firma/${encodeURIComponent(officeSlugs[i])}`, name) : escapeHtml(name))
    .join(', ') || null;
  const typeLabel = [...(p.category || []), ...(p.type || [])].join(', ') || null;
  // POPUP HİZALAMASI (bkz. "POPUP KÜNYE SÖZLEŞMESİ"): popup künyesi ÜÇ AYRI eksen gösterir —
  // Tür=discipline, Tip=category, Grup=type (bkz. js/components/project-meta.js#renderMeta). Eski
  // SSR gövdesi category+type'ı tek bir "Tür" satırında birleştiriyordu, yani ekranda "Tip: Ticari"
  // yazarken Googlebot "Tür: Ticari, Ofis / İş Merkezi" görüyordu — eksen adları çelişiyordu.
  // Fotoğrafçılar ve "Kullanılan Ürünler/Markalar" da popup'ta VAR, SSR'de hiç yoktu; ikisi de
  // gerçek kenar tablolarından okunur (uydurma veri yok) ve /kisi, /urun, /firma'ya crawlable iç
  // bağlantı üretir.
  const [photographers, used] = await Promise.all([
    fetchProjectPhotographers(env, row.id, p.photo_credit_text),
    fetchProjectProductsAndBrands(env, row.id),
  ]);
  const disciplineLabel = (p.discipline || []).join(' / ') || null;
  const categoryLabel = (p.category || []).join(' / ') || null;
  const groupLabel = (p.type || []).join(' / ') || null;
  const keywords = [...(p.discipline || []), ...(p.category || []), ...(p.type || [])].filter(Boolean);
  if (keywords.length) jsonLd.keywords = keywords;
  // Popup künyesindeki "Ödül:" satırı (projects.awards) — CreativeWork'te doğrudan karşılığı `award`.
  const projectAwards = (Array.isArray(p.awards) ? p.awards : []).map(a => String(a).trim()).filter(Boolean);
  if (projectAwards.length) jsonLd.award = projectAwards;
  // Fotoğrafçı: CreativeWork'te ayrı bir "photographer" alanı yok — katkı veren kişi `contributor`
  // ile ifade edilir. Kayıtlı bir /kisi profiline bağlıysa url de taşır (creator'daki AYNI kural).
  if (photographers.length) {
    jsonLd.contributor = photographers.map(f => (f.slug
      ? { '@type': 'Person', name: f.name, url: `${SITE_ORIGIN}/kisi/${encodeURIComponent(f.slug)}` }
      : { '@type': 'Person', name: f.name }));
  }
  // description, künye alanlarına (designerNames/typeLabel) bağlı olduğu için BURADA hesaplanır.
  // p.description yalnızca ANLAMLI uzunluktaysa kullanılır (bkz. meaningfulText — projelerde bu
  // durumda olan 1 kayıt var). Asıl kazanç, description'ı HİÇ olmayan projelerin eski jenerik
  // metin yerine gerçek künye verisi taşıması: konum, yıl, tür ve mimar/firma adları.
  // row.* yerine YUKARIDAKİ dizilerden okunur — aksi halde fetchUnlinkedProjectCredits fallback'i
  // (bkz. yukarısı) JSON-LD/gövdeye yansırken meta description'daki "... imzalı." cümlesi 188
  // projede yine boş kalırdı (kısmi düzeltme, en kolay gözden kaçacak yer).
  const designerNames = [...architectNames, ...officeNames];
  const generatedProjectDesc = [
    `${p.title}${p.location ? ' — ' + p.location : ''}${p.project_date ? ' (' + p.project_date + ')' : ''}.`,
    typeLabel ? `${typeLabel}.` : '',
    designerNames.length ? `${designerNames.slice(0, 3).join(', ')} imzalı.` : '',
    'MİMARLAB\'da proje detaylarını incele.',
  ].filter(Boolean).join(' ');
  const rawDesc = meaningfulText(p.description) || generatedProjectDesc;
  const description = truncate(rawDesc, 200);
  const bodyHtml = [
    // Görünür gövde metni HER ZAMAN kaydın kendi açıklamasını (kısa olsa da) tercih eder — eşik
    // yalnızca meta description içindir, sayfadaki içeriği sansürlemez.
    `<p>${escapeHtml(p.description || generatedProjectDesc)}</p>`,
    // Etiketler ve sıra js/components/project-meta.js#renderMeta + popup künye bölümleri ile
    // birebir: Mimar / Mimarlık Firması (ayrı çip grupları), Fotoğraf, Tür, Tip, Grup, Yer, Yıl,
    // ardından Kullanılan Ürünler / Kullanılan Markalar.
    factsListHtml([
      ['Mimar', architectLinksHtml],
      ['Mimarlık Firması', officeDesignerLinksHtml],
      ['Fotoğraf', personLinksHtml(photographers)],
      ['Tür', disciplineLabel ? escapeHtml(disciplineLabel) : null],
      ['Tip', categoryLabel ? escapeHtml(categoryLabel) : null],
      ['Grup', groupLabel ? escapeHtml(groupLabel) : null],
      ['Yer', p.location ? escapeHtml(projectLocationText(p.location)) : null],
      ['Yıl', p.project_date ? escapeHtml(p.project_date) : null],
      ['Ödül', projectAwards.length ? escapeHtml(projectAwards.join(' / ')) : null],
      ['Kullanılan Ürünler', productLinksHtml(used.products)],
      ['Kullanılan Markalar', officeLinksHtml(used.brands)],
    ]),
  ].filter(Boolean).join('');
  return { title, h1: p.title, description, canonicalUrl, image: images[0] || DEFAULT_IMAGE, jsonLd, ogType: 'article', publishedTime: toIso8601(row.created_at), breadcrumbJsonLd: breadcrumbJsonLd('project', p.title, canonicalUrl), bodyHtml, bodyImage: images[0] || null, bodyImageAlt: p.title };
}

// Ürün/malzeme künyesinden ({title, brand, category, description, images}) ortak meta şekli üretir —
// hem canonical `products` tablosu satırları hem eski üye-gönderisi kökenli product_submissions/
// material_submissions satırları (bkz. buildProductMeta) aynı şekli taşıdığından paylaşılabilir.
function productMetaFromRecord(record, canonicalUrl) {
  const title = pageTitle(record.title);
  // bkz. meaningfulText. Ürünlerde şu an 60 karakterin altında kayıt YOK (D1'de sayıldı) — eşik
  // burada koruyucu, asıl kazanç description'ı hiç olmayan kayıtların artık marka + kategori
  // taşıyan bir metin almasıdır.
  // Tasarımcı ve yıl, popup künyesinde GÖRÜNEN alanlardır — açıklaması olmayan kayıtlarda arama
  // sonucunda da ürünü ayırt eden asıl bilgi bunlardır ("Alp Nuhoğlu tasarımı, 2022").
  const designerNamesText = (record.designers || []).map(d => d.name).join(', ');
  const generatedProductDesc = [
    `${record.title}${record.brand ? ' — ' + record.brand : ''}.`,
    record.category ? `${record.category} kategorisinde.` : '',
    designerNamesText ? `${designerNamesText} tasarımı${record.year ? ` (${record.year})` : ''}.` : (record.year ? `${record.year}.` : ''),
    'MİMARLAB\'da ürün detaylarını, teknik bilgilerini ve kullanıldığı projeleri incele.',
  ].filter(Boolean).join(' ');
  const rawDesc = meaningfulText(record.description) || generatedProductDesc;
  const description = truncate(rawDesc, 200);
  const images = (record.images || []).map(absoluteUrl).filter(Boolean);
  const jsonLd = { '@context': 'https://schema.org', '@type': 'Product', name: record.title, url: canonicalUrl };
  if (record.description) jsonLd.description = record.description;
  // gerçek bulgu (denetim raporu): fotoğrafsız bir ürün/malzeme kaydında (spec-sheet-only başvuru)
  // bu satır jsonLd.image'ı hiç set etmiyordu — Google Rich Results Product tipi için `image`'ı
  // zorunlu görüyor. meta.image (OG/Twitter) zaten DEFAULT_IMAGE'a düşüyor, JSON-LD de AYNI görsel
  // varsayılanını kullanmalı ki sayfada görünen içerikle tutarlı, geçerli bir Product şeması olsun.
  jsonLd.image = images.length ? images : [DEFAULT_IMAGE];
  // SEO denetimi (2026-09-03) — buildProjectMeta#creator ile AYNI gerekçe: marka gerçek bir firma
  // kaydına bağlıysa (record.brandOfficeSlug, bkz. findProductRow#brand_office_slug — aşağıdaki
  // görünür brandHtml zaten bu slug'ı kullanıyor) Brand düğümüne `url` eklenir; böylece Google
  // ürünün markasını sitedeki /firma/:slug sayfasıyla AYNI varlık sayar. Eşleşme yoksa (serbest
  // metin marka adı) alan eklenmez — tahmini/kırık bir URL üretilmez.
  if (record.brand) {
    jsonLd.brand = record.brandOfficeSlug
      ? { '@type': 'Brand', name: record.brand, url: `${SITE_ORIGIN}${record.brandOfficePath || `/firma/${encodeURIComponent(record.brandOfficeSlug)}`}` }
      : { '@type': 'Brand', name: record.brand };
  }
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
  // brandHtml — record.brandOfficeSlug YALNIZCA canonical `products.brand_office_id` gerçek bir
  // firma kaydına eşleşiyorsa dolu gelir (bkz. findProductRow#brand_office_name/slug); eski
  // submission kökenli kayıtlarda (buildProductMeta'nın "m-<id>" dalı) hiç yok — o durumda marka
  // adı düz metin kalır, kırık/tahmini bir link üretilmez.
  const brandHtml = record.brand
    ? (record.brandOfficeSlug ? internalLink(record.brandOfficePath || `/firma/${encodeURIComponent(record.brandOfficeSlug)}`, record.brand) : escapeHtml(record.brand))
    : null;
  // POPUP HİZALAMASI (bkz. "POPUP KÜNYE SÖZLEŞMESİ"): popup künyesi Versiyonlar → Marka → Tasarımcı
  // → Kategori → Yıl → Teknik Özellikler sırasını gösterir (bkz. js/components/product-modal.js).
  // Eski SSR gövdesi yalnızca Marka + Kategori taşıyordu; tasarımcı adı ekranda GÖRÜNÜR bir çip
  // (ve kayıtlıysa /kisi bağlantısı) olmasına rağmen yapılandırılmış veride hiç yoktu.
  const groups = variantGroups(record.variants);
  const variantsText = groups.map(g => `${g.label}: ${g.values.join(' / ')}`).join(' · ') || null;
  const designerHtml = personLinksHtml(record.designers);
  const specRows = (Array.isArray(record.specs) ? record.specs : [])
    .filter(s => s && s.label && s.value)
    .slice(0, SPEC_LIMIT);
  const specsText = specRows.map(s => `${s.label}: ${s.value}`).join(' · ') || null;
  if (record.category) jsonLd.category = record.category;
  // Product.releaseDate ISO 8601 bekler; `year` canlıda "2022" biçiminde (yıl) tutulur. Serbest
  // metin bir değer alanı HİÇ eklemez — geçersiz tarih, eksik tarihten kötüdür.
  if (record.year && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(String(record.year).trim())) jsonLd.releaseDate = String(record.year).trim();
  // Tasarımcı/versiyon eksenleri/teknik özellikler: schema.org Product'ta bunların adlandırılmış bir
  // karşılığı YOK (Product bir CreativeWork değildir, `designer` alanı tanımlı değil) — geçersiz bir
  // alan uydurmak yerine sözlüğün bu iş için tanımladığı additionalProperty/PropertyValue kullanılır;
  // ad alanları popup'ta GÖRÜNEN etiketlerin aynısıdır.
  const additional = [
    ...(record.designers || []).length ? [{ '@type': 'PropertyValue', name: 'Tasarımcı', value: record.designers.map(d => d.name).join(', ') }] : [],
    ...groups.map(g => ({ '@type': 'PropertyValue', name: g.label, value: g.values.join(', ') })),
    ...specRows.map(s => ({ '@type': 'PropertyValue', name: String(s.label), value: String(s.value) })),
  ];
  if (additional.length) jsonLd.additionalProperty = additional;
  const bodyHtml = [
    `<p>${escapeHtml(rawDesc)}</p>`,
    factsListHtml([
      ['Versiyonlar', variantsText ? escapeHtml(variantsText) : null],
      ['Marka', brandHtml],
      ['Tasarımcı', designerHtml],
      ['Kategori', record.category ? escapeHtml(record.category) : null],
      ['Yıl', record.year ? escapeHtml(String(record.year)) : null],
      ['Teknik Özellikler', specsText ? escapeHtml(specsText) : null],
    ]),
  ].filter(Boolean).join('');
  return { title, h1: record.title, description, canonicalUrl, image: images[0] || DEFAULT_IMAGE, jsonLd, ogType: 'product', breadcrumbJsonLd: breadcrumbJsonLd('product', record.title, canonicalUrl), bodyHtml, bodyImage: images[0] || null, bodyImageAlt: record.title };
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
      return productMetaFromRecord({ title: row.title, brand: row.brand, category: row.category, description: row.description, images, rating }, canonicalUrl);
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
  // Puanlama ve tasarımcı eşleştirmesi birbirinden bağımsız — tek turda (bkz. AYNI "sıralı
  // round-trip açma" gerekçesi, findArchitectRow). designer/year/variants/specs ZATEN okunan
  // `products` satırındadır; yalnızca serbest metin tasarımcı adlarının /kisi karşılığı için bir
  // sorgu eklenir (popup'ın renderDesignerSection'da yaptığı AYNI eşleştirme).
  const [rating, designers] = await Promise.all([
    fetchProductAggregateRating(env, row.kind === 'material' ? 'material' : 'product', ratingKey),
    fetchDesignerLinks(env, p.designer),
  ]);
  return productMetaFromRecord({
    title: p.title, brand: p.brand_name_raw, brandOfficeSlug: row.brand_office_slug || null,
    brandOfficePath: row.brand_office_slug ? officePath(row.brand_office_slug, row.brand_office_cats, row.brand_office_product_count) : null,
    category: p.category, description: p.description, images: p.images, rating,
    designers, year: p.year, variants: p.variants, specs: p.specs,
  }, canonicalUrl);
}

const BUILDERS = { architect: buildArchitectMeta, office: buildOfficeMeta, project: buildProjectMeta, product: buildProductMeta };

// type: 'architect' | 'office' | 'project' | 'product'; slugOrId: URL'den çözülen slug/id.
// Kayıt bulunamazsa (veya D1 sorgusu hata verirse, bkz. aşağıdaki try/catch) null döner — çağıran
// taraf (src/index.js#serveDetailPage) mevcut jenerik placeholder meta'yı (şablonun kendi <title>/
// meta description'ı) olduğu gibi bırakır, ASLA 500 üretmez ya da boş/kırık etiket enjekte etmez.
// env artık dördü için de TEK veri kaynağı (bkz. yukarıdaki import yorumu) — product yalnızca
// eski "m-<submissionId>" biçimini önce eski submission tablolarında dener, aksi halde canonical
// `products` tablosuna bakar (bkz. buildProductMeta).
// admin panelin SEO sekmesinden (bkz. src/routes/admin.js#handleSeoAdmin) kaydedilen title/
// description override'ları — seo_overrides.entity_key HER ZAMAN kaydın GERÇEK canonical slug'ı
// (meta.canonicalUrl'in son parçası) ile anahtarlanır, çağıranın URL'de kullandığı ham alias
// (name/legacy_key) DEĞİL — aksi halde aynı kayda farklı alias'larla ulaşan istekler override'ı
// kaçırabilirdi (bkz. findArchitectRow/findOfficeRow'daki AYNI "gerçek slug" denetim notu).
async function applySeoOverride(type, meta, env) {
  if (!env || !env.DB || !meta) return meta;
  const key = decodeURIComponent(meta.canonicalUrl.split('/').pop());
  let override;
  try {
    override = await env.DB.prepare(
      `SELECT meta_title, meta_description FROM seo_overrides WHERE entity_type = ? AND entity_key = ?`
    ).bind(type, key).first();
  } catch { return meta; }
  if (!override) return meta;
  const next = { ...meta };
  if (override.meta_title) next.title = pageTitle(override.meta_title);
  if (override.meta_description) next.description = truncate(override.meta_description, 200);
  return next;
}

// buildMeta'nın "kayıt yok" (null) ile "arama BAŞARISIZ oldu" durumunu ayırt etmesini sağlar
// (kullanıcı isteği, 2026-09-01 madde 4). 2026-08-27 auditinde bu ayrım yalnızca LOGLANMIŞTI,
// davranış aynı kalmıştı: geçici bir D1 hatası (timeout/rate limit/kısa süreli kesinti) yayındaki
// GERÇEK bir kaydı 404'e düşürüyor, arama motoru o URL'yi indeksten atıyordu. Artık çağıran taraf
// (src/index.js#serveDetailPage) bunu yakalayıp 503 + Retry-After döner — arama motorları 503'ü
// GEÇİCİ kabul eder ve URL'yi indeksten düşürmeden yeniden dener.
export class MetaLookupError extends Error {
  constructor(type, slugOrId, cause) {
    super(`buildMeta failed for ${type}/${slugOrId}: ${cause?.message || String(cause)}`);
    this.name = 'MetaLookupError';
    this.cause = cause;
  }
}

export async function buildMeta(type, slugOrId, env) {
  const builder = BUILDERS[type];
  if (!builder) return null;
  try {
    const meta = await builder(slugOrId, env);
    return await applySeoOverride(type, meta, env);
  } catch (err) {
    // console.error korunur (Workers Logs zaten açık, bkz. wrangler.jsonc#observability) — artık
    // AYRICA fırlatılır ki çağıran "bulunamadı" ile "bakılamadı"yı ayırabilsin (bkz. yukarısı).
    console.error('buildMeta failed', { type, slugOrId, error: err?.message || String(err) });
    throw new MetaLookupError(type, slugOrId, err);
  }
}

// /sitemap.xml için — mimar/ofis/proje URL'leri artık yalnızca D1'de yaşadığından (bkz. yukarıdaki
// Legacy Bundle Elimination Faz 1 yorumu) src/index.js#listCanonicalEntityUrls'ten gelir, burada
// eklenecek statik bir kaynak kalmadı.
export function listEntityUrls() {
  return [];
}

// type -> tablo adı + eşleşme sütunları. architects/offices name/slug/legacy_key alias'larının
// HERHANGİ biriyle bulunabilir (bkz. find*Row'daki AYNI eşleşme deseni); projects yalnızca exact
// slug ile (bkz. findProjectRow — alias yok), products da yalnızca slug ile (findProductRow'un
// slugify-türetilmiş fallback taraması burada BİLEREK tekrarlanmaz — ek bir tam tablo taraması
// gerektirirdi, kapsam dışı bırakıldı; en yaygın erişim yolu zaten doğrudan slug).
const HIDDEN_CHECK_CONFIG = {
  architect: { table: 'architects', cols: ['name', 'slug', 'legacy_key'] },
  office: { table: 'offices', cols: ['name', 'slug', 'legacy_key'] },
  project: { table: 'projects', cols: ['slug'] },
  product: { table: 'products', cols: ['slug'] },
};

// buildMeta(type, key, env) null döndüğünde (kayıt bulunamadı) çağıran (src/index.js#serveDetailPage)
// bunu 404 mü yoksa 410 mu döneceğine karar vermek için kullanır — denetim bulgusu (2026-08-14):
// "hiç var olmamış" bir slug ile "admin tarafından bilerek gizlenmiş/silinmiş" bir slug önceden
// AYNI 404'ü alıyordu; arama motorları 410'u (kalıcı, bilinçli kaldırma) 404'ten (belki geçici)
// daha güçlü bir indeksten-çıkarma sinyali olarak yorumluyor. deleted_at/hidden_at FİLTRESİZ eşleşme
// varsa true — yani bu anahtar GERÇEKTEN bir kayda karşılık geliyordu, yalnızca artık görünür değil.
export async function isKnownButHidden(type, key, env) {
  if (!env || !env.DB || !key) return false;
  const config = HIDDEN_CHECK_CONFIG[type];
  if (!config) return false;
  try {
    const where = config.cols.map(c => `${c} = ?`).join(' OR ');
    const binds = config.cols.map(() => key);
    const row = await env.DB.prepare(
      `SELECT 1 FROM ${config.table} WHERE (${where}) AND (deleted_at IS NOT NULL OR hidden_at IS NOT NULL) LIMIT 1`
    ).bind(...binds).first();
    return !!row;
  } catch { return false; }
}
