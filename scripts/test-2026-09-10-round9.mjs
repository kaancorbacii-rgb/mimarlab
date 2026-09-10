#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-10 (dokuzuncu tur) — BİRİM TESTLERİ
//   madde 1: "Kişi sayfasında kişi isim ve soyismi otomatik olarak büyük harfle başlasın. örneğin
//            kaan çorbacı yazılsa bile Kaan Çorbacı olsun."
//   madde 2: "XL Mimarlık+Mühendislik firmasına zaten bir yönetici atadım, hâlâ 'Bu firma sana mı
//            ait?' butonu gözüküyor. Bir firmaya veya markaya yönetici kullanıcı atayınca da bu
//            buton kaybolsun."
//   madde 3: kişi/firma/marka popup'ındaki Geri Bildirim açıklaması güncellendi.
//
// scripts/test-2026-09-10-round8.mjs ile AYNI desen: test koşucusu yok, node:assert + node:sqlite
// üzerinde GERÇEK bir SQLite ve schema.sql; canlı route/lib fonksiyonları import edilir. İstemci
// tarafındaki iki madde (2 ve 3) sunucu ucundan sınanamadığı için KAYNAK ÜZERİNDEN sabitlenir —
// bu depodaki AYNI desen (bkz. scripts/preflight-check.sh'ın "image-cdn.js senkron" kontrolleri):
// amaç, davranışı taşıyan tek satırın sessizce geri alınmasını yakalamak.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { titleCasePersonName } from '../src/lib/textMatch.js';
import { handleSubmissionRoute } from '../src/routes/submissions.js';
import { sha256Hex } from '../src/lib/crypto.js';

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
async function seed(db) {
  const now = Date.now();
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u1', 'uye@example.com', 'x', 'Bir Üye', 'user', ?)`).run(now);
  db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, 'u1', ?, ?)`)
    .run(await sha256Hex('tok-u1'), now, now + 3600_000);
}
const req = (uid, path, init = {}) => new Request(`https://mimarlab.com${path}`, {
  ...init,
  headers: { 'Content-Type': 'application/json', ...(uid ? { Cookie: `__Host-mimarlab_session=tok-${uid}` } : {}), ...(init.headers || {}) },
});
// Telif beyanı her gönderide zorunlu (bkz. src/lib/rightsConsent.js) — testin konusu o değil.
const postArchitect = (env, body) => handleSubmissionRoute(
  req('u1', '/api/architects', { method: 'POST', body: JSON.stringify({ rightsAccepted: true, ...body }) }),
  env, new URL('https://mimarlab.com/api/architects')
);

// ---------------------------------------------------------------------------------------------
section('madde 1 — kişi adı baş harfleri');

await test('küçük yazılan ad soyad büyük harfle başlar (Türkçe i -> İ dahil)', () => {
  assert.equal(titleCasePersonName('kaan çorbacı'), 'Kaan Çorbacı');
  assert.equal(titleCasePersonName('irem yıldız'), 'İrem Yıldız');
  assert.equal(titleCasePersonName('ışıl ünal'), 'Işıl Ünal');
  assert.equal(titleCasePersonName('ali-can öz'), 'Ali-Can Öz');
});

await test('zaten büyük yazılmış hiçbir harf KÜÇÜLTÜLMEZ', () => {
  assert.equal(titleCasePersonName('MEHMET ALİ'), 'MEHMET ALİ');
  assert.equal(titleCasePersonName('McDonald Smith'), 'McDonald Smith');
});

await test('ad ortasındaki bağlaçlar küçük kalır (canlı veri: "Eduardo de Nari")', () => {
  assert.equal(titleCasePersonName('Eduardo de Nari'), 'Eduardo de Nari');
  assert.equal(titleCasePersonName('eduardo de nari'), 'Eduardo de Nari');
  // İlk kelime bağlaç listesinde olsa bile büyütülür — ad hep büyük harfle başlar.
  assert.equal(titleCasePersonName('de la cruz'), 'De la Cruz');
});

await test('baştaki/sondaki ve fazla boşluklar temizlenir, dize olmayan değer korunur', () => {
  assert.equal(titleCasePersonName('  ahmet   yılmaz '), 'Ahmet Yılmaz');
  assert.equal(titleCasePersonName(''), '');
  assert.equal(titleCasePersonName(null), null);
});

await test('POST /api/architects küçük yazılan adı normalize ederek KAYDEDER', async () => {
  const db = freshDb(); await seed(db);
  const res = await postArchitect(envFor(db), { name: 'kaan çorbacı' });
  assert.equal(res.status, 201, await res.text());
  const row = db.prepare(`SELECT name FROM architect_submissions`).get();
  assert.equal(row.name, 'Kaan Çorbacı');
});

await test('PATCH /api/architects/:id de aynı normalizasyondan geçer', async () => {
  const db = freshDb(); await seed(db);
  const env = envFor(db);
  const created = await postArchitect(env, { name: 'kaan çorbacı' });
  const { id } = await created.json();
  const res = await handleSubmissionRoute(
    req('u1', `/api/architects/${id}`, { method: 'PATCH', body: JSON.stringify({ rightsAccepted: true, name: 'kaan mehmet çorbacı' }) }),
    env, new URL(`https://mimarlab.com/api/architects/${id}`)
  );
  assert.equal(res.status, 200, await res.text());
  assert.equal(db.prepare(`SELECT name FROM architect_submissions WHERE id = ?`).get(id).name, 'Kaan Mehmet Çorbacı');
});

// ---------------------------------------------------------------------------------------------
section('madde 2 — sahiplenilmiş firma/markada davet kutusu gizlenir');

await test('claim-correction-box.js /api/public/claim-status\'ü TİPTEN BAĞIMSIZ sorgular', () => {
  const src = read('../js/components/claim-correction-box.js');
  const idx = src.indexOf('/api/public/claim-status');
  assert.ok(idx > 0, 'claim-status sorgusu bulunamadı');
  // Sorgunun HEMEN öncesindeki blokta artık bir profileType kapısı OLMAMALI — 2026-09-10 beşinci
  // turdaki `if(config.profileType === 'architect'){` sarmalayıcısı bilerek kaldırıldı.
  const before = src.slice(Math.max(0, idx - 400), idx);
  assert.ok(!/if\s*\(\s*config\.profileType\s*===\s*'architect'\s*\)\s*\{\s*$/m.test(before.trimEnd()),
    "claim-status sorgusu yeniden `profileType === 'architect'` kapısına alınmış");
  assert.ok(/let alreadyClaimed = false;\s*try\s*\{/.test(src),
    'alreadyClaimed doğrudan try bloğuyla hesaplanmalı (koşulsuz)');
});

await test('firma/marka davet kutusu alreadyClaimed ile gizlenir (kod yolu duruyor)', () => {
  const src = read('../js/components/claim-correction-box.js');
  assert.ok(src.includes("if(alreadyClaimed || badged){ card.style.display = 'none'; return; }"),
    'anonim ziyaretçi dalındaki gizleme kaldırılmış');
  assert.ok(/} else if\(alreadyClaimed\)\{\s*\n\s*card\.style\.display = 'none';/.test(src),
    'giriş yapmış ziyaretçi dalındaki gizleme kaldırılmış');
});

// ---------------------------------------------------------------------------------------------
section('madde 3 — Geri Bildirim açıklaması');

await test('kişi ve firma/marka popup\'ında yeni metin var, eskisi kalmadı', () => {
  const YENI = 'Hatalı veya eksik bir bilgi görüyorsan ya da bu profilin sana ait olduğunu düşünüyorsan bize bildir.';
  const ESKI = 'Hatalı ya da eksik bir bilgi görüyorsan bize bildir.';
  for (const f of ['../js/components/architect-modal.js', '../js/components/office-modal.js']) {
    const src = read(f);
    assert.ok(src.includes(YENI), `${f} — yeni Geri Bildirim metni yok`);
    assert.ok(!src.includes(ESKI), `${f} — eski Geri Bildirim metni hâlâ duruyor`);
  }
});

// ---------------------------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nBaşarısız testler:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
}
process.exit(failed ? 1 : 0);
