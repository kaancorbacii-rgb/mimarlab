// MİMARLAB — görsel büyütme + kırpma penceresi (kullanıcı isteği, 2026-09-02; 2026-09-04'te
// SERBEST ORANLI kırpmayı da kapsayacak şekilde genişletildi).
//
// NEREDE KULLANILIR
//   * kisi-ekle    — profil fotoğrafı            (aspect: 1, ZORUNLU kare)
//   * firma-ekle   — logo                        (aspect: 1)
//   * marka-ekle   — logo (aspect: 1) + KAPAK    (aspect: 'free')
//   * urun-ekle    — ürün galerisi               (aspect: 'free')
//   * proje-ekle   — proje galerisi              (aspect: 'free', büyütülmüş işaretçi editöründen)
//   * js/components/auth-modal.js — Hesabım > profil fotoğrafı (aspect: 1)
//
// KULLANICI İSTEĞİ (2026-09-04): "Tüm düzenle sayfalarında görsel yükleme alanlarında görsele
// tıklayınca görsel büyüsün ve görseli kırpma özelliği aktif olsun. Ama logo ve profil fotoğrafları
// sadece kare yani 1:1 boyutlarında kırpılabilsin." Bu yüzden:
//   * Pencere artık görselin TAMAMINI büyütülmüş olarak gösterir (eski sürümde yalnızca kare bir
//     gözetleme deliği vardı; görselin dışarıda kalan kısmı hiç görünmüyordu).
//   * Kadraj, görselin üzerinde SÜRÜKLENEBİLİR/KÖŞELERİNDEN BOYUTLANDIRILABİLİR bir dikdörtgendir.
//   * aspect bir SAYIYSA (logo/profil için 1) dikdörtgen o oranı korur — kullanıcı 1:1 dışına
//     çıkamaz. aspect 'free' ise oran serbesttir.
//
// DAVRANIŞ
//   * open() bir File/Blob VEYA bizim origin'imizdeki bir görsel URL'i alır (zaten yüklenmiş bir
//     görseli yeniden kırpmak için — çağıran dönen dosyayı yeniden yükler).
//   * "Vazgeç"/Esc/dışarı tıklama null döndürür: çağıran HİÇBİR ŞEY almaz. Yükleme akışında bu
//     "kırpmadan yükleme yok" demektir (kullanıcı isteği, 2026-09-03); mevcut bir görseli yeniden
//     kırparken ise "değişiklik yapma" demektir.
//   * centerSquare() yardımcı olarak DURUYOR (dışarıdan çağrılabilir).
//
// TASARIM KARARI — neden ayrı bir dosya ve neden Promise: altı ayrı çağrı noktası (beşi HTML, biri
// modal bileşeni) aynı davranışı istiyor. Her birine kopyalanmış bir kırpma UI'ı, bu depoda daha
// önce yaşanan "aynı listeyi üç yerde elle senkron tutma" hatasının (bkz. profession-shared.js)
// görsel karşılığı olurdu. Tek giriş noktası: ImageCrop.open(kaynak, opts) -> Promise<File|null>.
//
// KAPALI DEVRE: hiçbir dış bağımlılık yok (canvas + pointer olayları). CSP'ye takılmaz.
(function () {
  const SQUARE_OUT_SIZE = 800;   // 1:1 çıktı kenarı (px) — logo/avatar için fazlasıyla yeterli
  const FREE_MAX_EDGE = 2400;    // serbest kırpmada uzun kenar tavanı (yükleme boru hattı zaten küçültür)
  const OUT_TYPE = 'image/jpeg';
  const OUT_QUALITY = 0.92;
  const MIN_RECT_PX = 28;        // ekranda bir kadrajın inebileceği en küçük kenar

  function isCroppableFile(file) {
    return !!file && /^image\/(jpeg|png|webp)$/.test(file.type);
  }

  function loadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image load failed'));
      img.src = url;
    });
  }

  // GERÇEK BULGU (2026-09-04, tarayıcıda tekrar üretildi): object URL'i <img> yüklenir yüklenmez
  // revoke etmek, o URL'i SONRADAN kullanan her tüketiciyi kırar. Eski kod tam bunu yapıyordu ve
  // open() aşağıda `stageImg.src = img.src` diyerek AYNI (artık iptal edilmiş) URL'e ikinci bir
  // istek açıyordu: pencere içindeki görsel 0x0 yükleniyor, kadraj sıfır boyutlu bir şeride
  // çöküyor ve ölçü etiketi saçmalıyordu ("23408 × 23408 px"). URL artık pencere KAPANANA kadar
  // yaşar; iptal cleanup()'ta yapılır (resolved.revoke).
  function loadImage(file) {
    const url = URL.createObjectURL(file);
    return loadImageFromUrl(url)
      .then((img) => ({ img, revoke: () => URL.revokeObjectURL(url) }))
      .catch((err) => { URL.revokeObjectURL(url); throw err; });
  }

  // open()'ın kabul ettiği üç kaynak tipini TEK bir {img, name, revoke} şekline indirger.
  // Dize verilirse KENDİ origin'imizdeki bir /media/... yolu beklenir; <img> ile doğrudan
  // yüklenir (fetch+blob'a gerek yok, canvas aynı origin olduğu için kirlenmez).
  const NOOP = () => {};
  async function resolveSource(source) {
    if (typeof source === 'string') {
      const img = await loadImageFromUrl(source);
      return { img, name: 'crop.jpg', revoke: NOOP };
    }
    if (!isCroppableFile(source)) return null;
    const { img, revoke } = await loadImage(source);
    return { img, name: source.name || 'crop.jpg', revoke };
  }

  function canvasToFile(canvas, name) {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) { resolve(null); return; }
        resolve(new File([blob], name || 'crop.jpg', { type: OUT_TYPE }));
      }, OUT_TYPE, OUT_QUALITY);
    });
  }

  // Kaynak görselden verilen dikdörtgeni (kaynak pikselinde) hedef boyuta çizip dosya üretir.
  // Şeffaf PNG/WEBP JPEG'e çevrilirken siyah zemine düşmesin diye önce beyaz doldurulur
  // (bkz. [[project_to_webp_alpha_black_silhouette_2026_09_04]] — aynı tuzağın tarayıcı tarafı).
  async function renderCrop(img, sx, sy, sw, sh, outW, outH, name) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(outW));
    canvas.height = Math.max(1, Math.round(outH));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvasToFile(canvas, name);
  }

  // Kırpma YAPILMADIĞINDA kullanılabilecek varsayılan: görselin ORTASINDAN kare al.
  async function centerSquare(file) {
    if (!isCroppableFile(file)) return file;
    let loaded;
    try { loaded = await loadImage(file); } catch { return file; }
    const { img, revoke } = loaded;
    try {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const out = await renderCrop(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2,
        side, side, SQUARE_OUT_SIZE, SQUARE_OUT_SIZE, 'crop.jpg');
      return out || file;
    } finally { revoke(); }
  }

  function injectStyles() {
    if (document.getElementById('image-crop-styles')) return;
    const el = document.createElement('style');
    el.id = 'image-crop-styles';
    el.textContent = [
      '.ic-overlay{position:fixed; inset:0; z-index:2200; display:flex; align-items:center;',
      '  justify-content:center; padding:20px; background:rgba(15,19,26,.72);}',
      /* Panel artık görselin TAMAMINI büyütülmüş gösterdiği için geniş (eski sürüm 420px'lik bir
         kare gözetleme deliğiydi, bkz. dosya başı). */
      '.ic-panel{width:min(860px,100%); max-height:calc(100vh - 40px); overflow:auto;',
      '  background:var(--paper-card,#fff); color:var(--ink,#1B2A3D);',
      '  border-radius:16px; padding:20px; box-shadow:0 20px 60px rgba(15,19,26,.35);}',
      '.ic-title{font-size:16px; font-weight:700; margin:0 0 4px;}',
      '.ic-sub{font-size:12.5px; color:var(--ink-soft,#6B7C90); margin:0 0 14px;}',
      /* Sahne: görsel "contain" ile sığar, .ic-frame görselin GERÇEK ekran kutusuna shrink-wrap
         olur — kadraj yüzdeleri böylece doğrudan görselin kendi kutusuna göre hesaplanır. */
      '.ic-stage{display:flex; align-items:center; justify-content:center; background:#0f131a;',
      '  border-radius:12px; padding:10px; overflow:hidden;}',
      '.ic-frame{position:relative; line-height:0; touch-action:none; user-select:none;',
      '  -webkit-user-select:none;}',
      '.ic-frame img{display:block; max-width:none; max-height:none;',
      '  pointer-events:none; -webkit-user-drag:none;}',
      /* Kadrajın DIŞI karartılır: dev bir box-shadow ile (ayrı 4 maske düğümü gerekmez). */
      '.ic-rect{position:absolute; box-sizing:border-box; border:1.5px solid #fff; cursor:move;',
      '  box-shadow:0 0 0 9999px rgba(15,19,26,.55);}',
      /* Üçte-bir kılavuzları — kadrajı hizalamayı kolaylaştırır. */
      '.ic-rect::before,.ic-rect::after{content:""; position:absolute; inset:0; pointer-events:none;}',
      '.ic-rect::before{background-image:linear-gradient(to right,transparent 33.33%,rgba(255,255,255,.32) 33.33%,rgba(255,255,255,.32) 33.5%,transparent 33.5%,transparent 66.66%,rgba(255,255,255,.32) 66.66%,rgba(255,255,255,.32) 66.83%,transparent 66.83%);}',
      '.ic-rect::after{background-image:linear-gradient(to bottom,transparent 33.33%,rgba(255,255,255,.32) 33.33%,rgba(255,255,255,.32) 33.5%,transparent 33.5%,transparent 66.66%,rgba(255,255,255,.32) 66.66%,rgba(255,255,255,.32) 66.83%,transparent 66.83%);}',
      '.ic-handle{position:absolute; width:16px; height:16px; background:#fff; border-radius:3px;',
      '  box-shadow:0 1px 4px rgba(15,19,26,.45);}',
      '.ic-handle[data-corner="nw"]{left:-8px; top:-8px; cursor:nwse-resize;}',
      '.ic-handle[data-corner="ne"]{right:-8px; top:-8px; cursor:nesw-resize;}',
      '.ic-handle[data-corner="sw"]{left:-8px; bottom:-8px; cursor:nesw-resize;}',
      '.ic-handle[data-corner="se"]{right:-8px; bottom:-8px; cursor:nwse-resize;}',
      '.ic-meta{font-size:11.5px; color:var(--ink-soft,#6B7C90); margin:10px 0 0; text-align:center;}',
      /* Oran ön ayarları (kullanıcı isteği, 2026-09-04: "2:1, 4:3 gibi alternatif kırpma oranları
         öneri olarak çıksın"). Yalnızca oranı KİLİTLİ OLMAYAN çağrılarda gösterilir; logo/profil
         1:1'e sabitlendiği için orada bu satır hiç basılmaz. */
      '.ic-ratios{display:flex; flex-wrap:wrap; gap:6px; justify-content:center; margin:12px 0 0;}',
      '.ic-ratio{padding:6px 12px; border-radius:999px; font-family:inherit; font-size:12.5px;',
      '  font-weight:600; cursor:pointer; background:none; color:var(--ink,#1B2A3D);',
      '  border:1px solid var(--line,#D8E0E8);}',
      '.ic-ratio[aria-pressed="true"]{background:var(--ink,#1B2A3D); color:#fff;',
      '  border-color:var(--ink,#1B2A3D);}',
      /* Önizleme küçük resmi (bkz. enableThumbCrop) — tıklanabilir olduğu imleçle belli olsun. */
      '.ic-thumb-clickable{cursor:zoom-in;}',
      '.ic-actions{display:flex; gap:10px; margin-top:14px;}',
      '.ic-btn{flex:1; padding:11px 14px; border-radius:10px; font-family:inherit; font-size:14px;',
      '  font-weight:600; cursor:pointer; border:1px solid var(--line,#D8E0E8);}',
      '.ic-btn-primary{background:var(--ink,#1B2A3D); color:#fff; border-color:var(--ink,#1B2A3D);}',
      '.ic-btn-ghost{background:none; color:var(--ink,#1B2A3D);}',
      '@media (max-width:640px){',
      '  .ic-panel{padding:14px;}',
      '  .ic-frame img{max-height:44vh;}',
      '}',
    ].join('\n');
    document.head.appendChild(el);
  }

  /**
   * open(kaynak, opts) -> Promise<File|null>
   *   kaynak : File | Blob | string(/media/... URL'i)
   *   opts   : { title, sub, aspect }
   *            aspect — sayı (ör. 1 => 1:1 KİLİTLİ) veya 'free' (serbest). Varsayılan 1'dir:
   *            eski çağrı noktaları (logo/profil fotoğrafı) hiçbir değişiklik yapmadan kare
   *            kırpmaya devam etsin diye.
   * Kullanıcı vazgeçerse null döner. Desteklenmeyen bir dosya türü verilirse dosya OLDUĞU GİBİ
   * geri döner (kırpılamaz ama akış engellenmez).
   */
  // Serbest kırpmada önerilen oranlar. `null` = serbest. Sıra ekrandaki sıradır.
  const RATIO_PRESETS = [
    { label: 'Serbest', value: null },
    { label: '1:1', value: 1 },
    { label: '4:3', value: 4 / 3 },
    { label: '3:2', value: 3 / 2 },
    { label: '2:1', value: 2 },
    { label: '16:9', value: 16 / 9 },
    { label: '3:4', value: 3 / 4 },
    { label: '2:3', value: 2 / 3 },
  ];

  function open(source, opts) {
    const options = opts || {};
    // Çağıran SAYI verdiyse oran KİLİTLİDİR (logo/profil için 1) ve ön ayar şeridi hiç basılmaz;
    // 'free' verdiyse kullanıcı şeritten oran seçebilir, başlangıçta serbesttir.
    const lockedAspect = options.aspect === 'free' ? null : (Number(options.aspect) || 1);
    const allowRatioChoice = lockedAspect === null;
    let aspect = lockedAspect;
    if (typeof source !== 'string' && !isCroppableFile(source)) return Promise.resolve(source);
    injectStyles();
    const title = options.title || 'Görseli kırp';
    const sub = options.sub || (aspect === 1
      ? 'Kare (1:1) alan seç. Kadrajı sürükle, köşelerinden boyutlandır.'
      : 'Kadrajı sürükle, köşelerinden boyutlandır. Oran serbest.');

    return resolveSource(source).then((resolved) => new Promise((resolve) => {
      const img = resolved.img;
      const overlay = document.createElement('div');
      overlay.className = 'ic-overlay';
      overlay.innerHTML =
        '<div class="ic-panel" role="dialog" aria-modal="true">'
        + '<p class="ic-title"></p><p class="ic-sub"></p>'
        + '<div class="ic-stage"><div class="ic-frame">'
        + '<div class="ic-rect">'
        + '<span class="ic-handle" data-corner="nw"></span><span class="ic-handle" data-corner="ne"></span>'
        + '<span class="ic-handle" data-corner="sw"></span><span class="ic-handle" data-corner="se"></span>'
        + '</div></div></div>'
        + '<p class="ic-meta"></p>'
        + (allowRatioChoice
          ? '<div class="ic-ratios">' + RATIO_PRESETS.map(function (r, i) {
              return '<button type="button" class="ic-ratio" data-ratio="' + i + '" aria-pressed="'
                + (i === 0 ? 'true' : 'false') + '">' + r.label + '</button>';
            }).join('') + '</div>'
          : '')
        + '<div class="ic-actions">'
        + '<button type="button" class="ic-btn ic-btn-ghost">Vazgeç</button>'
        + '<button type="button" class="ic-btn ic-btn-primary">Kırp ve Kullan</button>'
        + '</div></div>';
      overlay.querySelector('.ic-title').textContent = title;
      overlay.querySelector('.ic-sub').textContent = sub;
      overlay.querySelector('.ic-panel').setAttribute('aria-label', title);
      document.body.appendChild(overlay);

      const frame = overlay.querySelector('.ic-frame');
      const stage = overlay.querySelector('.ic-stage');
      const rectEl = overlay.querySelector('.ic-rect');
      const metaEl = overlay.querySelector('.ic-meta');
      // ZATEN YÜKLENMİŞ <img> düğümünün KENDİSİ sahneye konur; `src` kopyalanıp İKİNCİ bir istek
      // açılmaz. Böylece hem yukarıdaki revoke tuzağı tümden ortadan kalkar hem de görsel ikinci
      // kez çözülmez (büyük fotoğraflarda gözle görülür gecikme).
      const stageImg = img;
      stageImg.alt = '';
      frame.insertBefore(stageImg, frame.firstChild);

      // Kadraj, ÇERÇEVE PİKSELİNDE tutulur (çerçeve kaynağın oranını birebir korur, bu yüzden
      // ekrandaki oran = kaynaktaki oran). Pencere yeniden boyutlandığında oransal olarak taşınır.
      let frameW = 0, frameH = 0;
      let rect = { x: 0, y: 0, w: 0, h: 0 };

      // Verilen çerçeve içine, istenen orana uyan EN BÜYÜK ortalanmış dikdörtgeni kurar.
      function initialRect(fw, fh) {
        if (!aspect) return { x: 0, y: 0, w: fw, h: fh };
        let w = fw, h = fw / aspect;
        if (h > fh) { h = fh; w = fh * aspect; }
        return { x: (fw - w) / 2, y: (fh - h) / 2, w, h };
      }

      function paint() {
        rectEl.style.left = rect.x + 'px';
        rectEl.style.top = rect.y + 'px';
        rectEl.style.width = rect.w + 'px';
        rectEl.style.height = rect.h + 'px';
        const scale = img.naturalWidth / (frameW || 1);
        metaEl.textContent = `${Math.round(rect.w * scale)} × ${Math.round(rect.h * scale)} px`;
      }

      // Çerçeve ölçüsü değiştiğinde (ilk yerleşim, pencere boyutu) kadrajı ORANSAL koru.
      //
      // GÖRÜNTÜLENECEK BOYUT, GÖRSELİN O ANKİ YERLEŞİMİNDEN DEĞİL; kaynağın DOĞAL ölçüsünden ve
      // sahnenin kutusundan türetilir. Eski sürüm `frame.style.width`i `stageImg.clientWidth`ten
      // yazıyordu, ama `.ic-frame img`in `max-width:100%`i de aynı frame'e çözülüyordu: measure()
      // her çağrıldığında (complete + load + rAF + resize = en az 3 kez) görsel bir tık daha
      // küçülüyor, kadraj MIN_RECT_PX'e çöküyor ve ölçek patlıyordu. Yeni hesap İDEMPOTENT —
      // aynı girdilerle kaç kez çalışırsa çalışsın aynı sonucu verir.
      function measure() {
        const natW = img.naturalWidth, natH = img.naturalHeight;
        if (!natW || !natH) return;
        const stagePad = 20;                       // .ic-stage padding:10px * 2
        const availW = Math.max(80, (stage.clientWidth || 640) - stagePad);
        const availH = Math.max(80, Math.min(window.innerHeight * 0.58, 520));
        const k = Math.min(availW / natW, availH / natH);
        const w = Math.max(1, Math.round(natW * k));
        const h = Math.max(1, Math.round(natH * k));
        if (w === frameW && h === frameH) return;  // yerleşim değişmediyse kadrajı hiç oynatma
        if (!frameW || !frameH) { rect = initialRect(w, h); }
        else {
          const kx = w / frameW, ky = h / frameH;
          rect = { x: rect.x * kx, y: rect.y * ky, w: rect.w * kx, h: rect.h * ky };
        }
        frameW = w; frameH = h;
        // Hem çerçeveye hem görsele AÇIK ölçü yazılır; böylece görselin yerleşimi bir daha
        // çerçevenin ölçüsüne (dolayısıyla kendi geçmişine) bağlı olmaz.
        frame.style.width = w + 'px';
        frame.style.height = h + 'px';
        stageImg.style.width = w + 'px';
        stageImg.style.height = h + 'px';
        clampRect();
        paint();
      }

      // Kadrajı çerçeve içinde tutar; oran kilitliyse önce oranı, sonra sınırları uygular.
      function clampRect() {
        if (aspect) {
          // Oranı korurken çerçeveye sığmıyorsa küçült.
          let w = rect.w, h = w / aspect;
          if (h > frameH) { h = frameH; w = h * aspect; }
          if (w > frameW) { w = frameW; h = w / aspect; }
          rect.w = w; rect.h = h;
        } else {
          rect.w = Math.min(rect.w, frameW);
          rect.h = Math.min(rect.h, frameH);
        }
        rect.w = Math.max(MIN_RECT_PX, rect.w);
        rect.h = Math.max(MIN_RECT_PX, rect.h);
        rect.x = Math.min(Math.max(0, rect.x), Math.max(0, frameW - rect.w));
        rect.y = Math.min(Math.max(0, rect.y), Math.max(0, frameH - rect.h));
      }

      // Görsel <img> olarak yerleşmeden clientWidth 0'dır — bir kare sonra ve yükleme olayında
      // yeniden ölçülür (eski sürümdeki AYNI "ilk çizim 0 genişlikle yapılıyor" tuzağı).
      if (stageImg.complete) measure();
      stageImg.addEventListener('load', measure);
      requestAnimationFrame(measure);
      window.addEventListener('resize', measure);

      // ---- sürükleme / boyutlandırma (Pointer Events: fare + dokunma TEK yol) ----
      let drag = null;   // {mode:'move'|corner, startX, startY, start:{...}}
      function onDown(e) {
        const corner = e.target.classList && e.target.classList.contains('ic-handle')
          ? e.target.dataset.corner : null;
        if (!corner && e.target !== rectEl) return;
        e.preventDefault();
        drag = { mode: corner || 'move', startX: e.clientX, startY: e.clientY, start: { ...rect } };
        frame.setPointerCapture(e.pointerId);
      }
      function onMove(e) {
        if (!drag) return;
        const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
        const s = drag.start;
        if (drag.mode === 'move') {
          rect.x = s.x + dx; rect.y = s.y + dy;
        } else {
          // Sabit kalan köşe (anchor) hareket eden köşenin karşısıdır.
          const anchorX = drag.mode.includes('w') ? s.x + s.w : s.x;
          const anchorY = drag.mode.includes('n') ? s.y + s.h : s.y;
          let movedX = (drag.mode.includes('w') ? s.x : s.x + s.w) + dx;
          let movedY = (drag.mode.includes('n') ? s.y : s.y + s.h) + dy;
          movedX = Math.min(Math.max(0, movedX), frameW);
          movedY = Math.min(Math.max(0, movedY), frameH);
          let w = Math.abs(movedX - anchorX), h = Math.abs(movedY - anchorY);
          if (aspect) {
            // Kilitli oranda iki kenardan hangisi daha çok büyüdüyse onu esas al, diğerini türet;
            // sonra ankraja göre yeniden yerleştir (çerçeve dışına taşarsa aşağıdaki clamp keser).
            if (w / aspect > h) h = w / aspect; else w = h * aspect;
            const dirX = movedX >= anchorX ? 1 : -1;
            const dirY = movedY >= anchorY ? 1 : -1;
            // Oran türetildikten sonra çerçeveyi aşabilir — ankrajdan itibaren kalan yere sığdır.
            const availX = dirX > 0 ? frameW - anchorX : anchorX;
            const availY = dirY > 0 ? frameH - anchorY : anchorY;
            if (w > availX) { w = availX; h = w / aspect; }
            if (h > availY) { h = availY; w = h * aspect; }
            rect.x = dirX > 0 ? anchorX : anchorX - w;
            rect.y = dirY > 0 ? anchorY : anchorY - h;
            rect.w = w; rect.h = h;
          } else {
            rect.x = Math.min(anchorX, movedX);
            rect.y = Math.min(anchorY, movedY);
            rect.w = w; rect.h = h;
          }
        }
        clampRect();
        paint();
      }
      function onUp(e) {
        if (!drag) return;
        drag = null;
        try { frame.releasePointerCapture(e.pointerId); } catch (err) { /* zaten bırakılmış */ }
      }
      frame.addEventListener('pointerdown', onDown);
      frame.addEventListener('pointermove', onMove);
      frame.addEventListener('pointerup', onUp);
      frame.addEventListener('pointercancel', onUp);

      function cleanup() {
        window.removeEventListener('resize', measure);
        overlay.remove();
        resolved.revoke();   // object URL'i BURADA bırakılır (bkz. loadImage'deki not)
      }

      async function useCrop() {
        const scale = img.naturalWidth / (frameW || 1);
        const sx = rect.x * scale, sy = rect.y * scale;
        const sw = Math.max(1, rect.w * scale), sh = Math.max(1, rect.h * scale);
        let outW, outH;
        if (lockedAspect === 1) {
          outW = outH = SQUARE_OUT_SIZE;   // logo/avatar: sabit 800×800 (eski davranış)
        } else {
          const k = Math.min(1, FREE_MAX_EDGE / Math.max(sw, sh));
          outW = sw * k; outH = sh * k;
        }
        const f = await renderCrop(img, sx, sy, sw, sh, outW, outH, resolved.name);
        cleanup();
        resolve(f);
      }

      // Vazgeçme: hiçbir şey döndürülmez (null). Yükleme akışında "kırpılmamış görsel kabul edilmez"
      // (kullanıcı isteği, 2026-09-03), mevcut bir görseli yeniden kırparken "değişiklik yapma".
      function cancel() { cleanup(); resolve(null); }

      // Oran seçimi: yeni oran uygulanırken kadrajın MERKEZİ korunur, alan olabildiğince büyük
      // tutulur — kullanıcı "4:3" deyince kadraj sıfırlanıp köşeye kaçmasın.
      overlay.querySelectorAll('.ic-ratio').forEach(function (btn) {
        btn.addEventListener('click', function () {
          aspect = RATIO_PRESETS[Number(btn.dataset.ratio)].value;
          overlay.querySelectorAll('.ic-ratio').forEach(function (b) {
            b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
          });
          if (aspect) {
            const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
            const fit = initialRect(frameW, frameH);          // orana uyan EN BÜYÜK dikdörtgen
            const w = Math.min(fit.w, Math.max(rect.w, rect.h * aspect));
            const h = w / aspect;
            rect = { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
          }
          clampRect();
          paint();
        });
      });

      overlay.querySelector('.ic-btn-primary').addEventListener('click', useCrop);
      overlay.querySelector('.ic-btn-ghost').addEventListener('click', cancel);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) cancel(); });
      document.addEventListener('keydown', function esc(e) {
        if (e.key !== 'Escape' || !document.body.contains(overlay)) return;
        document.removeEventListener('keydown', esc);
        cancel();
      });
    })).catch(function () {
      // Görsel açılamadıysa kırpma yaptırılamaz; sessizce kırpılmamış bir dosya kabul etmek yerine
      // null döndürülür. Çağıran kullanıcıya bilgi verir / akışı olduğu gibi bırakır.
      return null;
    });
  }

  /**
   * enableThumbCrop(imgEl, opts) — bir ÖNİZLEME küçük resmini "tıklayınca büyüyüp kırpılabilen"
   * hâle getirir (kullanıcı isteği, 2026-09-04: "Tüm düzenle sayfalarında görsel yükleme
   * alanlarında görsele tıklayınca görsel büyüsün ve görseli kırpma özelliği aktif olsun").
   *
   *   opts.source    File|Blob|string — kırpılacak KAYNAK. Verilmezse imgEl'in kendi src'si
   *                  kullanılır; bu, henüz yüklenmemiş bir dosyanın blob: URL'i de olabilir.
   *                  Dosyanın kendisi elde varsa onu geçmek daha iyidir (blob: URL'lerin ömrü
   *                  yeniden render'da revoke ile bitebilir).
   *   opts.aspect    1 (logo/profil — 1:1 KİLİTLİ) veya 'free'. Varsayılan 'free'.
   *   opts.title     pencere başlığı.
   *   opts.onCropped(file) — kullanıcı "Kırp ve Kullan" derse çağrılır. Vazgeçerse HİÇ çağrılmaz.
   *   opts.guard()   — false dönerse tıklama YUTULUR. Sürükle-bırak sıralaması olan ızgaralar
   *                  bunu kullanır: tarayıcı bir sürüklemenin ardından da click üretebilir ve
   *                  aksi halde her sıralamadan sonra kırpma penceresi açılırdı (bkz.
   *                  proje-ekle.html/urun-ekle.html#dragJustFinished).
   *
   * Tek çağrı noktasında bir kez bağlanır; çağıranların her render'da yeniden bağlaması normaldir
   * (önizleme ızgaraları innerHTML ile yeniden kurulur, düğüm de dinleyicisi de yenidir).
   */
  function enableThumbCrop(imgEl, opts) {
    if (!imgEl) return;
    const options = opts || {};
    injectStyles();
    imgEl.classList.add('ic-thumb-clickable');
    imgEl.title = options.title || 'Büyüt ve kırp';
    imgEl.addEventListener('click', async (e) => {
      // Önizleme öğesi bazı sayfalarda sürükle-bırak sıralamasının/işaretçi editörünün de hedefi —
      // tıklamanın oralara kabarmasını engelle.
      e.preventDefault();
      e.stopPropagation();
      if (options.guard && !options.guard()) return;
      const src = options.source || imgEl.currentSrc || imgEl.src;
      if (!src) return;
      let file = null;
      try { file = await open(src, { title: options.title || 'Görseli kırp', aspect: options.aspect || 'free' }); }
      catch (err) { file = null; }
      if (file && options.onCropped) options.onCropped(file);
    });
  }

  window.ImageCrop = { open, centerSquare, enableThumbCrop };
})();
