// MİMARLAB — görsel yükleme boru hattı (TARAYICI tarafı türev üretimi).
//
// NEDEN BU DOSYA VAR
// Bu sitedeki responsive görseller, ücretli Cloudflare Image Transformations YERİNE R2'de ÖNCEDEN
// üretilmiş türevlerden servis edilir (bkz. image-cdn.js dosya başı: 2026-08-22'deki ~$16/ay
// faturası). Türevleri üretebilen TEK kod uzun süre elle çalıştırılan scripts/generate-image-
// derivatives.py idi — yani /api/uploads'tan geçen HER YENİ görsel türevsiz kalıyor,
// /media/_derived/... isteği sessizce ORİJİNALE düşüyor ve sayfa tam boy görseli indiriyordu.
// 2026-09-03'te bu boşluk önce env.IMAGES (Cloudflare Images binding) ile kapatılmaya çalışıldı;
// kullanıcı maliyet nedeniyle bunu REDDETTİ ve binding kalıcı olarak kapatıldı.
//
// ÇÖZÜM: türevleri TARAYICI üretir. Maliyeti sıfırdır (kullanıcının kendi CPU'su), hiçbir
// Cloudflare ürünü/aboneliği gerektirmez, istek anında hiçbir dönüşüm çalışmaz ve sonuç doğrudan
// kalıcı olarak R2'ye yazılır. Bu bir varsayım değil, bu depoda ZATEN KANITLANMIŞ bir desen:
// proje-ekle.html/urun-ekle.html'deki convertCopiedImageToWebp AI ile kopyalanan görselleri tam
// olarak böyle (canvas + toBlob('image/webp')) dönüştürüyordu. Bu dosya o deseni genelleştirir ve
// altı ayrı sayfaya kopyalanmış resizeImageForUpload/convertCopiedImageToWebp ikizlerini tek
// kaynağa indirir.
//
// NEDEN SUNUCUDA DEĞİL: Cloudflare Workers runtime'ında (workerd) Canvas/OffscreenCanvas API'si
// YOKTUR — env.IMAGES olmadan sunucuda gerçek bir yeniden boyutlandırma/WebP kodlama imkânsızdır
// (bu tespit proje-ekle.html'de 2026-09-01'den beri yazılıydı). Bir WASM kodek eklemek ise bu
// depodaki "sıfır npm bağımlılığı, bundler yok" kuralını (bkz. wrangler.jsonc) bozardı.
//
// KURALLAR scripts/generate-image-derivatives.py İLE BİREBİR AYNI OLMAK ZORUNDA — ikisi
// farklılaşırsa aynı R2 anahtarı altında farklı içerik oluşur:
//   * çıktı WebP, kalite 0.82  (betikteki QUALITY = 82)
//   * ASLA BÜYÜTME: kaynak bir basamaktan darsa o basamak hiç üretilmez
//   * KAZANÇ YOKSA YAZMA: türev, kaynağın %90'ından büyükse gönderilmez (MIN_SAVING_RATIO)
//   * ÇOK KÜÇÜK KAYNAK ATLANIR: 40 KB altındaki görsellerde 3 ek R2 nesnesi net kayıptır
//   * SVG/GIF hiç dokunulmaz (SVG ölçeklenebilir, GIF animasyonunu kaybeder)
//
// HER ADIM İSTEĞE BAĞLI BİR İYİLEŞTİRMEDİR: decode edilemeyen, WebP kodlanamayan (ör. çok eski bir
// tarayıcı) ya da herhangi bir noktada hata veren görselde fonksiyon ORİJİNAL dosyayı olduğu gibi
// döndürür ve yükleme akışı bugünkü davranışıyla birebir aynı şekilde devam eder. Türev üretilemeyen
// görseller sunucudaki bekleyen-iş kuyruğuna düşer (bkz. src/lib/derivativeIngest.js) ve
// scripts/generate-image-derivatives.py tarafından toplu olarak tamamlanır.
(function () {
  'use strict';

  // image-cdn.js#DERIVATIVE_WIDTHS, src/lib/imageDerivative.js#DERIVATIVE_WIDTHS ve
  // scripts/generate-image-derivatives.py#WIDTHS ile BİREBİR AYNI olmalı.
  var DERIVATIVE_WIDTHS = [400, 800, 1600];
  var DERIVATIVE_QUALITY = 0.82;
  var MIN_SAVING_RATIO = 0.90;
  var MIN_SOURCE_BYTES = 40 * 1024;
  // Canvas ile yeniden kodlanabilen tipler. GIF bilerek DIŞARIDA: canvas tek kareye indirger, yani
  // animasyonu sessizce yok ederdi (aynı gerekçe image-cdn.js#DERIVATIVE_SKIP_RE'de de var).
  var ENCODABLE_RE = /^image\/(jpeg|png|webp)$/;

  function decode(blob) {
    // createImageBitmap TEK BİR decode yapar ve sonucu dört çizimde (master + üç basamak) yeniden
    // kullandırır — kaynağı her basamak için yeniden çözmek mobilde en pahalı adım olurdu.
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(blob).catch(function () { return decodeViaImg(blob); });
    }
    return decodeViaImg(blob);
  }

  function decodeViaImg(blob) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  function sourceSize(bitmap) {
    var w = bitmap.width || bitmap.naturalWidth || 0;
    var h = bitmap.height || bitmap.naturalHeight || 0;
    return { width: w, height: h };
  }

  // Verilen kaynağı (w x h) hedef boyutta bir canvas'a çizip istenen tipte kodlar. Hiçbir durumda
  // fırlatmaz — kodlanamazsa null döner.
  function encode(bitmap, width, height, type, quality) {
    return new Promise(function (resolve) {
      try {
        var canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(bitmap, 0, 0, width, height);
        canvas.toBlob(function (blob) {
          // Tarayıcı istenen kodlayıcıyı desteklemiyorsa toBlob HATA FIRLATMAZ, sessizce başka bir
          // tiple (genelde image/png) döner — bu yüzden tip AÇIKÇA doğrulanır.
          resolve(blob && blob.type === type ? blob : null);
        }, type, quality);
      } catch (e) {
        resolve(null);
      }
    });
  }

  // Kutuya sığdırma (ASLA BÜYÜTMEZ): kaynak zaten kutudan küçükse boyut değişmez.
  function fitBox(w, h, maxEdge) {
    if (!maxEdge || (w <= maxEdge && h <= maxEdge)) return { width: w, height: h };
    if (w >= h) return { width: maxEdge, height: Math.max(1, Math.round(h * (maxEdge / w))) };
    return { width: Math.max(1, Math.round(w * (maxEdge / h))), height: maxEdge };
  }

  /**
   * Bir görsel dosyasını yüklemeye hazırlar: WebP'ye çevrilmiş/küçültülmüş bir "master" ve onun
   * w400/w800/w1600 türevleri.
   *
   * @param {File|Blob} file
   * @param {{maxEdge?: number, quality?: number}} opts
   * @returns {Promise<{file: File|Blob, derivatives: Object.<number, Blob>}>}
   *          Dönüştürülemeyen her durumda { file: <orijinal>, derivatives: {} } döner.
   */
  async function prepareImage(file, opts) {
    var options = opts || {};
    var maxEdge = options.maxEdge || 1600;
    var quality = typeof options.quality === 'number' ? options.quality : 0.85;
    var out = { file: file, derivatives: {} };
    if (!file || !ENCODABLE_RE.test(file.type)) return out;

    var bitmap = await decode(file);
    if (!bitmap) return out;

    try {
      var src = sourceSize(bitmap);
      if (!src.width || !src.height) return out;

      // 1) MASTER — R2'ye kanonik olarak yazılacak dosya. Kaynak zaten kutuya sığıyorsa yalnızca
      //    WebP'ye yeniden kodlanır (depolama kazancı), büyütülmez.
      var box = fitBox(src.width, src.height, maxEdge);
      var masterBlob = await encode(bitmap, box.width, box.height, 'image/webp', quality);
      // Yeniden kodlama dosyayı BÜYÜTTÜYSE (zaten iyi sıkıştırılmış küçük bir WebP/PNG olabilir)
      // orijinali kullan — R2'ye daha büyük bir dosya yazmanın hiçbir faydası yok.
      var master = (masterBlob && masterBlob.size < file.size)
        ? new File([masterBlob], 'upload.webp', { type: 'image/webp' })
        : file;
      out.file = master;

      // 2) TÜREVLER — master'ın kendisinden değil, ORİJİNAL bitmap'ten çizilir: iki kez kayıplı
      //    kodlamadan (orijinal -> master -> türev) geçirmek gereksiz kalite kaybı olurdu.
      //    Türev ölçüleri master'ın en-boy oranına göre hesaplanır (master ile aynı kadraj).
      if (master.size < MIN_SOURCE_BYTES) return out;
      for (var i = 0; i < DERIVATIVE_WIDTHS.length; i++) {
        var w = DERIVATIVE_WIDTHS[i];
        if (box.width <= w) continue; // ASLA BÜYÜTME
        var h = Math.max(1, Math.round(box.height * w / box.width));
        var blob = await encode(bitmap, w, h, 'image/webp', DERIVATIVE_QUALITY);
        if (!blob) continue;
        if (blob.size >= master.size * MIN_SAVING_RATIO) continue; // KAZANÇ YOKSA YAZMA
        out.derivatives[w] = blob;
      }
    } catch (e) {
      // Herhangi bir beklenmedik hata: en azından master'ı (varsa) koru, türevleri boş bırak.
      out.derivatives = {};
    } finally {
      if (bitmap && typeof bitmap.close === 'function') bitmap.close();
    }
    return out;
  }

  /**
   * /api/uploads'a POST edilmeye hazır FormData üretir. Çağrı noktaları kendi fetch/hata
   * yönetimlerini KORUR (bkz. her sayfadaki mevcut desen) — burada yalnızca gövde kurulur.
   *
   * @param {File|Blob} file
   * @param {{context?: string, maxEdge?: number, quality?: number, filename?: string}} opts
   * @returns {Promise<FormData>}
   */
  async function buildUploadForm(file, opts) {
    var options = opts || {};
    var prepared = await prepareImage(file, options);
    var form = new FormData();
    if (options.filename) form.append('file', prepared.file, options.filename);
    else form.append('file', prepared.file);
    if (options.context) form.append('context', options.context);
    // Alan adları src/lib/derivativeIngest.js#DERIVATIVE_FIELD ile aynı olmak zorunda.
    for (var i = 0; i < DERIVATIVE_WIDTHS.length; i++) {
      var w = DERIVATIVE_WIDTHS[i];
      if (prepared.derivatives[w]) form.append('d' + w, prepared.derivatives[w], 'd' + w + '.webp');
    }
    return form;
  }

  /**
   * ZATEN kendi /media/ origin'imizde duran bir görseli (tipik olarak /api/ai/copy-images'in dış
   * bir siteden indirdiği ham kopya) MİMARLAB standardına çevirip yeniden yükler ve YENİ url'i
   * döner. Başarısız olursa girdideki url aynen döner — dönüştürme opsiyonel bir iyileştirmedir,
   * akışı asla kesmez.
   *
   * Ham kopya R2'de kalır; mevcut /api/admin/r2-orphans temizleme aracı onu zaten süpürür (bkz.
   * proje-ekle.html'deki aynı tespit) — bu yüzden burada ayrıca bir silme adımı yok.
   */
  async function reuploadFromMediaUrl(mediaUrl, opts) {
    try {
      var res = await fetch(mediaUrl);
      if (!res.ok) return mediaUrl;
      var blob = await res.blob();
      // fetch'ten dönen Blob'un type'ı R2'deki Content-Type'tır; prepareImage yalnızca
      // jpeg/png/webp'i işler, diğerleri (GIF) olduğu gibi geri döner.
      var form = await buildUploadForm(blob, Object.assign({ filename: 'ai-import.webp' }, opts || {}));
      var up = await fetch('/api/uploads', { method: 'POST', body: form });
      var data = await up.json().catch(function () { return {}; });
      return (up.ok && data.url) ? data.url : mediaUrl;
    } catch (e) {
      return mediaUrl;
    }
  }

  // Görsel yükleyen sayfalar bu dosyayı <script src="image-upload.js"> ile alır. HER SAYFADA
  // yüklenen bileşenler (js/components/auth-modal.js) ise 15+ HTML dosyasına etiket eklemek yerine
  // dosyayı ihtiyaç anında dinamik olarak indirir — CSP uyumludur ("script-src 'self'", bkz.
  // src/index.js#CONTENT_SECURITY_POLICY) ve bileşen, dosya hiç yüklenemese bile eski (türevsiz)
  // yoluna geri düşer.
  window.MimarlabUpload = {
    DERIVATIVE_WIDTHS: DERIVATIVE_WIDTHS,
    prepareImage: prepareImage,
    buildUploadForm: buildUploadForm,
    reuploadFromMediaUrl: reuploadFromMediaUrl,
  };
})();
