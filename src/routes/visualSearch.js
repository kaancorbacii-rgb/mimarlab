// MİMARLAB AI Görsel Arama — POST /api/ai/visual-search
//
// Kullanıcı bir mimari/ürün fotoğrafı yükler; sistem İKİ AYRI boru hattı çalıştırır (brief 2):
//   A) PROJE ARAMASI  — mekan türü + disiplin + malzeme karakteri üzerinden benzer projeler
//   B) ÜRÜN ARAMASI   — görselde tespit edilen ürün KATEGORİLERİ üzerinden benzer ürünler
// İkisi bilerek karıştırılmaz ve arayüzde de ayrı bölümler olarak gösterilir.
//
// SONUÇLARIN KAYNAĞI YALNIZCA D1'DİR. Vision modeli hiçbir proje/ürün adı üretmez; çıktısı
// src/lib/visionAnalyze.js#normalizeVision içinde gerçek taksonomiye karşı beyaz listeden geçer,
// sonra src/lib/searchEngine.js'in (metin aramasıyla AYNI, kalibre edilmiş) sıralamasına beslenir.
//
// GÖRSEL EMBEDDING NEDEN YOK: Workers AI kataloğunda görsel embedding modeli bulunmuyor (denetim:
// tüm "Text Embeddings" modelleri yalnızca metin alır) — bkz. visionAnalyze.js dosya başı notu.
//
// MALİYET KONTROLÜ (brief 15):
//   * İstek başına EN FAZLA 1 AI çağrısı (vision). Embedding çağrısı YOK.
//   * Aynı görsel (SHA-256) daha önce analiz edildiyse AI'ya HİÇ gidilmez — KV önbelleği.
//   * IP başına hız sınırı.
//   * Ücretli hiçbir Cloudflare özelliği (Images Transform/Polish, Vectorize) kullanılmaz.
//
// GİZLİLİK (brief 13/14): yüklenen görsel R2'ye YAZILMAZ, hiçbir yerde kalıcı olarak saklanmaz ve
// hiçbir kullanıcıya gösterilmez. Bellekte analiz edilir, sonra düşer. Önbellekte yalnızca
// görselin HASH'i ve ondan türeyen yapılandırılmış analiz sonucu tutulur — görselin kendisi değil.

import { json, errorJson } from '../lib/http.js';
import { checkRateLimit, clientIp } from '../lib/rateLimit.js';
import { fetchActiveProjectPoolCached, parseProjectDateYear } from './project.js';
import { fetchProductPool } from './product.js';
import { emptyPlan, searchProjectPool, computeFacets } from '../lib/searchEngine.js';
import { analyzeImage, PRODUCT_CONFIDENCE_MIN } from '../lib/visionAnalyze.js';
import { foldTr } from '../lib/textMatch.js';

const MAX_BYTES = 10 * 1024 * 1024;            // arayüzdeki 10 MB sınırıyla aynı
const VISION_TIMEOUT_MS = 25000;
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;    // aynı görsel bir hafta boyunca yeniden analiz edilmez
const MAX_PROJECTS = 12;
const MAX_PRODUCTS = 12;

// Mekan türünden malzeme/karakter metin gruplarına: searchEngine planındaki textGroups ile aynı
// biçim (grup içi OR, gruplar arası AND). Vision'ın gördüğü malzeme burada zorunlu filtre DEĞİL,
// yalnızca sıralama sinyali olarak kullanılır — bir fotoğrafta mermer görülmesi, projenin
// açıklamasında "mermer" yazmasını GEREKTİRMEZ (açıklamalar çoğu projede malzeme saymıyor).
const MATERIAL_EXPANSION = {
  'ahşap': ['ahşap', 'wood', 'timber', 'lamine ahşap'],
  'beton': ['beton', 'brüt beton', 'concrete'],
  'cam': ['cam', 'glass', 'cam cephe', 'giydirme cephe'],
  'çelik': ['çelik', 'steel', 'metal'],
  'metal': ['metal', 'çelik', 'steel'],
  'mermer': ['mermer', 'marble', 'doğal taş'],
  'taş': ['taş', 'doğal taş', 'stone', 'traverten'],
  'tuğla': ['tuğla', 'brick'],
  'seramik': ['seramik', 'porselen', 'karo'],
};

function sniffImageMime(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47
      && bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A) return 'image/png';
  return null;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------------------------
// A) PROJE ARAMASI
// Vision'ın anladığı mekan türü/disiplin gerçek D1 alanlarına (projects.type / discipline)
// karşılık gelir; malzemeler yalnızca sıralama sinyalidir (bkz. MATERIAL_EXPANSION yorumu).
// ---------------------------------------------------------------------------------------------
function projectPlanFromVision(vision) {
  const plan = emptyPlan();
  if (vision.spaceType) plan.type = [vision.spaceType];
  if (vision.discipline) plan.discipline = [vision.discipline];
  const expand = [];
  for (const m of vision.materials) for (const t of (MATERIAL_EXPANSION[m] || [m])) if (!expand.includes(t)) expand.push(t);
  plan.expand = expand;
  return plan;
}

// ---------------------------------------------------------------------------------------------
// B) ÜRÜN ARAMASI (brief 8: önce kategori adayları, sonra sıralama)
// Aday havuzu ÖNCE tespit edilen kategoriye indirgenir; ancak bundan sonra malzeme/marka
// sinyalleriyle sıralanır. Böylece "sandalye tespit edildi" sorgusu tüm katalogda gezinmez.
// PRODUCT LEVEL DEDUPLICATION (brief 7): products havuzunda ürün başına ZATEN tek satır var
// (shapeProductItem tek kapak görseli döndürür), yani aynı ürün birden çok kez dönemez; yine de
// aynı slug iki kategoriden gelirse `seen` ile tekilleştirilir.
// ---------------------------------------------------------------------------------------------
function searchProductsByCategory(productPool, vision) {
  const seen = new Set();
  const out = [];
  for (const det of vision.products) {
    const wantedCat = foldTr(det.category);
    for (const p of productPool) {
      if (seen.has(p.slug)) continue;
      const cat = foldTr(p.category || '');
      if (!cat || cat !== wantedCat) continue;
      // Malzeme uyumu: görselde ahşap görüldüyse ahşap ürün öne çıksın (brief 9: görsel+semantik
      // +kategori birlikte). Kategori zaten kesin eşleştiği için bu yalnızca SIRALAMA etkiler.
      const text = foldTr(`${p.title || ''} ${p.brand || ''} ${p.category || ''}`);
      let materialBoost = 0;
      for (const m of vision.materials) {
        for (const t of (MATERIAL_EXPANSION[m] || [m])) {
          if (text.includes(foldTr(t))) { materialBoost = 1; break; }
        }
        if (materialBoost) break;
      }
      const rating = (p.rating && p.rating.count) ? Math.min(1, p.rating.average / 5) : 0;
      const score = det.confidence * 3 + materialBoost * 1.5 + rating * 0.5 + (p.image ? 0.4 : 0);
      seen.add(p.slug);
      out.push({ item: p, score, matchedCategory: det.category, confidence: det.confidence });
    }
  }
  out.sort((a, b) => (b.score - a.score) || String(a.item.slug).localeCompare(String(b.item.slug)));
  return out;
}

export async function handleVisualSearchRoute(request, env, url) {
  if (url.pathname !== '/api/ai/visual-search' || request.method !== 'POST') return errorJson('Bulunamadı', 404);
  if (!env.AI) return errorJson('Görsel arama şu anda kullanılamıyor.', 503);

  // Hız sınırı — vision çağrısı bu sitedeki en pahalı AI işlemi (brief 14/15).
  if (!(await checkRateLimit(env, 'visual-search', clientIp(request), 6, 5 * 60 * 1000))) {
    return errorJson('Çok fazla görsel araması yaptın. Lütfen birkaç dakika sonra tekrar dene.', 429, { 'Retry-After': '300' });
  }

  let form;
  try { form = await request.formData(); } catch { return errorJson('Görsel okunamadı.'); }
  const file = form.get('image');
  if (!file || typeof file === 'string') return errorJson('Bir görsel seç.');
  if (file.size > MAX_BYTES) return errorJson("Görsel 10mb'tan küçük olmalı.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  // İçerik türü BEYANA değil MAGIC BYTE'a göre doğrulanır (mevcut /api/uploads ile aynı kural).
  const mime = sniffImageMime(bytes);
  if (!mime) return errorJson('Yalnızca PNG, JPG veya JPEG dosyaları desteklenir.');

  const hash = await sha256Hex(bytes);
  const cacheKey = `vsearch:v1:${hash}`;

  // 1) ANALİZ — aynı görsel daha önce görüldüyse AI'ya HİÇ gidilmez.
  let vision = null;
  let cached = false;
  let aiCalls = 0;
  try {
    const hit = await env.FACET_CACHE.get(cacheKey, 'json');
    if (hit) { vision = hit; cached = true; }
  } catch { /* önbellek okunamazsa normal yola devam */ }

  if (!vision) {
    try {
      vision = await analyzeImage(env, bytes, VISION_TIMEOUT_MS);
      aiCalls = 1;
    } catch (err) {
      // brief 22: AI başarısız olursa BOŞ BEYAZ MODAL bırakma, anlaşılır bir hata döndür.
      console.error('visualSearch: vision failed', err && err.message, JSON.stringify(err && err.details || []));
      return errorJson('Görsel analiz edilemedi, lütfen tekrar dene.', 503);
    }
    try {
      await env.FACET_CACHE.put(cacheKey, JSON.stringify(vision), { expirationTtl: CACHE_TTL_SECONDS });
    } catch { /* önbellek yazılamazsa sonuç yine döner */ }
  }

  // 2) MİMARİ OLMAYAN GÖRSEL (brief 18) — zorla sonuç üretme.
  if (!vision.isArchitectural) {
    return json({
      ok: true, cached, aiCalls,
      analysis: { isArchitectural: false, spaceType: null, materials: [], products: [], description: vision.description || '' },
      projects: [], products: [],
      message: 'Bu görselde mimari bir mekan ya da yapı ürünü tespit edilemedi. Bir iç mekan, cephe ya da ürün fotoğrafı deneyebilirsin.',
    });
  }

  const [projectPool, productPool] = await Promise.all([
    fetchActiveProjectPoolCached(env, 'built'),
    fetchProductPool(env),
  ]);

  // A) Projeler. Mekan türü hiç anlaşılamadıysa proje araması yapılmaz — 1698 projeyi
  // rastgele sıralayıp "benzer" diye sunmak, hiç sonuç vermemekten daha kötü olurdu (brief 12).
  const plan = projectPlanFromVision(vision);
  let projects = [];
  if (plan.type.length || plan.discipline.length) {
    projects = searchProjectPool(projectPool, plan, parseProjectDateYear, new Set()).slice(0, MAX_PROJECTS);
  }

  // B) Ürünler.
  const products = searchProductsByCategory(productPool, vision).slice(0, MAX_PRODUCTS);

  return json({
    ok: true,
    cached,
    aiCalls,
    analysis: {
      isArchitectural: true,
      model: vision.model || null,
      spaceType: vision.spaceType,
      discipline: vision.discipline,
      materials: vision.materials,
      // Kullanıcıya gösterilen tespit listesi — ürün ADI değil KATEGORİ (brief 11).
      products: vision.products,
      description: vision.description,
      confidenceMin: PRODUCT_CONFIDENCE_MIN,
    },
    projects: projects.map(r => ({
      slug: r.item.slug, title: r.item.title, location: r.item.location, date: r.item.date,
      image: (r.item.images && r.item.images[0]) || null,
      score: Number(r.score.toFixed(3)),
    })),
    products: products.map(r => ({
      slug: r.item.slug, title: r.item.title, brand: r.item.brand, category: r.item.category,
      image: r.item.image, matchedCategory: r.matchedCategory,
      score: Number(r.score.toFixed(3)),
    })),
    facets: computeFacets(projects.map(r => r.item), parseProjectDateYear),
  });
}
