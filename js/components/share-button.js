// ShareWidget — pop-up modallarda Kaydet butonunun yanına eklenen "Paylaş" butonu (bkz. kullanıcı
// isteği: font/boyut/yükseklik Kaydet ile birebir aynı pil olsun). Mobilde/destekleyen tarayıcılarda
// navigator.share() (Web Share API) açar; masaüstünde bağlantıyı panoya kopyalama + sosyal medya
// (WhatsApp/X/LinkedIn) seçeneklerini içeren küçük bir popover açar. save-widget.js/rating-widget.js
// ile AYNI desen — modal-shell.js gibi içerikten bağımsız, her sayfada
// <script src="js/components/share-button.js"> ile dahil edilir, global `ShareWidget` nesnesini
// dışa verir.
const ShareWidget = (function () {
  function injectStyles() {
    if (document.getElementById('share-widget-styles')) return;
    const style = document.createElement('style');
    style.id = 'share-widget-styles';
    // .share-btn kutu modeli (height/padding/font/gap) .save-btn ile BİREBİR aynı (bkz. proje.html/
    // js/components/architect-modal.js/office-modal.js/product-modal.js#injectStyles'daki .save-btn) —
    // bu dosya her sayfada .save-btn'DEN SONRA yüklendiğinden burada tekrar tanımlanır, cascade'e
    // güvenmek (sayfalar arası enjeksiyon sırası garanti değil) yerine aynı değerler kopyalanır.
    style.textContent = `
      .share-widget{position:relative; display:inline-flex; flex-shrink:1; min-width:0;}
      .share-btn{
        display:inline-flex; align-items:center; gap:5px;
        flex-shrink:1 !important; min-width:0 !important; white-space:nowrap !important; overflow:hidden !important; text-overflow:ellipsis;
        height:32px !important; box-sizing:border-box;
        background:var(--paper-card); border:1px solid var(--line); border-radius:100px;
        padding:0 8px !important; font-size:12px !important; font-weight:600; color:var(--ink-soft);
        font-family:inherit; line-height:1;
      }
      .share-btn:hover{border-color:var(--walnut); color:var(--ink);}
      .share-btn svg{flex-shrink:0;}
      .share-popover{
        display:none; position:absolute; top:calc(100% + 8px); left:0; z-index:20; min-width:216px;
        background:var(--paper-card); border:1px solid var(--line); border-radius:14px;
        box-shadow:0 12px 28px rgba(27,42,61,0.18); padding:6px; flex-direction:column; gap:2px;
      }
      .share-popover.open{display:flex;}
      .share-popover-item{
        display:flex; align-items:center; gap:10px; padding:9px 12px; border-radius:9px;
        font-size:13px; font-weight:600; color:var(--ink); background:none; border:none;
        font-family:inherit; text-align:left; width:100%; box-sizing:border-box; cursor:pointer;
      }
      .share-popover-item:hover{background:var(--paper-alt);}
      .share-popover-item svg{flex-shrink:0; color:var(--ink-soft);}
      .share-toast{
        position:absolute; top:calc(100% + 8px); left:0; z-index:21; white-space:nowrap;
        background:var(--ink); color:var(--paper-card); font-size:12.5px; font-weight:600;
        padding:8px 14px; border-radius:100px; box-shadow:0 8px 20px rgba(27,42,61,0.2);
      }
      /* Puanla/Kaydet/Paylaş(/Websitesi) — Apple/Google dokunma hedefi standartları (bkz. kullanıcı
         isteği): pil yüksekliği en az 48px, tıklanabilir alan en az 44x44px. Bu kural yalnızca
         mimar.html/firma.html modalleri (architect-modal.js/office-modal.js) için geçerlidir — proje.
         html/product-modal.js kendi .pm-rating-save-row/.pr-rating-save-row .share-btn scoped
         override'larını taşıdığından (bkz. o dosyalardaki AYNI kırılma noktası) burayı geçersiz kılar. */
      @media (max-width:860px){
        .share-popover{left:auto; right:0;}
        .share-btn{height:48px !important; min-height:48px !important; padding:0 14px !important; font-size:13.5px !important;}
        /* gerçek bulgu: Düzenle/Arşivle/Sil gibi admin butonlarıyla AYNI satırı paylaşan sayfalarda
           (bkz. office-modal.js#injectStyles — Websitesi/Kaydet/Paylaş/Düzenle/Arşivle/Sil altı pil
           tek satırda) hepsi flex-shrink:1 miras aldığından satır sıkışınca Paylaş de 44px dokunma
           hedefinin ALTINA küçülüyordu — .share-widget (asıl flex ÖĞESİ, .share-btn'i SARAN <span>)
           burada flex-shrink:0 ile sabit tutulur, admin butonları (bu kırılma noktasında hâlâ
           flex-shrink:1) ellipsis ile daha fazla daralarak farkı absorbe eder. */
        .share-widget{flex-shrink:0 !important; min-width:44px !important;}
      }
      /* Çok dar ekranlarda (bkz. kullanıcı isteği: satır hiçbir genişlikte 2. satıra düşmemeli)
         .share-text gizlenip buton ikona daralır — yükseklik/dolgu 48px'lik dokunma hedefini korur,
         yalnızca metin kaldırılır. */
      @media (max-width:400px){
        .share-text{display:none !important;}
        .share-btn{padding:0 !important; width:48px !important; min-width:44px !important; flex-shrink:0 !important; justify-content:center;}
      }
    `;
    document.head.appendChild(style);
  }

  const ICON_SHARE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.6" x2="15.4" y2="6.4"/><line x1="8.6" y1="13.4" x2="15.4" y2="17.6"/></svg>`;
  const ICON_COPY = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  const ICON_WHATSAPP = `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.8.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5C10 9 9.5 7.8 9.3 7.3c-.2-.5-.4-.4-.5-.4h-.5c-.2 0-.5.1-.7.3-.2.3-1 1-1 2.3s1 2.7 1.1 2.9c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.7-.7 1.9-1.3.2-.7.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3z"/><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z"/></svg>`;
  const ICON_X = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.3 2H21l-7.3 8.3L22.2 22h-6.8l-5.3-6.9L4 22H1.3l7.8-8.9L1.5 2h6.9l4.8 6.3L18.3 2z"/></svg>`;
  const ICON_LINKEDIN = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M4.5 3.5A2 2 0 1 0 4.5 7.5 2 2 0 0 0 4.5 3.5zM3 9h3v12H3zM10 9h2.9v1.6h.1c.4-.8 1.5-1.6 3-1.6 3.2 0 3.8 2.1 3.8 4.9V21h-3v-6.6c0-1.6 0-3.6-2.2-3.6s-2.5 1.7-2.5 3.5V21H10z"/></svg>`;

  function html(id) {
    return `
      <span class="share-widget">
        <button class="share-btn" type="button" id="${id}" aria-haspopup="true" aria-expanded="false">
          ${ICON_SHARE}<span class="share-text">Paylaş</span>
        </button>
        <div class="share-popover" id="${id}-popover">
          <button type="button" class="share-popover-item" data-action="copy">${ICON_COPY}Bağlantıyı Kopyala</button>
          <a class="share-popover-item" target="_blank" rel="noopener" data-action="whatsapp">${ICON_WHATSAPP}WhatsApp'ta Paylaş</a>
          <a class="share-popover-item" target="_blank" rel="noopener" data-action="x">${ICON_X}X'te Paylaş</a>
          <a class="share-popover-item" target="_blank" rel="noopener" data-action="linkedin">${ICON_LINKEDIN}LinkedIn'de Paylaş</a>
        </div>
      </span>`;
  }

  function closeAllPopovers() {
    document.querySelectorAll('.share-popover.open').forEach(p => p.classList.remove('open'));
  }

  function showToast(btn, text) {
    const host = btn.parentElement;
    const existing = host.querySelector('.share-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'share-toast';
    toast.textContent = text;
    host.appendChild(toast);
    setTimeout(() => toast.remove(), 1800);
  }

  // wire(id, getData): id, html(id) ile üretilen butonun DOM id'si; getData tıklama anında
  // {title, url} döndüren bir fonksiyon — modallar prev/next ile AYNI DOM'u yeniden kullandığından
  // (bkz. proje/mimar/firma/ürün modallarının ortak state machine deseni) URL/başlık render anında
  // DEĞİL, tıklama anında okunmalı.
  function wire(id, getData) {
    injectStyles();
    const btn = document.getElementById(id);
    const popover = document.getElementById(`${id}-popover`);
    if (!btn || !popover || btn.dataset.shareWired) return;
    btn.dataset.shareWired = '1';

    popover.querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener('click', async (e) => {
        const { title, url } = getData();
        const action = el.dataset.action;
        if (action === 'copy') {
          e.preventDefault();
          try {
            await navigator.clipboard.writeText(url);
            showToast(btn, 'Bağlantı kopyalandı!');
          } catch { /* pano izni yoksa sessizce yoksay */ }
          popover.classList.remove('open');
          btn.setAttribute('aria-expanded', 'false');
          return;
        }
        const shareText = encodeURIComponent(title || '');
        const shareUrl = encodeURIComponent(url || '');
        if (action === 'whatsapp') el.href = `https://wa.me/?text=${shareText}%20${shareUrl}`;
        else if (action === 'x') el.href = `https://twitter.com/intent/tweet?text=${shareText}&url=${shareUrl}`;
        else if (action === 'linkedin') el.href = `https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}`;
        popover.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      });
    });

    btn.addEventListener('click', async () => {
      const { title, url } = getData();
      if (navigator.share) {
        try { await navigator.share({ title, url }); } catch { /* kullanıcı iptal etti — sessiz */ }
        return;
      }
      const willOpen = !popover.classList.contains('open');
      closeAllPopovers();
      popover.classList.toggle('open', willOpen);
      btn.setAttribute('aria-expanded', String(willOpen));
    });

    document.addEventListener('click', (e) => {
      if (!popover.classList.contains('open')) return;
      if (!btn.contains(e.target) && !popover.contains(e.target)) {
        popover.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  return { html, wire, injectStyles };
})();
