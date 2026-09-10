// KART KARUSELİ — liste sayfalarındaki proje/ürün kartlarında fotoğraflar arasında ileri-geri
// (kullanıcı isteği, 2026-09-10 on birinci tur madde 5; örnek: archiproducts.com/en/projects —
// görselin üstünde ok, altında nokta göstergesi).
//
// TASARIM KARARLARI:
//   * Kart şablonu (js/pages/proje.js, urun.html#render) yalnızca KAPAĞI <img> olarak basar ve tüm
//     görsel URL'lerini `.content-card-photo[data-images]` üzerinde JSON olarak taşır. Diğer
//     görseller ilk ok tıklamasında oluşturulur (tembel) — liste sayfasının ilk yüklenmesine tek
//     bir ek istek bile eklenmez.
//   * Oklar/noktalar bir <a class="content-card"> İÇİNDE durur (proje kartı); tıklama capture
//     fazında durdurulur ki ne bağlantı ne de sayfanın popup açan delege dinleyicisi çalışsın.
//     Ürün kartında (div + kendi click dinleyicisi) aynı capture durdurması yeterlidir.
//   * Delege dinleyici + MutationObserver: kartlar sayfalama/filtre ile innerHTML üzerinden yeniden
//     basılıyor; her render noktasına ayrı bağlama yapmak yerine DOM'a bakılır (preview-cards.js
//     ile AYNI gerekçe).
//   * Görseller cdnImg/cdnSrcset ile (image-cdn.js her iki sayfada yüklü) kapaktakiyle aynı
//     türev basamağından istenir.
(function () {
  var MAX = 6;

  function injectStyles() {
    if (document.getElementById('card-carousel-styles')) return;
    var el = document.createElement('style');
    el.id = 'card-carousel-styles';
    el.textContent = [
      '.content-card-photo.ccar{position:relative;}',
      '.content-card-photo.ccar .ccar-img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover; opacity:0; transition:opacity .25s ease;}',
      '.content-card-photo.ccar .ccar-img.is-active{opacity:1;}',
      /* İlk görsel şablondan gelen <img> — ona da aynı geçiş uygulanır. */
      '.content-card-photo.ccar > img:not(.ccar-img){transition:opacity .25s ease;}',
      '.content-card-photo.ccar.ccar-moved > img:not(.ccar-img){opacity:0;}',
      '.ccar-btn{position:absolute; top:50%; transform:translateY(-50%); z-index:3; width:32px; height:32px; border-radius:50%;',
      '  border:none; background:rgba(255,255,255,0.92); color:#1B2A3D; display:flex; align-items:center; justify-content:center;',
      '  cursor:pointer; opacity:0; transition:opacity .15s ease, background .15s ease; box-shadow:0 2px 8px rgba(0,0,0,.18); padding:0;}',
      '.ccar-btn svg{width:16px; height:16px; display:block;}',
      '.ccar-btn.ccar-prev{left:10px;}',
      '.ccar-btn.ccar-next{right:10px;}',
      '.ccar-btn:hover{background:#fff;}',
      '.content-card:hover .ccar-btn, .content-card-photo:hover .ccar-btn{opacity:1;}',
      /* Dokunmatikte hover yok — oklar hep görünür (hafif). */
      '@media (hover: none){ .ccar-btn{opacity:.85;} }',
      '.ccar-dots{position:absolute; left:50%; bottom:8px; transform:translateX(-50%); z-index:3; display:flex; gap:5px;',
      '  padding:4px 7px; border-radius:100px; background:rgba(27,42,61,0.35); pointer-events:none;}',
      '.ccar-dot{width:6px; height:6px; border-radius:50%; background:rgba(255,255,255,0.55); transition:background .15s ease, transform .15s ease;}',
      '.ccar-dot.is-active{background:#fff; transform:scale(1.15);}',
    ].join('\n');
    document.head.appendChild(el);
  }

  var ICON_PREV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
  var ICON_NEXT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

  function imagesOf(photo) {
    if (photo._ccarImages) return photo._ccarImages;
    var list = [];
    try { list = JSON.parse(photo.getAttribute('data-images') || '[]'); } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    list = list.filter(function (u) { return typeof u === 'string' && u; }).slice(0, MAX);
    photo._ccarImages = list;
    return list;
  }

  // Kartı karusele çevirir — yalnızca 2+ görsel taşıyan kartlarda. İlk görsel şablonun kendi <img>'i.
  function enhance(photo) {
    if (photo.dataset.ccarReady === '1') return;
    var images = imagesOf(photo);
    if (images.length < 2) { photo.dataset.ccarReady = '1'; return; }
    photo.dataset.ccarReady = '1';
    photo.classList.add('ccar');
    photo._ccarIndex = 0;
    var prev = document.createElement('button');
    prev.type = 'button'; prev.className = 'ccar-btn ccar-prev'; prev.setAttribute('aria-label', 'Önceki fotoğraf'); prev.innerHTML = ICON_PREV;
    var next = document.createElement('button');
    next.type = 'button'; next.className = 'ccar-btn ccar-next'; next.setAttribute('aria-label', 'Sonraki fotoğraf'); next.innerHTML = ICON_NEXT;
    var dots = document.createElement('div');
    dots.className = 'ccar-dots';
    dots.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < images.length; i++) {
      var d = document.createElement('span');
      d.className = 'ccar-dot' + (i === 0 ? ' is-active' : '');
      dots.appendChild(d);
    }
    photo.appendChild(prev); photo.appendChild(next); photo.appendChild(dots);
  }

  function show(photo, index) {
    var images = imagesOf(photo);
    if (!images.length) return;
    var n = images.length;
    var i = ((index % n) + n) % n;
    photo._ccarIndex = i;
    // 0 = şablonun kapak <img>'i; diğerleri tembel oluşturulur.
    photo.classList.toggle('ccar-moved', i !== 0);
    var extras = photo.querySelectorAll('.ccar-img');
    for (var k = 0; k < extras.length; k++) extras[k].classList.toggle('is-active', parseInt(extras[k].dataset.ccarIdx, 10) === i);
    if (i !== 0 && !photo.querySelector('.ccar-img[data-ccar-idx="' + i + '"]')) {
      var img = document.createElement('img');
      img.className = 'ccar-img';
      img.dataset.ccarIdx = String(i);
      img.alt = '';
      img.decoding = 'async';
      var url = images[i];
      var hasCdn = typeof cdnImg === 'function';
      img.src = hasCdn ? cdnImg(url, 600) : url;
      var srcset = (typeof cdnSrcset === 'function') ? cdnSrcset(url, [400, 600, 800]) : '';
      if (srcset) { img.srcset = srcset; img.sizes = '(max-width: 720px) 50vw, (max-width: 960px) 33vw, 400px'; }
      img.onerror = function () { img.remove(); };
      // Noktaların/okların ALTINA, kapağın ÜSTÜNE gelsin diye ilk butondan önce eklenir.
      var firstBtn = photo.querySelector('.ccar-btn');
      photo.insertBefore(img, firstBtn || null);
      // Yüklenince belirsin (opacity geçişi); zaten önbellekteyse hemen.
      if (img.complete) img.classList.add('is-active');
      else img.addEventListener('load', function () { if (photo._ccarIndex === i) img.classList.add('is-active'); }, { once: true });
    }
    var dotEls = photo.querySelectorAll('.ccar-dot');
    for (var j = 0; j < dotEls.length; j++) dotEls[j].classList.toggle('is-active', j === i);
  }

  function scan(root) {
    var scope = (root && root.querySelectorAll) ? root : document;
    var photos = scope.querySelectorAll('.content-card-photo[data-images]');
    for (var i = 0; i < photos.length; i++) enhance(photos[i]);
  }

  var pending = false;
  function scheduleScan() {
    if (pending) return;
    pending = true;
    // setTimeout, rAF değil — arka plan sekmesinde de çalışsın (bkz. preview-cards.js#scheduleMark).
    setTimeout(function () { pending = false; scan(document); }, 0);
  }

  // Capture fazı: kartın kendi bağlantısı/popup dinleyicisi çalışmadan önce durdurulur.
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('.ccar-btn') : null;
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    var photo = btn.closest('.content-card-photo');
    if (!photo) return;
    show(photo, (photo._ccarIndex || 0) + (btn.classList.contains('ccar-next') ? 1 : -1));
  }, true);

  function start() {
    injectStyles();
    scan(document);
    if ('MutationObserver' in window) {
      new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.MLCardCarousel = { scan: scan };
})();
