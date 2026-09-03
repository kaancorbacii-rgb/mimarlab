// Yeni yüklenen bir görselin responsive türevlerini R2'ye yazar — İSTEMCİNİN ürettiği türevleri
// doğrulayarak.
//
// NEDEN İSTEMCİ ÜRETİYOR: Cloudflare Workers runtime'ında (workerd) Canvas/OffscreenCanvas API'si
// yoktur ve ücretli Cloudflare Image Transformations (env.IMAGES / /cdn-cgi/image) bu projede
// KALICI OLARAK KAPALIDIR (kullanıcı kararı, 2026-09-03 — bkz. wrangler.jsonc). Yani sunucuda
// gerçek bir yeniden boyutlandırma/WebP kodlama YAPILAMAZ. Türevleri tarayıcı üretir (bkz.
// image-upload.js), sunucu yalnızca DOĞRULAR ve kalıcı olarak yazar. Maliyet sıfırdır: istek
// anında hiçbir dönüşüm çalışmaz, yalnızca R2 depolaması kullanılır.
//
// GÜVENLİK MODELİ — istemciden gelen baytlara GÜVENİLMEZ:
//   1. Türev anahtarı, İSTEMCİNİN VERDİĞİ BİR DEĞERDEN DEĞİL, sunucunun az önce ürettiği taze
//      `u/<uid>/<uuid>.<ext>` orijinal anahtarından deterministik olarak türetilir. Anahtar her
//      zaman yeni ve benzersizdir; var olan hiçbir nesnenin (ne orijinal ne türev) üzerine
//      yazılması MÜMKÜN DEĞİLDİR. Bu, "aynı anahtar farklı içerikle overwrite edilirse edge'de
//      bayat içerik kalır" sınıfını tamamen ortadan kaldırır.
//   2. Baytlar magic-byte ile WebP olarak doğrulanır (src/routes/upload.js#sniffImageMime ile aynı
//      ilke: beyan edilen Content-Type'a asla güvenilmez).
//   3. GERÇEK piksel genişliği WebP başlığından okunur ve beklenen basamağa EŞİT olmak zorundadır —
//      aksi halde istemci 1600 px'lik bir dosyayı w400 anahtarının altına koyabilir ve site küçük
//      bir slot için büyük bir görsel indirirdi (yani iyileştirmenin tersi).
//   4. Kazanç kuralı (< orijinalin %90'ı) SUNUCUDA da uygulanır — istemci atlamış olsa bile.
//   5. Her yazım R2 kota muhasebesinden geçer (bkz. src/lib/r2Quota.js); reddedilirse ya da yazım
//      başarısız olursa rezervasyon geri verilir.
//
// HİÇBİR DURUMDA FIRLATMAZ: türev üretimi isteğe bağlı bir iyileştirmedir, yükleme yanıtını asla
// etkilemez. Üretilemeyen basamaklar bekleyen-iş kuyruğuna yazılır (aşağıdaki recordPendingWidths)
// ve scripts/generate-image-derivatives.py tarafından toplu olarak tamamlanır.
import { reserveR2Usage, finalizeR2Reservation, releaseR2Reservation } from './r2Quota.js';

// image-cdn.js#DERIVATIVE_WIDTHS, src/lib/imageDerivative.js, image-upload.js ve
// scripts/generate-image-derivatives.py#WIDTHS ile BİREBİR AYNI olmalı.
export const DERIVATIVE_WIDTHS = [400, 800, 1600];
const MIN_SAVING_RATIO = 0.90;
// image-upload.js#MIN_SOURCE_BYTES ile aynı: bu boyutun altındaki kaynaklarda 3 ek R2 nesnesinin
// depolama/işlem maliyeti, kazandırdığı baytlardan büyüktür.
const MIN_SOURCE_BYTES = 40 * 1024;
// Bir türev hiçbir zaman orijinalden büyük olamaz; bu, bozuk/kötü niyetli bir gövdenin R2'ye
// yazılmadan önce takıldığı ilk (en ucuz) kontroldür.
const MAX_DERIVATIVE_BYTES = 4 * 1024 * 1024;
// SVG ölçeklenebilir (türev anlamsız), GIF animasyonunu kaybeder — image-cdn.js#DERIVATIVE_SKIP_RE
// ve generate-image-derivatives.py#SKIP_EXT ile aynı liste.
const SKIP_RE = /\.(svg|gif)$/i;

/**
 * image-cdn.js#derivativeUrl / src/lib/imageDerivative.js#derivedImageUrl ile AYNI anahtar biçimi.
 * Kaynak her zaman bir R2 nesnesi olduğundan ayraç sabit "r2".
 */
export function derivedKeyFor(originalKey, width) {
  return `_derived/w${width}/r2/${originalKey}`;
}

// RIFF konteynerindeki WebP'nin GERÇEK piksel genişliği. Üç kodlama de desteklenir çünkü tarayıcılar
// hangisini üreteceğini kendileri seçer: canvas.toBlob kalite < 1 iken "VP8 " (kayıplı), alfa kanalı
// varsa "VP8X" (genişletilmiş konteyner), kalite = 1 iken bazı tarayıcılarda "VP8L" (kayıpsız).
// Tanınmayan/bozuk bir gövdede 0 döner ve çağıran o türevi reddeder.
function webpWidth(bytes) {
  if (bytes.length < 30) return 0;
  // "RIFF" .... "WEBP"
  if (!(bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
     && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)) return 0;
  const fourcc = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (fourcc === 'VP8 ') {
    // Kayıplı: 3 baytlık frame tag (20-22), ardından 0x9D 0x01 0x2A senkron kodu (23-25), sonra
    // 14 bitlik genişlik (26-27, little-endian).
    if (!(bytes[23] === 0x9D && bytes[24] === 0x01 && bytes[25] === 0x2A)) return 0;
    return ((bytes[27] << 8) | bytes[26]) & 0x3FFF;
  }
  if (fourcc === 'VP8L') {
    // Kayıpsız: 0x2F imzası (20), ardından 14 bitlik (genişlik - 1).
    if (bytes[20] !== 0x2F) return 0;
    return (((bytes[22] & 0x3F) << 8) | bytes[21]) + 1;
  }
  if (fourcc === 'VP8X') {
    // Genişletilmiş: 24 bitlik (tuval genişliği - 1), little-endian, offset 24.
    return (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1;
  }
  return 0;
}

async function readDerivative(part, width, originalBytes) {
  if (!part || typeof part === 'string') return null;
  if (!part.size || part.size > MAX_DERIVATIVE_BYTES) return null;
  // Kazanç kuralı SUNUCUDA da uygulanır (bkz. dosya başı, madde 4) — istemci atlamış olabilir.
  if (part.size >= originalBytes * MIN_SAVING_RATIO) return null;
  const buffer = await part.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (webpWidth(bytes) !== width) return null;
  return buffer;
}

/**
 * İstemcinin gönderdiği türevleri doğrulayıp R2'ye yazar. Yazılamayan/gönderilmeyen basamakları
 * döner — çağıran bunları bekleyen-iş kuyruğuna kaydeder.
 *
 * @returns {Promise<{written: number[], pending: number[]}>}
 */
export async function ingestClientDerivatives(env, form, originalKey, originalBytes) {
  const written = [];
  const pending = [];
  // Türevi anlamsız olan kaynaklar hiç kuyruğa da girmez: betik de bunları atlardı, kuyrukta
  // sonsuza kadar "bekliyor" görünmeleri gerçek boşlukları gizlerdi.
  if (SKIP_RE.test(originalKey) || originalBytes < MIN_SOURCE_BYTES) return { written, pending };

  // BİR BASAMAĞIN GELMEMESİ HER ZAMAN ARIZA DEĞİLDİR. İstemci, betikle AYNI kuralları uygular ve
  // bir basamağı BİLEREK üretmez: kaynak o basamaktan darsa (büyütme yasak) ya da türev orijinalin
  // %90'ından büyükse (kazanç yok). En yaygın örnek: master zaten 1600 px ise w1600 hiçbir zaman
  // üretilmez. Bunları kuyruğa yazmak, betiğin her koşuda kaynağı boşuna indirip AYNI kuralla yine
  // hiçbir şey yazmamasına yol açardı — yani kuyruk gerçek boşlukları gizleyen kalıcı bir gürültüyle
  // dolardı (canlı doğrulamada birebir gözlendi).
  //
  // AYIRIM: alan HİÇ GÖNDERİLMEMİŞSE bilinçli bir atlamadır — AMA yalnızca istemci boru hattının
  // gerçekten çalıştığını biliyorsak. Boru hattı hiç çalışmamışsa (WebP kodlayamayan eski tarayıcı,
  // decode hatası, /api/ai/copy-images'in sunucu tarafı kopyası) HİÇBİR alan gelmez — o zaman
  // eksiklik gerçektir ve kuyruğa girer. Alan GÖNDERİLMİŞ ama reddedilmişse (bozuk gövde, yanlış
  // genişlik, kota) bu her hâlükârda gerçek bir arızadır ve kuyruğa girer.
  const clientRan = DERIVATIVE_WIDTHS.some(w => {
    const part = form.get(`d${w}`);
    return part && typeof part !== 'string' && part.size > 0;
  });

  for (const width of DERIVATIVE_WIDTHS) {
    let reserved = 0;
    try {
      const part = form.get(`d${width}`);
      const supplied = !!part && typeof part !== 'string' && part.size > 0;
      const buffer = supplied ? await readDerivative(part, width, originalBytes) : null;
      if (!buffer) {
        if (supplied || !clientRan) pending.push(width);
        continue;
      }
      const quota = await reserveR2Usage(env, buffer.byteLength);
      if (!quota.ok) { pending.push(width); continue; }
      reserved = buffer.byteLength;
      await env.UPLOADS.put(derivedKeyFor(originalKey, width), buffer, {
        httpMetadata: { contentType: 'image/webp' },
      });
      await finalizeR2Reservation(env, reserved, buffer.byteLength);
      reserved = 0;
      written.push(width);
    } catch (err) {
      // Yapılandırılmış log — src/lib/logger.js ile aynı desen, Dashboard'da
      // `event = "derivative_ingest_failed"` ile sıklığı izlenebilir.
      console.error(JSON.stringify({
        event: 'derivative_ingest_failed', originalKey, width,
        reason: (err && err.message) || String(err),
      }));
      pending.push(width);
    } finally {
      // Rezervasyon alındıysa ama yazım tamamlanmadıysa geri ver — hiç yazılmamış bir nesne kotayı
      // kalıcı tüketmesin (src/routes/upload.js'teki AYNI rollback deseni).
      if (reserved) { try { await releaseR2Reservation(env, reserved); } catch { /* yut */ } }
    }
  }
  return { written, pending };
}

/**
 * Üretilemeyen basamakları D1'deki bekleyen-iş kuyruğuna yazar (bkz. migrations/
 * 0081_image_derivative_queue.sql).
 *
 * NEDEN BİR KUYRUK VAR: scripts/generate-image-derivatives.py'nin eski çalışma biçimi, TÜM sitedeki
 * her kaynak için basamak başına bir HEAD isteği atmaktı — 26.333 kaynak x 3 basamak = ~79.000
 * istek, 2026-09-03 turunda 9,5 SAAT. Yeni görsel sayısı bunun binde biri olduğundan bu tamamen
 * israftı. Kuyruk sayesinde betik "neyin eksik olduğunu" ARAMAK zorunda kalmaz, doğrudan okur:
 * iş, üretildiği anda kaydedilir. Var olan 23.767 türev bir daha ASLA yeniden işlenmez.
 *
 * Hiçbir durumda fırlatmaz — kuyruğa yazılamaması yüklemeyi bozmamalı (en kötü ihtimalle o görsel
 * türevsiz kalır ve tam-tarama bir betik koşusuyla yine yakalanır).
 */
export async function recordPendingWidths(env, originalKey, widths) {
  if (!widths.length) return;
  try {
    const now = Date.now();
    await env.DB.batch(widths.map(width => env.DB.prepare(
      `INSERT OR IGNORE INTO image_derivative_queue (r2_key, width, created_at) VALUES (?, ?, ?)`
    ).bind(originalKey, width, now)));
  } catch (err) {
    console.error(JSON.stringify({
      event: 'derivative_queue_write_failed', originalKey,
      reason: (err && err.message) || String(err),
    }));
  }
}

/**
 * Bir orijinal görsel R2'den silindiğinde onun bekleyen kuyruk satırlarını da temizler — aksi halde
 * kuyruk, ARTIK VAR OLMAYAN kaynaklar için sonsuza kadar iş taşırdı (betik her koşuda 404 alır ve
 * satır hiç düşmezdi). Türev NESNELERİNİN silinmesi ayrı bir yerde, src/lib/canonicalSync.js#
 * withDerivativeKeys'te yapılır.
 */
export async function clearPendingForKeys(env, originalKeys) {
  if (!originalKeys.length) return;
  try {
    for (let i = 0; i < originalKeys.length; i += 100) {
      const chunk = originalKeys.slice(i, i + 100);
      await env.DB.prepare(
        `DELETE FROM image_derivative_queue WHERE r2_key IN (${chunk.map(() => '?').join(',')})`
      ).bind(...chunk).run();
    }
  } catch (err) {
    console.error(JSON.stringify({
      event: 'derivative_queue_cleanup_failed', keyCount: originalKeys.length,
      reason: (err && err.message) || String(err),
    }));
  }
}
