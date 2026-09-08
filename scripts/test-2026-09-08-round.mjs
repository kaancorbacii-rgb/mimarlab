#!/usr/bin/env node
// 2026-09-08 TURU — BİRİM/ENTEGRASYON TESTLERİ (kullanıcı isteği maddeleri 1-6).
//
// scripts/test-meet-gateway.mjs ile AYNI desen: test koşucusu/npm bağımlılığı yok, node:assert +
// node:sqlite üzerinde GERÇEK bir SQLite. schema.sql'in üstüne migrations/0079 (arama katlama
// kolonları) da uygulanır — klasik aramanın ürettiği SQL'in gerçek şemaya karşı GEÇERLİLİĞİ de
// böylece test edilir (yalnızca JS skorlaması değil).
//
// KAPSAM:
//   madde 1 — atanan kişi/firma profilinde düzenleme yetkisi (office_position'a göre)
//   madde 2 — 'Yönetici' görevi: yetki VERİR ama Kurucular/Ekip'te GÖRÜNMEZ
//   madde 3 — Ekip kutusundan çıkarma cascade'i (Yönetici'ye dokunmaz, aksanlı ad eşleşir)
//   madde 4 — noktalı ad araması ("r.a.f. studio" / "raf studio" / "raf")
//   madde 5 — atanmış profillerde `claimed` bayrağı (kaynak uyarısı gizlenir)
//   madde 6 — aynı kişi hem Kurucular'da hem Ekip'te görünmesin (aksan katlamalı dedup)

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { classicSearch, queryWords, fieldScore } from '../src/lib/classicSearch.js';
import { anyProfileClaimed } from '../src/lib/claimedProfiles.js';
import { OFFICE_EDIT_POSITIONS, MANAGER_POSITION } from '../src/lib/projectClaimAccess.js';
import { cascadeRemovedProfileClaims } from '../src/lib/officeFounderCascade.js';
import { canUserEditProjectBySlug } from '../src/lib/projectClaimAccess.js';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 4).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }

// ---- D1 shim (node:sqlite) — test-meet-gateway.mjs ile BİREBİR aynı -----------------------------
function d1(db) {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = db.prepare(sql).get(...params); if (r === undefined) return null; return col ? r[col] : { ...r }; },
    async all() { return { results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }; },
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return {
    prepare: (sql) => stmt(sql, []),
    async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; },
  };
}
function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  // 0079: name_fold/title_fold/brand_fold generated kolonları — klasik arama bunlara bağlı.
  db.exec(readFileSync(new URL('../migrations/0079_search_fold_columns.sql', import.meta.url), 'utf8'));
  return db;
}

function seed(db) {
  const now = Date.now();
  db.exec(`
    INSERT INTO offices (slug, name, loc, cats, source) VALUES
      ('raf-studio', 'R.A.F. Studio', 'İstanbul / Beyoğlu', '["Mimarlık"]', 'legacy_static'),
      ('ds-mimarlik', 'DS Mimarlık', 'İstanbul / Beyoğlu', '["Mimarlık"]', 'legacy_static'),
      ('ind', 'IND [Inter.National.Design]', 'Hollanda', '["Mimarlık"]', 'legacy_static'),
      ('bos-firma', 'Boş Firma', 'Ankara', '["Mimarlık"]', 'legacy_static');
    INSERT INTO architects (slug, name, office_id, position, source) VALUES
      ('arman-akdogan', 'Arman Akdoğan', 3, 'Kurucu Ortak', 'legacy_static'),
      ('deniz-aslan', 'Deniz Aslan', 2, 'Kurucu Ortak', 'legacy_static');
    INSERT INTO office_founders (office_id, architect_id) VALUES (3, 1), (2, 2);
  `);
  const mkUser = (id, name, email, position) => db.prepare(
    `INSERT INTO users (id, email, password_hash, name, position, role, created_at) VALUES (?, ?, 'x', ?, ?, 'user', ?)`
  ).run(id, email, name, position, now);
  // "Arman Akdogan" — hesap adı AKSANSIZ yazılmış (canlı bulgu, madde 6).
  mkUser('u-arman', 'Arman Akdogan', 'arman@example.com', null);
  // "DS Mimarlık" — firmanın KENDİ kurumsal hesabı (madde 2).
  mkUser('u-ds', 'DS Mimarlık', 'ds@example.com', null);
  mkUser('u-ekip', 'Ayşe Demir', 'ayse@example.com', null);

  const mkClaim = (id, user, key, pos) => db.prepare(
    `INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at, office_position) VALUES (?, ?, 'office', ?, 'approved', ?, ?, ?)`
  ).run(id, user, key, now, now, pos);
  mkClaim('c-arman', 'u-arman', 'IND [Inter.National.Design]', 'Kurucu Ortak');
  mkClaim('c-ds', 'u-ds', 'DS Mimarlık', MANAGER_POSITION);
  mkClaim('c-ekip', 'u-ekip', 'DS Mimarlık', 'Ekip Üyesi');
}

// ---- madde 1: atamanın GERÇEKTEN düzenleme yetkisi vermesi -------------------------------------
section('madde 1 — atanan profilde düzenleme yetkisi');

function seedProject(db) {
  db.exec(`
    INSERT INTO projects (slug, title, source) VALUES ('ds-proje', 'DS Projesi', 'legacy_static');
    INSERT INTO project_designers (project_id, office_id) VALUES (1, 2);
  `);
}

await test('firma ataması, o firmanın projelerini düzenleme yetkisi verir', async () => {
  const db = freshDb(); seed(db); seedProject(db);
  const env = { DB: d1(db) };
  // 'Yönetici' görevli kurumsal hesap (madde 2) — yetkili
  assert.equal(await canUserEditProjectBySlug(env, { id: 'u-ds', role: 'user' }, 'ds-proje'), true);
  // 'Ekip Üyesi' görevli hesap — YETKİSİZ (mevcut kural, korunuyor)
  assert.equal(await canUserEditProjectBySlug(env, { id: 'u-ekip', role: 'user' }, 'ds-proje'), false);
  // başka firmanın sahibi — YETKİSİZ
  assert.equal(await canUserEditProjectBySlug(env, { id: 'u-arman', role: 'user' }, 'ds-proje'), false);
});

await test('GÖREVSİZ (office_position NULL) atama HİÇBİR yetki vermez — sessiz ölü onay', async () => {
  const db = freshDb(); seed(db); seedProject(db);
  db.exec(`UPDATE profile_claims SET office_position = NULL WHERE id = 'c-ds'`);
  const env = { DB: d1(db) };
  assert.equal(await canUserEditProjectBySlug(env, { id: 'u-ds', role: 'user' }, 'ds-proje'), false);
});

await test('kişi (architect) ataması görevden BAĞIMSIZ yetki verir', async () => {
  const db = freshDb(); seed(db);
  db.exec(`
    INSERT INTO projects (slug, title, source) VALUES ('arman-proje', 'Arman Projesi', 'legacy_static');
    INSERT INTO project_designers (project_id, architect_id) VALUES (1, 1);
  `);
  const now = Date.now();
  db.prepare(`INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at) VALUES ('c-arch','u-arman','architect','Arman Akdoğan','approved',?,?)`).run(now, now);
  const env = { DB: d1(db) };
  assert.equal(await canUserEditProjectBySlug(env, { id: 'u-arman', role: 'user' }, 'arman-proje'), true);
});

// ---- madde 4: noktalı ad araması ---------------------------------------------------------------
section('madde 4 — noktalı/kısaltmalı ad araması');

await test('queryWords ardışık baş harfleri birleştirir', () => {
  assert.deepEqual(queryWords('r.a.f. studio'), ['raf', 'studio']);
  assert.deepEqual(queryWords('raf studio'), ['raf', 'studio']);
  assert.deepEqual(queryWords('M. Ali'), ['m', 'ali']); // tek baş harf birleştirilmez
});

await test('fieldScore noktalı adı her iki yazımla da bulur', () => {
  for (const q of ['r.a.f. studio', 'raf studio', 'raf', 'R.A.F']) {
    assert.notEqual(fieldScore('R.A.F. Studio', queryWords(q)), null, `"${q}" eşleşmedi`);
  }
  // ters yön: ad noktasız, sorgu noktalı
  assert.notEqual(fieldScore('RAF Studio', queryWords('r.a.f. studio')), null);
});

await test('yanlış pozitif üretmez', () => {
  assert.equal(fieldScore('Arf Studio', queryWords('raf studio')), null);
  assert.equal(fieldScore('Studio Fara', queryWords('r.a.f. studio')), null);
});

await test('mevcut davranış korunur (tam ad > önek)', () => {
  const w = queryWords('galata');
  assert.ok(fieldScore('Galata Kulesi', w) > fieldScore('Galatasaray Lisesi', w));
});

await test('classicSearch: "r.a.f. studio" / "raf studio" / "raf" firmayı bulur', async () => {
  const db = freshDb(); seed(db);
  const env = { DB: d1(db) };
  for (const q of ['r.a.f. studio', 'raf studio', 'raf', 'R.A.F.']) {
    const r = await classicSearch(env, q, { perGroup: 20 });
    const names = r.offices.map(o => o.name);
    assert.ok(names.includes('R.A.F. Studio'), `"${q}" -> ${JSON.stringify(names)}`);
  }
});

await test('classicSearch: proje/ürün grupları da (künye + marka SQL yolu) çalışır', async () => {
  const db = freshDb(); seed(db);
  db.exec(`
    INSERT INTO projects (slug, title, location, source) VALUES ('raf-evi', 'R.A.F. Evi', 'İstanbul', 'legacy_static');
    INSERT INTO project_designers (project_id, office_id) VALUES (1, 1);
    INSERT INTO products (slug, title, brand_name_raw, category, kind, source) VALUES ('raf-koltuk', 'Koltuk', 'R.A.F. Studio', 'Oturma', 'product', 'legacy_static');
  `);
  const env = { DB: d1(db) };
  const r = await classicSearch(env, 'raf', { perGroup: 20 });
  assert.ok(r.projects.map(p => p.title).includes('R.A.F. Evi'), JSON.stringify(r.projects));
  assert.ok(r.products.map(p => p.title).includes('Koltuk'), JSON.stringify(r.products));
  // künye (designer_names) yolu: firma adıyla arayınca proje de gelmeli
  const r2 = await classicSearch(env, 'r.a.f. studio', { perGroup: 20 });
  assert.ok(r2.projects.map(p => p.title).includes('R.A.F. Evi'), JSON.stringify(r2.projects));
});

await test('classicSearch: alakasız sorgu bu firmayı getirmez', async () => {
  const db = freshDb(); seed(db);
  const env = { DB: d1(db) };
  const r = await classicSearch(env, 'ankara konut', { perGroup: 20 });
  assert.ok(!r.offices.map(o => o.name).includes('R.A.F. Studio'));
});

// ---- madde 2: Yönetici görevi ------------------------------------------------------------------
section('madde 2 — Yönetici görevi');

await test("'Yönetici' firma düzenleme yetkisi VERİR", () => {
  assert.ok(OFFICE_EDIT_POSITIONS.has('Yönetici'));
  assert.ok(!OFFICE_EDIT_POSITIONS.has('Ekip Üyesi'));
});

// ---- madde 2/6: firma payload'ı ----------------------------------------------------------------
section('madde 2 + 5 + 6 — firma pop-up payload');

async function officePayload(slug) {
  const db = freshDb(); seed(db);
  const env = { DB: d1(db), IMG_KV: null };
  const { buildOfficePayload } = await import('../src/routes/office.js');
  return buildOfficePayload(env, slug);
}

await test('Yönetici hesabı Kurucular/Ekip listelerinde GÖRÜNMEZ', async () => {
  const p = await officePayload('ds-mimarlik');
  const names = [...p.founders, ...p.team].map(x => x.name);
  assert.ok(!names.includes('DS Mimarlık'), `görünmemeliydi: ${JSON.stringify(names)}`);
  // aynı firmadaki normal ekip üyesi ETKİLENMEZ
  assert.ok(p.team.map(x => x.name).includes('Ayşe Demir'), JSON.stringify(names));
});

await test('aynı kişi hem Kurucular hem Ekip listesinde çıkmaz (aksan katlamalı)', async () => {
  const p = await officePayload('ind');
  assert.ok(p.founders.map(x => x.name).includes('Arman Akdoğan'));
  assert.ok(!p.team.map(x => x.name).includes('Arman Akdogan'), `Ekip: ${JSON.stringify(p.team)}`);
});

await test('claimed bayrağı: atanmış firma true, atanmamış firma false', async () => {
  assert.equal((await officePayload('ds-mimarlik')).claimed, true);
  assert.equal((await officePayload('bos-firma')).claimed, false);
});

// ---- madde 5: anyProfileClaimed ----------------------------------------------------------------
section('madde 5 — anyProfileClaimed');

await test('künyedeki adlardan biri atanmışsa true', async () => {
  const db = freshDb(); seed(db);
  const env = { DB: d1(db) };
  assert.equal(await anyProfileClaimed(env, ['Bilinmeyen', 'DS Mimarlık']), true);
  assert.equal(await anyProfileClaimed(env, ['Bilinmeyen', 'Boş Firma']), false);
  assert.equal(await anyProfileClaimed(env, []), false);
  assert.equal(await anyProfileClaimed(env, [null, '', '  ']), false);
});

await test('reddedilmiş claim sayılmaz', async () => {
  const db = freshDb(); seed(db);
  db.exec(`UPDATE profile_claims SET status = 'rejected'`);
  const env = { DB: d1(db) };
  assert.equal(await anyProfileClaimed(env, ['DS Mimarlık']), false);
});

// ---- madde 3: Ekip kutusundan çıkarma cascade'i ------------------------------------------------
section('madde 3 — Ekip kutusundan çıkarma');

function claimStatus(db, id) {
  return db.prepare(`SELECT status FROM profile_claims WHERE id = ?`).get(id).status;
}

await test('Ekip kutusundan çıkarılan üyenin claim\'i iptal olur', async () => {
  const db = freshDb(); seed(db);
  const env = { DB: d1(db) };
  await cascadeRemovedProfileClaims(env, 'DS Mimarlık', [], { founders: false });
  assert.equal(claimStatus(db, 'c-ekip'), 'rejected');
});

await test('Yönetici hesabının claim\'ine ASLA dokunulmaz', async () => {
  const db = freshDb(); seed(db);
  const env = { DB: d1(db) };
  await cascadeRemovedProfileClaims(env, 'DS Mimarlık', [], { founders: false });
  await cascadeRemovedProfileClaims(env, 'DS Mimarlık', [], { founders: true });
  assert.equal(claimStatus(db, 'c-ds'), 'approved');
});

await test('kutuda duran üye korunur — aksan/büyük-küçük harf farkı olsa da', async () => {
  const db = freshDb(); seed(db);
  const env = { DB: d1(db) };
  await cascadeRemovedProfileClaims(env, 'DS Mimarlık', ['AYSE DEMIR'], { founders: false });
  assert.equal(claimStatus(db, 'c-ekip'), 'approved');
});

await test('Kurucu görevli claim, EKİP kutusundan çıkarma ile iptal edilmez', async () => {
  const db = freshDb(); seed(db);
  const env = { DB: d1(db) };
  await cascadeRemovedProfileClaims(env, 'IND [Inter.National.Design]', [], { founders: false });
  assert.equal(claimStatus(db, 'c-arman'), 'approved');
  await cascadeRemovedProfileClaims(env, 'IND [Inter.National.Design]', [], { founders: true });
  assert.equal(claimStatus(db, 'c-arman'), 'rejected');
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) { for (const f of failures) console.error(` - ${f.name}: ${f.message}`); process.exit(1); }
