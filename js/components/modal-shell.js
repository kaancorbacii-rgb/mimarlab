// Paylaşılan, içerikten bağımsız modal "çerçevesi": overlay + panel DOM'u, role="dialog"/
// aria-modal, klavye focus trap'i, arka plan scroll kilidi (+ tam piksel konumuna geri dönüş),
// Escape/backdrop tıklaması ile kapatma isteği. Proje modalı (bkz. js/components/project-modal.js)
// bunun üzerine kurulur; ileride Ürün/Mimar/Firma detay modalları da AYNI çerçeveyi kullanabilsin
// diye bu dosya projelere özgü hiçbir şey bilmez — save-widget.js/rating-widget.js ile aynı desen,
// her sayfada <script src="js/components/modal-shell.js"> ile dahil edilir ve global `ModalShell`
// nesnesini dışa verir.
const ModalShell = (function () {
  // Tarayıcının kendi otomatik scroll-restoration'ı (history.scrollRestoration='auto', varsayılan)
  // close()'daki history.go(-N)/pushState sonrası fırlayan popstate'te KENDİ scroll konumu tahminini
  // uygulamaya çalışıyor — bu, unlockBodyScroll()'un aşağıdaki MANUEL geri yükleme ile aynı ana denk
  // gelip (bkz. kullanıcı isteği: piksel-hassas geri dönüş) bazı tarayıcılarda çift/yarışan bir scroll
  // sıçramasına yol açıyordu. Manuel moda geçince tarayıcı hiç karışmıyor, tek kaynak biz oluyoruz.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  let overlayEl = null;
  let panelEl = null;
  let bodyEl = null;
  let closeButtonEl = null;
  let triggerEl = null;
  let onRequestClose = null;
  let savedScrollY = 0;
  let opened = false;
  let pageHeadingEl = null;
  let pendingGoBack = null; // bkz. goBackAndWait/waitForPendingNav
  let pendingGoBackSuperseded = false; // bkz. waitForPendingNav/wasCurrentPopSuperseded
  let contentOwner = null; // bkz. claimContent — panelleri en son hangi modal (auth/office/architect/project/product) doldurdu
  let ssrDefaults = null; // bkz. setSsrDefaults/resetSsrEntity — sayfa kendi jenerik liste meta'sını burada bir kez kaydeder
  // gerçek bulgu (denetim, 2026-08-16): setupOneGridScrollArrows() her .related-grid-scroll/
  // .catalog-grid-scroll elemanına bir ResizeObserver + bir MutationObserver bağlıyordu ama hiçbiri
  // asla disconnect() edilmiyordu. claimContent() sahip DEĞİŞTİĞİNDE (ör. proje popup'ından firma
  // popup'ına geçiş) eski grid'leri innerHTML='' ile DOM'dan koparıyor — observer'lar artık kopuk bir
  // elemente bağlı, hiçbir zaman GC edilemeyen canlı nesneler olarak sonsuza kadar birikiyordu. Bu
  // dizi, o modalın ömrü boyunca oluşturulan TÜM observer'ları tutar; sahip değiştiğinde hepsi
  // disconnect edilip dizi sıfırlanır (bkz. claimContent).
  let gridObservers = [];

  function injectStyles() {
    if (document.getElementById('modal-shell-styles')) return;
    const style = document.createElement('style');
    style.id = 'modal-shell-styles';
    // CSS özel değişkenleri (--ink, --paper-card, --line vb.) her sayfanın kendi :root'unda zaten
    // tanımlı (bkz. proje.html) — burada yeniden tanımlamaya gerek yok, cascade zaten çözer.
    style.textContent = `
      /* Motion/radius token'ları (bkz. kullanıcı isteği: Design Token katmanı) — bu dosya proje/mimar/
         firma/ürün modallarının HEPSİ tarafından paylaşıldığından, popup'larda tekrar eden süre/easing/
         köşe değerleri için TEK kaynak burası; sayfaların kendi :root'unu değiştirmeye gerek kalmaz. */
      :root{
        --motion-fast:150ms; --motion-normal:300ms; --motion-slow:450ms;
        --ease-standard:cubic-bezier(0.4, 0, 0.2, 1);
        --ease-emphasized:cubic-bezier(0.16, 1, 0.3, 1);
      }
      .modal-shell-overlay{
        display:flex; position:fixed; inset:0; z-index:150;
        background:rgba(27,42,61,0.42); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
        align-items:center; justify-content:center; padding:16px;
        /* iOS Safari'nin adres çubuğu/alt gezinme çubuğu kaydırma sırasında açılıp kapandığından
           safe-area-inset'ler bu boşlukların ÜSTÜNE eklenir (bkz. kullanıcı isteği) — aksi halde
           çentik/home-indicator bölgesi 16px'lik payı yiyip blurlu overlay'i tamamen kapatabiliyordu.
           env() desteklenmeyen tarayıcılarda ikinci argüman (0px) devreye girer, davranış değişmez. */
        padding-top:calc(16px + env(safe-area-inset-top, 0px));
        padding-bottom:calc(16px + env(safe-area-inset-bottom, 0px));
        opacity:0; visibility:hidden; pointer-events:none;
        transition:opacity var(--motion-normal) var(--ease-standard), visibility 0s linear var(--motion-normal);
      }
      /* Gece modunda hem sayfa arkaplanı hem panel zaten koyu olduğundan aynı koyu overlay
         (rgba(27,42,61,...)) ikisini birbirinden ayırt edilemez kılıyordu (bkz. kullanıcı isteği:
         "pop-up olduğu belli olmuyor") — panel her zaman --paper-card kadar koyu kalacağından,
         daha AÇIK renkli bir örtü kontrastı geri getirir. */
      [data-theme="dark"] .modal-shell-overlay{background:rgba(255,255,255,0.16);}
      /* display:none/flex ile anlık açılıp kapanıyordu — opacity/transform GEÇİŞ ALAMAZ, tarayıcı
         display değişimini hiçbir ara kare olmadan uygular (bkz. kullanıcı isteği: yumuşak
         büyüme/belirme animasyonu). Bunun yerine overlay HER ZAMAN display:flex kalır, kapalıyken
         opacity:0 + visibility:hidden + pointer-events:none ile görünmez/etkileşimsiz tutulur —
         .open eklendiğinde opacity 1'e geçiş yapar, visibility'nin kendisi anlık değişir ama
         transition-delay sayesinde opacity geçişi bitene kadar (kapanışta) hidden'a geçmez. */
      .modal-shell-overlay.open{
        opacity:1; visibility:visible; pointer-events:auto;
        transition:opacity var(--motion-normal) var(--ease-standard);
      }
      /* gerçek bulgu: height:92vh TEK BAŞINA mobil/tablette bazı tarayıcılarda (adres çubuğunun
         100vh hesabına dahil olup olmamasına göre) panelin üst/alt kenara neredeyse yapışmış
         görünmesine yol açıyordu — max-height burada height'ın ÜZERİNE ek bir güvenlik tavanı
         olarak eklenir: viewport nasıl hesaplanırsa hesaplansın panel asla üstten/alttan
         16px'ten (overlay padding'i) daha yakına giremez. */
      .modal-shell-panel{
        position:relative; width:95vw; height:92vh; max-height:calc(100vh - 32px); max-width:1440px;
        background:var(--paper-card); border-radius:var(--radius-xl, 20px); box-shadow:0 24px 60px rgba(27,42,61,0.28);
        overflow:hidden; display:flex; flex-direction:column;
        opacity:0; transform:scale(0.95);
        transition:transform var(--motion-normal) var(--ease-emphasized), opacity var(--motion-normal) var(--ease-standard);
      }
      /* dvh (dynamic viewport height) — iOS Safari'de vh, adres çubuğu GİZLİYMİŞ gibi en büyük
         viewport'a göre sabitlenir; adres çubuğu görünür olduğunda gerçek görünür alan bundan
         küçük kalır ve panel üst/alttan taşıp overlay'in blurlu boşluğunu yutar (bkz. kullanıcı
         isteği). dvh, gerçek/o anki görünür yüksekliği takip eder — @supports ile eski
         tarayıcılarda yukarıdaki vh/32px sabit değerine sorunsuz düşülür. max-height'tan
         safe-area-inset'ler de çıkarılır ki overlay'in üstteki padding artışıyla (bkz. yukarısı)
         aynı toplam boşluk her zaman en az %4/16px olarak korunsun. */
      @supports (height: 100dvh) {
        .modal-shell-panel{
          height:92dvh;
          max-height:calc(100dvh - 32px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
        }
      }
      .modal-shell-overlay.open .modal-shell-panel{opacity:1; transform:scale(1);}
      /* Kapatma (X) butonu + içerik aksiyonları (Kaydet/Paylaş/Takip Et) — proje/mimar/firma/ürün
         modallarının HEPSİ tarafından paylaşılan tek bir header satırı (bkz. kullanıcı isteği:
         aksiyon butonları X'in yanına taşınsın). Her modal kendi butonlarını
         ModalShell.getHeaderActionsSlot() üzerinden buraya yazar; X'in kendisi artık kendi başına
         absolute değil, bu satırın bir flex öğesi. Düzenle/Arşivle/Sil (admin/sahip aksiyonları)
         ARTIK burada değil — aynı satırın KARŞI kenarında, ayrı bir .modal-shell-admin-header'da
         (bkz. aşağısı, kullanıcı isteği: içerik aksiyonları X'in yanına taşınınca admin butonları
         satırın diğer kenarına, medyanın üzerine binse bile). */
      .modal-shell-header{
        position:absolute; top:16px; left:32px; z-index:5;
        display:flex; flex-direction:row; flex-wrap:nowrap; align-items:center;
        gap:8px; max-width:calc(100% - 64px);
      }
      /* Admin/sahip aksiyonları (Düzenle/Arşivle/Sil) — X'in KARŞI kenarında, AYNI satırda (top:16px).
         row-reverse: DOM sırası Düzenle→Arşivle→Sil (bkz. proje-actions.js/product-modal.js/
         claim-correction-box.js — üçü de bu sırayla yazıyor), ilk DOM çocuğu row-reverse'de main-start'a
         (bu kenarın kendisine, right:32px) yerleşir — yani Düzenle kenara EN YAKIN, Sil merkeze en
         yakın durur (bkz. kullanıcı isteği: "kenara en yakın sıralama düzenle, arşivle, sil"). */
      .modal-shell-admin-header{
        position:absolute; top:16px; right:32px; z-index:5;
        display:flex; align-items:center; max-width:calc(100% - 64px);
      }
      .modal-shell-close{
        flex:0 0 auto;
        width:36px; height:36px; border-radius:50%; border:none;
        background:var(--paper-card); color:var(--ink); box-shadow:0 4px 12px rgba(27,42,61,0.18);
        display:flex; align-items:center; justify-content:center;
      }
      .modal-shell-close:hover{background:var(--paper-alt);}
      /* gerçek bulgu (kullanıcı isteği, 2026-08-30): X ile ilk aksiyon butonu arasındaki boşluk
         .modal-shell-header'ın KENDİ gap'inden (8px), aksiyon butonlarının BİRBİRİYLE arasındaki
         boşluk ise BURADAKİ ayrı gap'ten (eskiden 6px) geliyordu — iki farklı flex bağlamı farklı
         gap değeri taşıdığından X↔Kaydet ile Kaydet↔Paylaş↔Puanla arası mesafeler eşit değildi.
         Tüm butonlar arası boşluk EŞİT olsun diye burası da .modal-shell-header'ın 8px'iyle
         AYNI değere getirildi (mobil karşılığı da aşağıda @media içinde 6px'e eşitlenir). */
      .modal-shell-header-actions{
        display:flex; flex-direction:row; flex-wrap:nowrap; align-items:center; gap:8px; min-width:0;
      }
      .modal-shell-header-actions:empty{display:none;}
      .modal-shell-admin-actions{
        display:flex; flex-direction:row-reverse; flex-wrap:nowrap; align-items:center; gap:6px; min-width:0;
      }
      .modal-shell-admin-actions:empty{display:none;}
      /* Her modal dosyası kendi butonlarını (bazen owner/admin durumuna göre async doldurulan) boş bir
         <span id="..."> sarmalayıcının İÇİNE yazıyor — bkz. proje-actions.js/claim-correction-box.js/
         product-modal.js. Sıradan bir <span> flex katılımcısı OLMADIĞINDAN (bkz. office-modal.js/
         architect-modal.js'teki AYNI gerçek bulgu), display:contents span'i kutu modelinden çıkarır,
         çocuklarını doğrudan bu satırın flex öğesi yapar. :not(.share-widget) — gerçek bulgu (code
         review): share-button.js#html() ürettiği <span class="share-widget"> artık (Kaydet/Paylaş
         header'a taşındığından) BU satırın DOĞRUDAN çocuğu; o span'in KENDİ position:relative'i
         .share-popover/.share-toast'un position:absolute çapası — display:contents o kutuyu
         KALDIRIP popover'ı bir üstteki konumlanmış atadan (.modal-shell-header, header'ın SOL ÜST
         köşesi) referans almaya zorluyordu, Paylaş'a tıklanınca popover X/Kaydet'in üzerine
         bindiriliyordu. .share-widget bu genel kuraldan HARİÇ tutulur, kendi kutusunu (dolayısıyla
         position:relative çapasını) korur — flex katılımı zaten kendi display:inline-flex
         tanımından (share-button.js) geliyor, display:contents'e ihtiyacı yok. */
      .modal-shell-header-actions > span:not(.share-widget),
      .modal-shell-admin-actions > span:not(.share-widget){display:contents;}
      .modal-shell-header-actions a, .modal-shell-header-actions button,
      .modal-shell-admin-actions a, .modal-shell-admin-actions button{
        flex:0 0 auto; display:inline-flex; align-items:center; gap:5px;
        height:36px; box-sizing:border-box; white-space:nowrap;
        border-radius:100px; padding:0 14px; font-size:12.5px; font-weight:600;
        font-family:inherit; text-decoration:none; box-shadow:0 4px 12px rgba(27,42,61,0.12);
      }
      /* Sayfaların KENDİ .card-edit-btn/.card-delete-btn/.profile-edit-btn kuralları (kart bağlamı
         için tamamen farklı boyut/görünüm taşıyabilir, bkz. urun.html'deki altçizgili metin varyantı)
         burada ele geçirilmesin diye header bağlamı ID yerine bu sınıfla kapsamlanır — özgüllüğü
         (0,2,0) her sayfanın kendi bare .card-edit-btn (0,1,0) kuralından her zaman yüksektir. */
      .modal-shell-admin-actions .card-edit-btn, .modal-shell-admin-actions .profile-edit-btn{
        background:var(--paper-card); border:1px solid var(--line); color:var(--walnut);
      }
      .modal-shell-admin-actions .card-edit-btn:hover, .modal-shell-admin-actions .profile-edit-btn:hover{
        border-color:var(--walnut); background:var(--paper-alt);
      }
      .modal-shell-admin-actions .card-delete-btn{
        background:var(--paper-card); border:1px solid rgba(184,76,76,0.4); color:#B84C4C;
      }
      .modal-shell-admin-actions .card-delete-btn:hover{background:rgba(184,76,76,0.08);}
      /* İçerik aksiyonları (Kaydet/Paylaş/Takip Et) — X ile BİREBİR aynı 36px yükseklikte olmalı (bkz.
         kullanıcı isteği). Bu butonların kendi kart/satır bağlamlarında (proje kartı, mobil dokunma
         hedefi vb.) FARKLI yükseklikleri (32px/48px) olabildiğinden, TEK doğru kaynak burasıdır — hem
         (0,2,0)/(0,3,0) özgüllüğü hem !important, her breakpoint'teki bare/scoped !important
         kurallarının hepsini ezer. Kaydet header'da METİNSİZ (bkz. kullanıcı isteği: "sadece iconla") —
         .save-btn-label metinleri ve .save-btn-count burada gizlenir, kutu Paylaş'la (.share-btn)
         AYNI kare/pill ikon-only görünüme döner. */
      .modal-shell-header-actions .save-btn,
      .modal-shell-header-actions .share-btn,
      .modal-shell-header-actions .follow-btn{
        height:36px !important;
      }
      .modal-shell-header-actions .save-btn.card-save-btn,
      .modal-shell-header-actions .share-btn{
        width:36px !important; min-width:36px !important; padding:0 !important; justify-content:center;
      }
      /* .card-save-btn'in KART bağlamındaki (proje.html/urun.html'deki bare kural) position:absolute;
         top/right; z-index tanımı, buradaki .save-btn ile PAYLAŞILMAYAN tek özellikler olduğundan
         (bkz. kullanıcı isteği) kaynak sırasından bağımsız olarak hep kazanıyordu — Kaydet artık kart
         değil header bağlamında olduğundan normal akışa döndürülür (proje.html#.pm-rating-save-row
         .card-save-btn'in ESKİ görevinin AYNISI, yalnızca yeni konuma taşındı). */
      .modal-shell-header-actions .save-btn.card-save-btn{
        position:static; top:auto; right:auto; z-index:auto;
      }
      /* gerçek bulgu (code review): proje.html/en-iyi-100.html'de HÂLÂ duran
         ".save-btn.saved .save-btn-label-saved{display:inline;}" kuralı (0,3,0) bu gizleme kuralından
         (aşağıda, !important OLMADAN 0,2,0) daha özgül olduğundan, Kaydet butonu tıklanıp .saved
         sınıfı eklendiğinde "Kaydedildi" yazısı ikon-only kutunun içinde tekrar görünür oluyordu —
         !important eklenip özgüllük farkı ne olursa olsun kazanması sağlanır. */
      .modal-shell-header-actions .save-btn-label-default,
      .modal-shell-header-actions .save-btn-label-saved,
      .modal-shell-header-actions .save-btn-count{display:none !important;}
      /* gerçek bulgu (code review): proje.html/en-iyi-100.html'in ".pm-rating-save-row
         .card-save-btn.saved{background:var(--ink);...}" kuralı ve product-modal.js'in eşdeğeri
         Kaydet bu satırlardan header'a taşınınca silindi — kaydedilmiş durumdaki koyu/ink rengi artık
         hiçbir yerde tanımlı değildi, buton yalnızca proje.html'in KART bağlamı ".card-save-btn.saved"
         kuralından (farklı, --accent renkli) miras alıyordu. Header bağlamı için doğru "saved" rengi
         burada yeniden tanımlanır. */
      .modal-shell-header-actions .save-btn.card-save-btn.saved{
        background:var(--ink); color:var(--paper-card); border-color:var(--ink);
      }
      .modal-shell-header-actions .save-btn.card-save-btn.saved:hover{background:var(--ink);}
      /* Puanla — X/Kaydet/Paylaş'ın EN DIŞINDA (bkz. kullanıcı isteği: "Puanla'yı da üste al, en dış
         tarafa, yan yana") — project-modal.js/product-modal.js her ikisi de kendi .rating-widget
         butonunu ProjectActions.render()/Kaydet+Paylaş'tan SONRA headerActions'a ekler, DOM sırası
         zaten X→Kaydet→Paylaş→Puanla. Kaydet'in aksine Puanla METNİNİ KORUR ("Puanla" yazısı
         gizlenmez, bkz. kullanıcı isteği — yalnızca Kaydet ikon-only olacaktı), bu yüzden yalnızca
         yükseklik zorlanır, genişlik/padding proje.html/product-modal.js'in kendi pill tanımından
         (Takip Et ile AYNI mantık) gelir. */
      .modal-shell-header-actions .rating-widget{height:36px !important;}
      .modal-shell-body{
        flex:1; min-height:0; overflow-y:auto;
        display:grid; grid-template-columns:32% 68%;
      }
      .modal-shell-left{
        position:sticky; top:0; align-self:start;
        padding:64px 32px 32px; border-right:1px solid var(--line-soft);
      }
      .modal-shell-right{padding:32px 32px 48px; min-width:0;}
      @media (max-width:860px){
        /* Panel kenarlarda hala %92-95 genişlik/yükseklik bırakır (bkz. kullanıcı isteği: mobil/
           tablette de blurlu overlay alanı görünsün, panel ekranın kenarlarına yapışmasın) — eski
           tam ekran (100vw/100vh, radius:0, padding:0) geçersiz kılması KALDIRILDI, üstteki temel
           kurallar (width:95vw; height:92vh; border-radius:20px) tüm kırılma noktalarında geçerli.
        */
        .modal-shell-panel{border-radius:var(--radius-lg, 16px);}
        /* header satırı (X + Kaydet/Paylaş/Takip Et) masaüstünde sol üstte (bkz. yukarısı left:32px)
           ama mobil/tablette sağ üste taşınır (bkz. kullanıcı isteği: X her zaman sağ üstte olmalı,
           tek elle erişim/alışılmış konum) — left:auto ile masaüstü değerini iptal edip right ile
           konumlandırıyoruz. Mobil/tablette ayrıca sıra TERSİNE çevrilir (bkz. kullanıcı isteği: X en
           sağda, onun hemen solunda içerik aksiyonları) — row-reverse sadece bu satırın iki DOM
           çocuğunu (X, actions-slot) yer değiştirir, actions-slot'un KENDİ içindeki sıra (ayrı bir
           flex context, row) bozulmaz. Masaüstünde sıra DEĞİŞMEZ (X → Kaydet → Paylaş, solda). */
        .modal-shell-header{left:auto; right:16px; gap:6px; flex-direction:row-reverse;}
        .modal-shell-header-actions{gap:6px;}
        .modal-shell-header-actions a, .modal-shell-header-actions button{padding:0 10px; font-size:11.5px;}
        /* Admin/sahip aksiyonları — X'in KARŞI kenarı mobilde de değişmez: X sağda olduğundan burası
           SOLA taşınır (bkz. kullanıcı isteği). flex-direction row (reverse DEĞİL): ilk DOM çocuğu
           (Düzenle) main-start'a, yani container'ın SOL kenarına yerleşir — kenara en yakın buton
           yine Düzenle olur (bkz. yukarısı .modal-shell-admin-header'daki AYNI gerekçe, kenar
           değiştiği için yön de değişir). */
        .modal-shell-admin-header{right:auto; left:16px;}
        .modal-shell-admin-actions{flex-direction:row; gap:4px;}
        .modal-shell-admin-actions a, .modal-shell-admin-actions button{padding:0 10px; font-size:11.5px;}
        /* padding-top: kapatma (X) butonu panele position:absolute (top:16px, height:36px) — içerik
           kaydırma öncesi tam bu bölgenin ALTINDA başlamazsa başlık/görseller X ile çakışıyordu (bkz.
           kullanıcı isteği). 16+36=52px'lik buton alanına en az 16-24px pay eklenir. */
        .modal-shell-body{grid-template-columns:1fr; display:flex; flex-direction:column; padding:72px 18px 28px;}
        /* display:contents: sol/sağ panel kapsayıcıları kendi kutularını üretmez, çocukları
           doğrudan .modal-shell-body'nin flex bağlamına katılır — böylece proje.html'in kendi CSS'i
           (bkz. #pm-* id'lerine order ataması) galeri/başlık/aksiyon/künye/yorum/carousel'leri TEK
           bir dikey akışta istenen sırayla (galeri en üstte) yeniden dizebilir; iki panel artık
           birbirinden bağımsız iki blok olarak DEĞİL, tek bir listenin parçaları olarak davranır. */
        .modal-shell-left, .modal-shell-right{display:contents;}
      }
      /* .related-grid-scroll/.catalog-grid-scroll carousel'lerine (proje/mimar/firma/ürün modallarında
         tekrar eden aynı sınıflar) sağ/sol gezinme okları — bkz. kullanıcı isteği. Tek paylaşılan
         sarmalayıcı+ok stili burada, wireGridScrollArrows() ile birlikte tanımlanır ki dört modal
         dosyası da kendi CSS/JS'ini tekrarlamasın. */
      .grid-scroll-wrap{ position:relative; }
      .grid-scroll-arrow{
        position:absolute; top:50%; transform:translateY(-50%); z-index:2;
        width:36px; height:36px; border-radius:50%; border:1px solid var(--line);
        background:var(--paper-card); box-shadow:0 4px 12px rgba(27,42,61,0.12);
        display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--ink);
        transition:background .15s ease;
      }
      .grid-scroll-arrow:hover{ background:var(--paper); }
      .grid-scroll-arrow.prev{ left:-4px; }
      .grid-scroll-arrow.next{ right:-4px; }
      .grid-scroll-arrow[hidden]{ display:none; }
      @media (max-width:860px){ .grid-scroll-arrow{ width:30px; height:30px; } }
    `;
    document.head.appendChild(style);
  }

  // .related-grid-scroll/.catalog-grid-scroll içeren tüm yatay şeritlere sol/sağ ok butonu ekler —
  // proje/mimar/firma/ürün modalları içerik mount edildikten SONRA bunu kendi root'larıyla (genelde
  // rightPanelEl) çağırır. Idempotent (aynı elemente iki kez sarılmaz) ve MutationObserver ile
  // async fetch sonrası yeniden doldurulan grid'lerde de kendini otomatik günceller (ekstra çağrıya
  // gerek yok — bkz. kullanıcı isteği: içerik asenkron geldiğinde de oklar doğru çalışmalı).
  function wireGridScrollArrows(root) {
    if (!root) return;
    root.querySelectorAll('.related-grid-scroll, .catalog-grid-scroll').forEach(setupOneGridScrollArrows);
  }

  function setupOneGridScrollArrows(el) {
    if (el.dataset.arrowsWired) return;
    el.dataset.arrowsWired = '1';
    const wrap = document.createElement('div');
    wrap.className = 'grid-scroll-wrap';
    el.parentNode.insertBefore(wrap, el);
    wrap.appendChild(el);
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button'; prevBtn.className = 'grid-scroll-arrow prev'; prevBtn.setAttribute('aria-label', 'Geri');
    prevBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>';
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button'; nextBtn.className = 'grid-scroll-arrow next'; nextBtn.setAttribute('aria-label', 'İleri');
    nextBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>';
    wrap.appendChild(prevBtn); wrap.appendChild(nextBtn);

    const step = () => Math.max(el.clientWidth * 0.8, 200);
    prevBtn.addEventListener('click', () => el.scrollBy({ left: -step(), behavior: 'smooth' }));
    nextBtn.addEventListener('click', () => el.scrollBy({ left: step(), behavior: 'smooth' }));

    function update() {
      const overflow = el.scrollWidth > el.clientWidth + 4;
      prevBtn.hidden = !overflow || el.scrollLeft <= 4;
      nextBtn.hidden = !overflow || el.scrollLeft >= el.scrollWidth - el.clientWidth - 4;
    }
    el.addEventListener('scroll', update, { passive: true });
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(update);
      ro.observe(el);
      gridObservers.push(ro);
    }
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true });
    gridObservers.push(mo);
    update();
  }

  // bkz. yukarısı #gridObservers — sahip değişirken (claimContent) veya modal tamamen kapanırken
  // (close) eski grid'lere bağlı observer'ları temizler, aksi halde koptukları DOM'u sonsuza kadar
  // referanslı tutup GC'yi engellerler.
  function disconnectGridObservers() {
    gridObservers.forEach(o => o.disconnect());
    gridObservers = [];
  }

  function ensureDom() {
    if (overlayEl) return;
    injectStyles();
    overlayEl = document.createElement('div');
    overlayEl.id = 'modal-shell-overlay';
    overlayEl.className = 'modal-shell-overlay';
    overlayEl.innerHTML = `
      <div class="modal-shell-panel" role="dialog" aria-modal="true" tabindex="-1">
        <div class="modal-shell-header">
          <button type="button" class="modal-shell-close" aria-label="Kapat">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <div class="modal-shell-header-actions" id="modal-shell-header-actions"></div>
        </div>
        <div class="modal-shell-admin-header">
          <div class="modal-shell-admin-actions" id="modal-shell-admin-actions"></div>
        </div>
        <div class="modal-shell-body">
          <div class="modal-shell-left"></div>
          <div class="modal-shell-right"></div>
        </div>
      </div>`;
    document.body.appendChild(overlayEl);
    panelEl = overlayEl.querySelector('.modal-shell-panel');
    bodyEl = overlayEl.querySelector('.modal-shell-body');
    closeButtonEl = overlayEl.querySelector('.modal-shell-close');

    overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) requestClose(); });
    closeButtonEl.addEventListener('click', () => requestClose());
    document.addEventListener('keydown', onKeydown);

    // Global Overlay Manager (bkz. js/overlay-manager.js) — modal açıkken hamburger/Hesabım/arama/
    // Paylaş gibi diğer paneller altta açık kalmasın diye kaydolur; close() gerçek DOM/scroll/focus
    // temizliğini yaptığından (bkz. yukarısı) salt bir CSS sınıfı silmek yerine BU fonksiyon çağrılır.
    if (typeof OverlayManager !== 'undefined') OverlayManager.register('modal-shell', close);
  }

  function requestClose() {
    if (onRequestClose) onRequestClose();
  }

  function getFocusable() {
    return Array.from(panelEl.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(el => el.offsetParent !== null);
  }

  function onKeydown(e) {
    if (!opened) return;
    if (e.key === 'Escape') { e.stopPropagation(); requestClose(); return; }
    if (e.key !== 'Tab') return;
    const focusable = getFocusable();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function lockBodyScroll() {
    savedScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
  }

  function unlockBodyScroll() {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    // behavior:'instant' (CSS'teki html{scroll-behavior:smooth} kuralını GÖRMEZDEN gelir) — aksi
    // halde animasyonlu kaydırma, hemen ardından gelen popstate/render ile yarışıp konumun tam
    // hedefe ulaşmadan kesilmesine yol açabiliyordu (bkz. kullanıcı isteği: aynı piksele anında dönüş).
    window.scrollTo({ top: savedScrollY, left: 0, behavior: 'instant' });
  }

  // opts.onRequestClose: backdrop/X/Escape tetiklendiğinde çağrılır — DOM'u KENDİSİ kapatmaz,
  // kapatma isteğini çağırana (bkz. ProjectModal.close, önce history/route kararını verir) devreder.
  // Gerçek DOM/scroll/focus temizliği yalnızca close() açıkça çağrıldığında olur.
  function open({ triggerEl: trigger = null, onRequestClose: onClose } = {}) {
    ensureDom();
    triggerEl = trigger;
    onRequestClose = onClose || null;
    if (!opened) {
      // bkz. js/overlay-manager.js — modal açılmadan ÖNCE altta açık kalmış hamburger/Hesabım/arama/
      // Paylaş panelleri kapatılır (bkz. yukarısı #ensureDom'daki register).
      if (typeof OverlayManager !== 'undefined') OverlayManager.notifyOpen('modal-shell');
      lockBodyScroll();
      // Overlay ilk kez ensureDom() ile YENİ oluşturulduysa .open eklemeden önce hiç boyanmamış
      // olur — .open'ı aynı senkron çağrı içinde eklemek tarayıcının geçiş için bir "önce" karesi
      // hiç işlememesine (animasyonun atlanmasına) yol açar. offsetHeight okuması zorla bir reflow
      // tetikleyip kapalı stili taahhüt eder, böylece ilk açılışta da geçiş oynar.
      void overlayEl.offsetHeight;
      overlayEl.classList.add('open');
      opened = true;
      // denetim bulgusu: proje/mimar/firma/urun.html'in altta kalan .page-head h1'i (artık SSR'da
      // gerçek kayıt adını taşıyor, bkz. src/index.js#injectMeta) modal içindeki .detail-title h1 ile
      // aynı anda DOM'da yaşıyordu — ekran okuyucular/JS çalıştıran botlar için iki canlı h1. Modal
      // açıkken altta kalan h1 aria-hidden yapılır, kapanınca geri alınır.
      pageHeadingEl = document.querySelector('.page-head h1');
      if (pageHeadingEl) pageHeadingEl.setAttribute('aria-hidden', 'true');
    }
    closeButtonEl.focus();
    return { leftPanelEl: overlayEl.querySelector('.modal-shell-left'), rightPanelEl: overlayEl.querySelector('.modal-shell-right'), bodyEl, panelEl };
  }

  // gerçek bulgu (kullanıcı isteği: "popup kapatınca bazen bilgiler ekranda kalıyor"): proje/mimar/
  // firma/urun.html sayfaları /proje/:slug gibi bir kayıt yoluyla DOĞRUDAN açıldığında (paylaşılan
  // link, arama sonucu, F5) sunucu <title>/#entity-h1/#ssr-entity-body'yi o kaydın GERÇEK içeriğiyle
  // HTML'e gömer (bkz. src/index.js#injectMeta) — modal bunun ÜSTÜNE bir overlay açar. pushHistory
  // false olan bu "hydration" açılışında close() yalnızca history.pushState ile URL'i /proje'ye
  // geri yazıyordu; sunucunun HTML'e gömdüğü bu üç öğeye hiç dokunmuyordu, çünkü onlar modalın değil
  // sayfanın kendi DOM'unun bir parçası. Sonuç: overlay kapanınca listenin ÜSTÜNDE artık :empty
  // olmayan #ssr-entity-body (CSS'teki .ssr-entity:empty{display:none} artık uygulanmıyor) ve eski
  // kaydın adını taşıyan h1/sekme başlığı kalıcı olarak görünür kalıyordu. setSsrDefaults() ile her
  // sayfa kendi jenerik liste meta'sını BİR KEZ kaydeder; close() burada (dört modal tipinin de TEK
  // ortak kapanış noktası) her kapanışta bu jenerik değerlere sıfırlar — swap()/goBackAndWait ile
  // AYNI tür içinde gezinirken close() hiç çağrılmadığından yanlışlıkla araya girmez.
  function resetSsrEntity() {
    if (!ssrDefaults) return;
    document.title = ssrDefaults.title;
    const h1 = document.querySelector('.page-head h1');
    if (h1) h1.textContent = ssrDefaults.h1;
    const bodyEl2 = document.getElementById('ssr-entity-body');
    if (bodyEl2) bodyEl2.innerHTML = '';
    const setIf = (id, attr, val) => { const el = document.getElementById(id); if (el) el.setAttribute(attr, val); };
    setIf('meta-description', 'content', ssrDefaults.description);
    setIf('canonical-link', 'href', ssrDefaults.canonicalUrl);
    setIf('og-type', 'content', ssrDefaults.ogType || 'website');
    setIf('og-title', 'content', ssrDefaults.title);
    setIf('og-description', 'content', ssrDefaults.description);
    setIf('og-url', 'content', ssrDefaults.canonicalUrl);
    setIf('og-image', 'content', ssrDefaults.image);
    const publishedTimeEl = document.getElementById('og-article-published-time');
    if (publishedTimeEl) publishedTimeEl.setAttribute('content', '');
    setIf('twitter-title', 'content', ssrDefaults.title);
    setIf('twitter-description', 'content', ssrDefaults.description);
    setIf('twitter-image', 'content', ssrDefaults.image);
  }

  function setSsrDefaults(defaults) { ssrDefaults = defaults; }

  function close() {
    if (!opened) return;
    opened = false;
    overlayEl.classList.remove('open');
    unlockBodyScroll();
    if (pageHeadingEl) { pageHeadingEl.removeAttribute('aria-hidden'); pageHeadingEl = null; }
    if (triggerEl && document.contains(triggerEl)) triggerEl.focus();
    triggerEl = null;
    onRequestClose = null;
    resetSsrEntity();
  }

  function isOpen() { return opened; }

  function getPanels() {
    if (!overlayEl) return null;
    return { leftPanelEl: overlayEl.querySelector('.modal-shell-left'), rightPanelEl: overlayEl.querySelector('.modal-shell-right'), bodyEl, panelEl };
  }

  // gerçek bulgu: Hesabım (auth-modal.js) ve proje/mimar/firma/ürün modallarının HEPSİ aynı paylaşılan
  // leftPanelEl/rightPanelEl/bodyEl'i kullanır, ama hiçbiri diğerinin panelleri en son NE zaman/KİM
  // tarafından dolduruldu bilmiyordu — ör. Hesabım açıkken (bodyEl'e .am-single eklenmiş, tek sütun)
  // bir firma linkine tıklanıp OfficeModal.open() tetiklendiğinde, office-modal.js'in kendi
  // `mountedOnce` bayrağı (sayfa ömrü boyunca zaten true) şablonu YENİDEN kurmadan renderItem()'a
  // geçiyor, ama Hesabım'ın en son DOM'u/CSS sınıfı hâlâ panellerde kalmış oluyordu — sonuç: bozuk/
  // dar tek sütun içine yarım render olmuş firma popup'ı (bkz. kullanıcı isteği). claimContent() bu
  // "kim doldurdu" bilgisini TEK yerde (ModalShell) tutar: sahip DEĞİŞTİYSE panelleri boşaltır VE
  // bodyEl'in class listesini temel duruma sıfırlar (am-single gibi modale özgü sınıflar dahil),
  // isNewOwner:true döner ki çağıran modal kendi şablonunu KOŞULSUZ yeniden kursun; aynı modal
  // ardışık slug'lar arasında geçiş yaparken (isNewOwner:false) hiçbir şey silinmez, mevcut hızlı yol
  // (mountedOnce) korunur.
  function claimContent(ownerKey) {
    ensureDom();
    const isNewOwner = ownerKey !== contentOwner;
    if (isNewOwner) {
      contentOwner = ownerKey;
      disconnectGridObservers();
      bodyEl.className = 'modal-shell-body';
      overlayEl.querySelector('.modal-shell-left').innerHTML = '';
      overlayEl.querySelector('.modal-shell-right').innerHTML = '';
      // GERÇEK BULGU (kullanıcı isteği 2026-08-30, İçeriklerim > Mimar/Firma Profilim popup
      // entegrasyonu): sahip değiştiğinde yalnızca sol/sağ panel temizleniyordu — #modal-shell-
      // header-actions/#modal-shell-admin-actions (Paylaş/Takip Et/Düzenle gibi bir ÖNCEKİ sahibin
      // yazdığı butonlar) burada TEMİZLENMEDİĞİNDEN yeni sahip bunları hiç doldurmazsa (ör. Hesabım/
      // İçeriklerim, ArchitectModal/OfficeModal'ın bıraktığı Paylaş/Takip Et butonlarının ÜSTÜNE)
      // eski sahibin butonları X'in yanında GÖRÜNMEYE devam ediyordu.
      const headerActions = overlayEl.querySelector('#modal-shell-header-actions');
      if (headerActions) headerActions.innerHTML = '';
      const adminActions = overlayEl.querySelector('#modal-shell-admin-actions');
      if (adminActions) adminActions.innerHTML = '';
    }
    return {
      leftPanelEl: overlayEl.querySelector('.modal-shell-left'),
      rightPanelEl: overlayEl.querySelector('.modal-shell-right'),
      bodyEl, panelEl, isNewOwner,
    };
  }

  function scrollToTop() { if (bodyEl) bodyEl.scrollTop = 0; }

  // İçerik aksiyonlarının (Kaydet/Paylaş/Takip Et) X'in yanına yazıldığı paylaşılan yuva (bkz.
  // kullanıcı isteği) — proje/mimar/firma/ürün modalları (bkz. js/components/project-actions.js,
  // product-modal.js, office-modal.js, architect-modal.js) kendi butonlarını render ederken bu
  // elementi hedefler; ensureDom() henüz çalışmadıysa (overlay hiç açılmadıysa) null döner.
  function getHeaderActionsSlot() {
    return overlayEl ? overlayEl.querySelector('#modal-shell-header-actions') : null;
  }

  // Düzenle/Arşivle/Sil (admin/sahip) butonlarının yazıldığı yuva — X'in KARŞI kenarında, AYNI
  // satırda (bkz. kullanıcı isteği: içerik aksiyonları X'in yanına taşınınca bu üçü satırın diğer
  // ucuna geçsin). getHeaderActionsSlot() İLE AYNI çağıranlar (bkz. o fonksiyondaki yorum), yalnızca
  // farklı bir DOM hedefi.
  function getAdminActionsSlot() {
    return overlayEl ? overlayEl.querySelector('#modal-shell-admin-actions') : null;
  }

  // denetim bulgusu (2026-08-14): panel role="dialog" aria-modal="true" taşıyor ama aria-label/
  // aria-labelledby hiç yoktu — ekran okuyucu kullanıcıları modal açıldığında sadece "iletişim
  // kutusu" duyuyordu, NE olduğunu değil. Panel içeriği proje/mimar/firma/ürün/auth/info
  // modallarının HER BİRİ tarafından ayrı ayrı doldurulduğundan (bkz. claimContent) ortak bir
  // başlık id'sine bağlamak yerine (altı ayrı dosyanın DOM yapısını koordine etmesi gerekirdi) her
  // modal kendi başlığını (document.title'a yazdığı AYNI okunabilir metni) burada ayarlar —
  // aria-label, aria-labelledby ile aynı işlevi görür ve tek bir string set etmek yeterlidir.
  function setLabel(text) {
    if (!panelEl) return;
    if (text) panelEl.setAttribute('aria-label', text);
    else panelEl.removeAttribute('aria-label');
  }

  // gerçek bulgu: proje/mimar/firma/ürün modallarının close()'u, birden fazla proje gezindikten
  // sonra X/Escape'e basılınca asıl listeye TEK seferde dönmek için history.go(-N) kullanıyor (bkz.
  // o dosyalardaki close() yorumu) — ama history.go() ASENKRON'dur, karşılık gelen popstate hemen
  // değil tarayıcının bir sonraki görev turunda fırlar. Bu pencerede kullanıcı BAŞKA bir modal
  // open()/swap() ile YENİ bir pushState yaparsa (ör. proje.html'de bir ürün modalını kapatıp hemen
  // başka bir projeye geçmek — bu sayfa proje-modal.js VE product-modal.js'i AYNI paylaşılan
  // overlay üzerinde birlikte kullanıyor), geç gelen o popstate işlendiğinde artık güncel olmayan
  // bir navigasyon gibi davranıp az önce açılan modalı eskiye döndürebiliyordu ("bir popup'tan
  // diğerine geçince eski popup tekrar açılıyor", sayfa yenilenince düzeliyordu çünkü modül state'i
  // sıfırlanıyordu). Bu yarış TÜR-bağımsızdır (aynı ya da farklı modal tipleri arasında oluşabilir)
  // çünkü dördü de bu TEK paylaşılan overlay'i kullanır — bu yüzden çözüm de burada, paylaşılan
  // katmanda: goBackAndWait() history.go()'yu tetikler ve karşılık gelen popstate GERÇEKTEN
  // işlenene kadar çözülmeyen bir Promise döner; open()/swap() artık kendi pushState'ini yapmadan
  // ÖNCE waitForPendingNav() ile bekleyen bir go() varsa onu bekler — böylece iki history mutasyonu
  // asla iç içe geçmez.
  function goBackAndWait(steps) {
    if (pendingGoBack) return pendingGoBack; // zaten bekleyen biri var — tekrar tetikleme, ona katıl
    pendingGoBackSuperseded = false;
    pendingGoBack = new Promise((resolve) => {
      window.addEventListener('popstate', () => { pendingGoBack = null; resolve(); }, { once: true });
    });
    history.go(-steps);
    return pendingGoBack;
  }

  // Bir open()/swap() burada GERÇEKTEN bekleyen bir go() bulup ona katıldığında (bkz. yukarısı) bu
  // döngü "superseded" (ele geçirilmiş) işaretlenir — yani sonunda gelecek olan popstate artık
  // kimsenin özgün isteği DEĞİL, önceden kuyruklanmış bir geri-navigasyon kalıntısı; onu tetikleyen
  // handlePopState (bkz. proje/mimar/firma/ürün-modal.js) bu durumda kendi reaktif open()'ını
  // ATLAMALI, aksi halde tam o an render edilmekte olan YENİ (superseded eden) modalın üzerine
  // eskisini yeniden yazar (bkz. goBackAndWait'in dosya başı yorumu — gerçek bulgu).
  function waitForPendingNav() {
    if (pendingGoBack) { pendingGoBackSuperseded = true; return pendingGoBack; }
    return Promise.resolve();
  }

  function wasCurrentPopSuperseded() { return pendingGoBackSuperseded; }

  return { open, close, isOpen, getPanels, claimContent, scrollToTop, wireGridScrollArrows, getHeaderActionsSlot, getAdminActionsSlot, setLabel, goBackAndWait, waitForPendingNav, wasCurrentPopSuperseded, setSsrDefaults };
})();
