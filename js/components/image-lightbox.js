// Tek görselli, bağımsız lightbox (kullanıcı isteği, 2026-09-02):
//   * Koleksiyonum > Panolarım'daki pano ve proje görsellerine tıklayınca görsel büyüsün.
//   * Kişi/firma/marka pop-up'larında profil fotoğrafına/logoya tıklayınca görsel büyüsün.
// "aynı proje medyasında olduğu gibi" — görünüm proje galerisinin lightbox'ıyla (bkz. proje.html
// #.lightbox kuralları) BİREBİR aynı: aynı arka plan, aynı kapatma düğmesi, aynı z-index.
//
// NEDEN AYRI BİR MODÜL: js/components/gallery.js#initDetailGallery tam bir GALERİ bileşenidir —
// şerit, sayaç, ileri/geri düğmeleri, ızgara modu ve ürün işaretçileri için sayfada hazır bir DOM
// iskeleti (id'leriyle) bekler. Buradaki ihtiyaç ise "tek bir <img>'e tıkla, büyüsün" — o iskeleti
// kurmak gereksiz ağırlık olurdu. Bu modül kendi overlay'ini İLK kullanımda bir kez oluşturur.
(function () {
  var overlay = null;
  var imgEl = null;
  var lastFocused = null;

  function ensureDom() {
    if (overlay) return;
    injectStyles();
    overlay = document.createElement('div');
    overlay.className = 'img-lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Görsel');
    overlay.innerHTML =
      '<button type="button" class="img-lightbox-close" aria-label="Kapat">' +
        '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>' +
      '<img alt="">';
    imgEl = overlay.querySelector('img');
    overlay.querySelector('.img-lightbox-close').addEventListener('click', close);
    // Arka plana tıklayınca kapan; görselin KENDİSİNE tıklayınca kapanmasın (kullanıcı görseli
    // incelerken yanlışlıkla kapatmasın) — proje galerisi lightbox'ıyla aynı davranış.
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  }

  function open(url, alt) {
    if (!url) return;
    ensureDom();
    lastFocused = document.activeElement;
    imgEl.src = url;
    imgEl.alt = alt || '';
    overlay.classList.add('open');
    // Alttaki modal/sayfa kaydırmasın.
    document.body.style.overflow = 'hidden';
    // capture:true — açık bir ModalShell'in kendi Escape dinleyicisinden ÖNCE çalışsın ki Escape
    // önce bu görseli kapatsın, arkadaki pop-up'ı değil.
    document.addEventListener('keydown', onKey, true);
    overlay.querySelector('.img-lightbox-close').focus();
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('open');
    imgEl.removeAttribute('src');
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey, true);
    if (lastFocused && lastFocused.focus) { try { lastFocused.focus(); } catch (e) {} }
    lastFocused = null;
  }

  function injectStyles() {
    if (document.getElementById('img-lightbox-styles')) return;
    var el = document.createElement('style');
    el.id = 'img-lightbox-styles';
    el.textContent = [
      /* proje.html#.lightbox ile AYNI değerler — iki lightbox aynı görünsün. z-index proje
         lightbox'ının (200) ÜSTÜNDE: bu overlay bir pop-up'ın içinden açılabiliyor. */
      '.img-lightbox{display:none; position:fixed; inset:0; background:rgba(27,42,61,0.92);',
      '  z-index:260; align-items:center; justify-content:center; padding:32px;}',
      '.img-lightbox.open{display:flex;}',
      '.img-lightbox img{max-width:100%; max-height:100%; border-radius:8px; user-select:none; object-fit:contain;}',
      '.img-lightbox-close{position:absolute; top:24px; right:32px; background:none; border:none;',
      '  color:#EDF0F3; opacity:.85; cursor:pointer; padding:4px; line-height:0;}',
      '.img-lightbox-close:hover{opacity:1;}',
      '@media (max-width: 720px){ .img-lightbox{padding:16px;} .img-lightbox-close{top:12px; right:14px;} }',
      /* Tıklanabilir olduğu belli olsun (profil fotoğrafı/logo ve pano görselleri). */
      '.img-zoomable{cursor:zoom-in;}',
    ].join('\n');
    document.head.appendChild(el);
  }

  // Delege dinleyici: `data-lightbox-src` taşıyan (ya da .img-zoomable içindeki <img>) her öğe,
  // sonradan DOM'a eklenmiş olsa bile çalışır — pop-up içerikleri ve pano kartları her açılışta
  // yeniden basıldığından ayrı ayrı dinleyici bağlamak güvenilir olmazdı.
  document.addEventListener('click', function (e) {
    var trigger = e.target.closest('[data-lightbox-src], .img-zoomable');
    if (!trigger) return;
    // Bir bağlantının içindeysek (kart görselleri <a> ile sarılı olabilir) gezinmeyi engelle.
    var url = trigger.getAttribute('data-lightbox-src');
    if (!url) {
      var img = trigger.matches('img') ? trigger : trigger.querySelector('img');
      // currentSrc: srcset'ten seçilen gerçek aday; yoksa src. Türev URL'si olabilir — büyütmede
      // tam çözünürlük istediğimiz için varsa data-lightbox-full tercih edilir.
      url = (trigger.getAttribute('data-lightbox-full') || (img && (img.getAttribute('data-full') || img.currentSrc || img.src)) || '');
    }
    if (!url) return;
    e.preventDefault();
    e.stopPropagation();
    var alt = trigger.getAttribute('data-lightbox-alt') || '';
    open(url, alt);
  }, true);

  window.ImageLightbox = { open: open, close: close };
})();
