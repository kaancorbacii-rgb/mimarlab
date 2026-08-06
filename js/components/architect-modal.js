// ArchitectModal — mimar detay modalının orkestratörü (bkz. js/components/project-modal.js'teki
// AYNI open/swap/close/handlePopState state machine deseni). DOM çerçevesi (overlay/panel/focus-trap/
// scroll-lock) js/components/modal-shell.js'ten gelir; içerik eskiden mimar-detay.html'in kendi
// sayfası olarak render ettiği her şeyi (kimlik, künye, ofis kartı, meslektaşlar, ilgili
// projeler/ürünler, claim/correction kutusu) mimar.html'in kartına tıklandığında sayfa yenilenmeden
// açan bir modale taşır. Yorum/puanlama YOK — mimar-detay.html'de de hiç yoktu, kapsam dışı kalmaya
// devam ediyor (bkz. proje hafızası: "comments/ratings stay project/product-only").
const ArchitectModal = (function () {
  // .detail-title/.related-*/.save-btn/.card-edit-btn/.card-delete-btn proje.html'in modal
  // içeriğinde tanımladığı AYNI sınıflar/değerler — mimar.html farklı bir sayfa olduğundan proje.html'in
  // <style>'ını miras alamaz, bu yüzden modal-shell.js'in injectStyles() deseniyle burada KENDİ
  // <style>'ını bir kez enjekte eder (görsel bütünlük için proje modalıyla BİREBİR aynı değerler).
  // .info-card/.btn-outline/.profile-edit-btn ise mimar-detay.html'den taşınan claim/correction kutusu
  // (js/components/claim-correction-box.js) için gerekli, proje modalında hiç kullanılmıyordu.
  function injectStyles() {
    if (document.getElementById('architect-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'architect-modal-styles';
    style.textContent = `
      .detail-title{font-family:'Inter', sans-serif; font-size:26px; font-weight:700; margin:0; line-height:1.25;}
      .am-identity{display:flex; align-items:center; gap:16px; margin-bottom:18px;}
      .profile-logo{
        width:64px; height:64px; border-radius:50%; flex-shrink:0;
        border:1px solid var(--line); overflow:hidden; position:relative;
        display:flex; align-items:center; justify-content:center;
        background:var(--walnut); color:var(--paper-card);
        font-family:'IBM Plex Mono', monospace; font-weight:600; font-size:20px;
      }
      .profile-logo img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover;}
      .detail-title-actions{display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:0 0 18px;}
      .save-count{font-size:12px; color:var(--ink-soft); white-space:nowrap;}
      .card-edit-btn{
        display:inline-flex; align-items:center;
        background:var(--paper-card); border:1px solid var(--line); border-radius:100px;
        padding:8px 16px; font-size:13px; font-weight:600; color:var(--walnut); white-space:nowrap;
      }
      .card-edit-btn:hover{border-color:var(--walnut); background:var(--paper-alt);}
      .card-delete-btn{
        display:inline-flex; align-items:center;
        background:var(--paper-card); border:1px solid rgba(184,76,76,0.4); border-radius:100px;
        padding:8px 16px; font-size:13px; font-weight:600; color:#B84C4C; white-space:nowrap;
      }
      .card-delete-btn:hover{background:rgba(184,76,76,0.08);}
      .save-btn{
        display:inline-flex; align-items:center; gap:7px; flex-shrink:0;
        background:var(--paper-card); border:1px solid var(--line); border-radius:100px;
        padding:9px 18px; font-size:13.5px; font-weight:600; color:var(--ink-soft);
      }
      .save-btn:hover{border-color:var(--walnut); color:var(--ink);}
      .save-btn.saved{background:var(--ink); color:var(--paper-card); border-color:var(--ink);}
      .save-btn svg{flex-shrink:0;}
      .save-btn-label-saved{display:none;}
      .save-btn.saved .save-btn-label-default{display:none;}
      .save-btn.saved .save-btn-label-saved{display:inline;}
      .profile-edit-btn{
        display:inline-flex; align-items:center; gap:7px;
        background:none; border:1.5px solid var(--ink); color:var(--ink);
        padding:9px 18px; border-radius:100px; font-weight:600; font-size:13.5px;
      }
      .profile-edit-btn:hover{background:var(--ink); color:var(--paper-card);}
      .btn-outline{
        background:none; border:1.5px solid var(--ink); color:var(--ink);
        padding:12px 24px; border-radius:100px;
        font-weight:600; font-size:14.5px; display:inline-flex; align-items:center; gap:8px;
      }
      .btn-outline:hover{background:var(--ink); color:var(--paper-card);}
      .info-card{
        background:var(--paper-card); border:1px solid var(--line);
        border-radius:14px; padding:18px; margin-top:16px;
        display:flex; gap:14px;
      }
      .info-card svg{flex-shrink:0; color:var(--brass); margin-top:2px;}
      .info-card h5{margin:0 0 4px; font-size:13.5px; font-weight:600;}
      .info-card p{margin:0; font-size:12.5px; color:var(--ink-soft); line-height:1.5;}
      .info-card-link{font-weight:700; text-decoration:underline;}
      .detail-info{margin-top:8px;}
      .detail-meta{font-size:14px; line-height:1.9; margin-top:18px;}
      .detail-meta strong{font-weight:600; color:var(--ink);}
      .detail-desc{font-size:15px; line-height:1.7; color:var(--ink); margin-top:18px;}
      .related-section{margin-top:32px; padding-top:28px; border-top:1px solid var(--line);}
      .related-section:first-child{margin-top:0; padding-top:0; border-top:none;}
      .related-title{font-family:'Inter', sans-serif; font-size:17px; font-weight:700; margin:0 0 16px;}
      .related-card{position:relative; display:block; aspect-ratio:4/3; border-radius:12px; overflow:hidden; background:var(--paper-card); border:1px solid var(--line-soft);}
      .related-card img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover;}
      .related-card-placeholder{position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:rgba(255,255,255,0.92); font-family:'Inter', sans-serif; font-size:22px; font-weight:700;}
      .related-card-title{
        position:absolute; left:0; right:0; bottom:0; padding:12px 14px;
        background:linear-gradient(to top, rgba(27,42,61,0.85), rgba(27,42,61,0));
        color:#fff; font-family:'Inter', sans-serif; font-size:13.5px; font-weight:700;
      }
      .related-card-subtitle{font-size:11px; font-weight:500; opacity:0.85; margin-top:2px;}
      .related-grid-scroll{display:flex; gap:16px; overflow-x:auto; scroll-behavior:smooth; scrollbar-width:none; padding-bottom:4px;}
      .related-grid-scroll::-webkit-scrollbar{display:none;}
      .related-grid-scroll .related-card{flex:0 0 200px;}
      @media (max-width:860px){
        .related-grid-scroll .related-card{flex:0 0 140px;}
        .related-grid-scroll{gap:10px;}
      }
    `;
    document.head.appendChild(style);
  }

  const LEFT_TEMPLATE = `
    <div class="am-identity">
      <div class="profile-logo" id="am-logo"></div>
      <h1 class="detail-title"><span id="am-name-text"></span><span id="am-verified-badge-wrap"></span></h1>
    </div>
    <div class="detail-title-actions" id="am-actions"></div>
    <div class="detail-info" id="am-detail-info">
      <div class="detail-meta" id="am-category"></div>
      <div class="detail-desc" id="am-about"></div>
      <div class="detail-meta" id="am-info-facts" style="display:none;"></div>
    </div>
    <div class="info-card" id="claim-info-card">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/></svg>
      <div id="claim-card-body">
        <h5>Bu profil sana mı ait?</h5>
        <p>Bilgilerini güncellemek ya da fotoğrafını değiştirmek için bizimle iletişime geç.</p>
      </div>
    </div>
    <div class="info-card">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="4" x2="8" y2="9"/></svg>
      <div>
        <h5>Bilgi kaynağı</h5>
        <p>Buradaki bilgiler kişinin / firmanın websitesinden ve halka açık kaynaklardan derlenmiştir.</p>
        <div id="correction-card-extra"></div>
      </div>
    </div>`;

  const RIGHT_TEMPLATE = `
    <div class="related-section" id="am-office-section" style="display:none;">
      <h2 class="related-title">Firmalar</h2>
      <div class="related-grid-scroll" id="am-office-grid"></div>
    </div>
    <div class="related-section" id="am-colleagues-section" style="display:none;">
      <h2 class="related-title">Diğer Firma Ortakları</h2>
      <div class="related-grid-scroll" id="am-colleagues-grid"></div>
    </div>
    <div class="related-section" id="am-related-projects-section" style="display:none;">
      <h2 class="related-title">Projeler</h2>
      <div class="related-grid-scroll" id="am-related-projects-grid"></div>
    </div>
    <div class="related-section" id="am-related-products-section" style="display:none;">
      <h2 class="related-title">Ürünler</h2>
      <div class="related-grid-scroll" id="am-related-products-grid"></div>
    </div>`;

  let mountedOnce = false;
  let currentSlug = null;
  let currentItem = null;
  let openedViaPush = false;
  let pushCountSinceOpen = 0;
  let requestSeq = 0;

  function ensureTemplate() {
    if (mountedOnce) return;
    const panels = ModalShell.getPanels();
    panels.leftPanelEl.innerHTML = LEFT_TEMPLATE;
    panels.rightPanelEl.innerHTML = RIGHT_TEMPLATE;
    mountedOnce = true;
  }

  const DEPT_TO_PROFESSION = {
    'Mimarlık': 'Mimar',
    'İç Mimarlık': 'İç Mimar',
    'İç Mimarlık ve Çevre Tasarımı': 'İç Mimar',
    'Peyzaj Mimarlığı': 'Peyzaj Mimarı',
    'Şehir ve Bölge Planlama': 'Şehir Plancısı',
    'Restorasyon': 'Restoratör',
  };

  function cardHtml(href, title, image, subtitle) {
    return `<a class="related-card" href="${href}">
      ${image ? `<img src="${escapeAttr(image)}" alt="${escapeAttr(title)}" loading="lazy" decoding="async">` : `<div class="related-card-placeholder" style="background:${officeColor(title)}">${escapeHtml(initials(title))}</div>`}
      <div class="related-card-title">${escapeHtml(title)}${subtitle ? `<div class="related-card-subtitle">${escapeHtml(subtitle)}</div>` : ''}</div>
    </a>`;
  }

  function updateHeadMeta(a, office) {
    document.title = `${a.name} — MİMARLAB`;
    const desc = office
      ? `${a.name}, ${office.name} bünyesinde ${a.role || 'mimar'} olarak görev yapmaktadır. MİMARLAB'da profilini incele.`
      : `${a.name} — MİMARLAB'da mimar profilini incele.`;
    const canonicalUrl = `https://mimarlab.com/mimar/${encodeURIComponent(slugify(a.name))}`;
    const image = a.photo ? new URL(a.photo, window.location.origin).href : 'https://mimarlab.com/logos/site/mimarlab-logo.png';
    const setIf = (id, attr, val) => { const el = document.getElementById(id); if (el) el.setAttribute(attr, val); };
    setIf('meta-description', 'content', desc);
    setIf('canonical-link', 'href', canonicalUrl);
    setIf('og-title', 'content', document.title);
    setIf('og-description', 'content', desc);
    setIf('og-url', 'content', canonicalUrl);
    setIf('og-image', 'content', image);
    setIf('twitter-title', 'content', document.title);
    setIf('twitter-description', 'content', desc);
    setIf('twitter-image', 'content', image);
  }

  function renderStructuredData(a, office) {
    let tag = document.getElementById('am-ld-json');
    if (!tag) {
      tag = document.createElement('script');
      tag.type = 'application/ld+json';
      tag.id = 'am-ld-json';
      document.head.appendChild(tag);
    }
    const data = { '@context': 'https://schema.org', '@type': 'Person', name: a.name, url: window.location.href };
    if (a.role) data.jobTitle = a.role;
    if (a.photo) { try { data.image = new URL(a.photo, window.location.href).href; } catch {} }
    if (a.school) data.alumniOf = { '@type': 'CollegeOrUniversity', name: a.school };
    if (office) data.worksFor = { '@type': 'Organization', name: office.name, url: new URL('/firma/' + encodeURIComponent(slugify(office.name)), window.location.href).href };
    tag.textContent = JSON.stringify(data);
  }

  async function renderItem(payload) {
    const a = payload.item;
    const office = payload.office;
    const offices = payload.offices || (office ? [office] : []);
    const colleagues = payload.colleagues || [];
    const relatedProjectsData = payload.relatedProjects || [];
    currentItem = a;

    updateHeadMeta(a, office);
    document.getElementById('am-name-text').textContent = a.name;
    document.getElementById('am-category').innerHTML = `<strong>${escapeHtml([a.role, office ? office.name : null].filter(Boolean).join(' · '))}</strong>`;
    document.getElementById('am-about').textContent = a.about || (office
      ? `${a.name}, ${office.name} bünyesinde${a.role ? ' ' + a.role + ' olarak' : ''} görev yapmaktadır.`
      : (a.role ? `${a.name}, ${a.role} olarak çalışmaktadır.` : `${a.name} — MİMARLAB dizininde yer alan bir mimar.`));

    const infoFactsEl = document.getElementById('am-info-facts');
    const infoFacts = [];
    if (a.dob) infoFacts.push(`<div><strong>Doğum Tarihi:</strong> ${escapeHtml(String(a.dob))}</div>`);
    if (a.school || a.dept) infoFacts.push(`<div><strong>Üniversite / Bölüm:</strong> ${[a.school, a.dept].filter(Boolean).map(escapeHtml).join(' / ')}</div>`);
    const profession = a.profession || DEPT_TO_PROFESSION[a.dept] || null;
    if (a.role || profession) infoFacts.push(`<div><strong>Pozisyon / Meslek:</strong> ${[a.role, profession].filter(Boolean).map(escapeHtml).join(' / ')}</div>`);
    if (a.awards && a.awards.length) infoFacts.push(`<div><strong>Ödüller:</strong> ${a.awards.map(escapeHtml).join(', ')}</div>`);
    infoFactsEl.innerHTML = infoFacts.join('');
    infoFactsEl.style.display = infoFacts.length ? '' : 'none';

    const logoEl = document.getElementById('am-logo');
    logoEl.innerHTML = '';
    logoEl.textContent = initials(a.name);
    logoEl.style.background = officeColor(a.name);
    if (a.photo) {
      const img = document.createElement('img');
      img.src = a.photo;
      img.alt = '';
      img.fetchPriority = 'high';
      img.onerror = () => img.remove();
      logoEl.appendChild(img);
    }

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'save-btn card-save-btn';
    saveBtn.id = 'am-save-btn';
    saveBtn.setAttribute('aria-label', 'Kaydet');
    saveBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z"/></svg><span class="save-btn-label-default">Kaydet</span><span class="save-btn-label-saved">Kaydedildi</span>`;
    const actionsEl = document.getElementById('am-actions');
    actionsEl.innerHTML = '<span class="save-count" id="am-save-count"></span><span id="profile-edit-slot"></span>';
    actionsEl.prepend(saveBtn);
    saveBtn.dataset.key = slugify(a.name);
    saveBtn.dataset.title = a.name;
    saveBtn.dataset.meta = office ? office.name : (a.role || '');
    saveBtn.dataset.image = a.photo || '';
    saveBtn.dataset.href = `/mimar/${encodeURIComponent(slugify(a.name))}`;
    wireSaveButtons('architect');
    fetch(`/api/public/save-count?type=architect&key=${encodeURIComponent(saveBtn.dataset.key)}`)
      .then(r => r.json())
      .then(data => { document.getElementById('am-save-count').textContent = data.count > 0 ? `${data.count} kez kaydedildi` : ''; })
      .catch(() => {});

    renderStructuredData(a, office);

    const officeSectionEl = document.getElementById('am-office-section');
    officeSectionEl.style.display = offices.length ? '' : 'none';
    document.getElementById('am-office-grid').innerHTML = offices.map(off =>
      cardHtml(`/firma/${encodeURIComponent(slugify(off.name))}`, off.name, logoUrl(off), [off.loc, off.yil ? 'K. ' + off.yil : null].filter(Boolean).join(' · '))
    ).join('');

    document.getElementById('am-colleagues-section').style.display = colleagues.length ? '' : 'none';
    document.getElementById('am-colleagues-grid').innerHTML = colleagues.map(c =>
      cardHtml(`/mimar/${encodeURIComponent(slugify(c.name))}`, c.name, c.photo, c.role)
    ).join('');

    document.getElementById('am-related-projects-section').style.display = relatedProjectsData.length ? '' : 'none';
    document.getElementById('am-related-projects-grid').innerHTML = relatedProjectsData.map(p =>
      cardHtml(`/projeler/${encodeURIComponent(p.slug)}`, p.title, p.images && p.images[0])
    ).join('');

    const PROFILE_TYPE = 'architect';
    const claimBox = createClaimCorrectionBox({
      profileType: PROFILE_TYPE,
      ready: savedWidgetReady,
      getProfileKey: () => a.name,
      editUrlBase: 'mimar-ekle.html',
      listUrl: 'mimar.html',
      contentType: 'architects',
      getModerationTarget: () => ({ key: a.name }),
      labels: {
        claimTitle: 'Bu profil sana mı ait?',
        loginPromptHtml: 'Bilgilerini güncellemek ve doğrulanmış üye rozeti almak için <a href="giris-yap.html" class="info-card-link">giriş yap</a>.',
        pendingHtml: '"Bu profil bana ait" talebini aldık, ekibimiz en kısa sürede onaylayacak.',
        claimNotePlaceholder: 'Bu profilin sana ait olduğunu doğrulamamıza yardımcı olacak bir not ekle: Örn. Instagram/LinkedIn hesabın.',
        claimButtonText: 'Bu profil bana ait',
        deleteConfirm: 'Bu mimar profilini silmek istediğine emin misin? Profil anında canlı siteden kaldırılır.',
        archiveConfirm: 'Bu mimar profilini arşivlemek istediğine emin misin? Profil canlıdan kaldırılıp admin panelindeki Arşiv sekmesine taşınır.',
      },
    });

    async function loadProfileContent() {
      try {
        const res = await fetch(`/api/public/profile-content?profileType=${PROFILE_TYPE}&profileKey=${encodeURIComponent(a.name)}`);
        if (!res.ok) return;
        const data = await res.json();
        const products = data.products || [];
        document.getElementById('am-related-products-section').style.display = products.length ? '' : 'none';
        document.getElementById('am-related-products-grid').innerHTML = products.map(p => cardHtml('urun.html', p.title, p.image, p.category)).join('');
      } catch {}
    }

    function renderVerifiedBadges() {
      document.getElementById('am-verified-badge-wrap').innerHTML = verifiedBadgeHtml(PROFILE_TYPE, a.name, a.badges, 20);
    }
    renderVerifiedBadges();
    window.addEventListener('mimarlab-badges-ready', renderVerifiedBadges, { once: true });

    loadProfileContent();
    await savedWidgetReady;
    await claimBox.init();

    wireInternalNav();
    ModalShell.scrollToTop();
  }

  function renderNotFound() {
    document.getElementById('am-name-text').textContent = 'Mimar bulunamadı';
    ['am-actions', 'am-office-section', 'am-colleagues-section', 'am-related-projects-section',
      'am-related-products-section', 'am-detail-info'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  function wireInternalNav() {
    const panels = ModalShell.getPanels();
    if (!panels || panels.bodyEl.dataset.amNavWired) return;
    panels.bodyEl.dataset.amNavWired = '1';
    panels.bodyEl.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="/mimar/"]');
      if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const m = a.getAttribute('href').match(/^\/mimar\/([^/?#]+)/);
      if (!m) return;
      e.preventDefault();
      swap(decodeURIComponent(m[1]));
    });
  }

  async function fetchItem(slug) {
    const res = await fetch(`/api/architect/${encodeURIComponent(slug)}`);
    if (!res.ok) return null;
    const payload = await res.json();
    if (!payload || !payload.item || payload.hidden) return null;
    return payload;
  }

  async function open(slug, { pushHistory = true, triggerEl = null } = {}) {
    currentSlug = slug;
    openedViaPush = pushHistory;
    pushCountSinceOpen = pushHistory ? 1 : 0;
    if (pushHistory) history.pushState({ mimarlabModal: 'architect', slug, depth: 1 }, '', `/mimar/${encodeURIComponent(slug)}`);
    injectStyles();
    ModalShell.open({ triggerEl, onRequestClose: close });
    ensureTemplate();

    const mySeq = ++requestSeq;
    const payload = await fetchItem(slug);
    if (mySeq !== requestSeq || currentSlug !== slug) return;
    if (!payload) { renderNotFound(); return; }
    await renderItem(payload);
  }

  async function swap(slug) {
    if (!ModalShell.isOpen()) return open(slug, { pushHistory: true });
    currentSlug = slug;
    const currentDepth = (history.state && history.state.mimarlabModal === 'architect') ? history.state.depth : pushCountSinceOpen;
    pushCountSinceOpen = currentDepth + 1;
    history.pushState({ mimarlabModal: 'architect', slug, depth: pushCountSinceOpen }, '', `/mimar/${encodeURIComponent(slug)}`);
    const mySeq = ++requestSeq;
    const payload = await fetchItem(slug);
    if (mySeq !== requestSeq || currentSlug !== slug) return;
    if (!payload) { renderNotFound(); return; }
    await renderItem(payload);
  }

  function close() {
    currentSlug = null;
    currentItem = null;
    if (openedViaPush && pushCountSinceOpen > 0) history.go(-pushCountSinceOpen);
    else history.pushState({}, '', '/mimar');
    ModalShell.close();
    pushCountSinceOpen = 0;
  }

  function handlePopState(slug) {
    if (!slug) { if (ModalShell.isOpen()) { currentSlug = null; currentItem = null; ModalShell.close(); } return; }
    if (!ModalShell.isOpen()) { openedViaPush = false; open(slug, { pushHistory: false }); return; }
    if (history.state && history.state.mimarlabModal === 'architect' && typeof history.state.depth === 'number') {
      pushCountSinceOpen = history.state.depth;
    }
    if (slug === currentSlug) return;
    currentSlug = slug;
    (async () => {
      const mySeq = ++requestSeq;
      const payload = await fetchItem(slug);
      if (mySeq !== requestSeq || currentSlug !== slug) return;
      if (!payload) { renderNotFound(); return; }
      await renderItem(payload);
    })();
  }

  function isOpen() { return ModalShell.isOpen(); }
  function getCurrentSlug() { return currentSlug; }

  return { open, swap, close, handlePopState, isOpen, getCurrentSlug };
})();
