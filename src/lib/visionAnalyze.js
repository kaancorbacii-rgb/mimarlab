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
//
// ---------------------------------------------------------------------------------------------
// 2026-09-03 GENİŞLETMESİ — "ÖNCE KİMLİK, SONRA BENZERLİK" (kullanıcı isteği madde 5/26)
// Yukarıdaki yapı yalnızca TÜR düzeyinde çalışıyordu: bir Ayasofya fotoğrafı "Cami + Restorasyon +
// taş" olarak anlaşılıp 1715 projeden cami olanlar arasında sıralanıyordu — yani MİMARLAB'da
// Ayasofya KAYITLI OLSA BİLE onu #1 yapacak hiçbir mekanizma YOKTU. Bu, kullanıcının açıkça
// "KABUL EDİLMEZ" dediği davranıştı.
//
// Eklenen dört sinyal (`identity`, `visibleText`, `brand`/`model`, `place`) bu boşluğu kapatır ve
// yukarıdaki ilkeyi BOZMAZ, çünkü hiçbiri doğrudan sonuç olarak gösterilmez:
//   * `identity` modelin "bu Galata Kulesi" tahminidir ve YALNIZCA D1 başlıklarına karşı bir ARAMA
//     ANAHTARI olarak kullanılır (bkz. src/lib/entityMatch.js). MİMARLAB'da karşılığı olmayan bir
//     ad hiçbir şeyle eşleşmez ve sessizce düşer — model bir kayıt UYDURAMAZ.
//   * `visibleText` OCR'dır; tek başına eşleşme kabulü DEĞİLDİR (brief 8), yalnızca skora katılır.
//   * `description` artık ayırt edici 2-3 cümledir; anlamsal aramanın sorgu metnidir
//     (bkz. src/lib/visualIndex.js — aynı yapının FARKLI fotoğrafı bu yolla aynı varlığa düşer).
// ---------------------------------------------------------------------------------------------

import projectTaxonomyJs from '../../project-taxonomy.js';
import catalogJs from '../../catalog-taxonomy.js';

const { PROJECT_GROUP_OPTIONS } = projectTaxonomyJs;
const { CATALOG_TAXONOMY } = catalogJs;

// MODEL SEÇİMİ — GERÇEK BULGU (canlı test, 2026-09-02):
// İlk tercih @cf/meta/llama-3.2-11b-vision-instruct idi; Workers AI bu modeli
//   AiError 5016: "Prior to using this model, you must submit the prompt 'agree'"
// ile reddetti — Meta'nın lisansının bir kez KABUL EDİLMESİ gerekiyor. Bu bir sözleşme
// kabulüdür ve hesap sahibinin kararıdır, o yüzden onaylanmadı; lisans kapısı OLMAYAN
// modellere geçildi. (Kullanıcı isterse llama'yı açabilir, tek seferlik bir onaydır.)
//
// Sırayla denenir; ilk çalışan kullanılır. Farklı model aileleri FARKLI girdi biçimi ister,
// bu yüzden her adayın kendi `build` fonksiyonu var.
export const VISION_CANDIDATES = [
  {
    model: '@cf/mistralai/mistral-small-3.1-24b-instruct',
    // Vision-LLM'ler (Text Generation ailesi) OpenAI uyumlu messages + data URL bekler.
    // mime GERÇEK tespit edilen türdür (magic byte), beyan edilen değil — sabit "image/jpeg"
    // yazılsaydı kullanıcının yüklediği bir PNG yanlış etiketle gönderilir ve model onu
    // çözemeyebilirdi (gerçek bulgu: yanlış-pozitif test görselleri PNG üretiliyor).
    build: (b64, prompt, bytes, mime) => ({
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
      ] }],
      max_tokens: 900,
      temperature: 0,
    }),
  },
  {
    model: '@cf/moondream/moondream3.1-9B-A2B',
    // Image-to-Text ailesi: ham bayt dizisi + düz prompt.
    build: (b64, prompt, bytes) => ({ image: Array.from(bytes), prompt, max_tokens: 900 }),
  },
  {
    model: '@cf/llava-hf/llava-1.5-7b-hf',
    build: (b64, prompt, bytes) => ({ image: Array.from(bytes), prompt, max_tokens: 900 }),
  },
];

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
  "subject": "project"|"product"|"other",
  "isArchitectural": boolean,
  "identity": [{"name": string, "kind": "project"|"product", "confidence": number}],
  "visibleText": string[],
  "brand": string|null,
  "model": string|null,
  "place": {"city": string|null, "country": string|null},
  "spaceTypes": string[],
  "discipline": string|null,
  "materials": string[],
  "products": [{"category": string, "confidence": number}],
  "description": string
}

Kurallar:
- "subject": fotoğrafın ASIL konusu. Bir yapı/mekan/kentsel sahne ise "project"; tek bir satın alınabilir mobilya/aydınlatma/vitrifiye/kaplama ürünü (katalog fotoğrafı gibi) ise "product"; ikisi de değilse "other".
- "identity": fotoğraftaki yapıyı ya da ürünü GERÇEKTEN TANIYORSAN adını yaz (en olası önce, en fazla 3). Örnek: ünlü bir yapı, anıt, cami, müze, köprü, kule; ya da tanıdığın bir marka+model. TÜRKİYE'DEKİ bir yapıysa adını TÜRKÇE yaz (ör. "Hagia Sophia" değil "Ayasofya", "Galata Tower" değil "Galata Kulesi") — bu veritabanı Türkçe adlarla kayıtlı. Yurt dışındaki bir yapıysa kendi dilindeki/uluslararası bilinen adını yaz. Bilmiyorsan BOŞ DİZİ ver — TAHMİN UYDURMA, benzer bir yapının adını YAZMA. Emin olmadığın adlarda confidence'ı düşük tut.
- "visibleText": fotoğrafta OKUYABİLDİĞİN metinler (tabela, kitabe, marka logosu yazısı, model kodu, vitrin yazısı). Hiç yoksa boş dizi. Metni OLDUĞU GİBİ yaz, çevirme, yorumlama.
- "brand"/"model": yalnızca fotoğrafta AÇIKÇA okunuyorsa ya da kesin olarak tanıyorsan; yoksa null.
- "place": yapının bulunduğu şehir/ülkeyi tanıyorsan yaz, yoksa null. Tahmin uydurma.
- "isArchitectural": şu İKİ durumdan biri varsa true:
  (a) fotoğraf bir yapı, iç mekan, cephe ya da kentsel mekan gösteriyor, VEYA
  (b) fotoğraf tek bir MOBİLYA/AYDINLATMA/VİTRİFİYE/KAPLAMA ÜRÜNÜ gösteriyor — düz beyaz veya sade
      bir zeminde çekilmiş katalog/ürün fotoğrafı da BUNA DAHİLDİR (ör. beyaz zeminde bir sandalye,
      bir lavabo, bir armatür, bir sarkıt aydınlatma). Bu tür fotoğraflarda spaceTypes BOŞ bırakılır
      ama "products" MUTLAKA doldurulur.
  SADECE şu durumlarda false: insan portresi, manzara, gökyüzü, hayvan, yemek, belge/ekran görüntüsü,
  ya da hiçbir nesnenin seçilemediği tamamen boş/karanlık/gürültülü görüntüler.
- "spaceTypes": yapının İŞLEVİ için EN OLASI 1-3 seçenek, en olasısı BAŞTA. SADECE şu listeden: ${SPACE_TYPES.join(', ')}. Hiçbiri uymuyorsa boş dizi.
- "Kentsel Tasarım" SADECE birden çok yapıyı kapsayan meydan/masterplan/kamusal açık alan fotoğraflarında kullanılır. TEK bir binanın dış cephesini görüyorsan Kentsel Tasarım DEME; binanın İŞLEVİNİ tahmin et (otel mi, okul mu, ofis mi, konut mu).
- Dış cephe fotoğrafında işlevden emin olamıyorsan 2-3 aday yaz, tek bir tahminde ısrar etme.
- "discipline": SADECE şunlardan biri, emin değilsen null: ${DISCIPLINES.join(', ')}
- "materials": fotoğrafta AÇIKÇA görünen malzemeler, SADECE şu listeden: ${MATERIALS.join(', ')}
- "products": fotoğrafta gördüğün TAŞINABİLİR ürünler. Kategori SADECE şu listeden olmalı: ${PRODUCT_CATEGORIES.join(', ')}
- ÖNEMLİ: pencere, kapı, duvar, zemin, tavan, kolon, merdiven, bitki, insan, araç gibi şeyler ÜRÜN DEĞİLDİR; bunları "products" içine YAZMA. Yalnızca gerçekten satın alınabilir bir mobilya/aydınlatma/vitrifiye/kaplama ürünü görüyorsan yaz.
- "confidence": 0 ile 1 arasında, gerçekten ne kadar emin olduğun. Emin değilsen düşük ver.
- Marka veya ürün ADI TAHMİN ETME. Sadece kategori yaz.
- "description": fotoğrafın Türkçe betimlemesi, 2-3 cümle. Neyi gördüğünü mümkün olduğunca AYIRT EDİCİ biçimde anlat: yapı/ürün türü, biçim ve geometri, malzeme, renk, cephe/yüzey karakteri, çevre ve peyzaj, iç/dış mekan, ışık, dönem/üslup. Bu metin veritabanında eşleşme aramak için kullanılacak, o yüzden "güzel bir bina" gibi genel ifadelerden kaçın.`;
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
    subject: 'other',
    isArchitectural: false, spaceType: null, spaceTypes: [], discipline: null,
    materials: [], products: [], description: '',
    // KİMLİK SİNYALLERİ (2026-09-03) — bunlar SONUÇ DEĞİL, yalnızca D1'e karşı çalıştırılacak
    // arama anahtarlarıdır (bkz. src/lib/entityMatch.js dosya başı). Beyaz listeye tabi
    // değildirler çünkü serbest metindir; güvenlik kapısı şudur: hiçbir MİMARLAB kaydıyla
    // eşleşmeyen bir ad sessizce düşer ve hiçbir sonuç üretemez.
    identity: [], visibleText: [], brand: null, model: null, place: { city: null, country: null },
    droppedProducts: [],   // gözlemlenebilirlik: neyin neden atıldığı
  };
  if (!raw || typeof raw !== 'object') return out;

  out.isArchitectural = raw.isArchitectural === true;
  if (raw.subject === 'project' || raw.subject === 'product' || raw.subject === 'other') {
    out.subject = raw.subject;
  } else {
    // Eski/uyumsuz çıktı: konu alanı yoksa mevcut sinyallerden türetilir.
    out.subject = out.isArchitectural ? 'project' : 'other';
  }
  // Serbest metin alanları: uzunluk kelepçesi + adet kelepçesi. Model çok uzun bir "ad"
  // uydurursa (halüsinasyon) bu, sorgu metnini ve token sözlüğünü şişirmemeli.
  if (Array.isArray(raw.identity)) {
    for (const g of raw.identity.slice(0, 6)) {
      if (!g || typeof g !== 'object') continue;
      const name = typeof g.name === 'string' ? g.name.trim().slice(0, 120) : '';
      if (name.length < 3) continue;
      const conf = Number(g.confidence);
      out.identity.push({
        name,
        kind: g.kind === 'product' ? 'product' : 'project',
        confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5,
      });
      if (out.identity.length >= 3) break;
    }
  }
  if (Array.isArray(raw.visibleText)) {
    for (const t of raw.visibleText.slice(0, 12)) {
      if (typeof t !== 'string') continue;
      const s = t.trim().slice(0, 80);
      if (s.length < 2 || out.visibleText.includes(s)) continue;
      out.visibleText.push(s);
      if (out.visibleText.length >= 8) break;
    }
  }
  if (typeof raw.brand === 'string' && raw.brand.trim()) out.brand = raw.brand.trim().slice(0, 80);
  if (typeof raw.model === 'string' && raw.model.trim()) out.model = raw.model.trim().slice(0, 80);
  if (raw.place && typeof raw.place === 'object') {
    if (typeof raw.place.city === 'string' && raw.place.city.trim()) out.place.city = raw.place.city.trim().slice(0, 60);
    if (typeof raw.place.country === 'string' && raw.place.country.trim()) out.place.country = raw.place.country.trim().slice(0, 60);
  }
  // GERÇEK BULGU (20 görsellik ölçüm, 2026-09-02): tek bir mekan türü istemek proje isabetini
  // 5/11'de tıkıyordu. Kaçırmaların YARISI dış cephe fotoğraflarında "Kentsel Tasarım"a
  // düşmekti (YKKS, Sosyal Sigortalar, Grand Tarabya) — model tek bir binanın cephesini
  // kentsel ölçek sanıyor. Artık sıralı ADAY LİSTESİ isteniyor ve arama adayların HEPSİNDE
  // yapılıyor; `spaceType` (ilk aday) geriye dönük uyumluluk için korunuyor.
  const rawTypes = Array.isArray(raw.spaceTypes) ? raw.spaceTypes
    : (typeof raw.spaceType === 'string' ? [raw.spaceType] : []);
  for (const t of rawTypes) {
    if (typeof t === 'string' && PROJECT_GROUP_OPTIONS.includes(t) && !out.spaceTypes.includes(t)) {
      out.spaceTypes.push(t);
    }
    if (out.spaceTypes.length >= 3) break;
  }
  out.spaceType = out.spaceTypes[0] || null;
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
  // 700 karakter (eski 400): betimleme artık yalnızca kullanıcıya gösterilen bir cümle değil,
  // ANLAMSAL ARAMANIN SORGU METNİ (bkz. src/lib/visualIndex.js) — ayırt edici ayrıntıyı kesmemek
  // için sınır yükseltildi, yine de sınırsız değil (token maliyeti + gürültü).
  if (typeof raw.description === 'string') out.description = raw.description.trim().slice(0, 700);
  return out;
}

// analyzeImage — TEK vision çağrısı. Görsel Uint8Array olarak verilir (Workers AI `image` alanı
// bayt dizisi bekler).
function toBase64(bytes) {
  let bin = '';
  const CH = 0x8000; // parça parça — tek seferde apply çok büyük diziyle yığını taşırır
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}

// analyzeImage — TEK başarılı vision çağrısı. Adaylar sırayla denenir; biri lisans/biçim hatası
// verirse sıradakine geçilir ve HANGİSİNİN çalıştığı döndürülür (gözlemlenebilirlik).
export async function analyzeImage(env, bytes, timeoutMs, mime) {
  const prompt = buildPrompt();
  const b64 = toBase64(bytes);
  const errors = [];
  for (const cand of VISION_CANDIDATES) {
    try {
      const result = await Promise.race([
        env.AI.run(cand.model, cand.build(b64, prompt, bytes, mime || 'image/jpeg')),
        new Promise((_, rej) => setTimeout(() => rej(new Error('vision timeout')), timeoutMs)),
      ]);
      const text = result && (result.response ?? result.description ?? result);
      const parsed = parseJsonLoose(typeof text === 'string' ? text : JSON.stringify(text));
      if (!parsed) { errors.push(`${cand.model}: JSON çözülemedi`); continue; }
      const out = normalizeVision(parsed);
      out.model = cand.model;
      return out;
    } catch (err) {
      errors.push(`${cand.model}: ${err && err.message ? err.message : err}`);
    }
  }
  const e = new Error('vision: hiçbir model yanıt vermedi');
  e.details = errors;
  throw e;
}
