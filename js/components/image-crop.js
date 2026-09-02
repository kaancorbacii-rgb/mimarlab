// MİMARLAB — 1:1 görsel kırpma penceresi (kullanıcı isteği, 2026-09-02).
//
// NEREDE KULLANILIR: kisi-ekle (profil fotoğrafı), firma-ekle / marka-ekle (logo) ve
// js/components/auth-modal.js (Hesabım > profil fotoğrafı). Marka KAPAK görseli bilinçli olarak
// KAPSAM DIŞIDIR — o geniş/yatay bir bant, kare kırpmak onu bozardı.
//
// DAVRANIŞ (kullanıcı isteği):
//   * Kullanıcı bir logo/fotoğraf seçtiğinde kırpma penceresi açılır, kare çerçeveyi sürükleyip
//     yakınlaştırarak kadraj seçebilir.
//   * Kullanıcı KIRPMAZSA (pencereyi kapatır/atlar) görsel yine de 1:1 olur: ortadan kare kırpılır.
//     Yani "kırpma yok" durumu ham/çarpık bir görsel değil, makul bir varsayılan üretir.
//
// TASARIM KARARI — neden ayrı bir dosya ve neden Promise: dört ayrı form (üçü HTML, biri modal
// bileşeni) aynı davranışı istiyor. Her birine kopyalanmış bir kırpma UI'ı, bu depoda daha önce
// yaşanan "aynı listeyi üç yerde elle senkron tutma" hatasının (bkz. profession-shared.js) görsel
// karşılığı olurdu. Tek giriş noktası: ImageCrop.open(file) -> Promise<File>.
//
// KAPALI DEVRE: hiçbir dış bağımlılık yok (canvas + pointer olayları). CSP'ye takılmaz.
(function () {
  const OUT_SIZE = 800;          // çıktı kenarı (px) — logo/avatar için fazlasıyla yeterli
  const OUT_TYPE = 'image/jpeg';
  const OUT_QUALITY = 0.9;

  function isCroppable(file) {
    return !!file && /^image\/(jpeg|png|webp)$/.test(file.type);
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
      img.src = url;
    });
  }

  function canvasToFile(canvas, name) {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) { resolve(null); return; }
        resolve(new File([blob], name || 'crop.jpg', { type: OUT_TYPE }));
      }, OUT_TYPE, OUT_QUALITY);
    });
  }

  // Kırpma YAPILMADIĞINDA kullanılan varsayılan: görselin ORTASINDAN kare al.
  async function centerSquare(file) {
    if (!isCroppable(file)) return file;
    let img;
    try { img = await loadImage(file); } catch { return file; }
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = OUT_SIZE; canvas.height = OUT_SIZE;
    const ctx = canvas.getContext('2d');
    // Şeffaf PNG/WEBP JPEG'e çevrilirken siyah zemine düşmesin.
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, OUT_SIZE, OUT_SIZE);
    ctx.drawImage(img, sx, sy, side, side, 0, 0, OUT_SIZE, OUT_SIZE);
    const out = await canvasToFile(canvas, 'crop.jpg');
    return out || file;
  }

  function injectStyles() {
    if (document.getElementById('image-crop-styles')) return;
    const el = document.createElement('style');
    el.id = 'image-crop-styles';
    el.textContent = [
      '.ic-overlay{position:fixed; inset:0; z-index:2200; display:flex; align-items:center;',
      '  justify-content:center; padding:20px; background:rgba(15,19,26,.62);}',
      '.ic-panel{width:min(420px,100%); background:var(--paper-card,#fff); color:var(--ink,#1B2A3D);',
      '  border-radius:16px; padding:20px; box-shadow:0 20px 60px rgba(15,19,26,.35);}',
      '.ic-title{font-size:16px; font-weight:700; margin:0 0 4px;}',
      '.ic-sub{font-size:12.5px; color:var(--ink-soft,#6B7C90); margin:0 0 14px;}',
      /* Kare sahne: görsel burada "cover" gibi konumlanır, kullanıcı sürükleyerek kadrajı seçer. */
      '.ic-stage{position:relative; width:100%; aspect-ratio:1/1; overflow:hidden; border-radius:12px;',
      '  background:#0f131a; touch-action:none; cursor:grab; user-select:none;}',
      '.ic-stage.dragging{cursor:grabbing;}',
      '.ic-stage canvas{position:absolute; inset:0; width:100%; height:100%; display:block;}',
      '.ic-zoom{display:flex; align-items:center; gap:10px; margin-top:12px;}',
      '.ic-zoom input{flex:1;}',
      '.ic-zoom span{font-size:11.5px; color:var(--ink-soft,#6B7C90); white-space:nowrap;}',
      '.ic-actions{display:flex; gap:10px; margin-top:16px;}',
      '.ic-btn{flex:1; padding:11px 14px; border-radius:10px; font-family:inherit; font-size:14px;',
      '  font-weight:600; cursor:pointer; border:1px solid var(--line,#D8E0E8);}',
      '.ic-btn-primary{background:var(--ink,#1B2A3D); color:#fff; border-color:var(--ink,#1B2A3D);}',
      '.ic-btn-ghost{background:none; color:var(--ink,#1B2A3D);}',
    ].join('\n');
    document.head.appendChild(el);
  }

  // open(file) -> Promise<File>. HER ZAMAN bir File döner (kırpılmış ya da ortadan kare);
  // çağıran tarafın "kullanıcı vazgeçti mi" diye ayrıca kontrol etmesi gerekmez.
  function open(file, opts) {
    if (!isCroppable(file)) return Promise.resolve(file);
    injectStyles();
    const title = (opts && opts.title) || 'Görseli kırp';
    const sub = (opts && opts.sub) || 'Kare (1:1) alan seç. Sürükleyerek konumlandır, kaydırıcıyla yakınlaştır.';

    return loadImage(file).then((img) => new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'ic-overlay';
      overlay.innerHTML =
        '<div class="ic-panel" role="dialog" aria-modal="true" aria-label="' + title + '">'
        + '<p class="ic-title"></p><p class="ic-sub"></p>'
        + '<div class="ic-stage"><canvas></canvas></div>'
        + '<div class="ic-zoom"><span>Yakınlaştır</span><input type="range" min="100" max="300" value="100" aria-label="Yakınlaştır"></div>'
        + '<div class="ic-actions">'
        + '<button type="button" class="ic-btn ic-btn-ghost">Kırpmadan Kullan</button>'
        + '<button type="button" class="ic-btn ic-btn-primary">Kırp ve Kullan</button>'
        + '</div></div>';
      overlay.querySelector('.ic-title').textContent = title;
      overlay.querySelector('.ic-sub').textContent = sub;
      document.body.appendChild(overlay);

      const canvas = overlay.querySelector('canvas');
      const range = overlay.querySelector('input[type=range]');
      const stage = overlay.querySelector('.ic-stage');
      const ctx = canvas.getContext('2d');

      // Sahne piksel boyutu — cihaz oranını hesaba katarak net çizim.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let view = 0;
      function sizeCanvas() {
        view = Math.round(stage.clientWidth);
        canvas.width = Math.round(view * dpr);
        canvas.height = Math.round(view * dpr);
      }

      // baseScale: görselin kısa kenarını kareye sığdıran ölçek ("cover"). zoom bunun katı.
      const natMin = Math.min(img.naturalWidth, img.naturalHeight);
      let zoom = 1, offX = 0, offY = 0;   // offset: merkezden sapma (sahne pikseli)

      function clamp() {
        const scale = (view / natMin) * zoom;
        const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
        const maxX = Math.max(0, (w - view) / 2), maxY = Math.max(0, (h - view) / 2);
        offX = Math.min(maxX, Math.max(-maxX, offX));
        offY = Math.min(maxY, Math.max(-maxY, offY));
        return { scale, w, h };
      }

      function draw() {
        const { w, h } = clamp();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#0f131a';
        ctx.fillRect(0, 0, view, view);
        ctx.drawImage(img, (view - w) / 2 + offX, (view - h) / 2 + offY, w, h);
      }

      function redraw() { sizeCanvas(); draw(); }
      redraw();
      // Panel açılırken genişlik henüz kesinleşmemiş olabilir (yerleşim/animasyon) — bir kare sonra
      // yeniden ölç, aksi halde ilk çizim 0 genişlikle yapılıp boş görünürdü.
      requestAnimationFrame(redraw);
      window.addEventListener('resize', redraw);

      let dragging = false, lastX = 0, lastY = 0;
      stage.addEventListener('pointerdown', (e) => {
        dragging = true; lastX = e.clientX; lastY = e.clientY;
        stage.classList.add('dragging');
        stage.setPointerCapture(e.pointerId);
      });
      stage.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        offX += e.clientX - lastX; offY += e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        draw();
      });
      const endDrag = (e) => {
        dragging = false; stage.classList.remove('dragging');
        try { stage.releasePointerCapture(e.pointerId); } catch (err) { /* zaten bırakılmış */ }
      };
      stage.addEventListener('pointerup', endDrag);
      stage.addEventListener('pointercancel', endDrag);
      range.addEventListener('input', () => { zoom = Number(range.value) / 100; draw(); });

      function cleanup() {
        window.removeEventListener('resize', redraw);
        overlay.remove();
      }

      async function useCrop() {
        const { scale, w, h } = clamp();
        // Sahnedeki görünür kareyi KAYNAK piksel koordinatlarına çevir.
        const sx = (-(view - w) / 2 - offX) / scale;
        const sy = (-(view - h) / 2 - offY) / scale;
        const sSide = view / scale;
        const out = document.createElement('canvas');
        out.width = OUT_SIZE; out.height = OUT_SIZE;
        const octx = out.getContext('2d');
        octx.fillStyle = '#FFFFFF'; octx.fillRect(0, 0, OUT_SIZE, OUT_SIZE);
        octx.drawImage(img, sx, sy, sSide, sSide, 0, 0, OUT_SIZE, OUT_SIZE);
        const f = await canvasToFile(out, 'crop.jpg');
        cleanup();
        resolve(f || file);
      }

      async function skip() {
        cleanup();
        resolve(await centerSquare(file));   // kırpmayan kullanıcı da 1:1 alır
      }

      overlay.querySelector('.ic-btn-primary').addEventListener('click', useCrop);
      overlay.querySelector('.ic-btn-ghost').addEventListener('click', skip);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) skip(); });
      document.addEventListener('keydown', function esc(e) {
        if (e.key !== 'Escape' || !document.body.contains(overlay)) return;
        document.removeEventListener('keydown', esc);
        skip();
      });
    })).catch(() => centerSquare(file));   // görsel açılamadıysa yine de kare üretmeyi dene
  }

  window.ImageCrop = { open, centerSquare };
})();
