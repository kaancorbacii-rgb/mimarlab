// AI destekli otomatik ekleme akışının çıkarım katmanı — Cloudflare Workers AI, `env.AI.run()` ile
// (bkz. wrangler.jsonc#ai binding). Anthropic API'den bilinçli olarak vazgeçildi: Workers AI, hesabın
// zaten sahip olduğu ücretsiz günlük nöron kotasını kullanır, ayrı bir hesap/anahtar gerektirmez.
//
// Model seçimi: Cloudflare'in JSON Mode (response_format) destekleyen modelleri arasında
// (developers.cloudflare.com/workers-ai/json-mode) en güçlü instruct model @cf/meta/llama-3.3-70b-
// instruct-fp8-fast — 70B parametreli sınıfın en güncel Llama sürümü, "fast" varyant gecikmeyi
// düşürüyor (bkz. src/lib/aiConfig.js#AI_MODEL, burada sabit değil, çağırana parametre olarak geçer).
//
// ÖNEMLİ: Cloudflare'in kendi dokümantasyonu "Workers AI can't guarantee that the model responds
// according to the requested JSON Schema" diyor — yani Anthropic'in Structured Outputs'unun aksine
// şema uyumu burada GARANTİ EDİLMEZ. Bu yüzden dönen JSON'un `found` gibi kritik alanları burada
// DEĞİL, çağıran tarafta (src/routes/ai.js#sanitizeExtraction) ayrıca doğrulanıp temizlenir; bu modül
// yalnızca "modelden bir JSON nesnesi almayı" garanti eder, içeriğinin şemaya tam uyduğunu değil.

import { AI_EXTRACT_CALL_TIMEOUT_MS } from './aiConfig.js';

export function isAiProviderConfigured(env) {
  return !!(env.AI && typeof env.AI.run === 'function');
}

export class AiProviderError extends Error {
  constructor(code, { quotaExceeded = false } = {}) {
    super(code);
    this.code = code;
    this.quotaExceeded = quotaExceeded;
  }
}

// Cloudflare'in ücretsiz günlük nöron kotası aşıldığında env.AI.run()'ın attığı hatanın tam şekli
// dokümante edilmemiş — mesaj metninde bilinen anahtar kelimeleri arayarak sezgisel olarak tespit
// ediyoruz (bkz. src/routes/ai.js — bu durumda kullanıcıya kendi günlük limitimizle aynı tonda bir
// mesaj gösterilir, tekrar denemek anlamsız olduğundan retry döngüsü hemen durur).
function isQuotaError(err) {
  const status = err && (err.httpStatus || err.status);
  if (status === 429) return true;
  const msg = String((err && err.message) || '').toLowerCase();
  return /quota|rate.?limit|capacity|budget|exceed/.test(msg);
}

// Tek bir deneme: model çağrısı + JSON çıkarımı. Şema doğrulaması burada YAPILMAZ (bkz. yukarıdaki
// yorum) — çağıran taraf (src/routes/ai.js) hem bu fonksiyonun hatalarını hem de dönen JSON'un
// şemaya uyup uymadığını ayrı ayrı değerlendirip kendi retry döngüsünü işletir.
//
// gerçek bulgu (denetim): src/routes/ai.js#handleAiSearchRoute'daki AYNI env.AI.run() çağrıları
// (extractFilters/generateSummary) withTimeout() ile korunurken bu fonksiyon HİÇ bir zaman aşımı
// sarmalayıcısına sahip değildi — env.AI.run() beklenmedik biçimde asılırsa (sağlayıcı tarafı bir
// sorun, ör. ağ/altyapı) çağıran tarafın AI_MAX_ATTEMPTS (3) kez tekrar deneyen döngüsü kümülatif
// olarak çok uzun süre askıda kalabilir, isteği gereksiz yere Worker'ın kendi üst zaman sınırına
// kadar tıkardı. AI_EXTRACT_CALL_TIMEOUT_MS aşılırsa AiProviderError('timeout') fırlatılır — çağıran
// zaten TÜM AiProviderError'ları (quota hariç) bir sonraki deneme hakkı olarak sayıyor, bu yüzden
// davranış mevcut retry/aiFailed fallback akışına sorunsuz oturur.
export async function callOnce(env, { system, userText, schema, model, maxTokens }) {
  let result;
  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('ai_timeout')), AI_EXTRACT_CALL_TIMEOUT_MS));
    result = await Promise.race([
      env.AI.run(model, {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userText },
        ],
        response_format: { type: 'json_schema', json_schema: schema },
        max_tokens: maxTokens,
        // Bu bir yaratıcı yazım değil, yapılandırılmış veri çıkarımı görevi — düşük sıcaklık, modelin
        // sayfada açıkça yazmayan alanları "yaratıcı" biçimde doldurma (uydurma) eğilimini azaltır ve
        // aynı sayfa için tekrarlanabilir/tutarlı sonuçlar verir (bkz. kullanıcı isteği: "daha doğru
        // bilgi tespiti yapsın").
        temperature: 0.2,
      }),
      timeout,
    ]);
  } catch (err) {
    if (err && err.message === 'ai_timeout') throw new AiProviderError('timeout');
    if (isQuotaError(err)) throw new AiProviderError('quota_exceeded', { quotaExceeded: true });
    throw new AiProviderError('provider_error');
  }

  let parsed = result && result.response;
  // Dokümantasyona göre `response` zaten ayrıştırılmış bir nesne olarak dönüyor, ama bazı model/
  // sürüm kombinasyonları JSON metni string olarak dönebiliyor — her iki durumu da tolere ediyoruz.
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { throw new AiProviderError('invalid_json'); }
  }
  if (!parsed || typeof parsed !== 'object') throw new AiProviderError('invalid_json');
  return parsed;
}
