// ProjectProducts — "Kullanılan Ürünler"/"Kullanılan Malzemeler". item.products/item.materials
// src/routes/project.js#handleProjectDetailRoute tarafından project_products join'inden doldurulur
// (bkz. src/lib/canonicalSync.js#resolveProjectProductLinks — proje-ekle.html'deki Firma/Ürün
// girişleri onaylandığında bağlanır).
const ProjectProducts = (function () {
  const DEFAULT_IDS = { productsSection: 'pm-products-section', productsGrid: 'pm-products-grid', materialsSection: 'pm-materials-section', materialsGrid: 'pm-materials-grid' };

  function cardHtml(p) {
    const inner = `
      <div class="catalog-card-photo">${catalogCardMediaHtml(p, escapeHtml, escapeAttr)}</div>
      <div class="catalog-card-info">
        <div class="catalog-card-cat">${escapeHtml(p.category || '')}</div>
        <div class="catalog-card-title">${escapeHtml(p.title)}</div>
        ${p.brand ? `<div class="catalog-card-by">${escapeHtml(p.brand)}</div>` : ''}
      </div>`;
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
