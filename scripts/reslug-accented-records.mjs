#!/usr/bin/env node
// TEK SEFERLİK VERİ DÜZELTMESİ (kullanıcı isteği, 2026-09-08): slugify aksanlı harfleri eskiden
// KATLAMIYOR, DÜŞÜRÜYORDU (bkz. src/lib/slugify.js#TR_MAP'teki not) — "Celâleddin Çelik"
// /kisi/cel-leddin-celik, "José Bruguera" /kisi/jos-bruguera olmuştu. Harita düzeltildi ama
// canonical satırlardaki slug'lar OLDUĞU GİBİ kaldı: bu betik yalnızca ESKİ ALGORİTMANIN ÜRETTİĞİ
// slug'ları yeni algoritmanınkiyle değiştirir ve her biri için slug_redirects'e 301 kaydı yazar.
//
// GÜVENLİK KURALI (önemli): elle/import ile verilmiş slug'lara DOKUNULMAZ. Bu depoda slug'ın
// isimden türemediği kayıtlar var (bkz. proje notu: "legacy_static slug ≠ slugify(title)" — eski
// migration'ın şehir sonekli slug'ları). Bu yüzden bir satır ancak `slug === slugifyEski(ad)` ya da
// `slug === slugifyEski(ad) + '-<sonek>'` ise güncellenir; aksi halde atlanır. Canlıda bu kural
// "Privé Kemer" (slug zaten prive-kemer), "Yapay Zekâ Müzesi" ve "Dış Mekân" kayıtlarını doğru
// şekilde kapsam dışında bıraktı.
//
// Kullanım:
//   node scripts/reslug-accented-records.mjs            # yalnızca RAPOR (hiçbir şey yazmaz)
//   node scripts/reslug-accented-records.mjs --apply    # SQL üretir ve stdout'a basar
// Üretilen SQL şu şekilde uygulanır:
//   npx wrangler d1 execute mimarlab-db --remote --file=<dosya>

import { execFileSync } from 'node:child_process';
import { slugify } from '../src/lib/slugify.js';

// Düzeltmeden ÖNCEKİ harita — sapmayı tespit edebilmek için burada KASITLI olarak dondurulmuştur;
// src/lib/slugify.js'ten import EDİLEMEZ (o artık yeni davranışı üretiyor).
const OLD_TR_MAP = { 'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'I': 'i', 'İ': 'i', 'ö': 'o', 'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u' };
function slugifyOld(text) {
  return (text || '').split('').map(ch => OLD_TR_MAP[ch] || ch).join('')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const TABLES = [
  { table: 'architects', entityType: 'architects', nameCol: 'name' },
  { table: 'offices', entityType: 'offices', nameCol: 'name' },
  { table: 'projects', entityType: 'projects', nameCol: 'title' },
  { table: 'products', entityType: 'products', nameCol: 'title' },
];

function d1(sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'mimarlab-db', '--remote', '--json', '--command', sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const start = out.indexOf('[');
  let depth = 0, end = null;
  for (let i = start; i < out.length; i++) {
    if (out[i] === '[') depth++;
    else if (out[i] === ']' && --depth === 0) { end = i + 1; break; }
  }
  return JSON.parse(out.slice(start, end))[0].results;
}

const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

const plan = [];
for (const { table, entityType, nameCol } of TABLES) {
  const rows = d1(`SELECT id, slug, ${nameCol} AS n FROM ${table} WHERE deleted_at IS NULL`);
  for (const r of rows) {
    const oldS = slugifyOld(r.n), newS = slugify(r.n);
    if (!oldS || oldS === newS) continue;             // aksan yoksa eski/yeni aynı
    if (!r.slug.startsWith(oldS)) continue;           // slug isimden TÜREMEMİŞ — dokunma
    const suffix = r.slug.slice(oldS.length);
    if (suffix && !suffix.startsWith('-')) continue;  // rastlantısal önek eşleşmesi — dokunma
    plan.push({ table, entityType, id: r.id, name: r.n, from: r.slug, to: newS + suffix });
  }
}

if (!plan.length) { console.error('Güncellenecek kayıt yok.'); process.exit(0); }

// Çakışma kontrolü: hedef slug başka bir satırda kullanılıyorsa (UNIQUE kısıtı) o satır atlanır.
const conflicts = [];
for (const p of plan) {
  const [hit] = d1(`SELECT id FROM ${p.table} WHERE slug = ${q(p.to)} AND id != ${q(p.id)}`);
  if (hit) conflicts.push(p);
}
const doable = plan.filter(p => !conflicts.includes(p));

console.error(`Güncellenecek: ${doable.length}, çakışma nedeniyle atlanan: ${conflicts.length}`);
for (const p of doable) console.error(`  ${p.table}#${p.id}  ${p.from}  ->  ${p.to}   (${p.name})`);
for (const p of conflicts) console.error(`  ATLANDI (slug dolu) ${p.table}#${p.id} ${p.from} -> ${p.to}`);

if (!process.argv.includes('--apply')) { console.error('\n(rapor modu — SQL üretmek için --apply)'); process.exit(0); }

const sql = [];
for (const p of doable) {
  sql.push(`UPDATE ${p.table} SET slug = ${q(p.to)}, updated_at = datetime('now') WHERE id = ${q(p.id)};`);
  // Zincir kırma — src/lib/slugRedirects.js#recordSlugRedirect ile AYNI üç adım: (1) eskiden bu
  // slug'a işaret eden kayıtları doğrudan yeniye çevir, (2) yeni slug bir başka kaydın old_slug'ıysa
  // o bayat satırı sil, (3) eski -> yeni kaydını yaz.
  sql.push(`UPDATE slug_redirects SET new_slug = ${q(p.to)}, created_at = datetime('now') WHERE entity_type = ${q(p.entityType)} AND new_slug = ${q(p.from)};`);
  sql.push(`DELETE FROM slug_redirects WHERE entity_type = ${q(p.entityType)} AND old_slug = ${q(p.to)};`);
  sql.push(`INSERT INTO slug_redirects (entity_type, old_slug, new_slug) VALUES (${q(p.entityType)}, ${q(p.from)}, ${q(p.to)}) ON CONFLICT(entity_type, old_slug) DO UPDATE SET new_slug = excluded.new_slug, created_at = datetime('now');`);
  // Slug ile anahtarlanan yan tablolar. saved_items/ratings/comments/shared_items mimar/firma için
  // ADI anahtar olarak kullanır (bkz. officeFounderCascade.js#renameOfficeEverywhere) — ad
  // değişmediğinden onlara dokunulmaz. follows.followed_key ve analytics_daily.subject_key ise
  // slugify(ad) taşır.
  const followType = { architects: 'architect', offices: 'office', projects: 'project', products: 'product' }[p.table];
  sql.push(`UPDATE OR IGNORE follows SET followed_key = ${q(p.to)} WHERE followed_type = ${q(followType)} AND followed_key = ${q(p.from)};`);
  sql.push(`UPDATE OR IGNORE analytics_daily SET subject_key = ${q(p.to)} WHERE subject_type = ${q(followType)} AND subject_key = ${q(p.from)};`);
}
console.log(sql.join('\n'));
