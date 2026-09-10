#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-10 (onuncu tur) — BİRİM TESTLERİ
//   madde 1: "Bir firmaya ve kişiye kullanıcı atayınca o firmanın kurucularının popup'larında da
//            'Bu profil sana mı ait?' butonu ve 'Kamuya açık kaynaklardan derlenmiştir...' yazısı
//            silinsin — hâlâ bazı profillerde duruyor." (canlı örnek: VEN Mimarlık / Gül Güven)
//   madde 2: "proje-sayfa-5'teyken bir proje popup'ı açıp kapadığımda tekrar sayfa 1'e dönüyorum."
//   madde 3: "Fotoğrafçı kısmına bir firmayı ya da markayı yazdığımız zaman web sitesi otomatik
//            olarak Kaynak kısmını doldursun."
//
// scripts/test-2026-09-10-round9.mjs ile AYNI desen: node:assert + node:sqlite üzerinde GERÇEK bir
// SQLite ve schema.sql; canlı lib/route fonksiyonları import edilir. İstemci tarafı maddeler (2 ve
// 3'ün form kısmı) KAYNAK ÜZERİNDEN sabitlenir — amaç davranışı taşıyan satırın sessizce geri
// alınmasını yakalamak (madde 2'nin kök nedeni tam olarak böyle bir sessiz eksiklikti).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { isArchitectProfileClaimed, anyProfileClaimed } from '../src/lib/claimedProfiles.js';
import { handlePublicRoute } from '../src/routes/public.js';
import { handlePhotographerSearchRoute } from '../src/routes/project.js';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

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
  db.exec(read('../schema.sql'));
  db.exec(read('../migrations/0079_search_fold_columns.sql'));
  return db;
}
function envFor(db) {
  return {
    DB: d1(db),
    CACHE: { async get() { return null; }, async put() {}, async delete() {}, async list() { return { keys: [] }; } },
  };
}
// VEN Mimarlık (o1) — kurucusu Gül Güven (a1, office_founders bağı), ekibinden Ayşe Ekip (a2,
// yalnızca office_id bağı), ilgisiz Veli İlgisiz (a3), ve bağı olan ama SİLİNMİŞ bir firma (o2).
function seed(db, { officeClaimStatus = 'approved' } = {}) {
  const now = Date.now();
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u1', 'ven@example.com', 'x', 'VEN Yönetici', 'user', ?)`).run(now);
  db.prepare(`INSERT INTO offices (id, slug, name, website, cats, loc) VALUES (1, 'ven-mimarlik', 'VEN Mimarlık', 'https://venmimarlik.com', '["Mimarlık"]', 'Ankara')`).run();
  db.prepare(`INSERT INTO offices (id, slug, name, deleted_at) VALUES (2, 'silinmis-firma', 'Silinmiş Firma', '2026-01-01')`).run();
  db.prepare(`INSERT INTO architects (id, slug, name) VALUES (1, 'gul-guven', 'Gül Güven')`).run();
  db.prepare(`INSERT INTO architects (id, slug, name, office_id) VALUES (2, 'ayse-ekip', 'Ayşe Ekip', 1)`).run();
  db.prepare(`INSERT INTO architects (id, slug, name) VALUES (3, 'veli-ilgisiz', 'Veli İlgisiz')`).run();
  db.prepare(`INSERT INTO architects (id, slug, name) VALUES (4, 'silinmis-kurucu', 'Silinmiş Kurucu')`).run();
  db.prepare(`INSERT INTO office_founders (office_id, architect_id) VALUES (1, 1)`).run();
  db.prepare(`INSERT INTO office_founders (office_id, architect_id) VALUES (2, 4)`).run();
  db.prepare(`INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at, office_position) VALUES ('c1', 'u1', 'office', 'VEN Mimarlık', ?, ?, ?, 'Yönetici')`).run(officeClaimStatus, now, now);
  db.prepare(`INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at) VALUES ('c2', 'u1', 'office', 'Silinmiş Firma', 'approved', ?, ?)`).run(now, now);
}

// ---------------------------------------------------------------------------------------------
section('madde 1 — sahiplenilmiş firmanın kurucusu da sahiplenilmiş sayılır');

await test('eski kural korunur: kişinin KENDİ onaylı talebi yoksa anyProfileClaimed false', async () => {
  const db = freshDb(); seed(db);
  assert.equal(await anyProfileClaimed(envFor(db), ['Gül Güven']), false);
});

await test('office_founders bağıyla kurucu olduğu firma sahiplenilmişse kişi sahiplenilmiş', async () => {
  const db = freshDb(); seed(db);
  assert.equal(await isArchitectProfileClaimed(envFor(db), ['Gül Güven']), true);
});

await test('yalnızca architects.office_id bağı da yeter (firma popup\'ındaki AYNI kaynak)', async () => {
  const db = freshDb(); seed(db);
  assert.equal(await isArchitectProfileClaimed(envFor(db), ['Ayşe Ekip']), true);
});

await test('bağı olmayan kişi sahiplenilmiş DEĞİL', async () => {
  const db = freshDb(); seed(db);
  assert.equal(await isArchitectProfileClaimed(envFor(db), ['Veli İlgisiz']), false);
});

await test('firmanın talebi bekliyorsa (pending) kurucu sahiplenilmiş DEĞİL', async () => {
  const db = freshDb(); seed(db, { officeClaimStatus: 'pending' });
  assert.equal(await isArchitectProfileClaimed(envFor(db), ['Gül Güven']), false);
});

await test('silinmiş firmanın onaylı talebi kurucuyu sahiplenilmiş YAPMAZ', async () => {
  const db = freshDb(); seed(db);
  assert.equal(await isArchitectProfileClaimed(envFor(db), ['Silinmiş Kurucu']), false);
});

await test('legacy_key üzerinden de eşleşir (yeniden adlandırılmış firma/kişi)', async () => {
  const db = freshDb(); seed(db);
  db.prepare(`UPDATE offices SET name = 'VEN Mimarlık Ltd', legacy_key = 'VEN Mimarlık' WHERE id = 1`).run();
  db.prepare(`UPDATE architects SET name = 'Gül Güven Yeni', legacy_key = 'Gül Güven' WHERE id = 1`).run();
  assert.equal(await isArchitectProfileClaimed(envFor(db), ['Gül Güven']), true);
  assert.equal(await isArchitectProfileClaimed(envFor(db), ['Gül Güven Yeni']), true);
});

await test('boş/geçersiz anahtar listesi false döner, sorgu patlamaz', async () => {
  const db = freshDb(); seed(db);
  assert.equal(await isArchitectProfileClaimed(envFor(db), []), false);
  assert.equal(await isArchitectProfileClaimed(envFor(db), [null, '', undefined]), false);
});

await test('GET /api/public/claim-status (davet kutusunun kapısı) kurucu için claimed:true döner', async () => {
  const db = freshDb(); seed(db);
  const url = new URL('https://mimarlab.com/api/public/claim-status?profileType=architect&profileKey=' + encodeURIComponent('Gül Güven'));
  const res = await handlePublicRoute(new Request(url), envFor(db), url);
  assert.equal(res.status, 200, 'status ' + res.status);
  assert.deepEqual(await res.json(), { claimed: true });
  const url2 = new URL('https://mimarlab.com/api/public/claim-status?profileType=architect&profileKey=' + encodeURIComponent('Veli İlgisiz'));
  const res2 = await handlePublicRoute(new Request(url2), envFor(db), url2);
  assert.deepEqual(await res2.json(), { claimed: false });
});

await test('firma tarafı claim-status davranışı DEĞİŞMEDİ (yalnızca kendi onaylı satırı)', async () => {
  const db = freshDb(); seed(db);
  const url = new URL('https://mimarlab.com/api/public/claim-status?profileType=office&profileKey=' + encodeURIComponent('VEN Mimarlık'));
  const res = await handlePublicRoute(new Request(url), envFor(db), url);
  assert.deepEqual(await res.json(), { claimed: true });
});

await test('/api/architect/:key `claimed` bayrağı ve claim-status AYNI fonksiyondan geçer (kaynak)', () => {
  const architectRoute = read('../src/routes/architect.js');
  const publicRoute = read('../src/routes/public.js');
  assert.match(architectRoute, /const claimed = await isArchitectProfileClaimed\(env, \[a\.name, a\.legacy_key\]\)/);
  assert.match(publicRoute, /profileType === 'architect'\) return \{ claimed: await isArchitectProfileClaimed\(env, \[profileKey\]\) \}/);
});

await test('firma claim\'i değişince kurucuların kişi detay önbelleği de purge edilir (kaynak)', () => {
  const admin = read('../src/routes/admin.js');
  const fn = admin.slice(admin.indexOf('async function purgeClaimProfileCaches'), admin.indexOf('async function purgeClaimProfileCaches') + 2500);
  assert.match(fn, /office_founders/);
  assert.match(fn, /purgeSsrDetailCache\('architect', r\.name, env\)/);
});

await test('API_PAYLOAD_VERSION en az v29 (claimed anlamı değişti, 304 tuzağı)', () => {
  // Sabit bir sürüme ÇAKILMAZ: sonraki turlar da (ör. 2026-09-10 on birinci tur, önizleme
  // profillerinin tam gövde dönmesi) aynı sabiti artırıyor. Testin derdi "bu tur bump edildi mi",
  // yani v29'dan GERİ gidilmemiş olması.
  const m = read('../src/lib/publicCache.js').match(/const API_PAYLOAD_VERSION = 'v(\d+)';/);
  assert.ok(m, 'API_PAYLOAD_VERSION okunamadı');
  assert.ok(Number(m[1]) >= 29, `v29 veya üstü bekleniyordu, v${m[1]} bulundu`);
});

// ---------------------------------------------------------------------------------------------
section('madde 2 — temiz sayfalama adresi (/proje/sayfa-5) bir popup URL\'i DEĞİLDİR');

function extractEntityPopupRe() {
  const src = read('../js/components/modal-shell.js');
  const m = src.match(/const ENTITY_POPUP_RE = (\/.*?\/);/);
  assert.ok(m, 'ENTITY_POPUP_RE bulunamadı');
  return new Function(`return ${m[1]};`)();
}

await test('ENTITY_POPUP_RE sayfalama yollarını DIŞLAR, gerçek popup yollarını tanır', () => {
  const re = extractEntityPopupRe();
  for (const p of ['/proje/sayfa-5', '/proje/sayfa-5/', '/kisi/sayfa-2', '/firma/sayfa-12', '/marka/sayfa-3', '/urun/sayfa-9', '/proje', '/kisi']) {
    assert.equal(re.test(p), false, `${p} popup sanıldı`);
  }
  for (const p of ['/proje/golcuk-kazikli-kervansarayi', '/kisi/gul-guven', '/firma/ven-mimarlik', '/marka/sisecam', '/urun/x', '/proje/sayfa-5-evi', '/proje/sayfa']) {
    assert.equal(re.test(p), true, `${p} popup sayılmadı`);
  }
});

await test('lazy-modals.js / proje.js / src/index.js ile AYNI dışlama (sözleşme tek)', () => {
  const lazy = read('../js/components/lazy-modals.js');
  assert.match(lazy, /pathRe: \/\^\\\/proje\\\/\(\?!sayfa-\\d\+\\\/\?\$\)/);
  const proje = read('../js/pages/proje.js');
  assert.match(proje, /\/sayfa-\(\\d\+\)\\\/\?\$\//);
  const index = read('../src/index.js');
  assert.match(index, /PAGED_LIST_RE = \/\^\(\\\/\(\?:proje\|kisi\|firma\|marka\|urun\)\)\\\/sayfa-/);
});

// ---------------------------------------------------------------------------------------------
section('madde 3 — Fotoğrafçı kutusundaki firma/marka, Kaynak kutusunu web sitesiyle doldurur');

await test('/api/photographers/search firma/marka satırlarını kind:\'office\' ile, kişileri kind\'sız döner', async () => {
  const db = freshDb(); seed(db);
  const url = new URL('https://mimarlab.com/api/photographers/search?q=' + encodeURIComponent('ven'));
  const res = await handlePhotographerSearchRoute(new Request(url), envFor(db), url);
  assert.equal(res.status, 200, 'status ' + res.status);
  const { items } = await res.json();
  const office = items.find(it => it.label === 'VEN Mimarlık');
  assert.ok(office, 'firma önerisi yok: ' + JSON.stringify(items));
  assert.equal(office.kind, 'office');
  const person = items.find(it => it.label === 'Gül Güven');
  assert.ok(person, 'kişi önerisi yok');
  assert.equal(person.kind, undefined);
});

await test('proje-ekle.html: seçimde ve elle yazımda Kaynak /api/office/:key web sitesiyle dolar (kaynak)', () => {
  const html = read('../proje-ekle.html');
  assert.match(html, /async function fillSourceFromOffice\(officeName\)/);
  assert.match(html, /fetch\(`\/api\/office\/\$\{encodeURIComponent\(name\)\}`\)/);
  assert.match(html, /onPick: \(item\) => \{ if\(item && item\.kind === 'office'\) fillSourceFromOffice\(item\.label\); \}/);
  assert.match(html, /getElementById\('p-credit-text'\)\.addEventListener\('change'/);
  // Kullanıcının kendi yazdığı Kaynak ezilmez: yalnızca boş ya da data-autofilled kutu yazılır,
  // elle dokununca bayrak kalkar.
  assert.match(html, /creditUrlInput\.dataset\.autofilled === '1'/);
  assert.match(html, /creditUrlInput\.addEventListener\('input', \(\) => \{ delete creditUrlInput\.dataset\.autofilled; \}\)/);
});

// ---------------------------------------------------------------------------------------------
console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) { for (const f of failures) console.error(`- ${f.name}: ${f.message.split('\n')[0]}`); process.exit(1); }
