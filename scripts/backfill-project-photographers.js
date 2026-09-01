#!/usr/bin/env node
// Fotoğrafçı profilleri + project_photographers tek seferlik backfill (kullanıcı isteği, 2026-09-01
// madde 6: "Cemal Emden, Egemen Karakaya, Emre Dörter, İbrahim Özbunar gibi çok sayıda proje
// künyesinde olan fotoğrafçılar için popupları oluştur ve ilgili projelere ekle").
//
// NE YAPAR
//   1. projects.photo_credit_text içindeki isimleri virgülle ayırıp normalize eder (canlı akıştaki
//      src/lib/canonicalSync.js#splitPhotographerNames ile AYNI kural — bu script plain `node` ile
//      çalıştığından ESM import edemiyor, bkz. bu dizindeki diğer script'lerdeki AYNI kısıt).
//   2. En az MIN_PROJECTS projede geçen ve architects tablosunda henüz karşılığı OLMAYAN her isim
//      için `profession='Fotoğrafçı'` taşıyan bir architects satırı üretir — böylece o kişinin
//      /mimar/<slug> popup'ı açılır hale gelir.
//   3. Adı architects'te (yeni ya da zaten var olan) eşleşen HER isim için project_photographers
//      kenarını üretir — popup'taki "Fotoğrafladığı Projeler" bölümünü besleyen tek kaynak budur
//      (bkz. src/routes/architect.js#photographedProjects).
//
// HİÇBİR ŞEYİ DOĞRUDAN VERİTABANINA YAZMAZ — scripts/backfill-project-products.js ile AYNI desen:
// yalnızca scripts/output/project-photographers-backfill.sql üretir, operatör inceleyip
// `wrangler d1 execute --local/--remote --file=...` ile uygular.
//
// EŞİK (MIN_PROJECTS) NEDEN VAR: photo_credit_text alanı yalnızca kişi adı değil kurum/ajans/kaynak
// adı da taşıyor ("Arkitera", "Ofisin kendi arşivi" gibi). Her serbest metni bir KİŞİ profiline
// dönüştürmek dizini çöple doldururdu. Eşik, isteğin saydığı türden (Cemal Emden, Egemen Karakaya,
// Emre Dörter, İbrahim Özbunar) gerçekten çok sayıda künyede geçen fotoğrafçıları hedefler; eşiğin
// ALTINDA kalan isimler için profil AÇILMAZ ama zaten var olan bir profile denk geliyorlarsa
// bağlantıları yine de kurulur (2. adım eşikten bağımsızdır).

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(__dirname, 'output');
const OUT_FILE = path.join(OUT_DIR, 'project-photographers-backfill.sql');
const PERSIST_TO = '/Users/kaancorbaci/.mimarlab-dev-state';
const DB_NAME = 'mimarlab-db';
const REMOTE = process.argv.includes('--remote');
const TARGET_FLAG = REMOTE ? '--remote' : `--local --persist-to ${PERSIST_TO}`;
const MIN_PROJECTS = Number(
  (process.argv.find(a => a.startsWith('--min=')) || '--min=3').slice('--min='.length)
);

function d1Query(sql) {
  const flat = sql.replace(/\s+/g, ' ').trim();
  const cmd = `npx wrangler d1 execute ${DB_NAME} ${TARGET_FLAG} --json --command ${JSON.stringify(flat)}`;
  const out = execSync(cmd, { cwd: ROOT, maxBuffer: 1024 * 1024 * 128 });
  return JSON.parse(out.toString('utf8'))[0].results;
}

function sqlStr(v) { return `'${String(v).replace(/'/g, "''")}'`; }

// src/lib/slugify.js ile AYNI kural (Türkçe harf eşlemesi + ASCII slug) — bkz. save-widget.js#slugify.
const TR_MAP = { 'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'I': 'i', 'İ': 'i', 'ö': 'o', 'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u' };
function slugify(text) {
  return String(text || '').split('').map(ch => TR_MAP[ch] || ch).join('')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
// İsim karşılaştırması için Türkçe-duyarlı katlama (bkz. src/routes/product.js#foldTr).
function foldTr(s) {
  return String(s || '')
    .replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/Ş/g, 'ş').replace(/Ğ/g, 'ğ')
    .replace(/Ü/g, 'ü').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç')
    .toLowerCase()
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o')
    .replace(/\s+/g, ' ').trim();
}
function splitPhotographerNames(text) {
  return String(text || '').split(',').map(s => s.trim()).filter(Boolean);
}

// Kişi ADI olamayacak kadar jenerik/kurumsal kaynak metinleri — bunlar için ASLA profil açılmaz
// (2. adımda zaten var olan bir profille eşleşirlerse bağlanmaya devam ederler).
// Liste yerel bir kuru çalıştırmanın ÇIKTISINA bakılarak sıkılaştırıldı: ilk sürüm "EAA — Emre
// Arolat Architecture", "T.C. Kültür ve Turizm Bakanlığı", "TRT Haber", "İBB İstanbul Turizm
// Platformu", "Ket Kolektif", "GAD Architecture", "Yerçekim Mimari Fotoğraf" gibi KURUM adlarına da
// kişi profili açıyordu.
const NON_PERSON_PATTERNS = [
  /arşiv/i, /archive/i, /courtesy/i, /photograph(y|s|ers?)?$/i, /studio/i, /ajans/i, /agency/i,
  /^www\./i, /^https?:/i, /\.com/i, /mimarl[ıi]k/i, /mimari/i, /architect/i, /design/i,
  /^belirtilmemiş$/i, /^bilinmiyor$/i,
  /^t\.?\s?c\.?\s/i, /bakanl[ıi][ğg][ıi]/i, /belediye/i, /^[iİ]bb\b/i, /müdürlü[ğg]ü/i, /üniversite/i,
  /platform/i, /haber/i, /kolektif/i, /vakf[ıi]/i, /derne[ğg]i/i, /müze/i, /museum/i, /koleksiyon/i,
  /tasar[ıi]m/i, /holding/i, /in[şs]aat/i, /yap[ıi]$/i, /grup$/i, /group$/i, /^salon\s/i, /^atölye/i,
  // PROD kuru çalıştırmasında yakalanan son kurum kalıntısı: "HPP International Turkey".
  /international/i, /\bturkey\b/i, /\bt[üu]rkiye\b/i, /\bglobal\b/i, /\bpartners?\b/i,
  /foto[ğg]raf(ç[ıi]l[ıi]k)?$/i, /\bA\.?Ş\.?$/, /\bLtd\.?/i, /\binc\.?$/i, /&/, /—/, /\|/,
];
function looksLikePersonName(name) {
  if (name.length < 5 || name.length > 40) return false;
  if (NON_PERSON_PATTERNS.some(re => re.test(name))) return false;
  const words = name.split(/\s+/).filter(Boolean);
  // 2-4 kelime (ad + soyad, olası ikinci ad) — daha uzun künyeler neredeyse her zaman kurum adı.
  if (words.length < 2 || words.length > 4) return false;
  // Her kelime büyük harfle başlamalı ve harf dışı karakter içermemeli (rakam/nokta = kurum kodu).
  return words.every(w => /^[\p{Lu}][\p{L}'’-]*$/u.test(w));
}

// Aynı kişi künyelerde farklı yazılabiliyor ("İbrahim Özbunar" / "Ibrahim Ozbunar") — foldTr ikisini
// tek anahtarda birleştirir, ama PROFİLE yazılacak görünen ad tek bir varyant olmalı. En sık geçen
// varyant seçilir; eşitlikte Türkçe aksanlı olan (daha doğru yazım) kazanır.
function pickDisplayName(variants) {
  const trChars = s => (s.match(/[çğıöşüÇĞİÖŞÜ]/g) || []).length;
  return [...variants.entries()].sort((a, b) => (b[1] - a[1]) || (trChars(b[0]) - trChars(a[0])))[0][0];
}

console.log(`Projeler okunuyor (${REMOTE ? 'PROD' : 'yerel dev D1'})...`);
const projects = d1Query(
  `SELECT id, photo_credit_text FROM projects
   WHERE deleted_at IS NULL AND hidden_at IS NULL AND photo_credit_text IS NOT NULL AND photo_credit_text != ''`
);
const architects = d1Query(`SELECT id, name, slug, profession FROM architects WHERE deleted_at IS NULL`);
const existingLinks = new Set(
  d1Query(`SELECT project_id, architect_id FROM project_photographers`).map(r => `${r.project_id}:${r.architect_id}`)
);
const existingSlugs = new Set(architects.map(a => a.slug));
const architectByFold = new Map(architects.map(a => [foldTr(a.name), a]));

// isim(fold) -> { variants:Map<rawYazım,adet>, projectIds:Set }
const byName = new Map();
for (const p of projects) {
  for (const raw of splitPhotographerNames(p.photo_credit_text)) {
    const key = foldTr(raw);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, { variants: new Map(), projectIds: new Set() });
    const entry = byName.get(key);
    entry.variants.set(raw, (entry.variants.get(raw) || 0) + 1);
    entry.projectIds.add(p.id);
  }
}
for (const entry of byName.values()) entry.display = pickDisplayName(entry.variants);

const newArchitects = [];  // { name, slug }
const linkStatements = [];
let linkedToExisting = 0;

// Yeni profiller önce üretilir ki aynı çalıştırmada onların bağlantıları da yazılabilsin.
// architects.id AUTOINCREMENT olduğundan yeni satırların id'si SQL üretilirken bilinmiyor —
// bağlantılar bu yüzden id yerine bir alt-sorguyla (slug üzerinden) yazılır.
for (const [key, info] of byName) {
  const existing = architectByFold.get(key);
  if (existing) continue;
  if (info.projectIds.size < MIN_PROJECTS) continue;
  if (!looksLikePersonName(info.display)) continue;
  let slug = slugify(info.display);
  if (!slug) continue;
  let n = 2;
  while (existingSlugs.has(slug)) slug = `${slugify(info.display)}-${n++}`;
  existingSlugs.add(slug);
  newArchitects.push({ name: info.display, slug, projectCount: info.projectIds.size });
  architectByFold.set(key, { id: null, name: info.display, slug, profession: 'Fotoğrafçı' });
}

for (const [key, info] of byName) {
  const arch = architectByFold.get(key);
  if (!arch) continue;
  for (const projectId of info.projectIds) {
    if (arch.id != null) {
      if (existingLinks.has(`${projectId}:${arch.id}`)) continue;
      linkedToExisting++;
      linkStatements.push(
        `INSERT OR IGNORE INTO project_photographers (project_id, architect_id) VALUES (${projectId}, ${arch.id});`
      );
    } else {
      linkStatements.push(
        `INSERT OR IGNORE INTO project_photographers (project_id, architect_id) SELECT ${projectId}, id FROM architects WHERE slug = ${sqlStr(arch.slug)};`
      );
    }
  }
}

const lines = [
  '-- scripts/backfill-project-photographers.js tarafından üretildi.',
  `-- Kaynak: ${REMOTE ? 'PROD' : 'yerel dev'} D1 · eşik: en az ${MIN_PROJECTS} proje`,
  `-- Yeni fotoğrafçı profili: ${newArchitects.length} · bağlantı ifadesi: ${linkStatements.length}`,
  '',
];
for (const a of newArchitects) {
  lines.push(
    `INSERT INTO architects (slug, name, profession, source, legacy_key) ` +
    `SELECT ${sqlStr(a.slug)}, ${sqlStr(a.name)}, 'Fotoğrafçı', 'admin', NULL ` +
    `WHERE NOT EXISTS (SELECT 1 FROM architects WHERE slug = ${sqlStr(a.slug)});  -- ${a.projectCount} proje`
  );
}
lines.push('');
lines.push(...linkStatements);
lines.push('');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, lines.join('\n'), 'utf8');

console.log(`\nToplam farklı fotoğrafçı adı : ${byName.size}`);
console.log(`Yeni açılacak profil          : ${newArchitects.length}`);
console.log(`Var olan profile bağlanan     : ${linkedToExisting}`);
console.log(`Toplam bağlantı ifadesi       : ${linkStatements.length}`);
console.log(`\nSQL yazıldı: ${path.relative(ROOT, OUT_FILE)}`);
console.log(`Uygulamak için:\n  npx wrangler d1 execute ${DB_NAME} ${TARGET_FLAG} --file=${path.relative(ROOT, OUT_FILE)}`);
if (newArchitects.length) {
  console.log('\nEn çok künyesi olan yeni profiller:');
  newArchitects.sort((a, b) => b.projectCount - a.projectCount).slice(0, 15)
    .forEach(a => console.log(`  ${String(a.projectCount).padStart(4)}  ${a.name}  (/mimar/${a.slug})`));
}
