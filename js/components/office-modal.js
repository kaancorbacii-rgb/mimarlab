// OfficeModal — firma detay modalının orkestratörü (bkz. js/components/architect-modal.js'teki AYNI
// desen, kendisi js/components/project-modal.js'in open/swap/close/handlePopState state machine'ini
// izler). DOM çerçevesi js/components/modal-shell.js'ten gelir; içerik eskiden ofis-detay.html'in
// kendi sayfası olarak render ettiği her şeyi (kimlik, künye, kurucular/ortaklar, ilgili
// projeler/ürünler/malzemeler, claim/correction kutusu) firma.html'in kartına tıklandığında sayfa
// yenilenmeden açan bir modale taşır. Yorum/puanlama YOK — ofis-detay.html'de de hiç yoktu.
const OfficeModal = (function () {
  // Künye satırı ikonları — js/components/project-meta.js#ICONS İLE AYNI çizim dili (24x24 viewBox,
  // stroke-width 1.6, dolgu yok, bkz. kullanıcı isteği) — firma.html o script'i yüklemediğinden
  // kendi kopyasını taşır (architect-modal.js#META_ICONS İLE AYNI gerekçe).
  const META_ICONS = {
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21.5s7-7.2 7-12.3a7 7 0 1 0-14 0c0 5.1 7 12.3 7 12.3Z"/><circle cx="12" cy="9.2" r="2.4"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.4 2.6 3.8 6 3.8 9s-1.4 6.4-3.8 9c-2.4-2.6-3.8-6-3.8-9s1.4-6.4 3.8-9Z"/></svg>',
  };
  function metaIconHtml(key) { return `<span class="meta-icon">${META_ICONS[key] || ''}</span>`; }
  function metaRow(iconKey, bodyHtml) { return `<div class="meta-row">${metaIconHtml(iconKey)}<span>${bodyHtml}</span></div>`; }
  // architect-modal.js#injectStyles ile BİREBİR aynı ortak sınıflar (.detail-title/.related-*/
  // .save-btn) — firma.html farklı bir sayfa olduğundan proje.html/mimar.html'in <style>'ını miras
  // alamaz, kendi <style>'ını bir kez enjekte eder (görsel bütünlük için AYNI değerler).
  // .card-edit-btn/.card-delete-btn/.profile-edit-btn ARTIK burada değil — Düzenle/Arşivle/Sil
  // modal-shell.js'in paylaşılan header'ında render edilir, TEK stil kaynağı orası (bkz. kullanıcı
  // isteği). .feedback-card/.feedback-input-wrap o dosyanın KENDİ injectStyles()'ında tanımlı (bkz.
  // js/components/claim-correction-box.js).
  function injectStyles() {
    if (document.getElementById('office-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'office-modal-styles';
    style.textContent = `
      .detail-title{font-family:'Inter', sans-serif; font-size:26px; font-weight:700; margin:0; line-height:1.25;}
      .om-identity{display:flex; align-items:center; gap:16px; margin-bottom:18px;}
      .profile-logo{
        width:64px; height:64px; border-radius:50%; flex-shrink:0;
        border:1px solid var(--line); overflow:hidden; position:relative;
        display:flex; align-items:center; justify-content:center;
        background:var(--walnut); color:var(--paper-card);
        font-family:'IBM Plex Mono', monospace; font-weight:600; font-size:20px;
      }
      .profile-logo img{position:absolute; inset:0; width:100%; height:100%; object-fit:contain; background:var(--paper-card);}
      .detail-title-actions{
        display:flex !important; flex-direction:row !important; flex-wrap:nowrap !important;
        align-items:center !important; justify-content:flex-start !important; width:100% !important;
        gap:4px !important; margin:0 0 18px;
      }
      .save-count{font-size:12px; color:var(--ink-soft); white-space:nowrap;}
      /* Düzenle/Arşivle/Sil artık #om-actions'ın İÇİNDE DEĞİL — modal-shell.js'in paylaşılan
         header'ında, X butonunun yanında render edilir (bkz. kullanıcı isteği). Bu yüzden
         .card-edit-btn/.card-delete-btn/.profile-edit-btn ve #profile-edit-slot'un display:contents
         kuralı buradan kaldırıldı; TEK stil kaynağı artık modal-shell.js#injectStyles. */
      /* Yalnızca "Websitesi" tarafından kullanılır — Kaydet KALDIRILDI (bkz. kullanıcı isteği). */
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
      /* Takip Et — bkz. kullanıcı isteği: archello.com/brand/ofist'teki gibi, Websitesi/Paylaş ile
         AYNI yükseklikte bir pil. Yanındaki takipçi sayısı (bkz. kullanıcı isteği) save-widget.js#
         paintFollowBtn tarafından basılır. */
      .follow-btn{
        display:inline-flex; align-items:center; justify-content:center;
        flex-shrink:1 !important; min-width:0 !important; white-space:nowrap !important; overflow:hidden !important; text-overflow:ellipsis;
        height:32px !important; box-sizing:border-box;
        background:var(--paper-card); border:1px solid var(--line); border-radius:100px;
        padding:0 12px !important; font-size:12px !important; font-weight:600; color:var(--ink-soft);
        font-family:inherit; line-height:1;
      }
      .follow-btn:hover{border-color:var(--walnut); color:var(--ink);}
      .follow-btn.following{background:var(--ink); color:var(--paper-card); border-color:var(--ink);}
      .detail-info{margin-top:8px;}
      /* bkz. kullanıcı isteği: profile birden fazla sosyal medya eklenebilsin (firma-ekle.html#social-row) */
      .social-icons{display:flex; gap:12px; margin-top:4px;}
      .social-icons a{color:var(--ink-soft); display:flex;}
      .social-icons a:hover{color:var(--walnut);}
      .detail-meta{font-size:14px; line-height:1.9; margin-top:18px;}
      .detail-meta strong{font-weight:600; color:var(--ink);}
      /* Künye ikonları — js/components/project-meta.js#ICONS İLE AYNI çizim dili/hiza (bkz. kullanıcı
         isteği), hepsi AYNI büyüklükte. */
      .meta-icon{width:16px; height:16px; flex-shrink:0; color:var(--ink-soft);}
      .meta-icon svg{display:block; width:100%; height:100%;}
      .detail-meta .meta-row{display:flex; align-items:flex-start; gap:9px;}
      .detail-meta .meta-row .meta-icon{margin-top:3px;}
      .detail-desc{font-size:15px; line-height:1.7; color:var(--ink); margin-top:18px;}
      .detail-desc-more{background:none; border:none; padding:0; color:var(--walnut); font-weight:600; font-size:14px; text-decoration:underline; text-decoration-color:var(--line); cursor:pointer;}
      .detail-desc-more:hover{color:var(--ink);}
      .detail-info-divider{border:none; border-top:1px solid var(--line-soft); margin:24px 0;}
      .related-section{margin-top:32px; padding-top:28px; border-top:1px solid var(--line);}
      .related-section:first-child{margin-top:0; padding-top:0; border-top:none;}
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
      /* Pop-up içindeki proje/mimar kartlarında tek satır kısıtlaması (bkz. kullanıcı isteği,
         js/components/architect-modal.js#related-card-title-text ile AYNI): uzun başlıklar tek
         satıra sığdığı kadar yazılır, sığmayan kelimeler alt satıra kesinlikle geçmez, satır
         sonuna ellipsis eklenir. */
      .related-card-title-text{display:block !important; white-space:nowrap !important; overflow:hidden !important; text-overflow:ellipsis !important; width:100% !important;}
      /* "Projeler" (bu firmanın kendi eserleri) grid'inde tek-satır+"…" kısıtlaması KALDIRILIR (bkz.
         kullanıcı isteği: "ismi uzun olan mimarın/firmanın diğer yapılarında metinlerindeki üç nokta
         sistemini sil", js/components/architect-modal.js#am-related-projects-grid ile AYNI) —
         yukarıdaki genel kural Kurucular/Ortaklar kartlarında (isim tek satır) aynen kalır, yalnızca
         #om-related-projects-grid'e özel bu override başlığın normal şekilde birden çok satıra
         sarmasına izin verir. */
      #om-related-projects-grid .related-card-title-text{white-space:normal !important; overflow:visible !important; text-overflow:clip !important;}
      .related-card-subtitle{font-size:11px; font-weight:500; color:var(--ink-soft); margin-top:2px;}
      .related-grid-scroll{display:flex; gap:16px; overflow-x:auto; scroll-behavior:smooth; scrollbar-width:none; padding-bottom:4px;}
      .related-grid-scroll::-webkit-scrollbar{display:none;}
      .related-grid-scroll .related-card{flex:0 0 200px;}
      .unregistered-badge{
        display:inline-flex; align-items:center; gap:9px; flex:0 0 auto; align-self:center;
        background:var(--paper-card); border:1px solid var(--line-soft);
        border-radius:100px; padding:6px 16px 6px 6px; cursor:default;
      }
      .unregistered-badge-avatar{
        width:32px; height:32px; border-radius:50%; flex-shrink:0;
        display:flex; align-items:center; justify-content:center;
        color:#fff; font-family:'IBM Plex Mono', monospace; font-weight:600; font-size:11.5px;
      }
      .unregistered-badge-name{font-size:13px; font-weight:600; color:var(--ink);}
      /* Ekip kartları (bkz. kullanıcı isteği: "kurucular/ortaklar kısmının altında bir de Ekip
         kısmı olsun") — .unregistered-badge ile AYNI pasif/tıklanamaz rozet biçimi (bu kişilerin
         kendi profil sayfası yok), yalnızca kullanıcı hesabından geldikleri için (bkz.
         src/routes/office.js#buildOfficePayload) fotoğraf ve pozisyon gösterebilirler. */
      .om-team-avatar{width:32px; height:32px; border-radius:50%; flex-shrink:0; object-fit:cover; background:var(--paper-alt);}
      .om-team-role{display:block; font-size:11px; font-weight:500; color:var(--ink-soft); margin-top:1px;}
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
      @media (max-width:860px){
        .related-grid-scroll .related-card{flex:0 0 140px;}
        .related-grid-scroll{gap:10px;}
        /* mobil/tablette .modal-shell-left/.modal-shell-right display:contents olduğundan (bkz.
           modal-shell.js) tüm doğrudan çocuklar TEK bir dikey flex akışına katılır — claim/geri
           bildirim kutuları burada order:99 ile akışın EN ALTINA (bkz. kullanıcı isteği) taşınır. */
        #claim-info-card, #correction-info-card{order:99;}
        /* :first-child kuralı masaüstünde sağ panelin İLK bölümü olduğu için gerekliydi (üstte
           gereksiz çizgi olmasın) — ama mobilde birleşik akışta "Kurucular / Ortaklar" artık görsel
           olarak ilk değil, hemen üstünde kimlik/künye bölümünün hr.detail-info-divider'ı var (bkz.
           kullanıcı isteği: "Projeler" başlığıyla BİREBİR aynı boşluk). :first-child sıfırlamasını
           burada geri alıp diğer .related-section'larla eşit boşluk/çizgiye döndürür. */
        .related-section:first-child{margin-top:32px; padding-top:28px; border-top:1px solid var(--line);}
        /* related-section:first-child'ın üstteki border-top'u zaten açıklamadan sonra TEK bir çizgi
           oluşturuyor — detail-info-divider (açıklamanın hemen altındaki hr) burada hala görünür
           kalsaydı üst üste 2 çizgi (bkz. kullanıcı isteği: çift çizgi hatası) belirirdi, bu yüzden
           mobil/tablette gizlenir. */
        .detail-info-divider{display:none;}
        /* Önceki/Sonraki butonlarından hemen sonra, claim/geri bildirim kutularından ÖNCE bir ayırıcı
           (bkz. kullanıcı isteği) — masaüstünde prevnext/claim-card iki AYRI panelde olduğundan bu
           çizgiye gerek yok, yalnızca mobil/tablette (birleşik akışta) gösterilir. */
        .prevnext-mobile-divider{display:block; border:none; border-top:1px solid var(--line); margin:24px 0;}
        /* Websitesi — Apple/Google dokunma hedefi standartları (bkz. kullanıcı isteği): pil yüksekliği
           en az 48px, tıklanabilir alan en az 44x44px. "Paylaş" burada scoped bir override taşımadığı
           için share-button.js#injectStyles'daki AYNI kırılma noktasındaki generic .share-btn kuralı
           uygulanır. Satırın tek satırda kalma zorunluluğu (üstteki .detail-title-actions
           flex-wrap:nowrap + flex-shrink:1/min-width:0/overflow:hidden/ellipsis) korunur. */
        .save-btn{height:48px !important; min-height:48px !important; padding:0 14px !important; font-size:13.5px !important;}
        .follow-btn{height:48px !important; min-height:48px !important; padding:0 14px !important; font-size:13.5px !important;}
        .detail-title-actions{gap:8px !important;}
      }
      .prevnext-mobile-divider{display:none;}
      /* Projeler haritası — bkz. js/components/architect-modal.js#injectStyles İLE BİREBİR AYNI
         (kullanıcı isteği: "Projeler"in altına, firmanın koordinatlı TÜM projelerini pinleyen açık
         bir harita) — js/pages/proje.js#loadLeaflet İLE AYNI Leaflet + Esri World Imagery yığını/
         marker popup kartı, bu modül firma.html'de Leaflet YÜKLEMEYEN diğer sayfalardan bağımsız
         kendi yükleyicisini taşır (bkz. aşağıdaki loadOmMapLeaflet). */
      .om-projects-map-wrap{margin-top:16px; border-radius:12px; overflow:hidden; border:1px solid var(--line-soft); height:280px; background:var(--paper-alt);}
      .om-projects-map-wrap .leaflet-container{width:100%; height:100%; background:var(--paper-alt); font-family:inherit;}
      .leaflet-popup.pm-project-popup .leaflet-popup-content-wrapper{padding:0; border-radius:10px; overflow:hidden;}
      .leaflet-popup.pm-project-popup .leaflet-popup-content{margin:0; width:auto !important;}
      .pm-map-marker-card{display:block; text-decoration:none; color:inherit; cursor:pointer;}
      .pm-map-marker-card-photo{width:100%; aspect-ratio:1/1; object-fit:cover; display:block; background:var(--paper-alt);}
      .pm-map-marker-card-placeholder{display:flex; align-items:center; justify-content:center; font-weight:700; font-size:20px; color:#fff; width:100%; aspect-ratio:1/1;}
      .pm-map-marker-card-title{padding:8px 10px; font-size:13px; font-weight:600; color:var(--ink); line-height:1.3;}
      @media (max-width:860px){
        .om-projects-map-wrap{height:220px;}
      }
    `;
    document.head.appendChild(style);
  }

  const LEFT_TEMPLATE = `
    <div class="om-identity">
      <div class="profile-logo" id="om-logo"></div>
      <h1 class="detail-title"><span id="om-name-text"></span><span id="om-verified-badge-wrap"></span></h1>
    </div>
    <div class="detail-title-actions" id="om-actions"></div>
    <div id="om-social-links"></div>
    <div class="detail-info" id="om-detail-info">
      <div id="om-social-icons"></div>
      <div class="detail-meta" id="om-info-facts" style="display:none;"></div>
      <div class="detail-desc" id="om-about"></div>
      <hr class="detail-info-divider">
    </div>
    <details class="feedback-card" id="claim-info-card">
      <summary>Bu firma sana mı ait?<span class="feedback-card-plus" aria-hidden="true"></span></summary>
      <div id="claim-card-body"></div>
    </details>
    <details class="feedback-card" id="correction-info-card">
      <summary>Geri Bildirim<span class="feedback-card-plus" aria-hidden="true"></span></summary>
      <p>Hatalı ya da eksik bir bilgi görüyorsan bize bildir.</p>
      <div id="correction-card-extra"></div>
    </details>`;

  const RIGHT_TEMPLATE = `
    <div class="related-section" id="om-founders-section" style="display:none;">
      <h2 class="related-title">Kurucular / Ortaklar</h2>
      <div class="related-grid-scroll" id="om-founders-grid"></div>
    </div>
    <div class="related-section" id="om-team-section" style="display:none;">
      <h2 class="related-title">Ekip</h2>
      <div class="related-grid-scroll" id="om-team-grid"></div>
    </div>
    <div class="related-section" id="om-related-projects-section" style="display:none;">
      <h2 class="related-title">Projeler<span id="om-related-projects-count"></span></h2>
      <div class="related-grid-scroll" id="om-related-projects-grid"></div>
      <div class="om-projects-map-wrap" id="om-projects-map-wrap" style="display:none;"></div>
    </div>
    <div class="related-section" id="om-related-products-section" style="display:none;">
      <h2 class="related-title">Ürünler<span id="om-related-products-count"></span></h2>
      <div class="related-grid-scroll" id="om-related-products-grid"></div>
    </div>
    <div class="related-section" id="om-related-materials-section" style="display:none;">
      <h2 class="related-title">Ürünler<span id="om-related-materials-count"></span></h2>
      <div class="related-grid-scroll" id="om-related-materials-grid"></div>
    </div>
    <div class="related-section" id="om-city-section" style="display:none;">
      <h2 class="related-title">Şehirdeki Diğer Firmalar</h2>
      <div class="related-grid-scroll" id="om-city-grid"></div>
    </div>
    <div class="prevnext" id="om-prevnext"></div>
    <hr class="prevnext-mobile-divider">`;

  let mountedOnce = false;
  let currentSlug = null;
  let currentItem = null;
  let openedViaPush = false;
  let pushCountSinceOpen = 0;
  let requestSeq = 0;

  // ---------- Projeler haritası — bkz. js/components/architect-modal.js#renderProjectsMap İLE
  // BİREBİR AYNI desen (kullanıcı isteği: "Projeler" bölümünün altına, firmanın koordinatı olan TÜM
  // projelerini pinleyen dinamik bir harita). Veri her renderItem() çağrısında /api/office/:slug'tan
  // (bkz. fetchItem) taze geldiğinden — bir proje bu firmaya eklenip/çıkarıldığında
  // payload.relatedProjects da değişir — harita da otomatik güncellenir.
  let omMapLeafletPromise = null;
  function loadOmMapLeaflet() {
    if (omMapLeafletPromise) return omMapLeafletPromise;
    omMapLeafletPromise = new Promise((resolve, reject) => {
      if (window.L) { resolve(window.L); return; }
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => resolve(window.L);
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return omMapLeafletPromise;
  }
  let omProjectsMap = null;
  let omMapRequestSeq = 0;
  // Marker'a tıklamak burada da (architect-modal.js#renderProjectsMap İLE AYNI gerekçe) doğrudan bir
  // <a href="/proje/..."> linkine gider — ProjectModal firma.html'de hiç yüklenmiyor, o adreste
  // ProjectModal kendi DOMContentLoaded'ında otomatik açılır.
  function renderProjectsMap(projects) {
    const wrap = document.getElementById('om-projects-map-wrap');
    if (!wrap) return;
    const pinned = (projects || []).filter(p => p.lat != null && p.lng != null);
    if (!pinned.length) {
      wrap.style.display = 'none';
      if (omProjectsMap) { try { omProjectsMap.remove(); } catch { /* zaten kopmuş olabilir */ } omProjectsMap = null; }
      return;
    }
    wrap.style.display = '';
    const mySeq = ++omMapRequestSeq;
    loadOmMapLeaflet().then((L) => {
      if (mySeq !== omMapRequestSeq) return; // bu arada başka bir profil açıldı, bu yanıt bayat
      if (omProjectsMap) { try { omProjectsMap.remove(); } catch { /* zaten kopmuş olabilir */ } omProjectsMap = null; }
      wrap.innerHTML = '';
      const inner = document.createElement('div');
      inner.style.width = '100%';
      inner.style.height = '100%';
      wrap.appendChild(inner);
      const map = L.map(inner, { attributionControl: false }).setView([39.0, 35.0], 6);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri', maxZoom: 19 }).addTo(map);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(map);
      const markers = pinned.map(p => {
        const marker = L.marker([p.lat, p.lng], { title: p.title }).addTo(map);
        const cardImg = p.images && p.images[0];
        const photoHtml = cardImg
          ? `<img class="pm-map-marker-card-photo" src="${escapeAttr(cdnImg(cardImg, 300))}" alt="${escapeAttr(p.title)}">`
          : `<div class="pm-map-marker-card-photo pm-map-marker-card-placeholder" style="background:${officeColor(p.title)}">${escapeHtml(initials(p.title))}</div>`;
        marker.bindPopup(`<a class="pm-map-marker-card" href="/proje/${encodeURIComponent(p.slug)}">${photoHtml}<div class="pm-map-marker-card-title">${escapeHtml(p.title)}</div></a>`, { minWidth: 160, maxWidth: 200, className: 'pm-project-popup' });
        return marker;
      });
      omProjectsMap = map;
      // bkz. architect-modal.js#renderProjectsMap İLE AYNI gerekçe: bu ekranda daima o firmanın TÜM
      // projeleri (sayfalanmadan) birlikte gösterilir, bu yüzden harita pinlerin kapsadığı alana
      // fitBounds ile odaklanır.
      if (markers.length === 1) map.setView(markers[0].getLatLng(), 14);
      else map.fitBounds(L.featureGroup(markers).getBounds(), { padding: [24, 24], maxZoom: 14 });
      setTimeout(() => map.invalidateSize(), 0);
    });
  }

  // bkz. js/components/modal-shell.js#claimContent — paneller EN SON bu modal (office) tarafından
  // doldurulmadıysa (ör. araya Hesabım/başka bir detay modalı girdiyse) isNewOwner:true döner ve
  // panelleri zaten boşaltmış olur; bu durumda mountedOnce true olsa bile şablon KOŞULSUZ yeniden
  // kurulur, aksi halde renderItem() var olmayan (silinmiş) om-* id'lerine yazmaya çalışıp bozuk/
  // yarım bir popup üretiyordu (gerçek bulgu).
  function ensureTemplate() {
    const panels = ModalShell.claimContent('office');
    if (mountedOnce && !panels.isNewOwner) return;
    // bkz. architect-modal.js#ensureTemplate İLE AYNI gerekçe — şablon sıfırdan kuruluyorsa
    // #om-projects-map-wrap düğümü de bu innerHTML atamasıyla birlikte kopacak, eski Leaflet map
    // instance'ı burada bırakmadan temizlenir.
    if (omProjectsMap) { try { omProjectsMap.remove(); } catch { /* zaten kopmuş olabilir */ } omProjectsMap = null; }
    panels.leftPanelEl.innerHTML = LEFT_TEMPLATE;
    panels.rightPanelEl.innerHTML = RIGHT_TEMPLATE;
    ModalShell.wireGridScrollArrows(panels.rightPanelEl);
    mountedOnce = true;
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

  // badgeHtml: yalnızca kurucu/ortak kartlarında geçilir (bkz. kullanıcı isteği: mavi onay rozetinin
  // ilişkili TÜM alanlarda görünmesi) — proje/ürün/malzeme kartlarında rozet anlamsız olduğundan
  // çağıranlar orada bu parametreyi hiç geçmez.
  function cardHtml(href, title, image, subtitle, badgeHtml) {
    const srcset = image ? cdnSrcset(image, [300, 450, 600]) : '';
    return `<a class="related-card" href="${href}">
      <div class="related-card-photo">
        ${image ? `<img src="${escapeAttr(cdnImg(image, 450))}"${srcset ? ` srcset="${escapeAttr(srcset)}" sizes="300px"` : ''} alt="${escapeAttr(title)}" loading="lazy" decoding="async">` : `<div class="related-card-placeholder" style="background:${officeColor(title)}">${escapeHtml(initials(title))}</div>`}
      </div>
      <div class="related-card-title"><span class="related-card-title-text">${escapeHtml(title)}${badgeHtml || ''}</span>${subtitle ? `<div class="related-card-subtitle">${escapeHtml(subtitle)}</div>` : ''}</div>
    </a>`;
  }

  // js/components/architect-modal.js#deferToIdle ile BİREBİR aynı (bkz. o dosyadaki dosya başı
  // yorum) — loadRelatedProducts() modal açılışında hemen çekiliyordu, ilk boyamayla yarışan
  // gereksiz bir istekti (denetim bulgusu, 2026-08-24).
  function deferToIdle(fn, timeoutMs) {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: timeoutMs });
    else setTimeout(fn, timeoutMs);
  }

  // Kurucular kutusuna yazılmış ama architects tablosunda karşılığı olmayan (bkz.
  // src/routes/office.js#fetchRawFounderNames, `unregistered: true`) isimler — tıklanabilir bir
  // profil kartı DEĞİL, yuvarlak baş harfli pasif bir rozet (bkz. kullanıcı isteği).
  function unregisteredBadgeHtml(name) {
    return `<span class="unregistered-badge" aria-disabled="true">
      <span class="unregistered-badge-avatar" style="background:${officeColor(name)}">${escapeHtml(initials(name))}</span>
      <span class="unregistered-badge-name">${escapeHtml(name)}</span>
    </span>`;
  }

  // Ekip kartları — bkz. kullanıcı isteği: "Pozisyon ile firma danışıklı çalışan bir sistem olmalı".
  // Onaylı bir profile_claims('office') sahibi olup pozisyonu Kurucu/Kurucu Ortak OLMAYAN kullanıcılar
  // (bkz. src/routes/office.js#buildOfficePayload `team`) — bunların kendi profil sayfası yok, bu
  // yüzden unregisteredBadgeHtml ile AYNI pasif rozet biçimi, yalnızca hesap fotoğrafı + pozisyonu
  // (varsa) eklenmiş haliyle.
  function teamBadgeHtml(person) {
    const avatar = person.photo
      ? `<img class="om-team-avatar" src="${escapeAttr(cdnImg(person.photo, 64))}" alt="" loading="lazy" decoding="async">`
      : `<span class="unregistered-badge-avatar" style="background:${officeColor(person.name)}">${escapeHtml(initials(person.name))}</span>`;
    return `<span class="unregistered-badge" aria-disabled="true">
      ${avatar}
      <span class="unregistered-badge-name">${escapeHtml(person.name)}${person.role ? `<span class="om-team-role">${escapeHtml(person.role)}</span>` : ''}</span>
    </span>`;
  }

  // Mevcut veri "İl / İlçe" sırasıyla girilmiş (ör. "İstanbul / Beyoğlu") — künyede "İlçe, İl"
  // sırasıyla göstermek için sadece bu kalıba uyan değerleri çevirir (ofis-detay.html ile aynı).
  function formatLocationDistrictFirst(loc) {
    const m = /^([^/]+?)\s*\/\s*(.+)$/.exec(loc || '');
    return m ? `${m[2].trim()}, ${m[1].trim()}` : loc;
  }

  // bkz. auth-modal.js#safeUrl'deki AYNI kök neden/düzeltme — window.location.href yerine
  // document.baseURI (firma.html'deki <base href="/">'yi dikkate alır).
  function safeUrl(u) {
    try {
      const parsed = new URL(u, document.baseURI);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
    } catch {}
    return '';
  }

  // bkz. js/components/architect-modal.js#socialIconsHtml AYNI kopya (kullanıcı isteği: profile
  // birden fazla sosyal medya bağlantısı eklenebilsin, migrations/0036_social_links.sql).
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

  // bkz. js/components/architect-modal.js#renderPrevNext — BİREBİR aynı desen, Firma etiketleriyle.
  // Yön kasıtlı olarak TERS çevrilmiştir (bkz. js/components/project-modal.js#renderPrevNext'teki
  // AYNI gerekçe/kullanıcı isteği) — payload.nextItem/prevItem'in kendisi değişmedi, yalnızca hangisi
  // .prev/.next slotunu doldurduğu swap edildi.
  // bkz. kullanıcı isteği: Önceki/Sonraki butonlarının içine önizleme görseli eklenmesi.
  function prevNextThumbHtml(item) {
    return item.image
      ? `<img class="prevnext-thumb" src="${escapeAttr(cdnImg(item.image, 120))}" alt="" loading="lazy" decoding="async">`
      : `<div class="prevnext-thumb prevnext-thumb-placeholder" style="background:${officeColor(item.title)}">${escapeHtml(initials(item.title))}</div>`;
  }

  function renderPrevNext(payload) {
    const el = document.getElementById('om-prevnext');
    let html = '';
    if (payload.nextItem) html += `<a class="prev" href="/firma/${encodeURIComponent(payload.nextItem.slug)}">${prevNextThumbHtml(payload.nextItem)}<span class="prevnext-text"><span class="prevnext-label">← Önceki Firma</span><span class="prevnext-title">${escapeHtml(payload.nextItem.title)}</span></span></a>`;
    if (payload.prevItem) html += `<a class="next" href="/firma/${encodeURIComponent(payload.prevItem.slug)}">${prevNextThumbHtml(payload.prevItem)}<span class="prevnext-text"><span class="prevnext-label">Sonraki Firma →</span><span class="prevnext-title">${escapeHtml(payload.prevItem.title)}</span></span></a>`;
    el.innerHTML = html;
  }

  // gerçek bulgu (denetim raporu, 2026-08-16): js/components/architect-modal.js#pageTitle ile AYNI
  // sızıntı/gerekçe.
  const TITLE_SUFFIX = ' — MİMARLAB';
  const TITLE_MAX = 60;
  function pageTitle(name) {
    const maxNameLen = TITLE_MAX - TITLE_SUFFIX.length;
    return `${name && name.length > maxNameLen ? name.slice(0, maxNameLen - 1) + '…' : name}${TITLE_SUFFIX}`;
  }

  function updateHeadMeta(o) {
    document.title = pageTitle(o.name);
    ModalShell.setLabel(o.name);
    const desc = `${o.name}${o.loc ? ' — ' + o.loc : ''}. MİMARLAB'da firma profilini incele.`;
    const canonicalUrl = `https://mimarlab.com/firma/${encodeURIComponent(slugify(o.name))}`;
    const logo = logoUrl(o);
    const image = logo ? new URL(logo, window.location.origin).href : 'https://mimarlab.com/logos/site/mimarlab-og-image.png';
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

  function renderStructuredData(o) {
    let tag = document.getElementById('om-ld-json');
    if (!tag) {
      tag = document.createElement('script');
      tag.type = 'application/ld+json';
      tag.id = 'om-ld-json';
      document.head.appendChild(tag);
    }
    const data = { '@context': 'https://schema.org', '@type': 'Organization', name: o.name, url: window.location.href };
    if (o.about) data.description = o.about;
    if (o.yil) data.foundingDate = String(o.yil);
    if (o.loc) data.address = { '@type': 'PostalAddress', addressLocality: o.loc };
    const logo = logoUrl(o);
    // gerçek bulgu (2026-08-13): o.logo (=logoUrl(o)) D1'de 597 kayıtta başında "/" olmadan
    // saklanıyor (ör. "logos-thumb/eaa.jpg") — document.baseURI kullan (bkz. yukarıdaki safeUrl).
    if (logo) { try { data.logo = new URL(logo, document.baseURI).href; } catch {} }
    if (o.website && safeUrl(o.website)) data.sameAs = [safeUrl(o.website)];
    tag.textContent = JSON.stringify(data);
  }

  // bkz. js/components/project-modal.js#HIDE_ON_NOT_FOUND_IDS AYNI gerçek bulgu: renderNotFound()
  // bu ID'leri gizliyor, ModalShell'in şablonu sayfa ömrü boyunca tek sefer mount edildiğinden bir
  // sonraki başarılı render bunları geri açmazsa modal kalıcı olarak yarı-boş görünürdü.
  const HIDE_ON_NOT_FOUND_IDS = ['om-actions', 'om-founders-section', 'om-team-section', 'om-related-projects-section', 'om-city-section', 'om-related-products-section',
    'om-related-materials-section', 'om-detail-info', 'om-prevnext'];

  async function renderItem(payload) {
    HIDE_ON_NOT_FOUND_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    });
    const o = payload.item;
    const founders = payload.founders || [];
    const team = payload.team || [];
    const relatedProjectsData = payload.relatedProjects || [];
    currentItem = o;

    updateHeadMeta(o);
    document.getElementById('om-name-text').textContent = o.name;
    document.getElementById('om-social-icons').innerHTML = socialIconsHtml(o.social_links);
    renderTruncatedDesc('om-about', o.about || '');

    const infoFacts = [];
    if (o.yil) infoFacts.push(metaRow('calendar', `<strong>Kuruluş Yılı:</strong> ${escapeHtml(String(o.yil))}`));
    if (o.loc) infoFacts.push(metaRow('pin', `<strong>Konum:</strong> ${escapeHtml(formatLocationDistrictFirst(o.loc))}`));
    if (o.cats) infoFacts.push(metaRow('globe', `<strong>Hizmet Alanı:</strong> ${escapeHtml(o.cats)}`));
    const infoFactsEl = document.getElementById('om-info-facts');
    infoFactsEl.innerHTML = infoFacts.join('');
    infoFactsEl.style.display = infoFacts.length ? '' : 'none';

    const logoEl = document.getElementById('om-logo');
    logoEl.innerHTML = '';
    logoEl.textContent = initials(o.name);
    logoEl.style.background = officeColor(o.name);
    const officeLogoUrl = logoUrl(o);
    if (officeLogoUrl) {
      const img = document.createElement('img');
      img.src = officeLogoUrl;
      img.alt = '';
      img.decoding = 'async';
      img.fetchPriority = 'high';
      img.onerror = () => img.remove();
      logoEl.appendChild(img);
    }

    // Kaydet KALDIRILDI (bkz. kullanıcı isteği: mimar/firma profillerinde Kaydet butonu artık yok) —
    // bu profillerde tek eylem artık Takip Et. Düzenle/Arşivle/Sil artık bu satırda DEĞİL —
    // modal-shell.js'in paylaşılan header'ında, X butonunun yanında render edilir (bkz. kullanıcı
    // isteği) — claim-correction-box.js#renderProfileEditButton hâlâ #profile-edit-slot id'sini
    // arıyor, yalnızca DOM konumu değişti.
    const actionsEl = document.getElementById('om-actions');
    actionsEl.innerHTML = '';
    const headerActions = ModalShell.getHeaderActionsSlot();
    if (headerActions) headerActions.innerHTML = '<span id="profile-edit-slot"></span>';
    const officeKey = slugify(o.name);
    // Takip Et — bkz. kullanıcı isteği: archello.com/brand/ofist'teki gibi, Websitesi'nin yanında.
    // Yanındaki sayı (bkz. kullanıcı isteği: "Takip Et (12)") /api/public/follow-count'tan gelir,
    // save-widget.js#paintFollowBtn dataset.followerCount'u okuyup 0'sa parantezi hiç basmaz.
    const followBtn = document.createElement('button');
    followBtn.type = 'button';
    followBtn.className = 'follow-btn card-follow-btn';
    followBtn.id = 'om-follow-btn';
    followBtn.dataset.type = 'office';
    followBtn.dataset.key = officeKey;
    followBtn.dataset.title = o.name;
    followBtn.innerHTML = `<span class="follow-btn-label">Takip Et</span>`;
    actionsEl.appendChild(followBtn);
    wireFollowButtons();
    fetch(`/api/public/follow-count?type=office&key=${encodeURIComponent(officeKey)}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) { followBtn.dataset.followerCount = String(data.count || 0); paintFollowBtn(followBtn); } })
      .catch(() => {});
    if (typeof ShareWidget !== 'undefined') {
      followBtn.insertAdjacentHTML('afterend', ShareWidget.html('om-share-btn'));
      ShareWidget.wire('om-share-btn', () => ({ title: o.name, url: `${window.location.origin}/firma/${encodeURIComponent(slugify(o.name))}` }));
    }

    // "Websitesi" — Takip Et ile AYNI satırda, en başta (bkz. kullanıcı isteği).
    const visitUrl = o.website ? safeUrl(o.website) : '';
    if (visitUrl) {
      const visitBtn = document.createElement('a');
      visitBtn.className = 'save-btn';
      visitBtn.href = visitUrl;
      visitBtn.target = '_blank';
      visitBtn.rel = 'noopener';
      visitBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg><span>Websitesi</span>`;
      actionsEl.prepend(visitBtn);
    }

    const socialLinksEl = document.getElementById('om-social-links');
    if (socialLinksEl) socialLinksEl.innerHTML = typeof SocialLinks !== 'undefined' ? SocialLinks.html(o.socialPlatform, o.socialUrl) : '';

    renderStructuredData(o);
    renderPrevNext(payload);

    document.getElementById('om-founders-section').style.display = founders.length ? '' : 'none';
    // renderFoundersGrid ayrı bir fonksiyon olarak tutulur — aşağıdaki renderVerifiedBadges ile AYNI
    // /api/public/badges gecikmesi burada da var, rozetler geldiğinde tekrar çizilir.
    function renderFoundersGrid() {
      document.getElementById('om-founders-grid').innerHTML = founders.map(a => a.unregistered
        ? unregisteredBadgeHtml(a.name)
        : cardHtml(`/mimar/${encodeURIComponent(slugify(a.name))}`, a.name, a.photo, a.role, verifiedBadgeHtml('architect', a.name, a.badges, 14))
      ).join('');
    }
    renderFoundersGrid();

    document.getElementById('om-team-section').style.display = team.length ? '' : 'none';
    document.getElementById('om-team-grid').innerHTML = team.map(teamBadgeHtml).join('');

    document.getElementById('om-related-projects-section').style.display = relatedProjectsData.length ? '' : 'none';
    document.getElementById('om-related-projects-grid').innerHTML = relatedProjectsData.map(p =>
      cardHtml(`/proje/${encodeURIComponent(p.slug)}`, p.title, p.images && p.images[0])
    ).join('');
    document.getElementById('om-related-projects-count').textContent = relatedProjectsData.length ? ` (${relatedProjectsData.length})` : '';
    renderProjectsMap(relatedProjectsData);

    // MİMARLAB AI, Faz 2 — Firma↔Şehir ilişkisi (bkz. src/routes/office.js#buildOfficePayload
    // relatedOffices yorumu). Bölüm başlığı zaten "Şehirdeki Diğer Firmalar" diyerek nedeni
    // açıkladığından (bkz. kullanıcı isteği: sahte/sayısal bir eşleşme skoru DEĞİL), her kartın
    // altında o firmanın kendi konumu (arama.html sonuç satırlarındaki AYNI kullanım) alt bilgi
    // olarak gösterilir.
    const relatedOfficesData = payload.relatedOffices || [];
    document.getElementById('om-city-section').style.display = relatedOfficesData.length ? '' : 'none';
    document.getElementById('om-city-grid').innerHTML = relatedOfficesData.map(o2 =>
      cardHtml(`/firma/${encodeURIComponent(o2.slug)}`, o2.name, logoUrl(o2), o2.loc)
    ).join('');

    // Marka kataloğu — bu firmanın adı ürün/malzeme markası olarak eşleşen canonical products
    // satırları (bkz. src/routes/office.js#buildOfficePayload, relatedProducts/relatedMaterials).
    // "Bu firma sana mı ait?" ile bir kullanıcının KİŞİSEL olarak gönderip onaylattığı ürünlerden
    // (aşağıdaki loadRelatedProducts) AYRI bir kaynak — ikisi aynı gridde birleştirilir (dedupe:
    // aynı başlık ikisinde de varsa marka kataloğu kazanır, çünkü slug'ı olduğundan doğru /urun/
    // linkine gider, submission kaynağının href'i yok — bkz. aşağıdaki gerçek bulgu notu).
    const brandProductsData = payload.relatedProducts || [];
    const brandMaterialsData = payload.relatedMaterials || [];
    function productCardHtml(p) {
      return cardHtml(p.slug ? `/urun/${encodeURIComponent(p.slug)}` : 'urun.html', p.title, (p.images && p.images[0]) || p.image, p.category);
    }
    function renderProductGrid(sectionId, gridId, brandItems, submissionItems, countId) {
      const seenTitles = new Set(brandItems.map(p => (p.title || '').trim().toLowerCase()));
      const merged = [...brandItems, ...submissionItems.filter(p => !seenTitles.has((p.title || '').trim().toLowerCase()))];
      document.getElementById(sectionId).style.display = merged.length ? '' : 'none';
      document.getElementById(gridId).innerHTML = merged.map(productCardHtml).join('');
      if (countId) document.getElementById(countId).textContent = merged.length ? ` (${merged.length})` : '';
    }
    renderProductGrid('om-related-products-section', 'om-related-products-grid', brandProductsData, [], 'om-related-products-count');
    renderProductGrid('om-related-materials-section', 'om-related-materials-grid', brandMaterialsData, [], 'om-related-materials-count');

    const PROFILE_TYPE = 'office';
    // gerçek bulgu (denetim, 2026-08-24, bkz. architect-modal.js'teki AYNI 2026-08-24 güncellemesi/
    // claim-correction-box.js#config.isStale yorumu) — kurucular/ekip ızgarasından hızlıca başka bir
    // firmaya geçildiğinde eski claimBox'ın Sil/Arşivle butonlarının YENİ görünen firmanın header'ına
    // yazılmasını önler.
    const claimBox = createClaimCorrectionBox({
      profileType: PROFILE_TYPE,
      ready: savedWidgetReady,
      isStale: () => currentItem !== o,
      getProfileKey: () => o.name,
      // bkz. js/components/architect-modal.js'teki AYNI 2026-08-17 güncellemesi/gerekçe — çirkin
      // %-encode'lu "?claim=" URL'leri yerine temiz slug'a öncelik verilir (firma-ekle.html#
      // prefillForClaim slug/legacy_key/isim'in herhangi birini kabul edip gerçek `name`'e çözer).
      getClaimLinkKey: () => o.slug || o._claimKey || o.name,
      getStaticBadges: () => o.badges,
      editUrlBase: 'firma-ekle.html',
      listUrl: 'firma.html',
      contentType: 'offices',
      getModerationTarget: () => o.submissionId ? { id: o.submissionId } : { key: o.name },
      labels: {
        claimTitle: 'Bu firma sana mı ait?',
        loginPromptHtml: 'Bilgilerini güncellemek ve Doğrulanmış Profil rozeti almak için <a href="giris-yap.html" class="info-card-link">giriş yap</a>.',
        pendingHtml: '"Bu firma bana ait" talebini aldık, ekibimiz en kısa sürede onaylayacak.',
        claimNoteDescription: 'Bu firmanın sana ait olduğunu doğrulayabileceğimiz bir not ekle.',
        claimButtonText: 'Gönder',
        deleteConfirm: 'Bu firma profilini silmek istediğine emin misin? Profil anında canlı siteden kaldırılır.',
        archiveConfirm: 'Bu firma profilini arşivlemek istediğine emin misin? Profil canlıdan kaldırılıp admin panelindeki Arşiv sekmesine taşınır.',
      },
    });

    async function loadRelatedProducts() {
      try {
        const res = await fetch(`/api/public/profile-content?profileType=office&profileKey=${encodeURIComponent(o.name)}`);
        if (!res.ok) return;
        const data = await res.json();
        renderProductGrid('om-related-products-section', 'om-related-products-grid', brandProductsData, data.products || [], 'om-related-products-count');
        renderProductGrid('om-related-materials-section', 'om-related-materials-grid', brandMaterialsData, data.materials || [], 'om-related-materials-count');
      } catch {}
    }

    function renderVerifiedBadges() {
      document.getElementById('om-verified-badge-wrap').innerHTML = verifiedBadgeHtml(PROFILE_TYPE, o.name, o.badges, 20);
      // bkz. kullanıcı isteği: mavi rozet kurucu/ortak kartlarında da görünmeli — isim bazlı
      // dynamicBadges önbelleğine bağlı olduğundan başlıktaki rozetle AYNI anda tazelenir.
      renderFoundersGrid();
    }
    renderVerifiedBadges();
    // gerçek bulgu (denetim, 2026-08-16): js/components/architect-modal.js#renderVerifiedBadges ile
    // AYNI listener-birikimi sorunu — badgesReadyPromise'e geçiş, kalıcı window listener'ı kaldırır.
    if (typeof badgesReadyPromise !== 'undefined') badgesReadyPromise.then(renderVerifiedBadges);

    // currentItem === o koruması: js/components/architect-modal.js#renderItem'daki AYNI gerekçe —
    // kullanıcı bu geciken callback ateşlenmeden önce bir sonraki firmaya geçerse, eski firmanın
    // verisiyle yeni firmanın om-related-products-* DOM'unu ezmesin.
    deferToIdle(() => { if (currentItem === o) loadRelatedProducts(); }, 800);
    await savedWidgetReady;
    await claimBox.init();

    wireInternalNav();
    ModalShell.scrollToTop();
  }

  function renderNotFound() {
    document.getElementById('om-name-text').textContent = 'Firma bulunamadı';
    const headerActions = ModalShell.getHeaderActionsSlot();
    if (headerActions) headerActions.innerHTML = '';
    HIDE_ON_NOT_FOUND_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  function wireInternalNav() {
    const panels = ModalShell.getPanels();
    if (!panels || panels.bodyEl.dataset.omNavWired) return;
    panels.bodyEl.dataset.omNavWired = '1';
    panels.bodyEl.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="/firma/"]');
      if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const m = a.getAttribute('href').match(/^\/firma\/([^/?#]+)/);
      if (!m) return;
      e.preventDefault();
      swap(decodeURIComponent(m[1]));
    });
  }

  // gerçek bulgu (denetim, 2026-08-24, bkz. project-modal.js#fetchItem'daki AYNI kök neden): ağ hatası
  // burada da yakalanmıyordu — open()/swap() renderNotFound()'ı hiç tetikleyemeden modal iskelet
  // durumunda kalıyordu. Ağ hatası artık 404/gizli kayıtla AYNI null yola yönlendirilir.
  async function fetchItem(slug) {
    try {
      const res = await fetch(`/api/office/${encodeURIComponent(slug)}`);
      if (!res.ok) return null;
      const payload = await res.json();
      if (!payload || !payload.item || payload.hidden) return null;
      return payload;
    } catch { return null; }
  }

  async function open(slug, { pushHistory = true, triggerEl = null } = {}) {
    await ModalShell.waitForPendingNav();
    currentSlug = slug;
    openedViaPush = pushHistory;
    pushCountSinceOpen = pushHistory ? 1 : 0;
    if (pushHistory) history.pushState({ mimarlabModal: 'office', slug, depth: 1 }, '', `/firma/${encodeURIComponent(slug)}`);
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
    await ModalShell.waitForPendingNav();
    currentSlug = slug;
    const currentDepth = (history.state && history.state.mimarlabModal === 'office') ? history.state.depth : pushCountSinceOpen;
    pushCountSinceOpen = currentDepth + 1;
    history.pushState({ mimarlabModal: 'office', slug, depth: pushCountSinceOpen }, '', `/firma/${encodeURIComponent(slug)}`);
    const mySeq = ++requestSeq;
    const payload = await fetchItem(slug);
    if (mySeq !== requestSeq || currentSlug !== slug) return;
    if (!payload) { renderNotFound(); return; }
    await renderItem(payload);
  }

  function close() {
    currentSlug = null;
    currentItem = null;
    if (openedViaPush && pushCountSinceOpen > 0) ModalShell.goBackAndWait(pushCountSinceOpen);
    else history.pushState({}, '', '/firma');
    ModalShell.close();
    pushCountSinceOpen = 0;
  }

  // bkz. js/components/project-modal.js#handlePopState AYNI wasCurrentPopSuperseded gerekçesi.
  function handlePopState(slug) {
    if (ModalShell.wasCurrentPopSuperseded()) return;
    if (!slug) { if (ModalShell.isOpen()) { currentSlug = null; currentItem = null; ModalShell.close(); } return; }
    if (!ModalShell.isOpen()) { openedViaPush = false; open(slug, { pushHistory: false }); return; }
    if (history.state && history.state.mimarlabModal === 'office' && typeof history.state.depth === 'number') {
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
