// "Üzerine kullanıcı atanmamış içerikleri arşive taşı" — admin toplu işlemi
// (kullanıcı isteği, 2026-09-10 madde 3: "Admin panelindeki üyeler bölümünden üzerine bir kullanıcı
// atanmamış tüm firmaları, kişileri, ürün ve markaları arşive taşı. Bu arşive taşınan tüm içerikler,
// eğer bir firmaya bir kullanıcı atanırsa o kullanıcının hesabım sayfasındaki arşiv kutusunda
// gözüksünler.").
//
// "ATANMAMIŞ" TANIMI (tek kaynak, admin ekranında da AYNI sayıyı üretir):
//   1) architects/offices: adıyla EŞLEŞEN onaylı bir profile_claims satırı YOK, ve
//   2) products/materials: markasının (brand_office_id -> offices.name, yoksa brand_name_raw)
//      onaylı bir firma ataması YOK — markasız ürünler her zaman atanmamış sayılır, ve
//   3) her tip için: kaydı YÜKLEYEN bir ÜYE de yok, yani o kayda karşılık gelen hiçbir
//      *_submissions satırının owner_user_id'si admin OLMAYAN bir kullanıcıya ait değil.
// (3) kritiktir: bir üyenin kendi yüklediği içerik "üzerine kullanıcı atanmamış" değildir — arkasında
// zaten bir kullanıcı vardır ve o içerik toplu arşivlemenin hedefi DEĞİLDİR.
//
// NEDEN PARÇALI (batch) ÇALIŞIR: tek bir Worker isteği binlerce kaydı işleyemez (CPU/alt-istek
// sınırları). Uç her çağrıda en fazla `limit` kayıt arşivler ve KALAN sayısını döner; admin ekranı
// (admin.html#archive-unassigned) bitene kadar çağrıyı tekrarlar. İşlem idempotenttir — arşivlenen
// kayıt bir sonraki taramada zaten hidden_at taşıdığı için listeye girmez.
//
// ARŞİVLEME İŞİNİ KENDİ BAŞINA YAPMAZ: src/routes/legacyContent.js#runContentAction'ın 'archive'
// dalını çağırır (bkz. [[project_bulk_admin_ops_via_live_code_2026_09_08]] — elle UPDATE hidden_at
// yazmak arşiv taslağını hiç oluşturmaz ve kaydı GERİ ALINAMAZ hale getirir; Arşivim kutusunun
// tamamı o taslağa dayanır).
import { json, errorJson, readJson } from '../lib/http.js';
import { runContentAction, runProjectAction } from './legacyContent.js';
import { parseProjectDateYear } from './project.js';
import { invalidatePublicCache } from '../lib/publicCache.js';
import { bumpFacetCounts } from '../lib/facetCounts.js';
import { foldTr } from '../lib/textMatch.js';
import officeKindJs from '../../office-kind.js';

const { isBrandOffice } = officeKindJs;

// SIRA ÖNEMLİ: projeler EN SONA konur. Bir projeyi arşivlemek proje facet sayaçlarını yeniden
// hesaplatır (bkz. archiveUnassignedBatch#skipFacets) ve bu, havuzun o anki hâline bakar — önce
// kişi/firma/ürün turunun bitmesi, sayaçların tek ve doğru bir son durumda kapanmasını sağlar.
const TYPES = ['architects', 'offices', 'products', 'materials', 'projects'];
// scripts/archive-unassigned.mjs bu ikisini import eder — toplu betik "atanmamış" tanımını
// KOPYALAMAZ, panelin kullandığı AYNI taramayı çağırır (bkz. o dosyanın başındaki gerekçe).
export const UNASSIGNED_TYPES = TYPES;
const SUBMISSION_TABLE = {
  architects: 'architect_submissions',
  offices: 'office_submissions',
  products: 'product_submissions',
  materials: 'material_submissions',
  projects: 'project_submissions',
};

const MAX_BATCH = 25;

// KORUNAN KAYITLAR — arşivlemenin DIŞINDA tutulanlar (kullanıcı isteği, 2026-09-10 ikinci tur:
// "Kaan Çorbacı'nın profilini ve fotoğrafladığı hiçbir projeyi arşivlemene gerek yok. İz bırakan
// rozetine sahip hiçbir mimarın kişi profilini, firmasını ve projelerini arşivlemene gerek yok.
// Künyesinde 1970 tarihinden önce bir tarih yazan hiçbir projeyi arşivlemene gerek yok.").
//
// PROJELER BU ARACIN KAPSAMINDA HİÇ YOK (bkz. TYPES) — "fotoğrafladığı projeler" ve "1970 öncesi
// projeler" istisnaları bu yüzden kendiliğinden sağlanır; buraya PROJE tipi eklenirse o iki kural
// da AYNI ANDA buraya eklenmelidir, yoksa sessizce ihlal edilirler.
//
// 'iz-birakan' rozeti admin_badges'te durur (bkz. src/routes/admin.js#ADMIN_GRANTABLE_BADGES) ve
// hem kişi hem firma profillerine verilebilir. Rozetli bir KİŞİNİN FİRMASI da korunur — firma bağı
// İKİ yerde yaşar (architects.office_id = birincil firma, office_founders = kurucu/ekip bağı),
// ikisi de okunur (bkz. [[project_office_membership_names_single_merge_2026_09_08]] — tek kaynağa
// bakmak bağların bir kısmını kaçırır).
const PROTECTED_ARCHITECT_NAMES = ['Kaan Çorbacı'];
// Fotoğrafı bu kişilere ait olan projeler canlıda kalır (kullanıcı isteği: "Kaan Çorbacı'nın
// paylaştığı fotoğraflarla oluşturulan projeler"). Bağ İKİ yerde olabilir: project_photographers
// (yapılandırılmış, bkz. migrations/0080) ve projects.photo_credit_text (serbest metin künye) —
// ikisi de kontrol edilir, biri tek başına eksik kalır.
const PROTECTED_PHOTOGRAPHER_NAMES = ['Kaan Çorbacı'];
// 1970'ten ÖNCE bir yıl taşıyan projeler canlıda kalır (kullanıcı isteği). Karşılaştırma
// src/routes/project.js#parseProjectDateYear ile yapılır — o fonksiyon serbest metin künyeden
// EN KÜÇÜK yılı çıkarır (yüzyıl ve MÖ biçimlerini de çözer), yani "1965-1972" de "MÖ 4. Yüzyıl" de
// doğru şekilde eşiğin altında kalır.
const PROJECT_KEEP_YEAR_BEFORE = 1970;

// bkz. findUnassignedProjects — D1'in 100 bind değişkeni sınırı.
const NAME_CHUNK = 40;
function chunked(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function fetchProtectedNames(env) {
  const architects = new Set(PROTECTED_ARCHITECT_NAMES.map(foldTr));
  const offices = new Set();

  const { results: badged } = await env.DB.prepare(
    `SELECT profile_type, profile_key FROM admin_badges WHERE badge_type = 'iz-birakan'`
  ).all();
  for (const r of badged || []) {
    if (r.profile_type === 'architect') architects.add(foldTr(r.profile_key || ''));
    else if (r.profile_type === 'office') offices.add(foldTr(r.profile_key || ''));
  }

  const { results: firms } = await env.DB.prepare(
    `SELECT DISTINCT o.name AS name FROM offices o WHERE o.deleted_at IS NULL AND o.id IN (
       SELECT a.office_id FROM architects a
         JOIN admin_badges b ON b.profile_type = 'architect' AND b.profile_key = a.name AND b.badge_type = 'iz-birakan'
         WHERE a.office_id IS NOT NULL
       UNION
       SELECT f.office_id FROM office_founders f
         JOIN architects a2 ON a2.id = f.architect_id
         JOIN admin_badges b2 ON b2.profile_type = 'architect' AND b2.profile_key = a2.name AND b2.badge_type = 'iz-birakan'
     )`
  ).all();
  for (const r of firms || []) offices.add(foldTr(r.name || ''));

  return { architects, offices };
}

// Onaylı atamaların adları. office_position kısıtı BİLEREK uygulanmaz: buradaki soru "bu profilin
// üzerinde bir kullanıcı VAR MI" — yetkisiz görevle atanmış bir kullanıcı da bir kullanıcıdır ve o
// profil "atanmamış" sayılmamalıdır (bkz. src/routes/archive.js'teki AYNI kolonun FARKLI amaçla,
// görev kısıtıyla okunması — orada soru "yayına alma yetkisi var mı").
async function fetchAssignedNames(env) {
  const { results } = await env.DB.prepare(
    `SELECT profile_type, profile_key FROM profile_claims WHERE status = 'approved'`
  ).all();
  const architects = new Set();
  const offices = new Set();
  for (const r of results || []) {
    if (r.profile_type === 'architect') architects.add(foldTr(r.profile_key || ''));
    else if (r.profile_type === 'office') offices.add(foldTr(r.profile_key || ''));
  }
  return { architects, offices };
}

// Admin OLMAYAN bir üyenin sahibi olduğu gönderilerin taşıdığı doğal anahtarlar. Bir kayıt bu
// kümedeyse arkasında gerçek bir kullanıcı var demektir (bkz. dosya başı (3) numaralı koşul).
async function fetchMemberOwnedKeys(env, typeKey) {
  const table = SUBMISSION_TABLE[typeKey];
  // projects/products/materials'ta görünen ad kolonu `title`, canonical bağ `claimed_slug`;
  // architects/offices'te `name` + `claimed_profile_key`.
  const usesTitle = typeKey === 'products' || typeKey === 'materials' || typeKey === 'projects';
  const nameCol = usesTitle ? 'title' : 'name';
  const claimedCol = usesTitle ? 'claimed_slug' : 'claimed_profile_key';
  const { results } = await env.DB.prepare(
    `SELECT s.${nameCol} AS nm, s.${claimedCol} AS ck FROM ${table} s
     JOIN users u ON u.id = s.owner_user_id
     WHERE u.role != 'admin'`
  ).all();
  const keys = new Set();
  for (const r of results || []) {
    if (r.nm) keys.add(foldTr(r.nm));
    if (r.ck) keys.add(foldTr(r.ck));
  }
  return keys;
}

// PROJELER — kendi "canlıda kalsın" kural kümesi var (kullanıcı isteği, 2026-09-10 üçüncü tur:
// "Bir üye tarafından sahiplenilmiş firma ve kişilerin projelerini, Kaan Çorbacı'nın paylaştığı
// fotoğraflarla oluşturulan projeleri, iz bırakan mimarların projelerini ve künyesindeki tarih/yıl
// kısmında 1970 yılından önceki yıllar yazan projeler canlıda kalmaya devam etsin. Bunların
// dışındaki tüm projeleri arşivle.").
//
// Bir proje ŞU DURUMLARDA canlı kalır:
//   1) künyesindeki (project_designers) bir mimar ya da firma ONAYLI bir profile_claims taşıyor,
//   2) künyesinde 'iz-birakan' rozetli bir mimar/firma var — ya da o mimarların firmalarından biri
//      (protectedNames.offices, bkz. fetchProtectedNames),
//   3) fotoğrafçısı Kaan Çorbacı (project_photographers VEYA serbest metin photo_credit_text),
//   4) project_date 1970'ten önce bir yıl taşıyor,
//   5) admin olmayan bir üye tarafından yüklenmiş (diğer tiplerdeki AYNI kural).
//
// Sorgular BİLEREK toplu: 1.700+ proje için satır başına sorgu atmak (uzak D1 üzerinden) kabul
// edilemez — üç küme tek seferde çekilip bellekte kesişim alınır.
async function findUnassignedProjects(env, assigned, memberKeys, protectedNames, limit) {
  const { results: liveRows } = await env.DB.prepare(
    `SELECT id, slug, title, project_date FROM projects WHERE hidden_at IS NULL AND deleted_at IS NULL ORDER BY id`
  ).all();
  if (!liveRows || !liveRows.length) return [];

  // (1)+(2) künyesi korunan/atanmış bir profile bağlı proje id'leri — TEK sorgu.
  const keepNames = [...new Set([
    ...assigned.architects, ...assigned.offices,
    ...protectedNames.architects, ...protectedNames.offices,
  ])];
  const keepProjectIds = new Set();
  // name_fold: migrations/0079_search_fold_columns.sql — Türkçe casefold edilmiş ad kolonu; foldTr
  // ile üretilen anahtarlarla BİREBİR aynı normalizasyonu taşır, bu yüzden karşılaştırma SQL
  // tarafında da güvenle yapılabilir (bkz.
  // [[project_search_query_and_field_must_tokenize_alike_2026_09_08]]).
  //
  // PARÇALARA BÖLÜNÜR: D1 tek ifadede en fazla 100 bind değişkeni kabul eder ("too many SQL
  // variables", canlıda ölçüldü) ve bu sorgu listeyi İKİ kez bind ediyor (mimar + firma kolonu).
  // 40'lık parçalar 80 değişkende kalır. Ayrıca düz IN kullanılır, `A OR B` zinciri DEĞİL — bkz.
  // [[project_sqlite_expression_tree_depth_100]].
  for (const chunk of chunked(keepNames, NAME_CHUNK)) {
    const ph = chunk.map(() => '?').join(', ');
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT pd.project_id AS pid FROM project_designers pd
       LEFT JOIN architects ar ON ar.id = pd.architect_id
       LEFT JOIN offices ofc ON ofc.id = pd.office_id
       WHERE ar.name_fold IN (${ph}) OR ofc.name_fold IN (${ph})`
    ).bind(...chunk, ...chunk).all();
    for (const r of results || []) keepProjectIds.add(r.pid);
  }

  // (3) fotoğrafçı bağı — yapılandırılmış tablo + serbest metin künye.
  const photographerFolded = PROTECTED_PHOTOGRAPHER_NAMES.map(foldTr);
  for (const chunk of chunked(photographerFolded, NAME_CHUNK)) {
    const ph = chunk.map(() => '?').join(', ');
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT pp.project_id AS pid FROM project_photographers pp
       JOIN architects ar ON ar.id = pp.architect_id WHERE ar.name_fold IN (${ph})`
    ).bind(...chunk).all();
    for (const r of results || []) keepProjectIds.add(r.pid);
  }
  const { results: creditRows } = await env.DB.prepare(
    `SELECT id, photo_credit_text FROM projects WHERE hidden_at IS NULL AND deleted_at IS NULL AND photo_credit_text IS NOT NULL AND photo_credit_text <> ''`
  ).all();
  for (const r of creditRows || []) {
    const folded = foldTr(r.photo_credit_text || '');
    if (photographerFolded.some(n => folded.includes(n))) keepProjectIds.add(r.id);
  }

  const out = [];
  for (const row of liveRows) {
    if (keepProjectIds.has(row.id)) continue;
    // (4) 1970 öncesi yıl — parseProjectDateYear EN KÜÇÜK yılı döner (null = yıl çözülemedi).
    const year = parseProjectDateYear(row.project_date);
    if (year !== null && year < PROJECT_KEEP_YEAR_BEFORE) continue;
    // (5) ÜYE YÜKLEMESİ ARTIK TEK BAŞINA YETMEZ (kullanıcı isteği, 2026-09-10 beşinci tur, madde 6:
    // "Kemalpaşa Kongre Merkezi'nin Not Mimarlık'a etiketli olması ve BLURLU olması gerekiyor").
    // O proje admin olmayan bir üye tarafından yüklenmişti ama künyesindeki firma (Not Mimarlık)
    // hiç kimseye ATANMAMIŞ — yani içeriğin telif sorumluluğunu üstlenen kimse yok. Bir üyenin
    // ÜÇÜNCÜ TARAF içeriği yüklemiş olması, o içeriği yayında tutmak için gerekçe değildir; kural
    // artık tek ölçüte bakar: künye ONAYLI bir profile bağlı mı (yukarıdaki (1)/(2)).
    // Diğer tipler (kişi/firma/marka/ürün) için üye-yüklemesi muafiyeti AYNEN KORUNUR — orada kayıt
    // zaten yükleyenin kendi profili/ürünüdür.
    out.push({ key: row.slug, name: row.title });
    if (limit && out.length >= limit) break;
  }
  return out.filter(r => !!r.key);
}

// Canlıda görünen (arşivlenmemiş, silinmemiş) canonical satırlar — atanmamış olanlar.
// Her satır için runContentAction'ın beklediği doğal anahtar (`key`) da hesaplanır.
async function findUnassigned(env, typeKey, assigned, memberKeys, protectedNames, limit) {
  if (typeKey === 'architects' || typeKey === 'offices') {
    const { results } = await env.DB.prepare(
      `SELECT id, name, slug${typeKey === 'offices' ? ', cats' : ''} FROM ${typeKey}
       WHERE hidden_at IS NULL AND deleted_at IS NULL ORDER BY id`
    ).all();
    const pool = typeKey === 'architects' ? assigned.architects : assigned.offices;
    const out = [];
    for (const row of results || []) {
      const folded = foldTr(row.name || '');
      const protectedPool = typeKey === 'architects' ? protectedNames.architects : protectedNames.offices;
      if (!folded || pool.has(folded) || memberKeys.has(folded) || protectedPool.has(folded)) continue;
      out.push({ key: row.name, name: row.name, cats: row.cats });
      if (limit && out.length >= limit) break;
    }
    return out;
  }
  if (typeKey === 'projects') return findUnassignedProjects(env, assigned, memberKeys, protectedNames, limit);
  // products/materials — canonical tablo TEK: `products`, ayrım `kind` kolonunda (bkz.
  // migrations/0022_id_first_entities.sql). Doğal anahtar legacy_key'dir; yoksa slug kullanılır
  // (findCanonicalRowByNaturalKey ikisini de tanır, bkz. src/lib/canonicalSync.js).
  const kind = typeKey === 'products' ? 'product' : 'material';
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.title, p.slug, p.legacy_key, COALESCE(o.name, p.brand_name_raw) AS brand
     FROM products p LEFT JOIN offices o ON o.id = p.brand_office_id
     WHERE p.kind = ? AND p.hidden_at IS NULL AND p.deleted_at IS NULL ORDER BY p.id`
  ).bind(kind).all();
  const out = [];
  for (const row of results || []) {
    const brandFolded = foldTr(row.brand || '');
    if (brandFolded && assigned.offices.has(brandFolded)) continue;
    // Korunan bir markanın ürünleri de korunur: firma canlı kalırken ürün kataloğunun tamamen
    // arşivlenmesi profili yarım gösterirdi.
    if (brandFolded && protectedNames.offices.has(brandFolded)) continue;
    // ÜYE YÜKLEMESİ ARTIK TEK BAŞINA YETMEZ (kullanıcı isteği, 2026-09-10: "herhangi bir marka
    // profilini sahiplenmediyse bu markaların ürünlerini de projeleri blurladığın gibi blurla").
    // Projelerdeki AYNI daraltma: telif sorumluluğunu üstlenen bir taraf yoksa (markanın onaylı bir
    // sahibi yoksa) ürün önizlemede kalır — bir üyenin ÜÇÜNCÜ TARAF ürününü yüklemiş olması o ürünü
    // yayında tutmak için gerekçe değildir.
    out.push({ key: row.legacy_key || row.slug, name: row.title });
    if (limit && out.length >= limit) break;
  }
  return out.filter(r => !!r.key);
}

// Tek kaydı arşivler. Projeler AYRI bir fonksiyona gider (runProjectAction) — project_submissions'ın
// alan kümesi ve claimed_slug semantiği architects/offices'tan farklıdır.
//
// skipFacets: proje arşivlemek `bumpFacetCounts('projects')`i tetikler ve o, TÜM aktif proje
// havuzunu çekip facet_counts tablosunu baştan yazar (bkz. src/lib/facetCounts.js#
// recomputeProjectFacets). Bu, tek bir admin işlemi için doğru ama 1.700 projelik toplu bir turda
// 1.700 kez tam havuz taraması demek — kabul edilemez. Toplu yolda atlanır, parti sonunda bir kez
// çalıştırılır; sonuç aynı, maliyet parti başına tek sefere iner.
async function archiveOne(env, user, typeKey, key) {
  if (typeKey === 'projects') return runProjectAction(env, user, { action: 'archive', slug: key, skipFacets: true });
  return runContentAction(env, user, { type: typeKey, action: 'archive', key });
}

// GET /api/admin/unassigned-archive — her tip için kaç kayıt arşivlenecek (ÖNİZLEME, hiçbir şeyi
// değiştirmez). Marka/Firma ayrımı office-kind.js ile yapılır: ikisi de `offices` tablosundadır,
// ekranda ayrı sayılır ki admin ne kadarının marka olduğunu görsün.
async function previewUnassigned(env) {
  const assigned = await fetchAssignedNames(env);
  const counts = {};
  const protectedNames = await fetchProtectedNames(env);
  for (const typeKey of TYPES) {
    const memberKeys = await fetchMemberOwnedKeys(env, typeKey);
    const rows = await findUnassigned(env, typeKey, assigned, memberKeys, protectedNames, 0);
    if (typeKey === 'offices') {
      counts.offices = rows.filter(r => !isBrandOffice(r.cats, 0)).length;
      counts.brands = rows.filter(r => isBrandOffice(r.cats, 0)).length;
    } else {
      counts[typeKey] = rows.length;
    }
  }
  counts.total = TYPES.reduce((sum, t) => sum + (t === 'offices' ? counts.offices + counts.brands : counts[t]), 0);
  return json({ counts });
}

// POST /api/admin/unassigned-archive  body: {type, limit}
// En fazla `limit` (üst sınır MAX_BATCH) kaydı arşivler, kalan sayıyı döner.
async function archiveUnassignedBatch(request, env, user) {
  const body = await readJson(request);
  const typeKey = (body.type || '').trim();
  if (!TYPES.includes(typeKey)) return errorJson('Geçersiz tip.');
  const limit = Math.min(MAX_BATCH, Math.max(1, parseInt(body.limit, 10) || MAX_BATCH));

  const assigned = await fetchAssignedNames(env);
  const protectedNames = await fetchProtectedNames(env);
  const memberKeys = await fetchMemberOwnedKeys(env, typeKey);
  const all = await findUnassigned(env, typeKey, assigned, memberKeys, protectedNames, 0);
  const batch = all.slice(0, limit);

  const errors = [];
  let archived = 0;
  for (const row of batch) {
    try {
      const res = await archiveOne(env, user, typeKey, row.key);
      if (res && res.status >= 400) errors.push({ key: row.key, status: res.status });
      else archived++;
    } catch (err) {
      errors.push({ key: row.key, reason: (err && err.message) || String(err) });
    }
  }
  // Proje facet sayaçları parti başına TEK kez (bkz. archiveOne#skipFacets gerekçesi).
  if (typeKey === 'projects' && archived) await bumpFacetCounts(env, 'projects');
  // runContentAction her kayıt için ayrıca invalidatePublicCache çağırıyor; parti sonunda bir kez
  // daha çağırmak ucuz ve son durumu garanti eder (bkz. o dosyadaki AYNI çağrı).
  await invalidatePublicCache(env);
  return json({ archived, remaining: Math.max(0, all.length - archived), errors: errors.slice(0, 10) });
}

// Betik girişi (bkz. UNASSIGNED_TYPES yorumu): tek tipin TÜM atanmamış kayıtlarını döner.
export async function findUnassignedForScript(env, typeKey) {
  if (!TYPES.includes(typeKey)) throw new Error(`Geçersiz tip: ${typeKey}`);
  const assigned = await fetchAssignedNames(env);
  const protectedNames = await fetchProtectedNames(env);
  const memberKeys = await fetchMemberOwnedKeys(env, typeKey);
  return findUnassigned(env, typeKey, assigned, memberKeys, protectedNames, 0);
}

// YANLIŞLIKLA ARŞİVLENMİŞ KORUNAN KAYITLAR — koruma kuralı arşivleme BAŞLADIKTAN sonra eklendiği
// için (kullanıcı isteği ikinci turda geldi) o ana kadar arşivlenmiş korunan kayıtların geri
// alınması gerekir. Yayına alma işini yine runContentAction 'publish' yapar; taslak canonical
// satırdan üretildiği ve syncOffice/syncArchitect'in claimed dalı YALNIZCA dolu alanları yazdığı
// için bu tur kayıpsızdır (cover_url/social_links gibi copyFields DIŞINDAKİ kolonlara dokunulmaz).
export async function findArchivedProtected(env, typeKey) {
  if (typeKey !== 'architects' && typeKey !== 'offices') throw new Error(`Bu tip korunmuyor: ${typeKey}`);
  const protectedNames = await fetchProtectedNames(env);
  const pool = typeKey === 'architects' ? protectedNames.architects : protectedNames.offices;
  const { results } = await env.DB.prepare(
    `SELECT id, name, claimed_profile_key FROM ${SUBMISSION_TABLE[typeKey]} WHERE status = 'archived'`
  ).all();
  return (results || []).filter(r => pool.has(foldTr(r.claimed_profile_key || r.name || '')));
}

export async function handleUnassignedArchiveAdmin(request, env, user) {
  if (request.method === 'GET') return previewUnassigned(env);
  if (request.method === 'POST') return archiveUnassignedBatch(request, env, user);
  return errorJson('Bulunamadı', 404);
}
