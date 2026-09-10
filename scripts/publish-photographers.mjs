#!/usr/bin/env node
// FOTOĞRAFÇI PROFİLLERİNİ CANLIYA AL (kullanıcı isteği, 2026-09-10 yedinci tur madde 1).
//
// KAPSAM — `architects.profession` etiketi "Fotoğrafçı" İÇEREN, ÖNİZLEME ("soluk") durumundaki
// kayıtlar. profession, kisi-ekle.html'in çoklu meslek kutusundan gelen HAM Türkçe etikettir
// ("Mimar, Fotoğrafçı", bkz. profession-shared.js) — bu yüzden eşleşme alt dize ile yapılır.
//
// KAPSAM DIŞI, BİLEREK: `project_photographers` üzerinden bir projeye fotoğrafçı olarak bağlı ama
// profession etiketi "Fotoğrafçı" OLMAYAN kişiler (canlıda 43 kişi). Bunların çoğu mimar
// (ör. "Cem Sorguç", "Celal Abdi Güzer") — bir projesinin fotoğrafını çekmiş olmaları onları
// fotoğrafçı profili yapmaz ve bu betikle yayına alınmaları, kullanıcının önizlemede TUTMAYI
// seçtiği mimar profillerini sessizce açardı.
//
// SIRALAMA (kullanıcı isteği, AYNI turun madde 5 kuralı): partide yalnızca EN SON EKLENEN kayıt
// `relisted_at` ile damgalanır (liste başına oturur), kalanların relisted_at'i NULL bırakılır ve
// doğal sıralarına düşerler — bkz. src/routes/admin.js#unpreviewByIds'teki AYNI kural ve gerekçe
// (damgalanan her satır TÜM canlı içeriğin önüne geçtiğinden, 34 kaydı birden damgalamak /kisi'nin
// ilk sayfasını tamamen doldururdu).
//
// KULLANIM:
//   node scripts/publish-photographers.mjs --dry-run
//   node scripts/publish-photographers.mjs
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

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
    try { const m = readFileSync(p, 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/); if (m) return m[1]; } catch { /* sıradaki yol */ }
  }
  throw new Error('wrangler OAuth token bulunamadı — `npx wrangler login` çalıştırın.');
}
const TOKEN = token();

let queryCount = 0;
async function q(sql, params = []) {
  queryCount++;
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
    { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }) }
  );
  const json = await res.json().catch(() => null);
  if (!json || !json.success) throw new Error(`D1 hatası: ${JSON.stringify((json && json.errors) || res.status)}`);
  return json.result[0].results || [];
}

const rows = await q(
  `SELECT id, name, slug, profession FROM architects
    WHERE deleted_at IS NULL AND preview_at IS NOT NULL AND profession LIKE '%Fotoğrafçı%'
    ORDER BY id`
);
console.log(`Önizlemede ${rows.length} fotoğrafçı profili bulundu.`);
for (const r of rows) console.log(`  · ${r.name} (${r.profession})`);
if (!rows.length) process.exit(0);

const ids = rows.map(r => r.id);
const newest = Math.max(...ids);                       // "en son paylaşılan" — liste başına
const rest = ids.filter(id => id !== newest);          // doğal sıralarına düşer
console.log(`\nListe başına: ${rows.find(r => r.id === newest).name}`);
console.log(`Doğal sıraya dağılacak: ${rest.length} kayıt`);

if (DRY) { console.log(`\n[DRY-RUN] Hiçbir şey değiştirilmedi. (${queryCount} D1 sorgusu)`); process.exit(0); }

const now = new Date().toISOString();
await q(`UPDATE architects SET hidden_at = NULL, preview_at = NULL, relisted_at = ? WHERE id = ?`, [now, newest]);
for (let i = 0; i < rest.length; i += 40) {
  const chunk = rest.slice(i, i + 40);
  await q(
    `UPDATE architects SET hidden_at = NULL, preview_at = NULL, relisted_at = NULL WHERE id IN (${chunk.map(() => '?').join(', ')})`,
    chunk,
  );
}

// Arşiv taslakları da 'approved' olmalı — aksi halde kayıt CANLI olduğu hâlde taslağı arşivde
// kalır ve düzenleme formunda telif kutucuğu boş açılır (bkz. src/routes/admin.js#
// approveArchivedDraftsAndRecordRights'taki AYNI gerekçe). Telif BEYANI kaydı burada DÜŞMEZ:
// ortada beyanı üstlenecek bir kullanıcı yok (bu bir admin toplu işlemi).
const names = rows.map(r => r.name);
for (let i = 0; i < names.length; i += 40) {
  const chunk = names.slice(i, i + 40);
  await q(
    `UPDATE architect_submissions SET status = 'approved', updated_at = ?
      WHERE status = 'archived' AND claimed_profile_key IN (${chunk.map(() => '?').join(', ')})`,
    [Date.now(), ...chunk],
  );
}

const check = await q(`SELECT COUNT(*) AS n FROM architects WHERE deleted_at IS NULL AND preview_at IS NOT NULL AND profession LIKE '%Fotoğrafçı%'`);
console.log(`\nBitti. Önizlemede kalan fotoğrafçı: ${check[0].n} (${queryCount} D1 sorgusu)`);
console.log('NOT: KV havuz anahtarları (pool:*) elle temizlenmeli — bkz. [[project_pool_cache_needs_manual_purge_after_query_logic_deploy]].');
