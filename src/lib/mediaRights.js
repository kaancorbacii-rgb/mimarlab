// TELİF/YAYIN HAKKI KİLİTLEME — TEK DOĞRULUK KAYNAĞI (kullanıcı isteği, 2026-09-09).
//
// Bu dosya üç soruyu yanıtlar ve bu üç sorunun BAŞKA hiçbir yerde ayrı bir cevabı olmamalıdır:
//   (1) Bir görselin ORİJİNALİ herkese açık servis edilebilir mi?      -> isOriginalPublic
//   (2) İstemciye hangi URL verilir?                                    -> applyProjectImageRights
//   (3) Doğrudan bir /media//projects/ isteği geçirilmeli mi?           -> lookupGateDecision
//
// TASARIM KARARI — KİLİTLİ MEDYA AYRI BİR UCA TAŞINIR, ONAYLI MEDYA MEVCUT YOLUNDA KALIR.
// Sitedeki her görseli /api/media/:id üzerinden servis etmek teknik olarak mümkündü ama iki gerçek
// bedeli vardı: (a) bugün `immutable, max-age=31536000` ile bir yıl önbelleklenen onaylı görseller
// hak durumu değişebilen dinamik bir uca taşınır, yani her sayfa görüntülemesinde yeniden
// doğrulanırdı; (b) her görsel isteği Worker + D1'e bağımlı hâle gelirdi. Onaylı içerik zaten
// herkese AÇIK olduğundan onu gizlemenin bir güvenlik faydası da yok. Bu yüzden:
//   onaylı  -> mevcut /media/... veya /projects/... yolu, mevcut önbellek sözleşmesi (DEĞİŞMEDİ)
//   kilitli -> YALNIZCA /api/media/<opak id>; orijinal yol/anahtar istemciye HİÇ gitmez ve o yol
//              doğrudan istendiğinde kapı 404 döner.
//
// GÜVENLİ SÜRÜM NEDEN "w400 TÜREVİ": bu projede istek anında görsel dönüşümü YAPILAMAZ — ne ücretli
// Cloudflare Image Transformations (env.IMAGES / /cdn-cgi/image; kalıcı olarak kapalı, bkz.
// wrangler.jsonc'deki uzun gerekçe) ne de Workers runtime'ında bir kodek/canvas vardır. Elimizdeki
// TEK önceden üretilmiş küçük kopya, mevcut responsive türev merdiveninin en küçük basamağıdır
// (bkz. image-cdn.js / src/lib/imageDerivative.js). Kilitli içerikte YALNIZCA o baytlar servis
// edilir; türev yoksa ORİJİNALE GERİ DÜŞÜLMEZ (handleMediaRoute'un normal güvenlik ağının TAM
// TERSİ — orada amaç görselin kırılmaması, burada amaç orijinalin sızmamasıdır) ve yerine bir
// yer tutucu döner. Görsel bulanıklığı istemci tarafında uygulanır; bu bir UX katmanıdır,
// güvenlik sınırı DEĞİLDİR — güvenlik sınırı, orijinal baytların sunucuda kesilmesidir.

// Beyan metninin sürümü — metin DEĞİŞİRSE bu sabit de artırılmalı. media_rights_audit'e
// (declaration_version) ve media_rights.rights_declaration_version'a yazılır; eski beyanların
// hangi metne verildiği geriye dönük olarak bilinebilsin diye.
export const RIGHTS_DECLARATION_VERSION = '2026-09-09.1';
export const RIGHTS_DECLARATION_TEXT = 'Yüklediğim tüm görsellerin yayın haklarına sahip olduğumu veya ilgili eser sahiplerinden (mimari fotoğrafçı, işveren vb.) gerekli izinleri aldığımı; 3. şahısların telif haklarının ihlali durumunda tüm hukuki ve mali sorumluluğun tarafıma ait olduğunu kabul ederim.';

export const RIGHTS_STATUSES = ['unknown', 'pending', 'approved', 'disputed', 'removed'];
export const CONTENT_ORIGINS = ['platform_curated', 'owner_submitted', 'photographer_submitted', 'user_submitted'];

// Kullanıcı isteği (2026-09-09, ikinci tur): kilit artık DÖRT varlık tipini de kapsıyor — proje,
// ürün, kişi ve firma/marka. media_rights.entity_type baştan jenerik tasarlandığı için ŞEMA
// DEĞİŞMEDİ (bkz. migrations/0106'daki CHECK kısıtı); eklenen tek şey bu tiplerin kaydı ve okuma
// yollarındaki dönüşüm.
export const REGISTERED_ENTITY_TYPES = ['project', 'product', 'architect', 'office'];

// Her tipin hangi kolonlarında medya durduğu — kayıt (registrar) ve backfill TEK yerden okur.
//   arrayFields : JSON dizi kolonları (çok görselli galeri)
//   singleFields: tek bir URL taşıyan kolonlar (avatar/logo/kapak)
export const MEDIA_FIELDS_BY_TYPE = {
  project:   { table: 'projects',   arrayFields: ['images'], singleFields: [] },
  product:   { table: 'products',   arrayFields: ['images'], singleFields: [] },
  architect: { table: 'architects', arrayFields: ['portfolio'], singleFields: ['photo_url'] },
  office:    { table: 'offices',    arrayFields: [], singleFields: ['logo_url', 'cover_url'] },
};

// Güvenli (kilitli) sürümün genişliği — image-cdn.js#DERIVATIVE_WIDTHS'in EN KÜÇÜK basamağıyla
// BİREBİR aynı olmalı, aksi halde var olmayan bir türev istenir ve her kilitli görsel yer tutucuya
// düşer.
export const SAFE_DERIVATIVE_WIDTH = 400;

const SITE_HOSTS = new Set(['mimarlab.com', 'www.mimarlab.com']);

// Kilitli medyanın istemciye verilen TEK adresi. Önek, hem sunucu (imageDerivative.js) hem istemci
// (image-cdn.js) tarafındaki türev üreticilerinin bu URL'lere DOKUNMAMASI için de kullanılır —
// "/media/_derived/w400/s/api/media/<id>" gibi anlamsız bir yol üretilmemeli.
export const SAFE_MEDIA_PREFIX = '/api/media/';

// Kayıtsız (media_rights satırı bulunamayan) bir proje görselinin güvenli adresi. VERİ KAYMASINA
// KARŞI EMNİYET SUPABI: registerProjectMedia her canonical yazımda çalıştığı için normalde her
// görselin satırı vardır, ama bir satır eksik kalırsa görseli yükten düşürüp galeriyi delik
// bırakmak yerine bu biçimle yine GÜVENLİ sürüm servis edilir (orijinal ASLA — bu biçimde hiçbir
// zaman "izin verildi" kararı üretilemez, bkz. handleSafeMediaRoute).
// GERÇEK BULGU (production kontrolü, 2026-09-09): projects.id NEGATİF olabilir — canlıda 48 aktif
// projenin id'si negatif (min -51; eski import migration'larından kalma). `^p(\d+)-` deseni
// "p-51-0" biçimini HİÇ eşleştirmiyordu, yani o projelerin kayıtsız bir görseli emniyet yolundan
// güvenli sürümü alamayıp 404 alırdı. `-?` ile işaret kabul edilir; ayrıştırma yine tekdüzedir
// çünkü index HER ZAMAN negatif olmayan bir tam sayıdır ve SON tire ayraçtır.
// Tip öneki: p=project, r=product, a=architect, o=office. Tek harf, ardından (negatif olabilen)
// varlık id'si ve görselin dizideki sırası.
const FALLBACK_TYPE_CHAR = { project: 'p', product: 'r', architect: 'a', office: 'o' };
const FALLBACK_CHAR_TYPE = { p: 'project', r: 'product', a: 'architect', o: 'office' };
const FALLBACK_ID_RE = /^([proa])(-?\d+)-(\d+)$/;
export function fallbackSafeMediaId(entityId, index, entityType) {
  return `${FALLBACK_TYPE_CHAR[entityType] || 'p'}${entityId}-${index}`;
}
export function parseFallbackMediaId(id) {
  const m = FALLBACK_ID_RE.exec(id || '');
  if (!m) return null;
  // projectId adı geriye dönük uyumluluk için korunur (mevcut çağıranlar okuyor).
  return { entityType: FALLBACK_CHAR_TYPE[m[1]], entityId: Number(m[2]), projectId: Number(m[2]), index: Number(m[3]) };
}

// ---------------------------------------------------------------------------------------------
// YOL NORMALİZASYONU
// ---------------------------------------------------------------------------------------------
// projects.images canlıda MUTLAK ("https://mimarlab.com/media/x.webp"), KÖK-GÖRELİ ("/media/x.webp")
// ve ÖNEKSİZ ("projects/x.webp") biçimleri KARIŞIK taşır (bkz. image-cdn.js#toLocalPath'teki aynı
// gerçek bulgu). Kapı ve türev anahtarı tek bir kanonik biçime muhtaç olduğundan hepsi burada
// "/..." kök-göreli yola indirgenir. Harici host'lar null döner: o baytlar bizim origin'imizde
// değil, kapı onlar için hiçbir şey yapamaz (ve yapmamalı).
export function normalizeMediaPath(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return null;
  let path = raw;
  if (/^(https?:)?\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
      if (!SITE_HOSTS.has(parsed.hostname)) return null;
      path = parsed.pathname;
    } catch { return null; }
  }
  if (path.startsWith(SAFE_MEDIA_PREFIX)) return null;
  if (!path.startsWith('/')) path = `/${path}`;
  // Nokta segmentlerini (../) URL'in KENDİ normalizasyonuyla çöz — ham string üzerinde ".." aramak
  // çift kodlanmış varyantları kaçırır (bkz. src/routes/upload.js#DERIVED_STATIC_IMAGE_RE'deki
  // aynı gerekçe).
  try { return new URL(path, 'https://mimarlab.com').pathname; } catch { return null; }
}

// Güvenli sürümün R2 anahtarı. Kaynak R2'de ise "_derived/w400/r2/<anahtar>", statik varlık ise
// "_derived/w400/s/<yol>" — src/lib/imageDerivative.js#derivedImageUrl ile BİREBİR aynı biçim.
export function safeDerivativeKeyFor(localPath, width) {
  if (!localPath) return null;
  const clean = localPath.replace(/^\/+/, '');
  if (!clean) return null;
  const w = width || SAFE_DERIVATIVE_WIDTH;
  if (clean.startsWith('media/')) return `_derived/w${w}/r2/${clean.slice('media/'.length)}`;
  return `_derived/w${w}/s/${clean}`;
}

// Kilitli içerikte denenecek türev genişlikleri, KÜÇÜKTEN BÜYÜĞE.
//
// NEDEN İKİ BASAMAK: canlı ölçüm (2026-09-09, 36 görsellik rastgele örnek) w400 türev kapsamını
// ~%94 buldu — yani her 20 kilitli görselden biri yalnızca w400 denenirse yer tutucuya düşerdi
// (~1.400 görsel). w800 ikinci basamak olarak eklendi: hâlâ ORİJİNALDEN çok küçük gerçek bir
// indirgeme (sitedeki orijinaller çoğunlukla 1600-2400 px) ve yer tutucudan kıyaslanamayacak kadar
// iyi bir kullanıcı deneyimi. w1600 BİLEREK yok — o, birçok görselde orijinalin kendisine yakın
// olurdu ve kilidi anlamsızlaştırırdı.
//
// Kapsam boşluğu kalıcı değildir: eksik türevler mevcut üretim hattıyla (scripts/
// generate-image-derivatives.py, scripts/drain-derivative-queue.py) kapatılabilir; bu merdiven
// o iş yapılana kadar da sistemin kırılmadan çalışmasını sağlar.
export const SAFE_DERIVATIVE_WIDTH_LADDER = [400, 800];

// Orijinalin R2 anahtarı (kaynak R2 ise) — statik varlıklar için null döner, onlar env.ASSETS'ten
// okunur.
export function originalR2KeyFor(localPath) {
  if (!localPath) return null;
  const clean = localPath.replace(/^\/+/, '');
  return clean.startsWith('media/') ? clean.slice('media/'.length) : null;
}

// ---------------------------------------------------------------------------------------------
// KARAR FONKSİYONLARI
// ---------------------------------------------------------------------------------------------
// Orijinal tam çözünürlüklü dosya herkese açık mı? ÜÇ koşul da gerekli — proje düzeyi onay tek
// başına yetmez (bkz. migrations/0106 başlığındaki gerekçe), görsel düzeyi onay da tek başına
// yetmez (yayın hakkı beyanı proje sahibinden gelir).
export function isOriginalPublic(row, projectApproved) {
  if (!row) return false;
  return row.rights_status === 'approved' && Number(row.public_original_allowed) === 1 && !!projectApproved;
}

// GÖRSEL BAZINDA SIRALAMA GRUBU (kullanıcı isteği madde 13):
//   0 approved + orijinal erişimi açık
//   1 güvenli gösterilebilir ama orijinal erişimi yok (approved ama izin yok / proje onaysız)
//   2 unknown / pending
//   3 disputed   ('removed' hiç döndürülmez — yükten tamamen düşürülür)
export function mediaBucketOf(row, projectApproved) {
  if (!row) return 2;
  if (row.rights_status === 'removed') return 4;
  if (row.rights_status === 'disputed') return 3;
  if (row.rights_status === 'approved') return isOriginalPublic(row, projectApproved) ? 0 : 1;
  return 2;
}

// ---------------------------------------------------------------------------------------------
// YÜK SERİLEŞTİRME — İSTEMCİYE GİDEN TEK NOKTA
// ---------------------------------------------------------------------------------------------
// item.images'i (a) hak grubuna göre yeniden sıralar, (b) kilitli olanların URL'sini opak güvenli
// uçla DEĞİŞTİRİR, (c) 'removed' olanları tamamen çıkarır, (d) imageHotspots anahtarlarını yeni
// URL'lere taşır (aksi halde işaretçiler sessizce kaybolurdu — harita görsel URL'siyle anahtarlı).
//
// GRUP İÇİ SIRA KORUNUR: sıralama, orijinal dizideki index'e göre STABİL — mevcut editoryal sıra
// (proje-ekle.html'de sürükle-bırakla belirlenen görsel sırası) bucket'ın İÇİNDE aynen kalır.
export function applyProjectImageRights(item, entityId, rows, projectApproved, entityType) {
  const images = Array.isArray(item.images) ? item.images : [];
  if (!images.length) return item;

  const byUrl = new Map();
  const byPath = new Map();
  for (const row of rows || []) {
    if (!byUrl.has(row.media_url)) byUrl.set(row.media_url, row);
    if (row.media_path && !byPath.has(row.media_path)) byPath.set(row.media_path, row);
  }

  const entries = images.map((url, i) => {
    const row = byUrl.get(url) || byPath.get(normalizeMediaPath(url)) || null;
    return { url, i, row, bucket: mediaBucketOf(row, projectApproved) };
  });

  const kept = entries.filter(e => e.bucket !== 4);
  kept.sort((a, b) => (a.bucket - b.bucket) || (a.i - b.i));

  const out = [];
  const rights = {};
  const urlMap = new Map();
  for (const e of kept) {
    if (e.bucket === 0) { out.push(e.url); urlMap.set(e.url, e.url); continue; }
    const safe = e.row ? `${SAFE_MEDIA_PREFIX}${e.row.id}` : `${SAFE_MEDIA_PREFIX}${fallbackSafeMediaId(entityId, e.i, entityType)}`;
    out.push(safe);
    urlMap.set(e.url, safe);
    rights[safe] = { locked: true, status: e.row ? e.row.rights_status : 'unknown' };
  }

  item.images = out;
  // Yalnızca gerçekten kilitli görsel varsa alan yüke eklenir (serializePublicEntity boş nesneyi
  // zaten atar, ama liste yükünde binlerce karta boş bir alan iliştirmemek için burada da kontrol).
  if (Object.keys(rights).length) item.imageRights = rights;
  else delete item.imageRights;

  if (item.imageHotspots && typeof item.imageHotspots === 'object') {
    const remapped = {};
    for (const [url, spots] of Object.entries(item.imageHotspots)) {
      const next = urlMap.get(url);
      if (next) remapped[next] = spots;
    }
    if (Object.keys(remapped).length) item.imageHotspots = remapped;
    else delete item.imageHotspots;
  }
  return item;
}

// ---------------------------------------------------------------------------------------------
// D1 OKUMALARI
// ---------------------------------------------------------------------------------------------
const MEDIA_COLUMNS = `id, entity_type, entity_id, media_url, media_path, sort_order, rights_status,
  public_original_allowed, photographer, copyright_holder, source_url, rights_verified_at,
  rights_verified_by, rights_declaration_version, content_origin`;

export async function fetchProjectMediaRights(env, projectId) {
  return fetchEntityMediaRights(env, 'project', projectId);
}

export async function fetchEntityMediaRights(env, entityType, entityId) {
  if (!entityId) return [];
  const { results } = await env.DB.prepare(
    `SELECT ${MEDIA_COLUMNS} FROM media_rights WHERE entity_type = ? AND entity_id = ? ORDER BY sort_order ASC`
  ).bind(entityType, entityId).all();
  return results || [];
}

// Bir varlık tipinin TÜM medya satırları, entity_id'ye göre gruplanmış — havuz yolları için
// (bkz. fetchAllProjectMediaRights'taki aynı maliyet gerekçesi: havuzlar KV'de 30 dk önbellekli).
export async function fetchAllEntityMediaRights(env, entityType) {
  const { results } = await env.DB.prepare(
    `SELECT ${MEDIA_COLUMNS} FROM media_rights WHERE entity_type = ? ORDER BY entity_id ASC, sort_order ASC`
  ).bind(entityType).all();
  const byEntity = new Map();
  for (const row of results || []) {
    let list = byEntity.get(row.entity_id);
    if (!list) { list = []; byEntity.set(row.entity_id, list); }
    list.push(row);
  }
  return byEntity;
}

// HAVUZ YOLU (fetchActiveProjectPool) için: TEK sorguda tüm proje medyası.
//
// NEDEN `IN (...)` DEĞİL: havuz ~1.200 proje taşır; D1'in bağlı parametre sınırı bunu tek ifadede
// almaya izin vermez, parçalamak da onlarca sorgu demek olurdu. Bu tablo satır başına birkaç yüz
// bayt ve toplamda proje görseli sayısı kadardır (~10 bin); tek seferde okunması, havuzun KV'de
// 30 dakika önbelleklendiği düşünüldüğünde ihmal edilebilir bir maliyettir (bkz. publicCache.js#
// getCachedPool). Sıralama/kilit bilgisi böylece havuzun İÇİNE pişer ve istek başına hiçbir ek
// maliyet doğurmaz.
export async function fetchAllProjectMediaRights(env) {
  const { results } = await env.DB.prepare(
    `SELECT ${MEDIA_COLUMNS} FROM media_rights WHERE entity_type = 'project' ORDER BY entity_id ASC, sort_order ASC`
  ).all();
  const byProject = new Map();
  for (const row of results || []) {
    let list = byProject.get(row.entity_id);
    if (!list) { list = []; byProject.set(row.entity_id, list); }
    list.push(row);
  }
  return byProject;
}

// Belirli projelerin medya satırları — sayfalanmış liste yolları için (bir sayfada en fazla ~96
// proje). Havuz yolunun aksine burada tam tablo taraması yapılmaz; IN(...) listesi D1'in bağlı
// parametre sınırına göre parçalanır (düz IN, `A OR B` zinciri DEĞİL — bkz. proje notu: SQLite
// ifade-ağacı derinlik sınırı 100).
const ID_CHUNK = 90;
export async function fetchProjectMediaRightsForIds(env, ids) {
  const byProject = new Map();
  const unique = [...new Set((ids || []).filter(id => Number.isFinite(Number(id))))];
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    const chunk = unique.slice(i, i + ID_CHUNK);
    const { results } = await env.DB.prepare(
      `SELECT ${MEDIA_COLUMNS} FROM media_rights
        WHERE entity_type = 'project' AND entity_id IN (${chunk.map(() => '?').join(', ')})
        ORDER BY entity_id ASC, sort_order ASC`
    ).bind(...chunk).all();
    for (const row of results || []) {
      let list = byProject.get(row.entity_id);
      if (!list) { list = []; byProject.set(row.entity_id, list); }
      list.push(row);
    }
  }
  return byProject;
}

// Şekillendirilmiş proje kartlarına/detaylarına hak dönüşümünü uygular (KATMAN 1).
// pairs: [{ id, approved, item }] — `id` projects.id, `approved` is_copyright_approved.
// byProject verilirse (havuz yolu, tek seferde okunmuş harita) ek sorgu YAPILMAZ.
export async function applyRightsToShapedProjects(env, pairs, byProject) {
  const list = pairs || [];
  if (!list.length) return list.map(p => p.item);
  const map = byProject || await fetchProjectMediaRightsForIds(env, list.map(p => p.id));
  for (const pair of list) {
    applyProjectImageRights(pair.item, pair.id, map.get(pair.id) || [], !!pair.approved);
  }
  return list.map(p => p.item);
}

// ---------------------------------------------------------------------------------------------
// KAYIT (registrar) — canonical bir projenin görselleri her yazıldığında çalışır
// ---------------------------------------------------------------------------------------------
// Var olan satırların HAK DURUMUNA DOKUNMAZ: yalnızca eksik görseller için yeni satır açar, artık
// kayıtta olmayan görsellerin satırlarını siler ve sort_order'ı tazeler. Bir görselin onayını
// "kaydet"e basmak sessizce geri almamalı; onay/iptal YALNIZCA açık hak aksiyonlarından geçer
// (bkz. setMediaRightsStatus).
//
// defaultStatus: yeni satırların başlangıç durumu. Sahiplenilmiş bir profilin kendi gönderdiği
// içerikte 'approved'+izinli (kullanıcı beyanı alınmıştır), diğer her durumda 'unknown'.
export async function registerProjectMedia(env, projectId, images, opts) {
  return registerEntityMedia(env, 'project', projectId, images, opts);
}

// Jenerik kayıt — dört varlık tipi için de AYNI kural: var olan satırların HAK DURUMUNA dokunmaz,
// yalnızca eksikleri ekler, artık kayıtta olmayanları siler, sort_order'ı tazeler.
export async function registerEntityMedia(env, entityType, entityId, images, opts) {
  if (!entityId || !REGISTERED_ENTITY_TYPES.includes(entityType)) return { added: 0, removed: 0 };
  const o = opts || {};
  const list = Array.isArray(images) ? images.filter(u => typeof u === 'string' && u.trim()) : [];
  const existing = await fetchEntityMediaRights(env, entityType, entityId);
  const existingByUrl = new Map(existing.map(r => [r.media_url, r]));
  const wanted = new Set(list);

  const status = RIGHTS_STATUSES.includes(o.defaultStatus) ? o.defaultStatus : 'unknown';
  const allowOriginal = status === 'approved' && o.publicOriginalAllowed !== false ? 1 : 0;
  const origin = CONTENT_ORIGINS.includes(o.contentOrigin) ? o.contentOrigin : 'platform_curated';
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  let added = 0;
  for (let i = 0; i < list.length; i++) {
    const url = list[i];
    const row = existingByUrl.get(url);
    if (row) {
      if (Number(row.sort_order) !== i) {
        await env.DB.prepare(`UPDATE media_rights SET sort_order = ?, updated_at = ? WHERE id = ?`).bind(i, now, row.id).run();
      }
      continue;
    }
    await env.DB.prepare(
      `INSERT INTO media_rights (id, entity_type, entity_id, media_url, media_path, sort_order,
         rights_status, public_original_allowed, photographer, copyright_holder, source_url,
         rights_verified_at, rights_verified_by, rights_declaration_version, content_origin, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(), entityType, entityId, url, normalizeMediaPath(url), i,
      status, allowOriginal, o.photographer || null, o.copyrightHolder || null, o.sourceUrl || null,
      status === 'approved' ? now : null, o.verifiedBy || null,
      o.declarationVersion || null, origin, now, now,
    ).run();
    added++;
  }

  let removed = 0;
  for (const row of existing) {
    if (wanted.has(row.media_url)) continue;
    await env.DB.prepare(`DELETE FROM media_rights WHERE id = ?`).bind(row.id).run();
    removed++;
  }
  return { added, removed };
}

// ---------------------------------------------------------------------------------------------
// DENETİM KAYDI
// ---------------------------------------------------------------------------------------------
export async function recordRightsAudit(env, entry) {
  const e = entry || {};
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO media_rights_audit (id, content_id, content_type, action, reason, requested_by,
       processed_by, previous_status, new_status, declaration_version, ip, created_at, processed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(), String(e.contentId), e.contentType, e.action, e.reason || null,
    e.requestedBy || null, e.processedBy || null, e.previousStatus || null, e.newStatus || null,
    e.declarationVersion || null, e.ip || null, now, e.processedAt === undefined ? now : e.processedAt,
  ).run();
}

// İstek IP'si — mevcut güvenlik/rate-limit katmanının okuduğu başlığın AYNISI (bkz. src/lib/
// rateLimit.js). Beyan kaydı dışında hiçbir yere yazılmaz.
export function requestIp(request) {
  try { return request.headers.get('CF-Connecting-IP') || null; } catch { return null; }
}

// ---------------------------------------------------------------------------------------------
// DURUM DEĞİŞTİRME
// ---------------------------------------------------------------------------------------------
export async function setMediaRightsStatus(env, mediaId, next, actor) {
  const row = await env.DB.prepare(`SELECT ${MEDIA_COLUMNS} FROM media_rights WHERE id = ?`).bind(mediaId).first();
  if (!row) return null;
  const status = RIGHTS_STATUSES.includes(next.status) ? next.status : row.rights_status;
  // approved DEĞİLSE orijinal izni HER ZAMAN kapatılır — "approved'dan düşen ama izni açık kalan"
  // bir satır, isOriginalPublic'in üç koşulundan ikisini sağlayıp üçüncüsüne bel bağlardı.
  const allowed = status === 'approved' ? (next.publicOriginalAllowed ? 1 : 0) : 0;
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await env.DB.prepare(
    `UPDATE media_rights SET rights_status = ?, public_original_allowed = ?,
       photographer = COALESCE(?, photographer), copyright_holder = COALESCE(?, copyright_holder),
       source_url = COALESCE(?, source_url),
       rights_verified_at = CASE WHEN ? = 'approved' THEN ? ELSE rights_verified_at END,
       rights_verified_by = CASE WHEN ? = 'approved' THEN ? ELSE rights_verified_by END,
       rights_declaration_version = COALESCE(?, rights_declaration_version),
       updated_at = ?
     WHERE id = ?`
  ).bind(
    status, allowed, next.photographer || null, next.copyrightHolder || null, next.sourceUrl || null,
    status, now, status, (actor && actor.id) || null, next.declarationVersion || null, now, mediaId,
  ).run();
  await recordRightsAudit(env, {
    contentId: mediaId, contentType: 'media', action: next.action || 'approve',
    reason: next.reason || null, requestedBy: next.requestedBy || (actor && actor.id) || null,
    processedBy: (actor && actor.id) || null,
    previousStatus: row.rights_status, newStatus: status,
    declarationVersion: next.declarationVersion || null,
  });
  return { ...row, rights_status: status, public_original_allowed: allowed };
}

// ---------------------------------------------------------------------------------------------
// DOĞRUDAN ERİŞİM KAPISI
// ---------------------------------------------------------------------------------------------
// Bir istek yolunu, hak kaydının anahtarı olan "kapı yolu"na çevirir. Türev yolları KAYNAK görsele
// indirgenir — aksi halde kilitli bir görselin w800 türevi kapıdan sızardı.
// null dönerse yol hiç kapıya tabi değildir (logolar, mimarlar/, miras/, fontlar, script'ler...).
// KAPIYA TABİ STATİK DİZİNLER — canlı veriden ölçülerek belirlendi (2026-09-09): 29.045 proje
// görselinin dağılımı /media/ 19.282, /projects/ 7.043, /miras/ 2.720. `miras/` bu depoda ayrı bir
// tuzaktır: adı "eski/arşiv" çağrıştırsa da GERÇEK, yayındaki proje görselleridir ve kök yoldan
// servis edilir (bkz. proje notu: "miras/ statik, /media/ değil"). Listeye alınmasaydı 2.720 kilitli
// görselin orijinali doğrudan indirilebilir kalırdı.
// Bir önek eklemek, o dizindeki KAYITSIZ dosyaları etkilemez: kapı yalnızca media_rights satırı
// OLAN yolları reddeder (bkz. lookupGateDecision) — dolayısıyla miras/ altındaki proje dışı
// içerikler eskisi gibi açık kalır.
// Canlı veriden ölçüldü (2026-09-09): proje görselleri /media/, /projects/, /miras/ altında;
// KİŞİ fotoğraflarının 708'i `mimarlar-thumb/`, FİRMA logolarının 544'ü `logos-thumb/` ve 48'i
// yine `mimarlar-thumb/` altında duruyor (kolonlarda BAŞTA EĞİK ÇİZGİSİZ saklanıyorlar — bkz.
// js/components/project-meta.js'teki aynı not). Bu dört dizin eklenmezse o medyanın orijinali
// kayıtlı olsa bile doğrudan indirilebilir kalırdı.
//
// /logos/ BURADA OLMASI TEHLİKELİ DEĞİL: kapı yalnızca media_rights'ta KAYDI OLAN yolu reddeder.
// Sitenin kendi logoları ve favicon'ları (/logos/site/*) hiçbir zaman kaydedilmez, dolayısıyla
// eskisi gibi herkese açık kalır (regresyon testi: scripts/test-media-rights.mjs).
const GATED_STATIC_PREFIXES = ['/projects/', '/miras/', '/mimarlar/', '/mimarlar-thumb/', '/logos/', '/logos-thumb/'];
const DERIVED_KEY_RE = /^_derived\/w(\d+)\/(r2|s)\/(.+)$/;

export function gatePathFor(pathname) {
  if (typeof pathname !== 'string') return null;
  let candidate = null;
  if (pathname.startsWith('/media/')) {
    let key;
    try { key = decodeURIComponent(pathname.slice('/media/'.length)); } catch { return null; }
    if (!key) return null;
    const derived = DERIVED_KEY_RE.exec(key);
    if (derived) candidate = derived[2] === 'r2' ? normalizeMediaPath(`/media/${derived[3]}`) : normalizeMediaPath(`/${derived[3]}`);
    else candidate = normalizeMediaPath(`/media/${key}`);
  } else if (GATED_STATIC_PREFIXES.some(p => pathname.startsWith(p))) {
    // YÜZDE KODLAMASI ÇÖZÜLMELİ — /media/ dalıyla AYNI sebep. GERÇEK BULGU (production kontrolü,
    // 2026-09-09): burada eskiden ham pathname normalize ediliyordu, yani "/projects/%67izli-ev-1.webp"
    // ("g" harfi kodlanmış) kayıtlı yolla EŞLEŞMEZ, kapı "tanımıyorum" der ve isteği geçirirdi —
    // Cloudflare Assets ise yüzde kodlamasını çözüp KİLİTLİ ORİJİNALİ servis ederdi. Yani kilit,
    // tek bir karakteri kodlayarak atlatılabiliyordu.
    // Çözmenin güvenli olduğu VERİYLE doğrulandı: canlıdaki 29.045 proje görseli URL'sinin
    // tamamı düz ASCII — hiçbirinde '%', boşluk ya da ASCII dışı karakter yok, dolayısıyla
    // çözülmüş biçimle kayıtlı biçim her zaman örtüşür.
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { return null; }
    candidate = normalizeMediaPath(decoded);
  }
  // Bir kez çözüldükten SONRA hâlâ kodlanmış ayraç taşıyan yol REDDEDİLİR (çift kodlama). Böyle bir
  // yol bu veri kümesinde asla meşru değildir ve anlamı katmanlar arasında (Worker / Cloudflare
  // Assets / R2) farklı yorumlanabilir — belirsizliği kapının içine almak yerine yolu hiç sahiplenmeyiz.
  if (candidate && /%(2f|5c|2e)/i.test(candidate)) return null;
  if (!candidate) return null;
  // NORMALİZASYONDAN SONRA yeniden doğrula. Girdi hâlâ izin verilen bir önekle BAŞLIYOR olabilir
  // ama nokta segmentleri çözüldükten sonra bambaşka bir yere işaret ediyor olabilir —
  // "/projects/..%2F..%2Fadmin.html" tam olarak budur. Kontrol ham string üzerinde ".." aramaz,
  // URL'in KENDİ normalizasyonundan SONRAKİ sonuca bakar (bkz. src/routes/upload.js#
  // DERIVED_STATIC_IMAGE_RE'deki aynı gerçek bulgu: o yol canlıda admin.html'i /media/ altından
  // servis ediyordu). Kapı yolu üretilmezse istek mevcut akışında kalır ve oradaki kendi
  // korumalarına çarpar; burada üretilmesi ise hak sistemine ait olmayan bir yolu hak
  // sistemine sokardı.
  const allowed = candidate.startsWith('/media/') || GATED_STATIC_PREFIXES.some(p => candidate.startsWith(p));
  return allowed ? candidate : null;
}

// İzolat içi karar önbelleği. Kapı, kilitli olmayan görsellerde de (ör. her /media/u/... avatarı)
// bir D1 okuması demek olurdu; sıcak yollar burada tutulur. Epoch değiştiğinde (bir hak durumu
// değiştiğinde) tüm girdiler geçersizleşir, yani "onayı kaldırdım ama görsel hâlâ açık" durumu
// en fazla bir istek boyu yaşayabilir ve o da yalnızca epoch okumasının kendi TTL'i kadar.
const decisionCache = new Map();
const DECISION_TTL_MS = 60000;
const DECISION_CACHE_MAX = 2000;

export function _resetDecisionCacheForTests() { decisionCache.clear(); epochMemo.value = null; }

// Hak durumu her değiştiğinde artan sayaç. Cache API anahtarlarına ve izolat önbelleğine karışır;
// bir onay kaldırıldığında EDGE'DEKİ eski (açık) kopyaların anahtarını anında yetim bırakır —
// SSR_CACHE_VERSION'ın deploy anındaki işlevinin çalışma zamanı karşılığı (bkz. src/lib/ssrCache.js).
const EPOCH_KEY = 'media_rights_epoch';
const epochMemo = { value: null, at: 0 };
const EPOCH_MEMO_MS = 10000;

export async function rightsEpoch(env) {
  const now = Date.now();
  if (epochMemo.value !== null && now - epochMemo.at < EPOCH_MEMO_MS) return epochMemo.value;
  let value = '0';
  try {
    if (env && env.FACET_CACHE) value = (await env.FACET_CACHE.get(EPOCH_KEY)) || '0';
  } catch { /* KV okunamıyorsa '0' ile devam — kapı yine D1'e sorar, yalnızca önbellek daha uzun yaşar */ }
  epochMemo.value = value;
  epochMemo.at = now;
  return value;
}

export async function bumpRightsEpoch(env) {
  const next = `${Date.now()}`;
  try { if (env && env.FACET_CACHE) await env.FACET_CACHE.put(EPOCH_KEY, next); } catch { /* yoksay */ }
  epochMemo.value = next;
  epochMemo.at = Date.now();
  decisionCache.clear();
  return next;
}

// Kapı kararı: bu yolun ORİJİNAL baytları doğrudan servis edilebilir mi?
//   { gated:false }            -> hak sistemi bu yolu hiç tanımıyor, mevcut davranış aynen
//   { gated:true, allowed:X }  -> tanınan bir medya; allowed=false ise doğrudan erişim 404
//
// AYNI DOSYA BİRDEN FAZLA PROJEDE olabilir (aynı görsel iki projenin galerisinde). Bu durumda EN
// İZİN VERİCİ satır kazanır: baytlar bir sahibin onayıyla zaten meşru biçimde herkese açıksa,
// ikinci bir kaydın onaysız olması o gerçeği değiştirmez.
export async function lookupGateDecision(env, gatePath) {
  if (!gatePath) return { gated: false };
  const epoch = await rightsEpoch(env);
  const cached = decisionCache.get(gatePath);
  if (cached && cached.epoch === epoch && cached.exp > Date.now()) return cached.decision;

  let decision = { gated: false };
  try {
    // DÖRT VARLIK TİPİ TEK SORGUDA. Proje tarafında onay İKİ düzeylidir (medya + projects.
    // is_copyright_approved, bkz. migrations/0106 başlığı); diğer üç tipte entity_approved her zaman
    // 1'dir çünkü orada ikinci bir düzey yoktur — bir firmanın kendi logosunun ya da bir kişinin
    // kendi portresinin hak sahibi tek bir taraftır, projenin künyesi/fotoğrafçısı ayrımı yoktur.
    // Silinmiş/gizlenmiş kaydın medyası HER tipte kapalıdır (entity_visible = 0).
    const row = await env.DB.prepare(
      `SELECT m.id, m.rights_status, m.public_original_allowed,
              CASE m.entity_type WHEN 'project' THEN COALESCE(p.is_copyright_approved, 0) ELSE 1 END AS entity_approved,
              CASE m.entity_type
                WHEN 'project'   THEN (p.id IS NOT NULL AND p.deleted_at IS NULL AND p.hidden_at IS NULL)
                WHEN 'product'   THEN (pr.id IS NOT NULL AND pr.deleted_at IS NULL AND pr.hidden_at IS NULL)
                WHEN 'architect' THEN (a.id IS NOT NULL AND a.deleted_at IS NULL AND a.hidden_at IS NULL)
                WHEN 'office'    THEN (o.id IS NOT NULL AND o.deleted_at IS NULL AND o.hidden_at IS NULL)
                ELSE 0 END AS entity_visible
         FROM media_rights m
         LEFT JOIN projects   p  ON m.entity_type = 'project'   AND p.id  = m.entity_id
         LEFT JOIN products   pr ON m.entity_type = 'product'   AND pr.id = m.entity_id
         LEFT JOIN architects a  ON m.entity_type = 'architect' AND a.id  = m.entity_id
         LEFT JOIN offices    o  ON m.entity_type = 'office'    AND o.id  = m.entity_id
        WHERE m.media_path = ?
        ORDER BY (m.rights_status = 'approved' AND m.public_original_allowed = 1) DESC
        LIMIT 1`
    ).bind(gatePath).first();
    if (row) {
      const visible = Number(row.entity_visible) === 1;
      decision = {
        gated: true,
        allowed: visible && isOriginalPublic(row, Number(row.entity_approved) === 1),
        mediaId: row.id,
      };
    }
  } catch {
    // D1 okunamadıysa MEVCUT DAVRANIŞ korunur (gated:false). Bu bilinçli bir seçim: veritabanı
    // arızasında sitedeki tüm görselleri karartmak, kilitli bir görselin o pencerede erişilebilir
    // kalmasından daha büyük bir hasardır — üstelik kilitli görsellerin URL'si istemciye zaten hiç
    // verilmediğinden bu pencerede erişim için o yolun ÖNCEDEN bilinmesi gerekir.
    return { gated: false };
  }

  if (decisionCache.size > DECISION_CACHE_MAX) decisionCache.clear();
  decisionCache.set(gatePath, { epoch, exp: Date.now() + DECISION_TTL_MS, decision });
  return decision;
}

// Türev/w400 baytı da bulunamayan kilitli görsel için fail-closed yanıt. ORİJİNALE ASLA DÜŞÜLMEZ.
export const LOCKED_PLACEHOLDER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300" role="img" aria-label="Görsel yayın hakkı doğrulanmadı"><rect width="400" height="300" fill="#e9e6e1"/><rect x="170" y="126" width="60" height="48" rx="6" fill="none" stroke="#9c948a" stroke-width="6"/><path d="M182 126v-14a18 18 0 0 1 36 0v14" fill="none" stroke="#9c948a" stroke-width="6"/></svg>';

// ---------------------------------------------------------------------------------------------
// ÇIKIŞ TARAMASI (outbound scrub) — SIZINTIYA KARŞI İKİNCİ KATMAN
// ---------------------------------------------------------------------------------------------
// NEDEN İKİNCİ BİR KATMAN VAR: proje görselleri yalnızca proje uçlarından çıkmıyor. Aynı kapak
// URL'si kişi/firma pop-up'larının proje ızgaralarından (src/routes/architect.js, office.js),
// takip akışından (follows.js), yorum/kaydedilenler/paylaşılanlar listelerinden, aramadan ve
// En İyi 100'den de dönüyor — bugün ONİKİ ayrı yerden. Her birine tek tek "hak dönüşümü" eklemek,
// bu depodaki tekrar eden kök nedenin (doğru yardımcı, kod yolu taşınınca sessizce bypass edilir —
// bkz. proje notu "Tam sistem denetimi 2026-09-03") tam da davetiyesi olurdu. Bunun yerine:
//
//   KATMAN 1 (anlamsal): applyProjectImageRights — proje havuzu ve proje detayı. Sıralamayı,
//     imageHotspots anahtarlarını ve `imageRights` meta'sını da düzeltir; yalnızca burada yapılabilir.
//   KATMAN 2 (ağ): scrubLockedMediaPayload — çıkan JSON'un TAMAMINI dolaşır ve kilitli bir yerel
//     medya yoluna benzeyen HER dizeyi güvenli uçla değiştirir. Katman 1'den geçmiş yükte hiçbir
//     şey bulamaz (no-op); değeri, katman 1'in hiç uğramadığı yollardadır.
//
// Yeni bir uç eklendiğinde ikinci katman onu OTOMATİK kapsar — unutulacak bir çağrı noktası yok.
const SCRUB_PREFIXES = ['/projects/', '/media/'];
const SCRUB_MAX_PATHS = 3000;
// D1 tek ifadede sınırlı sayıda bağlı parametre kabul eder; IN(...) listesi bu boyutta parçalanır
// (bkz. proje notu: SQLite ifade-ağacı derinlik sınırı 100 — düz IN(...) kullanılır, `A OR B` DEĞİL).
const SCRUB_CHUNK = 90;

function collectMediaPaths(value, out, seenObjects) {
  if (out.size >= SCRUB_MAX_PATHS) return;
  if (typeof value === 'string') {
    const path = normalizeMediaPath(value);
    if (path && SCRUB_PREFIXES.some(p => path.startsWith(p))) out.add(path);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (seenObjects.has(value)) return;
  seenObjects.add(value);
  if (Array.isArray(value)) { for (const v of value) collectMediaPaths(v, out, seenObjects); return; }
  for (const v of Object.values(value)) collectMediaPaths(v, out, seenObjects);
}

// Verilen yollardan KİLİTLİ olanları döndürür: Map<yol, mediaId>. İzin verilenler haritaya HİÇ
// girmez — onların URL'si değiştirilmeyecek.
async function fetchLockedPathMap(env, paths) {
  const locked = new Map();
  const allowed = new Set();
  for (let i = 0; i < paths.length; i += SCRUB_CHUNK) {
    const chunk = paths.slice(i, i + SCRUB_CHUNK);
    const { results } = await env.DB.prepare(
      `SELECT m.media_path, m.id, m.rights_status, m.public_original_allowed,
              COALESCE(p.is_copyright_approved, 0) AS project_approved
         FROM media_rights m
         LEFT JOIN projects p ON m.entity_type = 'project' AND p.id = m.entity_id
        WHERE m.media_path IN (${chunk.map(() => '?').join(', ')})`
    ).bind(...chunk).all();
    for (const row of results || []) {
      // AYNI YOL BİRDEN FAZLA KAYITTA olabilir (aynı görsel iki projenin galerisinde). EN İZİN
      // VERİCİ satır kazanır — bkz. lookupGateDecision'daki aynı kural: baytlar bir sahibin
      // onayıyla zaten meşru biçimde herkese açıksa, ikinci kaydın onaysız olması bunu değiştirmez.
      if (isOriginalPublic(row, Number(row.project_approved) === 1)) { allowed.add(row.media_path); continue; }
      if (!locked.has(row.media_path)) locked.set(row.media_path, row.id);
    }
  }
  for (const path of allowed) locked.delete(path);
  return locked;
}

function rewriteMediaStrings(value, locked, seenObjects) {
  if (typeof value === 'string') {
    const path = normalizeMediaPath(value);
    const id = path ? locked.get(path) : null;
    return id ? `${SAFE_MEDIA_PREFIX}${id}` : value;
  }
  if (!value || typeof value !== 'object') return value;
  if (seenObjects.has(value)) return value;
  seenObjects.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = rewriteMediaStrings(value[i], locked, seenObjects);
    return value;
  }
  for (const key of Object.keys(value)) value[key] = rewriteMediaStrings(value[key], locked, seenObjects);
  return value;
}

export async function scrubLockedMediaPayload(env, data) {
  if (!data || typeof data !== 'object' || !env || !env.DB) return data;
  const paths = new Set();
  try { collectMediaPaths(data, paths, new WeakSet()); } catch { return data; }
  if (!paths.size) return data;
  let locked;
  try { locked = await fetchLockedPathMap(env, [...paths]); } catch { return data; }
  if (!locked.size) return data;
  return rewriteMediaStrings(data, locked, new WeakSet());
}

// ---------------------------------------------------------------------------------------------
// "SAHİPLENİLMİŞ İÇERİK" YÜKSELTMESİ
// ---------------------------------------------------------------------------------------------
// Kullanıcı kararı (2026-09-09): sistem KATI modda başlar (her şey unknown = kilitli), TEK istisna
// profilini SAHİPLENMİŞ kullanıcıların içeriğidir — onların kişi/firma profilleri, projeleri ve o
// projelerin görselleri doğrudan approved + public_original_allowed=1 olarak açılır.
//
// "Sahiplenilmiş" burada, sitenin BAŞKA yerlerinde zaten kullanılan tanımın AYNISIDIR — yeni bir
// sahiplik kavramı icat edilmedi (bkz. src/lib/claimedProfiles.js#anyProfileClaimed, pop-up'lardaki
// kaynak ibaresi bu kuralla kalkıyor). Üç yol da kabul edilir, çünkü sahiplik bu depoda üç ayrı
// izden okunabiliyor (bkz. proje notu: "Profil sahipliğinin İKİ yolu" + admin doğrudan atama):
//   (a) projenin kendisi bir üyeye atanmış           -> projects.claimed_by_user_id
//   (b) künyedeki mimar/firma satırı bir üyeye atanmış -> architects/offices.claimed_by_user_id
//   (c) künyedeki mimar/firma adına ONAYLI bir talep var -> profile_claims(status='approved')
// (b) ve (c) ayrı ayrı gerekir: admin'in doğrudan ataması claimed_by_user_id'yi yazar ama her
// zaman bir profile_claims satırı doğurmaz; tersi de mümkündür (bkz. proje notu: "Atamanın İKİ
// admin yolu").
export async function isProjectClaimBacked(env, projectId) {
  if (!projectId) return false;
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM projects p
      WHERE p.id = ?1 AND (
        p.claimed_by_user_id IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM project_designers pd
            LEFT JOIN architects a ON a.id = pd.architect_id AND a.deleted_at IS NULL
            LEFT JOIN offices o ON o.id = pd.office_id AND o.deleted_at IS NULL
           WHERE pd.project_id = ?1
             AND (a.claimed_by_user_id IS NOT NULL OR o.claimed_by_user_id IS NOT NULL))
        OR EXISTS (
          SELECT 1 FROM project_designers pd
            LEFT JOIN architects a ON a.id = pd.architect_id AND a.deleted_at IS NULL
            LEFT JOIN offices o ON o.id = pd.office_id AND o.deleted_at IS NULL
            JOIN profile_claims c ON c.status = 'approved'
                 AND (c.profile_key = a.name OR c.profile_key = o.name)
           WHERE pd.project_id = ?1))
      LIMIT 1`
  ).bind(projectId).first();
  return !!row;
}

// Canonical bir proje yazıldıktan SONRA çağrılır: projects.images'i GERÇEĞİN KENDİSİNDEN (satırdan)
// okuyup hak kayıtlarını hizalar.
//
// NEDEN SATIRDAN OKUR, ÇAĞIRANIN ELİNDEKİ DİZİDEN DEĞİL: syncProject'in UPDATE dalı `images`i
// yalnızca DOLU geldiğinde yazar (bkz. o dosyadaki "images boşsa mevcut galeri korunur" kuralı) —
// çağıranın gönderdiği dizi ile satırda duran dizi aynı olmayabilir. Kayıt her zaman satırda
// gerçekten NE VARSA onu yansıtmalı, aksi halde kapı var olmayan bir görseli kilitler ya da var
// olan bir görseli hiç tanımaz.
export async function syncProjectMediaRights(env, projectId, opts) {
  if (!projectId) return null;
  const o = opts || {};
  const row = await env.DB.prepare(`SELECT images FROM projects WHERE id = ?`).bind(projectId).first();
  if (!row) return null;
  let images = [];
  try { images = row.images ? JSON.parse(row.images) : []; } catch { images = []; }
  if (!Array.isArray(images)) images = [];

  // YENİ satırların başlangıç durumu. Var olan satırların durumuna registerProjectMedia zaten
  // DOKUNMAZ — bir düzenleme, daha önce verilmiş (ya da geri alınmış) bir onayı sessizce
  // değiştirmemeli.
  const claimBacked = await isProjectClaimBacked(env, projectId);
  const declared = !!o.declarationVersion;
  const status = (claimBacked && declared) ? 'approved' : (declared ? 'pending' : 'unknown');
  const result = await registerProjectMedia(env, projectId, images, {
    defaultStatus: status,
    publicOriginalAllowed: true,
    contentOrigin: claimBacked ? 'owner_submitted' : (o.ownerUserId ? 'user_submitted' : 'platform_curated'),
    declarationVersion: o.declarationVersion || null,
    verifiedBy: o.ownerUserId || null,
    photographer: o.photographer || null,
  });

  // Proje düzeyi onay, görsel düzeyi onayla BİRLİKTE doğar: beyanı veren kişi projeyi
  // düzenlemeye yetkiliyse (sahiplenilmiş künye) proje de onaylı sayılır. Aksi halde
  // is_copyright_approved 0'da kalır ve galeri kilitli görünür — beyan alınmıştır ama onay
  // ayrı bir karardır (bkz. kullanıcı isteği madde 10).
  if (claimBacked && declared) {
    await env.DB.prepare(`UPDATE projects SET is_copyright_approved = 1 WHERE id = ?`).bind(projectId).run();
  }
  return { ...result, status, claimBacked };
}

// ---------------------------------------------------------------------------------------------
// DÖRT TİP İÇİN SAHİPLİK VE KAYIT (kullanıcı isteği, 2026-09-09 ikinci tur)
// ---------------------------------------------------------------------------------------------
// Kural aynı: SAHİPLENİLMEMİŞ her kaydın medyası kilitli başlar, sahiplenilmiş olanlarınki açık.
// "Sahiplenilmiş" tanımı her tipte sitenin BAŞKA yerlerinde zaten kullanılan tanımdır — yeni bir
// sahiplik kavramı icat edilmedi (bkz. src/lib/claimedProfiles.js#anyProfileClaimed ve
// isProjectClaimBacked'in üç yolu).
//
// profile_claims bu depoda ÇIPLAK İSİMLE anahtarlanır (bkz. proje notu: "Duplicate name key
// limitation"), bu yüzden eşleştirme name/legacy_key üzerinden yapılır — claimedProfiles.js'in
// yaptığının aynısı.
export async function isEntityClaimBacked(env, entityType, entityId) {
  if (!entityId) return false;
  if (entityType === 'project') return isProjectClaimBacked(env, entityId);

  if (entityType === 'architect') {
    const row = await env.DB.prepare(
      `SELECT 1 AS ok FROM architects a
        WHERE a.id = ?1 AND (
          a.claimed_by_user_id IS NOT NULL
          OR EXISTS (SELECT 1 FROM profile_claims c
                      WHERE c.status = 'approved' AND c.profile_type = 'architect'
                        AND (c.profile_key = a.name OR c.profile_key = a.legacy_key)))
        LIMIT 1`
    ).bind(entityId).first();
    return !!row;
  }

  if (entityType === 'office') {
    const row = await env.DB.prepare(
      `SELECT 1 AS ok FROM offices o
        WHERE o.id = ?1 AND (
          o.claimed_by_user_id IS NOT NULL
          OR EXISTS (SELECT 1 FROM profile_claims c
                      WHERE c.status = 'approved' AND c.profile_type = 'office'
                        AND (c.profile_key = o.name OR c.profile_key = o.legacy_key)))
        LIMIT 1`
    ).bind(entityId).first();
    return !!row;
  }

  if (entityType === 'product') {
    // Ürünün sahibi ya ürünü sahiplenen üye ya da MARKASINI sahiplenen üyedir — marka sahipliği
    // ürün künyesini de yönetme yetkisi verir (bkz. proje notu: "Ürün etiketleme = rozet
    // ayrıcalığı", onay hep marka sahibindedir). brand_name_raw, canonical bir offices satırına
    // bağlanamamış markalar için fallback'tir; onun için de ad üzerinden talep aranır.
    const row = await env.DB.prepare(
      `SELECT 1 AS ok FROM products pr
         LEFT JOIN offices o ON o.id = pr.brand_office_id AND o.deleted_at IS NULL
        WHERE pr.id = ?1 AND (
          pr.claimed_by_user_id IS NOT NULL
          OR o.claimed_by_user_id IS NOT NULL
          OR EXISTS (SELECT 1 FROM profile_claims c
                      WHERE c.status = 'approved' AND c.profile_type = 'office'
                        AND (c.profile_key = o.name OR c.profile_key = o.legacy_key
                             OR c.profile_key = pr.brand_name_raw)))
        LIMIT 1`
    ).bind(entityId).first();
    return !!row;
  }
  return false;
}

// Bir varlık satırındaki TÜM medya URL'lerini, MEDIA_FIELDS_BY_TYPE'a göre sırayla toplar.
export function collectEntityMediaUrls(row, entityType) {
  const cfg = MEDIA_FIELDS_BY_TYPE[entityType];
  if (!cfg || !row) return [];
  const urls = [];
  const push = (v) => { if (typeof v === 'string' && v.trim()) urls.push(v.trim()); };
  for (const field of cfg.singleFields) push(row[field]);
  for (const field of cfg.arrayFields) {
    let arr = [];
    try { arr = row[field] ? JSON.parse(row[field]) : []; } catch { arr = []; }
    if (Array.isArray(arr)) arr.forEach(push);
  }
  // ÜRÜN VERSİYONLARI: products.variants[].images, pop-up'ta ürünün KENDİ galerisini GÖLGELER
  // (bkz. proje notu: "Versiyonlar ürün galerisini gölgeler" — seçili versiyonun görselleri
  // öncelikli okunuyor). Kaydedilmezlerse kilitli bir ürünün asıl gösterilen görselleri kapının
  // dışında kalırdı.
  if (entityType === 'product' && row.variants) {
    let variants = [];
    try { variants = JSON.parse(row.variants); } catch { variants = []; }
    if (Array.isArray(variants)) {
      for (const v of variants) {
        if (v && Array.isArray(v.images)) v.images.forEach(push);
      }
    }
  }
  return [...new Set(urls)];
}

// Canonical bir kayıt yazıldıktan SONRA çağrılır (syncProjectMediaRights'ın dört tipe genellenmiş
// hâli). Medyayı GERÇEĞİN KENDİSİNDEN (satırdan) okur — çağıranın elindeki diziden değil.
export async function syncEntityMediaRights(env, entityType, entityId, opts) {
  if (!entityId || !REGISTERED_ENTITY_TYPES.includes(entityType)) return null;
  if (entityType === 'project') return syncProjectMediaRights(env, entityId, opts);
  const cfg = MEDIA_FIELDS_BY_TYPE[entityType];
  const cols = [...cfg.singleFields, ...cfg.arrayFields, ...(entityType === 'product' ? ['variants'] : [])];
  const row = await env.DB.prepare(
    `SELECT ${cols.join(', ')} FROM ${cfg.table} WHERE id = ?`
  ).bind(entityId).first();
  if (!row) return null;
  const urls = collectEntityMediaUrls(row, entityType);
  const claimBacked = await isEntityClaimBacked(env, entityType, entityId);
  const o = opts || {};
  return registerEntityMedia(env, entityType, entityId, urls, {
    // Sahiplenilmiş kayıtta medya AÇIK başlar (kullanıcının kendi içeriği); değilse kilitli.
    defaultStatus: claimBacked ? 'approved' : 'unknown',
    publicOriginalAllowed: true,
    contentOrigin: claimBacked ? 'owner_submitted' : 'platform_curated',
    declarationVersion: o.declarationVersion || null,
    verifiedBy: o.ownerUserId || null,
  });
}

// Bir profil TALEBİ ONAYLANDIĞINDA çağrılır: o kaydın (ve kişi/firma ise ilişkili projelerinin)
// kilitli medyası açılır.
//
// NEDEN GEREKLİ: seed "şu an sahiplenilmemiş olan kilitli" der. Kullanıcı profilini SONRADAN
// sahiplendiğinde bu karar yeniden değerlendirilmezse profil sonsuza kadar bulanık kalırdı —
// sistemin en görünür kırılma biçimi bu olurdu.
//
// YALNIZCA 'unknown'/'pending' satırlar açılır: 'disputed'/'removed' bir hak sahibi kararıdır ve
// bir profil sahiplenmesi onu geri alamaz.
export async function openMediaForClaimedEntity(env, entityType, entityId) {
  if (!entityId || !REGISTERED_ENTITY_TYPES.includes(entityType)) return { opened: 0 };
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const res = await env.DB.prepare(
    `UPDATE media_rights
        SET rights_status = 'approved', public_original_allowed = 1,
            content_origin = 'owner_submitted', rights_verified_at = ?, updated_at = ?
      WHERE entity_type = ? AND entity_id = ? AND rights_status IN ('unknown', 'pending')`
  ).bind(now, now, entityType, entityId).run();
  const opened = (res && res.meta && res.meta.changes) || 0;
  if (opened && entityType === 'project') {
    await env.DB.prepare(`UPDATE projects SET is_copyright_approved = 1 WHERE id = ?`).bind(entityId).run();
  }
  return { opened };
}

// ---------------------------------------------------------------------------------------------
// HAVUZ SIRALAMASI (kullanıcı isteği, 2026-09-09 ikinci tur: "ana sayfadaki caroseller için de")
// ---------------------------------------------------------------------------------------------
// Kişi/firma/ürün listeleri projeninkinden FARKLI çalışır: hepsi tek parça bir "havuz" olarak
// çekilip KV'de önbelleklenir ve sayfalama/filtreleme JS'te yapılır (bkz. publicCache.js#
// getCachedPool). Bu yüzden projede olduğu gibi bir SQL kolonuna (rights_bucket) ve trigger'lara
// GEREK YOK — sıra burada, havuz kurulurken bir kez hesaplanır ve 30 dakika boyunca bedava gelir.
//
// Ana sayfa carousel'leri, /kisi /firma /marka /urun listeleri ve arama hep AYNI havuzu tükettiği
// için tek bir yerde sıralamak dört yüzeyi birden kapsar.
export function entityRightsBucketFrom(rows) {
  const list = rows || [];
  if (!list.length) return 1;                                     // medyası yok — nötr
  if (list.some(r => r.rights_status === 'approved' && Number(r.public_original_allowed) === 1)) return 0;
  if (list.some(r => r.rights_status !== 'disputed' && r.rights_status !== 'removed')) return 1;
  return 2;                                                       // hepsi ihtilaflı/kaldırılmış
}

// Ham D1 satırlarını telif grubuna göre STABİL sıralar: grup içindeki MEVCUT sıra (sorgunun kendi
// ORDER BY'ı — display_order, id DESC vb.) aynen korunur, yalnızca gruplar üst üste dizilir.
// ORDER BY RANDOM() kullanılmaz; sıra tamamen deterministiktir.
export async function orderRowsByRightsBucket(env, entityType, rows) {
  const list = rows || [];
  if (!list.length) return list;
  let byEntity;
  try { byEntity = await fetchAllEntityMediaRights(env, entityType); } catch { return list; }
  if (!byEntity.size) return list;
  return list
    .map((row, i) => ({ row, i, bucket: entityRightsBucketFrom(byEntity.get(row.id)) }))
    .sort((a, b) => (a.bucket - b.bucket) || (a.i - b.i))
    .map(x => x.row);
}

// SSR/meta katmanı için ince sarmalayıcı: bir varlığın medya URL'lerini güvenli biçimlerine
// çevirir ve hangilerinin kilitli olduğunu döndürür.
//   urls   — hak grubuna göre sıralanmış, kilitliler /api/media/<id> ile değiştirilmiş liste
//   locked — o listedeki KİLİTLİ URL'lerin kümesi
// Kullanım kuralı (projede kurulan ilkeyle aynı): SAYFA GÖVDESİ kilitli görselin güvenli sürümünü
// gösterir, ama JSON-LD/OpenGraph'a YALNIZCA gerçekten açık olanlar yazılır — indexlenmeyeceğini
// bildiğimiz bir URL'i arama motoruna ilan etmenin anlamı yok (bkz. src/routes/media.js'in
// X-Robots-Tag: noindex başlığı).
export async function safeMediaUrlsFor(env, entityType, entityId, urls, entityApproved) {
  const list = (urls || []).filter(u => typeof u === 'string' && u.trim());
  if (!entityId || !list.length) return { urls: list, locked: new Set() };
  let rows = [];
  try { rows = await fetchEntityMediaRights(env, entityType, entityId); } catch { return { urls: list, locked: new Set() }; }
  const holder = { images: list };
  applyProjectImageRights(holder, entityId, rows, entityApproved !== false, entityType);
  return { urls: holder.images, locked: new Set(Object.keys(holder.imageRights || {})) };
}

// Bir profil TALEBİ ONAYLANDIĞINDA (ya da admin doğrudan atadığında) çağrılır — seed kuralının
// ÇALIŞMA ZAMANI KARŞILIĞI.
//
// Seed "şu an sahiplenilmemiş olan kilitli" der. Kullanıcı profilini SONRADAN sahiplendiğinde bu
// karar yeniden değerlendirilmezse profil sonsuza kadar bulanık kalırdı — sistemin en görünür
// kırılma biçimi bu olurdu ve kullanıcı "sahiplendim ama hiçbir şey değişmedi" derdi.
//
// KAPSAM, seed'in kapsamıyla BİREBİR AYNI olmalı (aksi halde aynı içerik iki yoldan iki farklı
// sonuç alır):
//   * profilin KENDİ medyası (kişi fotoğrafı / firma logosu+kapağı)
//   * o profilin künyede geçtiği PROJELER (isProjectClaimBacked'in (b)/(c) yolları)
//   * firma/marka ise o markanın ÜRÜNLERİ (isEntityClaimBacked'in ürün dalı)
//
// profile_claims ÇIPLAK İSİMLE anahtarlanır (bkz. proje notu: "Duplicate name key limitation"),
// bu yüzden eşleştirme name/legacy_key üzerindendir.
export async function openMediaForClaimKey(env, profileType, profileKey) {
  if (!profileKey || (profileType !== 'architect' && profileType !== 'office')) return { opened: 0 };
  const table = profileType === 'architect' ? 'architects' : 'offices';
  const entity = await env.DB.prepare(
    `SELECT id FROM ${table} WHERE deleted_at IS NULL AND (name = ? OR legacy_key = ?) LIMIT 1`
  ).bind(profileKey, profileKey).first();
  if (!entity) return { opened: 0 };

  let opened = 0;
  opened += (await openMediaForClaimedEntity(env, profileType, entity.id)).opened;

  // Künyesinde bu profil geçen projeler.
  const column = profileType === 'architect' ? 'architect_id' : 'office_id';
  const { results: projectRows } = await env.DB.prepare(
    `SELECT DISTINCT pd.project_id AS id FROM project_designers pd
       JOIN projects p ON p.id = pd.project_id AND p.deleted_at IS NULL
      WHERE pd.${column} = ?`
  ).bind(entity.id).all();
  for (const r of projectRows || []) {
    opened += (await openMediaForClaimedEntity(env, 'project', r.id)).opened;
  }

  // Markanın ürünleri.
  if (profileType === 'office') {
    const { results: productRows } = await env.DB.prepare(
      `SELECT id FROM products WHERE brand_office_id = ? AND deleted_at IS NULL`
    ).bind(entity.id).all();
    for (const r of productRows || []) {
      opened += (await openMediaForClaimedEntity(env, 'product', r.id)).opened;
    }
  }

  if (opened) await bumpRightsEpoch(env);
  return { opened };
}
