#!/usr/bin/env node
// Change 6 — canonical tablolardaki (architects/offices/projects/products) aynı isim/başlığa
// sahip mükerrer kayıtları tarar. Şema mükerrerliğe izin veriyor (yalnızca slug UNIQUE, name/title
// değil) — bkz. migrations/0022_id_first_entities.sql. Orijinal migrate-to-id-first.js'in dedup'ı
// case-SENSITIVE'ti (row.name birebir), bu yüzden büyük/küçük harf varyantı mükerrerler (ör.
// "StudioKA" / "STUDIOKA") gözden kaçmıştı — bu script trLower(trim()) ile karşılaştırır.
//
// scripts/backfill-project-products.js ile AYNI desen: HİÇBİR ŞEYİ DOĞRUDAN VERİTABANINA YAZMAZ.
//
// Modlar:
//   (bayraksız / --remote)   Varsayılan: yalnızca SELECT sorguları, ekrana insan-okunur rapor basar.
//                            Hiçbir dosya üretilmez, hiçbir yazma sorgusu çalıştırılmaz.
//   --write-sql              Ayrıca scripts/output/dedupe-canonical-records[.remote].sql üretir —
//                            operatörün ELLE inceleyip uygulayacağı, birleştirme + yeniden-anahtarlama
//                            + yumuşak-silme (deleted_at) SQL'i. Bu script bu dosyayı ASLA kendisi
//                            çalıştırmaz.
//   --local                  --remote yerine yerel dev D1'i hedefler (varsayılan --remote'dur, çünkü
//                            gerçek mükerrer sayısı yalnızca üretimde bilinir — dev anlık görüntüsü
//                            zaten yalnızca 6 çift içeriyordu ve production'ı temsil etmeyebilir).

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PERSIST_TO = '/Users/kaancorbaci/.mimarlab-dev-state';
const DB_NAME = 'mimarlab-db';
const REMOTE = !process.argv.includes('--local'); // varsayılan: --remote (production'a karşı SALT-OKUNUR SELECT)
const WRITE_SQL = process.argv.includes('--write-sql');
const TARGET_FLAG = REMOTE ? '--remote' : `--local --persist-to ${PERSIST_TO}`;

function trLower(s) {
  return (s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/Ş/g, 'ş').replace(/Ğ/g, 'ğ').replace(/Ü/g, 'ü').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç').toLowerCase();
}

function d1Query(sql) {
  const flat = sql.replace(/\s+/g, ' ').trim();
  const cmd = `npx wrangler d1 execute ${DB_NAME} ${TARGET_FLAG} --json --command ${JSON.stringify(flat)}`;
  const out = execSync(cmd, { cwd: ROOT, maxBuffer: 1024 * 1024 * 256 });
  const parsed = JSON.parse(out.toString('utf8'));
  return parsed[0].results;
}

// engagementKey(entity, row) — comments/ratings/saved_items'ın target_id/item_key olarak kullandığı
// AYNI anahtarı üretir (bkz. src/lib/cascadeDelete.js#deleteEngagement çağrı yerleri,
// src/routes/legacyContent.js#runContentCascadeDelete): architect/office -> name, project -> slug,
// product/material -> `m-${canonical id}`.
function engagementKey(entity, row) {
  if (entity === 'architects' || entity === 'offices') return row.name;
  if (entity === 'projects') return row.slug;
  if (entity === 'products') return `m-${row.id}`;
  return null;
}
function engagementTargetType(entity) {
  if (entity === 'architects') return 'architect';
  if (entity === 'offices') return 'office';
  if (entity === 'projects') return 'project';
  if (entity === 'products') return 'product'; // materials ayrı kind, bu script'te canonical 'products' tablosu taranıyor (kind='product' VEYA 'material' aynı tabloda)
  return null;
}

const ENTITY_CONFIG = [
  { entity: 'architects', nameCol: 'name' },
  { entity: 'offices', nameCol: 'name' },
  { entity: 'projects', nameCol: 'title' },
  { entity: 'products', nameCol: 'title' },
];

// groupByEitherCaseFold(rows, nameCol) — trLower (Türkçe-duyarlı İ/I katlama) TEK BAŞINA yetersiz:
// "STUDIOKA" trLower ile "studıoka" olur (I -> ı), ama "StudioKA" trLower olmadan zaten "studioka"
// (i) olarak küçülür — bu iki marka-tarzı isim asla eşleşmiyor, gerçek bir mükerrer çift (offices id
// 266/663) bu yüzden gözden kaçıyordu. Çözüm: HEM Türkçe-duyarlı katlama HEM düz ASCII toLowerCase
// ile iki anahtar üretilip, ikisinden biri eşleşen satırlar union-find ile aynı bileşene toplanır.
function groupByEitherCaseFold(rows, nameCol) {
  const parent = new Map();
  function find(x) { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; }
  function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); }

  const byTr = new Map(), byPlain = new Map();
  for (const r of rows) {
    parent.set(r.id, r.id);
    const raw = (r[nameCol] || '').trim();
    if (!raw) continue;
    const kTr = trLower(raw), kPlain = raw.toLowerCase();
    if (byTr.has(kTr)) union(r.id, byTr.get(kTr)); else byTr.set(kTr, r.id);
    if (byPlain.has(kPlain)) union(r.id, byPlain.get(kPlain)); else byPlain.set(kPlain, r.id);
  }
  const components = new Map();
  for (const r of rows) {
    const root = find(r.id);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(r);
  }
  return [...components.values()].filter(group => group.length >= 2);
}

function pickKeeper(rows) {
  // legacy_static (orijinal statik veriden) her zaman üyelerin sonradan aynı kaydı tekrar
  // göndermesinden (source='submission') önceliklidir — bu, dev DB'de bulunan iki gerçek proje
  // mükerrer çiftinde zaten gözlemlenen örüntüyle birebir aynı. İkisi de aynı source ise en düşük id
  // (= en eski) kazanır.
  return [...rows].sort((a, b) => {
    const sa = a.source === 'legacy_static' ? 0 : 1;
    const sb = b.source === 'legacy_static' ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return a.id - b.id;
  })[0];
}

async function countDependents(entity, row) {
  const key = engagementKey(entity, row);
  const targetType = engagementTargetType(entity);
  const counts = {};

  if (entity === 'architects') {
    counts.office_founders_as_architect = d1Query(`SELECT COUNT(*) AS n FROM office_founders WHERE architect_id = ${row.id}`)[0].n;
    counts.project_designers_as_architect = d1Query(`SELECT COUNT(*) AS n FROM project_designers WHERE architect_id = ${row.id}`)[0].n;
    counts.product_architects = d1Query(`SELECT COUNT(*) AS n FROM product_architects WHERE architect_id = ${row.id}`)[0].n;
  }
  if (entity === 'offices') {
    counts.office_founders_as_office = d1Query(`SELECT COUNT(*) AS n FROM office_founders WHERE office_id = ${row.id}`)[0].n;
    counts.project_designers_as_office = d1Query(`SELECT COUNT(*) AS n FROM project_designers WHERE office_id = ${row.id}`)[0].n;
  }
  if (entity === 'products') {
    counts.project_products = d1Query(`SELECT COUNT(*) AS n FROM project_products WHERE product_id = ${row.id}`)[0].n;
  }

  if (key && targetType) {
    counts.comments = d1Query(`SELECT COUNT(*) AS n FROM comments WHERE target_type = '${targetType}' AND target_id = '${key.replace(/'/g, "''")}'`)[0].n;
    counts.ratings = d1Query(`SELECT COUNT(*) AS n FROM ratings WHERE target_type = '${targetType}' AND target_id = '${key.replace(/'/g, "''")}'`)[0].n;
    counts.saved_items = d1Query(`SELECT COUNT(*) AS n FROM saved_items WHERE item_type = '${targetType}' AND item_key = '${key.replace(/'/g, "''")}'`)[0].n;
  }
  if (entity === 'architects' || entity === 'offices') {
    const nameKey = row.name.replace(/'/g, "''");
    counts.profile_claims = d1Query(`SELECT COUNT(*) AS n FROM profile_claims WHERE profile_type = '${targetType}' AND profile_key = '${nameKey}'`)[0].n;
    counts.profile_corrections = d1Query(`SELECT COUNT(*) AS n FROM profile_corrections WHERE profile_type = '${targetType}' AND profile_key = '${nameKey}'`)[0].n;
    counts.admin_badges = d1Query(`SELECT COUNT(*) AS n FROM admin_badges WHERE profile_type = '${targetType}' AND profile_key = '${nameKey}'`)[0].n;
    if (entity === 'offices') {
      counts.badge_requests = d1Query(`SELECT COUNT(*) AS n FROM badge_requests WHERE target_type = 'office' AND target_key = '${nameKey}'`)[0].n;
    }
  }
  // legacy_content_hidden: architects/offices -> name, projects -> slug, products -> "marka|||başlık"
  // (bkz. src/routes/legacyContent.js#CANONICAL_KEY_COL / runContentCascadeDelete's key.split('|||')) —
  // yalnızca architects/offices/projects için basit; products'ın brand+title anahtarı bu script'te
  // kolayca yeniden üretilemediğinden (brand_office_id -> office adı ek sorgu gerektirir) atlanıyor,
  // rapora not düşülür.
  if (entity === 'architects' || entity === 'offices') {
    const nameKey = row.name.replace(/'/g, "''");
    counts.legacy_content_hidden = d1Query(`SELECT COUNT(*) AS n FROM legacy_content_hidden WHERE content_type = '${entity}' AND content_key = '${nameKey}'`)[0].n;
  } else if (entity === 'projects') {
    const slugKey = row.slug.replace(/'/g, "''");
    counts.legacy_content_hidden = d1Query(`SELECT COUNT(*) AS n FROM legacy_content_hidden WHERE content_type = 'projects' AND content_key = '${slugKey}'`)[0].n;
  }

  return counts;
}

// buildMergeSql(entity, keeper, loser) — bir mükerrer çift için birleştirme SQL'i üretir.
// FK tabanlı bağlantı tabloları (office_founders/project_designers/product_architects/
// project_products) INSERT OR IGNORE + DELETE ile composite-PK çakışmasına karşı korunur (bkz.
// migrations/0022_id_first_entities.sql'deki PRIMARY KEY (office_id, architect_id) vb.). Ad/slug
// string ile anahtarlanan tablolardan UNIQUE kısıtlısı olanlar (ratings, saved_items,
// profile_claims, legacy_content_hidden, admin_badges — bkz. schema.sql) önce çakışan satırı SİLİP
// sonra UPDATE eder; kısıtsız olanlar (comments, profile_corrections, badge_requests) doğrudan
// UPDATE edilir. Loser canonical satırı HER ZAMAN yumuşak silinir (deleted_at) — asla hard DELETE
// (bkz. src/lib/cascadeDelete.js'in yalnızca gerçek "Sil" eyleminde hard delete yaptığı, birleştirmede
// DEĞİL — burada amaç loser'ın engagement kayıtlarını keeper'a taşımak, silmek değil).
function buildMergeSql(entity, keeper, loser) {
  const out = [];
  const esc = s => String(s).replace(/'/g, "''");
  const keeperKey = engagementKey(entity, keeper);
  const loserKey = engagementKey(entity, loser);
  const targetType = engagementTargetType(entity);

  if (entity === 'architects') {
    out.push(`INSERT OR IGNORE INTO office_founders (office_id, architect_id) SELECT office_id, ${keeper.id} FROM office_founders WHERE architect_id = ${loser.id};`);
    out.push(`DELETE FROM office_founders WHERE architect_id = ${loser.id};`);
    out.push(`UPDATE project_designers SET architect_id = ${keeper.id} WHERE architect_id = ${loser.id};`);
    out.push(`INSERT OR IGNORE INTO product_architects (product_id, architect_id) SELECT product_id, ${keeper.id} FROM product_architects WHERE architect_id = ${loser.id};`);
    out.push(`DELETE FROM product_architects WHERE architect_id = ${loser.id};`);
  }
  if (entity === 'offices') {
    out.push(`INSERT OR IGNORE INTO office_founders (office_id, architect_id) SELECT ${keeper.id}, architect_id FROM office_founders WHERE office_id = ${loser.id};`);
    out.push(`DELETE FROM office_founders WHERE office_id = ${loser.id};`);
    out.push(`UPDATE project_designers SET office_id = ${keeper.id} WHERE office_id = ${loser.id};`);
  }
  if (entity === 'products') {
    out.push(`INSERT OR IGNORE INTO project_products (project_id, product_id) SELECT project_id, ${keeper.id} FROM project_products WHERE product_id = ${loser.id};`);
    out.push(`DELETE FROM project_products WHERE product_id = ${loser.id};`);
  }

  if (keeperKey != null && loserKey != null && targetType) {
    const kk = esc(keeperKey), lk = esc(loserKey);
    // ratings — UNIQUE(user_id, target_type, target_id): önce loser'ı zaten keeper'a da oy vermiş
    // kullanıcılar için sil, sonra kalanları keeper anahtarına taşı.
    out.push(`DELETE FROM ratings WHERE target_type='${targetType}' AND target_id='${lk}' AND user_id IN (SELECT user_id FROM ratings WHERE target_type='${targetType}' AND target_id='${kk}');`);
    out.push(`UPDATE ratings SET target_id='${kk}' WHERE target_type='${targetType}' AND target_id='${lk}';`);
    // saved_items — UNIQUE(user_id, item_type, item_key): aynı desen.
    out.push(`DELETE FROM saved_items WHERE item_type='${targetType}' AND item_key='${lk}' AND user_id IN (SELECT user_id FROM saved_items WHERE item_type='${targetType}' AND item_key='${kk}');`);
    out.push(`UPDATE saved_items SET item_key='${kk}' WHERE item_type='${targetType}' AND item_key='${lk}';`);
    // comments — kısıtsız, doğrudan taşınabilir.
    out.push(`UPDATE comments SET target_id='${kk}' WHERE target_type='${targetType}' AND target_id='${lk}';`);
  }

  if (entity === 'architects' || entity === 'offices') {
    const kk = esc(keeper.name), lk = esc(loser.name);
    // profile_claims — UNIQUE(user_id, profile_type, profile_key).
    out.push(`DELETE FROM profile_claims WHERE profile_type='${targetType}' AND profile_key='${lk}' AND user_id IN (SELECT user_id FROM profile_claims WHERE profile_type='${targetType}' AND profile_key='${kk}');`);
    out.push(`UPDATE profile_claims SET profile_key='${kk}' WHERE profile_type='${targetType}' AND profile_key='${lk}';`);
    // profile_corrections — kısıtsız.
    out.push(`UPDATE profile_corrections SET profile_key='${kk}' WHERE profile_type='${targetType}' AND profile_key='${lk}';`);
    // admin_badges — PRIMARY KEY (profile_type, profile_key): loser'da varsa ve keeper'da zaten
    // yoksa taşı; ikisinde de varsa loser'ınkini at (keeper'ınki geçerli kalır).
    out.push(`DELETE FROM admin_badges WHERE profile_type='${targetType}' AND profile_key='${lk}' AND EXISTS (SELECT 1 FROM admin_badges WHERE profile_type='${targetType}' AND profile_key='${kk}');`);
    out.push(`UPDATE admin_badges SET profile_key='${kk}' WHERE profile_type='${targetType}' AND profile_key='${lk}';`);
    // legacy_content_hidden — UNIQUE(content_type, content_key).
    out.push(`DELETE FROM legacy_content_hidden WHERE content_type='${entity}' AND content_key='${lk}' AND EXISTS (SELECT 1 FROM legacy_content_hidden WHERE content_type='${entity}' AND content_key='${kk}');`);
    out.push(`UPDATE legacy_content_hidden SET content_key='${kk}' WHERE content_type='${entity}' AND content_key='${lk}';`);
    if (entity === 'offices') {
      out.push(`UPDATE badge_requests SET target_key='${kk}' WHERE target_type='office' AND target_key='${lk}';`);
    }
  } else if (entity === 'projects') {
    const kk = esc(keeper.slug), lk = esc(loser.slug);
    out.push(`DELETE FROM legacy_content_hidden WHERE content_type='projects' AND content_key='${lk}' AND EXISTS (SELECT 1 FROM legacy_content_hidden WHERE content_type='projects' AND content_key='${kk}');`);
    out.push(`UPDATE legacy_content_hidden SET content_key='${kk}' WHERE content_type='projects' AND content_key='${lk}';`);
  }

  // Loser canonical satırı yumuşak silinir — asla hard DELETE (bkz. dosya başı yorum).
  out.push(`UPDATE ${entity} SET deleted_at = datetime('now') WHERE id = ${loser.id};`);
  return out;
}

// *_submissions serbest-metin JSON alanlarındaki (office_submissions.founders,
// project_submissions.designer/.brands, product_submissions.architect, material_submissions.architect)
// loser adı geçen satırları bulup keeper adına yeniden yazan SQL üretir. SQL REPLACE() yerine JS
// tarafında JSON.parse/rewrite yapılır (JSON içi string manipülasyonu SQL'de kırılgan) — bkz. plan.
function buildSubmissionsRenameSql(entity, keeper, loser) {
  if (entity !== 'architects' && entity !== 'offices') return [];
  const out = [];
  const table = entity === 'architects'
    ? [
        { table: 'office_submissions', column: 'founders' },
        { table: 'project_submissions', column: 'designer' },
        { table: 'product_submissions', column: 'architect' },
        { table: 'material_submissions', column: 'architect' },
      ]
    : [
        { table: 'project_submissions', column: 'brands' },
      ];
  for (const { table: t, column } of table) {
    const rows = d1Query(`SELECT id, ${column} FROM ${t} WHERE ${column} LIKE '%${loser.name.replace(/'/g, "''")}%'`);
    for (const row of rows) {
      let raw;
      try { raw = JSON.parse(row[column]); } catch { continue; }
      if (!Array.isArray(raw)) continue;
      let changed = false;
      const rewritten = raw.map(entry => {
        if (typeof entry === 'string' && entry === loser.name) { changed = true; return keeper.name; }
        if (entry && typeof entry === 'object') {
          const copy = { ...entry };
          for (const field of ['brand', 'name']) {
            if (copy[field] === loser.name) { copy[field] = keeper.name; changed = true; }
          }
          return copy;
        }
        return entry;
      });
      if (changed) {
        const json = JSON.stringify(rewritten).replace(/'/g, "''");
        out.push(`UPDATE ${t} SET ${column} = '${json}' WHERE id = '${row.id}';`);
      }
    }
  }
  return out;
}

async function main() {
  console.log(`Mükerrer kayıt taraması (${REMOTE ? 'PRODUCTION — yalnızca SELECT' : 'yerel dev D1'})...\n`);
  const report = [];

  for (const { entity, nameCol } of ENTITY_CONFIG) {
    const rows = d1Query(`SELECT * FROM ${entity} WHERE deleted_at IS NULL`);
    const groups = groupByEitherCaseFold(rows, nameCol);
    for (const dupes of groups) {
      const keeper = pickKeeper(dupes);
      const losers = dupes.filter(r => r.id !== keeper.id);
      const key = trLower((keeper[nameCol] || '').trim());
      report.push({ entity, key, keeper, losers });
    }
  }

  if (!report.length) {
    console.log('Hiçbir mükerrer kayıt bulunamadı.');
    return;
  }

  console.log(`${report.length} mükerrer grup bulundu:\n`);
  for (const { entity, key, keeper, losers } of report) {
    console.log(`\n=== ${entity} — "${key}" ===`);
    console.log(`  KEEPER: id=${keeper.id} slug=${keeper.slug} source=${keeper.source} name/title="${keeper.name || keeper.title}"`);
    for (const loser of losers) {
      console.log(`  LOSER:  id=${loser.id} slug=${loser.slug} source=${loser.source} name/title="${loser.name || loser.title}"`);
      const counts = await countDependents(entity, loser);
      const nonZero = Object.entries(counts).filter(([, n]) => n > 0);
      if (nonZero.length) {
        console.log(`          bağımlı kayıtlar: ${nonZero.map(([k, n]) => `${k}=${n}`).join(', ')}`);
      } else {
        console.log('          bağımlı kayıt yok (temiz birleştirme).');
      }
    }
  }

  if (WRITE_SQL) {
    const sqlLines = [];
    sqlLines.push('-- scripts/dedupe-canonical-records.js tarafından üretildi, ' + new Date().toISOString());
    sqlLines.push('-- UYGULAMADAN ÖNCE ELLE İNCELE. Her ifade tek bir mükerrer grubu birleştirir: bağımlı');
    sqlLines.push('-- kayıtları keeper anahtarına taşır, loser canonical satırını yumuşak siler (deleted_at).');
    sqlLines.push('-- Hiçbir hard DELETE yoktur.');
    for (const { entity, keeper, losers } of report) {
      for (const loser of losers) {
        sqlLines.push(`\n-- ${entity}: keeper id=${keeper.id} ("${keeper.name || keeper.title}") <- loser id=${loser.id} ("${loser.name || loser.title}")`);
        for (const stmt of buildMergeSql(entity, keeper, loser)) sqlLines.push(stmt);
        for (const stmt of buildSubmissionsRenameSql(entity, keeper, loser)) sqlLines.push(stmt);
      }
    }
    const outDir = path.join(__dirname, 'output');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, REMOTE ? 'dedupe-canonical-records.remote.sql' : 'dedupe-canonical-records.sql');
    fs.writeFileSync(outFile, sqlLines.join('\n') + '\n', 'utf8');
    console.log(`\nÜretilen dosya: ${path.relative(ROOT, outFile)}`);
    console.log('Bu dosya HENÜZ hiçbir veritabanına uygulanmadı. İncele, sonra örn.:');
    console.log(`  npx wrangler d1 execute ${DB_NAME} ${TARGET_FLAG} --file=${path.relative(ROOT, outFile)}`);
  }

  console.log(`\nToplam ${report.length} grup, ${report.reduce((a, r) => a + r.losers.length, 0)} olası mükerrer satır.`);
  console.log('Hiçbir veritabanına yazma yapılmadı.');
}

main().catch(err => {
  console.error('Hata:', err.message || err);
  process.exit(1);
});
