#!/usr/bin/env node
// Yer filtresi normalizasyonu (bkz. kullanıcı isteği) — projects.location'da "İlçe, İl" gibi
// virgüllü kombinasyon olarak saklanmış (ör. "Kadıköy, İstanbul", "Çankaya, Ankara") satırları
// bulup yalnızca il adına indirger. Kullanıcı BİLEREK il-ilce-data.js#parseLocationFull'un
// yeniden yazılmasını YA DA location_detail gibi yeni bir alan eklenmesini istemedi — "sistemi
// olduğu gibi bırak, sadece şimdiye kadar birikmiş virgüllü seçenekleri sil" dedi. Bu yüzden bu
// script parseLocationFull'u DEĞİL, kendi küçük virgül-tespit mantığını kullanır; il-ilce-data.js
// dosyasına hiçbir yazma/değişiklik yapmaz.
//
// scripts/dedupe-canonical-records.js / backfill-project-products.js ile AYNI desen: HİÇBİR ŞEYİ
// DOĞRUDAN VERİTABANINA YAZMAZ, yalnızca rapor basar ve (--write-sql ile) operatörün elle inceleyip
// uygulayacağı bir .sql dosyası üretir.
//
// Modlar:
//   (bayraksız / --remote)   Varsayılan: yalnızca SELECT, ekrana insan-okunur rapor basar.
//   --write-sql              Ayrıca scripts/output/normalize-project-locations[.remote].sql üretir.
//   --local                  --remote yerine yerel dev D1'i hedefler (varsayılan --remote'dur —
//                            gerçek virgüllü kayıtlar yalnızca üretimde bilinir, yerel dev
//                            kopyasında hiç görülmedi).

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

// il-ilce-data.js'i DEĞİŞTİRMEDEN, salt-okunur şekilde IL_ILCE'yi çıkarır — TR_IL_LIST bu
// dosyadaki ilk 81 anahtar (Adana...Zonguldak); ondan SONRAKİ anahtarlar yurt dışı ülke adları
// (İngiltere, Almanya...) olduğundan 81'i geçmeyecek şekilde kesilir.
function loadTrIlList() {
  const src = fs.readFileSync(path.join(ROOT, 'il-ilce-data.js'), 'utf8');
  const sandbox = {};
  new Function('module', 'exports', src + '\nmodule.exports = { IL_ILCE };')(sandbox, sandbox);
  const keys = Object.keys(sandbox.exports ? sandbox.exports.IL_ILCE : {});
  const trIlList = keys.slice(0, 81);
  if (trIlList.length !== 81) throw new Error(`Beklenmeyen il sayısı: ${trIlList.length} (il-ilce-data.js yapısı değişmiş olabilir)`);
  return trIlList;
}

// "Kadıköy, İstanbul" ya da "İstanbul, Kadıköy" gibi virgülle ayrılmış parçalardan BİRİ tam olarak
// 81 il listesinden biriyle eşleşiyorsa o il adını döner; eşleşme yoksa null (dokunulmaz).
function resolveCommaFormat(raw, trIlSet) {
  if (!raw || !raw.includes(',')) return null;
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  for (const p of parts) { if (trIlSet.has(p)) return p; }
  return null;
}

function sqlEscape(s) { return String(s).replace(/'/g, "''"); }

const trIlList = loadTrIlList();
const trIlSet = new Set(trIlList);

const rows = d1Query(`SELECT id, slug, location FROM projects WHERE location IS NOT NULL AND location != '' AND deleted_at IS NULL`);

const anomalies = [];
for (const r of rows) {
  const resolved = resolveCommaFormat(r.location, trIlSet);
  if (resolved && resolved !== r.location) anomalies.push({ id: r.id, slug: r.slug, oldLocation: r.location, newLocation: resolved });
}

console.log(`Taranan proje satırı: ${rows.length} (${REMOTE ? 'PRODUCTION D1' : 'yerel dev D1'})`);
console.log(`Virgüllü/bozuk "İlçe, İl" formatında bulunan satır: ${anomalies.length}`);
if (anomalies.length) {
  console.log('\nid\tslug\t\t\teski location\t\t\tyeni location');
  anomalies.forEach(a => console.log(`${a.id}\t${a.slug}\t${a.oldLocation}\t->\t${a.newLocation}`));
}

if (WRITE_SQL && anomalies.length) {
  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, REMOTE ? 'normalize-project-locations.remote.sql' : 'normalize-project-locations.sql');
  const sql = anomalies
    .map(a => `UPDATE projects SET location = '${sqlEscape(a.newLocation)}', updated_at = datetime('now') WHERE id = ${a.id};`)
    .join('\n');
  fs.writeFileSync(outFile, sql + '\n', 'utf8');
  console.log(`\nÜretilen dosya: ${path.relative(ROOT, outFile)} (${REMOTE ? 'PROD verisinden' : 'yerel dev D1 verisinden'})`);
  console.log('\nBu dosya HENÜZ hiçbir veritabanına uygulanmadı. İncele, sonra örn.:');
  console.log(`  npx wrangler d1 execute ${DB_NAME} ${TARGET_FLAG} --file=${path.relative(ROOT, outFile)}`);
} else if (!WRITE_SQL && anomalies.length) {
  console.log('\nBir .sql dosyası üretmek için --write-sql ekleyerek tekrar çalıştır.');
}
