#!/usr/bin/env node
// GÜNDEM: MEVCUT KAYITLARI GÖM + ANLAMSAL MÜKERRERLERİ BİRLEŞTİR (kullanıcı isteği, 2026-09-07).
//
// İKİ İŞ, TEK GEÇİŞ:
//   1. embedding kolonu boş olan her yayınlanmış kaydı @cf/baai/bge-m3 ile gömer. Bu olmadan yeni
//      anlamsal kapı GEÇMİŞ içeriğe karşı çalışamaz — yarın gelen bir haber, bugün yayınlanmış
//      mükerreriyle karşılaştırılamazdı.
//   2. Eşiği geçen kümeleri birleştirir: en ESKİ kayıt birincil kalır, diğerlerinin kaynağı
//      birincilin extra_sources'ına eklenir, entity kenarları birincile taşınır ve kendileri
//      ARŞİVLENİR (silinmez).
//
// NEDEN SİLMEK DEĞİL ARŞİVLEMEK: source_url UNIQUE'tir ve mükerrer kontrolünün 1. basamağıdır.
// Satır silinseydi aynı URL bir sonraki turda YENİDEN toplanır ve mükerrer geri gelirdi. Arşiv,
// satırı listeden çıkarır ama "bu adresi zaten gördük" bilgisini korur — sistemdeki mevcut
// "Arşivle" eyleminin (bkz. src/routes/gundemAdmin.js) tam olarak var oluş sebebi budur.
//
// KULLANIM: node scripts/gundem-dedupe-backfill.mjs [--dry-run] [--threshold=0.82]

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  gundemEmbedText, quantizeEmbedding, dequantizeEmbedding, cosineSimilarity,
  GUNDEM_DUPLICATE_THRESHOLD, GUNDEM_EMBED_MODEL,
} from '../src/lib/gundemEmbedding.js';

const ACCOUNT_ID = '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const DRY = !!args['dry-run'];
const THRESHOLD = Number(args.threshold ?? GUNDEM_DUPLICATE_THRESHOLD);

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
const TOKEN = token();
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function d1(sql, params = []) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
    { method: 'POST', headers: H, body: JSON.stringify({ sql, params }) });
  const json = await res.json();
  if (!json.success) throw new Error(JSON.stringify(json.errors));
  return json.result[0].results || [];
}

// Toplu gömme — tek tek çağırmak 200+ istek demek olurdu.
async function embedBatch(texts) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${GUNDEM_EMBED_MODEL}`,
    { method: 'POST', headers: H, body: JSON.stringify({ text: texts }) });
  const json = await res.json();
  if (!json.success) throw new Error(JSON.stringify(json.errors).slice(0, 300));
  return json.result.data || json.result.response;
}

const rows = await d1(
  `SELECT id, slug, title, summary, source_name, source_domain, source_url, published_at,
          source_published_at, extra_sources, embedding
   FROM gundem_items WHERE status = 'published' ORDER BY published_at ASC`
);
console.log(`Yayınlanmış kayıt: ${rows.length}${DRY ? '  [DRY-RUN]' : ''}   eşik: ${THRESHOLD}\n`);

// --- 1) GÖMME ---------------------------------------------------------------------------------
const missing = rows.filter(r => !r.embedding);
console.log(`Gömme gerekiyor: ${missing.length}`);
for (let i = 0; i < missing.length; i += 40) {
  const chunk = missing.slice(i, i + 40);
  const vecs = await embedBatch(chunk.map(r => gundemEmbedText(r.title, r.summary)));
  for (let k = 0; k < chunk.length; k++) {
    const q = quantizeEmbedding(vecs[k]);
    chunk[k].embedding = q;
    // updated_at'e DOKUNULMAZ: embedding kullanıcıya görünen bir alan değil, önbelleği tazelemek
    // için sayfayı yeniden üretmenin bir anlamı yok.
    if (!DRY) await d1('UPDATE gundem_items SET embedding = ? WHERE id = ?', [q, chunk[k].id]);
  }
  process.stdout.write(`  gömüldü ${Math.min(i + 40, missing.length)}/${missing.length}\r`);
}
console.log(`  gömüldü ${missing.length}/${missing.length}      `);

// --- 2) KÜMELEME ------------------------------------------------------------------------------
// Satırlar published_at ARTAN sırada; ilk gelen küme lideri (birincil) olur. Birleşme geçişlidir:
// C, B'ye benzeyip B zaten A'ya bağlandıysa C de A'ya bağlanır — dört kaynaktan gelen aynı haber
// tek karta iner.
const vecOf = new Map();
for (const r of rows) { const v = dequantizeEmbedding(r.embedding); if (v) vecOf.set(r.id, v); }

const leaderOf = new Map();   // id -> lider id
const members = new Map();    // lider id -> [{row, score}]
for (const r of rows) {
  const v = vecOf.get(r.id);
  if (!v) continue;
  let best = null;
  for (const [leaderId, group] of members) {
    const leaderRow = rows.find(x => x.id === leaderId);
    // Aynı yayıncının kendi iki yazısı birleştirilmez (canlı hattaki AYNI kural).
    if (leaderRow.source_domain === r.source_domain) continue;
    if (group.some(m => m.row.source_domain === r.source_domain)) continue;
    // KÜMENİN TAMAMINA bakılır, yalnızca lidere DEĞİL. Gerçek bulgu (ilk kuru çalıştırma):
    // Arkitera'nın Foster haberi lider AJ'ye 0,817 (eşiğin hemen altında) ama kümedeki Dezeen
    // kaydına 0,889 benziyordu — yalnızca lidere bakan sürüm onu kümenin DIŞINDA bıraktı ve aynı
    // haber ikinci kez yayında kalırdı. Canlı hatta bu sorun YOK: orada aday, penceredeki HER
    // yayınlanmış kayıtla tek tek karşılaştırılıyor (bkz. gundemEmbedding.js#findSemanticDuplicate);
    // bu yalnızca toplu kümelemenin kendi eksiğiydi.
    let score = cosineSimilarity(v, vecOf.get(leaderId));
    for (const m of group) {
      const s2 = cosineSimilarity(v, vecOf.get(m.row.id));
      if (s2 > score) score = s2;
    }
    if (score >= THRESHOLD && (!best || score > best.score)) best = { leaderId, score };
  }
  if (best) { leaderOf.set(r.id, best.leaderId); members.get(best.leaderId).push({ row: r, score: best.score }); }
  else { members.set(r.id, []); }
}

const clusters = [...members.entries()].filter(([, g]) => g.length);
if (!clusters.length) { console.log('\nBirleştirilecek küme yok.'); process.exit(0); }

console.log(`\nBirleştirilecek küme: ${clusters.length}\n`);
let archived = 0;
for (const [leaderId, group] of clusters) {
  const leader = rows.find(x => x.id === leaderId);
  console.log(`  BİRİNCİL [${leader.source_name}] ${leader.title.slice(0, 62)}`);
  for (const m of group) console.log(`     + ${m.score.toFixed(3)} [${m.row.source_name}] ${m.row.title.slice(0, 58)}`);
  archived += group.length;

  if (DRY) continue;

  let extra = [];
  try { const p = JSON.parse(leader.extra_sources || '[]'); if (Array.isArray(p)) extra = p; } catch { extra = []; }
  for (const m of group) {
    if (extra.some(x => x && x.domain === m.row.source_domain)) continue;
    extra.push({ name: m.row.source_name, domain: m.row.source_domain, url: m.row.source_url });
  }
  await d1('UPDATE gundem_items SET extra_sources = ?, updated_at = ? WHERE id = ?',
    [JSON.stringify(extra.slice(0, 4)), Date.now(), leaderId]);
  for (const m of group) {
    // Entity kenarlarını birincile taşı — mükerrer kartta etiketlenmiş bir firma, birleşme
    // sonrasında etiketsiz kalmasın. INSERT OR IGNORE: birincilde zaten varsa dokunmaz.
    await d1(
      `INSERT OR IGNORE INTO gundem_entities (item_id, entity_type, entity_key, entity_name, created_at)
       SELECT ?, entity_type, entity_key, entity_name, created_at FROM gundem_entities WHERE item_id = ?`,
      [leaderId, m.row.id]
    );
    await d1('DELETE FROM gundem_entities WHERE item_id = ?', [m.row.id]);
    await d1("UPDATE gundem_items SET status = 'archived', updated_at = ? WHERE id = ?", [Date.now(), m.row.id]);
  }
}
console.log(`\nTOPLAM: ${clusters.length} küme, ${archived} kayıt birincile katıldı${DRY ? '  [DRY-RUN — yazılmadı]' : ' ve arşivlendi'}.`);
