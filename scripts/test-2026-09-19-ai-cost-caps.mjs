// 2026-09-19 — Ücret doğurabilecek özellikler kapatıldı (CLAUDE.md "ÜCRETLİ KAYNAK KURALI").
// Kullanıcı istekleri (aynı gün, iki tur):
//   (a) Gündem otomatik toplama turu günde 6'dan 2'ye (TR 08:00 / 20:00).
//   (b) "Görsel aramayı ve yapay zeka ile akıllı aramayı kaldır ama arama çubuğu olduğu şekliyle
//       kalsın", "Bülteni iptal et ve ... footer menüsündeki bülten kısmını kaldır", "Yapay zeka ile
//       ekleyi kaldır", ve elle çalıştırılan AI'lı GitHub işlerine önlem.
// Bu dosya, bunlardan biri sessizce geri gelirse preflight'ı kırmızıya çevirir.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${String(e.message).split('\n').slice(0, 4).join('\n       ')}`); }
}

// ---- Worker'ı gerçek fetch() ile çağırmak (test-2026-09-17-malformed-url-5xx.mjs ile AYNI desen) --
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
const aiCalls = [];
const env = {
  DB: d1(db),
  AI: { async run(model) { aiCalls.push(model); return { response: '{}' }; } },
  ASSETS: { fetch: async () => new Response('<!doctype html><html><head></head><body></body></html>', { headers: { 'Content-Type': 'text/html' } }) },
};
async function call(method, path, body) {
  const realLog = console.log, realErr = console.error;
  console.log = () => {}; console.error = () => {};
  try {
    const init = { method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return await worker.fetch(new Request('https://mimarlab.com' + path, init), env, { waitUntil() {} });
  } finally { console.log = realLog; console.error = realErr; }
}

await test('Ücretli AI uçları 410 döner ve AI HİÇ çağrılmaz (akıllı arama, görsel arama, Yapay zeka ile ekle)', async () => {
  for (const [m, p, b] of [
    ['POST', '/api/ai/search', { query: 'bursa camileri' }],
    ['POST', '/api/ai/visual-search', {}],
    ['GET', '/api/ai/image-proxy?url=https://example.com/a.jpg'],
    ['POST', '/api/ai/extract', { url: 'https://example.com' }],
    ['POST', '/api/ai/copy-images', { urls: [] }],
  ]) {
    const res = await call(m, p, b);
    assert.equal(res.status, 410, `${p} -> ${res.status}`);
  }
  assert.equal(aiCalls.length, 0, `AI çağrıldı: ${aiCalls.join(', ')}`);
});

await test('/api/ai/image-embed (tarayıcıda hesaplanan CLIP, AI YOK) hâlâ yönlendiriliyor — /fotograf onu okur', async () => {
  const res = await call('POST', '/api/ai/image-embed', {});
  assert.notEqual(res.status, 410);
  assert.match(read('src/index.js'), /if \(path === '\/api\/ai\/image-embed'\) return handleImageEmbedAppendRoute/);
});

await test('Kaldırılan AI modülü geri gelmedi; index.js AI arama/görsel arama işleyicilerini içe aktarmıyor', () => {
  assert.ok(!existsSync(new URL('src/routes/ai.js', ROOT)), 'src/routes/ai.js silinmiş olmalı');
  const idx = read('src/index.js');
  assert.doesNotMatch(idx, /handleAiSearchRoute|handleVisualSearchRoute|handleImageProxyRoute|handleAiRoute/);
  assert.doesNotMatch(idx, /import \{ rebuildIndex \}/);
});

await test('İstemcide AI çağrısı kalmadı: arama çubuğu (görsel arama yok), /arama, proje-ekle, urun-ekle', () => {
  const chrome = read('js/components/site-chrome.js');
  assert.doesNotMatch(chrome, /fetch\(\s*['"`]\/api\/ai\/(visual-search|image-proxy)|id="nav-search-visual-btn"|id="nav-search-modal-image-/);
  assert.match(chrome, /nav-search/, 'metin arama çubuğu DURMALI');
  assert.doesNotMatch(read('arama.html'), /fetch\(\s*['"`]\/api\/ai\/search/);
  for (const f of ['proje-ekle.html', 'urun-ekle.html']) {
    const s = read(f);
    assert.doesNotMatch(s, /['"`]\/api\/ai\/extract|['"`]\/api\/ai\/copy-images|id="ai-panel"/, f);
  }
  assert.match(read('proje-ekle.html'), /fetch\(\s*['"`]\/api\/ai\/image-embed/, 'proje-ekle tarayıcı CLIP embedding\'i KORUMALI (/fotograf)');
  assert.doesNotMatch(read('urun-ekle.html'), /fetch\(\s*['"`]\/api\/ai\/image-embed/, 'ürün embedding\'i yalnızca görsel arama içindi');
});

await test('Bülten: gönderim kapalı, abonelik 410, footer formu yok, abonelikten çıkma çalışıyor', async () => {
  const nl = await import('../src/lib/newsletterNotify.js');
  assert.equal(nl.NEWSLETTER_ENABLED, false);
  let fetched = 0; const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetched++; return new Response('{}'); };
  try {
    const e = { ...env, RESEND_API_KEY: 'x' };
    await nl.notifyNewsletterOfNewContent(e, 'projects', { title: 'T', slug: 't', description: 'd' });
    await nl.notifyNewsletterOfNewGundem(e, { slug: 's', title: 'T', summary: 'x' });
  } finally { globalThis.fetch = realFetch; }
  assert.equal(fetched, 0, 'bülten e-postası gönderilmemeli');
  assert.equal((await call('POST', '/api/newsletter/subscribe', { email: 'a@b.co' })).status, 410);
  assert.equal((await call('GET', '/api/newsletter/unsubscribe?token=x')).status, 200);
  assert.doesNotMatch(read('js/components/site-chrome.js'), /fetch\(\s*['"`]\/api\/newsletter\/subscribe|class="footer-newsletter|function wireFooterNewsletter/);
});

await test('Görsel arama dizini cron\'u kapalı (tetikleyici + varsayılan runner yok)', () => {
  const w = read('wrangler.jsonc');
  assert.match(w, /"triggers": \{ "crons": \["0 5,17 \* \* \*"\] \}/);
  assert.doesNotMatch(read('src/index.js'), /^  visualIndex: /m);
});

await test('Gündem cron: günde İKİ tur (TR 08:00/20:00 = UTC 05/17); sağlık eşiği (30 saat) uyumlu', async () => {
  assert.match(read('scripts/test-gundem.mjs'), /const GUNDEM_CRON = '0 5,17 \* \* \*';/);
  const { GUNDEM_CRON_STALE_MS } = await import('../src/lib/gundemRuns.js');
  assert.ok(GUNDEM_CRON_STALE_MS > 12 * 60 * 60 * 1000);
});

await test('AI\'lı GitHub işleri: zamanlama YOK ve ONAYLIYORUM yazılmadan çalışmaz', () => {
  const dir = new URL('.github/workflows/', ROOT);
  for (const f of readdirSync(dir)) {
    const y = readFileSync(new URL(f, dir), 'utf8');
    const usesAi = /photo-space-classify-backfill\.mjs|gundem-retitle-backfill\.mjs|gundem-backfill\.mjs/.test(y);
    if (!usesAi) continue;
    assert.doesNotMatch(y, /^\s*schedule:/m, `${f}: AI işi zamanlanamaz`);
    assert.match(y, /\n      maliyet_onayi:\n[\s\S]*?required: true/, `${f}: maliyet_onayi girdisi yok`);
    const firstStep = (y.slice(y.indexOf('steps:')).match(/- name: ([^\n]+)/) || [])[1] || '';
    assert.ok(firstStep.startsWith('Maliyet onayı'), `${f}: onay İLK adım olmalı (ilk adım: ${firstStep})`);
    assert.match(y, /if \[ "\$\{ONAY\}" != "ONAYLIYORUM" \]; then/);
  }
});

console.log(`\n${failed ? 'BAŞARISIZ' : 'TAMAM'} — ${passed} geçti, ${failed} kaldı`);
if (failed) process.exit(1);
