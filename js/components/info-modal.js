// InfoModal — Rozet Al/İade Et/İletişim/Hakkında/Gizlilik Politikası/Hizmet Şartları/Kariyer'i
// satin-al.html/iade-et.html/iletisim.html/hakkinda.html/gizlilik-politikasi.html/
// hizmet-sartlari.html/kariyer.html'in kendi tasarımını BİREBİR koruyarak (bkz. kullanıcı isteği)
// js/components/modal-shell.js üzerinde bir popup'a dönüştürür — js/components/auth-modal.js ile
// AYNI open/swap/close/handlePopState state machine deseni (bkz. o dosyanın başındaki yorum,
// birebir aynı gerekçe). Yedi görünüm TEK bir ModalShell mount'unu paylaşır, tek sütun (32/68
// ızgara değil) — bkz. aşağıdaki .modal-shell-body.info-single kuralı, auth-modal.js'teki
// .am-single ile AYNI amaç ama dosyalar arası bağımlılık olmasın diye kendi sınıfı var.
// Her sayfada modal-shell.js + auth-modal.js'ten HEMEN SONRA <script defer> ile dahil edilir
// (Rozet Al/İade Et giriş gerektirir — bkz. wireRozetAl/wireIadeEt, AuthModal'a değil doğrudan
// /giris'e yönlendirir, orijinal sayfaların DAVRANIŞI birebir korunur).
const InfoModal = (function () {
  const VIEW_PATH = {
    'rozet-al': '/rozet-al', 'iade-et': '/iade-et', 'iletisim': '/iletisim', 'hakkinda': '/hakkinda',
    'gizlilik-politikasi': '/gizlilik-politikasi', 'hizmet-sartlari': '/hizmet-sartlari', 'kariyer': '/kariyer',
    'cerez-politikasi': '/cerez-politikasi',
    // kullanıcı isteği (2026-09-06 madde 7): "Neden MİMARLAB? sayfası popup şeklinde açılsın".
    // Bağımsız statik sayfa (neden-mimarlab.html) KORUNUYOR ama artık yalnızca ?sunum=1 sunum modu
    // için servis ediliyor (bkz. src/index.js) — normal ziyaret bu popup'ı açar.
    'neden-mimarlab': '/neden-mimarlab',
  };
  const HREF_VIEW_RE = {
    'rozet-al': /(^|\/)satin-al\.html$/, 'iade-et': /(^|\/)iade-et\.html$/, 'iletisim': /(^|\/)iletisim\.html$/,
    'hakkinda': /(^|\/)hakkinda\.html$/, 'gizlilik-politikasi': /(^|\/)gizlilik-politikasi\.html$/,
    'hizmet-sartlari': /(^|\/)hizmet-sartlari\.html$/, 'kariyer': /(^|\/)kariyer\.html$/,
    'cerez-politikasi': /(^|\/)cerez-politikasi\.html$/,
    'neden-mimarlab': /(^|\/)neden-mimarlab\.html$/,
  };

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s === undefined || s === null ? '' : s; return d.innerHTML; }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  // Yedi sayfanın "---------- CONTENT ----------" / "checkout-wrap" bölümlerinin BİREBİR kopyası
  // (bkz. o dosyalardaki <style> blokları) — yalnızca her kuralın başına #im-panel eklenerek
  // scope'landı (bkz. js/components/auth-modal.js#STYLES'teki AYNI teknik/gerekçe). Nav/breadcrumb/
  // footer stilleri host sayfada zaten yüklü olduğundan buraya kopyalanmadı.
  const STYLES = `
    #im-panel{ font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:var(--ink); }
    #im-panel .content-wrap{max-width:760px; margin:0 auto; padding:8px 4px 24px;}
    #im-panel .content-eyebrow{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:12px; letter-spacing:0.14em; text-transform:uppercase; color:var(--sage); font-weight:600; margin-bottom:12px;}
    #im-panel .content-title{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:clamp(28px, 4vw, 38px); font-weight:700; margin:0 0 18px; letter-spacing:-0.01em;}
    #im-panel .content-lead{font-size:16px; line-height:1.7; color:var(--ink-soft); margin:0 0 36px;}
    #im-panel .content-updated{font-size:12.5px; color:var(--ink-soft); margin:0 0 24px;}
    #im-panel .content-toc{background:var(--paper-card); border:1px solid var(--line); border-radius:14px; padding:20px 24px; margin:0 0 36px;}
    #im-panel .content-toc h2{font-size:14px; margin:0 0 10px;}
    #im-panel .content-toc ol{margin:0; padding-left:20px; font-size:13.5px; line-height:1.9; color:var(--ink-soft); columns:2; column-gap:24px;}
    #im-panel .content-toc a{color:var(--ink-soft); font-weight:500; cursor:pointer;}
    #im-panel .content-section{margin-bottom:32px;}
    #im-panel .content-section h2{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:19px; font-weight:700; margin:0 0 10px;}
    #im-panel .content-section p{font-size:14.5px; line-height:1.75; color:var(--ink-soft); margin:0 0 12px;}
    #im-panel .content-section a{color:var(--walnut); font-weight:600; cursor:pointer;}
    #im-panel .content-section a:hover{text-decoration:underline;}
    #im-panel .content-section ul{margin:0; padding-left:20px; font-size:14.5px; line-height:1.8; color:var(--ink-soft);}
    #im-panel .cookie-table-wrap{overflow-x:auto; margin:0 0 16px; border:1px solid var(--line); border-radius:12px;}
    #im-panel .cookie-table{width:100%; border-collapse:collapse; font-size:13px;}
    #im-panel .cookie-table th, #im-panel .cookie-table td{text-align:left; padding:10px 14px; border-bottom:1px solid var(--line); vertical-align:top;}
    #im-panel .cookie-table th{background:var(--paper-card); color:var(--ink); font-weight:700; white-space:nowrap;}
    #im-panel .cookie-table td{color:var(--ink-soft);}
    #im-panel .cookie-table tr:last-child td{border-bottom:none;}
    #im-panel .cookie-badge{display:inline-block; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:10.5px; text-transform:uppercase; letter-spacing:0.04em; background:var(--paper-alt); color:var(--ink); border-radius:100px; padding:3px 9px; white-space:nowrap;}

    #im-panel .contact-card{background:var(--paper-card); border:1px solid var(--line); border-radius:16px; padding:24px; margin-bottom:32px; display:flex; align-items:center; gap:16px;}
    #im-panel .contact-card svg{flex-shrink:0; color:var(--walnut);}
    #im-panel .contact-card-email{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:19px; font-weight:700;}
    #im-panel .contact-card-email:hover{text-decoration:underline;}
    #im-panel .contact-card p{margin:2px 0 0; font-size:12.5px; color:var(--ink-soft);}
    #im-panel .contact-form-field{margin-bottom:14px;}
    #im-panel .contact-form-field label{display:block; font-size:13px; font-weight:600; margin-bottom:6px;}
    #im-panel .contact-form-field input, #im-panel .contact-form-field textarea{width:100%; padding:11px 14px; border-radius:10px; border:1px solid var(--line); background:var(--paper-card); font-family:inherit; font-size:14px; color:var(--ink);}
    #im-panel .contact-form-field textarea{min-height:120px; resize:vertical; line-height:1.5;}
    #im-panel .contact-form-field input:focus-visible, #im-panel .contact-form-field textarea:focus-visible{box-shadow:0 0 0 2px var(--brass);}
    #im-panel .contact-submit{background:var(--ink); color:var(--paper-card); border:none; padding:13px 26px; border-radius:100px; font-weight:600; font-size:14.5px;}
    #im-panel .contact-submit:hover{background:var(--walnut);}
    #im-panel .contact-submit:disabled{opacity:0.6; cursor:not-allowed;}
    #im-panel .contact-notice{display:none; margin-top:14px; padding:13px 16px; border-radius:10px; background:rgba(224,138,62,0.12); border:1px solid var(--accent); color:var(--ink); font-size:12.5px; line-height:1.6;}
    #im-panel .contact-notice.show{display:block;}
    #im-panel .contact-notice.success{background:rgba(62,122,85,0.12); border-color:#3E7A55;}

    #im-panel .jobs-card{background:var(--paper-card); border:1px dashed var(--brass); border-radius:14px; padding:22px; margin-bottom:32px;}
    #im-panel .jobs-card strong{display:block; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:16px; font-weight:700; margin-bottom:6px;}
    #im-panel .jobs-card p{margin:0; font-size:13.5px; color:var(--ink-soft); line-height:1.6;}
    #im-panel .jobs-card a{color:var(--walnut); font-weight:600;}
    #im-panel .cta-card{background:var(--ink); color:var(--paper-card); border-radius:16px; padding:28px; text-align:center;}
    #im-panel .cta-card p{color:rgba(237,240,243,0.7); font-size:13.5px; margin:6px 0 18px;}
    #im-panel .cta-btn{display:inline-block; background:var(--paper-card); color:var(--ink); padding:12px 24px; border-radius:100px; font-weight:600; font-size:14px;}
    #im-panel .cta-btn:hover{background:var(--brass-soft);}

    #im-panel .page-head{max-width:820px; margin:0 auto; padding:0 4px 0; text-align:center;}
    #im-panel .page-head .eyebrow{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:12px; letter-spacing:0.14em; text-transform:uppercase; color:var(--sage); font-weight:600; margin-bottom:10px;}
    #im-panel .page-head h1{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:30px; font-weight:700; margin:0 0 8px;}
    #im-panel .page-head p{color:var(--ink-soft); font-size:14.5px; margin:0;}
    #im-panel .checkout-wrap{max-width:820px; margin:0 auto; padding:24px 4px 24px;}
    #im-panel .form-section{background:var(--paper-card); border:1px solid var(--line); border-radius:16px; padding:26px; margin-bottom:20px;}
    #im-panel .form-section h2{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:17px; font-weight:700; margin:0 0 4px;}
    #im-panel .form-section .section-hint{font-size:12.5px; color:var(--ink-soft); margin:0 0 18px; line-height:1.6;}
    #im-panel .form-submit{width:100%; background:var(--ink); color:var(--paper-card); border:none; padding:14px; border-radius:100px; font-weight:600; font-size:15px;}
    #im-panel .form-submit:hover{background:var(--walnut);}
    #im-panel .form-submit:disabled{background:var(--paper-alt); color:var(--ink-soft); cursor:default;}
    #im-panel .form-notice{display:none; margin-top:16px; padding:13px 16px; border-radius:10px; background:rgba(224,138,62,0.12); border:1px solid var(--accent); color:var(--ink); font-size:12.5px; line-height:1.6;}
    #im-panel .form-notice.success{background:rgba(62,122,85,0.12); border-color:#3E7A55;}
    #im-panel .form-notice.show{display:block;}
    #im-panel .target-option{display:flex; align-items:center; gap:9px; font-size:14px; font-weight:500; cursor:pointer; padding:9px 4px;}
    #im-panel .target-option input{width:17px; height:17px; accent-color:var(--walnut); flex-shrink:0;}
    #im-panel .target-office-select{width:100%; padding:11px 14px; border-radius:10px; border:1px solid var(--line); background:var(--paper); font-family:inherit; font-size:14px; color:var(--ink);}

    #im-panel .tier-grid{display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:8px;}
    #im-panel .tier-card{position:relative; text-align:left; background:var(--paper-card); border:2px solid var(--line-soft); border-radius:14px; padding:16px; cursor:pointer; transition:border-color .15s ease, box-shadow .15s ease;}
    #im-panel .tier-card:hover{border-color:var(--brass);}
    #im-panel .tier-card.selected{border-color:var(--ink); box-shadow:0 4px 16px rgba(27,42,61,0.08);}
    #im-panel .tier-card-check{position:absolute; top:14px; right:14px; width:20px; height:20px; border-radius:50%; border:1.5px solid var(--line); background:var(--paper); display:flex; align-items:center; justify-content:center;}
    #im-panel .tier-card.selected .tier-card-check{background:var(--ink); border-color:var(--ink); color:var(--paper-card);}
    #im-panel .tier-card-name{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:16px; font-weight:700; margin-bottom:4px; padding-right:26px;}
    #im-panel .tier-card-price{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:13.5px; color:var(--sage); margin-bottom:6px;}
    #im-panel .tier-card-perks{font-size:12px; color:var(--ink-soft); line-height:1.5; margin:0; padding-left:15px;}
    #im-panel .tier-card-perks li{margin-bottom:3px;}
    #im-panel .tier-card-perks li:last-child{margin-bottom:0;}
    #im-panel .already-has{text-align:center; padding:10px 4px;}
    #im-panel .already-has strong{display:block; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:17px; margin-bottom:6px;}
    #im-panel .already-has p{color:var(--ink-soft); font-size:13.5px; margin:0 0 16px; line-height:1.6;}

    #im-panel .field{margin-bottom:14px;}
    #im-panel .field:last-child{margin-bottom:0;}
    #im-panel .field label{display:block; font-size:13px; font-weight:600; margin-bottom:6px;}
    #im-panel .field input, #im-panel .field select, #im-panel .field textarea{width:100%; padding:11px 14px; border-radius:10px; border:1px solid var(--line); background:var(--paper); font-family:inherit; font-size:14px; color:var(--ink);}
    #im-panel .field textarea{resize:vertical; min-height:90px; line-height:1.5;}
    #im-panel .field input:focus-visible, #im-panel .field select:focus-visible, #im-panel .field textarea:focus-visible{box-shadow:0 0 0 2px var(--brass);}
    #im-panel .field-hint{font-size:12px; color:var(--ink-soft); margin:6px 0 0;}
    #im-panel .order-empty{text-align:center; padding:10px 4px;}
    #im-panel .order-empty p{color:var(--ink-soft); font-size:13.5px; margin:0 0 16px; line-height:1.6;}

    @media (max-width:720px){ #im-panel .tier-grid{grid-template-columns:1fr;} }

    /* Rozet Al/İade Et/İletişim/Hakkında/vb. modal-shell'in 32/68 ızgarasına DEĞİL, ortalı tek sütun
       biçimine ihtiyaç duyar (bkz. dosya başı yorumu — js/components/auth-modal.js#.am-single ile
       AYNI amaç, dosyalar arası bağımlılık olmasın diye ayrı sınıf). */
    .modal-shell-body.info-single{display:block;}

    /* ================= NEDEN MİMARLAB? (kullanıcı isteği, 2026-09-06 madde 7) =================
       neden-mimarlab.html'in KENDİ <style>'ından alınan, YALNIZCA içeriğe ait kurallar; her birinin
       başına #im-panel eklenerek scope'landı (bu dosyadaki diğer sekiz görünümle AYNI teknik).
       O sayfanın nav/breadcrumb/footer/sunum-modu kuralları BİLEREK alınmadı — hiçbiri modalda yok.
       .im-nm sınıfı bu görünüme özgüdür: diğer InfoModal görünümleri ortalanmış dar bir metin
       sütunu, bu ise kenardan kenara renkli bantlar kullanır. */
    /* Bantların panel kenarına dayanabilmesi için sol panelin kendi 64/32px'lik iç boşluğu
       kaldırılır; üstteki X butonunun altında kalma işini hero'nun kendi padding-top'u yapar. */
    .modal-shell-body.info-single.info-nm .modal-shell-left{padding:0; border-right:none;}
    /* Panel zemini --paper-card; .band-alt de --paper-card olduğundan o bantlar görünmez kalırdı —
       kök zemin, orijinal sayfadaki gibi --paper'a çekilir. */
    /* GERÇEK BULGU (yerel doğrulamada yakalandı): bu içerik artık BAŞKA bir sayfanın DOM'una
       enjekte ediliyor ve o sayfaların KENDİ <style>'ları .hero/.sec/.btn/.card/.stats gibi jenerik
       sınıflara kural yazıyor — ör. index.html'in ".hero{text-align:center}" kuralı modaldeki
       başlığı ortalıyordu. Bu yüzden şablondaki TÜM jenerik sınıf adları "nm-" ile öneklendi;
       aşağıdaki seçiciler de onlarla eşleşir. text-align:left ise ek bir güvenlik ağı: kalıtımla
       gelen (seçicisi bizim alt ağacımızı hedeflemeyen) bir hizalama bu kökte kesilir. */
    #im-panel.im-nm{background:var(--paper); color:var(--ink); text-align:left;}
    /* Koyu bant, orijinal sayfadaki AYNI token override'ı (bkz. neden-mimarlab.html) */
    [data-theme="dark"] #im-panel.im-nm .nm-band-dark{
      --ink:#17202B; --ink-soft:#1E2836; --paper:#EDF0F3; --paper-card:#232C38; --brass-soft:#AFC5D8; --brass:#5B7A9B;
    }
    #im-panel.im-nm .nm-wrap{max-width:1180px; margin:0 auto; padding:0 32px;}
    #im-panel.im-nm .nm-sec{padding:78px 0; border-top:1px solid var(--line-soft);}
    #im-panel.im-nm .nm-sec:first-child{border-top:none;}
    #im-panel.im-nm h3{font-size:17px; font-weight:700; margin:0 0 8px; letter-spacing:-0.005em;}
    #im-panel.im-nm .nm-sec p{font-size:14.8px; line-height:1.74; color:var(--ink-soft);}
    #im-panel.im-nm .nm-band-dark{background:var(--ink); color:var(--paper); border-top:none;}
    #im-panel.im-nm .nm-band-dark p{color:rgba(237,240,243,0.72);}
    #im-panel.im-nm .nm-band-alt{background:var(--paper-card);}
    #im-panel.im-nm a{color:inherit; text-decoration:none;}
    #im-panel.im-nm img{max-width:100%;}

    #im-panel.im-nm .nm-btn{display:inline-flex; align-items:center; gap:8px; border-radius:100px; padding:13px 24px; font-size:14.5px; font-weight:600; border:1.5px solid var(--ink); background:var(--ink); color:var(--paper); font-family:inherit; cursor:pointer; transition:transform .15s ease, background .15s ease, color .15s ease;}
    #im-panel.im-nm .nm-btn:hover{transform:translateY(-1px);}
    #im-panel.im-nm .nm-btn-ghost{background:transparent; color:var(--ink);}
    #im-panel.im-nm .nm-btn-ghost:hover{background:var(--ink); color:var(--paper);}
    #im-panel.im-nm .nm-band-dark .nm-btn{background:var(--paper); color:var(--ink); border-color:var(--paper);}
    #im-panel.im-nm .nm-band-dark .nm-btn-ghost{background:transparent; color:var(--paper); border-color:rgba(237,240,243,0.45);}
    #im-panel.im-nm .nm-band-dark .nm-btn-ghost:hover{background:var(--paper); color:var(--ink);}
    #im-panel.im-nm .nm-btn-row{display:flex; flex-wrap:wrap; gap:12px;}

    #im-panel.im-nm .nm-cards{display:grid; gap:16px; grid-template-columns:repeat(4, 1fr);}
    #im-panel.im-nm .nm-card{background:var(--paper-card); border:1px solid var(--line); border-radius:14px; padding:22px 20px; min-width:0; display:block; transition:border-color .15s ease, transform .15s ease;}
    #im-panel.im-nm .nm-card p{margin:0; font-size:14px; line-height:1.65;}
    #im-panel.im-nm .nm-band-alt .nm-card{background:var(--paper);}
    #im-panel.im-nm a.nm-card:hover{border-color:var(--ink); transform:translateY(-2px);}
    #im-panel.im-nm #nm-file-showcase:empty{display:none;}
    #im-panel.im-nm .nm-tag-now{display:inline-block; font-size:10.5px; font-weight:700; letter-spacing:0.09em; text-transform:uppercase; padding:4px 9px; border-radius:100px; margin-bottom:10px; background:var(--brass-soft); color:var(--walnut);}

    #im-panel.im-nm .nm-sr{position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap;}
    /* padding-top: panelin sol üst köşesindeki X + aksiyon satırının (top:16px, 36px) ALTINDAN
       başlaması gerekir — orijinal sayfadaki clamp değeri zaten bu payı fazlasıyla veriyor. */
    #im-panel.im-nm .nm-hero{padding-top:clamp(64px,9vw,120px); padding-bottom:clamp(40px,6vw,80px);}
    #im-panel.im-nm .nm-h1{font-size:clamp(34px,6.4vw,76px); line-height:1.04; letter-spacing:-0.03em; margin:0 0 18px; font-weight:700;}
    #im-panel.im-nm .nm-accent{color:var(--walnut);}
    #im-panel.im-nm .nm-lead{font-size:clamp(15px,2vw,21px); color:var(--ink-soft); margin:0 0 26px; max-width:46ch;}
    #im-panel.im-nm .nm-h2{font-size:clamp(22px,3.4vw,38px); letter-spacing:-0.02em; line-height:1.2; margin:0 0 26px; font-weight:700;}
    #im-panel.im-nm .nm-note{font-size:12.5px; color:var(--ink-soft); margin-top:18px;}

    #im-panel.im-nm .nm-stats{display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:clamp(14px,2.5vw,34px);}
    #im-panel.im-nm .nm-stat{display:flex; flex-direction:column; gap:4px; text-align:left;}
    #im-panel.im-nm .nm-num{font-size:clamp(34px,6vw,68px); font-weight:700; line-height:1; letter-spacing:-0.03em;}
    #im-panel.im-nm .nm-lab{font-size:11.5px; text-transform:uppercase; letter-spacing:0.1em; opacity:.7;}

    #im-panel.im-nm .nm-graph{margin:0 auto; max-width:900px;}
    #im-panel.im-nm .nm-graph svg{width:100%; height:auto; display:block; color:var(--line);}
    #im-panel.im-nm .nm-graph .nm-edge{opacity:.85;}
    #im-panel.im-nm .nm-graph .nm-node circle{fill:var(--paper-card); stroke:var(--line); stroke-width:1.5;}
    #im-panel.im-nm .nm-graph .nm-node text{text-anchor:middle; fill:var(--ink); font-size:15px; font-weight:700; letter-spacing:0.04em;}
    #im-panel.im-nm .nm-graph .nm-node text.nm-sub{font-size:11px; font-weight:500; fill:var(--ink-soft); letter-spacing:0;}

    #im-panel.im-nm .nm-roles{display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:16px;}
    /* 3 ADIM + KARŞILAŞTIRMA (kullanıcı isteği, 2026-09-10 on birinci tur madde 3) — neden-mimarlab.html
       (sunum modu) ile AYNI blok, #im-panel.im-nm ile scope'lu. */
    #im-panel.im-nm .nm-steps{display:grid; grid-template-columns:repeat(3,1fr); gap:18px; margin-top:6px;}
    #im-panel.im-nm .nm-step{position:relative; padding:26px 22px 22px; border:1px solid var(--line); border-radius:16px; background:var(--paper-card); overflow:hidden;}
    #im-panel.im-nm .nm-step-ico{width:54px; height:54px; border-radius:14px; display:flex; align-items:center; justify-content:center; background:var(--paper-alt); color:var(--walnut); margin-bottom:16px; transition:background .35s ease, color .35s ease;}
    #im-panel.im-nm .nm-step-ico svg{width:26px; height:26px;}
    #im-panel.im-nm .nm-step-no{position:absolute; top:16px; right:18px; font-size:44px; font-weight:800; letter-spacing:-0.04em; color:var(--line); line-height:1;}
    #im-panel.im-nm .nm-step h3{margin:0 0 6px; font-size:16.5px;}
    #im-panel.im-nm .nm-step p{margin:0; font-size:13.5px;}
    #im-panel.im-nm .nm-step::after{content:''; position:absolute; left:0; bottom:0; height:3px; width:0; background:var(--brass); transition:width .9s ease;}
    #im-panel.im-nm .nm-step.is-on::after{width:100%;}
    #im-panel.im-nm .nm-step.is-on .nm-step-ico{background:var(--ink); color:var(--paper);}
    #im-panel.im-nm .nm-compare{margin-top:34px; border:1px solid var(--line); border-radius:16px; overflow:hidden; background:var(--paper-card);}
    #im-panel.im-nm .nm-compare-row{display:grid; grid-template-columns:1.4fr 1fr 1fr; align-items:center; border-top:1px solid var(--line-soft);}
    #im-panel.im-nm .nm-compare-row:first-child{border-top:none; background:var(--paper-alt);}
    #im-panel.im-nm .nm-compare-row > div{padding:13px 16px; font-size:13.5px; color:var(--ink-soft);}
    #im-panel.im-nm .nm-compare-row > div:first-child{color:var(--ink); font-weight:600;}
    #im-panel.im-nm .nm-compare-row:first-child > div{font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-soft);}
    #im-panel.im-nm .nm-compare-row:first-child > div:last-child{color:var(--walnut);}
    #im-panel.im-nm .nm-compare-cell{display:flex; align-items:center; gap:8px;}
    #im-panel.im-nm .nm-compare-cell svg{width:18px; height:18px; flex-shrink:0;}
    #im-panel.im-nm .nm-compare-no{color:#B84C4C;}
    #im-panel.im-nm .nm-compare-yes{color:var(--sage, #4c7c59); font-weight:600;}
    #im-panel.im-nm .nm-compare-row > div:last-child{background:rgba(224,138,62,0.06);}
    @media (max-width:720px){
      #im-panel.im-nm .nm-steps{grid-template-columns:1fr;}
      #im-panel.im-nm .nm-compare-row{grid-template-columns:1.2fr 1fr 1fr;}
      #im-panel.im-nm .nm-compare-row > div{padding:11px 10px; font-size:12.5px;}
    }
    @media (prefers-reduced-motion: reduce){ #im-panel.im-nm .nm-step::after{transition:none;} #im-panel.im-nm .nm-step-ico{transition:none;} }
    #im-panel.im-nm .nm-role{display:block; padding:26px 22px; border:1px solid var(--line); border-radius:16px; background:var(--paper-card); color:var(--ink); transition:border-color .15s ease, transform .15s ease;}
    #im-panel.im-nm .nm-role:hover{border-color:var(--walnut); transform:translateY(-2px);}
    #im-panel.im-nm .nm-role svg{width:30px; height:30px; color:var(--walnut); margin-bottom:14px;}
    #im-panel.im-nm .nm-role h3{margin:0 0 6px; font-size:17px;}
    #im-panel.im-nm .nm-role p{margin:0; font-size:13.5px; color:var(--ink-soft); line-height:1.5;}

    /* Görselden ürüne (işaretçi) gösterimi — aspect-ratio, görsel yüklenmeden önce alanı ayırır. */
    #im-panel.im-nm .nm-tag-stage{position:relative; border-radius:14px; overflow:hidden; background:var(--paper-alt); max-width:900px; margin:0 auto; aspect-ratio:4/3;}
    #im-panel.im-nm .nm-tag-stage img{width:100%; height:100%; object-fit:cover; display:block;}
    /* İşaretçi rengi js/components/image-hotspots.js#.ih-dot ile BİREBİR aynı — proje popup'ındaki
       işaretçiyle bu gösterim görsel olarak ayrışmasın. */
    #im-panel.im-nm .nm-dot{position:absolute; width:26px; height:26px; margin:-13px 0 0 -13px; border-radius:50%; border:2.5px solid #fff; background:rgba(255,255,255,.35); backdrop-filter:blur(2px); cursor:pointer; box-shadow:0 2px 10px rgba(15,19,26,.45); display:flex; align-items:center; justify-content:center; padding:0; transition:background .18s ease, transform .18s ease;}
    #im-panel.im-nm .nm-dot::after{content:''; width:9px; height:9px; border-radius:50%; background:#fff;}
    #im-panel.im-nm .nm-dot:hover, #im-panel.im-nm .nm-dot:focus-visible, #im-panel.im-nm .nm-dot.is-open{background:var(--accent,#E08A3E); transform:scale(1.12);}
    #im-panel.im-nm .nm-tagcard{position:absolute; z-index:3; display:none; gap:10px; align-items:center; width:230px; padding:9px; border-radius:12px; background:var(--paper-card); box-shadow:0 10px 30px rgba(15,19,26,.28); border:1px solid var(--line); text-align:left;}
    #im-panel.im-nm .nm-tagcard.open{display:flex;}
    #im-panel.im-nm .nm-tagcard.flip{transform:translateX(-100%);}
    #im-panel.im-nm .nm-tagcard img{width:56px; height:56px; object-fit:cover; border-radius:8px; flex:0 0 auto; background:var(--paper-alt);}
    #im-panel.im-nm .nm-tagcard b{display:block; font-size:13px; line-height:1.25; color:var(--ink);}
    #im-panel.im-nm .nm-tagcard span{font-size:11.5px; color:var(--ink-soft);}

    #im-panel.im-nm .nm-funnel{position:relative; max-width:620px; margin:0 auto; aspect-ratio:2/1; overflow:hidden;}
    #im-panel.im-nm .nm-ring{position:absolute; left:50%; bottom:0; transform:translateX(-50%); border-radius:999px 999px 0 0; display:flex; align-items:flex-start; justify-content:center; padding-top:clamp(8px,1.6vw,16px); color:#fff; font-weight:700; font-size:clamp(10px,1.5vw,13.5px); letter-spacing:.01em; text-align:center;}
    #im-panel.im-nm .nm-ring span{max-width:80%;}
    #im-panel.im-nm .nm-ring-4{width:100%; aspect-ratio:2/1; background:#1D6FF2;}
    #im-panel.im-nm .nm-ring-3{width:76%; aspect-ratio:2/1; background:#3B85F5;}
    #im-panel.im-nm .nm-ring-2{width:52%; aspect-ratio:2/1; background:#63A0F8;}
    #im-panel.im-nm .nm-ring-1{width:28%; aspect-ratio:2/1; background:#8FBCFB;}

    /* Marka duvarı — tam 2 satır x 8 = 16 marka; dar ekranda 4 ve 2'ye düşer (16 öğe her durumda
       tam satır doldurur: 8x2, 4x4, 2x8). */
    #im-panel.im-nm .nm-brandwall{display:grid; grid-template-columns:repeat(8,1fr); gap:12px; align-items:center;}
    #im-panel.im-nm .nm-brand{display:flex; align-items:center; justify-content:center; min-height:64px; padding:10px 12px; border:1px solid var(--line); border-radius:12px; background:var(--paper-card); font-size:13px; font-weight:600; color:var(--ink-soft); text-align:center; line-height:1.2;}
    #im-panel.im-nm .nm-brand:hover{color:var(--ink); border-color:var(--walnut);}
    #im-panel.im-nm .nm-brand img{max-width:100%; max-height:40px; object-fit:contain;}

    #im-panel.im-nm .nm-free-card{max-width:460px; margin:0 auto; padding:30px 28px; border-radius:18px; border:1px solid var(--line); background:var(--paper-card); text-align:center;}
    #im-panel.im-nm .nm-free-card h2{margin:0 0 4px; font-size:22px;}
    #im-panel.im-nm .nm-free-sub{margin:0 0 16px; font-size:13.5px; color:var(--ink-soft);}
    #im-panel.im-nm .nm-free-price{font-size:clamp(30px,5vw,46px); font-weight:700; color:var(--walnut); margin-bottom:18px; letter-spacing:-.02em;}
    #im-panel.im-nm .nm-free-list{list-style:none; margin:0 0 22px; padding:0; text-align:left;}
    #im-panel.im-nm .nm-free-list li{position:relative; padding:7px 0 7px 26px; font-size:13.5px; border-top:1px solid var(--line);}
    #im-panel.im-nm .nm-free-list li:first-child{border-top:none;}
    #im-panel.im-nm .nm-free-list li::before{content:''; position:absolute; left:4px; top:13px; width:9px; height:5px; border-left:2px solid var(--walnut); border-bottom:2px solid var(--walnut); transform:rotate(-45deg);}

    #im-panel.im-nm .nm-mfg, #im-panel.im-nm .nm-firm{display:grid; grid-template-columns:minmax(0,0.9fr) minmax(0,1.1fr); gap:clamp(20px,4vw,54px); align-items:center;}
    #im-panel.im-nm .nm-mfg-list{list-style:none; margin:0 0 20px; padding:0;}
    #im-panel.im-nm .nm-mfg-list li{position:relative; padding:7px 0 7px 20px; font-size:13.5px; color:var(--ink-soft); line-height:1.5;}
    #im-panel.im-nm .nm-mfg-list li::before{content:''; position:absolute; left:2px; top:15px; width:6px; height:6px; border-radius:50%; background:var(--accent,#E08A3E);}
    #im-panel.im-nm .nm-mfg-media .nm-tag-stage{aspect-ratio:4/3;}

    /* Firma popup ÖNİZLEMESİ — sitedeki gerçek popup'ın (js/components/office-modal.js) düzenini
       yansıtır; içeriği CANLI (/api/office/:slug), ekran görüntüsü değil. */
    #im-panel.im-nm .nm-pop{border:1px solid var(--line); border-radius:18px; overflow:hidden; background:var(--paper-card); box-shadow:0 18px 50px rgba(15,19,26,.18);}
    #im-panel.im-nm .nm-pop-body{display:grid; grid-template-columns:minmax(0,0.78fr) minmax(0,1.22fr); min-height:280px;}
    #im-panel.im-nm .nm-pop-left{padding:16px; border-right:1px solid var(--line);}
    #im-panel.im-nm .nm-pop-chrome{display:flex; align-items:center; gap:7px; margin-bottom:14px;}
    #im-panel.im-nm .nm-pop-cbtn{width:26px; height:26px; border-radius:50%; border:1px solid var(--line); background:var(--paper); display:flex; align-items:center; justify-content:center; color:var(--ink-soft);}
    #im-panel.im-nm .nm-pop-cbtn svg{width:12px; height:12px;}
    #im-panel.im-nm .nm-pop-follow{margin-left:2px; padding:5px 12px; border-radius:100px; border:1px solid var(--line); background:var(--paper); font-size:11px; font-weight:600; color:var(--ink);}
    #im-panel.im-nm .nm-pop-logo{width:46px; height:46px; border-radius:50%; overflow:hidden; margin-bottom:8px; border:1px solid var(--line); background:var(--paper); display:flex; align-items:center; justify-content:center;}
    #im-panel.im-nm .nm-pop-logo img{width:100%; height:100%; object-fit:contain; padding:6px; box-sizing:border-box;}
    #im-panel.im-nm .nm-pop-name{font-size:16px; font-weight:700; line-height:1.2; margin:0 0 9px;}
    #im-panel.im-nm .nm-pop-links{display:flex; flex-wrap:wrap; gap:9px; margin-bottom:11px; font-size:11px; color:var(--ink-soft);}
    #im-panel.im-nm .nm-pop-facts{list-style:none; margin:0 0 11px; padding:0;}
    #im-panel.im-nm .nm-pop-facts li{display:flex; gap:6px; font-size:11px; color:var(--ink-soft); padding:2.5px 0; line-height:1.4;}
    #im-panel.im-nm .nm-pop-facts svg{width:12px; height:12px; flex:0 0 auto; margin-top:2px; color:var(--ink-soft);}
    #im-panel.im-nm .nm-pop-facts b{color:var(--ink); font-weight:600;}
    #im-panel.im-nm .nm-pop-about{font-size:11px; line-height:1.55; color:var(--ink-soft); margin:0 0 12px; display:-webkit-box; -webkit-line-clamp:6; -webkit-box-orient:vertical; overflow:hidden;}
    #im-panel.im-nm .nm-pop-acc{border:1px solid var(--line); border-radius:9px; background:var(--paper); padding:9px 11px; font-size:11.5px; font-weight:600; display:flex; justify-content:space-between; margin-top:7px;}
    #im-panel.im-nm .nm-pop-acc span:last-child{color:var(--ink-soft); font-weight:400;}
    #im-panel.im-nm .nm-pop-right{padding:16px; min-width:0;}
    #im-panel.im-nm .nm-pop-h{font-size:12.5px; font-weight:700; margin:0 0 9px;}
    #im-panel.im-nm .nm-pop-sep{height:1px; background:var(--line); margin:16px 0 14px;}
    #im-panel.im-nm .nm-pop-people{display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:11px; max-width:340px;}
    #im-panel.im-nm .nm-pop-person{border:1px solid var(--line); border-radius:11px; overflow:hidden; background:var(--paper);}
    #im-panel.im-nm .nm-pop-person img{width:100%; aspect-ratio:1/1; object-fit:cover; display:block; background:var(--paper-alt);}
    #im-panel.im-nm .nm-pop-person div{padding:7px 9px;}
    #im-panel.im-nm .nm-pop-person b{display:block; font-size:11.5px; line-height:1.2;}
    #im-panel.im-nm .nm-pop-person span{font-size:10.5px; color:var(--ink-soft);}
    #im-panel.im-nm .nm-pop-projects{display:flex; gap:10px; overflow-x:auto; padding-bottom:4px; scrollbar-width:thin;}
    #im-panel.im-nm .nm-pop-map{margin-top:14px; border-radius:10px; overflow:hidden; border:1px solid var(--line); height:260px; background:var(--paper-alt);}
    #im-panel.im-nm .nm-pop-map .leaflet-container{width:100%; height:100%; background:var(--paper-alt); font-family:inherit;}
    #im-panel.im-nm .nm-pop-proj{flex:0 0 118px; color:inherit; border:1px solid var(--line); border-radius:11px; overflow:hidden; background:var(--paper);}
    #im-panel.im-nm .nm-pop-proj img{width:100%; aspect-ratio:4/3; object-fit:cover; display:block; background:var(--paper-alt);}
    #im-panel.im-nm .nm-pop-proj span{display:block; font-size:10.5px; padding:7px 8px 9px; line-height:1.3; font-weight:600; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}

    @media (prefers-reduced-motion: reduce){
      #im-panel.im-nm .nm-btn:hover, #im-panel.im-nm a.nm-card:hover, #im-panel.im-nm .nm-role:hover{transform:none;}
    }
    @media (max-width:1080px){ #im-panel.im-nm .nm-cards{grid-template-columns:repeat(2, 1fr);} }
    @media (max-width:900px){ #im-panel.im-nm .nm-brandwall{grid-template-columns:repeat(4,1fr);} }
    @media (max-width:860px){
      #im-panel.im-nm .nm-mfg, #im-panel.im-nm .nm-firm{grid-template-columns:1fr;}
      /* ≤860px'te modal-shell .modal-shell-left'i display:contents yapar (bkz. modal-shell.js) —
         iç boşluk artık .modal-shell-body'den gelir, .wrap kendi yatay padding'ini bırakır. */
      #im-panel.im-nm .nm-wrap{padding:0;}
      #im-panel.im-nm .nm-sec{padding:44px 0;}
      #im-panel.im-nm .nm-hero{padding-top:8px;}
      /* Bantlar mobilde gövde padding'inin içinde kaldığından kenardan kenara uzanmaz; renk yine de
         bölümü ayırt ettirsin diye kendi iç boşluğunu/yuvarlatmasını alır. */
      #im-panel.im-nm .nm-band-dark, #im-panel.im-nm .nm-band-alt{padding-left:16px; padding-right:16px; border-radius:14px;}
    }
    @media (max-width:820px){
      #im-panel.im-nm .nm-stats{grid-template-columns:repeat(2, 1fr);}
      #im-panel.im-nm .nm-pop-map{height:200px;}
    }
    @media (max-width:700px){
      #im-panel.im-nm .nm-pop-body{grid-template-columns:1fr;}
      #im-panel.im-nm .nm-pop-left{border-right:none; border-bottom:1px solid var(--line);}
    }
    @media (max-width:560px){
      #im-panel.im-nm .nm-cards{grid-template-columns:1fr;}
      #im-panel.im-nm .nm-btn{padding:12px 20px; font-size:14px;}
      #im-panel.im-nm .nm-btn-row .nm-btn{flex:1 1 100%; justify-content:center;}
    }
    @media (max-width:480px){ #im-panel.im-nm .nm-brandwall{grid-template-columns:repeat(2,1fr);} }
  `;
  function ensureStyles() {
    if (document.getElementById('info-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'info-modal-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------------------------------
  // HAKKINDA — hakkinda.html#content-wrap ile BİREBİR aynı işaretleme (bkz. o dosya). Tamamen
  // statik, wiring gerekmez.
  // ---------------------------------------------------------------------------------------------
  function hakkindaTemplate() {
    return `
    <div class="content-wrap">
      <div class="content-eyebrow">Kurumsal</div>
      <h1 class="content-title">MİMARLAB Hakkında</h1>
      <p class="content-updated">Son güncelleme: 8 Eylül 2026</p>
      <p class="content-lead">MİMARLAB; mimarlık, iç mimarlık, peyzaj mimarlığı, restorasyon ve ürün tasarımı alanlarındaki projeleri, kişileri, firmaları, markaları ve ürünleri tek bir ağda birbirine bağlayan bağımsız bir dizin ve topluluk platformudur.</p>

      <div class="content-section" id="im-hk-ne-sunuyoruz">
        <h2>Ne sunuyoruz?</h2>
        <p>Türkiye'deki mimarlık ve tasarım ekosistemini tek bir çatı altında topluyoruz:</p>
        <ul>
          <li><strong>Proje arşivi</strong> — geçmişten günümüze öne çıkan projeleri tür, tip, yer, yıl ve tasarımcısına göre filtreleyerek keşfedebilir; görsel üzerindeki ürün işaretçileriyle projede kullanılan ürünlere ulaşabilirsiniz.</li>
          <li><strong>Kişi profilleri</strong> — mimar, iç mimar, peyzaj mimarı, tasarımcı ve fotoğrafçıların profillerini, projelerini ve portfolyolarını inceleyebilirsiniz.</li>
          <li><strong>Firma ve marka profilleri</strong> — mimarlık ofislerinin ve üretici markaların kadrosunu, projelerini ve ürünlerini görebilirsiniz.</li>
          <li><strong>Ürün kataloğu</strong> — projelerde kullanılan mobilya, aydınlatma, aksesuar ve yapı malzemelerini marka, kategori ve kullanıldığı projelere göre keşfedebilirsiniz.</li>
          <li><strong>Gündem</strong> — mimarlık ve tasarım yayınlarından derlenen haber akışını, her haberin kaynağına bağlantı vererek tek bir yerde sunuyoruz.</li>
          <li><strong>Görsel arama</strong> — bir fotoğraf yükleyerek MİMARLAB'daki ilgili proje ve ürünleri bulabilirsiniz.</li>
          <li><strong>Puanlama, yorum, kaydetme ve koleksiyonlar</strong> — projelere, ürünlere ve profillere puan verebilir, yorum yapabilir, beğendiğiniz içerikleri kaydedip panolar hâlinde düzenleyebilirsiniz.</li>
          <li><strong>Mesajlaşma ve görüşme</strong> — sahiplenilmiş profillere mesaj gönderebilir, birebir görüşme sunan üyelerden randevu talep edebilirsiniz.</li>
        </ul>
      </div>

      <div class="content-section" id="im-hk-icerik-kaynagi">
        <h2>İçeriklerin kaynağı ve doğruluğu</h2>
        <p>MİMARLAB'daki içerikler iki kaynaktan gelir:</p>
        <ul>
          <li><strong>Kamuya açık kaynaklardan derlenen kayıtlar</strong> — firmaların ve tasarımcıların kendi web siteleri, basın bültenleri, meslek yayınları ve arşivler. Bu kayıtlar ilgili kişi veya kurumla resmi bir bağlantımız olmadan derlenmiştir ve tarafımızca doğrulanmamıştır; bu kayıtların sayfasında <em>"Kamuya açık kaynaklardan derlenmiştir, doğrulanmamıştır."</em> ibaresi yer alır.</li>
          <li><strong>Üyelerimizin gönderdiği içerikler</strong> — üyelerimizin eklediği ve yayına alınmadan önce ekibimizin incelemesinden geçen proje, kişi, firma, marka ve ürün kayıtları.</li>
        </ul>
        <p>Bir profil sahibi tarafından sahiplenildiğinde künyesini artık sahibi yönetir; o profilin ve ona bağlı proje/ürün kayıtlarının sayfasında "doğrulanmamıştır" ibaresi kalkar, yalnızca düzeltme çağrısı kalır. Herhangi bir kayıtta yanlışlık olduğunu düşünüyorsanız <a href="mailto:info@mimarlab.com">info@mimarlab.com</a> adresine yazmanız yeterlidir; düzeltme ve kaldırma taleplerini <a href="/gizlilik-politikasi">Gizlilik Politikası</a>'nda açıklanan süreler içinde sonuçlandırırız.</p>
      </div>

      <div class="content-section" id="im-hk-uyelik">
        <h2>Üyelik, katkı ve rozetler</h2>
        <p>Üyelik ücretsizdir. Üye olarak proje, kişi, firma, marka ve ürün gönderebilir; içeriğiniz yayına alınmadan önce ekibimizin incelemesinden geçer. Kamuya açık kaynaklardan derlenmiş bir profilin sahibi ya da yetkilisiyseniz profili sahiplenebilir; onaylandığında profil bilgilerini güncelleyebilir, gelen yorumları ve mesajları yönetebilirsiniz.</p>
        <p>Profilini öne çıkarmak isteyenler için aylık kiralanan rozet kademeleri sunuyoruz; satış şu an geçici olarak kapalıdır. Güncel ayrıcalıklar ve fiyatlar için <a href="/rozet-al">Rozet Al</a> sayfasını, iade koşulları için <a href="/iade-et">İade Et</a> sayfasını ve <a href="/hizmet-sartlari">Hizmet Şartları</a>'nı inceleyebilirsiniz.</p>
      </div>

      <div class="content-section" id="im-hk-yasal-bilgiler">
        <h2>Yasal bilgiler (künye)</h2>
        <p>5651 sayılı İnternet Ortamında Yapılan Yayınların Düzenlenmesi ve Bu Yayınlar Yoluyla İşlenen Suçlarla Mücadele Edilmesi Hakkında Kanun ve ilgili yönetmelik uyarınca tanıtıcı bilgilerimiz:</p>
        <ul>
          <li><strong>Platform</strong> — MİMARLAB (mimarlab.com)</li>
          <li><strong>İşletmeci ve veri sorumlusu</strong> — Kaan Çorbacı</li>
          <li><strong>E-posta</strong> — <a href="mailto:info@mimarlab.com">info@mimarlab.com</a></li>
          <li><strong>Barındırma (hosting)</strong> — Cloudflare, Inc. (San Francisco, ABD); site Cloudflare'in Workers, D1, R2 ve KV hizmetleri üzerinde barındırılır.</li>
          <li><strong>Faaliyetin niteliği</strong> — MİMARLAB, kendi derlediği içerikler bakımından içerik sağlayıcı; üyelerin gönderdiği içerikler (proje, ürün, yorum, mesaj vb.) bakımından ise 5651 sayılı Kanun m. 5 anlamında yer sağlayıcıdır. Yer sağlayıcı olarak üyelerin yüklediği içeriği önceden denetleme yükümlülüğümüz bulunmamakla birlikte, hukuka aykırılık bildirimi aldığımızda ilgili içeriği inceleyip kaldırırız.</li>
        </ul>
        <p>Kişisel verilerin işlenmesine ilişkin aydınlatma için <a href="/gizlilik-politikasi">Gizlilik Politikası</a>, kullanım kuralları için <a href="/hizmet-sartlari">Hizmet Şartları</a>, çerezler için <a href="/cerez-politikasi">Çerez Politikası</a> sayfalarına bakabilirsiniz.</p>
      </div>

      <div class="content-section" id="im-hk-iletisim">
        <h2>İletişim</h2>
        <p>Sorularınız, düzeltme ve kaldırma talepleriniz ya da iş birliği önerileriniz için <a href="/iletisim">iletişim sayfamızdan</a> ya da doğrudan <a href="mailto:info@mimarlab.com">info@mimarlab.com</a> adresinden bize ulaşabilirsiniz.</p>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------------------------------------
  // İLETİŞİM — iletisim.html#content-wrap ile BİREBİR aynı işaretleme/mantık (bkz. o dosya).
  // ---------------------------------------------------------------------------------------------
  function iletisimTemplate() {
    return `
    <div class="content-wrap">
      <div class="content-eyebrow">İletişim</div>
      <h1 class="content-title">Bize Ulaşın</h1>
      <p class="content-lead">Sorularınız, düzeltme talepleriniz, iş birliği önerileriniz ya da geri bildirimleriniz için bize e-posta ile ulaşabilirsiniz.</p>

      <a class="contact-card" href="mailto:info@mimarlab.com">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 6 10 7 10-7"/></svg>
        <div>
          <div class="contact-card-email">info@mimarlab.com</div>
          <p>Tüm konular için tek iletişim adresimiz</p>
        </div>
      </a>

      <div class="content-section">
        <h2>Bize yaz</h2>
        <p>Formu doldurup gönder, mesajın ekibimize ulaşsın.</p>
        <form id="im-contact-form">
          <div class="contact-form-field">
            <label for="im-contact-name">Ad Soyad</label>
            <input type="text" id="im-contact-name" placeholder="Adın Soyadın" required>
          </div>
          <div class="contact-form-field">
            <label for="im-contact-email">E-posta</label>
            <input type="email" id="im-contact-email" placeholder="ornek@eposta.com" required>
          </div>
          <div class="contact-form-field">
            <label for="im-contact-message">Mesajın</label>
            <textarea id="im-contact-message" placeholder="Mesajını yaz..." required></textarea>
          </div>
          <button class="contact-submit" type="submit">Gönder</button>
          <div class="contact-notice" id="im-contact-notice"></div>
        </form>
      </div>

      <div class="content-section">
        <h2>Genel sorular</h2>
        <p>Platform, üyelik ya da içeriklerle ilgili genel sorularınızı doğrudan e-posta ile iletebilirsiniz.</p>
      </div>

      <div class="content-section">
        <h2>Profil düzeltme ve içerik talepleri</h2>
        <p>Bir ofis, mimar ya da proje kaydında hatalı ya da eksik bilgi gördüyseniz, ya da bir profilin sahibiyseniz ve profili sahiplenmek istiyorsanız, ilgili detay sayfasındaki "Bu profil sana mı ait?" bölümünden talepte bulunabilir, ya da bize e-posta ile yazabilirsiniz.</p>
      </div>
    </div>`;
  }

  function wireIletisim() {
    document.getElementById('im-contact-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const notice = document.getElementById('im-contact-notice');
      const submitBtn = e.target.querySelector('.contact-submit');
      notice.classList.remove('show', 'success');
      submitBtn.disabled = true;
      try {
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: document.getElementById('im-contact-name').value,
            email: document.getElementById('im-contact-email').value,
            message: document.getElementById('im-contact-message').value,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          notice.textContent = data.error || 'Bir şeyler ters gitti, tekrar dene.';
          notice.classList.add('show');
          return;
        }
        notice.textContent = 'Mesajın alındı, en kısa sürede dönüş yapacağız.';
        notice.classList.add('show', 'success');
        e.target.reset();
      } catch {
        notice.textContent = 'Sunucuya ulaşılamadı, lütfen tekrar dene.';
        notice.classList.add('show');
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  // ---------------------------------------------------------------------------------------------
  // KARİYER — kariyer.html#content-wrap ile BİREBİR aynı işaretleme (bkz. o dosya). Statik.
  // ---------------------------------------------------------------------------------------------
  function kariyerTemplate() {
    return `
    <div class="content-wrap">
      <div class="content-eyebrow">Kariyer</div>
      <h1 class="content-title">MİMARLAB'da Kariyer</h1>
      <p class="content-lead">MİMARLAB, küçük ve bağımsız bir ekip tarafından geliştirilip yürütülüyor.</p>

      <div class="jobs-card">
        <strong>Şu anda açık bir pozisyonumuz yok</strong>
        <p>Bu sayfada güncel olarak yayınlanmış bir iş ilanımız bulunmuyor. Yine de platforma katkıda bulunmak, içerik/ortaklık/teknik konularda birlikte çalışmak isterseniz bize yazmaktan çekinmeyin.</p>
      </div>

      <div class="content-section">
        <h2>Mimarlık sektöründe iş mi arıyorsunuz?</h2>
        <p>MİMARLAB'ın kendisi değil, platformdaki ofislerin açtığı pozisyonlar için  sayfamıza göz atabilirsiniz.</p>
      </div>

      <div class="cta-card">
        <div style="font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:19px; font-weight:700;">Bize katkıda bulunmak ister misiniz?</div>
        <p>İçerik, ortaklık ya da teknik konularda ilginizi bizimle paylaşın.</p>
        <a class="cta-btn" href="mailto:info@mimarlab.com">info@mimarlab.com</a>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------------------------------------
  // GİZLİLİK POLİTİKASI — gizlilik-politikasi.html#content-wrap ile BİREBİR aynı içerik (bkz. o
  // dosya). Sayfa içi TOC bağlantıları (#toplanan-veriler vb.) modal içinde de çalışsın diye tüm
  // anchor id'leri im- önekiyle benzersizleştirildi (bkz. dosya başı yorumu — başka bir sayfada
  // AYNI genel isimli bir #id olması ihtimaline karşı, host sayfa ne olursa olsun güvenli).
  // ---------------------------------------------------------------------------------------------
  function gizlilikTemplate() {
    return `
    <div class="content-wrap">
      <div class="content-eyebrow">Kurumsal</div>
      <h1 class="content-title">Gizlilik Politikası ve KVKK Aydınlatma Metni</h1>
      <p class="content-updated">Son güncelleme: 8 Eylül 2026</p>
      <p class="content-lead">Bu metin, 6698 sayılı Kişisel Verilerin Korunması Kanunu'nun (KVKK) 10. maddesi ve Aydınlatma Yükümlülüğünün Yerine Getirilmesinde Uyulacak Usul ve Esaslar Hakkında Tebliğ uyarınca hazırlanmıştır. MİMARLAB'ı (mimarlab.com) kullanırken hangi kişisel verilerinizi hangi yöntemle topladığımızı, hangi amaç ve hukuki sebeplerle işlediğimizi, kimlere aktardığımızı ve KVKK ile Avrupa Birliği Genel Veri Koruma Tüzüğü (GDPR) kapsamındaki haklarınızı açıklar.</p>

      <div class="content-toc">
        <h2>Bu sayfada</h2>
        <ol>
          <li><a href="#im-veri-sorumlusu">Veri sorumlusu ve kapsam</a></li>
          <li><a href="#im-toplanan-veriler">Topladığımız veriler ve toplama yöntemi</a></li>
          <li><a href="#im-derlenmis-profiller">Derlenmiş profiller, düzeltme ve kaldırma</a></li>
          <li><a href="#im-hukuki-sebepler">İşleme amaçları ve hukuki sebepler</a></li>
          <li><a href="#im-uyelik-profil">Üyelik, sosyal giriş ve hesap silme</a></li>
          <li><a href="#im-favoriler">Kaydedilenler, takip, koleksiyonlar ve istatistikler</a></li>
          <li><a href="#im-claim">Profil sahiplik (claim) talepleri</a></li>
          <li><a href="#im-mesaj-gorusme">Mesajlaşma ve görüşme talepleri</a></li>
          <li><a href="#im-ugc">Kullanıcı içerikleri ve telif hakları</a></li>
          <li><a href="#im-odeme">Ödemeler ve iadeler</a></li>
          <li><a href="#im-bulten">Bülten ve bildirimler</a></li>
          <li><a href="#im-cerezler">Çerezler ve analytics</a></li>
          <li><a href="#im-altyapi">Altyapı ve hizmet sağlayıcılar</a></li>
          <li><a href="#im-yurtdisi">Yurt dışına veri aktarımı</a></li>
          <li><a href="#im-guvenlik">Veri güvenliği ve saklama süreleri</a></li>
          <li><a href="#im-haklar">Haklarınız ve başvuru yolu</a></li>
          <li><a href="#im-cocuklar">Çocukların gizliliği</a></li>
          <li><a href="#im-degisiklikler">Politikadaki değişiklikler</a></li>
          <li><a href="#im-iletisim">İletişim</a></li>
        </ol>
      </div>

      <div class="content-section" id="im-veri-sorumlusu">
        <h2>1. Veri sorumlusu ve kapsam</h2>
        <p>KVKK anlamında veri sorumlusu, MİMARLAB'ı işleten <strong>Kaan Çorbacı</strong>'dır (mimarlab.com, <a href="mailto:info@mimarlab.com">info@mimarlab.com</a>). Bu politika, siteyi ziyaret eden herkes (ziyaretçiler), hesap oluşturan üyeler ve kamuya açık kaynaklardan derlenmiş bir kayıtta adı geçen kişiler için geçerlidir. Sitede bağlantı verdiğimiz üçüncü taraf siteler (kaynak yayınlar, firma web siteleri, Google, LinkedIn vb.) kendi gizlilik politikalarına tabidir.</p>
      </div>

      <div class="content-section" id="im-toplanan-veriler">
        <h2>2. Topladığımız veriler ve toplama yöntemi</h2>
        <p>Kişisel verileriniz, sitedeki formlar ve etkileşimler üzerinden elektronik ortamda otomatik yollarla; derlenmiş kayıtlar için ise kamuya açık kaynaklardan toplanır. Yalnızca gerçekleştirdiğiniz işlemle orantılı veriler işlenir:</p>
        <ul>
          <li><strong>Hesap verileri</strong> — üye olurken ad soyad, e-posta adresi, doğum yılı, okul/bölüm ve meslek bilgileri ile şifrenizin geri döndürülemez biçimde özetlenmiş (hash'lenmiş) hâli. Google veya LinkedIn ile giriş yaparsanız, bu sağlayıcıların ilettiği ad, e-posta adresi ve temel profil bilgileri.</li>
          <li><strong>Profil verileri</strong> — profilinizi sahiplendiyseniz veya düzenlediyseniz eklediğiniz fotoğraf, biyografi, pozisyon, ödüller, web sitesi ve sosyal medya bağlantıları, portfolyo dosyaları ve kişi dizininde listelenme tercihiniz.</li>
          <li><strong>Kullanıcı içerikleri</strong> — gönderdiğiniz proje, ürün, kişi, firma ve marka kayıtları; yüklediğiniz görseller ve PDF'ler; yorumlar, puanlamalar, görsel üzeri ürün işaretlemeleri.</li>
          <li><strong>İletişim ve mesaj verileri</strong> — iletişim formundan gönderdiğiniz ad, e-posta ve mesaj metni (veritabanımıza kaydedilir); sahiplenilmiş profillere gönderdiğiniz site içi mesajlar.</li>
          <li><strong>Görüşme talebi verileri</strong> — birebir görüşme talebinde ad soyad, e-posta, telefon, tercih edilen tarih/saat ve notunuz.</li>
          <li><strong>Ödeme ve iade verileri</strong> — şu anda ödeme almıyoruz; ücretli hizmetler açıldığında ödeme yalnızca lisanslı bir ödeme kuruluşunun güvenli sayfasında alınacak ve kart bilgisi hiçbir zaman sunucularımıza ulaşmayacaktır. Daha önce satın alınmış rozetler için iade talebinde bildirdiğiniz IBAN, hesap sahibi adı ve iade sebebi.</li>
          <li><strong>Bülten verisi</strong> — bültene abone olurken verdiğiniz e-posta adresi.</li>
          <li><strong>Kullanım verileri</strong> — kaydettiğiniz içerikler, takip ettikleriniz, koleksiyon/panolarınız, bildirim tercihleri ve oturum durumu.</li>
          <li><strong>Teknik veriler</strong> — IP adresi, tarayıcı/cihaz bilgisi ve ziyaret edilen sayfalar. Bunlar Cloudflare altyapısının erişim kayıtlarında, kötüye kullanımı önleyen kısa ömürlü hız sınırlama sayaçlarında ve Google Analytics ölçümlerinde işlenir (bkz. <a href="#im-cerezler">Çerezler ve analytics</a>).</li>
          <li><strong>Görsel arama yüklemeleri</strong> — görsel aramada yüklediğiniz fotoğraf yalnızca eşleştirme için işlenir; kalıcı olarak saklanmaz ve başka kullanıcılara gösterilmez.</li>
        </ul>
      </div>

      <div class="content-section" id="im-derlenmis-profiller">
        <h2>3. Derlenmiş profiller, düzeltme ve kaldırma</h2>
        <p>Sitedeki proje, kişi, firma, marka ve ürün kayıtlarının önemli bir bölümü, ilgili kişi veya kurumla herhangi bir üyelik ya da izin ilişkisi olmadan <strong>kamuya açık kaynaklardan derlenmiştir</strong>: firmaların kendi web siteleri, basın bültenleri, meslek yayınları ve arşivler. Bu kayıtlar tarafımızca doğrulanmamıştır; ilgili sayfalarda <em>"Kamuya açık kaynaklardan derlenmiştir, doğrulanmamıştır. Yanlışlık olduğunu düşünüyorsan info@mimarlab.com adresinden bize ulaş!"</em> ibaresi yer alır. Bir profil sahibi tarafından sahiplenildiğinde künyeyi sahibi yönettiğinden yalnızca düzeltme çağrısı gösterilir.</p>
        <ul>
          <li><strong>İşlenen veriler</strong> — ad soyad, unvan/görev, ilişkili olduğu firma, mesleki geçmiş, kamuya açık fotoğraf ve proje künyesi bilgileri.</li>
          <li><strong>Hukuki sebep</strong> — KVKK m. 5/2(d) uyarınca ilgili kişi tarafından alenileştirilmiş olması ve m. 5/2(f) uyarınca meşru menfaat (mesleki üretimin kayıt altına alınması ve aranabilir kılınması). Bu işlemede ilgili kişinin temel hak ve özgürlükleri gözetilir; yalnızca mesleki nitelikteki bilgiler işlenir, özel nitelikli kişisel veri işlenmez.</li>
          <li><strong>Kişi–firma ilişkilendirmeleri</strong> — kamuya açık kaynaklara dayanır ve hatalı olabilir. Özellikle ayrılmış, yeniden yapılanmış veya isim değiştirmiş firmalarda yanlış eşleştirme mümkündür; bildirilen hatalı ilişkilendirmeyi kaldırırız.</li>
        </ul>
        <p><strong>Kaldırma, düzeltme ve itiraz.</strong> Profilinizin ya da bilgilerinizin yayınlanmasını istemiyorsanız, hatalı bir bilgi veya ilişkilendirme görüyorsanız, ilgili sayfadaki Geri Bildirim kutusundan bize yazabilir ya da doğrudan <a href="mailto:info@mimarlab.com">info@mimarlab.com</a> adresine talebinizi iletebilirsiniz. Talepler kayıt altına alınır ve KVKK m. 13 uyarınca en geç <strong>30 gün</strong> içinde ücretsiz olarak sonuçlandırılır. Kaldırma talebi için gerekçe belirtmeniz gerekmez.</p>
        <p>Görsellerde eser sahibi (fotoğrafçı, mimar, marka) bilinen hâliyle künyede belirtilir. Bir görselin hak sahibiyseniz ve yayından kaldırılmasını istiyorsanız aynı yollardan bize bildirmeniz yeterlidir; talep üzerine görseli kaldırırız.</p>
      </div>

      <div class="content-section" id="im-hukuki-sebepler">
        <h2>4. İşleme amaçları ve hukuki sebepler</h2>
        <p>Verilerinizi aşağıdaki amaçlarla ve KVKK m. 5 ile m. 6'da sayılan hukuki sebeplere dayanarak işleriz:</p>
        <ul>
          <li><strong>Hesabınızı oluşturmak, kimliğinizi doğrulamak ve hizmeti sunmak</strong> (üyelik, içerik gönderimi, kaydetme, mesajlaşma, görüşme randevusu, rozet abonelikleri) — bir sözleşmenin kurulması ve ifası için gerekli olması (m. 5/2-c).</li>
          <li><strong>Gönderdiğiniz içerikleri incelemek ve yayına almak; sahiplik ve düzeltme taleplerini değerlendirmek</strong> — sözleşmenin ifası (m. 5/2-c) ve meşru menfaat (m. 5/2-f).</li>
          <li><strong>Ödeme ve iade işlemlerini yürütmek, mali kayıtları tutmak</strong> — sözleşmenin ifası (m. 5/2-c) ve hukuki yükümlülüklerimizin yerine getirilmesi (m. 5/2-ç).</li>
          <li><strong>Platformun güvenliğini sağlamak, kötüye kullanımı önlemek, hataları teşhis etmek ve kullanımı anonim düzeyde ölçmek</strong> — meşru menfaat (m. 5/2-f).</li>
          <li><strong>Yasal taleplere cevap vermek, hakları tesis etmek ve savunmak</strong> — hukuki yükümlülük (m. 5/2-ç) ve bir hakkın tesisi, kullanılması veya korunması (m. 5/2-e).</li>
          <li><strong>Bülten ve tanıtım e-postaları göndermek</strong> — açık rızanız (m. 5/1); rızanızı her e-postadaki bağlantıyla dilediğiniz zaman geri çekebilirsiniz.</li>
          <li><strong>Kamuya açık kaynaklardan derlenen mesleki kayıtları yayınlamak</strong> — alenileştirme (m. 5/2-d) ve meşru menfaat (m. 5/2-f); bkz. <a href="#im-derlenmis-profiller">3. bölüm</a>.</li>
        </ul>
        <p>Özel nitelikli kişisel veri (sağlık, din, siyasi görüş vb.) talep etmeyiz ve işlemeyiz; lütfen formlara ve mesajlara bu tür bilgiler yazmayın.</p>
      </div>

      <div class="content-section" id="im-uyelik-profil">
        <h2>5. Üyelik, sosyal giriş ve hesap silme</h2>
        <p>Üye olduğunuzda oluşturduğunuz hesap, oturumunuzu sunucu tarafında yönetmemizi sağlar; oturum çerezi 30 gün geçerlidir ve şifreniz asla düz metin olarak saklanmaz. Google veya LinkedIn ile giriş yaptığınızda bu sağlayıcılar bize yalnızca doğrulanmış e-posta adresinizi ve temel profil bilgilerinizi iletir; sağlayıcıdaki şifrenize erişmeyiz ve sizin adınıza paylaşım yapmayız.</p>
        <p><a href="/hesabim">Hesabım</a> sayfanızdan bilgilerinizi güncelleyebilir, gönderdiğiniz içerikleri ve rozet aboneliğinizi görüntüleyebilir ve <strong>hesabınızı silebilirsiniz</strong>. Hesap silme, hesabınıza bağlı kişisel verilerin (hesap bilgileri, profil fotoğrafı, yorumlar, puanlamalar, kaydedilenler, takipler, koleksiyonlar, sahiplik ve düzeltme talepleri, rozet kayıtları) kalıcı olarak silinmesiyle ve tüm oturumlarınızın sonlandırılmasıyla sonuçlanır. Site içi mesaj yazışmalarınız, görüşme talepleriniz, iletişim formu mesajlarınız ve bülten aboneliğiniz hesap silmeyle otomatik olarak silinmez; bunların da silinmesini istiyorsanız <a href="mailto:info@mimarlab.com">info@mimarlab.com</a> adresine yazmanız yeterlidir, talebiniz 30 gün içinde sonuçlandırılır. Yasal saklama yükümlülüğü bulunan mali kayıtlar ilgili süre boyunca erişimi kısıtlanmış biçimde tutulur.</p>
      </div>

      <div class="content-section" id="im-favoriler">
        <h2>6. Kaydedilenler, takip, koleksiyonlar ve istatistikler</h2>
        <p>"Kaydet" ve "Takip et" butonlarıyla oluşturduğunuz listeler ile panolarınız hesabınıza bağlı olarak saklanır ve yalnızca siz görebilirsiniz; bu veriler üçüncü taraflarla paylaşılmaz, reklam veya profilleme amacıyla kullanılmaz.</p>
        <p>Profil sahiplerine sunulan "Profil İstatistikleri" (görüntülenme ve arama sonuçlarında gösterim sayıları) günlük toplam sayılardan oluşur; hangi ziyaretçinin hangi profili görüntülediği kaydedilmez. Aynı sekme oturumunda tekrar sayımı önlemek için tarayıcınızın sekme belleğinde (sessionStorage) kimlik içermeyen kısa bir işaret tutulur.</p>
      </div>

      <div class="content-section" id="im-claim">
        <h2>7. Profil sahiplik (claim) talepleri</h2>
        <p>Kamuya açık kaynaklardan derlenmiş bir kişi, firma veya marka profilinin sahibi ya da yetkilisi olduğunuzu düşünüyorsanız, ilgili profildeki "Bu profil sana mı ait?" bağlantısı üzerinden sahiplik talebinde bulunabilirsiniz. Bu süreçte kimliğinizi/yetkinizi doğrulamamıza yardımcı olacak bilgiler (ör. kurumsal e-posta, web sitesi bağlantısı, firmadaki göreviniz) talep edebiliriz. Talep onaylandığında profil hesabınıza bağlanır; profil bilgilerini güncelleyebilir, gelen yorumları ve mesajları yönetebilirsiniz. Firma ve marka profillerinde yetkili konumdaki üyeler (kurucu, ortak, ekip lideri, yönetici), firmaya bağlı ortakların kişi profillerini de düzenleyebilir. Doğrulama amacıyla paylaştığınız bilgiler yalnızca talebi değerlendiren ekibimizle sınırlı tutulur ve profilde yayınlanmaz.</p>
      </div>

      <div class="content-section" id="im-mesaj-gorusme">
        <h2>8. Mesajlaşma ve görüşme talepleri</h2>
        <p><strong>Mesajlaşma.</strong> Sahiplenilmiş profillere gönderdiğiniz mesajlar veritabanımızda saklanır ve yalnızca gönderen ile alıcı tarafından (firma profillerinde firmanın yetkili üyeleri tarafından) görülebilir. Mesaj içeriklerini yalnızca kötüye kullanım bildirimi veya yasal bir talep hâlinde inceleriz.</p>
        <p><strong>Görüşme talepleri.</strong> Birebir görüşme talep ettiğinizde ad soyad, e-posta, telefon, tarih/saat ve notunuz, görüşmeyi sunan üyeyle randevunun kurulması için işlenir. Talep onaylandığında görüşme bağlantısı Google Meet üzerinden oluşturulur ve hesabınızdaki bildirimlerle iletilir; görüşme sırasında Google'ın kendi hizmet şartları ve gizlilik politikası geçerlidir. Görüşmeler MİMARLAB tarafından kaydedilmez.</p>
      </div>

      <div class="content-section" id="im-ugc">
        <h2>9. Kullanıcı içerikleri ve telif hakları</h2>
        <p>Platforma gönderdiğiniz proje, ürün, yorum, puanlama, portfolyo ve görseller "kullanıcı tarafından oluşturulan içerik" sayılır. Bu içerikleri göndererek, içeriği yayınlamak, göstermek, teknik olarak biçimlendirmek (ör. görsel boyutlandırma) ve platformumuzda tanıtmak için MİMARLAB'a münhasır olmayan, dünya çapında, telifsiz bir kullanım hakkı verirsiniz; içeriğin mülkiyeti ve telif hakkı sizde (veya gerçek hak sahibinde) kalmaya devam eder. Yayınlanan içerikler adınız/profilinizle birlikte herkese açık olarak görüntülenir ve arama motorları tarafından indekslenebilir.</p>
        <p>Yalnızca yayınlama hakkına sahip olduğunuz içerikleri yüklemekle yükümlüsünüz. Bir içeriğin telif hakkınızı veya kişilik haklarınızı ihlal ettiğini düşünüyorsanız, ilgili sayfanın bağlantısı ve hak sahipliğinizi gösteren bilgilerle birlikte <a href="mailto:info@mimarlab.com">info@mimarlab.com</a> adresine yazın; bildirimi inceleyip gerekirse içeriği kaldırırız. Ayrıntılı kurallar için <a href="/hizmet-sartlari">Hizmet Şartları</a> sayfasına bakabilirsiniz.</p>
      </div>

      <div class="content-section" id="im-odeme">
        <h2>10. Ödemeler ve iadeler</h2>
        <p>Şu anda <strong>ödeme almıyoruz</strong>: rozet satışı ve görüşme ücreti tahsilatı geçici olarak kapalıdır; görüşme talepleri ücretsiz olarak alınır ve ekibimizin onayıyla sonuçlandırılır. Ücretli hizmetler yeniden açıldığında ödemeler kredi/banka kartıyla, lisanslı bir ödeme kuruluşunun (iyzico) güvenli altyapısında alınacak; kart bilgileriniz sunucularımıza ulaşmayacak, bize yalnızca işlemin sonucu (başarılı/başarısız, tutar, tarih) iletilecektir. Bu metin o zaman güncellenecektir.</p>
        <p>Daha önce satın alınmış rozetler için iade talebinde bildirdiğiniz IBAN ve hesap sahibi adı yalnızca iade tutarını göndermek için kullanılır. Ödeme ve iade kayıtları, vergi ve ticaret mevzuatının öngördüğü süre boyunca saklanır (bkz. <a href="#im-guvenlik">15. bölüm</a>).</p>
      </div>

      <div class="content-section" id="im-bulten">
        <h2>11. Bülten ve bildirimler</h2>
        <p>Bültene abone olduğunuzda e-posta adresiniz, yeni yayına giren proje, ürün, kişi, firma ve marka kayıtlarını duyurmak için kullanılır. Bu e-postalar 6563 sayılı Elektronik Ticaretin Düzenlenmesi Hakkında Kanun anlamında ticari elektronik ileti niteliğindedir ve yalnızca onayınızla gönderilir; her e-postanın altındaki "Abonelikten çık" bağlantısıyla onayınızı dilediğiniz zaman geri çekebilirsiniz. Hesabınızla ilgili işlemsel e-postalar (şifre sıfırlama, ödeme onayı, görüşme bağlantısı, sahiplik talebi sonucu) bültenden bağımsızdır ve hizmetin bir parçası olarak gönderilir.</p>
      </div>

      <div class="content-section" id="im-cerezler">
        <h2>12. Çerezler ve analytics</h2>
        <p>MİMARLAB, sitenin çalışması için gerekli <strong>oturum çerezini</strong> (giriş durumunuzu hatırlamak için) kullanır; bu çerez devre dışı bırakılamaz çünkü hesabınızla ilgili özellikler buna bağlıdır. Tema tercihiniz tarayıcınızın yerel depolamasında tutulur. Ayrıca site trafiğini anlamak için <strong>Google Analytics</strong> kullanıyoruz; reklam veya pazarlama çerezi kullanmıyoruz. Kullandığımız çerezlerin tam listesi, süreleri ve devre dışı bırakma yöntemleri için <a href="/cerez-politikasi">Çerez Politikası</a> sayfamıza bakabilirsiniz.</p>
      </div>

      <div class="content-section" id="im-altyapi">
        <h2>13. Altyapı ve hizmet sağlayıcılar</h2>
        <p>Verileriniz, hizmeti sunabilmemiz için aşağıdaki sağlayıcılar tarafından, veri işleyen sıfatıyla ve yalnızca gerekli ölçüde işlenir:</p>
        <ul>
          <li><strong>Cloudflare, Inc.</strong> (ABD) — Workers (sunucu tarafı mantık, API uçları, oturum doğrulama), D1 (hesap, profil, içerik, yorum, mesaj ve ödeme kayıtlarının tutulduğu veritabanı), R2 (yüklediğiniz görsel ve PDF'ler), KV (kişisel veri içermeyen kısa ömürlü önbellek ve hız sınırlama sayaçları) ve Workers AI (görsel arama, yapay zekâ destekli içerik ekleme ve gündem özetleri için model çıkarımı; Cloudflare, bu işlemde gönderilen görsel ve metinleri kendi beyanına göre model eğitiminde kullanmaz).</li>
          <li><strong>Google LLC</strong> (ABD) — Google Analytics (kullanım ölçümü), Google ile giriş (OAuth) ve görüşme randevuları için Google Meet bağlantısı.</li>
          <li><strong>LinkedIn Corporation</strong> (ABD) — LinkedIn ile giriş (OAuth).</li>
          <li><strong>Resend, Inc.</strong> (ABD) — işlemsel e-postaların ve bültenin gönderimi; bu amaçla e-posta adresiniz ve ileti içeriği Resend'e iletilir.</li>
          <li><strong>OpenStreetMap / Nominatim</strong> — proje eklerken "haritada konum ara" özelliğinde yazdığınız adres metni, sunucumuz üzerinden Nominatim'e iletilir; IP adresiniz bu servise gönderilmez.</li>
          <li><strong>Gündem kaynakları</strong> — Gündem sayfasındaki haber görselleri doğrudan kaynak yayının sunucusundan yüklenir; tarayıcınız bu sunuculara bağlandığında IP adresiniz ve tarayıcı bilginiz ilgili yayına görünür hâle gelir ve o yayının gizlilik politikası geçerli olur.</li>
        </ul>
        <p>Verilerinizi pazarlama amacıyla satmayız veya kiralamayız. Yukarıdakiler dışında verileriniz yalnızca yasal bir yükümlülük, mahkeme kararı veya yetkili bir kamu kurumunun talebi doğrultusunda; platformun, kullanıcıların veya üçüncü kişilerin haklarını ve güvenliğini korumak için gerekli olduğunda; ya da açık rızanızı aldığımız durumlarda paylaşılır.</p>
      </div>

      <div class="content-section" id="im-yurtdisi">
        <h2>14. Yurt dışına veri aktarımı</h2>
        <p>Yukarıda sayılan sağlayıcıların tamamı küresel ölçekte çalışır; bu nedenle verileriniz, işlemin gerçekleştiği veri merkezine bağlı olarak Türkiye dışına (Avrupa Birliği veya ABD'deki sunuculara) aktarılabilir. Bu aktarımlar KVKK m. 9 ve ilgili Kurul kararları çerçevesinde, sağlayıcıların veri işleme sözleşmeleri ve standart sözleşme hükümleri gibi uygun güvenceler altında, yalnızca hizmetin sunulabilmesi için gerekli ölçüde gerçekleşir. Verileriniz bu altyapı sağlayıcıları dışında üçüncü bir ülkeye ayrıca aktarılmaz.</p>
      </div>

      <div class="content-section" id="im-guvenlik">
        <h2>15. Veri güvenliği ve saklama süreleri</h2>
        <p>Şifreleriniz geri döndürülemez biçimde hash'lenerek saklanır, tüm veri trafiği HTTPS ile şifrelenir, oturum çerezi yalnızca güvenli bağlantıda ve JavaScript'e kapalı olarak ayarlanır, yönetim erişimi yalnızca yetkili ekip üyeleriyle sınırlıdır. Bir veri ihlali hâlinde KVKK m. 12 uyarınca Kişisel Verileri Koruma Kurulu'na ve etkilenen kişilere bildirimde bulunuruz.</p>
        <p>Saklama süreleri:</p>
        <ul>
          <li><strong>Hesap ve profil verileri</strong> — hesabınız aktif olduğu sürece; hesap silme talebiyle birlikte silinir.</li>
          <li><strong>Oturum kayıtları</strong> — 30 gün veya çıkış yapana kadar.</li>
          <li><strong>Yayınlanan içerikler, yorumlar, mesajlar</strong> — siz silene ya da hesabınızı silene kadar.</li>
          <li><strong>İletişim formu ve sahiplik/düzeltme talepleri</strong> — talebin sonuçlanmasından itibaren yasal zamanaşımı süresi boyunca (azami 10 yıl).</li>
          <li><strong>Ödeme ve iade kayıtları</strong> — vergi ve ticaret mevzuatı uyarınca 10 yıl.</li>
          <li><strong>Bülten aboneliği</strong> — abonelikten çıkana kadar.</li>
          <li><strong>Teknik erişim kayıtları</strong> — Cloudflare'in kısa süreli günlük saklama politikası çerçevesinde; hız sınırlama sayaçları dakikalar içinde silinir.</li>
          <li><strong>Derlenmiş kayıtlar</strong> — kaldırma talebi alınana kadar.</li>
        </ul>
      </div>

      <div class="content-section" id="im-haklar">
        <h2>16. Haklarınız ve başvuru yolu</h2>
        <p>KVKK'nın 11. maddesi ve (Avrupa Ekonomik Alanı'ndaki kullanıcılar için) GDPR kapsamında aşağıdaki haklara sahipsiniz:</p>
        <ul>
          <li>Kişisel verilerinizin işlenip işlenmediğini öğrenme ve işlenmişse buna ilişkin bilgi talep etme,</li>
          <li>İşlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme,</li>
          <li>Yurt içinde veya yurt dışında verilerin aktarıldığı üçüncü kişileri bilme,</li>
          <li>Eksik veya yanlış işlenmişse düzeltilmesini isteme ve bu işlemin aktarıldığı üçüncü kişilere bildirilmesini isteme,</li>
          <li>KVKK m. 7'deki şartlar çerçevesinde silinmesini veya yok edilmesini isteme,</li>
          <li>Münhasıran otomatik sistemlerle analiz edilmesi sonucu aleyhinize bir sonucun ortaya çıkmasına itiraz etme,</li>
          <li>Kanuna aykırı işleme nedeniyle zarara uğramanız hâlinde zararın giderilmesini talep etme,</li>
          <li>Verilerinizin taşınabilir bir formatta size veya başka bir hizmete aktarılmasını isteme ve işlemeye itiraz etme (GDPR).</li>
        </ul>
        <p><strong>Başvuru.</strong> Veri Sorumlusuna Başvuru Usul ve Esasları Hakkında Tebliğ uyarınca taleplerinizi ad soyad, hesabınıza kayıtlı e-posta adresiniz ve talep konunuzu belirterek <a href="mailto:info@mimarlab.com">info@mimarlab.com</a> adresine iletebilirsiniz; kimliğinizi doğrulamak için hesabınıza kayıtlı e-posta adresinden yazmanızı isteyebiliriz. Başvurular en geç <strong>30 gün</strong> içinde ücretsiz olarak sonuçlandırılır. Başvurunuzun reddedilmesi, cevabın yetersiz bulunması veya süresinde cevap verilmemesi hâlinde KVKK m. 14 uyarınca Kişisel Verileri Koruma Kurulu'na şikâyette bulunabilirsiniz; Avrupa Ekonomik Alanı'ndaki kullanıcılar bulundukları ülkenin denetim otoritesine başvurabilir.</p>
      </div>

      <div class="content-section" id="im-cocuklar">
        <h2>17. Çocukların gizliliği</h2>
        <p>MİMARLAB, 18 yaşından küçük kullanıcılara yönelik değildir; bilerek 18 yaş altı kullanıcılardan veri toplamayız. Bir çocuğa ait veri topladığımızı fark edersek bu veriyi derhal sileriz. Böyle bir durumu fark ederseniz lütfen bize bildirin.</p>
      </div>

      <div class="content-section" id="im-degisiklikler">
        <h2>18. Politikadaki değişiklikler</h2>
        <p>Bu politikayı zaman zaman güncelleyebiliriz; önemli değişikliklerde sayfanın üst kısmındaki "son güncelleme" tarihini değiştirir, gerektiğinde sitede veya e-posta yoluyla bilgilendirme yaparız. Politikayı düzenli aralıklarla gözden geçirmenizi öneririz.</p>
      </div>

      <div class="content-section" id="im-iletisim">
        <h2>19. İletişim</h2>
        <p>Gizlilik politikamız veya kişisel verilerinizle ilgili sorularınız için <a href="/iletisim">iletişim sayfamızdan</a> ya da doğrudan <a href="mailto:info@mimarlab.com">info@mimarlab.com</a> adresinden bize ulaşabilirsiniz. Platform kullanım kurallarımız için <a href="/hizmet-sartlari">Hizmet Şartları</a>, çerez kullanımımız için <a href="/cerez-politikasi">Çerez Politikası</a>, işletmeci bilgileri için <a href="/hakkinda">Hakkında</a> sayfasına göz atabilirsiniz.</p>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------------------------------------
  // HİZMET ŞARTLARI — hizmet-sartlari.html#content-wrap ile BİREBİR aynı içerik (bkz. o dosya).
  // Aynı gerekçeyle TOC anchor id'leri im- önekiyle benzersizleştirildi (bkz. gizlilikTemplate).
  // ---------------------------------------------------------------------------------------------
  function hizmetTemplate() {
    return `
    <div class="content-wrap">
      <div class="content-eyebrow">Kurumsal</div>
      <h1 class="content-title">Hizmet Şartları</h1>
      <p class="content-updated">Son güncelleme: 8 Eylül 2026</p>
      <p class="content-lead">Bu Hizmet Şartları, MİMARLAB'ı (mimarlab.com) kullanımınızı düzenleyen kuralları ve tarafların hak ve yükümlülüklerini içerir. Siteyi ziyaret ederek, üye olarak, içerik göndererek veya ücretli bir hizmet satın alarak bu şartları kabul etmiş sayılırsınız. Kişisel verilerinizin nasıl işlendiğini öğrenmek için <a href="/gizlilik-politikasi">Gizlilik Politikası</a> sayfamıza bakabilirsiniz.</p>

      <div class="content-toc">
        <h2>Bu sayfada</h2>
        <ol>
          <li><a href="#im-hs-taraflar">Taraflar ve kabul</a></li>
          <li><a href="#im-hs-tanimlar">Tanımlar</a></li>
          <li><a href="#im-hs-platform">Platformun niteliği ve içerik kaynakları</a></li>
          <li><a href="#im-hs-uyelik">Üyelik ve hesap</a></li>
          <li><a href="#im-hs-ugc">Kullanıcı içerikleri ve lisans</a></li>
          <li><a href="#im-hs-telif">Telif ve kişilik hakları, ihlal bildirimi</a></li>
          <li><a href="#im-hs-claim">Profil sahiplik (claim) süreci</a></li>
          <li><a href="#im-hs-topluluk">Puanlama, yorum, mesajlaşma ve topluluk kuralları</a></li>
          <li><a href="#im-hs-rozet">Rozet paketleri, ödemeler ve iadeler</a></li>
          <li><a href="#im-hs-gorusme">Görüşme (danışmanlık) hizmeti</a></li>
          <li><a href="#im-hs-yasaklar">Yasaklı kullanımlar</a></li>
          <li><a href="#im-hs-fikri-mulkiyet">Fikri mülkiyet ve veri tabanı hakları</a></li>
          <li><a href="#im-hs-sorumluluk">Sorumluluğun sınırlandırılması</a></li>
          <li><a href="#im-hs-degisiklik">Hizmetin ve şartların değiştirilmesi</a></li>
          <li><a href="#im-hs-hukuk">Uygulanacak hukuk ve uyuşmazlık çözümü</a></li>
          <li><a href="#im-hs-iletisim">İletişim</a></li>
        </ol>
      </div>

      <div class="content-section" id="im-hs-taraflar">
        <h2>1. Taraflar ve kabul</h2>
        <p>Bu şartlar, mimarlab.com alan adı altında yayın yapan MİMARLAB platformunu işleten <strong>Kaan Çorbacı</strong> (bundan sonra "MİMARLAB") ile platformu kullanan gerçek veya tüzel kişi (bundan sonra "Kullanıcı") arasında geçerlidir. İşletmeci ve yer sağlayıcıya ilişkin tanıtıcı bilgiler <a href="/hakkinda">Hakkında</a> sayfasındaki "Yasal bilgiler" bölümünde yer alır. Bu şartları kabul etmiyorsanız lütfen platformu kullanmayın.</p>
      </div>

      <div class="content-section" id="im-hs-tanimlar">
        <h2>2. Tanımlar</h2>
        <p>"MİMARLAB", "biz", "bize" ifadeleri mimarlab.com platformunu ve işletmecisini; "Kullanıcı", "siz" ifadeleri siteyi ziyaret eden veya kullanan herkesi; "Üye" ifadesi hesap oluşturmuş kullanıcıları; "İçerik" ifadesi platformda yer alan proje, ürün, kişi, firma ve marka kayıtları ile yorum, puanlama, mesaj, görsel ve metinleri; "Kullanıcı İçeriği" ifadesi bir Üye tarafından gönderilen içeriği; "Derlenmiş İçerik" ifadesi MİMARLAB'ın kamuya açık kaynaklardan derlediği içeriği; "Sahiplenilmiş Profil" ifadesi bir Üyeye bağlanmış kişi, firma veya marka profilini ifade eder.</p>
      </div>

      <div class="content-section" id="im-hs-platform">
        <h2>3. Platformun niteliği ve içerik kaynakları</h2>
        <p>MİMARLAB, mimarlık ve tasarım alanında bir dizin ve topluluk platformudur. 5651 sayılı Kanun kapsamında, kendi derlediği içerikler bakımından <strong>içerik sağlayıcı</strong>; Üyelerin gönderdiği içerikler bakımından <strong>yer sağlayıcı</strong>dır. Yer sağlayıcı olarak Kullanıcı İçeriğini önceden denetleme yükümlülüğümüz yoktur; ancak gönderilen kayıtları yayına almadan önce inceleriz ve hukuka aykırılık bildirimi aldığımızda ilgili içeriği kaldırırız.</p>
        <p>Derlenmiş İçerik; firmaların ve tasarımcıların kendi web siteleri, basın bültenleri, meslek yayınları ve arşivler gibi kamuya açık kaynaklardan, ilgili kişi veya kurumla bir bağlantı kurulmaksızın derlenir ve tarafımızca doğrulanmamıştır. Bu kayıtların sayfasında <em>"Kamuya açık kaynaklardan derlenmiştir, doğrulanmamıştır. Yanlışlık olduğunu düşünüyorsan info@mimarlab.com adresinden bize ulaş!"</em> ibaresi yer alır. Bir profil sahiplenildiğinde künyeyi sahibi yönetir ve "doğrulanmamıştır" ibaresi kalkar. Hatalı bilgi, hatalı ilişkilendirme veya kaldırma talepleri <a href="mailto:info@mimarlab.com">info@mimarlab.com</a> adresine iletilebilir; talepler en geç 30 gün içinde sonuçlandırılır.</p>
      </div>

      <div class="content-section" id="im-hs-uyelik">
        <h2>4. Üyelik ve hesap</h2>
        <p>Üye olmak için 18 yaşını doldurmuş olmanız ve doğru, güncel bilgiler vermeniz gerekir. Google veya LinkedIn ile giriş yaptığınızda bu sağlayıcıların kendi şartları da geçerlidir. Hesabınızın ve şifrenizin gizliliğinden siz sorumlusunuz; hesabınız üzerinden gerçekleştirilen tüm işlemlerden sorumlu tutulursunuz. Hesabınızda yetkisiz bir erişim şüphesi varsa derhal <a href="/iletisim">bize bildirin</a>. Aynı kişi adına birden fazla hesap açılamaz; sahte veya başkası adına açılan hesaplar kapatılır.</p>
        <p>Hesabınızı dilediğiniz zaman <a href="/hesabim">Hesabım</a> sayfasından silebilirsiniz; hesap silindiğinde hesabınıza bağlı kişisel verileriniz <a href="/gizlilik-politikasi">Gizlilik Politikası</a>'nda açıklandığı şekilde silinir. Aktif bir rozet aboneliğiniz varsa, kalan süre için iade talebi <a href="/iade-et">İade Et</a> sayfasındaki koşullara tabidir. MİMARLAB, bu şartları ihlal eden hesapları önceden bildirmeksizin askıya alma veya kapatma hakkını saklı tutar.</p>
      </div>

      <div class="content-section" id="im-hs-ugc">
        <h2>5. Kullanıcı içerikleri ve lisans</h2>
        <p>Platforma proje, ürün, kişi, firma, marka, yorum, puanlama, portfolyo veya görsel gönderdiğinizde, bu içeriğin sizin tarafınızdan oluşturulduğunu veya yayınlama hakkına sahip olduğunuzu, içerikte yer alan üçüncü kişilerden (fotoğrafçı, müşteri, çalışma arkadaşı vb.) gerekli izinleri aldığınızı beyan etmiş olursunuz. İçeriğin mülkiyeti ve telif hakkı sizde kalır; ancak içeriği platformda göstermek, saklamak, teknik olarak biçimlendirmek (ör. görsel boyutlandırma/optimize etme), aramada ve ilgili kayıtlarla ilişkilendirerek listelemek ve platformun tanıtımında kullanmak üzere MİMARLAB'a dünya çapında, telifsiz, münhasır olmayan, alt lisans verilebilir bir lisans vermiş olursunuz. Bu lisans, içeriği kaldırdığınızda ileriye dönük olarak sona erer; yalnızca önbellek ve yedeklerde makul bir süre daha bulunabilir.</p>
        <p>Gönderdiğiniz proje/ürün/kişi/firma/marka kayıtları yayına alınmadan önce ekibimizin incelemesinden geçer; MİMARLAB, kurallara aykırı, yanıltıcı veya hak ihlali içeren içerikleri yayınlamayı reddetme, düzenleme, arşivleme ya da sonradan kaldırma hakkını saklı tutar. Yayınlanan içerikler herkese açıktır ve arama motorları tarafından indekslenebilir.</p>
      </div>

      <div class="content-section" id="im-hs-telif">
        <h2>6. Telif ve kişilik hakları, ihlal bildirimi</h2>
        <p>Sitede yer alan proje fotoğrafları ve görseller, 5846 sayılı Fikir ve Sanat Eserleri Kanunu uyarınca ilgili mimar, firma, fotoğrafçı veya hak sahibine aittir; künyelerde belirtilen fotoğraf kaynağı bilgisi bu nedenle korunur. Yalnızca kendinize ait olan veya yayınlama izniniz bulunan içerikleri yükleyebilirsiniz.</p>
        <p>Bir içeriğin telif hakkınızı ihlal ettiğini düşünüyorsanız, (a) ihlal edildiğini iddia ettiğiniz eserin tanımını, (b) ihlal eden içeriğin bulunduğu sayfanın bağlantısını, (c) hak sahipliğinizi gösteren bilgileri ve (d) iletişim bilgilerinizi <a href="mailto:info@mimarlab.com">info@mimarlab.com</a> adresine ileterek bildirimde bulunabilirsiniz. Bildirimi inceleyip haklı bulunması durumunda içeriği en geç 30 gün, açık ihlallerde ise mümkün olan en kısa sürede kaldırırız.</p>
        <p>Bir içeriğin kişilik haklarınızı ihlal ettiğini düşünüyorsanız aynı adrese bildirimde bulunabilirsiniz; 5651 sayılı Kanun m. 9 kapsamındaki haklarınız (içeriğin çıkarılması ve erişimin engellenmesi talebiyle sulh ceza hâkimliğine başvurma) saklıdır.</p>
      </div>

      <div class="content-section" id="im-hs-claim">
        <h2>7. Profil sahiplik (claim) süreci</h2>
        <p>Kamuya açık kaynaklardan derlenmiş bir kişi, firma veya marka profilinin gerçek sahibi veya yetkilisiyseniz, profil üzerinden sahiplik talebinde bulunabilirsiniz. Talebiniz incelenirken kimliğinizi/yetkinizi doğrulayacak belge veya bilgi isteyebiliriz. Yanlış beyanla sahiplik talebinde bulunmak bu şartların ağır ihlali sayılır; hesabınızın kapatılmasına ve gerektiğinde yasal yollara başvurulmasına yol açabilir.</p>
        <p>Onaylanan talepler profili hesabınıza bağlar; profil bilgilerini güncelleme, gelen yorumları ve mesajları yönetme yetkisi kazanırsınız. Firma ve marka profillerinde yetkili konumdaki üyeler (kurucu, kurucu ortak, ortak, ekip lideri, yönetici) firmaya bağlı ortakların kişi profillerini de düzenleyebilir; bu yetki firma ekibinden çıkarıldığınızda sona erer. Sahiplenilmiş profilin ve ona bağlı proje/ürün kayıtlarının doğruluğundan profil sahibi sorumludur. MİMARLAB, uyuşmazlık (aynı profil için birden fazla talep) durumunda ek doğrulama isteme, talebi reddetme veya onaylanmış bir sahipliği geri alma hakkını saklı tutar.</p>
      </div>

      <div class="content-section" id="im-hs-topluluk">
        <h2>8. Puanlama, yorum, mesajlaşma ve topluluk kuralları</h2>
        <p>Projelere, ürünlere ve profillere puan verebilir, yorum yazabilir ve sahiplenilmiş profillere mesaj gönderebilirsiniz. Yorum ve mesajlarınızın gerçek deneyiminize dayanması; hakaret, iftira, ayrımcılık, taciz, spam, reklam, kişisel veri ifşası veya yanıltıcı bilgi içermemesi gerekir. Bu kurallara aykırı yorumları/puanlamaları kaldırma, mesajlaşmayı kısıtlama ve tekrarlayan ihlallerde hesabı kapatma hakkımız saklıdır. Bir profilin sahibiyseniz, kendi profilinize gelen uygunsuz yorumları yönetme (gizleme/bildirme) ayrıcalığından yararlanabilirsiniz. Yorum ve mesajların içeriğinden yazarı sorumludur.</p>
      </div>

      <div class="content-section" id="im-hs-rozet">
        <h2>9. Rozet paketleri, ödemeler ve iadeler</h2>
        <p>Profilinizi öne çıkarmak veya ek ayrıcalıklar (doğrulanmış rozet, yorum yönetimi, mesajlaşma vb.) kazanmak için aylık kiralanan rozet kademeleri sunuyoruz. Güncel kademeler, ayrıcalıklar ve Türk lirası cinsinden fiyatlar <a href="/rozet-al">Rozet Al</a> sayfasında ödeme öncesinde açıkça gösterilir; fiyatlar sunucu tarafında belirlenir ve satın alma anında geçerli olan fiyat uygulanır.</p>
        <ul>
          <li><strong>Ödeme yöntemi</strong> — şu anda ödeme almıyoruz; rozet satışı geçici olarak kapalıdır ve Rozet Al sayfası yalnızca kademeleri ve fiyatları tanıtır. Satış yeniden açıldığında ödeme kredi/banka kartıyla, lisanslı bir ödeme kuruluşunun (iyzico) güvenli sayfasında alınacak; kart bilgileri MİMARLAB sunucularında saklanmayacaktır. Ödeme onaylandığında rozet aktifleşir ve hesabınızda görünür.</li>
          <li><strong>Süre ve yenileme</strong> — rozetler aylık süreyle kiralanır; otomatik yenileme yoktur, süre sonunda rozet pasifleşir ve dilerseniz yeniden satın alırsınız. Rozet devredilemez.</li>
          <li><strong>Cayma ve iade</strong> — tüketici sıfatıyla yapılan satın alımlarda 6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği'ndeki haklarınız saklıdır. Rozet, ödemenin onaylanmasıyla birlikte anında ifa edilen bir dijital hizmettir; bununla birlikte iade taleplerinizi <a href="/iade-et">İade Et</a> sayfası üzerinden alır, sayfada belirtilen koşullar çerçevesinde değerlendirir ve onaylanan tutarı bildirdiğiniz IBAN'a havale/EFT ile göndeririz. Şartların ihlali nedeniyle kapatılan hesaplarda kullanılmamış süre iade edilmez.</li>
        </ul>
      </div>

      <div class="content-section" id="im-hs-gorusme">
        <h2>10. Görüşme (danışmanlık) hizmeti</h2>
        <p>Bazı profillerde sunulan "Danışmanlık Al" özelliğiyle, görüşmeyi sunan üyeyle çevrimiçi birebir görüşme randevusu talep edebilirsiniz. Şu anda görüşme için ücret alınmamaktadır; talebiniz ekibimizce değerlendirilir ve onaylandığında görüşme bağlantısı Google Meet üzerinden oluşturulur ve hesabınızdaki bildirimlerle iletilir. Görüşme tarihini, görüşmeden önce bir kez değiştirebilirsiniz. Görüşme içeriği görüşmeyi sunan üyenin kendi görüş ve deneyimini yansıtır; MİMARLAB görüşmenin içeriğinden, sonuçlarından veya bu görüşmeye dayanarak alınan kararlardan sorumlu değildir. Görüşme sırasında Google'ın hizmet şartları da geçerlidir.</p>
      </div>

      <div class="content-section" id="im-hs-yasaklar">
        <h2>11. Yasaklı kullanımlar</h2>
        <ul>
          <li>Sahte hesap oluşturmak, başka bir kişi/kurum adına yetkisiz şekilde profil sahiplenmek veya içerik göndermek,</li>
          <li>Hak ihlali içeren, yanıltıcı, izinsiz ya da üçüncü kişilerin kişisel verilerini içeren içerik yüklemek,</li>
          <li>Platformdaki verileri otomatik araçlarla (bot, scraper, crawler) toplu olarak çekmek, kopyalamak, yeniden yayınlamak veya veri tabanının önemli bir kısmını başka bir ortama aktarmak,</li>
          <li>Platforma aşırı yük bindirmek, güvenlik açıklarını istismar etmeye çalışmak, erişim kısıtlamalarını aşmak,</li>
          <li>Diğer kullanıcıları taciz etmek, spam göndermek, mesajlaşma ve yorum alanlarını reklam amacıyla kullanmak,</li>
          <li>Görsel üzeri ürün işaretleme, puanlama ve yorum sistemlerini manipüle etmek,</li>
          <li>Yürürlükteki yasalara aykırı herhangi bir faaliyette bulunmak.</li>
        </ul>
      </div>

      <div class="content-section" id="im-hs-fikri-mulkiyet">
        <h2>12. Fikri mülkiyet ve veri tabanı hakları</h2>
        <p>MİMARLAB adı, logosu, arayüz tasarımı ve yazılımı MİMARLAB'a aittir ve telif/marka hakları ile korunur. Platformdaki kayıtların seçilmesi, düzenlenmesi, sınıflandırılması ve birbirine bağlanmasıyla oluşan derleme, 5846 sayılı Kanun'un veri tabanı hükümleriyle korunur. Kullanıcı İçerikleri dışında, sitenin görsel tasarımı, kodu ve veri tabanı izinsiz kopyalanamaz, çoğaltılamaz veya ticari amaçla kullanılamaz. Kişisel ve ticari olmayan kullanım ile kaynak belirterek bağlantı verme serbesttir.</p>
      </div>

      <div class="content-section" id="im-hs-sorumluluk">
        <h2>13. Sorumluluğun sınırlandırılması</h2>
        <p>MİMARLAB, Derlenmiş İçeriğin veya Kullanıcı İçeriğinin doğruluğunu, güncelliğini veya eksiksizliğini garanti etmez; içerikler "olduğu gibi" sunulur. Platformdaki bilgiler mesleki, hukuki veya ticari tavsiye niteliği taşımaz; proje, ürün veya profil bilgilerine dayanarak vereceğiniz kararlardan sorumluluk size aittir. Platformun kesintisiz veya hatasız çalışacağını taahhüt etmeyiz. Platform kullanımından doğabilecek dolaylı, arızi veya sonuç niteliğindeki zararlardan, yürürlükteki mevzuatın izin verdiği azami ölçüde sorumlu tutulamayız; ücretli hizmetlerde sorumluluğumuz her hâlde ilgili hizmet için ödediğiniz tutarla sınırlıdır. Tüketicilerin emredici hükümlerden doğan hakları saklıdır. Bir bilginin hatalı olduğunu düşünüyorsanız <a href="mailto:info@mimarlab.com">info@mimarlab.com</a> adresinden bize bildirin.</p>
      </div>

      <div class="content-section" id="im-hs-degisiklik">
        <h2>14. Hizmetin ve şartların değiştirilmesi</h2>
        <p>MİMARLAB, hizmetin herhangi bir bölümünü önceden bildirmeksizin değiştirme, geçici olarak durdurma veya sonlandırma hakkını saklı tutar. Bu şartları ihlal eden hesapları askıya alabilir veya kapatabiliriz. Bu şartlarda yapılacak değişikliklerde sayfanın üst kısmındaki "son güncelleme" tarihi güncellenir; önemli değişiklikleri ayrıca sitede veya e-posta yoluyla duyururuz. Değişiklikten sonra platformu kullanmaya devam etmeniz güncel şartları kabul ettiğiniz anlamına gelir.</p>
      </div>

      <div class="content-section" id="im-hs-hukuk">
        <h2>15. Uygulanacak hukuk ve uyuşmazlık çözümü</h2>
        <p>Bu şartlar Türkiye Cumhuriyeti kanunlarına tabidir. Bu şartlardan doğabilecek uyuşmazlıklarda Türkiye mahkemeleri ve icra daireleri yetkilidir. Tüketici sıfatını taşıyan kullanıcılar, 6502 sayılı Kanun'daki parasal sınırlar dâhilinde bulundukları yerdeki tüketici hakem heyetine veya tüketici mahkemesine başvurabilir. Kişisel verilere ilişkin şikâyetler için <a href="/gizlilik-politikasi">Gizlilik Politikası</a>'ndaki başvuru yolu geçerlidir.</p>
      </div>

      <div class="content-section" id="im-hs-iletisim">
        <h2>16. İletişim</h2>
        <p>Hizmet şartlarımızla ilgili sorularınız için <a href="/iletisim">iletişim sayfamızdan</a> ya da doğrudan <a href="mailto:info@mimarlab.com">info@mimarlab.com</a> adresinden bize ulaşabilirsiniz. Kişisel verilerinizin işlenmesi hakkında bilgi için <a href="/gizlilik-politikasi">Gizlilik Politikası</a>, çerez kullanımımız için <a href="/cerez-politikasi">Çerez Politikası</a>, işletmeci bilgileri için <a href="/hakkinda">Hakkında</a> sayfamıza bakabilirsiniz.</p>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------------------------------------
  // ÇEREZ POLİTİKASI — cerez-politikasi.html#content-wrap ile BİREBİR aynı içerik (bkz. o dosya,
  // 2026-08-28'de Architonic'in çerez politikası sayfası yapı referansı alınarak eklendi). Aynı
  // gerekçeyle TOC anchor id'leri im- önekiyle benzersizleştirildi (bkz. gizlilikTemplate).
  // ---------------------------------------------------------------------------------------------
  function cerezTemplate() {
    return `
    <div class="content-wrap">
      <div class="content-eyebrow">Kurumsal</div>
      <h1 class="content-title">Çerez Politikası</h1>
      <p class="content-updated">Son güncelleme: 8 Eylül 2026</p>
      <p class="content-lead">Bu Çerez Politikası, MİMARLAB'ı (mimarlab.com) ziyaret ettiğinizde tarayıcınızda hangi çerezlerin ve benzer teknolojilerin kullanıldığını, bunları hangi amaçla ve hangi hukuki dayanakla kullandığımızı ve nasıl kontrol edebileceğinizi açıklar. Kişisel Verileri Koruma Kurumu'nun Çerez Uygulamaları Hakkında Rehberi dikkate alınarak hazırlanmıştır. Kişisel verilerinizin genel olarak nasıl işlendiği için <a href="/gizlilik-politikasi">Gizlilik Politikası</a> sayfamıza bakabilirsiniz.</p>

      <div class="content-toc">
        <h2>Bu sayfada</h2>
        <ol>
          <li><a href="#im-cz-nedir">Çerez nedir?</a></li>
          <li><a href="#im-cz-kullandiklarimiz">Kullandığımız çerezler ve depolama kayıtları</a></li>
          <li><a href="#im-cz-ucuncu-taraf">Üçüncü taraf çerezleri ve kaynaklar</a></li>
          <li><a href="#im-cz-hukuki-dayanak">Hukuki dayanak ve rıza</a></li>
          <li><a href="#im-cz-kullanmadiklarimiz">Kullanmadığımız çerez türleri</a></li>
          <li><a href="#im-cz-kontrol">Çerezleri nasıl kontrol edebilirsiniz?</a></li>
          <li><a href="#im-cz-degisiklikler">Politikadaki değişiklikler</a></li>
          <li><a href="#im-cz-iletisim">İletişim</a></li>
        </ol>
      </div>

      <div class="content-section" id="im-cz-nedir">
        <h2>1. Çerez nedir?</h2>
        <p>Çerezler, bir web sitesini ziyaret ettiğinizde tarayıcınıza kaydedilen küçük metin dosyalarıdır. Oturum çerezleri tarayıcınızı kapattığınızda silinir; kalıcı çerezler ise belirli bir süre (genellikle birkaç gün ile birkaç yıl arasında) cihazınızda saklanır ve sizi tekrar ziyaretinizde tanımaya yarar. Çerezlere ek olarak, tarayıcınızın <code>localStorage</code> ve <code>sessionStorage</code> gibi benzer depolama teknolojilerini de (ör. tema tercihinizi hatırlamak için) sınırlı ölçüde kullanırız; bu politika bu kayıtları da kapsar.</p>
      </div>

      <div class="content-section" id="im-cz-kullandiklarimiz">
        <h2>2. Kullandığımız çerezler ve depolama kayıtları</h2>
        <p>MİMARLAB'da çerezleri üç kategoride topluyoruz: sitenin çalışması için zorunlu olanlar, tercihinizi hatırlayan işlevsel kayıtlar ve site trafiğini anlamamızı sağlayan performans/analitik çerezleri.</p>
        <div class="cookie-table-wrap">
          <table class="cookie-table">
            <thead>
              <tr><th>Ad</th><th>Tür</th><th>Amaç</th><th>Süre</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><code>__Host-mimarlab_session</code></td>
                <td><span class="cookie-badge">Zorunlu</span></td>
                <td>Giriş yaptığınızda oturumunuzu (kimliğinizi) sunucu tarafında hatırlar; hesap gerektiren tüm özellikler (kaydedilenler, profil, gönderiler, mesajlar) buna bağlıdır. Yalnızca HTTPS üzerinden gönderilir, HttpOnly'dir (JavaScript ile okunamaz) ve SameSite=Lax ile üçüncü taraf sitelerden gönderilmez. Giriş yapmadıysanız bu çerez ayarlanmaz.</td>
                <td>30 gün veya çıkış yapana kadar</td>
              </tr>
              <tr>
                <td><code>mimarlab-theme</code></td>
                <td><span class="cookie-badge">İşlevsel</span></td>
                <td>Açık/koyu tema tercihinizi tarayıcınızda (yerel depolama olarak, çerez değil) hatırlar. Sunucuya gönderilmez.</td>
                <td>Siz silene kadar</td>
              </tr>
              <tr>
                <td><code>mlab:an:*</code> (sessionStorage)</td>
                <td><span class="cookie-badge">İşlevsel</span></td>
                <td>Profil İstatistikleri sayacının aynı sekme oturumunda aynı kaydı iki kez saymamasını sağlayan, kimlik içermeyen işaret. Yalnızca sekme açık olduğu sürece yaşar.</td>
                <td>Sekme kapanana kadar</td>
              </tr>
              <tr>
                <td><code>_ga</code>, <code>_ga_*</code></td>
                <td><span class="cookie-badge">Performans</span></td>
                <td>Google Analytics tarafından, ziyaretçileri ayırt etmek ve site trafiğini/kullanım eğilimlerini toplu (istatistiksel) biçimde ölçmek için ayarlanır. Reklam veya kişiselleştirme amacıyla kullanılmaz.</td>
                <td>Google'ın varsayılanı, en fazla 2 yıl</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>Cloudflare altyapısı, sitenin güvenliğini sağlamak (bot koruması, saldırı önleme) amacıyla zaman zaman kendi teknik çerezlerini (ör. <code>__cf_bm</code>) ayarlayabilir; bunlar zorunlu niteliktedir, kısa ömürlüdür ve sizi siteler arasında izlemez.</p>
      </div>

      <div class="content-section" id="im-cz-ucuncu-taraf">
        <h2>3. Üçüncü taraf çerezleri ve kaynaklar</h2>
        <p>Yukarıdaki tabloda listelenen <strong>Google Analytics</strong> çerezleri Google LLC tarafından işletilir ve verileriniz Google'ın kendi gizlilik politikasına tabi olarak işlenir. Bu çerezler tarayıcınıza yalnızca sitemizi ziyaret ettiğinizde, bizim adımıza istatistiksel ölçüm amacıyla yerleştirilir; MİMARLAB bu verileri reklam veya kişiselleştirme amacıyla kullanmaz veya satmaz.</p>
        <p>Google veya LinkedIn ile giriş yaptığınızda, görüşme randevusu için Google Meet'e geçtiğinizde ya da Gündem sayfasındaki bir habere tıkladığınızda ilgili sağlayıcının kendi sitesine gidersiniz; orada o sağlayıcının çerezleri ve politikası geçerlidir. Gündem sayfasındaki haber görselleri doğrudan kaynak yayının sunucusundan yüklenir; bu yükleme sırasında tarayıcınız o sunucuya bağlanır, ancak MİMARLAB bu kaynaklara herhangi bir kimlik bilgisi iletmez.</p>
      </div>

      <div class="content-section" id="im-cz-hukuki-dayanak">
        <h2>4. Hukuki dayanak ve rıza</h2>
        <ul>
          <li><strong>Zorunlu çerezler</strong> (oturum çerezi, Cloudflare güvenlik çerezleri) ve <strong>işlevsel kayıtlar</strong> (tema tercihi, sayaç işareti) açıkça talep ettiğiniz bir hizmetin sunulması için gereklidir; KVKK m. 5/2(c) ve m. 5/2(f) uyarınca açık rıza gerektirmeden kullanılır.</li>
          <li><strong>Performans/analitik çerezleri</strong> (Google Analytics) hizmetin sunulması için zorunlu değildir; bunları istemiyorsanız aşağıdaki <a href="#im-cz-kontrol">kontrol yöntemleriyle</a> devre dışı bırakabilirsiniz. Bu çerezler engellendiğinde sitenin hiçbir işlevi etkilenmez.</li>
        </ul>
      </div>

      <div class="content-section" id="im-cz-kullanmadiklarimiz">
        <h2>5. Kullanmadığımız çerez türleri</h2>
        <p>MİMARLAB, <strong>reklam/pazarlama çerezleri</strong>, sosyal medya izleme pikselleri veya siteler arası profilleme araçları kullanmamaktadır; sitede üçüncü taraf reklam ağı bulunmaz. Bu durum değişirse bu sayfa güncellenir ve gerekli olması hâlinde açık rıza alan bir çerez bildirimi eklenir.</p>
      </div>

      <div class="content-section" id="im-cz-kontrol">
        <h2>6. Çerezleri nasıl kontrol edebilirsiniz?</h2>
        <p>Tarayıcınızın ayarlarından çerezleri görüntüleyebilir, engelleyebilir veya silebilirsiniz; bu ayarlar genellikle tarayıcının "Gizlilik" veya "Güvenlik" bölümünde yer alır. Oturum çerezini engellemeniz durumunda giriş yapmayı ve hesabınızla ilgili özellikleri kullanmayı gerektiren sayfalar çalışmaz; yerel depolamayı temizlediğinizde tema tercihiniz sıfırlanır.</p>
        <p>Google Analytics çerezlerini devre dışı bırakmak isterseniz, Google'ın <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener">Analytics devre dışı bırakma eklentisini</a> kullanabilir ya da tarayıcınızın üçüncü taraf çerezlerini engelleyebilirsiniz; bu durumda temel site işlevleri etkilenmez, yalnızca kullanım verileriniz Analytics'e iletilmez.</p>
      </div>

      <div class="content-section" id="im-cz-degisiklikler">
        <h2>7. Politikadaki değişiklikler</h2>
        <p>Kullandığımız çerezler zaman içinde değişebilir; önemli değişikliklerde bu sayfanın üst kısmındaki "son güncelleme" tarihini güncelleriz. Politikayı düzenli aralıklarla gözden geçirmenizi öneririz.</p>
      </div>

      <div class="content-section" id="im-cz-iletisim">
        <h2>8. İletişim</h2>
        <p>Çerez politikamızla ilgili sorularınız için <a href="/iletisim">iletişim sayfamızdan</a> ya da doğrudan <a href="mailto:info@mimarlab.com">info@mimarlab.com</a> adresinden bize ulaşabilirsiniz. Kişisel verilerinizin genel olarak işlenmesi hakkında <a href="/gizlilik-politikasi">Gizlilik Politikası</a>, platform kullanım kurallarımız için <a href="/hizmet-sartlari">Hizmet Şartları</a> sayfalarına bakabilirsiniz.</p>
      </div>
    </div>`;
  }

  // Sayfa içi TOC bağlantıları (#im-...) modal içindeyken de aynı panel'in içinde kaydırsın diye
  // (bkz. kullanıcı isteği: tasarım/davranış birebir korunsun) — tarayıcının varsayılan anchor
  // kaydırması document.body'yi hedef alır, modal-shell'in KENDİ scroll konteyneri (.modal-shell-body)
  // olduğundan hiçbir şey olmaz; bu yüzden delege edilmiş bir tıklama dinleyicisiyle elle kaydırılır.
  function wireInPanelAnchors(root) {
    root.querySelectorAll('a[href^="#im-"]').forEach(a => {
      a.addEventListener('click', (e) => {
        const target = document.getElementById(a.getAttribute('href').slice(1));
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  // ---------------------------------------------------------------------------------------------
  // ROZET AL (= Ödeme Sayfası) — satin-al.html#checkout-wrap ile BİREBİR aynı işaretleme/mantık
  // (bkz. o dosya — kod tabanında bundan ayrı bir "ödeme sayfası" yok, kart bilgisi iyzico'nun
  // hosted sayfasında girilir, havale/EFT ise doğrudan bu formda). Giriş yapılmamışsa orijinal
  // davranış BİREBİR korunur: tam sayfa yönlendirme (artık '/giris'e, bkz. kullanıcı isteği:
  // "preserve design 1:1" — bu, hesabim görünümünün aksine bir modal swap'ı DEĞİL, çünkü orijinal
  // sayfa da zaten aynı şekilde tam yönlendirme yapıyordu).
  // ---------------------------------------------------------------------------------------------
  function rozetAlTemplate() {
    return `
    <div class="page-head">
      <div class="eyebrow">Rozet Satın Al</div>
      <h1>Bir kademe seç</h1>
      <p>Rozetler aylık kiralanır. Kendin için ayrı, firman için ayrı rozet alabilirsin.</p>
    </div>
    <div class="checkout-wrap">
      <div class="form-section" id="im-target-section">
        <h2>Kimin için?</h2>
        <p class="section-hint">Kendi hesabın için mi, yoksa sahiplendiğin bir firma profili için mi rozet almak istiyorsun?</p>
        <label class="target-option"><input type="radio" name="im-badge-target" id="im-target-self" value="self" checked> Kendim için</label>
        <label class="target-option"><input type="radio" name="im-badge-target" id="im-target-office" value="office"> Bir firmam için</label>
        <div id="im-target-office-wrap" style="display:none; margin-top:10px;">
          <select class="target-office-select" id="im-target-office-select"></select>
          <p id="im-target-office-empty" style="display:none; font-size:12.5px; color:var(--ink-soft); margin-top:8px;">Rozet alabilmen için önce bir firma profilini sahiplenip onaylatman gerekiyor. <a href="/firma" style="color:var(--walnut); font-weight:600;">Firmanı bul</a>.</p>
        </div>
      </div>

      <div class="form-section">
        <h2>Rozetler</h2>
        <p class="section-hint">Devam etmeden önce dilediğin kademeyi seçebilirsin.</p>
        <div class="tier-grid" id="im-tier-grid"></div>
        <div class="already-has" id="im-sales-closed" style="margin-top:18px;">
          <strong>Rozet satışı şu an açık değil</strong>
          <p>Şimdilik ödeme almıyoruz. Rozet satışı kredi/banka kartıyla ödeme açıldığında başlayacak; açıldığında burada duyuracağız.</p>
        </div>
      </div>

      <div class="form-section" id="im-already-has-section" style="display:none;">
        <div class="already-has">
          <strong id="im-already-has-title">Zaten aktif bir rozetin var</strong>
          <p id="im-already-has-text">Aynı ya da daha düşük bir kademeye geçemezsin. Bunun için mevcut rozetinin süresi dolmalı. Daha yüksek bir kademeye yükseltebilirsin.</p>
          <a class="form-submit" href="/hesabim" style="display:inline-block; width:auto; padding:12px 28px;">Hesabım'a Dön</a>
        </div>
      </div>
    </div>`;
  }

  // ÖDEME POPUP'I KALDIRILDI (kullanıcı isteği, 2026-09-08): "Rozet Al sayfasından havale ile öde
  // seçeneğini kaldır, şimdilik ödeme almıyoruz; IBAN bilgilerini siteden sil." Eski
  // ensureRozetPayPopup (havale/EFT + IBAN kutusu + "Ödemeyi Yaptım" -> POST /api/badges) burada
  // duruyordu; sunucu ucu da satışı reddediyor (bkz. src/routes/badges.js#BADGE_SALES_OPEN). Kart
  // ödemesi açıldığında akış src/routes/payments.js#startCheckout (iyzico hosted sayfa) üzerinden
  // kurulmalı, IBAN'lı havale kutusu geri GETİRİLMEMELİ.

  function mountRozetAl() {
    // Sayfa giriş YAPMADAN da görüntülenebilir (kullanıcı isteği, 2026-09-05). Satış şu an KAPALI
    // (kullanıcı isteği, 2026-09-08 — "şimdilik ödeme almıyoruz"): "Rozeti Seç" butonu ve ödeme
    // popup'ı kaldırıldı, yerinde #im-sales-closed kutusu duruyor; kademe/fiyat tanıtımı ve mevcut
    // rozet paneli (loadMyBadges) çalışmaya devam eder. /api/claims/mine ve /api/badges/mine
    // oturumsuzken sessizce boş sonuç döner (catch/res.ok kontrolleri), sayfa çökmez.

    // "Mesaj" perk'i her iki kademede de listelenir — bkz. architect-modal.js/office-modal.js#
    // renderMessageIcon (kullanıcı isteği 2026-08-30: doğrulanmış/altın üyeler artık TÜM kullanıcılara
    // mesaj gönderip TÜM kullanıcılardan mesaj alabilir — gönderen taraf rozetliyse alıcı profilin
    // kendi rozeti olması ARANMAZ, bkz. badge-shared.js#myEffectiveBadge; alıcı taraf da firma pozisyon
    // kısıtlaması olmadan mesaj alabilir, bkz. src/routes/messages.js#resolveRecipients).
    // "Dışa PDF Aktarma" (kullanıcı isteği, 2026-09-04 madde 1): Koleksiyonum'daki panoyu PDF olarak
    // dışa aktarma ZATEN rozet kapısının arkasındaydı (bkz. auth-modal.js#am-col-export-btn ->
    // fetchBadgeAccess, 2026-09-02) ama ayrıcalık listesinde hiç yazmıyordu — kapı her iki kademede
    // de aynı olduğundan ikisinde birden listelenir.
    //
    // "Profil İstatistikleri" YALNIZCA Altın Üye altında yazılır — ve 2026-09-04'teki takip
    // isteğinden ("İstatistik erişimini altın üyeyle sınırla") sonra ERİŞİM de öyle: kapı artık
    // 'gold' kademesi arıyor (bkz. src/lib/analyticsAccess.js#hasAnalyticsAccess). Yani bu satır
    // artık salt tanıtım değil, gerçek kuralın birebir karşılığı.
    //
    // "Görselde Ürün Etiketleme" (kullanıcı isteği, 2026-09-05: "sadece rozeti olan kullanıcılara
    // has olsun ... rozet al sayfasında bu özellikten ayrıcalık olarak bahset") HER İKİ kademede
    // de listelenir, çünkü kapı kademe AYIRT ETMİYOR: src/routes/hotspotTags.js#hasTaggingAccess
    // yalnızca "aktif rozet var mı" diye soruyor (badgeAccess.js#hasAnyActiveBadge). Bir kademeye
    // özel yazılsaydı tanıtım ile gerçek kural ayrışırdı — İstatistikler'de bilerek kaçınılan hata.
    const TAGGING_PERK = 'Proje görsellerinde ürün etiketleme özelliğini açar: katalogdaki herhangi bir ürünü projenin fotoğrafında işaretlersin, markanın onayından sonra işaretçi herkese görünür.';
    const BADGE_TIERS = [
      { type: 'verified', label: 'Doğrulanmış Üye', selfPrice: 49, officePrice: 129, perks: ['Doğrulanmış Üye rozeti verir.', 'Tüm kullanıcılara mesaj gönderip tüm kullanıcılardan mesaj alabilme özelliğini açar.', 'Panolarını dışa PDF aktarma özelliğini açar.', TAGGING_PERK] },
      { type: 'gold', label: 'Altın Üye', selfPrice: 99, officePrice: 199, perks: ['Altın Üye rozeti verir.', 'Tüm kullanıcılara mesaj gönderip tüm kullanıcılardan mesaj alabilme özelliğini açar.', 'Panolarını dışa PDF aktarma özelliğini açar.', TAGGING_PERK, 'Hesabım sayfasında Profil İstatistikleri bölümünü açar: profil ve içerik görüntülenmeleri, arama gösterimleri, kaydetmeler, takipçiler ve mesaj analizleri.'] },
    ];
    const BADGE_STATUS_LABELS = { pending: 'İnceleniyor', active: 'Aktif' };
    const BADGE_RANK = { gold: 2, verified: 1 };

    const params = new URLSearchParams(window.location.search);
    let selectedTier = BADGE_TIERS.find(t => t.type === params.get('tier')) ? params.get('tier') : BADGE_TIERS[0].type;
    let selectedTargetType = 'self';
    let selectedTargetKey = null;

    function priceForTier(tier) {
      return selectedTargetType === 'self' ? tier.selfPrice : tier.officePrice;
    }
    function formatTRY(n) { return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL'; }

    function renderTierGrid() {
      const grid = document.getElementById('im-tier-grid');
      grid.innerHTML = BADGE_TIERS.map(t => `
        <button type="button" class="tier-card${t.type === selectedTier ? ' selected' : ''}" data-type="${t.type}">
          <span class="tier-card-check">${t.type === selectedTier ? '✓' : ''}</span>
          <div class="tier-card-name">${t.label}</div>
          <div class="tier-card-price">${formatTRY(priceForTier(t))} / ay</div>
          <ul class="tier-card-perks">${t.perks.map(p => `<li>${p}</li>`).join('')}</ul>
        </button>`).join('');
      grid.querySelectorAll('.tier-card').forEach(card => {
        card.addEventListener('click', () => {
          selectedTier = card.dataset.type;
          renderTierGrid();
          updateExistingBadgePanel();
        });
      });
    }

    renderTierGrid();

    let myBadges = [];
    let myProfileBadges = { self: null, offices: {} };
    async function loadMyBadges() {
      try {
        const res = await fetch('/api/badges/mine');
        if (res.ok) {
          const data = await res.json();
          myBadges = data.items || [];
          myProfileBadges = data.profileBadges || { self: null, offices: {} };
        }
      } catch {}
      updateExistingBadgePanel();
    }

    function updateExistingBadgePanel() {
      const now = Date.now();
      const matches = (b) => b.target_type === selectedTargetType && (b.target_key || null) === selectedTargetKey;
      const activeBadge = myBadges.find(b => matches(b) && b.status === 'active' && (!b.expires_at || b.expires_at > now));
      const pendingBadge = myBadges.find(b => matches(b) && b.status === 'pending');
      // Hedef profilde O AN GÖRÜNEN rozet (bkz. src/routes/badges.js#getProfileBadgesForUser) —
      // admin'in verdiği rozeti de, firmayı sahiplenen BAŞKA bir ortağın satın aldığı rozeti de
      // kapsar; sunucu tarafı satın alma kontrolü (getBlockingRank) BİREBİR aynı kaynağı kullanır.
      const profileBadgeType = selectedTargetType === 'office'
        ? (selectedTargetKey ? myProfileBadges.offices[selectedTargetKey] : null)
        : myProfileBadges.self;
      const activeRank = activeBadge ? (BADGE_RANK[activeBadge.badge_type] || 0) : 0;
      const profileRank = profileBadgeType ? (BADGE_RANK[profileBadgeType] ?? Infinity) : 0;
      const blockingRank = Math.max(activeRank, profileRank);
      const isDowngradeOrSame = blockingRank > 0 && (BADGE_RANK[selectedTier] || 0) <= blockingRank;
      let blocking = pendingBadge || null;
      if (!blocking && isDowngradeOrSame) {
        blocking = profileRank >= activeRank ? { badge_type: profileBadgeType, status: 'active', admin: true } : activeBadge;
      }

      const salesClosedBox = document.getElementById('im-sales-closed');
      const alreadyHasSection = document.getElementById('im-already-has-section');
      if (!blocking) {
        salesClosedBox.style.display = '';
        alreadyHasSection.style.display = 'none';
        return;
      }
      const tier = BADGE_TIERS.find(t => t.type === blocking.badge_type);
      salesClosedBox.style.display = 'none';
      alreadyHasSection.style.display = 'block';
      const targetLabel = selectedTargetType === 'office' ? ` (${selectedTargetKey})` : '';
      document.getElementById('im-already-has-title').textContent =
        `${tier ? tier.label : blocking.badge_type} Rozetin${targetLabel} ${blocking.admin ? 'aktif' : (BADGE_STATUS_LABELS[blocking.status] || blocking.status.toLowerCase())}`;
      document.getElementById('im-already-has-text').textContent = blocking === pendingBadge
        ? 'Ödeme onayı bekleniyor. Sonucu Hesabım sayfandan takip edebilirsin.'
        : 'Aynı ya da daha düşük bir kademeye geçemezsin. Bunun için mevcut rozetinin süresi dolmalı. Daha yüksek bir kademeye yükseltebilirsin.';
    }
    loadMyBadges();

    // KÖK NEDEN (kullanıcı isteği, 2026-09-01 madde 3: "firma için rozet al kısmı halihazırda firma
    // üzerinde olan rozeti algılamıyor"): bu liste ASENKRON dolar ve eskiden yalnızca radyo "Bir
    // firmam için"e geçtiğinde çağrılıyordu. Radyo işleyicisi selectedTargetKey'i HENÜZ BOŞ olan
    // select'ten okuyup (=> null) updateExistingBadgePanel()'i hemen çalıştırıyor, liste sonradan
    // dolduğunda ise paneli BİR DAHA hiç güncellemiyordu — yani firmanın rozeti bilinse bile panel
    // "rozet yok" halinde donuyordu. İki düzeltme: (1) liste dolduktan sonra panel yeniden
    // hesaplanır, (2) liste mount anında önden yüklenir, böylece radyoya basıldığı anda anahtar hazır.
    let claimedOfficesReady = null;
    async function loadClaimedOffices() {
      const select = document.getElementById('im-target-office-select');
      const empty = document.getElementById('im-target-office-empty');
      try {
        const res = await fetch('/api/claims/mine');
        const items = res.ok ? (await res.json()).items || [] : [];
        const offices = items.filter(c => c.profile_type === 'office' && c.status === 'approved');
        if (!offices.length) {
          select.style.display = 'none';
          empty.style.display = 'block';
          return;
        }
        select.style.display = '';
        empty.style.display = 'none';
        select.innerHTML = offices.map(o => `<option value="${escapeAttr(o.profile_key)}">${escapeHtml(o.profile_key)}</option>`).join('');
        if (selectedTargetType === 'office') selectedTargetKey = select.value || null;
      } catch {
        select.style.display = 'none';
        empty.style.display = 'block';
      }
      updateExistingBadgePanel();
    }
    claimedOfficesReady = loadClaimedOffices();
    document.getElementById('im-target-office-select').addEventListener('change', (e) => {
      selectedTargetKey = e.target.value || null;
      updateExistingBadgePanel();
    });
    document.querySelectorAll('input[name="im-badge-target"]').forEach(radio => {
      radio.addEventListener('change', () => {
        selectedTargetType = radio.value;
        document.getElementById('im-target-office-wrap').style.display = selectedTargetType === 'office' ? '' : 'none';
        if (selectedTargetType === 'office') {
          selectedTargetKey = document.getElementById('im-target-office-select').value || null;
          // Önden yüklenen liste henüz gelmediyse geldiğinde panel kendini tazeler (loadClaimedOffices
          // sonunda updateExistingBadgePanel çağırır); geldiyse bu await anında çözülür.
          if (claimedOfficesReady) claimedOfficesReady.then(() => { if (selectedTargetType === 'office') updateExistingBadgePanel(); });
        } else {
          selectedTargetKey = null;
        }
        renderTierGrid();
        updateExistingBadgePanel();
      });
    });

  }

  // ---------------------------------------------------------------------------------------------
  // İADE ET — iade-et.html#checkout-wrap ile BİREBİR aynı işaretleme/mantık (bkz. o dosya).
  // ---------------------------------------------------------------------------------------------
  function iadeEtTemplate() {
    return `
    <div class="page-head">
      <div class="eyebrow">İade Talebi</div>
      <h1>Rozet İadesi Talep Et</h1>
      <p>Satın aldığın bir rozet için iade istiyorsan aşağıdaki formu doldur. Talebin ekibimize ulaşır, onaylandığında iade tutarını belirttiğin IBAN'a göndeririz.</p>
    </div>
    <div class="checkout-wrap">
      <div class="form-section" id="im-order-section">
        <h2>Hangi Rozet İçin?</h2>
        <p class="section-hint">Satın aldığın rozetlerden hangisi için iade istiyorsun?</p>
        <div class="order-empty" id="im-order-empty" style="display:none;">
          <p>Henüz bir rozet satın alımın yok.</p>
          <a class="form-submit" href="/rozet-al" style="display:inline-block; width:auto; padding:12px 28px;">Rozet Satın Al</a>
        </div>
        <div class="field" id="im-order-field" style="margin-bottom:0;">
          <select id="im-order-select"></select>
        </div>
      </div>

      <div class="form-section" id="im-refund-section">
        <h2>İade Bilgilerin</h2>
        <p class="section-hint">İade tutarı, girdiğin IBAN'a havale/EFT ile gönderilir.</p>
        <div class="field">
          <label for="im-refund-iban">İade Alacağın IBAN</label>
          <input type="text" id="im-refund-iban" placeholder="TR.. .. .... .... .... .... ..">
        </div>
        <div class="field">
          <label for="im-refund-account-name">Hesap Sahibi Adı Soyadı</label>
          <input type="text" id="im-refund-account-name" autocomplete="name">
        </div>
        <div class="field">
          <label for="im-refund-reason">Sebep</label>
          <textarea id="im-refund-reason" placeholder="İade istemenin sebebini kısaca yaz."></textarea>
        </div>
        <button class="form-submit" id="im-refund-submit-btn" type="button" style="margin-top:6px;">İade Talebini Gönder</button>
        <div class="form-notice" id="im-iade-notice"></div>
      </div>
    </div>`;
  }

  function mountIadeEt() {
    const BADGE_TYPE_LABELS = { destekci: 'Destekçi', verified: 'Doğrulanmış Üye', gold: 'Altın Üye', platinum: 'Elmas Üye' };
    const BADGE_STATUS_LABELS = { pending: 'Onay Bekliyor', active: 'Aktif' };
    let iadeUser = null;
    let myOrders = [];

    function isValidIban(v) {
      const s = (v || '').replace(/\s+/g, '').toUpperCase();
      if (!/^TR\d{24}$/.test(s)) return false;
      const rearranged = s.slice(4) + s.slice(0, 4);
      const numeric = rearranged.replace(/[A-Z]/g, ch => (ch.charCodeAt(0) - 55).toString());
      let remainder = numeric;
      while (remainder.length > 9) {
        const block = remainder.slice(0, 9);
        remainder = (parseInt(block, 10) % 97).toString() + remainder.slice(block.length);
      }
      return parseInt(remainder, 10) % 97 === 1;
    }

    function orderLabel(b) {
      const tierLabel = BADGE_TYPE_LABELS[b.badge_type] || b.badge_type;
      const targetLabel = b.target_type === 'office' ? `Firma: ${b.target_key}` : 'Kendisi için';
      const statusLabel = BADGE_STATUS_LABELS[b.status] || b.status;
      // synthetic (bkz. mergeProfileBadges) — bu hesapta bir satın alma KAYDI yok, tarih de yok.
      if (b.synthetic) return `${tierLabel} — ${targetLabel} — ${statusLabel} (bu hesapta ödeme kaydı yok)`;
      const dateStr = new Date(b.created_at).toLocaleDateString('tr-TR');
      return `${tierLabel} — ${targetLabel} — ${statusLabel} (${dateStr})`;
    }

    // KÖK NEDEN (kullanıcı isteği, 2026-09-01 madde 3: "iade et sayfası da halihazırda olan rozeti
    // algılamıyor"): bu ekran YALNIZCA kullanıcının KENDİ badge_requests satırlarını listeliyordu.
    // Profilde görünen bir rozetin bu tabloda karşılığı olmayabilir — admin doğrudan vermiş
    // olabilir (admin_badges, user_id taşımaz) ya da firmayı sahiplenen başka bir ortak satın almış
    // olabilir. Bu durumda ekran "Henüz bir rozet satın alımın yok" diyordu. Artık profilde GÖRÜNEN
    // rozetler (bkz. src/routes/badges.js#getProfileBadgesForUser — Rozet Al ekranıyla AYNI kaynak)
    // listeye ekleniyor, kendi siparişiyle zaten temsil edilenler mükerrer olmasın diye eleniyor.
    function mergeProfileBadges(orders, profileBadges) {
      const out = orders.slice();
      const covered = new Set(orders.map(b => `${b.target_type}:${b.target_key || ''}:${b.badge_type}`));
      const add = (targetType, targetKey, badgeType) => {
        if (!badgeType) return;
        if (covered.has(`${targetType}:${targetKey || ''}:${badgeType}`)) return;
        out.push({
          id: `profile:${targetType}:${targetKey || ''}`,
          badge_type: badgeType, target_type: targetType, target_key: targetKey,
          status: 'active', price_try: 0, created_at: null, synthetic: true,
        });
      };
      add('self', null, profileBadges.self);
      Object.keys(profileBadges.offices || {}).forEach(key => add('office', key, profileBadges.offices[key]));
      return out;
    }

    async function loadMyOrders() {
      try {
        const res = await fetch('/api/badges/mine');
        const data = res.ok ? await res.json() : {};
        const items = (data.items || []).filter(b => b.status !== 'rejected');
        myOrders = mergeProfileBadges(items, data.profileBadges || { self: null, offices: {} });
      } catch {
        myOrders = [];
      }
      const orderEmpty = document.getElementById('im-order-empty');
      const orderField = document.getElementById('im-order-field');
      const refundSection = document.getElementById('im-refund-section');
      if (!myOrders.length) {
        orderEmpty.style.display = 'block';
        orderField.style.display = 'none';
        refundSection.style.display = 'none';
        return;
      }
      orderEmpty.style.display = 'none';
      orderField.style.display = '';
      refundSection.style.display = '';
      document.getElementById('im-order-select').innerHTML = myOrders.map(b => `<option value="${escapeAttr(b.id)}">${escapeHtml(orderLabel(b))}</option>`).join('');
    }
    loadMyOrders();

    document.getElementById('im-refund-submit-btn').addEventListener('click', async () => {
      const btn = document.getElementById('im-refund-submit-btn');
      const notice = document.getElementById('im-iade-notice');
      notice.classList.remove('show', 'success');

      const orderId = document.getElementById('im-order-select').value;
      const order = myOrders.find(b => b.id === orderId);
      const iban = document.getElementById('im-refund-iban').value.trim();
      const accountName = document.getElementById('im-refund-account-name').value.trim();
      const reason = document.getElementById('im-refund-reason').value.trim();

      if (!order) { notice.textContent = 'Lütfen iade istediğin rozeti seç.'; notice.classList.add('show'); return; }
      if (!isValidIban(iban)) { notice.textContent = 'Geçerli bir IBAN gir (TR ile başlayan 26 karakter).'; notice.classList.add('show'); return; }
      if (!accountName) { notice.textContent = 'Hesap sahibinin adı soyadı gerekli.'; notice.classList.add('show'); return; }
      if (reason.length < 8) { notice.textContent = 'Sebebi biraz daha ayrıntılı yazar mısın?'; notice.classList.add('show'); return; }
      if (!iadeUser) { notice.textContent = 'Bu işlem için giriş yapmalısın.'; notice.classList.add('show'); return; }

      const message = [
        'İade Talebi',
        `Rozet: ${orderLabel(order)}`,
        order.synthetic
          ? 'Tutar: bu hesapta ödeme kaydı yok (rozet yönetici tarafından verilmiş ya da profili sahiplenen başka bir hesap satın almış olabilir)'
          : `Tutar: ${Number(order.price_try).toFixed(2)} TL`,
        `İade IBAN: ${iban.replace(/\s+/g, '').toUpperCase()}`,
        `Hesap Sahibi: ${accountName}`,
        `Sebep: ${reason}`,
      ].join('\n');

      btn.disabled = true;
      btn.textContent = 'Gönderiliyor…';
      try {
        const res = await fetch('/api/contact', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: iadeUser.name, email: iadeUser.email, message }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          notice.textContent = data.error || 'Talep gönderilemedi, tekrar dene.';
          notice.classList.add('show');
          btn.disabled = false;
          btn.textContent = 'İade Talebini Gönder';
          return;
        }
        notice.textContent = 'İade talebin alındı. Ekibimiz en kısa sürede seninle iletişime geçecek.';
        notice.classList.add('show', 'success');
        btn.textContent = 'Talebin Gönderildi';
      } catch {
        notice.textContent = 'Sunucuya ulaşılamadı, lütfen tekrar dene.';
        notice.classList.add('show');
        btn.disabled = false;
        btn.textContent = 'İade Talebini Gönder';
      }
    });

    fetch('/api/auth/me').then(async res => {
      if (!res.ok) { window.location.href = '/giris'; return; }
      const data = await res.json().catch(() => ({}));
      iadeUser = data.user || null;
    });
  }

  // ---------------------------------------------------------------------------------------------
  // NEDEN MİMARLAB? (kullanıcı isteği, 2026-09-06 madde 7: "Neden MİMARLAB? sayfası popup şeklinde
  // açılsın") — neden-mimarlab.html'in <main> içeriği ve betiği buraya, diğer sekiz InfoModal
  // görünümüyle AYNI desende taşındı.
  //
  // İKİ NOKTADA BİLEREK FARKLI:
  //   1) Bölüm/eleman id'leri "nm-" ile öneklendi. Bu içerik artık BAŞKA bir sayfanın (ör. ana
  //      sayfanın) DOM'una enjekte ediliyor; "hero"/"markalar"/"stats-band" gibi jenerik id'ler o
  //      sayfanınkilerle çakışıp getElementById'ın YANLIŞ elemanı bulmasına yol açardı.
  //   2) "sunum modu" (ok tuşlarıyla tam ekran bölüm gezinmesi) taşınmadı — bir popup'ın içinde
  //      anlamı yok. O mod hâlâ /neden-mimarlab?sunum=1 ile ORİJİNAL sayfadan çalışır (bkz.
  //      src/index.js — sunum sorgusu taşıyan istekler statik dosyaya düşürülür).
  //
  // Elemanları DAİMA panel kökünden (root) sorgularız; document geneli arama, aynı anda açık olan
  // host sayfanın kendi elemanlarını yakalayabilirdi.
  // ---------------------------------------------------------------------------------------------
  function nedenMimarlabTemplate() {
    return `
    <section class="nm-sec nm-hero" id="nm-sec-hero">
      <div class="nm-wrap">
        <h1 class="nm-h1">Türkiye'nin yapı dünyası<br><span class="nm-accent">tek bir ağda.</span></h1>
        <p class="nm-lead">Proje, kişi, firma, ürün ve marka — hepsi birbirine bağlı.</p>
        <div class="nm-btn-row">
          <a class="nm-btn" href="/proje">Platformu Keşfet</a>
          <a class="nm-btn nm-btn-ghost" href="/uye-ol">Ücretsiz Katıl</a>
        </div>
      </div>
    </section>

    <!-- Görselden ürüne: MİMARLAB'ın ayırt edici özelliği — proje fotoğrafındaki ürünler işaretlenip
         gerçek ürün kayıtlarına bağlanır. Gösterim UYDURMA DEĞİL, canlı projelerin gerçek
         işaretçilerinden çizilir; hiç işaretçili proje yoksa bölüm kendini kaldırır. -->
    <section class="nm-sec nm-tag-sec" id="nm-sec-etiket" aria-labelledby="nm-etiket-h">
      <div class="nm-wrap">
        <h2 class="nm-h2" id="nm-etiket-h">Fotoğraftaki ürünü işaretle,<br>gerçek ürün sayfasına bağla.</h2>
        <div class="nm-tag-stage" id="nm-tag-stage">
          <img id="nm-tag-img" alt="" decoding="async">
          <div id="nm-tag-dots"></div>
        </div>
        <p class="nm-note" id="nm-tag-caption"></p>
        <div class="nm-btn-row" id="nm-tag-actions" hidden>
          <a class="nm-btn nm-btn-ghost" id="nm-tag-link" href="#">Projeyi Aç</a>
          <button class="nm-btn nm-btn-ghost" type="button" id="nm-tag-next">Başka bir örnek</button>
        </div>
      </div>
    </section>

    <!-- Canlı sayılar — sayfanın ana görsel iddiası. Metin yok, yalnızca rakam. -->
    <section class="nm-sec nm-band-dark nm-stats-sec" id="nm-sec-veriler" aria-labelledby="nm-veriler-h">
      <div class="nm-wrap">
        <h2 class="nm-sr" id="nm-veriler-h">Platform verileri</h2>
        <div class="nm-stats" id="nm-stats-band">
          <a class="nm-stat" href="/proje"><span class="nm-num" data-stat="projects">—</span><span class="nm-lab">Proje</span></a>
          <a class="nm-stat" href="/kisi"><span class="nm-num" data-stat="architects">—</span><span class="nm-lab">Kişi</span></a>
          <a class="nm-stat" href="/firma"><span class="nm-num" data-stat="offices">—</span><span class="nm-lab">Firma</span></a>
          <a class="nm-stat" href="/urun"><span class="nm-num" data-stat="products">—</span><span class="nm-lab">Ürün</span></a>
          <a class="nm-stat" href="/marka"><span class="nm-num" data-stat="brands">—</span><span class="nm-lab">Marka</span></a>
        </div>
        <p class="nm-note" id="nm-stats-note" role="status" aria-live="polite">Canlı veriler yükleniyor…</p>
      </div>
    </section>

    <!-- Ekosistem — metin yerine DİYAGRAM. Satır içi SVG: dış bağımlılık yok, currentColor ile
         gece/gündüz temasına kendiliğinden uyar. -->
    <section class="nm-sec nm-graph-sec" id="nm-sec-ekosistem" aria-labelledby="nm-ekosistem-h">
      <div class="nm-wrap">
        <h2 class="nm-h2" id="nm-ekosistem-h">Her kayıt bir diğerine açılır</h2>
        <div class="nm-graph">
          <svg viewBox="0 0 900 420" role="img" aria-label="Proje, kişi, firma, ürün ve marka kayıtlarının birbirine bağlandığı ağ diyagramı">
            <g class="nm-edge" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M450 210 L200 110"/><path d="M450 210 L700 110"/>
              <path d="M450 210 L200 310"/><path d="M450 210 L700 310"/>
              <path d="M200 110 L200 310"/><path d="M700 110 L700 310"/>
            </g>
            <g class="nm-node">
              <circle cx="450" cy="210" r="62"/><text x="450" y="205">PROJE</text><text x="450" y="224" class="nm-sub">künye · görsel</text>
              <circle cx="200" cy="110" r="52"/><text x="200" y="106">KİŞİ</text><text x="200" y="124" class="nm-sub">portföy</text>
              <circle cx="700" cy="110" r="52"/><text x="700" y="106">FİRMA</text><text x="700" y="124" class="nm-sub">ekip</text>
              <circle cx="200" cy="310" r="52"/><text x="200" y="306">ÜRÜN</text><text x="200" y="324" class="nm-sub">dosya</text>
              <circle cx="700" cy="310" r="52"/><text x="700" y="306">MARKA</text><text x="700" y="324" class="nm-sub">katalog</text>
            </g>
          </svg>
        </div>
        <p class="nm-note" id="nm-network-live"></p>
      </div>
    </section>

    <!-- Roller — üç kart, kart başına tek cümle. -->
    <section class="nm-sec nm-band-alt nm-roles-sec" id="nm-sec-senin-icin" aria-labelledby="nm-senin-icin-h">
      <div class="nm-wrap">
        <h2 class="nm-h2" id="nm-senin-icin-h">Sen ne yapıyorsun?</h2>
        <div class="nm-roles">
          <a class="nm-role" href="/proje-ekle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 21h18"/><path d="M5 21V6l7-3 7 3v15"/><path d="M9 21v-6h6v6"/></svg>
            <h3>Mimar &amp; Firma</h3>
            <p>Projelerini künyesiyle yayınla, portföyünü kur.</p>
          </a>
          <a class="nm-role" href="/urun-ekle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M21 16V8l-9-5-9 5v8l9 5z"/><path d="M3.3 7.3 12 12l8.7-4.7"/><path d="M12 12v9"/></svg>
            <h3>Marka &amp; Üretici</h3>
            <p>Ürünlerini ve teknik dosyalarını mimarların önüne koy.</p>
          </a>
          <a class="nm-role" href="/urun">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>
            <h3>Araştırmacı</h3>
            <p>Proje, malzeme ve marka araştırmanı tek yerden yap.</p>
          </a>
        </div>
      </div>
    </section>

    <!-- ÜRETİCİ/MARKA ANLATIMI — solda iddia, sağda ürünün GERÇEKTEN kullanıldığı projeden bir kare.
         Metin ve bağlantılar canlı veriden gelir, elle yazılmış ürün/marka adı yoktur. -->
    <section class="nm-sec nm-band-alt nm-mfg-sec" id="nm-sec-markalar-icin" aria-labelledby="nm-markalar-icin-h">
      <div class="nm-wrap nm-mfg">
        <div class="nm-mfg-text">
          <h2 class="nm-h2" id="nm-markalar-icin-h">Ürününüz vitrinde değil,<br>gerçek projede görünsün.</h2>
          <p class="nm-lead">Mimar bir projeyi incelerken kullandığı ürünü de görür — ve doğrudan sizin marka sayfanıza geçer.</p>
          <ul class="nm-mfg-list" id="nm-mfg-list"></ul>
          <a class="nm-btn nm-btn-ghost" href="/urun-ekle">Ürün Ekle</a>
        </div>
        <div class="nm-mfg-media">
          <!-- Görsel, hotspotShowcase'in İKİNCİ örneğinden gelir (üstteki bölüm birinciyi kullanır)
               ki aynı kare popup'ta iki kez görünmesin. -->
          <div class="nm-tag-stage" id="nm-mfg-stage">
            <img id="nm-mfg-img" alt="" decoding="async">
            <div id="nm-mfg-dots"></div>
          </div>
          <p class="nm-note" id="nm-mfg-caption"></p>
        </div>
      </div>
    </section>

    <!-- FİRMA PROFİLİ ÖNİZLEMESİ — bu bir EKRAN GÖRÜNTÜSÜ DEĞİL: tarayıcı çerçevesinin İÇİ canlı
         veriyle (/api/office/:slug) çizilir, profilde bir şey değişince buraya da yansır. -->
    <section class="nm-sec nm-firm-sec" id="nm-sec-firma-onizleme" aria-labelledby="nm-firma-onizleme-h">
      <div class="nm-wrap nm-firm">
        <div class="nm-firm-text">
          <h2 class="nm-h2" id="nm-firma-onizleme-h">Firmanızın dijital künyesi</h2>
          <ul class="nm-mfg-list">
            <li>Ekip üyelerinizi profile bağlayın</li>
            <li>Projelerinizi künyesiyle yayınlayın</li>
            <li>Kullandığınız markaları projeye iliştirin</li>
            <li>Tek bağlantıyla portföyünüzü paylaşın</li>
          </ul>
        </div>
        <div class="nm-pop" id="nm-firm-frame" aria-label="Firma profili önizlemesi">
          <div class="nm-pop-body" id="nm-firm-body"></div>
        </div>
      </div>
    </section>

    <!-- 3 ADIM + KARŞILAŞTIRMA (kullanıcı isteği, 2026-09-10 on birinci tur madde 3): archiproducts
         business/trade-program deseni ("how it works" + "without / with"). Adımlar görünür olunca
         sırayla yanar (bkz. mountNedenMimarlab#lightSteps). neden-mimarlab.html (sunum modu) ile aynı. -->
    <section class="nm-sec nm-how-sec" id="nm-sec-nasil" aria-labelledby="nm-nasil-h">
      <div class="nm-wrap">
        <h2 class="nm-h2" id="nm-nasil-h">Üç adımda görünür ol</h2>
        <div class="nm-steps" id="nm-steps">
          <div class="nm-step"><span class="nm-step-no" aria-hidden="true">1</span><div class="nm-step-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/><polyline points="7 9 12 4 17 9"/><line x1="12" y1="4" x2="12" y2="16"/></svg></div><h3>Yayınla</h3><p>Projeni, ürününü ya da profilini ekle. Teknik dosyalar (BIM, CAD, katalog) ve versiyonlar tek kayıtta.</p></div>
          <div class="nm-step"><span class="nm-step-no" aria-hidden="true">2</span><div class="nm-step-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8" stroke-dasharray="3 3"/></svg></div><h3>Bağla</h3><p>Fotoğraftaki ürünü işaretle, künyeye mimarı ve markayı yaz — her kayıt diğerine açılır.</p></div>
          <div class="nm-step"><span class="nm-step-no" aria-hidden="true">3</span><div class="nm-step-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 10h8M8 7h5"/></svg></div><h3>Ulaşılabilir ol</h3><p>Profilini sahiplen; mimarlar ve markalar sana doğrudan mesaj gönderir, künyenden bulunursun.</p></div>
        </div>
        <div class="nm-compare" role="table" aria-label="Sahiplenilmemiş ve sahiplenilmiş profil karşılaştırması">
          <div class="nm-compare-row" role="row"><div role="columnheader">&nbsp;</div><div role="columnheader">Sahiplenilmemiş</div><div role="columnheader">MİMARLAB'da sahiplenilmiş</div></div>
          <div class="nm-compare-row" role="row"><div role="cell">Görseller</div><div role="cell"><span class="nm-compare-cell nm-compare-no"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>Bulanık önizleme</span></div><div role="cell"><span class="nm-compare-cell nm-compare-yes"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>Tam çözünürlük, galeri ve büyütme</span></div></div>
          <div class="nm-compare-row" role="row"><div role="cell">Künye</div><div role="cell"><span class="nm-compare-cell nm-compare-no"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>"Doğrulanmamış" ibaresi</span></div><div role="cell"><span class="nm-compare-cell nm-compare-yes"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>Sen düzenlersin, ibare kalkar</span></div></div>
          <div class="nm-compare-row" role="row"><div role="cell">Mesaj</div><div role="cell"><span class="nm-compare-cell nm-compare-no"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>Kapalı</span></div><div role="cell"><span class="nm-compare-cell nm-compare-yes"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>Doğrudan mesaj alırsın</span></div></div>
          <div class="nm-compare-row" role="row"><div role="cell">Ürün ve projeler</div><div role="cell"><span class="nm-compare-cell nm-compare-no"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>Kilitli</span></div><div role="cell"><span class="nm-compare-cell nm-compare-yes"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>Yayında, versiyonlu, dosyalı</span></div></div>
        </div>
        <div class="nm-btn-row" style="margin-top:22px;">
          <a class="nm-btn" href="/kisi" data-ml-event="neden_mimarlab_claim_cta">Profilini bul ve sahiplen</a>
          <a class="nm-btn nm-btn-ghost" href="/urun-ekle">Ürün ekle</a>
        </div>
      </div>
    </section>

    <!-- YAYIN DÖNGÜSÜ — metin yerine tek bir eş merkezli diyagram. -->
    <section class="nm-sec nm-band-alt nm-funnel-sec" id="nm-sec-dongu" aria-labelledby="nm-dongu-h">
      <div class="nm-wrap">
        <h2 class="nm-h2" id="nm-dongu-h">Yayınla, karşılığını al</h2>
        <div class="nm-funnel">
          <div class="nm-ring nm-ring-4"><span>İş bağlantısı</span></div>
          <div class="nm-ring nm-ring-3"><span>Ağ büyür</span></div>
          <div class="nm-ring nm-ring-2"><span>İçerik dağıtılır</span></div>
          <div class="nm-ring nm-ring-1"><span>İçerik yayınla</span></div>
        </div>
      </div>
    </section>

    <!-- MARKA DUVARI — gerçek marka adları /api/offices?brands=1'den. -->
    <section class="nm-sec nm-brands-sec" id="nm-sec-markalar" aria-labelledby="nm-markalar-h">
      <div class="nm-wrap">
        <h2 class="nm-h2" id="nm-markalar-h">Platformdaki markalar</h2>
        <div class="nm-brandwall" id="nm-brandwall"></div>
      </div>
    </section>

    <section class="nm-sec nm-band-alt nm-free-sec" id="nm-sec-ucretsiz" aria-labelledby="nm-ucretsiz-h">
      <div class="nm-wrap">
        <div class="nm-free-card">
          <h2 id="nm-ucretsiz-h">MİMARLAB</h2>
          <p class="nm-free-sub">Yayınla, keşfet, bağlan.</p>
          <div class="nm-free-price">Ücretsiz</div>
          <ul class="nm-free-list">
            <li>Sınırsız proje yayınlama</li>
            <li>Kişi ve firma profili</li>
            <li>Görselde ürün işaretleme</li>
            <li>Ürün kataloğu ve teknik dosyalar</li>
            <li>Koleksiyon panoları ve PDF dışa aktarma</li>
            <li>Markalarla doğrudan bağlantı</li>
          </ul>
          <a class="nm-btn" href="/uye-ol">Ücretsiz Üye Ol</a>
        </div>
      </div>
    </section>

    <!-- Teknik dosyalar — ürün kartları (veritabanından). -->
    <section class="nm-sec nm-band-alt nm-files-sec" id="nm-sec-urunler" aria-labelledby="nm-urunler-h">
      <div class="nm-wrap">
        <h2 class="nm-h2" id="nm-urunler-h">İndirilebilir teknik dosyalar</h2>
        <div class="nm-cards" id="nm-file-showcase"></div>
      </div>
    </section>`;
  }

  // neden-mimarlab.html'in satır içi betiğinin taşınmış hâli. Fonksiyon her renderView'da yeniden
  // çalışır (şablon her seferinde yeniden yazıldığından dinleyiciler de yeniden bağlanmalı) —
  // dışarıya hiçbir durum sızdırmaz, tüm state bu kapanışın içindedir.
  function mountNedenMimarlab(root) {
    // 3 adım bloğu: görünür olunca kartlar 350ms arayla "yanar" (setTimeout — arka planda da biter).
    (function lightSteps() {
      const stepsHost = root.querySelector('#nm-steps');
      if (!stepsHost) return;
      const steps = stepsHost.querySelectorAll('.nm-step');
      let done = false;
      const light = () => { if (done) return; done = true; steps.forEach((el, i) => setTimeout(() => el.classList.add('is-on'), 200 + i * 350)); };
      if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((en) => { en.forEach((e) => { if (e.isIntersecting) { light(); io.disconnect(); } }); }, { rootMargin: '0px 0px -10% 0px' });
        io.observe(stepsHost);
        setTimeout(light, 6000);
      } else light();
    })();
    const fmt = new Intl.NumberFormat('tr-TR');
    const $ = (id) => root.querySelector('#' + id);
    // cdnImg (bkz. image-cdn.js) her sayfada yüklü DEĞİL — orijinal sayfadaki AYNI korumalı çağrı.
    const cdn = (u, w) => (typeof cdnImg === 'function' ? cdnImg(u, w) : u);

    /* ---------- Canlı platform verileri ---------- */
    function renderCounts(counts) {
      Object.keys(counts).forEach((key) => {
        const el = root.querySelector('[data-stat="' + key + '"]');
        if (el) el.textContent = fmt.format(counts[key]);
      });
      const note = $('nm-stats-note');
      if (note) {
        // Sıfır olan alt kırılımlar cümleye hiç girmez — "teknik dosyası yüklü 0 ürün" gibi bir
        // ifade doğru ama sunum bağlamında anlamsız.
        const extra = [];
        if (counts.materials) extra.push('bunların ' + fmt.format(counts.materials) + ' tanesi yapı malzemesi');
        if (counts.productsWithFiles) extra.push(fmt.format(counts.productsWithFiles) + ' ürünün teknik dosyası yüklü');
        note.textContent = 'Bu sayılar platformun canlı veritabanından okunur, her yeni kayıtla güncellenir.'
          + (extra.length ? ' Ürün kataloğunda ' + extra.join('; ') + '.' : '');
      }
      const live = $('nm-network-live');
      if (live) {
        live.textContent = 'Bugün itibarıyla ağda ' + fmt.format(counts.projects) + ' proje, '
          + fmt.format(counts.architects) + ' mimar, ' + fmt.format(counts.offices) + ' firma, '
          + fmt.format(counts.products) + ' ürün ve ' + fmt.format(counts.brands) + ' marka birbirine bağlı.';
      }
    }

    function renderFileShowcase(items) {
      const host = $('nm-file-showcase');
      if (!host) return;
      if (!items || !items.length) { const sec = host.closest('section'); if (sec) sec.remove(); return; }
      host.innerHTML = items.map((p) => {
        const brandLine = p.brandSlug
          ? '<a href="/firma/' + encodeURIComponent(p.brandSlug) + '">' + escapeHtml(p.brand) + '</a>'
          : escapeHtml(p.brand);
        const formats = (p.formats || []).map(f => '<span class="nm-tag-now">' + escapeHtml(f) + '</span>').join(' ');
        return '<a class="nm-card" href="/urun/' + encodeURIComponent(p.slug) + '">'
          + (formats || '')
          + '<h3>' + escapeHtml(p.title) + '</h3>'
          + '<p>' + brandLine + (p.category ? ' · ' + escapeHtml(p.category) : '') + '</p></a>';
      }).join('');
    }

    /* ---------- Görselden ürüne: GERÇEK işaretçilerle ----------
       Veri canlı projelerden gelir; hiçbir koordinat/ürün adı/görsel URL'si elle yazılmaz. İki
       bölüm (üstteki işaretçi gösterimi ve üretici bölümü) AYNI çizim fonksiyonunu kullanır. */
    function renderTagStage(ids, p) {
      const img = $(ids.img);
      const host = $(ids.dots);
      const cap = ids.caption ? $(ids.caption) : null;
      if (!img || !host || !p) return false;
      img.src = cdn(p.image, 1400);
      img.alt = p.title || '';
      host.innerHTML = '';
      if (cap) {
        cap.textContent = (p.title || '') + (p.location ? ' · ' + p.location : '')
          + ' — ' + p.points.length + ' ürün işaretli';
      }
      p.points.forEach((pt, i) => {
        const dot = document.createElement('button');
        dot.type = 'button'; dot.className = 'nm-dot';
        dot.style.left = pt.x + '%'; dot.style.top = pt.y + '%';
        dot.setAttribute('aria-label', (pt.title || 'Ürün') + ' — ürün sayfasına git');
        const card = document.createElement('a');
        card.className = 'nm-tagcard';
        card.href = pt.slug ? '/urun/' + encodeURIComponent(pt.slug) : '#';
        card.style.left = pt.x + '%'; card.style.top = 'calc(' + pt.y + '% + 18px)';
        const safeImg = pt.image ? cdn(pt.image, 160) : '';
        card.innerHTML = (safeImg ? '<img src="' + escapeAttr(safeImg) + '" alt="" loading="lazy" onerror="this.remove()">' : '')
          + '<span><b>' + escapeHtml(pt.title || '') + '</b><span>' + escapeHtml(pt.brand || '') + '</span></span>';
        // Sağ kenara taşacaksa kartı sola çevir — sabit bir eşik yerine gerçek konum ölçülür.
        if (pt.x > 62) card.classList.add('flip');
        function show() {
          host.querySelectorAll('.nm-tagcard.open').forEach(c => { if (c !== card) c.classList.remove('open'); });
          host.querySelectorAll('.nm-dot.is-open').forEach(x => { if (x !== dot) x.classList.remove('is-open'); });
          card.classList.add('open'); dot.classList.add('is-open');
        }
        dot.addEventListener('mouseenter', show);
        dot.addEventListener('focus', show);
        dot.addEventListener('click', (e) => { e.preventDefault(); show(); });
        host.appendChild(dot); host.appendChild(card);
        if (i === 0) show();
      });
      return true;
    }

    let hotspotShowcase = [];
    let hotspotIndex = 0;

    function renderHotspotSections() {
      const tagSec = $('nm-sec-etiket');
      const mfgSec = $('nm-sec-markalar-icin');
      // İşaretçili tek bir proje bile yoksa üst bölüm tamamen kalkar — boş bir kutu bırakmak
      // yanıltıcı olurdu. Üretici bölümü metniyle/CTA'sıyla ayakta kalır, yalnızca görseli gider.
      if (!hotspotShowcase.length) {
        if (tagSec) tagSec.remove();
        ['nm-mfg-stage', 'nm-mfg-caption', 'nm-mfg-list'].forEach(id => { const el = $(id); if (el) el.remove(); });
        return;
      }

      const primary = hotspotShowcase[hotspotIndex % hotspotShowcase.length];
      renderTagStage({ img: 'nm-tag-img', dots: 'nm-tag-dots', caption: 'nm-tag-caption' }, primary);
      const actions = $('nm-tag-actions');
      const link = $('nm-tag-link');
      if (link) link.href = '/proje/' + encodeURIComponent(primary.slug);
      if (actions) {
        actions.hidden = false;
        // Tek örnek varsa "başka bir örnek" butonu anlamsız — gizlenir, "Projeyi Aç" kalır.
        const next = $('nm-tag-next');
        if (next) next.style.display = hotspotShowcase.length > 1 ? '' : 'none';
      }

      if (mfgSec) {
        const secondary = hotspotShowcase[(hotspotIndex + 1) % hotspotShowcase.length];
        renderTagStage({ img: 'nm-mfg-img', dots: 'nm-mfg-dots', caption: 'nm-mfg-caption' }, secondary);
        const list = $('nm-mfg-list');
        if (list) {
          // Elle yazılmış marka adı YOKTUR: bu liste, ürünü GERÇEKTEN bir proje görselinde
          // işaretlenmiş markalardan üretilir.
          const brands = (secondary.brands || []).slice(0, 4);
          if (!brands.length) list.remove();
          else list.innerHTML = brands.map(b => '<li>' + escapeHtml(b) + ' — ürünü bir projede işaretlendi</li>').join('');
        }
      }
    }

    const nextBtn = $('nm-tag-next');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => { hotspotIndex++; renderHotspotSections(); });
    }

    /* ---------- Marka duvarı: gerçek markalar ---------- */
    (function () {
      const host = $('nm-brandwall');
      if (!host) return;
      fetch('/api/offices?brands=1&limit=16', { headers: { Accept: 'application/json' } })
        .then(r => { if (!r.ok) throw new Error('x'); return r.json(); })
        .then(d => {
          const items = (d.items || []).filter(o => o && o.name).slice(0, 16);
          if (!items.length) { const sec = host.closest('section'); if (sec) sec.remove(); return; }
          host.innerHTML = items.map(o => {
            const logo = o.logo
              ? '<img src="' + escapeAttr(cdn(o.logo, 240)) + '" alt="' + escapeAttr(o.name) + '" loading="lazy" onerror="this.parentElement.textContent=this.alt">'
              : escapeHtml(o.name);
            return '<a class="nm-brand" href="/firma/' + encodeURIComponent(o.slug) + '">' + logo + '</a>';
          }).join('');
        })
        .catch(() => { const sec = host.closest('section'); if (sec) sec.remove(); });
    })();

    /* ---------- Firma profili önizlemesi: CANLI (ekran görüntüsü DEĞİL) ----------
       TEK istek yeterli: /api/office/:slug hem item'ı hem founders'ı hem relatedProjects'i döndürür.
       Slug elle yazılmaz, /api/public/platform#officeShowcaseSlug'tan gelir. */
  function loadNmLeaflet() {
    // TEK PAYLAŞILAN LEAFLET YÜKLEYİCİSİ (kullanıcı isteği, 2026-09-06 madde 6): aynı belgede artık
    // proje/kişi/firma/ürün popup'ları birbirinin üstüne açılabiliyor (bkz. js/components/
    // lazy-modals.js#ENTITY_MODULES), dolayısıyla iki farklı modülün haritası AYNI ANDA istenebilir.
    // Her modül KENDİ promise'ini tutsaydı, window.L henüz tanımlı değilken ikisi de birer <script>
    // enjekte edip Leaflet'i iki kez indirip parse ederdi. Promise ve CSS <link> artık belge
    // genelinde paylaşılır; her modülün kendi harita kurulumu (initialization) değişmeden kalır.
    if (window.__mimarlabLeafletPromise) return window.__mimarlabLeafletPromise;
    window.__mimarlabLeafletPromise = new Promise((resolve, reject) => {
      if (window.L) { resolve(window.L); return; }
      if (!document.getElementById('mimarlab-leaflet-css')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.id = 'mimarlab-leaflet-css';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => resolve(window.L);
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return window.__mimarlabLeafletPromise;
  }
    function mountFirmMap(projects) {
      const wrap = $('nm-pop-map');
      if (!wrap) return;
      const pinned = (projects || []).filter(p => p.lat != null && p.lng != null);
      if (!pinned.length) { wrap.remove(); return; }
      let started = false;
      const start = () => {
        if (started) return;
        started = true;
        loadNmLeaflet().then((L) => {
          const map = L.map(wrap, { scrollWheelZoom: false, zoomControl: true, attributionControl: false });
          L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(map);
          L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(map);
          const markers = pinned.map(p => L.marker([p.lat, p.lng]).bindPopup('<a href="/proje/' + encodeURIComponent(p.slug) + '">' + escapeHtml(p.title || '') + '</a>'));
          markers.forEach(m => m.addTo(map));
          if (markers.length === 1) map.setView([pinned[0].lat, pinned[0].lng], 13);
          else map.fitBounds(L.featureGroup(markers).getBounds(), { padding: [24, 24], maxZoom: 14 });
          setTimeout(() => map.invalidateSize(), 200);
        }).catch(() => wrap.remove());
      };
      // IO + ZAMAN AŞIMI YEDEĞİ — js/components/project-modal.js#observeOnce ile AYNI gerekçe:
      // IntersectionObserver bazı bağlamlarda hiç tetiklenmiyor, harita kutusu boş kalıyordu.
      // Buradaki kaydırma kabı modal panelidir (viewport değil), root:null yine de çalışır çünkü
      // eleman görünür alana ancak panel kaydırıldığında girer.
      if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((en) => {
          en.forEach(e => { if (e.isIntersecting) { start(); io.disconnect(); } });
        }, { rootMargin: '200px' });
        io.observe(wrap);
        setTimeout(start, 2500);
      } else { start(); }
    }

    function renderFirmPreview(slug) {
      const sec = $('nm-sec-firma-onizleme');
      if (!sec) return;
      const drop = () => sec.remove();
      if (!slug) return drop();
      fetch('/api/office/' + encodeURIComponent(slug), { headers: { Accept: 'application/json' } })
        .then(r => { if (!r.ok) throw new Error('x'); return r.json(); })
        .then(d => {
          const o = d.item;
          if (!o || !o.name) return drop();
          const founders = (d.founders || []).slice(0, 2);
          const projects = d.relatedProjects || [];
          const img = (u, w) => (u ? escapeAttr(cdn(u, w)) : '');

          const logo = o.logo ? '<img src="' + img(o.logo, 160) + '" alt="" loading="lazy" onerror="this.remove()">' : '';
          const links = (o.website ? ['Websitesi'] : []).concat((o.social_links || []).map((l) => {
            const pl = l.platform || '';
            return pl.charAt(0).toLocaleUpperCase('tr') + pl.slice(1);
          })).filter(Boolean);

          const ICO = {
            cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
            pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
            bag: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
          };
          const svg = (path) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>';
          let facts = '';
          if (o.yil) facts += '<li>' + svg(ICO.cal) + '<span><b>Kuruluş Yılı:</b> ' + escapeHtml(String(o.yil)) + '</span></li>';
          if (o.loc) facts += '<li>' + svg(ICO.pin) + '<span><b>Konum:</b> ' + escapeHtml(o.loc) + '</span></li>';
          const cats = Array.isArray(o.cats) ? o.cats.join(' · ') : (o.cats || '');
          if (cats) facts += '<li>' + svg(ICO.bag) + '<span><b>Hizmet Alanı:</b> ' + escapeHtml(cats) + '</span></li>';

          // /api/office/:slug'un founders kayıtları slug TAŞIMAZ — kart bir bağlantı DEĞİL düz bir
          // kutudur; kırık bir "/kisi/" adresine götüren sahte link koymaktansa tıklanamaz bırakılır.
          const peopleHtml = founders.map(f => '<div class="nm-pop-person">'
            + (f.photo ? '<img src="' + img(f.photo, 240) + '" alt="" loading="lazy" onerror="this.remove()">' : '')
            + '<div><b>' + escapeHtml(f.name || '') + '</b><span>' + escapeHtml(f.role || '') + '</span></div></div>').join('');

          const projHtml = projects.slice(0, 6).map((p) => {
            const first = (p.images && p.images[0]) || '';
            return '<a class="nm-pop-proj" href="/proje/' + encodeURIComponent(p.slug) + '">'
              + (first ? '<img src="' + img(first, 320) + '" alt="" loading="lazy" onerror="this.remove()">' : '')
              + '<span>' + escapeHtml(p.title || '') + '</span></a>';
          }).join('');

          const chrome = '<div class="nm-pop-chrome">'
            + '<span class="nm-pop-cbtn">' + svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>') + '</span>'
            + '<span class="nm-pop-cbtn">' + svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.5" x2="15.4" y2="6.5"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/>') + '</span>'
            + '<span class="nm-pop-follow">Takip Et</span></div>';

          $('nm-firm-body').innerHTML =
            '<div class="nm-pop-left">'
            + chrome
            + '<span class="nm-pop-logo">' + logo + '</span>'
            + '<p class="nm-pop-name">' + escapeHtml(o.name) + '</p>'
            + (links.length ? '<div class="nm-pop-links">' + links.map(t => '<span>' + escapeHtml(t) + '</span>').join('') + '</div>' : '')
            + (facts ? '<ul class="nm-pop-facts">' + facts + '</ul>' : '')
            + (o.about ? '<p class="nm-pop-about">' + escapeHtml(o.about) + '</p>' : '')
            + '<div class="nm-pop-acc"><span>Bu firma sana mı ait?</span><span>+</span></div>'
            + '<div class="nm-pop-acc"><span>Geri Bildirim</span><span>+</span></div>'
            + '</div>'
            + '<div class="nm-pop-right">'
            + (peopleHtml ? '<p class="nm-pop-h">Kurucular / Ortaklar</p><div class="nm-pop-people">' + peopleHtml + '</div>' : '')
            + (peopleHtml && projHtml ? '<div class="nm-pop-sep"></div>' : '')
            + (projHtml ? '<p class="nm-pop-h">Projeler (' + projects.length + ')</p><div class="nm-pop-projects">' + projHtml + '</div>' : '')
            + '<div class="nm-pop-map" id="nm-pop-map"></div>'
            + '</div>';

          mountFirmMap(projects);
        })
        .catch(drop);
    }

    fetch('/api/public/platform', { headers: { Accept: 'application/json' } })
      .then(r => { if (!r.ok) throw new Error('platform'); return r.json(); })
      .then((data) => {
        renderCounts(data.counts || {});
        renderFileShowcase(data.fileShowcase);
        hotspotShowcase = data.hotspotShowcase || [];
        renderHotspotSections();
        renderFirmPreview(data.officeShowcaseSlug);
      })
      .catch(() => {
        const note = $('nm-stats-note');
        if (note) note.textContent = 'Canlı platform verileri şu an yüklenemedi. Sayıları proje, mimar, firma, ürün ve marka sayfalarından görebilirsiniz.';
        const band = $('nm-stats-band');
        if (band) band.remove();
        const files = $('nm-file-showcase');
        if (files) { const sec = files.closest('section'); if (sec) sec.remove(); }
        // Veri hiç gelmediyse işaretçi/firma bölümleri de kendilerini kaldırır — hepsi AYNI uca bağlı.
        renderHotspotSections();
        renderFirmPreview(null);
      });
  }

  // ---------------------------------------------------------------------------------------------
  // Ortak modal-shell state machine — js/components/auth-modal.js#open/swap/close/handlePopState
  // ile AYNI desen (bkz. o dosyanın başındaki yorum).
  // ---------------------------------------------------------------------------------------------
  let currentView = null;
  let openedViaPush = false;
  let pushCountSinceOpen = 0;

  // kullanıcı isteği (2026-08-28): yalnızca Rozet Al/İade Et — İletişim/Hakkında/Gizlilik Politikası/
  // Hizmet Şartları/Çerez Politikası/Kariyer'in HİÇBİRİ değil — tablet/mobilde (≤960px, bkz.
  // site-chrome.js#NavDrawer AYNI kırılma noktası) artık ayrı bir ModalShell popup'ı yerine hamburger
  // çekmecesinin İÇİNDE kayan bir alt sayfa olarak açılır (bkz. js/components/auth-modal.js#
  // isMobileDrawer'daki AYNI mekanizma/gerekçe). Diğer beş görünüm HER genişlikte eskisi gibi
  // ModalShell popup'ında kalmaya devam eder.
  // kullanıcı isteği (2026-09-06 madde 5): "Rozet Al ve İade Et sayfaları da yandan çekmece şeklinde
  // açılsınlar ... tablet ve mobil görünümde aktif olan sistemi masaüstünde de aktif edeceksin."
  // Kırılma noktası (≤960px) kaldırıldı — bu iki görünüm artık HER genişlikte çekmecede açılır.
  // Diğer görünümler (İletişim/Hakkında/Neden MİMARLAB?/politikalar) DEĞİŞMEDİ: uzun, okunası
  // editoryal içerik olduklarından her genişlikte geniş ModalShell popup'ında kalırlar.
  const DRAWER_VIEWS = new Set(['rozet-al', 'iade-et']);
  function isMobileDrawer(view) {
    return DRAWER_VIEWS.has(view) && !!window.NavDrawer;
  }
  function currentHostIsMobile() {
    return !!(window.NavDrawer && window.NavDrawer.isSubpageActive());
  }
  function activateHost(mobile) {
    if (mobile) window.NavDrawer.showSubpage({ onBack: backToMenu, onRequestFullClose: close });
    else ModalShell.open({ triggerEl: null, onRequestClose: close });
  }
  function deactivateHost(mobile) {
    if (mobile) window.NavDrawer.closeDrawer();
    else { ModalShell.close(); unmountSingleColumn(); }
  }

  function renderView(view) {
    ensureStyles();
    const mobile = isMobileDrawer(view);
    let hostEl;
    if (mobile) {
      hostEl = window.NavDrawer.getSubpageBodyEl();
      hostEl.innerHTML = '';
    } else {
      // bkz. js/components/modal-shell.js#claimContent — auth-modal.js#renderView'daki AYNI gerçek
      // bulgu: sahip değiştiyse paneller zaten boşaltılmış/bodyEl temel sınıfa sıfırlanmış olur.
      const panels = ModalShell.claimContent('info');
      panels.bodyEl.classList.add('info-single');
      panels.rightPanelEl.innerHTML = '';
      panels.leftPanelEl.innerHTML = '';
      hostEl = panels.leftPanelEl;
    }
    const wrap = document.createElement('div');
    wrap.id = 'im-panel';
    // .im-nm — Neden MİMARLAB? görünümü diğerlerinden farklı (kenardan kenara renkli bantlar,
    // geniş düzen) bir görsel dile sahip; bodyEl'e eklenen .info-nm ise sol panelin iç boşluğunu
    // sıfırlar (bkz. STYLES).
    if (view === 'neden-mimarlab') wrap.classList.add('im-nm');
    if (!mobile) {
      const panelsForBand = ModalShell.getPanels();
      if (panelsForBand) panelsForBand.bodyEl.classList.toggle('info-nm', view === 'neden-mimarlab');
    }
    hostEl.appendChild(wrap);
    if (view === 'neden-mimarlab') { wrap.innerHTML = nedenMimarlabTemplate(); mountNedenMimarlab(wrap); }
    else if (view === 'rozet-al') { wrap.innerHTML = rozetAlTemplate(); mountRozetAl(); }
    else if (view === 'iade-et') { wrap.innerHTML = iadeEtTemplate(); mountIadeEt(); }
    else if (view === 'iletisim') { wrap.innerHTML = iletisimTemplate(); wireIletisim(); }
    else if (view === 'hakkinda') { wrap.innerHTML = hakkindaTemplate(); wireInPanelAnchors(wrap); }
    else if (view === 'gizlilik-politikasi') { wrap.innerHTML = gizlilikTemplate(); wireInPanelAnchors(wrap); }
    else if (view === 'hizmet-sartlari') { wrap.innerHTML = hizmetTemplate(); wireInPanelAnchors(wrap); }
    else if (view === 'cerez-politikasi') { wrap.innerHTML = cerezTemplate(); wireInPanelAnchors(wrap); }
    else { wrap.innerHTML = kariyerTemplate(); }
    if (mobile) {
      hostEl.scrollTop = 0;
    } else {
      // denetim bulgusu (AUDIT-009): bkz. auth-modal.js#renderView'daki AYNI gerekçe — bu modal da
      // document.title'ı değiştirmiyor, src/index.js#INFO_MODAL_META'daki başlıklarla (- MİMARLAB
      // soneki hariç) tutarlı sabit bir Türkçe etiket haritası.
      const INFO_VIEW_LABELS = {
        'rozet-al': 'Rozet Satın Al', 'iade-et': 'Rozet İadesi Talep Et', 'iletisim': 'İletişim',
        'hakkinda': 'Hakkında', 'gizlilik-politikasi': 'Gizlilik Politikası', 'hizmet-sartlari': 'Hizmet Şartları',
        'cerez-politikasi': 'Çerez Politikası', 'neden-mimarlab': 'Neden MİMARLAB?',
      };
      ModalShell.setLabel(INFO_VIEW_LABELS[view] || 'Kariyer');
      ModalShell.scrollToTop();
    }
  }

  function isOpen() { return currentView !== null; }

  function open(view, { pushHistory = true, triggerEl = null } = {}) {
    currentView = view;
    openedViaPush = pushHistory;
    pushCountSinceOpen = pushHistory ? ModalShell.popupHistoryDepth() + 1 : 0;
    // depth artık TÜR-BAĞIMSIZ sayılır (bkz. ModalShell.popupHistoryDepth) — bu popup başka bir
    // popup'ın üstüne açıldıysa zincir kaldığı yerden devam eder, kapanış tek hamlede popup ÖNCESİ
    // sayfaya döner.
    if (pushHistory) history.pushState({ mimarlabModal: 'info', view, depth: pushCountSinceOpen }, '', VIEW_PATH[view]);
    if (isMobileDrawer(view)) window.NavDrawer.showSubpage({ onBack: backToMenu, onRequestFullClose: close });
    else ModalShell.open({ triggerEl, onRequestClose: close });
    renderView(view);
  }

  function swap(view) {
    if (!isOpen()) return open(view, { pushHistory: true });
    const wasMobile = currentHostIsMobile();
    currentView = view;
    const currentDepth = ModalShell.popupHistoryDepth() || pushCountSinceOpen; // tür-bağımsız, bkz. o fonksiyonun yorumu
    pushCountSinceOpen = currentDepth + 1;
    history.pushState({ mimarlabModal: 'info', view, depth: pushCountSinceOpen }, '', VIEW_PATH[view]);
    const willBeMobile = isMobileDrawer(view);
    if (wasMobile !== willBeMobile) { deactivateHost(wasMobile); activateHost(willBeMobile); }
    renderView(view);
  }

  // .info-single sınıfı (bkz. renderView()) paylaşılan modal-shell bodyEl'e eklenir — proje/mimar/
  // firma/ürün/auth modalları da AYNI bodyEl'i kullandığından (bkz. js/components/auth-modal.js#
  // unmountSingleColumn AYNI gerekçe) kapatırken KALDIRILMAZSA bir sonraki açılan başka bir modalın
  // ızgarasını bozardı.
  function unmountSingleColumn() {
    const panels = ModalShell.getPanels();
    if (panels) panels.bodyEl.classList.remove('info-single', 'info-nm');
  }

  // bkz. js/components/auth-modal.js#backToMenu — BİREBİR aynı gerekçe, yalnızca Rozet Al/İade Et'in
  // mobil çekmece breadcrumb'ından ("‹ Menü") çağrılır.
  function backToMenu() {
    currentView = null;
    if (openedViaPush && pushCountSinceOpen > 0) history.go(-pushCountSinceOpen);
    else history.pushState({}, '', '/');
    if (window.NavDrawer) window.NavDrawer.hideSubpage();
    pushCountSinceOpen = 0;
  }

  function close() {
    const mobile = currentHostIsMobile();
    currentView = null;
    // bkz. js/components/auth-modal.js#close — BİREBİR aynı gerekçe (ModalShell.returnToPreviousPage).
    if (openedViaPush && pushCountSinceOpen > 0) history.go(-pushCountSinceOpen);
    else if (!ModalShell.returnToPreviousPage(pushCountSinceOpen)) history.pushState({}, '', '/');
    deactivateHost(mobile);
    pushCountSinceOpen = 0;
  }

  function handlePopState(view) {
    if (!view) { if (isOpen()) { currentView = null; deactivateHost(currentHostIsMobile()); } return; }
    if (!isOpen()) { openedViaPush = false; open(view, { pushHistory: false }); return; }
    if (history.state && history.state.mimarlabModal && typeof history.state.depth === 'number') {
      pushCountSinceOpen = history.state.depth;
    }
    if (view === currentView) return;
    const wasMobile = currentHostIsMobile();
    currentView = view;
    const willBeMobile = isMobileDrawer(view);
    if (wasMobile !== willBeMobile) { deactivateHost(wasMobile); activateHost(willBeMobile); }
    renderView(view);
  }

  // bkz. js/components/auth-modal.js'in dosya sonundaki AYNI resize dinleyicisi/gerekçe — yalnızca
  // Rozet Al/İade Et için (isMobileDrawer(currentView) diğer beş görünümde her zaman false döner).
  window.addEventListener('resize', () => {
    if (!isOpen() || !window.NavDrawer) return;
    const wasMobile = currentHostIsMobile();
    const willBeMobile = isMobileDrawer(currentView);
    if (wasMobile === willBeMobile) return;
    deactivateHost(wasMobile);
    activateHost(willBeMobile);
    renderView(currentView);
  });

  function pathToView(pathname) {
    const path = pathname.replace(/\/$/, '') || '/';
    for (const key in VIEW_PATH) { if (VIEW_PATH[key] === path) return key; }
    return null;
  }

  // Header/footer'daki MEVCUT bağlantılar (bkz. dosya başı yorumu) — hiçbir sayfanın href'i
  // değiştirilmedi, yalnızca burada delege edilip preventDefault edilir. AuthModal'ınkiyle AYNI
  // desen — iki modül birbirinden habersiz, aynı VIEW_PATH mantığını kendi görünümleri için
  // bağımsızca uygular; ModalShell tek paylaşılan singleton'dur.
  // bkz. js/components/auth-modal.js#hrefToView — BİREBİR aynı kök neden/düzeltme: eşleme yalnızca
  // eski `*.html` biçimini tanıyordu, sitedeki bağlantılar ise kanonik temiz yollara (/rozet-al,
  // /iade-et …) çevrilmişti; eşleşmeyen tıklama TAM SAYFA gidip kullanıcıyı ana sayfaya düşürüyordu.
  function hrefToView(a) {
    const raw = a.getAttribute('href') || '';
    if (!raw || raw.startsWith('#')) return null;
    let path;
    try {
      const u = new URL(raw, document.baseURI);
      if (u.origin !== location.origin) return null; // dış bağlantılara dokunma
      path = u.pathname;
    } catch { return null; }
    const cleanView = pathToView(path);
    if (cleanView) return cleanView;
    for (const key in HREF_VIEW_RE) { if (HREF_VIEW_RE[key].test(path)) return key; }
    return null;
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const view = hrefToView(a);
    if (!view) return;
    e.preventDefault();
    if (isOpen()) swap(view); else open(view, { triggerEl: a });
  });

  window.addEventListener('popstate', () => {
    const view = pathToView(location.pathname);
    if (view) { handlePopState(view); return; }
    if (isOpen()) handlePopState(null);
  });

  // bkz. js/components/auth-modal.js'teki AYNI dinleyici/gerekçe — çekmece (NavDrawer) OverlayManager
  // tarafından kapatıldığında bu modülün `currentView`'i de bırakılır, aksi halde isOpen() ekranda
  // hiçbir şey yokken "açık" der ve geri dönüşte görünüm yeniden açılmaz. history'e DOKUNULMAZ.
  document.addEventListener('mimarlab-navdrawer-closed', () => {
    if (currentView === null) return;
    currentView = null;
    pushCountSinceOpen = 0;
    openedViaPush = false;
  });

  // Doğrudan URL ile açılış (F5/deep-link) — bkz. kullanıcı isteği: "Sayfa yenilendiğinde veya
  // doğrudan URL'ye gidildiğinde modal açık olarak render edilsin".
  const initialView = pathToView(location.pathname);
  if (initialView) open(initialView, { pushHistory: false });

  return { open, swap, close, handlePopState, isOpen };
})();
// bkz. auth-modal.js sonundaki AYNI window.AuthModal notu — lazy-modals.js'in dinamik yüklemesi için.
window.InfoModal = InfoModal;
