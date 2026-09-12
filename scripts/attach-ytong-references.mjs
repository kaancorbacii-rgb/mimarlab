#!/usr/bin/env node
// YTONG REFERANSLARI -> project_brands (kullanıcı isteği, 2026-09-12 madde 2:
// "https://www.ytong.com.tr/referanslar linkinde isimleri yazan projeler MİMARLAB'da yüklüyse bu
// projelere Ytong markasını kullanıldı olarak ekle. Ürün eklemene gerek yok.")
//
// NEDEN BİR SCRIPT (ve neden iş bu oturumda bitmedi): bu bir KOD değişikliği değil, canlı D1'de bir
// VERİ değişikliği. Claude Code'un uzak (web/telefon) oturumu izole bir konteynerde çalışır;
// ağ politikası hem ytong.com.tr'yi hem de api.cloudflare.com/mimarlab.com'u reddeder (ölçüldü,
// 2026-09-12: CONNECT'e 403 — bkz. CLAUDE.md "Uzak oturumdan / telefondan deploy"). Yani referans
// listesi O oturumdan OKUNAMAZ ve D1'e YAZILAMAZ. Bu script ikisini de yapabilen tek yerde —
// kullanıcının kendi makinesinde — tek komutla çalışır.
//
// scripts/backfill-project-photographers.js ile AYNI GÜVENLİK DESENİ: veritabanına HİÇBİR ŞEY
// doğrudan yazmaz, yalnızca scripts/output/ytong-project-brands.sql üretir; operatör dosyayı
// inceleyip `npx wrangler d1 execute mimarlab-db --remote --file=...` ile uygular.
//
// KULLANIM
//   node scripts/attach-ytong-references.mjs                 # yerel dev D1'e bakar (kuru çalıştırma)
//   node scripts/attach-ytong-references.mjs --remote        # PROD D1'e bakar, SQL üretir
//   node scripts/attach-ytong-references.mjs --html=ref.html # listeyi kayıtlı bir HTML'den okur
//   node scripts/attach-ytong-references.mjs --scan-ids=1-160  # liste JS ile geliyorsa detay
//                                                              # sayfalarını tek tek gezer
//   ... --fuzzy   # birebir eşleşmeye ek olarak "içeren" eşleşmeleri de KABUL eder (bkz. aşağıda)
//
// EŞLEŞTİRME KURALI (bilerek MUHAFAZAKÂR): referans adı ile proje başlığı foldTr (Türkçe katlama,
// src/lib/textMatch.js — canlı aramanın kullandığı AYNI fonksiyon) altında BİREBİR aynıysa eşleşme
// sayılır. Yanlış pozitif, bir markayı hiç kullanılmadığı bir projeye künye olarak yazmak demektir;
// bu yüzden şüpheli/yakın eşleşmeler varsayılan olarak UYGULANMAZ, yalnızca "incelenecek" listesine
// düşer — operatör bakıp isterse --fuzzy ile tekrar çalıştırır.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { foldTr } from '../src/lib/textMatch.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'scripts', 'output');
const OUT_FILE = path.join(OUT_DIR, 'ytong-project-brands.sql');
const DB_NAME = 'mimarlab-db';
const PERSIST_TO = '/Users/kaancorbaci/.mimarlab-dev-state';
const LIST_URL = 'https://www.ytong.com.tr/referanslar';
const DETAIL_URL = (id) => `https://www.ytong.com.tr/referansdetay?id=${id}`;

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const REMOTE = has('--remote');
const FUZZY = has('--fuzzy');
const HTML_FILE = valueOf('html');
const SCAN_IDS = valueOf('scan-ids');
const TARGET_FLAGS = REMOTE ? ['--remote'] : ['--local', '--persist-to', PERSIST_TO];

function d1Query(sql) {
  const flat = sql.replace(/\s+/g, ' ').trim();
  try {
    const out = execFileSync('npx', ['wrangler', 'd1', 'execute', DB_NAME, ...TARGET_FLAGS, '--json', '--command', flat],
      { cwd: ROOT, maxBuffer: 1024 * 1024 * 256, stdio: ['ignore', 'pipe', 'pipe'] });
    return JSON.parse(out.toString('utf8'))[0].results;
  } catch (err) {
    // En sık iki neden: (a) script uzak/izole bir oturumda çalışıyor (wrangler oturumu ve ağ yok —
    // bkz. dosya başı), (b) --remote unutuldu ve yerel dev D1 yok. İkisini de açıkça söyle.
    const detail = String((err && err.stderr && err.stderr.toString()) || err.message || '').trim().split('\n').slice(0, 4).join('\n    ');
    throw new Error(
      `D1 sorgusu çalıştırılamadı (${REMOTE ? '--remote' : 'yerel dev D1'}).\n` +
      '  Bu script, wrangler oturumu ve açık ağı olan YEREL makinede çalıştırılmalıdır.\n' +
      `    ${detail}`
    );
  }
}

function sqlStr(v) { return `'${String(v).replace(/'/g, "''")}'`; }

// --------------------------------------------------------------------------------------------
// 1) Referans adları
// --------------------------------------------------------------------------------------------
// Sayfa yapısına DAYANMAYAN bir çıkarım: /referansdetay?id=N bağlantılarının metni. Liste sunucuda
// render edilmiyorsa (JS ile doluyorsa) hiç bağlantı bulunamaz — o durumda --scan-ids ya da
// --html ile devam edilir, script kendi kendine tahmin ÜRETMEZ.
function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function textOf(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (MIMARLAB reference sync)' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return await res.text();
}

function namesFromListHtml(html) {
  const found = new Map(); // id -> ad
  const re = /<a\b[^>]*href="[^"]*referansdetay\?id=(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const name = textOf(m[2]);
    if (name && !found.has(m[1])) found.set(m[1], name);
  }
  return found;
}

function nameFromDetailHtml(html) {
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (h1) { const t = textOf(h1[1]); if (t) return t; }
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (title) return textOf(title[1]).replace(/\s*[|–-]\s*Ytong.*$/i, '').trim();
  return '';
}

async function collectReferenceNames() {
  const names = new Map(); // id (ya da 'html:n') -> ad
  if (HTML_FILE) {
    const html = readFileSync(path.resolve(HTML_FILE), 'utf8');
    for (const [id, name] of namesFromListHtml(html)) names.set(id, name);
    if (!names.size) throw new Error(`${HTML_FILE} içinde referansdetay bağlantısı bulunamadı.`);
    return names;
  }
  if (SCAN_IDS) {
    const [from, to] = SCAN_IDS.split('-').map((n) => Number(n.trim()));
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) throw new Error('--scan-ids=1-160 biçiminde olmalı.');
    for (let id = from; id <= to; id++) {
      try {
        const name = nameFromDetailHtml(await fetchText(DETAIL_URL(id)));
        if (name) { names.set(String(id), name); process.stdout.write(`\r  id=${id} ${name.slice(0, 50)}                 `); }
      } catch { /* boş/olmayan id — atla */ }
    }
    process.stdout.write('\n');
    return names;
  }
  const html = await fetchText(LIST_URL);
  for (const [id, name] of namesFromListHtml(html)) names.set(id, name);
  if (!names.size) {
    throw new Error(
      'Referans listesi sayfanın HTML\'inde bulunamadı (muhtemelen JS ile yükleniyor).\n' +
      '  Çözüm A: sayfayı tarayıcıda açıp "Farklı kaydet" ile kaydedin ve --html=<dosya> ile verin.\n' +
      '  Çözüm B: --scan-ids=1-160 ile detay sayfalarını tek tek gezin.'
    );
  }
  return names;
}

// --------------------------------------------------------------------------------------------
// 2) MİMARLAB tarafı
// --------------------------------------------------------------------------------------------
// Ytong markası offices tablosunda bir MARKA satırıdır (bkz. src/lib/officeUrl.js#officePath —
// ürünü olan firma /marka/:slug'ta açılır). name_fold generated kolonu üzerinden aranır (bkz.
// migrations/0079_search_fold_columns.sql) — JS foldTr ile BİREBİR aynı çıktıyı üretir.
function findYtongOffice() {
  const rows = d1Query(`SELECT id, slug, name, name_fold FROM offices WHERE deleted_at IS NULL AND name_fold LIKE '%ytong%'`);
  if (!rows.length) throw new Error('offices tablosunda "Ytong" bulunamadı — marka önce MİMARLAB\'a eklenmeli.');
  const exact = rows.find((r) => r.name_fold === 'ytong');
  if (exact) return exact;
  if (rows.length === 1) return rows[0];
  throw new Error(`Birden fazla aday: ${rows.map((r) => `${r.id}:${r.name}`).join(', ')} — hangisi olduğunu netleştirin.`);
}

// Başlık sonundaki jenerik ekler ("Projesi", "İnşaatı") referans adında olup proje başlığında
// olmayabiliyor; İKİNCİ bir katlanmış anahtar olarak denenir (birebir eşleşme kuralını gevşetmez,
// yalnızca aynı ismin iki yazımını birleştirir).
const GENERIC_TAIL = /\s+(projesi|proje|inşaatı|insaati|yapısı|yapisi|binası|binasi)$/i;
function foldKeys(raw) {
  const base = foldTr(raw);
  const keys = new Set([base]);
  const trimmed = foldTr(String(raw).replace(GENERIC_TAIL, ''));
  if (trimmed) keys.add(trimmed);
  return [...keys].filter(Boolean);
}

// --------------------------------------------------------------------------------------------
console.log(`Ytong referansları okunuyor (${HTML_FILE ? HTML_FILE : SCAN_IDS ? 'detay taraması' : LIST_URL})...`);
const references = await collectReferenceNames();
console.log(`  ${references.size} referans adı bulundu.`);

console.log(`MİMARLAB projeleri okunuyor (${REMOTE ? 'PROD' : 'yerel dev D1'})...`);
const ytong = findYtongOffice();
console.log(`  Marka: #${ytong.id} ${ytong.name} (/${ytong.slug})`);
const projects = d1Query(`SELECT id, slug, title FROM projects WHERE deleted_at IS NULL AND hidden_at IS NULL`);
console.log(`  ${projects.length} yayında proje.`);
const existing = new Set(
  d1Query(`SELECT project_id FROM project_brands WHERE office_id = ${ytong.id}`).map((r) => String(r.project_id))
);

const byFold = new Map();
for (const p of projects) {
  for (const key of foldKeys(p.title)) {
    if (!byFold.has(key)) byFold.set(key, []);
    byFold.get(key).push(p);
  }
}

const matches = [];          // { ref, project }
const review = [];           // { ref, candidates } — elle bakılacak
const missing = [];          // MİMARLAB'da hiç karşılığı olmayan referanslar
for (const ref of references.values()) {
  const keys = foldKeys(ref);
  const exact = keys.flatMap((k) => byFold.get(k) || []);
  if (exact.length === 1) { matches.push({ ref, project: exact[0] }); continue; }
  if (exact.length > 1) { review.push({ ref, candidates: exact, why: 'aynı başlıktan birden fazla proje' }); continue; }
  // Yakın adaylar: katlanmış başlık referans adını (ya da tersi) İÇERİYOR. Kısa/jenerik adlarda
  // ("Nergis İnşaat") bu kural çöp üretir, bu yüzden en az 10 karakter şartı var.
  const key = keys[0];
  const near = key.length >= 10
    ? projects.filter((p) => { const t = foldTr(p.title); return t.includes(key) || key.includes(t); })
    : [];
  if (near.length === 1 && FUZZY) matches.push({ ref, project: near[0], fuzzy: true });
  else if (near.length) review.push({ ref, candidates: near, why: FUZZY ? 'birden fazla yakın aday' : 'yakın eşleşme (--fuzzy ile kabul edilir)' });
  else missing.push(ref);
}

const fresh = matches.filter((m) => !existing.has(String(m.project.id)));
const already = matches.length - fresh.length;

console.log('');
console.log(`EŞLEŞEN     : ${matches.length} (yeni ${fresh.length}, zaten bağlı ${already})`);
console.log(`İNCELENECEK : ${review.length}`);
console.log(`MİMARLAB'DA YOK: ${missing.length}`);
console.log('');
for (const m of fresh) console.log(`  + ${m.ref}  ->  /proje/${m.project.slug}${m.fuzzy ? '   [fuzzy]' : ''}`);
if (review.length) {
  console.log('\nİncelenecek (SQL\'e YAZILMADI):');
  for (const r of review) console.log(`  ? ${r.ref}  (${r.why}): ${r.candidates.slice(0, 4).map((c) => c.slug).join(', ')}`);
}
if (missing.length) console.log(`\nMİMARLAB'da bulunamayan referanslar:\n  - ${missing.join('\n  - ')}`);

if (!fresh.length) {
  console.log('\nYazılacak yeni bağlantı yok — SQL üretilmedi.');
  process.exit(0);
}

// project_brands: markanın ÜRÜNSÜZ kullanım kenarı (bkz. migrations/0085_project_brands.sql) —
// istek "ürün eklemene gerek yok" dediği için tam olarak bu tablo kullanılır, project_products DEĞİL.
// element NULL: künyede yapı elemanı satırı gösterilmez, yalnızca "Kullanılan Markalar"da görünür.
const lines = [
  `-- Ytong referansları -> project_brands (kullanıcı isteği, 2026-09-12 madde 2).`,
  `-- Üreten: scripts/attach-ytong-references.mjs  (${new Date().toISOString()})`,
  `-- Kaynak: ${HTML_FILE || (SCAN_IDS ? `referansdetay id ${SCAN_IDS}` : LIST_URL)}`,
  `-- Marka: offices #${ytong.id} ${ytong.name}`,
  `-- Uygula: npx wrangler d1 execute ${DB_NAME} --remote --file=scripts/output/ytong-project-brands.sql`,
  '',
];
for (const m of fresh) {
  lines.push(`-- ${m.ref} -> ${m.project.title}${m.fuzzy ? ' [fuzzy]' : ''}`);
  lines.push(`INSERT OR IGNORE INTO project_brands (project_id, office_id, element, source) VALUES (${m.project.id}, ${ytong.id}, NULL, 'admin'); -- ${sqlStr(m.project.slug)}`);
}
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, lines.join('\n') + '\n', 'utf8');
console.log(`\nSQL yazıldı: ${path.relative(ROOT, OUT_FILE)} (${fresh.length} satır)`);
console.log('İncele, sonra uygula:');
console.log(`  npx wrangler d1 execute ${DB_NAME} --remote --file=scripts/output/ytong-project-brands.sql`);
