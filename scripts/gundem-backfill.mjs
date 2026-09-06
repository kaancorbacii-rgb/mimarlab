#!/usr/bin/env node
// GÜNDEM GERİ DOLDURMA — "bugün yayımlanan içerikleri şimdi çek" (kullanıcı isteği, 2026-09-07).
//
// NE YAPAR: production hattının BİREBİR AYNISINI, cron'u beklemeden, yerelden çalıştırır.
// Kaynak okuma, mükerrer kontrolü, görsel doğrulama, AI özet, kalite kapıları, entity eşleştirme,
// D1 yazımı — hepsi src/lib/gundemIngest.js'teki AYNI kodla yapılır. Burada YENİDEN YAZILMIŞ
// hiçbir iş mantığı yoktur; bu dosya yalnızca Workers ortamının (env.DB / env.AI / caches) Node
// karşılıklarını sağlayan bir ADAPTÖRDÜR.
//
// NEDEN BÖYLE: hattı burada yeniden yazmak, canlıda çalışan kapılarla sapma riski yaratırdı (bu
// depodaki tekrar eden kök neden: "aynı iş iki yerde, biri sessizce ayrıştı"). Adaptör yaklaşımı,
// geri doldurmanın canlıyla AYNI kalite eşiğinden geçmesini garanti eder.
//
// NEDEN ADMIN UCU DEĞİL: tek seferlik bir işlem için kalıcı bir public/admin yazma ucu açmak
// gereksiz bir saldırı yüzeyi olurdu. Bu betik, depodaki diğer ~100 toplu içe aktarma betiğiyle
// aynı desende (wrangler OAuth token'ı ile Cloudflare REST API), yeni bir secret gerektirmez.
//
// KULLANIM:
//   node scripts/gundem-backfill.mjs [--days=1] [--per-source=8] [--max=25] [--daily-cap=50] [--dry-run]
//
// GÜVENLİK: --dry-run ile hiçbir şey yazılmaz (D1 yazma çağrıları atlanır, sonuç raporlanır).
// Kill switch (site_settings.gundem_automation_enabled) burada da GEÇERLİDİR — kapalıysa betik
// hiçbir kaynağa gitmez ve durur.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { runGundemIngestion } from '../src/lib/gundemIngest.js';

const ACCOUNT_ID = '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';
const AI_MODEL_PATH = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

// wrangler'ın OAuth token'ı — macOS'ta ~/Library/Preferences/.wrangler, Linux'ta ~/.wrangler.
const TOKEN_PATHS = [
  `${homedir()}/Library/Preferences/.wrangler/config/default.toml`,
  `${homedir()}/.wrangler/config/default.toml`,
  `${homedir()}/.config/.wrangler/config/default.toml`,
];

function readTokenFile() {
  for (const p of TOKEN_PATHS) {
    try { return readFileSync(p, 'utf8'); } catch { /* sıradaki yolu dene */ }
  }
  throw new Error('wrangler OAuth token bulunamadı — `npx wrangler login` çalıştırın.');
}

function oauthToken() {
  const m = readTokenFile().match(/oauth_token\s*=\s*"([^"]+)"/);
  if (!m) throw new Error('wrangler OAuth token bulunamadı — `npx wrangler login` çalıştırın.');
  return m[1];
}

function tokenExpiresAt() {
  const m = readTokenFile().match(/expiration_time\s*=\s*"([^"]+)"/);
  const ms = m ? Date.parse(m[1]) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

// TOKEN TAZELEME — GERÇEK BULGU (2026-09-07 geri doldurma turu): wrangler'ın OAuth ERİŞİM token'ı
// yalnızca 1 SAAT geçerli ve dosyaya SADECE bir wrangler komutu çalıştığında yenilenir. Bu betik
// token'ı açılışta BİR KEZ okuyup 8-15 dakikalık bir tur boyunca elinde tutuyordu; token turun
// ortasında dolunca Cloudflare TÜM isteklere 7403 ("not authorized") döndürdü ve tur SIFIR yayınla
// bitti — üstelik 90 aday için ağa çıkılıp 170 AI çağrısı harcandıktan SONRA. Kaynak sağlığı
// yazımları turun BAŞINDA yapıldığı için 9/9 "başarılı" görünüyordu; hata yalnızca AI ve gundem_items
// yazımında ortaya çıktı, yani sessiz değil ama geç fark edilen bir bozulmaydı.
//
// ÇÖZÜM: (a) turdan önce token'ın ömrünü kontrol et, kısaysa yenile; (b) tur sırasında bir istek
// yetki hatası alırsa BİR KEZ yenileyip aynı isteği tekrarla. Yenileme, wrangler'ın kendi refresh
// akışını tetikleyen ucuz bir komutla yapılır — burada yeni bir kimlik doğrulama mantığı yazılmaz.
let TOKEN = oauthToken();
const TOKEN_MIN_REMAINING_MS = 20 * 60 * 1000;

function refreshToken(reason) {
  try {
    execFileSync('npx', ['wrangler', 'whoami'], { stdio: 'ignore', timeout: 90000 });
  } catch { /* yenileme başarısızsa aşağıdaki okuma eski token'ı döndürür, çağıran hata alır */ }
  const before = TOKEN;
  TOKEN = oauthToken();
  const expiry = tokenExpiresAt();
  console.log(`  [token] ${reason} -> ${TOKEN === before ? 'DEĞİŞMEDİ' : 'yenilendi'}` +
    `${expiry ? `, geçerlilik ${new Date(expiry).toISOString()}` : ''}`);
  return TOKEN !== before;
}

// Yetki hatası mı? (7403 = "account not valid / not authorized" — süresi dolmuş token'ın imzası.)
function isAuthFailure(status, json) {
  if (status === 401 || status === 403) return true;
  const codes = (json && json.errors || []).map(e => e && e.code);
  return codes.includes(7403) || codes.includes(10000);
}

// Cloudflare REST çağrısı — yetki hatasında token'ı BİR KEZ yenileyip tekrar dener.
async function cfFetch(url, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.success) return json;
    if (attempt === 0 && isAuthFailure(res.status, json) && refreshToken('istek yetki hatası aldı')) continue;
    const err = new Error(JSON.stringify(json.errors).slice(0, 300));
    err.httpStatus = res.status;
    throw err;
  }
}

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const DRY_RUN = !!args['dry-run'];
const DAYS = Number(args.days ?? 1);
const PER_SOURCE = Number(args['per-source'] ?? 8);
const MAX_TOTAL = Number(args.max ?? 25);
// Günlük yayın tavanı (GUNDEM_LIMITS.maxPublishPerDay = 50) SON 24 SAATİ sayar. 7 günlük bir geri
// doldurma tek turda 7 günün içeriğini işlediği için bu tavan turu ortasında kesebilir; --daily-cap
// yalnızca bu tek seferlik işlem için tavanı --max'a göre açar. --max ZATEN mutlak tavandır, yani
// kontrolsüz bir yayın olmaz — sadece hangi sayacın kestiği netleşir.
const DAILY_CAP = Number(args['daily-cap'] ?? 50);

// ---------------------------------------------------------------------------------------------
// env.DB adaptörü — D1 REST API. Workers'taki prepare/bind/first/all/run/batch sözleşmesini taklit
// eder. Yalnızca hattın GERÇEKTEN kullandığı yüzey desteklenir.
// ---------------------------------------------------------------------------------------------
let d1Queries = 0;
let d1Writes = 0;

async function d1(sql, params = []) {
  d1Queries++;
  let json;
  try {
    json = await cfFetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
      { sql, params }
    );
  } catch (err) {
    throw new Error(`D1: ${err.message}`);
  }
  return json.result[0];
}

const isWrite = sql => /^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(sql);

function statement(sql, params = []) {
  return {
    sql, params,
    bind: (...p) => statement(sql, p),
    async all() { const r = await d1(sql, params); return { results: r.results || [] }; },
    async first() { const r = await d1(sql, params); return (r.results || [])[0] || null; },
    async run() {
      if (DRY_RUN && isWrite(sql)) return { success: true };
      if (isWrite(sql)) d1Writes++;
      return d1(sql, params);
    },
  };
}

const DB = {
  prepare: sql => statement(sql),
  async batch(statements) {
    const out = [];
    for (const st of statements) out.push(await st.run());
    return out;
  },
};

// ---------------------------------------------------------------------------------------------
// env.AI adaptörü — Workers AI REST API. env.AI.run(model, opts) ile aynı şekli döndürür.
// ---------------------------------------------------------------------------------------------
let aiCalls = 0;
const AI = {
  async run(model, opts) {
    aiCalls++;
    const json = await cfFetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${model || AI_MODEL_PATH}`,
      opts
    );
    return json.result;
  },
};

// FACET_CACHE verilmez: getSiteSettings ve getCachedPool ikisi de KV yoksa doğrudan D1'e düşer
// (bkz. o dosyalardaki try/catch fallback'leri) — davranış aynı, yalnızca önbelleksiz.
const env = { DB, AI, ENVIRONMENT: 'production' };

// ---------------------------------------------------------------------------------------------
// Havuz okuyucuları (entity eşleştirme) — cron'da src/routes/*'tan enjekte ediliyor; burada da
// AYNI fonksiyonlar import edilir, böylece eşleştirme canlıyla birebir aynı veriyi görür.
// ---------------------------------------------------------------------------------------------
const { fetchOfficePool } = await import('../src/routes/office.js');
const { fetchArchitectPool } = await import('../src/routes/architect.js');
const { fetchProductPool } = await import('../src/routes/product.js');
const { fetchActiveProjectPoolCached } = await import('../src/routes/project.js');

const deps = {
  fetchOfficePool,
  fetchArchitectPool,
  fetchProductPool,
  fetchProjectPool: (e) => fetchActiveProjectPoolCached(e, 'built'),
};

// ---------------------------------------------------------------------------------------------
console.log(`GÜNDEM geri doldurma — son ${DAYS} gün, kaynak başına ${PER_SOURCE}, toplam en fazla ${MAX_TOTAL}${DRY_RUN ? '  [DRY-RUN: yazma YOK]' : ''}`);
console.log('');

// Tur başlamadan ÖNCE token ömrünü kontrol et — 8-15 dakikalık bir turun ortasında dolan token
// turu sıfır yayınla bitirir (bkz. refreshToken'daki bulgu). Yenileme ucuz, kaybedilen tur değil.
const expiry = tokenExpiresAt();
if (expiry === null || expiry - Date.now() < TOKEN_MIN_REMAINING_MS) {
  refreshToken(expiry === null ? 'geçerlilik süresi okunamadı' : `token ${Math.round((expiry - Date.now()) / 60000)} dk sonra doluyor`);
} else {
  console.log(`  [token] geçerlilik ${new Date(expiry).toISOString()} (${Math.round((expiry - Date.now()) / 60000)} dk)`);
}

const started = Date.now();
const stats = await runGundemIngestion(env, deps, {
  // Kaynak bekleme penceresini atla — bu tek seferlik bir işlem, cron ızgarasını beklemesi anlamsız.
  ignoreSourceSchedule: true,
  maxAgeDays: DAYS,
  // Tarihi olmayan girdiyi ALMA, gelecek tarihli girdiyi ALMA (geri doldurma isteği madde 3).
  strictDateWindow: true,
  maxItemsPerSource: PER_SOURCE,
  maxItemsPerRun: MAX_TOTAL,
  maxPublishPerDay: DAILY_CAP,
  // Yerelde Worker'ın duvar-saati sınırı yok; AI çağrısı başına ~4sn ve içerik başına ~2 çağrı
  // olduğundan 25 içerik için cömert bir bütçe.
  runBudgetMs: 15 * 60 * 1000,
});

console.log('');
console.log('KAYNAK KIRILIMI');
const cols = ['Kaynak', 'Bulunan', `Son ${DAYS}g`, 'Aday', 'Proje', 'Mükerrer', 'AI red', 'Kalite red', 'Yayın'];
const rows = Object.entries(stats.bySource || {}).map(([id, r]) => ([
  id, r.found, r.fresh, r.candidates, r.projectPrefilter, r.duplicate, r.aiRejected, r.qualityRejected, r.published,
]));
const totals = ['TOPLAM', ...[1, 2, 3, 4, 5, 6, 7, 8].map(i => rows.reduce((s, r) => s + (r[i] || 0), 0))];
const widths = cols.map((c, i) => Math.max(c.length, ...[...rows, totals].map(r => String(r[i]).length)));
const line = r => r.map((v, i) => i === 0 ? String(v).padEnd(widths[i]) : String(v).padStart(widths[i])).join('  ');
console.log('  ' + line(cols));
console.log('  ' + widths.map(w => '-'.repeat(w)).join('  '));
rows.forEach(r => console.log('  ' + line(r)));
console.log('  ' + line(totals));
Object.entries(stats.bySource || {}).forEach(([id, r]) => {
  if (Object.keys(r.skipped || {}).length) console.log(`    ${id} eleme nedenleri: ${JSON.stringify(r.skipped)}`);
  if (r.error) console.log(`    ${id} HATA: ${r.error}`);
});

console.log('');
console.log('SONUÇ');
console.log(`  kaynak            : ${stats.sourcesOk}/${stats.sourcesTried} başarılı`);
console.log(`  feed'den okunan   : ${stats.fetched}`);
console.log(`  değerlendirilen   : ${stats.candidates}`);
console.log(`  mükerrer elenen   : ${stats.duplicate} ${JSON.stringify(stats.duplicateBy)}`);
console.log(`  kalite elenen     : ${stats.qualityFailed}`);
console.log(`  atlama nedenleri  : ${JSON.stringify(stats.skipped)}`);
console.log(`  YAYINLANAN        : ${stats.published}`);
console.log(`  entity bağlanan   : ${stats.entitiesLinked}`);
console.log(`  AI çağrısı        : ${stats.aiCalls}`);
console.log(`  D1 sorgu / yazma  : ${d1Queries} / ${d1Writes}`);
console.log(`  süre              : ${Math.round((Date.now() - started) / 1000)} sn`);
if (stats.errors && stats.errors.length) console.log(`  hatalar           : ${stats.errors.join(' | ')}`);
if (stats.disabled) console.log('  NOT: kill switch KAPALI — hiçbir kaynağa gidilmedi.');
