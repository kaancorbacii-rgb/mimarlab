#!/usr/bin/env node
// Faz 4 — project_products tek seferlik backfill: project_products (bkz. migrations/
// 0022_id_first_entities.sql) şemada olmasına rağmen hiçbir zaman doldurulmadı (Faz 2'de bilerek
// ertelenmiş, bkz. scripts/merge-submissions-to-id-first.js'teki "brands: canonical projects
// tablosunda karşılık gelen bir kolon yok ... bilerek atlanıyor" yorumu). Proje modalının
// "Kullanılan Ürünler/Malzemeler" bölümü artık bu tabloyu okuyor (bkz. src/routes/
// project.js#fetchProjectProducts) — canlı onay akışı artık src/lib/canonicalSync.js#syncProject
// (resolveProjectProductLinks) ile doğru şekilde dolduruyor, ama bu script SADECE o değişiklikten
// ÖNCE onaylanmış mevcut proje gönderilerini (approved project_submissions.brands) geriye dönük bağlar.
//
// HİÇBİR ŞEYİ DOĞRUDAN VERİTABANINA YAZMAZ — scripts/merge-submissions-to-id-first.js ile AYNI
// desen: yalnızca scripts/output/project-products-backfill.sql üretir, operatör inceleyip
// `wrangler d1 execute --local/--remote --file=...` ile uygular.
//
// Statik (legacy_static) projeler zaten hiçbir zaman brands verisine sahip olmadı (bkz. gerçek
// bulgu: projeler-data.js'de 0 brands kaydı) — bu script yalnızca approved project_submissions
// satırlarını tarar, statik projeler için hiçbir satır üretmez (bu bir regresyon değil, zaten hiç
// çalışmayan bir özelliğin mevcut durumu aynen korunuyor).

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PERSIST_TO = '/Users/kaancorbaci/.mimarlab-dev-state';
const DB_NAME = 'mimarlab-db';
// --remote geçilirse gerçek üretim D1'ini SORGULAR (yalnızca SELECT — hiçbir yazma yapılmaz burada,
// bkz. dosya başı yorum); varsayılan (bayraksız) hâlâ yerel dev D1'i hedefler.
const REMOTE = process.argv.includes('--remote');
const TARGET_FLAG = REMOTE ? '--remote' : `--local --persist-to ${PERSIST_TO}`;

function d1Query(sql) {
  const flat = sql.replace(/\s+/g, ' ').trim();
  const cmd = `npx wrangler d1 execute ${DB_NAME} ${TARGET_FLAG} --json --command ${JSON.stringify(flat)}`;
  const out = execSync(cmd, { cwd: ROOT, maxBuffer: 1024 * 1024 * 128 });
  const parsed = JSON.parse(out.toString('utf8'));
  return parsed[0].results;
}

// row.brands hem eski düz marka-adı string dizisi hem de yeni {brand, product} nesne dizisi
// biçiminde olabilir (bkz. proje-ekle.html#brandChips, src/lib/canonicalSync.js#brandEntryOf ile
// AYNI normalize — bu script plain `node` ile çalıştığından ESM'i require edemiyor, bilerek
// tekrar tanımlanıyor, bkz. bu dizindeki diğer script'lerdeki AYNI kısıt).
function brandEntryOf(b) { return typeof b === 'string' ? { brand: b, product: null } : b; }

console.log(`Onaylı proje gönderileri okunuyor (${REMOTE ? 'PROD' : 'yerel dev D1'})...`);
const projectSubsRaw = d1Query(`SELECT id, claimed_slug, brands FROM project_submissions WHERE status = 'approved' AND brands IS NOT NULL AND brands != '[]'`);
const projectSubs = projectSubsRaw
  .map(r => ({ ...r, brands: (() => { try { return JSON.parse(r.brands) || []; } catch { return []; } })() }))
  .filter(r => r.brands.length);

console.log('Canonical tablolar okunuyor...');
const canonProjects = d1Query(`SELECT id, slug, legacy_key FROM projects WHERE deleted_at IS NULL`);
const canonOffices = d1Query(`SELECT id, name FROM offices WHERE deleted_at IS NULL`);
const canonProducts = d1Query(`SELECT id, title, brand_office_id, brand_name_raw FROM products WHERE deleted_at IS NULL`);
const existingLinks = new Set(
  d1Query(`SELECT project_id, product_id FROM project_products`).map(r => `${r.project_id}:${r.product_id}`)
);

const projectByLegacyKey = new Map(canonProjects.filter(p => p.legacy_key).map(p => [p.legacy_key, p]));
const projectBySlug = new Map(canonProjects.map(p => [p.slug, p]));
const officeByName = new Map(canonOffices.map(o => [o.name, o]));

function findProductIds(officeId, brandNameRaw, productTitle) {
  return canonProducts
    .filter(p => (officeId ? p.brand_office_id === officeId : (!p.brand_office_id && p.brand_name_raw === brandNameRaw)))
    .filter(p => !productTitle || p.title === productTitle)
    .map(p => p.id);
}

const out = [];
let linkCount = 0, skippedNoProject = 0, skippedNoMatch = 0;
out.push('-- Faz 4 project_products backfill — scripts/backfill-project-products.js tarafından üretildi, ' + new Date().toISOString());
out.push('-- Elle çalıştırılmadan önce gözden geçirin.');

for (const sub of projectSubs) {
  // bkz. src/lib/canonicalSync.js#syncProject/submissionMarker — claim'siz (bağımsız) gönderilerin
  // canonical satırı legacy_key = 'submission:<id>' ile işaretlenir; claim'li gönderiler
  // claimed_slug üzerinden (legacy_key ya da doğrudan slug eşleşmesiyle) bulunur.
  const target = sub.claimed_slug
    ? (projectByLegacyKey.get(sub.claimed_slug) || projectBySlug.get(sub.claimed_slug))
    : projectByLegacyKey.get(`submission:${sub.id}`);
  if (!target) { skippedNoProject++; continue; }

  for (const raw of sub.brands) {
    const entry = brandEntryOf(raw);
    if (!entry || !entry.brand) continue;
    const office = officeByName.get(entry.brand);
    const ids = findProductIds(office ? office.id : null, entry.brand, entry.product);
    if (!ids.length) { skippedNoMatch++; continue; }
    for (const productId of ids) {
      const key = `${target.id}:${productId}`;
      if (existingLinks.has(key)) continue;
      existingLinks.add(key);
      out.push(`INSERT OR IGNORE INTO project_products (project_id, product_id) VALUES (${target.id}, ${productId});`);
      linkCount++;
    }
  }
}

const outDir = path.join(__dirname, 'output');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, REMOTE ? 'project-products-backfill.remote.sql' : 'project-products-backfill.sql');
fs.writeFileSync(outFile, out.join('\n') + '\n', 'utf8');

console.log(`\nÜretilen dosya: ${path.relative(ROOT, outFile)} (${REMOTE ? 'PROD verisinden' : 'yerel dev D1 verisinden'})`);
console.log(`  taranan onaylı proje gönderisi (brands dolu): ${projectSubs.length}`);
console.log(`  eşleşen canonical proje bulunamadı: ${skippedNoProject}`);
console.log(`  marka/ürün eşleşmedi: ${skippedNoMatch}`);
console.log(`  üretilen project_products bağlantısı: ${linkCount}`);
console.log('\nBu dosya HENÜZ hiçbir veritabanına uygulanmadı. İncele, sonra örn.:');
console.log(`  npx wrangler d1 execute ${DB_NAME} ${TARGET_FLAG} --file=${path.relative(ROOT, outFile)}`);
