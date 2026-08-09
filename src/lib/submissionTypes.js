// 4 gönderi tipinin ortak yapılandırması: tablo adı, kabul edilen alanlar,
// hangi alanların JSON dizisi olarak saklandığı ve zorunlu alanlar.
export const SUBMISSION_TYPES = {
  offices: {
    table: 'office_submissions',
    fields: ['name', 'loc', 'cats', 'yil', 'website', 'about', 'logo_url', 'awards', 'founders', 'claimed_profile_key', 'social_links'],
    // social_links: [{platform,url}] — awards/founders ile AYNI JSON dizi deseni (bkz. kullanıcı
    // isteği: "sosyal medya kutusunun yanına ekle butonu koy", migrations/0036_social_links.sql —
    // paralel bir oturumun tekli social_platform/social_url kolonları yerine bu tercih edildi,
    // bkz. kullanıcı isteği: "1'den fazla sosyal medya eklenebilsin").
    arrayFields: ['awards', 'founders', 'social_links'],
    required: ['name'],
    urlFields: ['website', 'logo_url'],
  },
  projects: {
    table: 'project_submissions',
    fields: [
      'slug', 'title', 'category', 'type', 'discipline', 'location', 'locationDetail', 'date', 'dateBucket',
      'period', 'designer', 'office', 'photoCreditText', 'photoCreditUrl', 'description', 'images', 'brands',
      'claimed_slug', 'source_url', 'ai_generated',
    ],
    // designer: yalnızca "Mimar" kutusundan gelen isimler; office: yalnızca "Firma" kutusundan
    // gelen isimler (bkz. migrations/0030_project_submission_office.sql) — artık BİRLEŞTİRİLMEZ,
    // hangi kutudan geldiği künye render'ına kadar korunur.
    arrayFields: ['category', 'type', 'discipline', 'period', 'designer', 'office', 'images', 'brands'],
    required: ['title'],
    urlFields: ['photoCreditUrl', 'source_url'],
    urlArrayFields: ['images'],
  },
  products: {
    table: 'product_submissions',
    fields: ['title', 'brand', 'architect', 'website', 'category', 'description', 'images', 'specs', 'source_url', 'ai_generated'],
    arrayFields: ['images', 'specs'],
    required: ['title'],
    urlFields: ['website', 'source_url'],
    urlArrayFields: ['images'],
  },
  materials: {
    table: 'material_submissions',
    fields: ['title', 'brand', 'architect', 'website', 'category', 'description', 'images', 'specs', 'source_url', 'ai_generated'],
    arrayFields: ['images', 'specs'],
    required: ['title'],
    urlFields: ['website', 'source_url'],
    urlArrayFields: ['images'],
  },
  architects: {
    table: 'architect_submissions',
    // consultant_request/hourly_rate/session_duration_min/expertise_tags/available_slots/
    // consultant_experience_years — /danisman'daki "Danışman Ekle" pop-up'ının gönderdiği ek alanlar
    // (bkz. migrations/0034_consultant_submission_fields.sql, kullanıcı isteği). Sıradan bir
    // "beni mimar olarak ekle" gönderisinde (mimar-ekle.html) bu alanlar hiç gönderilmez, boş kalır.
    fields: [
      'name', 'dob', 'school', 'dept', 'office', 'position', 'profession', 'awards', 'photo_url', 'about', 'claimed_profile_key',
      'consultant_request', 'hourly_rate', 'session_duration_min', 'expertise_tags', 'available_slots', 'consultant_experience_years',
      'social_links',
    ],
    arrayFields: ['awards', 'expertise_tags', 'available_slots', 'social_links'],
    required: ['name'],
    urlFields: ['photo_url'],
  },
  news: {
    table: 'news_submissions',
    fields: ['title', 'category', 'source', 'description', 'image_url'],
    arrayFields: [],
    required: ['title'],
    urlFields: ['image_url'],
  },
};

// Mimar/Firma/Danışman ekle-düzenle sayfalarındaki Sosyal Medya kutucuğunun platform seçim listesi
// (bkz. kullanıcı isteği) — istemci (mimar-ekle.html/firma-ekle.html/danisman-ekle.html) VE burası
// (submissions.js#createSubmission/updateOwnSubmission, src/routes/consultant.js#
// handleConsultantEditRoute) AYNI enum'u kullanır.
export const SOCIAL_PLATFORMS = new Set(['instagram', 'linkedin', 'x']);

export function findInvalidSocialPlatform(type, body) {
  if (!('social_platform' in body)) return false;
  const value = body.social_platform;
  return !!value && !SOCIAL_PLATFORMS.has(value);
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

function slugify(text) {
  const trMap = { ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', I: 'i', İ: 'i', ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u' };
  return (text || '')
    .split('').map(ch => trMap[ch] || ch).join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Projeler sayfasındaki statik "N. Yüzyıl" / "N0'lar" bucket kuralıyla (bkz. projeler-data.js
// içindeki gerçek değerler) birebir eşleşen ondalık eki — Türkçe ünlü uyumuna göre her on yılın
// kendi doğru eki var (ör. "2020'ler" ama "2010'lar"); eskiden HER ZAMAN "'lar" kullanılıyordu, bu
// da statik verideki "2020'ler" gibi doğru değerlerle aynı on yıl için İKİ AYRI filtre seçeneği
// üretiyordu (bkz. gerçek bulgu).
const DECADE_SUFFIX = { 0: 'ler', 10: 'lar', 20: 'ler', 30: 'lar', 40: 'lar', 50: 'ler', 60: 'lar', 70: 'ler', 80: 'ler', 90: 'lar' };

// bkz. kullanıcı isteği: "Projeler sayfasında Yıl filtresinin içindeki seçeneklerde 1750'ler ve
// 1700'lar seçeneklerini kaldır ... bunu engelle". Eski hali serbest metin "date" alanındaki İLK
// 4 haneli sayıyı alıp HER ZAMAN bir on yıl bucket'ı üretiyordu — bu iki gerçek soruna yol
// açıyordu: (1) 1900 öncesi bir yıl (ör. "1753-1756" tarihli bir cami) statik veride kullanılan
// "N. Yüzyıl" biçimi yerine "1750'lar" gibi tuhaf, tek seferlik bir bucket üretiyordu; (2) tarih
// aralığı ya da restorasyon tarihi olan projelerde (ör. "1700 / 2023") İLK sayı alındığından, 2023'te
// tamamlanan bir restorasyon "1700'ler" gibi anlamsız bir bucket'a düşüyordu. Şimdi: metindeki TÜM
// 4 haneli sayılardan EN BÜYÜĞÜ (en güncel/tamamlanma yılı) esas alınır; 1900 öncesiyse statik
// veriyle aynı "N. Yüzyıl" biçimi kullanılır.
function dateBucketFor(dateStr) {
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
export function normalizeSubmission(type, body) {
  const config = SUBMISSION_TYPES[type];
  const row = {};
  for (const field of config.fields) {
    let value = body[field];
    if (field === 'ai_generated' || field === 'consultant_request') {
      value = value ? 1 : 0;
    } else if (config.arrayFields.includes(field)) {
      if (!Array.isArray(value)) value = value ? [value] : [];
      value = JSON.stringify(value.filter(Boolean));
    } else {
      value = value === undefined || value === '' ? null : value;
    }
    row[field] = value;
  }
  if (type === 'projects') {
    row.slug = slugify(body.title) + '-' + Math.random().toString(36).slice(2, 7);
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
