// Arşivim — kullanıcının kendi arşivindeki (yayından çekilmiş) içerikleri LİSTELEYEN uç.
//
// KULLANICI İSTEĞİ (2026-09-10):
//   madde 2: "Hesabım sayfasında açılır kapanır buton olarak tek satırı kaplayacak şekilde Arşivim
//             kutusu yap ... Kişiler telif sorumluluğunu kabul etmeden arşivden projeleri yayına
//             alamayacaklar."
//   madde 3/5: "... arşive taşınan tüm içerikler, eğer bir firmaya bir kullanıcı atanırsa o
//             kullanıcının hesabım sayfasındaki arşiv kutusunda gözüksünler."
//   madde 4: "... her içerik için ayrı ayrı olarak kendi düzenle sayfasından bu butona tıklayarak
//             içeriği yayınlasın."
//
// BU DOSYA YAYINLAMAZ. Madde 4 gereği yayına alma YALNIZCA içeriğin kendi düzenleme sayfasından
// olur: kullanıcı "Düzenle ve Yayına Al" ile *-ekle.html?edit=<taslak>'a gider, bilgileri kontrol
// eder, Telif ve Sorumluluk Beyanı'nı onaylar ve kaydeder — kaydetme arşiv taslağını 'approved'a
// çevirip canonical satırı yeniden yayına alır (bkz. src/routes/submissions.js#updateOwnSubmission
// ve unhideIfClaimedApproved). Buradaki tek-tık "Yayına Al" ucu bilerek KALDIRILDI ki içerik
// görülmeden yayınlanabilen ikinci bir yol kalmasın.
//
// "ARŞİV" BU DEPODA NE DEMEK (yeni bir kavram DEĞİL): bir *_submissions satırının status='archived'
// olması + canonical satırın hidden_at ile canlıdan çekilmesi (bkz. src/routes/legacyContent.js#
// runProjectAction/runContentAction).
//
// SAHİPLİK: bir arşiv satırı kullanıcının kutusunda İKİ ayrı yoldan görünebilir —
//   1) satırın owner_user_id'si kullanıcının kendisi (kendi gönderisi ya da kendi arşivlediği kayıt),
//   2) satır bir profile bağlı (claimed_profile_key / claimed_slug / ürünlerde marka adı) ve
//      kullanıcının o profile ONAYLI bir profile_claims ataması var — madde 3'ün asıl senaryosu:
//      admin bir firmayı bir kullanıcıya atadığı ANDA o firmanın arşivdeki kaydı kullanıcının
//      kutusunda belirir. Yetki her istekte CANLI okunur (atama geri alınırsa erişim de gider,
//      bkz. src/routes/legacyContent.js#canDeleteOrModerateProject'teki AYNI gerekçe).
//   3) PROJE ve ÜRÜN/MALZEME satırlarında firma/marka ÜYELİĞİ yeter (kullanıcı isteği, 2026-09-11:
//      "Kullanıcılar bir projeyi veya ürünü arşivlerlerse o firma ya da markaya ait tüm kullanıcıların
//      hesabım sayfalarındaki arşivim bölümünde bu proje ya da ürün arşiv olarak gözüksünler.") —
//      görev fark etmeksizin. Görmek yayına alma yetkisi VERMEZ: "Düzenle ve Yayına Al" yalnızca
//      düzenleme yetkisi olana gösterilir (bkz. fetchApprovedClaimKeys ve shapeRow).
import { json, errorJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { parseSubmissionRow } from '../lib/submissionTypes.js';
import { OFFICE_EDIT_POSITIONS } from '../lib/projectClaimAccess.js';
import { foldTr } from '../lib/textMatch.js';
import officeKindJs from '../../office-kind.js';
import { notArchivedIfCanonicalLiveSql } from '../lib/archiveSync.js';

const { isBrandOffice } = officeKindJs;

// Kutudaki filtre butonlarıyla (Tümü/Proje/Kişi/Firma/Ürün/Marka) BİREBİR eşleşen etiketler.
// 'brand' ayrı bir gönderi TİPİ değildir — offices gönderilerinin marka olanlarıdır (bkz.
// src/routes/submissions.js#listMine'daki AYNI ayrım ve office-kind.js).
const TYPE_TO_TABLE = {
  projects: 'project_submissions',
  architects: 'architect_submissions',
  offices: 'office_submissions',
  products: 'product_submissions',
  materials: 'material_submissions',
};

const CLAIMED_COLUMN = { projects: 'claimed_slug', architects: 'claimed_profile_key', offices: 'claimed_profile_key' };

// Kullanıcının ONAYLI profil atamaları — hem listeleme (hangi arşiv satırları görünmeli) hem
// "Düzenle ve Yayına Al" (yetki var mı) tek bir okumadan beslenir. İKİ ayrı firma listesi döner:
//
//   offices       — DÜZENLEME yetkili firma atamaları. FİRMA ATAMALARINDA GÖREV KISITI (bkz.
//                   src/lib/projectClaimAccess.js#OFFICE_EDIT_POSITIONS ve migrations/0068): bir firma
//                   ataması TEK BAŞINA düzenleme yetkisi vermez — atama ANINDA dondurulmuş
//                   office_position'ın yetkili görevlerden biri olması gerekir. Firmanın/markanın KENDİ
//                   profil arşivi yalnızca bu listeyle görünür.
//   memberOffices — firmaya/markaya kayıtlı TÜM üyelikler (görev fark etmeksizin) + firmanın
//                   claimed_by_user_id sahibi. KULLANICI İSTEĞİ (2026-09-11): "Kullanıcılar bir projeyi
//                   veya ürünü arşivlerlerse o firma ya da markaya ait tüm kullanıcıların hesabım
//                   sayfalarındaki arşivim bölümünde bu proje ya da ürün arşiv olarak gözüksünler."
//                   Üyelik tanımı firma mesajlarıyla BİREBİR aynıdır (bkz. src/routes/messages.js#
//                   resolveOfficeMembers) — "firmaya ait kullanıcı" sitede tek bir anlama gelsin.
//
// Kişi (architect) atamalarında görev kısıtı yoktur — sitedeki diğer üç yetki yolu da AYNI ayrımı yapar.
async function fetchApprovedClaimKeys(env, user) {
  const [{ results }, { results: ownedOffices }] = await Promise.all([
    env.DB.prepare(
      `SELECT profile_type, profile_key, office_position FROM profile_claims WHERE user_id = ? AND status = 'approved'`
    ).bind(user.id).all(),
    env.DB.prepare(
      `SELECT name FROM offices WHERE claimed_by_user_id = ? AND deleted_at IS NULL`
    ).bind(user.id).all(),
  ]);
  const architects = [];
  const offices = [];
  const members = new Set();
  for (const r of results || []) {
    if (r.profile_type === 'architect') architects.push(r.profile_key);
    else if (r.profile_type === 'office') {
      members.add(r.profile_key);
      if (OFFICE_EDIT_POSITIONS.has(r.office_position)) offices.push(r.profile_key);
    }
  }
  for (const r of ownedOffices || []) if (r.name) members.add(r.name);
  return { architects, offices, memberOffices: [...members] };
}

// SQLite ifade-ağacı derinlik sınırı (bkz. [[project_sqlite_expression_tree_depth_100]]): `A OR B OR
// ...` zinciri yerine DÜZ bir IN (...) listesi kullanılır. Boş liste `IN ()` SÖZDİZİMİ HATASIDIR —
// o durumda koşul hiç eşleşmeyen `(NULL)` listesine düşer.
function inClause(values) {
  return values.length ? values.map(() => '?').join(', ') : 'NULL';
}

// Arşiv satırının bağlı olduğu canonical projeyi kullanıcının atamalarına project_designers üzerinden,
// TEK sorguda ve TERS yönden (atamadan projeye) bağlar. GERÇEK BULGU (ilk uygulama): arşivdeki TÜM
// projeler çekilip her biri için ayrı ayrı canUserEditProjectBySlug çağrılıyordu — proje başına 3+ D1
// sorgusu, yüzlerce satırda kabul edilemez. Yetki kuralı aynıdır çünkü canUserEditProjectBySlug de
// tam olarak bu iki bağa (künyedeki mimar / firma) bakar.
//
// ESKİ HÂLİN İKİ SORUNU (2026-09-11): slug'lar önce ayrı bir sorguda `LIMIT 400` ile çekilip sonra
// IN (...) listesi olarak İKİ KEZ bind ediliyordu — (1) çok projeli bir firmada 400'ün ötesindeki
// arşiv satırları sessizce kayboluyordu, (2) D1'in ifade başına 100 bind parametresi sınırı 50 slug'da
// aşılıyordu. Artık bağ bir alt sorgudur, bind edilen yalnızca (her zaman az sayıda) profil adlarıdır.
function linkedProjectSlugsSql(names) {
  const ph = inClause(names);
  return {
    sql: `SELECT p.slug FROM projects p
          JOIN project_designers pd ON pd.project_id = p.id
          LEFT JOIN architects ar ON ar.id = pd.architect_id AND ar.deleted_at IS NULL
          LEFT JOIN offices ofc ON ofc.id = pd.office_id AND ofc.deleted_at IS NULL
          WHERE p.deleted_at IS NULL AND (ar.name IN (${ph}) OR ofc.name IN (${ph}))`,
    binds: [...names, ...names],
  };
}

// Ürün/malzemenin markasına bağ — canUserEditProductBySlug'daki AYNI iki yol: canonical satırın
// brand_office_id'si (asıl bağ) ya da taslağın serbest metin `brand` alanı (brand_office_id'si boş
// eski kayıtlar; canlıda 2026-09-11 itibarıyla 25 arşiv satırı). Metin eşleşmesi Türkçe casefold'la
// yapılır (bkz. src/lib/textMatch.js#foldTr) ama foldTr SQL'de YOK — bu yüzden arşivdeki farklı
// marka metinleri (canlıda ~40) önce çekilir, casefold burada yapılır ve SQL'e TAM metinler gider.
function brandMatchSql(names, brandTexts) {
  const namePh = inClause(names);
  return {
    sql: `(brand IN (${inClause(brandTexts)}) OR claimed_slug IN (
            SELECT p.slug FROM products p JOIN offices o ON o.id = p.brand_office_id
            WHERE p.deleted_at IS NULL AND o.deleted_at IS NULL AND o.name IN (${namePh})))`,
    binds: [...brandTexts, ...names],
  };
}

async function brandTextsMatching(env, table, names) {
  if (!names.length) return [];
  const wanted = new Set(names.map(foldTr));
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT brand FROM ${table} WHERE status = 'archived' AND brand IS NOT NULL AND brand <> ''`
  ).bind().all();
  return (results || []).map(r => r.brand).filter(b => wanted.has(foldTr(b)));
}

// Her satır `_can_edit` (0/1) taşır: kutuda "Düzenle ve Yayına Al" butonu yalnızca buna göre
// verilir. GÖRÜNÜRLÜK ile YETKİ bu istekle birlikte AYRILDI — firmanın Ekip Üyesi arşivdeki projeyi
// GÖRÜR ama *-ekle.html?edit= onun için 404 döner (bkz. src/routes/submissions.js#
// canAccessSubmissionRow), bu yüzden ona ölü bir buton gösterilmez.
async function fetchArchivedRows(env, user, typeKey, claimKeys) {
  const table = TYPE_TO_TABLE[typeKey];
  const claimedCol = CLAIMED_COLUMN[typeKey];
  // Canonical satırı YAYINDA (blursuz, canlı) olan hiçbir satır arşiv kutusuna girmez — admin
  // panelinin Arşiv sekmesiyle AYNI süzgeç, çünkü ikisi de AYNI status='archived' satırlarını
  // okuyor (kullanıcı bildirimi, 2026-09-12; kök neden ve gerekçe: src/lib/archiveSync.js).
  // Sorgular tabloyu takma adsız seçtiğinden alias olarak tablo adı geçilir.
  const liveGuard = notArchivedIfCanonicalLiveSql(typeKey, table);
  const editNames = [...claimKeys.architects, ...claimKeys.offices];
  const seeNames = [...new Set([...claimKeys.architects, ...claimKeys.memberOffices])];
  if (typeKey === 'projects') {
    // claimed_slug (anahtarla arşivlenen taslak) ya da slug (üyenin kendi gönderisi) — ikisi de
    // canonical projeye giden yollardır (bkz. src/routes/legacyContent.js#runProjectAction).
    const see = linkedProjectSlugsSql(seeNames);
    const edit = linkedProjectSlugsSql(editNames);
    const { results } = await env.DB.prepare(
      `WITH see_slugs AS (${see.sql}), edit_slugs AS (${edit.sql})
       SELECT *, (owner_user_id = ? OR claimed_slug IN (SELECT slug FROM edit_slugs) OR slug IN (SELECT slug FROM edit_slugs)) AS _can_edit
       FROM project_submissions
       WHERE status = 'archived' AND (owner_user_id = ? OR claimed_slug IN (SELECT slug FROM see_slugs) OR slug IN (SELECT slug FROM see_slugs))${liveGuard}
       ORDER BY updated_at DESC LIMIT 500`
    ).bind(...see.binds, ...edit.binds, user.id, user.id).all();
    return results || [];
  }
  if (typeKey === 'products' || typeKey === 'materials') {
    // Ürün/malzeme gönderilerinde claim kolonu YOKTUR (bkz. src/routes/legacyContent.js#
    // CONTENT_ACTION_TYPES) — bir ürünün "sahibi", markasının (offices kaydının) sahibidir; bu,
    // ürün düzenleme yetkisinin zaten var olan kuralıdır (bkz. src/lib/projectClaimAccess.js#
    // canUserEditProductBySlug).
    //
    // GERÇEK BULGU (2026-09-11): eski hâl arşivdeki TÜM ürünleri `LIMIT 500` ile çekip marka
    // filtresini SONRADAN JS'te uyguluyordu — canlıda 692 arşiv ürünü var, yani bir markanın en eski
    // ürünleri kutuya HİÇ gelmiyordu. Filtre artık SQL'de.
    const seeBrands = await brandTextsMatching(env, table, claimKeys.memberOffices);
    const editBrands = seeBrands.filter(b => claimKeys.offices.some(n => foldTr(n) === foldTr(b)));
    const see = brandMatchSql(claimKeys.memberOffices, seeBrands);
    const edit = brandMatchSql(claimKeys.offices, editBrands);
    const { results } = await env.DB.prepare(
      `SELECT *, (owner_user_id = ? OR ${edit.sql}) AS _can_edit FROM ${table}
       WHERE status = 'archived' AND (owner_user_id = ? OR ${see.sql})${liveGuard}
       ORDER BY updated_at DESC LIMIT 500`
    ).bind(user.id, ...edit.binds, user.id, ...see.binds).all();
    return results || [];
  }
  // Kişi/firma/marka PROFİLİNİN kendi arşivi: görünürlük = düzenleme yetkisi (değişmedi).
  const keys = typeKey === 'architects' ? claimKeys.architects : claimKeys.offices;
  const { results } = await env.DB.prepare(
    `SELECT *, 1 AS _can_edit FROM ${table}
     WHERE status = 'archived' AND (owner_user_id = ? OR ${claimedCol} IN (${inClause(keys)}) OR name IN (${inClause(keys)}))${liveGuard}
     ORDER BY updated_at DESC LIMIT 500`
  ).bind(user.id, ...keys, ...keys).all();
  return results || [];
}

// Kutudaki satırın görünen hâli.
//
// TEK EYLEM: "Düzenle ve Yayına Al" (kullanıcı isteği, 2026-09-10 madde 4) — kutunun içinde tek
// tıkla yayına alma KALDIRILDI; kullanıcı önce içeriğin kendi düzenleme sayfasına gider, bilgileri
// kontrol eder, oradaki Telif ve Sorumluluk Beyanı'nı onaylayıp kaydeder. Kaydetme, arşivlenmiş
// taslağı 'approved'a çevirir ve canonical satırı yeniden yayına alır (bkz. src/routes/
// submissions.js#updateOwnSubmission -> unhideIfClaimedApproved).
//
// editUrl, kullanıcının kaydı DÜZENLEYEBİLDİĞİ her satırda verilir (sahibi olsun olmasın):
// *-ekle.html?edit= yolu atanmış profil üzerinden de açılabiliyor (bkz. src/routes/submissions.js#
// canAccessSubmissionRow). Kaydı yalnızca firma ÜYELİĞİYLE gören kullanıcıda (ör. Ekip Üyesi)
// editUrl null'dır — o sayfa ona 404 döner; kutu butonun yerine kısa bir not gösterir.
//
// Detay bağlantısı BİLEREK verilmez: kayıt arşivde olduğu için canlı sayfası 410 döner (bkz.
// src/lib/seo.js hidden_at filtresi) — kullanıcıyı ölü bir bağlantıya göndermenin anlamı yok.
function shapeRow(typeKey, rawRow, owned) {
  const { _can_edit: canEditFlag, ...row } = rawRow;
  const canEdit = !!owned || !!canEditFlag;
  const item = parseSubmissionRow(typeKey, row);
  const base = { type: typeKey, id: row.id, archivedAt: row.updated_at || row.created_at, owned: !!owned, canEdit };
  const editUrlFor = (page, stype) => (canEdit ? `${page}?edit=${encodeURIComponent(row.id)}&stype=${stype}` : null);
  if (typeKey === 'projects') {
    return { ...base, kind: 'project', title: item.title || '—',
      subtitle: [item.location, item.date].filter(Boolean).join(' · '),
      image: (item.images && item.images[0]) || null,
      editUrl: editUrlFor('/proje-ekle', 'projects') };
  }
  if (typeKey === 'architects') {
    return { ...base, kind: 'architect', title: item.name || '—',
      subtitle: [item.profession, item.office].filter(Boolean).join(' · '),
      image: item.photo_url || null,
      editUrl: editUrlFor('/kisi-ekle', 'architects') };
  }
  if (typeKey === 'offices') {
    const brand = isBrandOffice(item.cats, 0);
    return { ...base, kind: brand ? 'brand' : 'office', title: item.name || '—',
      subtitle: [item.loc, item.cats].filter(Boolean).join(' · '),
      image: item.logo_url || null,
      editUrl: editUrlFor(brand ? '/marka-ekle' : '/firma-ekle', 'offices') };
  }
  return { ...base, kind: 'product', title: item.title || '—',
    subtitle: [item.brand, item.category].filter(Boolean).join(' · '),
    image: (item.images && item.images[0]) || null,
    editUrl: editUrlFor('/urun-ekle', typeKey) };
}

async function listMineArchive(env, user) {
  const claimKeys = await fetchApprovedClaimKeys(env, user);
  const types = Object.keys(TYPE_TO_TABLE);
  const lists = await Promise.all(types.map(t => fetchArchivedRows(env, user, t, claimKeys)));
  const items = [];
  types.forEach((t, i) => lists[i].forEach(row => items.push(shapeRow(t, row, row.owner_user_id === user.id))));
  items.sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
  return json({ items });
}

export async function handleArchiveRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "archive", ...]
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);
  if (segments.length === 3 && segments[2] === 'mine' && request.method === 'GET') return listMineArchive(env, user);
  // POST /api/archive/publish KALDIRILDI (kullanıcı isteği, 2026-09-10 madde 4): arşivden yayına
  // alma artık YALNIZCA içeriğin kendi düzenleme sayfasından, telif beyanı onaylanarak yapılır —
  // kullanıcı içeriği görmeden yayınlayamasın diye. Kapıyı ikiye bölmemek için ikinci yol kapatıldı.
  return errorJson('Bulunamadı', 404);
}
