#!/usr/bin/env node
// İÇERİĞİ HİÇ OLMAYAN BLURLU (ÖNİZLEME) FİRMALARI ARŞİVE AL
// (kullanıcı isteği, 2026-09-15 on ikinci tur: "Sitede hiç kurucusu, kurucu ortağı, ortağı, projesi,
//  çektiği fotoğraflar bölümü veya ürünü olmayan blurlu firmaları arşive al.")
//
// scripts/archive-brands-and-products.mjs / archive-ofist.mjs İLE AYNI desen ve AYNI gerekçe:
// arşivleme elle `UPDATE ... hidden_at` ile YAPILMAZ, CANLI KODDAN (runContentAction) import edilir —
// aksi halde geri alınabilirliği sağlayan *_submissions taslağı hiç oluşmaz ve kayıt
// "Arşivim > Yayına Al" ile geri getirilemez (bkz. [[project_bulk_admin_ops_via_live_code_2026_09_08]]).
//
// "BOŞ" KARARI BU DOSYADA DEĞİL: kural src/lib/emptyOfficeAudit.js#auditOfficeContent'te, veri ise
// firma pop-up'ını çizen CANLI koddan (src/routes/office.js#buildOfficePayload) ve arşiv cascade'inin
// KENDİ toplayıcısından (officeArchiveCascade.js#collectOfficeArchiveTargets) gelir. Betiğin kendi
// "bu firmanın projesi var mı" sorgusu YOKTUR — olsaydı pop-up bir bölümü değiştirdiği gün betik
// sitede içeriği görünen bir firmayı arşivlerdi.
//
// KAPSAM:
//   * YALNIZCA BLURLU firmalar (hidden_at DOLU + preview_at DOLU). Yayındaki bir firmaya DOKUNULMAZ
//     — kullanıcı isteği açıkça "blurlu firmaları" diyor; tam arşivdekiler zaten hedef durumda.
//   * MARKA/FİRMA AYRIMI YAPILMAZ: 2026-09-14'ten beri her ofis kaydı FİRMA'dır
//     (bkz. office-kind.js#isPureBrandOffice sabit false). Zaten ürünü olan bir kayıt "ürünü yok"
//     kapısından geçemez.
//
// NE YAPMAZ: hiçbir şeyi SİLMEZ (hard delete yok, blacklist yok), slug DEĞİŞMEZ, R2 görselleri DURUR.
// Her kayıt canlı kod yolundan geçtiği için "Arşivim > Yayına Al" ile geri alınabilir.
//
// VARSAYILAN DRY-RUN: --apply verilmedikçe D1'e hiçbir şey yazılmaz.
//
// KULLANIM:
//   node scripts/archive-empty-preview-offices.mjs                 # DRY-RUN, listeyi basar
//   node scripts/archive-empty-preview-offices.mjs --apply         # gerçekten arşivle
//   node scripts/archive-empty-preview-offices.mjs --expect=N --apply
//
// SAYIM KAPISI: --expect verilirse ve bulunan sayı farklıysa betik HİÇBİR ŞEY YAZMADAN durur.
//
// NEREDEN ÇALIŞTIRILIR: uzak (web/telefon) Claude oturumundan ÇALIŞTIRILAMAZ — o konteynerden
// api.cloudflare.com çıkışı ağ politikasıyla kapalıdır. Bunun için
// .github/workflows/archive-empty-preview-offices.yml var.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

globalThis.caches ||= { default: { match: async () => undefined, put: async () => {}, delete: async () => true } };

const { runContentAction } = await import('../src/routes/legacyContent.js');
const { buildOfficePayload } = await import('../src/routes/office.js');
const { collectOfficeArchiveTargets } = await import('../src/lib/officeArchiveCascade.js');
const { parseCanonicalRow } = await import('../src/lib/canonicalRead.js');
const { fetchPreviewOffices, fetchPhotographerNameFolds, auditOfficeContent } = await import('../src/lib/emptyOfficeAudit.js');

const ACCOUNT_ID = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim() || '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const APPLY = !!args.apply && !args['dry-run'];

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
console.log(`Admin: ${adminRow.email}${APPLY ? '' : '   [DRY-RUN — hiçbir şey yazılmayacak]'}\n`);

// ---------------------------------------------------------------------------------------------
// 1) OKU — liste EN BAŞTA ve SABİT hesaplanır (archive-brands-and-products.mjs'teki AYNI "anlık
//    görüntü" gerekçesi: tur ortasında yazılan bir satır sınıflandırmayı kaydırmasın).
// ---------------------------------------------------------------------------------------------
const previewOffices = await fetchPreviewOffices(env);
const photographerFolds = await fetchPhotographerNameFolds(env);
console.log(`Blurlu (önizleme) firma: ${previewOffices.length}`);
console.log(`Künyelerde geçen fotoğrafçı adı (katlanmış): ${photographerFolds.size}\n`);

const audits = [];
let scanned = 0;
for (const row of previewOffices) {
  const o = parseCanonicalRow('offices', row);
  // Pop-up'ın TA KENDİSİ — "bu firmanın künyesinde ne görünüyor" sorusunun tek dürüst cevabı.
  const payload = await buildOfficePayload(env, o.slug);
  // Arşivleme bu firmayla birlikte başka bir kaydı da götürecek mi? (pop-up'ın görmediği yapısal bağlar)
  const cascade = await collectOfficeArchiveTargets(env, o);
  audits.push(auditOfficeContent(o, payload, cascade, photographerFolds));
  scanned++;
  if (scanned % 25 === 0) console.log(`   ... tarandı ${scanned}/${previewOffices.length}`);
}

const empty = audits.filter(a => a.empty);
// Kullanıcının saydığı dört kalem boş ama Ekip'i (ya da pop-up'ın görmediği yapısal bir bağı) olduğu
// için KORUNANLAR — rapor bunları ayrı gösterir ki kapsam kararı kullanıcıda kalsın.
const keptForTeamOnly = audits.filter(a => !a.empty && a.emptyByUserRule);
const hasContent = audits.filter(a => !a.emptyByUserRule);

console.log(`\n=== ARŞİVE ALINACAK (içeriği HİÇ yok): ${empty.length} ===`);
for (const a of empty) console.log(`   · ${a.name}   (/firma/${a.slug})`);

if (keptForTeamOnly.length) {
  console.log(`\n=== KORUNDU — kurucu/proje/fotoğraf/ürün yok ama başka bir bağı var: ${keptForTeamOnly.length} ===`);
  for (const a of keptForTeamOnly) {
    const why = [a.team ? `${a.team} ekip üyesi` : null, a.cascade ? `${a.cascade} bağlı kayıt` : null].filter(Boolean).join(', ');
    console.log(`   · ${a.name}   (/firma/${a.slug})  — ${why}`);
  }
}

console.log(`\n=== DOKUNULMADI — içeriği var: ${hasContent.length} ===`);
for (const a of hasContent) {
  const parts = [
    a.founders ? `${a.founders} kurucu/ortak` : null,
    a.team ? `${a.team} ekip` : null,
    a.projects ? `${a.projects} proje` : null,
    a.products ? `${a.products} ürün` : null,
    a.photographer ? 'fotoğraf künyesi' : null,
  ].filter(Boolean).join(', ');
  console.log(`   · ${a.name} — ${parts}`);
}

// Sayım kapısı — yalnızca açıkça verildiyse.
if (args.expect !== undefined && Number(args.expect) !== empty.length) {
  throw new Error(`Firma sayısı beklenenden farklı: beklenen ${args.expect}, bulunan ${empty.length} — hiçbir şey yazılmadı.`);
}

if (!APPLY) {
  console.log('\n[DRY-RUN] Hiçbir şey yazılmadı. Gerçekten arşivlemek için --apply ile çalıştır.');
  process.exit(0);
}
if (!empty.length) {
  console.log('\nArşivlenecek firma yok.');
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// 2) YAZ — canlı kod yolundan (runContentAction), archive-brands-and-products.mjs ile AYNI çağrı.
//    `key: name` — offices'ın doğal anahtarı (bkz. canonicalSync.js#findCanonicalRowByNaturalKey).
// ---------------------------------------------------------------------------------------------
console.log('\n--- ARŞİVLENİYOR ---');
const failed = [];
let done = 0;
for (const a of empty) {
  const res = await runContentAction(env, user, { type: 'offices', action: 'archive', key: a.name });
  if (res && res.status >= 400) { failed.push(a.name); console.log(`   HATA ${a.name} (${res.status})`); continue; }
  done++;
  console.log(`   arşivlendi: ${a.name}`);
}

console.log(`\n=== ÖZET ===`);
console.log(`Arşivlendi : ${done}/${empty.length}`);
if (failed.length) { console.log(`\nBAŞARISIZ (${failed.length}): ${failed.join(', ')}`); process.exit(1); }
console.log('Tamam.');
