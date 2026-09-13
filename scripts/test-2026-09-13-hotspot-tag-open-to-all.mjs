#!/usr/bin/env node
// ÜRÜN ETİKETLEME HERKESE AÇIK + ONAY AKIŞI — UÇTAN UCA BİRİM TESTLERİ
// (kullanıcı isteği, 2026-09-13: "Her kullanıcı ürün etiketlemesi yapabilsin ama etiketlemenin
//  onaylanması için firma, marka sahibine ve admine onay bildirimi gitsin. Firma, marka veya admin
//  onay verirse hotspot etiketlemesi dinamik olarak yapılmış olsun. İlgili tüm popuplara da bu onay
//  yansımış olsun. Giden bildirime tıklanınca verilen bilginin altında Onay ve Reddet butonları
//  olsun.")
//
// BU TESTİN ASIL İŞİ: kapı GENİŞLEDİ (rozet -> giriş yapmış herkes), onay kuyruğu ise AYNEN
// KALMALI. Yetki genişletmelerinde asıl risk kapının kendisi değil, genişlerken YANINDAKİ
// korumanın da sessizce düşmesidir. Burada üç şey birlikte kelepçelenir:
//   1. Rozetsiz sıradan üye etiketleyebiliyor mu (yeni davranış),
//   2. Etiketlemesi YAYINA GİRMİYOR mu ve ürünün/markanın sahibi + TÜM adminler bildirim alıyor mu,
//   3. Yetkisiz biri karar VEREMİYOR mu, admin'in kendi etiketlemesi onaya düşmeden uygulanıyor mu.
//
// scripts/test-2026-09-11-office-jobs.mjs ile AYNI desen: gerçek handleHotspotTagsRoute,
// node:sqlite + GERÇEK schema.sql. Ağ yok.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { handleHotspotTagsRoute } from '../src/routes/hotspotTags.js';
import { sha256Hex } from '../src/lib/crypto.js';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}

function d1(db) {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = db.prepare(sql).get(...params); if (r === undefined) return null; return col ? r[col] : { ...r }; },
    async all() { return { results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }; },
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; } };
}

const IMG = '/projects/ev/1.webp';
const USERS = [
  ['u-admin', 'Admin Kişi', 'admin'],
  ['u-marka', 'Marka Sahibi', 'user'],   // markanın (offices) profilini sahiplenmiş
  ['u-uye', 'Sıradan Üye', 'user'],      // HİÇ ROZETİ YOK — yeni davranışın öznesi
  ['u-baska', 'Başka Üye', 'user'],      // ne sahip ne admin: karar veremez
];

async function freshEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const now = Date.now();
  for (const [id, name, role] of USERS) {
    db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, 'x', ?, ?)`).run(id, `${id}@example.com`, name, role, now);
    db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`).run(await sha256Hex(`tok-${id}`), id, now, now + 3600_000);
  }
  db.prepare(`INSERT INTO offices (id, slug, name, source, claimed_by_user_id) VALUES (10, 'marka-x', 'Marka X', 'legacy_static', 'u-marka')`).run();
  db.prepare(`INSERT INTO products (slug, title, kind, brand_name_raw, brand_office_id, images, source) VALUES ('koltuk', 'Koltuk', 'product', 'Marka X', 10, ?, 'legacy_static')`)
    .run(JSON.stringify(['/products/koltuk.webp']));
  db.prepare(`INSERT INTO projects (slug, title, images, source) VALUES ('ev', 'Ev Projesi', ?, 'legacy_static')`)
    .run(JSON.stringify([IMG]));
  return { db, env: { DB: d1(db) } };
}

async function call(env, uid, method, path, body) {
  const url = new URL(`https://mimarlab.com${path}`);
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.cookie = `__Host-mimarlab_session=tok-${uid}`;
  const req = new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return handleHotspotTagsRoute(req, env, url);
}
const tagBody = { projectSlug: 'ev', imageUrl: IMG, productSlug: 'koltuk', x: 40, y: 60 };
const hotspotsOf = (db) => JSON.parse(db.prepare(`SELECT image_hotspots FROM projects WHERE slug='ev'`).get().image_hotspots || '{}');
const notifsOf = (db, uid) => db.prepare(`SELECT * FROM notifications WHERE user_id = ?`).all(uid);

console.log('\nKapı: giriş yapmış HER kullanıcı etiketleyebilir (rozet koşulu kalktı)');

await test('rozetsiz sıradan üye etiketleyebilir — öneri PENDING olur', async () => {
  const { env, db } = await freshEnv();
  const res = await call(env, 'u-uye', 'POST', '/api/hotspot-tags', tagBody);
  assert.equal(res.status, 200, 'rozetsiz üye reddedildi');
  assert.equal((await res.json()).status, 'pending');
  const row = db.prepare(`SELECT * FROM project_hotspot_tags`).get();
  assert.equal(row.status, 'pending');
  assert.equal(row.created_by_user_id, 'u-uye');
});

await test('/access rozetsiz üyeye canTag:true, OTURUMSUZ ziyaretçiye false der', async () => {
  const { env } = await freshEnv();
  assert.equal((await (await call(env, 'u-uye', 'GET', '/api/hotspot-tags/access')).json()).canTag, true);
  assert.equal((await (await call(env, null, 'GET', '/api/hotspot-tags/access')).json()).canTag, false);
});

await test('oturumsuz istek 401 — anonim öneri kabul edilmez', async () => {
  const { env, db } = await freshEnv();
  assert.equal((await call(env, null, 'POST', '/api/hotspot-tags', tagBody)).status, 401);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM project_hotspot_tags`).get().n, 0);
});

console.log('\nKuyruk: öneri YAYINA GİRMEZ, bildirim marka sahibine + adminlere gider');

await test('pending öneri projeye HİÇ yazılmaz', async () => {
  const { env, db } = await freshEnv();
  await call(env, 'u-uye', 'POST', '/api/hotspot-tags', tagBody);
  assert.deepEqual(hotspotsOf(db), {}, 'onaysız işaretçi projeye yazılmış — kuyruk atlatılıyor');
});

await test('bildirim marka sahibine ve TÜM adminlere gider; ilgisiz üyeye gitmez', async () => {
  const { env, db } = await freshEnv();
  await call(env, 'u-uye', 'POST', '/api/hotspot-tags', tagBody);
  const marka = notifsOf(db, 'u-marka');
  assert.equal(marka.length, 1, 'marka sahibine bildirim gitmedi');
  assert.equal(marka[0].type, 'hotspot_tag');
  // Bildirimin link'i tag id'sini taşımalı: Hesabım bu önekten Onayla/Reddet popup'ını açıyor
  // (bkz. js/components/auth-modal.js#openHotspotTagPrompt).
  assert.match(marka[0].link, /^hotspot-tag:/, 'bildirim karar popup\'ını açacak link taşımıyor');
  assert.equal(notifsOf(db, 'u-admin').length, 1, 'admin bildirim almadı');
  assert.equal(notifsOf(db, 'u-baska').length, 0, 'ilgisiz üyeye bildirim gitmiş');
});

console.log('\nKarar: yalnızca marka/firma sahibi ya da admin');

await test('yetkisiz üye karar veremez (403) ve proje değişmez', async () => {
  const { env, db } = await freshEnv();
  await call(env, 'u-uye', 'POST', '/api/hotspot-tags', tagBody);
  const id = db.prepare(`SELECT id FROM project_hotspot_tags`).get().id;
  const res = await call(env, 'u-baska', 'POST', `/api/hotspot-tags/${id}/decide`, { approve: true });
  assert.equal(res.status, 403);
  assert.deepEqual(hotspotsOf(db), {});
});

await test('ÖNERİYİ YAPAN kendi önerisini onaylayamaz — kuyruk kendi kendine atlatılamaz', async () => {
  const { env, db } = await freshEnv();
  await call(env, 'u-uye', 'POST', '/api/hotspot-tags', tagBody);
  const id = db.prepare(`SELECT id FROM project_hotspot_tags`).get().id;
  assert.equal((await call(env, 'u-uye', 'POST', `/api/hotspot-tags/${id}/decide`, { approve: true })).status, 403);
  assert.deepEqual(hotspotsOf(db), {}, 'öneri sahibi kendi işaretçisini yayına almış');
});

await test('MARKA SAHİBİ onaylayınca işaretçi projeye DİNAMİK olarak yazılır', async () => {
  const { env, db } = await freshEnv();
  await call(env, 'u-uye', 'POST', '/api/hotspot-tags', tagBody);
  const id = db.prepare(`SELECT id FROM project_hotspot_tags`).get().id;
  const res = await call(env, 'u-marka', 'POST', `/api/hotspot-tags/${id}/decide`, { approve: true });
  assert.equal(res.status, 200, await res.text());
  // Yayındaki tek kaynak projects.image_hotspots — /api/project/:slug ve liste yükü (dolayısıyla
  // proje popup'ı, lightbox ve ana sayfa karuseli) hepsi bunu okur.
  assert.deepEqual(hotspotsOf(db)[IMG], [{ x: 40, y: 60, slug: 'koltuk', title: 'Koltuk' }]);
  assert.equal(db.prepare(`SELECT status FROM project_hotspot_tags`).get().status, 'approved');
  // Öneriyi yapan kişi kararı bildirimle öğrenir.
  assert.equal(notifsOf(db, 'u-uye').length, 1);
});

await test('ADMİN onaylayınca da uygulanır', async () => {
  const { env, db } = await freshEnv();
  await call(env, 'u-uye', 'POST', '/api/hotspot-tags', tagBody);
  const id = db.prepare(`SELECT id FROM project_hotspot_tags`).get().id;
  assert.equal((await call(env, 'u-admin', 'POST', `/api/hotspot-tags/${id}/decide`, { approve: true })).status, 200);
  assert.equal(hotspotsOf(db)[IMG].length, 1);
});

await test('REDDEDİLİRSE projeye hiçbir şey yazılmaz', async () => {
  const { env, db } = await freshEnv();
  await call(env, 'u-uye', 'POST', '/api/hotspot-tags', tagBody);
  const id = db.prepare(`SELECT id FROM project_hotspot_tags`).get().id;
  assert.equal((await call(env, 'u-marka', 'POST', `/api/hotspot-tags/${id}/decide`, { approve: false })).status, 200);
  assert.deepEqual(hotspotsOf(db), {});
  assert.equal(db.prepare(`SELECT status FROM project_hotspot_tags`).get().status, 'rejected');
});

await test('ADMİN etiketlemesi onaya HİÇ düşmez, anında uygulanır', async () => {
  const { env, db } = await freshEnv();
  const res = await call(env, 'u-admin', 'POST', '/api/hotspot-tags', tagBody);
  assert.equal((await res.json()).status, 'approved');
  assert.equal(hotspotsOf(db)[IMG].length, 1);
  assert.equal(notifsOf(db, 'u-marka').length, 0, 'admin etiketlemesi için onay bildirimi üretilmiş');
});

console.log('\nKarar popup\'ı: bilginin ALTINDA Onayla ve Reddet düğmeleri');

await test('GET /api/hotspot-tags/:id karar verecek kişiye canDecide:true döner', async () => {
  const { env, db } = await freshEnv();
  await call(env, 'u-uye', 'POST', '/api/hotspot-tags', tagBody);
  const id = db.prepare(`SELECT id FROM project_hotspot_tags`).get().id;
  for (const [uid, expected] of [['u-marka', true], ['u-admin', true], ['u-uye', false]]) {
    const data = await (await call(env, uid, 'GET', `/api/hotspot-tags/${id}`)).json();
    assert.equal(data.canDecide, expected, `${uid} canDecide`);
    assert.equal(data.item.product.title, 'Koltuk');
  }
  // Yetkisiz üçüncü kişi kaydı hiç göremez.
  assert.equal((await call(env, 'u-baska', 'GET', `/api/hotspot-tags/${id}`)).status, 404);
});

await test('bildirim popup\'ı Onayla/Reddet düğmelerini ve decide çağrısını taşıyor', () => {
  const src = readFileSync(new URL('../js/components/auth-modal.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('function openHotspotTagPrompt('), src.indexOf('function openHotspotTagPrompt(') + 6000);
  assert.ok(fn.includes('am-ht-approve') && fn.includes('>Onayla<'), 'Onayla düğmesi yok');
  assert.ok(fn.includes('am-ht-reject') && fn.includes('>Reddet<'), 'Reddet düğmesi yok');
  assert.ok(fn.includes('/decide'), 'düğmeler karar ucunu çağırmıyor');
  // Düğmeler yalnızca KARAR YETKİSİ olana ve henüz karara bağlanmamış öneride görünür.
  assert.ok(fn.includes('(!decided && data.canDecide)'), 'düğme görünürlüğü yetkiye bağlı değil');
});

console.log('\nKuyruk spam kapısı (kapı herkese açıldığı için eklendi)');

await test('createTag kullanıcı başına saatlik hız sınırı uyguluyor', () => {
  const src = readFileSync(new URL('../src/routes/hotspotTags.js', import.meta.url), 'utf8');
  assert.ok(src.includes("checkRateLimit(env, 'hotspot-tag', user.id, TAG_HOURLY_LIMIT"), 'hız sınırı yok');
  assert.ok(/const TAG_HOURLY_LIMIT = \d+;/.test(src), 'tavan sabiti yok');
  // Rozet kapısı GERÇEKTEN kalkmış olmalı — yoksa "herkes etiketleyebilir" isteği karşılanmaz.
  assert.ok(!src.includes('hasAnyActiveBadge'), 'rozet kapısı hâlâ duruyor');
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) { for (const f of failures) console.error(`- ${f.name}: ${f.message}`); process.exit(1); }
