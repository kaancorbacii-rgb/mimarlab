#!/usr/bin/env node
/**
 * Eşleşen bir `offices`/`architects` kaydı OLMAYAN firma ve tasarım ekibi adlarını, ilgili
 * projelerin künyesine METİN olarak ekler (bkz. kullanıcı isteği: "Eşleşmeyen projelere de
 * firma ve mimar ekibini metin olarak olsa dahi ekle").
 *
 * NEDEN BİR `project_submissions` SATIRI: `project_designers` tablosu bir FK join tablosudur —
 * CHECK ((architect_id IS NOT NULL) != (office_id IS NOT NULL)) yüzünden profili olmayan bir isim
 * oraya YAZILAMAZ ve `projects` tablosunda `office_name_raw` gibi bir serbest metin kolonu yoktur.
 * Sitenin bunun için ZATEN var olan mekanizması, src/routes/project.js#fetchRawDesignerNames'in
 * okuduğu `project_submissions.designer` / `.office` JSON dizileridir: buradaki, hiçbir canonical
 * kayda bağlanamayan isimler künyede `unregistered: true` ile tıklanamaz "pasif" chip olarak
 * render edilir (bkz. js/components/project-meta.js). Yani bu backfill YENİ PROFİL AÇMAZ, yeni
 * kolon/kod da gerektirmez — var olan fallback yolunu besler.
 *
 * `office` kolonu NOT NULL yazıldığı için fetchRawDesignerNames isLegacy=false döner; Mimar/Firma
 * ayrımı isOfficeName() anahtar-kelime TAHMİNİNE düşmez, isim hangi kutudan geldiyse o başlığa
 * yazılır (bkz. migrations/0030_project_submission_office.sql).
 *
 * Satır, canonical `projects` satırının BİREBİR aynası olarak (tüm alanlar dolu) yazılır: eksik
 * alanlı bir taslak, admin `proje-ekle.html?edit=<id>` ile açıp kaydettiğinde canonical satırı
 * boş değerlerle EZERDİ (bkz. [[project_claim_edit_strips_key_bug]] ve
 * [[project_product_submission_draft_healing_2026_08_13]] — aynı sınıf hata).
 *
 * Kullanım:
 *   node scripts/backfill-unmatched-project-credits.js [--credits <dosya.json>] [--dry-run] [--local]
 *
 * `--credits` verilmezse aşağıdaki gömülü CREDITS haritası (2026-08-31 Archello partisi)
 * kullanılır; sonraki partiler kendi haritasını JSON dosyası olarak geçirir — dosya biçimi
 * gömülü haritayla aynıdır: { "<proje-slug>": { offices: [...], designers: [...] } }.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB_NAME = 'mimarlab-db';
const PERSIST_TO = '/Users/kaancorbaci/.mimarlab-dev-state';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const LOCAL = argv.includes('--local');
const TARGET = LOCAL ? ['--local', '--persist-to', PERSIST_TO] : ['--remote'];

// proje slug'ı -> { offices: [firma adları], designers: [tasarım ekibi adları] }
// Kaynak: Archello "Project credits" bloğu + künye metni (bkz.
// [[project_archello_import_2026_08_31]]). Yalnızca eşleşen bir `offices` satırı BULUNAMAYAN
// projeler; eşleşenlerin künyesi zaten `project_designers` üzerinden geliyor ve bu script onlara
// dokunmaz (dokunsaydı isLegacy=false olacağı için firmanın kurucu mimarlarını otomatik "Mimar:"
// chip'i yapan fallback'i de sessizce kapatırdı — bkz. src/routes/project.js:258).
const CREDITS_DEFAULT = {
  'btd-international-fund-house-ofisi': {
    offices: ['Sonraki Architecture', 'Kapeti Interior Architecture'],
    designers: ['Servet Yüksel', 'Anıl Yüksel'],
  },
  'zorlu-center-ozel-konut-projesi': {
    offices: ['Sonraki Architecture', 'Kapeti Interior Architecture'],
    designers: ['Servet Yüksel', 'Anıl Yüksel'],
  },
  'rempart-butik-otel':               { offices: ['NDO Architecture'], designers: ['Nazlı Deniz Ozan'] },
  'agave-games-ofisleri':             { offices: ['Build Up Aac'], designers: [] },
  'koleksiyon-park-macka':            { offices: ['spark architecture & interiors'], designers: [] },
  'asos-proses-muhendislik-ofisleri': { offices: ['Dam Design Studio'], designers: [] },
  'enerjisa-atasehir-ofisi':          { offices: ['Dam Design Studio'], designers: [] },
  'feteks-tekstil-ofisi':             { offices: ['Dam Design Studio'], designers: [] },
  'ventera-ofis-i':                   { offices: ['Dam Design Studio'], designers: [] },
  'ventera-ofis-ii':                  { offices: ['Dam Design Studio'], designers: [] },
  'bureau-genel-merkez-ve-galeri':    { offices: ['BURĒAU'], designers: [] },
  'bodrum-misafir-evi':               { offices: ['BURĒAU'], designers: [] },
  'concentrix-istanbul-ofisi':        { offices: ['Altıpatlar Architects'], designers: [] },
};

const creditsPath = argv.includes('--credits') ? argv[argv.indexOf('--credits') + 1] : null;
if (creditsPath && !fs.existsSync(creditsPath)) {
  console.error(`--credits dosyası bulunamadı: ${creditsPath}`);
  process.exit(1);
}
const CREDITS = creditsPath
  ? JSON.parse(fs.readFileSync(creditsPath, 'utf8'))
  : CREDITS_DEFAULT;

function d1(sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', DB_NAME, ...TARGET, '--json',
    // `\s+ -> ' '` YAPMA: bu satır, kopyalanan `description`'ın İÇİNDEKİ paragraf sonlarını da
    // yer yapıp taslağı canonical satırdan farklılaştırırdı (bkz. import-archello-projects.js'teki
    // aynı not) — taslak, canonical satırın birebir aynası olmak zorunda.
    '--command', sql.trim()], { cwd: ROOT, maxBuffer: 1024 * 1024 * 256 }).toString('utf8');
  return JSON.parse(out.slice(out.indexOf('[')))[0];
}
const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

const slugs = Object.keys(CREDITS);
const rows = d1(`SELECT id, slug, title, category, type, discipline, location, location_detail,
                        project_date, date_bucket, period, description, images, photo_credit_text,
                        photo_credit_url, source_url, build_status, concept_category, awards,
                        publish_date, lat, lng
                 FROM projects WHERE slug IN (${slugs.map(q).join(',')})`).results;
console.log(`${rows.length}/${slugs.length} canonical proje bulundu`);

const already = new Set(
  d1(`SELECT claimed_slug FROM project_submissions WHERE claimed_slug IN (${slugs.map(q).join(',')})`)
    .results.map((r) => r.claimed_slug),
);
if (already.size) console.log(`  ! zaten taslağı var, atlanacak: ${[...already].join(', ')}`);

let n = 0;
for (const p of rows) {
  if (already.has(p.slug)) continue;
  const c = CREDITS[p.slug];
  const id = crypto.randomUUID();
  const now = Date.now();
  const sql = `INSERT INTO project_submissions
      (id, owner_user_id, status, created_at, updated_at, slug, title, category, type, location,
       locationDetail, date, dateBucket, period, designer, photoCreditText, photoCreditUrl,
       description, images, brands, claimed_slug, source_url, ai_generated, discipline, office,
       build_status, conceptCategory, awards, publishDate, lat, lng)
    VALUES (${q(id)}, NULL, 'approved', ${now}, ${now}, ${q(p.slug)}, ${q(p.title)},
       ${q(p.category)}, ${q(p.type)}, ${q(p.location)}, ${q(p.location_detail)},
       ${q(p.project_date)}, ${q(p.date_bucket)}, ${q(p.period || '[]')},
       ${q(JSON.stringify(c.designers))}, ${q(p.photo_credit_text)}, ${q(p.photo_credit_url)},
       ${q(p.description)}, ${q(p.images)}, '[]', ${q(p.slug)}, ${q(p.source_url)}, 0,
       ${q(p.discipline)}, ${q(JSON.stringify(c.offices))}, ${q(p.build_status)},
       ${q(p.concept_category)}, ${q(p.awards || '[]')}, ${q(p.publish_date)},
       ${p.lat ?? 'NULL'}, ${p.lng ?? 'NULL'})`;
  if (DRY) {
    console.log(`  [dry] ${p.slug}: firma=${c.offices.join(', ')} | ekip=${c.designers.join(', ') || '—'}`);
    continue;
  }
  d1(sql);
  n++;
  console.log(`  + ${p.slug}: firma=${c.offices.join(', ')} | ekip=${c.designers.join(', ') || '—'}`);
}
console.log(DRY ? 'dry-run bitti.' : `bitti: ${n} künye taslağı yazıldı.`);
