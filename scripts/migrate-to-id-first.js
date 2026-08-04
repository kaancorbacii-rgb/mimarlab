#!/usr/bin/env node
// Faz 2 — statik data.js/projeler-data.js/urunler-data.js/malzemeler-data.js kayıtlarını yeni
// ID-first canonical tablolara (bkz. migrations/0022_id_first_entities.sql) aktaran tek seferlik
// migration script'i. HİÇBİR ŞEYİ DOĞRUDAN VERİTABANINA YAZMAZ — yalnızca gözden geçirilebilir bir
// .sql çıktı dosyası üretir; operatör bunu inceleyip kendi isteğiyle
// `wrangler d1 execute mimarlab-db --local/--remote --file=...` ile çalıştırır.
//
// Kapsam (bkz. docs/architecture-roadmap.md Faz 2, kullanıcı isteği "daraltılmış kapsam"):
//   - architects[]/offices[] statik dizileri  -> architects/offices tabloları
//   - architects[].office === offices[].name  -> office_founders (bkz. ofis-detay.html#renderFoundersGrid,
//     statik office.founders alanı zaten kullanılmıyordu, canlı eşleştirme buydu)
//   - projeler-data.js projects[]             -> projects tablosu
//   - projects[].designer[] adları            -> project_designers (önce ofis, sonra mimar adıyla eşleştirilir)
//   - urunler-data.js/malzemeler-data.js      -> products tablosu (kind='product'/'material')
//   - products[].brand                        -> products.brand_office_id (eşleşirse) / brand_name_raw (fallback)
//   - *_submissions tabloları (onaylı üye gönderileri) bu turda İŞLENMEZ — claimed_profile_key
//     overlay'i ile statik+submission birleşimi Faz 1'de zaten API katmanında (src/routes/architect.js
//     vb.) çözülüyor; bu script yalnızca statik "taban" veriyi taşır. Submission overlay'inin
//     canonical tablolara aktarımı ayrı, düşük öncelikli bir sonraki adımdır (bkz. dosya sonu TODO).
//
// İSİM ÇAKIŞMASI (kullanıcı isteği): aynı `name` değerine sahip birden fazla architects[]/offices[]
// kaydı bulunursa (bkz. "Duplicate name key limitation" — bu proje architects/offices'i her yerde
// bare name ile anahtarlıyor), script BUNLARDAN HİÇBİRİNİ otomatik seçip taşımaz — tüm adayları
// migration_name_conflicts'e yazar, admin panelinden manuel çözüm gerektirir (bkz.
// src/routes/migrationConflicts.js). Aynı şekilde project_designers/office_founders/product_brand
// eşleştirmesi bir çakışma grubundaki bir isme denk gelirse (hangi aday kastedildiği belirsizse) o
// bağlantı da atlanır ve conflict olarak loglanır. Hiçbir eşleşme bulunamayan (ör. "Bilinmiyor" gibi
// placeholder) isimler ise ÇAKIŞMA DEĞİLDİR — bugünkü canlı sitede de bağlantısız kalıyorlar, bu
// yüzden sessizce atlanır (gürültülü/anlamsız conflict satırı üretmemek için).

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const { architects, offices } = require(path.join(ROOT, 'data.js'));
const { projects } = require(path.join(ROOT, 'projeler-data.js'));
const { products } = require(path.join(ROOT, 'urunler-data.js'));
const { materials } = require(path.join(ROOT, 'malzemeler-data.js'));

// save-widget.js / src/lib/slugify.js ile birebir aynı algoritma — bilerek üçüncü kez kopyalanıyor
// (bkz. src/lib/slugify.js başındaki not: sunucu/istemci arasında zaten bilerek kopyalanmış), bu
// script plain `node` ile çalıştığından ESM export'lu src/lib/slugify.js'i require edemiyor.
const TR_MAP = { ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', I: 'i', İ: 'i', ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u' };
function slugify(text) {
  return (text || '')
    .split('').map(ch => TR_MAP[ch] || ch).join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sqlStr(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}
function sqlJson(v) {
  if (v === null || v === undefined) return 'NULL';
  return sqlStr(JSON.stringify(v));
}
function sqlInt(v) {
  return (v === null || v === undefined || v === '') ? 'NULL' : Number(v);
}

// Aynı isim birden fazla slug'a düşerse (nadiren, ör. iki farklı ismin normalize sonucu aynı olması)
// -2/-3 son eki eklenir — bu ÇAKIŞMA DEĞİL, tamamen deterministik ve kayıpsız bir işlem.
function makeSlugAssigner() {
  const used = new Set();
  return function assign(name) {
    const base = slugify(name) || 'kayit';
    let slug = base, n = 2;
    while (used.has(slug)) { slug = `${base}-${n}`; n++; }
    used.add(slug);
    return slug;
  };
}

// name -> { rows: [...], conflict: bool } — çakışma grubundaki isimler için rows.length > 1 olur.
function groupByName(arr) {
  const map = new Map();
  arr.forEach((row, index) => {
    const key = row.name;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ ...row, _index: index });
  });
  return map;
}

const architectGroups = groupByName(architects);
const officeGroups = groupByName(offices);

const conflicts = []; // { entity_type, conflict_key, context, candidates: [...] }
const architectSlug = makeSlugAssigner();
const officeSlug = makeSlugAssigner();
const projectSlug = makeSlugAssigner(); // projects already have stable slugs; only used for collision safety

// name -> canonical row (yalnızca ÇAKIŞMASIZ isimler için dolu) — join tablolarında eşleştirme bunun üzerinden yapılır.
const architectByName = new Map();
const officeByName = new Map();

const architectRows = []; // { id, slug, name, ...raw }
const officeRows = [];

let nextArchitectId = 1;
let nextOfficeId = 1;

for (const [name, rows] of architectGroups) {
  if (rows.length > 1) {
    conflicts.push({
      entity_type: 'architect',
      conflict_key: name,
      context: null,
      candidates: rows.map(r => ({ office: r.office || null, dob: r.dob || null, school: r.school || null, role: r.role || null })),
    });
    continue;
  }
  const a = rows[0];
  const id = nextArchitectId++;
  const slug = architectSlug(name);
  const row = { id, slug, name, dob: a.dob || null, school: a.school || null, dept: a.dept || null, position: a.role || a.status || null, awards: a.awards || null, about: a.about || null, photo_url: a.photo || null, office_name_raw: a.office || null };
  architectRows.push(row);
  architectByName.set(name, row);
}

for (const [name, rows] of officeGroups) {
  if (rows.length > 1) {
    conflicts.push({
      entity_type: 'office',
      conflict_key: name,
      context: null,
      candidates: rows.map(r => ({ loc: r.loc || null, yil: r.yil || null, website: r.website || null })),
    });
    continue;
  }
  const o = rows[0];
  const id = nextOfficeId++;
  const slug = officeSlug(name);
  const row = { id, slug, name, loc: o.loc || null, cats: o.cats || null, yil: o.yil || null, website: o.website || null, about: o.about || null, logo_url: o.logo || null, awards: o.awards || null };
  officeRows.push(row);
  officeByName.set(name, row);
}

// office_founders — architects[].office serbest metni offices[].name'e eşleşirse bağla; eşleşme
// bir çakışma grubundaymışsa (belirsiz) conflict logla; hiç eşleşmezse (akademisyen/tarihi
// mimar/statüsü belirsiz vb.) sessizce atla — bu bugünkü canlı davranışla aynı.
const officeFounderRows = []; // { office_id, architect_id }
for (const arch of architectRows) {
  const officeName = arch.office_name_raw;
  if (!officeName) continue;
  const office = officeByName.get(officeName);
  if (office) {
    officeFounderRows.push({ office_id: office.id, architect_id: arch.id });
  } else if (officeGroups.has(officeName) && officeGroups.get(officeName).length > 1) {
    conflicts.push({
      entity_type: 'office_founder',
      conflict_key: officeName,
      context: `architect:${arch.name}`,
      candidates: officeGroups.get(officeName).map(r => ({ loc: r.loc || null, yil: r.yil || null })),
    });
  }
}

// projects + project_designers
const projectRows = [];
const projectDesignerRows = []; // { project_id, architect_id, office_id }
let nextProjectId = 1;
for (const p of projects) {
  const id = nextProjectId++;
  const slug = p.slug; // proje slug'ları zaten kararlı/benzersiz statik anahtar — yeniden üretilmiyor
  projectRows.push({
    id, slug, title: p.title,
    category: p.category || null, type: p.type || null, discipline: p.discipline || null,
    location: p.location || null, location_detail: p.locationDetail || null,
    project_date: p.date || null, date_bucket: p.dateBucket || null, period: p.period || null,
    description: p.description || null, images: p.images || null,
    photo_credit_text: (p.photoCredit && p.photoCredit.text) || null,
    photo_credit_url: (p.photoCredit && p.photoCredit.url) || null,
  });

  for (const designerName of (p.designer || [])) {
    const office = officeByName.get(designerName);
    if (office) { projectDesignerRows.push({ project_id: id, architect_id: null, office_id: office.id }); continue; }
    const arch = architectByName.get(designerName);
    if (arch) { projectDesignerRows.push({ project_id: id, architect_id: arch.id, office_id: null }); continue; }
    const officeDupe = officeGroups.has(designerName) && officeGroups.get(designerName).length > 1;
    const archDupe = architectGroups.has(designerName) && architectGroups.get(designerName).length > 1;
    if (officeDupe || archDupe) {
      conflicts.push({
        entity_type: 'project_designer',
        conflict_key: designerName,
        context: `project:${slug}`,
        candidates: officeDupe
          ? officeGroups.get(designerName).map(r => ({ type: 'office', loc: r.loc || null }))
          : architectGroups.get(designerName).map(r => ({ type: 'architect', office: r.office || null })),
      });
    }
    // Eşleşme hiç yoksa (ör. "Bilinmiyor") sessizce atlanır — bkz. dosya başı not.
  }
}

// products + materials -> products tablosu (kind ile ayrılır)
const productRows = [];
let nextProductId = 1;
function pushProduct(item, kind) {
  const id = nextProductId++;
  const brandOffice = item.brand ? officeByName.get(item.brand) : null;
  const brandDupe = item.brand && officeGroups.has(item.brand) && officeGroups.get(item.brand).length > 1;
  if (brandDupe) {
    conflicts.push({
      entity_type: 'product_brand',
      conflict_key: item.brand,
      context: `${kind}:${item.brand}|||${item.title}`,
      candidates: officeGroups.get(item.brand).map(r => ({ loc: r.loc || null })),
    });
  }
  productRows.push({
    id, kind, title: item.title,
    brand_office_id: brandOffice ? brandOffice.id : null,
    brand_name_raw: item.brand || null,
    website: item.website || null, category: item.category || null,
    images: item.images || (item.image ? [item.image] : null),
    specs: item.specs || null,
    legacy_key: `${item.brand || ''}|||${item.title}`,
  });
}
products.forEach(p => pushProduct(p, 'product'));
materials.forEach(m => pushProduct(m, 'material'));

// ============================================================
// SQL çıktısı
// ============================================================
const out = [];
out.push('-- Faz 2 ID-first seed — scripts/migrate-to-id-first.js tarafından üretildi, ' + new Date().toISOString());
out.push('-- Elle çalıştırılmadan önce gözden geçirin. Çakışma raporu için stdout özetine bakın.');
out.push('BEGIN TRANSACTION;');

for (const a of architectRows) {
  out.push(`INSERT INTO architects (id, slug, name, dob, school, dept, position, awards, about, photo_url, source, legacy_key) VALUES (${a.id}, ${sqlStr(a.slug)}, ${sqlStr(a.name)}, ${sqlStr(a.dob)}, ${sqlStr(a.school)}, ${sqlStr(a.dept)}, ${sqlStr(a.position)}, ${sqlJson(a.awards)}, ${sqlStr(a.about)}, ${sqlStr(a.photo_url)}, 'legacy_static', ${sqlStr(a.name)});`);
}
for (const o of officeRows) {
  out.push(`INSERT INTO offices (id, slug, name, loc, cats, yil, website, about, logo_url, awards, source, legacy_key) VALUES (${o.id}, ${sqlStr(o.slug)}, ${sqlStr(o.name)}, ${sqlStr(o.loc)}, ${sqlJson(o.cats)}, ${sqlStr(o.yil)}, ${sqlStr(o.website)}, ${sqlStr(o.about)}, ${sqlStr(o.logo_url)}, ${sqlJson(o.awards)}, 'legacy_static', ${sqlStr(o.name)});`);
}
// architects.office_id, offices tablosu dolduktan SONRA ayrı bir UPDATE geçişiyle set edilir (INSERT
// sırasında offices henüz tam dolmamış olabilir — id'ler her iki dizide de bağımsız sayaçlarla verildi).
for (const arch of architectRows) {
  const office = arch.office_name_raw ? officeByName.get(arch.office_name_raw) : null;
  if (office) out.push(`UPDATE architects SET office_id = ${office.id}, role_at_office = ${sqlStr(architectGroups.get(arch.name)[0].role || null)} WHERE id = ${arch.id};`);
}
for (const of of officeFounderRows) {
  out.push(`INSERT INTO office_founders (office_id, architect_id) VALUES (${of.office_id}, ${of.architect_id});`);
}
for (const p of projectRows) {
  out.push(`INSERT INTO projects (id, slug, title, category, type, discipline, location, location_detail, project_date, date_bucket, period, description, images, photo_credit_text, photo_credit_url, source, legacy_key) VALUES (${p.id}, ${sqlStr(p.slug)}, ${sqlStr(p.title)}, ${sqlJson(p.category)}, ${sqlJson(p.type)}, ${sqlJson(p.discipline)}, ${sqlStr(p.location)}, ${sqlStr(p.location_detail)}, ${sqlStr(p.project_date)}, ${sqlStr(p.date_bucket)}, ${sqlJson(p.period)}, ${sqlStr(p.description)}, ${sqlJson(p.images)}, ${sqlStr(p.photo_credit_text)}, ${sqlStr(p.photo_credit_url)}, 'legacy_static', ${sqlStr(p.slug)});`);
}
for (const pd of projectDesignerRows) {
  out.push(`INSERT INTO project_designers (project_id, architect_id, office_id) VALUES (${pd.project_id}, ${sqlInt(pd.architect_id)}, ${sqlInt(pd.office_id)});`);
}
for (const pr of productRows) {
  out.push(`INSERT INTO products (id, slug, kind, title, brand_office_id, brand_name_raw, website, category, images, specs, source, legacy_key) VALUES (${pr.id}, ${sqlStr(slugify(pr.title + '-' + (pr.brand_name_raw || '')) + '-' + pr.id)}, ${sqlStr(pr.kind)}, ${sqlStr(pr.title)}, ${sqlInt(pr.brand_office_id)}, ${sqlStr(pr.brand_name_raw)}, ${sqlStr(pr.website)}, ${sqlStr(pr.category)}, ${sqlJson(pr.images)}, ${sqlJson(pr.specs)}, 'legacy_static', ${sqlStr(pr.legacy_key)});`);
}
for (const c of conflicts) {
  out.push(`INSERT INTO migration_name_conflicts (entity_type, conflict_key, context, candidates, status) VALUES (${sqlStr(c.entity_type)}, ${sqlStr(c.conflict_key)}, ${sqlStr(c.context)}, ${sqlJson(c.candidates)}, 'pending');`);
}
out.push('COMMIT;');

const outDir = path.join(__dirname, 'output');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'id-first-seed.sql');
fs.writeFileSync(outFile, out.join('\n') + '\n', 'utf8');

// ============================================================
// Özet (stdout) — admin panelinden önce hızlı bir gözden geçirme için
// ============================================================
console.log(`Üretilen dosya: ${path.relative(ROOT, outFile)}`);
console.log(`  architects: ${architectRows.length} taşınacak, ${conflicts.filter(c => c.entity_type === 'architect').length} çakışma grubu (taşınmadı)`);
console.log(`  offices:    ${officeRows.length} taşınacak, ${conflicts.filter(c => c.entity_type === 'office').length} çakışma grubu (taşınmadı)`);
console.log(`  office_founders: ${officeFounderRows.length} bağlantı`);
console.log(`  projects: ${projectRows.length}, project_designers: ${projectDesignerRows.length} bağlantı`);
console.log(`  products (product+material): ${productRows.length}`);
console.log(`  migration_name_conflicts: ${conflicts.length} toplam satır`);
if (conflicts.length) {
  console.log('\nÇakışma özeti:');
  for (const c of conflicts) {
    console.log(`  [${c.entity_type}] "${c.conflict_key}"${c.context ? ` (${c.context})` : ''} — ${c.candidates.length} aday`);
  }
}
console.log('\nBu dosya HENÜZ hiçbir veritabanına uygulanmadı. İncele, sonra örn.:');
console.log('  npx wrangler d1 execute mimarlab-db --local --persist-to /Users/kaancorbaci/.mimarlab-dev-state --file=scripts/output/id-first-seed.sql');

// TODO (sonraki adım, bu turun kapsamı dışında): architect_submissions/office_submissions/
// project_submissions/product_submissions/material_submissions'taki status='approved' satırları
// - claimed_profile_key/claimed_slug doluysa yukarıdaki canonical satır üzerinde UPDATE olarak,
// - boşsa source='submission' yeni bir canonical satır olarak
// bu script'e ikinci bir geçiş halinde eklenmeli (D1'den okumak gerektiğinden bu script'in bugünkü
// "yalnızca statik dosyaları oku" modelinden farklı, `wrangler d1 execute --json` ile veri çekmeyi
// gerektirir).
