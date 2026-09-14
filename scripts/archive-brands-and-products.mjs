#!/usr/bin/env node
// TÜM SAF MARKALARI, TÜM ÜRÜNLERİ VE MARKALARA AİT KİŞİLERİ ARŞİVE AL
// (kullanıcı isteği, 2026-09-14: "Tüm markaları, ürünleri ve markalara ait kişileri arşive al".)
//
// scripts/archive-ofist.mjs / archive-cinici.mjs İLE AYNI desen ve AYNI gerekçe: arşivleme elle
// `UPDATE ... hidden_at` ile YAPILMAZ, CANLI KODDAN (runContentAction) import edilir — aksi halde
// geri alınabilirliği sağlayan *_submissions taslağı hiç oluşmaz ve kayıt "Arşivim > Yayına Al"
// ile geri getirilemez (bkz. [[project_bulk_admin_ops_via_live_code_2026_09_08]]).
//
// KAPSAM — kullanıcı 2026-09-14'te İKİ soruyu da açıkça yanıtladı:
//   MARKA  = YALNIZCA SAF MARKA (office-kind.js#isPureBrandOffice): hiçbir mimarlık hizmeti
//            sunmayan, yalnızca marka.html'de listelenen ofis (VitrA gibi). Autoban,
//            +MURAT TABANLIOĞLU gibi HEM mimarlık yapan HEM ürün tasarlayan ofisler KAPSAM DIŞI —
//            isBrandOffice onları da marka sayardı ve arşiv cascade'i mimari projelerini de
//            götürürdü; kullanıcı bunu istemedi.
//   ÜRÜN   = TÜM KATALOG: products tablosunun her satırı, kind='product' VE kind='material'
//            (Yapı Malzemesi dahil).
//   KİŞİ   = markaya bağlı kişiler. AYRICA ARŞİVLENMEZ — markayı arşivlemek zaten
//            src/routes/legacyContent.js#archiveOfficeGraph cascade'ini tetikler ve o, kişileri
//            ORTAK KÜNYE KORUMASIYLA arşivler: hâlâ YAYINDA olan başka bir firmanın da kurucusu
//            olan kişi korunur. Kişileri burada tek tek arşivlemek o korumayı BYPASS ederdi.
//
// SIRA — önce ürünler, sonra markalar (archive-ofist.mjs'teki AYNI gerekçe: yarıda kesilen bir tur,
// hâlâ canlı ürünleri olan "arşivlenmiş bir marka" bırakmasın). Markayı arşivlerken cascade kalan
// bağlı kayıtları zaten toplar; önceden arşivlenmiş olanları idempotans gereği atlar.
//
// SINIFLANDIRMA ANLIK GÖRÜNTÜ İLE — isBrandOffice(cats, productCount) ÜRÜN SAYISINA da bakar
// (productCount > 0 ise marka). Ürünler önce arşivlenince sayı 0'a düşer ve yalnızca ürünü olduğu
// için marka sayılan bir ofis tur ortasında "marka değil"e dönerdi. Bu yüzden marka listesi EN
// BAŞTA, hiçbir şey yazılmadan hesaplanır ve tur boyunca o SABİT liste kullanılır.
//
// VARSAYILAN DRY-RUN: --apply verilmedikçe D1'e hiçbir şey yazılmaz.
//
// KULLANIM:
//   node scripts/archive-brands-and-products.mjs                  # DRY-RUN, planı basar
//   node scripts/archive-brands-and-products.mjs --apply          # gerçekten arşivle
//   node scripts/archive-brands-and-products.mjs --expect-brands=N --expect-products=N --apply
//
// SAYIM KAPISI: --expect-* verilirse ve bulunan sayı farklıysa betik HİÇBİR ŞEY YAZMADAN durur.
//
// NEREDEN ÇALIŞTIRILIR: uzak (web/telefon) Claude oturumundan ÇALIŞTIRILAMAZ — o konteynerden
// api.cloudflare.com çıkışı ağ politikasıyla kapalıdır. Bunun için
// .github/workflows/archive-brands-and-products.yml var.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

globalThis.caches ||= { default: { match: async () => undefined, put: async () => {}, delete: async () => true } };

const { runContentAction } = await import('../src/routes/legacyContent.js');
const { collectOfficeArchiveTargets } = await import('../src/lib/officeArchiveCascade.js');
const { parseCanonicalRow } = await import('../src/lib/canonicalRead.js');
const officeKind = (await import('../office-kind.js')).default;
const { isPureBrandOffice } = officeKind;

const ACCOUNT_ID = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim() || '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const APPLY = !!args.apply && !args['dry-run'];

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

async function rawQuery(sql, params = []) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
      { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }) }
    );
    const json = await res.json().catch(() => null);
    if (json && json.success) return json.result[0];
    const msg = JSON.stringify((json && json.errors) || res.status);
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

// "Tam arşivde" = hidden_at DOLU + preview_at BOŞ. Önizlemedekiler (hidden_at DOLU + preview_at
// DOLU) sitede hâlâ soluk kart olarak görünür, yani arşivlenmeleri GEREKİR — bkz.
// src/lib/officeArchiveCascade.js#isAlreadyArchived (2026-09-14 düzeltmesi).
const alreadyArchived = (r) => !!r.hidden_at && !r.preview_at;

// ---------------------------------------------------------------------------------------------
// 1) OKU — marka listesi ÖNCE ve SABİT (yukarıdaki "anlık görüntü" notu).
// ---------------------------------------------------------------------------------------------
const { results: officeRows } = await env.DB.prepare(
  `SELECT id, name, slug, cats, hidden_at, preview_at FROM offices WHERE deleted_at IS NULL ORDER BY id`
).all();
const { results: countRows } = await env.DB.prepare(
  `SELECT brand_office_id AS id, COUNT(*) AS n FROM products
    WHERE deleted_at IS NULL AND hidden_at IS NULL AND brand_office_id IS NOT NULL
    GROUP BY brand_office_id`
).all();
const productCountByOffice = new Map((countRows || []).map(r => [r.id, r.n]));

const brands = (officeRows || []).filter(o => {
  const cats = parseCanonicalRow('offices', o).cats;
  return isPureBrandOffice(cats, productCountByOffice.get(o.id) || 0);
});
const brandsToArchive = brands.filter(o => !alreadyArchived(o));

const { results: productRows } = await env.DB.prepare(
  `SELECT id, slug, title, kind, hidden_at, preview_at FROM products WHERE deleted_at IS NULL ORDER BY id`
).all();
const productsToArchive = (productRows || []).filter(p => !alreadyArchived(p));

// Markaların künyesindeki kişiler — cascade'in KENDİ toplayıcısıyla önizlenir (ortak künye
// koruması dahil), böylece plan ile gerçek tur aynı kuralı kullanır.
const peoplePreview = new Map();
const peopleSkipped = new Map();
for (const b of brandsToArchive) {
  const t = await collectOfficeArchiveTargets(env, b);
  for (const a of t.architects) peoplePreview.set(a.key, a.label);
  for (const name of t.skipped.architects) peopleSkipped.set(name, true);
}

console.log(`SAF MARKA (isPureBrandOffice): ${brands.length} bulundu, ${brandsToArchive.length} arşivlenecek`);
for (const b of brandsToArchive) console.log(`   · ${b.name}${b.preview_at ? '  [önizlemede]' : ''}`);
console.log(`\nÜRÜN + YAPI MALZEMESİ: ${productRows.length} bulundu, ${productsToArchive.length} arşivlenecek`);
console.log(`   (ürün: ${productsToArchive.filter(p => p.kind !== 'material').length}, yapı malzemesi: ${productsToArchive.filter(p => p.kind === 'material').length})`);
console.log(`\nMARKAYA BAĞLI KİŞİ (cascade arşivleyecek): ${peoplePreview.size}`);
for (const label of peoplePreview.values()) console.log(`   · ${label}`);
if (peopleSkipped.size) {
  console.log(`\nKORUNAN KİŞİ (hâlâ YAYINDA olan başka bir firmanın da künyesinde): ${peopleSkipped.size}`);
  for (const name of peopleSkipped.keys()) console.log(`   · ${name}`);
}

// Sayım kapısı — yalnızca açıkça verildiyse.
if (args['expect-brands'] !== undefined && Number(args['expect-brands']) !== brandsToArchive.length) {
  throw new Error(`Marka sayısı beklenenden farklı: beklenen ${args['expect-brands']}, bulunan ${brandsToArchive.length} — hiçbir şey yazılmadı.`);
}
if (args['expect-products'] !== undefined && Number(args['expect-products']) !== productsToArchive.length) {
  throw new Error(`Ürün sayısı beklenenden farklı: beklenen ${args['expect-products']}, bulunan ${productsToArchive.length} — hiçbir şey yazılmadı.`);
}

if (!APPLY) {
  console.log('\n[DRY-RUN] Hiçbir şey yazılmadı. Gerçekten arşivlemek için --apply ile çalıştır.');
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// 2) YAZ — önce ürünler, sonra markalar (cascade kişileri toplar).
// ---------------------------------------------------------------------------------------------
const failed = [];
let done = 0;
console.log('\n--- ÜRÜNLER ---');
for (const p of productsToArchive) {
  const type = p.kind === 'material' ? 'materials' : 'products';
  const res = await runContentAction(env, user, { type, action: 'archive', key: p.slug });
  if (res && res.status >= 400) { failed.push(`${type}/${p.slug}`); console.log(`   HATA ${p.title || p.slug} (${res.status})`); }
  else done++;
  if (done % 25 === 0) console.log(`   ... ${done}/${productsToArchive.length}`);
}
console.log(`Ürün arşivlendi: ${done}/${productsToArchive.length}`);

console.log('\n--- MARKALAR (cascade: kişi + kalan bağlı kayıtlar) ---');
let brandsDone = 0;
const cascadeArchived = { architects: [], projects: [], products: [] };
const cascadeSkipped = { architects: [], projects: [], products: [] };
for (const b of brandsToArchive) {
  const res = await runContentAction(env, user, { type: 'offices', action: 'archive', key: b.name });
  if (res && res.status >= 400) { failed.push(`offices/${b.name}`); console.log(`   HATA ${b.name} (${res.status})`); continue; }
  brandsDone++;
  const body = await res.json().catch(() => ({}));
  const c = body && body.cascade;
  if (c) {
    for (const k of ['architects', 'projects', 'products']) {
      cascadeArchived[k].push(...(c.archived?.[k] || []));
      cascadeSkipped[k].push(...(c.skipped?.[k] || []));
    }
  }
  console.log(`   ${b.name} — cascade: ${(c?.archived?.architects || []).length} kişi, ${(c?.archived?.projects || []).length} proje, ${(c?.archived?.products || []).length} ürün`);
}

console.log(`\n=== ÖZET ===`);
console.log(`Marka arşivlendi   : ${brandsDone}/${brandsToArchive.length}`);
console.log(`Ürün arşivlendi    : ${done}/${productsToArchive.length}`);
console.log(`Cascade ile kişi   : ${cascadeArchived.architects.length}`);
console.log(`Cascade ile proje  : ${cascadeArchived.projects.length}`);
if (cascadeSkipped.architects.length || cascadeSkipped.projects.length || cascadeSkipped.products.length) {
  console.log(`Korundu (ortak künye) — kişi: ${cascadeSkipped.architects.length}, proje: ${cascadeSkipped.projects.length}, ürün: ${cascadeSkipped.products.length}`);
}
if (failed.length) { console.log(`\nBAŞARISIZ (${failed.length}): ${failed.join(', ')}`); process.exit(1); }
console.log('Tamam.');
