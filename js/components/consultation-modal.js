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
//
// Akış üç ekrana çıkarıldı (kullanıcı isteği, 2026-09-05 madde 1): takvim (book) → ödeme (pay) →
// onay (success). "Görüşme Tarihini Değiştir" onay ekranından book'a geri döner ve state.requestId
// doluysa Devam Et artık YENİ bir talep açmaz, PATCH /api/consultations/:id ile mevcut talebin
// tarih/saatini günceller (bkz. src/routes/consultations.js#updateConsultationRequest).
//
// Takvim, yatay tarih şeridinden AYLIK IZGARA'ya çevrildi (kullanıcı isteği, 2026-09-06): her gün
// hücresinin altında yeşil (müsait)/kırmızı (kapalı ya da dolu) nokta gösterilir, geçmiş günler ve
// ilk 24 saat noktasız/tıklanamaz. Doluluk src/routes/consultations.js#getAvailability'den (herkese
// açık, kişisel veri İÇERMEZ) ay bazında çekilir — bkz. calendarState.availability.
const ConsultationModal = (function () {
  const CONSULTATION_PRICE_TRY = 1500; // sunucudaki src/routes/consultations.js#CONSULTATION_PRICE_TRY İLE AYNI — burası yalnızca gösterim, gerçek fiyat sunucuda sabitlenir.
  const HAVALE_IBAN_FORMATTED = 'TR22 0004 6001 7088 8000 2482 94';
  const HAVALE_IBAN_RAW = 'TR220004600170888000248294';
  // Uygun günler (Pzt/Çar/Cum) ve saatler (kullanıcı isteği, 2026-09-05) — src/routes/
  // consultations.js#ALLOWED_WEEKDAYS/ALLOWED_TIMES İLE AYNI, sunucu bağımsız olarak yeniden
  // doğrular (istemciye güvenilmez).
  const ALLOWED_WEEKDAYS = new Set([1, 3, 5]);
  const ALLOWED_TIMES = ['18:00', '19:00', '20:00'];
  // src/routes/consultations.js#MIN_NOTICE_MS İLE AYNI — yalnızca takvimde günü erkenden
  // noktasız/tıklanamaz göstermek için, asıl doğrulama sunucudadır.
  const MIN_NOTICE_MS = 24 * 60 * 60 * 1000;
  const WEEKDAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

  let popupApi = null;

  function pad2(n) { return String(n).padStart(2, '0'); }
  function isoDateLocal(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function capitalizeFirst(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // Bir takvim gününün durumu — 'past' (geçmiş/ilk 24 saat, noktasız/tıklanamaz), 'red' (haftanın
  // uygun olmayan günü YA DA tüm uygun saatler dolu), 'green' (en az bir saat seçilebilir).
  // `bookedTimes`, o gün için zaten alınmış (pending/approved) saatlerin listesi.
  function dayStatus(dateIso, todayIso, bookedTimes) {
    if (dateIso < todayIso) return 'past';
    const dow = new Date(`${dateIso}T00:00:00`).getDay();
    if (!ALLOWED_WEEKDAYS.has(dow)) return 'red';
    const cutoffMs = Date.now() + MIN_NOTICE_MS;
    const eligible = ALLOWED_TIMES.filter((t) => new Date(`${dateIso}T${t}:00`).getTime() >= cutoffMs);
    if (!eligible.length) return 'past'; // bugün/yarın — henüz ilk 24 saat dolmamış
    const free = eligible.filter((t) => !(bookedTimes || []).includes(t));
    return free.length ? 'green' : 'red'; // tamamen dolu
  }

  function formatDateTr(isoDate) {
    const d = new Date(`${isoDate}T00:00:00`);
    if (Number.isNaN(d.getTime())) return isoDate;
    return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function formatPriceTr(amount) {
    return `${amount.toLocaleString('tr-TR')} TL`;
  }

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
        .cns-title{margin:4px 0 10px; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:19px; font-weight:700; color:var(--ink); padding-right:20px;}
        .cns-intro{font-size:13px; line-height:1.6; color:var(--ink-soft); margin:0 0 16px;}
        .cns-field-label{font-size:12px; font-weight:600; color:var(--ink-soft); margin:14px 0 6px;}
        .cns-field-label:first-of-type{margin-top:0;}
        .cns-notice-banner{display:flex; align-items:flex-start; gap:8px; font-size:12px; line-height:1.55; color:var(--ink); background:rgba(224,138,62,0.10); border:1px solid var(--accent); border-radius:10px; padding:10px 12px; margin:0 0 16px; font-weight:600;}
        .cns-cal{border:1px solid var(--line); border-radius:12px; padding:12px; margin-bottom:4px;}
        .cns-cal-head{display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;}
        .cns-cal-month{font-size:13.5px; font-weight:700; color:var(--ink); text-transform:capitalize;}
        .cns-cal-nav{background:none; border:1px solid var(--line); border-radius:50%; width:26px; height:26px; display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--ink); font-size:15px; line-height:1; font-family:inherit;}
        .cns-cal-nav:hover{background:var(--paper-alt);}
        .cns-cal-nav:disabled{opacity:0.35; cursor:default;}
        .cns-cal-nav:disabled:hover{background:none;}
        .cns-cal-weekdays{display:grid; grid-template-columns:repeat(7,1fr); margin-bottom:2px;}
        .cns-cal-weekdays span{text-align:center; font-size:10.5px; font-weight:700; color:var(--ink-soft); text-transform:uppercase;}
        .cns-cal-grid{display:grid; grid-template-columns:repeat(7,1fr); gap:2px;}
        .cns-cal-cell{aspect-ratio:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; background:none; border:1.5px solid transparent; border-radius:8px; font-family:inherit; font-size:12.5px; font-weight:600; color:var(--ink); padding:2px;}
        .cns-cal-cell-empty{visibility:hidden;}
        .cns-cal-clickable{cursor:pointer;}
        .cns-cal-clickable:hover{background:var(--paper-alt);}
        .cns-cal-cell.active{border-color:var(--ink); background:var(--paper-alt);}
        .cns-cal-disabled{color:var(--ink-soft); opacity:0.45; cursor:default;}
        .cns-dot{display:block; width:5px; height:5px; border-radius:50%;}
        .cns-dot-green{background:#3E7A55;}
        .cns-dot-red{background:#B84C4C;}
        .cns-cal-legend{display:flex; gap:16px; margin-top:10px; padding-top:8px; border-top:1px solid var(--line-soft); font-size:11px; color:var(--ink-soft);}
        .cns-cal-legend span{display:flex; align-items:center; gap:5px;}
        .cns-time-row{display:flex; gap:8px; margin-bottom:6px; flex-wrap:wrap;}
        .cns-time-chip{flex:1; min-width:70px; padding:11px 6px; border:1px solid var(--line); border-radius:10px; background:var(--paper); color:var(--ink); font-size:13px; font-weight:600; cursor:pointer; font-family:inherit;}
        .cns-time-chip.active{background:var(--ink); color:var(--paper-card); border-color:var(--ink);}
        .cns-time-chip:disabled{cursor:default; opacity:0.5;}
        .cns-time-taken{color:#B84C4C; border-color:#B84C4C; background:rgba(184,76,76,0.08);}
        .cns-back{display:inline-flex; align-items:center; gap:4px; background:none; border:none; color:var(--ink-soft); font-size:12.5px; font-weight:600; cursor:pointer; padding:0; margin-bottom:14px;}
        .cns-back:hover{color:var(--ink);}
        .cns-submit{width:100%; background:var(--ink); color:var(--paper-card); border:none; padding:13px; border-radius:100px; font-weight:600; font-size:14.5px; margin-top:6px; cursor:pointer;}
        .cns-submit:hover{background:var(--walnut);}
        .cns-submit:disabled{background:var(--paper-alt); color:var(--ink-soft); cursor:default;}
        .cns-contact-field input{width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid var(--line); border-radius:10px; font-size:13.5px; font-family:inherit; background:var(--paper); color:var(--ink);}
        .cns-contact-field input:focus{outline:none; border-color:var(--walnut);}
        .cns-note-wrap{position:relative; margin-bottom:2px;}
        .cns-note-wrap textarea{width:100%; box-sizing:border-box; min-height:64px; padding:9px 12px; border:1px solid var(--line); border-radius:10px; background:var(--paper); color:var(--ink); font-family:inherit; font-size:12.5px; resize:vertical;}
        .cns-note-wrap textarea:focus{outline:none; border-color:var(--walnut);}
        .cns-pay-summary-row{display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--line-soft); font-size:14px;}
        .cns-pay-summary-row:last-of-type{border-bottom:none; margin-bottom:6px;}
        .cns-pay-summary-total{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-weight:700; font-size:17px;}
        .cns-pay-section-title{font-size:14px; font-weight:700; margin:16px 0 2px;}
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
        .cns-success-summary{font-weight:700; font-size:14.5px; margin-bottom:10px;}
        .cns-success-text{font-size:13.5px; line-height:1.6; color:var(--ink); margin:0 0 20px;}
        .cns-btn-outline{width:100%; background:none; color:var(--ink); border:1.5px solid var(--ink); padding:12px; border-radius:100px; font-weight:600; font-size:14px; cursor:pointer; margin-bottom:10px;}
        .cns-btn-outline:hover{border-color:var(--walnut); color:var(--walnut);}
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
          <div class="cns-notice-banner">Görüşme süresi 45 dakikadır. Saatler İstanbul (GMT+3) zaman dilimine göredir.</div>
          <div class="cns-field-label">Tarih</div>
          <div class="cns-cal">
            <div class="cns-cal-head">
              <button type="button" class="cns-cal-nav" id="cns-cal-prev" aria-label="Önceki ay">‹</button>
              <div class="cns-cal-month" id="cns-cal-month">—</div>
              <button type="button" class="cns-cal-nav" id="cns-cal-next" aria-label="Sonraki ay">›</button>
            </div>
            <div class="cns-cal-weekdays">${WEEKDAY_LABELS.map(w => `<span>${w}</span>`).join('')}</div>
            <div class="cns-cal-grid" id="cns-cal-grid"></div>
            <div class="cns-cal-legend"><span><i class="cns-dot cns-dot-green"></i>Müsait</span><span><i class="cns-dot cns-dot-red"></i>Kapalı / Dolu</span></div>
          </div>
          <div class="cns-field-label" id="cns-time-label" style="display:none;">Saat</div>
          <div class="cns-time-row" id="cns-time-row" style="display:none;"></div>
          <button class="cns-submit" type="button" id="cns-continue-btn" disabled>Devam Et</button>
          <div class="cns-pay-notice" id="cns-book-notice"></div>
        </div>

        <div id="cns-screen-pay" style="display:none;">
          <button type="button" class="cns-back" id="cns-back-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Geri</button>

          <div class="cns-pay-summary-row"><span>Tarih</span><span id="cns-pay-date">—</span></div>
          <div class="cns-pay-summary-row"><span>Saat</span><span id="cns-pay-time">—</span></div>
          <div class="cns-pay-summary-row"><span>Tutar</span><span class="cns-pay-summary-total" id="cns-pay-price">—</span></div>

          <div class="cns-field-label" style="margin-top:16px;">Ad Soyad</div>
          <div class="cns-contact-field"><input type="text" id="cns-contact-name" autocomplete="name" maxlength="120"></div>
          <div class="cns-field-label">E-posta</div>
          <div class="cns-contact-field"><input type="email" id="cns-contact-email" autocomplete="email" maxlength="120"></div>
          <div class="cns-field-label">Telefon</div>
          <div class="cns-contact-field"><input type="tel" id="cns-contact-phone" autocomplete="tel" maxlength="30"></div>

          <div class="cns-field-label">Görüşme isteği hakkında</div>
          <div class="cns-note-wrap">
            <textarea id="cns-note" maxlength="2000" placeholder="Opsiyonel — konuşmak istediğin konuyu ya da eklemek istediklerini yaz…"></textarea>
          </div>

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
            <p class="cns-pay-hint">Ödemeni yukarıdaki IBAN'a gönderirken açıklama kısmına e-posta adresini yaz. Ödemeyi tamamladıktan sonra aşağıdaki butona tıkla.</p>
          </div>

          <button class="cns-submit" type="button" id="cns-pay-confirm-btn">Ödemeyi Yaptım</button>
          <div class="cns-pay-notice" id="cns-pay-notice"></div>
        </div>

        <div id="cns-screen-success" style="display:none;">
          <div class="cns-success-summary" id="cns-success-summary"></div>
          <p class="cns-success-text" id="cns-success-text"></p>
          <button type="button" class="cns-btn-outline" id="cns-reschedule-btn">Görüşme Tarihini Değiştir</button>
          <button type="button" class="cns-submit" id="cns-success-close-btn">Tamam</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const titleEl = overlay.querySelector('#cns-title');
    const introEl = overlay.querySelector('#cns-intro');
    const calPrevBtn = overlay.querySelector('#cns-cal-prev');
    const calNextBtn = overlay.querySelector('#cns-cal-next');
    const calMonthEl = overlay.querySelector('#cns-cal-month');
    const calGridEl = overlay.querySelector('#cns-cal-grid');
    const timeLabelEl = overlay.querySelector('#cns-time-label');
    const timeRowEl = overlay.querySelector('#cns-time-row');
    const bookNotice = overlay.querySelector('#cns-book-notice');
    const continueBtn = overlay.querySelector('#cns-continue-btn');
    const bookScreen = overlay.querySelector('#cns-screen-book');
    const payScreen = overlay.querySelector('#cns-screen-pay');
    const successScreen = overlay.querySelector('#cns-screen-success');
    const backBtn = overlay.querySelector('#cns-back-btn');
    const payDateEl = overlay.querySelector('#cns-pay-date');
    const payTimeEl = overlay.querySelector('#cns-pay-time');
    const payPriceEl = overlay.querySelector('#cns-pay-price');
    const payAmountEl = overlay.querySelector('#cns-pay-amount');
    const confirmBtn = overlay.querySelector('#cns-pay-confirm-btn');
    const notice = overlay.querySelector('#cns-pay-notice');
    const copyBtn = overlay.querySelector('#cns-pay-copy-btn');
    const nameInput = overlay.querySelector('#cns-contact-name');
    const emailInput = overlay.querySelector('#cns-contact-email');
    const phoneInput = overlay.querySelector('#cns-contact-phone');
    const noteInput = overlay.querySelector('#cns-note');
    const successSummaryEl = overlay.querySelector('#cns-success-summary');
    const successTextEl = overlay.querySelector('#cns-success-text');
    const rescheduleBtn = overlay.querySelector('#cns-reschedule-btn');
    const successCloseBtn = overlay.querySelector('#cns-success-close-btn');
    const CONFIRM_BTN_LABEL = 'Ödemeyi Yaptım';

    const state = { hostSlug: null, hostName: null, requestId: null, date: null, time: null, hasRescheduled: false };
    const calendarState = { year: 0, month: 0, availability: {} };
    let availReqSeq = 0;
    let prefill = { name: '', email: '' };

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

    // Ay ızgarasını (mevcut calendarState.year/month + calendarState.availability'e göre) çizer.
    // Doluluk sunucudan zaten alınmışsa (loadAvailabilityForMonth) burası SADECE görüntüler, ağ
    // isteği atmaz — ay değiştirmenin/gün seçmenin hızlı hissettirmesi için ayrıştırılmıştır.
    function renderCalendarMonth() {
      const y = calendarState.year, m = calendarState.month;
      const now = new Date();
      calMonthEl.textContent = capitalizeFirst(new Date(y, m, 1).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' }));
      const firstIdx = (new Date(y, m, 1).getDay() + 6) % 7; // Pazartesi=0 olacak şekilde kaydır
      const numDays = new Date(y, m + 1, 0).getDate();
      const todayIso = isoDateLocal(now);
      let html = '';
      for (let i = 0; i < firstIdx; i++) html += '<div class="cns-cal-cell cns-cal-cell-empty"></div>';
      for (let day = 1; day <= numDays; day++) {
        const iso = `${y}-${pad2(m + 1)}-${pad2(day)}`;
        const status = dayStatus(iso, todayIso, calendarState.availability[iso]);
        const clickable = status === 'green';
        const isActive = iso === state.date;
        const dot = status === 'green' ? '<span class="cns-dot cns-dot-green"></span>' : status === 'red' ? '<span class="cns-dot cns-dot-red"></span>' : '';
        html += `<button type="button" class="cns-cal-cell${clickable ? ' cns-cal-clickable' : ' cns-cal-disabled'}${isActive ? ' active' : ''}" data-date="${iso}"${clickable ? '' : ' disabled'}><span>${day}</span>${dot}</button>`;
      }
      calGridEl.innerHTML = html;
      const curKey = now.getFullYear() * 12 + now.getMonth();
      calPrevBtn.disabled = (y * 12 + m) <= curKey;
    }

    async function loadAvailabilityForMonth(y, m) {
      const seq = ++availReqSeq;
      const from = `${y}-${pad2(m + 1)}-01`;
      const to = `${y}-${pad2(m + 1)}-${pad2(new Date(y, m + 1, 0).getDate())}`;
      let booked = {};
      try {
        const res = await fetch(`/api/consultations/availability?hostSlug=${encodeURIComponent(state.hostSlug)}&from=${from}&to=${to}`);
        const data = res.ok ? await res.json() : {};
        booked = data.booked || {};
      } catch {}
      if (seq !== availReqSeq) return; // ay hızlıca değiştirildiyse eski yanıt yok sayılır
      calendarState.availability = booked;
      renderCalendarMonth();
    }

    function shiftMonth(delta) {
      calendarState.month += delta;
      if (calendarState.month < 0) { calendarState.month = 11; calendarState.year--; }
      else if (calendarState.month > 11) { calendarState.month = 0; calendarState.year++; }
      loadAvailabilityForMonth(calendarState.year, calendarState.month);
    }
    calPrevBtn.addEventListener('click', () => shiftMonth(-1));
    calNextBtn.addEventListener('click', () => shiftMonth(1));

    calGridEl.addEventListener('click', (e) => {
      const cell = e.target.closest('.cns-cal-clickable');
      if (!cell) return;
      state.date = cell.dataset.date;
      state.time = null;
      calGridEl.querySelectorAll('.cns-cal-cell').forEach((el) => el.classList.toggle('active', el === cell));
      renderTimeRowForSelectedDate();
      refreshContinueState();
    });

    function renderTimeRowForSelectedDate() {
      if (!state.date) {
        timeLabelEl.style.display = 'none';
        timeRowEl.style.display = 'none';
        timeRowEl.innerHTML = '';
        return;
      }
      const booked = calendarState.availability[state.date] || [];
      const cutoffMs = Date.now() + MIN_NOTICE_MS;
      timeRowEl.innerHTML = ALLOWED_TIMES.map((t) => {
        const slotMs = new Date(`${state.date}T${t}:00`).getTime();
        const isBooked = booked.includes(t);
        const tooSoon = slotMs < cutoffMs;
        const disabled = isBooked || tooSoon;
        const cls = ['cns-time-chip'];
        if (state.time === t) cls.push('active');
        if (isBooked) cls.push('cns-time-taken');
        return `<button type="button" class="${cls.join(' ')}" data-time="${t}"${disabled ? ' disabled' : ''}>${t}</button>`;
      }).join('');
      timeLabelEl.style.display = '';
      timeRowEl.style.display = '';
    }

    timeRowEl.addEventListener('click', (e) => {
      const chip = e.target.closest('.cns-time-chip');
      if (!chip || chip.disabled) return;
      state.time = chip.dataset.time;
      timeRowEl.querySelectorAll('.cns-time-chip').forEach(el => el.classList.toggle('active', el === chip));
      refreshContinueState();
    });

    function refreshContinueState() {
      continueBtn.disabled = !(state.date && state.time);
    }

    function showScreen(name) {
      bookScreen.style.display = name === 'book' ? '' : 'none';
      payScreen.style.display = name === 'pay' ? '' : 'none';
      successScreen.style.display = name === 'success' ? '' : 'none';
    }

    function showPayScreen() {
      payDateEl.textContent = formatDateTr(state.date);
      payTimeEl.textContent = state.time;
      payPriceEl.textContent = formatPriceTr(CONSULTATION_PRICE_TRY);
      payAmountEl.textContent = formatPriceTr(CONSULTATION_PRICE_TRY);
      if (!nameInput.value && prefill.name) nameInput.value = prefill.name;
      if (!emailInput.value && prefill.email) emailInput.value = prefill.email;
      notice.textContent = '';
      notice.classList.remove('show', 'success');
      confirmBtn.disabled = false;
      confirmBtn.textContent = CONFIRM_BTN_LABEL;
      showScreen('pay');
    }

    function showSuccessScreen() {
      successSummaryEl.textContent = `Randevu: ${formatDateTr(state.date)} · ${state.time}`;
      // Kullanıcı isteği, 2026-09-06 — metin BİREBİR bu kalıpla eşleşmeli.
      successTextEl.textContent = `${state.hostName} ile ${formatDateTr(state.date)} saat ${state.time}'te görüşmeniz onaylanmıştır. Görüşmeye katılabileceğiniz toplantı linki e-posta adresinize iletilecektir.`;
      // "yalnızca 1 kez" limiti (kullanıcı isteği, 2026-09-06) — sunucu zaten reddeder, burası
      // yalnızca UI'da butonu gizler ki kullanıcı boşuna denemesin.
      rescheduleBtn.style.display = state.hasRescheduled ? 'none' : '';
      showScreen('success');
    }

    continueBtn.addEventListener('click', async () => {
      if (!state.date || !state.time) return;
      bookNotice.classList.remove('show', 'success');
      bookNotice.textContent = '';
      if (state.requestId) {
        // Yeniden planlama — ödeme adımı tekrarlanmaz, mevcut talebin tarih/saati güncellenir.
        continueBtn.disabled = true;
        continueBtn.textContent = 'Kaydediliyor…';
        try {
          const res = await fetch(`/api/consultations/${encodeURIComponent(state.requestId)}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: state.date, time: state.time }),
          });
          if (res.status === 401) { window.location.href = '/giris'; return; }
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            bookNotice.textContent = data.error || 'Güncellenemedi, tekrar dene.';
            bookNotice.classList.add('show');
            return;
          }
          state.hasRescheduled = true;
          showSuccessScreen();
        } catch {
          bookNotice.textContent = 'Sunucuya ulaşılamadı, lütfen tekrar dene.';
          bookNotice.classList.add('show');
        } finally {
          continueBtn.disabled = false;
          continueBtn.textContent = 'Devam Et';
        }
        return;
      }
      showPayScreen();
    });
    backBtn.addEventListener('click', () => showScreen('book'));

    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(HAVALE_IBAN_RAW);
        const original = copyBtn.textContent;
        copyBtn.textContent = 'Kopyalandı';
        setTimeout(() => { copyBtn.textContent = original; }, 1500);
      } catch {}
    });

    confirmBtn.addEventListener('click', async () => {
      const contactName = nameInput.value.trim();
      const contactEmail = emailInput.value.trim();
      const contactPhone = phoneInput.value.trim();
      notice.classList.remove('show', 'success');
      if (!contactName || !contactEmail || !contactPhone) {
        notice.textContent = 'Ad soyad, e-posta ve telefon numarası gerekli.';
        notice.classList.add('show');
        return;
      }
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Gönderiliyor…';
      try {
        const res = await fetch('/api/consultations', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hostSlug: state.hostSlug, date: state.date, time: state.time,
            contactName, contactEmail, contactPhone, note: noteInput.value.trim(),
          }),
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
        state.requestId = data.id;
        showSuccessScreen();
      } catch {
        notice.textContent = 'Sunucuya ulaşılamadı, lütfen tekrar dene.';
        notice.classList.add('show');
        confirmBtn.disabled = false;
        confirmBtn.textContent = CONFIRM_BTN_LABEL;
      }
    });

    // Mevcut randevunun ayına atla ki kullanıcı "neyi değiştiriyorum" bağlamını kaybetmesin —
    // hem başarı ekranındaki "Görüşme Tarihini Değiştir" butonundan (rescheduleBtn) HEM DE
    // ConsultationDetailModal'ın "Tarihi Değiştir" butonundan (bkz. openReschedule, kullanıcı
    // isteği 2026-09-06) aynı takvim ekranına girilir.
    function enterRescheduleCalendar() {
      const targetY = state.date ? parseInt(state.date.slice(0, 4), 10) : new Date().getFullYear();
      const targetM = state.date ? parseInt(state.date.slice(5, 7), 10) - 1 : new Date().getMonth();
      calendarState.year = targetY;
      calendarState.month = targetM;
      bookNotice.classList.remove('show', 'success');
      bookNotice.textContent = '';
      renderTimeRowForSelectedDate();
      refreshContinueState();
      loadAvailabilityForMonth(targetY, targetM);
      showScreen('book');
    }
    rescheduleBtn.addEventListener('click', enterRescheduleCalendar);
    successCloseBtn.addEventListener('click', close);

    popupApi = {
      open({ hostSlug, hostName }) {
        state.hostSlug = hostSlug;
        state.hostName = hostName;
        state.requestId = null;
        state.date = null;
        state.time = null;
        state.hasRescheduled = false;
        const now = new Date();
        calendarState.year = now.getFullYear();
        calendarState.month = now.getMonth();
        calendarState.availability = {};
        titleEl.textContent = `${hostName} ile Görüşme`;
        introEl.textContent = `${hostName}; mimarlık kariyeri, portföy geliştirme ve dijital ürün/yayıncılık alanlarında birebir online mentörlük görüşmesi sunar.`;
        nameInput.value = '';
        emailInput.value = '';
        phoneInput.value = '';
        noteInput.value = '';
        bookNotice.classList.remove('show', 'success');
        bookNotice.textContent = '';
        renderTimeRowForSelectedDate();
        refreshContinueState();
        showScreen('book');
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
        loadAvailabilityForMonth(calendarState.year, calendarState.month);
        // İsim/e-posta ön doldurma (best-effort) — hesapta kayıtlıysa kullanıcı ödeme ekranında
        // tekrar yazmasın. Başarısız olursa alanlar boş kalır, akış hiçbir şekilde engellenmez.
        fetch('/api/auth/me').then(r => (r.ok ? r.json() : null)).then(d => {
          if (d && d.user) prefill = { name: d.user.name || '', email: d.user.email || '' };
        }).catch(() => {});
      },
      // ConsultationDetailModal'ın "Tarihi Değiştir" butonundan çağrılır (kullanıcı isteği,
      // 2026-09-06) — bildirime tıklayınca açılan detay ekranından DOĞRUDAN yeniden planlama
      // takvimine girer, "Danışmanlık Al"ı baştan açmaz. state.requestId dolu olduğundan
      // continueBtn'in click handler'ı zaten PATCH /api/consultations/:id dalına gider.
      openReschedule({ requestId, hostSlug, hostName, date, time, hasRescheduled }) {
        state.hostSlug = hostSlug;
        state.hostName = hostName;
        state.requestId = requestId;
        state.date = date || null;
        state.time = time || null;
        state.hasRescheduled = !!hasRescheduled;
        titleEl.textContent = `${hostName} ile Görüşme`;
        introEl.textContent = 'Randevu tarihini değiştirmek için yeni bir gün ve saat seç.';
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
        enterRescheduleCalendar();
      },
    };
    return popupApi;
  }

  return {
    open(opts) { ensurePopup().open(opts); },
    openReschedule(opts) { ensurePopup().openReschedule(opts); },
  };
})();
