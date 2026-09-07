-- GÜNDEM TUR TELEMETRİSİ (cron observability hardening, 2026-09-07)
--
-- Her runGundemIngestion turu için BİR satır. Veri, turun zaten ürettiği stats payload'unun
-- kalıcı hâlidir (bkz. src/lib/gundemRuns.js#runRowFromStats — yeniden hesaplama yok).
--
-- NEDEN: 1ff0e1b7 olayında `publish_failed=20` yalnızca Workers Logs'taydı; health-check'in
-- tazelik kontrolü ise EN YENİ gundem_items satırına bakıyordu ve o satır bir geri doldurmadan
-- geldiğinde durmuş cron'u maskeliyordu (2026-09-07'de tam bu oldu). Sağlık sinyali artık
-- YALNIZCA ingest_mode='cron' satırlarından okunur — bkz. gundemRuns.js#readLastGundemRun.
--
-- Hacim: cron 4 saatte bir -> günde 6 satır (+ nadiren elle backfill). Yıllık ~2.200 satır.
-- Yalnızca EKLEME (CREATE TABLE IF NOT EXISTS) — mevcut hiçbir tablo/satıra dokunmaz.

CREATE TABLE IF NOT EXISTS gundem_runs (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  -- 'cron' | 'backfill' — health-check bu kolona göre ayırır, backfill cron tazeliğini KARŞILAMAZ.
  ingest_mode TEXT NOT NULL,
  -- 1 = tur istisnasız tamamlandı ("0 yayın" da ok'tur); 0 = istisnayla bitti (error dolu).
  ok INTEGER NOT NULL,
  -- kill switch kapalı / AI binding yok: tur çalıştı ama bilinçli olarak hiçbir şey yapmadı.
  disabled INTEGER NOT NULL DEFAULT 0,
  disabled_reason TEXT,
  sources_tried INTEGER NOT NULL DEFAULT 0,
  sources_ok INTEGER NOT NULL DEFAULT 0,
  sources_failed INTEGER NOT NULL DEFAULT 0,
  -- feed'lerden okunan ham girdi (bySource.found toplamı)
  fetched INTEGER NOT NULL DEFAULT 0,
  -- tazelik penceresinden geçenler (bySource.fresh toplamı)
  within_freshness INTEGER NOT NULL DEFAULT 0,
  -- mükerrer/AI aşamasına giren adaylar
  candidates INTEGER NOT NULL DEFAULT 0,
  duplicate INTEGER NOT NULL DEFAULT 0,
  project_filtered INTEGER NOT NULL DEFAULT 0,
  -- AI kaynaklı red (model hatası / emin değil / proje tanıtımı) vs kalite kapısı reddi
  ai_rejected INTEGER NOT NULL DEFAULT 0,
  quality_rejected INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0,
  -- yazma aşamasında patlayan adaylar — 1ff0e1b7'nin imzası
  publish_failed INTEGER NOT NULL DEFAULT 0,
  ai_calls INTEGER NOT NULL DEFAULT 0,
  -- JSON dizi, bkz. gundemIngest.js#classifyGundemRun
  anomalies TEXT,
  error TEXT,
  -- tam stats payload'u (JSON) — logRun'un bastığıyla aynı
  stats TEXT
);

-- Health okuması: "son cron turu" = WHERE ingest_mode='cron' ORDER BY started_at DESC LIMIT 1.
CREATE INDEX IF NOT EXISTS idx_gundem_runs_mode_started ON gundem_runs(ingest_mode, started_at DESC);
