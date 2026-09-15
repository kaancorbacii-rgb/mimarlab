#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-15 (on ikinci + on üçüncü tur) — BİRİM TESTLERİ
//   "Sitede hiç kurucusu, kurucu ortağı, ortağı, projesi, çektiği fotoğraflar bölümü veya ürünü
//    olmayan blurlu firmaları arşive al." / "Aynı şekilde blurlu kişileri de kontrol et."
//
// KELEPÇELENEN ÜÇ ŞEY:
//   1) KURAL (src/lib/emptyProfileAudit.js#auditProfileContent) — her kapı TEK BAŞINA profili
//      kurtarmalı, İKİ TİP için de.
//   2) SAHİPLİK KAPISI — bir üyeye ait / atanmış / danışman olan profil, bomboş olsa da asla
//      arşivlenmez (Hesabım kutusunu ve /danismanlik kartını kırardı).
//   3) VERİNİN KAYNAĞI — betik "boş mu" sorusunu KENDİ SQL'iyle değil, pop-up'ı çizen canlı koddan
//      sorar. Testler payload'ı GERÇEKTEN o fonksiyonlardan üretir; ayrıca betik kaynağı taranıp
//      kendi proje/ürün sorgusu yazmadığı doğrulanır (kopya kural, bu deponun en sık hatası).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { buildOfficePayload } from '../src/routes/office.js';
import { buildArchitectPayload } from '../src/routes/architect.js';
import { collectOfficeArchiveTargets } from '../src/lib/officeArchiveCascade.js';
import { parseCanonicalRow } from '../src/lib/canonicalRead.js';
import {
  PROFILE_KINDS, fetchPreviewProfiles, fetchPhotographerNameFolds, fetchOwnership, fetchArchitectLinkIds, auditProfileContent,
  parseSkipList, isSkipped,
} from '../src/lib/emptyProfileAudit.js';

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

// ---------------------------------------------------------------------------------------------
// FİKSTÜR — her kapı için TEK farkı olan bir profil. Hepsi BLURLU, biri hariç (yayında olan).
//
// FİRMALAR (1-8)                                  KİŞİLER (20-29)
//   1 Boş Firma      hiçbir bağı yok  -> ARŞİV      20 Boş Kişi        hiçbir bağı yok -> ARŞİV
//   2 Kurucu Firma   office_founders                21 Firmalı Kişi    office_founders
//   3 Proje Firma    project_designers              22 Projeli Kişi    project_designers
//   4 Ürün Firma     products.brand_office_id       23 Fotoğrafçı Kişi project_photographers
//   5 Foto Firma     künyede fotoğrafçı adı         24 Ürün Kişi       product_architects
//   6 Ekip Firma     taslağın Ekip metninde ad      25 Portfolyo Kişi  architects.portfolio
//   7 Canlı Firma    YAYINDA (havuza girmemeli)     26 Sahipli Kişi    claimed_by_user_id
//   8 Sahipli Firma  claimed_by_user_id             27 Danışman Kişi   consultants satırı
//                                                   28 Atanmış Kişi    profile_claims('architect')
//                                                   29 Canlı Kişi      YAYINDA (havuza girmemeli)
// ---------------------------------------------------------------------------------------------
function seed(db) {
  const now = Date.now();
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u-admin', 'admin@example.com', 'x', 'Admin', 'admin', ?)`).run(now);
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u-uye', 'uye@example.com', 'x', 'Üye', 'user', ?)`).run(now);
  db.exec(`
    INSERT INTO offices (id, slug, name, loc, cats, source, legacy_key, hidden_at, preview_at, claimed_by_user_id) VALUES
      (1, 'bos-firma',     'Boş Firma',     'İstanbul', '"Mimarlık"', 'legacy_static', 'Boş Firma',     '${PREV}', '${PREV}', NULL),
      (2, 'kurucu-firma',  'Kurucu Firma',  'İstanbul', '"Mimarlık"', 'legacy_static', 'Kurucu Firma',  '${PREV}', '${PREV}', NULL),
      (3, 'proje-firma',   'Proje Firma',   'İstanbul', '"Mimarlık"', 'legacy_static', 'Proje Firma',   '${PREV}', '${PREV}', NULL),
      (4, 'urun-firma',    'Ürün Firma',    'İstanbul', '"Mimarlık"', 'legacy_static', 'Ürün Firma',    '${PREV}', '${PREV}', NULL),
      (5, 'foto-firma',    'Foto Firma',    'İstanbul', '"Mimarlık"', 'legacy_static', 'Foto Firma',    '${PREV}', '${PREV}', NULL),
      (6, 'ekip-firma',    'Ekip Firma',    'İstanbul', '"Mimarlık"', 'legacy_static', 'Ekip Firma',    '${PREV}', '${PREV}', NULL),
      (7, 'canli-firma',   'Canlı Firma',   'İstanbul', '"Mimarlık"', 'legacy_static', 'Canlı Firma',   NULL, NULL, NULL),
      (8, 'sahipli-firma', 'Sahipli Firma', 'İstanbul', '"Mimarlık"', 'legacy_static', 'Sahipli Firma', '${PREV}', '${PREV}', 'u-uye'),
      (9, 'uye-firma',     'Üye Firma',     'İstanbul', '"Mimarlık"', 'legacy_static', 'Üye Firma',     NULL, NULL, NULL);
    INSERT INTO architects (id, slug, name, position, office_id, source, legacy_key, hidden_at, preview_at, claimed_by_user_id, portfolio) VALUES
      (10, 'ayse-kurucu',     'Ayşe Kurucu',     'Kurucu Ortak', 2,    'legacy_static', 'Ayşe Kurucu',     '${PREV}', '${PREV}', NULL, NULL),
      (11, 'mehmet-ekip',     'Mehmet Ekip',     NULL,           NULL, 'legacy_static', 'Mehmet Ekip',     '${PREV}', '${PREV}', NULL, NULL),
      (20, 'bos-kisi',        'Boş Kişi',        NULL,           NULL, 'legacy_static', 'Boş Kişi',        '${PREV}', '${PREV}', NULL, NULL),
      (21, 'firmali-kisi',    'Firmalı Kişi',    'Kurucu',       NULL, 'legacy_static', 'Firmalı Kişi',    '${PREV}', '${PREV}', NULL, NULL),
      (22, 'projeli-kisi',    'Projeli Kişi',    NULL,           NULL, 'legacy_static', 'Projeli Kişi',    '${PREV}', '${PREV}', NULL, NULL),
      (23, 'fotografci-kisi', 'Fotoğrafçı Kişi', NULL,           NULL, 'legacy_static', 'Fotoğrafçı Kişi', '${PREV}', '${PREV}', NULL, NULL),
      (24, 'urun-kisi',       'Ürün Kişi',       NULL,           NULL, 'legacy_static', 'Ürün Kişi',       '${PREV}', '${PREV}', NULL, NULL),
      (25, 'portfolyo-kisi',  'Portfolyo Kişi',  NULL,           NULL, 'legacy_static', 'Portfolyo Kişi',  '${PREV}', '${PREV}', NULL, '["/media/a.jpg"]'),
      (26, 'sahipli-kisi',    'Sahipli Kişi',    NULL,           NULL, 'legacy_static', 'Sahipli Kişi',    '${PREV}', '${PREV}', 'u-uye', NULL),
      (27, 'danisman-kisi',   'Danışman Kişi',   NULL,           NULL, 'legacy_static', 'Danışman Kişi',   '${PREV}', '${PREV}', NULL, NULL),
      (28, 'atanmis-kisi',    'Atanmış Kişi',    NULL,           NULL, 'legacy_static', 'Atanmış Kişi',    '${PREV}', '${PREV}', NULL, NULL),
      (29, 'canli-kisi',      'Canlı Kişi',      NULL,           NULL, 'legacy_static', 'Canlı Kişi',      NULL, NULL, NULL, NULL),
      (30, 'kenarli-kisi',    'Kenarlı Kişi',    NULL,           NULL, 'legacy_static', 'Kenarlı Kişi',    '${PREV}', '${PREV}', NULL, NULL);
    -- 21 Firmalı Kişi YAYINDAKİ bir firmaya bağlı: pop-up'ın "Firma" bölümü dolu olur.
    INSERT INTO office_founders (office_id, architect_id) VALUES (2, 10), (9, 21);
    INSERT INTO projects (id, slug, title, source, project_date, photo_credit_text, hidden_at, preview_at) VALUES
      (100, 'bir-proje',   'Bir Proje',   'legacy_static', '2024', 'Foto Firma', '${PREV}', '${PREV}'),
      (101, 'ikinci-proje','İkinci Proje','legacy_static', '2024', NULL,         '${PREV}', '${PREV}');
    INSERT INTO project_designers (project_id, office_id, architect_id) VALUES (100, 3, NULL), (101, NULL, 22);
    INSERT INTO project_photographers (project_id, architect_id) VALUES (101, 23);
    INSERT INTO products (id, slug, title, kind, brand_office_id, source, hidden_at, preview_at) VALUES
      (200, 'bir-urun',    'Bir Ürün',    'product', 4,    'legacy_static', '${PREV}', '${PREV}'),
      (201, 'ikinci-urun', 'İkinci Ürün', 'product', NULL, 'legacy_static', NULL, NULL),
      (202, 'ucuncu-urun', 'Üçüncü Ürün', 'product', NULL, 'legacy_static', NULL, NULL);
    -- 24 Ürün Kişi: pop-up'ın "Tasarladığı Ürünler" bölümü products.designer METNİYLE süzülür
    -- (bkz. architect.js#relatedProducts) — kenar TEK BAŞINA o bölümü doldurmaz.
    UPDATE products SET designer = 'Ürün Kişi' WHERE id = 201;
    INSERT INTO product_architects (product_id, architect_id) VALUES (201, 24), (202, 30);
  `);
  // 6 Ekip Firma'nın taslağı — "Mehmet Ekip" YALNIZCA Ekip METNİNDE (yapısal bağ yok).
  db.prepare(`INSERT INTO office_submissions (id, owner_user_id, status, created_at, updated_at, name, claimed_profile_key, founders, team) VALUES (?, 'u-admin', 'approved', ?, ?, ?, ?, ?, ?)`)
    .run('os-ekip', now, now, 'Ekip Firma', 'Ekip Firma', '[]', '["Mehmet Ekip"]');
  // 28 Atanmış Kişi — admin ataması (profile_claims). 27 Danışman Kişi — consultants satırı.
  db.prepare(`INSERT INTO profile_claims (id, user_id, profile_type, profile_key, status, created_at, updated_at) VALUES ('c1', 'u-uye', 'architect', ?, 'approved', ?, ?)`)
    .run('Atanmış Kişi', now, now);
  db.prepare(`INSERT INTO consultants (architect_slug, user_id, duration_min, price_try, weekdays, times, status, created_at, updated_at) VALUES (?, 'u-uye', 45, 1000, '[1,2]', '["10:00"]', 'approved', ?, ?)`)
    .run('danisman-kisi', now, now);
}

async function auditAll(env, kind) {
  const rows = await fetchPreviewProfiles(env, kind);
  const folds = await fetchPhotographerNameFolds(env);
  const ownership = await fetchOwnership(env, kind);
  const linkIds = kind === 'architects' ? await fetchArchitectLinkIds(env) : null;
  const out = new Map();
  for (const raw of rows) {
    const row = parseCanonicalRow(kind, raw);
    const payload = kind === 'offices' ? await buildOfficePayload(env, row.slug) : await buildArchitectPayload(env, row.slug);
    const cascade = kind === 'offices' ? await collectOfficeArchiveTargets(env, row) : null;
    out.set(row.name, auditProfileContent(kind, row, payload, { cascade, linkIds, photographerFolds: folds, ownership }));
  }
  return out;
}

const db = freshDb();
seed(db);
const env = { DB: d1(db) };
const offices = await auditAll(env, 'offices');
const people = await auditAll(env, 'architects');

section('havuz — YALNIZCA blurlu profiller taranır');

await test('yayındaki firma/kişi havuza HİÇ girmez', async () => {
  assert.equal(offices.has('Canlı Firma'), false);
  assert.equal(people.has('Canlı Kişi'), false);
});

await test('fetchPreviewProfiles hidden_at + preview_at İKİSİNİ de arar', async () => {
  const src = readFileSync(new URL('../src/lib/emptyProfileAudit.js', import.meta.url), 'utf8');
  assert.match(src, /hidden_at IS NOT NULL AND preview_at IS NOT NULL/);
});

await test('iki tip de destekleniyor (PROFILE_KINDS)', async () => {
  assert.deepEqual(Object.keys(PROFILE_KINDS).sort(), ['architects', 'offices']);
});

section('FİRMA — her kapı TEK BAŞINA kurtarır');

await test('hiçbir bağı olmayan blurlu firma ARŞİVLENİR', async () => {
  const a = offices.get('Boş Firma');
  assert.equal(a.empty, true);
  assert.equal(a.cascade, 0);
  assert.equal(a.owned, false);
});
await test('kurucu/ortağı olan firma korunur', async () => {
  const a = offices.get('Kurucu Firma');
  assert.equal(a.sections.founders, 1);
  assert.equal(a.empty, false);
});
await test('projesi olan firma korunur', async () => {
  assert.equal(offices.get('Proje Firma').sections.projects, 1);
  assert.equal(offices.get('Proje Firma').empty, false);
});
await test('ürünü olan firma korunur', async () => {
  assert.equal(offices.get('Ürün Firma').sections.products, 1);
  assert.equal(offices.get('Ürün Firma').empty, false);
});
await test('künyede fotoğrafçı olarak geçen firma korunur', async () => {
  assert.equal(offices.get('Foto Firma').photographer, true);
  assert.equal(offices.get('Foto Firma').empty, false);
});
await test('yalnızca Ekip üyesi olan firma korunur', async () => {
  assert.equal(offices.get('Ekip Firma').sections.team, 1);
  assert.equal(offices.get('Ekip Firma').empty, false);
});

section('KİŞİ — her kapı TEK BAŞINA kurtarır');

await test('hiçbir bağı olmayan blurlu kişi ARŞİVLENİR', async () => {
  const a = people.get('Boş Kişi');
  assert.equal(a.empty, true);
  assert.deepEqual(a.sections, { offices: 0, projects: 0, photographed: 0, products: 0, portfolio: 0 });
});
await test('bir firmada kurucu/ortak olan kişi korunur (firma kapısı)', async () => {
  const a = people.get('Firmalı Kişi');
  assert.equal(a.sections.offices, 1, 'office_founders bağı "Firma" bölümünü doldurur');
  assert.equal(a.empty, false);
});
await test('projesi olan kişi korunur', async () => {
  assert.equal(people.get('Projeli Kişi').sections.projects, 1);
  assert.equal(people.get('Projeli Kişi').empty, false);
});
await test('fotoğrafladığı projesi olan kişi korunur (çektiği fotoğraflar)', async () => {
  assert.equal(people.get('Fotoğrafçı Kişi').sections.photographed, 1);
  assert.equal(people.get('Fotoğrafçı Kişi').empty, false);
});
await test('tasarladığı ürünü olan kişi korunur', async () => {
  assert.equal(people.get('Ürün Kişi').sections.products, 1);
  assert.equal(people.get('Ürün Kişi').empty, false);
});
await test('portfolyosu olan kişi korunur', async () => {
  assert.equal(people.get('Portfolyo Kişi').sections.portfolio, 1);
  assert.equal(people.get('Portfolyo Kişi').empty, false);
});

await test('POP-UP BOŞ ama yapısal kenarı olan kişi korunur (product_architects)', async () => {
  const a = people.get('Kenarlı Kişi');
  assert.deepEqual(a.sections, { offices: 0, projects: 0, photographed: 0, products: 0, portfolio: 0 },
    'pop-up gerçekten boş — kenar products.designer metninde geçmiyor');
  assert.equal(a.linked, true);
  assert.equal(a.empty, false, 'gerçek bir tasarım bağı taşıyor, arşivlenmemeli');
});

await test('kenar taraması dört kenarı da okur', async () => {
  const src = readFileSync(new URL('../src/lib/emptyProfileAudit.js', import.meta.url), 'utf8');
  for (const t of ['office_founders', 'project_designers', 'project_photographers', 'product_architects']) {
    assert.match(src, new RegExp(`FROM ${t}`), `${t} kenarı okunmalı`);
  }
});

section('SAHİPLİK — bomboş olsa da arşivlenmez');

await test('üyenin kendi eklediği kayıt korunur (claimed_by_user_id) — kişi', async () => {
  const a = people.get('Sahipli Kişi');
  assert.equal(a.owned, true);
  assert.equal(a.empty, false, 'Hesabım kutusunu besliyor olabilir');
});
await test('üyenin kendi eklediği kayıt korunur (claimed_by_user_id) — firma', async () => {
  const a = offices.get('Sahipli Firma');
  assert.equal(a.owned, true);
  assert.equal(a.empty, false);
});
await test('admin ataması olan kişi korunur (profile_claims)', async () => {
  assert.equal(people.get('Atanmış Kişi').owned, true);
  assert.equal(people.get('Atanmış Kişi').empty, false);
});
await test('DANIŞMAN kişi korunur (/danismanlik kartı ve randevu kapısı kırılmasın)', async () => {
  assert.equal(people.get('Danışman Kişi').owned, true);
  assert.equal(people.get('Danışman Kişi').empty, false);
});
await test('bekleyen sahiplenme talebi de korur (status IN approved, pending)', async () => {
  const src = readFileSync(new URL('../src/lib/emptyProfileAudit.js', import.meta.url), 'utf8');
  assert.match(src, /status IN \('approved', 'pending'\)/);
});

section('fotoğrafçı ters eşleşmesi — Türkçe katlama');

await test('foldTr ile eşleşir: "FOTO FİRMA" künyesi "Foto Firma" kaydını yakalar', async () => {
  const db2 = freshDb(); seed(db2);
  db2.prepare(`UPDATE projects SET photo_credit_text = ? WHERE id = 100`).run('FOTO FİRMA, Başka Biri');
  const env2 = { DB: d1(db2) };
  const folds = await fetchPhotographerNameFolds(env2);
  const ownership = await fetchOwnership(env2, 'offices');
  const row = parseCanonicalRow('offices', await env2.DB.prepare(`SELECT * FROM offices WHERE id = 5`).first());
  const a = auditProfileContent('offices', row, await buildOfficePayload(env2, row.slug),
    { cascade: await collectOfficeArchiveTargets(env2, row), photographerFolds: folds, ownership });
  assert.equal(a.photographer, true, 'büyük harf + Türkçe İ farkı eşleşmeyi bozmamalı');
});

await test('virgülle ayrılmış künyede TEK ad da yakalanır', async () => {
  const db3 = freshDb(); seed(db3);
  db3.prepare(`UPDATE projects SET photo_credit_text = ? WHERE id = 100`).run('Ali Veli, Foto Firma, Ayşe Fatma');
  const folds = await fetchPhotographerNameFolds({ DB: d1(db3) });
  assert.equal(folds.has('foto firma'), true);
  assert.equal(folds.has('ali veli'), true);
});

section('--skip — elle dışlama (kural değil, tura ait karar)');

await test('slug ile dışlanır', async () => {
  const a = people.get('Boş Kişi');
  assert.equal(isSkipped(a, parseSkipList('bos-kisi')), true);
  assert.equal(isSkipped(a, parseSkipList('baska-kisi')), false);
});

await test('AD ile de dışlanır ve Türkçe karakter farkı bozmaz', async () => {
  const a = people.get('Boş Kişi');
  assert.equal(isSkipped(a, parseSkipList('Boş Kişi')), true, 'ad birebir');
  assert.equal(isSkipped(a, parseSkipList('BOS KISI')), true, 'foldTr: ş/s, İ/i, büyük harf');
});

await test('virgüllü liste ve boşluklar', async () => {
  const set = parseSkipList(' arif-ozden ,  Nur Urfalıoğlu , ');
  assert.equal(set.size, 2);
  assert.equal(isSkipped({ slug: 'arif-ozden', name: 'Arif Özden' }, set), true);
  assert.equal(isSkipped({ slug: 'nur-urfalioglu', name: 'Nur Urfalıoğlu' }, set), true);
});

await test('boş --skip hiçbir şeyi dışlamaz', async () => {
  assert.equal(parseSkipList('').size, 0);
  assert.equal(isSkipped(people.get('Boş Kişi'), parseSkipList('')), false);
});

await test('betik --skip listesini SAYIM KAPISINDAN ÖNCE uygular', async () => {
  const src = readFileSync(new URL('./archive-empty-preview-profiles.mjs', import.meta.url), 'utf8');
  const skipAt = src.indexOf('const empty = emptyAll.filter');
  const expectAt = src.indexOf('args.expect !== undefined');
  assert.ok(skipAt > 0 && expectAt > skipAt, '--expect, skip sonrası sayıyı doğrulamalı');
});

section('kaynak kelepçesi — betik kuralı KOPYALAMAZ');

const scriptSrc = readFileSync(new URL('./archive-empty-preview-profiles.mjs', import.meta.url), 'utf8');

await test('betik pop-up verisini canlı koddan alır (iki tip için de)', async () => {
  assert.match(scriptSrc, /buildOfficePayload/);
  assert.match(scriptSrc, /buildArchitectPayload/);
  assert.match(scriptSrc, /collectOfficeArchiveTargets/);
  assert.match(scriptSrc, /auditProfileContent/);
});

await test('betiğin KENDİ proje/ürün/kurucu sorgusu YOK', async () => {
  assert.equal(/FROM\s+project_designers/i.test(scriptSrc), false);
  assert.equal(/FROM\s+project_photographers/i.test(scriptSrc), false);
  assert.equal(/FROM\s+products/i.test(scriptSrc), false);
  assert.equal(/FROM\s+office_founders/i.test(scriptSrc), false);
  assert.equal(/FROM\s+product_architects/i.test(scriptSrc), false);
  assert.match(scriptSrc, /fetchArchitectLinkIds/);
});

await test('betik elle UPDATE ... hidden_at yazmaz (geri alınabilirlik)', async () => {
  assert.equal(/UPDATE\s+(offices|architects)/i.test(scriptSrc), false);
  assert.match(scriptSrc, /runContentAction\(env, user, \{ type: KIND, action: 'archive'/);
});

await test('cascade YALNIZCA firma tarafında çağrılır', async () => {
  assert.match(scriptSrc, /KIND === 'offices'\s*\?\s*await collectOfficeArchiveTargets/);
});

await test('VARSAYILAN DRY-RUN: --apply yoksa yazma dalına hiç girilmez', async () => {
  assert.match(scriptSrc, /const APPLY = !!args\.apply/);
  assert.match(scriptSrc, /if \(!APPLY\)[\s\S]{0,200}process\.exit\(0\)/);
});

await test('--audit-archived hiçbir şey yazmadan çıkar', async () => {
  assert.match(scriptSrc, /if \(AUDIT_ARCHIVED\)[\s\S]{0,1600}process\.exit\(0\)/);
});

console.log(`\n${passed} ok, ${failed} fail`);
process.exit(failed ? 1 : 0);
