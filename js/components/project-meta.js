// ProjectMeta — proje modalının sol panelindeki künye/mimar-firma chip'leri/açıklama bloğu.
// proje-detay.html#designerGroups/filterLinkHtml/renderStructuredData'nın taşınmış hâli; tek fark
// künye artık item.designerDetails (bkz. src/routes/project.js#fetchDesignerDetails — zaten
// architects/offices canonical satırlarına ID ile bağlı olduğundan proje-detay.html'deki gibi ayrı
// bir /api/architect//api/office "eşleşmeyen isim" fallback sorgusuna GEREK YOK, her satır zaten
// gerçek bir mimar/ofis kaydına karşılık gelir) üzerinden okunur.
const ProjectMeta = (function () {

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
    const avatarClass = d.type === 'office' ? ' office-avatar' : '';
    // gerçek bulgu: fotoğraf/logo VARSA yalnızca <img> basılıyordu (baş harfler hiç DOM'a
    // yazılmıyordu) — img 404 verip onerror ile kaldırıldığında (ör. R2'de artık var olmayan bir
    // görsel) arkada hiçbir şey kalmıyor, boş bir renkli daire görünüyordu. Baş harfler artık HER
    // ZAMAN yazılır, fotoğraf (varsa) bunun ÜZERİNE mutlak konumlu olarak biner (bkz. proje.html
    // #.designer-chip-avatar img{position:absolute}) — onerror onu kaldırdığında altındaki baş
    // harfler zaten oradaydı, otomatik olarak görünür hale gelir.
    const avatarHtml = `<div class="designer-chip-avatar${avatarClass}" style="background:${officeColor(d.name)}">${escapeHtml(initials(d.name))}${d.photo ? `<img src="${escapeAttr(d.photo)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}</div>`;
    // d.unregistered: proje-ekle formundaki Mimar/Firma alanına yazılmış ama architects/offices'te
    // karşılığı olmayan isim (bkz. src/routes/project.js#fetchRawDesignerNames, kullanıcı isteği) —
    // hiçbir profile bağlanamadığından tıklanabilir bir bağlantı DEĞİL, sabit bir "rozet" olarak
    // (aynı avatar/isim düzeniyle, görsel olarak kayıtlı chip'lerle aynı hizada) render edilir.
    // unregistered çipler hiçbir profile bağlı değildir (bkz. yukarıdaki yorum) — rozet bir profil
    // güven sinyali olduğundan yalnızca kayıtlı (gerçek architects/offices satırına bağlı) çiplerde
    // gösterilir (bkz. kullanıcı isteği: mavi rozetin ilişkili TÜM alanlarda görünmesi).
    if (d.unregistered) {
      return `<span class="designer-chip">${avatarHtml}<span class="designer-chip-name">${escapeHtml(d.name)}</span></span>`;
    }
    const href = d.type === 'architect' ? `/mimar/${encodeURIComponent(slugify(d.name))}` : `/firma/${encodeURIComponent(slugify(d.name))}`;
    const badge = verifiedBadgeHtml(d.type, d.name, d.badges, 13);
    return `<a class="designer-chip" href="${href}">${avatarHtml}<span class="designer-chip-name">${escapeHtml(d.name)}${badge}</span></a>`;
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

  // Künyedeki Tür/Tip/Yer/Yıl değerleri filtrelenmiş listeye bağlanır — hedef sayfa item'ın
  // buildStatus'una göre seçilir (bkz. renderStructuredData'daki AYNI hrefPrefix mantığı): 'concept'
  // /proje'ye, diğer her şey ('built' — yapı gönderileri) /yapi'ye gider. Eskiden hep /proje'ye
  // sabitliydi, bu yüzden Yapı gönderilerindeki künye linkleri yanlışlıkla proje sayfasının
  // filtrelerini açıyordu (bkz. kullanıcı isteği).
  function filterLinkHtml(item, key, value, label) {
    const page = item.buildStatus === 'concept' ? '/proje' : '/yapi';
    return `<a href="${page}?${encodeURIComponent(key)}=${encodeURIComponent(value)}">${escapeHtml(label !== undefined ? label : value)}</a>`;
  }

  function renderMeta(item, ids) {
    let html = '';
    if (item.discipline && item.discipline.length) html += `<div><strong>Tür:</strong> ${item.discipline.map(v => filterLinkHtml(item, 'discipline', v)).join(' / ')}</div>`;
    if (item.category && item.category.length) html += `<div><strong>Tip:</strong> ${item.category.map(v => filterLinkHtml(item, 'category', v)).join(' / ')}</div>`;
    if (item.type && item.type.length) html += `<div><strong>Tip Grubu:</strong> ${item.type.map(v => filterLinkHtml(item, 'type', v)).join(' / ')}</div>`;
    if (item.location) {
      const loc = parseLocation(item.location);
      const districtText = loc.district ? escapeHtml(loc.district) + ', ' : '';
      html += `<div><strong>Yer:</strong> ${districtText}${filterLinkHtml(item, 'location', loc.city, loc.city)}</div>`;
    }
    if (item.date) html += `<div><strong>Yıl:</strong> ${item.dateBucket ? filterLinkHtml(item, 'dateBucket', item.dateBucket, item.date) : escapeHtml(item.date)}</div>`;
    if (item.photoCredit && item.photoCredit.text) {
      const creditUrl = item.photoCredit.url ? safeUrl(item.photoCredit.url) : '';
      html += `<div><strong>Fotoğraf:</strong> ${creditUrl ? `<a href="${escapeAttr(creditUrl)}" target="_blank" rel="noopener">${escapeHtml(item.photoCredit.text)}</a>` : escapeHtml(item.photoCredit.text)}</div>`;
    }
    document.getElementById(ids.meta).innerHTML = html;
  }

  // gerçek bulgu (bkz. kullanıcı isteği): eski karakter-sayısı bazlı kırpma (320 karakter) satır
  // sayısıyla ORANTISIZDI — panel genişliğine göre 320 karakter bazen 3 satırdan fazla, bazen az
  // sürüyordu. Artık saf CSS -webkit-line-clamp:3 ile TAM 3 satırda kırpılıp "…" ile biter (bkz.
  // .detail-desc-text.clamped) — metin TAM olarak DOM'a yazılır, gerçek taşma (scrollHeight >
  // clientHeight) bir sonraki frame'de ölçülüp yalnızca gerçekten 3 satırı aşan açıklamalarda
  // "Devamını gör" butonu eklenir.
  function renderDescription(item, ids) {
    const el = document.getElementById(ids.desc);
    const text = item.description || '';
    if (!text) { el.innerHTML = ''; return; }
    el.innerHTML = `<p class="detail-desc-text clamped">${escapeHtml(text)}</p>`;
    const p = el.querySelector('.detail-desc-text');
    requestAnimationFrame(() => {
      if (!p.isConnected || p.scrollHeight <= p.clientHeight + 1) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'detail-desc-more';
      btn.textContent = 'Devamını gör...';
      btn.addEventListener('click', () => { p.classList.remove('clamped'); btn.remove(); });
      el.appendChild(btn);
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
    const hrefPrefix = item.buildStatus === 'concept' ? '/proje/' : '/yapi/';
    const data = { '@context': 'https://schema.org', '@type': 'CreativeWork', name: item.title, url: new URL(`${hrefPrefix}${encodeURIComponent(item.slug)}`, window.location.origin).href };
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
    // Rozetler /api/public/badges'ten sayfa yüklenirken asenkron gelir (bkz. badge-shared.js) —
    // proje modalı bu fetch tamamlanmadan açılmışsa çipler baş harfli/rozetsiz render edilmiş
    // olabilir; js/components/architect-modal.js#renderVerifiedBadges ile AYNI desen, geldiğinde
    // Mimar/Firma çipleri bir kez daha çizilir.
    window.addEventListener('mimarlab-badges-ready', () => renderDesigners(item, mergedIds), { once: true });
    renderMeta(item, mergedIds);
    renderDescription(item, mergedIds);
    renderStructuredData(item);
  }

  return { render };
})();
