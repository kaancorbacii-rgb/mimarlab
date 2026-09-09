#!/usr/bin/env node
// ÜZERİNE KULLANICI ATANMAMIŞ İÇERİKLERİ TOPLU ARŞİVLE (kullanıcı isteği, 2026-09-10 madde 3).
//
// Admin panelindeki "Üyeler > Atanmamış İçerikleri Arşive Taşı" kutusuyla AYNI işi yapar (bkz.
// src/routes/unassignedArchive.js) — fark, binlerce kaydın tek bir Worker isteğine sığmaması:
// buradan çalıştırıldığında iş, süre sınırı olmayan bir Node sürecinde döner.
//
// KURAL KOPYALANMAZ: hem "atanmamış" tanımı hem arşivleme işi canlı koddan İMPORT edilir
// (findUnassignedForScript + runContentAction). Elle `UPDATE ... hidden_at` yazmak arşiv taslağını
// hiç oluşturmaz ve kaydı GERİ ALINAMAZ hale getirir — bkz.
// [[project_bulk_admin_ops_via_live_code_2026_09_08]].
//
// KULLANIM:
//   node scripts/archive-unassigned.mjs --dry-run            # yalnızca sayar
//   node scripts/archive-unassigned.mjs                      # tüm tipleri arşivler
//   node scripts/archive-unassigned.mjs --type=products      # tek tip
//
// İKİ NOT:
//   1) env.FACET_CACHE (KV) burada YOK, bu yüzden invalidatePublicCache havuz anahtarlarını
//      ATLAR — havuz cache'i 30 dk TTL'lidir. Betik bittikten sonra anahtarları ELLE temizle
//      (aşağıda çıktıda hatırlatılır).
//   2) wrangler OAuth token'ı ~1 saatte dolar. Betik idempotenttir: arşivlenen kayıt bir sonraki
//      taramaya girmez, `npx wrangler login` sonrası yeniden çalıştırmak kaldığı yerden devam eder.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { runContentAction } from '../src/routes/legacyContent.js';
import { findUnassignedForScript, UNASSIGNED_TYPES } from '../src/routes/unassignedArchive.js';

const ACCOUNT_ID = '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';
const DRY = process.argv.includes('--dry-run');
const ONLY_TYPE = (process.argv.find(a => a.startsWith('--type=')) || '').split('=')[1] || null;

const TOKEN_PATHS = [
  `${homedir()}/Library/Preferences/.wrangler/config/default.toml`,
  `${homedir()}/.wrangler/config/default.toml`,
  `${homedir()}/.config/.wrangler/config/default.toml`,
];
function token() {
  for (const p of TOKEN_PATHS) {
    try {
      const m = readFileSync(p, 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    } catch { /* sıradaki yol */ }
  }
  throw new Error('wrangler OAuth token bulunamadı — `npx wrangler login` çalıştırın.');
}
const TOKEN = token();

let queryCount = 0;
async function rawQuery(sql, params = []) {
  queryCount++;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
      { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }) }
    );
    const json = await res.json().catch(() => null);
    if (json && json.success) return json.result[0];
    const msg = JSON.stringify((json && json.errors) || res.status);
    // 7403 = token süresi doldu (bkz. [[project_wrangler_oauth_token_expires_mid_script]]) — yeniden
    // denemek işe yaramaz, kullanıcının tekrar login olması gerekir.
    if (msg.includes('7403') || msg.includes('10000')) throw new Error(`D1 yetkilendirme hatası (token dolmuş olabilir): ${msg}`);
    if (attempt === 3) throw new Error(`D1 sorgusu başarısız: ${msg}\n${sql}`);
    await new Promise(r => setTimeout(r, 400 * attempt));
  }
}

// env.DB shim — Workers D1 arayüzünün betik tarafındaki karşılığı.
function d1() {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) {
      const r = await rawQuery(sql, params);
      const row = (r.results || [])[0];
      if (!row) return null;
      return col ? row[col] : row;
    },
    async all() {
      const r = await rawQuery(sql, params);
      return { results: r.results || [] };
    },
    async run() {
      const r = await rawQuery(sql, params);
      return { success: true, meta: r.meta || {} };
    },
  });
  return {
    prepare: (sql) => stmt(sql, []),
    async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; },
  };
}

const env = { DB: d1() };
// Arşiv taslaklarının owner_user_id'si — admin hesabı (panelden yapılsaydı da aynısı olurdu).
const adminRow = await env.DB.prepare(`SELECT id, email FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`).first();
if (!adminRow) throw new Error('Admin kullanıcı bulunamadı.');
const user = { id: adminRow.id, role: 'admin' };
console.log(`Admin: ${adminRow.email}${DRY ? '   [DRY-RUN]' : ''}\n`);

const types = ONLY_TYPE ? [ONLY_TYPE] : UNASSIGNED_TYPES;
let grandTotal = 0;
let grandFailed = 0;

for (const type of types) {
  const rows = await findUnassignedForScript(env, type);
  console.log(`${type}: ${rows.length} atanmamış kayıt`);
  if (DRY || !rows.length) { grandTotal += rows.length; continue; }
  let done = 0;
  const failures = [];
  for (const row of rows) {
    try {
      const res = await runContentAction(env, user, { type, action: 'archive', key: row.key });
      if (res && res.status >= 400) failures.push({ key: row.key, body: await res.text() });
      else done++;
    } catch (err) {
      failures.push({ key: row.key, body: (err && err.message) || String(err) });
    }
    if (done % 25 === 0 && done) process.stdout.write(`\r  ${done}/${rows.length} (${queryCount} sorgu)`);
  }
  process.stdout.write(`\r  ${done}/${rows.length} arşivlendi (${queryCount} sorgu)          \n`);
  if (failures.length) {
    console.log(`  ${failures.length} kayıt atlandı, ilk 5:`);
    failures.slice(0, 5).forEach(f => console.log(`    - ${f.key}: ${String(f.body).slice(0, 160)}`));
  }
  grandTotal += done;
  grandFailed += failures.length;
}

console.log(`\nToplam ${grandTotal} kayıt${DRY ? ' arşivlenecek' : ' arşivlendi'}${grandFailed ? `, ${grandFailed} atlandı` : ''}. (${queryCount} D1 sorgusu)`);
if (!DRY && grandTotal) {
  console.log(`
Havuz cache'ini ELLE temizle (env.FACET_CACHE bu betikte yok, bkz. dosya başı not):
  for k in pool:architects pool:offices pool:products facet_counts:projects; do
    npx wrangler kv key delete --namespace-id 9a8a1cfde13447a498bc5dcc4bc7d4ae --remote "$k"
  done`);
}
