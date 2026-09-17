// FOTOĞRAF sayfasının (bkz. /fotograf, kullanıcı isteği 2026-09-17) mekan (Oturma Odası/Mutfak/
// Yatak Odası ...) SINIFLANDIRMASI — TEK bir görsel alır, src/lib/visionAnalyze.js#
// VISION_CANDIDATES'in AYNI model kademesini (lisans kapısı olmayan vision-LLM/Image-to-Text
// modelleri, ilk çalışan kullanılır) kullanır ama tamamen AYRI, KÜÇÜK bir prompt/şema ile:
// visionAnalyze.js'in "identity/visibleText/brand/products/description" alanlarının hiçbiri burada
// gerekmiyor (o alanlar TERS GÖRSEL ARAMA içindir; bu modül D1'deki KAYITLI bir proje görselinin
// İÇİNDE hangi mekanın göründüğünü soruyor). toBase64/parseJsonLoose/VISION_CANDIDATES paylaşılır,
// kopyalanmaz.
//
// ============================================================================================
// PROMPT v2 (2026-09-18 beşinci tur, kullanıcı isteği: "arama filtreleri için en doğru ve en çok
// sonuç için gereken en iyi sistemi kur") — KÖK NEDEN CANLI VERİDE ÖLÇÜLDÜ
// ============================================================================================
// v1 promptu modele YALNIZCA kullanıcının 15 etiketini veriyordu. Canlıda etiketlenen ilk 282
// görselin neredeyse TAMAMI 2-3 etiket aldı, boş dizi HİÇ dönmedi: Ankara Cumhuriyet Müzesi'nin
// cephe fotoğrafları "Resepsiyon + Çalışma Odası + Bahçe", Beyazıt Meydanı'nın hava fotoğrafı
// "Bahçe + Resepsiyon" oldu. Aynı kareler, listesinde "Dış Cephe" bulunan ilk turda DOĞRU
// etiketlenmişti — yani hata modelin görmemesi değil, kapalı listenin onu en yakın etikete
// ZORLAMASIYDI. "Alakasız sonuç" şikâyetinin künye ikincil sonucundan sonraki İKİNCİ kaynağı buydu.
//
// v2 üç şeyi değiştirir:
//   1. ÖNCE SAHNE TÜRÜ ("scene"): iç mekan / dış mekan / dış cephe / çizim / detay. Dış cephe ve
//      detay karelerine mekan etiketi verilmez — model kararını iki adımda verir.
//   2. ÇELDİRİCİ ETİKETLER (photo-space-taxonomy.js#PHOTO_SPACE_DISTRACTORS): "Dış Cephe",
//      "Restoran / Kafe", "Sergi / Müze", "Genel İç Mekan"... Modelin "bu aranan mekanlardan biri
//      değil" diyebileceği bir yer. Bunlar da saklanır ama hiçbir yerde aranmaz/gösterilmez.
//   3. En fazla 2 etiket (3 değil) ve "ana konu" vurgusu.
//
// SAKLAMA BİÇİMİ v2: image_spaces[url] = { v: 2, scene, spaces: [{label, confidence}] }.
// `v` alanı BİLEREK var: v1 promptunun ürettiği satırlar (düz dizi) GÜVENİLMEZDİR ve havuz onları
// "AI henüz bakmadı" sayar (bkz. src/lib/photoPool.js#normalizeStoredSpaces); etiketleme betiği de
// v2 olmayan her girdiyi YENİDEN işler — `--force` gerekmeden.
//
// normalizeSpaces — modelin DÖNDÜRDÜĞÜ HER ŞEY PHOTO_SPACE_AI_LABELS listesine karşı süzülür;
// listede olmayan bir etiket sessizce düşer, model kendi kategorisini UYDURAMAZ.
import { VISION_CANDIDATES, parseJsonLoose, toBase64 } from './visionAnalyze.js';
import photoSpaceTaxonomyJs from '../../photo-space-taxonomy.js';

const {
  PHOTO_SPACE_OPTIONS, PHOTO_SPACE_TAXONOMY, PHOTO_SPACE_LABELS, PHOTO_SPACE_DRAWING_LABELS,
  PHOTO_SPACE_DISTRACTORS, PHOTO_SPACE_DISTRACTOR_LABELS, PHOTO_SPACE_AI_LABELS,
} = photoSpaceTaxonomyJs;

export const SPACE_LABEL_VERSION = 2;
// Bir etiketin kabul edilmesi için gereken en düşük güven. Modeller güveni genelde 0.6-0.95
// bandında veriyor; 0.45 "emin değilim ama olabilir" tahminlerini eler, "ikincil ama gerçek"
// etiketleri (ör. mutfak+yemek alanı birleşik) korur.
export const SPACE_CONFIDENCE_MIN = 0.45;
const MAX_SPACES = 2;
export const SPACE_SCENES = ['ic_mekan', 'dis_mekan', 'dis_cephe', 'cizim', 'detay'];

const def = (t) => `- "${t.label}": ${t.description}`;
const SEARCHABLE_DEFS = PHOTO_SPACE_TAXONOMY.filter(t => t.kind !== 'drawing').map(def).join('\n');
const DRAWING_DEFS = PHOTO_SPACE_TAXONOMY.filter(t => t.kind === 'drawing').map(def).join('\n');
const DISTRACTOR_DEFS = PHOTO_SPACE_DISTRACTORS.map(def).join('\n');

const PROMPT = `Bu bir mimarlık / iç mimarlık / peyzaj projesine ait bir GÖRSELDİR. Görevin, görselin ANA
KONUSU olan mekanı sınıflandırmak.

ADIM 1 — "scene": görselin TÜRÜ. Şunlardan TAM BİRİ:
- "ic_mekan": bir İÇ MEKANIN fotoğrafı (fotogerçekçi iç mekan render'ı da buraya)
- "dis_cephe": karede bir BİNA (ya da binalar, kent dokusu, anıt, köprü, harabe) ana öğe olarak
  DIŞARIDAN görünüyor. Önünde bahçe, çim, ağaç, havuz, meydan ya da otopark OLSA BİLE bina ana
  öğeyse "dis_cephe"dir. Hava/drone fotoğrafı ve kent silüeti HER ZAMAN "dis_cephe"dir.
- "dis_mekan": bina ana öğe DEĞİL; kare bir bahçenin, avlunun, havuzun, terasın ya da balkonun
  İÇİNDEN / ona odaklanarak çekilmiş (bitkiler, su yüzeyi, dış mekan mobilyası kareyi dolduruyor).
- "cizim": plan, kesit, görünüş, vaziyet planı, diyagram, eskiz, aksonometri, pafta
- "detay": malzeme/doku, mobilya, aydınlatma yakın çekimi; maket; insan portresi; logo/yazı

ADIM 2 — "spaces": aşağıdaki listelerden en olası etiket; GEREKİRSE ikinci bir etiket (en fazla
${MAX_SPACES}). Her etiket için 0-1 arası güven ver. Karelerin ÇOĞUNDA doğru cevap TEK etikettir.

ARANAN MEKANLAR:
${SEARCHABLE_DEFS}

ÇİZİM ETİKETLERİ (yalnızca scene="cizim" ise):
${DRAWING_DEFS}

DİĞER (görsel bunlardan biriyse BUNU yaz — yukarıdaki mekanlara ZORLA UYDURMA):
${DISTRACTOR_DEFS}

KURALLAR:
- scene="dis_cephe" ise tek etiket "Dış Cephe"dir. Bir binanın önündeki çim ya da kaldırım onu
  "Bahçe" YAPMAZ; binanın girişi onu "Resepsiyon" YAPMAZ; pencereleri onu "Çalışma Odası" YAPMAZ;
  cephedeki balkonlar onu "Balkon" YAPMAZ.
- scene="detay" ise tek etiket "Detay"dır.
- scene="cizim" ise YALNIZCA bir çizim etiketi ver, mekan etiketi VERME.
- İLK etiket karenin ÇOĞUNU kaplayan, fotoğrafın asıl gösterdiği mekandır.
- İKİNCİ etiketi YALNIZCA o mekan da karenin en az üçte birini kaplıyorsa ver (ör. tek hacimde
  mutfak + oturma alanı). Arka planda, kapı aralığından, camın ardında ya da karenin bir köşesinde
  görünen mekanı EKLEME. Bir odadan görünen koridor "Koridor", salondan görünen merdiven
  "Merdiven", ofisteki bekleme koltuğu "Resepsiyon" DEĞİLDİR.
- "Resepsiyon" için karede bir karşılama BANKOSU ya da belirgin bir lobi/bekleme düzeni olmalı;
  "Koridor" için karenin ana konusu geçiş hacminin kendisi olmalı.
- Hiçbiri tam uymuyorsa "Genel İç Mekan" ya da uygun DİĞER etiketini seç; listede olmayan bir
  kelime YAZMA.
- Yanlış bir etiket, eksik bir etiketten daha kötüdür.

Yalnızca şu JSON ile cevap ver, başka hiçbir metin ekleme:
{"scene": string, "spaces": [{"label": string, "confidence": number}]}`;

// Çıktı: [{label, confidence}] — model sırasıyla, whitelist'ten geçmiş. Çeldirici etiketler de
// KORUNUR (sıra bilgisi onlarla anlamlı: "Dış Cephe" birinci, "Bahçe" ikinci gelen bir karede Bahçe
// BİRİNCİL DEĞİLDİR — bkz. photoPool.js#normalizeStoredSpaces, birincillik çeldiriciler ATILMADAN
// önce belirlenir). Eski düz-string çıktı biçimi hâlâ kabul edilir (güven bilinmiyor -> null).
export function normalizeSpaces(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.spaces)) return [];
  const out = [];
  for (const s of raw.spaces) {
    const label = typeof s === 'string' ? s.trim() : (s && typeof s.label === 'string' ? s.label.trim() : '');
    const conf = typeof s === 'string' ? null : Number(s && s.confidence);
    if (!PHOTO_SPACE_AI_LABELS.includes(label) || out.some(o => o.label === label)) continue;
    if (Number.isFinite(conf) && conf < SPACE_CONFIDENCE_MIN) continue;
    out.push({ label, confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : null });
    if (out.length >= MAX_SPACES) break;
  }
  return out;
}

// SAHNE TUTARLILIĞI — modelin iki adımı birbirini tutmuyorsa SAHNE kazanır (ölçüm: v1'in hataları
// tam olarak "dış cephe karesine iç mekan etiketi" sınıfındaydı; sahne kararı etiket kararından
// daha güvenilir). Çizim/dış cephe/detay sahnesinde aranabilir mekan etiketi TUTULMAZ; fotoğraf
// sahnesinde çizim etiketi tutulmaz.
export function reconcileScene(scene, spaces) {
  const sc = SPACE_SCENES.includes(scene) ? scene : null;
  if (!sc) return { scene: null, spaces };
  const isSearchable = (l) => PHOTO_SPACE_OPTIONS.includes(l);
  const isDrawing = (l) => PHOTO_SPACE_DRAWING_LABELS.includes(l);
  let out = spaces;
  if (sc === 'cizim') {
    out = spaces.filter(s => isDrawing(s.label));
    // Model sahneyi çizim deyip çizim TÜRÜNÜ söylemediyse: sayfadan dışlanması için biri yeter.
    if (!out.length) out = [{ label: 'Cephe Çizimi', confidence: null }];
  } else if (sc === 'dis_cephe' || sc === 'detay') {
    out = spaces.filter(s => !isSearchable(s.label) && !isDrawing(s.label));
  } else {
    out = spaces.filter(s => !isDrawing(s.label));
  }
  return { scene: sc, spaces: out };
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
      const { scene, spaces } = reconcileScene(typeof parsed.scene === 'string' ? parsed.scene.trim() : '', normalizeSpaces(parsed));
      return { scene, spaces, model: cand.model };
    } catch (err) {
      errors.push(`${cand.model}: ${err && err.message ? err.message : err}`);
    }
  }
  const e = new Error('photo-space: hiçbir model yanıt vermedi');
  e.details = errors;
  throw e;
}

// D1'e yazılacak girdi (bkz. dosya başı "SAKLAMA BİÇİMİ v2").
export function storedSpaceEntry(result) {
  return { v: SPACE_LABEL_VERSION, scene: result.scene || null, spaces: result.spaces || [] };
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
${SEARCHABLE_DEFS}

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

export { PHOTO_SPACE_OPTIONS, PHOTO_SPACE_TAXONOMY, PHOTO_SPACE_LABELS, PHOTO_SPACE_DISTRACTOR_LABELS };
