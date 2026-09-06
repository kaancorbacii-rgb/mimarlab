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
  const VIEW_PATH = { login: '/giris', signup: '/uye-ol', account: '/hesabim', activities: '/aktivitelerim', collections: '/koleksiyonum', forgot: '/sifremi-unuttum' };
  // ESKİ (*.html) bağlantı biçimi — artık sitede hiç üretilmiyor ama bookmark/eski sekme/harici
  // bağlantılar hâlâ bu biçimde gelebildiğinden tanınmaya devam eder. KANONİK temiz yollar
  // (VIEW_PATH'in kendisi) pathToView ile eşlenir, bkz. hrefToView.
  const HREF_VIEW_RE = { login: /(^|\/)giris-yap\.html$/, signup: /(^|\/)uye-ol\.html$/, account: /(^|\/)hesabim\.html$/, activities: /(^|\/)aktivitelerim\.html$/, collections: /(^|\/)koleksiyonum\.html$/, forgot: /(^|\/)sifremi-unuttum\.html$/ };

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
       isteği: mobilde "Profili Düzenle" avatarın yanında üst satırda, "Aktivitelerim" başlığın
       ALTINDA ayrı bir satırda kalsın). activitiesTemplate() hâlâ eski
       .dash-head-info'yu kullanıyor, bu yeni sınıf sadece Hesabım'ın kendi başlığını etkiler — aynı
       özgüllükte (1,1,0) olduğundan ve BURADA (.dash-head kuralından SONRA) tanımlandığından, çakışan
       display/gap/align-items kaynak sırasıyla kazanır, margin-bottom/flex-wrap gibi tekrar
       yazılmayanlar .dash-head'den miras kalır. */
    #am-panel .dash-head-account{display:flex; align-items:center; gap:18px;}
    #am-panel .dash-head-titles{flex:1; min-width:0;}
    /* ---------- SAYFA GEÇİŞ SATIRI (.dash-nav-row) ----------
       kullanıcı isteği (2026-08-31, madde 1 ve 3): Hesabım/Aktivitelerim/Koleksiyonum
       popup'larından birinin içindeyken DİĞER İKİSİ, kendi ayrı satırında değil, popup'ın KAPATMA (X)
       düğmesiyle AYNI satırda dursun; tek satırda, yan yana, birbirine EŞİT aralıklarla ve
       yatayda ortalanmış olsun — dar ekranlarda taşmadan (gerekirse butonlar küçülerek).
       (İçeriklerim 2026-09-05'te kaldırıldı, o tarihe kadar dördüncü sayfaydı.)
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
    /* ---------- İSTATİSTİKLER (kullanıcı isteği, 2026-09-04) ----------
       Tüm renkler mevcut değişkenlerden (--ink/--ink-soft/--line/--paper-alt/--walnut) gelir, yani
       koyu tema otomatik doğru çalışır (bkz. arama.html/#[data-theme="dark"] tanımları). Izgara
       auto-fit/minmax ile akar: masaüstünde 4, tablette 2-3, mobilde 2 sütun — ayrı media query
       yazmaya gerek kalmaz. */
    #am-panel .stat-range{display:flex; flex-wrap:wrap; gap:6px;}
    #am-panel .stat-range-btn{
      background:var(--paper-card); border:1px solid var(--line); border-radius:100px;
      padding:6px 12px; font-family:inherit; font-size:12px; font-weight:600; color:var(--ink-soft);
      transition:background .15s, color .15s, border-color .15s;
    }
    #am-panel .stat-range-btn:hover{border-color:var(--brass); color:var(--ink);}
    #am-panel .stat-range-btn.active{background:var(--ink); border-color:var(--ink); color:var(--paper-card);}
    #am-panel .stat-group{margin-top:18px;}
    #am-panel .stat-group:first-child{margin-top:4px;}
    #am-panel .stat-group-title{font-size:12px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:var(--sage); margin:0 0 10px;}
    #am-panel .stat-grid{display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:10px;}
    #am-panel .stat-card{border:1px solid var(--line-soft); border-radius:12px; background:var(--paper); padding:12px 14px; min-width:0;}
    #am-panel .stat-card-value{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:22px; font-weight:700; line-height:1.15;}
    #am-panel .stat-card-label{font-size:12px; color:var(--ink-soft); margin-top:3px; line-height:1.35;}
    #am-panel .stat-chart{margin-top:10px; border:1px solid var(--line-soft); border-radius:12px; background:var(--paper); padding:12px;}
    /* max-height: preserveAspectRatio="none" ile SVG kapsayıcının genişliğine göre uzar; geniş
       masaüstünde 260px'i aşıp bölümü gereksiz şişiriyordu. 160px sade bir "spark" yüksekliği. */
    #am-panel .stat-chart svg{display:block; width:100%; height:160px;}
    #am-panel .stat-legend{display:flex; flex-wrap:wrap; gap:14px; margin-top:8px; font-size:11.5px; color:var(--ink-soft);}
    #am-panel .stat-legend span{display:inline-flex; align-items:center; gap:6px;}
    #am-panel .stat-legend i{width:10px; height:3px; border-radius:2px; display:inline-block;}
    #am-panel .stat-list{list-style:none; margin:0; padding:0;}
    #am-panel .stat-list li{display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--line-soft); font-size:13px; min-width:0;}
    #am-panel .stat-list li:last-child{border-bottom:none;}
    #am-panel .stat-list .stat-list-name{flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
    #am-panel .stat-list .stat-list-count{font-weight:700; flex-shrink:0;}
    #am-panel .stat-list .stat-list-kind{font-size:11px; color:var(--ink-soft); flex-shrink:0;}
    /* Dağılım çubuğu — meslek/kurum kırılımı için; oran genişlikle gösterilir, ayrı bir grafik
       kütüphanesi gerekmez. */
    #am-panel .stat-bar-row{display:grid; grid-template-columns:minmax(90px, 34%) 1fr auto; align-items:center; gap:10px; padding:6px 0; font-size:12.5px;}
    /* display:block ZORUNLU — ikisi de <span>, yani varsayılan inline; inline kutularda width/height
       hiç uygulanmaz ve dolgu 0x0 render edilirdi (yerelde ölçüldü: fillW=0, fillH=0 — çubuklar boş
       görünüyordu). Aynı hata sınıfı proje.html#.prevnext-title'da da yaşanmıştı. */
    #am-panel .stat-bar-track{display:block; background:var(--paper-alt); border-radius:100px; height:8px; overflow:hidden; min-width:0;}
    #am-panel .stat-bar-fill{display:block; background:var(--walnut); height:100%; border-radius:100px;}
    #am-panel .stat-bar-name{overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--ink-soft);}
    #am-panel .stat-note{font-size:11.5px; color:var(--ink-soft); margin-top:12px; line-height:1.5;}
    #am-panel .stat-two{display:grid; grid-template-columns:1fr 1fr; gap:18px;}
    @media (max-width:620px){
      #am-panel .stat-two{grid-template-columns:1fr;}
      /* Sabit 2 sütun: auto-fit + minmax(120px) 375px'lik ekranda (kutu iç genişliği ~247px, gap 10px)
         2x120+10 = 250 > 247 olduğu için TEK sütuna düşüyordu ve kartlar gereksiz yer kaplıyordu
         (yerelde ölçüldü). Mobilde 2 sütun okunabilirliği bozmuyor, bölümü yarı yarıya kısaltıyor. */
      #am-panel .stat-grid{grid-template-columns:1fr 1fr; gap:8px;}
      #am-panel .stat-card{padding:10px 11px;}
      #am-panel .stat-card-value{font-size:19px;}
      #am-panel .stat-card-label{font-size:11.5px;}
    }
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
    /* Bildirim satırı ARTIK bir buton (kullanıcı isteği, 2026-09-06 madde 2: "bildirimler aktif
       butonlar olsun") — tıklanınca tipine göre bir aksiyon ekranı açar (bkz. renderNotifList).
       Buton olduğu görsel olarak da belli olmalı: hover'da zemin/kenarlık belirir, sağ uçta bir
       ok ipucu durur ve klavye odağı görünür bir halka alır. .notif-row bir <div> KALIR (içinde
       kendi <button class="notif-del"> silme düğmesi var — iç içe buton geçersiz HTML'dir);
       erişilebilirlik role="button" + tabindex + Enter/Space ile sağlanır. */
    #am-panel .notif-row{
      display:flex; gap:10px; padding:12px 10px; margin:0 -10px; border-radius:10px;
      border-bottom:1px solid var(--line-soft); cursor:pointer;
      transition:background .15s ease;
    }
    #am-panel .notif-row:hover{background:var(--paper-alt);}
    #am-panel .notif-row:focus-visible{outline:none; box-shadow:0 0 0 2px var(--brass) inset;}
    #am-panel .notif-row:last-child{border-bottom:none;}
    /* Aksiyonu OLAN satırlarda (bkz. notifActionFor) sağ uçta bir "aç" oku — aksiyonsuz satırlarda
       (ör. reddedilen bir rozet talebi) bilerek yoktur, kullanıcıya boş bir vaat verilmesin. */
    #am-panel .notif-go{
      display:flex; align-items:center; align-self:center; flex-shrink:0;
      color:var(--ink-soft); opacity:0; transition:opacity .15s ease;
    }
    #am-panel .notif-row:hover .notif-go, #am-panel .notif-row:focus-visible .notif-go{opacity:1;}
    /* padding/margin/radius artık temel .notif-row kuralında (bkz. yukarısı) — burada yalnızca
       okunmamış zemini kalır; hover, okunmamış satırda da görünür olsun diye ayrıca yazılır. */
    #am-panel .notif-row.unread{background:rgba(224,138,62,0.07);}
    #am-panel .notif-row.unread:hover{background:rgba(224,138,62,0.14);}
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
    /* Kebab (⋮) menüler — pano araç çubuğundaki "Paylaş/Dışa Aktar/Panoyu Sil" VE görünüm satırındaki
       "+ Ekle" ekleme seçenekleri artık ayrı buton sıraları yerine tek bir açılır menüde (kullanıcı
       isteği, 2026-09-06). İkisi de AYNI .col-kebab-wrap/.col-kebab-menu iskeletini paylaşır. */
    #am-panel .col-kebab-wrap{position:relative;}
    #am-panel .col-kebab-toggle{width:34px; height:34px; border-radius:50%; border:1.5px solid var(--ink); background:none; color:var(--ink); font-size:18px; font-weight:700; line-height:1; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; padding:0; font-family:inherit;}
    #am-panel .col-kebab-toggle:hover{background:var(--ink); color:var(--paper-card);}
    #am-panel .col-kebab-menu{position:absolute; top:calc(100% + 6px); left:0; z-index:40; min-width:190px; background:var(--paper-card); border:1px solid var(--line); border-radius:12px; box-shadow:0 12px 30px rgba(0,0,0,0.18); padding:6px; display:flex; flex-direction:column; gap:2px;}
    #am-panel .col-kebab-item{display:block; width:100%; text-align:left; padding:9px 12px; border-radius:8px; border:none; background:none; color:var(--ink); font-weight:600; font-size:12.5px; font-family:inherit; cursor:pointer;}
    #am-panel .col-kebab-item:hover{background:var(--paper-alt);}
    #am-panel .col-kebab-item-danger{color:#B84C4C;}
    #am-panel .col-kebab-item-danger:hover{background:#B84C4C; color:#fff;}
    #am-panel .col-new-row{display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:16px;}
    #am-panel .col-new-row input{flex:1; min-width:180px; padding:10px 14px; border:1px solid var(--line); border-radius:10px; background:var(--paper); color:var(--ink); font-size:13.5px; font-family:inherit;}
    /* ---------- Serbest Tuval / Moodboard (kullanıcı isteği, 2026-09-05 madde 1) ----------
       Eski .col-item-grid/.col-item/.col-item-move (sıra okları) TAMAMEN kaldırıldı — sabit
       yükseklikli, position:relative bir "tuval" konteyneri aldı yerini:
       her öğe yüzde bazlı left/top/width/height ile position:absolute konumlanır (bkz.
       js/components/image-hotspots.js'teki AYNI "piksel değil yüzde" gerekçesi, duyarlı genişlik
       değişiminde konumlar bozulmadan ölçeklenir). touch-action:none sürükleme sırasında sayfanın
       kaymasını engeller (bkz. image-crop.js#injectStyles'daki AYNI kural). */
    /* ---------- Liste/Izgara görünüm geçişi + Liste Modu (kullanıcı isteği) ---------- */
    /* .col-view-row: görünüm geçişi VE "+ Ekle" menüsü aynı satırda (kullanıcı isteği, 2026-09-06) —
       margin artık burada, .col-view-toggle'ın kendi margin'i sıfırlandı (aksi halde iki kez boşluk
       birikip satır hizası kayardı). */
    #am-panel .col-view-row{display:flex; align-items:center; gap:10px; margin:8px 0 2px; flex-wrap:wrap;}
    #am-panel .col-view-toggle{display:inline-flex; border:1px solid var(--line); border-radius:100px; overflow:hidden; margin:0;}
    #am-panel .col-view-toggle button{padding:6px 16px; border:none; background:var(--paper-card); color:var(--ink); font-size:12px; font-weight:600; cursor:pointer; font-family:inherit;}
    #am-panel .col-view-toggle button + button{border-left:1px solid var(--line);}
    #am-panel .col-view-toggle button.active{background:var(--ink); color:var(--paper-card);}
    /* Tam sayfa görünüm (kullanıcı isteği, 2026-09-06 madde 2) — am-col-canvas-fs-target ızgara/
       liste VE araçlarını (görünüm geçişi + ekle menüsü col-view-row'da zaten yukarıda kaldığından
       bunlar ayrıca değil, ama araç çubuğu/ekleme panelleri/tuval/liste'nin TAMAMINI kapsar) tek
       parça olarak fixed+inset:0 ile ekranı kaplatır. z-index:60, modal-shell.js'in KENDİ köşe
       butonlarının (z-index:5) üstünde yeterli — modal-shell-overlay'in z-index:150'lik KENDİ
       stacking context'i içinde kaldığından global bir çakışma riski yok. */
    #am-panel .col-fullscreen-toggle{width:34px; height:34px; border-radius:50%; border:1.5px solid var(--ink); background:none; color:var(--ink); display:inline-flex; align-items:center; justify-content:center; padding:0; cursor:pointer; margin-left:auto;}
    #am-panel .col-fullscreen-toggle:hover, #am-panel .col-fullscreen-toggle[aria-pressed="true"]{background:var(--ink); color:var(--paper-card);}
    #am-panel .col-canvas-fs-target.is-fullscreen{position:fixed; inset:0; z-index:60; background:var(--paper-card); padding:20px 24px 24px; overflow-y:auto; display:flex; flex-direction:column; gap:10px;}
    #am-panel .col-canvas-fs-target.is-fullscreen .col-canvas-wrap{flex:1; min-height:0; display:flex;}
    #am-panel .col-canvas-fs-target.is-fullscreen .col-canvas-viewport{flex:1; height:auto; min-height:0;}
    #am-panel .col-canvas-fs-target.is-fullscreen .col-list{flex:1; min-height:0; overflow-y:auto;}
    #am-panel .col-list{display:flex; flex-direction:column; gap:8px;}
    #am-panel .col-list-row{display:flex; align-items:center; gap:10px; padding:8px; border:1px solid var(--line-soft); border-radius:10px; background:var(--paper);}
    /* Sürükle-bırak yerine yukarı/aşağı butonları (kullanıcı isteği, 2026-09-06) — sürükleme
       trackpad/dokunmatikte tutarsız kalıyordu, sıralama artık iki ayrı düğmeyle KESİN adımlarla
       yapılır (bkz. renderItemsListMode/moveListItem). */
    #am-panel .col-list-reorder{display:flex; flex-direction:column; gap:2px; flex-shrink:0;}
    #am-panel .col-list-move{display:flex; align-items:center; justify-content:center; width:22px; height:18px; padding:0; border:1px solid var(--line-soft); border-radius:5px; background:var(--paper-card); color:var(--ink-soft); cursor:pointer;}
    #am-panel .col-list-move:hover:not(:disabled){border-color:var(--walnut); color:var(--walnut);}
    #am-panel .col-list-move:disabled{opacity:0.3; cursor:default;}
    #am-panel .col-list-thumb{width:48px; height:48px; border-radius:8px; object-fit:cover; background:var(--paper-alt); flex-shrink:0;}
    #am-panel .col-list-thumb-empty{background:var(--paper-alt);}
    #am-panel .col-list-title{font-weight:600; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
    #am-panel .col-list-remove{flex-shrink:0; width:26px; height:26px; border-radius:50%; border:none; background:var(--paper-alt); color:var(--ink-soft); font-size:12px; cursor:pointer;}
    #am-panel .col-list-remove:hover{background:#B84C4C; color:#fff;}
    /* ---------- A4 Pafta araç çubuğu (kullanıcı isteği, 2026-09-06 madde 1/2) ---------- */
    #am-panel .col-canvas-toolbar{display:flex; flex-wrap:wrap; gap:14px; align-items:center; margin-bottom:12px; padding:10px 12px; border:1px solid var(--line-soft); border-radius:12px; background:var(--paper);}
    #am-panel .col-canvas-toolbar-group{display:flex; align-items:center; gap:6px;}
    #am-panel .col-canvas-tbtn{padding:7px 12px; border-radius:8px; border:1px solid var(--line); background:var(--paper-card); color:var(--ink); font-size:12px; font-weight:600; display:inline-flex; align-items:center; gap:5px; cursor:pointer; font-family:inherit;}
    #am-panel .col-canvas-tbtn:hover{border-color:var(--walnut);}
    #am-panel .col-canvas-tbtn.active{background:var(--ink); color:var(--paper-card); border-color:var(--ink);}
    #am-panel .col-canvas-zoom-label{font-size:12px; color:var(--ink-soft); min-width:38px; text-align:center;}
    #am-panel .col-canvas-pen-swatches{display:inline-flex; gap:4px; flex-wrap:wrap;}
    #am-panel .col-canvas-pen-swatch{width:18px; height:18px; border-radius:50%; border:1.5px solid var(--paper-card); box-shadow:0 0 0 1px var(--line); cursor:pointer; padding:0;}
    #am-panel .col-canvas-pen-swatch.active{box-shadow:0 0 0 2px var(--walnut);}
    #am-panel #am-col-pen-color-custom, #am-panel #am-col-note-style-color-custom{width:22px; height:22px; padding:0; border:none; border-radius:6px; cursor:pointer; background:none;}
    /* ---------- A4 Serbest Tuval / Pan+Zoom (kullanıcı isteği madde 1) ----------
       .col-canvas-viewport sabit yükseklikli, overflow:hidden bir "pencere" — içindeki .col-canvas
       ("pafta") sabit piksel boyutlu (A4 en-boy oranı, orantı KORUNUR) ve transform: translate+scale
       ile kaydırılıp yakınlaştırılır (bkz. applyCanvasTransform). Öğelerin left/top/width/height
       yüzdeleri PAFTANIN KENDİ boyutuna göredir — pafta transform ile büyüyüp küçülünce
       getBoundingClientRect() zaten güncel (ekrandaki) boyutu verdiğinden sürükleme/boyutlandırma
       matematiği (wireCanvasInteractions) zoom seviyesinden BAĞIMSIZ, hiç değişiklik gerekmedi. */
    #am-panel .col-canvas-wrap{position:relative;}
    #am-panel .col-canvas-viewport{position:relative; width:100%; height:640px; overflow:hidden; border:1px solid var(--line); border-radius:14px; background:var(--paper-alt); touch-action:none; cursor:grab;}
    #am-panel .col-canvas-viewport.panning{cursor:grabbing;}
    #am-panel .col-canvas-viewport.pen-active{cursor:crosshair;}
    #am-panel .col-canvas{position:absolute; left:0; top:0; transform-origin:0 0; background:#fff; box-shadow:0 4px 24px rgba(0,0,0,0.12); box-sizing:border-box;
      background-image:
        linear-gradient(rgba(27,42,61,0.08) 1px, transparent 1px),
        linear-gradient(to right, rgba(27,42,61,0.08) 1px, transparent 1px);
      background-size:24px 24px;
    }
    /* Vektörel Çizim Objeleri (kullanıcı isteği) — her kalem izi kendi tam-sayfa SVG sarmalayıcısında,
       .canvas-item'larla AYNI position:absolute+z-index stacking uzayında (bkz. renderDetail). Pen
       aracı aktifken TÜMÜ pointer-events:none olur (çizim, altındaki mevcut izleri seçmemeli). */
    #am-panel .canvas-stroke-obj{position:absolute; inset:0; width:100%; height:100%; pointer-events:none;}
    #am-panel .col-canvas.pen-active .canvas-stroke-obj path{pointer-events:none !important;}
    #am-panel .canvas-item{position:absolute; border:1px solid var(--line-soft); border-radius:10px; overflow:hidden; background:var(--paper); box-sizing:border-box; touch-action:none; cursor:grab;}
    /* Notlar artık kartsız — dış .canvas-item sarmalayıcısının kendi kart görünümü (border+arka
       plan) kaldırılır, metin doğrudan ızgaranın/paftanın üzerinde durur (kullanıcı isteği,
       2026-09-06). İç .canvas-item-note zaten transparent'tı (bkz. aşağıdaki yorum) — asıl arka
       planı VEREN dış kutuydu. */
    #am-panel .canvas-item.canvas-item-note-host{background:transparent; border-color:transparent;}
    #am-panel .canvas-item.dragging{cursor:grabbing; z-index:9999 !important; box-shadow:0 12px 30px rgba(0,0,0,0.22);}
    #am-panel .canvas-item.readonly{cursor:default;}
    #am-panel .canvas-item-media{display:block; width:100%; height:100%; object-fit:cover; background:var(--paper-alt); pointer-events:none;}
    /* Şeffaf arka plan (kullanıcı isteği) — not doğrudan tuval/altındaki görsel üzerinde durur,
       arkasında beyaz/renkli bir kutu YOK. pointer-events yalnızca düzenleme sırasında (bkz.
       renderDetail#editingNoteId) 'auto'ya çevrilir ki içerik doğrudan editable olabilsin. */
    #am-panel .canvas-item-note{width:100%; height:100%; padding:14px; font-size:12.5px; line-height:1.5; white-space:pre-wrap; word-break:break-word; overflow:auto; box-sizing:border-box; background:transparent; pointer-events:none;}
    #am-panel .canvas-item-note[contenteditable="true"]{pointer-events:auto; cursor:text; outline:1.5px dashed var(--walnut); outline-offset:2px;}
    #am-panel .canvas-item-body{position:absolute; left:0; right:0; bottom:0; padding:6px 8px; background:linear-gradient(to top, rgba(0,0,0,0.62), rgba(0,0,0,0)); color:#fff; pointer-events:none;}
    #am-panel .canvas-item-title{font-weight:600; font-size:11.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
    #am-panel .canvas-item-remove{position:absolute; top:6px; right:6px; width:24px; height:24px; border-radius:50%; border:none; background:rgba(27,42,61,0.72); color:#fff; font-size:12px; line-height:1; display:flex; align-items:center; justify-content:center; cursor:pointer;}
    #am-panel .canvas-item-remove:hover{background:#B84C4C;}
    #am-panel .canvas-item-open{position:absolute; top:6px; left:6px; width:24px; height:24px; border-radius:50%; background:rgba(27,42,61,0.72); color:#fff; display:flex; align-items:center; justify-content:center; text-decoration:none;}
    #am-panel .canvas-item-open:hover{background:var(--walnut);}
    /* Not "Kalem" (düzenle) ikonu (kullanıcı isteği) — yalnızca kind='note' öğelerde, silme
       butonunun HEMEN SOLUNDA (bkz. renderDetail) — .canvas-item-remove right:6px/24px genişlik
       + 4px boşluk = right:34px. */
    #am-panel .canvas-item-edit{position:absolute; top:6px; right:34px; width:24px; height:24px; border-radius:50%; border:none; background:rgba(27,42,61,0.72); color:#fff; display:flex; align-items:center; justify-content:center; cursor:pointer;}
    #am-panel .canvas-item-edit:hover{background:var(--walnut);}
    #am-panel .canvas-item-handle{position:absolute; width:14px; height:14px; background:var(--ink); border:2px solid var(--paper-card); border-radius:50%; z-index:5;}
    #am-panel .canvas-item-handle.nw{top:-7px; left:-7px; cursor:nwse-resize;}
    #am-panel .canvas-item-handle.ne{top:-7px; right:-7px; cursor:nesw-resize;}
    #am-panel .canvas-item-handle.sw{bottom:-7px; left:-7px; cursor:nesw-resize;}
    #am-panel .canvas-item-handle.se{bottom:-7px; right:-7px; cursor:nwse-resize;}
    /* Renk Paleti / Kartela — tuvalin sağ altına sabitlenmiş, açılıp kapanabilen widget (kullanıcı
       isteği madde 3). */
    #am-panel .col-palette-toggle{position:absolute; right:14px; bottom:14px; width:42px; height:42px; border-radius:50%; border:1px solid var(--line); background:var(--paper-card); color:var(--ink); display:flex; align-items:center; justify-content:center; box-shadow:0 6px 16px rgba(0,0,0,0.18); cursor:pointer; z-index:20;}
    #am-panel .col-palette-toggle:hover{border-color:var(--walnut); color:var(--walnut);}
    #am-panel .col-palette-panel{position:absolute; right:14px; bottom:64px; width:200px; max-height:260px; overflow-y:auto; background:var(--paper-card); border:1px solid var(--line); border-radius:12px; padding:12px; box-shadow:0 12px 30px rgba(0,0,0,0.22); z-index:20;}
    #am-panel .col-palette-swatches{display:grid; grid-template-columns:repeat(4,1fr); gap:6px; margin-top:8px;}
    #am-panel .col-palette-swatch{display:flex; flex-direction:column; align-items:center; gap:3px; cursor:pointer; border:none; background:none; padding:0;}
    #am-panel .col-palette-swatch-chip{width:100%; aspect-ratio:1; border-radius:6px; border:1px solid var(--line-soft);}
    #am-panel .col-palette-swatch-hex{font-size:8.5px; color:var(--ink-soft); font-family:monospace;}
    #am-panel .col-note-style-panel{position:absolute; left:14px; bottom:14px; width:210px; background:var(--paper-card); border:1px solid var(--line); border-radius:12px; padding:12px; box-shadow:0 12px 30px rgba(0,0,0,0.22); z-index:30;}
    #am-panel .col-note-style-row{display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:12px; color:var(--ink-soft); margin-top:8px;}
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

    // Meslek çekmecesi (kullanıcı isteği, 2026-09-02): 10 seçenek düz bir kutuda değil, kişi-ekle
    // ve Profili Düzenle'dekiyle AYNI açılır pencerede.
    // GERÇEK BULGU: çekmece daha önce yalnızca uye-ol.html'e ve Profili Düzenle formuna
    // takılmıştı; oysa temiz /uye-ol yolu index.html + BU POPUP'ı servis ediyor (bkz.
    // lazy-modals.js), yani kullanıcıların gerçekte gördüğü form buydu ve çıplak kalıyordu.
    if (window.ProfessionDrawer) {
      const grp = document.getElementById('am-signup-profession');
      if (grp) ProfessionDrawer.mount(grp, { placeholder: 'Meslek seç' });
    }

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
  // dashNavRow(current): Hesabım/Aktivitelerim/Koleksiyonum popup'larının HEPSİNDE görünen, içinde
  // bulunulan sayfa HARİÇ diğer İKİSİNİ taşıyan geçiş satırı (bkz. kullanıcı isteği, 2026-08-31
  // madde 3; İçeriklerim 2026-09-05'te kaldırıldı). Üç şablonda üç kez elle yazmak yerine tek
  // kaynaktan üretilir — böylece sıra/etiket/stil ve "içinde bulunduğunu gösterme" kuralı üçünde de
  // zorunlu olarak aynı kalır.
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
  ];
  // Geçiş satırının GÖRÜNDÜĞÜ üç görünüm — login/signup/forgot'ta yuva boş bırakılır (o üç
  // görünümde geçilecek bir "diğer sayfa" yok).
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

        <!-- Aynı isimde başka bir kişi zaten varsa (kullanıcı isteği, 2026-09-06) — isim ALTI ÇİZİLİ
             ve profilin linkine bağlı, yanında "Bu profil bana ait" talep butonu (bkz.
             submitArchitectSyncIfNeeded'in 409 dalı, claim-correction-box.js İLE AYNI POST /api/claims). -->
        <div id="am-directory-duplicate-warning" style="display:none; padding:12px 14px; margin:-6px 0 16px; border:1px solid var(--accent); border-radius:10px; background:rgba(224,138,62,0.10); font-size:12.5px; line-height:1.6; color:var(--ink);"></div>

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

      <!-- İSTATİSTİKLER (kullanıcı isteği, 2026-09-04) — YALNIZCA rozetli üyelere gösterilir.
           Kutu varsayılan olarak display:none'dır ve ancak /api/analytics/summary 200 dönerse
           açılır (bkz. loadStats): rozet kontrolü SUNUCUDA yapılır, istemci yalnızca sonucuna
           uyar — 403 alırsa bölüm hiç görünmez. Tam genişlik, .dash-section-wide (Rozetlerim ile
           AYNI desen) çünkü içindeki ızgara/grafik iki sütuna sığmaz. -->
      <div class="dash-row col-two-col" id="am-stats-row" style="display:none;">
        <div class="dash-section dash-section-wide" id="am-stats-section">
          <div class="dash-section-head">
            <h2>İstatistikler</h2>
            <div class="stat-range" id="am-stats-range">
              <button type="button" class="stat-range-btn" data-range="7d">Son 7 Gün</button>
              <button type="button" class="stat-range-btn active" data-range="30d">30 Gün</button>
              <button type="button" class="stat-range-btn" data-range="90d">90 Gün</button>
              <button type="button" class="stat-range-btn" data-range="12m">12 Ay</button>
              <button type="button" class="stat-range-btn" data-range="all">Tüm Zamanlar</button>
            </div>
          </div>
          <p class="section-hint" id="am-stats-hint">Profilinin ve içeriklerinin performansı.</p>
          <div id="am-stats-body"><div class="dash-empty">Yükleniyor…</div></div>
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
           Kutuların yerleşimi: 1. satır Beğendiklerim | Yorumlarım, 2. satır Paylaştıklarım |
           Eklediklerim (kullanıcı isteği, 2026-09-05: İçeriklerim sayfası kaldırıldı, Eklediklerim
           buraya taşındı). Kırılma noktası .col-two-col ile 620px'e çekilir (bkz. injectStyles'taki
           gerekçe) — istek açıkça "masaüstü VE tablet"te iki sütun diyor, .dash-row'un varsayılan
           860px eşiği çekmecenin 90vw genişliğindeki tablet görünümünü tek sütuna düşürürdü. -->
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

      <!-- Paylaştıklarım | Eklediklerim (kullanıcı isteği, 2026-09-05): İçeriklerim sayfası kaldırıldı,
           "Eklediklerim" kutusu (eski contentsTemplate) buraya taşındı — 2. satır iki sütun. -->
      <div class="dash-row col-two-col">
        <!-- Paylaştıklarım (kullanıcı isteği, 2026-08-31 madde 1): "kullanıcıların paylaş butonuna
             tıklayarak başkalarına ilettikleri gönderiler". Kaynak, Paylaş butonunun (bkz.
             js/components/share-button.js) gerçekten bir paylaşım eylemi TAMAMLANDIĞINDA yazdığı
             shared_items tablosudur (bkz. src/routes/shares.js) — butonu açıp kapatmak değil,
             bağlantıyı kopyalamak/WhatsApp/X/LinkedIn'e göndermek ya da yerel paylaşım sayfasını
             onaylamak sayılır. -->
        <div class="dash-section">
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

        <!-- Eklediklerim — eski contentsTemplate/İçeriklerim popup'ından TAŞINDI (kullanıcı isteği,
             2026-09-05: İçeriklerim sayfası tamamen kaldırıldı). "Marka" filtresi diğer butonların EN
             SONUNA eklendi — marka gönderileri ayrı bir gönderi tipi değil, offices gönderisidir;
             ayrım sunucudan gelen item.isBrand ile yapılır (bkz. src/routes/submissions.js#listMine
             ve office-kind.js). -->
        <div class="dash-section">
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
        <!-- dash-section-wide: Panolarım tek başına ilk satırı tam genişlik kaplar, Kaydettiklerim
             ve Takip Ettiklerim altında yan yana ikinci satıra düşer. -->
        <div class="dash-section dash-section-wide">
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
                 followSeenAt / FOLLOW_FEED_SEEN_KEY). -->
        <div class="dash-section">
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
          <!-- Buton sırası kullanıcı isteği (2026-09-06 madde 2): Paylaş/Dışa Aktar/Yeniden Adlandır/
               Panoyu Sil artık "← Panolarım"ın yanındaki TEK bir "⋮" menüsünün içinde (bkz.
               am-col-kebab-toggle dinleyicisi). Pano adının yanındaki kalem ikonu KALDIRILDI —
               "Yeniden Adlandır" buraya, "Panoyu Sil"in HEMEN ÜSTÜNE taşındı (kullanıcı isteği). -->
          <div class="col-toolbar">
            <button type="button" class="col-btn" id="am-col-back-btn">← Panolarım</button>
            <div class="col-kebab-wrap" id="am-col-kebab-wrap">
              <button type="button" class="col-kebab-toggle" id="am-col-kebab-toggle" aria-haspopup="true" aria-expanded="false" aria-label="Diğer işlemler" title="Diğer işlemler">⋮</button>
              <div class="col-kebab-menu" id="am-col-kebab-menu" style="display:none;">
                <!-- Paylaş ARTIK hem herkese açık bağlantıyı hem ortak çalışma davetlerini barındıran
                     bir panel açar (kullanıcı isteği, 2026-09-05 madde 3) — ikisi de rozet şartlı,
                     tıklama anında kontrol edilir (bkz. am-col-share-btn dinleyicisi, export butonuyla
                     AYNI fetchBadgeAccess deseni). Yalnızca pano SAHİBİNDE görünür (bkz. renderDetail). -->
                <button type="button" class="col-kebab-item" id="am-col-share-btn">Paylaş</button>
                <!-- Dışa Aktar rozetli üyelere özel (kullanıcı isteği). Buton BİLEREK devre dışı
                     (disabled) DEĞİL: devre dışı bir buton hiç click olayı üretmez, dolayısıyla
                     rozetsiz kullanıcıya "rozet al" yönlendirmesini gösteremezdik (kullanıcı isteği,
                     2026-09-02). Yetki kontrolü tıklama anında yapılır.
                     NOT: bu blok bir template literal içindedir - ters tırnak KULLANMA (bkz. proje
                     belleği: sekme içi ters tırnak şablonu sessizce bozar). -->
                <button type="button" class="col-kebab-item" id="am-col-export-btn">Dışa Aktar</button>
                <button type="button" class="col-kebab-item" id="am-col-rename-btn">Yeniden Adlandır</button>
                <button type="button" class="col-kebab-item col-kebab-item-danger" id="am-col-delete-btn">Panoyu Sil</button>
              </div>
            </div>
          </div>
          <h2 id="am-col-detail-title">
            <span id="am-col-detail-title-text"></span>
          </h2>
          <p class="section-hint" id="am-col-detail-count"></p>
          <!-- Tam sayfa görünüm sarmalayıcısı (kullanıcı isteği, 2026-09-06 madde 2) — görünüm
               geçişi + ekle menüsü BU satırdan itibaren dahil (kullanıcı isteği: "liste/ızgara ve
               ekle butonu dahil"), aksi halde tam ekran moduna geçince bu satır sarmalayıcının
               ALTINDA/GERİSİNDE kalıp görünmez/tıklanamaz olurdu (bkz. am-col-fullscreen-toggle). -->
          <div class="col-canvas-fs-target" id="am-col-canvas-fs-target">
          <!-- Liste/Izgara görünüm geçişi (kullanıcı isteği madde 1) — ikisi de AYNI openCollection.
               items dizisinden beslenir (bkz. renderDetail). Liste artık SOLDA ve VARSAYILAN
               (kullanıcı isteği, 2026-09-06): kelime sırası değişti VE boardViewMode başlangıç
               değeri 'list' oldu (bkz. openDetail). Ekleme butonları (Kaydettiklerimden Ekle vb.)
               ARTIK bu satırdaki "+ Ekle" menüsünün içinde — ayrı bir araç çubuğu satırı yok. -->
          <div class="col-view-row">
            <div class="col-view-toggle" id="am-col-view-toggle">
              <button type="button" class="active" data-view="list">Liste</button>
              <button type="button" data-view="grid">Izgara</button>
            </div>
            <div class="col-kebab-wrap" id="am-col-add-menu-wrap">
              <button type="button" class="col-btn" id="am-col-add-menu-toggle" aria-haspopup="true" aria-expanded="false">+ Ekle</button>
              <div class="col-kebab-menu" id="am-col-add-menu" style="display:none;">
                <button type="button" class="col-kebab-item" data-col-add="saved">Kaydettiklerimden Ekle</button>
                <button type="button" class="col-kebab-item" data-col-add="follow">Takip Ettiklerimden Ekle</button>
                <button type="button" class="col-kebab-item" data-col-add="image">Görsel Yükle</button>
                <button type="button" class="col-kebab-item" data-col-add="note">Not Ekle</button>
              </div>
            </div>
            <!-- Tam sayfa görünüm (kullanıcı isteği, 2026-09-06 madde 2): ızgara/liste VE araçları
                 (bu satır + ekle menüsü dahil) tek bir sarmalayıcıda (am-col-canvas-fs-target)
                 tam ekranı kaplar — bkz. am-col-fullscreen-toggle dinleyicisi. -->
            <button type="button" class="col-fullscreen-toggle" id="am-col-fullscreen-toggle" aria-pressed="false" aria-label="Tam sayfa görünüm" title="Tam sayfa görünüm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
            </button>
          </div>

          <!-- Paylaş/İşbirliği paneli — kullanıcı isteği madde 3. Herkese açık bağlantı aç/kapat +
               e-posta ile davet + mevcut işbirlikçi listesi tek panelde. -->
          <div class="col-add-panel" id="am-col-share-panel" style="display:none;">
            <strong style="font-size:13px;">Herkese Açık Bağlantı</strong>
            <p class="section-hint" style="margin:4px 0 8px;">Bağlantıyı bilen herkes panonu salt-okunur görebilir.</p>
            <button type="button" class="col-btn" id="am-col-public-link-btn">Paylaş</button>
            <div style="margin-top:18px; padding-top:16px; border-top:1px solid var(--line-soft);">
              <strong style="font-size:13px;">Kişi Davet Et</strong>
              <p class="section-hint" style="margin:4px 0 8px;">MİMARLAB'a kayıtlı bir üyeyi e-postasıyla davet et.</p>
              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <input type="email" id="am-col-invite-email" placeholder="ornek@eposta.com" style="flex:1; min-width:160px; padding:9px 12px; border:1px solid var(--line); border-radius:10px; background:var(--paper); color:var(--ink); font-size:13px; font-family:inherit;">
                <select id="am-col-invite-role" style="padding:9px 10px; border:1px solid var(--line); border-radius:10px; background:var(--paper); color:var(--ink); font-size:13px; font-family:inherit;">
                  <option value="viewer">Görüntüleyici</option>
                  <option value="editor">Editör</option>
                </select>
                <button type="button" class="col-btn col-btn-primary" id="am-col-invite-btn">Davet Gönder</button>
              </div>
            </div>
            <div id="am-col-collaborator-list" style="margin-top:14px;"></div>
          </div>

          <div class="col-add-panel" id="am-col-add-saved" style="display:none;">
            <strong style="font-size:13px;">Kaydettiklerim</strong>
            <div class="saved-filter" id="am-col-add-saved-filter">
              <button type="button" class="saved-filter-btn active" data-filter="">Tümü</button>
              <button type="button" class="saved-filter-btn" data-filter="project">Projeler</button>
              <button type="button" class="saved-filter-btn" data-filter="product">Ürünler</button>
            </div>
            <div class="col-saved-picker" id="am-col-saved-picker"><div class="dash-empty">Yükleniyor…</div></div>
          </div>
          <div class="col-add-panel" id="am-col-add-follow" style="display:none;">
            <strong style="font-size:13px;">Takip Ettiklerimin Son Eklediği İçerikler</strong>
            <div class="saved-filter" id="am-col-add-follow-filter">
              <button type="button" class="saved-filter-btn active" data-filter="">Tümü</button>
              <button type="button" class="saved-filter-btn" data-filter="project">Projeler</button>
              <button type="button" class="saved-filter-btn" data-filter="product">Ürünler</button>
            </div>
            <div class="col-saved-picker" id="am-col-follow-picker"><div class="dash-empty">Yükleniyor…</div></div>
          </div>
          <div class="col-add-panel" id="am-col-add-image" style="display:none;">
            <strong style="font-size:13px;">Bilgisayarından görsel yükle</strong>
            <div class="avatar-upload-hint">JPEG, PNG, WEBP ya da GIF · en fazla 2 MB</div>
            <div style="margin-top:10px;">
              <button type="button" class="col-btn" id="am-col-image-btn">Görsel Seç</button>
              <input type="file" id="am-col-image-input" accept="image/*" style="display:none;">
            </div>
          </div>
          <div class="col-add-panel" id="am-col-add-note" style="display:none;">
            <strong style="font-size:13px;">Not Stili</strong>
            <p class="section-hint" style="margin:4px 0 8px;">Önce rengi/puntoyu/kalınlığı seç, sonra metni yaz.</p>
            <div class="col-canvas-pen-swatches" id="am-col-new-note-swatches"></div>
            <div style="display:flex; align-items:center; gap:14px; margin-top:10px; flex-wrap:wrap;">
              <input type="color" id="am-col-new-note-color-custom" value="#1B2A3D" title="Özel renk">
              <label class="col-note-style-row" style="margin-top:0;">Punto <input type="range" id="am-col-new-note-size" min="10" max="48" value="14"></label>
              <label class="col-note-style-row" style="margin-top:0;"><input type="checkbox" id="am-col-new-note-bold"> Kalın</label>
            </div>
            <textarea id="am-col-note-text" maxlength="4000" placeholder="Bu panoyla ilgili bir not yaz…" style="margin-top:12px;"></textarea>
            <div style="margin-top:10px;">
              <button type="button" class="col-btn col-btn-primary" id="am-col-note-save-btn">Notu Ekle</button>
            </div>
          </div>

          <div class="col-notice" id="am-col-detail-notice"></div>

          <!-- A4 Pafta araç çubuğu (kullanıcı isteği, 2026-09-06 madde 1/2) — kağıt yönü, çizim aracı
               (kalem/kalınlık/renk) ve yakınlaştırma tek satırda. -->
          <div class="col-canvas-toolbar">
            <div class="col-canvas-toolbar-group">
              <button type="button" class="col-canvas-tbtn" data-orientation="landscape" title="Yatay A4">Yatay A4</button>
              <button type="button" class="col-canvas-tbtn" data-orientation="portrait" title="Dikey A4">Dikey A4</button>
            </div>
            <div class="col-canvas-toolbar-group">
              <button type="button" class="col-canvas-tbtn" id="am-col-pen-toggle" title="Çizim Aracı">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                Çizim
              </button>
              <span id="am-col-pen-options" style="display:none; align-items:center; gap:8px;">
                <input type="range" id="am-col-pen-width" min="1" max="20" value="3" title="Kalınlık">
                <span class="col-canvas-pen-swatches" id="am-col-pen-swatches"></span>
                <input type="color" id="am-col-pen-color-custom" value="#1B2A3D" title="Özel renk">
              </span>
            </div>
            <div class="col-canvas-toolbar-group">
              <button type="button" class="col-canvas-tbtn" id="am-col-zoom-out" title="Uzaklaştır">−</button>
              <span class="col-canvas-zoom-label" id="am-col-zoom-label">100%</span>
              <button type="button" class="col-canvas-tbtn" id="am-col-zoom-in" title="Yakınlaştır">+</button>
              <button type="button" class="col-canvas-tbtn" id="am-col-zoom-reset" title="Sığdır">Sığdır</button>
            </div>
          </div>

          <div class="col-canvas-wrap">
            <div class="col-canvas-viewport" id="am-col-canvas-viewport">
              <div id="am-col-items"><div class="dash-empty">Yükleniyor…</div></div>
            </div>
            <!-- Renk Paleti / Kartela (kullanıcı isteği madde 3) — panodaki proje/ürün görsellerinden
                 çıkarılan baskın renkler, açılıp kapanabilen dinamik bir widget. Aynı renkler çizim
                 aracında (am-col-pen-swatches) ve not stil panelinde (am-col-note-style-panel) DA
                 kullanılır — TEK kaynak burasıdır (bkz. lastPaletteHexes). -->
            <button type="button" class="col-palette-toggle" id="am-col-palette-toggle" title="Renk Paleti" aria-label="Renk Paletini Göster">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a9 9 0 1 1 0-18 8 8 0 0 1 8 8c0 1.66-1.34 3-3 3h-1.5a1.5 1.5 0 0 0-1.06 2.56c.4.4.56.85.56 1.44 0 1.1-.9 2-2 2Z"/><circle cx="7.5" cy="10.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="11" cy="7" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8" r="1.2" fill="currentColor" stroke="none"/></svg>
            </button>
            <div class="col-palette-panel" id="am-col-palette-panel" style="display:none;">
              <strong style="font-size:12.5px;">Renk Paleti</strong>
              <div class="col-palette-swatches" id="am-col-palette-swatches"><div class="dash-empty" style="font-size:11.5px;">Panoya görsel ekleyince renkler burada listelenir.</div></div>
            </div>
            <!-- Not stil paneli (kullanıcı isteği madde 2) — bir notun kalem/düzenle ikonuna
                 tıklanınca burada renk/punto/kalınlık ayarlanır (bkz. openNoteStylePanel). -->
            <div class="col-note-style-panel" id="am-col-note-style-panel" style="display:none;">
              <strong style="font-size:12.5px;">Not Stili</strong>
              <div class="col-canvas-pen-swatches" id="am-col-note-style-swatches"></div>
              <input type="color" id="am-col-note-style-color-custom" value="#1B2A3D" title="Özel renk">
              <label class="col-note-style-row">Punto <input type="range" id="am-col-note-style-size" min="10" max="48" value="14"></label>
              <label class="col-note-style-row"><input type="checkbox" id="am-col-note-style-bold"> Kalın</label>
              <button type="button" class="col-btn" id="am-col-note-style-close" style="margin-top:8px;">Kapat</button>
            </div>
          </div>


          <!-- Liste görünümü (kullanıcı isteği madde 1) — .col-canvas-wrap ile AYNI seviyede, ikisi
               karşılıklı gizlenir (bkz. renderDetail). Kalem çizimleri burada YOK — yalnızca
               collection_items satır satır listelenir. -->
          <div class="col-list" id="am-col-list-mode" style="display:none;"></div>
          </div>
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
  // Panolarım'a bilgisayardan yüklenen görselin ÜST SINIRI (kullanıcı isteği, 2026-09-03).
  // src/routes/upload.js#CONTEXT_MAX_BYTES['collection'] ile AYNI değer olmak zorunda.
  const COLLECTION_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
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
  // Onaylı firma talebinin ONAY ANINDA dondurulmuş office_position'ı (bkz. renderFirmEditBtn) —
  // /api/claims/mine artık bu alanı döndürüyor.
  let firmInfoPosition = null;
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
  // ---------------------------------------------------------------------------------------
  // ROZET ERİŞİMİ — TEK ve YARIŞSIZ kaynak.
  //
  // KÖK NEDEN (kullanıcı bildirimi: "rozeti olmasına rağmen BAZEN rozet al uyarısı veriyor"):
  // amHasAnyBadge() üç ayrı modül değişkenine bakıyordu (amClaimItems / amPublicBadges /
  // amBadgeItems) ve bu üçü YALNIZCA Hesabım görünümü açılırken dolduruluyordu (bkz. mountAccount
  // sonundaki loadUser().then(...) bloğu). Kullanıcı doğrudan /koleksiyonum'a girip Dışa Aktar'a
  // bastığında bu yüklemeler hiç çalışmamış oluyor, dolayısıyla rozet "yok" görünüyordu —
  // "bazen" olmasının sebebi buydu: önce Hesabım'a uğrayan kullanıcıda çalışıyor, doğrudan
  // Panolarım'a gidende çalışmıyordu.
  //
  // Çözüm: yetki artık görünüm yükleme sırasına HİÇ bağlı değil. /api/badges/mine bir kez çağrılıp
  // (memoize) sonucu paylaşılıyor. Kaynak `profileBadges` — sunucuda admin_badges ile satın alınan
  // rozeti ZATEN birleştiren tek harita (bkz. src/routes/badges.js#getProfileBadgesForUser), yani
  // "admin tarafından verilen rozetle satın alınan rozetin farkı olmasın" kuralı burada değil
  // sunucuda, tek noktada sağlanıyor.
  let amBadgeAccessPromise = null;
  function badgeAccessFrom(data) {
    const pb = (data && data.profileBadges) || {};
    if (pb.self) return true;
    if (pb.offices && Object.keys(pb.offices).some(k => pb.offices[k])) return true;
    // Henüz profil sahiplenmemiş ama kendi adına rozet almış üye.
    return (data && Array.isArray(data.items) ? data.items : [])
      .some(b => b.status === 'active' && b.badge_type !== 'destekci');
  }
  function fetchBadgeAccess(force) {
    if (force) amBadgeAccessPromise = null;
    if (!amBadgeAccessPromise) {
      amBadgeAccessPromise = fetch('/api/badges/mine')
        .then(r => (r.ok ? r.json() : null))
        .then(d => (d ? badgeAccessFrom(d) : null))
        // null = BİLİNMİYOR (ağ/oturum hatası). Çağıran taraf bunu "rozetin yok" saymaz;
        // kullanıcıyı yanlışlıkla suçlamaktansa işlemi denemek daha doğru.
        .catch(() => null);
    }
    return amBadgeAccessPromise;
  }
  window.addEventListener('mimarlab-badges-changed', () => { amBadgeAccessPromise = null; });

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
  // Ortak görsel yükleme boru hattı (image-upload.js): tarayıcı görseli MİMARLAB standardına
  // (WebP, kutuya sığdırılmış, asla büyütülmemiş) çevirir VE aynı decode'dan w400/w800/w1600
  // responsive türevlerini üretir; sunucu doğrulayıp kalıcı olarak R2'ye yazar (bkz.
  // src/lib/derivativeIngest.js). Ücretli hiçbir Cloudflare Image Transformation kullanılmaz.
  //
  // NEDEN <script src> DEĞİL DE DİNAMİK YÜKLEME: bu bileşen SİTENİN HER SAYFASINDA yüklenir ama
  // görsel yükleme yalnızca iki nadir akışta (profil fotoğrafı, koleksiyona görsel ekleme) olur.
  // 15+ HTML dosyasına etiket eklemek yerine dosya ilk ihtiyaç anında indirilir. CSP uyumludur
  // ("script-src 'self'", bkz. src/index.js#CONTENT_SECURITY_POLICY). Yüklenemezse null döner ve
  // çağıran, işlenmemiş dosyayı yükleyen eski yoluna geri düşer — akış hiçbir zaman kırılmaz.
  let imageUploadLoader = null;
  function loadImageUploadModule() {
    if (window.MimarlabUpload) return Promise.resolve(window.MimarlabUpload);
    if (!imageUploadLoader) {
      imageUploadLoader = new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = '/image-upload.js';
        script.onload = () => resolve(window.MimarlabUpload || null);
        script.onerror = () => resolve(null);
        document.head.appendChild(script);
      });
    }
    return imageUploadLoader;
  }

  // Hazırlanmış (ve mümkünse türevli) bir FormData döner. Modül yüklenemezse dosyayı OLDUĞU GİBİ
  // taşıyan bir FormData döner — davranış bu değişiklikten önceki hâliyle birebir aynı olur.
  async function buildImageUploadForm(file, opts) {
    const mod = await loadImageUploadModule();
    if (mod) return mod.buildUploadForm(file, opts);
    const form = new FormData();
    if (opts && opts.filename) form.append('file', file, opts.filename);
    else form.append('file', file);
    if (opts && opts.context) form.append('context', opts.context);
    return form;
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
    // Kaydet'e basılana kadar bellekte tutulan profil fotoğrafı (bkz. am-avatar-file-input).
    let pendingAvatarFile = null;
    let pendingAvatarUrl = null;
    const wired = new Set();
    function on(id, evt, fn) {
      const key = id + ':' + evt;
      if (wired.has(key)) return;
      wired.add(key);
      const el = document.getElementById(id);
      if (el) el.addEventListener(evt, fn);
    }

    // Önizlemedeki fotoğrafa tıklamak onu büyütüp yeniden kırpar (kullanıcı isteği, 2026-09-04) —
    // bkz. js/components/image-crop.js#enableThumbCrop, kisi-ekle.html'deki AYNI desen. PROFİL
    // FOTOĞRAFI 1:1 KİLİTLİ. Kırpılan dosya (yeni seçilen bir dosya gibi) yalnızca BELLEKTE tutulur,
    // gerçek yükleme Kaydet'te olur (bkz. am-avatar-file-input handler'ındaki AYNI gerekçe).
    function wireAvatarThumbCrop(source) {
      const prev = document.getElementById('am-avatar-preview');
      const imgEl = prev && prev.querySelector('img');
      if (!imgEl || !window.ImageCrop) return;
      ImageCrop.enableThumbCrop(imgEl, {
        source, aspect: 1, title: 'Profil fotoğrafını kırp',
        onCropped: (file) => { setPendingAvatar(file); },
      });
    }
    function setPendingAvatar(file) {
      pendingAvatarFile = file;
      if (pendingAvatarUrl) URL.revokeObjectURL(pendingAvatarUrl);
      pendingAvatarUrl = URL.createObjectURL(file);
      const prev = document.getElementById('am-avatar-preview');
      if (prev) prev.innerHTML = `<img src="${escapeAttr(pendingAvatarUrl)}" alt="">`;
      const hint = document.getElementById('am-avatar-upload-hint');
      if (hint) hint.textContent = 'Önizleme — Kaydet\'e bastığında yüklenecek.';
      wireAvatarThumbCrop(file);
    }

    function renderAvatar() {
      const img = accountUser.photoUrl ? `<img src="${escapeAttr(avatarImg(accountUser.photoUrl, 128, accountUser.photoUrl))}" alt="">` : '';
      document.getElementById('am-dash-avatar').innerHTML = img || dashInitials(accountUser.name);
      document.getElementById('am-avatar-preview').innerHTML = img || dashInitials(accountUser.name);
      // Kaynak olarak ORİJİNAL photoUrl verilir, önizlemedeki 128px'lik türev DEĞİL — kırpma tam
      // çözünürlükten yapılsın (bkz. avatarImg'in ikinci/üçüncü argümanı).
      wireAvatarThumbCrop(accountUser.photoUrl || null);
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
      // Bilerek await EDİLMİYOR (kullanıcı isteği, 2026-09-03: "Hesabım çok yavaş yükleniyor") —
      // ikisi de henüz görünmeyen Profili Düzenle formunun Firma açılır listesini doldurur, dashboard
      // kutularının (bildirim/mesaj/rozet/firma bilgisi) render'ını beklettirmeye değmez. Onlar
      // loadUser()'ın DÖNÜŞÜNÜ bekleyen aşağıdaki paralel yükleme grubunda (loadUser().then(...)).
      loadFirmaOptions().catch(() => {});
      prefillFirmaSelect().catch(() => {});
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
    // loadMyClaims() (dashboard) VE prefillFirmaSelect() (Profili Düzenle formu) AYNI /api/claims/mine
    // ucunu okuyordu — ikisi de loadUser()'ın tetiklediği açılışta neredeyse eşzamanlı çağrıldığından
    // her Hesabım açılışında bu uca gereksiz İKİNCİ bir istek atılıyordu (bkz. kullanıcı isteği,
    // 2026-09-03: "Hesabım çok yavaş yükleniyor"). Tek sonuç mountAccount() ömrü boyunca paylaşılır.
    let myClaimsPromise = null;
    function fetchMyClaims() {
      if (!myClaimsPromise) myClaimsPromise = fetch('/api/claims/mine').then(r => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] }));
      return myClaimsPromise;
    }
    // Sahiplenilmiş MİMAR kaydı — hem syncClaimedArchitectData (profil alanlarını bir kerelik
    // taşıma) hem loadFirmInfo/prefillFirmaSelect (firma bilgisi ikinci kaynağı, bkz. kullanıcı
    // isteği 2026-09-06 madde 4) aynı kaydı istiyordu; üç ayrı fetch yerine tek paylaşılan söz.
    let claimedArchitectKey = null;
    let claimedArchitectPromise = null;
    function fetchClaimedArchitect(claimItems) {
      const claim = (claimItems || []).find(c => c.profile_type === 'architect' && c.status === 'approved');
      if (!claim) return Promise.resolve(null);
      if (claimedArchitectKey !== claim.profile_key) {
        claimedArchitectKey = claim.profile_key;
        claimedArchitectPromise = fetch(`/api/architect/${encodeURIComponent(claim.profile_key)}`)
          .then(r => (r.ok ? r.json() : null))
          .then(d => (d && d.item) || null)
          .catch(() => null);
      }
      return claimedArchitectPromise;
    }
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
    // Seçenekler bir kez doldurulur ve DÖNEN SÖZ saklanır — prefillFirmaSelect() değeri ancak
    // <option>'lar DOM'a girdikten sonra atayabilir (gerçek bulgu: ikisi paralel çağrıldığından,
    // seçenekler geç gelirse select.value = "X" sessizce boşta kalıyordu).
    let firmaOptionsPromise = null;
    function loadFirmaOptions() {
      if (firmaOptionsPromise) return firmaOptionsPromise;
      firmaOptionsPromise = (async () => {
        const select = document.getElementById('am-edit-office');
        if (!allOfficeNamesPromise) allOfficeNamesPromise = fetchAllOfficeNames().catch(() => []);
        const names = await allOfficeNamesPromise;
        select.innerHTML = '<option value="">Seç... (opsiyonel)</option>' + names.map(n => `<option value="${escapeAttr(n)}">${escapeHtml(n)}</option>`).join('');
      })();
      return firmaOptionsPromise;
    }
    // Listede olmayan bir firma adı (ör. mimar kaydından gelen, /api/offices sayfalamasında
    // yakalanmamış ya da yalnızca gönderi olarak var olan bir isim) seçilebilsin diye seçenek
    // gerekirse yerinde oluşturulur — aksi halde select.value ataması sessizce boşa düşer ve
    // kullanıcı firmasını formda GÖREMEZDİ (kullanıcı isteği, 2026-09-06 madde 4).
    function setOfficeSelectValue(select, name) {
      if (!name) { select.value = ''; return; }
      if (!Array.from(select.options).some(o => o.value === name)) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
      }
      select.value = name;
    }
    // Kutunun başlangıç değeri, kullanıcının hâlihazırda onaylı ya da beklemede bir ofis talebi
    // varsa onu yansıtır — böylece kaydet'e tekrar basmak (seçim değiştirilmeden) createClaim'in
    // no-op dallarına düşer (bkz. src/routes/claims.js — approved/pending için ikinci bir POST hiçbir
    // şey yazmaz), yalnızca GERÇEKTEN farklı bir firma seçilirse yeni bir talep oluşur.
    //
    // İKİNCİ KAYNAK (kullanıcı isteği, 2026-09-06 madde 4: "bir kullanıcı bir firmada ortak, kurucu,
    // ekip üyesi vs. şeklinde gözüküyorsa ... profilini düzenle ekranında da bu firma bilgisi
    // gözüksün"): ofis talebi YOKSA sahiplenilmiş mimar kaydının `office` alanına düşülür. Kullanıcı
    // bir firmanın Kurucular/Ekip kutusuna ELLE yazılmışsa (bkz. src/lib/officeFounderCascade.js —
    // görünürlüğün ikinci yolu) hiç profile_claims satırı oluşmaz; eski kod bu durumda kutuyu boş
    // bırakıyordu.
    async function prefillFirmaSelect() {
      const select = document.getElementById('am-edit-office');
      try {
        await loadFirmaOptions();
        const claims = (await fetchMyClaims()).items || [];
        const officeClaim = claims.find(c => c.profile_type === 'office' && c.status === 'approved')
          || claims.find(c => c.profile_type === 'office' && c.status === 'pending');
        if (officeClaim) { setOfficeSelectValue(select, officeClaim.profile_key); }
        else {
          const arch = await fetchClaimedArchitect(claims);
          setOfficeSelectValue(select, (arch && arch.office) || '');
        }
        // bkz. submitFirmaClaimIfChanged — kullanıcı seçimi DEĞİŞTİRMEDİYSE Kaydet'te talep
        // gönderilmemeli. Ofis talebi varken bunu zaten o fonksiyonun `existing` kontrolü sağlıyordu;
        // mimar kaydından gelen ön-dolum için karşılaştırılacak bir talep olmadığından değeri burada
        // hatırlıyoruz.
        firmaSelectPrefillValue = select.value || '';
      } catch {}
    }
    let firmaSelectPrefillValue = '';

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
    // Kullanıcının onaylı bir mimar profili YOKKEN oluşturduğu kendi kişi gönderisini bulur
    // (claimed_profile_key TAŞIMAZ — bir profili sahiplenme değil, kendi kaydını açma).
    async function fetchOwnSelfSubmission() {
      try {
        const res = await fetch('/api/architects/mine');
        if (!res.ok) return null;
        const data = await res.json();
        const own = (data.items || []).filter(m => !m.claimed_profile_key);
        if (!own.length) return null;
        return own.reduce((a, b) => (b.updated_at > a.updated_at ? b : a));
      } catch { return null; }
    }

    async function refreshArchitectSyncState(claimItems) {
      const claim = claimItems.find(c => c.profile_type === 'architect' && c.status === 'approved');
      if (!claim) {
        // GERÇEK BULGU (kullanıcı bildirimi): burada eskiden yalnızca `architectSyncState = null`
        // vardı. Onaylı mimar profili OLMAYAN normal bir kullanıcı "Kişi sayfasında görünmek
        // istiyorum: Evet" deyip kaydettiğinde submitArchitectSyncIfNeeded ilk satırında geri
        // dönüyor, tercih HİÇBİR YERE yazılmıyordu; /api/profile gövdesinde de bu alan yok.
        // Formu yeniden açınca da okunacak bir kayıt olmadığından radyo HTML'deki varsayılan
        // "Hayır"a düşüyordu — kullanıcının gördüğü "Evet dedim, Hayır'a dönmüş" davranışı buydu.
        // Artık kullanıcının kendi kişi gönderisi (varsa) durum olarak kurulur ve tercih ondan okunur.
        const own = await fetchOwnSelfSubmission();
        if (!own) { architectSyncState = null; return; }
        architectSyncState = { profileKey: null, editId: own.id, office: own.office || '', photoUrl: own.photo_url || '' };
        const el = document.querySelector(`input[name="am-directory-listed"][value="${own.directory_listed === 0 ? 'no' : 'yes'}"]`);
        if (el) el.checked = true;
        return;
      }
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

    // ---------- ÜRÜN ETİKETLEME ONAYI (kullanıcı isteği, 2026-09-05 madde 5) ----------
    // Bir marka sahibi/üye, bir proje görselinde bir ürünü işaretlediğinde ürünün sahibine + tüm
    // adminlere `hotspot_tag` tipinde, link'i "hotspot-tag:<id>" olan bir bildirim düşer (bkz.
    // src/routes/hotspotTags.js#createTag). O satıra tıklanınca burası açılır: öneriyi (proje,
    // görsel, ürün, işaretlenen nokta) gösterir ve Onayla/Reddet sunar. Onaylanana kadar işaretçi
    // hiçbir yerde görünmez — karar yetkisi sunucuda AYRICA doğrulanır (bkz. o dosyadaki canDecide),
    // buradaki buton yalnızca bir arayüz kolaylığıdır.
    // Bağlantı biçimi olarak "msg:<threadId>" deseni taklit edilir (bkz. threadIdFromLink) — bildirim
    // satırı bir URL'ye gitmek yerine yerinde bir pop-up açtığında bu depoda kullanılan yol budur.
    function hotspotTagIdFromLink(link) {
      return link && link.startsWith('hotspot-tag:') ? link.slice('hotspot-tag:'.length) : null;
    }
    function openHotspotTagPrompt(tagId) {
      let ov = document.getElementById('am-hotspot-tag-prompt');
      if (!ov) {
        ov = document.createElement('div');
        ov.id = 'am-hotspot-tag-prompt';
        ov.className = 'profile-edit-overlay';
        document.getElementById('am-panel').appendChild(ov);
        ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.remove('open'); });
      }
      ov.innerHTML = `<div class="dash-form" style="background:var(--paper-card); border:1px solid var(--line); border-radius:16px; padding:24px; max-width:460px;">
        <p style="font-size:13px; color:var(--ink-soft); margin:0;">Yükleniyor…</p></div>`;
      ov.classList.add('open');
      fetch(`/api/hotspot-tags/${encodeURIComponent(tagId)}`)
        .then(r => r.ok ? r.json() : Promise.reject(new Error('x')))
        .then(data => {
          const it = data.item;
          const decided = it.status !== 'pending';
          const statusText = it.status === 'approved' ? 'Bu etiketleme onaylandı.'
            : it.status === 'rejected' ? 'Bu etiketleme reddedildi.' : '';
          // İşaretlenen nokta, görselin üzerinde küçük bir turuncu daireyle gösterilir — onay veren
          // kişi ürünün TAM olarak nereye konacağını görmeden karar veremezdi.
          const preview = `<div style="position:relative; border-radius:12px; overflow:hidden; background:var(--paper-alt); margin:0 0 14px;">
              <img src="${escapeAttr(typeof cdnImg === 'function' ? cdnImg(it.imageUrl, 640) : it.imageUrl)}" alt="" style="display:block; width:100%; height:auto;">
              <span style="position:absolute; left:${it.x}%; top:${it.y}%; transform:translate(-50%,-50%); width:20px; height:20px; border-radius:50%; border:2.5px solid #fff; background:var(--accent, #E08A3E); box-shadow:0 2px 10px rgba(15,19,26,0.45);"></span>
            </div>`;
          ov.innerHTML = `<div class="dash-form" style="background:var(--paper-card); border:1px solid var(--line); border-radius:16px; padding:24px; max-width:460px; max-height:82vh; overflow-y:auto;">
            <h2 style="font-size:16px; font-weight:700; margin:0 0 10px;">Ürün etiketlemesi</h2>
            ${it.imageUrl ? preview : ''}
            <p style="font-size:13px; line-height:1.6; margin:0 0 6px;">
              <b>${escapeHtml(it.product ? it.product.title : '')}</b>${it.product && it.product.brand ? ` · ${escapeHtml(it.product.brand)}` : ''}
            </p>
            <p style="font-size:12.5px; color:var(--ink-soft); line-height:1.55; margin:0 0 16px;">
              ${escapeHtml(it.createdBy || 'Bir üye')}, ${it.project ? `“${escapeHtml(it.project.title)}”` : 'bir'} projesinin bu görselinde bu ürünü işaretledi.
              ${statusText ? escapeHtml(statusText) : 'Onaylarsan işaretçi projede herkese görünür olur.'}
            </p>
            <p class="am-ht-msg" style="display:none; font-size:12.5px; margin:0 0 12px;"></p>
            ${(!decided && data.canDecide) ? `<div style="display:flex; gap:10px;">
              <button type="button" class="dash-edit-btn am-ht-approve" style="margin-left:0; background:var(--ink); color:var(--paper-card);">Onayla</button>
              <button type="button" class="dash-edit-btn am-ht-reject" style="margin-left:0;">Reddet</button>
            </div>` : `<button type="button" class="dash-edit-btn am-ht-close" style="margin-left:0;">Kapat</button>`}
          </div>`;
          const msg = ov.querySelector('.am-ht-msg');
          const closeBtn = ov.querySelector('.am-ht-close');
          if (closeBtn) closeBtn.addEventListener('click', () => ov.classList.remove('open'));
          const decide = async (approve, btn) => {
            const buttons = ov.querySelectorAll('.dash-edit-btn');
            buttons.forEach(b => { b.disabled = true; });
            btn.textContent = approve ? 'Onaylanıyor…' : 'Reddediliyor…';
            try {
              const res = await fetch(`/api/hotspot-tags/${encodeURIComponent(tagId)}/decide`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ approve }),
              });
              const out = await res.json().catch(() => ({}));
              if (!res.ok) {
                msg.textContent = out.error || 'İşlem tamamlanamadı.';
                msg.style.color = '#B84C4C';
                msg.style.display = '';
                buttons.forEach(b => { b.disabled = false; });
                btn.textContent = approve ? 'Onayla' : 'Reddet';
                return;
              }
              msg.textContent = approve
                ? 'Onaylandı. İşaretçi artık projede görünüyor.'
                : 'Etiketleme reddedildi.';
              msg.style.color = 'var(--walnut)';
              msg.style.display = '';
              btn.parentElement.remove();
            } catch {
              msg.textContent = 'Sunucuya ulaşılamadı, tekrar dene.';
              msg.style.color = '#B84C4C';
              msg.style.display = '';
              buttons.forEach(b => { b.disabled = false; });
              btn.textContent = approve ? 'Onayla' : 'Reddet';
            }
          };
          const yes = ov.querySelector('.am-ht-approve');
          const no = ov.querySelector('.am-ht-reject');
          if (yes) yes.addEventListener('click', () => decide(true, yes));
          if (no) no.addEventListener('click', () => decide(false, no));
        })
        .catch(() => {
          ov.innerHTML = `<div class="dash-form" style="background:var(--paper-card); border:1px solid var(--line); border-radius:16px; padding:24px; max-width:420px;">
            <p style="font-size:13px; margin:0 0 16px;">Bu etiketleme kaydı bulunamadı — kaldırılmış olabilir.</p>
            <button type="button" class="dash-edit-btn am-ht-close" style="margin-left:0;">Kapat</button></div>`;
          ov.querySelector('.am-ht-close').addEventListener('click', () => ov.classList.remove('open'));
        });
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
      // Form açılırken kutuya KENDİMİZİN yazdığı değer (bkz. prefillFirmaSelect) — kullanıcı bunu
      // değiştirmediyse ortada yeni bir talep yok.
      if (selected === firmaSelectPrefillValue) return false;
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
    // Aynı isimde bir kişi zaten varsa (kullanıcı isteği, 2026-09-06): isim ALTI ÇİZİLİ ve profilin
    // linkine bağlı, yanında "Bu profil bana ait" talebi POST /api/claims'e gider — claim-correction-
    // box.js'in AYNI akışı, burada yalnızca bağlamı (Hesabım'daki dizin kutusu) farklı.
    function showDirectoryDuplicateWarning(existingName, existingSlug) {
      const box = document.getElementById('am-directory-duplicate-warning');
      if (!box) return;
      const nameHtml = existingSlug
        ? `<a href="/kisi/${escapeAttr(existingSlug)}" target="_blank" rel="noopener" style="text-decoration:underline; font-weight:600; color:var(--ink);">${escapeHtml(existingName)}</a>`
        : `<span style="text-decoration:underline; font-weight:600;">${escapeHtml(existingName)}</span>`;
      box.innerHTML = `${nameHtml} kişisi zaten var, profile giderek "Bu profil bana ait" talebi oluşturabilirsin.
        <div style="margin-top:8px;">
          <button type="button" id="am-directory-claim-btn" class="dash-edit-btn" style="padding:6px 14px; font-size:12px; margin-left:0;">Bu profil bana ait — talep gönder</button>
          <span id="am-directory-claim-msg" style="font-size:12px; color:var(--ink-soft); margin-left:8px;"></span>
        </div>`;
      box.style.display = '';
      const claimBtn = document.getElementById('am-directory-claim-btn');
      const claimMsg = document.getElementById('am-directory-claim-msg');
      claimBtn.addEventListener('click', async () => {
        claimBtn.disabled = true;
        try {
          const res = await fetch('/api/claims', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profileType: 'architect', profileKey: existingName }),
          });
          const data = await res.json().catch(() => ({}));
          claimMsg.textContent = res.ok ? 'Talep gönderildi, admin onayını bekliyor.' : (data.error || 'Talep gönderilemedi.');
          if (!res.ok) claimBtn.disabled = false;
        } catch {
          claimMsg.textContent = 'Sunucuya ulaşılamadı, tekrar dene.';
          claimBtn.disabled = false;
        }
      });
    }

    // Kaydet mesajının "onaya gönderildi" demesi için: bu turda YENİ bir kişi kaydı açıldı mı?
    let createdSelfRecord = false;
    // Dönüş değeri (kullanıcı isteği, 2026-09-06): eskiden bu fonksiyon hiçbir şey döndürmüyordu,
    // hata yanıtları (409 isim çakışması dahil) sessizce yutuluyordu (bkz. GERÇEK BULGU aşağıda) —
    // artık çağıran (am-dash-save-btn) sonuca göre ya normal başarı mesajı ya da isim çakışması
    // uyarısını (am-directory-duplicate-warning) gösterebiliyor.
    async function submitArchitectSyncIfNeeded(name, dob, school, professionSlug, position, awards, about, socialLinks) {
      createdSelfRecord = false;
      // Onaylı profili de kendi kaydı da olmayan kullanıcı dizine girmek istiyorsa, kaydı BURADA
      // oluşturulur — kisi-ekle.html'in kullandığı AYNI uç (POST /api/architects). "Hayır" diyen
      // ve zaten kaydı olmayan kullanıcı için yapılacak bir şey yok, boş gönderi açılmaz.
      if (!architectSyncState) {
        const picked = document.querySelector('input[name="am-directory-listed"]:checked');
        if (!picked || picked.value !== 'yes') return { ok: true };
        architectSyncState = { profileKey: null, editId: null, office: '', photoUrl: (accountUser && accountUser.photoUrl) || '' };
        createdSelfRecord = true;
      }
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
        // Kendi-kendine-yayın bayrağı (kullanıcı isteği, 2026-09-06) — YALNIZCA bu turda YENİ bir
        // kayıt açılıyorsa gönderilir (bkz. src/routes/submissions.js#isSelfDirectoryListing, isim
        // sunucuda oturumdaki hesabın adıyla AYRICA doğrulanır, istemci bayrağına güvenilmez).
        // Sunucu bunu görünce admin onay kuyruğuna DÜŞMEDEN anında yayına alır.
        ...(createdSelfRecord ? { selfDirectoryListing: true } : {}),
      };
      // profileKey yalnızca bir PROFİL SAHİPLENME akışında doludur; kendi kaydını açan kullanıcıda
      // null'dır ve alan hiç gönderilmemelidir (aksi halde sunucu boş bir sahiplenme anahtarı yazar).
      if (!architectSyncState.editId && architectSyncState.profileKey) {
        payload.claimed_profile_key = architectSyncState.profileKey;
      }
      try {
        const res = await fetch(architectSyncState.editId ? `/api/architects/${encodeURIComponent(architectSyncState.editId)}` : '/api/architects', {
          method: architectSyncState.editId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          if (data.id) architectSyncState.editId = data.id;
          return { ok: true };
        }
        // GERÇEK BULGU (kod incelemesi, 2026-09-06): bu try/catch eskiden yalnızca ağ hatalarını
        // yakalıyordu — sunucunun 409 isim çakışması yanıtı (bkz. submissions.js#createSubmission)
        // res.ok===false olduğu için hiç okunmuyor, kullanıcıya "Kaydedildi" gibi yanlış bir mesaj
        // gösteriliyordu, kayıt sessizce hiç oluşmamış oluyordu.
        if (res.status === 409 && data.duplicateName) {
          return { ok: false, duplicateName: true, existingName: data.existingName, existingSlug: data.existingSlug };
        }
        return { ok: false, error: data.error || 'Kaydedilemedi.' };
      } catch {
        return { ok: false, error: 'Sunucuya ulaşılamadı.' };
      }
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
      // Ad Soyad, Meslek, Açıklama ve profil fotoğrafı zorunlu. Doğum Yılı 2026-09-02'de
      // kullanıcı isteğiyle OPSİYONELE çevrildi; kisi-ekle.html ile bu dörtlü birebir aynı
      // kalmalı — iki form aynı kişi kaydını besliyor. Dizine GİRMEK İSTEMEYEN
      // biri bu alanlar boşken de profilini kaydedebilir — zorunluluk yalnızca herkese açık
      // kartta eksik bilgi görünmesini engellemek için. kisi-ekle.html'de AYNI dörtlü zorunludur.
      const wantsDirectory = document.querySelector('input[name="am-directory-listed"]:checked');
      if (wantsDirectory && wantsDirectory.value === 'yes') {
        const eksik = [];
        if (!name || !name.trim()) eksik.push('Ad Soyad');
        if (!profession) eksik.push('Meslek');
        if (!about || !about.trim()) eksik.push('Açıklama');
        // GERÇEK BULGU (kullanıcı bildirimi: fotoğraf yüklendiği hâlde "Profil Fotoğrafı zorunlu"
        // uyarısı çıkıyordu): burada `accountUser.photo_url` okunuyordu ama /api/auth/me kullanıcıyı
        // publicUser() ile serileştiriyor ve alan adı `photoUrl` (bkz. src/lib/auth.js:47,
        // "photoUrl: photo_url"). snake_case alan HİÇBİR ZAMAN tanımlı olmadığından kontrol her
        // durumda başarısız oluyor, yani fotoğrafı olan kullanıcı da profilini yayımlayamıyordu.
        // Aynı dosyadaki diğer iki kullanım (renderAvatar, mimar senkronizasyonu) zaten doğru
        // camelCase okuyordu — yalnızca bu satır sapmıştı.
        // Bu turda seçilmiş ama henüz yüklenmemiş bir fotoğraf da "var" sayılır — aksi halde ilk kez
        // fotoğraf seçen kullanıcı, fotoğrafı ekranda görmesine rağmen zorunlu alan uyarısı alırdı.
        if (!((accountUser && accountUser.photoUrl) || '') && !pendingAvatarFile) eksik.push('Profil Fotoğrafı');
        if (eksik.length) {
          msg.textContent = 'Kişi sayfasında yayımlanmak için şu alanlar zorunlu: ' + eksik.join(', ') + '.';
          return;
        }
      }
      btn.disabled = true;
      try {
        // Bekleyen profil fotoğrafı VARSA önce R2'ye yüklenir, dönen URL profil yazımına eklenir —
        // böylece fotoğraf ve diğer alanlar TEK Kaydet'te birlikte kalıcılaşır.
        const patch = { name, dob, school, profession, position, awards, about, social_links: socialLinks };
        if (pendingAvatarFile) {
          msg.textContent = 'Fotoğraf yükleniyor…';
          try {
            // 480 px'lik bir avatar için responsive türev ÜRETİLMEZ ve bu doğrudur: modül,
            // betikle aynı 40 KB eşiğini uygular (bkz. image-upload.js#MIN_SOURCE_BYTES) — bu
            // boyutta üç ek R2 nesnesi kazandırdığından fazlasına mal olurdu.
            const fd = await buildImageUploadForm(pendingAvatarFile, { maxEdge: 480, quality: 0.82, filename: 'avatar.webp' });
            const up = await fetch('/api/uploads', { method: 'POST', body: fd });
            const upData = await up.json();
            if (!up.ok) throw new Error(upData.error || 'Yükleme başarısız.');
            patch.photo_url = upData.url;
          } catch (err) {
            msg.textContent = err.message || 'Fotoğraf yüklenemedi, tekrar dene.';
            return;
          }
        }
        const res = await fetch('/api/profile', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          // GERÇEK BULGU (kod incelemesi, 2026-09-06): Ad Soyad alanı hem hesap adı HEM kişi dizini
          // kaydının adı olduğundan, isim çakışması ASLINDA burada (PATCH /api/profile) yakalanır —
          // submitArchitectSyncIfNeeded'e hiç ULAŞILMADAN "Kaydedilemedi, tekrar dene." gösterilip
          // dönülüyordu, kullanıcı isteğindeki "X kişisi zaten var, ... 'Bu profil bana ait' talebi
          // oluştur" uyarısı BURADA da (bkz. src/routes/auth.js#updateUserProfileFields'in AYNI
          // zenginleştirilmiş 409'u) gösterilmeliydi.
          const errData = await res.json().catch(() => ({}));
          if (res.status === 409 && errData.duplicateName) {
            showDirectoryDuplicateWarning(errData.existingName, errData.existingSlug);
            msg.textContent = errData.error || 'Kaydedilemedi.';
          } else {
            msg.textContent = errData.error || 'Kaydedilemedi, tekrar dene.';
          }
          return;
        }
        // Kayıt başarılı — bekleyen dosya tüketildi.
        if (pendingAvatarUrl) { URL.revokeObjectURL(pendingAvatarUrl); pendingAvatarUrl = null; }
        pendingAvatarFile = null;
        const claimSubmitted = await submitFirmaClaimIfChanged();
        const dirWarning = document.getElementById('am-directory-duplicate-warning');
        const architectResult = await submitArchitectSyncIfNeeded(name, dob, school, profession, position, awards, about, socialLinks);

        // Aynı isimde bir kişi zaten varsa (kullanıcı isteği, 2026-09-06) — pop-up KAPANMAZ, isim
        // altı çizili/profile bağlantılı bir uyarı + "Bu profil bana ait" talep butonu gösterilir
        // (bkz. showDirectoryDuplicateWarning, claim-correction-box.js İLE AYNI POST /api/claims).
        if (architectResult && architectResult.duplicateName) {
          showDirectoryDuplicateWarning(architectResult.existingName, architectResult.existingSlug);
          msg.textContent = 'Profil bilgilerin kaydedildi, ama kişi dizini için aşağıya bak.';
          await loadUser();
          await loadMyClaims();
          return;
        }
        if (dirWarning) dirWarning.style.display = 'none';

        // Kendi-kendine-yayın artık ANINDA canlıya girer (kullanıcı isteği, 2026-09-06) — eskiden
        // burada "admin onayına gönderildi" yazıyordu, submissions.js#isSelfDirectoryListing bunu
        // moderasyon kuyruğundan tamamen çıkardığından mesaj artık YANLIŞ olurdu.
        msg.textContent = claimSubmitted
          ? 'Kaydedildi. Firma talebi admin onayına gönderildi.'
          : (createdSelfRecord ? 'Kaydedildi. Profilin artık Kişi sayfasında yayında.' : 'Kaydedildi.');
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
      const picked = e.target.files[0];
      e.target.value = '';                 // aynı dosya tekrar seçilebilsin
      if (!picked) return;
      const hint = document.getElementById('am-avatar-upload-hint');
      // 1:1 kadraj ZORUNLU (kullanıcı isteği, 2026-09-03). Vazgeçilirse hiçbir şey değişmez.
      let file = picked;
      if (window.ImageCrop) {
        try { file = await ImageCrop.open(picked, { title: 'Profil fotoğrafını kırp' }); }
        catch (err) { file = picked; }
        if (!file) { hint.textContent = 'Fotoğraf değiştirilmedi.'; return; }
      }
      // KULLANICI BİLDİRİMİ (2026-09-03): fotoğraf, Kaydet'e basılmadan kendiliğinden
      // kaydediliyordu — burada eskiden doğrudan /api/uploads + PATCH /api/profile çağrılıyordu.
      // Artık dosya yalnızca BELLEKTE tutulup önizleniyor; gerçek yükleme ve kayıt Kaydet'te
      // yapılıyor (bkz. am-dash-save-btn). Yüklemeyi de ertelemek bilinçli: kullanıcı vazgeçerse
      // R2'de öksüz bir dosya kalmaz.
      setPendingAvatar(file);
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
                <span class="badge-status-pill" style="color:${BADGE_STATUS_COLORS.active}; background:${BADGE_STATUS_COLORS.active}22;">Aktif</span>
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
      const data = await fetchMyClaims();
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
    // İKİNCİ KAYNAK (kullanıcı isteği, 2026-09-06 madde 4: "bir kullanıcı bir firmada ortak, kurucu,
    // ekip üyesi vs. şeklinde gözüküyorsa, hesabım sayfasındaki firma bilgileri kutusunda ... bu firma
    // bilgisi gözüksün"): profile_claims('office') satırı YOKSA sahiplenilmiş mimar kaydının `office`
    // alanına düşülür. Bir firmanın Kurucular/Ekip listesinde görünmenin İKİ yolu var (bkz.
    // src/lib/officeFounderCascade.js) — onaylı bir ofis talebi VEYA firma künyesindeki kutuya elle
    // yazılmış bir isim; ikincisinde hiç claim satırı oluşmadığından bu kutu eskiden "henüz bir
    // firmada görev almıyorsun" diyordu. Fallback yalnızca GÖRÜNTÜLEME içindir: firmInfoApproved
    // false kalır, dolayısıyla "Profili Düzenle" butonu (bkz. renderFirmEditBtn) açılmaz — düzenleme
    // yetkisi hâlâ yalnızca onaylı talep + yetkili pozisyon şartına bağlı.
    async function loadFirmInfo(claimItems) {
      const box = document.getElementById('am-firm-facts');
      if (!box) return;
      const claim = claimItems.find(c => c.profile_type === 'office' && c.status === 'approved')
        || claimItems.find(c => c.profile_type === 'office' && c.status === 'pending');
      // officeKey: /api/office/:key'in beklediği anahtar — ofis talebinde profile_key, mimar
      // kaydında `office` alanı; ikisi de firmanın ADIdır, aynı uç ikisini de çözer.
      let officeKey = claim ? claim.profile_key : null;
      let architectRole = null;
      if (!claim) {
        const arch = await fetchClaimedArchitect(claimItems);
        if (arch && arch.office) { officeKey = arch.office; architectRole = arch.role || null; }
      }
      if (!officeKey) {
        firmInfoKey = null;
        firmInfoSlug = null;
        firmInfoApproved = false;
        firmInfoPosition = null;
        renderFirmEditBtn();
        box.innerHTML = '<div class="dash-empty">Henüz bir firmada görev almıyorsun. Profili Düzenle\'den firmanı seçebilirsin.</div>';
        renderClaimsList();
        return;
      }
      firmInfoApproved = !!claim && claim.status === 'approved';
      // Onay anında dondurulmuş pozisyon (bkz. renderFirmEditBtn'deki gerçek bulgu) — accountUser'ın
      // CANLI position'ı değil, sunucunun düzenleme yetkisi için gerçekten baktığı değer.
      firmInfoPosition = claim ? (claim.officePosition || null) : null;
      // Künye çekilemese bile buton bir hedefe sahip olsun: talebin kendi slug'ı (yoksa adı).
      firmInfoSlug = claim ? (claim.slug || claim.profile_key) : officeKey;
      renderFirmEditBtn();
      // Aynı anahtar için ikinci kez ağ isteği atma — loadMyClaims her loadUser()'da çalışıyor.
      if (firmInfoKey === officeKey) return;
      firmInfoKey = officeKey;
      let office = null;
      try {
        const res = await fetch(`/api/office/${encodeURIComponent(officeKey)}`);
        if (res.ok) office = (await res.json()).item;
      } catch {}
      // Firma künyesi çekilemediyse (ağ hatası ya da henüz canonical'a senkronlanmamış bekleyen bir
      // talep) en azından adı gösterilir — kutu asla "Yükleniyor…"da takılı kalmaz.
      const rows = [['Firma', office ? office.name : officeKey]];
      if (office) {
        // cats üç biçimde gelebilir (JSON dizi / ' · ' ayrımlı string / null) — office-kind.js#
        // officeCatList'in tarayıcı tarafında yüklü olduğuna güvenmek yerine (bu dosya onu <script>
        // olarak İSTEMİYOR) burada AYNI iki durum yerinde ele alınır.
        const cats = Array.isArray(office.cats) ? office.cats.join(' · ') : (office.cats || '');
        if (office.loc) rows.push(['Konum', office.loc]);
        if (cats) rows.push(['Hizmet Alanı', cats]);
        if (office.yil) rows.push(['Kuruluş Yılı', String(office.yil)]);
      }
      // "Görevin": önce hesabın kendi pozisyonu, o boşsa mimar kaydındaki rol (fallback kaynağıyla
      // AYNI kayıttan gelir, bkz. yukarısı architectRole).
      if (accountUser && accountUser.position) rows.push(['Görevin', accountUser.position]);
      else if (architectRole) rows.push(['Görevin', architectRole]);
      const slug = office && office.slug ? office.slug : '';
      if (slug) { firmInfoSlug = slug; renderFirmEditBtn(); }
      // Firma satırında, firmanın rozeti varsa adının yanında gösterilir (kullanıcı isteği,
      // 2026-09-02 madde 4). Kaynak amPublicBadges — profilde FİİLEN görünen rozet haritası; satın
      // alınan ve admin tarafından verilen rozeti sunucuda zaten birleştirir, yani buradaki rozet
      // ile firma sayfasındaki rozet asla farklı olamaz (bkz. renderClaimsList'teki AYNI kaynak).
      // Yalnızca ONAYLI sahiplenmede gösterilir: bekleyen bir talepte firma henüz kullanıcının
      // değildir.
      const firmBadgeList = firmInfoApproved
        ? (amPublicBadges.office && amPublicBadges.office[officeKey])
        : null;
      const firmBadgeType = firmBadgeList && firmBadgeList.length ? firmBadgeList[0] : null;
      box.innerHTML = rows.map(([label, value], i) => `
        <div class="profile-fact">
          <span class="profile-fact-label">${escapeHtml(label)}</span>
          <span class="profile-fact-value">${i === 0 && slug
            ? `<a href="/firma/${encodeURIComponent(slug)}" style="color:var(--walnut); font-weight:600;">${escapeHtml(value)}</a>`
            : escapeHtml(value)}${i === 0 && firmBadgeType ? accountBadgeIconHtml(firmBadgeType) : ''}</span>
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
    //
    // gerçek bulgu (denetim, 2026-09-04, bkz. js/components/claim-correction-box.js#
    // renderProfileEditButton'daki AYNI düzeltme): burada accountUser.position (CANLI pozisyon)
    // okunuyordu, sunucu ise talebin ONAY ANINDA dondurulmuş office_position'ına bakıyor. Kullanıcı
    // pozisyonunu sonradan değiştirdiğinde ikisi ayrışıyor ve buton ya haksız yere gizleniyor
    // (gerçek sahip kendi firmasından kilitleniyor) ya da haksız yere gösteriliyordu (yukarıdaki
    // yorumun tam da önlemek istediği "boş yere doldurulan form, sonra 403" durumu).
    function renderFirmEditBtn() {
      const btn = document.getElementById('am-firm-edit-btn');
      if (!btn) return;
      const canEdit = !!firmInfoSlug && firmInfoApproved
        && OFFICE_EDIT_POSITIONS.has(firmInfoPosition);
      btn.style.display = canEdit ? '' : 'none';
      if (canEdit) btn.href = `${CLAIM_EDIT_PAGE.office}?claim=${encodeURIComponent(firmInfoSlug)}`;
    }

    async function syncClaimedArchitectData(items) {
      if (!accountUser) return;
      // fetchClaimedArchitect: loadFirmInfo ile PAYLAŞILAN tek istek (bkz. o fonksiyonun yanındaki
      // yorum) — ikisi de her loadUser()'da çalıştığından eskiden aynı uca iki istek gidiyordu.
      const arch = await fetchClaimedArchitect(items);
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
    // "Görüşme Detayı" popup (kullanıcı isteği, 2026-09-06, Aşama 4) — threadIdFromLink/
    // hotspotTagIdFromLink İLE AYNI kalıp. kisi.html gibi ConsultationModal'ı zaten yükleyen
    // sayfalar dışında (auth-modal.js site genelinde yüklendiğinden) consultation-detail-modal.js
    // HER sayfada statik <script> ile eklenmek yerine yalnızca ihtiyaç anında (bu bildirime
    // tıklanınca) tembel yüklenir.
    function consultationIdFromLink(link) {
      return link && link.startsWith('consultation:') ? link.slice('consultation:'.length) : null;
    }
    let consultationDetailModalLoad = null;
    function ensureConsultationDetailModalLoaded() {
      if (typeof ConsultationDetailModal !== 'undefined') return Promise.resolve();
      if (!consultationDetailModalLoad) {
        consultationDetailModalLoad = new Promise((resolve) => {
          const script = document.createElement('script');
          script.src = '/js/components/consultation-detail-modal.js';
          script.onload = () => resolve();
          document.head.appendChild(script);
        });
      }
      return consultationDetailModalLoad;
    }
    // ---------- BİLDİRİM AKSİYONLARI (kullanıcı isteği, 2026-09-06 madde 2) ----------
    // "Hesabım sayfasında bildirimler kutusuna gelen bildirimler aktif butonlar olsun. Bir bildirime
    // tıklayınca bildirim doğrultusunda bir aksiyon ekranı çıksın — örneğin bir proje gönderin
    // onaylandı yazıyorsa o proje gönderisi popup'ı, rozet talebin onaylandı yazıyorsa rozet al
    // sayfası açılsın."
    //
    // TASARIM: her bildirimin ne yapacağı TEK yerde (notifActionFor) kararlaştırılır ve iki yerde
    // kullanılır — satırın tıklama davranışı ve satırda "aç" okunun gösterilip gösterilmeyeceği.
    // Böylece kullanıcıya tıklanabilir görünen her satır GERÇEKTEN bir şey açar.
    //
    // Yollar iki sınıfa ayrılır:
    //   (a) Bu belgede AÇILABİLENLER — mesaj dizisi, görüşme detayı, işaretçi onayı, dizin daveti,
    //       Rozet Al, Profili Düzenle, Koleksiyonum: kullanıcı Hesabım'dan çıkmaz.
    //   (b) Kanonik varlık yolları (/proje/:slug, /kisi/:key, /firma/:key, /urun/:key) — o kaydın
    //       popup'ını açan modal script'i (project-modal.js vb.) çoğu sayfada YÜKLÜ DEĞİLDİR (bkz.
    //       js/components/lazy-modals.js dosya başı yorumu: bilinçli yükleme bütçesi kararı), bu
    //       yüzden doğru davranış o URL'e GİTMEKTİR — sunucu kaydın SSR gövdesini döner ve sayfanın
    //       kendi modalı popup'ı açar (sitedeki her iç bağlantının zaten yaptığı şey).
    const NOTIF_ENTITY_PATH_RE = /^\/(proje|kisi|firma|urun|marka)\/[^/?#]+/;
    function notifEntityPath(link) {
      return typeof link === 'string' && NOTIF_ENTITY_PATH_RE.test(link) ? link : null;
    }
    // Rozet bildirimlerinin tamamı "Rozet Al" ekranına gider: rozetin güncel durumu da, yenileme/
    // yeni talep yolu da orada. (badge_active ödeme onayından gelir, bkz. src/routes/payments.js.)
    const NOTIF_INFO_VIEW = { badge_approved: 'rozet-al', badge_rejected: 'rozet-al', badge_active: 'rozet-al' };
    // info-modal.js çoğu sayfada zaten <script> ile yüklü; değilse (ör. modal script'i taşımayan bir
    // sayfada Hesabım açıldıysa) consultation-detail-modal.js ile AYNI tembel yükleme deseni.
    let infoModalLoad = null;
    function ensureInfoModalLoaded() {
      if (typeof InfoModal !== 'undefined') return Promise.resolve();
      if (!infoModalLoad) {
        infoModalLoad = new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = '/js/components/info-modal.js';
          script.onload = () => resolve();
          // Yüklenemezse söz TEKRAR denenebilir kalmalı (bkz. lazy-modals.js#loadModule'daki AYNI
          // gerçek bulgu: onerror ele alınmazsa promise sonsuza kadar askıda kalıyordu).
          script.onerror = () => { script.remove(); infoModalLoad = null; reject(new Error('info-modal yüklenemedi')); };
          document.head.appendChild(script);
        });
      }
      return infoModalLoad;
    }
    // Bir bildirimin aksiyonu — yoksa null (satırda ok gösterilmez, tıklama yalnızca okundu işaretler).
    // Dönen nesne: { run, navigates } — navigates:true olan aksiyon belgeyi TERK ETTİĞİNDEN "okundu"
    // PATCH'i ondan ÖNCE gönderilmeli, aksi halde istek navigasyonla birlikte iptal edilir ve
    // bildirim okunmamış kalırdı.
    function notifActionFor(item) {
      const threadId = threadIdFromLink(item.link);
      if (threadId) return { run: () => openMessageThread(threadId) };
      const consultationId = consultationIdFromLink(item.link);
      if (consultationId) return { run: () => ensureConsultationDetailModalLoaded().then(() => ConsultationDetailModal.open(consultationId)) };
      const hotspotTagId = hotspotTagIdFromLink(item.link);
      if (hotspotTagId) return { run: () => openHotspotTagPrompt(hotspotTagId) };
      if (item.type === 'directory_invite' || (item.link || '').indexOf('dizin=1') !== -1) return { run: () => openDirectoryPrompt() };
      const infoView = NOTIF_INFO_VIEW[item.type];
      if (infoView) {
        return {
          run: () => ensureInfoModalLoaded()
            .then(() => InfoModal.open(infoView))
            .catch(() => { window.location.href = '/rozet-al'; }),
        };
      }
      // Profil sahiplenme kararı (onay/ret) — her iki durumda da yapılacak iş Profili Düzenle
      // ekranındadır: onaylanan profil oradan düzenlenir, reddedilen talepte başka bir kişi/firma
      // seçilir (bkz. submitFirmaClaimIfChanged).
      if (item.type === 'claim_approved' || item.type === 'claim_rejected') return { run: () => openAmProfileEditPopup() };
      if (item.type === 'board_invite') return { run: () => swap('collections') };
      // Reddedilen gönderi — public bir adresi yok; durumu ve "Düzenle" bağlantısı AYNI sayfadaki
      // "Eklediklerim" kutusunda, oraya kaydırılır.
      if (item.type === 'submission_rejected') {
        return {
          run: () => {
            const box = document.getElementById('am-dash-submissions');
            if (box) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
          },
        };
      }
      const entityPath = notifEntityPath(item.link);
      if (entityPath) return { navigates: true, run: () => { window.location.href = entityPath; } };
      return null;
    }
    const NOTIF_GO_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

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
      container.innerHTML = pageItems.map(n => {
        // Aksiyonu olan satır bir düğme gibi davranır (role/tabindex/ok ipucu); olmayan satır
        // yalnızca okunabilir bir kayıttır — bkz. notifActionFor.
        const hasAction = !!notifActionFor(n);
        return `
        <div class="notif-row${n.is_read ? '' : ' unread'}" data-id="${n.id}"${hasAction ? ' role="button" tabindex="0"' : ''}>
          <div class="notif-dot-col">${n.is_read ? '' : '<span class="notif-dot"></span>'}</div>
          <div style="flex:1; min-width:0;">
            <div class="notif-title">${escapeHtml(n.title)}</div>
            ${n.body ? `<div class="notif-body">${escapeHtml(n.body)}</div>` : ''}
            <div class="notif-meta">${new Date(n.created_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
          </div>
          ${hasAction ? `<span class="notif-go" aria-hidden="true">${NOTIF_GO_ICON}</span>` : ''}
          <button type="button" class="notif-del saved-remove-btn" data-id="${n.id}" aria-label="Bildirimi sil">✕</button>
        </div>`;
      }).join('');
      container.querySelectorAll('.notif-row').forEach(row => {
        // Enter/Space, role="button" taşıyan satırda tıklamayla AYNI işi yapmalı (klavye erişimi).
        row.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          row.click();
        });
        row.addEventListener('click', () => {
          const item = items.find(n => String(n.id) === row.dataset.id);
          if (!item) return;
          // GERÇEK BULGU (kullanıcı bildirimi, 2026-09-06): "okundu" işareti (turuncudan beyaza)
          // eskiden İLK tıklamada, herhangi bir detay ekranı açılmadan ÖNCE uygulanıyordu — bu
          // yüzden bir bildirime tıklamak hiçbir şey açmıyormuş gibi görünüyordu (satır zaten
          // beyaza dönmüştü). markRead() aksiyon TETİKLENDİKTEN sonra çağrılır; açılacak bir ekranı
          // olmayan türlerde (bkz. notifActionFor'un null dönüşü) satır yine de okundu sayılır.
          function markRead() {
            if (item.is_read) return;
            row.classList.remove('unread');
            const dot = row.querySelector('.notif-dot');
            if (dot) dot.remove();
            item.is_read = true;
            fetch(`/api/notifications/${encodeURIComponent(row.dataset.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_read: true }) }).catch(() => {});
          }
          // Tek karar noktası (bkz. notifActionFor) — satırdaki "aç" oku da AYNI fonksiyondan
          // türetildiğinden, ok gösterilen her satır gerçekten bir ekran açar.
          const action = notifActionFor(item);
          if (action && action.navigates) { markRead(); action.run(); return; }
          if (action) action.run();
          markRead();
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

      // Kullanıcı isteği (2026-09-03): mesaj kutusu EN SON mesajı göstererek açılsın. .am-thread-messages
      // max-height:340px + overflow-y:auto olduğundan uzun bir konuşmada varsayılan scroll konumu en
      // ÜSTdü — yani kutu, kullanıcının okumak istediği son mesaj yerine aylar önceki ilk mesajı
      // gösteriyordu. renderThreadBody hem ilk açılışta hem her cevaptan sonra çağrıldığından tek nokta
      // yeterli: cevap gönderildiğinde de yeni mesaj görünür kalır.
      const messagesEl = bodyEl.querySelector('.am-thread-messages');
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;

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

    // ---------------------------------------------------------------------------------------
    // İSTATİSTİKLER (kullanıcı isteği, 2026-09-04) — Hesabım > İstatistikler bölümü.
    //
    // YETKİ: bölüm yalnızca /api/analytics/summary 200 dönerse açılır. 401/403'te (giriş yok ya da
    // rozet yok) kutu display:none kalır — yani "rozetli mi?" sorusunun cevabı TAMAMEN sunucudan
    // gelir, istemcide ayrı bir rozet kontrolü kopyalanmaz (bkz. src/lib/analyticsAccess.js
    // #hasAnalyticsAccess). Bu, PDF dışa aktarımındaki fetchBadgeAccess deseninden bilinçli olarak
    // daha katı: orada UI zaten görünüyordu ve yalnızca eylem engelleniyordu, burada VERİNİN
    // KENDİSİ gizli olduğundan uç noktanın cevabı tek gerçek kaynaktır.
    //
    // VERİ: hiçbir metrik tahmin/mock değil (bkz. kullanıcı isteği) — görüntülenme ve arama
    // gösterimi analytics_daily sayaçlarından, kaydetme/takip/mesaj metrikleri ise zaten var olan
    // saved_items/follows/messages tablolarından gelir.
    let statsRange = '30d';
    let statsSeq = 0;
    async function loadStats() {
      const row = document.getElementById('am-stats-row');
      const body = document.getElementById('am-stats-body');
      if (!row || !body) return;
      const mySeq = ++statsSeq;
      body.innerHTML = '<div class="dash-empty">Yükleniyor…</div>';
      let data = null;
      try {
        const res = await fetch('/api/analytics/summary?range=' + encodeURIComponent(statsRange));
        if (res.ok) data = await res.json();
        else { row.style.display = 'none'; return; } // 401/403: rozetsiz — bölüm hiç görünmez
      } catch { row.style.display = 'none'; return; }
      if (mySeq !== statsSeq) return; // daha yeni bir dönem seçimi zaten başladı
      row.style.display = '';
      renderStats(data);
    }

    function statCard(value, label) {
      return `<div class="stat-card"><div class="stat-card-value">${escapeHtml(formatStatNumber(value))}</div><div class="stat-card-label">${escapeHtml(label)}</div></div>`;
    }
    function formatStatNumber(n) {
      if (n === null || n === undefined) return '—';
      return Number(n).toLocaleString('tr-TR');
    }
    function statBars(rows) {
      const list = (rows || []).slice(0, 6);
      if (!list.length) return '<div class="stat-note">Bu dönemde veri yok.</div>';
      const max = Math.max(...list.map(r => r.count), 1);
      return list.map(r => `<div class="stat-bar-row">
        <span class="stat-bar-name" title="${escapeAttr(r.label)}">${escapeHtml(r.label)}</span>
        <span class="stat-bar-track"><span class="stat-bar-fill" style="width:${Math.round((r.count / max) * 100)}%"></span></span>
        <span class="stat-list-count">${escapeHtml(formatStatNumber(r.count))}</span>
      </div>`).join('');
    }
    function statTopList(items, emptyText) {
      if (!items || !items.length) return `<div class="stat-note">${escapeHtml(emptyText)}</div>`;
      const KIND = { project: 'Proje', product: 'Ürün' };
      return `<ul class="stat-list">${items.map(it => `<li>
        <a class="stat-list-name" href="/${it.type === 'product' ? 'urun' : 'proje'}/${encodeURIComponent(it.key)}" title="${escapeAttr(it.title)}">${escapeHtml(it.title)}</a>
        <span class="stat-list-kind">${escapeHtml(KIND[it.type] || '')}</span>
        <span class="stat-list-count">${escapeHtml(formatStatNumber(it.count))}</span>
      </li>`).join('')}</ul>`;
    }
    // Sade trend grafiği (kullanıcı isteği: "sade trend grafikleri") — bağımlılıksız inline SVG.
    // CSP dış script'leri engellediğinden (bkz. auth-modal.js#PDF dışa aktarımındaki AYNI gerekçe)
    // bir grafik kütüphanesi zaten kullanılamazdı. İki seri: profil ve içerik görüntülenmeleri.
    function statChart(trend) {
      const rows = trend || [];
      if (rows.length < 2) return '<div class="stat-note">Trend grafiği için en az iki günlük veri gerekiyor.</div>';
      const W = 680, H = 140, PAD = 6;
      const max = Math.max(1, ...rows.map(r => Math.max(r.profileViews, r.contentViews)));
      const x = i => PAD + (i * (W - PAD * 2)) / Math.max(1, rows.length - 1);
      const y = v => H - PAD - (v / max) * (H - PAD * 2);
      const path = key => rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r[key]).toFixed(1)}`).join(' ');
      return `<div class="stat-chart">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Görüntülenme trendi">
          <path d="${path('profileViews')}" fill="none" stroke="var(--walnut)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
          <path d="${path('contentViews')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        </svg>
        <div class="stat-legend">
          <span><i style="background:var(--walnut)"></i>Profil görüntülenmeleri</span>
          <span><i style="background:var(--accent)"></i>İçerik görüntülenmeleri</span>
          <span>${escapeHtml(rows[0].bucket)} → ${escapeHtml(rows[rows.length - 1].bucket)}</span>
        </div>
      </div>`;
    }

    function renderStats(d) {
      const body = document.getElementById('am-stats-body');
      const p = d.profile || {}, c = d.content || {}, m = d.messages || {};
      const rate = m.profileToMessageRate === null || m.profileToMessageRate === undefined
        ? '—' : String(m.profileToMessageRate).replace('.', ',') + '%';
      body.innerHTML = `
        <div class="stat-group">
          <h3 class="stat-group-title">Profil</h3>
          <div class="stat-grid">
            ${statCard(p.views, 'Profil görüntülenmeleri')}
            ${statCard(p.searchImpressions, 'Arama gösterimleri')}
            ${statCard(p.saves, 'Profil kaydetmeleri')}
            ${statCard(p.newFollowers, 'Yeni takipçiler')}
          </div>
        </div>
        <div class="stat-group">
          <h3 class="stat-group-title">İçerik</h3>
          <div class="stat-grid">
            ${statCard(c.projectViews, 'Proje görüntülenmeleri')}
            ${statCard(c.productViews, 'Ürün görüntülenmeleri')}
            ${statCard(c.projectSaves, 'Proje kaydetmeleri')}
            ${statCard(c.productSaves, 'Ürün kaydetmeleri')}
          </div>
          <div class="stat-two" style="margin-top:14px;">
            <div>
              <h3 class="stat-group-title">En çok görüntülenen</h3>
              ${statTopList(c.topViewed, 'Bu dönemde görüntülenme kaydı yok.')}
            </div>
            <div>
              <h3 class="stat-group-title">En çok kaydedilen</h3>
              ${statTopList(c.topSaved, 'Bu dönemde kaydetme yok.')}
            </div>
          </div>
        </div>
        <div class="stat-group">
          <h3 class="stat-group-title">İletişim</h3>
          <div class="stat-grid">
            ${statCard(m.received, 'Alınan mesajlar')}
            ${statCard(m.uniqueSenders, 'Benzersiz gönderenler')}
            <div class="stat-card"><div class="stat-card-value">${escapeHtml(rate)}</div><div class="stat-card-label">Profil → Mesaj dönüşümü</div></div>
          </div>
          <div class="stat-two" style="margin-top:14px;">
            <div>
              <h3 class="stat-group-title">Gönderenlerin meslek grubu</h3>
              ${statBars(m.professions)}
            </div>
            <div>
              <h3 class="stat-group-title">Gönderenlerin kurum türü</h3>
              ${statBars(m.orgTypes)}
            </div>
          </div>
        </div>
        <div class="stat-group">
          <h3 class="stat-group-title">Trend</h3>
          ${statChart(d.trend)}
        </div>
        <div class="stat-note">
          ${d.hasOwnedContent ? '' : 'Henüz sana bağlı bir profil ya da içerik yok; sahiplenme onaylandığında burada dolmaya başlar. '}
          Görüntülenme ve arama gösterimi sayaçları ${d.viewTrackingSince ? escapeHtml(d.viewTrackingSince) + ' tarihinden' : 'özellik açıldığından'} itibaren toplanıyor — daha eski dönemler için bu iki metrik sıfır görünür. Kaydetme, takip ve mesaj sayıları geçmişi de kapsar.
        </div>`;
    }

    loadUser().then(() => {
      if (accountUser) {
        [loadBadges(), loadMyClaims(), loadPublicBadgesForClaims(), loadNotifications(), loadMessages(), loadStats()]
          .forEach(p => p.catch(() => {}));
        const rangeWrap = document.getElementById('am-stats-range');
        if (rangeWrap && !rangeWrap.dataset.wired) {
          rangeWrap.dataset.wired = '1';
          rangeWrap.addEventListener('click', (e) => {
            const btn = e.target.closest('.stat-range-btn');
            if (!btn) return;
            statsRange = btn.dataset.range;
            rangeWrap.querySelectorAll('.stat-range-btn').forEach(b => b.classList.toggle('active', b === btn));
            loadStats();
          });
        }
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

    // Eklediklerim — eski contentsTemplate/İçeriklerim popup'ının mountContents() fonksiyonundan
    // AYNEN taşındı (kullanıcı isteği, 2026-09-05: İçeriklerim sayfası kaldırıldı).
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

    fetch('/api/auth/me').then(r => {
      if (!r.ok) { swap('login'); return; }
      [loadRated(), loadComments(), loadShares(), loadSubmissions()].forEach(p => p.catch(() => {}));
    }).catch(() => {});
  }

  // Koleksiyonum'un mount fonksiyonu — mountActivities() ile AYNI iskelet (wired Set'i + on() yardımcısı
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

    // ---------- Serbest Tuval / Moodboard (kullanıcı isteği, 2026-09-05 madde 1) ----------
    // .col-item-grid'in yerini position:relative bir tuval + position:absolute öğeler aldı.
    // Sürükleme/boyutlandırma js/components/image-crop.js#injectStyles'daki Pointer Events +
    // setPointerCapture + köşe-çapa yeniden boyutlandırma deseninin AYNISI (bkz. proje araştırması) —
    // tek fark burada aynı zamanda "tıklama mı sürükleme mi" ayrımı da gerekiyor (öğeler linke/
      // lightbox'a tıklanabilir OLMALI), o kısım auth-modal.js'in KENDİ galeri sürükle-bırak sıralama
    // koduyla (yukarıdaki uzun-basma + dragJustFinished deseni) AYNI mantıkla çözülür.
    const DRAG_MOVE_THRESHOLD_PX = 4;
    let canvasMaxZ = 0;
    // A4 pafta baseline piksel boyutları @96dpi (kullanıcı isteği, 2026-09-06 madde 1) — öğe/çizim
    // yüzdeleri bu boyutlara göredir; pan/zoom yalnızca CSS transform, boyutlar SABİT kalır.
    const CANVAS_PAGE_SIZES = { landscape: { w: 1123, h: 794 }, portrait: { w: 794, h: 1123 } };
    const ZOOM_MIN = 0.25, ZOOM_MAX = 3;
    const STANDARD_PEN_COLORS = ['#1B2A3D', '#B84C4C', '#3E7A55', '#E0A63E', '#2D6CDF', '#8A4FDE', '#000000', '#FFFFFF'];
    let zoomScale = 1, panX = 0, panY = 0;
    let canvasInitialized = false; // pano her açıldığında bir kez sığdırılır, sonraki yeniden çizimlerde zoom/pan KORUNUR
    let penActive = false, penColor = STANDARD_PEN_COLORS[0], penWidth = 3;
    let lastPaletteHexes = [];
    let styleTargetItemId = null;
    // "Not Ekle" akışının ön-seçili stili (kullanıcı isteği madde 2: önce stil, sonra metin).
    let newNoteColor = STANDARD_PEN_COLORS[0], newNoteSize = 14, newNoteBold = false;
    // Liste/Izgara görünüm anahtarı (kullanıcı isteği madde 1) — 'grid' | 'list'. Varsayılan
    // artık 'list' (kullanıcı isteği, 2026-09-06) — bkz. openDetail'deki AYNI atama.
    let boardViewMode = 'list';
    // Tam sayfa görünüm açık mı (kullanıcı isteği, 2026-09-06 madde 2) — bkz. am-col-fullscreen-toggle.
    let boardFullscreen = false;

    function canEdit() {
      return openCollection && openCollection.item.role !== 'viewer';
    }
    function isOwner() {
      return openCollection && openCollection.item.role === 'owner';
    }

    // Eski panolarda (ya da yeni eklenen bir öğede) pos_x === -1 ise hiç konumlandırılmamış demektir
    // (bkz. migrations/0094_board_canvas_and_sharing.sql). Basit bir ızgaraya yerleştirilip HEMEN
    // sunucuya kaydedilir — böylece bir dahaki açılışta aynı otomatik yerleşim tekrar hesaplanmaz ve
    // kullanıcı sürüklediği bir öğenin "geri sıçradığını" görmez.
    function autoArrangeIfNeeded() {
      if (!openCollection) return;
      const items = openCollection.items;
      const unplaced = items.filter(it => it.x < 0 || it.y < 0);
      if (!unplaced.length) return;
      const cols = 4;
      const cellW = 100 / cols;
      const cellH = 26;
      const gap = 2;
      const startIndex = items.length - unplaced.length;
      unplaced.forEach((it, i) => {
        const idx = startIndex + i;
        it.x = (idx % cols) * cellW + gap / 2;
        it.y = Math.floor(idx / cols) * cellH + gap / 2;
        it.width = cellW - gap;
        it.height = cellH - gap;
        it.zIndex = idx;
      });
      if (canEdit()) persistLayout(unplaced);
    }

    async function persistLayout(items) {
      if (!openCollection || !items.length) return;
      try {
        await fetch(`/api/collections/${encodeURIComponent(openCollection.item.id)}/items`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ layout: items.map(it => ({ id: it.id, x: it.x, y: it.y, width: it.width, height: it.height, zIndex: it.zIndex })) }),
        });
      } catch { /* konum kaydı best-effort — ağ hatasında öğe ekranda olduğu yerde kalır, bir sonraki render'da sunucudaki son bilinen konumdan devam eder */ }
    }

    // ---------- Pan & Zoom (kullanıcı isteği madde 1) ----------
    // Pafta SABİT piksel boyutlu (CANVAS_PAGE_SIZES) — pan/zoom yalnızca bu paftanın kendi
    // transform'unu değiştirir, öğe yüzdeleri hiç etkilenmez (bkz. wireCanvasInteractions'ın
    // getBoundingClientRect'e dayalı matematiği zoom'dan bağımsız kalır).
    // ---------- Dinamik Izgara / Snap-to-Grid (kullanıcı isteği madde 4) ----------
    // Hücre boyutu paftanın KENDİ (transform'dan ÖNCEki, baseline) piksel uzayında tanımlanır — pafta
    // zaten transform:scale ile büyütülüp küçültüldüğünden (bkz. dosya başı yorumu), aynı EKRAN
    // boyutunun zoom arttıkça paftanın DAHA KÜÇÜK bir kesrini (dolayısıyla daha SIK bir alt ızgarayı)
    // temsil etmesi için hücre kademeli olarak küçültülür (zoom azaldıkça büyütülür). Snap hesabı da
    // AYNI kademeleri kullanır ki görünen ızgara ile kenetlenme noktaları her zaman örtüşsün.
    function currentGridCellPx() {
      if (zoomScale <= 0.65) return 48;
      if (zoomScale <= 1.3) return 24;
      if (zoomScale <= 2.2) return 12;
      return 6;
    }
    function snapToGridPct(valuePct, dimPx) {
      const cellPct = (currentGridCellPx() / dimPx) * 100;
      if (!Number.isFinite(cellPct) || cellPct <= 0) return valuePct;
      return Math.round(valuePct / cellPct) * cellPct;
    }
    function applyCanvasTransform() {
      const page = document.getElementById('am-col-canvas');
      if (!page) return;
      page.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
      const cell = currentGridCellPx();
      page.style.backgroundSize = `${cell}px ${cell}px`;
      const label = document.getElementById('am-col-zoom-label');
      if (label) label.textContent = Math.round(zoomScale * 100) + '%';
    }
    function fitCanvasToViewport() {
      const viewport = document.getElementById('am-col-canvas-viewport');
      const page = document.getElementById('am-col-canvas');
      if (!viewport || !page || !openCollection) return;
      const dims = CANVAS_PAGE_SIZES[openCollection.item.canvasOrientation] || CANVAS_PAGE_SIZES.landscape;
      const availW = Math.max(100, viewport.clientWidth - 24);
      const availH = Math.max(100, viewport.clientHeight - 24);
      zoomScale = Math.max(ZOOM_MIN, Math.min(availW / dims.w, availH / dims.h, 1));
      panX = Math.max(0, (viewport.clientWidth - dims.w * zoomScale) / 2);
      panY = Math.max(0, (viewport.clientHeight - dims.h * zoomScale) / 2);
      applyCanvasTransform();
    }

    // Bir kalem izinin yüzde noktalarını (0-100) paftanın baseline piksel uzayına çevirip SVG "d"
    // yol dizgesi üretir — SVG viewBox paftayla AYNI en-boy oranını taşıdığından (bkz. renderDetail)
    // bu dönüşüm bozulmasız/eşit ölçeklidir (image-hotspots.js#ratio gerekçesiyle AYNI mantık).
    function strokePathD(points, dims) {
      if (!points || points.length < 2) return '';
      return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(p[0] / 100 * dims.w).toFixed(1)},${(p[1] / 100 * dims.h).toFixed(1)}`).join(' ');
    }

    // Çizim aracı VE not stil paneli AYNI renk kaynağını paylaşır (kullanıcı isteği madde 3: "Bu
    // renkler çizim aracında ve metin rengi seçiminde doğrudan kullanılabilmelidir") — standart 8
    // renk + panodan çıkarılan son palet, tekilleştirilip iki ayrı DOM konteynerine (kalem araç
    // çubuğu + not stil paneli) aynı anda basılır.
    function renderAuxSwatches() {
      const combined = [...STANDARD_PEN_COLORS];
      for (const hex of lastPaletteHexes) if (!combined.includes(hex)) combined.push(hex);
      const html = combined.map(hex => `<button type="button" class="col-canvas-pen-swatch" data-hex="${escapeAttr(hex)}" style="background:${escapeAttr(hex)};" title="${escapeAttr(hex)}"></button>`).join('');
      const penEl = document.getElementById('am-col-pen-swatches');
      if (penEl) penEl.innerHTML = html;
      const noteEl = document.getElementById('am-col-note-style-swatches');
      if (noteEl) noteEl.innerHTML = html;
      // "Not Ekle" akışının ÖN stil seçici paleti (kullanıcı isteği madde 2) — AYNI kaynak, ÜÇÜNCÜ
      // bir DOM konteynerine basılır (bkz. dosya başı yorumu: pen/not-düzenle ile aynı renkler).
      const newNoteEl = document.getElementById('am-col-new-note-swatches');
      if (newNoteEl) newNoteEl.innerHTML = html;
    }

    function setPenActive(active) {
      penActive = active;
      const page = document.getElementById('am-col-canvas');
      const viewport = document.getElementById('am-col-canvas-viewport');
      if (page) page.classList.toggle('pen-active', active);
      if (viewport) viewport.classList.toggle('pen-active', active);
      const toggleBtn = document.getElementById('am-col-pen-toggle');
      if (toggleBtn) toggleBtn.classList.toggle('active', active);
      const options = document.getElementById('am-col-pen-options');
      if (options) options.style.display = active ? 'inline-flex' : 'none';
    }

    // ---------- Not stili (kullanıcı isteği madde 2) ----------
    function openNoteStylePanel(itemId) {
      if (!openCollection) return;
      const item = openCollection.items.find(it => it.id === itemId);
      if (!item) return;
      styleTargetItemId = itemId;
      document.getElementById('am-col-note-style-size').value = item.fontSize || 14;
      document.getElementById('am-col-note-style-bold').checked = item.fontWeight === 'bold';
      document.getElementById('am-col-note-style-color-custom').value = item.textColor || '#1B2A3D';
      document.getElementById('am-col-palette-panel').style.display = 'none';
      document.getElementById('am-col-note-style-panel').style.display = '';
    }
    function applyNoteStyleField(field, value) {
      if (!styleTargetItemId || !openCollection) return;
      const item = openCollection.items.find(it => it.id === styleTargetItemId);
      if (!item) return;
      item[field] = value;
      renderDetail();
      fetch(`/api/collections/${encodeURIComponent(openCollection.item.id)}/items/${encodeURIComponent(styleTargetItemId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: value }),
      }).catch(() => {});
    }

    // Bir görselden baskın renkleri çıkarır (kullanıcı isteği madde 2). Sunucu/kütüphane YOK — CSP
    // dış script'leri engellediğinden (bkz. exportBoardPdf'teki AYNI gerekçe) küçük bir <canvas>'a
    // çizip piksel verisini örnekleyen saf JS histogram/kova (bucket) yöntemi kullanılır. Görseller
    // AYNI origin'den geldiğinden (image-cdn/R2) canvas "tainted" olmaz.
    function extractDominantColors(img, k) {
      try {
        const c = document.createElement('canvas');
        const size = 32;
        c.width = size; c.height = size;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        const buckets = new Map();
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 128) continue;
          // 32'lik kovalara yuvarla — tam piksel bazında saymak neredeyse hiç tekrar etmeyen binlerce
          // "ayrı renk" üretirdi, kovalar benzer tonları tek bir baskın renkte birleştirir.
          const r = Math.round(data[i] / 32) * 32;
          const g = Math.round(data[i + 1] / 32) * 32;
          const b = Math.round(data[i + 2] / 32) * 32;
          const key = `${r},${g},${b}`;
          buckets.set(key, (buckets.get(key) || 0) + 1);
        }
        return [...buckets.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, k)
          .map(([key]) => {
            const [r, g, b] = key.split(',').map(Number);
            return '#' + [r, g, b].map(v => Math.min(255, v).toString(16).padStart(2, '0')).join('');
          });
      } catch { return []; }
    }

    function renderPalette(hexList) {
      lastPaletteHexes = hexList;
      renderAuxSwatches();
      const el = document.getElementById('am-col-palette-swatches');
      if (!el) return;
      if (!hexList.length) {
        el.innerHTML = '<div class="dash-empty" style="font-size:11.5px;">Panoya görsel ekleyince renkler burada listelenir.</div>';
        return;
      }
      el.innerHTML = hexList.map(hex => `
        <button type="button" class="col-palette-swatch" data-hex="${escapeAttr(hex)}" title="${escapeAttr(hex)}">
          <span class="col-palette-swatch-chip" style="background:${escapeAttr(hex)};"></span>
          <span class="col-palette-swatch-hex">${escapeAttr(hex)}</span>
        </button>`).join('');
    }

    // Panodaki tüm görsellerden toplanan renkler tek bir kartelada birleştirilir. Görseller lazy
    // yüklendiğinden (loading="lazy") her <img> için complete/onload ayrımı yapılır.
    function computePalette() {
      const container = document.getElementById('am-col-items');
      if (!container) return;
      const imgs = Array.from(container.querySelectorAll('.canvas-item-media'));
      if (!imgs.length) { renderPalette([]); return; }
      const perImage = new Map();
      function recompute() {
        const counts = new Map();
        for (const list of perImage.values()) {
          for (const hex of list) counts.set(hex, (counts.get(hex) || 0) + 1);
        }
        renderPalette([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([hex]) => hex));
      }
      // gerçek bulgu (yerel testte yakalandı): yalnızca 'load' dinlendiğinde, TÜM görseller 404/
      // yüklenemez olursa recompute() hiç çağrılmıyor, dolayısıyla renderPalette (ve onun içindeki
      // renderAuxSwatches — kalem/not stil panelindeki STANDART renkler) hiç basılmıyordu. 'error'
      // durumunda da boş bir liste ile recompute() çağrılır ki standart 8 renk her koşulda görünsün.
      imgs.forEach(img => {
        const run = () => { perImage.set(img, extractDominantColors(img, 3)); recompute(); };
        const fail = () => { perImage.set(img, []); recompute(); };
        if (img.complete && img.naturalWidth) run();
        else if (img.complete) fail();
        else { img.addEventListener('load', run, { once: true }); img.addEventListener('error', fail, { once: true }); }
      });
    }

    function renderDetail() {
      if (!openCollection) return;
      document.getElementById('am-col-detail-title-text').textContent = openCollection.item.title;
      document.getElementById('am-col-detail-count').textContent = `${openCollection.items.length} öğe${openCollection.item.role !== 'owner' ? ` · ${openCollection.item.role === 'editor' ? 'Editör' : 'Görüntüleyici'} olarak erişiyorsun` : ''}`;
      // Paylaşım durumu — sunucu shapeCollection'da shareToken döner (bkz. src/routes/collections.js).
      const publicLinkBtn = document.getElementById('am-col-public-link-btn');
      if (publicLinkBtn) publicLinkBtn.textContent = openCollection.item.shareToken ? 'Paylaşımı Durdur' : 'Paylaş';
      // Paylaş/Panoyu Sil YALNIZCA sahipte; öğe ekleme SAHİP+EDİTÖR'de; görüntüleyicide hiçbiri.
      const shareBtn = document.getElementById('am-col-share-btn');
      if (shareBtn) shareBtn.style.display = isOwner() ? '' : 'none';
      const deleteBtn = document.getElementById('am-col-delete-btn');
      if (deleteBtn) deleteBtn.style.display = isOwner() ? '' : 'none';
      document.querySelectorAll('#am-col-detail-view [data-col-add]').forEach(btn => { btn.style.display = canEdit() ? '' : 'none'; });
      // Görüntüleyicide "+ Ekle" tetikleyicisinin kendisi de gizlenir — aksi halde menü açıldığında
      // içindeki dört seçenek de gizli olduğundan bomboş bir açılır pencere görünürdü.
      const addMenuWrap = document.getElementById('am-col-add-menu-wrap');
      if (addMenuWrap) addMenuWrap.style.display = canEdit() ? '' : 'none';
      const penToggleBtn = document.getElementById('am-col-pen-toggle');
      if (penToggleBtn) penToggleBtn.style.display = canEdit() ? '' : 'none';
      document.querySelectorAll('.col-canvas-tbtn[data-orientation]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.orientation === openCollection.item.canvasOrientation);
      });
      // NOT: Dışa Aktar'ın rozet kontrolü BİLEREK burada YAPILMAZ. renderDetail(), loadBadges()
      // tamamlanmadan ÖNCE de çalışabiliyor (ikisi bağımsız/paralel yükleniyor, bkz. amBadgeItems
      // yorumu) — burada hesaplanan bir "rozetin yok" durumu, rozet verisi sonradan gelse bile
      // butonda donup kalıyordu. Kontrol artık tıklama anında yapılıyor (bkz. am-col-export-btn).
      autoArrangeIfNeeded();
      // canvasMaxZ artık ÖĞELER VE ÇİZİMLER birlikte hesaplanır (kullanıcı isteği: vektörel çizim
      // objeleri diğer öğelerle AYNI z-index hiyerarşisini paylaşır, bkz. migrations/0097).
      canvasMaxZ = Math.max(0, ...openCollection.items.map(it => it.zIndex || 0), ...(openCollection.strokes || []).map(s => s.zIndex || 0));
      const readonly = !canEdit();
      const dims = CANVAS_PAGE_SIZES[openCollection.item.canvasOrientation] || CANVAS_PAGE_SIZES.landscape;
      const strokes = openCollection.strokes || [];

      const emptyHint = openCollection.items.length
        ? ''
        : '<div class="dash-empty" style="position:absolute; inset:24px; display:flex; align-items:center; justify-content:center; pointer-events:none; text-align:center;">Bu pano henüz boş.<br>Yukarıdaki butonlarla kaydettiğin içerikleri, kendi görsellerini ya da notlarını ekleyebilir, Çizim aracıyla eskiz yapabilirsin.</div>';

      const itemsHtml = openCollection.items.map((it) => {
        const image = safeUrl(it.image);
        const href = safeUrl(it.href);
        const noteStyle = `color:${escapeAttr(it.textColor || 'var(--ink)')}; font-size:${it.fontSize || 14}px; font-weight:${it.fontWeight || 'normal'};`;
        const media = image
          // loading="lazy" BİLEREK YOK (gerçek bulgu, yerel testte yakalandı): ölçeklenmiş/transform
          // uygulanmış bir atanın (bkz. .col-canvas'ın pan/zoom transform'u) içindeki lazy görsellerde
          // tarayıcı intersection hesaplaması güvenilir çalışmıyor, görsel SÜRESİZ yüklenmeden
          // kalabiliyor — bu da hem WYSIWYG dışa aktarımı hem renk paletini kırar. Tuval zaten sınırlı/
          // küçük bir görünüm alanı olduğundan eager yükleme burada maliyetsiz.
          ? `<img class="canvas-item-media" src="${escapeAttr(avatarImg(image, 400, image))}" data-lightbox-src="${escapeAttr(image)}" data-lightbox-alt="${escapeAttr(it.title || '')}" alt="" decoding="async">`
          : (it.kind === 'note' ? `<div class="canvas-item-note" style="${noteStyle}">${escapeHtml(it.note)}</div>` : '');
        const titleText = it.title || '';
        const body = (image && titleText) ? `<div class="canvas-item-body"><div class="canvas-item-title">${escapeHtml(titleText)}</div></div>` : '';
        const openLink = (href && image) ? `<a class="canvas-item-open" href="${escapeAttr(href)}" aria-label="Aç" title="${escapeAttr(titleText)}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg></a>` : '';
        // "Kalem" (düzenle) ikonu — yalnızca notlarda, silme butonunun yanında (kullanıcı isteği madde 2).
        const editBtn = (!readonly && it.kind === 'note') ? `<button type="button" class="canvas-item-edit" aria-label="Not stilini düzenle" data-style-target="${escapeAttr(it.id)}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>` : '';
        const removeBtn = readonly ? '' : `<button type="button" class="canvas-item-remove" aria-label="Kaldır">✕</button>`;
        const handles = readonly ? '' : ['nw', 'ne', 'sw', 'se'].map(c => `<span class="canvas-item-handle ${c}" data-handle="${c}"></span>`).join('');
        const style = `left:${it.x}%; top:${it.y}%; width:${it.width}%; height:${it.height}%; z-index:${it.zIndex || 0};`;
        return `
        <div class="canvas-item${readonly ? ' readonly' : ''}${it.kind === 'note' ? ' canvas-item-note-host' : ''}" data-item-id="${escapeAttr(it.id)}" data-href="${escapeAttr(href || '')}" data-image="${image ? '1' : ''}" style="${style}">
          ${media}${body}${openLink}${editBtn}${removeBtn}${handles}
        </div>`;
      }).join('');

      // Vektörel Çizim Objeleri (kullanıcı isteği) — her çizim ARTIK kendi bağımsız, tam sayfa
      // kaplayan SVG sarmalayıcısında (.canvas-stroke-obj), diğer .canvas-item'larla AYNI seviyede
      // ve AYNI sayısal z-index uzayında render edilir — eskiden TEK bir üstteki SVG katmanıydı
      // (bkz. migrations/0095), artık Öne Getir/Arkaya Gönder ile öğelerin ARASINA girebiliyor.
      // Sarmalayıcının pointer-events:none olması gerekir (aksi halde iz ÇİZİLMEYEN her piksel de
      // tıklamaları yutardı) — yalnızca path'in KENDİSİ (stroke-events) tıklanabilir/sürüklenebilir.
      const strokesHtml = strokes.map(s => `
        <svg class="canvas-stroke-obj" data-stroke-id="${escapeAttr(s.id)}" viewBox="0 0 ${dims.w} ${dims.h}" preserveAspectRatio="none" style="z-index:${s.zIndex || 0};">
          <path d="${strokePathD(s.points, dims)}" stroke="${escapeAttr(s.color)}" stroke-width="${s.strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:${readonly ? 'none' : 'stroke'}; cursor:${readonly ? 'default' : 'move'};"/>
        </svg>`).join('');

      const container = document.getElementById('am-col-items');
      container.innerHTML = `<div class="col-canvas" id="am-col-canvas" style="width:${dims.w}px; height:${dims.h}px;">
        ${itemsHtml}${emptyHint}${strokesHtml}
      </div>`;
      const pageEl = document.getElementById('am-col-canvas');
      if (penActive) pageEl.classList.add('pen-active');
      wireCanvasInteractions(pageEl);
      wireStrokeInteractions(pageEl);
      wirePenAndPan(document.getElementById('am-col-canvas-viewport'), pageEl);
      if (!canvasInitialized) { fitCanvasToViewport(); canvasInitialized = true; } else { applyCanvasTransform(); }
      computePalette();

      // ---------- Liste/Izgara görünüm senkronizasyonu (kullanıcı isteği madde 1) ----------
      // Liste görünümü AYRI bir DOM ağacında, yukarıdaki tuval her zaman (görünmese bile) yeniden
      // çizilir — böylece "Izgara"ya geri dönüldüğünde konum/zoom/kalem durumu KORUNUR, iki görünüm
      // arasında ekstra bir state-senkronizasyon mekanizması İCAT ETMEYE gerek kalmaz: ikisi de AYNI
      // openCollection.items dizisinden okur. Kalem çizimleri (strokes) YAPISI GEREĞİ yalnızca tuval
      // ağacında var — liste bunlardan hiç haberdar değildir (kullanıcı isteği istisna kuralı).
      renderItemsListMode();
      document.querySelectorAll('#am-col-view-toggle button[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === boardViewMode));
      const canvasWrapEl = document.querySelector('.col-canvas-wrap');
      const canvasToolbarEl = document.querySelector('.col-canvas-toolbar');
      const listWrapEl = document.getElementById('am-col-list-mode');
      if (canvasWrapEl) canvasWrapEl.style.display = boardViewMode === 'list' ? 'none' : '';
      if (canvasToolbarEl) canvasToolbarEl.style.display = boardViewMode === 'list' ? 'none' : '';
      if (listWrapEl) listWrapEl.style.display = boardViewMode === 'list' ? '' : 'none';
    }

    // ---------- Liste Modu (kullanıcı isteği madde 1) ----------
    // Öğeler satır satır, yukarı/aşağı butonlarıyla yeniden sıralanabilir (kullanıcı isteği,
    // 2026-09-06: sürükleyerek sıralamak yerine buton — trackpad/dokunmatikte sürükleme tutarsız
    // kalıyordu). Yalnızca collection_items'ı listeler — çizimler (kalem izleri) burada YOK
    // SAYILIR (yapıları gereği bir tuval konsepti, "sıra"ları/satırları olmaz).
    function renderItemsListMode() {
      const container = document.getElementById('am-col-list-mode');
      if (!container || !openCollection) return;
      const readonly = !canEdit();
      if (!openCollection.items.length) {
        container.innerHTML = '<div class="dash-empty">Bu pano henüz boş.<br>Yukarıdaki butonlarla kaydettiğin içerikleri, kendi görsellerini ya da notlarını ekleyebilirsin.</div>';
        return;
      }
      container.innerHTML = openCollection.items.map((it, idx) => {
        const image = safeUrl(it.image);
        const thumb = image
          ? `<img class="col-list-thumb" src="${escapeAttr(avatarImg(image, 120, image))}" alt="" loading="lazy" decoding="async">`
          : '<div class="col-list-thumb col-list-thumb-empty"></div>';
        const titleText = it.title || (it.kind === 'note' ? (it.note || '').slice(0, 60) : 'Adsız öğe');
        const kindLabel = it.kind === 'note' ? 'Not' : (it.kind === 'image' ? 'Görsel' : (SAVED_TYPE_LABELS[it.itemType] || 'Kayıt'));
        const isFirst = idx === 0;
        const isLast = idx === openCollection.items.length - 1;
        const reorderBtns = readonly ? '' : `<div class="col-list-reorder">
            <button type="button" class="col-list-move" data-dir="up" aria-label="Yukarı taşı" title="Yukarı taşı"${isFirst ? ' disabled' : ''}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>
            </button>
            <button type="button" class="col-list-move" data-dir="down" aria-label="Aşağı taşı" title="Aşağı taşı"${isLast ? ' disabled' : ''}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
            </button>
          </div>`;
        const removeBtn = readonly ? '' : '<button type="button" class="col-list-remove" aria-label="Kaldır">✕</button>';
        return `<div class="col-list-row" data-item-id="${escapeAttr(it.id)}">
          ${reorderBtns}${thumb}
          <div style="min-width:0; flex:1;">
            <div class="col-list-title">${escapeHtml(titleText)}</div>
            <div class="saved-row-meta">${escapeHtml(kindLabel)}</div>
          </div>
          ${removeBtn}
        </div>`;
      }).join('');
      if (!readonly) {
        container.querySelectorAll('.col-list-move').forEach(btn => {
          btn.addEventListener('click', () => {
            const row = btn.closest('.col-list-row');
            moveListItem(row.dataset.itemId, btn.dataset.dir);
          });
        });
      }
      container.querySelectorAll('.col-list-remove').forEach(btn => {
        btn.addEventListener('click', async () => {
          const row = btn.closest('.col-list-row');
          btn.disabled = true;
          try {
            await fetch(`/api/collections/${encodeURIComponent(openCollection.item.id)}/items/${encodeURIComponent(row.dataset.itemId)}`, { method: 'DELETE' });
            await reloadDetail();
          } catch { btn.disabled = false; }
        });
      });
    }

    // Yukarı/aşağı butonu tıklanınca komşu öğeyle yer değiştirir, ekranı yeniden çizer (sınır
    // durumundaki disabled butonlar bu şekilde güncellenir) ve sunucudaki sırayı kalıcı hale
    // getirir — collections.js#persistLayout İLE AYNI "önce yerel, sonra fire-and-forget PATCH"
    // deseni (kullanıcı çıkışı bekletilmez).
    function moveListItem(itemId, direction) {
      if (!openCollection) return;
      const items = openCollection.items;
      const idx = items.findIndex(it => it.id === itemId);
      const swapWith = direction === 'up' ? idx - 1 : idx + 1;
      if (idx === -1 || swapWith < 0 || swapWith >= items.length) return;
      [items[idx], items[swapWith]] = [items[swapWith], items[idx]];
      renderItemsListMode();
      const order = items.map(it => it.id);
      fetch(`/api/collections/${encodeURIComponent(openCollection.item.id)}/items`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order }),
      }).catch(() => {});
    }

    // Sürükle (gövdeden, tutamaçlardan/linklerden/silme butonundan DEĞİL) ve köşe tutamaçlarından
    // boyutlandır — Pointer Events + setPointerCapture, image-crop.js#injectStyles İLE AYNI köşe-
    // çapa deseni. Yüzde matematiği canvas'ın KENDİ getBoundingClientRect'ine göre yapılır.
    function wireCanvasInteractions(canvasEl) {
      if (!canvasEl || !canEdit()) return;
      canvasEl.querySelectorAll('.canvas-item').forEach(el => {
        const itemId = el.dataset.itemId;
        const item = openCollection.items.find(it => it.id === itemId);
        if (!item) return;

        function startDrag(e, mode, handle) {
          if (e.button !== undefined && e.button !== 0) return;
          const rect = canvasEl.getBoundingClientRect();
          const start = { x: item.x, y: item.y, width: item.width, height: item.height };
          const startPointer = { x: e.clientX, y: e.clientY };
          let moved = false;
          canvasMaxZ += 1;
          el.style.zIndex = String(canvasMaxZ);
          el.setPointerCapture(e.pointerId);
          el.classList.add('dragging');

          const dims = CANVAS_PAGE_SIZES[openCollection.item.canvasOrientation] || CANVAS_PAGE_SIZES.landscape;
          function onMove(ev) {
            const dxPct = ((ev.clientX - startPointer.x) / rect.width) * 100;
            const dyPct = ((ev.clientY - startPointer.y) / rect.height) * 100;
            if (!moved && Math.hypot(ev.clientX - startPointer.x, ev.clientY - startPointer.y) > DRAG_MOVE_THRESHOLD_PX) moved = true;
            // Snap-to-Grid (kullanıcı isteği madde 4) — hücre boyutu zoom seviyesine göre kademeli
            // değişir (bkz. currentGridCellPx), her sürükleme/boyutlandırma adımında en yakın
            // kesişime kenetlenir.
            if (mode === 'move') {
              item.x = snapToGridPct(start.x + dxPct, dims.w);
              item.y = snapToGridPct(start.y + dyPct, dims.h);
            } else {
              // Köşe çapası — sürüklenen köşenin KARŞI kenarı sabit kalır.
              if (handle.includes('e')) item.width = Math.max(4, snapToGridPct(start.width + dxPct, dims.w));
              if (handle.includes('s')) item.height = Math.max(4, snapToGridPct(start.height + dyPct, dims.h));
              if (handle.includes('w')) { const nw = Math.max(4, snapToGridPct(start.width - dxPct, dims.w)); item.x = snapToGridPct(start.x + (start.width - nw), dims.w); item.width = nw; }
              if (handle.includes('n')) { const nh = Math.max(4, snapToGridPct(start.height - dyPct, dims.h)); item.y = snapToGridPct(start.y + (start.height - nh), dims.h); item.height = nh; }
            }
            el.style.left = item.x + '%'; el.style.top = item.y + '%';
            el.style.width = item.width + '%'; el.style.height = item.height + '%';
          }
          function onUp(ev) {
            el.releasePointerCapture(ev.pointerId);
            el.removeEventListener('pointermove', onMove);
            el.removeEventListener('pointerup', onUp);
            el.removeEventListener('pointercancel', onUp);
            el.classList.remove('dragging');
            item.zIndex = canvasMaxZ;
            if (moved) {
              persistLayout([item]);
              // Sürüklemenin hemen ardından gelen sentetik 'click'i yut — aksi halde bir görseli
              // sürükleyip bırakınca lightbox'ı da açardı (bkz. auth-modal.js#dragJustFinished
              // deseni, galeri yeniden sıralama koduyla AYNI gerçek bulgu).
              const swallow = (ce) => { ce.stopPropagation(); ce.preventDefault(); el.removeEventListener('click', swallow, true); };
              el.addEventListener('click', swallow, true);
            }
          }
          el.addEventListener('pointermove', onMove);
          el.addEventListener('pointerup', onUp);
          el.addEventListener('pointercancel', onUp);
        }

        el.addEventListener('pointerdown', (e) => {
          if (penActive) return; // çizim modundayken öğeler sürüklenmez — bkz. wirePenAndPan
          const handle = e.target.closest('.canvas-item-handle');
          if (handle) { e.preventDefault(); e.stopPropagation(); startDrag(e, 'resize', handle.dataset.handle); return; }
          if (e.target.closest('.canvas-item-remove') || e.target.closest('.canvas-item-open') || e.target.closest('.canvas-item-edit')) return;
          // Not düzenlenirken (kalem ikonuyla contenteditable açılmışken) tıklama imleci
          // konumlandırmalı, öğeyi SÜRÜKLEMEMELİ (kullanıcı isteği: "içerik doğrudan düzenlenebilir").
          if (e.target.closest('.canvas-item-note[contenteditable="true"]')) return;
          startDrag(e, 'move');
        });
      });
    }

    // ---------- Vektörel Çizim Objeleri: tıkla-öne getir / taşı / z-index (kullanıcı isteği) ----------
    // Her çizim (.canvas-stroke-obj > path) .canvas-item'larla AYNI Pointer Events + setPointerCapture
    // deseniyle bağımsız bir obje gibi davranır. GERÇEK BULGU/kullanıcı isteği (2026-09-06): eskiden
    // tıklama bir "Seçili Çizim" menüsü (Sil/Öne Getir/Arkaya Gönder) açıyordu — artık menü YOK,
    // tıklamanın kendisi çizimi DOĞRUDAN öne getirir (bkz. aşağıdaki canvasMaxZ artırımı), diğer
    // .canvas-item'ların tıklayınca z-index almasıyla AYNI davranış.
    function wireStrokeObject(wrapperEl, canvasEl) {
      const path = wrapperEl.querySelector('path');
      if (!path || !canEdit()) return;
      path.addEventListener('pointerdown', (e) => {
        if (penActive) return; // çizim modundayken mevcut izler seçilmez/sürüklenmez
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation(); // page'in kendi pan/çizim dinleyicisi (wirePenAndPan) tetiklenmesin
        const strokeId = wrapperEl.dataset.strokeId;
        const stroke = (openCollection.strokes || []).find(s => s.id === strokeId);
        if (!stroke) return;
        canvasMaxZ += 1;
        applyStrokeZIndex(strokeId, canvasMaxZ);
        const rect = canvasEl.getBoundingClientRect();
        const startPointer = { x: e.clientX, y: e.clientY };
        const startPoints = stroke.points.map(p => [p[0], p[1]]);
        const dims = CANVAS_PAGE_SIZES[openCollection.item.canvasOrientation] || CANVAS_PAGE_SIZES.landscape;
        let moved = false;
        path.setPointerCapture(e.pointerId);
        function onMove(ev) {
          const dxPct = ((ev.clientX - startPointer.x) / rect.width) * 100;
          const dyPct = ((ev.clientY - startPointer.y) / rect.height) * 100;
          if (!moved && Math.hypot(ev.clientX - startPointer.x, ev.clientY - startPointer.y) > DRAG_MOVE_THRESHOLD_PX) moved = true;
          stroke.points = startPoints.map(([x, y]) => [x + dxPct, y + dyPct]);
          path.setAttribute('d', strokePathD(stroke.points, dims));
        }
        function onUp(ev) {
          try { path.releasePointerCapture(ev.pointerId); } catch {}
          path.removeEventListener('pointermove', onMove);
          path.removeEventListener('pointerup', onUp);
          path.removeEventListener('pointercancel', onUp);
          if (moved) {
            fetch(`/api/collections/${encodeURIComponent(openCollection.item.id)}/strokes/${encodeURIComponent(strokeId)}`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ points: stroke.points }),
            }).catch(() => {});
          }
        }
        path.addEventListener('pointermove', onMove);
        path.addEventListener('pointerup', onUp);
        path.addEventListener('pointercancel', onUp);
      });
    }
    function wireStrokeInteractions(canvasEl) {
      if (!canvasEl || !canEdit()) return;
      canvasEl.querySelectorAll('.canvas-stroke-obj').forEach(wrapperEl => wireStrokeObject(wrapperEl, canvasEl));
    }
    function applyStrokeZIndex(strokeId, zIndex) {
      const stroke = (openCollection.strokes || []).find(s => s.id === strokeId);
      if (!stroke) return;
      stroke.zIndex = zIndex;
      const wrapperEl = document.querySelector(`.canvas-stroke-obj[data-stroke-id="${CSS.escape(strokeId)}"]`);
      if (wrapperEl) wrapperEl.style.zIndex = String(zIndex);
      fetch(`/api/collections/${encodeURIComponent(openCollection.item.id)}/strokes/${encodeURIComponent(strokeId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zIndex }),
      }).catch(() => {});
    }
    // ---------- Pan (boş tuval üzerinde sürükle) + Çizim Aracı (kullanıcı isteği madde 1/2) ----------
    // İkisi AYNI pointerdown/move/up zincirini paylaşır: hedef bir .canvas-item DEĞİLSE (o durum
    // wireCanvasInteractions'ta ele alınır) ya kalem aktifse yeni bir iz çizilir, ya da tuval
    // kaydırılır (pan). setPointerCapture BİLEREK page üzerinde (viewport'ta DEĞİL) — capture
    // tutan element pointermove/up olaylarının HEDEFİ olur ve bu olaylar yalnızca dinleyicisi
    // OLDUĞU (ya da atalarından biri olduğu) elemanlara ulaşır; dinleyiciler page'e bağlı olduğundan
    // capture da page'de tutulmak ZORUNDA (viewport'ta tutulsaydı page'deki dinleyiciler hiç
    // tetiklenmezdi — yerel testte yakalanan gerçek bir hata).
    function wirePenAndPan(viewport, page) {
      if (!viewport || !page) return;
      viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = viewport.getBoundingClientRect();
        const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
        if (e.shiftKey) { panX -= e.deltaY; applyCanvasTransform(); return; }
        const prevScale = zoomScale;
        const factor = Math.exp(-e.deltaY * 0.001);
        zoomScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomScale * factor));
        panX = cx - (cx - panX) * (zoomScale / prevScale);
        panY = cy - (cy - panY) * (zoomScale / prevScale);
        applyCanvasTransform();
      }, { passive: false });

      let panState = null;
      let drawState = null;

      page.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.canvas-item')) return; // öğe kendi dinleyicisinde ele alınır
        if (e.target.closest('.canvas-stroke-obj')) return; // çizim kendi dinleyicisinde ele alınır (wireStrokeObject)
        if (e.button !== undefined && e.button !== 0) return;
        if (penActive && canEdit()) {
          const rect = page.getBoundingClientRect();
          const xPct = ((e.clientX - rect.left) / rect.width) * 100;
          const yPct = ((e.clientY - rect.top) / rect.height) * 100;
          const dims = CANVAS_PAGE_SIZES[openCollection.item.canvasOrientation] || CANVAS_PAGE_SIZES.landscape;
          // Vektörel Çizim Objeleri (kullanıcı isteği) — her iz KENDİ tam-sayfa SVG sarmalayıcısında
          // (.canvas-stroke-obj), diğer öğelerle AYNI z-index uzayında (bkz. renderDetail yorumu).
          // Yeni çizim her zaman EN ÜSTE başlar.
          canvasMaxZ += 1;
          const wrapperEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          wrapperEl.setAttribute('class', 'canvas-stroke-obj');
          wrapperEl.setAttribute('viewBox', `0 0 ${dims.w} ${dims.h}`);
          wrapperEl.setAttribute('preserveAspectRatio', 'none');
          wrapperEl.style.zIndex = String(canvasMaxZ);
          const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          pathEl.setAttribute('stroke', penColor);
          pathEl.setAttribute('stroke-width', String(penWidth));
          pathEl.setAttribute('fill', 'none');
          pathEl.setAttribute('stroke-linecap', 'round');
          pathEl.setAttribute('stroke-linejoin', 'round');
          wrapperEl.appendChild(pathEl);
          page.appendChild(wrapperEl);
          drawState = { points: [[xPct, yPct]], pathEl, wrapperEl, dims, zIndex: canvasMaxZ };
          pathEl.setAttribute('d', strokePathD(drawState.points, dims));
        } else {
          panState = { startX: e.clientX, startY: e.clientY, panX0: panX, panY0: panY };
          viewport.classList.add('panning');
        }
        page.setPointerCapture(e.pointerId);
      });
      page.addEventListener('pointermove', (e) => {
        if (drawState) {
          const rect = page.getBoundingClientRect();
          const xPct = ((e.clientX - rect.left) / rect.width) * 100;
          const yPct = ((e.clientY - rect.top) / rect.height) * 100;
          drawState.points.push([xPct, yPct]);
          drawState.pathEl.setAttribute('d', strokePathD(drawState.points, drawState.dims));
        } else if (panState) {
          panX = panState.panX0 + (e.clientX - panState.startX);
          panY = panState.panY0 + (e.clientY - panState.startY);
          applyCanvasTransform();
        }
      });
      function endInteraction(e) {
        try { page.releasePointerCapture(e.pointerId); } catch {}
        if (drawState) {
          const finished = drawState;
          drawState = null;
          if (finished.points.length >= 2) {
            fetch(`/api/collections/${encodeURIComponent(openCollection.item.id)}/strokes`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ points: finished.points, color: penColor, strokeWidth: penWidth, zIndex: finished.zIndex }),
            }).then(async (res) => {
              const data = await res.json().catch(() => ({}));
              if (res.ok && data.item) {
                finished.wrapperEl.dataset.strokeId = data.item.id;
                // Kaydedilmeden önce path'in pointer-events'i BİLEREK yok (çizim bitmeden seçilebilir
                // olmamalı) — obje kalıcı olunca .canvas-item'larla AYNI etkileşim setine kavuşur.
                finished.pathEl.style.pointerEvents = 'stroke';
                finished.pathEl.style.cursor = 'move';
                openCollection.strokes = openCollection.strokes || [];
                openCollection.strokes.push(data.item);
                wireStrokeObject(finished.wrapperEl, page);
              } else finished.wrapperEl.remove();
            }).catch(() => finished.wrapperEl.remove());
          } else finished.wrapperEl.remove();
        }
        if (panState) { panState = null; viewport.classList.remove('panning'); }
      }
      page.addEventListener('pointerup', endInteraction);
      page.addEventListener('pointercancel', endInteraction);
    }

    async function openDetail(id) {
      document.getElementById('am-col-list-view').style.display = 'none';
      document.getElementById('am-col-detail-view').style.display = '';
      ['am-col-add-saved', 'am-col-add-follow', 'am-col-add-image', 'am-col-add-note', 'am-col-share-panel', 'am-col-note-style-panel', 'am-col-palette-panel', 'am-col-kebab-menu', 'am-col-add-menu'].forEach(panelId => {
        document.getElementById(panelId).style.display = 'none';
      });
      notice('am-col-detail-notice', '');
      document.getElementById('am-col-items').innerHTML = '<div class="dash-empty">Yükleniyor…</div>';
      canvasInitialized = false;
      setPenActive(false);
      styleTargetItemId = null;
      boardViewMode = 'list';
      if (boardFullscreen) document.body.style.overflow = ''; // yalnızca BİZİM açtığımız kilidi geri al
      boardFullscreen = false;
      const fsTarget = document.getElementById('am-col-canvas-fs-target');
      if (fsTarget) fsTarget.classList.remove('is-fullscreen');
      const fsToggle = document.getElementById('am-col-fullscreen-toggle');
      if (fsToggle) fsToggle.setAttribute('aria-pressed', 'false');
      try {
        const res = await fetch(`/api/collections/${encodeURIComponent(id)}`);
        if (!res.ok) { showList(); return; }
        openCollection = await res.json();
        openCollection.strokes = openCollection.strokes || [];
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

    // Liste/Izgara görünüm geçişi (kullanıcı isteği madde 1).
    on('am-col-view-toggle', 'click', (e) => {
      const btn = e.target.closest('button[data-view]');
      if (!btn || !openCollection) return;
      if (btn.dataset.view === boardViewMode) return;
      boardViewMode = btn.dataset.view;
      renderDetail();
    });

    // Tam sayfa görünüm (kullanıcı isteği, 2026-09-06 madde 2) — am-col-canvas-fs-target (görünüm
    // geçişi hariç, araç çubuğu+ekleme panelleri+tuval/liste'nin TAMAMI) ekranı kaplar. Boyut
    // değişince pafta yeniden ölçeklenmeli (bkz. fitCanvasToViewport) — aksi halde eski, küçük
    // viewport'a göre hesaplanmış zoom/pan değerleriyle kalırdı.
    on('am-col-fullscreen-toggle', 'click', () => {
      boardFullscreen = !boardFullscreen;
      const target = document.getElementById('am-col-canvas-fs-target');
      if (target) target.classList.toggle('is-fullscreen', boardFullscreen);
      document.getElementById('am-col-fullscreen-toggle').setAttribute('aria-pressed', String(boardFullscreen));
      document.body.style.overflow = boardFullscreen ? 'hidden' : '';
      if (boardViewMode === 'grid') requestAnimationFrame(() => fitCanvasToViewport());
    });

    // Kebab (⋮) menüler — "Paylaş/Dışa Aktar/Panoyu Sil" ve "+ Ekle" (kullanıcı isteği, 2026-09-06).
    // İki menü karşılıklı dışlar: biri açılırken diğeri kapanır. Dışarı tıklayınca kapanma, aşağıdaki
    // am-col-detail-view delege dinleyicisinin başında ele alınır (bkz. orada .col-kebab-wrap kontrolü).
    on('am-col-kebab-toggle', 'click', () => {
      const menu = document.getElementById('am-col-kebab-menu');
      const addMenu = document.getElementById('am-col-add-menu');
      if (addMenu) addMenu.style.display = 'none';
      const opening = menu.style.display === 'none';
      menu.style.display = opening ? '' : 'none';
      document.getElementById('am-col-kebab-toggle').setAttribute('aria-expanded', String(opening));
    });
    on('am-col-add-menu-toggle', 'click', () => {
      const menu = document.getElementById('am-col-add-menu');
      const kebabMenu = document.getElementById('am-col-kebab-menu');
      if (kebabMenu) kebabMenu.style.display = 'none';
      const opening = menu.style.display === 'none';
      menu.style.display = opening ? '' : 'none';
      document.getElementById('am-col-add-menu-toggle').setAttribute('aria-expanded', String(opening));
    });

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
    // ---------------------------------------------------------------------------------------
    // PANO PDF DIŞA AKTARIMI — WYSIWYG (kullanıcı isteği, 2026-09-06 madde 6 — eski veri-detaylı
    // dışa aktarım TAMAMEN kaldırıldı, "gördüğün gibi alırsın" mantığıyla yeniden yazıldı).
    //
    // NEDEN html2canvas/html2pdf YERİNE kendi rasterize edicimiz: bu repoda hiç npm bağımlılığı yok
    // ve CSP dış script'leri engelliyor (bkz. eski sürümün AYNI gerekçesi) — bir CDN'den üçüncü
    // parti bir kütüphane ne paketlenebilir ne çekilebilir, gövdesi doğrulanamayan/imzasız devasa
    // bir dosyayı da kod tabanına elle yapıştırmak (html2canvas ~4000+ satır) entegrite/güvenlik
    // riski taşırdı. Bunun yerine EKRANDAKİ AYNI veri modelinden (öğe x/y/w/h/z, not stili, kalem
    // izleri) doğrudan bir <canvas>'a çiziyoruz — sonuç gerçek anlamda WYSIWYG (yaklaşık bir DOM
    // "screenshot"u değil, aynı sayılardan üretilmiş piksel-bazında eşdeğer bir render), üstelik
    // html2canvas'ın bilinen zayıf noktalarından (gradient/box-shadow/çapraz-origin görsel hataları)
    // muaf. Üretilen PNG, A4 sayfa boyutunda bir <img>'e sarılıp window.print() ile açılır — GERÇEK
    // bir PDF kütüphanesi olmadan tarayıcının kendi "PDF olarak kaydet" çıktısını kullanır (eski
    // sürümdeki AYNI window.print() kararı, bkz. dosya başı yorumu).
    const EXPORT_SCALE = 3; // ~288dpi eşdeğeri (@96dpi baseline × 3) — "yüksek çözünürlüklü" isteği

    function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
      const words = String(text).split(/\s+/);
      let line = '', yy = y;
      for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (line && ctx.measureText(test).width > maxWidth) {
          ctx.fillText(line, x, yy);
          line = word; yy += lineHeight;
        } else line = test;
      }
      if (line) ctx.fillText(line, x, yy);
      return yy + lineHeight;
    }

    function loadImageForExport(src) {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      });
    }

    async function exportBoardPdf() {
      if (!openCollection) return;
      notice('am-col-detail-notice', 'PDF hazırlanıyor…');
      const dims = CANVAS_PAGE_SIZES[openCollection.item.canvasOrientation] || CANVAS_PAGE_SIZES.landscape;
      const canvas = document.createElement('canvas');
      canvas.width = dims.w * EXPORT_SCALE;
      canvas.height = dims.h * EXPORT_SCALE;
      const ctx = canvas.getContext('2d');
      ctx.scale(EXPORT_SCALE, EXPORT_SCALE);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, dims.w, dims.h);
      // Işgara BİLEREK dışa aktarıma çizilmez (kullanıcı isteği madde 6) — ekrandaki ızgara yalnızca
      // düzenleme rehberi, PDF çıktısı bembeyaz A4 arka planı olmalı. Ekrandaki CSS ızgarasına hiç
      // dokunulmaz (zaten ayrı bir katman, bkz. .col-canvas background-image), yalnızca bu rasterize
      // ediciye eskiden eklenen çizim bloğu kaldırıldı.

      // Öğeler VE çizimler ARTIK tek bir z-index uzayını paylaşıyor (kullanıcı isteği: vektörel
      // çizim objeleri Öne Getir/Arkaya Gönder ile diğer öğelerin arasına girebiliyor, bkz.
      // migrations/0097) — gerçek WYSIWYG için ikisi TEK bir sıralı listede birleştirilip z-index'e
      // göre çizilir, eskiden olduğu gibi çizimler artık KOŞULSUZ en üstte değil.
      const drawables = [
        ...openCollection.items.map(it => ({ type: 'item', zIndex: it.zIndex || 0, data: it })),
        ...(openCollection.strokes || []).map(s => ({ type: 'stroke', zIndex: s.zIndex || 0, data: s })),
      ].sort((a, b) => a.zIndex - b.zIndex);

      for (const d of drawables) {
        if (d.type === 'stroke') {
          const s = d.data;
          if (!s.points || s.points.length < 2) continue;
          ctx.strokeStyle = s.color;
          ctx.lineWidth = s.strokeWidth;
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.beginPath();
          s.points.forEach((p, i) => {
            const px = p[0] / 100 * dims.w, py = p[1] / 100 * dims.h;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          });
          ctx.stroke();
          continue;
        }
        const it = d.data;
        const x = it.x / 100 * dims.w, y = it.y / 100 * dims.h, w = it.width / 100 * dims.w, h = it.height / 100 * dims.h;
        const imageUrl = safeUrl(it.image);
        if (imageUrl) {
          const img = await loadImageForExport(avatarImg(imageUrl, 1000, imageUrl));
          if (img && img.naturalWidth) {
            // object-fit:cover eşdeğeri — ekranda görünenle AYNI kırpma.
            const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
            const iw = img.naturalWidth * scale, ih = img.naturalHeight * scale;
            ctx.save();
            ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
            ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
            ctx.restore();
          }
        } else if (it.kind === 'note') {
          // Not arka planı ARTIK şeffaf (kullanıcı isteği madde 2) — dışa aktarımda da beyaz kutu
          // ÇİZİLMEZ, yalnızca metin (ekrandaki .canvas-item-note ile AYNI, bkz. renderDetail).
          ctx.fillStyle = it.textColor || '#1B2A3D';
          const fontSize = it.fontSize || 14;
          ctx.font = `${it.fontWeight === 'bold' ? '700' : '400'} ${fontSize}px Inter, -apple-system, sans-serif`;
          ctx.textBaseline = 'top';
          wrapCanvasText(ctx, it.note || '', x + 8, y + 8, Math.max(10, w - 16), fontSize * 1.3);
        }
      }

      let dataUrl;
      try { dataUrl = canvas.toDataURL('image/png'); }
      catch { notice('am-col-detail-notice', 'PDF oluşturulamadı, tekrar dene.', true); return; }

      const orientationCss = openCollection.item.canvasOrientation === 'portrait' ? 'portrait' : 'landscape';
      const doc = '<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8">'
        + '<title>' + escapeHtml(openCollection.item.title) + ' — MİMARLAB</title>'
        + '<style>@page{size:A4 ' + orientationCss + '; margin:0;} *{margin:0; padding:0;} html,body{background:#fff;} img{display:block; width:100vw; height:100vh; object-fit:contain;}</style>'
        + '</head><body><img src="' + dataUrl + '" alt="">'
        + '<scr' + 'ipt>window.addEventListener("load",function(){setTimeout(function(){window.print();},400);});</scr' + 'ipt>'
        + '</body></html>';

      const w = window.open('', '_blank');
      if (!w) { notice('am-col-detail-notice', 'Yazdırma penceresi engellendi — tarayıcı açılır pencere iznini kontrol et.', true); return; }
      w.document.write(doc);
      w.document.close();
      notice('am-col-detail-notice', '');
    }

    on('am-col-export-btn', 'click', async () => {
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
      // Yetki artık SUNUCUDAN, tek kaynaktan sorulur (bkz. fetchBadgeAccess'teki kök neden notu).
      // amHasAnyBadge() yalnızca ANINDA bilinen bir "evet" için kısayol olarak kullanılır — hayır
      // cevabı asla yerel duruma dayanarak verilmez.
      if (!amHasAnyBadge()) {
        if (msgEl) msgEl.textContent = 'Rozet kontrol ediliyor…';
        const access = await fetchBadgeAccess();
        if (access === false) {
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
        // access === null: sunucuya ulaşılamadı. Rozeti olan bir kullanıcıyı ağ hatası yüzünden
        // engellemektense dışa aktarmayı DENERİZ — PDF çıktısı yıkıcı bir işlem değil.
      }
      if (msgEl) msgEl.textContent = '';
      exportBoardPdf();
    });

    // Paylaş / Paylaşımı Durdur (kullanıcı isteği, 2026-09-02). Açıkken bağlantı panoya özel,
    // tahmin edilemez bir token taşır (bkz. src/routes/collections.js#shareCollection) ve
    // /pano/<token> adresinden oturum GEREKMEDEN görüntülenir. Kapatınca bağlantı ölür.
    // Paylaş — ARTIK önce rozet kontrolü yapıp paneli açar (kullanıcı isteği, 2026-09-05 madde 3:
    // "Paylaş butonu ... SADECE rozet sahibi kullanıcılar için aktif olmalı"). am-col-export-btn'deki
    // AYNI fetchBadgeAccess deseni: amHasAnyBadge() anlık "evet" kısayolu, hayır cevabı SUNUCUDAN.
    on('am-col-share-btn', 'click', async () => {
      if (!openCollection) return;
      const panel = document.getElementById('am-col-share-panel');
      if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
      if (!amHasAnyBadge()) {
        notice('am-col-detail-notice', 'Rozet kontrol ediliyor…');
        const access = await fetchBadgeAccess();
        if (access === false) {
          const el = document.getElementById('am-col-detail-notice');
          if (el) {
            el.style.color = '#B84C4C';
            el.innerHTML = 'Bu özellik rozetli kullanıcılara özeldir, '
              + '<a href="/rozet-al" style="color:inherit; text-decoration:underline; font-weight:600;">rozet al</a>.';
          }
          return;
        }
        // access === null: sunucuya ulaşılamadı — rozeti olan birini ağ hatası yüzünden
        // engellemektense paneli AÇMAYI deneriz (export butonundaki AYNI gerekçe).
      }
      notice('am-col-detail-notice', '');
      panel.style.display = '';
      loadCollaborators();
    });

    on('am-col-public-link-btn', 'click', async () => {
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
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { notice('am-col-detail-notice', data.error || 'Pano paylaşılamadı.', true); return; }
        openCollection.item.shareToken = data.shareToken;
        renderDetail();
        document.getElementById('am-col-share-panel').style.display = '';
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

    // ---- İşbirlikçi (ortak çalışma) listesi/davet — kullanıcı isteği madde 3 ----
    const COLLAB_ROLE_LABELS = { viewer: 'Görüntüleyici', editor: 'Editör' };
    async function loadCollaborators() {
      if (!openCollection) return;
      const el = document.getElementById('am-col-collaborator-list');
      el.innerHTML = '<div class="dash-empty">Yükleniyor…</div>';
      try {
        const res = await fetch(`/api/collections/${encodeURIComponent(openCollection.item.id)}/collaborators`);
        const data = res.ok ? await res.json() : { items: [] };
        renderCollaborators(data.items || []);
      } catch { el.innerHTML = ''; }
    }
    function renderCollaborators(items) {
      const el = document.getElementById('am-col-collaborator-list');
      if (!items.length) { el.innerHTML = '<p class="section-hint">Henüz kimseyi davet etmedin.</p>'; return; }
      el.innerHTML = `<strong style="font-size:13px;">İşbirlikçiler</strong>` + items.map(c => `
        <div class="saved-row" data-user-id="${escapeAttr(c.userId)}">
          <div style="min-width:0; padding:10px 0;">
            <div class="saved-row-title">${escapeHtml(c.name || c.email)}</div>
            <div class="saved-row-meta">${escapeHtml(c.email)}</div>
          </div>
          <select class="am-collab-role-select" style="padding:6px 8px; border:1px solid var(--line); border-radius:8px; background:var(--paper); color:var(--ink); font-size:12px; font-family:inherit;">
            <option value="viewer"${c.role === 'viewer' ? ' selected' : ''}>Görüntüleyici</option>
            <option value="editor"${c.role === 'editor' ? ' selected' : ''}>Editör</option>
          </select>
          <button class="saved-remove-btn" type="button" aria-label="Kaldır">✕</button>
        </div>`).join('');
      el.querySelectorAll('.saved-row').forEach(row => {
        const userId = row.dataset.userId;
        row.querySelector('.am-collab-role-select').addEventListener('change', async (e) => {
          try {
            await fetch(`/api/collections/${encodeURIComponent(openCollection.item.id)}/collaborators/${encodeURIComponent(userId)}`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: e.target.value }),
            });
          } catch {}
        });
        row.querySelector('.saved-remove-btn').addEventListener('click', async () => {
          try {
            await fetch(`/api/collections/${encodeURIComponent(openCollection.item.id)}/collaborators/${encodeURIComponent(userId)}`, { method: 'DELETE' });
            loadCollaborators();
          } catch {}
        });
      });
    }
    on('am-col-invite-btn', 'click', async () => {
      if (!openCollection) return;
      const emailInput = document.getElementById('am-col-invite-email');
      const roleSelect = document.getElementById('am-col-invite-role');
      const email = emailInput.value.trim();
      if (!email) { emailInput.focus(); return; }
      try {
        const res = await fetch(`/api/collections/${encodeURIComponent(openCollection.item.id)}/collaborators`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, role: roleSelect.value }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { notice('am-col-detail-notice', data.error || 'Davet gönderilemedi.', true); return; }
        emailInput.value = '';
        notice('am-col-detail-notice', 'Davet gönderildi.');
        loadCollaborators();
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

    // A4 kağıt yönü (kullanıcı isteği madde 1) — aynı tık dinleyicisi içinde: "on" yardımcı fonksiyonu
    // id+olay çiftine göre TEKİLLEŞTİRDİĞİNDEN (bkz. dosya başı mountCollections#on) 'am-col-detail-
    // view':'click' için İKİNCİ bir on(...) çağrısı sessizce YOK SAYILIRDI — bu yüzden aşağıdaki
    // öğe-ekleme-paneli anahtarlamasıyla AYNI dinleyiciye eklendi.
    on('am-col-detail-view', 'click', async (e) => {
      // Kebab menülerini kapat (kullanıcı isteği, 2026-09-06): menü dışına tıklanırsa OTOMATİK
      // kapanır; menünün İÇİNDEKİ bir öğeye (Paylaş/Dışa Aktar/Panoyu Sil/Ekle seçenekleri)
      // tıklanınca da kapanır — o öğenin kendi ayrı dinleyicisi zaten bu ile AYNI tıklamada
      // bubble ile tetiklenir, biz yalnızca menüyü görsel olarak gizleriz. Menünün kendi açma/
      // kapama tuşuna (.col-kebab-toggle) tıklanınca BURADA dokunulmaz — o kendi dinleyicisinde
      // yönetilir (bkz. am-col-kebab-toggle/am-col-add-menu-toggle).
      if (e.target.closest('.col-kebab-item') || !e.target.closest('.col-kebab-wrap')) {
        const kebabMenu = document.getElementById('am-col-kebab-menu');
        const addMenu = document.getElementById('am-col-add-menu');
        if (kebabMenu) kebabMenu.style.display = 'none';
        if (addMenu) addMenu.style.display = 'none';
      }
      const orientBtn = e.target.closest('[data-orientation]');
      if (orientBtn && openCollection && canEdit()) {
        const val = orientBtn.dataset.orientation;
        if (val !== openCollection.item.canvasOrientation) {
          openCollection.item.canvasOrientation = val;
          canvasInitialized = false;
          renderDetail();
          try {
            await fetch(`/api/collections/${encodeURIComponent(openCollection.item.id)}`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canvasOrientation: val }),
            });
          } catch {}
        }
        return;
      }
      const toggle = e.target.closest('[data-col-add]');
      if (!toggle) return;
      const panelId = `am-col-add-${toggle.dataset.colAdd}`;
      ['am-col-add-saved', 'am-col-add-follow', 'am-col-add-image', 'am-col-add-note'].forEach(id => {
        const el = document.getElementById(id);
        el.style.display = (id === panelId && el.style.display === 'none') ? '' : 'none';
      });
      if (toggle.dataset.colAdd === 'saved' && document.getElementById('am-col-add-saved').style.display !== 'none') loadSavedPicker();
      if (toggle.dataset.colAdd === 'follow' && document.getElementById('am-col-add-follow').style.display !== 'none') loadFollowPicker();
    });

    // ---- Çizim aracı araç çubuğu (kullanıcı isteği madde 2) ----
    on('am-col-pen-toggle', 'click', () => setPenActive(!penActive));
    on('am-col-pen-width', 'input', (e) => { penWidth = parseInt(e.target.value, 10) || 3; });
    on('am-col-pen-color-custom', 'input', (e) => { penColor = e.target.value; });
    on('am-col-pen-swatches', 'click', (e) => {
      const btn = e.target.closest('.col-canvas-pen-swatch');
      if (!btn) return;
      penColor = btn.dataset.hex;
      document.getElementById('am-col-pen-color-custom').value = penColor;
    });

    // ---- Yakınlaştır/Uzaklaştır/Sığdır (kullanıcı isteği madde 1) ----
    on('am-col-zoom-in', 'click', () => { zoomScale = Math.min(ZOOM_MAX, zoomScale * 1.2); applyCanvasTransform(); });
    on('am-col-zoom-out', 'click', () => { zoomScale = Math.max(ZOOM_MIN, zoomScale / 1.2); applyCanvasTransform(); });
    on('am-col-zoom-reset', 'click', () => fitCanvasToViewport());

    // ---- Not stil paneli (kullanıcı isteği madde 2) ----
    on('am-col-note-style-swatches', 'click', (e) => {
      const btn = e.target.closest('.col-canvas-pen-swatch');
      if (!btn) return;
      document.getElementById('am-col-note-style-color-custom').value = btn.dataset.hex;
      applyNoteStyleField('textColor', btn.dataset.hex);
    });
    on('am-col-note-style-color-custom', 'input', (e) => applyNoteStyleField('textColor', e.target.value));
    on('am-col-note-style-size', 'input', (e) => applyNoteStyleField('fontSize', parseInt(e.target.value, 10) || 14));
    on('am-col-note-style-bold', 'change', (e) => applyNoteStyleField('fontWeight', e.target.checked ? 'bold' : 'normal'));
    on('am-col-note-style-close', 'click', () => {
      document.getElementById('am-col-note-style-panel').style.display = 'none';
      styleTargetItemId = null;
    });

    // ---------- Medya Seçici / Galeri Modalı (kullanıcı isteği madde 5) ----------
    // "Kaydettiklerimden"/"Takip Ettiklerimden" bir PROJE ya da ÜRÜN eklenirken öğe doğrudan tuvale
    // düşmez: önce o proje/ürünün TÜM galerisi açılır, kullanıcı hangi görseli istediğini kendi seçer.
    // Ayrı bir modül DEĞİL (bkz. js/components/image-lightbox.js dosya başı yorumu — o TEK görsel
    // büyütmek için, burada aynı anda birden çok görsel + her birinin altında bir "Seç" butonu
    // gerekiyor) — kendi overlay'ini image-lightbox.js İLE AYNI "ilk kullanımda bir kez kur" desenini
    // izleyerek document.body'e ekler (STYLES'daki #am-panel scope'undan BAĞIMSIZ, çünkü bu overlay
    // #am-panel'in DIŞINA - doğrudan body'e - eklenir).
    let mediaPickerOverlay = null;
    function ensureMediaPickerDom() {
      if (mediaPickerOverlay) return;
      if (!document.getElementById('am-media-picker-styles')) {
        const style = document.createElement('style');
        style.id = 'am-media-picker-styles';
        style.textContent = [
          '.am-media-picker{display:none; position:fixed; inset:0; background:rgba(27,42,61,0.92); z-index:270; align-items:center; justify-content:center; padding:32px;}',
          '.am-media-picker.open{display:flex;}',
          '.am-media-picker-frame{width:min(720px,92vw); max-height:86vh; overflow-y:auto; background:var(--paper-card,#fff); border-radius:14px; padding:22px; box-sizing:border-box;}',
          '.am-media-picker-title{font-weight:700; font-size:15px; margin-bottom:4px; color:var(--ink,#1B2A3D); font-family:Inter,-apple-system,sans-serif;}',
          '.am-media-picker-sub{font-size:12.5px; color:var(--ink-soft,#6b7785); margin-bottom:16px; font-family:Inter,-apple-system,sans-serif;}',
          '.am-media-picker-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:12px;}',
          '.am-media-picker-item{position:relative; border-radius:10px; overflow:hidden; background:var(--paper-alt,#F2F4F6); aspect-ratio:4/3;}',
          '.am-media-picker-item img{display:block; width:100%; height:100%; object-fit:cover;}',
          '.am-media-picker-select{position:absolute; left:0; right:0; bottom:0; padding:8px; border:none; background:rgba(27,42,61,0.82); color:#fff; font-size:12px; font-weight:600; cursor:pointer; font-family:Inter,-apple-system,sans-serif;}',
          '.am-media-picker-select:hover{background:#B5793A;}',
          '.am-media-picker-close{position:absolute; top:24px; right:32px; background:none; border:none; color:#EDF0F3; opacity:.85; cursor:pointer; padding:4px; line-height:0;}',
          '.am-media-picker-close:hover{opacity:1;}',
          '@media (max-width:520px){ .am-media-picker{padding:16px;} .am-media-picker-close{top:12px; right:14px;} }',
        ].join('\n');
        document.head.appendChild(style);
      }
      mediaPickerOverlay = document.createElement('div');
      mediaPickerOverlay.className = 'am-media-picker';
      mediaPickerOverlay.setAttribute('role', 'dialog');
      mediaPickerOverlay.setAttribute('aria-modal', 'true');
      mediaPickerOverlay.innerHTML =
        '<button type="button" class="am-media-picker-close" aria-label="Kapat">' +
          '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
        '<div class="am-media-picker-frame">' +
          '<div class="am-media-picker-title"></div>' +
          '<div class="am-media-picker-sub">Panoya eklemek istediğin görseli seç.</div>' +
          '<div class="am-media-picker-grid"></div>' +
        '</div>';
      mediaPickerOverlay.querySelector('.am-media-picker-close').addEventListener('click', closeMediaPicker);
      mediaPickerOverlay.addEventListener('click', (e) => { if (e.target === mediaPickerOverlay) closeMediaPicker(); });
      document.body.appendChild(mediaPickerOverlay);
    }
    function closeMediaPicker() {
      if (!mediaPickerOverlay) return;
      mediaPickerOverlay.classList.remove('open');
      document.body.style.overflow = '';
    }
    function openMediaGalleryPicker(images, titleText, onPick) {
      ensureMediaPickerDom();
      mediaPickerOverlay.querySelector('.am-media-picker-title').textContent = titleText || 'Görsel Seç';
      const grid = mediaPickerOverlay.querySelector('.am-media-picker-grid');
      grid.innerHTML = images.map((img, i) => {
        const url = safeUrl(img);
        return `<div class="am-media-picker-item"><img src="${escapeAttr(avatarImg(url, 320, url))}" alt="" loading="lazy" decoding="async"><button type="button" class="am-media-picker-select" data-idx="${i}">Seç</button></div>`;
      }).join('');
      grid.querySelectorAll('.am-media-picker-select').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.idx, 10);
          closeMediaPicker();
          onPick(images[idx]);
        });
      });
      mediaPickerOverlay.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
    // Proje/ürün/malzeme öğeleri için: panonun kendi ekleme uç noktasına gitmeden ÖNCE tam galeriyi
    // getirir. Galerisi olmayan (0 görsel) ya da tipçe uygun olmayan (mimar/firma/haber/iş ilanı vb.)
    // öğeler eskisi gibi DOĞRUDAN eklenir — seçilecek bir şey yoksa modal açmanın bir anlamı yok.
    async function addSavedOrOpenGallery(payload, itemType, itemKey) {
      const galleryEligible = (itemType === 'project' || itemType === 'product' || itemType === 'material') && itemKey;
      if (!galleryEligible) { addItem(payload); return; }
      let images = [];
      try {
        const endpoint = itemType === 'project'
          ? `/api/project/${encodeURIComponent(itemKey)}`
          : `/api/product/${encodeURIComponent(itemKey)}`;
        const res = await fetch(endpoint);
        const data = res.ok ? await res.json() : null;
        images = (data && data.item && Array.isArray(data.item.images)) ? data.item.images.filter(Boolean) : [];
      } catch { images = []; }
      if (!images.length) { addItem(payload); return; }
      openMediaGalleryPicker(images, payload.title || 'Görsel Seç', (chosenImage) => {
        addItem({ ...payload, image: chosenImage });
      });
    }

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

    // "Tümü"/"Projeler"/"Ürünler" hap filtreleri (kullanıcı isteği madde 4) — Kaydettiklerim VE
    // Takip Ettiklerim seçicilerinde AYNI colMatchesCatalogFilter mantığı (bkz. yukarısı: 'product'
    // filtresi hem product hem material'ı kapsar).
    let savedPickerFilter = '';
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
      const filtered = savedItemsCache
        .map((it, i) => ({ it, i }))
        .filter(({ it }) => colMatchesCatalogFilter(it.item_type, savedPickerFilter));
      if (!filtered.length) { picker.innerHTML = '<div class="dash-empty">Bu türde kaydettiğin bir içerik yok.</div>'; return; }
      picker.innerHTML = filtered.map(({ it, i }) => {
        const image = safeUrl(it.item_image);
        return `
        <button type="button" class="col-saved-option" data-saved-index="${i}">
          ${image ? `<img src="${escapeAttr(avatarImg(image, 240, image))}" alt="" loading="lazy" decoding="async">` : '<img alt="">'}
          <div class="col-saved-option-title">${escapeHtml(it.item_title || '—')}</div>
        </button>`;
      }).join('');
    }
    on('am-col-add-saved-filter', 'click', (e) => {
      const btn = e.target.closest('.saved-filter-btn');
      if (!btn) return;
      savedPickerFilter = btn.dataset.filter;
      document.querySelectorAll('#am-col-add-saved-filter .saved-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      loadSavedPicker();
    });

    on('am-col-saved-picker', 'click', (e) => {
      const option = e.target.closest('.col-saved-option');
      if (!option) return;
      const it = savedItemsCache[parseInt(option.dataset.savedIndex, 10)];
      if (!it) return;
      addSavedOrOpenGallery({
        kind: 'saved', itemType: it.item_type, itemKey: it.item_key,
        title: it.item_title || '', meta: it.item_meta || '', image: it.item_image || '', href: it.item_href || '',
      }, it.item_type, it.item_key);
    });

    // "Takip Ettiklerimden Ekle" (kullanıcı isteği madde 4, YENİ) — takip ettiğin mimar/firma/
    // markaların takibe başladıktan SONRA eklediği en güncel proje/ürünler (bkz. /api/follows/feed,
    // aynı kaynak "Takip Ettiklerim" kutusunun kullandığı). Yalnızca project/product satırları
    // panoya EKLENEBİLİR içerik sayılır — mimar/firma/marka PROFİLLERİ bu seçicide listelenmez.
    let followPickerItems = null;
    let followPickerFilter = '';
    async function loadFollowPicker() {
      const picker = document.getElementById('am-col-follow-picker');
      if (followPickerItems === null) {
        try {
          const res = await fetch('/api/follows/feed');
          const data = res.ok ? await res.json() : { items: [] };
          followPickerItems = (data.items || []).filter(it => it.type === 'project' || it.type === 'product');
        } catch { followPickerItems = []; }
      }
      if (!followPickerItems.length) {
        picker.innerHTML = '<div class="dash-empty">Takip ettiklerinin henüz yeni bir paylaşımı yok.</div>';
        return;
      }
      const filtered = followPickerItems
        .map((it, i) => ({ it, i }))
        .filter(({ it }) => !followPickerFilter || it.type === followPickerFilter);
      if (!filtered.length) { picker.innerHTML = '<div class="dash-empty">Bu türde yeni bir paylaşım yok.</div>'; return; }
      picker.innerHTML = filtered.map(({ it, i }) => {
        const image = safeUrl(it.image);
        return `
        <button type="button" class="col-saved-option" data-follow-index="${i}">
          ${image ? `<img src="${escapeAttr(avatarImg(image, 240, image))}" alt="" loading="lazy" decoding="async">` : '<img alt="">'}
          <div class="col-saved-option-title">${escapeHtml(it.title || '—')}</div>
        </button>`;
      }).join('');
    }
    on('am-col-add-follow-filter', 'click', (e) => {
      const btn = e.target.closest('.saved-filter-btn');
      if (!btn) return;
      followPickerFilter = btn.dataset.filter;
      document.querySelectorAll('#am-col-add-follow-filter .saved-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      loadFollowPicker();
    });
    on('am-col-follow-picker', 'click', (e) => {
      const option = e.target.closest('.col-saved-option');
      if (!option) return;
      const it = followPickerItems[parseInt(option.dataset.followIndex, 10)];
      if (!it || !it.href) return;
      // href her zaman "/proje/:slug" ya da "/urun/:slug" biçimindedir (bkz. src/routes/follows.js#
      // followFeed) — itemKey son yol parçasıdır.
      const itemKey = decodeURIComponent(it.href.split('/').filter(Boolean).pop() || '');
      if (!itemKey) return;
      addSavedOrOpenGallery({ kind: 'saved', itemType: it.type, itemKey, title: it.title || '', image: it.image || '', href: it.href || '' }, it.type, itemKey);
    });

    // Görsel yükleme — hesabim.html/proje-ekle.html'deki AYNI /api/uploads ucu (bkz. src/routes/
    // upload.js): FormData ile POST edilir, dönen /media/... yolu öğe olarak eklenir.
    on('am-col-image-btn', 'click', () => document.getElementById('am-col-image-input').click());
    on('am-col-image-input', 'change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      // 2 MB ÜST SINIRI (kullanıcı isteği, 2026-09-03: "Panolarım kısmında 2mb'tan büyük görsel
      // yüklenemesin"). Kontrol KULLANICININ SEÇTİĞİ ham dosya üzerinde yapılır, aşağıdaki
      // buildImageUploadForm'un küçülttüğü sonuç üzerinde DEĞİL: küçültme 5 MB'lık bir telefon
      // fotoğrafını da ~300 KB'a indirdiğinden, işlenmiş boyuta bakan bir kontrol pratikte hiçbir
      // dosyayı reddetmezdi. Sunucu tarafında da ayrıca `context: 'collection'` ile 2 MB'a
      // kelepçelenir (bkz. src/routes/upload.js#CONTEXT_MAX_BYTES) — istemci kontrolü atlanamasın.
      if (file.size > COLLECTION_IMAGE_MAX_BYTES) {
        notice('am-col-detail-notice', 'Görsel en fazla 2 MB olabilir.', true);
        return;
      }
      notice('am-col-detail-notice', 'Görsel yükleniyor…');
      try {
        // Denetim bulgusu (2026-09-03): burada dosya HİÇ işlenmeden yükleniyordu — sitedeki tek
        // kalan "ham telefon fotoğrafı doğrudan R2'ye" yolu buydu. Artık diğer tüm yükleme
        // noktalarıyla AYNI boru hattından geçer (küçültme + WebP + responsive türevler).
        const form = await buildImageUploadForm(file, { context: 'collection', maxEdge: 1600, quality: 0.85 });
        const res = await fetch('/api/uploads', { method: 'POST', body: form });
        const data = await res.json();
        if (!res.ok) { notice('am-col-detail-notice', data.error || 'Görsel yüklenemedi.', true); return; }
        // title BİLEREK boş bırakılır (kullanıcı isteği: "Dosya İsimlerini Gizleme") — daha önce
        // dosya adı buradan canvas-item-title alt yazısına akıyordu, artık bilgisayardan yüklenen
        // görsellerin altında hiçbir başlık gösterilmez (bkz. renderDetail'deki body/titleText koşulu).
        await addItem({ kind: 'image', image: data.url });
      } catch { notice('am-col-detail-notice', 'Görsel yüklenemedi, tekrar dene.', true); }
    });

    // "Not Ekle" ön-stil seçiciler (kullanıcı isteği madde 2) — pen/not-düzenle swatch'larıyla AYNI
    // click/DOM deseni, yalnızca hedef state newNote*.
    on('am-col-new-note-swatches', 'click', (e) => {
      const btn = e.target.closest('.col-canvas-pen-swatch');
      if (!btn) return;
      newNoteColor = btn.dataset.hex;
      document.getElementById('am-col-new-note-color-custom').value = newNoteColor;
      document.querySelectorAll('#am-col-new-note-swatches .col-canvas-pen-swatch').forEach(s => s.classList.toggle('active', s.dataset.hex === newNoteColor));
    });
    on('am-col-new-note-color-custom', 'input', (e) => { newNoteColor = e.target.value; });
    on('am-col-new-note-size', 'input', (e) => { newNoteSize = parseInt(e.target.value, 10) || 14; });
    on('am-col-new-note-bold', 'change', (e) => { newNoteBold = e.target.checked; });

    on('am-col-note-save-btn', 'click', async () => {
      const textarea = document.getElementById('am-col-note-text');
      const note = textarea.value.trim();
      if (!note) { textarea.focus(); return; }
      await addItem({ kind: 'note', note, textColor: newNoteColor, fontSize: newNoteSize, fontWeight: newNoteBold ? 'bold' : 'normal' });
      textarea.value = '';
    });

    // Kalem ikonu (kullanıcı isteği): notun metni DOĞRUDAN düzenlenebilir hale gelir (contenteditable)
    // — stil paneli (renk/punto/kalınlık) de AYNI anda açılır, ikisi birbirini dışlamaz.
    function startInlineNoteEdit(itemId) {
      const itemEl = document.querySelector(`.canvas-item[data-item-id="${CSS.escape(itemId)}"]`);
      const noteEl = itemEl && itemEl.querySelector('.canvas-item-note');
      if (!noteEl) return;
      noteEl.setAttribute('contenteditable', 'true');
      noteEl.focus();
      const range = document.createRange();
      range.selectNodeContents(noteEl);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      function onKey(ev) { if (ev.key === 'Escape') { ev.preventDefault(); noteEl.blur(); } }
      function save() {
        noteEl.removeEventListener('blur', save);
        noteEl.removeEventListener('keydown', onKey);
        noteEl.removeAttribute('contenteditable');
        // innerText (textContent DEĞİL) — çok satırlı notlarda tarayıcının <div>/<br> ile ürettiği
        // görsel satır sonlarını \n'e çevirir, aksi halde satırlar birleşip tek satıra düşerdi.
        const newNote = noteEl.innerText.trim();
        const item = openCollection && openCollection.items.find(it => it.id === itemId);
        if (!item || !openCollection || newNote === (item.note || '')) return;
        item.note = newNote;
        fetch(`/api/collections/${encodeURIComponent(openCollection.item.id)}/items/${encodeURIComponent(itemId)}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: newNote }),
        }).catch(() => {});
      }
      noteEl.addEventListener('blur', save);
      noteEl.addEventListener('keydown', onKey);
    }
    on('am-col-items', 'click', async (e) => {
      const editBtn = e.target.closest('.canvas-item-edit');
      if (editBtn) { openNoteStylePanel(editBtn.dataset.styleTarget); startInlineNoteEdit(editBtn.dataset.styleTarget); return; }
      const removeBtn = e.target.closest('.canvas-item-remove');
      if (!removeBtn || !openCollection) return;
      const itemEl = removeBtn.closest('.canvas-item');
      removeBtn.disabled = true;
      try {
        await fetch(`/api/collections/${encodeURIComponent(openCollection.item.id)}/items/${encodeURIComponent(itemEl.dataset.itemId)}`, { method: 'DELETE' });
        await reloadDetail();
      } catch { removeBtn.disabled = false; }
    });

    // Renk Paleti widget'ını aç/kapat (kullanıcı isteği madde 3).
    on('am-col-palette-toggle', 'click', () => {
      const panel = document.getElementById('am-col-palette-panel');
      document.getElementById('am-col-note-style-panel').style.display = 'none';
      panel.style.display = panel.style.display === 'none' ? '' : 'none';
    });
    on('am-col-palette-swatches', 'click', async (e) => {
      const btn = e.target.closest('.col-palette-swatch');
      if (!btn) return;
      try {
        await navigator.clipboard.writeText(btn.dataset.hex);
        const hexEl = btn.querySelector('.col-palette-swatch-hex');
        const original = hexEl.textContent;
        hexEl.textContent = 'Kopyalandı';
        setTimeout(() => { hexEl.textContent = original; }, 1200);
      } catch {}
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
        // follows.created_at ms epoch olarak saklanır (bkz. src/routes/follows.js#createFollow) —
        // projects/products'ın "YYYY-MM-DD HH:MM:SS" metnini bekleyen feedTimeMs'e ihtiyaç yok.
        _sortTs: Number(f.created_at) || 0,
      }));
      // followSeenAt render'dan ÖNCE okunur, yeni değer ise HEMEN yazılır: rozetler bu görüntüleme
      // boyunca (filtre değişimi/sayfalama dahil, hepsi aynı followSeenAt'i kullanır) ekranda kalır,
      // bir sonraki ziyarette düşer.
      followSeenAt = readFollowSeenAt();
      const feedItems = (feedData.items || []).map(it => ({ ...it, isNew: feedTimeMs(it.created_at) > followSeenAt, _sortTs: feedTimeMs(it.created_at) }));
      const latest = feedItems.reduce((max, it) => Math.max(max, feedTimeMs(it.created_at)), followSeenAt);
      if (latest > followSeenAt) writeFollowSeenAt(latest);
      // En son eklenen (yeni bir gönderi YA DA yeni bir takip) en üstte olacak şekilde TEK bir
      // kronolojik listeye karıştırılır (kullanıcı isteği, 2026-09-04: "yeni eklenen gönderiler ilk
      // sıralardan son sıralara doğru ilerlesinler") — eskiden gönderiler HER ZAMAN takip edilen
      // profil satırlarının ALTINDA sabit dururdu, ne kadar yeni olursa olsun.
      followFeedItems = [...profileItems, ...feedItems].sort((a, b) => b._sortTs - a._sortTs);
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

  // Tam sayfa pano görünümü (kullanıcı isteği, 2026-09-06 madde 2) — message-button.js#openCompose
  // İLE AYNI gerçek bulgu sınıfı: fullscreen açıkken ModalShell X/backdrop'tan kapatılırsa, panel
  // kendisi opacity/visibility ile görünmez olur ama fs-target'ın YAZDIĞI document.body.style.
  // overflow='hidden' CSS'e bağlı DEĞİL, geri alınmazsa TÜM SAYFA kalıcı olarak kaydırılamaz kalır.
  document.addEventListener('mimarlab-modal-closed', () => {
    const fsTarget = document.getElementById('am-col-canvas-fs-target');
    if (!fsTarget || !fsTarget.classList.contains('is-fullscreen')) return;
    fsTarget.classList.remove('is-fullscreen');
    document.body.style.overflow = '';
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
  // kullanıcı isteği (2026-09-06 madde 5): "masaüstü görünümümde giriş yap ve üye ol popupları,
  // tablet ve mobil görünümdeki gibi yan taraftan çekmece şeklinde açılsınlar ... farklı bir tasarım
  // yapmayacaksın, tablet ve mobil görünümde aktif olan sistemi masaüstünde de aktif edeceksin."
  // Hesabım/Aktivitelerim/Koleksiyonum 2026-09-01'de zaten her genişlikte çekmeceye geçmişti; geriye
  // kalan üç görünüm (login/signup/forgot) de artık aynı yolu kullanıyor, yani AuthModal'in TÜM
  // görünümleri tek bir barındırıcıda (NavDrawer alt sayfası) yaşıyor. Bu yüzden fonksiyon artık
  // view'a da viewport'a da BAKMAZ — yalnızca çekmecenin var olup olmadığına bakar (yoksa eski
  // ModalShell yoluna düşülür, davranış hiçbir sayfada kırılmaz).
  // NOT: `view` parametresi BİLEREK korunuyor — çağıranların (open/swap/handlePopState/resize)
  // tamamı onu geçiyor ve ileride yine görünüme özgü bir ayrım gerekirse imza değişmesin.
  function isMobileDrawer(view) { // eslint-disable-line no-unused-vars
    return !!window.NavDrawer;
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
      const AUTH_VIEW_LABELS = { login: 'Giriş Yap', signup: 'Üye Ol', forgot: 'Şifremi Unuttum', activities: 'Aktivitelerim', collections: 'Koleksiyonum' };
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
    // Hesabım/Aktivitelerim/Koleksiyonum kullanıcı için birer SAYFADIR (bkz. kullanıcı
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
    // Giriş Yap düğmesi bir AÇ/KAPAT anahtarıdır (kullanıcı isteği, 2026-09-06 madde 6: "tıklayınca
    // da açılabilir ve kapanabilir olsun") — hover ile açılan çekmeceyi aynı düğmeye tıklayarak
    // kapatmak, imleci çekmeceden çıkarmadan geri dönmenin tek yolu. Yalnızca ZATEN o görünüm
    // açıkken kapatır; başka bir görünümdeyse aşağıdaki swap() dalı çalışır.
    if (isOpen() && currentView === view) { close(); return; }
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
