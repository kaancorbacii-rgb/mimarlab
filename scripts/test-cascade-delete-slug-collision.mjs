#!/usr/bin/env node
// ETKİLEŞİM ANAHTARI ÇAKIŞMASI — REGRESYON TESTİ (canlı bulgu, denetim 2026-09-10).
//
// SEMPTOM (canlıda ölçüldü): offices tablosunda AYNI slug'a düşen iki kayıt vardı —
//   #66  "r.a.f. studio"  (yayında, 5 proje künyesi, 2 onaylı sahiplenme)
//   #670 "r.a.f.studio"   (arşiv/önizleme mükerreri, HİÇBİR ilişkisi yok)
// slugify("r.a.f.studio") === slugify("r.a.f. studio") === "r-a-f-studio".
//
// comments/ratings/saved_items/shared_items/follows satırları bu slug ile anahtarlanır. Mükerrer
// kaydı silmek `deleteEngagement(env,'office', slugify(name))` üzerinden HAYATTA KALAN kaydın
// etkileşim satırlarını da siliyordu (canlıda tam 1 shared_items satırı bu durumdaydı).
//
// KURAL: anahtar başka bir (silinmemiş) kayıtla paylaşılıyorsa etkileşim temizliği ATLANIR.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { cascadeDeleteOffice, cascadeDeleteArchitect } from '../src/lib/cascadeDelete.js';
import { slugify } from '../src/lib/slugify.js';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }

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
  return db;
}
const user = { id: 'u-admin', role: 'admin' };
const count = (db, sql) => Number(db.prepare(sql).get().n);

// ---------------------------------------------------------------------------------------------
section('slugify çakışması gerçekten var (bulgunun temeli)');

await test('"r.a.f.studio" ve "r.a.f. studio" AYNI slug\'a düşer', () => {
  assert.equal(slugify('r.a.f.studio'), 'r-a-f-studio');
  assert.equal(slugify('r.a.f. studio'), 'r-a-f-studio');
});

// ---------------------------------------------------------------------------------------------
section('cascadeDeleteOffice — çakışan anahtarda etkileşim satırlarına DOKUNMAZ');

function seedOffices(db) {
  db.exec(`
    INSERT INTO offices (id, slug, name, loc, cats, source) VALUES
      (66,  'r-a-f-studio',   'r.a.f. studio', 'İstanbul', '"Mimarlık"', 'legacy_static'),
      (670, 'r-a-f-studio-2', 'r.a.f.studio',  'İstanbul', '"Mimarlık"', 'legacy_static');
  `);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u1','a@b.c','x','Üye','user',?)`).run(Date.now());
  // Hayatta kalan #66'ya ait etkileşim satırları — hepsi slugify(name) = 'r-a-f-studio' anahtarlı.
  db.prepare(`INSERT INTO shared_items (id,user_id,item_type,item_key,item_title,channel,created_at) VALUES ('s1','u1','office','r-a-f-studio','r.a.f. studio','native',?)`).run(Date.now());
  db.prepare(`INSERT INTO saved_items (id,user_id,item_type,item_key,created_at) VALUES ('sv1','u1','office','r-a-f-studio',?)`).run(Date.now());
  db.prepare(`INSERT INTO follows (id,user_id,followed_type,followed_key,created_at) VALUES ('f1','u1','office','r-a-f-studio',?)`).run(Date.now());
}

await test('mükerrer kaydı silmek hayatta kalanın shared/saved/follows satırlarını SİLMEZ', async () => {
  const db = freshDb(); seedOffices(db);
  await cascadeDeleteOffice({ DB: d1(db) }, user, 'r.a.f.studio');
  assert.equal(count(db, `SELECT COUNT(*) n FROM shared_items WHERE item_key='r-a-f-studio'`), 1, 'shared_items silinmiş');
  assert.equal(count(db, `SELECT COUNT(*) n FROM saved_items WHERE item_key='r-a-f-studio'`), 1, 'saved_items silinmiş');
  assert.equal(count(db, `SELECT COUNT(*) n FROM follows WHERE followed_key='r-a-f-studio'`), 1, 'follows silinmiş');
});

await test('çakışma YOKKEN etkileşim temizliği ESKİSİ GİBİ çalışır (kural zayıflatılmadı)', async () => {
  const db = freshDb(); seedOffices(db);
  // Hayatta kalanı kaldır -> artık anahtar paylaşılmıyor.
  db.exec(`DELETE FROM offices WHERE id = 66`);
  await cascadeDeleteOffice({ DB: d1(db) }, user, 'r.a.f.studio');
  assert.equal(count(db, `SELECT COUNT(*) n FROM shared_items WHERE item_key='r-a-f-studio'`), 0);
  assert.equal(count(db, `SELECT COUNT(*) n FROM saved_items WHERE item_key='r-a-f-studio'`), 0);
  assert.equal(count(db, `SELECT COUNT(*) n FROM follows WHERE followed_key='r-a-f-studio'`), 0);
});

await test('mükerrer kaydın KENDİ ada bağlı satırları (claims/corrections/badges) yine silinir', async () => {
  const db = freshDb(); seedOffices(db);
  const now = Date.now();
  db.prepare(`INSERT INTO profile_claims (id,user_id,profile_type,profile_key,status,created_at,updated_at) VALUES ('c-dup','u1','office','r.a.f.studio','approved',?,?)`).run(now, now);
  db.prepare(`INSERT INTO profile_claims (id,user_id,profile_type,profile_key,status,created_at,updated_at) VALUES ('c-live','u1','office','r.a.f. studio','approved',?,?)`).run(now, now);
  await cascadeDeleteOffice({ DB: d1(db) }, user, 'r.a.f.studio');
  assert.equal(count(db, `SELECT COUNT(*) n FROM profile_claims WHERE profile_key='r.a.f.studio'`), 0, 'mükerrerin claim satırı kalmış');
  assert.equal(count(db, `SELECT COUNT(*) n FROM profile_claims WHERE profile_key='r.a.f. studio'`), 1, 'HAYATTA KALANIN claim satırı silinmiş — sahiplenme kaybı');
});

// ---------------------------------------------------------------------------------------------
section('cascadeDeleteArchitect — aynı koruma kişi tarafında da var');

await test('aynı slug\'a düşen iki kişi varsa etkileşim satırlarına dokunulmaz', async () => {
  const db = freshDb();
  db.exec(`
    INSERT INTO architects (id, slug, name, source) VALUES
      (1, 'ali-veli',   'Ali Veli',  'legacy_static'),
      (2, 'ali-veli-2', 'Ali  Veli', 'legacy_static');
  `);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u1','a@b.c','x','Üye','user',?)`).run(Date.now());
  db.prepare(`INSERT INTO saved_items (id,user_id,item_type,item_key,created_at) VALUES ('sv1','u1','architect','ali-veli',?)`).run(Date.now());
  assert.equal(slugify('Ali  Veli'), slugify('Ali Veli'), 'test öncülü: iki ad aynı slug\'a düşmeli');
  await cascadeDeleteArchitect({ DB: d1(db) }, 'Ali  Veli');
  assert.equal(count(db, `SELECT COUNT(*) n FROM saved_items WHERE item_key='ali-veli'`), 1);
});

// ---------------------------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nBaşarısız testler:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
}
process.exit(failed ? 1 : 0);
