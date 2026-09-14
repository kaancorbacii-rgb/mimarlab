#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-12 (yedinci tur) — iki madde.
//
// MADDE 1 — "Hesabım sayfasındaki Bildirimler ve Mesajlar kutuları açılır kapanır buton şeklinde
//   olsunlar. Eğer bir bildirim veya mesaj gelirse buton kapalı olsa dahi başlığın sağ tarafında
//   turuncu nokta işaretiyle belirtilsin."
//
//   GÜNCELLEME, 2026-09-14: "bildirimler ve mesajlar kutuları da default olarak açık
//   gözüksünler". Kutular AÇILIR KAPANIR olmaya devam eder — değişen tek şey İLK DURUM:
//   aria-expanded="true" ve gövdede `hidden` yok. Aşağıdaki beklentiler buna göre güncellendi;
//   testin asıl koruduğu şey (panelin kendi deseni + gövdenin İÇERİĞİ) aynı kaldı.
//   Aynı turda Profil Bilgileri ve Firma / Marka Bilgileri kutuları da aynı desene alındı
//   (yine varsayılan açık) — madde 3'te kilitleniyor.
//
//   İki sözleşme birlikte kilitlenir:
//   (a) AÇILIR KAPANIR KUTU, PANELİN KENDİ DESENİYLE: .dash-collapse-toggle + data-collapse +
//       .dash-collapse-body. Arşivim/İstatistikler/Rozetlerim de aynı deseni kullanıyor ve
//       wireCollapsibles #am-panel içindeki TÜM bu düğmeleri bağlıyor — ayrı bir JS kancası
//       yazılırsa iki mekanizma aynı kutuyu açıp kapatmaya çalışır.
//   (b) TURUNCU NOKTA BAŞLIĞIN İÇİNDE ve `hidden` ile yönetilir. Nokta chevron'un yanına değil
//       BAŞLIĞA girer, çünkü kutu kapalıyken görünen tek satır başlıktır. Ayrıca
//       display:inline-block taşıyan bir öğede `hidden` TEK BAŞINA yetmez — UA'nın
//       [hidden]{display:none} kuralını yazar stili ezer, o yüzden [hidden] açıkça yazılmalı
//       (aynı tuzak ana sayfa şeritlerinin oklarında yaşanmıştı).
//   Noktanın kaynağı satırların KENDİ okunmadı durumudur (bildirimde !is_read, mesajda unread) —
//   ikinci bir sayaç uydurulmaz, satır okununca nokta söner.
//
// MADDE 2 — "footer menüsünde ... logo, açıklama, başlıkların ve sayfa isimlerinin sütunlara
//   ortalanmasını istiyorum ... Masaüstü görünümde 4 sütun olarak görünen bu kısım yine sütunlara
//   göre hizalansınlar." Yorum: hizalama HER genişlikte sütun içinde ORTALANMIŞ olacak (masaüstü
//   4 sütun, tablet/mobil 2 sütun).
//
//   Sütunlar EŞİT genişliğe çekildi: eski 1.3/0.9/1/1.15 oranları SOLA hizalı metin için
//   ayarlanmıştı; içerik ortalandığında gözle eşit duran şey sütun MERKEZLERİNİN eşit aralıklı
//   olmasıdır. text-align tek başına yetmez — logo bir flex kutusu, açıklama max-width taşıyan
//   bir blok, "Sen de Ekle" ise kendi text-align:left'ini yazan bir <button>; üçü de ayrıca
//   ortalanmalı, yoksa sütunda sola yapışık kalırlar.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const authModal = read('js/components/auth-modal.js');
const chrome = read('js/components/site-chrome.js');

console.log('\nmadde 1 — Bildirimler/Mesajlar açılır kapanır + turuncu nokta');

const BOXES = [
  { label: 'Bildirimler', collapse: 'am-notif-collapse', dot: 'am-notif-dot', list: 'am-dash-notifications', pag: 'am-notif-pagination' },
  { label: 'Mesajlar',    collapse: 'am-msg-collapse',   dot: 'am-msg-dot',   list: 'am-dash-messages',      pag: 'am-msg-pagination' },
];

test('iki kutu da panelin AÇILIR KAPANIR desenini kullanıyor (ayrı bir kanca yazılmamış)', () => {
  for (const b of BOXES) {
    assert.ok(
      authModal.includes(`<button type="button" class="dash-collapse-toggle" data-collapse="${b.collapse}" aria-expanded="true" aria-controls="${b.collapse}">`),
      `${b.label}: .dash-collapse-toggle düğmesi yok ya da varsayılan AÇIK değil`,
    );
    // Varsayılan AÇIK (2026-09-14): gövde hidden TAŞIMAMALI. Düğmenin aria-expanded'ı ile gövdenin
    // hidden'ı BİRBİRİYLE TUTARLI olmalı, aksi halde ilk tıklama kutuyu ters yöne çevirir
    // (wireCollapsibles durumu düğmeden okur, gövdeden değil).
    assert.ok(authModal.includes(`<div class="dash-collapse-body" id="${b.collapse}">`), `${b.label}: gövde açık başlamıyor`);
    assert.ok(!authModal.includes(`<div class="dash-collapse-body" id="${b.collapse}" hidden>`), `${b.label}: gövde hâlâ hidden`);
  }
  // wireCollapsibles TÜM data-collapse düğmelerini bağlar — yeni kutular için ek kod gerekmez.
  assert.match(authModal, /document\.querySelectorAll\('#am-panel \.dash-collapse-toggle\[data-collapse\]'\)/);
  // Eski (her zaman açık) işaretleme kalmamalı: kalırsa iki başlık satırı birden çizilir.
  assert.ok(!authModal.includes('<h2 style="margin:0;">Bildirimler</h2>'), 'eski Bildirimler başlığı duruyor');
  assert.ok(!authModal.includes('<h2 style="margin:0;">Mesajlar</h2>'), 'eski Mesajlar başlığı duruyor');
});

test('liste VE sayfalama kapanan gövdenin İÇİNDE (kapalı kutu yarım görünmez)', () => {
  for (const b of BOXES) {
    const start = authModal.indexOf(`<div class="dash-collapse-body" id="${b.collapse}">`);
    const body = authModal.slice(start, authModal.indexOf('</div>\n        </div>', start));
    assert.ok(body.includes(`id="${b.list}"`), `${b.label}: liste gövdenin dışında kalmış`);
    assert.ok(body.includes(`id="${b.pag}"`), `${b.label}: sayfalama gövdenin dışında kalmış`);
  }
});

test('turuncu nokta BAŞLIĞIN içinde (kapalıyken de görünen tek satır orası)', () => {
  for (const b of BOXES) {
    const needle = `<h2>${b.label}<span class="dash-alert-dot" id="${b.dot}"`;
    assert.ok(authModal.includes(needle), `${b.label}: nokta başlığın içinde değil`);
    // Ekran okuyucu için anlamı olmalı: salt dekoratif bir nokta değil, "okunmamış var" bilgisi.
    const tag = authModal.slice(authModal.indexOf(needle), authModal.indexOf('</h2>', authModal.indexOf(needle)));
    assert.match(tag, /role="img"/, `${b.label}: noktanın rolü yok`);
    assert.match(tag, /aria-label="Okunmamış/, `${b.label}: noktanın erişilebilir adı yok`);
    assert.match(tag, /hidden>/, `${b.label}: nokta hidden başlamıyor — okunmamış yokken de çizilir`);
  }
});

test('nokta gerçekten TURUNCU ve [hidden] açıkça yazılmış (display tuzağı)', () => {
  assert.match(authModal, /#am-panel \.dash-alert-dot\{[^}]*background:var\(--accent\)/, 'nokta --accent (turuncu) değil');
  assert.match(authModal, /#am-panel \.dash-alert-dot\{[^}]*display:inline-block/);
  assert.match(authModal, /#am-panel \.dash-alert-dot\[hidden\]\{display:none;\}/, '[hidden] kuralı yok — nokta hep görünür kalır');
  // .notif-dot ile AYNI renk kaynağı: iki yerde iki farklı turuncu olmasın.
  assert.match(authModal, /#am-panel \.notif-dot\{[^}]*background:var\(--accent\)/);
});

test('nokta satırların OKUNMADI durumundan besleniyor (ikinci bir sayaç yok)', () => {
  const fn = authModal.slice(authModal.indexOf('function refreshDashAlertDots()'));
  const body = fn.slice(0, fn.indexOf('\n    }'));
  assert.match(body, /set\('am-notif-dot', notifItems\.some\(n => n && !n\.is_read\)\)/);
  assert.match(body, /set\('am-msg-dot', msgItems\.some\(c => c && c\.unread\)\)/);
  assert.match(body, /el\.hidden = !has/, 'nokta hidden ile yönetilmiyor');
});

test('nokta HER durum değişiminde tazeleniyor: ilk çizim, okundu, boş liste', () => {
  // Bildirimler: render + satır okundu işaretlenince.
  const rn = authModal.slice(authModal.indexOf('function renderNotifications()'));
  assert.match(rn.slice(0, 400), /refreshDashAlertDots\(\);/, 'renderNotifications noktayı tazelemiyor');
  const mr = authModal.slice(authModal.indexOf('function markRead()'));
  assert.match(mr.slice(0, 600), /item\.is_read = true;\s*\n\s*refreshDashAlertDots\(\);/, 'okundu işaretinden sonra nokta tazelenmiyor');
  // Mesajlar: render BOŞ listede de çalışmalı, yani erken çıkıştan ÖNCE tazelenmeli.
  const rm = authModal.slice(authModal.indexOf('function renderMessages()'));
  const head = rm.slice(0, rm.indexOf('if (!msgItems.length)'));
  assert.match(head, /refreshDashAlertDots\(\);/, 'renderMessages erken çıkıştan önce tazelemiyor');
  // Mesaj satırı açılınca okundu sayılır — nokta orada da tazelenmeli.
  const click = rm.slice(rm.indexOf('.msg-conv-row'), rm.indexOf('renderDashPagination'));
  assert.match(click, /dot\.remove\(\);\s*\n\s*refreshDashAlertDots\(\);/, 'mesaj okunduğunda başlıktaki nokta tazelenmiyor');
});

console.log('\nmadde 3 — Profil Bilgileri / Firma-Marka Bilgileri: açılır kapanır, varsayılan AÇIK');

// KULLANICI İSTEĞİ, 2026-09-14: "Hesabım sayfasındaki profil bilgileri ve marka / firma bilgileri de
// açılır kapanır butonların içinde olsun ama default olarak açık gözüksünler."
//
// Bu iki kutuda Bildirimler/Mesajlar'da OLMAYAN bir tuzak var: başlığın yanında AYRI bir eylem
// düğmesi duruyor ("Profili Düzenle"). Aç/kapa düğmesi onu SARARSA <button> içinde <button>
// (ya da <button> içinde <a>) oluşur; tarayıcı bunu ayrıştırırken iç öğeyi dışarı taşır, yani
// düzen sessizce bozulur ve tıklamalar birbirine karışır. Test tam olarak bunu kilitliyor.
const HEAD_BOXES = [
  { label: 'Profil Bilgileri',        collapse: 'am-profile-collapse', body: 'am-profile-tab-facts', action: 'am-dash-edit-btn' },
  { label: 'Firma / Marka Bilgileri', collapse: 'am-firm-collapse',    body: 'am-firm-facts',        action: 'am-firm-edit-btn' },
];

test('iki kutu da AYNI açılır kapanır deseni kullanıyor ve varsayılan AÇIK', () => {
  for (const b of HEAD_BOXES) {
    assert.ok(
      authModal.includes(`data-collapse="${b.collapse}" aria-expanded="true" aria-controls="${b.collapse}"`),
      `${b.label}: aç/kapa düğmesi yok ya da varsayılan AÇIK değil`,
    );
    assert.ok(authModal.includes(`<div class="dash-collapse-body" id="${b.collapse}">`), `${b.label}: gövde açık başlamıyor`);
    assert.ok(!authModal.includes(`<div class="dash-collapse-body" id="${b.collapse}" hidden>`), `${b.label}: gövde hidden başlıyor`);
  }
});

test('kutunun İÇERİĞİ kapanan gövdenin içinde (kapalı kutu yarım görünmez)', () => {
  for (const b of HEAD_BOXES) {
    const start = authModal.indexOf(`<div class="dash-collapse-body" id="${b.collapse}">`);
    assert.ok(start > -1, `${b.label}: gövde bulunamadı`);
    const body = authModal.slice(start, authModal.indexOf('</div>\n        </div>', start));
    assert.ok(body.includes(`id="${b.body}"`), `${b.label}: içerik gövdenin dışında kalmış`);
  }
});

test('eylem düğmesi aç/kapa düğmesinin İÇİNDE DEĞİL (iç içe <button> geçersiz HTML)', () => {
  for (const b of HEAD_BOXES) {
    const tStart = authModal.indexOf(`data-collapse="${b.collapse}"`);
    const tEnd = authModal.indexOf('</button>', tStart);
    const toggle = authModal.slice(tStart, tEnd);
    assert.ok(!toggle.includes(`id="${b.action}"`), `${b.label}: "Profili Düzenle" aç/kapa düğmesinin içinde kalmış`);
    assert.ok(!/<button|<a\s/.test(toggle), `${b.label}: aç/kapa düğmesinin içinde başka bir etkileşimli öğe var`);
    // ...ama yine de AYNI başlık satırında durmalı (kutunun sağ üstündeki yerini korusun).
    assert.ok(authModal.slice(tStart - 400, tStart).includes('class="dash-section-head"'), `${b.label}: başlık satırı .dash-section-head değil`);
  }
});

test('başlık satırındaki aç/kapa düğmesi tam genişlik DEĞİL (eylem düğmesini itmesin)', () => {
  // Genel kural #am-panel .dash-collapse-toggle{width:100%} — eylem düğmesiyle aynı satırda
  // duran düğmeler bunu .dash-collapse-toggle-inline ile ezer.
  assert.match(authModal, /#am-panel \.dash-collapse-toggle-inline\{[^}]*width:auto/);
  for (const b of HEAD_BOXES) {
    const tStart = authModal.lastIndexOf('<button', authModal.indexOf(`data-collapse="${b.collapse}"`));
    const tag = authModal.slice(tStart, authModal.indexOf('>', tStart));
    assert.ok(tag.includes('dash-collapse-toggle-inline'), `${b.label}: düğmede dash-collapse-toggle-inline sınıfı yok`);
  }
});

// İstatistikler başlığı da bir .dash-section-head içinde aç/kapa düğmesi taşıyor ama BU TURDA
// değişmedi — yukarıdaki inline sınıfı ona uygulanmamalı, aksi halde istenmeyen bir görünüm
// değişikliği sessizce sızar.
test('İstatistikler başlığı bu turda DEĞİŞMEDİ (kapsam sızıntısı yok)', () => {
  const i = authModal.indexOf('data-collapse="am-stats-collapse am-stats-range"');
  assert.ok(i > -1, 'İstatistikler düğmesi bulunamadı');
  const tag = authModal.slice(authModal.lastIndexOf('<button', i), authModal.indexOf('>', i));
  assert.ok(!tag.includes('dash-collapse-toggle-inline'), 'İstatistikler düğmesine inline sınıfı sızmış');
  assert.ok(tag.includes('aria-expanded="false"'), 'İstatistikler varsayılan durumu değişmiş');
});


console.log('\nmadde 2 — footer menüsü sütunlara ortalanıyor');

test('masaüstü 4 sütun EŞİT (ortalanmış içerikte merkezler eşit aralıklı olur)', () => {
  assert.match(chrome, /\.footer-top\{grid-template-columns:repeat\(4, 1fr\); text-align:center;\}/);
  // Sola hizalı döneme ait eski oranlar kalmamalı: kalırsa merkezler eşit aralıklı olmaz.
  assert.ok(!chrome.includes('1.3fr 0.9fr 1fr 1.15fr'), 'eski sola-hizalı sütun oranları duruyor');
});

test('tablet/mobil AYNI ortalama, iki sütunda', () => {
  const block = chrome.slice(chrome.indexOf('@media (max-width: 860px)'));
  assert.match(block.slice(0, 500), /\.footer-top\{grid-template-columns: 1fr 1fr;/, 'tablet/mobil iki sütun değil');
  // Ortalama kuralları taban blokta yaşar; media bloğu text-align'ı geri sola çevirmemeli.
  assert.ok(!/\.footer-top\{[^}]*text-align:left/.test(chrome), 'bir kural hizayı sola geri çeviriyor');
});

test('text-align YETMEZ: logo, açıklama ve "Sen de Ekle" ayrıca ortalanıyor', () => {
  // Logo bir flex kutusu (.footer-logo{display:flex}) — text-align onu kıpırdatmaz.
  assert.match(chrome, /\.footer-top \.footer-logo\{justify-content:center;\}/, 'logo ortalanmıyor');
  // Açıklama max-width taşıyan bir blok — ortalanması için otomatik yan boşluk gerekir.
  assert.match(chrome, /\.footer-top \.footer-brand p\{margin-left:auto; margin-right:auto;\}/, 'açıklama ortalanmıyor');
  // "Sen de Ekle" bir <button> ve kendi kuralında text-align:left yazıyor.
  assert.match(chrome, /\.footer-top \.footer-add-content\{text-align:center;\}/, '"Sen de Ekle" ortalanmıyor');
  assert.match(chrome, /\.footer-add-content\{[^}]*text-align:left/, 'taban kural değişmiş — override artık gereksiz olabilir');
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
process.exit(failed ? 1 : 0);
