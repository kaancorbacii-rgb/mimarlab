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

  galleryEl.innerHTML = images.length ? images.map((img, i) => `
    <a href="#" class="gallery-item" data-index="${i}"><img src="${escapeAttr(img)}" alt="${escapeAttr(title)}" ${i === 0 ? 'loading="eager" fetchpriority="high" decoding="sync"' : 'loading="lazy" decoding="async"'}></a>
  `).join('') : placeholderHtml;
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
  document.addEventListener('keydown', (e)=>{
    if(!lightbox.classList.contains('open')) return;
    // stopPropagation: proje modalı (bkz. js/components/project-modal.js) de kendi Escape'te
    // kapanan bir role="dialog" olduğundan, lightbox modalın ÜSTÜNDE açıkken Escape'in ikisini
    // birden AYNI tuşta kapatmaması gerekir — önce lightbox kapanır, ikinci Escape modalı kapatır.
    if(e.key === 'Escape'){ e.stopPropagation(); lightbox.classList.remove('open'); }
    else if(e.key === 'ArrowLeft') showLightboxImage(galleryEl._pmGalleryState.lightboxIndex - 1);
    else if(e.key === 'ArrowRight') showLightboxImage(galleryEl._pmGalleryState.lightboxIndex + 1);
  });
}
