#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-16 — sekiz madde, tek test dosyası.
//
// MADDE 1 (karusel slotları) scripts/test-2026-09-12-home-rails.mjs ve -home-bento.mjs'te
//   kelepçelenir (slot sabitleri zaten o iki dosyanın konusu) — burada tekrarlanmaz.
//
// MADDE 2 — proje-ekle "Projede Kullanılan Ürünler" > Ürün firması: <select> yerine office-picker
//   paneli. Kaynak DEĞİŞTİ: /api/products/brands (yalnızca ÜRÜNÜ OLAN markalar) -> /api/offices/names
//   (tüm firmalar). Gizli input sözleşmesi korunmalı — bozulursa kullanıcının gördüğü seçim ile
//   gönderilen değer sessizce ayrışır.
//
// MADDE 3 — kisi-ekle: Firmalar kutusu Sosyal Medya'nın ÜSTÜNE geçti.
//
// MADDE 4 — urun-ekle: Grup ZORUNLU ve kategori menüsü grup seçilene kadar kapalı. Eskiden menü
//   ilk gruba KİLİTLİ açılıyordu (yer tutucu seçenek yoktu), yani kullanıcı hiç dokunmadan bir
//   grup seçmiş sayılıyordu.
//
// MADDE 5 — admin > Üyeler: satır numarası. En ALTTAKİ (en eski) üye 1. Numara TAM listeden
//   hesaplanmalı, filtrelenmişten değil — aksi halde arama kutusuna yazınca aynı üye başka bir
//   numara alırdı.
//
// MADDE 6 — admin > Migrasyon Çakışmaları sekmesi kaldırıldı (sunucu ucu DURUYOR).
//
// MADDE 7 — KIRIK PROFİL FOTOĞRAFI. İKİ KÖK NEDEN, ikisi de burada kelepçelenir:
//   (a) ÇÖZÜM TABANI. D1'deki bazı görsel yolları köke görelidir ve başında eğik çizgi YOKTUR
//       ("mimarlar/x.jpg", "logos-thumb/y.jpg" — legacy_static). safeUrl bunları document.baseURI'ye
//       göre çözüyordu; <base href="/"> taşıyan sayfalarda (kisi/firma/proje/urun) bu kök demekti
//       ve doğru çalışıyordu. Ama pop-up ana sayfadan/aramadan da AYNI belgede açılıyor ve açılırken
//       adres pushState ile "/kisi/<slug>"a dönüyor; <base> olmayan o belgelerde baseURI de o anda
//       "/kisi/<slug>" oluyor ve yol "/kisi/mimarlar/x.jpg"e çözülüp 404 veriyordu. Sayfa
//       yenilenince sunucu <base href="/"> taşıyan belgeyi servis ettiği için sorun kendiliğinden
//       "düzeliyordu" — bildirilen davranış tam olarak bu.
//   (b) GÖRÜNEN KUSUR. Başlık avatarı, baş harfleri yazan dairenin İÇİNE basılan ve kendi
//       `onerror = () => img.remove()` yedeğini taşıyan bir <img>'dir. Ama broken-image-fallback.js
//       `error`'ı BELGE ÜZERİNDE yakalayıp img'i alt metninden baş harf üreten bir kutuyla
//       değiştiriyordu; alt boş olduğundan kutu "—" yazıyor ve dairenin yanında duruyordu.
//   Aynı sınıf hata FİRMA pop-up'ında da vardı (kullanıcı "firma popuplarında da var mı bak" dedi):
//   logo <img>'i cdnImg'e HAM değeri verdiğinden src'si sağlamdı, ama BÜYÜTME yolu
//   (data-lightbox-src) ham göreli değeri taşıyor ve image-lightbox.js onu doğrudan imgEl.src'ye
//   atıyordu — aynı yanlış çözümleme. Lightbox artık site köküne göre çözer.
//
// MADDE 8 — "İz Bırakan" rozetli FİRMADA İş/Staj kutusu ve "Bu firma sana mı ait?" yok.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

const projeEkle = read('proje-ekle.html');
const kisiEkle = read('kisi-ekle.html');
const urunEkle = read('urun-ekle.html');
const adminHtml = read('admin.html');
const brokenFallback = read('js/components/broken-image-fallback.js');
const lightbox = read('js/components/image-lightbox.js');
const officeModal = read('js/components/office-modal.js');
const claimBox = read('js/components/claim-correction-box.js');

// ------------------------------------------------------------------------------------------
console.log('\nmadde 2 — proje-ekle: Ürün firması kutusu tüm firmaları listeler + arama');

await test('eski <select> ve /api/products/brands kaynağı kalmadı', () => {
  assert.ok(!/<select id="p-brand-select"/.test(projeEkle), 'ürün firması hâlâ <select>');
  assert.ok(!projeEkle.includes("fetch('/api/products/brands')"),
    'kutu hâlâ yalnızca ürünü olan markaları çeken uçtan besleniyor');
});

await test('gizli input sözleşmesi korunuyor (#p-brand-select) ve kutu ona bağlı', () => {
  assert.match(projeEkle, /<input type="hidden" id="p-brand-select">/);
  assert.match(projeEkle, /<div id="p-brand-picker"><\/div>/);
  // Kutu, yukarıdaki üç kutuyla AYNI bileşenden; single + input bağı şart.
  const call = projeEkle.match(/brandPicker = createOfficePicker\(document\.getElementById\('p-brand-picker'\), \{[\s\S]*?\}\);/);
  assert.ok(call, 'brandPicker kurulmuyor');
  assert.match(call[0], /input: brandSelect/, 'kutu gizli input ile senkronlanmıyor');
  assert.match(call[0], /single: true/, 'ürün firması TEK seçim olmalı (yanındaki Ürün menüsünü o belirler)');
  assert.ok(!/allowCustom/.test(call[0]), 'bu kutu serbest metne açılmamalı — sitede kayıtlı firma seçer');
});

await test('arama kutusu office-picker panelinden gelir (kutu kendi listesini basmaz)', () => {
  // createOfficePicker -> createNamePicker -> .op-search; ayrı bir arama girişi yazılmamalı.
  const picker = read('office-picker.js');
  assert.match(picker, /class="op-search"/, 'panelde arama kutusu yok');
  assert.ok(!/id="p-brand-search"/.test(projeEkle), 'sayfa kendi ikinci arama kutusunu açmış');
});

await test('seçim değişince Ürün menüsü senkronlanır; "+ Ekle" seçimi kutu üzerinden sıfırlar', () => {
  // Gizli input `change` yaymaz — dinleyici `input` olmalı (bkz. office-picker.js#pushToInput).
  assert.match(projeEkle, /brandSelect\.addEventListener\('input', syncProductField\);/);
  assert.ok(!/brandSelect\.addEventListener\('change'/.test(projeEkle),
    'gizli input `change` yaymaz — menü senkronu hiç çalışmazdı');
  // Doğrudan `.value = ''` kutunun etiketini/çipini eski firmada bırakırdı.
  assert.match(projeEkle, /brandPicker\.set\(\[\]\)/);
});

// ------------------------------------------------------------------------------------------
console.log('\nmadde 3 — kisi-ekle: Firmalar kutusu Sosyal Medya\'nın üstünde');

await test('bölüm sırası: ... -> Firmalar -> Sosyal Medya -> Profil Fotoğrafı', () => {
  const firms = kisiEkle.indexOf('<h2>Firmalar ');
  const social = kisiEkle.indexOf('<h2>Sosyal Medya ');
  const photo = kisiEkle.indexOf('<h2>Profil Fotoğrafı</h2>');
  assert.ok(firms > 0 && social > 0 && photo > 0, 'üç başlıktan biri bulunamadı');
  assert.ok(firms < social, 'Firmalar kutusu hâlâ Sosyal Medya\'nın altında');
  assert.ok(social < photo, 'Sosyal Medya kutusu Profil Fotoğrafı\'nın altına kaymış');
});

await test('taşımada kutuların İÇERİĞİ bozulmadı (alanlar hâlâ tek ve yerinde)', () => {
  for (const id of ['social-rows', 'social-add-btn', 'm-office', 'm-office-picker', 'dd-pozisyon']) {
    assert.equal(kisiEkle.split(`id="${id}"`).length - 1, 1, `${id} bir kez geçmeli`);
  }
  // Firma kutusunun uyarı notu da onunla birlikte taşınmış olmalı.
  const firmsBlock = kisiEkle.slice(kisiEkle.indexOf('<h2>Firmalar '), kisiEkle.indexOf('<h2>Sosyal Medya '));
  assert.ok(firmsBlock.includes('id="m-office-picker"'), 'firma kutusu Firmalar bölümünde değil');
  assert.ok(firmsBlock.includes('Seçtiğin firma admin onayına gönderilir'), 'firma kutusunun notu geride kalmış');
});

// ------------------------------------------------------------------------------------------
console.log('\nmadde 4 — urun-ekle: Grup zorunlu, kategori grup seçilene kadar kapalı');

await test('Grup menüsü yer tutucuyla açılır ve required', () => {
  assert.match(urunEkle, /<select id="u-group" aria-describedby="u-group-hint" required><\/select>/);
  assert.match(urunEkle, /<option value="">Grup seç…<\/option>/);
  // Etiketin yıldızı: kategori ile AYNI işaret.
  assert.match(urunEkle, /<label for="u-group">Grup <span class="req" aria-hidden="true">\*<\/span><\/label>/);
});

await test('grup boşken kategori menüsü disabled ve yönlendirici yer tutucu taşır', () => {
  assert.match(urunEkle, /const CATEGORY_NO_GROUP = 'Önce grup seç';/);
  const fn = urunEkle.slice(urunEkle.indexOf('function populateCategoryOptions(group){'));
  const body = fn.slice(0, fn.indexOf('\nfunction renderCategoryChips'));
  assert.match(body, /if\(!group\)\{[\s\S]*categoryDropdown\.disabled = true;[\s\S]*return;[\s\S]*\}/);
  assert.match(body, /categoryDropdown\.disabled = false;/, 'grup seçilince menü tekrar açılmalı');
  // Seçili kategoriler SİLİNMEZ: grup geçici boşalırsa kullanıcının seçimi kaybolmamalı.
  assert.ok(!/selectedCategories\.clear\(\)/.test(body), 'grup boşalınca seçili kategoriler siliniyor');
});

await test('submit Grup boşken durur (kategori guard\'ıyla AYNI desen)', () => {
  const idx = urunEkle.indexOf("notice.textContent = 'Grup seç.';");
  const catIdx = urunEkle.indexOf("notice.textContent = 'En az bir kategori seç.';");
  assert.ok(idx > 0, 'Grup guard\'ı yok');
  assert.ok(idx < catIdx, 'Grup kontrolü kategori kontrolünden SONRA — önce grup seçilmeli');
  assert.match(urunEkle, /if\(!groupSelect\.value\)\{\n\s*notice\.textContent = 'Grup seç\.';/);
});

// ------------------------------------------------------------------------------------------
console.log('\nmadde 5 — admin > Üyeler: en alttaki üye 1');

await test('numara TAM listeden hesaplanır (arama filtresi numarayı kaydırmaz)', () => {
  assert.match(adminHtml, /const userNo = new Map\(all\.map\(\(u, i\) => \[u\.id, all\.length - i\]\)\);/);
  // `items` filtrelenmiş liste — numara ondan türetilseydi arama sonuçları 1'den başlardı.
  assert.ok(!/items\.map\(\(u, i\) => \[u\.id/.test(adminHtml), 'numara filtrelenmiş listeden türetiliyor');
  assert.match(adminHtml, /<span class="users-list-no">\$\{userNo\.get\(u\.id\) \|\| ''\}<\/span>/);
});

await test('sunucu sırası created_at DESC — "en alttaki 1" bu sıraya dayanır', () => {
  const adminRoute = read('src/routes/admin.js');
  assert.match(adminRoute, /FROM users ORDER BY created_at DESC LIMIT \d+/);
});

// ------------------------------------------------------------------------------------------
console.log('\nmadde 6 — admin: Migrasyon Çakışmaları sekmesi kaldırıldı');

await test('sekme, bölüm, JS ve özet noktası admin.html\'den gitti', () => {
  for (const frag of ['data-tab="conflicts"', 'id="section-conflicts"', 'conflicts-status-filter',
                      'conflicts-type-filter', 'conflicts-refresh', 'conflicts-list',
                      'loadMigrationConflicts', 'pendingMigrationConflicts']) {
    assert.ok(!adminHtml.includes(frag), `${frag} hâlâ admin.html'de`);
  }
});

await test('sunucu ucu DURUYOR (kaldırma yalnızca ekranı kapsıyordu)', () => {
  const adminRoute = read('src/routes/admin.js');
  assert.match(adminRoute, /sub === 'migration-conflicts'/);
  assert.match(read('scripts/smoke-test.sh'), /\/api\/admin\/migration-conflicts" 401/);
});

// ------------------------------------------------------------------------------------------
console.log('\nmadde 7 — kırık profil fotoğrafı: iki kök neden');

await test('(a) safeUrl SABİT SİTE KÖKÜNE çözer — document.baseURI DEĞİL', () => {
  // Pop-up'ı basan/bağlayan HER modül: biri geride kalırsa aynı kırılma o yüzeyde sürerdi.
  for (const f of ['js/components/architect-modal.js', 'js/components/office-modal.js',
                   'js/components/product-modal.js', 'js/components/project-meta.js',
                   'js/components/social-links.js', 'js/components/auth-modal.js', 'auth-nav.js']) {
    const src = read(f);
    assert.match(src, /const SITE_ROOT = window\.location\.origin \+ '\/';/, `${f} SITE_ROOT tanımlamıyor`);
    assert.match(src, /new URL\(u, SITE_ROOT\)/, `${f}#safeUrl hâlâ eski tabanı kullanıyor`);
    assert.ok(!/new URL\(u, document\.baseURI\)/.test(src), `${f}#safeUrl hâlâ document.baseURI'ye çözüyor`);
  }
});

await test('(a) JSON-LD görsel/logo alanları da aynı tabana çözer', () => {
  assert.match(read('js/components/architect-modal.js'), /data\.image = new URL\(a\.photo, SITE_ROOT\)\.href/);
  assert.match(read('js/components/office-modal.js'), /data\.logo = new URL\(logo, SITE_ROOT\)\.href/);
  assert.match(read('js/components/product-modal.js'), /new URL\(img, SITE_ROOT\)\.href/);
  assert.match(read('js/components/project-meta.js'), /new URL\(img, SITE_ROOT\)\.href/);
});

await test('(a) FİRMA tarafı: lightbox ham göreli değeri site köküne göre çözer', () => {
  assert.match(lightbox, /function siteUrl\(u\) \{/);
  assert.match(lightbox, /imgEl\.src = it\.src \? siteUrl\(it\.src\) : '';/);
  // Kök neden: office-modal data-lightbox-src'ye HAM (göreli olabilen) logoyu yazıyor.
  assert.match(officeModal, /setAttribute\('data-lightbox-src', officeLogoUrl\)/);
});

await test('(b) kendi onerror\'u olan <img> genel yedeğin DIŞINDA (avatarda "—" kutusu yok)', () => {
  assert.match(brokenFallback, /function hasOwnErrorHandler\(img\) \{/);
  assert.match(brokenFallback, /typeof img\.onerror === 'function' \|\| img\.dataset\.mlFallback === 'off'/);
  // İki giriş noktası da (canlı `error` olayı ve geç tarama) aynı kapıdan geçmeli.
  const handle = brokenFallback.slice(brokenFallback.indexOf('function handle(e) {'));
  assert.match(handle.slice(0, 400), /if \(hasOwnErrorHandler\(img\)\)/, 'error dinleyicisi kapıyı atlıyor');
  const verify = brokenFallback.slice(brokenFallback.indexOf('function verifyThenFallback(img) {'));
  assert.match(verify.slice(0, 400), /if \(hasOwnErrorHandler\(img\)\)/, 'sweep kapıyı atlıyor');
});

await test('(b) pop-up başlık görselleri kendi yedeklerini taşımaya devam ediyor', () => {
  // Yedek kalkarsa kırık görselde tarayıcının kendi kırık ikonu kalırdı.
  assert.equal(read('js/components/architect-modal.js').split('img.onerror = () => img.remove();').length - 1, 2,
    'kişi pop-up\'ında iki fotoğraf dalı da (normal + blurlu) yedeğini taşımalı');
  assert.match(officeModal, /img\.onerror = \(\) => img\.remove\(\);/);
});

// ------------------------------------------------------------------------------------------
console.log('\nmadde 8 — "İz Bırakan" rozetli firma: İş/Staj ve sahiplenme kutusu yok');

await test('İş/Staj kutusu rozet beklenerek gizlenir (kutu bir an görünüp kaybolmaz)', () => {
  assert.match(officeModal, /async function hasIzBirakanBadge\(o\) \{/);
  assert.match(officeModal, /badges\.includes\('iz-birakan'\)/);
  const fn = officeModal.slice(officeModal.indexOf('async function renderJobs(o) {'));
  const body = fn.slice(0, fn.indexOf('\n  function paintJobs'));
  assert.match(body, /card\.style\.display = 'none';/, 'kutu önce gizlenmiyor — rozet beklenirken görünürdü');
  assert.match(body, /if \(await hasIzBirakanBadge\(o\)\) return;/);
  // Rozet YOKSA kutu geri açılmalı.
  assert.match(body, /card\.style\.display = '';/);
  // Rozet asenkron gelir; beklenmezse ilk çizimde kutu yanlış kararla açılırdı.
  assert.match(officeModal, /if \(typeof badgesReadyPromise !== 'undefined'\) await badgesReadyPromise;/);
});

await test('"Bu firma sana mı ait?" yalnızca İz Bırakan rozetiyle kapanır (diğer rozetler değil)', () => {
  assert.match(claimBox, /async function hasIzBirakanBadge\(profileKey\)\{/);
  assert.match(claimBox, /\(await activeBadgesOf\(profileKey\)\)\.includes\('iz-birakan'\)/);
  assert.match(claimBox, /const badged = config\.profileType === 'architect'\s*\n\s*\? await hasActiveBadge\(profileKey\)\s*\n\s*: await hasIzBirakanBadge\(profileKey\);/);
});

await test('rozet sahibi/yetkilisi kutuyu kaybetmez (Düzenle/Sil hâlâ orada)', () => {
  // Kutu yalnızca "profil sahibi DEĞİLSE" gizlenir — sahibinin içerik aksiyonları bu kutuda yaşıyor.
  assert.match(claimBox, /if\(!isProfileOwner && badged\) card\.style\.display = 'none';/);
});

// ------------------------------------------------------------------------------------------
// İKİNCİ TUR — Hesabım > "Yetkili Kullanıcılar" çipleri
//
// (1) Çip ad soyad DEĞİL @kullanıcı adı yazar ve görev etiketi ("(Yönetici)") kalktı.
//     Kullanıcı adı hesabın TEKİL tanıtıcısıdır (iki hesap aynı ad soyadı taşıyabilir), yani
//     çip artık hangi hesabın yetkili olduğunu belirsizliğe yer bırakmadan gösterir.
// (2) KUTU DIŞINA TAŞMA. Kök neden `.profile-fact`in flex öğelerinin min-width'i: varsayılan
//     `auto` (= max-content) olduğundan değer sütunu içeriğinden dar OLAMIYOR ve satır kartın
//     dışına taşıyordu — .am-mgr-wrap'ın flex-wrap'ı devreye bile giremiyordu, çünkü sarılacak
//     genişliği belirleyen kapsayıcı zaten içeriğe göre büyümüştü.
const authModal = read('js/components/auth-modal.js');
const hesabimHtml = read('hesabim.html');

console.log('\nikinci tur — Yetkili Kullanıcılar: kullanıcı adı + taşma');

await test('çip @kullanıcı adı yazar; görev etiketi ve sınıfı tamamen kalktı', () => {
  assert.match(authModal, /const shown = m\.username \? '@' \+ m\.username : m\.name;/,
    'çip hâlâ ad soyad yazıyor (ya da kullanıcı adsız hesapta yedeği yok)');
  assert.match(authModal, /<span class="am-mgr-chip-name">\$\{escapeHtml\(shown\)\}<\/span>/);
  // Etiket VE onu biçimlendiren kural birlikte gitmeli — kalan kural ölü ağırlık olurdu.
  assert.ok(!authModal.includes('am-mgr-chip-role'), 'görev etiketi/sınıfı hâlâ duruyor');
  assert.ok(!/\$\{escapeHtml\(m\.position\)\}/.test(authModal), 'çip hâlâ görevi basıyor');
});

await test('X\'in silme anahtarı AD SOYAD olarak kaldı (uç onunla eşleştiriyor)', () => {
  // Gösterilen değer değişti, silme anahtarı DEĞİŞMEDİ: DELETE ?name=<ad soyad>.
  assert.match(authModal, /data-mgr-name="\$\{escapeAttr\(m\.name\)\}"/);
  assert.match(read('src/routes/claims.js'), /async function revokeOfficeManager\(/);
  // Onay kutusu/sonuç metni ÇİPTE YAZANI söyler; ayrışsalardı kullanıcı çipte "@x" görüp
  // onay kutusunda başka bir ad okurdu.
  assert.match(authModal, /data-mgr-label="\$\{escapeAttr\(shown\)\}"/);
  assert.match(authModal, /const label = btn\.dataset\.mgrLabel \|\| name;/);
  assert.match(authModal, /confirm\(`\$\{label\} kullanıcısının bu firmadaki yönetim yetkisi/);
  assert.match(authModal, /setMsg\(`\$\{label\} artık bu firmanın içeriklerini yönetemez\.`/);
  // İstek hâlâ ADI gönderir.
  assert.match(authModal, /office-managers\?key=\$\{encodeURIComponent\(key\)\}&name=\$\{encodeURIComponent\(name\)\}/);
});

await test('sunucu kullanıcı adını döner, e-posta/kullanıcı id\'sini HÂLÂ döndürmez', () => {
  const claims = read('src/routes/claims.js');
  assert.match(claims, /name: m\.name, username: m\.username, position: m\.position, source: m\.source/);
  assert.ok(!/email: m\./.test(claims) && !/userId: m\.userId/.test(claims),
    'yanıt e-posta ya da kullanıcı id\'si taşıyor');
  // İki SELECT de kolonu çekmeli: biri atlanırsa o yoldan gelen yetkilinin çipi ada düşerdi.
  const lib = read('src/lib/claimedProfiles.js');
  const fn = lib.slice(lib.indexOf('export async function fetchOfficeManagers('));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.equal(body.split('u.username AS username').length - 1, 2, 'iki sorgudan biri username çekmiyor');
  assert.match(body, /username: r\.username \|\| null/);
});

await test('taşma kapatıldı: .profile-fact öğelerinde min-width:0 (İKİ yüzeyde de)', () => {
  for (const [label, src] of [['auth-modal.js', authModal], ['hesabim.html', hesabimHtml]]) {
    const labelRule = src.match(/\.profile-fact-label\{[^}]*\}/);
    const valueRule = src.match(/\.profile-fact-value\{[^}]*\}/);
    assert.ok(labelRule && valueRule, `${label}: .profile-fact kuralları bulunamadı`);
    assert.match(labelRule[0], /min-width:0/, `${label}: etiket sütunu 110px'in altına inemiyor`);
    assert.match(valueRule[0], /min-width:0/, `${label}: değer sütunu içeriğinden dar olamıyor`);
    assert.match(valueRule[0], /overflow-wrap:anywhere/, `${label}: uzun tek parça değer satırı taşırır`);
  }
});

await test('çipler kartın içinde sarar; tek uzun çip kutuyu genişletmez', () => {
  const wrap = authModal.match(/\.am-mgr-wrap\{[^}]*\}/)[0];
  assert.match(wrap, /flex-wrap:wrap/);
  assert.match(wrap, /max-width:100%/);
  assert.match(wrap, /min-width:0/);
  const chip = authModal.match(/\.am-mgr-chip\{[^}]*\}/)[0];
  assert.match(chip, /max-width:100%/, 'tek çip kutudan geniş olabilir');
  assert.match(chip, /min-width:0/);
  // Çipin metni kırpılır, X kırpılmaz.
  assert.match(authModal, /\.am-mgr-chip-name\{[^}]*text-overflow:ellipsis[^}]*\}/);
  assert.match(authModal.match(/\.am-mgr-x\{[^}]*\}/)[0], /flex-shrink:0/,
    'X büzülürse çipin içinde kaybolur');
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
process.exit(failed ? 1 : 0);
