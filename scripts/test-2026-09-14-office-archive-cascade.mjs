#!/usr/bin/env node
// FİRMA/MARKA ARŞİVLENİNCE KİŞİ + PROJE + ÜRÜN CASCADE'İ — BİRİM TESTLERİ
// (kullanıcı isteği, 2026-09-14: "admin bir firmayı ya da markayı arşivlerse o firma ve markaya ait
// kişiler, projeler ve ürünler otomatik olarak arşivlensin".)
//
// Kapsam ve gerekçeler: src/lib/officeArchiveCascade.js ve
// src/routes/legacyContent.js#archiveOfficeGraph dosya başları.
//
// scripts/test-2026-09-12-archive-live-guard.mjs İLE AYNI desen: gerçek schema.sql'e karşı
// node:sqlite D1 shim'i, canlı kodun kendisi çağrılır (mock yok).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { runContentAction } from '../src/routes/legacyContent.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 8).join('\n       ')}`); }
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

const ADMIN = { id: 'u-admin', role: 'admin' };
const UYE = { id: 'u-uye', role: 'user' };

// SENARYO — "Ofist" firması + hâlâ yayında kalacak ikinci bir firma ("Başka Firma"):
//   kişiler : Kurucu A (office_founders), Üye B (architects.office_id), Ortak C (HEM Ofist HEM
//             Başka Firma'nın kurucusu -> ORTAK KÜNYE KORUMASI, arşivlenmemeli)
//   projeler: Tek Künyeli (yalnız Ofist), Ortak Proje (Ofist + Başka Firma -> korunmalı),
//             Kişi Projesi (yalnızca Kurucu A'nın künyesinde)
//   ürünler : Marka Ürünü (brand_office_id = Ofist), Ad Eşleşmeli (brand_name_raw = 'Ofist'),
//             Yabancı Marka (markası Başka Firma ama künyesinde Kurucu A var -> korunmalı)
function freshEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES
    ('u-admin', 'a@example.com', 'Admin', 'x', 'admin', 1000),
    ('u-uye', 'm@example.com', 'Uye', 'x', 'user', 1000)`);

  db.exec(`INSERT INTO offices (id, slug, name, cats, source) VALUES
    (1, 'ofist', 'Ofist', '["Mimarlık"]', 'admin'),
    (2, 'baska-firma', 'Başka Firma', '["Mimarlık"]', 'admin')`);
  db.exec(`INSERT INTO architects (id, slug, name, source, office_id) VALUES
    (1, 'kurucu-a', 'Kurucu A', 'admin', NULL),
    (2, 'uye-b', 'Üye B', 'admin', 1),
    (3, 'ortak-c', 'Ortak C', 'admin', NULL)`);
  db.exec(`INSERT INTO office_founders (office_id, architect_id) VALUES (1, 1), (1, 3), (2, 3)`);

  db.exec(`INSERT INTO projects (id, slug, title, source) VALUES
    (1, 'tek-kunyeli', 'Tek Künyeli', 'admin'),
    (2, 'ortak-proje', 'Ortak Proje', 'admin'),
    (3, 'kisi-projesi', 'Kişi Projesi', 'admin')`);
  db.exec(`INSERT INTO project_designers (project_id, office_id) VALUES (1, 1), (2, 1), (2, 2)`);
  db.exec(`INSERT INTO project_designers (project_id, architect_id) VALUES (3, 1)`);

  db.exec(`INSERT INTO products (id, slug, kind, title, brand_office_id, brand_name_raw, source) VALUES
    (1, 'marka-urunu', 'product', 'Marka Ürünü', 1, 'Ofist', 'admin'),
    (2, 'ad-eslesmeli', 'material', 'Ad Eşleşmeli', NULL, 'Ofist', 'admin'),
    (3, 'yabanci-marka', 'product', 'Yabancı Marka', 2, 'Başka Firma', 'admin')`);
  db.exec(`INSERT INTO product_architects (product_id, architect_id) VALUES (3, 1)`);

  return { db, env: { DB: d1(db) } };
}

const hidden = (db, table, id) => db.prepare(`SELECT hidden_at, preview_at FROM ${table} WHERE id = ?`).get(id);
const isArchived = (db, table, id) => { const r = hidden(db, table, id); return !!r.hidden_at && !r.preview_at; };

async function archiveOfist(env, user = ADMIN) {
  const res = await runContentAction(env, user, { type: 'offices', action: 'archive', key: 'Ofist' });
  assert.ok(res.status < 400, `arşivleme başarısız: ${res.status}`);
  return res.json();
}

console.log('\nFirma/marka arşiv cascade\'i\n');

await test('firmanın kendisi arşivlenir (tam arşiv: hidden_at dolu, preview_at boş)', async () => {
  const { db, env } = freshEnv();
  await archiveOfist(env);
  assert.ok(isArchived(db, 'offices', 1), 'Ofist arşivde değil');
});

await test('firmadaki kişiler arşivlenir (office_founders VE architects.office_id bağları)', async () => {
  const { db, env } = freshEnv();
  await archiveOfist(env);
  assert.ok(isArchived(db, 'architects', 1), 'Kurucu A (office_founders) arşivlenmedi');
  assert.ok(isArchived(db, 'architects', 2), 'Üye B (office_id) arşivlenmedi');
});

await test('firmanın künyeli projeleri arşivlenir', async () => {
  const { db, env } = freshEnv();
  await archiveOfist(env);
  assert.ok(isArchived(db, 'projects', 1), 'Tek Künyeli proje arşivlenmedi');
});

await test('kişinin künyesindeki proje de arşivlenir (yayın grafıyla simetri)', async () => {
  const { db, env } = freshEnv();
  await archiveOfist(env);
  assert.ok(isArchived(db, 'projects', 3), 'Kişi Projesi arşivlenmedi');
});

await test('markanın ürünleri arşivlenir (brand_office_id VE marka adı eşleşmesi)', async () => {
  const { db, env } = freshEnv();
  await archiveOfist(env);
  assert.ok(isArchived(db, 'products', 1), 'Marka Ürünü (brand_office_id) arşivlenmedi');
  assert.ok(isArchived(db, 'products', 2), 'Ad Eşleşmeli (brand_name_raw) arşivlenmedi');
});

// --- ORTAK KÜNYE KORUMASI (arşivlemenin yayına almadan TEK farkı) -------------------------------
await test('hâlâ yayında olan başka bir firmanın ORTAK projesi arşivlenmez', async () => {
  const { db, env } = freshEnv();
  const body = await archiveOfist(env);
  assert.ok(!isArchived(db, 'projects', 2), 'Ortak Proje arşivlendi — Başka Firma hâlâ yayında');
  assert.ok(body.cascade.skipped.projects.includes('Ortak Proje'), 'atlanan proje raporlanmadı');
});

await test('iki firmada birden görünen kişi arşivlenmez', async () => {
  const { db, env } = freshEnv();
  const body = await archiveOfist(env);
  assert.ok(!isArchived(db, 'architects', 3), 'Ortak C arşivlendi — Başka Firma hâlâ yayında');
  assert.ok(body.cascade.skipped.architects.includes('Ortak C'), 'atlanan kişi raporlanmadı');
});

await test('markası başka (yayındaki) bir firma olan ürün arşivlenmez', async () => {
  const { db, env } = freshEnv();
  const body = await archiveOfist(env);
  assert.ok(!isArchived(db, 'products', 3), 'Yabancı Marka ürünü arşivlendi');
  assert.ok(body.cascade.skipped.products.includes('Yabancı Marka'), 'atlanan ürün raporlanmadı');
});

await test('öteki firma da arşivdeyse koruma kalkar, ortak proje de arşivlenir', async () => {
  const { db, env } = freshEnv();
  db.exec(`UPDATE offices SET hidden_at = '2026-09-01' WHERE id = 2`);
  await archiveOfist(env);
  assert.ok(isArchived(db, 'projects', 2), 'Ortak Proje arşivlenmedi');
  assert.ok(isArchived(db, 'architects', 3), 'Ortak C arşivlenmedi');
});

// --- GERİ ALINABİLİRLİK ------------------------------------------------------------------------
await test('her arşivlenen kayıt için geri alınabilir taslak oluşur (Arşivim > Yayına Al)', async () => {
  const { db, env } = freshEnv();
  await archiveOfist(env);
  const proj = db.prepare(`SELECT status FROM project_submissions WHERE claimed_slug = 'tek-kunyeli'`).get();
  assert.equal(proj && proj.status, 'archived', 'proje taslağı oluşmadı');
  const kisi = db.prepare(`SELECT status FROM architect_submissions WHERE claimed_profile_key = 'Kurucu A'`).get();
  assert.equal(kisi && kisi.status, 'archived', 'kişi taslağı oluşmadı');
  // 'Ad Eşleşmeli' bir MALZEME — taslağı material_submissions'a düşmeli, product_submissions'a değil.
  const malz = db.prepare(`SELECT status FROM material_submissions WHERE claimed_slug = 'ad-eslesmeli'`).get();
  assert.equal(malz && malz.status, 'archived', 'malzeme taslağı material_submissions\'a düşmedi');
});

// --- YETKİ / KAPSAM ----------------------------------------------------------------------------
await test('admin OLMAYAN kullanıcı kendi firmasını arşivlerse cascade ÇALIŞMAZ', async () => {
  const { db, env } = freshEnv();
  const res = await runContentAction(env, UYE, { type: 'offices', action: 'archive', key: 'Ofist' });
  assert.ok(res.status < 400);
  assert.ok(isArchived(db, 'offices', 1), 'firma arşivlenmedi');
  assert.ok(!isArchived(db, 'architects', 1), 'üye kullanıcı başkasının profilini arşivledi');
  assert.ok(!isArchived(db, 'projects', 1), 'üye kullanıcı cascade tetikledi');
});

await test('kişi arşivlemek cascade tetiklemez (özyineleme yok)', async () => {
  const { db, env } = freshEnv();
  const res = await runContentAction(env, ADMIN, { type: 'architects', action: 'archive', key: 'Kurucu A' });
  assert.ok(res.status < 400);
  assert.ok(isArchived(db, 'architects', 1), 'kişi arşivlenmedi');
  assert.ok(!isArchived(db, 'offices', 1), 'kişi arşivlemek firmayı da arşivledi');
  assert.ok(!isArchived(db, 'projects', 1), 'kişi arşivlemek firmanın projesini arşivledi');
});

await test('zaten arşivdeki kayıt ikinci turda tekrar işlenmez (idempotans)', async () => {
  const { db, env } = freshEnv();
  await archiveOfist(env);
  const body = await archiveOfist(env);
  assert.deepEqual(body.cascade.archived.projects, [], 'ikinci tur aynı projeleri tekrar arşivledi');
  assert.deepEqual(body.cascade.archived.architects, [], 'ikinci tur aynı kişileri tekrar arşivledi');
});

// Admin panelinin İKİ arşivleme yolu var: firma-ekle/marka-ekle'deki "Arşivle" butonu content-action'a
// `key` ile, admin panelindeki kart ise `id` (gönderi satırının id'si) ile gider. Cascade ikisinde de
// çalışmalı — yukarıdaki testlerin tamamı `key` yolunu sürüyor, bu test `id` yolunu sabitler.
await test('id yolu (admin panel kartı) da cascade tetikler', async () => {
  const { db, env } = freshEnv();
  db.exec(`INSERT INTO office_submissions (id, name, status, claimed_profile_key, owner_user_id, created_at, updated_at)
           VALUES ('sub-ofist', 'Ofist', 'approved', 'Ofist', 'u-admin', 1000, 1000)`);
  const res = await runContentAction(env, ADMIN, { type: 'offices', action: 'archive', id: 'sub-ofist' });
  assert.ok(res.status < 400, `arşivleme başarısız: ${res.status}`);
  assert.ok(isArchived(db, 'offices', 1), 'firma arşivlenmedi');
  assert.ok(isArchived(db, 'projects', 1), 'id yolunda proje cascade\'i çalışmadı');
  assert.ok(isArchived(db, 'architects', 1), 'id yolunda kişi cascade\'i çalışmadı');
  assert.ok(isArchived(db, 'products', 1), 'id yolunda ürün cascade\'i çalışmadı');
});

console.log(`\n${passed} geçti, ${failed} başarısız\n`);
process.exit(failed ? 1 : 0);
