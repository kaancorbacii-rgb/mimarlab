// FOTOĞRAF sayfasının (bkz. /fotograf, kullanıcı isteği 2026-09-17) mekan (Yatak Odası/Banyo/
// Mutfak vb.) SINIFLANDIRMASI — TEK bir görsel alır, src/lib/visionAnalyze.js#VISION_CANDIDATES'in
// AYNI model kademesini (lisans kapısı olmayan vision-LLM/Image-to-Text modelleri, ilk çalışan
// kullanılır) kullanır ama tamamen AYRI, KÜÇÜK bir prompt/şema ile: visionAnalyze.js'in "identity/
// visibleText/brand/products/description" alanlarının hiçbiri burada gerekmiyor (o alanlar TERS
// GÖRSEL ARAMA — kullanıcının yüklediği bir fotoğrafla D1'deki kayıtları eşleştirme — içindir, bu
// modül ise D1'deki KAYITLI bir proje görselinin İÇİNDE hangi mekanın göründüğünü soruyor). Ayrı
// bir dosya olmasının gerekçesi budur; toBase64/parseJsonLoose/VISION_CANDIDATES paylaşılır,
// kopyalanmaz.
//
// normalizeSpaces — modelin DÖNDÜRDÜĞÜ HER ŞEY photo-space-taxonomy.js#PHOTO_SPACE_OPTIONS
// listesine karşı süzülür (project-taxonomy.js#PROJECT_GROUP_OPTIONS ile AYNI whitelist ilkesi) —
// listede olmayan bir etiket sessizce düşer, model kendi kategorisini UYDURAMAZ.
import { VISION_CANDIDATES, parseJsonLoose, toBase64 } from './visionAnalyze.js';
import photoSpaceTaxonomyJs from '../../photo-space-taxonomy.js';

const { PHOTO_SPACE_OPTIONS } = photoSpaceTaxonomyJs;

const PROMPT = `Bu bir mimarlık/iç mekan/peyzaj projesi fotoğrafıdır. Fotoğrafta HANGİ MEKAN(LAR)
gösteriliyor? SADECE şu listeden seç, en olası önce, en fazla 2 tane: ${PHOTO_SPACE_OPTIONS.join(', ')}.
Fotoğraf bu listedeki hiçbir mekanı NET biçimde göstermiyorsa (ör. tek bir detay/malzeme çekimi,
tanınamayan bir açı, insan portresi) boş dizi ver. TAHMİN UYDURMA — listede olmayan bir kelime
YAZMA. Yalnızca şu JSON şemasıyla cevap ver, başka hiçbir metin ekleme:
{"spaces": string[]}`;

function normalizeSpaces(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.spaces)) return [];
  const out = [];
  for (const s of raw.spaces) {
    if (typeof s !== 'string') continue;
    const trimmed = s.trim();
    if (PHOTO_SPACE_OPTIONS.includes(trimmed) && !out.includes(trimmed)) out.push(trimmed);
    if (out.length >= 2) break;
  }
  return out;
}

// classifyPhotoSpace — TEK görsel, TEK sınıflandırma. bytes: Uint8Array (R2'den/CDN'den indirilmiş
// ham görsel). Adaylar sırayla denenir (bkz. VISION_CANDIDATES); hiçbiri yanıt vermezse fırlatır —
// çağıran (scripts/photo-space-classify-backfill.mjs) bunu "atla, bir sonrakine geç" olarak ele
// alır, tek bir görselin başarısız olması turu durdurmaz.
export async function classifyPhotoSpace(env, bytes, timeoutMs, mime) {
  const b64 = toBase64(bytes);
  const errors = [];
  for (const cand of VISION_CANDIDATES) {
    try {
      const result = await Promise.race([
        env.AI.run(cand.model, cand.build(b64, PROMPT, bytes, mime || 'image/jpeg')),
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

export { PHOTO_SPACE_OPTIONS };
