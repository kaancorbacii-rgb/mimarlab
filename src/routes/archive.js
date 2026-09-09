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
import { json, errorJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { parseSubmissionRow } from '../lib/submissionTypes.js';
import { OFFICE_EDIT_POSITIONS } from '../lib/projectClaimAccess.js';
import { foldTr } from '../lib/textMatch.js';
import officeKindJs from '../../office-kind.js';

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
// yayına alma (yetki var mı) tek bir okumadan beslenir.
// FİRMA ATAMALARINDA GÖREV KISITI (bkz. src/lib/projectClaimAccess.js#OFFICE_EDIT_POSITIONS ve
// migrations/0068): bir firma ataması TEK BAŞINA düzenleme yetkisi vermez — atama ANINDA dondurulmuş
// office_position'ın yetkili görevlerden biri olması gerekir (Ekip Üyesi bir firmanın profilini
// düzenleyemez, dolayısıyla arşivden yayına da alamaz). Kişi (architect) atamalarında görev kısıtı
// yoktur — sitedeki diğer üç yetki yolu da AYNI ayrımı yapar.
async function fetchApprovedClaimKeys(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT profile_type, profile_key, office_position FROM profile_claims WHERE user_id = ? AND status = 'approved'`
  ).bind(user.id).all();
  const architects = [];
  const offices = [];
  for (const r of results || []) {
    if (r.profile_type === 'architect') architects.push(r.profile_key);
    else if (r.profile_type === 'office' && OFFICE_EDIT_POSITIONS.has(r.office_position)) offices.push(r.profile_key);
  }
  return { architects, offices };
}

// Kullanıcının onaylı atamalarına (mimar ya da firma) project_designers üzerinden bağlı projelerin
// slug'ları. GERÇEK BULGU (ilk uygulama): arşivdeki TÜM projeler çekilip her biri için ayrı ayrı
// canUserEditProjectBySlug çağrılıyordu — proje başına 3+ D1 sorgusu, yüzlerce satırda kabul
// edilemez. Bağ TEK sorguda, ters yönden (atamadan projeye) çözülür; yetki kuralı aynıdır çünkü
// canUserEditProjectBySlug de tam olarak bu iki bağa bakar (ve firma tarafındaki görev kısıtı
// yukarıda, fetchApprovedClaimKeys'te zaten uygulandı).
const CLAIMED_PROJECT_SLUG_LIMIT = 400;

async function fetchClaimedProjectSlugs(env, claimKeys) {
  const names = [...claimKeys.architects, ...claimKeys.offices];
  if (!names.length) return [];
  const ph = names.map(() => '?').join(', ');
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT p.slug AS slug FROM projects p
     JOIN project_designers pd ON pd.project_id = p.id
     LEFT JOIN architects ar ON ar.id = pd.architect_id AND ar.deleted_at IS NULL
     LEFT JOIN offices ofc ON ofc.id = pd.office_id AND ofc.deleted_at IS NULL
     WHERE p.deleted_at IS NULL AND (ar.name IN (${ph}) OR ofc.name IN (${ph}))
     LIMIT ${CLAIMED_PROJECT_SLUG_LIMIT}`
  ).bind(...names, ...names).all();
  return (results || []).map(r => r.slug).filter(Boolean);
}

// SQLite ifade-ağacı derinlik sınırı (bkz. [[project_sqlite_expression_tree_depth_100]]): `A OR B OR
// ...` zinciri yerine DÜZ bir IN (...) listesi kullanılır. Onaylı atama sayısı her zaman küçüktür
// (canlıda 34) ama kural yine de korunur.
function inClause(values) {
  return values.map(() => '?').join(', ');
}

async function fetchArchivedRows(env, user, typeKey, claimKeys) {
  const table = TYPE_TO_TABLE[typeKey];
  const claimedCol = CLAIMED_COLUMN[typeKey];
  const keys = typeKey === 'architects' ? claimKeys.architects : typeKey === 'offices' ? claimKeys.offices : [];
  // projects: claimed_slug bir SLUG'tır, profile_key ise bir İSİM — ikisi doğrudan karşılaştırılamaz,
  // bu yüzden proje satırlarında sahiplik owner_user_id ile alınır ve künye üzerinden gelen yetki
  // aşağıda canUserEditProjectBySlug ile satır satır doğrulanır (o fonksiyon zaten künyedeki
  // mimar/firma atamalarını okuyor, bkz. src/lib/projectClaimAccess.js).
  if (typeKey === 'projects') {
    const slugs = await fetchClaimedProjectSlugs(env, claimKeys);
    const where = slugs.length
      ? `status = 'archived' AND (owner_user_id = ? OR claimed_slug IN (${inClause(slugs)}) OR slug IN (${inClause(slugs)}))`
      : `status = 'archived' AND owner_user_id = ?`;
    const binds = slugs.length ? [user.id, ...slugs, ...slugs] : [user.id];
    const { results } = await env.DB.prepare(
      `SELECT * FROM project_submissions WHERE ${where} ORDER BY updated_at DESC LIMIT 500`
    ).bind(...binds).all();
    return results || [];
  }
  if (typeKey === 'products' || typeKey === 'materials') {
    // Ürün/malzeme gönderilerinde claim kolonu YOKTUR (bkz. src/routes/legacyContent.js#
    // CONTENT_ACTION_TYPES) — bir ürünün "sahibi", markasının (offices kaydının) sahibidir; bu,
    // ürün düzenleme yetkisinin zaten var olan kuralıdır (bkz. src/lib/projectClaimAccess.js#
    // canUserEditProductBySlug). Marka adı serbest metin olduğundan karşılaştırma Türkçe casefold
    // ile yapılır (bkz. src/lib/textMatch.js#foldTr).
    const { results } = await env.DB.prepare(
      `SELECT * FROM ${table} WHERE status = 'archived' ORDER BY updated_at DESC LIMIT 500`
    ).bind().all();
    const brandSet = new Set(claimKeys.offices.map(foldTr));
    return (results || []).filter(row => row.owner_user_id === user.id || (row.brand && brandSet.has(foldTr(row.brand))));
  }
  const where = keys.length
    ? `status = 'archived' AND (owner_user_id = ? OR ${claimedCol} IN (${inClause(keys)}) OR name IN (${inClause(keys)}))`
    : `status = 'archived' AND owner_user_id = ?`;
  const binds = keys.length ? [user.id, ...keys, ...keys] : [user.id];
  const { results } = await env.DB.prepare(
    `SELECT * FROM ${table} WHERE ${where} ORDER BY updated_at DESC LIMIT 500`
  ).bind(...binds).all();
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
// editUrl HER kayıt için verilir (sahibi olsun olmasın): *-ekle.html?edit= yolu artık atanmış
// profil üzerinden de açılabiliyor (bkz. src/routes/submissions.js#canAccessSubmissionRow).
//
// Detay bağlantısı BİLEREK verilmez: kayıt arşivde olduğu için canlı sayfası 410 döner (bkz.
// src/lib/seo.js hidden_at filtresi) — kullanıcıyı ölü bir bağlantıya göndermenin anlamı yok.
function shapeRow(typeKey, row, owned) {
  const item = parseSubmissionRow(typeKey, row);
  const base = { type: typeKey, id: row.id, archivedAt: row.updated_at || row.created_at, owned: !!owned };
  const editUrlFor = (page, stype) => `${page}?edit=${encodeURIComponent(row.id)}&stype=${stype}`;
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
