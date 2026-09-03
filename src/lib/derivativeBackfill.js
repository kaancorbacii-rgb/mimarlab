// Çalışma zamanında EKSİK responsive türev üretimi.
//
// NEDEN VAR (denetim bulgusu, 2026-09-03): türevleri üreten TEK kod scripts/generate-image-
// derivatives.py idi — elle çalıştırılan tek seferlik bir migration betiği. Yani /api/uploads'tan
// geçen HER YENİ görsel türevsiz kalıyordu: /media/_derived/... isteği sessizce ORİJİNALE düşüyor
// (bkz. upload.js#DERIVED_KEY_RE güvenlik ağı), sayfa tam boy görseli indiriyor ve iyileştirme o
// görsel için hiç devreye girmiyordu. Düzeltilmeseydi her yeni yüklemeden sonra betiği yeniden
// koşmak gerekirdi (2026-09-03'te 9,5 saat sürdü).
//
// NEDEN UPLOAD SIRASINDA DEĞİL, İSTEK ANINDA: env.IMAGES çağrıları Cloudflare'in "unique
// transformations" sayacına girer (5.000/ay ücretsiz, sonrası $0.50/1.000 — bkz. imageOptimize.js
// maliyet notu). Upload anında üç basamağı birden üretmek her yüklemeyi 1 yerine 4 transform'a
// çıkarırdı; üstelik yüklenen görsellerin çoğu hiçbir zaman her üç boyutta da istenmez. Bu yüzden
// türev YALNIZCA gerçekten o boyutta istendiğinde, bir kez üretilir ve kalıcı olarak R2'ye yazılır.
// İkinci istekten itibaren maliyet sıfırdır.
//
// KULLANICIYA GECİKME YANSIMAZ: üretim ctx.waitUntil içinde, yanıt döndükten SONRA çalışır. O anki
// istek orijinali alır (mevcut güvenlik ağı), sonraki istekler gerçek türevi alır. Bu yüzden
// fallback yanıtının kısa TTL'i (DERIVED_FALLBACK_EDGE_MAX_AGE_SECONDS) kritiktir — onsuz edge,
// yeni üretilen türevi bir yıl boyunca görmezdi.
//
// scripts/generate-image-derivatives.py İLE AYNI KURALLAR (ikisi farklılaşırsa aynı anahtar altında
// farklı içerik oluşur): WebP çıktı, asla büyütme yok, ve türev orijinalin %90'ından büyükse HİÇ
// YAZILMAZ (kazanç yoksa depolama harcamanın anlamı yok — o durumda fallback zaten orijinali
// servis etmeye devam eder, ki istenen davranış budur).
import { reserveR2Usage, finalizeR2Reservation, releaseR2Reservation } from './r2Quota.js';

const MIN_SAVING_RATIO = 0.90;
const OUTPUT_QUALITY = 85;
// SVG ölçeklenebilir (türev anlamsız), GIF ise animasyonunu kaybeder — imageOptimize.js'teki AYNI
// gerekçe ve image-cdn.js#DERIVATIVE_SKIP_RE ile aynı liste.
const SKIP_RE = /\.(svg|gif)(\?|$)/i;

// Aynı türev için eşzamanlı gelen istekler aynı isolate'te tekrar tekrar üretim başlatmasın diye
// süreç-içi kilit. Isolate'ler arasında paylaşılmaz (Workers'ta global bir kilit yok) — bu bir
// doğruluk garantisi DEĞİL, yalnızca en yaygın çift-üretim vakasını ucuza eleyen bir optimizasyon.
// Çift üretim zaten zararsızdır: aynı anahtara birebir aynı içerik yazılır.
const inFlight = new Set();

/**
 * Eksik bir türevi arka planda üretip R2'ye yazar. HİÇBİR durumda fırlatmaz — çağıran yanıtı
 * etkilenmemelidir.
 * @param {object} env
 * @param {string} derivedKey  tam R2 anahtarı: "_derived/w800/r2/u/<uid>/<uuid>.webp"
 * @param {number} width       hedef genişlik (400/800/1600)
 * @param {string} originalKey kaynak R2 anahtarı: "u/<uid>/<uuid>.webp"
 */
export async function backfillDerivative(env, derivedKey, width, originalKey) {
  if (!env || !env.IMAGES || !env.UPLOADS) return;
  if (!derivedKey || !originalKey || !Number.isFinite(width) || width <= 0) return;
  if (SKIP_RE.test(originalKey)) return;
  if (inFlight.has(derivedKey)) return;
  inFlight.add(derivedKey);

  let reservedBytes = 0;
  try {
    // Bu arada başka bir istek üretmiş olabilir (ya da isolate yeni başlamıştır) — head ucuz bir
    // Class B işlemidir, gereksiz bir transform'dan çok daha ucuz.
    if (await env.UPLOADS.head(derivedKey)) return;

    const source = await env.UPLOADS.get(originalKey);
    if (!source) return;
    const sourceSize = typeof source.size === 'number' ? source.size : 0;

    const result = await env.IMAGES.input(source.body)
      // height VERİLMEZ: yalnızca genişlik sınırlanır, oran korunur. scale-down asla büyütmez —
      // kaynak zaten hedeften darsa çıktı kaynakla aynı kalır ve aşağıdaki kazanç kontrolüne takılır.
      .transform({ width, fit: 'scale-down' })
      .output({ format: 'image/webp', quality: OUTPUT_QUALITY });
    const buffer = await (result.response()).arrayBuffer();
    if (!buffer || !buffer.byteLength) return;

    // Kazanç yoksa yazma (betikteki AYNI kural). sourceSize bilinmiyorsa (0) kontrol atlanır —
    // yazmamak, türevi hiç üretmemekle aynı sonuca (orijinale fallback) çıkardı.
    if (sourceSize && buffer.byteLength >= sourceSize * MIN_SAVING_RATIO) return;

    // Türev yazımı da depolama kotasına dahildir — betik wrangler ile doğrudan yazdığı için sayacı
    // atlıyordu (bkz. r2Quota.js dosya başı notu); UYGULAMA içinden yazılan her nesne sayılmalı,
    // aksi halde tavan gerçekte olduğundan uzakta sanılır.
    const quota = await reserveR2Usage(env, buffer.byteLength);
    if (!quota.ok) return;
    reservedBytes = buffer.byteLength;

    await env.UPLOADS.put(derivedKey, buffer, { httpMetadata: { contentType: 'image/webp' } });
    await finalizeR2Reservation(env, reservedBytes, buffer.byteLength);
    reservedBytes = 0;
  } catch (err) {
    // Yapılandırılmış log — imageOptimize.js#image_optimize_failed ile AYNI desen, böylece
    // Dashboard'da sıklığı izlenip sistemik bir arıza (kota/binding) tek seferlik bozuk bir
    // görselden ayırt edilebilir.
    console.error(JSON.stringify({ event: 'derivative_backfill_failed', derivedKey, width, reason: (err && err.message) || String(err) }));
  } finally {
    // Rezervasyon alındıysa ama put/finalize tamamlanmadıysa geri ver — hiç yazılmamış bir nesne
    // kotayı kalıcı tüketmesin (upload.js'teki AYNI rollback deseni).
    if (reservedBytes) {
      try { await releaseR2Reservation(env, reservedBytes); } catch { /* yut */ }
    }
    inFlight.delete(derivedKey);
  }
}
