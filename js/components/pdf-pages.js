// pdf-pages.js — bir PDF'i SAYFA SAYFA görsele çevirir (kullanıcı isteği, 2026-09-08: "Portfolyo
// kutusuna görsel ya da pdf yüklenecek … kişi popupında pdf'in her sayfasını tek tek sırayla
// göstereceksin").
//
// NEDEN YÜKLEME ANINDA, GÖRÜNTÜLEME ANINDA DEĞİL
// PDF'i olduğu gibi saklayıp pop-up'ta çizmek, SİTEYİ GEZEN HERKESE ~1,7 MB'lık bir PDF çalışma
// zamanı (pdf.js + worker) indirtirdi — üstelik kişi pop-up'ının ilk-yük bütçesi bilinçli olarak
// dar tutuluyor (bkz. js/components/lazy-modals.js dosya başı). Bunun yerine PDF, YÜKLEYEN kişinin
// tarayıcısında bir kez sayfa sayfa WebP'ye çevrilir ve her sayfa portfolyoya AYRI bir görsel
// olarak girer. Sonuç:
//   * ziyaretçi tarafı hiçbir PDF kodu yüklemez — sayfalar sıradan görsellerdir,
//   * mevcut galeri/lightbox (gallery.js) ve responsive türev boru hattı (image-upload.js) hiçbir
//     değişiklik olmadan çalışır,
//   * sıralama, görseller ile PDF sayfaları arasında ayrım yapmaz (kullanıcı isteği: "Görsellerin
//     ya da pdf sayfalarının sırası değiştirilebilsin").
// Bu, image-upload.js'in "türevleri TARAYICI üretir, maliyeti sıfırdır" kararının aynısıdır.
//
// KENDİ BARINDIRILAN pdf.js (js/vendor/pdfjs/) — CDN YOK: CSP script-src 'self' (+ 'unsafe-inline',
// unpkg yalnızca Leaflet için) ve worker'lar için worker-src YOK → child-src → default-src 'self'.
// Yani pdf.worker'ı unpkg'den yüklemek CSP tarafından SESSİZCE engellenirdi. js/vendor/ort/ ile
// AYNI desen (bkz. image-clip-embed.js#ORT_MODULE_URL).
(function () {
  'use strict';

  var MODULE_URL = '/js/vendor/pdfjs/pdf.min.mjs';
  var WORKER_URL = '/js/vendor/pdfjs/pdf.worker.min.mjs';

  // Vektör bir sayfayı rasterleştirirken hedef uzun kenar. image-upload.js zaten kendi maxEdge'ine
  // göre bir kez daha küçültür; buradaki değer "okunur bir portfolyo sayfası" için taban çözünürlük.
  var DEFAULT_MAX_EDGE = 1600;
  var DEFAULT_QUALITY = 0.85;
  // Tek bir PDF'ten üretilecek en fazla sayfa. Portfolyo tavanı zaten 30 öğe (bkz. kisi-ekle.html#
  // MAX_PORTFOLIO_ITEMS ve src/lib/submissionTypes.js#MAX_PORTFOLIO_ITEMS); bu sınır ayrıca 200
  // sayfalık bir sunum dosyasının tarayıcıyı kilitlemesini engeller.
  var DEFAULT_MAX_PAGES = 30;
  // Ölçek tavanı — çok küçük sayfalı (ör. 200x200 pt) bir PDF'te maxEdge/genişlik oranı çok büyük
  // çıkabilir; sınırsız bırakılsa tek bir sayfa için yüzlerce megabaytlık bir canvas ayrılırdı.
  var MAX_SCALE = 4;

  var libPromise = null;

  function isPdf(file) {
    if (!file) return false;
    if (file.type === 'application/pdf') return true;
    // Bazı sistemler PDF'i type'sız ya da 'application/octet-stream' olarak verir — uzantıya da bak.
    return /\.pdf$/i.test(file.name || '');
  }

  function loadLib() {
    if (libPromise) return libPromise;
    libPromise = import(MODULE_URL).then(function (mod) {
      var lib = (mod && mod.getDocument) ? mod : (mod && mod.default) || mod;
      if (!lib || !lib.getDocument) throw new Error('pdf.js yüklenemedi.');
      lib.GlobalWorkerOptions.workerSrc = WORKER_URL;
      return lib;
    }).catch(function (err) {
      libPromise = null; // sonraki denemede yeniden yüklensin (ağ hatası kalıcı olmasın)
      throw err;
    });
    return libPromise;
  }

  function canvasToFile(canvas, name, quality) {
    return new Promise(function (resolve) {
      // WebP: image-upload.js#prepareImage ile AYNI hedef biçim. Kodlanamazsa (çok eski tarayıcı)
      // PNG'ye düşülür — sunucu kapısı (src/routes/upload.js#sniffImageMime) ikisini de kabul eder.
      canvas.toBlob(function (blob) {
        if (blob) return resolve(new File([blob], name + '.webp', { type: 'image/webp' }));
        canvas.toBlob(function (pngBlob) {
          resolve(pngBlob ? new File([pngBlob], name + '.png', { type: 'image/png' }) : null);
        }, 'image/png');
      }, 'image/webp', quality);
    });
  }

  // PDF -> File[] (her sayfa için bir görsel, BELGE SIRASINDA). Hiçbir sayfa çizilemezse boş dizi
  // döner; çağıran (kisi-ekle.html) bunu kullanıcıya "PDF okunamadı" olarak bildirir.
  async function toImages(file, opts) {
    opts = opts || {};
    var maxEdge = opts.maxEdge || DEFAULT_MAX_EDGE;
    var quality = opts.quality || DEFAULT_QUALITY;
    var maxPages = opts.maxPages || DEFAULT_MAX_PAGES;
    var lib = await loadLib();
    var data = new Uint8Array(await file.arrayBuffer());
    // isEvalSupported:false — CSP'de 'unsafe-eval' YOK (yalnızca 'wasm-unsafe-eval'); pdf.js bazı
    // font/renk dönüşümlerinde eval'e başvurabildiğinden bu bayrak açıkça kapatılır.
    // useSystemFonts:true — gömülü olmayan 14 standart font (Helvetica/Times…) sistem fontlarından
    // ikame edilir; böylece standard_fonts/ klasörünü ayrıca barındırmaya gerek kalmaz.
    var doc = await lib.getDocument({ data: data, isEvalSupported: false, useSystemFonts: true }).promise;
    var out = [];
    try {
      var baseName = (file.name || 'portfolyo').replace(/\.pdf$/i, '').slice(0, 60) || 'portfolyo';
      var pageCount = Math.min(doc.numPages, maxPages);
      for (var i = 1; i <= pageCount; i++) {
        if (typeof opts.onProgress === 'function') opts.onProgress(i, pageCount);
        var page = await doc.getPage(i);
        try {
          var base = page.getViewport({ scale: 1 });
          var scale = Math.min(maxEdge / Math.max(base.width, base.height), MAX_SCALE);
          if (!(scale > 0) || !isFinite(scale)) scale = 1;
          var viewport = page.getViewport({ scale: scale });
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(viewport.width));
          canvas.height = Math.max(1, Math.round(viewport.height));
          var ctx = canvas.getContext('2d');
          // PDF sayfasının boyanmamış alanları SAYDAMDIR; saydam bir WebP galeri/lightbox'ta koyu
          // zeminde siyah bir dikdörtgen gibi görünürdü (bkz. proje geçmişi: to_webp alfa → siyah
          // siluet). Sayfa çizilmeden ÖNCE beyaza boyanır — kâğıdın kendisi zaten beyazdır.
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          // intent:'print' — GÖRÜNÜRLÜK TUZAĞI (canlıda/yerelde doğrulandı): pdf.js varsayılan
          // 'display' amacında çizimi requestAnimationFrame ile parça parça ilerletir; SEKME ARKA
          // PLANA ALINDIĞINDA rAF hiç tetiklenmez ve dönüştürme, kullanıcı sekmeye geri dönene
          // kadar "sayfalara ayrılıyor… (1/N)" satırında SONSUZA KADAR asılı kalır (bu kod tabanında
          // bilinen bir tuzağın aynısı: gizli sekmede slayt geçişlerinin donması). pdf.js'in kendi
          // kaynağında rAF yalnızca 'display' için açılır (useRequestAnimationFrame:!isPrintIntent),
          // 'print' amacı setTimeout tabanlı zamanlayıcıyı kullanır — yani burada 'print' seçmek,
          // yükleme sırasında başka bir sekmeye geçen kullanıcının dönüştürmesinin arka planda
          // sürmesini sağlar. Çıktı bizim için aynıdır: sayfa, basılacağı hâliyle rasterleşir.
          await page.render({ canvasContext: ctx, viewport: viewport, intent: 'print' }).promise;
          var pageFile = await canvasToFile(canvas, baseName + '-sayfa-' + i, quality);
          if (pageFile) out.push(pageFile);
          canvas.width = canvas.height = 0; // mobil Safari'de canvas belleğini hemen bırak
        } finally {
          page.cleanup();
        }
      }
    } finally {
      try { await doc.destroy(); } catch (e) { /* yoksay */ }
    }
    return out;
  }

  window.PdfPages = { isPdf: isPdf, toImages: toImages };
})();
