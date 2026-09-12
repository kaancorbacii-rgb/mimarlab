#!/usr/bin/env node
// BİLDİRİM NOKTALARI + TIKLANABİLİR GÖNDEREN PROFİLİ — BİRİM TESTLERİ (kullanıcı isteği, 2026-09-12)
//
//   1) "Kullanıcı hesabına bir bildirim veya mesaj geldiğinde Hesabım başlığının sağ yanında turuncu
//      bir nokta çıksın"            -> /api/auth/me artık unreadCount döner (auth-nav.js#applyAlertDot)
//   2) "Admin panelindeki üyeler butonunda siteye yeni bir üye kaydı olunca turuncu nokta çıksın"
//                                    -> /api/admin/summary#newUsers + POST /api/admin/users/seen
//   3) "Mesaj gönderen kullanıcının kişi, firma ya da marka profili yüklüyse ... isme tıklanabilsin"
//                                    -> GET /api/messages/threads/:id artık senderProfile döner
//
// scripts/test-message-seen-receipt.mjs İLE AYNI desen: gerçek schema.sql'e karşı node:sqlite D1
// shim'i, rotalar GERÇEKTEN çağrılır (handleAuthRoute / handleAdminRoute / handleMessagesRoute).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { handleMessagesRoute } from '../src/routes/messages.js';
import { handleAuthRoute } from '../src/routes/auth.js';
import { handleAdminRoute } from '../src/routes/admin.js';
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

const TOKEN_SENDER = 'session-sender';
const TOKEN_RECIPIENT = 'session-recipient';
const TOKEN_ADMIN = 'session-admin';

// u-sender: konuşmayı BAŞLATAN kullanıcı (popup başlığında adı görünen kişi — bkz. ekran görüntüsü)
// u-recipient: mimar profilinin onaylı sahibi, mesajı ALAN taraf
// u-admin: admin paneli testleri için
async function freshEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const env = { DB: d1(db) };
  db.exec(`INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES
    ('u-sender', 's@example.com', 'WARCHDb', 'x', 'user', 1000),
    ('u-recipient', 'r@example.com', 'Alıcı', 'x', 'user', 1000),
    ('u-admin', 'admin@example.com', 'Admin', 'x', 'admin', 1000)`);
  for (const [token, uid] of [[TOKEN_SENDER, 'u-sender'], [TOKEN_RECIPIENT, 'u-recipient'], [TOKEN_ADMIN, 'u-admin']]) {
    db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
      .run(await sha256Hex(token), uid, Date.now(), Date.now() + 3600_000);
  }
  db.exec(`INSERT INTO architects (slug, name, source) VALUES ('bir-mimar', 'Bir Mimar', 'admin')`);
  db.exec(`INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at)
           VALUES ('c1', 'u-recipient', 'architect', 'Bir Mimar', 'approved', 1000, 1000)`);
  db.exec(`INSERT INTO message_threads (id, profile_type, profile_key, sender_user_id, sender_name, sender_email, status, created_at, updated_at)
           VALUES ('t1', 'architect', 'Bir Mimar', 'u-sender', 'WARCHDb', 'warchdb@gmail.com', 'open', 1000, 1000)`);
  db.exec(`INSERT INTO message_thread_recipients (thread_id, user_id) VALUES ('t1', 'u-recipient')`);
  db.exec(`INSERT INTO messages (id, thread_id, sender_user_id, body, created_at) VALUES ('m1', 't1', 'u-sender', 'hello merhaba', 1000)`);
  return { db, env };
}

function req(path, token, init = {}) {
  const url = new URL(`https://mimarlab.com${path}`);
  return [new Request(url, { ...init, headers: { cookie: `__Host-mimarlab_session=${token}`, ...(init.headers || {}) } }), url];
}
async function getThread(env, token, id = 't1') {
  const [r, url] = req(`/api/messages/threads/${id}`, token);
  const res = await handleMessagesRoute(r, env, url);
  assert.equal(res.status, 200, `beklenen 200, gelen ${res.status}`);
  return res.json();
}
async function getMe(env, token) {
  const [r, url] = req('/api/auth/me', token);
  const res = await handleAuthRoute(r, env, url);
  assert.equal(res.status, 200, `beklenen 200, gelen ${res.status}`);
  return res.json();
}
async function adminCall(env, path, method = 'GET') {
  const [r, url] = req(path, TOKEN_ADMIN, { method });
  const res = await handleAdminRoute(r, env, url);
  assert.equal(res.status, 200, `${path}: beklenen 200, gelen ${res.status}`);
  return res.json();
}
function addNotification(db, userId, id, isRead = 0) {
  db.prepare(`INSERT INTO notifications (id, user_id, type, title, body, is_read, created_at) VALUES (?, ?, 'message', '1 Yeni Mesaj', 'gövde', ?, ?)`)
    .run(id, userId, isRead, Date.now());
}

console.log('\n1) Hesabım turuncu noktası — /api/auth/me#unreadCount');

await test('okunmamış bildirim yoksa unreadCount 0', async () => {
  const { env } = await freshEnv();
  assert.equal((await getMe(env, TOKEN_RECIPIENT)).unreadCount, 0);
});

await test('okunmamış bildirim/mesaj sayısı döner (mesajlar da aynı tabloda)', async () => {
  const { db, env } = await freshEnv();
  addNotification(db, 'u-recipient', 'n1');
  addNotification(db, 'u-recipient', 'n2');
  assert.equal((await getMe(env, TOKEN_RECIPIENT)).unreadCount, 2);
});

await test('okunmuş satırlar sayılmaz ve sayı KULLANICIYA özeldir', async () => {
  const { db, env } = await freshEnv();
  addNotification(db, 'u-recipient', 'n1', 1);
  addNotification(db, 'u-recipient', 'n2', 0);
  addNotification(db, 'u-sender', 'n3', 0);
  assert.equal((await getMe(env, TOKEN_RECIPIENT)).unreadCount, 1);
  assert.equal((await getMe(env, TOKEN_SENDER)).unreadCount, 1);
});

await test('konuşma açılınca o thread\'in mesaj bildirimi okunur -> nokta söner', async () => {
  const { db, env } = await freshEnv();
  db.prepare(`INSERT INTO notifications (id, user_id, type, title, body, link, is_read, created_at)
              VALUES ('n1', 'u-recipient', 'message', '1 Yeni Mesaj', 'gövde', 'msg:t1', 0, ?)`).run(Date.now());
  assert.equal((await getMe(env, TOKEN_RECIPIENT)).unreadCount, 1);
  await getThread(env, TOKEN_RECIPIENT);
  assert.equal((await getMe(env, TOKEN_RECIPIENT)).unreadCount, 0);
});

console.log('\n2) Admin > Üyeler turuncu noktası — /api/admin/summary#newUsers');

await test('ilk özet çağrısı imleci tohumlar ve 0 döner (mevcut üyeler "yeni" sayılmaz)', async () => {
  const { db, env } = await freshEnv();
  assert.equal((await adminCall(env, '/api/admin/summary')).newUsers, 0);
  const row = db.prepare(`SELECT value FROM site_settings WHERE key = 'admin_users_seen_at'`).get();
  assert.ok(row && Number(row.value) > 0, 'imleç tohumlanmalıydı');
});

// İmleci GEÇMİŞE çekip yeni üyeyi "şimdi" eklemek, gerçek akışı (önce bakış, sonra kayıt) saat
// yarışına girmeden temsil eder — imleci "şimdi" bırakıp üyeyi GELECEĞE eklemek, sonraki
// POST /users/seen'i (o da "şimdi") anlamsızca geçersiz kılardı.
function seedSeenAt(db, at) {
  db.prepare(`INSERT INTO site_settings (key, value, updated_at) VALUES ('admin_users_seen_at', ?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(at), at);
}

await test('imleçten SONRA kaydolan üye sayılır -> nokta yanar', async () => {
  const { db, env } = await freshEnv();
  seedSeenAt(db, Date.now() - 60_000);
  db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES ('u-new', 'n@example.com', 'Yeni Üye', 'x', 'user', ?)`)
    .run(Date.now());
  assert.equal((await adminCall(env, '/api/admin/summary')).newUsers, 1);
});

await test('Üyeler sekmesi açılınca (POST /users/seen) sayı sıfırlanır', async () => {
  const { db, env } = await freshEnv();
  seedSeenAt(db, Date.now() - 60_000);
  db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES ('u-new', 'n@example.com', 'Yeni Üye', 'x', 'user', ?)`)
    .run(Date.now());
  assert.equal((await adminCall(env, '/api/admin/summary')).newUsers, 1);
  await adminCall(env, '/api/admin/users/seen', 'POST');
  assert.equal((await adminCall(env, '/api/admin/summary')).newUsers, 0);
});

await test('"seen" yolu kullanıcı detay yolunu gölgelemez (GET /users/:id hâlâ çalışır)', async () => {
  const { env } = await freshEnv();
  const data = await adminCall(env, '/api/admin/users/u-sender');
  assert.equal(data.user.id, 'u-sender');
});

console.log('\n3) Mesaj gönderenin profili — /api/messages/threads/:id#senderProfile');

await test('gönderenin profili YOKSA senderProfile null (WARCHDb örneği)', async () => {
  const { env } = await freshEnv();
  assert.equal((await getThread(env, TOKEN_RECIPIENT)).senderProfile, null);
});

await test('gönderenin ONAYLI kişi claim\'i varsa /kisi/:slug döner', async () => {
  const { db, env } = await freshEnv();
  db.exec(`INSERT INTO architects (slug, name, source) VALUES ('warchdb-mimar', 'WARCHDb Mimar', 'admin')`);
  db.exec(`INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at)
           VALUES ('c2', 'u-sender', 'architect', 'WARCHDb Mimar', 'approved', 1000, 1000)`);
  const data = await getThread(env, TOKEN_RECIPIENT);
  assert.deepEqual(data.senderProfile, { type: 'architect', name: 'WARCHDb Mimar', href: '/kisi/warchdb-mimar' });
});

await test('claim satırı OLMADAN da sahiplik tanınır (claimed_by_user_id yolu)', async () => {
  const { db, env } = await freshEnv();
  db.prepare(`INSERT INTO architects (slug, name, source, claimed_by_user_id) VALUES ('sahip-mimar', 'Sahip Mimar', 'submission', 'u-sender')`).run();
  const data = await getThread(env, TOKEN_RECIPIENT);
  assert.equal(data.senderProfile.href, '/kisi/sahip-mimar');
});

await test('bekleyen (pending) claim profil AÇMAZ', async () => {
  const { db, env } = await freshEnv();
  db.exec(`INSERT INTO architects (slug, name, source) VALUES ('bekleyen', 'Bekleyen Mimar', 'admin')`);
  db.exec(`INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at)
           VALUES ('c3', 'u-sender', 'architect', 'Bekleyen Mimar', 'pending', 1000, 1000)`);
  assert.equal((await getThread(env, TOKEN_RECIPIENT)).senderProfile, null);
});

await test('silinmiş profil link üretmez', async () => {
  const { db, env } = await freshEnv();
  db.exec(`INSERT INTO architects (slug, name, source, claimed_by_user_id, deleted_at) VALUES ('silinmis', 'Silinmiş', 'admin', 'u-sender', '2026-09-01')`);
  assert.equal((await getThread(env, TOKEN_RECIPIENT)).senderProfile, null);
});

await test('tam arşivli profil (hidden_at DOLU, preview_at NULL) link üretmez, önizlemedeki ÜRETİR', async () => {
  const { db, env } = await freshEnv();
  db.exec(`INSERT INTO architects (slug, name, source, claimed_by_user_id, hidden_at) VALUES ('gizli', 'Gizli', 'admin', 'u-sender', '2026-09-01')`);
  assert.equal((await getThread(env, TOKEN_RECIPIENT)).senderProfile, null);
  db.exec(`UPDATE architects SET preview_at = '2026-09-02' WHERE slug = 'gizli'`);
  assert.equal((await getThread(env, TOKEN_RECIPIENT)).senderProfile.href, '/kisi/gizli');
});

await test('firma profili /firma/:slug, SAF MARKA /marka/:slug döner', async () => {
  const { db, env } = await freshEnv();
  db.prepare(`INSERT INTO offices (slug, name, cats, source, claimed_by_user_id) VALUES ('bir-firma', 'Bir Firma', ?, 'admin', 'u-sender')`)
    .run(JSON.stringify(['Mimarlık']));
  assert.equal((await getThread(env, TOKEN_RECIPIENT)).senderProfile.href, '/firma/bir-firma');
  // Saf marka: yalnızca ürün kategorileri -> kanonik önek /marka/ (bkz. src/lib/officeUrl.js)
  db.prepare(`UPDATE offices SET cats = ? WHERE slug = 'bir-firma'`).run(JSON.stringify(['Mobilya']));
  assert.equal((await getThread(env, TOKEN_RECIPIENT)).senderProfile.href, '/marka/bir-firma');
});

await test('kişi profili firma profiline göre ÖNCELİKLİ', async () => {
  const { db, env } = await freshEnv();
  db.prepare(`INSERT INTO offices (slug, name, cats, source, claimed_by_user_id) VALUES ('hem-firma', 'Hem Firma', ?, 'admin', 'u-sender')`)
    .run(JSON.stringify(['Mimarlık']));
  db.prepare(`INSERT INTO architects (slug, name, source, claimed_by_user_id) VALUES ('hem-kisi', 'Hem Kişi', 'admin', 'u-sender')`).run();
  assert.equal((await getThread(env, TOKEN_RECIPIENT)).senderProfile.type, 'architect');
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) { for (const f of failures) console.error(` - ${f.name}: ${f.message}`); process.exit(1); }
