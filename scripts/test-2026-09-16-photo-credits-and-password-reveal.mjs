#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-16 (ikinci tur) — üç madde, tek test dosyası.
//
// MADDE 1 — "Proje ekle/düzenle sayfasında eğer fotoğrafçı kısmına birden fazla fotoğrafçı
//   yazıldıysa fotoğrafların üstüne tıklanınca açılan lightboxta hangi fotoğrafı hangi
//   fotoğrafçının çektiği seçilebilsin."
//   KELEPÇELENEN DÖRT SÖZLEŞME:
//     (a) Veri GÖRSEL URL'sine göre anahtarlanır, indekse göre DEĞİL — proje-ekle'de görseller
//         sürükle-bırak ile yeniden sıralanabiliyor (bkz. o dosyadaki mediaItems) ve indeks tabanlı
//         bir eşleme her sıralamada sessizce yanlış fotoğrafçıyı gösterirdi.
//     (b) Eşlemesi OLMAYAN kare künyenin TAMAMINA düşer. Bu, kolonu hiç yazılmamış tüm mevcut
//         projelerin görünümünü DEĞİŞMEDEN bırakan tek davranış; kaybolursa binlerce projenin
//         lightbox'ındaki "© ..." etiketi bir anda boşalır.
//     (c) Menü yalnızca İKİ ya da daha fazla fotoğrafçı varken çizilir (kullanıcı isteğinin şartı).
//     (d) Künyeden ÇIKARILMIŞ bir ada bağlı seçim ne kaydedilir ne gösterilir — aksi halde lightbox
//         sitede hiçbir yerde yazmayan bir adı gösterirdi.
//
// MADDE 2 — "Proje popuplarındaki lightboxta 'Fotoğraf bana ait' butonu olsun ve bu butona
//   tıklayınca görseldeki ismin değişmesi için firma yöneticilerine ve admine bildirim gitsin.
//   Firma yöneticileri veya admin bildirimi onaylarsa fotoğrafçı bilgisi lightboxa ve proje
//   künyesine eklensin."
//   KELEPÇELENEN BEŞ SÖZLEŞME:
//     (a) ONAY KUYRUĞU ATLATILAMAZ: POST status'ü İSTEMCİDEN OKUMAZ (bkz. proje notu
//         [[project_submission_moderation_bypass_2026_09_05]] — gönderi PATCH'i koşulsuz
//         'approved' yazdığı için üye onay kuyruğunu tamamen atlayabiliyordu).
//     (b) BİLDİRİM ALICILARI = KARAR KÜMESİ, tek fonksiyondan. Ayrışırlarsa bildirimi alan kişi
//         butona bastığında 403 alır.
//     (c) Onay İKİ hedefe birden yazar (kullanıcı isteğinin iki cümlesi): image_credits (lightbox)
//         VE photo_credit_text (künye).
//     (d) TASLAK da güncellenir: canonicalSync bu iki alanı taslaktan BAŞTAN yazdığından, yalnızca
//         canonical'a yazmak projenin bir sonraki kaydedilişinde SESSİZ VERİ KAYBI olurdu (bkz.
//         hotspotTags.js tasarım notu 4 — AYNI tuzak, orada da ölçülmüştü).
//     (e) Detay ÖNBELLEĞİ purge edilir: /api/project/:slug caches.default'ta s-maxage ile durur ve
//         fingerprint TAŞIMAZ, yani invalidatePublicCache TEK BAŞINA yetmez — onay veren kişi
//         "onayladım ama görünmüyor" diye bakakalırdı (hotspotTags.js'teki AYNI gerçek bulgu).
//
// MADDE 3 — "Giriş yap ekranında şifre kutucuğunun en sağında bir göz işareti olsun ve buna
//   tıklayınca şifre açık gözüksün." Giriş ekranı İKİ yüzeyde yaşıyor (bağımsız sayfa + pop-up);
//   kural TEK modülde ve İKİ yüzeyde de bağlı olmalı.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

const migration = read('migrations/0122_project_image_credits.sql');
const submissionTypes = read('src/lib/submissionTypes.js');
const canonicalSync = read('src/lib/canonicalSync.js');
const projectPool = read('src/lib/projectPool.js');
const adminRoute = read('src/routes/admin.js');
const photoClaims = read('src/routes/photoClaims.js');
const indexJs = read('src/index.js');
const gallery = read('js/components/gallery.js');
const projectGallery = read('js/components/project-gallery.js');
const photoClaimJs = read('js/components/photo-claim.js');
const projeEkle = read('proje-ekle.html');
const authModal = read('js/components/auth-modal.js');
const girisYap = read('giris-yap.html');
const passwordReveal = read('js/components/password-reveal.js');
const lazyModals = read('js/components/lazy-modals.js');
const ssrCache = read('src/lib/ssrCache.js');
const projeHtml = read('proje.html');
const top100Html = read('en-iyi-100.html');

// ==========================================================================================
console.log('\nmadde 1 — görsel başına fotoğrafçı: şema ve yazma yolu');

await test('migration İKİ tabloya da kolon ekler (canonical + taslak)', () => {
  assert.match(migration, /ALTER TABLE projects ADD COLUMN image_credits TEXT;/);
  assert.match(migration, /ALTER TABLE project_submissions ADD COLUMN imageCredits TEXT;/);
});

await test('imageCredits objectFields (arrayFields DEĞİL) — kök değer bir NESNE', () => {
  const cfg = submissionTypes.match(/projects:\s*\{[\s\S]*?\n  \},/)[0];
  assert.match(cfg, /objectFields:\s*\[[^\]]*'imageCredits'/, 'imageCredits objectFields listesinde yok');
  assert.ok(!/arrayFields:\s*\[[^\]]*'imageCredits'/.test(cfg),
    'arrayFields olsaydı normalizeSubmission nesneyi tek elemanlı bir DİZİYE sarardı');
  assert.match(cfg, /fields:\s*\[[\s\S]*?'imageCredits'/, 'alan fields listesinde yok — hiç yazılamaz');
});

await test('sanitizeImageCredits: boş/dize olmayan değer ATILIR, ad kırpılır', () => {
  assert.match(submissionTypes, /export function sanitizeImageCredits/);
  const fn = submissionTypes.match(/export function sanitizeImageCredits[\s\S]*?\n\}/)[0];
  assert.match(fn, /typeof value !== 'string'/, 'dize olmayan değer süzülmüyor');
  assert.match(fn, /if \(!name\) continue;/, "boş dize anahtar olarak yazılırsa okuma tarafında iki ayrı 'boş' hâli doğar");
  assert.match(fn, /MAX_IMAGE_CREDIT_LEN/, 'ad uzunluğu sınırlanmıyor — sütun serbest bir JSON deposuna dönüşür');
  assert.match(fn, /MAX_HOTSPOT_IMAGES/, 'görsel sayısı sınırı imageHotspots ile aynı olmalı');
});

await test('normalizeSubmission ve admin yolu AYNI temizleyiciyi çağırır', () => {
  assert.match(submissionTypes, /field === 'imageCredits' \? sanitizeImageCredits\(value\)/);
  // Admin panelinin kısa düzenleme formu (proje-ekle'nin "admin başkasının gönderisini düzenliyor"
  // yolu) da bu uçtan geçiyor — ham nesneyi olduğu gibi yazmak onu tüm sınırlardan muaf tutardı.
  assert.match(adminRoute, /field === 'imageCredits' \? sanitizeImageCredits\(value\)/);
  assert.match(adminRoute, /import \{[^}]*sanitizeImageCredits[^}]*\} from '\.\.\/lib\/submissionTypes\.js'/);
});

await test('canonicalSync: image_credits images ile AYNI koşulda yazılır (UPDATE + INSERT)', () => {
  const sync = canonicalSync.match(/\nasync function syncProject\(env, row, opts = \{\}\) \{[\s\S]*?\n\}\n/)[0];
  // UPDATE dalı: iki set de `row.images && row.images.length` bloğunun İÇİNDE olmalı — anahtar
  // görsel URL'si olduğundan görsel listesi güncellenmeden anahtarlar anlamsız kalır, ve images'i
  // hiç göndermeyen çağıranlar (AI akışı, admin kısa formu) mevcut eşlemeyi silmemeli.
  const imagesBlock = sync.match(/if \(row\.images && row\.images\.length\) \{[\s\S]*?\n    \}/)[0];
  assert.match(imagesBlock, /'image_hotspots = \?'/);
  assert.match(imagesBlock, /'image_credits = \?'/, 'image_credits images dalının DIŞINDA yazılıyor');
  // INSERT: kolon listesinde ve bind sırasında.
  assert.match(sync, /INSERT INTO projects \([^)]*image_hotspots, image_credits,/);
  assert.match(sync, /images, imageHotspots, imageCredits,/, 'bind sırası kolon sırasıyla eşleşmiyor');
  // Boş harita NULL yazar (aksi halde silinen bir seçim "{}" olarak geri gelirdi).
  assert.match(sync, /const imageCredits = row\.imageCredits && Object\.keys\(row\.imageCredits\)\.length\s*\n?\s*\? JSON\.stringify\(row\.imageCredits\) : null;/);
});

// ==========================================================================================
console.log('\nmadde 1 — okuma yolu: liste yükü şişmez, eşlemesiz kare künyeye düşer');

await test('shapeProjectItem: alan yalnızca GERÇEKTEN eşleme varsa yüke girer', () => {
  const fn = projectPool.match(/export function shapeProjectItem[\s\S]*?\n\}/)[0];
  assert.match(fn, /\.\.\.\(Object\.keys\(imageCredits\)\.length \? \{ imageCredits \} : \{\}\)/,
    'boş nesne yüzlerce karta iliştirilirse liste JSON\'u karşılıksız şişer');
  // coverOnly (kart/liste yolu): yalnızca KAPAK görselininki — imageHotspots ile AYNI kapsam.
  assert.match(fn, /if \(coverOnly\) \{[\s\S]*?imageCredits = \(cover && allCredits\[cover\]\)/);
});

await test('gallery.js: "© ..." etiketi HER görsel değişiminde tazelenir', () => {
  // Eskiden metin init'te BİR kez yazılıyor ve galeri boyunca sabit kalıyordu — görsel başına
  // fotoğrafçı bu yüzden hiç görünmezdi.
  assert.match(gallery, /function paintCredit\(url\)\{/);
  const show = gallery.match(/function showLightboxImage\(i, openHotspotIndex\)\{[\s\S]*?\n  \}/)[0];
  assert.match(show, /paintCredit\(img\);/, 'görsel değişiminde etiket tazelenmiyor');
});

await test('eşlemesi OLMAYAN kare künyenin TAMAMINA düşer (geriye dönük davranış)', () => {
  const fn = gallery.match(/function paintCredit\(url\)\{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /st\.credits && st\.credits\[url\]\) \|\| st\.credit/,
    'yedek `st.credit` kaldırılırsa bu alanı taşımayan TÜM projelerin etiketi boşalır');
});

await test('paintCredit durumu STATE\'ten CANLI okur (kapanışa gömülmez)', () => {
  const fn = gallery.match(/function paintCredit\(url\)\{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /galleryEl\._pmGalleryState/,
    'dinleyiciler yalnızca İLK çağrıda bağlanıyor — gömülü değer N. projede 1. projenin künyesini yazardı');
  assert.match(gallery, /state\.credits = creditsByUrl;/);
});

await test('project-gallery.js iki yeni alanı da geçirir', () => {
  assert.match(projectGallery, /credits: item\.imageCredits \|\| \{\}/);
  assert.match(projectGallery, /photoClaim: item\.slug \? \{ projectSlug: item\.slug \} : null/);
});

// ==========================================================================================
console.log('\nmadde 1 — proje-ekle formu');

await test('menü YALNIZCA iki ya da daha fazla fotoğrafçı varken çizilir', () => {
  assert.match(projeEkle, /const showCredit = creditOptions\.length > 1;/);
  assert.match(projeEkle, /const creditSelect = showCredit\s*\n?\s*\?/,
    'tek fotoğrafçıda menü çizilmemeli (kullanıcı isteğinin şartı)');
});

await test('seçenekler KÜNYEDEN türer, ikinci bir liste yok', () => {
  const fn = projeEkle.match(/function photographerNames\(\)\{[\s\S]*?\n\}/)[0];
  assert.match(fn, /getElementById\('p-credit-text'\)\.value/,
    'seçenekler kutunun kendi iç durumundan okunursa gönderilen değerle ayrışabilir');
  assert.match(fn, /foldTrLocal/, 'aynı ad iki kez seçenek olarak çizilmemeli');
});

await test('seçim mediaItems öğesinde taşınır (sürükle-bırak onu da götürür)', () => {
  assert.match(projeEkle, /function setExistingImages\(urls, hotspotsByUrl, creditsByUrl\)\{/);
  assert.match(projeEkle, /credit: typeof cr\[url\] === 'string' \? cr\[url\] : ''/);
  // Kırpma görselin PİKSELLERİNİ değiştirir, fotoğrafçısını değil.
  assert.match(projeEkle, /kind:'file', file, objectUrl: URL\.createObjectURL\(file\), hotspots: item\.hotspots \|\| \[\], credit: item\.credit \|\| ''/);
});

await test('gönderim GÖRSEL URL\'sine göre anahtarlar (indekse göre DEĞİL)', () => {
  const fn = projeEkle.match(/function collectImageCredits\(\)\{[\s\S]*?\n\}/)[0];
  assert.match(fn, /out\[item\.finalUrl\] = item\.credit;/,
    'indeks anahtarı her sürükle-bırak sıralamasında yanlış fotoğrafçıyı gösterirdi');
  assert.match(projeEkle, /imageCredits: collectImageCredits\(\),/, 'alan payload\'a hiç girmiyor');
});

await test('künyeden çıkarılmış ad ne kaydedilir ne gösterilir (İKİ kapı)', () => {
  assert.match(projeEkle, /function pruneImageCredits\(\)\{/);
  // 1. kapı: kutu değiştiğinde temizle.
  assert.match(projeEkle, /getElementById\('p-credit-text'\)\.addEventListener\('input', \(\)=>\{\s*\n\s*pruneImageCredits\(\);\s*\n\s*renderPreviews\(\);/);
  // 2. kapı: kaydetme anında bir daha süz — prefill sonrası kutu hiç dokunulmamış olabilir.
  const fn = projeEkle.match(/function collectImageCredits\(\)\{[\s\S]*?\n\}/)[0];
  assert.match(fn, /if\(!allowed\.has\(foldTrLocal\(item\.credit\)\)\) continue;/);
});

await test('menü sürükleme ve işaretleme editörünü TETİKLEMEZ', () => {
  // <select> bir <button> DEĞİL: eski `closest('button')` koruması onu yakalamıyordu, yani menüye
  // basmak hem basılı-tutma sürüklemesini hem işaretleme editörünü açıyordu.
  const guards = projeEkle.match(/e\.target\.closest\('button, select'\)/g) || [];
  assert.equal(guards.length, 2, 'pointerdown ve click korumalarının İKİSİ de select\'i muaf tutmalı');
});

await test('düzenleme akışı kayıtlı seçimleri geri yükler (İKİ prefill yolu)', () => {
  // Taslak yolu (?edit=) ve canonical yolu (?claim=) — ikisi de kendi kaynağından okumalı.
  assert.match(projeEkle, /setExistingImages\(item\.images \|\| \[\], item\.imageHotspots \|\| \{\}, item\.imageCredits \|\| \{\}\)/);
  assert.match(projeEkle, /setExistingImages\(merged\.images \|\| \[\], merged\.imageHotspots \|\| \{\}, merged\.imageCredits \|\| \{\}\)/);
});

// ==========================================================================================
console.log('\nmadde 2 — "Fotoğraf bana ait": şema, kapı ve onay');

await test('migration: onay kuyruğu tablosu + mükerrer bekleyen talebi engelleyen indeks', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS project_photo_claims/);
  assert.match(migration, /status TEXT NOT NULL DEFAULT 'pending'/);
  const idx = migration.match(/CREATE UNIQUE INDEX IF NOT EXISTS idx_ppc_pending_unique[\s\S]*?;/)[0];
  assert.match(idx, /WHERE status = 'pending'/,
    'kısmi olmasaydı reddedilen bir talep bir daha hiç açılamazdı');
  assert.match(idx, /COALESCE\(image_url, ''\)/,
    "SQLite'ta NULL'lar UNIQUE'i tetiklemez — proje geneli talepler sınırsız tekrarlanabilirdi");
});

await test('ONAY KUYRUĞU ATLATILAMAZ: POST status\'ü istemciden okumaz', () => {
  const fn = photoClaims.match(/async function createClaim[\s\S]*?\n\}/)[0];
  assert.ok(!/body\.status/.test(fn), 'status gövdeden okunuyor — üye kendi talebini onaylayabilirdi');
  // Admin dalı 'approved', diğer herkes PENDING — karar rolden türer.
  assert.match(fn, /if \(isAdmin\(user\)\) \{[\s\S]*?'approved'/);
  assert.match(fn, /VALUES \(\?, \?, \?, \?, \?, \?, '\$\{PENDING\}', \?\)/);
});

await test('karar verme AYRI bir uç ve kendi yetki kontrolü var', () => {
  assert.match(photoClaims, /async function decideClaim/);
  const fn = photoClaims.match(/async function decideClaim[\s\S]*?\n\}/)[0];
  assert.match(fn, /if \(!\(await canDecide\(env, user, project \? project\.id : null\)\)\)/);
  assert.match(fn, /return errorJson\('Bu talebi onaylama yetkin yok\.', 403\)/);
  assert.match(fn, /if \(claim\.status !== PENDING\) return errorJson/, 'karara bağlanmış talep ikinci kez uygulanabilirdi');
});

await test('BİLDİRİM ALICILARI = KARAR KÜMESİ (tek fonksiyon)', () => {
  // Ayrı ayrı hesaplanırsa biri diğerinde olmayan bir kullanıcıya "onayına sunuldu" bildirimi
  // gider ve o kişi butona bastığında 403 alır.
  assert.match(photoClaims, /async function officeManagerUserIds/);
  const decide = photoClaims.match(/async function canDecide[\s\S]*?\n\}/)[0];
  assert.match(decide, /officeManagerUserIds\(env, projectId\)\)\.has\(user\.id\)/);
  const create = photoClaims.match(/async function createClaim[\s\S]*?\n\}/)[0];
  assert.match(create, /await officeManagerUserIds\(env, project\.id\)/);
  assert.match(create, /await adminUserIds\(env\)/, 'kullanıcı isteği: "firma yöneticilerine VE admine"');
});

await test('yönetici tanımı TEK kaynaktan okunur (fetchOfficeManagers + OFFICE_EDIT_POSITIONS)', () => {
  assert.match(photoClaims, /import \{ fetchOfficeManagers \} from '\.\.\/lib\/claimedProfiles\.js'/);
  assert.match(photoClaims, /import \{ OFFICE_EDIT_POSITIONS \} from '\.\.\/lib\/projectClaimAccess\.js'/);
  // Kuralın ikinci bir kopyası (elle profile_claims sorgusu) YAZILMAMIŞ olmalı.
  assert.ok(!/FROM profile_claims/.test(photoClaims),
    'yönetici kuralının ikinci bir kopyası açılmış — "Yetkili Kullanıcılar" listesiyle ayrışır');
});

await test('onay İKİ hedefe birden yazar: lightbox (image_credits) + künye (photo_credit_text)', () => {
  const fn = photoClaims.match(/async function applyPhotoClaim[\s\S]*?\n\}/)[0];
  assert.match(fn, /UPDATE projects SET photo_credit_text = \?, image_credits = \?/,
    'kullanıcı isteğinin iki cümlesi ("lightboxa ve proje künyesine") iki hedefi birden gerektirir');
  // Zaten künyede olan ad ikinci kez YAZILMAZ; karşılaştırma foldTr ile ("Ayça"/"Ayca" aynı ad).
  assert.match(fn, /existingNames\.some\(n => foldTr\(n\) === foldTr\(name\)\)/);
});

await test('TASLAK da güncellenir (aksi halde sonraki kaydetmede sessiz veri kaybı)', () => {
  const fn = photoClaims.match(/async function applyPhotoClaim[\s\S]*?\n\}/)[0];
  assert.match(fn, /FROM project_submissions/);
  assert.match(fn, /UPDATE project_submissions SET photoCreditText = \?, imageCredits = \?/,
    'canonicalSync bu iki alanı taslaktan BAŞTAN yazıyor — yalnızca canonical\'a yazmak onaylanan adı iz bırakmadan silerdi');
  // Birden fazla taslak aynı projeye bağlı olabilir (proje sahiplenmesi + admin düzenlemesi).
  assert.match(fn, /for \(const draft of \(drafts\.results \|\| \[\]\)\)/);
});

await test('onaylanan ad sitede profili varsa TIKLANABİLİR olur (aynı eşleşme kuralı)', () => {
  const fn = photoClaims.match(/async function applyPhotoClaim[\s\S]*?\n\}/)[0];
  assert.match(fn, /findOneByName\(env, 'architects', name\)/,
    'canonicalSync#syncProject ile AYNI kural olmalı — ayrışırsa aynı ad bir yolda çipe, diğerinde metne dönerdi');
  assert.match(fn, /INSERT OR IGNORE INTO project_photographers/);
});

await test('detay ÖNBELLEĞİ purge edilir (invalidatePublicCache TEK BAŞINA yetmez)', () => {
  const fn = photoClaims.match(/async function applyPhotoClaim[\s\S]*?\n\}/)[0];
  assert.match(fn, /purgeSsrDetailCache\('project', project\.slug, env\)/,
    '/api/project/:slug fingerprint taşımaz: onay veren kişi "onayladım ama görünmüyor" derdi');
  assert.match(fn, /invalidatePublicCache\(env\)/);
});

await test('görsel projenin galerisinde değilse onay uygulanmaz', () => {
  const fn = photoClaims.match(/async function applyPhotoClaim[\s\S]*?\n\}/)[0];
  assert.match(fn, /Bu görsel projenin galerisinde artık yok/,
    'proje sahibi kareyi kaldırmışsa ad hiç görünmeyecek bir URL\'ye yazılırdı');
});

await test('kuyruk spam\'ine karşı hız sınırı var, adminler muaf', () => {
  assert.match(photoClaims, /CLAIM_HOURLY_LIMIT/);
  assert.match(photoClaims, /if \(!isAdmin\(user\) && !\(await checkRateLimit\(env, 'photo-claim', user\.id, CLAIM_HOURLY_LIMIT/);
});

await test('/access oturumsuz istekte 200 + canClaim:false döner (401 DEĞİL)', () => {
  // 401 her proje sayfasında gereksiz bir konsol hatası üretirdi; "hayır" doğru ve beklenen yanıt.
  assert.match(photoClaims, /if \(!user\) return json\(\{ canClaim: false, name: '' \}\);/);
  // Diğer TÜM uçlar oturum ister.
  assert.match(photoClaims, /if \(!user\) return errorJson\('Bu işlem için giriş yapmalısın\.', 401\);/);
});

await test('uç kendi kök yolunda kayıtlı (/api/projects önekinin altında DEĞİL)', () => {
  assert.match(indexJs, /import \{ handlePhotoClaimsRoute \} from '\.\/routes\/photoClaims\.js'/);
  assert.match(indexJs, /if \(path\.startsWith\('\/api\/photo-claims'\)\) return handlePhotoClaimsRoute/);
});

// ==========================================================================================
console.log('\nmadde 2 — istemci: buton, form ve onay pop-up\'ı');

await test('buton GİZLİ doğar ve yalnızca sunucu "evet" derse açılır', () => {
  // Varsayılan "görünür" olsaydı, yanıt gecikirse OTURUMSUZ ziyaretçiler butonu bir an görürdü.
  const block = gallery.match(/if\(photoClaim && !claimBtn\)\{[\s\S]*?\n  \}/)[0];
  assert.match(block, /claimBtn\.style\.display = 'none';/);
  assert.match(block, /PhotoClaimer\.hasAccess\(\)\.then/);
});

await test('kilitli (önizleme) projede buton gizlenir', () => {
  assert.match(gallery, /if\(claimBtn\) claimBtn\.classList\.toggle\('is-locked', locked\);/);
  assert.match(gallery, /\.lightbox-claim-btn\.is-locked\{display:none !important;\}/);
});

await test('galeri başka bir sahibe geçtiğinde buton kaldırılır', () => {
  // Ürün galerisi (product-modal.js) photoClaim'i hiç geçmez — orada buton hiç oluşmamalı.
  assert.match(gallery, /if\(!photoClaim && claimBtn\)\{ claimBtn\.remove\(\); claimBtn = null; \}/);
});

await test('aktif proje/görsel STATE\'ten CANLI okunur', () => {
  const l = gallery.match(/if\(claimBtnEl\) claimBtnEl\.addEventListener\('click'[\s\S]*?\n  \}\);/)[0];
  assert.match(l, /const st = galleryEl\._pmGalleryState;/);
  assert.match(l, /imageUrl: st\.images\[st\.lightboxIndex\] \|\| ''/,
    'kapanışa gömülen slug N. projede 1. projenin talebini açardı');
});

await test('açık form Escape/arka plan/ızgara ile kapanır, lightbox kapanmaz', () => {
  assert.match(gallery, /PhotoClaimer\.isOpen\(\)\)\{\s*\n\s*e\.stopPropagation\(\); PhotoClaimer\.close\(\); return;/);
  assert.match(gallery, /if\(typeof PhotoClaimer !== 'undefined' && PhotoClaimer\.isOpen\(\)\)\{ PhotoClaimer\.close\(\); return; \}/);
  assert.match(gallery, /closeClaimForm\(\);\s*\n?\s*setGridMode/);
  // Form üzerindeki dokunuş swipe'a dönüşmemeli (işaretleme formuyla AYNI koruma).
  assert.match(gallery, /'\.ih-dot, \.ih-card, \.ht-form, \.pc-form, \.lightbox-tag-hint'/);
});

await test('form künyeye yazılacak adı hesap adıyla ÖNDEN doldurur ama kilitlemez', () => {
  // Hesap adı ile künyede görünmek istenen ad AYNI ŞEY DEĞİLDİR (stüdyo adı) — bkz. CLAUDE.md
  // "Hesap üyeliği ile kişi profili AYRIDIR".
  assert.match(photoClaimJs, /value="\$\{esc\(defaultName\)\}"/);
  assert.match(photoClaimJs, /defaultName = \(d && d\.name\) \|\| '';/);
});

await test('kapsam seçimi: tek kare mi, projenin tamamı mı', () => {
  assert.match(photoClaimJs, /name="pc-scope" value="image"/);
  assert.match(photoClaimJs, /name="pc-scope" value="all"/);
  // Sunucu ayrımı imageUrl'in BOŞ olup olmamasıyla okur.
  assert.match(photoClaimJs, /imageUrl: wholeProject \? '' : \(opts\.imageUrl \|\| ''\)/);
});

await test('form içindeki tıklama host\'un "boşluğa tıklandı" dinleyicisine kabarmaz', () => {
  // Dinleyici formun KENDİSİNDE — `closest('.pc-form')` koruması, kendi handler'ında DOM'dan
  // kaldırılan bir öğede kopuk e.target yüzünden null dönerdi (hotspot-tagger.js'teki gerçek bulgu).
  assert.match(photoClaimJs, /form\.addEventListener\('click', \(e\) => e\.stopPropagation\(\)\);/);
});

await test('bildirim satırı onay pop-up\'ını açar (photo-claim:<id>)', () => {
  assert.match(photoClaims, /`photo-claim:\$\{id\}`/);
  assert.match(authModal, /function photoClaimIdFromLink\(link\) \{/);
  assert.match(authModal, /link\.startsWith\('photo-claim:'\)/);
  assert.match(authModal, /const photoClaimId = photoClaimIdFromLink\(item\.link\);\s*\n\s*if \(photoClaimId\) return \{ run: \(\) => openPhotoClaimPrompt\(photoClaimId\) \};/);
});

await test('onay pop-up\'ı karar butonlarını YALNIZCA yetkiliye çizer', () => {
  const fn = authModal.match(/function openPhotoClaimPrompt[\s\S]*?\n    \}\n/)[0];
  assert.match(fn, /\$\{\(!decided && data\.canDecide\) \?/,
    'yetkisiz kullanıcı (talebi açan kişi) Onayla/Reddet görmemeli');
  assert.match(fn, /am-pc-approve/);
  assert.match(fn, /am-pc-reject/);
});

await test('script etiketi İKİ kabukta da var + SSR sürümü artırıldı', () => {
  assert.match(projeHtml, /<script src="js\/components\/photo-claim\.js" defer><\/script>/);
  assert.match(top100Html, /<script src="js\/components\/photo-claim\.js" defer><\/script>/);
  assert.match(lazyModals, /'js\/components\/photo-claim\.js'/,
    'pop-up başka bir sayfadan tembel yüklendiğinde modül gelmezdi');
  // Sürüm artırılmazsa daha önce ziyaret edilmiş /proje/:slug sayfaları eski kabuğu sunar ve
  // buton görünür ama basıldığında (PhotoClaimer tanımsız) sessizce hiçbir şey yapmaz.
  const v = ssrCache.match(/export const SSR_CACHE_VERSION = '(v\d+)';/)[1];
  assert.ok(Number(v.slice(1)) >= 140, `SSR_CACHE_VERSION ${v} — photo-claim.js eklendi, artırılmalı`);
});

// ==========================================================================================
console.log('\nmadde 3 — giriş ekranında şifre göz işareti');

await test('kural TEK modülde (iki yüzey için iki kopya değil)', () => {
  assert.match(passwordReveal, /window\.PasswordReveal = \{ wire: wire, wireAll: wireAll \};/);
  // İki yüzeyin hiçbiri kendi göz düğmesini elle kurmamalı.
  assert.ok(!/pw-reveal-btn/.test(girisYap), 'giris-yap.html düğmeyi elle kurmuş — kural ikiye ayrılır');
  assert.ok(!/pw-reveal-btn/.test(authModal), 'auth-modal.js düğmeyi elle kurmuş — kural ikiye ayrılır');
});

await test('input\'un KENDİSİ korunur: id/name/required ve DOM yeri değişmez', () => {
  const fn = passwordReveal.match(/function wire\(input\) \{[\s\S]*?\n  \}/)[0];
  // input YENİDEN OLUŞTURULMAZ, yalnızca etrafına sarmalayıcı eklenir — formu gönderen kodlar
  // ona id ile ulaşıyor ve tarayıcının şifre yöneticisi de aynı düğüme bakıyor.
  assert.match(fn, /input\.parentNode\.insertBefore\(wrap, input\);/);
  assert.match(fn, /wrap\.appendChild\(input\);/);
  assert.ok(!/createElement\('input'\)/.test(passwordReveal), 'input yeniden oluşturulmuş');
  assert.match(girisYap, /<input type="password" id="login-password" name="password"[^>]*required data-password-reveal>/);
  assert.match(authModal, /<input type="password" id="am-login-password" name="password"[^>]*required>/);
});

await test('düğme type="button" (aksi halde formu GÖNDERİR)', () => {
  assert.match(passwordReveal, /btn\.type = 'button';/);
});

await test('tıklama type\'ı password <-> text arasında çevirir', () => {
  const fn = passwordReveal.match(/btn\.addEventListener\('click'[\s\S]*?\n    \}\);/)[0];
  assert.match(fn, /input\.type = revealed \? 'password' : 'text';/);
  assert.match(fn, /input\.setSelectionRange\(end, end\)/, 'düğmeye bastıktan sonra yazmaya devam edilebilmeli');
});

await test('aynı input\'a iki kez düğme takılmaz', () => {
  // Giriş pop-up'ı şablonunu her açılışta yeniden basabilir ve wireLogin tekrar çağrılır.
  assert.match(passwordReveal, /if \(!input \|\| input\.dataset\.pwRevealed === '1'\) return null;/);
});

await test('bağımsız sayfa: modül yüklü + işaret özniteliği (sıralama tuzağı kapalı)', () => {
  assert.match(girisYap, /<script src="js\/components\/password-reveal\.js" defer><\/script>/);
  assert.match(girisYap, /data-password-reveal/);
  // Modül kendi taramasını yapar — sayfanın satır içi script'i defer'li modülden ÖNCE koştuğu
  // için orada yazılacak bir PasswordReveal.wire() çağrısı tanımsız referansla patlardı.
  assert.match(passwordReveal, /function sweep\(\) \{ wireAll\(document, '\[data-password-reveal\]'\); \}/);
  assert.match(passwordReveal, /document\.addEventListener\('DOMContentLoaded', sweep\)/);
});

await test('pop-up: modül TEMBEL yüklenir ve yüklenemezse giriş akışı bozulmaz', () => {
  assert.match(authModal, /function ensurePasswordRevealLoaded\(\)/);
  assert.match(authModal, /ensurePasswordRevealLoaded\(\)\s*\n\s*\.then\(\(\) => PasswordReveal\.wire\(document\.getElementById\('am-login-password'\)\)\)\s*\n\s*\.catch\(\(\) => \{\}\);/);
  // onerror ele alınmazsa söz sonsuza kadar askıda kalır (lazy-modals.js'teki gerçek bulgu).
  const fn = authModal.match(/function ensurePasswordRevealLoaded\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /script\.onerror = \(\) => \{ script\.remove\(\); passwordRevealLoad = null; reject/);
});

await test('göz işareti kutunun EN SAĞINDA ve metni ezmez', () => {
  assert.match(passwordReveal, /\.pw-reveal-btn\{[\s\S]*?right:6px/);
  // Input'un GENİŞLİĞİNE dokunulmaz; yerine sağ padding artar, uzun bir şifre düğmenin altına girmez.
  assert.match(passwordReveal, /\.pw-reveal-wrap > input\{padding-right:44px !important;\}/);
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
process.exit(failed ? 1 : 0);
