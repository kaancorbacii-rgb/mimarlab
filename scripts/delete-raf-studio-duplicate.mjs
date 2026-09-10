#!/usr/bin/env node
// MÜKERRER "r.a.f.studio" FİRMA KAYDINI SİL (kullanıcı isteği, 2026-09-10 madde 4).
//
// D1'de AYNI firmanın iki kaydı var:
//   #66  name="r.a.f. studio" slug="r-a-f-studio"    -> YAYINDA. 5 proje künyesi, 1 kurucu,
//                                                       2 ONAYLI sahiplenme. ASLA DOKUNULMAZ.
//   #670 name="r.a.f.studio"  slug="r-a-f-studio-2"  -> hidden_at + preview_at DOLU (arşiv/önizleme
//                                                       mükerreri). Hiçbir ilişkisi YOK. SİLİNECEK.
//
// scripts/publish-birim-design.mjs / archive-cinici.mjs ile AYNI desen: iş elle `DELETE FROM` ile
// yapılmaz, CANLI KODDAN (runContentAction 'delete') import edilir — o yol deleteCanonicalRowFully
// üzerinden hem join tablolarını hem *_submissions/etkileşim temizliğini hem de tekrar-import
// karalistesini BİRLİKTE çalıştırır (bkz. [[project_cascade_delete_system]]).
//
// ANAHTAR SEÇİMİ KRİTİK: runContentAction'a KANONİK AD verilir ("r.a.f.studio", NOKTALI ve
// BOŞLUKSUZ). findCanonicalRowByNaturalKey `name = ? OR slug = ? OR legacy_key = ?` ile eşleştirir;
// yayındaki kaydın adı "r.a.f. studio" (BOŞLUKLU) olduğundan bu anahtar YALNIZCA mükerreri bulur.
// Slug göndermek de mükerreri bulurdu ama cascade adı ad üzerinden temizlediğinden ad doğrusudur.
//
// SLUG ÇAKIŞMASI (bu turda bulundu ve DÜZELTİLDİ): slugify("r.a.f.studio") ===
// slugify("r.a.f. studio") === "r-a-f-studio". Etkileşim satırları (saved/shared/follows/comments/
// ratings) bu slug'la anahtarlandığından, düzeltme ÖNCESİNDE bu silme YAYINDAKİ kaydın 1 adet
// shared_items satırını da götürürdü. src/lib/cascadeDelete.js#deleteEngagementUnlessKeyShared artık
// anahtar başka bir kayıtla paylaşılıyorsa temizliği ATLAR (regresyon testi:
// scripts/test-cascade-delete-slug-collision.mjs).
//
// KULLANIM:
//   node scripts/delete-raf-studio-duplicate.mjs --dry-run
//   node scripts/delete-raf-studio-duplicate.mjs
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { runContentAction } from '../src/routes/legacyContent.js';

const ACCOUNT_ID = '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';
const DRY = process.argv.includes('--dry-run');

const DELETE_NAME = 'r.a.f.studio';       // #670 — mükerrer
const DELETE_SLUG = 'r-a-f-studio-2';
const KEEP_NAME   = 'r.a.f. studio';      // #66  — yayındaki kayıt
const KEEP_SLUG   = 'r-a-f-studio';

const TOKEN_PATHS = [
  `${homedir()}/Library/Preferences/.wrangler/config/default.toml`,
  `${homedir()}/.wrangler/config/default.toml`,
  `${homedir()}/.config/.wrangler/config/default.toml`,
];
function token() {
  for (const p of TOKEN_PATHS) {
    try { const m = readFileSync(p, 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/); if (m) return m[1]; } catch { /* sıradaki */ }
  }
  throw new Error('wrangler OAuth token bulunamadı — `npx wrangler login` çalıştırın.');
}
const TOKEN = token();

let queryCount = 0;
async function rawQuery(sql, params = []) {
  queryCount++;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
      { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }) }
    );
    const json = await res.json().catch(() => null);
    if (json && json.success) return json.result[0];
    const msg = JSON.stringify((json && json.errors) || res.status);
    if (msg.includes('7403') || msg.includes('10000')) throw new Error(`D1 yetkilendirme hatası (token dolmuş olabilir): ${msg}`);
    if (attempt === 3) throw new Error(`D1 sorgusu başarısız: ${msg}\n${sql}`);
    await new Promise(r => setTimeout(r, 400 * attempt));
  }
}
function d1() {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = await rawQuery(sql, params); const row = (r.results || [])[0]; if (!row) return null; return col ? row[col] : row; },
    async all() { const r = await rawQuery(sql, params); return { results: r.results || [] }; },
    async run() { const r = await rawQuery(sql, params); return { success: true, meta: r.meta || {} }; },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; } };
}

const env = { DB: d1() };
const adminRow = await env.DB.prepare(`SELECT id, email FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`).first();
if (!adminRow) throw new Error('Admin kullanıcı bulunamadı.');
const user = { id: adminRow.id, role: 'admin' };
console.log(`Admin: ${adminRow.email}${DRY ? '   [DRY-RUN]' : ''}\n`);

const one = async (sql, ...binds) => env.DB.prepare(sql).bind(...binds).first();
const n = async (sql, ...binds) => Number((await one(sql, ...binds))?.n || 0);

// --- 1) KİMLİK DOĞRULAMA: silinecek ve korunacak satırlar tam olarak beklenen mi? ----------------
const dup = await one(`SELECT id, name, slug, hidden_at, preview_at, deleted_at FROM offices WHERE slug = ?`, DELETE_SLUG);
const keep = await one(`SELECT id, name, slug, hidden_at, preview_at, deleted_at FROM offices WHERE slug = ?`, KEEP_SLUG);
if (!dup) throw new Error(`Silinecek kayıt bulunamadı (slug=${DELETE_SLUG}) — zaten silinmiş olabilir.`);
if (!keep) throw new Error(`KORUNACAK kayıt bulunamadı (slug=${KEEP_SLUG}) — DURDU, hiçbir şey silinmedi.`);
if (dup.name !== DELETE_NAME) throw new Error(`Silinecek kaydın adı beklenenden farklı: "${dup.name}" != "${DELETE_NAME}"`);
if (keep.name !== KEEP_NAME) throw new Error(`Korunacak kaydın adı beklenenden farklı: "${keep.name}" != "${KEEP_NAME}"`);
if (!dup.hidden_at || !dup.preview_at) throw new Error('Silinecek kayıt arşiv/önizleme durumunda DEĞİL — DURDU (yanlış kayıt olabilir).');
if (keep.hidden_at || keep.preview_at) throw new Error('Korunacak kayıt yayında DEĞİL — DURDU (kayıtlar yer değiştirmiş olabilir).');

console.log(`SİLİNECEK : #${dup.id}  "${dup.name}"  /${dup.slug}  (arşiv+önizleme)`);
console.log(`KORUNACAK : #${keep.id}  "${keep.name}"  /${keep.slug}  (yayında)\n`);

// --- 2) İLİŞKİ DENETİMİ: mükerrer gerçekten boşta mı? --------------------------------------------
const dupRel = {
  project_designers: await n(`SELECT COUNT(*) n FROM project_designers WHERE office_id = ?`, dup.id),
  office_founders:   await n(`SELECT COUNT(*) n FROM office_founders WHERE office_id = ?`, dup.id),
  architects:        await n(`SELECT COUNT(*) n FROM architects WHERE office_id = ?`, dup.id),
  products:          await n(`SELECT COUNT(*) n FROM products WHERE brand_office_id = ?`, dup.id),
  project_brands:    await n(`SELECT COUNT(*) n FROM project_brands WHERE office_id = ?`, dup.id),
  profile_claims:    await n(`SELECT COUNT(*) n FROM profile_claims WHERE profile_key = ?`, DELETE_NAME),
  office_submissions:await n(`SELECT COUNT(*) n FROM office_submissions WHERE name = ? OR claimed_profile_key = ?`, DELETE_NAME, DELETE_NAME),
};
console.log('Mükerrerin ilişkileri:', JSON.stringify(dupRel));
const busy = Object.entries(dupRel).filter(([, v]) => v > 0);
if (busy.length) throw new Error(`Mükerrer kaydın bağlı kayıtları var (${busy.map(([k, v]) => `${k}=${v}`).join(', ')}) — DURDU, elle incele.`);

// --- 3) KORUNACAK KAYDIN ANLIK GÖRÜNTÜSÜ (silme sonrası birebir aynı olmalı) ---------------------
const keepBefore = {
  project_designers: await n(`SELECT COUNT(*) n FROM project_designers WHERE office_id = ?`, keep.id),
  office_founders:   await n(`SELECT COUNT(*) n FROM office_founders WHERE office_id = ?`, keep.id),
  architects:        await n(`SELECT COUNT(*) n FROM architects WHERE office_id = ?`, keep.id),
  profile_claims:    await n(`SELECT COUNT(*) n FROM profile_claims WHERE profile_key = ?`, KEEP_NAME),
  // slugify çakışması yüzünden ASIL RİSK burada (bkz. dosya başı).
  shared_items:      await n(`SELECT COUNT(*) n FROM shared_items WHERE item_type='office' AND item_key = ?`, KEEP_SLUG),
  saved_items:       await n(`SELECT COUNT(*) n FROM saved_items WHERE item_type='office' AND item_key = ?`, KEEP_SLUG),
  follows:           await n(`SELECT COUNT(*) n FROM follows WHERE followed_type='office' AND followed_key = ?`, KEEP_SLUG),
  comments:          await n(`SELECT COUNT(*) n FROM comments WHERE target_type='office' AND target_id = ?`, KEEP_SLUG),
  ratings:           await n(`SELECT COUNT(*) n FROM ratings WHERE target_type='office' AND target_id = ?`, KEEP_SLUG),
  slug_redirect:     await n(`SELECT COUNT(*) n FROM slug_redirects WHERE old_slug = ? AND new_slug = ?`, DELETE_SLUG, KEEP_SLUG),
};
console.log('Korunacak kaydın ÖNCE durumu:', JSON.stringify(keepBefore));

if (DRY) {
  console.log(`\n[DRY-RUN] Hiçbir şey silinmedi. (${queryCount} D1 sorgusu)`);
  process.exit(0);
}

// --- 4) SİL — canlı kod yolu --------------------------------------------------------------------
const res = await runContentAction(env, user, { type: 'offices', action: 'delete', key: DELETE_NAME });
if (res && res.status >= 400) throw new Error(`Silme başarısız: ${res.status} ${await res.text()}`);
console.log(`\nSilindi: "${DELETE_NAME}"`);

// --- 5) DOĞRULA ---------------------------------------------------------------------------------
const dupAfter = await one(`SELECT id FROM offices WHERE slug = ? OR name = ?`, DELETE_SLUG, DELETE_NAME);
const keepAfter = await one(`SELECT id, name, slug, hidden_at, preview_at, deleted_at FROM offices WHERE id = ?`, keep.id);
const keepNow = {
  project_designers: await n(`SELECT COUNT(*) n FROM project_designers WHERE office_id = ?`, keep.id),
  office_founders:   await n(`SELECT COUNT(*) n FROM office_founders WHERE office_id = ?`, keep.id),
  architects:        await n(`SELECT COUNT(*) n FROM architects WHERE office_id = ?`, keep.id),
  profile_claims:    await n(`SELECT COUNT(*) n FROM profile_claims WHERE profile_key = ?`, KEEP_NAME),
  shared_items:      await n(`SELECT COUNT(*) n FROM shared_items WHERE item_type='office' AND item_key = ?`, KEEP_SLUG),
  saved_items:       await n(`SELECT COUNT(*) n FROM saved_items WHERE item_type='office' AND item_key = ?`, KEEP_SLUG),
  follows:           await n(`SELECT COUNT(*) n FROM follows WHERE followed_type='office' AND followed_key = ?`, KEEP_SLUG),
  comments:          await n(`SELECT COUNT(*) n FROM comments WHERE target_type='office' AND target_id = ?`, KEEP_SLUG),
  ratings:           await n(`SELECT COUNT(*) n FROM ratings WHERE target_type='office' AND target_id = ?`, KEEP_SLUG),
  slug_redirect:     await n(`SELECT COUNT(*) n FROM slug_redirects WHERE old_slug = ? AND new_slug = ?`, DELETE_SLUG, KEEP_SLUG),
};
console.log('Korunacak kaydın SONRA durumu:', JSON.stringify(keepNow));

let ok = true;
if (dupAfter) { console.error('HATA: mükerrer kayıt hâlâ duruyor!'); ok = false; }
if (!keepAfter || keepAfter.deleted_at || keepAfter.hidden_at) { console.error('HATA: korunacak kayıt etkilenmiş!'); ok = false; }
for (const [k, v] of Object.entries(keepBefore)) {
  if (keepNow[k] !== v) { console.error(`HATA: korunacak kaydın "${k}" sayısı değişti: ${v} -> ${keepNow[k]}`); ok = false; }
}
console.log(`\nSonuç: ${ok ? 'BAŞARILI — mükerrer silindi, yayındaki kayıt birebir korundu.' : 'BAŞARISIZ — yukarıdaki hatalara bak.'}`);
console.log(`(${queryCount} D1 sorgusu)`);
console.log('NOT: KV havuz anahtarları (pool:*) elle temizlenmeli.');
if (!ok) process.exitCode = 1;
