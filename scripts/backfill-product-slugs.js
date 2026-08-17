#!/usr/bin/env node
// Bir seferlik geriye dönük temizlik — src/lib/canonicalSync.js#syncProduct eskiden HER onaylı
// ürün/malzeme gönderisine slug='m-<submissionId>' (bkz. kullanıcı isteği: "Ürün sayfalarındaki
// ürünlerin URL'lerini ürün adları olarak düzgünce düzelt" — canlıda ör. /urun/m-aeac61ea-44d9-
// 4332-87a7-48c24ab1d2c2, submission id'leri UUID olduğundan) veriyordu. syncProduct artık YENİ
// kayıtlar için başlık+marka'dan slugify edilmiş bir slug üretiyor (architects/offices/projects'teki
// AYNI desen) — ama bu, düzeltmeden ÖNCE zaten "m-<id>" ile oluşturulmuş mevcut ürünleri kapsamıyor
// (kullanıcının onayladığı kapsam: "Mevcutları da backfill et"). Bu script TAM OLARAK o boşluğu
// doldurur: "m-<id>" biçimindeki HER ürünün slug'ını slugify(title+"-"+brand)'a çevirir.
//
// legacy_static kökenli ürünler (slug zaten "<başlık-marka>-<id>" biçiminde, bkz. src/routes/
// product.js dosya başı yorumu) bu regex'e hiç uymadığından dokunulmadan kalır.
//
// scripts/backfill-project-slugs.js ile AYNI desen: HİÇBİR ŞEYİ DOĞRUDAN VERİTABANINA YAZMAZ,
// yalnızca rapor basar ve (--write-sql ile) operatörün elle inceleyip uygulayacağı bir .sql dosyası
// üretir. products/materials'ta comments/ratings/saved_items slug'la DEĞİL ayrı bir "rating key"yle
// (bkz. src/routes/product.js#ratingKeyFor — submission kökenli satırlarda hep "m-<submissionId>",
// slug'dan bağımsız) referans verdiğinden, projelerdeki gibi bu üç tabloyu taşımaya GEREK YOK —
// yalnızca products.slug güncellenir, legacy_key boşsa (bkz. syncProduct'ın eski satırlarda hiç
// yazmadığı GERÇEK BULGU) "submission:<id>" ile doldurulur (src/routes/product.js#
// findProductByLegacyMarker'ın "m-<id>"/"submission:<id>" eski bağlantıları hâlâ çözebilmesi için)
// ve slug_redirects'e eski->yeni eşlemesi eklenir (bkz. src/index.js#serveDetailPage, tam sayfa
// yüklemelerinde 301).
//
// Modlar:
//   (bayraksız / --remote)   Varsayılan: yalnızca SELECT, ekrana insan-okunur rapor basar.
//   --write-sql              Ayrıca scripts/output/backfill-product-slugs[.remote].sql üretir.
//   --local                  --remote yerine yerel dev D1'i hedefler (varsayılan --remote'dur).

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PERSIST_TO = '/Users/kaancorbaci/.mimarlab-dev-state';
const DB_NAME = 'mimarlab-db';
const REMOTE = !process.argv.includes('--local');
const WRITE_SQL = process.argv.includes('--write-sql');
const TARGET_FLAG = REMOTE ? '--remote' : `--local --persist-to ${PERSIST_TO}`;

function d1Query(sql) {
  const flat = sql.replace(/\s+/g, ' ').trim();
  const cmd = `npx wrangler d1 execute ${DB_NAME} ${TARGET_FLAG} --json --command ${JSON.stringify(flat)}`;
  const out = execSync(cmd, { cwd: ROOT, maxBuffer: 1024 * 1024 * 256 });
  const parsed = JSON.parse(out.toString('utf8'));
  return parsed[0].results;
}

function sqlEscape(s) { return String(s).replace(/'/g, "''"); }

// src/lib/slugify.js ile BİREBİR aynı algoritma — bu script plain `node` ile çalıştığından ESM'i
// require edemiyor, bilerek tekrar tanımlanıyor (bkz. backfill-project-slugs.js'teki AYNI kısıt).
const TR_MAP = { ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', I: 'i', İ: 'i', ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u' };
function slugify(text) {
  return (text || '')
    .split('').map(ch => TR_MAP[ch] || ch).join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

console.log(`Ürünler okunuyor (${REMOTE ? 'PRODUCTION D1' : 'yerel dev D1'})...`);
const rows = d1Query(`SELECT id, slug, title, brand_name_raw, legacy_key FROM products WHERE deleted_at IS NULL ORDER BY id`);
console.log(`Taranan ürün/malzeme satırı: ${rows.length}`);

// "m-<eski submission id>" biçimine BİREBİR uyan satırlar hedeflenir — id kısmı UUID de olabilir,
// bu yüzden \d+ değil (.+) kullanılır (bkz. dosya başı yorumu).
const LEGACY_SLUG_RE = /^m-(.+)$/;
const usedSlugs = new Set(rows.map(r => r.slug));
const renames = [];
for (const row of rows) {
  const m = LEGACY_SLUG_RE.exec(row.slug);
  if (!m) continue; // legacy_static ya da zaten isim tabanlı bir slug — dokunma
  const submissionId = m[1];
  const base = slugify(`${row.title}-${row.brand_name_raw || ''}`) || row.slug;
  if (base === row.slug) continue; // slugify boş döndü, zaten aynı — atla
  usedSlugs.delete(row.slug); // kendi eski slug'ı artık serbest (aynı satıra ait)
  let candidate = base, n = 2;
  while (usedSlugs.has(candidate)) { candidate = `${base}-${n}`; n++; }
  usedSlugs.add(candidate);
  renames.push({
    id: row.id,
    oldSlug: row.slug,
    newSlug: candidate,
    title: row.title,
    submissionId,
    needsLegacyKey: !row.legacy_key,
  });
}

console.log(`"m-<id>" biçimli, yeniden adlandırılacak satır: ${renames.length}`);
if (renames.length) {
  console.log('\nid\teski slug\t\t\t\t->\tyeni slug');
  renames.forEach(r => console.log(`${r.id}\t${r.oldSlug}\t->\t${r.newSlug}${r.needsLegacyKey ? '\t(legacy_key de dolduruluyor)' : ''}`));
}

if (WRITE_SQL && renames.length) {
  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, REMOTE ? 'backfill-product-slugs.remote.sql' : 'backfill-product-slugs.sql');
  const statements = [];
  for (const r of renames) {
    const oldS = sqlEscape(r.oldSlug), newS = sqlEscape(r.newSlug);
    if (r.needsLegacyKey) {
      const legacyKey = sqlEscape(`submission:${r.submissionId}`);
      statements.push(`UPDATE products SET slug = '${newS}', legacy_key = '${legacyKey}', updated_at = datetime('now') WHERE id = ${r.id};`);
    } else {
      statements.push(`UPDATE products SET slug = '${newS}', updated_at = datetime('now') WHERE id = ${r.id};`);
    }
    // bkz. src/lib/slugRedirects.js#recordSlugRedirect ile AYNI zincir-çöküşü mantığı.
    statements.push(`UPDATE slug_redirects SET new_slug = '${newS}', created_at = datetime('now') WHERE entity_type = 'products' AND new_slug = '${oldS}';`);
    statements.push(`DELETE FROM slug_redirects WHERE entity_type = 'products' AND old_slug = '${newS}';`);
    statements.push(
      `INSERT INTO slug_redirects (entity_type, old_slug, new_slug) VALUES ('products', '${oldS}', '${newS}') ` +
      `ON CONFLICT(entity_type, old_slug) DO UPDATE SET new_slug = excluded.new_slug, created_at = datetime('now');`
    );
  }
  fs.writeFileSync(outFile, statements.join('\n') + '\n', 'utf8');
  console.log(`\nÜretilen dosya: ${path.relative(ROOT, outFile)} (${REMOTE ? 'PROD verisinden' : 'yerel dev D1 verisinden'})`);
  console.log(`${renames.length} ürün x ~4 ifade = ${statements.length} SQL ifadesi.`);
  console.log('\nBu dosya HENÜZ hiçbir veritabanına uygulanmadı. İncele, sonra örn.:');
  console.log(`  npx wrangler d1 execute ${DB_NAME} ${TARGET_FLAG} --file=${path.relative(ROOT, outFile)}`);
} else if (!WRITE_SQL && renames.length) {
  console.log('\nBir .sql dosyası üretmek için --write-sql ekleyerek tekrar çalıştır.');
}
