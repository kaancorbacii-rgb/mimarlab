// GÜNDEM TUR TELEMETRİSİ — KALICI KAYIT + CRON SAĞLIK DEĞERLENDİRMESİ (2026-09-07)
//
// =============================================================================================
// NEDEN VAR
// =============================================================================================
// runGundemIngestion her turun sonunda ayrıntılı bir `stats` payload'u üretiyor (logRun) ama bu
// payload YALNIZCA Workers Logs'ta yaşıyordu. Bunun iki gerçek sonucu oldu:
//   1) 1ff0e1b7 olayında hat sıfır içerik üretirken `publish_failed=20` logda vardı ama hiçbir
//      dış kontrol onu okuyamıyordu — cron "başarılı" görünüyordu.
//   2) scripts/health-check.sh'in tazelik kontrolü /api/gundem'deki EN YENİ KAYDA bakıyordu; o
//      kayıt bir geri doldurmadan (ingest_mode='backfill') geliyorsa cron durmuş olsa bile kontrol
//      "taze" diyordu. 2026-09-07'de tam bu yaşandı: 17:34'te biten backfill, cron'un düzeltme
//      sonrası hiç çalışmamış olduğunu 30 saat boyunca maskeleyebilirdi.
//
// Bu modül aynı payload'u (yeniden hesaplamadan) gundem_runs tablosuna yazar ve sağlık sinyalini
// YALNIZCA ingest_mode='cron' satırlarından üretir. Backfill satırları cron tazeliğini hiçbir
// koşulda karşılamaz — bkz. readLastGundemRun'daki WHERE.
//
// SAĞLIK ANLAMI (assessGundemCronHealth):
//   "cron çalışmadı"                 -> unhealthy (no_run / stale)
//   "cron çalıştı, istisnayla bitti" -> unhealthy (failed)
//   "cron çalıştı, anomali var"      -> unhealthy (anomaly: publish_failed vb.)
//   "cron çalıştı, kill switch kapalı"-> unhealthy (disabled) — bilinçli ama görünür olmalı
//   "cron çalıştı, 0 içerik"         -> HEALTHY (ok_no_content) — her aday mükerrer/kalite reddi
//                                        olabilir, bu hattın normal davranışıdır
//   "cron çalıştı, içerik üretti"    -> HEALTHY (ok)
//
// HİÇBİR ŞEYİ KIRMAZ: persistGundemRun kendi hatalarını yutar (tablo yoksa, D1 geçici hata verirse
// tur yine tamamlanır ve orijinal hata/sonuç değişmez). gundemCronHealthFields da aynı şekilde —
// /api/_health deploy doğrulamasının okuduğu uçtur, ASLA 500 dönmemeli.

import { newId } from './crypto.js';

// Cron ızgarası TR saatiyle 4 saatte bir (bkz. wrangler.jsonc#triggers.crons). 30 saat ≈ arka
// arkaya 7 kaçırılmış tur — tek bir boş/kaçırılmış turun gürültü yapmaması için bilerek geniş.
export const GUNDEM_CRON_STALE_MS = 30 * 60 * 60 * 1000;

// stats.skipped anahtarlarını kovalar. AI kaynaklı reddedişler (model hata verdi, "emin değilim"
// dedi, "bu bir proje tanıtımı" dedi) kalite kapısından (validateAiOutput reddi) ayrılır — ikisi
// de qualityFailed sayacına giriyor, ayrım yalnızca burada, anahtar adına göre yapılır.
const AI_REJECT_KEY_RE = /^(ai_|is_project$)/;

function sumBySource(stats, field) {
  let total = 0;
  for (const row of Object.values((stats && stats.bySource) || {})) total += Number(row[field]) || 0;
  return total;
}

// Mevcut payload'dan gundem_runs satırını türetir. SAF fonksiyon (birim test edilebilir).
export function runRowFromStats({ id, startedAt, finishedAt, ingestMode, stats, error }) {
  const s = stats || {};
  const skipped = s.skipped || {};
  let aiRejected = 0;
  for (const [key, n] of Object.entries(skipped)) if (AI_REJECT_KEY_RE.test(key)) aiRejected += Number(n) || 0;
  const qualityFailed = Number(s.qualityFailed) || 0;
  return {
    id,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: Math.max(0, finishedAt - startedAt),
    ingest_mode: ingestMode === 'backfill' ? 'backfill' : 'cron',
    ok: error ? 0 : 1,
    disabled: s.disabled ? 1 : 0,
    disabled_reason: s.disabled ? (s.disabledReason || null) : null,
    sources_tried: Number(s.sourcesTried) || 0,
    sources_ok: Number(s.sourcesOk) || 0,
    sources_failed: Number(s.sourcesFailed) || 0,
    fetched: sumBySource(s, 'found'),
    within_freshness: sumBySource(s, 'fresh'),
    candidates: Number(s.candidates) || 0,
    duplicate: Number(s.duplicate) || 0,
    project_filtered: Number(skipped.project_prefilter) || 0,
    ai_rejected: aiRejected,
    quality_rejected: Math.max(0, qualityFailed - aiRejected),
    published: Number(s.published) || 0,
    publish_failed: Number(skipped.publish_failed) || 0,
    ai_calls: Number(s.aiCalls) || 0,
    anomalies: JSON.stringify(Array.isArray(s.anomalies) ? s.anomalies : []),
    error: error ? String((error && error.message) || error).slice(0, 500) : null,
    // Tam payload — logRun'un bastığıyla aynı veri; bySource ayrıntısı da burada.
    stats: JSON.stringify(s).slice(0, 60000),
  };
}

// Turu kalıcı olarak kaydeder. HİÇ FIRLATMAZ.
export async function persistGundemRun(env, params) {
  try {
    if (!env || !env.DB) return null;
    const row = runRowFromStats({ id: newId(), finishedAt: Date.now(), ...params });
    const cols = Object.keys(row);
    await env.DB.prepare(
      `INSERT INTO gundem_runs (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    ).bind(...cols.map(c => row[c])).run();
    return row;
  } catch (err) {
    // Telemetri asıl işi (ingestion) asla engellemez; tablo henüz yoksa (migration uygulanmadan
    // deploy edilmişse) ya da D1 geçici hata verirse sessizce geçilir ve loga düşülür.
    console.error(JSON.stringify({ event: 'gundem_run_persist_failed', reason: (err && err.message) || String(err) }));
    return null;
  }
}

// Belirtilen moddaki SON turu döner. WHERE ingest_mode = ? ŞARTTIR: backfill satırlarının cron
// tazeliğini karşılamaması tam olarak bu satırla sağlanır.
export async function readLastGundemRun(env, ingestMode = 'cron') {
  if (!env || !env.DB) return null;
  const row = await env.DB.prepare(
    `SELECT id, started_at, finished_at, duration_ms, ingest_mode, ok, disabled, disabled_reason,
            sources_tried, sources_ok, sources_failed, fetched, within_freshness, candidates,
            duplicate, project_filtered, ai_rejected, quality_rejected, published, publish_failed,
            ai_calls, anomalies, error
       FROM gundem_runs WHERE ingest_mode = ? ORDER BY started_at DESC LIMIT 1`
  ).bind(ingestMode).first();
  return row || null;
}

// SAF değerlendirme — satır (ya da null) + şimdi -> sağlık kararı. Birim testlerin kilitlediği yer.
export function assessGundemCronHealth(row, now = Date.now(), staleMs = GUNDEM_CRON_STALE_MS) {
  if (!row) return { healthy: false, status: 'no_run', ageMs: null, anomalies: [] };
  let anomalies = [];
  try { const parsed = JSON.parse(row.anomalies || '[]'); if (Array.isArray(parsed)) anomalies = parsed; } catch { anomalies = []; }
  const ageMs = Math.max(0, now - Number(row.started_at));
  const base = {
    ageMs, anomalies,
    published: Number(row.published) || 0,
    publishFailed: Number(row.publish_failed) || 0,
    error: row.error || null,
  };
  if (ageMs > staleMs) return { ...base, healthy: false, status: 'stale' };
  if (!row.ok) return { ...base, healthy: false, status: 'failed' };
  if (row.disabled) return { ...base, healthy: false, status: 'disabled' };
  if (base.publishFailed > 0 || anomalies.length) return { ...base, healthy: false, status: 'anomaly' };
  if (base.published === 0) return { ...base, healthy: true, status: 'ok_no_content' };
  return { ...base, healthy: true, status: 'ok' };
}

// /api/_health'e eklenen alanlar — mevcut camelCase adlandırmaya uygun (globalCachePurge gibi).
// HİÇ FIRLATMAZ: tablo yoksa/okunamazsa alanlar null döner, uç 200 kalır.
export async function gundemCronHealthFields(env, now = Date.now()) {
  let row = null;
  let readError = null;
  try { row = await readLastGundemRun(env, 'cron'); }
  catch (err) { readError = (err && err.message) || String(err); }
  const h = assessGundemCronHealth(row, now);
  return {
    gundemLastCronRun: row ? new Date(Number(row.started_at)).toISOString() : null,
    // saniye — health-check.sh'in bc/jq olmadan tam sayı karşılaştırması yapabilmesi için.
    gundemLastCronRunAge: row ? Math.round(h.ageMs / 1000) : null,
    gundemLastCronPublished: row ? h.published : null,
    gundemLastCronPublishFailed: row ? h.publishFailed : null,
    gundemLastCronAnomalies: h.anomalies,
    gundemCronStatus: readError ? 'read_error' : h.status,
    gundemCronHealthy: readError ? false : h.healthy,
  };
}
