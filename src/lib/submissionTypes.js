// 4 gönderi tipinin ortak yapılandırması: tablo adı, kabul edilen alanlar,
// hangi alanların JSON dizisi olarak saklandığı ve zorunlu alanlar.
export const SUBMISSION_TYPES = {
  offices: {
    table: 'office_submissions',
    fields: ['name', 'loc', 'cats', 'yil', 'website', 'about', 'logo_url', 'awards', 'claimed_profile_key'],
    arrayFields: ['awards'],
    required: ['name'],
    urlFields: ['website', 'logo_url'],
  },
  projects: {
    table: 'project_submissions',
    fields: [
      'slug', 'title', 'category', 'type', 'location', 'locationDetail', 'date', 'dateBucket',
      'period', 'designer', 'photoCreditText', 'photoCreditUrl', 'description', 'images', 'brands',
    ],
    arrayFields: ['category', 'type', 'period', 'designer', 'images', 'brands'],
    required: ['title'],
    urlFields: ['photoCreditUrl'],
    urlArrayFields: ['images'],
  },
  products: {
    table: 'product_submissions',
    fields: ['title', 'brand', 'website', 'category', 'description', 'images'],
    arrayFields: ['images'],
    required: ['title'],
    urlFields: ['website'],
    urlArrayFields: ['images'],
  },
  jobs: {
    table: 'job_submissions',
    fields: ['title', 'office', 'loc', 'level', 'role', 'tags', 'domain', 'description', 'apply', 'image_url'],
    arrayFields: ['tags'],
    required: ['title', 'office'],
    urlFields: ['apply', 'image_url'],
  },
  architects: {
    table: 'architect_submissions',
    fields: ['name', 'dob', 'school', 'dept', 'office', 'position', 'awards', 'photo_url', 'claimed_profile_key'],
    arrayFields: ['awards'],
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

// Görsel/website/başvuru linki gibi alanlarda saklanan değerin, bir HTML özniteliğine
// (src="..."/href="...") gömüldüğünde tırnak kaçışıyla enjeksiyona izin vermeyecek güvenli bir
// bağlantı olduğunu garantiler: ya kendi /media/ yükleme yolumuz, ya da düz bir http(s) URL'i.
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
    return false;
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

function dateBucketFor(dateStr) {
  const m = (dateStr || '').match(/(\d{4})/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const decade = Math.floor(year / 10) * 10;
  return `${decade}'lar`;
}

// Ham form verisini (client'tan gelen) satır olarak D1'e yazılacak hale getirir:
// dizi alanları JSON'a çevirir, eksik/boş alanları null yapar, projeler için slug/dateBucket türetir.
export function normalizeSubmission(type, body) {
  const config = SUBMISSION_TYPES[type];
  const row = {};
  for (const field of config.fields) {
    let value = body[field];
    if (config.arrayFields.includes(field)) {
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
    try { out[field] = row[field] ? JSON.parse(row[field]) : []; }
    catch { out[field] = []; }
  }
  return out;
}

export function validateRequired(type, body) {
  const config = SUBMISSION_TYPES[type];
  const missing = config.required.filter(f => !body[f] || !String(body[f]).trim());
  return missing;
}
