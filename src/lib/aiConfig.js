// AI destekli otomatik ekleme akışının (bkz. src/routes/ai.js) tüm ayarlanabilir limitleri tek
// yerden yönetilsin diye burada toplanıyor — model/limit değiştirmek için tek dosya yeterli.

// Cloudflare Workers AI model kataloğundaki JSON Mode (response_format) destekleyen modeller
// arasından en güçlü instruct model — bkz. src/lib/aiProvider.js başındaki gerekçe.
export const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const AI_MAX_TOKENS = 2000;

// Açık ağırlıklı modeller şemaya Anthropic Structured Outputs kadar güvenilir uymayabilir (bkz.
// Cloudflare docs: "Workers AI can't guarantee that the model responds according to the requested
// JSON Schema") — bu yüzden ilk denemenin üstüne 2 kez daha (toplam 3 deneme) tekrar denenir;
// üçü de şema doğrulamasından geçemezse mevcut aiFailed:true + katman-1 yoluna düşülür.
export const AI_MAX_ATTEMPTS = 3;

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
