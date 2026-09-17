#!/usr/bin/env node
// FOTOĞRAF SAYFASI — MEKAN SINIFLANDIRMASI (AI) GERİ DOLDURMA
// (kullanıcı isteği, 2026-09-17: "Mekan filtremesini yapay zeka yapsın.")
//
// NE YAPAR: canlı projelerin görsellerini tek tek indirir, her birini bir vision modeline sorar
// (bkz. src/lib/photoSpaceClassify.js — model kademesi src/lib/visionAnalyze.js#VISION_CANDIDATES
// ile PAYLAŞILIR) ve dönen mekan etiketlerini `projects.image_spaces`e (görsel URL'sine anahtarlı
// JSON, bkz. migrations/0124_project_image_spaces.sql) yazar. /fotograf sayfasındaki "Mekana Göre
// Ara" filtresi YALNIZCA bu kolonu okur (src/lib/photoPool.js).
//
// NEDEN BİR BETİK, NEDEN CANLI İSTEK YOLUNDA DEĞİL: sınıflandırma görsel BAŞINA bir vision modeli
// çağrısıdır (saniyeler + nöron kotası). Bunu bir okuma isteğinde (ör. /api/photos) yapmak sayfayı
// dakikalarca bekletir ve her önbellek boşalmasında tekrarlanırdı. Bu yüzden ETİKETLEME ÇEVRİMDIŞI:
// betik bir kez koşar, sonuç D1'de kalıcı olur, sayfa yalnızca hazır etiketi okur.
//
// ÖNEMLİ — `env.AI` BURADA BİR REST ADAPTÖRÜDÜR: Workers AI binding'i yalnızca deploy edilmiş bir
// Worker içinde vardır; bu betik Node'da koştuğu için Cloudflare'ın `/ai/run/:model` REST ucunu
// env.AI.run(model, opts) ile AYNI şekli döndüren küçük bir sarmalayıcıyla kullanır (bkz.
// scripts/gundem-retitle-backfill.mjs'teki BİREBİR AYNI desen ve gerekçe).
//
// YALNIZCA EKSİKLERİ İŞLER (varsayılan): bir görselin `image_spaces`te zaten bir girdisi varsa
// atlanır — betik tekrar tekrar çalıştırılabilir, yalnızca yeni eklenen görseller için AI çağrısı
// yapar. `--force` bunu kapatır (tüm görseller yeniden sınıflandırılır).
//
// KULLANIM:
//   node scripts/photo-space-classify-backfill.mjs                    # dry-run, en yeni 5 proje
//   node scripts/photo-space-classify-backfill.mjs --limit=20
//   node scripts/photo-space-classify-backfill.mjs --limit=5 --apply  # küçük örneklemi GERÇEKTEN yaz
//   node scripts/photo-space-classify-backfill.mjs --all --apply      # TÜM canlı projeler
//
// SEÇENEKLER
//   --limit=N            kaç PROJE (varsayılan 5; --all verilirse yok sayılır)
//   --all                TÜM canlı projeler (en yeniden geriye)
//   --offset=N           en yeniden geriye doğru ilk N projeyi atla (yarıda kalan turu sürdürmek için)
//   --max-images=N       proje başına en fazla N görsel (varsayılan 0 = sınırsız)
//   --slug=a,b           yalnızca bu proje slug'ları
//   --force              zaten etiketli görselleri de yeniden sınıflandır
//   --apply              D1'e YAZ (varsayılan: yazma yok)
//
// KİMLİK BİLGİSİ: CI'da (bkz. .github/workflows/photo-space-classify.yml) CLOUDFLARE_API_TOKEN
// sırrı kullanılır; yerelde wrangler OAuth token'ına düşer (gundem-retitle-backfill.mjs'teki AYNI
// TOKEN_PATHS/refreshToken mekaniği — token 1 saatte dolduğu için uzun turlarda yenilenir).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { classifyPhotoSpace } from '../src/lib/photoSpaceClassify.js';

const ACCOUNT_ID = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim() || '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';
// Görseller canlı siteden indirilir (R2'ye doğrudan erişim gerekmez; /media/ yolu zaten herkese
// açık ve türev üretimini de o yol yapıyor — bkz. image-cdn.js#derivativeUrl). Sınıflandırma için
// 800px'lik türev YETERLİ ve indirmeyi hızlandırır (orijinaller 3-8 MB olabiliyor).
const SITE_ORIGIN = (process.env.MIMARLAB_ORIGIN || 'https://mimarlab.com').replace(/\/$/, '');
const CLASSIFY_WIDTH = 800;
const VISION_TIMEOUT_MS = 40000;

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
const ONLY_SLUGS = typeof args.slug === 'string' ? args.slug.split(',').map(s => s.trim()).filter(Boolean) : null;

// ---------------------------------------------------------------------------------------------
// Cloudflare kimlik/istek katmanı — gundem-retitle-backfill.mjs ile BİREBİR aynı (tek kaynak
// yapılabilirdi ama o betik kendi içinde bağımsız kalacak şekilde yazılmış; buradaki kopya
// bilinçli ve YALNIZCA bu iki fonksiyonu kapsıyor).
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
function refreshToken(reason) {
  if (ENV_TOKEN) return false;
  try { execFileSync('npx', ['wrangler', 'whoami'], { stdio: 'ignore', timeout: 90000 }); } catch { /* yoksay */ }
  const before = TOKEN;
  TOKEN = oauthToken();
  console.log(`  [token] ${reason} -> ${TOKEN === before ? 'DEĞİŞMEDİ' : 'yenilendi'}`);
  return TOKEN !== before;
}
function isAuthFailure(status, json) {
  if (status === 401 || status === 403) return true;
  const codes = ((json && json.errors) || []).map(e => e && e.code);
  return codes.includes(7403) || codes.includes(10000);
}
async function cfFetch(url, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.success) return json;
    if (attempt === 0 && isAuthFailure(res.status, json) && refreshToken('istek yetki hatası aldı')) continue;
    const err = new Error(JSON.stringify(json.errors).slice(0, 300));
    err.httpStatus = res.status;
    throw err;
  }
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
      const json = await cfFetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${model}`, opts);
      return json.result;
    },
  },
};

// ---------------------------------------------------------------------------------------------
// GÖRSELİ İNDİR — /media/_derived/w800/... yolu (bkz. image-cdn.js#derivativeUrl'ün ürettiği AYNI
// biçim). Türev yoksa/başarısızsa orijinal yola düşülür.
// ---------------------------------------------------------------------------------------------
function derivedUrlFor(rawPath) {
  const clean = String(rawPath || '').replace(/^\/+/, '');
  if (/^https?:\/\//i.test(rawPath)) return rawPath; // dış kaynaklı görsel (varsa) olduğu gibi
  return `${SITE_ORIGIN}/media/_derived/w${CLASSIFY_WIDTH}/s/${clean}`;
}
function originalUrlFor(rawPath) {
  if (/^https?:\/\//i.test(rawPath)) return rawPath;
  return `${SITE_ORIGIN}/${String(rawPath || '').replace(/^\/+/, '')}`;
}
async function downloadImage(rawPath) {
  for (const url of [derivedUrlFor(rawPath), originalUrlFor(rawPath)]) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (!buf.length) continue;
      const mime = res.headers.get('content-type') || 'image/jpeg';
      return { bytes: buf, mime: mime.split(';')[0].trim() };
    } catch { /* sıradaki url */ }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
const where = ['deleted_at IS NULL', '(hidden_at IS NULL OR preview_at IS NOT NULL)'];
const params = [];
if (ONLY_SLUGS) { where.push(`slug IN (${ONLY_SLUGS.map(() => '?').join(',')})`); params.push(...ONLY_SLUGS); }

console.log(`FOTOĞRAF mekan sınıflandırması — ${ALL ? 'TÜM canlı projeler' : `en yeni ${LIMIT} proje`}${APPLY ? '  [APPLY: D1 GÜNCELLENECEK]' : '  [DRY-RUN: yazma YOK]'}`);
console.log(`  origin=${SITE_ORIGIN}  force=${FORCE ? 'evet' : 'hayır'}  max-images=${MAX_IMAGES || 'sınırsız'}`);

const rows = await d1(
  `SELECT id, slug, title, images, image_spaces FROM projects
   WHERE ${where.join(' AND ')}
   ORDER BY created_at DESC, id DESC
   LIMIT ? OFFSET ?`,
  [...params, ALL ? 100000 : LIMIT, OFFSET]
);
console.log(`  ${rows.length} proje okundu.\n`);

let projectsWritten = 0, imagesClassified = 0, imagesSkipped = 0, imagesFailed = 0;
const tally = new Map();

for (const row of rows) {
  let images = [];
  try { const parsed = row.images ? JSON.parse(row.images) : []; if (Array.isArray(parsed)) images = parsed.filter(u => typeof u === 'string' && u); } catch { /* bozuk JSON */ }
  if (!images.length) continue;
  let spacesByUrl = {};
  try { const parsed = row.image_spaces ? JSON.parse(row.image_spaces) : {}; if (parsed && typeof parsed === 'object') spacesByUrl = parsed; } catch { /* bozuk JSON — sıfırdan kurulur */ }

  const targets = (MAX_IMAGES > 0 ? images.slice(0, MAX_IMAGES) : images)
    .filter(u => FORCE || !Array.isArray(spacesByUrl[u]));
  if (!targets.length) { continue; }

  console.log(`- ${row.title || row.slug} (${targets.length}/${images.length} görsel)`);
  let changed = false;
  for (const rawUrl of targets) {
    const img = await downloadImage(rawUrl);
    if (!img) { imagesFailed++; console.log(`    ! indirilemedi: ${rawUrl}`); continue; }
    try {
      const { spaces, model } = await classifyPhotoSpace(env, img.bytes, VISION_TIMEOUT_MS, img.mime);
      spacesByUrl[rawUrl] = spaces;
      changed = true;
      imagesClassified++;
      for (const s of spaces) tally.set(s, (tally.get(s) || 0) + 1);
      console.log(`    ${spaces.length ? spaces.join(' + ') : '(mekan yok)'}  [${model.split('/').pop()}]`);
    } catch (err) {
      imagesFailed++;
      console.log(`    ! sınıflandırılamadı: ${String(err.message || err).slice(0, 120)}`);
    }
  }
  if (changed && APPLY) {
    await d1(`UPDATE projects SET image_spaces = ? WHERE id = ?`, [JSON.stringify(spacesByUrl), row.id]);
    projectsWritten++;
  } else if (changed) {
    projectsWritten++; // dry-run: "yazılacaktı" sayımı
  }
  imagesSkipped += images.length - targets.length;
}

console.log(`\nÖZET`);
console.log(`  proje  : ${projectsWritten} ${APPLY ? 'güncellendi' : 'güncellenecekti (dry-run)'}`);
console.log(`  görsel : ${imagesClassified} sınıflandırıldı, ${imagesSkipped} atlandı (zaten etiketli), ${imagesFailed} başarısız`);
console.log(`  AI çağrısı: ${aiCalls}`);
if (tally.size) {
  console.log(`  mekan dağılımı:`);
  for (const [k, v] of [...tally.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(4)}  ${k}`);
}
if (!APPLY) console.log(`\n(DRY-RUN — hiçbir şey yazılmadı. Yazmak için --apply ekleyin.)`);
