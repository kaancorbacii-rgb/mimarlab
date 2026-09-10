#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-10: "Udesign firmasına bir kullanıcıyı yönetici olarak atadım ama firma
// popup'ındaki 'Bu firma sana mı ait?' butonu kaybolmadı. Aynı sorun diğer firma ve kişi
// profillerinde de var."
//
// KÖK NEDEN: profile_claims.profile_key'in TEK bir kanonik biçimi yoktu. Kişi/firma popup'ı kutuyu
// canonical ADLA sorguluyor (office-modal.js#getProfileKey -> o.name) ama POST /api/claims
// name|slug|legacy_key'in üçünü de kabul edip GELENİ AYNEN yazıyordu — ve önizleme kartlarının
// sahiplenme popup'ı (js/components/preview-cards.js) SLUG gönderiyordu. Canlıda bu yolla oluşmuş
// iki ONAYLI satır vardı ("udesign-mimarlik", "melis-varkal"): sahibin yetkisi gerçek, ama profili
// adıyla sorgulayan hiçbir yer (davet kutusu, Düzenle butonu, rozet JOIN'leri) onları görmüyordu.
//
// ÇÖZÜM: anahtar YAZILIRKEN canonical ada çevrilir (src/lib/canonicalRead.js#resolveCanonicalName);
// okuyan onlarca yer alias'a toleranslı hâle getirilmedi, tek bir yazma biçimi zorlanır.
// Bu test o tek biçimi sabitler — her yazma yolu için ayrı ayrı.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { handleClaimsRoute } from '../src/routes/claims.js';
import { handleAdminRoute } from '../src/routes/admin.js';
import { ensurePendingOfficeClaims } from '../src/lib/claimedProfiles.js';
import { resolveCanonicalName } from '../src/lib/canonicalRead.js';
import { sha256Hex, newId } from '../src/lib/crypto.js';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 5).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }

// scripts/test-2026-09-10-round2.mjs#d1 ile AYNI shim.
function d1(db) {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = db.prepare(sql).get(...params); if (r === undefined) return null; return col ? r[col] : { ...r }; },
    async all() { return { results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }; },
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; } };
}

function freshEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0079_search_fold_columns.sql', import.meta.url), 'utf8'));
  const now = Date.now();
  db.exec(`
    INSERT INTO offices (slug, name, loc, cats, source, legacy_key) VALUES
      ('udesign-mimarlik', 'Udesign Mimarlık', 'İstanbul', '["Mimarlık"]', 'legacy_static', 'udesign-eski-anahtar');
    INSERT INTO architects (slug, name, source) VALUES
      ('melis-varkal', 'Melis Varkal', 'legacy_static');
  `);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, position, created_at) VALUES ('u1','uye@example.com','x','Bir Üye','user','Kurucu',?)`).run(now);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u-admin','admin@example.com','x','Admin','admin',?)`).run(now);
  return { DB: d1(db), _db: db };
}

// Oturum çerezi olan bir istek üretir (auth.js#getSessionUser gerçek yolundan geçsin diye).
async function sessionFor(env, userId) {
  const token = 'tok-' + userId;
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(await sha256Hex(token), userId, Date.now(), Date.now() + 86400000).run();
  return token;
}
function req(url, { method = 'GET', token, body } = {}) {
  const headers = new Headers();
  // https:// istek -> src/lib/http.js#sessionCookieName '__Host-' önekini bekler.
  if (token) headers.set('Cookie', `__Host-mimarlab_session=${token}`);
  if (body) headers.set('Content-Type', 'application/json');
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}
const claimKeys = (env, type) =>
  env._db.prepare(`SELECT profile_key, status FROM profile_claims WHERE profile_type = ?`).all(type).map(r => r.profile_key + ':' + r.status);

section('1) resolveCanonicalName — ad / slug / legacy_key hepsi kanonik ADA çözülür');
await test('canonical ad kendisine çözülür', async () => {
  const env = freshEnv();
  assert.equal(await resolveCanonicalName(env, 'offices', 'Udesign Mimarlık'), 'Udesign Mimarlık');
});
await test('slug kanonik ADA çözülür (bildirilen hata)', async () => {
  const env = freshEnv();
  assert.equal(await resolveCanonicalName(env, 'offices', 'udesign-mimarlik'), 'Udesign Mimarlık');
  assert.equal(await resolveCanonicalName(env, 'architects', 'melis-varkal'), 'Melis Varkal');
});
await test('legacy_key kanonik ADA çözülür', async () => {
  const env = freshEnv();
  assert.equal(await resolveCanonicalName(env, 'offices', 'udesign-eski-anahtar'), 'Udesign Mimarlık');
});
await test('bilinmeyen anahtar null döner', async () => {
  const env = freshEnv();
  assert.equal(await resolveCanonicalName(env, 'offices', 'hic-olmayan'), null);
});

section('2) POST /api/claims — SLUG gönderilse bile satıra canonical AD yazılır');
await test('slug ile açılan firma talebi canonical adla saklanır', async () => {
  const env = freshEnv();
  const token = await sessionFor(env, 'u1');
  const url = new URL('https://mimarlab.com/api/claims');
  const res = await handleClaimsRoute(
    req(url.toString(), { method: 'POST', token, body: { profileType: 'office', profileKey: 'udesign-mimarlik' } }),
    env, url,
  );
  assert.equal(res.status, 201, await res.text());
  assert.deepEqual(claimKeys(env, 'office'), ['Udesign Mimarlık:pending']);
});
await test('slug ile açılan kişi talebi canonical adla saklanır', async () => {
  const env = freshEnv();
  const token = await sessionFor(env, 'u1');
  const url = new URL('https://mimarlab.com/api/claims');
  const res = await handleClaimsRoute(
    req(url.toString(), { method: 'POST', token, body: { profileType: 'architect', profileKey: 'melis-varkal' } }),
    env, url,
  );
  assert.equal(res.status, 201, await res.text());
  assert.deepEqual(claimKeys(env, 'architect'), ['Melis Varkal:pending']);
});
await test('aynı profil için slug ve ad AYNI satırı bulur (mükerrer talep açılmaz)', async () => {
  const env = freshEnv();
  const token = await sessionFor(env, 'u1');
  const url = new URL('https://mimarlab.com/api/claims');
  await handleClaimsRoute(req(url.toString(), { method: 'POST', token, body: { profileType: 'office', profileKey: 'udesign-mimarlik' } }), env, url);
  const res = await handleClaimsRoute(req(url.toString(), { method: 'POST', token, body: { profileType: 'office', profileKey: 'Udesign Mimarlık' } }), env, url);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'pending');
  assert.equal(claimKeys(env, 'office').length, 1, 'iki ayrı satır oluşmamalı');
});
await test('var olmayan profil hâlâ 404', async () => {
  const env = freshEnv();
  const token = await sessionFor(env, 'u1');
  const url = new URL('https://mimarlab.com/api/claims');
  const res = await handleClaimsRoute(req(url.toString(), { method: 'POST', token, body: { profileType: 'office', profileKey: 'Hic Olmayan Firma' } }), env, url);
  assert.equal(res.status, 404);
});

section('3) POST /api/admin/claims (adminin doğrudan ataması) — slug kabul edilir, AD yazılır');
await test('admin slug ile atarsa satır canonical adla ve onaylı açılır', async () => {
  const env = freshEnv();
  const token = await sessionFor(env, 'u-admin');
  const url = new URL('https://mimarlab.com/api/admin/claims');
  const res = await handleAdminRoute(
    req(url.toString(), { method: 'POST', token, body: { userId: 'u1', profileType: 'office', profileKey: 'udesign-mimarlik', officePosition: 'Yönetici' } }),
    env, url,
  );
  assert.equal(res.status, 200, await res.text());
  assert.deepEqual(claimKeys(env, 'office'), ['Udesign Mimarlık:approved']);
  const row = env._db.prepare(`SELECT office_position FROM profile_claims`).get();
  assert.equal(row.office_position, 'Yönetici');
});
await test('adminin ADLA ataması eskisi gibi çalışır', async () => {
  const env = freshEnv();
  const token = await sessionFor(env, 'u-admin');
  const url = new URL('https://mimarlab.com/api/admin/claims');
  const res = await handleAdminRoute(
    req(url.toString(), { method: 'POST', token, body: { userId: 'u1', profileType: 'architect', profileKey: 'Melis Varkal' } }),
    env, url,
  );
  assert.equal(res.status, 200, await res.text());
  assert.deepEqual(claimKeys(env, 'architect'), ['Melis Varkal:approved']);
});

section('4) ensurePendingOfficeClaims — legacy_key/farklı büyük-küçük harf de canonical ADA yazılır');
await test('legacy_key ile gelen firma adı canonical adla saklanır', async () => {
  const env = freshEnv();
  await ensurePendingOfficeClaims(env, { id: 'u1', role: 'user' }, ['udesign-eski-anahtar'], newId);
  assert.deepEqual(claimKeys(env, 'office'), ['Udesign Mimarlık:pending']);
});
await test('canonical ad zaten doğruysa aynen korunur', async () => {
  const env = freshEnv();
  await ensurePendingOfficeClaims(env, { id: 'u1', role: 'user' }, ['Udesign Mimarlık'], newId);
  assert.deepEqual(claimKeys(env, 'office'), ['Udesign Mimarlık:pending']);
});

section('5) SÖZLEŞME: hangi yoldan gelirse gelsin profile_key canonical bir ada eşit olmalı');
await test('üç yazma yolunun hepsi tek biçim üretir', async () => {
  const env = freshEnv();
  const token = await sessionFor(env, 'u1');
  const url = new URL('https://mimarlab.com/api/claims');
  await handleClaimsRoute(req(url.toString(), { method: 'POST', token, body: { profileType: 'architect', profileKey: 'melis-varkal' } }), env, url);
  await ensurePendingOfficeClaims(env, { id: 'u1', role: 'user' }, ['udesign-eski-anahtar'], newId);
  const rows = env._db.prepare(`SELECT profile_type, profile_key FROM profile_claims`).all();
  assert.equal(rows.length, 2);
  for (const r of rows) {
    const table = r.profile_type === 'office' ? 'offices' : 'architects';
    const hit = env._db.prepare(`SELECT name FROM ${table} WHERE name = ?`).get(r.profile_key);
    assert.ok(hit, `profile_key "${r.profile_key}" hiçbir canonical ADA eşit değil`);
  }
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) { failures.forEach(f => console.error(`  - ${f.name}: ${f.message}`)); process.exit(1); }
