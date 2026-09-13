// ÇEVİRİ ÖNBELLEĞİ — D1'deki `translations` tablosunun tek okuma/yazma kapısı
// (bkz. migrations/0117_translations.sql, src/routes/translate.js).
//
// Bu dosya AI'ya HİÇ dokunmaz: yalnızca "bu dizenin İngilizcesi elimizde var mı?" sorusunu yanıtlar
// ve gelen çevirileri biriktirir. AI çağrısı ve parti (batch) mantığı route'ta; ayrı tutulmalarının
// nedeni, önbelleğin AI sağlayıcısı değişse de (ya da hiç yapılandırılmamış olsa da) aynen
// çalışmaya devam etmesi.
import { sha256Hex } from './crypto.js';

// Desteklenen hedef diller. Şimdilik yalnızca İngilizce — üst çubuktaki tek düğme (EN/TR) bunu
// gerektiriyor. Yeni bir dil eklemek için burası ve js/translate.js#SUPPORTED yeter; şema zaten
// target_lang taşıyor, migration gerekmez.
export const SUPPORTED_TARGET_LANGS = new Set(['en']);

// Tek bir çeviri satırının kaynak metin üst sınırı. Bundan uzun bir düğüm zaten arayüz metni değil,
// bir makale gövdesidir (gündem içerikleri) — istemci de aynı sınırı uygular (bkz.
// js/translate.js#MAX_TEXT_LEN), yani buraya gelmesi beklenmez; sunucu tarafı kapı savunma amaçlı.
export const MAX_SOURCE_LEN = 600;

export async function translationHash(targetLang, sourceText) {
  return sha256Hex(targetLang + '\n' + sourceText);
}

// Verilen kaynak metinler için önbellekteki çevirileri döndürür.
//
// DÖNEN DEĞER İKİ ANLAMLIDIR ve çağıran taraf ikisini AYIRMAK ZORUNDADIR:
//   Map  -> önbellek çalışıyor. İçindekiler bulunanlar, eksikler AI'ya gidebilir.
//   null -> ÖNBELLEK KULLANILAMIYOR (tipik olarak `translations` tablosu henüz yok: migration
//           0117 uygulanmamış). Bu durumda AI'ya GİTMEK YANLIŞTIR: her çeviri hesaplanır, yazılamaz
//           ve bir sonraki istekte baştan hesaplanır — yani sınırsız tekrar eden bir maliyet.
//           Route bunu görünce hiçbir şey çevirmeden döner ve site Türkçe kalır (bkz.
//           src/routes/translate.js). Tablo oluşturulduğu an kendiliğinden düzelir.
//
// json_each(?) deseni src/lib/analyticsAccess.js#ownedSlugs ile AYNI: hash listesi tek bir bind
// parametresi olarak geçer, böylece metin sayısı değiştikçe farklı bir prepared statement
// derlenmez (D1'in statement cache'i korunur).
export async function lookupTranslations(env, targetLang, texts) {
  const found = new Map();
  if (!texts.length) return found;

  const hashes = await Promise.all(texts.map(t => translationHash(targetLang, t)));
  const byHash = new Map();
  hashes.forEach((h, i) => byHash.set(h, texts[i]));

  let results;
  try {
    ({ results } = await env.DB.prepare(
      `SELECT hash, translated_text FROM translations
       WHERE target_lang = ?1 AND hash IN (SELECT value FROM json_each(?2))`
    ).bind(targetLang, JSON.stringify(hashes)).all());
  } catch (_) {
    return null;
  }

  for (const row of results || []) {
    const source = byHash.get(row.hash);
    if (source !== undefined) found.set(source, row.translated_text);
  }
  return found;
}

// Yeni çevirileri yazar. INSERT OR IGNORE: aynı dizeyi iki istek aynı anda çevirmiş olabilir
// (iki farklı ziyaretçi, aynı sayfa) — yarış hâlinde ikinci yazma sessizce düşer, çünkü iki çeviri
// de geçerlidir ve hangisinin kazandığı önemsizdir.
//
// env.DB.batch: satır sayısı kadar round-trip yerine tek gidiş-dönüş.
export async function storeTranslations(env, targetLang, pairs) {
  const rows = pairs.filter(p => p && p.source && p.translated && p.source !== p.translated);
  if (!rows.length) return 0;

  const now = Date.now();
  const stmts = await Promise.all(rows.map(async p => {
    const hash = await translationHash(targetLang, p.source);
    return env.DB.prepare(
      `INSERT OR IGNORE INTO translations (hash, target_lang, source_text, translated_text, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`
    ).bind(hash, targetLang, p.source, p.translated, now);
  }));

  await env.DB.batch(stmts);
  return rows.length;
}
