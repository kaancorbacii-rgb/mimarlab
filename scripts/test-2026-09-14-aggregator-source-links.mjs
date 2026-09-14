#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-14 — BİRİM TESTLERİ
//   "Hiçbir projenin kaynak kısmında arkitera, archello, archdaily, divisare gibi linkler olmasın.
//    Bu linkler varsa bunları sil ve mimarlık firmalarının websitelerinin linklerini koy.
//    Websiteleri yoksa da boş bırak. Zaten kişi veya firma kaydı olan bir fotoğrafçı varsa link
//    girme."
//
// Kuralın TEK kaynağı src/lib/aggregatorSources.js. Bu dosya onun DÖRT tüketicisini de sınar:
//   1. süzgecin kendisi (alan adı etiketi eşleşmesi, şemasız/yerel alan adları, yanlış pozitifler),
//   2. YAZMA kapısı — canonicalSync gerçek bir onay akışında böyle bir adresi D1'e yazmamalı,
//   3. OKUMA kapıları — /api/project/:slug yükü, SSR gövdesi ve popup çipi bağlantı üretmemeli,
//   4. TEMİZLİK kararı — planProjectSourceUrls, kullanıcının cümlesindeki beş dalın hepsinde.
//
// scripts/test-2026-09-12-photographer-source-link.mjs ile AYNI desen: node:sqlite üzerinde gerçek
// schema.sql + canlı route/lib fonksiyonları; istemci çipi node:vm içinde küçük bir sahte DOM'la
// GERÇEKTEN render edilir.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';

import {
  AGGREGATOR_SOURCE_BRANDS, aggregatorBrandOf, isAggregatorSourceUrl,
  dropAggregatorSourceUrl, firstUsableSourceUrl, planProjectSourceUrls,
} from '../src/lib/aggregatorSources.js';
import { handleProjectDetailRoute } from '../src/routes/project.js';
import { syncApprovedSubmissionToCanonical } from '../src/lib/canonicalSync.js';
import { parseSubmissionRow } from '../src/lib/submissionTypes.js';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

function d1(db) {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = db.prepare(sql).get(...params); if (r === undefined) return null; return col ? r[col] : { ...r }; },
    async all() { return { results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }; },
    // last_row_id — canonicalSync INSERT'ten sonra yeni projenin id'sini bundan okur (bkz.
    // syncProject#insertWithSlugRetry); vermezsek project_designers batch'i undefined bağlamaya
    // çalışır ve gerçek akış testi kurulum hatasıyla düşerdi.
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; } };
}
function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(read('../schema.sql'));
  db.exec(read('../migrations/0079_search_fold_columns.sql'));
  return db;
}

// -------------------------------------------------------------------------------------------
section('süzgeç — hangi adres "agregatör" sayılır (src/lib/aggregatorSources.js)');

await test('kullanıcının saydığı dört marka yakalanır', () => {
  assert.equal(aggregatorBrandOf('https://www.arkitera.com/proje/x'), 'arkitera');
  assert.equal(aggregatorBrandOf('https://archello.com/project/x'), 'archello');
  assert.equal(aggregatorBrandOf('https://www.archdaily.com/1234/x'), 'archdaily');
  assert.equal(aggregatorBrandOf('https://divisare.com/projects/x'), 'divisare');
});
await test('aynı yayının YEREL alan adları da yakalanır (liste alan adı değil marka tutar)', () => {
  // Tek tek alan adı saymak listeyi ilk yeni yerel alan adında eskitirdi — bkz. modüldeki gerekçe.
  for (const u of ['https://www.archdaily.com.tr/tr/1/x', 'https://www.archdaily.com.br/br/1/x',
    'https://www.archdaily.mx/mx/1/x', 'https://www.plataformaarquitectura.cl/cl/1/x']) {
    assert.ok(isAggregatorSourceUrl(u), `yakalanmalıydı: ${u}`);
  }
});
await test('ŞEMASIZ saklanmış değer de yakalanır (D1\'de böyle satırlar var)', () => {
  // "Kaynak" kutusu bilerek type="url" değil; şemasız değer saklanması NORMAL (bkz.
  // src/lib/externalUrl.js). Kapı o katmanda da tutmalı, yoksa eleme delinirdi.
  assert.equal(aggregatorBrandOf('arkitera.com/proje/x'), 'arkitera');
  assert.equal(aggregatorBrandOf('www.archello.com/project/x'), 'archello');
  assert.equal(aggregatorBrandOf('//divisare.com/projects/x'), 'divisare');
  assert.equal(aggregatorBrandOf('  ARCHDAILY.com/1/x  '), 'archdaily');
});
await test('gerçek firma/fotoğrafçı siteleri YANLIŞLIKLA yakalanmaz', () => {
  for (const u of ['https://www.emrearolat.com', 'https://ytong.com.tr/referanslar', 'ofis-mimarlik.com/proje/x',
    // etiket TAM eşleşir: alan adının İÇİNDE marka adı geçmesi yetmez.
    'https://divisare-mimarlik.com/x', 'https://archdailyservis.com.tr/x', 'https://myarkitera.com/x',
    'https://mimarlab.com/proje/x', '', null, undefined, 'javascript:alert(1)', 'Ofisin kendi arşivi']) {
    assert.equal(isAggregatorSourceUrl(u), false, `yakalanmamalıydı: ${String(u)}`);
  }
});
await test('dropAggregatorSourceUrl yalnızca agregatörü siler, diğerine DOKUNMAZ', () => {
  assert.equal(dropAggregatorSourceUrl('https://arkitera.com/x'), '');
  assert.equal(dropAggregatorSourceUrl('https://emrearolat.com/x'), 'https://emrearolat.com/x');
  assert.equal(dropAggregatorSourceUrl(''), '');
});
await test('firstUsableSourceUrl agregatörü ATLAR, ilk temiz değeri döner', () => {
  // `a || b` yetmez: photo_credit_url agregatör, source_url firmanın sitesiyse firmanınki kazanmalı.
  assert.equal(firstUsableSourceUrl(['https://archello.com/x', 'https://emrearolat.com/x']), 'https://emrearolat.com/x');
  assert.equal(firstUsableSourceUrl(['https://emrearolat.com/x', 'https://archello.com/x']), 'https://emrearolat.com/x');
  assert.equal(firstUsableSourceUrl(['https://archello.com/x', 'https://arkitera.com/y']), '');
  assert.equal(firstUsableSourceUrl(['', null, undefined]), '');
});

await test('istemci kopyasındaki marka listesi sunucununkiyle AYNI', () => {
  // js/components/project-meta.js klasik bir <script> — bu modülü import EDEMEZ, listeyi kopyalar.
  // İki liste ayrışırsa popup ile sunucu farklı davranır; bu kapı ayrışmayı deploy'dan önce durdurur.
  const src = read('../js/components/project-meta.js');
  const m = src.match(/const AGGREGATOR_SOURCE_BRANDS = \[([\s\S]*?)\];/);
  assert.ok(m, 'istemci kopyasında AGGREGATOR_SOURCE_BRANDS bulunamadı');
  const clientBrands = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  assert.deepEqual(clientBrands, AGGREGATOR_SOURCE_BRANDS, 'istemci/sunucu marka listeleri ayrışmış');
});

// -------------------------------------------------------------------------------------------
section('YAZMA KAPISI — canonicalSync böyle bir adresi D1\'e hiç yazmaz');

function submissionDb() {
  const db = freshDb();
  const now = Date.now();
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u1', 'a@b.com', 'x', 'Kaan', 'admin', ?)`).run(now);
  return db;
}
async function syncProjectSubmission(db, fields) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO project_submissions (id, owner_user_id, status, created_at, updated_at, title, slug, build_status,
                                      discipline, category, type, photoCreditText, photoCreditUrl, source_url, images, designer, office)
     VALUES ('ps1', 'u1', 'approved', ?, ?, 'Bir Proje', 'bir-proje', 'built', '["Mimarlık"]', '["Konut"]', '["Villa"]', ?, ?, ?, '["/media/a.webp"]', '[]', '[]')`
  ).run(now, now, fields.photoCreditText || 'Bir Fotoğrafçı', fields.photoCreditUrl || '', fields.source_url || '');
  const env = { DB: d1(db), CACHE: null, FACET_CACHE: null };
  const row = parseSubmissionRow('projects', db.prepare(`SELECT * FROM project_submissions WHERE id = 'ps1'`).get());
  await syncApprovedSubmissionToCanonical(env, 'projects', row);
  return db.prepare(`SELECT photo_credit_url, source_url FROM projects WHERE slug = 'bir-proje'`).get();
}

await test('INSERT dalı: agregatör "Kaynak" kolona HİÇ yazılmaz', async () => {
  const saved = await syncProjectSubmission(submissionDb(), { photoCreditUrl: 'https://www.archdaily.com/1/x' });
  assert.ok(!saved.photo_credit_url, `yazılmamalıydı: ${saved.photo_credit_url}`);
});
await test('INSERT dalı: agregatör AI "Kaynak Bağlantı"sı da yazılmaz', async () => {
  const saved = await syncProjectSubmission(submissionDb(), { source_url: 'https://divisare.com/projects/1' });
  assert.ok(!saved.source_url, `yazılmamalıydı: ${saved.source_url}`);
});
await test('INSERT dalı: agregatör OLMAYAN kaynak aynen yazılır (kapı fazla geniş değil)', async () => {
  const saved = await syncProjectSubmission(submissionDb(), { photoCreditUrl: 'https://emrearolat.com/proje' });
  assert.equal(saved.photo_credit_url, 'https://emrearolat.com/proje');
});
await test('UPDATE dalı: var olan projeye sonradan agregatör eklenemez, eskisi de bozulmaz', async () => {
  const db = submissionDb();
  await syncProjectSubmission(db, { photoCreditUrl: 'https://emrearolat.com/proje' });
  // Aynı gönderi yeniden kaydediliyor, bu kez "Kaynak" kutusuna arkitera yazılmış.
  db.prepare(`UPDATE project_submissions SET photoCreditUrl = 'https://arkitera.com/proje/x' WHERE id = 'ps1'`).run();
  const env = { DB: d1(db), CACHE: null, FACET_CACHE: null };
  const row = parseSubmissionRow('projects', db.prepare(`SELECT * FROM project_submissions WHERE id = 'ps1'`).get());
  await syncApprovedSubmissionToCanonical(env, 'projects', row);
  const saved = db.prepare(`SELECT photo_credit_url FROM projects WHERE slug = 'bir-proje'`).get();
  assert.ok(!saved.photo_credit_url, `agregatör canonical'a sızmamalıydı: ${saved.photo_credit_url}`);
});

// -------------------------------------------------------------------------------------------
section('OKUMA KAPILARI — D1\'de kalmış eski bir değer künyede bağlantıya dönüşmez');

function projectDb({ creditText = 'Egemen Karakaya', creditUrl = '', sourceUrl = '' } = {}) {
  const db = freshDb();
  db.prepare(
    `INSERT INTO projects (id, slug, title, images, build_status, source, photo_credit_text, photo_credit_url, source_url)
     VALUES (1, 'bir-proje', 'Bir Proje', '["/media/a.webp"]', 'built', 'submission', ?, ?, ?)`
  ).run(creditText, creditUrl, sourceUrl);
  return db;
}
async function payloadFor(db) {
  const url = new URL('https://mimarlab.com/api/project/bir-proje');
  const res = await handleProjectDetailRoute(new Request(url), { DB: d1(db), IMG_KV: null, FACET_CACHE: null }, url, 'bir-proje');
  return (await res.json()).item;
}

await test('/api/project/:slug — agregatör photo_credit_url yüke düşmez', async () => {
  const item = await payloadFor(projectDb({ creditUrl: 'https://www.arkitera.com/proje/x' }));
  assert.equal(item.photoCredit.url, '');
  assert.equal(item.photoCredit.text, 'Egemen Karakaya', 'fotoğrafçı ADI silinmez, yalnızca bağlantı');
});
await test('/api/project/:slug — agregatör source_url de yüke düşmez', async () => {
  const item = await payloadFor(projectDb({ sourceUrl: 'https://archello.com/project/x' }));
  assert.equal(item.photoCredit.url, '');
});
await test('/api/project/:slug — biri agregatör, diğeri firma sitesiyse FİRMANINKİ kullanılır', async () => {
  const item = await payloadFor(projectDb({ creditUrl: 'https://archdaily.com/1/x', sourceUrl: 'https://emrearolat.com/proje' }));
  assert.equal(item.photoCredit.url, 'https://emrearolat.com/proje');
});

await test('SSR gövdesi (no-JS / crawler) da agregatör bağlantısı basmaz', async () => {
  const db = projectDb({ sourceUrl: 'https://www.archdaily.com/1/x' });
  const seo = await import('../src/lib/seo.js');
  const meta = await seo.buildMeta('project', 'bir-proje', { DB: d1(db) });
  const html = (meta && meta.bodyHtml) || '';
  assert.ok(!html.includes('archdaily.com'), 'Googlebot künyede agregatör bağlantısı görmemeli');
  assert.ok(html.includes('Egemen Karakaya'), 'fotoğrafçı adı düz metin olarak kalmalı');
});

// popup çipi (js/components/project-meta.js) — sahte DOM'da GERÇEKTEN render edilir.
function renderChips(item) {
  const src = read('../js/components/project-meta.js');
  const KNOWN = new Set(['pm-title', 'pm-architect-section', 'pm-architect-chips', 'pm-office-section',
    'pm-office-chips', 'pm-photographer-section', 'pm-photographer-chips', 'pm-meta', 'pm-desc']);
  const els = new Map();
  const headChildren = [];
  const mk = (id) => ({ id, style: {}, innerHTML: '', textContent: '', type: '', querySelector: () => null, appendChild: () => {} });
  const document = {
    baseURI: 'https://mimarlab.com/proje/bir-proje',
    getElementById(id) {
      if (!KNOWN.has(id)) return null;
      if (!els.has(id)) els.set(id, mk(id));
      return els.get(id);
    },
    createElement: (tag) => mk(tag),
    head: { appendChild: (el) => headChildren.push(el) },
  };
  const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ctx = {
    document,
    window: { location: { origin: 'https://mimarlab.com' } },
    URL, JSON, Math, Date, console,
    requestAnimationFrame: () => {},
    escapeHtml,
    escapeAttr: escapeHtml,
    cdnImg: (u) => u,
    officeColor: () => '#000',
    initials: (n) => String(n || '').slice(0, 2),
    slugify: (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    verifiedBadgeHtml: () => '',
    parseLocation: (loc) => ({ city: loc || '', district: '' }),
  };
  const ProjectMeta = vm.runInNewContext(`${src}\n;ProjectMeta;`, ctx);
  ProjectMeta.render(item, {});
  return els.get('pm-photographer-chips').innerHTML;
}

await test('popup çipi: agregatör kaynak bağlantıya DÖNÜŞMEZ (tıklanamaz düz isim kalır)', () => {
  const html = renderChips({
    title: 'Bir Proje',
    photoCredit: { text: 'Egemen Karakaya', url: 'https://www.arkitera.com/proje/x' },
    photographerDetails: [],
  });
  assert.ok(!html.includes('arkitera.com'), 'agregatör adresi HTML\'e hiç basılmamalı');
  assert.ok(!html.includes('<a '), 'bağlantı üretilmemeli');
  assert.match(html, /<span class="designer-chip designer-chip-no-avatar"/);
  assert.match(html, /Egemen Karakaya/);
});
await test('popup çipi: firma sitesi kaynak OLARAK çalışmaya devam eder (kapı fazla geniş değil)', () => {
  const html = renderChips({
    title: 'Bir Proje',
    photoCredit: { text: 'Egemen Karakaya', url: 'https://emrearolat.com/proje' },
    photographerDetails: [],
  });
  assert.match(html, /<a class="designer-chip designer-chip-no-avatar designer-chip-source"/);
  assert.match(html, /href="https:\/\/emrearolat\.com\/proje"/);
  assert.match(html, /target="_blank"/);
});

// -------------------------------------------------------------------------------------------
section('TEMİZLİK KARARI — planProjectSourceUrls (scripts/purge-aggregator-project-sources.mjs)');

await test('(a) yalnızca agregatör olan kolon boşalır, temiz olan KORUNUR', () => {
  const r = planProjectSourceUrls({ photoCreditUrl: 'https://fotografci.com/x', sourceUrl: 'https://archello.com/y' });
  assert.equal(r.nextPhotoCreditUrl, 'https://fotografci.com/x');
  assert.equal(r.nextSourceUrl, '');
  assert.deepEqual(r.removedBrands, ['archello']);
});
await test('(b) temizlikten sonra kullanılabilir kaynak kaldıysa yerine bir şey KONMAZ', () => {
  const r = planProjectSourceUrls({
    photoCreditUrl: 'https://arkitera.com/x', sourceUrl: 'https://fotografci.com/y',
    officeWebsite: 'https://firma.com',
  });
  assert.equal(r.nextPhotoCreditUrl, '');
  assert.equal(r.nextSourceUrl, 'https://fotografci.com/y');
  assert.equal(r.reason, 'agregatör silindi, mevcut diğer kaynak korundu');
});
await test('(c) "zaten kişi veya firma kaydı olan bir fotoğrafçı varsa link girme"', () => {
  const r = planProjectSourceUrls({
    photoCreditUrl: 'https://divisare.com/x', everyPhotographerHasProfile: true,
    officeWebsite: 'https://firma.com',
  });
  assert.equal(r.nextPhotoCreditUrl, '', 'profili olan fotoğrafçıda firma sitesi bile yazılmaz');
  assert.equal(r.reason, 'fotoğrafçının profili var, bağlantı girilmedi');
});
await test('(d) "mimarlık firmalarının websitelerinin linklerini koy"', () => {
  const r = planProjectSourceUrls({ photoCreditUrl: 'https://www.archdaily.com/1/x', officeWebsite: 'https://emrearolat.com' });
  assert.equal(r.nextPhotoCreditUrl, 'https://emrearolat.com');
  assert.equal(r.nextSourceUrl, '');
  assert.equal(r.reason, 'firma sitesi yazıldı');
});
await test('(d) firmanın "websitesi" de agregatörse KULLANILMAZ', () => {
  const r = planProjectSourceUrls({ photoCreditUrl: 'https://www.archdaily.com/1/x', officeWebsite: 'https://archello.com/brand/x' });
  assert.equal(r.nextPhotoCreditUrl, '');
  assert.equal(r.reason, 'firma sitesi yok, boş bırakıldı');
});
await test('(e) "websiteleri yoksa da boş bırak"', () => {
  const r = planProjectSourceUrls({ sourceUrl: 'arkitera.com/proje/x', officeWebsite: '' });
  assert.equal(r.nextPhotoCreditUrl, '');
  assert.equal(r.nextSourceUrl, '');
  assert.equal(r.changed, true);
  assert.equal(r.reason, 'firma sitesi yok, boş bırakıldı');
});
await test('agregatör taşımayan proje HİÇ değişmez (betik onlara dokunmaz)', () => {
  const r = planProjectSourceUrls({ photoCreditUrl: 'https://fotografci.com/x', officeWebsite: 'https://firma.com' });
  assert.equal(r.changed, false);
  assert.equal(r.nextPhotoCreditUrl, 'https://fotografci.com/x');
  assert.equal(r.reason, 'agregatör yok — dokunulmadı');
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) {
  for (const f of failures) console.error(`  - ${f.name}: ${f.message}`);
  process.exit(1);
}
