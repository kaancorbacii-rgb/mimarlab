#!/usr/bin/env node
// BEŞ PROJEYİ ARŞİVDEN/ÖNİZLEMEDEN YAYINA AL (kullanıcı isteği, 2026-09-10: "Cumhurbaşkanlığı
// Millet Kütüphanesi, Taksim Camii, Amanruya Otel, Ayvacık B2 Evi, Santralistanbul Enerji Müzesi
// projelerini canlıya al.").
//
// scripts/publish-birim-design.mjs İLE AYNI desen ve AYNI gerekçe: iş elle `UPDATE projects SET
// hidden_at = NULL` ile yapılmaz, CANLI KODDAN (runProjectAction) import edilir — publish yolu
// yalnızca hidden_at'i değil, arşiv taslağının status'ünü ('archived' -> 'approved'), canonical
// satırın senkronunu (syncApprovedSubmissionToCanonical), facet sayaçlarını ve SSR/detay cache
// purge'ünü de yapar (bkz. [[project_bulk_admin_ops_via_live_code_2026_09_08]]).
//
// NEDEN publish ID İLE ÇAĞRILIR: runProjectAction'ın `slug` dalı publish'i açıkça reddeder
// ("Geçersiz istek") — yayına alma HER ZAMAN bir project_submissions taslağı üzerinden gider.
// Arşivleme o taslağı zaten oluşturmuştu, bu betik onu bulup id ile publish eder.
//
// preview_at ("soluk/blur" önizleme durumu) TEMİZLİĞİ: publish yolundaki setLegacyHidden(...,
// false) preview_at'i de temizler (bkz. [[project_preview_state_2026_09_10]]), ayrıca elle bir
// preview_at güncellemesi GEREKMEZ — betik yine de sonunda canlı satırları okuyup doğrular.
//
// KULLANIM:
//   node scripts/publish-2026-09-10-projects.mjs --dry-run
//   node scripts/publish-2026-09-10-projects.mjs
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { runProjectAction } from '../src/routes/legacyContent.js';

const ACCOUNT_ID = '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';
const DRY = process.argv.includes('--dry-run');

// Canonical projects.slug ile birebir (kullanıcının yazdığı adlar canlıda bu slug'lara karşılık
// geliyor: "Ayvacık B2 Evi" -> b2-evi, "Amanruya Otel" -> amanruya-oteli).
const SLUGS = [
  'cumhurbaskanligi-millet-kutuphanesi',
  'taksim-camii',
  'amanruya-oteli',
  'b2-evi',
  'santralistanbul-enerji-muzesi',
];

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

const ph = SLUGS.map(() => '?').join(', ');
const { results: projects } = await env.DB.prepare(
  `SELECT id, slug, title, hidden_at, preview_at FROM projects WHERE deleted_at IS NULL AND slug IN (${ph}) ORDER BY title`
).bind(...SLUGS).all();

const missingRows = SLUGS.filter(s => !projects.some(p => p.slug === s));
if (missingRows.length) throw new Error(`Canlıda bulunamayan proje slug'ı: ${missingRows.join(', ')}`);

// Arşiv taslakları — publish YALNIZCA id ile çalışır (bkz. dosya başı).
const drafts = new Map();
for (const p of projects) {
  const draft = await env.DB.prepare(
    `SELECT id, status FROM project_submissions WHERE claimed_slug = ? ORDER BY updated_at DESC LIMIT 1`
  ).bind(p.slug).first();
  if (draft) drafts.set(p.slug, draft);
  const state = p.preview_at ? 'ÖNİZLEME (soluk)' : p.hidden_at ? 'tam arşiv' : 'yayında';
  console.log(`  · ${p.title} (${p.slug}) — ${state} · taslak: ${draft ? `${draft.id} [${draft.status}]` : '(YOK)'}`);
}

// Taslağı olmayan bir kayıt publish EDİLEMEZ — "yayına aldım" demeden ÖNCE dur (publish-birim-
// design.mjs'teki AYNI kontrol/gerekçe: sessizce eksik iş yapmaktansa hiç yapma).
const missingDrafts = projects.filter(p => (p.hidden_at || p.preview_at) && !drafts.has(p.slug)).map(p => p.slug);
if (missingDrafts.length) throw new Error(`Arşiv taslağı bulunamayan proje(ler) var, publish yolu bunları yayına ALAMAZ: ${missingDrafts.join(', ')}`);

if (DRY) {
  console.log(`\n[DRY-RUN] Hiçbir şey değiştirilmedi. (${queryCount} D1 sorgusu)`);
  process.exit(0);
}

console.log('');
for (const p of projects) {
  if (!p.hidden_at && !p.preview_at) { console.log(`  atlandı (zaten yayında): ${p.title}`); continue; }
  const draft = drafts.get(p.slug);
  const res = await runProjectAction(env, user, { action: 'publish', id: draft.id });
  if (res && res.status >= 400) { console.log(`  HATA ${p.slug}: ${await res.text()}`); continue; }
  console.log(`  yayına alındı: ${p.title}`);
}

// DOĞRULA — "canlıya aldım" demeden önce canlı satırları GERÇEKTEN oku.
const { results: check } = await env.DB.prepare(
  `SELECT slug, title, hidden_at, preview_at FROM projects WHERE slug IN (${ph}) ORDER BY title`
).bind(...SLUGS).all();
let ok = true;
console.log('');
for (const r of check) {
  const live = !r.hidden_at && !r.preview_at;
  if (!live) ok = false;
  console.log(`  ${live ? 'YAYINDA' : 'HÂLÂ GİZLİ'} — ${r.title}`);
}
if (!ok) process.exitCode = 1;
console.log(`\nBitti. (${queryCount} D1 sorgusu)`);
console.log('NOT: KV havuz anahtarları (pool:*) elle temizlenmeli — bkz. [[project_pool_cache_needs_manual_purge_after_query_logic_deploy]].');
