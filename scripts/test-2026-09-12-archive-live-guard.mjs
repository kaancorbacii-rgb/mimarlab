#!/usr/bin/env node
// ARŞİVDE GÖRÜNEN CANLI İÇERİK — BİRİM TESTLERİ (kullanıcı bildirimi, 2026-09-12: "Sitede hali
// hazırda yayınlanmış ve blursuz olan içerikler neden admin panelinde arşiv kısmında gözüküyorlar.")
//
// Kök neden ve iki katmanlı çözüm: src/lib/archiveSync.js dosya başı.
//   1) unpreviewByIds (yayına alan TÜM cascade'lerin ortak ucu) artık bağlı 'archived' gönderileri
//      'approved'a çeviriyor -> iki taraf bir daha ayrışmaz.
//   2) Arşiv listeleri (admin paneli + Hesabım > Arşivim) canonical satırı YAYINDA olan hiçbir
//      satırı göstermiyor -> geçmişte ayrışmış satırlar da ekranda görünmez.
// ÖNİZLEME kayıtları (hidden_at DOLU + preview_at DOLU) arşivde KALMALI — blurlular, yayında değiller.
//
// scripts/test-message-seen-receipt.mjs İLE AYNI desen: gerçek schema.sql'e karşı node:sqlite D1 shim'i.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { handleAdminRoute } from '../src/routes/admin.js';
import { handleArchiveRoute } from '../src/routes/archive.js';
import { notArchivedIfCanonicalLiveSql, markSubmissionsPublished } from '../src/lib/archiveSync.js';
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

const TOKEN_ADMIN = 'session-admin';
const TOKEN_OWNER = 'session-owner';

// Üç kişi kaydı: biri CANLI (yayında, blursuz), biri TAM ARŞİV (hidden_at dolu, preview_at boş),
// biri ÖNİZLEME (ikisi de dolu). Üçünün de gönderisi status='archived'.
async function freshEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const env = { DB: d1(db) };
  db.exec(`INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES
    ('u-admin', 'a@example.com', 'Admin', 'x', 'admin', 1000),
    ('u-owner', 'o@example.com', 'Sahip', 'x', 'user', 1000)`);
  for (const [token, uid] of [[TOKEN_ADMIN, 'u-admin'], [TOKEN_OWNER, 'u-owner']]) {
    db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
      .run(await sha256Hex(token), uid, Date.now(), Date.now() + 3600_000);
  }
  db.exec(`INSERT INTO architects (slug, name, source, hidden_at, preview_at) VALUES
    ('canli', 'Canlı Kişi', 'admin', NULL, NULL),
    ('arsiv', 'Arşiv Kişi', 'admin', '2026-09-01', NULL),
    ('onizleme', 'Önizleme Kişi', 'admin', '2026-09-01', '2026-09-02')`);
  db.exec(`INSERT INTO architect_submissions (id, name, status, claimed_profile_key, owner_user_id, created_at, updated_at) VALUES
    ('s-canli', 'Canlı Kişi', 'archived', 'Canlı Kişi', 'u-owner', 1000, 1000),
    ('s-arsiv', 'Arşiv Kişi', 'archived', 'Arşiv Kişi', 'u-owner', 1000, 1000),
    ('s-onizleme', 'Önizleme Kişi', 'archived', 'Önizleme Kişi', 'u-owner', 1000, 1000),
    ('s-taslak', 'Hiç Yayınlanmamış', 'archived', NULL, 'u-owner', 1000, 1000)`);
  return { db, env };
}

function req(path, token, init = {}) {
  const url = new URL(`https://mimarlab.com${path}`);
  return [new Request(url, { ...init, headers: { cookie: `__Host-mimarlab_session=${token}`, ...(init.headers || {}) } }), url];
}
async function adminArchive(env, type = 'architects') {
  const [r, url] = req(`/api/admin/submissions?type=${type}&status=archived`, TOKEN_ADMIN);
  const res = await handleAdminRoute(r, env, url);
  assert.equal(res.status, 200, `beklenen 200, gelen ${res.status}`);
  return (await res.json()).items.map(i => i.id);
}
// /api/archive/mine TÜM tipleri tek yanıtta döner (bkz. listMineArchive) — tip parametresi yok.
async function myArchive(env) {
  const [r, url] = req('/api/archive/mine', TOKEN_OWNER);
  const res = await handleArchiveRoute(r, env, url);
  assert.equal(res.status, 200, `beklenen 200, gelen ${res.status}`);
  return (await res.json()).items.map(i => i.id);
}

console.log('\n1) Admin paneli > Arşiv sekmesi');

await test('canlı (blursuz, yayında) kayıt arşiv listesinde GÖRÜNMEZ', async () => {
  const { env } = await freshEnv();
  assert.ok(!(await adminArchive(env)).includes('s-canli'));
});

await test('tam arşivlenmiş kayıt arşiv listesinde KALIR', async () => {
  const { env } = await freshEnv();
  assert.ok((await adminArchive(env)).includes('s-arsiv'));
});

await test('ÖNİZLEME (blurlu, yayında değil) kayıt arşiv listesinde KALIR', async () => {
  const { env } = await freshEnv();
  assert.ok((await adminArchive(env)).includes('s-onizleme'));
});

await test('hiç yayınlanmamış taslağın arşivi (claimed_* NULL) listede KALIR', async () => {
  const { env } = await freshEnv();
  assert.ok((await adminArchive(env)).includes('s-taslak'));
});

await test('silinen canonical kayıt yine arşivde kalır (yayında değil)', async () => {
  const { db, env } = await freshEnv();
  db.exec(`UPDATE architects SET deleted_at = '2026-09-03' WHERE slug = 'canli'`);
  assert.ok((await adminArchive(env)).includes('s-canli'));
});

await test('süzgeç YALNIZCA status=archived sorgusuna uygulanır', async () => {
  const { db, env } = await freshEnv();
  db.exec(`UPDATE architect_submissions SET status = 'approved' WHERE id = 's-canli'`);
  const [r, url] = req('/api/admin/submissions?type=architects&status=approved', TOKEN_ADMIN);
  const res = await handleAdminRoute(r, env, url);
  const ids = (await res.json()).items.map(i => i.id);
  assert.deepEqual(ids, ['s-canli'], 'canlı kaydın approved listesinde görünmesi gerekir');
});

console.log('\n2) Hesabım > Arşivim kutusu (AYNI satırlar, AYNI süzgeç)');

await test('canlı kayıt kullanıcının arşiv kutusunda da GÖRÜNMEZ', async () => {
  const { env } = await freshEnv();
  const ids = await myArchive(env);
  assert.ok(!ids.includes('s-canli'), `beklenmedik: ${ids.join(',')}`);
});

await test('arşiv ve önizleme kayıtları kutuda KALIR', async () => {
  const { env } = await freshEnv();
  const ids = await myArchive(env);
  assert.ok(ids.includes('s-arsiv') && ids.includes('s-onizleme'), `gelen: ${ids.join(',')}`);
});

console.log('\n3) Kök neden — yayına alma gönderi status\'unu senkronlar');

await test('markSubmissionsPublished: yayına alınan canonical id için taslak approved olur', async () => {
  const { db, env } = await freshEnv();
  const row = db.prepare(`SELECT id FROM architects WHERE slug = 'arsiv'`).get();
  db.exec(`UPDATE architects SET hidden_at = NULL, preview_at = NULL WHERE slug = 'arsiv'`);
  await markSubmissionsPublished(env, 'architects', [row.id]);
  const s = db.prepare(`SELECT status FROM architect_submissions WHERE id = 's-arsiv'`).get();
  assert.equal(s.status, 'approved');
});

await test('markSubmissionsPublished BAĞSIZ satırlara dokunmaz', async () => {
  const { db, env } = await freshEnv();
  const row = db.prepare(`SELECT id FROM architects WHERE slug = 'arsiv'`).get();
  await markSubmissionsPublished(env, 'architects', [row.id]);
  const others = db.prepare(`SELECT id, status FROM architect_submissions WHERE id != 's-arsiv'`).all();
  assert.ok(others.every(o => o.status === 'archived'), JSON.stringify(others));
});

await test('markSubmissionsPublished malzeme gönderilerini de kapsar (products canonical)', async () => {
  const { db, env } = await freshEnv();
  db.exec(`INSERT INTO products (slug, title, source, kind) VALUES ('bir-malzeme', 'Bir Malzeme', 'admin', 'material')`);
  db.exec(`INSERT INTO material_submissions (id, title, status, claimed_slug, owner_user_id, created_at, updated_at)
           VALUES ('m-1', 'Bir Malzeme', 'archived', 'bir-malzeme', 'u-owner', 1000, 1000)`);
  const row = db.prepare(`SELECT id FROM products WHERE slug = 'bir-malzeme'`).get();
  await markSubmissionsPublished(env, 'products', [row.id]);
  assert.equal(db.prepare(`SELECT status FROM material_submissions WHERE id = 'm-1'`).get().status, 'approved');
});

await test('süzgeç SQL her tip için üretilir, bilinmeyen tipte boş döner', async () => {
  for (const t of ['projects', 'architects', 'offices', 'products', 'materials']) {
    assert.ok(notArchivedIfCanonicalLiveSql(t).includes('NOT EXISTS'), t);
  }
  assert.equal(notArchivedIfCanonicalLiveSql('bilinmeyen'), '');
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) { for (const f of failures) console.error(` - ${f.name}: ${f.message}`); process.exit(1); }
