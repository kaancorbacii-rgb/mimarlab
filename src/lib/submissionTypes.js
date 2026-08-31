import { slugify } from './slugify.js';
import projectTaxonomyJs from '../../project-taxonomy.js';
// bkz. yukarıdaki AYNI CJS-interop gerekçesi — hangi hizmet alanının firmaya, hangisinin markaya
// ait olduğunun TEK kaynağı (firma-ekle.html/marka-ekle.html AYNI dosyayı <script> ile okur).
import officeKindJs from '../../office-kind.js';

const { PROJECT_CATEGORY_OPTIONS, PROJECT_GROUP_OPTIONS } = projectTaxonomyJs;
const { OFFICE_SERVICE_CATS, BRAND_CATS, LEGACY_BRAND_CAT, officeCatList } = officeKindJs;
// firma-ekle.html + marka-ekle.html AYNI office_submissions tablosuna yazdığından whitelist iki
// listenin BİRLEŞİMİ olmalı; 'Ürün' geriye dönük olarak (mevcut 20 marka kaydı) kabul edilir.
const OFFICE_CATS_ALLOWED = new Set([...OFFICE_SERVICE_CATS, ...BRAND_CATS, LEGACY_BRAND_CAT]);

// proje.html "Kategori" filtresi (bkz. migrations/0038_project_concept_category.sql, kullanıcı
// isteği) — yalnızca build_status='concept' projelerde anlamlı, proje-ekle.html'deki seçeneklerle
// BİREBİR aynı 4 sabit değer (category/discipline/type alanlarındaki gibi ham görünen-metin olarak
// saklanır, ayrı bir id/label eşlemesi yok).
export const CONCEPT_CATEGORIES = new Set(['Öğrenci', 'Yarışma', 'Fikir', 'Konsept']);

// 4 gönderi tipinin ortak yapılandırması: tablo adı, kabul edilen alanlar,
// hangi alanların JSON dizisi olarak saklandığı ve zorunlu alanlar.
export const SUBMISSION_TYPES = {
  offices: {
    table: 'office_submissions',
    // cover_url: marka kapak görseli (bkz. migrations/0075_office_cover_url.sql, kullanıcı isteği
    // 2026-08-31 madde 6) — yalnızca marka-ekle.html gönderir, firma-ekle.html'de böyle bir alan yok;
    // gönderilmediğinde alan hiç yazılmaz (bkz. aşağıdaki genel alan döngüsü).
    fields: ['name', 'loc', 'cats', 'yil', 'website', 'about', 'logo_url', 'cover_url', 'awards', 'founders', 'team', 'claimed_profile_key', 'social_links'],
    // social_links: [{platform,url}] — awards/founders ile AYNI JSON dizi deseni (bkz. kullanıcı
    // isteği: "sosyal medya kutusunun yanına ekle butonu koy", migrations/0036_social_links.sql —
    // paralel bir oturumun tekli social_platform/social_url kolonları yerine bu tercih edildi,
    // bkz. kullanıcı isteği: "1'den fazla sosyal medya eklenebilsin"). team: Kurucular ile AYNI
    // desende serbest isim listesi (bkz. migrations/0048_office_team.sql) — kurucu olmayıp firmada
    // çalışabilecek kişiler, opsiyonel.
    arrayFields: ['awards', 'founders', 'team', 'social_links'],
    // cats: firma-ekle.html'de en az bir hizmet alanı işaretlenmeden gönderilemez (bkz. kullanıcı
    // isteği) — client tarafı doğrulamanın sunucu tarafı karşılığı, ' · ' ile ayrılmış boş olmayan
    // bir dize beklenir (validateRequired zaten boş/whitespace dizeyi reddeder).
    required: ['name', 'cats'],
    urlFields: ['website', 'logo_url', 'cover_url'],
  },
  projects: {
    table: 'project_submissions',
    fields: [
      'slug', 'title', 'category', 'type', 'discipline', 'location', 'locationDetail', 'date', 'dateBucket',
      'period', 'designer', 'office', 'photoCreditText', 'photoCreditUrl', 'description', 'images', 'brands',
      'claimed_slug', 'source_url', 'ai_generated', 'build_status', 'conceptCategory', 'awards', 'publishDate',
      'lat', 'lng', 'imageHotspots',
    ],
    // designer: yalnızca "Mimar" kutusundan gelen isimler; office: yalnızca "Firma" kutusundan
    // gelen isimler (bkz. migrations/0030_project_submission_office.sql) — artık BİRLEŞTİRİLMEZ,
    // hangi kutudan geldiği künye render'ına kadar korunur. awards: mimar-ekle.html/firma-ekle.html
    // ile AYNI JSON dizi deseni (bkz. migrations/0049_project_awards.sql).
    arrayFields: ['category', 'type', 'discipline', 'period', 'designer', 'office', 'images', 'brands', 'awards'],
    // imageHotspots — arrayFields'in NESNE karşılığı: kök değer bir dizi değil, görsel URL'sine göre
    // anahtarlanmış bir harita ({url: [{x,y,slug,title}]}, bkz. migrations/0076_project_image_
    // hotspots.sql). arrayFields'e konulsaydı normalizeSubmission onu `[nesne]` diye tek elemanlı bir
    // diziye sarardı; bu yüzden ayrı bir tür gerekiyor (bkz. normalizeSubmission/parseSubmissionRow).
    objectFields: ['imageHotspots'],
    required: ['title'],
    urlFields: ['photoCreditUrl', 'source_url'],
    urlArrayFields: ['images'],
  },
  products: {
    table: 'product_submissions',
    // architect KASITLI OLARAK burada yok — urun-ekle.html'deki Mimar kutusu kaldırıldı (bkz.
    // kullanıcı isteği), yerine designer/year (Tasarımcı/Yıl) geldi. Sütun schema.sql'de eski
    // kayıtlar için hâlâ duruyor, sadece artık bu listeden okunup yazılmıyor.
    // files: "Dosyalar (BIM, CAD, 3D, Katalog)" eki (bkz. migrations/0071_product_files.sql,
    // js/components/product-modal.js#renderFilesSection) — images İLE AYNI JSON dizi deseni, ama
    // öğeler düz URL string DEĞİL {url,filename,format,size} nesnesi olduğundan urlArrayFields'a
    // EKLENMEZ (isSafeUrlValue düz string bekler) — kendi doğrulaması findInvalidFilesField'de
    // (aşağıda) ayrıca yapılır.
    // projects: urun-ekle.html'deki "Kullanılan Projeler (opsiyonel)" kutusu — sitede halihazırda
    // yayımlanmış projelerden seçilen [{slug,title}] listesi (bkz. migrations/
    // 0072_product_project_links.sql, kullanıcı isteği). project_submissions.brands'in AYNADAKİ
    // karşılığı; onaylandığında src/lib/canonicalSync.js#resolveProductProjectLinks tarafından
    // project_products kenarına (from_product=1 ile) çevrilir. Serbest URL taşımadığından
    // urlArrayFields'a girmez, öğeleri düz string DEĞİL nesne olduğundan da girmemeli (bkz. files).
    fields: ['title', 'brand', 'designer', 'year', 'website', 'category', 'description', 'images', 'specs', 'files', 'projects', 'source_url', 'ai_generated'],
    arrayFields: ['images', 'specs', 'files', 'projects'],
    required: ['title', 'brand'],
    urlFields: ['website', 'source_url'],
    urlArrayFields: ['images'],
  },
  materials: {
    table: 'material_submissions',
    fields: ['title', 'brand', 'designer', 'year', 'website', 'category', 'description', 'images', 'specs', 'files', 'projects', 'source_url', 'ai_generated'],
    arrayFields: ['images', 'specs', 'files', 'projects'],
    required: ['title', 'brand'],
    urlFields: ['website', 'source_url'],
    urlArrayFields: ['images'],
  },
  architects: {
    table: 'architect_submissions',
    fields: [
      'name', 'dob', 'school', 'dept', 'office', 'position', 'profession', 'awards', 'photo_url', 'about', 'claimed_profile_key',
      'social_links',
    ],
    arrayFields: ['awards', 'social_links'],
    required: ['name'],
    urlFields: ['photo_url'],
  },
};

// Mimar/Firma ekle-düzenle sayfalarındaki Sosyal Medya kutucuğunun platform seçim listesi
// (bkz. kullanıcı isteği) — istemci (mimar-ekle.html/firma-ekle.html) VE burası
// (submissions.js#createSubmission/updateOwnSubmission) AYNI enum'u kullanır.
export const SOCIAL_PLATFORMS = new Set(['instagram', 'linkedin', 'x']);

// offices.cats — firma-ekle.html/marka-ekle.html'deki Hizmet Alanı kutucukları yalnızca izin verilen
// değerleri render eder ama bu tek başına yeterli değil (bkz. findInvalidProjectTaxonomyField'daki
// AYNI gerekçe: doğrudan API'ye gönderilen bir istek whitelist dışı bir değer taşıyabilir).
// Gönderim " · " ile ayrılmış düz bir string ya da JSON dizi olabilir — officeCatList ikisini de çözer.
export function findInvalidOfficeCats(type, body) {
  if (type !== 'offices') return null;
  if (!('cats' in body) || body.cats == null) return null;
  const values = officeCatList(body.cats);
  if (values.some(v => !OFFICE_CATS_ALLOWED.has(v))) return 'cats';
  return null;
}

export function findInvalidSocialPlatform(type, body) {
  if (!('social_platform' in body)) return false;
  const value = body.social_platform;
  return !!value && !SOCIAL_PLATFORMS.has(value);
}

// proje-ekle.html'deki Tip (category) ve Grup (type) kutuları artık ikisi de sabit listeden çoklu
// seçim (bkz. kullanıcı isteği: Grup'ta serbest metin/autocomplete tamamen kaldırıldı, project-
// taxonomy.js'teki 40 seçenekten biri/birkaçı). İstemci tarafı zaten bu listelerin DIŞINDA bir
// checkbox render ETMEZ, ama bu tek başına yeterli değil (bkz. kullanıcı isteği: "backend/API
// tarafında da doğrulama yap, sadece UI'a güvenme") — doğrudan API'ye (curl/eski önbelleklenmiş
// istemci) gönderilen bir istek hâlâ whitelist dışı bir değer taşıyabilir.
const PROJECT_CATEGORY_SET = new Set(PROJECT_CATEGORY_OPTIONS);
const PROJECT_GROUP_SET = new Set(PROJECT_GROUP_OPTIONS);
export function findInvalidProjectTaxonomyField(type, body) {
  if (type !== 'projects') return null;
  if ('category' in body) {
    const values = Array.isArray(body.category) ? body.category : (body.category ? [body.category] : []);
    if (values.some(v => !PROJECT_CATEGORY_SET.has(v))) return 'category';
  }
  if ('type' in body) {
    const values = Array.isArray(body.type) ? body.type : (body.type ? [body.type] : []);
    if (values.some(v => !PROJECT_GROUP_SET.has(v))) return 'type';
  }
  return null;
}

// denetim bulgusu: hiçbir gönderi alanında (ne istemci tarafı maxlength, ne sunucu tarafı bir
// kontrol) uzunluk üst sınırı yoktu — title/name/about/description gibi serbest metin alanlarına
// megabaytlarca metin gönderilip D1 satırını/publicCache.js#getCachedPool'un KV'de tuttuğu TÜM
// liste havuzunu şişirebilirdi (bkz. o dosyadaki "tüm havuz KV'de önbelleklenir" deseni — tek bir
// aşırı büyük satır tüm ürün/proje listesi sorgularını yavaşlatabilirdi). Yalnızca en sık kötüye
// kullanılabilecek alanlar için, gerçek/meşru içerikleri asla kesmeyecek kadar cömert sınırlar.
const FIELD_MAX_LENGTHS = {
  offices: { name: 200, about: 20000, loc: 300 },
  projects: { title: 300, description: 20000, location: 200, locationDetail: 300, photoCreditText: 300 },
  products: { title: 200, brand: 200, description: 20000 },
  materials: { title: 200, brand: 200, description: 20000 },
  architects: { name: 200, about: 20000, school: 200, dept: 200 },
};

export function findOversizedField(type, body) {
  const limits = FIELD_MAX_LENGTHS[type];
  if (!limits) return null;
  for (const field of Object.keys(limits)) {
    const value = body[field];
    if (typeof value === 'string' && value.length > limits[field]) return field;
  }
  return null;
}

// Üye ol / mimar-ekle-düzenle / hesabım "Üniversite" kutucuğuna kısaltma girilmesini engeller
// (bkz. kullanıcı isteği: "YTÜ, İTÜ, ODTÜ, MSGSÜ gibi kısaltmalara izin verme"). Türkçe üniversite
// kısaltmalarının neredeyse tamamı yalnızca büyük harflerle yazılır — bu yüzden değerde HİÇ küçük
// harf yoksa kısaltma sayılır (hardcoded bir liste yerine genel bir kural: yeni/az bilinen bir
// kısaltma da aynı şekilde yakalanır). Buna ek olarak (kullanıcı isteği: "Minimum 5 harf sınırı
// koy ama bunu belirtme" — sınır kullanıcıya asla bir ipucu/placeholder olarak gösterilmez, yalnızca
// sessizce reddedilir) 5 karakterden kısa her değer de reddedilir; bu ikisi BİRLİKTE MSGSÜ (5
// harf ama tamamı büyük) dahil örneklenen tüm kısaltmaları kapsar.
const MIN_SCHOOL_NAME_LENGTH = 5;
export function isInvalidSchoolValue(value) {
  const v = (value == null ? '' : String(value)).trim();
  if (!v) return false; // okul alanı opsiyonel — boş bırakmak geçerli
  if (v.length < MIN_SCHOOL_NAME_LENGTH) return true;
  return !/[a-zçğıöşü]/.test(v);
}

// Görsel/website/başvuru linki gibi alanlarda saklanan değerin, bir HTML özniteliğine
// (src="..."/href="...") gömüldüğünde tırnak kaçışıyla enjeksiyona izin vermeyecek güvenli bir
// bağlantı olduğunu garantiler: ya kendi /media/ yükleme yolumuz, ya da düz bir http(s) URL'i,
// ya da data.js'teki statik kayıtlarda kullanılan şemasız site-relative bir varlık yolu (ör.
// "mimarlar-thumb/x.jpg", "logos-thumb/x.jpg") — claim akışında (mimar-ekle/firma-ekle ?claim=)
// fotoğraf/logo değiştirilmeden gönderildiğinde payload'a bu haliyle geliyor. Şema/host taşıyan
// (":" içeren, ör. "javascript:...") ya da protokol-relative ("//host/...") değerler reddedilir.
// Anlamsız/zararlı biçimli girişleri (ör. içine `"` veya `javascript:` gömülü) daha veritabanına
// yazılmadan reddeder — istemci tarafındaki escapeHtml/escapeAttr'a tek başına güvenmek yerine.
export function isSafeUrlValue(value) {
  if (value === undefined || value === null || value === '') return true;
  const v = String(value);
  if (/["'<>]/.test(v)) return false;
  if (v.startsWith('/media/')) return true;
  try {
    const parsed = new URL(v);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return !v.includes(':') && !v.startsWith('//');
  }
}

// Bir gönderi body'sindeki url/urlArray alanlarının hepsinin güvenli biçimde olduğunu doğrular;
// geçersizse ilgili alan adını döner (yoksa null).
export function findInvalidUrlField(type, body) {
  const config = SUBMISSION_TYPES[type];
  for (const field of config.urlFields || []) {
    if (field in body && !isSafeUrlValue(body[field])) return field;
  }
  for (const field of config.urlArrayFields || []) {
    if (!(field in body)) continue;
    const values = Array.isArray(body[field]) ? body[field] : (body[field] ? [body[field]] : []);
    if (values.some(v => !isSafeUrlValue(v))) return field;
  }
  return null;
}

// "Dosyalar (BIM, CAD, 3D, Katalog)" eki — bkz. kullanıcı isteği: izin verilen format listesi +
// dosya başına/ürün başına/toplam boyut sınırları FRONTEND'e (urun-ekle.html) ek olarak BURADA
// (backend/API) da zorunlu uygulansın. src/routes/upload.js#FILE_UPLOAD_EXTENSIONS ve
// js/components/product-modal.js#FILE_TYPE_META İLE AYNI liste — bu kod tabanının kuralı gereği
// (bkz. dosya başı yorumları) üçü de bağımsız kopya, biri değişirse diğer ikisi de güncellenmeli.
export const PRODUCT_FILE_EXTENSIONS = new Set([
  'rfa', 'rvt', 'ifc', 'ifczip', // BIM
  'dwg', 'dxf', // CAD
  'skp', '3dm', 'obj', 'fbx', '3ds', 'stl', 'step', 'stp', 'iges', 'igs', // 3D
  'pdf', // Katalog
]);
export const MAX_PRODUCT_FILE_BYTES = 10 * 1024 * 1024; // dosya başına en fazla 10 MB
export const MAX_PRODUCT_FILES_COUNT = 5; // ürün başına en fazla 5 dosya
export const MAX_PRODUCT_FILES_TOTAL_BYTES = 30 * 1024 * 1024; // ürün başına toplam en fazla 30 MB

function fileExtensionOf(file) {
  const name = (file && (file.filename || file.name)) || '';
  const m = /\.([a-zA-Z0-9]+)$/.exec(String(name));
  if (m) return m[1].toLowerCase();
  return file && file.format ? String(file.format).toLowerCase().replace(/^\./, '') : '';
}

// body.files (varsa) yapısal olarak geçerli mi: her öğe {url, filename, format, size} biçiminde,
// url güvenli VE bizim /api/uploads/file ucumuzun döndürdüğü bir /media/ nesnesi, uzantı
// whitelist'te, dosya başına/toplam boyut ve adet sınırları aşılmamış. Geçersizse kullanıcıya
// gösterilecek Türkçe bir hata mesajı döner, geçerli/yoksa null.
export function findInvalidFilesField(type, body) {
  if (type !== 'products' && type !== 'materials') return null;
  if (!('files' in body) || body.files == null) return null;
  const files = body.files;
  if (!Array.isArray(files)) return 'Dosyalar alanı geçersiz.';
  if (files.length > MAX_PRODUCT_FILES_COUNT) return `En fazla ${MAX_PRODUCT_FILES_COUNT} dosya yükleyebilirsin.`;
  let total = 0;
  for (const f of files) {
    if (!f || typeof f !== 'object' || Array.isArray(f)) return 'Dosyalar alanı geçersiz.';
    if (!f.url || !isSafeUrlValue(f.url) || !String(f.url).startsWith('/media/')) return 'Geçersiz dosya bağlantısı.';
    if (!PRODUCT_FILE_EXTENSIONS.has(fileExtensionOf(f))) return 'İzin verilmeyen dosya formatı.';
    const size = Number(f.size);
    if (!Number.isFinite(size) || size <= 0 || size > MAX_PRODUCT_FILE_BYTES) return 'Dosya boyutu sınırı aşıldı (dosya başına en fazla 10 MB).';
    total += size;
  }
  if (total > MAX_PRODUCT_FILES_TOTAL_BYTES) return 'Toplam dosya boyutu sınırı aşıldı (en fazla 30 MB).';
  return null;
}

// body.projects (ürün/malzeme gönderilerindeki "Kullanılan Projeler" kutusu) yapısal olarak geçerli
// mi: her öğe {slug, title} biçiminde düz metin taşır. findInvalidFilesField ile AYNI gerekçe —
// arrayFields'a girdiği için JSON olarak olduğu gibi saklanıyor, öğe düz string DEĞİL nesne olduğundan
// urlArrayFields'ın isSafeUrlValue kontrolü buraya uygulanamaz; doğrudan API'ye gönderilen bir istek
// (curl/eski istemci) aksi halde buraya gelişigüzel bir yapı yazabilirdi.
const MAX_PRODUCT_PROJECTS_COUNT = 50;
export function findInvalidProjectsField(type, body) {
  if (type !== 'products' && type !== 'materials') return null;
  if (!('projects' in body) || body.projects == null) return null;
  const projects = body.projects;
  if (!Array.isArray(projects)) return 'Kullanılan Projeler alanı geçersiz.';
  if (projects.length > MAX_PRODUCT_PROJECTS_COUNT) return `En fazla ${MAX_PRODUCT_PROJECTS_COUNT} proje ekleyebilirsin.`;
  for (const p of projects) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return 'Kullanılan Projeler alanı geçersiz.';
    const slug = p.slug == null ? '' : p.slug;
    const title = p.title == null ? '' : p.title;
    if (typeof slug !== 'string' || typeof title !== 'string') return 'Kullanılan Projeler alanı geçersiz.';
    if (!slug.trim() && !title.trim()) return 'Kullanılan Projeler alanı geçersiz.';
    if (slug.length > 300 || title.length > 300) return 'Kullanılan Projeler alanı geçersiz.';
  }
  return null;
}

// Projeler sayfasındaki statik "N. Yüzyıl" / "N0'lar" bucket kuralıyla (bkz. projeler-data.js
// içindeki gerçek değerler) birebir eşleşen ondalık eki — Türkçe ünlü uyumuna göre her on yılın
// kendi doğru eki var (ör. "2020'ler" ama "2010'lar"); eskiden HER ZAMAN "'lar" kullanılıyordu, bu
// da statik verideki "2020'ler" gibi doğru değerlerle aynı on yıl için İKİ AYRI filtre seçeneği
// üretiyordu (bkz. gerçek bulgu).
const DECADE_SUFFIX = { 0: 'ler', 10: 'lar', 20: 'ler', 30: 'lar', 40: 'lar', 50: 'ler', 60: 'lar', 70: 'ler', 80: 'ler', 90: 'lar' };

// bkz. kullanıcı isteği: proje.html Yıl filtresindeki "Antik Çağ" ismi "Milattan Önce" olarak
// değişti, künyesi "MÖ"/"Milattan Önce" ile BAŞLAYAN her proje (statik/legacy elle etiketlenenler
// DIŞINDA, artık normalizeSubmission'dan geçen HER yeni/düzenlenen proje için de) buraya dinamik
// olarak düşer — bkz. aşağıdaki dateBucketFor.
export const BC_DATE_BUCKET = 'Milattan Önce';

function isBcDateString(dateStr) {
  const s = (dateStr || '').trim().toLowerCase();
  // GERÇEK BULGU: \b (kelime sınırı) JS regex'inde \w = [A-Za-z0-9_] baz alınır, Türkçe "ö" bu
  // kümede DEĞİLDİR — /^mö\b/ "mö 9600" gibi bir girdide "ö" ile boşluk arasında hiçbir sınır
  // bulamadığından SESSİZCE eşleşmiyordu (isBcDateString hep false dönüyordu). Boşluk/dize sonu
  // AÇIKÇA arandığında bu tuzağa düşülmez.
  return /^m[öo](\s|$)/.test(s) || s.startsWith('milattan önce') || s.startsWith('milattan once');
}

// bkz. kullanıcı isteği: "Projeler sayfasında Yıl filtresinin içindeki seçeneklerde 1750'ler ve
// 1700'lar seçeneklerini kaldır ... bunu engelle". Eski hali serbest metin "date" alanındaki İLK
// 4 haneli sayıyı alıp HER ZAMAN bir on yıl bucket'ı üretiyordu — bu iki gerçek soruna yol
// açıyordu: (1) 1900 öncesi bir yıl (ör. "1753-1756" tarihli bir cami) statik veride kullanılan
// "N. Yüzyıl" biçimi yerine "1750'lar" gibi tuhaf, tek seferlik bir bucket üretiyordu; (2) tarih
// aralığı ya da restorasyon tarihi olan projelerde (ör. "1700 / 2023") İLK sayı alındığından, 2023'te
// tamamlanan bir restorasyon "1700'ler" gibi anlamsız bir bucket'a düşüyordu. Şimdi: metindeki TÜM
// 4 haneli sayılardan EN BÜYÜĞÜ (en güncel/tamamlanma yılı) esas alınır; 1900 öncesiyse statik
// veriyle aynı "N. Yüzyıl" biçimi kullanılır.
//
// GERÇEK BULGU (bkz. kullanıcı isteği): "MÖ" (milattan önce) hiç ele alınmıyordu — "MÖ 9600" gibi
// bir tarihteki "9600" düz bir MS yılı sanılıp "9600'ler" gibi anlamsız bir bucket üretiyordu
// (Göbeklitepe). Künye "MÖ"/"Milattan Önce" ile BAŞLIYORSA (bkz. isBcDateString) — ikinci bir MS
// parçası olsa bile (ör. "MÖ 410 / 1725", Kız Kulesi) — artık koşulsuz BC_DATE_BUCKET döner; bu,
// kullanıcının "başından MÖ ... yazan HER proje bu kategoriye girsin" isteğiyle birebir eşleşir.
export function dateBucketFor(dateStr) {
  if (isBcDateString(dateStr)) return BC_DATE_BUCKET;
  const matches = (dateStr || '').match(/\d{4}/g);
  if (!matches) return null;
  const year = Math.max(...matches.map(Number));
  if (year < 1900) {
    const century = Math.floor((year - 1) / 100) + 1;
    return `${century}. Yüzyıl`;
  }
  const decade = Math.floor(year / 10) * 10;
  return `${decade}'${DECADE_SUFFIX[decade % 100] || 'ler'}`;
}

// Ham form verisini (client'tan gelen) satır olarak D1'e yazılacak hale getirir:
// dizi alanları JSON'a çevirir, eksik/boş alanları null yapar, projeler için slug/dateBucket türetir.
// ai_generated (bkz. migrations/0015_ai_submission_source.sql) NOT NULL DEFAULT 0 olduğundan diğer
// alanlar gibi boşken null bırakılamaz — proje-ekle.html/urun-ekle.html'in AI paneli kullanılmadığı
// her gönderimde bu alan payload'da hiç yer almaz, null yazılırsa INSERT/UPDATE anında
// "NOT NULL constraint failed" ile 500 döner (bkz. kullanıcı raporu: kapak/sıra değişikliğini
// kaydederken "Sunucu hatası oluştu" — aslında AI akışı dışındaki HER proje/ürün/malzeme
// ekleme-düzenleme işlemini etkiliyordu, görsellerle ilgisi yoktu).
// imageHotspots'un GÜVENLİ hâli — istemciden gelen ham nesne olduğu gibi saklanmaz (bkz.
// migrations/0076_project_image_hotspots.sql): yalnızca beklenen dört alan (x/y/slug/title) alınır,
// koordinatlar 0-100 aralığına kırpılır, slug'suz kayıtlar (tıklanınca gidilecek bir yeri olmayan
// işaretçi) atılır ve görsel başına/toplam işaretçi sayısı sınırlanır. Böylece bu sütun, gövdeye
// istenen her şeyin yazılabildiği serbest bir JSON deposuna dönüşmez.
// MAX_HOTSPOTS_PER_IMAGE 30 -> 3 ve ÜRÜN BAŞINA TEK GÖRSEL (kullanıcı isteği, 2026-09-01 madde 5:
// "Proje ekle/düzenle sayfasında aynı ürün birden fazla görselde etiketlenemesin. Bir görsele en
// fazla 3 tane ürün etiketleme sınırı olsun."). İstemci (proje-ekle.html#openHotspotForm) aynı iki
// kuralı kullanıcıya açıklayarak ÖNCEDEN uygular; buradaki uygulama, doğrudan API'ye gönderilen
// (ya da eski, kural öncesi kaydedilmiş) gövdelerin de kurala uymasını garanti eden son savunmadır.
// Sınırı aşan işaretçiler sessizce ATILIR (hata döndürülmez) — bu fonksiyonun mevcut sözleşmesi
// "temizle ve devam et"tir, tek bir bozuk işaretçi tüm proje kaydını reddetmemeli.
const MAX_HOTSPOTS_PER_IMAGE = 3;
const MAX_HOTSPOT_IMAGES = 60;
export function sanitizeImageHotspots(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  // Tüm görseller genelinde paylaşılan — bir ürün (slug) yalnızca İLK göründüğü görselde kalır.
  const seenSlugs = new Set();
  for (const url of Object.keys(raw).slice(0, MAX_HOTSPOT_IMAGES)) {
    const list = Array.isArray(raw[url]) ? raw[url] : [];
    const cleaned = [];
    for (const h of list) {
      if (cleaned.length >= MAX_HOTSPOTS_PER_IMAGE) break;
      if (!h || typeof h !== 'object') continue;
      const slug = typeof h.slug === 'string' ? h.slug.trim().slice(0, 300) : '';
      if (!slug || seenSlugs.has(slug)) continue;
      const x = Number(h.x), y = Number(h.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      seenSlugs.add(slug);
      cleaned.push({
        x: Math.min(100, Math.max(0, Math.round(x * 100) / 100)),
        y: Math.min(100, Math.max(0, Math.round(y * 100) / 100)),
        slug,
        title: typeof h.title === 'string' ? h.title.trim().slice(0, 300) : '',
      });
    }
    if (cleaned.length) out[url] = cleaned;
  }
  return out;
}

export function normalizeSubmission(type, body) {
  const config = SUBMISSION_TYPES[type];
  const row = {};
  for (const field of config.fields) {
    let value = body[field];
    if (field === 'ai_generated') {
      value = value ? 1 : 0;
    } else if (field === 'build_status') {
      // build_status NOT NULL'dur (bkz. migrations/0037_project_build_status.sql) — bu alanı
      // henüz göndermeyen çağıranlarda (ör. AI ile otomatik ekleme, src/routes/ai.js) undefined/''
      // asla ham NULL olarak INSERT edilmemeli (DEFAULT yalnızca sütun sorguda hiç YOKSA devreye
      // girer, ?'li bind'da NULL constraint'i ihlal eder) — bu yüzden burada da güvenli varsayılan
      // 'built'e düşülür.
      value = value === 'concept' ? 'concept' : 'built';
    } else if (field === 'conceptCategory') {
      // build_status='built' gönderilerde (ya da geçersiz/boş bir değerde) her zaman NULL — proje
      // konsept'ten inşa edilmişe çevrilirse eski kategori sessizce takılı kalmasın.
      value = (body.build_status === 'concept' && CONCEPT_CATEGORIES.has(value)) ? value : null;
    } else if (config.arrayFields.includes(field)) {
      if (!Array.isArray(value)) value = value ? [value] : [];
      value = JSON.stringify(value.filter(Boolean));
    } else if ((config.objectFields || []).includes(field)) {
      // Düz JSON nesnesi (bkz. projects.imageHotspots). Dizi/ilkel/eksik değerler sessizce boş
      // nesneye indirgenir — bu alanları hiç göndermeyen çağıranlar (AI ile otomatik ekleme,
      // admin panelinin kısa düzenleme formu vb.) için güvenli varsayılan.
      value = field === 'imageHotspots' ? sanitizeImageHotspots(value)
        : ((value && typeof value === 'object' && !Array.isArray(value)) ? value : {});
      value = Object.keys(value).length ? JSON.stringify(value) : null;
    } else {
      // denetim bulgusu: string alanlarda hiç trim() yapılmıyordu — architects/offices/products
      // BARE isim/başlıkla anahtarlandığından (bkz. "Duplicate name key limitation" belleği), baştaki/
      // sondaki boşluklu bir name/title/brand DB'ye olduğu gibi yazılıyor, isDuplicateCanonicalName/
      // findOneByName gibi karşılaştırmalar kendi .trim()'ini yapsa da (bkz. o fonksiyonlar) sonraki
      // strict `name = ?`/`profile_key = ?` eşleştirmeleri (ör. verifyClaimedProfileKey,
      // projectClaimAccess.js) boşluk farkı yüzünden sessizce kaçırabilirdi.
      if (typeof value === 'string') value = value.trim();
      value = value === undefined || value === '' ? null : value;
    }
    row[field] = value;
  }
  if (type === 'projects') {
    // Eskiden title'a rastgele bir ek eklenirdi (ör. "co-port-jxepq") — bkz. kullanıcı isteği: temiz
    // URL. Bu yalnızca project_submissions.slug (taslak/bookkeeping) için bir aday değerdir; canonical
    // projects.slug'daki asıl tekillik/çakışma çözümü src/lib/canonicalSync.js#syncProject'te yapılır
    // (yeni kayıtta clash+`-${id}` soneki, düzenlemede freshSlugFor ile "-2","-3"... sıralı sonek).
    row.slug = slugify(body.title);
    row.dateBucket = dateBucketFor(body.date);
  }
  return row;
}

export function parseSubmissionRow(type, row) {
  const config = SUBMISSION_TYPES[type];
  const out = { ...row };
  for (const field of config.arrayFields) {
    // office: bkz. migrations/0030_project_submission_office.sql — ham sütun NULL'sa bu satır bu
    // alan hiç var olmadan (Mimar/Firma kutuları birleştirilerek) kaydedilmiş DEMEKTİR; diğer
    // arrayField'ların aksine burada [] yerine null bırakılır ki proje-ekle.html#prefillForEdit
    // "hiç Firma girilmemiş" ile "eski/birleşik kayıt" durumunu ayırt edebilsin (birincisinde
    // designer'ı olduğu gibi güvenip heuristiğe hiç düşmemeli).
    if (type === 'projects' && field === 'office' && row.office == null) { out.office = null; continue; }
    try { out[field] = row[field] ? JSON.parse(row[field]) : []; }
    catch { out[field] = []; }
  }
  for (const field of (config.objectFields || [])) {
    try {
      const parsed = row[field] ? JSON.parse(row[field]) : null;
      out[field] = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch { out[field] = {}; }
  }
  // bkz. src/lib/canonicalRead.js#parseCanonicalRow'daki AYNI ".0" normalizasyonu — mimar-ekle.html/
  // firma-ekle.html'in ?edit=<id> modu bu satırı (canonical değil, kendi *_submissions taslağını) okur.
  if (type === 'offices' && out.yil != null) {
    const n = parseInt(out.yil, 10);
    if (!Number.isNaN(n)) out.yil = n;
  }
  return out;
}

export function validateRequired(type, body) {
  const config = SUBMISSION_TYPES[type];
  const missing = config.required.filter(f => !body[f] || !String(body[f]).trim());
  return missing;
}
