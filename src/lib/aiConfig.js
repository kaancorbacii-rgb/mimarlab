// AI destekli otomatik ekleme akışının (bkz. src/routes/ai.js) tüm ayarlanabilir limitleri tek
// yerden yönetilsin diye burada toplanıyor — model/limit değiştirmek için tek dosya yeterli.

export const AI_MODEL = 'claude-sonnet-5';
export const AI_MAX_TOKENS = 2000;
export const AI_EFFORT = 'medium';

// Sayfa içeriği bu karakter sayısına kırpılıp modele öyle gönderilir (bkz. htmlExtract.js).
export const AI_MAX_CONTENT_CHARS = 15000;

// Kullanıcı başına saatlik ve tüm kullanıcılar için günlük toplam çıkarım isteği limiti
// (bkz. src/lib/rateLimit.js#checkRateLimit). Kötüye kullanım/maliyet kilidi.
export const AI_EXTRACT_PER_USER_HOURLY_LIMIT = 5;
export const AI_EXTRACT_GLOBAL_DAILY_LIMIT = 50;

// Gönderim anında dış görselleri R2'ye kopyalayan uç nokta için ayrı, biraz daha gevşek bir
// kullanıcı limiti (bir gönderi birden çok görsel taşıyabilir) + istek başına azami görsel sayısı.
export const AI_COPY_IMAGES_PER_USER_HOURLY_LIMIT = 20;
export const AI_COPY_IMAGES_MAX_PER_REQUEST = 10;

// Kaynak sayfa çekme ayarları — bkz. safeFetch.js.
export const AI_FETCH_TIMEOUT_MS = 10000;
export const AI_MAX_REDIRECTS = 3;
export const AI_MAX_PAGE_BYTES = 5 * 1024 * 1024; // 5 MB üstü sayfalar "çok büyük" sayılır
