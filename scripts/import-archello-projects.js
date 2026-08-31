#!/usr/bin/env node
/**
 * Archello proje toplu içe aktarımı — kazıma + Türkçe çeviri sonrası TOHUMLAMA adımı.
 *
 * Bu script, oturum dışında hazırlanmış bir "payload" JSON'unu (aşağıdaki şekil) alıp
 * production D1'e yazar ve görselleri R2'ye yükler. Arkitera partilerinde kullanılan
 * AYNI desen (bkz. [[project_media_projects_route_is_r2_not_static]]):
 *
 *   1. `projects` satırı  (source='admin', build_status='built')
 *   2. görseller R2'ye `projects/<slug>-<n>.webp` anahtarıyla — /media/projects/* SADECE
 *      env.UPLOADS'tan okunur, git'e commit etmek görselleri CANLIYA GETİRMEZ.
 *   3. eşleşen ofis varsa `project_designers`, yoksa `migration_name_conflicts`
 *      (kullanıcı talimatı: eşleşmeyen firma için YENİ PROFİL AÇMA).
 *
 * Payload şekli (scripts/output/archello-payload.json):
 *   [{ slug, title, category[], type[], discipline[], location, locationDetail|null,
 *      projectDate, dateBucket|null, description, images[<mutlak URL>], photoCredit,
 *      sourceUrl, lat, lng, officeId|null, officeName, files[{key, path}] }]
 *
 * Kullanım:
 *   node scripts/import-archello-projects.js --payload <dosya> [--dry-run] [--local]
 *
 * scripts/backfill-project-slugs.js ile AYNI desen: varsayılan --remote, `--dry-run`
 * hiçbir şey yazmaz, yalnızca ne yapılacağını basar.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB_NAME = 'mimarlab-db';
const BUCKET = 'mimarlab-uploads';
const PERSIST_TO = '/Users/kaancorbaci/.mimarlab-dev-state';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const LOCAL = argv.includes('--local');
const payloadPath = argv[argv.indexOf('--payload') + 1];
if (!payloadPath || !fs.existsSync(payloadPath)) {
  console.error('kullanım: node scripts/import-archello-projects.js --payload <dosya.json> [--dry-run] [--local]');
  process.exit(1);
}
const TARGET = LOCAL ? ['--local', '--persist-to', PERSIST_TO] : ['--remote'];

function wrangler(args, opts = {}) {
  return execFileSync('npx', ['wrangler', ...args], {
    cwd: ROOT, maxBuffer: 1024 * 1024 * 256, ...opts,
  }).toString('utf8');
}

function d1(sql) {
  const out = wrangler(['d1', 'execute', DB_NAME, ...TARGET, '--json', '--command', sql.replace(/\s+/g, ' ').trim()]);
  return JSON.parse(out.slice(out.indexOf('[')))[0];
}

const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const j = (v) => q(JSON.stringify(v));

const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
console.log(`payload: ${payload.length} proje, ${payload.reduce((n, p) => n + p.files.length, 0)} görsel`);

// ---- 1. Mükerrer güvenlik ağı: slug zaten varsa o projeyi atla ----------------
const slugs = payload.map((p) => q(p.slug)).join(',');
const existing = new Set(
  d1(`SELECT slug FROM projects WHERE slug IN (${slugs})`).results.map((r) => r.slug),
);
if (existing.size) console.log(`  ! zaten var, atlanacak: ${[...existing].join(', ')}`);
const todo = payload.filter((p) => !existing.has(p.slug));
if (!todo.length) { console.log('yapılacak yeni proje yok.'); process.exit(0); }

// ---- 2. R2 yüklemesi ---------------------------------------------------------
// `wrangler r2 object put` her çağrıda ~2sn'lik bir node başlatma maliyeti taşıyor;
// 600+ nesnede sıralı yükleme yarım saati buluyor, bu yüzden küçük bir eşzamanlılık
// havuzu kullanılıyor. Cloudflare tarafındaki geçici 5xx'ler için 3 deneme (bkz.
// set-6 partisinde görülen 504/520'ler).
const CONCURRENCY = 6;

function putOnce(f) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${f.key}`,
      ...(LOCAL ? ['--local', '--persist-to', PERSIST_TO] : ['--remote']),
      '--file', f.path, '--content-type', 'image/webp'],
    { cwd: ROOT, stdio: 'ignore' });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

async function uploadAll(files) {
  let done = 0; const fails = [];
  let cursor = 0;
  async function worker() {
    while (cursor < files.length) {
      const f = files[cursor++];
      let ok = false;
      for (let a = 0; a < 3 && !ok; a++) ok = await putOnce(f);
      if (!ok) fails.push(f.key);
      if (++done % 50 === 0) console.log(`  R2 ${done}/${files.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return fails;
}

const allFiles = todo.flatMap((p) => p.files);

async function main() {
  const uploadFails = DRY ? [] : await uploadAll(allFiles);
  console.log(`R2: ${allFiles.length} nesne${DRY ? ' (dry-run, yazılmadı)' : ''}, ${uploadFails.length} hata`);
  uploadFails.forEach((k) => console.log('  R2 FAIL', k));
  if (uploadFails.length) {
    console.error('R2 yüklemesi eksik — D1 satırları YAZILMADI (kırık galeri bırakmamak için).');
    process.exit(1);
  }
  insertRows();
}

// ---- 3. D1 satırları ---------------------------------------------------------
function insertRows() {
for (const p of todo) {
  const sql = `INSERT INTO projects
      (slug, title, category, type, discipline, location, location_detail, project_date,
       date_bucket, period, description, images, photo_credit_text, source_url,
       ai_generated, source, build_status, lat, lng, created_at, updated_at)
    VALUES (${q(p.slug)}, ${q(p.title)}, ${j(p.category)}, ${j(p.type)}, ${j(p.discipline)},
       ${q(p.location)}, ${q(p.locationDetail)}, ${q(p.projectDate)}, ${q(p.dateBucket)}, ${j([])},
       ${q(p.description)}, ${j(p.images)}, ${q(p.photoCredit)}, ${q(p.sourceUrl)},
       0, 'admin', 'built', ${p.lat ?? 'NULL'}, ${p.lng ?? 'NULL'},
       datetime('now'), datetime('now'))`;
  if (DRY) { console.log(`  [dry] INSERT ${p.slug} (${p.images.length} görsel)`); continue; }
  d1(sql);
  const id = d1(`SELECT id FROM projects WHERE slug = ${q(p.slug)}`).results[0].id;
  if (p.officeId) {
    d1(`INSERT INTO project_designers (project_id, office_id) VALUES (${id}, ${p.officeId})`);
  } else {
    // Kullanıcı talimatı: eşleşmeyen firmaya YENİ PROFİL AÇILMAZ — yalnızca künye metni
    // (açıklamada geçiyor) + moderasyon kuyruğu. `projects`'te office_name_raw kolonu yok.
    d1(`INSERT INTO migration_name_conflicts (entity_type, conflict_key, context, candidates, status)
        VALUES ('project_designer', ${q(p.officeName)}, ${q(`${p.slug} (office)`)}, '[]', 'pending')`);
  }
  console.log(`  + ${p.slug} -> id ${id} (${p.images.length} görsel, ofis: ${p.officeId ? `#${p.officeId}` : 'eşleşmedi'})`);
}
console.log(DRY ? 'dry-run bitti, hiçbir şey yazılmadı.' : `bitti: ${todo.length} proje eklendi.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
