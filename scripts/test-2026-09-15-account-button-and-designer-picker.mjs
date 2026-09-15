#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-15 (beşinci tur), üç madde:
//
//  1. "Masaüstü görünümünde hesaba giriş yapınca ana menüdeki hesap ismi yazan butonu ... giriş yap
//     butonu gibi koyu mavi yap ve üzerindeki isim yazısı beyaz olsun. Ayrıca ismin soluna ortaya
//     bir nokta işareti koy. Açılınca çıkan ekranda ismin altında kullanıcı adı, onun da altında
//     e-posta adresi olsun. Tablet ve mobil görünümde de açılan çekmecede isim soyisim ve e-posta
//     adresinin arasına kullanıcı adını yaz." — ve aynı maddenin EKİ: "ana menüde çıkan ismin
//     büyük harflerle yazılmasını ve yanındaki sayfa başlıklarıyla aynı puntoda olmasını da ekle.
//     Ayrıca ... açılan alt menüdeki ve tablet/mobil görünümde de yan çekmecede açılan isim ve
//     soyisim tamamen büyük harflerden oluşmasını ekle."
//  2. "Proje ekle/düzenle sayfasında firma seçiminde yaptığın gibi mimar seçiminde de siteye yüklü
//     kişiler arasından çoklu seçim yapılabilsin, ayrıca manuel olarak elle de giriş yapılabilsin."
//  3. "Bazen kullanıcılar bir projede ... mimar kısmında isimlerini 2 kere yazabiliyorlar. Bunun
//     önüne geç ... Türkçe ve İngilizce karakterler farklı olduğu için yazılabilmiş ama bunu da
//     engelle."
//
// 3. madde ÜÇ katmanda birden kapatıldı ve bu dosya üçünü de kilitler: form kutusu (office-picker
// tekilleştirmesi), gönderi normalizasyonu (submissionTypes#nameArrayFields) ve canonical yazım
// (canonicalSync#syncProject). Ek olarak OKUMA tarafı (project.js#knownNames) katlamalı — o kapı
// olmadan D1'de hâlihazırda duran mükerrer adlar künyede görünmeye devam ederdi.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dedupeNamesTr } from '../src/lib/textMatch.js';
import { normalizeSubmission } from '../src/lib/submissionTypes.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
function section(title) { console.log(`\n${title}`); }
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

const authNav = read('auth-nav.js');
const picker = read('office-picker.js');
const projeEkle = read('proje-ekle.html');
const architectRoute = read('src/routes/architect.js');
const indexJs = read('src/index.js');
const projectRoute = read('src/routes/project.js');
const canonicalSync = read('src/lib/canonicalSync.js');

// ---------------------------------------------------------------------------------------------
section('1) hesap düğmesi: dolu koyu mavi + beyaz yazı + baştaki nokta');

test('.nav-avatar dolu var(--ink) arka plan ve var(--paper-card) yazı taşır', () => {
  const rule = authNav.match(/\.nav-avatar\{[^}]*\}/);
  assert.ok(rule, '.nav-avatar kuralı bulunamadı');
  assert.match(rule[0], /background:var\(--ink\)/, 'düğme dolu koyu mavi olmalı');
  assert.match(rule[0], /color:var\(--paper-card\)/, 'yazı beyaz olmalı');
});

test('ismin SOLUNA nokta çizilir (.nav-avatar-dot, ad ifadesinden ÖNCE)', () => {
  assert.match(authNav, /\.nav-avatar-dot\{[^}]*border-radius:50%/, 'nokta kuralı yok');
  const btn = authNav.match(/<button class="nav-avatar"[\s\S]*?<\/button>/);
  assert.ok(btn, 'hesap düğmesi markup\'ı bulunamadı');
  const dotAt = btn[0].indexOf('nav-avatar-dot');
  const nameAt = btn[0].indexOf('firstName(user.name)');
  assert.ok(dotAt !== -1 && nameAt !== -1, 'nokta ya da ad ifadesi yok');
  assert.ok(dotAt < nameAt, 'nokta ismin SOLUNDA olmalı');
});

test('düğme puntosu yanındaki sayfa başlıklarıyla (.nav-link) aynı', () => {
  const rule = authNav.match(/\.nav-avatar\{[^}]*\}/);
  assert.match(rule[0], /font-size:14\.5px/, 'punto .nav-link ile aynı olmalı');
  // Referans, her sayfanın KENDİ <style>'ındaki .nav-link kuralıdır — ikisi ayrışmasın.
  for (const page of ['index.html', 'proje.html']) {
    assert.match(read(page), /\.nav-link\{[^}]*font-size:14\.5px/, `${page}#.nav-link puntosu değişmiş`);
  }
});

test('ad ÜÇ yüzeyde de Türkçe kurallarına göre BÜYÜK harfe çevrilir', () => {
  // CSS text-transform DEĞİL: o dönüşüm tarayıcının yerel verisine bağlıdır ve "i" -> "I" üreten
  // bir ortamda "İstanbul" -> "ISTANBUL" olurdu (bkz. upperTr yorumu).
  assert.match(authNav, /function upperTr\(s\) \{[\s\S]*?replace\(\/i\/g, 'İ'\)[\s\S]*?replace\(\/ı\/g, 'I'\)/);
  assert.ok(authNav.includes('${escapeHtml(upperTr(firstName(user.name)))}'), 'üst menü düğmesi büyük harf değil');
  assert.ok(authNav.includes('<div class="nav-avatar-menu-name">${escapeHtml(upperTr(user.name || \'\'))}</div>'), 'açılır menü başlığı büyük harf değil');
  assert.ok(authNav.includes('<div class="nav-mobile-account-name">${escapeHtml(upperTr(user.name || \'\'))}</div>'), 'çekmece başlığı büyük harf değil');
  // Kaçış SONRA gelmeli: kaçırılmış metni büyütmek "&amp;"yi "&AMP;"ye çevirirdi.
  assert.ok(!/upperTr\(escapeHtml\(/.test(authNav), 'büyütme HTML kaçışından ÖNCE olmalı');
});

test('upperTr Türkçe i/ı ayrımını korur', async () => {
  const upperTr = (s) => String(s == null ? '' : s).replace(/i/g, 'İ').replace(/ı/g, 'I').toLocaleUpperCase('tr-TR');
  assert.equal(upperTr('Kaan Çorbacı'), 'KAAN ÇORBACI');
  assert.equal(upperTr('İstanbul Mimarlık'), 'İSTANBUL MİMARLIK');
  assert.equal(upperTr('Işıl Ergin'), 'IŞIL ERGİN');
});

test('bildirim noktasının halkası düğmenin yeni arka planıyla aynı', () => {
  const rule = authNav.match(/\.nav-avatar-alert\{[^}]*\}/);
  assert.ok(rule);
  assert.match(rule[0], /border:2px solid var\(--ink\)/, 'halka düğmenin arka planıyla aynı olmalı');
});

test('masaüstü menüde sıra: ad -> kullanıcı adı -> e-posta', () => {
  const header = authNav.match(/<div class="nav-avatar-menu-id">[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(header, 'menü kimlik bloğu bulunamadı');
  const name = header[0].indexOf('nav-avatar-menu-name');
  const uname = header[0].indexOf('nav-avatar-menu-username');
  const email = header[0].indexOf('nav-avatar-menu-email');
  assert.ok(name !== -1 && uname !== -1 && email !== -1, 'üç satırdan biri eksik');
  assert.ok(name < uname && uname < email, 'kullanıcı adı ad ile e-posta ARASINDA olmalı');
});

test('mobil çekmecede sıra: ad -> kullanıcı adı -> e-posta', () => {
  const header = authNav.match(/<div class="nav-mobile-account-id">[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(header, 'çekmece kimlik bloğu bulunamadı');
  const name = header[0].indexOf('nav-mobile-account-name');
  const uname = header[0].indexOf('nav-mobile-account-username');
  const email = header[0].indexOf('nav-mobile-account-email');
  assert.ok(name !== -1 && uname !== -1 && email !== -1, 'üç satırdan biri eksik');
  assert.ok(name < uname && uname < email, 'kullanıcı adı ad ile e-posta ARASINDA olmalı');
});

test('üç satır arasında nefes payı var (gap + line-height, iki yüzeyde de)', () => {
  // Kullanıcı bildirimi, 2026-09-15 altıncı tur: "Çok birbirleri içerisine geçmişler."
  // Aralık kapsayıcıya flex+gap ile verilmeli, satırlara margin ile DEĞİL: kullanıcı adı satırı
  // koşulludur (kolonu boş eski hesapta çizilmez), margin iki ve üç satırlı hâllerde farklı
  // sonuç verirdi.
  for (const [idSel, rows] of [
    ['nav-avatar-menu-id', ['nav-avatar-menu-name', 'nav-avatar-menu-username', 'nav-avatar-menu-email']],
    ['nav-mobile-account-id', ['nav-mobile-account-name', 'nav-mobile-account-username', 'nav-mobile-account-email']],
  ]) {
    const idRule = authNav.match(new RegExp(`\\.${idSel}\\{[^}]*\\}`));
    assert.ok(idRule, `.${idSel} kuralı yok`);
    assert.match(idRule[0], /display:flex/, `.${idSel} flex olmalı`);
    assert.match(idRule[0], /flex-direction:column/, `.${idSel} dikey dizilmeli`);
    const gap = idRule[0].match(/gap:(\d+(?:\.\d+)?)px/);
    assert.ok(gap && Number(gap[1]) >= 5, `.${idSel} satır aralığı en az 5px olmalı`);
    for (const row of rows) {
      const rule = authNav.match(new RegExp(`\\.${row}\\{[^}]*\\}`));
      assert.ok(rule, `.${row} kuralı yok`);
      const lh = rule[0].match(/line-height:(\d+(?:\.\d+)?)/);
      assert.ok(lh && Number(lh[1]) >= 1.3, `.${row} satır yüksekliği en az 1.3 olmalı (ad BÜYÜK HARF)`);
    }
  }
});

test('kullanıcı adı /api/auth/me#username alanından gelir ve "@" ile gösterilir', () => {
  assert.match(authNav, /const usernameLine = user\.username \? `@\$\{user\.username\}` : '';/);
  // Kolonu boş olan eski hesapta satır HİÇ çizilmez (boş bir "@" kalmaz).
  assert.ok(authNav.includes('${usernameLine ? `<div class="nav-avatar-menu-username">'));
  assert.ok(authNav.includes('${usernameLine ? `<div class="nav-mobile-account-username">'));
});

test('publicUser username alanını döndürmeye devam ediyor', () => {
  assert.match(read('src/lib/auth.js'), /username: username \|\| null/);
});

// ---------------------------------------------------------------------------------------------
section('2) proje-ekle Mimar kutusu: çoklu seçim + elle giriş');

test('office-picker.js genel gövdeyi iki uca bağlar', () => {
  assert.match(picker, /const ARCHITECT_OPTIONS_URL = '\/api\/architects\/names';/);
  assert.match(picker, /function createNamePicker\(mount, opts\)/);
  assert.match(picker, /window\.createArchitectPicker = createArchitectPicker;/);
  // Firma kutusu ESKİ ucunda kalmalı — iki kaynak birbirine karışmasın.
  assert.match(picker, /const OFFICE_OPTIONS_URL = '\/api\/offices\/names';/);
});

test('kaynak listesi URL başına önbelleklenir (iki kutu tek istek paylaşmaz)', () => {
  assert.match(picker, /const optionsPromises = new Map\(\);/);
  assert.match(picker, /function loadOptions\(url\)/);
  assert.ok(!/loadOfficeOptions\(\)/.test(picker), 'tek kaynaklı eski yükleyici kalmamalı');
});

test('GET /api/architects/names hem tanımlı hem yönlendirmede kayıtlı', () => {
  assert.match(architectRoute, /export async function handleArchitectNamesRoute/);
  assert.match(indexJs, /path === '\/api\/architects\/names'\) return handleArchitectNamesRoute/);
  assert.match(indexJs, /handleArchitectNamesRoute/);
});

test('uç directory_listed filtrelemez (künyeye eklenebilirlik dizinden bağımsız)', () => {
  const fn = architectRoute.match(/export async function handleArchitectNamesRoute[\s\S]*?\n}\n/);
  assert.ok(fn);
  assert.ok(!/directory_listed/.test(fn[0]), 'dizin tercihi bu kutuyu kısıtlamamalı');
  // Arama ucuyla AYNI görünürlük kapısı: silinmemiş + (gizlenmemiş VEYA önizleme).
  assert.match(fn[0], /a\.deleted_at IS NULL AND \(a\.hidden_at IS NULL OR a\.preview_at IS NOT NULL\)/);
});

test('#p-designer artık gizli input, yanında picker mount var', () => {
  assert.match(projeEkle, /<input type="hidden" id="p-designer" name="designer">/);
  assert.match(projeEkle, /<div id="p-designer-picker"><\/div>/);
  assert.ok(!/id="ac-mimar-suggestions"/.test(projeEkle), 'eski autocomplete listesi kalmamalı');
  assert.ok(!/wireAutocompleteLive\('p-designer'/.test(projeEkle), 'eski autocomplete bağlanmamalı');
});

test('kutu firma kutusuyla AYNI seçeneklerle kurulur (allowCustom + input senkronu)', () => {
  const call = projeEkle.match(/designerPicker = createArchitectPicker\([\s\S]*?\}\);/);
  assert.ok(call, 'createArchitectPicker çağrısı yok');
  assert.match(call[0], /input: document\.getElementById\('p-designer'\)/);
  assert.match(call[0], /allowCustom: true/);
});

test('#p-designer.value yazan HER nokta syncDesignerPicker() çağırır', () => {
  // Gizli input'a yazıp kutuyu senkronlamayı unutan bir yol, kullanıcının gördüğü çiplerle
  // gönderilen değeri sessizce ayırırdı (firma kutusundaki syncOfficePicker ile aynı sözleşme).
  const writes = [...projeEkle.matchAll(/getElementById\('p-designer'\)\.value\s*=/g)];
  assert.ok(writes.length >= 5, `beklenenden az yazma noktası: ${writes.length}`);
  for (const m of writes) {
    const after = projeEkle.slice(m.index, m.index + 400);
    assert.match(after, /syncDesignerPicker\(\)/, `senkronsuz yazma: ...${projeEkle.slice(m.index - 60, m.index + 60)}`);
  }
});

// ---------------------------------------------------------------------------------------------
section('3) aynı ad künyeye iki kez yazılamaz (Türkçe/ASCII farkı dahil)');

test('dedupeNamesTr: Türkçe ve ASCII yazım TEK ada iner, İLK yazım korunur', () => {
  assert.deepEqual(
    dedupeNamesTr(['Ayça Akkaya Kul', 'Ayca Akkaya Kul', 'Önder Kul', 'Onder Kul']),
    ['Ayça Akkaya Kul', 'Önder Kul'],
  );
});

test('dedupeNamesTr: büyük/küçük harf, baştaki/sondaki boşluk ve boş öğeler', () => {
  assert.deepEqual(dedupeNamesTr(['  Nevzat Sayın ', 'NEVZAT SAYIN', '', '   ', null, 5]), ['Nevzat Sayın']);
});

test('dedupeNamesTr: gerçekten farklı adlar KORUNUR ve sıra bozulmaz', () => {
  assert.deepEqual(dedupeNamesTr(['Emre Arolat', 'Nevzat Sayın', 'Han Tümertekin']),
    ['Emre Arolat', 'Nevzat Sayın', 'Han Tümertekin']);
});

test('normalizeSubmission mimar VE firma kutularını tekilleştirir', () => {
  const row = normalizeSubmission('projects', {
    title: 'X',
    designer: ['Ayça Akkaya Kul', 'Ayca Akkaya Kul', 'Önder Kul'],
    office: ['mimaristudio', 'Mimaristudio'],
  });
  assert.deepEqual(JSON.parse(row.designer), ['Ayça Akkaya Kul', 'Önder Kul']);
  assert.deepEqual(JSON.parse(row.office), ['mimaristudio']);
});

test('ad OLMAYAN dizi alanları tekilleştirilmez (tekrar anlamlı olabilir)', () => {
  const row = normalizeSubmission('projects', { title: 'X', images: ['/a.jpg', '/a.jpg'] });
  assert.deepEqual(JSON.parse(row.images), ['/a.jpg', '/a.jpg']);
});

test('canonicalSync#syncProject künyeyi yazmadan ÖNCE tekilleştirir', () => {
  assert.match(canonicalSync, /import \{ foldTr, dedupeNamesTr \} from '\.\/textMatch\.js';/);
  assert.match(canonicalSync, /const designerNames = dedupeNamesTr\(row\.designer \|\| \[\]\);/);
  assert.match(canonicalSync, /const officeNames = dedupeNamesTr\(row\.office \|\| \[\]\);/);
  // Üç tüketici de AYNI tekilleştirilmiş listeyi okumalı: bağlar, ham ad kolonları, düzenleme damgası.
  assert.match(canonicalSync, /for \(const name of designerNames\) \{/);
  assert.match(canonicalSync, /\.bind\(JSON\.stringify\(designerNames\), JSON\.stringify\(officeNames\), projectId\)\)/);
  assert.match(canonicalSync, /architects: \[\.\.\.designerNames\]/);
});

test('künye OKUMASI da katlamalı — D1\'de duran eski mükerrerler çizilmez', () => {
  assert.match(projectRoute, /const foldedKnownNames = new Set\(designerDetails\.map\(d => foldTr\(d\.name\)\)\);/);
  assert.match(projectRoute, /has: \(name\) => foldedKnownNames\.has\(foldTr\(name\)\)/);
});

test('proje-ekle içindeki isim karşılaştırmaları da AYNI katlamayı kullanır', () => {
  // toLowerCase()/toLocaleLowerCase('tr') "Ayça"/"Ayca" ayrımını KORUR — o anahtarlar geri gelirse
  // firma üyeleri ve kendi firmanın kurucuları yine iki yazımla iki kez eklenebilirdi.
  assert.match(projeEkle, /function foldTrLocal\(value\)/);
  assert.match(projeEkle, /const seen = new Set\(existing\.map\(foldTrLocal\)\);/);
  assert.match(projeEkle, /const foldKey = foldTrLocal;/);
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
process.exit(failed ? 1 : 0);
