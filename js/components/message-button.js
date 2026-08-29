// MessageWidget — mimar/firma profillerinde Paylaş'ın yanına eklenen mektup ikonu (bkz. kullanıcı
// isteği: archello.com/brand/ofist'teki "Contact Brand" popup'ı). js/components/share-button.js İLE
// AYNI desen: içerikten bağımsız, plain <script> olarak dahil edilir, global `MessageWidget`
// nesnesini dışa verir. save-widget.js/badge-shared.js İLE AYNI paylaşılan script-scope global'lere
// (currentUser, escapeHtml, escapeAttr) güvenir — bu dosya mimar.html/firma.html'de o dosyalardan
// SONRA yüklenmelidir (bkz. o sayfalardaki <script> sırası).
const MessageWidget = (function () {
  function injectStyles() {
    if (document.getElementById('message-widget-styles')) return;
    const style = document.createElement('style');
    style.id = 'message-widget-styles';
    // .msg-btn — .share-btn İLE BİREBİR AYNI boyut/kırılma noktası (bkz. share-button.js#injectStyles),
    // yalnızca ikon değişir; ayrı bir sınıf altında tutulur ki iki bileşen birbirinin stilini
    // ezmesin (ikisi de aynı sayfada, Takip Et'in hemen yanında yan yana durur).
    style.textContent = `
      .msg-widget{display:inline-flex; flex-shrink:0;}
      .msg-btn{
        display:inline-flex; align-items:center; justify-content:center;
        flex-shrink:0;
        height:32px !important; width:32px !important; min-width:32px !important; box-sizing:border-box;
        background:var(--paper-card); border:1px solid var(--line); border-radius:100px;
        padding:0 !important; color:var(--ink-soft);
        font-family:inherit; line-height:1;
      }
      .msg-btn:hover{border-color:var(--walnut); color:var(--ink);}
      .msg-btn svg{flex-shrink:0;}
      @media (max-width:860px){
        .msg-btn{height:48px !important; width:48px !important; min-width:48px !important;}
        .msg-widget{flex-shrink:0 !important; min-width:44px !important;}
      }

      .msg-compose-overlay{
        display:flex; position:fixed; inset:0; z-index:220; align-items:flex-start; justify-content:center;
        background:rgba(27,42,61,0.55); padding:40px 16px; overflow-y:auto;
      }
      .msg-compose-panel{
        width:100%; max-width:460px; background:var(--paper-card); border-radius:16px;
        padding:28px 26px 24px; box-shadow:0 24px 60px rgba(27,42,61,0.3); position:relative;
        font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .msg-compose-close{
        position:absolute; top:16px; right:16px; width:32px; height:32px; border-radius:50%;
        border:none; background:var(--paper-alt); color:var(--ink-soft); font-size:18px;
        display:flex; align-items:center; justify-content:center; cursor:pointer; line-height:1;
      }
      .msg-compose-close:hover{color:var(--ink);}
      .msg-compose-title{font-size:20px; font-weight:700; margin:0 0 18px; color:var(--ink); padding-right:30px;}
      .msg-compose-recipient{
        display:flex; align-items:center; gap:12px; border:1px solid var(--line); border-radius:12px;
        padding:10px 12px; margin-bottom:16px;
      }
      .msg-compose-recipient-avatar{
        width:36px; height:36px; border-radius:50%; flex-shrink:0; overflow:hidden;
        display:flex; align-items:center; justify-content:center; color:#fff; font-weight:600; font-size:13px;
      }
      .msg-compose-recipient-avatar img{width:100%; height:100%; object-fit:cover;}
      .msg-compose-recipient-name{font-size:14px; font-weight:700; color:var(--ink);}
      .msg-compose-recipient-sub{font-size:12px; color:var(--ink-soft); margin-top:1px;}
      .msg-field{margin-bottom:12px;}
      .msg-field label{display:block; font-size:12px; font-weight:600; color:var(--ink-soft); margin-bottom:5px;}
      .msg-field input, .msg-field textarea{
        width:100%; box-sizing:border-box; border:1px solid var(--line); border-radius:10px;
        padding:10px 12px; font-size:14px; font-family:inherit; color:var(--ink); background:var(--paper-card);
      }
      .msg-field textarea{min-height:96px; resize:vertical;}
      .msg-field input:focus, .msg-field textarea:focus{outline:none; border-color:var(--walnut);}
      .msg-field-row{display:flex; gap:10px;}
      .msg-field-row .msg-field{flex:1; min-width:0;}
      .msg-compose-send{
        width:100%; border:none; border-radius:100px; background:var(--walnut); color:#fff;
        font-size:14.5px; font-weight:700; padding:13px; cursor:pointer; font-family:inherit;
      }
      .msg-compose-send:hover{filter:brightness(0.94);}
      .msg-compose-send:disabled{opacity:0.6; cursor:default;}
      .msg-compose-note{font-size:11.5px; color:var(--ink-soft); text-align:center; margin:10px 0 0;}
      .msg-compose-error{font-size:12.5px; color:#B3261E; margin-top:10px; text-align:center;}
      .msg-compose-success{font-size:14px; font-weight:600; color:var(--ink); text-align:center; padding:20px 0 6px;}
    `;
    document.head.appendChild(style);
  }

  const ICON_MAIL = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 6 10 7 10-7"/></svg>`;

  function html(id) {
    return `<span class="msg-widget"><button class="msg-btn" type="button" id="${id}" aria-label="Mesaj Gönder">${ICON_MAIL}</button></span>`;
  }

  function avatarHtml(data) {
    if (data.image) return `<div class="msg-compose-recipient-avatar"><img src="${escapeAttr(cdnImg(data.image, 80))}" alt=""></div>`;
    return `<div class="msg-compose-recipient-avatar" style="background:${officeColor(data.title)}">${escapeHtml(initials(data.title))}</div>`;
  }

  function closeCompose() {
    const overlay = document.getElementById('msg-compose-overlay');
    if (overlay) overlay.remove();
  }

  function openCompose(data) {
    closeCompose();
    const overlay = document.createElement('div');
    overlay.className = 'msg-compose-overlay';
    overlay.id = 'msg-compose-overlay';
    overlay.innerHTML = `
      <div class="msg-compose-panel">
        <button type="button" class="msg-compose-close" aria-label="Kapat">&times;</button>
        <h2 class="msg-compose-title">Mesaj Gönder</h2>
        <div class="msg-compose-recipient">
          ${avatarHtml(data)}
          <div>
            <div class="msg-compose-recipient-name">${escapeHtml(data.title)}</div>
            ${data.subtitle ? `<div class="msg-compose-recipient-sub">${escapeHtml(data.subtitle)}</div>` : ''}
          </div>
        </div>
        <form id="msg-compose-form">
          <div class="msg-field"><label for="msg-f-desc">Mesajınız</label><textarea id="msg-f-desc" maxlength="4000" required></textarea></div>
          <div class="msg-field"><label for="msg-f-name">Ad Soyad</label><input id="msg-f-name" required value="${escapeAttr((typeof currentUser !== 'undefined' && currentUser && currentUser.name) || '')}"></div>
          <div class="msg-field"><label for="msg-f-email">E-posta</label><input type="email" id="msg-f-email" required value="${escapeAttr((typeof currentUser !== 'undefined' && currentUser && currentUser.email) || '')}"></div>
          <div class="msg-field"><label for="msg-f-city">Şehir</label><input id="msg-f-city"></div>
          <div class="msg-field-row">
            <div class="msg-field"><label for="msg-f-company">Firma (opsiyonel)</label><input id="msg-f-company"></div>
            <div class="msg-field"><label for="msg-f-phone">Telefon (opsiyonel)</label><input id="msg-f-phone"></div>
          </div>
          <button type="submit" class="msg-compose-send">Gönder</button>
          <p class="msg-compose-note">Mesajın, bu profilin onaylı sahiplerine iletilir ve sana e-postayla değil, Bildirimler ve Mesajlar üzerinden cevaplanır.</p>
          <div class="msg-compose-error" id="msg-compose-error" style="display:none;"></div>
        </form>
      </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    function close() {
      document.body.style.overflow = '';
      closeCompose();
    }
    overlay.querySelector('.msg-compose-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', onEsc); if (document.getElementById('msg-compose-overlay')) close(); }
    });

    const form = overlay.querySelector('#msg-compose-form');
    const errorEl = overlay.querySelector('#msg-compose-error');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.style.display = 'none';
      const sendBtn = form.querySelector('.msg-compose-send');
      sendBtn.disabled = true;
      sendBtn.textContent = 'Gönderiliyor...';
      try {
        const res = await fetch('/api/messages/threads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            profileType: data.profileType,
            profileKey: data.profileKey,
            description: document.getElementById('msg-f-desc').value.trim(),
            name: document.getElementById('msg-f-name').value.trim(),
            email: document.getElementById('msg-f-email').value.trim(),
            city: document.getElementById('msg-f-city').value.trim(),
            company: document.getElementById('msg-f-company').value.trim(),
            phone: document.getElementById('msg-f-phone').value.trim(),
          }),
        });
        const resData = await res.json().catch(() => ({}));
        if (!res.ok) {
          errorEl.textContent = resData.error || 'Mesaj gönderilemedi, lütfen tekrar dene.';
          errorEl.style.display = 'block';
          sendBtn.disabled = false;
          sendBtn.textContent = 'Gönder';
          return;
        }
        overlay.querySelector('.msg-compose-panel').innerHTML = `
          <button type="button" class="msg-compose-close" aria-label="Kapat">&times;</button>
          <div class="msg-compose-success">Mesajın gönderildi! Cevap geldiğinde Bildirimler ve Mesajlar'da göreceksin.</div>`;
        overlay.querySelector('.msg-compose-close').addEventListener('click', close);
      } catch {
        errorEl.textContent = 'Mesaj gönderilemedi, lütfen tekrar dene.';
        errorEl.style.display = 'block';
        sendBtn.disabled = false;
        sendBtn.textContent = 'Gönder';
      }
    });
  }

  // wire(id, getData): id, html(id) ile üretilen butonun DOM id'si; getData tıklama anında
  // {profileType, profileKey, title, subtitle, image} döndüren bir fonksiyon — ShareWidget#wire İLE
  // AYNI gerekçe (prev/next aynı DOM'u yeniden kullanır, veri render anında değil tıklama anında okunmalı).
  function wire(id, getData) {
    injectStyles();
    const btn = document.getElementById(id);
    if (!btn || btn.dataset.msgWired) return;
    btn.dataset.msgWired = '1';
    btn.addEventListener('click', () => {
      if (typeof currentUser === 'undefined' || !currentUser) { window.location.href = 'giris-yap.html'; return; }
      openCompose(getData());
    });
  }

  return { html, wire };
})();
