// GÜNDEM OTOMATİK TOPLAMA HATTI (kullanıcı isteği, 2026-09-06 madde 7).
//
//   CRON → SOURCE FETCH → FEED PARSE → NEW ITEM DETECTION → DUPLICATE CHECK → CONTENT EXTRACTION
//        → IMAGE VALIDATION → AI TITLE/SUMMARY → CATEGORY → ENTITY EXTRACTION → QUALITY VALIDATION
//        → PUBLISH → CACHE PURGE
//
// Hiçbir adımda manuel onay yoktur; içerik ya tüm kapılardan geçip yayınlanır ya da sessizce elenir.
//
// =============================================================================================
// SIRALAMA NEDEN BU (maliyet + doğruluk)
// =============================================================================================
// Mükerrer kontrolü, GÖRSEL çözümlemesinden ve AI çağrısından ÖNCE gelir (madde 18: "Duplicate
// içeriklerde AI çağrısı yapma"). Bu mümkün, çünkü dört mükerrer basamağının dördü de yalnızca
// feed'den gelen ham veriye dayanır (URL, canonical, içerik hash'i, başlık anahtarı) — hiçbiri AI
// çıktısına bağlı değil. Görsel doğrulaması AI'den önce gelir çünkü görselsiz içerik zaten
// yayınlanmayacak; sırayı ters çevirmek her elenen içerik için bir AI çağrısı israf ederdi.
//
// =============================================================================================
// BİLİNEN SINIR — DİLLER ARASI MÜKERRER
// =============================================================================================
// content_hash ve title_key kaynağın KENDİ dilindeki başlık/alıntıdan üretilir. Aynı haberi bir
// İngilizce ve bir Türkçe kaynak birbirinden bağımsız yayınlarsa iki kart oluşabilir. Bunu
// yakalamak semantik benzerlik (embedding) gerektirir; Vectorize eklemek kullanıcı isteğinde
// AÇIKÇA kapsam dışı (madde 29). Aynı dildeki tüm varyantlar (farklı URL, takip parametreli URL,
// kelime sırası değişmiş başlık, aynı haberin yeniden yayını) yakalanır.

import { activeGundemSources } from './gundemSources.js';
import { fetchFeed, fetchPageMeta, normalizeImageUrl } from './gundemFeed.js';
import {
  normalizeSourceUrl, titleKey, contentHash, isAllowedImageHost,
  validateAiOutput, EXCERPT_MAX_CHARS,
} from './gundemQuality.js';
import { isValidGundemCategory } from './gundemCategories.js';
import { generateGundemSummary, isGundemAiAvailable, AiProviderError } from './gundemAi.js';
import { buildGundemEntityIndex, resolveGundemEntities } from './gundemEntities.js';
import { AI_MODEL } from './aiConfig.js';
import { getSiteSettings } from './siteSettings.js';
import { newId } from './crypto.js';
import { slugify } from './slugify.js';
import { purgeGundemCache } from './gundemCache.js';

// =============================================================================================
// GÜVENLİK LİMİTLERİ (madde 17)
// =============================================================================================
// Hard-code edilmiş sabitler DEĞİL, tek bir yapılandırma nesnesi — değiştirmek için tek satır.
// Değerler kullanıcı isteğindeki başlangıç önerileriyle birebir (run başına 20, kaynak başına 5,
// günde 50).
export const GUNDEM_LIMITS = {
  maxItemsPerRun: 20,
  // Kaynak yapılandırmasındaki maxItemsPerRun bundan BÜYÜK olamaz (tavan burada).
  // 5 -> 6 (2026-09-07): cron 30dk'dan 2 SAATE indi, yani tur başına daha fazla birikmiş içerik
  // oluyor. Tavan kaynak yapılandırmasındaki değerlerle (6) hizalandı — aksi halde oradaki 6
  // sessizce 5'e kırpılırdı.
  maxItemsPerSource: 6,
  maxPublishPerDay: 50,
  // Bir içerik için AI en fazla bu kadar denenir (ilk deneme dahil). "Sonsuz retry yapma" (madde 9).
  //
  // ÖLÇÜLMÜŞ DAVRANIŞ (gerçek modelle 6 içerik, 2026-09-06): @cf/meta/llama-3.3-70b bu görevde
  // İLK denemede neredeyse her zaman kısa yazıyor (23-33 kelime); ne yanlış yaptığı söylenen
  // İKİNCİ denemede 38-55 kelimeye çıkıyor. Yani içerik başına pratikte ~2 AI çağrısı normaldir
  // ve 2 deneme yeterlidir — 6 içeriğin 5'i bu şekilde yayına ulaştı, elenen tek içerik gerçekten
  // kısa kalandı. 3. bir deneme eklemek tur bütçesini yer, kazanç getirmez.
  aiMaxAttempts: 2,
  // Üst üste bu kadar hata veren kaynak soğutmaya alınır.
  maxSourceFailures: 4,
  failureCooldownMin: 240,
  // Aynı anda kaç kaynağa gidilir. 3 = "güvenli paralellik" (madde 21) — dış kaynaklara agresif
  // eşzamanlılık uygulanmaz; ayrıca her kaynağa aynı anda YALNIZCA TEK istek gider (feed ya da tek
  // bir makale metadata'sı), yani hiçbir yayıncı bizden paralel yük görmez.
  sourceConcurrency: 3,
  // Bu yaştan eski feed girdileri hiç işlenmez — ilk kurulumda 120 maddelik bir arşivin toptan
  // yayınlanmasını ve "gündem"in eski içerikle dolmasını engeller.
  maxItemAgeDays: 21,
  // Turun toplam duvar-saati bütçesi. Aşılırsa tur temiz biçimde durur ve kalanı bir sonraki cron
  // alır (madde 21: "Cloudflare Worker execution/time limitsini dikkate al").
  //
  // 60sn -> 120sn (ilk canlı tur ölçümü, 2026-09-06): 60sn'de yalnızca 8 aday işlenebildi ve tur
  // `run_budget_exhausted` ile kesildi — AI çağrısı başına ~4sn sürüyor. Cron tetikleyicilerinin
  // duvar-saati sınırı bunun çok üstündedir (CPU sınırı 30sn'dir ve AI çağrıları CPU değil G/Ç
  // beklemesidir), yani asıl kısıt buradaki kendi bütçemizdi. 120sn, tur başına 20 içeriklik
  // tavana gerçekten ulaşılabilmesini sağlar.
  runBudgetMs: 120000,
};

const DAY_MS = 86400000;

// ---------------------------------------------------------------------------------------------
// Kaynak sağlığı
// ---------------------------------------------------------------------------------------------

async function loadSourceHealth(env) {
  const { results } = await env.DB.prepare(
    'SELECT source_id, last_success_at, last_error_at, consecutive_failures, last_run_at FROM gundem_source_health'
  ).all();
  return new Map(results.map(r => [r.source_id, r]));
}

async function recordSourceResult(env, sourceId, ok, errorMessage) {
  const now = Date.now();
  if (ok) {
    await env.DB.prepare(
      `INSERT INTO gundem_source_health (source_id, last_success_at, last_run_at, consecutive_failures, updated_at)
       VALUES (?, ?, ?, 0, ?)
       ON CONFLICT(source_id) DO UPDATE SET last_success_at = excluded.last_success_at,
         last_run_at = excluded.last_run_at, consecutive_failures = 0, last_error = NULL, updated_at = excluded.updated_at`
    ).bind(sourceId, now, now, now).run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO gundem_source_health (source_id, last_error_at, last_run_at, last_error, consecutive_failures, updated_at)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(source_id) DO UPDATE SET last_error_at = excluded.last_error_at,
       last_run_at = excluded.last_run_at, last_error = excluded.last_error,
       consecutive_failures = gundem_source_health.consecutive_failures + 1, updated_at = excluded.updated_at`
  ).bind(sourceId, now, now, String(errorMessage || '').slice(0, 300), now).run();
}

// Kaynak bu turda işlenmeli mi? İki bağımsız kapı: (a) kendi fetchIntervalMin'i dolmuş mu,
// (b) üst üste çok hata verdiyse soğutma penceresi geçmiş mi. İkincisi kaynağı KALICI olarak
// kapatmaz — pencere dolunca kendiliğinden tekrar dener (kaynak düzelirse sistem kendi kendini
// onarır, elle müdahale gerekmez).
// DUE_GRACE_MS — cron ızgarası ile işlenme anı arasındaki kaçınılmaz kaymayı soğurur.
//
// GERÇEK BULGU (canlı, 2026-09-06 21:30): kaynaklar 20:30:40-47'de İŞLENİYOR (cron 20:30:00'da
// tetiklendi, feed'lere ulaşmak ~40sn sürdü ve last_run_at o an yazıldı). Bir sonraki uygun tur
// 21:30:00'da tetikleniyor — aradan 59 dk 20 sn geçmiş oluyor ve `>= 60 dk` kontrolü YEDİ SANİYEYLE
// kaçıyordu. Sonuç: 60 dakikalık aralık pratikte 90 dakikaya çıkıyordu (kaynak her seferinde kendi
// penceresini ıskalayıp bir sonraki tura kalıyordu) — sistem tasarlandığından kalıcı olarak yavaş
// çalışıyordu, üstelik hiçbir hata vermeden.
//
// 5 dakikalık pay bu kaymayı fazlasıyla kapsar ve hızı ARTIRMAZ: cron ızgarası (2026-09-07'den
// beri 2 SAATLİK) her zaman bu paydan çok daha geniştir — 120 dakikalık bir aralık "115 dakikadan
// sonra due" olsa bile bir sonraki fiili tur yine 120. dakikadaki turdur. Yani kaynaklara gidiş
// sıklığı değişmez, yalnızca ıskalanan pencere düzelir.
const DUE_GRACE_MS = 5 * 60000;

function isSourceDue(source, health, now) {
  if (!health) return true;
  const failing = (health.consecutive_failures || 0) >= GUNDEM_LIMITS.maxSourceFailures;
  const waitMin = failing
    ? Math.max(source.fetchIntervalMin, GUNDEM_LIMITS.failureCooldownMin)
    : source.fetchIntervalMin;
  if (!health.last_run_at) return true;
  return now - health.last_run_at >= waitMin * 60000 - DUE_GRACE_MS;
}
export { isSourceDue as _isSourceDueForTests };

// ---------------------------------------------------------------------------------------------
// Mükerrer kontrolü
// ---------------------------------------------------------------------------------------------

// Adayların TAMAMI için TEK sorgu — her aday için ayrı SELECT atmak (N+1) bu depodaki bilinen
// tuzak. `IN (...)` düz bir liste olarak kurulur; SQLite'ın 100 terimli ifade-ağacı derinlik
// sınırına takılan `A OR B OR ...` zinciri KULLANILMAZ (bkz. proje notu).
async function loadExistingKeys(env, candidates) {
  const urls = [...new Set(candidates.flatMap(c => [c.normalizedUrl, c.canonicalKey].filter(Boolean)))];
  const hashes = [...new Set(candidates.map(c => c.contentHash))];
  const titles = [...new Set(candidates.map(c => c.titleKey).filter(Boolean))];

  const existing = { urls: new Set(), hashes: new Set(), titles: new Set() };
  const runIn = async (column, values, target) => {
    if (!values.length) return;
    // D1 tek ifade boyut sınırı (bkz. proje notu) — 200'lük parçalar hâlinde sorulur.
    for (let i = 0; i < values.length; i += 200) {
      const chunk = values.slice(i, i + 200);
      const placeholders = chunk.map(() => '?').join(',');
      const { results } = await env.DB.prepare(
        `SELECT ${column} AS v FROM gundem_items WHERE ${column} IN (${placeholders})`
      ).bind(...chunk).all();
      results.forEach(r => { if (r.v) target.add(r.v); });
    }
  };
  await Promise.all([
    runIn('source_url', urls, existing.urls),
    runIn('canonical_url', urls, existing.urls),
    runIn('content_hash', hashes, existing.hashes),
    runIn('title_key', titles, existing.titles),
  ]);
  return existing;
}

function isDuplicate(candidate, existing, seenInRun) {
  // 1. source_url (normalize) → 2. canonical URL → 3. content_hash → 4. normalize başlık anahtarı.
  if (existing.urls.has(candidate.normalizedUrl)) return 'url';
  if (candidate.canonicalKey && existing.urls.has(candidate.canonicalKey)) return 'canonical';
  if (existing.hashes.has(candidate.contentHash)) return 'content_hash';
  if (candidate.titleKey && existing.titles.has(candidate.titleKey)) return 'title';
  // AYNI TUR içinde iki kaynaktan gelen aynı içerik (D1'de henüz yok, ama bu turda yazılacak).
  if (seenInRun.urls.has(candidate.normalizedUrl)) return 'url_in_run';
  if (candidate.contentHash && seenInRun.hashes.has(candidate.contentHash)) return 'content_hash_in_run';
  if (candidate.titleKey && seenInRun.titles.has(candidate.titleKey)) return 'title_in_run';
  return null;
}

// ---------------------------------------------------------------------------------------------
// Slug
// ---------------------------------------------------------------------------------------------

// Türkçe başlıktan slug. Çakışma olasılığına karşı kısa bir sonek denenir; 3 denemede de tutmazsa
// içerik atlanır (uydurma/anlamsız bir slug yazmaktansa yayınlamamak yeğdir).
async function allocateSlug(env, title) {
  const base = slugify(title).slice(0, 70).replace(/-+$/, '') || 'gundem';
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${newId().slice(0, 6)}`;
    const clash = await env.DB.prepare('SELECT 1 FROM gundem_items WHERE slug = ? LIMIT 1').bind(slug).first();
    if (!clash) return slug;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Tek bir kaynağın feed'inden aday listesi
// ---------------------------------------------------------------------------------------------

async function collectCandidates(source, now, opts = {}) {
  const items = await fetchFeed(source.feedUrl);
  const maxAge = (opts.maxAgeDays ?? GUNDEM_LIMITS.maxItemAgeDays) * DAY_MS;
  const perSourceCap = opts.maxItemsPerSource ?? GUNDEM_LIMITS.maxItemsPerSource;
  const perSource = Math.min(source.maxItemsPerRun || perSourceCap, perSourceCap);

  const fresh = items.filter(it => {
    // Tarihi hiç olmayan girdi kabul edilir (bazı feed'lerde eksik) ama tarihi VARSA ve eskiyse elenir.
    if (it.publishedAt === null) return true;
    return now - it.publishedAt <= maxAge;
  });
  // En yeniden eskiye — feed sırası her kaynakta güvenilir değil.
  fresh.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));

  const out = [];
  for (const it of fresh) {
    if (out.length >= perSource * 3) break; // mükerrer eleme payı bırak; yayın tavanı ayrıca uygulanır
    let normalizedUrl;
    try { normalizedUrl = normalizeSourceUrl(it.link); } catch { continue; }
    if (!normalizedUrl) continue;
    const excerpt = (it.excerpt || '').slice(0, EXCERPT_MAX_CHARS);
    out.push({
      source,
      link: it.link,
      normalizedUrl,
      canonicalKey: null, // 'og' stratejisinde makale metadata'sından doldurulur
      title: it.title,
      excerpt,
      author: it.author || null,
      categories: it.categories || [],
      publishedAt: it.publishedAt,
      image: it.image,
      titleKey: titleKey(it.title),
      contentHash: await contentHash(it.title, excerpt),
    });
  }
  return out;
}

// Feed'in kendi <category> etiketlerinden kategori türetme — AI'den ÖNCE denenir (ucuz ve
// yayıncının kendi sınıflandırması olduğu için AI tahmininden daha güvenilir).
function categoryFromHints(source, categories) {
  for (const hint of source.categoryHints || []) {
    if (categories.some(c => hint.match.test(c))) return hint.category;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Görsel çözümleme (feed → gerekiyorsa makale önizleme metadata'sı)
// ---------------------------------------------------------------------------------------------

async function resolveImage(candidate) {
  const source = candidate.source;
  const fromFeed = normalizeImageUrl(candidate.image, candidate.link);
  if (fromFeed && isAllowedImageHost(fromFeed, source)) {
    return { image: fromFeed, canonical: null, extraExcerpt: '', finalUrl: null };
  }
  if (source.imageStrategy !== 'og') return { image: null };
  // Yalnızca <head> önizleme metadata'sı okunur — gövde değil (bkz. gundemFeed.js#extractPageMeta).
  const meta = await fetchPageMeta(candidate.link);
  const image = meta.image && isAllowedImageHost(meta.image, source) ? meta.image : null;
  return {
    image,
    canonical: meta.canonical ? normalizeSourceUrl(meta.canonical) : null,
    extraExcerpt: meta.description || '',
    finalUrl: meta.finalUrl || null,
    sourcePublishedAt: meta.publishedAt || null,
  };
}

// ---------------------------------------------------------------------------------------------
// Havuzlar (entity eşleştirme) — TEMBEL yüklenir
// ---------------------------------------------------------------------------------------------
// Hiçbir içerik yayın aşamasına gelmezse (hepsi mükerrer/elendi) bu havuzlar HİÇ okunmaz.
// Okunduklarında da KV önbelleğinden gelirler (bkz. publicCache.js#getCachedPool) — ek D1 maliyeti
// tipik turda sıfırdır.
function lazyEntityIndex(env, deps) {
  let promise = null;
  return () => {
    if (!promise) {
      promise = (async () => {
        try {
          const [offices, architects, products, projects] = await Promise.all([
            deps.fetchOfficePool(env),
            deps.fetchArchitectPool(env),
            deps.fetchProductPool(env),
            deps.fetchProjectPool(env),
          ]);
          return buildGundemEntityIndex({ offices, architects, products, projects });
        } catch (err) {
          // Entity eşleştirme bir EK'tir; havuz okunamazsa içerik entity'siz yayınlanır.
          console.warn(JSON.stringify({ event: 'gundem_entity_index_failed', reason: (err && err.message) || String(err) }));
          return null;
        }
      })();
    }
    return promise;
  };
}

// ---------------------------------------------------------------------------------------------
// Tek bir adayı işleyip yayınla
// ---------------------------------------------------------------------------------------------

async function publishCandidate(env, candidate, ctx) {
  const source = candidate.source;
  const stats = ctx.stats;

  // --- GÖRSEL DOĞRULAMA (AI'den ÖNCE — elenecek içerik için AI harcanmaz) -----------------------
  let resolved;
  try {
    resolved = await resolveImage(candidate);
  } catch (err) {
    stats.skipped.image_fetch_failed = (stats.skipped.image_fetch_failed || 0) + 1;
    return null;
  }
  if (!resolved.image) {
    // Görselsiz içerik bu tasarımda yayınlanamaz (kart görsel zorunlu) ve hukuki belirsizlik
    // durumunda da atlama kuralı geçerli (madde 6).
    stats.skipped.no_valid_image = (stats.skipped.no_valid_image || 0) + 1;
    return null;
  }

  // Makale metadata'sı canonical verdiyse mükerrer kontrolünü BİR KEZ DAHA uygula: aynı haber
  // farklı bir URL'den gelmiş olabilir ve bunu ancak şimdi öğrendik.
  if (resolved.canonical) {
    candidate.canonicalKey = resolved.canonical;
    if (ctx.existing.urls.has(resolved.canonical) || ctx.seenInRun.urls.has(resolved.canonical)) {
      stats.duplicate += 1;
      stats.duplicateBy.canonical_late = (stats.duplicateBy.canonical_late || 0) + 1;
      return null;
    }
  }

  // --- AI (kategori ipucu varsa yine de AI çağrılır: başlık+özet zaten gerekli) ------------------
  const hintCategory = categoryFromHints(source, candidate.categories);
  const excerptForAi = [candidate.excerpt, resolved.extraExcerpt]
    .filter(Boolean).join(' ').slice(0, EXCERPT_MAX_CHARS);

  let validated = null;
  let lastReason = 'ai_no_attempt';
  for (let attempt = 0; attempt < GUNDEM_LIMITS.aiMaxAttempts && !validated; attempt++) {
    let raw;
    try {
      stats.aiCalls += 1;
      raw = await generateGundemSummary(env, {
        sourceName: source.name,
        sourceTitle: candidate.title,
        sourceExcerpt: excerptForAi,
        sourceLanguage: source.language,
        // İkinci denemede modele NE YANLIŞ YAPTIĞI söylenir (bkz. gundemAi.js#RETRY_HINT_BY_REASON)
        // — aynı promptu tekrarlamak ilk canlı turda aynı hatayı tekrar üretiyordu.
        retryReason: attempt > 0 ? lastReason : null,
      });
    } catch (err) {
      if (err instanceof AiProviderError && err.quotaExceeded) {
        // Kota bitti: tekrar denemek anlamsız, TÜM tur durur (madde 9).
        ctx.abort = 'ai_quota_exceeded';
        lastReason = 'ai_quota_exceeded';
        break;
      }
      lastReason = `ai_${(err && err.code) || 'error'}`;
      continue;
    }
    if (raw && raw.confident === false) {
      // Model kendi kendine "emin değilim" dedi — bu bir hata değil, doğru davranış. Tekrar
      // denemek aynı sonucu vereceğinden döngü hemen kırılır.
      lastReason = 'ai_not_confident';
      break;
    }
    const result = validateAiOutput(raw, {
      sourceTitle: candidate.title,
      sourceExcerpt: excerptForAi,
      fallbackCategory: hintCategory || source.defaultCategory,
    });
    if (result.ok) {
      validated = result;
      // Feed'in kendi kategorisi AI'nin önerisini EZER — yayıncının sınıflandırması daha güvenilir.
      if (hintCategory && isValidGundemCategory(hintCategory)) validated.category = hintCategory;
      // AI kategori önermediyse/whitelist dışıysa validateAiOutput zaten fallback'e düşürdü.
      validated.entities = Array.isArray(raw.entities) ? raw.entities : [];
    } else {
      lastReason = result.reason;
    }
  }

  if (!validated) {
    stats.qualityFailed += 1;
    stats.skipped[lastReason] = (stats.skipped[lastReason] || 0) + 1;
    return null;
  }

  // --- ENTITY EŞLEŞTİRME (yalnızca mevcut kayıtlar; yeni entity YARATILMAZ) ----------------------
  let entities = [];
  if (validated.entities.length) {
    const index = await ctx.getEntityIndex();
    if (index) entities = resolveGundemEntities(index, validated.entities);
  }

  // --- YAZ ---------------------------------------------------------------------------------------
  const slug = await allocateSlug(env, validated.title);
  if (!slug) {
    stats.skipped.slug_unavailable = (stats.skipped.slug_unavailable || 0) + 1;
    return null;
  }

  const now = Date.now();
  const id = newId();
  const sourceUrl = candidate.normalizedUrl;
  let imageHost = '';
  try { imageHost = new URL(resolved.image).hostname.toLowerCase(); } catch { imageHost = ''; }

  const statements = [
    env.DB.prepare(
      `INSERT OR IGNORE INTO gundem_items (
         id, slug, title, original_title, summary, image_url, image_host,
         source_id, source_name, source_domain, source_url, canonical_url,
         source_published_at, published_at, category, language, original_language, author,
         content_hash, title_key, status, ai_model, ai_generated_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'tr', ?, ?, ?, ?, 'published', ?, ?, ?, ?)`
    ).bind(
      id, slug, validated.title, candidate.title.slice(0, 400), validated.summary,
      resolved.image, imageHost,
      source.id, source.name, source.domain, sourceUrl, candidate.canonicalKey,
      candidate.publishedAt || resolved.sourcePublishedAt || null, now,
      validated.category, source.language, candidate.author,
      candidate.contentHash, candidate.titleKey,
      AI_MODEL, now, now, now
    ),
    ...entities.map(e => env.DB.prepare(
      `INSERT OR IGNORE INTO gundem_entities (item_id, entity_type, entity_key, entity_name, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(id, e.type, e.key, e.name, now)),
  ];
  await env.DB.batch(statements);

  // Bu turda tekrar aynı içerik gelmesin diye anahtarlar işaretlenir.
  ctx.seenInRun.urls.add(sourceUrl);
  if (candidate.canonicalKey) ctx.seenInRun.urls.add(candidate.canonicalKey);
  ctx.seenInRun.hashes.add(candidate.contentHash);
  if (candidate.titleKey) ctx.seenInRun.titles.add(candidate.titleKey);

  stats.published += 1;
  stats.entitiesLinked += entities.length;
  return { id, slug };
}

// ---------------------------------------------------------------------------------------------
// TUR
// ---------------------------------------------------------------------------------------------

// deps: havuz okuyucuları dışarıdan enjekte edilir — bu dosyanın src/routes/* içine bağımlı
// olmaması (lib → route yönünde bir bağımlılık doğurmaması) için. Çağıran src/index.js#scheduled.
// options (hepsi opsiyonel) — NORMAL cron turu hiçbirini geçmez, yani varsayılan davranış
// GUNDEM_LIMITS'in kendisidir. Yalnızca scripts/gundem-backfill.mjs (tek seferlik geri doldurma)
// bunları kullanır: "bugün yayımlanan her şeyi şimdi çek" gibi bir istek, kaynak zamanlamasını ve
// tur başına düşük tavanları geçici olarak esnetmeyi gerektirir. Kalite/mükerrer/görsel kapıları
// bu override'lardan ETKİLENMEZ — onlar her koşulda aynı çalışır.
export async function runGundemIngestion(env, deps, options = {}) {
  const startedAt = Date.now();
  const runBudgetMs = options.runBudgetMs ?? GUNDEM_LIMITS.runBudgetMs;
  const stats = {
    sourcesTried: 0, sourcesOk: 0, sourcesFailed: 0,
    fetched: 0, candidates: 0, duplicate: 0, published: 0,
    qualityFailed: 0, aiCalls: 0, entitiesLinked: 0,
    duplicateBy: {}, skipped: {}, errors: [],
  };

  // --- KILL SWITCH (madde 17) -------------------------------------------------------------------
  // '0' iken cron ÇALIŞIR ama hiçbir kaynağa gidilmez ve hiçbir şey yayınlanmaz. Kaynaklara hiç
  // dokunmamak bilinçli: kapalı bir sistemin dış sitelere istek atmaya devam etmesi hem gereksiz
  // hem de yayıncılar açısından açıklanamaz olurdu.
  const settings = await getSiteSettings(env);
  if (settings.gundem_automation_enabled !== '1') {
    console.log(JSON.stringify({ event: 'gundem_run', disabled: true, reason: 'kill_switch_off' }));
    return { ...stats, disabled: true };
  }

  if (!isGundemAiAvailable(env)) {
    console.warn(JSON.stringify({ event: 'gundem_run', disabled: true, reason: 'ai_binding_missing' }));
    return { ...stats, disabled: true };
  }

  // --- GÜNLÜK YAYIN TAVANI ----------------------------------------------------------------------
  const dayStart = startedAt - DAY_MS;
  const dayRow = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM gundem_items WHERE published_at >= ?'
  ).bind(dayStart).first();
  const publishedToday = (dayRow && dayRow.c) || 0;
  let budget = Math.min(
    options.maxItemsPerRun ?? GUNDEM_LIMITS.maxItemsPerRun,
    Math.max(0, (options.maxPublishPerDay ?? GUNDEM_LIMITS.maxPublishPerDay) - publishedToday)
  );
  if (budget <= 0) {
    console.log(JSON.stringify({ event: 'gundem_run', skipped: 'daily_cap_reached', publishedToday }));
    return { ...stats, dailyCapReached: true };
  }

  // --- KAYNAK SEÇİMİ ----------------------------------------------------------------------------
  const health = await loadSourceHealth(env);
  const now = Date.now();
  // ignoreSourceSchedule: yalnızca geri doldurma betiği için — kaynak başına bekleme penceresini
  // atlar. Cron turu bunu ASLA geçmez (aksi halde yayıncılara her turda gidilirdi).
  const due = options.ignoreSourceSchedule
    ? activeGundemSources()
    : activeGundemSources().filter(s => isSourceDue(s, health.get(s.id), now));
  if (!due.length) {
    console.log(JSON.stringify({ event: 'gundem_run', skipped: 'no_source_due' }));
    return stats;
  }

  // --- FEED'LERİ ÇEK (sınırlı eşzamanlılık) ------------------------------------------------------
  const feeds = [];
  for (let i = 0; i < due.length; i += GUNDEM_LIMITS.sourceConcurrency) {
    if (Date.now() - startedAt > runBudgetMs) break;
    const batch = due.slice(i, i + GUNDEM_LIMITS.sourceConcurrency);
    const settled = await Promise.all(batch.map(async source => {
      stats.sourcesTried += 1;
      try {
        const candidates = await collectCandidates(source, now, options);
        await recordSourceResult(env, source.id, true);
        stats.sourcesOk += 1;
        stats.fetched += candidates.length;
        return candidates;
      } catch (err) {
        const message = (err && err.message) || String(err);
        stats.sourcesFailed += 1;
        stats.errors.push(`${source.id}:${message}`);
        await recordSourceResult(env, source.id, false, message);
        return [];
      }
    }));
    settled.forEach(list => feeds.push(list));
  }

  // Kaynaklar arası ADİL dağıtım: her turda tek bir kaynağın bütçenin tamamını yemesini önlemek
  // için kaynaklar sırayla dolaşılır (round-robin), her turda birer aday alınır.
  const queues = feeds.filter(list => list.length);
  const ordered = [];
  for (let round = 0; queues.some(q => q.length); round++) {
    for (const q of queues) {
      const next = q.shift();
      if (next) ordered.push(next);
    }
  }
  stats.candidates = ordered.length;
  if (!ordered.length) {
    logRun(stats, startedAt);
    return stats;
  }

  // --- MÜKERRER KONTROLÜ (AI'den ÖNCE, TEK sorgu grubu) ------------------------------------------
  const existing = await loadExistingKeys(env, ordered);
  const seenInRun = { urls: new Set(), hashes: new Set(), titles: new Set() };

  const ctx = {
    existing, seenInRun, stats, abort: null,
    getEntityIndex: lazyEntityIndex(env, deps),
  };

  const perSourcePublished = new Map();
  for (const candidate of ordered) {
    if (budget <= 0 || ctx.abort) break;
    if (Date.now() - startedAt > runBudgetMs) {
      stats.skipped.run_budget_exhausted = (stats.skipped.run_budget_exhausted || 0) + 1;
      break;
    }
    const perSourceCap = options.maxItemsPerSource ?? GUNDEM_LIMITS.maxItemsPerSource;
    const sourceCap = Math.min(candidate.source.maxItemsPerRun || perSourceCap, perSourceCap);
    if ((perSourcePublished.get(candidate.source.id) || 0) >= sourceCap) continue;

    const dupReason = isDuplicate(candidate, existing, seenInRun);
    if (dupReason) {
      stats.duplicate += 1;
      stats.duplicateBy[dupReason] = (stats.duplicateBy[dupReason] || 0) + 1;
      continue;
    }

    let published = null;
    try {
      published = await publishCandidate(env, candidate, ctx);
    } catch (err) {
      const message = (err && err.message) || String(err);
      stats.errors.push(`${candidate.source.id}:publish:${message}`);
      stats.skipped.publish_failed = (stats.skipped.publish_failed || 0) + 1;
    }
    if (published) {
      budget -= 1;
      perSourcePublished.set(candidate.source.id, (perSourcePublished.get(candidate.source.id) || 0) + 1);
    }
  }

  if (ctx.abort) stats.abort = ctx.abort;

  // --- CACHE PURGE / REVALIDATION ---------------------------------------------------------------
  // Yalnızca gerçekten içerik yayınlandıysa — boş bir turun edge önbelleğini gereksiz yere
  // düşürmesine gerek yok.
  if (stats.published > 0) {
    await purgeGundemCache(env);
  }

  logRun(stats, startedAt);
  return stats;
}

// Cron logu (madde 18'deki alanlar). Tek satır JSON — `wrangler tail`de filtrelenebilir olsun diye
// (bkz. src/lib/logger.js'teki aynı yaklaşım) ayrıca insan okunur bir özet satırı da basılır.
function logRun(stats, startedAt) {
  const payload = {
    event: 'gundem_run',
    sources: stats.sourcesTried,
    sourcesOk: stats.sourcesOk,
    sourcesFailed: stats.sourcesFailed,
    fetched: stats.fetched,
    new: stats.candidates,
    duplicate: stats.duplicate,
    duplicateBy: stats.duplicateBy,
    published: stats.published,
    qualityFailed: stats.qualityFailed,
    skipped: stats.skipped,
    aiCalls: stats.aiCalls,
    entitiesLinked: stats.entitiesLinked,
    errors: stats.errors.slice(0, 5),
    ms: Date.now() - startedAt,
  };
  console.log(JSON.stringify(payload));
  console.log(
    `[GUNDEM] sources=${stats.sourcesTried} fetched=${stats.fetched} new=${stats.candidates} ` +
    `duplicate=${stats.duplicate} published=${stats.published} skipped=${stats.qualityFailed} ` +
    `ai=${stats.aiCalls} errors=${stats.sourcesFailed}`
  );
}
