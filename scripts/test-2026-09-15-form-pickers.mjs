#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-15 (yedinci tur) — dört madde, hepsi AYNI bileşene dayanıyor
// (office-picker.js): "siteye yüklü kayıtlardan çoklu seçim + listede yoksa elle yazma".
//
//  1. firma-ekle: "kurucular / ortaklar ve ekip kutucukları, proje sayfasındaki mimar seçimi gibi
//     çoktan seçmeli olsun ... manuel olarak yazılıp da eklenebilsin. Ayrıca masaüstü ve tablet
//     görünümünde ... aynı satırda yan yana 2 sütun şeklinde olsunlar."
//  2. urun-ekle: "firma ve tasarımcı seçimi çoklu seçim şeklinde sitede yüklü olan firmalar ya da
//     kişilerden olsun. Ya da manuel olarak da isimler girilebilsin."
//  3. kisi-ekle: "firma seç kısmında manuel olarak farklı bir firma ismi de yazılabilsin."
//  4. proje-ekle: Kaynak ipucundaki agregatör cümlesi silinsin + "fotoğrafçı seçimi de çoktan
//     seçmeli ... kişi listesinden ya da manuel ... burada firmalardan da seçim olabilsin ...
//     hepsi aynı listenin içinde olsun ayrı bir kutucuk olarak ayırma."
//
// ORTAK SÖZLEŞME — bu dosyanın asıl kilitlediği şey: her kutu, yerini aldığı görünür metin
// kutusunun kimliğini bir type="hidden" input olarak KORUR ve o input'a yazan HER nokta kutuyu
// senkronlar. Sözleşme bozulursa kullanıcının gördüğü çipler ile gönderilen değer sessizce ayrışır.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
function section(title) { console.log(`\n${title}`); }
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

const picker = read('office-picker.js');
const firmaEkle = read('firma-ekle.html');
const urunEkle = read('urun-ekle.html');
const kisiEkle = read('kisi-ekle.html');
const projeEkle = read('proje-ekle.html');
const authModal = read('js/components/auth-modal.js');

// Bir gizli input'a yazan HER `.value =` noktasının ardından senkron çağrısı var mı?
function assertEverySyncCall(src, inputId, syncFn, minWrites) {
  const writes = [...src.matchAll(new RegExp(`getElementById\\('${inputId}'\\)\\.value\\s*=`, 'g'))];
  assert.ok(writes.length >= minWrites, `#${inputId}: beklenenden az yazma noktası (${writes.length})`);
  for (const m of writes) {
    const after = src.slice(m.index, m.index + 500);
    assert.match(after, new RegExp(`${syncFn}\\(\\)`), `#${inputId}: senkronsuz yazma -> ...${src.slice(m.index - 60, m.index + 60)}`);
  }
}

// ---------------------------------------------------------------------------------------------
section('office-picker: paylaşılan yetenekler');

test('çok kaynaklı yükleme tek listede birleşir ve tekilleşir', () => {
  assert.match(picker, /function loadMergedOptions\(urls\)/);
  assert.match(picker, /const key = foldTr\(item\.name\);/);
  // Kaynaklar AYRI önbelleklenir: aynı uç iki kutu için iki kez çekilmemeli.
  assert.match(picker, /const optionsPromises = new Map\(\);/);
});

test('createPersonOrOfficePicker kişi + firma uçlarını birlikte okur', () => {
  const fn = picker.match(/function createPersonOrOfficePicker[\s\S]*?\n  \}/);
  assert.ok(fn, 'createPersonOrOfficePicker yok');
  assert.match(fn[0], /optionsUrls: \[ARCHITECT_OPTIONS_URL, OFFICE_OPTIONS_URL\]/);
  assert.match(picker, /window\.createPersonOrOfficePicker = createPersonOrOfficePicker;/);
});

test('single:true seçimi TEK değerle sınırlar (her üç giriş yolunda da)', () => {
  assert.match(picker, /const single = !!options\.single;/);
  // (a) listeden seçim, (b) "+ ... ekle" satırı, (c) programatik set — üçü de sınırı uygulamalı.
  assert.match(picker, /if \(single\) \{\s*\n\s*selected = cb\.checked \? \[cb\.value\] : \[\];/);
  assert.match(picker, /if \(single\) selected = \[name\];/);
  assert.match(picker, /if \(single\) selected = selected\.slice\(0, 1\);/);
  // Tek seçimde <radio>, çokluda <checkbox>.
  assert.match(picker, /type="\$\{single \? 'radio' : 'checkbox'\}"/);
});

test('bağlı gizli input her yazmada "input" olayı yayar', () => {
  // GERÇEK BULGU: type="hidden" input'a programatik atama hiçbir olay tetiklemez — onu dinleyen
  // mevcut kodlar (urun-ekle.html#DuplicateNameCheck) sessizce çalışmaz olurdu.
  const fn = picker.match(/function pushToInput\(\)[\s\S]*?\n    \}/);
  assert.ok(fn);
  assert.match(fn[0], /dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\)/);
});

// ---------------------------------------------------------------------------------------------
section('1) firma-ekle: Kurucular + Ekip');

test('office-picker.js defer OLMADAN yükleniyor', () => {
  assert.match(firmaEkle, /<script src="office-picker\.js"><\/script>/);
});

test('iki kutu da gizli input + picker mount', () => {
  for (const id of ['o-founders', 'o-team']) {
    assert.match(firmaEkle, new RegExp(`<input type="hidden" id="${id}" name="`), `#${id} gizli input değil`);
    assert.match(firmaEkle, new RegExp(`<div id="${id}-picker"></div>`), `#${id}-picker mount yok`);
  }
  assert.ok(!/ac-kurucular-suggestions|ac-ekip-suggestions/.test(firmaEkle), 'eski öneri listeleri kalmamalı');
  assert.ok(!/function wireAutocompleteLive/.test(firmaEkle), 'çağrısız kalan autocomplete yardımcısı silinmeli');
});

test('ikisi de kişi kaynağından beslenir ve elle girişe açık', () => {
  for (const v of ['founderPicker', 'teamPicker']) {
    const call = firmaEkle.match(new RegExp(`${v} = createArchitectPicker\\([\\s\\S]*?\\}\\);`));
    assert.ok(call, `${v} kurulmuyor`);
    assert.match(call[0], /allowCustom: true/, `${v} elle girişe kapalı`);
  }
});

test('#o-founders / #o-team yazan HER nokta kutuyu senkronlar', () => {
  assertEverySyncCall(firmaEkle, 'o-founders', 'syncFounderPicker', 4);
  assertEverySyncCall(firmaEkle, 'o-team', 'syncTeamPicker', 4);
});

test('masaüstü + tablette yan yana 2 sütun (.form-row, <=720px tek sütun)', () => {
  // Kutular sayfanın KENDİ ızgarasına alındı; ayrı bir kural yazılmadı ki genel düzenle ayrışmasın.
  const row = firmaEkle.match(/<div class="form-row">\s*\n\s*<div class="form-field" id="ac-kurucular-field">[\s\S]*?id="ac-ekip-field"[\s\S]*?<\/div>\s*\n\s*<\/div>/);
  assert.ok(row, 'Kurucular ve Ekip AYNI .form-row içinde değil');
  assert.match(firmaEkle, /\.form-row\{display:grid; grid-template-columns:1fr 1fr/);
  assert.match(firmaEkle, /@media \(max-width:720px\)\{[\s\S]*?\.form-row\{grid-template-columns:1fr/);
});

// ---------------------------------------------------------------------------------------------
section('2) urun-ekle: Firma + Tasarımcı');

test('iki kutu da gizli input + picker mount', () => {
  for (const id of ['u-brand', 'u-designer']) {
    assert.match(urunEkle, new RegExp(`<input type="hidden" id="${id}" name="`), `#${id} gizli input değil`);
    assert.match(urunEkle, new RegExp(`<div id="${id}-picker"></div>`), `#${id}-picker mount yok`);
  }
  assert.ok(!/ac-brand-suggestions|ac-designer-suggestions/.test(urunEkle), 'eski öneri listeleri kalmamalı');
  // Yalnızca Firma kutusunun kullandığı yardımcılar da düştü (adları yalnızca açıklama
  // yorumunda geçebilir, tanımları kalmamalı).
  assert.ok(!/function wireOfficeSuggest/.test(urunEkle), 'wireOfficeSuggest tanımı silinmeli');
  assert.ok(!/function foldTrUrun/.test(urunEkle), 'foldTrUrun tanımı silinmeli');
  assert.ok(!/function loadOfficeNames/.test(urunEkle), 'loadOfficeNames tanımı silinmeli');
  // wireAutocompleteLive KALIR: "Kullanılan Projeler" kutusu hâlâ onu kullanıyor.
  assert.match(urunEkle, /wireAutocompleteLive\('u-project-input'/);
});

test('Firma TEK seçim (şema gereği), Tasarımcı çoklu; ikisi de elle girişe açık', () => {
  const brand = urunEkle.match(/brandPicker = createOfficePicker\([\s\S]*?\}\);/);
  assert.ok(brand);
  assert.match(brand[0], /single: true/, 'products.brand_office_id TEK kolondur — Firma çoklu olamaz');
  assert.match(brand[0], /allowCustom: true/);
  const designer = urunEkle.match(/designerPicker = createArchitectPicker\([\s\S]*?\}\);/);
  assert.ok(designer);
  assert.ok(!/single: true/.test(designer[0]), 'Tasarımcı çoklu kalmalı');
  assert.match(designer[0], /allowCustom: true/);
});

test('kutular prefill çağrılarından ÖNCE kurulur (TDZ)', () => {
  const pickerAt = urunEkle.indexOf('brandPicker = createOfficePicker(');
  const prefillAt = urunEkle.indexOf('\nprefillForEdit();');
  assert.ok(pickerAt !== -1 && prefillAt !== -1);
  assert.ok(pickerAt < prefillAt, 'let ile tanımlı picker, prefill çağrılarından sonra kurulamaz');
});

test('#u-brand / #u-designer yazan HER nokta kutuyu senkronlar', () => {
  // 2026-09-19: Yapay zeka ile ekle kaldırıldı — u-brand'ın AI yazma noktası eksildi (3 -> 2).
  assertEverySyncCall(urunEkle, 'u-brand', 'syncBrandPicker', 2);
  assertEverySyncCall(urunEkle, 'u-designer', 'syncDesignerPicker', 2); // 2026-09-19: AI yazma noktası eksildi (3 -> 2)
});

test('Firma zorunluluğu artık ELLE kontrol ediliyor (gizli input `required` almaz)', () => {
  assert.match(urunEkle, /if\(!document\.getElementById\('u-brand'\)\.value\.trim\(\)\)\{[\s\S]{0,120}Firma alanını doldur/);
});

// ---------------------------------------------------------------------------------------------
section('3) kisi-ekle + Hesabım: firma kutusuna elle isim');

test('iki yüzeyde de allowCustom açık (davranış yüzeye göre değişmiyor)', () => {
  const page = kisiEkle.match(/createOfficePicker\(document\.getElementById\('m-office-picker'\)[\s\S]*?\}\);/);
  assert.ok(page, 'kisi-ekle firma kutusu yok');
  assert.match(page[0], /allowCustom: true/);
  const modal = authModal.match(/firmaPicker = createOfficePicker\(mount, \{[\s\S]*?\}\);/);
  assert.ok(modal, 'Hesabım firma kutusu yok');
  assert.match(modal[0], /allowCustom: true/);
});

// ---------------------------------------------------------------------------------------------
section('4) proje-ekle: Kaynak ipucu + Fotoğrafçı');

test('Kaynak ipucundaki agregatör cümlesi silindi', () => {
  const hint = projeEkle.match(/<div class="form-hint">Projenin ya da görsellerin alındığı[^<]*<\/div>/);
  assert.ok(hint, 'Kaynak ipucu bulunamadı');
  assert.ok(!/arkitera|archello|archdaily|divisare|kabul edilmez/i.test(hint[0]), 'uyarı cümlesi hâlâ duruyor');
});

test('KURAL duruyor — yalnızca cümle kaldırıldı', () => {
  // Uyarıyı silmek yasağı kaldırmaz: canonical yazma kapısı yerinde olmalı.
  // Yazma kapısı canonicalSync'tedir (dropAggregatorSourceUrl); planProjectSourceUrls ise mevcut
  // veriyi temizleyen betiğin okuduğu karar fonksiyonudur — ikisi de yerinde kalmalı.
  assert.match(read('src/lib/canonicalSync.js'), /import \{ dropAggregatorSourceUrl \} from '\.\/aggregatorSources\.js';/);
  assert.match(read('src/lib/aggregatorSources.js'), /export function dropAggregatorSourceUrl/);
  assert.match(read('src/lib/aggregatorSources.js'), /export function planProjectSourceUrls/);
});

test('Fotoğrafçı kutusu gizli input + KİŞİ VE FİRMA tek listede', () => {
  assert.match(projeEkle, /<input type="hidden" id="p-credit-text" name="photoCreditText">/);
  assert.match(projeEkle, /<div id="p-credit-picker"><\/div>/);
  const call = projeEkle.match(/creditPicker = createPersonOrOfficePicker\([\s\S]*?\}\);/);
  assert.ok(call, 'createPersonOrOfficePicker çağrısı yok');
  assert.match(call[0], /allowCustom: true/);
  // AYRI bir firma kutusu AÇILMADI (kullanıcı isteği: "ayrı bir kutucuk olarak ayırma").
  assert.ok(!/p-credit-office|p-photographer-office/.test(projeEkle), 'fotoğrafçı için ikinci bir kutu açılmamalı');
});

test('Kaynak\'ı firmanın sitesiyle doldurma davranışı KORUNDU', () => {
  assert.match(projeEkle, /async function onCreditPickerChange\(names\)/);
  assert.match(projeEkle, /if\(await fillSourceFromOffice\(name\)\) break;/);
  // Programatik yüklemelerde susturulur: prefill zaten photo_credit_url'i getiriyor, ezilmemeli.
  assert.match(projeEkle, /creditAutoFillMuted = true;/);
});

test('#p-credit-text yazan HER nokta kutuyu senkronlar', () => {
  // 2026-09-19: Yapay zeka ile ekle kaldırıldı — AI yazma noktası eksildi (4 -> 3).
  assertEverySyncCall(projeEkle, 'p-credit-text', 'syncCreditPicker', 3);
});

test('Fotoğrafçı zorunluluğu elle kontrol edilmeye devam ediyor', () => {
  assert.match(projeEkle, /if\(!document\.getElementById\('p-credit-text'\)\.value\.trim\(\)\) missingChoices\.push\('Fotoğrafçı'\);/);
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
process.exit(failed ? 1 : 0);
