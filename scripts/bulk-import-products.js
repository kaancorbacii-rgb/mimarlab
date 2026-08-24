#!/usr/bin/env node
// Bir seferlik toplu ürün ithalatı — 5 paralel scraping batch'inin ürettiği manifest.json
// dosyalarını (product-import/batch{1..5}/manifest.json) okur, D1'e karşı marka+başlık
// (TR-fold) dedup kontrolü yapar (bkz. src/lib/canonicalSync.js#isDuplicateCanonicalName),
// hayatta kalan her ürün için slug üretir (src/lib/slugify.js ile BİREBİR aynı algoritma,
// scripts/backfill-product-slugs.js'teki AYNI desen), webp görselleri R2'ye yükler ve
// products tablosuna INSERT eder. --remote D1 transaction desteklemediğinden (bkz.
// merge-submissions-to-id-first.js:349) her ifade ayrı ayrı çalıştırılır.
//
// Kullanım:
//   node scripts/bulk-import-products.js --dry-run   (varsayılan davranış: sadece rapor, hiçbir şey yazmaz)
//   node scripts/bulk-import-products.js --write     (gerçekten R2'ye yükler + D1'e INSERT eder, --remote)

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB_NAME = 'mimarlab-db';
const BUCKET = 'mimarlab-uploads';
const WRITE = process.argv.includes('--write');
const SCRATCH = '/private/tmp/claude-501/-Users-kaancorbaci-Projects-mimarlab--claude-worktrees-mimarlab-furniture-catalog-f67c42/4e733908-f9b1-4d9e-a521-375bb05374e6/scratchpad/product-import';

const TR_MAP = { ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', I: 'i', İ: 'i', ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u' };
function slugify(text) {
  return (text || '')
    .split('').map(ch => TR_MAP[ch] || ch).join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
function foldTr(s) {
  return String(s || '').split('').map(ch => TR_MAP[ch] || ch).join('').toLowerCase().trim();
}
function sqlEscape(s) { return String(s == null ? '' : s).replace(/'/g, "''"); }

function d1Query(sql) {
  const flat = sql.replace(/\s+/g, ' ').trim();
  const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --json --command ${JSON.stringify(flat)}`;
  const out = execSync(cmd, { cwd: ROOT, maxBuffer: 1024 * 1024 * 256 });
  return JSON.parse(out.toString('utf8'))[0].results;
}
function d1Exec(sql) {
  const flat = sql.replace(/\s+/g, ' ').trim();
  const cmd = `npx wrangler d1 execute ${DB_NAME} --remote --command ${JSON.stringify(flat)}`;
  execSync(cmd, { cwd: ROOT, maxBuffer: 1024 * 1024 * 256, stdio: 'pipe' });
}

console.log(`Mod: ${WRITE ? 'WRITE (R2 + D1 --remote yazılacak)' : 'DRY-RUN (sadece rapor)'}\n`);

// 1) Manifest'leri topla
let staged = [];
for (let b = 1; b <= 5; b++) {
  const file = path.join(SCRATCH, `batch${b}`, 'manifest.json');
  if (!fs.existsSync(file)) { console.log(`UYARI: ${file} yok, atlanıyor.`); continue; }
  const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
  arr.forEach(p => staged.push({ ...p, batch: b }));
}
console.log(`Toplam manifest satırı: ${staged.length}`);

const ok = staged.filter(p => p.status === 'ok');
const skippedAtSource = staged.filter(p => p.status !== 'ok');
console.log(`Scraping aşamasında skip edilen: ${skippedAtSource.length}`);
skippedAtSource.forEach(p => console.log(`  - [batch${p.batch}#${p.index}] ${p.title || p.source_url}: ${p.skip_reason || '(sebep yok)'}`));

// 2) Görsel doğrulama — webp_dir gerçekten dosya içeriyor mu
const withImages = [];
for (const p of ok) {
  const dir = p.webp_dir;
  const files = dir && fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.webp')).sort() : [];
  if (!files.length) {
    console.log(`ATLANDI (görsel yok): [batch${p.batch}#${p.index}] ${p.title}`);
    continue;
  }
  withImages.push({ ...p, webpFiles: files.map(f => path.join(dir, f)) });
}
console.log(`\nGörseli olan, aday ürün: ${withImages.length}`);

// 3) Mevcut D1 ürünleriyle dedup (marka+başlık, TR-fold, tam eşleşme) — bkz. canonicalSync.js:112-131
console.log('\nD1 (production, --remote) mevcut ürünler okunuyor...');
const existing = d1Query(`SELECT title, brand_name_raw, slug FROM products WHERE deleted_at IS NULL`);
const existingKeySet = new Set(existing.map(r => `${foldTr(r.brand_name_raw)}|||${foldTr(r.title)}`));
const existingSlugSet = new Set(existing.map(r => r.slug));
console.log(`D1'de mevcut ürün/malzeme satırı: ${existing.length}`);

// Manifest'lerdeki title "Marka - Ürün Adı" biçiminde (görev talebindeki örnek format) ama bu
// tablodaki mevcut 128 satırın HİÇBİRİ title'a marka eklemiyor (brand_name_raw ayrı sütunda,
// urun.html marka rozetini title'ın YANINA ayrı bir eleman olarak basıyor, birleştirmiyor —
// bkz. urun.html:726-727 "content-card-title"/"content-card-by"). Marka title içinde kalırsa
// UI'da "VitrA" rozetinin üstünde "VitrA - Voyage" başlığı görünüp gereksiz tekrar oluşur.
// Bu yüzden mevcut kayıtlarla TUTARLI olacak şekilde temiz başlığa indirgeniyor.
function stripBrandPrefix(title, brand) {
  if (!title || !brand) return title;
  const re = new RegExp('^\\s*' + brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[-–—]\\s*', 'i');
  const stripped = title.replace(re, '').trim();
  return stripped || title;
}

const seenInBatch = new Set();
const toInsert = [];
const duplicates = [];
for (const raw of withImages) {
  const p = { ...raw, title: stripBrandPrefix(raw.title, raw.brand) };
  const key = `${foldTr(p.brand)}|||${foldTr(p.title)}`;
  if (existingKeySet.has(key) || seenInBatch.has(key)) {
    duplicates.push(p);
    continue;
  }
  seenInBatch.add(key);
  toInsert.push(p);
}
console.log(`Mükerrer (D1'de zaten var / batch içinde tekrar): ${duplicates.length}`);
duplicates.forEach(p => console.log(`  - [batch${p.batch}#${p.index}] ${p.title}`));
console.log(`\nEklenecek YENİ ürün sayısı: ${toInsert.length}`);

if (!toInsert.length) {
  console.log('\nEklenecek ürün yok, çıkılıyor.');
  process.exit(0);
}

// 4) offices tablosunda marka adı eşleşmesi (best-effort, sadece favicon/kart görünümü için — opsiyonel)
console.log('\noffices tablosunda marka eşleşmeleri kontrol ediliyor (best-effort)...');
const offices = d1Query(`SELECT id, name FROM offices WHERE deleted_at IS NULL`);
const officeByFold = new Map(offices.map(o => [foldTr(o.name), o.id]));

// 5) Her ürün için: slug üret, görselleri R2'ye yükle (WRITE modunda), INSERT
const report = [];
for (const p of toInsert) {
  let base = slugify(`${p.title}-${p.brand}`) || slugify(p.title) || `urun-${p.batch}-${p.index}`;
  let slug = base, n = 2;
  while (existingSlugSet.has(slug)) { slug = `${base}-${n}`; n++; }
  existingSlugSet.add(slug);

  const brandOfficeId = officeByFold.get(foldTr(p.brand)) || null;
  const legacyKey = `${p.brand}|||${p.title}`;

  const imageUrls = [];
  p.webpFiles.forEach((localPath, i) => {
    const key = `import/products/${slug}/${i + 1}.webp`;
    if (WRITE) {
      const cmd = `npx wrangler r2 object put ${BUCKET}/${key} --remote --file=${JSON.stringify(localPath)} --content-type=image/webp`;
      execSync(cmd, { cwd: ROOT, stdio: 'pipe' });
    }
    imageUrls.push(`/media/${key}`);
  });

  const specsJson = JSON.stringify(p.specs || []);
  const imagesJson = JSON.stringify(imageUrls);

  if (WRITE) {
    const cols = ['slug', 'kind', 'title', 'brand_office_id', 'brand_name_raw', 'website', 'category',
      'description', 'images', 'specs', 'source_url', 'source', 'legacy_key', 'designer', 'year'];
    const vals = [
      `'${sqlEscape(slug)}'`,
      `'${sqlEscape(p.kind)}'`,
      `'${sqlEscape(p.title)}'`,
      brandOfficeId ? brandOfficeId : 'NULL',
      `'${sqlEscape(p.brand)}'`,
      `'${sqlEscape(p.website || p.source_url)}'`,
      `'${sqlEscape(p.category)}'`,
      `'${sqlEscape(p.description || '')}'`,
      `'${sqlEscape(imagesJson)}'`,
      `'${sqlEscape(specsJson)}'`,
      `'${sqlEscape(p.source_url)}'`,
      `'admin'`,
      `'${sqlEscape(legacyKey)}'`,
      p.designer ? `'${sqlEscape(p.designer)}'` : 'NULL',
      p.year ? `'${sqlEscape(p.year)}'` : 'NULL',
    ];
    d1Exec(`INSERT INTO products (${cols.join(',')}) VALUES (${vals.join(',')})`);
  }

  report.push({ slug, title: p.title, brand: p.brand, kind: p.kind, category: p.category, images: imageUrls.length, brandOfficeId });
  console.log(`${WRITE ? 'EKLENDİ' : '[dry-run] eklenecek'}: ${p.title} -> /urun/${slug} (${imageUrls.length} görsel${brandOfficeId ? ', brand_office_id=' + brandOfficeId : ''})`);
}

console.log(`\n${WRITE ? 'Tamamlandı' : 'Dry-run tamamlandı'}: ${report.length} ürün ${WRITE ? 'D1 + R2\'ye yazıldı' : '(henüz yazılmadı)'}.`);
fs.writeFileSync(path.join(SCRATCH, 'import-report.json'), JSON.stringify(report, null, 2));
