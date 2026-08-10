#!/usr/bin/env node
// Bir seferlik geriye dönük temizlik — src/lib/submissionTypes.js#normalizeSubmission eskiden HER
// yeni projeye title'dan sonra rastgele 5 karakterlik bir ek ekliyordu (ör. "optimum-evleri-fgzqu"),
// bkz. kullanıcı isteği: "Yapı ve proje URL'lerinde neden isimden sonra random harfler geliyor?".
// O üretici zaten düzeltildi (artık salt slugify(title)) ve isim değiştiğinde slug'ı canlı olarak
// güncelleyen bir rename-cascade + 301 redirect sistemi eklendi (bkz. migrations/
// 0041_slug_redirects.sql, src/lib/canonicalSync.js#syncProject) — ama İKİSİ DE yalnızca BUNDAN
// SONRAKİ oluşturma/yeniden adlandırmaları kapsıyor; düzeltmeden ÖNCE zaten rastgele ekle
// oluşturulmuş mevcut projeler (canlıda ~964 projenin çoğu) dokunulmadan kaldı — bu script TAM
// OLARAK o boşluğu dolduruyor: her projenin slug'ını slugify(title)'a geri döndürür.
//
// scripts/normalize-project-locations.js/backfill-project-products.js ile AYNI desen: HİÇBİR ŞEYİ
// DOĞRUDAN VERİTABANINA YAZMAZ, yalnızca rapor basar ve (--write-sql ile) operatörün elle inceleyip
// uygulayacağı bir .sql dosyası üretir. Üretilen SQL, canlı rename akışıyla (bkz.
// src/lib/canonicalSync.js#renameProjectSlugEverywhere) BİREBİR aynı adımları izler: projects.slug
// güncellenir, comments/ratings/saved_items/legacy_content_hidden eski slug'dan yeni slug'a taşınır,
// slug_redirects'e eski->yeni eşlemesi eklenir (var olan bir zincir varsa tek atlamaya sıkıştırılır)
// — böylece eski URL'ler kırılmaz, 301 ile yeni adrese yönlenir (bkz. src/index.js#serveDetailPage).
//
// Çakışma çözümü: aynı title'dan aynı slug'a düşen birden fazla proje (ör. iki ayrı "Ev Projesi")
// canlı syncProject/freshSlugFor ile AYNI "-2", "-3"... sırayla artan sonek deseniyle ayrıştırılır.
//
// SSR HTML önbelleği (caches.default) bu script'ten ERİŞİLEMEZ (yalnızca Worker runtime'ında var) —
// üretilen SQL uygulandıktan sonra eski slug'a giden bir istek en kötü ihtimalle s-maxage=300
// (5 dakika) kadar bayat içerik görebilir, sonrasında serveDetailPage zaten güncel slug'ı SSR
// önbelleğe yazar. Kalıcı bir sorun değil, yalnızca en fazla birkaç dakikalık bir gecikme.
//
// Modlar:
//   (bayraksız / --remote)   Varsayılan: yalnızca SELECT, ekrana insan-okunur rapor basar.
//   --write-sql              Ayrıca scripts/output/backfill-project-slugs[.remote].sql üretir.
//   --local                  --remote yerine yerel dev D1'i hedefler (varsayılan --remote'dur —
//                            rastgele ekli slug'lar yalnızca üretimde birikmiş durumda).

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
// require edemiyor, bilerek tekrar tanımlanıyor (bkz. bu dizindeki diğer script'lerdeki AYNI kısıt).
const TR_MAP = { ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', I: 'i', İ: 'i', ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u' };
function slugify(text) {
  return (text || '')
    .split('').map(ch => TR_MAP[ch] || ch).join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

console.log(`Projeler okunuyor (${REMOTE ? 'PRODUCTION D1' : 'yerel dev D1'})...`);
// source != 'legacy_static' KRİTİK — gerçek bulgu: ilk deneme TÜM projeleri taradı ve
// legacy_static (data.js kökenli) satırların DELİBERE, title'dan bağımsız kısa/şehir-sonekli
// slug'larını (ör. "g-house-mugla" — title "G House", slug/legacy_key BİREBİR "g-house-mugla",
// migration'da böyle verilmiş, birden fazla aynı isimli statik projeyi ayırt etmek için) rastgele
// ekmiş gibi yanlış tespit etti; "mugla"/"bursa"/"izmir"/"gebze"/"tuzla" gibi ekler 5 harf olsa da
// RASTGELE DEĞİL, gerçek şehir adları. Bu script SADECE gerçekten buggy normalizeSubmission
// yolundan geçmiş satırları (source='submission'|'admin', legacy_static'in dışı) hedefler —
// legacy_static'in kendi slug'ı HER ZAMAN dokunulmaz kalır.
const rows = d1Query(`SELECT id, slug, title FROM projects WHERE deleted_at IS NULL AND source != 'legacy_static' ORDER BY id`);
console.log(`Taranan proje satırı (legacy_static hariç): ${rows.length}`);

// Yalnızca eski normalizeSubmission'ın ürettiği TAM desene uyan satırlar hedeflenir: slugify(title)
// + "-" + TAM OLARAK 5 alfasayısal karakter (bkz. eski kod: Math.random().toString(36).slice(2,7)
// HER ZAMAN 5 karakter üretir) — yani slug, slugify(title)'ın ÖNÜNDE durur ve ardından gelen
// soneğin title'la HİÇBİR ilgisi yoktur (title'da geçen bir kelime/şehir DEĞİLDİR).
const RANDOM_SUFFIX_RE = /^(.+)-[a-z0-9]{5}$/;
const usedSlugs = new Set(rows.map(r => r.slug));
const renames = [];
for (const row of rows) {
  const m = RANDOM_SUFFIX_RE.exec(row.slug);
  if (!m) continue;
  const base = slugify(row.title) || `proje-${row.id}`;
  if (m[1] !== base) continue; // sonek öncesi kısım title'la eşleşmiyorsa bu rastgele ek DEĞİL, dokunma
  usedSlugs.delete(row.slug); // kendi eski slug'ı artık serbest (aynı satıra ait)
  let candidate = base, n = 2;
  while (usedSlugs.has(candidate)) { candidate = `${base}-${n}`; n++; }
  usedSlugs.add(candidate);
  renames.push({ id: row.id, oldSlug: row.slug, newSlug: candidate, title: row.title });
}

console.log(`Rastgele ek / temiz-olmayan slug'lı satır: ${renames.length}`);
if (renames.length) {
  console.log('\nid\teski slug\t\t\t->\tyeni slug');
  renames.forEach(r => console.log(`${r.id}\t${r.oldSlug}\t->\t${r.newSlug}`));
}

if (WRITE_SQL && renames.length) {
  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, REMOTE ? 'backfill-project-slugs.remote.sql' : 'backfill-project-slugs.sql');
  const statements = [];
  for (const r of renames) {
    const oldS = sqlEscape(r.oldSlug), newS = sqlEscape(r.newSlug);
    statements.push(`UPDATE projects SET slug = '${newS}', updated_at = datetime('now') WHERE id = ${r.id};`);
    // bkz. src/lib/canonicalSync.js#renameProjectSlugEverywhere ile BİREBİR aynı dört tablo/kolon.
    statements.push(`UPDATE comments SET target_id = '${newS}' WHERE target_type = 'project' AND target_id = '${oldS}';`);
    statements.push(`UPDATE OR IGNORE ratings SET target_id = '${newS}' WHERE target_type = 'project' AND target_id = '${oldS}';`);
    statements.push(`UPDATE OR IGNORE saved_items SET item_key = '${newS}' WHERE item_type = 'project' AND item_key = '${oldS}';`);
    statements.push(`UPDATE OR IGNORE legacy_content_hidden SET content_key = '${newS}' WHERE content_type = 'projects' AND content_key = '${oldS}';`);
    // bkz. src/lib/slugRedirects.js#recordSlugRedirect ile AYNI zincir-çöküşü mantığı — bu eski
    // slug'ı hedefleyen ÖNCEKİ bir redirect varsa (nadir, bu script'ten önce zaten bir kez
    // yeniden adlandırılmışsa) doğrudan yeni slug'a işaret etsin.
    statements.push(`UPDATE slug_redirects SET new_slug = '${newS}', created_at = datetime('now') WHERE entity_type = 'projects' AND new_slug = '${oldS}';`);
    statements.push(`DELETE FROM slug_redirects WHERE entity_type = 'projects' AND old_slug = '${newS}';`);
    statements.push(
      `INSERT INTO slug_redirects (entity_type, old_slug, new_slug) VALUES ('projects', '${oldS}', '${newS}') ` +
      `ON CONFLICT(entity_type, old_slug) DO UPDATE SET new_slug = excluded.new_slug, created_at = datetime('now');`
    );
  }
  fs.writeFileSync(outFile, statements.join('\n') + '\n', 'utf8');
  console.log(`\nÜretilen dosya: ${path.relative(ROOT, outFile)} (${REMOTE ? 'PROD verisinden' : 'yerel dev D1 verisinden'})`);
  console.log(`${renames.length} proje x 7 ifade = ${statements.length} SQL ifadesi.`);
  console.log('\nBu dosya HENÜZ hiçbir veritabanına uygulanmadı. İncele, sonra örn.:');
  console.log(`  npx wrangler d1 execute ${DB_NAME} ${TARGET_FLAG} --file=${path.relative(ROOT, outFile)}`);
} else if (!WRITE_SQL && renames.length) {
  console.log('\nBir .sql dosyası üretmek için --write-sql ekleyerek tekrar çalıştır.');
}
