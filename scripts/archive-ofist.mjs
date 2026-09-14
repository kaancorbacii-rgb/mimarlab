#!/usr/bin/env node
// OFİST FİRMASINI, PROJELERİNİ VE KURUCU ORTAKLARINI ARŞİVE AL (kullanıcı isteği, 2026-09-14:
// "Ofist firmasını, 10 adet projesini ve 2 adet kurucu ortağını arşive al").
//
// scripts/archive-cinici.mjs ile AYNI desen ve AYNI gerekçe: arşivleme işi elle
// `UPDATE ... hidden_at` ile yapılmaz, CANLI KODDAN (runContentAction / runProjectAction)
// import edilir — aksi halde geri alınabilirliği sağlayan *_submissions taslağı hiç oluşmaz
// (bkz. [[project_bulk_admin_ops_via_live_code_2026_09_08]]) ve kayıt "Arşivim > Yayına Al" ile
// geri getirilemez.
//
// TAM ARŞİV, ÖNİZLEME DEĞİL: archive-cinici.mjs'ten TEK FARKI budur. Orada istek açıkça "blurlu
// olarak arşive al" idi ve arşivden SONRA ayrıca `preview_at` damgalanıyordu. Burada istek düz
// "arşive al" — yani kayıt listelerde soluk kart olarak DA görünmez. setLegacyHidden zaten
// arşivlerken `preview_at`i NULL'lar (bkz. src/routes/legacyContent.js#setLegacyHidden'daki
// "Arşivle HER ZAMAN TAM arşiv demektir" notu), bu yüzden bu betik preview_at'e HİÇ dokunmaz.
//
// NE ARŞİVLENİR (üçü de ayrı ayrı, kendi canlı kod yolundan):
//   1. Firmanın künyeli projeleri — project_designers.office_id bağı (canUserEditProjectBySlug'ın
//      kullandığı AYNI bağ).
//   2. Kurucu ortaklar — office_founders join tablosu, yani firma pop-up'ındaki "Kurucular /
//      Ortaklar" listesinin ta kendisi (bkz. src/lib/claimedProfiles.js).
//   3. Firmanın kendisi.
// Bu sırayla: firma en sona kalır ki yarıda kesilen bir tur, hâlâ canlı projeleri olan bir
// "arşivlenmiş firma" bırakmasın.
//
// SAYIM KAPISI: kullanıcı sayıları açıkça verdi (10 proje, 2 kurucu ortak). Beklenenden FARKLI
// bir sayı bulunursa betik HİÇBİR ŞEY YAZMADAN durur ve bulduğu listeyi basar — sessizce fazladan
// (ya da eksik) bir kaydı arşivlemek geri alınabilir olsa da kullanıcının istediği şey değildir.
// Sayı gerçekten değiştiyse --expect-projects=N / --expect-founders=N ile BİLİNÇLİ olarak geçilir.
//
// KULLANIM:
//   node scripts/archive-ofist.mjs                 # DRY-RUN (varsayılan) — hiçbir şey yazılmaz
//   node scripts/archive-ofist.mjs --apply         # gerçekten arşivle
//
// NEREDEN ÇALIŞTIRILIR: uzak (web/telefon) Claude oturumundan ÇALIŞTIRILAMAZ — o konteynerden
// `api.cloudflare.com` çıkışı ağ politikasıyla kapalıdır (ölçüldü, 2026-09-14: CONNECT'e 403).
// Bunun için .github/workflows/archive-ofist.yml var; runner'da hem ağ hem kimlik bilgisi vardır.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

// Worker global'i `caches` Node'da YOKTUR. invalidatePublicCache/purgeSsrDetailCache onu try/catch
// içinde kullanıyor, yani shim olmadan da düşmezdi; yine de sessizce yutulan bir ReferenceError
// yerine açık bir no-op vermek, log'daki "temizlendi" satırlarının ne anlama geldiğini netleştirir
// (scripts/test-2026-09-11-gundem-user-submissions.mjs'teki AYNI shim).
globalThis.caches ||= { default: { match: async () => undefined, put: async () => {}, delete: async () => true } };

const { runContentAction, runProjectAction } = await import('../src/routes/legacyContent.js');
const { bumpFacetCounts } = await import('../src/lib/facetCounts.js');

const ACCOUNT_ID = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim() || '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
// Varsayılan DRY-RUN: --apply verilmedikçe D1'e HİÇBİR ŞEY yazılmaz (migrate.yml/gundem-retitle.yml
// ile aynı sözleşme). --dry-run ayrıca kabul edilir ki archive-cinici.mjs'i bilen biri şaşırmasın.
const APPLY = !!args.apply && !args['dry-run'];

// Firma adı canonical `offices.name` ile birebir (runContentAction key ile bunu arar).
const OFFICE_NAME = 'Ofist';
const EXPECTED_PROJECTS = Number(args['expect-projects'] ?? 10);
const EXPECTED_FOUNDERS = Number(args['expect-founders'] ?? 2);

// ---------------------------------------------------------------------------------------------
// Kimlik bilgisi. YERELDE wrangler OAuth token'ı (depodaki diğer toplu betiklerle AYNI desen).
// CI'DA böyle bir oturum yok, sır olarak API token var — tanımlıysa wrangler dosyasına HİÇ
// bakılmaz (bakılsaydı betik runner'da daha ilk satırda düşerdi; bkz. gundem-retitle-backfill.mjs).
// ---------------------------------------------------------------------------------------------
const TOKEN_PATHS = [
  `${homedir()}/Library/Preferences/.wrangler/config/default.toml`,
  `${homedir()}/.wrangler/config/default.toml`,
  `${homedir()}/.config/.wrangler/config/default.toml`,
];
function oauthToken() {
  for (const p of TOKEN_PATHS) {
    try { const m = readFileSync(p, 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/); if (m) return m[1]; } catch { /* sıradaki yol */ }
  }
  throw new Error('wrangler OAuth token bulunamadı — `npx wrangler login` çalıştırın (ya da CLOUDFLARE_API_TOKEN verin).');
}
const TOKEN = (process.env.CLOUDFLARE_API_TOKEN || '').trim() || oauthToken();

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
console.log(`Admin: ${adminRow.email}${APPLY ? '' : '   [DRY-RUN — hiçbir şey yazılmayacak]'}\n`);

// ---------------------------------------------------------------------------------------------
// 1) OKU — arşivlenecek her şeyi ÖNCE topla, yazmadan önce tamamını bas.
// ---------------------------------------------------------------------------------------------
const { results: officeMatches } = await env.DB.prepare(
  `SELECT id, name, slug, hidden_at, preview_at FROM offices WHERE name = ? AND deleted_at IS NULL ORDER BY id`
).bind(OFFICE_NAME).all();
if (!officeMatches.length) throw new Error(`"${OFFICE_NAME}" firması bulunamadı.`);
// runContentAction anahtarla TEK satır bulur (findCanonicalRowByNaturalKey ... LIMIT 1); aynı adı
// taşıyan iki firma varsa hangisinin arşivleneceği SESSİZCE id sırasına düşerdi — burada dur.
if (officeMatches.length > 1) {
  throw new Error(`"${OFFICE_NAME}" adıyla ${officeMatches.length} firma var (${officeMatches.map(o => `#${o.id}/${o.slug}`).join(', ')}) — hangisinin arşivleneceği belirsiz, elle ayrıştırın.`);
}
const office = officeMatches[0];

// Firmanın künyesindeki projeler — canUserEditProjectBySlug'daki AYNI bağ (project_designers).
const { results: projects } = await env.DB.prepare(
  `SELECT DISTINCT p.id, p.slug, p.title, p.hidden_at, p.preview_at
     FROM project_designers pd JOIN projects p ON p.id = pd.project_id AND p.deleted_at IS NULL
    WHERE pd.office_id = ? ORDER BY p.title`
).bind(office.id).all();

// Kurucu ortaklar — firma pop-up'ının "Kurucular / Ortaklar" listesiyle AYNI kaynak
// (bkz. src/lib/claimedProfiles.js). architects.office_id ÜYELİK bağıdır, kurucu ortaklık DEĞİL;
// bu yüzden burada kullanılmaz, yalnızca aşağıda bilgi olarak raporlanır.
const { results: founders } = await env.DB.prepare(
  `SELECT a.id, a.name, a.slug, a.position, a.hidden_at, a.preview_at
     FROM office_founders f JOIN architects a ON a.id = f.architect_id AND a.deleted_at IS NULL
    WHERE f.office_id = ? ORDER BY a.name`
).bind(office.id).all();

// Yalnızca RAPOR: künyede firmaya bağlı ama kurucu ortak OLMAYAN kişiler. Bu betik onlara DOKUNMAZ
// — istek "2 adet kurucu ortağını" diyor. Yine de log'a basılır ki sayım kapısı düştüğünde
// eksiğin nerede olduğu tek bakışta görülsün.
const { results: members } = await env.DB.prepare(
  `SELECT a.id, a.name, a.slug, a.position FROM architects a
    WHERE a.office_id = ? AND a.deleted_at IS NULL
      AND a.id NOT IN (SELECT architect_id FROM office_founders WHERE office_id = ?)
    ORDER BY a.name`
).bind(office.id, office.id).all();

const state = r => (r.hidden_at ? (r.preview_at ? 'ÖNİZLEME' : 'ARŞİVDE') : 'yayında');
console.log(`Firma: ${office.name} (#${office.id} / ${office.slug}) — ${state(office)}`);
console.log(`\nKünyeli proje: ${projects.length} (beklenen ${EXPECTED_PROJECTS})`);
for (const p of projects) console.log(`  · ${p.title} (${p.slug}) — ${state(p)}`);
console.log(`\nKurucu ortak: ${founders.length} (beklenen ${EXPECTED_FOUNDERS})`);
for (const a of founders) console.log(`  · ${a.name} (${a.slug})${a.position ? ` — ${a.position}` : ''} — ${state(a)}`);
if (members.length) {
  console.log(`\nDOKUNULMAYACAK — firmaya bağlı ama kurucu ortak olmayan kişiler: ${members.length}`);
  for (const a of members) console.log(`  · ${a.name} (${a.slug})${a.position ? ` — ${a.position}` : ''}`);
}

// ---------------------------------------------------------------------------------------------
// 2) SAYIM KAPISI — yazmadan ÖNCE dur (dosya başındaki gerekçe).
// ---------------------------------------------------------------------------------------------
const mismatches = [];
if (projects.length !== EXPECTED_PROJECTS) mismatches.push(`proje: ${projects.length} bulundu, ${EXPECTED_PROJECTS} bekleniyordu`);
if (founders.length !== EXPECTED_FOUNDERS) mismatches.push(`kurucu ortak: ${founders.length} bulundu, ${EXPECTED_FOUNDERS} bekleniyordu`);
if (mismatches.length) {
  console.error(`\nDURDURULDU — beklenen sayı tutmuyor:\n  ${mismatches.join('\n  ')}`);
  console.error('Yukarıdaki liste gerçekten arşivlenmesi istenen kayıtlarsa, sayıyı BİLİNÇLİ olarak');
  console.error('--expect-projects=N / --expect-founders=N ile geçin. Hiçbir şey yazılmadı.');
  process.exit(1);
}

// Kurucu ortaklar isimle (canonical `architects.name`) arşivlenir — runContentAction'ın anahtar
// yolu budur. Aynı adı taşıyan ikinci bir kişi varsa hangi satırın arşivleneceği belirsizdir
// (findCanonicalRowByNaturalKey ... LIMIT 1); o durumda YAZMADAN dur.
for (const a of founders) {
  const dupe = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM architects WHERE name = ? AND deleted_at IS NULL`
  ).bind(a.name).first();
  if (dupe.n > 1) throw new Error(`"${a.name}" adıyla ${dupe.n} kişi profili var — anahtarla arşivleme hangisini seçeceğini bilemez, elle ayrıştırın. Hiçbir şey yazılmadı.`);
}

if (!APPLY) {
  console.log(`\n[DRY-RUN] Arşivlenecekti: ${projects.length} proje + ${founders.length} kurucu ortak + 1 firma.`);
  console.log(`Gerçekten arşivlemek için --apply ile çalıştırın. (${queryCount} D1 sorgusu)`);
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// 3) ARŞİVLE — canlı kod yolu (geri alınabilirlik için *_submissions taslağını da oluşturur).
//    Sıra: projeler -> kurucu ortaklar -> firma (dosya başındaki gerekçe).
// ---------------------------------------------------------------------------------------------
let failed = 0;
async function report(label, res) {
  if (res && res.status >= 400) { console.log(`  HATA ${label}: ${await res.text()}`); failed++; return; }
  console.log(`  arşivlendi: ${label}`);
}

console.log('\nProjeler:');
// skipFacets — bkz. scripts/archive-unassigned.mjs ve src/routes/unassignedArchive.js#archiveOne:
// facet yeniden hesabı (recomputeProjectFacets) TÜM proje havuzunu okuyup facet_counts tablosunu
// baştan yazar; kayıt başına çalıştırıldığında toplu tur D1 üzerinden dakikalarca sürer. Tur
// sonunda TEK SEFER yapılır — ara durumun facet sayaçları zaten hiçbir yerde okunmuyor.
for (const p of projects) await report(p.title, await runProjectAction(env, user, { action: 'archive', slug: p.slug, skipFacets: true }));
if (projects.length > failed) {
  process.stdout.write('  proje facet sayaçları yeniden hesaplanıyor… ');
  await bumpFacetCounts(env, 'projects');
  console.log('bitti');
}

console.log('Kurucu ortaklar:');
for (const a of founders) await report(a.name, await runContentAction(env, user, { type: 'architects', action: 'archive', key: a.name }));

console.log('Firma:');
await report(office.name, await runContentAction(env, user, { type: 'offices', action: 'archive', key: office.name }));

// ---------------------------------------------------------------------------------------------
// 4) DOĞRULA — "arşivledim" demeden ÖNCE canlı satırları GERİ OKU. hidden_at DOLU + preview_at
//    BOŞ = tam arşiv (soluk/önizleme kartı DEĞİL).
// ---------------------------------------------------------------------------------------------
async function verify(table, ids) {
  if (!ids.length) return { archived: 0, total: 0, bad: [] };
  const { results } = await env.DB.prepare(
    `SELECT id, ${table === 'projects' ? 'title' : 'name'} AS name_or_title, hidden_at, preview_at
       FROM ${table} WHERE id IN (${ids.map(() => '?').join(', ')})`
  ).bind(...ids).all();
  const bad = results.filter(r => !r.hidden_at || r.preview_at);
  return { archived: results.length - bad.length, total: ids.length, bad };
}
const vProjects = await verify('projects', projects.map(p => p.id));
const vFounders = await verify('architects', founders.map(a => a.id));
const vOffice = await verify('offices', [office.id]);

console.log('\nDOĞRULAMA (hidden_at dolu + preview_at boş = tam arşiv):');
console.log(`  projeler      : ${vProjects.archived}/${vProjects.total}`);
console.log(`  kurucu ortaklar: ${vFounders.archived}/${vFounders.total}`);
console.log(`  firma         : ${vOffice.archived}/${vOffice.total}`);
for (const r of [...vProjects.bad, ...vFounders.bad, ...vOffice.bad]) {
  console.log(`  EKSİK: ${r.name_or_title} — hidden_at=${r.hidden_at || 'BOŞ'} preview_at=${r.preview_at || 'boş'}`);
}

const allOk = failed === 0 && vProjects.bad.length === 0 && vFounders.bad.length === 0 && vOffice.bad.length === 0;
console.log(`\n${allOk ? 'Bitti — hepsi arşivde.' : 'BİTTİ AMA EKSİK VAR (yukarıya bakın).'} (${queryCount} D1 sorgusu)`);
console.log('NOT: KV havuz anahtarları (pool:*) elle temizlenmeli — bkz. [[project_pool_cache_needs_manual_purge_after_query_logic_deploy]].');
if (!allOk) process.exit(1);
