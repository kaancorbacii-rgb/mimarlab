#!/usr/bin/env node
// GÜNDEM: MEVCUT YAYINLARI YENİDEN ETİKETLE (kullanıcı isteği, 2026-09-07: "Foster + Partners'ı
// etiketlediğin gibi ilgili olan TÜM gönderilere etiketlemeler yap").
//
// DURUM: canlıdaki 205 yayının yalnızca 10'unda etiket vardı. Sebep eşleştirme değil, ÖNERİ:
// eski hat yalnızca AI'nin `entities` alanına bakıyordu ve model çoğu özette hiç ad önermiyordu.
// Hat artık metin taramasıyla da destekleniyor (bkz. gundemEntities.js#scanTextForEntities) ama
// bu YALNIZCA yeni içeriğe uygulanır; bu betik aynı taramayı GEÇMİŞ yayınlara uygular.
//
// MANTIK KOPYALANMAZ: tarama ve dizin kurma, canlı hattın kullandığı AYNI fonksiyonlardan import
// edilir. Kural da aynı kalır — yalnızca D1'de VAR OLAN bir kaydın adı, metinde TAM KELİME olarak
// geçiyorsa kenar yazılır; yeni entity yaratılmaz, bulanık eşleştirme yapılmaz.
//
// KULLANIM: node scripts/gundem-retag-entities.mjs [--dry-run]

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { buildGundemEntityIndex, scanTextForEntities } from '../src/lib/gundemEntities.js';

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
    try { const m = readFileSync(p, 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/); if (m) return m[1]; }
    catch { /* sıradaki */ }
  }
  throw new Error('wrangler OAuth token bulunamadı — `npx wrangler login` çalıştırın.');
}
const H = { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' };
async function d1(sql, params = []) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
    { method: 'POST', headers: H, body: JSON.stringify({ sql, params }) });
  const json = await res.json();
  if (!json.success) throw new Error(JSON.stringify(json.errors));
  return json.result[0].results || [];
}

// Havuzlar — canlıda KV önbellekli okuyucular kullanılır; burada aynı alanlar doğrudan D1'den.
// `cats`/`productCount` yalnızca saf-marka mı firma mı ayrımı (kanonik URL öneki) için gerekli.
const [offices, architects, projects, products] = await Promise.all([
  d1(`SELECT o.slug, o.name, o.cats,
        (SELECT COUNT(*) FROM products pr WHERE pr.brand_office_id = o.id AND pr.deleted_at IS NULL AND pr.hidden_at IS NULL) AS productCount
      FROM offices o WHERE o.deleted_at IS NULL AND o.hidden_at IS NULL`),
  d1(`SELECT slug, name FROM architects WHERE deleted_at IS NULL AND hidden_at IS NULL`),
  d1(`SELECT slug, title FROM projects WHERE deleted_at IS NULL AND hidden_at IS NULL`),
  d1(`SELECT slug, title FROM products WHERE deleted_at IS NULL AND hidden_at IS NULL`),
]);
const index = buildGundemEntityIndex({ offices, architects, projects, products });
console.log(`Dizin: ${offices.length} firma, ${architects.length} kişi, ${projects.length} proje, ${products.length} ürün`);

const items = await d1(`SELECT id, slug, title, summary FROM gundem_items WHERE status = 'published'`);
const existing = await d1(`SELECT item_id, entity_type, entity_key FROM gundem_entities`);
const have = new Set(existing.map(r => `${r.item_id}|${r.entity_type}|${r.entity_key}`));
console.log(`Yayın: ${items.length} | mevcut kenar: ${existing.length}${DRY ? '  [DRY-RUN]' : ''}\n`);

const now = Date.now();
let added = 0;
const perType = {};
for (const it of items) {
  const found = scanTextForEntities(index, `${it.title} ${it.summary || ''}`);
  const fresh = found.filter(e => !have.has(`${it.id}|${e.type}|${e.key}`));
  if (!fresh.length) continue;
  console.log(`  ${it.title.slice(0, 58).padEnd(60)} -> ${fresh.map(e => e.name).join(', ')}`);
  for (const e of fresh) {
    perType[e.type] = (perType[e.type] || 0) + 1;
    added++;
    if (!DRY) {
      await d1(
        `INSERT OR IGNORE INTO gundem_entities (item_id, entity_type, entity_key, entity_name, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [it.id, e.type, e.key, e.name, now]
      );
    }
  }
}
console.log(`\nEklenen kenar: ${added}  ${JSON.stringify(perType)}${DRY ? '  [DRY-RUN — yazılmadı]' : ''}`);
