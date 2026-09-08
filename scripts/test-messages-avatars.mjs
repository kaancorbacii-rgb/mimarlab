#!/usr/bin/env node
// Hesabım > Mesajlar — konuşma satırındaki profil fotoğrafı (kullanıcı bulgusu, 2026-09-08 madde 2).
//
// scripts/test-2026-09-08-round.mjs / test-meet-gateway.mjs ile AYNI desen: test koşucusu yok,
// node:assert + node:sqlite üzerinde GERÇEK bir SQLite'a bağlanan bir D1 shim'i. Rota GERÇEKTEN
// çağrılır (handleMessagesRoute → listMyThreads), böylece hem SQL'in gerçek şemaya karşı geçerliliği
// hem de yanıtın şekli test edilir.
//
// REGRESYON: listMyThreads eskiden `otherPhotoUrl: isSender ? null : ...` yazıyordu — yani
// kullanıcının KENDİ başlattığı konuşmalarda (diğer taraf bir mimar/firma PROFİLİ) fotoğraf hiç
// aranmıyordu ve Mesajlar kutusu her zaman baş harfleri gösteriyordu.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { handleMessagesRoute } from '../src/routes/messages.js';
import { sha256Hex } from '../src/lib/crypto.js';

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
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; } };
}

const TOKEN = 'test-session-token';

async function freshEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const env = { DB: d1(db) };
  db.exec(`INSERT INTO users (id, email, name, password_hash, created_at) VALUES
    ('u-me', 'me@example.com', 'Ben', 'x', datetime('now')),
    ('u-other', 'other@example.com', 'Gönderen Kişi', 'x', datetime('now'))`);
  db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .run(await sha256Hex(TOKEN), 'u-me', Date.now(), Date.now() + 3600_000);
  db.exec(`UPDATE users SET photo_url = '/media/avatars/other.webp' WHERE id = 'u-other'`);
  db.exec(`INSERT INTO architects (slug, name, photo_url) VALUES ('kaan-corbaci', 'Kaan Çorbacı', '/media/architects/kaan.webp')`);
  db.exec(`INSERT INTO offices (slug, name, logo_url) VALUES ('mimarlab', 'MİMARLAB', '/media/offices/mimarlab.webp')`);
  return { db, env };
}

function insertThread(db, { id, profileType, profileKey, senderUserId, recipientUserId, updatedAt }) {
  db.prepare(`INSERT INTO message_threads (id, profile_type, profile_key, sender_user_id, sender_name, sender_email, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`)
    .run(id, profileType, profileKey, senderUserId, 'Gönderen Kişi', 'x@example.com', updatedAt, updatedAt);
  db.prepare(`INSERT INTO message_thread_recipients (thread_id, user_id) VALUES (?, ?)`).run(id, recipientUserId);
  db.prepare(`INSERT INTO messages (id, thread_id, sender_user_id, body, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run('m-' + id, id, senderUserId, 'merhaba', updatedAt);
}

async function listMine(env) {
  const url = new URL('https://mimarlab.com/api/messages/mine');
  const req = new Request(url, { headers: { cookie: `__Host-mimarlab_session=${TOKEN}` } });
  const res = await handleMessagesRoute(req, env, url);
  assert.equal(res.status, 200, `beklenen 200, gelen ${res.status}`);
  return (await res.json()).items;
}

console.log('\nHesabım > Mesajlar — konuşma avatarları');

await test('gönderen yönü: mimar profiline yazılan konuşma architects.photo_url taşır', async () => {
  const { db, env } = await freshEnv();
  insertThread(db, { id: 't1', profileType: 'architect', profileKey: 'Kaan Çorbacı', senderUserId: 'u-me', recipientUserId: 'u-other', updatedAt: 1000 });
  const items = await listMine(env);
  assert.equal(items.length, 1);
  assert.equal(items[0].isSender, true);
  assert.equal(items[0].otherName, 'Kaan Çorbacı');
  assert.equal(items[0].otherPhotoUrl, '/media/architects/kaan.webp');
});

await test('gönderen yönü: firma profiline yazılan konuşma offices.logo_url taşır', async () => {
  const { db, env } = await freshEnv();
  insertThread(db, { id: 't2', profileType: 'office', profileKey: 'MİMARLAB', senderUserId: 'u-me', recipientUserId: 'u-other', updatedAt: 1000 });
  const items = await listMine(env);
  assert.equal(items[0].otherPhotoUrl, '/media/offices/mimarlab.webp');
});

await test('alıcı yönü DEĞİŞMEDİ: fotoğraf hâlâ gönderen users satırından gelir', async () => {
  const { db, env } = await freshEnv();
  insertThread(db, { id: 't3', profileType: 'architect', profileKey: 'Kaan Çorbacı', senderUserId: 'u-other', recipientUserId: 'u-me', updatedAt: 1000 });
  const items = await listMine(env);
  assert.equal(items[0].isSender, false);
  assert.equal(items[0].otherPhotoUrl, '/media/avatars/other.webp');
});

await test('fotoğrafı olmayan / silinmiş profil null döner (baş harflere düşer)', async () => {
  const { db, env } = await freshEnv();
  db.exec(`INSERT INTO architects (slug, name, photo_url) VALUES ('fotosuz', 'Fotoğrafsız Kişi', NULL)`);
  db.exec(`INSERT INTO offices (slug, name, logo_url, deleted_at) VALUES ('silinmis', 'Silinmiş Firma', '/media/offices/x.webp', datetime('now'))`);
  insertThread(db, { id: 't4', profileType: 'architect', profileKey: 'Fotoğrafsız Kişi', senderUserId: 'u-me', recipientUserId: 'u-other', updatedAt: 1000 });
  insertThread(db, { id: 't5', profileType: 'office', profileKey: 'Silinmiş Firma', senderUserId: 'u-me', recipientUserId: 'u-other', updatedAt: 2000 });
  insertThread(db, { id: 't6', profileType: 'architect', profileKey: 'Hiç Olmayan', senderUserId: 'u-me', recipientUserId: 'u-other', updatedAt: 3000 });
  const items = await listMine(env);
  assert.equal(items.length, 3);
  for (const it of items) assert.equal(it.otherPhotoUrl, null, `${it.otherName} için null bekleniyordu`);
});

await test('karışık konuşmalar tek listede doğru eşleşir (yanlış profile atanmaz)', async () => {
  const { db, env } = await freshEnv();
  insertThread(db, { id: 'a', profileType: 'architect', profileKey: 'Kaan Çorbacı', senderUserId: 'u-me', recipientUserId: 'u-other', updatedAt: 1000 });
  insertThread(db, { id: 'b', profileType: 'office', profileKey: 'MİMARLAB', senderUserId: 'u-me', recipientUserId: 'u-other', updatedAt: 2000 });
  const byName = Object.fromEntries((await listMine(env)).map(i => [i.otherName, i.otherPhotoUrl]));
  assert.deepEqual(byName, { 'Kaan Çorbacı': '/media/architects/kaan.webp', 'MİMARLAB': '/media/offices/mimarlab.webp' });
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) { for (const f of failures) console.error(` - ${f.name}: ${f.message}`); process.exit(1); }
