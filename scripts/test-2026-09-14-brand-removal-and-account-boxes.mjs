#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-14 (üçüncü tur) — BİRİM TESTLERİ
//
// Bu turun kalıcı sözleşmeleri, sessizce geri sızabilecek olanlar:
//   madde 1 — proje-ekle: "Projede Kullanılan Ürünler" başlığı, "Ürün firması seç" / "Önce firma
//             seç" etiketleri ve KALDIRILAN "Seçilen markaların ürünlerini seç" paneli.
//   madde 3 — firma-ekle Hizmet Alanı listesinde 'Üretim ve Satış' 4. SIRADA.
//   madde 4 — marka kavramı YOK: /marka + /marka-ekle 301 ile firma tarafına, her ofis kaydı
//             /firma/:slug, firma-ekle'de "Üretim ve Satış" seçilince Ürün Kategorisi kutusu.
//   madde 8 — Hesabım'daki Firma/Kişi kutuları yalnızca gerçek bir bağ varsa görünür; firma
//             yöneticisine kutunun içinde firmanın kişileri sayfa sayfa gelir.
//
// Taksonomi ve URL kararları GERÇEKTEN çalıştırılarak sınanır (office-kind.js / officeUrl.js
// import edilir). İstemci tarafı (HTML + klasik <script> dosyaları) için kaynak-seviyeli kapılar
// kullanılır — bu depodaki diğer turların AYNI deseni (bkz. test-2026-09-12-home-bento.mjs).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import officeKindJs from '../office-kind.js';
import { officePath, officePathPrefix } from '../src/lib/officeUrl.js';

const { OFFICE_SERVICE_CATS, BRAND_CATS, PRODUCT_CATS, isBrandOffice, isPureBrandOffice } = officeKindJs;

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
const section = (t) => console.log(`\n${t}`);
const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

// -------------------------------------------------------------------------------------------
section('madde 3 — Hizmet Alanı listesinde "Üretim ve Satış" 4. sırada');

test('4. sıra tam olarak "Üretim ve Satış"', () => {
  assert.equal(OFFICE_SERVICE_CATS[3], 'Üretim ve Satış');
});
test('eski seçenekler KAYBOLMADI, yalnızca araya girdi', () => {
  for (const c of ['Mimarlık', 'İç Mimarlık', 'Peyzaj Mimarlığı', 'Kentsel Tasarım', 'Restorasyon',
    'Uygulama / İnşaat', 'Ürün Tasarımı', 'Fotoğrafçılık']) {
    assert.ok(OFFICE_SERVICE_CATS.includes(c), `${c} listeden düşmüş`);
  }
  assert.equal(new Set(OFFICE_SERVICE_CATS).size, OFFICE_SERVICE_CATS.length, 'listede tekrar var');
});
test('sunucu doğrulaması aynı listeyi kabul ediyor (submissionTypes whitelist)', () => {
  // OFFICE_CATS_ALLOWED = OFFICE_SERVICE_CATS ∪ BRAND_CATS ∪ LEGACY — yeni değer oradan da geçmeli,
  // aksi halde form gönderilir ama sunucu 400 verirdi.
  const src = read('src/lib/submissionTypes.js');
  assert.match(src, /OFFICE_CATS_ALLOWED = new Set\(\[\.\.\.OFFICE_SERVICE_CATS, \.\.\.BRAND_CATS, LEGACY_BRAND_CAT\]\)/);
});

// -------------------------------------------------------------------------------------------
section('madde 4 — marka kavramı kalkıyor: sınıflandırma ve kanonik URL');

test('isPureBrandOffice HER girdide false (ayrımın tek karar noktası kapatıldı)', () => {
  for (const [cats, n] of [['Ürün', 5], ['Mobilya', 0], [['Mobilya', 'Aydınlatma'], 40],
    ['Mimarlık · İç Mimarlık', 7], ['', 0], [null, 0]]) {
    assert.equal(isPureBrandOffice(cats, n), false, `saf marka sayıldı: ${JSON.stringify(cats)}`);
  }
});
test('isBrandOffice KORUNDU — "bu firma üretici mi" sorusu hâlâ yanıtlanıyor', () => {
  assert.equal(isBrandOffice('Mobilya', 0), true);
  assert.equal(isBrandOffice('Ürün', 0), true);
  assert.equal(isBrandOffice('Mimarlık', 0), false);
  assert.equal(isBrandOffice('Mimarlık', 3), true, 'kataloğunda ürünü olan ofis üreticidir');
});
test('kanonik URL HER kayıtta /firma/ — /marka/ hiç üretilmez', () => {
  assert.equal(officePathPrefix('Mobilya', 40), '/firma/');
  assert.equal(officePath('ersa', 'Mobilya', 40), '/firma/ersa');
  assert.equal(officePath('vitra', ['Ürün'], 12), '/firma/vitra');
  assert.equal(officePath('autoban', 'Mimarlık · İç Mimarlık', 7), '/firma/autoban');
});
test('PRODUCT_CATS = ürün kategorileri (BRAND_CATS ile aynı dizi, yeni ad)', () => {
  assert.deepEqual(PRODUCT_CATS, BRAND_CATS);
  assert.equal(PRODUCT_CATS.length, 8);
  // Ürün kategorileri hizmet alanı DEĞİLDİR — iki liste kesişmemeli, yoksa "Üretim ve Satış"
  // kutusunun açılma koşulu ile kutunun içeriği birbirine karışırdı.
  for (const c of PRODUCT_CATS) assert.ok(!OFFICE_SERVICE_CATS.includes(c), `${c} iki listede birden`);
});

// -------------------------------------------------------------------------------------------
section('madde 4 — sayfalar canlıdan kalktı, adresler 301 ile firma tarafına');

test('marka.html ve marka-ekle.html depoda YOK', () => {
  assert.ok(!existsSync(new URL('../marka.html', import.meta.url)), 'marka.html hâlâ duruyor');
  assert.ok(!existsSync(new URL('../marka-ekle.html', import.meta.url)), 'marka-ekle.html hâlâ duruyor');
});
test('dört tam-eşleşme adresi 301 tablosunda (404 DEĞİL — içerik taşındı, kaybolmadı)', () => {
  const src = read('src/index.js');
  for (const [from, to] of [['/marka', '/firma'], ['/marka.html', '/firma'],
    ['/marka-ekle', '/firma-ekle'], ['/marka-ekle.html', '/firma-ekle']]) {
    assert.ok(src.includes(`'${from}': '${to}'`), `${from} -> ${to} yönlendirmesi yok`);
  }
});
test('/marka/:slug önek yönlendirmesi var', () => {
  assert.match(read('src/index.js'), /\{ from: '\/marka\/', to: '\/firma\/' \}/);
});
test('/marka artık bir sayfa DEĞİL: rota, sitemap, hub ve liste tablolarından çıktı', () => {
  const src = read('src/index.js');
  assert.ok(!src.includes("{ prefix: '/marka/', asset: '/marka', type: 'office' }"), 'detay rotası duruyor');
  assert.ok(!src.includes("{ loc: '/marka'"), 'sitemap girdisi duruyor');
  assert.ok(!src.includes("'/marka': {"), 'hub/preload yapılandırması duruyor');
  assert.match(src, /const OFFICE_URL_PREFIXES = \['\/firma\/'\];/, 'ofis öneki listesi tek elemanlı olmalı');
  assert.match(src, /const LIST_PAGE_PATHS = new Set\(\[(?:(?!\/marka).)*\]\);/, 'LIST_PAGE_PATHS hâlâ /marka içeriyor');
  assert.match(src, /const PAGED_LIST_BASES = \['\/proje', '\/kisi', '\/firma', '\/urun'\];/);
});
test('hubLinks ve arama hızlı bağlantıları da /marka taşımıyor', () => {
  assert.ok(!read('src/lib/hubLinks.js').includes("'/marka'"), 'hubLinks hâlâ /marka tanımlıyor');
  const arama = read('arama.html');
  assert.ok(!arama.includes("href: '/marka'"), 'arama hızlı bağlantısı duruyor');
  assert.ok(!arama.includes("href: '/marka-ekle'"), 'arama Marka Ekle bağlantısı duruyor');
});
test('smoke-test kaldırılan adresleri deploy sonrası doğruluyor', () => {
  assert.match(read('scripts/smoke-test.sh'), /for gone in \/marka \/marka-ekle \/marka\/[a-z-]+; do/);
});
// GERÇEK BULGU (deploy #63, 2026-09-14): smoke test'in charset bölümü hâlâ /marka'yı HTML sayfası
// sanıp gezdiriyordu; adres artık 301 döndüğü için gövde ve Content-Type YOK ve kontrol "başlık
// yok" diye kırmızı verdi — deploy canlıya çıkmıştı ama iş başarısız sayıldı. Preflight bunu
// statik olarak yakalayamaz (smoke test canlıya HTTP atar), bu yüzden kapı burada: kaldırılan bir
// adres, sayfa DÖNDÜĞÜNÜ varsayan hiçbir smoke listesinde kalmamalı.
test('smoke-test\'in sayfa DÖNDÜĞÜNÜ varsayan listelerinde /marka YOK', () => {
  const smoke = read('scripts/smoke-test.sh');
  const charsetLoop = smoke.match(/^for p in \/ .*$/m);
  assert.ok(charsetLoop, 'charset döngüsü bulunamadı (biçim değişmiş olabilir)');
  assert.ok(!charsetLoop[0].includes('/marka'), `charset döngüsü hâlâ /marka içeriyor: ${charsetLoop[0]}`);
});

// -------------------------------------------------------------------------------------------
section('madde 4 — firma-ekle: "Üretim ve Satış" seçilince Ürün Kategorisi kutusu');

const firmaEkle = read('firma-ekle.html');

test('kutu VARSAYILAN GİZLİ (hidden) ve kendi dd bileşenine sahip', () => {
  assert.match(firmaEkle, /<div class="form-field" id="urunkat-field" hidden>/);
  assert.match(firmaEkle, /<div class="dd-field" id="dd-urunkat">/);
  assert.match(firmaEkle, /<span id="dd-urunkat-btn-label">Ürün kategorisi seç<\/span>/);
});
test('seçenekler office-kind.js#PRODUCT_CATS\'ten (ikinci bir liste kopyası YOK)', () => {
  assert.match(firmaEkle, /document\.getElementById\('dd-urunkat-options'\)\.innerHTML = PRODUCT_CATS\.map/);
  for (const c of PRODUCT_CATS) {
    assert.ok(!firmaEkle.includes(`value="${c}"`), `${c} sayfaya elle gömülmüş (liste ikiye ayrılmış)`);
  }
});
test('kutular AYNI name="cats" ile aynı kolona yazıyor (şema değişikliği yok)', () => {
  const m = firmaEkle.match(/dd-urunkat-options'\)\.innerHTML = PRODUCT_CATS\.map\([^\n]*/);
  assert.ok(m && m[0].includes('name="cats"'), 'ürün kategorileri cats alanına yazmıyor');
});
test('görünürlük YALNIZCA "Üretim ve Satış" seçimine bağlı', () => {
  assert.match(firmaEkle, /const URETIM_CAT = 'Üretim ve Satış';/);
  assert.match(firmaEkle, /function isUretimSelected\(\)\{[\s\S]*?cb\.value === URETIM_CAT/);
  assert.match(firmaEkle, /field\.hidden = !show;/);
});
test('hizmet alanı geri alınınca ürün kategorileri TEMİZLENİR (gizli veri sızmaz)', () => {
  assert.match(firmaEkle, /if\(!show\)\{\s*\n\s*urunKatBoxes\(\)\.forEach\(cb => \{ cb\.checked = false; \}\);/);
});
test('"Üretim ve Satış" seçiliyken en az bir ürün kategorisi ZORUNLU', () => {
  assert.match(firmaEkle, /if\(isUretimSelected\(\) && !cats\.some\(c => PRODUCT_CATS\.includes\(c\)\)\)\{/);
  // Hizmet alanı kontrolü de ürün kategorilerini hizmet sanmamalı.
  assert.match(firmaEkle, /if\(!cats\.some\(c => OFFICE_SERVICE_CATS\.includes\(c\)\)\)\{/);
});
test('kayıtlı bir firma açılırken kutu doğru durumla yükleniyor (iki prefill yolu da)', () => {
  const hits = firmaEkle.match(/syncUrunKatVisibility\(\); updateUrunKatLabel\(\);/g) || [];
  assert.equal(hits.length, 2, 'iki prefill yolundan biri kutuyu tazelemiyor');
});

// -------------------------------------------------------------------------------------------
section('madde 1 — proje-ekle: ürün dili ve kaldırılan panel');

const projeEkle = read('proje-ekle.html');

test('başlık ve iki menü etiketi istenen metinlerde', () => {
  assert.match(projeEkle, /<h2>Projede Kullanılan Ürünler /);
  assert.match(projeEkle, /<option value="">Ürün firması seç<\/option>/);
  assert.match(projeEkle, /<option value="">Önce firma seç<\/option>/);
  // JS tarafındaki kopyalar da aynı olmalı (menüyü fetch sonrası o dolduruyor).
  assert.match(projeEkle, /optionHtml\('', 'Ürün firması seç'\)/);
  assert.match(projeEkle, /optionHtml\('', 'Önce firma seç'\)/);
});
test('"Seçilen markaların ürünlerini seç" paneli TAMAMEN kaldırıldı', () => {
  for (const needle of ['dd-urun-btn', 'dd-urun-options', 'dd-urun-search', 'renderProductPanel(',
    'candidateProductBrands(', 'updateUrunLabel(']) {
    assert.ok(!projeEkle.includes(needle), `panel kalıntısı: ${needle}`);
  }
});
test('firma -> ürün menüsü ÇALIŞMAYA DEVAM ediyor (panel ile birlikte silinmedi)', () => {
  assert.match(projeEkle, /async function loadProductsForBrand\(brand\)\{/);
  assert.match(projeEkle, /function syncProductField\(\)\{/);
});

// -------------------------------------------------------------------------------------------
section('madde 8 — Hesabım: kutular yalnızca bir bağ varsa, kişi kutusu sayfalanıyor');

const authModal = read('js/components/auth-modal.js');

test('iki kutu da VARSAYILAN GİZLİ (hidden) işaretlemede', () => {
  assert.match(authModal, /<div class="dash-section" id="am-firm-section" hidden>/);
  assert.match(authModal, /<div class="dash-section" id="am-person-section" hidden>/);
});
test('firma kutusu firmEntries boşken gizli kalıyor', () => {
  assert.match(authModal, /const section = document\.getElementById\('am-firm-section'\);\s*\n\s*if \(section\) section\.hidden = !firmEntries\.length;/);
});
test('kişi kutusu personEntries boşken gizli kalıyor', () => {
  assert.match(authModal, /personEntries = buildPersonEntries\(\);\s*\n\s*if \(section\) section\.hidden = !personEntries\.length;/);
});
test('kişi kutusunun 1. sayfası kendi künyesi, sonrakiler firmanın kişileri', () => {
  assert.match(authModal, /if \(amPersonRecord\) entries\.push\(\{ kind: 'self', record: amPersonRecord \}\);/);
  assert.match(authModal, /entries\.push\(\{ kind: 'firm', firm: entry\.key, record: p \}\);/);
  // Kurucular + Ekip birlikte: kurucu/kurucu ortak/ortak Kurucular'da, ekip lideri Ekip'te durur.
  assert.match(authModal, /\[\.\.\.\(people\.founders \|\| \[\]\), \.\.\.\(people\.team \|\| \[\]\)\]/);
});
test('yalnızca YETKİLİ olunan firmaların kişileri gelir (yetki kuralı tek kaynaktan)', () => {
  assert.match(authModal, /function canManageFirmEntry\(entry\) \{[\s\S]*?OFFICE_EDIT_POSITIONS\.has\(entry\.position\)[\s\S]*?entry\.founderCanEdit/);
  assert.match(authModal, /if \(!canManageFirmEntry\(entry\)\) continue;/);
});
test('kişiler /api/office/:key yanıtından gelir — ayrı bir uç ya da ek istek YOK', () => {
  assert.match(authModal, /firmPeopleCache\[key\] = d \? \{ founders: d\.founders \|\| \[\], team: d\.team \|\| \[\] \} : null;/);
  assert.match(authModal, /firmEntries\.filter\(canManageFirmEntry\)\.forEach\(e => ensureFirmOffice\(e\.key\)\);/);
});
test('sayfalama firma kutusuyla AYNI bileşen', () => {
  assert.match(authModal, /renderDashPagination\('am-person-pagination', personPage, personEntries\.length/);
  assert.match(authModal, /<div class="dash-pagination" id="am-person-pagination"><\/div>/);
});
// KURAL DEĞİŞTİ (kullanıcı isteği, 2026-09-15 üçüncü tur madde 2): bu turda düğme YALNIZCA kendi
// künyesinde görünüyordu ("firmanın kişisi başka birinin profilidir, bu kutu onu GÖRÜNTÜLEMEK
// için"). Kullanıcı bunu açıkça kaldırdı: "admin panelinden bir firmaya bir kullanıcıyı yönetici
// olarak atadığı zaman ... diğer kişi sayfalarında da profili düzenle butonu görünsün. Yönetici bu
// butona tıklayarak firmadaki tüm kişilerin popuplarını düzenleyebilsin." Bu testin eski hâli o
// isteği engellerdi; yerine İKİ dalın da doğru davrandığı sabitlenir. Ayrıntılı sözleşme:
// scripts/test-2026-09-15-account-title-and-firm-person-edit.mjs.
test('düğme her sayfada "Bilgileri Düzenle", hedefi sayfaya göre değişir', () => {
  // Etiket tek yerde (kullanıcı isteği, 2026-09-15 dördüncü tur); dallar yalnızca HEDEF ve
  // görünürlük belirler.
  assert.match(authModal, /if \(editBtn\) editBtn\.textContent = 'Bilgileri Düzenle';/);
  // Firma kişisinde hedef, firma pop-up'ındaki Düzenle ile AYNI yol (kisi-ekle?claim=<slug>).
  assert.match(authModal, /editBtn\.href = `\$\{CLAIM_EDIT_PAGE\.architect\}\?claim=\$\{encodeURIComponent\(personSlug\)\}`/);
  // Sitede kaydı olmayan ad (slug yok) düzenlenemez -> düğme gizli.
  assert.match(authModal, /editBtn\.style\.display = personSlug \? '' : 'none';/);
});
test('"Marka" sekmeleri/etiketleri Hesabım\'dan kalktı', () => {
  for (const needle of ['data-filter="brand">Marka<', 'data-filter="brands">Marka<',
    "brand: 'Marka'", "item.isBrand ? 'Marka' : 'Firma'"]) {
    assert.ok(!authModal.includes(needle), `marka kalıntısı: ${needle}`);
  }
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) {
  for (const f of failures) console.error(`  - ${f.name}: ${f.message}`);
  process.exit(1);
}
