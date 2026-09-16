#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-16 (YEDİNCİ tur) — yedi madde, tek test dosyası.
//
// 1. Kişi künyesinin rozeti pop-up'larda VE Hesabım > Kişi Bilgileri'nde görünmeli.
// 2. Firma pop-up'ında kapak varken firma-ekle ?claim= yolunda kutu BOŞ açılıyordu.
// 3. "Profili Düzenle" pop-up'ında e-posta SALT OKUNUR bir kutuda görünmeli.
// 4. Sıfırdan eklenen kişi/firmanın yöneticisi ekleyendir; AYNI ADLA ikinci kayıt açılamaz (zaten
//    vardı — bu tur yalnızca kelepçeleniyor).
// 5. Firma künyesine, BAŞKA bir firmada görünen bir kişi eklenirse: o firmanın yöneticisine +
//    admine bildirim; onaya kadar kişi firma künyesinde GÖRÜNMEZ.
// 6. Kişi künyesine, YÖNETİCİSİ OLAN bir firma eklenirse: o firmanın yöneticisine + admine
//    bildirim; onaya kadar firma kişi künyesinde GÖRÜNMEZ.
// 7. Rozet yalnızca KİŞİ/FİRMA profilleri için alınabilir (hesaplar için alınamaz) ve yalnızca
//    kullanıcının yönettiği firma + o firmadaki kişiler için.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { planOfficePeopleWithhold, planArchitectOfficesWithhold, createMembershipClaims, officeManagerIds } from '../src/lib/membershipClaims.js';
import { normalizeTarget, getBadgePrice, verifyBadgeTargetOwnership, userManagedArchitectNames } from '../src/routes/badges.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

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
  db.exec(read('../schema.sql'));
  db.exec(read('../migrations/0079_search_fold_columns.sql'));
  return db;
}
const now = Date.now();
// name_fold ÜRETİLMİŞ (generated) bir kolondur (bkz. migrations/0079_search_fold_columns.sql) —
// INSERT'te verilmez, SQLite onu addan kendisi hesaplar. Bu, kapının foldTr yedeğini (yazım farkı)
// gerçek şemayla test etmemizi sağlar.
function seed(db) {
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('admin1','a@b.com','x','Admin','admin',?)`).run(now);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('mgrA','m@a.com','x','Yönetici A','user',?)`).run(now);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('mgrB','m@b.com','x','Yönetici B','user',?)`).run(now);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('uX','x@x.com','x','Üye X','user',?)`).run(now);
  const slugOf = (n) => n.toLowerCase().replace(/[çğıöşü]/g, (c) => ({ 'ç':'c','ğ':'g','ı':'i','ö':'o','ş':'s','ü':'u' }[c])).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  for (const [id, name] of [[1, 'A Mimarlık'], [2, 'B Tasarım'], [3, 'Sahipsiz Ofis']]) {
    db.prepare(`INSERT INTO offices (id, name, slug, created_at) VALUES (?, ?, ?, ?)`).run(id, name, slugOf(name), now);
  }
  for (const [id, name] of [[10, 'Ayça Akkaya'], [11, 'Yeni Kişi']]) {
    db.prepare(`INSERT INTO architects (id, name, slug, created_at) VALUES (?, ?, ?, ?)`).run(id, name, slugOf(name), now);
  }
  // Ayça, A Mimarlık'ta görünüyor (yapısal bağ).
  db.prepare(`INSERT INTO office_founders (office_id, architect_id) VALUES (1, 10)`).run();
  // A Mimarlık'ın yöneticisi mgrA, B Tasarım'ın yöneticisi mgrB. 'Sahipsiz Ofis'in yöneticisi YOK.
  for (const [uid, office] of [['mgrA', 'A Mimarlık'], ['mgrB', 'B Tasarım']]) {
    db.prepare(
      `INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, office_position, created_at, updated_at)
       VALUES (?, ?, 'office', ?, 'approved', 'Yönetici', ?, ?)`
    ).run(`c-${uid}`, uid, office, now, now);
  }
  return d1(db);
}

section('madde 5 — firma künyesine BAŞKA firmada görünen kişiyi eklemek');

await test('kişi başka bir firmada görünüyorsa ad GERİ ÇEKİLİR ve karar o firmaya gider', async () => {
  const db = freshDb(); const env = { DB: seed(db) };
  const plan = await planOfficePeopleWithhold(env, { id: 'mgrB', role: 'user' }, 'B Tasarım', { founders: ['Ayça Akkaya'], team: [] });
  assert.equal(plan.withheld.length, 1);
  assert.equal(plan.withheld[0].name, 'Ayça Akkaya');
  assert.equal(plan.withheld[0].slot, 'founders');
  assert.equal(plan.withheld[0].officeName, 'B Tasarım');
  // Kararı, kişinin ZATEN göründüğü firma verir — kullanıcı isteğinin ta kendisi ("o firmanın
  // yöneticisine ve admine bildirim gitsin").
  assert.equal(plan.withheld[0].deciderOfficeName, 'A Mimarlık');
});

await test('hiçbir firmada görünmeyen kişide kapı YOK (davranış değişmedi)', async () => {
  const db = freshDb(); const env = { DB: seed(db) };
  const plan = await planOfficePeopleWithhold(env, { id: 'mgrB', role: 'user' }, 'B Tasarım', { founders: ['Yeni Kişi'], team: [] });
  assert.equal(plan.withheld.length, 0, '"zaten başka bir firmada gözüküyorsa" koşulu sağlanmıyor');
});

await test('ADMIN muaf', async () => {
  const db = freshDb(); const env = { DB: seed(db) };
  const plan = await planOfficePeopleWithhold(env, { id: 'admin1', role: 'admin' }, 'B Tasarım', { founders: ['Ayça Akkaya'], team: [] });
  assert.equal(plan.withheld.length, 0, 'admin bu kuyruğun onaylayıcısıdır');
});

await test('diğer firmayı DA yöneten kullanıcı muaf (onaylayacak kişi kendisi)', async () => {
  const db = freshDb(); const env = { DB: seed(db) };
  const plan = await planOfficePeopleWithhold(env, { id: 'mgrA', role: 'user' }, 'B Tasarım', { founders: ['Ayça Akkaya'], team: [] });
  assert.equal(plan.withheld.length, 0);
});

await test('sitede kaydı olmayan serbest metin ad kapı DIŞI', async () => {
  const db = freshDb(); const env = { DB: seed(db) };
  const plan = await planOfficePeopleWithhold(env, { id: 'uX', role: 'user' }, 'B Tasarım', { founders: ['Hiç Olmayan Kişi'], team: [] });
  assert.equal(plan.withheld.length, 0, 'karşılığı olmayan ad bir bağ da üretemez');
});

await test('Ekip kutusu da kapsanır ve slot korunur', async () => {
  const db = freshDb(); const env = { DB: seed(db) };
  const plan = await planOfficePeopleWithhold(env, { id: 'uX', role: 'user' }, 'B Tasarım', { founders: [], team: ['Ayça Akkaya'] });
  assert.equal(plan.withheld.length, 1);
  assert.equal(plan.withheld[0].slot, 'team', 'onayda ad DOĞRU kutuya dönmeli (Kurucular ≠ Ekip)');
});

section('madde 6 — kişi künyesine YÖNETİCİSİ OLAN firmayı eklemek');

await test('firmanın yöneticisi varsa firma adı GERİ ÇEKİLİR', async () => {
  const db = freshDb(); const env = { DB: seed(db) };
  const plan = await planArchitectOfficesWithhold(env, { id: 'uX', role: 'user' }, 'Yeni Kişi', ['A Mimarlık']);
  assert.equal(plan.withheld.length, 1);
  assert.equal(plan.withheld[0].officeName, 'A Mimarlık');
  assert.equal(plan.withheld[0].deciderOfficeName, 'A Mimarlık');
});

await test('yöneticisi OLMAYAN firmada davranış DEĞİŞMEDİ (kapı yok)', async () => {
  const db = freshDb(); const env = { DB: seed(db) };
  const plan = await planArchitectOfficesWithhold(env, { id: 'uX', role: 'user' }, 'Yeni Kişi', ['Sahipsiz Ofis']);
  assert.equal(plan.withheld.length, 0,
    'kullanıcı isteği "zaten bir yöneticisi varsa" diyor; yöneticisiz firmada bağ yine canonicalSync#splitAdminApprovedOffices kapısına tabidir');
});

await test('firmanın yöneticisi kendi firmasını eklerken muaf', async () => {
  const db = freshDb(); const env = { DB: seed(db) };
  const plan = await planArchitectOfficesWithhold(env, { id: 'mgrA', role: 'user' }, 'Yeni Kişi', ['A Mimarlık']);
  assert.equal(plan.withheld.length, 0);
});

await test('VAR OLAN üyelik geri çekilmez (gerileme kapısı)', async () => {
  const db = freshDb(); const env = { DB: seed(db) };
  // Ayça ZATEN A Mimarlık'ın üyesi (yapısal bağ). O firmanın künyesini yöneten mgrA değil bir
  // başkası (uX) kaydetse bile ad geri çekilmemeli — aksi halde bir üyenin adı, künye her
  // kaydedildiğinde firmadan düşer ve yeniden onay beklerdi.
  const p1 = await planOfficePeopleWithhold(env, { id: 'uX', role: 'user' }, 'A Mimarlık', { founders: ['Ayça Akkaya'], team: [] });
  assert.equal(p1.withheld.length, 0);
  // Kişi tarafı: Ayça kendi künyesini düzenlerken A Mimarlık adı yerinde kalmalı.
  const p2 = await planArchitectOfficesWithhold(env, { id: 'uX', role: 'user' }, 'Ayça Akkaya', ['A Mimarlık']);
  assert.equal(p2.withheld.length, 0);
  // Birincil firma (architects.office_id) da aynı korumayı sağlar.
  db.prepare(`UPDATE architects SET office_id = 2 WHERE id = 11`).run();
  const p3 = await planArchitectOfficesWithhold(env, { id: 'uX', role: 'user' }, 'Yeni Kişi', ['B Tasarım']);
  assert.equal(p3.withheld.length, 0);
});

section('talep + bildirim: karar kümesi = bildirim kümesi');

await test('talep satırı açılır ve yönetici + TÜM adminler bildirim alır', async () => {
  const db = freshDb(); const env = { DB: seed(db) };
  const plan = await planArchitectOfficesWithhold(env, { id: 'uX', role: 'user' }, 'Yeni Kişi', ['A Mimarlık']);
  await createMembershipClaims(env, { id: 'uX', name: 'Üye X', role: 'user' }, {
    source: 'architect', submissionType: 'architects', submissionId: 'as1',
    items: plan.withheld.map(w => ({ ...w, architectName: 'Yeni Kişi' })),
  });
  const rows = db.prepare(`SELECT * FROM profile_membership_claims`).all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'pending');
  assert.equal(rows[0].decider_office_name, 'A Mimarlık');
  assert.equal(rows[0].submission_id, 'as1');
  const notifs = db.prepare(`SELECT user_id, type, link FROM notifications ORDER BY user_id`).all();
  const ids = notifs.map(n => n.user_id).sort();
  assert.deepEqual(ids, ['admin1', 'mgrA'], 'firmanın yöneticisi + adminler (karar kümesiyle AYNI)');
  assert.ok(notifs.every(n => n.type === 'membership_claim'));
  assert.ok(notifs.every(n => n.link === `membership-claim:${rows[0].id}`), 'bildirim pop-up bağlantısı taşımalı');
});

await test('aynı bağ için İKİNCİ bekleyen talep açılmaz (kısmi UNIQUE indeks)', async () => {
  const db = freshDb(); const env = { DB: seed(db) };
  const item = { officeId: 1, officeName: 'A Mimarlık', architectId: 11, architectName: 'Yeni Kişi', deciderOfficeName: 'A Mimarlık' };
  const args = { source: 'architect', submissionType: 'architects', submissionId: 'as1', items: [item] };
  await createMembershipClaims(env, { id: 'uX', name: 'Üye X', role: 'user' }, args);
  await createMembershipClaims(env, { id: 'uX', name: 'Üye X', role: 'user' }, args);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM profile_membership_claims`).get().n, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM notifications`).get().n, 2, 'ikinci kayıtta yeni bildirim gönderilmez');
});

await test('yönetici kümesi TEK kaynaktan okunur (fetchOfficeManagers)', async () => {
  const db = freshDb(); const env = { DB: seed(db) };
  const ids = await officeManagerIds(env, 'A Mimarlık');
  assert.deepEqual([...ids], ['mgrA']);
  const lib = read('../src/lib/membershipClaims.js');
  assert.match(lib, /import \{ fetchOfficeManagers \} from '\.\/claimedProfiles\.js'/);
  assert.match(lib, /import \{ OFFICE_EDIT_POSITIONS \} from '\.\/projectClaimAccess\.js'/,
    '"yönetici" tanımı Hesabım > Yetkili Kullanıcılar listesiyle AYNI kümeden gelmeli');
});

section('kapı GÖNDERİ YAZIMINDA (pop-up adları gönderi metninden de okuyor)');

await test('submissions.js iki yazma yolunda da kapıyı çağırır', () => {
  const subs = read('../src/routes/submissions.js');
  const calls = subs.split('\n').filter(l => /await withholdPendingMemberships\(env, user, typeKey, row\)/.test(l));
  assert.equal(calls.length, 2, 'createSubmission + updateOwnSubmission');
  const creates = subs.split('\n').filter(l => /createMembershipClaims\(env, user, \{ \.\.\.membershipPlan, submissionId: id \}\)/.test(l));
  assert.equal(creates.length, 2, 'talep satırı INSERT/UPDATE sonrası açılır (submission_id gerekir)');
});

await test('gönderi alanları JSON METNİ olarak ele alınır (sessiz süzmeme tuzağı)', () => {
  const subs = read('../src/routes/submissions.js');
  const fn = subs.match(/async function withholdPendingMemberships[\s\S]*?\n\}/)[0];
  assert.match(fn, /JSON\.parse\(v \|\| '\[\]'\)/, 'normalizeSubmission dizi alanlarını JSON metni bırakır');
  assert.match(fn, /row\.founders = JSON\.stringify\(/);
  assert.match(fn, /row\.team = JSON\.stringify\(/);
  // Kişi tarafında `office` düz metin (virgüllü) bir alandır.
  assert.match(fn, /row\.office = officeNames\.filter/);
});

await test('onay ÜÇ yere yazar (taslak + yapısal bağ + birincil firma)', () => {
  const route = read('../src/routes/membershipClaims.js');
  const fn = route.match(/async function applyMembershipClaim[\s\S]*?\n\}/)[0];
  assert.match(fn, /INSERT OR IGNORE INTO office_founders/);
  assert.match(fn, /UPDATE office_submissions SET \$\{claim\.slot\}/);
  assert.match(fn, /UPDATE architect_submissions SET office/);
  assert.match(fn, /!architect\.office_id/, 'dolu bir birincil firma EZİLMEMELİ');
  // İki profilin detay önbelleği de purge edilir (fingerprint yok).
  assert.match(fn, /purgeSsrDetailCache\('office', office\.name, env\)/);
  assert.match(fn, /purgeSsrDetailCache\('architect', architect\.name, env\)/);
});

await test('karar ucu yetkisiz kullanıcıyı 403 ile reddeder', () => {
  const route = read('../src/routes/membershipClaims.js');
  const fn = route.match(/async function decideClaim[\s\S]*?\n\}/)[0];
  assert.match(fn, /canDecideMembership\(env, user, row\)/);
  assert.match(fn, /403/);
  assert.match(fn, /status !== MEMBERSHIP_PENDING/, 'karara bağlanmış talep ikinci kez uygulanamaz');
});

section('madde 7 — rozet yalnızca kişi/firma profilleri için');

await test("'self' hedefi KALDIRILDI, 'architect' eklendi", () => {
  assert.equal(normalizeTarget({ targetType: 'self' }), null, 'hesaba rozet alınamaz');
  assert.equal(normalizeTarget({ targetType: 'office' }), null, 'anahtarsız hedef geçersiz');
  assert.deepEqual(normalizeTarget({ targetType: 'office', targetKey: 'A Mimarlık' }), { targetType: 'office', targetKey: 'A Mimarlık' });
  assert.deepEqual(normalizeTarget({ targetType: 'architect', targetKey: 'Ayça Akkaya' }), { targetType: 'architect', targetKey: 'Ayça Akkaya' });
});

await test('fiyat kademesi hedef tipine göre', () => {
  assert.equal(getBadgePrice('verified', 'office'), getBadgePrice('verified', 'office'));
  assert.notEqual(getBadgePrice('verified', 'architect'), undefined);
  assert.equal(getBadgePrice('yok-boyle-bir-rozet', 'office'), undefined);
});

await test('kapı: yönetilen firma + o firmadaki kişiler', async () => {
  const db = freshDb(); const env = { DB: seed(db) };
  // mgrA, A Mimarlık'ı yönetiyor ve Ayça o firmanın kişisi.
  assert.equal(await verifyBadgeTargetOwnership(env, 'mgrA', { targetType: 'office', targetKey: 'A Mimarlık' }), true);
  assert.equal(await verifyBadgeTargetOwnership(env, 'mgrA', { targetType: 'architect', targetKey: 'Ayça Akkaya' }), true);
  // Yönetmediği firma ve o firmada olmayan kişi reddedilir.
  assert.equal(await verifyBadgeTargetOwnership(env, 'mgrA', { targetType: 'office', targetKey: 'B Tasarım' }), false);
  assert.equal(await verifyBadgeTargetOwnership(env, 'mgrA', { targetType: 'architect', targetKey: 'Yeni Kişi' }), false);
  // Hiçbir firmayı yönetmeyen üye hiçbir hedefe rozet alamaz.
  assert.equal(await verifyBadgeTargetOwnership(env, 'uX', { targetType: 'architect', targetKey: 'Ayça Akkaya' }), false);
});

await test('yazım farkı (foldTr) kapıyı kırmaz', async () => {
  const db = freshDb(); const env = { DB: seed(db) };
  assert.equal(await verifyBadgeTargetOwnership(env, 'mgrA', { targetType: 'architect', targetKey: 'AYCA AKKAYA' }), true);
});

await test('kişi listesi office_founders + architects.office_id birleşimi', async () => {
  const db = freshDb(); const env = { DB: seed(db) };
  db.prepare(`UPDATE architects SET office_id = 1 WHERE id = 11`).run();
  const names = await userManagedArchitectNames(env, 'mgrA');
  assert.deepEqual([...names].sort(), ['Ayça Akkaya', 'Yeni Kişi']);
});

await test('iki satın alma yolu AYNI kapıyı çağırır', () => {
  const badges = read('../src/routes/badges.js');
  const payments = read('../src/routes/payments.js');
  assert.match(badges, /if \(!\(await verifyBadgeTargetOwnership\(env, user\.id, target\)\)\)/);
  assert.match(payments, /if \(!\(await verifyBadgeTargetOwnership\(env, user\.id, target\)\)\)/);
  assert.ok(!/verifyOfficeTargetOwnership/.test(payments), 'eski (yalnızca firma) kapı kalmamalı');
});

await test('hedef listeleri SUNUCUDAN, kapının kendisinden türer', () => {
  const badges = read('../src/routes/badges.js');
  const fn = badges.match(/async function listBadgeTargets[\s\S]*?\n\}/)[0];
  assert.match(fn, /userManagedOfficeNames\(env, user\.id\)/);
  assert.match(fn, /userManagedArchitectNames\(env, user\.id\)/);
  assert.match(fn, /computeBadgesPayload\(env\)/, 'hedef başına görünen rozet de aynı yanıtta gelmeli');
  for (const [file, prefix] of [['../satin-al.html', 'target'], ['../js/components/info-modal.js', 'im-target']]) {
    const src = read(file);
    assert.match(src, /\/api\/badges\/targets/, `${file} hedef listesini sunucudan almalı`);
    assert.ok(!new RegExp(`id="${prefix}-self"`).test(src), `${file}: "Kendim için" seçeneği kalmamalı`);
    assert.match(src, new RegExp(`id="${prefix}-architect"`), `${file}: kişi hedefi seçeneği olmalı`);
  }
});

await test("eski 'self' satırları OKUNMAYA devam eder (veri kaybı yok)", () => {
  const badges = read('../src/routes/badges.js');
  const fn = badges.match(/async function computeBadgesPayload[\s\S]*?\n\}/)[0];
  assert.match(fn, /b\.target_type = 'self' AND c\.profile_type = 'architect'/);
  assert.match(fn, /target_type = 'architect' AND status = 'active'/, 'yeni kişi hedefli satırlar doğrudan anahtarla');
});

section('madde 1 — kişi künyesinin rozeti');

await test('firma pop-up: Ekip kartı da rozet çizer ve rozetler gelince tazelenir', () => {
  const om = read('../js/components/office-modal.js');
  const fn = om.match(/function teamCardHtml[\s\S]*?\n  \}/)[0];
  assert.match(fn, /verifiedBadgeHtml\('architect', person\.name, person\.badges, 14\)/);
  assert.match(om, /function renderTeamGrid\(\)/);
  const refresh = om.match(/function renderVerifiedBadges[\s\S]*?\n    \}/)[0];
  assert.match(refresh, /renderFoundersGrid\(\);\s*\n\s*renderTeamGrid\(\);/,
    '/api/public/badges ASENKRON gelir — iki ızgara da tazelenmeli');
});

await test('Hesabım > Kişi Bilgileri: rozet KİŞİ KÜNYESİNDEN, hesaptan DEĞİL', () => {
  const am = read('../js/components/auth-modal.js');
  assert.match(am, /function personProfileBadgesHtml\(name\) \{[\s\S]*?amPublicBadges\.architect\[name\]/);
  assert.ok(!/function myEffectiveBadgeType\(\)/.test(am), 'hesap rozeti kaynağı kaldırılmalı');
  // İKİ dal da aynı kaynağı kullanır: kendi künyesi ve yönetilen firmanın kişisi.
  assert.match(am, /nameEl\.innerHTML = `\$\{nameHtml\}\$\{personProfileBadgesHtml\(amPersonRecord && amPersonRecord\.name\)\}`/);
  assert.match(am, /nameEl\.innerHTML = `\$\{nameHtml\}\$\{personProfileBadgesHtml\(rec && rec\.name\)\}`/);
});

section('madde 2 — firma kapak görseli');

await test('/api/office/:key HAM cover_url döndürür (türev `cover` ondan AYRI)', () => {
  const office = read('../src/routes/office.js');
  assert.match(office, /cover_url: o\.cover_url \|\| null,/);
  assert.match(office, /cover: o\.cover_url \|\|/, 'türev alan (son projenin görseline düşen) DURMALI');
  const form = read('../firma-ekle.html');
  assert.match(form, /existingCoverUrl = merged\.cover_url \|\| null;/,
    'form BİLEREK ham kolonu okur — türev değeri yazmak kapağı kalıcı sabitlerdi');
});

section('madde 3 — salt okunur e-posta');

await test('pop-up e-posta kutusu readonly ve sunucu da yazmaz', () => {
  const am = read('../js/components/auth-modal.js');
  assert.match(am, /<input type="email" id="am-account-email" readonly/);
  assert.match(am, /getElementById\('am-account-email'\)\.value = \(accountUser && accountUser\.email\) \|\| ''/);
  const auth = read('../src/routes/auth.js');
  const fields = auth.match(/const fields = \[[^\]]*\]/)[0];
  assert.ok(!/'email'/.test(fields), 'PATCH /api/profile e-postayı KABUL ETMEMELİ');
});

section('madde 4 — kaydı ekleyen yöneticidir + aynı adla ikinci kayıt YOK');

await test('yeni gönderide isim çakışması 409 ile reddedilir', () => {
  const subs = read('../src/routes/submissions.js');
  assert.match(subs, /isDuplicateCanonicalName\(env, typeKey, dupName, \{ brand: body\.brand \}\)/);
  // Yalnızca GERÇEKTEN yeni kayıt için — claimed_profile_key'li düzenleme kasıtlı olarak aynı adla eşleşir.
  assert.match(subs, /if \(!body\.claimed_profile_key && !\(CLAIMED_SLUG_TYPES\.has\(typeKey\) && body\.claimed_slug\)\) \{/);
});

await test('kaydı ekleyen otomatik yönetici olur (claimed_by_user_id)', () => {
  const sync = read('../src/lib/canonicalSync.js');
  assert.match(sync, /resolveClaimedByUserId/);
  const claims = read('../src/lib/claimedProfiles.js');
  for (const fn of ['canEditOfficeAsCreator', 'canEditArchitectAsCreator', 'fetchOwnCreatedOfficeRows']) {
    assert.match(claims, new RegExp(`export async function ${fn}`), `${fn} kapısı durmalı`);
  }
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
process.exit(failed ? 1 : 0);
