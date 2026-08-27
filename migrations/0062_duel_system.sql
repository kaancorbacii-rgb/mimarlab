-- Düello: mevcut proje rating/Top100 sisteminden tamamen bağımsız "winner stays" karşılaştırma
-- oyunu (bkz. kullanıcı isteği). duel_score projelerin GENEL (kullanıcı/session'dan bağımsız)
-- toplam düello galibiyet sayacıdır; bir session/kullanıcının aktif projeyle yakaladığı ardışık
-- galibiyet serisi ("streak") duel_sessions'ta AYRICA tutulur ve duel_score'a hiç karışmaz
-- (bkz. src/routes/duel.js).

CREATE TABLE IF NOT EXISTS project_duel_stats (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  duel_score INTEGER NOT NULL DEFAULT 0,
  total_comparisons INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_duel_stats_score ON project_duel_stats(duel_score DESC);

-- actor_key: giriş yapmış kullanıcılar için 'u:<user.id>', anonim ziyaretçiler için
-- 's:<mimarlab_duel_sid çerezi>' (bkz. src/routes/duel.js#resolveActor) — üyelik zorunlu değil
-- (kullanıcı isteği madde 11), ama anti-duplicate/streak state'i için sunucu tarafında bir kimlik
-- gerekiyor. voted_at IS NULL == "bekleyen/oy kullanılmamış eşleşme" (bkz. duel.js#castVote'daki
-- atomik `WHERE voted_at IS NULL` deseni, ratings.js#upsertRating'teki AYNI ilke).
CREATE TABLE IF NOT EXISTS duel_matches (
  id TEXT PRIMARY KEY,
  actor_key TEXT NOT NULL,
  project_a_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  project_b_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  winner_project_id INTEGER REFERENCES projects(id),
  voted_at INTEGER,
  created_at INTEGER NOT NULL
);
-- Hem "bu actor için bekleyen eşleşme var mı" hem "son N eşleşmesi neydi" (anti-duplicate/
-- tekrar-eşleşme kontrolü) sorgularının ikisi de bu tek index'le (actor_key + son tarih) karşılanır.
CREATE INDEX IF NOT EXISTS idx_duel_matches_actor ON duel_matches(actor_key, created_at DESC);

-- Bir actor'ün "winner stays" state machine'inin sunucu tarafı çapası: aktif proje + o projeyle
-- kurulan ardışık galibiyet serisi. Yalnızca SON durumu tutar (tur geçmişi burada SAKLANMAZ, bkz.
-- duel_matches) — sayfa yenilendiğinde kaldığı yerden devam edebilmek ve streak'in client
-- tarafından forge edilememesi (bkz. kullanıcı isteği madde 8/14) için gereken minimum state.
CREATE TABLE IF NOT EXISTS duel_sessions (
  actor_key TEXT PRIMARY KEY,
  active_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  streak INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
