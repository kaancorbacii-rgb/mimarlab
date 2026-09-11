#!/usr/bin/env node
// "GÖRÜLDÜ" OKUNMA BİLDİRİMİ — BİRİM TESTLERİ (kullanıcı isteği, 2026-09-11: "Mesaj kutusunda
// gönderilen mesaj üzerine tıklanıp görüldüğü zaman karşı taraflarda görüldü yazsın.")
//
// scripts/test-messages-avatars.mjs İLE AYNI desen: gerçek şemaya karşı node:sqlite D1 shim'i,
// rota GERÇEKTEN çağrılır (handleMessagesRoute → getThread).
//
// KURAL: bir thread AÇILDIĞINDA (GET .../threads/:id) message_reads'e o kullanıcı için
// last_read_at=now yazılır (bkz. migrations/0112_message_reads.sql). Kendi gönderdiğim bir mesaj
// "seen" sayılır ANCAK karşı taraf(lar)dan EN AZ BİRİNİN last_read_at'i o mesajın created_at'inden
// SONRA veya AYNI ANDAYSA — firma grup konuşmalarında (birden fazla alıcı) da doğrudan çalışır.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { handleMessagesRoute } from '../src/routes/messages.js';
import { sha256Hex } from '../src/lib/crypto.js';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
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

const TOKEN_A = 'session-a';
const TOKEN_B = 'session-b';

async function freshEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const env = { DB: d1(db) };
  db.exec(`INSERT INTO users (id, email, name, password_hash, created_at) VALUES
    ('u-a', 'a@example.com', 'Gönderen A', 'x', datetime('now')),
    ('u-b', 'b@example.com', 'Alıcı B', 'x', datetime('now'))`);
  for (const [token, uid] of [[TOKEN_A, 'u-a'], [TOKEN_B, 'u-b']]) {
    db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
      .run(await sha256Hex(token), uid, Date.now(), Date.now() + 3600_000);
  }
  db.exec(`INSERT INTO message_threads (id, profile_type, profile_key, sender_user_id, sender_name, sender_email, status, created_at, updated_at)
           VALUES ('t1', 'architect', 'Bir Mimar', 'u-a', 'Gönderen A', 'a@example.com', 'open', 1000, 1000)`);
  db.exec(`INSERT INTO message_thread_recipients (thread_id, user_id) VALUES ('t1', 'u-b')`);
  db.exec(`INSERT INTO messages (id, thread_id, sender_user_id, body, created_at) VALUES ('m1', 't1', 'u-a', 'merhaba', 1000)`);
  return { db, env };
}

async function getThread(env, token, id = 't1') {
  const url = new URL(`https://mimarlab.com/api/messages/threads/${id}`);
  const req = new Request(url, { headers: { cookie: `__Host-mimarlab_session=${token}` } });
  const res = await handleMessagesRoute(req, env, url);
  assert.equal(res.status, 200, `beklenen 200, gelen ${res.status}`);
  return res.json();
}

console.log('\n"Görüldü" okunma bildirimi');

await test('B hiç açmadıysa A kendi mesajını "seen:false" görür', async () => {
  const { env } = await freshEnv();
  const dataA = await getThread(env, TOKEN_A);
  assert.equal(dataA.messages.length, 1);
  assert.equal(dataA.messages[0].isMe, true);
  assert.equal(dataA.messages[0].seen, false);
});

await test('B thread\'i AÇINCA A\'nın mesajı "seen:true" olur', async () => {
  const { env } = await freshEnv();
  await getThread(env, TOKEN_B); // B konuşmayı açar -> message_reads'e yazılır
  const dataA = await getThread(env, TOKEN_A);
  assert.equal(dataA.messages[0].seen, true);
});

await test('B\'nin KENDİ mesajları (isMe=false yönünde) hiçbir zaman seen taşımaz', async () => {
  const { env } = await freshEnv();
  await getThread(env, TOKEN_B);
  const dataB = await getThread(env, TOKEN_B);
  assert.equal(dataB.messages[0].isMe, false);
  assert.equal(dataB.messages[0].seen, false);
});

await test('B açtıktan SONRA A yeni bir mesaj yazarsa o mesaj henüz "seen:false"', async () => {
  const { db, env } = await freshEnv();
  await getThread(env, TOKEN_B);
  const future = Date.now() + 60 * 60 * 1000;
  db.prepare(`INSERT INTO messages (id, thread_id, sender_user_id, body, created_at) VALUES ('m2', 't1', 'u-a', 'ikinci mesaj', ?)`).run(future);
  const dataA = await getThread(env, TOKEN_A);
  const m2 = dataA.messages.find(m => m.id === 'm2');
  assert.equal(m2.seen, false, 'B bu mesajı henüz açmadı, seen olmamalı');
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) { for (const f of failures) console.error(` - ${f.name}: ${f.message}`); process.exit(1); }
