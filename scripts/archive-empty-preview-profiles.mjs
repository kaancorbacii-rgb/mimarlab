#!/usr/bin/env node
// İÇERİĞİ HİÇ OLMAYAN BLURLU (ÖNİZLEME) FİRMA ve KİŞİ PROFİLLERİNİ ARŞİVE AL
// (kullanıcı isteği, 2026-09-15 on ikinci tur: "Sitede hiç kurucusu, kurucu ortağı, ortağı, projesi,
//  çektiği fotoğraflar bölümü veya ürünü olmayan blurlu firmaları arşive al." + on üçüncü tur:
//  "Aynı şekilde blurlu kişileri de kontrol et.")
//
// scripts/archive-brands-and-products.mjs / archive-ofist.mjs İLE AYNI desen ve AYNI gerekçe:
// arşivleme elle `UPDATE ... hidden_at` ile YAPILMAZ, CANLI KODDAN (runContentAction) import edilir —
// aksi halde geri alınabilirliği sağlayan *_submissions taslağı hiç oluşmaz ve kayıt
// "Arşivim > Yayına Al" ile geri getirilemez (bkz. [[project_bulk_admin_ops_via_live_code_2026_09_08]]).
//
// "BOŞ" KARARI BU DOSYADA DEĞİL: kural src/lib/emptyProfileAudit.js#auditProfileContent'te, veri ise
// pop-up'ı çizen CANLI koddan (office.js#buildOfficePayload / architect.js#buildArchitectPayload) ve
// firma tarafında arşiv cascade'inin KENDİ toplayıcısından gelir. Betiğin kendi "bu profilin projesi
// var mı" sorgusu YOKTUR — olsaydı pop-up bir bölümü değiştirdiği gün betik sitede içeriği görünen
// bir profili arşivlerdi.
//
// KAPSAM:
//   * YALNIZCA BLURLU profiller (hidden_at DOLU + preview_at DOLU). Yayındaki bir profile
//     DOKUNULMAZ; tam arşivdekiler zaten hedef durumdadır.
//   * SAHİPLİ profiller ASLA arşivlenmez (üye kaydı / admin ataması / danışman) — bkz.
//     emptyProfileAudit.js#fetchOwnership.
//   * MARKA/FİRMA AYRIMI YAPILMAZ: 2026-09-14'ten beri her ofis kaydı FİRMA'dır.
//
// NE YAPMAZ: hiçbir şeyi SİLMEZ (hard delete yok, blacklist yok), slug DEĞİŞMEZ, R2 görselleri DURUR.
//
// VARSAYILAN DRY-RUN: --apply verilmedikçe D1'e hiçbir şey yazılmaz.
//
// KULLANIM:
//   node scripts/archive-empty-preview-profiles.mjs --type=architects          # DRY-RUN, listeyi basar
//   node scripts/archive-empty-preview-profiles.mjs --type=offices --apply     # gerçekten arşivle
//   node scripts/archive-empty-preview-profiles.mjs --type=offices --audit-archived
//       -> ARŞİVDEKİ (hidden_at DOLU + preview_at BOŞ) ama SAHİPLİ profilleri listeler. Sahiplik
//          kapısı 2026-09-15 on üçüncü turda eklendiği için, ondan ÖNCE arşivlenmiş bir kaydın
//          yanlışlıkla düşüp düşmediğini denetlemenin yolu budur. HİÇBİR ŞEY YAZMAZ.
//
// SAYIM KAPISI: --expect verilirse ve bulunan sayı farklıysa betik HİÇBİR ŞEY YAZMADAN durur.
//
// NEREDEN ÇALIŞTIRILIR: uzak (web/telefon) Claude oturumundan ÇALIŞTIRILAMAZ — o konteynerden
// api.cloudflare.com çıkışı ağ politikasıyla kapalıdır. Bunun için
// .github/workflows/archive-empty-preview-profiles.yml var.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

globalThis.caches ||= { default: { match: async () => undefined, put: async () => {}, delete: async () => true } };

const { runContentAction } = await import('../src/routes/legacyContent.js');
const { buildOfficePayload } = await import('../src/routes/office.js');
const { buildArchitectPayload } = await import('../src/routes/architect.js');
const { collectOfficeArchiveTargets } = await import('../src/lib/officeArchiveCascade.js');
const { parseCanonicalRow } = await import('../src/lib/canonicalRead.js');
const { PROFILE_KINDS, fetchPreviewProfiles, fetchPhotographerNameFolds, fetchOwnership, fetchArchitectLinkIds, auditProfileContent, reasonsFor } =
  await import('../src/lib/emptyProfileAudit.js');

const ACCOUNT_ID = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim() || '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const APPLY = !!args.apply && !args['dry-run'];
const AUDIT_ARCHIVED = !!args['audit-archived'];
const KIND = String(args.type || 'architects');
if (!PROFILE_KINDS[KIND]) throw new Error(`--type 'offices' ya da 'architects' olmalı (verilen: ${KIND}).`);
const KIND_LABEL = PROFILE_KINDS[KIND].label;

const TOKEN_PATHS = [
  `${homedir()}/Library/Preferences/.wrangler/config/default.toml`,
  `${homedir()}/.wrangler/config/default.toml`,
  `${homedir()}/.config/.wrangler/config/default.toml`,
];
function oauthToken() {
  for (const p of TOKEN_PATHS) {
    try { const m = readFileSync(p, 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/); if (m) return m[1]; } catch { /* sıradaki yol */ }
  }
  throw new Error('wrangler OAuth token bulunamadı — `npx wrangler login` çalıştırın (ya da CLOUDFLARE_API_TOKEN verin).');
}
const TOKEN = (process.env.CLOUDFLARE_API_TOKEN || '').trim() || oauthToken();

async function rawQuery(sql, params = []) {
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
console.log(`Admin: ${adminRow.email}   [tip: ${KIND}]${APPLY && !AUDIT_ARCHIVED ? '' : '   [YAZMA YOK]'}\n`);

// ---------------------------------------------------------------------------------------------
// DENETİM MODU — arşivdeki SAHİPLİ kayıtlar. Sahiplik kapısı sonradan eklendiğinden, ondan önce
// arşivlenmiş bir kaydın yanlışlıkla düşüp düşmediği ancak böyle görülebilir. Hiçbir şey yazmaz.
// ---------------------------------------------------------------------------------------------
if (AUDIT_ARCHIVED) {
  const ownership = await fetchOwnership(env, KIND);
  const { results } = await env.DB.prepare(
    `SELECT id, name, slug FROM ${PROFILE_KINDS[KIND].table}
      WHERE deleted_at IS NULL AND hidden_at IS NOT NULL AND preview_at IS NULL
      ORDER BY name COLLATE NOCASE`
  ).all();
  const { foldTr } = await import('../src/lib/textMatch.js');
  const owned = (results || []).filter(r =>
    ownership.ownedIds.has(r.id) || ownership.claimedFolds.has(foldTr(r.name || '')) || ownership.consultantSlugs.has(r.slug));
  console.log(`Arşivdeki ${KIND_LABEL}: ${results.length}`);
  console.log(`Bunlardan SAHİPLİ olanlar (üye kaydı / atama / danışman): ${owned.length}`);
  for (const r of owned) console.log(`   · ${r.name}   (${r.slug})`);
  console.log('\n[DENETİM] Hiçbir şey yazılmadı.');
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// 1) OKU — liste EN BAŞTA ve SABİT hesaplanır (archive-brands-and-products.mjs'teki AYNI "anlık
//    görüntü" gerekçesi: tur ortasında yazılan bir satır sınıflandırmayı kaydırmasın).
// ---------------------------------------------------------------------------------------------
const previewRows = await fetchPreviewProfiles(env, KIND);
const [photographerFolds, ownership, linkIds] = await Promise.all([
  fetchPhotographerNameFolds(env),
  fetchOwnership(env, KIND),
  // Kişi tarafının "pop-up'ın görmediği bağ" kapısı — firmadaki cascade'in karşılığı.
  KIND === 'architects' ? fetchArchitectLinkIds(env) : Promise.resolve(null),
]);
console.log(`Blurlu (önizleme) ${KIND_LABEL}: ${previewRows.length}`);
console.log(`Künyelerde geçen fotoğrafçı adı (katlanmış): ${photographerFolds.size}`);
console.log(`Sahipli ${KIND_LABEL} kaydı: ${ownership.ownedIds.size} üye kaydı, ${ownership.claimedFolds.size} atama/talep, ${ownership.consultantSlugs.size} danışman`);
if (linkIds) console.log(`Yapısal bağı olan kişi (kurucu/proje/fotoğraf/ürün kenarı): ${linkIds.size}`);
console.log('');

const audits = [];
let scanned = 0;
for (const raw of previewRows) {
  const row = parseCanonicalRow(KIND, raw);
  // Pop-up'ın TA KENDİSİ — "bu profilin künyesinde ne görünüyor" sorusunun tek dürüst cevabı.
  const payload = KIND === 'offices'
    ? await buildOfficePayload(env, row.slug)
    : await buildArchitectPayload(env, row.slug);
  // Arşivleme bu profille birlikte başka bir kaydı da götürecek mi? (YALNIZCA firma — kişiyi
  // arşivlemek hiçbir şeyi beraberinde götürmez, bkz. legacyContent.js#archiveOfficeGraph.)
  const cascade = KIND === 'offices' ? await collectOfficeArchiveTargets(env, row) : null;
  audits.push(auditProfileContent(KIND, row, payload, { cascade, linkIds, photographerFolds, ownership }));
  scanned++;
  if (scanned % 25 === 0) console.log(`   ... tarandı ${scanned}/${previewRows.length}`);
}

const empty = audits.filter(a => a.empty);
const kept = audits.filter(a => !a.empty);
const keptOwnedOnly = kept.filter(a => a.owned && !a.photographer && !a.cascade && !a.linked
  && Object.values(a.sections).every(n => n === 0));

console.log(`\n=== ARŞİVE ALINACAK (içeriği HİÇ yok): ${empty.length} ===`);
for (const a of empty) console.log(`   · ${a.name}   (${a.slug})`);

if (keptOwnedOnly.length) {
  console.log(`\n=== KORUNDU — bomboş ama SAHİPLİ (üye kaydı / atama / danışman): ${keptOwnedOnly.length} ===`);
  for (const a of keptOwnedOnly) console.log(`   · ${a.name}   (${a.slug})`);
}

console.log(`\n=== DOKUNULMADI — içeriği var: ${kept.length - keptOwnedOnly.length} ===`);
for (const a of kept) {
  if (keptOwnedOnly.includes(a)) continue;
  console.log(`   · ${a.name} — ${reasonsFor(a)}`);
}

// Sayım kapısı — yalnızca açıkça verildiyse.
if (args.expect !== undefined && Number(args.expect) !== empty.length) {
  throw new Error(`${KIND_LABEL} sayısı beklenenden farklı: beklenen ${args.expect}, bulunan ${empty.length} — hiçbir şey yazılmadı.`);
}

if (!APPLY) {
  console.log('\n[DRY-RUN] Hiçbir şey yazılmadı. Gerçekten arşivlemek için --apply ile çalıştır.');
  process.exit(0);
}
if (!empty.length) {
  console.log(`\nArşivlenecek ${KIND_LABEL} yok.`);
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// 2) YAZ — canlı kod yolundan (runContentAction), archive-brands-and-products.mjs ile AYNI çağrı.
//    `key: name` — iki tipin de doğal anahtarı (bkz. canonicalSync.js#findCanonicalRowByNaturalKey).
// ---------------------------------------------------------------------------------------------
console.log('\n--- ARŞİVLENİYOR ---');
const failed = [];
let done = 0;
for (const a of empty) {
  const res = await runContentAction(env, user, { type: KIND, action: 'archive', key: a.name });
  if (res && res.status >= 400) { failed.push(a.name); console.log(`   HATA ${a.name} (${res.status})`); continue; }
  done++;
  console.log(`   arşivlendi: ${a.name}`);
}

console.log(`\n=== ÖZET ===`);
console.log(`Arşivlendi : ${done}/${empty.length}`);
if (failed.length) { console.log(`\nBAŞARISIZ (${failed.length}): ${failed.join(', ')}`); process.exit(1); }
console.log('Tamam.');
