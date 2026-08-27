-- Düello Analizi — kullanıcının bir Düello oturumu boyunca seçtiği TÜM projelerden (yalnızca son
-- eşleşme değil, bkz. kullanıcı isteği) çıkarılan deterministik "Mimari Tercih Analizi"'nin kalıcı
-- kaydı. Bilinçli olarak duel_matches/duel_sessions'tan TAMAMEN BAĞIMSIZ: seçim zinciri istemci
-- tarafında (duello.html#duelChain) toplanır, "Tamamla" anında /api/duel/analyze ile hesaplanır,
-- yalnızca "Kaydet"e basılırsa buraya yazılır (bkz. src/routes/duel.js) — mevcut, çalışan Düello
-- oy verme/streak/leaderboard şemasına ve yazma yoluna hiçbir FK/dokunuş yok, bu yüzden sıfır
-- regresyon riski taşır. Kaydedilmiş bir analiz, sonraki Düello oturumlarından ASLA etkilenmez
-- (kullanıcı isteği: "yeni sonuçlar eski kaydı değiştirmemeli") — snapshot mantığıyla summary_json
-- içinde donmuş halde saklanır.
CREATE TABLE IF NOT EXISTS duel_analyses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  choice_count INTEGER NOT NULL,
  project_slugs_json TEXT NOT NULL,   -- JSON dizi — seçim zincirindeki kazanan proje slug'ları (sırayla)
  summary_json TEXT NOT NULL,         -- JSON — sunucunun hesapladığı deterministik özet (bkz. computeDuelAnalysis)
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_duel_analyses_user ON duel_analyses(user_id, created_at DESC);
