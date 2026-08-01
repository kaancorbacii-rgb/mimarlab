// Claude (Anthropic Messages API) çağrısı — düz fetch() ile, SDK YOK (bu projede hiç npm bağımlılığı
// yok, bkz. src/lib/iyzico.js'teki aynı "düz fetch ile üçüncü taraf API" deseni). Yapılandırılmış
// çıkarım için Structured Outputs (`output_config.format`, GA özellik) kullanılır — model çıktısı
// her zaman verilen JSON şemasına uyar, ayrıca elle regex/`JSON.parse` doğrulaması gerekmez.
//
// Anahtar `env.ANTHROPIC_API_KEY`'den okunur (Cloudflare secret — `wrangler secret put
// ANTHROPIC_API_KEY` ile ayrı ayrı tanımlanır, koda asla gömülmez, bkz. wrangler.jsonc'teki
// IYZICO_* anahtarları için aynı yorum).

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export function isAnthropicConfigured(env) {
  return !!env.ANTHROPIC_API_KEY;
}

export class AnthropicError extends Error {
  constructor(code, { retryable = false } = {}) {
    super(code);
    this.code = code;
    this.retryable = retryable;
  }
}

async function callOnce(env, { system, userText, schema, model, maxTokens, effort, timeoutMs }) {
  const body = {
    model,
    max_tokens: maxTokens,
    system,
    // Thinking bilinçli olarak kapalı: bu tek seferlik, deterministik bir çıkarım görevi —
    // adaptif thinking'in (Sonnet 5'te varsayılan açık) max_tokens bütçesinden pay alıp JSON
    // yanıtını yarıda kesmesini (stop_reason: max_tokens) istemiyoruz.
    thinking: { type: 'disabled' },
    output_config: { effort, format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: userText }],
  };

  let res;
  try {
    res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new AnthropicError('network_error', { retryable: true });
  }

  if (!res.ok) {
    // 429/5xx geçici olabilir (yeniden denemeye değer); diğer 4xx'ler (ör. 400 geçersiz istek)
    // kendi hatamızdır, tekrar denemek sonucu değiştirmez.
    throw new AnthropicError(`http_${res.status}`, { retryable: res.status === 429 || res.status >= 500 });
  }

  const data = await res.json();
  if (data.stop_reason === 'refusal') throw new AnthropicError('refusal', { retryable: false });
  if (data.stop_reason !== 'end_turn') throw new AnthropicError(`stop_reason_${data.stop_reason}`, { retryable: true });

  const textBlock = (data.content || []).find(b => b.type === 'text');
  if (!textBlock || !textBlock.text) throw new AnthropicError('no_text_block', { retryable: true });

  try {
    return JSON.parse(textBlock.text);
  } catch {
    throw new AnthropicError('invalid_json', { retryable: true });
  }
}

// Geçici bir hata (ağ/429/5xx/geçersiz JSON) alınırsa otomatik olarak BİR KEZ daha dener; ikinci
// deneme de başarısız olursa hatayı olduğu gibi çağırana fırlatır (çağıran taraf katman-1/deterministik
// veriyle devam eder — bkz. src/routes/ai.js).
export async function extractStructured(env, options) {
  try {
    return await callOnce(env, options);
  } catch (err) {
    if (!(err instanceof AnthropicError) || !err.retryable) throw err;
    return await callOnce(env, options);
  }
}
