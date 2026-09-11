#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-11 — BİRİM TESTLERİ
//   madde 2: "Admin canlı sitede bir firmayı yayınla diyerek blurdan kurtardığı zaman otomatikman
//            firmaya ait tüm projeler ve firmadaki kişiler de blurdan çıkıp yayınlansın. Son
//            paylaşılan projeleri proje sayfasında 1. sıraya otursun."
//   ek:      "Firmalarda Ekip Lideri ekip bölümünde yer alsın."
//
// Kural tek yerde: src/routes/admin.js#activateOfficesOnPublish (atamayla AYNI graf). İki tetikleyici
// test edilir: firma-ekle'nin telif beyanlı kaydı (src/routes/submissions.js) ve admin panelinin
// Arşiv > "Yayınla"sı (src/routes/legacyContent.js#runContentAction).
// scripts/test-2026-09-11-founder-detach-admin-preview-save.mjs ile AYNI desen.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { handleSubmissionRoute } from '../src/routes/submissions.js';
import { runContentAction } from '../src/routes/legacyContent.js';
import { buildOfficePayload } from '../src/routes/office.js';
import { sha256Hex } from '../src/lib/crypto.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }

function d1(db) {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = db.prepare(sql).get(...params); if (r === undefined) return null; return col ? r[col] : { ...r }; },
    async all() { return { results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }; },
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; } };
}
function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0079_search_fold_columns.sql', import.meta.url), 'utf8'));
  return db;
}

const PREV = '2026-09-01T00:00:00.000Z';

// Tago Architects'in canlıdaki şekli — firma ve TÜM içeriği önizlemede:
//   10 Gökhan Aktan Altuğ  office_founders, Kurucu Ortak
//   11 Müge Eker Eryakar   office_founders, Ekip Lideri   -> popup'ta Ekip'te olmalı
//   12 Tatsuya Yamamoto    YALNIZCA architects.office_id
//   13 Metin Kılıç         YALNIZCA firma formunun Ekip METNİNDE (bağ yok)
//   14 İlgisiz Mimar       başka firmada — dokunulmamalı
//   projeler 100 (eski) · 101 (en son yayınlanan, eski toplu-import display_order'ı) · 102 ilgisiz
async function seed(db) {
  const now = Date.now();
  db.exec(`
    INSERT INTO offices (id, slug, name, loc, cats, source, legacy_key, hidden_at, preview_at) VALUES
      (1, 'tago-architects', 'Tago Architects', 'İstanbul', '"Mimarlık"', 'legacy_static', 'Tago Architects', '${PREV}', '${PREV}'),
      (2, 'baska-ofis', 'Başka Ofis', 'İstanbul', '"Mimarlık"', 'legacy_static', 'Başka Ofis', '${PREV}', '${PREV}');
    INSERT INTO architects (id, slug, name, position, office_id, source, legacy_key, hidden_at, preview_at) VALUES
      (10, 'gokhan-aktan-altug', 'Gökhan Aktan Altuğ', 'Kurucu Ortak', NULL, 'legacy_static', 'Gökhan Aktan Altuğ', '${PREV}', '${PREV}'),
      (11, 'muge-eker-eryakar', 'Müge Eker Eryakar', 'Ekip Lideri', 1, 'legacy_static', 'Müge Eker Eryakar', '${PREV}', '${PREV}'),
      (12, 'tatsuya-yamamoto', 'Tatsuya Yamamoto', 'Kurucu Ortak', 1, 'legacy_static', 'Tatsuya Yamamoto', '${PREV}', '${PREV}'),
      (13, 'metin-kilic', 'Metin Kılıç', NULL, NULL, 'legacy_static', 'Metin Kılıç', '${PREV}', '${PREV}'),
      (14, 'ilgisiz-mimar', 'İlgisiz Mimar', 'Kurucu', 2, 'legacy_static', 'İlgisiz Mimar', '${PREV}', '${PREV}');
    INSERT INTO office_founders (office_id, architect_id) VALUES (1, 10), (1, 11), (2, 14);
    INSERT INTO projects (id, slug, title, source, publish_date, display_order, hidden_at, preview_at) VALUES
      (100, 'maya-rezidans', 'Maya Rezidans', 'legacy_static', '2020-01-01 00:00:00', NULL, '${PREV}', '${PREV}'),
      (101, 'ulugol-merkez', 'Ulugöl Merkez', 'legacy_static', '2025-01-01 00:00:00', 344, '${PREV}', '${PREV}'),
      (102, 'ilgisiz-proje', 'İlgisiz Proje', 'legacy_static', '2026-01-01 00:00:00', NULL, '${PREV}', '${PREV}');
    INSERT INTO project_designers (project_id, office_id) VALUES (100, 1), (101, 1), (102, 2);
  `);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, 'x', ?, ?, ?)`).run('u-admin', 'admin@example.com', 'Admin', 'admin', now);
  db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`).run(await sha256Hex('tok-u-admin'), 'u-admin', now, now + 3600_000);
}

const envRef = { env: null };
const req = (uid, path, init = {}) => new Request(`https://mimarlab.com${path}`, {
  ...init, headers: { 'Content-Type': 'application/json', Cookie: `__Host-mimarlab_session=tok-${uid}`, ...(init.headers || {}) },
});
const call = (uid, path, init) => handleSubmissionRoute(req(uid, path, init), envRef.env, new URL(`https://mimarlab.com${path}`));
const officeBody = (extra = {}) => ({
  name: 'Tago Architects', claimed_profile_key: 'Tago Architects', loc: 'İstanbul', cats: 'Mimarlık', yil: 1995, about: 'TAGO',
  founders: ['Gökhan Aktan Altuğ'], team: ['Metin Kılıç'], foundersShown: ['Gökhan Aktan Altuğ'], ...extra,
});
const isPreview = (db, table, id) => !!db.prepare(`SELECT preview_at FROM ${table} WHERE id = ?`).get(id).preview_at;
const isLive = (db, table, id) => { const r = db.prepare(`SELECT hidden_at, preview_at FROM ${table} WHERE id = ?`).get(id); return !r.hidden_at && !r.preview_at; };
const project = (db, id) => db.prepare(`SELECT relisted_at, display_order FROM projects WHERE id = ?`).get(id);

section('madde 2 — firma telif beyanıyla yayına alınınca projeleri + kişileri de yayına çıkar');

await test('firma-ekle kaydı (beyanlı): firma + dört kaynağın hepsinden gelen kişiler + projeleri yayında', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  const res = await call('u-admin', '/api/offices', { method: 'POST', body: JSON.stringify(officeBody({ rightsAccepted: true })) });
  assert.equal(res.status, 201, await res.clone().text());
  assert.ok(isLive(db, 'offices', 1), 'firma yayında olmalı');
  for (const [id, why] of [[10, 'office_founders kurucusu'], [11, 'office_founders Ekip Lideri'], [12, 'yalnızca architects.office_id'], [13, 'yalnızca Ekip metni']]) {
    assert.ok(isLive(db, 'architects', id), `${why} (id ${id}) yayında olmalı`);
  }
  assert.ok(isLive(db, 'projects', 100) && isLive(db, 'projects', 101), 'firmanın projeleri yayında olmalı');
  assert.ok(isPreview(db, 'architects', 14), 'başka firmanın kişisine dokunulmamalı');
  assert.ok(isPreview(db, 'projects', 102), 'başka firmanın projesine dokunulmamalı');
  assert.ok(isPreview(db, 'offices', 2), 'başka firmaya dokunulmamalı');
});

await test('"son paylaşılan proje 1. sıraya": en son yayınlanan damgalanır, display_order temizlenir; diğeri doğal sırasına', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await call('u-admin', '/api/offices', { method: 'POST', body: JSON.stringify(officeBody({ rightsAccepted: true })) });
  const top = project(db, 101);
  assert.ok(top.relisted_at, 'en son yayınlanan proje relisted_at almalı');
  assert.equal(top.display_order, null, 'eski display_order (344) temizlenmeli — yoksa relisted_at onu 1. sıraya taşıyamaz');
  assert.equal(project(db, 100).relisted_at, null, 'partideki diğer proje doğal sırasına düşmeli (kümelenme yok)');
});

await test('admin BEYANSIZ kaydeder: firma blurlu kalır, graf HİÇ yürümez', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  const res = await call('u-admin', '/api/offices', { method: 'POST', body: JSON.stringify(officeBody()) });
  assert.equal(res.status, 201, await res.clone().text());
  assert.ok(isPreview(db, 'offices', 1), 'firma önizlemede kalmalı');
  for (const id of [10, 11, 12, 13]) assert.ok(isPreview(db, 'architects', id), `kişi ${id} önizlemede kalmalı`);
  for (const id of [100, 101]) assert.ok(isPreview(db, 'projects', id), `proje ${id} önizlemede kalmalı`);
});

await test('ZATEN CANLI firmayı kaydetmek grafı tetiklemez (önizlemedeki kişiler olduğu gibi kalır)', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  db.exec(`UPDATE offices SET hidden_at = NULL, preview_at = NULL WHERE id = 1`);
  await call('u-admin', '/api/offices', { method: 'POST', body: JSON.stringify(officeBody({ rightsAccepted: true })) });
  assert.ok(isPreview(db, 'architects', 10), 'canlı firma kaydı kişileri açmamalı — tetikleyici önizlemeden çıkıştır');
});

await test('admin paneli Arşiv > "Yayınla" (runContentAction publish) da AYNI grafı yürütür', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  const now = Date.now();
  db.prepare(`INSERT INTO office_submissions (id, owner_user_id, status, created_at, updated_at, name, claimed_profile_key, founders, team) VALUES (?, 'u-admin', 'archived', ?, ?, ?, ?, ?, ?)`)
    .run('os-tago', now, now, 'Tago Architects', 'Tago Architects', '["Gökhan Aktan Altuğ"]', '["Metin Kılıç"]');
  const res = await runContentAction(envRef.env, { id: 'u-admin', role: 'admin' }, { type: 'offices', action: 'publish', id: 'os-tago' });
  assert.equal(res.status, 200, await res.clone().text());
  assert.ok(isLive(db, 'offices', 1), 'firma yayında olmalı');
  for (const id of [10, 11, 12, 13]) assert.ok(isLive(db, 'architects', id), `kişi ${id} yayında olmalı`);
  assert.ok(isLive(db, 'projects', 101), 'proje yayında olmalı');
  assert.ok(project(db, 101).relisted_at, 'en son proje 1. sıraya');
});

section('ek — Ekip Lideri firma popup\'ında Ekip bölümünde');

await test('office_founders ile bağlı Ekip Lideri Kurucular\'da DEĞİL, Ekip\'te (slug\'lı, tıklanabilir)', async () => {
  const db = freshDb(); await seed(db);
  const payload = await buildOfficePayload({ DB: d1(db) }, 'tago-architects');
  const founderNames = payload.founders.map(f => f.name);
  assert.ok(founderNames.includes('Gökhan Aktan Altuğ'), 'Kurucu Ortak Kurucular\'da kalmalı');
  assert.ok(!founderNames.includes('Müge Eker Eryakar'), 'Ekip Lideri Kurucular\'da olmamalı');
  const muge = payload.team.find(t => t.name === 'Müge Eker Eryakar');
  assert.ok(muge, 'Ekip Lideri Ekip\'te olmalı');
  assert.equal(muge.role, 'Ekip Lideri');
  assert.equal(muge.slug, 'muge-eker-eryakar', 'gerçek kişi profili — kart /kisi/:slug\'a bağlanmalı');
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) process.exit(1);
