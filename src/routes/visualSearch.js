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
// YENİ MİMARİ — İKİ AŞAMA (2026-09-03, İKİNCİ TUR: GERÇEK GÖRSEL-GÖRSEL EMBEDDING)
//   AŞAMA A (kimlik):  vision -> {identity, visibleText/OCR, brand, model, place}
//                      -> src/lib/entityMatch.js ile D1 BAŞLIKLARINA karşı IDF ağırlıklı eşleşme.
//                      Model bir kayıt UYDURAMAZ: eşleşmeyen ad sessizce düşer.
//   AŞAMA B (görsel benzerlik): kullanıcının yüklediği FOTOĞRAF -> TARAYICIDA hesaplanmış GERÇEK
//                      CLIP görsel embedding'i (bkz. image-clip-embed.js) -> önceden kurulmuş
//                      GÖRSEL-DÜZEYİNDE dizin (src/lib/imageEmbedIndex.js, her proje/ürünün
//                      GERÇEK fotoğrafları) ile kosinüs + varlık-düzeyinde ağırlıklı toplama.
//                      AYNI yapının FARKLI fotoğrafı bu yolla aynı varlığa yaklaşır — çünkü bu
//                      artık GERÇEKTEN piksellerin (dolaylı olarak, CLIP'in öğrendiği görsel
//                      temsilin) karşılaştırılmasıdır, vision'ın ürettiği METNİN değil.
//
//   NEDEN TARAYICIDA, SUNUCUDA DEĞİL (mimari kısıt, denetlendi 2026-09-03): Cloudflare Workers AI
//   kataloğunda (resmi docs + `wrangler ai models`, 86 model) görsel embedding modeli YOKTUR.
//   Harici bir API (Jina/Vertex AI/HF) canlı sorgu embedding'i için değerlendirildi ama HEPSİ
//   YENİ BİR HESAP açılmasını gerektiriyor — Claude'un asla yapamayacağı bir eylem (kimlik/hesap
//   oluşturma güvenlik kısıtı). Çözüm: image-upload.js'in "türev üretimi tarayıcıda, maliyet
//   sıfır" desenini CNN çıkarımına genelleştirmek — bkz. image-clip-embed.js dosya başı yorumu.
//
//   YEDEK KANAL (queryVec/EMBED_MODEL, src/lib/visualIndex.js): tarayıcı WASM'ı desteklemiyorsa,
//   89 MB'lık model indirilemiyorsa ya da görsel dizini henüz o varlık için boşsa, sistem ESKİ
//   (2026-09-03 birinci tur) bge-m3 METİN AÇIKLAMASI embedding'ine YUMUŞAK DÜŞER — bu KESİNLİKLE
//   "BGE-M3'ü image embedding modeli GİBİ" kullanmak DEĞİLDİR, yalnızca birincil kanal
//   kullanılamadığında devreye giren, önceden var olan ve test edilmiş bir GERİ DÜŞÜŞ ağıdır
//   (brief madde 13: "missing/stale embedding" toleransı, madde 12: "mevcut sistemi bozma").
//
//   Bunlara taksonomi (tür/disiplin/malzeme) ve coğrafya sinyalleri eklenip AĞIRLIKLI olarak
//   birleştirilir (brief 12). Hiçbir sinyal tek başına karar vermez.
//
// TIER AYRIMI (brief 2/13/26): "aynı varlık" iddiası ile "benzer" sonucu BİRBİRİNE KARIŞTIRILMAZ.
// Exact eşleşme yalnızca ad eşleşmesi güçlüyse VE ikinci adaya belirgin bir fark varsa ilan
// edilir; aksi halde sistem exact iddiasında BULUNMAZ ve sonuçlar "en yakın" başlığı altında
// gösterilir. GERÇEK BULGU (bu turun ölçümü): SAF görsel benzerlik TEK BAŞINA farklı ama
// "fotojenik anıt" tarzı benzer iki varlığı (ör. Ayasofya/Galata Kulesi) ayırt etmekte YETERSİZ
// kalabiliyor (ölçülen kosinüs: aynı varlık farklı foto 0,75; FARKLI varlık ama benzer tarz 0,79)
// — bu YÜZDEN görsel benzerlik yalnızca ADAY KÜMESİ genişletme + puanlama sinyali olarak kullanılır,
// exact kararının birincil kapısı HÂLÂ kimlik (ad) eşleşmesidir (brief madde 6: "vision'ı reranker
// olarak kullan, retrieval'ın YERİNE koyma").
//
// MALİYET KONTROLÜ (brief 15/24):
//   * İstek başına EN FAZLA 1 AI ÇAĞRISI (Workers AI): yalnızca vision analizi. Görsel embedding
//     TARAYICIDA (ücretsiz), metin embedding (yedek kanal) yalnızca görsel kanalı yoksa çalışır.
//   * Aynı görsel (SHA-256) daha önce görüldüyse AI'ya HİÇ gidilmez (KV önbelleği, 7 gün).
//   * Dizinler TEK birer KV nesnesidir: arama başına 0 (sıfır) ek D1 satırı okunur.
//   * IP başına hız sınırı. Ücretli hiçbir Cloudflare özelliği (Images Transform, Vectorize) yok.
//
// GİZLİLİK (brief 25): yüklenen görsel R2'ye YAZILMAZ, kalıcı olarak saklanmaz, hiçbir kullanıcıya
// gösterilmez. Sunucuda bellekte analiz edilir, sonra düşer. Görsel embedding'i TARAYICIDA
// hesaplandığından ham piksel verisi SUNUCUYA hiç gitmez (yalnızca vision analizi için gönderilen
// asıl dosya hariç — o da aynı şekilde kalıcı olarak saklanmaz). Önbellekte yalnızca görselin
// HASH'i ve ondan türeyen yapılandırılmış analiz tutulur.

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
import { aggregateImageIndex, aggregateRowScores, imageCosineScoresFromRow, IMAGE_EMBED_DIM, IMAGE_EMBED_MODEL } from '../lib/imageEmbedIndex.js';
import { loadImageIndex, addEntityImageEmbedding } from '../lib/imageEmbedStore.js';
import { getSessionUser } from '../lib/auth.js';
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
// PROJE/ÜRÜN İÇİN AYRI KALİBRASYON GEREKİYOR MU? (dördüncü tur denetim, madde 12) — KONTROL EDİLDİ,
// AYRI EŞİK EKLENMEDİ. Ham görsel-kanal Top-1 doğruluğu ürün için hâlâ projeden düşük (max-aggregation
// SONRASI: proje %46,2 / ürün %47,9 — bkz. scripts/visual-search-aggregation-ablation.mjs çıktısı,
// max()'a geçişle bu fark aslında KAPANDI). Katman ablation testinde (scripts/visual-search-layer-
// ablation.mjs) TAM SİSTEM hem proje hem ürün senaryolarında (Mony×2 açı, Gola yanlış-marka-iddiası
// dahil) 9/9 doğru sonuç verdi — kimlik gate'i her iki türde de eşit güçlü çalışıyor. Bu YÜZDEN
// PRODUCT_GATE_NAME_MIN/EXACT_* eşikleri proje ile PAYLAŞILMAYA devam ediyor; veri ayrı bir ürün
// eşiğini haklı çıkarmıyor (brief: "keyfi değer kullanma").

// Kosinüsün [0,1]'e ölçeklenmesi — YEDEK metin kanalı (bge-m3). İlgisiz metin çiftleri ~0.30-0.40,
// gerçekten ilgili olanlar ~0.65-0.85 bandındadır; ham kosinüsü doğrudan ağırlıklandırmak taban
// gürültüyü "benzerlik" gibi gösterirdi.
const SEM_FLOOR = 0.38;
const SEM_CEIL = 0.82;
// GERÇEK GÖRSEL kanalı (CLIP ViT-B/32) için AYRI ölçek.
//
// BÜYÜK ÖLÇEKLİ KALİBRASYON (üçüncü tur denetim, madde 6 — scripts/visual-search-calibration-
// bench.mjs, PRODUCTION'daki GERÇEK dizin üzerinde "held-out" testi: her varlığın kendi
// fotoğraflarından biri sorgu olarak ayrılıp dizinin geri kalanında arandı, KİMLİK SİNYALİ HİÇ
// KULLANILMADAN — yalnızca ham görsel kanal). n=1666 proje + n=167 ürün (uydurma değil, TÜM
// uygun varlıklar — bkz. betiğin konsol çıktısı):
//   * Top-1 doğruluğu (yalnızca görsel): proje %40,8 — ürün %18,0.
//   * Top-5 recall (yalnızca görsel):    proje %58,0 — ürün %24,6.
//   * doğru-eşleşme skoru: p10=0,72 p50=0,85 p90=0,91 (proje)
//   * YANLIŞ Top-1 çıktığında o adayın skoru: p50=0,86 p90=0,91 — yani DOĞRU ve YANLIŞ eşleşmelerin
//     skor dağılımları ÖNEMLİ ÖLÇÜDE ÇAKIŞIYOR (aşırı-değer istatistiği: 1666 varlığın ARASINDAN en
//     yüksek YANLIŞ skor da doğal olarak yüksek çıkar).
//   * çapraz-alan "kesinlikle alakasız" taban (ürün görseli → proje dizini): p50=0,81 p90=0,87.
// SONUÇ (ölçüldü, uydurulmadı): ham CLIP görsel benzerliği TEK BAŞINA "aynı varlık" ile "farklı ama
// görsel olarak benzer" adayı GÜVENİLİR biçimde AYIRT EDEMİYOR — hiçbir floor/ceil çifti bu
// çakışmayı ortadan kaldıramaz (istatistiksel bir kalibrasyon sorunu değil, sinyalin doğasında var).
// Bu YÜZDEN mevcut eşikler (aşağıda) DEĞİŞTİRİLMEDİ: veri, "farklı bir sayı dene" değil, "görsel
// kanalı ASLA tek başına karara bağlama" tasarım ilkesini (decideExact'in isim eşleşmesini birincil
// kapı olarak kullanması, hasCorroboration'ın saf-görsel adayları listeye bile sokmaması)
// DOĞRULUYOR. FLOOR/CEIL yalnızca SIRALAMA ağırlığı (0,32×sem) için kullanılmaya devam ediyor —
// zaten kimlik/coğrafya/taksonomiyle KORONE olmuş bir adayın görsel skorunu ince ayarlamak için
// makul bir bant; tek başına eşik olarak KULLANILMIYOR.
const IMG_SEM_FLOOR = 0.45;
const IMG_SEM_CEIL = 0.80;

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

// WEBP DESTEĞİ (üçüncü tur denetim, madde 8): src/routes/upload.js#sniffImageMime İLE BİREBİR
// AYNI RIFF....WEBP imzası — mevcut yükleme ucuyla TUTARLI, ayrı bir doğrulama kuralı icat
// edilmedi. Beyan edilen Content-Type'a DEĞİL, gerçek dosya baytlarına bakılır (yukarıdaki JPEG/
// PNG kontrolleriyle AYNI ilke, bkz. dosya başı "10 MB → ... → magic byte" güvenlik notu).
function sniffImageMime(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47
      && bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A) return 'image/png';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

// PNG/JPEG başlığından piksel ölçüsü. Amaç boyut doğrulaması DEĞİL, DEKOMPRESYON BOMBASI
// korumasıdır (brief 25): 2 KB'lık bir PNG 60000×60000 piksel beyan edebilir ve onu çözmeye
// çalışan aşama belleği tüketir. Ölçü okunamazsa (nadir/parçalı başlık) istek ENGELLENMEZ —
// bu bir ek savunma katmanıdır, tek kapı değil (asıl kapı MAX_BYTES + magic byte).
// WebP boyutu — RIFF/WEBP kapsayıcısının İLK chunk'ı (VP8 /VP8L/VP8X) üç farklı iç biçimde
// genişlik/yükseklik taşır (bkz. WebP Container/Lossy/Lossless bitstream spesifikasyonu). Üçü de
// desteklenir; tanınmayan bir chunk türünde (nadir/gelecekteki bir uzantı) sessizce 0 döner —
// yukarıdaki dosya başı yorumundaki AYNI ilke: bu bir EK savunma katmanı, tek kapı değil.
function webpPixels(bytes, view) {
  if (bytes.length < 30) return 0;
  const fourcc = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (fourcc === 'VP8X') {
    // bayrak(1) + ayrılmış(3) + genişlik-1(3, LE 24-bit) + yükseklik-1(3, LE 24-bit)
    const w = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1;
    const h = (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1;
    return w * h;
  }
  if (fourcc === 'VP8L') {
    // imza(1, 0x2F) + 4 bayt paketlenmiş: genişlik-1 (14 bit) + yükseklik-1 (14 bit)
    if (bytes[20] !== 0x2F) return 0;
    const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24];
    const w = (b0 | ((b1 & 0x3F) << 8)) + 1;
    const h = ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0F) << 10)) + 1;
    return w * h;
  }
  if (fourcc === 'VP8 ') {
    // çerçeve etiketi(3) + başlangıç kodu(3, 0x9d 0x01 0x2a) + genişlik(2, LE alt 14 bit) +
    // yükseklik(2, LE alt 14 bit) — chunk verisi offset 20'de başlar.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return 0;
    const w = view.getUint16(26, true) & 0x3FFF;
    const h = view.getUint16(28, true) & 0x3FFF;
    return w * h;
  }
  return 0;
}

// PNG/JPEG/WEBP başlığından piksel ölçüsü. Amaç boyut doğrulaması DEĞİL, DEKOMPRESYON BOMBASI
// korumasıdır (brief 25): 2 KB'lık bir PNG 60000×60000 piksel beyan edebilir ve onu çözmeye
// çalışan aşama belleği tüketir. Ölçü okunamazsa (nadir/parçalı başlık) istek ENGELLENMEZ —
// bu bir ek savunma katmanıdır, tek kapı değil (asıl kapı MAX_BYTES + magic byte).
function imagePixels(bytes) {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes[0] === 0x89 && bytes[1] === 0x50) {
      // IHDR her zaman ilk chunk'tır: 8 bayt imza + 4 uzunluk + 4 tip = 16. offset'te genişlik.
      return view.getUint32(16, false) * view.getUint32(20, false);
    }
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      return webpPixels(bytes, view);
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

// TARAYICIDAN GELEN GÖRSEL EMBEDDING'İNİN DOĞRULANMASI (brief madde 13/25 — production hardening).
// Bu, sunucunun İSTEMCİDEN aldığı tek "ham sayısal" girdidir; kötü niyetli/bozuk bir istemci
// yanlış boyutlu, sonsuz/NaN değerli ya da anormal büyüklükte bir dizi gönderebilir. Doğrulama
// BAŞARISIZ olursa sessizce null döner (istek REDDEDİLMEZ) — sistem otomatik olarak metin
// kanalına düşer, brief'in "hiçbir durumda boş beyaz alan bırakma" ilkesiyle uyumlu.
function parseImageEmbedding(raw) {
  if (typeof raw !== 'string' || raw.length > 20000) return null;   // 512 float JSON ~9KB, cömert pay
  let arr;
  try { arr = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(arr) || arr.length !== IMAGE_EMBED_DIM) return null;
  const out = new Float32Array(IMAGE_EMBED_DIM);
  for (let i = 0; i < IMAGE_EMBED_DIM; i++) {
    const v = Number(arr[i]);
    // CLIP çıktı büyüklüğü ölçüldü (~-5..+2 aralığında, bkz. gerçek embedding örneği) — 50 sınırı
    // makul bir bozuk-veri kelepçesi, gerçek bir CLIP vektörünü asla kesmez.
    if (!Number.isFinite(v) || Math.abs(v) > 50) return null;
    out[i] = v;
  }
  return out;
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
// scale: {floor, ceil} — GÖRSEL (IMG_SEM_*) ya da METİN (SEM_*) kanalının kendi ölçeği. Hangi
// kanalın aktif olduğu resolveVisualMatch#pickVisualChannel'da belirlenir.
function sem01(cos, scale) { return clamp01((cos - scale.floor) / (scale.ceil - scale.floor)); }

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
// `visual`: { map: Map<slug,cosine>, floor, ceil, channel: 'image'|'text' } | null — bkz.
// resolveVisualMatch#pickVisualChannel. Hangi kanaldan geldiği ranking formülünü DEĞİŞTİRMEZ,
// yalnızca ölçeklemeyi (sem01) etkiler; iki kanal da normalize edildikten sonra [0,1] aralığında
// karşılaştırılabilir tek bir "sem" sinyaline indirgenir.
// ---------------------------------------------------------------------------------------------
function rankProjects(pool, poolBySlug, vision, visual, nameIndex) {
  const nameBySlug = matchNames(nameIndex, projectGuesses(vision), it => it.slug, 25);

  // ADAY KÜMESİ üç kaynaktan gelir; hiçbiri tek başına yeterli değildir:
  //   1) sözlüksel kimlik eşleşmeleri (Aşama A),
  //   2) görsel/anlamsal en yakınlar (Aşama B — gerçek CLIP embedding ya da yedek metin kanalı),
  //   3) taksonomi araması — dizin henüz kurulmamışsa ya da fotoğraf hiçbir şeye benzemiyorsa
  //      sistemin eski, kanıtlanmış davranışı korunsun diye (geriye dönük güvenlik ağı).
  const candidates = new Map();   // slug -> item
  for (const [slug, m] of nameBySlug) candidates.set(slug, m.item);
  if (visual) {
    const top = [...visual.map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60);
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
    const sem = visual ? sem01(visual.map.get(slug) || 0, visual) : 0;
    const tax = projectTaxScore(item, vision);
    const geo = geoScore(item, vision);
    const final = 0.46 * name + 0.32 * sem + 0.16 * tax + 0.06 * geo;
    const conf = 0.70 * name + 0.18 * sem + 0.07 * geo + 0.05 * tax;
    // visualEvidence: yalnızca GÖRSEL kanalda ve yalnızca GÖZLEMLENEBİLİRLİK için (brief madde 16:
    // "explainable result") — sıralama kararına girmiyor (o hâlâ `sem`/final/conf üzerinden).
    const visualEvidence = (visual && visual.channel === 'image' && visual.agg) ? visual.agg.get(slug) || null : null;
    scored.push({ item, name, sem, tax, geo, score: final, conf, via: nameBySlug.get(slug) || null, visualEvidence });
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

function rankProducts(pool, poolBySlug, vision, visual, nameIndex) {
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
  if (visual) {
    const top = [...visual.map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    for (const [slug] of top) {
      if (candidates.has(slug)) continue;
      const item = poolBySlug.get(slug);
      if (item) candidates.set(slug, item);
    }
  }

  const scored = [];
  for (const [slug, item] of candidates) {
    const name = nameBySlug.has(slug) ? nameBySlug.get(slug).score : 0;
    const sem = visual ? sem01(visual.map.get(slug) || 0, visual) : 0;
    const cat = productCategoryScore(item, vision);
    const brand = brandFold && foldTr(item.brand || '') === brandFold ? 1 : 0;
    const mat = vision.materials.length && materialHit(`${item.title || ''} ${item.category || ''}`, vision.materials) ? 1 : 0;
    const rating = (item.rating && item.rating.count) ? Math.min(1, item.rating.average / 5) : 0;
    const final = 0.40 * name + 0.24 * sem + 0.20 * cat + 0.10 * brand + 0.03 * mat + 0.03 * rating;
    const conf = 0.62 * name + 0.16 * sem + 0.14 * brand + 0.08 * cat;
    const visualEvidence = (visual && visual.channel === 'image' && visual.agg) ? visual.agg.get(slug) || null : null;
    scored.push({ item, name, sem, cat, brand, score: final, conf, via: nameBySlug.get(slug) || null, visualEvidence });
  }
  scored.sort((a, b) => (b.score - a.score) || String(a.item.slug).localeCompare(String(b.item.slug)));
  return scored;
}

// KORONASYONSUZ SAF GÖRSEL EŞLEŞMEYİ ELE — GERÇEK ÖLÇÜM BULGUSU (bu turun eval'ı,
// scripts/visual-search-image-eval.mjs): binlerce gerçek fotoğraf arasında en-iyi-eşleşen-görseli
// arayan bir sorguda, TAMAMEN ALAKASIZ bir sorgu görseli bile ~9700 aday arasından SALT ŞANS
// eseri bir-iki görselle "yeterince yüksek" kosinüs yakalayabiliyor (aşırı değer istatistiği: N
// arttıkça maksimum benzerlik, "tipik" benzerlikten sistematik olarak sapar). Bu YÜZDEN bir
// adayın SIRF görsel skorla PROJECT_MIN_SCORE/PRODUCT_MIN_SCORE eşiğini geçmesi YETERLİ DEĞİL —
// en az BİR bağımsız doğrulayan sinyal (isim/OCR eşleşmesi, taksonomi, coğrafya, marka, kategori)
// de sıfırdan büyük olmalı. Bu, brief madde 6'nın ("vision'ı reranker olarak kullan, retrieval'ın
// YERİNE koyma") doğrudan uygulanmasıdır — tek bir kanalın asla tek başına karar vermemesi.
function hasCorroboration(r) {
  return r.name > 0 || r.tax > 0 || r.geo === 1 || r.cat > 0 || r.brand === 1;
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

// GÖRSEL ya da METİN kanalından TEK bir `visual` nesnesi üretir (bkz. rankProjects/rankProducts
// dosya başı yorumu). Görsel kanal HER ZAMAN önceliklidir — gerçek bir sinyal olduğundan (brief
// "BGE-M3'ü image embedding modeli GİBİ kullanma" itirazının doğrudan çözümü). Yalnızca görsel
// kanal kullanılamıyorsa (istemci embedding göndermedi ya da o varlık türünün görsel dizini boş/
// henüz kurulmamış) metin kanalına YUMUŞAK DÜŞÜLÜR.
function pickVisualChannel(imageIndex, imageQueryVec, textIndex, textQueryVec) {
  if (imageQueryVec && imageIndex && imageIndex.entities.length) {
    const agg = aggregateImageIndex(imageIndex, imageQueryVec);
    const map = new Map();
    for (const [slug, v] of agg) map.set(slug, v.score);
    return { map, floor: IMG_SEM_FLOOR, ceil: IMG_SEM_CEIL, channel: 'image', index: imageIndex, agg };
  }
  if (textIndex && textQueryVec) {
    const scores = cosineScores(textIndex, textQueryVec);
    const map = new Map();
    for (let i = 0; i < textIndex.items.length; i++) map.set(textIndex.items[i].s, scores[i]);
    return { map, floor: SEM_FLOOR, ceil: SEM_CEIL, channel: 'text', index: textIndex };
  }
  return null;
}

// Eşleşen varlığa GÖRSEL OLARAK benzeyen diğer varlıkları hesaplar — eşleşen varlığın EN İYİ
// (sorguya en yakın) fotoğrafından dizindeki TÜM diğer görsellere kosinüs alınıp varlık başına
// toplanır. Görsel kanalda bu, "bestImageIndex" satırından; metin kanalında eşleşen varlığın TEK
// satırından (cosineScoresFromRow) yapılır — ikisi de EK bir AI/embedding çağrısı GEREKTİRMEZ,
// vektör zaten dizinde duruyor (brief madde 6 gerekçesiyle aynı: "aynı entity'nin diğer
// fotoğraflarının birbirini temsil etmesini sağla").
function similarToMatchedEntity(visual, matchedSlug) {
  if (!visual) return null;
  if (visual.channel === 'image') {
    const matchedAgg = visual.agg.get(matchedSlug);
    if (!matchedAgg || matchedAgg.bestImageIndex < 0) return null;
    const fromRow = imageCosineScoresFromRow(visual.index, matchedAgg.bestImageIndex);
    const agg = aggregateRowScores(visual.index, fromRow);
    const map = new Map();
    for (const [slug, v] of agg) {
      // %50 sorguya-benzerlik + %50 eşleşen-varlığa-benzerlik — TAMAMEN eşleşen varlığa kaymak
      // (query'yi unutmak) yerine ikisinin dengelenmesi, kullanıcının ASIL yüklediği görselin
      // karakterini de "benzerler" sıralamasında bir miktar korur.
      map.set(slug, 0.5 * (visual.map.get(slug) || 0) + 0.5 * v.score);
    }
    return { map, floor: visual.floor, ceil: visual.ceil, channel: visual.channel };
  }
  const idx = visual.index.items.findIndex(it => it.s === matchedSlug);
  if (idx < 0) return null;
  const fromEntity = cosineScoresFromRow(visual.index, idx);
  const map = new Map();
  for (let i = 0; i < visual.index.items.length; i++) {
    const slug = visual.index.items[i].s;
    map.set(slug, 0.5 * (visual.map.get(slug) || 0) + 0.5 * fromEntity[i]);
  }
  return { map, floor: visual.floor, ceil: visual.ceil, channel: visual.channel };
}

// ---------------------------------------------------------------------------------------------
// SAF ÇEKİRDEK — vision + sorgu embedding'leri + havuzlar/dizinler alır, karar üretir. HTTP/AI/D1'e
// dokunmaz, bu yüzden hem handleVisualSearchRoute hem de scripts/visual-search-eval.mjs TARAFINDAN
// çağrılabilir (brief 23: kalıcı regresyon testleri gerçek karar mantığını test etmeli, HTTP
// katmanının bir kopyasını değil). `pools.projectImageIndex`/`productImageIndex` ve
// `imageQueryVec` OPSİYONELDİR — verilmezse (ör. eval betiğinin henüz güncellenmemiş eski
// çağrıları) sistem otomatik olarak METİN kanalına düşer, hiçbir çağıran KIRILMAZ.
// ---------------------------------------------------------------------------------------------
export function resolveVisualMatch(vision, queryVec, pools, imageQueryVec) {
  const { projectPool, productPool, projectIndex, productIndex, projectImageIndex, productImageIndex } = pools;

  const projVisual = pickVisualChannel(projectImageIndex, imageQueryVec, projectIndex, queryVec);
  const prodVisual = pickVisualChannel(productImageIndex, imageQueryVec, productIndex, queryVec);

  const projectBySlug = new Map(projectPool.map(p => [p.slug, p]));
  const productBySlug = new Map(productPool.map(p => [p.slug, p]));

  const projectNameIndex = buildNameIndex(projectPool, it => it.title || '');
  const productNameIndex = buildNameIndex(productPool, it =>
    [it.brand || '', it.title || '', (it.designers || []).join(' ')].join(' '));

  const projScored = rankProjects(projectPool, projectBySlug, vision, projVisual, projectNameIndex);
  const projectMatch = decideExact(projScored, EXACT_NAME_MIN);

  let similarProjects = projScored;
  if (projectMatch) {
    const blended = similarToMatchedEntity(projVisual, projectMatch.item.slug);
    if (blended) similarProjects = rankProjects(projectPool, projectBySlug, vision, blended, projectNameIndex);
  }

  const projects = similarProjects
    .filter(r => r.score >= PROJECT_MIN_SCORE)
    .filter(hasCorroboration)
    .filter(r => !projectMatch || r.item.slug !== projectMatch.item.slug)
    .slice(0, MAX_PROJECTS);

  const prodScored = rankProducts(productPool, productBySlug, vision, prodVisual, productNameIndex);
  const productMatch = decideExact(prodScored, EXACT_NAME_MIN);
  const bestProductName = prodScored.length ? prodScored[0].name : 0;
  const productSignal = (vision.products && vision.products.length > 0)
    || vision.subject === 'product'
    || bestProductName >= PRODUCT_GATE_NAME_MIN;

  let similarProducts = prodScored;
  if (productSignal && productMatch) {
    const blended = similarToMatchedEntity(prodVisual, productMatch.item.slug);
    if (blended) similarProducts = rankProducts(productPool, productBySlug, vision, blended, productNameIndex);
  }
  const products = productSignal
    ? similarProducts
      .filter(r => r.score >= PRODUCT_MIN_SCORE)
      .filter(hasCorroboration)
      .filter(r => !productMatch || r.item.slug !== productMatch.item.slug)
      .slice(0, MAX_PRODUCTS)
    : [];

  const matchProject = projectMatch ? { ...projectPayload(projectMatch), confidence: Number(projectMatch.conf.toFixed(3)) } : null;
  const matchProduct = (productSignal && productMatch) ? { ...productPayload(productMatch), confidence: Number(productMatch.conf.toFixed(3)) } : null;

  // matchType (üçüncü tur denetim, madde 3): "EXACT PROJECT / SIMILAR PROJECT / EXACT PRODUCT /
  // SIMILAR PRODUCT / NO MATCH" — bunlar zaten match.*/projects[]/products[] alanlarından TÜRETİLEBİLİR
  // durumlardı (bu alan mantığı DEĞİŞTİRMEZ), ancak API tüketicilerinin (site-chrome.js, ileride
  // olası başka istemciler) "hangi durumdayım" sorusunu her seferinde 4 alanı kendi yeniden çıkarmak
  // yerine TEK bir açık etiketle okuyabilmesi için eklendi. Proje sinyali ürün sinyalinden HER ZAMAN
  // önce gelir (görsel arama birincil olarak mimari odaklı — bkz. dosya başı brief).
  let matchType = 'NO_MATCH';
  if (matchProject) matchType = 'EXACT_PROJECT';
  else if (matchProduct) matchType = 'EXACT_PRODUCT';
  else if (projects.length) matchType = 'SIMILAR_PROJECT';
  else if (products.length) matchType = 'SIMILAR_PRODUCT';

  return {
    match: { project: matchProject, product: matchProduct },
    matchType,
    projects: projects.map(projectPayload),
    products: products.map(productPayload),
    productsSuppressed: !productSignal,
    visualChannel: { project: projVisual ? projVisual.channel : 'none', product: prodVisual ? prodVisual.channel : 'none' },
    // Ham skorlar (eval için) — payload'a girmeyen ama Top-K doğruluğu ölçmek için gereken tam sıra.
    projectsRanked: similarProjects, productsRanked: prodScored,
  };
}

// visualEvidence alanını API yanıtı için biçimlendirir (brief madde 16: "explainable result" —
// entityId/visualScore/maxSimilarity/topKSupport/finalScore/matchType izlenebilir olmalı ama
// kullanıcıya GÖSTERİLMEK ZORUNDA değil). site-chrome.js bu alanı hiç okumuyor/render etmiyor —
// yalnızca ağ sekmesinden/geliştirici konsolundan izlenebilir bir gözlemlenebilirlik alanı.
function visualEvidencePayload(ve) {
  if (!ve) return null;
  return {
    maxSimilarity: Number(ve.maxSimilarity.toFixed(3)),
    top2Average: Number(ve.top2Average.toFixed(3)),
    top3Average: Number(ve.top3Average.toFixed(3)),
    supportingImageCount: ve.supportingImageCount,
    bestImageId: ve.bestImageId,
  };
}

function projectPayload(r) {
  return {
    slug: r.item.slug, title: r.item.title, location: r.item.location, date: r.item.date,
    image: (r.item.images && r.item.images[0]) || null,
    score: Number(r.score.toFixed(3)),
    // "visual": image kanalıysa GERÇEK CLIP görsel benzerliği, text kanalıysa yedek metin
    // açıklaması benzerliği (bkz. resolveVisualMatch#pickVisualChannel + üstteki match.*Channel).
    signals: { name: Number(r.name.toFixed(3)), visual: Number(r.sem.toFixed(3)), taxonomy: Number(r.tax.toFixed(3)), geo: r.geo },
    visualEvidence: visualEvidencePayload(r.visualEvidence),
  };
}

function productPayload(r) {
  return {
    slug: r.item.slug, title: r.item.title, brand: r.item.brand, category: r.item.category,
    image: r.item.image,
    score: Number(r.score.toFixed(3)),
    signals: { name: Number(r.name.toFixed(3)), visual: Number(r.sem.toFixed(3)), category: Number(r.cat.toFixed(3)), brand: r.brand },
    visualEvidence: visualEvidencePayload(r.visualEvidence),
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
  // GERÇEK GÖRSEL EMBEDDING'İ — tarayıcının image-clip-embed.js ile ÖNCEDEN hesapladığı 512
  // boyutlu CLIP vektörü (bkz. dosya başı yorumu). Yoksa/bozuksa null: sistem metin kanalına düşer.
  let imageQueryVec = parseImageEmbedding(form.get('imageEmbedding'));

  const bytes = new Uint8Array(await file.arrayBuffer());
  // İçerik türü BEYANA değil MAGIC BYTE'a göre doğrulanır (mevcut /api/uploads ile aynı kural).
  const mime = sniffImageMime(bytes);
  if (!mime) return errorJson('Yalnızca PNG, JPG, JPEG ya da WEBP dosyaları desteklenir.');
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
  let hadCachedImageVec = false;
  let aiCalls = 0;
  try {
    const hit = await env.FACET_CACHE.get(cacheKey, 'json');
    if (hit && hit.vision) {
      vision = hydrateVision(hit.vision);
      // Vektör önbellekte int16 dizisi olarak (×10000) saklanır: 1024 float'ın JSON'u ~14 KB
      // yerine ~5 KB olur ve kosinüs için bu çözünürlük fazlasıyla yeterlidir.
      if (Array.isArray(hit.qv) && hit.qv.length === EMBED_DIM) queryVec = hit.qv.map(v => v / 10000);
      // Görsel embedding de AYNI görsel için önbellekten geri gelir — istemci WASM'ı bu kez
      // desteklemiyor/başarısız olsa BİLE (ör. farklı bir tarayıcıdan aynı görsel), önceki bir
      // istekte hesaplanmış GERÇEK vektör varsa kullanılır (brief madde 13: "stale embedding"
      // toleransının tersi — burada TAZE bir embedding'i BOŞA HARCAMAMAK).
      if (!imageQueryVec && Array.isArray(hit.iv) && hit.iv.length === IMAGE_EMBED_DIM) {
        imageQueryVec = new Float32Array(hit.iv.map(v => v / 10000));
        hadCachedImageVec = true;
      }
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
    if (!cached || (imageQueryVec && !hadCachedImageVec)) {
      try {
        await env.FACET_CACHE.put(cacheKey, JSON.stringify({
          vision, iv: imageQueryVec ? Array.from(imageQueryVec).map(v => Math.round(v * 10000)) : null,
        }), { expirationTtl: CACHE_TTL_SECONDS });
      } catch { /* yok sayılır */ }
    }
    return json({
      ok: true, cached, aiCalls,
      analysis: { isArchitectural: false, subject: vision.subject, spaceType: null, materials: [], products: [], description: vision.description || '' },
      match: { project: null, product: null },
      matchType: 'NO_MATCH',
      projects: [], products: [], productsSuppressed: true,
      message: 'Bu görselde mimari bir mekan ya da yapı ürünü tespit edilemedi. Bir iç mekan, cephe ya da ürün fotoğrafı deneyebilirsin.',
    });
  }

  // METİN embedding'i (bge-m3, yedek kanal) YALNIZCA gerçek görsel embedding'i YOKSA hesaplanır —
  // istemci genelde her zaman bir tane üretebildiğinden (WASM yaygın destekleniyor) bu, brief'in
  // maliyet ilkesiyle (madde 15/24: "gereksiz AI çağrısı yapma") uyumlu olarak AI çağrısını
  // çoğu istekte SIFIRA indirir — eskiden HER aramada 1 bge-m3 çağrısı ZORUNLUYDU.
  let queryText = null;
  if (!queryVec && !imageQueryVec) {
    queryText = buildQueryText(vision);
    if (queryText) {
      const [vec] = await embedTexts(env, [queryText]);
      if (vec && vec.length === EMBED_DIM) { queryVec = vec; aiCalls++; }
    }
  }
  if (!cached || (imageQueryVec && !hadCachedImageVec)) {
    try {
      await env.FACET_CACHE.put(cacheKey, JSON.stringify({
        vision,
        qv: queryVec ? queryVec.map(v => Math.round(v * 10000)) : null,
        iv: imageQueryVec ? Array.from(imageQueryVec).map(v => Math.round(v * 10000)) : null,
      }), { expirationTtl: CACHE_TTL_SECONDS });
    } catch { /* önbellek yazılamazsa sonuç yine döner */ }
  }

  const [projectPool, productPool, projectIndex, productIndex, projectImageIndex, productImageIndex] = await Promise.all([
    fetchActiveProjectPoolCached(env, 'built'),
    fetchProductPool(env),
    loadIndex(env, 'project'),
    loadIndex(env, 'product'),
    loadImageIndex(env, 'project'),
    loadImageIndex(env, 'product'),
  ]);

  // Dizin(ler) yoksa (ilk deploy, henüz kurulmadı) resolveVisualMatch otomatik olarak sözlüksel +
  // taksonomik yoldan ÇALIŞMAYA DEVAM EDER — bilerek yumuşak bir bağımlılık (brief madde 12).
  const resolved = resolveVisualMatch(vision, queryVec,
    { projectPool, productPool, projectIndex, productIndex, projectImageIndex, productImageIndex },
    imageQueryVec);

  return json({
    ok: true,
    cached,
    aiCalls,
    analysis: {
      isArchitectural: true,
      subject: vision.subject,
      model: vision.model || null,
      // visualChannel: bu aramanın "benzerlik" katmanı GERÇEK CLIP görsel embedding'i mi ('image')
      // yoksa yedek bge-m3 metin açıklaması embedding'i mi ('text') kullandı — gözlemlenebilirlik.
      visualChannel: resolved.visualChannel,
      imageEmbedModel: imageQueryVec ? IMAGE_EMBED_MODEL : null,
      embedModel: queryVec ? EMBED_MODEL : null,
      indexed: {
        project: projectIndex ? projectIndex.items.length : 0, product: productIndex ? productIndex.items.length : 0,
        projectImages: projectImageIndex ? projectImageIndex.entities.length : 0, productImages: productImageIndex ? productImageIndex.entities.length : 0,
      },
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
    // EXACT_PROJECT | SIMILAR_PROJECT | EXACT_PRODUCT | SIMILAR_PRODUCT | NO_MATCH — bkz.
    // resolveVisualMatch dosya içi yorumu.
    matchType: resolved.matchType,
    // TIER 2 — benzerler.
    projects: resolved.projects,
    products: resolved.products,
    productsSuppressed: resolved.productsSuppressed,
  });
}

// ---------------------------------------------------------------------------------------------
// POST /api/ai/image-embed — ARTIMLI GÖRSEL DİZİN GÜNCELLEMESİ (brief madde 8/18: "yeni proje/
// ürün görseli eklendiğinde index otomatik güncellensin").
//
// Sunucu HİÇBİR CNN çalıştırmaz — yalnızca proje-ekle.html/urun-ekle.html'in KAYIT ANINDA
// tarayıcıda (image-clip-embed.js) ÖNCEDEN hesapladığı 512 boyutlu vektörü doğrulayıp dizine
// EKLER. Bu, Workers'ın görsel embedding üretemediği (bkz. dosya başı yorumu) bir dünyada
// "yeni içerik otomatik indekslensin" isteğini karşılayan TEK sürdürülebilir yoldur.
//
// GÜVENLİK (brief madde 25 — "AI abuse"): giriş yapmış olmak yeterli, sahiplik KONTROL EDİLMEZ
// (mevcut /api/uploads ile AYNI gevşeklik — kullanıcı isteği: proje-ekle formunun admin/claim
// sahipliğine bakılmaksızın herkese açık gönderi kabul ettiği desenle tutarlı). Asıl güvenlik
// kapısı: (a) slug GERÇEKTEN var olan, silinmemiş bir D1 kaydına karşılık gelmeli — rastgele bir
// slug'a embedding EKLENEMEZ; (b) vektör sıkı doğrulanır (boyut + sonluluk + büyüklük); (c) hız
// sınırı (brief 24: kötüye kullanımı engelle).
// ---------------------------------------------------------------------------------------------
export async function handleImageEmbedAppendRoute(request, env, url) {
  if (url.pathname !== '/api/ai/image-embed' || request.method !== 'POST') return errorJson('Bulunamadı', 404);

  const user = await getSessionUser(request, env);
  if (!user) return errorJson('Bu işlem için giriş yapmalısın.', 401);

  if (!(await checkRateLimit(env, 'image-embed-append', user.id, 60, 10 * 60 * 1000))) {
    return errorJson('Çok fazla istek gönderdin, birkaç dakika sonra tekrar dene.', 429, { 'Retry-After': '600' });
  }

  let body;
  try { body = await request.json(); } catch { return errorJson('Geçersiz istek.'); }
  const type = body && body.type;
  if (type !== 'project' && type !== 'product') return errorJson('Geçersiz tür.');
  const slug = typeof body.slug === 'string' ? body.slug.trim().slice(0, 200) : '';
  const imageKey = typeof body.imageKey === 'string' ? body.imageKey.trim().slice(0, 500) : '';
  if (!slug || !imageKey) return errorJson('slug ve imageKey gerekli.');

  const vector = Array.isArray(body.embedding) ? body.embedding : null;
  if (!vector || vector.length !== IMAGE_EMBED_DIM) return errorJson(`embedding ${IMAGE_EMBED_DIM} boyutlu bir dizi olmalı.`);
  for (const v of vector) {
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 50) return errorJson('embedding geçersiz değer içeriyor.');
  }

  // Varlık GERÇEKTEN var mı? (bkz. dosya başı güvenlik notu — rastgele bir slug'a yazma kapatılır).
  const table = type === 'project' ? 'projects' : 'products';
  const row = await env.DB.prepare(`SELECT id FROM ${table} WHERE slug = ? AND deleted_at IS NULL`).bind(slug).first();
  if (!row) return errorJson('Kayıt bulunamadı.', 404);

  try {
    const result = await addEntityImageEmbedding(env, type, slug, imageKey, vector);
    return json({ ok: true, ...result });
  } catch (err) {
    console.error('image-embed-append başarısız', err && err.message);
    return errorJson('Görsel dizine eklenemedi.', 500);
  }
}
