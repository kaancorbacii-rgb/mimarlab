import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { requireRightsAcceptance, recordRightsAcceptance, hasRightsAcceptance } from '../lib/rightsConsent.js';
import { newId } from '../lib/crypto.js';
import { SUBMISSION_TYPES, normalizeSubmission, parseSubmissionRow, validateRequired, findInvalidUrlField, findInvalidSocialPlatform, isInvalidSchoolValue, findInvalidProjectTaxonomyField, taxonomyFieldError, findOversizedField, findInvalidFilesField, findInvalidVariantsField, findInvalidProjectsField, findInvalidPortfolioField, findInvalidOfficeCats } from '../lib/submissionTypes.js';
import { invalidatePublicCache } from '../lib/publicCache.js';
import { purgeSsrDetailCache, ssrPurgeTargetFor } from '../lib/ssrCache.js';
import { cascadeRemovedFounders, cascadeRemovedProfileClaims, cascadeRemovedOfficesFromArchitect, renameOfficeEverywhere, renameArchitectEverywhere } from '../lib/officeFounderCascade.js';
import { ensurePendingOfficeClaims, canEditOfficeViaFounderLink, canEditArchitectViaOfficeMembership } from '../lib/claimedProfiles.js';
import { canUserEditProjectBySlug, canUserEditProductBySlug } from '../lib/projectClaimAccess.js';
import { projectEditGraceState } from '../lib/projectEditGrace.js';
import { setLegacyHidden, runContentAction } from './legacyContent.js';
import { syncApprovedSubmissionToCanonical, hideCanonicalForUnapprovedSubmission, isDuplicateCanonicalName, cleanupReplacedR2Media, findOrHealSubmissionDraft } from '../lib/canonicalSync.js';
import { bumpFacetCounts } from '../lib/facetCounts.js';
import { canonicalRowExistsByKey } from '../lib/canonicalRead.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { notifyNewsletterOfNewContent } from '../lib/newsletterNotify.js';
import { notifySubmissionApproved } from '../lib/notify.js';
import { activateProfilesOnPublish, previewProfileIdsByKeys, PUBLISH_GRAPH_PROFILE_TYPE } from './admin.js';
import { foldTr, titleCasePersonName } from '../lib/textMatch.js';
// bkz. src/routes/office.js'teki AYNI CJS-interop içe aktarma deseni — firma/marka ayrımının tek kaynağı.
import officeKindJs from '../../office-kind.js';
// Meslek etiketi <-> slug çevirisinin TEK kaynağı (bkz. profession-shared.js dosya başı yorumu:
// users.profession SLUG, architects.profession ETİKET taşır) — kişi profilinden hesap profiline
// geri senkron bu çeviriye muhtaç (bkz. syncOwnArchitectToAccount).
import professionSharedJs from '../../profession-shared.js';

const { isBrandOffice } = officeKindJs;
const { professionSlugOf } = professionSharedJs;

const CANONICAL_TYPES = new Set(['architects', 'offices', 'projects', 'products', 'materials']);
// bkz. src/routes/admin.js'deki AYNI temizlik/gerekçe.
const FACET_TYPES = new Set(['projects']);
// bkz. src/routes/public.js#handlePublicCheckName (istemci tarafı canlı uyarının AYNI metinleri) —
// proje-ekle.html/kisi-ekle.html/firma-ekle.html/urun-ekle.html buradaki hatayı form-notice
// kutusunda gösterir (bkz. aşağıdaki createSubmission çağrısı).
const DUPLICATE_NAME_ERROR = {
  projects: 'Bu proje zaten yayınlandı.',
  architects: 'Bu mimar zaten yayınlandı.',
  offices: 'Bu firma zaten yayınlandı.',
  products: 'Bu ürün zaten yayınlandı.',
  materials: 'Bu malzeme zaten yayınlandı.',
};
// data.js/projeler-data.js BİLEREK burada YOK — Legacy Bundle Elimination Faz 2 (bkz. kullanıcı
// isteği): claimed_profile_key/claimed_slug doğrulaması artık doğrudan canonical D1 (architects/
// offices/projects) tablolarından okunuyor, src/lib/seo.js'in Faz 1'de zaten yaptığı AYNI geçiş
// (o dosyada da "statik dizide ara, yoksa D1'e bak" ikili deseni kaldırılmıştı — Faz 2'nin
// migrate-to-id-first.js script'i her statik kaydı canonical bir satıra taşıdığından statik dizi
// artık D1'in KESİN bir alt kümesi, ayrı bir statik kontrole gerek yok).

const TYPE_BY_PATH = {
  offices: 'offices', projects: 'projects', products: 'products', materials: 'materials',
  architects: 'architects',
};

// architects/offices gönderileri, claimed_profile_key doluysa yeni bir kayıt değil, o kullanıcının
// onaylı bir profile_claims kaydına sahip olduğu STATİK bir profile (architects[]/offices[].name)
// yapılan bir düzenleme talebidir — sahtecilik olmasın diye onay kontrolü burada yapılır.
const CLAIM_PROFILE_TYPE = { architects: 'architect', offices: 'office' };

// bkz. src/routes/public.js#CLAIMED_COLUMN_BY_TYPE (aynı eşleme) — bir statik kaydı admin panelinden
// arşivleyip (bkz. src/routes/legacyContent.js#handleContentAction/handleProjectAction) sonra bu
// GENEL uç noktadan (Admin Arşiv sekmesindeki özel "Yayınla" butonu DIŞINDA, ör. proje-ekle.html/
// kisi-ekle.html/firma-ekle.html'in normal ?claim= düzenleme formundan) tekrar onaylarsak, aşağıdaki
// unhideIfClaimedApproved çağrısı olmadan satır 'approved' olur ama statik kayıt legacy_content_hidden
// içinde gizli KALIRDI — canlıda ne overlay ne statik hali görünmeyen, veritabanında "onaylı" ama
// sitede hiç var olmayan bir kayıt (gerçek bulgu: GAD Architecture'ı arşivleyip normal formdan
// düzenleyince firma sitede tamamen kayboluyordu, admin panelinde her şey normal görünüyordu).
const CLAIMED_COLUMN_BY_TYPE = { architects: 'claimed_profile_key', offices: 'claimed_profile_key', projects: 'claimed_slug', products: 'claimed_slug', materials: 'claimed_slug' };

// projects/products/materials'ın claimed_profile_key YERİNE claimed_slug kullanan tipler (bkz.
// migrations/0088_product_claimed_slug.sql, kullanıcı isteği: "ürün ekle/düzenle de proje ekle/
// düzenle'deki entegre sistemle aynı olsun") — architects/offices ayrı bir alan (claimed_profile_key)
// kullanmaya devam eder, o yüzden bu üçü TEK bir sette toplanır.
const CLAIMED_SLUG_TYPES = new Set(['projects', 'products', 'materials']);

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
  // skipPublishGraph — bu iki yol (createSubmission/updateOwnSubmission) grafı senkrondan SONRA
  // kendi yakaladıkları id'lerle yürütür; bkz. setLegacyHidden'daki gerekçe (çift yürütme
  // "kümelenme yok" kuralını bozuyor).
  await setLegacyHidden(env, user, typeKey, key, false, { skipPublishGraph: true });
}

const CANONICAL_TABLE_BY_TYPE = { architects: 'architects', offices: 'offices' };

// Bir firmayı düzenleme yetkisi artık yalnızca onaylı bir profile_claims('office') kaydına değil,
// kullanıcının O ANKİ pozisyonuna da bağlı (bkz. kullanıcı isteği: "Firma düzenleme yetkisi sadece
// admin, firma kurucusu, kurucu ortağı, ortağı ve ekip liderinde olsun") — Ekip Üyesi (ya da başka
// bir pozisyon) ile onaylanmış bir claim artık düzenleme HAKKI vermez, yalnızca firma.html#Ekip'te
// görünmeyi sağlar (bkz. src/routes/office.js#buildOfficePayload). Yalnızca 'offices' için geçerli —
// bir mimarın kendi profilini düzenlemesi pozisyonundan bağımsızdır.
// 'Yönetici' — firmanın kendi kurumsal hesabı (bkz. src/lib/projectClaimAccess.js#MANAGER_POSITION).
const OFFICE_EDIT_POSITIONS = new Set(['Kurucu', 'Kurucu Ortak', 'Ortak', 'Ekip Lideri', 'Yönetici']);

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
    `SELECT id, office_position FROM profile_claims WHERE user_id = ? AND profile_type = ? AND profile_key = ? AND status = 'approved'`
  ).bind(user.id, profileType, currentName).first();
  if (!claim) {
    // İKİNCİ YETKİ YOLU (kullanıcı isteği, 2026-09-08 madde 1): firmanın kendisi, kullanıcının
    // ADMIN ONAYLI kişi profilini "Kurucular / Ortaklar" kutusuna yazmışsa künyeyi düzenleyebilir —
    // ortada bir profile_claims('office') satırı OLMASA da. Kural ve bilinen sınırı için bkz.
    // src/lib/claimedProfiles.js#canEditOfficeViaFounderLink. Hesabım'daki buton AYNI kararı
    // sunucudan (GET /api/claims/mine -> officeLinks[].canEdit) okur, ikisi ayrışamaz.
    if (typeKey === 'offices' && await canEditOfficeViaFounderLink(env, user, currentName, OFFICE_EDIT_POSITIONS)) return null;
    // ÜÇÜNCÜ YETKİ YOLU (kullanıcı isteği, 2026-09-08): bir firmanın/markanın yetkilisi (Kurucu,
    // Kurucu Ortak, Ortak, Ekip Lideri, Yönetici) o firmanın Kurucular/Ekip listesindeki DİĞER
    // kişilerin profillerini de düzenleyebilir — kendi adına onaylı bir kişi talebi olmasa da.
    // Kural ve "kendi sahibi olan profil dokunulmaz" sınırı için bkz. src/lib/claimedProfiles.js#
    // canEditArchitectViaOfficeMembership. İstemcideki Düzenle butonu AYNI kararı sunucudan okur
    // (GET /api/claims/status -> delegatedEdit), ikisi ayrışamaz.
    if (typeKey === 'architects' && await canEditArchitectViaOfficeMembership(env, user, currentName, OFFICE_EDIT_POSITIONS)) return null;
    return errorJson('Bu profili düzenlemek için önce profili sahiplenip onayının geçmesi gerekiyor.', 403);
  }
  // P1 güvenlik düzeltmesi (bkz. migrations/0068): canlı user.position YERİNE, admin bu claim'i
  // onayladığı andaki dondurulmuş office_position kullanılır — aksi halde kullanıcı kendi
  // profilinden position'ını "Kurucu" yapıp bu kontrolü atlatabilirdi.
  if (typeKey === 'offices' && !OFFICE_EDIT_POSITIONS.has(claim.office_position)) {
    return errorJson('Bu firmayı düzenlemek için Yönetici, Kurucu, Kurucu Ortak, Ortak ya da Ekip Lideri görevinde olman gerekiyor.', 403);
  }
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
// Admin her projeyi düzenleyebilir; admin olmayan bir kullanıcı yalnızca projenin künyesindeki bir
// mimar/firmayı onaylı bir profile_claims ile sahipleniyorsa düzenleyebilir (bkz. kullanıcı isteği:
// "Admin bir mimar ya da firmayı bir kullanıcı üzerine atasın, kullanıcı o firmaya/mimara ait
// projelerde de değişiklik yapabilsin" — src/lib/projectClaimAccess.js#canUserEditProjectBySlug ile
// AYNI kural, admin bypass'ı da orada tekrar ediliyor ki bu fonksiyon tek başına da doğru sonuç versin).
async function verifyClaimedSlug(env, user, slug) {
  const canonicalRow = await env.DB.prepare(
    `SELECT id FROM projects WHERE deleted_at IS NULL AND (slug = ? OR legacy_key = ?) LIMIT 1`
  ).bind(slug, slug).first();
  if (!canonicalRow) return errorJson('Bu proje artık bu adla mevcut değil, sayfayı yenileyip tekrar dene.', 404);
  if (user.role === 'admin') return null;
  if (!(await canUserEditProjectBySlug(env, user, slug))) {
    return errorJson('Bu projeyi düzenlemek için künyesindeki bir mimar ya da firma profilinin sahibi olman gerekiyor.', 403);
  }
  return null;
}

// verifyClaimedSlug'ın ÜRÜN/MALZEME karşılığı (kullanıcı isteği, 2026-09-05: "Ürün ekle ile ürün
// düzenle birbiriyle entegre değil mi? Proje ekle ve proje düzenle de kurduğumuz entegre sistemin
// ürün ekle/düzenle için de aynı olması gerekiyor.") — admin her ürünü/malzemeyi düzenleyebilir;
// admin olmayan bir kullanıcı yalnızca ürünün MARKASINI (offices satırı) onaylı bir profile_claims
// ile sahipleniyorsa düzenleyebilir (bkz. src/lib/projectClaimAccess.js#canUserEditProductBySlug).
async function verifyProductClaimedSlug(env, user, slug) {
  const canonicalRow = await env.DB.prepare(
    `SELECT id FROM products WHERE deleted_at IS NULL AND (slug = ? OR legacy_key = ?) LIMIT 1`
  ).bind(slug, slug).first();
  if (!canonicalRow) return errorJson('Bu ürün artık bu adla mevcut değil, sayfayı yenileyip tekrar dene.', 404);
  if (user.role === 'admin') return null;
  if (!(await canUserEditProductBySlug(env, user, slug))) {
    return errorJson('Bu ürünü düzenlemek için ürünün markasının profilinin sahibi olman gerekiyor.', 403);
  }
  return null;
}
// typeKey'e göre doğru doğrulayıcıyı seçer — createSubmission/updateOwnSubmission'daki İKİ AYNI
// çağrı noktası bunu paylaşır.
function claimedSlugVerifierFor(typeKey) {
  return typeKey === 'projects' ? verifyClaimedSlug : verifyProductClaimedSlug;
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
  // Ürün/malzeme sahibinin (ya da admin'in) pop-up içinden kendi gönderisini silmesi/arşivlemesi
  // (bkz. js/components/product-modal.js#mountEditAndAdminButtons, kullanıcı isteği: "Admine ve
  // ürünü yükleyen kullanıcıya ürünü düzenleme, silme ve arşivleme yetkisi ver") — projects'in
  // aksine (bkz. handleSelfProjectDelete, yalnızca Sil) burada sahibe Arşivle de açıktır, bu yüzden
  // proje'deki DELETE method'u yerine tek bir POST .../moderate ucu {action} gövdesiyle ikisini de taşır.
  if (segments.length === 4 && segments[3] === 'moderate' && request.method === 'POST') return moderateOwnSubmission(request, env, user, typeKey, segments[2]);
  return errorJson('Bulunamadı', 404);
}

// ---------------------------------------------------------------------------------------------
// KİŞİ PROFİLİ <-> HESAP PROFİLİ ÇİFT YÖNLÜ SENKRON (kullanıcı isteği, 2026-09-06 madde 2:
// "Kendi kişi profillerinde değişiklik yaparlarsa bu profil bilgileri ekranına da yansımalı ya da
// profil bilgileri ekranında yapılan değişiklikler de şahsi kişi profiline yansımalı. Bu iki profil
// birbiriyle entegre ve dinamik ilerlemeli.")
//
// İLERİ YÖN zaten vardı: Hesabım > Profili Düzenle'nin Kaydet'i hem PATCH /api/profile hem de bu
// dosyanın uçlarına (POST/PATCH /api/architects) yazar — bkz. js/components/auth-modal.js#
// submitArchitectSyncIfNeeded. GERİ YÖN hiç yoktu: kullanıcı AYNI profili kisi-ekle.html'den
// düzenlediğinde (ya da artık kişi popup'ındaki Düzenle butonundan, bkz. claim-correction-box.js)
// yalnızca architect_submissions satırı değişiyor, Profil Bilgileri kutusu eski değerleri
// göstermeye devam ediyordu. Senkron İSTEMCİDE değil BURADA yapılır ki hangi form kullanılırsa
// kullanılsın (kisi-ekle.html, Profili Düzenle, admin) sonuç aynı olsun.
//
// "Bu kayıt kullanıcının KENDİSİ mi?" sorusunun iki geçerli cevabı var ve ikisi de doğrulanır:
//   * claimed_profile_key üzerinde ONAYLI bir profile_claims('architect') satırı (sahiplenilmiş profil),
//   * ya da kayıt kullanıcının KENDİ adıyla açılmış olması (bkz. isSelfDirectoryListing'in AYNI kuralı).
// Başkası adına açılan/düzenlenen kişi kayıtları (kisi-ekle.html'in asıl kullanımı) bu iki testin
// ikisinden de geçemez, dolayısıyla düzenleyenin hesabına HİÇBİR ŞEY yazılmaz.
const ACCOUNT_SYNC_STRING_FIELDS = ['dob', 'school', 'dept', 'position', 'about', 'photo_url'];
// "Bu kişi kaydı kullanıcının KENDİSİ mi?" — syncOwnArchitectToAccount ve ensurePendingOfficeClaims
// çağrısı AYNI soruyu sorar (biri hesap alanlarını doldurmak, diğeri firma bağı için onay talebi
// açmak üzere), bu yüzden kural tek yerde durur. Kritik: kisi-ekle.html'in ASIL kullanımı BAŞKA
// birini eklemektir — bir meslektaşının firmasını yazmak, o kullanıcı adına firma talebi
// DOĞURMAMALI.
async function isOwnArchitectRecord(env, user, row, selfMatchName) {
  if (!user || !row) return false;
  if (row.claimed_profile_key) {
    const claim = await env.DB.prepare(
      `SELECT 1 FROM profile_claims WHERE user_id = ? AND profile_type = 'architect' AND profile_key = ? AND status = 'approved'`
    ).bind(user.id, row.claimed_profile_key).first();
    if (claim) return true;
  }
  // Ad karşılaştırması DÜZENLEMEDEN ÖNCEKİ ad (selfMatchName) üzerinden yapılır — kullanıcı kendi
  // kişi profilinde ad soyadını değiştiriyorsa yeni ad hesabınkiyle henüz eşleşmez, eski ad eşleşir.
  return !!(selfMatchName && user.name && foldTr(selfMatchName) === foldTr(user.name));
}

async function syncOwnArchitectToAccount(env, user, typeKey, row, selfMatchName) {
  if (typeKey !== 'architects' || !user || !row) return;
  if (!(await isOwnArchitectRecord(env, user, row, selfMatchName))) return;

  const updates = [];
  const values = [];
  for (const f of ACCOUNT_SYNC_STRING_FIELDS) {
    if (row[f] === undefined) continue;
    updates.push(`${f} = ?`); values.push(row[f] || null);
  }
  if (row.name) { updates.push('name = ?'); values.push(row.name); }
  // architects.profession HAM Türkçe etiket ("Mimar, Fotoğrafçı"), users.profession SLUG
  // ("mimar,fotografci") — bkz. profession-shared.js. Tanınmayan etiket sessizce atlanır.
  if (row.profession !== undefined) {
    const slugs = String(row.profession || '').split(',').map(s => professionSlugOf(s)).filter(Boolean);
    updates.push('profession = ?'); values.push(slugs.length ? [...new Set(slugs)].join(',') : null);
  }
  // awards/social_links: iki tabloda da AYNI JSON dizi biçimi (bkz. src/routes/auth.js#
  // updateUserProfileFields). normalizeSubmission bu alanları D1'e bind edilebilir JSON METNİ olarak
  // bırakır (bkz. o fonksiyondaki arrayFields dalı) — NULL ise "gövdede hiç yok" demektir ve
  // hesaptaki mevcut değer korunur (nullableArrayFields semantiği).
  for (const f of ['awards', 'social_links']) {
    const raw = row[f];
    if (raw === undefined || raw === null) continue;
    updates.push(`${f} = ?`);
    values.push(typeof raw === 'string' ? raw : JSON.stringify(Array.isArray(raw) ? raw : []));
  }
  if (!updates.length) return;
  values.push(user.id);
  try {
    await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  } catch (err) {
    // Best-effort yan etki — asıl gönderi yazımı zaten başarıyla tamamlandı, burada bir hata
    // kullanıcıya 500 olarak dönmemeli (bkz. src/lib/notify.js#createNotification'daki AYNI gerekçe).
    console.error('syncOwnArchitectToAccount failed', err);
  }
}

async function createSubmission(request, env, user, typeKey) {
  // Hiçbir gönderi tipinde (products/materials dahil, bkz. kullanıcı isteği: rozet şartı kaldırıldı)
  // aylık bir üst sınır yok — oturum açmış tek bir hesabın kısa vadede admin moderasyon kuyruğunu
  // doldurmasına karşı tek koruma bu genel saatlik patlama (burst) limiti.
  if (!(await checkRateLimit(env, 'submission', user.id, 20, 60 * 60 * 1000))) {
    return errorJson('Çok fazla gönderi oluşturdun. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }

  const body = await readJson(request);
  // Kişi adının baş harfleri (kullanıcı isteği, 2026-09-10 dokuzuncu tur madde 1) — TÜM doğrulama
  // ve çakışma kontrollerinden ÖNCE, çünkü `name` bu tipte aynı zamanda ANAHTAR olarak yazılır
  // (bkz. src/lib/textMatch.js#titleCasePersonName'in "neden yazma anında" notu). claimed_profile_key
  // dalı body.name'i aşağıda zaten anahtarın kendisiyle EZDİĞİNDEN, sahiplenilmiş bir profili
  // düzenlemek adı yeniden adlandırmaz — normalizasyon yalnızca serbest yazılan adlara dokunur.
  if (typeKey === 'architects' && typeof body.name === 'string') body.name = titleCasePersonName(body.name);
  // Telif ve Sorumluluk Beyanı (kullanıcı isteği, 2026-09-10 madde 1) — istemci kapısının
  // (js/components/rights-consent.js) sunucu tarafı karşılığı; bu uca doğrudan atılan isteklerde de
  // onay ZORUNLU. Diğer doğrulamalardan ÖNCE bakılır: onay yoksa gönderi hiç işlenmemeli.
  // TEK İSTİSNA — ADMIN TELİFSİZ KAYDI (kullanıcı isteği, 2026-09-11): admin beyanı onaylamadan da
  // kaydedebilir; o zaman değişiklik kaydedilir ama içerik YAYINA ALINMAZ (keepPreview — canonical
  // senkron görünürlüğe dokunmaz, yeni kayıt önizleme olarak eklenir, statik kayıt gizliyse gizli
  // kalır). Blursuz yayın yalnızca beyan onaylı kaydetmeyle olur. Admin olmayan herkes için 422 aynen.
  const rightsAccepted = hasRightsAcceptance(body);
  if (!rightsAccepted && user.role !== 'admin') return requireRightsAcceptance(body);
  const keepPreview = !rightsAccepted;
  const missing = validateRequired(typeKey, body);
  if (missing.length) return errorJson(`Eksik alan(lar): ${missing.join(', ')}`);
  const oversizedField = findOversizedField(typeKey, body);
  if (oversizedField) return errorJson(`"${oversizedField}" alanı çok uzun.`);
  const invalidUrlField = findInvalidUrlField(typeKey, body);
  if (invalidUrlField) return errorJson(`"${invalidUrlField}" alanı geçerli bir bağlantı değil.`);
  const invalidFilesError = findInvalidFilesField(typeKey, body);
  if (invalidFilesError) return errorJson(invalidFilesError);
  const invalidVariantsError = findInvalidVariantsField(typeKey, body); // body.variants'ı yerinde normalize eder
  if (invalidVariantsError) return errorJson(invalidVariantsError);
  const invalidProjectsError = findInvalidProjectsField(typeKey, body);
  if (invalidProjectsError) return errorJson(invalidProjectsError);
  const invalidPortfolioError = findInvalidPortfolioField(typeKey, body);
  if (invalidPortfolioError) return errorJson(invalidPortfolioError);
  const invalidCatsField = findInvalidOfficeCats(typeKey, body);
  if (invalidCatsField) return errorJson(`"${invalidCatsField}" alanı yalnızca izin verilen seçeneklerden oluşabilir.`);
  if (findInvalidSocialPlatform(typeKey, body)) return errorJson('Geçersiz sosyal medya platformu.');
  const invalidTaxonomyField = findInvalidProjectTaxonomyField(typeKey, body);
  if (invalidTaxonomyField) return errorJson(taxonomyFieldError(invalidTaxonomyField));
  if (typeKey === 'architects' && isInvalidSchoolValue(body.school)) return errorJson('Geçerli bir üniversite adı gir (kısaltma kullanma).');
  // publishDate (Yayın Tarihi) yalnızca admin'in proje ekle/düzenle sayfasında görünen/düzenlenebilen
  // bir alan (bkz. kullanıcı isteği) — sıradan bir kullanıcı bu ucu (kendi gönderisini oluşturma/
  // düzenleme) doğrudan çağırırsa (ör. tarayıcı devtools'tan) alan sessizce yok sayılır, admin
  // olmayan HİÇBİR yoldan bu değer yazılamaz. updateOwnSubmission'da da AYNI kontrol tekrarlanır.
  if (typeKey === 'projects' && user.role !== 'admin') delete body.publishDate;

  // Kişi dizini kendi-kendine-yayın (kullanıcı isteği, 2026-09-06): Hesabım'daki "Kişi sayfasında
  // görünmek istiyorum: Evet" akışı (bkz. auth-modal.js#submitArchitectSyncIfNeeded) artık admin
  // onay kuyruğuna DÜŞMEDEN doğrudan yayına girer — TEK KOŞULLA: gönderilen isim, oturum açmış
  // hesabın KENDİ adıyla (foldTr ile Türkçe casefold, büyük/küçük+aksan bağımsız) birebir eşleşmeli.
  // Bu, bir kullanıcının "selfDirectoryListing" bayrağını BAŞKASININ adıyla göndererek moderasyonu
  // atlatıp sahte bir üçüncü şahıs profili anında yayınlamasını engeller — yalnızca "kendini"
  // temsil eden gönderi bu kısayolu kullanabilir, diğer HERKES (kisi-ekle.html, başkası adına
  // gönderiler) normal moderasyon kuyruğuna girmeye devam eder.
  const isSelfDirectoryListing = typeKey === 'architects' && body.selfDirectoryListing === true
    && !!(body.name || '').trim() && foldTr((body.name || '').trim()) === foldTr(user.name || '');

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
  if (CLAIMED_SLUG_TYPES.has(typeKey) && body.claimed_slug) {
    const err = await claimedSlugVerifierFor(typeKey)(env, user, body.claimed_slug);
    if (err) return err;
  }

  // claimed_profile_key/claimed_slug'lı gönderiler statik bir kayda "bağlanan" düzenlemelerdir —
  // body.name yukarıda zaten claimed_profile_key ile AYNI değere ayarlandığından (rename istisnası
  // dışında), bu iki tip ZATEN kasıtlı olarak mevcut bir isimle eşleşir; bu yüzden çakışma kontrolü
  // yalnızca GERÇEKTEN yeni bir kayıt oluşturulurken çalışır (bkz. isDuplicateCanonicalName yorumu).
  if (!body.claimed_profile_key && !(CLAIMED_SLUG_TYPES.has(typeKey) && body.claimed_slug)) {
    const dupName = typeKey === 'projects' ? body.title : body.name;
    if (dupName && (await isDuplicateCanonicalName(env, typeKey, dupName, { brand: body.brand }))) {
      // Kişi dizini kendi-kendine-yayın çakışması (kullanıcı isteği, 2026-09-06): "Ferhat Yılmaz
      // kişisi zaten var, profile giderek 'Bu profil bana ait' talebi oluştur" örneğindeki AYNI
      // uyarı — istemcinin (auth-modal.js) bağlantı kurabilmesi için mevcut profilin slug'ı da
      // döner (bkz. claim-correction-box.js'teki AYNI "Bu profil bana ait" akışı, POST /api/claims).
      if (isSelfDirectoryListing) {
        const { results } = await env.DB.prepare(`SELECT slug, name FROM architects WHERE deleted_at IS NULL`).all();
        const foldedDup = foldTr(dupName);
        const existingMatch = (results || []).find(r => foldTr(r.name || '') === foldedDup);
        return json({
          error: `"${dupName}" kişisi zaten var. Bu profil sana aitse, profile giderek "Bu profil bana ait" talebi oluşturabilirsin.`,
          duplicateName: true,
          existingSlug: existingMatch ? existingMatch.slug : null,
          existingName: existingMatch ? existingMatch.name : dupName,
        }, 409);
      }
      return errorJson(DUPLICATE_NAME_ERROR[typeKey]);
    }
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
  // CLAIMED_SLUG_TYPES.has(typeKey) && body.claimed_slug: yukarıdaki claimedSlugVerifierFor bunun ya
  // admin ya da (projede) künyedeki bir mimar/firmayı, (ürün/malzemede) markayı onaylı şekilde
  // sahiplenen bir kullanıcıdan geldiğini ZATEN doğruladı — claimed_profile_key'li mimar/firma
  // düzenlemesiyle AYNI mantıkla, bu da bir onay kuyruğuna değil doğrudan yayına girmeli (bkz.
  // kullanıcı isteği: "kullanıcı o firmaya/mimara ait projelerde de istediği zaman değişiklik
  // yapabilsin" / "ürün ekle/düzenle de aynı entegre sistem").
  const isOwnerProfileEdit = !!body.claimed_profile_key || (CLAIMED_SLUG_TYPES.has(typeKey) && !!body.claimed_slug);
  const status = (user.role === 'admin' || isOwnerProfileEdit || isSelfDirectoryListing) ? 'approved' : 'pending';

  const columns = ['id', 'owner_user_id', 'status', 'created_at', 'updated_at', ...config.fields];
  const placeholders = columns.map(() => '?').join(', ');
  const values = [id, user.id, status, now, now, ...config.fields.map(f => row[f])];

  await env.DB.prepare(
    `INSERT INTO ${config.table} (${columns.join(', ')}) VALUES (${placeholders})`
  ).bind(...values).run();

  // Kişi profili -> hesap profili geri senkronu (bkz. syncOwnArchitectToAccount). Yeni kayıtta
  // "kendisi mi" testi kaydın KENDİ adıyla yapılır: bir kullanıcı ancak kendi adıyla açtığı kaydı
  // kendi profili sayabilir (isSelfDirectoryListing ile AYNI kural).
  await syncOwnArchitectToAccount(env, user, typeKey, { ...row, claimed_profile_key: body.claimed_profile_key || null }, row.name);

  // Bu, önceden arşivlenmiş (bkz. handleContentAction/handleProjectAction) bir statik kaydın
  // taslağıysa (nadir — normalde prefillForClaim mevcut taslağı bulup PATCH'e düşer) statik kayıt
  // hâlâ gizli olabilir; onaylandığı an tekrar görünür olmalı (bkz. unhideIfClaimedApproved).
  // keepPreview (admin beyanı onaylamadan kaydetti): gizli/önizlemedeki statik kayıt görünür YAPILMAZ.
  // Önizlemedeki firma/KİŞİ beyanla yayına alınıyorsa grafı da yayına çıkar (bkz.
  // admin.js#activateProfilesOnPublish). id'ler BURADA, unhideIfClaimedApproved'dan ÖNCE yakalanır —
  // o çağrı (setLegacyHidden) preview_at'i temizlediği için sonradan profil önizlemede görünmez.
  const publishGraphType = PUBLISH_GRAPH_PROFILE_TYPE[typeKey] || null;
  const publishingProfileIds = publishGraphType && !keepPreview && status === 'approved'
    ? await previewProfileIdsByKeys(env, publishGraphType, [body.claimed_profile_key, `submission:${id}`]) : [];
  if (!keepPreview) await unhideIfClaimedApproved(env, user, typeKey, status, CLAIMED_SLUG_TYPES.has(typeKey) ? body.claimed_slug : body.claimed_profile_key);

  // Admin bu firmayı/mimarı ilk kez düzenlerken adını da değiştirmiş olabilir (bkz. yukarıdaki
  // istisna) — statik ad hâlâ TÜM diğer D1 satırlarında (rozetler, kayıtlı öğeler vb.) anahtar
  // olarak kullanıldığından, bunları da yeni ada taşı (bkz. src/lib/officeFounderCascade.js#
  // renameOfficeEverywhere/renameArchitectEverywhere).
  const renameCascade = RENAME_CASCADE_BY_TYPE[typeKey];
  if (status === 'approved' && renameCascade && body.claimed_profile_key && body.name !== body.claimed_profile_key) {
    await renameCascade(env, body.claimed_profile_key, body.name);
  }

  // "Firma veya Marka" alanı -> admin onayı (bkz. src/lib/claimedProfiles.js#
  // ensurePendingOfficeClaims, kullanıcı isteği 2026-09-08 madde 1). Kişi FİRMA profilinde ancak bu
  // talep onaylandıktan sonra görünür (bkz. src/lib/canonicalSync.js#splitAdminApprovedOffices).
  if (typeKey === 'architects' && await isOwnArchitectRecord(env, user, { ...row, claimed_profile_key: body.claimed_profile_key || null }, row.name)) {
    await ensurePendingOfficeClaims(env, user, (row.office || '').split(','), newId);
    // TERS YÖN (kullanıcı isteği, 2026-09-10 madde 1) — bkz. updateOwnSubmission'daki AYNI çağrı.
    // Burada "eski" değer canonical `architects` satırından okunur: bu, kullanıcının sahiplendiği
    // bir profil için taslak HENÜZ YOKKEN (?claim= ile ilk kaydetme) izlenen yoldur, yani kutudan
    // silinen firma yalnızca canonical satırda görünür. Taslak zaten varsa istemci PATCH'e düşer
    // ve karşılaştırma orada existing.office ile yapılır.
    const canonicalArchitect = await env.DB.prepare(
      `SELECT a.name, o.name AS office_name FROM architects a
         LEFT JOIN offices o ON o.id = a.office_id AND o.deleted_at IS NULL
        WHERE a.deleted_at IS NULL AND (a.name = ? OR a.legacy_key = ?) LIMIT 1`
    ).bind(row.name, body.claimed_profile_key || row.name).first();
    if (canonicalArchitect && canonicalArchitect.office_name) {
      await cascadeRemovedOfficesFromArchitect(env, canonicalArchitect.name, canonicalArchitect.office_name, row.office, { claimUserId: user.id });
    }
  }

  // GERÇEK BULGU (kullanıcı isteği, 2026-09-08 madde 3): Kurucular/Ekip kutusundan bir isim silmek
  // yalnızca updateOwnSubmission'da (PATCH) cascade'leniyordu. Bir firma İLK KEZ sahiplenilerek
  // düzenlendiğinde (firma-ekle.html?claim= — henüz office_submissions satırı yok) kaydetme BU
  // fonksiyona (POST) düşer ve hiçbir cascade çalışmıyordu: kutudan silinen kişinin onaylı
  // profile_claims satırı olduğu gibi kalıyor, firma popup'ı onu Kurucular/Ekip'te göstermeye devam
  // ediyordu ("siliyorum ama popup'tan silinmiyor"). Aynı iki çağrı burada da yapılır — bkz.
  // updateOwnSubmission'daki AYNI blok/gerekçe. renameCascade'DEN SONRA çalışır: profile_claims
  // satırları oraya kadar hâlâ eski adı taşıyabilir, cascade nihai (yeni) adla eşleşmelidir.
  if (typeKey === 'offices' && body.claimed_profile_key && status === 'approved') {
    if ('founders' in body) {
      // Kutudan silinen kurucuyu firmadan KOPAR (office_founders + birincil firma + kişi taslağı) —
      // eskiden bu yolda yalnızca claim'ler temizleniyordu, yapısal bağ kalıyordu (gerçek bulgu,
      // 2026-09-11 Aboutblank; bkz. src/lib/officeFounderCascade.js#cascadeRemovedFounders).
      // foundersShown — formun kutuda gösterdiği ilk liste (bkz. firma-ekle.html#foundersShown):
      // yalnızca kullanıcının GÖRÜP sildiği isimler koparılır.
      await cascadeRemovedFounders(env, user, row.name, Array.isArray(body.foundersShown) ? body.foundersShown : [], Array.isArray(body.founders) ? body.founders : [], {
        newTeam: 'team' in body ? (Array.isArray(body.team) ? body.team : []) : null,
      });
      await cascadeRemovedProfileClaims(env, row.name, Array.isArray(body.founders) ? body.founders : [], { founders: true });
    }
    if ('team' in body) {
      await cascadeRemovedProfileClaims(env, row.name, Array.isArray(body.team) ? body.team : [], { founders: false });
    }
  }

  // Yalnızca admin'in kendi gönderisi anında 'approved' olarak yayına girdiğinden (yukarıdaki
  // yorum) public önbelleği yalnızca bu durumda değişir — sıradan üye gönderileri 'pending' kalıp
  // onay bekleyene dek zaten hiçbir public uçta görünmez, gereksiz yere temizlemeye gerek yok.
  let syncedRow = null;
  if (status === 'approved') {
    // bkz. src/lib/canonicalSync.js dosya başı yorumu — okuma yolları artık canonical tabloları
    // okuyor, admin'in anında yayına giren kendi gönderisi de aynı anda oraya senkronlanmalı.
    if (CANONICAL_TYPES.has(typeKey)) {
      const freshRow = await env.DB.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).bind(id).first();
      // publishingProfileIds — yukarıda, unhideIfClaimedApproved'dan ÖNCE yakalandı.
      syncedRow = await syncApprovedSubmissionToCanonical(env, typeKey, parseSubmissionRow(typeKey, freshRow), { publish: !keepPreview });
      if (publishingProfileIds.length) await activateProfilesOnPublish(env, publishGraphType, publishingProfileIds, user.id);
      if (FACET_TYPES.has(typeKey)) await bumpFacetCounts(env, typeKey);
    }
    await invalidatePublicCache(env);
    // claimed_slug/claimed_profile_key'liyse bu, ziyaretçilerin ZATEN görüntülemiş olabileceği
    // statik bir sayfaya bindirilen bir düzenlemedir — o sayfanın SSR önbelleğini temizle (bkz.
    // src/lib/ssrCache.js). Marka yeni (claim'siz) bir kayıt için bu bir no-op'tur (henüz hiç
    // önbelleklenmemiş bir anahtarı silmeye çalışmak zararsızdır).
    const target = ssrPurgeTargetFor(typeKey, { ...row, id });
    if (target) await purgeSsrDetailCache(target.type, target.key, env);

    // Bülten bildirimi (bkz. src/lib/newsletterNotify.js dosya başı yorumu) — YALNIZCA gerçekten
    // yeni bir kayıt için (isOwnerProfileEdit/claimed_slug'lı gönderiler mevcut statik bir kaydın
    // ÜZERİNE bindirilen düzenlemelerdir, "yeni içerik" değil). Bu blok yalnızca admin'in kendi
    // gönderisinin ANINDA yayına girdiği yola girer (bkz. yukarıdaki status ataması) — sıradan üye
    // gönderileri 'pending' kalır, bildirim admin onayladığında src/routes/admin.js'te gönderilir.
    // keepPreview: önizlemede (blurlu) eklenen içerik henüz yayında değil — bülten bildirimi gitmez.
    if (!keepPreview && CANONICAL_TYPES.has(typeKey) && !isOwnerProfileEdit && !(typeKey === 'projects' && body.claimed_slug)) {
      await notifyNewsletterOfNewContent(env, typeKey, syncedRow || { ...row, id });
    }
  }
  // Beyan denetim kaydı (bkz. src/lib/rightsConsent.js) — gönderi başarıyla oluştuktan SONRA yazılır
  // ki başarısız/yarıda kalan denemeler için sahte bir onay izi kalmasın. Admin beyansız kaydettiyse
  // (keepPreview) iz YAZILMAZ — ortada verilmiş bir beyan yok.
  if (rightsAccepted) await recordRightsAcceptance(env, user, {
    contentType: typeKey,
    contentKey: body.claimed_profile_key || body.claimed_slug || (typeKey === 'projects' ? row.slug : body.name) || null,
    submissionId: id,
    source: 'submit',
  });
  // slug: proje-ekle.html'in kaydettikten sonra doğrudan canlı sayfaya yönlendirebilmesi için (bkz.
  // kullanıcı isteği) — syncedRow'dan (canonical satırın KENDİSİ) okunur, row.slug'dan DEĞİL: bir
  // slug çakışması olduysa (bkz. src/lib/canonicalSync.js#syncProject) canonical'daki gerçek slug
  // row.slug'dan farklı olabilir, istemciye HER ZAMAN gerçek/nihai slug dönmeli.
  if (typeKey === 'projects') {
    const finalSlug = (syncedRow && syncedRow.slug) || row.slug;
    return json({ id, status, slug: finalSlug, prefix: '/proje/' }, 201);
  }
  // slug: urun-ekle.html'in kaydettikten sonra doğrudan (artık isim/marka'dan üretilen) canlı ürün
  // sayfasına yönlendirebilmesi için (bkz. src/lib/canonicalSync.js#syncProduct, kullanıcı isteği:
  // "Ürün sayfalarındaki ürünlerin URL'lerini ürün adları olarak düzgünce düzelt") — projects'teki
  // AYNI gerekçe, eskiden buradan hiç dönmüyordu (client 'm-' + data.id'yi KENDİSİ üretiyordu).
  if ((typeKey === 'products' || typeKey === 'materials') && syncedRow) {
    return json({ id, status, slug: syncedRow.slug, prefix: '/urun/' }, 201);
  }
  return json({ id, status }, 201);
}

async function listMine(env, user, typeKey) {
  const config = SUBMISSION_TYPES[typeKey];
  const { results } = await env.DB.prepare(
    `SELECT * FROM ${config.table} WHERE owner_user_id = ? ORDER BY created_at DESC`
  ).bind(user.id).all();
  const items = results.map(r => parseSubmissionRow(typeKey, r));
  // isBrand — İçeriklerim > Eklediklerim'in "Marka" filtresi için (kullanıcı isteği, 2026-09-01
  // madde 3). Marka gönderileri AYRI bir gönderi tipi DEĞİL, offices gönderisidir (bkz.
  // marka-ekle.html: type:'offices') — firma/marka ayrımının TEK kaynağı office-kind.js olduğundan
  // (bkz. o dosyanın başı) karar burada, sunucuda verilir; istemcinin ikinci bir kategori listesi
  // taşımasına gerek kalmaz. productCount burada bilinmiyor (gönderi henüz canonical bir satıra
  // bağlı olmayabilir), bu yüzden yalnızca cats'e bakan 0 geçilir — marka-ekle.html her marka
  // gönderisine zaten en az bir marka kategorisi yazdırır (zorunlu alan).
  if (typeKey === 'offices') {
    for (const item of items) item.isBrand = isBrandOffice(item.cats, 0);
  }
  return json({ items });
}

// src/lib/canonicalSync.js#syncProject/syncProduct'taki AYNI target-bulma deseni (bkz. o
// dosyadaki "existing"/"target" arama sorguları) — bir taslağın karşılık geldiği canonical satırı
// bulur: claimed_slug doluysa slug/legacy_key eşleşmesiyle (sahiplenilen statik/D1 kaydı), değilse
// bu taslağın kendi onayında yazdığı sabit "submission:<id>" işaretiyle (daha önce onaylanmış,
// şimdi tekrar düzenlenen bir kayıt). Hiçbiri yoksa (taslak hiç onaylanmamış) null döner.
async function findCanonicalIdForSubmission(env, table, row) {
  const marker = `submission:${row.id}`;
  const found = row.claimed_slug
    ? await env.DB.prepare(`SELECT id FROM ${table} WHERE deleted_at IS NULL AND (slug = ? OR legacy_key = ?) LIMIT 1`).bind(row.claimed_slug, row.claimed_slug).first()
    : await env.DB.prepare(`SELECT id FROM ${table} WHERE legacy_key = ?`).bind(marker).first();
  return found ? found.id : null;
}

// PROJE ↔ ÜRÜN kutularının KARŞILIKLI/DİNAMİK entegrasyonu (kullanıcı isteği): proje-ekle.html'deki
// "Kullanılan Ürünler / Firmalar" kutusu (brandChips) bir görselde ürün etiketlenince kendiliğinden
// dolar (bkz. o dosyadaki addHotspotBrandChip), ama bu yalnızca O ANKİ oturumda görseldir — taslak
// daha önce kaydedilmiş/onaylanmışsa ve KARŞI taraftan (ör. ürünün kendi formundan "Kullanılan
// Projeler" kutusuyla, ya da BAŞKA bir projenin hotspot etiketiyle) project_products'a bir kenar
// eklenmişse, bu taslağın kendi `brands`/`projects` JSON'u bunu hiç bilmez (yalnızca KENDİ son
// kaydında yazdıklarını taşır) — sayfa yeniden açıldığında karşı taraftan gelen kenar kutuda hiç
// görünmezdi. Bu fonksiyon, gönderiyi döndürmeden hemen önce project_products'taki GÜNCEL DB
// kenarlarını (yön fark etmeksizin, from_project/from_product'a bakılmaksızın) submission'ın kendi
// alanına birleştirir — kutular böylece iki formdan HANGİSİ değiştirilirse değiştirilsin senkron
// kalır. Yalnızca GÖSTERİM içindir: submission satırının kendisine yazılmaz, bir sonraki kaydetme
// yine yalnızca kendi tarafının bayrağını (from_project ya da from_product) sıfırlayıp kurar (bkz.
// canonicalSync.js#setProjectProductLinks) — yani burada eklenen "ödünç" satırlar o taraf hiç
// dokunmadan kaydederse bile SİLİNMEZ, çünkü zaten kendi bayrağı hâlâ 1'dir.
async function enrichSubmissionCrossLinks(env, typeKey, row, item) {
  if (typeKey === 'projects') {
    const projectId = await findCanonicalIdForSubmission(env, 'projects', row);
    if (!projectId) return;
    const { results } = await env.DB.prepare(
      `SELECT p.title AS product, o.name AS brand FROM project_products pp
       JOIN products p ON p.id = pp.product_id
       LEFT JOIN offices o ON o.id = p.brand_office_id
       WHERE pp.project_id = ? AND p.deleted_at IS NULL`
    ).bind(projectId).all();
    const seen = new Set((item.brands || []).map(b => `${(b.brand || '').toLowerCase()}|${(b.product || '').toLowerCase()}`));
    for (const r of results || []) {
      const brand = r.brand || '';
      const product = r.product || '';
      const key = `${brand.toLowerCase()}|${product.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      item.brands = item.brands || [];
      item.brands.push({ brand, product });
    }
  } else if (typeKey === 'products' || typeKey === 'materials') {
    const productId = await findCanonicalIdForSubmission(env, 'products', row);
    if (!productId) return;
    const { results } = await env.DB.prepare(
      `SELECT pr.slug, pr.title FROM project_products pp
       JOIN projects pr ON pr.id = pp.project_id
       WHERE pp.product_id = ? AND pr.deleted_at IS NULL AND pr.hidden_at IS NULL`
    ).bind(productId).all();
    const seen = new Set((item.projects || []).map(p => (typeof p === 'string' ? p : p.slug)));
    for (const r of results || []) {
      if (seen.has(r.slug)) continue;
      seen.add(r.slug);
      item.projects = item.projects || [];
      item.projects.push({ slug: r.slug, title: r.title });
    }
  }
}

// Sahiplik kontrolü admin için atlanır — admin herhangi bir kullanıcının gönderisini görüntüleyip
// düzenleyebilir (bkz. kullanıcı isteği: "admin hesabının tüm gönderilerin düzenleme yetkisi olsun").
// "Bu taslağı açıp düzenleyebilir miyim?" — owner_user_id TEK ÖLÇÜT DEĞİLDİR.
//
// KULLANICI İSTEĞİ (2026-09-10 madde 4/5): Hesabım > Arşivim'deki "Düzenle ve Yayına Al" butonu
// kullanıcıyı içeriğin KENDİ düzenleme sayfasına götürür; kullanıcı orada telif beyanını onaylayıp
// yayına alır. GERÇEK BULGU: toplu arşivlemenin (bkz. src/routes/unassignedArchive.js) ürettiği
// taslakların owner_user_id'si ADMIN'dir — yalnızca owner_user_id'ye bakan eski kontrol, profili
// ÜZERİNE ATANMIŞ kullanıcıya 404 döndürüyordu, yani madde 5'teki akış hiç çalışamazdı.
//
// Bu yüzden sahiplik, taslağın BAĞLI OLDUĞU PROFİL üzerinden de doğrulanır ve bunun için sitenin
// zaten var olan TEK yetki kuralı yeniden kullanılır (verifyClaimedProfileKey — onaylı
// profile_claims + firma-kurucu bağı + firma yetkilisi delegasyonu; claimedSlugVerifierFor —
// proje künyesi / ürün markası). YENİ bir yetki yolu AÇILMAZ: burada geçen bir kullanıcı aynı
// içeriği zaten ?claim= akışıyla da düzenleyebiliyordu.
//
// SİLME/ARŞİVLEME BU KAPIYI KULLANMAZ: moderateOwnSubmission bilerek owner_user_id'ye bağlı kalır
// (bkz. o fonksiyondaki "DELEGASYON YALNIZCA DÜZENLEME YETKİSİDİR" notu ve
// scripts/test-office-member-profile-edit.mjs'teki testi).
async function canAccessSubmissionRow(env, user, typeKey, row) {
  if (user.role === 'admin') return true;
  // KÜNYEDEN ÇIKARILMA (kullanıcı isteği, 2026-09-10 madde 2): owner_user_id dalı, projeyi bir kez
  // düzenlemiş kullanıcıya SÜRESİZ erişim bırakıyordu — künyedeki firmasını kendi eliyle silmiş
  // olsa bile. Damga olgunlaştığında (çıkarılmanın üzerinden 24 saat geçtiğinde) bu dal da kapanır;
  // 24 saat dolmadan HİÇBİR şey değişmez, yani "yanlışlıkla sildim" senaryosu bozulmaz. Bkz.
  // src/lib/projectEditGrace.js ve migrations/0109_project_edit_grace.sql.
  if (typeKey === 'projects' && await projectEditRevokedForSubmission(env, user, row)) return false;
  if (row.owner_user_id && row.owner_user_id === user.id) return true;
  if (row.claimed_profile_key && CLAIM_PROFILE_TYPE[typeKey]) {
    if (!(await verifyClaimedProfileKey(env, user, typeKey, row.claimed_profile_key))) return true;
  }
  if (CLAIMED_SLUG_TYPES.has(typeKey) && row.claimed_slug) {
    if (!(await claimedSlugVerifierFor(typeKey)(env, user, row.claimed_slug))) return true;
  }
  return false;
}

// canAccessSubmissionRow'un damga kapısı — taslağın işaret ettiği canonical proje satırını bulur
// (claimed_slug DOLU ise onun üzerinden, değilse 'submission:<id>' marker'ı üzerinden; ikisi
// src/lib/canonicalSync.js#syncProject'in projeyi bulmak için kullandığı AYNI iki yol) ve o proje
// için kullanıcının damgasının olgunlaşıp olgunlaşmadığını sorar.
async function projectEditRevokedForSubmission(env, user, row) {
  const marker = `submission:${row.id}`;
  const project = row.claimed_slug
    ? await env.DB.prepare(`SELECT id FROM projects WHERE deleted_at IS NULL AND (legacy_key = ? OR slug = ?) LIMIT 1`).bind(row.claimed_slug, row.claimed_slug).first()
    : await env.DB.prepare(`SELECT id FROM projects WHERE legacy_key = ? LIMIT 1`).bind(marker).first();
  if (!project) return false;
  return (await projectEditGraceState(env, project.id, user.id)) === 'revoked';
}

async function getOwnSubmission(env, user, typeKey, id) {
  const row = await findOrHealSubmissionDraft(env, typeKey, id);
  if (!row || !(await canAccessSubmissionRow(env, user, typeKey, row))) return errorJson('Bulunamadı', 404);
  const item = parseSubmissionRow(typeKey, row);
  await enrichSubmissionCrossLinks(env, typeKey, row, item);
  return json({ item });
}

async function updateOwnSubmission(request, env, user, typeKey, id) {
  const config = SUBMISSION_TYPES[typeKey];
  const existing = await findOrHealSubmissionDraft(env, typeKey, id);
  // bkz. canAccessSubmissionRow — okuma (getOwnSubmission) ile yazma AYNI kuralı kullanmalı,
  // aksi halde kullanıcı formu doldurup kaydederken 404 alırdı.
  if (!existing || !(await canAccessSubmissionRow(env, user, typeKey, existing))) return errorJson('Bulunamadı', 404);

  const body = await readJson(request);
  // Kişi adının baş harfleri (kullanıcı isteği, 2026-09-10 dokuzuncu tur madde 1) — TÜM doğrulama
  // ve çakışma kontrollerinden ÖNCE, çünkü `name` bu tipte aynı zamanda ANAHTAR olarak yazılır
  // (bkz. src/lib/textMatch.js#titleCasePersonName'in "neden yazma anında" notu). claimed_profile_key
  // dalı body.name'i aşağıda zaten anahtarın kendisiyle EZDİĞİNDEN, sahiplenilmiş bir profili
  // düzenlemek adı yeniden adlandırmaz — normalizasyon yalnızca serbest yazılan adlara dokunur.
  if (typeKey === 'architects' && typeof body.name === 'string') body.name = titleCasePersonName(body.name);
  // bkz. createSubmission'daki AYNI kapı/gerekçe (kullanıcı isteği, 2026-09-10 madde 1) — düzenleme
  // de bir YAYINLAMA eylemidir (onaylı bir taslağın PATCH'i canonical satıra senkronlanır), bu
  // yüzden beyan burada da her seferinde aranır. AYNI admin istisnası (2026-09-11): admin beyansız
  // kaydederse değişiklik kaydedilir, görünürlük değişmez (keepPreview).
  const rightsAccepted = hasRightsAcceptance(body);
  if (!rightsAccepted && user.role !== 'admin') return requireRightsAcceptance(body);
  const keepPreview = !rightsAccepted;
  const missing = validateRequired(typeKey, body);
  if (missing.length) return errorJson(`Eksik alan(lar): ${missing.join(', ')}`);
  const oversizedField = findOversizedField(typeKey, body, existing);
  if (oversizedField) return errorJson(`"${oversizedField}" alanı çok uzun.`);
  const invalidUrlField = findInvalidUrlField(typeKey, body);
  if (invalidUrlField) return errorJson(`"${invalidUrlField}" alanı geçerli bir bağlantı değil.`);
  const invalidFilesError = findInvalidFilesField(typeKey, body);
  if (invalidFilesError) return errorJson(invalidFilesError);
  const invalidVariantsError = findInvalidVariantsField(typeKey, body); // body.variants'ı yerinde normalize eder
  if (invalidVariantsError) return errorJson(invalidVariantsError);
  const invalidProjectsError = findInvalidProjectsField(typeKey, body);
  if (invalidProjectsError) return errorJson(invalidProjectsError);
  const invalidPortfolioError = findInvalidPortfolioField(typeKey, body);
  if (invalidPortfolioError) return errorJson(invalidPortfolioError);
  const invalidCatsField = findInvalidOfficeCats(typeKey, body);
  if (invalidCatsField) return errorJson(`"${invalidCatsField}" alanı yalnızca izin verilen seçeneklerden oluşabilir.`);
  if (findInvalidSocialPlatform(typeKey, body)) return errorJson('Geçersiz sosyal medya platformu.');
  const invalidTaxonomyField = findInvalidProjectTaxonomyField(typeKey, body);
  if (invalidTaxonomyField) return errorJson(taxonomyFieldError(invalidTaxonomyField));
  if (typeKey === 'architects' && isInvalidSchoolValue(body.school)) return errorJson('Geçerli bir üniversite adı gir (kısaltma kullanma).');
  // bkz. createSubmission'daki AYNI kontrol/gerekçe — publishDate yalnızca admin yazabilir, bu uç
  // admin başka birinin gönderisini düzenlerken de (line 373) kullanıldığından burada da tekrarlanır.
  if (typeKey === 'projects' && user.role !== 'admin') delete body.publishDate;

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
  if (CLAIMED_SLUG_TYPES.has(typeKey) && body.claimed_slug) {
    const err = await claimedSlugVerifierFor(typeKey)(env, user, body.claimed_slug);
    if (err) return err;
  }

  // slug artık düzenlemede KORUNMAZ — başlık değiştiyse project_submissions.slug de yeni başlıktan
  // yeniden üretilir (bkz. kullanıcı isteği: "ismi değişirse URL'si de değişmeli"). Canonical
  // projects.slug'daki asıl değişiklik/çakışma çözümü + eski URL'lerin 301 ile yönlendirilmesi
  // src/lib/canonicalSync.js#syncProject'te yapılır (aşağıdaki syncApprovedSubmissionToCanonical
  // çağrısı) — burası yalnızca bu taslak satırın kendi bookkeeping'i.
  const row = normalizeSubmission(typeKey, body);

  const now = Date.now();
  // P1 GÜVENLİK DÜZELTMESİ (denetim, 2026-09-05) — burası koşulsuz `'approved'` idi ve bu, TÜM
  // moderasyon kuyruğunu atlanabilir kılıyordu: sıradan bir üye createSubmission ile 'pending' bir
  // kayıt oluşturup (yanıt id'yi döner) hemen ardından o id'ye TEK bir PATCH atınca kayıt 'approved'
  // olup syncApprovedSubmissionToCanonical ile ANINDA canlıya (ve sitemap'e, SSR sayfalarına)
  // giriyordu. Canlıda doğrulandı: production'da HİÇBİR tabloda 'pending' satır kalmamış
  // (project/product/architect/office gönderilerinin tamamı 'approved') — yani kuyruk pratikte
  // zaten hiç çalışmıyordu. İstemci tarafı bu durumu ZATEN doğru bekliyordu ama sunucu asla
  // üretmediğinden o dal ölüydü (bkz. proje-ekle.html:2648 / urun-ekle.html:1568 —
  // "Değişiklikler kaydedildi — admin onayının ardından yayına girecek.").
  //
  // Yeni kural, düzeltmenin sebebi olan ÜÇ davranışın HEPSİNİ korur:
  //   * admin                       -> her zaman anında yayında (kullanıcı isteği),
  //   * isOwnerProfileEdit          -> sahiplenilmiş profil/proje/ürün düzenlemesi; yukarıdaki
  //                                    verifyClaimedProfileKey/claimedSlugVerifierFor bunu ZATEN
  //                                    onaylı bir claim'e bağladı (kullanıcı isteği: "kendi ...
  //                                    düzenliyorsa admin onayına gerek yok direkt kaydet"),
  //   * existing.status==='approved'-> ZATEN canlı olan kendi içeriğini düzenlemek onu asla
  //                                    siteden düşürmemeli (bu satırın eskiden 'pending'e düşüp
  //                                    hideCanonicalForUnapprovedSubmission'ı tetiklemesiyle
  //                                    yaşanan regresyon — o gerekçe aynen korunuyor).
  // Geriye YALNIZCA "hâlâ onay bekleyen, claim'siz, admin olmayan gönderi" kalır; o 'pending'
  // KALIR — yani düzenlemek onu yayına sokmaz. Kapsam bilerek DAR tutuldu: 'archived' bir kaydın
  // sahibi düzenleyip yeniden yayınlayabilme davranışı (sahibin zaten moderateOwnSubmission ile
  // arşivleme yetkisi var) OLDUĞU GİBİ korunur, yalnızca hiç onaylanmamış içerik kapıda durur.
  const isOwnerProfileEdit = !!body.claimed_profile_key || (CLAIMED_SLUG_TYPES.has(typeKey) && !!body.claimed_slug);
  const mustStayPending = existing.status === 'pending' && user.role !== 'admin' && !isOwnerProfileEdit;
  const status = mustStayPending ? 'pending' : 'approved';
  const updates = config.fields.map(f => `${f} = ?`);
  const values = config.fields.map(f => row[f]);
  updates.push('status = ?', 'updated_at = ?');
  values.push(status, now, id);

  await env.DB.prepare(
    `UPDATE ${config.table} SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  // Galeriden çıkarılan/üzerine yeni yükleme ile değiştirilen görsellerin eski R2 nesnelerini
  // temizle (bkz. src/lib/canonicalSync.js#cleanupReplacedR2Media) — D1 yazısı BAŞARILI olduktan
  // SONRA çalışır, yazı başarısız olursa (yukarıdaki .run() fırlatırsa) buraya hiç ulaşılmaz.
  if (CANONICAL_TYPES.has(typeKey)) await cleanupReplacedR2Media(env, typeKey, existing, row);

  // Kişi profili -> hesap profili geri senkronu (bkz. syncOwnArchitectToAccount) — "kendisi mi"
  // testi DÜZENLEMEDEN ÖNCEKİ ad (existing.name) ile yapılır, kullanıcı kendi profilinde ad soyadını
  // değiştiriyorsa yeni ad hesabınkiyle henüz eşleşmez.
  const architectRowForSelfCheck = { ...row, claimed_profile_key: body.claimed_profile_key || existing.claimed_profile_key || null };
  await syncOwnArchitectToAccount(env, user, typeKey, architectRowForSelfCheck, existing.name);

  // "Firma veya Marka" alanı -> admin onayı — bkz. createSubmission'daki AYNI çağrı/gerekçe
  // (kullanıcı isteği, 2026-09-08 madde 1).
  if (typeKey === 'architects' && await isOwnArchitectRecord(env, user, architectRowForSelfCheck, existing.name)) {
    await ensurePendingOfficeClaims(env, user, (row.office || '').split(','), newId);
    // ... ve TERS YÖN (kullanıcı isteği, 2026-09-10 madde 1): alandan ÇIKARILAN her firma/marka,
    // kişiyi kendi künyesinden de düşürmeli (bkz. src/lib/officeFounderCascade.js#
    // cascadeRemovedOfficesFromArchitect). Yalnızca kullanıcının KENDİ profilinde çalışır — bu
    // yüzden ensurePendingOfficeClaims ile AYNI isOwnArchitectRecord kapısının içindedir.
    // 'office' body'de HİÇ yoksa (kısmi bir kaydetme) karşılaştırma yapılmaz: `row.office`
    // undefined'ı boş dizeye çevirip "tüm firmalar silindi" sanmak yanlış olurdu.
    if ('office' in body) {
      await cascadeRemovedOfficesFromArchitect(env, existing.name, existing.office, row.office, { claimUserId: user.id });
    }
  }

  // Kurucular listesinden çıkarılan bir isim varsa, o kişinin kendi office alanını temizle (bkz.
  // src/lib/officeFounderCascade.js — gerçek "kurucu/ortak" görünürlüğü bu alandan gelir, founders
  // dizisinin kendisi yalnızca kozmetiktir).
  if (typeKey === 'offices' && 'founders' in body) {
    // "eski liste" = taslağın kayıtlı Kurucular metni + formun kutuda GÖSTERDİĞİ liste
    // (foundersShown, bkz. createSubmission'daki AYNI alan) — ikisinden birinde görünüp yeni
    // listede olmayan kişi koparılır.
    const oldFounders = [
      ...(parseSubmissionRow('offices', existing).founders || []),
      ...(Array.isArray(body.foundersShown) ? body.foundersShown : []),
    ];
    const newFounders = Array.isArray(body.founders) ? body.founders : [];
    // newTeam: Kurucular'dan Ekip'e taşınan kişi firmada kalsın (yalnızca kurucu bağı kalkar).
    // Gövdede Ekip yoksa taslağın mevcut Ekip listesi esas alınır.
    const newTeamForCascade = 'team' in body
      ? (Array.isArray(body.team) ? body.team : [])
      : (parseSubmissionRow('offices', existing).team || []);
    await cascadeRemovedFounders(env, user, existing.name, oldFounders, newFounders, { newTeam: newTeamForCascade });
    await cascadeRemovedProfileClaims(env, existing.name, newFounders, { founders: true });
  }
  // Ekip kutusundan çıkarılan bir isim, o firmaya onaylı bir profile_claims sahibiyse (bkz.
  // src/lib/officeFounderCascade.js#cascadeRemovedProfileClaims dosya başı yorumu) claim'i de
  // reddedilmiş işaretlenir — aksi halde office.js#buildOfficePayload profile_claims'i approved
  // bulup kişiyi Ekip'te GERİ gösteriyordu (gerçek bulgu, bkz. kullanıcı isteği).
  if (typeKey === 'offices' && 'team' in body) {
    const newTeam = Array.isArray(body.team) ? body.team : [];
    await cascadeRemovedProfileClaims(env, existing.name, newTeam, { founders: false });
  }

  // Onaylı içerik ya şimdi onaylandı ya da (sıradan üye kendi onaylı içeriğini düzenlediğinde,
  // bkz. yukarıdaki status ataması) tekrar onay bekler duruma düşüp public'ten kalkmış olabilir —
  // her iki yönde de public önbellek eskimiş olacağından temizlenir. BU BLOK, aşağıdaki
  // updateRenameCascade'DEN ÖNCE çalışmalı: syncArchitect/syncOffice claimed profillerde canonical
  // satırı claimed_profile_key (SABİT, orijinal statik ad) ile bulur — cascade önce çalışıp
  // canonical name/slug'ı DEĞİŞTİRSEYDİ, bu senkron kendi hedefini bulamayıp YANLIŞLIKLA ikinci bir
  // "yeni kayıt" oluştururdu (gerçek bulgu: submission kökenli — legacy_static OLMAYAN — sonradan
  // sahiplenilmiş bir profilde, claimed_profile_key'in ait olduğu ad zaten değişmiş oluyordu).
  let syncedRow = null;
  if (status === 'approved' || existing.status === 'approved') {
    // bkz. src/lib/canonicalSync.js dosya başı yorumu — bkz. src/routes/admin.js#handleSubmissionsAdmin'daki
    // AYNI mantık: onaylandıysa canonical'a senkronla, onaylıyken onay bekler duruma düştüyse
    // (sıradan üyenin kendi onaylı içeriğini düzenlemesi) canonical satırı gizle.
    if (CANONICAL_TYPES.has(typeKey)) {
      if (status === 'approved') {
        const freshRow = await env.DB.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).bind(id).first();
        // bkz. createSubmission'daki AYNI blok — önizlemedeki firma/kişi beyanla yayına alınıyorsa graf.
        const publishGraphType = PUBLISH_GRAPH_PROFILE_TYPE[typeKey] || null;
        const publishingProfileIds = publishGraphType && !keepPreview
          ? await previewProfileIdsByKeys(env, publishGraphType, [body.claimed_profile_key, existing.claimed_profile_key, existing.name, `submission:${id}`]) : [];
        syncedRow = await syncApprovedSubmissionToCanonical(env, typeKey, parseSubmissionRow(typeKey, freshRow), { publish: !keepPreview });
        if (publishingProfileIds.length) await activateProfilesOnPublish(env, publishGraphType, publishingProfileIds, user.id);
      } else if (existing.status === 'approved') {
        await hideCanonicalForUnapprovedSubmission(env, typeKey, existing);
      }
      if (FACET_TYPES.has(typeKey)) await bumpFacetCounts(env, typeKey);
    }
    await invalidatePublicCache(env);
    // Değişiklik ÖNCESİ kaydın kimliğini hedefler (görüntülenen sayfa hâlâ bu anahtar altında
    // önbelleklenmiş olabilir) — bkz. src/lib/ssrCache.js. Slug değiştiyse ESKİ slug'ın önbelleği
    // syncProject/renameOfficeEverywhere/renameArchitectEverywhere içinde ZATEN temizlenir (bkz. o
    // fonksiyonların recordSlugRedirect/purgeSsrDetailCache çağrıları) — burası hâlâ gerekli çünkü
    // slug DEĞİŞMEDEN yapılan bir düzenlemede de (ör. görsel/açıklama güncellemesi) sayfa önbelleği
    // eskimiş olur.
    const target = ssrPurgeTargetFor(typeKey, existing);
    if (target) await purgeSsrDetailCache(target.type, target.key, env);
  }

  // Firma/mimar yeniden adlandırıldıysa (statik/claimed profilde yalnızca admin, claim'siz sıradan
  // bir profilde sahibi de yapabilir — bkz. yukarıdaki istisna) diğer TÜM D1 satırlarını da yeni ada
  // taşı (bkz. src/lib/officeFounderCascade.js#renameOfficeEverywhere/renameArchitectEverywhere) —
  // yukarıdaki senkrondan SONRA çalışır (bkz. o bloğun başındaki yorum). claimed profillerde eski ad
  // HER ZAMAN body.claimed_profile_key'dir (claimed_profile_key kendisi değişmez); claim'siz
  // profillerde eski ad existing.name'dir.
  const updateRenameCascade = RENAME_CASCADE_BY_TYPE[typeKey];
  let renamedSlug = null;
  if (status === 'approved' && updateRenameCascade) {
    const oldName = body.claimed_profile_key || existing.name;
    if (row.name !== oldName) {
      renamedSlug = await updateRenameCascade(env, oldName, row.name);
      // bkz. src/routes/admin.js#handleSubmissionsAdmin'deki AYNI ikinci invalidation — cascade
      // isim/slug'ı DB'de değiştirdikten SONRA public liste/pool önbelleğini tekrar temizler (yukarıdaki
      // ilk invalidatePublicCache() ile cascade arasındaki yarış penceresi düzeltmesi, audit bulgusu).
      await invalidatePublicCache(env);
    }
  }

  // Bekleyen bir gönderi BU İSTEKLE yayına girdiyse sahibine bildirim düşer (kullanıcı isteği,
  // 2026-09-06 madde 3) — bkz. src/lib/notify.js#notifySubmissionApproved'daki GERÇEK BULGU:
  // admin panelinin bekleyen kartındaki "Düzenle / İncele" bağlantısı bu uca gelir ve yukarıdaki
  // `mustStayPending` kuralı gereği admin kaydettiği anda gönderi 'approved' olur — o yol bugüne
  // kadar hiç bildirim üretmiyordu (canlıda MİMARLAB Robotu'nun projesinde görülen davranış).
  // Yalnızca gönderiyi BAŞKASI (admin) onayladıysa gönderilir: kendi bekleyen gönderisini
  // düzenleyip yayına alan bir admin kendine bildirim almamalı.
  if (existing.status === 'pending' && status === 'approved'
      && existing.owner_user_id && existing.owner_user_id !== user.id) {
    const linkRow = await env.DB.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).bind(id).first();
    await notifySubmissionApproved(env, typeKey, { ...(linkRow || existing), owner_user_id: existing.owner_user_id });
  }

  // bkz. createSubmission'daki aynı çağrı/yorum — bu satır önceden arşivlenmiş bir statik kaydın
  // taslağıysa, düzenleme onaylanır onaylanmaz statik kayıt tekrar görünür olmalı.
  // keepPreview (admin beyanı onaylamadan kaydetti): gizli/önizlemedeki statik kayıt görünür YAPILMAZ.
  if (!keepPreview) await unhideIfClaimedApproved(env, user, typeKey, status, CLAIMED_SLUG_TYPES.has(typeKey) ? row.claimed_slug : row.claimed_profile_key);
  // bkz. createSubmission'daki AYNI denetim kaydı (src/lib/rightsConsent.js) — beyansız admin
  // kaydında (keepPreview) iz yazılmaz.
  if (rightsAccepted) await recordRightsAcceptance(env, user, {
    contentType: typeKey,
    contentKey: row.claimed_profile_key || row.claimed_slug || (typeKey === 'projects' ? row.slug : row.name) || null,
    submissionId: id,
    source: 'submit',
  });
  // slug/prefix: proje-ekle.html/kisi-ekle.html/firma-ekle.html'in kaydettikten sonra doğrudan
  // (olası yeni) canlı sayfaya yönlendirebilmesi için (bkz. kullanıcı isteği). architects/offices'te
  // slug'ı asıl DEĞİŞTİREN updateRenameCascade'dir (syncedRow.slug bu adımdan ÖNCEki değeri taşır,
  // bkz. yukarıdaki sıralama yorumu) — renamedSlug varsa o esas alınır, yoksa (isim değişmediyse)
  // syncedRow.slug zaten güncel/değişmemiştir.
  if (typeKey === 'projects' && syncedRow) {
    return json({ id, status, slug: syncedRow.slug, prefix: '/proje/' });
  }
  if ((typeKey === 'architects' || typeKey === 'offices') && (renamedSlug || syncedRow)) {
    return json({ id, status, slug: renamedSlug || syncedRow.slug });
  }
  // bkz. createSubmission'daki AYNI ekleme/gerekçe — düzenleme sonrası da urun-ekle.html'in
  // gerçek/nihai slug'a yönlendirebilmesi için.
  if ((typeKey === 'products' || typeKey === 'materials') && syncedRow) {
    return json({ id, status, slug: syncedRow.slug });
  }
  return json({ id, status });
}

// POST /api/<tip>/:id/moderate  body: {action:'delete'|'archive'} —
// runContentAction (bkz. src/routes/legacyContent.js) kendi başına yetki kontrolü YAPMAZ, o yüzden
// sahiplik burada doğrulanır (admin ya da bu gönderinin owner_user_id'si) — handleContentAction'ın
// (admin panelindeki AYNI fonksiyon) tam tersine, burada 'key' (statik kayıt) YOLU İSTEMCİDEN hiç
// kabul edilmez; hedef her zaman kullanıcının KENDİ gönderi satırından türetilir.
//
// architects/offices (kullanıcı isteği, 2026-09-06 madde 4: "Kullanıcıların kendi yükledikleri
// gönderilerde de ... Değişikliği Kaydet butonunun altında Arşivle ve Sil butonları olsun"):
// eskiden yalnızca products/materials'ta sahip moderasyonu vardı, kişi/firma/marka gönderilerinde
// Arşivle/Sil YALNIZCA admine görünüyordu (bkz. kisi-ekle.html#mountArchitectAdminActions'ın eski
// `if(!isAdmin) return;` kapısı).
//
// GÜVENLİK — targetKey İSTEMCİDEN GELMEZ: runContentAction'ın `key` yolu canonical satırı DOĞAL
// ANAHTARLA (isim/slug/legacy_key) bulur, yani serbest bir key kabul etseydik kullanıcı kendi
// gönderisinin id'siyle BAŞKASININ canonical kaydını (ör. adını "Zaha Hadid" yazarak) sildirebilirdi.
// Bu yüzden anahtar iki güvenli kaynaktan türetilir:
//   * claimed_profile_key — yalnızca ONAYLI bir profile_claims ile yazılabilir (bkz.
//     verifyClaimedProfileKey), zaten runContentAction'ın claimedColumn dalı okur;
//   * yoksa `submission:<id>` işareti — canonical satır tam olarak BU gönderiden doğmuşsa onun
//     legacy_key'idir (bkz. src/lib/canonicalSync.js#syncArchitect/syncOffice), başka hiçbir satıra
//     denk gelemez. Eşleşen canonical satır yoksa setLegacyHidden/findCanonicalRowByNaturalKey
//     sessizce hiçbir şey yapmaz (bkz. o fonksiyonlar) — yalnızca gönderi satırı arşivlenir/silinir.
const OWNER_MODERATE_TYPES = new Set(['products', 'materials', 'architects', 'offices']);
// MODERASYON YETKİSİ ARTIK DÜZENLEME YETKİSİYLE AYNIDIR (kullanıcı isteği, 2026-09-10 madde 2:
// "Kullanıcıların yetkisi oldukları firma, marka, proje, ürün ve kişi profillerini arşivleme ve
// silme yetkileri olsun.") — kapı canAccessSubmissionRow, yani düzenlemeyle BİREBİR aynı kural:
// owner_user_id, claimed_profile_key üzerinden onaylı talep/firma yetkisi, ya da claimed_slug
// üzerinden proje künyesi / ürün markası.
//
// BU, 2026-09-08'DEKİ "DELEGASYON YALNIZCA DÜZENLEME YETKİSİDİR" KARARINI BİLEREK GERİ ALIR:
// o tarihte bir firma yetkilisinin, ortağının KİŞİ profilini silmesi/arşivlemesi engellenmişti.
// Kullanıcı bunun tersini istedi. Kalan güvenlik ağı claimedProfiles.js#
// canEditArchitectViaOfficeMembership'in SINIR'ıdır: hedef kişi profilini BAŞKA bir hesap onaylı bir
// profile_claims('architect') ile sahiplenmişse o profile bu kapı hiç açılmaz — yani bir firma
// yetkilisi, profilinin sahibi olan bir ortağının profilini yine silemez. Bu ağ kalkarsa madde 2
// "herkesin kendi profilini kaybedebilmesi" anlamına gelirdi.
//
// SİLME GERİ ALINAMAZ (runContentAction 'delete' -> deleteCanonicalRowFully) — arşivleme ise
// geri alınabilir bir taslak bırakır.
async function moderateOwnSubmission(request, env, user, typeKey, id) {
  if (!OWNER_MODERATE_TYPES.has(typeKey)) return errorJson('Bulunamadı', 404);
  const existing = await findOrHealSubmissionDraft(env, typeKey, id);
  if (!existing || !(await canAccessSubmissionRow(env, user, typeKey, existing))) return errorJson('Bulunamadı', 404);
  const body = await readJson(request);
  if (!['delete', 'archive'].includes(body.action)) return errorJson('Geçersiz işlem.');
  const key = (typeKey === 'architects' || typeKey === 'offices') && !existing.claimed_profile_key
    ? `submission:${id}`
    : undefined;
  return runContentAction(env, user, { type: typeKey, action: body.action, id, key });
}

// KANONİK ANAHTARLA MODERASYON — src/routes/legacyContent.js#handleSelfProjectDelete/
// handleSelfProjectModerate'in kişi/firma/marka/ürün karşılığı (kullanıcı isteği, 2026-09-10
// madde 2). moderateOwnSubmission bir *_submissions satırının id'sini ister; bu ise kaydın
// KENDİ anahtarını (kişi/firma adı ya da ürün slug'ı) alır.
//
// NEDEN GEREKLİ: yetkisi olan bir kullanıcının o kayıt için henüz bir taslağı OLMAYABİLİR —
// bir firma yetkilisi ortağının profilini ilk kez açtığında (kisi-ekle.html?claim=…) ortada
// düzenlenecek bir gönderi satırı yoktur, dolayısıyla id tabanlı uç kullanılamaz. runContentAction'ın
// `key` dalı bu durumda canonical satırdan arşiv taslağını KENDİSİ üretir (ve owner_user_id'sini
// çağırana yazar, yani kayıt o kullanıcının Hesabım > Arşivim kutusunda görünür).
//
// YETKİ, DÜZENLEMEYLE AYNI TEK KAYNAKTAN OKUNUR (verifyClaimedProfileKey /
// verifyProductClaimedSlug) — istemci kuralı yeniden hesaplamaz, admin bypass'ı da o
// fonksiyonların içindedir.
export async function handleSelfContentModerate(request, env, typeKey, key, action) {
  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);
  if (!['delete', 'archive'].includes(action)) return errorJson('Geçersiz işlem.');
  if (typeKey === 'products') {
    const err = await verifyProductClaimedSlug(env, user, key);
    if (err) return err;
  } else if (typeKey === 'architects' || typeKey === 'offices') {
    const err = await verifyClaimedProfileKey(env, user, typeKey, key);
    if (err) return err;
  } else {
    return errorJson('Bulunamadı', 404);
  }
  return runContentAction(env, user, { type: typeKey, action, key });
}
