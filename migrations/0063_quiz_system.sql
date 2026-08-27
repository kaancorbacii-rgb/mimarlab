-- AI Architecture Quiz — mimarlık bilgisi soran, MİMARLAB'ın kendi D1 verisinden deterministik
-- üretilen günlük soru oyunu (bkz. kullanıcı isteği). Soru state'i sunucuda hiç TUTULMAZ (her soru
-- project_id + question_type'a deterministik bağlıdır, bkz. src/routes/quiz.js) — bu tablo yalnızca
-- "kim, hangi gün, kaç soru çözdü" günlük hak sayacı için var. actor_key: giriş yapmış kullanıcılar
-- için 'u:<user.id>', anonim ziyaretçiler için 's:<mimarlab_quiz_sid çerezi>' — duel_matches#actor_key
-- İLE AYNI desen (bkz. src/routes/duel.js#resolveActor), Quiz de üyelik zorunlu değil ama günlük
-- limit için sunucu tarafında bir kimlik gerekiyor. user_id ayrıca (nullable) tutulur — yalnızca
-- giriş yapmış kullanıcılarda dolar, ileride "kullanıcı bazlı" bir rapor gerekirse actor_key'i tekrar
-- ayrıştırmaya gerek kalmasın diye.
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id TEXT PRIMARY KEY,
  actor_key TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  day TEXT NOT NULL,                  -- 'YYYY-MM-DD' (UTC gün — kvQuota.js/r2Quota.js İLE AYNI konvansiyon)
  question_type TEXT NOT NULL,        -- 'architect' | 'city' | 'period' | 'discipline'
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  correct INTEGER NOT NULL,           -- 0/1
  created_at INTEGER NOT NULL
);
-- Günlük hak sayacı ("SELECT COUNT(*) WHERE actor_key=? AND day=?", bkz. src/routes/quiz.js) ve aynı
-- günde art arda proje tekrarını önleme sorgusunun İKİSİ DE bu tek index'le karşılanır.
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_actor_day ON quiz_attempts(actor_key, day);
