#!/usr/bin/env node
// PROJE KÜNYESİNDEKİ AGREGATÖR KAYNAK BAĞLANTILARINI TEMİZLE
// (kullanıcı isteği, 2026-09-14: "Hiçbir projenin kaynak kısmında arkitera, archello, archdaily,
//  divisare gibi linkler olmasın. Bu linkler varsa bunları sil ve mimarlık firmalarının
//  websitelerinin linklerini koy. Websiteleri yoksa da boş bırak. Zaten kişi veya firma kaydı olan
//  bir fotoğrafçı varsa link girme.")
//
// KURALIN KOD KARŞILIĞI iki parçadır; bu betik İKİNCİ parçadır:
//   1. KAPILAR (deploy ile canlıya gider) — src/lib/aggregatorSources.js: böyle bir adres artık
//      projects tablosuna hiç YAZILMAZ (canonicalSync) ve D1'de kalmış olsa bile künyede
//      bağlantıya DÖNÜŞMEZ (project.js/seo.js/projectPool.js + istemci kopyası).
//   2. BU BETİK — D1'de HÂLİHAZIRDA duran satırları gerçekten değiştirir: agregatör adresini siler,
//      yerine (kural gereği) projeyi yapan mimarlık firmasının KENDİ websitesini yazar, o da yoksa
//      alanı boş bırakır.
//
// KARAR AĞACI (proje başına, tam olarak kullanıcının cümlesindeki sırayla). KODU BURADA DEĞİL,
// src/lib/aggregatorSources.js#planProjectSourceUrls'te — böylece kural ile alan adı listesi aynı
// dosyada durur ve birim testi (scripts/test-2026-09-14-aggregator-source-links.mjs) betiği
// çalıştırmadan, D1'e hiç dokunmadan aynı kararı sınayabilir. Bu betiğin işi kararın GİRDİLERİNİ
// D1'den okumak ve sonucu yazmaktır:
//   a) İki kolondan (photo_credit_url = elle girilen "Kaynak", source_url = AI akışının "Kaynak
//      Bağlantı"sı) hangileri agregatör ise YALNIZCA onlar boşaltılır. Agregatör OLMAYAN bir değer
//      (ör. fotoğrafçının kendi sitesi) ASLA silinmez — kullanıcı yalnızca yayın/agregatör
//      adreslerinin gitmesini istedi.
//   b) Temizlikten sonra projede hâlâ kullanılabilir bir kaynak kaldıysa yerine bir şey KONMAZ.
//   c) Künyedeki fotoğrafçı adlarının HEPSİ MİMARLAB'da bir kişi (architects) ya da firma/marka
//      (offices) kaydına karşılık geliyorsa alan BOŞ bırakılır — "zaten kişi veya firma kaydı olan
//      bir fotoğrafçı varsa link girme". (Künye zaten o profile gider, bağlantı hiç kullanılmaz.)
//   d) Aksi halde projenin TASARIMCI firması aranır (project_designers -> offices.website) ve
//      firmanın websitesi photo_credit_url'e yazılır. Birden fazla firma varsa websitesi olan İLKİ
//      (id sırası) kullanılır; websitesinin kendisi bir agregatör adresiyse kullanılmaz.
//   e) Firma yoksa ya da websitesi yoksa alan BOŞ kalır ("Websiteleri yoksa da boş bırak").
//
// ÖNİZLEME/ARŞİV kayıtları da taranır (hidden_at/preview_at filtresi YOK): arşivden geri
// alındığında eski bağlantıyla geri gelmemeleri gerekir. deleted_at DOLU satırlar hariçtir.
//
// VARSAYILAN DRY-RUN: --apply verilmedikçe D1'e hiçbir şey yazılmaz.
//
// KULLANIM:
//   node scripts/purge-aggregator-project-sources.mjs                    # DRY-RUN, planı basar
//   node scripts/purge-aggregator-project-sources.mjs --apply            # gerçekten yaz
//   node scripts/purge-aggregator-project-sources.mjs --expect=N --apply # sayım kapısı
//
// NEREDEN ÇALIŞTIRILIR: uzak (web/telefon) Claude oturumundan ÇALIŞTIRILAMAZ — o konteynerden
// api.cloudflare.com çıkışı ağ politikasıyla kapalıdır (bkz. CLAUDE.md). Bunun için
// .github/workflows/purge-aggregator-project-sources.yml var (workflow_dispatch ile tetiklenir).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

// purgeSsrDetailCache/invalidatePublicCache Worker'ın `caches` API'sini kullanır — Node'da yok.
// Zararsız bir sahte nesne konur; gerçek (tüm PoP'lardaki) temizlik CF_ZONE_ID + CF_PURGE_TOKEN
// verildiğinde purge-by-URL REST API'siyle yapılır (bkz. src/lib/globalPurge.js).
globalThis.caches ||= { default: { match: async () => undefined, put: async () => {}, delete: async () => true } };

const { isAggregatorSourceUrl, planProjectSourceUrls } = await import('../src/lib/aggregatorSources.js');
const { purgeSsrDetailCache } = await import('../src/lib/ssrCache.js');
const { invalidatePublicCache } = await import('../src/lib/publicCache.js');
const { foldTr } = await import('../src/lib/textMatch.js');

const ACCOUNT_ID = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim() || '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const APPLY = !!args.apply && !args['dry-run'];
const EXPECT = args.expect === undefined ? null : Number(args.expect);
if (EXPECT !== null && !Number.isFinite(EXPECT)) throw new Error('--expect sayı olmalı');

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

// env — purgeSsrDetailCache/invalidatePublicCache'in beklediği şekil. CF_ZONE_ID/CF_PURGE_TOKEN
// verilmezse global purge sessizce atlanır (bkz. globalPurge.js#isGlobalPurgeConfigured) ve
// sayfalar edge TTL'i dolunca kendiliğinden tazelenir.
const env = {
  DB: d1(),
  FACET_CACHE: null,
  CF_ZONE_ID: (process.env.CF_ZONE_ID || '').trim() || undefined,
  CF_PURGE_TOKEN: (process.env.CF_PURGE_TOKEN || '').trim() || undefined,
};

const trim = (v) => String(v == null ? '' : v).trim();

// ---------------------------------------------------------------------------------------------
// 1) OKU — bağlantı taşıyan TÜM projeler (agregatör olup olmadığı burada, JS tarafında ayıklanır:
//    alan adı etiketi eşleşmesi SQL LIKE ile güvenilir biçimde ifade edilemez, bkz.
//    src/lib/aggregatorSources.js).
// ---------------------------------------------------------------------------------------------
const { results: projectRows } = await env.DB.prepare(
  `SELECT id, slug, title, photo_credit_text, photo_credit_url, source_url
     FROM projects
    WHERE deleted_at IS NULL
      AND (COALESCE(photo_credit_url, '') <> '' OR COALESCE(source_url, '') <> '')
    ORDER BY id`
).all();

const affected = projectRows.filter(r => isAggregatorSourceUrl(r.photo_credit_url) || isAggregatorSourceUrl(r.source_url));
console.log(`Bağlantı taşıyan proje: ${projectRows.length} — agregatör adresi taşıyan: ${affected.length}${APPLY ? '' : '   [DRY-RUN — hiçbir şey yazılmayacak]'}\n`);

if (EXPECT !== null && affected.length !== EXPECT) {
  console.error(`SAYIM KAPISI: --expect=${EXPECT} verildi ama ${affected.length} proje bulundu — hiçbir şey yazılmadı.`);
  process.exit(1);
}
if (!affected.length) {
  console.log('Temizlenecek bir şey yok.');
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// 2) YARDIMCI OKUMALAR — künyedeki adların profil karşılığı + projenin tasarımcı firmasının sitesi.
// ---------------------------------------------------------------------------------------------
const ids = affected.map(r => r.id);
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

// project_designers -> offices: projeyi YAPAN firma(lar). Websitesi olan ilk firma (id sırası)
// kullanılacak. hidden/preview firmalar da sayılır — kayıt sitede yayında olmasa bile websitesi
// firmanın kendi adresidir ve kullanıcının istediği şey odur.
const officeWebsiteByProject = new Map();
for (const part of chunk(ids, 80)) {
  const { results } = await env.DB.prepare(
    `SELECT pd.project_id AS pid, o.id AS oid, o.name AS oname, o.website AS website
       FROM project_designers pd
       JOIN offices o ON o.id = pd.office_id AND o.deleted_at IS NULL
      WHERE pd.project_id IN (${part.map(() => '?').join(', ')})
        AND COALESCE(o.website, '') <> ''
      ORDER BY pd.project_id, o.id`
  ).bind(...part).all();
  for (const r of results) {
    if (officeWebsiteByProject.has(r.pid)) continue;
    if (isAggregatorSourceUrl(r.website)) continue; // firmanın "websitesi" bir yayın sayfasıysa kullanma
    officeWebsiteByProject.set(r.pid, { name: r.oname, website: trim(r.website) });
  }
}

// Künyedeki fotoğrafçı adlarının profil karşılığı. İKİ yol (src/routes/project.js#
// fetchPhotographerDetails + fetchPhotographerOfficeDetails ile AYNI kural):
//   - project_photographers kenarı (kişi kaydına gerçekten bağlanmış),
//   - ad katlaması (name_fold) ile architects/offices eşleşmesi.
const photographerEdgeByProject = new Map();
for (const part of chunk(ids, 80)) {
  const { results } = await env.DB.prepare(
    `SELECT pp.project_id AS pid, a.name_fold AS fold
       FROM project_photographers pp
       JOIN architects a ON a.id = pp.architect_id AND a.deleted_at IS NULL
      WHERE pp.project_id IN (${part.map(() => '?').join(', ')})`
  ).bind(...part).all();
  for (const r of results) {
    if (!photographerEdgeByProject.has(r.pid)) photographerEdgeByProject.set(r.pid, new Set());
    photographerEdgeByProject.get(r.pid).add(trim(r.fold));
  }
}

const creditNamesOf = (text) => trim(text).split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);
const allFolds = [...new Set(affected.flatMap(r => creditNamesOf(r.photo_credit_text).map(n => foldTr(n))).filter(Boolean))];
const knownFolds = new Set();
for (const part of chunk(allFolds, 80)) {
  for (const table of ['architects', 'offices']) {
    const { results } = await env.DB.prepare(
      `SELECT name_fold AS fold FROM ${table}
        WHERE deleted_at IS NULL AND name_fold IN (${part.map(() => '?').join(', ')})`
    ).bind(...part).all();
    for (const r of results) knownFolds.add(trim(r.fold));
  }
}

// "Zaten kişi veya firma kaydı olan bir fotoğrafçı varsa link girme": künyedeki adların HEPSİ bir
// profile karşılık geliyorsa bağlantı hiç kullanılmıyor demektir (künye profile gider) — alan boş
// kalır. Ad hiç yazılmamışsa (boş künye) profil kapsamı da yoktur, firma sitesi dalına düşülür.
function everyPhotographerHasProfile(row) {
  const names = creditNamesOf(row.photo_credit_text);
  if (!names.length) return false;
  const edgeFolds = photographerEdgeByProject.get(row.id) || new Set();
  return names.every(n => { const f = foldTr(n); return !!f && (knownFolds.has(f) || edgeFolds.has(f)); });
}

// ---------------------------------------------------------------------------------------------
// 3) PLANLA — proje başına yeni photo_credit_url / source_url değerleri.
// ---------------------------------------------------------------------------------------------
// Karar TEK yerde: src/lib/aggregatorSources.js#planProjectSourceUrls (kullanıcının cümlesi orada
// satır satır kodlu; testi de aynı fonksiyonu çağırır — burada ikinci bir kopya YOK).
const plan = [];
const reasonCounts = new Map();
for (const row of affected) {
  const office = officeWebsiteByProject.get(row.id);
  const decision = planProjectSourceUrls({
    photoCreditUrl: row.photo_credit_url,
    sourceUrl: row.source_url,
    everyPhotographerHasProfile: everyPhotographerHasProfile(row),
    officeWebsite: office ? office.website : '',
  });
  const reason = decision.reason === 'firma sitesi yazıldı' && office ? `${decision.reason} (${office.name})` : decision.reason;
  reasonCounts.set(decision.reason, (reasonCounts.get(decision.reason) || 0) + 1);
  plan.push({ row, nextCredit: decision.nextPhotoCreditUrl, nextSource: decision.nextSourceUrl, brands: decision.removedBrands, reason });
}

for (const p of plan) {
  console.log(`#${p.row.id} ${p.row.slug}`);
  console.log(`   silinen: ${p.brands.join(', ')}` +
    `${isAggregatorSourceUrl(p.row.photo_credit_url) ? `  [Kaynak: ${trim(p.row.photo_credit_url)}]` : ''}` +
    `${isAggregatorSourceUrl(p.row.source_url) ? `  [Kaynak Bağlantı: ${trim(p.row.source_url)}]` : ''}`);
  console.log(`   yerine : ${p.nextCredit || '(boş)'}   — ${p.reason}`);
}
console.log('');
for (const [reason, n] of [...reasonCounts].sort((a, b) => b[1] - a[1])) console.log(`  ${n} proje — ${reason}`);
console.log('');

if (!APPLY) {
  console.log(`DRY-RUN bitti: ${plan.length} proje değişecekti. Gerçekten yazmak için --apply ekleyin. (${queryCount} D1 sorgusu)`);
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// 4) YAZ — proje başına tek UPDATE, ardından o projenin detay önbelleğini düşür.
// ---------------------------------------------------------------------------------------------
let written = 0;
for (const p of plan) {
  await env.DB.prepare(
    `UPDATE projects SET photo_credit_url = ?, source_url = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(p.nextCredit || null, p.nextSource || null, p.row.id).run();
  written++;
  try { await purgeSsrDetailCache('project', p.row.slug, env); } catch { /* önbellek temizliği en iyi çaba */ }
}
try { await invalidatePublicCache(env); } catch { /* aynı — TTL dolunca zaten tazelenir */ }

console.log(`${written} projenin kaynak bağlantısı güncellendi. (${queryCount} D1 sorgusu)`);
if (!env.CF_ZONE_ID || !env.CF_PURGE_TOKEN) {
  console.log('NOT: CF_ZONE_ID/CF_PURGE_TOKEN verilmedi — tüm PoP\'lardaki edge önbelleği elle düşürülmedi, TTL dolunca tazelenir.');
}
