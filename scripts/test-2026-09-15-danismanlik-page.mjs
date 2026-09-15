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
//      eden kapının (consultations.js#ALLOWED_HOST_SLUGS) TA KENDİSİNDEN türer. Sayfaya ya da uca
//      elle bir slug yazılırsa kapı değiştiği gün sayfa çalışmayan bir kart gösterir.
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

const {
  fetchConsultantList, consultationIntro,
  ALLOWED_HOST_SLUGS, ALLOWED_TIMES, ALLOWED_WEEKDAYS, CONSULTATION_PRICE_TRY,
} = await import(new URL('src/routes/consultations.js', root));
const { CONSULTATION_DURATION_MIN, CONSULTATION_TIMEZONE } = await import(new URL('src/lib/consultationMeet.js', root));

// Sahte D1 — fetchConsultantList'in tek dış bağımlılığı env.DB.prepare(...).bind(...).all().
function fakeEnv(rows) {
  let bound = [];
  return {
    DB: {
      prepare(sql) {
        return {
          sql,
          bind(...args) { bound = args; return this; },
          async all() {
            return { results: rows.filter(r => bound.includes(r.slug)) };
          },
        };
      },
    },
  };
}
const KAAN = {
  id: 20, slug: 'kaan-corbaci', name: 'Kaan Çorbacı', dob: 1990,
  photo_url: '/mimarlar/kaan.jpg', position: 'Kurucu', profession: 'Mimar', school: 'İTÜ',
  awards: JSON.stringify(['Ulusal Mimarlık Ödülleri']), office_name: 'MİMARLAB', office_awards: null,
};

console.log('\n1 — Danışman listesi, randevu kapısının KENDİSİNDEN türer');

await test("ALLOWED_HOST_SLUGS 'kaan-corbaci' içerir ve uç onu döner", async () => {
  assert.ok(ALLOWED_HOST_SLUGS.has('kaan-corbaci'), 'randevu kapısı kaan-corbaci profilini tanımıyor');
  const data = await fetchConsultantList(fakeEnv([KAAN]));
  assert.equal(data.total, 1);
  assert.equal(data.items[0].slug, 'kaan-corbaci');
  assert.equal(data.items[0].name, 'Kaan Çorbacı');
});

await test('uç, kapının DIŞINDAKİ bir kişiyi ASLA listelemez', async () => {
  const other = { ...KAAN, id: 99, slug: 'baska-biri', name: 'Başka Biri' };
  const data = await fetchConsultantList(fakeEnv([KAAN, other]));
  assert.deepEqual(data.items.map(i => i.slug), ['kaan-corbaci']);
});

await test('D1 satırı yoksa (silinmiş/gizlenmiş) sayfa boş kalır, kırılmaz', async () => {
  const data = await fetchConsultantList(fakeEnv([]));
  assert.deepEqual(data.items, []);
  assert.equal(data.total, 0);
  assert.ok(data.offer, 'satır olmasa bile teklif bilgisi dönmeli');
});

await test('danismanlik.html hiçbir danışman slug/adını KENDİ İÇİNDE taşımaz', () => {
  // Sayfa listeyi yalnızca /api/consultants'tan alır. Buraya bir slug/ad yazmak, kapı değiştiği gün
  // sayfayı sessizce ayrıştırırdı.
  for (const slug of ALLOWED_HOST_SLUGS) {
    assert.ok(!pageCode.includes(slug), `danismanlik.html '${slug}' slug'ını gömülü taşıyor`);
  }
  assert.ok(!/Kaan\s+Çorbacı/.test(pageCode), 'danismanlik.html bir danışman adını gömülü taşıyor');
  assert.match(page, /\/api\/consultants/);
});

console.log('\n2 — Teklif bilgileri (ücret/süre/gün/saat) yalnızca sunucudan');

await test('offer alanı, akışı DOĞRULAYAN sabitlerin aynısını taşır', async () => {
  const { offer } = await fetchConsultantList(fakeEnv([KAAN]));
  assert.equal(offer.priceTry, CONSULTATION_PRICE_TRY);
  assert.equal(offer.durationMin, CONSULTATION_DURATION_MIN);
  assert.equal(offer.timezone, CONSULTATION_TIMEZONE);
  assert.deepEqual(offer.weekdays, [...ALLOWED_WEEKDAYS].sort((a, b) => a - b));
  assert.deepEqual(offer.times, [...ALLOWED_TIMES].sort());
});

await test('danismanlik.html bu değerlerin HİÇBİRİNİ sabit olarak yazmaz', () => {
  // Ücret (1500 / "1.500"), süre (45 dakika) ve uygun saatler (18:00…) sayfada aranmaz — hepsi
  // offer.* üzerinden çizilir.
  assert.ok(!new RegExp(`\\b${CONSULTATION_PRICE_TRY}\\b`).test(pageCode), 'ücret sayfaya gömülmüş');
  assert.ok(!/1\.500/.test(pageCode), 'ücret sayfaya biçimlenmiş hâliyle gömülmüş');
  assert.ok(!new RegExp(`${CONSULTATION_DURATION_MIN}\\s*(dakika|dk)`).test(pageCode), 'görüşme süresi sayfaya gömülmüş');
  for (const t of ALLOWED_TIMES) {
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
});

console.log('\n3 — Tanıtım cümlesi tek kaynak (uç) + modaldeki geri düşüş BİREBİR aynı');

await test('consultationIntro ile modalin geri-düşüş cümlesi birebir eşleşir', () => {
  const m = /introEl\.textContent = intro \|\| `(.+?)`;/s.exec(modal);
  assert.ok(m, 'consultation-modal.js#open içindeki geri-düşüş cümlesi bulunamadı');
  const fallback = m[1].replace('${hostName}', 'X');
  assert.equal(fallback, consultationIntro('X'),
    'tanıtım cümlesi ayrışmış — consultations.js#consultationIntro ile consultation-modal.js farklı');
});

await test('modal `intro` parametresini kabul eder; kişi pop-up\'ı onu GEÇİRMEZ (davranışı değişmedi)', () => {
  assert.match(modal, /open\(\{ hostSlug, hostName, intro \}\)/);
  const architectModal = read('js/components/architect-modal.js');
  const call = /ConsultationModal\.open\(\{[^}]*\}\)/.exec(architectModal);
  assert.ok(call, 'architect-modal.js ConsultationModal.open çağrısı bulunamadı');
  assert.ok(!call[0].includes('intro'), 'kişi pop-up\'ı artık intro geçiriyor — geri düşüş dalı ölür');
});

await test('sayfa, modali uçtan gelen intro ile açar', () => {
  assert.match(page, /ConsultationModal\.open\(\{ hostSlug: item\.slug, hostName: item\.name, intro: item\.intro/);
  assert.match(consultationsSrc, /intro: consultationIntro\(a\.name\)/);
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
  // Hedef gerçek bir sayfa olmalı (var olmayan /danisman-ol gibi bir yola bağlanmasın).
  assert.match(html.slice(addAt), /href="\/iletisim"/);
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
