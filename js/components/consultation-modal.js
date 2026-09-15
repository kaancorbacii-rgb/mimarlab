// ConsultationModal — "Danışmanlık Al" (kullanıcı isteği, 2026-09-05): kişi popup'ının başlığında
// Mesajlaşma ile Takip Et arasında, ŞİMDİLİK YALNIZCA "kaan-corbaci" profilinde (bkz.
// architect-modal.js#renderItem — a.slug kapısı) görünen bir buton, tıklanınca açık olan
// ArchitectModal'ın (ModalShell) ÜSTÜNDE ikinci bir bağımsız overlay açar.
//
// Desen rating-widget.js#ensureRatePopup İLE (eski info-modal.js#ensureRozetPayPopup da aynıydı, kaldırıldı)
// AYNI: singleton, document.body'ye TEK seferlik enjekte edilen, z-index 400 (ModalShell'in
// overlay'i 150'de kalır) sabit konumlu bir overlay — ModalShell ikinci bir içeriği kendi
// içinde AÇAMADIĞINDAN (tek paylaşılan singleton) bu şekilde kendi DOM'unu taşır. Aynı temizlik
// kuralı: alttaki ModalShell popup'ı (X, geri tuşu, başka popup'a geçiş) kapanırsa
// 'mimarlab-modal-closed' olayını dinleyip bu overlay'i de kapatır — aksi halde body.overflow
// 'hidden'da asılı kalır (bkz. o iki dosyadaki AYNI gerçek bulgu).
//
// Ödeme ekranının işaretleme/CSS'i (kullanıcı isteği: "Rozet Al ödeme ekranının BİREBİR AYNISI")
// (kaldırılan) info-modal.js#ensureRozetPayPopup'taki .rozet-pay-* kurallarının DEĞER BAZINDA kopyasıydı
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
  // ÖDEME ADIMI GERİ GELDİ (kullanıcı isteği, 2026-09-13: "Danışmanlık Al ekranı için ödeme
  // seçeneklerini geri getir"). 2026-09-08'de ("şimdilik ödeme almıyoruz; IBAN bilgilerini siteden
  // sil") kaldırılmıştı; artık DÖRT ekran var: takvim (book) -> iletişim (pay) -> ödeme (payment)
  // -> onay (success).
  //
  // AKIŞ SIRASI KULLANICI KARARIDIR ("önce talep, sonra ödeme"): "Talebi Gönder" talebi GERÇEKTEN
  // açar ve slot'u tutar; ödeme ekranı ondan SONRA gelir. Yani ödeme yarıda kalsa bile randevu
  // kaybolmaz — ödeme daha sonra ConsultationDetailModal'daki "Ödeme Yap" düğmesinden tamamlanır
  // (bkz. consultation-detail-modal.js#paymentHtml, AYNI iki seçenek).
  //
  // İKİ SEÇENEK, İKİSİ DE SUNUCUDAN GELEN BAYRAĞA BAĞLI: kart (iyzico hosted Checkout Form) ve
  // havale/EFT. Hangisinin görüneceğini İSTEMCİ KARAR VERMEZ — sunucu, ilgili sırlar tanımlıysa
  // data.payment.iyzico / data.payment.bankTransfer bayrağını true döner (bkz. src/routes/
  // consultations.js#paymentOptions). IBAN da bu yanıtla gelir, KAYNAK KODDA SABİT DEĞİLDİR
  // (2026-09-08'deki "IBAN'ı siteden sil" isteğinin tekrar etmemesi için — bkz. src/lib/
  // bankTransfer.js dosya başı gerekçe).
  //
  // "Ödemeyi Yaptım" bir BEYANDIR, doğrulama değil: sunucu payment_status'u 'declared' yapar,
  // 'paid' YAPMAZ. Kart ödemesinde bile talep otomatik onaylanmaz — Meet odası yalnızca admin
  // onayında kurulur (bkz. src/lib/consultationMeet.js).
  // TEKLİF ARTIK DANIŞMAN BAŞINA (kullanıcı isteği, 2026-09-15: her danışman kendi süresini,
  // ücretini ve uygun gün/saatlerini seçer). Aşağıdakiler yalnızca VARSAYILANDIR ve iki durumda
  // kullanılır: (a) çağıran bir teklif geçirmediyse, (b) uygunluk yanıtı henüz gelmediyse.
  // Gerçek teklif `state.offer`dadır; kaynağı ya çağıran (kişi pop-up'ı / danismanlik.html) ya da
  // GET /api/consultations/availability yanıtının `offer` alanıdır. Sunucu HER ZAMAN bağımsız
  // olarak yeniden doğrular (bkz. consultations.js#isAllowedSlot) — istemciye güvenilmez.
  const DEFAULT_WEEKDAYS = [1, 3, 5];
  const DEFAULT_TIMES = ['18:00', '19:00', '20:00'];
  const DEFAULT_DURATION_MIN = 45;
  const DEFAULT_TZ_LABEL = 'İstanbul (GMT+3)';
  const TZ_LABELS = { 'Europe/Istanbul': DEFAULT_TZ_LABEL };
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
  function dayStatus(dateIso, todayIso, bookedTimes, offer) {
    if (dateIso < todayIso) return 'past';
    const weekdays = (offer && offer.weekdays) || DEFAULT_WEEKDAYS;
    const times = (offer && offer.times) || DEFAULT_TIMES;
    const dow = new Date(`${dateIso}T00:00:00`).getDay();
    if (!weekdays.includes(dow)) return 'red';
    const cutoffMs = Date.now() + MIN_NOTICE_MS;
    const eligible = times.filter((t) => new Date(`${dateIso}T${t}:00`).getTime() >= cutoffMs);
    if (!eligible.length) return 'past'; // bugün/yarın — henüz ilk 24 saat dolmamış
    const free = eligible.filter((t) => !(bookedTimes || []).includes(t));
    return free.length ? 'green' : 'red'; // tamamen dolu
  }

  function formatDateTr(isoDate) {
    const d = new Date(`${isoDate}T00:00:00`);
    if (Number.isNaN(d.getTime())) return isoDate;
    return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
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
        .cns-pay-hint{font-size:12px; color:var(--ink-soft); line-height:1.6; margin:10px 0 0;}
        .cns-pay-notice{display:none; margin-top:14px; padding:12px 14px; border-radius:10px; background:rgba(224,138,62,0.12); border:1px solid var(--accent); color:var(--ink); font-size:12.5px; line-height:1.6;}
        .cns-pay-notice.success{background:rgba(62,122,85,0.12); border-color:#3E7A55;}
        .cns-pay-notice.show{display:block;}
        .cns-success-summary{font-weight:700; font-size:14.5px; margin-bottom:10px;}
        .cns-success-text{font-size:13.5px; line-height:1.6; color:var(--ink); margin:0 0 20px;}
        .cns-btn-outline{width:100%; background:none; color:var(--ink); border:1.5px solid var(--ink); padding:12px; border-radius:100px; font-weight:600; font-size:14px; cursor:pointer; margin-bottom:10px;}
        .cns-btn-outline:hover{border-color:var(--walnut); color:var(--walnut);}
        /* Ödeme ekranı (kullanıcı isteği, 2026-09-13) — yöntem kartları, IBAN kutusu, fatura alanları. */
        .cns-method{display:flex; align-items:flex-start; gap:10px; width:100%; text-align:left; padding:13px 14px; border:1px solid var(--line); border-radius:12px; background:var(--paper); color:var(--ink); font-family:inherit; cursor:pointer; margin-bottom:8px;}
        .cns-method:hover{border-color:var(--walnut);}
        .cns-method.active{border-color:var(--ink); background:var(--paper-alt);}
        .cns-method-radio{flex-shrink:0; width:16px; height:16px; margin-top:1px; border-radius:50%; border:1.5px solid var(--ink-soft); position:relative;}
        .cns-method.active .cns-method-radio{border-color:var(--ink);}
        .cns-method.active .cns-method-radio::after{content:''; position:absolute; inset:3px; border-radius:50%; background:var(--ink);}
        .cns-method-name{font-size:13.5px; font-weight:700;}
        .cns-method-desc{font-size:12px; color:var(--ink-soft); line-height:1.5; margin-top:2px;}
        /* Pasif ödeme yöntemi (kullanıcı isteği, 2026-09-15: kart görünür ama "Henüz aktif
           değil."). Gizlemek YERİNE soluk+tıklanamaz gösterilir — kullanıcı yöntemin var
           olduğunu ama henüz açılmadığını görsün. */
        .cns-method-disabled{opacity:0.55; cursor:not-allowed;}
        .cns-method-disabled:hover{border-color:var(--line);}
        .cns-method-soon{font-weight:600; color:var(--ink-soft);}
        .cns-method-panel{display:none; padding:2px 0 4px;}
        .cns-method-panel.open{display:block;}
        .cns-iban-box{border:1px solid var(--line); border-radius:12px; padding:12px 14px; background:var(--paper-alt); margin-bottom:4px;}
        .cns-iban-row{display:flex; align-items:center; justify-content:space-between; gap:10px; padding:5px 0; font-size:12.5px;}
        .cns-iban-label{color:var(--ink-soft); flex-shrink:0;}
        .cns-iban-value{font-weight:700; text-align:right; word-break:break-all;}
        .cns-iban-copy{background:none; border:1px solid var(--line); border-radius:100px; padding:5px 12px; font-family:inherit; font-size:11.5px; font-weight:600; color:var(--ink); cursor:pointer; margin-top:6px;}
        .cns-iban-copy:hover{background:var(--paper);}
        .cns-pay-later{display:block; width:100%; background:none; border:none; color:var(--ink-soft); font-family:inherit; font-size:12.5px; font-weight:600; text-decoration:underline; cursor:pointer; padding:10px 0 0;}
        .cns-pay-later:hover{color:var(--ink);}
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
          <!-- Metin SABİT DEĞİL: süre ve saat dilimi danışmanın kendi teklifinden gelir
               (applyOfferToUi). Teklif henüz gelmediyse varsayılanla çizilir. -->
          <div class="cns-notice-banner" id="cns-offer-note"></div>
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

          <div class="cns-field-label" style="margin-top:16px;">Ad Soyad</div>
          <div class="cns-contact-field"><input type="text" id="cns-contact-name" autocomplete="name" maxlength="120"></div>
          <div class="cns-field-label">E-posta</div>
          <div class="cns-contact-field"><input type="email" id="cns-contact-email" autocomplete="email" maxlength="120"></div>
          <!-- Telefon (kullanıcı isteği, 2026-09-06 madde 3): SADECE 0 ile başlayan 11 haneli
               Türkiye numarası. Kullanıcı yalnızca rakam yazar (0 + 10 hane), parantez/boşluklar
               maskeyi uygulayan wirePhoneMask() tarafından otomatik eklenir — "0 (531) 881 24 45".
               maxlength maskelenmiş uzunluğa (18 karakter) göre; asıl sınır maskenin kendisidir. -->
          <div class="cns-field-label">Telefon</div>
          <div class="cns-contact-field"><input type="tel" id="cns-contact-phone" autocomplete="tel" inputmode="numeric" maxlength="18" placeholder="0 (5__) ___ __ __"></div>

          <div class="cns-field-label">Görüşme isteği hakkında</div>
          <div class="cns-note-wrap">
            <textarea id="cns-note" maxlength="2000" placeholder="Opsiyonel — konuşmak istediğin konuyu ya da eklemek istediklerini yaz…"></textarea>
          </div>

          <p class="cns-pay-section-hint" style="margin-top:14px;">Bir sonraki adımda ödeme yöntemini seçeceksin. Randevu saatin bu adımda senin için tutulur.</p>

          <!-- Etiket kullanıcı isteğidir (2026-09-15): bu düğme talebi açar VE hemen ardından ödeme
               ekranını gösterir, yani bir sonraki adımın adını taşımalı. Akış değişmedi (önce
               talep, sonra ödeme) — değişen yalnızca kullanıcıya ne söylediği. -->
          <button class="cns-submit" type="button" id="cns-pay-confirm-btn">Ödeme Sayfasına İlerle</button>
          <div class="cns-pay-notice" id="cns-pay-notice"></div>
        </div>

        <!-- ÖDEME EKRANI (kullanıcı isteği, 2026-09-13). Talep ZATEN açılmış durumdadır (bkz. dosya
             başındaki akış notu) — bu ekranda hiçbir şey yapmadan çıkmak randevuyu İPTAL ETMEZ.
             Yöntem kartları ve IBAN kutusu sunucudan gelen bayraklara göre çizilir (renderPayment);
             burada hiçbir hesap bilgisi SABİT DEĞİLDİR. -->
        <div id="cns-screen-payment" style="display:none;">
          <div class="cns-pay-summary-row"><span>Tarih</span><span id="cns-pm-date">—</span></div>
          <div class="cns-pay-summary-row"><span>Saat</span><span id="cns-pm-time">—</span></div>
          <div class="cns-pay-summary-row"><span>Toplam</span><span class="cns-pay-summary-total" id="cns-pm-total">—</span></div>

          <div class="cns-pay-section-title">Ödeme Yöntemi</div>
          <div id="cns-pm-methods"></div>

          <!-- Kart: iyzico'nun ZORUNLU fatura alanları. Kart bilgisi buraya GİRİLMEZ; "Ödemeye Geç"
               iyzico'nun kendi hosted sayfasına üst seviye yönlendirmedir (bkz. src/index.js
               CSP notu — top-level navigation CSP'ye takılmaz). -->
          <div class="cns-method-panel" id="cns-pm-panel-iyzico">
            <p class="cns-pay-section-hint">Kart bilgilerin bu sayfada değil, iyzico'nun güvenli ödeme sayfasında girilir.</p>
            <div class="cns-field-label">Ad</div>
            <div class="cns-contact-field"><input type="text" id="cns-pm-name" autocomplete="given-name" maxlength="100"></div>
            <div class="cns-field-label">Soyad</div>
            <div class="cns-contact-field"><input type="text" id="cns-pm-surname" autocomplete="family-name" maxlength="100"></div>
            <div class="cns-field-label">T.C. Kimlik No</div>
            <div class="cns-contact-field"><input type="text" id="cns-pm-tc" inputmode="numeric" maxlength="11" autocomplete="off"></div>
            <div class="cns-field-label">Fatura Adresi</div>
            <div class="cns-contact-field"><input type="text" id="cns-pm-address" autocomplete="street-address" maxlength="300"></div>
            <div class="cns-field-label">Şehir</div>
            <div class="cns-contact-field"><input type="text" id="cns-pm-city" autocomplete="address-level2" maxlength="80"></div>
          </div>

          <!-- Havale/EFT: IBAN sunucudan gelir (renderPayment), kaynak kodda yoktur. -->
          <div class="cns-method-panel" id="cns-pm-panel-havale">
            <div class="cns-iban-box" id="cns-pm-iban-box"></div>
            <p class="cns-pay-hint">Açıklama alanına <strong id="cns-pm-ref">—</strong> yazmayı unutma. Havaleni aldıktan sonra talebini onaylayıp görüşme odanı hazırlıyoruz.</p>
          </div>

          <button class="cns-submit" type="button" id="cns-pm-submit">Ödemeye Geç</button>
          <button type="button" class="cns-pay-later" id="cns-pm-later">Daha sonra ödeyeceğim</button>
          <div class="cns-pay-notice" id="cns-pm-notice"></div>
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
    const confirmBtn = overlay.querySelector('#cns-pay-confirm-btn');
    const notice = overlay.querySelector('#cns-pay-notice');
    const nameInput = overlay.querySelector('#cns-contact-name');
    const emailInput = overlay.querySelector('#cns-contact-email');
    const phoneInput = overlay.querySelector('#cns-contact-phone');
    const noteInput = overlay.querySelector('#cns-note');
    const successSummaryEl = overlay.querySelector('#cns-success-summary');
    const successTextEl = overlay.querySelector('#cns-success-text');
    const rescheduleBtn = overlay.querySelector('#cns-reschedule-btn');
    const successCloseBtn = overlay.querySelector('#cns-success-close-btn');
    // Ödeme ekranı (kullanıcı isteği, 2026-09-13)
    const paymentScreen = overlay.querySelector('#cns-screen-payment');
    const pmDateEl = overlay.querySelector('#cns-pm-date');
    const pmTimeEl = overlay.querySelector('#cns-pm-time');
    const pmTotalEl = overlay.querySelector('#cns-pm-total');
    const pmMethodsEl = overlay.querySelector('#cns-pm-methods');
    const pmPanels = { iyzico: overlay.querySelector('#cns-pm-panel-iyzico'), havale: overlay.querySelector('#cns-pm-panel-havale') };
    const pmIbanBox = overlay.querySelector('#cns-pm-iban-box');
    const pmRefEl = overlay.querySelector('#cns-pm-ref');
    const pmSubmitBtn = overlay.querySelector('#cns-pm-submit');
    const pmLaterBtn = overlay.querySelector('#cns-pm-later');
    const pmNotice = overlay.querySelector('#cns-pm-notice');
    const offerNoteEl = overlay.querySelector('#cns-offer-note');
    const pmNameInput = overlay.querySelector('#cns-pm-name');
    const pmSurnameInput = overlay.querySelector('#cns-pm-surname');
    const pmTcInput = overlay.querySelector('#cns-pm-tc');
    const pmAddressInput = overlay.querySelector('#cns-pm-address');
    const pmCityInput = overlay.querySelector('#cns-pm-city');
    const CONFIRM_BTN_LABEL = 'Ödeme Sayfasına İlerle';

    // ---------------------------------------------------------------------------------------
    // Telefon maskesi (kullanıcı isteği, 2026-09-06 madde 3): "sadece 11 haneli, başında 0 olan
    // telefon numarası girilebilsin ... kullanıcı parantez işareti yapmasın, bu parantez otomatik
    // gelsin. Kişi sadece 0'la beraber diğer 10 haneyi girsin."
    //
    // Tek doğruluk kaynağı RAKAMLARDIR: her girdi olayında değerdeki rakam olmayan her karakter
    // atılır, baştaki 0 yoksa eklenir (kullanıcı doğrudan "531..." yazarsa da numara geçerli olur),
    // 11 haneye kırpılır ve maske yeniden çizilir. Böylece yapıştırma (+90 5xx, 0090..., boşluklu
    // biçimler) ve tek tek yazma AYNI koddan geçer.
    const PHONE_DIGITS = 11;
    function phoneDigitsOf(value) {
      let d = (value || '').replace(/\D/g, '');
      // Ülke kodlu yapıştırmalar: "+90 531...", "0090531..." → yerel biçime indirgenir.
      if (d.startsWith('0090')) d = d.slice(4);
      else if (d.startsWith('90') && d.length > PHONE_DIGITS) d = d.slice(2);
      if (d && d[0] !== '0') d = '0' + d;
      return d.slice(0, PHONE_DIGITS);
    }
    function formatPhone(digits) {
      if (!digits) return '';
      let out = digits[0]; // her zaman '0'
      if (digits.length > 1) out += ' (' + digits.slice(1, 4);
      if (digits.length >= 4) out += ')';
      if (digits.length > 4) out += ' ' + digits.slice(4, 7);
      if (digits.length > 7) out += ' ' + digits.slice(7, 9);
      if (digits.length > 9) out += ' ' + digits.slice(9, 11);
      return out;
    }
    // İmleci "kaçıncı rakamdaydım" bilgisine göre yeniden konumlandırır — aksi halde numaranın
    // ortasına bir rakam eklemek imleci her seferinde sonuna fırlatırdı.
    function caretForDigitIndex(formatted, digitIndex) {
      if (digitIndex <= 0) return 0;
      let seen = 0;
      for (let i = 0; i < formatted.length; i++) {
        if (/\d/.test(formatted[i])) {
          seen++;
          if (seen === digitIndex) return i + 1;
        }
      }
      return formatted.length;
    }
    function wirePhoneMask(input) {
      input.addEventListener('input', () => {
        const caret = input.selectionStart || 0;
        const raw = input.value;
        const digitsBeforeCaret = raw.slice(0, caret).replace(/\D/g, '').length;
        const digits = phoneDigitsOf(raw);
        const formatted = formatPhone(digits);
        if (formatted === raw) return;
        // Baştaki 0 kullanıcı yazmadığı hâlde eklendiyse imleç de bir rakam ileri kaymalı.
        const prefixed = digitsBeforeCaret > 0 && raw.replace(/\D/g, '')[0] !== '0';
        input.value = formatted;
        const target = caretForDigitIndex(formatted, digitsBeforeCaret + (prefixed ? 1 : 0));
        try { input.setSelectionRange(target, target); } catch {}
      });
      // Rakam/düzenleme dışındaki tuşlar hiç girilmesin (mobil klavyede inputmode=numeric zaten
      // sayısal tuş takımını açar; bu satır masaüstünde harf/sembol yazılmasını engeller).
      input.addEventListener('keypress', (e) => {
        if (e.key.length === 1 && !/\d/.test(e.key)) e.preventDefault();
      });
    }
    wirePhoneMask(phoneInput);

    // payment: sunucudan gelen ödeme seçenekleri (bkz. src/routes/consultations.js#paymentOptions);
    // paymentDeclared: bu oturumda havale beyanı verildi mi (yalnızca onay metnini değiştirir).
    const state = { hostSlug: null, hostName: null, requestId: null, date: null, time: null, hasRescheduled: false, payment: null, paymentDeclared: false, offer: null };
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
    // body.overflow'u 'hidden'da kilitli bırakmasın diye rating-widget.js#ensureRatePopup İLE AYNI temizlik.
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
        const status = dayStatus(iso, todayIso, calendarState.availability[iso], state.offer);
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
        // Teklif, uygunluk yanıtında da gelir — "Tarihi Değiştir" gibi çağıranın teklifi elinde
        // OLMADIĞI yollarda takvim yine danışmanın kendi gün/saatleriyle çizilsin diye.
        if (data.offer) { state.offer = data.offer; applyOfferToUi(); }
      } catch {}
      if (seq !== availReqSeq) return; // ay hızlıca değiştirildiyse eski yanıt yok sayılır
      calendarState.availability = booked;
      renderCalendarMonth();
      renderTimeRowForSelectedDate();
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

    // Teklife bağlı TÜM metin/alanları tek noktadan tazeler. İki yerden çağrılır: open()/
    // openReschedule() (çağıran teklifi biliyorsa) ve uygunluk yanıtı geldiğinde (bilmiyorsa).
    function applyOfferToUi() {
      const o = state.offer || {};
      const duration = o.durationMin || DEFAULT_DURATION_MIN;
      const tz = TZ_LABELS[o.timezone] || DEFAULT_TZ_LABEL;
      if (offerNoteEl) offerNoteEl.textContent = `Görüşme süresi ${duration} dakikadır. Saatler ${tz} zaman dilimine göredir.`;
    }

    function renderTimeRowForSelectedDate() {
      if (!state.date) {
        timeLabelEl.style.display = 'none';
        timeRowEl.style.display = 'none';
        timeRowEl.innerHTML = '';
        return;
      }
      const booked = calendarState.availability[state.date] || [];
      const cutoffMs = Date.now() + MIN_NOTICE_MS;
      const offerTimes = (state.offer && state.offer.times) || DEFAULT_TIMES;
      timeRowEl.innerHTML = offerTimes.map((t) => {
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
      paymentScreen.style.display = name === 'payment' ? '' : 'none';
      successScreen.style.display = name === 'success' ? '' : 'none';
    }

    function showPayScreen() {
      payDateEl.textContent = formatDateTr(state.date);
      payTimeEl.textContent = state.time;
      if (!nameInput.value && prefill.name) nameInput.value = prefill.name;
      if (!emailInput.value && prefill.email) emailInput.value = prefill.email;
      notice.textContent = '';
      notice.classList.remove('show', 'success');
      confirmBtn.disabled = false;
      confirmBtn.textContent = CONFIRM_BTN_LABEL;
      showScreen('pay');
    }

    // ---------------------------------------------------------------------------------------
    // ÖDEME EKRANI (kullanıcı isteği, 2026-09-13)
    // ---------------------------------------------------------------------------------------
    // state.payment sunucudan gelir (POST /api/consultations yanıtı) ve HANGİ YÖNTEMLERİN
    // sunulabileceğini o söyler — istemci bir yöntemi kendi başına "açık" sayamaz. Hiçbir yöntem
    // yapılandırılmamışsa ödeme ekranı HİÇ gösterilmez ve akış doğrudan onaya geçer (2026-09-08
    // sonrası hâliyle AYNI davranış), yani sırlar tanımlanana kadar özellik BOZULMAZ.

    let pmMethod = null;

    function formatTry(n) {
      return `${Number(n).toLocaleString('tr-TR')} ₺`;
    }

    // SIRA KULLANICI İSTEĞİDİR (2026-09-15): "1- Havele / Eft  2- Kart ile Ödeme (Henüz aktif
    // değil.)" — havale önce, kart sonra ve pasif.
    const PM_LABELS = {
      havale: { name: 'Havale / EFT', desc: 'IBAN\'a transfer et, ardından "Ödemeyi Yaptım"a bas.' },
      iyzico: { name: 'Kart ile Ödeme', desc: 'iyzico güvenli ödeme sayfasında tek çekim.' },
    };
    const PM_ORDER = ['havale', 'iyzico'];

    // Her yöntemin ÇİZİLİP çizilmeyeceği ile SEÇİLEBİLİR olup olmadığı AYRI sorulardır (kullanıcı
    // isteği: kart görünsün ama "Henüz aktif değil."). Kapı sunucudadır — `iyzico` bayrağı
    // consultations.js#IYZICO_ENABLED'a bakar ve o kapalıyken sunucu yöntemi ayrıca REDDEDER;
    // buradaki pasiflik yalnızca kullanıcıya doğru şeyi göstermek içindir.
    function methodEntries() {
      const p = state.payment || {};
      return PM_ORDER.map((m) => {
        if (m === 'havale') {
          return { method: m, enabled: !!p.bankTransfer, note: p.bankTransfer ? '' : 'Şu anda kullanılamıyor.' };
        }
        // iyzicoComingSoon: sunucunun "ürün kararı olarak kapalı" sinyali. Eski yanıtlarda bu alan
        // hiç olmayabilir — o durumda `iyzico` bayrağı ne diyorsa o geçerli (davranış bozulmaz).
        const comingSoon = p.iyzicoComingSoon === undefined ? !p.iyzico : !!p.iyzicoComingSoon;
        return { method: m, enabled: !!p.iyzico, note: comingSoon ? 'Henüz aktif değil.' : (p.iyzico ? '' : 'Şu anda kullanılamıyor.') };
      });
    }
    function availableMethods() {
      return methodEntries().filter(e => e.enabled).map(e => e.method);
    }

    function selectMethod(method) {
      pmMethod = method;
      pmMethodsEl.querySelectorAll('.cns-method').forEach((el) => {
        el.classList.toggle('active', el.dataset.method === method);
      });
      Object.entries(pmPanels).forEach(([k, el]) => el.classList.toggle('open', k === method));
      // Buton metni yönteme göre değişir: kartta bir SONRAKİ adım (iyzico sayfası) vardır, havalede
      // ise basılan şey bir BEYANDIR — metin bunu gizlememeli.
      pmSubmitBtn.textContent = method === 'havale' ? 'Ödemeyi Yaptım' : 'Ödemeye Geç';
      pmSubmitBtn.disabled = false;
      pmNotice.classList.remove('show', 'success');
      pmNotice.textContent = '';
    }

    function renderPayment() {
      const entries = methodEntries();
      const methods = entries.filter(e => e.enabled).map(e => e.method);
      pmMethodsEl.innerHTML = entries.map(({ method: m, enabled, note }) => `
        <button type="button" class="cns-method${enabled ? '' : ' cns-method-disabled'}" data-method="${m}"${enabled ? '' : ' disabled aria-disabled="true"'}>
          <span class="cns-method-radio"></span>
          <span><span class="cns-method-name">${PM_LABELS[m].name}${note ? ` <span class="cns-method-soon">(${note})</span>` : ''}</span><span class="cns-method-desc">${PM_LABELS[m].desc}</span></span>
        </button>`).join('');

      const account = (state.payment && state.payment.account) || null;
      if (account) {
        // textContent değil innerHTML kullanılıyor ama içerik SUNUCUDAN, sabit alanlardan gelir;
        // yine de kaçış yapılır — hesap adı bir gün panelden düzenlenebilir hâle gelirse burası
        // sessizce bir XSS yüzeyi olmasın.
        const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        pmIbanBox.innerHTML = `
          <div class="cns-iban-row"><span class="cns-iban-label">Alıcı</span><span class="cns-iban-value">${esc(account.accountName)}</span></div>
          ${account.bankName ? `<div class="cns-iban-row"><span class="cns-iban-label">Banka</span><span class="cns-iban-value">${esc(account.bankName)}</span></div>` : ''}
          <div class="cns-iban-row"><span class="cns-iban-label">IBAN</span><span class="cns-iban-value" id="cns-pm-iban">${esc(account.iban)}</span></div>
          <button type="button" class="cns-iban-copy" id="cns-pm-iban-copy">IBAN'ı Kopyala</button>`;
        const copyBtn = pmIbanBox.querySelector('#cns-pm-iban-copy');
        copyBtn.addEventListener('click', () => {
          // navigator.clipboard güvenli olmayan bağlamda/izin reddinde yoktur ya da atar — IBAN
          // zaten ekranda YAZILI olduğundan kopyalama başarısız olsa bile kullanıcı elle alabilir;
          // bu yüzden hata akışı kesmez, buton yalnızca metnini değiştirmez.
          const write = navigator.clipboard && navigator.clipboard.writeText
            ? navigator.clipboard.writeText(account.iban) : Promise.reject();
          write.then(() => {
            copyBtn.textContent = 'Kopyalandı';
            setTimeout(() => { copyBtn.textContent = "IBAN'ı Kopyala"; }, 2000);
          }).catch(() => { copyBtn.textContent = 'Kopyalanamadı — elle seç'; });
        });
      }
      // Havale açıklamasına yazılacak referans: talep kimliğinin ilk 8 hanesi (UUID). Admin bunu
      // ekstrede görüp doğru talebi eşleştirir; tam kimlik gerekmez ve kısası yazım hatasına daha
      // kapalıdır.
      pmRefEl.textContent = state.requestId ? String(state.requestId).slice(0, 8).toUpperCase() : '—';

      pmMethodsEl.querySelectorAll('.cns-method').forEach((el) => {
        if (el.disabled) return; // pasif seçenek (ör. "Henüz aktif değil.") seçilemez
        el.addEventListener('click', () => selectMethod(el.dataset.method));
      });
      // Tek AKTİF yöntem varsa seçim diye bir şey yoktur — kullanıcıyı gereksiz bir tıklamaya
      // zorlamadan doğrudan seçili gelir. Hiç aktif yöntem yoksa gönder düğmesi kapalı kalır.
      if (methods.length) {
        selectMethod(methods[0]);
      } else {
        pmMethod = null;
        pmSubmitBtn.disabled = true;
        pmSubmitBtn.textContent = 'Ödeme şu anda alınamıyor';
      }
    }

    function showPaymentScreen() {
      pmDateEl.textContent = formatDateTr(state.date);
      pmTimeEl.textContent = state.time;
      pmTotalEl.textContent = formatTry((state.payment && state.payment.priceTry) || 0);
      // Kart alanları: iletişim adımında girilen ad soyad ikiye bölünerek ön doldurulur (son kelime
      // soyad) — kullanıcı düzeltebilir, sunucu zaten kendi doğrulamasını yapar.
      if (!pmNameInput.value && !pmSurnameInput.value) {
        const parts = (nameInput.value || '').trim().split(/\s+/).filter(Boolean);
        if (parts.length > 1) {
          pmSurnameInput.value = parts.pop();
          pmNameInput.value = parts.join(' ');
        } else if (parts.length === 1) {
          pmNameInput.value = parts[0];
        }
      }
      renderPayment();
      showScreen('payment');
    }

    // "Daha sonra ödeyeceğim" — talep ZATEN açık olduğu için bu bir iptal DEĞİLDİR; ödeme, bildirim
    // kutusundan açılan görüşme detayındaki "Ödeme Yap" düğmesinden tamamlanır (bkz.
    // consultation-detail-modal.js). Onay ekranının metni de bu duruma göre değişir.
    pmLaterBtn.addEventListener('click', () => showSuccessScreen());

    pmSubmitBtn.addEventListener('click', async () => {
      if (!pmMethod || !state.requestId) return;
      pmNotice.classList.remove('show', 'success');
      const payload = { method: pmMethod === 'havale' ? 'havale' : 'iyzico' };
      if (pmMethod === 'iyzico') {
        payload.name = pmNameInput.value.trim();
        payload.surname = pmSurnameInput.value.trim();
        payload.identityNumber = pmTcInput.value.trim();
        payload.address = pmAddressInput.value.trim();
        payload.city = pmCityInput.value.trim();
        payload.phone = phoneInput.value.trim();
        if (!payload.name || !payload.surname || !payload.identityNumber || !payload.address || !payload.city) {
          pmNotice.textContent = 'Kart ile ödeme için ad, soyad, T.C. kimlik no, adres ve şehir gerekli.';
          pmNotice.classList.add('show');
          return;
        }
      }
      const label = pmSubmitBtn.textContent;
      pmSubmitBtn.disabled = true;
      pmSubmitBtn.textContent = 'Gönderiliyor…';
      try {
        const res = await fetch(`/api/consultations/${encodeURIComponent(state.requestId)}/payment`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.status === 401) { window.location.href = '/giris'; return; }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          pmNotice.textContent = data.error || 'Ödeme başlatılamadı, tekrar dene.';
          pmNotice.classList.add('show');
          pmSubmitBtn.disabled = false;
          pmSubmitBtn.textContent = label;
          return;
        }
        if (data.paymentPageUrl) {
          // iyzico'nun hosted sayfasına ÜST SEVİYE yönlendirme (satin-al.html ile AYNI desen) —
          // kart bilgisi bu siteye hiç girilmez. Dönüşte kullanıcı /hesabim?consultation_payment=…
          // adresine düşer (bkz. src/routes/payments.js#handleCallback).
          window.location.href = data.paymentPageUrl;
          return;
        }
        state.paymentDeclared = true;
        showSuccessScreen();
      } catch {
        pmNotice.textContent = 'Sunucuya ulaşılamadı, lütfen tekrar dene.';
        pmNotice.classList.add('show');
        pmSubmitBtn.disabled = false;
        pmSubmitBtn.textContent = label;
      }
    });

    function showSuccessScreen() {
      successSummaryEl.textContent = `Randevu: ${formatDateTr(state.date)} · ${state.time}`;
      // Kullanıcı isteği, 2026-09-06 — metin BİREBİR bu kalıpla eşleşmeli.
      // GÜNCELLENDİ (2026-09-08): görüşme bağlantısı artık E-POSTAYLA GÖNDERİLMİYOR — ödeme
      // onaylandığında Google Meet odası otomatik oluşturulur ve bildirimle gelen güvenli görüşme
      // odasından (/gorusme/:room_uuid) katılınır (bkz. src/lib/consultationMeet.js). Eski metin
      // hiç gerçekleşmeyen bir e-posta vaat ediyordu.
      // ÖDEME GERİ GELDİĞİNDEN (kullanıcı isteği, 2026-09-13) metin ARTIK "onaylanmıştır" DEMEZ:
      // talep bu noktada 'pending'dir ve onay admin'dedir. Ödeme beyan edildiyse/ertelendiyse
      // kullanıcıya SIRADAKİ adımın ne olduğu söylenir — hiç gerçekleşmeyecek bir onayı vaat eden
      // eski metin, ödemesiz akış için yazılmıştı.
      const base = `${state.hostName} ile ${formatDateTr(state.date)} saat ${state.time} randevu talebin alındı.`;
      const tail = state.paymentDeclared
        ? ' Havaleni aldığımızda talebin onaylanacak ve görüşme odan hazır olduğunda bildirim alacaksın.'
        : (state.payment && (state.payment.iyzico || state.payment.bankTransfer))
          ? " Ödemeni Hesabım > Bildirimler'deki görüşme detayından istediğin zaman tamamlayabilirsin; ödemen alındıktan sonra talebin onaylanır."
          : " Talebin onaylandığında görüşme odan Hesabım > Bildirimler'e düşer.";
      successTextEl.textContent = base + tail;
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
        // Yeniden planlama — iletişim adımı tekrarlanmaz, mevcut talebin tarih/saati güncellenir.
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
      // bkz. wirePhoneMask — maske eksik bir numarayı ("0 (531) 88") engellemez, yalnızca biçimler;
      // tam 11 hane kontrolü burada yapılır.
      if (phoneDigitsOf(contactPhone).length !== PHONE_DIGITS) {
        notice.textContent = 'Telefon numarası 0 ile başlayan 11 haneli olmalı — örn. 0 (531) 881 24 45.';
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
        // Talep açıldı ve slot tutuldu — ARDINDAN HER ZAMAN ÖDEME EKRANI (kullanıcı isteği,
        // 2026-09-15: "bu butona tıklayınca ödeme ekranı açılsın. 2 tane ödeme seçeneği çıksın").
        // Eskiden bu koşul "sunucu en az bir yöntem sunuyorsa" idi; kart artık bilinçli olarak
        // KAPALI olduğundan (IYZICO_ENABLED=false) o koşul, havale de yapılandırılmamışsa ekranı
        // tamamen atlar ve kullanıcı istediği iki seçeneği HİÇ göremezdi. Hiçbir yöntem aktif
        // değilse ekran yine açılır ama gönder düğmesi kapalıdır (bkz. renderPayment) — kullanıcı
        // "Daha sonra ödeyeceğim" ile geçebilir.
        state.payment = data.payment || null;
        state.paymentDeclared = false;
        if (state.payment) {
          showPaymentScreen();
        } else {
          showSuccessScreen();
        }
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
      open({ hostSlug, hostName, intro, offer }) {
        state.hostSlug = hostSlug;
        state.hostName = hostName;
        // Teklif çağırandan gelir (kişi pop-up'ı ve /danismanlik ikisi de biliyor). Gelmezse
        // uygunluk yanıtındaki `offer` devralır — bkz. loadAvailabilityForMonth.
        state.offer = offer || null;
        state.requestId = null;
        state.date = null;
        state.time = null;
        state.hasRescheduled = false;
        state.payment = null;
        state.paymentDeclared = false;
        const now = new Date();
        calendarState.year = now.getFullYear();
        calendarState.month = now.getMonth();
        calendarState.availability = {};
        titleEl.textContent = `${hostName} ile Görüşme`;
        // `intro` ÇAĞIRANDAN gelebilir (danismanlik.html onu GET /api/consultants'tan geçirir —
        // bkz. src/routes/consultations.js#consultationIntro, tanıtım cümlesinin TEK KAYNAĞI).
        // Verilmezse aşağıdaki cümle kullanılır: kişi pop-up'ındaki "Danışmanlık Al" düğmesi
        // (architect-modal.js) hiçbir şey geçirmez, yani onun davranışı DEĞİŞMEDİ. İki cümlenin
        // ayrışmasını scripts/test-2026-09-15-danismanlik-page.mjs kelepçeler.
        introEl.textContent = intro || `${hostName}; mimarlık kariyeri, portföy geliştirme ve dijital ürün/yayıncılık alanlarında birebir online mentörlük görüşmesi sunar.`;
        nameInput.value = '';
        emailInput.value = '';
        phoneInput.value = '';
        noteInput.value = '';
        bookNotice.classList.remove('show', 'success');
        bookNotice.textContent = '';
        applyOfferToUi();
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
      // ConsultationDetailModal'ın "Ödeme Yap" düğmesinden çağrılır (kullanıcı isteği, 2026-09-13):
      // talep zaten açık, takvim/iletişim adımları geçilmiş — DOĞRUDAN ödeme ekranına girilir.
      // Seçenekler ve havale hesabı ÇAĞIRANDAN gelir, çünkü onları sunucudan okuyan GET
      // /api/consultations/:id yanıtını zaten detay ekranı elinde tutar (ikinci bir istek atmaya
      // gerek yok ve IBAN yine yalnızca sunucudan, yalnızca talebin sahibine gelmiş olur).
      openPayment({ requestId, hostSlug, hostName, date, time, payment }) {
        state.hostSlug = hostSlug;
        state.hostName = hostName;
        state.requestId = requestId;
        state.date = date || null;
        state.time = time || null;
        state.payment = payment || null;
        state.paymentDeclared = false;
        titleEl.textContent = `${hostName} ile Görüşme`;
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
        showPaymentScreen();
      },
      openReschedule({ requestId, hostSlug, hostName, date, time, hasRescheduled, offer }) {
        state.hostSlug = hostSlug;
        state.hostName = hostName;
        // Detay ekranı teklifi bilmeyebilir; bilmiyorsa uygunluk yanıtı doldurur.
        state.offer = offer || null;
        applyOfferToUi();
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
    openPayment(opts) { ensurePopup().openPayment(opts); },
  };
})();
