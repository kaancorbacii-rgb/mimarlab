#!/usr/bin/env node
// ÇİNİCİ MİMARLIK + PROJELERİNİ ÖNİZLEME ("soluk") DURUMUNA AL (kullanıcı isteği, 2026-09-10
// madde 3: "Çinici Mimarlık firmasını ve projelerini de blurlu olarak arşive al. TBMM Camii ve
// ODTÜ Kampüsü projeleri, Behruz Çinici ve Altuğ Çinici profilleri yayında kalsın.").
//
// scripts/archive-unassigned.mjs ile AYNI desen ve AYNI gerekçe: arşivleme işi elle
// `UPDATE ... hidden_at` ile yapılmaz, CANLI KODDAN (runContentAction / runProjectAction)
// import edilir — aksi halde geri alınabilirliği sağlayan *_submissions taslağı hiç oluşmaz
// (bkz. [[project_bulk_admin_ops_via_live_code_2026_09_08]]).
//
// "BLURLU ARŞİV" = ÜÇÜNCÜ DURUM: hidden_at DOLU + preview_at DOLU (bkz.
// migrations/0107_preview_state.sql ve [[project_preview_state_2026_09_10]]). Yani detay uçları
// yine 410 döner, sitemap/JSON-LD'ye girmez; kayıt yalnızca liste havuzlarında ve aramada soluk/
// tıklanamaz bir kart olarak görünür ve tıklanınca "Bu firma sana mı ait?" popup'ı açılır
// (js/components/preview-cards.js).
//
// KULLANIM:
//   node scripts/archive-cinici.mjs --dry-run
//   node scripts/archive-cinici.mjs
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { runContentAction, runProjectAction } from '../src/routes/legacyContent.js';

const ACCOUNT_ID = '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';
const DRY = process.argv.includes('--dry-run');

// Firma adı canonical `offices.name` ile birebir (runContentAction key ile bunu arar).
const OFFICE_NAME = 'Çinici Mimarlık';
// YAYINDA KALACAK projeler (kullanıcı isteği) — slug ile, başlık değişse de tutsun diye.
const KEEP_PROJECT_SLUGS = new Set(['tbmm-camii', 'odtu-kampusu']);
// Kişi profilleri (Behruz/Altuğ Çinici) bu betiğin HİÇ dokunmadığı kayıtlardır; burada yalnızca
// yanlışlıkla arşivlenmiş olmadıklarını doğrulamak için listelenirler.
const KEEP_ARCHITECTS = ['Behruz Çinici', 'Altuğ Çinici'];

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
if (!office) throw new Error(`"${OFFICE_NAME}" firması bulunamadı.`);

// Firmanın künyesindeki projeler — canUserEditProjectBySlug'daki AYNI bağ (project_designers).
const { results: projects } = await env.DB.prepare(
  `SELECT DISTINCT p.id, p.slug, p.title, p.hidden_at, p.preview_at
     FROM project_designers pd JOIN projects p ON p.id = pd.project_id AND p.deleted_at IS NULL
    WHERE pd.office_id = ? ORDER BY p.title`
).bind(office.id).all();

const toArchive = projects.filter(p => !KEEP_PROJECT_SLUGS.has(p.slug));
const kept = projects.filter(p => KEEP_PROJECT_SLUGS.has(p.slug));
console.log(`Firma: ${office.name} (#${office.id})`);
console.log(`Künyeli proje: ${projects.length} — yayında kalacak: ${kept.map(p => p.title).join(', ') || '(yok)'}`);
console.log(`Önizlemeye alınacak proje: ${toArchive.length}`);
for (const p of toArchive) console.log(`  · ${p.title} (${p.slug})`);

// Yayında kalması istenen projelerden biri slug'la bulunamadıysa BAŞTAN dur: sessizce fazladan
// bir projeyi arşivlemek geri alınabilir olsa da kullanıcının açıkça istediğinin tersidir.
for (const slug of KEEP_PROJECT_SLUGS) {
  if (!projects.some(p => p.slug === slug)) throw new Error(`Yayında kalması istenen "${slug}" firmanın künyeli projeleri arasında YOK — slug değişmiş olabilir, kontrol et.`);
}

if (DRY) {
  const rows = await Promise.all(KEEP_ARCHITECTS.map(n =>
    env.DB.prepare(`SELECT name, hidden_at, preview_at FROM architects WHERE name = ? AND deleted_at IS NULL`).bind(n).first()
  ));
  console.log('\nDokunulmayacak kişi profilleri:');
  for (const r of rows) console.log(`  · ${r ? `${r.name} — ${r.hidden_at ? 'ARŞİVDE' : 'yayında'}` : '(bulunamadı)'}`);
  console.log(`\n[DRY-RUN] Hiçbir şey değiştirilmedi. (${queryCount} D1 sorgusu)`);
  process.exit(0);
}

// 1) ARŞİVLE — canlı kod yolu (geri alınabilirlik için *_submissions taslağını da oluşturur).
for (const p of toArchive) {
  const res = await runProjectAction(env, user, { action: 'archive', slug: p.slug });
  if (res && res.status >= 400) { console.log(`  HATA ${p.slug}: ${await res.text()}`); continue; }
  console.log(`  arşivlendi: ${p.title}`);
}
const officeRes = await runContentAction(env, user, { type: 'offices', action: 'archive', key: office.name });
if (officeRes && officeRes.status >= 400) console.log(`  HATA ${office.name}: ${await officeRes.text()}`);
else console.log(`  arşivlendi: ${office.name}`);

// 2) ÖNİZLEMEYE AL — hidden_at DOLU kalır, preview_at set edilir (bkz. dosya başı).
const now = new Date().toISOString();
const projIds = toArchive.map(p => p.id);
if (projIds.length) {
  await env.DB.prepare(
    `UPDATE projects SET preview_at = ? WHERE hidden_at IS NOT NULL AND deleted_at IS NULL AND id IN (${projIds.map(() => '?').join(', ')})`
  ).bind(now, ...projIds).run();
}
await env.DB.prepare(
  `UPDATE offices SET preview_at = ? WHERE hidden_at IS NOT NULL AND deleted_at IS NULL AND id = ?`
).bind(now, office.id).run();

// 3) DOĞRULA — "arşivledim" demeden önce canlı satırların gerçekten üç durumda olduğunu oku.
const check = await env.DB.prepare(
  `SELECT COUNT(*) AS n FROM projects WHERE hidden_at IS NOT NULL AND preview_at IS NOT NULL AND id IN (${projIds.map(() => '?').join(', ')})`
).bind(...projIds).first();
const officeCheck = await env.DB.prepare(`SELECT hidden_at, preview_at FROM offices WHERE id = ?`).bind(office.id).first();
console.log(`\nÖnizleme durumunda: ${check.n}/${projIds.length} proje, firma: ${officeCheck.hidden_at && officeCheck.preview_at ? 'evet' : 'HAYIR'}`);
console.log(`\nBitti. (${queryCount} D1 sorgusu)`);
console.log('NOT: KV havuz anahtarları (pool:*) elle temizlenmeli — bkz. [[project_pool_cache_needs_manual_purge_after_query_logic_deploy]].');
