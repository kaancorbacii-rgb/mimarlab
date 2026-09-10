#!/usr/bin/env node
// FİRMA/MARKA YETKİLİSİNİN, FİRMA ORTAKLARININ KİŞİ PROFİLLERİNİ DÜZENLEMESİ — BİRİM TESTLERİ
// (kullanıcı isteği, 2026-09-08: "Bir firmanın kurucusu, kurucu ortağı, ortağı veya ekip lideri de
// diğer firma ortaklarının profillerini düzenleme yetkisine sahip olsun ... Aynı kural marka
// profilleri ve marka kurucuları, ortakları vs. için de geçerli.")
//
// scripts/test-2026-09-08-round.mjs ile AYNI desen: test koşucusu/npm bağımlılığı yok, node:assert +
// node:sqlite üzerinde GERÇEK bir SQLite ve schema.sql. Kural sunucuda TEK yerde yaşıyor
// (src/lib/claimedProfiles.js#canEditArchitectViaOfficeMembership) — hem kaydetme kapısı
// (submissions.js#verifyClaimedProfileKey) hem istemcinin Düzenle butonu (/api/claims/status ->
// delegatedEdit) bu fonksiyonu okur, dolayısıyla burada test edilen şey ikisinin de davranışıdır.
//
// Senaryolar canlı veriden alındı: Rasa Studio (Tuna Han Koç -> Fatma Zeynep Altınbaşlı) ve
// DS Mimarlık ('Yönetici' görevli kurumsal hesap -> Deniz/Sevim Aslan).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { canEditArchitectViaOfficeMembership } from '../src/lib/claimedProfiles.js';
import { OFFICE_EDIT_POSITIONS, MANAGER_POSITION, canUserEditProjectBySlug, canUserEditProductBySlug } from '../src/lib/projectClaimAccess.js';
import { handleClaimsRoute } from '../src/routes/claims.js';
import { handleSubmissionRoute } from '../src/routes/submissions.js';
import { sha256Hex } from '../src/lib/crypto.js';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 4).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }

// ---- D1 shim (node:sqlite) — test-2026-09-08-round.mjs ile BİREBİR aynı ------------------------
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

// offices: 1 Rasa Studio, 2 DS Mimarlık, 3 Yabancı Firma, 4 Vitrium (marka)
// architects: 1 Tuna Han Koç, 2 Fatma Zeynep Altınbaşlı, 3 Deniz Aslan, 4 Yabancı Mimar,
//             5 Serbest Ekip Üyesi (yalnızca serbest metin Ekip kutusunda), 6 Marka Ortağı
function seed(db) {
  const now = Date.now();
  db.exec(`
    INSERT INTO offices (slug, name, loc, cats, source) VALUES
      ('rasa-studio', 'Rasa Studio', 'İstanbul / Beşiktaş', '["Mimarlık"]', 'legacy_static'),
      ('ds-mimarlik', 'DS Mimarlık', 'İstanbul / Beyoğlu', '["Mimarlık"]', 'legacy_static'),
      ('yabanci-firma', 'Yabancı Firma', 'Ankara', '["Mimarlık"]', 'legacy_static'),
      ('vitrium', 'Vitrium', 'İzmir', '["Mobilya"]', 'legacy_static');
    INSERT INTO architects (slug, name, position, source) VALUES
      ('tuna-han-koc', 'Tuna Han Koç', 'Kurucu', 'legacy_static'),
      ('fatma-zeynep-altinbasli', 'Fatma Zeynep Altınbaşlı', 'Kurucu', 'legacy_static'),
      ('deniz-aslan', 'Deniz Aslan', 'Kurucu Ortak', 'legacy_static'),
      ('yabanci-mimar', 'Yabancı Mimar', 'Kurucu', 'legacy_static'),
      ('serbest-ekip-uyesi', 'Serbest Ekip Üyesi', 'Ekip Üyesi', 'legacy_static'),
      ('marka-ortagi', 'Marka Ortağı', 'Ortak', 'legacy_static');
    INSERT INTO office_founders (office_id, architect_id) VALUES
      (1, 1), (1, 2), (2, 3), (3, 4), (4, 6);
  `);
  const mkUser = (id, name, email) => db.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, 'x', ?, 'user', ?)`
  ).run(id, email, name, now);
  mkUser('u-tuna', 'Tuna Han Koç', 'thankoc@example.com');
  mkUser('u-ds', 'DS Mimarlık', 'comm@example.com');
  mkUser('u-ekip', 'Ekip Üyesi Hesabı', 'ekip@example.com');
  mkUser('u-fatma', 'Fatma Zeynep Altınbaşlı', 'fatma@example.com');
  mkUser('u-marka', 'Vitrium', 'vitrium@example.com');

  const mkOfficeClaim = (id, user, key, pos) => db.prepare(
    `INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at, office_position) VALUES (?, ?, 'office', ?, 'approved', ?, ?, ?)`
  ).run(id, user, key, now, now, pos);
  const mkArchClaim = (id, user, key) => db.prepare(
    `INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at) VALUES (?, ?, 'architect', ?, 'approved', ?, ?)`
  ).run(id, user, key, now, now);

  // Rasa Studio: Tuna'ya HEM kişi HEM firma profili atanmış (canlı senaryo).
  mkOfficeClaim('c-tuna-office', 'u-tuna', 'Rasa Studio', 'Kurucu');
  mkArchClaim('c-tuna-arch', 'u-tuna', 'Tuna Han Koç');
  // DS Mimarlık: firmanın KENDİ kurumsal hesabı, 'Yönetici' görevli.
  mkOfficeClaim('c-ds-office', 'u-ds', 'DS Mimarlık', MANAGER_POSITION);
  // Aynı firmada 'Ekip Üyesi' görevli hesap — firma künyesini bile düzenleyemez.
  mkOfficeClaim('c-ekip-office', 'u-ekip', 'DS Mimarlık', 'Ekip Üyesi');
  // Marka (offices satırı, claim tipi yine 'office') — ayrı bir kod yolu YOK.
  mkOfficeClaim('c-marka-office', 'u-marka', 'Vitrium', 'Kurucu');
}

const asUser = (id) => ({ id, role: 'user' });
const canEdit = (env, userId, key) =>
  canEditArchitectViaOfficeMembership(env, asUser(userId), key, OFFICE_EDIT_POSITIONS);

section('firma yetkilisi -> ortağının kişi profili');

await test('Rasa Studio kurucusu, ortağının kişi profilini düzenleyebilir', async () => {
  const db = freshDb(); seed(db);
  const env = { DB: d1(db) };
  assert.equal(await canEdit(env, 'u-tuna', 'Fatma Zeynep Altınbaşlı'), true);
  // slug ve legacy_key ile de aynı sonuç (istemci ?claim= anahtarını slug olarak da gönderebilir)
  assert.equal(await canEdit(env, 'u-tuna', 'fatma-zeynep-altinbasli'), true);
});

await test("'Yönetici' görevli kurumsal hesap, firma ortaklarının profillerini düzenleyebilir", async () => {
  const db = freshDb(); seed(db);
  const env = { DB: d1(db) };
  assert.equal(await canEdit(env, 'u-ds', 'Deniz Aslan'), true);
});

await test('marka yetkilisi için AYNI kural geçerli (marka = offices satırı)', async () => {
  const db = freshDb(); seed(db);
  const env = { DB: d1(db) };
  assert.equal(await canEdit(env, 'u-marka', 'Marka Ortağı'), true);
});

await test('serbest metin "Ekip" kutusundaki isim de kapsanır (office_founders bağı olmadan)', async () => {
  const db = freshDb(); seed(db);
  const now = Date.now();
  // firma-ekle.html'in serbest metin Ekip kutusu — bkz. src/routes/office.js#fetchRawTeamNames.
  db.prepare(
    `INSERT INTO office_submissions (id, owner_user_id, status, created_at, updated_at, name, claimed_profile_key, team)
     VALUES ('s-rasa', 'u-tuna', 'approved', ?, ?, 'Rasa Studio', 'Rasa Studio', '["Serbest Ekip Üyesi"]')`
  ).run(now, now);
  const env = { DB: d1(db) };
  assert.equal(await canEdit(env, 'u-tuna', 'Serbest Ekip Üyesi'), true);
  // aksan/büyük-küçük farkı da katlanır (foldTr)
  db.prepare(`UPDATE office_submissions SET team = '["serbest ekip uyesi"]' WHERE id = 's-rasa'`).run();
  assert.equal(await canEdit(env, 'u-tuna', 'Serbest Ekip Üyesi'), true);
});

// FİRMA/MARKA YÖNETİCİSİNİN PROJE VE ÜRÜNLERİ (kullanıcı isteği, 2026-09-10 madde 2: "Bir
// kullanıcıya bir firma ya da marka için Yönetici yetkisi verdiğim bu kullanıcı firmanın/markanın
// projeleri, ürünleri, kurucusu, ortağı, kurucu ortağı ve ekip lideri profillerini de düzenleme
// yetkisine sahip olsun."). Kişi profilleri yukarıda test ediliyor; proje/ürün tarafı 'Yönetici'nin
// OFFICE_EDIT_POSITIONS içinde olmasından TÜREDİĞİ için buraya kadar örtük kalmıştı — garanti artık
// açıkça sınanıyor, aksi halde o kümeden çıkarılması sessizce fark edilmezdi.
section('firma/marka yöneticisi -> firmanın projeleri ve markanın ürünleri');

// project_designers üzerinden firmaya bağlı bir proje + markaya bağlı bir ürün ekler.
function seedProjectAndProduct(db) {
  db.exec(`
    INSERT INTO projects (slug, title, source) VALUES ('ds-proje', 'DS Projesi', 'legacy_static');
    INSERT INTO project_designers (project_id, office_id) VALUES (1, 2);
    INSERT INTO products (slug, title, kind, brand_office_id, source) VALUES ('vitrium-urun', 'Vitrium Sandalye', 'product', 4, 'legacy_static');
  `);
}

await test("'Yönetici' görevli hesap, firmanın künyeli projesini düzenleyebilir", async () => {
  const db = freshDb(); seed(db); seedProjectAndProduct(db);
  const env = { DB: d1(db) };
  assert.equal(await canUserEditProjectBySlug(env, asUser('u-ds'), 'ds-proje'), true);
  // Aynı firmadaki 'Ekip Üyesi' görevli hesap projeye de dokunamaz (firma künyesini de düzenleyemiyor).
  assert.equal(await canUserEditProjectBySlug(env, asUser('u-ekip'), 'ds-proje'), false);
  // Başka bir firmanın yöneticisi de hayır.
  assert.equal(await canUserEditProjectBySlug(env, asUser('u-marka'), 'ds-proje'), false);
});

await test('marka yetkilisi, markanın ürününü düzenleyebilir', async () => {
  const db = freshDb(); seed(db); seedProjectAndProduct(db);
  const env = { DB: d1(db) };
  assert.equal(await canUserEditProductBySlug(env, asUser('u-marka'), 'vitrium-urun'), true);
  assert.equal(await canUserEditProductBySlug(env, asUser('u-ds'), 'vitrium-urun'), false);
});

section('yetkisiz durumlar');

await test('başka bir firmanın ortağının profili düzenlenemez', async () => {
  const db = freshDb(); seed(db);
  const env = { DB: d1(db) };
  assert.equal(await canEdit(env, 'u-tuna', 'Yabancı Mimar'), false);
  assert.equal(await canEdit(env, 'u-ds', 'Fatma Zeynep Altınbaşlı'), false);
});

await test("'Ekip Üyesi' görevli hesap hiçbir ortağın profilini düzenleyemez", async () => {
  const db = freshDb(); seed(db);
  const env = { DB: d1(db) };
  assert.equal(await canEdit(env, 'u-ekip', 'Deniz Aslan'), false);
});

// Aşağıdaki üç negatif senaryoda DS Mimarlık'ın kurumsal hesabı kullanılır: Tuna'nın onaylı KİŞİ
// talebi + Kurucular bağı üzerinden ayrıca ikinci bir yetki yolu var (bkz. son bölüm), bu yüzden
// yalnızca firma talebini bozmak onda yetkiyi kaldırmaya yetmez.
await test('GÖREVSİZ (office_position NULL) onay yetki VERMEZ', async () => {
  const db = freshDb(); seed(db);
  db.exec(`UPDATE profile_claims SET office_position = NULL WHERE id = 'c-ds-office'`);
  const env = { DB: d1(db) };
  assert.equal(await canEdit(env, 'u-ds', 'Deniz Aslan'), false);
});

await test('canlı users.position ile yetki YÜKSELTİLEMEZ (dondurulmuş görev asıldır)', async () => {
  const db = freshDb(); seed(db);
  db.exec(`UPDATE profile_claims SET office_position = 'Ekip Üyesi' WHERE id = 'c-ds-office'`);
  db.exec(`UPDATE users SET position = 'Kurucu' WHERE id = 'u-ds'`);
  const env = { DB: d1(db) };
  assert.equal(await canEdit(env, 'u-ds', 'Deniz Aslan'), false);
});

await test('BEKLEYEN (pending) firma talebi yetki vermez', async () => {
  const db = freshDb(); seed(db);
  db.exec(`UPDATE profile_claims SET status = 'pending' WHERE id = 'c-ds-office'`);
  const env = { DB: d1(db) };
  assert.equal(await canEdit(env, 'u-ds', 'Deniz Aslan'), false);
});

await test('BAŞKA bir hesabın sahiplendiği profile bu kapı KAPALI', async () => {
  const db = freshDb(); seed(db);
  const now = Date.now();
  db.prepare(
    `INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at)
     VALUES ('c-fatma-arch', 'u-fatma', 'architect', 'Fatma Zeynep Altınbaşlı', 'approved', ?, ?)`
  ).run(now, now);
  const env = { DB: d1(db) };
  assert.equal(await canEdit(env, 'u-tuna', 'Fatma Zeynep Altınbaşlı'), false);
  assert.equal(await canEdit(env, 'u-ds', 'Fatma Zeynep Altınbaşlı'), false);
  // Kapı sahibin KENDİSİNİ kilitlemez (user_id != ?) — Fatma zaten kendi talebiyle düzenleyebilir,
  // asıl kapı verifyClaimedProfileKey'in claim dalıdır.
  assert.equal(await canEdit(env, 'u-fatma', 'Fatma Zeynep Altınbaşlı'), true);
});

await test('silinmiş firma ya da olmayan kişi için false döner', async () => {
  const db = freshDb(); seed(db);
  const env = { DB: d1(db) };
  assert.equal(await canEdit(env, 'u-tuna', 'Hiç Olmayan Kişi'), false);
  db.exec(`UPDATE offices SET deleted_at = ${Date.now()} WHERE id = 1`);
  assert.equal(await canEdit(env, 'u-tuna', 'Fatma Zeynep Altınbaşlı'), false);
});

section('ikinci yol: firma claim\'i olmadan Kurucular bağı üzerinden');

await test('onaylı KİŞİ talebi + Kurucular bağı + yetkili görev, ortağın profiline de yeter', async () => {
  const db = freshDb(); seed(db);
  // Tuna'nın firma claim'i YOK, yalnızca kişi claim'i var (canEditOfficeViaFounderLink yolu).
  db.exec(`DELETE FROM profile_claims WHERE id = 'c-tuna-office'`);
  const env = { DB: d1(db) };
  assert.equal(await canEdit(env, 'u-tuna', 'Fatma Zeynep Altınbaşlı'), true);
  // aynı yol yetkisiz görevle (architects.position) çalışmaz
  db.exec(`UPDATE architects SET position = 'Ekip Üyesi' WHERE id = 1`);
  assert.equal(await canEdit(env, 'u-tuna', 'Fatma Zeynep Altınbaşlı'), false);
});

await test('yalnızca AD EŞLEŞMESİ (onaysız kişi kaydı) bu kapıdan geçmez', async () => {
  const db = freshDb(); seed(db);
  db.exec(`DELETE FROM profile_claims WHERE id = 'c-tuna-office' OR id = 'c-tuna-arch'`);
  const env = { DB: d1(db) };
  // u-tuna'nın adı 'Tuna Han Koç' kişi kaydıyla birebir eşleşiyor ama admin onayı yok.
  assert.equal(await canEdit(env, 'u-tuna', 'Fatma Zeynep Altınbaşlı'), false);
});

// ---- UÇTAN UCA: gerçek rotalar (test-messages-avatars.mjs ile AYNI desen) ----------------------
// Kural iki uçtan birden okunuyor; ikisi de GERÇEKTEN çağrılır ki istemcinin gördüğü buton ile
// kaydetme kapısı ayrışmasın (bkz. denetim 2026-09-04'teki "boş yere doldurulan form, sonra 403").
section('uçtan uca — /api/claims/status ve POST /api/architects');

async function withSessions(db) {
  const now = Date.now();
  for (const uid of ['u-tuna', 'u-ds', 'u-ekip']) {
    db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
      .run(await sha256Hex(`tok-${uid}`), uid, now, now + 3600_000);
  }
}
const req = (uid, path, init = {}) => new Request(`https://mimarlab.com${path}`, {
  ...init,
  headers: { 'Content-Type': 'application/json', Cookie: `__Host-mimarlab_session=tok-${uid}`, ...(init.headers || {}) },
});

await test('/api/claims/status: delegatedEdit yalnızca yetkili firma ortağına true döner', async () => {
  const db = freshDb(); seed(db); await withSessions(db);
  const env = { DB: d1(db) };
  const call = async (uid) => {
    const url = new URL(`https://mimarlab.com/api/claims/status?profileType=architect&profileKey=${encodeURIComponent('Fatma Zeynep Altınbaşlı')}`);
    const res = await handleClaimsRoute(req(uid, url.pathname + url.search), env, url);
    return res.json();
  };
  assert.equal((await call('u-tuna')).delegatedEdit, true);
  assert.equal((await call('u-ekip')).delegatedEdit, false);
  assert.equal((await call('u-ds')).delegatedEdit, false);
});

await test('POST /api/architects: yetkili ortak kaydedebilir, yetkisiz 403 alır', async () => {
  const db = freshDb(); seed(db); await withSessions(db);
  const env = { DB: d1(db) };
  const save = (uid) => handleSubmissionRoute(
    req(uid, '/api/architects', { method: 'POST', body: JSON.stringify({ name: 'Fatma Zeynep Altınbaşlı', claimed_profile_key: 'Fatma Zeynep Altınbaşlı', about: 'Güncellendi', rightsAccepted: true }) }),
    env, new URL('https://mimarlab.com/api/architects'),
  );
  const ok = await save('u-tuna');
  assert.equal(ok.status, 201, `beklenen 201, gelen ${ok.status}: ${await ok.clone().text()}`);
  // claimed_profile_key'li düzenleme admin onayına düşmez, doğrudan yayına girer (mevcut kural).
  assert.equal((await ok.json()).status, 'approved');
  // Düzenleme GERÇEKTEN kişinin canonical profiline işledi mi (onay kuyruğuna düşmeden)?
  assert.equal(db.prepare(`SELECT about FROM architects WHERE name = 'Fatma Zeynep Altınbaşlı'`).get().about, 'Güncellendi');
  const denied = await save('u-ekip');
  assert.equal(denied.status, 403);
});

// KURAL DEĞİŞTİ (kullanıcı isteği, 2026-09-10 madde 2): delegasyon ARTIK arşivleme/silme yetkisi
// de verir — moderasyon kapısı düzenlemeyle AYNI (src/routes/submissions.js#canAccessSubmissionRow).
// Bu testin eski hâli tam tersini iddia ediyordu ("delegasyon SİLME/ARŞİVLEME yetkisi vermez").
await test('delegasyon ARTIK arşivleme/silme yetkisi de verir', async () => {
  const db = freshDb(); seed(db); await withSessions(db);
  const env = { DB: d1(db) };
  const created = await handleSubmissionRoute(
    req('u-tuna', '/api/architects', { method: 'POST', body: JSON.stringify({ name: 'Fatma Zeynep Altınbaşlı', claimed_profile_key: 'Fatma Zeynep Altınbaşlı', rightsAccepted: true }) }),
    env, new URL('https://mimarlab.com/api/architects'),
  );
  const id = (await created.json()).id;
  const res = await handleSubmissionRoute(
    req('u-tuna', `/api/architects/${id}/moderate`, { method: 'POST', body: JSON.stringify({ action: 'archive' }) }),
    env, new URL(`https://mimarlab.com/api/architects/${id}/moderate`),
  );
  assert.equal(res.status, 200);
  // Arşiv = canonical satır hidden_at ile canlıdan çekilir (SİLİNMEZ), taslak 'archived' olur.
  const row = db.prepare(`SELECT hidden_at, deleted_at FROM architects WHERE name = 'Fatma Zeynep Altınbaşlı'`).get();
  assert.ok(row.hidden_at, 'hidden_at damgalanmalı');
  assert.equal(row.deleted_at, null);
});

await test('KENDİ SAHİBİ OLAN profile moderasyon kapısı da KAPALI (SINIR korunuyor)', async () => {
  const db = freshDb(); seed(db); await withSessions(db);
  // Fatma kendi profilini sahiplenmiş -> Tuna (Rasa Studio kurucusu) artık ne düzenleyebilir ne de
  // arşivleyebilir. Bu, madde 2'nin tek güvenlik ağı (bkz. claimedProfiles.js#SINIR).
  const now = Date.now();
  db.prepare(`INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at) VALUES ('c-fatma-arch', 'u-fatma', 'architect', 'Fatma Zeynep Altınbaşlı', 'approved', ?, ?)`).run(now, now);
  const env = { DB: d1(db) };
  const created = await handleSubmissionRoute(
    req('u-tuna', '/api/architects', { method: 'POST', body: JSON.stringify({ name: 'Fatma Zeynep Altınbaşlı', claimed_profile_key: 'Fatma Zeynep Altınbaşlı', rightsAccepted: true }) }),
    env, new URL('https://mimarlab.com/api/architects'),
  );
  assert.equal(created.status, 403);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.error('\nBaşarısız testler:');
  for (const f of failures) console.error(`  - ${f.name}: ${f.message}`);
  process.exit(1);
}
