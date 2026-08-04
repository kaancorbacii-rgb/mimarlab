// Paylaşılan detay galerisi + lightbox: proje-detay.html ve urun-detay.html'de birebir aynı
// şerit/gezinme/klavye mantığını tekilleştirir (bkz. docs/architecture-roadmap.md Faz 2). Sayfaya
// özel olan tek şey (ürünlerde favicon'lu, projelerde sade baş harfli) placeholder'ın TAM HTML'i
// (ör. `<div class="gallery-item gallery-placeholder" style="...">...</div>`) çağıran sayfa
// tarafından hazır string olarak geçirilir — bu modül escapeAttr/escapeHtml'in çağıran sayfada
// zaten global olarak tanımlı olduğunu varsayar (bkz. save-widget.js gibi diğer paylaşılan
// script'lerle aynı desen, her sayfada <script src="js/components/gallery.js"> ile dahil edilir).
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

  galleryEl.innerHTML = images.length ? images.map((img, i) => `
    <a href="#" class="gallery-item" data-index="${i}"><img src="${escapeAttr(img)}" alt="${escapeAttr(title)}" ${i === 0 ? 'loading="eager" fetchpriority="high" decoding="sync"' : 'loading="lazy" decoding="async"'}></a>
  `).join('') : placeholderHtml;

  // Ana medya şeridinde sola/sağa kaydırma okları + "1 / N" sayaç — sayaç yalnızca ok tıklamasında
  // değil, kullanıcı şeridi elle kaydırdığında (dokunma/trackpad) da en yakın görsele kilitlenerek
  // güncellenir.
  if(images.length <= 1){
    if(galleryPrevBtn) galleryPrevBtn.style.display = 'none';
    if(galleryNextBtn) galleryNextBtn.style.display = 'none';
    if(galleryCounter) galleryCounter.style.display = 'none';
  } else {
    const galleryItems = Array.from(galleryEl.querySelectorAll('.gallery-item'));
    let galleryIndex = 0;
    function updateGalleryCounter(){
      if(galleryCounter) galleryCounter.textContent = `${galleryIndex + 1} / ${galleryItems.length}`;
    }
    function goToGalleryIndex(i){
      galleryIndex = (i + galleryItems.length) % galleryItems.length;
      galleryEl.scrollTo({ left: galleryItems[galleryIndex].offsetLeft - galleryEl.offsetLeft, behavior: 'smooth' });
      updateGalleryCounter();
    }
    if(galleryPrevBtn) galleryPrevBtn.addEventListener('click', () => goToGalleryIndex(galleryIndex - 1));
    if(galleryNextBtn) galleryNextBtn.addEventListener('click', () => goToGalleryIndex(galleryIndex + 1));
    let galleryScrollTimer = null;
    galleryEl.addEventListener('scroll', () => {
      clearTimeout(galleryScrollTimer);
      galleryScrollTimer = setTimeout(() => {
        let closest = 0, closestDist = Infinity;
        galleryItems.forEach((item, idx) => {
          const dist = Math.abs((item.offsetLeft - galleryEl.offsetLeft) - galleryEl.scrollLeft);
          if(dist < closestDist){ closestDist = dist; closest = idx; }
        });
        galleryIndex = closest;
        updateGalleryCounter();
      }, 100);
    });
    updateGalleryCounter();
  }

  let lightboxIndex = 0;
  function showLightboxImage(i){
    lightboxIndex = (i + images.length) % images.length;
    lightboxImg.src = images[lightboxIndex];
    if(lightboxCounter) lightboxCounter.textContent = `${lightboxIndex + 1} / ${images.length}`;
  }

  galleryEl.querySelectorAll('.gallery-item').forEach(a=>{
    a.addEventListener('click', (e)=>{
      e.preventDefault();
      showLightboxImage(parseInt(a.dataset.index));
      lightbox.classList.add('open');
    });
  });
  if(lightboxClose) lightboxClose.addEventListener('click', ()=> lightbox.classList.remove('open'));
  if(images.length <= 1){
    if(lightboxPrevBtn) lightboxPrevBtn.style.display = 'none';
    if(lightboxNextBtn) lightboxNextBtn.style.display = 'none';
    if(lightboxCounter) lightboxCounter.style.display = 'none';
  }
  if(lightboxPrevBtn) lightboxPrevBtn.addEventListener('click', (e)=>{ e.stopPropagation(); showLightboxImage(lightboxIndex - 1); });
  if(lightboxNextBtn) lightboxNextBtn.addEventListener('click', (e)=>{ e.stopPropagation(); showLightboxImage(lightboxIndex + 1); });
  lightbox.addEventListener('click', (e)=>{ if(e.target === lightbox) lightbox.classList.remove('open'); });
  document.addEventListener('keydown', (e)=>{
    if(!lightbox.classList.contains('open')) return;
    if(e.key === 'Escape') lightbox.classList.remove('open');
    else if(e.key === 'ArrowLeft') showLightboxImage(lightboxIndex - 1);
    else if(e.key === 'ArrowRight') showLightboxImage(lightboxIndex + 1);
  });
}
