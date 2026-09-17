#!/usr/bin/env node
// FOTOĞRAF SAYFASI — MEKAN SINIFLANDIRMASI (AI) GERİ DOLDURMA
// (kullanıcı isteği, 2026-09-17: "Mekan filtremesini yapay zeka yapsın.")
//
// NE YAPAR: canlı projelerin görsellerini indirir, her birini bir vision modeline sorar
// (bkz. src/lib/photoSpaceClassify.js — model kademesi src/lib/visionAnalyze.js#VISION_CANDIDATES
// ile PAYLAŞILIR) ve dönen mekan etiketlerini `projects.image_spaces`e (görsel URL'sine anahtarlı
// JSON, bkz. migrations/0124_project_image_spaces.sql) yazar. /fotograf sayfasındaki "Mekana Göre
// Ara" filtresinin EN İSABETLİ sinyali bu kolondur (src/lib/photoPool.js; anlık ikinci sinyal CLIP
// ipucudur, bkz. src/lib/photoSpaceClip.js).
//
// ============================================================================================
// 2026-09-18 BEŞİNCİ TUR — ÜÇ DEĞİŞİKLİK, ÜÇÜ DE ÖLÇÜMDEN
// ============================================================================================
// 1. PARALEL: betik görselleri TEK TEK, sırayla işliyordu — canlıda saatte ~280 görsel (görsel
//    başına ~13 sn: indirme + vision çağrısı). 11.058 görsellik havuz ~40 saat sürerdi; GitHub'ın
//    iş sınırı 6 saat. Filtrelerin boş kalmasının ASIL nedeni buydu (yalnızca 275 görsel etiketli).
//    Artık `--concurrency` kadar görsel aynı anda işlenir (varsayılan 10); tam havuz tek turda biter.
// 2. v2 ETİKET: v1 promptunun yazdığı girdiler (düz dizi) güvenilmez bulundu (bkz.
//    photoSpaceClassify.js dosya başı). `{v:2,...}` OLMAYAN her girdi "etiketsiz" sayılır ve
//    yeniden işlenir — `--force` gerekmez. `--force` yalnızca v2 girdilerini de yenilemek içindir.
// 3. DEĞERLENDİRME MODU (`--eval`): scripts/photo-space-gold.json'daki GÖZLE ETİKETLENMİŞ 656
//    görseli sınıflandırır ve sınıf başına isabet/kapsama yazar. HİÇBİR ŞEY YAZMAZ. Prompt
//    değişikliği canlıya çıkmadan önce bununla ölçülür.
//
// NEDEN BİR BETİK, NEDEN CANLI İSTEK YOLUNDA DEĞİL: sınıflandırma görsel BAŞINA bir vision modeli
// çağrısıdır (saniyeler + nöron kotası). Bunu bir okuma isteğinde yapmak sayfayı dakikalarca
// bekletirdi. ETİKETLEME ÇEVRİMDIŞI: sonuç D1'de kalıcıdır, sayfa yalnızca hazır etiketi okur.
//
// ÖNEMLİ — `env.AI` BURADA BİR REST ADAPTÖRÜDÜR: Workers AI binding'i yalnızca deploy edilmiş bir
// Worker içinde vardır; bu betik Node'da koştuğu için Cloudflare'ın `/ai/run/:model` REST ucunu
// env.AI.run(model, opts) ile AYNI şekli döndüren küçük bir sarmalayıcıyla kullanır (bkz.
// scripts/gundem-retitle-backfill.mjs'teki BİREBİR AYNI desen ve gerekçe).
//
// KULLANIM:
//   node scripts/photo-space-classify-backfill.mjs                    # dry-run, en yeni 5 proje
//   node scripts/photo-space-classify-backfill.mjs --limit=20
//   node scripts/photo-space-classify-backfill.mjs --all --apply      # TÜM canlı projeler (yalnızca eksikler)
//   node scripts/photo-space-classify-backfill.mjs --eval             # gözle etiketli kümede ÖLÇ (yazmaz)
//
// SEÇENEKLER
//   --limit=N            kaç PROJE (varsayılan 5; --all verilirse yok sayılır)
//   --all                TÜM canlı projeler (en yeniden geriye)
//   --offset=N           en yeniden geriye doğru ilk N projeyi atla
//   --max-images=N       proje başına en fazla N görsel (varsayılan 0 = sınırsız)
//   --slug=a,b           yalnızca bu proje slug'ları
//   --force              v2 etiketli görselleri de yeniden sınıflandır
//   --concurrency=N      aynı anda işlenen görsel sayısı (varsayılan 10)
//   --max-minutes=N      bu kadar dakikadan sonra YENİ görsel alma, yazılanları kaydet ve çık (varsayılan 320)
//   --eval[=dosya]       değerlendirme modu (varsayılan scripts/photo-space-gold.json)
//   --eval-limit=N       değerlendirmede en fazla N görsel
//   --index-report       CLIP görsel dizininin (KV) havuzu NE KADAR kapsadığını raporla (yazmaz, AI çağırmaz)
//   --apply              D1'e YAZ (varsayılan: yazma yok)
//
// KİMLİK BİLGİSİ: CI'da (bkz. .github/workflows/photo-space-classify.yml) CLOUDFLARE_API_TOKEN
// sırrı kullanılır; yerelde wrangler OAuth token'ına düşer (gundem-retitle-backfill.mjs'teki AYNI
// TOKEN_PATHS/refreshToken mekaniği — token 1 saatte dolduğu için uzun turlarda yenilenir).
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { classifyPhotoSpace, storedSpaceEntry, SPACE_LABEL_VERSION, PHOTO_SPACE_OPTIONS } from '../src/lib/photoSpaceClassify.js';
import { unpackImageIndex, imageIndexKvKey } from '../src/lib/imageEmbedIndex.js';
import { canonicalImageKey, clipHintForRow, clipIsDrawing, clipVerdict } from '../src/lib/photoSpaceClip.js';

const ACCOUNT_ID = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim() || '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';
const KV_NAMESPACE_ID = '9a8a1cfde13447a498bc5dcc4bc7d4ae'; // FACET_CACHE (wrangler.jsonc)
// Görseller canlı siteden indirilir (R2'ye doğrudan erişim gerekmez; /media/ yolu zaten herkese
// açık ve türev üretimini de o yol yapıyor — bkz. image-cdn.js#derivativeUrl). Sınıflandırma için
// 800px'lik türev YETERLİ ve indirmeyi hızlandırır (orijinaller 3-8 MB olabiliyor).
const SITE_ORIGIN = (process.env.MIMARLAB_ORIGIN || 'https://mimarlab.com').replace(/\/$/, '');
const CLASSIFY_WIDTH = 800;
const VISION_TIMEOUT_MS = 60000;

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const APPLY = !!args.apply;
const ALL = !!args.all;
const LIMIT = Number(args.limit ?? 5);
const OFFSET = Number(args.offset ?? 0);
const MAX_IMAGES = Number(args['max-images'] ?? 0);
const FORCE = !!args.force;
const CONCURRENCY = Math.min(32, Math.max(1, Number(args.concurrency ?? 10) || 10));
const MAX_MINUTES = Math.max(1, Number(args['max-minutes'] ?? 320) || 320);
const INDEX_REPORT = !!args['index-report'];
const EVAL = args.eval !== undefined;
const EVAL_FILE = typeof args.eval === 'string' ? args.eval : new URL('./photo-space-gold.json', import.meta.url).pathname;
const EVAL_LIMIT = Number(args['eval-limit'] ?? 0);
const ONLY_SLUGS = typeof args.slug === 'string' ? args.slug.split(',').map(s => s.trim()).filter(Boolean) : null;
const STARTED = Date.now();
const outOfTime = () => (Date.now() - STARTED) / 60000 >= MAX_MINUTES;

// ---------------------------------------------------------------------------------------------
// Cloudflare kimlik/istek katmanı — gundem-retitle-backfill.mjs ile aynı mekanik.
// ---------------------------------------------------------------------------------------------
const TOKEN_PATHS = [
  `${homedir()}/Library/Preferences/.wrangler/config/default.toml`,
  `${homedir()}/.wrangler/config/default.toml`,
  `${homedir()}/.config/.wrangler/config/default.toml`,
];
function readTokenFile() {
  for (const p of TOKEN_PATHS) {
    try { return readFileSync(p, 'utf8'); } catch { /* sıradaki yol */ }
  }
  throw new Error('wrangler OAuth token bulunamadı — `npx wrangler login` çalıştırın ya da CLOUDFLARE_API_TOKEN verin.');
}
function oauthToken() {
  const m = readTokenFile().match(/oauth_token\s*=\s*"([^"]+)"/);
  if (!m) throw new Error('wrangler OAuth token bulunamadı — `npx wrangler login` çalıştırın.');
  return m[1];
}
const ENV_TOKEN = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
let TOKEN = ENV_TOKEN || oauthToken();
let refreshing = null;
function refreshToken(reason) {
  if (ENV_TOKEN) return false;
  // Paralel işçiler aynı anda yetki hatası alabilir: yenileme TEK sefer yapılır.
  if (!refreshing) {
    refreshing = (async () => {
      try { execFileSync('npx', ['wrangler', 'whoami'], { stdio: 'ignore', timeout: 90000 }); } catch { /* yoksay */ }
      const before = TOKEN;
      TOKEN = oauthToken();
      console.log(`  [token] ${reason} -> ${TOKEN === before ? 'DEĞİŞMEDİ' : 'yenilendi'}`);
      setTimeout(() => { refreshing = null; }, 5000);
      return TOKEN !== before;
    })();
  }
  return refreshing;
}
function isAuthFailure(status, json) {
  if (status === 401 || status === 403) return true;
  const codes = ((json && json.errors) || []).map(e => e && e.code);
  return codes.includes(7403) || codes.includes(10000);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Ağ hatası / 429 / 5xx: üstel beklemeyle yeniden dene (paralel çalışmada hız sınırına ve geçici
// ağ kopmalarına takılmak olağan — 2026-09-17 dördüncü turdaki EHOSTUNREACH çöküşünün dersi).
async function cfFetch(url, body, attempts = 5) {
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let res, json;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      json = await res.json();
    } catch (err) { lastErr = err; await sleep(1500 * (attempt + 1)); continue; }
    if (json && json.success) return json;
    if (isAuthFailure(res.status, json) && await refreshToken('istek yetki hatası aldı')) continue;
    lastErr = new Error(JSON.stringify((json && json.errors) || json).slice(0, 300));
    lastErr.httpStatus = res.status;
    if (res.status === 429 || res.status >= 500) { await sleep(2500 * (attempt + 1)); continue; }
    throw lastErr;
  }
  throw lastErr;
}
async function d1(sql, params = []) {
  const json = await cfFetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
    { sql, params }
  );
  return json.result[0].results || [];
}
// env.AI adaptörü — Workers AI REST API, env.AI.run(model, opts) ile AYNI şekli döndürür.
let aiCalls = 0;
const env = {
  AI: {
    async run(model, opts) {
      aiCalls++;
      // attempts=3: classifyPhotoSpace zaten aday modeller arasında düşer; burada yalnızca geçici
      // hata (429/5xx/ağ) için kısa bir yeniden deneme yeterli.
      const json = await cfFetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${model}`, opts, 3);
      return json.result;
    },
  },
};

// ---------------------------------------------------------------------------------------------
// GÖRSELİ İNDİR — /media/_derived/w800/... yolu (image-cdn.js#derivativeUrl ile AYNI şema:
// R2 nesnesi "/media/x" -> /media/_derived/w<W>/r2/x ; statik varlık "projects/x" -> .../s/projects/x).
// Türev yoksa/başarısızsa orijinal yola düşülür.
// ---------------------------------------------------------------------------------------------
function derivedUrlFor(rawPath) {
  let p = String(rawPath || '');
  if (/^https?:\/\//i.test(p)) {
    if (!p.startsWith(SITE_ORIGIN)) return p; // dış kaynaklı görsel olduğu gibi
    p = p.slice(SITE_ORIGIN.length);
  }
  const clean = p.replace(/^\/+/, '');
  if (clean.startsWith('media/')) return `${SITE_ORIGIN}/media/_derived/w${CLASSIFY_WIDTH}/r2/${clean.slice('media/'.length)}`;
  return `${SITE_ORIGIN}/media/_derived/w${CLASSIFY_WIDTH}/s/${clean}`;
}
function originalUrlFor(rawPath) {
  if (/^https?:\/\//i.test(rawPath)) return rawPath;
  return `${SITE_ORIGIN}/${String(rawPath || '').replace(/^\/+/, '')}`;
}
async function downloadImage(rawPath) {
  for (const url of [derivedUrlFor(rawPath), originalUrlFor(rawPath)]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'MimarlabPhotoSpaceClassify/2.0' } });
        if (!res.ok) break;
        const buf = new Uint8Array(await res.arrayBuffer());
        if (!buf.length) break;
        const mime = res.headers.get('content-type') || 'image/jpeg';
        return { bytes: buf, mime: mime.split(';')[0].trim() };
      } catch { await sleep(800); }
    }
  }
  return null;
}

function parseJsonArr(t) { try { const v = t ? JSON.parse(t) : []; return Array.isArray(v) ? v : []; } catch { return []; } }
function parseJsonObj(t) { try { const v = t ? JSON.parse(t) : {}; return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } }
const isV2 = (entry) => !!entry && typeof entry === 'object' && !Array.isArray(entry) && Number(entry.v) === SPACE_LABEL_VERSION;
const contextOf = (row) => ({
  title: row.title, description: row.description,
  discipline: parseJsonArr(row.discipline), category: parseJsonArr(row.category), type: parseJsonArr(row.type),
});
const fmt = (r) => `${r.scene || '?'} | ${r.spaces.length ? r.spaces.map(s => `${s.label}${s.confidence != null ? ` (${s.confidence.toFixed(2)})` : ''}`).join(' + ') : '(etiket yok)'}`;

// N işçili basit havuz: `jobs` sırayla tüketilir (sıra = en yeni proje önce).
async function runPool(jobs, worker) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
    for (;;) {
      if (outOfTime()) return;
      const i = next++;
      if (i >= jobs.length) return;
      await worker(jobs[i], i);
    }
  }));
}

// =============================================================================================
// DİZİN RAPORU — CLIP ipucu (src/lib/photoSpaceClip.js) görsel arama dizinindeki embedding'lerden
// hesaplanır. Dizinde OLMAYAN görsel ipucu alamaz; bu mod kapsamı ve ipuçlarının mekan başına kaç
// sonuç üreteceğini ÖLÇER. Hiçbir şey yazmaz, AI çağırmaz.
// =============================================================================================
if (INDEX_REPORT) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encodeURIComponent(imageIndexKvKey('project'))}`,
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
  if (!res.ok) { console.log(`DİZİN OKUNAMADI: HTTP ${res.status}`); process.exit(1); }
  const index = unpackImageIndex(await res.arrayBuffer());
  if (!index) { console.log('DİZİN ÇÖZÜLEMEDİ'); process.exit(1); }
  const totalRows = index.entities.reduce((a, e) => a + e.c, 0);
  console.log(`DİZİN: ${index.entities.length} proje, ${totalRows} görsel, built=${index.header.built}, model=${index.header.model}`);
  const projects = await d1(`SELECT slug, images FROM projects WHERE deleted_at IS NULL AND hidden_at IS NULL ORDER BY created_at DESC, id DESC`);
  let images = 0, indexed = 0, projectsMissing = 0, drawings = 0;
  const strong = new Map();
  const missingBySlug = [];
  for (const p of projects) {
    const urls = parseJsonArr(p.images).filter(u => typeof u === 'string' && u);
    if (!urls.length) continue;
    const e = index.entityBySlug.get(p.slug);
    const rowByKey = new Map();
    if (e) for (let i = 0; i < e.c; i++) rowByKey.set(canonicalImageKey(e.k[i]), e.offset + i);
    let miss = 0;
    for (const u of urls) {
      images++;
      const row = rowByKey.get(canonicalImageKey(u));
      if (row == null) { miss++; continue; }
      indexed++;
      const hint = clipHintForRow(index.rowOf(row));
      if (clipIsDrawing(hint)) { drawings++; continue; }
      if (hint.t && !hint.t.startsWith('_') && clipVerdict(hint, hint.t, false) === 'strong') strong.set(hint.t, (strong.get(hint.t) || 0) + 1);
    }
    if (miss) { missingBySlug.push([p.slug, miss, urls.length]); if (!e) projectsMissing++; }
  }
  console.log(`HAVUZ: ${projects.length} proje, ${images} görsel  ->  dizinde ${indexed} (%${(100 * indexed / Math.max(1, images)).toFixed(1)}), eksik ${images - indexed}`);
  console.log(`  dizinde HİÇ olmayan proje: ${projectsMissing}; kısmen eksik proje: ${missingBySlug.length - projectsMissing}`);
  console.log(`  CLIP'in çizim dediği (sayfadan düşecek): ${drawings}`);
  console.log(`  CLIP GÜÇLÜ eşleşme (LLM bakmadan sonuç üretecek):`);
  for (const l of PHOTO_SPACE_OPTIONS) console.log(`    ${String(strong.get(l) || 0).padStart(5)}  ${l}`);
  console.log(`  eksik görseli olan ilk 25 proje (slug, eksik/toplam):`);
  for (const [slug, miss, total] of missingBySlug.slice(0, 25)) console.log(`    ${slug}  ${miss}/${total}`);
  process.exit(0);
}

// =============================================================================================
// DEĞERLENDİRME MODU
// =============================================================================================
if (EVAL) {
  const gold = JSON.parse(readFileSync(EVAL_FILE, 'utf8')).items;
  const sample = EVAL_LIMIT > 0 ? gold.slice(0, EVAL_LIMIT) : gold;
  console.log(`DEĞERLENDİRME — ${sample.length} gözle etiketli görsel, eşzamanlılık ${CONCURRENCY}  [yazma YOK]`);
  const slugs = [...new Set(sample.map(g => g.slug))];
  const ctxBySlug = new Map();
  for (let i = 0; i < slugs.length; i += 80) {
    const part = slugs.slice(i, i + 80);
    const rows = await d1(`SELECT slug, title, description, discipline, category, type FROM projects WHERE slug IN (${part.map(() => '?').join(',')})`, part);
    for (const r of rows) ctxBySlug.set(r.slug, contextOf(r));
  }
  const results = [];
  let done = 0, failed = 0;
  await runPool(sample, async (g) => {
    const img = await downloadImage(g.url);
    if (!img) { failed++; return; }
    try {
      const r = await classifyPhotoSpace(env, img.bytes, VISION_TIMEOUT_MS, img.mime, ctxBySlug.get(g.slug));
      results.push({ url: g.url, yes: g.yes, no: g.no, goldScene: g.scene || null, scene: r.scene, spaces: r.spaces });
    } catch (err) { failed++; console.log(`  ! ${g.url}: ${String(err.message || err).slice(0, 100)}`); }
    if (++done % 50 === 0) console.log(`  ${done}/${sample.length}  (${((Date.now() - STARTED) / 1000).toFixed(0)} sn)`);
  });
  const rows = [];
  for (const label of PHOTO_SPACE_OPTIONS) {
    let tp = 0, fn = 0, fp = 0, tn = 0, tpPrimary = 0;
    for (const r of results) {
      const searchable = r.spaces.filter(s => PHOTO_SPACE_OPTIONS.includes(s.label));
      const has = searchable.some(s => s.label === label);
      if (r.yes.includes(label)) { if (has) { tp++; if (r.spaces[0] && r.spaces[0].label === label) tpPrimary++; } else fn++; }
      else if (r.no.includes(label)) { if (has) fp++; else tn++; }
    }
    rows.push({ label, tp, fn, fp, tn, tpPrimary });
  }
  console.log(`\nSINIF BAŞINA (gözle etiketli kümede; isabet = TP/(TP+FP), kapsama = TP/(TP+FN))`);
  for (const r of rows) {
    const prec = r.tp + r.fp ? (100 * r.tp / (r.tp + r.fp)).toFixed(0) : '-';
    const rec = r.tp + r.fn ? (100 * r.tp / (r.tp + r.fn)).toFixed(0) : '-';
    console.log(`  ${r.label.padEnd(16)} isabet %${String(prec).padStart(3)}  kapsama %${String(rec).padStart(3)}   TP ${r.tp} (birincil ${r.tpPrimary})  FN ${r.fn}  FP ${r.fp}  TN ${r.tn}`);
  }
  const T = rows.reduce((a, r) => ({ tp: a.tp + r.tp, fn: a.fn + r.fn, fp: a.fp + r.fp }), { tp: 0, fn: 0, fp: 0 });
  console.log(`  ${'TOPLAM'.padEnd(16)} isabet %${(100 * T.tp / Math.max(1, T.tp + T.fp)).toFixed(1)}  kapsama %${(100 * T.tp / Math.max(1, T.tp + T.fn)).toFixed(1)}`);
  const ext = results.filter(r => r.goldScene === 'dis_cephe');
  const extBad = ext.filter(r => r.spaces.some(s => PHOTO_SPACE_OPTIONS.includes(s.label)));
  console.log(`\nDIŞ CEPHE KÜMESİ: ${ext.length} görsel, aranabilir mekan etiketi ALAN (yanlış): ${extBad.length}`);
  console.log(`  sahne dağılımı: ${JSON.stringify(ext.reduce((a, r) => { a[r.scene || '?'] = (a[r.scene || '?'] || 0) + 1; return a; }, {}))}`);
  console.log(`\nYANLIŞ POZİTİFLER:`);
  for (const r of results) {
    const bad = r.spaces.filter(s => PHOTO_SPACE_OPTIONS.includes(s.label) && r.no.includes(s.label));
    if (bad.length) console.log(`  ${r.url}  -> ${fmt(r)}   [olmamalı: ${bad.map(s => s.label).join(', ')}]`);
  }
  console.log(`\nKAÇIRILANLAR:`);
  for (const r of results) {
    const miss = r.yes.filter(l => !r.spaces.some(s => s.label === l));
    if (miss.length) console.log(`  ${r.url}  -> ${fmt(r)}   [olmalı: ${miss.join(', ')}]`);
  }
  try { writeFileSync('photo-space-eval-result.json', JSON.stringify(results)); } catch { /* yoksay */ }
  console.log(`\n${results.length} sınıflandırıldı, ${failed} başarısız, AI çağrısı ${aiCalls}, süre ${((Date.now() - STARTED) / 60000).toFixed(1)} dk`);
  process.exit(0);
}

// =============================================================================================
// ETİKETLEME MODU
// =============================================================================================
// Havuzla AYNI görünürlük (src/lib/photoPool.js): blurlu/arşivdeki proje sayfada hiç görünmez,
// görünmeyecek bir görsele AI çağrısı harcanmaz. Blur kalktığında bir sonraki tur onu işler.
const where = ['deleted_at IS NULL', 'hidden_at IS NULL'];
const params = [];
if (ONLY_SLUGS) { where.push(`slug IN (${ONLY_SLUGS.map(() => '?').join(',')})`); params.push(...ONLY_SLUGS); }

console.log(`FOTOĞRAF mekan sınıflandırması — ${ALL ? 'TÜM canlı projeler' : `en yeni ${LIMIT} proje`}${APPLY ? '  [APPLY: D1 GÜNCELLENECEK]' : '  [DRY-RUN: yazma YOK]'}`);
console.log(`  origin=${SITE_ORIGIN}  force=${FORCE ? 'evet' : 'hayır'}  max-images=${MAX_IMAGES || 'sınırsız'}  eşzamanlılık=${CONCURRENCY}  süre sınırı=${MAX_MINUTES} dk`);

const rows = await d1(
  `SELECT id, slug, title, images, image_spaces, discipline, category, type, description FROM projects
   WHERE ${where.join(' AND ')}
   ORDER BY created_at DESC, id DESC
   LIMIT ? OFFSET ?`,
  [...params, ALL ? 100000 : LIMIT, OFFSET]
);
console.log(`  ${rows.length} proje okundu.`);

let projectsWritten = 0, imagesClassified = 0, imagesSkipped = 0, imagesFailed = 0;
const tally = new Map();
const sceneTally = new Map();
const jobs = [];
const states = new Map(); // project id -> { row, images, results: Map(url -> entry), pending }

for (const row of rows) {
  const images = parseJsonArr(row.images).filter(u => typeof u === 'string' && u);
  if (!images.length) continue;
  const spacesByUrl = parseJsonObj(row.image_spaces);
  const targets = (MAX_IMAGES > 0 ? images.slice(0, MAX_IMAGES) : images).filter(u => FORCE || !isV2(spacesByUrl[u]));
  imagesSkipped += images.length - targets.length;
  if (!targets.length) continue;
  states.set(row.id, { row, images, results: new Map(), pending: targets.length });
  for (const url of targets) jobs.push({ projectId: row.id, url });
}
console.log(`  ${jobs.length} görsel işlenecek (${states.size} proje), ${imagesSkipped} zaten v2 etiketli.\n`);

// Proje tamamlanınca YAZ. Yazmadan hemen önce kolon YENİDEN okunur ve birleştirilir: başka bir
// tur/oturum aynı projeye bu arada etiket yazmışsa üzerine basılmaz. Projede artık OLMAYAN
// görsellerin girdileri bu sırada atılır (kolon sınırsız büyümesin).
async function flushProject(state) {
  if (!state.results.size) return;
  if (APPLY) {
    const fresh = await d1(`SELECT images, image_spaces FROM projects WHERE id = ?`, [state.row.id]);
    const live = new Set(parseJsonArr(fresh[0] && fresh[0].images));
    const merged = parseJsonObj(fresh[0] && fresh[0].image_spaces);
    for (const [url, entry] of state.results) merged[url] = entry;
    for (const k of Object.keys(merged)) if (!live.has(k)) delete merged[k];
    await d1(`UPDATE projects SET image_spaces = ? WHERE id = ?`, [JSON.stringify(merged), state.row.id]);
  }
  projectsWritten++;
  console.log(`- ${state.row.title || state.row.slug}: ${state.results.size}/${state.images.length} görsel ${APPLY ? 'yazıldı' : 'yazılacaktı'}`);
  state.results = new Map();
}

await runPool(jobs, async (job) => {
  const state = states.get(job.projectId);
  try {
    const img = await downloadImage(job.url);
    if (!img) { imagesFailed++; console.log(`    ! indirilemedi: ${job.url}`); return; }
    // Proje künyesi bağlam olarak (bkz. photoSpaceClassify.js#buildContextNote).
    const result = await classifyPhotoSpace(env, img.bytes, VISION_TIMEOUT_MS, img.mime, contextOf(state.row));
    state.results.set(job.url, storedSpaceEntry(result));
    imagesClassified++;
    sceneTally.set(result.scene || '?', (sceneTally.get(result.scene || '?') || 0) + 1);
    for (const s of result.spaces) tally.set(s.label, (tally.get(s.label) || 0) + 1);
    if (!ALL || imagesClassified % 100 === 0) console.log(`    [${imagesClassified}] ${fmt(result)}  <- ${job.url}`);
  } catch (err) {
    imagesFailed++;
    console.log(`    ! sınıflandırılamadı (${job.url}): ${String(err.message || err).slice(0, 120)}`);
  } finally {
    state.pending--;
    if (state.pending === 0) {
      try { await flushProject(state); } catch (err) { console.log(`    ! YAZILAMADI (${state.row.slug}): ${String(err.message || err).slice(0, 160)}`); }
    }
  }
});
// Süre sınırına takılan turda yarım kalan projelerin BİTEN görselleri de yazılır.
for (const state of states.values()) {
  if (state.results.size) { try { await flushProject(state); } catch (err) { console.log(`    ! YAZILAMADI (${state.row.slug}): ${String(err.message || err).slice(0, 160)}`); } }
}

const remaining = jobs.length - imagesClassified - imagesFailed;
console.log(`\nÖZET`);
console.log(`  proje  : ${projectsWritten} ${APPLY ? 'güncellendi' : 'güncellenecekti (dry-run)'}`);
console.log(`  görsel : ${imagesClassified} sınıflandırıldı, ${imagesSkipped} atlandı (zaten v2 etiketli), ${imagesFailed} başarısız${remaining > 0 ? `, ${remaining} SÜRE SINIRI nedeniyle sonraki tura kaldı` : ''}`);
console.log(`  AI çağrısı: ${aiCalls}   süre: ${((Date.now() - STARTED) / 60000).toFixed(1)} dk`);
if (sceneTally.size) console.log(`  sahne dağılımı: ${[...sceneTally.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  ')}`);
if (tally.size) {
  console.log(`  etiket dağılımı:`);
  for (const [k, v] of [...tally.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(5)}  ${k}`);
}
if (!APPLY) console.log(`\n(DRY-RUN — hiçbir şey yazılmadı. Yazmak için --apply ekleyin.)`);
