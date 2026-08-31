// ProjectProducts — "Kullanılan Ürünler" (ürünler + malzemeler TEK ızgarada). item.products/item.materials
// src/routes/project.js#handleProjectDetailRoute tarafından project_products join'inden doldurulur
// (bkz. src/lib/canonicalSync.js#resolveProjectProductLinks — proje-ekle.html'deki Firma/Ürün
// girişleri ya da urun-ekle.html'deki "Kullanılan Projeler" kutusu onaylandığında bağlanır).
//
// GERÇEK BULGU (kullanıcı bildirimi + ekran görüntüsü, 2026-08-31): bu bölüm kartlarını
// `.catalog-card`/`.catalog-grid-scroll` sınıflarıyla basıyordu — ama bu sınıfların HİÇBİR CSS
// karşılığı yok (repo genelinde tek bir `.catalog-card{...}` kuralı bile bulunmuyor; `.content-card`
// urun.html'in kendi grid'i için var, bu isimler ona benzetilerek yazılmış ama hiç tanımlanmamış).
// Sonuç: ürün görselleri stilsiz, doğal boyutlarında, tek sütun hâlinde dev bir blok olarak
// akıyordu. Kartlar artık popup'ın DİĞER tüm yatay şeritleriyle (Mimarın Diğer Projeleri / Benzer
// Projeler / Şehirdeki Diğer Projeler — bkz. js/components/project-related.js) BİREBİR AYNI
// `.related-card` + `.related-grid-scroll` işaretlemesini kullanıyor: bu sınıflar proje.html'de
// (ve mimar/firma/ürün modallarının injectStyles'ında) zaten tanımlı, yatay kaydırma okları da
// modal-shell.js#wireGridScrollArrows tarafından AYNI seçiciyle otomatik bağlanıyor.
const ProjectProducts = (function () {
  const DEFAULT_IDS = { productsSection: 'pm-products-section', productsGrid: 'pm-products-grid' };

  // js/components/product-modal.js#cardHtml ile BİREBİR aynı işaretleme (alt satırda markanın adı) —
  // bu dosya proje.html/mimar.html gibi sayfalarda çalıştığından cdnImg/cdnSrcset/officeColor/
  // initials globallerine project-related.js ile AYNI şekilde güvenir.
  function cardHtml(p) {
    const image = p.image || (p.images && p.images[0]);
    const srcset = image ? cdnSrcset(image, [300, 450, 600]) : '';
    const subtitle = p.brand || p.category || '';
    return `<a class="related-card" href="/urun/${encodeURIComponent(p.slug)}">
      <div class="related-card-photo">
        ${image ? `<img src="${escapeAttr(cdnImg(image, 450))}"${srcset ? ` srcset="${escapeAttr(srcset)}" sizes="300px"` : ''} alt="${escapeAttr(p.title)}" loading="lazy" decoding="async">` : `<div class="related-card-placeholder" style="background:${officeColor(p.title)}">${escapeHtml(initials(p.title))}</div>`}
      </div>
      <div class="related-card-title"><span class="related-card-title-text">${escapeHtml(p.title)}</span>${subtitle ? `<div class="related-card-subtitle">${escapeHtml(subtitle)}</div>` : ''}</div>
    </a>`;
  }

  function renderGroup(items, sectionId, gridId) {
    const section = document.getElementById(sectionId);
    if (!items || !items.length) { section.style.display = 'none'; return; }
    section.style.display = '';
    document.getElementById(gridId).innerHTML = items.map(cardHtml).join('');
  }

  // Ürünler ve malzemeler TEK ızgarada birleşir (kullanıcı isteği, 2026-08-31: "Malzemeler diye bir
  // kısım olmasın, malzemeler de ürünler kısmına dahil edilsin") — ayrı "Kullanılan Malzemeler"
  // bölümü kaldırıldı. Sunucu ikisini hâlâ AYRI döndürüyor (item.products/item.materials, bkz.
  // src/routes/project.js#fetchProjectProducts) çünkü proje-ekle.html#prefillForClaim chip listesini
  // bu iki diziden kuruyor — API şekli DEĞİŞMEDİ, yalnızca bu popup ikisini birleştirip gösteriyor.
  function mount(item, ids) {
    const mergedIds = Object.assign({}, DEFAULT_IDS, ids || {});
    const all = [...(item.products || []), ...(item.materials || [])];
    renderGroup(all, mergedIds.productsSection, mergedIds.productsGrid);
  }

  return { mount };
})();
