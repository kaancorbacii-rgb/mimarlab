// Ana nav'daki "Ürün" öğesini urun.html'deki Architonic tarzı çekmece mega menüyle AYNI görünümde
// çalıştırır (bkz. kullanıcı isteği: menü tasarımı her sayfada aynı/çekmeceli kalsın). Bu sayfalarda
// urun.html'in SPA durumu yok, o yüzden linkler normal tam sayfa gezintisiyle urun.html?group=...
// &category=...'a gider — "Tümünü Gör" ise filtresiz urun.html'e (bkz. footer linkleriyle AYNI davranış).
(function(){
  function escapeHtml(s){ const d = document.createElement('div'); d.textContent = s === undefined || s === null ? '' : s; return d.innerHTML; }
  function escapeAttr(s){ return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function groupHref(group){ return `/urun?group=${encodeURIComponent(group)}`; }
  function categoryHref(group, category){ return `/urun?group=${encodeURIComponent(group)}&category=${encodeURIComponent(category)}`; }

  function injectStyleOnce(){
    if(document.getElementById('nav-product-menu-style')) return;
    const style = document.createElement('style');
    style.id = 'nav-product-menu-style';
    style.textContent = `
      .nav-link-wrap{position:relative;}
      .nav-link-trigger{display:flex; align-items:center; gap:5px; cursor:pointer; background:none; border:none; padding:0; margin:0;}
      .nav-link-trigger svg{transition:transform .15s ease;}
      .nav-link-trigger[aria-expanded="true"] svg{transform:rotate(180deg);}
      .mega-menu{display:none; position:absolute; top:calc(100% + 14px); left:50%; transform:translateX(-50%); z-index:90; width:min(96vw, 1160px); background:var(--paper-card); border:1px solid var(--line); border-radius:16px; box-shadow:0 18px 40px rgba(27,42,61,0.18); padding:26px 30px;}
      .mega-menu.open{display:block;}
      .mega-menu-cols{display:grid; grid-template-columns:repeat(5, 1fr); gap:24px;}
      .mega-col{display:flex; flex-direction:column; gap:20px; min-width:0;}
      .mega-group-title{display:block; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:14.5px; font-weight:700; color:var(--ink); margin-bottom:8px;}
      .mega-group-title:hover{color:var(--walnut);}
      .mega-cat-link{display:block; font-size:13.5px; color:var(--ink-soft); padding:4px 0;}
      .mega-cat-link:hover{color:var(--ink); text-decoration:underline;}
      .mega-menu-footer{margin-top:22px; padding-top:18px; border-top:1px solid var(--line); text-align:right;}
      .mega-viewall{display:inline-flex; align-items:center; gap:7px; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:21px; font-weight:600; color:var(--ink);}
      .mega-viewall:hover{color:var(--walnut);}
      @media (max-width:960px){ .mega-menu{display:none !important;} }
      .nav-mobile-accordion{display:flex; flex-direction:column;}
      .nav-mobile-accordion-trigger{display:flex; align-items:center; justify-content:space-between; width:100%; background:none; border:none;}
      .nav-mobile-accordion-trigger svg{transition:transform .15s ease;}
      .nav-mobile-accordion-trigger[aria-expanded="true"] svg{transform:rotate(180deg);}
      .nav-mobile-accordion-panel{display:none; flex-direction:column; padding:2px 0 8px 12px;}
      .nav-mobile-accordion-panel.open{display:flex;}
      .nav-mobile-subgroup{display:flex; flex-direction:column;}
      .nav-mobile-subtrigger{display:flex; align-items:center; justify-content:space-between; width:100%; min-height:44px; padding:9px 12px; border-radius:8px; font-size:13.5px; font-weight:600; color:var(--ink); background:none; border:none; font-family:inherit; cursor:pointer; text-transform:none; box-sizing:border-box;}
      .nav-mobile-subtrigger:hover{background:var(--paper-alt);}
      .nav-mobile-subtrigger svg{transition:transform .15s ease; flex-shrink:0;}
      .nav-mobile-subtrigger[aria-expanded="true"] svg{transform:rotate(180deg);}
      .nav-mobile-subpanel{display:none; flex-direction:column; padding:0 0 4px 14px;}
      .nav-mobile-subpanel.open{display:flex;}
      /* min-height:44px — denetim bulgusu (2026-08-14): mobil menüdeki bu dokunma hedefleri
         önceden ~32px yüksekliğindeydi (44x44px dokunma hedefi rehberinin altında); align-items
         center ile dikey ortalama korunuyor, padding aynı kalıyor. */
      .nav-mobile-subcat{display:flex; align-items:center; min-height:44px; padding:8px 12px; border-radius:8px; font-size:13px; color:var(--ink-soft); text-transform:none; box-sizing:border-box;}
      .nav-mobile-subcat:hover{background:var(--paper-alt); color:var(--ink);}
      .nav-mobile-viewall{display:flex; align-items:center; min-height:44px; padding:10px 12px; margin-top:2px; border-radius:8px; font-size:13.5px; font-weight:700; color:var(--walnut); text-transform:none; box-sizing:border-box;}
      .nav-mobile-viewall:hover{background:var(--paper-alt);}
    `;
    document.head.appendChild(style);
  }

  function megaMenuHtml(){
    const cols = CATALOG_MENU_COLUMNS.map(colGroups => `
      <div class="mega-col">
        ${colGroups.map(group => {
          const cats = CATALOG_TAXONOMY[group] || [];
          return `<div class="mega-group">
            <a class="mega-group-title" href="${escapeAttr(groupHref(group))}">${escapeHtml(group)}</a>
            ${cats.map(cat => `<a class="mega-cat-link" href="${escapeAttr(categoryHref(group, cat))}">${escapeHtml(cat)}</a>`).join('')}
          </div>`;
        }).join('')}
      </div>`).join('');
    return `<div class="mega-menu-cols">${cols}</div>
      <div class="mega-menu-footer"><a class="mega-viewall" href="/urun">Tümünü Gör →</a></div>`;
  }

  function mobilePanelHtml(){
    const groups = CATALOG_MENU_COLUMNS.flat().map((group, i) => {
      const cats = CATALOG_TAXONOMY[group] || [];
      const gid = `urun-mobile-sub-${i}`;
      return `<div class="nav-mobile-subgroup">
        <button type="button" class="nav-mobile-subtrigger" data-target="${gid}" aria-expanded="false" aria-controls="${gid}">
          ${escapeHtml(group)}
          <svg width="9" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 1l4 4 4-4"/></svg>
        </button>
        <div class="nav-mobile-subpanel" id="${gid}">
          <a class="nav-mobile-subcat" href="${escapeAttr(groupHref(group))}">Tümü — ${escapeHtml(group)}</a>
          ${cats.map(cat => `<a class="nav-mobile-subcat" href="${escapeAttr(categoryHref(group, cat))}">${escapeHtml(cat)}</a>`).join('')}
        </div>
      </div>`;
    }).join('');
    return groups + `<a class="nav-mobile-viewall" href="/urun">Tümünü Gör</a>`;
  }

  function init(){
    if(typeof CATALOG_MENU_COLUMNS === 'undefined' || typeof CATALOG_TAXONOMY === 'undefined') return;
    const trigger = document.getElementById('urun-menu-trigger');
    const wrap = document.getElementById('urun-menu-wrap');
    const panel = document.getElementById('urun-mega-menu');
    const mobileTrigger = document.getElementById('urun-mobile-trigger');
    const mobilePanel = document.getElementById('urun-mobile-panel');
    if(!trigger && !mobileTrigger) return;
    injectStyleOnce();

    if(trigger && wrap && panel){
      let built = false;
      const closeMenu = () => {
        panel.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
      };
      trigger.addEventListener('click', (e)=>{
        e.stopPropagation();
        if(!built){ panel.innerHTML = megaMenuHtml(); built = true; }
        const willOpen = !panel.classList.contains('open');
        panel.classList.toggle('open', willOpen);
        trigger.setAttribute('aria-expanded', String(willOpen));
      });
      document.addEventListener('click', (e)=>{
        if(!wrap.contains(e.target) && !panel.contains(e.target)) closeMenu();
      });
      document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') closeMenu(); });
    }

    if(mobileTrigger && mobilePanel){
      let mobileBuilt = false;
      mobileTrigger.addEventListener('click', ()=>{
        if(!mobileBuilt){
          mobilePanel.innerHTML = mobilePanelHtml();
          mobileBuilt = true;
          mobilePanel.querySelectorAll('.nav-mobile-subtrigger').forEach(btn=>{
            btn.addEventListener('click', ()=>{
              const sub = document.getElementById(btn.dataset.target);
              const willOpen = !sub.classList.contains('open');
              mobilePanel.querySelectorAll('.nav-mobile-subpanel.open').forEach(p=>{ if(p!==sub) p.classList.remove('open'); });
              mobilePanel.querySelectorAll('.nav-mobile-subtrigger[aria-expanded="true"]').forEach(b=>{ if(b!==btn) b.setAttribute('aria-expanded','false'); });
              sub.classList.toggle('open', willOpen);
              btn.setAttribute('aria-expanded', String(willOpen));
            });
          });
        }
        const willOpen = !mobilePanel.classList.contains('open');
        mobilePanel.classList.toggle('open', willOpen);
        mobileTrigger.setAttribute('aria-expanded', String(willOpen));
      });
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
