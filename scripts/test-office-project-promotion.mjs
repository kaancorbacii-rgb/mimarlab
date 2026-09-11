#!/usr/bin/env node
// FİRMAYA KULLANICI ATANINCA EN SON YAYINLANAN PROJENİN 1. SIRAYA GEÇMESİ — BİRİM TESTLERİ
// (kullanıcı isteği, 2026-09-11: "Bir firmanın profiline bir kullanıcı atandığı zaman en son
// yayınlanan projelerini proje sayfasında 1. sıraya koy sanki yeni yayınlanmış gibi. Örneğin en
// son Per Se Mimarlık'a en son yönetici/kurucu atadık. Perse'nin son yayınlanan projesini proje
// sayfasında ilk sıraya koy. Diğerlerini diğer sayfalara dağıt ama çok arka sayfalarda olmasınlar.")
//
// scripts/test-claim-activation-cascade.mjs İLE AYNI desen ve AYNI D1 shim'i, ama o test yalnızca
// ÖNİZLEMEDEN (preview_at DOLU) yayına geçen kayıtları kapsıyor — buradaki senaryo firmanın
// projeleri ZATEN CANLIYKEN (Per Se Mimarlık gibi) bir atama yapılması. Kural TEK yerde:
// src/routes/admin.js#promoteOfficeProjectsOnAssignment (activateClaimedProfile'dan çağrılır).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { handleAdminRoute } from '../src/routes/admin.js';
import { sha256Hex } from '../src/lib/crypto.js';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
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

// Per Se Mimarlık — ZATEN CANLI bir firma, eski tarihlerde yayınlanmış DÖRT projesi var (hepsi
// preview_at NULL). İlgisiz Firma da canlı, kendi tek projesiyle — atama bunu ETKİLEMEMELİ.
//
// perse-en-yeni'ye ve ilgisiz-proje'ye BİLEREK gerçek (NULL olmayan) bir display_order verilir —
// GERÇEK CANLI BULGUYU birebir üretir (kullanıcı bildirimi, 2026-09-11: "Per Se'nin son projesini
// elle 1. sıraya al" — relisted_at damgalanmasına RAĞMEN proje 1. sıraya gelmedi, çünkü ORDER BY
// display_order'ı relisted_at'ten ÖNCE karşılaştırıyor ve 2026-09-04 toplu backfill'inden kalma
// display_order=898 gibi bir değer görece küçük başka display_order'lı 140 satırın ARKASINDA
// kalmasına neden oluyordu). ilgisiz-proje'nin display_order'ı (5) perse-en-yeni'ninkinden (898)
// KASITLI olarak KÜÇÜK — fix olmasaydı ilgisiz-proje her zaman önde kalırdı.
function seed(db) {
  db.exec(`
    INSERT INTO offices (slug, name, loc, cats, source) VALUES
      ('per-se-mimarlik', 'Per Se Mimarlık', 'İstanbul', '["Mimarlık"]', 'legacy_static'),
      ('ilgisiz-firma', 'İlgisiz Firma', 'Ankara', '["Mimarlık"]', 'legacy_static');
    INSERT INTO architects (slug, name, source) VALUES ('yeni-yonetici', 'Yeni Yönetici', 'legacy_static');
    INSERT INTO projects (slug, title, source, publish_date, created_at, display_order) VALUES
      ('perse-en-eski', 'Per Se En Eski', 'legacy_static', '2018-01-01T00:00:00.000Z', '2018-01-01T00:00:00.000Z', 1200),
      ('perse-orta-1', 'Per Se Orta 1', 'legacy_static', '2019-01-01T00:00:00.000Z', '2019-01-01T00:00:00.000Z', 1100),
      ('perse-orta-2', 'Per Se Orta 2', 'legacy_static', '2020-06-01T00:00:00.000Z', '2020-06-01T00:00:00.000Z', 1000),
      ('perse-en-yeni', 'Per Se En Yeni', 'legacy_static', '2021-01-01T00:00:00.000Z', '2021-01-01T00:00:00.000Z', 898),
      ('ilgisiz-proje', 'İlgisiz Proje', 'legacy_static', '2021-01-01T00:00:00.000Z', '2021-01-01T00:00:00.000Z', 5);
    INSERT INTO project_designers (project_id, office_id) VALUES (1, 1), (2, 1), (3, 1), (4, 1), (5, 2);
  `);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u-yeni', 'yeni@example.com', 'x', 'Yeni Yönetici', 'user', ?)`).run(Date.now());
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u-admin', 'admin@example.com', 'x', 'Admin', 'admin', ?)`).run(Date.now());
}

async function withSession(db, uid) {
  const now = Date.now();
  db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .run(await sha256Hex(`tok-${uid}`), uid, now, now + 3600_000);
}
const adminReq = (path, init = {}) => new Request(`https://mimarlab.com${path}`, {
  ...init,
  headers: { 'Content-Type': 'application/json', Cookie: '__Host-mimarlab_session=tok-u-admin', ...(init.headers || {}) },
});
async function assignOffice(env, profileKey = 'Per Se Mimarlık') {
  const url = new URL('https://mimarlab.com/api/admin/claims');
  return handleAdminRoute(adminReq(url.pathname, {
    method: 'POST', body: JSON.stringify({ userId: 'u-yeni', profileType: 'office', profileKey }),
  }), env, url);
}
function relistedAt(db, slug) {
  return db.prepare(`SELECT relisted_at FROM projects WHERE slug = ?`).get(slug).relisted_at;
}

section('firmaya kullanıcı atanınca EN SON YAYINLANAN proje proje sayfasında 1. sıraya geçer');

await test('atama BAŞARILI (200)', async () => {
  const db = freshDb(); seed(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  const res = await assignOffice(env);
  assert.equal(res.status, 200, await res.text());
});

await test('firmanın EN SON YAYINLANAN projesi relisted_at=şimdi alır (1. sıra)', async () => {
  const db = freshDb(); seed(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  const before = Date.now();
  await assignOffice(env);
  const after = Date.now();
  const ts = new Date(relistedAt(db, 'perse-en-yeni')).getTime();
  assert.ok(ts >= before - 1000 && ts <= after + 1000, `relisted_at şimdiki zamana yakın olmalı, geldi: ${ts}`);
});

await test('firmanın DİĞER canlı projeleri de relisted_at alır (dağıtılır), ama HEPSİ AYNI ANDA DEĞİL', async () => {
  const db = freshDb(); seed(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  await assignOffice(env);
  const top = relistedAt(db, 'perse-en-yeni');
  const r1 = relistedAt(db, 'perse-orta-2');
  const r2 = relistedAt(db, 'perse-orta-1');
  const r3 = relistedAt(db, 'perse-en-eski');
  assert.ok(r1 && r2 && r3, 'diğer üç proje de relisted_at almalı');
  // Sırayla (en yeni yayınlanandan en eskiye) AZALAN relisted_at — kümelenme yerine dağılım.
  assert.ok(top > r1, `1. sıra (${top}) en yakın diğerinden (${r1}) daha yeni olmalı`);
  assert.ok(r1 > r2, `${r1} > ${r2} olmalı (yayın tarihi sırası korunmalı)`);
  assert.ok(r2 > r3, `${r2} > ${r3} olmalı`);
});

await test('İLGİSİZ firmanın projesi ETKİLENMEZ', async () => {
  const db = freshDb(); seed(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  await assignOffice(env);
  assert.equal(relistedAt(db, 'ilgisiz-proje'), null);
});

await test('1. sıraya alınan projenin ESKİ display_order\'ı temizlenir (GERÇEK BULGU regresyonu)', async () => {
  const db = freshDb(); seed(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  await assignOffice(env);
  const row = db.prepare(`SELECT display_order FROM projects WHERE slug = 'perse-en-yeni'`).get();
  assert.equal(row.display_order, null, 'display_order NULL olmalı, aksi halde relisted_at hiç işe yaramaz');
});

await test('display_order daha KÜÇÜK ama İLGİSİZ bir proje artık ÖNÜNE GEÇEMİYOR', async () => {
  const db = freshDb(); seed(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  await assignOffice(env);
  const { fetchActiveProjectPool } = await import('../src/lib/projectPool.js');
  const pool = await fetchActiveProjectPool(env, 'built');
  const idxPerse = pool.findIndex(p => p.slug === 'perse-en-yeni');
  const idxIlgisiz = pool.findIndex(p => p.slug === 'ilgisiz-proje');
  assert.ok(idxPerse < idxIlgisiz, `perse-en-yeni (display_order=898) ilgisiz-proje'den (display_order=5) ÖNCE olmalı; sıra: perse=${idxPerse} ilgisiz=${idxIlgisiz}`);
});

await test('proje havuzu sıralamasında (fetchActiveProjectPool ile aynı ORDER BY) firma projesi GERÇEKTEN 1. sırada çıkıyor', async () => {
  const db = freshDb(); seed(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  await assignOffice(env);
  const { fetchActiveProjectPool } = await import('../src/lib/projectPool.js');
  const pool = await fetchActiveProjectPool(env, 'built');
  assert.equal(pool[0].slug, 'perse-en-yeni', `beklenen ilk sırada perse-en-yeni, gelen: ${pool[0].slug}`);
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) { for (const f of failures) console.error(` - ${f.name}: ${f.message}`); process.exit(1); }
