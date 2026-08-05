// ProjectMeta — proje modalının sol panelindeki künye/mimar-firma chip'leri/açıklama bloğu.
// proje-detay.html#designerGroups/filterLinkHtml/renderStructuredData'nın taşınmış hâli; tek fark
// künye artık item.designerDetails (bkz. src/routes/project.js#fetchDesignerDetails — zaten
// architects/offices canonical satırlarına ID ile bağlı olduğundan proje-detay.html'deki gibi ayrı
// bir /api/architect//api/office "eşleşmeyen isim" fallback sorgusuna GEREK YOK, her satır zaten
// gerçek bir mimar/ofis kaydına karşılık gelir) üzerinden okunur.
const ProjectMeta = (function () {
  const DESC_TRUNCATE_AT = 320;

  // bkz. XSS escaping convention (memory) — depolanmış herhangi bir URL http(s) değilse asla
  // href/src'e basılmaz. proje-detay.html#safeUrl ile birebir aynı.
  function safeUrl(u) {
    try {
      const parsed = new URL(u, window.location.href);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
    } catch { /* geçersiz URL — boş dön */ }
    return '';
  }
  window.safeUrl = window.safeUrl || safeUrl;

  function designerChipHtml(d) {
    const href = d.type === 'architect' ? `/mimar/${encodeURIComponent(slugify(d.name))}` : `/firma/${encodeURIComponent(slugify(d.name))}`;
    const avatarClass = d.type === 'office' ? ' office-avatar' : '';
    return `<a class="designer-chip" href="${href}">
      <div class="designer-chip-avatar${avatarClass}" style="background:${d.photo ? 'var(--paper-alt)' : officeColor(d.name)}">${d.photo ? `<img src="${escapeAttr(d.photo)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : escapeHtml(initials(d.name))}</div>
      <span class="designer-chip-name">${escapeHtml(d.name)}</span>
    </a>`;
  }

  function renderDesigners(item, ids) {
    const architects = (item.designerDetails || []).filter(d => d.type === 'architect');
    const offices = (item.designerDetails || []).filter(d => d.type === 'office');
    const archSection = document.getElementById(ids.architectSection);
    const officeSection = document.getElementById(ids.officeSection);
    if (architects.length) {
      archSection.style.display = '';
      document.getElementById(ids.architectChips).innerHTML = architects.map(designerChipHtml).join('');
    } else {
      archSection.style.display = 'none';
    }
    if (offices.length) {
      officeSection.style.display = '';
      document.getElementById(ids.officeChips).innerHTML = offices.map(designerChipHtml).join('');
    } else {
      officeSection.style.display = 'none';
    }
  }

  // Künyedeki Tür/Tip/Yer/Yıl değerleri /proje?key=value şeklinde filtrelenmiş listeye bağlanır —
  // proje-detay.html#filterLinkHtml ile birebir aynı.
  function filterLinkHtml(key, value, label) {
    return `<a href="/proje?${encodeURIComponent(key)}=${encodeURIComponent(value)}">${escapeHtml(label !== undefined ? label : value)}</a>`;
  }

  function renderMeta(item, ids) {
    let html = '';
    if (item.discipline && item.discipline.length) html += `<div><strong>Tür:</strong> ${item.discipline.map(v => filterLinkHtml('discipline', v)).join(' / ')}</div>`;
    if (item.category && item.category.length) html += `<div><strong>Tip:</strong> ${item.category.map(v => filterLinkHtml('category', v)).join(' / ')}</div>`;
    if (item.type && item.type.length) html += `<div><strong>Tip Grubu:</strong> ${item.type.map(v => filterLinkHtml('type', v)).join(' / ')}</div>`;
    if (item.location) {
      const loc = parseLocation(item.location);
      const districtText = loc.district ? escapeHtml(loc.district) + ', ' : '';
      html += `<div><strong>Yer:</strong> ${districtText}${filterLinkHtml('location', loc.city, loc.city)}</div>`;
    }
    if (item.date) html += `<div><strong>Yıl:</strong> ${item.dateBucket ? filterLinkHtml('dateBucket', item.dateBucket, item.date) : escapeHtml(item.date)}</div>`;
    if (item.photoCredit && item.photoCredit.text) {
      const creditUrl = item.photoCredit.url ? safeUrl(item.photoCredit.url) : '';
      html += `<div><strong>Fotoğraf:</strong> ${creditUrl ? `<a href="${escapeAttr(creditUrl)}" target="_blank" rel="noopener">${escapeHtml(item.photoCredit.text)}</a>` : escapeHtml(item.photoCredit.text)}</div>`;
    }
    document.getElementById(ids.meta).innerHTML = html;
  }

  function renderDescription(item, ids) {
    const el = document.getElementById(ids.desc);
    const text = item.description || '';
    if (text.length <= DESC_TRUNCATE_AT) {
      el.innerHTML = `<p class="detail-desc-text">${escapeHtml(text)}</p>`;
      return;
    }
    const truncated = text.slice(0, DESC_TRUNCATE_AT).trim();
    el.innerHTML = `<p class="detail-desc-text">${escapeHtml(truncated)}… <button type="button" class="detail-desc-more">Devamını oku...</button></p>`;
    el.querySelector('.detail-desc-more').addEventListener('click', () => {
      el.innerHTML = `<p class="detail-desc-text">${escapeHtml(text)}</p>`;
    });
  }

  // Google zengin sonuçları için Schema.org CreativeWork — proje-detay.html#renderStructuredData ile
  // aynı, modalda dinamik olarak enjekte/güncellenir (bkz. ProjectModal#pushHistoryState çağrısında
  // document.title de aynı yerde güncellenir).
  function renderStructuredData(item) {
    let tag = document.getElementById('pm-ld-json');
    if (!tag) {
      tag = document.createElement('script');
      tag.type = 'application/ld+json';
      tag.id = 'pm-ld-json';
      document.head.appendChild(tag);
    }
    const data = { '@context': 'https://schema.org', '@type': 'CreativeWork', name: item.title, url: new URL(`/projeler/${encodeURIComponent(item.slug)}`, window.location.origin).href };
    if (item.description) data.description = item.description;
    if (item.images && item.images.length) {
      try { data.image = item.images.map(img => new URL(img, window.location.href).href); } catch { /* göreli çözümlenemeyen — atla */ }
    }
    if (item.location) data.locationCreated = { '@type': 'Place', address: item.location };
    const creators = (item.designerDetails || []).map(d => ({ '@type': d.type === 'architect' ? 'Person' : 'Organization', name: d.name }));
    if (creators.length) data.creator = creators.length === 1 ? creators[0] : creators;
    tag.textContent = JSON.stringify(data);
  }

  const DEFAULT_IDS = {
    title: 'pm-title', architectSection: 'pm-architect-section', architectChips: 'pm-architect-chips',
    officeSection: 'pm-office-section', officeChips: 'pm-office-chips', meta: 'pm-meta', desc: 'pm-desc',
  };

  function render(item, ids) {
    const mergedIds = Object.assign({}, DEFAULT_IDS, ids || {});
    document.getElementById(mergedIds.title).textContent = item.title;
    renderDesigners(item, mergedIds);
    renderMeta(item, mergedIds);
    renderDescription(item, mergedIds);
    renderStructuredData(item);
  }

  return { render };
})();
