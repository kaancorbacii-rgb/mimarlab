#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-11 — firma/marka mesajları GRUP gibi çalışsın: "Bir firmaya ya da markaya
// mesaj gönderdiğimiz zaman aynı mesaj bildirimi firmaya kayıtlı tüm kullanıcılara gitsin. Aynı mesajı
// kendi ismiyle firmaya kayıtlı tüm kullanıcılar cevaplayabilsin. Yani WhatsApp grubu gibi."
//
// scripts/test-messages-avatars.mjs ile AYNI desen: gerçek handleMessagesRoute, node:sqlite + schema.sql.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { handleMessagesRoute } from '../src/routes/messages.js';
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

const OFFICE = 'Grup Ofis';
const USERS = [
  ['u-disari', 'Dışarıdan Kişi'],   // firmaya yazan
  ['u-kurucu', 'Kurucu Kişi'],      // Kurucu
  ['u-ekip', 'Ekip Kişi'],          // Ekip Üyesi, ROZETSİZ (eski kuralda mesaj ALMAZDI)
  ['u-yonetici', 'Yönetici Hesap'], // Yönetici (kurumsal hesap)
  ['u-yeni', 'Yeni Üye'],           // konuşma açıldıktan SONRA firmaya katılacak
  ['u-yabanci', 'Yabancı'],         // firmayla ilgisi yok
];

async function freshEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const now = Date.now();
  for (const [id, name] of USERS) {
    db.prepare(`INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, 'x', ?)`).run(id, `${id}@example.com`, name, now);
    db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`).run(await sha256Hex(`tok-${id}`), id, now, now + 3600_000);
  }
  db.prepare(`INSERT INTO offices (slug, name, source) VALUES ('grup-ofis', ?, 'legacy_static')`).run(OFFICE);
  for (const [uid, pos] of [['u-kurucu', 'Kurucu'], ['u-ekip', 'Ekip Üyesi'], ['u-yonetici', 'Yönetici']]) approve(db, uid, pos);
  return { db, env: { DB: d1(db) } };
}
function approve(db, uid, position) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at, office_position) VALUES (?, ?, 'office', ?, 'approved', ?, ?, ?)`
  ).run(`c-${uid}`, uid, OFFICE, now, now, position);
}

async function call(env, uid, method, path, body) {
  const url = new URL(`https://mimarlab.com${path}`);
  const req = new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', cookie: `__Host-mimarlab_session=tok-${uid}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return handleMessagesRoute(req, env, url);
}
const notesFor = (db, uid) => db.prepare(`SELECT body, link FROM notifications WHERE user_id = ? AND type = 'message' ORDER BY rowid`).all(uid);

async function openThread(env) {
  const res = await call(env, 'u-disari', 'POST', '/api/messages/threads', {
    profileType: 'office', profileKey: OFFICE, description: 'Merhaba, proje için görüşebilir miyiz?', name: 'Dışarıdan Kişi', email: 'disari@example.com',
  });
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()).id;
}

console.log('\nfirma mesajları = grup');

await test('mesaj firmaya kayıtlı TÜM üyelere gider (görev/rozet fark etmeksizin), gönderene gitmez', async () => {
  const { db, env } = await freshEnv();
  const id = await openThread(env);
  const recips = db.prepare(`SELECT user_id FROM message_thread_recipients WHERE thread_id = ? ORDER BY user_id`).all(id).map(r => r.user_id);
  assert.deepEqual(recips, ['u-ekip', 'u-kurucu', 'u-yonetici']);
  for (const uid of ['u-kurucu', 'u-ekip', 'u-yonetici']) assert.equal(notesFor(db, uid).length, 1, `${uid} bildirim almalı`);
  assert.equal(notesFor(db, 'u-disari').length, 0);
});

await test('bir üyenin cevabı diğer HERKESE kendi adıyla bildirim olarak gider', async () => {
  const { db, env } = await freshEnv();
  const id = await openThread(env);
  const res = await call(env, 'u-ekip', 'POST', `/api/messages/threads/${id}/reply`, { body: 'Tabii, yarın uygun musunuz?' });
  assert.equal(res.status, 201, await res.clone().text());
  for (const uid of ['u-disari', 'u-kurucu', 'u-yonetici']) {
    const last = notesFor(db, uid).at(-1);
    assert.ok(last && last.body.startsWith('Ekip Kişi:'), `${uid} "Ekip Kişi:" bildirimi almalı — ${JSON.stringify(last)}`);
  }
  assert.equal(notesFor(db, 'u-ekip').length, 1, 'cevaplayan kendine bildirim almaz (yalnızca ilk mesajınki var)');
});

await test('konuşmada her mesaj YAZANIN adıyla görünür', async () => {
  const { env } = await freshEnv();
  const id = await openThread(env);
  await call(env, 'u-ekip', 'POST', `/api/messages/threads/${id}/reply`, { body: 'Ekipten cevap' });
  await call(env, 'u-kurucu', 'POST', `/api/messages/threads/${id}/reply`, { body: 'Kurucudan ek' });
  const res = await call(env, 'u-disari', 'GET', `/api/messages/threads/${id}`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.messages.map(m => m.senderName), ['Dışarıdan Kişi', 'Ekip Kişi', 'Kurucu Kişi']);
});

await test('firmaya SONRADAN katılan üye eski konuşmayı kutusunda görür ve cevaplayabilir', async () => {
  const { db, env } = await freshEnv();
  const id = await openThread(env);
  approve(db, 'u-yeni', 'Ekip Üyesi');
  const list = await call(env, 'u-yeni', 'GET', '/api/messages/mine');
  const items = (await list.json()).items;
  assert.ok(items.some(t => t.id === id), 'konuşma yeni üyenin kutusunda görünmeli');
  const res = await call(env, 'u-yeni', 'POST', `/api/messages/threads/${id}/reply`, { body: 'Ben de buradayım' });
  assert.equal(res.status, 201, await res.clone().text());
  assert.ok(notesFor(db, 'u-disari').at(-1).body.startsWith('Yeni Üye:'));
});

await test('firmayla ilgisi olmayan kullanıcı konuşmaya ERİŞEMEZ (403)', async () => {
  const { env } = await freshEnv();
  const id = await openThread(env);
  const res = await call(env, 'u-yabanci', 'GET', `/api/messages/threads/${id}`);
  assert.equal(res.status, 403);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
