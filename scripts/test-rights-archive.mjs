#!/usr/bin/env node
// TELİF BEYANI KAPISI + ARŞİVİM — BİRİM TESTLERİ (kullanıcı isteği, 2026-09-10 madde 1/2/3).
//
// scripts/test-office-member-profile-edit.mjs ile AYNI desen: test koşucusu/npm bağımlılığı yok,
// node:assert + node:sqlite üzerinde GERÇEK bir SQLite ve schema.sql. Burada doğrulanan üç kural:
//   1) Gönderi uçları (POST/PATCH /api/<tip>) beyan onayı olmadan 422 döner (madde 1).
//   2) Arşivden yayına alma (POST /api/archive/publish) beyan onayı olmadan çalışmaz (madde 2).
//   3) Admin bir firmayı arşivlediğinde, o firmaya SONRADAN atanan kullanıcının Arşivim kutusunda
//      (GET /api/archive/mine) kayıt görünür ve onayla yayına alınabilir (madde 3'ün asıl akışı).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { handleSubmissionRoute } from '../src/routes/submissions.js';
import { handleArchiveRoute } from '../src/routes/archive.js';
import { runContentAction, runProjectAction } from '../src/routes/legacyContent.js';
import { findUnassignedForScript } from '../src/routes/unassignedArchive.js';
import { setLegacyHidden } from '../src/routes/legacyContent.js';
import { sha256Hex } from '../src/lib/crypto.js';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }

// ---- D1 shim (node:sqlite) — diğer test dosyalarıyla BİREBİR aynı ------------------------------
function d1(db) {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = db.prepare(sql).get(...params); if (r === undefined) return null; return col ? r[col] : { ...r }; },
    async all() { return { results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }; },
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return {
    prepare: (sql) => stmt(sql, []),
    async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; },
  };
}
function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0079_search_fold_columns.sql', import.meta.url), 'utf8'));
  return db;
}

async function seed(db) {
  const now = Date.now();
  db.exec(`
    INSERT INTO offices (slug, name, loc, cats, source) VALUES
      ('atanmamis-mimarlik', 'Atanmamış Mimarlık', 'İstanbul', '"Mimarlık"', 'legacy_static');
  `);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, 'x', ?, ?, ?)`)
    .run('u-admin', 'admin@example.com', 'Admin', 'admin', now);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, 'x', ?, ?, ?)`)
    .run('u-uye', 'uye@example.com', 'Firma Yetkilisi', 'user', now);
  for (const uid of ['u-admin', 'u-uye']) {
    db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
      .run(await sha256Hex(`tok-${uid}`), uid, now, now + 3600_000);
  }
}

function approveOfficeClaim(db, position = 'Kurucu') {
  const now = Date.now();
  db.prepare(
    `INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at, office_position)
     VALUES (?, ?, 'office', ?, 'approved', ?, ?, ?)`
  ).run('c-uye-office', 'u-uye', 'Atanmamış Mimarlık', now, now, position);
}

const req = (uid, path, init = {}) => new Request(`https://mimarlab.com${path}`, {
  ...init,
  headers: { 'Content-Type': 'application/json', Cookie: `__Host-mimarlab_session=tok-${uid}`, ...(init.headers || {}) },
});
const call = (handler, uid, path, init) => handler(req(uid, path, init), envRef.env, new URL(`https://mimarlab.com${path}`));
const envRef = { env: null };

section('madde 1 — gönderi uçlarında telif beyanı zorunlu');

await test('POST /api/offices: beyan onayı yoksa 422', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  const res = await call(handleSubmissionRoute, 'u-uye', '/api/offices', {
    method: 'POST', body: JSON.stringify({ name: 'Yeni Firma', cats: 'Mimarlık' }),
  });
  assert.equal(res.status, 422, await res.clone().text());
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM office_submissions`).get().c, 0);
});

await test('POST /api/offices: beyan onaylıysa kayıt oluşur ve denetim izi yazılır', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  const res = await call(handleSubmissionRoute, 'u-uye', '/api/offices', {
    method: 'POST', body: JSON.stringify({ name: 'Yeni Firma', cats: 'Mimarlık', rightsAccepted: true }),
  });
  assert.equal(res.status, 201, await res.clone().text());
  const row = db.prepare(`SELECT * FROM rights_acceptances`).get();
  assert.ok(row, 'rights_acceptances satırı yazılmalı');
  assert.equal(row.user_id, 'u-uye');
  assert.equal(row.content_type, 'offices');
  assert.equal(row.source, 'submit');
});

section('madde 3 — arşivlenen firma, ATANAN kullanıcının Arşivim kutusunda görünür');

await test('admin arşivler -> atama YOKKEN üyenin kutusunda görünmez', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await runContentAction(envRef.env, { id: 'u-admin', role: 'admin' }, { type: 'offices', action: 'archive', key: 'Atanmamış Mimarlık' });
  assert.ok(db.prepare(`SELECT hidden_at FROM offices WHERE name = 'Atanmamış Mimarlık'`).get().hidden_at, 'canonical satır gizlenmeli');
  const res = await call(handleArchiveRoute, 'u-uye', '/api/archive/mine', { method: 'GET' });
  const data = await res.json();
  assert.equal((data.items || []).length, 0);
});

await test('atama onaylanınca kayıt Arşivim kutusunda belirir', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await runContentAction(envRef.env, { id: 'u-admin', role: 'admin' }, { type: 'offices', action: 'archive', key: 'Atanmamış Mimarlık' });
  approveOfficeClaim(db);
  const res = await call(handleArchiveRoute, 'u-uye', '/api/archive/mine', { method: 'GET' });
  const data = await res.json();
  assert.equal(data.items.length, 1, JSON.stringify(data));
  assert.equal(data.items[0].title, 'Atanmamış Mimarlık');
  assert.equal(data.items[0].kind, 'office');
  assert.equal(data.items[0].type, 'offices');
  assert.equal(data.items[0].owned, false);
});

await test('kendi arşiv gönderisi owned:true olarak işaretlenir', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  const now = Date.now();
  db.prepare(`INSERT INTO office_submissions (id, owner_user_id, status, created_at, updated_at, name, cats) VALUES (?, 'u-uye', 'archived', ?, ?, ?, ?)`)
    .run('s-own', now, now, 'Üyenin Kendi Firması', 'Mimarlık');
  const res = await call(handleArchiveRoute, 'u-uye', '/api/archive/mine', { method: 'GET' });
  const item = (await res.json()).items[0];
  assert.equal(item.owned, true);
  assert.equal(item.editUrl, '/firma-ekle?edit=s-own&stype=offices');
});

await test('yetkisiz görevle (Ekip Üyesi) atanan kullanıcı kaydı GÖREMEZ', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await runContentAction(envRef.env, { id: 'u-admin', role: 'admin' }, { type: 'offices', action: 'archive', key: 'Atanmamış Mimarlık' });
  approveOfficeClaim(db, 'Ekip Üyesi');
  const res = await call(handleArchiveRoute, 'u-uye', '/api/archive/mine', { method: 'GET' });
  assert.equal((await res.json()).items.length, 0);
});

section('madde 2/4 — yayına alma İÇERİĞİN KENDİ DÜZENLEME SAYFASINDAN, beyanla olur');

async function archivedIdFor(db) {
  return db.prepare(`SELECT id FROM office_submissions WHERE status = 'archived'`).get().id;
}
// Düzenleme sayfasının gerçekte attığı istek: PATCH /api/offices/:id, claimed_profile_key ile.
const savePayload = (extra) => JSON.stringify({
  name: 'Atanmamış Mimarlık', cats: 'Mimarlık', claimed_profile_key: 'Atanmamış Mimarlık', ...extra,
});

await test('atanan kullanıcı arşiv taslağını AÇABİLİR (owner admin olsa da)', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await runContentAction(envRef.env, { id: 'u-admin', role: 'admin' }, { type: 'offices', action: 'archive', key: 'Atanmamış Mimarlık' });
  approveOfficeClaim(db);
  const id = await archivedIdFor(db);
  // GERÇEK BULGU: bu uç eskiden yalnızca owner_user_id'ye bakıyordu; toplu arşivin taslak sahibi
  // ADMIN olduğundan atanan kullanıcı 404 alıyor, madde 4/5 akışı hiç çalışamıyordu.
  const res = await call(handleSubmissionRoute, 'u-uye', `/api/offices/${id}`, { method: 'GET' });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal((await res.json()).item.name, 'Atanmamış Mimarlık');
});

await test('düzenleme sayfasından kaydetmek beyan olmadan REDDEDİLİR (422) ve kayıt gizli kalır', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await runContentAction(envRef.env, { id: 'u-admin', role: 'admin' }, { type: 'offices', action: 'archive', key: 'Atanmamış Mimarlık' });
  approveOfficeClaim(db);
  const id = await archivedIdFor(db);
  const res = await call(handleSubmissionRoute, 'u-uye', `/api/offices/${id}`, { method: 'PATCH', body: savePayload({}) });
  assert.equal(res.status, 422, await res.clone().text());
  assert.ok(db.prepare(`SELECT hidden_at FROM offices WHERE name = 'Atanmamış Mimarlık'`).get().hidden_at);
  assert.equal(db.prepare(`SELECT status FROM office_submissions WHERE id = ?`).get(id).status, 'archived');
});

await test('beyan onaylıysa kaydetmek kaydı YAYINA ALIR', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await runContentAction(envRef.env, { id: 'u-admin', role: 'admin' }, { type: 'offices', action: 'archive', key: 'Atanmamış Mimarlık' });
  approveOfficeClaim(db);
  const id = await archivedIdFor(db);
  const res = await call(handleSubmissionRoute, 'u-uye', `/api/offices/${id}`, { method: 'PATCH', body: savePayload({ rightsAccepted: true }) });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(db.prepare(`SELECT hidden_at FROM offices WHERE name = 'Atanmamış Mimarlık'`).get().hidden_at, null);
  assert.equal(db.prepare(`SELECT status FROM office_submissions WHERE id = ?`).get(id).status, 'approved');
  assert.ok(db.prepare(`SELECT 1 AS x FROM rights_acceptances WHERE source = 'submit'`).get());
});

await test('atanmamış bir kullanıcı arşiv taslağını AÇAMAZ (404)', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await runContentAction(envRef.env, { id: 'u-admin', role: 'admin' }, { type: 'offices', action: 'archive', key: 'Atanmamış Mimarlık' });
  const id = await archivedIdFor(db);
  const res = await call(handleSubmissionRoute, 'u-uye', `/api/offices/${id}`, { method: 'GET' });
  assert.equal(res.status, 404);
});

await test('her arşiv satırı "Düzenle ve Yayına Al" bağlantısı taşır (sahibi olmasa da)', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await runContentAction(envRef.env, { id: 'u-admin', role: 'admin' }, { type: 'offices', action: 'archive', key: 'Atanmamış Mimarlık' });
  approveOfficeClaim(db);
  const res = await call(handleArchiveRoute, 'u-uye', '/api/archive/mine', { method: 'GET' });
  const item = (await res.json()).items[0];
  assert.equal(item.owned, false);
  assert.match(item.editUrl, /^\/firma-ekle\?edit=.+&stype=offices$/);
});

section('regresyon — ürünü arşivleyip yayına almak kaydı ÇOĞALTMAMALI');

await test('ürün: anahtarla arşivle -> yayına al, tek canonical satır kalır', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  db.exec(`INSERT INTO products (slug, legacy_key, kind, title, brand_name_raw, category, images, source)
           VALUES ('sandalye-marka', 'Marka|||Sandalye', 'product', 'Sandalye', 'Marka', 'Oturma', '["/media/a.webp"]', 'legacy_static')`);
  const admin = { id: 'u-admin', role: 'admin' };
  await runContentAction(envRef.env, admin, { type: 'products', action: 'archive', key: 'Marka|||Sandalye' });
  const draft = db.prepare(`SELECT id, claimed_slug FROM product_submissions WHERE status = 'archived'`).get();
  // GERÇEK BULGU (2026-09-10): taslak canonical satıra `claimed_slug` ile bağlanmazsa "Yayınla",
  // orijinali geri açmak yerine İKİNCİ bir ürün satırı yaratıyordu (bkz. src/routes/legacyContent.js
  // #runContentAction key dalındaki AYNI yorum ve src/lib/canonicalSync.js#syncProduct).
  assert.equal(draft.claimed_slug, 'sandalye-marka');
  const res = await runContentAction(envRef.env, admin, { type: 'products', action: 'publish', id: draft.id });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM products`).get().c, 1, 'ürün çoğalmamalı');
  const row = db.prepare(`SELECT legacy_key, hidden_at FROM products`).get();
  assert.equal(row.hidden_at, null);
  assert.equal(row.legacy_key, 'Marka|||Sandalye', 'orijinal legacy_key korunmalı');
});

await test('firma: cats DİZİ olarak saklanmışsa bile arşivleme patlamaz', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  // Canlıda bazı eski içe aktarımlarda offices.cats bir JSON DİZİDİR; bindContentFields o durumda
  // D1'e dizi bind etmeye çalışıp arşivlemeyi düşürüyordu (bkz. o fonksiyondaki AYNI yorum).
  db.exec(`INSERT INTO offices (slug, name, loc, cats, source) VALUES ('dizi-firma', 'Dizi Firma', 'İzmir', '["Mimarlık","Peyzaj"]', 'legacy_static')`);
  const res = await runContentAction(envRef.env, { id: 'u-admin', role: 'admin' }, { type: 'offices', action: 'archive', key: 'Dizi Firma' });
  assert.equal(res.status, 200, await res.clone().text());
  assert.ok(db.prepare(`SELECT hidden_at FROM offices WHERE name = 'Dizi Firma'`).get().hidden_at);
});

section('proje arşivleme kuralları (kullanıcı isteği, 2026-09-10 üçüncü tur)');

// Bir proje YALNIZCA şu beş durumdan hiçbirine uymuyorsa arşivlenir: künyesi atanmış bir profile
// bağlı / künyesi 'iz-birakan' rozetli bir profile bağlı / fotoğrafçısı Kaan Çorbacı / künyesinde
// 1970 öncesi bir yıl var / admin olmayan bir üye yüklemiş.
function seedProjects(db) {
  const now = Date.now();
  db.exec(`
    INSERT INTO architects (slug, name, source) VALUES
      ('kaan-corbaci', 'Kaan Çorbacı', 'legacy_static'),
      ('mimar-sinan', 'Mimar Sinan', 'legacy_static'),
      ('sade-mimar', 'Sade Mimar', 'legacy_static');
    INSERT INTO offices (slug, name, cats, source) VALUES ('autoban', 'Autoban', '"Mimarlık"', 'legacy_static');
    INSERT INTO projects (slug, title, project_date, photo_credit_text, source) VALUES
      ('autoban-p', 'Autoban Projesi', '2015', 'Bir Fotoğrafçı', 'legacy_static'),
      ('atanmis-p', 'Atanmış Firma Projesi', '2018', NULL, 'legacy_static'),
      ('sinan-p', 'Süleymaniye', '1557', NULL, 'legacy_static'),
      ('eski-p', 'Eski Yapı', '1968', NULL, 'legacy_static'),
      ('aralik-p', 'Aralıklı Yapı', '1965-1975', NULL, 'legacy_static'),
      ('yy-p', 'Yüzyıl Yapısı', '16. Yüzyıl', NULL, 'legacy_static'),
      ('kaan-metin-p', 'Kaan Fotoğrafladı', '2020', 'Fotoğraf: Kaan Çorbacı', 'legacy_static'),
      ('kaan-tablo-p', 'Kaan Tablo Bağı', '2021', NULL, 'legacy_static'),
      ('sade-p', 'Sade Proje', '2019', NULL, 'legacy_static'),
      ('uye-p', 'Üye Projesi', '2022', NULL, 'legacy_static');
    INSERT INTO project_designers (project_id, office_id) VALUES (1, 1), (2, 2);
    INSERT INTO project_designers (project_id, architect_id) VALUES (3, 2), (9, 3);
    INSERT INTO project_photographers (project_id, architect_id) VALUES (8, 1);
    INSERT INTO admin_badges (profile_type, profile_key, badge_type, updated_at) VALUES ('architect', 'Mimar Sinan', 'iz-birakan', 0);
  `);
  db.prepare(`INSERT INTO project_submissions (id, owner_user_id, status, created_at, updated_at, title, slug) VALUES ('s-uye', 'u-uye', 'approved', ?, ?, 'Üye Projesi', 'uye-p')`).run(now, now);
}

await test('yalnızca korunmayan projeler arşivlenir (Autoban dahil)', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  // 'Atanmış Firma Projesi' künyesi seed()'deki 'Atanmamış Mimarlık'a değil, aşağıdaki atanmış
  // firmaya bağlı olmalı — bu yüzden claim o firmaya verilir.
  db.exec(`INSERT INTO offices (slug, name, cats, source) VALUES ('atanmis-firma', 'Atanmış Firma', '"Mimarlık"', 'legacy_static')`);
  seedProjects(db);
  const now = Date.now();
  db.prepare(`INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at, office_position) VALUES ('c-af', 'u-uye', 'office', 'Atanmış Firma', 'approved', ?, ?, 'Kurucu')`).run(now, now);
  const rows = await findUnassignedForScript(envRef.env, 'projects');
  const slugs = rows.map(r => r.key).sort();
  // 'uye-p' de listede: bir ÜYENİN yüklemiş olması tek başına projeyi yayında tutmaz — künyesi
  // onaylı bir profile bağlı olmalı (kullanıcı isteği, madde 6: Kemalpaşa Kongre Merkezi örneği).
  assert.deepEqual(slugs, ['autoban-p', 'sade-p', 'uye-p'], `beklenmeyen liste: ${JSON.stringify(slugs)}`);
});

await test('1970 öncesi yıl taşıyan projeler (aralık ve yüzyıl biçimleri dahil) korunur', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  seedProjects(db);
  const slugs = new Set((await findUnassignedForScript(envRef.env, 'projects')).map(r => r.key));
  for (const keep of ['sinan-p', 'eski-p', 'aralik-p', 'yy-p']) {
    assert.ok(!slugs.has(keep), `${keep} arşivlenmemeliydi`);
  }
});

await test('Kaan Çorbacı fotoğrafı: hem serbest metin künye hem project_photographers korunur', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  seedProjects(db);
  const slugs = new Set((await findUnassignedForScript(envRef.env, 'projects')).map(r => r.key));
  assert.ok(!slugs.has('kaan-metin-p'), 'photo_credit_text bağı korunmalı');
  assert.ok(!slugs.has('kaan-tablo-p'), 'project_photographers bağı korunmalı');
});

section('önizleme ("soluk") durumu — kullanıcı isteği, 2026-09-10 dördüncü tur');

await test('yayına alma hem hidden_at hem preview_at temizler', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  db.exec(`UPDATE offices SET hidden_at = '2026-09-10', preview_at = '2026-09-10' WHERE name = 'Atanmamış Mimarlık'`);
  // GERÇEK BULGU: setLegacyHidden yalnızca hidden_at'i temizliyordu — canlıya dönen kart listede
  // hâlâ soluk/tıklanamaz kalırdı.
  await setLegacyHidden(envRef.env, { id: 'u-admin', role: 'admin' }, 'offices', 'Atanmamış Mimarlık', false);
  const row = db.prepare(`SELECT hidden_at, preview_at FROM offices WHERE name = 'Atanmamış Mimarlık'`).get();
  assert.equal(row.hidden_at, null);
  assert.equal(row.preview_at, null, 'preview_at da temizlenmeli');
});

await test('arşivleme preview_at\'e DOKUNMAZ (tekil Arşivle tam arşivdir)', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await setLegacyHidden(envRef.env, { id: 'u-admin', role: 'admin' }, 'offices', 'Atanmamış Mimarlık', true);
  const row = db.prepare(`SELECT hidden_at, preview_at FROM offices WHERE name = 'Atanmamış Mimarlık'`).get();
  assert.ok(row.hidden_at);
  assert.equal(row.preview_at, null);
});

section('firma/marka üyeleri arşivlenen proje/ürünü görür — kullanıcı isteği, 2026-09-11');

// Bir firmaya/markaya ait TÜM kullanıcılar (görev fark etmeksizin + claimed_by_user_id) arşivlenen
// proje ve ürünü Arşivim'de görür; "Düzenle ve Yayına Al" yalnızca düzenleme yetkilisine verilir.
async function seedMembers(db) {
  const now = Date.now();
  for (const [uid, name] of [['u-kurucu2', 'İkinci Kurucu'], ['u-ekip', 'Ekip Üyesi'], ['u-sahip', 'Firma Sahibi'], ['u-yabanci', 'Yabancı']]) {
    db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, 'x', ?, 'user', ?)`).run(uid, `${uid}@example.com`, name, now);
    db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`).run(await sha256Hex(`tok-${uid}`), uid, now, now + 3600_000);
  }
  const claim = db.prepare(
    `INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at, office_position)
     VALUES (?, ?, 'office', ?, 'approved', ?, ?, ?)`
  );
  for (const [uid, pos] of [['u-uye', 'Kurucu'], ['u-kurucu2', 'Ortak'], ['u-ekip', 'Ekip Üyesi']]) {
    claim.run(`c-${uid}`, uid, 'Atanmamış Mimarlık', now, now, pos);
  }
  db.exec(`UPDATE offices SET claimed_by_user_id = 'u-sahip' WHERE name = 'Atanmamış Mimarlık'`);
}
const mine = async (uid) => (await (await call(handleArchiveRoute, uid, '/api/archive/mine', { method: 'GET' })).json()).items;

async function archiveFirmProject(db) {
  db.exec(`INSERT INTO projects (slug, title, source) VALUES ('firma-projesi', 'Firma Projesi', 'legacy_static')`);
  const pid = db.prepare(`SELECT id FROM projects WHERE slug = 'firma-projesi'`).get().id;
  const oid = db.prepare(`SELECT id FROM offices WHERE name = 'Atanmamış Mimarlık'`).get().id;
  db.prepare(`INSERT INTO project_designers (project_id, office_id) VALUES (?, ?)`).run(pid, oid);
  // Arşivleyen, firmanın Kurucusu (u-uye) — kanonik anahtarla, kendi taslağı yokken.
  const res = await runProjectAction(envRef.env, { id: 'u-uye', role: 'user' }, { action: 'archive', slug: 'firma-projesi' });
  assert.equal(res.status, 200, await res.clone().text());
}

await test('proje: bir üyenin arşivlediği proje firmanın TÜM üyelerinde görünür', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await seedMembers(db);
  await archiveFirmProject(db);
  for (const uid of ['u-uye', 'u-kurucu2', 'u-ekip', 'u-sahip']) {
    const items = (await mine(uid)).filter(it => it.kind === 'project');
    assert.equal(items.length, 1, `${uid} projeyi görmeli: ${JSON.stringify(items)}`);
    assert.equal(items[0].title, 'Firma Projesi');
  }
  assert.equal((await mine('u-yabanci')).length, 0, 'firmaya ait olmayan kullanıcı görmemeli');
});

await test('proje: Düzenle ve Yayına Al yalnızca düzenleme yetkilisine verilir', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await seedMembers(db);
  await archiveFirmProject(db);
  const byUser = {};
  for (const uid of ['u-uye', 'u-kurucu2', 'u-ekip']) byUser[uid] = (await mine(uid)).find(it => it.kind === 'project');
  assert.equal(byUser['u-uye'].owned, true);
  assert.match(byUser['u-uye'].editUrl, /^\/proje-ekle\?edit=/);
  assert.equal(byUser['u-kurucu2'].canEdit, true);
  assert.match(byUser['u-kurucu2'].editUrl, /^\/proje-ekle\?edit=/);
  assert.equal(byUser['u-ekip'].canEdit, false);
  assert.equal(byUser['u-ekip'].editUrl, null, 'Ekip Üyesi için düzenleme sayfası 404 döner — ölü buton verilmemeli');
  // Kutu ile düzenleme sayfası AYNI kararı vermeli.
  const res = await call(handleSubmissionRoute, 'u-ekip', `/api/projects/${byUser['u-ekip'].id}`, { method: 'GET' });
  assert.equal(res.status, 404);
  const ok = await call(handleSubmissionRoute, 'u-kurucu2', `/api/projects/${byUser['u-kurucu2'].id}`, { method: 'GET' });
  assert.equal(ok.status, 200, await ok.clone().text());
});

await test('firma PROFİLİNİN kendi arşivi hâlâ yalnızca düzenleme yetkilisinde görünür', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await seedMembers(db);
  await runContentAction(envRef.env, { id: 'u-admin', role: 'admin' }, { type: 'offices', action: 'archive', key: 'Atanmamış Mimarlık' });
  assert.equal((await mine('u-ekip')).filter(it => it.kind === 'office').length, 0);
  assert.equal((await mine('u-kurucu2')).filter(it => it.kind === 'office').length, 1);
});

function seedBrand(db) {
  db.exec(`INSERT INTO offices (slug, name, cats, source) VALUES ('ornek-marka', 'Örnek Marka', '"Mobilya"', 'legacy_static')`);
  const now = Date.now();
  const claim = db.prepare(
    `INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at, office_position)
     VALUES (?, ?, 'office', 'Örnek Marka', 'approved', ?, ?, ?)`
  );
  claim.run('c-m-uye', 'u-uye', now, now, 'Kurucu');
  claim.run('c-m-ekip', 'u-ekip', now, now, 'Ekip Üyesi');
}

await test('ürün: markanın arşivlenen ürünü markanın tüm üyelerinde görünür', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await seedMembers(db);
  seedBrand(db);
  db.exec(`INSERT INTO products (slug, legacy_key, kind, title, brand_name_raw, category, images, source)
           VALUES ('koltuk-ornek', 'Örnek Marka|||Koltuk', 'product', 'Koltuk', 'Örnek Marka', 'Oturma', '["/media/a.webp"]', 'legacy_static')`);
  await runContentAction(envRef.env, { id: 'u-uye', role: 'user' }, { type: 'products', action: 'archive', key: 'Örnek Marka|||Koltuk' });
  const ekip = (await mine('u-ekip')).filter(it => it.kind === 'product');
  assert.equal(ekip.length, 1, JSON.stringify(ekip));
  assert.equal(ekip[0].editUrl, null);
  const uye = (await mine('u-uye')).filter(it => it.kind === 'product');
  assert.equal(uye.length, 1);
  assert.match(uye[0].editUrl, /^\/urun-ekle\?edit=/);
  assert.equal((await mine('u-yabanci')).length, 0);
});

await test('ürün: arşivde 500\'den fazla ürün olsa da markanın ESKİ ürünü kaybolmaz', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await seedMembers(db);
  seedBrand(db);
  // GERÇEK BULGU (canlıda 692 arşiv ürünü): eski hâl TÜM arşivi LIMIT 500 ile çekip marka filtresini
  // sonradan uyguluyordu — markanın en eski ürünü hiç gelmiyordu.
  db.prepare(`INSERT INTO product_submissions (id, owner_user_id, status, created_at, updated_at, title, brand) VALUES ('p-eski', 'u-admin', 'archived', 1, 1, 'Eski Koltuk', 'ÖRNEK MARKA')`).run();
  const ins = db.prepare(`INSERT INTO product_submissions (id, owner_user_id, status, created_at, updated_at, title, brand) VALUES (?, 'u-admin', 'archived', ?, ?, ?, 'Başka Marka')`);
  for (let i = 0; i < 600; i++) ins.run(`p-${i}`, 1000 + i, 1000 + i, `Ürün ${i}`);
  const items = (await mine('u-ekip')).filter(it => it.kind === 'product');
  assert.deepEqual(items.map(it => it.id), ['p-eski'], 'casefold eşleşmesiyle markanın eski ürünü gelmeli');
});

await test('ürün: marka metni farklı olsa da brand_office_id bağı yeter', async () => {
  const db = freshDb(); await seed(db); envRef.env = { DB: d1(db) };
  await seedMembers(db);
  seedBrand(db);
  const oid = db.prepare(`SELECT id FROM offices WHERE name = 'Örnek Marka'`).get().id;
  db.prepare(`INSERT INTO products (slug, legacy_key, kind, title, brand_office_id, brand_name_raw, source) VALUES ('masa-ornek', 'x|||Masa', 'product', 'Masa', ?, 'Eski Ad', 'legacy_static')`).run(oid);
  db.prepare(`INSERT INTO product_submissions (id, owner_user_id, status, created_at, updated_at, title, brand, claimed_slug) VALUES ('p-bag', 'u-admin', 'archived', 1, 1, 'Masa', 'Eski Ad', 'masa-ornek')`).run();
  const items = (await mine('u-ekip')).filter(it => it.kind === 'product');
  assert.equal(items.length, 1, JSON.stringify(items));
  const kurucu = (await mine('u-uye')).find(it => it.kind === 'product');
  assert.equal(kurucu.canEdit, true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.error('\nBaşarısız testler:');
  for (const f of failures) console.error(`  - ${f.name}: ${f.message}`);
  process.exit(1);
}
