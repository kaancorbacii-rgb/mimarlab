// AuthModal — Giriş Yap/Üye Ol/Hesabım'ı giris-yap.html/uye-ol.html/hesabim.html'in kendi
// tasarımını BİREBİR koruyarak (bkz. kullanıcı isteği) js/components/modal-shell.js üzerinde bir
// popup'a dönüştürür — proje/mimar/firma/ürün modallarıyla AYNI open/swap/close/handlePopState
// state machine deseni (bkz. project-modal.js). Üç görünüm ('login'/'signup'/'account') TEK bir
// ModalShell mount'unu paylaşır; modal-shell'in 32/68 sol/sağ ızgarası bu içerik için yanlış şekil
// olduğundan (ortalı bir kart / tam genişlik dashboard) tek sütuna geçilir (bkz. #am-panel altındaki
// .modal-shell-body.am-single kuralı). Bu dosya HER sayfada (bkz. kullanıcı isteği: "Header'daki
// butonlar") modal-shell.js'ten HEMEN sonra <script defer> ile dahil edilir; giriş noktaları
// (nav/footer/auth-nav.js'in ürettiği mevcut href="giris-yap.html"/"uye-ol.html"/"hesabim.html"
// linkleri) HİÇ değiştirilmedi — bunun yerine burada TEK bir delege edilmiş click dinleyicisiyle
// yakalanıp preventDefault edilir (bkz. aşağısı).
const AuthModal = (function () {
  const VIEW_PATH = { login: '/giris', signup: '/uye-ol', account: '/hesabim', activities: '/aktivitelerim', contents: '/iceriklerim', forgot: '/sifremi-unuttum' };
  const HREF_VIEW_RE = { login: /(^|\/)giris-yap\.html$/, signup: /(^|\/)uye-ol\.html$/, account: /(^|\/)hesabim\.html$/, activities: /(^|\/)aktivitelerim\.html$/, contents: /(^|\/)iceriklerim\.html$/, forgot: /(^|\/)sifremi-unuttum\.html$/ };

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s === undefined || s === null ? '' : s; return d.innerHTML; }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  // gerçek bulgu (2026-08-13, bkz. project-meta.js#safeUrl'deki AYNI kök neden): window.location.href
  // yerine document.baseURI — bu modal site genelinde (her sayfada, farklı <base href> bağlamlarında)
  // yükleniyor; "Kaydedilenler" listesindeki item_image D1'de legacy_static kaynaklı çoğu kayıtta
  // başında "/" olmadan saklanıyor (ör. "logos-thumb/eaa.jpg", "miras/dolunay-villa-1.webp" — D1'de
  // doğrulandı, canonical/beklenen format), window.location.href bunu güncel sayfanın path'ine göre
  // yanlış çözüp kırık görsellere yol açıyordu.
  function safeUrl(u) {
    if (!u) return '';
    try {
      const parsed = new URL(u, document.baseURI);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
    } catch {}
    return '';
  }

  // Bu modal site genelinde (image-cdn.js'in YÜKLENMEDİĞİ birçok sayfa dahil — hesabim.html,
  // giris-yap.html, admin.html, *-ekle.html formları vb.) çalışır, cdnImg/cdnSrcset globallerine
  // KOŞULSUZ güvenilemez (denetim bulgusu, 2026-08-14: bu modaldaki avatar/kayıtlı-öğe görselleri
  // önceden hep orijinal çözünürlükte isteniyordu). Yüklüyse (proje.html/mimar.html/firma.html/
  // urun.html/arama.html/index.html) cdnImg'in ham (göreli) path'i beklediği için `rawUrl` kullanılıp
  // küçültülmüş, KÖK-göreli ("/cdn-cgi/...") bir URL döner — <base href> bağlamından bağımsız güvenli.
  // Yüklü DEĞİLSE `resolvedUrl` (çağıranın zaten safeUrl() ile document.baseURI'ye göre çözdüğü
  // MUTLAK URL) döner — ham göreli path'i OLDUĞU GİBİ kullanmak, tam da document.baseURI fix'inin
  // (bkz. yukarıdaki safeUrl yorumu) çözdüğü <base href> hatasını geri getirirdi.
  function avatarImg(rawUrl, size, resolvedUrl) {
    return (typeof cdnImg === 'function') ? cdnImg(rawUrl, size) : resolvedUrl;
  }

  // giris-yap.html/uye-ol.html'in AUTH bölümü (bkz. o dosyalardaki <style> "---------- AUTH
  // ----------" bloğu) + hesabim.html'in DASHBOARD bölümü — BİREBİR kopya, yalnızca her kuralın
  // başına #am-panel eklenerek scope'landı (bkz. dosya başı yorumu — sayfaların KENDİ nav/breadcrumb/
  // footer stilleri zaten host sayfada yüklü olduğundan buraya kopyalanmadı, yalnızca bu üç sayfaya
  // ÖZGÜ kurallar taşındı).
  const STYLES = `
    #am-panel{ font-family:'Inter', sans-serif; color:var(--ink); }
    #am-panel .auth-wrap{max-width:420px; margin:0 auto; padding:8px 4px 24px;}
    #am-panel .auth-eyebrow{font-family:'IBM Plex Mono', monospace; font-size:12px; letter-spacing:0.14em; text-transform:uppercase; color:var(--sage); font-weight:600; margin-bottom:12px; text-align:center;}
    #am-panel .auth-title{font-family:'Inter', sans-serif; font-size:30px; font-weight:700; margin:0 0 8px; text-align:center;}
    #am-panel .auth-sub{color:var(--ink-soft); font-size:14px; margin:0 0 32px; text-align:center;}
    #am-panel .auth-card{background:var(--paper-card); border:1px solid var(--line); border-radius:16px; padding:28px;}
    #am-panel .auth-field{margin-bottom:16px;}
    #am-panel .auth-field label{display:block; font-size:13px; font-weight:600; margin-bottom:6px;}
    #am-panel .auth-field input, #am-panel .auth-field select{width:100%; padding:11px 14px; border-radius:10px; border:1px solid var(--line); background:var(--paper); font-family:inherit; font-size:14px; color:var(--ink);}
    #am-panel .auth-field input:focus-visible, #am-panel .auth-field select:focus-visible{box-shadow:0 0 0 2px var(--brass);}
    #am-panel .auth-field.ac-field{position:relative;}
    #am-panel .ac-suggestions{display:none; position:absolute; top:calc(100% + 4px); left:0; right:0; z-index:25; background:var(--paper-card); border:1px solid var(--line); border-radius:10px; box-shadow:0 12px 28px rgba(27,42,61,0.15); max-height:220px; overflow-y:auto; padding:6px;}
    #am-panel .ac-suggestions.show{display:block;}
    #am-panel .ac-suggestion{padding:8px 10px; border-radius:8px; font-size:13.5px; color:var(--ink); cursor:pointer;}
    #am-panel .ac-suggestion:hover, #am-panel .ac-suggestion.active{background:var(--paper-alt);}
    #am-panel .auth-check{display:flex; align-items:flex-start; gap:9px; margin-bottom:14px; font-size:12.5px; line-height:1.55; color:var(--ink-soft);}
    #am-panel .auth-check input{width:16px; height:16px; margin-top:1px; flex-shrink:0; accent-color:var(--walnut);}
    #am-panel .auth-check a{color:var(--walnut); font-weight:600;}
    #am-panel .kvkk-details{margin-bottom:14px; font-size:12px; color:var(--ink-soft);}
    #am-panel .kvkk-details summary{cursor:pointer; color:var(--walnut); font-weight:600; font-size:12.5px;}
    #am-panel .kvkk-details p{margin:8px 0 0; line-height:1.6;}
    #am-panel .auth-submit{width:100%; background:var(--ink); color:var(--paper-card); border:none; padding:13px; border-radius:100px; font-weight:600; font-size:14.5px; margin-top:6px;}
    #am-panel .auth-submit:hover{background:var(--walnut);}
    #am-panel .auth-switch{text-align:center; font-size:13.5px; color:var(--ink-soft); margin-top:20px;}
    #am-panel .auth-switch a{color:var(--walnut); font-weight:600; cursor:pointer;}
    #am-panel .auth-switch a:hover{text-decoration:underline;}
    #am-panel .auth-forgot{text-align:right; font-size:12.5px; margin:-8px 0 16px;}
    #am-panel .auth-forgot a{color:var(--walnut); font-weight:600;}
    #am-panel .auth-forgot a:hover{text-decoration:underline;}
    #am-panel .auth-notice{display:none; margin-top:16px; padding:13px 16px; border-radius:10px; background:rgba(224,138,62,0.12); border:1px solid var(--accent); color:var(--ink); font-size:12.5px; line-height:1.6;}
    #am-panel .auth-notice.show{display:block;}
    #am-panel .auth-notice.success{background:rgba(62,122,85,0.12); border-color:#3E7A55;}
    #am-panel .auth-oauth{display:flex; flex-direction:column; gap:10px; margin-bottom:20px;}
    #am-panel .auth-oauth-btn{display:flex; align-items:center; justify-content:center; gap:10px; width:100%; padding:11px; border-radius:100px; border:1px solid var(--line); background:var(--paper); font-size:13.5px; font-weight:600; color:var(--ink);}
    #am-panel .auth-oauth-btn:hover{border-color:var(--walnut); background:var(--paper-alt);}
    #am-panel .auth-oauth-btn svg{flex-shrink:0;}
    #am-panel .auth-divider{display:flex; align-items:center; gap:12px; margin:0 0 20px; font-size:11.5px; color:var(--ink-soft); text-transform:uppercase; letter-spacing:0.06em;}
    #am-panel .auth-divider::before, #am-panel .auth-divider::after{content:''; flex:1; height:1px; background:var(--line);}

    #am-panel .dash-wrap{max-width:1080px; margin:0 auto; padding:8px 4px 24px;}
    #am-panel .dash-head{display:flex; align-items:center; gap:18px; margin-bottom:32px; flex-wrap:wrap;}
    #am-panel .dash-avatar{width:64px; height:64px; border-radius:50%; flex-shrink:0; overflow:hidden; background:var(--walnut); color:var(--paper-card); display:flex; align-items:center; justify-content:center; font-family:'IBM Plex Mono', monospace; font-weight:600; font-size:20px;}
    #am-panel .dash-avatar img{width:100%; height:100%; object-fit:cover;}
    #am-panel .dash-head-info{display:flex; align-items:center; justify-content:space-between; gap:18px; flex:1; min-width:0;}
    #am-panel .dash-head h1{font-family:'Inter', sans-serif; font-size:26px; font-weight:700; margin:0 0 4px;}
    #am-panel .dash-head p{color:var(--ink-soft); font-size:13.5px; margin:0;}
    #am-panel .dash-edit-btn{flex-shrink:0; background:none; border:1.5px solid var(--ink); color:var(--ink); padding:10px 20px; border-radius:100px; font-weight:600; font-size:13.5px;}
    #am-panel .dash-edit-btn:hover{background:var(--ink); color:var(--paper-card);}
    /* Profili Düzenle pop-up — hesabim.html#profile-edit-overlay ile BİREBİR aynı desen (bkz. o
       dosya). ModalShell'in KENDİSİ burada kullanılmaz çünkü Hesabım zaten ModalShell'in TEK
       overlay'i İÇİNDE render ediliyor (bkz. ensureStyles/#am-panel) — bağımsız, daha yüksek
       z-index'li (200 > ModalShell'in 150'si) kendi overlay'i onun üstüne biner. */
    #am-panel .profile-edit-overlay{
      display:flex; position:fixed; inset:0; z-index:200; align-items:center; justify-content:center;
      padding:16px; background:rgba(27,42,61,0.42); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
      opacity:0; visibility:hidden; pointer-events:none; transition:opacity .3s ease, visibility 0s linear .3s;
    }
    [data-theme="dark"] #am-panel .profile-edit-overlay{background:rgba(255,255,255,0.16);}
    #am-panel .profile-edit-overlay.open{opacity:1; visibility:visible; pointer-events:auto; transition:opacity .3s ease;}
    #am-panel .profile-edit-overlay .dash-form{
      display:block; position:relative; width:100%; max-width:640px; max-height:88vh; overflow-y:auto;
      margin:0; opacity:0; transform:scale(0.96); transition:opacity .3s ease, transform .3s ease;
    }
    #am-panel .profile-edit-overlay.open .dash-form{opacity:1; transform:scale(1);}
    #am-panel .profile-edit-close{
      position:absolute; top:16px; right:16px; width:36px; height:36px; border-radius:50%; border:none;
      background:var(--paper); color:var(--ink); box-shadow:0 4px 12px rgba(27,42,61,0.18);
      display:flex; align-items:center; justify-content:center; z-index:2;
    }
    #am-panel .profile-edit-close:hover{background:var(--paper-alt);}
    #am-panel .dash-section{background:var(--paper-card); border:1px solid var(--line); border-radius:16px; padding:24px; margin-bottom:20px;}
    #am-panel .dash-row{display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:20px; align-items:start;}
    #am-panel .dash-row .dash-section{margin-bottom:0; min-width:0;}
    #am-panel .dash-section h2{font-family:'Inter', sans-serif; font-size:17px; font-weight:700; margin:0 0 4px;}
    #am-panel .dash-section .section-hint{font-size:12.5px; color:var(--ink-soft); margin:0 0 16px;}
    #am-panel .dash-empty{border:1px dashed var(--line); border-radius:12px; padding:24px; text-align:center; color:var(--ink-soft); font-size:13px; line-height:1.6;}
    #am-panel .dash-empty a{color:var(--walnut); font-weight:600;}
    #am-panel .dash-empty a:hover{text-decoration:underline;}
    #am-panel .profile-fact{display:flex; gap:10px; padding:10px 0; border-bottom:1px solid var(--line-soft); font-size:13px;}
    #am-panel .profile-fact:last-child{border-bottom:none;}
    #am-panel .profile-fact-label{color:var(--ink-soft); flex:0 0 110px;}
    #am-panel .profile-fact-value{font-weight:600;}
    #am-panel .saved-row{display:flex; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid var(--line-soft);}
    #am-panel .saved-row:last-child{border-bottom:none;}
    #am-panel .saved-row-link{display:flex; align-items:center; gap:12px; flex:1; min-width:0;}
    #am-panel .saved-row-link img, #am-panel .saved-row-noimg{width:46px; height:46px; border-radius:8px; object-fit:cover; background:var(--paper-alt); flex-shrink:0;}
    #am-panel .saved-row-title{font-size:13.5px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
    #am-panel .saved-row-meta{font-size:11.5px; color:var(--ink-soft);}
    #am-panel .saved-remove-btn{flex-shrink:0; width:28px; height:28px; border-radius:50%; border:1px solid var(--line); background:var(--paper-card); color:var(--ink-soft); display:flex; align-items:center; justify-content:center; font-size:13px;}
    #am-panel .saved-remove-btn:hover{border-color:#B84C4C; color:#B84C4C;}
    #am-panel .submission-edit-link{font-size:11.5px; font-weight:600; color:var(--walnut);}
    #am-panel .submission-edit-link:hover{text-decoration:underline;}
    #am-panel .notif-row{display:flex; gap:10px; padding:12px 0; border-bottom:1px solid var(--line-soft); cursor:pointer;}
    #am-panel .notif-row:last-child{border-bottom:none;}
    #am-panel .notif-row.unread{background:rgba(224,138,62,0.07); margin:0 -10px; padding:12px 10px; border-radius:10px;}
    #am-panel .notif-dot-col{width:8px; flex-shrink:0; padding-top:5px;}
    #am-panel .notif-dot{display:block; width:8px; height:8px; border-radius:50%; background:var(--accent);}
    #am-panel .notif-title{font-size:13.5px; font-weight:600;}
    #am-panel .notif-body{font-size:12.5px; color:var(--ink-soft); margin-top:2px; line-height:1.5;}
    #am-panel .notif-meta{font-size:11px; color:var(--ink-soft); margin-top:4px;}
    #am-panel .dash-field{margin-bottom:12px;}
    #am-panel .dash-field label{display:block; font-size:12.5px; font-weight:600; margin-bottom:5px;}
    #am-panel .dash-field input{width:100%; padding:10px 12px; border-radius:9px; border:1px solid var(--line); background:var(--paper); font-family:inherit; font-size:13.5px; color:var(--ink);}
    /* mimar-ekle.html#dd-field ile BİREBİR aynı açılır çoklu-seçim widget'ı (bkz. kullanıcı isteği:
       "aynı firma kutucuğu gibi ama birden fazla seçenek seçilebilsin") — yalnızca Ödüller kutusunda
       kullanılır. */
    #am-panel .dd-field{position:relative;}
    #am-panel .dd-btn{width:100%; text-align:left; padding:10px 12px; border-radius:9px; border:1px solid var(--line); background:var(--paper); font-family:inherit; font-size:13.5px; color:var(--ink); display:flex; align-items:center; justify-content:space-between; gap:8px;}
    #am-panel .dd-btn-arrow{flex-shrink:0; opacity:0.5; transition:transform .15s ease;}
    #am-panel .dd-field.open .dd-btn-arrow{transform:rotate(180deg);}
    #am-panel .dd-panel{display:none; flex-direction:column; position:absolute; top:calc(100% + 6px); left:0; right:0; z-index:25; background:var(--paper-card); border:1px solid var(--line); border-radius:12px; box-shadow:0 12px 28px rgba(27,42,61,0.15); padding:8px; max-height:240px;}
    #am-panel .dd-field.open .dd-panel{display:flex;}
    #am-panel .dd-options{overflow-y:auto;}
    #am-panel .dd-option{display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:8px; font-size:13.5px; color:var(--ink); cursor:pointer;}
    #am-panel .dd-option:hover{background:var(--paper-alt);}
    #am-panel .dd-option input{accent-color:var(--ink); width:14px; height:14px; flex-shrink:0;}
    #am-panel .dash-pagination{display:flex; align-items:center; justify-content:center; gap:6px; margin-top:14px; flex-wrap:nowrap; overflow-x:auto; -webkit-overflow-scrolling:touch; scrollbar-width:none;}
    #am-panel .dash-pagination::-webkit-scrollbar{display:none;}
    #am-panel .dash-pagination .page-btn{min-width:32px; height:32px; padding:0 8px; border:1px solid var(--line); background:var(--paper); border-radius:8px; font-size:12.5px; font-weight:600; color:var(--ink-soft);}
    #am-panel .dash-pagination .page-btn:hover{border-color:var(--walnut); color:var(--ink);}
    #am-panel .dash-pagination .page-btn.active{background:var(--ink); color:var(--paper-card); border-color:var(--ink);}
    #am-panel .dash-pagination .page-btn:disabled{opacity:0.4; cursor:not-allowed;}
    #am-panel .dash-pagination .page-btn-arrow{display:flex; align-items:center; justify-content:center; padding:0;}
    #am-panel .dash-pagination .page-ellipsis{color:var(--ink-soft); padding:0 4px;}
    #am-panel .saved-filter{display:flex; flex-wrap:wrap; gap:6px; margin-bottom:14px;}
    #am-panel .saved-filter-btn{padding:6px 13px; border-radius:100px; border:1px solid var(--line); background:var(--paper); font-size:12px; font-weight:600; color:var(--ink-soft);}
    #am-panel .saved-filter-btn.active{background:var(--ink); color:var(--paper-card); border-color:var(--ink);}
    #am-panel .submissions-toolbar-row{display:flex; gap:6px; margin-bottom:10px; overflow-x:auto; -webkit-overflow-scrolling:touch; scrollbar-width:none;}
    #am-panel .submissions-toolbar-row::-webkit-scrollbar{display:none;}
    #am-panel .submissions-filter-btn{flex:0 0 auto; padding:6px 13px; border-radius:100px; border:1px solid var(--line); background:var(--paper); font-size:12px; font-weight:600; color:var(--ink-soft); white-space:nowrap;}
    #am-panel .submissions-filter-btn.active{background:var(--ink); color:var(--paper-card); border-color:var(--ink);}
    #am-panel .submissions-add-link{flex:0 0 auto; padding:6px 2px; border:none; background:none; font-size:12px; font-weight:600; color:var(--walnut); white-space:nowrap; text-decoration:underline; text-underline-offset:3px;}
    #am-panel .submissions-add-link:hover{color:var(--ink);}
    #am-panel .avatar-upload-row{display:flex; align-items:center; gap:14px; margin-bottom:16px;}
    #am-panel .avatar-upload-preview{width:56px; height:56px; border-radius:50%; flex-shrink:0; overflow:hidden; background:var(--walnut); color:var(--paper-card); display:flex; align-items:center; justify-content:center; font-family:'IBM Plex Mono', monospace; font-weight:600; font-size:18px;}
    #am-panel .avatar-upload-preview img{width:100%; height:100%; object-fit:cover;}
    #am-panel .avatar-upload-btn{background:none; border:1.5px solid var(--ink); color:var(--ink); padding:8px 16px; border-radius:100px; font-weight:600; font-size:12.5px;}
    #am-panel .avatar-upload-btn:hover{background:var(--ink); color:var(--paper-card);}
    #am-panel .avatar-upload-hint{font-size:11.5px; color:var(--ink-soft); margin-top:6px;}
    #am-panel .badge-grid{display:grid; grid-template-columns:1fr; gap:10px;}
    #am-panel .badge-card{border:1px solid var(--line-soft); border-radius:12px; padding:14px;}
    #am-panel .badge-card-name{font-weight:600; font-size:13.5px; margin-bottom:2px;}
    #am-panel .badge-card-price{font-family:'IBM Plex Mono', monospace; font-size:12px; color:var(--sage); margin-bottom:10px;}
    #am-panel .badge-buy-btn{display:block; width:100%; text-align:center; background:var(--ink); color:var(--paper-card); border:none; padding:8px; border-radius:100px; font-weight:600; font-size:12px;}
    #am-panel .badge-buy-btn:hover{background:var(--walnut);}
    #am-panel .badge-status-pill{display:inline-block; font-size:10.5px; font-weight:700; text-transform:uppercase; padding:3px 9px; border-radius:100px; flex-shrink:0;}
    #am-panel .my-badge-row{display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 14px; border:1px solid var(--line-soft); border-radius:12px; margin-bottom:8px; font-size:13.5px;}
    #am-panel .my-badge-row:last-child{margin-bottom:0;}
    #am-panel .am-badge-icon{position:relative; cursor:pointer;}
    #am-panel .am-badge-tooltip{position:absolute; bottom:calc(100% + 7px); left:50%; transform:translateX(-50%); background:var(--ink); color:var(--paper-card); font-size:11px; font-weight:600; white-space:nowrap; padding:4px 9px; border-radius:6px; opacity:0; visibility:hidden; pointer-events:none; transition:opacity .15s; z-index:20;}
    #am-panel .am-badge-icon:hover .am-badge-tooltip,
    #am-panel .am-badge-icon.am-badge-tooltip-show .am-badge-tooltip{opacity:1; visibility:visible;}
    @media (max-width:480px){ #am-panel .badge-grid{grid-template-columns:1fr;} }
    /* kullanıcı isteği (2026-08-28): mobilde Profili Düzenle/Aktivitelerim butonları artık sayfaya
       yatayda ortalanıyor (önceki "sol tarafa hizala" isteğinin yerini aldı) — width:100% +
       justify-content:center ile KOŞULSUZ/açık olarak sabitlenir. */
    @media (max-width:720px){
      #am-panel .dash-head-info{flex-direction:column; align-items:flex-start; gap:10px; flex-basis:100%; width:100%;}
      #am-panel .dash-head-actions{width:100%; justify-content:center;}
    }
    @media (max-width:860px){ #am-panel .dash-row{grid-template-columns:1fr; gap:20px;} }

    /* login/signup/hesabim modal-shell'in 32/68 ızgarasına DEĞİL, ortalı kart/tam genişlik dashboard
       biçimine ihtiyaç duyar (bkz. dosya başı yorumu) — yalnızca bu modal açıkken bodyEl'e eklenen
       .am-single sınıfı ızgarayı tek sütuna indirir, tüm içerik leftPanelEl'e mount edilir. */
    .modal-shell-body.am-single{display:block;}
  `;
  function ensureStyles() {
    if (document.getElementById('auth-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'auth-modal-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------------------------------
  // GİRİŞ YAP — giris-yap.html#auth-wrap ile BİREBİR aynı işaretleme/mantık (bkz. o dosya).
  // ---------------------------------------------------------------------------------------------
  function loginTemplate() {
    return `
    <div class="auth-wrap">
      <div class="auth-eyebrow">Hesap</div>
      <h1 class="auth-title">Hoş geldin</h1>
      <p class="auth-sub">Devam etmek için hesabına giriş yap.</p>
      <div class="auth-card">
        <div class="auth-oauth">
          <a class="auth-oauth-btn" href="/api/auth/google/start?next=%2Fhesabim">
            <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46c-.28 1.5-1.13 2.77-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z"/><path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.92l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.94H1.28v3.1C3.25 21.3 7.31 24 12 24Z"/><path fill="#FBBC05" d="M5.29 14.29A7.2 7.2 0 0 1 4.91 12c0-.8.14-1.57.38-2.29v-3.1H1.28A11.98 11.98 0 0 0 0 12c0 1.93.46 3.76 1.28 5.39l4.01-3.1Z"/><path fill="#EA4335" d="M12 4.77c1.76 0 3.34.6 4.59 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.7 1.28 6.61l4.01 3.1C6.23 6.88 8.88 4.77 12 4.77Z"/></svg>
            Google ile Giriş Yap
          </a>
          <a class="auth-oauth-btn" href="/api/auth/linkedin/start?next=%2Fhesabim">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#0A66C2"><path d="M4.98 3.5A2.5 2.5 0 1 0 4.98 8.5 2.5 2.5 0 0 0 4.98 3.5zM3 9.98h4v11.02H3zM10.5 9.98h3.83v1.51h.05c.53-1 1.85-2.06 3.8-2.06 4.06 0 4.82 2.67 4.82 6.14v6.43h-4v-5.7c0-1.36-.02-3.1-1.89-3.1-1.9 0-2.19 1.48-2.19 3v5.8h-4z"/></svg>
            LinkedIn ile Giriş Yap
          </a>
        </div>
        <div class="auth-divider"><span>veya e-posta ile</span></div>
        <form id="am-login-form">
          <div class="auth-field">
            <label for="am-login-email">E-posta</label>
            <input type="email" id="am-login-email" name="email" placeholder="ornek@eposta.com" required>
          </div>
          <div class="auth-field">
            <label for="am-login-password">Şifre</label>
            <input type="password" id="am-login-password" name="password" placeholder="••••••••" required>
          </div>
          <p class="auth-forgot"><a href="sifremi-unuttum.html">Şifremi unuttum</a></p>
          <button class="auth-submit" type="submit">Giriş Yap</button>
          <div class="auth-notice" id="am-login-notice"></div>
        </form>
      </div>
      <p class="auth-switch">Hesabın yok mu? <a id="am-goto-signup">Üye Ol</a></p>
    </div>`;
  }

  // sifremi-unuttum.html'in KENDİ tasarımını birebir koruyarak (bkz. dosya başı yorumu, AYNI
  // gerekçe) popup'a taşır — login/signup ile AYNI desen.
  function forgotTemplate() {
    return `
    <div class="auth-wrap">
      <div class="auth-eyebrow">Hesap</div>
      <h1 class="auth-title">Şifremi Unuttum</h1>
      <p class="auth-sub">E-posta adresini gir, şifre sıfırlama bağlantısını gönderelim.</p>
      <div class="auth-card">
        <form id="am-forgot-form">
          <div class="auth-field">
            <label for="am-forgot-email">E-posta</label>
            <input type="email" id="am-forgot-email" name="email" placeholder="ornek@eposta.com" required>
          </div>
          <button class="auth-submit" type="submit">Sıfırlama Bağlantısı Gönder</button>
          <div class="auth-notice" id="am-forgot-notice"></div>
        </form>
      </div>
      <p class="auth-switch"><a id="am-goto-login-from-forgot">Giriş sayfasına dön</a></p>
    </div>`;
  }

  function wireForgot() {
    document.getElementById('am-goto-login-from-forgot').addEventListener('click', () => swap('login'));
    document.getElementById('am-forgot-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const notice = document.getElementById('am-forgot-notice');
      const submitBtn = e.target.querySelector('.auth-submit');
      submitBtn.disabled = true;
      try {
        const res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: document.getElementById('am-forgot-email').value }),
        });
        const data = await res.json().catch(() => ({}));
        notice.textContent = data.message || 'Bu e-posta ile bir hesap varsa, şifre sıfırlama bağlantısı gönderildi.';
        notice.classList.add('show', 'success');
      } catch (err) {
        notice.textContent = 'Sunucuya ulaşılamadı, lütfen tekrar dene.';
        notice.classList.add('show');
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  function wireLogin() {
    document.getElementById('am-goto-signup').addEventListener('click', () => swap('signup'));
    document.getElementById('am-login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const notice = document.getElementById('am-login-notice');
      const submitBtn = e.target.querySelector('.auth-submit');
      submitBtn.disabled = true;
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: document.getElementById('am-login-email').value,
            password: document.getElementById('am-login-password').value,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          notice.textContent = data.error || 'Bir şeyler ters gitti, tekrar dene.';
          notice.classList.add('show');
          submitBtn.disabled = false;
          return;
        }
        if (typeof refreshAuthNav === 'function') refreshAuthNav();
        // gerçek bulgu (denetim, 2026-08-24): swap('account') KOŞULSUZ çağrılıyordu — istek yavaşken
        // kullanıcı X/Escape ile popup'ı kapatırsa swap()'ın kendi `if (!ModalShell.isOpen()) return
        // open(...)` yolu geç gelen bu başarı yanıtını popup'ı YENİDEN AÇIP Hesabım'a zorlamak için
        // kullanıyordu (beklenmedik bir "kendi kendine açılan" popup); kullanıcı bu arada Üye Ol'a
        // geçtiyse az önce yazmaya başladığı formu da sessizce eziyordu. currentView hâlâ 'login'
        // DEĞİLSE (modal kapatıldı ya da başka bir görünüme geçildi) geç gelen bu başarıyı artık
        // uygulamak YANLIŞ olur — refreshAuthNav() zaten çalıştı (nav avatarı doğru), yalnızca view
        // geçişi atlanır.
        if (currentView === 'login') swap('account');
      } catch {
        notice.textContent = 'Sunucuya ulaşılamadı, lütfen tekrar dene.';
        notice.classList.add('show');
        submitBtn.disabled = false;
      }
    });
  }

  // ---------------------------------------------------------------------------------------------
  // ÜYE OL — uye-ol.html#auth-wrap ile BİREBİR aynı işaretleme/mantık (bkz. o dosya). Okul
  // autocomplete kutusunun id'si mimar-ekle.html'deki #ac-school-suggestions ile ÇAKIŞMASIN diye
  // (bkz. gerçek bulgu: aynı sayfada iki #ac-school-suggestions olması getElementById'i belirsizleştirir)
  // am- önekiyle benzersizleştirildi.
  // ---------------------------------------------------------------------------------------------
  function signupTemplate() {
    return `
    <div class="auth-wrap">
      <div class="auth-eyebrow">Hesap</div>
      <h1 class="auth-title">MİMARLAB'a katıl</h1>
      <p class="auth-sub">Profilini oluşturmak için birkaç bilgi gir.</p>
      <div class="auth-card">
        <div class="auth-oauth">
          <a class="auth-oauth-btn" href="/api/auth/google/start?next=%2Fhesabim">
            <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46c-.28 1.5-1.13 2.77-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z"/><path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.92l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.94H1.28v3.1C3.25 21.3 7.31 24 12 24Z"/><path fill="#FBBC05" d="M5.29 14.29A7.2 7.2 0 0 1 4.91 12c0-.8.14-1.57.38-2.29v-3.1H1.28A11.98 11.98 0 0 0 0 12c0 1.93.46 3.76 1.28 5.39l4.01-3.1Z"/><path fill="#EA4335" d="M12 4.77c1.76 0 3.34.6 4.59 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.7 1.28 6.61l4.01 3.1C6.23 6.88 8.88 4.77 12 4.77Z"/></svg>
            Google ile Kaydol
          </a>
          <a class="auth-oauth-btn" href="/api/auth/linkedin/start?next=%2Fhesabim">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#0A66C2"><path d="M4.98 3.5A2.5 2.5 0 1 0 4.98 8.5 2.5 2.5 0 0 0 4.98 3.5zM3 9.98h4v11.02H3zM10.5 9.98h3.83v1.51h.05c.53-1 1.85-2.06 3.8-2.06 4.06 0 4.82 2.67 4.82 6.14v6.43h-4v-5.7c0-1.36-.02-3.1-1.89-3.1-1.9 0-2.19 1.48-2.19 3v5.8h-4z"/></svg>
            LinkedIn ile Kaydol
          </a>
        </div>
        <div class="auth-divider"><span>veya e-posta ile</span></div>
        <form id="am-signup-form">
          <div class="auth-field">
            <label for="am-signup-name">Ad Soyad *</label>
            <input type="text" id="am-signup-name" name="name" placeholder="Adın Soyadın" required>
          </div>
          <div class="auth-field">
            <label for="am-signup-email">E-posta *</label>
            <input type="email" id="am-signup-email" name="email" placeholder="ornek@eposta.com" required>
          </div>
          <div class="auth-field">
            <label for="am-signup-dob">Doğum Yılı *</label>
            <select id="am-signup-dob" name="dob" required><option value="">Yıl seç</option></select>
          </div>
          <div class="auth-field ac-field" id="am-school-field">
            <label for="am-signup-school">Üniversite</label>
            <input type="text" id="am-signup-school" name="school" placeholder="Örn. Yıldız Teknik Üniversitesi" autocomplete="off">
            <div class="ac-suggestions" id="am-school-suggestions"></div>
          </div>
          <div class="auth-field">
            <label for="am-signup-profession">Meslek</label>
            <select id="am-signup-profession" name="profession">
              <option value="">Seç... (opsiyonel)</option>
              <option value="mimar">Mimar</option>
              <option value="ic_mimar">İç Mimar</option>
              <option value="peyzaj_mimari">Peyzaj Mimarı</option>
              <option value="sehir_plancisi">Şehir Plancısı</option>
              <option value="restorator">Restoratör</option>
              <option value="tasarimci">Tasarımcı</option>
              <option value="ogrenci">Öğrenci</option>
              <option value="diger">Diğer</option>
            </select>
          </div>
          <div class="auth-field">
            <label for="am-signup-password">Şifre *</label>
            <input type="password" id="am-signup-password" name="password" placeholder="••••••••" required>
          </div>
          <div class="auth-field">
            <label for="am-signup-password-confirm">Şifre (Tekrar) *</label>
            <input type="password" id="am-signup-password-confirm" name="password_confirm" placeholder="••••••••" required>
          </div>
          <details class="kvkk-details">
            <summary>KVKK Aydınlatma Metni</summary>
            <p>MİMARLAB olarak, üyelik formunda paylaştığın ad soyad, e-posta, doğum tarihi, okul ve meslek bilgilerini, 6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında yalnızca hesabını oluşturmak, profilini görüntülemek ve platform içi işlemlerini (ilan/proje gönderimi, yorum, kaydetme vb.) yürütmek amacıyla işleriz. Bilgilerin üçüncü taraflarla paylaşılması, yasal zorunluluklar dışında söz konusu değildir. KVKK madde 11 kapsamındaki haklarını (bilgi talep etme, düzeltme, silme vb.) info@mimarlab.com adresinden kullanabilirsin.</p>
          </details>
          <label class="auth-check"><input type="checkbox" id="am-signup-bot" required> Ben bir bot değilim.</label>
          <label class="auth-check"><input type="checkbox" id="am-signup-kvkk" required> KVKK Aydınlatma Metni'ni okudum, kişisel verilerimin işlenmesini kabul ediyorum.</label>
          <button class="auth-submit" type="submit">Üye Ol</button>
          <div class="auth-notice" id="am-signup-notice"></div>
        </form>
      </div>
      <p class="auth-switch">Zaten hesabın var mı? <a id="am-goto-login">Giriş Yap</a></p>
    </div>`;
  }

  function trLower(s) {
    return (s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/Ş/g, 'ş').replace(/Ğ/g, 'ğ').replace(/Ü/g, 'ü').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç').toLowerCase();
  }

  // src/lib/submissionTypes.js#isInvalidSchoolValue ile AYNI kural — kısaltmaları (YTÜ, İTÜ, ODTÜ,
  // MSGSÜ gibi) reddetmek için sunucudakiyle birebir aynı mantık istemci tarafında da tekrarlanır
  // (bkz. kullanıcı isteği: "üniversite isimlerinin kısaltma olmasına izin verme"). Eskiden burada
  // TAM TERSİ bir normalizeSchoolName vardı (İTÜ/YTÜ/ODTÜ'nün açık adını KASITLI OLARAK kısaltmaya
  // ÇEVİRİYORDU) — o davranış kaldırıldı, artık kısaltma HİÇBİR yoldan kaydedilmiyor.
  function isInvalidSchoolValue(v) {
    v = (v || '').trim();
    if (!v) return false;
    if (v.length < 5) return true;
    return !/[a-zçğıöşü]/.test(v);
  }

  function wireSignup() {
    document.getElementById('am-goto-login').addEventListener('click', () => swap('login'));

    const dobSel = document.getElementById('am-signup-dob');
    const currentYear = new Date().getFullYear();
    for (let y = currentYear; y >= 1950; y--) {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = String(y);
      dobSel.appendChild(opt);
    }

    const schoolInput = document.getElementById('am-signup-school');
    const schoolBox = document.getElementById('am-school-suggestions');
    let schoolItems = [];
    fetch('/api/architects/schools').then(r => r.ok ? r.json() : { items: [] }).then(d => { schoolItems = d.items || []; }).catch(() => {});
    function closeSchoolBox() { schoolBox.classList.remove('show'); schoolBox.innerHTML = ''; }
    function renderSchoolBox() {
      const q = trLower(schoolInput.value.trim());
      if (!q) { closeSchoolBox(); return; }
      const matches = schoolItems.filter(it => trLower(it).includes(q)).slice(0, 8);
      if (!matches.length) { closeSchoolBox(); return; }
      schoolBox.innerHTML = matches.map(it => `<div class="ac-suggestion">${escapeHtml(it)}</div>`).join('');
      schoolBox.classList.add('show');
      schoolBox.querySelectorAll('.ac-suggestion').forEach((el, i) => {
        el.addEventListener('mousedown', (e) => { e.preventDefault(); schoolInput.value = matches[i]; closeSchoolBox(); });
      });
    }
    schoolInput.addEventListener('input', renderSchoolBox);
    schoolInput.addEventListener('focus', renderSchoolBox);
    schoolInput.addEventListener('blur', () => setTimeout(closeSchoolBox, 150));

    document.getElementById('am-signup-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const notice = document.getElementById('am-signup-notice');
      const submitBtn = e.target.querySelector('.auth-submit');
      const pw = document.getElementById('am-signup-password').value;
      const pwConfirm = document.getElementById('am-signup-password-confirm').value;
      if (pw !== pwConfirm) { notice.textContent = 'Şifreler eşleşmiyor. Lütfen tekrar dene.'; notice.classList.add('show'); return; }
      if (!document.getElementById('am-signup-bot').checked) { notice.textContent = 'Lütfen "Ben bir bot değilim" kutucuğunu işaretle.'; notice.classList.add('show'); return; }
      if (!document.getElementById('am-signup-kvkk').checked) { notice.textContent = 'Devam etmek için KVKK Aydınlatma Metni\'ni kabul etmelisin.'; notice.classList.add('show'); return; }
      if (isInvalidSchoolValue(schoolInput.value)) { notice.textContent = 'Geçerli bir üniversite adı gir (kısaltma kullanma).'; notice.classList.add('show'); return; }
      const payload = {
        name: document.getElementById('am-signup-name').value,
        dob: document.getElementById('am-signup-dob').value || null,
        school: schoolInput.value || null,
        profession: document.getElementById('am-signup-profession').value || null,
        email: document.getElementById('am-signup-email').value,
        password: pw,
        password_confirm: pwConfirm,
        botCheck: document.getElementById('am-signup-bot').checked,
        kvkkAccepted: document.getElementById('am-signup-kvkk').checked,
      };
      submitBtn.disabled = true;
      try {
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          notice.textContent = data.error || 'Bir şeyler ters gitti, tekrar dene.';
          notice.classList.add('show');
          submitBtn.disabled = false;
          return;
        }
        if (typeof refreshAuthNav === 'function') refreshAuthNav();
        // gerçek bulgu (denetim, 2026-08-24, bkz. wireLogin'deki AYNI kök neden): geç gelen bir
        // başarı yanıtı, kullanıcı bu arada popup'ı kapattıysa/başka bir view'a geçtiyse zorla
        // Hesabım'a geçmesin diye currentView kontrolü.
        if (currentView === 'signup') swap('account');
      } catch {
        notice.textContent = 'Sunucuya ulaşılamadı, lütfen tekrar dene.';
        notice.classList.add('show');
        submitBtn.disabled = false;
      }
    });
  }

  // ---------------------------------------------------------------------------------------------
  // HESABIM — hesabim.html#dash-wrap + onun script'i ile BİREBİR aynı işaretleme/mantık (bkz. o
  // dosya). TEK fark: giriş yapılmamışsa artık ayrı bir sayfaya YÖNLENDİRMEZ, Giriş Yap görünümüne
  // swap eder (bkz. loadUser()); hesap silme sonrası ise hâlâ tam sayfa yönlendirme yapar (geri
  // dönüşü olmayan bir işlem sonrası ana sayfaya taze bir yükleme ile dönmek makul, bkz. kullanıcı
  // isteği: "ana sayfaya ... geri dönsün").
  // ---------------------------------------------------------------------------------------------
  function accountTemplate() {
    return `
    <div class="dash-wrap" id="am-dash-wrap">
      <div id="am-payment-success-banner" style="display:none; background:rgba(62,122,85,0.12); border:1px solid #3E7A55; color:var(--ink); font-size:13px; padding:13px 16px; border-radius:12px; margin-bottom:20px; line-height:1.6;">Ödemen alındı — rozetin aktif edildi.</div>
      <div class="dash-head">
        <div class="dash-avatar" id="am-dash-avatar">–</div>
        <div class="dash-head-info">
          <div>
            <h1 id="am-dash-title">Hoş Geldin</h1>
            <p id="am-dash-sub">—</p>
          </div>
          <div class="dash-head-actions" style="display:flex; align-items:center; gap:10px; flex-shrink:0;">
            <button class="dash-edit-btn" id="am-dash-edit-btn">Profili Düzenle</button>
            <button type="button" class="dash-edit-btn" id="am-dash-activities-btn">Aktivitelerim</button>
          </div>
        </div>
      </div>

      <div class="profile-edit-overlay" id="am-profile-edit-overlay">
      <div class="dash-form" id="am-dash-edit-form" style="background:var(--paper-card); border:1px solid var(--line); border-radius:16px; padding:24px; margin-bottom:20px;">
        <button type="button" class="profile-edit-close" id="am-profile-edit-close" aria-label="Kapat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <h2 style="font-family:'Inter', sans-serif; font-size:17px; font-weight:700; margin:0 0 16px;">Profili Düzenle</h2>
        <div class="avatar-upload-row">
          <div class="avatar-upload-preview" id="am-avatar-preview">–</div>
          <div>
            <button type="button" class="avatar-upload-btn" id="am-avatar-upload-btn">Fotoğraf Yükle</button>
            <input type="file" id="am-avatar-file-input" accept="image/jpeg,image/png,image/webp" style="display:none;">
            <div class="avatar-upload-hint" id="am-avatar-upload-hint">JPEG/PNG/WEBP, otomatik küçültülür (~150KB).</div>
          </div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:14px;">
          <div>
            <label style="display:block; font-size:12.5px; font-weight:600; margin-bottom:5px;">Ad Soyad</label>
            <input type="text" id="am-edit-name" style="width:100%; padding:10px 12px; border-radius:9px; border:1px solid var(--line); background:var(--paper); font-family:inherit; font-size:13.5px;">
          </div>
          <div>
            <label style="display:block; font-size:12.5px; font-weight:600; margin-bottom:5px;">Doğum Yılı</label>
            <select id="am-edit-dob" style="width:100%; padding:10px 12px; border-radius:9px; border:1px solid var(--line); background:var(--paper); font-family:inherit; font-size:13.5px; color:var(--ink);">
              <option value="">Seç... (opsiyonel)</option>
            </select>
          </div>
          <div class="auth-field ac-field" id="am-edit-school-field" style="margin-bottom:0;">
            <label style="display:block; font-size:12.5px; font-weight:600; margin-bottom:5px;">Üniversite</label>
            <input type="text" id="am-edit-school" placeholder="Örn. Yıldız Teknik Üniversitesi" autocomplete="off" style="width:100%; padding:10px 12px; border-radius:9px; border:1px solid var(--line); background:var(--paper); font-family:inherit; font-size:13.5px;">
            <div class="ac-suggestions" id="am-edit-school-suggestions"></div>
          </div>
          <div>
            <label style="display:block; font-size:12.5px; font-weight:600; margin-bottom:5px;">Meslek</label>
            <select id="am-edit-profession" style="width:100%; padding:10px 12px; border-radius:9px; border:1px solid var(--line); background:var(--paper); font-family:inherit; font-size:13.5px; color:var(--ink);">
              <option value="">Seç... (opsiyonel)</option>
              <option value="mimar">Mimar</option>
              <option value="ic_mimar">İç Mimar</option>
              <option value="peyzaj_mimari">Peyzaj Mimarı</option>
              <option value="sehir_plancisi">Şehir Plancısı</option>
              <option value="restorator">Restoratör</option>
              <option value="tasarimci">Tasarımcı</option>
              <option value="ogrenci">Öğrenci</option>
              <option value="diger">Diğer</option>
            </select>
          </div>
          <div>
            <label style="display:block; font-size:12.5px; font-weight:600; margin-bottom:5px;">Pozisyon</label>
            <select id="am-edit-position" style="width:100%; padding:10px 12px; border-radius:9px; border:1px solid var(--line); background:var(--paper); font-family:inherit; font-size:13.5px; color:var(--ink);">
              <option value="">Seç... (opsiyonel)</option>
              <option value="Kurucu">Kurucu</option>
              <option value="Kurucu Ortak">Kurucu Ortak</option>
              <option value="Ortak">Ortak</option>
              <option value="Ekip Lideri">Ekip Lideri</option>
              <option value="Ekip Üyesi">Ekip Üyesi</option>
              <option value="Akademisyen">Akademisyen</option>
              <option value="Serbest Çalışan">Serbest Çalışan</option>
              <option value="Öğrenci">Öğrenci</option>
              <option value="Emekli">Emekli</option>
              <option value="İşsiz">İşsiz</option>
            </select>
          </div>
          <div>
            <label style="display:block; font-size:12.5px; font-weight:600; margin-bottom:5px;">Firma</label>
            <select id="am-edit-office" style="width:100%; padding:10px 12px; border-radius:9px; border:1px solid var(--line); background:var(--paper); font-family:inherit; font-size:13.5px; color:var(--ink);">
              <option value="">Seç... (opsiyonel)</option>
            </select>
          </div>
          <!-- Ödüller/Sosyal Medya/Açıklama — bkz. kullanıcı isteği: "Mimar profiliyle henüz
               eşleşmemiş kullanıcılar da ödül, sosyal medya ve açıklama ekleyebilsinler" — herkes
               için her zaman görünür, users.awards/about/social_links'e yazılır; onaylı bir mimar
               profili sahiplenilmişse AYNI Kaydet'te architect_submissions/architects kaydına da
               senkronize edilir (bkz. submitArchitectSyncIfNeeded). Ödüller kutusu Firma ile AYNI
               kapalı/açılır davranışı verir, mimar-ekle.html#dd-oduller ile BİREBİR aynı widget
               (bkz. wireAmMultiDropdown), ama çoklu seçim destekler. -->
          <div>
            <label style="display:block; font-size:12.5px; font-weight:600; margin-bottom:5px;">Ödül</label>
            <div class="dd-field" id="am-dd-awards">
              <button type="button" class="dd-btn" id="am-dd-awards-btn">
                <span id="am-dd-awards-btn-label">Ödül seç</span>
                <svg class="dd-btn-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <div class="dd-panel"><div class="dd-options" id="am-dd-awards-options"></div></div>
            </div>
          </div>
          <div>
            <label style="display:block; font-size:12.5px; font-weight:600; margin-bottom:5px;">Sosyal Medya</label>
            <div id="am-social-rows" style="display:flex; flex-direction:column; gap:8px; margin-bottom:8px;"></div>
            <button type="button" id="am-add-social-row" style="background:none; border:1px dashed var(--line); color:var(--walnut); border-radius:9px; padding:8px 12px; font-size:12.5px; font-weight:600; width:100%;">+ Sosyal Medya Ekle</button>
          </div>
          <div style="grid-column:1 / -1;">
            <label style="display:block; font-size:12.5px; font-weight:600; margin-bottom:5px;">Açıklama</label>
            <textarea id="am-edit-about" rows="4" style="width:100%; padding:10px 12px; border-radius:9px; border:1px solid var(--line); background:var(--paper); font-family:inherit; font-size:13.5px; color:var(--ink); resize:vertical;"></textarea>
          </div>
        </div>

        <button class="dash-edit-btn" id="am-dash-save-btn" style="margin-left:0; background:var(--ink); color:var(--paper-card);">Kaydet</button>
        <span id="am-dash-save-msg" style="font-size:12.5px; color:var(--ink-soft); margin-left:10px;"></span>

        <div style="border-top:1px solid var(--line); margin:22px 0 18px;"></div>
        <h2 style="font-family:'Inter', sans-serif; font-size:17px; font-weight:700; margin:0 0 16px;">Şifre Değiştir</h2>
        <div class="dash-field">
          <label for="am-pw-current">Mevcut Şifre</label>
          <input type="password" id="am-pw-current" autocomplete="current-password">
        </div>
        <div class="dash-field">
          <label for="am-pw-new">Yeni Şifre</label>
          <input type="password" id="am-pw-new" autocomplete="new-password">
        </div>
        <div class="dash-field">
          <label for="am-pw-new-confirm">Yeni Şifre (Tekrar)</label>
          <input type="password" id="am-pw-new-confirm" autocomplete="new-password">
        </div>
        <button class="dash-edit-btn" id="am-pw-save-btn" style="margin-left:0; background:var(--ink); color:var(--paper-card);">Şifreyi Güncelle</button>
        <span id="am-pw-save-msg" style="font-size:12.5px; color:var(--ink-soft); margin-left:10px;"></span>
        <p style="margin:14px 0 0; font-size:12.5px;"><a href="#" id="am-pw-forgot-link" style="color:var(--walnut); font-weight:600;">Şifremi unuttum</a></p>

        <div style="border-top:1px solid var(--line); margin:22px 0 18px;"></div>
        <h2 style="font-family:'Inter', sans-serif; font-size:17px; font-weight:700; margin:0 0 8px; color:#B3261E;">Hesabımı Sil</h2>
        <p style="margin:0 0 14px; font-size:12.5px; color:var(--ink-soft); max-width:520px;">Hesabını sildiğinde profilin, oturumların, kaydettiklerin ve bildirimlerin kalıcı olarak silinir. Bu işlem geri alınamaz.</p>
        <button type="button" class="dash-edit-btn" id="am-delete-account-btn" style="margin-left:0; background:#B3261E; color:#fff; border-color:#B3261E;">Hesabımı Sil</button>
        <span id="am-delete-account-msg" style="font-size:12.5px; color:#B3261E; margin-left:10px;"></span>
      </div>
      </div>

      <div class="dash-row">
        <div class="dash-section">
          <h2>Profil Bilgileri</h2>
          <div id="am-profile-tab-facts">
            <div class="profile-fact"><span class="profile-fact-label">Ad Soyad</span><span class="profile-fact-value" id="am-fact-name">—</span></div>
            <div class="profile-fact"><span class="profile-fact-label">Doğum Tarihi</span><span class="profile-fact-value" id="am-fact-dob">—</span></div>
            <div class="profile-fact"><span class="profile-fact-label">Üniversite</span><span class="profile-fact-value" id="am-fact-school">—</span></div>
            <div class="profile-fact"><span class="profile-fact-label">Meslek</span><span class="profile-fact-value" id="am-fact-profession">—</span></div>
            <div class="profile-fact"><span class="profile-fact-label">Pozisyon</span><span class="profile-fact-value" id="am-fact-position">—</span></div>
            <div class="profile-fact"><span class="profile-fact-label">Üyelik</span><span class="profile-fact-value" id="am-fact-joined">—</span></div>
          </div>
          <div id="am-claims-mine-list"></div>
        </div>

        <div class="dash-section">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:4px;">
            <h2 style="margin:0;">Bildirimler</h2>
            <div style="display:flex; align-items:center; gap:14px; flex-shrink:0;">
              <button type="button" id="am-notif-read-all-btn" style="background:none; border:none; color:var(--walnut); font-weight:600; font-size:12px; padding:0;">Tümü okundu</button>
              <button type="button" id="am-notif-delete-all-btn" style="background:none; border:none; color:#B84C4C; font-weight:600; font-size:12px; padding:0;">Bildirimleri sil</button>
            </div>
          </div>
          <div id="am-dash-notifications"><div class="dash-empty">Yükleniyor…</div></div>
          <div class="dash-pagination" id="am-notif-pagination"></div>
        </div>
      </div>

      <div class="dash-section">
        <h2>Rozet Ayrıcalıklarından Faydalan</h2>
        <p class="section-hint">Rozetlerin sağladıkları avantajlar farklıdır ve aylık kiralanırlar. Kendin için ayrı, firmaların için ayrı rozet alabilirsin.</p>
        <div id="am-my-badges-list" style="display:none; margin-bottom:16px;"></div>
        <div class="badge-grid" id="am-badge-grid"></div>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------------------------------------
  // AKTİVİTELERİM — Hesabım'dan ayrılmış, yalnızca Kaydettiklerim/Beğendiklerim/Yorumlarım/
  // Paylaştığım İçerikler kutularını taşıyan ikinci bir dashboard görünümü (bkz. kullanıcı isteği:
  // "Hesabım seçeneğinin altına Aktivitelerim seçeneği ekle"). Yükleme/render mantığı (loadSubmissions/
  // loadSaved/loadRated/loadComments) accountTemplate()'in eskiden TEK parçası olan mountAccount()'tan
  // BİREBİR taşındı — accountUser gibi Hesabım'a özgü hiçbir state'e bağımlı değildi.
  // ---------------------------------------------------------------------------------------------
  function activitiesTemplate() {
    return `
    <div class="dash-wrap" id="am-activities-wrap">
      <div class="dash-head">
        <div class="dash-head-info">
          <div>
            <h1>Aktivitelerim</h1>
            <p>Kaydettiklerin, beğendiklerin, yorumların ve paylaştığın içerikler.</p>
          </div>
        </div>
      </div>

      <div class="dash-row">
        <div class="dash-section">
          <h2>Kaydettiklerim</h2>
          <div class="saved-filter" id="am-saved-filter">
            <button type="button" class="saved-filter-btn active" data-filter="">Tümü</button>
            <button type="button" class="saved-filter-btn" data-filter="project">Proje</button>
            <button type="button" class="saved-filter-btn" data-filter="product">Ürün</button>
            <button type="button" class="saved-filter-btn" data-filter="architect">Mimar</button>
            <button type="button" class="saved-filter-btn" data-filter="office">Firma</button>
          </div>
          <div id="am-dash-saved"><div class="dash-empty">Yükleniyor…</div></div>
          <div class="dash-pagination" id="am-saved-pagination"></div>
        </div>

        <div class="dash-section">
          <h2>Beğendiklerim</h2>
          <div class="saved-filter" id="am-rated-filter">
            <button type="button" class="saved-filter-btn active" data-filter="">Tümü</button>
            <button type="button" class="saved-filter-btn" data-filter="project">Proje</button>
            <button type="button" class="saved-filter-btn" data-filter="product">Ürün</button>
          </div>
          <div id="am-dash-rated"><div class="dash-empty">Yükleniyor…</div></div>
          <div class="dash-pagination" id="am-rated-pagination"></div>
        </div>
      </div>

      <div class="dash-row">
        <div class="dash-section">
          <h2>Yorumlarım</h2>
          <div class="saved-filter" id="am-comments-filter">
            <button type="button" class="saved-filter-btn active" data-filter="">Tümü</button>
          </div>
          <div id="am-dash-comments"><div class="dash-empty">Yükleniyor…</div></div>
          <div class="dash-pagination" id="am-comments-pagination"></div>
        </div>

        <div class="dash-section">
          <h2>Düello Analizlerim</h2>
          <div id="am-dash-duel-analysis"><div class="dash-empty">Yükleniyor…</div></div>
          <div class="dash-pagination" id="am-duel-analysis-pagination"></div>
        </div>
      </div>
    </div>`;
  }

  // İçeriklerim — kullanıcının kendi gönderdiği içerikler (bkz. kullanıcı isteği: eskiden
  // Aktivitelerim'in "Paylaştığım İçerikler" kutusuydu, artık avatar menüsünden ayrı bir popup
  // olarak açılıyor) — activitiesTemplate() İLE AYNI .dash-wrap/.dash-section iskeleti, tek bölüm.
  function contentsTemplate() {
    return `
    <div class="dash-wrap" id="am-contents-wrap">
      <div class="dash-head">
        <div class="dash-head-info">
          <div>
            <h1>İçeriklerim</h1>
            <p>Platforma gönderdiğin proje, ürün, mimar ve firma içerikleri.</p>
          </div>
        </div>
      </div>

      <div class="dash-row">
        <div class="dash-section">
          <div class="submissions-toolbar-row">
            <a class="submissions-add-link" href="proje-ekle.html">Proje Ekle</a>
            <a class="submissions-add-link" href="urun-ekle.html">Ürün Ekle</a>
            <a class="submissions-add-link" href="mimar-ekle.html">Mimar Ekle</a>
            <a class="submissions-add-link" href="firma-ekle.html">Firma Ekle</a>
          </div>
          <div class="submissions-toolbar-row" id="am-submissions-filter">
            <button type="button" class="submissions-filter-btn active" data-filter="">Tümü</button>
            <button type="button" class="submissions-filter-btn" data-filter="projects">Proje</button>
            <button type="button" class="submissions-filter-btn" data-filter="products">Ürün</button>
            <button type="button" class="submissions-filter-btn" data-filter="architects">Mimar</button>
            <button type="button" class="submissions-filter-btn" data-filter="offices">Firma</button>
          </div>
          <div id="am-dash-submissions"><div class="dash-empty">Yükleniyor…</div></div>
          <div class="dash-pagination" id="am-submissions-pagination"></div>
        </div>
      </div>
    </div>`;
  }

  const TYPE_LABELS = { offices: 'Ofis', projects: 'Proje', products: 'Ürün', materials: 'Malzeme', architects: 'Mimar', news: 'Haber' };
  const STATUS_LABELS = { pending: 'Beklemede', approved: 'Yayında', rejected: 'Reddedildi', archived: 'Arşivlendi' };
  const STATUS_COLORS = { pending: 'var(--accent)', approved: '#3E7A55', rejected: '#B84C4C', archived: 'var(--ink-soft)' };
  const EDIT_PAGE_BY_TYPE = { offices: 'firma-ekle.html', projects: 'proje-ekle.html', products: 'urun-ekle.html', materials: 'urun-ekle.html', architects: 'mimar-ekle.html', news: 'haber-ekle.html' };
  const SAVED_TYPE_LABELS = { project: 'Proje', product: 'Ürün', material: 'Malzeme', news: 'Haber', job: 'İş İlanı', architect: 'Mimar', office: 'Firma' };
  const PAGE_SIZE_DASH = 10;
  const PROFESSION_LABELS = { mimar: 'Mimar', ic_mimar: 'İç Mimar', peyzaj_mimari: 'Peyzaj Mimarı', sehir_plancisi: 'Şehir Plancısı', restorator: 'Restoratör', tasarimci: 'Tasarımcı', ogrenci: 'Öğrenci', diger: 'Diğer' };
  const CLAIM_TYPE_LABELS = { architect: 'Mimar', office: 'Firma' };
  // ODUL_OPTIONS artık burada tanımlı DEĞİL — awards-shared.js'teki TEK paylaşılan global koptan
  // (mimar-ekle.html/proje-ekle.html ile ortak) geliyor, bu dosyanın <script> etiketinden HEMEN
  // önce her sayfada senkron yüklenir (bkz. o dosyanın başındaki yorum). Buradaki "Mimar Profili"
  // alt bölümünü besler, yalnızca onaylı bir mimar profili sahiplenilmişse görünür (bkz.
  // loadArchitectSyncFields). SOCIAL_PLATFORMS ise mimar-ekle.html#SOCIAL_PLATFORMS ile BİREBİR
  // AYNI kalmaya devam ediyor (henüz ayrı bir paylaşım dosyasına taşınmadı).
  const SOCIAL_PLATFORMS = [
    { value: 'instagram', label: 'Instagram' },
    { value: 'linkedin', label: 'LinkedIn' },
    { value: 'x', label: 'X (Twitter)' },
    { value: 'behance', label: 'Behance' },
    { value: 'youtube', label: 'YouTube' },
    { value: 'website', label: 'Web Sitesi / Diğer' },
  ];
  const CLAIM_STATUS_LABELS_ACCOUNT = { pending: 'İnceleniyor', approved: 'Onaylandı', rejected: 'Reddedildi' };
  const CLAIM_STATUS_COLORS_ACCOUNT = { pending: 'var(--accent)', approved: '#3E7A55', rejected: '#B84C4C' };
  const CLAIM_EDIT_PAGE = { architect: 'mimar-ekle.html', office: 'firma-ekle.html' };
  // bkz. src/routes/submissions.js#OFFICE_EDIT_POSITIONS / js/components/claim-correction-box.js
  // (firma sayfasındaki Düzenle butonu) ile BİREBİR aynı liste — kullanıcı isteği: "Firmayı sadece
  // kurucu, kurucu ortak, ortak ve ekip lideri düzenleyebilir". Hesabım'daki Firma satırı bu kontrolü
  // UYGULAMIYORDU (gerçek bulgu): Ekip Üyesi pozisyonundaki biri firma sayfasından Düzenle'yi hiç
  // GÖRMESE de buradan firma-ekle.html?claim=...'a ulaşabiliyordu — sunucu yine de reddeder ama
  // kullanıcıya önce boş yere doldurabileceği bir form gösterip sonra 403 ile karşılaştırıyordu.
  const OFFICE_EDIT_POSITIONS = new Set(['Kurucu', 'Kurucu Ortak', 'Ortak', 'Ekip Lideri']);
  // officePrice + SELF_DISCOUNT_TRY, src/routes/badges.js#BADGE_PRICES/getBadgePrice ile AYNI
  // kaynaktan kopyalanmıştır (bkz. info-modal.js#mountRozetAl'daki BİREBİR aynı desen) — bu grid
  // yalnızca "Kendim için" fiyatını gösterir, gerçek tutar her zaman satın alma anında sunucuda
  // yeniden hesaplanır. gerçek bulgu (2026-08-14 audit): önceden bu dizi kendi içinde önceden
  // indirimli fiyatları ayrı string olarak tutuyordu, backend fiyatı değişirse burası sessizce
  // yanlış kalıyordu.
  const BADGE_TIERS = [
    { type: 'destekci', label: 'Destekçi', officePrice: 79.90 },
    { type: 'verified', label: 'Doğrulanmış Üye', officePrice: 99.90 },
    { type: 'gold', label: 'Altın Üye', officePrice: 139.90 },
    { type: 'platinum', label: 'Elmas Üye', officePrice: 199.90 },
  ];
  const BADGE_SELF_DISCOUNT_TRY = 60;
  function badgeSelfPrice(tier) { return Math.round((tier.officePrice - BADGE_SELF_DISCOUNT_TRY) * 100) / 100; }
  function formatTRY(n) { return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL'; }
  const BADGE_STATUS_LABELS = { pending: 'İnceleniyor', active: 'Aktif', rejected: 'Reddedildi' };
  const BADGE_STATUS_COLORS = { pending: 'var(--accent)', active: '#3E7A55', rejected: '#B84C4C' };

  // badge-shared.js#badgeIconHtml'in AYNEN kopyası (bkz. hesabim.html#accountBadgeIconHtml'deki AYNI
  // gerekçe — badge-shared.js bu sayfaya YÜKLENMİYOR, kendi initials()/palette gibi globalleriyle
  // çakışabilir) — Ad Soyad/Firma satırlarının yanına aktif rozet ikonu basmak için kullanılır (bkz.
  // kullanıcı isteği). 'destekci' KASITLI OLARAK gösterilmez — bkz. src/lib/badgeAccess.js.
  const ACCOUNT_BADGE_LABELS = { verified: 'Doğrulanmış Üye', gold: 'Altın Üye', platinum: 'Elmas Üye', 'iz-birakan': 'İz Bırakan' };
  const ACCOUNT_BADGE_COLORS = { verified: '#0095F6', gold: '#D4A72C', platinum: '#4FB3D9', 'iz-birakan': '#1B1F24' };
  const ACCOUNT_SEAL_BADGE_SVG = '<path d="M12 2 14.5 5.5 19 5l-.5 4.5L22 12l-3.5 2.5.5 4.5-4.5-.5L12 22l-2.5-3.5-4.5.5.5-4.5L2 12l3.5-2.5L5 5l4.5.5Z"/><path d="M9 12.5l2 2 4-4.5" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
  const ACCOUNT_GEM_BADGE_SVG = '<path d="M4.5 9 8 3.5h8L19.5 9 12 21.5 4.5 9Z"/><path d="M4.5 9h15M8 3.5 12 9m4-5.5L12 9M12 9v12.5" stroke="#fff" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" opacity="0.6"/>';
  function accountBadgeIconHtml(badgeType) {
    if (!badgeType || badgeType === 'destekci') return '';
    const isGem = badgeType === 'platinum';
    const size = 14, width = isGem ? Math.round(size * 1.3) : size;
    const label = ACCOUNT_BADGE_LABELS[badgeType] || badgeType;
    // title yerine tıklama/dokunma ile de açılabilen özel tooltip (bkz. kullanıcı isteği: "tablet
    // ve mobilde dokununca rozetin ismi yazsın") — native title mobilde çalışmadığından am-badge-icon
    // click delegasyonu (bkz. aşağıdaki document click listener) bunu tetikler.
    return `<span class="am-badge-icon" aria-label="${escapeAttr(label)}" style="display:inline-flex; vertical-align:middle; margin-left:6px; flex-shrink:0; color:${ACCOUNT_BADGE_COLORS[badgeType] || 'var(--accent)'}"><svg width="${width}" height="${size}" viewBox="0 0 24 24"${isGem ? ' preserveAspectRatio="none"' : ''} fill="currentColor">${isGem ? ACCOUNT_GEM_BADGE_SVG : ACCOUNT_SEAL_BADGE_SVG}</svg><span class="am-badge-tooltip">${escapeHtml(label)}</span></span>`;
  }
  // amBadgeItems (loadBadges) ve amClaimItems (loadMyClaims) birbirinden bağımsız/paralel yüklenir
  // (bkz. aşağıdaki loadUser().then(...) toplu tetikleme) — Mimar/Firma satırlarındaki rozet ikonu
  // bu yüzden ikisi de kendi fetch'i bittiğinde (hangisi önce biterse) renderClaimsList'i tekrar
  // çağırarak, o ana kadar hazır olan veriyle yeniden çizilir.
  let amBadgeItems = [];
  let amClaimItems = [];
  // /api/public/badges: profil başına TEK, nihai rozeti döndürür (admin_badges satın alınanın
  // yerine geçer, bkz. src/routes/badges.js#computeBadgesPayload) — Mimar/Firma satırındaki rozet
  // ikonu buradan okunur, kendi satın aldığından (amBadgeItems) DEĞİL, böylece site genelindeki
  // görünümle her zaman birebir aynı kalır.
  let amPublicBadges = { architect: {}, office: {} };
  // Ad Soyad satırındaki rozet (bkz. kullanıcı isteği: "Hesabım kısmında Profil Bilgileri
  // kutusunda ismin yanında da rozet gözüksün ... hem ismin yanında hem de mimar profili varsa
  // onun yanında rozet gözüksün"). Kaynak önceliği: kullanıcının onaylı bir Mimar profili varsa
  // o profilde görünen NİHAİ rozet (amPublicBadges — satın alınan + admin_badges override'ını
  // zaten birleştirir, bkz. renderClaimsList#rowBadgeType ile AYNI kaynak, böylece isim satırı ile
  // mimar satırındaki rozet HER ZAMAN birebir aynı kalır); onaylı bir Mimar profili yoksa
  // kullanıcının kendi satın aldığı/kendisine ('self') tanımlı aktif rozete (amBadgeItems) düşülür
  // — aksi halde profili olmayan bir kullanıcının rozeti hiçbir yerde görünmezdi.
  function myEffectiveBadgeType() {
    const architectClaim = amClaimItems.find(c => c.profile_type === 'architect' && c.status === 'approved');
    if (architectClaim) {
      const list = amPublicBadges.architect && amPublicBadges.architect[architectClaim.profile_key];
      if (list && list.length) return list[0];
    }
    const selfBadge = amBadgeItems.find(b => b.target_type === 'self' && b.status === 'active' && b.badge_type !== 'destekci');
    return selfBadge ? selfBadge.badge_type : null;
  }
  function renderAmNameBadge() {
    const nameEl = document.getElementById('am-fact-name');
    if (!nameEl) return;
    const name = accountUser ? (accountUser.name || '—') : '—';
    const badgeType = accountUser ? myEffectiveBadgeType() : null;
    nameEl.innerHTML = `${escapeHtml(name)}${badgeType ? accountBadgeIconHtml(badgeType) : ''}`;
  }

  function dashInitials(name) { return (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase(); }
  // Kutular masaüstünde 2 sütunlu (bkz. .dash-row) olduğundan asıl genişlik window.innerWidth değil
  // KUTUNUN kendisi — bu yüzden sabit bir eşik yerine gerçek konteyner genişliğine göre, taşıyorsa
  // pencere daraltılarak tek satıra sığdırılır (bkz. renderDashPagination).
  function dashPageList(totalPages, currentPage, N) {
    if (totalPages <= N + 2) { const pages = []; for (let p = 1; p <= totalPages; p++) pages.push(p); return pages; }
    const half = Math.floor(N / 2);
    let start = Math.max(2, currentPage - half);
    let end = Math.min(totalPages - 1, currentPage + half);
    if (start === 2) end = Math.min(totalPages - 1, start + N - 1);
    if (end === totalPages - 1) start = Math.max(2, end - N + 1);
    const pages = [1];
    if (start > 2) pages.push('...');
    for (let p = start; p <= end; p++) pages.push(p);
    if (end < totalPages - 1) pages.push('...');
    pages.push(totalPages);
    return pages;
  }
  function dashPaginationHtml(currentPage, totalPages, N) {
    let html = `<button class="page-btn page-btn-arrow" data-nav="prev" aria-label="Önceki" ${currentPage === 1 ? 'disabled' : ''}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg></button>`;
    dashPageList(totalPages, currentPage, N).forEach(p => {
      if (p === '...') html += `<span class="page-ellipsis">…</span>`;
      else html += `<button class="page-btn${p === currentPage ? ' active' : ''}" data-page="${p}">${p}</button>`;
    });
    html += `<button class="page-btn page-btn-arrow" data-nav="next" aria-label="Sonraki" ${currentPage === totalPages ? 'disabled' : ''}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg></button>`;
    return html;
  }
  function renderDashPagination(containerId, currentPage, totalPages, onChange) {
    const el = document.getElementById(containerId);
    if (totalPages <= 1) { el.innerHTML = ''; return; }
    let N = 9;
    el.innerHTML = dashPaginationHtml(currentPage, totalPages, N);
    while (N > 1 && el.scrollWidth > el.clientWidth) {
      N -= 2;
      el.innerHTML = dashPaginationHtml(currentPage, totalPages, Math.max(N, 1));
    }
    el.querySelectorAll('[data-page]').forEach(btn => { btn.addEventListener('click', () => onChange(parseInt(btn.dataset.page))); });
    const prevBtn = el.querySelector('[data-nav="prev"]');
    const nextBtn = el.querySelector('[data-nav="next"]');
    if (prevBtn) prevBtn.addEventListener('click', () => { if (currentPage > 1) onChange(currentPage - 1); });
    if (nextBtn) nextBtn.addEventListener('click', () => { if (currentPage < totalPages) onChange(currentPage + 1); });
  }
  function itemTitle(type, item) { if (type === 'offices') return item.name; if (type === 'architects') return item.name; return item.title; }
  // hesabim.html#itemDetailUrl ile AYNI mantık/gerekçe (bkz. o dosyadaki AYNI yorum) — proje.html/
  // mimar.html/firma.html/urun.html location.pathname'i ayrıştırıp ilgili modalı otomatik açar, bu
  // yüzden yalnızca YAYINDA (approved) gönderiler için (canonical satır var olduğundan) bir link
  // üretilir; anahtar canonicalSync.js'in senkron sırasında GERÇEKTEN yazdığı değerle birebir aynı
  // olmalı (istemci tarafı slugify(name) çakışma soneki alabileceğinden YANLIŞ olurdu).
  function itemDetailUrl(type, item) {
    if (item.status !== 'approved') return null;
    if (type === 'projects') return `/proje/${encodeURIComponent(item.claimed_slug || item.slug)}`;
    if (type === 'offices') return `/firma/${encodeURIComponent(item.claimed_profile_key || ('submission:' + item.id))}`;
    if (type === 'architects') return `/mimar/${encodeURIComponent(item.claimed_profile_key || ('submission:' + item.id))}`;
    // bkz. hesabim.html#itemDetailUrl'deki AYNI 2026-08-17 güncellemesi — ürün/malzeme slug'ı artık
    // isim+marka'dan üretiliyor (src/lib/canonicalSync.js#syncProduct), "m-<id>" DEĞİL; mimar/firma
    // ile AYNI "submission:<id>" işaretine dönülür (src/routes/product.js#findProductByLegacyMarker
    // bunu legacy_key üzerinden çözer).
    if (type === 'products' || type === 'materials') return `/urun/${encodeURIComponent('submission:' + item.id)}`;
    return null;
  }
  function resizeImageFile(file, maxEdge, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > height && width > maxEdge) { height = Math.round(height * (maxEdge / width)); width = maxEdge; }
        else if (height > maxEdge) { width = Math.round(width * (maxEdge / height)); height = maxEdge; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('toBlob failed')), 'image/jpeg', quality);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  // hesabim.html'in "let currentUser" ile AYNI ada sahip olabilecek herhangi bir global (bkz. gerçek
  // bulgu: save-widget.js sayfa genelinde 'let currentUser' tanımlıyor) çakışmasın diye bu modül
  // kapsamına özgü ayrı bir değişken (accountUser) kullanılır.
  let accountUser = null;
  // mountAccount() Hesabım'a her navigasyonda yeniden çalışır (bkz. wired Set'in fonksiyon İÇİNDE
  // olması) — document'e bağlı Escape dinleyicisi bu yüzden `on()` yerine tek seferlik bu bayrakla
  // korunur, aksi halde her ziyarette bir kopya daha eklenip yığılırdı.
  let amProfileEditEscapeWired = false;
  // mountAccount() her navigasyonda yeniden çalıştığından (bkz. yukarıdaki AYNI gerekçe) rozet
  // tooltip tıklama dinleyicisi de bu bayrakla korunmazsa her ziyarette bir kopya daha eklenip
  // yığılır — çift (ya da tek sayıda olmayan) toggle çağrısı tooltip'i açıp kapatmayı bozar.
  let amBadgeTooltipClickWired = false;
  // gerçek bulgu (denetim, 2026-08-24): dropdown-kapatma dinleyicisi (aşağıda) tam olarak AYNI
  // "mountAccount() her navigasyonda yeniden çalışır" sorununu yaşıyordu ama yukarıdaki iki
  // komşusunun (amProfileEditEscapeWired/amBadgeTooltipClickWired) aksine hiç bayrakla korunmamıştı
  // — her Hesabım ziyaretinde document'e bir kalıcı click dinleyicisi daha ekleniyor, hiçbiri asla
  // kaldırılmıyordu (sınırsız birikim, sayfa ömrü boyunca büyüyen bir bellek/performans sızıntısı).
  let amDropdownCloseWired = false;

  function mountAccount() {
    const wired = new Set();
    function on(id, evt, fn) {
      const key = id + ':' + evt;
      if (wired.has(key)) return;
      wired.add(key);
      const el = document.getElementById(id);
      if (el) el.addEventListener(evt, fn);
    }

    function renderAvatar() {
      const img = accountUser.photoUrl ? `<img src="${escapeAttr(avatarImg(accountUser.photoUrl, 128, accountUser.photoUrl))}" alt="">` : '';
      document.getElementById('am-dash-avatar').innerHTML = img || dashInitials(accountUser.name);
      document.getElementById('am-avatar-preview').innerHTML = img || dashInitials(accountUser.name);
    }

    // Üniversite otomatik tamamlama — am-signup-school (bkz. wireSignup) ile BİREBİR aynı desen,
    // Profilini Düzenle'de de canlı öneri sunar (bkz. kullanıcı isteği).
    (function wireAmEditSchoolAutocomplete(){
      const input = document.getElementById('am-edit-school');
      const box = document.getElementById('am-edit-school-suggestions');
      let items = [];
      fetch('/api/architects/schools').then(r => r.ok ? r.json() : { items: [] }).then(d => { items = d.items || []; }).catch(() => {});
      function closeBox() { box.classList.remove('show'); box.innerHTML = ''; }
      function renderBox() {
        const q = trLower(input.value.trim());
        if (!q) { closeBox(); return; }
        const matches = items.filter(it => trLower(it).includes(q)).slice(0, 8);
        if (!matches.length) { closeBox(); return; }
        box.innerHTML = matches.map(it => `<div class="ac-suggestion">${escapeHtml(it)}</div>`).join('');
        box.classList.add('show');
        box.querySelectorAll('.ac-suggestion').forEach((el, i) => {
          el.addEventListener('mousedown', (e) => { e.preventDefault(); input.value = matches[i]; closeBox(); });
        });
      }
      input.addEventListener('input', renderBox);
      input.addEventListener('focus', renderBox);
      input.addEventListener('blur', () => setTimeout(closeBox, 150));
    })();

    async function loadUser() {
      const res = await fetch('/api/auth/me');
      if (!res.ok) { swap('login'); return; }
      const data = await res.json();
      accountUser = data.user;
      renderAvatar();
      document.getElementById('am-dash-title').textContent = 'Hoş Geldin, ' + (accountUser.name || '').split(' ')[0];
      document.getElementById('am-dash-sub').textContent = accountUser.email + ' · MİMARLAB üyesi';
      renderAmNameBadge();
      document.getElementById('am-fact-profession').textContent = PROFESSION_LABELS[accountUser.profession] || accountUser.profession || '—';
      document.getElementById('am-fact-position').textContent = accountUser.position || '—';
      document.getElementById('am-fact-school').textContent = accountUser.school || '—';
      document.getElementById('am-fact-dob').textContent = accountUser.dob ? String(accountUser.dob).slice(0, 4) : '—';
      document.getElementById('am-fact-joined').textContent = new Date(accountUser.createdAt).toLocaleDateString('tr-TR', { year: 'numeric', month: 'long' });
      document.getElementById('am-edit-name').value = accountUser.name || '';
      ensureDobYearOptions();
      document.getElementById('am-edit-dob').value = accountUser.dob ? String(accountUser.dob).slice(0, 4) : '';
      document.getElementById('am-edit-school').value = accountUser.school || '';
      document.getElementById('am-edit-profession').value = accountUser.profession || '';
      document.getElementById('am-edit-position').value = accountUser.position || '';
      ensureAwardsDropdown();
      awardsDropdown.setChecked(accountUser.awards || []);
      document.getElementById('am-edit-about').value = accountUser.about || '';
      document.getElementById('am-social-rows').innerHTML = '';
      (accountUser.social_links || []).forEach(s => addAmSocialRow(s.platform, s.url));
      await loadFirmaOptions();
      await prefillFirmaSelect();
    }

    // Doğum Yılı artık bir açılır liste (bkz. kullanıcı isteği) — yıl aralığı önceki number
    // input'un min/max'ıyla AYNI (1900 — bugünün yılı), en yeni yıl en üstte. Bir kere üretilip
    // eklenir, her loadUser()'da yeniden kurulmaz.
    let dobOptionsReady = false;
    function ensureDobYearOptions() {
      if (dobOptionsReady) return;
      dobOptionsReady = true;
      const select = document.getElementById('am-edit-dob');
      const currentYear = new Date().getFullYear();
      let html = '';
      for (let y = currentYear; y >= 1900; y--) html += `<option value="${y}">${y}</option>`;
      select.insertAdjacentHTML('beforeend', html);
    }

    // Firma kutusu (Pozisyon'un yanında) — açılır liste TÜM firmaları listeler (bkz. kullanıcı
    // isteği: "açılır menü ile tüm firmaları görüp istediği firmayı seçebilsin"), ama seçim artık
    // doğrudan profile yazılmıyor: "Bu firma sana mı ait?" kutusuyla (js/components/
    // claim-correction-box.js) AYNI profile_claims('office') talebini (POST /api/claims) oluşturur
    // ve admin onayı bekler (bkz. src/routes/admin.js#handleClaimsAdmin, admin.html "Profil
    // Talepleri"). Onaylanınca CANLI olarak Profil Bilgileri kutusundaki Mimar satırının ÜSTÜNDEki
    // "Firma" satırında görünür (bkz. loadMyClaims). /api/offices sayfalı döndüğünden (en fazla
    // 96/sayfa) tüm firmaları toplamak için totalPages'e kadar döngüyle çekilir; sonuç bu modülün
    // ömrü boyunca önbelleklenir (allOfficeNamesPromise) — modal her açıldığında/loadUser her
    // çalıştığında yeniden istek atılmaz.
    let allOfficeNamesPromise = null;
    async function fetchAllOfficeNames() {
      const names = [];
      let page = 1, totalPages = 1;
      do {
        const res = await fetch(`/api/offices?page=${page}&limit=96&sort=name_asc`);
        if (!res.ok) break;
        const data = await res.json();
        (data.items || []).forEach(o => { if (o.name) names.push(o.name); });
        totalPages = data.totalPages || 1;
        page += 1;
      } while (page <= totalPages);
      return names;
    }
    async function loadFirmaOptions() {
      const select = document.getElementById('am-edit-office');
      if (!allOfficeNamesPromise) allOfficeNamesPromise = fetchAllOfficeNames().catch(() => []);
      const names = await allOfficeNamesPromise;
      select.innerHTML = '<option value="">Seç... (opsiyonel)</option>' + names.map(n => `<option value="${escapeAttr(n)}">${escapeHtml(n)}</option>`).join('');
    }
    // Kutunun başlangıç değeri, kullanıcının hâlihazırda onaylı ya da beklemede bir ofis talebi
    // varsa onu yansıtır — böylece kaydet'e tekrar basmak (seçim değiştirilmeden) createClaim'in
    // no-op dallarına düşer (bkz. src/routes/claims.js — approved/pending için ikinci bir POST hiçbir
    // şey yazmaz), yalnızca GERÇEKTEN farklı bir firma seçilirse yeni bir talep oluşur.
    async function prefillFirmaSelect() {
      const select = document.getElementById('am-edit-office');
      try {
        const claimsRes = await fetch('/api/claims/mine');
        const claims = claimsRes.ok ? (await claimsRes.json()).items || [] : [];
        const officeClaim = claims.find(c => c.profile_type === 'office' && c.status === 'approved')
          || claims.find(c => c.profile_type === 'office' && c.status === 'pending');
        select.value = officeClaim ? officeClaim.profile_key : '';
      } catch {}
    }

    // Ödüller kutusu — mimar-ekle.html#wireMultiDropdown ile BİREBİR aynı desen: kapalı bir düğme
    // (seçili sayıyı/tek seçimi gösterir), tıklanınca checkbox'lı bir panel açılır. Bir kere kurulur
    // (ensureAwardsDropdown), her loadUser()'da yalnızca setChecked çağrılır.
    let awardsDropdown = null;
    function closeAllAmDropdowns() {
      document.querySelectorAll('#am-panel .dd-field.open').forEach(f => f.classList.remove('open'));
    }
    function ensureAwardsDropdown() {
      if (awardsDropdown) return;
      const field = document.getElementById('am-dd-awards');
      const btn = document.getElementById('am-dd-awards-btn');
      const label = document.getElementById('am-dd-awards-btn-label');
      const container = document.getElementById('am-dd-awards-options');
      container.innerHTML = ODUL_OPTIONS.map(o => `<label class="dd-option"><input type="checkbox" value="${escapeAttr(o)}"> ${escapeHtml(o)}</label>`).join('');
      function updateLabel() {
        const checked = Array.from(field.querySelectorAll('input:checked')).map(i => i.value);
        label.textContent = checked.length ? (checked.length === 1 ? checked[0] : `${checked.length} seçili`) : 'Ödül seç';
      }
      btn.addEventListener('click', () => {
        const willOpen = !field.classList.contains('open');
        closeAllAmDropdowns();
        if (willOpen) field.classList.add('open');
      });
      field.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', updateLabel));
      awardsDropdown = {
        getChecked: () => Array.from(field.querySelectorAll('input:checked')).map(i => i.value),
        setChecked(vals) { field.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = (vals || []).includes(cb.value)); updateLabel(); },
      };
    }
    if (!amDropdownCloseWired) {
      amDropdownCloseWired = true;
      document.addEventListener('click', (e) => {
        document.querySelectorAll('#am-panel .dd-field.open').forEach(f => { if (!f.contains(e.target)) f.classList.remove('open'); });
      });
      // gerçek bulgu: bu dropdown'un (ör. Ödüller çoklu-seçim) kendi Escape kapanışı yoktu —
      // ModalShell'in paylaşılan document keydown dinleyicisi (bkz. modal-shell.js#onKeydown, bubble
      // fazında bağlı) Escape'i ele geçirip TÜM Hesabım modalını kapatıyordu. Capture fazında (üçüncü
      // argüman=true) bağlanan bu dinleyici — gallery.js'in lightbox'ı için kullanılan AYNI desen —
      // yalnızca açık bir dropdown varken devreye girer ve stopPropagation ile modal-shell'in
      // bubble'daki dinleyicisine hiç ulaşılmasını engeller.
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const open = document.querySelector('#am-panel .dd-field.open');
        if (!open) return;
        e.stopPropagation();
        closeAllAmDropdowns();
      }, true);
    }

    // Rozet ikonları :hover ile masaüstünde tooltip'i zaten CSS'ten gösterir; dokunmatik cihazlarda
    // hover olmadığından tıklama/dokunma ile açıp kapatmak için delegasyon (bkz. kullanıcı isteği:
    // "tablet ve mobilde dokununca rozetin ismi yazsın").
    if (!amBadgeTooltipClickWired) {
      amBadgeTooltipClickWired = true;
      document.addEventListener('click', (e) => {
        const icon = e.target.closest('#am-panel .am-badge-icon');
        document.querySelectorAll('#am-panel .am-badge-icon.am-badge-tooltip-show').forEach(el => { if (el !== icon) el.classList.remove('am-badge-tooltip-show'); });
        if (icon) icon.classList.toggle('am-badge-tooltip-show');
      });
    }

    // Onaylı bir mimar profili sahiplenilmişse yukarıdaki TÜM alanlar (Ad Soyad/Doğum Yılı/Üniversite/
    // Meslek/Pozisyon/Ödüller/Açıklama/Sosyal Medya) AYNI Kaydet'te architect_submissions/architects
    // kaydına da yazılır (bkz. submitArchitectSyncIfNeeded, mimar-ekle.html?claim= ile TAM AYNI uç
    // noktalar). architectSyncState null'sa (henüz bir mimar profiliyle eşleşilmemişse) bu alanlar
    // yine de görünür ve users tablosuna kaydedilir (bkz. kullanıcı isteği: "Mimar profiliyle henüz
    // eşleşmemiş kullanıcılar da ödül, sosyal medya ve açıklama ekleyebilsinler") — yalnızca ikinci,
    // paralel yazma adımı atlanır. office/photo_url mevcut mimar kaydından olduğu gibi korunur — bu
    // formda düzenlenmiyorlar, bu yüzden burada sıfırlanmamaları için saklanırlar.
    let architectSyncState = null;
    function addAmSocialRow(platform, url) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; gap:8px; align-items:center;';
      row.innerHTML = `
        <select class="am-social-platform" style="flex:0 0 130px; padding:8px 10px; border-radius:9px; border:1px solid var(--line); background:var(--paper); font-family:inherit; font-size:12.5px; color:var(--ink);">${SOCIAL_PLATFORMS.map(p => `<option value="${p.value}"${p.value === platform ? ' selected' : ''}>${p.label}</option>`).join('')}</select>
        <input type="url" class="am-social-url" placeholder="https://..." value="${escapeAttr(url || '')}" style="flex:1; min-width:0; padding:8px 10px; border-radius:9px; border:1px solid var(--line); background:var(--paper); font-family:inherit; font-size:12.5px; color:var(--ink);">
        <button type="button" class="am-social-remove-btn" aria-label="Kaldır" style="flex:0 0 auto; width:28px; height:28px; border-radius:50%; border:1px solid var(--line); background:var(--paper-card); color:var(--ink-soft);">✕</button>
      `;
      row.querySelector('.am-social-remove-btn').addEventListener('click', () => row.remove());
      document.getElementById('am-social-rows').appendChild(row);
    }
    function collectAmSocialLinks() {
      return Array.from(document.querySelectorAll('#am-social-rows > div')).map(row => ({
        platform: row.querySelector('.am-social-platform').value,
        url: row.querySelector('.am-social-url').value.trim(),
      })).filter(s => s.url);
    }
    on('am-add-social-row', 'click', () => addAmSocialRow());

    // mimar-ekle.html#prefillForClaim ile AYNI iki aşamalı kaynak: önce canonical (/api/architect/:key,
    // `item.role`/`item.photo` alan adlarıyla), sonra varsa kullanıcının kendi architect_submissions
    // satırı (/api/architects/mine, claimed_profile_key eşleşmesiyle) ÜZERİNE yazılır — böylece
    // kullanıcı daha önce mimar-ekle.html'den bir taslak kaydettiyse o taslak esas alınır.
    async function fetchArchitectRecordForSync(profileKey) {
      let merged = { name: '', dob: '', school: '', profession: '', position: '', office: '', awards: [], about: '', social_links: [], photo_url: '' };
      try {
        const res = await fetch(`/api/architect/${encodeURIComponent(profileKey)}`);
        if (res.ok) {
          const data = await res.json();
          const item = data.item;
          if (item && item.name === profileKey) {
            merged = {
              name: item.name || '', dob: item.dob || '', school: item.school || '',
              profession: item.profession || '', position: item.role || '', office: item.office || '',
              awards: item.awards || [], about: item.about || '', social_links: item.social_links || [],
              photo_url: item.photo || '',
            };
          }
        }
      } catch {}
      let editId = null;
      try {
        const mineRes = await fetch('/api/architects/mine');
        if (mineRes.ok) {
          const mineData = await mineRes.json();
          // /api/architects/mine created_at DESC sıralı döner ve owner_user_id'nin BİRDEN FAZLA
          // architect_submissions satırı olabilir — ilk eşleşeni (en SON OLUŞTURULAN) almak yerine
          // updated_at'i EN YENİ olanı seçilir (bkz. mimar-ekle.html#prefillForClaim'deki AYNI
          // gerçek bulgu: Profilini Düzenle'de eklenen sosyal medya linkleri mimar-ekle.html'de
          // görünmüyordu — bu editId, o iki taslaktan biri diğerinden GÜNCEL olsa bile ilk (en eski
          // oluşturulan) eşleşeni bulup ona yazıyordu).
          const claimMatches = (mineData.items || []).filter(m => m.claimed_profile_key === profileKey);
          const mine = claimMatches.length ? claimMatches.reduce((a, b) => (b.updated_at > a.updated_at ? b : a)) : null;
          if (mine) {
            editId = mine.id;
            merged = {
              name: mine.name || '', dob: mine.dob || '', school: mine.school || '',
              profession: mine.profession || '', position: mine.position || '', office: mine.office || '',
              awards: mine.awards || [], about: mine.about || '', social_links: mine.social_links || [],
              photo_url: mine.photo_url || '',
            };
          }
        }
      } catch {}
      return { merged, editId };
    }
    // Alanların GÖRÜNÜRLÜĞÜNÜ artık etkilemez (her zaman görünürler) — yalnızca varsa architectSyncState'i
    // (editId/office/photoUrl) kurar ki Kaydet'te submitArchitectSyncIfNeeded doğru uca yazsın.
    async function refreshArchitectSyncState(claimItems) {
      const claim = claimItems.find(c => c.profile_type === 'architect' && c.status === 'approved');
      if (!claim) { architectSyncState = null; return; }
      const { merged, editId } = await fetchArchitectRecordForSync(claim.profile_key);
      architectSyncState = { profileKey: claim.profile_key, editId, office: merged.office, photoUrl: merged.photo_url };
    }

    // Profili Düzenle artık ayrı bir pop-up (bkz. hesabim.html#openProfileEditPopup ile AYNI desen) —
    // TEK fark: bu görünüm zaten ModalShell'in overlay'i İÇİNDE render edildiğinden gövde kaydırması
    // ZATEN kilitli (bkz. ModalShell#lockBodyScroll), burada ikinci kez kilitlenmez.
    function openAmProfileEditPopup() {
      document.getElementById('am-profile-edit-overlay').classList.add('open');
      document.getElementById('am-profile-edit-close').focus();
    }
    function closeAmProfileEditPopup() {
      document.getElementById('am-profile-edit-overlay').classList.remove('open');
    }
    on('am-dash-edit-btn', 'click', openAmProfileEditPopup);
    on('am-profile-edit-close', 'click', closeAmProfileEditPopup);
    on('am-profile-edit-overlay', 'click', (e) => {
      if (e.target.id === 'am-profile-edit-overlay') closeAmProfileEditPopup();
    });
    // Yakalama (capture) aşamasında dinlenir — ModalShell'in KENDİ Escape dinleyicisi (bkz.
    // modal-shell.js#onKeydown) balonlama aşamasında `document`e bağlı ve tetiklendiğinde TÜM
    // Hesabım pop-up'ını kapatır; bu iç pop-up açıkken Escape'in ÖNCE buraya gelip olayı durdurması
    // (stopPropagation) gerekir, aksi halde bir Escape basışı ikisini BİRDEN kapatırdı.
    if (!amProfileEditEscapeWired) {
      amProfileEditEscapeWired = true;
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!document.getElementById('am-profile-edit-overlay')?.classList.contains('open')) return;
        e.stopPropagation();
        closeAmProfileEditPopup();
      }, true);
      // gerçek bulgu (denetim, 2026-08-24): bu iç pop-up'ın kendi focus trap'i YOKTU —
      // ModalShell'in paylaşılan trap'i (bkz. modal-shell.js#getFocusable/onKeydown) TÜM panelEl'i
      // tarar ve `offsetParent !== null` dışında hiçbir filtre uygulamaz; arkadaki Hesabım
      // dashboard'u bu pop-up açıkken hâlâ normal DOM akışında (yalnızca görsel olarak bulanık
      // arkaplanın ALTINDA) durduğundan, klavye kullanıcısı bu formun son alanından Tab'e devam
      // ederse görünmeyen ama "focusable" arkaplan kontrollerine geçip fareyle asla erişemeyeceği bir
      // alana sürüklenebiliyordu. Escape ile AYNI capture deseni: bu pop-up açıkken Tab, ModalShell'in
      // trap'ine hiç ulaşmadan burada durdurulup yalnızca #am-profile-edit-overlay içinde döngüye sokulur.
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const overlay = document.getElementById('am-profile-edit-overlay');
        if (!overlay || !overlay.classList.contains('open')) return;
        const focusable = Array.from(overlay.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter(el => el.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); e.stopPropagation(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); e.stopPropagation(); first.focus(); }
        else if (!overlay.contains(document.activeElement)) { e.preventDefault(); e.stopPropagation(); first.focus(); }
      }, true);
    }

    on('am-dash-activities-btn', 'click', () => swap('activities'));

    // Firma seçimi ("Bu firma sana mı ait?" ile AYNI profile_claims('office') talebi) yalnızca
    // seçim GERÇEKTEN kullanıcının mevcut onaylı/beklemedeki talebinden farklıysa gönderilir —
    // aksi halde her Kaydet'te aynı isim için gereksiz bir POST atılır (zararsız no-op olsa da).
    async function submitFirmaClaimIfChanged() {
      const selected = document.getElementById('am-edit-office').value;
      if (!selected) return false;
      try {
        const claimsRes = await fetch('/api/claims/mine');
        const claims = claimsRes.ok ? (await claimsRes.json()).items || [] : [];
        const existing = claims.find(c => c.profile_type === 'office' && c.profile_key === selected);
        if (existing && (existing.status === 'approved' || existing.status === 'pending')) return false;
        await fetch('/api/claims', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileType: 'office', profileKey: selected }),
        });
        return true;
      } catch { return false; }
    }

    // Onaylı bir mimar profili sahiplenilmişse "Mimar Profili" alt bölümündeki alanlar AYNI Kaydet
    // tıklamasıyla architect_submissions/architects kaydına da yazılır — mimar-ekle.html?claim='in
    // kullandığı UÇLARLA (createSubmission/updateOwnSubmission) BİREBİR aynı, bu yüzden ikisi de
    // gerçekten TEK bir veri kaynağını düzenlemiş olur (bkz. kullanıcı isteği: "tam bir
    // senkronizasyon"). office/photo_url bu formda düzenlenmediğinden fetchArchitectRecordForSync'in
    // getirdiği son bilinen değerleriyle olduğu gibi geri gönderilir, sıfırlanmazlar.
    async function submitArchitectSyncIfNeeded(name, dob, school, professionSlug, position, awards, about, socialLinks) {
      if (!architectSyncState) return;
      const payload = {
        name, dob: dob || null, school: school || null,
        profession: PROFESSION_LABELS[professionSlug] || professionSlug || null,
        office: architectSyncState.office || null,
        position: position || null,
        awards,
        photo_url: architectSyncState.photoUrl || null,
        about: about || null,
        social_links: socialLinks,
      };
      if (!architectSyncState.editId) payload.claimed_profile_key = architectSyncState.profileKey;
      try {
        const res = await fetch(architectSyncState.editId ? `/api/architects/${encodeURIComponent(architectSyncState.editId)}` : '/api/architects', {
          method: architectSyncState.editId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.id) architectSyncState.editId = data.id;
        }
      } catch {}
    }

    // gerçek bulgu (denetim, 2026-08-24): bu handler ne çift-tıklamaya karşı devre dışı bırakma
    // (bkz. dosyadaki diğer neredeyse tüm aksiyon butonları — am-delete-account-btn, submission
    // formları vb.) ne de bir try/catch içeriyordu. Hızlı çift tıklama, architectSyncState.editId
    // henüz İLK isteğin yanıtından doldurulmadan submitArchitectSyncIfNeeded()'ın İKİ paralel
    // çağrısının da editId'yi null görüp İKİSİNİN de POST /api/architects atmasına (aynı kullanıcı
    // için iki ayrı architect_submissions satırı) yol açabiliyordu; ağ hatasında da fetch reddi hiç
    // yakalanmadığından kullanıcı sessizce hiçbir geri bildirim almıyordu.
    on('am-dash-save-btn', 'click', async (e) => {
      const btn = e.target;
      const msg = document.getElementById('am-dash-save-msg');
      const name = document.getElementById('am-edit-name').value;
      const dob = document.getElementById('am-edit-dob').value;
      const school = document.getElementById('am-edit-school').value;
      const profession = document.getElementById('am-edit-profession').value;
      const position = document.getElementById('am-edit-position').value;
      const awards = awardsDropdown ? awardsDropdown.getChecked() : [];
      const about = document.getElementById('am-edit-about').value;
      const socialLinks = collectAmSocialLinks();
      if (isInvalidSchoolValue(school)) { msg.textContent = 'Geçerli bir üniversite adı gir (kısaltma kullanma).'; return; }
      btn.disabled = true;
      try {
        const res = await fetch('/api/profile', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, dob, school, profession, position, awards, about, social_links: socialLinks }),
        });
        if (!res.ok) { msg.textContent = 'Kaydedilemedi, tekrar dene.'; return; }
        const claimSubmitted = await submitFirmaClaimIfChanged();
        await submitArchitectSyncIfNeeded(name, dob, school, profession, position, awards, about, socialLinks);

        msg.textContent = claimSubmitted ? 'Kaydedildi. Firma talebi admin onayına gönderildi.' : 'Kaydedildi.';
        await loadUser();
        await loadMyClaims();
        // Kaydetme başarılıysa kısa bir onay anından sonra pop-up kapanıp Hesabım'a dönülür (bkz.
        // kullanıcı isteği) — hesabim.html#dash-save-btn ile AYNI davranış.
        setTimeout(() => { msg.textContent = ''; closeAmProfileEditPopup(); }, claimSubmitted ? 2500 : 700);
      } catch {
        msg.textContent = 'Sunucuya ulaşılamadı, tekrar dene.';
      } finally {
        btn.disabled = false;
      }
    });

    on('am-avatar-upload-btn', 'click', () => document.getElementById('am-avatar-file-input').click());
    on('am-avatar-file-input', 'change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const hint = document.getElementById('am-avatar-upload-hint');
      hint.textContent = 'Yükleniyor…';
      try {
        const blob = await resizeImageFile(file, 480, 0.82);
        const form = new FormData();
        form.append('file', blob, 'avatar.jpg');
        const uploadRes = await fetch('/api/uploads', { method: 'POST', body: form });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadData.error || 'Yükleme başarısız.');
        const profileRes = await fetch('/api/profile', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photo_url: uploadData.url }),
        });
        if (!profileRes.ok) throw new Error('Profil güncellenemedi.');
        hint.textContent = `JPEG/PNG/WEBP, otomatik küçültülür (~150KB). Yaklaşık boyut: ${Math.round(blob.size / 1024)} KB.`;
        await loadUser();
      } catch (err) {
        hint.textContent = err.message || 'Fotoğraf yüklenemedi, tekrar dene.';
      }
      e.target.value = '';
    });

    async function loadBadges() {
      const res = await fetch('/api/badges/mine');
      const data = res.ok ? await res.json() : { items: [] };
      const items = data.items || [];
      amBadgeItems = items;
      renderAmNameBadge();
      renderClaimsList();
      const listEl = document.getElementById('am-my-badges-list');
      if (!items.length) {
        listEl.style.display = 'none';
      } else {
        listEl.style.display = '';
        listEl.innerHTML = items.map(b => {
          const tier = BADGE_TIERS.find(t => t.type === b.badge_type);
          const targetLabel = b.target_type === 'office' ? `Firma: ${escapeHtml(b.target_key || '')}` : 'Kendim için';
          const until = b.status === 'active' && b.expires_at
            ? `<div style="font-size:11px; color:var(--ink-soft); margin-top:2px;">${new Date(b.expires_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })} tarihine kadar aktif</div>`
            : '';
          return `
            <div class="my-badge-row">
              <div><strong>${escapeHtml(tier ? tier.label : b.badge_type)}</strong> — ${targetLabel}${until}</div>
              <span class="badge-status-pill" style="color:${BADGE_STATUS_COLORS[b.status] || 'var(--ink-soft)'}; background:${BADGE_STATUS_COLORS[b.status] || 'var(--ink-soft)'}22;">${BADGE_STATUS_LABELS[b.status] || b.status}</span>
            </div>`;
        }).join('');
      }
      const grid = document.getElementById('am-badge-grid');
      grid.innerHTML = BADGE_TIERS.map(tier => `
        <div class="badge-card">
          <div class="badge-card-name">${tier.label}</div>
          <div class="badge-card-price">${formatTRY(badgeSelfPrice(tier))} / ay</div>
          <a class="badge-buy-btn" href="satin-al.html?tier=${tier.type}">Satın Al</a>
        </div>`).join('');
    }

    // gerçek bulgu (denetim, 2026-08-24, bkz. am-dash-save-btn'deki AYNI eksiklik): çift-tıklamaya
    // karşı devre dışı bırakma yoktu — bir hızlı çift tıklama iki eşzamanlı change-password isteği
    // atabiliyor, ikincisi ilkinin (artık geçersiz olmuş) mevcut şifresini kullanmaya çalışıp
    // kafa karıştırıcı bir hata gösterebiliyordu.
    on('am-pw-save-btn', 'click', async (e) => {
      const btn = e.target;
      const msg = document.getElementById('am-pw-save-msg');
      const currentPassword = document.getElementById('am-pw-current').value;
      const newPassword = document.getElementById('am-pw-new').value;
      const newPasswordConfirm = document.getElementById('am-pw-new-confirm').value;
      if (newPassword.length < 8) { msg.textContent = 'Yeni şifre en az 8 karakter olmalı.'; return; }
      if (newPassword !== newPasswordConfirm) { msg.textContent = 'Yeni şifreler eşleşmiyor.'; return; }
      btn.disabled = true;
      try {
        const res = await fetch('/api/auth/change-password', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword, newPassword }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { msg.textContent = data.error || 'Şifre güncellenemedi.'; return; }
        msg.textContent = 'Şifre güncellendi.';
        document.getElementById('am-pw-current').value = '';
        document.getElementById('am-pw-new').value = '';
        document.getElementById('am-pw-new-confirm').value = '';
        setTimeout(() => msg.textContent = '', 3000);
      } catch {
        msg.textContent = 'Sunucuya ulaşılamadı, tekrar dene.';
      } finally {
        btn.disabled = false;
      }
    });

    on('am-delete-account-btn', 'click', async () => {
      if (!confirm('Hesabınızı silmek istediğinize emin misiniz? Bu işlem geri alınamaz.')) return;
      const btn = document.getElementById('am-delete-account-btn');
      const msg = document.getElementById('am-delete-account-msg');
      btn.disabled = true;
      try {
        const res = await fetch('/api/account', { method: 'DELETE' });
        if (!res.ok) throw new Error('request failed');
        window.location.href = '/index.html';
      } catch {
        msg.textContent = 'Bir şeyler ters gitti, tekrar dene.';
        btn.disabled = false;
      }
    });

    on('am-pw-forgot-link', 'click', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('am-pw-save-msg');
      if (!accountUser) return;
      msg.textContent = 'Gönderiliyor…';
      try {
        const res = await fetch('/api/auth/forgot-password', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: accountUser.email }),
        });
        const data = await res.json().catch(() => ({}));
        msg.textContent = data.message || 'Şifre sıfırlama bağlantısı e-postana gönderildi.';
      } catch {
        msg.textContent = 'Sunucuya ulaşılamadı, tekrar dene.';
      }
    });

    // Artık ayrı bir sekme değil, Profil Bilgileri kutusunun son satırları olarak doğrudan
    // gösterilir (bkz. kullanıcı isteği: "başlık altındaki butonları kaldır... son satırlarına yaz").
    // renderClaimsList: loadMyClaims'in DOM render kısmı ayrı bir fonksiyona çıkarıldı — amBadgeItems
    // (loadBadges) ve amClaimItems (bu fonksiyon) birbirinden bağımsız/paralel yüklendiğinden (bkz.
    // renderAmNameBadge'deki AYNI gerekçe), hangi rozet isteği önce biterse Firma satırındaki rozet
    // ikonunu güncellemek için bu render'ı YENİDEN çağırabilmesi gerekir.
    function renderClaimsList() {
      const list = document.getElementById('am-claims-mine-list');
      // Reddedilen talepler (ya da bir firmanın Kurucular/Ekip listesinden çıkarılıp officeFounderCascade.js#
      // cascadeRemovedProfileClaims tarafından 'rejected'e çevrilmiş satırlar — bkz. kullanıcı isteği: "reddedilen
      // firma sahibi talebi ... profil bilgileri kutusunda hala gözüküyor") burada hiç gösterilmez — kullanıcının
      // artık geçerli olmayan bir talebi/bağlantıyı kalıcı şekilde görmesinin bir faydası yok, yalnızca kafa
      // karıştırıyor. Talep tekrar gönderilirse (bkz. src/routes/claims.js#createClaim'in rejected→pending reset'i)
      // zaten yeniden 'pending' olarak burada görünür.
      const visibleItems = amClaimItems.filter(c => c.status !== 'rejected');
      // #am-profile-tab-facts'in son satırı (Üyelik) kendi kutusunda :last-child olduğundan .profile-
      // fact'in border-bottom:none kuralına takılır — burada claim satırı EKLENDİĞİNDE aradaki çizgiyi
      // geri getirmek için .profile-fact ile AYNI çizgiyi bu ayrı kutunun üstüne koyuyoruz (bkz.
      // kullanıcı isteği: "üyelik ve firma başlıkları arasında ... diğer satırlarla aynı şekilde line").
      if (!visibleItems.length) { list.innerHTML = ''; list.style.borderTop = 'none'; return; }
      list.style.borderTop = '1px solid var(--line-soft)';
      // Firma satırı Mimar satırının ÜSTÜNDE gösterilir (bkz. kullanıcı isteği) — Array.sort
      // kararlı (stable) olduğundan aynı tip içindeki göreli sıra (API'nin updated_at DESC'i)
      // korunur, yalnızca office/architect grupları arasında sıra sabitlenir.
      const sortedItems = visibleItems.slice().sort((a, b) => (a.profile_type === 'office' ? 0 : 1) - (b.profile_type === 'office' ? 0 : 1));
      list.innerHTML = sortedItems.map(c => {
        // office için: pozisyon Kurucu/Kurucu Ortak/Ortak/Ekip Lideri DEĞİLSE Düzenle linki hiç
        // gösterilmez (bkz. yukarıdaki OFFICE_EDIT_POSITIONS yorumu) — mimar profili kendi pozisyonundan
        // bağımsız düzenlenebildiğinden (bkz. src/routes/submissions.js#verifyClaimedProfileKey) bu
        // kısıtlama yalnızca office tipinde uygulanır.
        const canEdit = c.status === 'approved' && (c.profile_type !== 'office' || OFFICE_EDIT_POSITIONS.has(accountUser && accountUser.position));
        // gerçek bulgu: bu satır kendi satın alınan rozetinden (amBadgeItems) seçim yapıyordu, ama
        // /api/public/badges (mimar/firma kartlarında, profil modallarında gösterilen TEK doğru
        // kaynak — bkz. src/routes/badges.js#computeBadgesPayload) admin_badges'i satın alınanın
        // ÜZERİNE yazıyor. Sonuç: admin bir profile elle daha yüksek kademe rozet verdiğinde (ör.
        // Elmas Üye) Hesabım'daki satır hâlâ kullanıcının kendi satın aldığı eski/düşük kademeyi
        // gösteriyordu. Kökten çözüm: burada da AYNI kaynağı (amPublicBadges, bkz. aşağıdaki
        // loadPublicBadgesForClaims) kullanmak — artık site genelinde görünenle bire bir aynı.
        const publicBadgeList = c.status === 'approved'
          ? (amPublicBadges[c.profile_type] && amPublicBadges[c.profile_type][c.profile_key])
          : null;
        const rowBadgeType = publicBadgeList && publicBadgeList.length ? publicBadgeList[0] : null;
        return `
        <div class="profile-fact">
          <span class="profile-fact-label">${CLAIM_TYPE_LABELS[c.profile_type] || c.profile_type}</span>
          <span class="profile-fact-value" style="display:flex; align-items:center; gap:10px; flex:1; justify-content:space-between;">
            <span>${escapeHtml(c.profile_key)}${rowBadgeType ? accountBadgeIconHtml(rowBadgeType) : ''}</span>
            ${canEdit
              ? `<a class="submission-edit-link" href="${CLAIM_EDIT_PAGE[c.profile_type]}?claim=${encodeURIComponent(c.slug || c.profile_key)}">Düzenle</a>`
              : c.status === 'approved'
                ? ''
                : `<span style="font-size:11px; font-weight:700; text-transform:uppercase; color:${CLAIM_STATUS_COLORS_ACCOUNT[c.status] || 'var(--ink-soft)'};">${CLAIM_STATUS_LABELS_ACCOUNT[c.status] || c.status}</span>`}
          </span>
        </div>
      `;
      }).join('');
    }

    async function loadPublicBadgesForClaims() {
      try {
        const res = await fetch('/api/public/badges');
        const data = res.ok ? await res.json() : {};
        amPublicBadges = { architect: data.architect || {}, office: data.office || {} };
      } catch { /* amPublicBadges varsayılanında kalır */ }
      renderClaimsList();
      renderAmNameBadge();
    }

    async function loadMyClaims() {
      const res = await fetch('/api/claims/mine');
      const data = res.ok ? await res.json() : { items: [] };
      const items = data.items || [];
      amClaimItems = items;
      refreshArchitectSyncState(items);
      renderClaimsList();
      renderAmNameBadge();
      syncClaimedArchitectData(items);
    }

    async function syncClaimedArchitectData(items) {
      if (!accountUser) return;
      const claim = items.find(c => c.profile_type === 'architect' && c.status === 'approved');
      if (!claim) return;
      let arch;
      try {
        const res = await fetch(`/api/architect/${encodeURIComponent(claim.profile_key)}`);
        if (!res.ok) return;
        arch = (await res.json()).item;
      } catch { return; }
      if (!arch) return;
      const patch = {};
      if (!accountUser.photoUrl && arch.photo) patch.photo_url = arch.photo;
      if (!accountUser.school && arch.school) patch.school = arch.school;
      // Pozisyon (bkz. kullanıcı isteği: "tam bir senkronizasyon") — mimar kaydındaki `role` ile AYNI
      // metin kümesini paylaşır (bkz. am-edit-position'daki genişletilmiş 10 seçenek), bu yüzden
      // doğrudan kopyalanabilir. Meslek ise mimar kaydında ham Türkçe etiket ("Mimar"), users.profession
      // ise kodlu bir slug ("mimar") olduğundan PROFESSION_LABELS ters çevrilerek eşleştirilir.
      if (!accountUser.position && arch.role) patch.position = arch.role;
      if (!accountUser.profession && arch.profession) {
        const slug = Object.keys(PROFESSION_LABELS).find(k => PROFESSION_LABELS[k] === arch.profession);
        if (slug) patch.profession = slug;
      }
      // Ödüller/Açıklama/Sosyal Medya artık her kullanıcının hesap profilinde de var (bkz. kullanıcı
      // isteği) — yeni onaylanan bir talepte mimar kaydında zaten dolu olan bu alanlar, hesap
      // profili henüz boşsa bir kerelik buraya da taşınır (school/position/profession ile AYNI
      // "yalnızca boşsa doldur" kuralı, kullanıcının kendi elle girdiği bir değerin üzerine yazmaz).
      if (!(accountUser.awards || []).length && (arch.awards || []).length) patch.awards = arch.awards;
      if (!accountUser.about && arch.about) patch.about = arch.about;
      if (!(accountUser.social_links || []).length && (arch.social_links || []).length) patch.social_links = arch.social_links;
      if (!Object.keys(patch).length) return;
      try {
        const res = await fetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
        if (res.ok) await loadUser();
      } catch {}
    }

    let notifItems = [];
    let notifPage = 1;
    async function loadNotifications() {
      const res = await fetch('/api/notifications/mine');
      const data = res.ok ? await res.json() : { items: [] };
      notifItems = data.items || [];
      renderNotifications();
    }
    function renderNotifications() {
      const container = document.getElementById('am-dash-notifications');
      if (!notifItems.length) {
        container.innerHTML = '<div class="dash-empty">Henüz bir bildirimin yok.</div>';
        document.getElementById('am-notif-pagination').innerHTML = '';
        return;
      }
      const totalPages = Math.max(1, Math.ceil(notifItems.length / PAGE_SIZE_DASH));
      if (notifPage > totalPages) notifPage = totalPages;
      const startIdx = (notifPage - 1) * PAGE_SIZE_DASH;
      const pageItems = notifItems.slice(startIdx, startIdx + PAGE_SIZE_DASH);
      container.innerHTML = pageItems.map(n => `
        <div class="notif-row${n.is_read ? '' : ' unread'}" data-id="${n.id}">
          <div class="notif-dot-col">${n.is_read ? '' : '<span class="notif-dot"></span>'}</div>
          <div style="flex:1; min-width:0;">
            <div class="notif-title">${escapeHtml(n.title)}</div>
            ${n.body ? `<div class="notif-body">${escapeHtml(n.body)}</div>` : ''}
            <div class="notif-meta">${new Date(n.created_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
          </div>
        </div>`).join('');
      container.querySelectorAll('.notif-row.unread').forEach(row => {
        row.addEventListener('click', async () => {
          row.classList.remove('unread');
          const dot = row.querySelector('.notif-dot');
          if (dot) dot.remove();
          const item = notifItems.find(n => String(n.id) === row.dataset.id);
          if (item) item.is_read = true;
          try {
            await fetch(`/api/notifications/${encodeURIComponent(row.dataset.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_read: true }) });
          } catch {}
        }, { once: true });
      });
      renderDashPagination('am-notif-pagination', notifPage, totalPages, (p) => { notifPage = p; renderNotifications(); });
    }
    on('am-notif-read-all-btn', 'click', async () => {
      try { await fetch('/api/notifications/read-all', { method: 'POST' }); } finally { loadNotifications(); }
    });
    on('am-notif-delete-all-btn', 'click', async () => {
      if (!confirm('Tüm bildirimlerini silmek istediğine emin misin? Bu işlem geri alınamaz.')) return;
      notifPage = 1;
      try { await fetch('/api/notifications/delete-all', { method: 'POST' }); } finally { loadNotifications(); }
    });

    loadUser().then(() => {
      if (accountUser) {
        [loadBadges(), loadMyClaims(), loadPublicBadgesForClaims(), loadNotifications()]
          .forEach(p => p.catch(() => {}));
        if (new URLSearchParams(window.location.search).get('payment') === 'success') {
          document.getElementById('am-payment-success-banner').style.display = 'block';
        }
      }
    });
  }

  // ---------------------------------------------------------------------------------------------
  // AKTİVİTELERİM — Paylaştığım İçerikler/Kaydettiklerim/Beğendiklerim/Yorumlarım. mountAccount()'un
  // eski TEK parçasıydı (bkz. activitiesTemplate() üstündeki yorum); accountUser gibi Hesabım'a
  // özgü hiçbir state'e bağımlı olmadığından burada kendi başına, /api/auth/me ile ayrı bir oturum
  // kontrolüyle çalışır.
  // ---------------------------------------------------------------------------------------------
  function mountActivities() {
    const wired = new Set();
    function on(id, evt, fn) {
      const key = id + ':' + evt;
      if (wired.has(key)) return;
      wired.add(key);
      const el = document.getElementById(id);
      if (el) el.addEventListener(evt, fn);
    }

    let savedItems = [];
    let savedFilter = '';
    let savedPage = 1;
    async function loadSaved() {
      const res = await fetch('/api/saved');
      const data = res.ok ? await res.json() : { items: [] };
      savedItems = data.items || [];
      renderSaved();
    }
    // "Ürün" filtresi hem product hem material tipini kapsar — urun.html'de bu ikisi zaten TEK
    // katalog olarak birleşti, Kaydettiklerim/Beğendiklerim'de ayrı bir "Malzeme" butonu olmadığından
    // ikisi de tek "Ürün" butonunun altında toplanır.
    function matchesCatalogFilter(itemType, filter) {
      if (!filter) return true;
      if (filter === 'product') return itemType === 'product' || itemType === 'material';
      return itemType === filter;
    }
    function renderSaved() {
      const container = document.getElementById('am-dash-saved');
      const items = savedFilter ? savedItems.filter(it => matchesCatalogFilter(it.item_type, savedFilter)) : savedItems;
      if (!savedItems.length) {
        container.innerHTML = '<div class="dash-empty">Henüz kaydettiğin bir içerik yok.<br><a href="proje.html">Projelere göz at</a></div>';
        document.getElementById('am-saved-pagination').innerHTML = '';
        return;
      }
      if (!items.length) {
        container.innerHTML = '<div class="dash-empty">Bu türde kaydettiğin bir içerik yok.</div>';
        document.getElementById('am-saved-pagination').innerHTML = '';
        return;
      }
      const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE_DASH));
      if (savedPage > totalPages) savedPage = totalPages;
      const startIdx = (savedPage - 1) * PAGE_SIZE_DASH;
      const pageItems = items.slice(startIdx, startIdx + PAGE_SIZE_DASH);
      container.innerHTML = pageItems.map(it => `
        <div class="saved-row" data-type="${escapeAttr(it.item_type)}" data-key="${escapeAttr(it.item_key)}">
          <a class="saved-row-link" href="${escapeAttr(safeUrl(it.item_href) || '#')}">
            ${it.item_image && safeUrl(it.item_image) ? `<img src="${escapeAttr(avatarImg(it.item_image, 160, safeUrl(it.item_image)))}" alt="" loading="lazy" decoding="async">` : `<div class="saved-row-noimg"></div>`}
            <div style="min-width:0;">
              <div class="saved-row-title">${escapeHtml(it.item_title || '—')}</div>
              <div class="saved-row-meta">${SAVED_TYPE_LABELS[it.item_type] || ''}${it.item_meta ? ' · ' + escapeHtml(it.item_meta) : ''}</div>
            </div>
          </a>
          <button class="saved-remove-btn" type="button" aria-label="Kaldır">✕</button>
        </div>`).join('');
      container.querySelectorAll('.saved-remove-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const row = btn.closest('.saved-row');
          btn.disabled = true;
          try {
            await fetch(`/api/saved/${row.dataset.type}/${encodeURIComponent(row.dataset.key)}`, { method: 'DELETE' });
            loadSaved();
          } catch { btn.disabled = false; }
        });
      });
      renderDashPagination('am-saved-pagination', savedPage, totalPages, (p) => { savedPage = p; renderSaved(); });
    }

    let ratedItems = [];
    let ratedFilter = '';
    let ratedPage = 1;
    async function loadRated() {
      const res = await fetch('/api/ratings/mine');
      const data = res.ok ? await res.json() : { items: [] };
      ratedItems = data.items || [];
      renderRated();
    }
    function renderRated() {
      const container = document.getElementById('am-dash-rated');
      const items = ratedFilter ? ratedItems.filter(it => matchesCatalogFilter(it.type, ratedFilter)) : ratedItems;
      if (!ratedItems.length) {
        container.innerHTML = '<div class="dash-empty">Henüz puanladığın bir içerik yok.<br><a href="proje.html">Projelere göz at</a></div>';
        document.getElementById('am-rated-pagination').innerHTML = '';
        return;
      }
      if (!items.length) {
        container.innerHTML = '<div class="dash-empty">Bu türde puanladığın bir içerik yok.</div>';
        document.getElementById('am-rated-pagination').innerHTML = '';
        return;
      }
      const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE_DASH));
      if (ratedPage > totalPages) ratedPage = totalPages;
      const startIdx = (ratedPage - 1) * PAGE_SIZE_DASH;
      const pageItems = items.slice(startIdx, startIdx + PAGE_SIZE_DASH);
      container.innerHTML = pageItems.map(it => `
        <div class="saved-row">
          <a class="saved-row-link" href="${escapeAttr(safeUrl(it.href) || '#')}">
            ${it.image && safeUrl(it.image) ? `<img src="${escapeAttr(safeUrl(it.image))}" alt="" loading="lazy" decoding="async">` : `<div class="saved-row-noimg"></div>`}
            <div style="min-width:0;">
              <div class="saved-row-title">${escapeHtml(it.title || '—')}</div>
              <div class="saved-row-meta">${SAVED_TYPE_LABELS[it.type] || ''}${it.meta ? ' · ' + escapeHtml(it.meta) : ''} · ${'★'.repeat(it.stars)}${'☆'.repeat(5 - it.stars)}</div>
            </div>
          </a>
        </div>`).join('');
      renderDashPagination('am-rated-pagination', ratedPage, totalPages, (p) => { ratedPage = p; renderRated(); });
    }

    // Düello Analizlerim — loadRated/renderRated İLE AYNI desen (en yakın örnek: tip filtresi yok,
    // tek liste + sayfalama, bkz. kullanıcı isteği: "Aktivitelerim'e yeni bir kutu ekle"). Satıra
    // tıklanınca duel-analysis-modal.js diğer sayfalarda henüz yüklenmemiş olabilir (bkz. lazy-modals.js
    // İLE AYNI gerekçe: bu popup yalnızca burada VEYA duello.html'de kullanılır, her sayfaya script
    // tag'i eklemek yerine ilk gerçek kullanımda indirilir).
    // audit bulgusu (2026-08-27): `window.DuelAnalysisModal` kontrolü TEK BAŞINA yeterli değildi —
    // kullanıcı iki farklı "Analizi Gör" satırına HIZLI art arda tıklarsa (ilk script henüz
    // yüklenip window.DuelAnalysisModal'ı SET ETMEDEN), her iki çağrı da onu tanımsız görüp
    // KENDİ <script> etiketini enjekte ediyor — ikinci betiğin üst düzey `const DuelAnalysisModal`
    // bildirimi "Identifier has already been declared" SyntaxError'ı ile patlıyor (doğrulandı: iki
    // <script> art arda enjekte edilince gerçekten fırlıyor). lazy-modals.js#loadModule İLE AYNI
    // "bekleyen Promise'i önbelleğe al" deseni bu yarışı ortadan kaldırır — ikinci çağrı YENİ bir
    // script enjekte etmez, birincinin Promise'ine katılır.
    let pendingDuelAnalysisModal = null;
    function loadDuelAnalysisModal() {
      if (window.DuelAnalysisModal) return Promise.resolve(window.DuelAnalysisModal);
      if (pendingDuelAnalysisModal) return pendingDuelAnalysisModal;
      pendingDuelAnalysisModal = new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = 'js/components/duel-analysis-modal.js';
        script.onload = () => resolve(window.DuelAnalysisModal);
        document.head.appendChild(script);
      });
      return pendingDuelAnalysisModal;
    }

    let duelAnalysisItems = [];
    let duelAnalysisPage = 1;
    async function loadDuelAnalyses() {
      const res = await fetch('/api/duel/analysis/mine');
      const data = res.ok ? await res.json() : { items: [] };
      duelAnalysisItems = data.items || [];
      renderDuelAnalyses();
    }
    function renderDuelAnalyses() {
      const container = document.getElementById('am-dash-duel-analysis');
      if (!container) return;
      if (!duelAnalysisItems.length) {
        container.innerHTML = '<div class="dash-empty">Henüz kaydedilmiş bir Düello analizin yok.<br><a href="duello.html">Düello oyna</a></div>';
        document.getElementById('am-duel-analysis-pagination').innerHTML = '';
        return;
      }
      const totalPages = Math.max(1, Math.ceil(duelAnalysisItems.length / PAGE_SIZE_DASH));
      if (duelAnalysisPage > totalPages) duelAnalysisPage = totalPages;
      const startIdx = (duelAnalysisPage - 1) * PAGE_SIZE_DASH;
      const pageItems = duelAnalysisItems.slice(startIdx, startIdx + PAGE_SIZE_DASH);
      container.innerHTML = pageItems.map(it => `
        <div class="saved-row">
          <a class="saved-row-link" href="#" data-duel-analysis-id="${escapeAttr(it.id)}">
            <div class="saved-row-noimg"></div>
            <div style="min-width:0;">
              <div class="saved-row-title">${escapeHtml(new Date(it.createdAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }))}</div>
              <div class="saved-row-meta">${it.choiceCount} seçim${it.headline ? ' · ' + escapeHtml(it.headline) : ''}</div>
            </div>
          </a>
        </div>`).join('');
      renderDashPagination('am-duel-analysis-pagination', duelAnalysisPage, totalPages, (p) => { duelAnalysisPage = p; renderDuelAnalyses(); });
    }
    on('am-dash-duel-analysis', 'click', (e) => {
      const row = e.target.closest('[data-duel-analysis-id]');
      if (!row) return;
      e.preventDefault();
      const id = row.getAttribute('data-duel-analysis-id');
      loadDuelAnalysisModal().then((Modal) => { if (Modal) Modal.open({ mode: 'saved', id }, { triggerEl: row }); });
    });

    let commentItems = [];
    let commentsFilter = '';
    let commentsPage = 1;
    async function loadComments() {
      const res = await fetch('/api/comments/mine');
      const data = res.ok ? await res.json() : { items: [] };
      commentItems = data.items || [];
      renderComments();
    }
    function renderComments() {
      const container = document.getElementById('am-dash-comments');
      const items = commentsFilter ? commentItems.filter(it => it.type === commentsFilter) : commentItems;
      if (!commentItems.length) {
        container.innerHTML = '<div class="dash-empty">Henüz bir yorum yapmadın.<br><a href="proje.html">Projelere göz at</a></div>';
        document.getElementById('am-comments-pagination').innerHTML = '';
        return;
      }
      if (!items.length) {
        container.innerHTML = '<div class="dash-empty">Bu türde bir yorumun yok.</div>';
        document.getElementById('am-comments-pagination').innerHTML = '';
        return;
      }
      const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE_DASH));
      if (commentsPage > totalPages) commentsPage = totalPages;
      const startIdx = (commentsPage - 1) * PAGE_SIZE_DASH;
      const pageItems = items.slice(startIdx, startIdx + PAGE_SIZE_DASH);
      container.innerHTML = pageItems.map(it => `
        <div class="saved-row" data-id="${escapeAttr(it.id)}">
          <a class="saved-row-link" href="${escapeAttr(safeUrl(it.href) || '#')}">
            ${it.image && safeUrl(it.image) ? `<img src="${escapeAttr(safeUrl(it.image))}" alt="" loading="lazy" decoding="async">` : `<div class="saved-row-noimg"></div>`}
            <div style="min-width:0;">
              <div class="saved-row-title">${escapeHtml(it.title || '—')}</div>
              <div class="saved-row-meta">${SAVED_TYPE_LABELS[it.type] || ''} · ${escapeHtml(it.body.length > 80 ? it.body.slice(0, 77) + '…' : it.body)}</div>
            </div>
          </a>
          <button class="saved-remove-btn" type="button" aria-label="Kaldır">✕</button>
        </div>`).join('');
      container.querySelectorAll('.saved-remove-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const row = btn.closest('.saved-row');
          btn.disabled = true;
          try {
            await fetch(`/api/comments/${encodeURIComponent(row.dataset.id)}`, { method: 'DELETE' });
            loadComments();
          } catch { btn.disabled = false; }
        });
      });
      renderDashPagination('am-comments-pagination', commentsPage, totalPages, (p) => { commentsPage = p; renderComments(); });
    }
    on('am-comments-filter', 'click', (e) => {
      const btn = e.target.closest('.saved-filter-btn');
      if (!btn) return;
      commentsFilter = btn.dataset.filter;
      commentsPage = 1;
      document.querySelectorAll('#am-comments-filter .saved-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderComments();
    });

    on('am-rated-filter', 'click', (e) => {
      const btn = e.target.closest('.saved-filter-btn');
      if (!btn) return;
      ratedFilter = btn.dataset.filter;
      ratedPage = 1;
      document.querySelectorAll('#am-rated-filter .saved-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderRated();
    });
    on('am-saved-filter', 'click', (e) => {
      const btn = e.target.closest('.saved-filter-btn');
      if (!btn) return;
      savedFilter = btn.dataset.filter;
      savedPage = 1;
      document.querySelectorAll('#am-saved-filter .saved-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderSaved();
    });

    fetch('/api/auth/me').then(r => {
      if (!r.ok) { swap('login'); return; }
      [loadSaved(), loadRated(), loadComments(), loadDuelAnalyses()].forEach(p => p.catch(() => {}));
    }).catch(() => {});
  }

  // İçeriklerim popup'ının mount fonksiyonu — mountActivities() İÇİNDE "Paylaştığım İçerikler"in
  // eskiden kullandığı loadSubmissions/renderSubmissions AYNEN buraya taşındı (bkz. contentsTemplate).
  function mountContents() {
    const wired = new Set();
    function on(id, evt, fn) {
      const key = id + ':' + evt;
      if (wired.has(key)) return;
      wired.add(key);
      const el = document.getElementById(id);
      if (el) el.addEventListener(evt, fn);
    }

    let allSubmissions = [];
    let submissionsFilter = '';
    let submissionsPage = 1;
    async function loadSubmissions() {
      const types = Object.keys(TYPE_LABELS);
      const results = await Promise.all(types.map(t => fetch(`/api/${t}/mine`).then(r => r.ok ? r.json() : { items: [] })));
      allSubmissions = [];
      types.forEach((t, i) => (results[i].items || []).forEach(item => allSubmissions.push({ type: t, item })));
      allSubmissions.sort((a, b) => b.item.created_at - a.item.created_at);
      renderSubmissions();
    }
    function renderSubmissions() {
      const container = document.getElementById('am-dash-submissions');
      if (!allSubmissions.length) {
        container.innerHTML = '<div class="dash-empty">Henüz bir içerik göndermedin.<br><a href="proje-ekle.html">Proje Ekle</a> · <a href="mimar-ekle.html">Mimar Ekle</a> · <a href="firma-ekle.html">Firma Ekle</a></div>';
        document.getElementById('am-submissions-pagination').innerHTML = '';
        return;
      }
      const all = submissionsFilter ? allSubmissions.filter(s => s.type === submissionsFilter) : allSubmissions;
      if (!all.length) {
        container.innerHTML = '<div class="dash-empty">Bu türde gönderdiğin bir içerik yok.</div>';
        document.getElementById('am-submissions-pagination').innerHTML = '';
        return;
      }
      const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE_DASH));
      if (submissionsPage > totalPages) submissionsPage = totalPages;
      const startIdx = (submissionsPage - 1) * PAGE_SIZE_DASH;
      const pageItems = all.slice(startIdx, startIdx + PAGE_SIZE_DASH);
      container.innerHTML = pageItems.map(({ type, item }) => {
        const detailUrl = itemDetailUrl(type, item);
        const titleHtml = detailUrl
          ? `<a href="${escapeAttr(detailUrl)}" style="font-weight:600; font-size:13.5px; color:inherit; text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${escapeHtml(itemTitle(type, item))}</a>`
          : `<div style="font-weight:600; font-size:13.5px;">${escapeHtml(itemTitle(type, item))}</div>`;
        return `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 0; border-bottom:1px solid var(--line-soft);">
          <div>
            ${titleHtml}
            <div style="font-size:11.5px; color:var(--ink-soft);">${TYPE_LABELS[type]} · ${new Date(item.created_at).toLocaleDateString('tr-TR')}</div>
          </div>
          <div style="display:flex; align-items:center; gap:10px; flex-shrink:0;">
            ${(type === 'products' || type === 'materials') ? '' : `<a class="submission-edit-link" href="${EDIT_PAGE_BY_TYPE[type]}?edit=${encodeURIComponent(item.id)}&stype=${encodeURIComponent(type)}">Düzenle</a>`}
            <span style="font-size:11px; font-weight:700; text-transform:uppercase; padding:4px 10px; border-radius:100px; color:${STATUS_COLORS[item.status]}; background:${STATUS_COLORS[item.status]}22;">${STATUS_LABELS[item.status]}</span>
          </div>
        </div>
      `;
      }).join('');
      renderDashPagination('am-submissions-pagination', submissionsPage, totalPages, (p) => { submissionsPage = p; renderSubmissions(); });
    }

    on('am-submissions-filter', 'click', (e) => {
      const btn = e.target.closest('.submissions-filter-btn');
      if (!btn) return;
      submissionsFilter = btn.dataset.filter;
      submissionsPage = 1;
      document.querySelectorAll('#am-submissions-filter .submissions-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderSubmissions();
    });

    fetch('/api/auth/me').then(r => {
      if (!r.ok) { swap('login'); return; }
      loadSubmissions().catch(() => {});
    }).catch(() => {});
  }

  // ---------------------------------------------------------------------------------------------
  // Ortak modal-shell state machine — js/components/project-modal.js#open/swap/close/handlePopState
  // ile AYNI desen (bkz. dosya başı yorumu).
  // ---------------------------------------------------------------------------------------------
  let currentView = null;
  let openedViaPush = false;
  let pushCountSinceOpen = 0;

  // kullanıcı isteği (2026-08-28): tablet/mobilde (≤960px, bkz. site-chrome.js'teki AYNI kırılma
  // noktası — .nav-hamburger tam olarak bu genişlikte görünür olur) Giriş Yap/Üye Ol/Hesabım/
  // Aktivitelerim/İçeriklerim artık AYRI bir ModalShell popup'ı DEĞİL, js/components/site-chrome.js#
  // NavDrawer'ın yönettiği hamburger çekmecesinin İÇİNDE kayan bir alt sayfa olarak açılır — masaüstü
  // davranışı (ModalShell popup) HİÇ değişmeden korunur. window.NavDrawer her sayfada bu dosyadan
  // (lazy-modals.js ile SONRADAN yüklenir) ÖNCE, senkron yüklendiğinden (bkz. site-chrome.js dosya
  // başı yorumu) burada koşulsuz var olduğu varsayılabilir; yine de savunmacı bir `&&` kontrolü var.
  function isMobileDrawer() {
    return !!(window.NavDrawer && window.matchMedia('(max-width:960px)').matches);
  }
  // Şu an İÇERİĞİN barındırıldığı GERÇEK host — isMobileDrawer() yalnızca ANLIK viewport'u sorar,
  // bu ise (resize sırasında iki host arasında geçiş anlarında bile) her zaman doğru kalır çünkü tüm
  // host değişimleri (open/swap/handlePopState/resize dinleyicisi, bkz. aşağısı) NavDrawer.showSubpage/
  // hideSubpage/closeDrawer çağrılarıyla senkron yürütülür.
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
    const mobile = isMobileDrawer();
    let hostEl;
    if (mobile) {
      hostEl = window.NavDrawer.getSubpageBodyEl();
      hostEl.innerHTML = '';
    } else {
      // bkz. js/components/modal-shell.js#claimContent — sahip değiştiyse (proje/mimar/firma/ürün
      // modalından geçildiyse) paneller zaten boşaltılmış/bodyEl temel sınıfa sıfırlanmış olur; aynı
      // kalırsa (login↔signup↔account arası geçiş) hiçbir şey silinmez, aşağıdaki manuel temizlik
      // (view'i yeniden kurmak için) değişmeden çalışmaya devam eder.
      const panels = ModalShell.claimContent('auth');
      panels.bodyEl.classList.add('am-single');
      panels.rightPanelEl.innerHTML = '';
      panels.leftPanelEl.innerHTML = '';
      hostEl = panels.leftPanelEl;
    }
    const wrap = document.createElement('div');
    wrap.id = 'am-panel';
    hostEl.appendChild(wrap);
    if (view === 'login') { wrap.innerHTML = loginTemplate(); wireLogin(); }
    else if (view === 'signup') { wrap.innerHTML = signupTemplate(); wireSignup(); }
    else if (view === 'forgot') { wrap.innerHTML = forgotTemplate(); wireForgot(); }
    else if (view === 'activities') { wrap.innerHTML = activitiesTemplate(); mountActivities(); }
    else if (view === 'contents') { wrap.innerHTML = contentsTemplate(); mountContents(); }
    else { wrap.innerHTML = accountTemplate(); mountAccount(); }
    if (mobile) {
      hostEl.scrollTop = 0;
    } else {
      // denetim bulgusu (AUDIT-009): bu modal document.title'ı hiç değiştirmiyor (sayfanın kendi
      // başlığı korunur), o yüzden diğer modallardaki gibi document.title'ı yeniden kullanamayız —
      // aria-label için ayrı, sabit bir Türkçe etiket haritası.
      const AUTH_VIEW_LABELS = { login: 'Giriş Yap', signup: 'Üye Ol', forgot: 'Şifremi Unuttum', activities: 'Aktivitelerim', contents: 'İçeriklerim' };
      ModalShell.setLabel(AUTH_VIEW_LABELS[view] || 'Hesabım');
      ModalShell.scrollToTop();
    }
  }

  function isOpen() { return currentView !== null; }

  function open(view, { pushHistory = true, triggerEl = null } = {}) {
    currentView = view;
    openedViaPush = pushHistory;
    pushCountSinceOpen = pushHistory ? 1 : 0;
    if (pushHistory) history.pushState({ mimarlabModal: 'auth', view, depth: 1 }, '', VIEW_PATH[view]);
    if (isMobileDrawer()) window.NavDrawer.showSubpage({ onBack: backToMenu, onRequestFullClose: close });
    else ModalShell.open({ triggerEl, onRequestClose: close });
    renderView(view);
  }

  function swap(view) {
    if (!isOpen()) return open(view, { pushHistory: true });
    const wasMobile = currentHostIsMobile();
    currentView = view;
    const currentDepth = (history.state && history.state.mimarlabModal === 'auth') ? history.state.depth : pushCountSinceOpen;
    pushCountSinceOpen = currentDepth + 1;
    history.pushState({ mimarlabModal: 'auth', view, depth: pushCountSinceOpen }, '', VIEW_PATH[view]);
    // Tüm AuthModal görünümleri her iki host'ta da (mobil/masaüstü) açılabildiğinden host normalde
    // swap sırasında DEĞİŞMEZ — yalnızca resize sırasında (bkz. aşağıdaki resize dinleyicisi) farklı
    // olabilir; bu satır o nadir yarış durumuna karşı bir güvenlik ağı.
    const willBeMobile = isMobileDrawer();
    if (wasMobile !== willBeMobile) { deactivateHost(wasMobile); activateHost(willBeMobile); }
    renderView(view);
  }

  // .am-single sınıfı (bkz. renderView()) paylaşılan modal-shell bodyEl'e eklenir — proje/mimar/
  // firma/ürün modalları da AYNI bodyEl'i kullandığından (bkz. dosya başı yorumu) kapatırken
  // KALDIRILMAZSA bir sonraki açılan başka bir modalın 32/68 ızgarasını bozardı (gerçek bulgu).
  function unmountSingleColumn() {
    const panels = ModalShell.getPanels();
    if (panels) panels.bodyEl.classList.remove('am-single');
  }

  // Yalnızca mobil çekmecenin breadcrumb'ından ("‹ Menü") çağrılır (bkz. NavDrawer.showSubpage'e
  // burada geçilen onBack) — masaüstünde hiçbir zaman tetiklenmez. close()'un AKSİNE çekmeceyi
  // TAMAMEN kapatmaz, yalnızca alt sayfayı gizleyip ana menüye döner (bkz. kullanıcı isteği: "üstte
  // Menü breadcrumb/back ile hamburger ana menüsüne dönülsün") — URL/history geri sarma close() ile
  // BİREBİR aynı (aksi halde geri tuşu bu ekranı yeniden açardı).
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
    if (openedViaPush && pushCountSinceOpen > 0) history.go(-pushCountSinceOpen);
    else history.pushState({}, '', '/');
    deactivateHost(mobile);
    pushCountSinceOpen = 0;
  }

  function handlePopState(view) {
    if (!view) { if (isOpen()) { currentView = null; deactivateHost(currentHostIsMobile()); } return; }
    if (!isOpen()) { openedViaPush = false; open(view, { pushHistory: false }); return; }
    if (history.state && history.state.mimarlabModal === 'auth' && typeof history.state.depth === 'number') {
      pushCountSinceOpen = history.state.depth;
    }
    if (view === currentView) return;
    const wasMobile = currentHostIsMobile();
    currentView = view;
    const willBeMobile = isMobileDrawer();
    if (wasMobile !== willBeMobile) { deactivateHost(wasMobile); activateHost(willBeMobile); }
    renderView(view);
  }

  // Bir görünüm açıkken viewport 960px kırılma noktasını geçerse (ör. tablet döndürme, tarayıcı
  // penceresi yeniden boyutlandırma) içerik URL/history'e DOKUNULMADAN doğru host'a (ModalShell <->
  // NavDrawer alt sayfası) yeniden mount edilir — bkz. kullanıcı isteği: "responsive geçiş düzgün
  // çalışmalı".
  window.addEventListener('resize', () => {
    if (!isOpen() || !window.NavDrawer) return;
    const wasMobile = currentHostIsMobile();
    const willBeMobile = isMobileDrawer();
    if (wasMobile === willBeMobile) return;
    deactivateHost(wasMobile);
    activateHost(willBeMobile);
    renderView(currentView);
  });

  function pathToView(pathname) {
    const path = pathname.replace(/\/$/, '') || '/';
    if (path === '/giris') return 'login';
    if (path === '/uye-ol') return 'signup';
    if (path === '/hesabim') return 'account';
    if (path === '/aktivitelerim') return 'activities';
    if (path === '/iceriklerim') return 'contents';
    if (path === '/sifremi-unuttum') return 'forgot';
    return null;
  }

  // Header/footer/auth-nav.js'in ürettiği MEVCUT bağlantılar (bkz. dosya başı yorumu) — hiçbir
  // sayfanın kendi href'i değiştirilmedi, yalnızca burada delege edilip preventDefault edilir.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const href = a.getAttribute('href');
    let view = null;
    if (HREF_VIEW_RE.login.test(href)) view = 'login';
    else if (HREF_VIEW_RE.signup.test(href)) view = 'signup';
    else if (HREF_VIEW_RE.account.test(href)) view = 'account';
    else if (HREF_VIEW_RE.activities.test(href)) view = 'activities';
    else if (HREF_VIEW_RE.contents.test(href)) view = 'contents';
    else if (HREF_VIEW_RE.forgot.test(href)) view = 'forgot';
    if (!view) return;
    e.preventDefault();
    if (isOpen()) swap(view); else open(view, { triggerEl: a });
    // "Giriş Yap" veya "Üye Ol" tıklandığında oturum zaten açıksa (ör. auth-nav.js'in header'ı henüz
    // güncellemediği kısa an, bookmark/eski sekme ya da footer'daki statik link) o görünüm yerine
    // Hesabım'a geçilir (bkz. kullanıcı isteği). gerçek bulgu (2026-08-14): bu kontrol eskiden popup'ı
    // AÇMADAN ÖNCE bekleniyordu — /api/auth/me yavaş/gecikmeli olduğunda popup tıklamadan saniyelerce
    // sonra açılıyor, hatta hiç açılmıyormuş gibi görünüyordu ("bazen yavaş açılıyor/takılıyor"). Artık
    // her modal gibi (bkz. project-modal.js#open AYNI desen) önce popup ANINDA açılır, oturum kontrolü
    // arka planda yapılır; zaten girişliyse sessizce Hesabım'a geçilir.
    if (view === 'login' || view === 'signup') {
      fetch('/api/auth/me').then(r => { if (r.ok) swap('account'); }).catch(() => {});
    }
  });

  window.addEventListener('popstate', () => {
    const view = pathToView(location.pathname);
    if (view) { handlePopState(view); return; }
    if (isOpen()) handlePopState(null);
  });

  // Doğrudan URL ile açılış (F5/deep-link) — bkz. kullanıcı isteği: "Sayfa yenilendiğinde veya
  // doğrudan URL'ye gidildiğinde modal açık olarak render edilsin".
  const initialView = pathToView(location.pathname);
  if (initialView) open(initialView, { pushHistory: false });

  return { open, swap, close, handlePopState, isOpen };
})();
// window.AuthModal — üst satırdaki `const AuthModal` klasik <script> global scope'unda kalır,
// window'un ÖZELLİĞİ değildir; js/components/lazy-modals.js bu modülü dinamik <script> enjeksiyonuyla
// SONRADAN yüklediğinde onload callback'i içinden window.AuthModal ile erişebilmesi için eklenir.
window.AuthModal = AuthModal;
