// FOTOĞRAF sayfasının (bkz. /fotograf, kullanıcı isteği 2026-09-17) mekan (Oturma Odası/Mutfak/
// Yatak Odası ...) SINIFLANDIRMASI — TEK bir görsel alır, src/lib/visionAnalyze.js#
// VISION_CANDIDATES'in AYNI model kademesini (lisans kapısı olmayan vision-LLM/Image-to-Text
// modelleri, ilk çalışan kullanılır) kullanır ama tamamen AYRI, KÜÇÜK bir prompt/şema ile:
// visionAnalyze.js'in "identity/visibleText/brand/products/description" alanlarının hiçbiri burada
// gerekmiyor (o alanlar TERS GÖRSEL ARAMA içindir; bu modül D1'deki KAYITLI bir proje görselinin
// İÇİNDE hangi mekanın göründüğünü soruyor). toBase64/parseJsonLoose/VISION_CANDIDATES paylaşılır,
// kopyalanmaz.
//
// 2026-09-17 İKİNCİ TUR (kullanıcı isteği madde 11: "Filtreleme özelliğini yapay zekayı
// kullanarak geliştir"): prompt artık her etiketin TANIMINI da taşıyor (photo-space-taxonomy.js#
// PHOTO_SPACE_TAXONOMY.description) ve etiket başına GÜVEN puanı ister — düşük güvenli tahminler
// atılır (PRODUCT_CONFIDENCE_MIN'in visionAnalyze.js'teki AYNI gerekçesi: model "uydurmak" yerine
// düşük puan verir, biz eleriz). Fotoğraf/çizim ayrımı da prompta açıkça yazıldı: son üç etiket
// (plan/kesit/cephe ÇİZİMİ) bir fotoğrafa asla verilmemeli, bir çizime de mekan etiketi
// verilmemeli.
//
// normalizeSpaces — modelin DÖNDÜRDÜĞÜ HER ŞEY PHOTO_SPACE_OPTIONS listesine karşı süzülür;
// listede olmayan bir etiket sessizce düşer, model kendi kategorisini UYDURAMAZ.
import { VISION_CANDIDATES, parseJsonLoose, toBase64 } from './visionAnalyze.js';
import photoSpaceTaxonomyJs from '../../photo-space-taxonomy.js';

const { PHOTO_SPACE_OPTIONS, PHOTO_SPACE_TAXONOMY, PHOTO_SPACE_LABELS } = photoSpaceTaxonomyJs;

// Bir etiketin kabul edilmesi için gereken en düşük güven. Modeller güveni genelde 0.6-0.95
// bandında veriyor; 0.45 "emin değilim ama olabilir" tahminlerini eler, "ikincil ama gerçek"
// etiketleri (ör. mutfak+yemek alanı birleşik) korur.
export const SPACE_CONFIDENCE_MIN = 0.45;
const MAX_SPACES = 3;

const DEFINITIONS = PHOTO_SPACE_TAXONOMY.map(t => `- "${t.label}": ${t.description}`).join('\n');

const PROMPT = `Bu bir mimarlık/iç mekan/peyzaj projesine ait bir GÖRSELDİR — gerçek bir fotoğraf
ya da teknik bir çizim (plan/kesit/cephe) olabilir.

GÖREV: Görselde hangi MEKAN(LAR) gösteriliyor? YALNIZCA aşağıdaki listeden seç, en olası önce,
en fazla ${MAX_SPACES} tane. Her seçim için 0-1 arası bir güven puanı ver.

ETİKETLER VE TANIMLARI:
${DEFINITIONS}

KURALLAR:
- Görsel bir FOTOĞRAF ise ("Plan Çizimi"/"Kesit Çizimi"/"Cephe Çizimi") etiketlerini KULLANMA.
- Görsel bir TEKNİK ÇİZİM ise yalnızca o üç çizim etiketinden uygun olanı ver, mekan etiketi VERME.
- Bir binanın DIŞ CEPHESİNİN fotoğrafı (sokaktan çekilmiş bina) hiçbir etikete uymaz — boş dizi ver
  ("Cephe Çizimi" bir fotoğraf DEĞİLDİR).
- Yalnızca bir detay/malzeme çekimi, insan portresi ya da tanınamayan bir açı ise boş dizi ver.
- Listede olmayan bir kelime YAZMA, tahmin UYDURMA; emin olmadığın etikete düşük güven ver.
- İLK etiket görselin ANA KONUSU olsun (karenin çoğunu kaplayan mekan). Arka planda/kapı aralığından
  görünen ya da karede küçük bir köşe kaplayan mekanları EKLEME — yalnızca gerçekten gösterilen mekan.
- Kararsızsan az etiket ver; yanlış bir etiket, eksik bir etiketten daha kötüdür.

Yalnızca şu JSON ile cevap ver, başka hiçbir metin ekleme:
{"spaces": [{"label": string, "confidence": number}]}`;

// Çıktı: [{label, confidence}] — güven de SAKLANIR (2026-09-18 üçüncü tur, kullanıcı isteği: "arama
// kalitesini arttırmak için farklı yollar da bul"): filtre, birincil/yüksek güvenli eşleşmeleri ikincil/
// zayıf olanların ÖNÜNE koyar (bkz. src/routes/photos.js#selectPhotos). Eski düz-string çıktı biçimi
// hâlâ kabul edilir (güven bilinmiyor → null; whitelist yine uygulanır). Whitelist ÇİZİM etiketlerini
// de içerir (PHOTO_SPACE_LABELS) — bir çizimi çizim olarak etiketleyebilmek, onu sonuçlardan
// dışlamanın tek yoludur.
function normalizeSpaces(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.spaces)) return [];
  const out = [];
  for (const s of raw.spaces) {
    const label = typeof s === 'string' ? s.trim() : (s && typeof s.label === 'string' ? s.label.trim() : '');
    const conf = typeof s === 'string' ? null : Number(s && s.confidence);
    if (!PHOTO_SPACE_LABELS.includes(label) || out.some(o => o.label === label)) continue;
    if (Number.isFinite(conf) && conf < SPACE_CONFIDENCE_MIN) continue;
    out.push({ label, confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : null });
    if (out.length >= MAX_SPACES) break;
  }
  return out;
}

// classifyPhotoSpace — TEK görsel, TEK sınıflandırma. bytes: Uint8Array (R2'den/CDN'den indirilmiş
// ham görsel). Adaylar sırayla denenir (bkz. VISION_CANDIDATES); hiçbiri yanıt vermezse fırlatır —
// çağıran (scripts/photo-space-classify-backfill.mjs) bunu "atla, bir sonrakine geç" olarak ele
// alır, tek bir görselin başarısız olması turu durdurmaz.
// context (2026-09-18, kullanıcı isteği: "Arama motoru sonuçlarını proje künyelerini de kullanarak
// geliştir"): projenin KÜNYESİ ({title, discipline, category, type, description}) prompta bağlam
// olarak eklenir — "Hamam" başlıklı projede bir ıslak hacim "Tuvalet & Banyo"ya, "Ofis" grubundaki bir
// çalışma alanı "Çalışma Odası"na daha güvenle düşer. Bağlam KARAR DEĞİL ipucudur: model yine
// yalnızca GÖRDÜĞÜNÜ etiketler (prompt bunu açıkça söyler), whitelist ve güven eşiği aynen uygulanır.
export function buildContextNote(context) {
  if (!context || typeof context !== 'object') return '';
  const parts = [];
  if (context.title) parts.push(`Proje adı: ${String(context.title).slice(0, 120)}`);
  const tax = [].concat(context.discipline || [], context.category || [], context.type || []).filter(Boolean);
  if (tax.length) parts.push(`Tür/Tip/Grup: ${tax.slice(0, 8).join(', ')}`);
  if (context.description) parts.push(`Açıklama: ${String(context.description).replace(/\s+/g, ' ').slice(0, 400)}`);
  if (!parts.length) return '';
  return `\n\nBAĞLAM (projenin künyesi — yalnızca ipucu, kararı GÖRSELE göre ver; künyede "banyo" geçiyor
diye banyo görünmeyen bir kareyi banyo etiketleme):\n${parts.join('\n')}`;
}

export async function classifyPhotoSpace(env, bytes, timeoutMs, mime, context) {
  const b64 = toBase64(bytes);
  const prompt = PROMPT + buildContextNote(context);
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
      return { spaces: normalizeSpaces(parsed), model: cand.model };
    } catch (err) {
      errors.push(`${cand.model}: ${err && err.message ? err.message : err}`);
    }
  }
  const e = new Error('photo-space: hiçbir model yanıt vermedi');
  e.details = errors;
  throw e;
}

// ARAMA KUTUSUNDAKİ SERBEST METNİ BİR ETİKETE EŞLE (kullanıcı isteği madde 11) — kullanıcı
// "salon", "çocuk odası", "wc", "kat planı" gibi listede birebir geçmeyen bir şey yazdığında metin
// modeli (aiProvider.js#callOnce, JSON Mode) hangi etiketin kastedildiğini söyler. Çıktı yine
// whitelist'ten geçer; hiçbiri uymuyorsa null. Vision modeli DEĞİL, metin modeli: görsel yok,
// yalnızca kısa bir sorgu var — AI_MODEL (llama-3.3-70b) bunun için hem daha isabetli hem ucuz.
export function spaceQuerySystemPrompt() {
  return `Sen bir mimarlık fotoğraf arşivinin arama yardımcısısın. Kullanıcının Türkçe (ya da İngilizce)
arama metnini aşağıdaki SABİT mekan etiketlerinden EN uygun olanına eşle. Hiçbiri gerçekten uymuyorsa
null döndür — zorla eşleme yapma.

ETİKETLER VE TANIMLARI:
${DEFINITIONS}

Yalnızca JSON döndür: {"space": <etiket ya da null>}`;
}
export const SPACE_QUERY_SCHEMA = {
  name: 'photo_space_query',
  schema: {
    type: 'object',
    properties: { space: { type: ['string', 'null'], enum: [...PHOTO_SPACE_OPTIONS, null] } },
    required: ['space'],
    additionalProperties: false,
  },
};
export function normalizeQuerySpace(parsed) {
  const v = parsed && typeof parsed.space === 'string' ? parsed.space.trim() : null;
  return v && PHOTO_SPACE_OPTIONS.includes(v) ? v : null;
}

export { PHOTO_SPACE_OPTIONS, PHOTO_SPACE_TAXONOMY };
