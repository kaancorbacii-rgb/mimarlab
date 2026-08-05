// Paylaşılan, içerikten bağımsız modal "çerçevesi": overlay + panel DOM'u, role="dialog"/
// aria-modal, klavye focus trap'i, arka plan scroll kilidi (+ tam piksel konumuna geri dönüş),
// Escape/backdrop tıklaması ile kapatma isteği. Proje modalı (bkz. js/components/project-modal.js)
// bunun üzerine kurulur; ileride Ürün/Mimar/Firma detay modalları da AYNI çerçeveyi kullanabilsin
// diye bu dosya projelere özgü hiçbir şey bilmez — save-widget.js/rating-widget.js ile aynı desen,
// her sayfada <script src="js/components/modal-shell.js"> ile dahil edilir ve global `ModalShell`
// nesnesini dışa verir.
const ModalShell = (function () {
  let overlayEl = null;
  let panelEl = null;
  let bodyEl = null;
  let closeButtonEl = null;
  let triggerEl = null;
  let onRequestClose = null;
  let savedScrollY = 0;
  let opened = false;

  function injectStyles() {
    if (document.getElementById('modal-shell-styles')) return;
    const style = document.createElement('style');
    style.id = 'modal-shell-styles';
    // CSS özel değişkenleri (--ink, --paper-card, --line vb.) her sayfanın kendi :root'unda zaten
    // tanımlı (bkz. proje.html) — burada yeniden tanımlamaya gerek yok, cascade zaten çözer.
    style.textContent = `
      .modal-shell-overlay{
        display:none; position:fixed; inset:0; z-index:150;
        background:rgba(27,42,61,0.42); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
        align-items:center; justify-content:center; padding:clamp(10px, 3vw, 32px);
      }
      .modal-shell-overlay.open{display:flex;}
      .modal-shell-panel{
        position:relative; width:95vw; height:92vh; max-width:1440px;
        background:var(--paper-card); border-radius:20px; box-shadow:0 24px 60px rgba(27,42,61,0.28);
        overflow:hidden; display:flex; flex-direction:column;
      }
      .modal-shell-close{
        position:absolute; top:16px; left:32px; z-index:5;
        width:36px; height:36px; border-radius:50%; border:none;
        background:var(--paper-card); color:var(--ink); box-shadow:0 4px 12px rgba(27,42,61,0.18);
        display:flex; align-items:center; justify-content:center;
      }
      .modal-shell-close:hover{background:var(--paper-alt);}
      .modal-shell-body{
        flex:1; min-height:0; overflow-y:auto;
        display:grid; grid-template-columns:32% 68%;
      }
      .modal-shell-left{
        position:sticky; top:0; align-self:start;
        padding:64px 32px 32px; border-right:1px solid var(--line-soft);
      }
      .modal-shell-right{padding:32px 32px 48px; min-width:0;}
      @media (max-width:860px){
        /* Panel kenarlarda hala %92-95 genişlik/yükseklik bırakır (bkz. kullanıcı isteği: mobil/
           tablette de blurlu overlay alanı görünsün, panel ekranın kenarlarına yapışmasın) — eski
           tam ekran (100vw/100vh, radius:0, padding:0) geçersiz kılması KALDIRILDI, üstteki temel
           kurallar (width:95vw; height:92vh; border-radius:20px) tüm kırılma noktalarında geçerli.
        */
        .modal-shell-panel{border-radius:16px;}
        .modal-shell-body{grid-template-columns:1fr; display:flex; flex-direction:column; padding:0 18px 28px;}
        /* display:contents: sol/sağ panel kapsayıcıları kendi kutularını üretmez, çocukları
           doğrudan .modal-shell-body'nin flex bağlamına katılır — böylece proje.html'in kendi CSS'i
           (bkz. #pm-* id'lerine order ataması) galeri/başlık/aksiyon/künye/yorum/carousel'leri TEK
           bir dikey akışta istenen sırayla (galeri en üstte) yeniden dizebilir; iki panel artık
           birbirinden bağımsız iki blok olarak DEĞİL, tek bir listenin parçaları olarak davranır. */
        .modal-shell-left, .modal-shell-right{display:contents;}
      }
    `;
    document.head.appendChild(style);
  }

  function ensureDom() {
    if (overlayEl) return;
    injectStyles();
    overlayEl = document.createElement('div');
    overlayEl.id = 'modal-shell-overlay';
    overlayEl.className = 'modal-shell-overlay';
    overlayEl.innerHTML = `
      <div class="modal-shell-panel" role="dialog" aria-modal="true" tabindex="-1">
        <button type="button" class="modal-shell-close" aria-label="Kapat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div class="modal-shell-body">
          <div class="modal-shell-left"></div>
          <div class="modal-shell-right"></div>
        </div>
      </div>`;
    document.body.appendChild(overlayEl);
    panelEl = overlayEl.querySelector('.modal-shell-panel');
    bodyEl = overlayEl.querySelector('.modal-shell-body');
    closeButtonEl = overlayEl.querySelector('.modal-shell-close');

    overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) requestClose(); });
    closeButtonEl.addEventListener('click', () => requestClose());
    document.addEventListener('keydown', onKeydown);
  }

  function requestClose() {
    if (onRequestClose) onRequestClose();
  }

  function getFocusable() {
    return Array.from(panelEl.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(el => el.offsetParent !== null);
  }

  function onKeydown(e) {
    if (!opened) return;
    if (e.key === 'Escape') { e.stopPropagation(); requestClose(); return; }
    if (e.key !== 'Tab') return;
    const focusable = getFocusable();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function lockBodyScroll() {
    savedScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
  }

  function unlockBodyScroll() {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    window.scrollTo(0, savedScrollY);
  }

  // opts.onRequestClose: backdrop/X/Escape tetiklendiğinde çağrılır — DOM'u KENDİSİ kapatmaz,
  // kapatma isteğini çağırana (bkz. ProjectModal.close, önce history/route kararını verir) devreder.
  // Gerçek DOM/scroll/focus temizliği yalnızca close() açıkça çağrıldığında olur.
  function open({ triggerEl: trigger = null, onRequestClose: onClose } = {}) {
    ensureDom();
    triggerEl = trigger;
    onRequestClose = onClose || null;
    if (!opened) {
      lockBodyScroll();
      overlayEl.classList.add('open');
      opened = true;
    }
    closeButtonEl.focus();
    return { leftPanelEl: overlayEl.querySelector('.modal-shell-left'), rightPanelEl: overlayEl.querySelector('.modal-shell-right'), bodyEl, panelEl };
  }

  function close() {
    if (!opened) return;
    opened = false;
    overlayEl.classList.remove('open');
    unlockBodyScroll();
    if (triggerEl && document.contains(triggerEl)) triggerEl.focus();
    triggerEl = null;
    onRequestClose = null;
  }

  function isOpen() { return opened; }

  function getPanels() {
    if (!overlayEl) return null;
    return { leftPanelEl: overlayEl.querySelector('.modal-shell-left'), rightPanelEl: overlayEl.querySelector('.modal-shell-right'), bodyEl, panelEl };
  }

  function scrollToTop() { if (bodyEl) bodyEl.scrollTop = 0; }

  return { open, close, isOpen, getPanels, scrollToTop };
})();
