#!/usr/bin/env node
// TELİF/YAYIN HAKKI KİLİTLEME — GÜVENLİK VE SIRALAMA TESTLERİ (kullanıcı isteği, 2026-09-09 madde 16).
//
// scripts/test-meet-gateway.mjs ile AYNI desen: test koşucusu yok, npm bağımlılığı yok, yalnızca
// node:assert + node:sqlite üzerinde çalışan GERÇEK bir SQLite (schema.sql birebir yüklenir, yani
// 0106'nın trigger'ları ve index'leri de test edilir). R2/ASSETS/KV sahte binding'lerdir; istekler
// GERÇEK Worker fetch handler'ından (src/index.js) geçer, yani yönlendirme/kapı/önbellek sırası da
// üretimdeki gibi çalışır.
//
// KAPSAM — kullanıcı isteğindeki 15 kontrol, numaraları korunarak:
//   1 API yanıtında orijinal URL yok            2 SSR/HTML'de orijinal URL yok
//   3 JSON-LD/OpenGraph'ta orijinal URL yok     4 srcset orijinali üretmiyor
//   5 /media/... doğrudan erişilemiyor          6 türev (w800/w1600) yoluyla da erişilemiyor
//   7 /projects/... statik yolu erişilemiyor    8 locked -> approved sonrası orijinal AÇILIYOR
//   9 approved -> disputed sonrası KAPANIYOR    10 epoch değişince kapı kararı bayat kalmıyor
//  11 liste/carousel sıralaması onaya göre     12 detay galerisi sıralaması onaya göre
//  13 eşit öncelikte sıra deterministik         14 bypass yalnızca frontend'e dayanmıyor
//  15 ORDER BY RANDOM() kullanılmıyor

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

import {
  _resetDecisionCacheForTests, applyProjectImageRights, bumpRightsEpoch, fetchProjectMediaRights,
  fallbackSafeMediaId, gatePathFor, isOriginalPublic, lookupGateDecision, mediaBucketOf,
  normalizeMediaPath, parseFallbackMediaId, rightsEpoch,
  registerProjectMedia, safeDerivativeKeyFor, scrubLockedMediaPayload, setMediaRightsStatus,
  syncProjectMediaRights, collectEntityMediaUrls, entityRightsBucketFrom, isEntityClaimBacked,
  openMediaForClaimKey, orderRowsByRightsBucket, registerEntityMedia, syncEntityMediaRights,
} from '../src/lib/mediaRights.js';
import { derivedImageUrl, derivedSrcset } from '../src/lib/imageDerivative.js';
import { fetchActiveProjectPool } from '../src/lib/projectPool.js';
import { buildMeta } from '../src/lib/seo.js';
import worker from '../src/index.js';
import { sha256Hex } from '../src/lib/crypto.js';

let passed = 0;
let failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; failures.push({ name, message: err.message }); console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').slice(0, 4).join('\n       ')}`); }
}
function section(t) { console.log(`\n${t}`); }

// ---- D1 shim (node:sqlite) --------------------------------------------------------------------
function d1(db) {
  const stmt = (sql, params) => ({
    bind: (...p) => stmt(sql, p),
    async first(col) { const r = db.prepare(sql).get(...params); if (r === undefined) return null; return col ? r[col] : { ...r }; },
    async all() { return { results: db.prepare(sql).all(...params).map((r) => ({ ...r })) }; },
    async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return { prepare: (sql) => stmt(sql, []), async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; } };
}

// ---- R2 / ASSETS / KV sahteleri ---------------------------------------------------------------
const ORIGINAL_BYTES = 'ORIGINAL-FULL-RESOLUTION-BYTES';
const SAFE_BYTES = 'SAFE-W400-BYTES';

function makeEnv(db, opts) {
  const o = opts || {};
  const r2 = new Map(o.r2 || []);
  const kv = new Map();
  return {
    DB: d1(db),
    UPLOADS: {
      async get(key) {
        if (!r2.has(key)) return null;
        const value = r2.get(key);
        return { body: value, size: value.length, httpEtag: '"x"', httpMetadata: { contentType: 'image/webp' } };
      },
    },
    ASSETS: {
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (o.assets && o.assets.has(path)) {
          return new Response(o.assets.get(path), { status: 200, headers: { 'Content-Type': 'image/webp' } });
        }
        return new Response('not found', { status: 404 });
      },
    },
    FACET_CACHE: {
      async get(key) { return kv.has(key) ? kv.get(key) : null; },
      async put(key, value) { kv.set(key, value); },
      async delete(key) { kv.delete(key); },
    },
    ENVIRONMENT: 'test',
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  return db;
}

const STATIC_ORIGINAL = '/projects/gizli-ev-1.webp';
const R2_ORIGINAL = '/media/projects/acik-ev-1.webp';

// Bir projeyi görselleriyle birlikte kurar; media_rights satırlarını registerProjectMedia yazar.
async function seedProject(env, db, { slug, title, images, approved, mediaStatus, displayOrder }) {
  db.prepare(
    `INSERT INTO projects (slug, title, images, build_status, display_order, is_copyright_approved, created_at, updated_at)
     VALUES (?, ?, ?, 'built', ?, ?, '2026-01-01 00:00:00', '2026-01-01 00:00:00')`
  ).run(slug, title, JSON.stringify(images), displayOrder ?? null, approved ? 1 : 0);
  const id = Number(db.prepare(`SELECT id FROM projects WHERE slug = ?`).get(slug).id);
  await registerProjectMedia(env, id, images, {
    defaultStatus: mediaStatus || 'unknown',
    publicOriginalAllowed: mediaStatus === 'approved',
  });
  return id;
}

// =================================================================================================
section('1) Yol normalizasyonu ve kapı yolu türetimi');

await test('mutlak/göreli/öneksiz biçimlerin hepsi aynı kanonik yola indirgenir', () => {
  assert.equal(normalizeMediaPath('https://mimarlab.com/projects/a.webp'), '/projects/a.webp');
  assert.equal(normalizeMediaPath('/projects/a.webp'), '/projects/a.webp');
  assert.equal(normalizeMediaPath('projects/a.webp'), '/projects/a.webp');
  assert.equal(normalizeMediaPath('//mimarlab.com/projects/a.webp'), '/projects/a.webp');
});

await test('emniyet biçimi NEGATİF id\'leri ve DÖRT varlık tipini çözer', () => {
  // Negatif id gerçek: canlıda 48 aktif projenin id'si negatif (min -51).
  assert.deepEqual(parseFallbackMediaId('p-51-0'), { entityType: 'project', entityId: -51, projectId: -51, index: 0 });
  assert.deepEqual(parseFallbackMediaId('a12-3'), { entityType: 'architect', entityId: 12, projectId: 12, index: 3 });
  assert.deepEqual(parseFallbackMediaId('o7-0'), { entityType: 'office', entityId: 7, projectId: 7, index: 0 });
  assert.deepEqual(parseFallbackMediaId('r99-1'), { entityType: 'product', entityId: 99, projectId: 99, index: 1 });
  assert.equal(parseFallbackMediaId('not-a-fallback-id'), null);
  assert.equal(fallbackSafeMediaId(-51, 0, 'project'), 'p-51-0');
  assert.equal(fallbackSafeMediaId(12, 3, 'architect'), 'a12-3');
});

await test('harici host ve data: URL null döner (kapı onlara dokunmaz)', () => {
  assert.equal(normalizeMediaPath('https://example.com/a.jpg'), null);
  assert.equal(normalizeMediaPath('data:image/png;base64,AAA'), null);
});

await test('(madde 6) türev yolları KAYNAK görsele indirgenir — w800/w1600 kapıyı atlayamaz', () => {
  assert.equal(gatePathFor('/media/_derived/w1600/s/projects/a.webp'), '/projects/a.webp');
  assert.equal(gatePathFor('/media/_derived/w800/r2/projects/a.webp'), '/media/projects/a.webp');
  assert.equal(gatePathFor('/media/_derived/w400/s/projects/a.webp'), '/projects/a.webp');
});

await test('kapı medyanın GERÇEKTEN durduğu tüm dizinleri kapsar', () => {
  // Hepsi canlı veriden: proje görselleri /media/ + /projects/ + /miras/; kişi fotoğraflarının
  // 708'i mimarlar-thumb/, firma logolarının 544'ü logos-thumb/ ve 48'i mimarlar-thumb/ altında.
  for (const p of ['/media/u/a/b.webp', '/projects/x.webp', '/miras/x.webp',
                   '/mimarlar/x.jpg', '/mimarlar-thumb/y/z.jpg', '/logos/a.png', '/logos-thumb/b/c.jpg']) {
    assert.equal(gatePathFor(p), p, `kapsanması gereken yol kapı dışında: ${p}`);
  }
  // Kapsam dışı dizinler DOKUNULMAZ.
  for (const p of ['/fonts/x.woff2', '/js/components/gallery.js', '/models/a.glb', '/favicon.ico']) {
    assert.equal(gatePathFor(p), null, `kapsam dışı yol kapıya alındı: ${p}`);
  }
});

await test('(madde 4) KODLANMIŞ TRAVERSAL MATRİSİ — normalizasyon sonrası allowlist yeniden uygulanır', () => {
  // Her biri farklı bir kaçış tekniği. Hepsinin ORTAK özelliği: nokta segmentleri/eğik çizgiler
  // çözüldükten SONRA izin verilen önekin DIŞINA çıkıyorlar. gatePathFor bu durumda null döner ve
  // istek hak sistemine hiç girmez (kendi mevcut korumalarına çarpar).
  const escapes = [
    '/projects/%2e%2e/admin.html',            // kodlanmış nokta segmenti
    '/projects/../admin.html',                // düz nokta segmenti
    '/projects/%2e%2e%2fadmin.html',          // kodlanmış nokta + kodlanmış eğik çizgi
    '/projects/%2E%2E/admin.html',            // BÜYÜK harf kodlama
    '/media/_derived/w400/s/..%2F..%2Fadmin.html',
    '/media/_derived/w400/s/%2e%2e/%2e%2e/admin.html',
    '/miras/../../admin.html',
  ];
  for (const path of escapes) {
    const result = gatePathFor(path);
    assert.ok(result === null || result.startsWith('/media/') || result.startsWith('/projects/') || result.startsWith('/miras/'),
      `kapı yolu allowlist dışına çıktı: ${path} -> ${result}`);
    assert.ok(!/admin\.html$/.test(result || ''), `traversal admin.html'e ulaştı: ${path} -> ${result}`);
  }
});

await test('(madde 4) ÇİFT KODLAMA kapıyı yanıltmaz', () => {
  // %252e = "%2e"in kodlanmışı. decodeURIComponent BİR kez çözer -> "%2e%2e" düz metin kalır,
  // URL normalizasyonu onu nokta segmenti SAYMAZ, dolayısıyla yol /projects/ altında kalır ve
  // hak sistemine girer — ama gerçek bir dosyaya denk gelmediği için kapıda kayıt bulunmaz.
  // KRİTİK OLAN: hiçbir varyant allowlist DIŞINA çıkamamalı.
  for (const path of ['/projects/%252e%252e/admin.html', '/media/%252e%252e/admin.html']) {
    const result = gatePathFor(path);
    assert.ok(result === null || result.startsWith('/media/') || result.startsWith('/projects/'),
      `çift kodlama allowlist dışına çıktı: ${path} -> ${result}`);
  }
});

await test('traversal denemesi normalize edilir, izinli önek dışına çıkarsa kapı yolu üretilmez', () => {
  // İki biçim de nokta segmentleri çözüldükten SONRA /admin.html'e işaret ediyor — hak sistemine
  // ait olmayan bir yolu hak sistemine sokmamak için null dönmeli.
  assert.equal(gatePathFor('/projects/%2e%2e/admin.html'), null);
  assert.equal(gatePathFor('/media/_derived/w400/s/..%2F..%2Fadmin.html'), null);
  assert.equal(gatePathFor('/media/_derived/w400/s/projects/a.webp'), '/projects/a.webp');
});

// =================================================================================================
section('2) Karar fonksiyonları');

await test('orijinal erişimi için ÜÇ koşul da gerekli', () => {
  const row = { rights_status: 'approved', public_original_allowed: 1 };
  assert.equal(isOriginalPublic(row, true), true);
  assert.equal(isOriginalPublic(row, false), false, 'proje onaysızsa açılmamalı');
  assert.equal(isOriginalPublic({ rights_status: 'approved', public_original_allowed: 0 }, true), false);
  assert.equal(isOriginalPublic({ rights_status: 'pending', public_original_allowed: 1 }, true), false);
});

await test('(madde 12) görsel grupları: approved+açık < approved < unknown < disputed', () => {
  assert.equal(mediaBucketOf({ rights_status: 'approved', public_original_allowed: 1 }, true), 0);
  assert.equal(mediaBucketOf({ rights_status: 'approved', public_original_allowed: 0 }, true), 1);
  assert.equal(mediaBucketOf({ rights_status: 'unknown', public_original_allowed: 0 }, true), 2);
  assert.equal(mediaBucketOf({ rights_status: 'pending', public_original_allowed: 0 }, true), 2);
  assert.equal(mediaBucketOf({ rights_status: 'disputed', public_original_allowed: 0 }, true), 3);
  assert.equal(mediaBucketOf(null, true), 2, 'kayıtsız görsel unknown sayılır (fail-closed)');
});

// =================================================================================================
section('3) Yük serileştirme — kilitli URL istemciye çıkmıyor');

await test('(madde 1) kilitli görselin orijinal URL\'si yükten TAMAMEN çıkar', () => {
  const item = { images: ['/projects/a.webp', '/projects/b.webp'] };
  const rows = [
    { id: 'M1', media_url: '/projects/a.webp', media_path: '/projects/a.webp', rights_status: 'unknown', public_original_allowed: 0 },
    { id: 'M2', media_url: '/projects/b.webp', media_path: '/projects/b.webp', rights_status: 'approved', public_original_allowed: 1 },
  ];
  applyProjectImageRights(item, 7, rows, true);
  const payload = JSON.stringify(item);
  assert.ok(!payload.includes('/projects/a.webp'), 'kilitli orijinal yol yükte kalmış');
  assert.ok(payload.includes('/api/media/M1'), 'güvenli uç yükte yok');
  assert.ok(payload.includes('/projects/b.webp'), 'onaylı görsel mevcut yolunda kalmalı');
});

await test('(madde 12) galeri hak grubuna göre sıralanır, grup İÇİNDE editoryal sıra korunur', () => {
  const item = { images: ['locked-1', 'open-1', 'locked-2', 'open-2', 'disputed-1'] };
  const rows = [
    { id: 'L1', media_url: 'locked-1', media_path: null, rights_status: 'unknown', public_original_allowed: 0 },
    { id: 'O1', media_url: 'open-1', media_path: null, rights_status: 'approved', public_original_allowed: 1 },
    { id: 'L2', media_url: 'locked-2', media_path: null, rights_status: 'unknown', public_original_allowed: 0 },
    { id: 'O2', media_url: 'open-2', media_path: null, rights_status: 'approved', public_original_allowed: 1 },
    { id: 'D1', media_url: 'disputed-1', media_path: null, rights_status: 'disputed', public_original_allowed: 0 },
  ];
  applyProjectImageRights(item, 7, rows, true);
  assert.deepEqual(item.images, ['open-1', 'open-2', '/api/media/L1', '/api/media/L2', '/api/media/D1']);
});

await test('takedown almış (removed) görsel yükten tamamen düşer', () => {
  const item = { images: ['a', 'b'] };
  applyProjectImageRights(item, 7, [
    { id: 'A', media_url: 'a', media_path: null, rights_status: 'removed', public_original_allowed: 0 },
    { id: 'B', media_url: 'b', media_path: null, rights_status: 'approved', public_original_allowed: 1 },
  ], true);
  assert.deepEqual(item.images, ['b']);
});

await test('imageHotspots anahtarları yeni URL\'lere taşınır (işaretçiler kaybolmaz)', () => {
  const item = { images: ['x'], imageHotspots: { x: [{ x: 1, y: 2 }] } };
  applyProjectImageRights(item, 7, [{ id: 'X', media_url: 'x', media_path: null, rights_status: 'unknown', public_original_allowed: 0 }], true);
  assert.deepEqual(Object.keys(item.imageHotspots), ['/api/media/X']);
});

// =================================================================================================
section('4) Türev/srcset katmanı');

await test('(madde 4) güvenli uç için srcset ÜRETİLMEZ, orijinal yol asla türetilmez', () => {
  assert.equal(derivedImageUrl('/api/media/M1', 800), '/api/media/M1');
  assert.equal(derivedSrcset('/api/media/M1', [400, 800, 1600]), '');
});

await test('normal (onaylı) görselde türev üretimi eskisi gibi çalışır — regresyon yok', () => {
  assert.equal(derivedImageUrl('/projects/a.webp', 400), '/media/_derived/w400/s/projects/a.webp');
  assert.equal(safeDerivativeKeyFor('/media/projects/a.webp'), '_derived/w400/r2/projects/a.webp');
  assert.equal(safeDerivativeKeyFor('/projects/a.webp'), '_derived/w400/s/projects/a.webp');
});

await test('güvenli sürüm merdiveni: w400 yoksa w800 denenir, orijinale DÜŞÜLMEZ', async () => {
  const db = freshDb();
  // Yalnızca w800 türevi var — w400 eksik (canlıda ölçülen ~%6'lık kapsam boşluğu).
  const env = makeEnv(db, { r2: [['_derived/w800/s/projects/ladder.webp', SAFE_BYTES]], assets: new Map([['/projects/ladder.webp', ORIGINAL_BYTES]]) });
  const pid = await seedProject(env, db, { slug: 'ladder', title: 'Ladder', images: ['/projects/ladder.webp'], approved: false, mediaStatus: 'unknown' });
  const mediaId = db.prepare(`SELECT id FROM media_rights WHERE entity_id = ?`).get(pid).id;
  const res = await worker.fetch(new Request(`https://mimarlab.com/api/media/${mediaId}`), env, { waitUntil() {} });
  const body = await res.text();
  assert.equal(body, SAFE_BYTES);
  assert.ok(!body.includes(ORIGINAL_BYTES));
});

// =================================================================================================
section('5) Doğrudan erişim kapısı + Worker uçtan uca');

{
  const db = freshDb();
  const assets = new Map([[STATIC_ORIGINAL, ORIGINAL_BYTES]]);
  const r2 = [
    ['projects/acik-ev-1.webp', ORIGINAL_BYTES],
    ['_derived/w400/s/projects/gizli-ev-1.webp', SAFE_BYTES],
    ['_derived/w400/r2/projects/acik-ev-1.webp', SAFE_BYTES],
  ];
  const env = makeEnv(db, { r2, assets });
  // rights_verified_by -> users(id) yabancı anahtarı gerçek: aksiyonu yapan kullanıcı var olmalı.
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u1','a@b.c','x','Test','user',0)`).run();

  const lockedId = await seedProject(env, db, { slug: 'gizli-ev', title: 'Gizli Ev', images: [STATIC_ORIGINAL], approved: false, mediaStatus: 'unknown' });
  const openId = await seedProject(env, db, { slug: 'acik-ev', title: 'Açık Ev', images: [R2_ORIGINAL], approved: true, mediaStatus: 'approved' });

  const lockedMediaId = db.prepare(`SELECT id FROM media_rights WHERE entity_id = ?`).get(lockedId).id;
  const openMediaId = db.prepare(`SELECT id FROM media_rights WHERE entity_id = ?`).get(openId).id;

  const req = (path) => new Request(`https://mimarlab.com${path}`);
  const ctx = { waitUntil() {} };

  await test('(madde 7) kilitli statik proje görselinin doğrudan yolu 404', async () => {
    _resetDecisionCacheForTests();
    const res = await worker.fetch(req(STATIC_ORIGINAL), env, ctx);
    assert.equal(res.status, 404);
  });

  await test('(madde 6) kilitli görselin w1600 türevi de 404', async () => {
    _resetDecisionCacheForTests();
    const res = await worker.fetch(req('/media/_derived/w1600/s/projects/gizli-ev-1.webp'), env, ctx);
    assert.equal(res.status, 404);
  });

  await test('(madde 6) kilitli görselin w400 türevi de doğrudan yoldan 404 (yalnızca /api/media)', async () => {
    _resetDecisionCacheForTests();
    const res = await worker.fetch(req('/media/_derived/w400/s/projects/gizli-ev-1.webp'), env, ctx);
    assert.equal(res.status, 404);
  });

  await test('onaylı görselin doğrudan yolu ÇALIŞIR (mevcut davranış korunur)', async () => {
    _resetDecisionCacheForTests();
    const res = await worker.fetch(req(R2_ORIGINAL), env, ctx);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), ORIGINAL_BYTES);
  });

  await test('(madde 9) kapıya tabi ONAYLI medya `immutable` TAŞIMAZ — takedown tarayıcıya da ulaşır', async () => {
    // GERÇEK BULGU (production kontrolü, 2026-09-09): statik dalda tarayıcı ömrü 1 güne çekilmişti
    // ama R2 dalı hâlâ `max-age=31536000, immutable` yazıyordu — sitedeki proje görsellerinin
    // ÇOĞUNLUĞU (29.045'in 19.282'si) o yoldan geçiyor. Bir onay geri alındığında edge epoch ile
    // anında temizlenir ama tarayıcının bir yıllık kopyası geri çağrılamazdı.
    _resetDecisionCacheForTests();
    const res = await worker.fetch(req(R2_ORIGINAL), env, ctx);
    const cc = res.headers.get('Cache-Control') || '';
    assert.ok(!/immutable/.test(cc), `kapıya tabi medya immutable taşıyor: ${cc}`);
    assert.match(cc, /max-age=86400/, `beklenen 1 günlük tarayıcı ömrü yok: ${cc}`);
  });

  await test('kapıya tabi OLMAYAN medya eski immutable sözleşmesini KORUR (regresyon yok)', async () => {
    _resetDecisionCacheForTests();
    const envPlain = makeEnv(db, { r2: [['u/x/avatar.webp', ORIGINAL_BYTES]], assets });
    const res = await worker.fetch(req('/media/u/x/avatar.webp'), envPlain, ctx);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('Cache-Control') || '', /immutable/);
  });

  await test('kapıya tabi OLMAYAN yollar dokunulmadan geçer (logolar, miras)', async () => {
    _resetDecisionCacheForTests();
    const env2 = makeEnv(db, { r2, assets: new Map([['/logos/site/favicon-32.png', 'LOGO']]) });
    const res = await worker.fetch(req('/logos/site/favicon-32.png'), env2, ctx);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'LOGO');
  });

  await test('(madde 14) /api/media kilitli görselde YALNIZCA güvenli baytları döner', async () => {
    _resetDecisionCacheForTests();
    const res = await worker.fetch(req(`/api/media/${lockedMediaId}`), env, ctx);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.equal(body, SAFE_BYTES);
    assert.ok(!body.includes(ORIGINAL_BYTES), 'orijinal baytlar sızmış');
    assert.match(res.headers.get('X-Robots-Tag') || '', /noindex/);
  });

  await test('güvenli sürüm YOKSA orijinale düşülmez — yer tutucu döner (fail-closed)', async () => {
    _resetDecisionCacheForTests();
    const envNoDerivative = makeEnv(db, { r2: [], assets });
    const res = await worker.fetch(req(`/api/media/${lockedMediaId}`), envNoDerivative, ctx);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(body.startsWith('<svg'), 'yer tutucu beklenirken başka bir gövde döndü');
    assert.ok(!body.includes(ORIGINAL_BYTES));
  });

  await test('emniyet biçimi (kayıtsız görsel) de yalnızca güvenli sürümü verir', async () => {
    _resetDecisionCacheForTests();
    const res = await worker.fetch(req(`/api/media/p${lockedId}-0`), env, ctx);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), SAFE_BYTES);
  });

  await test('(madde 6) KODLANMIŞ KARAKTERLE BYPASS — %67izli... da 404 alır', async () => {
    // GERÇEK AÇIK (production kontrolü, 2026-09-09): kapı ham pathname'i eşleştirdiği için tek bir
    // harfi yüzde-kodlamak ("g" -> "%67") kaydı ıskalatıyor, Cloudflare Assets ise kodlamayı çözüp
    // KİLİTLİ ORİJİNALİ servis ediyordu. Bu test o açığın kapalı kaldığını garanti eder.
    _resetDecisionCacheForTests();
    const variants = [
      '/projects/%67izli-ev-1.webp',        // ilk harf kodlanmış
      '/projects/gizli-ev-1%2Ewebp',        // nokta kodlanmış
      '/projects/gizli%2Dev-1.webp',        // tire kodlanmış
    ];
    for (const v of variants) {
      const res = await worker.fetch(req(v), env, ctx);
      assert.equal(res.status, 404, `kodlanmış varyant kapıyı atlattı: ${v}`);
    }
  });

  await test('(madde 6) alternatif yol/uzantı tahminleri orijinali vermez', async () => {
    _resetDecisionCacheForTests();
    // Kilitli görselin R2/statik anahtarına başka yollardan ulaşma denemeleri. Hiçbiri 200 + ORİJİNAL
    // BAYT döndürmemeli (404 ya da farklı içerik olabilir, ama orijinal ASLA).
    const probes = [
      '/media/projects/gizli-ev-1.webp',              // statik görseli R2 yolundan iste
      '/media/_derived/w800/s/projects/gizli-ev-1.webp',
      '/media/_derived/w1600/r2/projects/gizli-ev-1.webp',
      '/projects/gizli-ev-1.webp?v=1',                // sorgu dizesiyle
      '/projects//gizli-ev-1.webp',                   // çift eğik çizgi
    ];
    for (const path of probes) {
      const res = await worker.fetch(req(path), env, ctx);
      if (res.status !== 200) continue;
      const body = await res.text();
      assert.notEqual(body, ORIGINAL_BYTES, `orijinal baytlar bu yoldan sızdı: ${path}`);
    }
  });

  await test('(madde 8) locked -> approved sonrası orijinal AÇILIYOR', async () => {
    await setMediaRightsStatus(env, lockedMediaId, { status: 'approved', publicOriginalAllowed: true, action: 'approve' }, { id: 'u1' });
    db.prepare(`UPDATE projects SET is_copyright_approved = 1 WHERE id = ?`).run(lockedId);
    await bumpRightsEpoch(env);
    const res = await worker.fetch(req(STATIC_ORIGINAL), env, ctx);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), ORIGINAL_BYTES);
  });

  await test('(madde 9) approved -> disputed sonrası orijinal erişimi KAPANIYOR', async () => {
    await setMediaRightsStatus(env, openMediaId, { status: 'disputed', action: 'dispute' }, { id: 'u1' });
    await bumpRightsEpoch(env);
    const res = await worker.fetch(req(R2_ORIGINAL), env, ctx);
    assert.equal(res.status, 404);
  });

  await test('(madde 10) epoch artınca izolat karar önbelleği bayat kalmıyor', async () => {
    // Kararı önbelleğe al (izin verilen durumda), sonra durumu değiştir + epoch artır.
    db.prepare(`UPDATE media_rights SET rights_status='approved', public_original_allowed=1 WHERE id = ?`).run(openMediaId);
    await bumpRightsEpoch(env);
    let decision = await lookupGateDecision(env, '/media/projects/acik-ev-1.webp');
    assert.equal(decision.allowed, true);
    db.prepare(`UPDATE media_rights SET rights_status='removed', public_original_allowed=0 WHERE id = ?`).run(openMediaId);
    // Epoch artırılmazsa 60sn boyunca eski karar geçerli kalırdı; artırılınca ANINDA yeniden sorulur.
    await bumpRightsEpoch(env);
    decision = await lookupGateDecision(env, '/media/projects/acik-ev-1.webp');
    assert.equal(decision.allowed, false);
  });

  await test('takedown edilmiş medya /api/media\'dan da 404 (güvenli sürüm bile verilmez)', async () => {
    _resetDecisionCacheForTests();
    const res = await worker.fetch(req(`/api/media/${openMediaId}`), env, ctx);
    assert.equal(res.status, 404);
  });
}

// =================================================================================================
section('6) Çıkış taraması (ikinci katman)');

{
  const db = freshDb();
  const env = makeEnv(db, {});
  const id = await seedProject(env, db, { slug: 'tarama', title: 'Tarama', images: ['/projects/t1.webp', '/projects/t2.webp'], approved: false, mediaStatus: 'unknown' });
  const rows = db.prepare(`SELECT id, media_path FROM media_rights WHERE entity_id = ? ORDER BY sort_order`).all(id);

  await test('(madde 1) proje uçlarının DIŞINDAKİ yüklerde de kilitli URL yeniden yazılır', async () => {
    const payload = {
      items: [{ slug: 'x', images: ['/projects/t1.webp'] }],
      related: { cover: 'https://mimarlab.com/projects/t2.webp' },
    };
    const out = await scrubLockedMediaPayload(env, payload);
    const json = JSON.stringify(out);
    assert.ok(!json.includes('/projects/t1.webp'));
    assert.ok(!json.includes('/projects/t2.webp'));
    assert.ok(json.includes(`/api/media/${rows[0].id}`));
    assert.ok(json.includes(`/api/media/${rows[1].id}`));
  });

  await test('onaylı görsel taramadan DEĞİŞMEDEN geçer', async () => {
    db.prepare(`UPDATE media_rights SET rights_status='approved', public_original_allowed=1 WHERE entity_id = ?`).run(id);
    db.prepare(`UPDATE projects SET is_copyright_approved=1 WHERE id = ?`).run(id);
    const out = await scrubLockedMediaPayload(env, { cover: '/projects/t1.webp' });
    assert.equal(out.cover, '/projects/t1.webp');
  });

  await test('kayıtsız yollar (logo/miras) taramadan etkilenmez', async () => {
    const out = await scrubLockedMediaPayload(env, { logo: '/logos/x.png', foto: '/mimarlar-thumb/y.webp' });
    assert.deepEqual(out, { logo: '/logos/x.png', foto: '/mimarlar-thumb/y.webp' });
  });
}

// =================================================================================================
section('7) Sıralama (rights_bucket)');

{
  const db = freshDb();
  const env = makeEnv(db, {});
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u1','a@b.c','x','Test','user',0)`).run();
  // Kullanıcı isteğindeki örnek: A=locked, B=approved, C=locked, D=approved -> B, D, A, C
  const ids = {};
  ids.A = await seedProject(env, db, { slug: 'a', title: 'A', images: ['/projects/a.webp'], approved: false, mediaStatus: 'unknown', displayOrder: 1 });
  ids.B = await seedProject(env, db, { slug: 'b', title: 'B', images: ['/projects/b.webp'], approved: true, mediaStatus: 'approved', displayOrder: 2 });
  ids.C = await seedProject(env, db, { slug: 'c', title: 'C', images: ['/projects/c.webp'], approved: false, mediaStatus: 'unknown', displayOrder: 3 });
  ids.D = await seedProject(env, db, { slug: 'd', title: 'D', images: ['/projects/d.webp'], approved: true, mediaStatus: 'approved', displayOrder: 4 });

  await test('(madde 11) onaylı projeler başa geçer, grup içinde editoryal sıra korunur', async () => {
    const pool = await fetchActiveProjectPool(env, 'built');
    assert.deepEqual(pool.map(p => p.slug), ['b', 'd', 'a', 'c']);
  });

  await test('A onaylanınca kendi grubunun editoryal sırasına göre yerleşir (A, B, D, C)', async () => {
    const mediaId = db.prepare(`SELECT id FROM media_rights WHERE entity_id = ?`).get(ids.A).id;
    await setMediaRightsStatus(env, mediaId, { status: 'approved', publicOriginalAllowed: true, action: 'approve' }, { id: 'u1' });
    db.prepare(`UPDATE projects SET is_copyright_approved = 1 WHERE id = ?`).run(ids.A);
    const pool = await fetchActiveProjectPool(env, 'built');
    assert.deepEqual(pool.map(p => p.slug), ['a', 'b', 'd', 'c']);
  });

  await test('bir görsel ihtilaflı olunca proje kilitli gruba geri düşer', async () => {
    const mediaId = db.prepare(`SELECT id FROM media_rights WHERE entity_id = ?`).get(ids.A).id;
    await setMediaRightsStatus(env, mediaId, { status: 'disputed', action: 'dispute' }, { id: 'u1' });
    const bucket = db.prepare(`SELECT rights_bucket FROM projects WHERE id = ?`).get(ids.A).rights_bucket;
    assert.equal(Number(bucket), 2, 'tüm medyası ihtilaflı proje en sona düşmeli');
    const pool = await fetchActiveProjectPool(env, 'built');
    assert.equal(pool[pool.length - 1].slug, 'a');
  });

  await test('(madde 13) eşit display_order\'da sıra deterministik (id DESC ile çözülür)', async () => {
    db.prepare(`UPDATE projects SET display_order = 5, rights_bucket = 1, is_copyright_approved = 0`).run();
    const first = (await fetchActiveProjectPool(env, 'built')).map(p => p.slug);
    const second = (await fetchActiveProjectPool(env, 'built')).map(p => p.slug);
    assert.deepEqual(first, second);
    assert.deepEqual(first, ['d', 'c', 'b', 'a'], 'eşitlikte id DESC beklenir');
  });

  await test('kapak, hak sıralamasından SONRA seçilir (takedown almış görsel kapak olmaz)', async () => {
    const db2 = freshDb();
    const env2 = makeEnv(db2, {});
    db2.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u1','a@b.c','x','Test','user',0)`).run();
    const pid = await seedProject(env2, db2, { slug: 'kapak', title: 'Kapak', images: ['/projects/k1.webp', '/projects/k2.webp'], approved: true, mediaStatus: 'approved' });
    const first = db2.prepare(`SELECT id FROM media_rights WHERE entity_id = ? ORDER BY sort_order LIMIT 1`).get(pid).id;
    await setMediaRightsStatus(env2, first, { status: 'removed', action: 'takedown' }, { id: 'u1' });
    const pool = await fetchActiveProjectPool(env2, 'built');
    assert.deepEqual(pool[0].images, ['/projects/k2.webp']);
  });
}

// =================================================================================================
section('8) Kayıt (registrar) ve sahiplenilmiş içerik');

{
  const db = freshDb();
  const env = makeEnv(db, {});
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u1','a@b.c','x','Test','user',0)`).run();

  await test('registrar var olan satırın hak DURUMUNA dokunmaz, yalnızca eksikleri ekler', async () => {
    const id = await seedProject(env, db, { slug: 'reg', title: 'Reg', images: ['/projects/r1.webp'], approved: false, mediaStatus: 'approved' });
    db.prepare(`UPDATE media_rights SET public_original_allowed = 1 WHERE entity_id = ?`).run(id);
    db.prepare(`UPDATE projects SET images = ? WHERE id = ?`).run(JSON.stringify(['/projects/r1.webp', '/projects/r2.webp']), id);
    await syncProjectMediaRights(env, id, {});
    const rows = await fetchProjectMediaRights(env, id);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].rights_status, 'approved', 'mevcut onay korunmalı');
    assert.equal(rows[1].rights_status, 'unknown', 'yeni görsel kilitli başlamalı');
  });

  await test('galeriden çıkarılan görselin hak satırı silinir', async () => {
    const id = db.prepare(`SELECT id FROM projects WHERE slug = 'reg'`).get().id;
    db.prepare(`UPDATE projects SET images = ? WHERE id = ?`).run(JSON.stringify(['/projects/r2.webp']), id);
    await syncProjectMediaRights(env, id, {});
    const rows = await fetchProjectMediaRights(env, id);
    assert.deepEqual(rows.map(r => r.media_url), ['/projects/r2.webp']);
  });

  await test('sahiplenilmiş proje + beyan -> approved; sahiplenilmemiş -> pending (kilitli)', async () => {
    db.prepare(`INSERT INTO projects (slug, title, images, build_status, claimed_by_user_id, created_at, updated_at)
                VALUES ('sahipli','Sahipli','["/projects/s1.webp"]','built','u1','2026-01-01 00:00:00','2026-01-01 00:00:00')`).run();
    const owned = db.prepare(`SELECT id FROM projects WHERE slug='sahipli'`).get().id;
    await syncProjectMediaRights(env, owned, { declarationVersion: '2026-09-09.1', ownerUserId: 'u1' });
    const ownedRows = await fetchProjectMediaRights(env, owned);
    assert.equal(ownedRows[0].rights_status, 'approved');
    assert.equal(Number(db.prepare(`SELECT is_copyright_approved FROM projects WHERE id=?`).get(owned).is_copyright_approved), 1);

    db.prepare(`INSERT INTO projects (slug, title, images, build_status, created_at, updated_at)
                VALUES ('sahipsiz','Sahipsiz','["/projects/x1.webp"]','built','2026-01-01 00:00:00','2026-01-01 00:00:00')`).run();
    const orphan = db.prepare(`SELECT id FROM projects WHERE slug='sahipsiz'`).get().id;
    await syncProjectMediaRights(env, orphan, { declarationVersion: '2026-09-09.1', ownerUserId: 'u1' });
    const orphanRows = await fetchProjectMediaRights(env, orphan);
    assert.equal(orphanRows[0].rights_status, 'pending');
    assert.equal(Number(orphanRows[0].public_original_allowed), 0);
    assert.equal(Number(db.prepare(`SELECT is_copyright_approved FROM projects WHERE id=?`).get(orphan).is_copyright_approved), 0);
  });

  await test('durum değişiklikleri denetim kaydına yazılır (approve/dispute)', async () => {
    const id = db.prepare(`SELECT id FROM projects WHERE slug='sahipsiz'`).get().id;
    const mediaId = (await fetchProjectMediaRights(env, id))[0].id;
    await setMediaRightsStatus(env, mediaId, { status: 'approved', publicOriginalAllowed: true, action: 'approve', reason: 'test' }, { id: 'u1' });
    await setMediaRightsStatus(env, mediaId, { status: 'disputed', action: 'dispute', reason: 'hak sahibi itirazı' }, { id: 'u1' });
    const rows = db.prepare(`SELECT action, previous_status, new_status, processed_by FROM media_rights_audit WHERE content_id = ? ORDER BY created_at ASC`).all(mediaId);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].action, 'approve');
    assert.equal(rows[1].action, 'dispute');
    assert.equal(rows[1].previous_status, 'approved');
    assert.equal(rows[1].new_status, 'disputed');
    assert.equal(rows[1].processed_by, 'u1');
  });

  await test('approved olmayan bir duruma geçişte orijinal izni HER ZAMAN kapanır', async () => {
    const id = db.prepare(`SELECT id FROM projects WHERE slug='sahipsiz'`).get().id;
    const row = (await fetchProjectMediaRights(env, id))[0];
    assert.equal(Number(row.public_original_allowed), 0);
  });
}

// =================================================================================================
section('7b) UÇTAN UCA HAK DEĞİŞİMİ + CACHE GEÇERSİZ KILMA (madde 7, 9)');

{
  // GERÇEK Worker + GERÇEK route + GERÇEK oturum: /api/project-rights/:slug üzerinden bir onay
  // verilip geri alınıyor ve HER İKİ durumda da erişim, sıralama, yük ve önbelleklerin birlikte
  // güncellendiği doğrulanıyor.
  const db = freshDb();
  const kvStore = new Map();
  const purged = [];
  const r2 = [
    ['_derived/w400/s/projects/e2e-1.webp', SAFE_BYTES],
  ];
  const assets = new Map([['/projects/e2e-1.webp', ORIGINAL_BYTES]]);
  const env = makeEnv(db, { r2, assets });
  // KV'yi dışarıdan gözlemleyebilmek için sarmala (havuz anahtarı gerçekten siliniyor mu?).
  env.FACET_CACHE = {
    async get(key, type) { const v = kvStore.get(key); return (type === 'json' && v) ? JSON.parse(v) : (v ?? null); },
    async put(key, value) { kvStore.set(key, value); },
    async delete(key) { purged.push(key); kvStore.delete(key); },
  };

  const ADMIN = 'admin-user';
  const TOKEN = 'test-token-media-rights';
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, 'a@b.c', 'x', 'Admin', 'admin', 0)`).run(ADMIN);
  db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .run(await sha256Hex(TOKEN), ADMIN, Date.now(), Date.now() + 86400e3);

  const pid = await seedProject(env, db, { slug: 'e2e', title: 'E2E', images: ['/projects/e2e-1.webp'], approved: false, mediaStatus: 'unknown' });
  const ctx = { waitUntil() {} };
  const authedReq = (path, body) => new Request(`https://mimarlab.com${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Cookie: `__Host-mimarlab_session=${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  await test('kilitli başlangıç: orijinal 404, yük güvenli uç taşıyor, bucket=1', async () => {
    _resetDecisionCacheForTests();
    const direct = await worker.fetch(new Request('https://mimarlab.com/projects/e2e-1.webp'), env, ctx);
    assert.equal(direct.status, 404);
    const detail = await worker.fetch(new Request('https://mimarlab.com/api/project/e2e'), env, ctx);
    const body = await detail.text();
    assert.ok(!body.includes('/projects/e2e-1.webp'), 'kilitli yük orijinal yolu taşıyor');
    assert.ok(body.includes('/api/media/'), 'kilitli yükte güvenli uç yok');
    assert.equal(Number(db.prepare('SELECT rights_bucket FROM projects WHERE id=?').get(pid).rights_bucket), 1);
  });

  await test('(madde 7) locked -> approved: erişim, yük, bucket ve önbellek BİRLİKTE güncellenir', async () => {
    kvStore.set('pool:projects:built', JSON.stringify([{ slug: 'bayat' }]));   // bayat havuz
    purged.length = 0;
    const before = await rightsEpoch(env);

    const res = await worker.fetch(authedReq('/api/project-rights/e2e', { action: 'approve', declaration: true }), env, ctx);
    assert.equal(res.status, 200, `onay ucu ${res.status} döndü`);
    const out = await res.json();
    assert.equal(out.copyrightApproved, true);
    assert.equal(out.rightsBucket, 0, 'onay sonrası sıralama grubu 0 olmalı');

    // 1) EPOCH ARTTI -> edge/izolat kararları yetim kaldı
    const after = await rightsEpoch(env);
    assert.notEqual(after, before, 'bumpRightsEpoch epoch\'u değiştirmedi');
    // 2) KV HAVUZU TEMİZLENDİ -> sıralama yeniden hesaplanacak
    assert.ok(purged.includes('pool:projects:built'), `havuz KV anahtarı temizlenmedi: ${purged.join(',')}`);
    assert.ok(!kvStore.has('pool:projects:built'), 'bayat havuz KV\'de kaldı');
    // 3) FINGERPRINT önbelleği de temizlendi -> liste ETag\'i bayat kalmaz
    assert.ok(purged.some(k => k.includes('fingerprint')), 'fingerprint önbelleği temizlenmedi');
    // 4) ERİŞİM AÇILDI
    _resetDecisionCacheForTests();
    const direct = await worker.fetch(new Request('https://mimarlab.com/projects/e2e-1.webp'), env, ctx);
    assert.equal(direct.status, 200);
    assert.equal(await direct.text(), ORIGINAL_BYTES);
    // 5) YÜK ARTIK ORİJİNAL YOLU TAŞIYOR (kilit kalktı)
    const detail = await worker.fetch(new Request('https://mimarlab.com/api/project/e2e'), env, ctx);
    const body = await detail.text();
    assert.ok(body.includes('/projects/e2e-1.webp'), 'onaylı yük orijinal yolu taşımıyor');
    assert.ok(!body.includes('/api/media/'), 'onaylı yükte hâlâ güvenli uç var');
    // 6) DENETİM KAYDI
    const audit = db.prepare(`SELECT action, new_status FROM media_rights_audit WHERE action='approve'`).all();
    assert.ok(audit.length >= 1, 'onay denetim kaydına yazılmadı');
  });

  await test('(madde 7) approved -> disputed: erişim kapanır, bucket 2\'ye düşer, önbellek temizlenir', async () => {
    kvStore.set('pool:projects:built', JSON.stringify([{ slug: 'bayat' }]));
    purged.length = 0;
    const before = await rightsEpoch(env);

    const res = await worker.fetch(authedReq('/api/project-rights/e2e', { action: 'dispute', reason: 'hak sahibi itirazı' }), env, ctx);
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.rightsBucket, 2, 'ihtilaf sonrası proje en son gruba düşmeli');

    assert.notEqual(await rightsEpoch(env), before, 'ihtilafta epoch artmadı');
    assert.ok(purged.includes('pool:projects:built'), 'ihtilafta havuz KV temizlenmedi');
    _resetDecisionCacheForTests();
    const direct = await worker.fetch(new Request('https://mimarlab.com/projects/e2e-1.webp'), env, ctx);
    assert.equal(direct.status, 404, 'ihtilaf sonrası orijinal hâlâ erişilebilir');
    const detail = await worker.fetch(new Request('https://mimarlab.com/api/project/e2e'), env, ctx);
    const body = await detail.text();
    assert.ok(!body.includes('/projects/e2e-1.webp'), 'ihtilaflı yük orijinal yolu taşıyor');
  });

  await test('yetkisiz kullanıcı hak değiştiremez (403) — kapı sunucuda', async () => {
    const anon = new Request('https://mimarlab.com/api/project-rights/e2e', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', declaration: true }),
    });
    const res = await worker.fetch(anon, env, ctx);
    assert.equal(res.status, 401);
  });

  await test('beyan işaretlenmeden onay verilemez (madde 10)', async () => {
    const res = await worker.fetch(authedReq('/api/project-rights/e2e', { action: 'approve' }), env, ctx);
    assert.equal(res.status, 400);
  });
}

// =================================================================================================
section('8b) SSR / meta katmanı (madde 2, 3)');

{
  const db = freshDb();
  const env = makeEnv(db, {});
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u1','a@b.c','x','Test','user',0)`).run();
  const lockedId = await seedProject(env, db, { slug: 'ssr-gizli', title: 'SSR Gizli', images: ['/projects/ssr-a.webp', '/projects/ssr-b.webp'], approved: false, mediaStatus: 'unknown' });
  const openId = await seedProject(env, db, { slug: 'ssr-acik', title: 'SSR Açık', images: ['/projects/ssr-c.webp'], approved: true, mediaStatus: 'approved' });

  await test('(madde 2/3) kilitli projenin SSR meta çıktısında orijinal yol HİÇ geçmez', async () => {
    const meta = await buildMeta('project', 'ssr-gizli', env);
    assert.ok(meta, 'meta üretilemedi');
    const blob = JSON.stringify(meta);
    assert.ok(!blob.includes('/projects/ssr-a.webp'), 'SSR/JSON-LD/OG içinde orijinal yol kalmış');
    assert.ok(!blob.includes('/projects/ssr-b.webp'));
    assert.ok(blob.includes('/api/media/'), 'gövde görseli güvenli uçtan gelmeli');
  });

  await test('(madde 3) kilitli görsel JSON-LD/OG\'de İLAN EDİLMEZ (indexlenmeyecek URL bildirilmez)', async () => {
    const meta = await buildMeta('project', 'ssr-gizli', env);
    assert.equal(meta.jsonLd.image, undefined, 'kilitli görsel JSON-LD image alanına girmemeli');
    assert.ok(!String(meta.image).includes('/api/media/'), 'og:image kilitli uca işaret etmemeli');
    assert.ok(String(meta.bodyImage || '').includes('/api/media/'), 'sayfa gövdesi güvenli sürümü göstermeli');
  });

  await test('onaylı projede JSON-LD/OG eskisi gibi ORİJİNAL görseli bildirir — regresyon yok', async () => {
    const meta = await buildMeta('project', 'ssr-acik', env);
    assert.deepEqual(meta.jsonLd.image, ['https://mimarlab.com/projects/ssr-c.webp']);
    assert.equal(meta.image, 'https://mimarlab.com/projects/ssr-c.webp');
  });

  await test('(madde 12) proje detay ucu galeriyi hak grubuna göre sıralar', async () => {
    const mediaRows = db.prepare(`SELECT id FROM media_rights WHERE entity_id = ? ORDER BY sort_order`).all(lockedId);
    // İkinci görsel onaylanır -> galeride BAŞA geçmeli.
    await setMediaRightsStatus(env, mediaRows[1].id, { status: 'approved', publicOriginalAllowed: true, action: 'approve' }, { id: 'u1' });
    db.prepare(`UPDATE projects SET is_copyright_approved = 1 WHERE id = ?`).run(lockedId);
    const item = { images: ['/projects/ssr-a.webp', '/projects/ssr-b.webp'] };
    applyProjectImageRights(item, lockedId, await fetchProjectMediaRights(env, lockedId), true);
    assert.equal(item.images[0], '/projects/ssr-b.webp', 'onaylı görsel galerinin başına geçmeli');
    assert.ok(item.images[1].startsWith('/api/media/'));
    assert.equal(openId > 0, true);
  });
}

// =================================================================================================
section('10) DÖRT VARLIK TİPİ — ürün, kişi, firma/marka (kullanıcı isteği, 2026-09-09 ikinci tur)');

{
  const db = freshDb();
  const r2 = [
    ['_derived/w400/s/mimarlar-thumb/a.jpg', SAFE_BYTES],
    ['_derived/w400/s/logos-thumb/b.jpg', SAFE_BYTES],
    ['_derived/w400/r2/products/p1.webp', SAFE_BYTES],
  ];
  const assets = new Map([
    ['/mimarlar-thumb/a.jpg', ORIGINAL_BYTES],
    ['/logos-thumb/b.jpg', ORIGINAL_BYTES],
    ['/logos/site/favicon-32.png', 'SITE-LOGO'],
  ]);
  const env = makeEnv(db, { r2, assets });
  const ctx = { waitUntil() {} };
  const req = (path) => new Request(`https://mimarlab.com${path}`);

  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES ('u1','a@b.c','x','Test','user',0)`).run();
  // Sahiplenilmemiş kişi + firma + ürün
  db.prepare(`INSERT INTO architects (slug, name, photo_url) VALUES ('kisi-a','Kişi A','mimarlar-thumb/a.jpg')`).run();
  db.prepare(`INSERT INTO offices (slug, name, logo_url) VALUES ('firma-b','Firma B','logos-thumb/b.jpg')`).run();
  db.prepare(`INSERT INTO products (slug, kind, title, images) VALUES ('urun-c','product','Ürün C','["/media/products/p1.webp"]')`).run();
  const aid = db.prepare(`SELECT id FROM architects WHERE slug='kisi-a'`).get().id;
  const oid = db.prepare(`SELECT id FROM offices WHERE slug='firma-b'`).get().id;
  const pid = db.prepare(`SELECT id FROM products WHERE slug='urun-c'`).get().id;

  await test('medya alanları doğru toplanır (avatar, logo+kapak, ürün galerisi + VERSİYONLAR)', () => {
    assert.deepEqual(collectEntityMediaUrls({ photo_url: 'x.jpg', portfolio: '["p1.webp","p2.webp"]' }, 'architect'),
      ['x.jpg', 'p1.webp', 'p2.webp']);
    assert.deepEqual(collectEntityMediaUrls({ logo_url: 'l.png', cover_url: 'c.jpg' }, 'office'), ['l.png', 'c.jpg']);
    // Versiyon görselleri ürünün KENDİ galerisini pop-up'ta gölgeler (bkz. proje notu) — kayıt dışı
    // kalırlarsa kilitli bir ürünün asıl gösterilen görselleri kapının dışında kalırdı.
    assert.deepEqual(
      collectEntityMediaUrls({ images: '["g1.webp"]', variants: '[{"images":["v1.webp","v2.webp"]}]' }, 'product'),
      ['g1.webp', 'v1.webp', 'v2.webp']);
  });

  await test('sahiplenilmemiş kişi/firma/ürün KİLİTLİ kaydedilir', async () => {
    for (const [type, id] of [['architect', aid], ['office', oid], ['product', pid]]) {
      assert.equal(await isEntityClaimBacked(env, type, id), false, `${type} yanlışlıkla sahiplenilmiş sayıldı`);
      await syncEntityMediaRights(env, type, id, {});
      const rows = db.prepare(`SELECT rights_status, public_original_allowed FROM media_rights WHERE entity_type=? AND entity_id=?`).all(type, id);
      assert.ok(rows.length >= 1, `${type} medyası hiç kaydedilmedi`);
      assert.equal(rows[0].rights_status, 'unknown');
      assert.equal(Number(rows[0].public_original_allowed), 0);
    }
  });

  await test('kilitli avatar/logo doğrudan yoldan 404 alır (mimarlar-thumb, logos-thumb)', async () => {
    _resetDecisionCacheForTests();
    for (const p of ['/mimarlar-thumb/a.jpg', '/logos-thumb/b.jpg']) {
      const res = await worker.fetch(req(p), env, ctx);
      assert.equal(res.status, 404, `kilitli medya hâlâ açık: ${p}`);
    }
  });

  await test('SİTE LOGOSU (/logos/site/*) etkilenmez — kayıtsız yol açık kalır', async () => {
    _resetDecisionCacheForTests();
    const res = await worker.fetch(req('/logos/site/favicon-32.png'), env, ctx);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'SITE-LOGO');
  });

  await test('kilitli avatarın güvenli sürümü /api/media üzerinden geliyor', async () => {
    _resetDecisionCacheForTests();
    const mid = db.prepare(`SELECT id FROM media_rights WHERE entity_type='architect' AND entity_id=?`).get(aid).id;
    const res = await worker.fetch(req(`/api/media/${mid}`), env, ctx);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), SAFE_BYTES);
  });

  await test('emniyet biçimi tip önekiyle çalışır (a<id>-<idx>)', async () => {
    _resetDecisionCacheForTests();
    const res = await worker.fetch(req(`/api/media/a${aid}-0`), env, ctx);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), SAFE_BYTES);
  });

  await test('PROFİL SAHİPLENİLİNCE medya açılır (kişi + projeleri)', async () => {
    db.prepare(`INSERT INTO projects (slug,title,images,build_status,created_at,updated_at) VALUES ('pr-a','PR A','["/projects/x.webp"]','built','2026-01-01 00:00:00','2026-01-01 00:00:00')`).run();
    const prid = db.prepare(`SELECT id FROM projects WHERE slug='pr-a'`).get().id;
    db.prepare(`INSERT INTO project_designers (project_id, architect_id) VALUES (?, ?)`).run(prid, aid);
    await registerEntityMedia(env, 'project', prid, ['/projects/x.webp'], { defaultStatus: 'unknown' });

    db.prepare(`INSERT INTO profile_claims (id,user_id,profile_type,profile_key,status,created_at,updated_at) VALUES ('c1','u1','architect','Kişi A','approved',0,0)`).run();
    const out = await openMediaForClaimKey(env, 'architect', 'Kişi A');
    assert.ok(out.opened >= 2, `beklenen en az 2 medya açılışı, olan: ${out.opened}`);
    assert.equal(db.prepare(`SELECT rights_status FROM media_rights WHERE entity_type='architect' AND entity_id=?`).get(aid).rights_status, 'approved');
    assert.equal(db.prepare(`SELECT rights_status FROM media_rights WHERE entity_type='project' AND entity_id=?`).get(prid).rights_status, 'approved');
    // Proje düzeyi onay da birlikte gelir, aksi halde galeri hâlâ kilitli görünürdü.
    assert.equal(Number(db.prepare(`SELECT is_copyright_approved FROM projects WHERE id=?`).get(prid).is_copyright_approved), 1);
  });

  await test('ihtilaflı/kaldırılmış medya SAHİPLENME ile geri açılmaz', async () => {
    db.prepare(`UPDATE media_rights SET rights_status='removed', public_original_allowed=0 WHERE entity_type='office' AND entity_id=?`).run(oid);
    db.prepare(`INSERT INTO profile_claims (id,user_id,profile_type,profile_key,status,created_at,updated_at) VALUES ('c2','u1','office','Firma B','approved',0,0)`).run();
    await openMediaForClaimKey(env, 'office', 'Firma B');
    assert.equal(db.prepare(`SELECT rights_status FROM media_rights WHERE entity_type='office' AND entity_id=?`).get(oid).rights_status, 'removed');
  });

  await test('(madde 8) havuz sıralaması: onaylı kayıtlar başa geçer, grup içi sıra korunur', async () => {
    const db2 = freshDb();
    const env2 = makeEnv(db2, {});
    for (const [slug, name] of [['a1','A1'],['a2','A2'],['a3','A3'],['a4','A4']]) {
      db2.prepare(`INSERT INTO architects (slug,name,photo_url) VALUES (?,?,?)`).run(slug, name, `mimarlar-thumb/${slug}.jpg`);
    }
    const ids = db2.prepare(`SELECT id, slug FROM architects ORDER BY id`).all();
    for (const r of ids) await registerEntityMedia(env2, 'architect', r.id, [`mimarlar-thumb/${r.slug}.jpg`], { defaultStatus: 'unknown' });
    // 2. ve 4. kayıt açılır -> onlar başa, kendi aralarında ESKİ sırayla gelmeli.
    for (const slug of ['a2', 'a4']) {
      const id = ids.find(r => r.slug === slug).id;
      db2.prepare(`UPDATE media_rights SET rights_status='approved', public_original_allowed=1 WHERE entity_type='architect' AND entity_id=?`).run(id);
    }
    const ordered = await orderRowsByRightsBucket(env2, 'architect', ids);
    assert.deepEqual(ordered.map(r => r.slug), ['a2', 'a4', 'a1', 'a3']);
  });

  await test('entityRightsBucketFrom: medyasız kayıt NÖTR (1), hepsi ihtilaflıysa 2', () => {
    assert.equal(entityRightsBucketFrom([]), 1);
    assert.equal(entityRightsBucketFrom([{ rights_status: 'approved', public_original_allowed: 1 }]), 0);
    assert.equal(entityRightsBucketFrom([{ rights_status: 'unknown', public_original_allowed: 0 }]), 1);
    assert.equal(entityRightsBucketFrom([{ rights_status: 'disputed', public_original_allowed: 0 }]), 2);
  });
}

// =================================================================================================
section('9) Kod tabanı kuralları');

await test('(madde 15) hiçbir yerde ORDER BY RANDOM() kullanılmıyor', () => {
  let out = '';
  try {
    out = execFileSync('rg', ['-n', '-i', 'ORDER BY\\s+RANDOM', 'src', 'scripts', 'js'], { encoding: 'utf8' });
  } catch (err) {
    // rg eşleşme bulamazsa çıkış kodu 1 verir — istediğimiz durum bu.
    out = err.status === 1 ? '' : String(err.stdout || '');
  }
  assert.equal(out.trim(), '', `ORDER BY RANDOM() bulundu:\n${out}`);
});

await test('(madde 8) kişi/firma pop-up ızgaraları da telif grubuna göre sıralanır', () => {
  // Bu üç yüzey proje listesinden AYRI sorgular kullanıyor (kendi ORDER BY'ları + JS sıralaması),
  // yani havuzun bucket sırasını miras ALMAZLAR — ayrıca uygulanmalı. Kaynak üzerinden doğrulanır
  // (bu depodaki yerleşik desen; tam route fixture'ı kurmak orantısız olurdu).
  const pool = readFileSync(new URL('../src/lib/projectPool.js', import.meta.url), 'utf8');
  assert.ok(/PROJECT_CARD_COLUMNS = '[^']*p\.rights_bucket/.test(pool),
    'PROJECT_CARD_COLUMNS rights_bucket taşımıyor — pop-up ızgaraları grubu bilemez');
  for (const file of ['architect.js', 'office.js']) {
    const src = readFileSync(new URL(`../src/routes/${file}`, import.meta.url), 'utf8');
    assert.ok(src.includes('if (a._bucket !== b._bucket) return a._bucket - b._bucket;'),
      `${file}: pop-up proje ızgarası bucket-first sıralamıyor`);
    assert.ok(src.includes('_bucket: Number(p.rights_bucket) || 0'),
      `${file}: rights_bucket karta taşınmıyor`);
    assert.ok(src.includes('.map(({ _year, _bucket, ...rest }) => rest)'),
      `${file}: _bucket yardımcı alanı yükten çıkarılmıyor`);
  }
});

await test('güvenli uç öneki sunucu ve istemci tarafında AYNI', () => {
  const clientSrc = readFileSync(new URL('../image-cdn.js', import.meta.url), 'utf8');
  const serverSrc = readFileSync(new URL('../src/lib/mediaRights.js', import.meta.url), 'utf8');
  assert.ok(clientSrc.includes("'/api/media/'"), 'image-cdn.js güvenli uç önekini tanımıyor');
  assert.ok(serverSrc.includes("SAFE_MEDIA_PREFIX = '/api/media/'"));
});

await test('güvenli türev genişliği, türev merdiveninin en küçük basamağıyla aynı', () => {
  const clientSrc = readFileSync(new URL('../image-cdn.js', import.meta.url), 'utf8');
  assert.ok(/DERIVATIVE_WIDTHS\s*=\s*\[400,/.test(clientSrc), 'merdivenin ilk basamağı 400 değil — SAFE_DERIVATIVE_WIDTH güncellenmeli');
});

console.log(`\n${passed} geçti, ${failed} başarısız`);
if (failed) {
  console.log('\nBaşarısızlar:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.message.split('\n')[0]}`);
  process.exit(1);
}
