// /fotograf sayfasının (kullanıcı isteği, 2026-09-17) veri uçları:
//   GET /api/photos                      — havuzu mekan filtresine göre süzer ve sayfalar
//   GET /api/photos/stats                — etiketleme/ipucu kapsamı + mekan başına sonuç sayıları
//
// Havuz src/lib/photoPool.js#fetchPhotoPool'dan gelir (KV-önbellekli). Bu uç süzer, sıralar,
// sayfalar ve sayfa başına proje künyesini görsele birleştirir (expand).
//
// ============================================================================================
// MEKAN FİLTRESİ — ÜÇ SİNYAL, TEK SIRALAMA (2026-09-18 beşinci tur, kullanıcı isteği: "arama
// filtreleri için en doğru ve en çok sonuç için gereken en iyi sistemi kur")
// ============================================================================================
// Sinyaller (bkz. photoPool.js dosya başı): vision-LLM etiketi, CLIP sıfır-atış ipucu ve proje
// künyesi (ön bilgi). KADEMELER ÖLÇÜLEN İSABET SIRASINDADIR — havuzdan rastgele 700 görsel
// LLM'e sorulup CLIP'le çaprazlandı, uyuşmazlık hücreleri gözle hakemlendi
// (scripts/photo-space-sample.json ile `--eval`, 2026-09-18):
//
//   LLM birincil etiket + CLIP aynı mekanı destekliyor (p>=0.25) ..... %90+   (700'de 110)
//   CLIP güçlü, LLM henüz bakmadı ..................................... ~%90   (eşikler gözle)
//   LLM ikincil etiket + CLIP destekliyor ............................. ~%78   (18)
//   CLIP orta + KÜNYE (yalnızca "Çalışma Odası", LLM bakmadı) .......... ~%78
//   LLM birincil, CLIP zayıf destek (0.10<=p<0.25) ya da ipucu yok .... ~%65   (135'in yarısı)
//   LLM birincil, CLIP karşı (p<0.10) / CLIP güçlü, LLM başka dedi ..... ~%45-50 (en sona)
//   LLM ikincil, CLIP desteklemiyor ................................... ~%35   -> HİÇ GÖSTERİLMEZ
//
// Yani "hüküm tek modelin" DEĞİL: iki model HEMFİKİRSE isabet çok yüksek, tek model tek başına
// konuşuyorsa düşüyor. Sıralama bunu doğrudan yansıtır; her kademe kendi içinde YÜKLEME SIRASINI
// SIRASI tohumla karıştırılır (dokuzuncu tur — bkz. seededShuffle; yalnızca daha az kesin eşleşmeler
// kümenin sonuna iner). Etiketleme ilerledikçe "LLM bakmadı" kademeleri kendiliğinden erir.
//
// KÜNYE TEK BAŞINA SONUÇ ÜRETMEZ (2026-09-18 üçüncü turda kaldırılan ikincil sonuç GERİ GELMEDİ):
// ölçüm photoSpaceClip.js dosya başında — bir proje seviyesi sinyal görsel seçemiyor.
// Çizimler havuza hiç girmez (photoPool.js), dolayısıyla hiçbir sonuçta çıkmaz.
import { json, errorJson } from '../lib/http.js';
import { cachedPublicJson } from '../lib/publicCache.js';
import { fetchPhotoPool } from '../lib/photoPool.js';
import { PHOTO_SPACE_OPTIONS } from '../lib/photoSpaceClassify.js';
import { clipProbOf, clipVerdict, CLIP_AGREE_MIN, CLIP_WEAK_MIN } from '../lib/photoSpaceClip.js';
import { readLastRun as readPhotoSpaceCronRun } from '../lib/photoSpaceCron.js';

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 120;
// İkincil (listenin ilki olmayan) LLM etiketinin sayılması için en düşük güven.
export const SECONDARY_MIN = 0.55;
export const TIER_COUNT = 6;

// Bir görselin bir mekana eşleşme kademesi (dosya başındaki tablo). project: havuzdaki künye kaydı.
export function spaceTier(item, space, project) {
  const spaces = item && item.spaces;
  const hint = item && item.clip;
  const p = clipProbOf(hint, space);
  if (Array.isArray(spaces)) {
    const hit = spaces.find(s => s.label === space);
    if (hit && hit.primary) {
      if (p >= CLIP_AGREE_MIN) return 1;                 // çifte onay
      if (!hint || p >= CLIP_WEAK_MIN) return 5;         // ikinci görüş yok / zayıf destek
      return 6;                                          // CLIP karşı
    }
    if (hit) {
      // İkincil etiket: yalnızca CLIP de destekliyorsa (desteklemeyen ikincil %35 — gösterilmez).
      return hit.confidence == null || hit.confidence >= SECONDARY_MIN ? (p >= CLIP_AGREE_MIN ? 3 : 0) : 0;
    }
    // LLM baktı, bu mekanı saymadı; CLIP yine de güçlü diyorsa en sona.
    return clipVerdict(hint, space, false) === 'strong' ? 6 : 0;
  }
  const kunyeHas = !!(project && Array.isArray(project.kunye) && project.kunye.includes(space));
  const verdict = clipVerdict(hint, space, kunyeHas);
  if (verdict === 'strong') return 2;
  if (verdict === 'kunye') return 4;
  return 0;
}

// RASTGELE SIRA (kullanıcı isteği, 2026-09-18 dokuzuncu tur: "Fotoğraf sayfasına her girdiğimizde
// farklı bir sıralamada karşılaşalım, en son yüklenen projenin fotoğrafları ilk sıraya gelsin
// kuralını kaldır."). Sayfa her açılışta bir TOHUM (`seed`) üretir ve TÜM isteklerinde (sayfalama
// dahil) aynı tohumu gönderir: sıra bir ziyarette SABİT kalır ("Daha Fazla Göster" aynı karıştırmanın
// devamını getirir — tekrar/atlama olmaz), yeni ziyarette değişir. Karıştırma tohumlu ve
// deterministiktir, bu yüzden yanıt önbelleği de doğru kalır; tohum 0..SEED_SPACE-1 aralığına
// kısılır ki önbellek anahtarı sayısı sınırlı olsun. Mekan filtresinde isabet KADEMELERİ korunur,
// karıştırma her kademenin KENDİ İÇİNDE yapılır (kesin eşleşmeler yine önde). Tohumsuz istek
// (smoke-test, eski istemci) havuz sırasını döndürür.
export const SEED_SPACE = 1000;
export function parseSeed(raw) {
  if (raw == null || raw === '') return null;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 0 ? n % SEED_SPACE : null;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function seededShuffle(arr, seed) {
  const out = arr.slice();
  if (seed == null) return out;
  const rnd = mulberry32(0x9E3779B1 ^ (seed + 1));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
  }
  return out;
}

export function selectPhotos(pool, space, seed = null) {
  if (!space || !PHOTO_SPACE_OPTIONS.includes(space)) return seededShuffle(pool.items, seed);
  const tiers = Array.from({ length: TIER_COUNT }, () => []);
  for (const it of pool.items) {
    const t = spaceTier(it, space, pool.projects && pool.projects[it.projectSlug]);
    if (t) tiers[t - 1].push(it);
  }
  return [].concat(...tiers.map(t => seededShuffle(t, seed)));
}

// Lightbox çipleri: LLM baktıysa onun ARANABİLİR etiketleri; bakmadıysa CLIP'in GÜÇLÜ dediği mekan
// (çeldirici/çizim etiketi hiçbir zaman çip olmaz).
function displaySpaces(it, project) {
  if (Array.isArray(it.spaces)) return it.spaces.map(s => s.label).filter(l => PHOTO_SPACE_OPTIONS.includes(l));
  const top = it.clip && it.clip.t;
  return top && PHOTO_SPACE_OPTIONS.includes(top) && spaceTier(it, top, project) === 2 ? [top] : [];
}

function expand(pool, it) {
  const p = pool.projects[it.projectSlug] || {};
  return {
    url: it.url,
    projectSlug: it.projectSlug,
    projectTitle: p.title || '',
    projectLocation: p.location || null,
    projectDate: p.date || null,
    discipline: p.discipline || [], category: p.category || [], type: p.type || [], awards: p.awards || [],
    architects: p.architects || [], offices: p.offices || [],
    credit: p.credit || null,
    creditType: p.creditType || null,
    // gallery.js#paintCredit ile AYNI düşüş: görsel başına etiket yoksa projenin künyesi.
    photographer: it.photographer || p.photoCredit || null,
    spaces: displaySpaces(it, p),
  };
}

// Kapsam raporu — etiketleme turunun ilerleyişini ve filtrelerin doluluğunu İZLEMEK için
// (scripts/smoke-test.sh de okur). Hiçbir kişisel/özel veri taşımaz: sayılardan ibarettir.
function poolStats(pool) {
  const perSpace = {};
  for (const space of PHOTO_SPACE_OPTIONS) {
    const byTier = new Array(TIER_COUNT).fill(0);
    for (const it of pool.items) {
      const t = spaceTier(it, space, pool.projects && pool.projects[it.projectSlug]);
      if (t) byTier[t - 1]++;
    }
    perSpace[space] = { total: byTier.reduce((a, b) => a + b, 0), byTier };
  }
  return { ...(pool.stats || {}), spaces: perSpace };
}

export async function handlePhotosRoute(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorJson('Bulunamadı', 404);
  if (url.pathname === '/api/photos/stats') {
    // `cron`: Worker cron'unun son turu (src/lib/photoSpaceCron.js) — yeni yüklemelerin etiketlenip
    // etiketlenmediği buradan izlenir (smoke-test 13c okur).
    return cachedPublicJson(request, env, url.pathname, async () => {
      const [pool, cron] = await Promise.all([fetchPhotoPool(env), readPhotoSpaceCronRun(env)]);
      return { ...poolStats(pool), cron };
    });
  }
  // Önbellek anahtarı NORMALİZE parametrelerden kurulur (ham tohum 0..999'a kısılır).
  const space = (url.searchParams.get('space') || '').trim();
  const seed = parseSeed(url.searchParams.get('seed'));
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT));
  const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0));
  const cacheKey = `${url.pathname}?space=${encodeURIComponent(space)}&seed=${seed == null ? '' : seed}&limit=${limit}&offset=${offset}`;
  return cachedPublicJson(request, env, cacheKey, async () => {
    const pool = await fetchPhotoPool(env);
    const selected = selectPhotos(pool, space, seed);
    const items = selected.slice(offset, offset + limit).map(it => expand(pool, it));
    return { items, total: selected.length, hasMore: offset + limit < selected.length, spaces: PHOTO_SPACE_OPTIONS };
  });
}

// SERBEST METİN ARAMASI KALDIRILDI (2026-09-19): /api/photos/space-for-query her aramada Workers AI
// metin modelini çağırıyordu — ücret doğurabilecek bir yol (CLAUDE.md "ÜCRETLİ KAYNAK KURALI").
// Arama kutusu artık yazılamaz; kullanıcı yalnızca PHOTO_SPACE_OPTIONS listesinden seçer. Uç geri
// gelmemeli; preflight bunu arıyor (scripts/test-2026-09-17-comments-identity-and-photo-page.mjs).
