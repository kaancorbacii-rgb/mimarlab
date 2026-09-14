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
//
// Dosyanın SON bölümü promosyonun PROFİL BAŞINA BİR KEZ çalışmasını kapsar (kullanıcı isteği,
// 2026-09-14: "Bir firmaya daha önce bir yönetici atanmışsa ... firmaya tekrar yeni bir yönetici
// atanınca firmanın son projesini tekrar proje sayfasında 1. sıraya koymana gerek yok.") —
// bkz. src/routes/admin.js#profilesPromotedBefore ve migrations/0118_projects_promoted_at.sql.
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

section('firma ÖNİZLEMEDEYKEN Yönetici atanır (kullanıcı isteği, 2026-09-11 ikinci tur)');

// GERÇEK CANLI VAKA: AAW Ahmet Alataş Workshop'a 'Yönetici' atandı; projeleri önizlemedeydi, en son
// projesi 'merzigo' relisted_at aldı ama display_order=344 kaldığı için proje sayfasında 56. sıradaydı.
// Burada perse-en-yeni BİLEREK en yüksek id'yi TAŞIMIYOR (perse-en-eski'den önce eklendi) — "en son"
// yayın tarihiyle seçilmeli, id ile değil.
const PREV = '2026-09-10T00:00:00.000Z';
function seedPreview(db) {
  db.exec(`
    INSERT INTO offices (slug, name, loc, cats, source, hidden_at, preview_at) VALUES
      ('aaw', 'AAW Ahmet Alataş Workshop', 'İstanbul', '["Mimarlık"]', 'legacy_static', '${PREV}', '${PREV}'),
      ('ilgisiz-firma', 'İlgisiz Firma', 'Ankara', '["Mimarlık"]', 'legacy_static', NULL, NULL);
    INSERT INTO projects (slug, title, source, publish_date, created_at, display_order, hidden_at, preview_at) VALUES
      ('merzigo', 'Merzigo', 'legacy_static', '2026-08-24T00:00:00.000Z', '2026-08-24T00:00:00.000Z', 344, '${PREV}', '${PREV}'),
      ('aaw-eski', 'AAW Eski', 'legacy_static', '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z', 1454, '${PREV}', '${PREV}'),
      ('aaw-canli', 'AAW Canlı', 'legacy_static', '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z', 900, NULL, NULL),
      ('ilgisiz-proje', 'İlgisiz Proje', 'legacy_static', '2021-01-01T00:00:00.000Z', '2021-01-01T00:00:00.000Z', 5, NULL, NULL);
    INSERT INTO project_designers (project_id, office_id) VALUES (1, 1), (2, 1), (3, 1), (4, 2);
  `);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u-yeni', 'yeni@example.com', 'x', 'Yeni Yönetici', 'user', ?)`).run(Date.now());
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u-admin', 'admin@example.com', 'x', 'Admin', 'admin', ?)`).run(Date.now());
}
async function assignManager(env) {
  const url = new URL('https://mimarlab.com/api/admin/claims');
  return handleAdminRoute(adminReq(url.pathname, {
    method: 'POST', body: JSON.stringify({ userId: 'u-yeni', profileType: 'office', profileKey: 'AAW Ahmet Alataş Workshop', officePosition: 'Yönetici' }),
  }), env, url);
}

await test('önizlemedeki firmanın EN SON YAYINLANAN projesi proje havuzunda 1. sırada', async () => {
  const db = freshDb(); seedPreview(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  const res = await assignManager(env);
  assert.equal(res.status, 200, await res.text());
  const { fetchActiveProjectPool } = await import('../src/lib/projectPool.js');
  const pool = await fetchActiveProjectPool(env, 'built');
  assert.equal(pool[0].slug, 'merzigo', `beklenen ilk sırada merzigo, sıra: ${pool.map(p => p.slug).join(', ')}`);
  assert.equal(db.prepare(`SELECT display_order FROM projects WHERE slug = 'merzigo'`).get().display_order, null, 'display_order temizlenmeli');
});

await test('önizlemeden çıkan DİĞER projeler damgalanmaz (partide tek damga), yayına yine de alınır', async () => {
  const db = freshDb(); seedPreview(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  await assignManager(env);
  const eski = db.prepare(`SELECT relisted_at, preview_at, hidden_at FROM projects WHERE slug = 'aaw-eski'`).get();
  assert.equal(eski.relisted_at, null);
  assert.equal(eski.preview_at, null);
  assert.equal(eski.hidden_at, null);
  // ZATEN CANLI olan firma projesi eskisi gibi yayılır (1. sıranın bir gün gerisinde).
  assert.ok(relistedAt(db, 'aaw-canli'), 'zaten canlı firma projesi yayılmalı');
  assert.ok(relistedAt(db, 'merzigo') > relistedAt(db, 'aaw-canli'));
});

section('promosyon PROFİL BAŞINA BİR KEZ (kullanıcı isteği, 2026-09-14)');

// "Bir firmaya daha önce bir yönetici atanmışsa ve yönetici atanınca son eklenen projeleri proje
// sayfasında ilk sıraya oturmuşsa, ya da admin tarafından firmanın bluru kaldırılıp yayına
// alındıysa, firmaya tekrar yeni bir yönetici atanınca firmanın son projesini tekrar proje
// sayfasında 1. sıraya koymana gerek yok."
// Kural TEK yerde: src/routes/admin.js#profilesPromotedBefore + offices/architects
// .projects_promoted_at (bkz. migrations/0118_projects_promoted_at.sql).
function addSecondUser(db) {
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u-ikinci', 'ikinci@example.com', 'x', 'İkinci Yönetici', 'user', ?)`).run(Date.now());
}
async function assignSecondManager(env, profileKey = 'Per Se Mimarlık') {
  const url = new URL('https://mimarlab.com/api/admin/claims');
  return handleAdminRoute(adminReq(url.pathname, {
    method: 'POST', body: JSON.stringify({ userId: 'u-ikinci', profileType: 'office', profileKey }),
  }), env, url);
}
const promotedAt = (db, name) => db.prepare(`SELECT projects_promoted_at FROM offices WHERE name = ?`).get(name).projects_promoted_at;

await test('İLK atama profile projects_promoted_at damgası düşer', async () => {
  const db = freshDb(); seed(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  assert.equal(promotedAt(db, 'Per Se Mimarlık'), null, 'atamadan önce damgasız olmalı');
  await assignOffice(env);
  assert.ok(promotedAt(db, 'Per Se Mimarlık'), 'atamadan sonra damgalanmalı');
  // Atamaya HİÇ girmeyen firma damgalanmaz — kendi ilk ataması hâlâ promosyon almalı.
  assert.equal(promotedAt(db, 'İlgisiz Firma'), null);
});

await test('İKİNCİ yönetici ataması en son projeyi TEKRAR 1. sıraya koymaz', async () => {
  const db = freshDb(); seed(db); addSecondUser(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  await assignOffice(env);
  const before = db.prepare(`SELECT slug, relisted_at, display_order FROM projects ORDER BY slug`).all();
  const res = await assignSecondManager(env);
  assert.equal(res.status, 200, await res.text());
  const after = db.prepare(`SELECT slug, relisted_at, display_order FROM projects ORDER BY slug`).all();
  assert.deepEqual(after, before, 'ikinci atama hiçbir projenin sıralamasına dokunmamalı');
});

await test('İKİNCİ atama yine de BAŞARILI ve yetkiyi verir (yalnızca sıralama atlanır)', async () => {
  const db = freshDb(); seed(db); addSecondUser(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  await assignOffice(env);
  await assignSecondManager(env);
  const claims = db.prepare(`SELECT user_id FROM profile_claims WHERE profile_key = 'Per Se Mimarlık' AND status = 'approved' ORDER BY user_id`).all();
  assert.deepEqual(claims.map(c => c.user_id), ['u-ikinci', 'u-yeni']);
});

await test('AYNI kullanıcıya tekrar atama (claim yeniden onayı) da promosyonu tekrarlamaz', async () => {
  const db = freshDb(); seed(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  await assignOffice(env);
  const before = db.prepare(`SELECT slug, relisted_at FROM projects ORDER BY slug`).all();
  await assignOffice(env);
  assert.deepEqual(db.prepare(`SELECT slug, relisted_at FROM projects ORDER BY slug`).all(), before);
});

await test('admin BLURU KALDIRIP yayına aldıysa, sonraki yönetici ataması promosyonu tekrarlamaz', async () => {
  const db = freshDb(); seedPreview(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  // Admin panelinin "Yayınla"sı (src/routes/legacyContent.js) bu uca girer.
  const { activateProfilesOnPublish } = await import('../src/routes/admin.js');
  const officeId = db.prepare(`SELECT id FROM offices WHERE slug = 'aaw'`).get().id;
  await activateProfilesOnPublish(env, 'office', [officeId], 'u-admin');
  assert.ok(promotedAt(db, 'AAW Ahmet Alataş Workshop'), 'yayına alma da damgalamalı');
  const before = db.prepare(`SELECT slug, relisted_at, display_order FROM projects ORDER BY slug`).all();
  const res = await assignManager(env);
  assert.equal(res.status, 200, await res.text());
  assert.deepEqual(db.prepare(`SELECT slug, relisted_at, display_order FROM projects ORDER BY slug`).all(), before,
    'blur zaten kaldırılmışken atama sıralamayı bir daha değiştirmemeli');
});

await test('projesi OLMAYAN firma damgalanmaz — projeleri eklenince İLK promosyonunu alır', async () => {
  const db = freshDb(); seed(db); await withSession(db, 'u-admin');
  db.exec(`DELETE FROM project_designers WHERE office_id = 1`);
  const env = { DB: d1(db) };
  await assignOffice(env);
  assert.equal(promotedAt(db, 'Per Se Mimarlık'), null, 'promosyon çalışmadıysa damga düşmemeli');
  // Projeler sonradan künyeye bağlanır; ikinci atama artık gerçek ilk promosyonunu yapar.
  db.exec(`INSERT INTO project_designers (project_id, office_id) VALUES (4, 1)`);
  await assignOffice(env);
  assert.ok(relistedAt(db, 'perse-en-yeni'), 'projeler sonradan gelince ilk promosyon çalışmalı');
  assert.ok(promotedAt(db, 'Per Se Mimarlık'));
});

await test('promosyon atlansa da bu partide ÖNİZLEMEDEN ÇIKAN yeni proje damgalanır', async () => {
  const db = freshDb(); seedPreview(db); addSecondUser(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  await assignManager(env);
  // Firma artık canlı ve damgalı. Sonradan ÖNİZLEMEDE yeni bir proje eklenir.
  db.exec(`
    INSERT INTO projects (slug, title, source, publish_date, created_at, display_order, hidden_at, preview_at)
      VALUES ('aaw-yepyeni', 'AAW Yepyeni', 'legacy_static', '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z', 700, '${PREV}', '${PREV}');
    INSERT INTO project_designers (project_id, office_id) SELECT id, 1 FROM projects WHERE slug = 'aaw-yepyeni';
  `);
  const merzigoBefore = relistedAt(db, 'merzigo');
  await assignSecondManager(env, 'AAW Ahmet Alataş Workshop');
  // Eski (zaten canlı) proje tekrar tepeye taşınmaz...
  assert.equal(relistedAt(db, 'merzigo'), merzigoBefore, 'eski proje tekrar 1. sıraya taşınmamalı');
  // ...ama İLK KEZ yayınlanan proje genel kurala göre (RELIST_TOP_PER_TYPE) damgalanır ve görünür.
  const yeni = db.prepare(`SELECT relisted_at, preview_at, hidden_at FROM projects WHERE slug = 'aaw-yepyeni'`).get();
  assert.equal(yeni.preview_at, null);
  assert.equal(yeni.hidden_at, null);
  assert.ok(yeni.relisted_at, 'yeni yayınlanan proje damgalanmalı (bkz. migrations/0108 sözleşmesi)');
});

section('"EN YENİ" = PROJE YILI, yayın tarihi DEĞİL (kullanıcı isteği, 2026-09-14)');

// "Bundan sonra yönetici hesabı atanan firmaların en yeni projelerini (en son yayınlanan değil yıla
// göre en yeni) proje sayfasında 1. sıraya koy." — örnek: FREA.
// Kural TEK yerde: src/routes/admin.js#compareByProjectYearDesc (promoteOfficeProjectsOnAssignment).
//
// Seed BİLEREK iki ölçütü ÇATIŞTIRIR — eski kural (en son yayınlanan) ile yeni kural (yıla göre en
// yeni) FARKLI projeyi seçmeli, aksi halde test hiçbir şey kanıtlamaz:
//   · frea-yeni-yil   : project_date 2025, EN ESKİ yayın tarihi (2019)  -> YENİ kuralın 1. sırası
//   · frea-son-yayin  : project_date 2016, EN YENİ yayın tarihi (2024)  -> ESKİ kuralın 1. sırası
//   · frea-yilsiz     : project_date YOK, yayın tarihi ortada           -> yılı çözülemeyen, SONA
// display_order'lar gerçek canlı veriyi taklit eder (toplu import backfill'i, bkz. yukarıdaki
// perse seed'i) — 1. sıraya çıkan satırın display_order'ının temizlendiği burada da doğrulanır.
function seedFrea(db) {
  db.exec(`
    INSERT INTO offices (slug, name, loc, cats, source) VALUES
      ('frea', 'FREA', 'İstanbul', '["Mimarlık"]', 'legacy_static');
    INSERT INTO projects (slug, title, source, project_date, publish_date, created_at, display_order) VALUES
      ('frea-son-yayin', 'FREA Son Yayınlanan', 'legacy_static', '2016', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z', 300),
      ('frea-yilsiz', 'FREA Yılsız', 'legacy_static', NULL, '2022-01-01T00:00:00.000Z', '2022-01-01T00:00:00.000Z', 400),
      ('frea-orta', 'FREA Orta', 'legacy_static', '2021', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', 500),
      ('frea-yeni-yil', 'FREA Yılı En Yeni', 'legacy_static', '2025', '2019-01-01T00:00:00.000Z', '2019-01-01T00:00:00.000Z', 898);
    INSERT INTO project_designers (project_id, office_id) VALUES (1, 1), (2, 1), (3, 1), (4, 1);
  `);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u-yeni', 'yeni@example.com', 'x', 'Yeni Yönetici', 'user', ?)`).run(Date.now());
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u-admin', 'admin@example.com', 'x', 'Admin', 'admin', ?)`).run(Date.now());
}

await test('YILI en yeni proje 1. sıraya geçer — en son YAYINLANAN değil', async () => {
  const db = freshDb(); seedFrea(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  const res = await assignOffice(env, 'FREA');
  assert.equal(res.status, 200, await res.text());
  const { fetchActiveProjectPool } = await import('../src/lib/projectPool.js');
  const pool = await fetchActiveProjectPool(env, 'built');
  assert.equal(pool[0].slug, 'frea-yeni-yil', `beklenen 1. sıra frea-yeni-yil (2025), sıra: ${pool.map(p => p.slug).join(', ')}`);
  assert.ok(relistedAt(db, 'frea-yeni-yil') > relistedAt(db, 'frea-son-yayin'),
    'yılı en yeni proje, en son yayınlanandan daha yeni bir relisted_at almalı');
  assert.equal(db.prepare(`SELECT display_order FROM projects WHERE slug = 'frea-yeni-yil'`).get().display_order, null,
    'display_order temizlenmeli, aksi halde relisted_at hiç işe yaramaz');
});

await test('DİĞERLERİ de YIL sırasıyla (yeniden eskiye) dağıtılır', async () => {
  const db = freshDb(); seedFrea(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  await assignOffice(env, 'FREA');
  const top = relistedAt(db, 'frea-yeni-yil');   // 2025
  const orta = relistedAt(db, 'frea-orta');      // 2021
  const eski = relistedAt(db, 'frea-son-yayin'); // 2016 (ama en son yayınlanan)
  assert.ok(top > orta, `2025 (${top}) > 2021 (${orta}) olmalı`);
  assert.ok(orta > eski, `2021 (${orta}) > 2016 (${eski}) olmalı — dağıtım da yıla göre`);
});

await test('YILI ÇÖZÜLEMEYEN proje SONA düşer (proje.html "En Yeni" sıralamasıyla AYNI davranış)', async () => {
  const db = freshDb(); seedFrea(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  await assignOffice(env, 'FREA');
  const yilsiz = relistedAt(db, 'frea-yilsiz');
  assert.ok(yilsiz, 'yılsız proje de dağıtıma girer (arka sayfalarda kaybolmasın)');
  assert.ok(relistedAt(db, 'frea-son-yayin') > yilsiz,
    'yılı BİLİNEN en eski proje bile, yılı çözülemeyenin ÖNÜNDE olmalı');
});

await test('serbest metin yıl formatları ("16. yy / 2026" gibi) proje.html ile AYNI ayrıştırıcıdan geçer', async () => {
  const db = freshDb(); seedFrea(db); await withSession(db, 'u-admin');
  // parseProjectDateYear bir parçadaki EN ERKEN yılı döndürür — "16. yy / 2026" 16. yüzyıl (1501)
  // demektir, 2026 DEĞİL (bkz. src/routes/project.js#parseProjectDateYear). Bu satır 2025'i GEÇMEMELİ.
  db.exec(`UPDATE projects SET project_date = '16. yy / 2026' WHERE slug = 'frea-son-yayin'`);
  const env = { DB: d1(db) };
  await assignOffice(env, 'FREA');
  const { fetchActiveProjectPool } = await import('../src/lib/projectPool.js');
  const pool = await fetchActiveProjectPool(env, 'built');
  assert.equal(pool[0].slug, 'frea-yeni-yil', `beklenen 1. sıra frea-yeni-yil (2025), sıra: ${pool.map(p => p.slug).join(', ')}`);
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) { for (const f of failures) console.error(` - ${f.name}: ${f.message}`); process.exit(1); }
