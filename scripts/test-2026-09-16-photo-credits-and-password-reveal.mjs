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
// MADDE 2 (lightbox'taki "Fotoğraf bana ait" butonu) AYNI GÜN GERİ ALINDI — kullanıcı isteği,
//   ÜÇÜNCÜ tur madde 2: "Lightboxlardaki 'Fotoğraf bana ait' butonunu kaldır." Akışın KENDİSİ
//   yaşıyor ama giriş noktası kişi pop-up'ındaki "Fotoğraflarını Bul" oldu; onay kuyruğunun tüm
//   sözleşmeleri (kuyruk atlatılamaz, bildirim alıcıları = karar kümesi, taslak da güncellenir,
//   detay önbelleği purge edilir) artık
//   scripts/test-2026-09-16-find-photos-and-mobile-tag-button.mjs'te kelepçelenir. Bu dosyada
//   yalnızca hâlâ geçerli olan MADDE 1 ve MADDE 3 kalır.
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

await test('project-gallery.js görsel başına fotoğrafçı haritasını geçirir', () => {
  assert.match(projectGallery, /credits: item\.imageCredits \|\| \{\}/);
  // photoClaim alanı ÜÇÜNCÜ turda kaldırıldı (buton kalktı) — geri gelirse lightbox'ta yeniden
  // "Fotoğraf bana ait" butonu doğardı.
  assert.ok(!/photoClaim/.test(projectGallery), 'photoClaim geri gelmiş — buton kullanıcı isteğiyle kaldırıldı');
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

// MADDE 2'nin testleri bu dosyadan ÇIKARILDI — bkz. yukarıdaki başlık notu: buton kaldırıldı,
// akış scripts/test-2026-09-16-find-photos-and-mobile-tag-button.mjs'e taşındı.

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
