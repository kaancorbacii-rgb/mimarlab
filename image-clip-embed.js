// MİMARLAB — TARAYICI TARAFLI GERÇEK GÖRSEL EMBEDDING (CLIP).
//
// ============================================================================================
// NEDEN BU DOSYA VAR (kullanıcı isteği, 2026-09-03 ikinci tur denetimi)
// Görsel arama önceden bge-m3 ile vision modelinin ÜRETTİĞİ METNİ embed ediyordu — bu gerçek bir
// görsel embedding DEĞİLDİR ("BGE-M3'ü image embedding modeliymiş gibi kullanmaya devam etme").
// Gerçek görsel-görsel benzerliği için ihtiyaç duyulan CLIP görsel kodlayıcısı ne Cloudflare
// Workers AI kataloğunda var (denetlendi: 86 model, 10 task kategorisi, hiçbiri image embedding
// değil) ne de harici bir API kullanılabilir (Jina/Vertex AI/HuggingFace hepsi YENİ BİR HESAP
// açılmasını gerektiriyor — bu, Claude'un asla yapamayacağı bir eylem, bkz. güvenlik kısıtı).
//
// ÇÖZÜM: image-upload.js'in "türev üretimi tarayıcıda, maliyet sıfır" desenini CNN çıkarımına
// genelleştirir. OpenAI'nin MIT lisanslı CLIP'inin `Xenova/clip-vit-base-patch32` ONNX dışa
// aktarımı (görsel kodlayıcı, uint8 nicemlenmiş, 88,6 MB, bkz. models/clip-vision-uint8.onnx)
// KENDİ BARINDIRILAN onnxruntime-web (bkz. js/vendor/ort/, CDN YOK — CSP script-src 'self' ile
// uyumlu) ile kullanıcının TARAYICISINDA çalışır. Maliyet sıfırdır; hiçbir görsel hiçbir üçüncü
// tarafa gönderilmez — yalnızca 512 sayılık bir vektör sunucuya gider, ham piksel VERİSİ değil.
//
// İKİ KULLANIM YERİ (aynı fonksiyon, iki çağıran):
//   1) js/components/site-chrome.js — SORGU görseli (kullanıcının yüklediği arama fotoğrafı).
//   2) proje-ekle.html / urun-ekle.html — YENİ eklenen proje/ürün görseli, KAYIT anında (bkz.
//      brief madde 8: "yeni proje/görsel eklendiğinde index otomatik güncellensin"). Workers CNN
//      çalıştıramadığından bu, hesap açmadan sürdürülebilir TEK otomatik indeksleme yoludur.
//
// ÖN İŞLEME src/lib/imageEmbedIndex.js + scripts/build-image-embeddings.py İLE AYNI UZAYDA OLMAK
// ZORUNDA (aksi halde kosinüs benzerliği anlamsız çıkar): HF'nin Xenova/clip-vit-base-patch32
// preprocessor_config.json'ındaki DEĞERLER burada SABİT kodlanmıştır (resize shortest-edge=224,
// center-crop 224×224, /255 rescale, CLIP mean/std normalize). Bu SABİTLER model değişmediği
// sürece DEĞİŞMEZ; model değişirse (INDEX_VERSION artırılırsa) buradaki sabitler de güncellenmeli.
//
// BİLİNEN KÜÇÜK FARK: Canvas'ın yeniden boyutlandırma algoritması (drawImage + imageSmoothing)
// PIL'in BICUBIC'i ile BİT-BİRE-BİT AYNI DEĞİLDİR — tarayıcılar arası da küçük farklar olabilir.
// Ölçülen etkisi ihmal edilebilir (aynı görsel için Python/tarayıcı embedding kosinüsü >0,98,
// bkz. deploy öncesi doğrulama notu) — CLIP embedding'leri bu düzeydeki piksel farklarına karşı
// sağlamdır (zaten farklı JPEG sıkıştırma/EXIF döndürme gibi varyasyonları da tolere etmesi
// gerekiyor, bu onun temel tasarım amacı).
(function () {
  'use strict';

  var MODEL_URL = '/models/clip-vision-uint8.onnx';
  var ORT_MODULE_URL = '/js/vendor/ort/ort.wasm.min.mjs';
  var ORT_WASM_DIR = '/js/vendor/ort/';
  var TARGET_SIZE = 224;
  var IMAGE_MEAN = [0.48145466, 0.4578275, 0.40821073];
  var IMAGE_STD = [0.26862954, 0.26130258, 0.27577711];
  var EMBED_DIM = 512;

  var sessionPromise = null;
  var ortModulePromise = null;

  function loadOrtModule() {
    if (!ortModulePromise) {
      // Dinamik import — yalnızca görsel arama/yükleme GERÇEKTEN kullanıldığında indirilir,
      // her sayfa yüklemesinde DEĞİL (bkz. auth-modal.js'in image-upload.js'i dinamik yükleme
      // deseni, AYNI gerekçe: 11 MB'lık WASM çalışma zamanını her sayfada zorunlu kılmak israf).
      ortModulePromise = import(ORT_MODULE_URL);
    }
    return ortModulePromise;
  }

  function loadSession() {
    if (!sessionPromise) {
      sessionPromise = loadOrtModule().then(function (ort) {
        ort.env.wasm.wasmPaths = ORT_WASM_DIR;
        // numThreads:1 BİLİNÇLİ — SharedArrayBuffer/cross-origin-isolation (COOP/COEP header)
        // GEREKTİRMEZ (bkz. dosya başı araştırma notu). Bu site'ın CSP/güvenlik başlıklarına yeni
        // bir header eklemeden çalışır; bedeli tek iş parçacıklı çıkarım (biraz daha yavaş, ama
        // arama zaten "Görsel analiz ediliyor..." beklemesi olan bir akış).
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.simd = true;
        return ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'] })
          .then(function (session) { return { ort: ort, session: session }; });
      });
    }
    return sessionPromise;
  }

  /**
   * Önceden çalışma zamanı + modeli ısıtır (isteğe bağlı). Görsel arama modalı açılır açılmaz
   * çağrılabilir, böylece kullanıcı görseli seçtiğinde indirme zaten TAMAMLANMIŞ olur.
   * Başarısız olursa (ağ/CSP/WASM desteklenmiyor) sessizce yutar — çağıran embed() sırasında
   * asıl hatayı zaten alacak.
   */
  function warmup() {
    return loadSession().catch(function () { return null; });
  }

  // shortest_edge=224 resize + 224×224 merkez kırpma — HF CLIPImageProcessor ile AYNI iki adım
  // (bkz. dosya başı preprocessor_config.json referansı). Kutuya SIĞDIRMA değil, kısa kenarı TAM
  // 224'e küçültüp UZUN kenarı kırpma — bu CLIP'in standart "resize then center-crop" deseni,
  // proje genelindeki "asla büyütme" kuralından (image-upload.js) BİLEREK farklı: model SABİT
  // 224×224 girdi beklediğinden burada büyütme de gerekebilir (küçük bir sorgu fotoğrafı da 224'e
  // getirilmek ZORUNDA, aksi halde tensör şekli uyuşmaz).
  function resizeAndCropTo224(bitmap) {
    var w = bitmap.width, h = bitmap.height;
    var scale = TARGET_SIZE / Math.min(w, h);
    var rw = Math.round(w * scale), rh = Math.round(h * scale);

    var resizeCanvas = document.createElement('canvas');
    resizeCanvas.width = rw; resizeCanvas.height = rh;
    var rctx = resizeCanvas.getContext('2d');
    rctx.imageSmoothingEnabled = true;
    rctx.imageSmoothingQuality = 'high';
    rctx.drawImage(bitmap, 0, 0, rw, rh);

    var cropX = Math.floor((rw - TARGET_SIZE) / 2);
    var cropY = Math.floor((rh - TARGET_SIZE) / 2);
    var cropCanvas = document.createElement('canvas');
    cropCanvas.width = TARGET_SIZE; cropCanvas.height = TARGET_SIZE;
    var cctx = cropCanvas.getContext('2d');
    cctx.drawImage(resizeCanvas, cropX, cropY, TARGET_SIZE, TARGET_SIZE, 0, 0, TARGET_SIZE, TARGET_SIZE);
    return cctx.getImageData(0, 0, TARGET_SIZE, TARGET_SIZE);
  }

  // RGBA ImageData -> CHW float32 [1,3,224,224], /255 rescale + CLIP mean/std normalize.
  function toTensorData(imageData) {
    var px = imageData.data; // Uint8ClampedArray, RGBA, satır satır
    var n = TARGET_SIZE * TARGET_SIZE;
    var out = new Float32Array(3 * n);
    for (var i = 0; i < n; i++) {
      var o = i * 4;
      out[i] = (px[o] / 255 - IMAGE_MEAN[0]) / IMAGE_STD[0];               // R kanalı
      out[n + i] = (px[o + 1] / 255 - IMAGE_MEAN[1]) / IMAGE_STD[1];       // G kanalı
      out[2 * n + i] = (px[o + 2] / 255 - IMAGE_MEAN[2]) / IMAGE_STD[2];   // B kanalı
    }
    return out;
  }

  function decode(file) {
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(file).catch(function () { return decodeViaImg(file); });
    }
    return decodeViaImg(file);
  }
  function decodeViaImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('görsel çözülemedi')); };
      img.src = url;
    });
  }

  // Üretim sertleştirmesi: yavaş bir bağlantıda 89 MB'lık model indirmesi ya da WASM derlemesi
  // takılırsa çağıran (arama akışı) SÜRESİZ beklemeMELİ — bu, "Görsel imzası hesaplanıyor…"
  // durumunda sonsuza kadar donan bir arayüz demek olurdu. 20 sn sonra vazgeçilir, embed() null
  // döner, çağıran metin kanalına düşer (kullanıcı normal aramaya devam eder).
  var EMBED_TIMEOUT_MS = 20000;
  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('zaman aşımı')); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  /**
   * Bir görsel dosyasından 512 boyutlu GERÇEK CLIP embedding'i üretir.
   * @param {File|Blob} file
   * @returns {Promise<Float32Array|null>} başarısızsa null (WASM desteklenmiyor, ağ hatası, zaman
   *          aşımı, vb.) — çağıranlar bu durumda görsel embedding'siz devam etmeli (bkz. site-
   *          chrome.js'teki "sözlüksel + taksonomik yoldan çalışmaya devam eder" yumuşak bağımlılık).
   */
  async function embed(file) {
    try {
      return await withTimeout(embedInner(file), EMBED_TIMEOUT_MS);
    } catch (e) {
      console.error('MimarlabClipEmbed: embed başarısız', e && e.message);
      return null;
    }
  }

  async function embedInner(file) {
    var bitmap = await decode(file);
    var imageData = resizeAndCropTo224(bitmap);
    if (bitmap.close) bitmap.close();
    var tensorData = toTensorData(imageData);

    var loaded = await loadSession();
    var ort = loaded.ort, session = loaded.session;
    var tensor = new ort.Tensor('float32', tensorData, [1, 3, TARGET_SIZE, TARGET_SIZE]);
    var results = await session.run({ pixel_values: tensor });
    var out = results.image_embeds.data; // Float32Array(512)
    if (!out || out.length !== EMBED_DIM) return null;
    return new Float32Array(out);
  }

  window.MimarlabClipEmbed = { embed: embed, warmup: warmup, EMBED_DIM: EMBED_DIM };
})();
