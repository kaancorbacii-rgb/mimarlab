#!/usr/bin/env node
// DOĞRULANMAMIŞ GİRDİ -> D1 500 SINIFI — REGRESYON TESTLERİ (canlı bulgular, denetim 2026-09-10).
//
// Bu dosya, denetimde canlıda yakalanan İKİ ayrı "kullanıcı girdisi doğrudan D1'e gidiyor ve sorgu
// düşüyor" hatasını sabitler: (1) LIKE desen uzunluğu sınırı, (2) güvenli tamsayı aralığını aşan
// `?page=` değeri. İkisinin de belirtisi aynıydı: ziyaretçiye 500 "Sunucu hatası oluştu".
//
// --- (1) D1'İN LIKE DESEN UZUNLUĞU SINIRI ---
//
// SEMPTOM: üst navigasyondaki arama kutusuna 49 karakterden uzun TEK bir kelime yazan/yapıştıran
// her ziyaretçi "Sunucu hatası oluştu" alıyordu. Canlı Worker logu: `D1_ERROR: LIKE or GLOB pattern
// too complex: SQLITE_ERROR`. Ölçülen eşik: q 48 karakter -> 200, 49 karakter -> 500, yani
// `%` + q + `%` deseni 50 BAYTI aşınca D1 sorguyu tamamen reddediyor.
//
// Etkilenen uçlar (hepsi canlıda 500 dönüyordu): /api/public/search-suggest, /api/public/search,
// /api/photographers/search, /api/architects/search, /api/offices/search, /api/products/search.
//
// ÇÖZÜM: LIKE desenleri artık TEK bir yardımcıdan (src/lib/searchFold.js#likePattern) geçiyor ve
// gerekirse kısaltılıyor. Kısaltma ADAY ÜST KÜMESİ sözleşmesini BOZMAZ — daha kısa bir `%...%`
// deseni daha GENİŞ eşleşir, eleme zaten JS skorlamasında yapılır.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

//
// --- (2) `?page=` GÜVENLİ TAMSAYI ARALIĞI ---
//
// SEMPTOM: /api/projects?page=999999999999999999 ve /api/gundem?page=999999999999999999 canlıda 500
// dönüyordu. parseInt 1e18 üretiyor (Number.MAX_SAFE_INTEGER'ın üstünde); sayfalamayı JS'te yapan
// uçlarda zararsız boş dizi çıkıyor, ama OFFSET'i D1'e BAĞLAYAN yollarda sorgu düşüyordu.
// ÇÖZÜM: tüm liste uçları page'i src/lib/http.js#pageParam ile okur (1..MAX_PAGE arası kelepçe).
import { likePattern } from '../src/lib/searchFold.js';
import { classicSearch } from '../src/lib/classicSearch.js';
import { pageParam, MAX_PAGE, readJson } from '../src/lib/http.js';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }

const enc = new TextEncoder();
const bytes = (s) => enc.encode(s).length;
// Canlıda ölçülen sınır. Bu sabit src/lib/searchFold.js#LIKE_PATTERN_MAX_BYTES ile AYNI olmalı.
const MAX = 50;

// scripts/test-2026-09-10-round9.mjs ile AYNI d1 shim'i.
function d1(db) {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = db.prepare(sql).get(...params); if (r === undefined) return null; return col ? r[col] : { ...r }; },
    async all() { return { results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }; },
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; } };
}

// ---------------------------------------------------------------------------------------------
section('likePattern — desen HER ZAMAN sınırın altında ve biçimsel olarak geçerli');

await test('kısa değerler AYNEN geçer (davranış değişmedi)', () => {
  assert.equal(likePattern('galata'), '%galata%');
  assert.equal(likePattern('a'.repeat(48)), `%${'a'.repeat(48)}%`, '48 karakter tam sınırda, kısaltılmamalı');
});

await test('sınırı aşan her girdi 50 baytın altına iner', () => {
  for (const v of ['a'.repeat(49), 'a'.repeat(5000), 'ç'.repeat(400), '😀'.repeat(200), 'x y z '.repeat(50)]) {
    const p = likePattern(v);
    assert.ok(bytes(p) <= MAX, `desen ${bytes(p)} bayt (<= ${MAX} olmalı): ${v.slice(0, 12)}…`);
  }
});

await test('kaçış gerektiren karakterler kaçışlanır ve desen ASLA tek `\\` ile bitmez', () => {
  // Tek başına kalan bir ESCAPE karakteri SQLite'ta deseni geçersiz kılar ve sorguyu yine düşürürdü.
  for (const v of ['%_\\'.repeat(100), '\\'.repeat(200), '%'.repeat(200), '_'.repeat(200)]) {
    const p = likePattern(v);
    assert.ok(bytes(p) <= MAX, `desen ${bytes(p)} bayt`);
    const inner = p.slice(1, -1);
    const trailing = (inner.match(/\\*$/) || [''])[0].length;
    assert.equal(trailing % 2, 0, `desen yarım kalmış kaçış çiftiyle bitiyor: ${JSON.stringify(p)}`);
  }
});

await test('UTF-8 dizisi / vekil çifti ORTADAN bölünmez', () => {
  const p = likePattern('😀'.repeat(200));
  assert.ok(!/[\uD800-\uDFFF]/.test(p.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')), 'tek başına vekil karakter kalmış');
  const p2 = likePattern('ç'.repeat(200));
  assert.ok(!p2.includes('�'), 'bozuk kod noktası');
});

await test('önek/sonek jokerleri de bütçeye dahil', () => {
  assert.ok(bytes(likePattern('a'.repeat(500), '', '%')) <= MAX);
  assert.ok(bytes(likePattern('a'.repeat(500), '%', '')) <= MAX);
  assert.ok(bytes(likePattern('a'.repeat(500), '', '')) <= MAX);
});

// ---------------------------------------------------------------------------------------------
section('classicSearch — uzun sorgu artık sınırı aşan bir desen ÜRETMİYOR');

await test('gerçek SQLite üzerinde uzun sorgu hata vermeden çalışır ve kısa sorgu sonucu değişmez', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0079_search_fold_columns.sql', import.meta.url), 'utf8'));
  db.exec(`
    INSERT INTO offices (slug, name, loc, cats, source) VALUES ('autoban', 'Autoban', 'İstanbul', '["Mimarlık"]', 'legacy_static');
    INSERT INTO projects (slug, title, location, build_status, images, source, created_at)
      VALUES ('galataport', 'Galataport', 'İstanbul', 'built', '["a.webp"]', 'legacy_static', datetime('now'));
  `);
  const env = { DB: d1(db) };
  const hit = await classicSearch(env, 'galata', { perGroup: 3 });
  assert.equal(hit.totals.projects, 1, 'kısa sorgu hâlâ eşleşmeli');
  const long = await classicSearch(env, 'a'.repeat(400), { perGroup: 3 });
  assert.equal(long.totals.projects, 0);
  // Asıl sözleşme: SQL'e giden HİÇBİR desen sınırı aşmamalı. D1'in sınırı yerel SQLite'ta yok,
  // bu yüzden desenler doğrudan sorgudan yakalanır.
  const seen = [];
  const spyStmt = {
    bind: (...p) => { seen.push(...p.filter(x => typeof x === 'string' && x.includes('%'))); return spyStmt; },
    async all() { return { results: [] }; },
    async first() { return null; },
    async run() { return { success: true, meta: { changes: 0 } }; },
  };
  const spyEnv = { DB: { prepare: () => spyStmt, async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; } } };
  await classicSearch(spyEnv, 'b'.repeat(400), { perGroup: 3 });
  assert.ok(seen.length > 0, 'hiç LIKE parametresi üretilmedi — test artık doğru şeyi ölçmüyor');
  for (const p of seen) assert.ok(bytes(p) <= MAX, `classicSearch ${bytes(p)} baytlık desen üretti: ${p.slice(0, 20)}…`);
});

// ---------------------------------------------------------------------------------------------
section('kaynak — LIKE desenleri TEK yardımcıdan geçiyor');

await test('hiçbir route/lib ham `%${escapeLike(...)}%` kurmuyor', () => {
  const files = [
    '../src/lib/searchFold.js', '../src/lib/classicSearch.js',
    '../src/routes/product.js', '../src/routes/project.js', '../src/routes/hotspotTags.js',
  ];
  for (const f of files) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    const raw = src.match(/`%\$\{escapeLike\([^)]*\)\}%`/g) || [];
    assert.deepEqual(raw, [], `${f} — ham LIKE deseni kurulmuş, likePattern() kullanılmalı`);
  }
});

// ---------------------------------------------------------------------------------------------
section('pageParam — ?page= her zaman güvenli tamsayı aralığında');

await test('normal değerler aynen geçer', () => {
  assert.equal(pageParam(new URLSearchParams('page=1')), 1);
  assert.equal(pageParam(new URLSearchParams('page=74')), 74);
  assert.equal(pageParam(new URLSearchParams('')), 1, 'parametre yoksa 1');
});

await test('geçersiz/negatif/sıfır değerler 1e düşer', () => {
  for (const q of ['page=0', 'page=-5', 'page=abc', 'page=', 'page=NaN']) {
    assert.equal(pageParam(new URLSearchParams(q)), 1, q);
  }
});

await test('devasa değerler MAX_PAGE ile kelepçelenir ve OFFSET güvenli tamsayı kalır', () => {
  for (const q of ['page=999999999999999999', 'page=1e999', `page=${Number.MAX_SAFE_INTEGER}`, 'page=' + '9'.repeat(40)]) {
    const p = pageParam(new URLSearchParams(q));
    assert.ok(p <= MAX_PAGE, `${q} -> ${p}`);
    assert.ok(Number.isSafeInteger(p), `${q} -> ${p} güvenli tamsayı değil`);
    // Gerçek kullanım: OFFSET = (page - 1) * limit, limit en fazla 96.
    assert.ok(Number.isSafeInteger((p - 1) * 96), 'OFFSET güvenli tamsayı aralığının dışına çıkıyor');
  }
});

await test('hiçbir liste ucu page parametresini elle parseInt ETMİYOR', () => {
  for (const f of ['../src/routes/project.js', '../src/routes/product.js', '../src/routes/architect.js', '../src/routes/office.js', '../src/routes/gundem.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    const raw = src.match(/parseInt\(\s*(?:url\.searchParams|params)\.get\('page'\)/g) || [];
    assert.deepEqual(raw, [], `${f} — page elle parse ediliyor, pageParam() kullanılmalı`);
  }
});

// ---------------------------------------------------------------------------------------------
section('readJson — gövde ne olursa olsun NESNE döner');

// CANLI BULGU (denetim 2026-09-10): `POST /api/auth/login` gövdesi `null` -> 500. readJson geçerli
// ama nesne olmayan bir JSON'u (null/dizi/sayı/dize) olduğu gibi döndürüyor, çağıran ise
// `body.email` okuyor -> TypeError. Bu uç oturumsuz erişilebiliyor.
await test('null / dizi / skaler gövdeler {} olur, geçerli nesne aynen gelir', async () => {
  const req = (raw) => new Request('https://mimarlab.com/x', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw,
  });
  for (const raw of ['null', '[]', '[1,2]', '3', '"metin"', 'true', 'bozuk json', '']) {
    const body = await readJson(req(raw));
    assert.equal(typeof body, 'object', raw);
    assert.notEqual(body, null, `${raw} -> null döndü, çağıranlar body.alan okuyor`);
    assert.equal(Array.isArray(body), false, raw);
    // Asıl regresyon: alan okumak PATLAMAMALI.
    assert.equal(body.email, undefined, raw);
  }
  const ok = await readJson(req('{"email":"a@b.c","password":"x"}'));
  assert.equal(ok.email, 'a@b.c');
  assert.equal(ok.password, 'x');
});

// ---------------------------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nBaşarısız testler:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
}
process.exit(failed ? 1 : 0);
