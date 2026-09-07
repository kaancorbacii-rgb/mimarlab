// GÜNDEM ANLAMSAL MÜKERRER KAPISI (kullanıcı isteği, 2026-09-07: "aynı içeriği iki farklı
// kaynaktan çekmişsin ... birbirine %70'ten fazla benzeyen içerikleri tek bir gönderide iki farklı
// kaynak belirterek paylaş").
//
// NEDEN KELİME ÖRTÜŞMESİ YETMİYOR — ölçüm, uydurma değil. Foster + Partners'ın robot sürüsü haberi
// canlıda DÖRT kaynaktan dört ayrı kart olarak yayınlanmıştı. O dört Türkçe başlığın ikili jaccard
// benzerliği yalnızca 0,23-0,30; özet dahil edilse bile 0,25'i geçmiyor. Sebep basit: her kaynağın
// Türkçe başlık/özetini AI BAĞIMSIZ yazıyor, aynı olayı farklı kelimelerle anlatıyor. Eşiği bu
// bandın altına çekmek işe yaramaz — aynı gün yayınlanan ALAKASIZ iki Foster haberi (Emeco/Zara
// davası, Norton showroom'u) de aynı bandın içinde kalıyordu. Kelime düzeyinde bu iki kümeyi
// ayıran bir eşik YOK.
//
// ANLAM DÜZEYİNDE İSE VAR. 210 canlı kaydın tüm çiftleri bge-m3 ile gömülüp ölçüldü:
//     0,927  Kengo Kuma ödülü            (Archiproducts || Dezeen)      GERÇEK mükerrer
//     0,893  Foster robot sürüsü         (Archiproducts || Dezeen)      GERÇEK mükerrer
//     0,889  Foster robot sürüsü         (Arkitera || Dezeen)           GERÇEK mükerrer
//     0,838  Foster robot sürüsü         (Archiproducts || AJ)          GERÇEK mükerrer
//     0,821  Foster robot sürüsü         (Dezeen || AJ)                 GERÇEK mükerrer
//     0,809  Lucas müzesi açılışı        (Archiproducts || Dezeen)      GERÇEK mükerrer
//     0,740  Londra Kulesi               (Dezeen || AJ)                 FARKLI haberler
// Eşik 0,82 bu iki kümenin arasından geçiyor.
//
// NEDEN VECTORIZE DEĞİL: karşılaştırma penceresi 7 gün ve en fazla birkaç yüz satır — vektör
// veritabanı eklemek bu ölçekte gereksiz bir servis bağımlılığı olurdu. Vektörler satırın kendi
// kolonunda durur, karşılaştırma bellekte yapılır.
//
// MODEL: @cf/baai/bge-m3 — repo'da görsel arama dizininin ZATEN kullandığı model (bkz.
// src/lib/visualIndex.js). Çok dilli olması burada kritik: Türkçe özet ile İngilizce özet aynı
// uzaya düşer, yani kaynak dili farklı olsa bile aynı haber yakalanır (eski kapının açık bilinen
// sınırıydı, bkz. gundemIngest.js dosya başı).

export const GUNDEM_EMBED_MODEL = '@cf/baai/bge-m3';

// Kosinüs eşiği. Ölçülen ayrım bandının (0,74 ile 0,81) üstünde, gerçek mükerrerlerin (0,809+)
// altında kalacak şekilde seçildi. TEK ayar noktası — sıkılaştırmak/gevşetmek için bu satır.
export const GUNDEM_DUPLICATE_THRESHOLD = 0.82;

// Karşılaştırma penceresi. Aynı haberi farklı yayıncılar GÜNLER içinde yazar, haftalar sonra değil;
// pencereyi dar tutmak her turda okunan vektör sayısını da kelepçeler.
export const GUNDEM_EMBED_WINDOW_DAYS = 7;

// Gömme için modele verilen metnin üst sınırı. Başlık + özet zaten kısa (özet 40-88 kelime);
// bu sınır yalnızca beklenmedik uzunluktaki bir kayda karşı emniyet.
const EMBED_MAX_CHARS = 900;

export function gundemEmbedText(title, summary) {
  return `${title || ''} — ${summary || ''}`.slice(0, EMBED_MAX_CHARS);
}

// --- Niceleme -----------------------------------------------------------------------------------
// Ham float32 vektör satır başına ~5,5 KB tutar; 7 günlük pencerede (~300 satır) her turda 1,6 MB
// D1'den okumak demektir. int8 niceleme bunu ~1,4 KB'a indirir. Ölçek vektör başına saklanır
// (ilk bayt değil, ayrı bir alan değil — base64'ün başına 4 baytlık float32 olarak eklenir), çünkü
// bge-m3 bileşenleri küçüktür (|v| genelde < 0,1) ve sabit ölçekle nicelemek çözünürlüğü öldürürdü.
export function quantizeEmbedding(vec) {
  if (!Array.isArray(vec) || !vec.length) return null;
  let max = 0;
  for (const v of vec) { const a = Math.abs(v); if (a > max) max = a; }
  if (!(max > 0)) return null;
  const buf = new Uint8Array(4 + vec.length);
  new DataView(buf.buffer).setFloat32(0, max, true);
  for (let i = 0; i < vec.length; i++) {
    // Math.round(-0.5) === -0 ve 127 taşması olmasın diye sınırlanır.
    const q = Math.max(-127, Math.min(127, Math.round((vec[i] / max) * 127)));
    buf[4 + i] = q < 0 ? q + 256 : q;
  }
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

export function dequantizeEmbedding(b64) {
  if (!b64 || typeof b64 !== 'string') return null;
  let bin;
  try { bin = atob(b64); } catch { return null; }
  if (bin.length < 8) return null;
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const scale = new DataView(buf.buffer).getFloat32(0, true);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const out = new Float32Array(buf.length - 4);
  for (let i = 0; i < out.length; i++) {
    const raw = buf[4 + i];
    out[i] = ((raw > 127 ? raw - 256 : raw) / 127) * scale;
  }
  return out;
}

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na <= 0 || nb <= 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Workers AI çağrısı. Hata YUTULUR (null döner): gömme üretilemezse mükerrer kapısı sessizce
// eski kelime tabanlı kapıya güvenir ve içerik YİNE de yayınlanır — bir altyapı hatası yüzünden
// hattın tamamen durması, mükerrer bir kartın yayınlanmasından daha kötüdür.
export async function embedGundemText(env, text) {
  if (!env || !env.AI || !text) return null;
  try {
    const res = await env.AI.run(GUNDEM_EMBED_MODEL, { text: [text] });
    const vec = (res && (res.data || res.response));
    const first = Array.isArray(vec) ? vec[0] : null;
    return Array.isArray(first) && first.length ? first : null;
  } catch {
    return null;
  }
}

// Aday vektörü, pencere içindeki kayıtların vektörleriyle karşılaştırılır; eşiği geçen EN YÜKSEK
// eşleşme döner. `rows` her biri { id, slug, source_domain, embedding } taşıyan satırlardır.
export function findSemanticDuplicate(candidateVec, rows, threshold = GUNDEM_DUPLICATE_THRESHOLD) {
  if (!candidateVec || !Array.isArray(rows) || !rows.length) return null;
  let best = null;
  for (const row of rows) {
    const vec = dequantizeEmbedding(row.embedding);
    if (!vec) continue;
    const score = cosineSimilarity(candidateVec, vec);
    if (score >= threshold && (!best || score > best.score)) best = { row, score };
  }
  return best;
}
