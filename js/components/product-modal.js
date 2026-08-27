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
      .detail-title{font-family:'Inter', sans-serif; font-size:26px; font-weight:700; margin:0 0 12px; line-height:1.25;}
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
        font-family:'IBM Plex Mono', monospace; font-weight:600; font-size:9.5px;
      }
      .detail-byline-avatar img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover;}
      .pr-rating-save-row{
        display:flex !important; flex-direction:row !important; flex-wrap:nowrap !important;
        align-items:center !important; justify-content:flex-start !important; width:100% !important;
        gap:4px !important; margin:0 0 14px;
      }
      /* bkz. proje.html#pm-save-slot AYNI gerçek bulgu — #pr-save-slot kendisi flex konteyner
         olmadığından içindeki .save-btn/.share-widget büyütülmüş boyutlarda alt satıra kayabiliyordu. */
      #pr-save-slot{display:flex; flex-wrap:nowrap; align-items:center; gap:6px; min-width:0;}
      .pr-rating-save-row .rating-widget{
        display:flex; align-items:center; gap:4px; flex-wrap:nowrap;
        flex-shrink:1 !important; min-width:0 !important;
        height:32px !important; box-sizing:border-box;
        background:var(--paper-card); border:1px solid var(--line); border-radius:100px;
        padding:0 8px !important; margin:0; transition:border-color .15s ease;
      }
      .pr-rating-save-row .rating-widget:hover{border-color:var(--walnut);}
      .pr-rating-save-row .rating-star-row{display:flex; gap:2px; flex-shrink:0;}
      .pr-rating-save-row .rating-star-btn{background:none; border:none; padding:0; color:var(--line); display:flex; transition:transform .1s ease;}
      .pr-rating-save-row .rating-star-btn.filled{color:var(--accent);}
      .pr-rating-save-row .rating-star-btn:hover:not(:disabled){color:var(--accent); transform:scale(1.15);}
      .pr-rating-save-row .rating-star-btn:disabled{opacity:0.6; cursor:not-allowed;}
      .pr-rating-save-row .rating-summary{font-size:12px !important; font-weight:600; line-height:1; color:var(--ink-soft); white-space:nowrap !important;}
      .pr-rating-save-row .card-save-btn{
        position:static; width:auto; height:32px !important; z-index:auto;
        background:var(--paper-card); border-radius:100px; color:var(--ink-soft);
        display:inline-flex; align-items:center; gap:5px;
        padding:0 8px !important; border:1px solid var(--line);
        font-size:12px !important; font-weight:600;
        flex-shrink:1 !important; min-width:0 !important; white-space:nowrap !important; overflow:hidden !important; text-overflow:ellipsis;
      }
      .pr-rating-save-row .card-save-btn:hover{background:var(--paper-card); border-color:var(--walnut); color:var(--ink);}
      .pr-rating-save-row .card-save-btn.saved{background:var(--ink); color:var(--paper-card); border-color:var(--ink);}
      /* Paylaş artık ikon-only (bkz. js/components/share-button.js, proje.html'deki AYNI kaldırma) —
         boyutu tamamen o dosyadaki paylaşılan .share-btn kuralından gelir, burada ayrı bir override
         gerekmiyor. */
      .pr-rating-save-row .save-btn-label-saved{display:none;}
      .pr-rating-save-row .card-save-btn.saved .save-btn-label-default{display:none;}
      .pr-rating-save-row .card-save-btn.saved .save-btn-label-saved{display:inline;}
      /* Web Sitesi künye butonu (#pr-website-slot) — office-modal.js'in .save-btn tabanıyla BİREBİR
         aynı (o dosyada proje.html/mimar.html'den miras alınan bir kural, product-modal.js'te hiç
         yoktu). .pr-rating-save-row .card-save-btn'den daha yüksek özgüllüğü olduğundan Kaydet
         butonunu etkilemez, yalnızca bu bare-class kullanan yeni buton için taban stil sağlar. */
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
      .save-btn-count{font-weight:600;}
      /* Düzenle (Gönderiyi Düzenle)/Arşivle/Sil artık burada DEĞİL — modal-shell.js'in paylaşılan
         header'ında, X butonunun yanında render edilir (bkz. kullanıcı isteği, mountEditAndAdminButtons).
         Eski .pr-actions/.card-edit-btn/.card-delete-btn kuralları kaldırıldı; TEK stil kaynağı artık
         modal-shell.js#injectStyles. */
      .designer-section{margin-top:0;}
      .designer-section + .designer-section{margin-top:16px;}
      .designer-label{font-size:14px; color:var(--ink); font-weight:600; margin-bottom:10px;}
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
        color:var(--paper-card); font-family:'IBM Plex Mono', monospace; font-weight:600; font-size:11.5px;
      }
      .designer-chip-avatar img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover;}
      .designer-chip-avatar.office-avatar img{object-fit:contain; background:var(--paper-card);}
      .designer-chip-name{font-size:13px; font-weight:600; color:var(--ink);}
      .detail-info{margin-top:8px;}
      .detail-meta{font-size:14px; line-height:1.9; margin-top:18px;}
      .detail-meta strong{font-weight:600; color:var(--ink);}
      .detail-meta a{color:var(--walnut); text-decoration:underline; text-decoration-color:var(--line);}
      .detail-meta a:hover{color:var(--ink);}
      .detail-desc{font-size:15px; line-height:1.7; color:var(--ink); margin-top:18px; white-space:pre-line;}
      .detail-desc-more{background:none; border:none; padding:0; color:var(--walnut); font-weight:600; font-size:14px; text-decoration:underline; text-decoration-color:var(--line); cursor:pointer; white-space:normal;}
      .detail-desc-more:hover{color:var(--ink);}
      .specs-title{font-family:'Inter', sans-serif; font-size:16px; font-weight:700; margin:28px 0 4px;}
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
        color:rgba(255,255,255,0.92); font-family:'Inter', sans-serif; font-size:40px; font-weight:700;
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
      .gallery-counter{text-align:center; margin-top:8px; font-family:'IBM Plex Mono', monospace; font-size:12.5px; color:var(--ink-soft);}
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
        color:#fff; font-size:13px; font-weight:600; font-family:'IBM Plex Mono', monospace;
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
      .related-title{font-family:'Inter', sans-serif; font-size:17px; font-weight:700; margin:0 0 16px;}
      /* Kart başlığı artık görselin ÜZERİNDE değil ALTINDA (bkz. kullanıcı isteği: tüm sayfa/
         görünümlerde gönderi başlıkları görselin altında olsun). */
      .related-card{display:block; border-radius:12px; overflow:hidden; background:var(--paper-card); border:1px solid var(--line-soft);}
      /* background: yükleme sırasında (yavaş bağlantı) veya görsel 404/hata verirse kutu şeffaf/beyaz
         kalmasın diye nötr gri (bkz. kullanıcı isteği: pop-up görsellerinin bazen beyaz kalması sorunu). */
      .related-card-photo{position:relative; aspect-ratio:4/3; overflow:hidden; background:var(--paper-alt);}
      .related-card-photo img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover;}
      .related-card-placeholder{position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:rgba(255,255,255,0.92); font-family:'Inter', sans-serif; font-size:22px; font-weight:700;}
      .related-card-title{padding:12px 14px; color:var(--ink); font-family:'Inter', sans-serif; font-size:13.5px; font-weight:700;}
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
      .prevnext-thumb-placeholder{display:flex; align-items:center; justify-content:center; color:#fff; font-family:'Inter', sans-serif; font-weight:700; font-size:14px;}
      .prevnext-text{min-width:0; flex:1;}
      .prevnext-label{display:block; font-size:11px; letter-spacing:0.06em; color:var(--sage); margin-bottom:4px;}
      /* display:block ZORUNLU — bkz. proje.html#.prevnext-title'daki AYNI gerekçe: span varsayılan
         inline olduğundan overflow:hidden/ellipsis genişlik kısıtlamaz, mobilde metin kutunun
         dışına taşıyordu (bkz. kullanıcı isteği). */
      /* Tek satır+nowrap yerine 3 satıra kadar sarılan clamp (bkz. kullanıcı isteği: "Önceki/Sonraki
         butonlarından başlık aşağı doğru 3 satır devam edebilsin, 3 satırı geçiyorsa üç nokta ile
         sonlandır") — proje.html#.prevnext-title İLE AYNI desen. */
      .prevnext-title{display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; text-overflow:ellipsis; word-break:break-word; font-family:'Inter', sans-serif; font-size:14px; font-weight:700; color:var(--ink); line-height:1.3;}
      /* ---------- ÜRÜN MODALI — Bilgi Kaynağı & Geri Bildirim (bkz. proje.html'deki AYNI #pm-info-divider/
         #pm-feedback-card kuralları — burada yorum bölümü olmadığından .detail-info'nun hemen altına,
         kendi enjekte edilen <style>'ında tutulur, proje.html'e dokunmaya gerek kalmaz). */
      .pr-info-divider{margin:28px 0 0; border:none; border-top:1px solid var(--line);}
      .pr-feedback-card{margin-top:20px; padding:18px; border:1px solid var(--line); border-radius:14px; background:var(--paper);}
      .pr-feedback-card h5{margin:0 0 6px; font-family:'Inter', sans-serif; font-size:14px; font-weight:700;}
      .pr-feedback-card p{margin:0 0 10px; font-size:13px; color:var(--ink-soft); line-height:1.5;}
      /* Kart ilk açılışta kapalı (bkz. kullanıcı isteği: "Geri Bildirim +" ön başlığı) — native
         <details>/<summary>, proje.html#.pm-feedback-card İLE AYNI desen. */
      .pr-feedback-card > summary{list-style:none; cursor:pointer; display:flex; align-items:center; justify-content:space-between; font-family:'Inter', sans-serif; font-size:14px; font-weight:700; color:var(--ink);}
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
        #pr-rating-save-row{order:3;}
        #pr-byline{order:4;}
        .detail-info{order:6;}
        #pr-company-section{order:7;}
        #pr-related-section{order:8;}
        #pr-prevnext{order:9;}
        #pr-info-divider{order:10;}
        #pr-feedback-card{order:11;}

        /* Puanla/Kaydet — Apple/Google dokunma hedefi standartları (bkz. proje.html'deki AYNI kural,
           kullanıcı isteği): pil yüksekliği en az 48px, tıklanabilir alan en az 44x44px. Masaüstü
           boyutları değişmez. Paylaş artık ikon-only olduğundan (bkz. share-button.js) buradaki
           listeden çıkarıldı, kendi boyutunu paylaşılan .share-btn 860px kuralından alır. */
        .pr-rating-save-row{gap:8px !important;}
        .pr-rating-save-row .rating-widget, .pr-rating-save-row .card-save-btn{
          height:48px !important; min-height:48px !important; padding:0 14px !important; font-size:13.5px !important;
        }
        /* bkz. proje.html'deki AYNI gerçek bulgu — .rating-summary'nin kendi font-size:12px !important
           kuralı (yukarıda) kapsayıcıdan miras almadığından burada da açıkça eşitlenir. */
        .pr-rating-save-row .rating-summary{font-size:13.5px !important;}
        .pr-rating-save-row .rating-star-row{gap:4px;}
        .pr-rating-save-row .rating-star-btn svg{width:15px; height:15px;}
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
    <div class="pr-rating-save-row" id="pr-rating-save-row">
      <div class="rating-widget" id="pr-rating"></div>
      <div id="pr-save-slot"></div>
    </div>
    <div class="detail-byline" id="pr-byline" style="display:none;">
      <span class="detail-byline-avatar" id="pr-byline-avatar"></span>
      <span id="pr-byline-text"></span>
    </div>
    <div class="detail-info">
      <div class="designer-section" id="pr-brand-section" style="display:none;">
        <div class="designer-label">Firma:</div>
        <div class="designer-chips" id="pr-brand-chips"></div>
      </div>
      <div class="detail-meta" id="pr-meta"></div>
      <div id="pr-website-slot" style="margin-top:14px;"></div>
      <div id="pr-specs-wrap" style="display:none;">
        <div class="specs-title">Teknik Özellikler</div>
        <table class="specs-table" id="pr-specs-table"></table>
      </div>
      <div class="detail-desc" id="pr-desc"></div>
    </div>
    <hr class="pr-info-divider" id="pr-info-divider">
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
  function legacyKeyFor(p) { return `${p.brand || ''}|||${p.title}`; }

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
  const HIDE_ON_NOT_FOUND_IDS = ['pr-byline', 'pr-rating-save-row', 'pr-brand-section',
    'pr-info-divider', 'pr-feedback-card', 'pr-company-section', 'pr-related-section', 'pr-gallery-wrap', 'pr-specs-wrap', 'pr-prevnext'];

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

  async function renderItem(p, key) {
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

    // Künye sırası (bkz. kullanıcı isteği): Firma (üstteki designer-section), Tasarımcı, Kategori,
    // Yıl, ardından Web Sitesi — bu artık düz metin satırı değil, firma sayfalarındaki (office-modal.js
    // #save-btn) ile AYNI buton stili, Teknik Özellikler/Açıklamadan önceki son künye satırı.
    let metaHtml = '';
    if (p.designer) metaHtml += `<div><strong>Tasarımcı:</strong> ${escapeHtml(p.designer)}</div>`;
    if (p.category) metaHtml += `<div><strong>Kategori:</strong> ${escapeHtml(p.category)}</div>`;
    if (p.year) metaHtml += `<div><strong>Yıl:</strong> ${escapeHtml(p.year)}</div>`;
    document.getElementById('pr-meta').innerHTML = metaHtml;

    const websiteSlot = document.getElementById('pr-website-slot');
    const site = p.website ? safeUrl(p.website) : '';
    websiteSlot.innerHTML = site
      ? `<a class="save-btn" href="${escapeAttr(site)}" target="_blank" rel="noopener"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg><span>Websitesi</span></a>`
      : '';
    renderTruncatedDesc('pr-desc', p.description || '');

    const specsWrap = document.getElementById('pr-specs-wrap');
    if (p.specs && p.specs.length) {
      specsWrap.style.display = '';
      document.getElementById('pr-specs-table').innerHTML = p.specs
        .filter(s => s && (s.label || s.value))
        .map(s => `<tr><td>${escapeHtml(s.label || '')}</td><td>${escapeHtml(s.value || '')}</td></tr>`).join('');
    } else specsWrap.style.display = 'none';

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
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'save-btn card-save-btn';
    saveBtn.id = 'pr-save-btn';
    saveBtn.setAttribute('aria-label', 'Kaydet');
    saveBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z"/></svg><span class="save-btn-label-default">Kaydet</span><span class="save-btn-label-saved">Kaydedildi</span><span class="save-btn-count" id="pr-save-count"></span>`;
    saveBtn.dataset.type = ratingKindFor(p);
    saveBtn.dataset.key = ratingKey;
    saveBtn.dataset.title = p.title;
    saveBtn.dataset.meta = [p.category, p.brand].filter(Boolean).join(' · ');
    saveBtn.dataset.image = images[0] || '';
    saveBtn.dataset.href = `/urun/${encodeURIComponent(key)}`;
    const saveSlot = document.getElementById('pr-save-slot');
    saveSlot.innerHTML = '';
    saveSlot.prepend(saveBtn);
    wireSaveButtons(ratingKindFor(p));
    fetch(`/api/public/save-count?type=${ratingKindFor(p)}&key=${encodeURIComponent(ratingKey)}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { const el = document.getElementById('pr-save-count'); if (data && el) el.textContent = data.count > 0 ? ` (${data.count})` : ''; })
      .catch(() => {});
    if (typeof ShareWidget !== 'undefined') {
      saveBtn.insertAdjacentHTML('afterend', ShareWidget.html('pr-share-btn'));
      ShareWidget.wire('pr-share-btn', () => ({ title: p.title, url: `${window.location.origin}/urun/${encodeURIComponent(key)}` }));
    }

    const ratingWidget = document.getElementById('pr-rating');
    ratingWidget.dataset.type = ratingKindFor(p);
    ratingWidget.dataset.key = ratingKey;
    mountRatingWidget(ratingWidget);

    const headerActions = ModalShell.getHeaderActionsSlot();
    if (headerActions) headerActions.innerHTML = '<span id="pr-edit-slot"></span><span id="pr-admin-slot"></span>';
    mountEditAndAdminButtons(p, key);

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
      body.innerHTML = `<p style="margin-top:10px; font-size:13px; color:var(--ink-soft);">Bir bildirim göndermek için <a href="giris-yap.html" style="color:var(--walnut); font-weight:600; text-decoration:underline;">giriş yap</a>.</p>`;
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

  // Admin HER ürünü/malzemeyi (legacy_static dahil) düzenleyebilir/arşivleyebilir/silebilir; ürünü
  // yükleyen üye ise YALNIZCA kendi gönderisi (p.submissionId dolu) üzerinde aynı üç yetkiye sahiptir
  // (bkz. kullanıcı isteği: "Admine ve ürünü yükleyen kullanıcıya ürünü düzenleme, silme ve
  // arşivleme yetkisi ver") — proje pop-up'ının aksine (bkz. js/components/project-actions.js#
  // mountOwnerActions, sahibe yalnızca Sil verir) burada sahibe Arşivle de açıktır, kullanıcı bunu
  // AÇIKÇA istedi. Sahiplik ProjectActions'daki AYNI desenle (/api/<tip>/mine sorgusu + id eşleşmesi)
  // belirlenir — admin bu sorguyu atlar, kendi Arşivle/Sil butonları admin'e özel uca gider.
  // gerçek bulgu (denetim, 2026-08-24): loadCompanyProducts/loadRelated/wireFeedbackBox (bkz.
  // renderItem yukarısı) hepsi kendi async devamlarında `currentItem !== p` bayatlık kontrolü yapıyor
  // — bu fonksiyon (renderItem'dan await EDİLMEDEN çağrılır) hiç yapmıyordu. Kullanıcı bu fonksiyonun
  // await'leri (editSubmissionBtnHtml, /api/<tip>/mine) hâlâ sürerken başka bir ürüne/malzemeye
  // geçerse, ESKİ ürünün Sil/Arşivle butonları (runContentModeration/runOwnerModeration'a p/key
  // closure'ıyla kapatılmış) artık ekranda görünen YENİ ürünün header'ına yazılıyor ve tıklandığında
  // YANLIŞ kaydı silip/arşivliyordu. `currentItem` her renderItem() başında güncellenen paylaşılan
  // modül state'i (bkz. o fonksiyon) — diğer async devamlarla AYNI deseni burada da uygularız.
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
      if (editSlot) editSlot.innerHTML = `<a class="card-edit-btn" href="urun-ekle.html?adminedit=${encodeURIComponent(p.id)}">Düzenle</a>`;
    }
    if (!currentUser) return;
    const slot = document.getElementById('pr-admin-slot');
    if (!slot) return;
    if (currentUser.role === 'admin') {
      slot.innerHTML = `<button type="button" class="card-edit-btn" id="pr-archive-btn">Arşivle</button><button type="button" class="card-delete-btn" id="pr-delete-btn">Sil</button>`;
      document.getElementById('pr-archive-btn').addEventListener('click', () => runContentModeration(p, key, 'archive'));
      document.getElementById('pr-delete-btn').addEventListener('click', () => runContentModeration(p, key, 'delete'));
      return;
    }
    if (!p.submissionId) return;
    let mine = false;
    try {
      const res = await fetch(`/api/${kindPlural(p)}/mine`);
      const data = res.ok ? await res.json() : { items: [] };
      mine = (data.items || []).some(it => it.id === p.submissionId);
    } catch { mine = false; }
    if (currentItem !== p) return;
    if (!mine) return;
    slot.innerHTML = `<button type="button" class="card-edit-btn" id="pr-archive-btn">Arşivle</button><button type="button" class="card-delete-btn" id="pr-delete-btn">Sil</button>`;
    document.getElementById('pr-archive-btn').addEventListener('click', () => runOwnerModeration(p, 'archive'));
    document.getElementById('pr-delete-btn').addEventListener('click', () => runOwnerModeration(p, 'delete'));
  }

  async function runContentModeration(p, key, action) {
    const confirmText = action === 'delete'
      ? 'Bu ürünü silmek istediğine emin misin? Ürün anında canlı siteden kaldırılır.'
      : 'Bu ürünü arşivlemek istediğine emin misin? Ürün canlıdan kaldırılıp admin panelindeki Arşiv sekmesine taşınır.';
    if (!confirm(confirmText)) return;
    const btn = document.getElementById(action === 'delete' ? 'pr-delete-btn' : 'pr-archive-btn');
    const otherBtn = document.getElementById(action === 'delete' ? 'pr-archive-btn' : 'pr-delete-btn');
    if (btn) btn.disabled = true;
    if (otherBtn) otherBtn.disabled = true;
    try {
      const res = await fetch('/api/admin/legacy/content-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p.submissionId ? { type: kindPlural(p), action, id: p.submissionId } : { type: kindPlural(p), action, key: legacyKeyFor(p) }),
      });
      if (!res.ok) throw new Error('request failed');
      window.location.href = '/urun';
    } catch {
      alert('Bir şeyler ters gitti, tekrar dene.');
      if (btn) btn.disabled = false;
      if (otherBtn) otherBtn.disabled = false;
    }
  }

  // Sahibin kendi gönderisi üzerinde Arşivle/Sil'i — admin'in genel /api/admin/legacy/content-action
  // ucu (yukarısı) role='admin' zorunlu tuttuğundan sahip için KULLANILAMAZ; bunun yerine sahiplik
  // kontrolünü kendisi yapan /api/<tip>/:id/moderate ucuna gider (bkz. src/routes/submissions.js#
  // moderateOwnSubmission).
  async function runOwnerModeration(p, action) {
    const confirmText = action === 'delete'
      ? 'Bu ürünü silmek istediğine emin misin? Ürün anında canlı siteden kaldırılır.'
      : 'Bu ürünü arşivlemek istediğine emin misin? Ürün canlıdan kaldırılır, Gönderiyi Düzenle üzerinden tekrar yayınlayabilirsin.';
    if (!confirm(confirmText)) return;
    const btn = document.getElementById(action === 'delete' ? 'pr-delete-btn' : 'pr-archive-btn');
    const otherBtn = document.getElementById(action === 'delete' ? 'pr-archive-btn' : 'pr-delete-btn');
    if (btn) btn.disabled = true;
    if (otherBtn) otherBtn.disabled = true;
    try {
      const res = await fetch(`/api/${kindPlural(p)}/${encodeURIComponent(p.submissionId)}/moderate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error('request failed');
      window.location.href = '/urun';
    } catch {
      alert('Bir şeyler ters gitti, tekrar dene.');
      if (btn) btn.disabled = false;
      if (otherBtn) otherBtn.disabled = false;
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
      if (!res.ok) return;
      const data = await res.json();
      const items = (data.items || []).filter(x => x.ratingKey !== selfKey).slice(0, 8);
      if (!items.length) return;
      document.getElementById('pr-company-grid').innerHTML = items.map(r =>
        cardHtml(`/urun/${encodeURIComponent(r.slug)}`, r.title, r.image, r.category)
      ).join('');
      section.style.display = '';
    } catch {}
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
      if (!res.ok) return;
      const data = await res.json();
      const related = (data.items || [])
        .filter(x => x.ratingKey !== selfKey && (!p.brand || x.brand !== p.brand))
        .slice(0, 10);
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

  function renderNotFound() {
    document.getElementById('pr-title').textContent = 'Ürün bulunamadı';
    const headerActions = ModalShell.getHeaderActionsSlot();
    if (headerActions) headerActions.innerHTML = '';
    HIDE_ON_NOT_FOUND_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
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

  // gerçek bulgu (denetim, 2026-08-24, bkz. project-modal.js#fetchItem'daki AYNI kök neden): ağ hatası
  // burada da yakalanmıyordu — open()/swap() renderNotFound()'ı hiç tetikleyemeden modal iskelet
  // durumunda kalıyordu. Ağ hatası artık 404/gizli kayıtla AYNI null yola yönlendirilir.
  async function fetchItem(key) {
    try {
      const res = await fetch(`/api/product/${encodeURIComponent(key)}`);
      if (!res.ok) return null;
      const payload = await res.json();
      if (!payload || !payload.item || payload.hidden) return null;
      return payload.item;
    } catch { return null; }
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
    const item = await fetchItem(slug);
    if (mySeq !== requestSeq || currentSlug !== slug) return;
    if (!item) { renderNotFound(); return; }
    await renderItem(item, slug);
  }

  async function swap(slug) {
    if (!ModalShell.isOpen()) return open(slug, { pushHistory: true });
    await ModalShell.waitForPendingNav();
    currentSlug = slug;
    const currentDepth = (history.state && history.state.mimarlabModal === 'product') ? history.state.depth : pushCountSinceOpen;
    pushCountSinceOpen = currentDepth + 1;
    history.pushState({ mimarlabModal: 'product', slug, depth: pushCountSinceOpen }, '', `/urun/${encodeURIComponent(slug)}`);
    const mySeq = ++requestSeq;
    const item = await fetchItem(slug);
    if (mySeq !== requestSeq || currentSlug !== slug) return;
    if (!item) { renderNotFound(); return; }
    await renderItem(item, slug);
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
      const item = await fetchItem(slug);
      if (mySeq !== requestSeq || currentSlug !== slug) return;
      if (!item) { renderNotFound(); return; }
      await renderItem(item, slug);
    })();
  }

  function isOpen() { return ModalShell.isOpen(); }
  function getCurrentSlug() { return currentSlug; }

  return { open, swap, close, handlePopState, isOpen, getCurrentSlug };
})();
