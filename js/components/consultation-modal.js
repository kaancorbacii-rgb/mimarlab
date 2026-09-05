// ConsultationModal — "Danışmanlık Al" (kullanıcı isteği, 2026-09-05): kişi popup'ının başlığında
// Mesajlaşma ile Takip Et arasında, ŞİMDİLİK YALNIZCA "kaan-corbaci" profilinde (bkz.
// architect-modal.js#renderItem — a.slug kapısı) görünen bir buton, tıklanınca açık olan
// ArchitectModal'ın (ModalShell) ÜSTÜNDE ikinci bir bağımsız overlay açar.
//
// Desen js/components/info-modal.js#ensureRozetPayPopup / rating-widget.js#ensureRatePopup İLE
// AYNI: singleton, document.body'ye TEK seferlik enjekte edilen, z-index 400 (ModalShell'in
// overlay'i 150'de kalır) sabit konumlu bir overlay — ModalShell ikinci bir içeriği kendi
// içinde AÇAMADIĞINDAN (tek paylaşılan singleton) bu şekilde kendi DOM'unu taşır. Aynı temizlik
// kuralı: alttaki ModalShell popup'ı (X, geri tuşu, başka popup'a geçiş) kapanırsa
// 'mimarlab-modal-closed' olayını dinleyip bu overlay'i de kapatır — aksi halde body.overflow
// 'hidden'da asılı kalır (bkz. o iki dosyadaki AYNI gerçek bulgu).
//
// Ödeme ekranının işaretleme/CSS'i (kullanıcı isteği: "Rozet Al ödeme ekranının BİREBİR AYNISI")
// info-modal.js#ensureRozetPayPopup'taki .rozet-pay-* kurallarının DEĞER BAZINDA birebir kopyasıdır
// (kisi.html info-modal.js'i hiç yüklemediğinden doğrudan çağrılamaz/import edilemez — bkz. proje
// hafızası, kisi.html architect-modal.js dışında ağır bir modül yüklemiyor). Sınıf öneki
// çakışmasın diye "cns-pay-" oldu, ama tüm renk/boyut/aralık değerleri kaynağıyla AYNI.
const ConsultationModal = (function () {
  const CONSULTATION_PRICE_TRY = 1500; // sunucudaki src/routes/consultations.js#CONSULTATION_PRICE_TRY İLE AYNI — burası yalnızca gösterim, gerçek fiyat sunucuda sabitlenir.
  const HAVALE_IBAN_FORMATTED = 'TR22 0004 6001 7088 8000 2482 94';
  const HAVALE_IBAN_RAW = 'TR220004600170888000248294';

  let popupApi = null;

  function ensurePopup() {
    if (popupApi) return popupApi;

    if (!document.getElementById('consultation-modal-style')) {
      const style = document.createElement('style');
      style.id = 'consultation-modal-style';
      style.textContent = `
        .cns-overlay{display:none; position:fixed; inset:0; z-index:400; background:rgba(20,24,30,0.62); backdrop-filter:blur(2px); align-items:flex-start; justify-content:center; padding:40px 20px; overflow-y:auto;}
        .cns-overlay.open{display:flex;}
        .cns-popup{width:100%; max-width:440px; background:var(--paper-card); border-radius:16px; padding:28px 26px 26px; position:relative; box-shadow:0 24px 60px rgba(0,0,0,0.35); margin:auto;}
        .cns-close{position:absolute; top:12px; right:12px; background:none; border:none; color:var(--ink-soft); padding:8px; cursor:pointer; display:flex; border-radius:50%;}
        .cns-close:hover{color:var(--ink); background:var(--paper-alt);}
        .cns-eyebrow{font-size:11px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:var(--sage);}
        .cns-title{margin:4px 0 14px; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:19px; font-weight:700; color:var(--ink); padding-right:20px;}
        .cns-intro{font-size:13.5px; line-height:1.6; color:var(--ink-soft); margin:0 0 18px;}
        .cns-fields-row{display:flex; gap:12px; margin-bottom:20px;}
        .cns-field{flex:1; min-width:0;}
        .cns-field label{display:block; font-size:12px; font-weight:600; color:var(--ink-soft); margin-bottom:6px;}
        .cns-field input{width:100%; box-sizing:border-box; padding:11px 12px; border:1px solid var(--line); border-radius:10px; font-size:14px; font-family:inherit; background:var(--paper); color:var(--ink);}
        .cns-field input:focus{outline:none; border-color:var(--walnut);}
        .cns-back{display:inline-flex; align-items:center; gap:4px; background:none; border:none; color:var(--ink-soft); font-size:12.5px; font-weight:600; cursor:pointer; padding:0; margin-bottom:14px;}
        .cns-back:hover{color:var(--ink);}
        .cns-submit{width:100%; background:var(--ink); color:var(--paper-card); border:none; padding:13px; border-radius:100px; font-weight:600; font-size:14.5px; margin-top:4px; cursor:pointer;}
        .cns-submit:hover{background:var(--walnut);}
        .cns-submit:disabled{background:var(--paper-alt); color:var(--ink-soft); cursor:default;}
        .cns-pay-summary-row{display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--line-soft); font-size:14px;}
        .cns-pay-summary-row:last-of-type{border-bottom:none; margin-bottom:14px;}
        .cns-pay-summary-total{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-weight:700; font-size:17px;}
        .cns-pay-section-title{font-size:14px; font-weight:700; margin:6px 0 2px;}
        .cns-pay-section-hint{font-size:12.5px; color:var(--ink-soft); margin:0 0 6px;}
        .cns-pay-option{display:flex; align-items:center; gap:9px; font-size:13.5px; font-weight:500; cursor:pointer; padding:8px 4px;}
        .cns-pay-option input{width:16px; height:16px; accent-color:var(--walnut); flex-shrink:0;}
        .cns-pay-option-disabled{opacity:0.55; cursor:default;}
        .cns-pay-option-disabled input{cursor:default;}
        .cns-pay-soon-tag{font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; color:var(--ink-soft); background:var(--paper-alt); padding:3px 8px; border-radius:100px;}
        .cns-pay-havale-box{margin-top:12px; border:1px solid var(--line); border-radius:12px; padding:14px 16px; background:var(--paper);}
        .cns-pay-havale-row{display:flex; align-items:center; gap:10px; justify-content:space-between; padding:7px 0; border-bottom:1px solid var(--line-soft); font-size:13px;}
        .cns-pay-havale-row:last-of-type{border-bottom:none;}
        .cns-pay-havale-label{color:var(--ink-soft); flex-shrink:0;}
        .cns-pay-havale-value{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-weight:600; text-align:right; word-break:break-word;}
        .cns-pay-copy-btn{flex-shrink:0; background:none; border:1px solid var(--line); border-radius:100px; padding:5px 11px; font-size:11px; font-weight:600; color:var(--ink);}
        .cns-pay-copy-btn:hover{background:var(--paper-alt);}
        .cns-pay-hint{font-size:12px; color:var(--ink-soft); line-height:1.6; margin:10px 0 0;}
        .cns-pay-notice{display:none; margin-top:14px; padding:12px 14px; border-radius:10px; background:rgba(224,138,62,0.12); border:1px solid var(--accent); color:var(--ink); font-size:12.5px; line-height:1.6;}
        .cns-pay-notice.success{background:rgba(62,122,85,0.12); border-color:#3E7A55;}
        .cns-pay-notice.show{display:block;}
      `;
      document.head.appendChild(style);
    }

    const overlay = document.createElement('div');
    overlay.className = 'cns-overlay';
    overlay.innerHTML = `
      <div class="cns-popup" role="dialog" aria-modal="true" aria-labelledby="cns-title">
        <button type="button" class="cns-close" aria-label="Kapat"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        <div class="cns-eyebrow">Danışmanlık</div>
        <h3 class="cns-title" id="cns-title">—</h3>

        <div id="cns-screen-book">
          <p class="cns-intro" id="cns-intro"></p>
          <div class="cns-fields-row">
            <div class="cns-field"><label for="cns-date">Tarih</label><input type="date" id="cns-date"></div>
            <div class="cns-field"><label for="cns-time">Saat</label><input type="time" id="cns-time"></div>
          </div>
          <button class="cns-submit" type="button" id="cns-continue-btn" disabled>Devam Et</button>
        </div>

        <div id="cns-screen-pay" style="display:none;">
          <button type="button" class="cns-back" id="cns-back-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Geri</button>

          <div class="cns-pay-summary-row"><span>Tarih</span><span id="cns-pay-date">—</span></div>
          <div class="cns-pay-summary-row"><span>Saat</span><span id="cns-pay-time">—</span></div>
          <div class="cns-pay-summary-row"><span>Tutar</span><span class="cns-pay-summary-total" id="cns-pay-price">—</span></div>

          <div class="cns-pay-section-title">Ödeme Yöntemi</div>
          <p class="cns-pay-section-hint">Şu anda yalnızca havale/EFT ile ödeme alıyoruz.</p>
          <label class="cns-pay-option"><input type="radio" name="cns-pay-method" checked> Havale / EFT</label>
          <label class="cns-pay-option cns-pay-option-disabled"><input type="radio" disabled> Kredi / Banka Kartı <span class="cns-pay-soon-tag">Şu an aktif değil</span></label>

          <div class="cns-pay-havale-box">
            <div class="cns-pay-havale-row">
              <span class="cns-pay-havale-label">IBAN</span>
              <span class="cns-pay-havale-value">${HAVALE_IBAN_FORMATTED}</span>
              <button type="button" class="cns-pay-copy-btn" id="cns-pay-copy-btn">Kopyala</button>
            </div>
            <div class="cns-pay-havale-row"><span class="cns-pay-havale-label">Hesap Sahibi</span><span class="cns-pay-havale-value">Kaan Çorbacı</span></div>
            <div class="cns-pay-havale-row"><span class="cns-pay-havale-label">Tutar</span><span class="cns-pay-havale-value" id="cns-pay-amount">—</span></div>
            <div class="cns-pay-havale-row"><span class="cns-pay-havale-label">Açıklama</span><span class="cns-pay-havale-value">info@mimarlab.com</span></div>
            <p class="cns-pay-hint">Ödemeni yukarıdaki IBAN'a gönderirken açıklama kısmına e-posta adresini yaz. Ödemeyi tamamladıktan sonra aşağıdaki butona tıkla, randevun onaylandığında sana dönüş yapılacak.</p>
          </div>

          <button class="cns-submit" type="button" id="cns-pay-confirm-btn">Ödemeyi Yaptım</button>
          <div class="cns-pay-notice" id="cns-pay-notice"></div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const titleEl = overlay.querySelector('#cns-title');
    const introEl = overlay.querySelector('#cns-intro');
    const dateInput = overlay.querySelector('#cns-date');
    const timeInput = overlay.querySelector('#cns-time');
    const continueBtn = overlay.querySelector('#cns-continue-btn');
    const bookScreen = overlay.querySelector('#cns-screen-book');
    const payScreen = overlay.querySelector('#cns-screen-pay');
    const backBtn = overlay.querySelector('#cns-back-btn');
    const payDateEl = overlay.querySelector('#cns-pay-date');
    const payTimeEl = overlay.querySelector('#cns-pay-time');
    const payPriceEl = overlay.querySelector('#cns-pay-price');
    const payAmountEl = overlay.querySelector('#cns-pay-amount');
    const confirmBtn = overlay.querySelector('#cns-pay-confirm-btn');
    const notice = overlay.querySelector('#cns-pay-notice');
    const copyBtn = overlay.querySelector('#cns-pay-copy-btn');
    const CONFIRM_BTN_LABEL = 'Ödemeyi Yaptım';

    const todayStr = new Date().toISOString().slice(0, 10);
    dateInput.min = todayStr;

    const state = { hostSlug: null, hostName: null };

    function close() {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    }
    overlay.querySelector('.cns-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open')) close(); });
    // Bu popup bir ArchitectModal (ModalShell) içeriğinin ÜSTÜNDE açılır — o popup kapanırsa
    // (X, geri tuşu, başka bir popup'a geçiş) bu overlay document.body'de asılı kalıp
    // body.overflow'u 'hidden'da kilitli bırakmasın diye info-modal.js#ensureRozetPayPopup İLE AYNI temizlik.
    document.addEventListener('mimarlab-modal-closed', close);

    function refreshContinueState() {
      continueBtn.disabled = !(dateInput.value && timeInput.value);
    }
    dateInput.addEventListener('input', refreshContinueState);
    timeInput.addEventListener('input', refreshContinueState);

    function formatDateTr(isoDate) {
      const d = new Date(`${isoDate}T00:00:00`);
      if (Number.isNaN(d.getTime())) return isoDate;
      return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
    }
    function formatPriceTr(amount) {
      return `${amount.toLocaleString('tr-TR')} TL`;
    }

    function showBookScreen() {
      bookScreen.style.display = '';
      payScreen.style.display = 'none';
    }
    function showPayScreen() {
      payDateEl.textContent = formatDateTr(dateInput.value);
      payTimeEl.textContent = timeInput.value;
      payPriceEl.textContent = formatPriceTr(CONSULTATION_PRICE_TRY);
      payAmountEl.textContent = formatPriceTr(CONSULTATION_PRICE_TRY);
      notice.textContent = '';
      notice.classList.remove('show', 'success');
      confirmBtn.disabled = false;
      confirmBtn.textContent = CONFIRM_BTN_LABEL;
      bookScreen.style.display = 'none';
      payScreen.style.display = '';
    }

    continueBtn.addEventListener('click', () => {
      if (!dateInput.value || !timeInput.value) return;
      showPayScreen();
    });
    backBtn.addEventListener('click', showBookScreen);

    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(HAVALE_IBAN_RAW);
        const original = copyBtn.textContent;
        copyBtn.textContent = 'Kopyalandı';
        setTimeout(() => { copyBtn.textContent = original; }, 1500);
      } catch {}
    });

    confirmBtn.addEventListener('click', async () => {
      notice.classList.remove('show', 'success');
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Gönderiliyor…';
      try {
        const res = await fetch('/api/consultations', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostSlug: state.hostSlug, date: dateInput.value, time: timeInput.value }),
        });
        if (res.status === 401) { window.location.href = '/giris'; return; }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          notice.textContent = data.error || 'Talep gönderilemedi, tekrar dene.';
          notice.classList.add('show');
          confirmBtn.disabled = false;
          confirmBtn.textContent = CONFIRM_BTN_LABEL;
          return;
        }
        notice.textContent = `Talebin alındı. Ödemen kontrol edilip onaylandığında ${state.hostName || 'danışmanınız'} seninle iletişime geçecek.`;
        notice.classList.add('show', 'success');
        confirmBtn.textContent = 'Talebin Gönderildi';
      } catch {
        notice.textContent = 'Sunucuya ulaşılamadı, lütfen tekrar dene.';
        notice.classList.add('show');
        confirmBtn.disabled = false;
        confirmBtn.textContent = CONFIRM_BTN_LABEL;
      }
    });

    popupApi = {
      open({ hostSlug, hostName }) {
        state.hostSlug = hostSlug;
        state.hostName = hostName;
        titleEl.textContent = `${hostName} ile Görüşme`;
        introEl.textContent = `${hostName} ile birebir görüşme ayarlamak için uygun tarih ve saati seçin.`;
        dateInput.value = '';
        timeInput.value = '';
        refreshContinueState();
        showBookScreen();
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
      },
    };
    return popupApi;
  }

  return {
    open(opts) { ensurePopup().open(opts); },
  };
})();
