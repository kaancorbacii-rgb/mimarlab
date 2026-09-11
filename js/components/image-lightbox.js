// Tek görselli, bağımsız lightbox (kullanıcı isteği, 2026-09-02):
//   * Koleksiyonum > Panolarım'daki pano ve proje görsellerine tıklayınca görsel büyüsün.
//   * Kişi/firma/marka pop-up'larında profil fotoğrafına/logoya tıklayınca görsel büyüsün.
// "aynı proje medyasında olduğu gibi" — görünüm proje galerisinin lightbox'ıyla (bkz. proje.html
// #.lightbox kuralları) BİREBİR aynı: aynı arka plan, aynı kapatma düğmesi, aynı z-index.
//
// GALERİ MODU (kullanıcı isteği, 2026-09-11 — firma/marka "İş / Staj İlanları"): openGallery(items,
// index) birden fazla görsel arasında ‹ › düğmeleri ve ←/→ tuşlarıyla geçiş yapar, her görselin
// altında başlığı (caption) gösterilir. open(url, alt) tek elemanlı bir galeridir — oklar gizli
// kalır, eski çağıranların davranışı değişmez.
//
// NEDEN AYRI BİR MODÜL: js/components/gallery.js#initDetailGallery tam bir GALERİ bileşenidir —
// şerit, sayaç, ileri/geri düğmeleri, ızgara modu ve ürün işaretçileri için sayfada hazır bir DOM
// iskeleti (id'leriyle) bekler. Buradaki ihtiyaç ise "tek bir <img>'e tıkla, büyüsün" — o iskeleti
// kurmak gereksiz ağırlık olurdu. Bu modül kendi overlay'ini İLK kullanımda bir kez oluşturur.
(function () {
  var overlay = null;
  var imgEl = null;
  var captionEl = null;
  var counterEl = null;
  var lastFocused = null;
  var items = [];
  var index = 0;

  var CHEVRON_LEFT = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>';
  var CHEVRON_RIGHT = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';

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
      '<button type="button" class="img-lightbox-nav img-lightbox-prev" aria-label="Önceki">' + CHEVRON_LEFT + '</button>' +
      '<img alt="">' +
      '<button type="button" class="img-lightbox-nav img-lightbox-next" aria-label="Sonraki">' + CHEVRON_RIGHT + '</button>' +
      '<div class="img-lightbox-caption"></div>' +
      '<div class="img-lightbox-counter"></div>';
    imgEl = overlay.querySelector('img');
    captionEl = overlay.querySelector('.img-lightbox-caption');
    counterEl = overlay.querySelector('.img-lightbox-counter');
    overlay.querySelector('.img-lightbox-close').addEventListener('click', close);
    overlay.querySelector('.img-lightbox-prev').addEventListener('click', function () { go(-1); });
    overlay.querySelector('.img-lightbox-next').addEventListener('click', function () { go(1); });
    // Arka plana tıklayınca kapan; görselin KENDİSİNE tıklayınca kapanmasın (kullanıcı görseli
    // incelerken yanlışlıkla kapatmasın) — proje galerisi lightbox'ıyla aynı davranış.
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (items.length > 1 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.stopPropagation();
      e.preventDefault();
      go(e.key === 'ArrowLeft' ? -1 : 1);
    }
  }

  function paint() {
    var it = items[index] || {};
    imgEl.src = it.src || '';
    imgEl.alt = it.alt || it.caption || '';
    captionEl.textContent = it.caption || '';
    captionEl.style.display = it.caption ? '' : 'none';
    var multi = items.length > 1;
    overlay.classList.toggle('img-lightbox-multi', multi);
    counterEl.textContent = multi ? (index + 1) + ' / ' + items.length : '';
  }

  function go(step) {
    if (items.length < 2) return;
    index = (index + step + items.length) % items.length;
    paint();
  }

  // list: [{src, caption?, alt?}] — start: açılışta gösterilecek elemanın sırası.
  function openGallery(list, start) {
    var clean = (list || []).filter(function (it) { return it && it.src; });
    if (!clean.length) return;
    ensureDom();
    items = clean;
    index = Math.min(Math.max(0, start | 0), items.length - 1);
    lastFocused = document.activeElement;
    paint();
    overlay.classList.add('open');
    // Alttaki modal/sayfa kaydırmasın.
    document.body.style.overflow = 'hidden';
    // capture:true — açık bir ModalShell'in kendi Escape dinleyicisinden ÖNCE çalışsın ki Escape
    // önce bu görseli kapatsın, arkadaki pop-up'ı değil.
    document.addEventListener('keydown', onKey, true);
    overlay.querySelector('.img-lightbox-close').focus();
  }

  function open(url, alt) {
    if (!url) return;
    openGallery([{ src: url, alt: alt || '' }], 0);
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('open');
    imgEl.removeAttribute('src');
    items = [];
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
      /* Galeri modu: oklar ve sayaç yalnızca birden fazla görsel varken görünür; başlık (caption)
         görselin altında. Görsel, alttaki başlık/sayaç şeridine yer açmak için biraz kısalır. */
      '.img-lightbox-nav{display:none; position:absolute; top:50%; transform:translateY(-50%); width:48px; height:48px;',
      '  border-radius:50%; border:none; background:rgba(237,240,243,0.14); color:#EDF0F3; cursor:pointer;',
      '  align-items:center; justify-content:center; line-height:0; padding:0;}',
      '.img-lightbox-nav:hover{background:rgba(237,240,243,0.26);}',
      '.img-lightbox-prev{left:24px;} .img-lightbox-next{right:24px;}',
      '.img-lightbox.img-lightbox-multi .img-lightbox-nav{display:flex;}',
      '.img-lightbox.img-lightbox-multi{padding:32px 88px 72px;}',
      '.img-lightbox-caption{position:absolute; left:50%; bottom:40px; transform:translateX(-50%); max-width:min(720px, 86vw);',
      '  color:#EDF0F3; font-size:15px; font-weight:600; text-align:center; line-height:1.4;}',
      '.img-lightbox-counter{position:absolute; left:50%; bottom:16px; transform:translateX(-50%); color:#EDF0F3; opacity:.7; font-size:12.5px;}',
      '@media (max-width: 720px){ .img-lightbox{padding:16px;} .img-lightbox-close{top:12px; right:14px;}',
      '  .img-lightbox.img-lightbox-multi{padding:56px 12px 88px;}',
      '  .img-lightbox-nav{top:auto; bottom:16px; transform:none; width:42px; height:42px;}',
      '  .img-lightbox-prev{left:14px;} .img-lightbox-next{right:14px;}',
      '  .img-lightbox-caption{bottom:62px;} .img-lightbox-counter{bottom:28px;} }',
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

  window.ImageLightbox = { open: open, openGallery: openGallery, close: close };
})();
