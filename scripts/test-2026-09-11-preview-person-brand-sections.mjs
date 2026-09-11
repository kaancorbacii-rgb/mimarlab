#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-11 — "Blurlu kişi profillerinde de blurlu firma profillerindeki gibi
// projeler ve harita kısmı, MİMARLAB'daki Diğer Kişiler kısmı gözükmeli. Blurlu Marka ve marka
// kurucularında da aynı şekilde."
//
// Gerçek buildArchitectPayload / buildOfficePayload, node:sqlite + schema.sql üzerinde çalıştırılır.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { buildArchitectPayload } from '../src/routes/architect.js';
import { buildOfficePayload } from '../src/routes/office.js';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
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
function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0079_search_fold_columns.sql', import.meta.url), 'utf8'));
  return db;
}

// Önizlemede bir kişi (doğum yılı YOK) + önizlemede bir firma; kişinin bir yayındaki ve bir
// önizleme projesi var. Yayında 10 fotoğraflı kişi (yedek havuzu) + 1 önizleme kişisi (yedeğe
// GİRMEMELİ). Önizlemede bir marka (şehri yok), ürünü önizlemede, ürün önizleme bir projede
// kullanılmış; yayında 2 başka marka + 1 firma (marka yedeğine firma GİRMEMELİ).
function seed(db) {
  db.exec(`
    INSERT INTO offices (id, slug, name, loc, cats, source, legacy_key, hidden_at, preview_at) VALUES
      (1, 'ornek-ofis', 'Örnek Ofis', 'İstanbul', '"Mimarlık"', 'legacy_static', 'Örnek Ofis', datetime('now'), datetime('now')),
      (2, 'ornek-marka', 'Örnek Marka', NULL, '"Mobilya"', 'legacy_static', 'Örnek Marka', datetime('now'), datetime('now')),
      (3, 'marka-a', 'Marka A', 'Ankara', '"Mobilya"', 'legacy_static', 'Marka A', NULL, NULL),
      (4, 'marka-b', 'Marka B', 'İzmir', '"Mobilya"', 'legacy_static', 'Marka B', NULL, NULL),
      (5, 'firma-c', 'Firma C', 'Bursa', '"Mimarlık"', 'legacy_static', 'Firma C', NULL, NULL);
    INSERT INTO architects (id, slug, name, source, legacy_key, office_id, hidden_at, preview_at, directory_listed) VALUES
      (10, 'onizleme-kisi', 'Önizleme Kişi', 'legacy_static', 'Önizleme Kişi', 1, datetime('now'), datetime('now'), 1),
      (11, 'baska-onizleme', 'Başka Önizleme', 'legacy_static', 'Başka Önizleme', NULL, datetime('now'), datetime('now'), 1);
    INSERT INTO office_founders (office_id, architect_id) VALUES (1, 10);
    INSERT INTO projects (id, slug, title, source, legacy_key, lat, lng, project_date, hidden_at, preview_at) VALUES
      (100, 'yayindaki-proje', 'Yayındaki Proje', 'legacy_static', 'p100', 41.0, 29.0, '2020', NULL, NULL),
      (101, 'onizleme-proje', 'Önizleme Proje', 'legacy_static', 'p101', 41.1, 29.1, '2023', datetime('now'), datetime('now')),
      (102, 'marka-projesi', 'Marka Projesi', 'legacy_static', 'p102', 38.4, 27.1, '2021', datetime('now'), datetime('now'));
    INSERT INTO project_designers (project_id, architect_id, office_id) VALUES (100, 10, NULL), (101, NULL, 1);
    INSERT INTO products (id, slug, kind, title, brand_office_id, brand_name_raw, source, legacy_key, hidden_at, preview_at) VALUES
      (200, 'koltuk', 'product', 'Koltuk', 2, 'Örnek Marka', 'legacy_static', 'pr200', datetime('now'), datetime('now')),
      (201, 'masa-a', 'product', 'Masa', 3, 'Marka A', 'legacy_static', 'pr201', NULL, NULL),
      (202, 'masa-b', 'product', 'Sehpa', 4, 'Marka B', 'legacy_static', 'pr202', NULL, NULL);
    INSERT INTO project_products (project_id, product_id) VALUES (102, 200);
  `);
  const ins = db.prepare(`INSERT INTO architects (id, slug, name, source, legacy_key, photo_url, directory_listed) VALUES (?, ?, ?, 'legacy_static', ?, ?, 1)`);
  for (let i = 0; i < 10; i++) ins.run(20 + i, `canli-kisi-${i}`, `Canlı Kişi ${i}`, `Canlı Kişi ${i}`, `/media/p${i}.webp`);
}

const envFor = () => { const db = freshDb(); seed(db); return { DB: d1(db) }; };

console.log('önizleme KİŞİ popup\'ı');

await test('önizleme projeleri de gelir, yayındakilerin ARKASINDA; harita için lat/lng taşır', async () => {
  const p = await buildArchitectPayload(envFor(), 'onizleme-kisi');
  assert.equal(p.preview, true);
  assert.deepEqual(p.relatedProjects.map(x => x.slug), ['yayindaki-proje', 'onizleme-proje']);
  assert.ok(p.relatedProjects.every(x => x.lat != null && x.lng != null));
});

await test("doğum yılı yokken de \"MİMARLAB'daki Diğer Kişiler\" dolar (yalnızca yayındaki, kendisi hariç)", async () => {
  const p = await buildArchitectPayload(envFor(), 'onizleme-kisi');
  assert.equal(p.relatedArchitects.length, 9);
  const slugs = p.relatedArchitects.map(r => r.slug);
  assert.ok(slugs.every(s => s.startsWith('canli-kisi-')), `önizleme/kendi profili sızmamalı: ${slugs}`);
  assert.equal(new Set(slugs).size, slugs.length, 'tekrar yok');
});

console.log('\nönizleme MARKA popup\'ı');

await test('önizleme ürünün kullanıldığı önizleme proje gelir, harita için lat/lng taşır', async () => {
  const p = await buildOfficePayload(envFor(), 'ornek-marka');
  assert.equal(p.preview, true);
  assert.deepEqual(p.brandProductProjects.map(x => x.slug), ['marka-projesi']);
  assert.equal(p.brandProductProjects[0].lat, 38.4);
  assert.equal(p.brandProductProjects[0].lng, 27.1);
});

await test("şehri olmayan markada \"Diğer Markalar\" site genelinden dolar — yalnızca markalar, scope 'site'", async () => {
  const p = await buildOfficePayload(envFor(), 'ornek-marka');
  assert.equal(p.relatedOfficesScope, 'site');
  assert.deepEqual(p.relatedOffices.map(r => r.slug).sort(), ['marka-a', 'marka-b']);
});

await test("firma popup'ında yedek listeye saf marka sızmaz", async () => {
  const p = await buildOfficePayload(envFor(), 'ornek-ofis');
  assert.ok(!p.relatedOffices.some(r => r.slug === 'marka-a' || r.slug === 'marka-b'), JSON.stringify(p.relatedOffices));
  assert.ok(p.relatedOffices.some(r => r.slug === 'firma-c'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
