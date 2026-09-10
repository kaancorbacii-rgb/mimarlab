#!/usr/bin/env node
// BİRİM DESIGN MARKASINI VE ÜRÜNLERİNİ ÖNİZLEMEDEN ("blur") YAYINA AL (kullanıcı isteği,
// 2026-09-10 sekizinci tur madde 4: "Birim Design markasının ve ürünlerinin blurlarını kaldır.").
//
// scripts/archive-cinici.mjs'in TERSİ ve onunla AYNI desen: iş elle `UPDATE ... hidden_at = NULL`
// ile yapılmaz, CANLI KODDAN (runContentAction) import edilir — publish yolu yalnızca hidden_at'i
// değil, arşiv taslağının status'ünü ('archived' -> 'approved'), canonical satırın senkronunu,
// facet sayaçlarını ve SSR/detay cache purge'ünü de yapar (bkz.
// [[project_bulk_admin_ops_via_live_code_2026_09_08]]).
//
// NEDEN publish ID İLE ÇAĞRILIR: runContentAction'ın `key` dalı publish'i açıkça reddeder
// ("Geçersiz istek") — yayına alma HER ZAMAN bir *_submissions taslağı üzerinden gider. Arşivleme
// o taslağı zaten oluşturmuştu, bu betik onu bulup id ile publish eder.
//
// preview_at TEMİZLİĞİ: publish yolundaki setLegacyHidden(..., false) ve canonicalSync'in
// hidden_at = NULL noktaları preview_at'i de temizler (bkz. [[project_preview_state_2026_09_10]]),
// yani ayrıca elle bir preview_at güncellemesi GEREKMEZ — betik yine de sonunda doğrular.
//
// KULLANIM:
//   node scripts/publish-birim-design.mjs --dry-run
//   node scripts/publish-birim-design.mjs
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { runContentAction } from '../src/routes/legacyContent.js';

const ACCOUNT_ID = '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';
const DRY = process.argv.includes('--dry-run');

// Marka adı canonical `offices.name` ile birebir.
const OFFICE_NAME = 'BİRİM Design';

const TOKEN_PATHS = [
  `${homedir()}/Library/Preferences/.wrangler/config/default.toml`,
  `${homedir()}/.wrangler/config/default.toml`,
  `${homedir()}/.config/.wrangler/config/default.toml`,
];
function token() {
  for (const p of TOKEN_PATHS) {
    try { const m = readFileSync(p, 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/); if (m) return m[1]; } catch { /* sıradaki yol */ }
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
    // 7403 = token süresi doldu (bkz. [[project_wrangler_oauth_token_expires_mid_script]]).
    if (msg.includes('7403') || msg.includes('10000')) throw new Error(`D1 yetkilendirme hatası (token dolmuş olabilir): ${msg}`);
    if (attempt === 3) throw new Error(`D1 sorgusu başarısız: ${msg}\n${sql}`);
    await new Promise(r => setTimeout(r, 400 * attempt));
  }
}
function d1() {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = await rawQuery(sql, params); const row = (r.results || [])[0]; if (!row) return null; return col ? row[col] : row; },
    async all() { const r = await rawQuery(sql, params); return { results: r.results || [] }; },
    async run() { const r = await rawQuery(sql, params); return { success: true, meta: r.meta || {} }; },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; } };
}

const env = { DB: d1() };
const adminRow = await env.DB.prepare(`SELECT id, email FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`).first();
if (!adminRow) throw new Error('Admin kullanıcı bulunamadı.');
const user = { id: adminRow.id, role: 'admin' };
console.log(`Admin: ${adminRow.email}${DRY ? '   [DRY-RUN]' : ''}\n`);

const office = await env.DB.prepare(
  `SELECT id, name, slug, hidden_at, preview_at FROM offices WHERE name = ? AND deleted_at IS NULL`
).bind(OFFICE_NAME).first();
if (!office) throw new Error(`"${OFFICE_NAME}" markası bulunamadı.`);

// Markanın ürünleri — src/routes/admin.js#activateClaimedProfile'ın AYNI eşleşme kuralı
// (brand_office_id, o boşsa marka ADI).
const { results: products } = await env.DB.prepare(
  `SELECT id, slug, title, hidden_at, preview_at FROM products
     WHERE deleted_at IS NULL AND (brand_office_id = ? OR brand_name_raw = ? COLLATE NOCASE)
     ORDER BY id`
).bind(office.id, office.name).all();

// Arşiv taslakları — publish YALNIZCA id ile çalışır (bkz. dosya başı).
const officeDraft = await env.DB.prepare(
  `SELECT id, status FROM office_submissions WHERE claimed_profile_key = ? AND status = 'archived' ORDER BY updated_at DESC LIMIT 1`
).bind(office.name).first();

const productDrafts = new Map();
for (const p of products) {
  const draft = await env.DB.prepare(
    `SELECT id, status FROM product_submissions WHERE claimed_slug = ? AND status = 'archived' ORDER BY updated_at DESC LIMIT 1`
  ).bind(p.slug).first();
  if (draft) productDrafts.set(p.id, draft);
}

console.log(`Marka: ${office.name} (#${office.id}) — ${office.preview_at ? 'ÖNİZLEME (blur)' : office.hidden_at ? 'tam arşiv' : 'yayında'}`);
console.log(`Arşiv taslağı: ${officeDraft ? officeDraft.id : '(YOK)'}`);
console.log(`Ürün: ${products.length}`);
for (const p of products) {
  const state = p.preview_at ? 'ÖNİZLEME' : p.hidden_at ? 'tam arşiv' : 'yayında';
  console.log(`  · ${p.title} (${p.slug}) — ${state} · taslak: ${productDrafts.has(p.id) ? productDrafts.get(p.id).id : '(YOK)'}`);
}

// Taslağı olmayan bir kayıt publish edilemez — "yayına aldım" demeden ÖNCE dur (archive-cinici.mjs'in
// KEEP_PROJECT_SLUGS kontrolüyle AYNI gerekçe: sessizce eksik iş yapmaktansa hiç yapma).
const missing = products.filter(p => (p.hidden_at || p.preview_at) && !productDrafts.has(p.id)).map(p => p.slug);
if (!officeDraft && (office.hidden_at || office.preview_at)) missing.unshift(`office:${office.slug}`);
if (missing.length) throw new Error(`Arşiv taslağı bulunamayan kayıt(lar) var, publish yolu bunları yayına ALAMAZ: ${missing.join(', ')}`);

if (DRY) {
  console.log(`\n[DRY-RUN] Hiçbir şey değiştirilmedi. (${queryCount} D1 sorgusu)`);
  process.exit(0);
}

// 1) YAYINA AL — canlı kod yolu.
if (officeDraft) {
  const res = await runContentAction(env, user, { type: 'offices', action: 'publish', id: officeDraft.id });
  if (res && res.status >= 400) console.log(`  HATA ${office.name}: ${await res.text()}`);
  else console.log(`  yayına alındı: ${office.name}`);
}
for (const p of products) {
  const draft = productDrafts.get(p.id);
  if (!draft) { console.log(`  atlandı (zaten yayında): ${p.title}`); continue; }
  const res = await runContentAction(env, user, { type: 'products', action: 'publish', id: draft.id });
  if (res && res.status >= 400) { console.log(`  HATA ${p.slug}: ${await res.text()}`); continue; }
  console.log(`  yayına alındı: ${p.title}`);
}

// 2) DOĞRULA — "blurları kaldırdım" demeden önce canlı satırları GERÇEKTEN oku.
const officeCheck = await env.DB.prepare(`SELECT hidden_at, preview_at FROM offices WHERE id = ?`).bind(office.id).first();
const ph = products.map(() => '?').join(', ');
const prodCheck = products.length ? await env.DB.prepare(
  `SELECT COUNT(*) AS n FROM products WHERE hidden_at IS NULL AND preview_at IS NULL AND id IN (${ph})`
).bind(...products.map(p => p.id)).first() : { n: 0 };
const officeOk = !officeCheck.hidden_at && !officeCheck.preview_at;
console.log(`\nYayında: marka ${officeOk ? 'evet' : 'HAYIR'}, ürün ${prodCheck.n}/${products.length}`);
if (!officeOk || prodCheck.n !== products.length) process.exitCode = 1;
console.log(`\nBitti. (${queryCount} D1 sorgusu)`);
console.log('NOT: KV havuz anahtarları (pool:*) elle temizlenmeli — bkz. [[project_pool_cache_needs_manual_purge_after_query_logic_deploy]].');
