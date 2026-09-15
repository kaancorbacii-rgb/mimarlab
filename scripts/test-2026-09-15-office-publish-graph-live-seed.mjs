#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-15 (on birinci tur) — BİRİM TESTLERİ
//   "Admin hesabından bir firmanın düzenle sayfasına girip telif butonunu işaretleyerek kaydedip
//    yayınlayarak blurdan kurtarınca o firmaya ait kişiler ve projeler de blurdan kalkarak
//    yayınlanmış olsun. Yani sanki firmaya bir yönetici atanmış gibi tüm içerik otomatik olarak
//    yayınlansın."
//
// KÖK NEDEN (ölçüldü — bu dosyadaki ilk test onu doğrudan karşılaştırır): yayın grafı (src/routes/
// admin.js#activateProfileGraph) ATAMA ile YAYINLAMA yollarında AYNI, ama SEED'leri ayrışıyordu:
//   * atama (activateClaimedProfile)      -> anahtarla eşleşen TÜM profiller,
//   * yayınlama (previewProfileIdsByKeys) -> YALNIZCA o an ÖNİZLEMEDEKİ profiller.
// Firma zaten canlıyken (graf 2026-09-11'de eklenmeden önce yayına alınmış kayıtlar — bkz.
// src/lib/archiveSync.js'in 62 satırlık canlı bulgusu) künyesindeki kişi/projeler önizlemede asılı
// kalıyor, admin'in düzenle sayfasındaki telif beyanlı kaydetmesi onları AÇMIYORDU.
//
// Çözüm TEK yerde: src/routes/admin.js#publishGraphSeeds({ includeLive }) + çağıranın kapısı
// src/routes/submissions.js#adminOfficePublishSave. scripts/test-2026-09-11-office-publish-cascade.mjs
// ile AYNI fikstür deseni (o dosya grafın KENDİSİNİ, bu dosya SEED kuralını kelepçeler).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { handleSubmissionRoute } from '../src/routes/submissions.js';
import { handleAdminRoute } from '../src/routes/admin.js';

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

// FİRMA ZATEN CANLI (bu turun konusu), künyesindeki kişi + projeler ÖNİZLEMEDE (blurlu).
//   10 Gökhan Aktan Altuğ   office_founders + architects.office_id
//   13 Metin Kılıç          YALNIZCA firma taslağının Ekip METNİNDE (yapısal bağ yok)
//   14 İlgisiz Mimar        başka firmada — dokunulmamalı
//   100 (eski) · 101 (yılca en yeni) firmanın; 102 başka firmanın
async function seed(db) {
  const now = Date.now();
  db.exec(`
    INSERT INTO offices (id, slug, name, loc, cats, source, legacy_key, hidden_at, preview_at) VALUES
      (1, 'tago-architects', 'Tago Architects', 'İstanbul', '"Mimarlık"', 'legacy_static', 'Tago Architects', NULL, NULL),
      (2, 'baska-ofis', 'Başka Ofis', 'İstanbul', '"Mimarlık"', 'legacy_static', 'Başka Ofis', '${PREV}', '${PREV}');
    INSERT INTO architects (id, slug, name, position, office_id, source, legacy_key, hidden_at, preview_at) VALUES
      (10, 'gokhan-aktan-altug', 'Gökhan Aktan Altuğ', 'Kurucu Ortak', 1, 'legacy_static', 'Gökhan Aktan Altuğ', '${PREV}', '${PREV}'),
      (13, 'metin-kilic', 'Metin Kılıç', NULL, NULL, 'legacy_static', 'Metin Kılıç', '${PREV}', '${PREV}'),
      (14, 'ilgisiz-mimar', 'İlgisiz Mimar', 'Kurucu', 2, 'legacy_static', 'İlgisiz Mimar', '${PREV}', '${PREV}');
    INSERT INTO office_founders (office_id, architect_id) VALUES (1, 10), (2, 14);
    INSERT INTO projects (id, slug, title, source, project_date, publish_date, display_order, hidden_at, preview_at) VALUES
      (100, 'maya-rezidans', 'Maya Rezidans', 'legacy_static', '2015', '2020-01-01 00:00:00', 344, '${PREV}', '${PREV}'),
      (101, 'ulugol-merkez', 'Ulugöl Merkez', 'legacy_static', '2024', '2019-01-01 00:00:00', 898, '${PREV}', '${PREV}'),
      (102, 'ilgisiz-proje', 'İlgisiz Proje', 'legacy_static', '2026', '2026-01-01 00:00:00', NULL, '${PREV}', '${PREV}');
    INSERT INTO project_designers (project_id, office_id) VALUES (100, 1), (101, 1), (102, 2);
  `);
  for (const [id, email, name, role] of [['u-admin', 'admin@example.com', 'Admin', 'admin'], ['u-uye', 'uye@example.com', 'Üye', 'user']]) {
    db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, 'x', ?, ?, ?)`).run(id, email, name, role, now);
    db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`).run(await sha256Hex(`tok-${id}`), id, now, now + 3600_000);
  }
  // Firmanın MEVCUT taslağı — Metin Kılıç YALNIZCA burada, Ekip METNİNDE geçiyor (yapısal bağı yok).
  // Grafın dördüncü kişi kaynağı (admin.js#architectIdsFromOfficeDraftNames) bunu okur; iki yolun
  // karşılaştırması dürüst olsun diye ATAMA yolunda da hazır bulunmalı — aksi halde atama tarafı
  // taslağı hiç göremez, telif beyanlı kaydetme ise kendi yazdığı taslağı görürdü.
  db.prepare(`INSERT INTO office_submissions (id, owner_user_id, status, created_at, updated_at, name, claimed_profile_key, founders, team, loc, cats, about) VALUES (?, 'u-admin', 'approved', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('os-tago', now, now, 'Tago Architects', 'Tago Architects', '["Gökhan Aktan Altuğ"]', '["Metin Kılıç"]', 'İstanbul', '"Mimarlık"', 'TAGO');
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

// Firmanın düzenle sayfasındaki telif beyanlı kaydetme (?claim= ile İLK kaydetme -> POST).
const telifKaydet = (uid = 'u-admin', extra = {}) =>
  call(uid, '/api/offices', { method: 'POST', body: JSON.stringify(officeBody({ rightsAccepted: true, ...extra })) });

section('kök neden — atama ile telif beyanlı kaydetme AYNI sonucu vermeli');

await test('AYRIŞMA KAPANDI: canlı firmada iki yol da kişi + projeleri yayına alır', async () => {
  // A) Yönetici ataması (referans davranış).
  const dbA = freshDb(); await seed(dbA); envRef.env = { DB: d1(dbA) };
  const p = '/api/admin/claims';
  const resA = await handleAdminRoute(
    req('u-admin', p, { method: 'POST', body: JSON.stringify({ userId: 'u-uye', profileType: 'office', profileKey: 'Tago Architects' }) }),
    envRef.env, new URL(`https://mimarlab.com${p}`));
  assert.equal(resA.status, 200, await resA.clone().text());
  const atama = [isLive(dbA, 'architects', 10), isLive(dbA, 'architects', 13), isLive(dbA, 'projects', 100), isLive(dbA, 'projects', 101)];

  // B) Firmanın düzenle sayfasından telif beyanlı kaydetme — AYNI fikstür.
  const dbB = freshDb(); await seed(dbB); envRef.env = { DB: d1(dbB) };
  const resB = await telifKaydet();
  assert.equal(resB.status, 201, await resB.clone().text());
  const kaydet = [isLive(dbB, 'architects', 10), isLive(dbB, 'architects', 13), isLive(dbB, 'projects', 100), isLive(dbB, 'projects', 101)];

  assert.deepEqual(atama, [true, true, true, true], 'atama referansı: her şey yayına gelmeli');
  assert.deepEqual(kaydet, atama, 'telif beyanlı kaydetme atamayla AYNI kümeyi yayına almalı');
});

await test('kapsam: yalnızca BU firmanın künyesi — başka firma ve içeriği önizlemede kalır', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await telifKaydet();
  assert.ok(isPreview(db, 'offices', 2), 'başka firma önizlemede kalmalı');
  assert.ok(isPreview(db, 'architects', 14), 'başka firmanın kişisi önizlemede kalmalı');
  assert.ok(isPreview(db, 'projects', 102), 'başka firmanın projesi önizlemede kalmalı');
});

await test('yılca en yeni proje 1. sıraya: relisted_at damgalanır, eski display_order temizlenir', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await telifKaydet();
  const top = project(db, 101); // 2024 — publish_date daha ESKİ olsa da yıl kazanır
  assert.ok(top.relisted_at, 'yılca en yeni proje relisted_at almalı');
  assert.equal(top.display_order, null, 'eski toplu-import display_order (898) temizlenmeli');
});

section('daraltmalar — genişletilen seed nerede AÇILMAZ');

await test('admin BEYANSIZ kaydeder: hiçbir şey yayına alınmaz', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  const res = await call('u-admin', '/api/offices', { method: 'POST', body: JSON.stringify(officeBody()) });
  assert.equal(res.status, 201, await res.clone().text());
  for (const id of [10, 13]) assert.ok(isPreview(db, 'architects', id), `kişi ${id} önizlemede kalmalı`);
  for (const id of [100, 101]) assert.ok(isPreview(db, 'projects', id), `proje ${id} önizlemede kalmalı`);
});

await test('ADMIN OLMAYAN yetkili beyanla kaydeder: canlı firmada graf YÜRÜMEZ (eski kural)', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  const now = Date.now();
  // Üyeye firmanın onaylı yetkisi verilir — yetki kapısı geçilsin, kapanan tek şey seed genişlemesi olsun.
  db.prepare(`INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at, office_position) VALUES (?, ?, 'office', ?, 'approved', ?, ?, ?)`)
    .run('pc-1', 'u-uye', 'Tago Architects', now, now, 'Yönetici');
  const res = await telifKaydet('u-uye');
  assert.ok(res.status < 400, await res.clone().text());
  assert.ok(isPreview(db, 'architects', 10), 'üye kaydı canlı firmanın kişilerini açmamalı');
  assert.ok(isPreview(db, 'projects', 101), 'üye kaydı canlı firmanın projelerini açmamalı');
});

await test('KİŞİ tipinde açılmaz: canlı bir mimarın beyanlı kaydı grafı yürütmez', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  db.exec(`UPDATE architects SET hidden_at = NULL, preview_at = NULL WHERE id = 10`);
  const res = await call('u-admin', '/api/architects', {
    method: 'POST',
    body: JSON.stringify({ name: 'Gökhan Aktan Altuğ', claimed_profile_key: 'Gökhan Aktan Altuğ', about: 'Mimar', office: 'Tago Architects', rightsAccepted: true }),
  });
  assert.equal(res.status, 201, await res.clone().text());
  assert.ok(isPreview(db, 'projects', 101), 'kişi dalı eski (önizlemeden çıkış) kuralında kalmalı');
});

section('promosyon kapısı — rutin admin düzenlemesi sıralamayı bozmamalı');

await test('her şey ZATEN canlıyken beyanlı kaydetme hiçbir projeyi 1. sıraya taşımaz', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  db.exec(`UPDATE architects SET hidden_at = NULL, preview_at = NULL;
           UPDATE projects SET hidden_at = NULL, preview_at = NULL;
           UPDATE offices SET hidden_at = NULL, preview_at = NULL;`);
  const res = await telifKaydet();
  assert.equal(res.status, 201, await res.clone().text());
  assert.equal(project(db, 101).relisted_at, null, 'yayına giren hiçbir şey yokken promosyon çalışmamalı');
  assert.equal(project(db, 101).display_order, 898, 'display_order da korunmalı');
});

await test('promosyon kapısı ATAMA yolunu DEĞİŞTİRMEZ (her şey canlıyken bile 1. sıra verilir)', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  db.exec(`UPDATE architects SET hidden_at = NULL, preview_at = NULL;
           UPDATE projects SET hidden_at = NULL, preview_at = NULL;
           UPDATE offices SET hidden_at = NULL, preview_at = NULL;`);
  const p = '/api/admin/claims';
  const res = await handleAdminRoute(
    req('u-admin', p, { method: 'POST', body: JSON.stringify({ userId: 'u-uye', profileType: 'office', profileKey: 'Tago Architects' }) }),
    envRef.env, new URL(`https://mimarlab.com${p}`));
  assert.equal(res.status, 200, await res.clone().text());
  assert.ok(project(db, 101).relisted_at, 'atama, içerik zaten canlı olsa da en yeni projeyi 1. sıraya koymalı');
});

await test('promosyon PROFİL BAŞINA BİR KEZ: ikinci beyanlı kaydetme tekrar damgalamaz', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await telifKaydet();
  const ilk = project(db, 101).relisted_at;
  assert.ok(ilk, 'ilk kaydetme damgalamalı');
  db.exec(`UPDATE projects SET relisted_at = NULL WHERE id = 101`);
  await telifKaydet();
  assert.equal(project(db, 101).relisted_at, null, 'projects_promoted_at damgası ikinci promosyonu engellemeli');
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
process.exit(failed ? 1 : 0);
