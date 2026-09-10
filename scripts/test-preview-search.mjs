#!/usr/bin/env node
// ÖNİZLEME ("soluk") KAYITLARININ ARAMADA GÖRÜNMESİ — BİRİM TESTLERİ
// (kullanıcı isteği, 2026-09-10 madde 5: "Arama çubuğunda canlıdaki arşiv içerikleri bulunabilsin
// ve bu seçeneklere tıklandığında ... Bu profil sana mı ait? popupı çıksın.")
//
// KAPSAM — yalnızca SUNUCU tarafı: classicSearch (üst navigasyondaki öneri penceresi VE arama.html
// tam sonuç sayfası AYNI fonksiyondan beslenir, bkz. src/routes/legacyContent.js#
// handlePublicSearchSuggest/handlePublicSearchFull). Popup'ın kendisi istemcide, hiçbir render
// noktasına dokunmadan çalışır: js/components/preview-cards.js sonuçtaki <a> bağlantılarını
// /api/public/preview'dan gelen slug'larla eşleştirip soluklaştırır ve tıklamayı yakalar — bu
// yüzden burada test edilecek istemci kodu YOKTUR.
//
// ÜÇ DURUM (bkz. migrations/0107_preview_state.sql):
//   hidden_at NULL                       -> canlı        -> aramada VAR
//   hidden_at DOLU + preview_at DOLU     -> önizleme     -> aramada VAR, ama canlıların ARKASINDA
//   hidden_at DOLU + preview_at NULL     -> tam arşiv    -> aramada YOK
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

// D1 shim (node:sqlite) — scripts/test-office-member-profile-edit.mjs ile BİREBİR aynı.
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

const NOW = new Date().toISOString();
// Her tipte üç durumdan birer kayıt. Adlar AYNI sorguyla (tek kelime) eşleşecek şekilde seçildi ki
// üçünün de aday havuzuna girdiği, filtrenin yalnızca duruma göre çalıştığı kesin olsun.
function seed(db) {
  const ins = (sql, ...p) => db.prepare(sql).run(...p);
  ins(`INSERT INTO offices (slug, name, loc, cats, source) VALUES ('ofis-canli', 'Çinici Canlı', 'Ankara', '[]', 'legacy_static')`);
  ins(`INSERT INTO offices (slug, name, loc, cats, source, hidden_at, preview_at) VALUES ('ofis-onizleme', 'Çinici Önizleme', 'Ankara', '[]', 'legacy_static', ?, ?)`, NOW, NOW);
  ins(`INSERT INTO offices (slug, name, loc, cats, source, hidden_at) VALUES ('ofis-arsiv', 'Çinici Arşiv', 'Ankara', '[]', 'legacy_static', ?)`, NOW);

  ins(`INSERT INTO architects (slug, name, source) VALUES ('kisi-canli', 'Çinici Canlı', 'legacy_static')`);
  ins(`INSERT INTO architects (slug, name, source, hidden_at, preview_at) VALUES ('kisi-onizleme', 'Çinici Önizleme', 'legacy_static', ?, ?)`, NOW, NOW);
  ins(`INSERT INTO architects (slug, name, source, hidden_at) VALUES ('kisi-arsiv', 'Çinici Arşiv', 'legacy_static', ?)`, NOW);

  ins(`INSERT INTO projects (slug, title, source) VALUES ('proje-canli', 'Çinici Canlı', 'legacy_static')`);
  ins(`INSERT INTO projects (slug, title, source, hidden_at, preview_at) VALUES ('proje-onizleme', 'Çinici Önizleme', 'legacy_static', ?, ?)`, NOW, NOW);
  ins(`INSERT INTO projects (slug, title, source, hidden_at) VALUES ('proje-arsiv', 'Çinici Arşiv', 'legacy_static', ?)`, NOW);

  ins(`INSERT INTO products (slug, title, kind, source) VALUES ('urun-canli', 'Çinici Canlı', 'product', 'legacy_static')`);
  ins(`INSERT INTO products (slug, title, kind, source, hidden_at, preview_at) VALUES ('urun-onizleme', 'Çinici Önizleme', 'product', 'legacy_static', ?, ?)`, NOW, NOW);
  ins(`INSERT INTO products (slug, title, kind, source, hidden_at) VALUES ('urun-arsiv', 'Çinici Arşiv', 'product', 'legacy_static', ?)`, NOW);
}

const GROUPS = [['architects', 'name'], ['offices', 'name'], ['projects', 'title'], ['products', 'title']];

console.log('\nönizleme kayıtları aramada');

await test('önizleme kayıtları BULUNUR, tam arşivdekiler bulunmaz', async () => {
  const db = freshDb(); seed(db);
  const r = await classicSearch({ DB: d1(db) }, 'Çinici', { perGroup: 20 });
  for (const [group, titleKey] of GROUPS) {
    const names = r[group].map(x => x[titleKey]);
    assert.deepEqual(names, ['Çinici Canlı', 'Çinici Önizleme'], `${group}: ${JSON.stringify(names)}`);
  }
});

await test('önizleme HER ZAMAN canlının arkasında sıralanır (skoru daha yüksek olsa bile)', async () => {
  const db = freshDb(); seed(db);
  // Önizleme kaydına TAM eşleşen, canlıya yalnızca kısmi eşleşen bir sorgu: skor sıralaması tek
  // başına bıraksaydı önizleme başa geçerdi.
  // name_fold GENERATED bir kolon (bkz. migrations/0079) — yalnızca name yazılır, fold türetilir.
  db.prepare(`UPDATE offices SET name = 'Çinici' WHERE slug = 'ofis-onizleme'`).run();
  const r = await classicSearch({ DB: d1(db) }, 'Çinici', { perGroup: 20 });
  assert.deepEqual(r.offices.map(o => o.name), ['Çinici Canlı', 'Çinici']);
});

await test('totals önizlemeyi de sayar (pencere ile sayfa aynı toplamı söyler)', async () => {
  const db = freshDb(); seed(db);
  const r = await classicSearch({ DB: d1(db) }, 'Çinici', { perGroup: 20 });
  assert.deepEqual(r.totals, { architects: 2, offices: 2, projects: 2, products: 2 });
});

await test('perGroup sınırı önizlemeyi ELER, canlıyı değil', async () => {
  const db = freshDb(); seed(db);
  const r = await classicSearch({ DB: d1(db) }, 'Çinici', { perGroup: 1 });
  for (const [group, titleKey] of GROUPS) {
    assert.deepEqual(r[group].map(x => x[titleKey]), ['Çinici Canlı'], group);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nBaşarısız testler:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
  process.exit(1);
}
