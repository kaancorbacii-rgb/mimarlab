#!/usr/bin/env node
// İÇERİĞİ OLMAYAN BLURLU (ÖNİZLEME) KİŞİ ve FİRMALARI KALICI OLARAK SİL
// (kullanıcı isteği, 2026-09-17 üçüncü tur: "projesi olmayan blurlu kişi ve firmaları sil" + dördüncü
//  tur: "Üzerinde herhangi bir proje, ürün, fotoğraf ya da kullanıcı ataması olmayan blurlu kişi ve
//  firmaları canlı siteden ve arşivden sil." — örnek: Zeynep Mutlu + Mimarize Mimarlık, birbirinin
//  kurucusu/firması olan ve başka hiçbir şeyi olmayan iki blurlu profil.)
//
// SİLME, ARŞİV DEĞİL: admin panelindeki "Sil" ile BİREBİR aynı canlı yol —
// runContentAction({ action:'delete', key }). Canonical satır + join kenarları + karaliste +
// *_submissions taslakları (Arşiv sekmesinden de düşer) + etkileşimler. GERİ ALINAMAZ.
//
// İÇERİK SAYILANLAR (biri bile varsa profil KORUNUR; şüphede korunur):
//   KİŞİ : proje (pop-up'taki + arşivdekiler dahil project_designers kenarı), FOTOĞRAF (fotoğrafladığı
//          projeler, project_photographers kenarı, künyenin fotoğraf satırında adı), ÜRÜN (pop-up +
//          product_architects kenarı), portfolyo, KULLANICI ATAMASI/sahiplik (fetchOwnership).
//   FİRMA: proje (pop-up + project_designers/project_brands kenarı + arşiv cascade'inin projeleri),
//          ÜRÜN (pop-up + products.brand_office_id + cascade ürünleri), fotoğraf künyesinde adı,
//          KULLANICI ATAMASI/sahiplik.
// İÇERİK SAYILMAYAN: kişi <-> firma bağı (kurucu/ekip/birincil firma). Kullanıcının örneği tam
// olarak bu: yalnızca birbirine bağlı iki boş profil.
//
// BAĞ KAPANIŞI (güvenlik): bir aday, kişi<->firma bağıyla içeriği OLAN (silinmeyecek) bir profile
// bağlıysa o da KORUNUR ve bu kural sabit noktaya kadar yayılır. Aksi halde içeriği olan bir firmanın
// Kurucular/Ekip listesinden kişiler, projeli bir kişinin künyesinden firması sessizce koparılırdı.
// Yani yalnızca TAMAMEN boş kümeler (örnekteki çift gibi) silinir.
//
// VARSAYILAN DRY-RUN. Yazmak için --apply. Sayım kapıları --expect-architects=N --expect-offices=N.
// --skip=a,b (slug ya da ad) elle dışlama — dışlanan da "korunan" sayılır ve bağ kapanışına girer.
// KULLANIM: node scripts/delete-projectless-preview-profiles.mjs [--apply] [--skip=...] [--expect-architects=N] [--expect-offices=N]
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

globalThis.caches ||= { default: { match: async () => undefined, put: async () => {}, delete: async () => true } };

const { runContentAction } = await import('../src/routes/legacyContent.js');
const { buildOfficePayload } = await import('../src/routes/office.js');
const { buildArchitectPayload } = await import('../src/routes/architect.js');
const { collectOfficeArchiveTargets } = await import('../src/lib/officeArchiveCascade.js');
const { parseCanonicalRow } = await import('../src/lib/canonicalRead.js');
const { foldTr } = await import('../src/lib/textMatch.js');
const { PROFILE_KINDS, fetchPreviewProfiles, fetchPhotographerNameFolds, fetchOwnership, parseSkipList, isSkipped } =
  await import('../src/lib/emptyProfileAudit.js');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const APPLY = !!args.apply && !args['dry-run'];
const CONCURRENCY = Math.max(1, Number(args.concurrency) || 6);

const ACCOUNT_ID = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim() || '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';


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
let TOKEN = (process.env.CLOUDFLARE_API_TOKEN || '').trim() || oauthToken();
// wrangler OAuth token'ı ~1 saatte dolar ve bu betiğin taraması o süreyi aşabilir (bkz. hafıza notu
// project_wrangler_oauth_token_expires_mid_script). 7403 gelince `wrangler whoami` token'ı yeniler,
// dosyadan yeniden okunur ve istek tekrarlanır. Yalnızca OAuth yolunda — CLOUDFLARE_API_TOKEN dolmaz.
let refreshing = null;
async function refreshToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return false;
  if (!refreshing) {
    refreshing = (async () => {
      const { execSync } = await import('node:child_process');
      try { execSync('npx wrangler whoami', { stdio: 'ignore' }); } catch { /* yine de dosyayı oku */ }
      TOKEN = oauthToken();
      console.log('   (wrangler token yenilendi)');
    })().finally(() => { setTimeout(() => { refreshing = null; }, 30000); });
  }
  await refreshing;
  return true;
}

async function rawQuery(sql, params = []) {
  const MAX_ATTEMPTS = 6;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Ağ seviyesi hata (EHOSTUNREACH, ECONNRESET, timeout...) fetch()'in KENDİSİNDEN fırlar — bir
    // HTTP yanıtı hiç gelmez. GERÇEK BULGU: bu try/catch olmadan böyle bir hata denemeyi hiç
    // atlamadan sürecin tamamını (yüzlerce kayıtlık bir silme koşusunun ortasında) çökertiyordu.
    let res;
    try {
      res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
        { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }) }
      );
    } catch (netErr) {
      if (attempt === MAX_ATTEMPTS) throw new Error(`Ağ hatası (${MAX_ATTEMPTS} denemeden sonra): ${netErr.message}\n${sql}`);
      await new Promise(r => setTimeout(r, 500 * attempt));
      continue;
    }
    const json = await res.json().catch(() => null);
    if (json && json.success) return json.result[0];
    const msg = JSON.stringify((json && json.errors) || res.status);
    if ((msg.includes('7403') || msg.includes('10000')) && attempt < MAX_ATTEMPTS && await refreshToken()) continue;
    if (msg.includes('7403') || msg.includes('10000')) throw new Error(`D1 yetkilendirme hatası (token dolmuş olabilir): ${msg}`);
    if (attempt === MAX_ATTEMPTS) throw new Error(`D1 sorgusu başarısız: ${msg}\n${sql}`);
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


// R2 bağlaması Node'da yok: silme yolu görsel anahtarlarını R2'den silmeye çalışır. Burada no-op —
// yetim kalan görseller r2Reconcile taramasıyla temizlenir; satırlar yine eksiksiz silinir.
const env = {
  DB: d1(),
  UPLOADS: { head: async () => null, delete: async () => {}, get: async () => null, list: async () => ({ objects: [], truncated: false }) },
};
const adminRow = await env.DB.prepare(`SELECT id, email FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`).first();
if (!adminRow) throw new Error('Admin kullanıcı bulunamadı.');
const user = { id: adminRow.id, role: 'admin' };
console.log(`Admin: ${adminRow.email}${APPLY ? '   [SİLME AÇIK]' : '   [DRY-RUN — YAZMA YOK]'}\n`);

async function idSet(sql) {
  const { results } = await env.DB.prepare(sql).all();
  return new Set((results || []).map(r => r.id).filter(Boolean));
}
const union = (...sets) => new Set(sets.flatMap(x => [...x]));
// Yapısal İÇERİK kenarları — pop-up'ın göremediği (arşivdeki kayıtlara giden) bağlar dahil.
const archProjectEdge = union(
  await idSet(`SELECT DISTINCT architect_id AS id FROM project_designers WHERE architect_id IS NOT NULL`));
const archPhotoEdge = await idSet(`SELECT DISTINCT architect_id AS id FROM project_photographers WHERE architect_id IS NOT NULL`);
const archProductEdge = await idSet(`SELECT DISTINCT architect_id AS id FROM product_architects WHERE architect_id IS NOT NULL`);
const officeProjectEdge = union(
  await idSet(`SELECT DISTINCT office_id AS id FROM project_designers WHERE office_id IS NOT NULL`),
  await idSet(`SELECT DISTINCT office_id AS id FROM project_brands WHERE office_id IS NOT NULL`));
const officeProductEdge = await idSet(`SELECT DISTINCT brand_office_id AS id FROM products WHERE brand_office_id IS NOT NULL`);

// Kişi <-> firma bağ grafı (İÇERİK DEĞİL, yalnızca bağ kapanışı için). Canlı profiller de düğümdür.
const { results: founderRows } = await env.DB.prepare(`SELECT architect_id AS a, office_id AS o FROM office_founders WHERE architect_id IS NOT NULL AND office_id IS NOT NULL`).all();
const { results: primaryRows } = await env.DB.prepare(`SELECT id AS a, office_id AS o FROM architects WHERE office_id IS NOT NULL AND deleted_at IS NULL`).all();
const links = new Map();
const addLink = (x, y) => { (links.get(x) || links.set(x, new Set()).get(x)).add(y); };
for (const r of [...(founderRows || []), ...(primaryRows || [])]) { addLink(`a:${r.a}`, `o:${r.o}`); addLink(`o:${r.o}`, `a:${r.a}`); }

const photographerFolds = await fetchPhotographerNameFolds(env);
const ownership = { architects: await fetchOwnership(env, 'architects'), offices: await fetchOwnership(env, 'offices') };

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i]);
      if (++done % 50 === 0) console.log(`   ... tarandı ${done}/${list.length}`);
    }
  }));
  return out;
}

async function auditKind(kind) {
  const rows = await fetchPreviewProfiles(env, kind);
  console.log(`Blurlu (önizleme) ${PROFILE_KINDS[kind].label}: ${rows.length}`);
  return mapLimit(rows, CONCURRENCY, async (raw) => {
    const row = parseCanonicalRow(kind, raw);
    const own = ownership[kind];
    const owned = own.ownedIds.has(row.id) || own.claimedFolds.has(foldTr(row.name || '')) || own.consultantSlugs.has(row.slug);
    const photoCredit = photographerFolds.has(foldTr(row.name || ''));
    const content = {};
    if (kind === 'architects') {
      const p = await buildArchitectPayload(env, row.slug);
      content.proje = (p.relatedProjects || []).length + (archProjectEdge.has(row.id) ? 1 : 0);
      content.fotograf = (p.photographedProjects || []).length + (archPhotoEdge.has(row.id) ? 1 : 0) + (photoCredit ? 1 : 0);
      content.urun = (p.relatedProducts || []).length + (archProductEdge.has(row.id) ? 1 : 0);
      content.portfolyo = ((p.item || {}).portfolio || []).length;
    } else {
      const p = await buildOfficePayload(env, row.slug);
      const cascade = await collectOfficeArchiveTargets(env, row);
      content.proje = (p.relatedProjects || []).length + (officeProjectEdge.has(row.id) ? 1 : 0)
        + (cascade.projects || []).length + (cascade.skipped?.projects || []).length;
      content.urun = (p.relatedProducts || []).length + (p.relatedMaterials || []).length + (officeProductEdge.has(row.id) ? 1 : 0)
        + (cascade.products || []).length + (cascade.skipped?.products || []).length;
      content.fotograf = photoCredit ? 1 : 0;
    }
    content.atama = owned ? 1 : 0;
    const node = `${kind === 'architects' ? 'a' : 'o'}:${row.id}`;
    return { kind, node, id: row.id, name: row.name, slug: row.slug, content, empty: Object.values(content).every(n => !n) };
  });
}

const audits = [...(await auditKind('architects')), ...(await auditKind('offices'))];
const skipFolds = parseSkipList(args.skip === true ? '' : args.skip);

// Aday kümesi: içeriği yok + elle dışlanmamış. Bağ kapanışı: aday DIŞINDAKİ (canlı, içerikli,
// dışlanmış) bir düğüme bağlı aday korunur; sabit noktaya kadar tekrar.
const candidates = new Set(audits.filter(a => a.empty && !isSkipped(a, skipFolds)).map(a => a.node));
const protectedByLink = new Map();
for (let changed = true; changed;) {
  changed = false;
  for (const node of [...candidates]) {
    const blocker = [...(links.get(node) || [])].find(n => !candidates.has(n));
    if (blocker) { candidates.delete(node); protectedByLink.set(node, blocker); changed = true; }
  }
}
const byNode = new Map(audits.map(a => [a.node, a]));
const describe = (node) => byNode.get(node) ? `${byNode.get(node).name}` : `canlı profil (${node})`;
const contentText = (a) => Object.entries(a.content).filter(([, n]) => n).map(([k]) => k).join(', ');

const toDelete = audits.filter(a => candidates.has(a.node));
const del = { architects: toDelete.filter(a => a.kind === 'architects'), offices: toDelete.filter(a => a.kind === 'offices') };
for (const kind of ['offices', 'architects']) {
  console.log(`\n=== SİLİNECEK ${PROFILE_KINDS[kind].label.toUpperCase()}: ${del[kind].length} ===`);
  for (const a of del[kind]) console.log(`   · ${a.name}   (${a.slug})`);
}
const skipped = audits.filter(a => a.empty && isSkipped(a, skipFolds));
if (skipped.length) { console.log(`\n=== ELLE DIŞLANDI (--skip): ${skipped.length} ===`); for (const a of skipped) console.log(`   · ${a.name}   (${a.slug})`); }
console.log(`\n=== KORUNDU — boş ama içeriği OLAN bir profile bağlı: ${protectedByLink.size} ===`);
for (const [node, blocker] of protectedByLink) console.log(`   · ${byNode.get(node).name} <- ${describe(blocker)}`);
const kept = audits.filter(a => !a.empty);
console.log(`\n=== DOKUNULMADI — içeriği var: ${kept.length} (kişi ${kept.filter(a => a.kind === 'architects').length}, firma ${kept.filter(a => a.kind === 'offices').length}) ===`);
const tally = {};
for (const a of kept) for (const [k, n] of Object.entries(a.content)) if (n) tally[k] = (tally[k] || 0) + 1;
console.log(`   içerik türüne göre: ${JSON.stringify(tally)}`);

for (const [kind, flag] of [['architects', 'expect-architects'], ['offices', 'expect-offices']]) {
  if (args[flag] !== undefined && Number(args[flag]) !== del[kind].length) {
    throw new Error(`${PROFILE_KINDS[kind].label} sayısı beklenenden farklı: beklenen ${args[flag]}, bulunan ${del[kind].length} — hiçbir şey silinmedi.`);
  }
}
if (!APPLY) { console.log('\n[DRY-RUN] Hiçbir şey silinmedi. Gerçekten silmek için --apply.'); process.exit(0); }
if (!toDelete.length) { console.log('\nSilinecek kayıt yok.'); process.exit(0); }

console.log('\n--- SİLİNİYOR ---');
const failed = [];
let done = 0;
// Önce FİRMALAR: firma silme zinciri bağlı kişilerin office alanını temizler (cascadeDeleteOffice);
// kişiler sonra silindiğinde temizlenecek bağ kalmamış olur.
for (const a of [...del.offices, ...del.architects]) {
  const res = await runContentAction(env, user, { type: a.kind, action: 'delete', key: a.name });
  if (res && res.status >= 400) { failed.push(a.name); console.log(`   HATA ${a.name} (${res.status})`); continue; }
  const still = await env.DB.prepare(`SELECT id FROM ${PROFILE_KINDS[a.kind].table} WHERE id = ?`).bind(a.id).first();
  if (still) { failed.push(a.name); console.log(`   HATA ${a.name} — satır hâlâ duruyor`); continue; }
  done++;
  console.log(`   silindi (${PROFILE_KINDS[a.kind].label}): ${a.name}`);
}
console.log(`\n=== ÖZET ===\nSilindi : ${done}/${toDelete.length}`);
if (failed.length) { console.log(`\nBAŞARISIZ (${failed.length}): ${failed.join(', ')}`); process.exit(1); }
console.log('Tamam.');
