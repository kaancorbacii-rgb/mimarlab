#!/usr/bin/env node
// PERFORMANS DENETİMİ REGRESYONLARI (2026-09-12). Bu turda ölçülerek bulunan dört sorunun
// düzeltmesini sabitler; hepsi statik kaynak kontrolü (davranış tarafı headless Chromium ile canlı
// worker'a karşı ayrıca doğrulandı, bkz. commit mesajı):
//   A) proje popup'ı artık tembel yüklenebilir (preloadedOnly kalktı) — kişi/firma/marka/ürün/ana
//      sayfadan açılan bir /proje/:slug bağlantısı TAM SAYFA gezinme değil, aynı belgede popup.
//   B) ana sayfa karusellerindeki varlık kartları aynı belgede popup açar.
//   C) /api/projects/filters ve /api/ratings/bulk artık edge'de (caches.default) önbellekli.
//   D) detay uçlarındaki ardışık D1 turları paralel; rating-widget'ın document dinleyicisi birikmiyor.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('\nA) Proje popup\'ı tembel yüklenir (tam sayfa gezinme kalktı)');
const lazy = read('js/components/lazy-modals.js');
const lazyCode = stripComments(lazy);
test('ENTITY_MODULES.project artık preloadedOnly TAŞIMAZ', () => {
  assert.ok(!/preloadedOnly/.test(lazyCode), 'preloadedOnly bayrağı kodda kalmamalı (yalnızca yorumda tarihçesi durabilir)');
});
test('project modülü proje.html\'in bağımlılık zincirini deps olarak bildirir', () => {
  const m = lazyCode.match(/project:\s*\{[\s\S]*?\n\s{4}\},/);
  assert.ok(m, 'ENTITY_MODULES.project bloğu bulunamadı');
  const block = m[0];
  for (const dep of ['project-gallery.js', 'project-meta.js', 'project-actions.js', 'project-comments.js',
    'project-related.js', 'project-products.js', 'gallery.js', 'hotspot-tagger.js', 'image-hotspots.js',
    'rating-widget.js', 'il-ilce-data.js', 'analytics-beacon.js']) {
    assert.ok(block.includes(dep), `project.deps eksik: ${dep}`);
  }
  assert.ok(/parallelDeps:\s*true/.test(block), 'bağımlılıklar paralel indirilmeli');
});
test('dinamik bağımlılıklar async=false ile eklenir (indirme paralel, çalışma sırası korunur)', () => {
  assert.match(lazyCode, /dep\.async\s*=\s*false/);
});
test('sayfa kendi <script> etiketiyle yüklemişse modül İKİNCİ kez enjekte edilmez', () => {
  assert.match(lazyCode, /const pageScript = document\.querySelector\(`script\[src="\$\{modSrc\}"\]`\)/);
  // Sabitleme GEVŞETİLDİ (2026-09-12): satır artık CSS bağımlılığını da bekliyor
  // (`cssReady.then(waitForPageScript)` — bkz. proje popup'ının stilsiz açılma hatası ve
  // lazy-modals.js#loadCss). Testin amacı "sayfa kendi etiketini taşıyorsa modül İKİNCİ kez
  // enjekte EDİLMEZ, o etiketin çalışması beklenir"; bu, waitForPageScript'in o dalda
  // kullanılmasıyla doğrulanır — satırın birebir metniyle değil.
  assert.match(lazyCode, /if \(pageScript\) \{ pending\[key\] = [^;]*waitForPageScript/);
});
test('proje.html project-modal.js\'i hâlâ kendi etiketiyle yükler (ilk açılış hızı korunur)', () => {
  assert.match(read('proje.html'), /<script src="js\/components\/project-modal\.js" defer><\/script>/);
});
test('project-meta.js konum ayrıştırmasında sayfa-özel global\'e bağımlı değil', () => {
  const meta = stripComments(read('js/components/project-meta.js'));
  assert.match(meta, /typeof parseLocation === 'function'/);
  assert.match(meta, /typeof parseLocationFull === 'function'/);
  assert.ok(!/(?<![.\w$])parseLocation\(item\.location\)/.test(meta), 'korumasız parseLocation( çağrısı kalmamalı');
});

console.log('\nB) Ana sayfa karuselleri aynı belgede popup açar');
const home = stripComments(read('index.html'));
test('bento ızgarasına varlık bağlantısı tıklama dinleyicisi bağlı', () => {
  assert.match(home, /document\.querySelector\('\.bento-grid'\)\.addEventListener\('click'/);
  assert.match(home, /HOME_ENTITY_MODULE = \{ proje: 'project', kisi: 'architect', firma: 'office', marka: 'office', urun: 'product' \}/);
  assert.match(home, /LazyModals\.load\(HOME_ENTITY_MODULE\[m\[1\]\]\)/);
});
test('LazyModals yoksa ya da yükleme hata verirse tam sayfa gezinmeye düşülür', () => {
  assert.match(home, /if \(typeof LazyModals === 'undefined' \|\| !LazyModals\.load\) return;/);
  assert.match(home, /\.catch\(\(err\) => \{[^}]*window\.location\.href = href;/);
});
test('sayfalama yolları (/proje/sayfa-2) popup açmaz', () => {
  assert.match(home, /if \(!m \|\| \/\^sayfa-\\d\+\$\/\.test\(m\[2\]\)\) return;/);
});
test('kapanışta başlık/canonical geri yazılsın diye __mlSsrDefaults tanımlı', () => {
  assert.match(home, /window\.__mlSsrDefaults = window\.__mlSsrDefaults \|\|/);
  assert.match(home, /canonicalUrl: 'https:\/\/mimarlab\.com\/'/);
});
test('Gündem kartları normal gezinme olarak kalır (popup modülü yok)', () => {
  assert.ok(!/gundem: '/.test(home.match(/HOME_ENTITY_MODULE = \{[^}]*\}/)[0]), 'gündem eşlemeye girmemeli');
});

console.log('\nC) Edge önbelleği: /api/projects/filters + /api/ratings/bulk');
const pc = read('src/lib/publicCache.js');
test('/api/projects/filters önbelleklenebilir liste öneklerinde', () => {
  assert.match(pc, /const CACHEABLE_LIST_PREFIXES = \[[^\]]*'\/api\/projects\/filters'/);
  assert.match(pc, /DEFAULT_FIRST_PAGE_PATHS = \[[^\]]*'\/api\/projects\/filters\?buildStatus=built'/);
});
test('/api/ratings/bulk üç varyantı da CACHEABLE_PATHS\'te ve uzun TTL alıyor', () => {
  for (const t of ['project', 'product', 'material']) {
    assert.ok(pc.includes(`'/api/ratings/bulk?targetType=${t}'`), `ratings/bulk ${t} eksik`);
  }
  assert.match(pc, /pathname\.startsWith\('\/api\/ratings\/bulk\?'\)\) \? PUBLIC_LIST_CACHE_HEADERS/);
});
test('bulkRatings cachedPublicJson üzerinden servis edilir, hesap ayrı fonksiyonda', () => {
  const ratings = stripComments(read('src/routes/ratings.js'));
  assert.match(ratings, /return cachedPublicJson\(request, env, url\.pathname \+ url\.search, \(\) => computeBulkRatings\(env, targetType\)\)/);
  assert.match(ratings, /async function computeBulkRatings\(env, targetType\)/);
  // Tazelik: her puanlama yazımı invalidatePublicCache çağırmaya devam etmeli.
  assert.match(ratings, /await invalidatePublicCache\(env\)/);
});
test('filters ucu liste parmak izini geçirir (HIT yolunda bayat kalmasın)', () => {
  const proj = read('src/routes/project.js');
  const m = proj.match(/export async function handleProjectFiltersRoute[\s\S]*?\n\}/);
  assert.ok(m && /\}, \(\) => projectListFingerprint\(env\)\);/.test(m[0]), 'handleProjectFiltersRoute listFingerprint geçirmeli');
});

console.log('\nD) Ardışık D1 turları paralel + dinleyici birikimi yok');
test('adjacentEntity: prev/next ve sarma yedekleri paralel', () => {
  const adj = stripComments(read('src/lib/adjacentEntity.js'));
  assert.match(adj, /let \[prev, next\] = await Promise\.all\(\[/);
  assert.match(adj, /const \[wrapPrev, wrapNext\] = await Promise\.all\(\[/);
});
test('proje detayı: adjacent + katalog + hotspot + claimed tek Promise.all', () => {
  const proj = stripComments(read('src/routes/project.js'));
  assert.match(proj, /const \[adjacent, catalog, hotspots, claimed\] = await Promise\.all\(\[/);
  assert.ok(!/const catalog = await fetchProjectProducts/.test(proj), 'katalog artık ardışık await olmamalı');
});
test('ürün detayı: claimed kontrolü diğer sorgularla aynı Promise.all\'da', () => {
  const prod = stripComments(read('src/routes/product.js'));
  assert.match(prod, /const \[adjacent, owner, usedInProjects, users, claimedByProfile\] = await Promise\.all\(\[/);
  assert.match(prod, /item\.claimed = !!owner \|\| !!claimedByProfile;/);
});
test('kişi detayı: firma/kurucu/ham ad sorguları ve adjacent+claimed paralel', () => {
  const arch = stripComments(read('src/routes/architect.js'));
  assert.match(arch, /const \[officeRow, founderOfficeRowsRes, rawOfficeNames\] = await Promise\.all\(\[/);
  assert.match(arch, /photographedRes, adjacent, claimed\] = await Promise\.all\(\[/);
  assert.ok(!/const adjacent = await fetchAdjacentArchitect/.test(arch));
});
test('firma detayı: önceki/sonraki sorgusu yedek sorguyla paralel başlatılır', () => {
  const off = stripComments(read('src/routes/office.js'));
  assert.match(off, /const adjacentPromise = fetchAdjacentOffice\(env, o\.id, isBrand\);/);
  assert.match(off, /const adjacent = await adjacentPromise;/);
});
test('rastgele yedek havuzları tek sorguda (ayrı "başlangıç noktası" turu yok)', () => {
  const arch = stripComments(read('src/routes/architect.js'));
  const off = stripComments(read('src/routes/office.js'));
  assert.ok(!/AS s FROM architects`\)\.first\('s'\)/.test(arch), 'architects: ayrı start sorgusu kalmamalı');
  assert.ok(!/AS s FROM offices`\)\.first\('s'\)/.test(off), 'offices: ayrı start sorgusu kalmamalı');
  assert.match(arch, /id >= \(SELECT abs\(random\(\)\) % \(COALESCE\(MAX\(id\), 0\) \+ 1\) FROM architects\)/);
  assert.match(off, /o2\.id >= \(SELECT abs\(random\(\)\) % \(COALESCE\(MAX\(id\), 0\) \+ 1\) FROM offices\)/);
});
test('rating-widget: kopuk düğmelerin ratingchange dinleyicileri sökülür', () => {
  const rw = stripComments(read('rating-widget.js'));
  assert.match(rw, /const RATE_CHANGE_HANDLERS = new Map\(\);/);
  assert.match(rw, /if\(!el\.isConnected\)\{ document\.removeEventListener\('mimarlab:ratingchange', handler\);/);
  assert.match(rw, /for\(const \[oldEl, oldHandler\] of RATE_CHANGE_HANDLERS\)/);
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) {
  for (const f of failures) console.error(`  - ${f.name}: ${f.message}`);
  process.exit(1);
}
