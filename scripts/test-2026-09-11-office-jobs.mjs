#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-11 — firma/marka popup'ında "İş / Staj İlanları": ilanı yalnızca firmanın
// yetkilendirdiği kullanıcılar (künyeyi Düzenle ile açabilenler) yayınlar/kaldırır, herkes görür.
//
// scripts/test-2026-09-11-office-group-messages.mjs ile AYNI desen: gerçek handleOfficeJobsRoute,
// node:sqlite + GERÇEK schema.sql.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { handleOfficeJobsRoute } from '../src/routes/officeJobs.js';
import { sha256Hex } from '../src/lib/crypto.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}

function d1(db) {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = db.prepare(sql).get(...params); if (r === undefined) return null; return col ? r[col] : { ...r }; },
    async all() { return { results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }; },
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; } };
}

const OFFICE = 'İlan Ofis';
const USERS = [
  ['u-admin', 'Admin', 'admin'],
  ['u-kurucu', 'Kurucu Kişi', 'user'],   // onaylı claim, Kurucu
  ['u-ekip', 'Ekip Kişi', 'user'],       // onaylı claim, Ekip Üyesi — künyeyi düzenleyemez
  ['u-yabanci', 'Yabancı', 'user'],      // firmayla ilgisi yok
];

async function freshEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  // 0079: name_fold generated kolonu — claimedProfiles.js#fetchOwnArchitectRows (Kurucular üzerinden
  // yetki yolu) buna bağlı; schema.sql canlı D1'in gerisinde (bkz. test-2026-09-08-round.mjs AYNI satır).
  db.exec(readFileSync(new URL('../migrations/0079_search_fold_columns.sql', import.meta.url), 'utf8'));
  const now = Date.now();
  for (const [id, name, role] of USERS) {
    db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, 'x', ?, ?)`).run(id, `${id}@example.com`, name, role, now);
    db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`).run(await sha256Hex(`tok-${id}`), id, now, now + 3600_000);
  }
  db.prepare(`INSERT INTO offices (slug, name, source) VALUES ('ilan-ofis', ?, 'legacy_static')`).run(OFFICE);
  for (const [uid, pos] of [['u-kurucu', 'Kurucu'], ['u-ekip', 'Ekip Üyesi']]) {
    db.prepare(
      `INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at, office_position) VALUES (?, ?, 'office', ?, 'approved', ?, ?, ?)`
    ).run(`c-${uid}`, uid, OFFICE, now, now, pos);
  }
  return { db, env: { DB: d1(db) } };
}

async function call(env, uid, method, path, body) {
  const url = new URL(`https://mimarlab.com${path}`);
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.cookie = `__Host-mimarlab_session=tok-${uid}`;
  const req = new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return handleOfficeJobsRoute(req, env, url);
}
const img = (uid) => `/media/u/${uid}/0f8e7c1a-1111-4222-8333-944455556666.webp`;

console.log('\nfirma/marka iş / staj ilanları');

await test('herkes listeyi görür; canManage yalnızca yetkiliye true, yanıt no-store', async () => {
  const { env } = await freshEnv();
  for (const [uid, expected] of [[null, false], ['u-yabanci', false], ['u-ekip', false], ['u-kurucu', true], ['u-admin', true]]) {
    const res = await call(env, uid, 'GET', '/api/office-jobs?office=ilan-ofis');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    const data = await res.json();
    assert.deepEqual(data.items, []);
    assert.equal(data.canManage, expected, `${uid} canManage`);
  }
});

await test('Kurucu ilan yayınlar (slug ya da ad ile), ilan listede en yeni önce döner', async () => {
  const { env } = await freshEnv();
  let res = await call(env, 'u-kurucu', 'POST', '/api/office-jobs', { office: 'ilan-ofis', title: '  Stajyer   Mimar ', image: img('u-kurucu') });
  assert.equal(res.status, 201, await res.clone().text());
  assert.equal((await res.json()).item.title, 'Stajyer Mimar');
  await new Promise(r => setTimeout(r, 5));
  res = await call(env, 'u-admin', 'POST', '/api/office-jobs', { office: OFFICE, title: 'Proje Mimarı', image: img('u-admin') });
  assert.equal(res.status, 201, await res.clone().text());
  const list = await (await call(env, null, 'GET', `/api/office-jobs?office=${encodeURIComponent(OFFICE)}`)).json();
  assert.deepEqual(list.items.map(j => j.title), ['Proje Mimarı', 'Stajyer Mimar']);
});

await test('Ekip Üyesi / yabancı / anonim YAYINLAYAMAZ', async () => {
  const { env } = await freshEnv();
  assert.equal((await call(env, 'u-ekip', 'POST', '/api/office-jobs', { office: 'ilan-ofis', title: 'X', image: img('u-ekip') })).status, 403);
  assert.equal((await call(env, 'u-yabanci', 'POST', '/api/office-jobs', { office: 'ilan-ofis', title: 'X', image: img('u-yabanci') })).status, 403);
  assert.equal((await call(env, null, 'POST', '/api/office-jobs', { office: 'ilan-ofis', title: 'X', image: img('u-x') })).status, 401);
});

await test('görsel yalnızca kullanıcının KENDİ /media/u/<id>/ yüklemesi olabilir; başlık zorunlu', async () => {
  const { env } = await freshEnv();
  for (const image of ['https://evil.example/x.png', img('u-baskasi'), '/media/u/u-kurucu/../../x', '']) {
    const res = await call(env, 'u-kurucu', 'POST', '/api/office-jobs', { office: 'ilan-ofis', title: 'Başlık', image });
    assert.equal(res.status, 400, `image=${image}`);
  }
  assert.equal((await call(env, 'u-kurucu', 'POST', '/api/office-jobs', { office: 'ilan-ofis', title: '   ', image: img('u-kurucu') })).status, 400);
  assert.equal((await call(env, 'u-kurucu', 'POST', '/api/office-jobs', { office: 'yok-boyle-ofis', title: 'A', image: img('u-kurucu') })).status, 404);
});

await test('kaldırma: yetkisiz 403, yetkili siler', async () => {
  const { env } = await freshEnv();
  const { item } = await (await call(env, 'u-kurucu', 'POST', '/api/office-jobs', { office: 'ilan-ofis', title: 'Silinecek', image: img('u-kurucu') })).json();
  assert.equal((await call(env, 'u-ekip', 'DELETE', `/api/office-jobs/${item.id}`)).status, 403);
  assert.equal((await call(env, 'u-admin', 'DELETE', `/api/office-jobs/${item.id}`)).status, 200);
  const list = await (await call(env, null, 'GET', '/api/office-jobs?office=ilan-ofis')).json();
  assert.deepEqual(list.items, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
