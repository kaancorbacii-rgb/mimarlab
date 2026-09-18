// FOTOĞRAF SAYFASI — YENİ YÜKLENEN GÖRSELLERİN MEKAN ETİKETİ, WORKER'IN KENDİ CRON'UNDA
// (kullanıcı isteği, 2026-09-18 yedinci tur: "Bundan sonra yüklenecek tüm projeler de fotoğraflar
// sayfasında görünür olsun ve aynı kurallara göre işlesinler.")
//
// ÖLÇÜLEN BOŞLUK: bir proje yayına girdiğinde havuz (photoPool.js) onu ANINDA alır (her içerik
// yazımı invalidatePublicCache ile havuzu düşürür) ama görselleri "LLM bakmadı" (spaces: null)
// durumundadır; mekan filtresine ancak (a) CLIP ipucu varsa ya da (b) LLM etiketi geldiğinde girer.
// (b) yalnızca GitHub Actions'taki zamanlanmış işe bağlıydı (günde 4 kez) ve (a) da güvenilmezdi:
// tarayıcı embedding'i kayıt anında hesaplıyor ama sayfa 1,2 sn sonra proje sayfasına yönlendiği
// için 89 MB'lık model çoğu zaman yüklenemeden iş yarıda kalıyordu — dizin raporunda en yeni 14
// projenin HİÇBİR görselinin embedding'i yoktu.
//
// BU MODÜL: Worker'ın cron'unda (bkz. wrangler.jsonc#triggers, src/index.js#PHOTO_SPACE_CRON) her
// 15 dakikada bir, havuzla AYNI görünürlükteki projelerden v2 etiketi OLMAYAN görselleri (en yeni
// proje önce) alır, scripts/photo-space-classify-backfill.mjs ile AYNI sınıflandırıcıdan
// (photoSpaceClassify.js#classifyPhotoSpace + storedSpaceEntry, AYNI model kademesi) geçirir ve
// AYNI saklama biçimiyle yazar. Yani yeni yüklenen bir proje en geç 15 dk içinde eski projelerle
// AYNI kurallara tabi olur. GitHub'daki iş toplu geri dolum/ölçüm/CLIP embedding için durur; iki
// yazıcı da yazmadan hemen önce kolonu yeniden okuyup birleştirir (çakışmada en kötü durum bir
// görselin bir kez daha etiketlenmesidir).
//
// SINIRLAR (tur başına): PHOTO_SPACE_CRON_LIMITS — en fazla 24 görsel, ~100 sn duvar saati, 3 eş
// zamanlı vision çağrısı. Günde ~2.300 görsel kapasite; olağan yükleme temposunun çok üstünde.
// Nöron harcaması yalnızca YENİ görsel içindir (etiketli görsel yeniden sorulmaz).
//
// GÖRSEL BAYTLARI, GitHub betiğiyle AYNI adresten: sitenin kendi /media/_derived/w800/... türev
// yolu (bkz. image-cdn.js#derivativeUrl). Worker'ın kendi alan adına istek atması olağan bir
// subrequest'tir; türev yoksa media yolu orijinali servis eder.
import { classifyPhotoSpace, storedSpaceEntry, SPACE_LABEL_VERSION } from './photoSpaceClassify.js';
import { poolCacheKey } from './publicCache.js';
import { PHOTO_POOL_KIND } from './photoPool.js';

export const PHOTO_SPACE_CRON_LIMITS = { maxImages: 24, budgetMs: 100000, concurrency: 3, visionTimeoutMs: 40000 };
export const PHOTO_SPACE_CRON_SETTING_KEY = 'photo_space_cron_last';
const CLASSIFY_WIDTH = 800;
const SITE_ORIGIN = 'https://mimarlab.com';

function parseJsonArr(t) { try { const v = t ? JSON.parse(t) : []; return Array.isArray(v) ? v : []; } catch { return []; } }
function parseJsonObj(t) { try { const v = t ? JSON.parse(t) : {}; return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } }
export const isV2Entry = (entry) => !!entry && typeof entry === 'object' && !Array.isArray(entry) && Number(entry.v) === SPACE_LABEL_VERSION;

// scripts/photo-space-classify-backfill.mjs#derivedUrlFor ile AYNI şema.
export function derivativeUrlFor(rawPath, origin = SITE_ORIGIN) {
  let p = String(rawPath || '');
  if (/^https?:\/\//i.test(p)) {
    if (!p.startsWith(origin)) return p;
    p = p.slice(origin.length);
  }
  const clean = p.replace(/^\/+/, '');
  if (clean.startsWith('media/')) return `${origin}/media/_derived/w${CLASSIFY_WIDTH}/r2/${clean.slice('media/'.length)}`;
  return `${origin}/media/_derived/w${CLASSIFY_WIDTH}/s/${clean}`;
}
export function originalUrlFor(rawPath, origin = SITE_ORIGIN) {
  if (/^https?:\/\//i.test(rawPath)) return rawPath;
  return `${origin}/${String(rawPath || '').replace(/^\/+/, '')}`;
}

async function downloadImage(rawPath, fetchFn, origin) {
  for (const url of [derivativeUrlFor(rawPath, origin), originalUrlFor(rawPath, origin)]) {
    try {
      const res = await fetchFn(url, { headers: { 'User-Agent': 'MimarlabPhotoSpaceCron/1.0' } });
      if (!res || !res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!bytes.length) continue;
      const mime = (res.headers && res.headers.get && res.headers.get('content-type')) || 'image/jpeg';
      return { bytes, mime: mime.split(';')[0].trim() };
    } catch { /* sıradaki adres */ }
  }
  return null;
}

/** Havuz satırlarından v2 etiketi OLMAYAN görselleri (satır sırasıyla = en yeni proje önce) seçer. */
export function pendingImagesFrom(rows, maxImages) {
  const jobs = [];
  let pending = 0;
  for (const row of rows || []) {
    const images = parseJsonArr(row.images).filter(u => typeof u === 'string' && u);
    if (!images.length) continue;
    const spaces = parseJsonObj(row.image_spaces);
    for (const url of images) {
      if (isV2Entry(spaces[url])) continue;
      pending++;
      if (jobs.length < maxImages) jobs.push({ projectId: row.id, slug: row.slug, url });
    }
  }
  return { jobs, pending };
}

// Betikteki flushProject ile AYNI sözleşme: yazmadan hemen önce kolon YENİDEN okunur ve
// birleştirilir; projede artık olmayan görsellerin girdileri atılır.
async function writeProjectSpaces(env, projectId, entries) {
  const fresh = await env.DB.prepare(`SELECT images, image_spaces FROM projects WHERE id = ?`).bind(projectId).first();
  if (!fresh) return false;
  const live = new Set(parseJsonArr(fresh.images));
  const merged = parseJsonObj(fresh.image_spaces);
  for (const [url, entry] of entries) merged[url] = entry;
  for (const k of Object.keys(merged)) if (!live.has(k)) delete merged[k];
  await env.DB.prepare(`UPDATE projects SET image_spaces = ? WHERE id = ?`).bind(JSON.stringify(merged), projectId).run();
  return true;
}

// Son turun özeti site_settings'e (iç anahtar — bkz. siteSettings.js#INTERNAL_SETTING_KEYS) yazılır;
// /api/photos/stats bunu `cron` alanında gösterir. Worker Logs'a bakmadan "cron çalışıyor mu"
// sorusunun cevabı budur.
async function recordRun(env, summary) {
  try {
    await env.DB.prepare(
      `INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).bind(PHOTO_SPACE_CRON_SETTING_KEY, JSON.stringify(summary), Date.now()).run();
  } catch (err) { console.error('photoSpaceCron: özet yazılamadı', err && err.message); }
}
export async function readLastRun(env) {
  try {
    const row = await env.DB.prepare(`SELECT value FROM site_settings WHERE key = ?`).bind(PHOTO_SPACE_CRON_SETTING_KEY).first();
    return row && row.value ? JSON.parse(row.value) : null;
  } catch { return null; }
}

export async function labelPendingPhotoSpaces(env, opts = {}) {
  const limits = { ...PHOTO_SPACE_CRON_LIMITS, ...opts };
  const fetchFn = opts.fetch || globalThis.fetch;
  const origin = opts.origin || SITE_ORIGIN;
  const started = Date.now();
  // Havuzla AYNI görünürlük (photoPool.js): blurlu/arşivdeki projeye AI harcanmaz; blur kalkınca
  // bir sonraki tur onu alır.
  const { results: rows } = await env.DB.prepare(
    `SELECT id, slug, images, image_spaces FROM projects
     WHERE deleted_at IS NULL AND hidden_at IS NULL
     ORDER BY created_at DESC, id DESC`
  ).all();
  const { jobs, pending } = pendingImagesFrom(rows || [], limits.maxImages);
  const stats = { at: new Date(started).toISOString(), scanned: (rows || []).length, pending, classified: 0, failed: 0, projectsWritten: 0, budgetHit: false };
  if (jobs.length && env.AI) {
    const results = new Map();
    let next = 0;
    const worker = async () => {
      for (;;) {
        if (Date.now() - started > limits.budgetMs) { stats.budgetHit = true; return; }
        const job = jobs[next++];
        if (!job) return;
        try {
          const img = await downloadImage(job.url, fetchFn, origin);
          if (!img) { stats.failed++; continue; }
          const result = await classifyPhotoSpace(env, img.bytes, limits.visionTimeoutMs, img.mime);
          if (!results.has(job.projectId)) results.set(job.projectId, new Map());
          results.get(job.projectId).set(job.url, storedSpaceEntry(result));
          stats.classified++;
        } catch (err) {
          stats.failed++;
          console.error('photoSpaceCron: sınıflandırılamadı', job.url, err && err.message);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(limits.concurrency, jobs.length) }, worker));
    for (const [projectId, entries] of results) {
      try { if (await writeProjectSpaces(env, projectId, entries)) stats.projectsWritten++; }
      catch (err) { console.error('photoSpaceCron: yazılamadı', projectId, err && err.message); }
    }
    // Havuz KV'de 30 dk yaşar; yeni etiketler bir sonraki istekte görünsün diye yalnızca fotoğraf
    // havuzunun anahtarı düşürülür (invalidatePublicCache'in site geneli temizliği gereksiz).
    if (stats.projectsWritten && env.FACET_CACHE) {
      try { await env.FACET_CACHE.delete(poolCacheKey(PHOTO_POOL_KIND)); } catch { /* TTL zaten var */ }
    }
  }
  stats.remaining = Math.max(0, pending - stats.classified);
  stats.elapsedMs = Date.now() - started;
  await recordRun(env, stats);
  return stats;
}
