#!/usr/bin/env node
// GERİYE DÖNÜK relisted_at NORMALİZASYONU (kullanıcı isteği, 2026-09-10 yedinci tur madde 5).
//
// SORUN: liste sıralaması `relisted_at DESC` ile BAŞLIYOR (bkz. migrations/0108_relisted_at.sql,
// src/lib/projectPool.js) — damgalanan HER satır tüm canlı içeriğin önüne geçiyor. Bir atama 11
// projeyi birden yayına aldığında 11'i de 1. sayfaya oturuyor, sitenin geri kalanını aşağı itiyordu
// (canlıda 2026-09-10'da iki atama peş peşe tam olarak bunu yaptı).
//
// KURAL (src/routes/admin.js#unpreviewByIds artık YENİ atamalarda bunu uyguluyor; bu betik AYNI
// kuralı ZATEN OLUŞMUŞ damgalara uygular): aynı `relisted_at` değerini paylaşan her parti tek bir
// toplu yayına alma işlemidir; partide yalnızca EN SON EKLENEN kayıt (en yüksek id — kayıtlar
// kronolojik eklenir) damgalı kalır, kalanların relisted_at'i NULL yapılır ve doğal sıralarına
// (display_order + yayın tarihi) düşerler.
//
// KULLANIM:
//   node scripts/normalize-relisted.mjs --dry-run
//   node scripts/normalize-relisted.mjs
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const ACCOUNT_ID = '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';
const DRY = process.argv.includes('--dry-run');
const TABLES = [['projects', 'title'], ['products', 'title'], ['architects', 'name'], ['offices', 'name']];

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

let cleared = 0;
for (const [table, titleCol] of TABLES) {
  const rows = await q(
    `SELECT id, ${titleCol} AS t, relisted_at FROM ${table}
      WHERE relisted_at IS NOT NULL AND hidden_at IS NULL AND deleted_at IS NULL`
  );
  const batches = new Map();
  for (const r of rows) {
    if (!batches.has(r.relisted_at)) batches.set(r.relisted_at, []);
    batches.get(r.relisted_at).push(r);
  }
  const toClear = [];
  for (const [stamp, group] of batches) {
    if (group.length < 2) continue;
    const keep = group.reduce((a, b) => (b.id > a.id ? b : a));
    console.log(`${table} @ ${stamp}: ${group.length} kayıt — başta kalan "${keep.t}", ${group.length - 1} kayıt doğal sıraya`);
    for (const r of group) if (r.id !== keep.id) toClear.push(r.id);
  }
  if (!toClear.length) { console.log(`${table}: düzeltilecek parti yok (${rows.length} damgalı kayıt)`); continue; }
  cleared += toClear.length;
  if (DRY) continue;
  for (let i = 0; i < toClear.length; i += 40) {
    const chunk = toClear.slice(i, i + 40);
    await q(`UPDATE ${table} SET relisted_at = NULL WHERE id IN (${chunk.map(() => '?').join(', ')})`, chunk);
  }
}

console.log(`\n${cleared} kaydın relisted_at damgası kaldırıldı${DRY ? ' (DRY-RUN)' : ''}. (${queryCount} D1 sorgusu)`);
if (!DRY) console.log('NOT: KV havuz anahtarları (pool:*) elle temizlenmeli.');
