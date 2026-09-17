#!/usr/bin/env node
// PROJESİ OLMAYAN BLURLU (ÖNİZLEME) KİŞİ ve FİRMALARI KALICI OLARAK SİL
// (kullanıcı isteği, 2026-09-17: "Şu an blurlu olup yani önizleme modunda olup üzerinde hiçbir proje
//  olmayan tüm kişi ve firmaları canlı siteden ve admin panelindeki arşiv kısmından sil.")
//
// archive-empty-preview-profiles.mjs'in KARDEŞİ, iki farkla: (1) karar yalnızca PROJE üzerinden
// verilir (istek "üzerinde hiçbir proje olmayan" diyor), (2) işlem arşiv DEĞİL SİLMEDİR — admin
// panelindeki "Sil" ile BİREBİR aynı canlı kod yolu: runContentAction({ action:'delete', key }).
// Bu yol canonical satırı + join kenarlarını siler, anahtarı karalisteye alır (statik kaynaktan geri
// doğmasın), *_submissions taslaklarını siler (Arşiv sekmesinden de düşer) ve yorum/puan/kaydetme
// etkileşimlerini temizler. GERİ ALINAMAZ.
//
// "PROJE YOK" TANIMI (güvenli yön — şüphede profil KORUNUR):
//   KİŞİ : pop-up'ın Projeler + Fotoğrafladığı Projeler bölümleri boş VE project_designers /
//          project_photographers'ta HİÇBİR projeye (arşivdekiler dahil) kenarı yok VE adı hiçbir
//          proje künyesinin fotoğraf satırında geçmiyor.
//   FİRMA: pop-up'ın Projeler bölümü boş VE project_designers / project_brands'te HİÇBİR projeye
//          kenarı yok VE arşiv cascade'i hiçbir proje toplamıyor VE adı hiçbir fotoğraf künyesinde yok.
//   Arşivdeki projelere bağlı profiller de korunur: silmek o projelerin künyesinden kenarı koparır ve
//   proje ileride yayına alınırsa künyesi eksik çıkar.
//
// Projesi olmayıp BAŞKA içeriği (ürün, kurucu/ekip, firma, portfolyo) olan profiller SİLİNMEZ.
// SAHİPLİ profiller (üye kaydı / admin ataması / bekleyen talep / danışman) VARSAYILAN olarak
// SİLİNMEZ — emptyProfileAudit.js#fetchOwnership. --include-owned ile açıkça dahil edilebilir.
//
// VARSAYILAN DRY-RUN. Yazmak için --apply. --expect=N sayım kapısı.
// KULLANIM: node scripts/delete-projectless-preview-profiles.mjs --type=architects|offices [--apply] [--expect=N] [--skip=a,b]
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

globalThis.caches ||= { default: { match: async () => undefined, put: async () => {}, delete: async () => true } };

const { runContentAction } = await import('../src/routes/legacyContent.js');
const { buildOfficePayload } = await import('../src/routes/office.js');
const { buildArchitectPayload } = await import('../src/routes/architect.js');
const { collectOfficeArchiveTargets } = await import('../src/lib/officeArchiveCascade.js');
const { parseCanonicalRow } = await import('../src/lib/canonicalRead.js');
const { foldTr } = await import('../src/lib/textMatch.js');
const { PROFILE_KINDS, fetchPreviewProfiles, fetchPhotographerNameFolds, fetchOwnership, parseSkipList, isSkipped } =
  await import('../src/lib/emptyProfileAudit.js');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const APPLY = !!args.apply && !args['dry-run'];
const INCLUDE_OWNED = !!args['include-owned'];
const KIND = String(args.type || 'architects');
if (!PROFILE_KINDS[KIND]) throw new Error(`--type 'offices' ya da 'architects' olmalı (verilen: ${KIND}).`);
const KIND_LABEL = PROFILE_KINDS[KIND].label;

const ACCOUNT_ID = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim() || '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';


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


// R2 bağlaması Node'da yok: silme yolu görsel anahtarlarını R2'den silmeye çalışır. Burada no-op —
// yetim kalan görseller r2Reconcile taramasıyla temizlenir; satırlar yine eksiksiz silinir.
const env = {
  DB: d1(),
  UPLOADS: { head: async () => null, delete: async () => {}, get: async () => null, list: async () => ({ objects: [], truncated: false }) },
};
const adminRow = await env.DB.prepare(`SELECT id, email FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`).first();
if (!adminRow) throw new Error('Admin kullanıcı bulunamadı.');
const user = { id: adminRow.id, role: 'admin' };
console.log(`Admin: ${adminRow.email}   [tip: ${KIND}]${APPLY ? '   [SİLME AÇIK]' : '   [DRY-RUN — YAZMA YOK]'}\n`);

// Yapısal proje kenarları — pop-up'ın göremediği (arşivdeki projelere giden) bağlar dahil.
async function idSet(sql) {
  const { results } = await env.DB.prepare(sql).all();
  return new Set((results || []).map(r => r.id).filter(Boolean));
}
const edgeIds = KIND === 'architects'
  ? new Set([...(await idSet(`SELECT DISTINCT architect_id AS id FROM project_designers WHERE architect_id IS NOT NULL`)),
             ...(await idSet(`SELECT DISTINCT architect_id AS id FROM project_photographers WHERE architect_id IS NOT NULL`))])
  : new Set([...(await idSet(`SELECT DISTINCT office_id AS id FROM project_designers WHERE office_id IS NOT NULL`)),
             ...(await idSet(`SELECT DISTINCT office_id AS id FROM project_brands WHERE office_id IS NOT NULL`))]);

const previewRows = await fetchPreviewProfiles(env, KIND);
const [photographerFolds, ownership] = await Promise.all([fetchPhotographerNameFolds(env), fetchOwnership(env, KIND)]);
console.log(`Blurlu (önizleme) ${KIND_LABEL}: ${previewRows.length}`);

const audits = [];
let scanned = 0;
for (const raw of previewRows) {
  const row = parseCanonicalRow(KIND, raw);
  const payload = KIND === 'offices' ? await buildOfficePayload(env, row.slug) : await buildArchitectPayload(env, row.slug);
  const cascade = KIND === 'offices' ? await collectOfficeArchiveTargets(env, row) : null;
  const shownProjects = (payload.relatedProjects || []).length + (KIND === 'architects' ? (payload.photographedProjects || []).length : 0);
  const cascadeProjects = cascade ? (cascade.projects || []).length + (cascade.skipped?.projects || []).length : 0;
  const edge = edgeIds.has(row.id);
  const photographer = photographerFolds.has(foldTr(row.name || ''));
  const owned = ownership.ownedIds.has(row.id) || ownership.claimedFolds.has(foldTr(row.name || '')) || ownership.consultantSlugs.has(row.slug);
  const other = KIND === 'offices'
    ? { kurucu: (payload.founders || []).length, ekip: (payload.team || []).length, urun: (payload.relatedProducts || []).length + (payload.relatedMaterials || []).length }
    : { firma: (payload.offices || []).length, urun: (payload.relatedProducts || []).length, portfolyo: ((payload.item || {}).portfolio || []).length };
  audits.push({ name: row.name, slug: row.slug, shownProjects, cascadeProjects, edge, photographer, owned, other,
    noProject: shownProjects === 0 && cascadeProjects === 0 && !edge && !photographer });
  if (++scanned % 25 === 0) console.log(`   ... tarandı ${scanned}/${previewRows.length}`);
}

const skipFolds = parseSkipList(args.skip === true ? '' : args.skip);
const otherText = (a) => Object.entries(a.other).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ');
const projectless = audits.filter(a => a.noProject);
const skipped = projectless.filter(a => isSkipped(a, skipFolds));
const ownedOnes = projectless.filter(a => a.owned && !isSkipped(a, skipFolds));
// BAŞKA İÇERİĞİ OLAN profil de SİLİNMEZ (kullanıcı kararı, 2026-09-17: "Projesi yok ama başka
// içeriği var olanları silme") — ürünü, kurucusu/ekibi, firması ya da portfolyosu olan kayıt korunur.
const hasOther = (a) => Object.values(a.other).some(n => n > 0);
const otherOnes = projectless.filter(a => hasOther(a) && !isSkipped(a, skipFolds) && (INCLUDE_OWNED || !a.owned));
const toDelete = projectless.filter(a => !isSkipped(a, skipFolds) && (INCLUDE_OWNED || !a.owned) && !hasOther(a));
const kept = audits.filter(a => !a.noProject);

console.log(`\n=== SİLİNECEK (projesi yok${INCLUDE_OWNED ? ', sahipliler DAHİL' : ''}): ${toDelete.length} ===`);
for (const a of toDelete) console.log(`   · ${a.name}   (${a.slug})${otherText(a) ? '   [başka içerik: ' + otherText(a) + ']' : ''}${a.owned ? '   [SAHİPLİ]' : ''}`);
console.log(`\n=== KORUNDU — projesi yok ama BAŞKA içeriği var: ${otherOnes.length} ===`);
for (const a of otherOnes) console.log(`   · ${a.name}   (${a.slug})   [${otherText(a)}]`);
if (!INCLUDE_OWNED) {
  console.log(`\n=== KORUNDU — projesi yok ama SAHİPLİ (üye kaydı / atama / talep / danışman): ${ownedOnes.length} ===`);
  for (const a of ownedOnes) console.log(`   · ${a.name}   (${a.slug})`);
}
if (skipFolds.size) {
  console.log(`\n=== ELLE DIŞLANDI (--skip): ${skipped.length} ===`);
  for (const a of skipped) console.log(`   · ${a.name}   (${a.slug})`);
}
console.log(`\n=== DOKUNULMADI — projesi var: ${kept.length} ===`);
for (const a of kept) {
  const why = [a.shownProjects && `${a.shownProjects} görünen proje`, a.cascadeProjects && `${a.cascadeProjects} bağlı proje`, a.edge && 'proje kenarı (arşivdekiler dahil)', a.photographer && 'fotoğraf künyesi'].filter(Boolean).join(', ');
  console.log(`   · ${a.name} — ${why}`);
}

if (args.expect !== undefined && Number(args.expect) !== toDelete.length) {
  throw new Error(`${KIND_LABEL} sayısı beklenenden farklı: beklenen ${args.expect}, bulunan ${toDelete.length} — hiçbir şey silinmedi.`);
}
if (!APPLY) { console.log('\n[DRY-RUN] Hiçbir şey silinmedi. Gerçekten silmek için --apply.'); process.exit(0); }
if (!toDelete.length) { console.log(`\nSilinecek ${KIND_LABEL} yok.`); process.exit(0); }

console.log('\n--- SİLİNİYOR ---');
const failed = [];
let done = 0;
for (const a of toDelete) {
  const res = await runContentAction(env, user, { type: KIND, action: 'delete', key: a.name });
  if (res && res.status >= 400) { failed.push(a.name); console.log(`   HATA ${a.name} (${res.status})`); continue; }
  const still = await env.DB.prepare(`SELECT id FROM ${PROFILE_KINDS[KIND].table} WHERE slug = ? AND deleted_at IS NULL`).bind(a.slug).first();
  if (still) { failed.push(a.name); console.log(`   HATA ${a.name} — satır hâlâ duruyor`); continue; }
  done++;
  console.log(`   silindi: ${a.name}`);
}
console.log(`\n=== ÖZET ===\nSilindi : ${done}/${toDelete.length}`);
if (failed.length) { console.log(`\nBAŞARISIZ (${failed.length}): ${failed.join(', ')}`); process.exit(1); }
console.log('Tamam.');
