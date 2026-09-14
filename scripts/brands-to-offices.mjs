#!/usr/bin/env node
// MARKALARI FİRMAYA DÖNÜŞTÜR — "Üretim ve Satış" hizmet alanı
// (kullanıcı isteği, 2026-09-14 madde 4: "Marka ve marka ekle sayfasını canlıdan kaldır. Hali
//  hazırdaki markalar artık firma olacak ama BİRİM Design markası hariç hepsi arşivde kalsın.
//  Tüm markalar firmalar arasında Üretim ve Satış hizmet alanı içerisinde olacak. BİRİM Design
//  markasını bir firma yap ve hizmet alanını Üretim ve Satış olarak seç.")
//
// KOD TARAFI (deploy ile canlıya gider) bu betikten BAĞIMSIZ olarak şunu zaten yapıyor:
// /marka ve /marka-ekle 301 ile firma tarafına taşındı, isPureBrandOffice sabit false döndüğü için
// her ofis kaydı firma listesinde ve /firma/:slug altında. BU BETİK, D1'deki SATIRLARI kullanıcının
// tarif ettiği son hâle getirir:
//
//   1) HİZMET ALANI — üretici olan her ofis kaydının `cats` değerine 'Üretim ve Satış' EKLENİR.
//      Var olan kategoriler (Mobilya, Aydınlatma, hatta eski 'Ürün' işareti ya da Autoban gibi
//      kayıtlardaki 'Mimarlık') SİLİNMEZ: kullanıcı markaların firmalar arasında "Üretim ve Satış
//      hizmet alanı içerisinde" olmasını istedi, başka bilgilerinin silinmesini değil. Ürün
//      kategorileri firma-ekle.html'in yeni "Ürün Kategorisi" kutusunda aynen görünür.
//      "Üretici olan" = office-kind.js#isBrandOffice (ürün sayısı > 0 ya da cats'inde ürün
//      kategorisi/eski 'Ürün' işareti var) — ayrı bir liste tutulmaz, kodun TEK kaynağı kullanılır.
//
//   2) ARŞİV — BİRİM Design DIŞINDAKİ üretici kayıtlar arşivde KALIR. Betik hiçbir kaydı
//      arşivden çıkarmaz ve zaten arşivde olanı yeniden arşivlemez; arşivde OLMAYAN bir üretici
//      bulursa (önizlemedekiler dahil) canlı silme/arşivleme yolundan (runContentAction, bkz.
//      scripts/archive-brands-and-products.mjs'teki AYNI gerekçe) arşivler.
//
//   3) BİRİM Design — YAYINDA olmalı. Arşivdeyse yayına alınır ve cats'i 'Üretim ve Satış'ı
//      içerecek şekilde güncellenir.
//
// NEDEN cats ELLE UPDATE EDİLİYOR (arşivleme runContentAction'dan geçerken): `cats` yalnızca bir
// metin kolonudur; onu değiştirmenin cascade'i, kenar tablosu ya da R2 temizliği yoktur. Arşivleme
// ise satırın grafını (ürünler, kenarlar, önbellek) etkilediğinden canlı koddan geçmek ZORUNDA.
//
// VARSAYILAN DRY-RUN: --apply verilmedikçe D1'e hiçbir şey yazılmaz.
//
// KULLANIM:
//   node scripts/brands-to-offices.mjs            # DRY-RUN, planı basar
//   node scripts/brands-to-offices.mjs --apply    # gerçekten yaz
//
// NEREDEN ÇALIŞTIRILIR: uzak (web/telefon) Claude oturumundan ÇALIŞTIRILAMAZ — o konteynerden
// api.cloudflare.com çıkışı ağ politikasıyla kapalıdır (bkz. CLAUDE.md). Bunun için
// .github/workflows/brands-to-offices.yml var (workflow_dispatch ile tetiklenir).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

globalThis.caches ||= { default: { match: async () => undefined, put: async () => {}, delete: async () => true } };

const { runContentAction } = await import('../src/routes/legacyContent.js');
const officeKind = (await import('../office-kind.js')).default;
const { isBrandOffice, officeCatList } = officeKind;

const URETIM_CAT = 'Üretim ve Satış';
const KEEP_LIVE_NAME = 'BİRİM Design';   // canonical offices.name ile birebir

const ACCOUNT_ID = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim() || '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';
const APPLY = process.argv.includes('--apply') && !process.argv.includes('--dry-run');

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

const env = { DB: d1(), FACET_CACHE: null };
const adminRow = await env.DB.prepare(`SELECT id, email FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`).first();
if (!adminRow) throw new Error('Admin kullanıcı bulunamadı.');
const user = { id: adminRow.id, role: 'admin' };
console.log(`Admin: ${adminRow.email}${APPLY ? '' : '   [DRY-RUN — hiçbir şey yazılmayacak]'}\n`);

// ---------------------------------------------------------------------------------------------
// OKU — tüm ofisler + ofis başına yayındaki ürün sayısı (isBrandOffice'in üçüncü yolu).
// ---------------------------------------------------------------------------------------------
const { results: officeRows } = await env.DB.prepare(
  `SELECT id, name, slug, cats, hidden_at, preview_at FROM offices WHERE deleted_at IS NULL ORDER BY id`
).all();
const { results: countRows } = await env.DB.prepare(
  `SELECT brand_office_id AS id, COUNT(*) AS n FROM products
    WHERE deleted_at IS NULL AND brand_office_id IS NOT NULL GROUP BY brand_office_id`
).all();
const productCount = new Map(countRows.map(r => [r.id, Number(r.n) || 0]));

// "Tam arşivde" = hidden_at DOLU + preview_at BOŞ. Önizlemedekiler ("soluk") sitede hâlâ görünür,
// yani arşivlenmeleri gerekir — bkz. src/lib/officeArchiveCascade.js#isAlreadyArchived.
const isArchived = (r) => !!r.hidden_at && !r.preview_at;

const producers = officeRows.filter(o => isBrandOffice(o.cats, productCount.get(o.id) || 0));
console.log(`${officeRows.length} ofis kaydı — üretici (isBrandOffice) olan: ${producers.length}\n`);

// ---------------------------------------------------------------------------------------------
// PLANLA
// ---------------------------------------------------------------------------------------------
const catsPlan = [];   // { row, nextCats }
const toArchive = [];  // arşivde OLMAYAN üreticiler (BİRİM Design hariç)
let keepLiveRow = null;

for (const o of producers) {
  const current = officeCatList(o.cats);
  if (!current.includes(URETIM_CAT)) {
    // 'Üretim ve Satış' EN BAŞA: firma künyesinde önce hizmet alanı, sonra ürün kategorileri
    // okunsun (firma-ekle.html'de de kutuların sırası böyle).
    catsPlan.push({ row: o, nextCats: [URETIM_CAT, ...current].join(' · ') });
  }
  if (o.name === KEEP_LIVE_NAME) { keepLiveRow = o; continue; }
  if (!isArchived(o)) toArchive.push(o);
}

console.log(`1) 'Üretim ve Satış' eklenecek: ${catsPlan.length} kayıt`);
for (const p of catsPlan) console.log(`   · ${p.row.name}  ["${p.row.cats ?? ''}"] -> "${p.nextCats}"`);
console.log(`\n2) Arşivlenecek (zaten arşivde olmayan üreticiler): ${toArchive.length} kayıt`);
for (const o of toArchive) console.log(`   · ${o.name}${o.preview_at ? '  [önizlemede]' : ''}`);
console.log(`\n3) Yayında KALACAK: ${KEEP_LIVE_NAME} — ${keepLiveRow ? (isArchived(keepLiveRow) ? 'ŞU AN ARŞİVDE, yayına alınacak' : 'zaten yayında') : 'KAYIT BULUNAMADI (aşağıya bkz.)'}`);
if (!keepLiveRow) {
  console.log(`   UYARI: "${KEEP_LIVE_NAME}" adında bir ofis kaydı yok ya da üretici sayılmıyor.`);
  console.log('   Benzer adlar:', officeRows.filter(o => /birim/i.test(o.name)).map(o => `"${o.name}"`).join(', ') || '(yok)');
}
console.log('');

if (!APPLY) {
  console.log(`DRY-RUN bitti. Gerçekten yazmak için --apply ekleyin. (${queryCount} D1 sorgusu)`);
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// YAZ
// ---------------------------------------------------------------------------------------------
for (const p of catsPlan) {
  await env.DB.prepare(`UPDATE offices SET cats = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(p.nextCats, p.row.id).run();
}
console.log(`1) ${catsPlan.length} kaydın hizmet alanına '${URETIM_CAT}' eklendi.`);

// Arşivleme CANLI YOLDAN: runContentAction ofisin grafını (ürünler, kenarlar) ve önbelleği de
// doğru şekilde düşürür — elle `UPDATE offices SET hidden_at` yetim satır ve bayat sayfa bırakırdı.
// runContentAction HATA ATMAZ, errorJson() Response'u DÖNER (bkz. o fonksiyon) — durum kodu
// okunmazsa başarısız arşivlemeler sessizce "başarılı" sayılırdı. archive-brands-and-products.mjs
// ile AYNI kontrol.
let archived = 0;
const failed = [];
for (const o of toArchive) {
  const res = await runContentAction(env, user, { type: 'offices', key: o.slug || o.name, action: 'archive' });
  if (res && res.status >= 400) { failed.push(`${o.name} (${res.status})`); }
  else archived++;
}
console.log(`2) ${archived}/${toArchive.length} kayıt arşivlendi.`);
if (failed.length) console.log(`   ARŞİVLENEMEYENLER: ${failed.join(', ')}`);

if (keepLiveRow && isArchived(keepLiveRow)) {
  const res = await runContentAction(env, user, { type: 'offices', key: keepLiveRow.slug || keepLiveRow.name, action: 'publish' });
  if (res && res.status >= 400) console.log(`3) ${KEEP_LIVE_NAME} YAYINA ALINAMADI (${res.status}).`);
  else console.log(`3) ${KEEP_LIVE_NAME} yayına alındı.`);
} else if (keepLiveRow) {
  console.log(`3) ${KEEP_LIVE_NAME} zaten yayında — dokunulmadı.`);
}

console.log(`\nBitti. (${queryCount} D1 sorgusu)`);
