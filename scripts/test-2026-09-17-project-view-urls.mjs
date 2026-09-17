#!/usr/bin/env node
// /proje-en-iyi-100 + /proje-harita görünüm adresleri, En İyi 100 tek sayfa, admin arşivinde kişi
// sıralaması ve proje-ekle'de Fotoğrafçı/Kaynak satırının yeri (2026-09-17, beşinci tur).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 4).join('\n       ')}`); }
}
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

globalThis.HTMLRewriter = class { on() { return this; } transform(res) { return res; } };
globalThis.caches = { default: { async match() { return undefined; }, async put() {} } };
const worker = (await import('../src/index.js')).default;
function d1(db) {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = db.prepare(sql).get(...params); if (r === undefined) return null; return col ? r[col] : { ...r }; },
    async all() { return { results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }; },
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(s) { return s; } };
}
const db = new DatabaseSync(':memory:');
db.exec(read('schema.sql'));

console.log('\n1 — Sunucu: görünüm adresleri /proje kabuğunu servis eder');
for (const path of ['/proje-en-iyi-100', '/proje-harita']) {
  await test(`${path} -> 200, kabuk /proje`, async () => {
    const asked = [];
    const env = { DB: d1(db), ASSETS: { fetch: async (req) => { asked.push(new URL(req.url).pathname); return new Response('<html><head></head><body></body></html>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }); } } };
    const origLog = console.log; console.log = () => {};
    let res;
    try { res = await worker.fetch(new Request('https://mimarlab.com' + path, { headers: { Accept: 'text/html' } }), env, { waitUntil() {}, passThroughOnException() {} }); }
    finally { console.log = origLog; }
    assert.equal(res.status, 200);
    assert.ok(asked.includes('/proje'), `istenen asset: ${asked.join(',')}`);
  });
}
await test('başlık/canonical yola göre yazılır + sitemap', () => {
  const s = read('src/index.js');
  assert.match(s, /'\/proje-en-iyi-100': \{ path: '\/proje-en-iyi-100'/);
  assert.match(s, /'\/proje-harita': \{ path: '\/proje-harita'/);
  assert.match(s, /\.on\('link#canonical-link'/);
  assert.match(s, /\{ loc: '\/proje-en-iyi-100'/);
  assert.match(s, /\{ loc: '\/proje-harita'/);
});

console.log('\n2 — İstemci: görünüm adresten okunur/yazılır, En İyi 100 tek sayfa');
await test('viewFromPath + listPagePath', () => {
  const s = read('js/pages/proje.js');
  assert.match(s, /const PROJECT_VIEW_PATHS = \{ top100: '\/proje-en-iyi-100', map: '\/proje-harita' \}/);
  assert.match(s, /return \(page > 1 && base === '\/proje'\) \? base \+ '\/sayfa-' \+ page : base;/);
  assert.match(s, /if \(!opts \|\| opts\.push !== false\) syncBrowserUrl\(true\);/);
  assert.match(s, /function bootList\(\)\{ applyInitialFiltersFromQuery\(\); buildSidebar\(\); bootView\(\); \}/);
});
await test('En İyi 100 sayfalanmaz', () => {
  const s = read('js/pages/proje.js');
  const block = s.slice(s.indexOf('if(top100ViewActive){\n    await loadTop100();'), s.indexOf('const params = currentQueryParams();\n  params.set(\'page\''));
  assert.match(block, /const pageItems = sorted;/);
  assert.match(block, /renderPagination\(1\);/);
  assert.doesNotMatch(block, /PAGE_SIZE/);
});

console.log('\n3 — Admin arşivi: kişiler de proje sayısına göre');
await test('sunucu + istemci', () => {
  assert.match(read('src/routes/admin.js'), /FROM architects a JOIN project_designers pd ON pd\.architect_id = a\.id/);
  assert.match(read('admin.html'), /archiveType === 'architects'\) items = items\.slice\(\)\.sort/);
});

console.log('\n4 — proje-ekle: Fotoğrafçı + Kaynak Görseller kutusunun en üst satırında');
await test('DOM sırası', () => {
  const s = read('proje-ekle.html');
  const h2 = s.indexOf('<h2>Görseller</h2>');
  const credit = s.indexOf('id="ac-credit-field"');
  const url = s.indexOf('id="credit-url-field"');
  const drop = s.indexOf('id="image-drop"');
  assert.ok(h2 > 0 && h2 < credit && credit < url && url < drop, `${h2} ${credit} ${url} ${drop}`);
  const between = s.slice(h2, credit);
  assert.doesNotMatch(between, /class="form-section"/);
});

console.log(`\n${failed ? 'BAŞARISIZ' : 'TAMAM'} — ${passed} geçti, ${failed} kaldı`);
if (failed) process.exit(1);
