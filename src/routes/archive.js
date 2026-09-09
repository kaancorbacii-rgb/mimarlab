// Arşivim — kullanıcının kendi arşivindeki (yayından çekilmiş) içerikleri listeleyip, Telif ve
// Sorumluluk Beyanı'nı onaylayarak tekrar yayına almasını sağlayan uçlar.
//
// KULLANICI İSTEĞİ (2026-09-10):
//   madde 2: "Hesabım sayfasında açılır kapanır buton olarak tek satırı kaplayacak şekilde Arşivim
//             kutusu yap ... Kişiler telif sorumluluğunu kabul etmeden arşivden projeleri yayına
//             alamayacaklar."
//   madde 3: "... arşive taşınan tüm içerikler, eğer bir firmaya bir kullanıcı atanırsa o
//             kullanıcının hesabım sayfasındaki arşiv kutusunda gözüksünler. Eğer kullanıcı telif
//             metnini kabul ederse içerik tekrar canlıya alınsın."
//
// "ARŞİV" BU DEPODA NE DEMEK (yeni bir kavram DEĞİL): bir *_submissions satırının status='archived'
// olması + canonical satırın hidden_at ile canlıdan çekilmesi (bkz. src/routes/legacyContent.js#
// runProjectAction/runContentAction). Bu uçlar o mekanizmayı hiç değiştirmez, yalnızca ÜYE
// TARAFINDAN görünür ve kullanılabilir hale getirir — yayına alma işini yine AYNI runProjectAction/
// runContentAction 'publish' dalı yapar, böylece arşiv anlık görüntüsü, facet sayaçları ve cache
// temizliği admin panelindekiyle BİREBİR aynı olur.
//
// SAHİPLİK: bir arşiv satırı kullanıcının kutusunda İKİ ayrı yoldan görünebilir —
//   1) satırın owner_user_id'si kullanıcının kendisi (kendi gönderisi ya da kendi arşivlediği kayıt),
//   2) satır bir profile bağlı (claimed_profile_key / claimed_slug / ürünlerde marka adı) ve
//      kullanıcının o profile ONAYLI bir profile_claims ataması var — madde 3'ün asıl senaryosu:
//      admin bir firmayı bir kullanıcıya atadığı ANDA o firmanın arşivdeki kaydı kullanıcının
//      kutusunda belirir. Yetki her istekte CANLI okunur (atama geri alınırsa erişim de gider,
//      bkz. src/routes/legacyContent.js#canDeleteOrModerateProject'teki AYNI gerekçe).
import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { requireRightsAcceptance, recordRightsAcceptance } from '../lib/rightsConsent.js';
import { runProjectAction, runContentAction } from './legacyContent.js';
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

// Kutudaki satırın görünen hâli. İKİ bağlantı BİLEREK verilmez:
//   * Detay: kayıt arşivde olduğu için canlı sayfası 410 döner (bkz. src/lib/seo.js hidden_at
//     filtresi) — kullanıcıyı ölü bir bağlantıya göndermenin anlamı yok.
//   * Düzenle: YALNIZCA taslağın gerçek sahibine gösterilir (`owned`). GERÇEK BULGU: toplu
//     arşivlemenin (bkz. src/routes/unassignedArchive.js) ürettiği taslakların owner_user_id'si
//     ADMIN'dir; *-ekle.html?edit= yolu ise src/routes/submissions.js#getOwnSubmission ile
//     korunuyor ve sahibi olmayan bir kullanıcıya 404 döner. Atama üzerinden gelen kullanıcıya
//     çalışmayan bir "Düzenle" linki göstermek yerine yalnızca "Yayına Al" sunulur — kayıt yayına
//     döndüğü anda profilin kendi Düzenle yolları (?claim=) zaten açılır.
function shapeRow(typeKey, row, owned) {
  const item = parseSubmissionRow(typeKey, row);
  const base = { type: typeKey, id: row.id, archivedAt: row.updated_at || row.created_at, owned: !!owned };
  const editUrlFor = (page, stype) => (owned ? `${page}?edit=${encodeURIComponent(row.id)}&stype=${stype}` : null);
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

// Yayına alma yetkisi — listeleme kuralının TEKİL karşılığı. Listede görünmeyen bir id'ye POST
// atılabileceği için (istemci kontrolü tek başına güvenlik sağlamaz) burada yeniden doğrulanır.
async function canPublish(env, user, typeKey, row, claimKeys) {
  if (user.role === 'admin') return true;
  if (row.owner_user_id && row.owner_user_id === user.id) return true;
  if (typeKey === 'projects') {
    const slug = row.claimed_slug || row.slug;
    if (!slug) return false;
    const slugs = await fetchClaimedProjectSlugs(env, claimKeys);
    return slugs.includes(slug);
  }
  if (typeKey === 'products' || typeKey === 'materials') {
    if (!row.brand) return false;
    return claimKeys.offices.some(k => foldTr(k) === foldTr(row.brand));
  }
  const keys = typeKey === 'architects' ? claimKeys.architects : claimKeys.offices;
  const folded = new Set(keys.map(foldTr));
  return folded.has(foldTr(row[CLAIMED_COLUMN[typeKey]] || '')) || folded.has(foldTr(row.name || ''));
}

// POST /api/archive/publish  body: {type, id, rightsAccepted, rightsTextVersion}
async function publishFromArchive(request, env, user) {
  const body = await readJson(request);
  const typeKey = (body.type || '').trim();
  const id = (body.id || '').trim();
  if (!TYPE_TO_TABLE[typeKey] || !id) return errorJson('Geçersiz istek.');
  // Telif ve Sorumluluk Beyanı — kullanıcı isteği madde 2/3'ün ASIL kapısı: onay olmadan hiçbir
  // arşiv kaydı canlıya dönemez.
  const rightsErr = requireRightsAcceptance(body);
  if (rightsErr) return rightsErr;

  const row = await env.DB.prepare(`SELECT * FROM ${TYPE_TO_TABLE[typeKey]} WHERE id = ?`).bind(id).first();
  if (!row) return errorJson('Bulunamadı.', 404);
  if (row.status !== 'archived') return errorJson('Bu kayıt arşivde değil.');
  const claimKeys = await fetchApprovedClaimKeys(env, user);
  if (!(await canPublish(env, user, typeKey, row, claimKeys))) {
    return errorJson('Bu içeriği yayına alma yetkin yok.', 403);
  }

  const contentKey = typeKey === 'projects'
    ? (row.claimed_slug || row.slug)
    : (row.claimed_profile_key || row.name || row.title || null);
  await recordRightsAcceptance(env, user, {
    contentType: typeKey, contentKey, submissionId: id, source: 'archive-publish',
  });

  // Yayına alma İŞİNİ admin panelinin kullandığı AYNI fonksiyon yapar (bkz. dosya başı yorum) —
  // burada ikinci bir kopya YAZILMAZ. Bu iki fonksiyon kendi başlarına yetki kontrolü yapmaz
  // (bkz. o dosyadaki uyarı), yetki yukarıda zaten doğrulandı.
  const res = typeKey === 'projects'
    ? await runProjectAction(env, user, { action: 'publish', id })
    : await runContentAction(env, user, { type: typeKey, action: 'publish', id });
  return res;
}

export async function handleArchiveRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "archive", ...]
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);
  if (segments.length === 3 && segments[2] === 'mine' && request.method === 'GET') return listMineArchive(env, user);
  if (segments.length === 3 && segments[2] === 'publish' && request.method === 'POST') return publishFromArchive(request, env, user);
  return errorJson('Bulunamadı', 404);
}
