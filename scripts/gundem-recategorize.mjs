#!/usr/bin/env node
// GÜNDEM KATEGORİ YENİDEN DEĞERLENDİRME (kullanıcı isteği, 2026-09-07: "categoryHints yaz,
// kategoriler düzelsin").
//
// NEDEN GEREKLİ: categoryHints yalnızca YENİ toplanan içeriğe uygulanır. Kurallar yazılmadan önce
// yayınlanmış kayıtlar (canlıda 200+) eski kategorilerinde kalır — kural yazmak tek başına
// "kategoriler düzelsin" isteğini karşılamaz.
//
// NASIL: kayıtların KAYNAK DİLİNDEKİ başlığı (gundem_items.original_title) ve kaynağın kendi
// categoryHints kuralları kullanılır — yani canlı hattın uyguladığı MANTIĞIN AYNISI, aynı
// dosyadan import edilerek. Burada kural KOPYALANMAZ (bu depodaki "aynı mantık iki yerde, biri
// ayrıştı" tuzağı).
//
// SINIR — BİLİNÇLİ: bir kural EŞLEŞMEZSE satıra DOKUNULMAZ. Eşleşmeyeni kaynağın
// defaultCategory'sine çekmek, AI'nin doğru atadığı kategorileri (ör. Architects' Journal'ın
// 'gorus' kayıtları) silip süpürürdü. Bu betik yalnızca "kural artık kesin bir şey söylüyor"
// durumunu uygular.
//
// Feed'in <category> etiketleri D1'de SAKLANMADIĞI için yalnızca BAŞLIK kuralları ({on:'title'})
// değerlendirilebilir; etiket kuralları bu betikte atlanır (yeni içerikte normal çalışırlar).
//
// KULLANIM: node scripts/gundem-recategorize.mjs [--dry-run]

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { GUNDEM_SOURCES } from '../src/lib/gundemSources.js';

const ACCOUNT_ID = '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';
const DRY = process.argv.includes('--dry-run');

const TOKEN_PATHS = [
  `${homedir()}/Library/Preferences/.wrangler/config/default.toml`,
  `${homedir()}/.wrangler/config/default.toml`,
  `${homedir()}/.config/.wrangler/config/default.toml`,
];
function token() {
  for (const p of TOKEN_PATHS) {
    try {
      const m = readFileSync(p, 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    } catch { /* sıradaki yol */ }
  }
  throw new Error('wrangler OAuth token bulunamadı — `npx wrangler login` çalıştırın.');
}
const TOKEN = token();

async function d1(sql, params = []) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
    { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }) }
  );
  const json = await res.json();
  if (!json.success) throw new Error(JSON.stringify(json.errors));
  return json.result[0].results || [];
}

const sourceById = new Map(GUNDEM_SOURCES.map(s => [s.id, s]));

const rows = await d1(
  `SELECT id, source_id, category, title, original_title FROM gundem_items WHERE status = 'published'`
);
console.log(`Değerlendirilen kayıt: ${rows.length}${DRY ? '  [DRY-RUN]' : ''}\n`);

const changes = [];
for (const row of rows) {
  const source = sourceById.get(row.source_id);
  if (!source) continue;
  // Kaynak dilindeki başlık yoksa (eski kayıtlar) Türkçe başlığa düşülür — Türkçe kaynaklarda
  // ikisi zaten aynı dildedir, İngilizce kaynaklarda EN kuralları eşleşmez ve satır atlanır.
  const title = row.original_title || row.title;
  if (!title) continue;
  for (const hint of source.categoryHints || []) {
    if (hint.on !== 'title') continue;
    if (!hint.match.test(title)) continue;
    if (hint.category !== row.category) changes.push({ ...row, from: row.category, to: hint.category, title });
    break;
  }
}

if (!changes.length) { console.log('Değişecek kayıt yok.'); process.exit(0); }
const bySource = {};
for (const c of changes) {
  bySource[c.source_id] = bySource[c.source_id] || {};
  const k = `${c.from} -> ${c.to}`;
  bySource[c.source_id][k] = (bySource[c.source_id][k] || 0) + 1;
  console.log(`  ${c.from} -> ${c.to}  [${c.source_id}]  ${c.title.slice(0, 78)}`);
}
console.log('\nKAYNAK KIRILIMI');
for (const [sid, m] of Object.entries(bySource)) console.log(`  ${sid.padEnd(22)} ${JSON.stringify(m)}`);
console.log(`\nTOPLAM: ${changes.length} kayıt`);

if (DRY) { console.log('\nDRY-RUN — hiçbir şey yazılmadı.'); process.exit(0); }
// updated_at DA tazelenir — bu isteğe bağlı bir ayrıntı değil: /api/gundem'in edge önbelleği
// tazeliği `COUNT(*) + MAX(updated_at)` parmak iziyle doğruluyor (bkz. src/routes/gundem.js
// #gundemListFingerprint). Yalnızca category yazılsaydı parmak izi DEĞİŞMEZ, önbellek kendini
// hâlâ güncel sanar ve düzeltilmiş kategoriler sitede görünmezdi.
const now = Date.now();
for (const c of changes) {
  await d1('UPDATE gundem_items SET category = ?, updated_at = ? WHERE id = ?', [c.to, now, c.id]);
}
console.log(`\n${changes.length} kayıt güncellendi.`);
