// MİMARLAB Görsel Arama — POST /api/ai/visual-search
//
// ============================================================================================
// TEMEL İLKE (kullanıcı isteği, 2026-09-03 madde 5): ÖNCE KİMLİK, SONRA BENZERLİK.
// Sistemin ilk sorusu "bu görsele ne benziyor" DEĞİL, "bu görsel MİMARLAB'daki HANGİ VARLIK"
// sorusudur. Ayasofya'nın veritabanında olmayan bir fotoğrafı yüklendiğinde doğru cevap
// "Ayasofya bulunamadı ama bunlar benzer" değildir — MİMARLAB'da Ayasofya varsa #1 O olmalıdır.
// ============================================================================================
//
// ÖNCEKİ MİMARİNİN NEDEN BUNU YAPAMADIĞI (teşhis, 2026-09-03)
// Eski boru hattı yalnızca TÜR düzeyinde çalışıyordu: vision modeli fotoğrafı "Cami + Restorasyon
// + taş" diye anlıyor, bu üç etiket searchEngine'in metin planına çevriliyor ve 1715 proje
// arasından cami olanlar sıralanıyordu. Yani sistemde "bu FOTOĞRAF şu KAYIT" bağını kurabilecek
// HİÇBİR mekanizma yoktu; Ayasofya kayıtlı olsa bile onu #1 yapacak bir sinyal üretilmiyordu.
// Üstelik tür içi sıralama neredeyse rastgeleydi: 60 cami arasında hangisinin öne geleceğini
// yalnızca malzeme kelimesinin açıklamada geçip geçmemesi belirliyordu.
//
// YENİ MİMARİ — İKİ AŞAMA
//   AŞAMA A (kimlik):  vision -> {identity, visibleText/OCR, brand, model, place}
//                      -> src/lib/entityMatch.js ile D1 BAŞLIKLARINA karşı IDF ağırlıklı eşleşme.
//                      Model bir kayıt UYDURAMAZ: eşleşmeyen ad sessizce düşer.
//   AŞAMA B (benzerlik): vision'ın ayırt edici Türkçe betimlemesi -> bge-m3 embedding
//                      -> önceden kurulmuş varlık dizini (src/lib/visualIndex.js) ile kosinüs.
//                      AYNI yapının FARKLI fotoğrafı bu yolla da aynı varlığa yaklaşır, çünkü
//                      karşılaştırma piksellerde değil ANLAM uzayında yapılır (brief 3/6).
//   Bunlara taksonomi (tür/disiplin/malzeme) ve coğrafya sinyalleri eklenip AĞIRLIKLI olarak
//   birleştirilir (brief 12). Hiçbir sinyal tek başına karar vermez.
//
// TIER AYRIMI (brief 2/13/26): "aynı varlık" iddiası ile "benzer" sonucu BİRBİRİNE KARIŞTIRILMAZ.
// Exact eşleşme yalnızca ad eşleşmesi güçlüyse VE ikinci adaya belirgin bir fark varsa ilan
// edilir; aksi halde sistem exact iddiasında BULUNMAZ ve sonuçlar "en yakın" başlığı altında
// gösterilir. Zorlama yoktur.
//
// MALİYET KONTROLÜ (brief 15/24):
//   * İstek başına EN FAZLA 2 AI çağrısı: 1 vision + 1 metin embedding (sorgu için).
//     Varlık embedding'leri arama sırasında ÜRETİLMEZ — önceden kurulmuş dizinden okunur.
//   * Aynı görsel (SHA-256) daha önce görüldüyse AI'ya HİÇ gidilmez (KV önbelleği, 7 gün).
//   * Dizin TEK bir KV nesnesidir: arama başına 0 (sıfır) ek D1 satırı okunur.
//   * IP başına hız sınırı. Ücretli hiçbir Cloudflare özelliği (Images Transform, Vectorize) yok.
//
// GİZLİLİK (brief 25): yüklenen görsel R2'ye YAZILMAZ, kalıcı olarak saklanmaz, hiçbir kullanıcıya
// gösterilmez. Bellekte analiz edilir, sonra düşer. Önbellekte yalnızca görselin HASH'i ve ondan
// türeyen yapılandırılmış analiz tutulur — görselin kendisi değil.

import { json, errorJson } from '../lib/http.js';
import { checkRateLimit, clientIp } from '../lib/rateLimit.js';
import { fetchActiveProjectPoolCached, parseProjectDateYear } from './project.js';
import { fetchProductPool } from './product.js';
import { emptyPlan, searchProjectPool } from '../lib/searchEngine.js';
import { analyzeImage, PRODUCT_CONFIDENCE_MIN } from '../lib/visionAnalyze.js';
import { foldTr } from '../lib/textMatch.js';
import { buildNameIndex, matchNames } from '../lib/entityMatch.js';
import { cosineScores, cosineScoresFromRow, EMBED_MODEL, EMBED_DIM } from '../lib/visualIndex.js';
import { loadIndex, embedTexts } from '../lib/visualIndexStore.js';
// bkz. src/lib/projectPool.js'teki AYNI import — il/ilçe çözümlemesi TEK kaynaktan (~970 ilçelik
// veri). geoScore İLÇE adını (ör. "Fatih") ŞEHRE ("İstanbul") çözmek için bunu kullanır; aksi
// halde vision'ın "İstanbul" tahmini, projelerin ezici çoğunluğunda location alanı İLÇE adı olarak
// saklandığından (bkz. gerçek bulgu, eval script — Ayasofya Camii location='Fatih') HİÇBİR zaman
// eşleşmezdi ve coğrafya sinyali sistemde fiilen ölü kalırdı.
import ilIlceJs from '../../il-ilce-data.js';

const { parseLocationFull } = ilIlceJs;

const MAX_BYTES = 10 * 1024 * 1024;            // arayüzdeki 10 MB sınırıyla aynı
const MAX_PIXELS = 50 * 1000 * 1000;           // dekompresyon bombası koruması (brief 25)
const VISION_TIMEOUT_MS = 25000;
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;    // aynı görsel bir hafta boyunca yeniden analiz edilmez
const MAX_PROJECTS = 12;
const MAX_PRODUCTS = 12;

// ---------------------------------------------------------------------------------------------
// KALİBRE EDİLMİŞ EŞİKLER (brief 13) — scripts/visual-search-eval.mjs ile ölçülerek seçildi;
// hiçbiri "makul göründüğü için" yazılmadı. Değiştirmeden önce o betiği çalıştırın.
// ---------------------------------------------------------------------------------------------
// Bir adı "aynı varlık" saymak için gereken en düşük sözlüksel skor. entityMatch.js'in skoru
// sqrt(kapsama × isabet) olduğundan 0.62, adın en az ~%40'ının IDF ağırlıklı olarak açıklanmasını
// ve tahminin de büyük ölçüde tutmasını gerektirir.
const EXACT_NAME_MIN = 0.62;
// Exact ilan etmek için gereken birleşik güven (ad + anlam + coğrafya + tür).
const EXACT_CONF_MIN = 0.58;
// İkinci adaya gereken FARK — "Galata Kulesi" ile "Galata Apartmanı" arasındaki gibi belirsiz
// durumlarda sistem exact iddiasında bulunmasın diye (brief 26/TEST 4).
const EXACT_MARGIN = 0.08;
// Coğrafyanın doğruladığı gevşetilmiş yol: ad daha zayıfsa bile şehir + anlam birlikte tutuyorsa.
const EXACT_ASSIST_NAME_MIN = 0.50;
const EXACT_ASSIST_SEM_MIN = 0.70;
// Sonuç listesine girebilmek için gereken en düşük birleşik skor — bunun altındakiler gürültüdür
// ve HİÇ gösterilmez (brief 12/26: "rastgele proje/ürün doldurma yapılmamalı").
const PROJECT_MIN_SCORE = 0.16;
const PRODUCT_MIN_SCORE = 0.22;
// Ürün bölümünün AÇILMASI için gereken en düşük ürün kimlik sinyali (brief 11: mimari fotoğrafta
// alakasız sandalye/lavabo gösterme).
const PRODUCT_GATE_NAME_MIN = 0.50;
// Kosinüsün [0,1]'e ölçeklenmesi. bge-m3'te ilgisiz metin çiftleri ~0.30-0.40, gerçekten ilgili
// olanlar ~0.65-0.85 bandındadır; ham kosinüsü doğrudan ağırlıklandırmak taban gürültüyü
// "benzerlik" gibi gösterirdi.
const SEM_FLOOR = 0.38;
const SEM_CEIL = 0.82;

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

// PNG/JPEG başlığından piksel ölçüsü. Amaç boyut doğrulaması DEĞİL, DEKOMPRESYON BOMBASI
// korumasıdır (brief 25): 2 KB'lık bir PNG 60000×60000 piksel beyan edebilir ve onu çözmeye
// çalışan aşama belleği tüketir. Ölçü okunamazsa (nadir/parçalı başlık) istek ENGELLENMEZ —
// bu bir ek savunma katmanıdır, tek kapı değil (asıl kapı MAX_BYTES + magic byte).
function imagePixels(bytes) {
  try {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      // IHDR her zaman ilk chunk'tır: 8 bayt imza + 4 uzunluk + 4 tip = 16. offset'te genişlik.
      return view.getUint32(16, false) * view.getUint32(20, false);
    }
    // JPEG: SOF0/1/2 işaretçisini ara.
    for (let i = 2; i + 9 < bytes.length;) {
      if (bytes[i] !== 0xFF) { i++; continue; }
      const marker = bytes[i + 1];
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        const h = (bytes[i + 5] << 8) | bytes[i + 6];
        const w = (bytes[i + 7] << 8) | bytes[i + 8];
        return w * h;
      }
      if (len <= 0) break;
      i += 2 + len;
    }
  } catch { /* okunamadı — engelleme */ }
  return 0;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Önbellekten (KV JSON) gelen analiz nesnesinin EKSİK alanları tamamlanır. Önbellek anahtarı
// sürümlenmiş olsa bile bu güvenlik ağı gerekir: aynı sürüm içinde yazılmış bir kayıt, kısmi bir
// yazma ya da ileride eklenecek bir alan yüzünden eksik olabilir ve `vision.identity.length`
// gibi bir okuma TÜM aramayı 500'e düşürürdü.
// export EDİLİR: scripts/visual-search-eval.mjs fixture'ları KASITLI OLARAK eksik yazar (yalnızca
// test ettiği alanları doldurur) — production'daki AYNI tamamlama kuralı eval'da da uygulanmalı.
export function hydrateVision(v) {
  return {
    subject: 'other', isArchitectural: false, spaceType: null, spaceTypes: [], discipline: null,
    materials: [], products: [], description: '',
    identity: [], visibleText: [], brand: null, model: null,
    ...v,
    place: (v && v.place && typeof v.place === 'object') ? v.place : { city: null, country: null },
  };
}

function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
function sem01(cos) { return clamp01((cos - SEM_FLOOR) / (SEM_CEIL - SEM_FLOOR)); }

// ---------------------------------------------------------------------------------------------
// SORGU METNİ — anlamsal aramanın girdisi. Varlık belgeleriyle (bkz. src/lib/visualIndex.js#
// projectDocFromRow) AYNI dilde ve AYNI sırada kurulur: önce kimlik, sonra yer, sonra tür, sonra
// betimleme. bge-m3 baştaki tokenlara daha çok ağırlık verdiği için bu sıra ölçülebilir fark yapar.
// ---------------------------------------------------------------------------------------------
// export EDİLİR: scripts/visual-search-eval.mjs sorgu embedding'ini gerçek bge-m3 çağrısıyla
// üretirken PRODUCTION'daki BİREBİR AYNI metni göndermek zorunda — aksi halde eval, gerçekte
// çalışmayan bir metinle "çalışıyor" görünümü verebilir.
export function buildQueryText(vision) {
  const parts = [];
  for (const g of vision.identity) parts.push(g.name);
  if (vision.brand) parts.push(vision.brand);
  if (vision.model) parts.push(vision.model);
  const place = [vision.place.city, vision.place.country].filter(Boolean).join(', ');
  if (place) parts.push(place);
  if (vision.spaceTypes.length) parts.push(vision.spaceTypes.join(', '));
  if (vision.discipline) parts.push(vision.discipline);
  if (vision.materials.length) parts.push(vision.materials.join(', '));
  if (vision.products.length) parts.push(vision.products.map(p => p.category).join(', '));
  if (vision.visibleText.length) parts.push(vision.visibleText.join(' '));
  if (vision.description) parts.push(vision.description);
  return parts.filter(Boolean).join('. ').slice(0, 1400);
}

// Kimlik tahminleri -> ağırlıklı arama anahtarları.
// OCR metinleri BİLEREK düşük ağırlıklıdır (0.55): brief 8 "OCR tek başına eşleşme kabulü olmamalı"
// diyor ve 0.55 × 1.0 = 0.55 < EXACT_NAME_MIN (0.62), yani OCR tek başına matematiksel olarak
// exact eşleşme ilan EDEMEZ; ancak başka sinyallerle birlikte skoru yükseltebilir.
function projectGuesses(vision) {
  const out = [];
  for (const g of vision.identity) {
    if (g.kind === 'product') continue;
    out.push({ text: g.name, weight: Math.max(0.45, g.confidence) });
  }
  for (const t of vision.visibleText) out.push({ text: t, weight: 0.55 });
  return out;
}

function productGuesses(vision) {
  const out = [];
  for (const g of vision.identity) {
    out.push({ text: g.name, weight: g.kind === 'product' ? Math.max(0.45, g.confidence) : 0.35 });
  }
  if (vision.brand && vision.model) out.push({ text: `${vision.brand} ${vision.model}`, weight: 0.85 });
  if (vision.brand) out.push({ text: vision.brand, weight: 0.5 });
  if (vision.model) out.push({ text: vision.model, weight: 0.6 });
  for (const t of vision.visibleText) out.push({ text: t, weight: 0.55 });
  return out;
}

function materialHit(text, materials) {
  const folded = foldTr(text);
  for (const m of materials) {
    for (const t of (MATERIAL_EXPANSION[m] || [m])) {
      if (folded.includes(foldTr(t))) return true;
    }
  }
  return false;
}

function projectTaxScore(item, vision) {
  let s = 0;
  const types = Array.isArray(item.type) ? item.type : [];
  if (vision.spaceTypes.length) {
    const idx = vision.spaceTypes.findIndex(t => types.includes(t));
    // Aday SIRASI korunur: modelin en olası tahmini daha çok puan alır (ölçülmüş gerileme, bkz.
    // git geçmişi — tüm adayları eşit saymak Top-1'i düşürüyordu).
    if (idx === 0) s += 0.55; else if (idx > 0) s += 0.32;
  }
  const disc = Array.isArray(item.discipline) ? item.discipline : [];
  if (vision.discipline && disc.includes(vision.discipline)) s += 0.25;
  if (vision.materials.length && materialHit(`${item.title || ''} ${item.description || ''}`, vision.materials)) s += 0.20;
  return clamp01(s);
}

function geoScore(item, vision) {
  const city = foldTr(vision.place.city || '');
  if (city.length < 3) return 0;
  // İKİ AYRI KONTROL: (a) İLÇE->ŞEHİR çözümlemesi (parseLocationFull, "Fatih" -> "İstanbul") —
  // projelerin ezici çoğunluğunda location alanı ilçe adı olarak saklandığından bu ASIL yoldur;
  // (b) düz substring — location_detail'deki serbest metinde ("Boğaz Kıyıları" gibi) ya da yurt
  // dışı kayıtlarda (parseLocationFull yalnızca TR il/ilçe listesini bilir) şehir adı doğrudan
  // geçebilir. İkisinden biri yeterlidir.
  const resolvedCity = foldTr(parseLocationFull(item.location || '').city || '');
  if (resolvedCity && resolvedCity === city) return 1;
  const loc = foldTr(`${item.location || ''} ${item.locationDetail || ''}`);
  return loc.includes(city) ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------
// PROJE SIRALAMASI
// ---------------------------------------------------------------------------------------------
function rankProjects(pool, poolBySlug, vision, semBySlug, nameIndex) {
  const nameBySlug = matchNames(nameIndex, projectGuesses(vision), it => it.slug, 25);

  // ADAY KÜMESİ üç kaynaktan gelir; hiçbiri tek başına yeterli değildir:
  //   1) sözlüksel kimlik eşleşmeleri (Aşama A),
  //   2) anlamsal en yakınlar (Aşama B),
  //   3) taksonomi araması — dizin henüz kurulmamışsa ya da fotoğraf hiçbir şeye benzemiyorsa
  //      sistemin eski, kanıtlanmış davranışı korunsun diye (geriye dönük güvenlik ağı).
  const candidates = new Map();   // slug -> item
  for (const [slug, m] of nameBySlug) candidates.set(slug, m.item);
  if (semBySlug) {
    const top = [...semBySlug.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60);
    for (const [slug] of top) {
      const item = poolBySlug.get(slug);
      if (item) candidates.set(slug, item);
    }
  }
  if (candidates.size < 40) {
    const plan = emptyPlan();
    if (vision.spaceTypes.length) plan.type = vision.spaceTypes.slice();
    if (vision.discipline) plan.discipline = [vision.discipline];
    const expand = [];
    for (const m of vision.materials) for (const t of (MATERIAL_EXPANSION[m] || [m])) if (!expand.includes(t)) expand.push(t);
    plan.expand = expand;
    if (plan.type.length || plan.discipline.length) {
      for (const r of searchProjectPool(pool, plan, parseProjectDateYear, new Set())) {
        if (candidates.size >= 60) break;
        if (!candidates.has(r.item.slug)) candidates.set(r.item.slug, r.item);
      }
    }
  }

  const scored = [];
  for (const [slug, item] of candidates) {
    const name = nameBySlug.has(slug) ? nameBySlug.get(slug).score : 0;
    const sem = semBySlug ? sem01(semBySlug.get(slug) || 0) : 0;
    const tax = projectTaxScore(item, vision);
    const geo = geoScore(item, vision);
    const final = 0.46 * name + 0.32 * sem + 0.16 * tax + 0.06 * geo;
    const conf = 0.70 * name + 0.18 * sem + 0.07 * geo + 0.05 * tax;
    scored.push({ item, name, sem, tax, geo, score: final, conf, via: nameBySlug.get(slug) || null });
  }
  scored.sort((a, b) => (b.score - a.score) || String(a.item.slug).localeCompare(String(b.item.slug)));
  return scored;
}

// ---------------------------------------------------------------------------------------------
// ÜRÜN SIRALAMASI
// ---------------------------------------------------------------------------------------------
function productCategoryScore(item, vision) {
  const cat = foldTr(item.category || '');
  if (!cat) return 0;
  let best = 0;
  for (const det of vision.products) {
    if (foldTr(det.category) === cat) best = Math.max(best, det.confidence);
  }
  return best;
}

function rankProducts(pool, poolBySlug, vision, semBySlug, nameIndex) {
  const nameBySlug = matchNames(nameIndex, productGuesses(vision), it => it.slug, 25);
  const brandFold = foldTr(vision.brand || '');

  const candidates = new Map();
  for (const [slug, m] of nameBySlug) candidates.set(slug, m.item);
  // Tespit edilen KATEGORİ havuzun tamamı yerine dar bir aday kümesi üretir (brief 8) — bu,
  // "sandalye tespit edildi" sorgusunun 191 ürünün tamamında gezinmesini önler.
  if (vision.products.length) {
    for (const p of pool) {
      if (candidates.has(p.slug)) continue;
      if (productCategoryScore(p, vision) > 0) candidates.set(p.slug, p);
    }
  }
  if (semBySlug) {
    const top = [...semBySlug.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    for (const [slug] of top) {
      if (candidates.has(slug)) continue;
      const item = poolBySlug.get(slug);
      if (item) candidates.set(slug, item);
    }
  }

  const scored = [];
  for (const [slug, item] of candidates) {
    const name = nameBySlug.has(slug) ? nameBySlug.get(slug).score : 0;
    const sem = semBySlug ? sem01(semBySlug.get(slug) || 0) : 0;
    const cat = productCategoryScore(item, vision);
    const brand = brandFold && foldTr(item.brand || '') === brandFold ? 1 : 0;
    const mat = vision.materials.length && materialHit(`${item.title || ''} ${item.category || ''}`, vision.materials) ? 1 : 0;
    const rating = (item.rating && item.rating.count) ? Math.min(1, item.rating.average / 5) : 0;
    const final = 0.40 * name + 0.24 * sem + 0.20 * cat + 0.10 * brand + 0.03 * mat + 0.03 * rating;
    const conf = 0.62 * name + 0.16 * sem + 0.14 * brand + 0.08 * cat;
    scored.push({ item, name, sem, cat, brand, score: final, conf, via: nameBySlug.get(slug) || null });
  }
  scored.sort((a, b) => (b.score - a.score) || String(a.item.slug).localeCompare(String(b.item.slug)));
  return scored;
}

// Exact karar kapısı — üç koşul BİRLİKTE sağlanmalı (brief 13/26).
function decideExact(scored, nameMin) {
  if (!scored.length) return null;
  const top = scored[0];
  const runnerUpName = scored.length > 1 ? scored[1].name : 0;
  const margin = top.name - runnerUpName;
  const strong = top.name >= nameMin && top.conf >= EXACT_CONF_MIN && margin >= EXACT_MARGIN;
  // Coğrafyanın doğruladığı gevşetilmiş yol: ad tek başına eşiği geçmese de şehir eşleşiyor VE
  // anlamsal benzerlik yüksekse aynı varlık kabul edilir (ör. modelin adı yarım hatırladığı,
  // ama şehri ve yapı karakterini doğru bildiği yerel yapılar).
  const assisted = top.name >= EXACT_ASSIST_NAME_MIN && top.sem >= EXACT_ASSIST_SEM_MIN
    && top.geo === 1 && margin >= EXACT_MARGIN;
  if (!strong && !assisted) return null;
  return top;
}

// ---------------------------------------------------------------------------------------------
// SAF ÇEKİRDEK — vision + sorgu embedding'i + havuzlar/dizinler alır, karar üretir. HTTP/AI/D1'e
// dokunmaz, bu yüzden hem handleVisualSearchRoute hem de scripts/visual-search-eval.mjs TARAFINDAN
// çağrılabilir (brief 23: kalıcı regresyon testleri gerçek karar mantığını test etmeli, HTTP
// katmanının bir kopyasını değil). Eval betiği gerçek D1 havuzlarını + gerçek KV dizinini + gerçek
// bge-m3 sorgu embedding'ini kullanır; yalnızca "vision" TARAFI (gerçek fotoğraf + AI çağrısı)
// elle yazılmış sabit kurgularla (fixture) simüle edilir — bu, sistemin GERÇEK zayıf noktasını
// (sıralama/eşik mantığı) test eder, Cloudflare'in vision modelinin kendisini değil.
// ---------------------------------------------------------------------------------------------
export function resolveVisualMatch(vision, queryVec, pools) {
  const { projectPool, productPool, projectIndex, productIndex } = pools;

  function semMap(index) {
    if (!index || !queryVec) return null;
    const scores = cosineScores(index, queryVec);
    const map = new Map();
    for (let i = 0; i < index.items.length; i++) map.set(index.items[i].s, scores[i]);
    return map;
  }
  const projSem = semMap(projectIndex);
  const prodSem = semMap(productIndex);

  const projectBySlug = new Map(projectPool.map(p => [p.slug, p]));
  const productBySlug = new Map(productPool.map(p => [p.slug, p]));

  const projectNameIndex = buildNameIndex(projectPool, it => it.title || '');
  const productNameIndex = buildNameIndex(productPool, it =>
    [it.brand || '', it.title || '', (it.designers || []).join(' ')].join(' '));

  const projScored = rankProjects(projectPool, projectBySlug, vision, projSem, projectNameIndex);
  const projectMatch = decideExact(projScored, EXACT_NAME_MIN);

  let similarProjects = projScored;
  if (projectMatch && projectIndex) {
    const idx = projectIndex.items.findIndex(it => it.s === projectMatch.item.slug);
    if (idx >= 0) {
      const fromEntity = cosineScoresFromRow(projectIndex, idx);
      const blended = new Map();
      for (let i = 0; i < projectIndex.items.length; i++) {
        const slug = projectIndex.items[i].s;
        const q = projSem ? (projSem.get(slug) || 0) : 0;
        blended.set(slug, 0.5 * q + 0.5 * fromEntity[i]);
      }
      similarProjects = rankProjects(projectPool, projectBySlug, vision, blended, projectNameIndex);
    }
  }

  const projects = similarProjects
    .filter(r => r.score >= PROJECT_MIN_SCORE)
    .filter(r => !projectMatch || r.item.slug !== projectMatch.item.slug)
    .slice(0, MAX_PROJECTS);

  const prodScored = rankProducts(productPool, productBySlug, vision, prodSem, productNameIndex);
  const productMatch = decideExact(prodScored, EXACT_NAME_MIN);
  const bestProductName = prodScored.length ? prodScored[0].name : 0;
  const productSignal = (vision.products && vision.products.length > 0)
    || vision.subject === 'product'
    || bestProductName >= PRODUCT_GATE_NAME_MIN;
  const products = productSignal
    ? prodScored
      .filter(r => r.score >= PRODUCT_MIN_SCORE)
      .filter(r => !productMatch || r.item.slug !== productMatch.item.slug)
      .slice(0, MAX_PRODUCTS)
    : [];

  return {
    match: {
      project: projectMatch ? { ...projectPayload(projectMatch), confidence: Number(projectMatch.conf.toFixed(3)) } : null,
      product: (productSignal && productMatch) ? { ...productPayload(productMatch), confidence: Number(productMatch.conf.toFixed(3)) } : null,
    },
    projects: projects.map(projectPayload),
    products: products.map(productPayload),
    productsSuppressed: !productSignal,
    // Ham skorlar (eval için) — payload'a girmeyen ama Top-K doğruluğu ölçmek için gereken tam sıra.
    projectsRanked: similarProjects, productsRanked: prodScored,
  };
}

function projectPayload(r) {
  return {
    slug: r.item.slug, title: r.item.title, location: r.item.location, date: r.item.date,
    image: (r.item.images && r.item.images[0]) || null,
    score: Number(r.score.toFixed(3)),
    signals: { name: Number(r.name.toFixed(3)), semantic: Number(r.sem.toFixed(3)), taxonomy: Number(r.tax.toFixed(3)), geo: r.geo },
  };
}

function productPayload(r) {
  return {
    slug: r.item.slug, title: r.item.title, brand: r.item.brand, category: r.item.category,
    image: r.item.image,
    score: Number(r.score.toFixed(3)),
    signals: { name: Number(r.name.toFixed(3)), semantic: Number(r.sem.toFixed(3)), category: Number(r.cat.toFixed(3)), brand: r.brand },
  };
}

export async function handleVisualSearchRoute(request, env, url) {
  if (url.pathname !== '/api/ai/visual-search' || request.method !== 'POST') return errorJson('Bulunamadı', 404);
  if (!env.AI) return errorJson('Görsel arama şu anda kullanılamıyor.', 503);

  // Hız sınırı — vision çağrısı bu sitedeki en pahalı AI işlemi (brief 24).
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
  const pixels = imagePixels(bytes);
  if (pixels > MAX_PIXELS) return errorJson('Görselin çözünürlüğü çok yüksek, lütfen daha küçük bir dosya dene.');

  const hash = await sha256Hex(bytes);
  // Sürüm eki ZORUNLU: prompt/şema değişince eski önbellek kayıtları yeni davranışı maskeler.
  // v5: vision çıktısına kimlik/OCR/marka/yer alanları eklendi + sorgu embedding'i birlikte
  // önbelleklenmeye başlandı. Analiz mantığı her değiştiğinde bu numara ARTIRILMALI.
  const cacheKey = `vsearch:v5:${hash}`;

  // 1) ANALİZ + SORGU EMBEDDING'İ — aynı görsel daha önce görüldüyse AI'ya HİÇ gidilmez.
  let vision = null;
  let queryVec = null;
  let cached = false;
  let aiCalls = 0;
  try {
    const hit = await env.FACET_CACHE.get(cacheKey, 'json');
    if (hit && hit.vision) {
      vision = hydrateVision(hit.vision);
      // Vektör önbellekte int16 dizisi olarak (×10000) saklanır: 1024 float'ın JSON'u ~14 KB
      // yerine ~5 KB olur ve kosinüs için bu çözünürlük fazlasıyla yeterlidir.
      if (Array.isArray(hit.qv) && hit.qv.length === EMBED_DIM) queryVec = hit.qv.map(v => v / 10000);
      cached = true;
    }
  } catch { /* önbellek okunamazsa normal yola devam */ }

  if (!vision) {
    try {
      vision = await analyzeImage(env, bytes, VISION_TIMEOUT_MS, mime);
      aiCalls++;
    } catch (err) {
      console.error('visualSearch: vision failed', err && err.message, JSON.stringify(err && err.details || []));
      return errorJson('Görsel analiz edilemedi, lütfen tekrar dene.', 503);
    }
  }

  // 2) MİMARİ/ÜRÜN OLMAYAN GÖRSEL (brief 21/TEST 6) — zorla sonuç üretme.
  // Tek kapı olarak `isArchitectural` kullanmak, düz zeminli bir ÜRÜN fotoğrafında tüm boru
  // hattını kapatıyordu (ölçülmüş gerileme, 2026-09-02): model o kareyi "mimari değil" sayıyor,
  // oysa ürün araması tam da bunun için var. İlgisizlik kararı ancak İKİSİ de yoksa verilir.
  if (!vision.isArchitectural && !(vision.products && vision.products.length) && !vision.identity.length) {
    if (!cached) {
      try { await env.FACET_CACHE.put(cacheKey, JSON.stringify({ vision }), { expirationTtl: CACHE_TTL_SECONDS }); } catch { /* yok sayılır */ }
    }
    return json({
      ok: true, cached, aiCalls,
      analysis: { isArchitectural: false, subject: vision.subject, spaceType: null, materials: [], products: [], description: vision.description || '' },
      match: { project: null, product: null },
      projects: [], products: [], productsSuppressed: true,
      message: 'Bu görselde mimari bir mekan ya da yapı ürünü tespit edilemedi. Bir iç mekan, cephe ya da ürün fotoğrafı deneyebilirsin.',
    });
  }

  const queryText = buildQueryText(vision);
  if (!queryVec && queryText) {
    const [vec] = await embedTexts(env, [queryText]);
    if (vec && vec.length === EMBED_DIM) { queryVec = vec; aiCalls++; }
  }
  if (!cached) {
    try {
      await env.FACET_CACHE.put(cacheKey, JSON.stringify({
        vision,
        qv: queryVec ? queryVec.map(v => Math.round(v * 10000)) : null,
      }), { expirationTtl: CACHE_TTL_SECONDS });
    } catch { /* önbellek yazılamazsa sonuç yine döner */ }
  }

  const [projectPool, productPool, projectIndex, productIndex] = await Promise.all([
    fetchActiveProjectPoolCached(env, 'built'),
    fetchProductPool(env),
    loadIndex(env, 'project'),
    loadIndex(env, 'product'),
  ]);

  // Dizin yoksa (ilk deploy, henüz kurulmadı) resolveVisualMatch içindeki semBySlug null kalır ve
  // sistem sözlüksel + taksonomik yoldan ÇALIŞMAYA DEVAM EDER — bilerek yumuşak bir bağımlılık.
  const resolved = resolveVisualMatch(vision, queryVec, { projectPool, productPool, projectIndex, productIndex });

  return json({
    ok: true,
    cached,
    aiCalls,
    analysis: {
      isArchitectural: true,
      subject: vision.subject,
      model: vision.model || null,
      embedModel: queryVec ? EMBED_MODEL : null,
      indexed: { project: projectIndex ? projectIndex.items.length : 0, product: productIndex ? productIndex.items.length : 0 },
      spaceType: vision.spaceType,
      spaceTypes: vision.spaceTypes || [],
      discipline: vision.discipline,
      materials: vision.materials,
      // Kullanıcıya gösterilen tespit listesi — ürün ADI değil KATEGORİ (brief 11).
      products: vision.products,
      // Modelin kimlik tahminleri gözlemlenebilirlik için döner; ARAYÜZDE SONUÇ OLARAK
      // GÖSTERİLMEZ (bkz. site-chrome.js) — yalnızca D1'de karşılığı bulunanlar sonuç olur.
      identity: vision.identity,
      visibleText: vision.visibleText,
      place: vision.place,
      description: vision.description,
      confidenceMin: PRODUCT_CONFIDENCE_MIN,
    },
    // TIER 1 — aynı varlık. null ise sistem "aynı varlık" iddiasında BULUNMUYOR demektir.
    match: resolved.match,
    // TIER 2 — benzerler.
    projects: resolved.projects,
    products: resolved.products,
    productsSuppressed: resolved.productsSuppressed,
  });
}
