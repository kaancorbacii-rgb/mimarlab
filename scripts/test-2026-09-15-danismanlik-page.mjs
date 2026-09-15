#!/usr/bin/env node
// DANIŞMANLIK SAYFASI — BİRİM TESTLERİ
// (kullanıcı isteği, 2026-09-15: "DANIŞMANLIK diye bir sayfa tasarla. Aynı kişi sayfası gibi olsun,
//  sol tarafta filtreler ve filtrelerin en altında Danışman Ol butonu olsun. Sayfayı yayına al ama
//  hiçbir menüye ekleme. Danışman olarak Kaan Çorbacı'yı koy ve Kaan Çorbacı'nın profilindeki
//  Danışmanlık Al butonundaki bilgileri kullan.")
//
// Kelepçelenen şeyler — hepsi SESSİZCE bozulabilecek türden:
//
//   1. DANIŞMAN LİSTESİ İKİ KAYNAKLI OLMASIN. Sayfanın gösterdiği kişiler, randevu talebini kabul
//      eden kapının (`consultants` tablosu, status='approved') TA KENDİSİNDEN türer. Sayfaya ya da
//      uca elle bir slug yazılırsa kapı değiştiği gün sayfa çalışmayan bir kart gösterir.
//      (2026-09-15 ikinci tur: kapı artık koddaki bir Set değil D1'deki tablodur — bkz.
//       migrations/0121_consultants.sql.)
//   2. TEKLİF BİLGİLERİ SAYFADA SABİT OLMASIN. Ücret/süre/gün/saat/saat dilimi yalnızca `offer`
//      alanından gelir; danismanlik.html'e gömülen bir kopya, kural değiştiğinde ziyaretçiye eski
//      bilgiyi göstermeye devam ederdi (ve randevu sunucuda reddedilirdi).
//   3. TANITIM CÜMLESİ AYRIŞMASIN. consultationIntro() ile consultation-modal.js'in geri-düşüş
//      cümlesi BİREBİR aynı kalmalı — biri değişirse aynı teklif iki farklı yüzeyde iki farklı
//      cümleyle anlatılır.
//   4. SAYFA HİÇBİR MENÜDE OLMASIN (kullanıcı isteği). Menüler/altbilgi tek bir yerden çizilir
//      (js/components/site-chrome.js); oraya bir bağlantı sızarsa bu test patlar.
//   5. "DANIŞMAN OL" FİLTRELERİN EN ALTINDA OLSUN ve gerçek bir hedefi olsun.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const page = read('danismanlik.html');
const consultationsSrc = read('src/routes/consultations.js');
const modal = read('js/components/consultation-modal.js');
const indexSrc = read('src/index.js');
const chrome = read('js/components/site-chrome.js');
// Sayfanın YORUMSUZ hâli — aşağıdaki "gömülü değer" kontrolleri yalnızca gerçekten çizilen koda
// bakmalı: dosya başındaki kullanıcı isteği alıntısı ("Danışman olarak Kaan Çorbacı'yı koy")
// veya bir gerekçe notu, bir veri kopyası DEĞİLDİR.
const pageCode = page
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const { fetchConsultantList, consultationIntro } = await import(new URL('src/routes/consultations.js', root));
const { DEFAULT_OFFER } = await import(new URL('src/lib/consultants.js', root));
const { CONSULTATION_DURATION_MIN, CONSULTATION_TIMEZONE } = await import(new URL('src/lib/consultationMeet.js', root));

// Sahte D1 — fetchConsultantList'in tek dış bağımlılığı env.DB.prepare(...).all(). Sorgu
// `consultants` tablosunu `architects` ile JOIN'liyor; sahte satır ikisinin birleşimini taşır.
function fakeEnv(rows) {
  return {
    DB: {
      prepare(sql) {
        return { sql, bind() { return this; }, async all() { return { results: rows }; } };
      },
    },
  };
}
const KAAN = {
  architect_slug: 'kaan-corbaci', user_id: null, status: 'approved',
  duration_min: 45, price_try: 1500, weekdays: '[1,3,5]', times: '["18:00","19:00","20:00"]',
  expertise: 'Mimarlık kariyeri ve portföy geliştirme üzerine birebir görüşme.', intro: null,
  architect_id: 20, name: 'Kaan Çorbacı', dob: 1990, photo_url: '/mimarlar/kaan.jpg',
  position: 'Kurucu', profession: 'Mimar', school: 'İTÜ',
  awards: JSON.stringify(['Ulusal Mimarlık Ödülleri']), office_name: 'MİMARLAB', office_awards: null,
};

console.log('\n1 — Danışman listesi, randevu kapısının KENDİSİNDEN türer');

await test('onaylı danışman listelenir ve teklifi KART BAŞINA döner', async () => {
  const data = await fetchConsultantList(fakeEnv([KAAN]));
  assert.equal(data.total, 1);
  assert.equal(data.items[0].slug, 'kaan-corbaci');
  assert.equal(data.items[0].name, 'Kaan Çorbacı');
  // Liste düzeyinde TEK bir `offer` OLMAMALI — ikinci danışman eklendiğinde herkese aynı
  // süre/ücret gösterilirdi.
  assert.equal(data.offer, undefined, 'liste düzeyinde tekil `offer` geri gelmiş');
  assert.ok(data.items[0].offer, 'kartın kendi teklifi yok');
  assert.equal(data.items[0].offer.durationMin, 45);
  assert.equal(data.items[0].offer.priceTry, 1500);
});

await test('SQL yalnızca ONAYLI satırı ister (kapı sorguda)', async () => {
  let seenSql = '';
  const env = { DB: { prepare(sql) { seenSql = sql; return { bind() { return this; }, async all() { return { results: [] }; } }; } } };
  const { fetchApprovedConsultantRows } = await import(new URL('src/lib/consultants.js', root));
  await fetchApprovedConsultantRows(env);
  assert.match(seenSql, /c\.status = 'approved'/, 'liste sorgusu onay kapısını taşımıyor');
  assert.match(seenSql, /a\.deleted_at IS NULL AND a\.hidden_at IS NULL/, 'silinmiş/gizli kişi kaydı elenmiyor');
});

await test('satır yoksa (hiç onaylı danışman yok) sayfa boş kalır, kırılmaz', async () => {
  const data = await fetchConsultantList(fakeEnv([]));
  assert.deepEqual(data.items, []);
  assert.equal(data.total, 0);
});

await test('danismanlik.html hiçbir danışman slug/adını KENDİ İÇİNDE taşımaz', () => {
  // Sayfa listeyi yalnızca /api/consultants'tan alır.
  assert.ok(!pageCode.includes('kaan-corbaci'), "danismanlik.html bir danışman slug'ını gömülü taşıyor");
  assert.ok(!/Kaan\s+Çorbacı/.test(pageCode), 'danismanlik.html bir danışman adını gömülü taşıyor');
  assert.match(page, /\/api\/consultants/);
});

console.log('\n2 — Teklif bilgileri (ücret/süre/gün/saat) yalnızca sunucudan');

await test("kartın teklifi D1 satırından okunur, koddaki varsayılandan DEĞİL", async () => {
  // Varsayılandan FARKLI bir satır ver: değerler birebir yansımalı. Aynı olsalardı test,
  // "satır okunmuyor, varsayılana düşülüyor" hatasını göremezdi.
  const custom = { ...KAAN, duration_min: 30, price_try: 750, weekdays: '[2,4]', times: '["10:00","11:00"]' };
  const { items } = await fetchConsultantList(fakeEnv([custom]));
  assert.equal(items[0].offer.durationMin, 30);
  assert.equal(items[0].offer.priceTry, 750);
  assert.deepEqual(items[0].offer.weekdays, [2, 4]);
  assert.deepEqual(items[0].offer.times, ['10:00', '11:00']);
  assert.equal(items[0].offer.timezone, CONSULTATION_TIMEZONE);
  assert.notEqual(items[0].offer.durationMin, DEFAULT_OFFER.durationMin, 'test varsayılanla aynı değeri kullanıyor — hatayı göremez');
});

await test('bozuk JSON kolonu satırı ÇÖPE ATMAZ, yalnızca o alanı varsayılana düşürür', async () => {
  const broken = { ...KAAN, times: 'bu json değil', weekdays: '[]' };
  const { items } = await fetchConsultantList(fakeEnv([broken]));
  assert.equal(items.length, 1, 'bozuk bir alan yüzünden danışman listeden düştü');
  assert.deepEqual(items[0].offer.times, [...DEFAULT_OFFER.times]);
  assert.deepEqual(items[0].offer.weekdays, [...DEFAULT_OFFER.weekdays]);
});

await test('danismanlik.html bu değerlerin HİÇBİRİNİ sabit olarak yazmaz', () => {
  // Ücret (1500 / "1.500"), süre (45 dakika) ve uygun saatler (18:00…) sayfada aranmaz — hepsi
  // offer.* üzerinden çizilir.
  assert.ok(!new RegExp(`\\b${DEFAULT_OFFER.priceTry}\\b`).test(pageCode), 'ücret sayfaya gömülmüş');
  assert.ok(!/1\.500/.test(pageCode), 'ücret sayfaya biçimlenmiş hâliyle gömülmüş');
  assert.ok(!new RegExp(`${CONSULTATION_DURATION_MIN}\\s*(dakika|dk)`).test(pageCode), 'görüşme süresi sayfaya gömülmüş');
  for (const t of DEFAULT_OFFER.times) {
    assert.ok(!pageCode.includes(t), `uygun saat '${t}' sayfaya gömülmüş`);
  }
  // Gün adları YALNIZCA sayı->etiket sözlüğünde (WEEKDAY_NAMES) geçebilir; seçili günlerin listesi
  // offer.weekdays'ten gelir.
  const weekdayDict = /const WEEKDAY_NAMES = \[[^\]]*\];/.exec(pageCode);
  assert.ok(weekdayDict, 'WEEKDAY_NAMES sözlüğü kayıp');
  const withoutDict = pageCode.replace(weekdayDict[0], '');
  assert.ok(!/Çarşamba/.test(withoutDict), 'uygun gün adı sayfaya gömülmüş');
  assert.match(page, /offer\.weekdays/);
  assert.match(page, /offer\.times/);
  assert.match(page, /offer\.priceTry/);
  assert.match(page, /offer\.durationMin/);
  assert.match(page, /offer\.timezone/);
  // Teklif KART BAŞINA okunmalı (item.offer), liste düzeyinde tek bir değişkenden değil.
  assert.match(page, /const offer = item\.offer/);
});

console.log('\n3 — Tanıtım cümlesi tek kaynak (uç) + modaldeki geri düşüş BİREBİR aynı');

await test('consultationIntro ile modalin geri-düşüş cümlesi birebir eşleşir', () => {
  const m = /introEl\.textContent = intro \|\| `(.+?)`;/s.exec(modal);
  assert.ok(m, 'consultation-modal.js#open içindeki geri-düşüş cümlesi bulunamadı');
  const fallback = m[1].replace('${hostName}', 'X');
  assert.equal(fallback, consultationIntro('X'),
    'tanıtım cümlesi ayrışmış — consultations.js#consultationIntro ile consultation-modal.js farklı');
});

await test('modal `intro` ve `offer` parametrelerini kabul eder; ikisi de geri düşüşlü', () => {
  assert.match(modal, /open\(\{ hostSlug, hostName, intro, offer \}\)/);
  // Geri düşüş ŞART: teklif geçirilmezse takvim varsayılanla çizilmeli, boş kalmamalı.
  assert.match(modal, /state\.offer = offer \|\| null;/);
  assert.match(modal, /\(offer && offer\.weekdays\) \|\| DEFAULT_WEEKDAYS/);
});

await test('kişi pop-up\'ı düğmeyi SABİT SLUG ile değil sunucunun `consultant` alanıyla çizer', () => {
  const architectModal = read('js/components/architect-modal.js');
  // Kontrol YORUMSUZ gövdeye bakar: değişikliğin gerekçesini anlatan not, o slug'ı metin olarak
  // andığı için bir veri kopyası SAYILMAZ (pageCode'daki AYNI ayrım).
  const architectModalCode = architectModal
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  // 2026-09-15 ikinci tur: danışman kadrosu artık başvuru + admin onayıyla belirlendiğinden
  // pop-up'ta gömülü bir slug KALMAMALI — aksi halde onaylanan yeni danışmanlarda düğme çıkmaz.
  assert.ok(!architectModalCode.includes("'kaan-corbaci'"), 'architect-modal.js hâlâ gömülü bir danışman slug\'ı taşıyor');
  assert.match(architectModal, /payload && payload\.consultant/);
  // Düğme, teklifi ve tanıtımı modale geçirmeli (takvim danışmanın kendi saatleriyle çizilsin).
  const call = /ConsultationModal\.open\(\{[\s\S]*?\}\)/.exec(architectModal);
  assert.ok(call, 'architect-modal.js ConsultationModal.open çağrısı bulunamadı');
  assert.match(call[0], /offer: consultantOffer/);
  assert.match(call[0], /intro: consultantOffer\.intro/);
});

await test('sayfa, modali uçtan gelen intro ile açar', () => {
  assert.match(page, /ConsultationModal\.open\(\{ hostSlug: item\.slug, hostName: item\.name, intro: item\.intro/);
  // Kartın kendi teklifi de geçirilir — modal kendi varsayılanına düşmesin.
  assert.match(page, /offer: item\.offer \|\| null/);
  // Uç, başvuruda yazılmamışsa tanıtımı üretir (davranış korunur).
  assert.match(consultationsSrc, /consultant\.intro \|\| consultationIntro\(row\.name\)/);
});

console.log('\n4 — Sayfa yayında ama HİÇBİR menüde değil');

await test('site-chrome.js (üst menü + mobil çekmece + altbilgi) /danismanlik bağlantısı TAŞIMAZ', () => {
  assert.ok(!chrome.includes('danismanlik'), 'sayfa bir menüye eklenmiş (kullanıcı isteği: eklenmeyecek)');
});

await test('site içindeki hiçbir sayfa /danismanlik\'a <a href> ile bağlanmıyor', () => {
  for (const f of ['index.html', 'kisi.html', 'firma.html', 'proje.html', 'urun.html', 'hesabim.html']) {
    assert.ok(!read(f).includes('/danismanlik'), `${f} /danismanlik'a bağlanıyor`);
  }
});

await test('uç kayıtlı, .html biçimi 301 ve sayfa sitemap\'te', () => {
  assert.match(indexSrc, /path === '\/api\/consultants'[^\n]*handleConsultantsRoute/);
  assert.match(indexSrc, /'\/danismanlik\.html': '\/danismanlik',/);
  assert.match(indexSrc, /\{ loc: '\/danismanlik',/);
  // Sayfa noindex DEĞİL — sitemap'te olması bu yüzden tutarlı (bkz. src/index.js'teki not).
  assert.ok(!/name="robots"/.test(page), 'sayfa robots meta etiketi taşıyor; sitemap girdisiyle çelişir');
});

console.log('\n5 — Kenar çubuğu: filtreler + EN ALTTA "Danışman Ol"');

await test('"Danışman Ol" düğmesi filtre gruplarından SONRA ve kenar çubuğunun son öğesi', () => {
  const aside = /<aside class="grid-sidebar">([\s\S]*?)<\/aside>/.exec(page);
  assert.ok(aside, 'kenar çubuğu bulunamadı');
  const html = aside[1];
  const groupsAt = html.indexOf('id="filter-groups"');
  const addAt = html.indexOf('class="sidebar-add"');
  assert.ok(groupsAt > -1, 'filtre grupları kayıp');
  assert.ok(addAt > groupsAt, '"Danışman Ol" filtrelerin ÜSTÜNDE — en altta olmalı');
  assert.equal(html.trim().endsWith('</div>'), true);
  assert.match(html.slice(addAt), /Danışman Ol/);
  // Hedef, gerçekten var olan başvuru sayfası olmalı.
  assert.match(html.slice(addAt), /href="\/danisman-ol"/);
  assert.ok(readFileSync(new URL('danisman-ol.html', root), 'utf8').length > 0, 'danisman-ol.html yok');
});

await test('kenar çubuğu kişi sayfasının filtre gruplarının aynısını taşır', () => {
  for (const key of ['position', 'dob', 'school', 'profession', 'award']) {
    assert.ok(page.includes(`key: '${key}'`), `filtre grubu eksik: ${key}`);
  }
  assert.match(page, /Filtreler<\/span>/);
  assert.match(page, /id="g-reset"/);
  assert.match(page, /id="g-local-search"/);
  assert.match(page, /id="g-sort"/);
});

await test('sayfa, filtre sayaçlarını havuzun kendisinden hesaplar (ikinci bir uç yok)', () => {
  assert.match(page, /function countsFor\(key\)/);
  // Tek veri isteği: /api/consultants. Başka bir /api/... çağrısı olmamalı.
  const apiCalls = [...page.matchAll(/['"`](\/api\/[a-z0-9\-/]+)/gi)].map(m => m[1]);
  assert.deepEqual([...new Set(apiCalls)], ['/api/consultants'], `beklenmeyen API çağrıları: ${apiCalls}`);
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) {
  console.error('\nBAŞARISIZ:');
  failures.forEach(f => console.error(`  - ${f.name}: ${f.message}`));
  process.exit(1);
}
