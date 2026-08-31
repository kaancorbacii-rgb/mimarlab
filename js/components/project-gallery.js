// ProjectGallery — proje modalının medya galerisi. js/components/gallery.js#initDetailGallery'nin
// ince bir sarmalayıcısı: aynı şerit/lightbox/klavye mantığını proje modalının kendi (pm- önekli)
// DOM id'lerine yeniden eşler. Medya öğesi veri modeli ileride video/360°/PDF eklenebilsin diye
// { type: 'photo', url } biçiminde tutulur (bkz. kullanıcı isteği: v1 yalnızca foto, ama yapı
// genişletilebilir olsun) — initDetailGallery halen düz bir url dizisi beklediğinden burada `url`
// alanlarına indirgenir; ileride 'video'/'youtube' vb. tipler eklendiğinde yalnızca bu dosyanın
// render fonksiyonu değişir, ProjectModal/API sözleşmesi değişmez.
const ProjectGallery = (function () {
  const DEFAULT_IDS = {
    gallery: 'pm-gallery', galleryPrev: 'pm-gallery-prev', galleryNext: 'pm-gallery-next', galleryCounter: 'pm-gallery-counter',
    lightbox: 'pm-lightbox', lightboxImg: 'pm-lightbox-img', lightboxCounter: 'pm-lightbox-counter',
    lightboxClose: 'pm-lightbox-close', lightboxPrev: 'pm-lightbox-prev', lightboxNext: 'pm-lightbox-next',
  };

  function toMediaItems(images) {
    return (images || []).map(url => ({ type: 'photo', url }));
  }

  function render(item, ids) {
    const mergedIds = Object.assign({}, DEFAULT_IDS, ids || {});
    const media = toMediaItems(item.images);
    initDetailGallery({
      images: media.map(m => m.url),
      // Görsel üzerindeki ürün işaretçileri (bkz. js/components/image-hotspots.js) — API'den görsel
      // URL'sine göre anahtarlı gelir (bkz. src/routes/project.js#enrichImageHotspots), o yüzden
      // yukarıdaki url indirgemesinden BAĞIMSIZ olarak olduğu gibi geçilir.
      hotspots: item.imageHotspots || {},
      title: item.title,
      placeholderHtml: `<div class="gallery-item gallery-placeholder" style="background:${officeColor(item.title)}">${escapeHtml(initials(item.title))}</div>`,
      ids: mergedIds,
    });
  }

  return { render };
})();
