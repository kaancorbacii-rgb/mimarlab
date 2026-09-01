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
  const DEFAULT_IDS = {
    productsSection: 'pm-products-section', productsGrid: 'pm-products-grid',
    // "Kullanılan Markalar" (kullanıcı isteği, 2026-09-01 madde 5) — "Kullanılan Ürünler" ile AYNI
    // satırda, iki sütun (bkz. js/components/project-modal.js#pm-two-col-row). Veri ek bir istek
    // GEREKTİRMEZ: item.brands proje payload'ıyla birlikte gelir (bkz. src/routes/project.js#
    // fetchProjectProducts), yani ürünlerin markalarının zincirin bir halka devamı olarak çözülmüş hâli.
    brandsSection: 'pm-brands-section', brandsGrid: 'pm-brands-grid', pair: 'pm-products-pair',
  };

  // js/components/product-modal.js#cardHtml ile BİREBİR aynı işaretleme (alt satırda markanın adı) —
  // bu dosya proje.html/kisi.html gibi sayfalarda çalıştığından cdnImg/cdnSrcset/officeColor/
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

  // Marka kartı — js/components/office-modal.js#cardHtml ile BİREBİR aynı işaretleme (alt satırda
  // konum), hedef /firma/:slug (marka profilleri de firma modalıyla açılır, bkz. office-kind.js).
  function brandCardHtml(b) {
    const srcset = b.logo ? cdnSrcset(b.logo, [300, 450, 600]) : '';
    return `<a class="related-card" href="/firma/${encodeURIComponent(b.slug)}">
      <div class="related-card-photo">
        ${b.logo ? `<img src="${escapeAttr(cdnImg(b.logo, 450))}"${srcset ? ` srcset="${escapeAttr(srcset)}" sizes="300px"` : ''} alt="${escapeAttr(b.name)}" loading="lazy" decoding="async">` : `<div class="related-card-placeholder" style="background:${officeColor(b.name)}">${escapeHtml(initials(b.name))}</div>`}
      </div>
      <div class="related-card-title"><span class="related-card-title-text">${escapeHtml(b.name)}</span>${b.loc ? `<div class="related-card-subtitle">${escapeHtml(b.loc)}</div>` : ''}</div>
    </a>`;
  }

  function renderGroup(items, sectionId, gridId, toHtml) {
    const section = document.getElementById(sectionId);
    if (!section) return false;
    if (!items || !items.length) { section.style.display = 'none'; return false; }
    section.style.display = '';
    RelatedStrip.render(document.getElementById(gridId), items, toHtml || cardHtml);
    return true;
  }

  // Ürünler ve malzemeler TEK ızgarada birleşir (kullanıcı isteği, 2026-08-31: "Malzemeler diye bir
  // kısım olmasın, malzemeler de ürünler kısmına dahil edilsin") — ayrı "Kullanılan Malzemeler"
  // bölümü kaldırıldı. Sunucu ikisini hâlâ AYRI döndürüyor (item.products/item.materials, bkz.
  // src/routes/project.js#fetchProjectProducts) çünkü proje-ekle.html#prefillForClaim chip listesini
  // bu iki diziden kuruyor — API şekli DEĞİŞMEDİ, yalnızca bu popup ikisini birleştirip gösteriyor.
  function mount(item, ids) {
    const mergedIds = Object.assign({}, DEFAULT_IDS, ids || {});
    const all = [...(item.products || []), ...(item.materials || [])];
    const hasProducts = renderGroup(all, mergedIds.productsSection, mergedIds.productsGrid);
    const hasBrands = renderGroup(item.brands || [], mergedIds.brandsSection, mergedIds.brandsGrid, brandCardHtml);
    // Sarmalayıcı satır: iki bölüm de boşsa tamamen gizlenir (üstteki çizgi/boşluk ondadır),
    // ikisi de doluysa ortadaki kısa dik ayırıcı çizilir (bkz. project-modal.js#pm-two-col-row-both).
    const pair = document.getElementById(mergedIds.pair);
    if (pair) {
      pair.style.display = (hasProducts || hasBrands) ? '' : 'none';
      pair.classList.toggle('pm-two-col-row-both', hasProducts && hasBrands);
    }
  }

  return { mount };
})();
