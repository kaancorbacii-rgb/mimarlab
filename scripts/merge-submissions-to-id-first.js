#!/usr/bin/env node
// Faz 3 — İkinci geçiş: onaylı *_submissions satırlarını ID-first canonical tablolara
// (architects/offices/projects/products) birleştirir. scripts/migrate-to-id-first.js'in (Faz 2)
// dosya sonundaki TODO'sunun uygulanmış hâli — bkz. docs/architecture-roadmap.md Faz3 madde 1.
//
// HİÇBİR ŞEYİ DOĞRUDAN VERİTABANINA YAZMAZ — yalnızca scripts/output/submissions-merge.sql
// üretir; operatör inceleyip `wrangler d1 execute --local/--remote --file=...` ile uygular.
// Bu script, migrate-to-id-first.js'in aksine D1'i OKUR (yalnızca SELECT, `wrangler d1 execute
// --json --command` ile) — hem onaylı submission satırlarını hem de mevcut canonical tabloları
// (Faz 2'nin seed'i zaten uygulanmış olmalı) çekip aradaki farkı SQL olarak üretir.
//
// Kural (bkz. docs/architecture-roadmap.md Faz3 §3, mevcut src/routes/architect.js#buildArchitectPayload,
// office.js#buildOfficePayload, project.js#handleProjectDetailRoute'taki AYNI overlay mantığı):
//   - claimed_profile_key/claimed_slug DOLU  -> canonical satır legacy_key (ya da bulunamazsa name/slug)
//     üzerinden bulunur, overlay alanları o satıra UPDATE edilir (request-time overlay artık merge-time'da
//     BİR KEZ uygulanıp kalıcı hale gelir).
//   - claimed_profile_key/claimed_slug BOŞ    -> yeni canonical satır INSERT edilir (source='submission').
//   - products/materials'ta claim sistemi YOK (bkz. schema.sql yorumu) — onaylı HER ürün/malzeme
//     gönderisi yeni bir canonical products satırıdır.
//   - Join alanları (designer[]/office/architect) migrate-to-id-first.js ile AYNI "tek adaya kesin
//     eşleşirse bağla, belirsizse migration_name_conflicts'e logla, hiç eşleşme yoksa sessizce atla"
//     kuralıyla çözülür — canonical architects/offices isim BAŞINA TEK satır içerdiğinden (Faz 2
//     çakışmaları zaten filtrelemişti) ambiguity artık yalnızca BU turda eklenen yeni, aynı isimli
//     member kayıtları arasında (çok nadir) oluşabilir.

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PERSIST_TO = '/Users/kaancorbaci/.mimarlab-dev-state';
const DB_NAME = 'mimarlab-db';
// --remote geçilirse gerçek üretim D1'ini SORGULAR (yalnızca SELECT — hiçbir yazma yapılmaz burada,
// bkz. dosya başı yorum); varsayılan (bayraksız) hâlâ yerel dev D1'i hedefler, kazara prod'u
// sorgulamayı önlemek için.
const REMOTE = process.argv.includes('--remote');
const TARGET_FLAG = REMOTE ? '--remote' : `--local --persist-to ${PERSIST_TO}`;

function d1Query(sql) {
  const flat = sql.replace(/\s+/g, ' ').trim();
  const cmd = `npx wrangler d1 execute ${DB_NAME} ${TARGET_FLAG} --json --command ${JSON.stringify(flat)}`;
  const out = execSync(cmd, { cwd: ROOT, maxBuffer: 1024 * 1024 * 128 });
  const parsed = JSON.parse(out.toString('utf8'));
  return parsed[0].results;
}

// bkz. scripts/migrate-to-id-first.js'teki AYNI yorum — bu script de plain `node` ile çalıştığından
// ESM src/lib/slugify.js'i require edemiyor, bilerek dördüncü kez kopyalanıyor.
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
function makeSlugAssigner(seedSlugs) {
  const used = new Set(seedSlugs || []);
  return function assign(name) {
    const base = slugify(name) || 'kayit';
    let slug = base, n = 2;
    while (used.has(slug)) { slug = `${base}-${n}`; n++; }
    used.add(slug);
    return slug;
  };
}

// bkz. src/lib/submissionTypes.js#SUBMISSION_TYPES'taki AYNI arrayFields listeleri — bu script
// D1'den ham satır okuduğundan (ESM import yerine) burada kopyalanıyor.
const ARRAY_FIELDS = {
  architect_submissions: ['awards'],
  office_submissions: ['awards', 'founders'],
  project_submissions: ['category', 'type', 'discipline', 'period', 'designer', 'images', 'brands'],
  product_submissions: ['images', 'specs'],
  material_submissions: ['images', 'specs'],
};
function parseRow(table, row) {
  const out = { ...row };
  for (const f of ARRAY_FIELDS[table]) {
    try { out[f] = row[f] ? JSON.parse(row[f]) : []; } catch { out[f] = []; }
  }
  return out;
}

console.log(`Onaylı gönderiler okunuyor (${REMOTE ? 'PROD' : 'yerel dev D1'})...`);
const archSubs = d1Query(`SELECT * FROM architect_submissions WHERE status = 'approved'`).map(r => parseRow('architect_submissions', r));
const officeSubs = d1Query(`SELECT * FROM office_submissions WHERE status = 'approved'`).map(r => parseRow('office_submissions', r));
const projectSubs = d1Query(`SELECT * FROM project_submissions WHERE status = 'approved'`).map(r => parseRow('project_submissions', r));
const productSubs = d1Query(`SELECT * FROM product_submissions WHERE status = 'approved'`).map(r => parseRow('product_submissions', r));
const materialSubs = d1Query(`SELECT * FROM material_submissions WHERE status = 'approved'`).map(r => parseRow('material_submissions', r));

console.log('Canonical tablolar okunuyor...');
const canonArchitects = d1Query(`SELECT id, slug, name, legacy_key, office_id FROM architects WHERE deleted_at IS NULL`);
const canonOffices = d1Query(`SELECT id, slug, name, legacy_key FROM offices WHERE deleted_at IS NULL`);
const canonProjects = d1Query(`SELECT id, slug, legacy_key FROM projects WHERE deleted_at IS NULL`);
const canonProducts = d1Query(`SELECT id, slug FROM products WHERE deleted_at IS NULL`);
const existingFounderPairs = new Set(
  d1Query(`SELECT office_id, architect_id FROM office_founders`).map(r => `${r.office_id}:${r.architect_id}`)
);

// name -> row[] (çakışma/ambiguity kontrolü için — bkz. dosya başı yorum: canonical veri Faz 2'de
// zaten çakışmasız tekilleştirildi, bu yüzden burada ancak BU turda eklenen yeni aynı-isimli member
// kayıtları arasında >1 oluşabilir).
const archGroupsByName = new Map();
canonArchitects.forEach(a => { if (!archGroupsByName.has(a.name)) archGroupsByName.set(a.name, []); archGroupsByName.get(a.name).push(a); });
const officeGroupsByName = new Map();
canonOffices.forEach(o => { if (!officeGroupsByName.has(o.name)) officeGroupsByName.set(o.name, []); officeGroupsByName.get(o.name).push(o); });

const archByLegacyKey = new Map(canonArchitects.filter(a => a.legacy_key).map(a => [a.legacy_key, a]));
const officeByLegacyKey = new Map(canonOffices.filter(o => o.legacy_key).map(o => [o.legacy_key, o]));
const projectByLegacyKey = new Map(canonProjects.filter(p => p.legacy_key).map(p => [p.legacy_key, p]));
const projectBySlug = new Map(canonProjects.map(p => [p.slug, p]));

function uniqueMatch(groupsMap, name) {
  if (!name) return { row: null, ambiguous: false };
  const rows = groupsMap.get(name);
  if (!rows || rows.length === 0) return { row: null, ambiguous: false };
  if (rows.length > 1) return { row: null, ambiguous: true, candidates: rows };
  return { row: rows[0], ambiguous: false };
}

let nextArchitectId = Math.max(0, ...canonArchitects.map(a => a.id)) + 1;
let nextOfficeId = Math.max(0, ...canonOffices.map(o => o.id)) + 1;
let nextProjectId = Math.max(0, ...canonProjects.map(p => p.id)) + 1;
let nextProductId = Math.max(0, ...canonProducts.map(p => p.id)) + 1;

const architectSlugAssigner = makeSlugAssigner(canonArchitects.map(a => a.slug));
const officeSlugAssigner = makeSlugAssigner(canonOffices.map(o => o.slug));

const out = [];
const conflicts = [];
const summary = { officeUpdated: 0, officeInserted: 0, archUpdated: 0, archInserted: 0, projectUpdated: 0, projectInserted: 0, productInserted: 0, founderLinks: 0, designerLinks: 0, productArchitectLinks: 0 };

out.push('-- Faz 3 submissions-merge — scripts/merge-submissions-to-id-first.js tarafından üretildi, ' + new Date().toISOString());
out.push('-- Elle çalıştırılmadan önce gözden geçirin. Çakışma raporu için stdout özetine bakın.');
// bkz. dosya sonundaki yorum — D1 --remote BEGIN TRANSACTION/COMMIT'i kabul etmediğinden burada
// bilerek YOK.

// ============================================================
// 1) Offices ÖNCE işlenir — architects.office_id çözümlemesi buna bağlı.
// ============================================================
for (const row of officeSubs) {
  const claimedKey = row.claimed_profile_key;
  if (claimedKey) {
    const target = officeByLegacyKey.get(claimedKey) || (officeGroupsByName.get(claimedKey) || [])[0];
    if (!target) { console.warn(`[office] claimed_profile_key="${claimedKey}" (submission id=${row.id}) canonical eşleşmedi, atlandı.`); continue; }
    const sets = [];
    if (row.name) sets.push(`name = ${sqlStr(row.name)}`);
    if (row.loc) sets.push(`loc = ${sqlStr(row.loc)}`);
    if (row.cats) sets.push(`cats = ${sqlJson(row.cats)}`);
    if (row.yil) sets.push(`yil = ${sqlStr(row.yil)}`);
    if (row.website) sets.push(`website = ${sqlStr(row.website)}`);
    if (row.about !== undefined && row.about !== null && row.about !== '') sets.push(`about = ${sqlStr(row.about)}`);
    if (row.logo_url) sets.push(`logo_url = ${sqlStr(row.logo_url)}`);
    sets.push(`updated_at = datetime('now')`);
    out.push(`UPDATE offices SET ${sets.join(', ')} WHERE id = ${target.id};`);
    if (row.name && row.name !== target.name) { target.name = row.name; }
    summary.officeUpdated++;
  } else {
    const id = nextOfficeId++;
    const slug = officeSlugAssigner(row.name);
    out.push(`INSERT INTO offices (id, slug, name, loc, cats, yil, website, about, logo_url, awards, source, claimed_by_user_id) VALUES (${id}, ${sqlStr(slug)}, ${sqlStr(row.name)}, ${sqlStr(row.loc)}, ${sqlJson(row.cats)}, ${sqlStr(row.yil)}, ${sqlStr(row.website)}, ${sqlStr(row.about)}, ${sqlStr(row.logo_url)}, ${sqlJson(row.awards)}, 'submission', ${sqlStr(row.owner_user_id)});`);
    const newRow = { id, slug, name: row.name, legacy_key: null };
    if (!officeGroupsByName.has(row.name)) officeGroupsByName.set(row.name, []);
    officeGroupsByName.get(row.name).push(newRow);
    summary.officeInserted++;
  }
}

// ============================================================
// 2) Architects
// ============================================================
// architect_id -> final office_id (bu turda dokunulan HER architect için) — office_founders
// senkronu için kullanılır (madde 3).
const touchedArchitectOffice = new Map();

for (const row of archSubs) {
  const claimedKey = row.claimed_profile_key;
  const officeMatch = row.office ? uniqueMatch(officeGroupsByName, row.office) : { row: null, ambiguous: false };
  if (officeMatch.ambiguous) {
    conflicts.push({ entity_type: 'office_founder', conflict_key: row.office, context: `architect_submission:${row.id}`, candidates: officeMatch.candidates.map(r => ({ id: r.id, name: r.name })) });
  }
  const finalOfficeId = officeMatch.row ? officeMatch.row.id : null;

  if (claimedKey) {
    const target = archByLegacyKey.get(claimedKey) || (archGroupsByName.get(claimedKey) || [])[0];
    if (!target) { console.warn(`[architect] claimed_profile_key="${claimedKey}" (submission id=${row.id}) canonical eşleşmedi, atlandı.`); continue; }
    const sets = [];
    if (row.name) sets.push(`name = ${sqlStr(row.name)}`);
    if (row.dob) sets.push(`dob = ${sqlStr(row.dob)}`);
    if (row.school) sets.push(`school = ${sqlStr(row.school)}`);
    if (row.dept) sets.push(`dept = ${sqlStr(row.dept)}`);
    if (row.profession) sets.push(`profession = ${sqlStr(row.profession)}`);
    if (row.awards && row.awards.length) sets.push(`awards = ${sqlJson(row.awards)}`);
    if (row.photo_url) sets.push(`photo_url = ${sqlStr(row.photo_url)}`);
    if (row.about !== undefined && row.about !== null && row.about !== '') sets.push(`about = ${sqlStr(row.about)}`);
    if (row.position) sets.push(`position = ${sqlStr(row.position)}`);
    // office alanı HER ZAMAN uygulanır (boşsa da) — bkz. architect.js#buildArchitectPayload yorumu:
    // "admin bir bağlantıyı kasıtlı olarak kaldırabilsin diye truthy kontrolü YOK".
    sets.push(`office_id = ${finalOfficeId === null ? 'NULL' : finalOfficeId}`);
    sets.push(`updated_at = datetime('now')`);
    out.push(`UPDATE architects SET ${sets.join(', ')} WHERE id = ${target.id};`);
    touchedArchitectOffice.set(target.id, finalOfficeId);
    summary.archUpdated++;
  } else {
    const id = nextArchitectId++;
    const slug = architectSlugAssigner(row.name);
    out.push(`INSERT INTO architects (id, slug, name, dob, school, dept, profession, position, awards, about, photo_url, office_id, source, claimed_by_user_id) VALUES (${id}, ${sqlStr(slug)}, ${sqlStr(row.name)}, ${sqlStr(row.dob)}, ${sqlStr(row.school)}, ${sqlStr(row.dept)}, ${sqlStr(row.profession)}, ${sqlStr(row.position)}, ${sqlJson(row.awards)}, ${sqlStr(row.about)}, ${sqlStr(row.photo_url)}, ${finalOfficeId === null ? 'NULL' : finalOfficeId}, 'submission', ${sqlStr(row.owner_user_id)});`);
    const newRow = { id, slug, name: row.name, legacy_key: null, office_id: finalOfficeId };
    if (!archGroupsByName.has(row.name)) archGroupsByName.set(row.name, []);
    archGroupsByName.get(row.name).push(newRow);
    touchedArchitectOffice.set(id, finalOfficeId);
    summary.archInserted++;
  }
}

// ============================================================
// 3) office_founders senkronu — yalnızca bu turda dokunulan (yeni/claim-güncellenmiş) architect'ler
//    için: eski (farklı) ofisteki üyelik satırı silinir, yeni ofise (varsa) idempotent eklenir
//    (bkz. ofis-detay.html#renderFoundersGrid'in canlı "architects[].office === offices[].name"
//    eşleştirmesinin join-tablo karşılığı).
// ============================================================
for (const [architectId, officeId] of touchedArchitectOffice) {
  if (officeId === null) {
    out.push(`DELETE FROM office_founders WHERE architect_id = ${architectId};`);
  } else {
    out.push(`DELETE FROM office_founders WHERE architect_id = ${architectId} AND office_id != ${officeId};`);
    const pairKey = `${officeId}:${architectId}`;
    if (!existingFounderPairs.has(pairKey)) {
      out.push(`INSERT OR IGNORE INTO office_founders (office_id, architect_id) VALUES (${officeId}, ${architectId});`);
      existingFounderPairs.add(pairKey);
      summary.founderLinks++;
    }
  }
}

// ============================================================
// 4) Projects
// ============================================================
function resolveDesigner(name, projectSlugForContext) {
  const officeMatch = uniqueMatch(officeGroupsByName, name);
  if (officeMatch.row) return { office_id: officeMatch.row.id, architect_id: null };
  if (officeMatch.ambiguous) {
    conflicts.push({ entity_type: 'project_designer', conflict_key: name, context: `project:${projectSlugForContext}`, candidates: officeMatch.candidates.map(r => ({ type: 'office', id: r.id, name: r.name })) });
    return null;
  }
  const archMatch = uniqueMatch(archGroupsByName, name);
  if (archMatch.row) return { office_id: null, architect_id: archMatch.row.id };
  if (archMatch.ambiguous) {
    conflicts.push({ entity_type: 'project_designer', conflict_key: name, context: `project:${projectSlugForContext}`, candidates: archMatch.candidates.map(r => ({ type: 'architect', id: r.id, name: r.name })) });
    return null;
  }
  return null; // hiç eşleşme yok — sessizce atla (bkz. migrate-to-id-first.js'teki AYNI davranış)
}

for (const row of projectSubs) {
  const claimedSlug = row.claimed_slug;
  if (claimedSlug) {
    const target = projectByLegacyKey.get(claimedSlug) || projectBySlug.get(claimedSlug);
    if (!target) { console.warn(`[project] claimed_slug="${claimedSlug}" (submission id=${row.id}) canonical eşleşmedi, atlandı.`); continue; }
    // bkz. src/routes/project.js#handleProjectDetailRoute'taki overlay ile BİREBİR aynı kural seti.
    const sets = [
      `title = ${sqlStr(row.title)}`,
      `category = ${sqlJson(row.category)}`,
      `type = ${sqlJson(row.type)}`,
      `discipline = ${sqlJson(row.discipline)}`,
      `location = ${sqlStr(row.location)}`,
      `location_detail = ${sqlStr(row.locationDetail)}`,
      `project_date = ${sqlStr(row.date)}`,
      `date_bucket = ${sqlStr(row.dateBucket)}`,
      `period = ${sqlJson(row.period)}`,
      `photo_credit_text = ${sqlStr(row.photoCreditText || '')}`,
      `photo_credit_url = ${sqlStr(row.photoCreditUrl || '')}`,
      `description = ${sqlStr(row.description)}`,
      `updated_at = datetime('now')`,
    ];
    if (row.images && row.images.length) sets.push(`images = ${sqlJson(row.images)}`);
    out.push(`UPDATE projects SET ${sets.join(', ')} WHERE id = ${target.id};`);
    summary.projectUpdated++;
    if (row.designer && row.designer.length) {
      out.push(`DELETE FROM project_designers WHERE project_id = ${target.id};`);
      for (const name of row.designer) {
        const resolved = resolveDesigner(name, target.slug);
        if (resolved) { out.push(`INSERT INTO project_designers (project_id, architect_id, office_id) VALUES (${target.id}, ${sqlInt(resolved.architect_id)}, ${sqlInt(resolved.office_id)});`); summary.designerLinks++; }
      }
    }
    // brands: canonical projects tablosunda karşılık gelen bir kolon yok (project_products join
    // tablosunun doldurulması Faz 2'de zaten kapsam dışı bırakılmıştı, bkz. roadmap §4.4) — bilerek
    // atlanıyor, proje-detay.html henüz bu API'ye bağlı olmadığından gözlemlenebilir bir etkisi yok.
  } else {
    const id = nextProjectId++;
    let slug = row.slug;
    if (projectBySlug.has(slug)) slug = `${slug}-${id}`;
    out.push(`INSERT INTO projects (id, slug, title, category, type, discipline, location, location_detail, project_date, date_bucket, period, description, images, photo_credit_text, photo_credit_url, source_url, ai_generated, source, claimed_by_user_id) VALUES (${id}, ${sqlStr(slug)}, ${sqlStr(row.title)}, ${sqlJson(row.category)}, ${sqlJson(row.type)}, ${sqlJson(row.discipline)}, ${sqlStr(row.location)}, ${sqlStr(row.locationDetail)}, ${sqlStr(row.date)}, ${sqlStr(row.dateBucket)}, ${sqlJson(row.period)}, ${sqlStr(row.description)}, ${sqlJson(row.images)}, ${sqlStr(row.photoCreditText)}, ${sqlStr(row.photoCreditUrl)}, ${sqlStr(row.source_url)}, ${row.ai_generated ? 1 : 0}, 'submission', ${sqlStr(row.owner_user_id)});`);
    projectBySlug.set(slug, { id, slug, legacy_key: null });
    summary.projectInserted++;
    for (const name of (row.designer || [])) {
      const resolved = resolveDesigner(name, slug);
      if (resolved) { out.push(`INSERT INTO project_designers (project_id, architect_id, office_id) VALUES (${id}, ${sqlInt(resolved.architect_id)}, ${sqlInt(resolved.office_id)});`); summary.designerLinks++; }
    }
  }
}

// ============================================================
// 5) Products/materials — claim sistemi yok (bkz. schema.sql yorumu), onaylı HER satır yeni bir
//    canonical products kaydı. slug = "m-<submissionId>" — bugünkü urun-detay.html#productKey'in
//    üye ürünleri için ürettiği AYNI "m-<id>" biçimi (bkz. src/routes/product.js zaten bu uca hiçbir
//    sayfa bağlı değil, ama biçimi korumak ileride bağlanacak sayfalarla tutarlılık sağlıyor).
// ============================================================
function mergeProductRow(row, kind) {
  const id = nextProductId++;
  const slug = `m-${row.id}`;
  const brandMatch = row.brand ? uniqueMatch(officeGroupsByName, row.brand) : { row: null, ambiguous: false };
  if (brandMatch.ambiguous) {
    conflicts.push({ entity_type: 'product_brand', conflict_key: row.brand, context: `${kind}_submission:${row.id}`, candidates: brandMatch.candidates.map(r => ({ id: r.id, name: r.name })) });
  }
  out.push(`INSERT INTO products (id, slug, kind, title, brand_office_id, brand_name_raw, website, category, description, images, specs, source_url, ai_generated, source, claimed_by_user_id) VALUES (${id}, ${sqlStr(slug)}, ${sqlStr(kind)}, ${sqlStr(row.title)}, ${brandMatch.row ? brandMatch.row.id : 'NULL'}, ${sqlStr(row.brand)}, ${sqlStr(row.website)}, ${sqlStr(row.category)}, ${sqlStr(row.description)}, ${sqlJson(row.images)}, ${sqlJson(row.specs)}, ${sqlStr(row.source_url)}, ${row.ai_generated ? 1 : 0}, 'submission', ${sqlStr(row.owner_user_id)});`);
  summary.productInserted++;
  const architectNames = (row.architect || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const name of architectNames) {
    const archMatch = uniqueMatch(archGroupsByName, name);
    if (archMatch.row) { out.push(`INSERT INTO product_architects (product_id, architect_id) VALUES (${id}, ${archMatch.row.id});`); summary.productArchitectLinks++; }
    else if (archMatch.ambiguous) {
      conflicts.push({ entity_type: 'product_architect', conflict_key: name, context: `${kind}_submission:${row.id}`, candidates: archMatch.candidates.map(r => ({ id: r.id, name: r.name })) });
    }
    // eşleşme yoksa sessizce atla (bkz. dosya başı yorum).
  }
}
productSubs.forEach(r => mergeProductRow(r, 'product'));
materialSubs.forEach(r => mergeProductRow(r, 'material'));

// ============================================================
// Conflicts + çıktı
// ============================================================
for (const c of conflicts) {
  out.push(`INSERT INTO migration_name_conflicts (entity_type, conflict_key, context, candidates, status) VALUES (${sqlStr(c.entity_type)}, ${sqlStr(c.conflict_key)}, ${sqlStr(c.context)}, ${sqlJson(c.candidates)}, 'pending');`);
}
// D1 --remote, BEGIN TRANSACTION/COMMIT'i kabul etmiyor ("please use state.storage.transaction()
// instead" hatası, bkz. id-first-seed.sql'in prod'a uygulanırken verdiği AYNI hata) — bu yüzden
// artık hiçbir modda sarmalanmıyor; --local'de de tek tek, sırayla çalışır (atomiklik kaybı yok
// denecek kadar az, satırlar birbirinden bağımsız INSERT/UPDATE'ler).
const outDir = path.join(__dirname, 'output');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, REMOTE ? 'submissions-merge.remote.sql' : 'submissions-merge.sql');
fs.writeFileSync(outFile, out.join('\n') + '\n', 'utf8');

console.log(`\nÜretilen dosya: ${path.relative(ROOT, outFile)} (${REMOTE ? 'PROD verisinden' : 'yerel dev D1 verisinden'})`);
console.log(`  offices:  ${summary.officeUpdated} güncellendi, ${summary.officeInserted} yeni`);
console.log(`  architects: ${summary.archUpdated} güncellendi, ${summary.archInserted} yeni`);
console.log(`  office_founders: ${summary.founderLinks} yeni bağlantı`);
console.log(`  projects: ${summary.projectUpdated} güncellendi, ${summary.projectInserted} yeni, project_designers: ${summary.designerLinks} yeni bağlantı`);
console.log(`  products (product+material): ${summary.productInserted} yeni, product_architects: ${summary.productArchitectLinks} bağlantı`);
console.log(`  migration_name_conflicts: ${conflicts.length} yeni satır`);
if (conflicts.length) {
  console.log('\nÇakışma özeti:');
  for (const c of conflicts) console.log(`  [${c.entity_type}] "${c.conflict_key}"${c.context ? ` (${c.context})` : ''} — ${c.candidates.length} aday`);
}
console.log('\nBu dosya HENÜZ hiçbir veritabanına uygulanmadı. İncele, sonra örn.:');
console.log(`  npx wrangler d1 execute ${DB_NAME} ${TARGET_FLAG} --file=${path.relative(ROOT, outFile)}`);
