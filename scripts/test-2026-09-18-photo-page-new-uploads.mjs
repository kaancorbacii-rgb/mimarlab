#!/usr/bin/env node
// KULLANICI İSTEĞİ, 2026-09-18 (YEDİNCİ tur): "Bundan sonra yüklenecek tüm projeler de fotoğraflar
// sayfasında görünür olsun ve aynı kurallara göre işlesinler."
//
// ÖLÇÜLEN BOŞLUK: yeni yayına giren proje havuza anında giriyordu ama mekan etiketi (LLM) yalnızca
// günde 4 kez koşan GitHub işine, CLIP ipucu ise sayfa yönlenmeden bitmesi mümkün olmayan bir tarayıcı
// işine bağlıydı (en yeni 14 projenin hiç embedding'i yoktu). Bu dosya üç kapatmayı kelepçeler:
//   1. Worker cron'u (src/lib/photoSpaceCron.js): 15 dakikada bir, v2 etiketi olmayan görseller —
//      AYNI sınıflandırıcı, AYNI saklama biçimi, AYNI görünürlük, yazmadan önce yeniden oku/birleştir.
//   2. Dispatcher: yeni ifade Gündem/Meet/görsel-dizin işlerini TETİKLEMEZ; wrangler.jsonc ile hizalı.
//   3. Zamanlanmış GitHub işine CLIP embedding adımı + tarayıcıda güvenilir gönderim (önceden hesapla,
//      keepalive, yönlendirmeden önce sınırlı bekleme).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

globalThis.caches = {
  default: { async match() {}, async put() {}, async delete() { return false; } },
  async open() { return this.default; },
};

import { labelPendingPhotoSpaces, pendingImagesFrom, derivativeUrlFor, readLastRun, PHOTO_SPACE_CRON_LIMITS, PHOTO_SPACE_CRON_SETTING_KEY } from '../src/lib/photoSpaceCron.js';
import { handleScheduled } from '../src/index.js';
import { handlePhotosRoute } from '../src/routes/photos.js';
import { PHOTO_POOL_KIND } from '../src/lib/photoPool.js';
import { poolCacheKey } from '../src/lib/publicCache.js';
import { getSiteSettings } from '../src/lib/siteSettings.js';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.log(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const PHOTO_SPACE_CRON = '*/15 * * * *';

function d1(db) {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = db.prepare(sql).get(...params); if (r === undefined) return null; return col ? r[col] : { ...r }; },
    async all() { return { results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }; },
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(stmts) { const out = []; for (const st of stmts) out.push(await st.run()); return out; } };
}
const v2 = (label) => ({ v: 2, scene: 'ic_mekan', spaces: [{ label, confidence: 0.9 }] });

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(read('../schema.sql'));
  db.exec(read('../migrations/0079_search_fold_columns.sql'));
  db.prepare(`INSERT INTO kv_usage (id, writes_count, writes_day, updated_at) VALUES ('singleton', 0, '', 0)`).run();
  // yeni: a bakılmadı, b v2 etiketli, z artık images'ta YOK (kolonda kalıntı)
  db.prepare(`INSERT INTO projects (slug,title,images,image_spaces,created_at) VALUES ('yeni','Yeni',?,?,'2026-09-18 10:00:00')`)
    .run(JSON.stringify(['/media/u/x/a.webp', 'projects/b.webp']), JSON.stringify({ 'projects/b.webp': v2('Mutfak'), 'projects/z.webp': v2('Havuz') }));
  // eski: c v1 (düz dizi) -> yeniden etiketlenmeli
  db.prepare(`INSERT INTO projects (slug,title,images,image_spaces,created_at) VALUES ('eski','Eski',?,?,'2026-01-01 10:00:00')`)
    .run(JSON.stringify(['https://mimarlab.com/projects/c.webp']), JSON.stringify({ 'https://mimarlab.com/projects/c.webp': ['Resepsiyon'] }));
  // blurlu (önizleme) ve gizli: DOKUNULMAZ
  db.prepare(`INSERT INTO projects (slug,title,images,created_at,hidden_at,preview_at) VALUES ('blurlu','Blurlu',?,'2026-09-17','2026-09-17','2026-09-17')`).run(JSON.stringify(['projects/p.webp']));
  db.prepare(`INSERT INTO projects (slug,title,images,created_at,hidden_at) VALUES ('gizli','Gizli',?,'2026-09-16','2026-09-16')`).run(JSON.stringify(['projects/g.webp']));
  const aiCalls = [];
  const fetched = [];
  const kv = { store: new Map([[poolCacheKey(PHOTO_POOL_KIND), '{"stale":true}']]), deleted: [],
    async get(k, t) { const v = this.store.get(k); return v == null ? null : (t === 'json' ? JSON.parse(v) : v); },
    async put(k, v) { this.store.set(k, v); }, async delete(k) { this.deleted.push(k); this.store.delete(k); } };
  const env = {
    DB: d1(db), FACET_CACHE: kv,
    AI: { async run(model, opts) { aiCalls.push(model); return { response: '{"scene":"ic_mekan","spaces":[{"label":"Yatak Odası","confidence":0.9}]}' }; } },
  };
  const fetchFn = async (url) => { fetched.push(url); return { ok: true, headers: { get: () => 'image/webp' }, async arrayBuffer() { return new Uint8Array([1, 2, 3]).buffer; } }; };
  return { db, env, kv, aiCalls, fetched, fetchFn };
}

section('1 — Worker cron: eksik etiketleri AYNI kurallarla tamamlar');

await test('bekleyen görseller: v2 olmayan (bakılmadı + v1) seçilir, en yeni proje önce, blurlu/gizli hiç yok', () => {
  const rows = [
    { id: 1, slug: 'yeni', images: JSON.stringify(['a', 'b']), image_spaces: JSON.stringify({ b: v2('Mutfak') }) },
    { id: 2, slug: 'eski', images: JSON.stringify(['c']), image_spaces: JSON.stringify({ c: ['Resepsiyon'] }) },
  ];
  assert.deepEqual(pendingImagesFrom(rows, 10), { jobs: [{ projectId: 1, slug: 'yeni', url: 'a' }, { projectId: 2, slug: 'eski', url: 'c' }], pending: 2 });
  assert.deepEqual(pendingImagesFrom(rows, 1).jobs.map(j => j.url), ['a'], 'sınır: ilk N (en yeni)');
  assert.equal(pendingImagesFrom(rows, 1).pending, 2, 'bekleyen sayısı sınırdan bağımsız');
});

await test('cron turu: etiketler v2 olarak yazılır, mevcut v2 girdisi KORUNUR, kalıntı girdi atılır, havuz anahtarı düşer, özet kaydedilir', async () => {
  const { db, env, kv, aiCalls, fetched, fetchFn } = fixture();
  const stats = await labelPendingPhotoSpaces(env, { fetch: fetchFn });
  assert.equal(stats.scanned, 2, 'yalnızca havuz görünürlüğündeki projeler (blurlu/gizli değil)');
  assert.equal(stats.pending, 2); assert.equal(stats.classified, 2); assert.equal(stats.failed, 0);
  assert.equal(stats.projectsWritten, 2); assert.equal(stats.remaining, 0); assert.equal(stats.budgetHit, false);
  assert.equal(aiCalls.length, 2);
  assert.match(aiCalls[0], /llama-4-scout/, 'betikle AYNI model kademesi');
  const yeni = JSON.parse(db.prepare(`SELECT image_spaces FROM projects WHERE slug='yeni'`).get().image_spaces);
  assert.deepEqual(yeni['/media/u/x/a.webp'], { v: 2, scene: 'ic_mekan', spaces: [{ label: 'Yatak Odası', confidence: 0.9 }] });
  assert.deepEqual(yeni['projects/b.webp'], v2('Mutfak'), 'v2 girdisine dokunulmaz (AI sorulmaz)');
  assert.ok(!('projects/z.webp' in yeni), 'images listesinde olmayan görselin kalıntısı temizlenir');
  const eski = JSON.parse(db.prepare(`SELECT image_spaces FROM projects WHERE slug='eski'`).get().image_spaces);
  assert.equal(eski['https://mimarlab.com/projects/c.webp'].v, 2, 'v1 düz dizi yeniden etiketlendi');
  // Görsel baytları betikle AYNI türev adresinden.
  assert.deepEqual(fetched, ['https://mimarlab.com/media/_derived/w800/r2/u/x/a.webp', 'https://mimarlab.com/media/_derived/w800/s/projects/c.webp']);
  assert.deepEqual(kv.deleted, [poolCacheKey(PHOTO_POOL_KIND)], 'yalnızca fotoğraf havuzu anahtarı düşer');
  const last = await readLastRun(env);
  assert.equal(last.classified, 2); assert.ok(last.at);
  // İkinci tur: yapılacak iş yok, AI çağrılmaz, havuz anahtarı boşuna düşürülmez.
  kv.deleted.length = 0;
  const again = await labelPendingPhotoSpaces(env, { fetch: fetchFn });
  assert.equal(again.pending, 0); assert.equal(aiCalls.length, 2); assert.deepEqual(kv.deleted, []);
});

await test('sekizinci tur: baytlar ÖNCE R2/ASSETS binding\'inden okunur (kendi alan adına fetch canlıda 24/24 başarısızdı)', async () => {
  const { env, aiCalls } = fixture();
  const r2Gets = [];
  env.UPLOADS = { async get(k) { r2Gets.push(k); return k === 'u/x/a.webp' ? { httpMetadata: { contentType: 'image/webp' }, async arrayBuffer() { return new Uint8Array([9, 9]).buffer; } } : null; } };
  const assetGets = [];
  env.ASSETS = { async fetch(req) { assetGets.push(req.url); return new Response(new Uint8Array([7]), { headers: { 'content-type': 'image/webp' } }); } };
  const stats = await labelPendingPhotoSpaces(env, { fetch: async () => { throw new Error('fetch çağrılmamalı'); } });
  assert.equal(stats.classified, 2); assert.equal(stats.failed, 0); assert.equal(aiCalls.length, 2);
  assert.deepEqual(r2Gets, ['_derived/w800/r2/u/x/a.webp', 'u/x/a.webp'], 'önce türev, yoksa orijinal');
  assert.deepEqual(assetGets, ['https://mimarlab.com/projects/c.webp']);
});

await test('sekizinci tur: ızgara CSS columns DEĞİL — kart en kısa sütunun SONUNA eklenir, "Daha Fazla Göster" yeniden dağıtmaz', () => {
  const h = readFileSync(new URL('../fotograf.html', import.meta.url), 'utf8');
  const css = h.slice(0, h.indexOf('</style>'));
  assert.ok(!/\.ph-grid\{[^}]*columns\s*:/.test(css), 'CSS columns içerik değişince tüm kartları yeniden dağıtır');
  assert.match(css, /\.ph-grid\{display:flex;/);
  assert.match(h, /function placeCard\(card\)\{[\s\S]*?best\.appendChild\(card\);/);
  const append = h.slice(h.indexOf('function appendCards('), h.indexOf('async function loadPage('));
  assert.ok(!/buildColumns\(\)\s*;?\s*\n[^\n]*placeCard/.test(append.replace('if(!columns.length) buildColumns();', '')), 'ekleme yolu yeniden dağıtmaz');
  assert.match(append, /placeCard\(card\);/);
  assert.ok(!/grid\.insertAdjacentHTML/.test(h));
});

await test('sınırlar: maxImages tur başına iş sayısını, budgetMs süreyi keser; kalan bir sonraki tura', async () => {
  const { env, fetchFn, aiCalls } = fixture();
  const s1 = await labelPendingPhotoSpaces(env, { fetch: fetchFn, maxImages: 1 });
  assert.equal(s1.classified, 1); assert.equal(s1.remaining, 1); assert.equal(aiCalls.length, 1);
  const { env: env2, fetchFn: f2, aiCalls: calls2 } = fixture();
  const s2 = await labelPendingPhotoSpaces(env2, { fetch: f2, budgetMs: -1 });
  assert.equal(s2.budgetHit, true); assert.equal(s2.classified, 0); assert.equal(calls2.length, 0);
  assert.ok(PHOTO_SPACE_CRON_LIMITS.maxImages <= 40 && PHOTO_SPACE_CRON_LIMITS.budgetMs <= 120000, 'cron turu küçük ve sınırlı');
});

await test('indirilemeyen görsel yazılmaz, tur düşmez; AI binding yoksa yalnızca tarama', async () => {
  const { env, db } = fixture();
  const stats = await labelPendingPhotoSpaces(env, { fetch: async () => ({ ok: false }) });
  assert.equal(stats.failed, 2); assert.equal(stats.classified, 0); assert.equal(stats.projectsWritten, 0);
  const yeni = JSON.parse(db.prepare(`SELECT image_spaces FROM projects WHERE slug='yeni'`).get().image_spaces);
  assert.ok(!('/media/u/x/a.webp' in yeni));
  const { env: noAi, aiCalls } = fixture();
  delete noAi.AI;
  const s = await labelPendingPhotoSpaces(noAi, { fetch: async () => { throw new Error('çağrılmamalı'); } });
  assert.equal(s.pending, 2); assert.equal(s.classified, 0); assert.equal(aiCalls.length, 0);
});

await test('özet iç ayardır: site ayarları nesnesine SIZMAZ; /api/photos/stats `cron` alanında gösterir', async () => {
  const { env, fetchFn } = fixture();
  await labelPendingPhotoSpaces(env, { fetch: fetchFn });
  env.FACET_CACHE.store.clear();
  const settings = await getSiteSettings(env);
  assert.ok(!(PHOTO_SPACE_CRON_SETTING_KEY in settings), 'photo_space_cron_last INTERNAL_SETTING_KEYS listesinde olmalı');
  const url = new URL('https://mimarlab.com/api/photos/stats');
  const s = JSON.parse(await (await handlePhotosRoute(new Request(url.href), env, url)).text());
  assert.equal(s.cron.classified, 2); assert.equal(s.llmLabeled, 3);
});

await test('türev adresi betikle AYNI şema (r2 / statik / mutlak)', () => {
  assert.equal(derivativeUrlFor('/media/u/x/a.webp'), 'https://mimarlab.com/media/_derived/w800/r2/u/x/a.webp');
  assert.equal(derivativeUrlFor('projects/b.webp'), 'https://mimarlab.com/media/_derived/w800/s/projects/b.webp');
  assert.equal(derivativeUrlFor('https://mimarlab.com/projects/c.webp'), 'https://mimarlab.com/media/_derived/w800/s/projects/c.webp');
  assert.equal(derivativeUrlFor('https://baska.site/x.jpg'), 'https://baska.site/x.jpg');
});

section('2 — dispatcher ve cron ifadesi');

await test('fotoğraf ifadesi YALNIZCA photoSpaces işçisini çağırır; Gündem/Meet/görsel-dizin ÇAĞRILMAZ', async () => {
  const calls = { gundem: 0, visual: 0, meet: 0, photo: 0 };
  const runners = { gundem: async () => { calls.gundem++; }, visualIndex: async () => { calls.visual++; return {}; }, meetRetry: async () => { calls.meet++; }, photoSpaces: async () => { calls.photo++; return { classified: 0 }; } };
  const ctx = { waitUntil() {} };
  const settled = await handleScheduled({ cron: PHOTO_SPACE_CRON }, {}, ctx, runners);
  assert.deepEqual(calls, { gundem: 0, visual: 0, meet: 0, photo: 1 });
  assert.ok(settled.every(r => r.status === 'fulfilled'));
  // Gündem ifadesi fotoğraf işçisini çağırmaz (nöron harcaması 4 saatte bir DEĞİL, 15 dk'da bir ve yalnızca kendi ifadesinde).
  await handleScheduled({ cron: '0 1,5,9,13,17,21 * * *' }, {}, ctx, runners);
  assert.equal(calls.photo, 1); assert.equal(calls.gundem, 1); assert.equal(calls.meet, 1);
  // photoSpaces işçisi fırlatırsa dispatcher düşmez.
  const bad = { ...runners, photoSpaces: async () => { throw new Error('patladı'); } };
  const errs = []; const orig = console.error; console.error = (...a) => errs.push(a.join(' '));
  try { const s2 = await handleScheduled({ cron: PHOTO_SPACE_CRON }, {}, ctx, bad); assert.ok(s2.every(r => r.status === 'fulfilled')); }
  finally { console.error = orig; }
  assert.ok(errs.some(e => e.includes('photoSpaces cron başarısız')));
});

await test('cron ifadesi wrangler.jsonc + src/index.js\'te BİREBİR aynı; varsayılan işçi labelPendingPhotoSpaces', () => {
  assert.match(read('../wrangler.jsonc'), /"\*\/15 \* \* \* \*"/);
  const idx = read('../src/index.js');
  assert.match(idx, /const PHOTO_SPACE_CRON = '\*\/15 \* \* \* \*';/);
  assert.match(idx, /photoSpaces: \(env\) => labelPendingPhotoSpaces\(env\),/);
  assert.match(idx, /if \(cron !== VISUAL_INDEX_CRON && !isPhotoSpaceCron\) \{/, 'Gündem dalı fotoğraf ifadesini dışlar');
});

section('3 — CLIP embedding: zamanlanmış iş + tarayıcı');

await test('zamanlanmış GitHub işi etiketlemeden ÖNCE dizindeki eksik embedding\'leri tamamlar (yalnızca değişen projeler)', () => {
  const y = read('../.github/workflows/photo-space-classify.yml');
  const embedAt = y.indexOf('CLIP embedding — dizindeki eksikleri tamamla'); const classifyAt = y.indexOf('- name: Sınıflandırma');
  assert.ok(embedAt > 0 && classifyAt > embedAt, 'embedding adımı sınıflandırmadan önce');
  assert.match(y, /build-image-embeddings\.py --type project --only-changed --max-images 0/);
  assert.match(y, /continue-on-error: true/, 'embedding hatası etiketlemeyi engellemez');
  assert.match(y, /github\.event_name == 'schedule' \|\| \(inputs\.mode == 'etiketle' && inputs\.embed != 'hayir'\)/);
  const py = read('../scripts/build-image-embeddings.py');
  assert.match(py, /os\.environ\.get\('CLOUDFLARE_API_TOKEN'\)/, 'CI token\'ı: toml dosyası runner\'da yok');
  assert.match(py, /os\.environ\.get\('CLOUDFLARE_ACCOUNT_ID'\)/);
  const req = read('./photo-space-embed-requirements.txt');
  for (const dep of ['onnxruntime', 'pillow', 'numpy', 'transformers', 'huggingface_hub', 'requests']) assert.match(req, new RegExp(`^${dep}$`, 'm'));
});

await test('proje-ekle: embedding dosya eklenince ÖNCEDEN hesaplanır, keepalive ile gönderilir, yönlendirme sınırlı bekler', () => {
  const s = read('../proje-ekle.html');
  assert.match(s, /function precomputeImageEmbeddings\(\)/);
  assert.match(s, /renderPreviews\(\);\n  \/\/ Görsel arama\/fotoğraf sayfası embedding'i[^\n]*\n[^\n]*\n  precomputeImageEmbeddings\(\);/, 'addFiles hesaplamayı başlatır');
  assert.match(s, /keepalive: true,/);
  assert.equal((s.match(/navigateAfterEmbeddings\(\(\) => \{ window\.location/g) || []).length, 3, 'üç yayın yolu da bekler');
  assert.ok(!/syncNewImageEmbeddings\('project', [^)]*\);\n\s*const dest/.test(s), 'eski ateşle-unut deseni kalmadı');
  assert.match(s, /const EMBED_NAV_WAIT_MS = 8000;/);
  assert.match(s, /Promise\.all\(\[minDelay, bounded\]\)\.then\(go, go\)/, 'gönderim hata verse de yönlendirme olur');
});

await test('havuz: dizinde olmayan görsel 1 saat sonra yeniden denenir (yeni embedding\'ler ipucu alsın)', () => {
  assert.match(read('../src/lib/photoPool.js'), /const CLIP_MISS_RETRY_HOURS = 1;/);
});

console.log(`\n${failed ? 'BAŞARISIZ' : 'TAMAM'} — ${passed} geçti, ${failed} kaldı`);
if (failed) { for (const f of failures) console.error(` - ${f.name}: ${f.message}`); process.exit(1); }
