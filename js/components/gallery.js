// Paylaşılan detay galerisi + lightbox: proje-detay.html/urun-detay.html'de ve artık proje modalında
// (bkz. js/components/project-gallery.js) birebir aynı şerit/gezinme/klavye mantığını tekilleştirir
// (bkz. docs/architecture-roadmap.md Faz 2). Sayfaya özel olan tek şey (ürünlerde favicon'lu,
// projelerde sade baş harfli) placeholder'ın TAM HTML'i (ör. `<div class="gallery-item
// gallery-placeholder" style="...">...</div>`) çağıran sayfa tarafından hazır string olarak
// geçirilir — bu modül escapeAttr/escapeHtml'in çağıran sayfada zaten global olarak tanımlı
// olduğunu varsayar (bkz. save-widget.js gibi diğer paylaşılan script'lerle aynı desen, her sayfada
// <script src="js/components/gallery.js"> ile dahil edilir).
function initDetailGallery(opts){
  const images = (opts && opts.images) || [];
  const title = (opts && opts.title) || '';
  const placeholderHtml = (opts && opts.placeholderHtml) || '';
  const ids = (opts && opts.ids) || {};

  const galleryEl = document.getElementById(ids.gallery || 'detail-gallery');
  const galleryPrevBtn = document.getElementById(ids.galleryPrev || 'gallery-prev');
  const galleryNextBtn = document.getElementById(ids.galleryNext || 'gallery-next');
  const galleryCounter = document.getElementById(ids.galleryCounter || 'gallery-counter');
  const lightbox = document.getElementById(ids.lightbox || 'lightbox');
  const lightboxImg = document.getElementById(ids.lightboxImg || 'lightbox-img');
  const lightboxCounter = document.getElementById(ids.lightboxCounter || 'lightbox-counter');
  const lightboxClose = document.getElementById(ids.lightboxClose || 'lightbox-close');
  const lightboxPrevBtn = document.getElementById(ids.lightboxPrev || 'lightbox-prev');
  const lightboxNextBtn = document.getElementById(ids.lightboxNext || 'lightbox-next');
  if(!galleryEl || !lightbox) return;

  // Bu fonksiyon proje-detay.html/urun-detay.html'de sayfa başına yalnızca BİR kez çağrılırdı; proje
  // modalı (bkz. project-modal.js#swap) ise AYNI DOM üzerinde projeden projeye tekrar tekrar çağırır.
  // Durum (images/index) bu yüzden galeri elemanının kendi üzerinde KALICI bir nesnede tutulur
  // (her çağrıda yeniden oluşturulmaz, yalnızca mutasyona uğrar) ve aşağıdaki buton/klavye
  // listener'ları yalnızca İLK çağrıda bağlanıp state'i HER ZAMAN bu canlı nesneden okur — aksi
  // halde (bkz. gerçek bulgu) her swap() yeni bir kapanış/listener seti ekler, N proje sonra aynı ok
  // tuşuna basmak N eski kapanışı BİRDEN tetikleyip birbiriyle çakışan/DOM'dan kopmuş elemanlara
  // başvuran kırık bir gezinmeye dönüşürdü.
  const state = galleryEl._pmGalleryState || (galleryEl._pmGalleryState = {});
  state.images = images;
  state.galleryIndex = 0;
  state.lightboxIndex = 0;
  // scrollLeft, galleryEl'in İÇERİĞİNE değil KENDİSİNE ait bir özellik — innerHTML'i aşağıda
  // tamamen değiştirmek bunu SIFIRLAMAZ (bkz. gerçek bulgu: proje modalında swap() ile başka bir
  // projeye geçildiğinde şerit, index sıfırlanmasına rağmen ÖNCEKİ projede kaydırılmış olduğu piksel
  // konumunda görünmeye devam ediyordu). state.galleryIndex=0 ile görsel kaydırma konumu arasında
  // tutarlılık için burada açıkça sıfırlanır.
  galleryEl.scrollLeft = 0;

  // Şerit her zaman KÜÇÜK bir önizleme (cdnImg/cdnSrcset, bkz. image-cdn.js) yükler — orijinal
  // çözünürlük yalnızca lightbox açıldığında istenir (bkz. showLightboxImage, state.images ORİJİNAL
  // URL'leri değişmeden tutar, yalnızca burada şerit <img>'inin src/srcset'i küçültülür).
  galleryEl.innerHTML = images.length ? images.map((img, i) => {
    const srcset = cdnSrcset(img, [320, 480, 640]);
    return `<a href="#" class="gallery-item" data-index="${i}"><img src="${escapeAttr(cdnImg(img, 480))}"${srcset ? ` srcset="${escapeAttr(srcset)}" sizes="480px"` : ''} alt="${escapeAttr(title)}" ${i === 0 ? 'loading="eager" fetchpriority="high" decoding="sync"' : 'loading="lazy" decoding="async"'}></a>`;
  }).join('') : placeholderHtml;
  state.galleryItems = Array.from(galleryEl.querySelectorAll('.gallery-item'));

  function updateGalleryCounter(){
    const st = galleryEl._pmGalleryState;
    if(galleryCounter) galleryCounter.textContent = `${st.galleryIndex + 1} / ${st.galleryItems.length}`;
  }
  function goToGalleryIndex(i){
    const st = galleryEl._pmGalleryState;
    if(!st.galleryItems.length) return;
    st.galleryIndex = (i + st.galleryItems.length) % st.galleryItems.length;
    galleryEl.scrollTo({ left: st.galleryItems[st.galleryIndex].offsetLeft - galleryEl.offsetLeft, behavior: 'smooth' });
    updateGalleryCounter();
  }
  function showLightboxImage(i){
    const st = galleryEl._pmGalleryState;
    if(!st.images.length) return;
    st.lightboxIndex = (i + st.images.length) % st.images.length;
    lightboxImg.src = st.images[st.lightboxIndex];
    if(lightboxCounter) lightboxCounter.textContent = `${st.lightboxIndex + 1} / ${st.images.length}`;
  }

  const hasMultiple = images.length > 1;
  if(galleryPrevBtn) galleryPrevBtn.style.display = hasMultiple ? '' : 'none';
  if(galleryNextBtn) galleryNextBtn.style.display = hasMultiple ? '' : 'none';
  if(galleryCounter) galleryCounter.style.display = hasMultiple ? '' : 'none';
  if(lightboxPrevBtn) lightboxPrevBtn.style.display = hasMultiple ? '' : 'none';
  if(lightboxNextBtn) lightboxNextBtn.style.display = hasMultiple ? '' : 'none';
  if(lightboxCounter) lightboxCounter.style.display = hasMultiple ? '' : 'none';
  if(hasMultiple) updateGalleryCounter();

  // Şerit öğelerine tıklama HER çağrıda yeniden bağlanır — galleryEl.innerHTML yukarıda zaten
  // sıfırlandığından bu DOM elemanları her seferinde YENİ, eski listener'lar onlarla birlikte
  // zaten yok oldu (leak riski yok, klasik/beklenen davranış).
  galleryEl.querySelectorAll('.gallery-item').forEach(a=>{
    a.addEventListener('click', (e)=>{
      e.preventDefault();
      showLightboxImage(parseInt(a.dataset.index, 10));
      lightbox.classList.add('open');
    });
  });

  // Butonlar/klavye: yalnızca İLK çağrıda bağlanır (bkz. dosya başı yorum) — state her zaman
  // galleryEl._pmGalleryState üzerinden CANLI okunduğundan ilk çağrıda bağlanan fonksiyonlar
  // sonraki çağrılardaki güncel veriyle de doğru çalışmaya devam eder.
  if(galleryEl.dataset.pmWired) return;
  galleryEl.dataset.pmWired = '1';

  if(galleryPrevBtn) galleryPrevBtn.addEventListener('click', () => goToGalleryIndex(galleryEl._pmGalleryState.galleryIndex - 1));
  if(galleryNextBtn) galleryNextBtn.addEventListener('click', () => goToGalleryIndex(galleryEl._pmGalleryState.galleryIndex + 1));
  let galleryScrollTimer = null;
  galleryEl.addEventListener('scroll', () => {
    clearTimeout(galleryScrollTimer);
    galleryScrollTimer = setTimeout(() => {
      const st = galleryEl._pmGalleryState;
      let closest = 0, closestDist = Infinity;
      st.galleryItems.forEach((item, idx) => {
        const dist = Math.abs((item.offsetLeft - galleryEl.offsetLeft) - galleryEl.scrollLeft);
        if(dist < closestDist){ closestDist = dist; closest = idx; }
      });
      st.galleryIndex = closest;
      updateGalleryCounter();
    }, 100);
  });

  if(lightboxClose) lightboxClose.addEventListener('click', ()=> lightbox.classList.remove('open'));
  if(lightboxPrevBtn) lightboxPrevBtn.addEventListener('click', (e)=>{ e.stopPropagation(); showLightboxImage(galleryEl._pmGalleryState.lightboxIndex - 1); });
  if(lightboxNextBtn) lightboxNextBtn.addEventListener('click', (e)=>{ e.stopPropagation(); showLightboxImage(galleryEl._pmGalleryState.lightboxIndex + 1); });
  lightbox.addEventListener('click', (e)=>{ if(e.target === lightbox) lightbox.classList.remove('open'); });
  // gerçek bulgu: e.stopPropagation() TEK BAŞINA burada işe yaramıyordu — proje modalı (bkz.
  // js/components/modal-shell.js#onKeydown) KENDİ Escape dinleyicisini document'e bu koddan ÖNCE
  // (ModalShell.open() her zaman ensureTemplate()'ten, dolayısıyla bu initDetailGallery çağrısından
  // önce çalışır) bubble fazında bağlıyor; stopPropagation yalnızca üst elemanlara YAYILMAYI durdurur,
  // AYNI elemandaki (document) BAŞKA bir dinleyiciyi durdurmaz — modal-shell'in dinleyicisi bağlanma
  // SIRASINA göre zaten önce çalışıp modalı kapatıyordu, lightbox'ın kendi kapanışı hiç fark
  // etmeksizin. Çözüm: bu dinleyici CAPTURE fazında (üçüncü argüman=true) bağlanır — capture fazı
  // HER ZAMAN bubble fazından önce çalışır (bağlanma sırasından bağımsız olarak), lightbox açıkken
  // burada çağrılan stopPropagation olayın capture'da document'ten hedefe inmesini (dolayısıyla
  // sonraki bubble fazını, yani modal-shell'in dinleyicisini) tamamen durdurur.
  document.addEventListener('keydown', (e)=>{
    if(!lightbox.classList.contains('open')) return;
    if(e.key === 'Escape'){ e.stopPropagation(); lightbox.classList.remove('open'); }
    else if(e.key === 'ArrowLeft') showLightboxImage(galleryEl._pmGalleryState.lightboxIndex - 1);
    else if(e.key === 'ArrowRight') showLightboxImage(galleryEl._pmGalleryState.lightboxIndex + 1);
  }, true);

  // Dokunmatik kaydırma (bkz. kullanıcı isteği: mobil/tablette parmakla görseller arası geçiş) —
  // yatay hareket dikeyden belirgin şekilde baskınsa (aksi halde sayfayı dikey kaydırmaya çalışan bir
  // dokunuş yanlışlıkla görsel değiştirebilirdi) ve eşiği (SWIPE_THRESHOLD) geçiyorsa bir sonraki/
  // önceki görsele geçilir; touchmove'da preventDefault YALNIZCA yatay niyet netleştiğinde çağrılır,
  // aksi halde dikey sayfa kaydırması (varsa) engellenmiş olurdu.
  const SWIPE_THRESHOLD = 40;
  let touchStartX = 0, touchStartY = 0, touchActive = false, touchIntentHorizontal = false;
  lightbox.addEventListener('touchstart', (e)=>{
    if(e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchActive = true;
    touchIntentHorizontal = false;
  }, { passive: true });
  lightbox.addEventListener('touchmove', (e)=>{
    if(!touchActive || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;
    if(!touchIntentHorizontal && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) touchIntentHorizontal = true;
    if(touchIntentHorizontal) e.preventDefault();
  }, { passive: false });
  lightbox.addEventListener('touchend', (e)=>{
    if(!touchActive) return;
    touchActive = false;
    if(!touchIntentHorizontal) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if(dx <= -SWIPE_THRESHOLD) showLightboxImage(galleryEl._pmGalleryState.lightboxIndex + 1);
    else if(dx >= SWIPE_THRESHOLD) showLightboxImage(galleryEl._pmGalleryState.lightboxIndex - 1);
  });

  // Trackpad/mouse tekerleği yatay kaydırma (bkz. kullanıcı isteği: Macbook touchpad'i) — deltaX
  // dikey deltaY'den baskınsa yatay bir kaydırma jesti olarak yorumlanır. Ardışık wheel event'leri
  // (bir tek "kaydırma" ondan onlarca event üretebilir) küçük bir zaman aşımıyla debounce edilir —
  // aksi halde tek bir trackpad hareketi aynı anda birden fazla görsel atlardı.
  let wheelLock = false;
  lightbox.addEventListener('wheel', (e)=>{
    if(Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    if(wheelLock) return;
    wheelLock = true;
    setTimeout(()=>{ wheelLock = false; }, 350);
    if(e.deltaX > 0) showLightboxImage(galleryEl._pmGalleryState.lightboxIndex + 1);
    else showLightboxImage(galleryEl._pmGalleryState.lightboxIndex - 1);
  }, { passive: false });
}
