import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { SUBMISSION_TYPES, normalizeSubmission, parseSubmissionRow, validateRequired, findInvalidUrlField, findInvalidSocialPlatform, isInvalidSchoolValue, findInvalidProjectTaxonomyField, findOversizedField, findInvalidFilesField, findInvalidProjectsField, findInvalidOfficeCats } from '../lib/submissionTypes.js';
import { invalidatePublicCache } from '../lib/publicCache.js';
import { purgeSsrDetailCache, ssrPurgeTargetFor } from '../lib/ssrCache.js';
import { cascadeRemovedFounders, cascadeRemovedProfileClaims, renameOfficeEverywhere, renameArchitectEverywhere } from '../lib/officeFounderCascade.js';
import { canUserEditProjectBySlug, canUserEditProductBySlug } from '../lib/projectClaimAccess.js';
import { setLegacyHidden, runContentAction } from './legacyContent.js';
import { syncApprovedSubmissionToCanonical, hideCanonicalForUnapprovedSubmission, isDuplicateCanonicalName, cleanupReplacedR2Media, findOrHealSubmissionDraft } from '../lib/canonicalSync.js';
import { bumpFacetCounts } from '../lib/facetCounts.js';
import { canonicalRowExistsByKey } from '../lib/canonicalRead.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { notifyNewsletterOfNewContent } from '../lib/newsletterNotify.js';
import { foldTr } from '../lib/textMatch.js';
// bkz. src/routes/office.js'teki AYNI CJS-interop içe aktarma deseni — firma/marka ayrımının tek kaynağı.
import officeKindJs from '../../office-kind.js';

const { isBrandOffice } = officeKindJs;

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
  await setLegacyHidden(env, user, typeKey, key, false);
}

const CANONICAL_TABLE_BY_TYPE = { architects: 'architects', offices: 'offices' };

// Bir firmayı düzenleme yetkisi artık yalnızca onaylı bir profile_claims('office') kaydına değil,
// kullanıcının O ANKİ pozisyonuna da bağlı (bkz. kullanıcı isteği: "Firma düzenleme yetkisi sadece
// admin, firma kurucusu, kurucu ortağı, ortağı ve ekip liderinde olsun") — Ekip Üyesi (ya da başka
// bir pozisyon) ile onaylanmış bir claim artık düzenleme HAKKI vermez, yalnızca firma.html#Ekip'te
// görünmeyi sağlar (bkz. src/routes/office.js#buildOfficePayload). Yalnızca 'offices' için geçerli —
// bir mimarın kendi profilini düzenlemesi pozisyonundan bağımsızdır.
const OFFICE_EDIT_POSITIONS = new Set(['Kurucu', 'Kurucu Ortak', 'Ortak', 'Ekip Lideri']);

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
  if (!claim) return errorJson('Bu profili düzenlemek için önce profili sahiplenip onayının geçmesi gerekiyor.', 403);
  // P1 güvenlik düzeltmesi (bkz. migrations/0068): canlı user.position YERİNE, admin bu claim'i
  // onayladığı andaki dondurulmuş office_position kullanılır — aksi halde kullanıcı kendi
  // profilinden position'ını "Kurucu" yapıp bu kontrolü atlatabilirdi.
  if (typeKey === 'offices' && !OFFICE_EDIT_POSITIONS.has(claim.office_position)) {
    return errorJson('Bu firmayı düzenlemek için Kurucu, Kurucu Ortak, Ortak ya da Ekip Lideri pozisyonunda olman gerekiyor.', 403);
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

async function createSubmission(request, env, user, typeKey) {
  // Hiçbir gönderi tipinde (products/materials dahil, bkz. kullanıcı isteği: rozet şartı kaldırıldı)
  // aylık bir üst sınır yok — oturum açmış tek bir hesabın kısa vadede admin moderasyon kuyruğunu
  // doldurmasına karşı tek koruma bu genel saatlik patlama (burst) limiti.
  if (!(await checkRateLimit(env, 'submission', user.id, 20, 60 * 60 * 1000))) {
    return errorJson('Çok fazla gönderi oluşturdun. Lütfen biraz sonra tekrar dene.', 429, { 'Retry-After': '3600' });
  }

  const body = await readJson(request);
  const missing = validateRequired(typeKey, body);
  if (missing.length) return errorJson(`Eksik alan(lar): ${missing.join(', ')}`);
  const oversizedField = findOversizedField(typeKey, body);
  if (oversizedField) return errorJson(`"${oversizedField}" alanı çok uzun.`);
  const invalidUrlField = findInvalidUrlField(typeKey, body);
  if (invalidUrlField) return errorJson(`"${invalidUrlField}" alanı geçerli bir bağlantı değil.`);
  const invalidFilesError = findInvalidFilesField(typeKey, body);
  if (invalidFilesError) return errorJson(invalidFilesError);
  const invalidProjectsError = findInvalidProjectsField(typeKey, body);
  if (invalidProjectsError) return errorJson(invalidProjectsError);
  const invalidCatsField = findInvalidOfficeCats(typeKey, body);
  if (invalidCatsField) return errorJson(`"${invalidCatsField}" alanı yalnızca izin verilen seçeneklerden oluşabilir.`);
  if (findInvalidSocialPlatform(typeKey, body)) return errorJson('Geçersiz sosyal medya platformu.');
  const invalidTaxonomyField = findInvalidProjectTaxonomyField(typeKey, body);
  if (invalidTaxonomyField) return errorJson(`"${invalidTaxonomyField}" alanı yalnızca izin verilen seçeneklerden oluşabilir.`);
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

  // Bu, önceden arşivlenmiş (bkz. handleContentAction/handleProjectAction) bir statik kaydın
  // taslağıysa (nadir — normalde prefillForClaim mevcut taslağı bulup PATCH'e düşer) statik kayıt
  // hâlâ gizli olabilir; onaylandığı an tekrar görünür olmalı (bkz. unhideIfClaimedApproved).
  await unhideIfClaimedApproved(env, user, typeKey, status, CLAIMED_SLUG_TYPES.has(typeKey) ? body.claimed_slug : body.claimed_profile_key);

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
  let syncedRow = null;
  if (status === 'approved') {
    // bkz. src/lib/canonicalSync.js dosya başı yorumu — okuma yolları artık canonical tabloları
    // okuyor, admin'in anında yayına giren kendi gönderisi de aynı anda oraya senkronlanmalı.
    if (CANONICAL_TYPES.has(typeKey)) {
      const freshRow = await env.DB.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).bind(id).first();
      syncedRow = await syncApprovedSubmissionToCanonical(env, typeKey, parseSubmissionRow(typeKey, freshRow));
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
    if (CANONICAL_TYPES.has(typeKey) && !isOwnerProfileEdit && !(typeKey === 'projects' && body.claimed_slug)) {
      await notifyNewsletterOfNewContent(env, typeKey, syncedRow || { ...row, id });
    }
  }
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

// Sahiplik kontrolü admin için atlanır — admin herhangi bir kullanıcının gönderisini görüntüleyip
// düzenleyebilir (bkz. kullanıcı isteği: "admin hesabının tüm gönderilerin düzenleme yetkisi olsun").
async function getOwnSubmission(env, user, typeKey, id) {
  const row = await findOrHealSubmissionDraft(env, typeKey, id);
  if (!row || (row.owner_user_id !== user.id && user.role !== 'admin')) return errorJson('Bulunamadı', 404);
  return json({ item: parseSubmissionRow(typeKey, row) });
}

async function updateOwnSubmission(request, env, user, typeKey, id) {
  const config = SUBMISSION_TYPES[typeKey];
  const existing = await findOrHealSubmissionDraft(env, typeKey, id);
  if (!existing || (existing.owner_user_id !== user.id && user.role !== 'admin')) return errorJson('Bulunamadı', 404);

  const body = await readJson(request);
  const missing = validateRequired(typeKey, body);
  if (missing.length) return errorJson(`Eksik alan(lar): ${missing.join(', ')}`);
  const oversizedField = findOversizedField(typeKey, body, existing);
  if (oversizedField) return errorJson(`"${oversizedField}" alanı çok uzun.`);
  const invalidUrlField = findInvalidUrlField(typeKey, body);
  if (invalidUrlField) return errorJson(`"${invalidUrlField}" alanı geçerli bir bağlantı değil.`);
  const invalidFilesError = findInvalidFilesField(typeKey, body);
  if (invalidFilesError) return errorJson(invalidFilesError);
  const invalidProjectsError = findInvalidProjectsField(typeKey, body);
  if (invalidProjectsError) return errorJson(invalidProjectsError);
  const invalidCatsField = findInvalidOfficeCats(typeKey, body);
  if (invalidCatsField) return errorJson(`"${invalidCatsField}" alanı yalnızca izin verilen seçeneklerden oluşabilir.`);
  if (findInvalidSocialPlatform(typeKey, body)) return errorJson('Geçersiz sosyal medya platformu.');
  const invalidTaxonomyField = findInvalidProjectTaxonomyField(typeKey, body);
  if (invalidTaxonomyField) return errorJson(`"${invalidTaxonomyField}" alanı yalnızca izin verilen seçeneklerden oluşabilir.`);
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

  // Kurucular listesinden çıkarılan bir isim varsa, o kişinin kendi office alanını temizle (bkz.
  // src/lib/officeFounderCascade.js — gerçek "kurucu/ortak" görünürlüğü bu alandan gelir, founders
  // dizisinin kendisi yalnızca kozmetiktir).
  if (typeKey === 'offices' && 'founders' in body) {
    const oldFounders = parseSubmissionRow('offices', existing).founders;
    const newFounders = Array.isArray(body.founders) ? body.founders : [];
    await cascadeRemovedFounders(env, user, existing.name, oldFounders, newFounders);
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
        syncedRow = await syncApprovedSubmissionToCanonical(env, typeKey, parseSubmissionRow(typeKey, freshRow));
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

  // bkz. createSubmission'daki aynı çağrı/yorum — bu satır önceden arşivlenmiş bir statik kaydın
  // taslağıysa, düzenleme onaylanır onaylanmaz statik kayıt tekrar görünür olmalı.
  await unhideIfClaimedApproved(env, user, typeKey, status, CLAIMED_SLUG_TYPES.has(typeKey) ? row.claimed_slug : row.claimed_profile_key);
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

// POST /api/products/:id/moderate ve /api/materials/:id/moderate  body: {action:'delete'|'archive'} —
// runContentAction (bkz. src/routes/legacyContent.js) kendi başına yetki kontrolü YAPMAZ, o yüzden
// sahiplik burada doğrulanır (admin ya da bu gönderinin owner_user_id'si) — handleContentAction'ın
// (admin panelindeki AYNI fonksiyon) tam tersine, burada 'key' (statik kayıt) YOLU hiç kullanılmaz;
// yalnızca bir kullanıcının/marka gönderisinin (id'li) kendi kaydı hedeflenebilir.
async function moderateOwnSubmission(request, env, user, typeKey, id) {
  if (typeKey !== 'products' && typeKey !== 'materials') return errorJson('Bulunamadı', 404);
  const existing = await findOrHealSubmissionDraft(env, typeKey, id);
  if (!existing || (existing.owner_user_id !== user.id && user.role !== 'admin')) return errorJson('Bulunamadı', 404);
  const body = await readJson(request);
  if (!['delete', 'archive'].includes(body.action)) return errorJson('Geçersiz işlem.');
  return runContentAction(env, user, { type: typeKey, action: body.action, id });
}
