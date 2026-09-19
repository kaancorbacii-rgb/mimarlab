#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-17 (ALTINCI tur) — beş madde, tek test dosyası.
//
// 1. "Proje ekle sayfasında bir tarih girince kutucuklarda kayma meydana geliyor, bu sorunu kökten
//    düzelt." -> .date-range-row artık align-items:flex-start (KÖK NEDEN: kutu mount'u seçilen
//    değeri düğmenin ALTINA bir çip olarak da basıyor, satırın çocukları sabit yükseklikli DEĞİL).
// 2. "Bir kullanıcı yönetici olarak atandığı firmada bir proje ya da ürünü sil derse direkt
//    silinsin, arşivle derse hesabım sayfasındaki arşivim kısmına düşsün."
// 3. /firma sayfa açıklaması değişti.
// 4. Admin > Arşiv > Marka: ürün sayısına göre çoktan aza.
// 5. Ana menü + footer: KİŞİ ile FİRMA'nın yeri değişti.
//
// 2. MADDE GERÇEK SQLite ÜZERİNDE, GERÇEK UÇLARLA ÖLÇÜLÜR (kurala değil SONUCA bakar): firma
// yöneticisi admin DEĞİLDİR ve kendi taslağı olmadığından zorunlu olarak ANAHTAR tabanlı yolu
// kullanır (DELETE /api/project/:slug, POST /api/product/:slug/moderate). Fikstür canonical satırı
// ELLE YAZMAZ — üyenin gönderisini GERÇEK onay yolundan (syncApprovedSubmissionToCanonical)
// geçirir, çünkü taslak↔canonical bağının ikinci (ve üyenin kendi gönderisi için TEK) yolu o
// satırın legacy_key='submission:<id>' işaretidir. Elle yazılmış bir canonical satırla ölçüm
// yapılsaydı düzeltme "çalışmıyor" görünürdü.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

// caches.default — invalidatePublicCache/purgeSsrDetailCache Workers API'sini çağırıyor.
globalThis.caches = {
  default: { async match() {}, async put() {}, async delete() { return false; } },
  async open() { return this.default; },
};

import { syncApprovedSubmissionToCanonical } from '../src/lib/canonicalSync.js';
import { parseSubmissionRow } from '../src/lib/submissionTypes.js';
import { handleSelfProjectDelete, handleSelfProjectModerate } from '../src/routes/legacyContent.js';
import { handleSelfContentModerate, handleSubmissionRoute } from '../src/routes/submissions.js';
import { handleArchiveRoute } from '../src/routes/archive.js';
import { handleAdminRoute } from '../src/routes/admin.js';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
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

const NOW = Date.now();
// DEĞİŞMEZ: fixture() bu haritanın TAMAMI için sessions satırı açar ve her anahtarın bir users
// satırı olmalı (FK). Ek bir hesap gereken test onu KENDİSİ ekler, buraya yazmaz.
const TOKENS = { mgr: 'tok-mgr', member: 'tok-member', admin: 'tok-admin', nobody: 'tok-nobody' };
// İstek HTTPS olmalı: sessionCookieName(request) HTTPS'te '__Host-' önekli adı okur (bkz.
// src/lib/http.js) — http:// bir URL'de çerez hiç bulunamaz ve her uç 401 döner.
const req = (who, method, path, body) => new Request(`https://mimarlab.com${path}`, {
  method,
  headers: { cookie: `__Host-mimarlab_session=${TOKENS[who]}`, 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
});

// Fikstür: 'A Mimarlık' firması, ona admin tarafından YÖNETİCİ olarak atanmış 'mgr', ve firmanın
// künyesinde yer alan bir projeyi + markasına bağlı bir ürünü SİTEYE EKLEMİŞ 'member'.
async function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(read('../schema.sql'));
  db.exec(read('../migrations/0079_search_fold_columns.sql'));
  db.prepare(`INSERT INTO users (id,email,password_hash,name,role,created_at) VALUES ('mgr','m@a.com','x','Yönetici','user',?)`).run(NOW);
  db.prepare(`INSERT INTO users (id,email,password_hash,name,role,created_at) VALUES ('member','u@a.com','x','Üye','user',?)`).run(NOW);
  db.prepare(`INSERT INTO users (id,email,password_hash,name,role,created_at) VALUES ('admin','a@a.com','x','Admin','admin',?)`).run(NOW);
  // 'nobody' — firmayla HİÇBİR bağı olmayan üye (yetki kapısı ölçümü için).
  db.prepare(`INSERT INTO users (id,email,password_hash,name,role,created_at) VALUES ('nobody','n@a.com','x','Yabancı','user',?)`).run(NOW);
  for (const [u, t] of Object.entries(TOKENS)) {
    db.prepare(`INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)`)
      .run(createHash('sha256').update(t).digest('hex'), u, NOW, NOW + 3600e3);
  }
  db.prepare(`INSERT INTO offices (id,name,slug,created_at) VALUES (1,'A Mimarlık','a-mimarlik',?)`).run(NOW);
  // Görev 'Yönetici' — OFFICE_EDIT_POSITIONS içindedir (bkz. src/lib/projectClaimAccess.js).
  db.prepare(
    `INSERT INTO profile_claims (id,user_id,profile_type,profile_key,status,office_position,created_at,updated_at)
     VALUES ('c1','mgr','office','A Mimarlık','approved','Yönetici',?,?)`
  ).run(NOW, NOW);
  const env = { DB: d1(db) };

  db.prepare(
    `INSERT INTO project_submissions (id,owner_user_id,status,created_at,updated_at,slug,title,office,location,images)
     VALUES ('ps1','member','approved',?,?,'test-proje','Test Proje','["A Mimarlık"]','İstanbul','[]')`
  ).run(NOW, NOW);
  await syncApprovedSubmissionToCanonical(env, 'projects', parseSubmissionRow('projects', { ...db.prepare(`SELECT * FROM project_submissions WHERE id='ps1'`).get() }));

  db.prepare(
    `INSERT INTO product_submissions (id,owner_user_id,status,created_at,updated_at,title,brand,images)
     VALUES ('us1','member','approved',?,?,'Test Ürün','A Mimarlık','[]')`
  ).run(NOW, NOW);
  await syncApprovedSubmissionToCanonical(env, 'products', parseSubmissionRow('products', { ...db.prepare(`SELECT * FROM product_submissions WHERE id='us1'`).get() }));

  const productSlug = db.prepare(`SELECT slug FROM products LIMIT 1`).get().slug;
  return { db, env, productSlug };
}

async function jsonOf(res) { return JSON.parse(await res.text()); }
async function mineTitles(env, who, type) {
  const url = new URL(`https://mimarlab.com/api/${type}/mine`);
  const data = await jsonOf(await handleSubmissionRoute(req(who, 'GET', url.pathname), env, url));
  return (data.items || []).map(i => `${i.title}:${i.status}`);
}
async function archiveTitles(env, who) {
  const url = new URL('https://mimarlab.com/api/archive/mine');
  const data = await jsonOf(await handleArchiveRoute(req(who, 'GET', url.pathname), env, url));
  return (data.items || []).map(i => `${i.kind}:${i.title}:canEdit=${i.canEdit ? 1 : 0}`);
}

section('madde 2 — firma yöneticisinin SİL/ARŞİVLE işlemi (gerçek SQLite, gerçek uçlar)');

await test('fikstür gerçekçi: canonical satır ÜYENİN gönderisinden doğar (legacy_key işareti)', async () => {
  const { db } = await fixture();
  assert.equal(db.prepare(`SELECT legacy_key FROM projects`).get().legacy_key, 'submission:ps1');
  assert.equal(db.prepare(`SELECT legacy_key FROM products`).get().legacy_key, 'submission:us1');
});

await test('PROJE "Sil" -> canonical satır VE üyenin taslağı gider (direkt silinir)', async () => {
  const { db, env } = await fixture();
  const res = await handleSelfProjectDelete(req('mgr', 'DELETE', '/api/project/test-proje'), env, 'test-proje');
  assert.equal(res.status, 200);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM projects`).get().n, 0, 'canonical proje silinmeli');
  // KÖK DÜZELTME BURADA: eskiden yalnızca claimed_slug'lı taslaklar siliniyordu, üyenin kendi
  // gönderisi 'approved' kalıyor ve bir sonraki kaydetmesinde proje geri geliyordu.
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM project_submissions`).get().n, 0, 'üyenin taslağı da silinmeli');
  assert.deepEqual(await mineTitles(env, 'member', 'projects'), [], 'üyenin Gönderilerim kutusu boşalmalı');
});

await test('ÜRÜN "Sil" -> canonical satır VE üyenin taslağı gider (products/materials dalı)', async () => {
  const { db, env, productSlug } = await fixture();
  const res = await handleSelfContentModerate(req('mgr', 'DELETE', `/api/product/${productSlug}`), env, 'products', productSlug, 'delete');
  assert.equal(res.status, 200);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM products`).get().n, 0);
  // products/materials'ta claimedColumn YOK — eski `if (config.claimedColumn)` koşulu bu tipte HİÇ
  // girmiyordu, yani ürün taslakları anahtar yolunda hiç silinmiyordu.
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM product_submissions`).get().n, 0);
  assert.deepEqual(await mineTitles(env, 'member', 'products'), []);
});

await test('PROJE "Arşivle" -> TEK arşiv taslağı, iki tarafın Arşivim kutusunda düzenlenebilir', async () => {
  const { db, env } = await fixture();
  const res = await handleSelfProjectModerate(req('mgr', 'POST', '/api/project/test-proje/moderate', { action: 'archive' }), env, 'test-proje');
  assert.equal(res.status, 200);
  const drafts = db.prepare(`SELECT id,status,owner_user_id,claimed_slug FROM project_submissions`).all();
  assert.equal(drafts.length, 1, 'İKİNCİ bir taslak açılmamalı (aynı kayıt iki durumda görünürdü)');
  assert.equal(drafts[0].id, 'ps1', 'kaydın DOĞDUĞU taslak yeniden kullanılmalı');
  assert.equal(drafts[0].status, 'archived');
  assert.equal(drafts[0].owner_user_id, 'member', 'sahiplik ÇALINMAZ — arşivleyen kişi sahibi olmaz');
  assert.equal(drafts[0].claimed_slug, 'test-proje', '"Düzenle ve Yayına Al" yetki kapısı bu kolonu okur');
  assert.ok(db.prepare(`SELECT hidden_at FROM projects`).get().hidden_at, 'canonical satır canlıdan çekilmeli');
  // Üyenin kutusunda artık "Yayında" DEĞİL "Arşivlendi" görünür — status ile hidden_at artık uyumlu.
  assert.deepEqual(await mineTitles(env, 'member', 'projects'), ['Test Proje:archived']);
  assert.deepEqual(await archiveTitles(env, 'mgr'), ['project:Test Proje:canEdit=1']);
  assert.deepEqual(await archiveTitles(env, 'member'), ['project:Test Proje:canEdit=1']);
});

await test('ÜRÜN "Arşivle" -> TEK arşiv taslağı, yöneticinin Arşivim kutusunda düzenlenebilir', async () => {
  const { db, env, productSlug } = await fixture();
  const res = await handleSelfContentModerate(req('mgr', 'POST', `/api/product/${productSlug}/moderate`, { action: 'archive' }), env, 'products', productSlug, 'archive');
  assert.equal(res.status, 200);
  const drafts = db.prepare(`SELECT id,status,owner_user_id,claimed_slug FROM product_submissions`).all();
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].id, 'us1');
  assert.equal(drafts[0].status, 'archived');
  assert.equal(drafts[0].owner_user_id, 'member');
  assert.equal(drafts[0].claimed_slug, productSlug, 'claimed_slug ŞART: "Yayınla" İKİNCİ bir ürün satırı yaratmasın');
  assert.ok(db.prepare(`SELECT hidden_at FROM products`).get().hidden_at);
  assert.deepEqual(await mineTitles(env, 'member', 'products'), ['Test Ürün:archived']);
  assert.deepEqual(await archiveTitles(env, 'mgr'), ['product:Test Ürün:canEdit=1']);
});

await test('yetkisi OLMAYAN kullanıcı ne silebilir ne arşivleyebilir (kapı yerinde)', async () => {
  const { db, env, productSlug } = await fixture();
  // 'member' firmanın yöneticisi DEĞİL ama projeyi kendi gönderisi olduğu için silebilir; firmayla
  // hiç bağı olmayan 'nobody' ise hiçbirini yapamaz (bkz. fixture).
  assert.equal((await handleSelfProjectDelete(req('nobody', 'DELETE', '/api/project/test-proje'), env, 'test-proje')).status, 403);
  const r = await handleSelfContentModerate(req('nobody', 'DELETE', `/api/product/${productSlug}`), env, 'products', productSlug, 'delete');
  assert.ok(r.status >= 400, 'ürün silme de reddedilmeli');
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM projects`).get().n, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM products`).get().n, 1);
});

await test('kaynak kapısı: anahtar yolunda taslaklar canonical satır SİLİNMEDEN ÖNCE toplanır', () => {
  // Sıra bozulursa legacy_key işareti okunamaz ve üyenin taslağı sessizce hayatta kalır — kural
  // yorumla değil, çağrı sırasıyla kelepçelenir.
  const s = read('../src/routes/legacyContent.js');
  for (const fn of ['runProjectAction', 'runContentAction']) {
    assert.ok(s.includes(fn), `${fn} mevcut olmalı`);
  }
  const projectKeyBranch = s.slice(s.indexOf("const canonRow = await findCanonicalRowByNaturalKey(env, 'projects', slug);"));
  const draftsAt = projectKeyBranch.indexOf('deleteCanonicalDrafts');
  const fullyAt = projectKeyBranch.indexOf('deleteCanonicalRowFully');
  assert.ok(draftsAt > -1 && fullyAt > -1 && draftsAt < fullyAt, 'deleteCanonicalDrafts, deleteCanonicalRowFully’den ÖNCE çağrılmalı');
  // products/materials'ın bağ kolonu ayrı eşlemeden okunur (config.claimedColumn onları kapsamaz).
  assert.match(s, /products: 'claimed_slug', materials: 'claimed_slug'/);
});

section('madde 4 — Admin > Arşiv > Marka ürün sayısına göre sıralanır');

await test('/api/admin/submissions arşiv yanıtında marka satırları productCount taşır', async () => {
  const { db, env } = await fixture();
  // İki marka: 'Az Marka' 1 ürün (serbest metin bağ), 'Çok Marka' 3 ürün (yapısal bağ).
  db.prepare(`INSERT INTO offices (id,name,slug,created_at) VALUES (2,'Çok Marka','cok-marka',?)`).run(NOW);
  for (const [i, t] of [[301, 'Ü1'], [302, 'Ü2'], [303, 'Ü3']]) {
    db.prepare(`INSERT INTO products (id,kind,title,slug,brand_office_id,created_at) VALUES (?, 'product', ?, ?, 2, ?)`).run(i, t, `u-${i}`, NOW);
  }
  db.prepare(`INSERT INTO products (id,kind,title,slug,brand_name_raw,created_at) VALUES (401,'product','Ü4','u-401','Az Marka',?)`).run(NOW);
  // İkisi de ARŞİVDE bir office_submissions satırı olarak dursun. cats ' · ' AYRIMLI METİN olarak
  // saklanır (JSON dizi DEĞİL — parseSubmissionRow o alanı ayrıştırmaz, bkz. office-kind.js#
  // officeCatList) ve bir ÜRÜN KATEGORİSİ ('Mobilya') taşımalı: isBrandOffice'ı üretici yapan şey
  // 'Üretim ve Satış' hizmet alanı değil, BRAND_CATS'ten bir değerdir.
  for (const [id, name] of [['os1', 'Çok Marka'], ['os2', 'Az Marka']]) {
    db.prepare(
      `INSERT INTO office_submissions (id,owner_user_id,status,created_at,updated_at,name,cats)
       VALUES (?,'member','archived',?,?,?,'Üretim ve Satış · Mobilya')`
    ).run(id, NOW, NOW, name);
  }
  const url = new URL('https://mimarlab.com/api/admin/submissions?type=offices&status=archived');
  const res = await handleAdminRoute(req('admin', 'GET', url.pathname + url.search), env, url);
  const data = await jsonOf(res);
  const byName = new Map((data.items || []).map(i => [i.name, i]));
  assert.ok(byName.get('Çok Marka'), 'arşivdeki marka listede olmalı');
  assert.equal(byName.get('Çok Marka').isBrand, true);
  assert.equal(byName.get('Çok Marka').productCount, 3, 'yapısal bağ (brand_office_id) sayılmalı');
  assert.equal(byName.get('Az Marka').productCount, 1, 'serbest metin marka (brand_name_raw) da sayılmalı');
});

section('madde 1 — tarih satırı hizası');

await test('.date-range-row align-items:flex-start (kayma kapatıldı)', () => {
  const s = read('../proje-ekle.html');
  assert.match(s, /\.date-range-row\{display:flex; gap:6px; align-items:flex-start;/);
  assert.ok(!/\.date-range-row\{display:flex; gap:6px; align-items:center;/.test(s), 'center geri gelmemeli');
});

section('madde 3 — /firma sayfa açıklaması');

await test('firma.html yeni açıklamayı taşır, eskisini taşımaz', () => {
  const s = read('../firma.html');
  assert.ok(s.includes("Türkiye'de yapı sektöründe faaliyet gösteren tasarım, uygulama ve satış yapan firmaları keşfedin."));
  assert.ok(!s.includes("Türkiye'nin mimarlık ofislerini, projelerini ve ekiplerini keşfet."));
});

section('madde 5 — ana menü + footer sırası: FİRMA, KİŞİ');

await test('NAV_ITEMS sırası PROJE · FOTOĞRAF · FİRMA · KİŞİ · GÜNDEM (Fotoğraf: 2026-09-17; Ürün 2026-09-19 günü /proje sayfasına taşındı)', () => {
  const s = read('../js/components/site-chrome.js');
  const block = s.slice(s.indexOf('const NAV_ITEMS = ['), s.indexOf('const LOGO_LIGHT'));
  const order = [...block.matchAll(/key: '([a-z0-9]+)'/g)].map(m => m[1]);
  assert.deepEqual(order, ['proje', 'fotograf', 'firma', 'kisi', 'gundem']);
});

await test('footer "Ana Menü" sütunu AYNI sırayı taşır (iki liste ayrışamaz)', () => {
  const s = read('../js/components/site-chrome.js');
  const col = s.slice(s.indexOf('<h4>Ana Menü</h4>'), s.indexOf('<h4>Topluluk</h4>'));
  const order = [...col.matchAll(/href="\/([a-z0-9-]+)"/g)].map(m => m[1]);
  assert.deepEqual(order, ['proje', 'fotograf', 'firma', 'kisi', 'gundem']);
});

console.log(`\n${failed ? 'BAŞARISIZ' : 'TAMAM'} — ${passed} geçti, ${failed} kaldı`);
if (failed) { for (const f of failures) console.error(` - ${f.name}: ${f.message}`); process.exit(1); }
