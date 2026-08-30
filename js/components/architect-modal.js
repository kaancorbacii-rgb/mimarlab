// ArchitectModal — mimar detay modalının orkestratörü (bkz. js/components/project-modal.js'teki
// AYNI open/swap/close/handlePopState state machine deseni). DOM çerçevesi (overlay/panel/focus-trap/
// scroll-lock) js/components/modal-shell.js'ten gelir; içerik eskiden mimar-detay.html'in kendi
// sayfası olarak render ettiği her şeyi (kimlik, künye, ofis kartı, meslektaşlar, ilgili
// projeler/ürünler, claim/correction kutusu) mimar.html'in kartına tıklandığında sayfa yenilenmeden
// açan bir modale taşır. Yorum/puanlama YOK — mimar-detay.html'de de hiç yoktu, kapsam dışı kalmaya
// devam ediyor (bkz. proje hafızası: "comments/ratings stay project/product-only").
const ArchitectModal = (function () {
  // Künye satırı ikonları — js/components/project-meta.js#ICONS İLE AYNI çizim dili (24x24 viewBox,
  // stroke-width 1.6, dolgu yok, bkz. kullanıcı isteği) ama bu dosya proje modalının script'inden
  // BAĞIMSIZ yüklenebildiğinden (mimar.html) kendi kopyasını taşır.
  const META_ICONS = {
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/></svg>',
    cap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9 12 4.3 22 9l-10 4.7L2 9Z"/><path d="M6.3 11.2v4.3c0 1.5 2.6 2.7 5.7 2.7s5.7-1.2 5.7-2.7v-4.3"/><path d="M21 9v6"/></svg>',
    briefcase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7.5" width="18" height="12" rx="2"/><path d="M8.5 7.5V5.8a1.8 1.8 0 0 1 1.8-1.8h3.4a1.8 1.8 0 0 1 1.8 1.8V7.5"/><path d="M3 12.5h18"/></svg>',
    award: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"/><path d="M8.7 12.6 7 21l5-2.8 5 2.8-1.7-8.4"/></svg>',
  };
  function metaIconHtml(key) { return `<span class="meta-icon">${META_ICONS[key] || ''}</span>`; }
  function metaRow(iconKey, bodyHtml) { return `<div class="meta-row">${metaIconHtml(iconKey)}<span>${bodyHtml}</span></div>`; }
  // .detail-title/.related-*/.save-btn proje.html'in modal içeriğinde tanımladığı AYNI sınıflar/
  // değerler — mimar.html farklı bir sayfa olduğundan proje.html'in <style>'ını miras alamaz, bu
  // yüzden modal-shell.js'in injectStyles() deseniyle burada KENDİ <style>'ını bir kez enjekte eder
  // (görsel bütünlük için proje modalıyla BİREBİR aynı değerler). .card-edit-btn/.card-delete-btn/
  // .profile-edit-btn ARTIK burada değil — Düzenle/Arşivle/Sil modal-shell.js'in paylaşılan
  // header'ında render edilir (bkz. kullanıcı isteği). .feedback-card/.feedback-input-wrap o
  // dosyanın KENDİ injectStyles()'ında tanımlı (bkz. js/components/claim-correction-box.js).
  function injectStyles() {
    if (document.getElementById('architect-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'architect-modal-styles';
    style.textContent = `
      .detail-title{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:26px; font-weight:700; margin:0; line-height:1.25;}
      .am-identity{display:flex; align-items:center; gap:16px; margin-bottom:18px;}
      .profile-logo{
        width:64px; height:64px; border-radius:50%; flex-shrink:0;
        border:1px solid var(--line); overflow:hidden; position:relative;
        display:flex; align-items:center; justify-content:center;
        background:var(--walnut); color:var(--paper-card);
        font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-weight:600; font-size:20px;
      }
      .profile-logo img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover;}
      .save-count{font-size:12px; color:var(--ink-soft); white-space:nowrap;}
      /* Düzenle/Arşivle/Sil (X'in KARŞI kenarında), Paylaş/Takip Et (X'in yanında) artık burada
         DEĞİL — modal-shell.js'in paylaşılan header'ında render edilir (bkz. kullanıcı isteği: bu
         satır tamamen kaldırıldı, altındaki içerik yukarı çekildi). .detail-title-actions/
         .card-edit-btn/.card-delete-btn/.profile-edit-btn kuralları buradan kaldırıldı; TEK stil
         kaynağı artık modal-shell.js#injectStyles. */
      /* Kaydet KALDIRILDI (bkz. kullanıcı isteği: mimar/firma profillerinde Kaydet butonu artık yok)
         — bu profillerde içerik aksiyonları Paylaş + Takip Et'tir. */
      /* Takip Et — bkz. kullanıcı isteği: archello.com/brand/ofist'teki gibi, Paylaş ile AYNI
         yükseklikte bir pil. Yanındaki takipçi sayısı (bkz. kullanıcı isteği) save-widget.js#
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
      .detail-meta{font-size:14px; line-height:1.9; margin-top:18px;}
      .detail-meta strong{font-weight:600; color:var(--ink);}
      /* Künye ikonları — js/components/project-meta.js#ICONS İLE AYNI çizim dili/hiza (bkz. kullanıcı
         isteği), hepsi AYNI büyüklükte. */
      .meta-icon{width:16px; height:16px; flex-shrink:0; color:var(--ink-soft);}
      .meta-icon svg{display:block; width:100%; height:100%;}
      .detail-meta .meta-row{display:flex; align-items:flex-start; gap:9px;}
      .detail-meta .meta-row .meta-icon{margin-top:3px;}
      /* bkz. kullanıcı isteği: profile birden fazla sosyal medya eklenebilsin (mimar-ekle.html#social-row) */
      .social-icons{display:flex; gap:12px; margin-top:12px;}
      .social-icons a{color:var(--ink-soft); display:flex;}
      .social-icons a:hover{color:var(--walnut);}
      .detail-desc{font-size:15px; line-height:1.7; color:var(--ink); margin-top:18px;}
      .detail-desc-more{background:none; border:none; padding:0; color:var(--walnut); font-weight:600; font-size:14px; text-decoration:underline; text-decoration-color:var(--line); cursor:pointer;}
      .detail-desc-more:hover{color:var(--ink);}
      .detail-info-divider{border:none; border-top:1px solid var(--line-soft); margin:24px 0;}
      .related-section{margin-top:32px; padding-top:28px; border-top:1px solid var(--line);}
      .related-section:first-child{margin-top:0; padding-top:0; border-top:none;}
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
      /* Pop-up içindeki proje/danışman kartlarında tek satır kısıtlaması (bkz. kullanıcı isteği):
         uzun başlıklar tek satıra sığdığı kadar yazılır, sığmayan kelimeler alt satıra kesinlikle
         geçmez, satır sonuna ellipsis eklenir. */
      .related-card-title-text{display:block !important; white-space:nowrap !important; overflow:hidden !important; text-overflow:ellipsis !important; width:100% !important;}
      /* "Projeler" (bu mimarın/firmanın kendi eserleri) grid'inde tek-satır+"…" kısıtlaması KALDIRILIR
         (bkz. kullanıcı isteği: "ismi uzun olan mimarın/firmanın diğer yapılarında metinlerindeki üç
         nokta sistemini sil") — yukarıdaki genel kural Firmalar/Diğer Firma Ortakları kartlarında
         (isim tek satır) aynen kalır, yalnızca #am-related-projects-grid'e özel bu override başlığın
         normal şekilde birden çok satıra sarmasına izin verir. */
      #am-related-projects-grid .related-card-title-text{white-space:normal !important; overflow:visible !important; text-overflow:clip !important;}
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
        color:#fff; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-weight:600; font-size:11.5px;
      }
      .unregistered-badge-name{font-size:13px; font-weight:600; color:var(--ink);}
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
      @media (max-width:860px){
        .related-grid-scroll .related-card{flex:0 0 140px;}
        .related-grid-scroll{gap:10px;}
        /* mobil/tablette .modal-shell-left/.modal-shell-right display:contents olduğundan (bkz.
           modal-shell.js) tüm doğrudan çocuklar TEK bir dikey flex akışına katılır — claim/geri
           bildirim kutuları burada order:99 ile akışın EN ALTINA (bkz. kullanıcı isteği) taşınır. */
        #claim-info-card, #correction-info-card{order:99;}
        /* :first-child kuralı masaüstünde sağ panelin İLK bölümü olduğu için gerekliydi (üstte
           gereksiz çizgi olmasın) — ama mobilde birleşik akışta "Firmalar" artık görsel olarak ilk
           değil, hemen üstünde kimlik/künye bölümünün hr.detail-info-divider'ı var (bkz. kullanıcı
           isteği: "Projeler" başlığıyla BİREBİR aynı boşluk). :first-child sıfırlamasını burada geri
           alıp diğer .related-section'larla eşit boşluk/çizgiye döndürür. */
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
      }
      .prevnext-mobile-divider{display:none;}
      /* Projeler haritası — bkz. kullanıcı isteği: "Projeler"in altına, mimarın/firmanın koordinatlı
         TÜM projelerini pinleyen açık bir harita; js/pages/proje.js#loadLeaflet İLE AYNI Leaflet +
         Esri World Imagery yığını/marker popup kartı (bu modül mimar.html'de Leaflet YÜKLEMEYEN diğer
         sayfalardan bağımsız kendi yükleyicisini taşır, bkz. aşağıdaki loadAmMapLeaflet). */
      .am-projects-map-wrap{margin-top:16px; border-radius:12px; overflow:hidden; border:1px solid var(--line-soft); height:280px; background:var(--paper-alt);}
      .am-projects-map-wrap .leaflet-container{width:100%; height:100%; background:var(--paper-alt); font-family:inherit;}
      .leaflet-popup.pm-project-popup .leaflet-popup-content-wrapper{padding:0; border-radius:10px; overflow:hidden;}
      .leaflet-popup.pm-project-popup .leaflet-popup-content{margin:0; width:auto !important;}
      .pm-map-marker-card{display:block; text-decoration:none; color:inherit; cursor:pointer;}
      .pm-map-marker-card-photo{width:100%; aspect-ratio:1/1; object-fit:cover; display:block; background:var(--paper-alt);}
      .pm-map-marker-card-placeholder{display:flex; align-items:center; justify-content:center; font-weight:700; font-size:20px; color:#fff; width:100%; aspect-ratio:1/1;}
      .pm-map-marker-card-title{padding:8px 10px; font-size:13px; font-weight:600; color:var(--ink); line-height:1.3;}
      @media (max-width:860px){
        .am-projects-map-wrap{height:220px;}
      }
    `;
    document.head.appendChild(style);
  }

  const LEFT_TEMPLATE = `
    <div class="am-identity">
      <div class="profile-logo" id="am-logo"></div>
      <h1 class="detail-title"><span id="am-name-text"></span><span id="am-verified-badge-wrap"></span></h1>
    </div>
    <div id="am-social-links"></div>
    <div class="detail-info" id="am-detail-info">
      <div class="detail-meta" id="am-category"></div>
      <div id="am-social-icons"></div>
      <div class="detail-meta" id="am-info-facts" style="display:none;"></div>
      <div class="detail-desc" id="am-about"></div>
      <hr class="detail-info-divider">
    </div>
    <details class="feedback-card" id="claim-info-card">
      <summary>Bu profil sana mı ait?<span class="feedback-card-plus" aria-hidden="true"></span></summary>
      <div id="claim-card-body"></div>
    </details>
    <details class="feedback-card" id="correction-info-card">
      <summary>Geri Bildirim<span class="feedback-card-plus" aria-hidden="true"></span></summary>
      <p>Hatalı ya da eksik bir bilgi görüyorsan bize bildir.</p>
      <div id="correction-card-extra"></div>
    </details>`;

  const RIGHT_TEMPLATE = `
    <div class="related-section" id="am-office-section" style="display:none;">
      <h2 class="related-title">Firmalar</h2>
      <div class="related-grid-scroll" id="am-office-grid"></div>
    </div>
    <div class="related-section" id="am-colleagues-section" style="display:none;">
      <h2 class="related-title">Diğer Firma Ortakları</h2>
      <div class="related-grid-scroll" id="am-colleagues-grid"></div>
    </div>
    <div class="related-section" id="am-related-projects-section" style="display:none;">
      <h2 class="related-title">Projeler<span id="am-related-projects-count"></span></h2>
      <div class="related-grid-scroll" id="am-related-projects-grid"></div>
      <div class="am-projects-map-wrap" id="am-projects-map-wrap" style="display:none;"></div>
    </div>
    <div class="related-section" id="am-related-products-section" style="display:none;">
      <h2 class="related-title">Ürünler<span id="am-related-products-count"></span></h2>
      <div class="related-grid-scroll" id="am-related-products-grid"></div>
    </div>
    <div class="related-section" id="am-related-architects-section" style="display:none;">
      <h2 class="related-title">Diğer Mimarlar</h2>
      <div class="related-grid-scroll" id="am-related-architects-grid"></div>
    </div>
    <div class="prevnext" id="am-prevnext"></div>
    <hr class="prevnext-mobile-divider">`;

  let mountedOnce = false;
  let currentSlug = null;
  let currentItem = null;
  let openedViaPush = false;
  let pushCountSinceOpen = 0;
  let requestSeq = 0;

  // ---------- Projeler haritası — bkz. kullanıcı isteği: "Projeler" bölümünün altına, mimarın
  // koordinatı olan TÜM projelerini pinleyen dinamik bir harita. Veri her renderItem() çağrısında
  // /api/architect/:slug'tan (bkz. fetchItem) taze geldiğinden — bir proje bu mimara eklenip/
  // çıkarıldığında payload.relatedProjects da değişir — harita da otomatik güncellenir, ayrıca bir
  // "canlı senkron" mekanizmasına gerek yok. js/pages/proje.js#loadLeaflet İLE AYNI Leaflet + Esri
  // World Imagery yığını (anahtarsız/ücretsiz) — bu modül mimar.html'de Leaflet YÜKLEMEYEN diğer
  // sayfalardan bağımsız kendi yükleyicisini taşır (proje.js'in sayfa-özel global'ine bağımlı kalınamaz).
  let amMapLeafletPromise = null;
  function loadAmMapLeaflet() {
    if (amMapLeafletPromise) return amMapLeafletPromise;
    amMapLeafletPromise = new Promise((resolve, reject) => {
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
    return amMapLeafletPromise;
  }
  let amProjectsMap = null;
  let amMapRequestSeq = 0;
  // Marker'a tıklamak burada (proje.js#syncMapMarkers'ın AKSİNE) doğrudan bir <a href="/proje/...">
  // linkine gider — ProjectModal bu sayfada (mimar.html) hiç yüklenmiyor (bkz. kart tıklamalarının
  // AYNI davranışı, cardHtml), bu yüzden marker popup'ındaki karta tıklamak zaten normal bir
  // sayfa geçişi (o adreste ProjectModal kendi DOMContentLoaded'ında otomatik açılır).
  function renderProjectsMap(projects) {
    const wrap = document.getElementById('am-projects-map-wrap');
    if (!wrap) return;
    const pinned = (projects || []).filter(p => p.lat != null && p.lng != null);
    if (!pinned.length) {
      wrap.style.display = 'none';
      if (amProjectsMap) { try { amProjectsMap.remove(); } catch { /* zaten kopmuş olabilir */ } amProjectsMap = null; }
      return;
    }
    wrap.style.display = '';
    const mySeq = ++amMapRequestSeq;
    loadAmMapLeaflet().then((L) => {
      if (mySeq !== amMapRequestSeq) return; // bu arada başka bir profil açıldı, bu yanıt bayat
      if (amProjectsMap) { try { amProjectsMap.remove(); } catch { /* zaten kopmuş olabilir */ } amProjectsMap = null; }
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
      amProjectsMap = map;
      // Bu ekranda daima o mimarın/firmanın TÜM projeleri (sayfalanmadan) birlikte gösterildiğinden
      // — proje.js#syncMapMarkers'ın "hiçbir zaman fitBounds etme" kararının AKSİNE — burada haritayı
      // pinlerin kapsadığı alana ODAKLAMAK (fitBounds) doğru davranış: kullanıcı o profildeki
      // projelerin coğrafi dağılımını tek bakışta görür.
      if (markers.length === 1) map.setView(markers[0].getLatLng(), 14);
      else map.fitBounds(L.featureGroup(markers).getBounds(), { padding: [24, 24], maxZoom: 14 });
      setTimeout(() => map.invalidateSize(), 0);
    });
  }

  // bkz. js/components/modal-shell.js#claimContent — sahip DEĞİŞTİYSE (Hesabım/başka bir detay
  // modalından geçildiyse) panelleri boşaltıp isNewOwner:true döner, bu durumda mountedOnce true
  // olsa da şablon KOŞULSUZ yeniden kurulur (bkz. office-modal.js#ensureTemplate AYNI gerçek bulgu).
  function ensureTemplate() {
    const panels = ModalShell.claimContent('architect');
    if (mountedOnce && !panels.isNewOwner) return;
    // Şablon (ör. mimar<->firma geçişi) sıfırdan kuruluyorsa altındaki #am-projects-map-wrap düğümü
    // de bu innerHTML atamasıyla birlikte kopacak — o düğüme bağlı eski Leaflet map instance'ını
    // burada bırakmadan temizleriz (bkz. aşağıdaki renderProjectsMap).
    if (amProjectsMap) { try { amProjectsMap.remove(); } catch { /* zaten kopmuş olabilir */ } amProjectsMap = null; }
    panels.leftPanelEl.innerHTML = LEFT_TEMPLATE;
    panels.rightPanelEl.innerHTML = RIGHT_TEMPLATE;
    ModalShell.wireGridScrollArrows(panels.rightPanelEl);
    mountedOnce = true;
  }

  const DEPT_TO_PROFESSION = {
    'Mimarlık': 'Mimar',
    'İç Mimarlık': 'İç Mimar',
    'İç Mimarlık ve Çevre Tasarımı': 'İç Mimar',
    'Peyzaj Mimarlığı': 'Peyzaj Mimarı',
    'Şehir ve Bölge Planlama': 'Şehir Plancısı',
    'Restorasyon': 'Restoratör',
  };

  // Uzun biyografilerde belirli bir uzunluktan sonra kes + "Devamını gör..." genişletme (bkz.
  // kullanıcı isteği) — js/components/project-meta.js#renderDescription/DESC_TRUNCATE_AT ile
  // BİREBİR aynı desen, bu modül proje modalıyla import paylaşamadığından burada tekrarlanır.
  const DESC_TRUNCATE_AT = 320;
  // gerçek bulgu (regresyon, 2026-08-13): bkz. project-meta.js#safeUrl'deki AYNI düzeltme —
  // window.location.href yerine document.baseURI kullanılır, mimar.html'deki <base href="/">
  // dikkate alınır (legacy_static kaynaklı, başında "/" olmayan photo_url değerleri artık doğru
  // mutlak yola çözülür).
  function safeUrl(u) {
    try {
      const parsed = new URL(u, document.baseURI);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
    } catch {}
    return '';
  }

  // bkz. kullanıcı isteği: profile birden fazla sosyal medya bağlantısı eklenebilsin
  // (mimar-ekle.html#social-row, migrations/0036_social_links.sql) — office-modal.js'te
  // AYNI ikon seti/fonksiyon kopyalanır.
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

  // badgeHtml: yalnızca firma/meslektaş kartlarında geçilir (bkz. kullanıcı isteği: mavi onay
  // rozetinin ilişkili TÜM alanlarda görünmesi) — proje/ürün kartlarında rozet anlamsız olduğundan
  // çağıranlar orada bu parametreyi hiç geçmez, boş string varsayılanı hiçbir şey render etmez.
  function cardHtml(href, title, image, subtitle, badgeHtml) {
    const srcset = image ? cdnSrcset(image, [300, 450, 600]) : '';
    return `<a class="related-card" href="${href}">
      <div class="related-card-photo">
        ${image ? `<img src="${escapeAttr(cdnImg(image, 450))}"${srcset ? ` srcset="${escapeAttr(srcset)}" sizes="300px"` : ''} alt="${escapeAttr(title)}" loading="lazy" decoding="async">` : `<div class="related-card-placeholder" style="background:${officeColor(title)}">${escapeHtml(initials(title))}</div>`}
      </div>
      <div class="related-card-title"><span class="related-card-title-text">${escapeHtml(title)}${badgeHtml || ''}</span>${subtitle ? `<div class="related-card-subtitle">${escapeHtml(subtitle)}</div>` : ''}</div>
    </a>`;
  }

  // Mimar profiline yazılmış ama offices tablosunda karşılığı olmayan (bkz. src/routes/
  // architect.js#fetchRawOfficeNames, `unregistered: true`) firma adı — js/components/
  // office-modal.js#unregisteredBadgeHtml ile BİREBİR aynı, yuvarlak baş harfli pasif rozet.
  function unregisteredBadgeHtml(name) {
    return `<span class="unregistered-badge" aria-disabled="true">
      <span class="unregistered-badge-avatar" style="background:${officeColor(name)}">${escapeHtml(initials(name))}</span>
      <span class="unregistered-badge-name">${escapeHtml(name)}</span>
    </span>`;
  }

  // Önceki/Sonraki Mimar — bkz. js/components/project-modal.js#renderPrevNext'teki AYNI desen,
  // src/routes/architect.js#fetchAdjacentArchitect'in döndürdüğü dairesel/sıralı id komşuları. Yön
  // kasıtlı olarak TERS çevrilmiştir (bkz. AYNI dosyadaki kullanıcı isteği/gerekçe) — payload.nextItem/
  // prevItem'in kendisi değişmedi, yalnızca hangisi .prev/.next slotunu doldurduğu swap edildi.
  // bkz. kullanıcı isteği: Önceki/Sonraki butonlarının içine önizleme görseli eklenmesi.
  function prevNextThumbHtml(item) {
    return item.image
      ? `<img class="prevnext-thumb" src="${escapeAttr(cdnImg(item.image, 120))}" alt="" loading="lazy" decoding="async">`
      : `<div class="prevnext-thumb prevnext-thumb-placeholder" style="background:${officeColor(item.title)}">${escapeHtml(initials(item.title))}</div>`;
  }

  function renderPrevNext(payload) {
    const el = document.getElementById('am-prevnext');
    let html = '';
    if (payload.nextItem) html += `<a class="prev" href="/mimar/${encodeURIComponent(payload.nextItem.slug)}">${prevNextThumbHtml(payload.nextItem)}<span class="prevnext-text"><span class="prevnext-label">← Önceki Mimar</span><span class="prevnext-title">${escapeHtml(payload.nextItem.title)}</span></span></a>`;
    if (payload.prevItem) html += `<a class="next" href="/mimar/${encodeURIComponent(payload.prevItem.slug)}">${prevNextThumbHtml(payload.prevItem)}<span class="prevnext-text"><span class="prevnext-label">Sonraki Mimar →</span><span class="prevnext-title">${escapeHtml(payload.prevItem.title)}</span></span></a>`;
    el.innerHTML = html;
  }

  // gerçek bulgu (denetim raporu, 2026-08-16): src/lib/seo.js#pageTitle SSR'daki <title>'ı zaten
  // ~60 karakterde kırpıyor, ama modal açıldığında bu client-side atama UZUN/kırpılmamış adla
  // document.title'ı eziyordu — Google'ın render-then-index akışında JS SONRASI son DOM durumu esas
  // alınır. AYNI kırpma mantığı (ad + sabit " — MİMARLAB" soneki) burada tekrarlanır.
  const TITLE_SUFFIX = ' — MİMARLAB';
  const TITLE_MAX = 60;
  function pageTitle(name) {
    const maxNameLen = TITLE_MAX - TITLE_SUFFIX.length;
    return `${name && name.length > maxNameLen ? name.slice(0, maxNameLen - 1) + '…' : name}${TITLE_SUFFIX}`;
  }

  function updateHeadMeta(a, office) {
    document.title = pageTitle(a.name);
    ModalShell.setLabel(a.name);
    const desc = office
      ? `${a.name}, ${office.name} bünyesinde ${a.role || 'mimar'} olarak görev yapmaktadır. MİMARLAB'da profilini incele.`
      : `${a.name} — MİMARLAB'da mimar profilini incele.`;
    const canonicalUrl = `https://mimarlab.com/mimar/${encodeURIComponent(slugify(a.name))}`;
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

  // displayOffice: office_id ile bağlı TEK firma (office) boşsa, buildArchitectPayload'ın döndürdüğü
  // TÜM firmalar listesine (offices — office_founders ters join'i + eşleşmeyen serbest metin firma adı,
  // bkz. src/routes/architect.js#buildArchitectPayload) düşer (bkz. gerçek bulgu: Şefik Birkiye gibi
  // office_id'si boş ama office_founders'a bağlı ya da yalnızca serbest metinde firma adı geçen
  // mimarlarda unvan yanında hiç firma adı görünmüyordu — kullanıcı isteği). offices[] zaten önce
  // gerçek (kayıtlı) firmaları, "unregistered" serbest-metin adını EN SONA koyar, bu yüzden offices[0]
  // her zaman en iyi adaydır.
  function renderStructuredData(a, displayOffice) {
    let tag = document.getElementById('am-ld-json');
    if (!tag) {
      tag = document.createElement('script');
      tag.type = 'application/ld+json';
      tag.id = 'am-ld-json';
      document.head.appendChild(tag);
    }
    const data = { '@context': 'https://schema.org', '@type': 'Person', name: a.name, url: window.location.href };
    if (a.role) data.jobTitle = a.role;
    // aynı <base href="/"> gerekçesi (bkz. yukarıdaki safeUrl yorumu) — JSON-LD'de de göreli
    // photo_url'ler window.location.href yerine document.baseURI'ye göre çözülmeli.
    if (a.photo) { try { data.image = new URL(a.photo, document.baseURI).href; } catch {} }
    if (a.school) data.alumniOf = { '@type': 'CollegeOrUniversity', name: a.school };
    if (displayOffice) {
      data.worksFor = { '@type': 'Organization', name: displayOffice.name };
      // Yalnızca gerçekten kayıtlı (linkli /firma/:slug sayfası olan) bir firma için url ekle —
      // "unregistered" serbest-metin adının kendi sayfası yok, JSON-LD'ye kırık bir URL koymamak için.
      if (!displayOffice.unregistered) data.worksFor.url = new URL('/firma/' + encodeURIComponent(slugify(displayOffice.name)), window.location.href).href;
    }
    tag.textContent = JSON.stringify(data);
  }

  // bkz. js/components/project-modal.js#HIDE_ON_NOT_FOUND_IDS AYNI gerçek bulgu: renderNotFound()
  // bu ID'leri gizliyor, ModalShell'in şablonu sayfa ömrü boyunca tek sefer mount edildiğinden bir
  // sonraki başarılı render bunları geri açmazsa modal kalıcı olarak yarı-boş görünürdü.
  const HIDE_ON_NOT_FOUND_IDS = ['am-office-section', 'am-colleagues-section', 'am-related-projects-section',
    'am-related-architects-section', 'am-related-products-section', 'am-detail-info', 'am-prevnext'];

  async function renderItem(payload) {
    HIDE_ON_NOT_FOUND_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    });
    const a = payload.item;
    const office = payload.office;
    const offices = payload.offices || (office ? [office] : []);
    const displayOffice = office || offices[0] || null;
    const colleagues = payload.colleagues || [];
    const relatedProjectsData = payload.relatedProjects || [];
    const relatedArchitectsData = payload.relatedArchitects || [];
    const designerProductsData = payload.relatedProducts || [];
    currentItem = a;

    updateHeadMeta(a, displayOffice);
    document.getElementById('am-name-text').textContent = a.name;
    document.getElementById('am-category').innerHTML = `<strong>${escapeHtml([a.role, displayOffice ? displayOffice.name : null].filter(Boolean).join(' · '))}</strong>`;
    document.getElementById('am-social-icons').innerHTML = socialIconsHtml(a.social_links);
    const aboutText = a.about || (displayOffice
      ? `${a.name}, ${displayOffice.name} bünyesinde${a.role ? ' ' + a.role + ' olarak' : ''} görev yapmaktadır.`
      : (a.role ? `${a.name}, ${a.role} olarak çalışmaktadır.` : `${a.name} — MİMARLAB dizininde yer alan bir mimar.`));
    renderTruncatedDesc('am-about', aboutText);

    const infoFactsEl = document.getElementById('am-info-facts');
    const infoFacts = [];
    if (a.dob) infoFacts.push(metaRow('calendar', `<strong>Doğum Tarihi:</strong> ${escapeHtml(String(a.dob))}`));
    // Künyede yalnızca okul/meslek adı gösterilir — a.dept (bölüm) ve a.role (pozisyon/unvan, ör.
    // "Kurucu Ortak") burada BİLEREK dışlanır (bkz. kullanıcı isteği: "Meslek: Kurucu / Mimar" yerine
    // sadece "Meslek: Mimar"). Bu iki alan başka yerlerde (meslektaş kartları, DEPT_TO_PROFESSION
    // fallback'i, üstteki başlık satırı) hâlâ kullanıldığından DB'de DEĞİŞTİRİLMEZ, sadece bu
    // künye satırlarının derlenişinden çıkarılır.
    if (a.school) infoFacts.push(metaRow('cap', `<strong>Üniversite:</strong> ${escapeHtml(a.school)}`));
    const profession = a.profession || DEPT_TO_PROFESSION[a.dept] || null;
    if (profession) infoFacts.push(metaRow('briefcase', `<strong>Meslek:</strong> ${escapeHtml(profession)}`));
    if (a.awards && a.awards.length) infoFacts.push(metaRow('award', `<strong>Ödüller:</strong> ${a.awards.map(escapeHtml).join(', ')}`));
    infoFactsEl.innerHTML = infoFacts.join('');
    infoFactsEl.style.display = infoFacts.length ? '' : 'none';

    const logoEl = document.getElementById('am-logo');
    logoEl.innerHTML = '';
    logoEl.textContent = initials(a.name);
    logoEl.style.background = officeColor(a.name);
    const photoUrl = a.photo ? safeUrl(a.photo) : '';
    if (photoUrl) {
      const img = document.createElement('img');
      img.src = photoUrl;
      img.alt = '';
      img.decoding = 'async';
      img.fetchPriority = 'high';
      img.onerror = () => img.remove();
      logoEl.appendChild(img);
    }

    // Kaydet KALDIRILDI (bkz. kullanıcı isteği: mimar/firma profillerinde Kaydet butonu artık yok) —
    // bu profillerde içerik aksiyonları Paylaş + Takip Et'tir, X'in yanında render edilir (bkz.
    // kullanıcı isteği: sırayla önce Paylaş sonra Takip Et). Düzenle/Arşivle/Sil ise X'in KARŞI
    // kenarında (ModalShell.getAdminActionsSlot()) — claim-correction-box.js#renderProfileEditButton
    // hâlâ #profile-edit-slot id'sini arıyor, yalnızca DOM konumu değişti.
    const headerActions = ModalShell.getHeaderActionsSlot();
    if (headerActions) headerActions.innerHTML = '';
    const adminActions = ModalShell.getAdminActionsSlot();
    if (adminActions) adminActions.innerHTML = '<span id="profile-edit-slot"></span>';
    const architectKey = slugify(a.name);
    if (typeof ShareWidget !== 'undefined' && headerActions) {
      headerActions.insertAdjacentHTML('beforeend', ShareWidget.html('am-share-btn'));
      ShareWidget.wire('am-share-btn', () => ({ title: a.name, url: `${window.location.origin}/mimar/${encodeURIComponent(slugify(a.name))}` }));
    }
    // Takip Et — bkz. kullanıcı isteği: archello.com/brand/ofist'teki gibi. Yanındaki sayı (bkz.
    // kullanıcı isteği: "Takip Et (12)") /api/public/follow-count'tan gelir, save-widget.js#
    // paintFollowBtn dataset.followerCount'u okuyup 0'sa parantezi hiç basmaz.
    const followBtn = document.createElement('button');
    followBtn.type = 'button';
    followBtn.className = 'follow-btn card-follow-btn';
    followBtn.id = 'am-follow-btn';
    followBtn.dataset.type = 'architect';
    followBtn.dataset.key = architectKey;
    followBtn.dataset.title = a.name;
    followBtn.innerHTML = `<span class="follow-btn-label">Takip Et</span>`;
    if (headerActions) headerActions.appendChild(followBtn);
    wireFollowButtons();
    fetch(`/api/public/follow-count?type=architect&key=${encodeURIComponent(architectKey)}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) { followBtn.dataset.followerCount = String(data.count || 0); paintFollowBtn(followBtn); } })
      .catch(() => {});
    // Mesaj Gönder — bkz. kullanıcı isteği: yalnızca doğrulanmış (rozetli) profillere gönderilebilir,
    // bu yüzden buradaki slot boş bırakılır, gerçek ikon renderVerifiedBadges() içinde (rozetler
    // hazır olduğunda) yerleştirilir/kaldırılır — Takip Et'in hemen sağında durur.
    if (typeof MessageWidget !== 'undefined' && headerActions) {
      headerActions.insertAdjacentHTML('beforeend', '<span id="am-message-slot"></span>');
    }
    const socialLinksEl = document.getElementById('am-social-links');
    if (socialLinksEl) socialLinksEl.innerHTML = typeof SocialLinks !== 'undefined' ? SocialLinks.html(a.socialPlatform, a.socialUrl) : '';

    renderStructuredData(a, displayOffice);
    renderPrevNext(payload);

    const officeSectionEl = document.getElementById('am-office-section');
    officeSectionEl.style.display = offices.length ? '' : 'none';
    // renderOfficeGrid/renderColleaguesGrid ayrı fonksiyonlar olarak tutulur (yalnızca innerHTML'i
    // yeniden çizer) — aşağıdaki renderVerifiedBadges ile AYNI /api/public/badges gecikmesi burada
    // da var: rozetler ilk çizimde henüz gelmemiş olabilir, 'mimarlab-badges-ready' ile tekrar çizilir.
    function renderOfficeGrid() {
      document.getElementById('am-office-grid').innerHTML = offices.map(off => off.unregistered
        ? unregisteredBadgeHtml(off.name)
        : cardHtml(`/firma/${encodeURIComponent(slugify(off.name))}`, off.name, logoUrl(off), [off.loc, off.yil ? 'K. ' + off.yil : null].filter(Boolean).join(' · '), verifiedBadgeHtml('office', off.name, off.badges, 14))
      ).join('');
    }
    renderOfficeGrid();

    document.getElementById('am-colleagues-section').style.display = colleagues.length ? '' : 'none';
    function renderColleaguesGrid() {
      document.getElementById('am-colleagues-grid').innerHTML = colleagues.map(c =>
        cardHtml(`/mimar/${encodeURIComponent(slugify(c.name))}`, c.name, c.photo, c.role, verifiedBadgeHtml('architect', c.name, c.badges, 14))
      ).join('');
    }
    renderColleaguesGrid();

    document.getElementById('am-related-projects-section').style.display = relatedProjectsData.length ? '' : 'none';
    document.getElementById('am-related-projects-grid').innerHTML = relatedProjectsData.map(p =>
      cardHtml(`/proje/${encodeURIComponent(p.slug)}`, p.title, p.images && p.images[0])
    ).join('');
    document.getElementById('am-related-projects-count').textContent = relatedProjectsData.length ? ` (${relatedProjectsData.length})` : '';
    renderProjectsMap(relatedProjectsData);

    // Diğer Mimarlar — kullanıcı isteği: projelerin ardından benzer yaştaki mimarlar öneri olarak
    // gösterilsin (bkz. src/routes/architect.js#buildArchitectPayload relatedArchitects, ±5 yıl
    // aralığında ORDER BY RANDOM() ile seçilir, her açılışta farklı isimler gelir).
    document.getElementById('am-related-architects-section').style.display = relatedArchitectsData.length ? '' : 'none';
    function renderRelatedArchitectsGrid() {
      document.getElementById('am-related-architects-grid').innerHTML = relatedArchitectsData.map(r =>
        cardHtml(`/mimar/${encodeURIComponent(slugify(r.name))}`, r.name, r.photo, r.dob ? String(r.dob).slice(0, 4) : null, verifiedBadgeHtml('architect', r.name, r.badges, 14))
      ).join('');
    }
    renderRelatedArchitectsGrid();

    const PROFILE_TYPE = 'architect';
    // gerçek bulgu (denetim, 2026-08-24, bkz. claim-correction-box.js#config.isStale yorumu):
    // colleagues/office ızgaralarından hızlıca başka bir mimara geçilirse, bu (eski) claimBox'ın
    // sıralı await'leri sürerken YENİ bir renderItem() zaten `currentItem`'ı güncellemiş olabilir —
    // isStale bu claimBox'ın hâlâ ekrandaki mimarla eşleşip eşleşmediğini söyler.
    const claimBox = createClaimCorrectionBox({
      profileType: PROFILE_TYPE,
      ready: savedWidgetReady,
      isStale: () => currentItem !== a,
      getProfileKey: () => a.name,
      // bkz. kullanıcı isteği (2026-08-17): "?claim=" URL'si isim yerine slug kullanınca boşluk/
      // TR karakter/em-dash içeren isimler (ör. "EAA — Emre Arolat Architecture") çirkin %-encode'lu
      // URL'ler üretiyordu. mimar-ekle.html#prefillForClaim artık slug/legacy_key/isim'in HERHANGİ
      // birini kabul edip gerçek `name`'e çözüyor (bkz. o dosyadaki AYNI 2026-08-17 güncellemesi),
      // bu yüzden burada temiz olan slug'a öncelik verilebilir.
      getClaimLinkKey: () => a.slug || a._claimKey || a.name,
      getStaticBadges: () => a.badges,
      editUrlBase: 'mimar-ekle.html',
      listUrl: 'mimar.html',
      contentType: 'architects',
      getModerationTarget: () => ({ key: a.name }),
      labels: {
        claimTitle: 'Bu profil sana mı ait?',
        loginPromptHtml: 'Bilgilerini güncellemek ve doğrulanmış üye rozeti almak için <a href="giris-yap.html" class="info-card-link">giriş yap</a>.',
        pendingHtml: '"Bu profil bana ait" talebini aldık, ekibimiz en kısa sürede onaylayacak.',
        claimNoteDescription: 'Bu profilin sana ait olduğunu doğrulayabileceğimiz bir not ekle.',
        claimButtonText: 'Gönder',
        deleteConfirm: 'Bu mimar profilini silmek istediğine emin misin? Profil anında canlı siteden kaldırılır.',
        archiveConfirm: 'Bu mimar profilini arşivlemek istediğine emin misin? Profil canlıdan kaldırılıp admin panelindeki Arşiv sekmesine taşınır.',
      },
    });

    // Ürünler ızgarası SADECE künyedeki Tasarımcı adı bu mimarla eşleşen canonical ürünleri gösterir
    // (designerProductsData, bkz. src/routes/architect.js#relatedProducts). Daha önce burada ayrıca
    // /api/public/profile-content'in owner_user_id eşleşmesiyle döndürdüğü "bu mimarın kendi
    // hesabından gönderdiği" ürünler de birleştiriliyordu — ama bir mimar başkasının tasarladığı bir
    // ürünü onun adına/firma adına gönderebilir, bu da tasarımcısı olmadığı ürünlerin profilinde
    // görünmesine yol açıyordu (gerçek bulgu, kullanıcı: "Kaan Çorbacı sadece yayınladı tasarımcısı
    // değil ki", 2026-08-30). office-modal.js'teki AYNI birleştirme kasıtlı olarak DOKUNULMADAN
    // bırakıldı — bir firmanın kendi markası altında gönderdiği ürün, sahiplik için çok daha güçlü bir
    // tasarımcı vekili.
    function renderDesignerProductsGrid() {
      document.getElementById('am-related-products-section').style.display = designerProductsData.length ? '' : 'none';
      document.getElementById('am-related-products-grid').innerHTML = designerProductsData.map(p => cardHtml(p.slug ? `/urun/${encodeURIComponent(p.slug)}` : 'urun.html', p.title, (p.images && p.images[0]) || p.image, p.category)).join('');
      document.getElementById('am-related-products-count').textContent = designerProductsData.length ? ` (${designerProductsData.length})` : '';
    }
    renderDesignerProductsGrid();

    // Mesaj Gönder ikonu — bkz. kullanıcı isteği: "Doğrulanmış mimar/firma profillerine, bir
    // kullanıcı mesaj gönderebilsin" — doğrulanmış = en az bir aktif rozeti olan profil (badge-shared.js#
    // verifiedBadgeHtml İLE AYNI dynamic-önce/static-yedek mantığı, orada sadece HTML basılır burada
    // varlık/yokluk kontrol edilir).
    function renderMessageIcon() {
      const slot = document.getElementById('am-message-slot');
      if (!slot || typeof MessageWidget === 'undefined') return;
      const dynamic = (typeof dynamicBadges !== 'undefined' && dynamicBadges.architect && dynamicBadges.architect[a.name]) || [];
      const badges = dynamic.length ? dynamic : (a.badges || []);
      // kullanıcı isteği (2026-08-30): doğrulanmış/altın üyeler TÜM profillere mesaj gönderebilsin —
      // alıcı profilin rozeti olmasa bile, GÖNDEREN (giriş yapmış kullanıcı) doğrulanmış/altın üyeyse
      // buton yine gösterilir (bkz. badge-shared.js#myEffectiveBadge).
      const senderQualifies = typeof myEffectiveBadge !== 'undefined' && !!myEffectiveBadge;
      if (!badges.length && !senderQualifies) { slot.innerHTML = ''; return; }
      if (slot.querySelector('.msg-btn')) return;
      slot.innerHTML = MessageWidget.html('am-message-btn');
      MessageWidget.wire('am-message-btn', () => ({
        profileType: 'architect',
        profileKey: a.name,
        title: a.name,
        subtitle: [a.role, displayOffice ? displayOffice.name : null].filter(Boolean).join(' · '),
        image: a.photo,
      }));
    }

    function renderVerifiedBadges() {
      document.getElementById('am-verified-badge-wrap').innerHTML = verifiedBadgeHtml(PROFILE_TYPE, a.name, a.badges, 20);
      // bkz. kullanıcı isteği: mavi rozet firma/meslektaş kartlarında da görünmeli — bu ikisi de
      // isim bazlı dynamicBadges önbelleğine bağlı olduğundan başlıktaki rozetle AYNI anda tazelenir.
      renderOfficeGrid();
      renderColleaguesGrid();
      renderRelatedArchitectsGrid();
      renderMessageIcon();
    }
    renderVerifiedBadges();
    // gerçek bulgu (denetim, 2026-08-16): window.addEventListener(..., {once:true}) her renderItem()
    // çağrısında (mimar A→B gezintisinde) yeni bir kalıcı listener ekliyordu — 'mimarlab-badges-ready'
    // sayfa ömründe genelde TEK sefer ateşlendiğinden, ilk fetch'ten SONRA açılan her profil kendini
    // asla temizlemeyen bir window listener'ı (+ kapsadığı a/offices/colleagues closure'ı) biriktiriyordu.
    // badgesReadyPromise (bkz. badge-shared.js) zaten fetch bitince bir kez resolve olan paylaşılan
    // bir promise — .then() ÇOKTAN resolve olmuşsa bile kalıcı bir kayıt bırakmadan mikro-görev
    // kuyruğunda bir kez çalışıp kendini temizler.
    if (typeof badgesReadyPromise !== 'undefined') badgesReadyPromise.then(renderVerifiedBadges);
    if (typeof myEffectiveBadgePromise !== 'undefined') myEffectiveBadgePromise.then(renderMessageIcon);

    await savedWidgetReady;
    await claimBox.init();

    wireInternalNav();
    ModalShell.scrollToTop();
  }

  function renderNotFound() {
    document.getElementById('am-name-text').textContent = 'Mimar bulunamadı';
    const headerActions = ModalShell.getHeaderActionsSlot();
    if (headerActions) headerActions.innerHTML = '';
    const adminActions = ModalShell.getAdminActionsSlot();
    if (adminActions) adminActions.innerHTML = '';
    HIDE_ON_NOT_FOUND_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  function wireInternalNav() {
    const panels = ModalShell.getPanels();
    if (!panels || panels.bodyEl.dataset.amNavWired) return;
    panels.bodyEl.dataset.amNavWired = '1';
    panels.bodyEl.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="/mimar/"]');
      if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const m = a.getAttribute('href').match(/^\/mimar\/([^/?#]+)/);
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
      const res = await fetch(`/api/architect/${encodeURIComponent(slug)}`);
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
    if (pushHistory) history.pushState({ mimarlabModal: 'architect', slug, depth: 1 }, '', `/mimar/${encodeURIComponent(slug)}`);
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
    const currentDepth = (history.state && history.state.mimarlabModal === 'architect') ? history.state.depth : pushCountSinceOpen;
    pushCountSinceOpen = currentDepth + 1;
    history.pushState({ mimarlabModal: 'architect', slug, depth: pushCountSinceOpen }, '', `/mimar/${encodeURIComponent(slug)}`);
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
    else history.pushState({}, '', '/mimar');
    ModalShell.close();
    pushCountSinceOpen = 0;
  }

  // bkz. js/components/project-modal.js#handlePopState AYNI wasCurrentPopSuperseded gerekçesi.
  function handlePopState(slug) {
    if (ModalShell.wasCurrentPopSuperseded()) return;
    if (!slug) { if (ModalShell.isOpen()) { currentSlug = null; currentItem = null; ModalShell.close(); } return; }
    if (!ModalShell.isOpen()) { openedViaPush = false; open(slug, { pushHistory: false }); return; }
    if (history.state && history.state.mimarlabModal === 'architect' && typeof history.state.depth === 'number') {
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
