// SocialLinks — mimar/firma profil pop-up'larında Kaydet/Paylaş satırının altına eklenen
// tek satırlık sosyal medya ikon(lar)ı (bkz. kullanıcı isteği: "kaydet, paylaş vs. butonlarının
// altındaki satırda en soldan başlayarak sağa doğru sıralansınlar"). save-widget.js/share-button.js
// ile AYNI desen — modal-shell.js gibi içerikten bağımsız, her sayfada
// <script src="js/components/social-links.js"> ile dahil edilir, global `SocialLinks` nesnesini
// dışa verir. mimar-ekle.html/firma-ekle.html'deki Sosyal Medya kutucuğunun
// platform seçenekleriyle (instagram/linkedin/x) BİREBİR aynı enum — bkz. src/lib/
// submissionTypes.js#SOCIAL_PLATFORMS.
const SocialLinks = (function () {
  const ICONS = {
    instagram: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>',
    linkedin: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>',
    x: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  };
  const LABELS = { instagram: 'Instagram', linkedin: 'LinkedIn', x: 'X' };

  function injectStyles() {
    if (document.getElementById('social-links-styles')) return;
    const style = document.createElement('style');
    style.id = 'social-links-styles';
    style.textContent = `
      .social-links-row{display:flex; align-items:center; gap:8px; margin-top:10px;}
      .social-link-btn{
        display:inline-flex; align-items:center; justify-content:center;
        height:32px; width:32px; box-sizing:border-box;
        background:var(--paper-card); border:1px solid var(--line); border-radius:100px;
        color:var(--ink-soft); flex-shrink:0;
      }
      .social-link-btn:hover{border-color:var(--walnut); color:var(--ink);}
    `;
    document.head.appendChild(style);
  }

  // bkz. auth-modal.js#safeUrl'deki AYNI kök neden/düzeltme — window.location.href yerine
  // document.baseURI.
  function safeUrl(u) {
    try {
      const parsed = new URL(u, document.baseURI);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
    } catch {}
    return '';
  }

  // platform/url: buildArchitectPayload/buildOfficePayload'ın item.socialPlatform/item.socialUrl
  // alanları (bkz. src/routes/architect.js|office.js) — link yoksa/geçersizse boş string döner,
  // çağıran satırı hiç render etmez.
  function html(platform, url) {
    const href = url ? safeUrl(url) : '';
    if (!platform || !href || !ICONS[platform]) return '';
    injectStyles();
    return `<div class="social-links-row"><a class="social-link-btn" href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer nofollow" aria-label="${escapeAttr(LABELS[platform])}">${ICONS[platform]}</a></div>`;
  }

  return { html };
})();
