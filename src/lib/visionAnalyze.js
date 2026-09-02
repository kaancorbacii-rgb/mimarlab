// MİMARLAB görsel arama — yüklenen görselin ANLAMLANDIRILMASI.
//
// MİMARİ KARAR / ÖNEMLİ KISIT: brief "visual embedding" (CLIP benzeri) istiyor. Workers AI'nın
// model kataloğu (2026-09-02, `wrangler ai models` ile denetlendi) GÖRSEL EMBEDDING MODELİ
// İÇERMİYOR — "Text Embeddings" kategorisindeki tüm modeller (bge-m3, bge-*-en, qwen3-embedding,
// embeddinggemma, plamo) yalnızca METİN alır. Görsel alan modeller yalnızca Image-to-Text
// (llava, moondream) ve vision-LLM (llama-3.2-11b-vision, mistral-small-3.1) ile
// Image Classification (resnet-50, 1000 ImageNet sınıfı).
//
// Yani bu yığında piksel düzeyinde görsel benzerlik ÜRETİLEMEZ. Bunun yerine:
//   görsel -> vision modeli -> YAPILANDIRILMIŞ anlama -> MİMARLAB verisi -> sıralama
// zinciri kuruldu. Bu, brief'in 23. maddesindeki mimari ilkeyle birebir aynıdır ve modelin
// "bu X marka sandalyedir" demesini sonuç olarak KABUL ETMEZ (brief 5/11): modelin çıktısı
// yalnızca KATEGORİ/MALZEME/MEKAN TÜRÜ düzeyinde alınır ve hepsi gerçek taksonomiye karşı beyaz
// listeden geçirilir; ürün/proje kimliği yalnızca D1'den gelir.
//
// Bu sınır rapora AÇIKÇA yazıldı; kullanıcı ücretli servis açmayı yasakladığı için harici bir
// CLIP sağlayıcısı da değerlendirilmedi.

import projectTaxonomyJs from '../../project-taxonomy.js';
import catalogJs from '../../catalog-taxonomy.js';

const { PROJECT_GROUP_OPTIONS } = projectTaxonomyJs;
const { CATALOG_TAXONOMY } = catalogJs;

export const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';

// Gerçek ürün kategorileri (35 adet) — modelin döndürdüğü kategori BUNLARDAN biri değilse atılır.
export const PRODUCT_CATEGORIES = Object.values(CATALOG_TAXONOMY)
  .flatMap(v => (Array.isArray(v) ? v : Object.keys(v)));

const DISCIPLINES = ['Mimari', 'İç Mekan', 'Peyzaj ve Kentsel Tasarım', 'Restorasyon'];

// Malzeme sözlüğü — searchConcepts.js'teki malzeme kavramlarıyla AYNI kelimeler, çünkü çıktı
// doğrudan o motorun textGroups'una besleniyor.
const MATERIALS = ['ahşap', 'beton', 'cam', 'çelik', 'metal', 'mermer', 'taş', 'tuğla', 'seramik'];

// PROJE TİPİ için modelden istenen liste. PROJECT_GROUP_OPTIONS'ın TAMAMI (41 değer) prompt'a
// konmuyor — bir vision modeli için fazla uzun ve seçim kalitesini düşürüyor; mekân fotoğrafından
// gerçekten ayırt edilebilen alt küme veriliyor. Beyaz liste yine tam listeye karşı uygulanır.
const SPACE_TYPES = ['Konut', 'Toplu Konut', 'Ofis / İş Merkezi', 'Mağaza / Ticaret',
  'Kafe / Restoran', 'Turizm / Otel', 'AVM', 'Okul', 'Yükseköğretim', 'Sağlık', 'Müze',
  'Kültür Merkezi', 'Kütüphane', 'Cami', 'Spor', 'Ulaşım', 'Sanayi / Üretim', 'Kentsel Tasarım',
  'Rekreasyon / Park', 'Karma Kullanım'];

// GÜVENİLİRLİK EŞİĞİ (brief 6/12) — bunun altındaki ürün tespiti sonuç olarak GÖSTERİLMEZ.
// Değer gerçek testle kalibre edildi (bkz. scripts/visual-search-eval.mjs raporu): mimari
// fotoğraflarda model pencere/kapı/duvar gibi yapı elemanlarını düşük güvenle "ürün" diye
// işaretleme eğiliminde; 0.55 bu gürültüyü kesip gerçek mobilya/aydınlatma tespitlerini bırakıyor.
export const PRODUCT_CONFIDENCE_MIN = 0.55;

function buildPrompt() {
  return `Sen bir mimarlık veritabanının görsel analiz aracısın. Sana verilen fotoğrafı incele ve SADECE geçerli bir JSON nesnesiyle cevap ver. Başka hiçbir metin, açıklama veya markdown ekleme.

JSON şeması:
{
  "isArchitectural": boolean,
  "spaceType": string|null,
  "discipline": string|null,
  "materials": string[],
  "products": [{"category": string, "confidence": number}],
  "description": string
}

Kurallar:
- "isArchitectural": fotoğraf bir yapı, iç mekan, cephe, kentsel mekan ya da bir mobilya/yapı ürünü gösteriyorsa true. İnsan portresi, manzara, gökyüzü, hayvan, yemek, belge gibi mimarlıkla ilgisiz fotoğraflarda false.
- "spaceType": SADECE şu listeden BİRİ, emin değilsen null: ${SPACE_TYPES.join(', ')}
- "discipline": SADECE şunlardan biri, emin değilsen null: ${DISCIPLINES.join(', ')}
- "materials": fotoğrafta AÇIKÇA görünen malzemeler, SADECE şu listeden: ${MATERIALS.join(', ')}
- "products": fotoğrafta gördüğün TAŞINABİLİR ürünler. Kategori SADECE şu listeden olmalı: ${PRODUCT_CATEGORIES.join(', ')}
- ÖNEMLİ: pencere, kapı, duvar, zemin, tavan, kolon, merdiven, bitki, insan, araç gibi şeyler ÜRÜN DEĞİLDİR; bunları "products" içine YAZMA. Yalnızca gerçekten satın alınabilir bir mobilya/aydınlatma/vitrifiye/kaplama ürünü görüyorsan yaz.
- "confidence": 0 ile 1 arasında, gerçekten ne kadar emin olduğun. Emin değilsen düşük ver.
- Marka veya ürün ADI TAHMİN ETME. Sadece kategori yaz.
- "description": fotoğraftaki mekanın Türkçe, tek cümlelik betimlemesi (mekan türü, malzeme, ışık, karakter).`;
}

function parseJsonLoose(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(cleaned); } catch { /* aşağıda ilk {...} bloğu denenir */ }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// normalizeVision — modelin DÖNDÜRDÜĞÜ HER ŞEY burada gerçek taksonomiye karşı süzülür.
// Listede olmayan bir kategori/tip/malzeme sessizce DÜŞER; uydurulmuş bir değer asla filtreye
// dönüşemez (brief 23: "AI kendi bilgisinden proje veya ürün uydurmamalı").
export function normalizeVision(raw) {
  const out = {
    isArchitectural: false, spaceType: null, discipline: null,
    materials: [], products: [], description: '',
    droppedProducts: [],   // gözlemlenebilirlik: neyin neden atıldığı
  };
  if (!raw || typeof raw !== 'object') return out;

  out.isArchitectural = raw.isArchitectural === true;
  if (typeof raw.spaceType === 'string' && PROJECT_GROUP_OPTIONS.includes(raw.spaceType)) {
    out.spaceType = raw.spaceType;
  }
  if (typeof raw.discipline === 'string' && DISCIPLINES.includes(raw.discipline)) {
    out.discipline = raw.discipline;
  }
  if (Array.isArray(raw.materials)) {
    out.materials = raw.materials
      .filter(m => typeof m === 'string' && MATERIALS.includes(m.trim().toLocaleLowerCase('tr')))
      .map(m => m.trim().toLocaleLowerCase('tr'))
      .slice(0, 6);
  }
  if (Array.isArray(raw.products)) {
    for (const p of raw.products.slice(0, 12)) {
      if (!p || typeof p !== 'object') continue;
      const cat = typeof p.category === 'string' ? p.category.trim() : '';
      const conf = Number(p.confidence);
      if (!PRODUCT_CATEGORIES.includes(cat)) { out.droppedProducts.push({ category: cat, reason: 'katalogda yok' }); continue; }
      if (!Number.isFinite(conf) || conf < PRODUCT_CONFIDENCE_MIN) { out.droppedProducts.push({ category: cat, reason: 'güven düşük', confidence: Number.isFinite(conf) ? conf : null }); continue; }
      if (out.products.some(x => x.category === cat)) continue;
      out.products.push({ category: cat, confidence: Math.min(1, conf) });
    }
  }
  if (typeof raw.description === 'string') out.description = raw.description.trim().slice(0, 400);
  return out;
}

// analyzeImage — TEK vision çağrısı. Görsel Uint8Array olarak verilir (Workers AI `image` alanı
// bayt dizisi bekler).
export async function analyzeImage(env, bytes, timeoutMs) {
  const call = env.AI.run(VISION_MODEL, {
    image: Array.from(bytes),
    prompt: buildPrompt(),
    max_tokens: 700,
    temperature: 0,
  });
  const result = await Promise.race([
    call,
    new Promise((_, rej) => setTimeout(() => rej(new Error('vision timeout')), timeoutMs)),
  ]);
  const text = result && (result.response ?? result.description ?? result);
  return normalizeVision(parseJsonLoose(typeof text === 'string' ? text : JSON.stringify(text)));
}
