// ProjectProducts — "Kullanılan Ürünler"/"Kullanılan Malzemeler". item.products/item.materials
// artık src/routes/project.js#fetchProjectProducts tarafından project_products join'inden GERÇEK
// veriyle dolduruluyor (bkz. src/lib/canonicalSync.js#resolveProjectProductLinks — canlı onay
// akışında bağlanır, scripts/backfill-project-products.js mevcut onaylı gönderileri geriye dönük
// bağlar) — proje-detay.html#renderRelatedCatalog'daki istemci-taraf urunler-data.js/
// malzemeler-data.js marka-string eşleştirmesine artık GEREK YOK, kartlar doğrudan render edilir.
const ProjectProducts = (function () {
  const DEFAULT_IDS = { productsSection: 'pm-products-section', productsGrid: 'pm-products-grid', materialsSection: 'pm-materials-section', materialsGrid: 'pm-materials-grid' };

  function cardHtml(p) {
    const inner = `
      ${catalogCardMediaHtml(p, escapeHtml, escapeAttr)}
      <div class="catalog-card-info">
        <div class="catalog-card-cat">${escapeHtml(p.category || '')}</div>
        <div class="catalog-card-title">${escapeHtml(p.title)}</div>
        ${p.brand ? `<div class="catalog-card-by">${escapeHtml(p.brand)}</div>` : ''}
      </div>`;
    // Ürün/malzeme kartı öncelikle kendi katalog sayfasına (/urun/:slug) linklenir — artık
    // her satır gerçek bir canonical products kaydına karşılık geldiğinden (bkz. dosya başı yorum)
    // proje-detay.html'in eski "ofis profiline, o da yoksa dış siteye" fallback zincirine gerek yok.
    return `<a class="catalog-card" href="/urun/${encodeURIComponent(p.slug)}">${inner}</a>`;
  }

  function renderGroup(items, sectionId, gridId) {
    const section = document.getElementById(sectionId);
    if (!items || !items.length) { section.style.display = 'none'; return; }
    section.style.display = '';
    document.getElementById(gridId).innerHTML = items.map(cardHtml).join('');
  }

  function mount(item, ids) {
    const mergedIds = Object.assign({}, DEFAULT_IDS, ids || {});
    renderGroup(item.products, mergedIds.productsSection, mergedIds.productsGrid);
    renderGroup(item.materials, mergedIds.materialsSection, mergedIds.materialsGrid);
  }

  return { mount };
})();
