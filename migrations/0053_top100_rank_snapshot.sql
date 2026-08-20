-- En İyi 100 sayfası (src/routes/top100.js) için sıralama geçmişi — yukarı/aşağı/sabit oklarını
-- (bkz. kullanıcı isteği) göstermek üzere her kaydın EN SON hesaplanan sırasını saklar. Her istekte
-- güncel sıra bu satırla kıyaslanır; satır haftadan eskiyse güncel sıraya yenilenir (bkz.
-- src/routes/top100.js#SNAPSHOT_REFRESH_MS) — böylece kısa aralıklı ziyaretler tutarlı ok gösterir,
-- yalnızca gerçekten zaman geçtikçe referans noktası kayar.
CREATE TABLE IF NOT EXISTS top100_rank_snapshot (
  target_key TEXT PRIMARY KEY,
  rnk INTEGER NOT NULL,
  snapshot_at INTEGER NOT NULL
);
