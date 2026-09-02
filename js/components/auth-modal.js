// AuthModal — Giriş Yap/Üye Ol/Hesabım'ı giris-yap.html/uye-ol.html/hesabim.html'in kendi
// tasarımını BİREBİR koruyarak (bkz. kullanıcı isteği) js/components/modal-shell.js üzerinde bir
// popup'a dönüştürür — proje/mimar/firma/ürün modallarıyla AYNI open/swap/close/handlePopState
// state machine deseni (bkz. project-modal.js). Üç görünüm ('login'/'signup'/'account') TEK bir
// ModalShell mount'unu paylaşır; modal-shell'in 32/68 sol/sağ ızgarası bu içerik için yanlış şekil
// olduğundan (ortalı bir kart / tam genişlik dashboard) tek sütuna geçilir (bkz. #am-panel altındaki
// .modal-shell-body.am-single kuralı). Bu dosya HER sayfada (bkz. kullanıcı isteği: "Header'daki
// butonlar") modal-shell.js'ten HEMEN sonra <script defer> ile dahil edilir; giriş noktaları
// (nav/footer/auth-nav.js'in ürettiği mevcut href="/giris"/"uye-ol.html"/"hesabim.html"
// linkleri) HİÇ değiştirilmedi — bunun yerine burada TEK bir delege edilmiş click dinleyicisiyle
// yakalanıp preventDefault edilir (bkz. aşağısı).
const AuthModal = (function () {
  const VIEW_PATH = { login: '/giris', signup: '/uye-ol', account: '/hesabim', activities: '/aktivitelerim', contents: '/iceriklerim', collections: '/koleksiyonum', forgot: '/sifremi-unuttum' };
  // ESKİ (*.html) bağlantı biçimi — artık sitede hiç üretilmiyor ama bookmark/eski sekme/harici
  // bağlantılar hâlâ bu biçimde gelebildiğinden tanınmaya devam eder. KANONİK temiz yollar
  // (VIEW_PATH'in kendisi) pathToView ile eşlenir, bkz. hrefToView.
  const HREF_VIEW_RE = { login: /(^|\/)giris-yap\.html$/, signup: /(^|\/)uye-ol\.html$/, account: /(^|\/)hesabim\.html$/, activities: /(^|\/)aktivitelerim\.html$/, contents: /(^|\/)iceriklerim\.html$/, collections: /(^|\/)koleksiyonum\.html$/, forgot: /(^|\/)sifremi-unuttum\.html$/ };

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
  // önceden hep orijinal çözünürlükte isteniyordu). Yüklüyse (proje.html/kisi.html/firma.html/
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
    #am-panel{ font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:var(--ink); }
    #am-panel .auth-wrap{max-width:420px; margin:0 auto; padding:8px 4px 24px;}
    #am-panel .auth-eyebrow{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:12px; letter-spacing:0.14em; text-transform:uppercase; color:var(--sage); font-weight:600; margin-bottom:12px; text-align:center;}
    #am-panel .auth-title{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:30px; font-weight:700; margin:0 0 8px; text-align:center;}
    #am-panel .auth-sub{color:var(--ink-soft); font-size:14px; margin:0 0 32px; text-align:center;}
    #am-panel .auth-card{background:var(--paper-card); border:1px solid var(--line); border-radius:16px; padding:28px;}
    #am-panel .auth-field{margin-bottom:16px;}
    #am-panel .auth-field label{display:block; font-size:13px; font-weight:600; margin-bottom:6px;}
    #am-panel .auth-field input, #am-panel .auth-field select{width:100%; padding:11px 14px; border-radius:10px; border:1px solid var(--line); background:var(--paper); font-family:inherit; font-size:14px; color:var(--ink);}
    #am-panel .auth-field input:focus-visible, #am-panel .auth-field select:focus-visible{box-shadow:0 0 0 2px var(--brass);}
    /* Çoklu meslek seçimi (kullanıcı isteği, 2026-09-01 madde 6) — uye-ol.html#.auth-check-group ile
       AYNI görünüm. Üye Ol formunda VE Profili Düzenle formunda aynı sınıf kullanılır; ikincisi
       .auth-field'ın DIŞINDA olduğundan (satır-içi stilli ayrı bir <div>) width:100% kuralı buraya
       ayrıca yazılır. .am-check-group input'un width:auto'su, yukarıdaki genel input{width:100%}
       kuralını ezmek için ZORUNLU (aksi halde her onay kutusu satırı kaplar). */
    #am-panel .am-check-group{
      display:flex; flex-wrap:wrap; gap:6px 14px; width:100%; box-sizing:border-box;
      max-height:132px; overflow-y:auto;
      padding:10px 12px; border:1px solid var(--line); border-radius:10px; background:var(--paper);
    }
    #am-panel .am-check-group label{display:flex; align-items:center; gap:6px; margin:0; font-size:13px; font-weight:500; cursor:pointer;}
    #am-panel .am-check-group input{width:auto; margin:0; padding:0;}
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
    #am-panel .dash-avatar{width:64px; height:64px; border-radius:50%; flex-shrink:0; overflow:hidden; background:var(--walnut); color:var(--paper-card); display:flex; align-items:center; justify-content:center; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-weight:600; font-size:20px;}
    #am-panel .dash-avatar img{width:100%; height:100%; object-fit:cover;}
    #am-panel .dash-head-info{display:flex; align-items:center; justify-content:space-between; gap:18px; flex:1; min-width:0;}
    #am-panel .dash-head h1{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:26px; font-weight:700; margin:0 0 4px;}
    #am-panel .dash-head p{color:var(--ink-soft); font-size:13.5px; margin:0;}
    #am-panel .dash-edit-btn{flex-shrink:0; background:none; border:1.5px solid var(--ink); color:var(--ink); padding:10px 20px; border-radius:100px; font-weight:600; font-size:13.5px;}
    #am-panel .dash-edit-btn:hover{background:var(--ink); color:var(--paper-card);}
    /* Hesabım başlık satırı — accountTemplate() özelinde .dash-head-info YERİNE bu (bkz. kullanıcı
       isteği: mobilde "Profili Düzenle" avatarın yanında üst satırda, "Aktivitelerim"/"İçeriklerim"
       başlığın ALTINDA ayrı bir satırda kalsın). activitiesTemplate()/contentsTemplate() hâlâ eski
       .dash-head-info'yu kullanıyor, bu yeni sınıf sadece Hesabım'ın kendi başlığını etkiler — aynı
       özgüllükte (1,1,0) olduğundan ve BURADA (.dash-head kuralından SONRA) tanımlandığından, çakışan
       display/gap/align-items kaynak sırasıyla kazanır, margin-bottom/flex-wrap gibi tekrar
       yazılmayanlar .dash-head'den miras kalır. */
    #am-panel .dash-head-account{display:flex; align-items:center; gap:18px;}
    #am-panel .dash-head-titles{flex:1; min-width:0;}
    /* ---------- DÖRTLÜ SAYFA GEÇİŞ SATIRI (.dash-nav-row) ----------
       kullanıcı isteği (2026-08-31, madde 1 ve 3): Hesabım/Aktivitelerim/Koleksiyonum/İçeriklerim
       popup'larından birinin içindeyken DİĞER ÜÇÜ, kendi ayrı satırında değil, popup'ın KAPATMA (X)
       düğmesiyle AYNI satırda dursun; üçü tek satırda, yan yana, birbirine EŞİT aralıklarla ve
       yatayda ortalanmış olsun — dar ekranlarda taşmadan (gerekirse butonlar küçülerek).
       Bu yüzden satır artık #am-panel'in İÇİNDE değil, barındırıcının başlık yuvasında yaşıyor
       (masaüstünde modal-shell.js#.modal-shell-header-center, tablet/mobilde site-chrome.js#
       .nav-mobile-menu-head-center — bkz. mountDashNav) ve kuralları da bu yüzden #am-panel'e
       DEĞİL doğrudan .dash-nav-row'a bağlanır. .dash-edit-btn'in görünümü de burada bağımsız olarak
       tanımlanır (eskiden #am-panel .dash-edit-btn'den miras alınıyordu, o kural artık yalnızca
       "Profili Düzenle" butonunu kapsıyor).
       flex + gap: "eşit aralık" isteğinin doğrudan karşılığı (gap her iki boşlukta da aynı);
       flex-wrap:nowrap satırın alt satıra kaçmasını, min-width:0 ise dar ekranda başlık satırının
       çekmeceden/panelden taşmasını engeller. Yükseklik 36px — modal-shell.js'teki X düğmesi ve
       Kaydet/Paylaş aksiyonlarıyla AYNI değer, "aynı satırda" görünümü ancak böyle tutarlı olur. */
    .dash-nav-row{
      display:flex; flex-direction:row; flex-wrap:nowrap; align-items:center;
      justify-content:center; gap:10px; min-width:0; max-width:100%;
    }
    .dash-nav-row .dash-edit-btn{
      flex:0 1 auto; min-width:0; box-sizing:border-box;
      display:inline-flex; align-items:center; justify-content:center;
      height:36px; padding:0 18px; border-radius:100px;
      background:none; border:1.5px solid var(--ink); color:var(--ink);
      font-family:inherit; font-weight:600; font-size:13px; line-height:1;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer;
    }
    .dash-nav-row .dash-edit-btn:hover{background:var(--ink); color:var(--paper-card);}
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
    #am-panel .dash-section h2{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:17px; font-weight:700; margin:0 0 4px;}
    /* kullanıcı isteği (2026-09-01): "Profili Düzenle" ARTIK sayfa başlığında (avatarın yanında)
       DEĞİL — Profil Bilgileri ve Firma Bilgileri kutularının KENDİ başlıklarının yanında AYRI AYRI
       birer buton olarak duruyor. Kutu başlığı bu yüzden h2 + butonu aynı satırda taşıyan bir flex
       satır oldu. .dash-edit-btn-sm: aynı hap/çerçeve görünümü, ama 17px'lik kutu başlığının yanında
       orantılı kalması için küçültülmüş; <a> olarak da kullanıldığından (Firma Bilgileri butonu
       doğrudan /firma-ekle'ye gider) inline-flex + text-decoration:none burada ayrıca verilir. */
    #am-panel .dash-section-head{display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:4px;}
    #am-panel .dash-section-head h2{margin:0;}
    #am-panel .dash-edit-btn-sm{display:inline-flex; align-items:center; justify-content:center; padding:7px 14px; font-size:12.5px; text-decoration:none; white-space:nowrap; cursor:pointer;}
    #am-panel .dash-section .section-hint{font-size:12.5px; color:var(--ink-soft); margin:0 0 16px;}
    #am-panel .dash-empty{border:1px dashed var(--line); border-radius:12px; padding:24px; text-align:center; color:var(--ink-soft); font-size:13px; line-height:1.6;}
    #am-panel .dash-empty a{color:var(--walnut); font-weight:600;}
    #am-panel .dash-empty a:hover{text-decoration:underline;}
    #am-panel .profile-fact{display:flex; gap:10px; padding:10px 0; border-bottom:1px solid var(--line-soft); font-size:13px;}
    #am-panel .profile-fact:last-child{border-bottom:none;}
    #am-panel .profile-fact-label{color:var(--ink-soft); flex:0 0 110px;}
    #am-panel .profile-fact-value{font-weight:600;}
    #am-panel .profile-fact-avatar{width:32px; height:32px; border-radius:50%; object-fit:cover; flex-shrink:0; display:block;}
    #am-panel .profile-fact-avatar-fallback{display:flex; align-items:center; justify-content:center; background:var(--walnut); color:var(--paper-card); font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-weight:600; font-size:11px;}
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
    #am-panel .notif-del{align-self:center;}
    /* Mesajlar kutusu — Instagram/Messenger'daki gibi kişi/konuşma başına tek satır (avatar + isim +
       son mesaj önizlemesi + zaman), bkz. kullanıcı isteği (2026-08-30) ve yukarıdaki renderMessages(). */
    #am-panel .msg-conv-row{display:flex; align-items:center; gap:12px; padding:12px 0; border-bottom:1px solid var(--line-soft); cursor:pointer;}
    #am-panel .msg-conv-row:last-child{border-bottom:none;}
    #am-panel .msg-conv-row.unread{background:rgba(224,138,62,0.07); margin:0 -10px; padding:12px 10px; border-radius:10px;}
    #am-panel .msg-conv-avatar{width:44px; height:44px; border-radius:50%; flex-shrink:0; overflow:hidden; background:var(--walnut); color:var(--paper-card); display:flex; align-items:center; justify-content:center; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-weight:600; font-size:15px;}
    #am-panel .msg-conv-avatar img{width:100%; height:100%; object-fit:cover;}
    #am-panel .msg-conv-body{flex:1; min-width:0;}
    #am-panel .msg-conv-name{font-size:13.5px; font-weight:600;}
    #am-panel .msg-conv-preview{font-size:12.5px; color:var(--ink-soft); margin-top:2px; line-height:1.5; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
    #am-panel .msg-conv-row.unread .msg-conv-name{font-weight:700;}
    #am-panel .msg-conv-row.unread .msg-conv-preview{color:var(--ink); font-weight:500;}
    #am-panel .msg-conv-dot{display:block; width:8px; height:8px; border-radius:50%; background:var(--accent); flex-shrink:0;}
    /* Mesaj konuşması popup'ı — bkz. kullanıcı isteği: Bildirimler ve Mesajlar'daki bir mesaja
       tıklayınca açılan, tam geçmiş + cevap kutusu içeren overlay. Hesabım'ın kendi #am-panel'i
       zaten z-index:200'de durduğundan (bkz. yukarıdaki .profile-edit-overlay kuralı) bunun üstüne
       binmesi için daha yüksek bir z-index gerekir — js/components/message-button.js#
       .msg-compose-overlay İLE AYNI değer (220). */
    .am-thread-overlay{
      display:flex; position:fixed; inset:0; z-index:220; align-items:flex-start; justify-content:center;
      background:rgba(27,42,61,0.55); padding:40px 16px; overflow-y:auto;
    }
    .am-thread-panel{
      width:100%; max-width:480px; background:var(--paper-card); border-radius:16px;
      padding:26px; box-shadow:0 24px 60px rgba(27,42,61,0.3); position:relative;
    }
    .am-thread-close{
      position:absolute; top:16px; right:16px; width:32px; height:32px; border-radius:50%;
      border:none; background:var(--paper-alt); color:var(--ink-soft); font-size:18px;
      display:flex; align-items:center; justify-content:center; cursor:pointer; line-height:1;
    }
    .am-thread-close:hover{color:var(--ink);}
    .am-thread-title{font-size:18px; font-weight:700; margin:0 0 14px; color:var(--ink); padding-right:30px;}
    .am-thread-sender{border:1px solid var(--line); border-radius:12px; padding:10px 12px; margin-bottom:14px; font-size:12.5px;}
    .am-thread-sender-row{display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; color:var(--ink);}
    .am-thread-sender-row strong{font-size:13.5px;}
    .am-thread-sender-row span{color:var(--ink-soft);}
    .am-thread-sender-extra{margin-top:3px; color:var(--ink-soft);}
    .am-thread-messages{display:flex; flex-direction:column; gap:12px; max-height:340px; overflow-y:auto; margin-bottom:14px;}
    .am-thread-msg{border-radius:12px; padding:10px 12px; background:var(--paper-alt);}
    .am-thread-msg.me{background:rgba(224,138,62,0.1);}
    .am-thread-msg-meta{font-size:11px; color:var(--ink-soft); margin-bottom:4px;}
    .am-thread-msg-body{font-size:13.5px; color:var(--ink); line-height:1.55; white-space:pre-wrap;}
    .am-thread-reply-form textarea{
      width:100%; box-sizing:border-box; border:1px solid var(--line); border-radius:10px;
      padding:10px 12px; font-size:13.5px; font-family:inherit; color:var(--ink); background:var(--paper-card);
      min-height:80px; resize:vertical;
    }
    .am-thread-reply-form textarea:focus{outline:none; border-color:var(--walnut);}
    .am-thread-reply-actions{display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:10px;}
    .am-thread-end-btn{background:none; border:none; color:#B84C4C; font-weight:600; font-size:12.5px; padding:0; cursor:pointer;}
    .am-thread-send-btn{border:none; border-radius:100px; background:var(--walnut); color:#fff; font-size:13.5px; font-weight:700; padding:10px 20px; cursor:pointer; font-family:inherit;}
    .am-thread-send-btn:disabled{opacity:0.6; cursor:default;}
    .am-thread-closed-note{font-size:12.5px; color:var(--ink-soft); text-align:center; margin:6px 0 0;}
    .am-thread-reopen-btn{display:block; margin:10px auto 0; border:none; border-radius:100px; background:var(--walnut); color:#fff; font-size:13px; font-weight:700; padding:9px 18px; cursor:pointer; font-family:inherit;}
    .am-thread-reopen-btn:disabled{opacity:0.6; cursor:default;}
    .am-thread-error{font-size:12.5px; color:#B3261E; margin-top:8px; text-align:center;}
    #am-panel .dash-field{margin-bottom:12px;}
    #am-panel .dash-field label{display:block; font-size:12.5px; font-weight:600; margin-bottom:5px;}
    #am-panel .dash-field input{width:100%; padding:10px 12px; border-radius:9px; border:1px solid var(--line); background:var(--paper); font-family:inherit; font-size:13.5px; color:var(--ink);}
    /* kisi-ekle.html#dd-field ile BİREBİR aynı açılır çoklu-seçim widget'ı (bkz. kullanıcı isteği:
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
    #am-panel .avatar-upload-preview{width:56px; height:56px; border-radius:50%; flex-shrink:0; overflow:hidden; background:var(--walnut); color:var(--paper-card); display:flex; align-items:center; justify-content:center; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-weight:600; font-size:18px;}
    #am-panel .avatar-upload-preview img{width:100%; height:100%; object-fit:cover;}
    #am-panel .avatar-upload-btn{background:none; border:1.5px solid var(--ink); color:var(--ink); padding:8px 16px; border-radius:100px; font-weight:600; font-size:12.5px;}
    #am-panel .avatar-upload-btn:hover{background:var(--ink); color:var(--paper-card);}
    #am-panel .avatar-upload-hint{font-size:11.5px; color:var(--ink-soft); margin-top:6px;}
    #am-panel .badge-grid{display:grid; grid-template-columns:1fr 1fr; gap:10px;}
    #am-panel .badge-card{border:1px solid var(--line-soft); border-radius:12px; padding:14px;}
    #am-panel .badge-card-name{font-weight:600; font-size:13.5px; margin-bottom:2px;}
    #am-panel .badge-card-price{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:12px; color:var(--sage); margin-bottom:10px;}
    #am-panel .badge-buy-btn{display:block; width:100%; text-align:center; background:var(--ink); color:var(--paper-card); border:none; padding:8px; border-radius:100px; font-weight:600; font-size:12px;}
    #am-panel .badge-buy-btn:hover{background:var(--walnut);}
    #am-panel .badge-status-pill{display:inline-block; font-size:10.5px; font-weight:700; text-transform:uppercase; padding:3px 9px; border-radius:100px; flex-shrink:0;}
    #am-panel .my-badge-row{display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 14px; border:1px solid var(--line-soft); border-radius:12px; margin-bottom:8px; font-size:13.5px;}
    #am-panel .my-badge-row:last-child{margin-bottom:0;}
    #am-panel .am-badge-icon{position:relative; cursor:pointer;}
    #am-panel .am-badge-tooltip{position:absolute; bottom:calc(100% + 7px); left:50%; transform:translateX(-50%); background:var(--ink); color:var(--paper-card); font-size:11px; font-weight:600; white-space:nowrap; padding:4px 9px; border-radius:6px; opacity:0; visibility:hidden; pointer-events:none; transition:opacity .15s; z-index:20;}
    #am-panel .am-badge-icon:hover .am-badge-tooltip,
    #am-panel .am-badge-icon.am-badge-tooltip-show .am-badge-tooltip{opacity:1; visibility:visible;}
    /* ---------- KOLEKSİYONUM (kullanıcı isteği, 2026-08-31) ----------
       Pinterest benzeri panolar. Iskelet .dash-wrap/.dash-section'dan miras alınır (İçeriklerim ile
       BİREBİR aynı sayfa çerçevesi istendi), yalnızca pano/kart ızgaraları burada tanımlanır.
       DİKKAT: bu template literal içinde ters tırnak ya da yorum işareti KULLANMA (bkz. proje
       notu: enjekte edilen CSS sessizce bozulur). */
    #am-panel .col-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:16px;}
    #am-panel .col-card{display:block; width:100%; text-align:left; border:1px solid var(--line-soft); border-radius:14px; overflow:hidden; background:var(--paper); padding:0;}
    #am-panel .col-card:hover{border-color:var(--walnut);}
    #am-panel .col-card-mosaic{display:grid; grid-template-columns:1fr 1fr; grid-template-rows:1fr 1fr; gap:2px; aspect-ratio:4/3; background:var(--paper-alt);}
    #am-panel .col-card-mosaic span{display:block; background:var(--paper-alt) center/cover no-repeat;}
    #am-panel .col-card-mosaic.col-card-mosaic-single{grid-template-columns:1fr; grid-template-rows:1fr;}
    #am-panel .col-card-empty{display:flex; align-items:center; justify-content:center; aspect-ratio:4/3; background:var(--paper-alt); color:var(--ink-soft); font-size:12px;}
    #am-panel .col-card-body{padding:12px 14px;}
    #am-panel .col-card-title{font-weight:600; font-size:13.5px; margin-bottom:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
    #am-panel .col-card-count{font-size:11.5px; color:var(--ink-soft);}
    #am-panel .col-toolbar{display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:16px;}
    #am-panel .col-btn{padding:8px 16px; border-radius:100px; border:1.5px solid var(--ink); background:none; color:var(--ink); font-weight:600; font-size:12.5px;}
    #am-panel .col-btn:hover{background:var(--ink); color:var(--paper-card);}
    #am-panel .col-btn-primary{background:var(--ink); color:var(--paper-card);}
    #am-panel .col-btn-primary:hover{background:var(--walnut); border-color:var(--walnut);}
    #am-panel .col-btn-danger{border-color:#B84C4C; color:#B84C4C;}
    #am-panel .col-btn-danger:hover{background:#B84C4C; color:var(--paper-card);}
    #am-panel .col-new-row{display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:16px;}
    #am-panel .col-new-row input{flex:1; min-width:180px; padding:10px 14px; border:1px solid var(--line); border-radius:10px; background:var(--paper); color:var(--ink); font-size:13.5px; font-family:inherit;}
    #am-panel .col-item-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(170px,1fr)); gap:14px;}
    #am-panel .col-item{position:relative; border:1px solid var(--line-soft); border-radius:12px; overflow:hidden; background:var(--paper);}
    #am-panel .col-item-media{display:block; width:100%; aspect-ratio:4/3; object-fit:cover; background:var(--paper-alt);}
    /* Üst padding, kartın sol üstündeki sıra oklarına ve sağ üstündeki silme butonuna yer açar —
       görselli kartlarda bu kontroller görselin üzerine biner, notta binecek bir görsel olmadığından
       metnin altlarından başlaması gerekir (yerel doğrulamada yakalandı). */
    #am-panel .col-item-note{padding:42px 14px 14px; font-size:13px; line-height:1.55; white-space:pre-wrap; word-break:break-word;}
    #am-panel .col-item-body{padding:10px 12px;}
    #am-panel .col-item-title{font-weight:600; font-size:12.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
    #am-panel .col-item-title a{color:inherit; text-decoration:none;}
    #am-panel .col-item-title a:hover{text-decoration:underline;}
    #am-panel .col-item-meta{font-size:11px; color:var(--ink-soft); margin-top:1px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
    #am-panel .col-item-remove{position:absolute; top:8px; right:8px; width:26px; height:26px; border-radius:50%; border:none; background:rgba(27,42,61,0.72); color:#fff; font-size:13px; line-height:1; display:flex; align-items:center; justify-content:center;}
    #am-panel .col-item-remove:hover{background:#B84C4C;}
    /* Sıra değiştirme okları (kullanıcı isteği, 2026-08-31) — kartın SOL üstünde, silme butonuyla
       aynı görsel dilde. Sürükle-bırak yerine ok butonları: dokunmatikte de, klavyeyle de
       calisir ve mevcut ızgara/kaydırma davranışını hiç bozmaz. */
    #am-panel .col-item-move{position:absolute; top:8px; left:8px; display:flex; gap:4px;}
    #am-panel .col-item-move button{width:26px; height:26px; border-radius:50%; border:none; background:rgba(27,42,61,0.72); color:#fff; font-size:13px; line-height:1; display:flex; align-items:center; justify-content:center;}
    #am-panel .col-item-move button:hover:not(:disabled){background:var(--walnut);}
    #am-panel .col-item-move button:disabled{opacity:0.35;}
    #am-panel .col-add-panel{border:1px dashed var(--line); border-radius:12px; padding:16px; margin-bottom:18px;}
    #am-panel .col-add-panel textarea{width:100%; box-sizing:border-box; min-height:80px; padding:10px 12px; border:1px solid var(--line); border-radius:10px; background:var(--paper); color:var(--ink); font-size:13px; font-family:inherit; resize:vertical;}
    #am-panel .col-saved-picker{display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:10px; max-height:320px; overflow-y:auto; margin-top:12px;}
    #am-panel .col-saved-option{display:block; width:100%; text-align:left; border:1px solid var(--line-soft); border-radius:10px; overflow:hidden; background:var(--paper); padding:0;}
    #am-panel .col-saved-option:hover{border-color:var(--walnut);}
    #am-panel .col-saved-option img{display:block; width:100%; aspect-ratio:4/3; object-fit:cover; background:var(--paper-alt);}
    #am-panel .col-saved-option-title{padding:8px 10px; font-size:12px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
    #am-panel .col-notice{font-size:12.5px; color:var(--walnut); margin-top:10px; min-height:1em;}
    @media (max-width:480px){ #am-panel .badge-grid{grid-template-columns:1fr;} }
    /* Geçiş butonları tablet/mobilde küçülür (bkz. kullanıcı isteği, 2026-08-31 madde 3: "Sayfanın
       dışına taşmasınlar gerekirse butonların büyüklükleri küçülsün") — satır YAPISI değişmez, üçü
       hâlâ tek satırda ve eşit aralıkta. Bu kırılma noktalarında satır çekmecenin başlığında,
       "‹ Menü" breadcrumb'ı ile X arasında kalan boşlukta yaşıyor; o boşluk viewport daraldıkça
       hızla küçüldüğünden üç kademe gerekiyor. Etiketleri kısaltmak yerine punto/boşluk küçültülür —
       kırpılmış bir etiket okunmaz bir sonuç olurdu (yerel ölçümle doğrulandı). */
    @media (max-width:960px){
      .dash-nav-row{gap:8px;}
      .dash-nav-row .dash-edit-btn{height:32px; padding:0 12px; font-size:12px;}
    }
    @media (max-width:560px){
      .dash-nav-row{gap:6px;}
      .dash-nav-row .dash-edit-btn{height:30px; padding:0 8px; font-size:11px; border-width:1px;}
    }
    @media (max-width:430px){
      .dash-nav-row{gap:4px;}
      .dash-nav-row .dash-edit-btn{height:28px; padding:0 4px; font-size:10px; letter-spacing:-0.1px;}
    }
    /* 360px ve altı (iPhone SE sınıfı) — "Aktivitelerim" bu genişlikte 10px'te bile kırpılıyordu
       (yerel ölçüm: sütun başına ~3px eksik kalıyordu). */
    @media (max-width:360px){
      .dash-nav-row{gap:2px;}
      .dash-nav-row .dash-edit-btn{height:26px; padding:0 3px; font-size:9px;}
    }
    @media (max-width:720px){
      #am-panel .dash-head-info{flex-direction:column; align-items:flex-start; gap:10px; flex-basis:100%; width:100%;}
      /* Hesabım başlığı artık YALNIZCA avatar + isim taşıyor — "Profili Düzenle" (kullanıcı isteği,
         2026-09-01) Profil Bilgileri kutusunun başlığına taşındığından buradaki eski üç alanlı grid
         (avatar/edit/titles) gereksiz kaldı; mobilde de masaüstündeki AYNI tek satır korunur. */
      #am-panel .dash-head-account{gap:12px;}
      /* Kutu başlığındaki buton dar ekranda başlığı ezmesin: başlık ile buton alt alta düşer. */
      #am-panel .dash-section-head{flex-wrap:wrap; gap:8px;}
    }
    @media (max-width:860px){ #am-panel .dash-row{grid-template-columns:1fr; gap:20px;} }
    /* .col-two-col — masaüstünde VE tablette iki sütun kalması istenen satırlar: Koleksiyonum
       (Panolarım + Kaydettiklerim) ve Aktivitelerim'in İKİ satırı da (Takip Ettiklerim|Beğendiklerim,
       Yorumlarım|Paylaştıklarım — bkz. kullanıcı isteği 2026-08-31 madde 1). Bu iki kural yukarıdaki
       860px kuralından SONRA geldiğinden (aynı özgüllük, kaynak sırası kazanır) onu ezer. 620px
       altında telefon genişliğine inilir ve tek sütuna düşülür. */
    #am-panel .dash-row.col-two-col{grid-template-columns:1fr 1fr;}
    @media (max-width:620px){ #am-panel .dash-row.col-two-col{grid-template-columns:1fr;} }
    /* İki sütunlu bir satırda TEK başına kalan kutu (Aktivitelerim > Paylaştıklarım, Koleksiyonum >
       Takip Ettiklerim) — yarım sütunda asılı kalmasın diye iki sütunu birden kaplar. */
    #am-panel .dash-row.col-two-col > .dash-section-wide{grid-column:1 / -1;}
    /* "Yeni" bildirimi (kullanıcı isteği, 2026-09-01 madde 2: "Takip edilenler kutusunda yeni bir
       gönderi eklendiği zaman hemen yanında yeni eklendiğine dair bir bildirim olsun") — kutu
       başlığının yanında toplam sayı, ilgili satırın başlığının yanında da tek tek rozet. */
    #am-panel .dash-new-count{
      display:inline-block; vertical-align:middle; margin-left:8px;
      background:var(--accent); color:#fff; font-family:inherit; font-size:11px; font-weight:700;
      line-height:1; padding:4px 9px; border-radius:100px;
    }
    /* [hidden] KURALI ŞART (yerel testte yakalandı): tarayıcının kendi [hidden]{display:none}
       UA kuralı (0,0,1) yukarıdaki display:inline-block'un (1,1,0) altında kalıyor — bu satır
       olmadan rozet "0 yeni" olarak HER ZAMAN görünür kalıyordu. */
    #am-panel .dash-new-count[hidden]{display:none;}
    #am-panel .saved-row-new{
      display:inline-block; margin-left:7px; background:var(--accent); color:#fff;
      font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em;
      line-height:1; padding:3px 7px; border-radius:100px; vertical-align:middle;
    }
    /* İki sütuna sıkışınca pano kartları için minmax(190px) fazla geniş kalıyor — sütun içinde
       en az iki kart yan yana sığsın diye bu görünümde daraltılır. */
    #am-panel .col-two-col .col-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:12px;}

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
          <p class="auth-forgot"><a href="/sifremi-unuttum">Şifremi unuttum</a></p>
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
  // autocomplete kutusunun id'si kisi-ekle.html'deki #ac-school-suggestions ile ÇAKIŞMASIN diye
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
          <!-- Çoklu meslek (kullanıcı isteği, 2026-09-01 madde 6) — uye-ol.html'deki AYNI onay
               kutusu grubu; o sayfa ile bu popup aynı formun iki kopyasıdır (bkz. dosya başı
               yorumu), ikisi birlikte güncellenir. -->
          <div class="auth-field">
            <label id="am-signup-profession-label">Meslek <span style="font-weight:400; color:var(--ink-soft);">(birden fazla seçebilirsin)</span></label>
            <div class="am-check-group" id="am-signup-profession" role="group" aria-labelledby="am-signup-profession-label">
              ${professionCheckboxesHtml('am-signup-profession-cb')}
            </div>
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
      // Baştan eşleşenler ÖNCE (kullanıcı isteği: "ilk harfleri yazmaya başladığında ilgili
      // olanlar çıksın") — liste artık Türkiye'deki tüm üniversiteleri taşıdığından (bkz.
      // /api/architects/schools) saf "içinde geçiyor mu" sıralaması "Yıldız" yazan birine önce
      // "Ankara Yıldırım Beyazıt"ı gösterebiliyordu. İçinde geçenler atılmaz, arkaya alınır.
      const starts = schoolItems.filter(it => trLower(it).startsWith(q));
      const matches = starts.concat(schoolItems.filter(it => !trLower(it).startsWith(q) && trLower(it).includes(q))).slice(0, 8);
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
        // Çoklu meslek (bkz. getProfessionChecks / src/routes/auth.js#normalizeProfessions).
        profession: getProfessionChecks('am-signup-profession') || null,
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
  // dashNavRow(current): Hesabım/Aktivitelerim/Koleksiyonum/İçeriklerim popup'larının HEPSİNDE
  // görünen, içinde bulunulan sayfa HARİÇ diğer ÜÇÜNÜ taşıyan geçiş satırı (bkz. kullanıcı isteği,
  // 2026-08-31 madde 3). Dört şablonda dört kez elle yazmak yerine tek kaynaktan üretilir — böylece
  // sıra/etiket/stil ve "içinde bulunduğunu gösterme" kuralı dördünde de zorunlu olarak aynı kalır.
  // Butonlar data-am-nav taşır, her mount kendi delegated dinleyicisiyle bağlar (bkz. mountDashNav)
  // — sabit id'lere gerek yok, dört şablonda çakışan id üretme riski de kalkar.
  //
  // KONUM (kullanıcı isteği, 2026-08-31 madde 1 ve 3): bu satır artık .dash-wrap'in İÇİNDE, ayrı bir
  // satır olarak DEĞİL, barındırıcının BAŞLIK satırında — masaüstünde ModalShell'in X'iyle aynı
  // satırda, panelin yatay ortasında (bkz. modal-shell.js#getHeaderCenterSlot); tablet/mobilde ise
  // çekmecenin "‹ Menü" breadcrumb'ı ile X'i arasında (bkz. site-chrome.js#getHeadCenterEl). Bu
  // yüzden şablonlar onu artık HİÇ basmaz, mount tarafında (bkz. mountDashNav, renderView'in sonunda
  // çağrılır) doğru yuvaya yazılır.
  const DASH_NAV_VIEWS = [
    { view: 'account', label: 'Hesabım' },
    { view: 'activities', label: 'Aktivitelerim' },
    { view: 'collections', label: 'Koleksiyonum' },
    { view: 'contents', label: 'İçeriklerim' },
  ];
  // Geçiş satırının GÖRÜNDÜĞÜ dört görünüm — login/signup/forgot'ta yuva boş bırakılır (o üç
  // görünümde geçilecek bir "diğer üç sayfa" yok).
  const DASH_NAV_VIEW_KEYS = DASH_NAV_VIEWS.map(v => v.view);
  function dashNavRowHtml(current) {
    const others = DASH_NAV_VIEWS.filter(v => v.view !== current);
    return `<div class="dash-nav-row">${others
      .map(v => `<button type="button" class="dash-edit-btn" data-am-nav="${v.view}">${v.label}</button>`)
      .join('')}</div>`;
  }
  // Aktif barındırıcının başlık yuvasını her renderView'da KOŞULSUZ yeniden yazar (yuva paylaşılan,
  // uzun ömürlü bir DOM düğümü — şablonun aksine kendiliğinden sıfırlanmaz). Dinleyici yuvanın
  // KENDİSİNE bir kez bağlanır (data-navWired), böylece her mount'ta üst üste dinleyici birikmez.
  function mountDashNav(view, mobile) {
    const slot = mobile
      ? (window.NavDrawer && window.NavDrawer.getHeadCenterEl ? window.NavDrawer.getHeadCenterEl() : null)
      : ModalShell.getHeaderCenterSlot();
    if (!slot) return;
    slot.innerHTML = DASH_NAV_VIEW_KEYS.includes(view) ? dashNavRowHtml(view) : '';
    if (slot.dataset.navWired) return;
    slot.dataset.navWired = '1';
    slot.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-am-nav]');
      if (!btn || !slot.contains(btn)) return;
      swap(btn.dataset.amNav);
    });
  }

  function accountTemplate() {
    return `
    <div class="dash-wrap" id="am-dash-wrap">
      <div id="am-payment-success-banner" style="display:none; background:rgba(62,122,85,0.12); border:1px solid #3E7A55; color:var(--ink); font-size:13px; padding:13px 16px; border-radius:12px; margin-bottom:20px; line-height:1.6;">Ödemen alındı — rozetin aktif edildi.</div>
      <div class="dash-head dash-head-account">
        <div class="dash-avatar" id="am-dash-avatar">–</div>
        <div class="dash-head-titles">
          <h1 id="am-dash-title">Hoş Geldin</h1>
          <p id="am-dash-sub">—</p>
        </div>
      </div>

      <div class="profile-edit-overlay" id="am-profile-edit-overlay">
      <div class="dash-form" id="am-dash-edit-form" style="background:var(--paper-card); border:1px solid var(--line); border-radius:16px; padding:24px; margin-bottom:20px;">
        <button type="button" class="profile-edit-close" id="am-profile-edit-close" aria-label="Kapat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <h2 style="font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:17px; font-weight:700; margin:0 0 16px;">Profili Düzenle</h2>
        <div class="avatar-upload-row">
          <div class="avatar-upload-preview" id="am-avatar-preview">–</div>
          <div>
            <button type="button" class="avatar-upload-btn" id="am-avatar-upload-btn">Profil Fotoğrafı Yükle</button>
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
            <label id="am-edit-profession-label" style="display:block; font-size:12.5px; font-weight:600; margin-bottom:5px;">Meslek * <span style="font-weight:400; color:var(--ink-soft);">(birden fazla seçebilirsin)</span></label>
            <div class="am-check-group" id="am-edit-profession" role="group" aria-labelledby="am-edit-profession-label">
              ${professionCheckboxesHtml('am-edit-profession-cb')}
            </div>
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
               kapalı/açılır davranışı verir, kisi-ekle.html#dd-oduller ile BİREBİR aynı widget
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

        <!-- Kullanıcı isteği (2026-09-02 madde 4): Kaydet butonunun ÜSTÜNDE, kisi-ekle.html'deki
             ile AYNI soru ve AYNI varsayılan (Evet işaretli). Kayıt sonrası bildirimden "Evet"
             ile gelindiğinde bu grup zaten Evet'te olur; kullanıcı isterse Hayır'a çevirebilir.
             Değer architects.directory_listed'e yazılır (bkz. submitArchitectSyncIfNeeded). -->
        <div class="am-listing-consent" style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:12px 14px; margin:4px 0 16px; border:1px solid var(--line); border-radius:10px; background:var(--paper);">
          <span style="flex:1; min-width:0; font-size:13px;">Kişi sayfasında diğer profesyonellerle birlikte görünmek istiyor musunuz?</span>
          <span style="display:flex; align-items:center; gap:14px; flex-shrink:0;">
            <label style="display:inline-flex; align-items:center; gap:6px; font-size:13.5px; color:var(--ink-soft); cursor:pointer;"><input type="radio" name="am-directory-listed" value="yes" style="accent-color:var(--ink); width:15px; height:15px;"> Evet</label>
            <!-- Varsayılan HAYIR (kullanıcı isteği, 2026-09-02 madde 2): profil yayımlamak bilinçli
                 bir tercih olmalı; kullanıcı Evet demeden kişi dizinine düşmez. -->
            <label style="display:inline-flex; align-items:center; gap:6px; font-size:13.5px; color:var(--ink-soft); cursor:pointer;"><input type="radio" name="am-directory-listed" value="no" checked style="accent-color:var(--ink); width:15px; height:15px;"> Hayır</label>
          </span>
        </div>

        <button class="dash-edit-btn" id="am-dash-save-btn" style="margin-left:0; background:var(--ink); color:var(--paper-card);">Kaydet</button>
        <span id="am-dash-save-msg" style="font-size:12.5px; color:var(--ink-soft); margin-left:10px;"></span>

        <div style="border-top:1px solid var(--line); margin:22px 0 18px;"></div>
        <h2 style="font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:17px; font-weight:700; margin:0 0 16px;">Şifre Değiştir</h2>
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
        <h2 style="font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:17px; font-weight:700; margin:0 0 8px; color:#B3261E;">Hesabımı Sil</h2>
        <p style="margin:0 0 14px; font-size:12.5px; color:var(--ink-soft); max-width:520px;">Hesabını sildiğinde profilin, oturumların, kaydettiklerin ve bildirimlerin kalıcı olarak silinir. Bu işlem geri alınamaz.</p>
        <!-- Kullanıcı isteği (2026-09-02 madde 1): silme butonunun ÜSTÜNDE e-posta kutusu; kullanıcı
             giriş yaptığı adresi yazmadan hesabını silemez. Yanlışlıkla silmeye karşı gerçek bir
             sürtünme — tek başına confirm() diyaloğu bunu sağlamıyordu. Doğrulama İSTEMCİDE
             yapılır (sunucu zaten oturum sahibinden başkasının hesabını silemez, bkz.
             src/routes/auth.js#handleAccountDeleteRoute); buradaki amaç kasıt teyidi. -->
        <label for="am-delete-confirm-email" style="display:block; font-size:12.5px; font-weight:600; margin:0 0 5px;">Onaylamak için e-posta adresini yaz</label>
        <input type="email" id="am-delete-confirm-email" autocomplete="off" placeholder="ornek@eposta.com" style="width:100%; max-width:320px; padding:10px 12px; border-radius:9px; border:1px solid var(--line); background:var(--paper); font-family:inherit; font-size:13.5px; margin-bottom:10px;">
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <button type="button" class="dash-edit-btn" id="am-delete-account-btn" style="margin-left:0; background:#B3261E; color:#fff; border-color:#B3261E;">Hesabımı Sil</button>
          <span id="am-delete-account-msg" style="font-size:12.5px; color:#B3261E;"></span>
        </div>
      </div>
      </div>

      <!-- col-two-col: masaüstünde VE tablette iki sütun (kullanıcı isteği, 2026-09-01 madde 1:
           "Hesabım, Aktivitelerim, Koleksiyonum, İçeriklerim popuplarının hepsi masaüstü ve tablet
           görünümlerinde 2 sütunlu olsunlar") — Aktivitelerim/Koleksiyonum'un ZATEN kullandığı sınıf;
           .dash-row'un varsayılan 860px eşiği çekmecenin 90vw'lik tablet genişliğini tek sütuna
           düşürüyordu, bu sınıf eşiği 620px'e çeker (bkz. injectStyles'taki kural). -->
      <div class="dash-row col-two-col">
        <div class="dash-section">
          <div class="dash-section-head">
            <h2>Profil Bilgileri</h2>
            <button type="button" class="dash-edit-btn dash-edit-btn-sm" id="am-dash-edit-btn">Profili Düzenle</button>
          </div>
          <div id="am-profile-tab-facts">
            <div class="profile-fact"><span class="profile-fact-label">Ad Soyad</span><span class="profile-fact-value" id="am-fact-name">—</span></div>
            <div class="profile-fact"><span class="profile-fact-label">Doğum Tarihi</span><span class="profile-fact-value" id="am-fact-dob">—</span></div>
            <div class="profile-fact"><span class="profile-fact-label">Üniversite</span><span class="profile-fact-value" id="am-fact-school">—</span></div>
            <div class="profile-fact"><span class="profile-fact-label">Meslek</span><span class="profile-fact-value" id="am-fact-profession">—</span></div>
            <div class="profile-fact"><span class="profile-fact-label">Pozisyon</span><span class="profile-fact-value" id="am-fact-position">—</span></div>
            <div class="profile-fact"><span class="profile-fact-label">Üyelik</span><span class="profile-fact-value" id="am-fact-joined">—</span></div>
          </div>
        </div>

        <!-- Firma Bilgileri — kullanıcı isteği (2026-09-01 madde 2): "Profil Bilgileri kutusunun
             yanındaki sütuna Firma Bilgileri kutusu ekle ve bir kullanıcı bir firmada görev
             alıyorsa firma bilgileri bu kısımda gözüksün". Kullanıcının firmayla bağı zaten
             profile_claims('office') satırında duruyor (Profili Düzenle'deki "Firma" kutusu bu
             talebi oluşturur, bkz. submitFirmaClaimIfChanged) — #am-claims-mine-list'in TEK içeriği
             de zaten oydu (mimar tipi filtreleniyor), bu yüzden o liste Profil Bilgileri'nden
             BURAYA taşındı: aynı bilgi iki kutuda birden görünmesin. Kutu ayrıca firmanın kendi
             künyesini (/api/office/:key) çeker, bkz. loadFirmInfo. -->
        <div class="dash-section">
          <!-- Firma künyesinin kendi "Profili Düzenle" butonu (kullanıcı isteği, 2026-09-01 madde 1)
               — yalnızca firmada YETKİLİ bir görevi olan kullanıcıya gösterilir, bkz.
               renderFirmEditBtn / OFFICE_EDIT_POSITIONS. -->
          <div class="dash-section-head">
            <h2>Firma Bilgileri</h2>
            <a class="dash-edit-btn dash-edit-btn-sm" id="am-firm-edit-btn" href="#" style="display:none;">Profili Düzenle</a>
          </div>
          <div id="am-firm-facts"><div class="dash-empty">Yükleniyor…</div></div>
          <div id="am-claims-mine-list"></div>
        </div>
      </div>

      <div class="dash-row col-two-col"><!-- bkz. bir üstteki col-two-col gerekçesi -->
        <div class="dash-section">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:4px;">
            <h2 style="margin:0;">Bildirimler</h2>
          </div>
          <div id="am-dash-notifications"><div class="dash-empty">Yükleniyor…</div></div>
          <div class="dash-pagination" id="am-notif-pagination"></div>
        </div>

        <div class="dash-section">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:4px;">
            <h2 style="margin:0;">Mesajlar</h2>
          </div>
          <div id="am-dash-messages"><div class="dash-empty">Yükleniyor…</div></div>
          <div class="dash-pagination" id="am-msg-pagination"></div>
        </div>
      </div>

      <!-- Rozetlerim ARTIK TEK BAŞINA, TAM GENİŞLİKTE bir satır (kullanıcı isteği, 2026-09-01
           madde 2: "Rozetlerim de 3. satırda tek satır halinde gözüksün") — .dash-section-wide,
           activitiesTemplate'teki "Paylaştıklarım" kutusuyla AYNI desen (grid-column:1 / -1). -->
      <div class="dash-row col-two-col">
        <div class="dash-section dash-section-wide">
          <h2>Rozetlerim</h2>
          <p class="section-hint">Rozetlerin sağladıkları avantajlar farklıdır ve aylık kiralanırlar. Kendin için ayrı, firmaların için ayrı rozet alabilirsin.</p>
          <div id="am-my-badges-list" style="display:none; margin-bottom:16px;"></div>
          <div class="badge-grid" id="am-badge-grid"></div>
        </div>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------------------------------------
  // AKTİVİTELERİM — Hesabım'dan ayrılmış, yalnızca Takip Ettiklerim/Beğendiklerim/Yorumlarım/
  // Paylaştığım İçerikler kutularını taşıyan ikinci bir dashboard görünümü (bkz. kullanıcı isteği:
  // "Hesabım seçeneğinin altına Aktivitelerim seçeneği ekle"). Yükleme/render mantığı (loadSubmissions/
  // loadRated/loadComments) accountTemplate()'in eskiden TEK parçası olan mountAccount()'tan
  // BİREBİR taşındı — accountUser gibi Hesabım'a özgü hiçbir state'e bağımlı değildi.
  // ---------------------------------------------------------------------------------------------
  function activitiesTemplate() {
    return `
    <div class="dash-wrap" id="am-activities-wrap">
      <div class="dash-head">
        <div class="dash-head-info">
          <div>
            <h1>Aktivitelerim</h1>
            <p>Takip ettiklerin, beğendiklerin, yorumların ve paylaştıkların.</p>
          </div>
        </div>
      </div>

      <!-- Kaydettiklerim ARTIK BURADA DEĞİL — kullanıcı isteği (2026-08-31): yalnızca Koleksiyonum
           popup'ında dursun (bkz. collectionsTemplate#am-col-dash-saved).
           Takip Ettiklerim de ARTIK BURADA DEĞİL — kullanıcı isteği (2026-09-01 madde 2: "Takip
           ettiklerim kutusunu aktivitelerim popupından kaldırıp koleksiyonum popupında taşı"),
           bkz. collectionsTemplate#am-dash-follow-feed.
           Kalan üç kutunun yerleşimi: 1. satır Beğendiklerim | Yorumlarım, 2. satır Paylaştıklarım
           (tek başına, tam genişlik — bkz. .dash-section-wide). Kırılma noktası .col-two-col ile
           620px'e çekilir (bkz. injectStyles'taki gerekçe) — istek açıkça "masaüstü VE tablet"te iki
           sütun diyor, .dash-row'un varsayılan 860px eşiği çekmecenin 90vw genişliğindeki tablet
           görünümünü tek sütuna düşürürdü. -->
      <div class="dash-row col-two-col">
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

        <div class="dash-section">
          <h2>Yorumlarım</h2>
          <div class="saved-filter" id="am-comments-filter">
            <button type="button" class="saved-filter-btn active" data-filter="">Tümü</button>
          </div>
          <div id="am-dash-comments"><div class="dash-empty">Yükleniyor…</div></div>
          <div class="dash-pagination" id="am-comments-pagination"></div>
        </div>
      </div>

      <div class="dash-row col-two-col">
        <!-- Paylaştıklarım (kullanıcı isteği, 2026-08-31 madde 1): "kullanıcıların paylaş butonuna
             tıklayarak başkalarına ilettikleri gönderiler". Kaynak, Paylaş butonunun (bkz.
             js/components/share-button.js) gerçekten bir paylaşım eylemi TAMAMLANDIĞINDA yazdığı
             shared_items tablosudur (bkz. src/routes/shares.js) — butonu açıp kapatmak değil,
             bağlantıyı kopyalamak/WhatsApp/X/LinkedIn'e göndermek ya da yerel paylaşım sayfasını
             onaylamak sayılır. -->
        <div class="dash-section dash-section-wide">
          <h2>Paylaştıklarım</h2>
          <div class="saved-filter" id="am-shares-filter">
            <button type="button" class="saved-filter-btn active" data-filter="">Tümü</button>
            <button type="button" class="saved-filter-btn" data-filter="project">Proje</button>
            <button type="button" class="saved-filter-btn" data-filter="product">Ürün</button>
            <button type="button" class="saved-filter-btn" data-filter="architect">Kişi</button>
            <button type="button" class="saved-filter-btn" data-filter="office">Firma</button>
          </div>
          <div id="am-dash-shares"><div class="dash-empty">Yükleniyor…</div></div>
          <div class="dash-pagination" id="am-shares-pagination"></div>
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

      <!-- TEK SÜTUN (kullanıcı isteği, 2026-09-01 madde 2): yanındaki "Kişi/Firma Profilim" kutusu
           KALDIRILDI — aynı bilgi (ve firma için "Profili Düzenle") artık Hesabım > Firma Bilgileri
           kutusunda duruyor (bkz. accountTemplate#am-firm-facts / renderFirmEditBtn). Tek kutu
           kaldığından .dash-row ızgarası da gereksiz: .dash-section kendi margin-bottom'unu zaten
           taşıyor ve tam genişliği kaplar. -->
      <div>
        <div class="dash-section">
          <!-- Başlık "Eklediklerim" + "Proje Ekle/Ürün Ekle/..." bağlantı satırı KALDIRILDI
               (kullanıcı isteği, 2026-09-01 madde 3). Ekleme sayfalarına giden yol zaten
               nav/footer'daki "İçerik Ekle" akışında var (bkz. add-choice.js); bu kutu artık
               yalnızca "ne eklediğimi göster" işini yapıyor.
               "Marka" filtresi diğer butonların EN SONUNA eklendi — marka gönderileri ayrı bir
               gönderi tipi değil, offices gönderisidir; ayrım sunucudan gelen item.isBrand ile
               yapılır (bkz. src/routes/submissions.js#listMine ve office-kind.js). -->
          <h2>Eklediklerim</h2>
          <div class="submissions-toolbar-row" id="am-submissions-filter">
            <button type="button" class="submissions-filter-btn active" data-filter="">Tümü</button>
            <button type="button" class="submissions-filter-btn" data-filter="projects">Proje</button>
            <button type="button" class="submissions-filter-btn" data-filter="products">Ürün</button>
            <button type="button" class="submissions-filter-btn" data-filter="architects">Kişi</button>
            <button type="button" class="submissions-filter-btn" data-filter="offices">Firma</button>
            <button type="button" class="submissions-filter-btn" data-filter="brands">Marka</button>
          </div>
          <div id="am-dash-submissions"><div class="dash-empty">Yükleniyor…</div></div>
          <div class="dash-pagination" id="am-submissions-pagination"></div>
        </div>
      </div>
    </div>`;
  }

  // Koleksiyonum — Pinterest benzeri panolar (kullanıcı isteği, 2026-08-31: "Giriş yap butonunun
  // altında İÇERİKLERİM ve ÇIKIŞ YAP butonu arasında aynı İÇERİKLERİM gibi bir sayfa oluştur ...
  // Masaüstü, tablet ve mobil görünümleri aynı içeriklerim sayfası gibi olsun"). contentsTemplate()
  // ile BİREBİR AYNI .dash-wrap/.dash-head/.dash-section iskeleti — bu sayede masaüstünde ModalShell
  // popup'ı, ≤960px'te NavDrawer alt sayfası olarak açılması ve tüm boşluk/tipografi davranışı
  // İçeriklerim'le aynı olur, ayrı bir responsive kural yazmaya gerek kalmaz.
  //
  // Sayfa TEK bir mount içinde iki görünüm barındırır: pano listesi (am-col-list-view) ve tek bir
  // panonun içi (am-col-detail-view). Bunlar AYRI bir AuthModal "view"i DEĞİL — ayrı view olsalardı
  // her pano için ayrı bir URL/history girdisi gerekirdi; kullanıcı isteği tek bir "KOLEKSİYONUM"
  // sayfası olduğundan iki bölüm aynı görünüm içinde display ile değişir.
  function collectionsTemplate() {
    return `
    <div class="dash-wrap" id="am-collections-wrap">
      <div class="dash-head">
        <div class="dash-head-info">
          <div>
            <h1>Koleksiyonum</h1>
            <p>Kaydettiklerinden, kendi görsellerinden ve notlarından kendi panolarını oluştur.</p>
          </div>
        </div>
      </div>

      <!-- Masaüstü + tablette iki sütun (kullanıcı isteği, 2026-08-31) — Aktivitelerim/İçeriklerim
           ile AYNI .dash-row ızgarası, ek olarak .col-two-col ile kırılma noktası 620px'e çekilir
           (bkz. injectStyles): çekmece tablette 90vw olduğundan ~690px'lik bir alan kalıyor, iki
           sütun orada hâlâ rahat sığıyor; .dash-row'un varsayılan 860px eşiği tablette gereksiz
           yere tek sütuna düşürürdü. -->
      <div id="am-col-list-view" class="dash-row col-two-col">
        <div class="dash-section">
          <h2>Panolarım</h2>
          <p class="section-hint">Yeni bir pano oluştur, sonra içine kaydettiğin içerikleri, kendi görsellerini ya da notlarını ekle.</p>
          <div class="col-new-row">
            <input type="text" id="am-col-new-title" placeholder="Yeni pano adı" maxlength="120" autocomplete="off">
            <button type="button" class="col-btn col-btn-primary" id="am-col-create-btn">Oluştur</button>
          </div>
          <div class="col-notice" id="am-col-list-notice"></div>
          <div id="am-col-list"><div class="dash-empty">Yükleniyor…</div></div>
        </div>

        <!-- Kaydettiklerim (kullanıcı isteği, 2026-08-31: "Kaydettiklerim kutucuğunu da KOLEKSİYONUM
             popupına koy") — Aktivitelerim'deki KUTUNUN AYNISI (aynı /api/saved kaynağı, aynı
             .saved-row işaretlemesi, aynı filtre/sayfalama), oradan KALDIRILMADAN buraya da eklendi.
             Burada ayrıca doğal bir yeri var: panolara öğe eklemenin ana kaynağı bu liste. -->
        <div class="dash-section">
          <h2>Kaydettiklerim</h2>
          <p class="section-hint">Panolarına eklemek için kaydettiğin içerikler. Bir panonun içinden "Kaydettiklerimden Ekle" ile seçebilirsin.</p>
          <!-- kullanıcı isteği (2026-09-01 madde 4): "Mimar" ve "Firma" filtre butonları BU kutudan
               kaldırıldı. Yalnızca butonlar gitti — filtreleme mantığı (colMatchesCatalogFilter) ve
               kaydedilmiş mimar/firma satırlarının kendisi olduğu gibi duruyor, "Tümü" onları
               göstermeye devam eder. Aktivitelerim'deki ve Takip Ettiklerim'deki AYNI görünen
               filtre satırları BİLEREK değişmedi (istek yalnızca Kaydettiklerim kutusunu sayıyor). -->
          <div class="saved-filter" id="am-col-saved-filter">
            <button type="button" class="saved-filter-btn active" data-filter="">Tümü</button>
            <button type="button" class="saved-filter-btn" data-filter="project">Proje</button>
            <button type="button" class="saved-filter-btn" data-filter="product">Ürün</button>
          </div>
          <div id="am-col-dash-saved"><div class="dash-empty">Yükleniyor…</div></div>
          <div class="dash-pagination" id="am-col-saved-pagination"></div>
        </div>

        <!-- Takip Ettiklerim — kullanıcı isteği (2026-09-01 madde 2): "Takip ettiklerim kutusunu
             aktivitelerim popupından kaldırıp koleksiyonum popupında taşı". Kutu Aktivitelerim'den
             OLDUĞU GİBİ taşındı (aynı /api/follows + /api/follows/feed kaynağı, aynı .saved-row
             işaretlemesi, aynı sekme/sayfalama) — yalnızca iki ekleme var:
               • "Marka" filtresi: markalar da offices satırıdır (bkz. office-kind.js), sunucu
                 /api/follows'ta is_brand döner ve istemci onları 'brand' tipinde sayar; böylece
                 marka profilindeki Takip Et buradaki Marka sekmesinde görünür.
               • "Yeni" rozeti: son ziyaretten sonra yayınlanmış gönderilerin yanında (bkz.
                 followSeenAt / FOLLOW_FEED_SEEN_KEY).
             .dash-section-wide: satırın üçüncü kutusu tek başına kaldığından tam genişlik kaplar. -->
        <div class="dash-section dash-section-wide">
          <h2>Takip Ettiklerim <span class="dash-new-count" id="am-follow-feed-new-count" hidden></span></h2>
          <p class="section-hint">Takip ettiğin mimar, firma ve markalar ile onların takibe başladıktan SONRA eklediği proje ve ürünler.</p>
          <div class="saved-filter" id="am-follow-feed-filter">
            <button type="button" class="saved-filter-btn active" data-filter="">Tümü</button>
            <button type="button" class="saved-filter-btn" data-filter="project">Proje</button>
            <button type="button" class="saved-filter-btn" data-filter="product">Ürün</button>
            <button type="button" class="saved-filter-btn" data-filter="architect">Kişi</button>
            <button type="button" class="saved-filter-btn" data-filter="office">Firma</button>
            <button type="button" class="saved-filter-btn" data-filter="brand">Marka</button>
          </div>
          <div id="am-dash-follow-feed"><div class="dash-empty">Yükleniyor…</div></div>
          <div class="dash-pagination" id="am-follow-feed-pagination"></div>
        </div>
      </div>

      <div id="am-col-detail-view" style="display:none;">
        <div class="dash-section">
          <!-- Buton sırası kullanıcı isteği (2026-09-02 madde 5): Paylaş, Dışa Aktar, Panoyu Sil.
               "Yeniden Adlandır" buradan KALDIRILDI — artık pano adının sağındaki kalem ikonu. -->
          <div class="col-toolbar">
            <button type="button" class="col-btn" id="am-col-back-btn">← Panolarım</button>
            <button type="button" class="col-btn" id="am-col-share-btn">Paylaş</button>
            <!-- Dışa Aktar rozetli üyelere özel (kullanıcı isteği). Buton BİLEREK devre dışı
                 (disabled) DEĞİL: devre dışı bir buton hiç click olayı üretmez, dolayısıyla
                 rozetsiz kullanıcıya "rozet al" yönlendirmesini gösteremezdik (kullanıcı isteği,
                 2026-09-02). Yetki kontrolü tıklama anında yapılır.
                 NOT: bu blok bir template literal içindedir - ters tırnak KULLANMA (bkz. proje
                 belleği: sekme içi ters tırnak şablonu sessizce bozar). -->
            <button type="button" class="col-btn" id="am-col-export-btn">Dışa Aktar</button>
            <button type="button" class="col-btn col-btn-danger" id="am-col-delete-btn">Panoyu Sil</button>
          </div>
          <h2 id="am-col-detail-title" style="display:inline-flex; align-items:center; gap:8px;">
            <span id="am-col-detail-title-text"></span>
            <button type="button" id="am-col-rename-btn" aria-label="Panoyu yeniden adlandır" title="Yeniden adlandır"
              style="background:none; border:none; padding:2px; line-height:0; cursor:pointer; color:var(--ink-soft);">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
          </h2>
          <p class="section-hint" id="am-col-detail-count"></p>

          <div class="col-toolbar">
            <button type="button" class="col-btn" data-col-add="saved">Kaydettiklerimden Ekle</button>
            <button type="button" class="col-btn" data-col-add="image">Görsel Yükle</button>
            <button type="button" class="col-btn" data-col-add="note">Not Ekle</button>
          </div>

          <div class="col-add-panel" id="am-col-add-saved" style="display:none;">
            <strong style="font-size:13px;">Kaydettiklerim</strong>
            <div class="col-saved-picker" id="am-col-saved-picker"><div class="dash-empty">Yükleniyor…</div></div>
          </div>
          <div class="col-add-panel" id="am-col-add-image" style="display:none;">
            <strong style="font-size:13px;">Bilgisayarından görsel yükle</strong>
            <div class="avatar-upload-hint">JPEG, PNG, WEBP ya da GIF · en fazla 5 MB</div>
            <div style="margin-top:10px;">
              <button type="button" class="col-btn" id="am-col-image-btn">Görsel Seç</button>
              <input type="file" id="am-col-image-input" accept="image/*" style="display:none;">
            </div>
          </div>
          <div class="col-add-panel" id="am-col-add-note" style="display:none;">
            <strong style="font-size:13px;">Not ekle</strong>
            <textarea id="am-col-note-text" maxlength="4000" placeholder="Bu panoyla ilgili bir not yaz…"></textarea>
            <div style="margin-top:10px;">
              <button type="button" class="col-btn col-btn-primary" id="am-col-note-save-btn">Notu Ekle</button>
            </div>
          </div>

          <div class="col-notice" id="am-col-detail-notice"></div>
          <div id="am-col-items"><div class="dash-empty">Yükleniyor…</div></div>
        </div>
      </div>
    </div>`;
  }

  const TYPE_LABELS = { offices: 'Ofis', projects: 'Proje', products: 'Ürün', materials: 'Malzeme', architects: 'Kişi', news: 'Haber' };
  const STATUS_LABELS = { pending: 'Beklemede', approved: 'Yayında', rejected: 'Reddedildi', archived: 'Arşivlendi' };
  const STATUS_COLORS = { pending: 'var(--accent)', approved: '#3E7A55', rejected: '#B84C4C', archived: 'var(--ink-soft)' };
  const EDIT_PAGE_BY_TYPE = { offices: '/firma-ekle', projects: '/proje-ekle', products: '/urun-ekle', materials: '/urun-ekle', architects: '/kisi-ekle', news: 'haber-ekle.html' };
  // Marka gönderileri offices tipindedir (bkz. marka-ekle.html: type:'offices') — İçeriklerim >
  // Eklediklerim satırında hem etiketi ("Marka") hem Düzenle hedefi (marka-ekle.html) bu yüzden
  // tipe DEĞİL, sunucudan gelen item.isBrand'a göre seçilir (bkz. src/routes/submissions.js#listMine).
  function submissionTypeLabel(type, item) {
    if (type === 'offices') return item && item.isBrand ? 'Marka' : 'Firma';
    return TYPE_LABELS[type];
  }
  function editPageFor(type, item) {
    if (type === 'offices' && item && item.isBrand) return '/marka-ekle';
    return EDIT_PAGE_BY_TYPE[type];
  }
  // brand: gerçek bir saved/follow tipi DEĞİL — Takip Ettiklerim'in marka satırları için
  // istemcide türetilen görüntüleme tipi (bkz. mountCollections#loadFollowFeed).
  const SAVED_TYPE_LABELS = { project: 'Proje', product: 'Ürün', material: 'Malzeme', news: 'Haber', job: 'İş İlanı', architect: 'Kişi', office: 'Firma', brand: 'Marka' };
  // Paylaştıklarım satırının alt metnindeki kanal etiketi — js/components/share-button.js'in
  // logShare'e geçirdiği ('copy'|'whatsapp'|'x'|'linkedin'|'native') değerlerin okunabilir karşılığı
  // (bkz. src/routes/shares.js#SHARE_CHANNELS, TEK doğru kaynak orası). Eski/tanınmayan bir değer
  // gelirse satır kanal etiketi olmadan basılır.
  const SHARE_CHANNEL_LABELS = { copy: 'Bağlantı kopyalandı', whatsapp: 'WhatsApp', x: 'X', linkedin: 'LinkedIn', native: 'Paylaşıldı' };
  const PAGE_SIZE_DASH = 10;
  // 'fotografci' — kullanıcı isteği (2026-09-01 madde 6). Bu eşleme src/routes/auth.js#PROFESSIONS,
  // uye-ol.html ve kisi-ekle.html#MESLEK_OPTIONS ile BİLİNÇLİ olarak kopyadır; dördü birlikte
  // güncellenmeli (bkz. o dosyalardaki AYNI not).
  // Meslek listesi profession-shared.js'ten gelir (uye-ol.html ve kisi-ekle.html ile TEK kaynak,
  // kullanıcı isteği 2026-09-02). Paylaşılan dosya bir nedenle yüklenmemişse buradaki kopya devreye
  // girer — meslek alanı boş bir açılır kutuya düşmesin (auth-modal her sayfada yüklü, o yüzden
  // sessiz bir bozulma tüm siteyi etkilerdi).
  const PROFESSION_LABELS = (typeof window !== 'undefined' && window.PROFESSION_LABELS)
    || { mimar: 'Mimar', ic_mimar: 'İç Mimar', peyzaj_mimari: 'Peyzaj Mimarı', sehir_plancisi: 'Şehir Plancısı', restorator: 'Restoratör', tasarimci: 'Tasarımcı', muhendis: 'Mühendis', fotografci: 'Fotoğrafçı', ogrenci: 'Öğrenci', diger: 'Diğer' };
  // users.profession artık virgülle ayrılmış birden çok slug taşıyabilir (bkz. src/routes/auth.js#
  // normalizeProfessions) — tek meslekli eski değerler bu biçimin geçerli bir örneği olduğundan
  // aşağıdaki üç yardımcı iki durumu da tek kod yoluyla ele alır.
  function professionSlugs(value) {
    return String(value || '').split(',').map(s => s.trim()).filter(Boolean);
  }
  function professionLabelText(value) {
    const labels = professionSlugs(value).map(s => PROFESSION_LABELS[s] || s);
    return labels.length ? labels.join(', ') : '';
  }
  function professionCheckboxesHtml(namePrefix) {
    return Object.keys(PROFESSION_LABELS)
      .map(slug => `<label><input type="checkbox" name="${escapeAttr(namePrefix)}" value="${escapeAttr(slug)}"> ${escapeHtml(PROFESSION_LABELS[slug])}</label>`)
      .join('');
  }
  function setProfessionChecks(groupId, value) {
    const slugs = new Set(professionSlugs(value));
    document.querySelectorAll(`#${groupId} input[type=checkbox]`).forEach(cb => { cb.checked = slugs.has(cb.value); });
  }
  function getProfessionChecks(groupId) {
    return [...document.querySelectorAll(`#${groupId} input:checked`)].map(i => i.value).join(',');
  }
  const CLAIM_TYPE_LABELS = { architect: 'Kişi', office: 'Firma' };
  // ODUL_OPTIONS artık burada tanımlı DEĞİL — awards-shared.js'teki TEK paylaşılan global koptan
  // (kisi-ekle.html/proje-ekle.html ile ortak) geliyor, bu dosyanın <script> etiketinden HEMEN
  // önce her sayfada senkron yüklenir (bkz. o dosyanın başındaki yorum). Buradaki "Mimar Profili"
  // alt bölümünü besler, yalnızca onaylı bir mimar profili sahiplenilmişse görünür (bkz.
  // loadArchitectSyncFields). SOCIAL_PLATFORMS ise kisi-ekle.html#SOCIAL_PLATFORMS ile BİREBİR
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
  const CLAIM_EDIT_PAGE = { architect: '/kisi-ekle', office: '/firma-ekle' };
  // bkz. src/routes/submissions.js#OFFICE_EDIT_POSITIONS / js/components/claim-correction-box.js
  // (firma sayfasındaki Düzenle butonu) ile BİREBİR aynı liste — kullanıcı isteği: "Firmayı sadece
  // kurucu, kurucu ortak, ortak ve ekip lideri düzenleyebilir". Hesabım'daki Firma satırı bu kontrolü
  // UYGULAMIYORDU (gerçek bulgu): Ekip Üyesi pozisyonundaki biri firma sayfasından Düzenle'yi hiç
  // GÖRMESE de buradan firma-ekle.html?claim=...'a ulaşabiliyordu — sunucu yine de reddeder ama
  // kullanıcıya önce boş yere doldurabileceği bir form gösterip sonra 403 ile karşılaştırıyordu.
  const OFFICE_EDIT_POSITIONS = new Set(['Kurucu', 'Kurucu Ortak', 'Ortak', 'Ekip Lideri']);
  // selfPrice/officePrice, src/routes/badges.js#BADGE_PRICES ile AYNI kaynaktan kopyalanmıştır
  // (bkz. info-modal.js#mountRozetAl/satin-al.html'deki BİREBİR aynı desen) — bu grid yalnızca
  // "Kendim için" fiyatını gösterir, gerçek tutar her zaman satın alma anında sunucuda yeniden
  // hesaplanır. gerçek bulgu (2026-08-14 audit): önceden bu dizi kendi içinde önceden indirimli
  // fiyatları ayrı string olarak tutuyordu, backend fiyatı değişirse burası sessizce yanlış
  // kalıyordu.
  const BADGE_TIERS = [
    { type: 'verified', label: 'Doğrulanmış Üye', selfPrice: 49, officePrice: 129 },
    { type: 'gold', label: 'Altın Üye', selfPrice: 99, officePrice: 199 },
  ];
  const BADGE_RANK = { gold: 2, verified: 1 };
  function formatTRY(n) { return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL'; }
  const BADGE_STATUS_LABELS = { pending: 'İnceleniyor', active: 'Aktif', rejected: 'Reddedildi' };
  const BADGE_STATUS_COLORS = { pending: 'var(--accent)', active: '#3E7A55', rejected: '#B84C4C' };

  // badge-shared.js#badgeIconHtml'in AYNEN kopyası (bkz. hesabim.html#accountBadgeIconHtml'deki AYNI
  // gerekçe — badge-shared.js bu sayfaya YÜKLENMİYOR, kendi initials()/palette gibi globalleriyle
  // çakışabilir) — Ad Soyad/Firma satırlarının yanına aktif rozet ikonu basmak için kullanılır (bkz.
  // kullanıcı isteği). 'destekci' KASITLI OLARAK gösterilmez — bkz. src/lib/badgeAccess.js.
  const ACCOUNT_BADGE_LABELS = { verified: 'Doğrulanmış Üye', gold: 'Altın Üye', 'iz-birakan': 'İz Bırakan' };
  const ACCOUNT_BADGE_COLORS = { verified: '#0095F6', gold: '#D4A72C', 'iz-birakan': '#1B1F24' };
  const ACCOUNT_SEAL_BADGE_SVG = '<path d="M12 2 14.5 5.5 19 5l-.5 4.5L22 12l-3.5 2.5.5 4.5-4.5-.5L12 22l-2.5-3.5-4.5.5.5-4.5L2 12l3.5-2.5L5 5l4.5.5Z"/><path d="M9 12.5l2 2 4-4.5" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
  function accountBadgeIconHtml(badgeType) {
    if (!badgeType || badgeType === 'destekci' || badgeType === 'platinum') return '';
    const size = 14;
    const label = ACCOUNT_BADGE_LABELS[badgeType] || badgeType;
    // title yerine tıklama/dokunma ile de açılabilen özel tooltip (bkz. kullanıcı isteği: "tablet
    // ve mobilde dokununca rozetin ismi yazsın") — native title mobilde çalışmadığından am-badge-icon
    // click delegasyonu (bkz. aşağıdaki document click listener) bunu tetikler.
    return `<span class="am-badge-icon" aria-label="${escapeAttr(label)}" style="display:inline-flex; vertical-align:middle; margin-left:6px; flex-shrink:0; color:${ACCOUNT_BADGE_COLORS[badgeType] || 'var(--accent)'}"><svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor">${ACCOUNT_SEAL_BADGE_SVG}</svg><span class="am-badge-tooltip">${escapeHtml(label)}</span></span>`;
  }
  // amBadgeItems (loadBadges) ve amClaimItems (loadMyClaims) birbirinden bağımsız/paralel yüklenir
  // (bkz. aşağıdaki loadUser().then(...) toplu tetikleme) — Mimar/Firma satırlarındaki rozet ikonu
  // bu yüzden ikisi de kendi fetch'i bittiğinde (hangisi önce biterse) renderClaimsList'i tekrar
  // çağırarak, o ana kadar hazır olan veriyle yeniden çizilir.
  let amBadgeItems = [];
  let amClaimItems = [];
  // #am-firm-facts kutusunda hâlihazırda gösterilen firmanın anahtarı (bkz. loadFirmInfo).
  // amClaimItems ile AYNI kapsamda tutulur çünkü renderClaimsList onu, loadFirmInfo'dan ÖNCE de
  // çağrılabilecek şekilde okuyor (bkz. oradaki filtre).
  let firmInfoKey = null;
  // Firma Bilgileri kutusunun "Profili Düzenle" butonunun hedefi/görünürlüğü (bkz. renderFirmEditBtn).
  // firmInfoSlug: /firma-ekle?claim=<slug> için gereken slug; firmInfoApproved: talep onaylı mı
  // (bekleyen bir talep henüz düzenleme yetkisi vermez).
  let firmInfoSlug = null;
  let firmInfoApproved = false;
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
  // "Bu kullanıcının HERHANGİ bir rozeti var mı?" — Dışa Aktar gibi rozet kapılı özelliklerin
  // yetki kaynağı. myEffectiveBadgeType()'tan farkı: o, isim yanında GÖSTERİLECEK TEK rozeti
  // seçer (yalnızca architect claim'ine bakar), bu ise firma rozetini de sayar.
  // Neden önemli: bir firmanın rozetini ortaklardan yalnızca BİRİ satın alır; diğer ortakların
  // kendi badge_requests satırı yoktur ama rozet profillerinde görünür. Aynı şekilde admin'in
  // elle verdiği rozetler admin_badges'tedir. amPublicBadges her ikisini de içerir (public rozet
  // haritası = profilde fiilen görünen rozet); ham `items` içermez, bu yüzden yetki için
  // KULLANILMAZ (bkz. proje belleği "profileBadges tek kaynak").
  function amHasAnyBadge() {
    for (const c of amClaimItems) {
      if (c.status !== 'approved') continue;
      const map = amPublicBadges[c.profile_type];
      const list = map && map[c.profile_key];
      if (list && list.length) return true;
    }
    // Henüz profil sahiplenmemiş ama kendi adına rozet almış üye.
    return amBadgeItems.some(b => b.status === 'active' && b.badge_type !== 'destekci');
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
  // kisi.html/firma.html/urun.html location.pathname'i ayrıştırıp ilgili modalı otomatik açar, bu
  // yüzden yalnızca YAYINDA (approved) gönderiler için (canonical satır var olduğundan) bir link
  // üretilir; anahtar canonicalSync.js'in senkron sırasında GERÇEKTEN yazdığı değerle birebir aynı
  // olmalı (istemci tarafı slugify(name) çakışma soneki alabileceğinden YANLIŞ olurdu).
  function itemDetailUrl(type, item) {
    if (item.status !== 'approved') return null;
    if (type === 'projects') return `/proje/${encodeURIComponent(item.claimed_slug || item.slug)}`;
    if (type === 'offices') return `/firma/${encodeURIComponent(item.claimed_profile_key || ('submission:' + item.id))}`;
    if (type === 'architects') return `/kisi/${encodeURIComponent(item.claimed_profile_key || ('submission:' + item.id))}`;
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
        // Baştan eşleşenler ÖNCE (kullanıcı isteği: "ilk harfleri yazmaya başladığında ilgili
        // olanlar çıksın") — liste artık Türkiye'deki tüm üniversiteleri taşıdığından (bkz.
        // /api/architects/schools) saf "içinde geçiyor mu" sıralaması "Yıldız" yazan birine önce
        // "Ankara Yıldırım Beyazıt"ı gösterebiliyordu. İçinde geçenler atılmaz, arkaya alınır.
        const starts = items.filter(it => trLower(it).startsWith(q));
        const matches = starts.concat(items.filter(it => !trLower(it).startsWith(q) && trLower(it).includes(q))).slice(0, 8);
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
      // Bildirimdeki /hesabim?dizin=1 bağlantısıyla gelindiyse dizin sorusunu aç (kullanıcı isteği,
      // 2026-09-02 madde 4). loadUser() içinde çağrılır çünkü pop-up yalnızca oturum doğrulandıktan
      // SONRA anlamlı — oturumsuz gelen biri zaten login görünümüne düşer (yukarıdaki swap).
      maybeOpenDirectoryPrompt();
      document.getElementById('am-dash-title').textContent = 'Hoş Geldin, ' + (accountUser.name || '').split(' ')[0];
      document.getElementById('am-dash-sub').textContent = accountUser.email + ' · MİMARLAB üyesi';
      renderAmNameBadge();
      document.getElementById('am-fact-profession').textContent = professionLabelText(accountUser.profession) || '—';
      document.getElementById('am-fact-position').textContent = accountUser.position || '—';
      renderFirmEditBtn(); // pozisyon değişmiş olabilir (bkz. o fonksiyondaki paralel-yükleme gerekçesi)
      document.getElementById('am-fact-school').textContent = accountUser.school || '—';
      document.getElementById('am-fact-dob').textContent = accountUser.dob ? String(accountUser.dob).slice(0, 4) : '—';
      document.getElementById('am-fact-joined').textContent = new Date(accountUser.createdAt).toLocaleDateString('tr-TR', { year: 'numeric', month: 'long' });
      document.getElementById('am-edit-name').value = accountUser.name || '';
      ensureDobYearOptions();
      document.getElementById('am-edit-dob').value = accountUser.dob ? String(accountUser.dob).slice(0, 4) : '';
      document.getElementById('am-edit-school').value = accountUser.school || '';
      setProfessionChecks('am-edit-profession', accountUser.profession);
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

    // Ödüller kutusu — kisi-ekle.html#wireMultiDropdown ile BİREBİR aynı desen: kapalı bir düğme
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
    // kaydına da yazılır (bkz. submitArchitectSyncIfNeeded, kisi-ekle.html?claim= ile TAM AYNI uç
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

    // kisi-ekle.html#prefillForClaim ile AYNI iki aşamalı kaynak: önce canonical (/api/architect/:key,
    // `item.role`/`item.photo` alan adlarıyla), sonra varsa kullanıcının kendi architect_submissions
    // satırı (/api/architects/mine, claimed_profile_key eşleşmesiyle) ÜZERİNE yazılır — böylece
    // kullanıcı daha önce kisi-ekle.html'den bir taslak kaydettiyse o taslak esas alınır.
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
          // updated_at'i EN YENİ olanı seçilir (bkz. kisi-ekle.html#prefillForClaim'deki AYNI
          // gerçek bulgu: Profilini Düzenle'de eklenen sosyal medya linkleri kisi-ekle.html'de
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
      // Dizin tercihini mevcut kayda göre ayarla — kullanıcı daha önce "Hayır" dediyse form onu
      // "Evet" olarak göstermemeli (varsayılan Evet, YALNIZCA hiç kaydı olmayanlar için).
      const dirEl = document.querySelector(`input[name="am-directory-listed"][value="${merged.directory_listed === 0 ? 'no' : 'yes'}"]`);
      if (dirEl) dirEl.checked = true;
    }

    // Profili Düzenle artık ayrı bir pop-up (bkz. hesabim.html#openProfileEditPopup ile AYNI desen) —
    // TEK fark: bu görünüm zaten ModalShell'in overlay'i İÇİNDE render edildiğinden gövde kaydırması
    // ZATEN kilitli (bkz. ModalShell#lockBodyScroll), burada ikinci kez kilitlenmez.
    // "Kişi sayfasında diğer profesyonellerle birlikte yer almak ister misin?" (kullanıcı isteği,
    // 2026-09-02 madde 4). Evet -> Profili Düzenle açılır ve dizin sorusu Evet'te gelir; Hayır ->
    // yalnızca kapanır (kullanıcının mevcut tercihi DEĞİŞTİRİLMEZ, sessizce "hayır" yazmak
    // kullanıcının hiç görmediği bir kaydı değiştirmek olurdu).
    function openDirectoryPrompt() {
      let ov = document.getElementById('am-directory-prompt');
      if (!ov) {
        ov = document.createElement('div');
        ov.id = 'am-directory-prompt';
        ov.className = 'profile-edit-overlay';
        ov.innerHTML = `
          <div class="dash-form" style="background:var(--paper-card); border:1px solid var(--line); border-radius:16px; padding:24px; max-width:420px;">
            <h2 style="font-size:16px; font-weight:700; margin:0 0 10px;">Kişi sayfasında diğer profesyonellerle birlikte yer almak ister misin?</h2>
            <p style="font-size:13px; color:var(--ink-soft); line-height:1.55; margin:0 0 18px;">Evet dersen profilini tamamlayabilmen için Profili Düzenle ekranına yönlendirilirsin.</p>
            <div style="display:flex; gap:10px;">
              <button type="button" class="dash-edit-btn" id="am-dirprompt-yes" style="margin-left:0; background:var(--ink); color:var(--paper-card);">Evet</button>
              <button type="button" class="dash-edit-btn" id="am-dirprompt-no" style="margin-left:0;">Hayır</button>
            </div>
          </div>`;
        document.getElementById('am-panel').appendChild(ov);
        ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.remove('open'); });
        ov.querySelector('#am-dirprompt-no').addEventListener('click', () => ov.classList.remove('open'));
        ov.querySelector('#am-dirprompt-yes').addEventListener('click', () => {
          ov.classList.remove('open');
          openAmProfileEditPopup();
          const yes = document.querySelector('input[name="am-directory-listed"][value="yes"]');
          if (yes) yes.checked = true;
        });
      }
      ov.classList.add('open');
    }

    // Bildirimden gelen /hesabim?dizin=1 bağlantısı — Hesabım açıldığında soruyu doğrudan sor.
    function maybeOpenDirectoryPrompt() {
      try {
        if (new URLSearchParams(location.search).get('dizin') === '1') openDirectoryPrompt();
      } catch (e) {}
    }

    function openAmProfileEditPopup() {
      document.getElementById('am-profile-edit-overlay').classList.add('open');
      // Meslek çekmecesi (kullanıcı isteği, 2026-09-02) — panel her açılışta mount edilir;
      // ProfessionDrawer.mount ikinci çağrıda kendini atlar (dataset.pdrawerBound).
      if (window.ProfessionDrawer) {
        const grp = document.getElementById('am-edit-profession');
        ProfessionDrawer.mount(grp);
        if (grp && grp._pdrawerRefresh) grp._pdrawerRefresh(); // JS ile doldurulan seçimleri yansıt
      }
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
    // tıklamasıyla architect_submissions/architects kaydına da yazılır — kisi-ekle.html?claim='in
    // kullandığı UÇLARLA (createSubmission/updateOwnSubmission) BİREBİR aynı, bu yüzden ikisi de
    // gerçekten TEK bir veri kaynağını düzenlemiş olur (bkz. kullanıcı isteği: "tam bir
    // senkronizasyon"). office/photo_url bu formda düzenlenmediğinden fetchArchitectRecordForSync'in
    // getirdiği son bilinen değerleriyle olduğu gibi geri gönderilir, sıfırlanmazlar.
    async function submitArchitectSyncIfNeeded(name, dob, school, professionSlug, position, awards, about, socialLinks) {
      if (!architectSyncState) return;
      const payload = {
        name, dob: dob || null, school: school || null,
        // architects.profession HAM Türkçe etiket taşır ("Mimar, Fotoğrafçı") — çoklu meslek de
        // aynı virgüllü biçimde yazılır (bkz. kisi-ekle.html#meslekDropdown).
        profession: professionLabelText(professionSlug) || null,
        office: architectSyncState.office || null,
        position: position || null,
        awards,
        photo_url: architectSyncState.photoUrl || null,
        about: about || null,
        social_links: socialLinks,
        // Kişi dizininde görünme tercihi (kullanıcı isteği, 2026-09-02) — kisi-ekle.html'in
        // gönderdiği AYNI alan (bkz. migrations/0081_architect_directory_listed.sql). Radyo grubu
        // bulunamazsa alan HİÇ gönderilmez ki mevcut değer ezilmesin (nullable semantiği).
        ...(function () {
          const picked = document.querySelector('input[name="am-directory-listed"]:checked');
          return picked ? { directory_listed: picked.value === 'yes' ? 1 : 0 } : {};
        })(),
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
      const profession = getProfessionChecks('am-edit-profession');
      const position = document.getElementById('am-edit-position').value;
      const awards = awardsDropdown ? awardsDropdown.getChecked() : [];
      const about = document.getElementById('am-edit-about').value;
      const socialLinks = collectAmSocialLinks();
      if (isInvalidSchoolValue(school)) { msg.textContent = 'Geçerli bir üniversite adı gir (kısaltma kullanma).'; return; }
      // Kullanıcı isteği (2026-09-02): meslek artık ZORUNLU (kisi-ekle.html ile aynı kural).
      if (!profession) { msg.textContent = 'Meslek seçmelisin.'; return; }
      // Profili YAYIMLAMAK (kişi dizininde görünmek) için ek zorunlu alanlar — kullanıcı isteği
      // 2026-09-02 madde 2: "profilinin yayınlanması için Ad Soyad, Doğum Yılı, Meslek ve Açıklama
      // alanları zorunlu olsun" + daha önceki istekle profil fotoğrafı. Dizine GİRMEK İSTEMEYEN
      // biri bu alanlar boşken de profilini kaydedebilir — zorunluluk yalnızca herkese açık
      // kartta eksik bilgi görünmesini engellemek için. kisi-ekle.html'de AYNI dörtlü zorunludur.
      const wantsDirectory = document.querySelector('input[name="am-directory-listed"]:checked');
      if (wantsDirectory && wantsDirectory.value === 'yes') {
        const eksik = [];
        if (!name || !name.trim()) eksik.push('Ad Soyad');
        if (!dob) eksik.push('Doğum Yılı');
        if (!profession) eksik.push('Meslek');
        if (!about || !about.trim()) eksik.push('Açıklama');
        if (!((accountUser && accountUser.photo_url) || '')) eksik.push('Profil Fotoğrafı');
        if (eksik.length) {
          msg.textContent = 'Kişi sayfasında yayımlanmak için şu alanlar zorunlu: ' + eksik.join(', ') + '.';
          return;
        }
      }
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
      const data = res.ok ? await res.json() : { items: [], adminBadges: { self: null, offices: {} } };
      const items = data.items || [];
      const adminBadges = data.adminBadges || { self: null, offices: {} };
      amBadgeItems = items;
      renderAmNameBadge();
      renderClaimsList();
      const listEl = document.getElementById('am-my-badges-list');
      const rows = items.map(b => {
        const tier = BADGE_TIERS.find(t => t.type === b.badge_type);
        const targetLabel = b.target_type === 'office' ? `Firma: ${escapeHtml(b.target_key || '')}` : 'Kendim için';
        const until = b.status === 'active' && b.expires_at
          ? `<div style="font-size:11px; color:var(--ink-soft); margin-top:2px;">${new Date(b.expires_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })} tarihine kadar aktif</div>`
          : '';
        // Yalnızca REDDEDİLDİ satırların yanına silme X'i eklenir (bkz. kullanıcı isteği) —
        // sunucu (deleteRejectedBadgeRequest) da yalnızca status='rejected' kayıtları siler.
        const deleteBtn = b.status === 'rejected'
          ? `<button type="button" class="my-badge-delete-btn" data-id="${escapeAttr(b.id)}" title="Talebi sil" style="background:none; border:none; color:var(--ink-soft); font-size:16px; line-height:1; cursor:pointer; padding:4px;">×</button>`
          : '';
        return `
            <div class="my-badge-row">
              <div><strong>${escapeHtml(tier ? tier.label : b.badge_type)}</strong> — ${targetLabel}${until}</div>
              <div style="display:flex; align-items:center; gap:6px;">
                <span class="badge-status-pill" style="color:${BADGE_STATUS_COLORS[b.status] || 'var(--ink-soft)'}; background:${BADGE_STATUS_COLORS[b.status] || 'var(--ink-soft)'}22;">${BADGE_STATUS_LABELS[b.status] || b.status}</span>
                ${deleteBtn}
              </div>
            </div>`;
      });
      // gerçek bulgu (2026-08-30): admin_badges üzerinden doğrudan verilen bir "kendim için" rozet
      // (bkz. src/routes/badges.js#getAdminBadgesForUser — kullanıcının onaylı mimar profiline admin
      // tarafından atanmış) hiçbir zaman badge_requests'e (items) düşmez, bu yüzden kutu satın alınmış
      // bir rozet YOKSA tamamen boş görünüyordu — am-badge-grid'deki "Zaten Sahipsin" durumu dışında
      // kullanıcı sahip olduğu rozeti hiçbir yerde Hesabım'da görmüyordu. Aynı badge_type zaten aktif
      // bir satın alma satırında varsa (nadir ama olası) tekrar eklenmez.
      const hasActiveSelfOfType = (type) => items.some(b => b.target_type === 'self' && b.status === 'active' && b.badge_type === type);
      if (adminBadges.self && !hasActiveSelfOfType(adminBadges.self)) {
        const tier = BADGE_TIERS.find(t => t.type === adminBadges.self);
        rows.unshift(`
            <div class="my-badge-row">
              <div><strong>${escapeHtml(tier ? tier.label : adminBadges.self)}</strong> — Kendim için</div>
              <div style="display:flex; align-items:center; gap:6px;">
                <span class="badge-status-pill" style="color:${BADGE_STATUS_COLORS.active}; background:${BADGE_STATUS_COLORS.active}22;">Aktif (Yönetici tanımlı)</span>
              </div>
            </div>`);
      }
      if (!rows.length) {
        listEl.style.display = 'none';
      } else {
        listEl.style.display = '';
        listEl.innerHTML = rows.join('');
        listEl.querySelectorAll('.my-badge-delete-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!confirm('Bu reddedilen talebi silmek istediğine emin misin?')) return;
            btn.disabled = true;
            try {
              const delRes = await fetch(`/api/badges/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
              if (delRes.ok) { loadBadges(); return; }
            } catch {}
            btn.disabled = false;
          });
        });
      }
      // Kendisi için hâlihazırda (satın alınmış AKTİF ya da admin tarafından doğrudan verilmiş)
      // eşit ya da daha yüksek kademeli bir rozeti varsa "Satın Al" yerine devre dışı bir durum
      // gösterilir — gerçek bulgu: admin_badges (bkz. src/routes/badges.js#getAdminBadgeForTarget)
      // hiç kontrol edilmiyordu, admin'in doğrudan altın rozet verdiği bir kullanıcı hâlâ her iki
      // kademe için de "Satın Al" görüyordu (kullanıcı isteği: bu kutu artık algılasın).
      const now = Date.now();
      const activeSelf = items.find(b => b.target_type === 'self' && b.status === 'active' && (!b.expires_at || b.expires_at > now));
      const selfRank = Math.max(
        activeSelf ? (BADGE_RANK[activeSelf.badge_type] || 0) : 0,
        adminBadges.self ? (BADGE_RANK[adminBadges.self] ?? Infinity) : 0
      );
      const grid = document.getElementById('am-badge-grid');
      grid.innerHTML = BADGE_TIERS.map(tier => {
        const already = selfRank > 0 && (BADGE_RANK[tier.type] || 0) <= selfRank;
        return `
        <div class="badge-card">
          <div class="badge-card-name">${tier.label}</div>
          <div class="badge-card-price">${formatTRY(tier.selfPrice)} / ay</div>
          ${already
            ? `<span class="badge-buy-btn" style="opacity:.5; pointer-events:none;">Zaten Sahipsin</span>`
            : `<a class="badge-buy-btn" href="/rozet-al?tier=${tier.type}">Satın Al</a>`}
        </div>`;
      }).join('');
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
      const btn = document.getElementById('am-delete-account-btn');
      const msg = document.getElementById('am-delete-account-msg');
      // Giriş yapılan e-posta ile birebir eşleşme (büyük/küçük harf ve baştaki/sondaki boşluk
      // yok sayılır — e-posta adresleri zaten harf büyüklüğünden bağımsız kabul edilir).
      const typed = (document.getElementById('am-delete-confirm-email').value || '').trim().toLowerCase();
      const actual = ((accountUser && accountUser.email) || '').trim().toLowerCase();
      if (!typed) { msg.textContent = 'Silmek için e-posta adresini yaz.'; return; }
      if (!actual || typed !== actual) { msg.textContent = 'E-posta adresi eşleşmiyor.'; return; }
      msg.textContent = '';
      if (!confirm('Hesabınızı silmek istediğinize emin misiniz? Bu işlem geri alınamaz.')) return;
      btn.disabled = true;
      try {
        const res = await fetch('/api/account', { method: 'DELETE' });
        if (!res.ok) throw new Error('request failed');
        window.location.href = '/';
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
      // kullanıcı isteği (2026-08-30): Profil Bilgileri kutusu artık salt bilgi amaçlı — Mimar satırı
      // tamamen kaldırıldı, bu ek firma satırları da Düzenle linki OLMADAN gösterilir. Firma künyesi
      // düzenleme artık TEK yerde: Firma Bilgileri kutusunun başlığındaki "Profili Düzenle" butonu
      // (bkz. renderFirmEditBtn) — ve o buton kutuda GÖSTERİLEN firmayı hedefler, bu listeyi değil.
      // firmInfoKey — künye kutusunda (#am-firm-facts) ZATEN tam olarak gösterilen firma; aynı adı
      // hemen altında ikinci kez listelemek anlamsız olurdu. Bir kullanıcının birden fazla firma
      // talebi olabildiğinden (canlıda var) geri kalanlar bu listede durmaya devam eder — durum
      // etiketleriyle birlikte, çünkü künye kutusu yalnızca BİR firmayı gösterebilir.
      const visibleItems = amClaimItems.filter(c => c.status !== 'rejected' && c.profile_type !== 'architect'
        && !(c.profile_type === 'office' && c.profile_key === firmInfoKey));
      // Bu liste artık "Firma Bilgileri" kutusunda, #am-firm-facts'in ALTINDA duruyor (kullanıcı
      // isteği, 2026-09-01 madde 2) — üstündeki künye satırlarından ayrılması için AYNI .profile-fact
      // çizgisi kutunun üstüne konur; künye hiç çizilmediyse (firma yoksa) çizgiye de gerek yok.
      const factsBox = document.getElementById('am-firm-facts');
      const hasFactsAbove = !!(factsBox && factsBox.querySelector('.profile-fact'));
      if (!visibleItems.length) { list.innerHTML = ''; list.style.borderTop = 'none'; return; }
      list.style.borderTop = hasFactsAbove ? '1px solid var(--line-soft)' : 'none';
      list.innerHTML = visibleItems.map(c => {
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
            ${c.status === 'approved'
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
      loadFirmInfo(items);
    }

    // "Firma Bilgileri" kutusu (kullanıcı isteği, 2026-09-01 madde 2). Kullanıcının bir firmada görev
    // alıp almadığının kaynağı profile_claims('office') satırıdır — Profili Düzenle'deki "Firma"
    // kutusu tam olarak bu talebi oluşturur (bkz. submitFirmaClaimIfChanged), yani bu kutu formda
    // seçilen firmayı gösterir. Onaylı talep beklemedekine tercih edilir; ikisi de yoksa kutu boş
    // durumunu gösterir.
    // İKİNCİ KAYNAK YOK: mimar kaydındaki `office` alanı (architectSyncState.office) BİLEREK
    // kullanılmıyor — o alan formdaki Firma kutusuyla AYNI Kaydet'te senkronlandığından (bkz.
    // submitArchitectSyncIfNeeded'in office parametresi) ayrı bir doğruluk kaynağı değil, yalnızca
    // aynı değerin kopyası; iki kaynak tutarsızlaşırsa hangisinin gösterileceği belirsizleşirdi.
    async function loadFirmInfo(claimItems) {
      const box = document.getElementById('am-firm-facts');
      if (!box) return;
      const claim = claimItems.find(c => c.profile_type === 'office' && c.status === 'approved')
        || claimItems.find(c => c.profile_type === 'office' && c.status === 'pending');
      if (!claim) {
        firmInfoKey = null;
        firmInfoSlug = null;
        firmInfoApproved = false;
        renderFirmEditBtn();
        box.innerHTML = '<div class="dash-empty">Henüz bir firmada görev almıyorsun. Profili Düzenle\'den firmanı seçebilirsin.</div>';
        renderClaimsList();
        return;
      }
      firmInfoApproved = claim.status === 'approved';
      // Künye çekilemese bile buton bir hedefe sahip olsun: talebin kendi slug'ı (yoksa adı).
      firmInfoSlug = claim.slug || claim.profile_key;
      renderFirmEditBtn();
      // Aynı anahtar için ikinci kez ağ isteği atma — loadMyClaims her loadUser()'da çalışıyor.
      if (firmInfoKey === claim.profile_key) return;
      firmInfoKey = claim.profile_key;
      let office = null;
      try {
        const res = await fetch(`/api/office/${encodeURIComponent(claim.profile_key)}`);
        if (res.ok) office = (await res.json()).item;
      } catch {}
      // Firma künyesi çekilemediyse (ağ hatası ya da henüz canonical'a senkronlanmamış bekleyen bir
      // talep) en azından adı gösterilir — kutu asla "Yükleniyor…"da takılı kalmaz.
      const rows = [['Firma', office ? office.name : claim.profile_key]];
      if (office) {
        // cats üç biçimde gelebilir (JSON dizi / ' · ' ayrımlı string / null) — office-kind.js#
        // officeCatList'in tarayıcı tarafında yüklü olduğuna güvenmek yerine (bu dosya onu <script>
        // olarak İSTEMİYOR) burada AYNI iki durum yerinde ele alınır.
        const cats = Array.isArray(office.cats) ? office.cats.join(' · ') : (office.cats || '');
        if (office.loc) rows.push(['Konum', office.loc]);
        if (cats) rows.push(['Hizmet Alanı', cats]);
        if (office.yil) rows.push(['Kuruluş Yılı', String(office.yil)]);
      }
      if (accountUser && accountUser.position) rows.push(['Görevin', accountUser.position]);
      const slug = office && office.slug ? office.slug : '';
      if (slug) { firmInfoSlug = slug; renderFirmEditBtn(); }
      box.innerHTML = rows.map(([label, value], i) => `
        <div class="profile-fact">
          <span class="profile-fact-label">${escapeHtml(label)}</span>
          <span class="profile-fact-value">${i === 0 && slug
            ? `<a href="/firma/${encodeURIComponent(slug)}" style="color:var(--walnut); font-weight:600;">${escapeHtml(value)}</a>`
            : escapeHtml(value)}</span>
        </div>`).join('');
      renderClaimsList();
    }

    // "Firma Bilgileri" kutusunun kendi "Profili Düzenle" butonu (kullanıcı isteği, 2026-09-01
    // madde 1: "Firma bilgilerini sadece firma kurucusu, kurucu ortağı, ortağı ya da ekip lideri
    // değiştirebilsin. Ekip üyesi olanlar değiştiremesin."). Kural İçeriklerim'deki eski
    // "Kişi/Firma Profilim" satırıyla (o kutu bu istekle KALDIRILDI, bkz. contentsTemplate) ve
    // sunucudaki src/routes/submissions.js#OFFICE_EDIT_POSITIONS ile BİREBİR aynı — istemci burada
    // yalnızca butonu gizler, asıl yetki kontrolü her zaman sunucuda tekrar yapılır.
    // accountUser (pozisyon) ve firma talebi (loadMyClaims) BAĞIMSIZ/paralel yüklendiğinden bu
    // fonksiyon her ikisinin de bittiği yerlerden ayrı ayrı çağrılır — hangisi sonra biterse
    // butonu doğru duruma getirir (renderClaimsList ile AYNI desen).
    function renderFirmEditBtn() {
      const btn = document.getElementById('am-firm-edit-btn');
      if (!btn) return;
      const canEdit = !!firmInfoSlug && firmInfoApproved
        && OFFICE_EDIT_POSITIONS.has(accountUser && accountUser.position);
      btn.style.display = canEdit ? '' : 'none';
      if (canEdit) btn.href = `${CLAIM_EDIT_PAGE.office}?claim=${encodeURIComponent(firmInfoSlug)}`;
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
      // Çoklu meslek (kullanıcı isteği, 2026-09-01 madde 6): iki taraf da artık virgüllü olabilir
      // ("Mimar, Fotoğrafçı" ↔ "mimar,fotografci") — her etiket ayrı ayrı ters çevrilir, eşleşmeyen
      // (listede olmayan, elle yazılmış) etiketler sessizce atlanır.
      if (!accountUser.profession && arch.profession) {
        const slugs = String(arch.profession).split(',').map(s => s.trim()).filter(Boolean)
          .map(label => Object.keys(PROFESSION_LABELS).find(k => PROFESSION_LABELS[k] === label))
          .filter(Boolean);
        if (slugs.length) patch.profession = slugs.join(',');
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
    let msgItems = [];
    let msgPage = 1;
    // Bildirimler kutusu — /api/notifications/mine, type==='message' olanlar hariç (bkz. aşağıdaki
    // loadMessages — mesajlar artık kendi ucundan, KONUŞMA başına gruplanmış olarak gelir).
    async function loadNotifications() {
      const res = await fetch('/api/notifications/mine');
      const data = res.ok ? await res.json() : { items: [] };
      notifItems = (data.items || []).filter(n => n.type !== 'message');
      renderNotifications();
    }
    // Mesajlar kutusu — kullanıcı isteği (2026-08-30): her yanıt yeni bir bildirim satırı ("1 Yeni
    // Mesaj") ürettiğinden eskiden aynı konuşma birden çok kez listeleniyordu; artık src/routes/
    // messages.js#listMyThreads KONUŞMA başına TEK satır döner (diğer tarafın adı/fotoğrafı, son
    // mesaj önizlemesi, okunmadı durumu) — Instagram/Messenger'daki mesaj listesiyle aynı model.
    async function loadMessages() {
      const res = await fetch('/api/messages/mine');
      const data = res.ok ? await res.json() : { items: [] };
      msgItems = data.items || [];
      renderMessages();
    }
    // src/routes/messages.js#listMyThreads ile AYNI kısa birim sırası (y/ay/hf/g/sa/dk) — Hesabım
    // dashboard'undaki AYNI satırda kompakt görünmesi için ("6hf" gibi, tam tarih değil).
    function formatRelativeShort(ts) {
      const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
      const units = [['y', 365 * 24 * 3600], ['ay', 30 * 24 * 3600], ['hf', 7 * 24 * 3600], ['g', 24 * 3600], ['sa', 3600], ['dk', 60]];
      for (const [label, secs] of units) {
        const v = Math.floor(diffSec / secs);
        if (v >= 1) return `${v}${label}`;
      }
      return 'az önce';
    }
    // bkz. kullanıcı isteği: Başlığın yanındaki "Tümü okundu"/"Bildirimleri sil" metinleri kaldırıldı
    // — silme artık her satırın kendi X işaretinden, satır-bazlı yapılır (bkz. aşağıdaki .notif-del).
    // Mesaj satırları tıklanınca src/routes/messages.js#getThread'i açan bir popup gösterir (bkz.
    // openMessageThread) — link alanı "msg:<threadId>" biçimindedir (bkz. src/routes/messages.js#
    // createThread/replyThread).
    function threadIdFromLink(link) {
      return link && link.startsWith('msg:') ? link.slice(4) : null;
    }
    function renderNotifList(items, page, setPage, containerId, paginationId, emptyText) {
      const container = document.getElementById(containerId);
      if (!items.length) {
        container.innerHTML = `<div class="dash-empty">${emptyText}</div>`;
        document.getElementById(paginationId).innerHTML = '';
        return;
      }
      const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE_DASH));
      if (page > totalPages) page = totalPages;
      const startIdx = (page - 1) * PAGE_SIZE_DASH;
      const pageItems = items.slice(startIdx, startIdx + PAGE_SIZE_DASH);
      container.innerHTML = pageItems.map(n => `
        <div class="notif-row${n.is_read ? '' : ' unread'}" data-id="${n.id}">
          <div class="notif-dot-col">${n.is_read ? '' : '<span class="notif-dot"></span>'}</div>
          <div style="flex:1; min-width:0;">
            <div class="notif-title">${escapeHtml(n.title)}</div>
            ${n.body ? `<div class="notif-body">${escapeHtml(n.body)}</div>` : ''}
            <div class="notif-meta">${new Date(n.created_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
          </div>
          <button type="button" class="notif-del saved-remove-btn" data-id="${n.id}" aria-label="Bildirimi sil">✕</button>
        </div>`).join('');
      container.querySelectorAll('.notif-row').forEach(row => {
        row.addEventListener('click', async () => {
          const item = items.find(n => String(n.id) === row.dataset.id);
          if (!item) return;
          if (!item.is_read) {
            row.classList.remove('unread');
            const dot = row.querySelector('.notif-dot');
            if (dot) dot.remove();
            item.is_read = true;
            try {
              await fetch(`/api/notifications/${encodeURIComponent(row.dataset.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_read: true }) });
            } catch {}
          }
          const threadId = threadIdFromLink(item.link);
          if (threadId) { openMessageThread(threadId); return; }
          // Kullanıcı isteği (2026-09-02 madde 4): kayıt sonrası gönderilen dizin daveti
          // bildirimine tıklayınca AYNI soruyu evet/hayır ile soran bir pop-up açılır.
          if (item.type === 'directory_invite' || (item.link || '').indexOf('dizin=1') !== -1) {
            openDirectoryPrompt();
          }
        });
      });
      container.querySelectorAll('.notif-del').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          const idx = items.findIndex(n => String(n.id) === String(id));
          if (idx !== -1) items.splice(idx, 1);
          setPage(page);
          try { await fetch(`/api/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch {}
        });
      });
      renderDashPagination(paginationId, page, totalPages, (p) => setPage(p));
    }
    function renderNotifications() {
      renderNotifList(notifItems, notifPage, (p) => { notifPage = p; renderNotifications(); }, 'am-dash-notifications', 'am-notif-pagination', 'Henüz bir bildirimin yok.');
    }
    function renderMessages() {
      const container = document.getElementById('am-dash-messages');
      if (!msgItems.length) {
        container.innerHTML = `<div class="dash-empty">Henüz bir mesajın yok.</div>`;
        document.getElementById('am-msg-pagination').innerHTML = '';
        return;
      }
      const totalPages = Math.max(1, Math.ceil(msgItems.length / PAGE_SIZE_DASH));
      if (msgPage > totalPages) msgPage = totalPages;
      const startIdx = (msgPage - 1) * PAGE_SIZE_DASH;
      const pageItems = msgItems.slice(startIdx, startIdx + PAGE_SIZE_DASH);
      container.innerHTML = pageItems.map(c => {
        const last = c.lastMessage;
        const rawPreview = last ? `${last.isMe ? 'Sen: ' : ''}${last.body}` : '';
        const preview = rawPreview.length > 90 ? rawPreview.slice(0, 90) + '…' : rawPreview;
        const timeText = last ? formatRelativeShort(last.createdAt) : '';
        const photoUrl = c.otherPhotoUrl ? safeUrl(c.otherPhotoUrl) : '';
        const avatarHtml = photoUrl
          ? `<img src="${escapeAttr(avatarImg(c.otherPhotoUrl, 96, photoUrl))}" alt="">`
          : dashInitials(c.otherName);
        return `
        <div class="msg-conv-row${c.unread ? ' unread' : ''}" data-id="${escapeAttr(c.id)}">
          <div class="msg-conv-avatar">${avatarHtml}</div>
          <div class="msg-conv-body">
            <div class="msg-conv-name">${escapeHtml(c.otherName)}</div>
            <div class="msg-conv-preview">${escapeHtml(preview)}${timeText ? ` · ${timeText}` : ''}</div>
          </div>
          ${c.unread ? '<span class="msg-conv-dot" aria-hidden="true"></span>' : ''}
        </div>`;
      }).join('');
      container.querySelectorAll('.msg-conv-row').forEach(row => {
        row.addEventListener('click', () => {
          const item = msgItems.find(c => c.id === row.dataset.id);
          if (item && item.unread) {
            item.unread = false;
            row.classList.remove('unread');
            const dot = row.querySelector('.msg-conv-dot');
            if (dot) dot.remove();
          }
          openMessageThread(row.dataset.id);
        });
      });
      renderDashPagination('am-msg-pagination', msgPage, totalPages, (p) => { msgPage = p; renderMessages(); });
    }

    // Mesaj konuşması popup'ı — bkz. kullanıcı isteği: "Kullanıcı bu mesaja tıklayıp açılan popupta
    // mesajın tamamını okuyabilsin ve gönderenin bilgilerini görebilsin... cevap da yazabilsin...
    // Konuşma geçmişinde önceki cevaplar görüntülenebilsin... Kullanıcılar isterse görüşmeyi
    // sonlandırabilsin." ModalShell'den BAĞIMSIZ, kendi kendine yeten hafif bir overlay (js/components/
    // message-button.js#openCompose İLE AYNI z-index/overlay deseni — Hesabım'ın kendi z-index'i 200,
    // bu üstüne binmeli).
    function closeMessageThread() {
      const overlay = document.getElementById('am-thread-overlay');
      if (overlay) overlay.remove();
    }
    async function openMessageThread(threadId) {
      closeMessageThread();
      const overlay = document.createElement('div');
      overlay.className = 'am-thread-overlay';
      overlay.id = 'am-thread-overlay';
      overlay.innerHTML = `
        <div class="am-thread-panel">
          <button type="button" class="am-thread-close" aria-label="Kapat">&times;</button>
          <div class="am-thread-body">Yükleniyor…</div>
        </div>`;
      document.body.appendChild(overlay);
      const close = () => closeMessageThread();
      overlay.querySelector('.am-thread-close').addEventListener('click', close);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

      let data;
      try {
        const res = await fetch(`/api/messages/threads/${encodeURIComponent(threadId)}`);
        if (!res.ok) throw new Error();
        data = await res.json();
      } catch {
        overlay.querySelector('.am-thread-body').innerHTML = '<div class="dash-empty">Bu konuşma yüklenemedi.</div>';
        return;
      }
      renderThreadBody(overlay, data);
    }
    function renderThreadBody(overlay, data) {
      const bodyEl = overlay.querySelector('.am-thread-body');
      const s = data.sender;
      bodyEl.innerHTML = `
        <h2 class="am-thread-title">${data.isSender ? 'Gönderdiğin Mesaj' : 'Gelen Mesaj'}</h2>
        <div class="am-thread-sender">
          <div class="am-thread-sender-row"><strong>${escapeHtml(s.name)}</strong><span>${escapeHtml(s.email)}</span></div>
          ${(s.city || s.company || s.phone) ? `<div class="am-thread-sender-row am-thread-sender-extra">${[s.city, s.company, s.phone].filter(Boolean).map(escapeHtml).join(' · ')}</div>` : ''}
        </div>
        <div class="am-thread-messages">${data.messages.map(m => `
          <div class="am-thread-msg${m.isMe ? ' me' : ''}">
            <div class="am-thread-msg-meta">${escapeHtml(m.senderName)} · ${new Date(m.createdAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
            <div class="am-thread-msg-body">${escapeHtml(m.body)}</div>
          </div>`).join('')}
        </div>
        ${data.status === 'closed'
          ? '<p class="am-thread-closed-note">Bu görüşme sonlandırıldı.</p><button type="button" class="am-thread-reopen-btn" id="am-thread-reopen-btn">Görüşmeyi Yeniden Başlat</button>'
          : `<form class="am-thread-reply-form" id="am-thread-reply-form">
              <textarea id="am-thread-reply-text" placeholder="Cevabını yaz..." required maxlength="4000"></textarea>
              <div class="am-thread-reply-actions">
                <button type="button" class="am-thread-end-btn" id="am-thread-end-btn">Görüşmeyi Sonlandır</button>
                <button type="submit" class="am-thread-send-btn">Gönder</button>
              </div>
            </form>`}
        <div class="am-thread-error" id="am-thread-error" style="display:none;"></div>`;

      const replyForm = bodyEl.querySelector('#am-thread-reply-form');
      if (replyForm) {
        replyForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const textarea = document.getElementById('am-thread-reply-text');
          const text = textarea.value.trim();
          if (!text) return;
          const sendBtn = replyForm.querySelector('.am-thread-send-btn');
          sendBtn.disabled = true;
          try {
            const res = await fetch(`/api/messages/threads/${encodeURIComponent(data.id)}/reply`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: text }),
            });
            if (!res.ok) throw new Error();
            const res2 = await fetch(`/api/messages/threads/${encodeURIComponent(data.id)}`);
            const data2 = await res2.json();
            renderThreadBody(overlay, data2);
          } catch {
            const errEl = document.getElementById('am-thread-error');
            errEl.textContent = 'Mesaj gönderilemedi, lütfen tekrar dene.';
            errEl.style.display = 'block';
            sendBtn.disabled = false;
          }
        });
        const endBtn = bodyEl.querySelector('#am-thread-end-btn');
        endBtn.addEventListener('click', async () => {
          if (!confirm('Bu görüşmeyi sonlandırmak istediğine emin misin?')) return;
          try {
            await fetch(`/api/messages/threads/${encodeURIComponent(data.id)}/close`, { method: 'POST' });
            const res2 = await fetch(`/api/messages/threads/${encodeURIComponent(data.id)}`);
            const data2 = await res2.json();
            renderThreadBody(overlay, data2);
          } catch {}
        });
      }
      const reopenBtn = bodyEl.querySelector('#am-thread-reopen-btn');
      if (reopenBtn) {
        reopenBtn.addEventListener('click', async () => {
          reopenBtn.disabled = true;
          try {
            const res = await fetch(`/api/messages/threads/${encodeURIComponent(data.id)}/reopen`, { method: 'POST' });
            if (!res.ok) throw new Error();
            const res2 = await fetch(`/api/messages/threads/${encodeURIComponent(data.id)}`);
            const data2 = await res2.json();
            renderThreadBody(overlay, data2);
          } catch {
            reopenBtn.disabled = false;
          }
        });
      }
    }

    loadUser().then(() => {
      if (accountUser) {
        [loadBadges(), loadMyClaims(), loadPublicBadgesForClaims(), loadNotifications(), loadMessages()]
          .forEach(p => p.catch(() => {}));
        if (new URLSearchParams(window.location.search).get('payment') === 'success') {
          document.getElementById('am-payment-success-banner').style.display = 'block';
        }
      }
    });
  }

  // ---------------------------------------------------------------------------------------------
  // AKTİVİTELERİM — Takip Ettiklerim/Beğendiklerim/Yorumlarım. mountAccount()'un
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
    // "Ürün" filtresi hem product hem material tipini kapsar — urun.html'de bu ikisi zaten TEK
    // katalog olarak birleşti, Beğendiklerim'de ayrı bir "Malzeme" butonu olmadığından ikisi de tek
    // "Ürün" butonunun altında toplanır. (Kaydettiklerim bu görünümden kaldırıldı, bkz. şablon
    // yorumu — bu yardımcı hâlâ renderRated/renderFollowFeed tarafından kullanılıyor.)
    function matchesCatalogFilter(itemType, filter) {
      if (!filter) return true;
      if (filter === 'product') return itemType === 'product' || itemType === 'material';
      return itemType === filter;
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
        container.innerHTML = '<div class="dash-empty">Henüz puanladığın bir içerik yok.<br><a href="/proje">Projelere göz at</a></div>';
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
        container.innerHTML = '<div class="dash-empty">Henüz bir yorum yapmadın.<br><a href="/proje">Projelere göz at</a></div>';
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

    // Paylaştıklarım — loadRated/renderRated İLE BİREBİR AYNI desen (ham liste + sekme filtresi +
    // PAGE_SIZE_DASH sayfalaması istemcide), kaynağı /api/shares (bkz. src/routes/shares.js).
    let shareItems = [];
    let sharesFilter = '';
    let sharesPage = 1;
    async function loadShares() {
      const res = await fetch('/api/shares');
      const data = res.ok ? await res.json() : { items: [] };
      shareItems = data.items || [];
      renderShares();
    }
    function renderShares() {
      const container = document.getElementById('am-dash-shares');
      if (!container) return;
      const items = sharesFilter ? shareItems.filter(it => matchesCatalogFilter(it.item_type, sharesFilter)) : shareItems;
      if (!shareItems.length) {
        container.innerHTML = '<div class="dash-empty">Henüz bir içerik paylaşmadın.<br>Bir proje ya da ürün popup\'ındaki Paylaş butonunu kullandığında burada listelenir.<br><a href="/proje">Projelere göz at</a></div>';
        document.getElementById('am-shares-pagination').innerHTML = '';
        return;
      }
      if (!items.length) {
        container.innerHTML = '<div class="dash-empty">Bu türde paylaştığın bir içerik yok.</div>';
        document.getElementById('am-shares-pagination').innerHTML = '';
        return;
      }
      const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE_DASH));
      if (sharesPage > totalPages) sharesPage = totalPages;
      const startIdx = (sharesPage - 1) * PAGE_SIZE_DASH;
      const pageItems = items.slice(startIdx, startIdx + PAGE_SIZE_DASH);
      container.innerHTML = pageItems.map(it => {
        const metaBits = [SAVED_TYPE_LABELS[it.item_type] || '', SHARE_CHANNEL_LABELS[it.channel] || '', it.item_meta || ''].filter(Boolean);
        return `
        <div class="saved-row" data-id="${escapeAttr(it.id)}">
          <a class="saved-row-link" href="${escapeAttr(safeUrl(it.item_href) || '#')}">
            ${it.item_image && safeUrl(it.item_image) ? `<img src="${escapeAttr(safeUrl(it.item_image))}" alt="" loading="lazy" decoding="async">` : `<div class="saved-row-noimg"></div>`}
            <div style="min-width:0;">
              <div class="saved-row-title">${escapeHtml(it.item_title || it.item_key || '—')}</div>
              <div class="saved-row-meta">${escapeHtml(metaBits.join(' · '))}</div>
            </div>
          </a>
          <button class="saved-remove-btn" type="button" aria-label="Kaldır">✕</button>
        </div>`;
      }).join('');
      container.querySelectorAll('.saved-remove-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const row = btn.closest('.saved-row');
          btn.disabled = true;
          try {
            await fetch(`/api/shares/${encodeURIComponent(row.dataset.id)}`, { method: 'DELETE' });
            loadShares();
          } catch { btn.disabled = false; }
        });
      });
      renderDashPagination('am-shares-pagination', sharesPage, totalPages, (p) => { sharesPage = p; renderShares(); });
    }
    on('am-shares-filter', 'click', (e) => {
      const btn = e.target.closest('.saved-filter-btn');
      if (!btn) return;
      sharesFilter = btn.dataset.filter;
      sharesPage = 1;
      document.querySelectorAll('#am-shares-filter .saved-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderShares();
    });

    fetch('/api/auth/me').then(r => {
      if (!r.ok) { swap('login'); return; }
      [loadRated(), loadComments(), loadShares()].forEach(p => p.catch(() => {}));
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
        // Ekleme bağlantıları BİLEREK yok (kullanıcı isteği, 2026-09-01 madde 3: bu kutudaki
        // "Proje Ekle/Ürün Ekle/..." yazıları kaldırıldı) — yol nav/footer'daki "İçerik Ekle".
        container.innerHTML = '<div class="dash-empty">Henüz bir içerik göndermedin.</div>';
        document.getElementById('am-submissions-pagination').innerHTML = '';
        return;
      }
      // 'brands' gerçek bir gönderi tipi DEĞİL (bkz. şablondaki yorum): offices gönderilerinin
      // marka olanları. 'offices' (Firma) ise simetrik olarak marka OLMAYANLARI gösterir — aksi
      // halde her marka iki filtrede birden çıkar ve iki buton ayırt edici olmaktan çıkardı.
      const matchesSubmissionFilter = (s) => {
        if (!submissionsFilter) return true;
        if (submissionsFilter === 'brands') return s.type === 'offices' && !!s.item.isBrand;
        if (submissionsFilter === 'offices') return s.type === 'offices' && !s.item.isBrand;
        return s.type === submissionsFilter;
      };
      const all = submissionsFilter ? allSubmissions.filter(matchesSubmissionFilter) : allSubmissions;
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
            <div style="font-size:11.5px; color:var(--ink-soft);">${submissionTypeLabel(type, item)} · ${new Date(item.created_at).toLocaleDateString('tr-TR')}</div>
          </div>
          <div style="display:flex; align-items:center; gap:10px; flex-shrink:0;">
            ${(type === 'products' || type === 'materials') ? '' : `<a class="submission-edit-link" href="${editPageFor(type, item)}?edit=${encodeURIComponent(item.id)}&stype=${encodeURIComponent(type)}">Düzenle</a>`}
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

    // "Kişi/Firma Profilim" kutusu KALDIRILDI (kullanıcı isteği, 2026-09-01 madde 2) — hesaba bağlı
    // mimar/firma profili ve firma künyesinin "Profili Düzenle" butonu artık YALNIZCA Hesabım
    // popup'ındaki Profil Bilgileri / Firma Bilgileri kutularında duruyor (bkz. accountTemplate,
    // renderClaimsList, renderFirmEditBtn). Bu kutunun kendi /api/claims/mine fetch'i de bu yüzden
    // tamamen kaldırıldı — İçeriklerim artık yalnızca "Eklediklerim"i yükler.
    fetch('/api/auth/me').then(r => {
      if (!r.ok) { swap('login'); return; }
      loadSubmissions().catch(() => {});
    }).catch(() => {});
  }

  // Koleksiyonum'un mount fonksiyonu — mountContents() ile AYNI iskelet (wired Set'i + on() yardımcısı
  // ile idempotent dinleyici bağlama, sonda TEK bir /api/auth/me kontrolü). Tüm veri
  // /api/collections* uçlarından gelir (bkz. src/routes/collections.js).
  function mountCollections() {
    const wired = new Set();
    function on(id, evt, fn) {
      const key = id + ':' + evt;
      if (wired.has(key)) return;
      wired.add(key);
      const el = document.getElementById(id);
      if (el) el.addEventListener(evt, fn);
    }
    let collections = [];
    let openCollection = null; // { item, items } — açık pano; null ise liste görünümü
    let savedItemsCache = null;

    // Kart altındaki son düzenleme tarihi (kullanıcı isteği, 2026-08-31). collections.updated_at bir
    // epoch-ms sayısıdır (bkz. src/routes/collections.js) — bugün düzenlenmiş panolar "Bugün",
    // dün olanlar "Dün" der, öncesi kısa tarih; böylece kart altyazısı sayı yığınına dönmez.
    function formatCollectionDate(ts) {
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return '';
      const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
      const dayDiff = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
      if (dayDiff <= 0) return 'Bugün';
      if (dayDiff === 1) return 'Dün';
      return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function notice(id, message, isError) {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = message || '';
      el.style.color = isError ? '#B84C4C' : 'var(--walnut)';
    }

    // Kart mozaiği — panonun ilk 4 görselinden (yoksa boş bir kutu). background-image kullanılır ki
    // 4 farklı en-boy oranındaki görsel tek bir kareye eşit şekilde sığsın (object-fit:cover'ın
    // <img> karşılığı). safeUrl: saved_items'takiyle AYNI göreli/mutlak yol sorunu (bkz. bu dosyanın
    // başındaki safeUrl yorumu) burada da geçerli.
    function mosaicHtml(previewImages) {
      const images = (previewImages || []).map(safeUrl).filter(Boolean).slice(0, 4);
      if (!images.length) return '<div class="col-card-empty">Henüz boş</div>';
      const cls = images.length === 1 ? 'col-card-mosaic col-card-mosaic-single' : 'col-card-mosaic';
      const cells = images.map(u => `<span style="background-image:url('${escapeAttr(avatarImg(u, 320, u))}')"></span>`).join('');
      return `<div class="${cls}">${cells}</div>`;
    }

    function renderList() {
      const container = document.getElementById('am-col-list');
      if (!container) return;
      if (!collections.length) {
        container.innerHTML = '<div class="dash-empty">Henüz bir panon yok.<br>Yukarıdaki kutuya bir isim yazıp ilk panonu oluştur.</div>';
        return;
      }
      container.innerHTML = `<div class="col-grid">${collections.map(c => `
        <button type="button" class="col-card" data-col-id="${escapeAttr(c.id)}">
          ${mosaicHtml(c.previewImages)}
          <div class="col-card-body">
            <div class="col-card-title">${escapeHtml(c.title)}</div>
            <div class="col-card-count">${c.itemCount} öğe${c.updated_at ? ` · ${formatCollectionDate(c.updated_at)}` : ''}</div>
          </div>
        </button>`).join('')}</div>`;
    }

    async function loadCollections() {
      try {
        const res = await fetch('/api/collections');
        const data = res.ok ? await res.json() : { items: [] };
        collections = data.items || [];
      } catch { collections = []; }
      renderList();
    }

    function showList() {
      openCollection = null;
      document.getElementById('am-col-list-view').style.display = '';
      document.getElementById('am-col-detail-view').style.display = 'none';
      loadCollections();
    }

    function renderDetail() {
      if (!openCollection) return;
      document.getElementById('am-col-detail-title-text').textContent = openCollection.item.title;
      document.getElementById('am-col-detail-count').textContent = `${openCollection.items.length} öğe`;
      // Paylaşım durumu — sunucu shapeCollection'da shareToken döner (bkz. src/routes/collections.js).
      const shareBtn = document.getElementById('am-col-share-btn');
      if (shareBtn) shareBtn.textContent = openCollection.item.shareToken ? 'Paylaşımı Durdur' : 'Paylaş';
      // NOT: Dışa Aktar'ın rozet kontrolü BİLEREK burada YAPILMAZ. renderDetail(), loadBadges()
      // tamamlanmadan ÖNCE de çalışabiliyor (ikisi bağımsız/paralel yükleniyor, bkz. amBadgeItems
      // yorumu) — burada hesaplanan bir "rozetin yok" durumu, rozet verisi sonradan gelse bile
      // butonda donup kalıyordu. Kontrol artık tıklama anında yapılıyor (bkz. am-col-export-btn).
      const container = document.getElementById('am-col-items');
      if (!openCollection.items.length) {
        container.innerHTML = '<div class="dash-empty">Bu pano henüz boş.<br>Yukarıdaki butonlarla kaydettiğin içerikleri, kendi görsellerini ya da notlarını ekleyebilirsin.</div>';
        return;
      }
      container.innerHTML = `<div class="col-item-grid">${openCollection.items.map((it, i) => {
        const image = safeUrl(it.image);
        const href = safeUrl(it.href);
        // 'note' türünde görsel yok, metin kartın kendisi olur; 'image'/'saved' türünde görsel üstte,
        // başlık altta. Başlık yalnızca href varsa (yani sitedeki bir kayda işaret ediyorsa) linktir.
        // Tıklayınca görsel büyür (kullanıcı isteği, 2026-09-02: "tıklanan görsel popup şeklinde
        // büyüsün, aynı proje medyasında olduğu gibi") — bkz. js/components/image-lightbox.js.
        // data-lightbox-src ORİJİNALİ taşır: kart 400 px'lik türevi gösterir, büyütmede tam
        // çözünürlük istenir. Başlıktaki <a> ETKİLENMEZ (lightbox yalnızca görselin kendisinde).
        const media = image
          ? `<img class="col-item-media img-zoomable" src="${escapeAttr(avatarImg(image, 400, image))}" data-lightbox-src="${escapeAttr(image)}" data-lightbox-alt="${escapeAttr(it.title || '')}" alt="" loading="lazy" decoding="async">`
          : (it.kind === 'note' ? `<div class="col-item-note">${escapeHtml(it.note)}</div>` : '');
        const titleText = it.title || (it.kind === 'note' ? '' : '—');
        const titleHtml = titleText
          ? `<div class="col-item-title">${href ? `<a href="${escapeAttr(href)}">${escapeHtml(titleText)}</a>` : escapeHtml(titleText)}</div>`
          : '';
        const metaHtml = it.meta ? `<div class="col-item-meta">${escapeHtml(it.meta)}</div>` : '';
        const body = (titleHtml || metaHtml) ? `<div class="col-item-body">${titleHtml}${metaHtml}</div>` : '';
        // Sıra değiştirme okları — ilk öğede "geri", son öğede "ileri" devre dışı.
        const moveHtml = `
          <div class="col-item-move">
            <button type="button" data-move="up" aria-label="Öne al"${i === 0 ? ' disabled' : ''}>‹</button>
            <button type="button" data-move="down" aria-label="Geriye al"${i === openCollection.items.length - 1 ? ' disabled' : ''}>›</button>
          </div>`;
        return `
        <div class="col-item" data-item-id="${escapeAttr(it.id)}">
          ${media}${body}
          ${moveHtml}
          <button type="button" class="col-item-remove" aria-label="Kaldır">✕</button>
        </div>`;
      }).join('')}</div>`;
    }

    // Sıra değiştirme (kullanıcı isteği, 2026-08-31) — yeni sıra ÖNCE yerel state'te uygulanıp
    // hemen yeniden çizilir (anında geri bildirim), sonra sunucuya TÜM liste olarak yazılır (bkz.
    // src/routes/collections.js#reorderItems). Yazma başarısız olursa sunucudaki gerçek sıra geri
    // yüklenir, böylece ekran D1 ile tutarsız kalmaz.
    async function moveItem(itemId, direction) {
      if (!openCollection) return;
      const items = openCollection.items;
      const from = items.findIndex(it => it.id === itemId);
      if (from < 0) return;
      const to = direction === 'up' ? from - 1 : from + 1;
      if (to < 0 || to >= items.length) return;
      [items[from], items[to]] = [items[to], items[from]];
      renderDetail();
      try {
        const res = await fetch(`/api/collections/${encodeURIComponent(openCollection.item.id)}/items`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order: items.map(it => it.id) }),
        });
        if (!res.ok) throw new Error('reorder failed');
      } catch {
        notice('am-col-detail-notice', 'Sıra kaydedilemedi, tekrar dene.', true);
        await reloadDetail();
      }
    }

    async function openDetail(id) {
      document.getElementById('am-col-list-view').style.display = 'none';
      document.getElementById('am-col-detail-view').style.display = '';
      ['am-col-add-saved', 'am-col-add-image', 'am-col-add-note'].forEach(panelId => {
        document.getElementById(panelId).style.display = 'none';
      });
      notice('am-col-detail-notice', '');
      document.getElementById('am-col-items').innerHTML = '<div class="dash-empty">Yükleniyor…</div>';
      try {
        const res = await fetch(`/api/collections/${encodeURIComponent(id)}`);
        if (!res.ok) { showList(); return; }
        openCollection = await res.json();
      } catch { showList(); return; }
      renderDetail();
    }

    async function reloadDetail() {
      if (!openCollection) return;
      await openDetail(openCollection.item.id);
    }

    // ---- pano oluşturma / silme / yeniden adlandırma ----
    async function createCollection() {
      const input = document.getElementById('am-col-new-title');
      const title = input.value.trim();
      if (!title) { input.focus(); return; }
      notice('am-col-list-notice', '');
      try {
        const res = await fetch('/api/collections', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        });
        const data = await res.json();
        if (!res.ok) { notice('am-col-list-notice', data.error || 'Pano oluşturulamadı.', true); return; }
        input.value = '';
        await loadCollections();
        openDetail(data.item.id);
      } catch { notice('am-col-list-notice', 'Sunucuya ulaşılamadı, tekrar dene.', true); }
    }

    on('am-col-create-btn', 'click', createCollection);
    on('am-col-new-title', 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); createCollection(); } });
    on('am-col-list', 'click', (e) => {
      const card = e.target.closest('.col-card');
      if (card) openDetail(card.dataset.colId);
    });
    on('am-col-back-btn', 'click', showList);

    on('am-col-rename-btn', 'click', async () => {
      if (!openCollection) return;
      const title = window.prompt('Panonun yeni adı:', openCollection.item.title);
      if (title === null) return;
      if (!title.trim()) return;
      try {
        const res = await fetch(`/api/collections/${encodeURIComponent(openCollection.item.id)}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim() }),
        });
        if (!res.ok) { notice('am-col-detail-notice', 'Ad değiştirilemedi.', true); return; }
        openCollection.item.title = title.trim();
        renderDetail();
      } catch { notice('am-col-detail-notice', 'Sunucuya ulaşılamadı, tekrar dene.', true); }
    });

    // Panoyu PDF olarak dışa aktar (kullanıcı isteği, 2026-09-02 madde 5).
    //
    // NEDEN window.print(): bu repoda HİÇ npm bağımlılığı yok ve CSP dış script'leri engelliyor
    // (bkz. src/index.js#SECURITY_HEADERS) — jsPDF/pdfmake gibi bir kütüphane ne paketlenebilir
    // ne CDN'den çekilebilir. Tarayıcının kendi "PDF olarak kaydet" çıktısı bağımlılıksız,
    // vektörel (metin seçilebilir/aranabilir) ve baskıya hazır bir PDF üretir. Yazdırma penceresi
    // AYRI bir sekmede açılır: mevcut pop-up'ın DOM'una/kaydırma kilidine hiç dokunulmaz.
    function exportBoardPdf() {
      if (!openCollection) return;
      const c = openCollection.item, items = openCollection.items || [];
      const esc = (v) => escapeHtml(v == null ? '' : String(v));
      const cards = items.map((it, i) => {
        const image = safeUrl(it.image);
        const media = image
          ? `<img src="${escapeAttr(image)}" alt="">`
          : (it.kind === 'note' ? `<div class="note">${esc(it.note)}</div>` : '<div class="ph"></div>');
        const meta = [it.meta, it.itemType].filter(Boolean).join(' · ');
        return `<figure class="card">${media}
          <figcaption><span class="n">${i + 1}</span><b>${esc(it.title || (it.kind === 'note' ? 'Not' : '—'))}</b>
          ${meta ? `<span class="m">${esc(meta)}</span>` : ''}</figcaption></figure>`;
      }).join('');
      const today = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
      // Tamamen kendi kendine yeten bir belge — dış CSS/font/script YOK, bu yüzden yazdırma
      // önizlemesi ağ beklemeden anında hazır olur.
      const doc = `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8">
<title>${esc(c.title)} — MİMARLAB</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  *{box-sizing:border-box;}
  body{margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif; color:#1B2A3D; -webkit-print-color-adjust:exact; print-color-adjust:exact;}
  header{border-bottom:2px solid #1B2A3D; padding-bottom:10px; margin-bottom:18px; display:flex; align-items:baseline; justify-content:space-between; gap:16px;}
  h1{font-size:20pt; margin:0; letter-spacing:-0.01em;}
  .sub{font-size:9pt; color:#4E6478; white-space:nowrap;}
  .grid{display:grid; grid-template-columns:repeat(3,1fr); gap:10mm 6mm;}
  .card{margin:0; break-inside:avoid; page-break-inside:avoid;}
  .card img,.card .ph,.card .note{width:100%; aspect-ratio:4/3; object-fit:cover; border-radius:3mm; background:#E0E6EC; display:block;}
  .card .note{aspect-ratio:auto; min-height:26mm; padding:4mm; font-size:8.5pt; line-height:1.5; white-space:pre-wrap; overflow:hidden;}
  figcaption{margin-top:2mm; font-size:8.5pt; line-height:1.35;}
  figcaption .n{display:inline-block; min-width:5mm; color:#7A8CA0;}
  figcaption b{font-weight:600;}
  figcaption .m{display:block; color:#4E6478; margin-left:5mm;}
  footer{margin-top:14mm; padding-top:6px; border-top:1px solid #C9D3DD; font-size:8pt; color:#7A8CA0; display:flex; justify-content:space-between;}
  @media print { .noprint{display:none;} }
</style></head><body>
<header><h1>${esc(c.title)}</h1><div class="sub">${items.length} öğe · ${esc(today)}</div></header>
${items.length ? `<div class="grid">${cards}</div>` : '<p>Bu pano boş.</p>'}
<footer><span>MİMARLAB — mimarlab.com</span><span>${esc(c.title)}</span></footer>
<script>window.addEventListener('load', function(){ setTimeout(function(){ window.print(); }, 400); });<\/script>
</body></html>`;
      const w = window.open('', '_blank');
      if (!w) { notice('am-col-detail-notice', 'Yazdırma penceresi engellendi — tarayıcı açılır pencere iznini kontrol et.', true); return; }
      w.document.write(doc);
      w.document.close();
    }

    on('am-col-export-btn', 'click', () => {
      // GERÇEK BULGU (kullanıcı bildirimi: "dışa aktar butonu çalışmıyor"): ilk sürüm yetkiyi ham
      // `amBadgeItems` (kullanıcının KENDİ badge_requests satırları) üzerinden hesaplıyordu. Bu,
      // proje belleğindeki "profileBadges tek kaynak" kuralının tam olarak uyardığı hata:
      //   * admin tarafından verilen rozetler badge_requests'te DEĞİL admin_badges'tedir,
      //   * bir firmanın rozetini BAŞKA bir ortak satın almış olabilir (satır onun user_id'sinde).
      // Her iki durumda da kullanıcının rozeti profilinde GÖRÜNÜR ama `items` boştur -> buton
      // haksız yere kilitleniyordu (canlı veriyle doğrulandı: Kaan Çorbacı'nın badge_requests'te 0,
      // admin_badges'te 2 rozeti var). Doğru kaynak amHasAnyBadge() -> amPublicBadges, yani
      // profilde FİİLEN görünen rozet haritası; admin override'ı ve firma rozetini de kapsar.
      const msgEl = document.getElementById('am-col-detail-notice');
      if (!amHasAnyBadge()) {
        // Uyarıda "rozet al" altı çizili bir bağlantıdır (kullanıcı isteği, 2026-09-02).
        // notice() burada KULLANILAMAZ: textContent atadığı için bağlantıyı düz metne çevirirdi.
        // Rengi elle veriyoruz çünkü notice() önceki çağrılarında el.style.color'ı bırakmış olabilir.
        if (msgEl) {
          msgEl.style.color = '#B84C4C';
          msgEl.innerHTML = 'Sadece rozeti olan kullanıcılar kullanabilir, '
            + '<a href="/rozet-al" style="color:inherit; text-decoration:underline; font-weight:600;">rozet al</a>.';
        }
        return;
      }
      if (msgEl) msgEl.textContent = '';
      exportBoardPdf();
    });

    // Paylaş / Paylaşımı Durdur (kullanıcı isteği, 2026-09-02). Açıkken bağlantı panoya özel,
    // tahmin edilemez bir token taşır (bkz. src/routes/collections.js#shareCollection) ve
    // /pano/<token> adresinden oturum GEREKMEDEN görüntülenir. Kapatınca bağlantı ölür.
    on('am-col-share-btn', 'click', async () => {
      if (!openCollection) return;
      const alreadyShared = !!openCollection.item.shareToken;
      try {
        if (alreadyShared) {
          if (!window.confirm('Paylaşımı durdurmak istediğine emin misin? Daha önce paylaştığın bağlantı çalışmayacak.')) return;
          const res = await fetch(`/api/collections/${encodeURIComponent(openCollection.item.id)}/share`, { method: 'DELETE' });
          if (!res.ok) { notice('am-col-detail-notice', 'Paylaşım durdurulamadı.', true); return; }
          openCollection.item.shareToken = null;
          renderDetail();
          notice('am-col-detail-notice', 'Panonun paylaşımı durduruldu.');
          return;
        }
        const res = await fetch(`/api/collections/${encodeURIComponent(openCollection.item.id)}/share`, { method: 'POST' });
        if (!res.ok) { notice('am-col-detail-notice', 'Pano paylaşılamadı.', true); return; }
        const data = await res.json();
        openCollection.item.shareToken = data.shareToken;
        renderDetail();
        const shareUrl = location.origin + '/pano/' + data.shareToken;
        // Panoyu paylaşmanın kendisi bir yazma işlemi DEĞİL, bağlantıyı kullanıcıya vermek — bu
        // yüzden önce panoya özel bir paylaşım denenir (mobilde yerel paylaşım sayfası), yoksa
        // panoya kopyalanır. İkisi de yoksa bağlantı bildirim satırında düz metin olarak gösterilir
        // ki kullanıcı elle kopyalayabilsin (bkz. js/components/share-button.js'teki AYNI desen).
        let done = '';
        if (navigator.share) {
          try { await navigator.share({ title: openCollection.item.title, url: shareUrl }); done = 'Pano paylaşıldı.'; }
          catch { done = ''; } // kullanıcı paylaşım sayfasını kapattı — aşağıdaki kopyalamaya düş
        }
        if (!done && navigator.clipboard && navigator.clipboard.writeText) {
          try { await navigator.clipboard.writeText(shareUrl); done = 'Paylaşım bağlantısı kopyalandı: ' + shareUrl; } catch { done = ''; }
        }
        notice('am-col-detail-notice', done || ('Paylaşım bağlantısı: ' + shareUrl));
      } catch { notice('am-col-detail-notice', 'Sunucuya ulaşılamadı, tekrar dene.', true); }
    });

    on('am-col-delete-btn', 'click', async () => {
      if (!openCollection) return;
      if (!window.confirm('Bu panoyu silmek istediğine emin misin? İçindeki tüm öğeler de silinir.')) return;
      try {
        await fetch(`/api/collections/${encodeURIComponent(openCollection.item.id)}`, { method: 'DELETE' });
        showList();
      } catch { notice('am-col-detail-notice', 'Sunucuya ulaşılamadı, tekrar dene.', true); }
    });

    // ---- öğe ekleme panelleri ----
    on('am-col-detail-view', 'click', (e) => {
      const toggle = e.target.closest('[data-col-add]');
      if (!toggle) return;
      const panelId = `am-col-add-${toggle.dataset.colAdd}`;
      ['am-col-add-saved', 'am-col-add-image', 'am-col-add-note'].forEach(id => {
        const el = document.getElementById(id);
        el.style.display = (id === panelId && el.style.display === 'none') ? '' : 'none';
      });
      if (toggle.dataset.colAdd === 'saved' && document.getElementById('am-col-add-saved').style.display !== 'none') loadSavedPicker();
    });

    async function addItem(payload) {
      if (!openCollection) return;
      notice('am-col-detail-notice', '');
      try {
        const res = await fetch(`/api/collections/${encodeURIComponent(openCollection.item.id)}/items`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) { notice('am-col-detail-notice', data.error || 'Öğe eklenemedi.', true); return; }
        if (data.duplicate) { notice('am-col-detail-notice', 'Bu içerik zaten bu panoda.'); return; }
        await reloadDetail();
      } catch { notice('am-col-detail-notice', 'Sunucuya ulaşılamadı, tekrar dene.', true); }
    }

    async function loadSavedPicker() {
      const picker = document.getElementById('am-col-saved-picker');
      if (savedItemsCache === null) {
        try {
          const res = await fetch('/api/saved');
          const data = res.ok ? await res.json() : { items: [] };
          savedItemsCache = data.items || [];
        } catch { savedItemsCache = []; }
      }
      if (!savedItemsCache.length) {
        picker.innerHTML = '<div class="dash-empty">Henüz kaydettiğin bir içerik yok.<br><a href="/proje">Projelere göz at</a></div>';
        return;
      }
      picker.innerHTML = savedItemsCache.map((it, i) => {
        const image = safeUrl(it.item_image);
        return `
        <button type="button" class="col-saved-option" data-saved-index="${i}">
          ${image ? `<img src="${escapeAttr(avatarImg(image, 240, image))}" alt="" loading="lazy" decoding="async">` : '<img alt="">'}
          <div class="col-saved-option-title">${escapeHtml(it.item_title || '—')}</div>
        </button>`;
      }).join('');
    }

    on('am-col-saved-picker', 'click', (e) => {
      const option = e.target.closest('.col-saved-option');
      if (!option) return;
      const it = savedItemsCache[parseInt(option.dataset.savedIndex, 10)];
      if (!it) return;
      addItem({
        kind: 'saved', itemType: it.item_type, itemKey: it.item_key,
        title: it.item_title || '', meta: it.item_meta || '', image: it.item_image || '', href: it.item_href || '',
      });
    });

    // Görsel yükleme — hesabim.html/proje-ekle.html'deki AYNI /api/uploads ucu (bkz. src/routes/
    // upload.js): FormData ile POST edilir, dönen /media/... yolu öğe olarak eklenir.
    on('am-col-image-btn', 'click', () => document.getElementById('am-col-image-input').click());
    on('am-col-image-input', 'change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      notice('am-col-detail-notice', 'Görsel yükleniyor…');
      try {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/uploads', { method: 'POST', body: form });
        const data = await res.json();
        if (!res.ok) { notice('am-col-detail-notice', data.error || 'Görsel yüklenemedi.', true); return; }
        await addItem({ kind: 'image', image: data.url, title: file.name.replace(/\.[^.]+$/, '').slice(0, 120) });
      } catch { notice('am-col-detail-notice', 'Görsel yüklenemedi, tekrar dene.', true); }
    });

    on('am-col-note-save-btn', 'click', async () => {
      const textarea = document.getElementById('am-col-note-text');
      const note = textarea.value.trim();
      if (!note) { textarea.focus(); return; }
      await addItem({ kind: 'note', note });
      textarea.value = '';
    });

    on('am-col-items', 'click', async (e) => {
      const moveBtn = e.target.closest('.col-item-move button');
      if (moveBtn) {
        const itemEl = moveBtn.closest('.col-item');
        if (itemEl) moveItem(itemEl.dataset.itemId, moveBtn.dataset.move);
        return;
      }
      const removeBtn = e.target.closest('.col-item-remove');
      if (!removeBtn || !openCollection) return;
      const itemEl = removeBtn.closest('.col-item');
      removeBtn.disabled = true;
      try {
        await fetch(`/api/collections/${encodeURIComponent(openCollection.item.id)}/items/${encodeURIComponent(itemEl.dataset.itemId)}`, { method: 'DELETE' });
        await reloadDetail();
      } catch { removeBtn.disabled = false; }
    });

    // ---- Kaydettiklerim kutusu (kullanıcı isteği, 2026-08-31) ----
    // Sitedeki TEK Kaydettiklerim kutusu burasıdır: önce Aktivitelerim'in yanına eklenmişti, sonra
    // kullanıcı isteğiyle oradan tamamen kaldırıldı (bkz. activitiesTemplate'teki yorum). Doğal yeri
    // burası: panolara öğe eklemenin ana kaynağı bu liste ("Kaydettiklerimden Ekle" aynı veriyi
    // kullanır). /api/saved kaynağı ve .saved-row işaretlemesi eski kutuyla BİREBİR aynı.
    let colSavedItems = [];
    let colSavedFilter = '';
    let colSavedPage = 1;
    function colMatchesCatalogFilter(itemType, filter) {
      if (!filter) return true;
      if (filter === 'product') return itemType === 'product' || itemType === 'material';
      return itemType === filter;
    }
    function renderColSaved() {
      const container = document.getElementById('am-col-dash-saved');
      if (!container) return;
      const items = colSavedFilter ? colSavedItems.filter(it => colMatchesCatalogFilter(it.item_type, colSavedFilter)) : colSavedItems;
      if (!colSavedItems.length) {
        container.innerHTML = '<div class="dash-empty">Henüz kaydettiğin bir içerik yok.<br><a href="/proje">Projelere göz at</a></div>';
        document.getElementById('am-col-saved-pagination').innerHTML = '';
        return;
      }
      if (!items.length) {
        container.innerHTML = '<div class="dash-empty">Bu türde kaydettiğin bir içerik yok.</div>';
        document.getElementById('am-col-saved-pagination').innerHTML = '';
        return;
      }
      const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE_DASH));
      if (colSavedPage > totalPages) colSavedPage = totalPages;
      const startIdx = (colSavedPage - 1) * PAGE_SIZE_DASH;
      container.innerHTML = items.slice(startIdx, startIdx + PAGE_SIZE_DASH).map(it => `
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
            savedItemsCache = null; // "Kaydettiklerimden Ekle" seçicisi de tazelensin
            loadColSaved();
          } catch { btn.disabled = false; }
        });
      });
      renderDashPagination('am-col-saved-pagination', colSavedPage, totalPages, (pg) => { colSavedPage = pg; renderColSaved(); });
    }
    async function loadColSaved() {
      try {
        const res = await fetch('/api/saved');
        const data = res.ok ? await res.json() : { items: [] };
        colSavedItems = data.items || [];
      } catch { colSavedItems = []; }
      renderColSaved();
    }
    on('am-col-saved-filter', 'click', (e) => {
      const btn = e.target.closest('.saved-filter-btn');
      if (!btn) return;
      colSavedFilter = btn.dataset.filter;
      colSavedPage = 1;
      document.querySelectorAll('#am-col-saved-filter .saved-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderColSaved();
    });

    // ---- Takip Ettiklerim kutusu (kullanıcı isteği, 2026-09-01 madde 2) ----
    // Aktivitelerim'den BURAYA taşındı (bkz. activitiesTemplate'teki yorum). loadRated/renderRated
    // İLE AYNI desen (tip filtresi + tek liste + sayfalama); backend (/api/follows/feed) filtre/
    // sayfalama YAPMAZ, ham liste döner.
    //
    // İki kaynak birleştirilir:
    //   /api/follows      → takip edilen PROFİLLERİN kendisi (mimar/firma/marka satırları)
    //   /api/follows/feed → o profillerin takip BAŞLADIKTAN SONRA yayınladığı proje/ürünler
    // Marka takibi ayrı bir follows tipi DEĞİL: markalar da offices satırıdır (bkz. office-kind.js),
    // sunucu /api/follows'ta is_brand döner. Görüntüleme/filtreleme tipi bu yüzden 'brand' olur ama
    // TAKİBİ BIRAK isteği hâlâ gerçek tiple ('office') gider — deleteType alanı tam olarak bunun için.
    // Markaların yeni ÜRÜNLERİ zaten feed'e gelir (src/routes/follows.js#followFeed products.
    // brand_office_id üzerinden eşleştirir), yani "Ürün" sekmesinde görünürler.
    let followFeedItems = [];
    let followFeedFilter = '';
    let followFeedPage = 1;
    // "Yeni" bildirimi: bu kutu en son ne zaman görüntülendiyse ondan SONRA yayınlanmış gönderiler
    // rozet alır. Zaman damgası tarayıcıda tutulur — sunucuda "okundu" durumu yok ve bu rozet salt
    // bilgilendirici olduğundan cihazlar arası senkron gerekmiyor (bkz. kullanıcı isteği).
    const FOLLOW_FEED_SEEN_KEY = 'mimarlab_follow_feed_seen_at';
    let followSeenAt = 0;
    function readFollowSeenAt() {
      try { return Number(localStorage.getItem(FOLLOW_FEED_SEEN_KEY)) || 0; } catch { return 0; }
    }
    function writeFollowSeenAt(ts) {
      try { localStorage.setItem(FOLLOW_FEED_SEEN_KEY, String(ts)); } catch { /* private mode: rozet her ziyarette görünür, zararsız */ }
    }
    // src/routes/follows.js created_at'i "YYYY-MM-DD HH:MM:SS" (UTC) biçiminde döner — Safari bu
    // biçimi doğrudan ayrıştırmaz, ISO'ya çevirmek gerekir (bkz. aynı dosyadaki toSqliteDatetime).
    function feedTimeMs(createdAt) {
      if (!createdAt) return 0;
      const ms = Date.parse(String(createdAt).replace(' ', 'T') + 'Z');
      return Number.isFinite(ms) ? ms : 0;
    }
    async function loadFollowFeed() {
      const [feedRes, followsRes] = await Promise.all([fetch('/api/follows/feed'), fetch('/api/follows')]);
      const feedData = feedRes.ok ? await feedRes.json() : { items: [] };
      const followsData = followsRes.ok ? await followsRes.json() : { items: [] };
      const profileItems = (followsData.items || []).map(f => ({
        // type = SATIRIN ETİKETİ, filterTypes = HANGİ SEKMELERDE görüneceği. İkisi bilerek ayrı:
        // Autoban gibi hem mimarlık yapan hem ürün tasarlayan bir ofis marka.html'de DE listelenir
        // (bkz. office-kind.js#isBrandOffice) ama etiketi "Firma" kalmalı; VitrA gibi saf üretici
        // yalnızca Marka'dır. Sunucu bu iki soruyu is_brand/is_pure_brand olarak ayrı ayrı yanıtlar.
        type: f.followed_type === 'office' && f.is_pure_brand ? 'brand' : f.followed_type,
        filterTypes: f.followed_type !== 'office' ? [f.followed_type]
          : (f.is_pure_brand ? ['brand'] : (f.is_brand ? ['office', 'brand'] : ['office'])),
        deleteType: f.followed_type,
        key: f.followed_key,
        title: f.followed_title || f.followed_key,
        image: f.followed_image || null,
        // Marka profilleri de firma detay sayfasında yaşıyor (/marka yalnızca LİSTE sayfası, tekil
        // bir /marka/:slug yolu YOK — bkz. src/index.js#CLEAN_URL_ASSETS), bu yüzden href aynı kalır.
        href: `/${f.followed_type === 'architect' ? 'mimar' : 'firma'}/${encodeURIComponent(f.followed_key)}`,
      }));
      // followSeenAt render'dan ÖNCE okunur, yeni değer ise HEMEN yazılır: rozetler bu görüntüleme
      // boyunca (filtre değişimi/sayfalama dahil, hepsi aynı followSeenAt'i kullanır) ekranda kalır,
      // bir sonraki ziyarette düşer.
      followSeenAt = readFollowSeenAt();
      const feedItems = (feedData.items || []).map(it => ({ ...it, isNew: feedTimeMs(it.created_at) > followSeenAt }));
      const latest = feedItems.reduce((max, it) => Math.max(max, feedTimeMs(it.created_at)), followSeenAt);
      if (latest > followSeenAt) writeFollowSeenAt(latest);
      followFeedItems = [...profileItems, ...feedItems];
      renderFollowFeed();
    }
    function renderFollowFeed() {
      const container = document.getElementById('am-dash-follow-feed');
      if (!container) return;
      const newCountEl = document.getElementById('am-follow-feed-new-count');
      if (newCountEl) {
        const newCount = followFeedItems.filter(it => it.isNew).length;
        newCountEl.textContent = `${newCount} yeni`;
        newCountEl.hidden = newCount === 0;
      }
      // filterTypes yoksa (feed'den gelen proje/ürün satırları) tipin kendisi kullanılır.
      const items = followFeedFilter ? followFeedItems.filter(it => (it.filterTypes || [it.type]).includes(followFeedFilter)) : followFeedItems;
      if (!followFeedItems.length) {
        container.innerHTML = '<div class="dash-empty">Henüz takip ettiğin bir mimar, firma ya da marka yok.<br><a href="/marka">Markalara göz at</a></div>';
        document.getElementById('am-follow-feed-pagination').innerHTML = '';
        return;
      }
      if (!items.length) {
        container.innerHTML = '<div class="dash-empty">Bu türde yeni bir paylaşım yok.</div>';
        document.getElementById('am-follow-feed-pagination').innerHTML = '';
        return;
      }
      const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE_DASH));
      if (followFeedPage > totalPages) followFeedPage = totalPages;
      const startIdx = (followFeedPage - 1) * PAGE_SIZE_DASH;
      const pageItems = items.slice(startIdx, startIdx + PAGE_SIZE_DASH);
      container.innerHTML = pageItems.map(it => `
        <div class="saved-row"${it.key ? ` data-type="${escapeAttr(it.deleteType || it.type)}" data-key="${escapeAttr(it.key)}"` : ''}>
          <a class="saved-row-link" href="${escapeAttr(safeUrl(it.href) || '#')}">
            ${it.image && safeUrl(it.image) ? `<img src="${escapeAttr(avatarImg(it.image, 160, safeUrl(it.image)))}" alt="" loading="lazy" decoding="async">` : `<div class="saved-row-noimg"></div>`}
            <div style="min-width:0;">
              <div class="saved-row-title">${escapeHtml(it.title || '—')}${it.isNew ? '<span class="saved-row-new">Yeni</span>' : ''}</div>
              <div class="saved-row-meta">${SAVED_TYPE_LABELS[it.type] || ''}</div>
            </div>
          </a>
          ${it.key ? `<button class="saved-remove-btn" type="button" aria-label="Takibi bırak">✕</button>` : ''}
        </div>`).join('');
      container.querySelectorAll('.saved-remove-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const row = btn.closest('.saved-row');
          btn.disabled = true;
          try {
            await fetch(`/api/follows/${row.dataset.type}/${encodeURIComponent(row.dataset.key)}`, { method: 'DELETE' });
            loadFollowFeed();
          } catch { btn.disabled = false; }
        });
      });
      renderDashPagination('am-follow-feed-pagination', followFeedPage, totalPages, (pg) => { followFeedPage = pg; renderFollowFeed(); });
    }
    on('am-follow-feed-filter', 'click', (e) => {
      const btn = e.target.closest('.saved-filter-btn');
      if (!btn) return;
      followFeedFilter = btn.dataset.filter;
      followFeedPage = 1;
      document.querySelectorAll('#am-follow-feed-filter .saved-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderFollowFeed();
    });

    fetch('/api/auth/me').then(r => {
      if (!r.ok) { swap('login'); return; }
      loadCollections();
      loadColSaved().catch(() => {});
      loadFollowFeed().catch(() => {});
    }).catch(() => {});
  }

  // Mesaj dizisi overlay'i document.body'nin çocuğu olarak yaşar (bkz. openMessageThread) — popup
  // ModalShell üzerinden kapanırsa geride asılı kalırdı (bkz. modal-shell.js#close'taki
  // 'mimarlab-modal-closed' yorumu ve message-button.js'teki AYNI dinleyici).
  document.addEventListener('mimarlab-modal-closed', () => {
    const overlay = document.getElementById('am-thread-overlay');
    if (overlay) overlay.remove();
  });

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
  //
  // kullanıcı isteği (2026-09-01 madde 1): Hesabım/Aktivitelerim/Koleksiyonum/İçeriklerim artık
  // MASAÜSTÜNDE de tablet/mobildeki gibi sağdan kayan çekmecede açılır — yani bu dört görünüm için
  // kırılma noktası tamamen devre dışı. Giriş Yap/Üye Ol/Şifremi Unuttum ise DEĞİŞMEDİ: masaüstünde
  // hâlâ ModalShell popup'ı (istek yalnızca o dört sayfayı sayıyor). Bu yüzden karar artık salt
  // viewport'a değil, GÖRÜNÜME de bağlı — fonksiyon bir `view` argümanı alır.
  const DESKTOP_DRAWER_VIEWS = new Set(DASH_NAV_VIEW_KEYS);
  function isMobileDrawer(view) {
    if (!window.NavDrawer) return false;
    if (window.matchMedia('(max-width:960px)').matches) return true;
    return DESKTOP_DRAWER_VIEWS.has(view);
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
    const mobile = isMobileDrawer(view);
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
    else if (view === 'collections') { wrap.innerHTML = collectionsTemplate(); mountCollections(); }
    else { wrap.innerHTML = accountTemplate(); mountAccount(); }
    // Geçiş satırı artık şablonun değil BARINDIRICI BAŞLIĞIN parçası (bkz. mountDashNav) — hostEl
    // temizliğinden etkilenmediğinden her renderView'da açıkça yeniden yazılır.
    mountDashNav(view, mobile);
    if (mobile) {
      hostEl.scrollTop = 0;
    } else {
      // denetim bulgusu (AUDIT-009): bu modal document.title'ı hiç değiştirmiyor (sayfanın kendi
      // başlığı korunur), o yüzden diğer modallardaki gibi document.title'ı yeniden kullanamayız —
      // aria-label için ayrı, sabit bir Türkçe etiket haritası.
      const AUTH_VIEW_LABELS = { login: 'Giriş Yap', signup: 'Üye Ol', forgot: 'Şifremi Unuttum', activities: 'Aktivitelerim', contents: 'İçeriklerim', collections: 'Koleksiyonum' };
      ModalShell.setLabel(AUTH_VIEW_LABELS[view] || 'Hesabım');
      ModalShell.scrollToTop();
    }
  }

  // GERÇEK BULGU (kullanıcı isteği 2026-08-30, İçeriklerim > Mimar/Firma Profilim popup entegrasyonu):
  // ArchitectModal/OfficeModal AYNI paylaşılan ModalShell singleton'ını (bkz. modal-shell.js#
  // claimContent) İçeriklerim/Hesabım İÇİNDEN açılıp kapatıldığında kendi close()'u ModalShell'i
  // (masaüstünde) ya da hamburger çekmecesini (mobilde, bkz. overlay-manager.js#AUTO_SELECTOR —
  // ModalShell açılışı .nav-mobile-menu'yü closeDrawer() ÇAĞIRMADAN, doğrudan .open sınıfını
  // kaldırarak kapatır) TAMAMEN kapatır — ama AuthModal'in kendi currentView'i hiç değişmediğinden
  // (o modallar AuthModal'in state'ine dokunmaz) isOpen() eskiden yalnızca currentView'e bakıp hâlâ
  // "açık" derdi, bu da nav linkine/geri tuşuna tıklandığında popup'ın GÖRÜNMEZ overlay'e sessizce
  // render edilmesine (ya da hiç yeniden açılmamasına) yol açardı. Artık paylaşılan konteynerin
  // GERÇEKTEN görünür olup olmadığı da kontrol edilir — NavDrawer.isSubpageActive() BİLEREK
  // kullanılmaz, o da AYNI şekilde stale kalabilir (closeDrawer() çağrılmadan .open kaldırılınca
  // subpageActive true'da takılı kalır); isDrawerOpen() ise doğrudan DOM sınıfını okur.
  //
  // GERÇEK BULGU (kullanıcı bildirimi, 2026-08-31 madde 2): burada eskiden isMobileDrawer() —yani
  // ANLIK VIEWPORT— sorularak "hangi barındırıcıyı kontrol edeyim" kararı veriliyordu. Masaüstünde
  // (ModalShell içinde) açık bir görünüm varken pencere 960px'in ALTINA küçültüldüğünde bu, "artık
  // mobildeyim" deyip henüz hiç açılmamış ÇEKMECEYE bakıyor, isDrawerOpen() false dönüyor ve
  // isOpen() —içerik ekranda dururken— false oluyordu; aşağıdaki resize dinleyicisi de ilk satırında
  // tam bu isOpen()'a bakıp erken çıktığından barındırıcı geçişi HİÇ yapılmıyordu (diğer popup'lar
  // tek bir barındırıcı kullandığı için bu sorunu yaşamıyor). Doğru soru "viewport ne?" değil,
  // "içerik ŞU AN hangi barındırıcıda?" — yani currentHostIsMobile(). Yukarıdaki stale-subpageActive
  // riski de ortadan kalkmıyor, çünkü seçilen barındırıcının GERÇEKTEN görünür olduğu (isDrawerOpen/
  // ModalShell.isOpen) yine ayrıca doğrulanıyor.
  function isOpen() {
    if (currentView === null) return false;
    return currentHostIsMobile() ? !!(window.NavDrawer && window.NavDrawer.isDrawerOpen()) : ModalShell.isOpen();
  }

  function open(view, { pushHistory = true, triggerEl = null } = {}) {
    currentView = view;
    openedViaPush = pushHistory;
    pushCountSinceOpen = pushHistory ? ModalShell.popupHistoryDepth() + 1 : 0;
    // depth artık TÜR-BAĞIMSIZ sayılır (bkz. ModalShell.popupHistoryDepth) — bu popup başka bir
    // popup'ın üstüne açıldıysa zincir kaldığı yerden devam eder, kapanış tek hamlede popup ÖNCESİ
    // sayfaya döner.
    if (pushHistory) history.pushState({ mimarlabModal: 'auth', view, depth: pushCountSinceOpen }, '', VIEW_PATH[view]);
    // Hesabım/Aktivitelerim/Koleksiyonum/İçeriklerim kullanıcı için birer SAYFADIR (bkz. kullanıcı
    // isteği: "koleksiyonum sayfasındayken bir proje popup'ına girip ... kapattığımda koleksiyonum
    // sayfası karşıma çıksın") — bu yüzden buradan açılan varlık popup'ları kapatılınca dönülecek
    // "son gerçek sayfa" olarak işaretlenirler. pushState'ten SONRA çağrılır: location.href artık
    // görünümün kendi URL'idir (bkz. ModalShell.markRealPage).
    if (ModalShell.markRealPage) ModalShell.markRealPage(); // modal-shell.js ayrı cache'lenen bir asset — eski bir kopya yüklüyse sessizce atla
    if (isMobileDrawer(view)) window.NavDrawer.showSubpage({ onBack: backToMenu, onRequestFullClose: close });
    else ModalShell.open({ triggerEl, onRequestClose: close });
    renderView(view);
    // "Giriş Yap"/"Üye Ol" açıldığında oturum zaten açıksa sessizce Hesabım'a geçilir (kullanıcı
    // isteği, 2026-09-01 madde 4). Kontrol BİLEREK open()'ın İÇİNDE, aşağıdaki tıklama
    // dinleyicisinde DEĞİL — gerçek bulgu: bu modül çoğu sayfada tembel yüklendiğinden (bkz.
    // js/components/lazy-modals.js) İLK tıklamayı o dosya yakalayıp doğrudan AuthModal.open()
    // çağırır; kontrol yalnızca buradaki dinleyicide olduğu sürece o ilk tıklamada HİÇ çalışmıyordu
    // (yerel doğrulamada yakalandı: girişli kullanıcı footer'daki "Üye Ol"a basınca üye ol formunu
    // görüyordu). Deep-link/F5 ile /giris|/uye-ol'a gelen girişli kullanıcı da aynı şekilde
    // Hesabım'a düşer. Popup ÖNCE anında açılır, kontrol arka planda koşar — /api/auth/me yavaşsa
    // tıklama tepkisiz görünmesin (2026-08-14 gerçek bulgusu, davranış korunuyor).
    if (view === 'login' || view === 'signup') {
      fetch('/api/auth/me').then(r => { if (r.ok && currentView === view) swap('account'); }).catch(() => {});
    }
  }

  function swap(view) {
    if (!isOpen()) return open(view, { pushHistory: true });
    const wasMobile = currentHostIsMobile();
    currentView = view;
    const currentDepth = ModalShell.popupHistoryDepth() || pushCountSinceOpen; // tür-bağımsız, bkz. o fonksiyonun yorumu
    pushCountSinceOpen = currentDepth + 1;
    history.pushState({ mimarlabModal: 'auth', view, depth: pushCountSinceOpen }, '', VIEW_PATH[view]);
    if (ModalShell.markRealPage) ModalShell.markRealPage(); // bkz. open()'daki AYNI gerekçe
    // Tüm AuthModal görünümleri her iki host'ta da (mobil/masaüstü) açılabildiğinden host normalde
    // swap sırasında DEĞİŞMEZ — yalnızca resize sırasında (bkz. aşağıdaki resize dinleyicisi) farklı
    // olabilir; bu satır o nadir yarış durumuna karşı bir güvenlik ağı.
    // 2026-09-01 madde 1'den SONRA host swap sırasında GERÇEKTEN değişebiliyor: masaüstünde
    // Hesabım (çekmece) → Giriş Yap (ModalShell) geçişi tam olarak bu dalı kullanır.
    const willBeMobile = isMobileDrawer(view);
    if (wasMobile !== willBeMobile) { deactivateHost(wasMobile); activateHost(willBeMobile); }
    renderView(view);
  }

  // .am-single sınıfı (bkz. renderView()) paylaşılan modal-shell bodyEl'e eklenir — proje/mimar/
  // firma/ürün modalları da AYNI bodyEl'i kullandığından (bkz. dosya başı yorumu) kapatırken
  // KALDIRILMAZSA bir sonraki açılan başka bir modalın 32/68 ızgarasını bozardı (gerçek bulgu).
  function unmountSingleColumn() {
    const panels = ModalShell.getPanels();
    if (panels) panels.bodyEl.classList.remove('am-single');
    // Geçiş satırı da AYNI paylaşılan ModalShell header'ında yaşıyor (bkz. mountDashNav) — AuthModal
    // masaüstü barındırıcısını bıraktığında geride kalmamalı.
    const centerSlot = ModalShell.getHeaderCenterSlot();
    if (centerSlot) centerSlot.innerHTML = '';
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
    // bkz. ModalShell.returnToPreviousPage (kullanıcı isteği 2026-09-01 madde 8/11): kendi
    // pushState'imizle açılmadıysak (deep link/F5) bile site içinden gelinmişse geldiğimiz sayfaya
    // döneriz; yalnızca site dışından/doğrudan gelinmişse ana sayfaya düşülür.
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

  // Bir görünüm açıkken viewport 960px kırılma noktasını geçerse (ör. tablet döndürme, tarayıcı
  // penceresi yeniden boyutlandırma) içerik URL/history'e DOKUNULMADAN doğru host'a (ModalShell <->
  // NavDrawer alt sayfası) yeniden mount edilir — bkz. kullanıcı isteği: "responsive geçiş düzgün
  // çalışmalı". Bu dinleyici 2026-08-31'e kadar TEK YÖNLÜ çalışıyordu (mobil > masaüstü); ters yön
  // isOpen()'ın viewport'a bakan eski hâli yüzünden ilk satırda sessizce eleniyordu — kök neden ve
  // düzeltme için bkz. isOpen() üzerindeki GERÇEK BULGU notu.
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
    if (path === '/giris') return 'login';
    if (path === '/uye-ol') return 'signup';
    if (path === '/hesabim') return 'account';
    if (path === '/aktivitelerim') return 'activities';
    if (path === '/iceriklerim') return 'contents';
    if (path === '/koleksiyonum') return 'collections';
    if (path === '/sifremi-unuttum') return 'forgot';
    return null;
  }

  // KÖK NEDEN (kullanıcı isteği, 2026-09-01 madde 4 ve 8: "giriş yap/üye ol'a tıklayınca girişliyse
  // Hesabım'a gitsin", "avatardan Hesabım/Aktivitelerim/Koleksiyonum/İçeriklerim'e tıklayınca site
  // önce ana sayfaya iletmesin"): bu eşleme YALNIZCA eski `*.html` href biçimini tanıyordu. Sitedeki
  // 230 iç bağlantı 2026-09-01'de kanonik temiz yollara çevrildiğinde (href="/hesabim" vb.) hiçbiri
  // artık eşleşmiyor, tıklama preventDefault EDİLMİYOR ve tarayıcı /hesabim'e TAM SAYFA gidiyordu —
  // o yol index.html'i (ana sayfa) servis ettiğinden kullanıcı önce ana sayfaya "ışınlanıp" popup'ı
  // orada görüyor, kapatınca da bulunduğu sayfaya değil ana sayfaya düşüyordu. Aynı nedenle
  // aşağıdaki "zaten girişliyse Hesabım'a geç" dalı da hiç çalışmıyordu.
  // Artık href, ANCHOR'IN ÇÖZÜLMÜŞ pathname'i üzerinden değerlendirilir: önce kanonik temiz yol
  // (pathToView — VIEW_PATH ile aynı tablo, geri/ileri tuşu da onu kullanır), sonra eski *.html biçimi.
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
    for (const view of Object.keys(HREF_VIEW_RE)) {
      if (HREF_VIEW_RE[view].test(path)) return view;
    }
    return null;
  }

  // Header/footer/auth-nav.js'in ürettiği MEVCUT bağlantılar (bkz. dosya başı yorumu) — hiçbir
  // sayfanın kendi href'i değiştirilmedi, yalnızca burada delege edilip preventDefault edilir.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const view = hrefToView(a);
    if (!view) return;
    e.preventDefault();
    // "Giriş Yap"/"Üye Ol" zaten girişliyken Hesabım'a geçme kontrolü artık open()'ın içinde (bkz.
    // orada anlatılan gerçek bulgu); swap() dalı için burada ayrıca uygulanır — swap() open()'dan
    // geçmez (popup zaten açıkken görünüm değiştirir).
    if (isOpen()) {
      swap(view);
      if (view === 'login' || view === 'signup') {
        fetch('/api/auth/me').then(r => { if (r.ok && currentView === view) swap('account'); }).catch(() => {});
      }
    } else {
      open(view, { triggerEl: a });
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
