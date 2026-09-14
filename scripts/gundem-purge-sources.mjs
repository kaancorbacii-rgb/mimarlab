#!/usr/bin/env node
// GÜNDEM — KALDIRILAN KAYNAKLARIN İÇERİĞİNİ SİL
// (kullanıcı isteği, 2026-09-14: "Gündem sayfası içim çekilen içerik kaynaklarından mimdap,
// arkitera, bigumigu kaynaklarını sil. Ayrıca gündem sayfasındaki bu kaynaklara dair içerikleri
// de sil.")
//
// Kaynakların KENDİSİ yapılandırmadan çıkarıldı (bkz. src/lib/gundemSources.js'teki "KALDIRILAN
// TÜRKÇE KAYNAKLAR" notu) — yani bundan sonra o sitelere hiç gidilmez. Bu betik, o kaynaklardan
// DAHA ÖNCE çekilmiş ve D1'de duran satırları temizler.
//
// scripts/archive-brands-and-products.mjs / archive-ofist.mjs İLE AYNI desen ve AYNI gerekçe:
// silme elle `DELETE` ile YAPILMAZ, CANLI KODDAN (handleGundemAdminRoute'un DELETE dalı ->
// deleteGundemItem) import edilir — o dal bilgi grafiği kenarlarını (gundem_entities) da siler ve
// hem liste hem tekil sayfa önbelleğini (purgeGundemCache + purgeSsrDetailCache) düşürür. Elle
// DELETE, yetim gundem_entities satırları ve s-maxage boyunca canlıda duran ölü sayfalar bırakırdı.
//
// ARŞİVLEME DEĞİL, KALICI SİLME. gundemAdmin.js#deleteGundemItem'in başındaki uyarı ("silinen
// içerik bir sonraki turda yeniden çekilebilir") BURADA GEÇERLİ DEĞİL: kaynak yapılandırmadan da
// çıktığı için o feed'lere bir daha hiç gidilmez, dolayısıyla mükerrer kaydının tutulmasına gerek
// yoktur. Kullanıcı da "sil" dedi.
//
// ÜÇ TEMİZLİK:
//   1) gundem_items satırları (+ gundem_entities kenarları, canlı silme yolundan),
//   2) gundem_source_health satırları — artık var olmayan kaynakların sağlık sayaçları admin
//      panelindeki kaynak tablosunda "ölü satır" olarak durmasın,
//   3) extra_sources içindeki İKİNCİL atıflar: BAŞKA bir yayıncının (ör. Dezeen) satırı, aynı
//      haberi yazan ikincil kaynak olarak arkitera/mimdap/bigumigu'yu listeliyor olabilir. O SATIR
//      SİLİNMEZ (içerik o yayıncınındır) — yalnızca kaldırılan yayıncının atfı listeden çıkarılır,
//      böylece sitede o kaynaklara giden bağlantı kalmaz.
//
// VARSAYILAN DRY-RUN: --apply verilmedikçe D1'e hiçbir şey yazılmaz.
//
// KULLANIM:
//   node scripts/gundem-purge-sources.mjs                   # DRY-RUN, planı basar
//   node scripts/gundem-purge-sources.mjs --apply           # gerçekten sil
//   node scripts/gundem-purge-sources.mjs --expect=N --apply # sayım kapısı: N değilse hiçbir şey yazma
//
// NEREDEN ÇALIŞTIRILIR: uzak (web/telefon) Claude oturumundan ÇALIŞTIRILAMAZ — o konteynerden
// api.cloudflare.com çıkışı ağ politikasıyla kapalıdır. Bunun için
// .github/workflows/gundem-purge-sources.yml var (workflow_dispatch ile elle tetiklenir).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

globalThis.caches ||= { default: { match: async () => undefined, put: async () => {}, delete: async () => true } };

const { handleGundemAdminRoute } = await import('../src/routes/gundemAdmin.js');

// Kaldırılan kaynakların ALAN ADLARI. source_id DEĞİL domain üzerinden eşleşilir: id'ler kategori
// başına ayrışıyordu (arkitera-haber/-etkinlik/-yarisma) ve zaman içinde değişmiş olabilir; alan adı
// ise satırın hangi yayıncıdan geldiğinin değişmeyen kimliğidir. www. öneki normalize edilir.
const REMOVED_DOMAINS = ['arkitera.com', 'mimdap.org', 'bigumigu.com'];
// Sağlık tablosunda temizlenecek kaynak id'leri (yapılandırmadan çıkarılanlar).
const REMOVED_SOURCE_IDS = ['arkitera-haber', 'arkitera-etkinlik', 'arkitera-yarisma', 'mimdap', 'bigumigu'];

const normDomain = (d) => String(d || '').trim().toLowerCase().replace(/^www\./, '');
const isRemovedDomain = (d) => REMOVED_DOMAINS.includes(normDomain(d));

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
console.log(`Kaldırılan kaynaklar: ${REMOVED_DOMAINS.join(', ')}${APPLY ? '' : '   [DRY-RUN — hiçbir şey yazılmayacak]'}\n`);

// ---------------------------------------------------------------------------------------------
// 1) OKU — silinecek satırlar
// ---------------------------------------------------------------------------------------------
const ph = REMOVED_DOMAINS.map(() => '?').join(', ');
const { results: itemRows } = await env.DB.prepare(
  `SELECT id, slug, title, source_name, source_domain, source_id, status
     FROM gundem_items
    WHERE LOWER(REPLACE(source_domain, 'www.', '')) IN (${ph})
    ORDER BY published_at DESC`
).bind(...REMOVED_DOMAINS).all();
const items = itemRows || [];

// extra_sources'ta ikincil atıf taşıyan (ama KENDİSİ başka yayıncıya ait) satırlar.
const { results: extraRows } = await env.DB.prepare(
  `SELECT id, slug, source_domain, extra_sources FROM gundem_items
    WHERE extra_sources IS NOT NULL AND extra_sources != '' AND extra_sources != '[]'`
).all();
const extraFixes = [];
for (const r of extraRows || []) {
  if (isRemovedDomain(r.source_domain)) continue; // satırın kendisi zaten silinecek
  let parsed;
  try { parsed = JSON.parse(r.extra_sources); } catch { continue; }
  if (!Array.isArray(parsed)) continue;
  const kept = parsed.filter(x => !(x && isRemovedDomain(x.domain)));
  if (kept.length !== parsed.length) extraFixes.push({ id: r.id, slug: r.slug, before: parsed.length, after: kept.length, value: kept.length ? JSON.stringify(kept) : null });
}

const { results: healthRows } = await env.DB.prepare(
  `SELECT source_id FROM gundem_source_health WHERE source_id IN (${REMOVED_SOURCE_IDS.map(() => '?').join(', ')})`
).bind(...REMOVED_SOURCE_IDS).all();

// ---------------------------------------------------------------------------------------------
// 2) PLANI BAS
// ---------------------------------------------------------------------------------------------
const byDomain = new Map();
for (const it of items) byDomain.set(normDomain(it.source_domain), (byDomain.get(normDomain(it.source_domain)) || 0) + 1);
console.log('SİLİNECEK GÜNDEM İÇERİKLERİ');
for (const d of REMOVED_DOMAINS) console.log(`  ${d.padEnd(16)} ${byDomain.get(d) || 0}`);
console.log(`  TOPLAM           ${items.length}`);
for (const it of items.slice(0, 20)) console.log(`    - [${it.status}] ${it.source_name}: ${it.title}`);
if (items.length > 20) console.log(`    ... ve ${items.length - 20} tane daha`);
console.log(`\nEXTRA_SOURCES'TAN ÇIKARILACAK İKİNCİL ATIF: ${extraFixes.length} satır`);
for (const f of extraFixes.slice(0, 10)) console.log(`    - ${f.slug}: ${f.before} -> ${f.after}`);
console.log(`\nSİLİNECEK KAYNAK SAĞLIK SATIRI: ${(healthRows || []).length} (${(healthRows || []).map(r => r.source_id).join(', ') || '—'})`);

// SAYIM KAPISI — beklenen sayı verildiyse ve tutmuyorsa hiçbir şey yazma.
if (args.expect !== undefined && Number(args.expect) !== items.length) {
  console.error(`\nDURDURULDU: --expect=${args.expect} verildi ama ${items.length} içerik bulundu. Hiçbir şey yazılmadı.`);
  process.exit(2);
}
if (!APPLY) {
  console.log('\nDRY-RUN bitti. Gerçekten silmek için --apply ekleyin.');
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// 3) UYGULA — canlı silme yolundan, tek tek (önbellek purge'ü satır başına çalışır)
// ---------------------------------------------------------------------------------------------
let deleted = 0, failed = 0;
for (const it of items) {
  const req = new Request(`https://mimarlab.com/api/admin/gundem/${encodeURIComponent(it.id)}`, { method: 'DELETE' });
  try {
    const res = await handleGundemAdminRoute(req, env, ['api', 'admin', 'gundem', it.id]);
    if (res.status >= 400) { failed++; console.error(`  HATA ${it.slug}: HTTP ${res.status}`); continue; }
    deleted++;
    if (deleted % 25 === 0) console.log(`  ...${deleted}/${items.length}`);
  } catch (err) {
    failed++;
    console.error(`  HATA ${it.slug}: ${err.message}`);
  }
}

let extraUpdated = 0;
for (const f of extraFixes) {
  await env.DB.prepare(`UPDATE gundem_items SET extra_sources = ?, updated_at = ? WHERE id = ?`)
    .bind(f.value, Date.now(), f.id).run();
  extraUpdated++;
}

let healthDeleted = 0;
if ((healthRows || []).length) {
  await env.DB.prepare(
    `DELETE FROM gundem_source_health WHERE source_id IN (${REMOVED_SOURCE_IDS.map(() => '?').join(', ')})`
  ).bind(...REMOVED_SOURCE_IDS).run();
  healthDeleted = healthRows.length;
}

// Yetim kenar kalmadığını doğrula (deleteGundemItem zaten siliyor — bu, sessiz bir kaçağı yakalar).
const orphan = await env.DB.prepare(
  `SELECT COUNT(*) AS n FROM gundem_entities e WHERE NOT EXISTS (SELECT 1 FROM gundem_items i WHERE i.id = e.item_id)`
).first('n');

console.log(`\nBİTTİ — ${deleted} içerik silindi, ${failed} hata; ${extraUpdated} ikincil atıf temizlendi; ${healthDeleted} sağlık satırı silindi.`);
console.log(`Yetim gundem_entities satırı: ${orphan || 0}`);
process.exit(failed ? 1 : 0);
