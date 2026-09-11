#!/usr/bin/env node
// BOŞLUKSUZ YAZIM ARAMASI — BİRİM TESTLERİ (kullanıcı isteği, 2026-09-11: "perse yazınca da Per Se
// Mimarlık çıksın, arama çubuğunda küçük farklılıklar yüzünden aranan şeyler kaçmasın").
//
// KAPSAM: classicSearch (üst navigasyondaki öneri penceresi VE arama.html tam sonuç sayfası AYNI
// fonksiyondan beslenir, bkz. src/routes/legacyContent.js). SQL aday getirme (likeCondition'daki
// boşluksuz kolon dalı) VE JS skorlaması (fieldScore'daki collapsedToken) birlikte test edilir —
// biri diğeri olmadan satırı hiç göstermez (SQL getirmezse skorlama hiç çalışmaz).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { classicSearch } from '../src/lib/classicSearch.js';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 4).join('\n       ')}`); }
}

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
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0079_search_fold_columns.sql', import.meta.url), 'utf8'));
  return db;
}

const db = freshDb();
db.exec(`
  INSERT INTO offices (slug, name, loc, cats, source) VALUES
    ('per-se-mimarlik', 'Per Se Mimarlık', 'İstanbul', '["Mimarlık"]', 'legacy_static'),
    ('ilgisiz-firma', 'İlgisiz Firma', 'Ankara', '["Mimarlık"]', 'legacy_static');
  INSERT INTO architects (slug, name, source) VALUES ('ilgisiz-mimar', 'İlgisiz Mimar', 'legacy_static');
`);
const env = { DB: d1(db) };

await test('"perse" (boşluksuz) Per Se Mimarlık\'ı bulur', async () => {
  const r = await classicSearch(env, 'perse', { perGroup: 20 });
  const names = r.offices.map(o => o.name);
  assert.ok(names.includes('Per Se Mimarlık'), `beklenen "Per Se Mimarlık", gelen: ${JSON.stringify(names)}`);
});

await test('"per se" (boşluklu) hâlâ çalışıyor (regresyon)', async () => {
  const r = await classicSearch(env, 'per se', { perGroup: 20 });
  const names = r.offices.map(o => o.name);
  assert.ok(names.includes('Per Se Mimarlık'), `beklenen "Per Se Mimarlık", gelen: ${JSON.stringify(names)}`);
});

await test('"perse" ilgisiz firmayı GETİRMİYOR', async () => {
  const r = await classicSearch(env, 'perse', { perGroup: 20 });
  const names = r.offices.map(o => o.name);
  assert.ok(!names.includes('İlgisiz Firma'), `beklenmedik eşleşme: ${JSON.stringify(names)}`);
});

await test('"pers" (kısmi boşluksuz önek) de bulur', async () => {
  const r = await classicSearch(env, 'pers', { perGroup: 20 });
  const names = r.offices.map(o => o.name);
  assert.ok(names.includes('Per Se Mimarlık'), `beklenen "Per Se Mimarlık", gelen: ${JSON.stringify(names)}`);
});

await test('çok kelimeli sorguda boşluksuz dal eklenmiyor (ifade-ağacı genişlemesi yok)', async () => {
  // "per se ilgisiz" üç kelimelik bir sorgu — collapsedOnly dalı TETİKLENMEMELİ (variants.length>1).
  // Burada davranışsal doğrulama: sorgu hata vermeden çalışıyor ve boş sonuç dönüyor (hiçbir alan
  // üç kelimenin TAMAMINI içermiyor).
  const r = await classicSearch(env, 'per se ilgisiz', { perGroup: 20 });
  assert.equal(r.offices.length, 0);
});

console.log(`\n${passed} geçti, ${failed} başarısız.`);
if (failed) { failures.forEach(f => console.error(`FAIL ${f.name}: ${f.message}`)); process.exit(1); }
