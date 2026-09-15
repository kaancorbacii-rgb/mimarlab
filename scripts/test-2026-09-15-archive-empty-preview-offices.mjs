#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-15 (on ikinci tur) — BİRİM TESTLERİ
//   "Sitede hiç kurucusu, kurucu ortağı, ortağı, projesi, çektiği fotoğraflar bölümü veya ürünü
//    olmayan blurlu firmaları arşive al."
//
// KELEPÇELENEN ŞEY İKİ TANE:
//   1) KURAL (src/lib/emptyOfficeAudit.js#auditOfficeContent) — altı kapının her biri TEK BAŞINA
//      firmayı kurtarmalı. Bir kapı düşerse burada kırılır.
//   2) VERİNİN KAYNAĞI — betik "boş mu" sorusunu KENDİ SQL'iyle değil, firma pop-up'ını çizen canlı
//      koddan (src/routes/office.js#buildOfficePayload) sorar. Testler payload'ı GERÇEKTEN o
//      fonksiyondan üretir; ayrıca betik kaynağı taranıp kendi projects/products sorgusu yazmadığı
//      doğrulanır (kopya kural, bu deponun en sık tekrarlayan hata sınıfı).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { buildOfficePayload } from '../src/routes/office.js';
import { collectOfficeArchiveTargets } from '../src/lib/officeArchiveCascade.js';
import { parseCanonicalRow } from '../src/lib/canonicalRead.js';
import { fetchPreviewOffices, fetchPhotographerNameFolds, auditOfficeContent } from '../src/lib/emptyOfficeAudit.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }

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
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0079_search_fold_columns.sql', import.meta.url), 'utf8'));
  return db;
}

const PREV = '2026-09-01T00:00:00.000Z';

// YEDİ FİRMA — altısı BLURLU (önizleme), biri YAYINDA.
//   1 Bos Firma        : hiçbir bağı yok                       -> ARŞİVLENMELİ
//   2 Kurucu Firma     : office_founders + Kurucu Ortak        -> korunmalı (kapı 1)
//   3 Proje Firma      : project_designers                     -> korunmalı (kapı 3)
//   4 Urun Firma       : products.brand_office_id              -> korunmalı (kapı 4)
//   5 Foto Firma       : künyede fotoğrafçı olarak adı geçiyor -> korunmalı (kapı 5)
//   6 Ekip Firma       : yalnızca taslağın Ekip METNİNDE bir ad -> korunmalı (kapı 2)
//   7 Canli Firma      : YAYINDA ve bomboş                     -> LİSTEYE HİÇ GİRMEMELİ
function seed(db) {
  const now = Date.now();
  db.exec(`
    INSERT INTO offices (id, slug, name, loc, cats, source, legacy_key, hidden_at, preview_at) VALUES
      (1, 'bos-firma',    'Boş Firma',    'İstanbul', '"Mimarlık"', 'legacy_static', 'Boş Firma',    '${PREV}', '${PREV}'),
      (2, 'kurucu-firma', 'Kurucu Firma', 'İstanbul', '"Mimarlık"', 'legacy_static', 'Kurucu Firma', '${PREV}', '${PREV}'),
      (3, 'proje-firma',  'Proje Firma',  'İstanbul', '"Mimarlık"', 'legacy_static', 'Proje Firma',  '${PREV}', '${PREV}'),
      (4, 'urun-firma',   'Ürün Firma',   'İstanbul', '"Mimarlık"', 'legacy_static', 'Ürün Firma',   '${PREV}', '${PREV}'),
      (5, 'foto-firma',   'Foto Firma',   'İstanbul', '"Mimarlık"', 'legacy_static', 'Foto Firma',   '${PREV}', '${PREV}'),
      (6, 'ekip-firma',   'Ekip Firma',   'İstanbul', '"Mimarlık"', 'legacy_static', 'Ekip Firma',   '${PREV}', '${PREV}'),
      (7, 'canli-firma',  'Canlı Firma',  'İstanbul', '"Mimarlık"', 'legacy_static', 'Canlı Firma',  NULL, NULL);
    INSERT INTO architects (id, slug, name, position, office_id, source, legacy_key, hidden_at, preview_at) VALUES
      (10, 'ayse-kurucu', 'Ayşe Kurucu', 'Kurucu Ortak', 2, 'legacy_static', 'Ayşe Kurucu', '${PREV}', '${PREV}'),
      (11, 'mehmet-ekip', 'Mehmet Ekip',  NULL,          NULL, 'legacy_static', 'Mehmet Ekip', '${PREV}', '${PREV}');
    INSERT INTO office_founders (office_id, architect_id) VALUES (2, 10);
    INSERT INTO projects (id, slug, title, source, project_date, photo_credit_text, hidden_at, preview_at) VALUES
      (100, 'bir-proje', 'Bir Proje', 'legacy_static', '2024', 'Foto Firma', '${PREV}', '${PREV}');
    INSERT INTO project_designers (project_id, office_id) VALUES (100, 3);
    INSERT INTO products (id, slug, title, kind, brand_office_id, source, hidden_at, preview_at) VALUES
      (200, 'bir-urun', 'Bir Ürün', 'product', 4, 'legacy_static', '${PREV}', '${PREV}');
  `);
  // Ekip Firma'nın taslağı — "Mehmet Ekip" YALNIZCA Ekip METNİNDE (yapısal bağ yok); pop-up onu
  // Ekip bölümünde çizer, yani firma "hiç içeriği yok" sayılamaz.
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u-admin', 'admin@example.com', 'x', 'Admin', 'admin', ?)`).run(now);
  db.prepare(`INSERT INTO office_submissions (id, owner_user_id, status, created_at, updated_at, name, claimed_profile_key, founders, team) VALUES (?, 'u-admin', 'approved', ?, ?, ?, ?, ?, ?)`)
    .run('os-ekip', now, now, 'Ekip Firma', 'Ekip Firma', '[]', '["Mehmet Ekip"]');
}

async function auditAll(env) {
  const rows = await fetchPreviewOffices(env);
  const folds = await fetchPhotographerNameFolds(env);
  const out = new Map();
  for (const row of rows) {
    const o = parseCanonicalRow('offices', row);
    const payload = await buildOfficePayload(env, o.slug);
    const cascade = await collectOfficeArchiveTargets(env, o);
    out.set(o.name, auditOfficeContent(o, payload, cascade, folds));
  }
  return out;
}

const db = freshDb();
seed(db);
const env = { DB: d1(db) };
const audits = await auditAll(env);

section('havuz — YALNIZCA blurlu firmalar taranır');

await test('yayındaki firma havuza HİÇ girmez (kullanıcı isteği: "blurlu firmaları")', async () => {
  assert.equal(audits.has('Canlı Firma'), false, 'yayındaki firma taranmamalı');
  assert.equal(audits.size, 6);
});

await test('fetchPreviewOffices hidden_at + preview_at İKİSİNİ de arar', async () => {
  const sql = readFileSync(new URL('../src/lib/emptyOfficeAudit.js', import.meta.url), 'utf8');
  assert.match(sql, /hidden_at IS NOT NULL AND preview_at IS NOT NULL/);
});

section('karar — altı kapının her biri TEK BAŞINA firmayı kurtarır');

await test('hiçbir bağı olmayan blurlu firma ARŞİVLENİR', async () => {
  const a = audits.get('Boş Firma');
  assert.equal(a.empty, true);
  assert.deepEqual(
    { f: a.founders, t: a.team, p: a.projects, u: a.products, ph: a.photographer, c: a.cascade },
    { f: 0, t: 0, p: 0, u: 0, ph: false, c: 0 },
  );
});

await test('kurucu/ortağı olan firma korunur (kapı 1)', async () => {
  const a = audits.get('Kurucu Firma');
  assert.equal(a.founders, 1, 'Kurucu Ortak, Kurucular/Ortaklar bölümünde olmalı');
  assert.equal(a.empty, false);
  assert.equal(a.emptyByUserRule, false);
});

await test('projesi olan firma korunur (kapı 3)', async () => {
  const a = audits.get('Proje Firma');
  assert.equal(a.projects, 1);
  assert.equal(a.empty, false);
});

await test('ürünü olan firma korunur (kapı 4)', async () => {
  const a = audits.get('Ürün Firma');
  assert.equal(a.products, 1);
  assert.equal(a.empty, false);
});

await test('künyede fotoğrafçı olarak geçen firma korunur (kapı 5)', async () => {
  const a = audits.get('Foto Firma');
  assert.equal(a.photographer, true, 'photo_credit_text ters eşleşmesi çalışmalı');
  assert.equal(a.empty, false);
  assert.equal(a.emptyByUserRule, false);
});

await test('yalnızca Ekip üyesi olan firma korunur, ama AYRI raporlanır (kapı 2)', async () => {
  const a = audits.get('Ekip Firma');
  assert.equal(a.team, 1, 'taslağın Ekip metnindeki ad pop-up\'ta görünür');
  assert.equal(a.empty, false, 'arşivlenmemeli');
  assert.equal(a.emptyByUserRule, true, 'kullanıcının saydığı dört kalem boş — rapor ayırmalı');
});

section('fotoğrafçı ters eşleşmesi — Türkçe katlama');

await test('foldTr ile eşleşir: "FOTO FİRMA" künyesi "Foto Firma" kaydını yakalar', async () => {
  const db2 = freshDb();
  seed(db2);
  db2.prepare(`UPDATE projects SET photo_credit_text = ? WHERE id = 100`).run('FOTO FİRMA, Başka Biri');
  const env2 = { DB: d1(db2) };
  const folds = await fetchPhotographerNameFolds(env2);
  const row = await env2.DB.prepare(`SELECT * FROM offices WHERE id = 5`).first();
  const o = parseCanonicalRow('offices', row);
  const a = auditOfficeContent(o, await buildOfficePayload(env2, o.slug), await collectOfficeArchiveTargets(env2, o), folds);
  assert.equal(a.photographer, true, 'büyük harf + Türkçe İ farkı eşleşmeyi bozmamalı');
});

await test('virgülle ayrılmış künyede TEK ad da yakalanır', async () => {
  const db3 = freshDb();
  seed(db3);
  db3.prepare(`UPDATE projects SET photo_credit_text = ? WHERE id = 100`).run('Ali Veli, Foto Firma, Ayşe Fatma');
  const folds = await fetchPhotographerNameFolds({ DB: d1(db3) });
  assert.equal(folds.has('foto firma'), true);
  assert.equal(folds.has('ali veli'), true);
});

section('kaynak kelepçesi — betik kuralı KOPYALAMAZ');

const scriptSrc = readFileSync(new URL('./archive-empty-preview-offices.mjs', import.meta.url), 'utf8');

await test('betik pop-up verisini canlı koddan alır (buildOfficePayload)', async () => {
  assert.match(scriptSrc, /buildOfficePayload/);
  assert.match(scriptSrc, /collectOfficeArchiveTargets/);
  assert.match(scriptSrc, /auditOfficeContent/);
});

await test('betiğin KENDİ proje/ürün sorgusu YOK', async () => {
  assert.equal(/FROM\s+project_designers/i.test(scriptSrc), false, 'proje bağı canlı koddan gelmeli');
  assert.equal(/FROM\s+products/i.test(scriptSrc), false, 'ürün bağı canlı koddan gelmeli');
  assert.equal(/FROM\s+office_founders/i.test(scriptSrc), false, 'kurucu bağı canlı koddan gelmeli');
});

await test('betik elle UPDATE ... hidden_at yazmaz (geri alınabilirlik)', async () => {
  assert.equal(/UPDATE\s+offices/i.test(scriptSrc), false);
  assert.match(scriptSrc, /runContentAction\(env, user, \{ type: 'offices', action: 'archive'/);
});

await test('VARSAYILAN DRY-RUN: --apply yoksa yazma dalına hiç girilmez', async () => {
  assert.match(scriptSrc, /const APPLY = !!args\.apply/);
  assert.match(scriptSrc, /if \(!APPLY\)[\s\S]{0,200}process\.exit\(0\)/);
});

console.log(`\n${passed} ok, ${failed} fail`);
process.exit(failed ? 1 : 0);
