// MİMARLAB görsel arama — GERÇEK GÖRSEL-GÖRSEL (image-to-image) embedding dizini.
//
// ============================================================================================
// NEDEN BU DOSYA VAR (denetim bulgusu, 2026-09-03 — ikinci tur)
// Önceki uygulama (src/lib/visualIndex.js) bge-m3 ile varlığın METİN AÇIKLAMASINI embed ediyordu
// — bu bir görsel embedding DEĞİLDİR, vision modelinin ürettiği Türkçe cümlenin anlamsal
// temsilidir. Kullanıcı bunu AÇIKÇA reddetti: "BGE-M3'ü image embedding modeliymiş gibi kullanmaya
// devam etme." Bu dosya GERÇEK görsel embedding'i (OpenAI CLIP ViT-B/32 görsel kodlayıcısı) tutar.
//
// GERÇEK KISIT (denetlendi, 2026-09-03): Cloudflare Workers AI kataloğunda (resmi docs +
// `wrangler ai models`, 86 model, 10 task kategorisi) görsel embedding/feature-extraction/CLIP
// modeli YOKTUR — yalnızca Text Embeddings, Image Classification (ImageNet-1000 etiketleri, embedding
// DEĞİL), Image-to-Text var. Harici bir API (Jina/Vertex AI/HuggingFace) canlı sorgu-anı embedding'i
// için değerlendirildi ama HEPSİ yeni bir HESAP AÇILMASINI gerektiriyor — bu, Claude'un asla
// yapamayacağı bir eylemdir (kimlik/hesap oluşturma güvenlik kısıtı). Bu yüzden:
//   * BACKFILL (mevcut ~11 bin görsel): offline, bir kerelik, bu oturumda Python + onnxruntime ile
//     `Xenova/clip-vit-base-patch32` (MIT lisanslı openai/CLIP) görsel kodlayıcısının uint8
//     nicemlenmiş ONNX sürümüyle hesaplandı (bkz. scripts/build-image-embeddings.py).
//   * SORGU ANI + YENİ YÜKLEME: Workers CNN çalıştıramadığından ve harici API hesabı açılamadığından,
//     AYNI ONNX modeli TARAYICIDA (onnxruntime-web, kendi barındırılan .wasm+.onnx, CDN YOK) çalışır
//     — image-upload.js'in "türev üretimi tarayıcıda" felsefesiyle BİREBİR aynı desen, yalnızca
//     WebP kodlama yerine CNN ileri geçişi. Maliyet SIFIRDIR (kullanıcının kendi CPU'su).
//
// Bu dosya SAF kalır (env/D1/KV'ye dokunmaz) — hem Worker hem de scripts/*.mjs/py tarafından
// kavramsal olarak paylaşılan bir BİÇİM tanımlar (Python tarafı bu ikili biçimi elle üretir, bkz.
// build-image-embeddings.py dosya başı yorumu — iki taraf FARKLILAŞIRSA paket okunamaz hale gelir).
//
// GÖRSEL DÜZEYİNDE DİZİN, VARLIK DÜZEYİNDE DEĞİL (brief madde 3)
// Bir projenin 16 görseli varsa (MİMARLAB ortalaması) HEPSİ ayrı birer satırdır; sorgu ANINDA
// "bu varlığın en iyi K görseli sorguya ne kadar benziyor" hesaplanıp AĞIRLIKLI birleştirilir
// (aggregateEntityScore) — TEK bir "varlık vektörü" önceden üretip o zenginliği kaybetmiyoruz.
// ============================================================================================

export const IMAGE_EMBED_MODEL = 'Xenova/clip-vit-base-patch32 (vision, uint8)';
export const IMAGE_EMBED_DIM = 512;
export const IMAGE_INDEX_VERSION = 'v1';

export function imageIndexKvKey(type) {
  return `vsearch:imgindex:${type}:${IMAGE_INDEX_VERSION}`;
}

// ---------------------------------------------------------------------------------------------
// NİCEMLEME — src/lib/visualIndex.js#quantizeUnit ile AYNI şema (birim uzunluk + int8×127).
// Python tarafı (build-image-embeddings.py) BİREBİR aynı formülü uyguluyor.
// ---------------------------------------------------------------------------------------------
export function quantizeUnit(vec) {
  const out = new Int8Array(vec.length);
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (!norm || !Number.isFinite(norm)) return out;
  for (let i = 0; i < vec.length; i++) {
    let q = Math.round((vec[i] / norm) * 127);
    if (q > 127) q = 127; else if (q < -127) q = -127;
    out[i] = q;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// PAKET BİÇİMİ (tek ArrayBuffer, visualIndex.js#packIndex ile AYNI dört baytlık başlık deseni):
//   [0..3]   uint32 LE — başlık JSON uzunluğu
//   [4..4+n] UTF-8 JSON — { v, type, dim, model, built,
//                            entities: [{ s: slug, c: bu varlığın satır SAYISI, k: [imageKey,...] }] }
//            entities[] SIRASI, aşağıdaki vektör bloklarının sırasıyla AYNI — varlık başına `c`
//            satır ARDIŞIK olarak yerleşir (entities[0]'ın c satırı, sonra entities[1]'inki, ...).
//            Bu sayede sorgu anında hangi satırın hangi varlığa ait olduğunu bulmak için ekstra
//            bir haritaya gerek yok — yalnızca çalışan bir ofset sayacı yeterli.
//   [4+n..]  int8[] — toplam (Σc) × dim bayt.
// ---------------------------------------------------------------------------------------------
export function packImageIndex(input) {
  const header = JSON.stringify({
    v: IMAGE_INDEX_VERSION, type: input.type, dim: input.dim, model: input.model,
    built: input.built, entities: input.entities,
  });
  const headerBytes = new TextEncoder().encode(header);
  const total = 4 + headerBytes.length + input.vectors.length;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  view.setUint32(0, headerBytes.length, true);
  new Uint8Array(buf, 4, headerBytes.length).set(headerBytes);
  new Int8Array(buf, 4 + headerBytes.length, input.vectors.length).set(input.vectors);
  return buf;
}

/**
 * @returns {{header, dim, entities: Array<{s, c, k, offset}>, vectors: Int8Array,
 *            rowOf: (i:number)=>Int8Array, entityBySlug: Map<string, {offset,count,keys}>}|null}
 */
export function unpackImageIndex(buf) {
  try {
    if (!buf || buf.byteLength < 8) return null;
    const view = new DataView(buf);
    const headerLen = view.getUint32(0, true);
    if (headerLen <= 0 || 4 + headerLen > buf.byteLength) return null;
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, headerLen)));
    const dim = Number(header.dim) || 0;
    const rawEntities = Array.isArray(header.entities) ? header.entities : [];
    if (!dim || !rawEntities.length) return null;
    const vectors = new Int8Array(buf, 4 + headerLen, buf.byteLength - 4 - headerLen);
    const entities = [];
    const entityBySlug = new Map();
    let offset = 0;
    for (const e of rawEntities) {
      const count = Number(e.c) || 0;
      const rec = { s: e.s, c: count, k: e.k || [], offset };
      entities.push(rec);
      entityBySlug.set(e.s, rec);
      offset += count;
    }
    return {
      header, dim, entities, vectors, entityBySlug,
      rowOf: (i) => vectors.subarray(i * dim, (i + 1) * dim),
    };
  } catch {
    return null;
  }
}

// Sorgu vektörü (float) ile dizindeki HER görsel satırı arasında kosinüs. ~11 bin görsel × 512
// boyut ≈ 5,8M çarpma — Worker'da birkaç ms (visualIndex.js#cosineScores'taki AYNI brute-force
// gerekçe: bu ölçekte ayrı bir ANN/Vectorize servisine gerek yok).
export function imageCosineScores(index, queryVec) {
  const { dim, vectors } = index;
  const q = quantizeUnit(queryVec);
  const rows = vectors.length / dim;
  const out = new Float32Array(rows);
  for (let i = 0; i < rows; i++) {
    let dot = 0;
    const off = i * dim;
    for (let d = 0; d < dim; d++) dot += vectors[off + d] * q[d];
    out[i] = dot / (127 * 127);
  }
  return out;
}

// GÖRSEL SKORLARINI VARLIK SKORUNA TOPLA (brief madde 3/4/8, dördüncü tur denetim).
//
// AKTİF FORMÜL: entity_score = max(görsel skorları). Bu, ÖLÇÜLEREK seçildi — "makul göründüğü
// için" değil (bkz. scripts/visual-search-aggregation-ablation.mjs). Önceki sürüm azalan ağırlıklı
// bir top-4 ortalaması kullanıyordu (0.5/0.3/0.15/0.05) — akla yatkın bir gerekçesi vardı ("tek
// tesadüfi yükseğe bağlı kalma" riskini azaltmak) ama HİÇ KARŞILAŞTIRILMAMIŞTI. Gerçek production
// dizini üzerinde "held-out" testiyle (her varlığın kendi görsellerinden biri sorgu olarak ayrılıp
// dizinin geri kalanında arandı, n=1666 proje + n=167 ürün, TÜM uygun varlıklar) ÖLÇÜLDÜĞÜNDE:
//
//   yöntem          proje Top-1 / Top-5      ürün Top-1 / Top-5
//   max             %46,2 / %64,9            %47,9 / %67,7   <- KAZANAN, HER İKİSİNDE de
//   top2_mean       %43,9 / %60,9             %26,3 / %36,5
//   eski (top-4 ağırlıklı)  %40,8 / %58,0     %18,0 / %24,6
//   top3_mean       %38,4 / %55,1             %19,2 / %25,1
//   consistency-bonus %34,8 / %52,7           %33,5 / %55,7
//   mean_all (TÜM görseller) %0,0 / %0,0      %0,0 / %0,0   <- brief'in uyardığı "boğulma" TAM olarak gerçekleşti
//
// max() HEM projede HEM üründe, HEM Top-1'de HEM Top-5'te AÇIKÇA ve TUTARLI biçimde kazandı (ürünte
// Top-1 neredeyse 3 KAT arttı: %18,0 -> %47,9). Sezgisel "outlier riski" gerçek veride tam tersi
// çıktı: bir varlığın FARKLI açı/ışıktaki diğer fotoğraflarını ortalamaya katmak, doğru varlığın
// GÜÇLÜ tek eşleşmesini SEYRELTİYOR — yanlış varlıkların gürültüsünü bastırmıyor. Bu YÜZDEN
// weighted-top-k TERK EDİLDİ. `topScores`/`maxSimilarity`/`top2Average`/`top3Average`/
// `supportingImageCount` alanları GÖZLEMLENEBİLİRLİK için hesaplanmaya devam ediyor (brief madde
// 16: "explainable result") — yalnızca SIRALAMA kararında artık KULLANILMIYOR.
//
// GÜVENLİK AĞI DEĞİŞMEDİ: bu formül yalnızca AŞAMA B'nin (görsel benzerlik) kendi iç skorunu
// belirler; src/routes/visualSearch.js#decideExact hâlâ kimlik (ad) eşleşmesini birincil kapı
// olarak kullanıyor, hasCorroboration hâlâ saf-görsel adayları listeye hiç sokmuyor — max()'a
// geçiş bu iki güvenlik katmanını ATLAMAZ, yalnızca "adayın görsel skoru ne kadar güvenilir"
// sorusuna daha isabetli bir cevap verir.
const SUPPORTING_IMAGE_BAND = 0.05; // maxSimilarity - bu payın içindeki görseller "destekliyor" sayılır

function summarizeEntityRows(rows) {
  // rows: azalan sıralı {s: skor, i: satır indeksi} dizisi (en az 1 eleman garantili çağrılır)
  const scores = rows.map(r => r.s);
  const max = scores[0];
  const top2 = scores.slice(0, 2);
  const top3 = scores.slice(0, 3);
  const supportingImageCount = scores.filter(s => s >= max - SUPPORTING_IMAGE_BAND).length - 1; // max hariç
  return {
    score: max, // AKTİF sıralama skoru — bkz. yukarıdaki ölçüm
    maxSimilarity: max,
    top2Average: top2.reduce((a, b) => a + b, 0) / top2.length,
    top3Average: top3.reduce((a, b) => a + b, 0) / top3.length,
    supportingImageCount: Math.max(0, supportingImageCount),
    bestImageIndex: rows[0].i,
    bestImageId: rows[0].i,
    // Varlık içi 0 tabanlı sıra (bkz. aggregateRowScores'taki not) — galeri sırasıyla birebir.
    bestImageLocalIndex: rows[0].local,
    topScores: scores.slice(0, 4),
  };
}

// Zaten hesaplanmış bir "her satır için skor" dizisini (rows.length uzunluğunda) varlık başına
// toplu skora indirger. aggregateImageIndex (sorgu vektörü) VE post-match "benzerler" hesabı
// (bkz. src/routes/visualSearch.js — eşleşen varlığın en iyi görselinden diğer TÜM görsellere
// kosinüs) AYNI bu fonksiyonu paylaşır — aggregation mantığı TEK yerde.
export function aggregateRowScores(index, rowScores) {
  const out = new Map();
  for (const e of index.entities) {
    if (!e.c) {
      out.set(e.s, { score: 0, maxSimilarity: 0, top2Average: 0, top3Average: 0, supportingImageCount: 0, bestImageIndex: -1, bestImageId: -1, bestImageLocalIndex: -1, topScores: [] });
      continue;
    }
    const rows = [];
    // i: GLOBAL satır indeksi (imageCosineScoresFromRow gibi dizin-geneli çağrılar bunu bekler).
    // local: VARLIK İÇİ sıra (0 tabanlı) — bu, kullanıcıya gösterilen "projenin kaçıncı görseli"
    // bilgisinin tek doğru kaynağıdır. GERÇEK BULGU (2026-09-05, canlı doğrulama): arayüz
    // bestImageIndex'i doğrudan sıra sanıp "Projenin 27970. görseliyle eşleşme" yazıyordu —
    // 27970 dizinin GLOBAL satır numarasıydı. İkisi ayrı alanlarda tutulur.
    for (let i = 0; i < e.c; i++) rows.push({ s: rowScores[e.offset + i], i: e.offset + i, local: i });
    rows.sort((a, b) => b.s - a.s);
    out.set(e.s, summarizeEntityRows(rows));
  }
  return out;
}

/**
 * Tüm dizini tarayıp HER VARLIK için toplu (aggregated) benzerlik skoru üretir.
 * @returns {Map<string, {score:number, bestImageIndex:number, topScores:number[]}>}
 */
export function aggregateImageIndex(index, queryVec) {
  return aggregateRowScores(index, imageCosineScores(index, queryVec));
}

// Dizindeki BİR SATIRIN (belirli bir görselin) diğer tüm görsellerle kosinüsü — "eşleşen varlığa
// GÖRSEL OLARAK benzeyenler" için (bkz. src/lib/visualIndex.js#cosineScoresFromRow'daki AYNI
// gerekçe: eşleşen varlığın vektörü zaten dizinde, ek bir embedding çağrısı GEREKMEZ).
export function imageCosineScoresFromRow(index, rowIdx) {
  const { dim, vectors } = index;
  const rows = vectors.length / dim;
  const out = new Float32Array(rows);
  const base = rowIdx * dim;
  for (let i = 0; i < rows; i++) {
    let dot = 0;
    const off = i * dim;
    for (let d = 0; d < dim; d++) dot += vectors[off + d] * vectors[base + d];
    out[i] = dot / (127 * 127);
  }
  return out;
}
