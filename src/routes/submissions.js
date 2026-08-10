import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { SUBMISSION_TYPES, normalizeSubmission, parseSubmissionRow, validateRequired, findInvalidUrlField, findInvalidSocialPlatform } from '../lib/submissionTypes.js';
import { invalidatePublicCache } from '../lib/publicCache.js';
import { purgeSsrDetailCache, ssrPurgeTargetFor } from '../lib/ssrCache.js';
import { cascadeRemovedFounders, renameOfficeEverywhere, renameArchitectEverywhere } from '../lib/officeFounderCascade.js';
import { setLegacyHidden } from './legacyContent.js';
import { syncApprovedSubmissionToCanonical, hideCanonicalForUnapprovedSubmission } from '../lib/canonicalSync.js';
import { bumpFacetCounts } from '../lib/facetCounts.js';
import { canonicalRowExistsByKey } from '../lib/canonicalRead.js';

const CANONICAL_TYPES = new Set(['architects', 'offices', 'projects']);
const FACET_TYPES = new Set(['projects']);
// data.js/projeler-data.js BİLEREK burada YOK — Legacy Bundle Elimination Faz 2 (bkz. kullanıcı
// isteği): claimed_profile_key/claimed_slug doğrulaması artık doğrudan canonical D1 (architects/
// offices/projects) tablolarından okunuyor, src/lib/seo.js'in Faz 1'de zaten yaptığı AYNI geçiş
// (o dosyada da "statik dizide ara, yoksa D1'e bak" ikili deseni kaldırılmıştı — Faz 2'nin
// migrate-to-id-first.js script'i her statik kaydı canonical bir satıra taşıdığından statik dizi
// artık D1'in KESİN bir alt kümesi, ayrı bir statik kontrole gerek yok).

const TYPE_BY_PATH = { offices: 'offices', projects: 'projects', architects: 'architects' };

// architects/offices gönderileri, claimed_profile_key doluysa yeni bir kayıt değil, o kullanıcının
// onaylı bir profile_claims kaydına sahip olduğu STATİK bir profile (architects[]/offices[].name)
// yapılan bir düzenleme talebidir — sahtecilik olmasın diye onay kontrolü burada yapılır.
const CLAIM_PROFILE_TYPE = { architects: 'architect', offices: 'office' };

// bkz. src/routes/public.js#CLAIMED_COLUMN_BY_TYPE (aynı eşleme) — bir statik kaydı admin panelinden
// arşivleyip (bkz. src/routes/legacyContent.js#handleContentAction/handleProjectAction) sonra bu
// GENEL uç noktadan (Admin Arşiv sekmesindeki özel "Yayınla" butonu DIŞINDA, ör. proje-ekle.html/
// mimar-ekle.html/firma-ekle.html'in normal ?claim= düzenleme formundan) tekrar onaylarsak, aşağıdaki
// unhideIfClaimedApproved çağrısı olmadan satır 'approved' olur ama statik kayıt legacy_content_hidden
// içinde gizli KALIRDI — canlıda ne overlay ne statik hali görünmeyen, veritabanında "onaylı" ama
// sitede hiç var olmayan bir kayıt (gerçek bulgu: GAD Architecture'ı arşivleyip normal formdan
// düzenleyince firma sitede tamamen kayboluyordu, admin panelinde her şey normal görünüyordu).
const CLAIMED_COLUMN_BY_TYPE = { architects: 'claimed_profile_key', offices: 'claimed_profile_key', projects: 'claimed_slug' };

// Admin'in claimed_profile_key'den FARKLI bir isim gönderebildiği (bkz. aşağıdaki istisnalar) ve
// buna bağlı olarak bir yeniden adlandırma cascade'i tetiklenen tipler — mimar ve firma (bkz.
// kullanıcı isteği: "Admin hesabına ... Mimar düzenle sayfasından Mimar ismi değiştirebilme yetkisi
// ver", önceki istek: "Admin hesabına tüm firma isimlerini değişebilme yetkisi ver").
const RENAME_CASCADE_BY_TYPE = { offices: renameOfficeEverywhere, architects: renameArchitectEverywhere };

// office_submissions/architect_submissions.claimed_profile_key HER ZAMAN orijinal statik adı taşır
// (sabit, hiç değişmez — data.js kaydına geri bağlanan anahtar), ama admin bir firmayı/mimarı
// yeniden adlandırdığında (bkz. renameOfficeEverywhere/renameArchitectEverywhere) profile_claims.
// profile_key/legacy_content_hidden.content_key GÜNCEL (yeni) adı taşıyacak şekilde cascade edilir —
// çünkü src/routes/badges.js#handlePublicBadges b.target_key = c.profile_key JOIN'i yapar ve
// badge_requests.target_key de AYNI cascade'le güncel adı taşır; profile_claims'i sabit bırakmak bu
// JOIN'i kırardı. Bu yüzden claimed_profile_key (sabit) ile bu tablolara bakan HER yer, önce bu
// yardımcıyla GÜNCEL adı çözmeli.
const RENAMABLE_TABLE_BY_TYPE = { offices: 'office_submissions', architects: 'architect_submissions' };
async function resolveCurrentProfileName(env, typeKey, claimedProfileKey) {
  const table = RENAMABLE_TABLE_BY_TYPE[typeKey];
  if (!table) return claimedProfileKey;
  const row = await env.DB.prepare(
    `SELECT name FROM ${table} WHERE claimed_profile_key = ? AND status = 'approved' ORDER BY updated_at DESC LIMIT 1`
  ).bind(claimedProfileKey).first();
  return (row && row.name) || claimedProfileKey;
}

async function unhideIfClaimedApproved(env, user, typeKey, status, claimedValue) {
  if (status !== 'approved' || !claimedValue) return;
  const claimedColumn = CLAIMED_COLUMN_BY_TYPE[typeKey];
  if (!claimedColumn) return;
  const key = RENAMABLE_TABLE_BY_TYPE[typeKey] ? await resolveCurrentProfileName(env, typeKey, claimedValue) : claimedValue;
  await setLegacyHidden(env, user, typeKey, key, false);
}

const CANONICAL_TABLE_BY_TYPE = { architects: 'architects', offices: 'offices' };

async function verifyClaimedProfileKey(env, user, typeKey, profileKey) {
  // claimed_profile_key canonical architects/offices satırının adı/slug'ı/legacy_key'iyle birebir
  // eşleşmeli — aksi halde (ör. bir yeniden adlandırma sonrası bayatlamış bir "Düzenle" linki, ya da
  // elle uydurulmuş bir URL ile) hiçbir gerçek profile bağlı olmayan "hayalet" bir gönderi
  // oluşabilirdi (bkz. gerçek bulgu: Han Tümertekin → Tümertekin Architects yeniden
  // adlandırıldıktan SONRA firmanın kendi sayfasındaki "Düzenle" butonu YENİ adı ?claim= olarak
  // kullanmaya devam ediyordu; bu kontrol olmadan bu ikinci gönderi statik kayıttan kopuk, boş bir
  // formla oluşuyor ve kullanıcıya "her şey silindi" gibi görünüyordu). Faz 2'den önce burada önce
  // statik data.js dizisi, orada yoksa canonical D1 aranıyordu (bkz. gerçek bulgu: "Ezgi San" gibi
  // statik dizide hiç yer almayan bağımsız bir mimar profilinin "Düzenle" butonu bu yüzden her zaman
  // reddediliyordu) — artık TEK kaynak canonical D1 (bkz. yukarıdaki import yorumu).
  const canonicalTable = CANONICAL_TABLE_BY_TYPE[typeKey];
  if (canonicalTable && !(await canonicalRowExistsByKey(env, canonicalTable, profileKey))) {
    return errorJson('Bu profil artık bu adla mevcut değil, sayfayı yenileyip tekrar dene.');
  }
  if (user.role === 'admin') return null; // admin, sahiplenmiş olsun olmasın her mimar/marka profilini düzenleyebilir
  const profileType = CLAIM_PROFILE_TYPE[typeKey];
  if (!profileType) return errorJson('Bu tip için profil düzenleme desteklenmiyor.');
  const currentName = RENAMABLE_TABLE_BY_TYPE[typeKey] ? await resolveCurrentProfileName(env, typeKey, profileKey) : profileKey;
  const claim = await env.DB.prepare(
    `SELECT id FROM profile_claims WHERE user_id = ? AND profile_type = ? AND profile_key = ? AND status = 'approved'`
  ).bind(user.id, profileType, currentName).first();
  if (!claim) return errorJson('Bu profili düzenlemek için önce profili sahiplenip onayının geçmesi gerekiyor.', 403);
  return null;
}

// Statik projeler (eskiden projeler-data.js) için mimar/ofis'teki profile_claims'e karşılık gelen
// bir sahiplenme/onay akışı YOK — projelerin bir "sahibi" kavramı yok, bu yüzden bu tamamen admin'e
// özel (bkz. kullanıcı isteği: "admin hesabına tüm projeleri düzenleyebilme yetkisi ver"). Sıradan
// üyeler claimed_slug göndermeye çalışırsa reddedilir.
//
// gerçek bulgu (Faz 2 öncesi): slug'ı SADECE projeler-data.js dizisinde arıyordu — canonical D1
// projects tablosuna taşınmış (bkz. src/lib/canonicalSync.js#syncProject) ya da hiç statik
// karşılığı olmayan D1-özgün bir proje düzenlenmek istendiğinde slug orada asla bulunamadığından
// kayıt her zaman "Böyle bir statik proje bulunamadı" ile reddediliyordu. Artık TEK kaynak
// canonical D1 (bkz. verifyClaimedProfileKey'in dosya başındaki AYNI Faz 2 gerekçesi).
async function verifyClaimedSlug(env, user, slug) {
  if (user.role !== 'admin') return errorJson('Bu işlem için yetkin yok.', 403);
  const canonicalRow = await env.DB.prepare(
    `SELECT id FROM projects WHERE deleted_at IS NULL AND (slug = ? OR legacy_key = ?) LIMIT 1`
  ).bind(slug, slug).first();
  if (!canonicalRow) return errorJson('Bu proje artık bu adla mevcut değil, sayfayı yenileyip tekrar dene.', 404);
  return null;
}

export async function handleSubmissionRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "offices", ...]
  const typeKey = TYPE_BY_PATH[segments[1]];
  if (!typeKey) return errorJson('Bulunamadı', 404);

  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  if (segments.length === 2 && request.method === 'POST') return createSubmission(request, env, user, typeKey);
  if (segments.length === 3 && segments[2] === 'mine' && request.method === 'GET') return listMine(env, user, typeKey);
  if (segments.length === 3 && segments[2] !== 'mine' && request.method === 'GET') return getOwnSubmission(env, user, typeKey, segments[2]);
  if (segments.length === 3 && segments[2] !== 'mine' && request.method === 'PATCH') return updateOwnSubmission(request, env, user, typeKey, segments[2]);
  return errorJson('Bulunamadı', 404);
}

async function createSubmission(request, env, user, typeKey) {
  const body = await readJson(request);
  const missing = validateRequired(typeKey, body);
  if (missing.length) return errorJson(`Eksik alan(lar): ${missing.join(', ')}`);
  const invalidUrlField = findInvalidUrlField(typeKey, body);
  if (invalidUrlField) return errorJson(`"${invalidUrlField}" alanı geçerli bir bağlantı değil.`);
  if (findInvalidSocialPlatform(typeKey, body)) return errorJson('Geçersiz sosyal medya platformu.');

  if (body.claimed_profile_key) {
    const err = await verifyClaimedProfileKey(env, user, typeKey, body.claimed_profile_key);
    if (err) return err;
    // bkz. updateOwnSubmission'daki AYNI istisna — yalnızca admin, bir firmanın/mimarın GÖRÜNEN adını
    // claimed_profile_key'den farklı gönderebilir (bkz. kullanıcı isteği: "Admin hesabına tüm firma
    // isimlerini değişebilme yetkisi ver" / "Admin hesabına ... Mimar ismi değiştirebilme yetkisi ver").
    if (!(RENAME_CASCADE_BY_TYPE[typeKey] && user.role === 'admin' && body.name)) {
      body.name = body.claimed_profile_key;
    }
  }
  if (typeKey === 'projects' && body.claimed_slug) {
    const err = await verifyClaimedSlug(env, user, body.claimed_slug);
    if (err) return err;
  }

  const config = SUBMISSION_TYPES[typeKey];
  const row = normalizeSubmission(typeKey, body);
  if (typeKey === 'projects' && body.claimed_slug) row.slug = body.claimed_slug; // normalizeSubmission slug'ı title'dan yeniden üretir, statik projeyle eşleşen slug'ı koru
  const id = newId();
  const now = Date.now();
  // Admin'in kendi gönderisi/düzenlemesi başka bir onaycıya muhtaç değil — admin zaten onaycının
  // kendisi olduğundan doğrudan yayına girer (bkz. kullanıcı isteği: "admin tüm sitede tüm
  // yetkilere sahip olsun ... admin canlıdaki siteden yaptığı değişiklikler doğrudan canlı siteye
  // yansısın"). AYNI şekilde, bir kullanıcının ZATEN sahiplenip onayı geçmiş kendi profilini
  // (claimed_profile_key doluysa — yukarıdaki verifyClaimedProfileKey bunu zaten doğruladı)
  // düzenlemesi de admin onayına muhtaç değil (bkz. kullanıcı isteği: "kendi mimar/danışman/firma
  // profilini ... düzenliyorsa admin onayına gerek yok direkt kaydet") — bu yalnızca profilin
  // İLK kez bu sahip tarafından düzenlendiği (henüz kendi architect_submissions/office_submissions
  // satırı olmadığı) durumda buraya (createSubmission) düşer; sonraki düzenlemeler
  // updateOwnSubmission'a (PATCH) gider. Marka yeni (claimed_profile_key'siz) bir gönderi/proje/ürün
  // hâlâ normal moderasyon kuyruğuna girer — bu yalnızca "zaten kendi olan bir şeyi düzenleme"
  // durumunu kapsar, ilk kez içerik göndermeyi DEĞİL.
  const isOwnerProfileEdit = !!body.claimed_profile_key;
  const status = (user.role === 'admin' || isOwnerProfileEdit) ? 'approved' : 'pending';

  const columns = ['id', 'owner_user_id', 'status', 'created_at', 'updated_at', ...config.fields];
  const placeholders = columns.map(() => '?').join(', ');
  const values = [id, user.id, status, now, now, ...config.fields.map(f => row[f])];

  await env.DB.prepare(
    `INSERT INTO ${config.table} (${columns.join(', ')}) VALUES (${placeholders})`
  ).bind(...values).run();

  // Bu, önceden arşivlenmiş (bkz. handleContentAction/handleProjectAction) bir statik kaydın
  // taslağıysa (nadir — normalde prefillForClaim mevcut taslağı bulup PATCH'e düşer) statik kayıt
  // hâlâ gizli olabilir; onaylandığı an tekrar görünür olmalı (bkz. unhideIfClaimedApproved).
  await unhideIfClaimedApproved(env, user, typeKey, status, typeKey === 'projects' ? body.claimed_slug : body.claimed_profile_key);

  // Admin bu firmayı/mimarı ilk kez düzenlerken adını da değiştirmiş olabilir (bkz. yukarıdaki
  // istisna) — statik ad hâlâ TÜM diğer D1 satırlarında (rozetler, kayıtlı öğeler vb.) anahtar
  // olarak kullanıldığından, bunları da yeni ada taşı (bkz. src/lib/officeFounderCascade.js#
  // renameOfficeEverywhere/renameArchitectEverywhere).
  const renameCascade = RENAME_CASCADE_BY_TYPE[typeKey];
  if (status === 'approved' && renameCascade && body.claimed_profile_key && body.name !== body.claimed_profile_key) {
    await renameCascade(env, body.claimed_profile_key, body.name);
  }

  // Yalnızca admin'in kendi gönderisi anında 'approved' olarak yayına girdiğinden (yukarıdaki
  // yorum) public önbelleği yalnızca bu durumda değişir — sıradan üye gönderileri 'pending' kalıp
  // onay bekleyene dek zaten hiçbir public uçta görünmez, gereksiz yere temizlemeye gerek yok.
  if (status === 'approved') {
    // bkz. src/lib/canonicalSync.js dosya başı yorumu — okuma yolları artık canonical tabloları
    // okuyor, admin'in anında yayına giren kendi gönderisi de aynı anda oraya senkronlanmalı.
    if (CANONICAL_TYPES.has(typeKey)) {
      const freshRow = await env.DB.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).bind(id).first();
      await syncApprovedSubmissionToCanonical(env, typeKey, parseSubmissionRow(typeKey, freshRow));
      if (FACET_TYPES.has(typeKey)) await bumpFacetCounts(env, typeKey);
    }
    await invalidatePublicCache();
    // claimed_slug/claimed_profile_key'liyse bu, ziyaretçilerin ZATEN görüntülemiş olabileceği
    // statik bir sayfaya bindirilen bir düzenlemedir — o sayfanın SSR önbelleğini temizle (bkz.
    // src/lib/ssrCache.js). Marka yeni (claim'siz) bir kayıt için bu bir no-op'tur (henüz hiç
    // önbelleklenmemiş bir anahtarı silmeye çalışmak zararsızdır).
    const target = ssrPurgeTargetFor(typeKey, { ...row, id });
    if (target) await purgeSsrDetailCache(target.type, target.key);
  }
  // slug: proje-ekle.html'in kaydettikten sonra doğrudan canlı sayfaya yönlendirebilmesi için (bkz.
  // kullanıcı isteği) — yalnızca projelerde anlamlı, slug title'dan rastgele bir ek ile üretildiğinden
  // (bkz. normalizeSubmission) istemci tarafında ÖNCEDEN tahmin edilemez (mimar/firma/ürünün aksine,
  // onlarda yönlendirme adı/id'den istemci tarafında yeniden üretilebiliyor).
  return json(typeKey === 'projects' ? { id, status, slug: row.slug } : { id, status }, 201);
}

async function listMine(env, user, typeKey) {
  const config = SUBMISSION_TYPES[typeKey];
  const { results } = await env.DB.prepare(
    `SELECT * FROM ${config.table} WHERE owner_user_id = ? ORDER BY created_at DESC`
  ).bind(user.id).all();
  return json({ items: results.map(r => parseSubmissionRow(typeKey, r)) });
}

// Sahiplik kontrolü admin için atlanır — admin herhangi bir kullanıcının gönderisini görüntüleyip
// düzenleyebilir (bkz. kullanıcı isteği: "admin hesabının tüm gönderilerin düzenleme yetkisi olsun").
async function getOwnSubmission(env, user, typeKey, id) {
  const config = SUBMISSION_TYPES[typeKey];
  const row = await env.DB.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).bind(id).first();
  if (!row || (row.owner_user_id !== user.id && user.role !== 'admin')) return errorJson('Bulunamadı', 404);
  return json({ item: parseSubmissionRow(typeKey, row) });
}

async function updateOwnSubmission(request, env, user, typeKey, id) {
  const config = SUBMISSION_TYPES[typeKey];
  const existing = await env.DB.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).bind(id).first();
  if (!existing || (existing.owner_user_id !== user.id && user.role !== 'admin')) return errorJson('Bulunamadı', 404);

  const body = await readJson(request);
  const missing = validateRequired(typeKey, body);
  if (missing.length) return errorJson(`Eksik alan(lar): ${missing.join(', ')}`);
  const invalidUrlField = findInvalidUrlField(typeKey, body);
  if (invalidUrlField) return errorJson(`"${invalidUrlField}" alanı geçerli bir bağlantı değil.`);
  if (findInvalidSocialPlatform(typeKey, body)) return errorJson('Geçersiz sosyal medya platformu.');

  if (body.claimed_profile_key) {
    const err = await verifyClaimedProfileKey(env, user, typeKey, body.claimed_profile_key);
    if (err) return err;
    // bkz. createSubmission'daki AYNI istisna — yalnızca admin, bir firmanın/mimarın GÖRÜNEN adını
    // claimed_profile_key'den farklı gönderebilir (bkz. kullanıcı isteği: "Admin hesabına tüm firma
    // isimlerini değişebilme yetkisi ver" / "Admin hesabına ... Mimar ismi değiştirebilme yetkisi ver").
    if (!(RENAME_CASCADE_BY_TYPE[typeKey] && user.role === 'admin' && body.name)) {
      body.name = body.claimed_profile_key;
    }
  }
  if (typeKey === 'projects' && body.claimed_slug) {
    const err = await verifyClaimedSlug(env, user, body.claimed_slug);
    if (err) return err;
  }

  const row = normalizeSubmission(typeKey, body);
  if (typeKey === 'projects') row.slug = existing.slug; // düzenlemede slug'ı (ve ona bağlı bağlantıları/yorumları) koru

  const now = Date.now();
  // Bu satıra ulaşan HERKES zaten sahip (existing.owner_user_id === user.id) ya da admin'dir —
  // yukarıdaki 404 koruması (satır 270) bunu ZATEN garanti ediyor. Yani kendi profilini/kendi
  // yüklediği proje-ürünü düzenleyen sıradan bir üye de admin ile AYNI şekilde anında yayına
  // girer (bkz. kullanıcı isteği: "kendi ... düzenliyorsa admin onayına gerek yok direkt kaydet").
  // Eskiden burası niyet olmadan 'pending'e düşüp (bkz. createSubmission'daki AYNI eski satır)
  // zaten ONAYLI/CANLI bir kaydı hideCanonicalForUnapprovedSubmission ile sitenin ÜZERİNDEN
  // ÇEKİYORDU (bkz. aşağısı) — sahibi kendi profilini güncellediği an profilinin siteden
  // kaybolması olarak yaşanıyordu.
  const status = 'approved';
  const updates = config.fields.map(f => `${f} = ?`);
  const values = config.fields.map(f => row[f]);
  updates.push('status = ?', 'updated_at = ?');
  values.push(status, now, id);

  await env.DB.prepare(
    `UPDATE ${config.table} SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  // Kurucular listesinden çıkarılan bir isim varsa, o kişinin kendi office alanını temizle (bkz.
  // src/lib/officeFounderCascade.js — gerçek "kurucu/ortak" görünürlüğü bu alandan gelir, founders
  // dizisinin kendisi yalnızca kozmetiktir).
  if (typeKey === 'offices' && 'founders' in body) {
    const oldFounders = parseSubmissionRow('offices', existing).founders;
    await cascadeRemovedFounders(env, user, existing.name, oldFounders, Array.isArray(body.founders) ? body.founders : []);
  }

  // Firma/mimar yeniden adlandırıldıysa (statik/claimed profilde yalnızca admin, claim'siz sıradan
  // bir profilde sahibi de yapabilir — bkz. yukarıdaki istisna) diğer TÜM D1 satırlarını da yeni ada
  // taşı (bkz. src/lib/officeFounderCascade.js#renameOfficeEverywhere/renameArchitectEverywhere).
  // claimed profillerde eski ad HER ZAMAN body.claimed_profile_key'dir (claimed_profile_key kendisi
  // değişmez); claim'siz profillerde eski ad existing.name'dir.
  const updateRenameCascade = RENAME_CASCADE_BY_TYPE[typeKey];
  if (status === 'approved' && updateRenameCascade) {
    const oldName = body.claimed_profile_key || existing.name;
    if (row.name !== oldName) await updateRenameCascade(env, oldName, row.name);
  }

  // bkz. createSubmission'daki aynı çağrı/yorum — bu satır önceden arşivlenmiş bir statik kaydın
  // taslağıysa, düzenleme onaylanır onaylanmaz statik kayıt tekrar görünür olmalı.
  await unhideIfClaimedApproved(env, user, typeKey, status, typeKey === 'projects' ? row.claimed_slug : row.claimed_profile_key);

  // Onaylı içerik ya şimdi onaylandı ya da (sıradan üye kendi onaylı içeriğini düzenlediğinde,
  // bkz. yukarıdaki status ataması) tekrar onay bekler duruma düşüp public'ten kalkmış olabilir —
  // her iki yönde de public önbellek eskimiş olacağından temizlenir.
  if (status === 'approved' || existing.status === 'approved') {
    // bkz. src/lib/canonicalSync.js dosya başı yorumu — bkz. src/routes/admin.js#handleSubmissionsAdmin'daki
    // AYNI mantık: onaylandıysa canonical'a senkronla, onaylıyken onay bekler duruma düştüyse
    // (sıradan üyenin kendi onaylı içeriğini düzenlemesi) canonical satırı gizle.
    if (CANONICAL_TYPES.has(typeKey)) {
      if (status === 'approved') {
        const freshRow = await env.DB.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).bind(id).first();
        await syncApprovedSubmissionToCanonical(env, typeKey, parseSubmissionRow(typeKey, freshRow));
      } else if (existing.status === 'approved') {
        await hideCanonicalForUnapprovedSubmission(env, typeKey, existing);
      }
      if (FACET_TYPES.has(typeKey)) await bumpFacetCounts(env, typeKey);
    }
    await invalidatePublicCache();
    // Değişiklik ÖNCESİ kaydın kimliğini hedefler (görüntülenen sayfa hâlâ bu anahtar altında
    // önbelleklenmiş olabilir) — bkz. src/lib/ssrCache.js.
    const target = ssrPurgeTargetFor(typeKey, existing);
    if (target) await purgeSsrDetailCache(target.type, target.key);
  }
  return json({ id, status });
}
