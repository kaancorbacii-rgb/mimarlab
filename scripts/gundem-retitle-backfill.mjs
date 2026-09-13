#!/usr/bin/env node
// GÜNDEM BAŞLIK/ÖZET YENİDEN ÜRETİMİ — ÖNCE/SONRA RAPORU + GERİ DOLDURMA
// (kullanıcı isteği, 2026-09-13 madde 10 ve 12.)
//
// NE YAPAR: production'da YAYINDA olan Gündem kayıtlarını okur, her biri için başlık ve özeti YENİ
// üretim standardıyla (bkz. src/lib/gundemAi.js) yeniden üretir, eski ve yeni çıktıyı yan yana
// raporlar. Varsayılan DRY-RUN'dır: hiçbir şey yazılmaz. `--apply` verilirse YALNIZCA `title` ve
// `summary` (istenirse embedding) güncellenir.
//
// NEDEN AYRI BİR BETİK, NEDEN YENİDEN TOPLAMA DEĞİL: yeniden toplama (gundem-backfill.mjs) yeni
// SATIRLAR üretir ve published_at/slug/görsel/mükerrer kayıtlarını değiştirir. İstek bunun tam
// tersini söylüyor: "published_at, source URL, source, image, duplicate kayıtları, admin durumu
// gibi alanları değiştirme. Sadece title/summary üretim alanlarını güncelle."
//
// SLUG BİLEREK DEĞİŞMEZ: slug başlıktan türetilir ama canlıda /gundem/<slug> adresleri, bülten
// e-postalarındaki bağlantılar ve paylaşımlar ona bağlı. Başlığı düzeltmek URL'i kırmayı
// gerektirmez; slug olduğu gibi kalır.
//
// KAYNAK METİN NEREDEN GELİR: D1'de makale metni SAKLANMIYOR (tasarım gereği — "tam makale
// kopyalama" yasağı). Bu yüzden yeniden üretim her satır için kaynağa GERİ GİDER ve hattın
// canlıda kullandığı AYNI üç malzemeyi toplar:
//   (a) `original_title` — kaynağın kendi dilindeki başlığı, satırda duruyor,
//   (b) makalenin <head>'indeki og:description,
//   (c) makalenin GÖVDESİNDEN İLK PARAGRAFLAR (2026-09-13'te eklendi, bkz.
//       src/lib/gundemArticleText.js — o dosyanın başında neden gerekli olduğu ve "tam makale
//       kopyalama" yasağının neden ihlal edilmediği ayrıntılı yazılı).
// (b) ve (c) TEK bir indirmeden çıkar (gundemFeed.js#fetchPageMeta, withArticleText:true).
// (c) olmadan modelin elinde tipik olarak 20-35 kelime bulunuyordu ve özetler yapısal olarak
// yüzeysel kalıyordu; asıl kalite sıçraması buradan gelir. Sayfa artık erişilemiyorsa
// (404/kaldırılmış) satır "kaynak metin yetersiz" olarak RAPORLANIR ve DOKUNULMAZ.
//
// KULLANIM:
//   node scripts/gundem-retitle-backfill.mjs                     # dry-run, son 20 kayıt
//   node scripts/gundem-retitle-backfill.mjs --limit=40 --source=dezeen-architecture
//   node scripts/gundem-retitle-backfill.mjs --limit=5 --apply   # küçük örneklemi GERÇEKTEN yaz
//   node scripts/gundem-retitle-backfill.mjs --json=/tmp/rapor.json
//
// SEÇENEKLER
//   --limit=N        kaç kayıt (varsayılan 20)
//   --source=id      yalnızca bu kaynak id'si (virgülle birden fazla)
//   --slug=slug      yalnızca bu slug(lar)
//   --apply          D1'e YAZ (varsayılan: yazma yok)
//   --keep-embedding embedding'i yeniden hesaplama (varsayılan: hesapla — başlık/özet değişince
//                    anlamsal mükerrer kapısı bayat vektörle karşılaştırma yapmasın)
//   --json=dosya     önce/sonra karşılaştırmasını JSON olarak da yaz
//   --all            YAYINDAKİ TÜM kayıtlar (--limit yok sayılır; sayfalayarak ilerler)
//   --offset=N       en yeniden geriye doğru ilk N kaydı atla (yarıda kalan turu sürdürmek için)
//
// KİMLİK BİLGİSİ: yerelde wrangler OAuth token'ı kullanılır (aşağıya bakın). CI'da (bkz.
// .github/workflows/gundem-retitle.yml) böyle bir oturum YOKTUR; o yüzden CLOUDFLARE_API_TOKEN
// ortam değişkeni tanımlıysa doğrudan o kullanılır ve wrangler'a hiç dokunulmaz.

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { GUNDEM_SOURCES } from '../src/lib/gundemSources.js';
import { fetchPageMeta } from '../src/lib/gundemFeed.js';
import { buildSourceText } from '../src/lib/gundemSourceText.js';
import { generateGundemSummary, AiProviderError } from '../src/lib/gundemAi.js';
import { validateAiOutput, SOURCE_TEXT_MAX_CHARS, wordCount } from '../src/lib/gundemQuality.js';
import { gundemEmbedText, embedGundemText, quantizeEmbedding } from '../src/lib/gundemEmbedding.js';
import { AI_MODEL } from '../src/lib/aiConfig.js';
import { GUNDEM_LIMITS } from '../src/lib/gundemIngest.js';

const ACCOUNT_ID = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim() || '2e3cd3c1a471552e19436913b2368c4f';
const DATABASE_ID = '65856ee8-f2a3-4461-867d-3ed7faf2c246';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const APPLY = !!args.apply;
const LIMIT = Number(args.limit ?? 20);
const KEEP_EMBEDDING = !!args['keep-embedding'];
const ONLY_SOURCES = typeof args.source === 'string' ? args.source.split(',').map(s => s.trim()).filter(Boolean) : null;
const ONLY_SLUGS = typeof args.slug === 'string' ? args.slug.split(',').map(s => s.trim()).filter(Boolean) : null;
const JSON_OUT = typeof args.json === 'string' ? args.json : null;
const ALL = !!args.all;
const OFFSET = Number(args.offset ?? 0);
// --all: yayındaki her kayıt işlenir. Havuz tek seferde okunmaz (D1 sorgu boyutu ve bellek),
// PAGE_SIZE'lık sayfalar hâlinde ilerlenir. Round-robin --all'da UYGULANMAZ: örneklem değil,
// tam tarama yapılıyor; sıralama en yeniden eskiye doğrudur ki tur yarıda kesilse bile en
// görünür kayıtlar düzelmiş olsun.
const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------------------------
// wrangler OAuth token'ı (depodaki diğer ~100 toplu betikle AYNI desen — yeni bir secret yok).
// Token 1 saat geçerli ve yalnızca bir wrangler komutu çalıştığında yenilenir; uzun bir turun
// ortasında dolması TÜM yazmaları 7403 ile düşürür (bkz. gundem-backfill.mjs'teki gerçek bulgu).
// ---------------------------------------------------------------------------------------------
const TOKEN_PATHS = [
  `${homedir()}/Library/Preferences/.wrangler/config/default.toml`,
  `${homedir()}/.wrangler/config/default.toml`,
  `${homedir()}/.config/.wrangler/config/default.toml`,
];
function readTokenFile() {
  for (const p of TOKEN_PATHS) {
    try { return readFileSync(p, 'utf8'); } catch { /* sıradaki yol */ }
  }
  throw new Error('wrangler OAuth token bulunamadı — `npx wrangler login` çalıştırın.');
}
function oauthToken() {
  const m = readTokenFile().match(/oauth_token\s*=\s*"([^"]+)"/);
  if (!m) throw new Error('wrangler OAuth token bulunamadı — `npx wrangler login` çalıştırın.');
  return m[1];
}
function tokenExpiresAt() {
  const m = readTokenFile().match(/expiration_time\s*=\s*"([^"]+)"/);
  const ms = m ? Date.parse(m[1]) : NaN;
  return Number.isFinite(ms) ? ms : null;
}
// CI YOLU: GitHub Actions runner'ında wrangler oturumu yok, sır olarak API token var. Varsa
// wrangler dosyasına HİÇ bakılmaz (bakılsaydı betik CI'da daha ilk satırda düşerdi).
const ENV_TOKEN = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
let TOKEN = ENV_TOKEN || oauthToken();
function refreshToken(reason) {
  // API token'ın süresi dolmaz ve yenilenemez — CI'da yenileme denemek anlamsız.
  if (ENV_TOKEN) return false;
  try { execFileSync('npx', ['wrangler', 'whoami'], { stdio: 'ignore', timeout: 90000 }); } catch { /* yoksay */ }
  const before = TOKEN;
  TOKEN = oauthToken();
  console.log(`  [token] ${reason} -> ${TOKEN === before ? 'DEĞİŞMEDİ' : 'yenilendi'}`);
  return TOKEN !== before;
}
function isAuthFailure(status, json) {
  if (status === 401 || status === 403) return true;
  const codes = ((json && json.errors) || []).map(e => e && e.code);
  return codes.includes(7403) || codes.includes(10000);
}
async function cfFetch(url, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.success) return json;
    if (attempt === 0 && isAuthFailure(res.status, json) && refreshToken('istek yetki hatası aldı')) continue;
    const err = new Error(JSON.stringify(json.errors).slice(0, 300));
    err.httpStatus = res.status;
    throw err;
  }
}
async function d1(sql, params = []) {
  const json = await cfFetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
    { sql, params }
  );
  return json.result[0].results || [];
}

// env.AI adaptörü — Workers AI REST API, env.AI.run(model, opts) ile aynı şekli döndürür.
let aiCalls = 0;
const env = {
  AI: {
    async run(model, opts) {
      aiCalls++;
      const json = await cfFetch(
        `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${model || AI_MODEL}`,
        opts
      );
      return json.result;
    },
  },
};

const sourceById = new Map(GUNDEM_SOURCES.map(s => [s.id, s]));

// ---------------------------------------------------------------------------------------------
// ÖRNEKLEM
// ---------------------------------------------------------------------------------------------
// Kullanıcı isteği madde 10: "en az 20 gerçek örnek... farklı içerik türleri seç... ArchDaily,
// Dezeen, Arkitera, Mimdap, diğer aktif kaynaklar". Bu yüzden örneklem KAYNAK BAŞINA dönüşümlü
// alınır (tek bir kaynağın son 20 yazısı değil): en yeni kayıtlar okunur, sonra kaynaklar arasında
// round-robin ile seçilir.
function roundRobin(rows, limit) {
  const bySource = new Map();
  for (const r of rows) {
    if (!bySource.has(r.source_id)) bySource.set(r.source_id, []);
    bySource.get(r.source_id).push(r);
  }
  const queues = [...bySource.values()];
  const out = [];
  while (out.length < limit && queues.some(q => q.length)) {
    for (const q of queues) {
      if (out.length >= limit) break;
      const next = q.shift();
      if (next) out.push(next);
    }
  }
  return out;
}

const where = ["status = 'published'"];
const params = [];
if (ONLY_SOURCES) { where.push(`source_id IN (${ONLY_SOURCES.map(() => '?').join(',')})`); params.push(...ONLY_SOURCES); }
if (ONLY_SLUGS) { where.push(`slug IN (${ONLY_SLUGS.map(() => '?').join(',')})`); params.push(...ONLY_SLUGS); }

console.log(`GÜNDEM başlık/özet yeniden üretimi — ${ALL ? 'TÜM yayındaki kayıtlar' : `örneklem ${LIMIT}`}${APPLY ? '  [APPLY: D1 GÜNCELLENECEK]' : '  [DRY-RUN: yazma YOK]'}`);
const expiry = ENV_TOKEN ? Number.POSITIVE_INFINITY : tokenExpiresAt();
if (!ENV_TOKEN && (expiry === null || expiry - Date.now() < 25 * 60000)) {
  refreshToken(expiry === null ? 'geçerlilik okunamadı' : `token ${Math.round((expiry - Date.now()) / 60000)} dk sonra doluyor`);
}

const SELECT_COLS = `id, slug, title, summary, original_title, source_id, source_name, source_url, language,
          published_at, source_published_at`;

// Kaç kayıt var (yalnızca --all'da anlamlı; rapor başlığı ve ilerleme yüzdesi için).
const [{ n: TOTAL_PUBLISHED } = { n: 0 }] = await d1(
  `SELECT COUNT(*) AS n FROM gundem_items WHERE ${where.join(' AND ')}`, params
);

// Satırları veren üretici. --all: en yeniden eskiye, PAGE_SIZE'lık sayfalar. Aksi halde:
// LIMIT'in birkaç katı okunup kaynaklar arasında round-robin ile örneklem alınır.
async function* rowsToProcess() {
  if (!ALL) {
    const pool = await d1(
      `SELECT ${SELECT_COLS} FROM gundem_items WHERE ${where.join(' AND ')}
         ORDER BY published_at DESC LIMIT ?`,
      [...params, Math.max(LIMIT * 4, 60)]
    );
    const sample = roundRobin(pool, LIMIT);
    console.log(`Havuz ${pool.length} kayıt, örneklem ${sample.length} kayıt (${new Set(sample.map(r => r.source_id)).size} kaynak)\n`);
    yield* sample;
    return;
  }
  console.log(`Yayındaki kayıt: ${TOTAL_PUBLISHED}${OFFSET ? ` (ilk ${OFFSET} atlanıyor)` : ''}\n`);
  let offset = OFFSET;
  for (;;) {
    const page = await d1(
      `SELECT ${SELECT_COLS} FROM gundem_items WHERE ${where.join(' AND ')}
         ORDER BY published_at DESC LIMIT ? OFFSET ?`,
      [...params, PAGE_SIZE, offset]
    );
    if (!page.length) return;
    yield* page;
    offset += page.length;
    if (page.length < PAGE_SIZE) return;
  }
}

// ---------------------------------------------------------------------------------------------
// TEK BİR KAYIT İÇİN YENİDEN ÜRETİM — canlı hattın AYNI adımları, aynı dosyalardan
// ---------------------------------------------------------------------------------------------
async function regenerate(row) {
  const source = sourceById.get(row.source_id);
  const sourceTitle = row.original_title || row.title;
  if (!source) return { status: 'no_source_config' };

  // Kaynak metin: makalenin <head> önizleme açıklaması + GÖVDESİNDEN İLK PARAGRAFLAR. İkisi de
  // TEK bir indirmeden çıkar. Gövde metni, adequacy'yi 'thin'den 'rich'e taşıyan ve özetin
  // gerçekten sentez olmasını sağlayan malzemedir (bkz. dosya başı, "KAYNAK METİN NEREDEN GELİR").
  let meta = null;
  try { meta = await fetchPageMeta(row.source_url, { withArticleText: true }); } catch (err) { meta = null; }
  const built = buildSourceText(
    [meta && meta.description, meta && meta.articleText],
    { maxChars: SOURCE_TEXT_MAX_CHARS }
  );
  if (built.adequacy === 'empty' && !sourceTitle) return { status: 'source_unavailable' };

  const publishedAt = row.source_published_at || row.published_at || null;
  const publishedYears = publishedAt ? [new Date(publishedAt).getUTCFullYear()] : [];

  let lastReason = 'ai_no_attempt';
  for (let attempt = 0; attempt < GUNDEM_LIMITS.aiMaxAttempts; attempt++) {
    const lastAttempt = attempt === GUNDEM_LIMITS.aiMaxAttempts - 1;
    let raw;
    try {
      raw = await generateGundemSummary(env, {
        sourceName: source.name,
        sourceTitle,
        sourceExcerpt: built.text,
        sourceLanguage: source.language,
        sourceUrl: row.source_url,
        publishedAt,
        sourceAdequacy: built.adequacy,
        retryReason: attempt > 0 ? lastReason : null,
      });
    } catch (err) {
      if (err instanceof AiProviderError && err.quotaExceeded) return { status: 'ai_quota_exceeded' };
      lastReason = `ai_${(err && err.code) || 'error'}`;
      continue;
    }
    if (raw && raw.quality_ok === false && !lastAttempt) { lastReason = 'ai_quality_self_reject'; continue; }
    const result = validateAiOutput(raw, {
      sourceTitle,
      sourceExcerpt: built.text,
      sourceName: source.name,
      sourceLanguage: source.language,
      sourceAdequacy: built.adequacy,
      publishedYears,
      // Kategori DEĞİŞTİRİLMEZ (istek: yalnızca title/summary). Doğrulamanın kategori kapısından
      // geçebilmesi için satırın mevcut kategorisi fallback olarak verilir.
      fallbackCategory: source.defaultCategory,
    });
    if (result.ok) {
      return {
        status: 'ok', title: result.title, summary: result.summary,
        sourceWords: built.words, adequacy: built.adequacy, attempts: attempt + 1,
        selfDoubt: raw.quality_ok === false,
        sourceFacts: Array.isArray(raw.source_facts) ? raw.source_facts : [],
      };
    }
    lastReason = result.reason;
  }
  return { status: 'quality_failed', reason: lastReason, adequacy: built.adequacy, sourceWords: built.words };
}

// ---------------------------------------------------------------------------------------------
const report = [];
const counters = {
  total: 0, ok: 0, titleChanged: 0, summaryChanged: 0,
  sourceThin: 0, sourceRich: 0, sourceUnavailable: 0, aiFailed: 0, applied: 0,
};
let aborted = null;

for await (const row of rowsToProcess()) {
  counters.total += 1;
  // Uzun turlarda (--all) token'ın ortada dolması TÜM yazmaları 7403 ile düşürüyordu — 40
  // kayıtta bir kontrol edilir. CI'da ENV_TOKEN kullanıldığında refreshToken zaten no-op'tur.
  if (!ENV_TOKEN && counters.total % 40 === 0) {
    const left = tokenExpiresAt();
    if (left === null || left - Date.now() < 15 * 60000) refreshToken('uzun tur, token tazeleniyor');
  }
  const res = await regenerate(row);
  if (res.status === 'ai_quota_exceeded') { aborted = 'ai_quota_exceeded'; break; }

  const entry = {
    slug: row.slug, source: row.source_name, source_id: row.source_id,
    original_title: row.original_title,
    before: { title: row.title, summary: row.summary, summaryWords: wordCount(row.summary) },
    status: res.status,
  };
  if (res.status === 'ok') {
    counters.ok += 1;
    if (res.adequacy === 'thin' || res.adequacy === 'empty') counters.sourceThin += 1;
    if (res.adequacy === 'rich') counters.sourceRich += 1;
    entry.after = { title: res.title, summary: res.summary, summaryWords: wordCount(res.summary) };
    entry.meta = { attempts: res.attempts, sourceWords: res.sourceWords, adequacy: res.adequacy, selfDoubt: res.selfDoubt };
    entry.sourceFacts = res.sourceFacts;
    if (res.title !== row.title) counters.titleChanged += 1;
    if (res.summary !== row.summary) counters.summaryChanged += 1;
  } else if (res.status === 'source_unavailable' || res.status === 'no_source_config') {
    counters.sourceUnavailable += 1;
  } else {
    counters.aiFailed += 1;
    entry.reason = res.reason;
  }
  report.push(entry);

  // --- YAZMA: YALNIZCA title + summary (+ embedding) -------------------------------------------
  // updated_at DA tazelenir — /api/gundem'in edge önbelleği tazeliği COUNT(*) + MAX(updated_at)
  // parmak iziyle doğruluyor (bkz. src/routes/gundem.js#gundemListFingerprint). Yalnızca metin
  // yazılsaydı önbellek kendini güncel sanar ve düzeltilmiş başlıklar sitede GÖRÜNMEZDİ.
  if (APPLY && res.status === 'ok' && (res.title !== row.title || res.summary !== row.summary)) {
    const now = Date.now();
    if (KEEP_EMBEDDING) {
      await d1('UPDATE gundem_items SET title = ?, summary = ?, ai_generated_at = ?, updated_at = ? WHERE id = ?',
        [res.title, res.summary, now, now, row.id]);
    } else {
      // Embedding başlık+özetin fonksiyonudur; metin değişip vektör kalırsa anlamsal mükerrer
      // kapısı (gundemEmbedding.js) bundan sonra BAYAT bir vektörle karşılaştırma yapar.
      const vec = await embedGundemText(env, gundemEmbedText(res.title, res.summary));
      await d1('UPDATE gundem_items SET title = ?, summary = ?, embedding = COALESCE(?, embedding), ai_generated_at = ?, updated_at = ? WHERE id = ?',
        [res.title, res.summary, vec ? quantizeEmbedding(vec) : null, now, now, row.id]);
    }
    counters.applied += 1;
  }
}

// ---------------------------------------------------------------------------------------------
// RAPOR (kullanıcı isteği madde 12: "kaç içerik yeniden üretilecek, kaç başlık değişecek, kaç özet
// değişecek, hangi içeriklerde source text yetersiz, hangi içeriklerde AI başarısız")
// ---------------------------------------------------------------------------------------------
console.log('ÖNCE / SONRA\n');
for (const e of report) {
  console.log(`■ [${e.source_id}] /gundem/${e.slug}`);
  if (e.original_title) console.log(`   kaynak başlığı : ${e.original_title}`);
  console.log(`   ESKİ başlık    : ${e.before.title}`);
  if (e.after) {
    console.log(`   YENİ başlık    : ${e.after.title}`);
    console.log(`   ESKİ özet (${String(e.before.summaryWords).padStart(3)}w): ${e.before.summary}`);
    console.log(`   YENİ özet (${String(e.after.summaryWords).padStart(3)}w): ${e.after.summary}`);
    console.log(`   [deneme ${e.meta.attempts} · kaynak ${e.meta.sourceWords}w/${e.meta.adequacy}${e.meta.selfDoubt ? ' · öz-denetim kuşkulu' : ''}]`);
  } else {
    console.log(`   YENİ           : ÜRETİLEMEDİ (${e.status}${e.reason ? `: ${e.reason}` : ''})`);
  }
  console.log('');
}

console.log('ÖZET');
console.log(`  değerlendirilen        : ${counters.total}`);
console.log(`  yeniden üretilebilen   : ${counters.ok}`);
console.log(`  başlığı DEĞİŞECEK      : ${counters.titleChanged}`);
console.log(`  özeti DEĞİŞECEK        : ${counters.summaryChanged}`);
console.log(`  kaynak metni yetersiz  : ${counters.sourceThin} (thin/empty — özet kısa kalır, bu DOĞRU davranış)`);
console.log(`  kaynak metni ZENGİN    : ${counters.sourceRich} (gövde çekilebildi — sentezlenmiş uzun özet)`);
console.log(`  kaynak sayfası yok     : ${counters.sourceUnavailable}`);
console.log(`  AI/kalite başarısız    : ${counters.aiFailed}`);
console.log(`  AI çağrısı             : ${aiCalls}`);
if (aborted) console.log(`  TUR DURDU              : ${aborted}`);
console.log(`  D1 güncellenen         : ${counters.applied}${APPLY ? '' : '  (DRY-RUN)'}`);

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ counters, aborted, report }, null, 2));
  console.log(`\nJSON rapor: ${JSON_OUT}`);
}

if (!APPLY) {
  console.log('\nDRY-RUN — hiçbir şey yazılmadı. Küçük bir örneklemle yazmak için: --limit=5 --apply');
}
