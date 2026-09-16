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
//     (g) DÜĞMENİN YAŞADIĞI BÖLÜM AÇILIR: "Fotoğrafladığı Projeler" bölümü kişinin hiç fotoğrafı
//         yoksa gizlidir, oysa düğmenin tam hedef kitlesi o kişidir — bölüm açılmazsa düğmeye
//         ulaşmanın hiçbir yolu olmazdı.
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

await test('düğme Düzenle/Proje Ekle ile AYNI yetki fonksiyonundan beslenir', () => {
  const fn = claimBox.match(/function renderFindPhotosButton\(\)\{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /if\(!isAuthorizedEditor\(\)\)\{ slot\.innerHTML = ''; return; \}/,
    'üç düğme ayrı yetki hesaplarsa biri görünürken öteki kaybolabilir');
  assert.match(claimBox, /renderFindPhotosButton\(\);/, 'init() düğmeyi hiç çizmiyor');
});

await test('düğme, yaşadığı bölümü de AÇAR (yoksa ulaşılamaz)', () => {
  const fn = claimBox.match(/function renderFindPhotosButton\(\)\{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /findPhotosSectionId/);
  assert.match(fn, /if\(section\) section\.style\.display = '';/,
    'fotoğrafı olmayan kişide bölüm gizli kalır ve düğmeye ulaşmanın yolu olmaz');
  assert.match(architectModal, /findPhotosSectionId: 'am-photographed-section'/);
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

await test('YETKİ KAPISI IMPORT EDİLİR, ikinci kopya yazılmaz', () => {
  assert.match(photoClaims,
    /import \{ verifyClaimedProfileKey, DELEGATED_ACCESS \} from '\.\/submissions\.js'/);
  assert.match(submissions, /export async function verifyClaimedProfileKey/);
  assert.match(submissions, /export const DELEGATED_ACCESS/);
  const fn = photoClaims.match(/async function resolveClaimArchitect[\s\S]*?\n\}/)[0];
  assert.match(fn, /verifyClaimedProfileKey\(env, user, 'architects', architectKey, DELEGATED_ACCESS\)/);
  // Kuralın elle yeniden yazılmış bir kopyası OLMAMALI.
  assert.ok(!/profile_claims WHERE user_id/.test(photoClaims),
    'yetki kuralının ikinci bir kopyası açılmış — düğme ile sunucu ayrışabilir');
});

await test('künyeye yazılacak ad CANONICAL satırdan okunur, istemciden DEĞİL', () => {
  const fn = photoClaims.match(/async function resolveClaimArchitect[\s\S]*?\n\}/)[0];
  assert.match(fn, /SELECT id, name, slug FROM architects/);
  const create = photoClaims.match(/async function createClaim[\s\S]*?\n\}/)[0];
  assert.match(create, /const claimedName = String\(architect\.row\.name\)/,
    'ad gövdeden okunuyorsa herhangi bir üye istediği adı künyeye önerebilir');
  assert.ok(!/body\.name/.test(create), 'gövdeden ad okunuyor');
  // İstemci de yalnızca profil anahtarı gönderir.
  assert.match(photoFinder, /body: JSON\.stringify\(\{ projectSlug: btn\.dataset\.slug, architectSlug: ctx\.architectKey \}\)/);
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
  assert.match(photoClaims, /import \{ fetchOfficeManagers \} from '\.\.\/lib\/claimedProfiles\.js'/);
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
