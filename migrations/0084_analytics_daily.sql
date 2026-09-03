-- Profil İstatistikleri (kullanıcı isteği, 2026-09-04) — rozetli üyelerin Hesabım > İstatistikler
-- bölümünü besleyen TEK yeni tablo.
--
-- NEDEN YALNIZCA BİR TABLO: istenen metriklerin ÇOĞU zaten D1'de duruyor ve tarih damgası taşıyor —
-- yeni bir olay akışı açmak veriyi İKİ yerde tutmak (ve ikisini senkron tutmak) demekti:
--   * Profil kaydetmeleri / proje / ürün kaydetmeleri -> saved_items(item_type, item_key, created_at)
--   * Yeni takipçiler                                 -> follows(followed_type, followed_key, created_at)
--   * Alınan mesajlar / benzersiz gönderenler         -> messages + message_thread_recipients
-- Bunlar için hiçbir sayaç yazılmaz, doğrudan kaynak tablodan sorgulanır; böylece özellik açıldığı
-- anda GEÇMİŞ veriyle de dolu gelir (yeni bir olay tablosu olsaydı herkes sıfırdan başlardı).
--
-- GERÇEKTEN eksik olan tek şey GÖRÜNTÜLENME ve ARAMA GÖSTERİMİ: sitede bugüne kadar hiçbir
-- pageview/impression kaydı yoktu (kod tabanında tek bir view_count/analytics izi yok). Bu tablo
-- yalnızca o ikisini tutar.
--
-- NEDEN OLAY BAŞINA SATIR DEĞİL, GÜNLÜK TOPLAM: her görüntülenme için ayrı satır yazmak D1'de hem
-- yazma hem de okuma (rows_read) maliyetini görüntülenme sayısıyla doğru orantılı büyütürdü. Günlük
-- kova + UPSERT ile bir varlığın bir günü HER ZAMAN tek satırdır: 1000 görüntülenme de 1 satır.
--
-- NEDEN SAHİBE DEĞİL, KONUYA GÖRE ANAHTARLANIR: yazma yolunda (beacon) "bu projenin sahibi kim?"
-- sorusunu çözmek her görüntülenmede ek D1 okuması demekti. Sahiplik ÇÖZÜMLENMESİ okuma yoluna
-- (kullanıcı kendi istatistiklerini açtığında, seyrek) bırakıldı — bkz. src/lib/analyticsAccess.js
-- #resolveOwnedSubjects. Yazma yolu bu sayede TEK bir UPSERT'tir, hiç SELECT yapmaz.
CREATE TABLE IF NOT EXISTS analytics_daily (
  -- 'YYYY-MM-DD', UTC. Metin: D1/SQLite'ta tarih aralığı karşılaştırması leksikografik çalışır
  -- (day >= '2026-08-05'), ayrı bir dönüşüme gerek kalmaz.
  day          TEXT    NOT NULL,
  -- 'architect' | 'office' | 'project' | 'product' — kaydedilen varlığın türü.
  subject_type TEXT    NOT NULL,
  -- Varlığın slug'ı (canonical satırdaki `slug`). İsim DEĞİL: isimler yeniden adlandırmayla
  -- değişebiliyor (bkz. office rename özelliği), slug değişiminde ise 301 tablosu var.
  subject_key  TEXT    NOT NULL,
  -- 'view'               — detay pop-up'ı/sayfası gerçekten açıldı
  -- 'search_impression'  — varlık bir arama sonucu listesinde gösterildi
  metric       TEXT    NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, subject_type, subject_key, metric)
);

-- Okuma yolu HER ZAMAN "şu varlık kümesi + şu tarihten sonrası" şeklinde sorgular (bkz.
-- src/routes/analytics.js#summary) — bileşik birincil anahtar `day` ile başladığından o sorgu için
-- uygun değil; bu index (subject_type, subject_key, day) sırasıyla tam olarak o erişimi karşılar.
CREATE INDEX IF NOT EXISTS idx_analytics_daily_subject
  ON analytics_daily (subject_type, subject_key, day);
