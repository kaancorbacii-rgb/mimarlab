// Site genelinde üst menü (nav) ve alt menü (footer) artık TEK kaynaktan üretilir. Önceden her sayfa
// bu markup'ın kendi kopyasını tutuyordu ve zamanla birbirinden sapıyordu — ör. proje-ekle.html,
// mimar-ekle.html, firma-ekle.html gibi sayfalarda "Ürün" açılır menüsü (mega-menu) hiç eklenmemişti,
// bu yüzden o sayfalarda Ürün'ün yanındaki çentik/ok görünmüyordu (bkz. kullanıcı isteği: "üst ve alt
// menüde yapılan değişikliklerin sitedeki tüm sayfalarda eş zamanlı güncellenmesi gerekiyor").
//
// Bu dosya senkron (defer'sız) yüklenir ve header mount noktasının HEMEN ardından çağrılır, çünkü bazı
// sayfalar (ör. urun.html) kendi satır-içi <script>'inde nav elemanlarına (urun-menu-trigger vb.)
// sayfa ayrıştırılırken (deferred script'ler çalışmadan ÖNCE) erişiyor. Footer ise DOMContentLoaded'da
// mount edilir — hiçbir script footer elemanlarına erken erişmiyor.
(function(){
  function escapeHtml(s){ const d = document.createElement('div'); d.textContent = s === undefined || s === null ? '' : s; return d.innerHTML; }
  function escapeAttr(s){ return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  const NAV_ITEMS = [
    { key: 'proje', href: 'proje.html', label: 'Proje' },
    { key: 'urun', href: 'urun.html', label: 'Ürün', mega: true },
    { key: 'mimar', href: 'mimar.html', label: 'Mimar' },
    { key: 'firma', href: 'firma.html', label: 'Firma' },
  ];

  function headerHtml(active){
    const desktopLinks = NAV_ITEMS.map(item => {
      const activeClass = item.key === active ? ' active' : '';
      if(item.mega){
        return `<div class="nav-link-wrap" id="urun-menu-wrap">
        <button class="nav-link nav-link-trigger${activeClass}" id="urun-menu-trigger" type="button" aria-expanded="false" aria-controls="urun-mega-menu">
          ${escapeHtml(item.label)}
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 1l4 4 4-4"/></svg>
        </button>
      </div>`;
      }
      return `<a class="nav-link${activeClass}" href="${escapeAttr(item.href)}">${escapeHtml(item.label)}</a>`;
    }).join('\n      ');

    const mobileLinks = NAV_ITEMS.map(item => {
      const activeClass = item.key === active ? ' active' : '';
      if(item.mega){
        return `<div class="nav-mobile-accordion">
        <button type="button" class="nav-mobile-link nav-mobile-accordion-trigger${activeClass}" id="urun-mobile-trigger" aria-expanded="false" aria-controls="urun-mobile-panel">
          ${escapeHtml(item.label)}
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 1l4 4 4-4"/></svg>
        </button>
        <div class="nav-mobile-accordion-panel" id="urun-mobile-panel"></div>
      </div>`;
      }
      return `<a class="nav-mobile-link${activeClass}" href="${escapeAttr(item.href)}">${escapeHtml(item.label)}</a>`;
    }).join('\n      ');

    return `<nav class="nav">
    <a class="brand" href="index.html">
      <img class="brand-logo" src="logos/site/mimarlab-logo.png" alt="MimarLab">
    </a>
    <div class="nav-search">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" id="f-search-topnav" placeholder="Ara..." aria-label="Ara">
    </div>
    <div class="nav-links">
      ${desktopLinks}
    </div>
    <div class="mega-menu" id="urun-mega-menu"></div>
    <div class="nav-right">
      <a class="nav-rate" href="giris-yap.html">Giriş Yap</a>
    </div>
    <button class="nav-hamburger" id="nav-hamburger" aria-label="Menü">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
    </button>
    <div class="nav-mobile-menu" id="nav-mobile-menu">
      <div class="nav-mobile-search">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="f-search-nav" placeholder="Ara..." aria-label="Ara">
      </div>
      ${mobileLinks}
    </div>
  </nav>`;
  }

  function footerHtml(){
    return `<footer class="site-footer">
    <div class="footer-top">
      <div class="footer-brand">
        <a class="footer-logo" href="index.html">
          <img class="footer-logo-img" src="logos/site/mimarlab-logo-footer.png" alt="MimarLab" loading="lazy" decoding="async">
        </a>
        <p>Mimarlık, iç mimarlık, peyzaj mimarlığı disiplinlerini ve çeşitli firmaları bir araya getiren mimar platformu.</p>
        <div class="footer-social">
          <a href="https://www.instagram.com/mimarlabcom/" target="_blank" rel="noopener" aria-label="Instagram"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/></svg></a>
          <a href="https://x.com/mimarlabcom?s=11&amp;t=ijRg66Se2p_FxlB3-aK-6w" target="_blank" rel="noopener" aria-label="X"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.3 2H21l-7.3 8.3L22.2 22h-6.8l-5.3-6.9L4 22H1.3l7.8-8.9L1.5 2h6.9l4.8 6.3L18.3 2z"/></svg></a>
          <a href="https://www.linkedin.com/company/mimarlab/" target="_blank" rel="noopener" aria-label="LinkedIn"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M4.5 3.5A2 2 0 1 0 4.5 7.5 2 2 0 0 0 4.5 3.5zM3 9h3v12H3zM10 9h2.9v1.6h.1c.4-.8 1.5-1.6 3-1.6 3.2 0 3.8 2.1 3.8 4.9V21h-3v-6.6c0-1.6 0-3.6-2.2-3.6s-2.5 1.7-2.5 3.5V21H10z"/></svg></a>
        </div>
      </div>
      <div class="footer-col"><h4>Ana Menü</h4><a href="proje.html">Proje</a><a href="urun.html">Ürün</a><a href="mimar.html">Mimar</a><a href="firma.html">Firma</a></div>
      <div class="footer-col"><h4>Topluluk</h4><a href="giris-yap.html">Giriş Yap</a><a href="uye-ol.html">Üye Ol</a><a href="satin-al.html">Rozet Al</a><a href="iade-et.html">İade Et</a></div>
      <div class="footer-col"><h4>Kurumsal</h4><a href="hakkinda.html">Hakkında</a><a href="iletisim.html">İletişim</a><a href="gizlilik-politikasi.html">Gizlilik Politikası</a><a href="hizmet-sartlari.html">Hizmet Şartları</a></div>
    </div>
    <div class="footer-bottom">© Tüm hakları saklıdır. MİMARLAB, 2024-2026<br>Sitede yer alan tüm görseller ilgili kişi veya firmaya aittir.</div>
  </footer>`;
  }

  function wireNavSearch(){
    function navSuggestEsc(s){ const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
    function navSuggestEscAttr(s){ return navSuggestEsc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

    if(!document.getElementById('nav-search-suggest-style')){
      const style = document.createElement('style');
      style.id = 'nav-search-suggest-style';
      style.textContent = `
        .nav-search, .nav-mobile-search{position:relative;}
        .nav-search-suggest{display:none; position:absolute; top:calc(100% + 8px); left:0; right:0; z-index:120; background:var(--paper-card); border:1px solid var(--line); border-radius:12px; box-shadow:0 12px 28px rgba(27,42,61,0.15); overflow:hidden;}
        .nav-search-suggest.open{display:block;}
        .nav-search-suggest-row{display:flex; align-items:center; gap:10px; padding:10px 14px; font-size:13px; color:var(--ink); border-bottom:1px solid var(--line-soft);}
        .nav-search-suggest-row:hover{background:var(--paper-alt);}
        .nav-search-suggest-row:last-child{border-bottom:none;}
        .nav-search-suggest-tag{flex-shrink:0; font-family:'IBM Plex Mono', monospace; font-size:10px; text-transform:uppercase; letter-spacing:0.04em; color:var(--ink-soft); background:var(--paper-alt); border-radius:100px; padding:2px 8px;}
        .nav-search-suggest-title{flex:1; min-width:0; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
        .nav-search-suggest-meta{flex-shrink:0; font-size:11.5px; color:var(--ink-soft); max-width:120px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
        .nav-search-suggest-more{display:block; padding:10px 14px; font-size:12.5px; font-weight:600; color:var(--brass); text-align:center;}
        .nav-search-suggest-empty{padding:14px; font-size:12.5px; color:var(--ink-soft); text-align:center;}
      `;
      document.head.appendChild(style);
    }

    document.querySelectorAll('.nav-search, .nav-mobile-search').forEach(wrap=>{
      const inp = wrap.querySelector('input');
      if(!inp || inp.dataset.navSuggestWired) return;
      inp.dataset.navSuggestWired = '1';

      const panel = document.createElement('div');
      panel.className = 'nav-search-suggest';
      wrap.appendChild(panel);

      let debounceTimer = null;
      let currentQuery = '';

      function closePanel(){ panel.classList.remove('open'); }

      function renderPanel(query, data){
        const items = (data && data.items) || [];
        if(!items.length){
          panel.innerHTML = `<div class="nav-search-suggest-empty">"${navSuggestEsc(query)}" için öneri bulunamadı.</div>`;
          panel.classList.add('open');
          return;
        }
        const rows = items.map(it => `<a class="nav-search-suggest-row" href="${navSuggestEscAttr(it.href)}">
            <span class="nav-search-suggest-tag">${navSuggestEsc(it.label)}</span>
            <span class="nav-search-suggest-title">${navSuggestEsc(it.title)}</span>
            <span class="nav-search-suggest-meta">${navSuggestEsc(it.meta || '')}</span>
          </a>`).join('');
        const moreHref = 'arama.html?q=' + encodeURIComponent(query);
        panel.innerHTML = rows + `<a class="nav-search-suggest-more" href="${navSuggestEscAttr(moreHref)}">"${navSuggestEsc(query)}" için tüm sonuçları gör (${data.total})</a>`;
        panel.classList.add('open');
      }

      inp.addEventListener('input', ()=>{
        const query = inp.value.trim();
        clearTimeout(debounceTimer);
        if(query.length < 2){ closePanel(); return; }
        debounceTimer = setTimeout(()=>{
          currentQuery = query;
          fetch('/api/public/search-suggest?q=' + encodeURIComponent(query))
            .then(res => res.ok ? res.json() : {items:[], total:0})
            .then(data => { if(inp.value.trim() === currentQuery) renderPanel(currentQuery, data); })
            .catch(()=>{});
        }, 200);
      });

      inp.addEventListener('keydown', (e)=>{
        if(e.key === 'Enter' && e.target.value.trim()){
          window.location.href = 'arama.html?q=' + encodeURIComponent(e.target.value.trim());
        } else if(e.key === 'Escape'){
          closePanel();
        }
      });

      inp.addEventListener('focus', ()=>{
        if(inp.value.trim().length >= 2 && panel.innerHTML) panel.classList.add('open');
      });

      document.addEventListener('click', (e)=>{
        if(!wrap.contains(e.target)) closePanel();
      });
    });
  }
  window.wireNavSearch = wireNavSearch;

  function wireHamburger(){
    const navHamburger = document.getElementById('nav-hamburger');
    const navMobileMenu = document.getElementById('nav-mobile-menu');
    if(!navHamburger || !navMobileMenu) return;
    navHamburger.addEventListener('click', ()=>{ navMobileMenu.classList.toggle('open'); });
    document.addEventListener('click', (e)=>{
      if(!navMobileMenu.classList.contains('open')) return;
      if(!navHamburger.contains(e.target) && !navMobileMenu.contains(e.target)) navMobileMenu.classList.remove('open');
    });
  }

  const headerMount = document.getElementById('site-header-mount');
  if(headerMount){
    const active = headerMount.getAttribute('data-nav-active') || '';
    headerMount.outerHTML = headerHtml(active);
  }
  wireHamburger();
  wireNavSearch();

  function mountFooter(){
    const footerMount = document.getElementById('site-footer-mount');
    if(footerMount) footerMount.outerHTML = footerHtml();
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', mountFooter);
  } else {
    mountFooter();
  }
})();
