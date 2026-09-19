// 2026-09-19 — Ücret doğurabilecek iki AI yolu kısıldı (CLAUDE.md "ÜCRETLİ KAYNAK KURALI").
// Kullanıcı isteği: sitede ücret doğurabilecek özellikler listelendi; "İkisini de yap":
//   (1) Görsel aramaya SİTE GENELİ günlük tavan (IP başına sınır toplam harcamayı sınırlamıyordu).
//   (2) Gündem otomatik toplama turu günde 6'dan 2'ye (TR 08:00 / 20:00).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const { handleVisualSearchRoute } = await import('../src/routes/visualSearch.js');
const { VISUAL_SEARCH_GLOBAL_DAILY_LIMIT } = await import('../src/lib/aiConfig.js');

// 1x1 PNG (magic byte + IHDR boyutu gerçek).
const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

function fakeEnv({ globalCount, cachedVision = null }) {
  const aiCalls = [];
  const env = {
    AI: { async run(model) { aiCalls.push(model); throw new Error('AI çağrılmamalıydı'); } },
    DB: {
      prepare() {
        return { bind(key) { return { async first() { return { count: String(key).startsWith('visual-search-global:') ? globalCount : 1 }; }, async run() {} }; } };
      },
    },
    FACET_CACHE: { async get() { return cachedVision; }, async put() {} },
  };
  return { env, aiCalls };
}
function request() {
  const fd = new FormData();
  fd.append('image', new Blob([PNG], { type: 'image/png' }), 'a.png');
  return new Request('https://mimarlab.com/api/ai/visual-search', { method: 'POST', body: fd, headers: { 'CF-Connecting-IP': '1.2.3.4' } });
}
const URL_VS = new URL('https://mimarlab.com/api/ai/visual-search');

await test('görsel arama: günlük tavan dolunca 429 ve AI HİÇ çağrılmaz', async () => {
  const { env, aiCalls } = fakeEnv({ globalCount: VISUAL_SEARCH_GLOBAL_DAILY_LIMIT + 1 });
  const res = await handleVisualSearchRoute(request(), env, URL_VS);
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /bugünlük kapasitesine ulaştı/);
  assert.equal(aiCalls.length, 0);
});

await test('görsel arama: tavanın altındayken AI yoluna geçilir (sayaç yalnızca AI öncesi)', async () => {
  const { env, aiCalls } = fakeEnv({ globalCount: VISUAL_SEARCH_GLOBAL_DAILY_LIMIT });
  await handleVisualSearchRoute(request(), env, URL_VS);
  assert.ok(aiCalls.length >= 1, 'tavanın altında vision analizi denenmeliydi');
});

await test('görsel arama: tavan makul ve site geneli ("all") anahtarla, önbellek isabetinden SONRA sayılır', () => {
  assert.ok(VISUAL_SEARCH_GLOBAL_DAILY_LIMIT > 0 && VISUAL_SEARCH_GLOBAL_DAILY_LIMIT <= 200);
  const s = read('../src/routes/visualSearch.js');
  const gate = s.indexOf("checkRateLimit(env, 'visual-search-global', 'all', VISUAL_SEARCH_GLOBAL_DAILY_LIMIT, 24 * 60 * 60 * 1000)");
  assert.ok(gate > -1, 'site geneli günlük tavan yok');
  assert.ok(gate > s.indexOf("env.FACET_CACHE.get(cacheKey, 'json')"), 'önbellekteki görsel tavandan düşmemeli');
  assert.ok(gate < s.indexOf('vision = await analyzeImage('), 'tavan AI çağrısından ÖNCE olmalı');
});

await test('Gündem cron: günde İKİ tur (TR 08:00/20:00 = UTC 05/17), dispatcher ve testler hizalı', () => {
  const w = read('../wrangler.jsonc');
  assert.match(w, /"triggers": \{ "crons": \["23 \*\/6 \* \* \*", "0 5,17 \* \* \*"\] \}/);
  assert.doesNotMatch(w, /"0 1,5,9,13,17,21 \* \* \*"\]/, 'eski 6 turlu ızgara geri gelmemeli');
  assert.match(read('./test-gundem.mjs'), /const GUNDEM_CRON = '0 5,17 \* \* \*';/);
});

await test('Gündem sağlık eşiği 12 saatlik aralıkla uyumlu (30 saat)', async () => {
  const { GUNDEM_CRON_STALE_MS } = await import('../src/lib/gundemRuns.js');
  assert.ok(GUNDEM_CRON_STALE_MS > 12 * 60 * 60 * 1000, 'iki tur arası 12 saat — eşik bundan büyük olmalı');
  assert.match(read('./health-check.sh'), /GUNDEM_CRON_STALE_HOURS=30/);
});

console.log(`\n${failed ? 'BAŞARISIZ' : 'TAMAM'} — ${passed} geçti, ${failed} kaldı`);
if (failed) process.exit(1);
