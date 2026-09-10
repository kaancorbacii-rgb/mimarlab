#!/usr/bin/env node
// ATAMA -> İLGİLİ TÜM İÇERİĞİN EŞ ZAMANLI YAYINA ALINMASI — BİRİM TESTLERİ
// (kullanıcı isteği, 2026-09-10 altıncı tur: "Bir kullanıcıya kişi, firma veya marka yetkisi
// verdiğimde bu kişi, firma ve markayla alakalı tüm içerikler otomatik ve eş zamanlı olarak yayına
// alınsın. Ayrıca yayına alınan tüm içeriklerde telif kutucuğu da işaretli olsun.")
//
// TETİKLEYİCİ CANLI BULGU: "Melis Varkal" kişisi bir kullanıcıya atandığında yalnızca o kişi yayına
// dönüyor, kurucu ortağı olduğu "ofisvesaire" firması ve diğer ortağı "Mustafa Gökhan Çelikağ"
// önizlemede (soluk) kalıyordu. Senaryo adları bu canlı vakadan alındı.
//
// KURAL TEK YERDE: src/routes/admin.js#activateClaimedProfile — atamanın İKİ admin yolu da
// (POST /api/admin/claims ve PATCH /api/admin/claims/:id) onu çağırır, bu yüzden burada test edilen
// şey ikisinin de davranışıdır (bkz. [[project_claim_assignment_paths_and_dash_pagination_2026_09_07]]).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { handleAdminRoute } from '../src/routes/admin.js';
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

const PREV = new Date('2026-09-01T00:00:00.000Z').toISOString();

// Tümü ÖNİZLEME durumunda başlar (hidden_at DOLU + preview_at DOLU, bkz. migrations/0107):
//   offices    1 ofisvesaire (firma) · 2 Vitrium (marka) · 3 İlgisiz Firma
//   architects 1 Melis Varkal · 2 Mustafa Gökhan Çelikağ (ortağı) · 3 İlgisiz Mimar
//   projects   1 İzmir G Evi (ofisvesaire künyeli) · 2 İlgisiz Proje
//   products   1 Vitrium Sandalye (Vitrium markalı) · 2 İlgisiz Ürün
function seed(db) {
  const now = Date.now();
  db.exec(`
    INSERT INTO offices (slug, name, loc, cats, source, hidden_at, preview_at) VALUES
      ('ofisvesaire', 'ofisvesaire', 'İstanbul', '["Mimarlık"]', 'legacy_static', '${PREV}', '${PREV}'),
      ('vitrium', 'Vitrium', 'İzmir', '["Mobilya"]', 'legacy_static', '${PREV}', '${PREV}'),
      ('ilgisiz-firma', 'İlgisiz Firma', 'Ankara', '["Mimarlık"]', 'legacy_static', '${PREV}', '${PREV}');
    INSERT INTO architects (slug, name, office_id, position, source, hidden_at, preview_at) VALUES
      ('melis-varkal', 'Melis Varkal', 1, 'Kurucu Ortak', 'legacy_static', '${PREV}', '${PREV}'),
      ('mustafa-gokhan-celikag', 'Mustafa Gökhan Çelikağ', 1, 'Kurucu Ortak', 'legacy_static', '${PREV}', '${PREV}'),
      ('ilgisiz-mimar', 'İlgisiz Mimar', 3, 'Kurucu', 'legacy_static', '${PREV}', '${PREV}');
    INSERT INTO office_founders (office_id, architect_id) VALUES (1, 1), (1, 2), (3, 3);
    INSERT INTO projects (slug, title, source, hidden_at, preview_at) VALUES
      ('izmir-g-evi', 'İzmir G Evi', 'legacy_static', '${PREV}', '${PREV}'),
      ('ilgisiz-proje', 'İlgisiz Proje', 'legacy_static', '${PREV}', '${PREV}');
    INSERT INTO project_designers (project_id, office_id) VALUES (1, 1), (2, 3);
    INSERT INTO products (slug, title, kind, brand_office_id, source, hidden_at, preview_at) VALUES
      ('vitrium-sandalye', 'Vitrium Sandalye', 'product', 2, 'legacy_static', '${PREV}', '${PREV}'),
      ('ilgisiz-urun', 'İlgisiz Ürün', 'product', 3, 'legacy_static', '${PREV}', '${PREV}');
  `);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u-melis', 'melis@example.com', 'x', 'Melis Varkal', 'user', ?)`).run(now);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u-admin', 'admin@example.com', 'x', 'Admin', 'admin', ?)`).run(now);
}

// Toplu arşivlemenin bıraktığı taslaklar (bkz. src/routes/unassignedArchive.js) — owner_user_id
// ADMIN'dir, status 'archived'. Atama bunları 'approved'a çevirmeli.
function seedArchivedDrafts(db) {
  const now = Date.now();
  const ins = (table, id, keyCol, key, extra = '') => db.prepare(
    `INSERT INTO ${table} (id, owner_user_id, status, created_at, updated_at, ${keyCol}${extra ? ', ' + extra.split('=')[0] : ''}) VALUES (?, 'u-admin', 'archived', ?, ?, ?${extra ? ", '" + extra.split('=')[1] + "'" : ''})`
  ).run(id, now, now, key);
  ins('architect_submissions', 'd-melis', 'claimed_profile_key', 'Melis Varkal', 'name=Melis Varkal');
  ins('architect_submissions', 'd-mustafa', 'claimed_profile_key', 'Mustafa Gökhan Çelikağ', 'name=Mustafa Gökhan Çelikağ');
  ins('office_submissions', 'd-ofis', 'claimed_profile_key', 'ofisvesaire', 'name=ofisvesaire');
  ins('project_submissions', 'd-proje', 'claimed_slug', 'izmir-g-evi', 'title=İzmir G Evi');
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

// POST /api/admin/claims — admin'in DOĞRUDAN atama yolu.
async function assign(env, { profileType, profileKey, userId = 'u-melis', officePosition = null }) {
  const url = new URL('https://mimarlab.com/api/admin/claims');
  return handleAdminRoute(adminReq(url.pathname, {
    method: 'POST', body: JSON.stringify({ userId, profileType, profileKey, officePosition }),
  }), env, url);
}

const live = (db, table, key, col = 'name') => {
  const r = db.prepare(`SELECT hidden_at, preview_at FROM ${table} WHERE ${col} = ?`).get(key);
  return !!r && r.hidden_at === null && r.preview_at === null;
};

// ---------------------------------------------------------------------------------------------
section('kişi ataması — canlı bulgu: Melis Varkal -> ofisvesaire -> Mustafa Gökhan Çelikağ');

await test('atanan KİŞİ yayına alınır', async () => {
  const db = freshDb(); seed(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  const res = await assign(env, { profileType: 'architect', profileKey: 'Melis Varkal' });
  assert.equal(res.status, 200, await res.text());
  assert.equal(live(db, 'architects', 'Melis Varkal'), true);
});

await test('kişinin FİRMASI da eş zamanlı yayına alınır', async () => {
  const db = freshDb(); seed(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  await assign(env, { profileType: 'architect', profileKey: 'Melis Varkal' });
  assert.equal(live(db, 'offices', 'ofisvesaire'), true);
});

await test('firmanın DİĞER ORTAĞI da eş zamanlı yayına alınır', async () => {
  const db = freshDb(); seed(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  await assign(env, { profileType: 'architect', profileKey: 'Melis Varkal' });
  assert.equal(live(db, 'architects', 'Mustafa Gökhan Çelikağ'), true);
});

await test('firmanın künyeli PROJESİ de yayına alınır', async () => {
  const db = freshDb(); seed(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  await assign(env, { profileType: 'architect', profileKey: 'Melis Varkal' });
  assert.equal(live(db, 'projects', 'izmir-g-evi', 'slug'), true);
});

await test('İLGİSİZ kayıtlara DOKUNULMAZ (kapsam iki hamleyle sınırlı)', async () => {
  const db = freshDb(); seed(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  await assign(env, { profileType: 'architect', profileKey: 'Melis Varkal' });
  assert.equal(live(db, 'offices', 'İlgisiz Firma'), false);
  assert.equal(live(db, 'architects', 'İlgisiz Mimar'), false);
  assert.equal(live(db, 'projects', 'ilgisiz-proje', 'slug'), false);
  assert.equal(live(db, 'products', 'ilgisiz-urun', 'slug'), false);
});

await test('office_founders bağı YOKKEN architects.office_id tek başına yeter', async () => {
  const db = freshDb(); seed(db); await withSession(db, 'u-admin');
  db.exec(`DELETE FROM office_founders WHERE office_id = 1`);
  const env = { DB: d1(db) };
  await assign(env, { profileType: 'architect', profileKey: 'Melis Varkal' });
  assert.equal(live(db, 'offices', 'ofisvesaire'), true);
  // Ortak bağı YOK artık — o yüzden Mustafa da gelmez (bağ neyse yayın da odur).
  assert.equal(live(db, 'architects', 'Mustafa Gökhan Çelikağ'), false);
});

section('marka/firma ataması');

await test('MARKA ataması markanın ÜRÜNLERİNİ de yayına alır', async () => {
  const db = freshDb(); seed(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  const res = await assign(env, { profileType: 'office', profileKey: 'Vitrium', officePosition: 'Yönetici' });
  assert.equal(res.status, 200, await res.text());
  assert.equal(live(db, 'offices', 'Vitrium'), true);
  assert.equal(live(db, 'products', 'vitrium-sandalye', 'slug'), true);
});

await test('FİRMA ataması ortaklarını ve projelerini yayına alır', async () => {
  const db = freshDb(); seed(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  await assign(env, { profileType: 'office', profileKey: 'ofisvesaire', officePosition: 'Yönetici' });
  assert.equal(live(db, 'architects', 'Melis Varkal'), true);
  assert.equal(live(db, 'architects', 'Mustafa Gökhan Çelikağ'), true);
  assert.equal(live(db, 'projects', 'izmir-g-evi', 'slug'), true);
});

section('telif kutucuğu — arşiv taslakları onaylanır + beyan kaydı düşer');

await test("yayına alınan kayıtların arşiv taslakları 'approved' olur", async () => {
  const db = freshDb(); seed(db); seedArchivedDrafts(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  await assign(env, { profileType: 'architect', profileKey: 'Melis Varkal' });
  for (const [table, id] of [['architect_submissions', 'd-melis'], ['architect_submissions', 'd-mustafa'], ['office_submissions', 'd-ofis'], ['project_submissions', 'd-proje']]) {
    assert.equal(db.prepare(`SELECT status FROM ${table} WHERE id = ?`).get(id).status, 'approved', `${table}/${id}`);
  }
});

await test('her yayına alınan kayıt için telif beyanı kaydı düşer', async () => {
  const db = freshDb(); seed(db); seedArchivedDrafts(db); await withSession(db, 'u-admin');
  const env = { DB: d1(db) };
  await assign(env, { profileType: 'architect', profileKey: 'Melis Varkal' });
  const rows = db.prepare(`SELECT content_type, content_key, source, user_id FROM rights_acceptances ORDER BY content_key`).all();
  const keys = rows.map(r => r.content_key).sort();
  assert.deepEqual(keys, ['Melis Varkal', 'Mustafa Gökhan Çelikağ', 'izmir-g-evi', 'ofisvesaire'].sort(), JSON.stringify(keys));
  // Beyan ATANAN kullanıcı adına, ayırt edilebilir bir kaynakla kaydedilir.
  assert.ok(rows.every(r => r.user_id === 'u-melis' && r.source === 'admin-assign'));
});

await test('ZATEN CANLI olan kayıt için beyan kaydı DÜŞMEZ (yalnızca yayına alınanlar)', async () => {
  const db = freshDb(); seed(db); await withSession(db, 'u-admin');
  // Her şey zaten canlı: atama hiçbir şeyi "yayına almaz".
  db.exec(`UPDATE architects SET hidden_at = NULL, preview_at = NULL`);
  db.exec(`UPDATE offices SET hidden_at = NULL, preview_at = NULL`);
  db.exec(`UPDATE projects SET hidden_at = NULL, preview_at = NULL`);
  db.exec(`UPDATE products SET hidden_at = NULL, preview_at = NULL`);
  const env = { DB: d1(db) };
  await assign(env, { profileType: 'architect', profileKey: 'Melis Varkal' });
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM rights_acceptances`).get().n, 0);
});

await test('atama İKİNCİ admin yolundan (PATCH .../claims/:id) da aynı cascade\'i tetikler', async () => {
  const db = freshDb(); seed(db); await withSession(db, 'u-admin');
  const now = Date.now();
  db.prepare(`INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at) VALUES ('c1', 'u-melis', 'architect', 'Melis Varkal', 'pending', ?, ?)`).run(now, now);
  const env = { DB: d1(db) };
  const url = new URL('https://mimarlab.com/api/admin/claims/c1');
  const res = await handleAdminRoute(adminReq(url.pathname, { method: 'PATCH', body: JSON.stringify({ status: 'approved' }) }), env, url);
  assert.equal(res.status, 200, await res.text());
  assert.equal(live(db, 'offices', 'ofisvesaire'), true);
  assert.equal(live(db, 'architects', 'Mustafa Gökhan Çelikağ'), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.error('\nBaşarısız testler:');
  for (const f of failures) console.error(`  - ${f.name}: ${f.message}`);
  process.exit(1);
}
