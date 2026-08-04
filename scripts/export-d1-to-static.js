#!/usr/bin/env node
// Faz 3 madde 4 — data.js/projeler-data.js/urunler-data.js/malzemeler-data.js'i D1'den ÜRETİLEN bir
// build-time export haline getirir (bkz. docs/architecture-roadmap.md Faz3.4, kullanıcıyla netleşen
// "Seçenek A": statik dosyalar mimar.html/firma.html/proje.html/urun.html tarafından tarayıcıda
// hâlâ AYNI şekilde <script> ile yüklenir — yalnızca bu dosyaların İÇERİĞİ artık elle değil, D1
// canonical tablolarından (architects/offices/projects/products, bkz. migrations/
// 0022_id_first_entities.sql) türetilir.
//
// BU SCRIPT HİÇBİR GERÇEK DOSYAYI DEĞİŞTİRMEZ — çıktıyı scripts/output/export-preview/ altına
// yazar. Gerçek data.js vb. dosyaların üzerine yazmak (bu script'in ürettiği içeriğin bugünküyle
// birebir örtüştüğünü doğrulamak dahil) kullanıcının ayrı, açık onayıyla ileride yapılacak bir
// adımdır (bkz. docs/architecture-roadmap.md — bu turun kapsamı yalnızca "yazıp yerelde dry-run
// test etmek").
//
// KAPSAM/BİLİNEN SINIRLAR:
//   - data.js'teki `jobListings` dizisinin (tr.indeed.com'dan elle toplanmış ilanlar) canonical bir
//     karşılığı YOK — bu script mevcut data.js'i require edip jobListings'i OLDUĞU GİBİ yeniden
//     gömer, D1'den türetmez.
//   - `awards`/`cats` gibi JSON kolonlar migrate/merge script'lerinin yazdığı BİÇİMDE geri
//     JSON.parse edilir (bkz. src/lib/canonicalRead.js#JSON_FIELDS ile AYNI liste).
//   - Alan sırası/whitespace bugünkü elle-düzenlenmiş dosyalarla birebir aynı OLMAYABİLİR — hedef,
//     işlevsel eşdeğerlik (aynı JS objelerini üretmek), byte-birebir eşleşme değil.

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PERSIST_TO = '/Users/kaancorbaci/.mimarlab-dev-state';
const DB_NAME = 'mimarlab-db';
const OUT_DIR = path.join(ROOT, 'scripts', 'output', 'export-preview');

function d1Query(sql) {
  // Çok satırlı SQL string'lerindeki gerçek satır sonları, kabuğa geçerken JSON.stringify'ın
  // ürettiği "\n" kaçış dizisini kelimenin tam anlamıyla (ters eğik çizgi + n) SQLite'a sızdırıp
  // "unrecognized token" hatası verebiliyor — burada tek satıra düzleştirilir (bkz. gerçek bulgu).
  const flat = sql.replace(/\s+/g, ' ').trim();
  const cmd = `npx wrangler d1 execute ${DB_NAME} --local --persist-to ${PERSIST_TO} --json --command ${JSON.stringify(flat)}`;
  const out = execSync(cmd, { cwd: ROOT, maxBuffer: 1024 * 1024 * 128 });
  return JSON.parse(out.toString('utf8'))[0].results;
}

function parseJsonCol(v) { if (v == null) return null; try { return JSON.parse(v); } catch { return null; } }

// Bugünkü elle-yazılmış data.js/projeler-data.js ile AYNI stil: JSON.stringify çift tırnak üretir,
// falsy/null alanlar tamamen atlanır (obje literal'inde hiç görünmez) — bkz. yukarıdaki dosyalarda
// `if(base){...}` gibi opsiyonel alanların hiç yazılmadığı satırlar.
function jsLiteral(obj) {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    parts.push(`${k}:${JSON.stringify(v)}`);
  }
  return `{${parts.join(', ')}}`;
}

function writeGuarded(fileName, header, body, exportsExpr) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const content = `${header}\n${body}\n\n// Tarayıcıda \`module\` global'i tanımsız olduğu için bu blok yalnızca Worker'ın esbuild bundle'ında\n// (nodejs_compat) çalışır.\nif (typeof module !== 'undefined') { module.exports = ${exportsExpr}; }\n`;
  fs.writeFileSync(path.join(OUT_DIR, fileName), content, 'utf8');
  return content;
}

console.log('Canonical tablolar okunuyor (yerel dev D1)...');
const architects = d1Query(`SELECT * FROM architects WHERE deleted_at IS NULL ORDER BY id`);
const offices = d1Query(`SELECT * FROM offices WHERE deleted_at IS NULL ORDER BY id`);
const projects = d1Query(`SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY id`);
const products = d1Query(`SELECT * FROM products WHERE deleted_at IS NULL AND kind = 'product' ORDER BY id`);
const materials = d1Query(`SELECT * FROM products WHERE deleted_at IS NULL AND kind = 'material' ORDER BY id`);
const officeById = new Map(offices.map(o => [o.id, o]));

// --- data.js (offices + architects + değişmeyen jobListings) ---
const { jobListings } = require(path.join(ROOT, 'data.js'));
const officesOut = offices.map(o => jsLiteral({
  name: o.name, loc: o.loc, cats: parseJsonCol(o.cats), yil: o.yil, website: o.website,
  about: o.about, logo: o.logo_url, awards: parseJsonCol(o.awards),
})).join(',\n  ');
const architectsOut = architects.map(a => jsLiteral({
  name: a.name, role: a.position, office: a.office_id ? (officeById.get(a.office_id) || {}).name : null,
  photo: a.photo_url, dob: a.dob, school: a.school, dept: a.dept,
  profession: a.profession, awards: parseJsonCol(a.awards), about: a.about,
})).join(',\n  ');
writeGuarded('data.js',
  '// D1 canonical architects/offices tablolarından ÜRETİLDİ (bkz. scripts/export-d1-to-static.js) — elle düzenlemeyin.',
  `const offices = [\n  ${officesOut}\n];\n\nconst architects = [\n  ${architectsOut}\n];\n\nconst jobListings = ${JSON.stringify(jobListings, null, 2)};`,
  '{ offices, architects, jobListings }'
);

// --- projeler-data.js ---
const allDesignerLinks = d1Query(
  `SELECT pd.project_id, COALESCE(ar.name, ofc.name) AS name FROM project_designers pd LEFT JOIN architects ar ON ar.id = pd.architect_id AND ar.deleted_at IS NULL LEFT JOIN offices ofc ON ofc.id = pd.office_id AND ofc.deleted_at IS NULL`
);
const designerRowsByProject = new Map();
for (const row of allDesignerLinks) {
  if (!row.name) continue;
  if (!designerRowsByProject.has(row.project_id)) designerRowsByProject.set(row.project_id, []);
  designerRowsByProject.get(row.project_id).push(row.name);
}

const projectsOut = projects.map(p => jsLiteral({
  slug: p.slug, title: p.title, category: parseJsonCol(p.category), type: parseJsonCol(p.type),
  discipline: parseJsonCol(p.discipline), location: p.location, locationDetail: p.location_detail,
  date: p.project_date, dateBucket: p.date_bucket, period: parseJsonCol(p.period),
  designer: designerRowsByProject.get(p.id) || [],
  photoCredit: (p.photo_credit_text || p.photo_credit_url) ? { text: p.photo_credit_text || '', url: p.photo_credit_url || '' } : null,
  description: p.description, mostVisited: null, recommendations: [], images: parseJsonCol(p.images),
})).join(',\n  ');
writeGuarded('projeler-data.js',
  '// D1 canonical projects tablosundan ÜRETİLDİ (bkz. scripts/export-d1-to-static.js) — elle düzenlemeyin.',
  `const projects = [\n  ${projectsOut}\n];\n\nfunction projectBySlug(slug){\n  return projects.find(p => p.slug === slug);\n}`,
  '{ projects, projectBySlug }'
);

// --- urunler-data.js / malzemeler-data.js ---
function productLiteral(row) {
  return jsLiteral({
    title: row.title, category: row.category, brand: row.brand_name_raw, website: row.website,
    images: parseJsonCol(row.images), specs: parseJsonCol(row.specs),
  });
}
writeGuarded('urunler-data.js',
  '// D1 canonical products tablosundan (kind=\'product\') ÜRETİLDİ (bkz. scripts/export-d1-to-static.js) — elle düzenlemeyin.',
  `const products = [\n  ${products.map(productLiteral).join(',\n  ')}\n];`,
  '{ products }'
);
writeGuarded('malzemeler-data.js',
  '// D1 canonical products tablosundan (kind=\'material\') ÜRETİLDİ (bkz. scripts/export-d1-to-static.js) — elle düzenlemeyin.',
  `const materials = [\n  ${materials.map(productLiteral).join(',\n  ')}\n];`,
  '{ materials }'
);

console.log(`\nÖnizleme dosyaları yazıldı: ${path.relative(ROOT, OUT_DIR)}/`);
console.log(`  data.js: ${architects.length} mimar, ${offices.length} firma (+ ${jobListings.length} değişmeyen iş ilanı)`);
console.log(`  projeler-data.js: ${projects.length} proje`);
console.log(`  urunler-data.js: ${products.length} ürün`);
console.log(`  malzemeler-data.js: ${materials.length} malzeme`);
console.log('\nBU DOSYALAR GERÇEK data.js vb. ÜZERİNE YAZILMADI — yalnızca önizleme. Karşılaştırmak için:');
console.log(`  diff data.js ${path.relative(ROOT, path.join(OUT_DIR, 'data.js'))}`);
