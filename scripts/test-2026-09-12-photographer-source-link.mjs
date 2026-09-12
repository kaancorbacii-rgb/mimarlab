#!/usr/bin/env node
// KULLANICI BİLDİRİMİ, 2026-09-12 madde 1 — BİRİM TESTLERİ
//   "https://mimarlab.com/proje/docem-ice-donuk-cocuklar-okulu projesine kaynak linki ekledim ama
//    fotoğrafçı kişi olarak sistemde kayıtlı olmamasına rağmen fotoğrafçıya link olarak atanmadı.
//    ... eğer fotoğrafçının bir kişi profili yoksa verilen link fotoğrafçı ismine link olarak
//    atılsın ve tıklayınca link yeni sekmede açılsın."
//
// İKİ KÖK NEDEN (ikisi de burada sabitlenir):
//   1. proje-ekle.html'de link alan İKİ kutu var ve AYRI kolonlara yazıyorlar: "Kaynak"
//      (#p-credit-url -> photo_credit_url) ve AI akışındaki "Kaynak Bağlantı" (#ai-url-input ->
//      source_url). Künye yalnızca photo_credit_url'ü okuyordu — AI ile bir kaynak sayfadan
//      aktarılan projede verilen bağlantı sitede HİÇBİR yerde görünmüyordu. Ayrıca source_url
//      canonicalSync'in yalnızca INSERT dalında vardı, var olan bir projeye sonradan eklenemiyordu.
//   2. Kaynak kutusu bilerek type="url" DEĞİL ve sunucu şemasız değerleri kabul ediyor
//      ("ytong.com.tr/x"); istemci bunu document.baseURI'ye göre çözünce
//      https://mimarlab.com/ytong.com.tr/x gibi KIRIK bir site-içi adres üretiyordu.
//
// scripts/test-2026-09-10-round11.mjs ile AYNI desen: node:sqlite üzerinde gerçek schema.sql +
// canlı route/lib fonksiyonları. İstemci çipi node:vm içinde küçük bir sahte DOM'la GERÇEKTEN
// render edilir — kaynak üzerinden metin araması değil, üretilen HTML doğrulanır.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';

import { externalHttpUrl } from '../src/lib/externalUrl.js';
import { handleProjectDetailRoute } from '../src/routes/project.js';

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
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes) } }; },
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
section('externalHttpUrl — dış bağlantı normalizasyonu (src/lib/externalUrl.js)');

await test('şemasız alan adı https:// varsayar (kırık site-içi yol ÜRETMEZ)', () => {
  assert.equal(externalHttpUrl('ytong.com.tr/referanslar'), 'https://ytong.com.tr/referanslar');
  assert.equal(externalHttpUrl('www.arkitera.com/proje/x?a=1'), 'https://www.arkitera.com/proje/x?a=1');
  assert.equal(externalHttpUrl('  arkitera.com  '), 'https://arkitera.com/');
});
await test('şemalı http(s) aynen korunur, protokol-göreli https olur', () => {
  assert.equal(externalHttpUrl('https://arkitera.com/x'), 'https://arkitera.com/x');
  assert.equal(externalHttpUrl('http://arkitera.com/x'), 'http://arkitera.com/x');
  assert.equal(externalHttpUrl('//arkitera.com/x'), 'https://arkitera.com/x');
});
await test('tehlikeli/anlamsız değerler bağlantı üretmez', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'mailto:a@b.com', '/media/x.webp',
    'logos-thumb/a.jpg', 'Ofisin kendi arşivi', 'Arkitera', '', null, undefined, 'a"onmouseover="x']) {
    assert.equal(externalHttpUrl(bad), '', `bağlantı üretilmemeliydi: ${String(bad)}`);
  }
});

// -------------------------------------------------------------------------------------------
section('/api/project/:slug — photoCredit.url: photo_credit_url > source_url');

async function payloadFor(db, slug) {
  const url = new URL('https://mimarlab.com/api/project/' + slug);
  const res = await handleProjectDetailRoute(new Request(url), { DB: d1(db), IMG_KV: null, FACET_CACHE: null }, url, slug);
  return (await res.json()).item;
}

function projectDb({ creditText = 'Egemen Karakaya', creditUrl = '', sourceUrl = '' } = {}) {
  const db = freshDb();
  db.prepare(
    `INSERT INTO projects (id, slug, title, images, build_status, source, photo_credit_text, photo_credit_url, source_url)
     VALUES (1, 'docem-ice-donuk-cocuklar-okulu', 'DOÇEM İçe Dönük Çocuklar Okulu', '["/media/a.webp"]', 'built', 'submission', ?, ?, ?)`
  ).run(creditText, creditUrl, sourceUrl);
  return db;
}

await test('yalnızca AI akışının source_url\'ü varken künye onu kullanır (bildirilen hata)', async () => {
  const item = await payloadFor(projectDb({ sourceUrl: 'https://arkitera.com/proje/docem' }), 'docem-ice-donuk-cocuklar-okulu');
  assert.equal(item.photoCredit.url, 'https://arkitera.com/proje/docem');
  assert.equal(item.photoCredit.text, 'Egemen Karakaya');
});
await test('elle girilen Kaynak (photo_credit_url) source_url\'ü EZER', async () => {
  const item = await payloadFor(projectDb({ creditUrl: 'https://fotografci.com/docem', sourceUrl: 'https://arkitera.com/proje/docem' }), 'docem-ice-donuk-cocuklar-okulu');
  assert.equal(item.photoCredit.url, 'https://fotografci.com/docem');
});
await test('şemasız saklanmış kaynak sunucuda mutlak hâle gelir', async () => {
  const item = await payloadFor(projectDb({ creditUrl: 'arkitera.com/proje/docem' }), 'docem-ice-donuk-cocuklar-okulu');
  assert.equal(item.photoCredit.url, 'https://arkitera.com/proje/docem');
});
await test('kaynak yoksa url boş kalır (uydurma bağlantı yok)', async () => {
  const item = await payloadFor(projectDb(), 'docem-ice-donuk-cocuklar-okulu');
  assert.equal(item.photoCredit.url, '');
});

// -------------------------------------------------------------------------------------------
section('popup künyesi — fotoğrafçı çipi (js/components/project-meta.js, sahte DOM)');

// project-meta.js klasik bir <script>; sayfadaki diğer dosyalardan gelen global yardımcıları
// (escapeHtml/cdnImg/...) burada en sade biçimleriyle sağlıyoruz — test edilen şey çipin KENDİSİ.
function renderChips(item) {
  const src = read('../js/components/project-meta.js');
  const KNOWN = new Set(['pm-title', 'pm-architect-section', 'pm-architect-chips', 'pm-office-section',
    'pm-office-chips', 'pm-photographer-section', 'pm-photographer-chips', 'pm-meta', 'pm-desc']);
  const els = new Map();
  const headChildren = [];
  const mk = (id) => ({ id, style: {}, innerHTML: '', textContent: '', type: '', querySelector: () => null, appendChild: () => {} });
  const document = {
    baseURI: 'https://mimarlab.com/proje/docem-ice-donuk-cocuklar-okulu',
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
  return {
    chipsHtml: els.get('pm-photographer-chips').innerHTML,
    sectionDisplay: els.get('pm-photographer-section').style.display,
    headHtml: headChildren.map((e) => e.textContent).join('\n'),
  };
}

await test('profili OLMAYAN fotoğrafçı + kaynak: yeni sekmede açılan bağlantı', () => {
  const out = renderChips({
    title: 'DOÇEM İçe Dönük Çocuklar Okulu',
    photoCredit: { text: 'Egemen Karakaya', url: 'https://arkitera.com/proje/docem' },
    photographerDetails: [],
  });
  assert.match(out.chipsHtml, /<a class="designer-chip designer-chip-no-avatar designer-chip-source"/);
  assert.match(out.chipsHtml, /href="https:\/\/arkitera\.com\/proje\/docem"/);
  assert.match(out.chipsHtml, /target="_blank"/, 'yeni sekmede açılmalı');
  assert.match(out.chipsHtml, /rel="noopener noreferrer nofollow"/);
  assert.match(out.chipsHtml, /Egemen Karakaya/);
  assert.match(out.headHtml, /designer-chip-source .designer-chip-name\{text-decoration:underline/, 'bağlantı olduğu görünsün diye altı çizili');
});
await test('şemasız kaynak site-içi bir yola DEĞİL dış adrese çözülür', () => {
  const out = renderChips({
    title: 'X', photoCredit: { text: 'Egemen Karakaya', url: 'ytong.com.tr/referanslar' }, photographerDetails: [],
  });
  assert.match(out.chipsHtml, /href="https:\/\/ytong\.com\.tr\/referanslar"/);
  assert.ok(!out.chipsHtml.includes('mimarlab.com/ytong.com.tr'), 'baseURI\'ye göre çözülmemeli');
});
await test('kaynak YOKSA eski davranış: tıklanamaz düz isim', () => {
  const out = renderChips({ title: 'X', photoCredit: { text: 'Egemen Karakaya', url: '' }, photographerDetails: [] });
  assert.match(out.chipsHtml, /<span class="designer-chip designer-chip-no-avatar"/);
  assert.ok(!out.chipsHtml.includes('<a '), 'bağlantı üretilmemeli');
});
await test('profili OLAN fotoğrafçı kaynak varken bile KENDİ popup\'ına gider', () => {
  const out = renderChips({
    title: 'X',
    photoCredit: { text: 'Cemal Emden', url: 'https://arkitera.com/proje/docem' },
    photographerDetails: [{ name: 'Cemal Emden', slug: 'cemal-emden', type: 'architect', photo: null }],
  });
  assert.match(out.chipsHtml, /href="\/kisi\/cemal-emden"/);
  assert.ok(!out.chipsHtml.includes('arkitera.com'), 'profil varsa dış bağlantıya gidilmez');
});
await test('geçersiz kaynak (javascript:) bağlantıya dönüşmez', () => {
  const out = renderChips({ title: 'X', photoCredit: { text: 'Egemen Karakaya', url: 'javascript:alert(1)' }, photographerDetails: [] });
  assert.ok(!out.chipsHtml.includes('javascript:'));
  assert.match(out.chipsHtml, /<span class="designer-chip designer-chip-no-avatar"/);
});

// -------------------------------------------------------------------------------------------
section('SSR gövdesi (no-JS / crawler) popup ile aynı davranır');

await test('profilsiz fotoğrafçı adı SSR künyesinde de dış bağlantı', async () => {
  const db = projectDb({ sourceUrl: 'https://arkitera.com/proje/docem' });
  const seo = await import('../src/lib/seo.js');
  const meta = await seo.buildMeta('project', 'docem-ice-donuk-cocuklar-okulu', { DB: d1(db) });
  const html = (meta && meta.bodyHtml) || '';
  assert.match(html, /<a href="https:\/\/arkitera\.com\/proje\/docem" target="_blank" rel="noopener noreferrer nofollow">Egemen Karakaya<\/a>/);
});
await test('profilli fotoğrafçı SSR\'de /kisi bağlantısı olarak kalır', async () => {
  const db = projectDb({ creditText: 'Cemal Emden', sourceUrl: 'https://arkitera.com/proje/docem' });
  db.prepare(`INSERT INTO architects (id, slug, name) VALUES (1, 'cemal-emden', 'Cemal Emden')`).run();
  db.prepare(`INSERT INTO project_photographers (project_id, architect_id) VALUES (1, 1)`).run();
  const seo = await import('../src/lib/seo.js');
  const meta = await seo.buildMeta('project', 'docem-ice-donuk-cocuklar-okulu', { DB: d1(db) });
  const html = (meta && meta.bodyHtml) || '';
  assert.ok(html.includes('/kisi/cemal-emden'), 'profil bağlantısı');
  assert.ok(!html.includes('arkitera.com'), 'profil varsa dış bağlantı yok');
});

// -------------------------------------------------------------------------------------------
section('canonicalSync — var olan projeye sonradan eklenen source_url yazılır, boş gönderi silmez');

await test('source_url dolu gelirse UPDATE eder, boş gelirse mevcut değeri KORUR', () => {
  const sync = read('../src/lib/canonicalSync.js');
  assert.ok(sync.includes("sets.splice(-1, 0, 'source_url = ?');"), 'UPDATE dalında source_url yazılmalı');
  assert.match(sync, /if \(row\.source_url\) \{\s*\n\s*sets\.splice\(-1, 0, 'source_url = \?'\);/, 'yalnızca dolu geldiğinde (images ile aynı koruma)');
});
// SÜRÜM SABİTLEMEZ, TABAN ARAR (düzeltme, 2026-09-12): bu test iki sürümü de TAM DEĞERLE
// ('v42'/'v136') sabitliyordu, yani sonraki HER artırım onu kırıyordu. Nitekim kırdı: performans
// turu SSR_CACHE_VERSION'ı v137'ye çıkarınca test başarısız oldu ve preflight — dolayısıyla
// ./deploy.sh — main'de kırmızı kaldı. Testin asıl amacı "bu turun gövde değişikliği eski
// önbelleği bağlantısız bırakmasın" yani sürüm GERİ GİTMESİN; ileri gitmesi sorun değil. Artık
// sayısal taban karşılaştırılır: artırımlar geçer, düşürme/silme yakalanır.
await test('önbellek sürümleri bu turun tabanının altına düşmemiş (artırım serbest)', () => {
  const versionOf = (src, re, label) => {
    const m = src.match(re);
    assert.ok(m, `${label} okunamadı`);
    return parseInt(m[1], 10);
  };
  const api = versionOf(read('../src/lib/publicCache.js'), /const API_PAYLOAD_VERSION = 'v(\d+)';/, 'API_PAYLOAD_VERSION');
  const ssr = versionOf(read('../src/lib/ssrCache.js'), /export const SSR_CACHE_VERSION = 'v(\d+)';/, 'SSR_CACHE_VERSION');
  assert.ok(api >= 42, `API_PAYLOAD_VERSION v${api} < v42 (bu turun tabanı)`);
  assert.ok(ssr >= 136, `SSR_CACHE_VERSION v${ssr} < v136 (bu turun tabanı)`);
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) {
  for (const f of failures) console.error(`  - ${f.name}: ${f.message}`);
  process.exit(1);
}
