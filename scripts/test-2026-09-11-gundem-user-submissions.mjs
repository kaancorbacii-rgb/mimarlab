#!/usr/bin/env node
// GÜNDEM KULLANICI GÖNDERİLERİ — UÇTAN UCA TEST (kullanıcı isteği, 2026-09-11).
//
// scripts/test-rights-archive.mjs ile AYNI desen: node:assert + node:sqlite üzerinde GERÇEK SQLite,
// schema.sql + Gündem migration'ları. Doğrulanan akış:
//   gönder (doğrulama kapıları) → admin kuyruğu → onay → public liste + profil şeridi (entity filtresi)
//   → sahibin düzenlemesi yeniden onaya düşürür → yeniden onayda tarih KORUNUR → yabancı erişemez → sil.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { handleGundemSubmitRoute } from '../src/routes/gundemSubmit.js';
import { handleGundemAdminRoute } from '../src/routes/gundemAdmin.js';
import { handleGundemRoute } from '../src/routes/gundem.js';
import { gundemSsrCard } from '../src/lib/gundemSsr.js';
import { sha256Hex } from '../src/lib/crypto.js';

// Cache API yok (Node) — cachedPublicJson/purge'ler için etkisiz bir stub.
globalThis.caches = { default: { match: async () => undefined, put: async () => {}, delete: async () => true } };

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

// Migration'ları ifade ifade uygula: schema.sql bazı kolonları zaten taşıyabilir ("duplicate column").
function applyTolerant(db, file) {
  const sql = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').replace(/--[^\n]*/g, '');
  for (const s of sql.split(';').map(x => x.trim()).filter(Boolean)) {
    try { db.exec(s + ';'); } catch (e) { if (!/duplicate column|already exists/i.test(e.message)) throw new Error(`${file}: ${e.message}\n${s.slice(0, 120)}`); }
  }
}

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
for (const f of ['migrations/0079_search_fold_columns.sql', 'migrations/0099_gundem.sql', 'migrations/0100_gundem_sort_by_source_date.sql',
  'migrations/0102_gundem_dedupe_and_sources.sql', 'migrations/0113_gundem_user_submissions.sql']) applyTolerant(db, f);
try { db.exec(`CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER, expires_at INTEGER)`); } catch {}

const now = Date.now();
db.exec(`INSERT INTO offices (slug, name, loc, cats, source) VALUES ('atolye-x', 'Atölye X', 'İstanbul', '"Mimarlık"', 'legacy_static'),
  ('baska-firma', 'Başka Firma', 'Ankara', '"Mimarlık"', 'legacy_static')`);
db.exec(`INSERT INTO architects (slug, name) VALUES ('ayse-kaya', 'Ayşe Kaya')`);
for (const [id, name, role] of [['u-admin', 'Admin', 'admin'], ['u-uye', 'Ayşe Kaya', 'user'], ['u-diger', 'Diğer Üye', 'user']]) {
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, 'x', ?, ?, ?)`).run(id, `${id}@example.com`, name, role, now);
  db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`).run(await sha256Hex(`tok-${id}`), id, now, now + 3600_000);
}
db.prepare(`INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at) VALUES ('c1', 'u-uye', 'office', 'Atölye X', 'approved', ?, ?)`).run(now, now);

const env = { DB: d1(db) };
const req = (uid, path, init = {}) => new Request(`https://mimarlab.com${path}`, {
  ...init,
  headers: { 'Content-Type': 'application/json', ...(uid ? { Cookie: `__Host-mimarlab_session=tok-${uid}` } : {}), ...(init.headers || {}) },
  body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
});
const submit = (uid, path, init) => handleGundemSubmitRoute(req(uid, path, init), env, new URL(`https://mimarlab.com${path}`));
const admin = (path, init) => handleGundemAdminRoute(req('u-admin', path, init), env, new URL(`https://mimarlab.com${path}`).pathname.split('/').filter(Boolean));
const publicList = async (qs = '') => (await (await handleGundemRoute(req(null, `/api/gundem${qs}`), env, new URL(`https://mimarlab.com/api/gundem${qs}`))).json());

const img = (uid, n) => `/media/u/${uid}/0000000${n}-aaaa-bbbb-cccc-000000000000.webp`;
const valid = (over = {}) => ({
  category: 'etkinlik', title: 'Atölye X açık ofis günü', text: 'Atölye X ofisini 20 Eylül günü ziyaretçilere açıyor. Herkes davetli.',
  images: [img('u-uye', 1), img('u-uye', 2)], profile: { type: 'office', key: 'atolye-x' }, ...over,
});

console.log('\ngönderi — kimlik ve doğrulama');
await test('oturumsuz /mine → 401', async () => { assert.equal((await submit(null, '/api/gundem-submissions/mine', { method: 'GET' })).status, 401); });
await test('/mine: kendi adıyla eşleşen kişi + onaylı firma claim profilleri döner, başka firma dönmez', async () => {
  const data = await (await submit('u-uye', '/api/gundem-submissions/mine', { method: 'GET' })).json();
  const keys = data.profiles.map(p => `${p.type}:${p.key}`);
  assert.ok(keys.includes('architect:ayse-kaya'), keys.join());
  assert.ok(keys.includes('office:atolye-x'), keys.join());
  assert.ok(!keys.includes('office:baska-firma'));
  assert.deepEqual(data.categories.map(c => c.key), ['haber', 'etkinlik', 'yarisma']);
});
for (const [name, over, code] of [
  ['4 görsel → 400', { images: [1, 2, 3, 4].map(n => img('u-uye', n)) }, 400],
  ['görselsiz → 400', { images: [] }, 400],
  ['1001 karakter metin → 400', { text: 'a'.repeat(1001) }, 400],
  ['başkasının yüklemesi → 400', { images: [img('u-diger', 1)] }, 400],
  ['dış görsel adresi → 400', { images: ['https://evil.example/x.jpg'] }, 400],
  ["kategori 'gorus' (kullanıcıya kapalı) → 400", { category: 'gorus' }, 400],
  ['bağlı olmadığı firma adına → 403', { profile: { type: 'office', key: 'baska-firma' } }, 403],
]) {
  await test(name, async () => { assert.equal((await submit('u-uye', '/api/gundem-submissions', { method: 'POST', body: valid(over) })).status, code); });
}
await test('tam 1000 karakter (Türkçe harflerle) kabul edilir', async () => {
  const res = await submit('u-uye', '/api/gundem-submissions', { method: 'POST', body: valid({ title: 'Uzun metin', text: 'ğ'.repeat(1000), profile: null }) });
  assert.equal(res.status, 201);
  const { id } = await res.json();
  const row = db.prepare('SELECT submitter_type, submitter_name FROM gundem_items WHERE id = ?').get(id);
  assert.equal(row.submitter_type, 'user');
  assert.equal(row.submitter_name, 'Ayşe Kaya');
});

let itemId, slug;
await test('geçerli gönderi → 201, pending, ingest_mode=user, mükerrer anahtarları user: önekli', async () => {
  const res = await submit('u-uye', '/api/gundem-submissions', { method: 'POST', body: valid() });
  assert.equal(res.status, 201);
  ({ id: itemId, slug } = await res.json());
  const row = db.prepare('SELECT * FROM gundem_items WHERE id = ?').get(itemId);
  assert.equal(row.status, 'pending');
  assert.equal(row.ingest_mode, 'user');
  assert.equal(row.source_id, 'user');
  assert.equal(row.image_url, img('u-uye', 1));
  assert.deepEqual(JSON.parse(row.images), [img('u-uye', 1), img('u-uye', 2)]);
  assert.equal(row.content_hash, `user:${itemId}`);
  assert.equal(row.title_key, `user:${itemId}`);
  assert.equal(row.source_published_at, null);
});
await test('onaysız içerik public listede YOK', async () => {
  const data = await publicList();
  assert.ok(!data.items.some(i => i.slug === slug));
});

console.log('\nadmin onayı');
await test('admin kuyruğu: gönderen adı/e-postası ile listelenir', async () => {
  const data = await (await admin('/api/admin/gundem?status=pending', { method: 'GET' })).json();
  const it = data.items.find(i => i.id === itemId);
  assert.ok(it);
  assert.equal(it.user_email, 'u-uye@example.com');
  assert.equal(it.submitter_name, 'Atölye X');
  assert.equal(it.images.length, 2);
});
let firstPublishedAt;
await test('onay → published + profil kenarı (gundem_entities) yazılır', async () => {
  const res = await admin(`/api/admin/gundem/${itemId}/moderate`, { method: 'POST', body: { action: 'approve' } });
  assert.equal(res.status, 200);
  const row = db.prepare('SELECT status, source_published_at FROM gundem_items WHERE id = ?').get(itemId);
  assert.equal(row.status, 'published');
  assert.ok(row.source_published_at);
  firstPublishedAt = row.source_published_at;
  const e = db.prepare('SELECT * FROM gundem_entities WHERE item_id = ?').all(itemId);
  assert.deepEqual(e.map(x => `${x.entity_type}:${x.entity_key}`), ['office:atolye-x']);
});
await test('public liste: karusel görselleri + gönderen profili kaynak olarak', async () => {
  const it = (await publicList()).items.find(i => i.slug === slug);
  assert.ok(it);
  assert.equal(it.userSubmitted, true);
  assert.equal(it.images.length, 2);
  assert.equal(it.sourceName, 'Atölye X');
  assert.equal(it.sourceUrl, '/firma/atolye-x');
  assert.ok(!('submitted_by' in it), 'kullanıcı id public gövdeye girmemeli');
});
await test('firma popup şeridi (entityType=office&entityKey=atolye-x) içeriği bulur', async () => {
  const data = await publicList('?entityType=office&entityKey=atolye-x&limit=24');
  assert.ok(data.items.some(i => i.slug === slug));
});
await test('otomatik içerik tek görselle kalır (images=[image_url])', async () => {
  db.prepare(`INSERT INTO gundem_items (id, slug, title, summary, image_url, image_host, source_id, source_name, source_domain, source_url,
    published_at, source_published_at, category, content_hash, title_key, status, created_at, updated_at)
    VALUES ('cron1', 'cron-haber', 'Cron haberi', 'Özet', 'https://images.adsttc.com/x.jpg', 'images.adsttc.com', 'archdaily', 'ArchDaily', 'archdaily.com',
    'https://www.archdaily.com/x', ?, ?, 'haber', 'h', 't', 'published', ?, ?)`).run(now, now - 1000, now, now);
  const it = (await publicList()).items.find(i => i.slug === 'cron-haber');
  assert.deepEqual(it.images, ['https://images.adsttc.com/x.jpg']);
  assert.equal(it.userSubmitted, false);
  assert.equal(it.sourceUrl, 'https://www.archdaily.com/x');
});
await test('SSR kartı: kullanıcı gönderisinde kaynak bağlantısı profile gider (yeni sekme/nofollow yok)', async () => {
  const row = db.prepare('SELECT * FROM gundem_items WHERE id = ?').get(itemId);
  const html = gundemSsrCard(row);
  assert.ok(html.includes('href="/firma/atolye-x"'), html);
  assert.ok(!html.includes('target="_blank"'));
});

console.log('\nsahibin düzenlemesi ve yetki');
await test('yabancı kullanıcı GET/PATCH/DELETE → 404', async () => {
  for (const method of ['GET', 'PATCH', 'DELETE']) {
    const res = await submit('u-diger', `/api/gundem-submissions/${itemId}`, { method, body: method === 'PATCH' ? valid({ images: [img('u-diger', 1)] }) : undefined });
    assert.equal(res.status, 404, method);
  }
});
await test('sahip düzenler → yeniden pending, listeden düşer; profil değişimi eski kenarı siler', async () => {
  const res = await submit('u-uye', `/api/gundem-submissions/${itemId}`, { method: 'PATCH', body: valid({ title: 'Düzeltilmiş başlık', profile: { type: 'architect', key: 'ayse-kaya' } }) });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'pending');
  assert.ok(!(await publicList()).items.some(i => i.slug === slug));
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM gundem_entities WHERE item_id = ?').get(itemId).c, 0);
});
await test('yeniden onay: sıralama tarihi (source_published_at) KORUNUR, yeni profil kenarı yazılır', async () => {
  await admin(`/api/admin/gundem/${itemId}/moderate`, { method: 'POST', body: { action: 'approve' } });
  const row = db.prepare('SELECT status, source_published_at, title FROM gundem_items WHERE id = ?').get(itemId);
  assert.equal(row.status, 'published');
  assert.equal(row.source_published_at, firstPublishedAt);
  assert.equal(row.title, 'Düzeltilmiş başlık');
  const data = await publicList('?entityType=architect&entityKey=ayse-kaya&limit=24');
  assert.ok(data.items.some(i => i.slug === slug));
});
await test('admin düzenlemesi yayındaki durumu korur', async () => {
  const res = await submit('u-admin', `/api/gundem-submissions/${itemId}`, { method: 'PATCH', body: valid({ title: 'Admin düzeltmesi' }) });
  assert.equal(res.status, 200);
  assert.equal(db.prepare('SELECT status FROM gundem_items WHERE id = ?').get(itemId).status, 'published');
});
await test('admin satır içi görsel düzenleme: kendi medyamız CSP host listesine takılmaz, kapak güncellenir', async () => {
  const res = await admin(`/api/admin/gundem/${itemId}`, { method: 'PATCH', body: { image_url: `https://mimarlab.com${img('u-uye', 2)}` } });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const row = db.prepare('SELECT image_url, images FROM gundem_items WHERE id = ?').get(itemId);
  assert.equal(row.image_url, img('u-uye', 2));
  assert.equal(JSON.parse(row.images)[0], img('u-uye', 2));
});
await test('red → rejected, listede yok', async () => {
  await admin(`/api/admin/gundem/${itemId}/moderate`, { method: 'POST', body: { action: 'reject' } });
  assert.equal(db.prepare('SELECT status FROM gundem_items WHERE id = ?').get(itemId).status, 'rejected');
  assert.ok(!(await publicList()).items.some(i => i.slug === slug));
});
await test('sahip siler → satır ve kenarlar gider', async () => {
  const res = await submit('u-uye', `/api/gundem-submissions/${itemId}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM gundem_items WHERE id = ?').get(itemId).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM gundem_entities WHERE item_id = ?').get(itemId).c, 0);
});

console.log(`\n${failed ? 'BAŞARISIZ' : 'Gündem kullanıcı gönderisi testleri geçti'} — ${passed} geçti, ${failed} başarısız.`);
process.exit(failed ? 1 : 0);
