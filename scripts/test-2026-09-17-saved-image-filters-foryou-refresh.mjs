#!/usr/bin/env node
// 2026-09-17 — ÜÇ MADDE:
//  1. Koleksiyonum > Kaydettiklerim'de GÖRSEL satırı proje pop-up'ı DEĞİL yalnızca lightbox açar.
//  2. Hesabım/Koleksiyonum/Aktivitelerim kutularındaki filtre satırları mobilde tek satır + yatay
//     kaydırma, kutunun dışına taşmaz.
//  3. Ana sayfadaki "Senin İçin" kullanıcı etkileşim yaptıkça kendini tazeler.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

console.log('1 — Kaydettiklerim görsel satırı lightbox açar');

await test('Koleksiyonum: görsel satırı HREF taşımaz (a[href] yakalayıcılarına düşmez)', () => {
  const s = read('js/components/auth-modal.js');
  const fn = s.slice(s.indexOf('function renderColSaved()'), s.indexOf('async function loadColSaved()'));
  assert.match(fn, /it\.item_type === 'image'\s*\n?\s*\? `<a class="saved-row-link saved-row-image" role="button"/);
  const imageBranch = fn.slice(fn.indexOf('saved-row-image" role'), fn.indexOf(': `<a class="saved-row-link" href='));
  assert.ok(!/href=/.test(imageBranch), 'görsel dalı href taşımamalı — proje pop-up açılırdı');
  assert.match(fn, /openSavedImageLightbox\(link\.dataset\.imageSrc/);
});

await test('Koleksiyonum: lightbox modülü yoksa tembel yüklenir, yüklenemezse görsel yeni sekmede', () => {
  const s = read('js/components/auth-modal.js');
  const fn = s.slice(s.indexOf('function openSavedImageLightbox('), s.indexOf('function openSavedImageLightbox(') + 1500);
  assert.match(fn, /window\.ImageLightbox\.open\(src/);
  assert.match(fn, /script\.src = '\/js\/components\/image-lightbox\.js'/);
  assert.match(fn, /window\.open\(src, '_blank', 'noopener'\)/);
});

await test('hesabim.html: görsel satırı data-lightbox-src ile açılır, href yok', () => {
  const s = read('hesabim.html');
  assert.match(s, /it\.item_type === 'image'\s*\n?\s*\? `<a class="saved-row-link" role="button" tabindex="0" data-lightbox-src=/);
  assert.match(s, /<script src="js\/components\/image-lightbox\.js" defer><\/script>/);
});

console.log('\n2 — filtre satırları mobilde tek satır + kaydırma');

function mobileBlock(src, marker) {
  const i = src.indexOf(marker);
  assert.ok(i >= 0, 'mobil filtre kuralı bulunamadı');
  return src.slice(i, src.indexOf('}\n', src.indexOf('white-space:nowrap;}', i)) + 1);
}
for (const [file, prefix] of [['js/components/auth-modal.js', '#am-panel '], ['hesabim.html', '']]) {
  await test(`${file}: .saved-filter + .submissions-toolbar-row mobilde nowrap + overflow-x:auto`, () => {
    const s = read(file);
    const block = mobileBlock(s, `${prefix}.saved-filter, ${prefix}.submissions-toolbar-row{`);
    const before = s.slice(0, s.indexOf(`${prefix}.saved-filter, ${prefix}.submissions-toolbar-row{`));
    assert.match(before.slice(before.lastIndexOf('@media')), /^@media \(max-width:720px\)\{/);
    assert.match(block, /flex-wrap:nowrap/);
    assert.match(block, /overflow-x:auto/);
    assert.match(block, /max-width:100%/);
    assert.match(block, /flex:0 0 auto; white-space:nowrap;/);
  });
}
await test('auth-modal.js: saved-filter-scroll mobilde kutu kenarına uzanmaz (negatif margin sıfır)', () => {
  const s = read('js/components/auth-modal.js');
  assert.match(s, /@media \(max-width:720px\)\{[\s\S]{0,700}#am-panel \.saved-filter-scroll\{margin-inline:0; padding-inline:0;/);
});
await test('auth-modal.js: enjekte edilen CSS şablonunda ters tırnak yok (dosya çalışır)', () => {
  const s = read('js/components/auth-modal.js');
  assert.doesNotThrow(() => new vm.Script(s));
});

console.log('\n3 — "Senin İçin" canlı tazeleme');

function extractRefreshRuntime() {
  const s = read('index.html');
  const start = s.indexOf('const FORYOU_SIGNAL_PATH_RE');
  const end = s.indexOf("window.addEventListener('pageshow'", start);
  assert.ok(start > 0 && end > start, 'tazeleme bloğu bulunamadı');
  return s.slice(start, s.indexOf('\n', end) + 1);
}
function makeSandbox({ visibility = 'visible' } = {}) {
  const calls = [];
  const listeners = {};
  const timers = [];
  const sandbox = {
    location: { origin: 'https://mimarlab.com' },
    URL,
    document: { visibilityState: visibility, addEventListener: (t, f) => { listeners['doc:' + t] = f; } },
    setTimeout: (f) => { timers.push(f); return timers.length; },
    clearTimeout: () => { timers.length = 0; },
    Date,
    loadForYou: (opts) => { calls.push(opts); return Promise.resolve(); },
    foryouStarted: true,
  };
  sandbox.window = {
    fetch: (input, init) => Promise.resolve({ ok: !(init && init.fail) }),
    addEventListener: (t, f) => { listeners['win:' + t] = f; },
  };
  vm.createContext(sandbox);
  vm.runInContext('var foryouStarted = true;\n' + extractRefreshRuntime().replace(/^const |^let /gm, 'var '), sandbox);
  return { sandbox, calls, timers, listeners };
}
const flush = () => new Promise((r) => setImmediate(r));

await test('başarılı kaydet/takip/beğeni/paylaşım/yorum yazımı tazelemeyi planlar', async () => {
  for (const [url, method] of [['/api/saved', 'POST'], ['/api/saved/image/https%3A%2F%2Fx', 'DELETE'], ['/api/follows', 'POST'], ['/api/ratings', 'POST'], ['/api/shares', 'POST'], ['/api/comments', 'POST']]) {
    const { sandbox, timers } = makeSandbox();
    await sandbox.window.fetch(url, { method });
    await flush();
    assert.equal(timers.length, 1, `${method} ${url} tazeleme planlamadı`);
  }
});
await test('GET, başarısız yanıt ve sinyal dışı uç tazeleme PLANLAMAZ', async () => {
  for (const [url, init] of [['/api/saved', undefined], ['/api/saved', { method: 'POST', fail: true }], ['/api/collections', { method: 'POST' }], ['/api/foryou', { method: 'POST' }]]) {
    const { sandbox, timers } = makeSandbox();
    await sandbox.window.fetch(url, init);
    await flush();
    assert.equal(timers.length, 0, `${url} gereksiz tazeleme planladı`);
  }
});
await test('art arda etkileşimler TEK tazeleme üretir (debounce) ve refresh:true ile çağrılır', async () => {
  const { sandbox, timers, calls } = makeSandbox();
  for (let i = 0; i < 5; i++) await sandbox.window.fetch('/api/saved', { method: 'POST' });
  await flush();
  assert.equal(timers.length, 1);
  timers[0]();
  assert.deepEqual(calls.map((c) => ({ ...c })), [{ refresh: true }]);
});
await test('sekme gizliyken erteler, görünür olunca tazeler', async () => {
  const { sandbox, timers, listeners } = makeSandbox({ visibility: 'hidden' });
  await sandbox.window.fetch('/api/ratings', { method: 'POST' });
  await flush();
  assert.equal(timers.length, 0);
  sandbox.document.visibilityState = 'visible';
  listeners['doc:visibilitychange']();
  assert.equal(timers.length, 1);
});
await test('sarmalayıcı özgün yanıtı aynen döndürür', async () => {
  const { sandbox } = makeSandbox();
  const res = await sandbox.window.fetch('/api/saved', { method: 'POST' });
  assert.equal(res.ok, true);
});
await test('tazeleme hatası ekrandaki kartları silmez; bölüm DOM\'dan kaldırılmaz', () => {
  const s = read('index.html');
  const fn = s.slice(s.indexOf('async function loadForYou(opts)'), s.indexOf('let foryouPendingSaveWire'));
  assert.ok(!/section\.remove\(\)/.test(fn), 'section.remove() tazelemeyle geri getirilemez');
  assert.match(fn, /const hideSection = \(\) => \{ if\(!refresh\) section\.hidden = true; \};/);
});

console.log('\n4 — Admin > Arşiv: firmalar proje sayısına göre çoktan aza');

await test('sunucu arşivdeki firmalara projectCount ekleyip azalan sıralar', () => {
  const s = read('src/routes/admin.js');
  const block = s.slice(s.indexOf("if (typeKey === 'offices' && status === 'archived' && items.length)"), s.indexOf('return json({ items });', s.indexOf("status === 'archived' && items.length")));
  assert.ok(block.length > 0, 'arşiv sıralama bloğu yok');
  assert.match(block, /FROM offices o JOIN project_designers pd ON pd\.office_id = o\.id/);
  assert.match(block, /item\.projectCount = /);
  assert.match(block, /items\.sort\(\(a, b\) => b\.projectCount - a\.projectCount\)/);
});
await test('admin.html arşiv firma listesini aynı anahtarla sıralar ve sayıyı gösterir', () => {
  const s = read('admin.html');
  assert.match(s, /if\(archiveType === 'offices' \|\| archiveType === 'brands'\) items = items\.slice\(\)\.sort\(\(a, b\) => \(b\.projectCount \|\| 0\) - \(a\.projectCount \|\| 0\)\)/);
  assert.match(s, /rows\.push\(\['Proje', String\(item\.projectCount\)\]\)/);
});

console.log(`\n${failed ? 'BAŞARISIZ' : 'TAMAM'} — ${passed} geçti, ${failed} kaldı`);
if (failed) { for (const f of failures) console.error(` - ${f.name}: ${f.message}`); process.exit(1); }
