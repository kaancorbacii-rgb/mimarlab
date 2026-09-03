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
import { freshSlugFor } from './officeFounderCascade.js';
import { recordSlugRedirect } from './slugRedirects.js';
import { purgeSsrDetailCache } from './ssrCache.js';
import { releaseR2StorageBytes } from './r2Quota.js';
import { clearPendingForKeys } from './derivativeIngest.js';
import { SUBMISSION_TYPES, dateBucketFor } from './submissionTypes.js';
import { slugify } from './slugify.js';

function submissionMarker(id) { return `submission:${id}`; }

// GERÇEK BULGU (kullanıcı bulgusu: "gola ve toledoyu arşivlemeye çalıştım bir şeyler ters gitti,
// sonra sildim ama hâlâ ürün sayfasında gözüküyorlar" — kökten çöz isteği): bir ürün/malzemenin
// canonical `products` satırı (legacy_key='submission:<id>') var olduğu hâlde kendi
// product_submissions/material_submissions taslağı hiç yoksa (ör. doğrudan D1'e geri yüklenen
// kayıtlar — bkz. bu oturumdaki ürün veri geri yükleme — ama teorik olarak taslağı SONRADAN silinip
// canonical satırı kalan HERHANGİ bir kayıt için de aynı boşluk oluşabilir), id tabanlı Düzenle/
// Arşivle/Sil (src/routes/submissions.js#getOwnSubmission/updateOwnSubmission/moderateOwnSubmission,
// src/routes/legacyContent.js#runContentAction'ın id yolu) taslağı `WHERE id = ?` ile arayıp
// bulamadığından sessizce "Bulunamadı" (404) döner — ne admin ne de yükleyen kullanıcı (owner) hiçbir
// zaman düzenleyemez/arşivleyemez/silemez, satır de facto kilitli kalır. Bu fonksiyon, taslak eksikse
// canonical satırdan kendini onarır (sahiplik canonical'ın claimed_by_user_id'sinden devralınır) ki
// yukarıdaki 4 uç normal (taslak zaten varmış gibi) çalışmaya devam etsin. Yalnızca products/materials
// için anlamlıdır (architects/offices/projects'in kendi ayrı claim mekanizması var, bu boşluk sınıfı
// onlarda yok); diğer tipler için davranış AYNEN eski `SELECT * FROM ${table} WHERE id = ?` ile özdeştir.
export async function findOrHealSubmissionDraft(env, type, id) {
  const config = SUBMISSION_TYPES[type];
  if (!config) return null;
  const existing = await env.DB.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).bind(id).first();
  if (existing) return existing;
  if (type !== 'products' && type !== 'materials') return null;

  const canonical = await env.DB
    .prepare(`SELECT * FROM products WHERE legacy_key = ? AND deleted_at IS NULL`)
    .bind(submissionMarker(id))
    .first();
  // claimed_by_user_id yoksa (sahipsiz canonical satır) bir sahip UYDURMAK yanlış olur — böyle bir
  // satır zaten yalnızca admin'in ayrı, taslak GEREKTİRMEYEN /api/admin/legacy/product/:id ucuyla
  // (bkz. src/routes/legacyContent.js#handleAdminProductEdit) düzenlenmelidir.
  if (!canonical || !canonical.claimed_by_user_id) return null;

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO ${config.table}
       (id, owner_user_id, status, created_at, updated_at, title, brand, designer, year, website, category, description, images, specs, files, source_url, ai_generated)
     VALUES (?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, canonical.claimed_by_user_id, now, now,
    canonical.title, canonical.brand_name_raw, canonical.designer, canonical.year,
    canonical.website, canonical.category, canonical.description, canonical.images, canonical.specs, canonical.files,
    canonical.source_url, canonical.ai_generated ? 1 : 0,
  ).run();

  return env.DB.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).bind(id).first();
}

// GERÇEK BULGU (bkz. kullanıcı isteği: "Admin hesabından bir projeye yorum yazdım ve ... Renzo Piano
// hesabıyla yorumum gözüktü ... kökten çöz"): syncOffice/syncArchitect'in INSERT dalı, YENİ bir
// mimar/firma kaydı oluşturulduğunda claimed_by_user_id'yi KOŞULSUZ gönderiyi yapan hesaba
// (row.owner_user_id) yazıyordu — bu, bir üyenin KENDİ profilini eklemesinde doğru olsa da, admin
// platform içeriği olarak (kendi kimliği DEĞİL) onlarca üçüncü şahıs mimar/firma profili eklerken de
// AYNI şekilde çalışıyor, admin'in hesabını o profillerin "sahibi" gibi işaretliyordu (gerçek veri:
// mimarlabcom@gmail.com hesabı 18 mimar + 6 firma profilinin claimed_by_user_id'siydi). Bu satır
// src/routes/comments.js#listComments'teki commenterProfile JOIN'ini (yorumu yapan hesabın sahip
// olduğu bir profil varsa adı/fotoğrafı o profilden gösterilir) etkiliyordu — admin hangi yorumu
// yaparsa yapsın, bu 24 profilden RASTGELE biri (LIMIT 1, sıralama garantisi yok) "yorumu yapan" gibi
// görünüyordu. Admin kurumsal/platform hesabı olduğundan (kişisel bir mimar/firma kimliği DEĞİL) bu
// otomatik sahiplenme hiçbir zaman doğru değil — admin'in eklediği yeni kayıtlarda claimed_by_user_id
// artık hep NULL kalır, yalnızca gerçek (admin olmayan) bir üyenin kendi gönderisi bu alanı doldurur.
async function resolveClaimedByUserId(env, ownerUserId) {
  if (!ownerUserId) return ownerUserId;
  const owner = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(ownerUserId).first();
  return owner && owner.role === 'admin' ? null : ownerUserId;
}

// bkz. src/routes/{architect,office,project,product,legacyContent}.js#foldTr — AYNI TR-duyarlı
// casefold deseni (İ/I/ı vb. doğru katlanır, sonra diyakritikler ASCII karşılığına indirgenir).
// findOneByName'in birebir eşleşme bulamadığında ikinci denemesi için burada da gerekiyor (bkz. o
// fonksiyonun yorumu) — arama eşleştirmesiyle aynı davranışı istemeden ayrı bir kopya tutmak yerine
// paylaşılan bir modüle çıkarmak ileride yapılabilecek bir sadeleştirme, şimdilik mevcut kod
// convention'ıyla (5 dosyada zaten ayrı ayrı kopyalanmış) tutarlı kalınıyor.
function trLower(s) {
  return (s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/Ş/g, 'ş').replace(/Ğ/g, 'ğ').replace(/Ü/g, 'ü').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç').toLowerCase();
}
function foldTr(s) {
  return trLower(s).replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o');
}

// src/routes/submissions.js#createSubmission'ın sunucu tarafı doğrulaması için — istemci tarafı
// canlı uyarı (bkz. src/routes/public.js#handlePublicCheckName, AYNI foldTr TAM eşleşme deseni)
// debounce'landığından hızlı yazıp göndermede atlanabilir; burası yetkili son kontroldür (bkz.
// kullanıcı isteği: "daha önce siteye yüklenen ... aynı isimde proje yüklenemesin"). Yalnızca
// GERÇEKTEN yeni (claimed_profile_key/claimed_slug'sız) gönderiler için çağrılır — sahiplenilmiş bir
// statik kaydın ilk düzenlemesinde body.name zaten claimed_profile_key ile AYNI olacağından (bkz.
// createSubmission'daki atama), o akışta bu her zaman yanlışlıkla "çakışma" derdi.
export async function isDuplicateCanonicalName(env, typeKey, name, { brand } = {}) {
  const folded = foldTr((name || '').trim());
  if (!folded) return false;
  if (typeKey === 'architects' || typeKey === 'offices') {
    const { results } = await env.DB.prepare(`SELECT name FROM ${typeKey} WHERE deleted_at IS NULL`).all();
    return results.some(r => foldTr(r.name || '') === folded);
  }
  if (typeKey === 'projects') {
    const { results } = await env.DB.prepare(`SELECT title FROM projects WHERE deleted_at IS NULL`).all();
    return results.some(r => foldTr(r.title || '') === folded);
  }
  if (typeKey === 'products' || typeKey === 'materials') {
    const foldedBrand = foldTr((brand || '').trim());
    if (!foldedBrand) return false; // doğal anahtar marka+başlık ikilisi — markasız tek başına başlık anlamsız
    const kind = typeKey === 'products' ? 'product' : 'material';
    const { results } = await env.DB.prepare(`SELECT title, brand_name_raw FROM products WHERE deleted_at IS NULL AND kind = ?`).bind(kind).all();
    return results.some(r => foldTr(r.title || '') === folded && foldTr(r.brand_name_raw || '') === foldedBrand);
  }
  return false;
}

// Bir projenin başlığı (dolayısıyla slug'ı) değiştiğinde — mimar/firma yeniden adlandırmasındaki
// renameOfficeEverywhere/renameArchitectEverywhere'in proje karşılığı. Projeye slug ile referans
// veren tablolar: comments/ratings/saved_items (bkz. src/lib/cascadeDelete.js dosya başı yorumu
// "Başka hiçbir tablo bir projeye slug ile referans vermez" — top100_entries eklendiğinde bu artık
// güncel değil) + legacy_content_hidden (bkz. src/routes/legacyContent.js#setLegacyHidden —
// content_type='projects', content_key=slug) + top100_entries.slug (bkz. src/routes/top100.js#
// computeTop100 — canlı projects eşleşmesi bu slug ÜZERİNDEN yapılır; güncellenmezse yeniden
// adlandırılan bir proje En İyi 100 sayfasında eski isimle ve kırık bir linkle kalır, gerçek bulgu
// 2026-08-21).
async function renameProjectSlugEverywhere(env, oldSlug, newSlug) {
  await Promise.all([
    env.DB.prepare(`UPDATE comments SET target_id = ? WHERE target_type = 'project' AND target_id = ?`).bind(newSlug, oldSlug).run(),
    env.DB.prepare(`UPDATE OR IGNORE ratings SET target_id = ? WHERE target_type = 'project' AND target_id = ?`).bind(newSlug, oldSlug).run(),
    env.DB.prepare(`UPDATE OR IGNORE saved_items SET item_key = ? WHERE item_type = 'project' AND item_key = ?`).bind(newSlug, oldSlug).run(),
    env.DB.prepare(`UPDATE shared_items SET item_key = ? WHERE item_type = 'project' AND item_key = ?`).bind(newSlug, oldSlug).run(),
    env.DB.prepare(`UPDATE OR IGNORE legacy_content_hidden SET content_key = ? WHERE content_type = 'projects' AND content_key = ?`).bind(newSlug, oldSlug).run(),
    env.DB.prepare(`UPDATE top100_entries SET slug = ? WHERE slug = ?`).bind(newSlug, oldSlug).run(),
  ]);
  // bkz. migrations/0041_slug_redirects.sql — eski /yapi/:slug ve /proje/:slug hâlâ çalışsın (301 ile yeniye).
  await recordSlugRedirect(env, 'projects', oldSlug, newSlug);
  await purgeSsrDetailCache('project', oldSlug, env);
  await purgeSsrDetailCache('project', newSlug, env);
}

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
  // files alanı (bkz. MEDIA_IMAGE_FIELDS_BY_TYPE.products/materials.arrayFields) images'ten farklı
  // olarak düz URL string DEĞİL {url,filename,format,size} nesnesi taşır (bkz. migrations/
  // 0071_product_files.sql) — bu fonksiyon önceden yalnızca string bekliyordu, obje geldiğinde
  // sessizce atlıyor, silinen bir dosyanın R2 nesnesi asla temizlenmiyordu (gerçek bulgu).
  if (val && typeof val === 'object' && typeof val.url === 'string') { collectMediaKeysFromValue(val.url, into); return; }
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
//
// gerçek bulgu (denetim raporu): silinen görsellerin boyutu r2_usage.total_bytes'tan hiç
// düşürülmüyordu (bkz. r2Quota.js#releaseR2StorageBytes) — sayaç yalnızca artıyor, zamanla gerçek
// R2 kullanımından uzaklaşıp yeni yüklemeleri erkenden bloke edebiliyordu. Silmeden ÖNCE head() ile
// gerçek boyut okunur (rezervasyondaki file.size TAHMİNİ değil, R2'nin kendi kayıtlı boyutu — WebP
// optimizasyonundan sonraki GERÇEK yazılan boyut budur); head() de silme de ayrı ayrı best-effort'tur,
// biri başarısız olsa da döngü/satır silme işlemi devam eder.
// gerçek bulgu (denetim raporu): önceki sürüm her anahtar için AYRI AYRI ve SIRALI head()+delete()
// çağırıyordu (20 görsellik bir galeri = 40 sıralı R2 subrequest'i) — Workers'ın free tier istek
// başına 50 subrequest limitine, D1 cascade + facet recompute + cache invalidation'ın AYNI istekte
// eklediği subrequest'lerle birlikte gerçekçi biçimde yaklaşıyor/aşıyordu. head() çağrıları artık
// paralel (Promise.all), delete() ise R2Bucket'ın tek çağrıda 1000 anahtara kadar kabul eden toplu
// silme API'siyle (chunk'lanarak) tek subrequest'e indirgeniyor.
// denetim bulgusu (2026-08-13): freedBytes önceden delete() SONUCUNDAN BAĞIMSIZ olarak
// koşulsuz düşürülüyordu — bir chunk'ın delete() çağrısı başarısız olsa (ör. geçici R2 hatası)
// bile o chunk'taki key'lerin boyutu kota sayacından düşüyordu, yani nesneler R2'de fiilen
// hâlâ dururken sayaç "silindi" varsayıyordu. Bu, releaseR2StorageBytes'ın gerçek kullanımdan
// sapmasına (drift) yol açar. Artık yalnızca delete() BAŞARILI olan chunk'ların head() boyutu
// toplanıp düşürülüyor; başarısız chunk yapılandırılmış olarak loglanıyor (sessizce yutulmuyor).
// image-cdn.js#DERIVATIVE_WIDTHS / src/lib/imageDerivative.js#DERIVATIVE_WIDTHS /
// scripts/generate-image-derivatives.py#WIDTHS ile AYNI merdiven olmalı.
const DERIVATIVE_WIDTHS_FOR_CLEANUP = [400, 800, 1600];

// Denetim bulgusu (2026-09-03): silme yolu yalnızca ORİJİNAL anahtarı siliyordu — o görselin
// _derived/w400|w800|w1600/r2/<anahtar> türevleri R2'de ÖKSÜZ kalıyordu. Türevler eskiden yalnızca
// tek seferlik bir betikle üretildiğinden bu sınırlı bir sızıntıydı; türevler artık HER yüklemede
// üretildiğinden (bkz. src/lib/derivativeIngest.js) sızıntı kalıcı olarak büyürdü — silinen her
// galeri, arkasında 3 katına kadar öksüz nesne bırakırdı.
//
// GÜVENLİK: yalnızca ZATEN SİLİNMEKTE OLAN anahtarların türevleri genişletilir. Hâlâ kullanımda
// olan bir görselin türevine asla dokunulmaz — türev anahtarı orijinalin anahtarından deterministik
// olarak üretilir, dolayısıyla bu liste orijinal listesinin dışına çıkamaz.
function withDerivativeKeys(keys) {
  const out = [];
  for (const key of keys) {
    out.push(key);
    // Türevi hiç olmayan (SVG/GIF, ya da kazanç yoksa yazılmayan) anahtarlar için delete() sessizce
    // başarılıdır — var olmayan nesneyi silmek hata değildir, ayrıca bir kontrol gerektirmez.
    for (const w of DERIVATIVE_WIDTHS_FOR_CLEANUP) out.push(`_derived/w${w}/r2/${key}`);
  }
  return out;
}

export async function deleteR2MediaKeys(env, originalKeys) {
  if (!originalKeys.length) return;
  const keys = withDerivativeKeys(originalKeys);
  // head() YALNIZCA orijinaller için çağrılır, genişletilmiş liste için DEĞİL — bu fonksiyon
  // Workers'ın istek başına subrequest limitine karşı bilerek optimize edilmişti (bkz. yukarıdaki
  // not); türevlerle birlikte head() sayısı 4 katına çıkar ve 20 görsellik bir galeride limite
  // dayanırdı. Sonuç: türevlerin baytları kota sayacından DÜŞÜLMEZ, yani sayaç gerçek kullanımın
  // biraz ÜSTÜNDE kalır. Bu bilinçli ve güvenli yön: sayacın gerçeğin altına düşmesi tavanı aşmaya
  // yol açardı, üstünde kalması yalnızca bir miktar payı erken harcar (bkz. r2Quota.js).
  const heads = await Promise.all(originalKeys.map(key => env.UPLOADS.head(key).catch(() => null)));
  const sizeByKey = new Map();
  originalKeys.forEach((key, i) => { if (heads[i]) sizeByKey.set(key, heads[i].size); });
  let freedBytes = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    try {
      await env.UPLOADS.delete(chunk);
      for (const key of chunk) freedBytes += sizeByKey.get(key) || 0;
      // performance audit (2026-09-01) — /media/* artık edge'de (caches.default) önbellekleniyor
      // (bkz. src/routes/upload.js#handleMediaRoute). Silinen nesnenin edge kopyası kendi
      // s-maxage'ı (30 gün) dolana kadar yaşamaya devam ederdi; burada aynı işlemde temizleniyor.
      // caches.default PoP-BAŞINADIR (bkz. src/lib/ssrCache.js#purgeSsrDetailCache'teki AYNI
      // sınırlama notu) — yalnızca bu silme isteğini işleyen edge node'un girdisi düşer, tam
      // garanti s-maxage'ın kendisidir. Best-effort: hata silme işlemini ETKİLEMEZ.
      try {
        await Promise.all(chunk.map(key =>
          caches.default.delete(new Request(`https://mimarlab.com/media/${key.split('/').map(encodeURIComponent).join('/')}`)).catch(() => {})
        ));
      } catch { /* caches API yoksa (yerel wrangler dev) sessizce atla — silme BAŞARILI sayılır */ }
    } catch (err) {
      console.error(JSON.stringify({ event: 'r2_delete_chunk_failed', keyCount: chunk.length, reason: (err && err.message) || String(err) }));
    }
  }
  if (freedBytes) await releaseR2StorageBytes(env, freedBytes);
  // Bu kaynaklar için bekleyen türev işi varsa DÜŞÜR — aksi halde kuyruk artık var olmayan bir
  // görsel için sonsuza kadar iş taşır (betik her koşuda 404 alır, satır hiç temizlenmezdi).
  await clearPendingForKeys(env, originalKeys);
}

// Aynı kolon adları (images/photo_url/logo_url) *_submissions taslak tablolarında da kullanılır
// (bkz. src/lib/submissionTypes.js#SUBMISSION_TYPES) — bu yüzden hem canonical satırlar hem taslak
// satırlar için R2 temizliğinde AYNI eşleme yeniden kullanılır (bkz. src/routes/legacyContent.js/
// admin.js'teki taslak-satır hard-delete noktaları).
export const MEDIA_IMAGE_FIELDS_BY_TYPE = {
  projects: { arrayFields: ['images'] },
  products: { arrayFields: ['images', 'files'] },
  materials: { arrayFields: ['images', 'files'] },
  architects: { stringFields: ['photo_url'] },
  // cover_url — marka kapak görseli (bkz. migrations/0075_office_cover_url.sql). logo_url ile AYNI
  // türde tek bir R2 yolu; buraya eklenmezse değiştirilen/silinen kapaklar R2'de yetim kalırdı.
  offices: { stringFields: ['logo_url', 'cover_url'] },
};

// Bir kaydın statik anahtarını (slug/name/"marka|||başlık") legacy_content_hidden'a kalıcı bir
// "bir daha asla gösterme" damgası olarak yazar. Bu, hard-delete sonrası canonical satır artık
// var OLMADIĞINDA bile statik data.js dizilerindeki (projeler-data.js vb.) aynı kaydın
// /api/public/hidden üzerinden gizli kalmasını sağlayan TEK mekanizmadır (bkz.
// src/routes/legacyContent.js#fetchHiddenMap — artık hem hidden_at/deleted_at'i hem bu tabloyu
// TÜM tipler için tarar, önceden yalnızca 'news' için kullanılıyordu).
// Hazırlanmış (henüz ÇALIŞTIRILMAMIŞ) statement döner — hardDeleteCanonicalRow bunu kendi
// env.DB.batch() dizisine eklemek için kullanır (bkz. o fonksiyondaki audit notu); blacklistLegacyKey
// (aşağıda) tek başına çağrıldığında aynı statement'ı hemen çalıştırır. İki yerde AYNI SQL'i
// tekrarlamamak için tek kaynak burası.
function blacklistLegacyKeyStatement(env, userId, type, key) {
  if (!key) return null;
  return env.DB.prepare(
    `INSERT INTO legacy_content_hidden (id, content_type, content_key, hidden_by_user_id, hidden_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(content_type, content_key) DO NOTHING`
  ).bind(newId(), type, key, userId, Date.now());
}

export async function blacklistLegacyKey(env, userId, type, key) {
  const stmt = blacklistLegacyKeyStatement(env, userId, type, key);
  if (stmt) await stmt.run();
}

// Bir taslak satır SİLİNMEDEN, yalnızca DÜZENLENİRKEN (galeriden bir görsel çıkarıldı, ya da
// photo_url/logo_url üzerine yeni bir yükleme ile değiştirildi) artık hiçbir alandan referans
// edilmeyen ESKİ R2 nesnelerini temizler — bkz. kullanıcı isteği: "Admin bir görseli ... canlı
// siteden sildiği zaman ... D1 sisteminde de içerik kalıcı olarak silinsin". GERÇEK BULGU: bu
// temizlik önceden HİÇ yapılmıyordu (yalnızca tam satır silme R2'ye dokunuyordu, bkz.
// hardDeleteCanonicalRow) — bir galeri fotoğrafını kaldırıp kaydetmek ya da bir mimar fotoğrafını/
// firma logosunu değiştirmek eski R2 nesnesini sonsuza kadar erişilemez ama silinmemiş bırakıyordu.
export async function cleanupReplacedR2Media(env, type, oldRow, newRow) {
  const fields = MEDIA_IMAGE_FIELDS_BY_TYPE[type];
  if (!fields || !oldRow || !newRow) return;
  const oldKeys = collectR2MediaKeys(oldRow, fields);
  if (!oldKeys.length) return;
  const newKeys = new Set(collectR2MediaKeys(newRow, fields));
  const removedKeys = oldKeys.filter(key => !newKeys.has(key));
  if (removedKeys.length) await deleteR2MediaKeys(env, removedKeys);
}

// Bir canonical satırı GERÇEKTEN (hard delete) D1'den siler — bkz. kullanıcı isteği: "Admin
// panelinden sil dediğimde kayıt veritabanından TAMAMEN silinsin, sadece işaretlenmesin".
// Sırasıyla: (1) satıra bağlı R2 görsellerini temizler, (2) FK ile bu satıra referans veren
// diğer canonical kolonları (architects.office_id, products.brand_office_id — bunlarda ON DELETE
// CASCADE yok, sade REFERENCES, bkz. migrations/0022_id_first_entities.sql) NULL'lar, (3) join
// tablolarındaki (office_founders/project_designers/product_architects/project_products/
// project_awards — bunlarda ON DELETE CASCADE VAR) satırları AYRICA temizler, (4) asıl satırı
// siler, (5) statik data.js karşılığının bir daha görünmemesi için legacy_content_hidden'a damgalar.
// audit bulgusu (denetim raporu, 2026-08-21): (2)-(5) adımları önceden ayrı sıralı .run()
// çağrılarıydı — aralarında bir Worker hatası kısmi temizlik bırakabiliyordu (ör. join satırları
// silinip asıl satır kalıyor, ya da tam tersi). Artık TEK bir env.DB.batch() ile atomik yazılıyor;
// D1 batch'i sıralı bir transaction olarak çalıştırdığından SIRA (2) NULL'lama adımlarının (3)/(4)
// silmelerinden ÖNCE gelmesi KORUNUR — architects.office_id/products.brand_office_id CASCADE'siz
// olduğundan, offices satırı NULL'lanmadan silinirse (D1'in FK enforcement açık olduğu senaryoda)
// bu sıra bozulursa DELETE hata verir. R2 temizliği (1) D1 dışı olduğundan batch'in DIŞINDA, öncesinde
// kalır (mevcut davranış — kısmi hata durumunda en kötü ihtimalle bir R2 orphan'ı, ki
// r2Reconcile.js bunu zaten ayrıca tarıyor).
export async function hardDeleteCanonicalRow(env, type, row, userId) {
  if (!row) return;
  const table = CANONICAL_TABLE_BY_TYPE[type];
  if (!table) return;

  await deleteR2MediaKeys(env, collectR2MediaKeys(row, MEDIA_IMAGE_FIELDS_BY_TYPE[type] || {}));

  const statements = [];
  if (type === 'offices') {
    statements.push(
      env.DB.prepare(`UPDATE architects SET office_id = NULL WHERE office_id = ?`).bind(row.id),
      env.DB.prepare(`UPDATE products SET brand_office_id = NULL WHERE brand_office_id = ?`).bind(row.id),
      env.DB.prepare(`DELETE FROM office_founders WHERE office_id = ?`).bind(row.id),
      env.DB.prepare(`DELETE FROM project_designers WHERE office_id = ?`).bind(row.id),
    );
  }
  if (type === 'architects') {
    statements.push(
      env.DB.prepare(`DELETE FROM office_founders WHERE architect_id = ?`).bind(row.id),
      env.DB.prepare(`DELETE FROM project_designers WHERE architect_id = ?`).bind(row.id),
      env.DB.prepare(`DELETE FROM product_architects WHERE architect_id = ?`).bind(row.id),
    );
  }
  if (type === 'projects') {
    statements.push(
      env.DB.prepare(`DELETE FROM project_designers WHERE project_id = ?`).bind(row.id),
      env.DB.prepare(`DELETE FROM project_products WHERE project_id = ?`).bind(row.id),
      env.DB.prepare(`DELETE FROM project_awards WHERE project_id = ?`).bind(row.id),
    );
  }
  if (type === 'products' || type === 'materials') {
    statements.push(
      env.DB.prepare(`DELETE FROM product_architects WHERE product_id = ?`).bind(row.id),
      env.DB.prepare(`DELETE FROM project_products WHERE product_id = ?`).bind(row.id),
    );
  }

  statements.push(env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(row.id));
  const blacklistStmt = blacklistLegacyKeyStatement(env, userId, type, canonicalKeyFor(type, row));
  if (blacklistStmt) statements.push(blacklistStmt);

  await env.DB.batch(statements);
  if (type === 'architects' || type === 'offices') await pruneConflictsReferencingId(env, row.id);
}

// deleteCanonicalRowFully — bir kaydı SİLERKEN cascadeDelete.js'in (yorum/puan/kaydetme +
// *_submissions serbest metin/JSON alan temizliği) ve yukarıdaki hardDeleteCanonicalRow'un (join
// tabloları + canonical satır + blacklist) HER ZAMAN birlikte çalıştığını garanti eden tek giriş
// noktası. audit bulgusu: bu ikisi önceden src/routes/legacyContent.js içinde 4 ayrı yerde elle
// eşleştiriliyordu (aynı if/else deseni kopyalanarak) — bugün hepsi doğru eşleşse de, ileride yeni
// bir silme yolu ikisinden birini çağırıp diğerini unutursa (PRAGMA foreign_keys açık olsa bile,
// cascadeDelete.js'in temizlediği *_submissions serbest metin/JSON alanları hiçbir FK ile
// bağlı olmadığından) hiçbir mekanizma bunu yakalamazdı. `runCascadeCleanup`: çağıranın kendi
// tipine özgü isim/slug/key eşlemesiyle hazırladığı, cascadeDelete.js'teki ilgili fonksiyonu
// çağıran bir thunk — tip-özel argüman türetme mantığı burada TEKRARLANMAZ, çağıranda kalır.
// src/routes/admin.js'deki gönderi-silme akışı (markCanonicalDeletedForSubmission) BİLEREK bu
// wrapper'ı kullanmaz: o akış canonical satırı doğal anahtar yerine submission marker'ıyla
// (legacy_key = 'submission:<id>') bulur — farklı bir arama stratejisi, burada birleştirilmedi.
export async function deleteCanonicalRowFully(env, userId, type, canonRow, naturalKey, runCascadeCleanup) {
  await runCascadeCleanup();
  if (canonRow) await hardDeleteCanonicalRow(env, type, canonRow, userId);
  else if (naturalKey) await blacklistLegacyKey(env, userId, type, naturalKey);
}

// bkz. src/routes/legacyContent.js#LEGACY_TYPES.key — admin panelinin "içerik anahtarı" (mimar/ofis
// için bare name, proje için slug, ürün/malzeme için "marka|||başlık") ile canonical satırı bulur.
// Faz 3 öncesi bu anahtar legacy_content_hidden.content_key'e karşılık geliyordu; artık doğrudan
// canonical satırın kendisini (name/slug/legacy_key üzerinden) hedefler.
export async function findCanonicalRowByNaturalKey(env, typeKey, key) {
  if (typeKey === 'architects' || typeKey === 'offices') {
    // gerçek bulgu (2026-08-28): save-widget.js/architect-modal.js/office-modal.js "Kaydet"
    // butonu item_key olarak slugify(name) yazıyor (ör. "kaan-corbaci"), ama bu sorgu yalnızca
    // ham `name` (ör. "Kaan Çorbacı") veya `legacy_key` ile eşleştiriyordu — slug hemen hemen
    // HİÇBİR ZAMAN bunlardan biriyle birebir eşleşmediğinden shapeSavedTargetInfo#live hep false
    // dönüyor, GET /api/saved bu satırları sessizce filtreliyordu (kaydedilen mimar/firma profilleri
    // Aktivitelerim > Kaydettiklerim'de hiç görünmüyordu). src/routes/architect.js#findArchitect /
    // src/routes/office.js#findOffice'teki AYNI slug-kolonu + slugify-tarama fallback'i burada da
    // uygulanır ki gerçek profil sayfasının bulduğu her kayıt burada da bulunsun.
    const table = typeKey;
    const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE name = ? OR slug = ? OR legacy_key = ? LIMIT 1`).bind(key, key, key).first();
    if (row) return row;
    const { results } = await env.DB.prepare(`SELECT id, name FROM ${table}`).all();
    const match = results.find(r => slugify(r.name) === key);
    if (!match) return null;
    return env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(match.id).first();
  }
  if (typeKey === 'projects') {
    return env.DB.prepare(`SELECT * FROM projects WHERE slug = ? OR legacy_key = ? LIMIT 1`).bind(key, key).first();
  }
  if (typeKey === 'products' || typeKey === 'materials') {
    return env.DB.prepare(`SELECT * FROM products WHERE legacy_key = ? LIMIT 1`).bind(key).first();
  }
  return null;
}

// export edilir — bkz. src/routes/legacyContent.js#handleAdminProductEdit, admin'in legacy_static
// kökenli bir ürünün markasını doğrudan düzenlerken brand_office_id'yi AYNI mantıkla yeniden çözmesi
// için (syncProduct'takiyle iki ayrı kopya olmasın diye).
export async function findOneByName(env, table, name) {
  if (!name) return { row: null, ambiguous: false };
  const trimmed = name.trim();
  if (!trimmed) return { row: null, ambiguous: false };
  const { results } = await env.DB.prepare(`SELECT * FROM ${table} WHERE deleted_at IS NULL AND name = ?`).bind(trimmed).all();
  if (results.length === 1) return { row: results[0], ambiguous: false };
  if (results.length > 1) return { row: null, ambiguous: true, candidates: results };
  // Birebir eşleşme yok — gerçek bulgu: proje-ekle.html/kisi-ekle.html'in Mimar/Firma kutusuna
  // otomatik tamamlamadan seçmeden serbestçe yazılan bir isim ("nevzat sayın" vb.), canonical
  // "Nevzat Sayın" kaydıyla yalnızca harf büyüklüğü/baştaki-sondaki boşluk/TR karakter farkı
  // yüzünden hiç eşleşmiyor, bağlantı (project_designers/office_founders/architects.office_id)
  // sessizce hiç kurulmuyordu — ne bir hata ne de bir log. TR-duyarlı casefold (bkz. yukarısı
  // foldTr, src/routes/*.js'teki arama eşleştirmesiyle AYNI desen) ile ikinci bir deneme yapılır.
  // architects/offices tabloları küçük olduğundan (yüzler-binler mertebesi) burada tam tablo
  // taraması kabul edilebilir bir maliyet.
  const folded = foldTr(trimmed);
  const { results: all } = await env.DB.prepare(`SELECT * FROM ${table} WHERE deleted_at IS NULL`).all();
  const matches = all.filter(r => foldTr((r.name || '').trim()) === folded);
  if (matches.length === 1) return { row: matches[0], ambiguous: false };
  if (matches.length > 1) return { row: null, ambiguous: true, candidates: matches };
  return { row: null, ambiguous: false };
}

// Kök neden düzeltmesi (bkz. kullanıcı isteği: "neden 2 tane Kaan Çorbacı mimar profili oluşmuş?
// Aynı isimle mimar, firma, ürün, proje oluşmasına asla izin verme") — syncArchitect/syncOffice'in
// "bu claimed_profile_key'e karşılık gelen canonical satır hangisi" sorgusu ÖNCEDEN strict SQL
// `legacy_key = ? OR name = ?` kullanıyordu. claimed_profile_key (kisi-ekle.html/firma-ekle.html/
// js/components/auth-modal.js'in gönderdiği ham isim) canonical satırın name'inden yalnızca büyük/
// küçük harf, baştaki-sondaki boşluk ya da TR karakter (İ/I/ı/Ş/Ğ/Ü/Ö/Ç) katlamasıyla ayrışsa bile
// bu strict eşleşme sessizce BAŞARISIZ olup çağıranı "canonical karşılığı yok" sanıp İKİNCİ, mükerrer
// bir canonical satır (yeni slug + UUID sonekli, bkz. gerçek bulgu: /kisi/kaan-corbaci-<uuid>)
// oluşturmaya sürüklüyordu — findOneByName'in ("Nevzat Sayın" gerçek bulgusu, bkz. yukarısı) AYNI
// foldTr'lı ikinci deneme mantığı burada da (legacy_key'i de kapsayacak şekilde) uygulanır. Birden
// fazla bulanık eşleşme varsa (ör. iki farklı mimar tesadüfen aynı ada foldTr sonrası indirgeniyorsa)
// sessizce YANLIŞ birini seçmek yerine migration_name_conflicts'e loglanır ve null döner (çağıran
// yine de yeni bir satır oluşturur — mevcut davranışla aynı, yalnızca artık görünür bir kayıt bırakır).
async function findSyncTargetByClaim(env, table, claimedKey) {
  const trimmed = (claimedKey || '').trim();
  if (!trimmed) return null;
  const strict = await env.DB.prepare(
    `SELECT * FROM ${table} WHERE deleted_at IS NULL AND (legacy_key = ? OR name = ?) LIMIT 1`
  ).bind(trimmed, trimmed).first();
  if (strict) return strict;
  const folded = foldTr(trimmed);
  const { results: all } = await env.DB.prepare(`SELECT * FROM ${table} WHERE deleted_at IS NULL`).all();
  const matches = all.filter(r => foldTr((r.name || '').trim()) === folded || (r.legacy_key && foldTr(r.legacy_key.trim()) === folded));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    await logConflict(env, `${table === 'architects' ? 'architect' : 'office'}_claim_sync`, trimmed, `${table}_sync_target`, matches);
    return null;
  }
  return null;
}

async function logConflict(env, entity_type, conflict_key, context, candidates) {
  await env.DB.prepare(
    `INSERT INTO migration_name_conflicts (entity_type, conflict_key, context, candidates, status) VALUES (?, ?, ?, ?, 'pending')`
  ).bind(entity_type, conflict_key, context, JSON.stringify(candidates.map(r => ({ id: r.id, name: r.name })))).run();
}

// gerçek bulgu (denetim raporu): logConflict tek seferlik migrate-to-id-first.js scripti DEĞİL, canlı
// onay akışında da çalışıyor (bkz. yukarıdaki çağrı noktaları) — bir mimar/ofis daha sonra kalıcı
// olarak silinirse (hardDeleteCanonicalRow), onu ADAY olarak taşıyan bekleyen çakışma satırları hiç
// güncellenmiyordu; admin panelindeki "Migrasyon Çakışmaları" listesi zamanla artık var olmayan bir
// id'ye işaret eden ölü adaylarla doluyordu (seçilirse hiçbir yere bağlanmayan resolvedTargetId).
// candidates bir JSON dizisi olduğundan (SQL'de doğrudan sorgulanamaz) satırlar JS'te filtrelenip TEK
// bir env.DB.batch() ile silinir.
async function pruneConflictsReferencingId(env, id) {
  const { results } = await env.DB.prepare(`SELECT id, candidates FROM migration_name_conflicts WHERE status = 'pending'`).all();
  const staleIds = [];
  for (const row of results) {
    let candidates;
    try { candidates = JSON.parse(row.candidates || '[]'); } catch { continue; }
    if (Array.isArray(candidates) && candidates.some(c => c && c.id === id)) staleIds.push(row.id);
  }
  if (!staleIds.length) return;
  await env.DB.batch(staleIds.map(cid => env.DB.prepare(`DELETE FROM migration_name_conflicts WHERE id = ?`).bind(cid)));
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
    } else {
      // candidates=[] "hiç eşleşme yok" anlamına gelir (bkz. migrations/0022 tablo yorumu) — eskiden
      // yalnızca ambiguous (birden fazla eşleşme) loglanıyordu, bu dal (gerçek bulgu: sessiz atlanan
      // isimler) hiçbir yerde görünmüyordu.
      await logConflict(env, 'office_founder', name, `office:${officeId}`, match.ambiguous ? match.candidates : []);
    }
  }
}

async function syncOffice(env, row) {
  const claimedKey = row.claimed_profile_key;
  const marker = submissionMarker(row.id);
  let target = claimedKey
    ? await findSyncTargetByClaim(env, 'offices', claimedKey)
    : await env.DB.prepare(`SELECT * FROM offices WHERE legacy_key = ?`).bind(marker).first();
  // SON GÜVENLİK KONTROLÜ (bkz. kullanıcı isteği: "Aynı isimle mimar, firma, ürün, proje oluşmasına
  // asla izin verme") — buraya kadar hedef bulunamamış olması bu adı taşıyan BAŞKA bir canonical
  // satırın hiç olmadığı anlamına gelmez: haftalar önce oluşturulup hiç onaylanmamış/senkronlanmamış
  // BAĞIMSIZ bir taslak, bugün ilk kez onaylanınca (isDuplicateCanonicalName yalnızca YENİ gönderi
  // ANINDA kontrol eder, updateOwnSubmission/admin PATCH akışında hiç çalışmaz) canonical'da ZATEN
  // var olan aynı adlı satırın YANINA ikinci bir satır eklerdi (gerçek bulgu: "Kaan Çorbacı" — aynı
  // isimle iki, hatta üç mimar profili oluşmuştu). Insert'ten hemen önce foldTr'lı bir isim taraması
  // ile son kez kontrol edilir; bulunursa INSERT yerine O satır güncellenir.
  if (!target) {
    const nameMatch = await findOneByName(env, 'offices', row.name);
    if (nameMatch.row) target = nameMatch.row;
  }

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
      if (row.cover_url) { sets.push('cover_url = ?'); vals.push(row.cover_url); }
      // `row.social_links.length` KOŞULU KALDIRILDI (kullanıcı isteği, 2026-09-01: "sosyal medya
      // silme sorununu da çöz"): boş dizi de yazılır, çünkü artık BOŞ DİZİ ile ALAN HİÇ YOK
      // birbirinden ayrılıyor (bkz. submissionTypes.js#nullableArrayFields — gövdede olmayan alan
      // NULL olarak saklanır ve buraya `null` gelir, dolayısıyla bu koşul onu zaten atlar).
      // Eskiden ikisi de '[]' idi; boş diziyi atlamak "hiç göndermeyen çağıranı koru" demekti ama
      // aynı zamanda kullanıcının TÜM satırları silip kaydetmesini de sessizce yok sayıyordu —
      // bağlantılar profilde kalmaya devam ediyor, silmenin hiçbir yolu olmuyordu.
      if (row.social_links) { sets.push('social_links = ?'); vals.push(socialLinks); }
      // GERÇEK BULGU: 'awards' bu dalda hiç yoktu — firma-ekle.html'de bir Ödül alanı olmadığından
      // (bkz. kullanıcı isteği: proje-ekle.html'e Ödül eklenirken firma-ekle.html'e de eklendi) bugüne
      // kadar tetiklenmemiş, ama offices.awards kolonu/config zaten vardı (bkz. schema.sql, migrations/
      // 0022_id_first_entities.sql). Diğer alanlarla AYNI desen: yalnızca truthy'yse SET'e eklenir.
      if (row.awards && row.awards.length) { sets.push('awards = ?'); vals.push(awards); }
      // GERÇEK BULGU (bkz. kullanıcı isteği: "Diğer profillerde de benzer bir yanlış eşleşme var mı
      // kontrol et" → "MİMARLAB" firma profili onaylı bir profile_claims kaydına sahip olduğu halde
      // claimed_by_user_id hep NULL kalmıştı): bu UPDATE dalı (mevcut statik/legacy bir kayda
      // bindirilen düzenleme) claimed_by_user_id'yi HİÇ yazmıyordu — yalnızca INSERT dalı (aşağıda,
      // gerçekten YENİ bir kayıt oluşturulduğunda) yazıyordu. Onaylı bir claimed_profile_key'li
      // düzenleme UPDATE dalına düştüğünde (statik kayıt zaten var olduğundan neredeyse HER zaman
      // buraya düşer) sahiplik hiç kaydedilmiyordu — kullanıcı onaylı olsa bile "Düzenle" butonunu/
      // doğrulanmış rozetini hiç göremiyordu. resolveClaimedByUserId burada da admin ise null döner
      // (admin'in salt küratöryel bir düzenlemesi bir başkasının GERÇEK sahipliğini SİLMESİN diye
      // yalnızca truthy'yse SET'e eklenir — admin düzenlemesinde satır dokunulmadan kalır).
      const claimedByUserId = await resolveClaimedByUserId(env, row.owner_user_id);
      if (claimedByUserId) { sets.push('claimed_by_user_id = ?'); vals.push(claimedByUserId); }
    } else {
      // bağımsız kayıt — kendi taslağının her düzenlemesi tam birebir yansır.
      sets.push('name = ?', 'loc = ?', 'cats = ?', 'yil = ?', 'website = ?', 'about = ?', 'logo_url = ?', 'cover_url = ?', 'social_links = ?', 'awards = ?');
      vals.push(row.name, row.loc || null, cats, row.yil || null, row.website || null, row.about || null, row.logo_url || null, row.cover_url || null, socialLinks, awards);
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
    const claimedByUserId = await resolveClaimedByUserId(env, row.owner_user_id);
    const insert = await insertWithSlugRetry(env, slug, row.id, (finalSlug) => env.DB.prepare(
      `INSERT INTO offices (slug, name, loc, cats, yil, website, about, logo_url, cover_url, awards, social_links, source, legacy_key, claimed_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submission', ?, ?)`
    ).bind(finalSlug, row.name, row.loc || null, cats, row.yil || null, row.website || null, row.about || null, row.logo_url || null, row.cover_url || null, awards, socialLinks, marker, claimedByUserId));
    result = await env.DB.prepare(`SELECT * FROM offices WHERE id = ?`).bind(insert.meta.last_row_id).first();
    // claimedKey doluyken buraya düşmek, o statik data.js kaydının HENÜZ canonical'a migrate
    // edilmemiş olduğu anlamına gelir (gerçek bulgu: "mükerrer kayıt" — bu yeni satır firma.html/
    // kisi.html gibi Faz 3 sayfalarında görünürken, arama.html gibi ham data.js okuyan sayfalar
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

  // kisi-ekle.html'in Firma alanına virgülle ayrılmış birden fazla firma adı girilebilir (bkz.
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
    if (match.row) officeIds.push(match.row.id);
    // candidates=[] "hiç eşleşme yok" anlamına gelir (bkz. syncOfficeFoundersFromNames'teki AYNI
    // gerekçe) — sessiz atlanan isimler artık en azından burada iz bırakır.
    else await logConflict(env, 'office_founder', officeName, `architect_submission:${row.id}`, match.ambiguous ? match.candidates : []);
  }
  const officeId = officeIds.length ? officeIds[0] : null;

  let target = claimedKey
    ? await findSyncTargetByClaim(env, 'architects', claimedKey)
    : await env.DB.prepare(`SELECT * FROM architects WHERE legacy_key = ?`).bind(marker).first();
  // SON GÜVENLİK KONTROLÜ — bkz. syncOffice'teki AYNI gerekçe/gerçek bulgu ("Kaan Çorbacı"): buraya
  // kadar hedef bulunamamış olması bu adı taşıyan BAŞKA bir canonical satırın hiç olmadığı anlamına
  // gelmez, INSERT'ten hemen önce foldTr'lı bir isim taraması ile son kez kontrol edilir.
  if (!target) {
    const nameMatch = await findOneByName(env, 'architects', row.name);
    if (nameMatch.row) target = nameMatch.row;
  }

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
      // `row.social_links.length` KOŞULU KALDIRILDI (kullanıcı isteği, 2026-09-01: "sosyal medya
      // silme sorununu da çöz"): boş dizi de yazılır, çünkü artık BOŞ DİZİ ile ALAN HİÇ YOK
      // birbirinden ayrılıyor (bkz. submissionTypes.js#nullableArrayFields — gövdede olmayan alan
      // NULL olarak saklanır ve buraya `null` gelir, dolayısıyla bu koşul onu zaten atlar).
      // Eskiden ikisi de '[]' idi; boş diziyi atlamak "hiç göndermeyen çağıranı koru" demekti ama
      // aynı zamanda kullanıcının TÜM satırları silip kaydetmesini de sessizce yok sayıyordu —
      // bağlantılar profilde kalmaya devam ediyor, silmenin hiçbir yolu olmuyordu.
      if (row.social_links) { sets.push('social_links = ?'); vals.push(socialLinks); }
      sets.push('office_id = ?'); vals.push(officeId);
      // bkz. syncOffice'teki AYNI gerçek bulgu/gerekçe — bu UPDATE dalı claimed_by_user_id'yi hiç
      // yazmıyordu, onaylı bir claim UPDATE dalına düştüğünde (statik kayıt zaten var olduğundan
      // neredeyse hep buraya düşer) sahiplik hiç kaydedilmiyordu.
      const claimedByUserId = await resolveClaimedByUserId(env, row.owner_user_id);
      if (claimedByUserId) { sets.push('claimed_by_user_id = ?'); vals.push(claimedByUserId); }
    } else {
      sets.push('name = ?', 'dob = ?', 'school = ?', 'dept = ?', 'profession = ?', 'awards = ?', 'photo_url = ?', 'about = ?', 'position = ?', 'social_links = ?', 'office_id = ?');
      vals.push(row.name, row.dob || null, row.school || null, row.dept || null, row.profession || null, awards, row.photo_url || null, row.about || null, row.position || null, socialLinks, officeId);
    }
    // "Kişi sayfasında ... görünmek istiyor musunuz?" — NULL, bu gönderinin soruyu HİÇ göndermediği
    // anlamına gelir (bkz. migrations/0081 + submissionTypes.js#normalizeSubmission), o durumda
    // canonical satırdaki mevcut tercih korunur. İKİ dala da (claimed ve bağımsız) uygulanır:
    // tercih, sahiplenilmiş bir profilde de kişinin kendi kararıdır.
    if (row.directory_listed !== undefined && row.directory_listed !== null) {
      sets.push('directory_listed = ?'); vals.push(Number(row.directory_listed) === 0 ? 0 : 1);
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
  const claimedByUserId = await resolveClaimedByUserId(env, row.owner_user_id);
  const insert = await insertWithSlugRetry(env, slug, row.id, (finalSlug) => env.DB.prepare(
    `INSERT INTO architects (slug, name, dob, school, dept, profession, position, awards, about, photo_url, social_links, office_id, directory_listed, source, legacy_key, claimed_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submission', ?, ?)`
  ).bind(finalSlug, row.name, row.dob || null, row.school || null, row.dept || null, row.profession || null, row.position || null, awards, row.about || null, row.photo_url || null, socialLinks, officeId, Number(row.directory_listed) === 0 ? 0 : 1, marker, claimedByUserId));
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
  // candidates=[] "hiç eşleşme yok" anlamına gelir (bkz. migrations/0022 tablo yorumu, gerçek
  // bulgu: eskiden yalnızca ambiguous loglanıyordu — hiç eşleşmeyen bir isim project_designers'a
  // hiç yazılmadan tamamen sessizce kaybolup gidiyordu, ne bir hata ne de bir iz bırakıyordu).
  await logConflict(env, 'project_designer', name, contextLabel, match.ambiguous ? match.candidates : []);
  return null;
}

// "Cemal Emden, Egemen Karakaya" → ["Cemal Emden", "Egemen Karakaya"] (kullanıcı isteği, 2026-09-01
// madde 6). proje-ekle.html'in Mimar kutusuyla AYNI ayırıcı/temizleme kuralı (bkz. o dosyadaki
// `p-designer` split'i) — scripts/backfill-project-photographers.js VE src/routes/architect.js aynı
// mantığı bağımsız olarak tekrarlar (bu kod tabanının bilinçli kopyalama kuralı, bkz. src/routes/
// product.js#FILE_TYPE_META yorumu); biri değişirse üçü birlikte güncellenmeli.
export function splitPhotographerNames(text) {
  return String(text || '').split(',').map(s => s.trim()).filter(Boolean);
}

async function resolveOfficeLink(env, name, contextLabel) {
  const match = await findOneByName(env, 'offices', name);
  if (match.row) return { office_id: match.row.id, architect_id: null };
  // bkz. resolveArchitectLink'teki AYNI gerekçe.
  await logConflict(env, 'project_designer', name, contextLabel, match.ambiguous ? match.candidates : []);
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

// urun-ekle.html'deki "Kullanılan Projeler" kutusunun ({slug,title} listesi) proje id'lerine
// çözülmesi — resolveProjectProductLinks'in AYNADAKİ karşılığı. Kutu autocomplete'ten seçim yaptığı
// için slug neredeyse her zaman doludur; elle yazılıp slug'sız kalan bir satır için başlıkla
// (tam eşleşme, büyük/küçük harf duyarsız) ikinci bir deneme yapılır.
async function resolveProductProjectLinks(env, projectsArray, contextLabel) {
  const projectIds = new Set();
  for (const raw of (projectsArray || [])) {
    const entry = raw && typeof raw === 'object' ? raw : { slug: String(raw || ''), title: '' };
    const slug = (entry.slug || '').trim();
    const title = (entry.title || '').trim();
    let found = null;
    if (slug) {
      found = await env.DB.prepare(
        `SELECT id FROM projects WHERE slug = ? AND deleted_at IS NULL AND hidden_at IS NULL LIMIT 1`
      ).bind(slug).first();
    }
    if (!found && title) {
      const { results } = await env.DB.prepare(
        `SELECT id, title AS name FROM projects WHERE title = ? COLLATE NOCASE AND deleted_at IS NULL AND hidden_at IS NULL LIMIT 2`
      ).bind(title).all();
      // Aynı başlıkta birden fazla proje varsa hangisinin kastedildiği belirsiz — findOneByName'in
      // AYNI davranışı: sessizce yanlış bir kaydı bağlamak yerine çakışma kaydedilip atlanır.
      // `title AS name` — logConflict adayları {id, name} olarak serileştirir (bkz. o fonksiyon).
      if (results.length === 1) found = results[0];
      else if (results.length > 1) await logConflict(env, 'product_project', title, contextLabel, results);
    }
    if (found) projectIds.add(found.id);
  }
  return [...projectIds];
}

// project_products kenarlarını TEK bir taraftan (proje ya da ürün) yeniden kurar — bkz.
// migrations/0072_product_project_links.sql. side='project' ise from_project sütunu, side='product'
// ise from_product sütunu bu tarafın GÜNCEL listesine göre sıfırlanıp yeniden yazılır; karşı tarafın
// bayrağına HİÇ dokunulmaz. Her iki bayrağı da 0'a düşen satır (artık hiçbir taraf istemiyor) silinir.
//
// Bu ayrım OLMADAN çift yönlülük imkânsızdı (kullanıcı isteği, 2026-08-31): eskiden syncProject bir
// projenin TÜM project_products satırlarını silip brands'ten yeniden kuruyordu — ürün tarafından
// eklenmiş bir kenar, o proje bir daha kaydedildiği anda sessizce yok olurdu.
async function setProjectProductLinks(env, side, ownerColumn, ownerId, otherColumn, otherIds) {
  const myFlag = side === 'project' ? 'from_project' : 'from_product';
  const otherFlag = side === 'project' ? 'from_product' : 'from_project';
  await env.DB.prepare(`UPDATE project_products SET ${myFlag} = 0 WHERE ${ownerColumn} = ?`).bind(ownerId).run();
  for (const otherId of otherIds) {
    await env.DB.prepare(
      `INSERT INTO project_products (${ownerColumn}, ${otherColumn}, ${myFlag}, ${otherFlag})
       VALUES (?, ?, 1, 0)
       ON CONFLICT(project_id, product_id) DO UPDATE SET ${myFlag} = 1`
    ).bind(ownerId, otherId).run();
  }
  await env.DB.prepare(
    `DELETE FROM project_products WHERE ${ownerColumn} = ? AND from_project = 0 AND from_product = 0`
  ).bind(ownerId).run();
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
  const awards = JSON.stringify(row.awards || []);
  // Görsel üzerindeki ürün işaretçileri (bkz. migrations/0076_project_image_hotspots.sql). Yalnızca
  // images ile BİRLİKTE yazılır (aşağıdaki UPDATE dalında images = ? ile aynı koşulda) — bunun iki
  // ayrı sebebi var: (1) işaretçiler görsel URL'sine göre anahtarlı, görsel listesi güncellenmeden
  // anahtarlar anlamsız kalırdı; (2) images'i hiç göndermeyen çağıranlar (ör. admin panelinin kısa
  // düzenleme formu, AI akışı) mevcut işaretçileri sessizce SİLMEMELİ — o çağrılarda images de
  // korunuyor, ikisi birlikte dokunulmadan kalır.
  const imageHotspots = row.imageHotspots && Object.keys(row.imageHotspots).length
    ? JSON.stringify(row.imageHotspots) : null;
  // publishDate: yalnızca admin tarafından yazılabilir (bkz. src/routes/submissions.js'teki AYNI
  // rol kontrolü, kullanıcı isteği: "yalnızca admin proje ekle/düzenle sayfasından proje
  // gönderilerinin yayınlanma tarihlerini değiştirebilsin"). "YYYY-MM-DD" tarih girişi, created_at
  // ile (datetime('now') → "YYYY-MM-DD HH:MM:SS") karşılaştırılabilir olsun diye gün başına
  // normalize edilir — bkz. src/lib/projectPool.js/src/routes/project.js#fetchProjectPageRows'daki
  // COALESCE(publish_date, created_at) DESC sıralaması. Boş/eksikse NULL yazılır (admin tarihi
  // temizlerse proje created_at'e göre varsayılan sıraya geri döner).
  const publishDate = row.publishDate ? `${row.publishDate} 00:00:00` : null;

  let projectId;
  if (target) {
    // bkz. src/routes/project.js (eski)#handleProjectDetailRoute overlay kuralları — title/category/
    // type/discipline/location/date/period/description/photoCredit koşulsuz, designer/images boşsa
    // eskisi korunur.
    //
    // date_bucket HER ZAMAN row.date'ten dateBucketFor() ile YENİDEN türetilir, row.dateBucket
    // (submission satırında saklanan) asla doğrudan yazılmaz — eski (ünlü uyumsuz, hep "'lar") bir
    // dateBucketFor sürümüyle oluşmuş satırlar bu satırda dokunulmadan sonsuza dek yanlış kalırdı,
    // bu da aynı on yıl için "2000'lar"/"2000'ler" gibi iki ayrı filtre seçeneğine yol açıyordu
    // (bkz. kullanıcı bulgusu). Tek doğru kaynak burada zorlanınca her düzenleme/onay eski satırı
    // kendiliğinden düzeltir, yeni bir yanlış-ek satırı da hiçbir çağrı yolu ÜRETEMEZ.
    const sets = [
      'title = ?', 'category = ?', 'type = ?', 'discipline = ?', 'location = ?', 'location_detail = ?',
      'project_date = ?', 'date_bucket = ?', 'period = ?', 'photo_credit_text = ?', 'photo_credit_url = ?',
      'description = ?', 'build_status = ?', 'concept_category = ?', 'awards = ?', 'publish_date = ?', 'lat = ?', 'lng = ?', 'hidden_at = NULL', `updated_at = datetime('now')`,
    ];
    const vals = [
      row.title, category, type, discipline, row.location || null, row.locationDetail || null,
      row.date || null, dateBucketFor(row.date) || null, period, row.photoCreditText || '', row.photoCreditUrl || '',
      row.description || null, row.build_status === 'concept' ? 'concept' : 'built', row.conceptCategory || null, awards, publishDate,
      row.lat ?? null, row.lng ?? null,
    ];
    if (row.images && row.images.length) {
      sets.splice(-1, 0, 'images = ?');
      vals.push(images);
      // bkz. yukarısı — işaretçiler görsel listesiyle AYNI koşulda yazılır. Kullanıcı son
      // işaretçiyi de silmişse burada NULL yazılır (aksi halde silinen bir işaretçi geri gelirdi).
      sets.splice(-1, 0, 'image_hotspots = ?');
      vals.push(imageHotspots);
    }
    // Başlık değiştiyse slug da değişir (bkz. kullanıcı isteği: "ismi değişirse URL'si de değişmeli"
    // — mimar/firma yeniden adlandırmasında zaten var olan davranışın proje karşılığı, bkz.
    // src/lib/officeFounderCascade.js#renameOfficeEverywhere/renameArchitectEverywhere). Karşılaştırma
    // İSİMLE (target.title) yapılır, mevcut slug'la DEĞİL — aksi halde daha önce bir çakışma yüzünden
    // "-2" gibi bir sonek almış slug'lar, başlık hiç değişmese bile her kayıtta yeniden adlandırma
    // gibi görünürdü.
    let newSlug = target.slug;
    if (row.title && row.title !== target.title) {
      newSlug = await freshSlugFor(env, 'projects', target.id, row.title);
      sets.splice(-1, 0, 'slug = ?');
      vals.push(newSlug);
    }
    await env.DB.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, target.id).run();
    projectId = target.id;
    if (newSlug !== target.slug) await renameProjectSlugEverywhere(env, target.slug, newSlug);
  } else {
    let slug = row.slug;
    const clash = await env.DB.prepare(`SELECT id FROM projects WHERE slug = ?`).bind(slug).first();
    if (clash) slug = `${slug}-${row.id}`;
    const insert = await insertWithSlugRetry(env, slug, row.id, (finalSlug) => env.DB.prepare(
      `INSERT INTO projects (slug, title, category, type, discipline, location, location_detail, project_date, date_bucket, period, description, images, image_hotspots, photo_credit_text, photo_credit_url, source_url, ai_generated, build_status, concept_category, awards, publish_date, lat, lng, source, legacy_key, claimed_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submission', ?, ?)`
    ).bind(
      finalSlug, row.title, category, type, discipline, row.location || null, row.locationDetail || null,
      row.date || null, dateBucketFor(row.date) || null, period, row.description || null, images, imageHotspots,
      row.photoCreditText || null, row.photoCreditUrl || null, row.source_url || null, row.ai_generated ? 1 : 0,
      row.build_status === 'concept' ? 'concept' : 'built', row.conceptCategory || null, awards, publishDate,
      row.lat ?? null, row.lng ?? null,
      marker, row.owner_user_id
    ));
    projectId = insert.meta.last_row_id;
    // bkz. syncOffice'teki AYNI "claimedKey'li ama hedef bulunamadı" durumu ve gerekçesi.
    if (claimedSlug) await blacklistLegacyKey(env, row.owner_user_id, 'projects', claimedSlug);
  }

  // Mimar/Firma artık ayrı alanlar (bkz. yukarı) — biri boş diğeri dolu gönderilebileceğinden (ör.
  // yalnızca Firma girildi) eski satırları temizleme tetiği İKİSİNDEN BİRİNİN dolu olmasına bakar,
  // yalnızca row.designer'a değil (aksi halde salt-firma bir düzenlemede eski project_designers
  // satırları hiç temizlenmezdi). audit bulgusu (denetim raporu, 2026-08-21): DELETE ile yeniden-
  // INSERT'ler önceden ayrı sıralı .run() çağrılarıydı — aralarındaki kısa pencerede eşzamanlı bir
  // okuma (proje/mimar/ofis/seo/comments detay sayfaları, hepsi project_designers'ı okur) projeyi
  // geçici olarak "tasarımcısız" görebiliyordu. İsim→id çözümleme (resolveArchitectLink/
  // resolveOfficeLink, olası migration_name_conflicts kaydı dahil) salt-okunur/bağımsız olduğundan
  // batch DIŞINDA önce yapılır; DELETE + gerçek INSERT'ler ise TEK bir env.DB.batch() ile atomik
  // yazılır — `target` yalnızca UPDATE dalında (yukarı) doluysa DELETE'e gerek vardır, yeni bir
  // projede (INSERT dalı) silinecek eski satır yoktur.
  if ((row.designer && row.designer.length) || (row.office && row.office.length)) {
    const links = [];
    for (const name of (row.designer || [])) {
      const resolved = await resolveArchitectLink(env, name, `project_submission:${row.id}`);
      if (resolved) links.push(resolved);
    }
    for (const name of (row.office || [])) {
      const resolved = await resolveOfficeLink(env, name, `project_submission:${row.id}`);
      if (resolved) links.push(resolved);
    }
    const statements = [];
    if (target) statements.push(env.DB.prepare(`DELETE FROM project_designers WHERE project_id = ?`).bind(projectId));
    for (const link of links) {
      statements.push(env.DB.prepare(`INSERT INTO project_designers (project_id, architect_id, office_id) VALUES (?, ?, ?)`).bind(projectId, link.architect_id, link.office_id));
    }
    if (statements.length) await env.DB.batch(statements);
  }

  // Fotoğrafçı bağlantıları (kullanıcı isteği, 2026-09-01 madde 6: "fotoğrafçılar kutucuğu da mimar
  // kutucuğuyla aynı mantıkta çalışsın") — photoCreditText artık Mimar kutusu gibi VİRGÜLLE AYRILMIŞ
  // birden çok isim taşıyabilir; her isim architects tablosunda aranır ve eşleşenler için
  // project_photographers kenarı kurulur (bkz. migrations/0080_project_photographers.sql).
  // Yukarıdaki project_designers bloğuyla AYNI desen: çözümleme batch DIŞINDA (salt-okunur),
  // DELETE+INSERT tek bir atomik batch'te. Eşleşmeyen isimler sessizce metin olarak kalır —
  // photo_credit_text zaten yazıldı, künye onu göstermeye devam eder (bkz. project-meta.js).
  // logConflict BİLEREK çağrılmaz: fotoğrafçıların büyük çoğunluğunun sitede profili yok ve bu
  // normal bir durum, migration_name_conflicts'i gürültüye boğmamalı.
  {
    const photographerIds = [];
    for (const name of splitPhotographerNames(row.photoCreditText)) {
      const match = await findOneByName(env, 'architects', name);
      if (match.row) photographerIds.push(match.row.id);
    }
    const statements = [env.DB.prepare(`DELETE FROM project_photographers WHERE project_id = ?`).bind(projectId)];
    for (const id of [...new Set(photographerIds)]) {
      statements.push(env.DB.prepare(`INSERT OR IGNORE INTO project_photographers (project_id, architect_id) VALUES (?, ?)`).bind(projectId, id));
    }
    await env.DB.batch(statements);
  }

  // Eskiden bu blok yalnızca `row.brands` DOLUYSA çalışıyordu (ve o projenin TÜM project_products
  // satırlarını silip yeniden kuruyordu) — artık her onayda koşulsuz çalışır ama YALNIZCA from_project
  // bayrağını yönetir (bkz. setProjectProductLinks). İki kazanım: (1) kutudaki son chip'in silinmesi
  // artık gerçekten kenarı da kaldırır, (2) ürün tarafından (urun-ekle.html'in "Kullanılan Projeler"
  // kutusundan) kurulmuş kenarlar bu projenin her kaydedilişinde silinmez.
  {
    const productIds = await resolveProjectProductLinks(env, row.brands, `project_submission:${row.id}`);
    await setProjectProductLinks(env, 'project', 'project_id', projectId, 'product_id', productIds);
  }
  return env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(projectId).first();
}

async function syncProduct(env, row, kind) {
  // products/materials'ta claim sistemi yok (bkz. schema.sql yorumu) — her onaylı satırın kendi
  // canonical karşılığı idempotent bulunmalı. GERÇEK BULGU (kullanıcı isteği: "Ürün sayfalarındaki
  // ürünlerin URL'lerini ürün adları olarak düzgünce düzelt"): bu idempotent arama önceden
  // slug='m-<submissionId>' üzerinden yapılıyordu — slug artık aşağıda title/marka'dan üretildiğinden
  // (architects/offices/projects'teki AYNI desen) bu arama artık HER ZAMAN legacy_key='submission:<id>'
  // üzerinden yapılır (bu değer her onaylı senkronda zaten koşulsuz yazılıyor, aşağıya bkz.) —
  // idempotency artık slug'ın biçiminden tamamen bağımsız.
  const legacyKey = submissionMarker(row.id);
  const existing = await env.DB.prepare(`SELECT * FROM products WHERE legacy_key = ?`).bind(legacyKey).first();
  const images = JSON.stringify(row.images || []);
  const specs = JSON.stringify(row.specs || []);
  const files = JSON.stringify(row.files || []); // bkz. migrations/0071_product_files.sql

  let brandOfficeId = null;
  if (row.brand) {
    const match = await findOneByName(env, 'offices', row.brand);
    if (match.ambiguous) await logConflict(env, 'product_brand', row.brand, `${kind}_submission:${row.id}`, match.candidates);
    brandOfficeId = match.row ? match.row.id : null;
  }

  // "submission:<id>" işareti — src/routes/product.js#shapeProductItem'ın isSubmissionMarker
  // kontrolü (ve dolayısıyla item.submissionId, editSubmissionBtnHtml/owner Sil-Arşivle akışının
  // TAMAMI, bkz. js/components/product-modal.js#mountEditAndAdminButtons) bu satıra bakar — ayrıca
  // artık yukarıdaki idempotent aramanın da tek kaynağı.

  let productId;
  if (existing) {
    // hidden_at temizliği — bkz. syncOffice'teki AYNI gerekçe (sahibi onaylı bir ürünü tekrar
    // düzenleyip admin onayladığında görünürlük geri gelmeliydi, gelmiyordu). slug'a BİLEREK
    // dokunulmaz — bkz. src/routes/legacyContent.js#handleAdminProductEdit'teki AYNI gerekçe
    // (products/materials hiçbir rename cascade'i desteklemiyor, başlık değişse bile URL sabit kalır).
    await env.DB.prepare(
      `UPDATE products SET title = ?, brand_office_id = ?, brand_name_raw = ?, website = ?, category = ?, description = ?, images = ?, specs = ?, files = ?, designer = ?, year = ?, legacy_key = ?, hidden_at = NULL, updated_at = datetime('now') WHERE id = ?`
    ).bind(row.title, brandOfficeId, row.brand || null, row.website || null, row.category || null, row.description || null, images, specs, files, row.designer || null, row.year || null, legacyKey, existing.id).run();
    productId = existing.id;
  } else {
    // architects/offices/projects'teki AYNI desen (bkz. syncArchitect/syncOffice) — yeni bir
    // ürün/malzeme kaydı artık başlık+marka'dan türetilmiş okunabilir bir slug alır, yalnızca
    // slugify boş dönerse (ör. başlık tamamen özel karakterlerden oluşuyorsa) eski "m-<id>" biçimine
    // düşülür.
    const { slugify } = await import('./slugify.js');
    let slug = slugify(`${row.title}-${row.brand || ''}`) || `m-${row.id}`;
    const clash = await env.DB.prepare(`SELECT id FROM products WHERE slug = ?`).bind(slug).first();
    if (clash) slug = `${slug}-${row.id}`;
    const insert = await insertWithSlugRetry(env, slug, row.id, (finalSlug) => env.DB.prepare(
      `INSERT INTO products (slug, kind, title, brand_office_id, brand_name_raw, website, category, description, images, specs, files, designer, year, source_url, ai_generated, source, legacy_key, claimed_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submission', ?, ?)`
    ).bind(finalSlug, kind, row.title, brandOfficeId, row.brand || null, row.website || null, row.category || null, row.description || null, images, specs, files, row.designer || null, row.year || null, row.source_url || null, row.ai_generated ? 1 : 0, legacyKey, row.owner_user_id));
    productId = insert.meta.last_row_id;
  }
  // "Kullanılan Projeler" kutusu — syncProject'teki AYNI desen, yalnızca from_product bayrağını
  // yönetir (bkz. setProjectProductLinks, kullanıcı isteği 2026-08-31: ürün popup'ına eklenen proje,
  // o projenin popup'ındaki "Kullanılan Ürünler"de de görünsün).
  {
    const projectIds = await resolveProductProjectLinks(env, row.projects, `${kind}_submission:${row.id}`);
    await setProjectProductLinks(env, 'product', 'product_id', productId, 'project_id', projectIds);
  }
  return env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(productId).first();
}

// row: parseSubmissionRow(typeKey, rawRow) ile ZATEN parse edilmiş (JSON alanları diziye çevrilmiş)
// olmalı — bkz. src/lib/submissionTypes.js#parseSubmissionRow. jobs/news canonical modelde yok, no-op.
export async function syncApprovedSubmissionToCanonical(env, typeKey, row) {
  if (typeKey === 'architects') return syncArchitect(env, row);
  if (typeKey === 'offices') return syncOffice(env, row);
  if (typeKey === 'projects') return syncProject(env, row);
  if (typeKey === 'products') return syncProduct(env, row, 'product');
  if (typeKey === 'materials') return syncProduct(env, row, 'material');
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
    return;
  }
  if (typeKey === 'products' || typeKey === 'materials') {
    await env.DB.prepare(`UPDATE products SET hidden_at = datetime('now') WHERE slug = ?`).bind(`m-${row.id}`).run();
  }
}

// Bir <tip>_submissions satırı KALICI olarak silindiğinde (bkz. src/routes/admin.js#handleSubmissionsAdmin
// DELETE) eşleşen canonical satırı da bulup hard-delete eder (bkz. hardDeleteCanonicalRow) — aksi
// halde canonical satır (bu senkron mekanizmasıyla zaten oluşmuş olabilir) sitede "hayalet" olarak
// görünmeye devam ederdi.
//
// GERÇEK BULGU (kullanıcı isteği: "Admin bir ... mimarı veya firmayı canlı siteden sildiği zaman
// ... D1 sisteminde de içerik kalıcı olarak silinsin"): claimed_slug/claimed_profile_key dolu
// (statik kökenli, sahiplenilmiş) satırlarda burası önceden no-op'tu — "legacyContent.js'in Arşiv
// sekmesi zaten yönetiyor" varsayımıyla. Ama admin.html'in "İçerikler" sekmesindeki Yayından Kaldır
// butonu da (görünüşte AYNI silme işlemi) claimed satırlar için buraya düşüyor: taslak satır +
// yorum/puan/rozet/talep geçmişi kalıcı silinirken canonical satıra (ve dolayısıyla canlı sayfaya)
// hiç dokunulmuyor, üstelik taslağın kendi R2 görselleri (canonical satırın hâlâ işaret ettiği AYNI
// URL'ler) siliniyordu — sonuç: kayıt canlıda kırık görsellerle kalmaya devam ediyordu.
// runProjectAction/runContentAction (src/routes/legacyContent.js) claimed satırlarda AYNI şekilde
// davranır (claimed key ile canonical satırı bulup hardDeleteCanonicalRow çağırır) — burası da artık
// o desenle eşleşiyor.
export async function markCanonicalDeletedForSubmission(env, typeKey, row, userId) {
  if (!row) return;
  const marker = submissionMarker(row.id);
  const claimedKey = typeKey === 'projects' ? row.claimed_slug : row.claimed_profile_key;
  const table = { architects: 'architects', offices: 'offices', projects: 'projects' }[typeKey];
  if (table) {
    const canonRow = claimedKey
      ? await findCanonicalRowByNaturalKey(env, typeKey, claimedKey)
      : await env.DB.prepare(`SELECT * FROM ${table} WHERE legacy_key = ?`).bind(marker).first();
    if (canonRow) await hardDeleteCanonicalRow(env, typeKey, canonRow, userId);
    else if (claimedKey) await blacklistLegacyKey(env, userId, typeKey, claimedKey);
    return;
  }
  // products/materials
  const canonRow = await env.DB.prepare(`SELECT * FROM products WHERE slug = ?`).bind(`m-${row.id}`).first();
  if (canonRow) await hardDeleteCanonicalRow(env, typeKey, canonRow, userId);
}
