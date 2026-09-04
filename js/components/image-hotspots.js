// ImageHotspots — proje galerisindeki görsellerin ÜZERİNDE duran, tıklanınca/dokununca bir ürün
// önizleme kartı açan canlı daire işaretçileri (kullanıcı isteği, 2026-08-31). İşaretçiler
// proje-ekle.html'deki editörde konumlandırılır ve projects.image_hotspots'ta görsel URL'sine göre
// anahtarlı olarak saklanır (bkz. migrations/0076_project_image_hotspots.sql); burada YALNIZCA
// gösterim tarafı var.
//
// TEMEL FİKİR — "katman kutusu": işaretçilerin x/y'si görselin KENDİSİNE göre yüzdedir, onu içeren
// kutuya göre değil. Bu ikisi neredeyse hiçbir zaman aynı değildir: şeritte görsel object-fit:cover
// ile kırpılır (bkz. proje.html#.detail-gallery img), lightbox'ta ise max-width/max-height ile
// kutusundan KÜÇÜK kalır. Bu yüzden her seferinde önce "görselin gerçekten boyandığı dikdörtgen"
// hesaplanıp bir .ih-layer o dikdörtgene oturtulur; işaretçiler o katmanın içinde düpedüz yüzde
// konumlarını kullanır ve her ekran boyutunda kendiliğinden doğru yere düşer.
//
// ÖNİZLEME KARTI YALNIZCA LIGHTBOX'TA: şerit ankorunda overflow:hidden var (yuvarlak köşeler için,
// bkz. yukarıdaki dosya) — oraya çizilen bir kart kutunun kenarında kırpılırdı. Şeritteki bir
// işaretçiye tıklamak bu yüzden önce görseli büyütür, sonra kartı orada açar (bkz. gallery.js'teki
// onThumbHotspotClick) — istek zaten "görsel küçükken de görünsün, büyütünce önizleme açılsın"
// diyor, davranış bire bir bu.
const ImageHotspots = (function () {
  const LAYER_CLASS = 'ih-layer';

  function injectStyles() {
    if (document.getElementById('image-hotspots-styles')) return;
    const style = document.createElement('style');
    style.id = 'image-hotspots-styles';
    // DİKKAT: bu şablon dizesinde ters tırnak ya da // yorumu KULLANMA (bkz. proje notu: enjekte
    // edilen CSS sessizce bozulur).
    style.textContent = `
      .ih-layer{position:absolute; pointer-events:none; z-index:4;}
      /* "Tumunu Gor" izgara modunda tekli gorsel gizlenir (bkz. proje.html#.lightbox.grid-mode > img)
         — isaretci katmani da onunla birlikte gitmeli, aksi halde izgaranin uzerinde havada asili
         daireler kalirdi. */
      .lightbox.grid-mode > .ih-layer{display:none !important;}
      .ih-layer .ih-dot{
        position:absolute; pointer-events:auto; transform:translate(-50%, -50%);
        width:26px; height:26px; padding:0; border-radius:50%; cursor:pointer;
        border:2.5px solid #fff; background:var(--accent, #E08A3E);
        box-shadow:0 2px 10px rgba(15,19,26,0.45);
        display:flex; align-items:center; justify-content:center;
        transition:transform .18s ease;
      }
      .ih-layer .ih-dot::after{
        content:''; position:absolute; inset:-2.5px; border-radius:50%;
        border:2.5px solid #fff; opacity:0.85;
        animation:ih-pulse 2.2s ease-out infinite;
      }
      .ih-layer .ih-dot:hover, .ih-layer .ih-dot.open{transform:translate(-50%, -50%) scale(1.12);}
      .ih-layer .ih-dot.open::after{animation:none; opacity:0;}
      @keyframes ih-pulse{
        0%{transform:scale(1); opacity:0.85;}
        70%{transform:scale(2.1); opacity:0;}
        100%{transform:scale(2.1); opacity:0;}
      }
      .ih-layer .ih-dot-core{display:block; width:9px; height:9px; border-radius:50%; background:#fff;}
      .ih-tip{
        position:absolute; pointer-events:none; transform:translate(-50%, -100%);
        margin-top:-18px; max-width:220px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        background:rgba(15,19,26,0.92); color:#fff; font-size:12px; font-weight:600;
        padding:5px 10px; border-radius:7px; opacity:0; transition:opacity .15s ease;
      }
      .ih-tip.show{opacity:1;}
      .ih-card{
        position:absolute; pointer-events:auto; width:260px; max-width:72vw;
        background:var(--paper-card, #fff); border-radius:14px; overflow:hidden;
        box-shadow:0 18px 44px rgba(15,19,26,0.34);
        opacity:0; transform:scale(0.96); transition:opacity .18s ease, transform .18s ease;
      }
      .ih-card.show{opacity:1; transform:scale(1);}
      .ih-card-link{display:flex; align-items:center; gap:12px; padding:12px; text-decoration:none; color:var(--ink, #1B2A3D);}
      .ih-card-link:hover{background:var(--paper-alt, #F2F1EE);}
      .ih-card-media{
        flex:0 0 74px; width:74px; height:74px; border-radius:10px; overflow:hidden;
        background:var(--paper-alt, #F2F1EE); display:flex; align-items:center; justify-content:center;
      }
      .ih-card-media img{width:100%; height:100%; object-fit:contain; display:block;}
      /* Govde ve satirlari <span> — display:block SART, aksi halde baslik/marka/CTA yan yana tek bir
         satira akiyor (yerel testte goruldu). */
      .ih-card-body{display:block; min-width:0; flex:1;}
      .ih-card-title{display:block; font-size:13.5px; font-weight:700; line-height:1.3; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
      .ih-card-brand{display:block; font-size:12px; color:var(--ink-soft, #6B7280); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
      .ih-card-cta{display:block; font-size:11.5px; font-weight:600; color:var(--walnut, #8A6A4B); margin-top:6px;}
      @media (max-width:560px){
        .ih-layer .ih-dot{width:22px; height:22px; border-width:2px;}
        .ih-layer .ih-dot-core{width:7px; height:7px;}
        .ih-card{width:220px;}
        .ih-card-media{flex-basis:60px; width:60px; height:60px;}
      }
    `;
    document.head.appendChild(style);
  }

  // Görselin, kapsayıcısı içinde GERÇEKTEN boyandığı dikdörtgen (kapsayıcının kendi konumlandırılmış
  // kutusuna göre px). fit='contain' — img elemanının kutusu zaten görselin kendisidir (lightbox'ta
  // max-width/max-height ile küçülür), offset* değerleri doğrudan kullanılır. fit='cover' — img
  // kutuyu doldurup taşan kısmı kırpar (şerit); ölçek iki eksenin BÜYÜĞÜ, taşan kısım
  // object-position'ın varsayılanına (merkez) göre iki yana eşit dağılır.
  function paintedRect(hostEl, imgEl, fit) {
    const nw = imgEl.naturalWidth, nh = imgEl.naturalHeight;
    if (!nw || !nh) return null;
    if (fit === 'cover') {
      const cw = hostEl.clientWidth, ch = hostEl.clientHeight;
      if (!cw || !ch) return null;
      const scale = Math.max(cw / nw, ch / nh);
      const w = nw * scale, h = nh * scale;
      return { left: (cw - w) / 2, top: (ch - h) / 2, width: w, height: h };
    }
    if (!imgEl.offsetWidth || !imgEl.offsetHeight) return null;
    return { left: imgEl.offsetLeft, top: imgEl.offsetTop, width: imgEl.offsetWidth, height: imgEl.offsetHeight };
  }

  function ensureLayer(hostEl) {
    // Katman position:absolute — kapsayıcısı konumlandırılmış olmalı. Şerit ankoru (.detail-gallery a)
    // sayfa CSS'inde static; onu değiştirmek için sayfaların <style>'ına dokunmak yerine (galeri iki
    // ayrı sayfada tanımlı) burada, yalnızca gerçekten gerekince inline olarak ayarlanır. Lightbox
    // zaten position:fixed olduğundan orada bu dal hiç çalışmaz.
    if (getComputedStyle(hostEl).position === 'static') hostEl.style.position = 'relative';
    let layer = hostEl.querySelector(':scope > .' + LAYER_CLASS);
    if (!layer) {
      layer = document.createElement('div');
      layer.className = LAYER_CLASS;
      hostEl.appendChild(layer);
    }
    return layer;
  }

  // Katmanı görselin boyandığı dikdörtgene oturtur. Görsel henüz yüklenmediyse (naturalWidth 0)
  // katman gizlenir; 'load' olayı aşağıda yeniden konumlandırmayı tetikler.
  function positionLayer(hostEl, imgEl, layer, fit) {
    const rect = paintedRect(hostEl, imgEl, fit);
    if (!rect) { layer.style.display = 'none'; return false; }
    layer.style.display = '';
    layer.style.left = rect.left + 'px';
    layer.style.top = rect.top + 'px';
    layer.style.width = rect.width + 'px';
    layer.style.height = rect.height + 'px';
    return true;
  }

  // Kartı işaretçinin yanına koyar ve katmanın DIŞINA taşmayacak şekilde kenarlardan çevirir/kırpar.
  // Ölçüm için karta önce görünmez ama düzenlenmiş (display akışında) bir hâl verilir.
  function placeCard(layer, card, xPct, yPct) {
    const lw = layer.clientWidth, lh = layer.clientHeight;
    const cw = card.offsetWidth, ch = card.offsetHeight;
    const px = (xPct / 100) * lw, py = (yPct / 100) * lh;
    const GAP = 20;
    let left = px + GAP;
    if (left + cw > lw - 4) left = px - GAP - cw;
    left = Math.max(4, Math.min(left, Math.max(4, lw - cw - 4)));
    let top = py - ch / 2;
    top = Math.max(4, Math.min(top, Math.max(4, lh - ch - 4)));
    card.style.left = left + 'px';
    card.style.top = top + 'px';
  }

  function cardHtml(h) {
    const href = '/urun/' + encodeURIComponent(h.slug);
    const media = h.image
      ? `<span class="ih-card-media"><img src="${escapeAttr(typeof cdnImg === 'function' ? cdnImg(h.image, 200) : h.image)}" alt="" loading="lazy" decoding="async"></span>`
      : '';
    return `<a class="ih-card-link" href="${escapeAttr(href)}">
      ${media}
      <span class="ih-card-body">
        <span class="ih-card-title">${escapeHtml(h.title || '')}</span>
        ${h.brand ? `<span class="ih-card-brand">By ${escapeHtml(h.brand)}</span>` : ''}
        <span class="ih-card-cta">Ürünü gör →</span>
      </span>
    </a>`;
  }

  // mount(): hostEl üzerindeki işaretçi katmanını KOŞULSUZ yeniden kurar (galeri her proje
  // değişiminde/lightbox her görsel değişiminde çağırır). opts:
  //   fit: 'contain' | 'cover'
  //   interactive: false ise (şerit) işaretçiye tıklama kart açmaz, opts.onSelect'e devredilir
  //   onSelect(index): interactive=false iken çağrılır
  //   hoverPreview: true ise (bkz. index.html#mountSlideHotspots) fare ile üzerine gelmek metin
  //                 etiketi yerine DOĞRUDAN tam önizleme kartını açar
  //   openIndex: mount'tan hemen sonra açılacak kart (şeritten büyütmeye geçiş için)
  function mount(hostEl, imgEl, hotspots, opts) {
    if (!hostEl || !imgEl) return;
    injectStyles();
    const list = Array.isArray(hotspots) ? hotspots : [];
    const options = opts || {};
    const fit = options.fit === 'cover' ? 'cover' : 'contain';
    const layer = ensureLayer(hostEl);

    // Önceki mount'un dinleyicileri/observer'ı — katman DOM'da kalıcı olduğundan burada açıkça
    // temizlenir (bkz. modal-shell.js#disconnectGridObservers ile AYNI birikim sınıfı).
    if (layer._ihCleanup) layer._ihCleanup();
    layer.innerHTML = '';
    if (!list.length) { layer.style.display = 'none'; layer._ihCleanup = null; return; }

    layer.innerHTML = list.map((h, i) => `
      <button type="button" class="ih-dot" data-ih="${i}" style="left:${h.x}%; top:${h.y}%" aria-label="${escapeAttr(h.title || 'Ürün')}"><span class="ih-dot-core"></span></button>
    `).join('') + '<div class="ih-tip" hidden></div>';
    const tip = layer.querySelector('.ih-tip');

    const reposition = () => positionLayer(hostEl, imgEl, layer, fit);
    reposition();

    let openCard = null;
    function closeCard() {
      if (openCard) { openCard.remove(); openCard = null; }
      layer.querySelectorAll('.ih-dot.open').forEach(d => d.classList.remove('open'));
    }
    function openFor(i) {
      const h = list[i];
      if (!h) return;
      closeCard();
      // Kart açılınca hover etiketi gizlenir — ikisi aynı anda görünürse üst üste biniyorlar (yerel
      // testte görüldü) ve zaten aynı bilgiyi iki kez veriyorlar.
      if (tip) tip.classList.remove('show');
      const dot = layer.querySelector(`.ih-dot[data-ih="${i}"]`);
      if (dot) dot.classList.add('open');
      const card = document.createElement('div');
      card.className = 'ih-card';
      card.innerHTML = cardHtml(h);
      layer.appendChild(card);
      openCard = card;
      placeCard(layer, card, h.x, h.y);
      // Zorlanmış reflow + .show — geçişin bir "önce" karesi taahhüt edilsin diye (bkz.
      // modal-shell.js#open'daki AYNI desen). requestAnimationFrame BİLEREK kullanılmıyor: yerel
      // testte kartın .show sınıfı hiç eklenmiyor (dolayısıyla opacity:0'da görünmez kalıyordu) —
      // rAF, sekmenin/karenin durumuna göre gecikebiliyor; reflow okuması ise senkron ve kesin.
      void card.offsetHeight;
      card.classList.add('show');
    }

    function onLayerClick(e) {
      const dot = e.target.closest('.ih-dot');
      if (dot) {
        e.preventDefault();
        e.stopPropagation();
        const i = parseInt(dot.dataset.ih, 10);
        if (options.interactive === false) { if (options.onSelect) options.onSelect(i); return; }
        if (openCard && dot.classList.contains('open')) { closeCard(); return; }
        openFor(i);
        return;
      }
      // Karta yapılan tıklama (ürün bağlantısı) engellenmez — normal gezinme olarak geçer.
      if (e.target.closest('.ih-card')) return;
    }
    layer.addEventListener('click', onLayerClick);

    // Fareyle üzerine gelince ürün adı (bkz. kullanıcı ekran görüntüsü 2'deki koyu etiket) —
    // dokunmatikte hover diye bir şey olmadığından orada yalnızca tıklama/dokunma kartı açar.
    //
    // hoverPreview (kullanıcı isteği, 2026-09-04: "Ana sayfadaki caroseldeki hotspotların üzerine
    // mouse imleci getirince ... ürün önizlemesi gözüksün") — bu modda hover metin etiketi yerine
    // DOĞRUDAN tam önizleme kartını açar (openFor ile AYNI kart, tıklamayla açılanın birebir aynısı).
    // Yalnızca ana sayfa carousel'i bunu ister; diğer çağıranlar (galeri/lightbox) opsiyonu hiç
    // vermediğinden eski metin-etiketi davranışı DEĞİŞMEDEN kalır.
    function onOver(e) {
      const dot = e.target.closest('.ih-dot');
      if (!dot) return;
      if (options.hoverPreview) {
        if (dot.classList.contains('open')) return;
        openFor(parseInt(dot.dataset.ih, 10));
        return;
      }
      if (!tip || dot.classList.contains('open')) return;
      const h = list[parseInt(dot.dataset.ih, 10)];
      if (!h) return;
      tip.textContent = h.title || '';
      tip.hidden = false;
      tip.style.left = h.x + '%';
      tip.style.top = h.y + '%';
      tip.classList.add('show');
    }
    function onOut(e) {
      // Kartın/işaretçinin ÜZERİNE geçiliyorsa kapatma — kullanıcı fareyi karta taşıyıp "Ürünü gör"
      // bağlantısına tıklayabilsin.
      const enteringDotOrCard = e.relatedTarget && e.relatedTarget.closest
        && (e.relatedTarget.closest('.ih-dot') || (options.hoverPreview && e.relatedTarget.closest('.ih-card')));
      if (enteringDotOrCard) return;
      if (options.hoverPreview) { closeCard(); return; }
      if (tip) tip.classList.remove('show');
    }
    layer.addEventListener('mouseover', onOver);
    layer.addEventListener('mouseout', onOut);

    // Dışarı tıklama kartı kapatır — host'un KENDİSİNDEKİ (ör. lightbox'ın arka planı) tıklama, o
    // katmanın kendi "kapat" davranışından ÖNCE burada yakalanmamalı; bu yüzden capture DEĞİL,
    // sıradan bubble fazında ve yalnızca kart açıkken iş yapar.
    function onHostClick(e) {
      if (!openCard) return;
      if (e.target.closest('.ih-card') || e.target.closest('.ih-dot')) return;
      closeCard();
    }
    hostEl.addEventListener('click', onHostClick);

    const onResize = () => { reposition(); if (openCard) closeCard(); };
    window.addEventListener('resize', onResize);
    const onImgLoad = () => reposition();
    imgEl.addEventListener('load', onImgLoad);
    let ro = null;
    if (window.ResizeObserver) { ro = new ResizeObserver(() => reposition()); ro.observe(hostEl); }

    layer._ihCleanup = () => {
      layer.removeEventListener('click', onLayerClick);
      layer.removeEventListener('mouseover', onOver);
      layer.removeEventListener('mouseout', onOut);
      hostEl.removeEventListener('click', onHostClick);
      window.removeEventListener('resize', onResize);
      imgEl.removeEventListener('load', onImgLoad);
      if (ro) ro.disconnect();
      layer._ihApi = null;
    };
    layer._ihApi = { openFor, closeCard };
    if (typeof options.openIndex === 'number') openFor(options.openIndex);
  }

  // Bir host üzerindeki açık kartı dışarıdan kapatır (ör. lightbox kapanırken).
  function closeCards(hostEl) {
    const layer = hostEl && hostEl.querySelector(':scope > .' + LAYER_CLASS);
    if (layer && layer._ihApi) layer._ihApi.closeCard();
  }

  return { mount, closeCards, injectStyles };
})();
