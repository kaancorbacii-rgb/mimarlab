#!/usr/bin/env node
// PAYLAŞILAN R2 GÖRSELİ KAPISI — BİRİM TESTLERİ
// (kullanıcı bildirimi, 2026-09-13: "Ertegün Evi projesinin görselleri kırılmış, sorunu tespit et
// ve KÖKTEN düzelt.")
//
// Kök neden ve kural: src/lib/r2References.js dosya başı. Özet: bu depoda AYNI R2 nesnesini
// birden çok D1 satırı gösterebiliyor (mükerrer içe aktarma: "ertegun-evi" + "ertegun-evi-2";
// "Arşivle" akışının canonical `images` alanını birebir kopyaladığı arşiv taslakları; ürün
// versiyon galerileri) ama silme yolları bunu HİÇ kontrol etmiyordu. Bir satır silinince/
// galerisinden bir kare çıkarılınca nesne R2'den gidiyor, HÂLÂ onu gösteren diğer satır ölü
// yollarla kalıyordu -> kırık görsel (R2 nesnesinin geri dönüşü YOK).
//
// scripts/test-2026-09-12-archive-live-guard.mjs İLE AYNI desen: gerçek schema.sql'e karşı
// node:sqlite D1 shim'i + gerçek rota fonksiyonları. FARK: batch() burada SELECT/PRAGMA
// ifadelerinde .all() sonucunu döndürür — gerçek D1'in davranışı budur ve referans taraması
// (r2References.js) tek subrequest için batch kullanır.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { handleAdminRoute } from '../src/routes/admin.js';
import { runProjectAction } from '../src/routes/legacyContent.js';
import { deleteR2MediaKeys, collectR2MediaKeysFromColumns, cleanupReplacedR2Media } from '../src/lib/canonicalSync.js';
import { filterUnreferencedKeys, _resetSourcesMemo } from '../src/lib/r2References.js';
import { scanBrokenImageRefs, repairBrokenImageRefs } from '../src/lib/brokenMedia.js';
import { sha256Hex } from '../src/lib/crypto.js';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}

const READ_RE = /^\s*(SELECT|PRAGMA)\b/i;

function d1(db) {
  const stmt = (sql, params) => ({
    sql,
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = db.prepare(sql).get(...params); if (r === undefined) return null; return col ? r[col] : { ...r }; },
    async all() { return { results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }; },
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return {
    prepare: (sql) => stmt(sql, []),
    async batch(stmts) {
      const out = [];
      for (const st of stmts) out.push(READ_RE.test(st.sql) ? await st.all() : await st.run());
      return out;
    },
  };
}

// R2 shim — silinen anahtarları kaydeder (delete() dizi de kabul eder, gerçek R2Bucket gibi).
function uploads(initialKeys) {
  const store = new Map(initialKeys.map(k => [k, { size: 1000 }]));
  const deleted = [];
  return {
    store,
    deleted,
    async head(key) { return store.has(key) ? { size: store.get(key).size } : null; },
    async get(key) { return store.has(key) ? { body: null, size: store.get(key).size, httpMetadata: {} } : null; },
    async delete(keys) {
      for (const k of (Array.isArray(keys) ? keys : [keys])) { deleted.push(k); store.delete(k); }
    },
    async list() { return { objects: [], truncated: false }; },
  };
}

const SHARED_URL = '/media/u/u-owner/shared-cover.webp';
const SHARED_KEY = 'u/u-owner/shared-cover.webp';
const DRAFT_ONLY_URL = '/media/u/u-owner/draft-only.webp';
const DRAFT_ONLY_KEY = 'u/u-owner/draft-only.webp';
const TOKEN_ADMIN = 'session-admin';

// Ertegün Evi senaryosunun birebir kurulumu: AYNI kapak görselini gösteren iki canonical proje
// satırı (mükerrer içe aktarma — canlıda "ertegun-evi" arşivlenmiş, top100 satırı ise
// "ertegun-evi-2"yi gösteriyor, bkz. migrations/0054_top100_entries.sql) + arşivleme akışının
// ürettiği, aynı görselleri taşıyan claimed_slug'lı taslak.
async function freshEnv() {
  _resetSourcesMemo();
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const env = { DB: d1(db), UPLOADS: uploads([SHARED_KEY, DRAFT_ONLY_KEY]) };
  db.exec(`INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES
    ('u-admin', 'a@example.com', 'Admin', 'x', 'admin', 1000),
    ('u-owner', 'o@example.com', 'Sahip', 'x', 'user', 1000)`);
  db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .run(await sha256Hex(TOKEN_ADMIN), 'u-admin', Date.now(), Date.now() + 3600_000);
  const insertProject = db.prepare(`INSERT INTO projects (id, slug, title, images, source, hidden_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  insertProject.run(1, 'ertegun-evi', 'Ertegün Evi', JSON.stringify([SHARED_URL]), 'admin', '2026-08-09', '2026-01-01', '2026-01-01');
  insertProject.run(2, 'ertegun-evi-2', 'Bodrum Ahmet Ertegün Evi', JSON.stringify([SHARED_URL]), 'admin', null, '2026-01-01', '2026-01-01');
  db.prepare(`INSERT INTO project_submissions (id, owner_user_id, status, created_at, updated_at, slug, claimed_slug, title, images) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('s-1', 'u-owner', 'archived', 1000, 1000, 'ertegun-evi', 'ertegun-evi', 'Ertegün Evi', JSON.stringify([SHARED_URL, DRAFT_ONLY_URL]));
  return { env, db };
}

function adminRequest(method, path) {
  return new Request(`https://mimarlab.com${path}`, { method, headers: { Cookie: `__Host-mimarlab_session=${TOKEN_ADMIN}` } });
}

console.log('\nPAYLAŞILAN R2 GÖRSELİ KAPISI\n');

await test('mükerrer satırlardan biri silinince diğerinin gösterdiği görsel R2\'de kalır', async () => {
  const { env, db } = await freshEnv();
  // "ertegun-evi" arşiv taslağıyla birlikte tamamen siliniyor; "ertegun-evi-2" canlı kalıyor.
  const res = await runProjectAction(env, { id: 'u-admin', role: 'admin' }, { action: 'delete', slug: 'ertegun-evi' });
  assert.equal(res.status, 200, 'silme isteği başarılı olmalı');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM projects WHERE slug = 'ertegun-evi'`).get().n, 0, 'hedef satır silinmeli');
  assert.ok(env.UPLOADS.store.has(SHARED_KEY), 'hâlâ canlı olan mükerrer satırın gösterdiği nesne SİLİNMEMELİ (kırık görselin kök nedeni)');
  assert.ok(!env.UPLOADS.store.has(DRAFT_ONLY_KEY), 'başka hiçbir satırın göstermediği nesne silinmeli');
});

await test('paylaşılan görselin türevleri de korunur', async () => {
  const { env } = await freshEnv();
  env.UPLOADS.store.set(`_derived/w400/r2/${SHARED_KEY}`, { size: 100 });
  await runProjectAction(env, { id: 'u-admin', role: 'admin' }, { action: 'delete', slug: 'ertegun-evi' });
  assert.ok(env.UPLOADS.store.has(`_derived/w400/r2/${SHARED_KEY}`), 'hâlâ kullanılan görselin türevi de silinmemeli');
});

await test('son referans da gidince nesne gerçekten silinir (sızıntı yok)', async () => {
  const { env, db } = await freshEnv();
  await runProjectAction(env, { id: 'u-admin', role: 'admin' }, { action: 'delete', slug: 'ertegun-evi' });
  assert.ok(env.UPLOADS.store.has(SHARED_KEY));
  const res = await runProjectAction(env, { id: 'u-admin', role: 'admin' }, { action: 'delete', slug: 'ertegun-evi-2' });
  assert.equal(res.status, 200);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM projects`).get().n, 0, 'canonical satırların ikisi de silinmeli');
  assert.ok(!env.UPLOADS.store.has(SHARED_KEY), 'artık hiçbir satır göstermiyorsa nesne silinmeli');
});

await test('arşiv taslağı admin panelinden silinince canlı mükerrerin görseli kalır', async () => {
  const { env } = await freshEnv();
  const res = await handleAdminRoute(adminRequest('DELETE', '/api/admin/submissions/projects/s-1'), env, new URL('https://mimarlab.com/api/admin/submissions/projects/s-1'));
  assert.equal(res.status, 200, 'silme isteği başarılı olmalı');
  assert.ok(env.UPLOADS.store.has(SHARED_KEY), 'taslak + kendi canonical satırı gitse de görseli gösteren BAŞKA satır varsa nesne kalmalı');
});

await test('taslaktan çıkarılan kare canonical satırda duruyorsa silinmez (cleanupReplacedR2Media)', async () => {
  const { env, db } = await freshEnv();
  const existing = db.prepare(`SELECT * FROM project_submissions WHERE id = 's-1'`).get();
  // Kullanıcı taslağın galerisinden paylaşılan kareyi çıkarıyor; canonical satır(lar) hâlâ gösteriyor.
  db.prepare(`UPDATE project_submissions SET images = ? WHERE id = 's-1'`).run(JSON.stringify([DRAFT_ONLY_URL]));
  const nextRow = db.prepare(`SELECT * FROM project_submissions WHERE id = 's-1'`).get();
  await cleanupReplacedR2Media(env, 'projects', existing, nextRow);
  assert.ok(env.UPLOADS.store.has(SHARED_KEY), 'canonical satırın gösterdiği kare taslak düzenlemesiyle silinmemeli');
});

await test('mutlak URL yazılışı da referans sayılır', async () => {
  const { env, db } = await freshEnv();
  db.prepare(`DELETE FROM projects WHERE id = 2`).run();
  db.prepare(`UPDATE projects SET images = ? WHERE id = 1`).run(JSON.stringify([`https://mimarlab.com${SHARED_URL}`]));
  const safe = await filterUnreferencedKeys(env, [SHARED_KEY]);
  assert.deepEqual(safe, [], 'mutlak URL ile saklanan referans da nesneyi korumalı');
});

await test('yüzde kodlanmış yazılış da referans sayılır', async () => {
  const { env, db } = await freshEnv();
  const key = 'u/u-owner/126 SOFA.webp';
  db.prepare(`DELETE FROM projects WHERE id = 2`).run();
  db.prepare(`UPDATE projects SET images = ? WHERE id = 1`).run(JSON.stringify(['/media/u/u-owner/126%20SOFA.webp']));
  const safe = await filterUnreferencedKeys(env, [key]);
  assert.deepEqual(safe, [], 'boşluklu dosya adının kodlanmış yazılışı da korunmalı');
});

await test('ürün versiyonu (variants) içindeki görsel de referans sayılır', async () => {
  const { env, db } = await freshEnv();
  db.prepare(`UPDATE projects SET images = '[]'`).run();
  db.prepare(`UPDATE project_submissions SET images = '[]' WHERE id = 's-1'`).run();
  db.prepare(`INSERT INTO products (id, slug, kind, title, images, variants, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(2, 'ithaca-casa', 'product', 'Ithaca Casa', '[]', JSON.stringify([{ label: 'Light', images: [SHARED_URL] }]), 'admin', '2026-01-01', '2026-01-01');
  const safe = await filterUnreferencedKeys(env, [SHARED_KEY]);
  assert.deepEqual(safe, [], 'yalnızca versiyon galerisinde geçen görsel de korunmalı');
  assert.deepEqual(
    collectR2MediaKeysFromColumns({ variants: JSON.stringify([{ images: [SHARED_URL] }]) }, ['variants']),
    [SHARED_KEY], 'kolon bazlı toplayıcı iç içe JSON\'a inmeli');
});

await test('hiçbir satır göstermiyorsa doğrudan çağrı da siler', async () => {
  const { env, db } = await freshEnv();
  db.prepare(`UPDATE projects SET images = '[]'`).run();
  db.prepare(`UPDATE project_submissions SET images = '[]' WHERE id = 's-1'`).run();
  await deleteR2MediaKeys(env, [SHARED_KEY]);
  assert.ok(!env.UPLOADS.store.has(SHARED_KEY));
});

await test('referans taraması hata verirse hiçbir şey silinmez (şüphede koru)', async () => {
  const { env } = await freshEnv();
  _resetSourcesMemo();
  const broken = { DB: { prepare() { throw new Error('d1 down'); }, async batch() { throw new Error('d1 down'); } }, UPLOADS: env.UPLOADS };
  await deleteR2MediaKeys(broken, [SHARED_KEY]);
  assert.ok(env.UPLOADS.store.has(SHARED_KEY), 'tarama yapılamıyorsa nesne KORUNMALI');
  _resetSourcesMemo();
});

// ---- Geriye dönük onarım: zaten kaybolmuş nesneleri BULMA ve ölü referansı düşürme
// (bkz. src/lib/brokenMedia.js — "başka böyle görseli kırılan örnek var mı bak").

await test('tarama, R2\'de karşılığı olmayan referansı kaydıyla birlikte raporlar', async () => {
  const { env, db } = await freshEnv();
  db.prepare(`UPDATE projects SET images = ? WHERE id = 2`).run(JSON.stringify([SHARED_URL, '/media/u/u-owner/kayip.webp']));
  let cursor = null, found = [], guard = 0;
  do {
    const page = await scanBrokenImageRefs(env, cursor);
    found = found.concat(page.items);
    cursor = page.cursor;
    if (page.done) break;
  } while (cursor && ++guard < 50);
  const hit = found.find(i => i.table === 'projects' && i.id === 2);
  assert.ok(hit, 'kırık görselli proje raporlanmalı');
  assert.deepEqual(hit.missing, ['u/u-owner/kayip.webp'], 'yalnızca GERÇEKTEN eksik anahtar raporlanmalı');
  assert.ok(!found.some(i => i.missing.includes(SHARED_KEY)), 'R2\'de duran görsel kırık sayılmamalı');
});

await test('onarım yalnızca ölü referansı düşürür, sağlamları korur', async () => {
  const { env, db } = await freshEnv();
  db.prepare(`UPDATE projects SET images = ? WHERE id = 2`).run(JSON.stringify(['/media/u/u-owner/kayip.webp', SHARED_URL]));
  const res = await repairBrokenImageRefs(env, { table: 'projects', id: 2, keys: ['u/u-owner/kayip.webp'] });
  assert.equal(res.removed, 1);
  const images = JSON.parse(db.prepare(`SELECT images FROM projects WHERE id = 2`).get().images);
  assert.deepEqual(images, [SHARED_URL], 'sağlam görsel kalmalı, ölü yol düşmeli');
});

await test('onarım, arada yeniden yüklenmiş görseli kayıttan DÜŞÜRMEZ', async () => {
  const { env, db } = await freshEnv();
  const res = await repairBrokenImageRefs(env, { table: 'projects', id: 2, keys: [SHARED_KEY] });
  assert.deepEqual(res.skipped, [SHARED_KEY], 'R2\'de duran anahtar atlanmalı');
  assert.equal(res.removed, 0);
  const images = JSON.parse(db.prepare(`SELECT images FROM projects WHERE id = 2`).get().images);
  assert.deepEqual(images, [SHARED_URL], 'kayıt değişmemeli');
});

await test('admin ucu bağlı: GET tarar, POST onarır', async () => {
  const { env, db } = await freshEnv();
  db.prepare(`UPDATE projects SET images = ? WHERE id = 2`).run(JSON.stringify([SHARED_URL, '/media/u/u-owner/kayip.webp']));
  const getRes = await handleAdminRoute(adminRequest('GET', '/api/admin/broken-images'), env, new URL('https://mimarlab.com/api/admin/broken-images'));
  assert.equal(getRes.status, 200);
  const page = await getRes.json();
  assert.ok(page.items.some(i => i.table === 'projects' && i.id === 2), 'kırık kayıt ilk partide görünmeli');

  const postReq = new Request('https://mimarlab.com/api/admin/broken-images', {
    method: 'POST',
    headers: { Cookie: `__Host-mimarlab_session=${TOKEN_ADMIN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ table: 'projects', id: 2, keys: ['u/u-owner/kayip.webp'] }),
  });
  const postRes = await handleAdminRoute(postReq, env, new URL('https://mimarlab.com/api/admin/broken-images'));
  assert.equal(postRes.status, 200);
  assert.deepEqual(JSON.parse(db.prepare(`SELECT images FROM projects WHERE id = 2`).get().images), [SHARED_URL]);
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) { for (const f of failures) console.error(`- ${f.name}: ${f.message}`); process.exit(1); }
