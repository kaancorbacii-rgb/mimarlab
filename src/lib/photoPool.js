// FOTOĞRAF sayfasının (bkz. /fotograf, src/routes/photos.js, kullanıcı isteği 2026-09-17) ham veri
// havuzu — projectPool.js#fetchActiveProjectPool İLE AYNI KV-önbellekli "havuz" deseni
// (getCachedPool, publicCache.js#POOL_CACHE_KINDS'e 'photos' olarak eklendi).
//
// ŞEKİL: { projects: { [slug]: künye }, items: [...], stats } — künye proje başına BİR kez tutulur
// (11.000+ görselde tekrarlansaydı KV'de şişerdi), uç sayfalama sonrası birleştirir
// (src/routes/photos.js#expand).
//
// SIRALAMA PROJE SEVİYESİNDEDİR: en son eklenen PROJENİN tüm görselleri önce (`created_at DESC,
// id DESC` — /proje'nin editoryal COALESCE(relisted_at, ...) zinciri BİLEREK değil: bu sayfa
// "yükleme sırası"nı soruyor). Bir projenin kendi görselleri images[] sırasındadır.
//
// ============================================================================================
// GÖRSEL BAŞINA ÜÇ BİLGİ (2026-09-18 beşinci tur — "en doğru ve en çok sonuç")
// ============================================================================================
//   items[].spaces — vision-LLM ETİKETİ (projects.image_spaces, bkz. photoSpaceClassify.js):
//       null = LLM bu görsele (v2 promptuyla) HİÇ BAKMADI; [] = baktı, aranabilir mekan yok;
//       [{label, confidence, primary}] = etiketler. YALNIZCA v2 girdileri sayılır: v1 promptunun
//       ürettiği düz diziler canlıda ölçülerek GÜVENİLMEZ bulundu (dış cephe karelerine "Resepsiyon"),
//       havuz onları "bakılmadı" sayar ve etiketleme betiği yeniden işler.
//   items[].clip   — CLIP sıfır-atış İPUCU (bkz. photoSpaceClip.js): görsel arama dizinindeki
//       embedding'den ANINDA hesaplanır; LLM'in bakmadığı görselde sonuç üretir, baktığında
//       sıralamada "çifte onay" olur. Dizinde embedding'i olmayan görselde alan yoktur.
//   projects[slug].kunye — projenin künyesinin andığı mekanlar (ön bilgi). TEK BAŞINA sonuç
//       ÜRETMEZ (ölçüldü: bir proje seviyesi sinyal görsel seçemiyor) — yalnızca CLIP kanıtıyla
//       birlikte ve yalnızca ölçümün desteklediği sınıflarda (photoSpaceClip.js#CLIP_KUNYE_MIN).
//
// ÇİZİMLER havuza HİÇ GİRMEZ ("arama sonuçlarında çizimler de çıkmasın", 2026-09-18): LLM çizim
// etiketi verdiyse YA DA LLM henüz bakmamışken CLIP çizim olasılığı >= CLIP_DRAWING_MIN ise (gözle
// ölçüm: 72/72). İkincisi sayesinde ~1.100 çizim, etiketleme turu bitmeden ANINDA sayfadan düşer.
// LLM bakıp "fotoğraf" dediyse CLIP'in çizim demesi görseli DÜŞÜRMEZ (hüküm LLM'indir).
//
// CLIP İPUÇLARI KALICI ÖNBELLEKLİDİR (KV `photo:cliphints:...`): bir görselin embedding'i değişmez,
// dolayısıyla ipucu da değişmez. Havuz her kurulduğunda (30 dk TTL + her içerik yazımı) 11 bin satırı
// yeniden puanlamak yerine yalnızca ÖNBELLEKTE OLMAYAN görseller puanlanır — kararlı hâlde bu,
// yeni yüklenen birkaç görseldir ve 14 MB'lık dizin ancak o zaman okunur. İlk kurulumda tur başına
// en fazla CLIP_SCORE_PER_BUILD görsel puanlanır (Worker CPU bütçesi) ve havuz 60 sn TTL ile
// yazılır; birkaç istek içinde tamamı dolar.
import { getCachedPool } from './publicCache.js';
import { reserveKvWrite } from './kvQuota.js';
import { foldTr } from './textMatch.js';
import { loadImageIndex } from './imageEmbedStore.js';
import {
  clipHintForRow, clipIsDrawing, canonicalImageKey, CLIP_PROMPT_SOURCE_SHA,
} from './photoSpaceClip.js';
import { SPACE_LABEL_VERSION } from './photoSpaceClassify.js';
import photoSpaceTaxonomyJs from '../../photo-space-taxonomy.js';

const { PHOTO_SPACE_LABELS, PHOTO_SPACE_DRAWING_LABELS, PHOTO_SPACE_TAXONOMY } = photoSpaceTaxonomyJs;
const DRAWING_SET = new Set(PHOTO_SPACE_DRAWING_LABELS);
const LABEL_SET = new Set(PHOTO_SPACE_LABELS);

export const CLIP_SCORE_PER_BUILD = 2500;
const CLIP_SCORE_WITHOUT_PERSIST = 300;
const CLIP_PENDING_TTL_SECONDS = 60;
// Dizinde embedding'i BULUNMAYAN görsel: her kurulumda 14 MB'lık dizini yeniden okutmasın diye
// "yok" olarak işaretlenir ve bu kadar saat sonra yeniden denenir (embedding sonradan gelebilir:
// tarayıcı kayıttan hemen sonra gönderir, zamanlanmış iş eksikleri tamamlar — bkz.
// .github/workflows/photo-space-classify.yml'deki CLIP adımı). 1 saat: kalıcı olarak eksik bir
// görsel için saatte bir 14 MB'lık KV okuması, yeni bir projenin ipucusuz kalmasından ucuzdur.
const CLIP_MISS_RETRY_HOURS = 1;
export function clipHintCacheKey() { return `photo:cliphints:v1:${CLIP_PROMPT_SOURCE_SHA}`; }

function parseJsonSafe(text, fallback) {
  if (!text) return fallback;
  try { const v = JSON.parse(text); return v == null ? fallback : v; } catch { return fallback; }
}
const strList = (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : []);

// D1'deki image_spaces girdisi -> [{label, confidence, primary}] | null.
// BİRİNCİLLİK ÇELDİRİCİLER ATILMADAN ÖNCE belirlenir: model ["Dış Cephe", "Bahçe"] dediyse Bahçe
// karenin ana konusu DEĞİLDİR — çeldirici düşürüldükten sonra "listenin ilki" sanılmamalı.
export function normalizeStoredSpaces(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null; // v1 (düz dizi) = bakılmadı
  if (Number(raw.v) !== SPACE_LABEL_VERSION || !Array.isArray(raw.spaces)) return null;
  const out = [];
  raw.spaces.forEach((s, idx) => {
    const label = s && typeof s.label === 'string' ? s.label : '';
    if (!LABEL_SET.has(label) || out.some(o => o.label === label)) return;
    const c = Number.isFinite(Number(s.confidence)) && s.confidence != null ? Number(s.confidence) : null;
    out.push({ label, confidence: c, primary: idx === 0 });
  });
  return out;
}

// KÜNYE ÖN BİLGİSİ — başlık + açıklama + tür/tip/grup içinde, KELİME BAŞINDA (Türkçe ekler serbest:
// "banyo" -> "banyolarında"; ama "hol" gibi kısa kökler photo-space-taxonomy.js#kunye'de bilerek
// yok). foldTr iki tarafı da aynı biçime indirir.
const KUNYE_RULES = PHOTO_SPACE_TAXONOMY.filter(t => t.kind !== 'drawing' && Array.isArray(t.kunye))
  .map(t => ({ label: t.label, words: t.kunye.map(k => foldTr(k)).filter(Boolean) }));
const WORD_CHAR = /[a-z0-9]/;
export function kunyeSpacesFor(text) {
  const hay = foldTr(text || '');
  if (!hay) return [];
  const out = [];
  for (const rule of KUNYE_RULES) {
    const hit = rule.words.some((w) => {
      let from = 0;
      for (;;) {
        const at = hay.indexOf(w, from);
        if (at < 0) return false;
        const startsWord = at === 0 || !WORD_CHAR.test(hay[at - 1]);
        // Üç harf ve altı kökler ("wc", "duş") TAM kelime olmalı: "duş" kelime başında
        // "düşünülmüş"ü ("dusunulmus") de yakalardı.
        const after = hay[at + w.length];
        const endsWord = w.length > 3 || after === undefined || !WORD_CHAR.test(after);
        if (startsWord && endsWord) return true;
        from = at + 1;
      }
    });
    if (hit) out.push(rule.label);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// CLIP ipuçlarını görsellere iliştirir (kalıcı KV önbelleği + sınırlı puanlama). Hiçbir hata havuzu
// düşürmez: KV/dizin okunamazsa görseller yalnızca ipucusuz kalır (LLM etiketi yine çalışır).
// ---------------------------------------------------------------------------------------------
async function attachClipHints(env, items) {
  const stats = { clip: 0, clipMissing: 0, clipPending: 0 };
  if (!env.FACET_CACHE || !items.length) return stats;
  let cache = {};
  try { cache = (await env.FACET_CACHE.get(clipHintCacheKey(), 'json')) || {}; } catch { cache = {}; }
  const nowH = Math.floor(Date.now() / 3600000);
  const keyOf = new Map();
  const need = [];
  for (const it of items) {
    const key = canonicalImageKey(it.url);
    keyOf.set(it, key);
    const hit = cache[key];
    if (hit && hit.t) continue;
    if (hit && hit.m != null && nowH - Number(hit.m) < CLIP_MISS_RETRY_HOURS) continue;
    need.push(it);
  }
  let dirty = false;
  // KV yazma kotası (bkz. kvQuota.js) doluysa ipuçları KALICILAŞTIRILAMAZ; o durumda havuzun kendisi
  // de KV'ye yazılamaz ve her istek havuzu yeniden kurar — tam bütçeyle puanlamak her isteği saniyelik
  // bir CPU işine çevirirdi. Yazma hakkı PUANLAMADAN ÖNCE ayrılır; alınamazsa bütçe küçülür.
  let canPersist = false;
  if (need.length) {
    try { canPersist = await reserveKvWrite(env); } catch { canPersist = false; }
    const budget = canPersist ? CLIP_SCORE_PER_BUILD : CLIP_SCORE_WITHOUT_PERSIST;
    let index = null;
    try { index = await loadImageIndex(env, 'project'); } catch { index = null; }
    if (index) {
      const rowByKey = new Map();
      for (const slug of new Set(need.map(it => it.projectSlug))) {
        const e = index.entityBySlug.get(slug);
        if (!e) continue;
        for (let i = 0; i < e.c; i++) rowByKey.set(canonicalImageKey(e.k[i]), e.offset + i);
      }
      let scored = 0;
      for (const it of need) {
        const key = keyOf.get(it);
        const row = rowByKey.get(key);
        if (row == null) { cache[key] = { m: nowH }; dirty = true; continue; }
        if (scored >= budget) { stats.clipPending++; continue; }
        cache[key] = clipHintForRow(index.rowOf(row));
        scored++;
        dirty = true;
      }
    }
  }
  if (dirty) {
    // Havuzda artık olmayan görsellerin girdileri atılır (önbellek sınırsız büyümesin).
    const live = new Set(keyOf.values());
    for (const k of Object.keys(cache)) if (!live.has(k)) delete cache[k];
    try {
      if (canPersist) await env.FACET_CACHE.put(clipHintCacheKey(), JSON.stringify(cache));
    } catch (err) { console.error('photoPool: CLIP ipucu önbelleği yazılamadı', err && err.message); }
  }
  for (const it of items) {
    const hit = cache[keyOf.get(it)];
    if (hit && hit.t) { it.clip = hit; stats.clip++; } else if (hit && hit.m != null) stats.clipMissing++;
  }
  return stats;
}

async function fetchPhotoPoolRaw(env) {
  // BLURLU (önizleme) PROJELER GÖSTERİLMEZ (kullanıcı isteği, 2026-09-17 madde 10).
  const [{ results: projects }, { results: designerRows }, { results: founderRows }] = await Promise.all([
    env.DB.prepare(
      `SELECT id, slug, title, description, location, project_date, discipline, category, type, awards,
              images, image_spaces, image_credits, photo_credit_text, designer_names_raw, office_names_raw
       FROM projects
       WHERE deleted_at IS NULL AND hidden_at IS NULL
       ORDER BY created_at DESC, id DESC`
    ).all(),
    // Künye bağları — proje pop-up'ının fetchDesignerDetails'i ile AYNI görünürlük (önizlemedeki
    // profil de adıyla görünür; yalnızca silinmiş ya da tam arşivdeki profil düşer).
    env.DB.prepare(
      `SELECT pd.project_id, ofc.name AS office_name, ar.name AS architect_name
       FROM project_designers pd
       LEFT JOIN offices ofc ON ofc.id = pd.office_id AND ofc.deleted_at IS NULL AND (ofc.hidden_at IS NULL OR ofc.preview_at IS NOT NULL)
       LEFT JOIN architects ar ON ar.id = pd.architect_id AND ar.deleted_at IS NULL AND (ar.hidden_at IS NULL OR ar.preview_at IS NOT NULL)
       ORDER BY pd.rowid ASC`
    ).all(),
    // "Mimar:" satırı için firma KURUCULARI — src/routes/project.js#fetchFoundersForOffices ile
    // AYNI kural (kullanıcı isteği, 2026-09-18: "Künye kısmında mimar bilgisi de olsun"): mimarı
    // girilmemiş, yalnızca firması tanımlı projede pop-up firmanın kurucularını Mimar olarak
    // gösterir; lightbox da aynısını yapmalı ki iki künye ayrışmasın.
    env.DB.prepare(
      `SELECT o.name AS office_name, ar.name AS architect_name FROM office_founders f
       JOIN offices o ON o.id = f.office_id AND o.deleted_at IS NULL AND (o.hidden_at IS NULL OR o.preview_at IS NOT NULL)
       JOIN architects ar ON ar.id = f.architect_id AND ar.deleted_at IS NULL AND (ar.hidden_at IS NULL OR ar.preview_at IS NOT NULL)
       ORDER BY f.rowid ASC`
    ).all(),
  ]);

  const officesByProject = new Map();
  const architectsByProject = new Map();
  for (const r of designerRows || []) {
    if (r.office_name) { if (!officesByProject.has(r.project_id)) officesByProject.set(r.project_id, []); officesByProject.get(r.project_id).push(r.office_name); }
    if (r.architect_name) { if (!architectsByProject.has(r.project_id)) architectsByProject.set(r.project_id, []); architectsByProject.get(r.project_id).push(r.architect_name); }
  }
  const foundersByOffice = new Map();
  for (const r of founderRows || []) {
    const k = foldTr(r.office_name);
    if (!foundersByOffice.has(k)) foundersByOffice.set(k, []);
    foundersByOffice.get(k).push(r.architect_name);
  }
  const uniq = (arr) => { const seen = new Set(); return arr.filter(v => { const k = foldTr(v); if (seen.has(k)) return false; seen.add(k); return true; }); };

  const projectsOut = {};
  const candidates = [];
  for (const row of projects || []) {
    const images = parseJsonSafe(row.images, []);
    if (!Array.isArray(images) || !images.length) continue;
    const spacesByUrl = parseJsonSafe(row.image_spaces, {});
    const creditsByUrl = parseJsonSafe(row.image_credits, {});
    // Bağ (project_designers) + künyeye yazıldığı hâliyle ham adlar (bkz. migrations/0120).
    const offices = uniq([...(officesByProject.get(row.id) || []), ...strList(parseJsonSafe(row.office_names_raw, []))]);
    let architects = uniq([...(architectsByProject.get(row.id) || []), ...strList(parseJsonSafe(row.designer_names_raw, []))])
      .filter(a => !offices.some(o => foldTr(o) === foldTr(a)));
    // Mimar yoksa firmanın kurucuları (pop-up ile AYNI düşüş).
    if (!architects.length) architects = uniq(offices.flatMap(o => foundersByOffice.get(foldTr(o)) || []));
    const discipline = strList(parseJsonSafe(row.discipline, []));
    const category = strList(parseJsonSafe(row.category, []));
    const type = strList(parseJsonSafe(row.type, []));
    projectsOut[row.slug] = {
      title: row.title,
      location: row.location || null,
      date: row.project_date || null,
      discipline, category, type,
      awards: strList(parseJsonSafe(row.awards, [])),
      architects, offices,
      credit: offices[0] || architects[0] || null,
      creditType: offices[0] ? 'office' : (architects[0] ? 'architect' : null),
      photoCredit: (row.photo_credit_text || '').trim() || null,
      kunye: kunyeSpacesFor([row.title, row.description, ...category, ...type].filter(Boolean).join(' \n ')),
    };
    for (const url of images) {
      if (!url || typeof url !== 'string') continue;
      const tags = normalizeStoredSpaces(spacesByUrl[url]);
      // LLM'in çizim dediği görsel bu sayfada HİÇ görünmez.
      if (tags && tags.some(t => DRAWING_SET.has(t.label))) continue;
      const perImage = typeof creditsByUrl[url] === 'string' ? creditsByUrl[url].trim() : '';
      candidates.push({ url, projectSlug: row.slug, spaces: tags, photographer: perImage || null });
    }
  }

  const clipStats = await attachClipHints(env, candidates);
  // LLM henüz bakmamışken CLIP'in çizim dediği görsel de düşer (dosya başı notu).
  let clipDrawings = 0;
  const items = candidates.filter((it) => {
    if (it.spaces === null && clipIsDrawing(it.clip)) { clipDrawings++; return false; }
    return true;
  });
  const stats = {
    images: items.length,
    llmLabeled: items.filter(it => it.spaces !== null).length,
    clipHinted: items.filter(it => it.clip).length,
    clipMissing: clipStats.clipMissing,
    clipPending: clipStats.clipPending,
    clipDrawingsHidden: clipDrawings,
    builtAt: new Date().toISOString(),
  };
  return { projects: projectsOut, items, stats };
}

// HAVUZ ŞEKLİ SÜRÜMLÜ ('photos:v2'): KV'deki havuz 30 dk yaşar ve deploy onu TEMİZLEMEZ. Beşinci
// turun deploy'unda (2026-09-18) ilk ~30 dk boyunca eski şekilli havuz (clip/stats/primary yok)
// yeni koda servis edildi ve tüm filtreler 0 döndü — smoke-test bunu yakaladı. Havuzun şekli
// değişince bu anahtar ve publicCache.js#POOL_CACHE_KINDS birlikte artırılır.
export const PHOTO_POOL_KIND = 'photos:v2';
export async function fetchPhotoPool(env) {
  return getCachedPool(env, PHOTO_POOL_KIND, () => fetchPhotoPoolRaw(env), {
    // CLIP puanlaması tur başına sınırlı: bitmediyse havuz kısa yaşar, sonraki istek sürdürür.
    ttlSeconds: (pool) => (pool && pool.stats && pool.stats.clipPending > 0 ? CLIP_PENDING_TTL_SECONDS : undefined),
  });
}
