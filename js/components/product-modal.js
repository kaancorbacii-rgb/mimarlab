// ProductModal — ürün/malzeme detay modalının orkestratörü (bkz. js/components/architect-modal.js /
// js/components/project-modal.js'teki AYNI open/swap/close/handlePopState state machine deseni). DOM
// çerçevesi js/components/modal-shell.js'ten, galeri/lightbox js/components/gallery.js'ten gelir.
// urun-detay.html'in aksine `/api/product/:key`'i kullanan İLK tüketici budur (bkz. src/routes/
// product.js) — statik urunler-data.js/malzemeler-data.js dizilerini/data.js'i hiç yüklemez, proje
// modalıyla aynı "sunucudan tek JSON çek" desenine geçer. "X tarafından" byline'ı (bkz. renderByline
// aşağıda) src/routes/product.js#fetchOwnerByline'ın claimed_by_user_id üzerinden users/badge_requests
// join'iyle beslediği item.ownerName alanına yeniden bağlandı (kullanıcı isteği) — yalnızca üye
// gönderisi kökenli ürünlerde dolu, legacy_static/admin kayıtlarında gizli kalır.
const ProductModal = (function () {
  // Künye satırı ikonları — js/components/project-meta.js#ICONS İLE AYNI çizim dili (24x24 viewBox,
  // stroke-width 1.6, dolgu yok, bkz. kullanıcı isteği) — urun.html o script'i yüklemediğinden kendi
  // kopyasını taşır (architect-modal.js#META_ICONS İLE AYNI gerekçe).
  const META_ICONS = {
    office: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="10" height="18" rx="1"/><path d="M14 21V9h6v12"/><path d="M7.5 7h1M7.5 10.5h1M7.5 14h1M11 7h1M11 10.5h1M11 14h1"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.4 3.6a2.1 2.1 0 0 1 3 3L7.5 18.5l-4 1 1-4Z"/></svg>',
    tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12.6 2.5H4.6a1.6 1.6 0 0 0-1.6 1.6v8a1.6 1.6 0 0 0 .47 1.13l9.3 9.3a1.6 1.6 0 0 0 2.26 0l6.57-6.57a1.6 1.6 0 0 0 0-2.26l-9.3-9.3a1.6 1.6 0 0 0-1.13-.47Z"/><circle cx="7.7" cy="7.7" r="1.1"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/></svg>',
  };
  function metaIconHtml(key) { return `<span class="meta-icon">${META_ICONS[key] || ''}</span>`; }
  function metaRow(iconKey, bodyHtml) { return `<div class="meta-row">${metaIconHtml(iconKey)}<span>${bodyHtml}</span></div>`; }
  // .detail-title/.designer-*/.gallery-*/.lightbox*/.related-*/.specs-* urun-detay.html'den taşınan
  // AYNI değerler — urun.html farklı bir sayfa olduğundan bunları miras alamaz. .rating-widget/
  // .card-save-btn/.card-edit-btn/.card-delete-btn İSE urun.html'in KENDİ kart bağlamı için ZATEN
  // TANIMLI (bkz. urun.html #card-grid kartları) — burada AYNI sınıf adlarını kart bağlamındakinden
  // FARKLI (detay/modal) görünümde kullanmak gerektiğinden, proje.html'in `.pm-rating-save-row
  // .card-save-btn` deseniyle BİREBİR aynı şekilde yalnızca `.pr-*` kapsayıcıların İÇİNDEKİ kopyaları
  // hedefleyen daha ÖZGÜL seçicilerle override edilir — kart bağlamındaki görünüm HİÇ etkilenmez.
  function injectStyles() {
    if (document.getElementById('product-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'product-modal-styles';
    style.textContent = `
      .detail-title{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:26px; font-weight:700; margin:0 0 12px; line-height:1.25;}
      /* margin-bottom 18px (14px değil) — Düzenle/Arşivle/Sil satırı (eski .pr-actions) buradan
         kaldırılıp X'in yanına taşındığından (bkz. kullanıcı isteği) bu artık künye bloğuna en yakın
         komşu; sayfadaki diğer blok aralarıyla (.detail-meta/.detail-desc margin-top:18px) AYNI
         dikey ritme oturur. */
      .detail-byline{display:flex; align-items:center; gap:8px; font-size:13.5px; color:var(--ink-soft); margin:0 0 18px;}
      .detail-byline strong{color:var(--ink); font-weight:600;}
      .detail-byline a{color:inherit; text-decoration:none;}
      .detail-byline a:hover strong{text-decoration:underline;}
      .detail-byline-avatar{
        width:24px; height:24px; border-radius:50%; flex-shrink:0; overflow:hidden; position:relative;
        display:flex; align-items:center; justify-content:center; color:#fff;
        font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-weight:600; font-size:9.5px;
      }
      .detail-byline-avatar img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover;}
      /* Puanla/Kaydet/Paylaş/Websitesi/Düzenle/Arşivle/Sil artık bu satırda DEĞİL — Puanla/Kaydet/
         Paylaş X'in yanında (X→Kaydet→Paylaş→Puanla sırasıyla, bkz. kullanıcı isteği), Düzenle X'in
         KARŞI kenarında render edilir (bkz. kullanıcı isteği, mountEditAndAdminButtons); Websitesi
         tamamen kaldırıldı. Kaydet/Puanla header'da da .save-btn/.card-save-btn/.rating-widget/
         .pr-rating-avg sınıflarını taşıdığından TEK stil kaynağı hâlâ burasıdır (modal-shell.js
         yalnızca header bağlamındaki yükseklik/genişlik/konum override'larını ekler). */
      .rating-widget{
        display:flex; align-items:center; gap:4px; flex-wrap:nowrap;
        flex-shrink:1 !important; min-width:0 !important;
        height:32px !important; box-sizing:border-box;
        background:var(--paper-card); border:1px solid var(--line); border-radius:100px;
        padding:0 8px !important; margin:0; transition:border-color .15s ease;
        font-family:inherit; font-size:12px !important; font-weight:600; color:var(--ink-soft);
      }
      .rating-widget:hover{border-color:var(--walnut);}
      .rating-widget svg{flex-shrink:0;}
      .pr-rating-avg{
        display:inline-flex; align-items:center; gap:3px; flex-shrink:0;
        font-size:12px; font-weight:600; color:var(--ink-soft); font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .save-btn{
        display:inline-flex; align-items:center; gap:5px;
        flex-shrink:1 !important; min-width:0 !important; white-space:nowrap !important; overflow:hidden !important; text-overflow:ellipsis;
        height:32px !important; box-sizing:border-box;
        background:var(--paper-card); border:1px solid var(--line); border-radius:100px;
        padding:0 8px !important; font-size:12px !important; font-weight:600; color:var(--ink-soft);
        font-family:inherit; line-height:1; text-decoration:none;
      }
      .save-btn:hover{border-color:var(--walnut); color:var(--ink);}
      .save-btn svg{flex-shrink:0;}
      .designer-section{margin-top:0;}
      .designer-section + .designer-section{margin-top:16px;}
      .designer-label{display:flex; align-items:center; gap:9px; font-size:14px; color:var(--ink); font-weight:600; margin-bottom:10px;}
      /* Künye ikonları — js/components/project-meta.js#ICONS İLE AYNI çizim dili/hiza (bkz. kullanıcı
         isteği), hepsi AYNI büyüklükte. */
      .meta-icon{width:16px; height:16px; flex-shrink:0; color:var(--ink-soft);}
      .meta-icon svg{display:block; width:100%; height:100%;}
      .detail-meta .meta-row{display:flex; align-items:flex-start; gap:9px;}
      .detail-meta .meta-row .meta-icon{margin-top:3px;}
      .designer-chips{display:flex; flex-wrap:wrap; gap:10px;}
      .designer-chip{
        display:flex; align-items:center; gap:9px;
        background:var(--paper); border:1px solid var(--line-soft);
        border-radius:100px; padding:6px 16px 6px 6px;
        transition:border-color .15s ease, transform .15s ease;
      }
      a.designer-chip:hover{border-color:var(--brass); transform:translateY(-1px);}
      .designer-chip-avatar{
        width:32px; height:32px; border-radius:50%; flex-shrink:0;
        border:1px solid var(--line); overflow:hidden; position:relative;
        display:flex; align-items:center; justify-content:center;
        color:var(--paper-card); font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-weight:600; font-size:11.5px;
      }
      .designer-chip-avatar img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover;}
      .designer-chip-avatar.office-avatar img{object-fit:contain; background:var(--paper-card);}
      .designer-chip-name{font-size:13px; font-weight:600; color:var(--ink);}
      .designer-chip-no-avatar{padding:6px 16px; min-height:46px;}
      .detail-info{margin-top:8px;}
      .detail-meta{font-size:14px; line-height:1.9; margin-top:18px;}
      .detail-meta strong{font-weight:600; color:var(--ink);}
      .detail-meta a{color:var(--walnut); text-decoration:underline; text-decoration-color:var(--line);}
      .detail-meta a:hover{color:var(--ink);}
      .detail-desc{font-size:15px; line-height:1.7; color:var(--ink); margin-top:18px; white-space:pre-line;}
      .detail-desc-more{background:none; border:none; padding:0; color:var(--walnut); font-weight:600; font-size:14px; text-decoration:underline; text-decoration-color:var(--line); cursor:pointer; white-space:normal;}
      .detail-desc-more:hover{color:var(--ink);}
      /* Teknik Özellikler — açılır/kapanır (bkz. kullanıcı isteği: buton görünümü DEĞİL, mevcut
         başlık aynen kalıp yanına + eklensin) — native <details>/<summary>, .pr-feedback-card'ın
         (Dosyalar/Geri Bildirim) AYNI .feedback-card-plus ikonunu paylaşır, ama kutu çerçevesi/
         arkaplanı OLMADAN — bu yüzden .pr-feedback-card yerine kendi (kutusuz) .specs-details sarmalayıcısı var. */
      .specs-details{margin:0;}
      .specs-details > summary{list-style:none; cursor:pointer; display:flex; align-items:center; justify-content:space-between;}
      .specs-details > summary::-webkit-details-marker{display:none;}
      .specs-details[open] .feedback-card-plus::after{transform:translate(-50%,-50%) rotate(90deg); opacity:0;}
      .specs-title{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:16px; font-weight:700; margin:28px 0 4px;}
      .specs-table{width:100%; border-collapse:collapse; margin-top:12px; font-size:14px;}
      .specs-table tr{border-bottom:1px solid var(--line-soft);}
      .specs-table tr:last-child{border-bottom:none;}
      .specs-table td{padding:10px 0; vertical-align:top;}
      .specs-table td:first-child{color:var(--ink-soft); font-weight:600; width:38%; padding-right:16px;}
      .gallery-wrap{position:relative; min-width:0;}
      .gallery-media{position:relative;}
      .detail-gallery{display:flex; gap:12px; overflow-x:auto; scroll-behavior:smooth; scrollbar-width:none; padding-bottom:4px;}
      .detail-gallery::-webkit-scrollbar{display:none;}
      /* proje.html'deki AYNI 2:1 desen — kutunun boyutu ANKORDA (.detail-gallery a) sabitlenir,
         img/placeholder onu object-fit:cover ile doldurur (bkz. o dosyadaki AYNI yorum). Ürün
         galerisi eskiden kendi 4:3/sabit-yükseklik kutu modelini taşıyordu (kullanıcı isteği: Ürün
         pop-up'ı Proje pop-up'ıyla birebir aynı kart/grid yapısına getirilsin), o desen kaldırıldı. */
      .detail-gallery a{
        flex:0 0 min(88%, 760px); aspect-ratio:2/1; border-radius:14px; overflow:hidden;
        display:block; background:var(--paper-card);
      }
      .detail-gallery img{width:100%; height:100%; object-fit:cover; display:block;}
      /* flex-direction:column+gap proje.html'in placeholder'ında YOK — yalnızca ürün galerisinde
         marka favicon'u (bkz. renderItem#catalogBrandFavicon) initials'in ÜSTÜNDE ayrı bir satırda
         gösterilir, bu içerik farkı ürüne özgü olduğundan korunur; kutunun kendisi (flex-basis/
         aspect-ratio/border-radius/font-size) proje.html ile birebir aynıdır. */
      .gallery-placeholder{
        flex:0 0 min(88%, 760px); aspect-ratio:2/1; border-radius:14px;
        display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px;
        color:rgba(255,255,255,0.92); font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:40px; font-weight:700;
      }
      .gallery-placeholder img{height:36px; width:36px; border-radius:9px; background:#fff; padding:6px; object-fit:contain;}
      .gallery-nav{
        position:absolute; top:50%; transform:translateY(-50%); z-index:3;
        width:38px; height:38px; border-radius:50%; border:none;
        display:flex; align-items:center; justify-content:center;
        background:rgba(27,42,61,0.45); color:#fff;
      }
      .gallery-nav:hover{background:rgba(27,42,61,0.72);}
      .gallery-prev{left:14px;}
      .gallery-next{right:14px;}
      .gallery-counter{text-align:center; margin-top:8px; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:12.5px; color:var(--ink-soft);}
      .lightbox{display:none; position:fixed; inset:0; background:rgba(27,42,61,0.92); z-index:200; align-items:center; justify-content:center; padding:32px;}
      .lightbox.open{display:flex;}
      .lightbox img{max-width:100%; max-height:100%; border-radius:8px; user-select:none;}
      .lightbox-close{position:absolute; top:24px; right:32px; background:none; border:none; color:var(--paper); opacity:0.8; z-index:2;}
      .lightbox-close:hover{opacity:1;}
      .lightbox-nav{position:absolute; top:0; bottom:0; width:15%; min-width:56px; display:flex; align-items:center; background:none; border:none; color:var(--paper); opacity:0.6;}
      .lightbox-nav:hover{opacity:1;}
      .lightbox-prev{left:0; justify-content:flex-start; padding-left:18px;}
      .lightbox-next{right:0; justify-content:flex-end; padding-right:18px;}
      .lightbox-counter{
        position:absolute; bottom:24px; left:50%; transform:translateX(-50%); z-index:2;
        color:#fff; font-size:13px; font-weight:600; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:rgba(27,42,61,0.6); padding:6px 14px; border-radius:100px; backdrop-filter:blur(3px);
      }
      /* "Tümünü Gör" ızgara görünümü — bkz. proje.html'deki AYNI blok, paylaşılan stylesheet
         olmadığından burada da ayrıca tutulur (bkz. js/components/gallery.js#initDetailGallery).
         Buton .lightbox-close İLE BİREBİR AYNI çerçevesiz/metinsiz/ikon-only stile sahip (bkz.
         kullanıcı isteği: minimalist, X ile aynı boyut/renk). */
      .lightbox-grid-toggle{
        position:absolute; top:24px; right:78px; background:none; border:none;
        color:var(--paper); opacity:0.8; z-index:2;
      }
      .lightbox-grid-toggle:hover{opacity:1;}
      .lightbox-grid{display:none; position:absolute; inset:0; z-index:1; background:rgba(27,42,61,0.97); overflow-y:auto; padding:76px 24px 32px;}
      .lightbox.grid-mode .lightbox-grid{display:block;}
      /* ÖNEMLİ gerçek bulgu (bkz. proje.html'deki AYNI yorum) — çocuk kısıtlaması OLMADAN ".lightbox.
         grid-mode img" ızgara kutucuklarının İÇİNDEKİ img'leri de eşleştirip .lightbox-grid-item
         img'nin display:block kuralını eziyordu, thumbnail'lar boş/beyaz kutu render oluyordu.
         Doğrudan-çocuk (>) kısıtlaması yalnızca tekli lightbox görselini hedefler. */
      .lightbox.grid-mode > img,
      .lightbox.grid-mode .lightbox-nav,
      .lightbox.grid-mode .lightbox-counter{display:none;}
      .lightbox-grid-list{display:grid; grid-template-columns:repeat(4, 1fr); gap:12px; max-width:1080px; margin:0 auto;}
      .lightbox-grid-item{aspect-ratio:1/1; border-radius:10px; overflow:hidden; display:block; background:var(--paper-card);}
      .lightbox-grid-item img{width:100%; height:100%; object-fit:cover; display:block;}
      @media (max-width:768px){
        .lightbox-grid{padding:60px 14px 24px;}
        .lightbox-grid-list{grid-template-columns:repeat(2, 1fr); gap:10px;}
      }
      .related-section{margin-top:32px; padding-top:28px; border-top:1px solid var(--line);}
      .related-title{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:17px; font-weight:700; margin:0 0 16px;}
      /* Kart başlığı artık görselin ÜZERİNDE değil ALTINDA (bkz. kullanıcı isteği: tüm sayfa/
         görünümlerde gönderi başlıkları görselin altında olsun). */
      .related-card{display:block; border-radius:12px; overflow:hidden; background:var(--paper-card); border:1px solid var(--line-soft);}
      /* background: yükleme sırasında (yavaş bağlantı) veya görsel 404/hata verirse kutu şeffaf/beyaz
         kalmasın diye nötr gri (bkz. kullanıcı isteği: pop-up görsellerinin bazen beyaz kalması sorunu). */
      .related-card-photo{position:relative; aspect-ratio:4/3; overflow:hidden; background:var(--paper-alt);}
      .related-card-photo img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover;}
      .related-card-placeholder{position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:rgba(255,255,255,0.92); font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:22px; font-weight:700;}
      .related-card-title{padding:12px 14px; color:var(--ink); font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:13.5px; font-weight:700;}
      /* Pop-up içindeki ilgili ürün kartlarında tek satır kısıtlaması (bkz. kullanıcı isteği,
         js/components/architect-modal.js#related-card-title-text ile AYNI): uzun başlıklar tek
         satıra sığdığı kadar yazılır, sığmayan kelimeler alt satıra kesinlikle geçmez, satır
         sonuna ellipsis eklenir. */
      .related-card-title-text{display:block !important; white-space:nowrap !important; overflow:hidden !important; text-overflow:ellipsis !important; width:100% !important;}
      .related-card-subtitle{font-size:11px; font-weight:500; color:var(--ink-soft); margin-top:2px;}
      .related-grid-scroll{display:flex; gap:16px; overflow-x:auto; scroll-behavior:smooth; scrollbar-width:none; padding-bottom:4px;}
      .related-grid-scroll::-webkit-scrollbar{display:none;}
      .related-grid-scroll .related-card{flex:0 0 200px;}
      .prevnext{margin-top:32px; padding-top:24px; border-top:1px solid var(--line); display:flex; justify-content:space-between; gap:16px;}
      .prevnext a{display:flex; align-items:center; gap:10px; flex:1; max-width:48%; padding:10px 14px; border:1px solid var(--line); border-radius:12px; background:var(--paper-card); font-size:13.5px; color:var(--ink-soft);}
      .prevnext a:hover{border-color:var(--walnut);}
      .prevnext a.next{text-align:right; margin-left:auto; flex-direction:row-reverse;}
      .prevnext-thumb{width:44px; height:44px; border-radius:8px; object-fit:cover; flex-shrink:0; background:var(--paper-alt);}
      .prevnext-thumb-placeholder{display:flex; align-items:center; justify-content:center; color:#fff; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-weight:700; font-size:14px;}
      .prevnext-text{min-width:0; flex:1;}
      .prevnext-label{display:block; font-size:11px; letter-spacing:0.06em; color:var(--sage); margin-bottom:4px;}
      /* display:block ZORUNLU — bkz. proje.html#.prevnext-title'daki AYNI gerekçe: span varsayılan
         inline olduğundan overflow:hidden/ellipsis genişlik kısıtlamaz, mobilde metin kutunun
         dışına taşıyordu (bkz. kullanıcı isteği). */
      /* Tek satır+nowrap yerine 3 satıra kadar sarılan clamp (bkz. kullanıcı isteği: "Önceki/Sonraki
         butonlarından başlık aşağı doğru 3 satır devam edebilsin, 3 satırı geçiyorsa üç nokta ile
         sonlandır") — proje.html#.prevnext-title İLE AYNI desen. */
      .prevnext-title{display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; text-overflow:ellipsis; word-break:break-word; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:14px; font-weight:700; color:var(--ink); line-height:1.3;}
      /* ---------- ÜRÜN MODALI — Bilgi Kaynağı & Geri Bildirim (bkz. proje.html'deki AYNI #pm-info-divider/
         #pm-feedback-card kuralları — burada yorum bölümü olmadığından .detail-info'nun hemen altına,
         kendi enjekte edilen <style>'ında tutulur, proje.html'e dokunmaya gerek kalmaz). */
      .pr-info-divider{margin:28px 0 0; border:none; border-top:1px solid var(--line);}
      .pr-feedback-card{margin-top:20px; padding:18px; border:1px solid var(--line); border-radius:14px; background:var(--paper);}
      .pr-feedback-card h5{margin:0 0 6px; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:14px; font-weight:700;}
      .pr-feedback-card p{margin:0 0 10px; font-size:13px; color:var(--ink-soft); line-height:1.5;}
      /* Kart ilk açılışta kapalı (bkz. kullanıcı isteği: "Geri Bildirim +" ön başlığı) — native
         <details>/<summary>, proje.html#.pm-feedback-card İLE AYNI desen. */
      .pr-feedback-card > summary{list-style:none; cursor:pointer; display:flex; align-items:center; justify-content:space-between; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:14px; font-weight:700; color:var(--ink);}
      .pr-feedback-card > summary::-webkit-details-marker{display:none;}
      .pr-feedback-card[open] > summary{margin-bottom:6px;}
      .feedback-card-plus{flex-shrink:0; width:18px; height:18px; position:relative; margin-left:10px;}
      .feedback-card-plus::before, .feedback-card-plus::after{content:''; position:absolute; top:50%; left:50%; background:var(--ink-soft); transform:translate(-50%,-50%); transition:transform 0.15s ease;}
      .feedback-card-plus::before{width:12px; height:2px;}
      .feedback-card-plus::after{width:2px; height:12px;}
      .pr-feedback-card[open] .feedback-card-plus::after{transform:translate(-50%,-50%) rotate(90deg); opacity:0;}
      /* Bildir butonu textarea'nın İÇİNE, sağ alt köşeye bindirilir (bkz. kullanıcı isteği,
         js/components/project-modal.js#wireFeedbackBox ile AYNI desen) — yazının butonun altına/
         arkasına denk gelmemesi için textarea'nın sağ ve alt iç boşluğu büyütülür. */
      .feedback-input-wrap{position:relative;}
      .pr-feedback-card textarea{width:100%; min-height:64px; padding:9px 92px 40px 12px; border:1px solid var(--line); border-radius:10px; background:var(--paper-card); font-family:inherit; font-size:12.5px; color:var(--ink); resize:vertical;}
      .feedback-input-wrap #pr-feedback-btn{position:absolute; right:6px; bottom:6px;}
      #pr-feedback-btn{background:var(--ink); color:var(--paper-card); padding:7px 14px; border-radius:100px; font-weight:600; font-size:12px; border:none;}
      #pr-feedback-btn:hover{background:var(--walnut);}
      #pr-feedback-btn:disabled{opacity:0.5; cursor:not-allowed;}
      #pr-feedback-result{margin:8px 0 0; font-size:12px; color:var(--sage);}
      /* BIM/CAD/Katalog dosyaları — Geri Bildirim kartıyla AYNI .pr-feedback-card kabuğunu paylaşır
         (bkz. kullanıcı isteği: Geri Bildirim'in üzerine, aynı açılır-kapanır görünümde) — yalnızca
         kare kutucuk ızgarası kendine özgüdür. Ürün ekle/düzenle sayfasına yükleme kutusu HENÜZ yok
         (bkz. kullanıcı isteği: "daha sonra ekleyeceğiz"), bu yüzden p.files şimdilik her zaman boş —
         ızgara "Yüklenen dosya yok." gösterir.
         */
      .pr-files-grid{display:flex; flex-wrap:wrap; gap:10px;}
      .pr-files-empty{margin:0; font-size:13px; color:var(--ink-soft);}
      .pr-file-tile{display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; width:84px; height:84px; padding:8px; border:1px solid var(--line); border-radius:12px; background:var(--paper-card); text-decoration:none; color:inherit; text-align:center; flex-shrink:0; box-sizing:border-box;}
      .pr-file-tile:hover{border-color:var(--walnut);}
      .pr-file-icon{min-width:34px; height:22px; padding:0 6px; border-radius:5px; display:flex; align-items:center; justify-content:center; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:9.5px; font-weight:800; letter-spacing:0.02em; color:#fff; flex-shrink:0;}
      .pr-file-name{font-size:10px; color:var(--ink-soft); line-height:1.25; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; word-break:break-word; width:100%;}
      @media (max-width:860px){
        .related-grid-scroll .related-card{flex:0 0 140px;}
        .related-grid-scroll{gap:10px;}
        .detail-gallery a, .gallery-placeholder{flex-basis:92%;}

        /* Mobil/tablet ürün modalı sıra: Galeri → Başlık → Puan+Aksiyon → Künye → Açıklama →
           Firmanın Diğer Ürünleri → Benzer Ürünler → Bilgi Kaynağı (bkz. proje.html'deki AYNI #pm-*
           order deseni, kullanıcı isteği: Ürün pop-up'ı Proje pop-up'ıyla birebir aynı grid yapısına
           getirilsin; Bilgi Kaynağı & Geri Bildirim kutusu bu breakpoint'te sayfanın en altına
           taşındı) — modal-shell.js bu kırılma noktasında sol/sağ paneli display:contents yaptığından
           tüm bölümler AYNI dikey flex akışının parçası. .detail-info künye/açıklama/teknik
           özellikleri TEK blok olarak taşır. Proje modalının aksine burada yorum/aynı-tasarımcı/
           malzeme bölümleri yok, iki related section (Firmanın Diğer Ürünleri, Benzer Ürünler) var. */
        /* order KESİNLİKLE tam sayı olmalı (CSS <integer> — bkz. proje.html'deki AYNI gerçek bulgu:
           ondalıklı order değerleri geçersiz sayılıp sessizce order:0'a düşüyor, ilgili öğeyi
           modalın EN ÜSTÜNE zıplatıyordu). */
        #pr-gallery-wrap{order:1;}
        #pr-title{order:2; margin-top:20px;}
        #pr-byline{order:4;}
        .detail-info{order:6;}
        /* Kullanılan Projeler (bkz. kullanıcı isteği 2026-08-31) — proje modalındaki "Kullanılan
           Ürünler"in AYNADAKİ karşılığı, iki "diğer ürünler" bölümünden ÖNCE gelir (ürünün kendi
           gerçek kullanımları, benzer/ilgili önerilerden daha öncelikli). */
        #pr-projects-section{order:7;}
        #pr-company-section{order:8;}
        #pr-related-section{order:9;}
        #pr-prevnext{order:10;}
        #pr-info-divider{order:11;}
        #pr-files-card{order:12;}
        #pr-feedback-card{order:13;}

        /* Puanla/Kaydet/Paylaş/Websitesi artık bu satırda değil, X'in yanında sabit 36px'te (bkz.
           modal-shell.js#injectStyles) — buradaki eski dokunma-hedefi/gizleme kuralları kaldırıldı. */
      }
      /* Mobil galeri oranı — proje.html'deki AYNI kural (kullanıcı isteği): masaüstünde 2:1 korunur,
         yalnızca ≤768px'te 4:3'e geçilir. 860px bloğundan SONRA tanımlanır ki aynı özgüllükteki
         aspect-ratio kuralı ≤768px genişliklerde kaynak sırasına göre onu ezsin. */
      @media (max-width:768px){
        .detail-gallery a, .gallery-placeholder{aspect-ratio:4/3;}
      }
    `;
    document.head.appendChild(style);
  }

  const LEFT_TEMPLATE = `
    <h1 class="detail-title" id="pr-title"></h1>
    <div class="detail-byline" id="pr-byline" style="display:none;">
      <span class="detail-byline-avatar" id="pr-byline-avatar"></span>
      <span id="pr-byline-text"></span>
    </div>
    <div class="detail-info">
      <div class="designer-section" id="pr-brand-section" style="display:none;">
        <div class="designer-label">${metaIconHtml('office')}Ürün Firması:</div>
        <div class="designer-chips" id="pr-brand-chips"></div>
      </div>
      <div class="designer-section" id="pr-designer-section" style="display:none;">
        <div class="designer-label">${metaIconHtml('pencil')}Tasarımcı:</div>
        <div class="designer-chips" id="pr-designer-chips"></div>
      </div>
      <div class="detail-meta" id="pr-meta"></div>
      <div id="pr-specs-wrap" style="display:none;">
        <details class="specs-details" id="pr-specs-details">
          <summary class="specs-title">Teknik Özellikler<span class="feedback-card-plus" aria-hidden="true"></span></summary>
          <table class="specs-table" id="pr-specs-table"></table>
        </details>
      </div>
      <div class="detail-desc" id="pr-desc"></div>
    </div>
    <hr class="pr-info-divider" id="pr-info-divider">
    <details class="pr-feedback-card" id="pr-files-card">
      <summary>Dosyalar (BIM, CAD, 3D, Katalog)<span class="feedback-card-plus" aria-hidden="true"></span></summary>
      <div class="pr-files-grid" id="pr-files-grid"></div>
    </details>
    <details class="pr-feedback-card" id="pr-feedback-card">
      <summary>Geri Bildirim<span class="feedback-card-plus" aria-hidden="true"></span></summary>
      <p>Hatalı ya da eksik bir bilgi görüyorsan bize bildir.</p>
      <div id="pr-feedback-body"></div>
    </details>`;

  const RIGHT_TEMPLATE = `
    <div class="gallery-wrap" id="pr-gallery-wrap">
      <div class="gallery-media">
        <div class="detail-gallery" id="pr-gallery"></div>
        <button class="gallery-nav gallery-prev" id="pr-gallery-prev" type="button" aria-label="Önceki görsel"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg></button>
        <button class="gallery-nav gallery-next" id="pr-gallery-next" type="button" aria-label="Sonraki görsel"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg></button>
      </div>
      <div class="gallery-counter" id="pr-gallery-counter"></div>
    </div>
    <div class="related-section" id="pr-projects-section" style="display:none;">
      <h2 class="related-title">Kullanılan Projeler</h2>
      <div class="related-grid-scroll" id="pr-projects-grid"></div>
    </div>
    <div class="related-section" id="pr-company-section" style="display:none;">
      <h2 class="related-title" id="pr-company-title">Firmanın Diğer Ürünleri</h2>
      <div class="related-grid-scroll" id="pr-company-grid"></div>
    </div>
    <div class="related-section" id="pr-related-section" style="display:none;">
      <h2 class="related-title" id="pr-related-title">Benzer Ürünler</h2>
      <div class="related-grid-scroll" id="pr-related-grid"></div>
    </div>
    <div class="prevnext" id="pr-prevnext"></div>
    <div class="lightbox" id="pr-lightbox">
      <button class="lightbox-close" id="pr-lightbox-close" aria-label="Kapat"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      <button class="lightbox-nav lightbox-prev" id="pr-lightbox-prev" aria-label="Önceki görsel"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>
      <img id="pr-lightbox-img" src="" alt="" decoding="async">
      <button class="lightbox-nav lightbox-next" id="pr-lightbox-next" aria-label="Sonraki görsel"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></button>
      <div class="lightbox-counter" id="pr-lightbox-counter"></div>
    </div>`;

  const GALLERY_IDS = {
    gallery: 'pr-gallery', galleryPrev: 'pr-gallery-prev', galleryNext: 'pr-gallery-next', galleryCounter: 'pr-gallery-counter',
    lightbox: 'pr-lightbox', lightboxImg: 'pr-lightbox-img', lightboxCounter: 'pr-lightbox-counter',
    lightboxClose: 'pr-lightbox-close', lightboxPrev: 'pr-lightbox-prev', lightboxNext: 'pr-lightbox-next',
  };

  let mountedOnce = false;
  let currentSlug = null;
  let currentItem = null;
  let openedViaPush = false;
  let pushCountSinceOpen = 0;
  let requestSeq = 0;

  // bkz. js/components/modal-shell.js#claimContent — sahip DEĞİŞTİYSE (Hesabım/başka bir detay
  // modalından geçildiyse) panelleri boşaltıp isNewOwner:true döner, bu durumda mountedOnce true
  // olsa da şablon KOŞULSUZ yeniden kurulur (bkz. office-modal.js#ensureTemplate AYNI gerçek bulgu).
  function ensureTemplate() {
    const panels = ModalShell.claimContent('product');
    if (mountedOnce && !panels.isNewOwner) return;
    panels.leftPanelEl.innerHTML = LEFT_TEMPLATE;
    panels.rightPanelEl.innerHTML = RIGHT_TEMPLATE;
    ModalShell.wireGridScrollArrows(panels.rightPanelEl);
    mountedOnce = true;
  }

  function cardHtml(href, title, image, subtitle) {
    const srcset = image ? cdnSrcset(image, [300, 450, 600]) : '';
    return `<a class="related-card" href="${href}">
      <div class="related-card-photo">
        ${image ? `<img src="${escapeAttr(cdnImg(image, 450))}"${srcset ? ` srcset="${escapeAttr(srcset)}" sizes="300px"` : ''} alt="${escapeAttr(title)}" loading="lazy" decoding="async">` : `<div class="related-card-placeholder" style="background:${officeColor(title)}">${escapeHtml(initials(title))}</div>`}
      </div>
      <div class="related-card-title"><span class="related-card-title-text">${escapeHtml(title)}</span>${subtitle ? `<div class="related-card-subtitle">${escapeHtml(subtitle)}</div>` : ''}</div>
    </a>`;
  }

  // bkz. js/components/architect-modal.js#renderTruncatedDesc — BİREBİR aynı desen.
  const DESC_TRUNCATE_AT = 320;
  function renderTruncatedDesc(elId, text) {
    const el = document.getElementById(elId);
    if (text.length <= DESC_TRUNCATE_AT) { el.textContent = text; return; }
    const truncated = text.slice(0, DESC_TRUNCATE_AT).trim();
    el.innerHTML = `${escapeHtml(truncated)}… <button type="button" class="detail-desc-more">Devamını gör...</button>`;
    el.querySelector('.detail-desc-more').addEventListener('click', () => { el.textContent = text; });
  }

  // bkz. auth-modal.js#safeUrl'deki AYNI kök neden/düzeltme — window.location.href yerine
  // document.baseURI (urun.html'deki <base href="/">'yi dikkate alır).
  function safeUrl(u) {
    try {
      const parsed = new URL(u, document.baseURI);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
    } catch {}
    return '';
  }

  // bkz. js/components/architect-modal.js#renderPrevNext — BİREBİR aynı desen, Ürün etiketleriyle.
  // Yön kasıtlı olarak TERS çevrilmiştir (bkz. AYNI dosyadaki kullanıcı isteği/gerekçe) —
  // p.nextItem/prevItem'in kendisi değişmedi, yalnızca hangisi .prev/.next slotunu doldurduğu swap edildi.
  // bkz. kullanıcı isteği: Önceki/Sonraki butonlarının içine önizleme görseli eklenmesi.
  function prevNextThumbHtml(item) {
    return item.image
      ? `<img class="prevnext-thumb" src="${escapeAttr(cdnImg(item.image, 120))}" alt="" loading="lazy" decoding="async">`
      : `<div class="prevnext-thumb prevnext-thumb-placeholder" style="background:${officeColor(item.title)}">${escapeHtml(initials(item.title))}</div>`;
  }

  function renderPrevNext(p) {
    const el = document.getElementById('pr-prevnext');
    let html = '';
    if (p.nextItem) html += `<a class="prev" href="/urun/${encodeURIComponent(p.nextItem.slug)}">${prevNextThumbHtml(p.nextItem)}<span class="prevnext-text"><span class="prevnext-label">← Önceki Ürün</span><span class="prevnext-title">${escapeHtml(p.nextItem.title)}</span></span></a>`;
    if (p.prevItem) html += `<a class="next" href="/urun/${encodeURIComponent(p.prevItem.slug)}">${prevNextThumbHtml(p.prevItem)}<span class="prevnext-text"><span class="prevnext-label">Sonraki Ürün →</span><span class="prevnext-title">${escapeHtml(p.prevItem.title)}</span></span></a>`;
    el.innerHTML = html;
  }

  function kindPlural(p) { return p.kind === 'material' ? 'materials' : 'products'; }
  function ratingKindFor(p) { return p.kind === 'material' ? 'material' : 'product'; }

  // gerçek bulgu (denetim raporu, 2026-08-16): js/components/architect-modal.js#pageTitle ile AYNI
  // sızıntı/gerekçe.
  const TITLE_SUFFIX = ' — MİMARLAB';
  const TITLE_MAX = 60;
  function pageTitle(name) {
    const maxNameLen = TITLE_MAX - TITLE_SUFFIX.length;
    return `${name && name.length > maxNameLen ? name.slice(0, maxNameLen - 1) + '…' : name}${TITLE_SUFFIX}`;
  }

  function updateHeadMeta(p, key) {
    document.title = pageTitle(p.title);
    ModalShell.setLabel(p.title);
    const rawDesc = p.description || `${p.title}${p.brand ? ' — ' + p.brand : ''}. MİMARLAB'da ürün detaylarını incele.`;
    const desc = rawDesc.length > 200 ? rawDesc.slice(0, 197) + '…' : rawDesc;
    const canonicalUrl = `https://mimarlab.com/urun/${encodeURIComponent(key)}`;
    const image = (p.images && p.images[0]) ? new URL(p.images[0], window.location.origin).href : 'https://mimarlab.com/logos/site/mimarlab-og-image.png';
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

  function renderStructuredData(p) {
    let tag = document.getElementById('pr-ld-json');
    if (!tag) {
      tag = document.createElement('script');
      tag.type = 'application/ld+json';
      tag.id = 'pr-ld-json';
      document.head.appendChild(tag);
    }
    const data = { '@context': 'https://schema.org', '@type': 'Product', name: p.title, url: window.location.href };
    if (p.description) data.description = p.description;
    if (p.brand) data.brand = { '@type': 'Brand', name: p.brand };
    // ürün görselleri D1'de şu an hep mutlak (/media/...) ama tutarlılık için document.baseURI
    // (bkz. project-meta.js#renderStructuredData'daki AYNI düzeltme).
    if (p.images && p.images.length) { try { data.image = p.images.map(img => new URL(img, document.baseURI).href); } catch {} }
    tag.textContent = JSON.stringify(data);
  }

  // Marka chip'i: canonical products satırı yalnızca serbest metin brand adı taşır (join yok) —
  // MİMARLAB dizininde bir profili var mı diye AYNI /api/office/:slug ucu (OfficeModal'ın da
  // kullandığı) tek bir isimle deneme-yanılma sorgulanır; bulunursa logolu bir chip, bulunmazsa düz metin.
  async function tryOfficeChip(name) {
    try {
      const res = await fetch(`/api/office/${encodeURIComponent(slugify(name))}`);
      if (!res.ok) return null;
      const payload = await res.json();
      return (payload && payload.item && !payload.hidden) ? payload.item : null;
    } catch { return null; }
  }

  async function renderBrandSection(p) {
    if (!p.brand) return;
    document.getElementById('pr-brand-section').style.display = '';
    // Sisteme kayıtlı olmayan firma adları için yeni bir firma kaydı AÇILMAZ (bkz. kullanıcı isteği) —
    // yalnızca proje-meta.js#d.unregistered ile AYNI baş harf avatarlı, linksiz bir chip gösterilir.
    document.getElementById('pr-brand-chips').innerHTML = `<span class="designer-chip">
      <div class="designer-chip-avatar" style="background:${officeColor(p.brand)}">${escapeHtml(initials(p.brand))}</div>
      <span class="designer-chip-name">${escapeHtml(p.brand)}</span>
    </span>`;
    const off = await tryOfficeChip(p.brand);
    if (!off) return;
    const logo = logoUrl(off);
    document.getElementById('pr-brand-chips').innerHTML = `<a class="designer-chip" href="/firma/${encodeURIComponent(slugify(off.name))}">
      <div class="designer-chip-avatar office-avatar" style="background:${logo ? 'var(--paper-alt)' : officeColor(off.name)}">${logo ? `<img src="${escapeAttr(logo)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : escapeHtml(initials(off.name))}</div>
      <span class="designer-chip-name">${escapeHtml(off.name)}</span>
    </a>`;
  }

  // Tasarımcı chip'i — tryOfficeChip ile BİREBİR aynı desen, /api/architect/:key üzerinden dener.
  // products.designer serbest metin olduğundan (bkz. src/routes/architect.js#relatedProducts'taki
  // AYNI gerekçe) yalnızca TÜM alan tek bir mimar adına birebir eşleşirse tıklanabilir chip olur;
  // "A & B" gibi birden çok isim içeren metinler eşleşmez, düz metin rozeti olarak kalır.
  async function tryArchitectChip(name) {
    try {
      const res = await fetch(`/api/architect/${encodeURIComponent(slugify(name))}`);
      if (!res.ok) return null;
      const payload = await res.json();
      return (payload && payload.item && !payload.hidden) ? payload.item : null;
    } catch { return null; }
  }

  // bkz. urun-ekle.html#u-designer — kullanıcı isteği: birden fazla tasarımcı virgülle ayrılabilsin.
  // Her isim BAĞIMSIZ olarak kendi /api/architect/:key eşleşmesini dener (tryArchitectChip ile AYNI
  // "tüm segmenti tek isim olarak dene" mantığı, artık virgülle bölünmüş her segment için ayrı ayrı) —
  // eşleşmeyen bir isim yalnızca kendi chip'i düz metin kalır, diğer (eşleşen) isimleri etkilemez.
  function designerNamesOf(p) {
    return (p.designer || '').split(',').map(s => s.trim()).filter(Boolean);
  }

  async function renderDesignerSection(p) {
    const names = designerNamesOf(p);
    if (!names.length) return;
    document.getElementById('pr-designer-section').style.display = '';
    const chipsEl = document.getElementById('pr-designer-chips');
    chipsEl.innerHTML = names.map(name => `<span class="designer-chip designer-chip-no-avatar">
      <span class="designer-chip-name">${escapeHtml(name)}</span>
    </span>`).join('');
    const chipEls = chipsEl.children;
    await Promise.all(names.map(async (name, i) => {
      const arch = await tryArchitectChip(name);
      if (!arch || currentItem !== p) return;
      const badge = verifiedBadgeHtml('architect', arch.name, arch.badges, 13);
      chipEls[i].outerHTML = `<a class="designer-chip" href="/mimar/${encodeURIComponent(slugify(arch.name))}">
        <div class="designer-chip-avatar" style="background:${officeColor(arch.name)}">${escapeHtml(initials(arch.name))}${arch.photo ? `<img src="${escapeAttr(cdnImg(arch.photo, 96))}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}</div>
        <span class="designer-chip-name">${escapeHtml(arch.name)}${badge}</span>
      </a>`;
    }));
  }

  // "X tarafından" satırı — proje-modal.js#renderByline ile BİREBİR aynı (yalnızca üye gönderisi
  // kökenli ürünlerde dolu, bkz. src/routes/product.js#fetchOwnerByline item.ownerName alanı).
  function renderByline(item) {
    const wrap = document.getElementById('pr-byline');
    if (!item.ownerName) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    const avatar = document.getElementById('pr-byline-avatar');
    avatar.style.background = officeColor(item.ownerName);
    // cdnImg (bkz. image-cdn.js, bu sayfada — urun.html/proje.html — her zaman yüklü) — denetim
    // bulgusu (2026-08-14): bu küçük (~24-64px) avatar önceden yükleme çözünürlüğünde isteniyordu.
    avatar.innerHTML = escapeHtml(initials(item.ownerName)) + (item.ownerPhoto ? `<img src="${escapeAttr(cdnImg(item.ownerPhoto, 96))}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : '');
    const ownerNameHtml = `<strong>${escapeHtml(item.ownerName)}</strong>${badgeIconHtml(item.ownerBadge, 14)}`;
    document.getElementById('pr-byline-text').innerHTML = item.ownerArchitectSlug
      ? `<a href="/mimar/${encodeURIComponent(item.ownerArchitectSlug)}">${ownerNameHtml}</a> tarafından`
      : `${ownerNameHtml} tarafından`;
  }

  // bkz. js/components/project-modal.js#HIDE_ON_NOT_FOUND_IDS AYNI gerçek bulgu: renderNotFound()
  // bu ID'leri gizliyor, ModalShell'in şablonu sayfa ömrü boyunca tek sefer mount edildiğinden bir
  // sonraki başarılı render bunları geri açmazsa modal kalıcı olarak yarı-boş görünürdü.
  const HIDE_ON_NOT_FOUND_IDS = ['pr-byline', 'pr-brand-section', 'pr-designer-section',
    'pr-info-divider', 'pr-files-card', 'pr-feedback-card', 'pr-projects-section', 'pr-company-section', 'pr-related-section', 'pr-gallery-wrap', 'pr-specs-wrap', 'pr-prevnext'];

  // js/components/project-modal.js#observeOnce ile BİREBİR aynı (bkz. o dosyadaki dosya başı yorum) —
  // "Firmanın Diğer Ürünleri"/"Benzer Ürünler" bölümleri önceden renderItem() içinde HER AÇILIŞTA
  // anında (aşağı kaydırmadan önce bile) çekiliyordu; bu iki /api/products?limit=96 isteği katlanma
  // çizgisinin altındaki içerik için gereksiz yere ilk yükleme ağıyla yarışıyordu (denetim bulgusu,
  // 2026-08-24). timeoutMs yedeği, bölüm hiç görünür alana girmese bile (kısa modal içeriği) sonsuza
  // dek yüklenmeden kalmamasını garanti eder.
  function observeOnce(el, loadFn, timeoutMs) {
    if (!el) { loadFn(); return; }
    let done = false;
    let timer = null;
    const trigger = () => {
      if (done) return;
      done = true;
      obs.disconnect();
      if (timer) clearTimeout(timer);
      loadFn();
    };
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => { if (entry.isIntersecting) trigger(); });
    }, { rootMargin: '200px' });
    obs.observe(el);
    if (timeoutMs) timer = setTimeout(trigger, timeoutMs);
  }

  // Dosya uzantısına göre kare kutucuk rozeti (bkz. kullanıcı isteği: BIM/CAD/3D/Katalog kutucukları)
  // — izin verilen 17 formatlık liste src/routes/upload.js#FILE_UPLOAD_EXTENSIONS ve src/lib/
  // submissionTypes.js#PRODUCT_FILE_EXTENSIONS İLE AYNI (üçü de bağımsız kopya — bu kod tabanının
  // kuralı, bkz. o dosyalardaki AYNI yorum, biri değişirse diğer ikisi de güncellenmeli). Renk kodu
  // dört kategoriye göre gruplanır: BIM mor, CAD gri, 3D mavi, Katalog kırmızı.
  const FILE_TYPE_META = {
    // BIM (mor)
    rfa: { label: 'RFA', color: '#6b4fbb' },
    rvt: { label: 'RVT', color: '#6b4fbb' },
    ifc: { label: 'IFC', color: '#6b4fbb' },
    ifczip: { label: 'IFC', color: '#6b4fbb' },
    // CAD (gri)
    dwg: { label: 'DWG', color: '#4a5568' },
    dxf: { label: 'DXF', color: '#4a5568' },
    // 3D (mavi)
    skp: { label: 'SKP', color: '#2f6fd6' },
    '3dm': { label: '3DM', color: '#2f6fd6' },
    obj: { label: 'OBJ', color: '#2f6fd6' },
    fbx: { label: 'FBX', color: '#2f6fd6' },
    '3ds': { label: '3DS', color: '#2f6fd6' },
    stl: { label: 'STL', color: '#2f6fd6' },
    step: { label: 'STEP', color: '#2f6fd6' },
    stp: { label: 'STP', color: '#2f6fd6' },
    iges: { label: 'IGES', color: '#2f6fd6' },
    igs: { label: 'IGS', color: '#2f6fd6' },
    // Katalog (kırmızı)
    pdf: { label: 'PDF', color: '#d93636' },
  };
  function fileTypeMeta(format) {
    const ext = String(format || '').toLowerCase().replace(/^\./, '');
    return FILE_TYPE_META[ext] || { label: ext ? ext.toUpperCase().slice(0, 4) : 'DOSYA', color: '#8a8a8a' };
  }

  function renderFilesSection(p) {
    const grid = document.getElementById('pr-files-grid');
    if (!grid) return;
    const files = Array.isArray(p.files) ? p.files.filter(f => f && f.url) : [];
    if (!files.length) {
      grid.innerHTML = '<p class="pr-files-empty">Yüklenen dosya yok.</p>';
      return;
    }
    grid.innerHTML = files.map(f => {
      const ext = f.format || (f.filename || f.name || '').split('.').pop();
      const meta = fileTypeMeta(ext);
      const name = f.filename || f.name || meta.label;
      return `<a class="pr-file-tile" href="${escapeAttr(safeUrl(f.url))}" target="_blank" rel="noopener" download title="${escapeAttr(name)}">
        <span class="pr-file-icon" style="background:${meta.color}">${escapeHtml(meta.label)}</span>
        <span class="pr-file-name">${escapeHtml(name)}</span>
      </a>`;
    }).join('');
  }

  async function renderItem(p, key) {
    ModalShell.clearLoadError(); // bir önceki denemenin hata kutusu yeni içerikte asılı kalmasın
    currentItem = p;
    HIDE_ON_NOT_FOUND_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    });
    updateHeadMeta(p, key);
    document.getElementById('pr-title').textContent = p.title;
    renderByline(p);

    document.getElementById('pr-brand-section').style.display = 'none';
    renderBrandSection(p);
    document.getElementById('pr-designer-section').style.display = 'none';
    renderDesignerSection(p);

    // Künye sırası (bkz. kullanıcı isteği): Firma + Tasarımcı (üstteki designer-section'lar),
    // Kategori, Yıl — Web Sitesi artık burada DEĞİL, Kaydet/Paylaş ile AYNI satırda (bkz. aşağıdaki
    // saveSlot render'ı).
    let metaHtml = '';
    if (p.category) metaHtml += metaRow('tag', `<strong>Kategori:</strong> ${escapeHtml(p.category)}`);
    if (p.year) metaHtml += metaRow('calendar', `<strong>Yıl:</strong> ${escapeHtml(p.year)}`);
    document.getElementById('pr-meta').innerHTML = metaHtml;

    renderTruncatedDesc('pr-desc', p.description || '');

    const specsWrap = document.getElementById('pr-specs-wrap');
    if (p.specs && p.specs.length) {
      specsWrap.style.display = '';
      document.getElementById('pr-specs-table').innerHTML = p.specs
        .filter(s => s && (s.label || s.value))
        .map(s => `<tr><td>${escapeHtml(s.label || '')}</td><td>${escapeHtml(s.value || '')}</td></tr>`).join('');
    } else specsWrap.style.display = 'none';

    renderFilesSection(p);

    renderStructuredData(p);
    renderPrevNext(p);

    const images = p.images || [];
    const favicon = (typeof catalogBrandFavicon === 'function') ? catalogBrandFavicon(p.brand) : null;
    initDetailGallery({
      images, title: p.title,
      placeholderHtml: `<div class="gallery-item gallery-placeholder" style="background:${officeColor(p.brand || p.title)}">
        ${favicon ? `<img src="${escapeAttr(favicon)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}
        <span>${escapeHtml(initials(p.brand || p.title))}</span>
      </div>`,
      ids: GALLERY_IDS,
    });

    // ratingKey: puanlama/kaydetme sistemi (ratings.target_id/saved_items.item_key) `key`'den (URL
    // slug'ı) BİLEREK AYRI bir anahtar kullanır (bkz. src/routes/product.js#ratingKeyFor'un dosya
    // başı yorumu) — GERÇEK BULGU (2026-08-17, kullanıcı isteği: ürün URL'lerinin isme dönmesi):
    // slug artık ratingKey'den farklı olabildiğinden (öncesinde ikisi de "m-<id>" olduğundan
    // tesadüfen aynıydı), burada `key` kullanmak yeni bir puanlama/kaydetmeyi YANLIŞ bir target_id'ye
    // yazıp mevcut ortalamadan/sayaçtan koparırdı — GET /api/product/:key artık bu doğru anahtarı
    // ayrıca (p.ratingKey) döndürüyor, save/rating işlemleri onu kullanmalı; `key` yalnızca URL/paylaşım
    // amaçlı kalır.
    const ratingKey = p.ratingKey || key;
    // Kaydet/Paylaş — artık X'in yanında (bkz. kullanıcı isteği), Websitesi tamamen kaldırıldı.
    // Kaydet yalnızca ikon taşır (bkz. kullanıcı isteği: "Kaydet" yazısı silinsin).
    const headerActions = ModalShell.getHeaderActionsSlot();
    if (headerActions) headerActions.innerHTML = '';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'save-btn card-save-btn';
    saveBtn.id = 'pr-save-btn';
    saveBtn.setAttribute('aria-label', 'Kaydet');
    saveBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z"/></svg>`;
    saveBtn.dataset.type = ratingKindFor(p);
    saveBtn.dataset.key = ratingKey;
    saveBtn.dataset.title = p.title;
    saveBtn.dataset.meta = [p.category, p.brand].filter(Boolean).join(' · ');
    saveBtn.dataset.image = images[0] || '';
    saveBtn.dataset.href = `/urun/${encodeURIComponent(key)}`;
    if (headerActions) headerActions.appendChild(saveBtn);
    wireSaveButtons(ratingKindFor(p));

    if (typeof ShareWidget !== 'undefined' && headerActions) {
      headerActions.insertAdjacentHTML('beforeend', ShareWidget.html('pr-share-btn'));
      // bkz. js/components/project-actions.js'teki AYNI ek alanlar/gerekçe — ürün tarafında anahtar
      // ratingKey'dir (Kaydet/Puanla ile AYNI, `key` yalnızca URL içindir, bkz. yukarısı).
      ShareWidget.wire('pr-share-btn', () => ({
        title: p.title,
        url: `${window.location.origin}/urun/${encodeURIComponent(key)}`,
        type: ratingKindFor(p), key: ratingKey,
        image: images[0] || '',
        meta: [p.category, p.brand].filter(Boolean).join(' · '),
      }));
    }

    // Puanla — X/Kaydet/Paylaş'ın EN DIŞINDA (bkz. kullanıcı isteği: "Puanla'yı da üste al, X,
    // Kaydet, Paylaş'ın en dış tarafına, yan yana") — DOM'da EN SONA eklenir ki görsel sıra
    // X→Kaydet→Paylaş→Puanla olsun.
    if (typeof mountRateButton === 'function' && headerActions) {
      headerActions.insertAdjacentHTML('beforeend', `<button type="button" class="rating-widget" id="pr-rating" aria-label="Puanla"></button><span class="pr-rating-avg" id="pr-rating-avg" style="display:none;"></span>`);
      mountRateButton(document.getElementById('pr-rating'), {
        targetType: ratingKindFor(p), targetId: ratingKey, label: p.title,
        avgEl: document.getElementById('pr-rating-avg'),
      });
    }

    const adminActions = ModalShell.getAdminActionsSlot();
    if (adminActions) adminActions.innerHTML = '<span id="pr-edit-slot"></span><span id="pr-admin-slot"></span>';
    mountEditAndAdminButtons(p, key);

    renderUsedInProjects(p);
    observeOnce(document.getElementById('pr-gallery-wrap'), () => {
      if (currentItem !== p) return;
      loadCompanyProducts(p, key);
      loadRelated(p, key);
    }, 1200);
    savedWidgetReady.then(() => { if (currentItem === p) wireFeedbackBox(p, key); });

    wireInternalNav();
    ModalShell.scrollToTop();
  }

  // js/components/project-modal.js#wireFeedbackBox ile BİREBİR aynı (bkz. o dosyadaki AYNI yorum) —
  // bu modalda yorum bölümü olmadığından .detail-info'nun hemen altına, bağımsız kendi kutusu olarak
  // eklenir. /api/corrections 'product' profileType'ını da kabul eder (bkz. src/routes/claims.js).
  function wireFeedbackBox(p, key) {
    const body = document.getElementById('pr-feedback-body');
    if (!body) return;
    body.innerHTML = '';
    if (!currentUser) {
      body.innerHTML = `<p style="margin-top:10px; font-size:13px; color:var(--ink-soft);">Bir bildirim göndermek için <a href="/giris" style="color:var(--walnut); font-weight:600; text-decoration:underline;">giriş yap</a>.</p>`;
      return;
    }
    body.innerHTML = `
      <div class="feedback-input-wrap">
        <textarea id="pr-feedback-note" placeholder=""></textarea>
        <button type="button" id="pr-feedback-btn">Bildir</button>
      </div>
      <p id="pr-feedback-result" style="display:none;"></p>`;
    document.getElementById('pr-feedback-btn').addEventListener('click', async (e) => {
      const btn = e.target;
      const note = document.getElementById('pr-feedback-note').value.trim();
      const feedback = document.getElementById('pr-feedback-result');
      if (!note) {
        feedback.textContent = 'Lütfen bir not yaz.';
        feedback.style.display = '';
        return;
      }
      btn.disabled = true; btn.textContent = 'Gönderiliyor…';
      try {
        const res = await fetch('/api/corrections', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileType: 'product', profileKey: key, note }),
        });
        feedback.textContent = res.ok ? 'Teşekkürler, önerini aldık.' : 'Bir şeyler ters gitti, tekrar dene.';
        feedback.style.display = '';
        if (res.ok) document.getElementById('pr-feedback-note').value = '';
      } catch {
        feedback.textContent = 'Sunucuya ulaşılamadı, tekrar dene.';
        feedback.style.display = '';
      } finally {
        btn.disabled = false; btn.textContent = 'Bildir';
      }
    });
  }

  // Admin HER ürünü/malzemeyi (legacy_static dahil) düzenleyebilir; ürünü yükleyen üye ise YALNIZCA
  // kendi gönderisi (p.submissionId dolu) üzerinde aynı yetkiye sahiptir — Arşivle/Sil kaldırıldı
  // (bkz. kullanıcı isteği, 2026-08-30), pr-admin-slot artık hiç doldurulmuyor.
  // gerçek bulgu (denetim, 2026-08-24): loadCompanyProducts/loadRelated/wireFeedbackBox (bkz.
  // renderItem yukarısı) hepsi kendi async devamlarında `currentItem !== p` bayatlık kontrolü yapıyor
  // — bu fonksiyon (renderItem'dan await EDİLMEDEN çağrılır) hiç yapmıyordu. Kullanıcı bu fonksiyonun
  // await'leri (editSubmissionBtnHtml) hâlâ sürerken başka bir ürüne/malzemeye geçerse, ESKİ ürünün
  // Düzenle butonu artık ekranda görünen YENİ ürünün header'ına yazılıyordu. `currentItem` her
  // renderItem() başında güncellenen paylaşılan modül state'i (bkz. o fonksiyon) — diğer async
  // devamlarla AYNI deseni burada da uygularız.
  async function mountEditAndAdminButtons(p, key) {
    await savedWidgetReady;
    if (currentItem !== p) return;
    if (p.submissionId) {
      const html = await editSubmissionBtnHtml(kindPlural(p), p.submissionId);
      if (currentItem !== p) return;
      const editSlot = document.getElementById('pr-edit-slot');
      if (html && editSlot) editSlot.innerHTML = html;
    } else if (currentUser && currentUser.role === 'admin' && p.id) {
      // legacy_static kökenli (hiçbir gönderiden gelmeyen) ürünler için admin'e AYRI bir doğrudan
      // düzenleme yolu — yukarıdaki editSubmissionBtnHtml submission tablosuna dayanır, bu satırların
      // hiç submission'ı olmadığından o buton bu satırlarda hiçbir zaman görünmüyordu (bkz. kullanıcı
      // isteği: "Admine tüm ürünleri düzenleyebilme yetkisi ver"; bkz. src/routes/legacyContent.js#
      // handleAdminProductEdit, canonical `products` satırını doğrudan id'siyle günceller).
      const editSlot = document.getElementById('pr-edit-slot');
      if (editSlot) editSlot.innerHTML = `<a class="card-edit-btn" href="/urun-ekle?adminedit=${encodeURIComponent(p.id)}">Düzenle</a>`;
    }
  }

  // Firmanın Diğer Ürünleri: AYNI markadan (firma), kendisi hariç — mevcut ürün/malzeme listesinin
  // sayfalanmış /api/products ucundan (limit yüksek tutularak) çekilir. Markası olmayan (ör. bazı
  // malzeme) kayıtlarda bölüm hiç gösterilmez.
  async function loadCompanyProducts(p, key) {
    const section = document.getElementById('pr-company-section');
    section.style.display = 'none';
    if (!p.brand) return;
    // bkz. loadRelated'deki AYNI 2026-08-17 gerekçesi — kendi kendini hariç tutmak için `key` (URL
    // slug) değil /api/products'ın döndürdüğü ratingKey ile karşılaştırılmalı.
    const selfKey = p.ratingKey || key;
    try {
      const params = new URLSearchParams({ limit: '96', brand: p.brand });
      const res = await fetch(`/api/products?${params.toString()}`);
      // GERÇEK BULGU (popup taraması, 2026-08-31): await'ten SONRA hiçbir bayatlık kontrolü yoktu —
      // observeOnce yalnızca ÇAĞRI anında currentItem'ı doğruluyor, fetch dönene kadar kullanıcı
      // başka bir ürüne geçmiş (hatta "bulunamayan" bir ürüne düşmüş) olabilir; geç dönen yanıt
      // ESKİ ürünün kartlarını YENİ popup'ta gösteriyor ve renderNotFound'un gizlediği bölümü geri
      // açıyordu (yerel doğrulamada üretildi: bulunamayan ürün ekranında "Benzer Ürünler" bir
      // önceki ürünün listesiyle görünür kalıyordu). project-modal.js'teki requestSeq korumasının
      // bu dosyadaki karşılığı: currentItem kimliği.
      if (currentItem !== p) return;
      if (!res.ok) return;
      const data = await res.json();
      if (currentItem !== p) return;
      // 9 — bkz. js/components/project-related.js#RESULT_COUNT: tüm öneri şeritlerinin ORTAK üst sınırı.
      const items = (data.items || []).filter(x => x.ratingKey !== selfKey).slice(0, 9);
      if (!items.length) return;
      document.getElementById('pr-company-grid').innerHTML = items.map(r =>
        cardHtml(`/urun/${encodeURIComponent(r.slug)}`, r.title, r.image, r.category)
      ).join('');
      section.style.display = '';
    } catch {}
  }

  // "Kullanılan Projeler" — js/components/project-products.js'in (proje popup'ındaki "Kullanılan
  // Ürünler") AYNADAKİ karşılığı. Veri AYRI bir fetch GEREKTİRMEZ: item.projects zaten GET
  // /api/product/:key yanıtında geliyor (bkz. src/routes/product.js#fetchProductProjects), tıpkı
  // proje modalının item.products'ı gibi — bu yüzden observeOnce ile ertelenmez, hemen çizilir.
  function renderUsedInProjects(p) {
    const section = document.getElementById('pr-projects-section');
    if (!section) return;
    const items = p.projects || [];
    if (!items.length) { section.style.display = 'none'; return; }
    document.getElementById('pr-projects-grid').innerHTML = items.map(pr =>
      cardHtml(`/proje/${encodeURIComponent(pr.slug)}`, pr.title, pr.image, pr.location)
    ).join('');
    section.style.display = '';
  }

  // Benzer Ürünler: AYNI kategoriden, FARKLI firmaların ürünleri (bkz. kullanıcı isteği) — kendi
  // markası burada hariç tutulur çünkü o artık ayrı "Firmanın Diğer Ürünleri" bölümünde (yukarıda)
  // gösteriliyor.
  async function loadRelated(p, key) {
    const section = document.getElementById('pr-related-section');
    section.style.display = 'none';
    if (!p.category) return;
    // kendi kendini hariç tutmak için /api/products'ın döndürdüğü ratingKey ile karşılaştırılmalı
    // (bkz. yukarıdaki renderItem'daki AYNI 2026-08-17 gerekçesi) — `key` (URL slug) ile karşılaştırmak
    // artık ürünü kendi "Diğer Ürünler" listesinde tekrar gösterirdi.
    const selfKey = p.ratingKey || key;
    try {
      const params = new URLSearchParams({ limit: '96', category: p.category });
      const res = await fetch(`/api/products?${params.toString()}`);
      if (currentItem !== p) return; // bkz. loadCompanyProducts'taki AYNI bayatlık koruması
      if (!res.ok) return;
      const data = await res.json();
      if (currentItem !== p) return;
      const related = (data.items || [])
        .filter(x => x.ratingKey !== selfKey && (!p.brand || x.brand !== p.brand))
        .slice(0, 9); // bkz. loadCompanyProducts'taki AYNI ortak üst sınır
      if (!related.length) return;
      document.getElementById('pr-related-title').textContent = 'Benzer Ürünler';
      // bkz. kullanıcı isteği (2026-08-17): burada r.ratingKey kullanılıyordu — puanlama/kaydetme
      // hedef anahtarı (src/routes/product.js#ratingKeyFor), submission kökenli satırlarda hâlâ
      // "m-<id>" biçiminde ve BİLEREK slug'dan bağımsız (bkz. src/lib/canonicalSync.js#syncProduct
      // dosya başı yorumu) — bu yüzden "X Markasından Diğer Ürünler" kartları hâlâ eski çirkin
      // URL'ye gidiyordu. Kartın kendi canonical slug'ı (r.slug, /api/products zaten döner) kullanılmalı.
      document.getElementById('pr-related-grid').innerHTML = related.map(r =>
        cardHtml(`/urun/${encodeURIComponent(r.slug)}`, r.title, r.image, r.brand)
      ).join('');
      section.style.display = '';
    } catch {}
  }

  // status: 'missing' (sunucu 404/410 dedi — kayıt gerçekten yok) | 'error' (geçici sorun; bkz.
  // modal-shell.js#fetchEntity kökten bulgusu — "bulunamadı" DEMEZ, tekrar denenebilir kutu gösterir).
  function renderNotFound(status) {
    ModalShell.clearLoadError();
    const titleEl = document.getElementById('pr-title');
    const headerActions = ModalShell.getHeaderActionsSlot();
    if (headerActions) headerActions.innerHTML = '';
    const adminActions = ModalShell.getAdminActionsSlot();
    if (adminActions) adminActions.innerHTML = '';
    HIDE_ON_NOT_FOUND_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    if (status === 'error') {
      const slug = currentSlug;
      ModalShell.showLoadError(titleEl, 'Ürün şu an yüklenemedi', () => { if (slug) open(slug, { pushHistory: false }); });
      return;
    }
    titleEl.textContent = 'Ürün bulunamadı';
  }

  function wireInternalNav() {
    const panels = ModalShell.getPanels();
    if (!panels || panels.bodyEl.dataset.prNavWired) return;
    panels.bodyEl.dataset.prNavWired = '1';
    panels.bodyEl.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="/urun/"]');
      if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const m = a.getAttribute('href').match(/^\/urun\/([^/?#]+)/);
      if (!m) return;
      e.preventDefault();
      swap(decodeURIComponent(m[1]));
    });
  }

  // ARTIK {status:'ok'|'missing'|'error', item?} döner — bkz. modal-shell.js#fetchEntity'deki kökten
  // bulgu (kullanıcı isteği, 2026-09-01 madde 4): her başarısızlığı null'a indirgemek, geçici bir
  // 429/5xx/ağ hatasında yayında olan bir ürünü "Ürün bulunamadı" olarak gösteriyordu.
  function fetchItem(key) {
    return ModalShell.fetchEntity(`/api/product/${encodeURIComponent(key)}`);
  }

  async function open(slug, { pushHistory = true, triggerEl = null } = {}) {
    await ModalShell.waitForPendingNav();
    currentSlug = slug;
    openedViaPush = pushHistory;
    pushCountSinceOpen = pushHistory ? 1 : 0;
    if (pushHistory) history.pushState({ mimarlabModal: 'product', slug, depth: 1 }, '', `/urun/${encodeURIComponent(slug)}`);
    injectStyles();
    ModalShell.open({ triggerEl, onRequestClose: close });
    ensureTemplate();

    const mySeq = ++requestSeq;
    const result = await fetchItem(slug);
    if (mySeq !== requestSeq || currentSlug !== slug) return;
    if (result.status !== 'ok') { renderNotFound(result.status); return; }
    await renderItem(result.item, slug);
  }

  async function swap(slug) {
    if (!ModalShell.isOpen()) return open(slug, { pushHistory: true });
    await ModalShell.waitForPendingNav();
    currentSlug = slug;
    const currentDepth = (history.state && history.state.mimarlabModal === 'product') ? history.state.depth : pushCountSinceOpen;
    pushCountSinceOpen = currentDepth + 1;
    history.pushState({ mimarlabModal: 'product', slug, depth: pushCountSinceOpen }, '', `/urun/${encodeURIComponent(slug)}`);
    const mySeq = ++requestSeq;
    const result = await fetchItem(slug);
    if (mySeq !== requestSeq || currentSlug !== slug) return;
    if (result.status !== 'ok') { renderNotFound(result.status); return; }
    await renderItem(result.item, slug);
  }

  function close() {
    currentSlug = null;
    currentItem = null;
    if (openedViaPush && pushCountSinceOpen > 0) ModalShell.goBackAndWait(pushCountSinceOpen);
    else history.pushState({}, '', '/urun');
    ModalShell.close();
    pushCountSinceOpen = 0;
  }

  // bkz. js/components/project-modal.js#handlePopState AYNI wasCurrentPopSuperseded gerekçesi.
  function handlePopState(slug) {
    if (ModalShell.wasCurrentPopSuperseded()) return;
    if (!slug) { if (ModalShell.isOpen()) { currentSlug = null; currentItem = null; ModalShell.close(); } return; }
    if (!ModalShell.isOpen()) { openedViaPush = false; open(slug, { pushHistory: false }); return; }
    if (history.state && history.state.mimarlabModal === 'product' && typeof history.state.depth === 'number') {
      pushCountSinceOpen = history.state.depth;
    }
    if (slug === currentSlug) return;
    currentSlug = slug;
    (async () => {
      const mySeq = ++requestSeq;
      const result = await fetchItem(slug);
      if (mySeq !== requestSeq || currentSlug !== slug) return;
      if (result.status !== 'ok') { renderNotFound(result.status); return; }
      await renderItem(result.item, slug);
    })();
  }

  function isOpen() { return ModalShell.isOpen(); }
  function getCurrentSlug() { return currentSlug; }

  return { open, swap, close, handlePopState, isOpen, getCurrentSlug };
})();
