#!/usr/bin/env node
// SİTE YAYIN DENETİM LİSTESİ — BİRİM TESTLERİ
// (kullanıcı isteği, 2026-09-13: ekli 20 maddelik "vibe coded website" kontrol listesi.)
//
// Listenin ÇOĞU madde zaten karşılanıyordu (meta başlık/açıklama, favicon, robots.txt, sitemap,
// mobil kırılma noktaları, yükleniyor/hata durumları, gizlilik/şartlar sayfaları, analytics,
// sıkıştırılmış görseller). Bu test, o turda KAPATILAN üç boşluğu ve zaten sağlanan ölçülebilir
// maddeleri birlikte kelepçeler — hepsi sessizce geri alınabilecek türden:
//
//   1. ÖZEL 404 — /404.html silinirse ya da notFoundPageResponse gömülü yedeğe düşerse kimse fark
//      etmez; kullanıcı markasız bir "Not Found" görür.
//   2. ÇEREZ ONAYI — bir sayfaya yeniden gtag parçacığı yapıştırmak, bandı ANLAMSIZ kılar:
//      analitik onaydan önce yüklenmeye başlar. Bu en sessiz regresyon; test bunu yasaklar.
//   3. OG GÖRSELİ — yeni bir sayfa eklerken og:image unutmak paylaşımda çıplak bağlantı demektir.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const pages = readdirSync(root).filter(f => f.endsWith('.html'));

console.log('\nmadde 1 — özel 404 sayfası');

await test('404.html var; noindex, kendi başlığı ve arama kutusu taşıyor', () => {
  const s = read('404.html');
  assert.match(s, /<meta name="robots" content="noindex, follow">/);
  assert.match(s, /<title>Sayfa Bulunamadı \(404\) — MİMARLAB<\/title>/);
  // Arama formu JS'siz de çalışmalı: bulunamadı sayfasında ikinci bir JS bağımlılığı doğru olmaz.
  assert.match(s, /<form class="nf-search" action="\/arama" method="get"/);
  // Sitenin gerçek header/footer bileşeni — "kopuk" bir 404 sayfası olmasın.
  assert.ok(s.includes('site-header-mount') && s.includes('site-footer-mount'));
  // 404'ün kanonik adresi yoktur; canonical/og:url yazmak yanlış sinyaldir.
  assert.ok(!s.includes('rel="canonical"'), '404 sayfasında canonical olmamalı');
});

await test('notFoundPageResponse GERÇEK /404.html dosyasını servis ediyor (gömülü yedek duruyor)', () => {
  const s = read('src/index.js');
  assert.match(s, /async function notFoundPageResponse\(request, env\)/);
  assert.ok(s.includes("new URL('/404.html'"), '404.html asset olarak okunmuyor');
  assert.ok(s.includes('function notFoundFallbackResponse()'), 'gömülü yedek kaldırılmış');
  // Her çağıran taraf request+env geçirmeli; parametresiz bir çağrı sessizce yedeğe düşerdi.
  assert.ok(!/notFoundPageResponse\(\)/.test(s), 'parametresiz notFoundPageResponse çağrısı kalmış');
});

console.log('\nmadde 17/18 — çerez bandı ve analitiğin onaya bağlanması');

await test('HİÇBİR sayfa gtag/analytics betiğini doğrudan yüklemiyor', () => {
  const offenders = pages.filter(f => /<script[^>]*googletagmanager/.test(read(f)));
  assert.deepEqual(offenders, [], `bu sayfalar analitiği onaydan ÖNCE yüklüyor: ${offenders.join(', ')}`);
  const inline = pages.filter(f => /gtag\('config'/.test(read(f)));
  assert.deepEqual(inline, [], `gömülü gtag config kalmış: ${inline.join(', ')}`);
});

await test('analitik YALNIZCA onaydan sonra yükleniyor (tek yükleme noktası)', () => {
  const s = read('js/components/site-chrome.js');
  assert.ok(s.includes("var GA_ID = 'G-L4902Z57B8';"), 'ölçüm kimliği kayıp');
  assert.ok(s.includes('function loadAnalytics()'), 'yükleyici yok');
  // Yükleyici SADECE onay yollarından çağrılmalı: writeConsent(kabul) ve initConsent(saklı onay).
  const calls = s.match(/loadAnalytics\(\)/g) || [];
  assert.equal(calls.length, 3, `loadAnalytics çağrı sayısı beklenenden farklı (tanım + 2 onay yolu): ${calls.length}`);
  assert.ok(s.includes("if(analytics) loadAnalytics();"), 'onay verilince yüklenmiyor');
  assert.ok(s.includes('if(stored){ if(stored.analytics) loadAnalytics(); return; }'), 'saklı onay okunmuyor');
});

await test('bant Kabul Et / Reddet düğmelerini ve politika bağlantısını taşıyor', () => {
  const s = read('js/components/site-chrome.js');
  assert.ok(s.includes('cc-accept') && s.includes('Kabul Et'));
  assert.ok(s.includes('cc-reject') && s.includes('Reddet'));
  assert.ok(s.includes('/cerez-politikasi'), 'çerez politikası bağlantısı yok');
  // Bant role="dialog" OLMAMALI: odağı hapsedip sayfayı erişilemez kılardı.
  assert.ok(!s.includes("bar.setAttribute('role', 'dialog')"), 'bant odak tuzağı kuruyor');
});

await test('onay GERİ ALINABİLİR ve kutu İKİ kopyada da basılıyor', () => {
  const chrome = read('js/components/site-chrome.js');
  assert.ok(chrome.includes('reopen:'), 'tercih yeniden açılamıyor');
  // GERÇEK BULGU: /cerez-politikasi kullanıcıya info-modal.js#cerezTemplate POPUP'ını gösterir,
  // statik dosyayı değil. Kutu YALNIZCA statik dosyada olsaydı çoğu kullanıcı onu hiç görmezdi.
  for (const f of ['cerez-politikasi.html', 'js/components/info-modal.js']) {
    const s = read(f);
    assert.ok(s.includes('data-cookie-pref-state'), `${f}: durum metni yok`);
    assert.ok(s.includes('data-cookie-pref-btn'), `${f}: tercih düğmesi yok`);
  }
  // Mantık TEK yerde: iki kopyada da sayfaya özel bir betik olmamalı.
  assert.ok(!read('cerez-politikasi.html').includes('MimarlabConsent.reopen()'), 'statik kopyada ikinci bir bağlama var');
  assert.ok(chrome.includes('[data-cookie-pref-btn]'), 'delege dinleyici yok');
  // Kutunun CSS'i de global olmalı; popup, açık olan SAYFANIN CSS'i altında render edilir.
  assert.ok(chrome.includes('.cookie-pref{'), 'kutu stili global değil (popup stilsiz çıkar)');
});

console.log('\nmadde 2/3/5/8 — her sayfada meta başlık, açıklama, favicon, OG görseli');

await test(`${pages.length} sayfanın TAMAMI title + description + favicon + og:image taşıyor`, () => {
  const missing = { title: [], description: [], favicon: [], ogImage: [] };
  for (const f of pages) {
    const s = read(f);
    if (!/<title[^>]*>/.test(s)) missing.title.push(f);
    if (!/<meta name="description"/.test(s)) missing.description.push(f);
    if (!/rel="icon"/.test(s)) missing.favicon.push(f);
    if (!/property="og:image"/.test(s)) missing.ogImage.push(f);
  }
  for (const [k, v] of Object.entries(missing)) assert.deepEqual(v, [], `${k} eksik: ${v.join(', ')}`);
});

console.log('\nmadde 6/7/15/16 — robots, sitemap, gizlilik, şartlar');

await test('robots.txt sitemap işaret ediyor ve /api kapalı', () => {
  const s = read('robots.txt');
  assert.match(s, /Sitemap: https:\/\/mimarlab\.com\/sitemap\.xml/);
  assert.match(s, /Disallow: \/api\//);
});

await test('/sitemap.xml Worker rotası duruyor', () => {
  assert.ok(read('src/index.js').includes("url.pathname === '/sitemap.xml'"));
});

await test('gizlilik politikası, hizmet şartları ve çerez politikası sayfaları yayında', () => {
  for (const f of ['gizlilik-politikasi.html', 'hizmet-sartlari.html', 'cerez-politikasi.html']) {
    assert.ok(read(f).length > 2000, `${f} boş/eksik`);
  }
  // Üçü de footer'dan erişilebilir olmalı — yalnızca dosyanın var olması yetmez.
  const chrome = read('js/components/site-chrome.js');
  for (const href of ['/gizlilik-politikasi', '/hizmet-sartlari', '/cerez-politikasi']) {
    assert.ok(chrome.includes(href), `footer'da ${href} bağlantısı yok`);
  }
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) { for (const f of failures) console.error(`- ${f.name}: ${f.message}`); process.exit(1); }
