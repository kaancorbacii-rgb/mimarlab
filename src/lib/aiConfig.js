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

// Tek bir env.AI.run() çağrısının azami süresi (bkz. src/lib/aiProvider.js#callOnce) — denetim
// bulgusu: src/routes/ai.js#handleAiSearchRoute'daki extractFilters/generateSummary çağrıları zaten
// withTimeout(..., AI_TIMEOUT_MS=9000) ile korunuyordu, ama bu daha büyük/yavaş modeli (AI_MODEL,
// 70B) kullanan çıkarım akışı (handleExtract → callOnce, AI_MAX_ATTEMPTS=3 kez tekrar denenebilir)
// HİÇ bir zaman aşımı sarmalayıcısına sahip değildi — env.AI.run() beklenmedik şekilde asılırsa
// (ör. sağlayıcı tarafı bir sorun) istek, Worker'ın kendi üst sınırına kadar (üstelik 3 deneme
// boyunca kümülatif olarak) askıda kalabilirdi. Arama akışındakinden daha büyük bir değer: bu model
// daha büyük (70B) ve daha fazla token (AI_MAX_TOKENS=2000) üretiyor, gerçek başarılı çağrılar 9sn'yi
// rahatça aşabilir.
export const AI_EXTRACT_CALL_TIMEOUT_MS = 25000;

// Kullanıcı başına saatlik ve tüm kullanıcılar için günlük toplam çıkarım isteği limiti
// (bkz. src/lib/rateLimit.js#checkRateLimit). Kötüye kullanım/maliyet kilidi.
export const AI_EXTRACT_PER_USER_HOURLY_LIMIT = 5;
export const AI_EXTRACT_GLOBAL_DAILY_LIMIT = 50;

// Gönderim anında dış görselleri R2'ye kopyalayan uç nokta için ayrı, biraz daha gevşek bir
// kullanıcı limiti (bir gönderi birden çok görsel taşıyabilir) + istek başına azami görsel sayısı.
// htmlExtract.js#extractPageContent'in aday listesi için kullandığı maxImages (60) ile hizalı —
// aksi halde AI/kullanıcı sayfadaki tüm ilgili görselleri seçse bile burada sessizce kırpılırdı
// (bkz. kullanıcı isteği: "yapay zeka verilen linkten görsel çekerken tüm görselleri çeksin").
export const AI_COPY_IMAGES_PER_USER_HOURLY_LIMIT = 20;
export const AI_COPY_IMAGES_MAX_PER_REQUEST = 60;

// Kaynak sayfa çekme ayarları — bkz. safeFetch.js.
export const AI_FETCH_TIMEOUT_MS = 10000;
export const AI_MAX_REDIRECTS = 3;
export const AI_MAX_PAGE_BYTES = 5 * 1024 * 1024; // 5 MB üstü sayfalar "çok büyük" sayılır

// Alt sayfa keşfi (bkz. src/lib/htmlExtract.js#LINK_KEYWORD_PATTERN, src/routes/ai.js#handleExtract)
// — ana sayfada mimar/firma/ekip bilgisi eksikse aynı domain'deki about/team/press sayfalarından
// en fazla bu kadarı ek olarak çekilir; her biri ana sayfadan daha küçük bir karakter bütçesiyle
// (AI_SUBPAGE_MAX_CHARS) modele eklenir — sınırsız bir crawler değil, sabit bir bütçe (bkz.
// kullanıcı isteği: "kontrollü crawl budget kullan").
export const AI_MAX_SUBPAGES = 2;
export const AI_SUBPAGE_MAX_CHARS = 4000;

// ===============================================================================================
// SİTE ÇEVİRİSİ (kullanıcı isteği, 2026-09-13 madde 1) — bkz. src/routes/translate.js.
// ===============================================================================================
// NEDEN AYNI INSTRUCT MODEL, ayrı bir çeviri modeli (ör. m2m100) DEĞİL: çevrilen şey serbest metin
// değil, ARAYÜZ DİZELERİ ve başlıklar — "Rozet Al", "En İyi 100", "Kaydet" gibi kısa, bağlamsız
// parçalar. Saf bir çeviri modeli bunları bağlamsız çevirir ("Rozet Al" -> "Get Badge" yerine
// "Badge Get" gibi); JSON Mode'lu instruct model ise sistem talimatıyla "bu bir mimarlık
// platformunun arayüzü" bağlamını alabiliyor ve PARTİ hâlinde (tek çağrıda 20 dize) çalışıyor —
// yani dize başına bir çağrı yerine sayfa başına birkaç çağrı. Önbellek küresel ve kalıcı olduğu
// için (bkz. migrations/0117_translations.sql) bu maliyet yalnızca bir kez ödenir.
export const TRANSLATE_MODEL = AI_MODEL;
export const TRANSLATE_MAX_TOKENS = 3000;
export const TRANSLATE_CALL_TIMEOUT_MS = 20000;

// Tek AI çağrısında kaç dize çevrilir. 20: llama-3.3-70b'nin JSON dizisini indeksleriyle birlikte
// tutarlı üretebildiği, TRANSLATE_MAX_TOKENS'a rahatça sığan parti boyu. Daha büyük partiler
// (50+) denendiğinde modelin dizinin kuyruğunu kırpma riski artar; hizalama indeksle yapıldığından
// (bkz. route'taki `i` alanı) kırpılan kuyruk sessizce Türkçe kalır, yani hata değil ama israftır.
export const TRANSLATE_BATCH_SIZE = 20;

// İstemcinin TEK istekte gönderebileceği en fazla dize. js/translate.js aynı sayıda parçalar.
export const TRANSLATE_MAX_TEXTS_PER_REQUEST = 60;

// Tek istekte AI'ya gidebilecek en fazla ÖNBELLEK IŞKASI. Önbellekten gelenlerin sayısı sınırsız
// (onlar bedava); yalnızca AI'ya gidecek olanlar sınırlı — böylece ilk ziyaretçinin isteği
// Worker'ın süre bütçesini tüketmez. Artan dizeler ÇEVRİLMEDEN, kaynak hâliyle döner ve istemci
// bir sonraki turda yeniden sorar (bkz. js/translate.js#flush'taki yeniden deneme yok: o düğümler
// Türkçe kalır, MutationObserver'ın bir sonraki turunda yeniden denenir).
export const TRANSLATE_MAX_MISSES_PER_REQUEST = 40;

// Kötüye kullanım kapıları. Çeviri ucu OTURUM GEREKTİRMEZ (giriş yapmamış ziyaretçi de siteyi
// İngilizce okuyabilmeli), bu yüzden tek koruma IP başına pencere + küresel günlük AI tavanı.
export const TRANSLATE_PER_IP_MINUTE_LIMIT = 40;
export const TRANSLATE_GLOBAL_DAILY_AI_CALLS = 3000;
