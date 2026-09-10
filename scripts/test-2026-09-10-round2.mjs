#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-10 (ikinci tur) — BİRİM TESTLERİ
//   madde 1: "Bir kullanıcı kendi kişi profilinden bir firmayı ya da markayı silerse, o firmanın ya
//            da markanın profilinden de bu kişi ismi otomatik olarak silinsin."
//   madde 2: "Kullanıcıların yetkisi oldukları firma, marka, proje, ürün ve kişi profillerini
//            arşivleme ve silme yetkileri olsun. Kullanıcı arşivle butonuyla kendi içeriğini
//            arşivlerse bu blurlu gösterim değil direkt arşivleme olsun. Direkt arşivlediği
//            içerikler de hesabım sayfasındaki arşivlerim kısmında gözüksün."
//
// scripts/test-office-member-profile-edit.mjs ile AYNI desen: test koşucusu yok, node:assert +
// node:sqlite üzerinde GERÇEK bir SQLite ve schema.sql; canlı route/lib fonksiyonları import edilir.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { cascadeRemovedOfficesFromArchitect } from '../src/lib/officeFounderCascade.js';
import { handleSubmissionRoute, handleSelfContentModerate } from '../src/routes/submissions.js';
import { setLegacyHidden } from '../src/routes/legacyContent.js';
import { handleArchiveRoute } from '../src/routes/archive.js';
import { sha256Hex } from '../src/lib/crypto.js';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 5).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }

function d1(db) {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = db.prepare(sql).get(...params); if (r === undefined) return null; return col ? r[col] : { ...r }; },
    async all() { return { results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }; },
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; } };
}
function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0079_search_fold_columns.sql', import.meta.url), 'utf8'));
  return db;
}

// offices: 1 Rasa Studio (firma), 2 Vitrium (marka)
// architects: 1 Tuna Han Koç (Rasa Studio'nun kurucusu, kendi profilini sahiplenmiş)
function seed(db) {
  const now = Date.now();
  db.exec(`
    INSERT INTO offices (slug, name, loc, cats, source) VALUES
      ('rasa-studio', 'Rasa Studio', 'İstanbul', '["Mimarlık"]', 'legacy_static'),
      ('vitrium', 'Vitrium', 'İzmir', '["Mobilya"]', 'legacy_static');
    INSERT INTO architects (slug, name, office_id, position, source) VALUES
      ('tuna-han-koc', 'Tuna Han Koç', 1, 'Kurucu', 'legacy_static');
    INSERT INTO office_founders (office_id, architect_id) VALUES (1, 1);
    INSERT INTO office_submissions (id, owner_user_id, status, created_at, updated_at, name, claimed_profile_key, founders, team)
      VALUES ('s-rasa', NULL, 'approved', ${now}, ${now}, 'Rasa Studio', 'Rasa Studio', '["Tuna Han Koç","Başka Kurucu"]', '["Bir Ekip Üyesi"]');
  `);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u-tuna', 'tuna@example.com', 'x', 'Tuna Han Koç', 'user', ?)`).run(now);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u-yabanci', 'y@example.com', 'x', 'Yabancı', 'user', ?)`).run(now);
  db.prepare(`INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at) VALUES ('c-tuna-arch', 'u-tuna', 'architect', 'Tuna Han Koç', 'approved', ?, ?)`).run(now, now);
  db.prepare(`INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at, office_position) VALUES ('c-tuna-office', 'u-tuna', 'office', 'Rasa Studio', 'approved', ?, ?, 'Kurucu')`).run(now, now);
}

async function withSessions(db, ids = ['u-tuna', 'u-yabanci']) {
  const now = Date.now();
  for (const uid of ids) {
    db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
      .run(await sha256Hex(`tok-${uid}`), uid, now, now + 3600_000);
  }
}
const req = (uid, path, init = {}) => new Request(`https://mimarlab.com${path}`, {
  ...init,
  headers: { 'Content-Type': 'application/json', Cookie: `__Host-mimarlab_session=tok-${uid}`, ...(init.headers || {}) },
});
const parseJson = (raw) => { try { return JSON.parse(raw || '[]'); } catch { return null; } };

// ---------------------------------------------------------------------------------------------
section('madde 1 — kişi profilinden çıkarılan firma, firmanın künyesinden de düşer');

await test('serbest metin Kurucular kutusundan isim silinir, claim reddedilir', async () => {
  const db = freshDb(); seed(db);
  const env = { DB: d1(db) };
  await cascadeRemovedOfficesFromArchitect(env, 'Tuna Han Koç', 'Rasa Studio', '', { claimUserId: 'u-tuna' });

  const draft = db.prepare(`SELECT founders, team FROM office_submissions WHERE id = 's-rasa'`).get();
  assert.deepEqual(parseJson(draft.founders), ['Başka Kurucu'], 'yalnızca çıkarılan isim silinmeli');
  assert.deepEqual(parseJson(draft.team), ['Bir Ekip Üyesi'], 'Ekip listesine dokunulmamalı');
  assert.equal(db.prepare(`SELECT status FROM profile_claims WHERE id = 'c-tuna-office'`).get().status, 'rejected');
});

await test('Ekip kutusundaki isim de kapsanır', async () => {
  const db = freshDb(); seed(db);
  db.exec(`UPDATE office_submissions SET founders = '[]', team = '["Tuna Han Koç"]' WHERE id = 's-rasa'`);
  const env = { DB: d1(db) };
  await cascadeRemovedOfficesFromArchitect(env, 'Tuna Han Koç', 'Rasa Studio', '', { claimUserId: 'u-tuna' });
  assert.deepEqual(parseJson(db.prepare(`SELECT team FROM office_submissions WHERE id = 's-rasa'`).get().team), []);
});

await test('aksan/büyük-küçük farkı katlanır (foldTr)', async () => {
  const db = freshDb(); seed(db);
  db.exec(`UPDATE office_submissions SET founders = '["TUNA HAN KOC"]' WHERE id = 's-rasa'`);
  const env = { DB: d1(db) };
  await cascadeRemovedOfficesFromArchitect(env, 'Tuna Han Koç', 'Rasa Studio', '', { claimUserId: 'u-tuna' });
  assert.deepEqual(parseJson(db.prepare(`SELECT founders FROM office_submissions WHERE id = 's-rasa'`).get().founders), []);
});

await test('KORUNAN firmaya dokunulmaz (yalnızca ÇIKARILAN adlar cascade edilir)', async () => {
  const db = freshDb(); seed(db);
  const env = { DB: d1(db) };
  // "Rasa Studio, Vitrium" -> "Rasa Studio": yalnızca Vitrium çıkarıldı.
  await cascadeRemovedOfficesFromArchitect(env, 'Tuna Han Koç', 'Rasa Studio, Vitrium', 'Rasa Studio', { claimUserId: 'u-tuna' });
  assert.deepEqual(parseJson(db.prepare(`SELECT founders FROM office_submissions WHERE id = 's-rasa'`).get().founders), ['Tuna Han Koç', 'Başka Kurucu']);
  assert.equal(db.prepare(`SELECT status FROM profile_claims WHERE id = 'c-tuna-office'`).get().status, 'approved');
});

await test('marka (offices satırı) için AYRI kod yolu yok — aynı kural geçerli', async () => {
  const db = freshDb(); seed(db);
  const now = Date.now();
  db.prepare(`INSERT INTO office_submissions (id, owner_user_id, status, created_at, updated_at, name, claimed_profile_key, founders) VALUES ('s-vitrium', NULL, 'approved', ?, ?, 'Vitrium', 'Vitrium', '["Tuna Han Koç"]')`).run(now, now);
  db.prepare(`INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at, office_position) VALUES ('c-tuna-vitrium', 'u-tuna', 'office', 'Vitrium', 'approved', ?, ?, 'Ortak')`).run(now, now);
  const env = { DB: d1(db) };
  await cascadeRemovedOfficesFromArchitect(env, 'Tuna Han Koç', 'Rasa Studio, Vitrium', 'Rasa Studio', { claimUserId: 'u-tuna' });
  assert.deepEqual(parseJson(db.prepare(`SELECT founders FROM office_submissions WHERE id = 's-vitrium'`).get().founders), []);
  assert.equal(db.prepare(`SELECT status FROM profile_claims WHERE id = 'c-tuna-vitrium'`).get().status, 'rejected');
});

await test('BEKLEYEN talep de düşürülür (kullanıcı o bağdan vazgeçti)', async () => {
  const db = freshDb(); seed(db);
  db.exec(`UPDATE profile_claims SET status = 'pending' WHERE id = 'c-tuna-office'`);
  const env = { DB: d1(db) };
  await cascadeRemovedOfficesFromArchitect(env, 'Tuna Han Koç', 'Rasa Studio', '', { claimUserId: 'u-tuna' });
  assert.equal(db.prepare(`SELECT status FROM profile_claims WHERE id = 'c-tuna-office'`).get().status, 'rejected');
});

await test('BAŞKA bir kullanıcının talebine dokunulmaz', async () => {
  const db = freshDb(); seed(db);
  const now = Date.now();
  db.prepare(`INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at, office_position) VALUES ('c-yabanci-office', 'u-yabanci', 'office', 'Rasa Studio', 'approved', ?, ?, 'Kurucu')`).run(now, now);
  const env = { DB: d1(db) };
  await cascadeRemovedOfficesFromArchitect(env, 'Tuna Han Koç', 'Rasa Studio', '', { claimUserId: 'u-tuna' });
  assert.equal(db.prepare(`SELECT status FROM profile_claims WHERE id = 'c-yabanci-office'`).get().status, 'approved');
});

await test('uçtan uca: PATCH /api/architects ile Firma alanı boşaltmak cascade eder', async () => {
  const db = freshDb(); seed(db); await withSessions(db);
  const now = Date.now();
  db.prepare(`INSERT INTO architect_submissions (id, owner_user_id, status, created_at, updated_at, name, claimed_profile_key, office) VALUES ('a-tuna', 'u-tuna', 'approved', ?, ?, 'Tuna Han Koç', 'Tuna Han Koç', 'Rasa Studio')`).run(now, now);
  const env = { DB: d1(db) };
  const res = await handleSubmissionRoute(
    req('u-tuna', '/api/architects/a-tuna', { method: 'PATCH', body: JSON.stringify({ name: 'Tuna Han Koç', office: '', rightsAccepted: true }) }),
    env, new URL('https://mimarlab.com/api/architects/a-tuna'),
  );
  assert.equal(res.status, 200, await res.text());
  assert.deepEqual(parseJson(db.prepare(`SELECT founders FROM office_submissions WHERE id = 's-rasa'`).get().founders), ['Başka Kurucu']);
  assert.equal(db.prepare(`SELECT status FROM profile_claims WHERE id = 'c-tuna-office'`).get().status, 'rejected');
  // office_founders yapısal bağı da düşmeli (canonicalSync#syncOfficeFounderLink).
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM office_founders WHERE architect_id = 1`).get().n, 0);
});

// ---------------------------------------------------------------------------------------------
section('madde 2 — "Arşivle" HER ZAMAN tam arşiv (blurlu önizleme DEĞİL)');

await test('önizlemedeki bir kaydı arşivlemek preview_at\'i TEMİZLER', async () => {
  const db = freshDb(); seed(db);
  const nowIso = new Date().toISOString();
  db.prepare(`UPDATE offices SET hidden_at = ?, preview_at = ? WHERE id = 1`).run(nowIso, nowIso);
  const env = { DB: d1(db) };
  await setLegacyHidden(env, { id: 'u-tuna', role: 'user' }, 'offices', 'Rasa Studio', true);
  const row = db.prepare(`SELECT hidden_at, preview_at FROM offices WHERE id = 1`).get();
  assert.ok(row.hidden_at, 'hidden_at dolu kalmalı');
  assert.equal(row.preview_at, null, 'preview_at temizlenmeli — arşiv blurlu gösterim DEĞİL');
});

await test('yayına alma preview_at\'i temizlemeye devam eder (regresyon)', async () => {
  const db = freshDb(); seed(db);
  const nowIso = new Date().toISOString();
  db.prepare(`UPDATE offices SET hidden_at = ?, preview_at = ? WHERE id = 1`).run(nowIso, nowIso);
  const env = { DB: d1(db) };
  await setLegacyHidden(env, { id: 'u-tuna', role: 'user' }, 'offices', 'Rasa Studio', false);
  const row = db.prepare(`SELECT hidden_at, preview_at, relisted_at FROM offices WHERE id = 1`).get();
  assert.equal(row.hidden_at, null);
  assert.equal(row.preview_at, null);
  assert.ok(row.relisted_at, 'önizlemeden çıkan kayıt listenin başına damgalanmalı');
});

// ---------------------------------------------------------------------------------------------
section('madde 2 — kanonik anahtarla arşivle/sil + Arşivim kutusunda görünme');

await test('yetkili kullanıcı taslağı OLMADAN firmayı arşivleyebilir, kayıt Arşivim\'de görünür', async () => {
  const db = freshDb(); seed(db); await withSessions(db);
  // Tuna'nın Rasa Studio için HİÇ kendi taslağı yok (s-rasa'nın owner_user_id'si NULL) — eski
  // id tabanlı uç bu senaryoda kullanılamıyordu.
  const env = { DB: d1(db) };
  const res = await handleSelfContentModerate(req('u-tuna', '/api/office/Rasa%20Studio/moderate', { method: 'POST' }), env, 'offices', 'Rasa Studio', 'archive');
  assert.equal(res.status, 200, await res.text());
  assert.ok(db.prepare(`SELECT hidden_at FROM offices WHERE id = 1`).get().hidden_at, 'canlıdan çekilmeli');

  // Arşivim: taslak Tuna'nın üzerine yazıldığı için kutusunda görünmeli.
  const url = new URL('https://mimarlab.com/api/archive/mine');
  const listed = await handleArchiveRoute(req('u-tuna', url.pathname), env, url);
  const data = await listed.json();
  assert.ok((data.items || []).some(i => i.title === 'Rasa Studio'), `Arşivim'de görünmeli: ${JSON.stringify(data.items)}`);
});

await test('YETKİSİZ kullanıcı kanonik anahtarla arşivleyemez', async () => {
  const db = freshDb(); seed(db); await withSessions(db);
  const env = { DB: d1(db) };
  const res = await handleSelfContentModerate(req('u-yabanci', '/api/office/Rasa%20Studio/moderate', { method: 'POST' }), env, 'offices', 'Rasa Studio', 'archive');
  assert.equal(res.status, 403);
  assert.equal(db.prepare(`SELECT hidden_at FROM offices WHERE id = 1`).get().hidden_at, null);
});

await test('oturumsuz istek 401 alır', async () => {
  const db = freshDb(); seed(db);
  const env = { DB: d1(db) };
  const res = await handleSelfContentModerate(new Request('https://mimarlab.com/api/office/Rasa%20Studio/moderate', { method: 'POST' }), env, 'offices', 'Rasa Studio', 'archive');
  assert.equal(res.status, 401);
});

await test('geçersiz işlem reddedilir (yalnızca archive/delete)', async () => {
  const db = freshDb(); seed(db); await withSessions(db);
  const env = { DB: d1(db) };
  const res = await handleSelfContentModerate(req('u-tuna', '/api/office/Rasa%20Studio/moderate', { method: 'POST' }), env, 'offices', 'Rasa Studio', 'publish');
  assert.equal(res.status, 400);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.error('\nBaşarısız testler:');
  for (const f of failures) console.error(`  - ${f.name}: ${f.message}`);
  process.exit(1);
}
