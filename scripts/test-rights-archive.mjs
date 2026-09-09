#!/usr/bin/env node
// TELİF BEYANI KAPISI + ARŞİVİM — BİRİM TESTLERİ (kullanıcı isteği, 2026-09-10 madde 1/2/3).
//
// scripts/test-office-member-profile-edit.mjs ile AYNI desen: test koşucusu/npm bağımlılığı yok,
// node:assert + node:sqlite üzerinde GERÇEK bir SQLite ve schema.sql. Burada doğrulanan üç kural:
//   1) Gönderi uçları (POST/PATCH /api/<tip>) beyan onayı olmadan 422 döner (madde 1).
//   2) Arşivden yayına alma (POST /api/archive/publish) beyan onayı olmadan çalışmaz (madde 2).
//   3) Admin bir firmayı arşivlediğinde, o firmaya SONRADAN atanan kullanıcının Arşivim kutusunda
//      (GET /api/archive/mine) kayıt görünür ve onayla yayına alınabilir (madde 3'ün asıl akışı).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { handleSubmissionRoute } from '../src/routes/submissions.js';
import { handleArchiveRoute } from '../src/routes/archive.js';
import { runContentAction } from '../src/routes/legacyContent.js';
import { sha256Hex } from '../src/lib/crypto.js';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }

// ---- D1 shim (node:sqlite) — diğer test dosyalarıyla BİREBİR aynı ------------------------------
function d1(db) {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = db.prepare(sql).get(...params); if (r === undefined) return null; return col ? r[col] : { ...r }; },
    async all() { return { results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }; },
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return {
    prepare: (sql) => stmt(sql, []),
    async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; },
  };
}
function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0079_search_fold_columns.sql', import.meta.url), 'utf8'));
  return db;
}

async function seed(db) {
  const now = Date.now();
  db.exec(`
    INSERT INTO offices (slug, name, loc, cats, source) VALUES
      ('atanmamis-mimarlik', 'Atanmamış Mimarlık', 'İstanbul', '"Mimarlık"', 'legacy_static');
  `);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, 'x', ?, ?, ?)`)
    .run('u-admin', 'admin@example.com', 'Admin', 'admin', now);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, 'x', ?, ?, ?)`)
    .run('u-uye', 'uye@example.com', 'Firma Yetkilisi', 'user', now);
  for (const uid of ['u-admin', 'u-uye']) {
    db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
      .run(await sha256Hex(`tok-${uid}`), uid, now, now + 3600_000);
  }
}

function approveOfficeClaim(db, position = 'Kurucu') {
  const now = Date.now();
  db.prepare(
    `INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at, office_position)
     VALUES (?, ?, 'office', ?, 'approved', ?, ?, ?)`
  ).run('c-uye-office', 'u-uye', 'Atanmamış Mimarlık', now, now, position);
}

const req = (uid, path, init = {}) => new Request(`https://mimarlab.com${path}`, {
  ...init,
  headers: { 'Content-Type': 'application/json', Cookie: `__Host-mimarlab_session=tok-${uid}`, ...(init.headers || {}) },
});
const call = (handler, uid, path, init) => handler(req(uid, path, init), envRef.env, new URL(`https://mimarlab.com${path}`));
const envRef = { env: null };

section('madde 1 — gönderi uçlarında telif beyanı zorunlu');

await test('POST /api/offices: beyan onayı yoksa 422', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  const res = await call(handleSubmissionRoute, 'u-uye', '/api/offices', {
    method: 'POST', body: JSON.stringify({ name: 'Yeni Firma', cats: 'Mimarlık' }),
  });
  assert.equal(res.status, 422, await res.clone().text());
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM office_submissions`).get().c, 0);
});

await test('POST /api/offices: beyan onaylıysa kayıt oluşur ve denetim izi yazılır', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  const res = await call(handleSubmissionRoute, 'u-uye', '/api/offices', {
    method: 'POST', body: JSON.stringify({ name: 'Yeni Firma', cats: 'Mimarlık', rightsAccepted: true }),
  });
  assert.equal(res.status, 201, await res.clone().text());
  const row = db.prepare(`SELECT * FROM rights_acceptances`).get();
  assert.ok(row, 'rights_acceptances satırı yazılmalı');
  assert.equal(row.user_id, 'u-uye');
  assert.equal(row.content_type, 'offices');
  assert.equal(row.source, 'submit');
});

section('madde 3 — arşivlenen firma, ATANAN kullanıcının Arşivim kutusunda görünür');

await test('admin arşivler -> atama YOKKEN üyenin kutusunda görünmez', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await runContentAction(envRef.env, { id: 'u-admin', role: 'admin' }, { type: 'offices', action: 'archive', key: 'Atanmamış Mimarlık' });
  assert.ok(db.prepare(`SELECT hidden_at FROM offices WHERE name = 'Atanmamış Mimarlık'`).get().hidden_at, 'canonical satır gizlenmeli');
  const res = await call(handleArchiveRoute, 'u-uye', '/api/archive/mine', { method: 'GET' });
  const data = await res.json();
  assert.equal((data.items || []).length, 0);
});

await test('atama onaylanınca kayıt Arşivim kutusunda belirir', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await runContentAction(envRef.env, { id: 'u-admin', role: 'admin' }, { type: 'offices', action: 'archive', key: 'Atanmamış Mimarlık' });
  approveOfficeClaim(db);
  const res = await call(handleArchiveRoute, 'u-uye', '/api/archive/mine', { method: 'GET' });
  const data = await res.json();
  assert.equal(data.items.length, 1, JSON.stringify(data));
  assert.equal(data.items[0].title, 'Atanmamış Mimarlık');
  assert.equal(data.items[0].kind, 'office');
  assert.equal(data.items[0].type, 'offices');
});

await test('yetkisiz görevle (Ekip Üyesi) atanan kullanıcı kaydı GÖREMEZ', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await runContentAction(envRef.env, { id: 'u-admin', role: 'admin' }, { type: 'offices', action: 'archive', key: 'Atanmamış Mimarlık' });
  approveOfficeClaim(db, 'Ekip Üyesi');
  const res = await call(handleArchiveRoute, 'u-uye', '/api/archive/mine', { method: 'GET' });
  assert.equal((await res.json()).items.length, 0);
});

section('madde 2 — beyan onaylanmadan arşivden yayına alınamaz');

async function archivedIdFor(db) {
  return db.prepare(`SELECT id FROM office_submissions WHERE status = 'archived'`).get().id;
}

await test('POST /api/archive/publish: beyan yoksa 422 ve kayıt gizli kalır', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await runContentAction(envRef.env, { id: 'u-admin', role: 'admin' }, { type: 'offices', action: 'archive', key: 'Atanmamış Mimarlık' });
  approveOfficeClaim(db);
  const id = await archivedIdFor(db);
  const res = await call(handleArchiveRoute, 'u-uye', '/api/archive/publish', {
    method: 'POST', body: JSON.stringify({ type: 'offices', id }),
  });
  assert.equal(res.status, 422, await res.clone().text());
  assert.ok(db.prepare(`SELECT hidden_at FROM offices WHERE name = 'Atanmamış Mimarlık'`).get().hidden_at);
});

await test('POST /api/archive/publish: beyan onaylıysa kayıt yayına döner', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await runContentAction(envRef.env, { id: 'u-admin', role: 'admin' }, { type: 'offices', action: 'archive', key: 'Atanmamış Mimarlık' });
  approveOfficeClaim(db);
  const id = await archivedIdFor(db);
  const res = await call(handleArchiveRoute, 'u-uye', '/api/archive/publish', {
    method: 'POST', body: JSON.stringify({ type: 'offices', id, rightsAccepted: true }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(db.prepare(`SELECT hidden_at FROM offices WHERE name = 'Atanmamış Mimarlık'`).get().hidden_at, null);
  const acc = db.prepare(`SELECT * FROM rights_acceptances WHERE source = 'archive-publish'`).get();
  assert.ok(acc, 'arşivden yayına almanın denetim izi yazılmalı');
  assert.equal(acc.user_id, 'u-uye');
});

await test('atanmamış bir kullanıcı başkasının arşiv kaydını yayına alamaz (403)', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await runContentAction(envRef.env, { id: 'u-admin', role: 'admin' }, { type: 'offices', action: 'archive', key: 'Atanmamış Mimarlık' });
  const id = await archivedIdFor(db);
  const res = await call(handleArchiveRoute, 'u-uye', '/api/archive/publish', {
    method: 'POST', body: JSON.stringify({ type: 'offices', id, rightsAccepted: true }),
  });
  assert.equal(res.status, 403, await res.clone().text());
});

section('regresyon — ürünü arşivleyip yayına almak kaydı ÇOĞALTMAMALI');

await test('ürün: anahtarla arşivle -> yayına al, tek canonical satır kalır', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  db.exec(`INSERT INTO products (slug, legacy_key, kind, title, brand_name_raw, category, images, source)
           VALUES ('sandalye-marka', 'Marka|||Sandalye', 'product', 'Sandalye', 'Marka', 'Oturma', '["/media/a.webp"]', 'legacy_static')`);
  const admin = { id: 'u-admin', role: 'admin' };
  await runContentAction(envRef.env, admin, { type: 'products', action: 'archive', key: 'Marka|||Sandalye' });
  const draft = db.prepare(`SELECT id, claimed_slug FROM product_submissions WHERE status = 'archived'`).get();
  // GERÇEK BULGU (2026-09-10): taslak canonical satıra `claimed_slug` ile bağlanmazsa "Yayınla",
  // orijinali geri açmak yerine İKİNCİ bir ürün satırı yaratıyordu (bkz. src/routes/legacyContent.js
  // #runContentAction key dalındaki AYNI yorum ve src/lib/canonicalSync.js#syncProduct).
  assert.equal(draft.claimed_slug, 'sandalye-marka');
  const res = await runContentAction(envRef.env, admin, { type: 'products', action: 'publish', id: draft.id });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM products`).get().c, 1, 'ürün çoğalmamalı');
  const row = db.prepare(`SELECT legacy_key, hidden_at FROM products`).get();
  assert.equal(row.hidden_at, null);
  assert.equal(row.legacy_key, 'Marka|||Sandalye', 'orijinal legacy_key korunmalı');
});

await test('firma: cats DİZİ olarak saklanmışsa bile arşivleme patlamaz', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  // Canlıda bazı eski içe aktarımlarda offices.cats bir JSON DİZİDİR; bindContentFields o durumda
  // D1'e dizi bind etmeye çalışıp arşivlemeyi düşürüyordu (bkz. o fonksiyondaki AYNI yorum).
  db.exec(`INSERT INTO offices (slug, name, loc, cats, source) VALUES ('dizi-firma', 'Dizi Firma', 'İzmir', '["Mimarlık","Peyzaj"]', 'legacy_static')`);
  const res = await runContentAction(envRef.env, { id: 'u-admin', role: 'admin' }, { type: 'offices', action: 'archive', key: 'Dizi Firma' });
  assert.equal(res.status, 200, await res.clone().text());
  assert.ok(db.prepare(`SELECT hidden_at FROM offices WHERE name = 'Dizi Firma'`).get().hidden_at);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.error('\nBaşarısız testler:');
  for (const f of failures) console.error(`  - ${f.name}: ${f.message}`);
  process.exit(1);
}
