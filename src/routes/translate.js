// SİTE ÇEVİRİSİ — POST /api/translate (kullanıcı isteği, 2026-09-13 madde 1).
//
//   İstek : { to: 'en', texts: ['Proje', 'Rozet Al', ...] }
//   Yanıt : { to: 'en', translations: { 'Proje': 'Projects', ... }, missing: 0 }
//
// `translations` yalnızca ÇEVRİLEBİLENLERİ taşır — çevrilemeyenler (AI kotası dolu, model hatası,
// istek başına ışka tavanı aşıldı) anahtar olarak HİÇ dönmez. İstemci bunu "bu düğüm Türkçe kalsın"
// diye okur (bkz. js/translate.js#applyTranslations). Yani çeviri katmanı bozulduğunda site
// BOZULMAZ, sadece Türkçe kalır.
//
// OTURUM GEREKTİRMEZ: giriş yapmamış bir ziyaretçi de üst çubuktaki EN düğmesine basabilmeli.
// Kapılar: IP başına dakikalık pencere + küresel günlük AI çağrı tavanı (bkz. aiConfig.js).
//
// ÖNBELLEK ÖNCE, AI SONRA: gelen her dize önce D1'deki `translations` tablosunda aranır (bkz.
// src/lib/translateStore.js). Site sözlüğü doyduktan sonra bu uç pratikte saf bir D1 okumasıdır ve
// hiç AI çağırmaz — asıl maliyet ilk günlerdedir.
import { json, errorJson, readJson } from '../lib/http.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { isAiProviderConfigured, callOnce, AiProviderError } from '../lib/aiProvider.js';
import {
  SUPPORTED_TARGET_LANGS, MAX_SOURCE_LEN, lookupTranslations, storeTranslations,
} from '../lib/translateStore.js';
import {
  TRANSLATE_MODEL, TRANSLATE_MAX_TOKENS, TRANSLATE_BATCH_SIZE,
  TRANSLATE_MAX_TEXTS_PER_REQUEST, TRANSLATE_MAX_MISSES_PER_REQUEST,
  TRANSLATE_PER_IP_MINUTE_LIMIT, TRANSLATE_GLOBAL_DAILY_AI_CALLS,
} from '../lib/aiConfig.js';

// Yanıt kullanıcıya özel DEĞİLDİR (aynı dizenin çevirisi herkes için aynı), ama POST olduğundan
// zaten edge'de önbelleklenmez. no-store yerine kısa bir private değer: tarayıcı geri/ileri
// gezinmesinde aynı POST'u yeniden oynatmasın diye.
const HEADERS = { 'Cache-Control': 'no-store' };

// Modelin dönmesi gereken şekil. Hizalama METİNLE değil İNDEKSLE yapılır: model metni yeniden
// yazarsa (tırnak/boşluk normalize ederse) metin-eşleşmeli bir hizalama sessizce kayardı.
const TRANSLATION_SCHEMA = {
  name: 'translations',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            i: { type: 'integer' },
            t: { type: 'string' },
          },
          required: ['i', 't'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = [
  'You translate user-interface strings and editorial content for MİMARLAB, a Turkish architecture',
  'and building-product platform, from Turkish into English.',
  'Rules:',
  '1. Translate meaning, not words. These are UI labels, headings, and short editorial texts.',
  '2. NEVER translate proper nouns: person names, office/firm names, brand names, product model',
  '   names, and Turkish place names (Istanbul, Kadıköy, Ankara) stay exactly as written.',
  '3. Keep the register short and professional, the way an English-language architecture platform',
  '   would label the same thing. "Rozet Al" is "Get a Badge", not "Badge Buy".',
  '4. Preserve leading/trailing spaces, punctuation, digits, units (m², TL) and casing style:',
  '   an ALL-CAPS Turkish label stays ALL-CAPS in English.',
  '5. If a string is already English, a proper noun, or has nothing to translate, return it unchanged.',
  '6. Return one object per input index. Never merge, split, drop, or reorder the inputs.',
].join('\n');

export async function handleTranslateRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api","translate"]
  if (segments.length !== 2 || request.method !== 'POST') return errorJson('Bulunamadı', 404);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!await checkRateLimit(env, 'translate-ip', ip, TRANSLATE_PER_IP_MINUTE_LIMIT, 60_000)) {
    return errorJson('Çok fazla çeviri isteği. Biraz sonra tekrar dene.', 429, HEADERS);
  }

  const body = await readJson(request);
  const to = String((body && body.to) || '').toLowerCase();
  if (!SUPPORTED_TARGET_LANGS.has(to)) return errorJson('Desteklenmeyen dil.', 400, HEADERS);

  // Normalizasyon istemcideki ile AYNI olmalı (bkz. js/translate.js#normalizeText) — aksi halde
  // istemci 'Proje ' (sondaki boşlukla) gönderir, sunucu 'Proje' için önbelleğe yazar ve ikisi
  // birbirini hiç bulamaz. Tek kural: NFC + kenar boşluklarının kırpılması.
  const seen = new Set();
  const texts = [];
  for (const raw of Array.isArray(body && body.texts) ? body.texts : []) {
    if (typeof raw !== 'string') continue;
    const text = raw.normalize('NFC').trim();
    if (!text || text.length > MAX_SOURCE_LEN) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    texts.push(text);
    if (texts.length >= TRANSLATE_MAX_TEXTS_PER_REQUEST) break;
  }
  if (!texts.length) return json({ to, translations: {}, missing: 0 }, 200, HEADERS);

  // 1) Önbellek turu.
  const cached = await lookupTranslations(env, to, texts);
  // null = önbellek kullanılamıyor (bkz. translateStore.js#lookupTranslations). AI'ya gitmek burada
  // YANLIŞ olurdu: sonuç yazılamayacağı için her istek aynı dizeleri baştan hesaplar. Hiçbir çeviri
  // dönmez, site Türkçe kalır; `cacheUnavailable` teşhis için yanıtta görünür.
  if (cached === null) {
    return json({ to, translations: {}, missing: texts.length, cacheUnavailable: true }, 200, HEADERS);
  }
  const misses = texts.filter(t => !cached.has(t));

  const out = {};
  for (const [source, translated] of cached) out[source] = translated;

  if (!misses.length) {
    return json({ to, translations: out, missing: 0 }, 200, HEADERS);
  }

  // 2) AI turu — yalnızca ışkalar, ve yalnızca tavana kadar.
  if (!isAiProviderConfigured(env)) {
    return json({ to, translations: out, missing: misses.length }, 200, HEADERS);
  }
  // Küresel günlük tavan: tüm ziyaretçiler için ortak sayaç. Aşıldığında ışkalar çevrilmeden döner
  // (site Türkçe kalır), hata DEĞİL — ertesi gün pencere sıfırlanır ve önbellek zaten dolmuştur.
  if (!await checkRateLimit(env, 'translate-global', 'all', TRANSLATE_GLOBAL_DAILY_AI_CALLS, 86_400_000)) {
    return json({ to, translations: out, missing: misses.length }, 200, HEADERS);
  }

  const todo = misses.slice(0, TRANSLATE_MAX_MISSES_PER_REQUEST);
  const fresh = [];

  for (let start = 0; start < todo.length; start += TRANSLATE_BATCH_SIZE) {
    const batch = todo.slice(start, start + TRANSLATE_BATCH_SIZE);
    let parsed;
    try {
      parsed = await callOnce(env, {
        system: SYSTEM_PROMPT,
        userText: JSON.stringify(batch.map((t, i) => ({ i, t }))),
        schema: TRANSLATION_SCHEMA,
        model: TRANSLATE_MODEL,
        maxTokens: TRANSLATE_MAX_TOKENS,
      });
    } catch (err) {
      // Kota hatasında kalan partileri denemenin anlamı yok — döngüyü kır, elimizdekiyle dön
      // (src/routes/ai.js'teki AYNI karar). Diğer hatalarda da bu parti atlanır: çevrilemeyen
      // dizeler basitçe yanıtta yer almaz.
      if (err instanceof AiProviderError && err.quotaExceeded) break;
      continue;
    }

    for (const item of (parsed && Array.isArray(parsed.items)) ? parsed.items : []) {
      const idx = Number(item && item.i);
      const translated = typeof (item && item.t) === 'string' ? item.t.trim() : '';
      if (!Number.isInteger(idx) || idx < 0 || idx >= batch.length || !translated) continue;
      const source = batch[idx];
      out[source] = translated;
      fresh.push({ source, translated });
    }
  }

  // 3) Kalıcılaştır. Yazma BAŞARISIZ olsa bile yanıt aynen döner — çeviri kullanıcıya ulaşmıştır,
  // yalnızca bir sonraki ziyaretçi için yeniden hesaplanır.
  if (fresh.length) {
    try { await storeTranslations(env, to, fresh); } catch (_) {}
  }

  const stillMissing = texts.filter(t => out[t] === undefined).length;
  return json({ to, translations: out, missing: stillMissing }, 200, HEADERS);
}
