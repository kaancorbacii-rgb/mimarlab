// MİMARLAB görsel arama — VARLIK (entity) DİZİNİ.
//
// NE İŞE YARAR
// Görsel aramanın birinci sorusu "bu görsele NE BENZİYOR" değil, "bu görsel MİMARLAB'daki HANGİ
// varlık" sorusudur (kullanıcı isteği 2026-09-03 madde 5/26). Bu dosya, o soruyu cevaplayabilmek
// için her proje ve her ürün için ÖNCEDEN üretilmiş bir anlamsal temsil (embedding) tutar; arama
// sırasında yalnızca SORGUNUN temsili üretilir, 1715 projenin temsili yeniden hesaplanmaz.
//
// NEDEN GÖRSEL DEĞİL METİN EMBEDDING'İ (mimari kısıt, ölçüldü)
// Workers AI kataloğunda GÖRSEL embedding modeli (CLIP benzeri) YOKTUR — `wrangler ai models`
// çıktısındaki tüm "Text Embeddings" modelleri (bge-m3, bge-*-en, qwen3-embedding, embeddinggemma,
// plamo) yalnızca METİN alır; görsel alan modeller yalnızca vision-LLM (mistral-small-3.1,
// moondream, llava) ve Image Classification (resnet-50). Ücretli/harici bir CLIP sağlayıcısı
// eklemek kullanıcı tarafından yasaklandı (bkz. wrangler.jsonc dosya başı). Bu yüzden zincir:
//
//     sorgu görseli --vision--> Türkçe betimleme + kimlik/OCR sinyalleri --bge-m3--> vektör
//     MİMARLAB varlığı --(başlık+konum+tür+mimar+açıklama)--> bge-m3 --> vektör
//     eşleşme = kosinüs benzerliği + sözlüksel kimlik eşleşmesi (bkz. src/lib/entityMatch.js)
//
// İki taraf da AYNI uzayda (doğal dil) olduğundan, aynı yapının FARKLI bir fotoğrafı da aynı
// varlığa yakın düşer — piksel benzerliğinin çözemediği problem tam olarak budur (brief 3/6).
//
// DEPOLAMA: D1 DEĞİL, TEK BİR KV NESNESİ
// Dizin arama sırasında BÜTÜN olarak gerekir (her varlıkla kosinüs alınır). D1'de satır başına bir
// vektör tutmak her aramada 1715 satır okumak demekti (brief 15: "her istekte tüm tabloları tarayan
// pahalı sorgular oluşturma"). Bunun yerine tüm dizin TEK bir ikili KV değerine paketlenir:
// 1 KV okuması (edge'de önbellekli) + isolate ömrü boyunca bellekte tutma. D1'e HİÇ dokunulmaz.
//
// PAKET BİÇİMİ (tek ArrayBuffer):
//   [0..3]            uint32 LE  — başlık JSON'unun bayt uzunluğu
//   [4..4+n]          UTF-8 JSON — { v, type, dim, model, built, items: [{s: slug, h: docHash}] }
//   [4+n..]           int8[]     — items.length * dim, satır sırası items ile AYNI
//
// NİCEMLEME (quantization): vektörler önce BİRİM uzunluğa normalize edilir, sonra int8'e
// (×127) yuvarlanır. Böylece kosinüs = iki int8 satırının nokta çarpımı / 127² olur ve dizin
// float32'ye göre 4 kat küçülür (1715 × 1024 × 4B = 7 MB yerine 1,76 MB). Ölçülen doğruluk kaybı
// ihmal edilebilir düzeydedir (int8 nicemleme kosinüsü ~0,001 mertebesinde kaydırır); KV değer
// sınırı 25 MB olduğundan float32 de sığardı, ama her aramada 4 kat fazla bayt çözmenin karşılığı
// yok.
//
// BU DOSYA ORTAK KODDUR: hem Worker (arama + cron) hem de Node (scripts/build-visual-index.mjs)
// tarafından import edilir. Bu yüzden içinde `env`, D1, KV ya da Worker'a özgü hiçbir API YOKTUR —
// yalnızca saf fonksiyonlar + standart Web Crypto/TextEncoder. Belge (doc) üretimi İKİ tarafta da
// birebir aynı olmak ZORUNDA: farklılaşırsa cron, betiğin ürettiği her satırı "değişmiş" sayıp
// sonsuza kadar yeniden embed eder.

export const EMBED_MODEL = '@cf/baai/bge-m3';
export const EMBED_DIM = 1024;

// Dizin sürümü — belge biçimi, model ya da paket düzeni değişince ARTIRILMALI. Eski anahtar
// okunmaz hale gelir, arama sözlüksel/taksonomik yola düşer ve cron dizini yeniden kurar.
export const INDEX_VERSION = 'v1';

export function indexKvKey(type) {
  return `vsearch:index:${type}:${INDEX_VERSION}`;
}

// ---------------------------------------------------------------------------------------------
// BELGE ÜRETİMİ
// Embed edilen metin, varlığın "kimlik kartı"dır. Sıralama önemlidir: bge-m3 baştaki tokenlara
// daha çok ağırlık verir, bu yüzden AD en başta durur. Açıklama kırpılır — bir projenin 3000
// karakterlik künye metnini tamamen embed etmek, ayırt edici olan adı/konumu gürültüde boğar
// (ölçüldü: 600 karakterden sonrası Top-1'i iyileştirmiyor, latency ve token maliyeti artıyor).
// ---------------------------------------------------------------------------------------------
const DOC_DESC_LIMIT = 600;

function clean(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

function jsonList(raw) {
  if (Array.isArray(raw)) return raw.map(clean).filter(Boolean);
  const s = clean(raw);
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map(clean).filter(Boolean);
    } catch { /* düz metin olarak devam */ }
  }
  return s.split(/[·,;]/).map(clean).filter(Boolean);
}

// Ham `projects` satırından (D1 SELECT sonucu) belge üretir.
// GEREKLİ SÜTUNLAR: slug, title, location, location_detail, type, discipline, period,
//                   project_date, description, designer_names (GROUP_CONCAT), office_names.
export function projectDocFromRow(row) {
  const parts = [];
  parts.push(clean(row.title));
  const loc = [clean(row.location), clean(row.location_detail)].filter(Boolean).join(', ');
  if (loc) parts.push(loc);
  const types = jsonList(row.type);
  if (types.length) parts.push(types.join(', '));
  const disc = jsonList(row.discipline);
  if (disc.length) parts.push(disc.join(', '));
  const period = jsonList(row.period);
  if (period.length) parts.push(period.join(', '));
  if (clean(row.project_date)) parts.push(clean(row.project_date));
  const people = [clean(row.designer_names), clean(row.office_names)]
    .filter(Boolean).join(', ').replace(/\|\|\|/g, ', ');
  if (people) parts.push(people);
  const desc = clean(row.description);
  if (desc) parts.push(desc.slice(0, DOC_DESC_LIMIT));
  return parts.join('. ');
}

// Ham `products` satırından belge üretir.
// GEREKLİ SÜTUNLAR: slug, title, brand_name_raw, brand_office_name, category, kind, designer,
//                   year, description, specs.
export function productDocFromRow(row) {
  const parts = [];
  parts.push(clean(row.title));
  const brand = clean(row.brand_office_name) || clean(row.brand_name_raw);
  if (brand) parts.push(`Marka: ${brand}`);
  if (clean(row.category)) parts.push(`Kategori: ${clean(row.category)}`);
  if (clean(row.kind) === 'material') parts.push('Yapı malzemesi');
  if (clean(row.designer)) parts.push(`Tasarımcı: ${clean(row.designer)}`);
  if (clean(row.year)) parts.push(clean(row.year));
  // specs = [{label,value}] — malzeme/renk/ölçü gibi ayırt edici nitelikler tam olarak burada
  // yaşıyor ve bir ürünü ADINDAN daha iyi tarif ediyor ("Krom kaplama", "Meşe", "60 cm").
  const specs = [];
  try {
    const raw = typeof row.specs === 'string' ? JSON.parse(row.specs) : row.specs;
    if (Array.isArray(raw)) {
      for (const s of raw.slice(0, 10)) {
        if (!s || typeof s !== 'object') continue;
        const label = clean(s.label);
        const value = clean(s.value);
        if (value) specs.push(label ? `${label}: ${value}` : value);
      }
    }
  } catch { /* bozuk specs JSON'u belgeyi bozmaz */ }
  if (specs.length) parts.push(specs.join(', '));
  const desc = clean(row.description);
  if (desc) parts.push(desc.slice(0, DOC_DESC_LIMIT));
  return parts.join('. ');
}

// Belge parmak izi — cron'un "bu varlık değişti mi?" sorusunu embedding üretmeden cevaplaması
// içindir (brief 18: artımlı indeksleme). İlk 12 hex basamak (48 bit) yeterlidir: çakışma olasılığı
// 1715 kayıtta ~3e-11, ve bir çakışmanın tek sonucu o kaydın bir güncellemeyi kaçırmasıdır.
export async function docHash(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------------------------
// NİCEMLEME + PAKET
// ---------------------------------------------------------------------------------------------

// Float dizisini birim uzunluğa normalize edip int8'e nicemler. Sıfır vektör (embedding
// başarısız) tamamen sıfır satır olarak yazılır — kosinüsü her zaman 0 verir, yani o varlık
// anlamsal yoldan hiç aday olmaz ama sözlüksel yoldan bulunmaya devam eder.
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

/**
 * @param {{type: string, dim: number, model: string, built: string,
 *          items: Array<{s: string, h: string}>, vectors: Int8Array}} input
 *        vectors uzunluğu items.length * dim olmalı.
 * @returns {ArrayBuffer}
 */
export function packIndex(input) {
  const header = JSON.stringify({
    v: INDEX_VERSION, type: input.type, dim: input.dim, model: input.model,
    built: input.built, items: input.items,
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
 * @returns {{header: object, dim: number, vectors: Int8Array, rowOf: (i:number)=>Int8Array}|null}
 *          Bozuk/eksik veride null döner — arama o zaman anlamsal katman OLMADAN çalışır.
 */
export function unpackIndex(buf) {
  try {
    if (!buf || buf.byteLength < 8) return null;
    const view = new DataView(buf);
    const headerLen = view.getUint32(0, true);
    if (headerLen <= 0 || 4 + headerLen > buf.byteLength) return null;
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, headerLen)));
    const dim = Number(header.dim) || 0;
    const items = Array.isArray(header.items) ? header.items : [];
    if (!dim || !items.length) return null;
    const vectors = new Int8Array(buf, 4 + headerLen, items.length * dim);
    return {
      header, dim, items, vectors,
      rowOf: (i) => vectors.subarray(i * dim, (i + 1) * dim),
    };
  } catch {
    return null;
  }
}

// İki int8 satırı arasındaki kosinüs. Satırlar zaten birim uzunlukta nicemlendiği için
// nokta çarpımını 127² ile ölçeklemek yeterlidir (ayrıca norm hesabı GEREKMEZ).
export function cosineInt8(a, b, dim) {
  let dot = 0;
  for (let i = 0; i < dim; i++) dot += a[i] * b[i];
  return dot / (127 * 127);
}

// Sorgu vektörü (float) ile TÜM dizin arasında kosinüs. Dönen dizi items ile AYNI sıradadır.
// 1715 × 1024 çarpma ≈ 1,8M işlem — Worker'da ~2-4 ms. Bu ölçekte ayrı bir ANN yapısına
// (Vectorize gibi ek bir ücretli servis) gerek YOKTUR; brute force hem daha basit hem bedava.
export function cosineScores(index, queryVec) {
  const { dim, items, vectors } = index;
  const q = quantizeUnit(queryVec);
  const out = new Float32Array(items.length);
  for (let i = 0; i < items.length; i++) {
    let dot = 0;
    const off = i * dim;
    for (let d = 0; d < dim; d++) dot += vectors[off + d] * q[d];
    out[i] = dot / (127 * 127);
  }
  return out;
}

// Dizindeki BİR SATIRIN diğer tüm satırlarla kosinüsü — "eşleşen varlığa benzeyenler" için
// (kullanıcı isteği: önce aynı proje, SONRA ona benzeyen projeler). Yeni bir AI çağrısı
// gerektirmez; vektör zaten dizinde duruyor.
export function cosineScoresFromRow(index, rowIdx) {
  const { dim, items, vectors } = index;
  const out = new Float32Array(items.length);
  const base = rowIdx * dim;
  for (let i = 0; i < items.length; i++) {
    let dot = 0;
    const off = i * dim;
    for (let d = 0; d < dim; d++) dot += vectors[off + d] * vectors[base + d];
    out[i] = dot / (127 * 127);
  }
  return out;
}
