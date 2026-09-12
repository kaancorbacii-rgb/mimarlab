#!/usr/bin/env node
// 2026-09-08 TURU — BİRİM/ENTEGRASYON TESTLERİ (kullanıcı isteği maddeleri 1-6).
//
// scripts/test-meet-gateway.mjs ile AYNI desen: test koşucusu/npm bağımlılığı yok, node:assert +
// node:sqlite üzerinde GERÇEK bir SQLite. schema.sql'in üstüne migrations/0079 (arama katlama
// kolonları) da uygulanır — klasik aramanın ürettiği SQL'in gerçek şemaya karşı GEÇERLİLİĞİ de
// böylece test edilir (yalnızca JS skorlaması değil).
//
// KAPSAM:
//   madde 1 — atanan kişi/firma profilinde düzenleme yetkisi (office_position'a göre)
//   madde 2 — 'Yönetici' görevi: yetki VERİR ama Kurucular/Ekip'te GÖRÜNMEZ
//   madde 3 — Ekip kutusundan çıkarma cascade'i (Yönetici'ye dokunmaz, aksanlı ad eşleşir)
//   madde 4 — noktalı ad araması ("r.a.f. studio" / "raf studio" / "raf")
//   madde 5 — atanmış profillerde `claimed` bayrağı (kaynak uyarısı gizlenir)
//   madde 6 — aynı kişi hem Kurucular'da hem Ekip'te görünmesin (aksan katlamalı dedup)

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { classicSearch, queryWords, fieldScore } from '../src/lib/classicSearch.js';
import { anyProfileClaimed } from '../src/lib/claimedProfiles.js';
import { OFFICE_EDIT_POSITIONS, MANAGER_POSITION } from '../src/lib/projectClaimAccess.js';
import { cascadeRemovedProfileClaims } from '../src/lib/officeFounderCascade.js';
import { canUserEditProjectBySlug } from '../src/lib/projectClaimAccess.js';
import { ensurePendingOfficeClaims, fillUserFromArchitectProfile, fetchOfficeFounderLinks, canEditOfficeViaFounderLink, fetchOwnArchitectRows } from '../src/lib/claimedProfiles.js';
import { syncApprovedSubmissionToCanonical } from '../src/lib/canonicalSync.js';
import { newId } from '../src/lib/crypto.js';
import { parseSubmissionRow } from '../src/lib/submissionTypes.js';
import { slugify } from '../src/lib/slugify.js';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 4).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }

// ---- D1 shim (node:sqlite) — test-meet-gateway.mjs ile BİREBİR aynı -----------------------------
function d1(db) {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = db.prepare(sql).get(...params); if (r === undefined) return null; return col ? r[col] : { ...r }; },
    async all() { return { results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }; },
    // last_row_id: canonicalSync.js#syncArchitect INSERT'ten sonra bunu okur (yeni canonical satırın
    // id'si) — shim döndürmezse bind hatası verir, gerçek D1 döndürür.
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
  // 0079: name_fold/title_fold/brand_fold generated kolonları — klasik arama bunlara bağlı.
  db.exec(readFileSync(new URL('../migrations/0079_search_fold_columns.sql', import.meta.url), 'utf8'));
  return db;
}

function seed(db) {
  const now = Date.now();
  db.exec(`
    INSERT INTO offices (slug, name, loc, cats, source) VALUES
      ('raf-studio', 'R.A.F. Studio', 'İstanbul / Beyoğlu', '["Mimarlık"]', 'legacy_static'),
      ('ds-mimarlik', 'DS Mimarlık', 'İstanbul / Beyoğlu', '["Mimarlık"]', 'legacy_static'),
      ('ind', 'IND [Inter.National.Design]', 'Hollanda', '["Mimarlık"]', 'legacy_static'),
      ('bos-firma', 'Boş Firma', 'Ankara', '["Mimarlık"]', 'legacy_static');
    INSERT INTO architects (slug, name, office_id, position, source) VALUES
      ('arman-akdogan', 'Arman Akdoğan', 3, 'Kurucu Ortak', 'legacy_static'),
      ('deniz-aslan', 'Deniz Aslan', 2, 'Kurucu Ortak', 'legacy_static');
    INSERT INTO office_founders (office_id, architect_id) VALUES (3, 1), (2, 2);
  `);
  const mkUser = (id, name, email, position) => db.prepare(
    `INSERT INTO users (id, email, password_hash, name, position, role, created_at) VALUES (?, ?, 'x', ?, ?, 'user', ?)`
  ).run(id, email, name, position, now);
  // "Arman Akdogan" — hesap adı AKSANSIZ yazılmış (canlı bulgu, madde 6).
  mkUser('u-arman', 'Arman Akdogan', 'arman@example.com', null);
  // "DS Mimarlık" — firmanın KENDİ kurumsal hesabı (madde 2).
  mkUser('u-ds', 'DS Mimarlık', 'ds@example.com', null);
  mkUser('u-ekip', 'Ayşe Demir', 'ayse@example.com', null);

  const mkClaim = (id, user, key, pos) => db.prepare(
    `INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at, office_position) VALUES (?, ?, 'office', ?, 'approved', ?, ?, ?)`
  ).run(id, user, key, now, now, pos);
  mkClaim('c-arman', 'u-arman', 'IND [Inter.National.Design]', 'Kurucu Ortak');
  mkClaim('c-ds', 'u-ds', 'DS Mimarlık', MANAGER_POSITION);
  mkClaim('c-ekip', 'u-ekip', 'DS Mimarlık', 'Ekip Üyesi');
}

// ---- madde 1: atamanın GERÇEKTEN düzenleme yetkisi vermesi -------------------------------------
section('madde 1 — atanan profilde düzenleme yetkisi');

function seedProject(db) {
  db.exec(`
    INSERT INTO projects (slug, title, source) VALUES ('ds-proje', 'DS Projesi', 'legacy_static');
    INSERT INTO project_designers (project_id, office_id) VALUES (1, 2);
  `);
}

await test('firma ataması, o firmanın projelerini düzenleme yetkisi verir', async () => {
  const db = freshDb(); seed(db); seedProject(db);
  const env = { DB: d1(db) };
  // 'Yönetici' görevli kurumsal hesap (madde 2) — yetkili
  assert.equal(await canUserEditProjectBySlug(env, { id: 'u-ds', role: 'user' }, 'ds-proje'), true);
  // 'Ekip Üyesi' görevli hesap — YETKİSİZ (mevcut kural, korunuyor)
  assert.equal(await canUserEditProjectBySlug(env, { id: 'u-ekip', role: 'user' }, 'ds-proje'), false);
  // başka firmanın sahibi — YETKİSİZ
  assert.equal(await canUserEditProjectBySlug(env, { id: 'u-arman', role: 'user' }, 'ds-proje'), false);
});

await test('GÖREVSİZ (office_position NULL) atama HİÇBİR yetki vermez — sessiz ölü onay', async () => {
  const db = freshDb(); seed(db); seedProject(db);
  db.exec(`UPDATE profile_claims SET office_position = NULL WHERE id = 'c-ds'`);
  const env = { DB: d1(db) };
  assert.equal(await canUserEditProjectBySlug(env, { id: 'u-ds', role: 'user' }, 'ds-proje'), false);
});

await test('kişi (architect) ataması görevden BAĞIMSIZ yetki verir', async () => {
  const db = freshDb(); seed(db);
  db.exec(`
    INSERT INTO projects (slug, title, source) VALUES ('arman-proje', 'Arman Projesi', 'legacy_static');
    INSERT INTO project_designers (project_id, architect_id) VALUES (1, 1);
  `);
  const now = Date.now();
  db.prepare(`INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at) VALUES ('c-arch','u-arman','architect','Arman Akdoğan','approved',?,?)`).run(now, now);
  const env = { DB: d1(db) };
  assert.equal(await canUserEditProjectBySlug(env, { id: 'u-arman', role: 'user' }, 'arman-proje'), true);
});

// ---- madde 4: noktalı ad araması ---------------------------------------------------------------
section('madde 4 — noktalı/kısaltmalı ad araması');

await test('queryWords ardışık baş harfleri birleştirir', () => {
  assert.deepEqual(queryWords('r.a.f. studio'), ['raf', 'studio']);
  assert.deepEqual(queryWords('raf studio'), ['raf', 'studio']);
  assert.deepEqual(queryWords('M. Ali'), ['m', 'ali']); // tek baş harf birleştirilmez
});

await test('fieldScore noktalı adı her iki yazımla da bulur', () => {
  for (const q of ['r.a.f. studio', 'raf studio', 'raf', 'R.A.F']) {
    assert.notEqual(fieldScore('R.A.F. Studio', queryWords(q)), null, `"${q}" eşleşmedi`);
  }
  // ters yön: ad noktasız, sorgu noktalı
  assert.notEqual(fieldScore('RAF Studio', queryWords('r.a.f. studio')), null);
});

await test('yanlış pozitif üretmez', () => {
  assert.equal(fieldScore('Arf Studio', queryWords('raf studio')), null);
  assert.equal(fieldScore('Studio Fara', queryWords('r.a.f. studio')), null);
});

await test('mevcut davranış korunur (tam ad > önek)', () => {
  const w = queryWords('galata');
  assert.ok(fieldScore('Galata Kulesi', w) > fieldScore('Galatasaray Lisesi', w));
});

await test('classicSearch: "r.a.f. studio" / "raf studio" / "raf" firmayı bulur', async () => {
  const db = freshDb(); seed(db);
  const env = { DB: d1(db) };
  for (const q of ['r.a.f. studio', 'raf studio', 'raf', 'R.A.F.']) {
    const r = await classicSearch(env, q, { perGroup: 20 });
    const names = r.offices.map(o => o.name);
    assert.ok(names.includes('R.A.F. Studio'), `"${q}" -> ${JSON.stringify(names)}`);
  }
});

await test('classicSearch: proje/ürün grupları da (künye + marka SQL yolu) çalışır', async () => {
  const db = freshDb(); seed(db);
  db.exec(`
    INSERT INTO projects (slug, title, location, source) VALUES ('raf-evi', 'R.A.F. Evi', 'İstanbul', 'legacy_static');
    INSERT INTO project_designers (project_id, office_id) VALUES (1, 1);
    INSERT INTO products (slug, title, brand_name_raw, category, kind, source) VALUES ('raf-koltuk', 'Koltuk', 'R.A.F. Studio', 'Oturma', 'product', 'legacy_static');
  `);
  const env = { DB: d1(db) };
  const r = await classicSearch(env, 'raf', { perGroup: 20 });
  assert.ok(r.projects.map(p => p.title).includes('R.A.F. Evi'), JSON.stringify(r.projects));
  assert.ok(r.products.map(p => p.title).includes('Koltuk'), JSON.stringify(r.products));
  // künye (designer_names) yolu: firma adıyla arayınca proje de gelmeli
  const r2 = await classicSearch(env, 'r.a.f. studio', { perGroup: 20 });
  assert.ok(r2.projects.map(p => p.title).includes('R.A.F. Evi'), JSON.stringify(r2.projects));
});

await test('classicSearch: alakasız sorgu bu firmayı getirmez', async () => {
  const db = freshDb(); seed(db);
  const env = { DB: d1(db) };
  const r = await classicSearch(env, 'ankara konut', { perGroup: 20 });
  assert.ok(!r.offices.map(o => o.name).includes('R.A.F. Studio'));
});

// ---- madde 2: Yönetici görevi ------------------------------------------------------------------
section('madde 2 — Yönetici görevi');

await test("'Yönetici' firma düzenleme yetkisi VERİR", () => {
  assert.ok(OFFICE_EDIT_POSITIONS.has('Yönetici'));
  assert.ok(!OFFICE_EDIT_POSITIONS.has('Ekip Üyesi'));
});

// ---- madde 2/6: firma payload'ı ----------------------------------------------------------------
section('madde 2 + 5 + 6 — firma pop-up payload');

async function officePayload(slug) {
  const db = freshDb(); seed(db);
  const env = { DB: d1(db), IMG_KV: null };
  const { buildOfficePayload } = await import('../src/routes/office.js');
  return buildOfficePayload(env, slug);
}

await test('Yönetici hesabı Kurucular/Ekip listelerinde GÖRÜNMEZ', async () => {
  const p = await officePayload('ds-mimarlik');
  const names = [...p.founders, ...p.team].map(x => x.name);
  assert.ok(!names.includes('DS Mimarlık'), `görünmemeliydi: ${JSON.stringify(names)}`);
  // aynı firmadaki normal ekip üyesi ETKİLENMEZ
  assert.ok(p.team.map(x => x.name).includes('Ayşe Demir'), JSON.stringify(names));
});

// KULLANICI BİLDİRİMİ, 2026-09-12: "MİMARLAB Robotu ekip üyesinin kişi profili olmasına rağmen
// üzerine tıklanmıyor." Hesap üyeliğinden (profile_claims) gelen ekip üyesinin adı bir architects
// satırıyla eşleşiyorsa kart o kişi profiline gitmeli — payload `slug` taşımazsa popup onu kişi
// profili olmayan biriyle aynı, tıklanamaz kart olarak çizer (js/components/office-modal.js#teamCardHtml).
await test('ekip üyesi: eşleşen kişi profili varsa slug taşır, yoksa taşımaz', async () => {
  const db = freshDb(); seed(db);
  db.prepare(`INSERT INTO architects (slug, name, position, source) VALUES ('ayse-demir', 'Ayşe Demir', 'Ekip Üyesi', 'legacy_static')`).run();
  const { buildOfficePayload } = await import('../src/routes/office.js');
  const withProfile = await buildOfficePayload({ DB: d1(db), IMG_KV: null }, 'ds-mimarlik');
  assert.equal(withProfile.team.find(x => x.name === 'Ayşe Demir').slug, 'ayse-demir');
  // Kişi profili olmayan aynı üye slug taşımaz — tıklanamaz kart korunur.
  const withoutProfile = await officePayload('ds-mimarlik');
  assert.equal(withoutProfile.team.find(x => x.name === 'Ayşe Demir').slug, null);
});

await test('aynı kişi hem Kurucular hem Ekip listesinde çıkmaz (aksan katlamalı)', async () => {
  const p = await officePayload('ind');
  assert.ok(p.founders.map(x => x.name).includes('Arman Akdoğan'));
  assert.ok(!p.team.map(x => x.name).includes('Arman Akdogan'), `Ekip: ${JSON.stringify(p.team)}`);
});

await test('claimed bayrağı: atanmış firma true, atanmamış firma false', async () => {
  assert.equal((await officePayload('ds-mimarlik')).claimed, true);
  assert.equal((await officePayload('bos-firma')).claimed, false);
});

// ---- madde 5: anyProfileClaimed ----------------------------------------------------------------
section('madde 5 — anyProfileClaimed');

await test('künyedeki adlardan biri atanmışsa true', async () => {
  const db = freshDb(); seed(db);
  const env = { DB: d1(db) };
  assert.equal(await anyProfileClaimed(env, ['Bilinmeyen', 'DS Mimarlık']), true);
  assert.equal(await anyProfileClaimed(env, ['Bilinmeyen', 'Boş Firma']), false);
  assert.equal(await anyProfileClaimed(env, []), false);
  assert.equal(await anyProfileClaimed(env, [null, '', '  ']), false);
});

await test('reddedilmiş claim sayılmaz', async () => {
  const db = freshDb(); seed(db);
  db.exec(`UPDATE profile_claims SET status = 'rejected'`);
  const env = { DB: d1(db) };
  assert.equal(await anyProfileClaimed(env, ['DS Mimarlık']), false);
});

// ---- madde 3: Ekip kutusundan çıkarma cascade'i ------------------------------------------------
section('madde 3 — Ekip kutusundan çıkarma');

function claimStatus(db, id) {
  return db.prepare(`SELECT status FROM profile_claims WHERE id = ?`).get(id).status;
}

await test('Ekip kutusundan çıkarılan üyenin claim\'i iptal olur', async () => {
  const db = freshDb(); seed(db);
  const env = { DB: d1(db) };
  await cascadeRemovedProfileClaims(env, 'DS Mimarlık', [], { founders: false });
  assert.equal(claimStatus(db, 'c-ekip'), 'rejected');
});

await test('Yönetici hesabının claim\'ine ASLA dokunulmaz', async () => {
  const db = freshDb(); seed(db);
  const env = { DB: d1(db) };
  await cascadeRemovedProfileClaims(env, 'DS Mimarlık', [], { founders: false });
  await cascadeRemovedProfileClaims(env, 'DS Mimarlık', [], { founders: true });
  assert.equal(claimStatus(db, 'c-ds'), 'approved');
});

await test('kutuda duran üye korunur — aksan/büyük-küçük harf farkı olsa da', async () => {
  const db = freshDb(); seed(db);
  const env = { DB: d1(db) };
  await cascadeRemovedProfileClaims(env, 'DS Mimarlık', ['AYSE DEMIR'], { founders: false });
  assert.equal(claimStatus(db, 'c-ekip'), 'approved');
});

await test('Kurucu görevli claim, EKİP kutusundan çıkarma ile iptal edilmez', async () => {
  const db = freshDb(); seed(db);
  const env = { DB: d1(db) };
  await cascadeRemovedProfileClaims(env, 'IND [Inter.National.Design]', [], { founders: false });
  assert.equal(claimStatus(db, 'c-arman'), 'approved');
  await cascadeRemovedProfileClaims(env, 'IND [Inter.National.Design]', [], { founders: true });
  assert.equal(claimStatus(db, 'c-arman'), 'rejected');
});

// ================================================================================================
// 2026-09-08 İKİNCİ TUR (kullanıcı isteği maddeleri 1-3)
// ================================================================================================

section('madde 1 — firma bağı admin onayına girer, firma profiline HEMEN eklenmez');

function seedForOfficeGate(db) {
  const now = Date.now();
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u-yeni','yeni@example.com','x','Yeni Üye','user',?)`).run(now);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u-admin','admin@example.com','x','Admin','admin',?)`).run(now);
  db.prepare(
    `INSERT INTO architect_submissions (id, owner_user_id, status, created_at, updated_at, name, office, position)
     VALUES ('sub-1','u-yeni','approved',?,?,'Yeni Üye','DS Mimarlık','Kurucu')`
  ).run(now, now);
}
function founderRows(db, officeName) {
  return db.prepare(
    `SELECT ar.name FROM office_founders f
      JOIN architects ar ON ar.id = f.architect_id
      JOIN offices o ON o.id = f.office_id
     WHERE o.name = ?`
  ).all(officeName).map(r => r.name);
}

await test('onaysız kullanıcı, firmanın Kurucular listesine EKLENMEZ', async () => {
  const db = freshDb(); seed(db); seedForOfficeGate(db);
  const env = { DB: d1(db) };
  const sub = parseSubmissionRow('architects', db.prepare(`SELECT * FROM architect_submissions WHERE id = 'sub-1'`).get());
  await syncApprovedSubmissionToCanonical(env, 'architects', sub);
  assert.ok(!founderRows(db, 'DS Mimarlık').includes('Yeni Üye'), JSON.stringify(founderRows(db, 'DS Mimarlık')));
  // kişi-tarafı "Firma: X" alanı YAZILIR — istek yalnızca firma profiline eklememekle ilgili
  const arch = db.prepare(`SELECT office_id FROM architects WHERE name = 'Yeni Üye'`).get();
  assert.ok(arch && arch.office_id, 'architects.office_id yazılmalıydı');
});

await test('onaylı profile_claims varsa firma profiline EKLENİR', async () => {
  const db = freshDb(); seed(db); seedForOfficeGate(db);
  const now = Date.now();
  db.prepare(`INSERT INTO profile_claims (id,user_id,profile_type,profile_key,status,created_at,updated_at,office_position) VALUES ('c-yeni','u-yeni','office','DS Mimarlık','approved',?,?,'Kurucu')`).run(now, now);
  const env = { DB: d1(db) };
  const sub = parseSubmissionRow('architects', db.prepare(`SELECT * FROM architect_submissions WHERE id = 'sub-1'`).get());
  await syncApprovedSubmissionToCanonical(env, 'architects', sub);
  assert.ok(founderRows(db, 'DS Mimarlık').includes('Yeni Üye'), JSON.stringify(founderRows(db, 'DS Mimarlık')));
});

await test('admin gönderisi kapıya takılmaz', async () => {
  const db = freshDb(); seed(db); seedForOfficeGate(db);
  db.exec(`UPDATE architect_submissions SET owner_user_id = 'u-admin' WHERE id = 'sub-1'`);
  const env = { DB: d1(db) };
  const sub = parseSubmissionRow('architects', db.prepare(`SELECT * FROM architect_submissions WHERE id = 'sub-1'`).get());
  await syncApprovedSubmissionToCanonical(env, 'architects', sub);
  assert.ok(founderRows(db, 'DS Mimarlık').includes('Yeni Üye'));
});

await test('VAR OLAN bağlantı, kural yürürlüğe girince silinmez', async () => {
  const db = freshDb(); seed(db); seedForOfficeGate(db);
  db.exec(`INSERT INTO architects (slug, name, source) VALUES ('yeni-uye','Yeni Üye','submission')`);
  const arId = db.prepare(`SELECT id FROM architects WHERE name = 'Yeni Üye'`).get().id;
  db.prepare(`UPDATE architects SET legacy_key = 'submission:sub-1' WHERE id = ?`).run(arId);
  db.prepare(`INSERT INTO office_founders (office_id, architect_id) VALUES (2, ?)`).run(arId);
  const env = { DB: d1(db) };
  const sub = parseSubmissionRow('architects', db.prepare(`SELECT * FROM architect_submissions WHERE id = 'sub-1'`).get());
  await syncApprovedSubmissionToCanonical(env, 'architects', sub);
  assert.ok(founderRows(db, 'DS Mimarlık').includes('Yeni Üye'), 'eski bağlantı korunmalıydı');
});

await test('ensurePendingOfficeClaims: bekleyen talep açar, kararı geri almaz', async () => {
  const db = freshDb(); seed(db); seedForOfficeGate(db);
  const env = { DB: d1(db) };
  const user = { id: 'u-yeni', role: 'user', name: 'Yeni Üye' };
  await ensurePendingOfficeClaims(env, user, ['DS Mimarlık', 'Olmayan Firma'], newId);
  const rows = db.prepare(`SELECT profile_key, status FROM profile_claims WHERE user_id = 'u-yeni'`).all();
  assert.equal(rows.length, 1);
  assert.deepEqual({ k: rows[0].profile_key, s: rows[0].status }, { k: 'DS Mimarlık', s: 'pending' });
  // admin reddettiyse yeniden kaydetmek talebi geri AÇMAZ
  db.exec(`UPDATE profile_claims SET status = 'rejected' WHERE user_id = 'u-yeni'`);
  await ensurePendingOfficeClaims(env, user, ['DS Mimarlık'], newId);
  assert.equal(db.prepare(`SELECT status FROM profile_claims WHERE user_id = 'u-yeni'`).get().status, 'rejected');
  // admin hiç talep üretmez
  await ensurePendingOfficeClaims(env, { id: 'u-admin', role: 'admin' }, ['DS Mimarlık'], newId);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM profile_claims WHERE user_id = 'u-admin'`).get().n, 0);
});

section('madde 2 — aksanlı ad araması');

await test('şapkalı/aksanlı adlar aksansız yazımla eşleşir', () => {
  const cases = [
    ['celaleddin', 'Celâleddin Çelik'], ['Celâleddin', 'Celâleddin Çelik'],
    ['celaleddin celik', 'Celâleddin Çelik'], ['ibrahim kamil', 'İbrahim Kâmil Ağa'],
    ['jose bruguera', 'José Bruguera'], ['edoc', 'èdoc architects'],
    ['dis mekan', 'Whale Dış Mekân Koleksiyonu'], ['lapseki', 'Lâpseki Hükümet Konağı'],
  ];
  for (const [q, t] of cases) assert.notEqual(fieldScore(t, queryWords(q)), null, `"${q}" -> "${t}"`);
  // yanlış pozitif üretmez
  assert.equal(fieldScore('Galata Kulesi', queryWords('celaleddin')), null);
});

await test('classicSearch D1 üzerinde aksanlı kişiyi bulur (SQL yolu)', async () => {
  const db = freshDb(); seed(db);
  db.exec(`INSERT INTO architects (slug, name, source) VALUES ('celaleddin-celik','Celâleddin Çelik','legacy_static'), ('jose','José Bruguera','legacy_static')`);
  const env = { DB: d1(db) };
  for (const q of ['celaleddin', 'Celâleddin Çelik', 'jose bruguera']) {
    const r = await classicSearch(env, q, { perGroup: 20 });
    assert.ok(r.architects.length, `"${q}" hiçbir kişi döndürmedi`);
  }
});

section('madde 2b — slugify aksanı KATLAR (düşürmez)');

await test('aksanlı adlar temiz slug üretir', () => {
  // Eskiden harita aksanı içermediğinden `[^a-z0-9]+ -> '-'` onları TİRE'ye çeviriyordu:
  // "Celâleddin Çelik" -> "cel-leddin-celik" (canlıda böyleydi).
  assert.equal(slugify('Celâleddin Çelik'), 'celaleddin-celik');
  assert.equal(slugify('José Bruguera'), 'jose-bruguera');
  assert.equal(slugify('İbrahim Kâmil Ağa'), 'ibrahim-kamil-aga');
  assert.equal(slugify('èdoc architects'), 'edoc-architects');
  assert.equal(slugify('Lâpseki Hükümet Konağı'), 'lapseki-hukumet-konagi');
  assert.equal(slugify('Renée'), 'renee');
  // Türkçe davranışı DEĞİŞMEDİ
  assert.equal(slugify('Şefik Birkiye'), 'sefik-birkiye');
  assert.equal(slugify('Galata Kulesi'), 'galata-kulesi');
  assert.equal(slugify('R.A.F. Studio'), 'r-a-f-studio');
});

section('madde 3 — atanan kişi profili hesap bilgilerini doldurur');

function seedArchitectProfile(db) {
  const now = Date.now();
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u-cc','cc@nunarch.com','x','Celaleddin Çelik','user',?)`).run(now);
  db.exec(`INSERT INTO architects (slug, name, dob, school, dept, profession, position, about, photo_url, awards, social_links, source)
           VALUES ('celaleddin-celik','Celâleddin Çelik','1985','İTÜ','Mimarlık','Mimar, Fotoğrafçı','Kurucu','Hakkında metni','/u/foto.webp','["Ödül A"]','[{"platform":"instagram","url":"https://x.test"}]','legacy_static')`);
}

await test('boş hesap alanları kişi profilinden dolar (slug çevirisiyle)', async () => {
  const db = freshDb(); seed(db); seedArchitectProfile(db);
  const env = { DB: d1(db) };
  assert.equal(await fillUserFromArchitectProfile(env, 'u-cc', 'Celâleddin Çelik'), true);
  const u = db.prepare(`SELECT * FROM users WHERE id = 'u-cc'`).get();
  assert.equal(u.dob, '1985');
  assert.equal(u.school, 'İTÜ');
  assert.equal(u.dept, 'Mimarlık');
  assert.equal(u.position, 'Kurucu');
  assert.equal(u.profession, 'mimar,fotografci');
  assert.equal(u.about, 'Hakkında metni');
  assert.equal(u.photo_url, '/u/foto.webp');
  assert.equal(u.name, 'Celaleddin Çelik', 'hesap adı EZİLMEMELİ');
});

await test('kullanıcının kendi girdiği değerlerin üzerine YAZILMAZ', async () => {
  const db = freshDb(); seed(db); seedArchitectProfile(db);
  db.exec(`UPDATE users SET school = 'ODTÜ', dob = '1990' WHERE id = 'u-cc'`);
  const env = { DB: d1(db) };
  await fillUserFromArchitectProfile(env, 'u-cc', 'Celâleddin Çelik');
  const u = db.prepare(`SELECT school, dob, dept FROM users WHERE id = 'u-cc'`).get();
  assert.equal(u.school, 'ODTÜ');
  assert.equal(u.dob, '1990');
  assert.equal(u.dept, 'Mimarlık', 'boş olan alan yine de dolmalı');
});

await test('listede olmayan pozisyon hesaba kopyalanmaz', async () => {
  const db = freshDb(); seed(db); seedArchitectProfile(db);
  db.exec(`UPDATE architects SET position = 'Baş Mimar' WHERE slug = 'celaleddin-celik'`);
  const env = { DB: d1(db) };
  await fillUserFromArchitectProfile(env, 'u-cc', 'Celâleddin Çelik');
  assert.equal(db.prepare(`SELECT position FROM users WHERE id = 'u-cc'`).get().position, null);
});

// ================================================================================================
// 2026-09-08 ÜÇÜNCÜ TUR — Hesabım "Firma / Marka Bilgileri" kutusunun office_founders kaynağı
// ================================================================================================
section('office_founders kaynağı — görünürlük ve düzenleme yetkisi');

function seedFounderLinks(db) {
  const now = Date.now();
  // (a) onaylı KİŞİ talebi olan, görevi Kurucu -> yetki VAR
  db.prepare(`INSERT INTO users (id,email,password_hash,name,role,created_at) VALUES ('u-k','k@e.com','x','Kaan Çorbacı','user',?)`).run(now);
  db.exec(`INSERT INTO architects (slug,name,position,source) VALUES ('kaan-corbaci','Kaan Çorbacı','Kurucu','legacy_static')`);
  const kid = db.prepare(`SELECT id FROM architects WHERE slug='kaan-corbaci'`).get().id;
  db.prepare(`INSERT INTO profile_claims (id,user_id,profile_type,profile_key,status,created_at,updated_at) VALUES ('pc-k','u-k','architect','Kaan Çorbacı','approved',?,?)`).run(now, now);
  // (b) TALEBİ OLMAYAN ama hesap adı kişi kaydıyla eşleşen kullanıcı -> görünürlük VAR, yetki YOK
  db.prepare(`INSERT INTO users (id,email,password_hash,name,role,created_at) VALUES ('u-r','r@e.com','x','MİMARLAB Robotu','user',?)`).run(now);
  db.exec(`INSERT INTO architects (slug,name,position,source) VALUES ('mimarlab-robotu','MİMARLAB Robotu','Kurucu','legacy_static')`);
  const rid = db.prepare(`SELECT id FROM architects WHERE slug='mimarlab-robotu'`).get().id;
  // (c) onaylı talebi olan ama görevi Ekip Üyesi -> görünürlük VAR, yetki YOK
  db.prepare(`INSERT INTO users (id,email,password_hash,name,role,created_at) VALUES ('u-e','e@e.com','x','Ekip Kişi','user',?)`).run(now);
  db.exec(`INSERT INTO architects (slug,name,position,source) VALUES ('ekip-kisi','Ekip Kişi','Ekip Üyesi','legacy_static')`);
  const eid = db.prepare(`SELECT id FROM architects WHERE slug='ekip-kisi'`).get().id;
  db.prepare(`INSERT INTO profile_claims (id,user_id,profile_type,profile_key,status,created_at,updated_at) VALUES ('pc-e','u-e','architect','Ekip Kişi','approved',?,?)`).run(now, now);
  // Üçü de "DS Mimarlık" (id 2) ve "Boş Firma" (id 4) firmalarına bağlı
  for (const id of [kid, rid, eid]) {
    db.prepare(`INSERT INTO office_founders (office_id, architect_id) VALUES (2, ?)`).run(id);
  }
  db.prepare(`INSERT INTO office_founders (office_id, architect_id) VALUES (4, ?)`).run(kid);
}

await test('kişi kaydını bulmanın İKİ yolu da çözülür (talep + ad eşleşmesi)', async () => {
  const db = freshDb(); seed(db); seedFounderLinks(db);
  const env = { DB: d1(db) };
  const k = await fetchOwnArchitectRows(env, { id: 'u-k', name: 'Kaan Çorbacı' });
  assert.equal(k.claimed.length, 1);
  const r = await fetchOwnArchitectRows(env, { id: 'u-r', name: 'MİMARLAB Robotu' });
  assert.equal(r.claimed.length, 0);
  assert.equal(r.selfNamed.length, 1, 'ad eşleşmesi yolu çalışmalı');
  // Türkçe katlama: hesap adı farklı yazılmış olsa da eşleşir
  const r2 = await fetchOwnArchitectRows(env, { id: 'u-r', name: 'MIMARLAB ROBOTU' });
  assert.equal(r2.selfNamed.length, 1);
});

await test('TALEBİ OLMAYAN kullanıcı da firmalarını görür (canlı bulgu: iki firma, tek satır)', async () => {
  const db = freshDb(); seed(db); seedFounderLinks(db);
  const env = { DB: d1(db) };
  const links = await fetchOfficeFounderLinks(env, { id: 'u-r', name: 'MİMARLAB Robotu' }, OFFICE_EDIT_POSITIONS);
  assert.deepEqual(links.map(l => l.name), ['DS Mimarlık']);
  assert.equal(links[0].canEdit, false, 'ad eşleşmesi düzenleme yetkisi VERMEZ');
  // onaylı talebi olan kullanıcıda iki firma da listelenir
  const kLinks = await fetchOfficeFounderLinks(env, { id: 'u-k', name: 'Kaan Çorbacı' }, OFFICE_EDIT_POSITIONS);
  assert.deepEqual(kLinks.map(l => l.name).sort(), ['Boş Firma', 'DS Mimarlık']);
  assert.ok(kLinks.every(l => l.canEdit), 'onaylı talep + Kurucu -> yetki VAR');
});

await test('düzenleme yetkisi: onaylı talep + yetkili görev şartı', async () => {
  const db = freshDb(); seed(db); seedFounderLinks(db);
  const env = { DB: d1(db) };
  const can = (u, name) => canEditOfficeViaFounderLink(env, u, name, OFFICE_EDIT_POSITIONS);
  assert.equal(await can({ id: 'u-k', name: 'Kaan Çorbacı' }, 'DS Mimarlık'), true);
  assert.equal(await can({ id: 'u-k', name: 'Kaan Çorbacı' }, 'Boş Firma'), true);
  // bağlı OLMADIĞI firma
  assert.equal(await can({ id: 'u-k', name: 'Kaan Çorbacı' }, 'IND [Inter.National.Design]'), false);
  // talebi yok (yalnızca ad eşleşmesi) -> yetki YOK
  assert.equal(await can({ id: 'u-r', name: 'MİMARLAB Robotu' }, 'DS Mimarlık'), false);
  // talebi var ama görevi Ekip Üyesi -> yetki YOK
  assert.equal(await can({ id: 'u-e', name: 'Ekip Kişi' }, 'DS Mimarlık'), false);
  // kullanıcı yok
  assert.equal(await can(null, 'DS Mimarlık'), false);
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) { for (const f of failures) console.error(` - ${f.name}: ${f.message}`); process.exit(1); }
