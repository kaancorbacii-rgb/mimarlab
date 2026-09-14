#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-14 — "Bir kişi veya firma popupı açıp profilde değişiklik yapıp kaydet
// butonuna tıkladığımızda değişiklikler otomatik olarak popupa yansısın."
//
// Kaydetme, düzenleme formundan popup URL'ine TAM SAYFA dönüş yapar (kisi-ekle.html / firma-ekle.html
// #location.replace) ve popup o kaydı ÜÇ önbellek katmanının arkasından okuyabilir:
// SSR HTML'ine gömülü #ml-list-data (__mlPrefetch), Worker'ın PoP-başına caches.default girdisi ve
// tarayıcının kendi HTTP önbelleği. Bkz. js/components/modal-shell.js#consumeFreshEntityMarker.
//
// KAPSAM:
//   1. markEntityFresh + fetchEntity sözleşmesi (işaret tüketilir, ön-çekim atılır, `_fresh=1` gider)
//   2. işaret YOLA ÖZEL ve TEK KULLANIMLIK (başka varlık / ikinci okuma etkilenmez)
//   3. üç *-ekle sayfası dönüşten önce işareti DOĞRU detay uç yoluyla koyuyor
//   4. sunucu tarafı: `?_fresh=1` yalnızca OTURUM AÇMIŞ istekte önbellek okumasını atlıyor
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 5).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('js/components/modal-shell.js', root), 'utf8');

// scripts/test-2026-09-11-entity-stall-retry.mjs#loadShell ile AYNI taklit — tek farkı, sessionStorage
// gerçek bir Map gibi davranıyor (işaretin yazılıp okunduğu yer burası).
function loadShell(fetchImpl, prefetch = {}) {
  const calls = [];
  const store = new Map();
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
    location: { pathname: '/kisi', search: '', href: 'https://mimarlab.com/kisi', origin: 'https://mimarlab.com' },
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    },
    addEventListener() {}, removeEventListener() {},
    fetch: (url, opts) => { calls.push({ url, opts: opts || null }); return fetchImpl(url, opts, calls.length); },
    setTimeout, clearTimeout, Promise, Response, URL, console, JSON, Date, Error,
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'modal-shell.js' });
  assert.ok(context.ModalShell && typeof context.ModalShell.markEntityFresh === 'function', 'ModalShell.markEntityFresh yüklenmedi');
  return { shell: context.ModalShell, calls, window: context, store };
}

const okBody = { item: { name: 'Kaan Çorbacı', slug: 'kaan-corbaci' } };
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const PATH = '/api/architect/kaan-corbaci';

section('1) markEntityFresh + fetchEntity sözleşmesi');

await test('işaretli yolda gömülü/ön-çekilmiş yanıt ATILIR ve istek `_fresh=1` ile gider', async () => {
  // Ön-çekim kasten ESKİ gövdeyi taşır (SSR HTML'ine gömülü #ml-list-data senaryosu) — kullanılırsa
  // popup kaydedilmemiş hâli gösterir.
  const stale = Promise.resolve(jsonRes({ item: { name: 'Kaan Çorbacı', slug: 'kaan-corbaci', about: 'ESKİ' } }));
  const { shell, calls, window } = loadShell(() => Promise.resolve(jsonRes(okBody)), { [PATH]: stale });
  shell.markEntityFresh(PATH);
  const r = await shell.fetchEntity(PATH);
  assert.equal(r.status, 'ok');
  assert.equal(r.item.about, undefined, 'bayat ön-çekim kullanılmamalı');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${PATH}?_fresh=1`);
  assert.equal(calls[0].opts && calls[0].opts.cache, 'no-store');
  assert.equal(window.__mlPrefetch[PATH], undefined, 'ön-çekim kaydı silinmeli');
});

await test('işaret yokken davranış DEĞİŞMEZ (çıplak yol, ön-çekim tüketilir)', async () => {
  const { shell, calls } = loadShell(() => Promise.resolve(jsonRes(okBody)));
  const r = await shell.fetchEntity(PATH);
  assert.equal(r.status, 'ok');
  assert.equal(calls[0].url, PATH, '`_fresh` yalnızca işaretli okumada eklenmeli');
});

section('2) işaret yola özel ve tek kullanımlık');

await test('BAŞKA bir varlığın popup\'ı işareti tüketmez', async () => {
  const { shell, calls, store } = loadShell(() => Promise.resolve(jsonRes(okBody)));
  shell.markEntityFresh(PATH);
  await shell.fetchEntity('/api/office/mimarlab');
  assert.equal(calls[0].url, '/api/office/mimarlab');
  assert.equal(store.get('mimarlab:freshEntity'), PATH, 'işaret yerinde kalmalı');
});

await test('aynı yol İKİNCİ kez okunduğunda `_fresh` gitmez (tek kullanımlık)', async () => {
  const { shell, calls } = loadShell(() => Promise.resolve(jsonRes(okBody)));
  shell.markEntityFresh(PATH);
  await shell.fetchEntity(PATH);
  await shell.fetchEntity(PATH);
  assert.equal(calls[0].url, `${PATH}?_fresh=1`);
  assert.equal(calls[1].url, PATH);
});

await test('takılan ilk denemenin kurtarma isteği `_fresh`i KORUR (yeniden denemede de taze okunmalı)', async () => {
  const never = new Promise(() => {});
  let first = true;
  const { shell, calls } = loadShell(() => {
    if (first) { first = false; return never; }
    return Promise.resolve(jsonRes(okBody));
  });
  shell.markEntityFresh(PATH);
  const r = await shell.fetchEntity(PATH);
  assert.equal(r.status, 'ok');
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /^\/api\/architect\/kaan-corbaci\?_r=\d+&_fresh=1$/);
});

await test('sessionStorage kapalıysa (private mode) hata fırlamaz, eski davranış sürer', async () => {
  const { shell, calls, window } = loadShell(() => Promise.resolve(jsonRes(okBody)));
  window.sessionStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  shell.markEntityFresh(PATH);
  const r = await shell.fetchEntity(PATH);
  assert.equal(r.status, 'ok');
  assert.equal(calls[0].url, PATH);
});

section('3) *-ekle sayfaları dönüşten önce işareti koyuyor');

// marka-ekle.html SİLİNDİ (kullanıcı isteği, 2026-09-14 madde 4) — listeden çıkarıldı.
for (const [file, apiPrefix] of [['kisi-ekle.html', '/api/architect/'], ['firma-ekle.html', '/api/office/']]) {
  await test(`${file}: kaydet -> popup dönüşünden önce markEntityFresh('${apiPrefix}<slug>')`, () => {
    const src = readFileSync(new URL(file, root), 'utf8');
    const marker = src.indexOf(`ModalShell.markEntityFresh(\`${apiPrefix}\${encodeURIComponent(finalSlug)}\`)`);
    assert.ok(marker > -1, 'markEntityFresh çağrısı yok');
    const redirect = src.indexOf('window.location.replace(`/', marker);
    assert.ok(redirect > marker, 'işaret, dönüşten ÖNCE konmalı');
  });
}

section('4) sunucu: `?_fresh=1` kapısı');

const publicCache = readFileSync(new URL('src/lib/publicCache.js', root), 'utf8');
await test('bayrak yalnızca OTURUM AÇMIŞ istekte geçerli (anonim önbellek atlayamaz)', () => {
  assert.match(publicCache, /const forceFresh = !!sessionUser && requestsFreshRead\(request\);/);
  assert.match(publicCache, /searchParams\.get\('_fresh'\) === '1'/);
});
await test('forceFresh önbellek OKUMASINI ve 304 kısa devresini atlar, MISS yolu girdiyi TAZELER', () => {
  assert.match(publicCache, /const cached = forceFresh \? null : await caches\.default\.match\(cacheKey\);/);
  assert.match(publicCache, /if \(etag && !forceFresh\) \{/);
  // caches.default.put MISS yolunda koşulsuz çalışır — bayat girdinin üzerine yazılması bu satırla olur.
  assert.match(publicCache, /await caches\.default\.put\(cacheKey, response\.clone\(\)\)/);
});
await test('oturum bir kez çözülüyor (isAdminRequest ikinci bir getSessionUser çağrısı yapmıyor)', () => {
  assert.doesNotMatch(publicCache, /async function isAdminRequest/);
  assert.equal((publicCache.match(/await getSessionUser\(/g) || []).length, 1);
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) { for (const f of failures) console.error(`- ${f.name}: ${f.message.split('\n')[0]}`); process.exit(1); }
