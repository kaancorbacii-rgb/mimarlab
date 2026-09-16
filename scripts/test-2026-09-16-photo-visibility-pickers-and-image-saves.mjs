#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-16 (ALTINCI tur) — yedi madde, tek test dosyası.
//
// 1. "Fotoğraflarını Bul çalışıyor sorun yok ama böyle bir talep onaylanır ve fotoğrafçı künyeye
//    eklenirse kişi popupındaki 'Fotoğrafladığı Projeler' kısmında da proje gözüksün."
//    KÖK NEDEN ÖNBELLEKTİ, VERİ DEĞİL: kenar (project_photographers) onayda zaten kuruluyordu ve
//    pop-up o bölümü TAM OLARAK o tablodan okuyor — ama /api/architect/:slug fingerprint TAŞIMAZ,
//    s-maxage boyunca bayat liste servis ediliyordu (hotspotTags/photoClaims'teki AYNI tuzağın
//    KİŞİ tarafı; o tur yalnızca PROJE detayını purge etmişti).
// 2. Tarih/yıl kutuları listeden seçilir (proje: MÖ + 1..bugün, ürün: 1299..bugün), TEK seçim.
// 3. Admin'e özel "Yayın Tarihi" kutusu Gönder/Arşivle düğmelerinin ALTINA taşındı.
// 4. Üniversite kutusu çoklu seçim + elle yazma; architects.school virgüllü çoklu değer oldu.
// 5. urun-ekle'deki "Kullanılan Projeler" başlığı "Kullanıldığı Projeler".
// 6. Admin panelindeki "Yayındaki İçerikler" sekmesi kaldırıldı (sunucu uçları DURUYOR).
// 7. Proje/ürün lightbox'ında "Kaydet": GÖRSELİN KENDİSİ kaydedilir (saved_items item_type='image'),
//    hedef seçici (Kaydedilenler/Pano) aynı, Kaydettiklerim'de "Görsel" filtresi.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err.message}`); }
}
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

const photoClaims = read('src/routes/photoClaims.js');
const architectRoute = read('src/routes/architect.js');
const universities = read('src/lib/universities.js');
const consultationsRoute = read('src/routes/consultations.js');
const savedRoute = read('src/routes/saved.js');
const picker = read('office-picker.js');
const gallery = read('js/components/gallery.js');
const projectGallery = read('js/components/project-gallery.js');
const productModal = read('js/components/product-modal.js');
const architectModal = read('js/components/architect-modal.js');
const authModal = read('js/components/auth-modal.js');
const saveWidget = read('save-widget.js');
const projeEkle = read('proje-ekle.html');
const urunEkle = read('urun-ekle.html');
const kisiEkle = read('kisi-ekle.html');
const hesabim = read('hesabim.html');
const adminHtml = read('admin.html');
const danismanlik = read('danismanlik.html');

console.log('\nmadde 1 — onaylanan künye kişi pop-up\'ında görünür');

await test('onay KİŞİ detay önbelleğini de purge eder', () => {
  const fn = photoClaims.match(/async function applyPhotoClaim[\s\S]*?\n\}/)[0];
  assert.match(fn, /purgeSsrDetailCache\('project', project\.slug, env\)/, 'proje purge\'ü duruyor olmalı');
  assert.match(fn, /purgeSsrDetailCache\('architect', match\.row\.name, env\)/,
    'kişi detayı purge edilmezse "Fotoğrafladığı Projeler" bayat kalır (bildirilen hata)');
});

await test('purge anahtarı canonical AD (slugify edilen tip)', () => {
  const ssrCache = read('src/lib/ssrCache.js');
  assert.match(ssrCache, /const SLUGIFY_TYPES = new Set\(\['architect', 'office'\]\)/,
    'architect anahtarı ADDAN slugify edilir — slug/anahtar geçmek yanlış girdiyi silerdi');
  const fn = photoClaims.match(/async function applyPhotoClaim[\s\S]*?\n\}/)[0];
  assert.ok(!/purgeSsrDetailCache\('architect', name/.test(fn),
    'talepteki ad yeniden adlandırma sonrası ESKİ yazım olabilir; canonical satırın adı kullanılmalı');
});

await test('kenar artık "zaten künyede" dalında da kurulur', () => {
  const fn = photoClaims.match(/async function applyPhotoClaim[\s\S]*?\n\}/)[0];
  const idx = fn.indexOf('INSERT OR IGNORE INTO project_photographers');
  assert.ok(idx > 0);
  // INSERT'in üstündeki blok artık alreadyCredited koşulu TAŞIMAMALI (INSERT OR IGNORE zaten
  // fikirsiz; koşul, künyede adı yazan ama kenarı olmayan kaydı onarılamaz bırakıyordu).
  const before = fn.slice(0, idx);
  assert.ok(!/if \(!alreadyCredited\) \{[\s\S]*$/.test(before),
    'kenar kurulumu alreadyCredited koşuluna geri bağlanmış');
  assert.match(fn, /const match = await findOneByName\(env, 'architects', name\);/);
});

await test('pop-up bölümü HÂLÂ project_photographers\'tan okunur (tek gerçek)', () => {
  assert.match(architectRoute, /FROM project_photographers pp JOIN projects p ON p\.id = pp\.project_id/,
    'bölüm başka bir kaynaktan okunmaya başlarsa onay yolu sessizce kopar');
});

console.log('\nmadde 2 — tarih/yıl kutuları listeden');

await test('createYearPicker: TEK seçim, statik liste, elle yazma açık', () => {
  const fn = picker.match(/function createYearPicker[\s\S]*?\n  \}/)[0];
  assert.match(fn, /single: true/, '"2 kutucukta da sadece birer tane tarih seçilebilsin"');
  assert.match(fn, /items: yearOptionList\(o\.from \|\| 1, !!o\.bc\)/);
  assert.match(fn, /allowCustom: true/);
  // allowCustom BİR VERİ KORUMASIDIR: canlı künyelerde "MÖ 5500-3500", "19. yy" gibi değerler var.
  assert.match(picker, /parseProjectDateYear/, 'gerekçe yorumda kaynağıyla birlikte durmalı');
});

await test('liste 1..bugün kapsar, MÖ seçeneği vardır (proje)', () => {
  // SIRA bu turda ARTAN'dı; 2026-09-16 SEKİZİNCİ turda kullanıcı isteğiyle AZALAN'a çevrildi
  // ("açılan tarihler günümüzden geçmişe doğru olsun") ve MÖ listenin SONUNA taşındı. Sıranın
  // kelepçesi artık orada: scripts/test-2026-09-16-team-badges-lightbox-icons-and-account-speed.mjs.
  // Burada KAPSAM ve üst sınırın sabit olmaması ölçülmeye devam ediyor.
  const fn = picker.match(/function yearOptionList[\s\S]*?\n  \}/)[0];
  assert.match(fn, /const now = new Date\(\)\.getFullYear\(\)/, 'üst sınır SABİT olmamalı');
  assert.match(fn, /if \(bc\) out\.push\(YEAR_BC_OPTION\);/);
  assert.match(fn, /y >= from/, 'alt sınır from olmalı');
  assert.match(picker, /const YEAR_BC_OPTION = 'MÖ'/);
});

await test('proje-ekle: iki tarih kutusu da yıl seçici, gizli input sözleşmesi korunur', () => {
  assert.match(projeEkle, /<input type="hidden" class="p-date-start"/);
  assert.match(projeEkle, /<input type="hidden" class="p-date-end"/);
  assert.match(projeEkle, /createYearPicker\(container\.querySelector\('\.p-date-start-picker'\), \{[\s\S]*?from: 1, bc: true/);
  assert.match(projeEkle, /createYearPicker\(container\.querySelector\('\.p-date-end-picker'\), \{[\s\S]*?from: 1, bc: true/);
  // pendingDate'i besleyen dinleyiciler DEĞİŞMEDİ — kutu her yazmada 'input' olayı yayar.
  assert.match(projeEkle, /container\.querySelector\('\.p-date-start'\)\.addEventListener\('input'/);
  assert.match(projeEkle, /container\.querySelector\('\.p-date-end'\)\.addEventListener\('input'/);
  assert.ok(!/class="p-date-start" placeholder/.test(projeEkle), 'eski metin kutusu kalmış');
});

await test('urun-ekle: yıl kutusu 1299\'dan başlar, MÖ YOK', () => {
  assert.match(urunEkle, /<input type="hidden" id="u-year" name="year">/);
  const call = urunEkle.match(/yearPicker = createYearPicker\([\s\S]*?\}\);/)[0];
  assert.match(call, /from: 1299/);
  assert.ok(!/bc:/.test(call), 'ürün yılında MÖ seçeneği istenmedi');
});

await test('#u-year\'a yazan HER nokta kutuyu senkronlar', () => {
  const writes = urunEkle.split('\n').filter(l => /getElementById\('u-year'\)\.value =/.test(l));
  assert.ok(writes.length >= 2, `beklenen en az 2 yazma noktası, bulunan ${writes.length}`);
  const lines = urunEkle.split('\n');
  lines.forEach((l, i) => {
    if (!/getElementById\('u-year'\)\.value =/.test(l)) return;
    assert.match(lines[i + 1] || '', /yearPicker\.syncFromInput\(\)/,
      `yazma noktası senkronsuz kalmış (satır ${i + 1}) — çipler ile gönderilen değer ayrışır`);
  });
});

await test('liste panel AÇILMADAN DOM\'a basılmaz (ölçülen maliyet)', () => {
  // Yıl kutusunda 2027 seçenek = ~4000 eleman, proje-ekle'de İKİ kutu var. Ölçüldü: liste
  // erken basıldığında renderDateRows() 46 ms sürüyor ve sayfaya ~8000 gereksiz düğüm ekleniyor.
  assert.match(picker, /let listOpened = false;/);
  assert.match(picker, /function renderList\(\) \{\s*\n\s*if \(!listOpened\) return;\s*\n\s*renderListNow\(\);/);
  assert.match(picker, /listOpened = true;\s*\n\s*renderListNow\(\);/, 'panel açılışında liste basılmalı');
});

console.log('\nmadde 3 — Yayın Tarihi kutusu en altta');

await test('#p-publish-date-row Gönder/Arşivle düğmelerinin ALTINDA', () => {
  const submit = projeEkle.indexOf('<button class="form-submit" type="submit">Projeyi Gönder</button>');
  const danger = projeEkle.indexOf('id="p-danger-row"');
  const row = projeEkle.indexOf('id="p-publish-date-row"');
  assert.ok(submit > 0 && danger > 0 && row > 0);
  assert.ok(row > submit, 'kutu hâlâ "Projeyi Gönder"in üstünde');
  assert.ok(row > danger, 'kutu hâlâ Arşivle/Sil satırının üstünde');
});

await test('kutu <form>\'un İÇİNDE kalır ve görünürlük kapısı değişmedi', () => {
  const formEnd = projeEkle.indexOf('</form>');
  assert.ok(projeEkle.indexOf('id="p-publish-date-row"') < formEnd, 'input form dışına çıkmış');
  assert.match(projeEkle, /currentUserRole === 'admin'\) document\.getElementById\('p-publish-date-row'\)\.style\.display = ''/);
  assert.match(projeEkle, /<input type="date" id="p-publish-date" name="publishDate">/);
});

console.log('\nmadde 4 — Üniversite çoklu seçim');

await test('kutu İKİ yüzeyde de aynı bileşen', () => {
  assert.match(kisiEkle, /createSchoolPicker\(document\.getElementById\('m-school-picker'\)/);
  assert.match(authModal, /createSchoolPicker\(mount, \{ input: document\.getElementById\('am-edit-school'\) \}\)/);
  const fn = picker.match(/function createSchoolPicker[\s\S]*?\n  \}/)[0];
  assert.match(fn, /optionsUrl: SCHOOL_OPTIONS_URL/);
  assert.match(fn, /allowCustom: true/, '"listeye kendi de manuel olarak bir üniversite yazabilsin"');
  assert.ok(!/single/.test(fn), '"kişi isterse birden fazla seçebilsin" — tek seçim olmamalı');
  assert.match(picker, /const SCHOOL_OPTIONS_URL = '\/api\/architects\/schools'/,
    'ikinci bir liste kaynağı açılmamalı; uç sitedeki dört kutunun ZATEN ortak kaynağı');
});

await test('gizli input sözleşmesi: yazan her nokta senkronlar', () => {
  assert.match(kisiEkle, /<input type="hidden" id="m-school" name="school">/);
  assert.match(authModal, /<input type="hidden" id="am-edit-school">/);
  const lines = kisiEkle.split('\n');
  let writes = 0;
  lines.forEach((l, i) => {
    if (!/getElementById\('m-school'\)\.value =/.test(l)) return;
    writes++;
    assert.match(lines[i + 1] || '', /schoolPicker\.syncFromInput\(\)/, `satır ${i + 1} senkronsuz`);
  });
  assert.ok(writes >= 2, `kisi-ekle'de beklenen en az 2 yazma noktası, bulunan ${writes}`);
  assert.match(authModal, /getElementById\('am-edit-school'\)\.value = \(rec && rec\.school\) \|\| '';\s*\n(\s*\/\/.*\n)*\s*if \(schoolPicker\) schoolPicker\.syncFromInput\(\);/);
});

await test('sunucu: school ÇOKLU okunur (pool + filtre + sayaç + uç)', () => {
  assert.match(universities, /export function schoolNameList\(raw\)/);
  assert.match(universities, /canonicalSchoolName\(part\)/, 'her parça kanonikleştirilmeli');
  assert.match(architectRoute, /schools: schoolNameList\(a\.school\)/, 'havuz artık dizi taşır');
  assert.match(architectRoute, /!schoolParams\.some\(sc => schoolListOf\(a\)\.includes\(sc\)\)/, 'grup içi OR');
  assert.match(architectRoute, /schoolListOf\(a\)\.forEach\(sc => \{ schoolCounts\[sc\] =/, 'her okul ayrı sayılmalı');
  const ep = architectRoute.match(/export async function handleArchitectSchoolsRoute[\s\S]*?\n\}/)[0];
  assert.match(ep, /for \(const name of schoolNameList\(row\.school\)\)/,
    'kolon bölünmezse "A, B" listeye TEK uydurma seçenek olarak girer');
});

await test('ESKİ KV havuzu korunur (deploy penceresi)', () => {
  const fn = architectRoute.match(/function schoolListOf[\s\S]*?\n\}/)[0];
  assert.match(fn, /if \(Array\.isArray\(a\.schools\)\) return a\.schools;/);
  assert.match(fn, /canonicalSchoolName\(a\.school\)/,
    'havuz KV\'de 30 dk yaşıyor: eski şekil (tek değerli `school`) de okunmalı');
});

await test('kişi pop-up künyesi her okulu AYRI filtre bağlantısı yapar', () => {
  assert.match(architectModal, /const schools = String\(a\.school \|\| ''\)\.split\(','\)\.map\(v => v\.trim\(\)\)\.filter\(Boolean\)/);
  assert.match(architectModal, /schools\.map\(v => kisiFilterLink\('school', v\)\)\.join\(', '\)/);
  // profession ile AYNI desen — o satır da virgüllü tek metni parçalayıp bağlantılıyor.
  assert.match(architectModal, /profession\.split\(','\)[\s\S]*?kisiFilterLink\('profession', p\)/);
});

await test('doğrulama her PARÇA için ayrı çalışır', () => {
  assert.match(kisiEkle, /splitSchoolNames\(document\.getElementById\('m-school'\)\.value\)\.some\(isInvalidSchoolValue\)/);
  assert.match(authModal, /school\.split\(','\)\.map\(v => v\.trim\(\)\)\.filter\(Boolean\)\.some\(isInvalidSchoolValue\)/);
});

await test('/danismanlik filtresi de diziyi okur', () => {
  assert.match(consultationsRoute, /schools: schoolNameList\(a\.school\)/);
  assert.match(danismanlik, /if\(key === 'school'\) return item\.schools \|\| \[\];/);
});

await test('ölü otomatik tamamlama kodu düştü', () => {
  assert.ok(!/function wireAutocomplete\(/.test(kisiEkle), 'çağrısız wireAutocomplete kalmış');
  assert.ok(!/class="ac-suggestions"/.test(kisiEkle));
  // DİKKAT: düz ad araması kendi AÇIKLAMA YORUMUMA takılır (bu tuzağa dördüncü turda da
  // düşüldü) — IIFE'nin TANIMI aranır.
  assert.ok(!/\(function wireAmEditSchoolAutocomplete\(\)/.test(authModal));
  assert.ok(!/id="am-edit-school-suggestions"/.test(authModal));
  assert.ok(!/#am-panel \.ac-suggestions\{/.test(authModal), 'ölü .ac-* CSS kalmış');
});

console.log('\nmadde 5 — başlık');

await test('urun-ekle başlığı "Kullanıldığı Projeler"', () => {
  assert.match(urunEkle, /<h2>Kullanıldığı Projeler <span class="opt">\(opsiyonel\)<\/span><\/h2>/);
  // ÜRÜN SAYFASININ bölüm adı DEĞİŞMEDİ (istek yalnızca formu sayıyor).
  const pm = read('js/components/product-modal.js');
  assert.match(pm, /id="pr-projects-title">Kullanılan Projeler/);
});

console.log('\nmadde 6 — admin "Yayındaki İçerikler" kaldırıldı');

await test('sekme, bölüm ve JS tamamen gitti', () => {
  assert.ok(!/data-tab="content"/.test(adminHtml));
  assert.ok(!/id="section-content"/.test(adminHtml));
  assert.ok(!/function loadContent\(/.test(adminHtml));
  assert.ok(!/toggleContentEditForm/.test(adminHtml.replace(/<!--[\s\S]*?-->/g, '')));
  assert.ok(!/CONTENT_EDITABLE_FIELDS\s*=/.test(adminHtml));
  assert.ok(!/id="content-list"/.test(adminHtml));
});

await test('SUNUCU UÇLARI DURUYOR (kaldırılan tek şey ekran)', () => {
  const adminRoute = read('src/routes/admin.js');
  assert.match(adminRoute, /handleSubmissionsAdmin/);
  // Arşiv ve Bekleyen Gönderiler sekmeleri aynı uçları kullanmaya devam ediyor.
  assert.match(adminHtml, /\/api\/admin\/submissions/);
  assert.match(adminHtml, /function loadArchive\(/);
  assert.match(adminHtml, /function loadPending\(/);
});

await test('"Öne Çıkar" yeteneği kaybolmadı (Ana Sayfa sekmesi)', () => {
  assert.ok(!/function toggleFeaturedProject\(/.test(adminHtml), 'yalnızca o kartta kullanılıyordu');
  assert.match(adminHtml, /settingKey: 'featured_project_slugs'/,
    'ayarın gerçek arayüzü Ana Sayfa sekmesindeki karusel seçicisi');
});

console.log('\nmadde 7 — lightbox\'ta "Kaydet" (görsel kaydetme)');

await test('saved_items yeni tip: image', () => {
  assert.match(savedRoute, /export const ITEM_TYPES = new Set\(\['project', 'product', 'material', 'architect', 'office', 'gundem', 'image'\]\)/,
    'mevcut tiplerin hiçbiri düşmemeli');
  assert.match(savedRoute, /if \(r\.item_type === 'image'\) return \{ live: true, buildStatus: null \};/);
  // Panolar AYNI Set'i içe aktarıyor, yani "Panolarıma kaydet" yolu kendiliğinden çalışır.
  assert.match(read('src/routes/collections.js'), /import \{ ITEM_TYPES \} from '\.\/saved\.js'/);
});

await test('buton sağ üstteki İKİ butonla AYNI kutuda, onların SOLUNDA', () => {
  const rule = gallery.match(/\.lightbox \.lightbox-save-btn\{[\s\S]*?\}/)[0];
  assert.match(rule, /position:absolute; top:24px; right:124px/);
  assert.match(rule, /width:38px; height:31px/,
    'ikon-only bir düğme 20px kalır ve merkezi kayardı (beşinci turda ölçülen aynı tuzak)');
  const projectCss = read('css/project-detail.css');
  assert.match(projectCss, /\.lightbox-close\{position:absolute; top:24px; right:32px;/);
  assert.match(projectCss, /\.lightbox-grid-toggle\{[\s\S]*?right:78px;/);
  // 32 -> 78 -> 124: üç yuva, 38px genişlik + 8px aralık.
  assert.match(gallery, /\.lightbox\.grid-mode \.lightbox-save-btn\{display:none;\}/,
    'ızgara modunda tekli görsel yok, buton da olmamalı');
});

await test('buton `.card-save-btn` SINIFINI TAŞIMAZ', () => {
  const block = gallery.match(/lightboxSaveBtn\.className = '[^']*'/)[0];
  assert.equal(block, "lightboxSaveBtn.className = 'lightbox-save-btn'");
  // Gerekçe: o sınıfın sayfa CSS'lerindeki KART kuralları (position:absolute; top:10px; right:10px)
  // lightbox'ta yanlış yere oturtur. Bu yüzden save-widget tek-buton bir API sunar.
  assert.match(saveWidget, /function wireSaveButton\(btn, type\)\{/);
  assert.match(saveWidget, /document\.querySelectorAll\('\.card-save-btn'\)\.forEach\(btn=> wireSaveButton\(btn, type\)\)/);
});

await test('kaydetme/pano sonrası lightbox butonu da yeniden boyanır', () => {
  assert.match(saveWidget, /function repaintAllSaveBtns\(\)\{\s*\n\s*document\.querySelectorAll\('\.card-save-btn, \.lightbox-save-btn'\)\.forEach\(paintSaveBtn\);/);
  const toggle = saveWidget.match(/async function toggleSavedItem[\s\S]*?\n\}/)[0];
  assert.match(toggle, /repaintAllSaveBtns\(\)/);
  const add = saveWidget.match(/async function addToCollection[\s\S]*?\n\}/)[0];
  assert.match(add, /repaintAllSaveBtns\(\)/);
});

await test('ANAHTAR GÖRSELİN URL\'Sİ (indeks değil) ve her karede tazelenir', () => {
  const fn = gallery.match(/function paintSaveBtnForImage[\s\S]*?\n  \}/)[0];
  assert.match(fn, /btn\.dataset\.key = url;/);
  assert.match(fn, /btn\.dataset\.image = url;/);
  assert.match(fn, /btn\.dataset\.type = 'image';/);
  assert.match(fn, /wireSaveButton\(btn\)/, 'yeniden boyama + tek seferlik dinleyici');
  // showLightboxImage HER karede çağırır — aksi halde buton 1. karenin anahtarında kalırdı.
  assert.match(gallery, /paintCredit\(img\);\s*\n\s*paintSaveBtnForImage\(img\);/);
});

await test('hedef seçici (Kaydedilenler/Pano) AYNI akış', () => {
  assert.match(gallery, /lightboxSaveBtn\.dataset\.saveChooser = '1';/);
  assert.match(saveWidget, /if\(btn\.dataset\.saveChooser\)\{ openSaveChooser\(btn\); return; \}/);
});

await test('save-widget yoksa buton GİZLENİR (işlevsiz düğme kalmaz)', () => {
  const fn = gallery.match(/function paintSaveBtnForImage[\s\S]*?\n  \}/)[0];
  assert.match(fn, /typeof wireSaveButton !== 'function'\)\{ btn\.style\.display = 'none'; return; \}/);
});

await test('kilitli (önizleme) galeride buton yok', () => {
  assert.match(gallery, /lightboxSaveBtn\.style\.display = \(saveTarget && !locked\) \? '' : 'none';/);
});

await test('İKİ galeri de saveTarget geçirir (proje + ürün)', () => {
  assert.match(projectGallery, /saveTarget: item\.slug \? \{ title: item\.title \|\| '', meta: item\.location \|\| '', href: `\/proje\/\$\{encodeURIComponent\(item\.slug\)\}` \} : null/);
  assert.match(productModal, /saveTarget: currentKey \? \{ title: p\.title \|\| '',[\s\S]*?href: `\/urun\/\$\{encodeURIComponent\(currentKey\)\}` \} : null/);
  // currentKey modül düzeyinde tutulur: renderDetailBody `key` argümanı ALMIYOR (varyant
  // değişiminde de aynı gövde çiziliyor).
  assert.match(productModal, /let currentKey = null;/);
  assert.match(productModal, /currentItem = p;\s*\n\s*currentKey = key;/);
});

await test('Kaydettiklerim: "Görsel" filtresi İKİ yüzeyde de', () => {
  assert.match(authModal, /<button type="button" class="saved-filter-btn" data-filter="image">Görsel<\/button>/);
  assert.match(hesabim, /<button type="button" class="saved-filter-btn" data-filter="image">Görsel<\/button>/);
  assert.match(authModal, /image: 'Görsel' \}/);
  assert.match(hesabim, /image: 'Görsel' \}/);
  // Filtre mantığı DEĞİŞMEDİ (tip adı doğrudan eşleşiyor) — Gündem'deki AYNI desen.
  assert.match(authModal, /function colMatchesCatalogFilter\(itemType, filter\) \{/);
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
process.exit(failed ? 1 : 0);
