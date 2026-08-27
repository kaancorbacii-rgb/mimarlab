-- Quiz sayfası kaldırıldı (bkz. kullanıcı isteği) — quiz_attempts artık hiçbir kod
-- yolundan referans edilmiyor (0063_quiz_system.sql ile eklenmişti). Tabloyu (ve
-- kendisiyle birlikte otomatik düşen idx_quiz_attempts_actor_day index'ini) kaldırır.
DROP TABLE IF EXISTS quiz_attempts;
