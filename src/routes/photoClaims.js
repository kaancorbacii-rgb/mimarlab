import { json, errorJson, readJson } from '../lib/http.js';
import { getSessionUser } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { createNotification } from '../lib/notify.js';
import { invalidatePublicCache } from '../lib/publicCache.js';
import { purgeSsrDetailCache } from '../lib/ssrCache.js';
import { foldTr } from '../lib/textMatch.js';
import { likePattern } from '../lib/searchFold.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { findOneByName, splitPhotographerNames } from '../lib/canonicalSync.js';
import { fetchOfficeManagers, canEditArchitectAsCreator } from '../lib/claimedProfiles.js';
import { OFFICE_EDIT_POSITIONS } from '../lib/projectClaimAccess.js';
import { canonicalRowExistsByKey, resolveCanonicalName } from '../lib/canonicalRead.js';

// ============================================================================================
// "FOTOĞRAFLARINI BUL" — FOTOĞRAFÇI KÜNYESİ TALEBİ + ONAY AKIŞI
// ============================================================================================
// Kullanıcı isteği, 2026-09-16 ÜÇÜNCÜ tur madde 3: "Kişi popuplarında Fotoğraflarım başlığının
// yanında 'Fotoğraflarını Bul' butonu olsun ve buna tıklayınca sitedeki yüklü tüm projelerden
// kullanıcı bir projeyi seçebilsin. Bu seçim seçilen projenin firmasını yöneticisine ve admine
// bildirim olarak gitsin. Firma yöneticisi veya admin bu bildirime onay verirse proje künyesine
// fotoğrafçı otomatik olarak eklensin."
//
// GİRİŞ NOKTASI DEĞİŞTİ (aynı gün, ikinci tur -> üçüncü tur): akış önce lightbox'taki "Fotoğraf
// bana ait" butonundan başlıyordu ve kullanıcı bir GÖRSEL sahipleniyordu; o buton kullanıcı isteği
// (üçüncü tur madde 2) ile KALDIRILDI. Artık talep kişi pop-up'ından açılıyor ve bir PROJE
// sahiplenilir. Bunun üç yapısal sonucu var:
//   * Talep artık tek bir kareye bağlanmaz — `project_photo_claims.image_url` kolonu DURUYOR ama
//     bu akış onu HİÇ YAZMAZ (kısmi UNIQUE indeks COALESCE(image_url,'') kullandığından kural
//     kendiliğinden "kullanıcı başına proje başına tek bekleyen talep" hâline gelir).
//   * Onay artık YALNIZCA künyeye yazar (projects.photo_credit_text + project_photographers) —
//     görsel bazlı `image_credits` eşlemesi bu akışta hiç oluşmaz. O kolon ve onu yazan
//     proje-ekle akışı (ikinci tur madde 1) DEĞİŞMEDEN duruyor.
//   * Künyeye yazılacak ad İSTEMCİDEN GELMEZ: kullanıcı bir KİŞİ PROFİLİ üzerinden talep açar ve
//     ad o profilin canonical `name`'inden okunur. Serbest metin kabul edilseydi herhangi bir üye
//     istediği adı bir projenin künyesine önerebilirdi.
//
// Bu dosya src/routes/hotspotTags.js'in KARDEŞİDİR ve onun desenini birebir izler (aynı uç
// isimleri, aynı 'pending'/'approved'/'rejected' sözlüğü, aynı "admin onaya düşmez" kısayolu,
// aynı bildirim→pop-up bağlantı biçimi). Ayrı bir dosya olmasının gerekçesi: etiketlenen şey bir
// ÜRÜN değil bir KİŞİ PROFİLİ, karar verenler ürünün markası değil PROJENİN FİRMA YÖNETİCİLERİ ve
// yazma hedefi image_hotspots değil photo_credit_text + project_photographers.
//
// TASARIM KARARLARI (ve NEDEN):
//
// 1) KİM TALEP AÇABİLİR — YALNIZCA o kişi profilinin KENDİ yöneticisi ve admin (kullanıcı isteği,
//    2026-09-16 DÖRDÜNCÜ tur: "Kişi popupında sadece kişi popupının yöneticisi ve admin bu butonu
//    görebilsin"). Kapı `architectManagerGate`: admin VEYA o profil için onaylı bir
//    profile_claims('architect') VEYA kaydı siteye kendi ekleyen (claimed_by_user_id —
//    bkz. claimedProfiles.js#canEditArchitectAsCreator).
//
//    NEDEN `submissions.js#verifyClaimedProfileKey` DEĞİL (üçüncü turda o kullanılıyordu): o kapı
//    BİLEREK DAHA GENİŞ — dördüncü bir yol olarak FİRMA YETKİLİSİ DELEGASYONUNU da kabul eder
//    (canEditArchitectViaOfficeMembership: bir firmanın yetkilisi, künyesindeki BAŞKA kişilerin
//    profillerini de düzenleyebilir). Kullanıcı isteği tam olarak o yolu kapatıyor: bir firma
//    yetkilisi, ekibindeki bir kişinin adına "bu projenin fotoğraflarını o çekti" talebi
//    AÇAMAMALI. Bu yüzden burada AYRI ve DAHA DAR bir kapı var — aynı kuralın kopyası değil,
//    BİLİNÇLİ olarak farklı bir kural.
//
//    İSTEMCİ AYNI DARALTMAYI YAPAR: claim-correction-box.js#isProfileManager (Düzenle/Proje Ekle
//    butonlarının kullandığı isAuthorizedEditor'ın delegasyon yolu ÇIKARILMIŞ hâli). İki taraf
//    ayrışırsa düğmeyi gören kullanıcı 403 alırdı; test ikisini birlikte kelepçeler.
//
//    NEDEN "giriş yapmış herkes" DEĞİL (hotspotTags.js'teki kapının aksine): orada etiketlenen şey
//    herkese açık bir üründür ve öneri yanlışsa yalnızca reddedilir. Burada talep, bir kişi
//    profilini bir projenin künyesine yazmayı önerir.
//
//    Kuyruk spam'ine karşı kullanıcı başına saatlik tavan (CLAIM_HOURLY_LIMIT): her bekleyen talep
//    TÜM adminlere birer bildirim üretir.
//
// 2) KİM KARAR VERİR — admin VEYA projenin künyesindeki firmaların YÖNETİCİLERİ. Karar kümesi ile
//    BİLDİRİM ALICILARI TEK BİR fonksiyondan (decisionRecipients) türer; iki liste ayrı ayrı
//    hesaplanırsa biri diğerinde olmayan bir kullanıcıya "onayına sunuldu" bildirimi gider ve o
//    kişi butona bastığında 403 alırdı. Yöneticinin tanımı da bu depodaki TEK kaynaktan okunur
//    (claimedProfiles.js#fetchOfficeManagers + OFFICE_EDIT_POSITIONS) — yani "Hesabım > Yetkili
//    Kullanıcılar" listesinde görünen kümeyle birebir aynıdır.
//
//    PROJEYİ EKLEYEN ÜYE ve KÜNYEDEKİ MİMARLAR BİLEREK DIŞARIDA: kullanıcı isteği "firma
//    yöneticilerine ve admine" diyor. Eklenecekse tek yer decisionRecipients'tır.
//
// 3) ONAY KUYRUĞU ATLATILAMAZ — POST, status'ü İSTEMCİDEN HİÇ OKUMAZ; yalnızca isteği yapanın
//    rolüne bakar (admin -> 'approved' + anında uygula, diğer herkes -> 'pending'). Karar verme
//    (decide) TAMAMEN AYRI bir uçtur ve kendi yetki kontrolü var. Bkz. hotspotTags.js tasarım
//    notu 3 ve proje notu [[project_submission_moderation_bypass_2026_09_05]].
//
// 4) ONAYLANINCA NEREYE YAZILIR — kullanıcı isteği tek hedef sayıyor ("proje künyesine fotoğrafçı
//    otomatik olarak eklensin"):
//      * projects.photo_credit_text  -> künyedeki "Fotoğraf" satırı,
//      * project_photographers       -> künyedeki adın TIKLANABİLİR profil çipi olması için
//        (bkz. src/routes/project.js#fetchPhotographerDetails; kenar kurulmazsa ad düz metin
//        kalırdı). Eşleşme kuralı canonicalSync#syncProject'teki ile AYNI (findOneByName) — iki yol
//        ayrışırsa aynı ad bir yolda çipe, diğerinde metne dönerdi.
//    ve AYRICA varsa projenin project_submissions taslağı. Yalnızca canonical'a yazmak SESSİZ VERİ
//    KAYBI olurdu: proje sahibi projesini bir daha kaydettiğinde canonicalSync#syncProject
//    canonical satırın photo_credit_text'ini taslaktan BAŞTAN yazar ve onaylanmış ad iz bırakmadan
//    silinirdi (bkz. hotspotTags.js tasarım notu 4 — AYNI tuzak).
//
// 5) PROJE SEÇİCİSİNİN LİSTESİ ayrı ve OTURUMA BAĞLI bir uçtan gelir (GET .../projects) —
//    /api/projects/search'e DOKUNULMADI: o uç herkese açık, önbellekli ve 2 karakterin altındaki
//    sorguları bilinçli olarak D1'e hiç göndermiyor (bkz. o fonksiyonun D1 maliyet notu), yani
//    "sorgusuz açılışta listeyi doldur" davranışı oraya eklenemezdi. Desen
//    hotspotTags.js#listTaggableProducts ile BİREBİR aynı: herkese açık aramanın yetkiye duyarlı,
//    ASLA önbelleklenmeyen karşılığı.
// ============================================================================================

const PENDING = 'pending';

// Kullanıcı başına SAATLİK talep tavanı (bkz. tasarım notu 1). 10: gerçek bir fotoğrafçının bir
// oturumda birkaç projedeki karelerini sahiplenmesine yeter, tek hesabın admin bildirim kutusunu
// doldurmasını engeller.
const CLAIM_HOURLY_LIMIT = 10;

// Künyeye yazılacak adın üst sınırı. Ad artık istemciden gelmiyor (canonical architects.name'den
// okunuyor, bkz. dosya başı) — sınır yine de duruyor: bozuk/aşırı uzun bir canonical ad
// photo_credit_text'i şişirmesin.
const MAX_NAME_LEN = 200;

// Proje seçicisinin tek seferde döndürdüğü en fazla satır (bkz. tasarım notu 5).
const PROJECT_PICKER_LIMIT = 40;

function isAdmin(user) { return !!user && user.role === 'admin'; }

function parseImages(raw) {
  try { const arr = raw ? JSON.parse(raw) : []; return Array.isArray(arr) ? arr : []; } catch { return []; }
}

// Kapak görseli — proje seçicisinin satır küçük resmi ve onay pop-up'ının önizlemesi (bkz.
// hotspotTags.js#firstImage ile AYNI desen).
function firstImage(imagesJson) {
  const arr = parseImages(imagesJson);
  return arr.length ? (arr[0] || null) : null;
}

async function adminUserIds(env) {
  const { results } = await env.DB.prepare("SELECT id FROM users WHERE role = 'admin'").all();
  return (results || []).map(r => r.id);
}

// Projenin künyesindeki FİRMA adları — project_designers'ın office tarafı (bkz.
// src/routes/project.js#fetchDesignerDetails'teki AYNI kenar). Arşivdeki/gizli firmalar da
// okunur: bir firmanın yöneticisi, firma o an yayında olmasa bile künyesindeki fotoğraf
// talebine karar verebilmeli.
async function projectOfficeNames(env, projectId) {
  const { results } = await env.DB.prepare(
    `SELECT ofc.name AS name
       FROM project_designers pd
       JOIN offices ofc ON ofc.id = pd.office_id AND ofc.deleted_at IS NULL
      WHERE pd.project_id = ?`
  ).bind(projectId).all();
  return [...new Set((results || []).map(r => r.name).filter(Boolean))];
}

// KARAR KÜMESİ + BİLDİRİM ALICILARI — TEK kaynak (bkz. tasarım notu 2). Döner: Set<userId>
// (adminler DAHİL DEĞİL; onlar ayrıca ve koşulsuz eklenir/yetkilidir).
async function officeManagerUserIds(env, projectId) {
  const names = await projectOfficeNames(env, projectId);
  const ids = new Set();
  for (const name of names) {
    const managers = await fetchOfficeManagers(env, name, OFFICE_EDIT_POSITIONS);
    for (const m of managers) if (m && m.userId) ids.add(m.userId);
  }
  return ids;
}

// Bu talebi kim karara bağlayabilir. Bildirim alıcılarıyla AYNI kümeden türer (bkz. tasarım
// notu 2) — ayrışırsa bildirimi alan kişi butona bastığında 403 alırdı.
async function canDecide(env, user, projectId) {
  if (isAdmin(user)) return true;
  if (!user || !projectId) return false;
  return (await officeManagerUserIds(env, projectId)).has(user.id);
}

// ---------------------------------------------------------------------------------------------
// Onaylanmış bir talebi GERÇEKTEN uygular (bkz. tasarım notu 4).
// Döndürür: { ok: true, projectSlug } | { ok: false, error: '<kullanıcıya gösterilecek sebep>' }
// ---------------------------------------------------------------------------------------------
async function applyPhotoClaim(env, claim) {
  const project = await env.DB.prepare(
    `SELECT id, slug, legacy_key, photo_credit_text
       FROM projects WHERE slug = ? AND deleted_at IS NULL`
  ).bind(claim.project_slug).first();
  if (!project) return { ok: false, error: 'Proje artık yayında değil.' };

  const name = String(claim.claimed_name || '').trim().slice(0, MAX_NAME_LEN);
  if (!name) return { ok: false, error: 'Künyeye yazılacak bir ad yok.' };

  // (a) Künye metni — ad zaten varsa DOKUNULMAZ. Karşılaştırma foldTr ile: "Ayça"/"Ayca" bu depoda
  // AYNI addır (bkz. CLAUDE.md "Bir projede aynı ad künyeye İKİ KEZ yazılamaz") ve birebir metin
  // karşılaştırması aynı kişiyi künyeye ikinci kez yazardı.
  const existingNames = splitPhotographerNames(project.photo_credit_text);
  const alreadyCredited = existingNames.some(n => foldTr(n) === foldTr(name));
  const creditText = alreadyCredited ? (project.photo_credit_text || '') : [...existingNames, name].join(', ');

  await env.DB.prepare(
    `UPDATE projects SET photo_credit_text = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(creditText || null, project.id).run();

  // (b) Tıklanabilir fotoğrafçı çipi — ad sitede bir KİŞİ kaydıyla eşleşiyorsa kenar kurulur.
  // Kural canonicalSync#syncProject'teki ile AYNI (bkz. tasarım notu 4). Talep her zaman bir kişi
  // profilinden açıldığı için eşleşme pratikte HER ZAMAN bulunur; yine de `if (match.row)` korunur
  // — profil bu arada silinmiş/yeniden adlandırılmış olabilir ve o durumda künyedeki düz metin,
  // hiçbir şey yazmamaktan iyidir.
  if (!alreadyCredited) {
    const match = await findOneByName(env, 'architects', name);
    if (match.row) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO project_photographers (project_id, architect_id) VALUES (?, ?)`
      ).bind(project.id, match.row.id).run();
    }
  }

  // (c) Taslak(lar) — bkz. tasarım notu 4. Eşleştirme hotspotTags.js#applyHotspot ile BİREBİR aynı
  // iki yoldan yapılır (claimed_slug ya da legacy_key="submission:<id>") ve birden fazla taslak
  // aynı projeye bağlı olabileceğinden HEPSİ güncellenir.
  const marker = /^submission:(.+)$/.exec(project.legacy_key || '');
  const drafts = await env.DB.prepare(
    `SELECT id, photoCreditText FROM project_submissions
      WHERE claimed_slug IN (?, ?) OR (? IS NOT NULL AND id = ?)`
  ).bind(project.slug, project.legacy_key || '', marker ? marker[1] : null, marker ? marker[1] : '').all();
  for (const draft of (drafts.results || [])) {
    const draftNames = splitPhotographerNames(draft.photoCreditText);
    if (draftNames.some(n => foldTr(n) === foldTr(name))) continue;
    await env.DB.prepare('UPDATE project_submissions SET photoCreditText = ? WHERE id = ?')
      .bind([...draftNames, name].join(', '), draft.id).run();
  }

  // invalidatePublicCache() TEK BAŞINA YETMEZ — /api/project/:slug detay yanıtı caches.default'ta
  // 5 dakikalık s-maxage ile durur ve listFingerprint TAŞIMAZ, yani HIT yolunda tazelik
  // DOĞRULANMAZ: onay veren kişi "onayladım ama görünmüyor" diye bakakalırdı. Bkz.
  // hotspotTags.js#applyHotspot'taki AYNI gerçek bulgu ve purgeSsrDetailCache gerekçesi.
  await Promise.all([
    invalidatePublicCache(env),
    purgeSsrDetailCache('project', project.slug, env),
  ]);
  return { ok: true, projectSlug: project.slug };
}

// ---------------------------------------------------------------------------------------------
// Router. /access dışındaki TÜM uçlar oturum ister (bkz. hotspotTags.js'teki AYNI desen):
// bekleyen talepler yayında görünmeyen içeriktir.
// ---------------------------------------------------------------------------------------------
export async function handlePhotoClaimsRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "photo-claims", ...]

  const user = await getSessionUser(request, env);

  // /access UCU KALDIRILDI (kullanıcı isteği, 2026-09-16 üçüncü tur madde 2): tek çağıranı
  // lightbox'taki "Fotoğraf bana ait" butonunun görünürlük sorusuydu ve o buton kaldırıldı. Yeni
  // giriş noktasının (kişi pop-up'ındaki "Fotoğraflarını Bul") görünürlüğü AYRI bir uç istemez —
  // claim-correction-box.js o kararı /api/claims/status'tan ZATEN okuyor (bkz. tasarım notu 1),
  // ikinci bir yetki ucu iki cevabın ayrışabileceği tek yer olurdu.
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  if (segments.length === 3 && segments[2] === 'projects' && request.method === 'GET') {
    return listClaimableProjects(env, url);
  }
  if (segments.length === 3 && segments[2] === 'pending' && request.method === 'GET') {
    return listPending(env, user);
  }
  if (segments.length === 2 && request.method === 'POST') {
    return createClaim(request, env, user);
  }
  if (segments.length === 4 && segments[3] === 'decide' && request.method === 'POST') {
    return decideClaim(request, env, user, segments[2]);
  }
  if (segments.length === 3 && request.method === 'GET') {
    return getClaim(env, user, segments[2]);
  }
  return errorJson('Bulunamadı', 404);
}

// GET /api/photo-claims/projects?q=... — "Fotoğraflarını Bul" seçicisinin proje listesi (bkz.
// tasarım notu 5). Sorgusuz açılışta EN YENİ projeler döner ("sitedeki yüklü tüm projelerden
// kullanıcı bir projeyi seçebilsin" — kullanıcı önce bir şey görmeli, boş bir kutu değil).
// Oturum ZORUNLU (router'daki kapı) ve yanıt ASLA önbelleklenmez — herkese açık, önbellekli
// karşılığı /api/projects/search'tür ve ona dokunulmadı.
async function listClaimableProjects(env, url) {
  const q = foldTr((url.searchParams.get('q') || '').trim());
  const params = [];
  let where = 'p.deleted_at IS NULL AND p.hidden_at IS NULL';
  if (q) {
    // title_fold — foldTr()'nin SQL karşılığını hesaplayan generated column, index'li (bkz.
    // migrations/0079). % ve _ kullanıcı girdisinde joker anlamı kazanmasın diye kaçışlanır
    // (hotspotTags.js#listTaggableProducts ile AYNI likePattern kullanımı).
    where += " AND p.title_fold LIKE ? ESCAPE '\\'";
    params.push(likePattern(q));
  }
  // Sıralama, /proje listesinin anahtarıyla AYNI (bkz. src/lib/projectPool.js) — kullanıcı
  // seçicide de sitede gördüğü sırayı görsün, "en yeni üstte".
  const { results } = await env.DB.prepare(
    `SELECT p.slug, p.title, p.location, p.project_date, p.images
       FROM projects p
      WHERE ${where}
      ORDER BY COALESCE(p.relisted_at, p.publish_date, p.created_at) DESC, p.id DESC
      LIMIT ${PROJECT_PICKER_LIMIT}`
  ).bind(...params).all();
  return json({
    items: (results || []).map(r => ({
      slug: r.slug,
      title: r.title,
      sub: [r.location, r.project_date].filter(Boolean).join(' · '),
      image: firstImage(r.images),
    })),
  });
}

// "BU KULLANICI BU KİŞİ PROFİLİNİN YÖNETİCİSİ Mİ?" — bu akışın TEK yetki kapısı (bkz. tasarım
// notu 1: verifyClaimedProfileKey'den BİLEREK daha dar, firma yetkilisi delegasyonu YOK).
// Üç yol: admin / onaylı profile_claims('architect') / kaydı siteye kendi ekleyen.
async function architectManagerGate(env, user, architectName) {
  if (isAdmin(user)) return true;
  if (!user || !architectName) return false;
  // Onay ANINDA dondurulmuş satır (canlı bir pozisyon/ad değil) — kişi tarafında pozisyon kısıtı
  // YOKTUR (bkz. submissions.js#verifyClaimedProfileKey'deki AYNI ayrım: kısıt yalnızca firma
  // tipinde var).
  const claim = await env.DB.prepare(
    `SELECT id FROM profile_claims
      WHERE user_id = ? AND profile_type = 'architect' AND profile_key = ? AND status = 'approved'`
  ).bind(user.id, architectName).first();
  if (claim) return true;
  // "Kaydı ekleyen, o kaydın yöneticisidir" (bkz. CLAUDE.md, 2026-09-15). Bu fonksiyon profil BAŞKA
  // bir hesaba atanmışsa kendiliğinden false döner.
  return canEditArchitectAsCreator(env, user, architectName);
}

// Talebin açılacağı KİŞİ PROFİLİ: anahtarı doğrular, YETKİYİ sorar ve künyeye yazılacak adı
// canonical satırdan okur.
// Döndürür: { error: Response } | { row: {id, name, slug} }
async function resolveClaimArchitect(env, user, architectKey) {
  // Anahtar gerçek bir canonical satıra karşılık gelmeli — aksi halde (bayatlamış bir link ya da
  // elle uydurulmuş bir anahtar) hiçbir profile bağlı olmayan bir talep açılabilirdi. Kural
  // submissions.js#verifyClaimedProfileKey'in İLK adımıyla AYNI yardımcıdan gelir.
  if (!(await canonicalRowExistsByKey(env, 'architects', architectKey))) {
    return { error: errorJson('Bu profil artık bu adla mevcut değil, sayfayı yenileyip tekrar dene.') };
  }
  // Yetki, profilin GÜNCEL canonical adıyla sorulur: profile_claims ADLA anahtarlanıyor ve bir
  // yeniden adlandırmadan sonra eski ad/slug ile gelen istek aksi halde sessizce reddedilirdi
  // (verifyClaimedProfileKey'in resolveCurrentProfileName adımıyla AYNI gerekçe).
  const currentName = (await resolveCanonicalName(env, 'architects', architectKey)) || architectKey;
  if (!(await architectManagerGate(env, user, currentName))) {
    return { error: errorJson('Bu kişi profili adına talep açma yetkin yok.', 403) };
  }
  // Ad İSTEMCİDEN DEĞİL canonical satırdan okunur (bkz. dosya başı).
  const row = await env.DB.prepare(
    `SELECT id, name, slug FROM architects
      WHERE deleted_at IS NULL AND (name = ? OR slug = ? OR legacy_key = ?) LIMIT 1`
  ).bind(architectKey, architectKey, architectKey).first();
  if (!row || !row.name) return { error: errorJson('Kişi profili bulunamadı.', 404) };
  return { row };
}

// POST /api/photo-claims { projectSlug, architectSlug } — yeni künye talebi. Admin'de anında
// uygulanır (hotspotTags.js'teki AYNI kullanıcı kuralı: "Admin hesaplarından yapılanların onaya
// düşmesine gerek yok").
async function createClaim(request, env, user) {
  // KUYRUK SPAM'İ KAPISI (bkz. tasarım notu 1). Adminler muaf: onların talebi kuyruğa hiç düşmez.
  if (!isAdmin(user) && !(await checkRateLimit(env, 'photo-claim', user.id, CLAIM_HOURLY_LIMIT, 60 * 60 * 1000))) {
    return errorJson(`Saatte en fazla ${CLAIM_HOURLY_LIMIT} fotoğraf talebi gönderebilirsin. Biraz sonra tekrar dene.`, 429);
  }
  const body = await readJson(request);
  const projectSlug = String(body.projectSlug || '').trim();
  const architectKey = String(body.architectSlug || '').trim();
  if (!projectSlug || !architectKey) return errorJson('Eksik bilgi.');

  // YETKİ + AD, TEK yerden (bkz. tasarım notu 1 ve resolveClaimArchitect). Gövde ayrıştırmasından
  // hemen sonra, hiçbir yazma tetiklenmeden.
  const architect = await resolveClaimArchitect(env, user, architectKey);
  if (architect.error) return architect.error;
  const claimedName = String(architect.row.name).trim().slice(0, MAX_NAME_LEN);

  const project = await env.DB.prepare(
    `SELECT id, slug, title, photo_credit_text FROM projects
      WHERE slug = ? AND deleted_at IS NULL AND (hidden_at IS NULL OR preview_at IS NOT NULL)`
  ).bind(projectSlug).first();
  if (!project) return errorJson('Proje bulunamadı.', 404);

  // ZATEN KÜNYEDE Mİ? Onay kuyruğuna hiçbir şeyi değiştirmeyecek bir talep düşmesin — onay anında
  // applyPhotoClaim de bu adı zaten atlıyor (alreadyCredited), yani karar veren kişi "onayladım
  // ama bir şey olmadı" derdi. Karşılaştırma foldTr ile (sitenin her yerindeki "aynı ad" tanımı).
  if (splitPhotographerNames(project.photo_credit_text).some(n => foldTr(n) === foldTr(claimedName))) {
    return errorJson('Bu projenin fotoğraf künyesinde bu profil zaten var.');
  }

  const now = Date.now();
  const id = newId();
  // image_url HER ZAMAN NULL — talep bir kareye değil projenin künyesine bağlanır (bkz. dosya başı).
  const claimRow = { project_slug: project.slug, image_url: null, claimed_name: claimedName };

  // ADMIN: onaya hiç düşmez — doğrudan uygulanır ve 'approved' olarak kaydedilir (denetim izi:
  // kimin, ne zaman eklediği kayıtlı kalır).
  if (isAdmin(user)) {
    const applied = await applyPhotoClaim(env, claimRow);
    if (!applied.ok) return errorJson(applied.error);
    await env.DB.prepare(
      `INSERT INTO project_photo_claims (id, project_slug, image_url, claimed_name, note, created_by_user_id, status, decided_by_user_id, decided_at, created_at)
       VALUES (?, ?, NULL, ?, NULL, ?, 'approved', ?, ?, ?)`
    ).bind(id, project.slug, claimedName, user.id, user.id, now, now).run();
    return json({ ok: true, status: 'approved' });
  }

  try {
    await env.DB.prepare(
      `INSERT INTO project_photo_claims (id, project_slug, image_url, claimed_name, note, created_by_user_id, status, created_at)
       VALUES (?, ?, NULL, ?, NULL, ?, '${PENDING}', ?)`
    ).bind(id, project.slug, claimedName, user.id, now).run();
  } catch (err) {
    // migrations/0122'deki kısmi UNIQUE indeks — bu kullanıcının bu görsel için bekleyen bir
    // talebi zaten var.
    if (String(err && err.message || '').includes('UNIQUE')) {
      return errorJson('Bu görsel için onay bekleyen bir talebin zaten var.');
    }
    throw err;
  }

  // Bildirimler: projenin künyesindeki firmaların YÖNETİCİLERİ + TÜM adminler (kullanıcı isteği:
  // "firma yöneticilerine ve admine bildirim gitsin"). Karar kümesiyle AYNI kaynaktan türer (bkz.
  // tasarım notu 2). Talebi açan hesap kümede olabilir — o kişi aynı zamanda onaylayıcıdır ve
  // bildirim onun için "onayına sunuldu" satırıdır.
  const recipients = new Set([
    ...(await officeManagerUserIds(env, project.id)),
    ...(await adminUserIds(env)),
  ]);
  for (const uid of recipients) {
    await createNotification(
      env, uid, 'photo_claim',
      'Fotoğraf künyesi talebi onay bekliyor',
      `${user.name || 'Bir üye'}, “${project.title}” projesinin fotoğraflarının “${claimedName}” tarafından çekildiğini bildirdi. Onaylarsan bu ad projenin fotoğraf künyesine eklenir.`,
      `photo-claim:${id}`
    );
  }

  return json({ ok: true, status: PENDING });
}

// GET /api/photo-claims/:id — Hesabım'daki onay pop-up'ının gösterdiği tek kayıt (bkz.
// js/components/auth-modal.js#openPhotoClaimPrompt).
async function getClaim(env, user, id) {
  const claim = await env.DB.prepare('SELECT * FROM project_photo_claims WHERE id = ?').bind(id).first();
  if (!claim) return errorJson('Bulunamadı', 404);
  const project = await env.DB.prepare(
    'SELECT id, slug, title, location, images, photo_credit_text FROM projects WHERE slug = ? AND deleted_at IS NULL'
  ).bind(claim.project_slug).first();
  // Talebi AÇAN kişi de görebilir (kendi talebinin durumunu görmek için) ama karar yetkisi ayrı
  // bir bayrakla söylenir (hotspotTags.js#getTag ile AYNI desen).
  const mayDecide = await canDecide(env, user, project ? project.id : null);
  if (!mayDecide && claim.created_by_user_id !== user.id) return errorJson('Bulunamadı', 404);
  const creator = await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(claim.created_by_user_id).first();
  return json({
    item: {
      id: claim.id,
      status: claim.status,
      claimedName: claim.claimed_name,
      createdAt: claim.created_at,
      createdBy: creator?.name || '',
      // image — projenin KAPAK görseli (talebin kendisi bir kareye bağlı değil, bkz. dosya başı).
      // Onay veren kişi hangi proje için karar verdiğini metinden önce görselden tanır.
      project: project
        ? {
            slug: project.slug, title: project.title, location: project.location || '',
            credit: project.photo_credit_text || '', image: firstImage(project.images),
          }
        : null,
    },
    canDecide: mayDecide,
  });
}

// GET /api/photo-claims/pending — kullanıcının karara bağlayabileceği tüm bekleyen talepler.
// Hesabım'daki bildirim satırından bağımsız bir "toplu bakış" için (bildirim silinmiş olsa bile
// talep kaybolmaz) — hotspotTags.js#listPending ile AYNI gerekçe.
//
// SÜZGEÇ SQL'DE DEĞİL BURADA: "bu kullanıcı bu projenin firma yöneticisi mi" sorusunun cevabı iki
// ayrı tabloyu (profile_claims + office_founders) birleştiren bir fonksiyondan geliyor (bkz.
// fetchOfficeManagers) ve onu tek bir WHERE'e gömmek kuralın İKİNCİ bir kopyasını yaratırdı.
// Bekleyen talep sayısı tanımı gereği küçük olduğundan (kullanıcı başına saatlik tavan var) son
// 200 satırı okuyup elemek güvenli ve tek kurallı olan yol.
async function listPending(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.project_slug, c.claimed_name, c.created_at,
            pr.id AS project_id, pr.title AS project_title
       FROM project_photo_claims c
       LEFT JOIN projects pr ON pr.slug = c.project_slug AND pr.deleted_at IS NULL
      WHERE c.status = 'pending'
      ORDER BY c.created_at DESC LIMIT 200`
  ).all();
  const rows = results || [];
  if (isAdmin(user)) return json({ items: rows.slice(0, 50).map(stripProjectId) });
  const out = [];
  // Proje başına TEK yetki sorgusu — aynı projede birden fazla bekleyen talep olabilir.
  const decidable = new Map();
  for (const r of rows) {
    if (!r.project_id) continue;
    if (!decidable.has(r.project_id)) decidable.set(r.project_id, await canDecide(env, user, r.project_id));
    if (decidable.get(r.project_id)) out.push(stripProjectId(r));
    if (out.length >= 50) break;
  }
  return json({ items: out });
}

function stripProjectId(row) {
  const { project_id, ...rest } = row;
  return rest;
}

// POST /api/photo-claims/:id/decide { approve: true|false }
async function decideClaim(request, env, user, id) {
  const body = await readJson(request);
  const approve = body.approve === true;
  const claim = await env.DB.prepare('SELECT * FROM project_photo_claims WHERE id = ?').bind(id).first();
  if (!claim) return errorJson('Bulunamadı', 404);
  if (claim.status !== PENDING) return errorJson('Bu talep zaten karara bağlanmış.');

  const project = await env.DB.prepare(
    'SELECT id, slug, title FROM projects WHERE slug = ? AND deleted_at IS NULL'
  ).bind(claim.project_slug).first();
  if (!(await canDecide(env, user, project ? project.id : null))) {
    return errorJson('Bu talebi onaylama yetkin yok.', 403);
  }

  if (approve) {
    const applied = await applyPhotoClaim(env, claim);
    if (!applied.ok) return errorJson(applied.error);
  }
  await env.DB.prepare(
    'UPDATE project_photo_claims SET status = ?, decided_by_user_id = ?, decided_at = ? WHERE id = ?'
  ).bind(approve ? 'approved' : 'rejected', user.id, Date.now(), id).run();

  // Talebi açan kişi kararı öğrensin — kendi kararıysa kendine bildirim göndermeye gerek yok.
  if (claim.created_by_user_id !== user.id) {
    await createNotification(
      env, claim.created_by_user_id, 'photo_claim',
      approve ? 'Fotoğraf künyesi talebin onaylandı' : 'Fotoğraf künyesi talebin reddedildi',
      approve
        ? `“${claim.claimed_name}” artık ${project ? `“${project.title}”` : 'bu'} projesinin fotoğraf künyesinde görünüyor.`
        : `“${claim.claimed_name}” için gönderdiğin künye talebi onaylanmadı.`,
      // Onaylanan talep için doğru hedef, adın GÖRÜNDÜĞÜ projedir (bkz. auth-modal.js#
      // notifEntityPath). Reddedilende açılacak bir şey yok, link boş kalır.
      approve && claim.project_slug ? `/proje/${encodeURIComponent(claim.project_slug)}` : null
    );
  }

  return json({ ok: true, status: approve ? 'approved' : 'rejected' });
}
