// Faz 3 — okuma yolları artık *_submissions tablolarını HİÇ okumuyor (bkz. src/routes/architect.js/
// office.js/project.js/product.js, canonical architects/offices/projects/products'tan okuyor). Bu
// yüzden bir gönderi onaylandığında/onaylıyken düzenlendiğinde, o değişikliğin canlıya yansıması
// için canonical satırın da AYNI anda güncellenmesi ZORUNLU — aksi halde onay ekranı "başarılı"
// der ama site hiçbir şey göstermez (bkz. scripts/merge-submissions-to-id-first.js'in tek seferlik
// yaptığı overlay birleştirmesinin CANLI/sürekli karşılığı). Bu modül, o tek seferlik script'teki
// "claimed_profile_key/claimed_slug doluysa UPDATE, boşsa INSERT" kuralının tek-satırlık, D1
// prepared statement'larıyla çalışan canlı versiyonudur — bkz. src/routes/admin.js#handleSubmissionsAdmin
// (PATCH), src/routes/submissions.js#createSubmission/updateOwnSubmission (yalnızca admin'in
// doğrudan ekleme/düzenleme akışında status='approved' olabildiğinden oradan da çağrılır).
//
// architects/offices/projects için "bu submission zaten daha önce hangi canonical satırı
// oluşturdu" sorusu claimed_profile_key/claimed_slug'sız (bağımsız) kayıtlarda legacy_key =
// 'submission:<submissionId>' işaretiyle çözülür — yeni bir kolon eklemeden idempotent
// UPDATE-or-INSERT sağlar (bkz. scripts/merge-submissions-to-id-first.js'teki AYNI legacy_key
// kullanımı, orada NULL bırakılıyordu çünkü tek seferlikti; burada tekrar bulunabilir olması
// gerekiyor).

import { newId } from './crypto.js';

function submissionMarker(id) { return `submission:${id}`; }

// architects/offices/projects.slug hepsi TEXT UNIQUE NOT NULL (bkz. migrations/
// 0022_id_first_entities.sql) — syncArchitect/syncOffice/syncProject'in "yeni bağımsız kayıt"
// dalları önce bir SELECT ile slug çakışmasına bakıp (yaygın/beklenen durumda ek bir -${row.id}
// sonekinden kaçınmak için) INSERT'i buna göre kurar, ama bu SELECT-sonra-INSERT ikilisi arasında
// yarış durumu vardır (bkz. kullanıcı isteği: Legacy Bundle Elimination Faz 2, "slug çakışma
// kontrolü ile kayıt oluşturma arasında yarış durumu" — ör. admin panelinden art arda hızlı
// onaylanan iki gönderi aynı slug'ı ikisi de "boş" görüp aynı anda INSERT deneyebilir). Asıl
// savunma hattı SELECT değil, DB'nin kendi UNIQUE kısıtlaması: INSERT SQLITE_CONSTRAINT ile
// başarısız olursa TEK bir kez, mevcut kod tabanındaki AYNI dedupe sonekiyle (${slug}-${row.id})
// yeniden denenir — row.id (submission kimliği, bkz. src/lib/crypto.js#newId) kriptografik olarak
// rastgele olduğundan bu ikinci denemenin de çakışması pratikte imkânsızdır. Üç canonical tip
// (architects/offices/projects) arasında paylaşılan tek bir yardımcı — kod tekrarını önler.
function isUniqueSlugConstraintError(err) {
  return !!err && typeof err.message === 'string' && /UNIQUE constraint failed/i.test(err.message);
}
async function insertWithSlugRetry(env, baseSlug, dedupeSuffix, buildStatement) {
  try {
    return await buildStatement(baseSlug).run();
  } catch (err) {
    if (!isUniqueSlugConstraintError(err)) throw err;
    return buildStatement(`${baseSlug}-${dedupeSuffix}`).run();
  }
}

// bkz. src/routes/legacyContent.js#CANONICAL_TABLE_BY_TYPE — tek kaynak burada tutulur, o dosya
// buradan import eder (aksi halde hard-delete/blacklist mantığı ile o dosyadaki okuma yolları
// farklı tablo eşlemeleri kullanma riskiyle çatallanabilirdi).
export const CANONICAL_TABLE_BY_TYPE = { architects: 'architects', offices: 'offices', projects: 'projects', products: 'products', materials: 'products' };

// Bir canonical satırın "doğal anahtarı" — statik data.js dosyalarındaki (projeler-data.js/
// data.js/urunler-data.js) karşılığıyla aynı kimlik: mimar/ofis için bare name, proje için slug,
// ürün/malzeme için "marka|||başlık". legacy_content_hidden.content_key bu değerle eşleşir.
export function canonicalKeyFor(type, row) {
  if (type === 'architects' || type === 'offices') return row.name;
  if (type === 'projects') return row.slug;
  if (type === 'products' || type === 'materials') return row.legacy_key || `${row.brand_name_raw || ''}|||${row.title}`;
  return null;
}

const MEDIA_URL_MARKER = '/media/';

function collectMediaKeysFromValue(val, into) {
  if (typeof val !== 'string') return;
  const idx = val.indexOf(MEDIA_URL_MARKER);
  if (idx === -1) return; // statik/legacy dosya yolu (ör. "miras/..webp") — R2'de değil, dokunma
  const key = decodeURIComponent(val.slice(idx + MEDIA_URL_MARKER.length));
  if (key) into.push(key);
}

// Bir satırdaki (canonical ya da *_submissions taslağı) görsel kolonlarından yalnızca R2'ye
// (env.UPLOADS) yüklenmiş olanların object key'lerini çıkarır — statik siteye gömülü legacy
// görseller (miras/, projects/, logos-thumb/ gibi repo-relative yollar) hiçbir zaman R2'de
// olmadığından buradan hiç geçmez, silinmeye çalışılmaz.
export function collectR2MediaKeys(row, { arrayFields = [], stringFields = [] } = {}) {
  if (!row) return [];
  const keys = [];
  for (const field of arrayFields) {
    if (!row[field]) continue;
    try {
      const arr = JSON.parse(row[field]);
      if (Array.isArray(arr)) arr.forEach(v => collectMediaKeysFromValue(v, keys));
    } catch { /* bozuk JSON — atla */ }
  }
  for (const field of stringFields) collectMediaKeysFromValue(row[field], keys);
  return keys;
}

// R2 silme hatası (ör. zaten yok) satırın kendisinin silinmesini ENGELLEMEMELİ — kota/temizlik
// ikincil bir işlem, asıl kayıt silme işlemi her koşulda tamamlanmalı.
export async function deleteR2MediaKeys(env, keys) {
  for (const key of keys) {
    try { await env.UPLOADS.delete(key); } catch { /* yoksay */ }
  }
}

// Aynı kolon adları (images/photo_url/logo_url) *_submissions taslak tablolarında da kullanılır
// (bkz. src/lib/submissionTypes.js#SUBMISSION_TYPES) — bu yüzden hem canonical satırlar hem taslak
// satırlar için R2 temizliğinde AYNI eşleme yeniden kullanılır (bkz. src/routes/legacyContent.js/
// admin.js'teki taslak-satır hard-delete noktaları).
export const MEDIA_IMAGE_FIELDS_BY_TYPE = {
  projects: { arrayFields: ['images'] },
  products: { arrayFields: ['images'] },
  materials: { arrayFields: ['images'] },
  architects: { stringFields: ['photo_url'] },
  offices: { stringFields: ['logo_url'] },
};

// Bir kaydın statik anahtarını (slug/name/"marka|||başlık") legacy_content_hidden'a kalıcı bir
// "bir daha asla gösterme" damgası olarak yazar. Bu, hard-delete sonrası canonical satır artık
// var OLMADIĞINDA bile statik data.js dizilerindeki (projeler-data.js vb.) aynı kaydın
// /api/public/hidden üzerinden gizli kalmasını sağlayan TEK mekanizmadır (bkz.
// src/routes/legacyContent.js#fetchHiddenMap — artık hem hidden_at/deleted_at'i hem bu tabloyu
// TÜM tipler için tarar, önceden yalnızca 'news' için kullanılıyordu).
export async function blacklistLegacyKey(env, userId, type, key) {
  if (!key) return;
  await env.DB.prepare(
    `INSERT INTO legacy_content_hidden (id, content_type, content_key, hidden_by_user_id, hidden_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(content_type, content_key) DO NOTHING`
  ).bind(newId(), type, key, userId, Date.now()).run();
}

// Bir canonical satırı GERÇEKTEN (hard delete) D1'den siler — bkz. kullanıcı isteği: "Admin
// panelinden sil dediğimde kayıt veritabanından TAMAMEN silinsin, sadece işaretlenmesin".
// Sırasıyla: (1) satıra bağlı R2 görsellerini temizler, (2) FK ile bu satıra referans veren
// diğer canonical kolonları (architects.office_id, products.brand_office_id — bunlarda ON DELETE
// CASCADE/SET NULL yok, bkz. migrations/0022_id_first_entities.sql) NULL'lar, (3) join
// tablolarındaki (office_founders/project_designers/product_architects/project_products/
// project_awards) satırları temizler — D1'in FK enforcement durumuna bağlı kalmadan, (4) asıl
// satırı siler, (5) statik data.js karşılığının bir daha görünmemesi için legacy_content_hidden'a
// damgalar.
export async function hardDeleteCanonicalRow(env, type, row, userId) {
  if (!row) return;
  const table = CANONICAL_TABLE_BY_TYPE[type];
  if (!table) return;

  await deleteR2MediaKeys(env, collectR2MediaKeys(row, MEDIA_IMAGE_FIELDS_BY_TYPE[type] || {}));

  if (type === 'offices') {
    await env.DB.prepare(`UPDATE architects SET office_id = NULL WHERE office_id = ?`).bind(row.id).run();
    await env.DB.prepare(`UPDATE products SET brand_office_id = NULL WHERE brand_office_id = ?`).bind(row.id).run();
    await env.DB.prepare(`DELETE FROM office_founders WHERE office_id = ?`).bind(row.id).run();
    await env.DB.prepare(`DELETE FROM project_designers WHERE office_id = ?`).bind(row.id).run();
  }
  if (type === 'architects') {
    await env.DB.prepare(`DELETE FROM office_founders WHERE architect_id = ?`).bind(row.id).run();
    await env.DB.prepare(`DELETE FROM project_designers WHERE architect_id = ?`).bind(row.id).run();
    await env.DB.prepare(`DELETE FROM product_architects WHERE architect_id = ?`).bind(row.id).run();
  }
  if (type === 'projects') {
    await env.DB.prepare(`DELETE FROM project_designers WHERE project_id = ?`).bind(row.id).run();
    await env.DB.prepare(`DELETE FROM project_products WHERE project_id = ?`).bind(row.id).run();
    await env.DB.prepare(`DELETE FROM project_awards WHERE project_id = ?`).bind(row.id).run();
  }
  if (type === 'products' || type === 'materials') {
    await env.DB.prepare(`DELETE FROM product_architects WHERE product_id = ?`).bind(row.id).run();
    await env.DB.prepare(`DELETE FROM project_products WHERE product_id = ?`).bind(row.id).run();
  }

  await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(row.id).run();
  await blacklistLegacyKey(env, userId, type, canonicalKeyFor(type, row));
}

// bkz. src/routes/legacyContent.js#LEGACY_TYPES.key — admin panelinin "içerik anahtarı" (mimar/ofis
// için bare name, proje için slug, ürün/malzeme için "marka|||başlık") ile canonical satırı bulur.
// Faz 3 öncesi bu anahtar legacy_content_hidden.content_key'e karşılık geliyordu; artık doğrudan
// canonical satırın kendisini (name/slug/legacy_key üzerinden) hedefler.
export async function findCanonicalRowByNaturalKey(env, typeKey, key) {
  if (typeKey === 'architects' || typeKey === 'offices') {
    const table = typeKey;
    return env.DB.prepare(`SELECT * FROM ${table} WHERE name = ? OR legacy_key = ? LIMIT 1`).bind(key, key).first();
  }
  if (typeKey === 'projects') {
    return env.DB.prepare(`SELECT * FROM projects WHERE slug = ? OR legacy_key = ? LIMIT 1`).bind(key, key).first();
  }
  if (typeKey === 'products' || typeKey === 'materials') {
    return env.DB.prepare(`SELECT * FROM products WHERE legacy_key = ? LIMIT 1`).bind(key).first();
  }
  return null;
}

async function findOneByName(env, table, name) {
  if (!name) return { row: null, ambiguous: false };
  const { results } = await env.DB.prepare(`SELECT * FROM ${table} WHERE deleted_at IS NULL AND name = ?`).bind(name).all();
  if (results.length === 0) return { row: null, ambiguous: false };
  if (results.length > 1) return { row: null, ambiguous: true, candidates: results };
  return { row: results[0], ambiguous: false };
}

async function logConflict(env, entity_type, conflict_key, context, candidates) {
  await env.DB.prepare(
    `INSERT INTO migration_name_conflicts (entity_type, conflict_key, context, candidates, status) VALUES (?, ?, ?, ?, 'pending')`
  ).bind(entity_type, conflict_key, context, JSON.stringify(candidates.map(r => ({ id: r.id, name: r.name }))), 'pending').run();
}

// officeIds: bir mimarın Firma alanına virgülle ayırarak girdiği TÜM eşleşen firma id'leri (bkz.
// syncArchitect — "A Mimarlık, B Tasarım Studio" gibi birden çok firma desteği, kullanıcı isteği).
// Bu listede OLMAYAN mevcut bağlantılar çıkarılır (form artık o firmayı içermiyorsa), listedeki
// her firma için bağlantı eklenir/korunur.
async function syncOfficeFounderLink(env, architectId, officeIds) {
  const ids = [...new Set((officeIds || []).filter(id => id !== null && id !== undefined))];
  if (!ids.length) {
    await env.DB.prepare(`DELETE FROM office_founders WHERE architect_id = ?`).bind(architectId).run();
    return;
  }
  const placeholders = ids.map(() => '?').join(', ');
  await env.DB.prepare(`DELETE FROM office_founders WHERE architect_id = ? AND office_id NOT IN (${placeholders})`).bind(architectId, ...ids).run();
  for (const officeId of ids) {
    await env.DB.prepare(`INSERT OR IGNORE INTO office_founders (office_id, architect_id) VALUES (?, ?)`).bind(officeId, architectId).run();
  }
}

// Kurucular kutusuna yazılan isimleri architects tablosuyla eşleştirip office_founders FK'sine
// bağlar (bkz. gerçek bulgu: "TAFF Mimarlık" düzenlenirken Kurucular kutusuna "Ezgi San" yazılmasına
// rağmen bu isim hiçbir zaman office_founders'a bağlanmıyordu — founders JSON alanı yalnızca
// kozmetikti, bkz. migrations/0022_id_first_entities.sql'deki dosya başı yorumu). Yalnızca EKLEME
// yönünde çalışır — bir ismin listeden çıkarılması cascadeRemovedFounders'ın işi (bkz.
// src/lib/officeFounderCascade.js) — bu yüzden burada var olan bağlantılar (ör. bir mimarın kendi
// office_id'siyle kurduğu bağlantı) silinmez.
async function syncOfficeFoundersFromNames(env, officeId, names) {
  for (const name of names) {
    if (!name) continue;
    const match = await findOneByName(env, 'architects', name);
    if (match.row) {
      await env.DB.prepare(`INSERT OR IGNORE INTO office_founders (office_id, architect_id) VALUES (?, ?)`).bind(officeId, match.row.id).run();
    } else if (match.ambiguous) {
      await logConflict(env, 'office_founder', name, `office:${officeId}`, match.candidates);
    }
  }
}

async function syncOffice(env, row) {
  const claimedKey = row.claimed_profile_key;
  const marker = submissionMarker(row.id);
  const target = claimedKey
    ? await env.DB.prepare(`SELECT * FROM offices WHERE deleted_at IS NULL AND (legacy_key = ? OR name = ?) LIMIT 1`).bind(claimedKey, claimedKey).first()
    : await env.DB.prepare(`SELECT * FROM offices WHERE legacy_key = ?`).bind(marker).first();

  // row.cats gönderi formundan (ofisin "Hizmet Alanı" alanı) DÜZ METİN olarak gelir — bkz.
  // src/lib/submissionTypes.js#SUBMISSION_TYPES.offices.arrayFields, 'cats' orada YOK (yalnızca
  // 'awards'/'founders' dizi). offices.cats kolonundaki JSON, legacy_static migration'dan beri
  // hep JSON.stringify(STRING) şeklinde (ör. '"Mimarlık · İç Mimarlık"') — ofis-detay.html/
  // firma.html/admin.html gibi TÜM okuyucular bunu JSON.parse sonrası bir string olarak
  // `.split(' · ')` ile işler (bkz. gerçek bulgu: buradaki eski `Array.isArray(row.cats) ?
  // row.cats : [row.cats]` savunması row.cats'i YANLIŞLIKLA `["Mimarlık"]` dizisine sarıyordu —
  // bu satır bir kez UPDATE ile yazıldığında o ofis JSON.parse sonrası bir DİZİ alıyor,
  // `.split` dizide fonksiyon olmadığından `renderOfficeFields` senkron olarak fırlıyor ve
  // about/logo/kuruluş yılı/admin Düzenle-Arşivle-Sil butonları dahil ondan sonraki HİÇBİR şey
  // render edilmiyordu — veri kaybı değil, istemci tarafı kırılan bir render zinciriydi).
  const cats = row.cats ? JSON.stringify(row.cats) : null;
  const awards = row.awards ? JSON.stringify(row.awards) : null;
  const socialLinks = row.social_links ? JSON.stringify(row.social_links) : null;

  let result;
  if (target) {
    const sets = [];
    const vals = [];
    if (claimedKey) {
      // bkz. src/routes/office.js (eski)#buildOfficePayload overlay'i — yalnızca truthy alanlar üzerine yazılır.
      if (row.name) { sets.push('name = ?'); vals.push(row.name); }
      if (row.loc) { sets.push('loc = ?'); vals.push(row.loc); }
      if (row.cats) { sets.push('cats = ?'); vals.push(cats); }
      if (row.yil) { sets.push('yil = ?'); vals.push(row.yil); }
      if (row.website) { sets.push('website = ?'); vals.push(row.website); }
      if (row.about !== undefined && row.about !== null && row.about !== '') { sets.push('about = ?'); vals.push(row.about); }
      if (row.logo_url) { sets.push('logo_url = ?'); vals.push(row.logo_url); }
      if (row.social_links && row.social_links.length) { sets.push('social_links = ?'); vals.push(socialLinks); }
    } else {
      // bağımsız kayıt — kendi taslağının her düzenlemesi tam birebir yansır.
      sets.push('name = ?', 'loc = ?', 'cats = ?', 'yil = ?', 'website = ?', 'about = ?', 'logo_url = ?', 'social_links = ?');
      vals.push(row.name, row.loc || null, cats, row.yil || null, row.website || null, row.about || null, row.logo_url || null, socialLinks);
    }
    // hidden_at HER onaylı senkronda temizlenir — bir bağımsız (claimed_profile_key'siz) kaydın
    // sahibi onaylı içeriğini tekrar düzenlediğinde durum geçici olarak 'pending'e döner ve
    // hideCanonicalForUnapprovedSubmission bu satırı gizler (bkz. o fonksiyonun yorumu); admin bu
    // ikinci düzenlemeyi onayladığında BURASI (target bulunduğu için UPDATE dalı) çalışır ama daha
    // önce hiçbir çağıran satırın gizliliğini geri açmıyordu — kayıt kalıcı olarak "onaylı ama
    // sitede görünmez" kalıyordu (gerçek bulgu). claimed'lı satırlarda bu no-op'tur (zaten
    // unhideIfClaimedApproved ayrıca temizler), bu yüzden koşulsuz eklemek zararsız.
    sets.push('hidden_at = NULL');
    sets.push(`updated_at = datetime('now')`);
    await env.DB.prepare(`UPDATE offices SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, target.id).run();
    result = { ...target, id: target.id, name: row.name || target.name };
  } else {
    // Yeni bağımsız kayıt (claimedKey varsa ve hedef bulunamadıysa da — bozuk bir claim'i sessizce
    // atlamak yerine yeni bir kayıt olarak oluşturmak, üye içeriğinin kaybolmasından daha güvenli).
    const { slugify } = await import('./slugify.js');
    let slug = slugify(row.name) || `firma-${row.id}`;
    const clash = await env.DB.prepare(`SELECT id FROM offices WHERE slug = ?`).bind(slug).first();
    if (clash) slug = `${slug}-${row.id}`;
    const insert = await insertWithSlugRetry(env, slug, row.id, (finalSlug) => env.DB.prepare(
      `INSERT INTO offices (slug, name, loc, cats, yil, website, about, logo_url, awards, social_links, source, legacy_key, claimed_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submission', ?, ?)`
    ).bind(finalSlug, row.name, row.loc || null, cats, row.yil || null, row.website || null, row.about || null, row.logo_url || null, awards, socialLinks, marker, row.owner_user_id));
    result = await env.DB.prepare(`SELECT * FROM offices WHERE id = ?`).bind(insert.meta.last_row_id).first();
    // claimedKey doluyken buraya düşmek, o statik data.js kaydının HENÜZ canonical'a migrate
    // edilmemiş olduğu anlamına gelir (gerçek bulgu: "mükerrer kayıt" — bu yeni satır firma.html/
    // mimar.html gibi Faz 3 sayfalarında görünürken, arama.html gibi ham data.js okuyan sayfalar
    // hâlâ ESKİ/bayat statik girdiyi gösteriyordu, aynı firma/mimar İKİ farklı sayfada iki farklı
    // içerikle görünüyordu). Statik girdiyi legacy_content_hidden'a blacklist'leyip bu ham
    // okuyuculardan (bkz. src/routes/legacyContent.js#fetchHiddenMap) düşürmek, bu yeni canonical
    // satırı TEK görünür kaynak yapar.
    if (claimedKey) await blacklistLegacyKey(env, row.owner_user_id, 'offices', claimedKey);
  }

  if (row.founders && row.founders.length) await syncOfficeFoundersFromNames(env, result.id, row.founders);
  return result;
}

async function syncArchitect(env, row) {
  const claimedKey = row.claimed_profile_key;
  const marker = submissionMarker(row.id);

  // mimar-ekle.html'in Firma alanına virgülle ayrılmış birden fazla firma adı girilebilir (bkz.
  // kullanıcı isteği: "A Mimarlık, B Tasarım Studio"). architect_submissions.office tek bir TEXT
  // kolonu olduğundan (schema değişikliği gerektirmemek için) burada virgüle göre bölünüp her adı
  // ayrı ayrı offices tablosuyla eşleştirilir. İlk eşleşen firma "birincil" firma olarak architects.
  // office_id'ye yazılır (profildeki tekil "office" alanı, mimar-detay eski davranışıyla uyumlu
  // kalsın diye) — TÜM eşleşen firmalar ise office_founders'a bağlanır (bkz. syncOfficeFounderLink
  // ve buildArchitectPayload'daki "Kurucu/ortak olduğu TÜM firmalar" okuma mantığı, zaten bu join
  // tablosunu okuyor).
  const officeNames = (row.office || '').split(',').map(s => s.trim()).filter(Boolean);
  const officeIds = [];
  for (const officeName of officeNames) {
    const match = await findOneByName(env, 'offices', officeName);
    if (match.ambiguous) await logConflict(env, 'office_founder', officeName, `architect_submission:${row.id}`, match.candidates);
    if (match.row) officeIds.push(match.row.id);
  }
  const officeId = officeIds.length ? officeIds[0] : null;

  const target = claimedKey
    ? await env.DB.prepare(`SELECT * FROM architects WHERE deleted_at IS NULL AND (legacy_key = ? OR name = ?) LIMIT 1`).bind(claimedKey, claimedKey).first()
    : await env.DB.prepare(`SELECT * FROM architects WHERE legacy_key = ?`).bind(marker).first();

  const awards = row.awards ? JSON.stringify(row.awards) : null;
  const socialLinks = row.social_links ? JSON.stringify(row.social_links) : null;

  if (target) {
    const sets = [];
    const vals = [];
    if (claimedKey) {
      if (row.name) { sets.push('name = ?'); vals.push(row.name); }
      if (row.dob) { sets.push('dob = ?'); vals.push(row.dob); }
      if (row.school) { sets.push('school = ?'); vals.push(row.school); }
      if (row.dept) { sets.push('dept = ?'); vals.push(row.dept); }
      if (row.profession) { sets.push('profession = ?'); vals.push(row.profession); }
      if (row.awards && row.awards.length) { sets.push('awards = ?'); vals.push(awards); }
      if (row.photo_url) { sets.push('photo_url = ?'); vals.push(row.photo_url); }
      if (row.about !== undefined && row.about !== null && row.about !== '') { sets.push('about = ?'); vals.push(row.about); }
      if (row.position) { sets.push('position = ?'); vals.push(row.position); }
      if (row.social_links && row.social_links.length) { sets.push('social_links = ?'); vals.push(socialLinks); }
      sets.push('office_id = ?'); vals.push(officeId);
    } else {
      sets.push('name = ?', 'dob = ?', 'school = ?', 'dept = ?', 'profession = ?', 'awards = ?', 'photo_url = ?', 'about = ?', 'position = ?', 'social_links = ?', 'office_id = ?');
      vals.push(row.name, row.dob || null, row.school || null, row.dept || null, row.profession || null, awards, row.photo_url || null, row.about || null, row.position || null, socialLinks, officeId);
    }
    // bkz. syncOffice'teki AYNI koşulsuz hidden_at temizliği ve gerekçesi.
    sets.push('hidden_at = NULL');
    sets.push(`updated_at = datetime('now')`);
    await env.DB.prepare(`UPDATE architects SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, target.id).run();
    await syncOfficeFounderLink(env, target.id, officeIds);
    return target;
  }

  const { slugify } = await import('./slugify.js');
  let slug = slugify(row.name) || `mimar-${row.id}`;
  const clash = await env.DB.prepare(`SELECT id FROM architects WHERE slug = ?`).bind(slug).first();
  if (clash) slug = `${slug}-${row.id}`;
  const insert = await insertWithSlugRetry(env, slug, row.id, (finalSlug) => env.DB.prepare(
    `INSERT INTO architects (slug, name, dob, school, dept, profession, position, awards, about, photo_url, social_links, office_id, source, legacy_key, claimed_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submission', ?, ?)`
  ).bind(finalSlug, row.name, row.dob || null, row.school || null, row.dept || null, row.profession || null, row.position || null, awards, row.about || null, row.photo_url || null, socialLinks, officeId, marker, row.owner_user_id));
  const architectId = insert.meta.last_row_id;
  await syncOfficeFounderLink(env, architectId, officeIds);
  // bkz. syncOffice'teki AYNI "claimedKey'li ama hedef bulunamadı" durumu ve gerekçesi.
  if (claimedKey) await blacklistLegacyKey(env, row.owner_user_id, 'architects', claimedKey);
  return env.DB.prepare(`SELECT * FROM architects WHERE id = ?`).bind(architectId).first();
}

// Kök neden düzeltmesi (bkz. migrations/0030_project_submission_office.sql, kullanıcı isteği): eskiden
// TEK bir resolveDesignerLink() önce offices'te, bulamazsa architects'te arıyordu çünkü designer
// dizisi Mimar+Firma birleşikti ve hangi kutudan geldiği bilinmiyordu. Artık syncProject() her ismi
// GELDİĞİ kutuya göre (row.designer → yalnızca architects, row.office → yalnızca offices) çözer —
// "Createct" gibi offices'te KAYITLI OLMAYAN ama Firma kutusuna yazılmış bir isim artık asla
// architects tablosunda aranmaz/yanlışlıkla oraya "Mimar" olarak bağlanmaz.
async function resolveArchitectLink(env, name, contextLabel) {
  const match = await findOneByName(env, 'architects', name);
  if (match.row) return { office_id: null, architect_id: match.row.id };
  if (match.ambiguous) await logConflict(env, 'project_designer', name, contextLabel, match.candidates);
  return null;
}

async function resolveOfficeLink(env, name, contextLabel) {
  const match = await findOneByName(env, 'offices', name);
  if (match.row) return { office_id: match.row.id, architect_id: null };
  if (match.ambiguous) await logConflict(env, 'project_designer', name, contextLabel, match.candidates);
  return null;
}

// row.brands hem eski düz marka-adı string dizisi hem de yeni {brand, product} nesne dizisi
// biçiminde olabilir (bkz. proje-ekle.html#brandChips) — eski proje-detay.html#brandEntryOf ile
// aynı normalize.
function brandEntryOf(b) { return typeof b === 'string' ? { brand: b, product: null } : b; }

async function findMatchingProductIds(env, officeId, brandNameRaw, productTitle) {
  let sql = `SELECT id FROM products WHERE deleted_at IS NULL AND `;
  const params = [];
  if (officeId) { sql += `brand_office_id = ?`; params.push(officeId); }
  else { sql += `brand_office_id IS NULL AND brand_name_raw = ?`; params.push(brandNameRaw); }
  if (productTitle) { sql += ` AND title = ?`; params.push(productTitle); }
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  return results.map(r => r.id);
}

// project_products (bkz. migrations/0022_id_first_entities.sql) şemada var olmasına rağmen daha
// önce HİÇBİR yerde doldurulmuyordu — ne bu canlı onay akışında ne de tek seferlik
// scripts/merge-submissions-to-id-first.js'te (orada kasıtlı olarak ertelenmişti, bkz. o dosyadaki
// yorum). Ürün adı belirtilmemiş bir girişte (yalnızca marka seçilmiş) o markanın TÜM ürün/
// malzemeleri bağlanır — proje-detay.html#renderRelatedCatalog'un eski istemci-taraf eşleştirme
// kuralıyla aynı davranış, artık sunucu tarafında ve kalıcı.
async function resolveProjectProductLinks(env, brandsArray, contextLabel) {
  const productIds = new Set();
  for (const raw of (brandsArray || [])) {
    const entry = brandEntryOf(raw);
    if (!entry || !entry.brand) continue;
    const officeMatch = await findOneByName(env, 'offices', entry.brand);
    if (officeMatch.ambiguous) { await logConflict(env, 'product_brand', entry.brand, contextLabel, officeMatch.candidates); continue; }
    const officeId = officeMatch.row ? officeMatch.row.id : null;
    const ids = await findMatchingProductIds(env, officeId, entry.brand, entry.product);
    ids.forEach(id => productIds.add(id));
  }
  return [...productIds];
}

async function syncProject(env, row) {
  const claimedSlug = row.claimed_slug;
  const marker = submissionMarker(row.id);
  const target = claimedSlug
    ? await env.DB.prepare(`SELECT * FROM projects WHERE deleted_at IS NULL AND (legacy_key = ? OR slug = ?) LIMIT 1`).bind(claimedSlug, claimedSlug).first()
    : await env.DB.prepare(`SELECT * FROM projects WHERE legacy_key = ?`).bind(marker).first();

  const category = JSON.stringify(row.category || []);
  const type = JSON.stringify(row.type || []);
  const discipline = JSON.stringify(row.discipline || []);
  const period = JSON.stringify(row.period || []);
  const images = JSON.stringify(row.images || []);

  let projectId;
  if (target) {
    // bkz. src/routes/project.js (eski)#handleProjectDetailRoute overlay kuralları — title/category/
    // type/discipline/location/date/period/description/photoCredit koşulsuz, designer/images boşsa
    // eskisi korunur.
    const sets = [
      'title = ?', 'category = ?', 'type = ?', 'discipline = ?', 'location = ?', 'location_detail = ?',
      'project_date = ?', 'date_bucket = ?', 'period = ?', 'photo_credit_text = ?', 'photo_credit_url = ?',
      'description = ?', 'build_status = ?', 'concept_category = ?', 'hidden_at = NULL', `updated_at = datetime('now')`,
    ];
    const vals = [
      row.title, category, type, discipline, row.location || null, row.locationDetail || null,
      row.date || null, row.dateBucket || null, period, row.photoCreditText || '', row.photoCreditUrl || '',
      row.description || null, row.build_status === 'concept' ? 'concept' : 'built', row.conceptCategory || null,
    ];
    if (row.images && row.images.length) { sets.splice(-1, 0, 'images = ?'); vals.push(images); }
    await env.DB.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, target.id).run();
    projectId = target.id;
    // Mimar/Firma artık ayrı alanlar (bkz. yukarı) — biri boş diğeri dolu gönderilebileceğinden
    // (ör. yalnızca Firma girildi) DELETE tetiği İKİSİNDEN BİRİNİN dolu olmasına bakmalı, eskiden
    // olduğu gibi yalnızca row.designer'a değil (aksi halde salt-firma bir düzenlemede eski
    // project_designers satırları hiç temizlenmezdi).
    if ((row.designer && row.designer.length) || (row.office && row.office.length)) {
      await env.DB.prepare(`DELETE FROM project_designers WHERE project_id = ?`).bind(projectId).run();
    }
  } else {
    let slug = row.slug;
    const clash = await env.DB.prepare(`SELECT id FROM projects WHERE slug = ?`).bind(slug).first();
    if (clash) slug = `${slug}-${row.id}`;
    const insert = await insertWithSlugRetry(env, slug, row.id, (finalSlug) => env.DB.prepare(
      `INSERT INTO projects (slug, title, category, type, discipline, location, location_detail, project_date, date_bucket, period, description, images, photo_credit_text, photo_credit_url, source_url, ai_generated, build_status, concept_category, source, legacy_key, claimed_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submission', ?, ?)`
    ).bind(
      finalSlug, row.title, category, type, discipline, row.location || null, row.locationDetail || null,
      row.date || null, row.dateBucket || null, period, row.description || null, images,
      row.photoCreditText || null, row.photoCreditUrl || null, row.source_url || null, row.ai_generated ? 1 : 0,
      row.build_status === 'concept' ? 'concept' : 'built', row.conceptCategory || null,
      marker, row.owner_user_id
    ));
    projectId = insert.meta.last_row_id;
    // bkz. syncOffice'teki AYNI "claimedKey'li ama hedef bulunamadı" durumu ve gerekçesi.
    if (claimedSlug) await blacklistLegacyKey(env, row.owner_user_id, 'projects', claimedSlug);
  }

  if (row.designer && row.designer.length) {
    for (const name of row.designer) {
      const resolved = await resolveArchitectLink(env, name, `project_submission:${row.id}`);
      if (resolved) {
        await env.DB.prepare(`INSERT INTO project_designers (project_id, architect_id, office_id) VALUES (?, ?, ?)`)
          .bind(projectId, resolved.architect_id, resolved.office_id).run();
      }
    }
  }
  if (row.office && row.office.length) {
    for (const name of row.office) {
      const resolved = await resolveOfficeLink(env, name, `project_submission:${row.id}`);
      if (resolved) {
        await env.DB.prepare(`INSERT INTO project_designers (project_id, architect_id, office_id) VALUES (?, ?, ?)`)
          .bind(projectId, resolved.architect_id, resolved.office_id).run();
      }
    }
  }

  if (row.brands && row.brands.length) {
    await env.DB.prepare(`DELETE FROM project_products WHERE project_id = ?`).bind(projectId).run();
    const productIds = await resolveProjectProductLinks(env, row.brands, `project_submission:${row.id}`);
    for (const productId of productIds) {
      await env.DB.prepare(`INSERT OR IGNORE INTO project_products (project_id, product_id) VALUES (?, ?)`).bind(projectId, productId).run();
    }
  }
  return env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(projectId).first();
}

// row: parseSubmissionRow(typeKey, rawRow) ile ZATEN parse edilmiş (JSON alanları diziye çevrilmiş)
// olmalı — bkz. src/lib/submissionTypes.js#parseSubmissionRow. jobs/news canonical modelde yok, no-op.
export async function syncApprovedSubmissionToCanonical(env, typeKey, row) {
  if (typeKey === 'architects') return syncArchitect(env, row);
  if (typeKey === 'offices') return syncOffice(env, row);
  if (typeKey === 'projects') return syncProject(env, row);
  return null;
}

// Bir satır ONAYLIYKEN reddedilir/pending'e alınırsa (bkz. src/routes/admin.js#handleSubmissionsAdmin
// PATCH) — claimed_profile_key/claimed_slug'sız (bağımsız) kayıtlarda bu senkron mekanizmasının
// ÖNCEDEN oluşturduğu canonical satır artık gizlenmeli, aksi halde site onu göstermeye devam ederdi
// (claimed'lı kayıtlarda canonical satır zaten STATİK kökenli olduğundan buna dokunulmaz — o kaydın
// kendi hidden_at'i yalnızca legacyContent.js'in hide/delete akışıyla değişir).
export async function hideCanonicalForUnapprovedSubmission(env, typeKey, row) {
  if (!row) return;
  const marker = submissionMarker(row.id);
  const table = { architects: 'architects', offices: 'offices', projects: 'projects' }[typeKey];
  if (table) {
    await env.DB.prepare(`UPDATE ${table} SET hidden_at = datetime('now') WHERE legacy_key = ?`).bind(marker).run();
  }
}

// Bir <tip>_submissions satırı KALICI olarak silindiğinde (bkz. src/routes/admin.js#handleSubmissionsAdmin
// DELETE) eşleşen canonical satırı da bulup hard-delete eder (bkz. hardDeleteCanonicalRow) — aksi
// halde canonical satır (bu senkron mekanizmasıyla zaten oluşmuş olabilir) sitede "hayalet" olarak
// görünmeye devam ederdi.
export async function markCanonicalDeletedForSubmission(env, typeKey, row, userId) {
  if (!row) return;
  const marker = submissionMarker(row.id);
  const claimedKey = typeKey === 'projects' ? row.claimed_slug : row.claimed_profile_key;
  const table = { architects: 'architects', offices: 'offices', projects: 'projects' }[typeKey];
  if (!table) return;
  if (claimedKey) {
    // Claim edilmiş bir statik/canonical kaydın SİLİNMESİ, o kaydın kendisini değil yalnızca bu
    // gönderi/taslağı hedefler — legacyContent.js'in kendi hide/delete akışı canonical satırı
    // ayrıca yönetir, burada dokunmuyoruz.
    return;
  }
  const canonRow = await env.DB.prepare(`SELECT * FROM ${table} WHERE legacy_key = ?`).bind(marker).first();
  if (canonRow) await hardDeleteCanonicalRow(env, typeKey, canonRow, userId);
}
