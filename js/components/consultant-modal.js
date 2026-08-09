// ConsultantModal — /danisman detay modalının orkestratörü. js/components/architect-modal.js
// ile AYNI state machine deseni (open/swap/close/handlePopState, history key farklı:
// mimarlabModal:'consultant', URL /danisman/:slug) — DOM çerçevesi (overlay/panel/focus-trap/
// scroll-lock) js/components/modal-shell.js'ten gelir. Sağ panel architect-modal.js'teki "ilgili
// firma/proje" grid'leri yerine ADPList Yan Liu profilinden ilham alan sticky rezervasyon kutusu
// (topluluk istatistikleri + tarih/saat slotları + Havale/EFT ödeme pop-up'ı + Firmalar/Projeler/
// Benzer Danışmanlar carousel'leri) taşır (bkz. kullanıcı isteği). "Profili Düzenle" ve "Puanla"
// butonları js/components/claim-correction-box.js ve rating-widget.js'i AYNEN mimar profilindeki
// gibi yeniden kullanır — consultant zaten bir architects satırı olduğundan hiçbir yeni backend
// gerekmez (bkz. kullanıcı isteği, plan bölüm 3).
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
      /* Puanla — product-modal.js#.pr-rating-save-row .rating-widget ile BİREBİR aynı desen,
         yalnızca .detail-title-actions kapsayıcısına uyarlandı (bkz. kullanıcı isteği: "Kaydet"
         yanına "Puanla" butonu). */
      .detail-title-actions .rating-widget{
        display:flex; align-items:center; gap:4px; flex-wrap:nowrap;
        flex-shrink:1 !important; min-width:0 !important;
        height:32px !important; box-sizing:border-box;
        background:var(--paper-card); border:1px solid var(--line); border-radius:100px;
        padding:0 8px !important; margin:0; transition:border-color .15s ease;
      }
      .detail-title-actions .rating-widget:hover{border-color:var(--walnut);}
      .detail-title-actions .rating-star-row{display:flex; gap:2px; flex-shrink:0;}
      .detail-title-actions .rating-star-btn{background:none; border:none; padding:0; color:var(--line); display:flex; transition:transform .1s ease;}
      .detail-title-actions .rating-star-btn.filled{color:var(--accent);}
      .detail-title-actions .rating-star-btn:hover:not(:disabled){color:var(--accent); transform:scale(1.15);}
      .detail-title-actions .rating-star-btn:disabled{opacity:0.6; cursor:not-allowed;}
      .detail-title-actions .rating-summary{font-size:12px !important; font-weight:600; line-height:1; color:var(--ink-soft); white-space:nowrap !important;}

      /* Sekmeler — Genel Bakış/Değerlendirmeler (bkz. kullanıcı isteği: "Uzmanlıklar" sekmesi
         tamamen kalksın, yalnızca bu ikisi kalsın). Kutu/çizgi yok — sadece bold metin, ayrım
         renkle (bkz. kullanıcı isteği). */
      .cm-tabs{display:flex; gap:4px; margin-bottom:20px; overflow-x:auto; scrollbar-width:none;}
      .cm-tabs::-webkit-scrollbar{display:none;}
      .cm-tab{flex-shrink:0; padding:10px 4px; margin-right:20px; font-size:13.5px; font-weight:700; color:var(--ink-soft); border:none; background:none; border-radius:0;}
      .cm-tab.active{color:var(--ink);}
      .cm-tab-panel{display:none;}
      .cm-tab-panel.active{display:block;}
      .cm-tab-empty{padding:32px 0; text-align:center; color:var(--ink-soft); font-size:13.5px;}
      .cm-rating-summary{display:flex; align-items:center; gap:10px; padding:8px 0 24px;}
      .rating-badge{display:flex; align-items:center; gap:6px;}
      .rating-badge-star{color:var(--line); display:flex;}
      .rating-badge-star.filled{color:var(--accent);}
      .rating-badge-count{font-size:13px; font-weight:600; color:var(--ink-soft);}

      .detail-info{margin-top:0;}
      /* bkz. kullanıcı isteği: profile birden fazla sosyal medya eklenebilsin (mimar-ekle.html#social-row —
         danışman zaten bir architects satırı olduğundan aynı social_links alanını paylaşır). */
      .social-icons{display:flex; gap:12px; margin-top:6px;}
      .social-icons a{color:var(--ink-soft); display:flex;}
      .social-icons a:hover{color:var(--walnut);}
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

      /* ---------- Sahip/admin için inline "Düzenle" modu (bio + haftalık slot şablonu, bkz.
         kullanıcı isteği: pop-up üzerinden düzenlenebilsin) ---------- */
      .cm-edit-panel{display:none; margin-top:14px; padding:16px; border:1px solid var(--line); border-radius:12px; background:var(--paper);}
      .cm-edit-panel.open{display:block;}
      .cm-edit-label{font-size:12px; font-weight:700; color:var(--ink); margin:0 0 6px;}
      .cm-edit-bio{width:100%; min-height:90px; padding:10px 12px; border:1px solid var(--line); border-radius:10px; background:var(--paper-card); font-family:inherit; font-size:13px; color:var(--ink); resize:vertical; margin-bottom:16px;}
      .cm-edit-day{margin-bottom:12px;}
      .cm-edit-day-label{font-size:12.5px; font-weight:700; color:var(--ink); margin-bottom:6px;}
      .cm-edit-times{display:flex; flex-wrap:wrap; gap:6px;}
      .cm-edit-time-chip{display:inline-flex; align-items:center; gap:6px; padding:5px 10px; border-radius:100px; border:1px solid var(--line); background:var(--paper-card); font-size:12px; font-family:'IBM Plex Mono', monospace;}
      .cm-edit-time-chip button{background:none; border:none; color:var(--ink-soft); padding:0; line-height:1; cursor:pointer;}
      .cm-edit-time-chip button:hover{color:#B84C4C;}
      .cm-edit-add-row{display:flex; gap:6px; margin-top:6px;}
      .cm-edit-add-row input[type=time]{border:1px solid var(--line); border-radius:8px; padding:5px 8px; font-family:inherit; font-size:12px;}
      .cm-edit-add-row button{background:none; border:1px solid var(--line); border-radius:8px; padding:5px 10px; font-size:12px; font-weight:600; color:var(--ink);}
      .cm-edit-actions{display:flex; gap:8px; margin-top:16px;}
      .cm-edit-actions button{flex:1; padding:11px; border-radius:100px; font-weight:600; font-size:13px; border:1px solid var(--line);}
      .cm-edit-save-btn{background:var(--ink) !important; color:var(--paper-card) !important; border-color:var(--ink) !important;}
      .cm-edit-save-btn:hover{background:var(--walnut) !important;}
      .cm-edit-cancel-btn{background:var(--paper-card);}

      /* ---------- Sağ panel: sticky rezervasyon kutusu ---------- */
      .cm-booking{position:sticky; top:0; display:flex; flex-direction:column; gap:20px; padding-bottom:24px; border-bottom:1px solid var(--line); margin-bottom:24px;}
      .cm-stats{display:flex; gap:24px;}
      .cm-stat{flex:1;}
      .cm-stat-value{font-family:'Inter', sans-serif; font-size:20px; font-weight:700; color:var(--ink);}
      .cm-stat-label{font-size:11.5px; color:var(--ink-soft); margin-top:2px;}
      .cm-slots-title{font-size:13px; font-weight:700; color:var(--ink); margin:0 0 10px; display:flex; align-items:center; justify-content:space-between; gap:8px;}
      .cm-week-nav{display:flex; align-items:center; gap:6px;}
      .cm-week-label{font-size:11.5px; font-weight:600; color:var(--ink-soft); white-space:nowrap;}
      .cm-week-btn{width:26px; height:26px; border-radius:50%; border:1px solid var(--line); background:var(--paper); color:var(--ink); display:flex; align-items:center; justify-content:center; flex-shrink:0;}
      .cm-week-btn:hover{border-color:var(--walnut);}
      .cm-date-row{display:flex; gap:8px; overflow-x:auto; scrollbar-width:none; margin-bottom:14px;}
      .cm-date-row::-webkit-scrollbar{display:none;}
      .cm-date-chip.disabled{opacity:0.4; cursor:not-allowed;}
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
      /* Kart başlığı artık görselin ÜZERİNDE değil ALTINDA (bkz. kullanıcı isteği: tüm sayfa/
         görünümlerde gönderi başlıkları görselin altında olsun). */
      .related-card{display:block; border-radius:12px; overflow:hidden; background:var(--paper-card); border:1px solid var(--line-soft);}
      .related-card-photo{position:relative; aspect-ratio:4/3; overflow:hidden;}
      .related-card-photo img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover;}
      .related-card-placeholder{position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:rgba(255,255,255,0.92); font-family:'Inter', sans-serif; font-size:22px; font-weight:700;}
      .related-card-title{padding:12px 14px; color:var(--ink); font-family:'Inter', sans-serif; font-size:13.5px; font-weight:700;}
      .related-card-title-text{display:block !important; white-space:nowrap !important; overflow:hidden !important; text-overflow:ellipsis !important; width:100% !important;}
      .related-card-subtitle{font-size:11px; font-weight:500; color:var(--ink-soft); margin-top:2px;}
      .related-grid-scroll{display:flex; gap:16px; overflow-x:auto; scroll-behavior:smooth; scrollbar-width:none; padding-bottom:4px;}
      .related-grid-scroll::-webkit-scrollbar{display:none;}
      .related-grid-scroll .related-card{flex:0 0 200px;}

      /* ---------- Değerlendirmeler sekmesi: yorum listesi/formu — proje.html'deki AYNI
         .comment-*/.comments-* kuralları (bkz. kullanıcı isteği: standart MİMARLAB yorum yapısı,
         js/components/project-comments.js). danisman.html'in kendi :root'unda proje.html'in Design
         Token katmanı (--color-primary vb.) yok, bu yüzden burada doğrudan bu sayfanın kendi
         --ink/--walnut/--paper-card token'larıyla eşdeğerleri yazılır (bkz. kullanıcı isteği). ---------- */
      .comments-section{margin-top:24px; padding-top:20px; border-top:1px solid var(--line);}
      .comments-title{font-family:'Inter', sans-serif; font-size:16px; font-weight:700; margin:0 0 14px;}
      .comment-form-wrap{margin-bottom:18px;}
      .comment-input-wrap{position:relative;}
      .comment-form textarea{width:100%; min-height:80px; padding:12px 108px 50px 14px; border:1px solid var(--line); border-radius:12px; background:var(--paper); font-family:inherit; font-size:14px; color:var(--ink); resize:vertical;}
      .comment-input-wrap .comment-submit-btn{position:absolute; right:8px; bottom:8px;}
      .comment-submit-btn{background:var(--ink); color:var(--paper-card); padding:8px 16px; border-radius:999px; font-weight:600; font-size:12px; line-height:1.2; border:none;}
      .comment-submit-btn:hover{background:var(--walnut);}
      .comment-submit-btn:disabled{opacity:0.5; cursor:not-allowed;}
      .comment-login-note{padding:16px 18px; border:1px dashed var(--line); border-radius:12px; font-size:13.5px; color:var(--ink-soft);}
      .comment-login-note a{color:var(--walnut); font-weight:600; text-decoration:underline;}
      .comment-submit-notice{margin:10px 0 0; font-size:12.5px; color:var(--sage);}
      .comment-row{display:flex; gap:12px; padding:14px 0; border-bottom:1px solid var(--line-soft);}
      .comment-row:last-child{border-bottom:none;}
      .comment-avatar{width:34px; height:34px; border-radius:50%; background:var(--walnut); color:var(--paper-card); display:flex; align-items:center; justify-content:center; font-family:'IBM Plex Mono', monospace; font-size:11.5px; font-weight:600; flex-shrink:0; position:relative; overflow:hidden;}
      a.comment-avatar{text-decoration:none;}
      .comment-avatar img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover;}
      .comment-meta{font-size:12.5px; color:var(--ink-soft); margin-bottom:4px; display:flex; align-items:center; gap:6px; flex-wrap:wrap;}
      .comment-meta strong{color:var(--ink); font-weight:600;}
      .comment-author-link{color:inherit; text-decoration:none;}
      .comment-author-link:hover{text-decoration:underline;}
      .comment-delete-btn{background:none; border:none; color:var(--ink-soft); font-size:12px; font-family:inherit; cursor:pointer; margin-left:4px; text-decoration:underline; padding:0;}
      .comment-delete-btn:hover{color:#c0392b;}
      .comment-body-text{margin:0; font-size:13.5px; line-height:1.6; color:var(--ink); white-space:pre-wrap;}

      /* ---------- Havale/EFT ödeme pop-up'ı — satin-al.html'in AYNI ödeme yöntemi UI'ı (bkz.
         kullanıcı isteği), ModalShell'in ÜSTÜNDE (z-index) ayrı bir hafif overlay. ---------- */
      .cm-payment-overlay{
        display:none; position:fixed; inset:0; z-index:200;
        background:rgba(27,42,61,0.55); backdrop-filter:blur(2px);
        align-items:center; justify-content:center; padding:20px;
      }
      .cm-payment-overlay.open{display:flex;}
      .cm-payment-modal{
        width:100%; max-width:420px; max-height:85vh; overflow-y:auto;
        background:var(--paper-card); border-radius:18px; padding:28px;
        position:relative; box-shadow:0 24px 60px rgba(27,42,61,0.35);
      }
      .cm-payment-close{
        position:absolute; top:16px; right:16px; width:32px; height:32px; border-radius:50%;
        border:1px solid var(--line); background:var(--paper); color:var(--ink-soft);
        display:flex; align-items:center; justify-content:center;
      }
      .cm-payment-close:hover{color:var(--ink); border-color:var(--walnut);}
      .cm-payment-modal h2{font-family:'Inter', sans-serif; font-size:20px; font-weight:700; margin:0 0 6px;}
      .cm-payment-modal h3{font-family:'Inter', sans-serif; font-size:14px; font-weight:700; margin:20px 0 4px;}
      .section-hint{font-size:12.5px; color:var(--ink-soft); margin:0 0 12px;}
      .cm-field{margin:14px 0;}
      .cm-field-label{display:block; font-size:12.5px; font-weight:700; color:var(--ink); margin-bottom:6px;}
      .cm-field input[type=tel]{
        width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:10px;
        background:var(--paper); font-family:inherit; font-size:13.5px; color:var(--ink); box-sizing:border-box;
      }
      .target-option{display:flex; align-items:center; gap:9px; font-size:14px; font-weight:500; cursor:pointer; padding:9px 4px;}
      .target-option input{width:17px; height:17px; accent-color:var(--walnut); flex-shrink:0;}
      .payment-option-disabled{opacity:0.55; cursor:default;}
      .payment-option-disabled input{cursor:default;}
      .payment-soon-tag{font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; color:var(--ink-soft); background:var(--paper-alt); padding:3px 9px; border-radius:100px;}
      .havale-box{margin-top:14px; border:1px solid var(--line); border-radius:12px; padding:16px 18px; background:var(--paper);}
      .havale-row{display:flex; align-items:center; gap:10px; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--line-soft); font-size:13.5px;}
      .havale-row:last-of-type{border-bottom:none;}
      .havale-row-label{color:var(--ink-soft); flex-shrink:0;}
      .havale-row-value{font-family:'IBM Plex Mono', monospace; font-weight:600; text-align:right; word-break:break-word;}
      .havale-copy-btn{flex-shrink:0; background:none; border:1px solid var(--line); border-radius:100px; padding:5px 12px; font-size:11.5px; font-weight:600; color:var(--ink);}
      .havale-copy-btn:hover{background:var(--paper-alt);}
      .havale-hint{font-size:12.5px; color:var(--ink-soft); line-height:1.6; margin:12px 0 0;}
      .form-submit{width:100%; background:var(--ink); color:var(--paper-card); border:none; padding:14px; border-radius:100px; font-weight:600; font-size:15px;}
      .form-submit:hover{background:var(--walnut);}
      .form-submit:disabled{background:var(--paper-alt); color:var(--ink-soft); cursor:default;}
      .form-notice{display:none; margin-top:16px; padding:13px 16px; border-radius:10px; background:rgba(224,138,62,0.12); border:1px solid var(--accent); color:var(--ink); font-size:12.5px; line-height:1.6;}
      .form-notice.success{background:rgba(62,122,85,0.12); border-color:var(--good, #3E7A55);}
      .form-notice.show{display:block;}

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
      <div id="cm-social-icons"></div>
    </div>
    <div class="cm-tabs" id="cm-tabs">
      <button type="button" class="cm-tab active" data-tab="overview">Genel Bakış</button>
      <button type="button" class="cm-tab" data-tab="reviews">Değerlendirmeler</button>
    </div>
    <div class="cm-tab-panel active" id="cm-tab-overview">
      <div class="detail-desc" id="cm-about"></div>
      <div class="cm-tags" id="cm-tags"></div>
      <div class="cm-insights" id="cm-insights"></div>
      <div class="cm-edit-panel" id="cm-edit-panel">
        <div class="cm-edit-label">Açıklama</div>
        <textarea class="cm-edit-bio" id="cm-edit-bio-input" maxlength="2000"></textarea>
        <div class="cm-edit-label">Haftalık Müsaitlik</div>
        <div id="cm-edit-days"></div>
        <div class="cm-edit-actions">
          <button type="button" class="cm-edit-cancel-btn" id="cm-edit-cancel-btn">Vazgeç</button>
          <button type="button" class="cm-edit-save-btn" id="cm-edit-save-btn">Kaydet</button>
        </div>
      </div>
    </div>
    <div class="cm-tab-panel" id="cm-tab-reviews">
      <div class="cm-rating-summary" id="cm-rating-summary"></div>
      <div class="cm-tab-empty" id="cm-rating-empty" style="display:none;">Henüz değerlendirme yok — ilk değerlendirmeyi sen yap.</div>
      <div class="comments-section" id="cm-comments-section" aria-live="polite">
        <h2 class="comments-title">Yorumlar (<span id="pm-comments-count">0</span>)</h2>
        <div class="comment-form-wrap" id="pm-comment-form-wrap"></div>
        <div class="comments-list" id="pm-comments-list"></div>
      </div>
    </div>`;

  const RIGHT_TEMPLATE = `
    <div class="cm-booking" id="cm-booking">
      <div class="cm-stats">
        <div class="cm-stat"><div class="cm-stat-value" id="cm-stat-minutes"></div><div class="cm-stat-label">Toplam Görüşme Süresi</div></div>
        <div class="cm-stat"><div class="cm-stat-value" id="cm-stat-sessions"></div><div class="cm-stat-label">Tamamlanan Görüşme</div></div>
      </div>
      <div id="cm-slots-wrap">
        <div class="cm-slots-title">
          <span>Uygun Görüşmeler</span>
          <span class="cm-week-nav">
            <button type="button" class="cm-week-btn" id="cm-week-prev" aria-label="Önceki hafta">‹</button>
            <span class="cm-week-label" id="cm-week-label"></span>
            <button type="button" class="cm-week-btn" id="cm-week-next" aria-label="Sonraki hafta">›</button>
          </span>
        </div>
        <div class="cm-date-row" id="cm-date-row"></div>
        <div class="cm-time-grid" id="cm-time-grid"></div>
        <button type="button" class="cm-cta-btn" id="cm-cta-btn">Görüşme Ayarla</button>
        <div class="cm-cta-note" id="cm-cta-note">Lütfen önce bir saat seçin.</div>
      </div>
    </div>
    <div class="related-section" id="cm-office-section" style="display:none;">
      <h2 class="related-title">Firmalar</h2>
      <div class="related-grid-scroll" id="cm-office-grid"></div>
    </div>
    <div class="related-section" id="cm-related-projects-section" style="display:none;">
      <h2 class="related-title">Projeler</h2>
      <div class="related-grid-scroll" id="cm-related-projects-grid"></div>
    </div>
    <div class="related-section" id="cm-similar-section" style="display:none;">
      <h2 class="related-title">Benzer Danışmanlar</h2>
      <div class="related-grid-scroll" id="cm-similar-grid"></div>
    </div>`;

  const PAYMENT_OVERLAY_TEMPLATE = `
    <div class="cm-payment-modal">
      <button type="button" class="cm-payment-close" id="cm-payment-close" aria-label="Kapat">✕</button>
      <h2>Görüşme Ayarla</h2>
      <p class="section-hint" id="cm-payment-summary"></p>
      <p class="section-hint">Ödeme sonrası görüşme linki açıklamaya yazdığın e-posta adresinden sana iletilecek.</p>
      <div class="cm-field">
        <label class="cm-field-label" for="cm-payment-phone">Telefon Numarası</label>
        <input type="tel" id="cm-payment-phone" placeholder="05XX XXX XX XX" autocomplete="tel">
      </div>
      <h3>Ödeme Yöntemi</h3>
      <p class="section-hint">Şu anda yalnızca havale/EFT ile ödeme alıyoruz.</p>
      <label class="target-option"><input type="radio" name="cm-payment-method" id="cm-payment-havale" checked> Havale / EFT</label>
      <label class="target-option payment-option-disabled"><input type="radio" name="cm-payment-method" id="cm-payment-card" disabled> Kredi / Banka Kartı <span class="payment-soon-tag">Şu an aktif değil</span></label>
      <div class="havale-box">
        <div class="havale-row"><span class="havale-row-label">IBAN</span><span class="havale-row-value" id="cm-havale-iban">TR22 0004 6001 7088 8000 2482 94</span><button type="button" class="havale-copy-btn" id="cm-havale-copy-btn">Kopyala</button></div>
        <div class="havale-row"><span class="havale-row-label">Hesap Sahibi</span><span class="havale-row-value">Kaan Çorbacı</span></div>
        <div class="havale-row"><span class="havale-row-label">Tutar</span><span class="havale-row-value" id="cm-havale-amount">—</span></div>
        <div class="havale-row"><span class="havale-row-label">Açıklama</span><span class="havale-row-value">info@mimarlab.com</span></div>
        <p class="havale-hint">Ödemeni yukarıdaki IBAN'a gönderirken açıklama kısmına e-posta adresini yaz. Ödemeyi tamamladıktan sonra aşağıdaki butona tıkla, talebin onaylandığında görüşmen kesinleşecek.</p>
      </div>
      <button class="form-submit" id="cm-payment-confirm" type="button" style="margin-top:18px;">Ödemeyi Yaptım</button>
      <div class="form-notice" id="cm-payment-notice"></div>
    </div>`;

  // renderNotFound() bu ID'leri gizler; her başarılı renderItem() aynı listeyi kullanarak
  // geri açar (bkz. js/components/project-modal.js#HIDE_ON_NOT_FOUND_IDS AYNI gerçek bulgu).
  const HIDE_ON_NOT_FOUND_IDS = ['cm-actions', 'cm-tabs', 'cm-tab-overview', 'cm-tab-reviews', 'cm-booking',
    'cm-office-section', 'cm-related-projects-section', 'cm-similar-section', 'cm-detail-info'];

  let mountedOnce = false;
  let currentSlug = null;
  let currentItem = null;
  let openedViaPush = false;
  let pushCountSinceOpen = 0;
  let requestSeq = 0;
  let weekOffset = 0; // 0 = bugünün içinde bulunduğu hafta (bkz. kullanıcı isteği: haftalık takvim)
  let selectedDate = null; // 'YYYY-MM-DD', görüntülenen hafta içinde
  let selectedBooking = null; // { date, time }
  let paymentOverlayEl = null;
  let editMode = false;

  function ensureTemplate() {
    if (mountedOnce) return;
    const panels = ModalShell.getPanels();
    panels.leftPanelEl.innerHTML = LEFT_TEMPLATE;
    panels.rightPanelEl.innerHTML = RIGHT_TEMPLATE;
    ModalShell.wireGridScrollArrows(panels.rightPanelEl);
    wireTabs();
    wireEditPanel();
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

  // Havale/EFT pop-up'ı bir kez body'ye eklenir (ModalShell'den BAĞIMSIZ, tekrar açılıp
  // kapanabilen ayrı bir overlay — bkz. dosya başı yorumu).
  function ensurePaymentOverlay() {
    if (paymentOverlayEl) return paymentOverlayEl;
    const el = document.createElement('div');
    el.className = 'cm-payment-overlay';
    el.id = 'cm-payment-overlay';
    el.innerHTML = PAYMENT_OVERLAY_TEMPLATE;
    document.body.appendChild(el);
    paymentOverlayEl = el;

    function closeOverlay() { el.classList.remove('open'); }
    el.addEventListener('click', (e) => { if (e.target === el) closeOverlay(); });
    document.getElementById('cm-payment-close').addEventListener('click', closeOverlay);

    const copyBtn = document.getElementById('cm-havale-copy-btn');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText('TR220004600170888000248294');
        const original = copyBtn.textContent;
        copyBtn.textContent = 'Kopyalandı';
        setTimeout(() => { copyBtn.textContent = original; }, 1500);
      } catch {}
    });

    const CONFIRM_LABEL = 'Ödemeyi Yaptım';
    document.getElementById('cm-payment-confirm').addEventListener('click', async () => {
      const btn = document.getElementById('cm-payment-confirm');
      const notice = document.getElementById('cm-payment-notice');
      notice.classList.remove('show', 'success');
      if (!currentItem || !selectedBooking) return;
      // bkz. kullanıcı isteği: satın alım yaparken kişiden telefon numarası istensin.
      const phone = document.getElementById('cm-payment-phone').value.trim();
      if (!phone) {
        notice.textContent = 'Devam etmek için telefon numaranı gir.';
        notice.classList.add('show');
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Gönderiliyor…';
      try {
        const res = await fetch('/api/consultant-bookings', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ consultantKey: currentItem.name, requestedDate: selectedBooking.date, requestedTime: selectedBooking.time, phone }),
        });
        if (res.status === 401) { window.location.href = 'giris-yap.html'; return; }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          notice.textContent = data.error || 'Talep gönderilemedi, tekrar dene.';
          notice.classList.add('show');
          btn.disabled = false; btn.textContent = CONFIRM_LABEL;
          return;
        }
        notice.textContent = 'Talebin alındı. Ödemen kontrol edilip onaylandığında görüşmen kesinleşecek.';
        notice.classList.add('show', 'success');
        btn.textContent = 'Talebin Gönderildi';
      } catch {
        notice.textContent = 'Sunucuya ulaşılamadı, lütfen tekrar dene.';
        notice.classList.add('show');
        btn.disabled = false; btn.textContent = CONFIRM_LABEL;
      }
    });

    return el;
  }

  function openPaymentOverlay() {
    const el = ensurePaymentOverlay();
    document.getElementById('cm-payment-confirm').disabled = false;
    document.getElementById('cm-payment-confirm').textContent = 'Ödemeyi Yaptım';
    document.getElementById('cm-payment-notice').classList.remove('show', 'success');
    const { day, month } = formatDateChip(selectedBooking.date);
    document.getElementById('cm-payment-summary').textContent =
      `${currentItem.name} ile ${day} ${month}, ${selectedBooking.time} için görüşme${currentItem.hourlyRate ? ` — ₺${currentItem.hourlyRate}` : ''}`;
    document.getElementById('cm-havale-amount').textContent = currentItem.hourlyRate ? `₺${currentItem.hourlyRate}` : '—';
    el.classList.add('open');
  }

  const DESC_TRUNCATE_AT = 320;
  function safeUrl(u) {
    try {
      const parsed = new URL(u, window.location.href);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
    } catch {}
    return '';
  }

  // bkz. js/components/architect-modal.js#socialIconsHtml AYNI kopya.
  const SOCIAL_ICON_SVG = {
    instagram: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/></svg>',
    linkedin: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M4.5 3.5A2 2 0 1 0 4.5 7.5 2 2 0 0 0 4.5 3.5zM3 9h3v12H3zM10 9h2.9v1.6h.1c.4-.8 1.5-1.6 3-1.6 3.2 0 3.8 2.1 3.8 4.9V21h-3v-6.6c0-1.6 0-3.6-2.2-3.6s-2.5 1.7-2.5 3.5V21H10z"/></svg>',
    x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.3 2H21l-7.3 8.3L22.2 22h-6.8l-5.3-6.9L4 22H1.3l7.8-8.9L1.5 2h6.9l4.8 6.3L18.3 2z"/></svg>',
    youtube: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9l6 3-6 3V9z" fill="currentColor" stroke="none"/></svg>',
    behance: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><text x="12" y="15.5" font-size="9" text-anchor="middle" fill="currentColor" stroke="none" font-family="Arial, sans-serif" font-weight="700">Be</text></svg>',
    website: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/></svg>',
  };
  const SOCIAL_LABELS = { instagram: 'Instagram', linkedin: 'LinkedIn', x: 'X (Twitter)', youtube: 'YouTube', behance: 'Behance', website: 'Web Sitesi' };
  function socialIconsHtml(links) {
    const valid = (links || []).map(s => ({ platform: s.platform, url: safeUrl(s.url) })).filter(s => s.url);
    if (!valid.length) return '';
    return `<div class="social-icons">${valid.map(s => `<a href="${escapeAttr(s.url)}" target="_blank" rel="noopener" aria-label="${escapeAttr(SOCIAL_LABELS[s.platform] || s.platform)}">${SOCIAL_ICON_SVG[s.platform] || SOCIAL_ICON_SVG.website}</a>`).join('')}</div>`;
  }

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
      <div class="related-card-photo">
        ${image ? `<img src="${escapeAttr(cdnImg(image, 450))}"${srcset ? ` srcset="${escapeAttr(srcset)}" sizes="300px"` : ''} alt="${escapeAttr(title)}" loading="lazy" decoding="async">` : `<div class="related-card-placeholder" style="background:${officeColor(title)}">${escapeHtml(initials(title))}</div>`}
      </div>
      <div class="related-card-title"><span class="related-card-title-text">${escapeHtml(title)}${badgeHtml || ''}</span>${subtitle ? `<div class="related-card-subtitle">${escapeHtml(subtitle)}</div>` : ''}</div>
    </a>`;
  }

  function updateHeadMeta(a) {
    document.title = `${a.name} — Online Danışmanlık | MİMARLAB`;
    const desc = a.about ? a.about.slice(0, 200) : `${a.name} — MİMARLAB'da online danışmanlık/mentörlük görüşmesi ayırt.`;
    const canonicalUrl = `https://mimarlab.com/danisman/${encodeURIComponent(slugify(a.name))}`;
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

  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function toDateStr(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

  // Pazartesi başlangıçlı 7 günlük hafta, offsetWeeks kadar kaydırılmış (bkz. kullanıcı isteği:
  // haftalık dinamik takvim, sağ/sol ok butonlarıyla gezinme). Her çağrıda "bugün" yeniden
  // hesaplanır (cache yok) — bu, haftanın kendiliğinden yenilenmesini sağlar.
  function weekDates(offsetWeeks) {
    const now = new Date();
    const day = now.getDay();
    const monday = startOfDay(now);
    monday.setDate(monday.getDate() + (day === 0 ? -6 : 1 - day) + offsetWeeks * 7);
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d; });
  }

  // available_slots: [{weekday:0-6 (Date.getDay() ile aynı, 0=Pazar), times:[{time,available}]}] —
  // haftanın günlerine bağlı tekrarlayan şablon (bkz. kullanıcı isteği: takvim her yeni haftada
  // otomatik yenilensin). "Görüşme Ayarla" bir saat seçilmeden tıklanırsa yalnızca #cm-cta-note
  // nudge'ı gösterilir; bir saat seçiliyse Havale/EFT pop-up'ı açılır (bkz. openPaymentOverlay).
  function renderSlots(a) {
    const template = a.availableSlots || [];
    const wrap = document.getElementById('cm-slots-wrap');
    const dateRow = document.getElementById('cm-date-row');
    const timeGrid = document.getElementById('cm-time-grid');
    const ctaBtn = document.getElementById('cm-cta-btn');
    const ctaNote = document.getElementById('cm-cta-note');
    const weekLabel = document.getElementById('cm-week-label');
    ctaNote.classList.remove('show');
    selectedBooking = null;

    if (!template.length) {
      wrap.innerHTML = `<div class="cm-slots-title">Uygun Görüşmeler</div><div class="cm-empty-slots">Şu anda müsait bir görüşme saati yok.</div>`;
      return;
    }

    function ctaLabel() {
      return a.hourlyRate ? `Görüşme Ayarla — ₺${a.hourlyRate}` : 'Görüşme Ayarla';
    }

    function timesForDate(d) {
      const entry = template.find(t => t.weekday === d.getDay());
      return (entry && entry.times) || [];
    }

    // Bugünün tarihinden/saatinden önceki slotlar hem disabled hem tıklanamaz (bkz. kullanıcı
    // isteği: geçmiş gün kısıtlaması) — istemci tarafı kontrolü; sunucu tarafı aynı kontrolü
    // consultantBookings.js#handleConsultantBookingsRoute'ta ayrıca tekrarlar.
    function renderTimeGridFor(dateStr, dateObj) {
      const now = new Date();
      const times = timesForDate(dateObj);
      if (!times.length) { timeGrid.innerHTML = `<div class="cm-empty-slots">Bu gün için müsait saat yok.</div>`; return; }
      timeGrid.innerHTML = times.map(t => {
        const [hh, mm] = t.time.split(':').map(Number);
        const slotMoment = new Date(dateObj); slotMoment.setHours(hh, mm, 0, 0);
        const disabled = !t.available || slotMoment.getTime() <= now.getTime();
        const active = selectedBooking && selectedBooking.date === dateStr && selectedBooking.time === t.time;
        return `<button type="button" class="cm-time-btn${active ? ' active' : ''}" data-time="${escapeAttr(t.time)}" ${disabled ? 'disabled' : ''}>${escapeHtml(t.time)}</button>`;
      }).join('');
      timeGrid.querySelectorAll('.cm-time-btn:not(:disabled)').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedBooking = { date: dateStr, time: btn.dataset.time };
          timeGrid.querySelectorAll('.cm-time-btn').forEach(b => b.classList.toggle('active', b === btn));
          ctaNote.classList.remove('show');
        });
      });
    }

    function renderWeek() {
      const dates = weekDates(weekOffset);
      const todayStart = startOfDay(new Date());
      if (!selectedDate || !dates.some(d => toDateStr(d) === selectedDate)) {
        const firstEnabled = dates.find(d => startOfDay(d).getTime() >= todayStart.getTime());
        selectedDate = toDateStr(firstEnabled || dates[0]);
        selectedBooking = null;
      }
      weekLabel.textContent = `${dates[0].toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })} – ${dates[6].toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}`;
      const dayNames = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
      dateRow.innerHTML = dates.map((d, i) => {
        const dateStr = toDateStr(d);
        const isPastDay = startOfDay(d).getTime() < todayStart.getTime();
        const active = dateStr === selectedDate;
        return `<div class="cm-date-chip${active ? ' active' : ''}${isPastDay ? ' disabled' : ''}" data-date="${dateStr}">${dayNames[i]}<span class="cm-date-day">${d.getDate()}</span></div>`;
      }).join('');
      dateRow.querySelectorAll('.cm-date-chip:not(.disabled)').forEach(chip => {
        chip.addEventListener('click', () => {
          selectedDate = chip.dataset.date;
          selectedBooking = null;
          dateRow.querySelectorAll('.cm-date-chip').forEach(c => c.classList.toggle('active', c === chip));
          renderTimeGridFor(selectedDate, dates.find(d => toDateStr(d) === selectedDate));
        });
      });
      const selDateObj = dates.find(d => toDateStr(d) === selectedDate) || dates[0];
      renderTimeGridFor(selectedDate, selDateObj);
    }

    renderWeek();
    ctaBtn.textContent = ctaLabel();
    // bkz. kullanıcı isteği: ödeme ekranında hesaba girme zorunluluğu getir — eskiden yalnızca
    // "Ödemeyi Yaptım"a tıklanınca sunucu 401 döndürüp giriş sayfasına yönlendiriyordu (kullanıcı
    // formu doldurup saatini seçtikten SONRA fark ediyordu); artık ödeme pop-up'ı hiç açılmadan,
    // save-widget.js'in AYNI "giriş gerekiyorsa giris-yap.html'e yönlendir" deseniyle (bkz.
    // save-widget.js#wireSaveButtons) en baştan engelleniyor.
    ctaBtn.onclick = async () => {
      if (!selectedBooking) { ctaNote.classList.add('show'); return; }
      await savedWidgetReady;
      if (!currentUser) { window.location.href = 'giris-yap.html'; return; }
      openPaymentOverlay();
    };
    document.getElementById('cm-week-prev').onclick = () => { weekOffset--; renderWeek(); };
    document.getElementById('cm-week-next').onclick = () => { weekOffset++; renderWeek(); };
  }

  function renderNotFound() {
    document.getElementById('cm-name-text').textContent = 'Danışman bulunamadı';
    const headerActions = ModalShell.getHeaderActionsSlot();
    if (headerActions) headerActions.innerHTML = '';
    HIDE_ON_NOT_FOUND_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  function wireInternalNav() {
    const panels = ModalShell.getPanels();
    if (!panels || panels.bodyEl.dataset.cmNavWired) return;
    panels.bodyEl.dataset.cmNavWired = '1';
    panels.bodyEl.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="/danisman/"]');
      if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const m = a.getAttribute('href').match(/^\/danisman\/([^/?#]+)/);
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

  // İnline "Düzenle" modu — profil sahibi/admin pop-up üzerinden bio + haftalık müsaitlik
  // şablonunu doğrudan düzenler (bkz. kullanıcı isteği), PATCH /api/consultant/:key'e yazar
  // (src/routes/consultant.js#handleConsultantEditRoute).
  const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Pzt..Paz
  const WEEKDAY_LABELS = { 1: 'Pazartesi', 2: 'Salı', 3: 'Çarşamba', 4: 'Perşembe', 5: 'Cuma', 6: 'Cumartesi', 0: 'Pazar' };
  let editSlotsWorking = [];

  function cloneSlotsForEdit(template) {
    return WEEKDAY_ORDER.map(weekday => {
      const entry = (template || []).find(t => t.weekday === weekday);
      return { weekday, times: entry ? entry.times.filter(t => t.available).map(t => ({ time: t.time, available: true })) : [] };
    });
  }

  function renderEditDays() {
    const container = document.getElementById('cm-edit-days');
    if (!container) return;
    container.innerHTML = editSlotsWorking.map(day => `
      <div class="cm-edit-day" data-weekday="${day.weekday}">
        <div class="cm-edit-day-label">${WEEKDAY_LABELS[day.weekday]}</div>
        <div class="cm-edit-times">
          ${day.times.map(t => `<span class="cm-edit-time-chip">${escapeHtml(t.time)}<button type="button" data-remove-time="${escapeAttr(t.time)}">✕</button></span>`).join('') || '<span style="font-size:11.5px;color:var(--ink-soft);">Saat yok</span>'}
        </div>
        <div class="cm-edit-add-row">
          <input type="time" class="cm-edit-time-input">
          <button type="button" class="cm-edit-add-time-btn">+ Saat Ekle</button>
        </div>
      </div>`).join('');
    container.querySelectorAll('.cm-edit-day').forEach(dayEl => {
      const weekday = parseInt(dayEl.dataset.weekday, 10);
      const day = editSlotsWorking.find(d => d.weekday === weekday);
      dayEl.querySelectorAll('[data-remove-time]').forEach(btn => {
        btn.addEventListener('click', () => {
          day.times = day.times.filter(t => t.time !== btn.dataset.removeTime);
          renderEditDays();
        });
      });
      dayEl.querySelector('.cm-edit-add-time-btn').addEventListener('click', () => {
        const input = dayEl.querySelector('.cm-edit-time-input');
        const val = input.value;
        if (!val || day.times.some(t => t.time === val)) return;
        day.times.push({ time: val, available: true });
        day.times.sort((x, y) => x.time.localeCompare(y.time));
        renderEditDays();
      });
    });
  }

  function openEditMode() {
    if (!currentItem) return;
    editMode = true;
    ['cm-about', 'cm-tags', 'cm-insights'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    document.getElementById('cm-edit-panel').classList.add('open');
    document.getElementById('cm-edit-bio-input').value = currentItem.about || '';
    editSlotsWorking = cloneSlotsForEdit(currentItem.availableSlots);
    renderEditDays();
  }

  function closeEditMode() {
    editMode = false;
    ['cm-about', 'cm-tags', 'cm-insights'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = ''; });
    const panel = document.getElementById('cm-edit-panel');
    if (panel) panel.classList.remove('open');
  }

  async function saveEditMode() {
    const saveBtn = document.getElementById('cm-edit-save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Kaydediliyor…';
    const bio = document.getElementById('cm-edit-bio-input').value.trim();
    const availableSlotsTemplate = editSlotsWorking.filter(d => d.times.length);
    try {
      const res = await fetch(`/api/consultant/${encodeURIComponent(currentItem.name)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consultantBio: bio, availableSlotsTemplate }),
      });
      if (!res.ok) { alert('Kaydedilemedi, tekrar dene.'); saveBtn.disabled = false; saveBtn.textContent = 'Kaydet'; return; }
      currentItem.about = bio;
      currentItem.availableSlots = availableSlotsTemplate;
      const aboutText = bio || `${currentItem.name} — MİMARLAB'da online mimari danışmanlık/mentörlük hizmeti veriyor.`;
      renderTruncatedDesc('cm-about', aboutText);
      weekOffset = 0;
      selectedDate = null;
      renderSlots(currentItem);
      closeEditMode();
    } catch {
      alert('Sunucuya ulaşılamadı, tekrar dene.');
    }
    saveBtn.disabled = false;
    saveBtn.textContent = 'Kaydet';
  }

  function wireEditPanel() {
    document.getElementById('cm-edit-cancel-btn').addEventListener('click', closeEditMode);
    document.getElementById('cm-edit-save-btn').addEventListener('click', saveEditMode);
  }

  async function loadRatingSummary(targetId) {
    const summaryEl = document.getElementById('cm-rating-summary');
    const emptyEl = document.getElementById('cm-rating-empty');
    try {
      const res = await fetch(`/api/ratings?targetType=architect&targetId=${encodeURIComponent(targetId)}`);
      const data = res.ok ? await res.json() : { average: 0, count: 0 };
      if (data.count) {
        summaryEl.innerHTML = renderRatingBadge(data.average, data.count);
        emptyEl.style.display = 'none';
      } else {
        summaryEl.innerHTML = '';
        emptyEl.style.display = 'block';
      }
    } catch {
      summaryEl.innerHTML = '';
      emptyEl.style.display = 'block';
    }
  }

  async function renderItem(payload) {
    const a = payload.item;
    const office = payload.office;
    const relatedProjectsData = payload.relatedProjects || [];
    const similar = payload.similar || [];
    currentItem = a;
    weekOffset = 0;
    selectedDate = null;
    closeEditMode();

    // bkz. js/components/project-modal.js#HIDE_ON_NOT_FOUND_IDS AYNI gerçek bulgu: bu liste
    // eskiden renderNotFound()'ın gizlediği ID kümesiyle EŞLEŞMİYORDU (cm-office-section,
    // cm-related-projects-section, cm-similar-section eksikti) — bir kez 404/ağ hatası alan bir
    // danışman modalı, ardından açılan başka bir danışmanda bu üç bölümü kalıcı olarak gizli
    // bırakırdı. Artık renderNotFound() ile AYNI sabit listeyi kullanıyor.
    HIDE_ON_NOT_FOUND_IDS.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = ''; });

    updateHeadMeta(a);
    document.getElementById('cm-name-text').textContent = a.name;
    document.getElementById('cm-category').innerHTML = `<strong>${escapeHtml([a.role, office ? office.name : null].filter(Boolean).join(' · '))}</strong>`;
    document.getElementById('cm-social-icons').innerHTML = socialIconsHtml(a.social_links);
    const aboutText = a.about || `${a.name} — MİMARLAB'da online mimari danışmanlık/mentörlük hizmeti veriyor.`;
    renderTruncatedDesc('cm-about', aboutText);

    document.getElementById('cm-tags').innerHTML = (a.expertiseTags || []).map(t => `<span class="cm-tag">${escapeHtml(t)}</span>`).join('');

    const insights = [];
    if ((a.sessionsCompleted || 0) > 50) insights.push({ icon: '🏆', title: 'Süper Mentör', desc: 'Yüksek puanlı ve hızlı yanıt veren danışmanlar arasında.' });
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

    const actionsEl = document.getElementById('cm-actions');
    actionsEl.innerHTML = '';
    const headerActions = ModalShell.getHeaderActionsSlot();
    if (headerActions) headerActions.innerHTML = '<span id="profile-edit-slot"></span>';

    // Sıralama Puanla → Kaydet → Paylaş (bkz. kullanıcı isteği) — Puanla önce eklenir, Kaydet
    // sonra appendChild edilir (actionsEl.innerHTML='' ile temizlendiği için prepend'e gerek yok),
    // Paylaş widget'ı Kaydet'ten hemen sonra (afterend) eklenir.
    const ratingEl = document.createElement('div');
    ratingEl.className = 'rating-widget';
    ratingEl.dataset.type = 'architect';
    ratingEl.dataset.key = a.name;
    actionsEl.appendChild(ratingEl);
    mountRatingWidget(ratingEl);
    loadRatingSummary(a.name);
    // Değerlendirmeler sekmesindeki standart yorum bileşeni — proje/mimar pop-up'larındaki AYNI
    // js/components/project-comments.js, targetType:'architect' ile (bkz. kullanıcı isteği: danışman
    // profili zaten bir architects satırı, bkz. dosya başı yorumu) — yeni bir backend GEREKMEZ.
    if (typeof ProjectComments !== 'undefined') {
      ProjectComments.mount(document.getElementById('cm-comments-section'), a.name, null, { targetType: 'architect' });
    }

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'save-btn card-save-btn';
    saveBtn.id = 'cm-save-btn';
    saveBtn.setAttribute('aria-label', 'Kaydet');
    saveBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z"/></svg><span class="save-btn-label-default">Kaydet</span><span class="save-btn-label-saved">Kaydedildi</span><span class="save-btn-count" id="cm-save-count"></span>`;
    actionsEl.appendChild(saveBtn);
    saveBtn.dataset.key = slugify(a.name);
    saveBtn.dataset.title = a.name;
    saveBtn.dataset.meta = office ? office.name : (a.role || '');
    saveBtn.dataset.image = a.photo || '';
    saveBtn.dataset.href = `/danisman/${encodeURIComponent(slugify(a.name))}`;
    wireSaveButtons('architect');
    fetch(`/api/public/save-count?type=architect&key=${encodeURIComponent(saveBtn.dataset.key)}`)
      .then(r => r.json())
      .then(data => { const el = document.getElementById('cm-save-count'); if (el) el.textContent = data.count > 0 ? ` (${data.count})` : ''; })
      .catch(() => {});
    if (typeof ShareWidget !== 'undefined') {
      saveBtn.insertAdjacentHTML('afterend', ShareWidget.html('cm-share-btn'));
      ShareWidget.wire('cm-share-btn', () => ({ title: a.name, url: `${window.location.origin}/danisman/${encodeURIComponent(slugify(a.name))}` }));
    }

    renderStructuredData(a);

    document.getElementById('cm-stat-minutes').textContent = `${(a.totalMinutes || 0).toLocaleString('tr-TR')} Dakika`;
    document.getElementById('cm-stat-sessions').textContent = (a.sessionsCompleted || 0).toLocaleString('tr-TR');
    renderSlots(a);

    document.getElementById('cm-office-section').style.display = office ? '' : 'none';
    if (office) {
      document.getElementById('cm-office-grid').innerHTML = cardHtml(
        `/firma/${encodeURIComponent(slugify(office.name))}`, office.name, office.logo, office.loc, verifiedBadgeHtml('office', office.name, office.badges, 14)
      );
    }

    document.getElementById('cm-related-projects-section').style.display = relatedProjectsData.length ? '' : 'none';
    document.getElementById('cm-related-projects-grid').innerHTML = relatedProjectsData.map(p =>
      cardHtml(`/projeler/${encodeURIComponent(p.slug)}`, p.title, p.images && p.images[0])
    ).join('');

    document.getElementById('cm-similar-section').style.display = similar.length ? '' : 'none';
    document.getElementById('cm-similar-grid').innerHTML = similar.map(c =>
      cardHtml(`/danisman/${encodeURIComponent(slugify(c.name))}`, c.name, c.photo, c.hourlyRate ? `₺${c.hourlyRate}` : '', verifiedBadgeHtml('architect', c.name, c.badges, 14))
    ).join('');

    function renderVerifiedBadges() {
      document.getElementById('cm-verified-badge-wrap').innerHTML = verifiedBadgeHtml('architect', a.name, a.badges, 20);
    }
    renderVerifiedBadges();
    window.addEventListener('mimarlab-badges-ready', renderVerifiedBadges, { once: true });

    // "Profili Düzenle" — claim-correction-box.js'i architect-modal.js ile AYNI şekilde kullanır
    // (bkz. dosya başı yorumu) — görünürlük (sahip/admin) tamamen o paylaşılan bileşenin işi.
    const claimBox = createClaimCorrectionBox({
      profileType: 'architect',
      ready: savedWidgetReady,
      getProfileKey: () => a.name,
      getClaimLinkKey: () => a._claimKey || a.name,
      getStaticBadges: () => a.badges,
      editUrlBase: 'mimar-ekle.html',
      listUrl: 'danisman.html',
      contentType: 'architects',
      getModerationTarget: () => ({ key: a.name }),
      // Danışman kendi profilini pop-up üzerinden inline düzenleyebilsin ve Sil/Arşivle de
      // kullanabilsin (bkz. kullanıcı isteği) — self-servis yetki kontrolü/uç noktaları
      // src/routes/consultant.js#authorizeConsultantSelf'te, mimar/ofis modalları ETKİLENMEZ.
      ownerCanModerate: true,
      moderateUrl: `/api/consultant/${encodeURIComponent(a.name)}/moderate`,
      onEditClick: () => openEditMode(),
      labels: {
        claimTitle: 'Bu profil sana mı ait?',
        loginPromptHtml: 'Bilgilerini güncellemek ve doğrulanmış üye rozeti almak için <a href="giris-yap.html" class="info-card-link">giriş yap</a>.',
        pendingHtml: '"Bu profil bana ait" talebini aldık, ekibimiz en kısa sürede onaylayacak.',
        claimNoteDescription: 'Bu profilin sana ait olduğunu doğrulayabileceğimiz bir not ekle.',
        claimButtonText: 'Gönder',
        deleteConfirm: 'Bu danışman profilini silmek istediğine emin misin? Profil anında canlı siteden kaldırılır.',
        archiveConfirm: 'Bu danışman profilini arşivlemek istediğine emin misin? Profil canlıdan kaldırılıp admin panelindeki Arşiv sekmesine taşınır.',
        editButtonText: 'Profili Düzenle',
      },
    });
    await savedWidgetReady;
    await claimBox.init();

    wireInternalNav();
    ModalShell.scrollToTop();
  }

  async function open(slug, { pushHistory = true, triggerEl = null } = {}) {
    currentSlug = slug;
    openedViaPush = pushHistory;
    pushCountSinceOpen = pushHistory ? 1 : 0;
    if (pushHistory) history.pushState({ mimarlabModal: 'consultant', slug, depth: 1 }, '', `/danisman/${encodeURIComponent(slug)}`);
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
    history.pushState({ mimarlabModal: 'consultant', slug, depth: pushCountSinceOpen }, '', `/danisman/${encodeURIComponent(slug)}`);
    const mySeq = ++requestSeq;
    const payload = await fetchItem(slug);
    if (mySeq !== requestSeq || currentSlug !== slug) return;
    if (!payload) { renderNotFound(); return; }
    await renderItem(payload);
  }

  function close() {
    currentSlug = null;
    currentItem = null;
    if (paymentOverlayEl) paymentOverlayEl.classList.remove('open');
    if (openedViaPush && pushCountSinceOpen > 0) history.go(-pushCountSinceOpen);
    else history.pushState({}, '', '/danisman');
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
