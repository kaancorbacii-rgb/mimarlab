// ConsultantModal — /danismanlik detay modalının orkestratörü. js/components/architect-modal.js
// ile AYNI state machine deseni (open/swap/close/handlePopState, history key farklı:
// mimarlabModal:'consultant', URL /danismanlik/:slug) — DOM çerçevesi (overlay/panel/focus-trap/
// scroll-lock) js/components/modal-shell.js'ten gelir. Sağ panel architect-modal.js'teki "ilgili
// firma/proje" grid'leri yerine ADPList Yan Liu profilinden ilham alan sticky rezervasyon kutusu
// (topluluk istatistikleri + tarih/saat slotları + placeholder CTA + benzer danışmanlar carousel)
// taşır (bkz. kullanıcı isteği). Bu turda claim/geri bildirim kutusu YOK — consultant kaydı zaten
// architects tablosundaki AYNI satır, claim akışı /mimar tarafında zaten var; gerçek review/
// achievement/grup seansı backend'i de yok, o sekmeler "Yakında" placeholder'ı gösterir (bkz. plan:
// kapsam dışı).
const ConsultantModal = (function () {
  function injectStyles() {
    if (document.getElementById('consultant-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'consultant-modal-styles';
    style.textContent = `
      .detail-title{font-family:'Inter', sans-serif; font-size:26px; font-weight:700; margin:0; line-height:1.25;}
      .cm-identity{display:flex; align-items:center; gap:16px; margin-bottom:18px;}
      .profile-logo{
        width:64px; height:64px; border-radius:50%; flex-shrink:0;
        border:1px solid var(--line); overflow:hidden; position:relative;
        display:flex; align-items:center; justify-content:center;
        background:var(--walnut); color:var(--paper-card);
        font-family:'IBM Plex Mono', monospace; font-weight:600; font-size:20px;
      }
      .profile-logo img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover;}
      .detail-title-actions{
        display:flex !important; flex-direction:row !important; flex-wrap:nowrap !important;
        align-items:center !important; justify-content:flex-start !important; width:100% !important;
        gap:4px !important; margin:0 0 18px;
      }
      .save-btn{
        display:inline-flex; align-items:center; gap:5px;
        flex-shrink:1 !important; min-width:0 !important; white-space:nowrap !important; overflow:hidden !important; text-overflow:ellipsis;
        height:32px !important; box-sizing:border-box;
        background:var(--paper-card); border:1px solid var(--line); border-radius:100px;
        padding:0 8px !important; font-size:12px !important; font-weight:600; color:var(--ink-soft);
        font-family:inherit; line-height:1;
      }
      .save-btn:hover{border-color:var(--walnut); color:var(--ink);}
      .save-btn.saved{background:var(--ink); color:var(--paper-card); border-color:var(--ink);}
      .save-btn svg{flex-shrink:0;}
      .save-btn-label-saved{display:none;}
      .save-btn.saved .save-btn-label-default{display:none;}
      .save-btn.saved .save-btn-label-saved{display:inline;}
      .save-btn-count{font-weight:600;}

      /* Sekmeler — Genel Bakış/Değerlendirmeler/Uzmanlıklar/Grup Seansları (bkz. kullanıcı isteği:
         ADPList Yan Liu profili). Yalnızca Genel Bakış gerçek içerik taşır, diğer 3'ü backend'i
         olmadığından "Yakında" boş-durumu gösterir (bkz. dosya başı yorumu). */
      .cm-tabs{display:flex; gap:4px; border-bottom:1px solid var(--line); margin-bottom:20px; overflow-x:auto; scrollbar-width:none;}
      .cm-tabs::-webkit-scrollbar{display:none;}
      .cm-tab{flex-shrink:0; padding:10px 4px; margin-right:20px; font-size:13.5px; font-weight:600; color:var(--ink-soft); border-bottom:2px solid transparent; background:none; border-radius:0;}
      .cm-tab.active{color:var(--ink); border-bottom-color:var(--ink);}
      .cm-tab-panel{display:none;}
      .cm-tab-panel.active{display:block;}
      .cm-tab-empty{padding:32px 0; text-align:center; color:var(--ink-soft); font-size:13.5px;}

      .detail-info{margin-top:0;}
      .detail-meta{font-size:14px; line-height:1.9; margin-top:0;}
      .detail-meta strong{font-weight:600; color:var(--ink);}
      .detail-desc{font-size:15px; line-height:1.7; color:var(--ink); margin-top:14px;}
      .detail-desc-more{background:none; border:none; padding:0; color:var(--walnut); font-weight:600; font-size:14px; text-decoration:underline; text-decoration-color:var(--line); cursor:pointer;}
      .detail-desc-more:hover{color:var(--ink);}

      .cm-tags{display:flex; flex-wrap:wrap; gap:8px; margin-top:18px;}
      .cm-tag{padding:6px 14px; border-radius:100px; border:1px solid var(--line); background:var(--paper); font-size:12.5px; font-weight:600; color:var(--ink-soft);}

      .cm-insights{display:flex; flex-direction:column; gap:10px; margin-top:22px;}
      .cm-insight-card{display:flex; align-items:flex-start; gap:10px; padding:12px 14px; border:1px solid var(--line-soft); border-radius:12px; background:var(--paper);}
      .cm-insight-icon{font-size:18px; line-height:1; flex-shrink:0;}
      .cm-insight-title{font-size:13.5px; font-weight:700; color:var(--ink);}
      .cm-insight-desc{font-size:12px; color:var(--ink-soft); margin-top:2px;}

      /* ---------- Sağ panel: sticky rezervasyon kutusu (bkz. kullanıcı isteği: ADPList Yan Liu
         profilindeki "Available sessions" kutusu) ---------- */
      .cm-booking{position:sticky; top:0; display:flex; flex-direction:column; gap:20px; padding-bottom:24px; border-bottom:1px solid var(--line); margin-bottom:24px;}
      .cm-stats{display:flex; gap:24px;}
      .cm-stat{flex:1;}
      .cm-stat-value{font-family:'Inter', sans-serif; font-size:20px; font-weight:700; color:var(--ink);}
      .cm-stat-label{font-size:11.5px; color:var(--ink-soft); margin-top:2px;}
      .cm-slots-title{font-size:13px; font-weight:700; color:var(--ink); margin:0 0 10px;}
      .cm-date-row{display:flex; gap:8px; overflow-x:auto; scrollbar-width:none; margin-bottom:14px;}
      .cm-date-row::-webkit-scrollbar{display:none;}
      .cm-date-chip{flex-shrink:0; min-width:64px; text-align:center; padding:10px 12px; border-radius:12px; border:1px solid var(--line); background:var(--paper); font-size:12px; font-weight:600; color:var(--ink-soft);}
      .cm-date-chip .cm-date-day{font-size:14px; font-weight:700; color:var(--ink); display:block; margin-top:2px;}
      .cm-date-chip.active{background:var(--ink); border-color:var(--ink); color:var(--paper-card);}
      .cm-date-chip.active .cm-date-day{color:var(--paper-card);}
      .cm-time-grid{display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin-bottom:16px;}
      .cm-time-btn{padding:9px 6px; border-radius:8px; border:1px solid var(--line); background:var(--paper); font-size:12.5px; font-weight:600; color:var(--ink);}
      .cm-time-btn:hover:not(:disabled){border-color:var(--walnut);}
      .cm-time-btn.active{background:var(--ink); border-color:var(--ink); color:var(--paper-card);}
      .cm-time-btn:disabled{opacity:0.35; cursor:not-allowed; text-decoration:line-through;}
      .cm-cta-btn{
        width:100%; padding:15px; border-radius:100px; border:none;
        background:var(--ink); color:var(--paper-card); font-weight:700; font-size:14px;
      }
      .cm-cta-btn:hover{background:var(--walnut);}
      .cm-cta-note{font-size:11.5px; color:var(--ink-soft); text-align:center; margin-top:8px; display:none;}
      .cm-cta-note.show{display:block;}
      .cm-empty-slots{font-size:13px; color:var(--ink-soft); padding:12px 0;}

      .related-section{margin-top:32px; padding-top:28px; border-top:1px solid var(--line);}
      .related-title{font-family:'Inter', sans-serif; font-size:17px; font-weight:700; margin:0 0 16px;}
      .related-card{position:relative; display:block; aspect-ratio:4/3; border-radius:12px; overflow:hidden; background:var(--paper-card); border:1px solid var(--line-soft);}
      .related-card img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover;}
      .related-card-placeholder{position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:rgba(255,255,255,0.92); font-family:'Inter', sans-serif; font-size:22px; font-weight:700;}
      .related-card-title{
        position:absolute; left:0; right:0; bottom:0; padding:12px 14px;
        background:linear-gradient(to top, rgba(27,42,61,0.85), rgba(27,42,61,0));
        color:#fff; font-family:'Inter', sans-serif; font-size:13.5px; font-weight:700;
      }
      .related-card-title-text{display:-webkit-box !important; -webkit-line-clamp:2 !important; -webkit-box-orient:vertical !important; overflow:hidden !important; text-overflow:ellipsis !important; word-break:break-word !important; line-height:1.25em !important; max-height:2.5em !important;}
      .related-card-subtitle{font-size:11px; font-weight:500; opacity:0.85; margin-top:2px;}
      .related-grid-scroll{display:flex; gap:16px; overflow-x:auto; scroll-behavior:smooth; scrollbar-width:none; padding-bottom:4px;}
      .related-grid-scroll::-webkit-scrollbar{display:none;}
      .related-grid-scroll .related-card{flex:0 0 200px;}

      @media (max-width:860px){
        .cm-booking{position:static;}
        .related-grid-scroll .related-card{flex:0 0 140px;}
        .related-grid-scroll{gap:10px;}
        .save-btn{height:48px !important; min-height:48px !important; padding:0 14px !important; font-size:13.5px !important;}
        .detail-title-actions{gap:8px !important;}
        .cm-time-grid{grid-template-columns:repeat(2, 1fr);}
      }
    `;
    document.head.appendChild(style);
  }

  const LEFT_TEMPLATE = `
    <div class="cm-identity">
      <div class="profile-logo" id="cm-logo"></div>
      <h1 class="detail-title"><span id="cm-name-text"></span><span id="cm-verified-badge-wrap"></span></h1>
    </div>
    <div class="detail-title-actions" id="cm-actions"></div>
    <div class="detail-info" id="cm-detail-info">
      <div class="detail-meta" id="cm-category"></div>
    </div>
    <div class="cm-tabs" id="cm-tabs">
      <button type="button" class="cm-tab active" data-tab="overview">Genel Bakış</button>
      <button type="button" class="cm-tab" data-tab="reviews">Değerlendirmeler</button>
      <button type="button" class="cm-tab" data-tab="achievements">Uzmanlıklar</button>
      <button type="button" class="cm-tab" data-tab="groups">Grup Seansları</button>
    </div>
    <div class="cm-tab-panel active" id="cm-tab-overview">
      <div class="detail-desc" id="cm-about"></div>
      <div class="cm-tags" id="cm-tags"></div>
      <div class="cm-insights" id="cm-insights"></div>
    </div>
    <div class="cm-tab-panel" id="cm-tab-reviews"><div class="cm-tab-empty">Değerlendirmeler yakında burada olacak.</div></div>
    <div class="cm-tab-panel" id="cm-tab-achievements"><div class="cm-tab-empty">Uzmanlık başarıları yakında burada olacak.</div></div>
    <div class="cm-tab-panel" id="cm-tab-groups"><div class="cm-tab-empty">Grup seansları yakında burada olacak.</div></div>`;

  const RIGHT_TEMPLATE = `
    <div class="cm-booking" id="cm-booking">
      <div class="cm-stats">
        <div class="cm-stat"><div class="cm-stat-value" id="cm-stat-minutes"></div><div class="cm-stat-label">Toplam Görüşme Süresi</div></div>
        <div class="cm-stat"><div class="cm-stat-value" id="cm-stat-sessions"></div><div class="cm-stat-label">Tamamlanan Seans</div></div>
      </div>
      <div id="cm-slots-wrap">
        <div class="cm-slots-title">Uygun Seanslar</div>
        <div class="cm-date-row" id="cm-date-row"></div>
        <div class="cm-time-grid" id="cm-time-grid"></div>
        <button type="button" class="cm-cta-btn" id="cm-cta-btn">Seans Satın Al</button>
        <div class="cm-cta-note" id="cm-cta-note">Ödeme altyapısı yakında aktif olacak.</div>
      </div>
    </div>
    <div class="related-section" id="cm-similar-section" style="display:none;">
      <h2 class="related-title">Benzer Danışmanlar</h2>
      <div class="related-grid-scroll" id="cm-similar-grid"></div>
    </div>`;

  let mountedOnce = false;
  let currentSlug = null;
  let currentItem = null;
  let openedViaPush = false;
  let pushCountSinceOpen = 0;
  let requestSeq = 0;
  let selectedDateIndex = 0;

  function ensureTemplate() {
    if (mountedOnce) return;
    const panels = ModalShell.getPanels();
    panels.leftPanelEl.innerHTML = LEFT_TEMPLATE;
    panels.rightPanelEl.innerHTML = RIGHT_TEMPLATE;
    ModalShell.wireGridScrollArrows(panels.rightPanelEl);
    wireTabs();
    mountedOnce = true;
  }

  function wireTabs() {
    document.getElementById('cm-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.cm-tab');
      if (!btn) return;
      document.querySelectorAll('.cm-tab').forEach(t => t.classList.toggle('active', t === btn));
      document.querySelectorAll('.cm-tab-panel').forEach(p => p.classList.toggle('active', p.id === `cm-tab-${btn.dataset.tab}`));
    });
  }

  const DESC_TRUNCATE_AT = 320;
  function renderTruncatedDesc(elId, text) {
    const el = document.getElementById(elId);
    if (text.length <= DESC_TRUNCATE_AT) { el.textContent = text; return; }
    const truncated = text.slice(0, DESC_TRUNCATE_AT).trim();
    el.innerHTML = `${escapeHtml(truncated)}… <button type="button" class="detail-desc-more">Devamını gör...</button>`;
    el.querySelector('.detail-desc-more').addEventListener('click', () => { el.textContent = text; });
  }

  function cardHtml(href, title, image, subtitle, badgeHtml) {
    const srcset = image ? cdnSrcset(image, [300, 450, 600]) : '';
    return `<a class="related-card" href="${href}">
      ${image ? `<img src="${escapeAttr(cdnImg(image, 450))}"${srcset ? ` srcset="${escapeAttr(srcset)}" sizes="300px"` : ''} alt="${escapeAttr(title)}" loading="lazy" decoding="async">` : `<div class="related-card-placeholder" style="background:${officeColor(title)}">${escapeHtml(initials(title))}</div>`}
      <div class="related-card-title"><span class="related-card-title-text">${escapeHtml(title)}${badgeHtml || ''}</span>${subtitle ? `<div class="related-card-subtitle">${escapeHtml(subtitle)}</div>` : ''}</div>
    </a>`;
  }

  function updateHeadMeta(a) {
    document.title = `${a.name} — Online Danışmanlık | MİMARLAB`;
    const desc = a.about ? a.about.slice(0, 200) : `${a.name} — MİMARLAB'da online danışmanlık/mentörlük seansı ayırt.`;
    const canonicalUrl = `https://mimarlab.com/danismanlik/${encodeURIComponent(slugify(a.name))}`;
    const image = a.photo ? new URL(a.photo, window.location.origin).href : 'https://mimarlab.com/logos/site/mimarlab-og-image.png';
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

  function renderStructuredData(a) {
    let tag = document.getElementById('cm-ld-json');
    if (!tag) {
      tag = document.createElement('script');
      tag.type = 'application/ld+json';
      tag.id = 'cm-ld-json';
      document.head.appendChild(tag);
    }
    const data = { '@context': 'https://schema.org', '@type': 'Person', name: a.name, url: window.location.href };
    if (a.role) data.jobTitle = a.role;
    if (a.photo) { try { data.image = new URL(a.photo, window.location.href).href; } catch {} }
    if (a.expertiseTags && a.expertiseTags.length) data.knowsAbout = a.expertiseTags;
    tag.textContent = JSON.stringify(data);
  }

  function formatDateChip(dateStr) {
    try {
      const d = new Date(dateStr + 'T00:00:00');
      const dayNames = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
      return { weekday: dayNames[d.getDay()], day: d.getDate(), month: d.toLocaleDateString('tr-TR', { month: 'short' }) };
    } catch { return { weekday: '', day: '', month: '' }; }
  }

  // available_slots: [{date:'2026-08-10', times:[{time:'12:00', available:true}, ...]}] — bkz.
  // migrations/0031_architect_consultant.sql. Placeholder CTA (bkz. kullanıcı isteği: iyzico henüz
  // yok) — bir saat seçilebilir/vurgulanabilir ama hiçbir tıklama gerçek bir istek/mutasyon
  // TETİKLEMEZ, yalnızca #cm-cta-note metni gösterilir.
  function renderSlots(a) {
    const slots = a.availableSlots || [];
    const wrap = document.getElementById('cm-slots-wrap');
    const dateRow = document.getElementById('cm-date-row');
    const timeGrid = document.getElementById('cm-time-grid');
    const ctaBtn = document.getElementById('cm-cta-btn');
    const ctaNote = document.getElementById('cm-cta-note');
    ctaNote.classList.remove('show');

    if (!slots.length) {
      wrap.innerHTML = `<div class="cm-slots-title">Uygun Seanslar</div><div class="cm-empty-slots">Şu anda müsait bir seans saati yok.</div>`;
      return;
    }
    selectedDateIndex = Math.min(selectedDateIndex, slots.length - 1);
    let selectedTime = null;

    function renderTimeGrid() {
      const day = slots[selectedDateIndex];
      timeGrid.innerHTML = (day.times || []).map(t =>
        `<button type="button" class="cm-time-btn${t.time === selectedTime ? ' active' : ''}" data-time="${escapeAttr(t.time)}" ${t.available ? '' : 'disabled'}>${escapeHtml(t.time)}</button>`
      ).join('');
      timeGrid.querySelectorAll('.cm-time-btn:not(:disabled)').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedTime = btn.dataset.time;
          timeGrid.querySelectorAll('.cm-time-btn').forEach(b => b.classList.toggle('active', b === btn));
          const day = slots[selectedDateIndex];
          const { day: dayNum, month } = formatDateChip(day.date);
          ctaBtn.textContent = `${dayNum} ${month}, ${selectedTime} için Seans Satın Al${a.hourlyRate ? ` — ₺${a.hourlyRate}` : ''}`;
        });
      });
    }

    dateRow.innerHTML = slots.map((day, i) => {
      const { weekday, day: dayNum } = formatDateChip(day.date);
      const openCount = (day.times || []).filter(t => t.available).length;
      return `<div class="cm-date-chip${i === selectedDateIndex ? ' active' : ''}" data-index="${i}" title="${openCount} boş slot">${escapeHtml(weekday)}<span class="cm-date-day">${dayNum}</span></div>`;
    }).join('');
    dateRow.querySelectorAll('.cm-date-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        selectedDateIndex = parseInt(chip.dataset.index, 10);
        selectedTime = null;
        dateRow.querySelectorAll('.cm-date-chip').forEach(c => c.classList.toggle('active', c === chip));
        renderTimeGrid();
        ctaBtn.textContent = a.hourlyRate ? `Seans Satın Al — ₺${a.hourlyRate}` : 'Seans Satın Al';
      });
    });
    renderTimeGrid();
    ctaBtn.textContent = a.hourlyRate ? `Seans Satın Al — ₺${a.hourlyRate}` : 'Seans Satın Al';
    ctaBtn.onclick = () => { ctaNote.classList.add('show'); };
  }

  function renderNotFound() {
    document.getElementById('cm-name-text').textContent = 'Danışman bulunamadı';
    const headerActions = ModalShell.getHeaderActionsSlot();
    if (headerActions) headerActions.innerHTML = '';
    ['cm-actions', 'cm-tabs', 'cm-tab-overview', 'cm-booking', 'cm-similar-section', 'cm-detail-info'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  function wireInternalNav() {
    const panels = ModalShell.getPanels();
    if (!panels || panels.bodyEl.dataset.cmNavWired) return;
    panels.bodyEl.dataset.cmNavWired = '1';
    panels.bodyEl.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="/danismanlik/"]');
      if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const m = a.getAttribute('href').match(/^\/danismanlik\/([^/?#]+)/);
      if (!m) return;
      e.preventDefault();
      swap(decodeURIComponent(m[1]));
    });
  }

  async function fetchItem(slug) {
    const res = await fetch(`/api/consultant/${encodeURIComponent(slug)}`);
    if (!res.ok) return null;
    const payload = await res.json();
    if (!payload || !payload.item || payload.hidden) return null;
    return payload;
  }

  async function renderItem(payload) {
    const a = payload.item;
    const office = payload.office;
    const similar = payload.similar || [];
    currentItem = a;
    selectedDateIndex = 0;

    updateHeadMeta(a);
    document.getElementById('cm-name-text').textContent = a.name;
    document.getElementById('cm-category').innerHTML = `<strong>${escapeHtml([a.role, office ? office.name : null].filter(Boolean).join(' · '))}</strong>`;
    const aboutText = a.about || `${a.name} — MİMARLAB'da online mimari danışmanlık/mentörlük hizmeti veriyor.`;
    renderTruncatedDesc('cm-about', aboutText);

    document.getElementById('cm-tags').innerHTML = (a.expertiseTags || []).map(t => `<span class="cm-tag">${escapeHtml(t)}</span>`).join('');

    const insights = [];
    if ((a.sessionsCompleted || 0) > 50) insights.push({ icon: '🏆', title: 'Süper Mentör', desc: 'Yüksek puanlı ve hızlı yanıt veren danışmanlar arasında.' });
    if ((a.sessionsCompleted || 0) > 0) insights.push({ icon: '💬', title: 'İletişimi Güçlü', desc: 'Geçmiş görüşmelerde olumlu geri bildirim aldı.' });
    document.getElementById('cm-insights').innerHTML = insights.map(i =>
      `<div class="cm-insight-card"><span class="cm-insight-icon">${i.icon}</span><div><div class="cm-insight-title">${escapeHtml(i.title)}</div><div class="cm-insight-desc">${escapeHtml(i.desc)}</div></div></div>`
    ).join('');

    const logoEl = document.getElementById('cm-logo');
    logoEl.innerHTML = '';
    logoEl.textContent = initials(a.name);
    logoEl.style.background = officeColor(a.name);
    if (a.photo) {
      const img = document.createElement('img');
      img.src = a.photo;
      img.alt = '';
      img.decoding = 'async';
      img.fetchPriority = 'high';
      img.onerror = () => img.remove();
      logoEl.appendChild(img);
    }

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'save-btn card-save-btn';
    saveBtn.id = 'cm-save-btn';
    saveBtn.setAttribute('aria-label', 'Kaydet');
    saveBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z"/></svg><span class="save-btn-label-default">Kaydet</span><span class="save-btn-label-saved">Kaydedildi</span><span class="save-btn-count" id="cm-save-count"></span>`;
    const actionsEl = document.getElementById('cm-actions');
    actionsEl.innerHTML = '';
    actionsEl.prepend(saveBtn);
    const headerActions = ModalShell.getHeaderActionsSlot();
    if (headerActions) headerActions.innerHTML = '';
    saveBtn.dataset.key = slugify(a.name);
    saveBtn.dataset.title = a.name;
    saveBtn.dataset.meta = office ? office.name : (a.role || '');
    saveBtn.dataset.image = a.photo || '';
    saveBtn.dataset.href = `/danismanlik/${encodeURIComponent(slugify(a.name))}`;
    wireSaveButtons('architect');
    fetch(`/api/public/save-count?type=architect&key=${encodeURIComponent(saveBtn.dataset.key)}`)
      .then(r => r.json())
      .then(data => { const el = document.getElementById('cm-save-count'); if (el) el.textContent = data.count > 0 ? ` (${data.count})` : ''; })
      .catch(() => {});
    if (typeof ShareWidget !== 'undefined') {
      saveBtn.insertAdjacentHTML('afterend', ShareWidget.html('cm-share-btn'));
      ShareWidget.wire('cm-share-btn', () => ({ title: a.name, url: `${window.location.origin}/danismanlik/${encodeURIComponent(slugify(a.name))}` }));
    }

    renderStructuredData(a);

    document.getElementById('cm-stat-minutes').textContent = (a.totalMinutes || 0).toLocaleString('tr-TR');
    document.getElementById('cm-stat-sessions').textContent = (a.sessionsCompleted || 0).toLocaleString('tr-TR');
    renderSlots(a);

    document.getElementById('cm-similar-section').style.display = similar.length ? '' : 'none';
    document.getElementById('cm-similar-grid').innerHTML = similar.map(c =>
      cardHtml(`/danismanlik/${encodeURIComponent(slugify(c.name))}`, c.name, c.photo, c.hourlyRate ? `${c.sessionDurationMin || 45} Dk / ₺${c.hourlyRate}` : '', verifiedBadgeHtml('architect', c.name, c.badges, 14))
    ).join('');

    function renderVerifiedBadges() {
      document.getElementById('cm-verified-badge-wrap').innerHTML = verifiedBadgeHtml('architect', a.name, a.badges, 20);
    }
    renderVerifiedBadges();
    window.addEventListener('mimarlab-badges-ready', renderVerifiedBadges, { once: true });

    await savedWidgetReady;
    wireInternalNav();
    ModalShell.scrollToTop();
  }

  async function open(slug, { pushHistory = true, triggerEl = null } = {}) {
    currentSlug = slug;
    openedViaPush = pushHistory;
    pushCountSinceOpen = pushHistory ? 1 : 0;
    if (pushHistory) history.pushState({ mimarlabModal: 'consultant', slug, depth: 1 }, '', `/danismanlik/${encodeURIComponent(slug)}`);
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
    const currentDepth = (history.state && history.state.mimarlabModal === 'consultant') ? history.state.depth : pushCountSinceOpen;
    pushCountSinceOpen = currentDepth + 1;
    history.pushState({ mimarlabModal: 'consultant', slug, depth: pushCountSinceOpen }, '', `/danismanlik/${encodeURIComponent(slug)}`);
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
    else history.pushState({}, '', '/danismanlik');
    ModalShell.close();
    pushCountSinceOpen = 0;
  }

  function handlePopState(slug) {
    if (!slug) { if (ModalShell.isOpen()) { currentSlug = null; currentItem = null; ModalShell.close(); } return; }
    if (!ModalShell.isOpen()) { openedViaPush = false; open(slug, { pushHistory: false }); return; }
    if (history.state && history.state.mimarlabModal === 'consultant' && typeof history.state.depth === 'number') {
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
