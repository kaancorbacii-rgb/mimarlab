#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-11 — BİRİM TESTLERİ
//   madde 1: "Blurlu bir firmadan bazı kurucuların ismini sildim ama hâlâ firma popup'ında
//            gözüküyorlar ... kişi popup'larında da dinamik ve eş zamanlı olarak bu firma bilgisi
//            kalkmalı." (Aboutblank bulgusu: kurucular yapısal office_founders bağlarından geliyordu,
//            taslak metninde yazılı değildi — silmek hiçbir bağı koparmıyordu.)
//   madde 2: "Admin ... telif butonuna tıklanmadan değişiklik yapılabilsin. Değişiklik yapılınca
//            kaydedilebilsin ama içerik blursuz şekilde yayınlanmasın."
//
// scripts/test-rights-archive.mjs ile AYNI desen: node:assert + node:sqlite üzerinde GERÇEK schema.sql,
// canlı route/lib fonksiyonları doğrudan çağrılır.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { handleSubmissionRoute } from '../src/routes/submissions.js';
import { sha256Hex } from '../src/lib/crypto.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }

function d1(db) {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = db.prepare(sql).get(...params); if (r === undefined) return null; return col ? r[col] : { ...r }; },
    async all() { return { results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }; },
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; } };
}
function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0079_search_fold_columns.sql', import.meta.url), 'utf8'));
  return db;
}

// Aboutblank'ın canlıdaki şekli: ÖNİZLEMEDE bir firma, kurucuları office_founders bağlarıyla bağlı,
// taslak metninde hiç yazılı değil. Ozan'ın birincil firması BAŞKA bir firma (o bağ korunmalı);
// "Gizli Kurucu" bağlı ama formda gösterilmemiş (ona dokunulmamalı).
async function seed(db) {
  const now = Date.now();
  db.exec(`
    INSERT INTO offices (id, slug, name, loc, cats, source, legacy_key, hidden_at, preview_at) VALUES
      (1, 'aboutblank', 'Aboutblank', 'İstanbul', '"Mimarlık"', 'legacy_static', 'Aboutblank', datetime('now'), datetime('now')),
      (2, 'baska-ofis', 'Başka Ofis', 'İstanbul', '"Mimarlık"', 'legacy_static', 'Başka Ofis', NULL, NULL);
    INSERT INTO architects (id, slug, name, source, legacy_key, office_id) VALUES
      (10, 'hasan-sitki-gumussoy', 'Hasan Sıtkı Gümüşsoy', 'legacy_static', 'Hasan Sıtkı Gümüşsoy', 1),
      (11, 'erhan-vural', 'Erhan Vural', 'legacy_static', 'Erhan Vural', 1),
      (12, 'gokhan-kodalak', 'Gökhan Kodalak', 'legacy_static', 'Gökhan Kodalak', 1),
      (13, 'ozan-ozdilek', 'Ozan Özdilek', 'legacy_static', 'Ozan Özdilek', 2),
      (14, 'gizli-kurucu', 'Gizli Kurucu', 'legacy_static', 'Gizli Kurucu', 1);
    INSERT INTO office_founders (office_id, architect_id) VALUES (1, 10), (1, 11), (1, 12), (1, 13), (1, 14), (2, 13);
  `);
  // Kullanıcılar ÖNCE — architect_submissions.owner_user_id users(id)'ye FOREIGN KEY.
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, 'x', ?, ?, ?)`).run('u-admin', 'admin@example.com', 'Admin', 'admin', now);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, 'x', ?, ?, ?)`).run('u-uye', 'uye@example.com', 'Üye', 'user', now);
  for (const uid of ['u-admin', 'u-uye']) {
    db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`).run(await sha256Hex(`tok-${uid}`), uid, now, now + 3600_000);
  }
  db.prepare(
    `INSERT INTO architect_submissions (id, owner_user_id, status, created_at, updated_at, name, claimed_profile_key, office) VALUES (?, ?, 'archived', ?, ?, ?, ?, ?)`
  ).run('as-erhan', 'u-admin', now, now, 'Erhan Vural', 'Erhan Vural', 'Aboutblank, Başka Ofis');
}

const envRef = { env: null };
const req = (uid, path, init = {}) => new Request(`https://mimarlab.com${path}`, {
  ...init, headers: { 'Content-Type': 'application/json', Cookie: `__Host-mimarlab_session=tok-${uid}`, ...(init.headers || {}) },
});
const call = (uid, path, init) => handleSubmissionRoute(req(uid, path, init), envRef.env, new URL(`https://mimarlab.com${path}`));
const officeBody = (extra = {}) => ({ name: 'Aboutblank', claimed_profile_key: 'Aboutblank', loc: 'İstanbul', cats: 'Mimarlık', yil: 2005, about: 'Aboutblank açıklaması', ...extra });
const founderIds = (db, officeId) => db.prepare(`SELECT architect_id FROM office_founders WHERE office_id = ? ORDER BY architect_id`).all(officeId).map(r => r.architect_id);
const officeIdOf = (db, id) => db.prepare(`SELECT office_id FROM architects WHERE id = ?`).get(id).office_id;
const officeState = (db, id) => db.prepare(`SELECT hidden_at, preview_at, about FROM offices WHERE id = ?`).get(id);

section('madde 1 — Kurucular kutusundan silinen kişi firmadan TAMAMEN kopar');

await test('silinen kurucu: office_founders + birincil firma + kişi taslağındaki firma metni temizlenir', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  const res = await call('u-admin', '/api/offices', { method: 'POST', body: JSON.stringify(officeBody({
    founders: ['Hasan Sıtkı Gümüşsoy'], team: ['Gökhan Kodalak'],
    foundersShown: ['Hasan Sıtkı Gümüşsoy', 'Erhan Vural', 'Gökhan Kodalak', 'Ozan Özdilek'],
    rightsAccepted: true,
  })) });
  assert.equal(res.status, 201, await res.clone().text());
  // Hasan (kutuda kaldı) ve Gizli Kurucu (kutuda hiç GÖSTERİLMEDİ) bağlı kalır.
  assert.deepEqual(founderIds(db, 1), [10, 14]);
  assert.equal(officeIdOf(db, 11), null, 'Erhan firmadan tamamen kopmalı');
  const sub = db.prepare(`SELECT office FROM architect_submissions WHERE id = 'as-erhan'`).get();
  assert.equal(sub.office, 'Başka Ofis', 'kişi popup\'ının okuduğu taslak metninden de düşmeli, diğer firma kalmalı');
});

await test("Kurucular'dan Ekip'e taşınan kişi firmada kalır (yalnızca kurucu bağı kalkar)", async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await call('u-admin', '/api/offices', { method: 'POST', body: JSON.stringify(officeBody({
    founders: ['Hasan Sıtkı Gümüşsoy'], team: ['Gökhan Kodalak'],
    foundersShown: ['Hasan Sıtkı Gümüşsoy', 'Gökhan Kodalak'], rightsAccepted: true,
  })) });
  assert.ok(!founderIds(db, 1).includes(12), 'kurucu bağı kalkmalı');
  assert.equal(officeIdOf(db, 12), 1, 'birincil firması korunmalı (hâlâ ekipte)');
});

await test('kişinin BAŞKA firmayla olan bağı korunur', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await call('u-admin', '/api/offices', { method: 'POST', body: JSON.stringify(officeBody({
    founders: ['Hasan Sıtkı Gümüşsoy'], team: [], foundersShown: ['Hasan Sıtkı Gümüşsoy', 'Ozan Özdilek'], rightsAccepted: true,
  })) });
  assert.ok(!founderIds(db, 1).includes(13), 'bu firmadaki bağ kalkmalı');
  assert.deepEqual(founderIds(db, 2), [13], 'başka firmadaki kurucu bağı korunmalı');
  assert.equal(officeIdOf(db, 13), 2, 'birincil firması başka firma — dokunulmamalı');
});

await test('formda GÖSTERİLMEYEN bağa dokunulmaz (foundersShown yoksa hiçbir bağ kopmaz)', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await call('u-admin', '/api/offices', { method: 'POST', body: JSON.stringify(officeBody({
    founders: ['Hasan Sıtkı Gümüşsoy'], rightsAccepted: true,
  })) });
  assert.deepEqual(founderIds(db, 1), [10, 11, 12, 13, 14]);
});

section('madde 2 — admin telifsiz kaydederse içerik YAYINA ALINMAZ');

await test('önizlemedeki firma: admin beyansız kaydeder → içerik güncellenir, blurlu kalır, beyan izi yazılmaz', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  const res = await call('u-admin', '/api/offices', { method: 'POST', body: JSON.stringify(officeBody({ about: 'Yeni açıklama' })) });
  assert.equal(res.status, 201, await res.clone().text());
  const s = officeState(db, 1);
  assert.equal(s.about, 'Yeni açıklama', 'değişiklik kaydedilmeli');
  assert.ok(s.hidden_at && s.preview_at, 'önizleme (blurlu) durumunda kalmalı');
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM rights_acceptances`).get().c, 0);
});

await test('önizlemedeki firma: admin beyanla kaydeder → blursuz yayına alınır', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  const res = await call('u-admin', '/api/offices', { method: 'POST', body: JSON.stringify(officeBody({ rightsAccepted: true })) });
  assert.equal(res.status, 201, await res.clone().text());
  const s = officeState(db, 1);
  assert.equal(s.hidden_at, null);
  assert.equal(s.preview_at, null);
});

await test('admin beyansız YENİ firma ekler → önizleme (blurlu) olarak eklenir', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  const res = await call('u-admin', '/api/offices', { method: 'POST', body: JSON.stringify({ name: 'Yepyeni Ofis', loc: 'İstanbul', cats: 'Mimarlık', yil: 2020, about: 'x' }) });
  assert.equal(res.status, 201, await res.clone().text());
  const row = db.prepare(`SELECT hidden_at, preview_at FROM offices WHERE name = 'Yepyeni Ofis'`).get();
  assert.ok(row, 'kayıt oluşmalı');
  assert.ok(row.hidden_at && row.preview_at, 'önizleme olarak eklenmeli');
});

await test('yayındaki kayıt: admin beyansız PATCH → yayında kalır (görünürlük değişmez)', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  const create = await call('u-admin', '/api/offices', { method: 'POST', body: JSON.stringify({ name: 'Başka Ofis', claimed_profile_key: 'Başka Ofis', loc: 'İstanbul', cats: 'Mimarlık', yil: 2001, about: 'a', rightsAccepted: true }) });
  const { id } = await create.json();
  const res = await call('u-admin', `/api/offices/${id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Başka Ofis', claimed_profile_key: 'Başka Ofis', loc: 'İstanbul', cats: 'Mimarlık', yil: 2001, about: 'b' }) });
  assert.equal(res.status, 200, await res.clone().text());
  const s = officeState(db, 2);
  assert.equal(s.about, 'b');
  assert.equal(s.hidden_at, null, 'yayındaki kayıt gizlenmemeli');
});

await test('admin OLMAYAN üye beyansız gönderemez (422, değişmedi)', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  const res = await call('u-uye', '/api/offices', { method: 'POST', body: JSON.stringify({ name: 'Üye Ofisi', loc: 'İstanbul', cats: 'Mimarlık', yil: 2020, about: 'x' }) });
  assert.equal(res.status, 422, await res.clone().text());
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
