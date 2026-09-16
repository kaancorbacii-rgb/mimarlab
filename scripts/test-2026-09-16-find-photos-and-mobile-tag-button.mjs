#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-16 (ÜÇÜNCÜ tur) — üç madde, tek test dosyası.
//
// MADDE 1 — "Mobil görünümde proje lightboxlarındaki ürün etiketle butonu sol üst köşede olsun."
//   KÖK ZORLUK (ve bu turda yapısal olarak kaldırıldı): alt çubuk
//   `bottom:24px; left:50%; transform:translateX(-50%)` ile konumlanıyordu ve TRANSFORM TAŞIYAN BİR
//   ATA, position:fixed çocuklar için de kapsayıcı blok olur — yani çubuğun içindeki butona ne
//   `fixed` ne `absolute` ile ekranın üst köşesi verilebiliyordu; ikisi de çubuğun kendi ~30px'lik
//   kutusuna göre çözülüyordu. Çubuk artık lightbox'ın TAMAMINI kaplayan, TRANSFORMSUZ bir
//   kapsayıcı; sayaç/buton hâlâ flex ile altta ortada duruyor ama her çocuk herhangi bir köşeye
//   konumlandırılabiliyor. Bu değişimin bedeli: çubuk tüm alanı kapladığı için
//   `pointer-events:none` ZORUNLU — aksi halde görselin üzerindeki işaretçi/etiketleme
//   tıklamalarını ve "boşluğa tıkla, kapat" davranışını yutardı.
//
// MADDE 2 — "Lightboxlardaki 'Fotoğraf Bana Ait' butonunu kaldır." Buton AYNI GÜN (ikinci turda)
//   eklenmişti; akışın sunucu tarafı yaşıyor ama giriş noktası madde 3 oldu. Bu dosya butonun
//   GERİ GELMEDİĞİNİ ve ondan kalan ölü kodun (modül, script etiketleri, /access ucu) temizlendiğini
//   kelepçeler.
//
// MADDE 3 — "Kişi popuplarında Fotoğraflarım başlığının yanında 'Fotoğraflarını Bul' butonu olsun
//   ve buna tıklayınca sitedeki yüklü tüm projelerden kullanıcı bir projeyi seçebilsin. Bu seçim
//   seçilen projenin firmasını yöneticisine ve admine bildirim olarak gitsin. Firma yöneticisi
//   veya admin bu bildirime onay verirse proje künyesine fotoğrafçı otomatik olarak eklensin."
//   KELEPÇELENEN YEDİ SÖZLEŞME:
//     (a) DÜĞME YETKİSİ = SUNUCU KAPISI, tek kaynak. İstemcide claim-correction-box.js#
//         isAuthorizedEditor (Düzenle/Proje Ekle ile AYNI fonksiyon), sunucuda
//         submissions.js#verifyClaimedProfileKey — ve o fonksiyon photoClaims.js'e IMPORT edilir,
//         ikinci bir kopya yazılmaz.
//     (b) KÜNYEYE YAZILACAK AD İSTEMCİDEN GELMEZ: canonical architects.name'den okunur. Serbest
//         metin kabul edilseydi herhangi bir üye istediği adı bir projenin künyesine önerebilirdi.
//     (c) ONAY KUYRUĞU ATLATILAMAZ: POST status'ü İSTEMCİDEN OKUMAZ (bkz. proje notu
//         [[project_submission_moderation_bypass_2026_09_05]]).
//     (d) BİLDİRİM ALICILARI = KARAR KÜMESİ, tek fonksiyondan. Ayrışırlarsa bildirimi alan kişi
//         butona bastığında 403 alır.
//     (e) Onay künyeye VE project_photographers kenarına yazar (kenar olmadan ad tıklanamaz düz
//         metin kalır) VE projenin taslağına — canonicalSync photo_credit_text'i taslaktan BAŞTAN
//         yazdığından, yalnızca canonical'a yazmak bir sonraki kaydetmede SESSİZ VERİ KAYBI olurdu.
//     (f) Detay ÖNBELLEĞİ purge edilir: /api/project/:slug fingerprint TAŞIMAZ, yani
//         invalidatePublicCache TEK BAŞINA yetmez — onay veren "onayladım ama görünmüyor" derdi.
//     (g) [DÖRDÜNCÜ TURDA TERSİNE ÇEVRİLDİ] Üçüncü turda düğme, yaşadığı bölümü de AÇIYORDU.
//         Kullanıcı isteği (dördüncü tur): "Bir kişinin fotoğrafladığı proje yoksa Fotoğrafladığı
//         projeler ve fotoğraflarını bul butonu gözükmesin." Artık bölümün görünürlüğü YALNIZCA
//         veriye bağlı ve düğme de AYNI listeyi okur.
//
// DÖRDÜNCÜ TUR (aynı gün) — ÜÇ DEĞİŞİKLİK, hepsi madde 3'ün üzerine:
//     (h) İKİ ADIM: satıra tıklamak yalnızca SEÇER, talebi "Talep Gönder" düğmesi gönderir.
//         Tek adımda (satıra tıkla = gönder) yanlış bir satıra dokunmak geri alınamaz bir talep
//         açıyordu. Düğme seçim yapılana kadar PASİF, gönderilmiş bir projede yeniden PASİF.
//     (i) YETKİ DARALDI: yalnızca profilin KENDİ yöneticisi + admin. Firma yetkilisi delegasyonu
//         (claimDelegatedEdit / canEditArchitectViaOfficeMembership) İKİ TARAFTAN DA çıkarıldı —
//         bir firma yetkilisi, ekibindeki bir kişinin ADINA künye talebi açamamalı.
//     (j) ONAY ALINMADAN KÜNYEYE HİÇBİR ŞEY YAZILMAZ — zaten öyleydi; test bunu açıkça kelepçeler.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const exists = (f) => existsSync(new URL('../' + f, import.meta.url));

const gallery = read('js/components/gallery.js');
const projectGallery = read('js/components/project-gallery.js');
const photoFinder = read('js/components/photo-finder.js');
const claimBox = read('js/components/claim-correction-box.js');
const architectModal = read('js/components/architect-modal.js');
const photoClaims = read('src/routes/photoClaims.js');
const submissions = read('src/routes/submissions.js');
const authModal = read('js/components/auth-modal.js');
const lazyModals = read('js/components/lazy-modals.js');
const ssrCache = read('src/lib/ssrCache.js');
const projeHtml = read('proje.html');
const top100Html = read('en-iyi-100.html');

// ==========================================================================================
console.log('\nmadde 1 — mobilde "Ürün Etiketle" sol üst köşede');

const barRule = gallery.match(/\.lightbox-bottombar\{[^}]*\}/)[0];

await test('alt çubuk TRANSFORMSUZ ve tüm alanı kaplar (kök zorluk kalktı)', () => {
  assert.match(barRule, /inset:0/, 'çubuk tüm alanı kaplamıyor — absolute çocuk üst köşeye çözülemez');
  assert.ok(!/transform/.test(barRule),
    'transform geri gelmiş: transform taşıyan ata, fixed/absolute çocuklar için kapsayıcı blok olur');
  assert.ok(!/bottom:24px/.test(barRule), 'eski bottom konumlandırması geri gelmiş');
});

await test('pointer-events:none ZORUNLU, çocuklar tıklanabilirliği geri alır', () => {
  assert.match(barRule, /pointer-events:none/,
    'çubuk tüm alanı kaplıyor: pointer-events olmadan işaretçi tıklamalarını ve arka plana tıklayıp kapatmayı yutar');
  assert.match(gallery, /\.lightbox-bottombar > \*\{pointer-events:auto;\}/);
});

await test('sayaç/buton hâlâ ALTTA ORTADA (masaüstü görünümü değişmedi)', () => {
  assert.match(barRule, /align-items:flex-end/);
  assert.match(barRule, /justify-content:center/);
  assert.match(barRule, /padding:0 12px 24px/, 'alt boşluk eski bottom:24px ile aynı olmalı');
});

await test('mobilde buton SOL ÜST köşede', () => {
  const mq = gallery.match(/@media \(max-width:560px\)\{[\s\S]*?\n    \}/)[0];
  assert.match(mq, /\.lightbox-tag-btn\{position:absolute; top:12px; left:14px;\}/);
  // Sağ üst köşe DOLU: .lightbox-close (top:24px/right:32px, mobilde 12px/14px) ve onun solunda
  // .lightbox-grid-toggle. Sol üst kasıtlı seçim.
  assert.match(mq, /padding-bottom:18px/, 'mobil alt boşluk korunmalı');
});

await test('ızgara modunda çubuk (ve içindeki buton) hâlâ tamamen gizli', () => {
  assert.match(gallery, /\.lightbox\.grid-mode \.lightbox-bottombar\{display:none;\}/);
});

await test('enjekte edilen CSS şablonunda ters tırnak YOK (sessiz bozulma tuzağı)', () => {
  // Bu tuzağa bu turda bir kez düşüldü: CSS yorumuna yazılan `fixed` ifadesi şablon dizesini
  // kapatıp dosyayı sözdizimi hatasına düşürdü (bkz. proje notu
  // [[feedback_no_backtick_in_style_template_literals]]).
  const tpl = gallery.match(/style\.textContent = `[\s\S]*?`;/)[0];
  assert.ok(!tpl.slice(22, -2).includes('`'), 'enjekte edilen CSS şablonunda ters tırnak var');
});

// ==========================================================================================
console.log('\nmadde 2 — "Fotoğraf bana ait" butonu kaldırıldı (ölü kod da)');

await test('lightbox butonu, stili ve state alanı KALMADI', () => {
  assert.ok(!/lightbox-claim-btn\{/.test(gallery), '.lightbox-claim-btn stili geri gelmiş');
  assert.ok(!/Fotoğraf bana ait/.test(gallery), 'buton metni gallery.js\'te geri gelmiş');
  assert.ok(!/state\.photoClaim/.test(gallery), 'state alanı geri gelmiş');
  assert.ok(!/photoClaim/.test(projectGallery), 'project-gallery.js alanı yeniden geçiriyor');
});

await test('eski modül silindi ve hiçbir yerden yüklenmiyor', () => {
  assert.ok(!exists('js/components/photo-claim.js'), 'photo-claim.js hâlâ duruyor');
  assert.ok(!/photo-claim\.js/.test(projeHtml), 'proje.html hâlâ script etiketini taşıyor');
  assert.ok(!/photo-claim\.js/.test(top100Html), 'en-iyi-100.html hâlâ script etiketini taşıyor');
  assert.ok(!/photo-claim\.js/.test(lazyModals), 'lazy-modals hâlâ bağımlılık olarak listeliyor');
});

await test('PhotoClaimer çağrıları (Escape/arka plan/kapat kancaları) temizlendi', () => {
  assert.ok(!/PhotoClaimer/.test(gallery), 'gallery.js hâlâ PhotoClaimer\'a bakıyor');
  assert.ok(!/closeClaimForm/.test(gallery));
  // Swipe korumasındaki .pc-form seçicisi de artık karşılıksız.
  assert.ok(!/\.pc-form/.test(gallery), 'swipe koruması artık var olmayan bir formu sayıyor');
});

await test('yalnızca butonun görünürlüğü için var olan /access ucu kaldırıldı', () => {
  assert.ok(!/'access'/.test(photoClaims), '/access ucu duruyor — tek çağıranı kaldırılan butondu');
  assert.ok(!/canClaim/.test(photoClaims));
});

await test('script etiketinin KALDIRILMASI da SSR sürümü gerektirir', () => {
  // v114'teki AYNI tuzak: artırılmazsa eski kabuk artık var olmayan dosya için 404 üretir.
  const v = ssrCache.match(/export const SSR_CACHE_VERSION = '(v\d+)';/)[1];
  assert.ok(Number(v.slice(1)) >= 141, `SSR_CACHE_VERSION ${v} — photo-claim.js etiketi kaldırıldı, artırılmalı`);
});

// ==========================================================================================
console.log('\nmadde 3 — "Fotoğraflarını Bul": düğme ve yetki');

await test('YETKİ DARALDI: yalnızca profilin KENDİ yöneticisi + admin (istemci)', () => {
  // (i) Firma yetkilisi delegasyonu (claimDelegatedEdit) ÇIKARILDI: bir firma yetkilisi,
  // ekibindeki bir kişinin ADINA künye talebi açamamalı.
  const mgr = claimBox.match(/function isProfileManager\(\)\{[\s\S]*?\n  \}/)[0];
  assert.ok(!/claimDelegatedEdit/.test(mgr),
    'delegasyon yolu geri gelmiş — firma yetkilisi başkasının adına talep açabilir');
  assert.match(mgr, /isProfileOwner && canEditByPosition/);
  assert.match(mgr, /currentUser\.role === 'admin'/);
  assert.match(mgr, /ownSubmissionId/);
  const fn = claimBox.match(/function renderFindPhotosButton\(\)\{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /!isProfileManager\(\)/, 'düğme hâlâ geniş isAuthorizedEditor ile çiziliyor');
  assert.match(claimBox, /renderFindPhotosButton\(\);/, 'init() düğmeyi hiç çizmiyor');
  // Düzenle/Proje Ekle DARALTILMADI — daraltma yalnızca bu düğme içindi.
  assert.match(claimBox, /function renderAddProjectButton\(\)\{[\s\S]*?isAuthorizedEditor\(\)/);
});

await test('fotoğrafladığı proje YOKSA ne bölüm ne düğme görünür', () => {
  // (g) Üçüncü turun "bölümü aç" davranışı GERİ ALINDI (kullanıcı isteği, dördüncü tur).
  const fn = claimBox.match(/function renderFindPhotosButton\(\)\{[\s\S]*?\n  \}/)[0];
  assert.ok(!/section\.style\.display/.test(fn), 'düğme hâlâ bölümü açıyor');
  assert.ok(!/findPhotosSectionId/.test(claimBox), 'bölüm açma sözleşmesi hâlâ duruyor');
  assert.match(fn, /config\.findPhotosEnabled\(\)/);
  assert.match(fn, /if\(!enabled \|\| !isProfileManager\(\)\)\{ slot\.innerHTML = ''; return; \}/);
  // Bölüm ve düğme AYNI tek gerçeği okur — "bölüm gizli ama düğme var" oluşamaz.
  assert.match(architectModal, /findPhotosEnabled: \(\) => photographedData\.length > 0/);
  assert.match(architectModal,
    /getElementById\('am-photographed-section'\)\.style\.display = photographedData\.length \? '' : 'none'/);
});

await test('yuva kişi pop-up\'ının "Fotoğrafladığı Projeler" BAŞLIĞINDA', () => {
  const heading = architectModal.match(/<h2 class="related-title" id="am-photographed-title">[^\n]*/)[0];
  assert.match(heading, /<span id="am-find-photos-slot"><\/span>/,
    'kullanıcı isteği: düğme "Fotoğraflarım" başlığının YANINDA');
  assert.match(architectModal, /findPhotosSlotId: 'am-find-photos-slot'/);
});

await test('yuva HER profilde sıfırlanır (yanlış profil adına talep tuzağı)', () => {
  // Düğme paylaşılan DOM'da yaşıyor ve yetki kararı ASENKRON geliyor: temizlenmezse yetkisiz bir
  // profilde önceki profilin düğmesi görünür kalır — ve o düğme ESKİ kişinin anahtarını taşır.
  assert.match(architectModal,
    /getElementById\('am-find-photos-slot'\); if \(s\) s\.innerHTML = '';/);
});

await test('modül tembel zincire bağlı (yüklenmezse düğme sessiz kalmasın)', () => {
  assert.match(lazyModals, /'js\/components\/photo-finder\.js'/);
  assert.match(claimBox, /if\(typeof PhotoFinder === 'undefined'\) return;/,
    'modül yoksa tıklama çökmemeli');
});

// ==========================================================================================
console.log('\nmadde 3 — proje seçicisi');

await test('seçici KENDİ oturum korumalı ucundan beslenir (/api/projects/search\'e dokunulmadı)', () => {
  assert.match(photoClaims, /async function listClaimableProjects/);
  assert.match(photoClaims, /segments\[2\] === 'projects' && request\.method === 'GET'/);
  assert.match(photoFinder, /fetch\(`\/api\/photo-claims\/projects\?q=\$\{encodeURIComponent\(q \|\| ''\)\}`\)/);
  // Herkese açık uç, 2 karakterin altındaki sorguları bilinçli olarak D1'e hiç göndermiyor; oraya
  // "sorgusuz açılışta listeyi doldur" davranışı eklenemezdi.
  const projectRoute = read('src/routes/project.js');
  assert.match(projectRoute, /if \(!q \|\| q\.length < 2\) return \{ items: \[\] \};/,
    '/api/projects/search davranışı değişmiş — bu turda ona DOKUNULMAMALIYDI');
});

await test('sorgusuz açılışta liste DOLU gelir ("sitedeki yüklü tüm projeler")', () => {
  const fn = photoClaims.match(/async function listClaimableProjects[\s\S]*?\n\}/)[0];
  // q boşsa WHERE'e hiçbir başlık koşulu eklenmez -> en yeni projeler döner.
  assert.match(fn, /if \(q\) \{/);
  assert.match(fn, /ORDER BY COALESCE\(p\.relisted_at, p\.publish_date, p\.created_at\) DESC/,
    'seçici, sitede görülen sırayla aynı sırayı göstermeli');
  assert.match(fn, /LIMIT \$\{PROJECT_PICKER_LIMIT\}/);
  assert.match(photoFinder, /load\(''\);/, 'açılışta sorgusuz yükleme yok');
});

await test('arama girdisi joker olarak yorumlanmaz (likePattern)', () => {
  const fn = photoClaims.match(/async function listClaimableProjects[\s\S]*?\n\}/)[0];
  assert.match(fn, /p\.title_fold LIKE \? ESCAPE/);
  assert.match(fn, /params\.push\(likePattern\(q\)\)/);
});

await test('yalnızca YAYINDA projeler listelenir', () => {
  const fn = photoClaims.match(/async function listClaimableProjects[\s\S]*?\n\}/)[0];
  assert.match(fn, /p\.deleted_at IS NULL AND p\.hidden_at IS NULL/);
});

// ==========================================================================================
console.log('\nmadde 3 — talep: yetki, ad ve onay kuyruğu');

await test('SUNUCU KAPISI da daraldı: delegasyon yolu YOK', () => {
  // (i) Üçüncü turda verifyClaimedProfileKey (DELEGATED_ACCESS ile) kullanılıyordu — o kapı
  // BİLEREK daha geniş: dördüncü yol olarak firma yetkilisi delegasyonunu da kabul ediyor.
  // Kullanıcı isteği tam olarak o yolu kapattığı için burada AYRI ve DAHA DAR bir kapı var.
  // Dosya başı notu o fonksiyonu ADIYLA anıyor ("NEDEN ... DEĞİL"), bu yüzden metinsel geçiş
  // değil IMPORT ve ÇAĞRI aranır.
  assert.ok(!/import \{[^}]*verifyClaimedProfileKey[^}]*\} from/.test(photoClaims),
    'geniş kapı yeniden import edilmiş — firma yetkilisi başkasının adına talep açabilir');
  assert.ok(!/await verifyClaimedProfileKey\(/.test(photoClaims), 'geniş kapı yeniden çağrılıyor');
  assert.ok(!/DELEGATED_ACCESS/.test(photoClaims), 'delegasyon bayrağı geri gelmiş');
  // ...ve o geniş kapı submissions.js'te yine PRIVATE (dışa aktarılmış ölü bir yüzey bırakılmadı).
  assert.ok(!/export async function verifyClaimedProfileKey/.test(submissions));
  assert.ok(!/export const DELEGATED_ACCESS/.test(submissions));

  const gate = photoClaims.match(/async function architectManagerGate[\s\S]*?\n\}/)[0];
  assert.match(gate, /if \(isAdmin\(user\)\) return true;/);
  assert.match(gate, /profile_type = 'architect' AND profile_key = \? AND status = 'approved'/);
  assert.match(gate, /canEditArchitectAsCreator\(env, user, architectName\)/,
    '"kaydı ekleyen yöneticidir" yolu lib\'den okunmalı, elle kopyalanmamalı');
});

await test('anahtar doğrulanır ve yetki GÜNCEL canonical adla sorulur', () => {
  const fn = photoClaims.match(/async function resolveClaimArchitect[\s\S]*?\n\}/)[0];
  // Bayat/uydurma anahtar reddedilir (verifyClaimedProfileKey'in ilk adımıyla AYNI yardımcı).
  assert.match(fn, /canonicalRowExistsByKey\(env, 'architects', architectKey\)/);
  // profile_claims ADLA anahtarlı: yeniden adlandırmadan sonra eski slug ile gelen istek aksi
  // halde sessizce reddedilirdi.
  assert.match(fn, /resolveCanonicalName\(env, 'architects', architectKey\)/);
  assert.match(fn, /architectManagerGate\(env, user, currentName\)/);
  assert.match(fn, /'Bu kişi profili adına talep açma yetkin yok\.', 403/);
});

await test('künyeye yazılacak ad CANONICAL satırdan okunur, istemciden DEĞİL', () => {
  const fn = photoClaims.match(/async function resolveClaimArchitect[\s\S]*?\n\}/)[0];
  assert.match(fn, /SELECT id, name, slug FROM architects/);
  const create = photoClaims.match(/async function createClaim[\s\S]*?\n\}/)[0];
  assert.match(create, /const claimedName = String\(architect\.row\.name\)/,
    'ad gövdeden okunuyorsa herhangi bir üye istediği adı künyeye önerebilir');
  assert.ok(!/body\.name/.test(create), 'gövdeden ad okunuyor');
  // İstemci de yalnızca profil anahtarı gönderir.
  assert.match(photoFinder, /body: JSON\.stringify\(\{ projectSlug: target\.slug, architectSlug: ctx\.architectKey \}\)/);
});

await test('ONAY KUYRUĞU ATLATILAMAZ: POST status\'ü istemciden okumaz', () => {
  const fn = photoClaims.match(/async function createClaim[\s\S]*?\n\}/)[0];
  assert.ok(!/body\.status/.test(fn), 'status gövdeden okunuyor — üye kendi talebini onaylayabilirdi');
  assert.match(fn, /if \(isAdmin\(user\)\) \{[\s\S]*?'approved'/);
  assert.match(fn, /'\$\{PENDING\}'/);
});

await test('zaten künyede olan profil için talep AÇILMAZ', () => {
  const fn = photoClaims.match(/async function createClaim[\s\S]*?\n\}/)[0];
  // Aksi halde onay kuyruğuna hiçbir şeyi değiştirmeyecek bir satır düşer ve karar veren kişi
  // "onayladım ama bir şey olmadı" derdi (applyPhotoClaim o adı zaten atlıyor).
  assert.match(fn, /splitPhotographerNames\(project\.photo_credit_text\)\.some\(n => foldTr\(n\) === foldTr\(claimedName\)\)/);
});

await test('talep bir KAREYE bağlanmaz (image_url her zaman NULL)', () => {
  const fn = photoClaims.match(/async function createClaim[\s\S]*?\n\}/)[0];
  assert.match(fn, /image_url: null/);
  assert.ok(!/body\.imageUrl/.test(photoClaims), 'imageUrl hâlâ gövdeden okunuyor');
});

await test('BİLDİRİM ALICILARI = KARAR KÜMESİ (tek fonksiyon)', () => {
  assert.match(photoClaims, /async function officeManagerUserIds/);
  const decide = photoClaims.match(/async function canDecide[\s\S]*?\n\}/)[0];
  assert.match(decide, /officeManagerUserIds\(env, projectId\)\)\.has\(user\.id\)/);
  const create = photoClaims.match(/async function createClaim[\s\S]*?\n\}/)[0];
  assert.match(create, /await officeManagerUserIds\(env, project\.id\)/);
  assert.match(create, /await adminUserIds\(env\)/, 'kullanıcı isteği: "firma yöneticisine ve admine"');
});

await test('yönetici tanımı TEK kaynaktan okunur', () => {
  assert.match(photoClaims, /import \{ fetchOfficeManagers, canEditArchitectAsCreator \} from '\.\.\/lib\/claimedProfiles\.js'/);
  assert.match(photoClaims, /import \{ OFFICE_EDIT_POSITIONS \} from '\.\.\/lib\/projectClaimAccess\.js'/);
});

await test('karar verme AYRI uç + kendi yetki kontrolü', () => {
  const fn = photoClaims.match(/async function decideClaim[\s\S]*?\n\}/)[0];
  assert.match(fn, /if \(!\(await canDecide\(env, user, project \? project\.id : null\)\)\)/);
  assert.match(fn, /return errorJson\('Bu talebi onaylama yetkin yok\.', 403\)/);
  assert.match(fn, /if \(claim\.status !== PENDING\) return errorJson/);
});

// ==========================================================================================
console.log('\nmadde 3 — onay: künyeye otomatik ekleme');

await test('onay künyeye yazar ve görsel bazlı eşlemeye DOKUNMAZ', () => {
  const fn = photoClaims.match(/async function applyPhotoClaim[\s\S]*?\n\}/)[0];
  assert.match(fn, /UPDATE projects SET photo_credit_text = \?, updated_at = datetime\('now'\) WHERE id = \?/);
  // image_credits, proje-ekle akışının alanıdır (ikinci tur madde 1) — bu akış onu yazmamalı.
  assert.ok(!/image_credits/.test(fn), 'onay artık image_credits yazmamalı (talep bir kareye bağlı değil)');
  assert.ok(!/sanitizeImageCredits/.test(photoClaims));
});

await test('ad zaten künyedeyse İKİNCİ KEZ yazılmaz (foldTr ile)', () => {
  const fn = photoClaims.match(/async function applyPhotoClaim[\s\S]*?\n\}/)[0];
  assert.match(fn, /existingNames\.some\(n => foldTr\(n\) === foldTr\(name\)\)/,
    'birebir metin karşılaştırması "Ayça"/"Ayca" ikilisini künyeye iki kez yazardı');
});

await test('onaylanan ad TIKLANABİLİR olur (project_photographers kenarı)', () => {
  const fn = photoClaims.match(/async function applyPhotoClaim[\s\S]*?\n\}/)[0];
  assert.match(fn, /findOneByName\(env, 'architects', name\)/,
    'canonicalSync#syncProject ile AYNI kural olmalı');
  assert.match(fn, /INSERT OR IGNORE INTO project_photographers/);
});

await test('TASLAK da güncellenir (aksi halde sonraki kaydetmede sessiz veri kaybı)', () => {
  const fn = photoClaims.match(/async function applyPhotoClaim[\s\S]*?\n\}/)[0];
  assert.match(fn, /UPDATE project_submissions SET photoCreditText = \? WHERE id = \?/);
  assert.match(fn, /for \(const draft of \(drafts\.results \|\| \[\]\)\)/,
    'birden fazla taslak aynı projeye bağlı olabilir');
});

await test('detay ÖNBELLEĞİ purge edilir', () => {
  const fn = photoClaims.match(/async function applyPhotoClaim[\s\S]*?\n\}/)[0];
  assert.match(fn, /purgeSsrDetailCache\('project', project\.slug, env\)/);
  assert.match(fn, /invalidatePublicCache\(env\)/);
});

await test('kuyruk spam\'ine karşı hız sınırı var, adminler muaf', () => {
  assert.match(photoClaims, /if \(!isAdmin\(user\) && !\(await checkRateLimit\(env, 'photo-claim', user\.id, CLAIM_HOURLY_LIMIT/);
});

// ==========================================================================================
console.log('\ndördüncü tur — iki adım: seç, sonra "Talep Gönder"');

await test('satıra tıklamak SEÇER, göndermez', () => {
  // (h) Tek adımda yanlış bir satıra dokunmak geri alınamaz bir talep açıyordu.
  const wire = photoFinder.match(/listEl\.querySelectorAll\('\.pf-item'\)\.forEach\(btn => \{[\s\S]*?\n    \}\);/)[0];
  assert.ok(!/fetch\(/.test(wire), 'satır tıklaması hâlâ doğrudan istek atıyor');
  assert.match(wire, /setSelected\(same \? null : \{ slug: btn\.dataset\.slug, title: btn\.dataset\.title \}\)/);
  assert.match(wire, /const same = selected && selected\.slug === btn\.dataset\.slug;/,
    'aynı satıra tekrar tıklamak seçimi kaldırmalı — yanlış dokunan kullanıcı sıkışmasın');
});

await test('"Talep Gönder" düğmesi var ve seçim yapılana kadar PASİF', () => {
  assert.match(photoFinder, /<button type="button" class="pf-send" disabled>Talep Gönder<\/button>/);
  assert.match(photoFinder, /sendBtn\.addEventListener\('click', submit\)/);
  // Açılışta ve her profil değişiminde seçim sıfırlanır.
  assert.match(photoFinder, /setSelected\(null\);/);
});

await test('seçim durumu TEK yerden yazılır (satır işareti + düğme birlikte)', () => {
  // Ayrı ayrı güncellenirse "seçili görünen satır + pasif düğme" gibi ayrışık bir hâl doğar.
  const fn = photoFinder.match(/function setSelected\(next\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /aria-selected/);
  assert.match(fn, /sendBtn\.disabled = !next \|\| submittedSlugs\.has\(next\.slug\)/,
    'gönderilmiş bir projede düğme yeniden pasif olmalı (mükerrer talep)');
});

await test('gönderim TEK sefer: istek uçarken liste ve düğme kilitli', () => {
  const fn = photoFinder.match(/async function submit\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /if \(!ctx \|\| !selected\) return;/);
  assert.match(fn, /buttons\.forEach\(b => \{ b\.disabled = true; \}\);/);
  assert.match(fn, /sendBtn\.disabled = true;/);
  assert.match(fn, /submittedSlugs\.add\(target\.slug\);/);
  // Hata hâlinde seçim GERİ YÜKLENİR — kullanıcı aynı projeyi baştan bulmak zorunda kalmasın.
  assert.match(fn, /setSelected\(target\);/);
});

await test('profil değişiminde seçim ve "gönderildi" geçmişi sıfırlanır', () => {
  const fn = photoFinder.match(/function open\(opts\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /selected = null;/);
  assert.match(fn, /submittedSlugs = new Set\(\);/);
});

await test('kullanıcıya ONAY ŞARTI açıkça söylenir', () => {
  // (j) "bildirim onaylanmadan künyeye fotoğrafçı ismi eklenmesin" — davranış zaten böyle; metin
  // de bunu söylemeli, aksi halde kullanıcı gönderdiği anda eklendiğini sanır.
  assert.match(photoFinder, /ONAYLANMADAN künyeye hiçbir şey eklenmez/);
  assert.match(photoFinder, /onaya gönderildi/);
});

// ==========================================================================================
console.log('\nmadde 3 — onay pop-up\'ı');

await test('bildirim satırı onay pop-up\'ını açar (photo-claim:<id>)', () => {
  assert.match(photoClaims, /`photo-claim:\$\{id\}`/);
  assert.match(authModal, /const photoClaimId = photoClaimIdFromLink\(item\.link\);\s*\n\s*if \(photoClaimId\) return \{ run: \(\) => openPhotoClaimPrompt\(photoClaimId\) \};/);
});

await test('pop-up projenin KAPAK görselini gösterir (kare değil)', () => {
  const fn = authModal.match(/function openPhotoClaimPrompt[\s\S]*?\n    \}\n/)[0];
  assert.match(fn, /const cover = it\.project && it\.project\.image;/);
  assert.ok(!/it\.imageUrl/.test(fn), 'talep artık bir kareye bağlı değil');
  assert.match(photoClaims, /image: firstImage\(project\.images\)/);
});

await test('karar butonları YALNIZCA yetkiliye çizilir', () => {
  const fn = authModal.match(/function openPhotoClaimPrompt[\s\S]*?\n    \}\n/)[0];
  assert.match(fn, /\$\{\(!decided && data\.canDecide\) \?/,
    'talebi açan kişi Onayla/Reddet görmemeli');
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
process.exit(failed ? 1 : 0);
