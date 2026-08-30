#!/usr/bin/env node
// Set 2 toplu ürün ithalatı (2026-08-29) — 10 paralel scraping batch'inin ürettiği
// manifest.json dosyalarını (product-import-set2/batch{1..10}/manifest.json) okur,
// D1'e karşı marka+başlık (TR-fold) dedup kontrolü yapar, slug üretir, webp görselleri
// ve (varsa) CAD/BIM/PDF dosyalarını R2'ye yükler, products tablosuna INSERT eder.
// bkz. scripts/bulk-import-products.js — aynı desen, manifest şeması ve 'files' desteği farklı.
//
// Kullanım:
//   node scripts/import-furniture-set2.js --dry-run   (varsayılan: sadece rapor, hiçbir şey yazmaz)
//   node scripts/import-furniture-set2.js --write     (R2'ye yükler + D1'e INSERT eder, --remote)

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB_NAME = 'mimarlab-db';
const BUCKET = 'mimarlab-uploads';
const WRITE = process.argv.includes('--write');
const SCRATCH = '/private/tmp/claude-501/-Users-kaancorbaci-Projects-mimarlab--claude-worktrees-mimarlab-furniture-catalog-f67c42/01cb1552-712e-4026-b8b0-c0b9e18542a2/scratchpad/product-import-set2';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

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
for (let b = 1; b <= 10; b++) {
  const dir = path.join(SCRATCH, `batch${b}`);
  const file = path.join(dir, 'manifest.json');
  if (!fs.existsSync(file)) { console.log(`UYARI: ${file} yok, atlanıyor.`); continue; }
  const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
  arr.forEach(p => staged.push({ ...p, batch: b, batchDir: dir }));
}
console.log(`Toplam manifest satırı: ${staged.length}`);

const ok = staged.filter(p => p.status === 'ok');
const skippedAtSource = staged.filter(p => p.status !== 'ok');
console.log(`Scraping aşamasında skip edilen: ${skippedAtSource.length}`);
skippedAtSource.forEach(p => console.log(`  - [batch${p.batch}#${p.index}] ${p.title || p.source_url}: ${p.skip_reason || '(sebep yok)'}`));

// 2) Görsel doğrulama — images/<index>/ gerçekten webp içeriyor mu
const withImages = [];
for (const p of ok) {
  const dir = path.join(p.batchDir, 'images', String(p.index));
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.webp')).sort() : [];
  withImages.push({ ...p, webpFiles: files.map(f => path.join(dir, f)) });
  if (!files.length) console.log(`NOT: görseli yok ama devam ediyor: [batch${p.batch}#${p.index}] ${p.title}`);
}
console.log(`\nGeçerli (title dolu), aday ürün: ${withImages.length}`);

// 3) Mevcut D1 ürünleriyle dedup (marka+başlık, TR-fold, tam eşleşme)
console.log('\nD1 (production, --remote) mevcut ürünler okunuyor...');
const existing = d1Query(`SELECT title, brand_name_raw, slug FROM products WHERE deleted_at IS NULL`);
const existingKeySet = new Set(existing.map(r => `${foldTr(r.brand_name_raw)}|||${foldTr(r.title)}`));
const existingSlugSet = new Set(existing.map(r => r.slug));
console.log(`D1'de mevcut ürün/malzeme satırı: ${existing.length}`);

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
  if (!raw.title || !raw.brand) { console.log(`ATLANDI (title/brand eksik): [batch${raw.batch}#${raw.index}]`); continue; }
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
duplicates.forEach(p => console.log(`  - [batch${p.batch}#${p.index}] ${p.brand} - ${p.title}`));
console.log(`\nEklenecek YENİ ürün sayısı: ${toInsert.length}`);

if (!toInsert.length) {
  console.log('\nEklenecek ürün yok, çıkılıyor.');
  process.exit(0);
}

// 4) offices tablosunda marka adı eşleşmesi (best-effort, sadece favicon/kart görünümü için)
console.log('\noffices tablosunda marka eşleşmeleri kontrol ediliyor (best-effort)...');
const offices = d1Query(`SELECT id, name FROM offices WHERE deleted_at IS NULL`);
const officeByFold = new Map(offices.map(o => [foldTr(o.name), o.id]));

function downloadToTmp(url) {
  const ext = (url.split('?')[0].split('.').pop() || 'bin').slice(0, 8);
  const tmpFile = path.join(os.tmpdir(), `set2-dl-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
  try {
    execSync(`curl -sL -A ${JSON.stringify(UA)} --max-time 30 ${JSON.stringify(url)} -o ${JSON.stringify(tmpFile)}`, { stdio: 'pipe' });
    if (fs.existsSync(tmpFile) && fs.statSync(tmpFile).size > 0) return tmpFile;
  } catch {}
  return null;
}

// 5) Her ürün için: slug üret, görselleri + dosyaları R2'ye yükle (WRITE modunda), INSERT
const report = [];
for (const p of toInsert) {
  let base = slugify(`${p.title}-${p.brand}`) || slugify(p.title) || `urun-set2-${p.batch}-${p.index}`;
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

  const fileEntries = [];
  for (const f of (p.files || [])) {
    if (!f || !f.url) continue;
    let uploaded = null;
    if (WRITE) {
      const tmpFile = downloadToTmp(f.url);
      if (tmpFile) {
        const filename = f.filename || path.basename(new URL(f.url).pathname) || `dosya.${f.format || 'bin'}`;
        const key = `import/products/${slug}/files/${filename}`;
        try {
          execSync(`npx wrangler r2 object put ${BUCKET}/${key} --remote --file=${JSON.stringify(tmpFile)}`, { cwd: ROOT, stdio: 'pipe' });
          const size = fs.statSync(tmpFile).size;
          uploaded = { url: `/media/${key}`, filename, format: f.format || path.extname(filename).replace('.', ''), size };
        } catch (e) {
          console.log(`  UYARI: dosya yüklenemedi (${f.url}): ${e.message.slice(0, 120)}`);
        }
        try { fs.unlinkSync(tmpFile); } catch {}
      } else {
        console.log(`  UYARI: dosya indirilemedi: ${f.url}`);
      }
    }
    fileEntries.push(uploaded || { url: f.url, filename: f.filename || '', format: f.format || '', size: null });
  }

  const specsJson = JSON.stringify(p.specs || []);
  const imagesJson = JSON.stringify(imageUrls);
  const filesJson = JSON.stringify(fileEntries);

  if (WRITE) {
    // products.kind CHECK constraint is singular ('product'|'material') — manifest'teki 'products'/
    // 'materials' CATALOG_CATEGORY_KIND (submission-routing) sözleşmesiyle aynı ama DB sütunu farklı.
    const kindSingular = p.kind === 'materials' ? 'material' : 'product';
    const cols = ['slug', 'kind', 'title', 'brand_office_id', 'brand_name_raw', 'website', 'category',
      'description', 'images', 'specs', 'source_url', 'source', 'legacy_key', 'designer', 'year', 'files'];
    const vals = [
      `'${sqlEscape(slug)}'`,
      `'${sqlEscape(kindSingular)}'`,
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
      `'${sqlEscape(filesJson)}'`,
    ];
    d1Exec(`INSERT INTO products (${cols.join(',')}) VALUES (${vals.join(',')})`);
  }

  report.push({ slug, title: p.title, brand: p.brand, kind: p.kind, category: p.category, images: imageUrls.length, files: fileEntries.length, brandOfficeId });
  console.log(`${WRITE ? 'EKLENDİ' : '[dry-run] eklenecek'}: ${p.brand} - ${p.title} -> /urun/${slug} (${imageUrls.length} görsel, ${fileEntries.length} dosya${brandOfficeId ? ', brand_office_id=' + brandOfficeId : ''})`);
}

console.log(`\n${WRITE ? 'Tamamlandı' : 'Dry-run tamamlandı'}: ${report.length} ürün ${WRITE ? 'D1 + R2\'ye yazıldı' : '(henüz yazılmadı)'}.`);
fs.writeFileSync(path.join(SCRATCH, 'import-report.json'), JSON.stringify(report, null, 2));
