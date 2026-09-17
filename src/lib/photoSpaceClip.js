// FOTOĞRAF sayfası — GÖRSEL BAŞINA, ANLIK mekan sinyali: CLIP sıfır-atış (zero-shot) sınıflandırma.
// (kullanıcı isteği, 2026-09-18 beşinci tur: "Künye fallbackini neden kaldırdın? ... arama
// filtreleri için en doğru ve en çok sonuç için gereken en iyi sistemi kur.")
//
// ============================================================================================
// NEDEN BU DOSYA VAR — ÖLÇÜLEN DURUM
// ============================================================================================
// Künye ikincil sonucu kaldırıldıktan sonra filtreler neredeyse BOŞ kaldı: canlıda 11.058 görselin
// yalnızca 275'i (%2,5) etiketliydi ("Tuvalet & Banyo": 3 sonuç) — çünkü tek kaynak vision-LLM
// etiketiydi ve o tur saatte ~280 görsel işliyordu. Künyeyi geri koymak çözüm değildi; ÖLÇÜLDÜ
// (761 projenin açıklaması + 11.058 görsel): künye bir GÖRSEL seçemiyor —
//     sınıf               görsel kanıtı zayıf + künye EŞLEŞİYOR    künye eşleşmiyor
//     Tuvalet & Banyo     %50 isabet                              %25
//     Mutfak              %40                                     %25
//     Resepsiyon          %42                                     %21
//     Bahçe               fark yok                                fark yok
//     Çalışma Odası       %78                                     %45      <- tek anlamlı kazanç
// Yani künye yalnızca PROJE TİPİYLE örtüşen sınıfta ("Ofis" projesi <-> çalışma alanı) ve yalnızca
// görsel kanıtıyla BİRLİKTE işe yarıyor (bkz. CLIP_KUNYE_MIN).
//
// Eksik olan, künyenin yapamadığı şeydi: GÖRSEL SEVİYESİNDE ikinci bir sinyal. O sinyal sitede
// ZATEN VAR: görsel arama dizini her proje görselinin CLIP (ViT-B/32) embedding'ini tutuyor (bkz.
// src/lib/imageEmbedIndex.js). CLIP'in metin kodlayıcısı aynı uzaya yazdığı için "a photo of a
// bathroom" cümlesinin vektörü ile görsel vektörünün kosinüsü o görselin banyo olma olasılığını
// verir. Cümle vektörleri SABİT olduğundan bir kez offline üretilir (bkz.
// scripts/build-photo-space-clip-prompts.py -> photoSpaceClipVectors.js); Worker yalnızca nokta
// çarpımı yapar — AI çağrısı YOK, maliyet YOK, yeni yüklenen görselde de ANINDA çalışır (embedding'i
// tarayıcı yükleme anında üretip dizine ekliyor).
//
// ÖLÇÜLEN İSABET (11.058 görselin tamamında, sınıf başına 48'lik gözle etiketli örneklem —
// scripts/photo-space-gold.json): aşağıdaki CLIP_STRONG_MIN eşiklerinde sınıf başına ~%85-95.
// Çizim tespiti (_drawing >= 0.6): 72/72. Eşikler TAHMİN DEĞİL, o örneklemden okundu; sınıf başına
// farklıdır çünkü olasılık kütlesi sınıftan sınıfa farklı dağılıyor ("Oturma Odası" 0.40'ta bile
// %94 isabetli, "Resepsiyon" genel ticari iç mekanların mıknatısı olduğundan 0.75 istiyor).
//
// ROLÜ: vision-LLM etiketinin YERİNE geçmez. LLM bir görsele bakmışsa hüküm ONUNDUR; CLIP o zaman
// yalnızca sıralamada "çifte onay" olarak kullanılır. LLM henüz bakmamışsa (yeni yükleme, süren
// tur) CLIP güçlü eşleşmeleri sonuç üretir — böylece filtreler hiçbir zaman boş kalmaz.
// Bkz. src/routes/photos.js#spaceTier.
//
// SAF MODÜL: env/KV/D1'e dokunmaz (betik ve testler de kullanır).
import {
  CLIP_PROMPT_CLASSES, CLIP_PROMPT_CLASS_OF, CLIP_PROMPT_VECTORS_B64, CLIP_PROMPT_DIM, CLIP_PROMPT_SOURCE_SHA,
} from './photoSpaceClipVectors.js';

export { CLIP_PROMPT_SOURCE_SHA, CLIP_PROMPT_CLASSES };

// CLIP'in eğitimdeki logit ölçeği (exp(4.6052) = 100) — softmax sıcaklığı.
export const CLIP_LOGIT_SCALE = 100;
export const CLIP_DRAWING_CLASS = '_drawing';
// Çizim: bu olasılığın üstündeki görsel, LLM henüz bakmamışsa bile sayfada GÖSTERİLMEZ (72/72).
export const CLIP_DRAWING_MIN = 0.6;
// İpucu olarak saklanacak en düşük olasılık (altı gürültü; havuz JSON'unu şişirmesin).
export const CLIP_HINT_FLOOR = 0.2;

// GÜÇLÜ eşik — LLM bakmamış bir görselin TEK BAŞINA sonuç üretmesi için (sınıfın en olası sınıf
// olması da şart). Gözle etiketli örneklemden: bu eşikte isabet ~%85-95.
export const CLIP_STRONG_MIN = {
  'Oturma Odası': 0.40, 'Mutfak': 0.60, 'Yatak Odası': 0.60, 'Tuvalet & Banyo': 0.80,
  'Çalışma Odası': 0.50, 'Koridor': 0.50, 'Merdiven': 0.55, 'Balkon': 0.75,
  'Bahçe': 0.60, 'Havuz': 0.60, 'Resepsiyon': 0.75, 'Depo': 0.85,
};
// KÜNYE DESTEKLİ eşik — görsel kanıtı orta düzeyde AMA projenin künyesi o mekanı anıyorsa.
// YALNIZCA ölçümün desteklediği sınıflarda tanımlıdır (dosya başındaki tablo): bir sınıf burada
// yoksa künye o sınıfta sonuç ÜRETMEZ. Yeni bir sınıf eklemeden önce aynı ölçümü yapın.
export const CLIP_KUNYE_MIN = { 'Çalışma Odası': 0.25 };
// ÇİFTE ONAY — LLM etiketiyle aynı mekanı CLIP de destekliyorsa (sıralamada öne alınır).
export const CLIP_AGREE_MIN = 0.25;

let decoded = null;
function promptMatrix() {
  if (decoded) return decoded;
  const bin = atob(CLIP_PROMPT_VECTORS_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const q = new Int16Array(bytes.buffer, 0, bytes.length / 2);
  const dim = CLIP_PROMPT_DIM;
  const rows = q.length / dim;
  // Float32'ye BİRİM uzunlukta açılır (nicemleme yuvarlaması normu hafifçe bozar; düzeltilir).
  const mat = new Float32Array(q.length);
  for (let r = 0; r < rows; r++) {
    let n = 0;
    for (let d = 0; d < dim; d++) { const v = q[r * dim + d]; n += v * v; }
    n = Math.sqrt(n) || 1;
    for (let d = 0; d < dim; d++) mat[r * dim + d] = q[r * dim + d] / n;
  }
  decoded = { mat, rows, dim, classOf: CLIP_PROMPT_CLASS_OF, classes: CLIP_PROMPT_CLASSES };
  return decoded;
}

/**
 * TEK bir görsel vektörü (dizindeki int8 satır ya da float dizi) -> sınıf başına olasılık.
 * Alt-kavram cümleleri üzerinde softmax(100·cos), sonra sınıf başına TOPLAM: bir sınıf, alt
 * kavramlarının BİRLEŞİMİDİR ("a toilet" ∪ "a bathtub" ∪ ... = Tuvalet & Banyo).
 * @returns {Float64Array} CLIP_PROMPT_CLASSES ile aynı sırada
 */
export function clipClassProbs(row) {
  const { mat, rows, dim, classOf, classes } = promptMatrix();
  let norm = 0;
  for (let d = 0; d < dim; d++) norm += row[d] * row[d];
  norm = Math.sqrt(norm);
  const out = new Float64Array(classes.length);
  if (!norm || !Number.isFinite(norm)) return out;
  const logits = new Float64Array(rows);
  let max = -Infinity;
  for (let r = 0; r < rows; r++) {
    let dot = 0;
    const off = r * dim;
    for (let d = 0; d < dim; d++) dot += row[d] * mat[off + d];
    const l = CLIP_LOGIT_SCALE * dot / norm;
    logits[r] = l;
    if (l > max) max = l;
  }
  let sum = 0;
  for (let r = 0; r < rows; r++) { logits[r] = Math.exp(logits[r] - max); sum += logits[r]; }
  for (let r = 0; r < rows; r++) out[classOf[r]] += logits[r] / sum;
  return out;
}

/**
 * Olasılıkları havuzda saklanacak KOMPAKT ipucuna indirger:
 *   { t: <en olası sınıf>, d?: <çizim olasılığı>, s?: [[etiket, olasılık], ...] }
 * `s` yalnızca ARANABİLİR etiketleri (çeldiriciler değil) ve yalnızca CLIP_HINT_FLOOR üstünü taşır.
 */
export function clipHintFromProbs(probs) {
  const classes = CLIP_PROMPT_CLASSES;
  let top = 0;
  for (let i = 1; i < probs.length; i++) if (probs[i] > probs[top]) top = i;
  const hint = { t: classes[top] };
  const s = [];
  for (let i = 0; i < probs.length; i++) {
    const name = classes[i];
    const p = Math.round(probs[i] * 100) / 100;
    if (name === CLIP_DRAWING_CLASS) { if (p >= CLIP_HINT_FLOOR) hint.d = p; continue; }
    if (name.startsWith('_')) continue;
    if (p >= CLIP_HINT_FLOOR) s.push([name, p]);
  }
  if (s.length) { s.sort((a, b) => b[1] - a[1]); hint.s = s; }
  return hint;
}

export function clipHintForRow(row) {
  return clipHintFromProbs(clipClassProbs(row));
}

// ---- İpucunu OKUYAN yardımcılar (src/lib/photoPool.js + src/routes/photos.js) ----
export function clipProbOf(hint, space) {
  if (!hint || !Array.isArray(hint.s)) return 0;
  const hit = hint.s.find(e => e[0] === space);
  return hit ? Number(hit[1]) || 0 : 0;
}
export function clipIsDrawing(hint) {
  return !!(hint && Number(hint.d) >= CLIP_DRAWING_MIN);
}
/** LLM'in bakmadığı görsel için: 'strong' | 'kunye' | null. */
export function clipVerdict(hint, space, kunyeHasSpace) {
  if (!hint) return null;
  const p = clipProbOf(hint, space);
  if (!p) return null;
  if (hint.t === space && p >= (CLIP_STRONG_MIN[space] ?? 1.1)) return 'strong';
  const k = CLIP_KUNYE_MIN[space];
  if (kunyeHasSpace && k != null && hint.t === space && p >= k) return 'kunye';
  return null;
}

// Dizin anahtarı <-> havuz URL'si eşlemesi. Dizini İKİ yol yazıyor: offline betik MUTLAK adres
// ("https://mimarlab.com/projects/x.webp", bkz. build-image-embeddings.py#resolve_image_url),
// tarayıcı ise yüklemenin döndürdüğü yolu ("/media/u/..", bkz. proje-ekle.html). projects.images[]
// de üç biçimde olabilir (image-cdn.js dosya başı). Hepsi AYNI kanonik anahtara iner: site kökü ve
// baştaki eğik çizgi atılmış yol.
export function canonicalImageKey(u) {
  let s = String(u || '').trim();
  s = s.replace(/^https?:\/\/(www\.)?mimarlab\.com/i, '');
  s = s.replace(/[?#].*$/, '');
  return s.replace(/^\/+/, '');
}
