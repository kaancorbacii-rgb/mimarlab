#!/usr/bin/env node
// KULLANICI BİLDİRİMİ, 2026-09-11 — "blurlu (önizleme) firma/proje popup'ları boş açılıyor"
// (e-postayla gönderilen /firma/<slug> linkleri tam bu yol). Kök neden: tarayıcının HTTP önbellek
// kilidi — aynı URL için takılı kalmış bir istek önbellek girdisini tutarken sonraki istekler ~20 sn
// bekliyordu; kilidi tutan ilk istek süresiz askıda kalabiliyordu. Bkz. js/components/modal-shell.js
// #ENTITY_STALL_TIMEOUT_MS yorumu.
//
// Bu test GERÇEK modal-shell.js dosyasını node:vm içinde (en küçük tarayıcı taklidiyle) çalıştırıp
// ModalShell.fetchEntity'nin sözleşmesini doğrular:
//   1) taze istek `cache:'no-store'` ile gider (tarayıcı önbelleğine/kilide hiç girmez)
//   2) ön-çekilmiş istek HİÇ yanıt vermezse ~5 sn sonra önbellek kırıcılı (`_r=`) yeni bir istekle
//      kurtarır — popup sonsuza kadar boş kalmaz
//   3) hızlı yanıt veren ön-çekim tüketilir, ikinci istek atılmaz (performans korunur)
//   4) önizleme 410 gövdesi ve gerçek 404 davranışı değişmez
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 5).join('\n       ')}`); }
}

const source = readFileSync(new URL('../js/components/modal-shell.js', import.meta.url), 'utf8');

function loadShell(fetchImpl, prefetch = {}) {
  const calls = [];
  const context = {
    __mlPrefetch: prefetch,
    history: { scrollRestoration: 'auto', state: null, pushState() {}, replaceState() {}, go() {} },
    document: {
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, appendChild() {} }),
      addEventListener() {}, removeEventListener() {},
      head: { appendChild() {} }, body: { appendChild() {}, classList: { add() {}, remove() {} }, style: {}, dataset: {} },
      documentElement: { style: {} },
    },
    location: { pathname: '/firma', search: '', href: 'https://mimarlab.com/firma', origin: 'https://mimarlab.com' },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {}, removeEventListener() {},
    fetch: (url, opts) => { calls.push({ url, opts: opts || null }); return fetchImpl(url, opts, calls.length); },
    setTimeout, clearTimeout, Promise, Response, URL, console, JSON, Date, Error,
  };
  // Tarayıcıda window === globalThis — modal-shell.js window.addEventListener/window.__mlPrefetch
  // gibi alanlara window üzerinden erişir, bu yüzden taklit de context'in kendisidir.
  context.globalThis = context;
  context.window = context;
  const window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'modal-shell.js' });
  assert.ok(window.ModalShell && typeof window.ModalShell.fetchEntity === 'function', 'ModalShell.fetchEntity yüklenmedi');
  return { shell: window.ModalShell, calls, window };
}

const okBody = { item: { name: 'Tümertekin Architects', slug: 'tumertekin-architects' }, preview: true };
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

console.log('fetchEntity — tarayıcı önbellek kilidi / takılma koruması');

await test("taze istek cache:'no-store' ile gider ve tek istekte biter", async () => {
  const { shell, calls } = loadShell(() => Promise.resolve(jsonRes(okBody)));
  const r = await shell.fetchEntity('/api/office/tumertekin-architects');
  assert.equal(r.status, 'ok');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/office/tumertekin-architects');
  assert.equal(calls[0].opts && calls[0].opts.cache, 'no-store');
});

await test('asla yanıt vermeyen ön-çekim ~5 sn sonra önbellek kırıcılı yeni istekle kurtarılır', async () => {
  const never = new Promise(() => {});
  const { shell, calls, window } = loadShell(() => Promise.resolve(jsonRes(okBody)), { '/api/office/tumertekin-architects': never });
  const t0 = Date.now();
  const r = await shell.fetchEntity('/api/office/tumertekin-architects');
  const elapsed = Date.now() - t0;
  assert.equal(r.status, 'ok', 'popup verisi gelmeli');
  assert.equal(r.item.name, 'Tümertekin Architects');
  assert.equal(calls.length, 1, 'yalnızca kurtarma isteği atılmalı (ön-çekim store\'dan geldi)');
  assert.match(calls[0].url, /^\/api\/office\/tumertekin-architects\?_r=\d+$/);
  assert.equal(calls[0].opts && calls[0].opts.cache, 'no-store');
  assert.ok(elapsed >= 4900 && elapsed < 7000, `beklenen ~5 sn, ölçülen ${elapsed} ms`);
  assert.deepEqual(Object.keys(window.__mlPrefetch), [], 'ön-çekim tek kullanımlık tüketilmeli');
});

await test('asla yanıt vermeyen TAZE istek de kurtarılır', async () => {
  const { shell, calls } = loadShell((url, opts, n) => (n === 1 ? new Promise(() => {}) : Promise.resolve(jsonRes(okBody))));
  const r = await shell.fetchEntity('/api/project/karakoy-gulluoglu');
  assert.equal(r.status, 'ok');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, '/api/project/karakoy-gulluoglu');
  assert.match(calls[1].url, /^\/api\/project\/karakoy-gulluoglu\?_r=\d+$/);
});

await test('hızlı ön-çekim tüketilir, ikinci istek atılmaz', async () => {
  const { shell, calls } = loadShell(() => { throw new Error('ağa çıkılmamalıydı'); }, { '/api/project/galataport': Promise.resolve(jsonRes({ item: { title: 'Galataport' } })) });
  const r = await shell.fetchEntity('/api/project/galataport');
  assert.equal(r.status, 'ok');
  assert.equal(calls.length, 0);
});

await test("önizleme 410 gövdesi 'preview', gövdesiz 404 'missing' döner (değişmedi)", async () => {
  const a = loadShell(() => Promise.resolve(jsonRes({ item: null, hidden: true, preview: true, previewTitle: 'X', previewSlug: 'x' }, 410)));
  const r1 = await a.shell.fetchEntity('/api/product/x');
  assert.equal(r1.status, 'preview');
  assert.equal(r1.previewTitle, 'X');
  const b = loadShell(() => Promise.resolve(new Response('', { status: 404 })));
  const r2 = await b.shell.fetchEntity('/api/product/yok');
  assert.equal(r2.status, 'missing');
  assert.equal(b.calls.length, 1, '404 kesin cevaptır, yeniden denenmez');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
