// Paylaşılan detay galerisi + lightbox: proje-detay.html/urun-detay.html'de ve artık proje modalında
// (bkz. js/components/project-gallery.js) birebir aynı şerit/gezinme/klavye mantığını tekilleştirir
// (bkz. docs/architecture-roadmap.md Faz 2). Sayfaya özel olan tek şey (ürünlerde favicon'lu,
// projelerde sade baş harfli) placeholder'ın TAM HTML'i (ör. `<div class="gallery-item
// gallery-placeholder" style="...">...</div>`) çağıran sayfa tarafından hazır string olarak
// geçirilir — bu modül escapeAttr/escapeHtml'in çağıran sayfada zaten global olarak tanımlı
// olduğunu varsayar (bkz. save-widget.js gibi diğer paylaşılan script'lerle aynı desen, her sayfada
// <script src="js/components/gallery.js"> ile dahil edilir).
// initDetailGallery çağrılar arasında (bkz. altındaki gerçek bulgu) en son bağlanan document
// keydown dinleyicisini tutar — modal sahibi değiştiğinde öncekini kaldırıp yerine yenisini koymak için.
let _detailGalleryKeydownHandler = null;

// Lightbox alt çubuğunun stilleri. Sayfa CSS'lerine (proje.html / en-iyi-100.html /
// product-modal.js#injectStyles) dokunmamak için buradan enjekte edilir — .lightbox-counter'ın
// GÖRÜNÜMÜ (renk/dolgu/yuvarlaklık/şeffaflık) o üç yerde kalmaya devam eder, burada yalnızca
// KONUMLANDIRMASI çubuğun içine alınır. "Ürün Etiketle" butonu, kullanıcı isteği gereği sayaçla
// AYNI büyüklük ve şeffaflıkta olmalı — bu yüzden değerler sayacın kuralından birebir kopyalanır
// (font-size:13px / font-weight:600 / padding:6px 14px / border-radius:100px /
// background:rgba(27,42,61,0.6) / backdrop-filter:blur(3px)).
// DİKKAT: bu şablon dizesinde ters tırnak ya da // yorumu KULLANMA (bkz. proje notu
// [[feedback_no_backtick_in_style_template_literals]] — enjekte edilen CSS sessizce bozulur).
function injectGalleryBarStyles(){
  if(document.getElementById('gallery-bottombar-styles')) return;
  const style = document.createElement('style');
  style.id = 'gallery-bottombar-styles';
  style.textContent = `
    /* KUTU LIGHTBOX'IN TAMAMINI KAPLAR, ama SAYAC/BUTON hala altta ortada (kullanici istegi,
       2026-09-16 ucuncu tur madde 1: mobilde "Urun Etiketle" SOL UST kosede olsun).
       NEDEN inset:0 — eski kural "bottom:24px; left:50%; transform:translateX(-50%)" idi ve
       TRANSFORM TASIYAN BIR ATA, position:fixed cocuklar icin de kapsayici blok olur; yani
       cubugun icindeki butona ne fixed ne absolute ile ekranin ust kosesi verilebiliyordu
       (ikisi de cubugun kendi ~30px'lik kutusuna gore cozuluyordu). Cubuk artik tum alani
       kaplayan, transformsuz bir kapsayici: icindeki her oge (bkz. mobilde .lightbox-tag-btn)
       lightbox'in HERHANGI bir kosesine konumlandirilabilir.
       pointer-events:none SART: tam alani kapladigi icin aksi halde gorselin uzerindeki
       tiklamalari (isaretci/etiketleme) ve "bosluga tikla, kapat" davranisini yutardi. Cocuklar
       tiklanabilirligi geri alir. */
    .lightbox-bottombar{
      position:absolute; inset:0; z-index:2; pointer-events:none;
      display:flex; align-items:flex-end; justify-content:center; gap:10px;
      padding:0 12px 24px;
    }
    .lightbox-bottombar > *{pointer-events:auto;}
    /* Sayacin kendi mutlak konumlandirmasi (sayfa CSS'inde) cubugun icinde notrlenir.
       flex:0 0 auto + white-space:nowrap SART (yerel testte goruldu): sayac mutlak konumlandirmayken
       kendi icerigi kadar genisliyordu, flex satirina girince kucultulebilir bir oge oldu ve dar
       ekranlarda "26 / 38" ARALARINDAN kirilip uc satira yayildi. */
    .lightbox-bottombar .lightbox-counter{
      position:static; transform:none; left:auto; bottom:auto;
      flex:0 0 auto; white-space:nowrap;
    }
    .lightbox-tag-btn{
      flex:0 0 auto; border:none; cursor:pointer; white-space:nowrap;
      color:#fff; font-size:13px; font-weight:600;
      font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:rgba(27,42,61,0.6); padding:6px 14px; border-radius:100px; backdrop-filter:blur(3px);
    }
    .lightbox-tag-btn:hover{background:rgba(27,42,61,0.85);}
    .lightbox-tag-btn[disabled]{opacity:0.6; cursor:default;}
    /* Isaretleme modu acikken buton durumu belli olsun. */
    .lightbox-tag-btn.armed{background:var(--accent, #E08A3E);}
    /* Izgara ("Tumunu Gor") modunda tekli gorsel gizli — alt cubuk da onunla birlikte gider,
       aksi halde izgaranin uzerinde islevsiz bir "Urun Etiketle" butonu asili kalirdi. */
    .lightbox.grid-mode .lightbox-bottombar{display:none;}
    /* Fotoğrafçı kredisi — sağ alt köşe (kullanıcı isteği, 2026-09-10 on birinci tur madde 4). */
    .lightbox-credit{
      position:absolute; right:22px; bottom:22px; z-index:3; pointer-events:none;
      font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size:12.5px; color:rgba(237,240,243,0.92); background:rgba(27,42,61,0.55);
      padding:5px 10px; border-radius:6px; max-width:60vw; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    }
    .lightbox.grid-mode .lightbox-credit{display:none;}
    /* "KAYDET" — sag ust kosedeki butonlarin SOLUNDA (kullanici istegi, 2026-09-16 altinci tur
       madde 7: "Proje ve urun lightboxlarinda sag ustteki butonlarin sol yanlarina kaydet butonu
       da ekle"). Olculer .lightbox-close/.lightbox-grid-toggle ile AYNI (top:24px, 31px yuksek);
       o ikisi sayfa CSS'inde right:32px ve right:78px tasiyor, bu yuzden ucuncu yuva right:124px.
       Sinif card-save-btn DEGIL (bkz. save-widget.js#wireSaveButton notu): o sinifin sayfa
       CSS'lerindeki kart kurallari (position:absolute; top:10px; right:10px) burayi bozardi.
       Renk .lightbox-close ile ayni: var(--paper), opacity 0.8. Kaydedilmis durumda dolu ikon +
       tam opaklik — izgara kartlarindaki .card-save-btn.saved ile ayni gorsel dil. */
    .lightbox .lightbox-save-btn{
      position:absolute; top:24px; right:124px; z-index:2;
      /* KUTU, .lightbox-close/.lightbox-grid-toggle ile BİREBİR AYNI: 38x31 ve 8px'lik aralık
         (olculdu: close right:32..70, grid 78..116, kaydet 124..162). Yalnizca top'u eslemek
         YETMEZDI — ikon-only bir dugme 20px yuksek kalir ve merkezi ~5px yukari kayardi
         (2026-09-16 besinci turda .lightbox-tag-btn'de olculen AYNI tuzak). */
      width:38px; height:31px; box-sizing:border-box; padding:0; margin:0;
      display:inline-flex; align-items:center; justify-content:center;
      background:none; border:none;
      color:var(--paper); opacity:0.8; cursor:pointer;
    }
    .lightbox .lightbox-save-btn:hover{opacity:1;}
    .lightbox .lightbox-save-btn.saved{opacity:1;}
    .lightbox .lightbox-save-btn.saved svg{fill:currentColor;}
    .lightbox.grid-mode .lightbox-save-btn{display:none;}
    /* Kilitli (önizleme) galeri: küçük resimler tıklanabilir görünmesin. */
    .gallery-locked a.gallery-item{cursor:default;}
    .lightbox-tag-btn.is-locked{display:none !important;}
    /* Isaretleme modunda gorselin uzerinde nisangah imleci + yardim serigi. */
    .lightbox.tagging-armed img{cursor:crosshair;}
    .lightbox-tag-hint{
      position:absolute; top:24px; left:50%; transform:translateX(-50%); z-index:3;
      color:#fff; font-size:13px; font-weight:600; max-width:min(92vw, 520px); text-align:center;
      font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:rgba(27,42,61,0.82); padding:8px 16px; border-radius:100px; backdrop-filter:blur(3px);
    }
    @media (max-width:560px){
      .lightbox-bottombar{gap:8px; padding-bottom:18px;}
      /* Kullanici istegi (2026-09-16 ucuncu tur madde 1): mobilde buton SOL UST kosede.
         Cubuk artik transformsuz ve tum alani kapladigi icin (bkz. yukarisi) absolute konum
         dogrudan lightbox'in kosesine cozulur. Sol ust kose bos; sag ust kosede X ve onun
         solunda "Tumunu Gor" var.
         OLCULER OLCULDU (Chromium 390px): .lightbox-close ve .lightbox-grid-toggle kutulari
         top:24px, yukseklik 31px, sag kenardan 32px iceride. Kullanici istegi (2026-09-16
         BESINCI tur madde 2): "urun etiketle butonu da X ve tumunu gore butonuyla ayni hizada
         olsun" — bu yuzden pill AYNI kutuyu alir: top:24px + height:31px + simetrik 32px
         ic bosluk. Yalnizca top hizalamak YETMEZDI: pill 26px, ikon butonlari 31px yuksek,
         yani ustten hizalamak merkezleri ~3px kaydirirdi. Padding dikeyde sifirlanip yerine
         align-items:center konur ki metin 31px'lik kutuda ortalansin. */
      .lightbox-tag-btn{
        position:absolute; top:24px; left:32px;
        height:31px; padding:0 12px; box-sizing:border-box;
        display:inline-flex; align-items:center; font-size:12px;
      }
      .lightbox-tag-hint{font-size:12px; padding:7px 13px; top:64px;}
      /* FOTOGRAFCI ETIKETI TAM FOTOGRAFIN ALTINDA (kullanici istegi, 2026-09-16 besinci tur
         madde 2: "mobil gorunumde lightboxlardaki fotografci etiketi butonun uzerine geliyor.
         Fotografci ismini tam fotografin altinda al").
         OLCULDU (Chromium 390px): etiket sag-altta (bottom:22px/right:22px) duruyordu ve
         .lightbox-next'in tam yukseklikteki dokunma seridiyle CAKISIYORDU; ayrica goruntunun
         alt kenari 492px'te bitiyor, etiket ise 734px'te — yani fotografin "altinda" degil
         ekranin dibindeydi.
         COZUM: lightbox mobilde SUTUN yonlu bir flex olur ve etiket akisa girer (position:static),
         boylece goruntunun hemen altinda ortalanir. Akistaki tek diger cocuk goruntunun kendisi
         (kapat/oklar/izgara/alt cubuk hepsi absolute), yani sutun yonu baska hicbir seyi
         etkilemez. */
      .lightbox{flex-direction:column;}
      .lightbox-credit{
        position:static; right:auto; bottom:auto; margin:8px 0 0;
        max-width:calc(100% - 24px); text-align:center;
      }
      /* Goruntuye, etiketin yuksekligi kadar yer acilir — aksi halde max-height:100% ile
         goruntu tum alani kaplar ve etiket tasar. YALNIZCA etiket VARSA (has-credit, bkz.
         paintCredit): etiketsiz projede goruntu 34px kisalmasin. Secici .lightbox.open > img:
         dogrudan-cocuk isareti SART, cunku sayfa CSS'indeki ".lightbox img" izgara kucuk
         resimlerini de esliyor
         (bkz. css/project-detail.css#.lightbox.grid-mode > img'deki AYNI gerekce); .open ise
         ozgullugu yukseltir, yani enjekte sirasi ne olursa olsun kazanir. */
      .lightbox.open.has-credit > img{max-height:calc(100% - 34px);}
    }
  `;
  document.head.appendChild(style);
}

function initDetailGallery(opts){
  const images = (opts && opts.images) || [];
  const title = (opts && opts.title) || '';
  const placeholderHtml = (opts && opts.placeholderHtml) || '';
  const ids = (opts && opts.ids) || {};
  // Görsel üzerindeki ürün işaretçileri (kullanıcı isteği, 2026-08-31) — görsel URL'sine göre
  // anahtarlı { url: [{x,y,slug,title,brand,image}] } haritası, bkz. js/components/image-hotspots.js
  // ve src/routes/project.js#enrichImageHotspots. Ürün galerisi (product-modal.js) bu alanı hiç
  // geçmez; boş harita = işaretçi yok, davranış eskisiyle bire bir aynı kalır.
  const hotspotsByUrl = (opts && opts.hotspots) || {};
  const hasHotspots = typeof ImageHotspots !== 'undefined' && Object.keys(hotspotsByUrl).length > 0;
  const hotspotsFor = (url) => (hasHotspots && hotspotsByUrl[url]) || [];
  // "Ürün Etiketle" (kullanıcı isteği, 2026-09-05 madde 5) — YALNIZCA proje galerisinde verilir
  // (bkz. js/components/project-gallery.js). Ürün galerisi (product-modal.js) bu alanı hiç geçmez,
  // yani orada buton hiç oluşturulmaz ve davranış eskisiyle bire bir aynı kalır.
  // Biçim: { projectSlug } — yetkinin KENDİSİ burada sorulmaz, butona basıldığında
  // HotspotTagger sunucudan (GET /api/hotspot-tags/my-products) etiketlenebilir ürünleri ister ve
  // yetkisiz/ürünsüz kullanıcıya orada açıklayıcı bir mesaj gösterir. Böylece buton "her görselde
  // gözüksün" isteği karşılanırken yetki kararı TEK yerde (sunucuda) kalır.
  const tagging = (opts && opts.tagging) || null;
  // locked — ÖNİZLEME (soluk) projede medya KİLİTLİ (kullanıcı isteği, 2026-09-10 on birinci tur
  // madde 7): küçük resimler lightbox AÇMAZ, işaretçiler kurulmaz, "Ürün Etiketle" gizlenir. Kilit
  // canlı state'ten okunur (bkz. aşağıdaki _pmGalleryState gerekçesi) — dinleyiciler ilk çağrıda
  // bağlandığından bir sonraki (kilitsiz) projede aynı dinleyiciler normal çalışır.
  const locked = !!(opts && opts.locked);
  // credit — lightbox'ın sağ altında fotoğrafçı adı (madde 4: archiproducts'taki "© Pietro
  // Savorelli" deseni). Boşsa etiket hiç görünmez.
  const credit = (opts && opts.credit) ? String(opts.credit) : '';
  // credits — GÖRSEL BAŞINA fotoğrafçı (kullanıcı isteği, 2026-09-16 ikinci tur madde 1: "eğer
  // fotoğrafçı kısmına birden fazla fotoğrafçı yazıldıysa ... hangi fotoğrafı hangi fotoğrafçının
  // çektiği seçilebilsin"). Görsel URL'sine göre anahtarlı { url: 'Ad' } haritası — kaynağı
  // projects.image_credits (bkz. migrations/0122_project_image_credits.sql).
  //
  // ANAHTARI OLMAYAN KARE `credit`e (künyenin TAMAMINA) DÜŞER: bu, kolonu hiç yazılmamış tüm
  // mevcut projelerin görünümünü DEĞİŞMEDEN bırakan tek davranış — eşleme kısmen doldurulmuş bir
  // projede de seçilmemiş kareler künyenin tamamını göstermeye devam eder, boş kalmaz.
  const creditsByUrl = (opts && opts.credits) || {};
  // saveTarget (kullanici istegi, 2026-09-16 altinci tur madde 7): lightbox'ta GORSELIN KENDISINI
  // kaydetme. { title, href } — kaydedilen satirin basligi ve "tikladiginda nereye gider" adresi;
  // kaydin ANAHTARI ise gorselin kendi url'sidir (bkz. paintSaveBtnForImage). Alan verilmezse
  // buton hic olusmaz, yani bu opts'u gecmeyen cagiranlar (bugun yok) eskisi gibi calisir.
  const saveTarget = (opts && opts.saveTarget) || null;

  const galleryEl = document.getElementById(ids.gallery || 'detail-gallery');
  const galleryPrevBtn = document.getElementById(ids.galleryPrev || 'gallery-prev');
  const galleryNextBtn = document.getElementById(ids.galleryNext || 'gallery-next');
  const galleryCounter = document.getElementById(ids.galleryCounter || 'gallery-counter');
  const lightbox = document.getElementById(ids.lightbox || 'lightbox');
  const lightboxImg = document.getElementById(ids.lightboxImg || 'lightbox-img');
  const lightboxCounter = document.getElementById(ids.lightboxCounter || 'lightbox-counter');
  const lightboxClose = document.getElementById(ids.lightboxClose || 'lightbox-close');
  const lightboxPrevBtn = document.getElementById(ids.lightboxPrev || 'lightbox-prev');
  const lightboxNextBtn = document.getElementById(ids.lightboxNext || 'lightbox-next');
  if(!galleryEl || !lightbox) return;

  // "Tümünü Gör" ızgara görünümü (bkz. kullanıcı isteği: Arkitera tarzı grid modu) — sayfa
  // şablonlarında (project-modal.js/product-modal.js RIGHT_TEMPLATE) elle tanımlanmaz, ilk çağrıda
  // burada oluşturulup lightbox'ın İÇİNE eklenir. lightbox elemanının kendisi swap()'lar arasında asla
  // yeniden oluşturulmadığından (bkz. dosya başı yorum/ensureTemplate() "yalnızca ilk çağrıda" deseni)
  // bu iki eleman da kalıcı kalır — querySelector koruması sonraki initDetailGallery çağrılarında
  // yeniden yaratmaz, yalnızca içeriğini (aşağıda renderLightboxGrid) günceller.
  let lightboxGridToggle = lightbox.querySelector('.lightbox-grid-toggle');
  if(!lightboxGridToggle){
    lightboxGridToggle = document.createElement('button');
    lightboxGridToggle.type = 'button';
    lightboxGridToggle.className = 'lightbox-grid-toggle';
    lightbox.insertBefore(lightboxGridToggle, lightboxClose || lightbox.firstChild);
  }
  // ---------- "KAYDET" (madde 7) ----------
  // Sag ust kosedeki X ve "Tumunu Gor"un SOLUNDA ucuncu bir yuva. Element lightbox'in DOGRUDAN
  // cocugu (alt cubugun degil): alt cubuk izgara modunda gizlenir ve konumlandirmasi tamamen
  // farklidir; ayrica bu buton kavramsal olarak o iki ikon butonun kardesidir.
  // Kalicidir (lightbox gibi) — sonraki initDetailGallery cagrilarinda yeniden yaratilmaz, yalnizca
  // dataset'i tazelenir (bkz. paintSaveBtnForImage).
  let lightboxSaveBtn = lightbox.querySelector('.lightbox-save-btn');
  if(!lightboxSaveBtn){
    injectGalleryBarStyles();
    lightboxSaveBtn = document.createElement('button');
    lightboxSaveBtn.type = 'button';
    lightboxSaveBtn.className = 'lightbox-save-btn';
    lightboxSaveBtn.setAttribute('aria-label', 'Kaydet');
    // Izgara kartlarindaki Kaydet ikonuyla AYNI yer imi (bkz. index.html#FORYOU_SAVE_ICON).
    lightboxSaveBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z"/></svg>';
    // HEDEF SECICI (Kaydedilenler / Pano) — proje ve urun pop-up'larinin basligindaki Kaydet
    // butonuyla AYNI akis (bkz. save-widget.js#openSaveChooser, kullanici istegi: "aynı diğer
    // sayfalardaki kaydet butonu gibi popup açılsın ve ... Panolarıma mı Kaydettiklerime mi
    // kaydedilsin diye sorsun").
    lightboxSaveBtn.dataset.saveChooser = '1';
    lightboxSaveBtn.dataset.type = 'image';
    lightbox.insertBefore(lightboxSaveBtn, lightboxGridToggle);
  }
  // Kilitli (onizleme) galeride lightbox zaten acilmaz; saveTarget yoksa buton anlamsizdir.
  lightboxSaveBtn.style.display = (saveTarget && !locked) ? '' : 'none';

  let lightboxGrid = lightbox.querySelector('.lightbox-grid');
  if(!lightboxGrid){
    lightboxGrid = document.createElement('div');
    lightboxGrid.className = 'lightbox-grid';
    lightbox.appendChild(lightboxGrid);
  }

  // ---------- ALT ÇUBUK: "1 / 40" sayacı + "Ürün Etiketle" ----------
  // Kullanıcı isteği (2026-09-05 madde 5): "görsellerinin altındaki örneğin 1/40 yazan yerin yanına
  // bu sayı butonuyla aynı büyüklük ve şeffaflıkta 'Ürün Etiketle' butonu olsun."
  // Sayacın kendi konumlandırması (position:absolute; bottom:24px; left:50%) SAYFA CSS'inde tanımlı
  // ve ÜÇ ayrı yerde tekrarlanıyor (proje.html, en-iyi-100.html, product-modal.js#injectStyles).
  // "Yanına" koymanın en dayanıklı yolu, sayacı yerinde bırakıp yanına ikinci bir mutlak konumlu
  // eleman hesaplamak DEĞİL (iki elemanın genişliğine bağlı kırılgan matematik) — ikisini de bir
  // flex satırın İÇİNE almak. Çubuk buradan (JS'ten) kurulur ve sayaç onun içine TAŞINIR; sayacın
  // sayfa CSS'indeki mutlak konumlandırması çubuk içinde position:static ile nötrlenir. Böylece üç
  // sayfanın CSS'ine hiç dokunulmaz.
  let lightboxBar = lightbox.querySelector('.lightbox-bottombar');
  if(!lightboxBar){
    injectGalleryBarStyles();
    lightboxBar = document.createElement('div');
    lightboxBar.className = 'lightbox-bottombar';
    lightbox.appendChild(lightboxBar);
  }
  if(lightboxCounter && lightboxCounter.parentElement !== lightboxBar) lightboxBar.appendChild(lightboxCounter);
  let tagBtn = lightboxBar.querySelector('.lightbox-tag-btn');
  if(tagging && !tagBtn){
    tagBtn = document.createElement('button');
    tagBtn.type = 'button';
    tagBtn.className = 'lightbox-tag-btn';
    tagBtn.textContent = 'Ürün Etiketle';
    // OTURUM KAPISI (kullanıcı isteği, 2026-09-13: "Her kullanıcı ürün etiketlemesi yapabilsin").
    // ESKİ KURAL ROZETTİ (2026-09-05 takip); 2026-09-13'te kaldırıldı — artık giriş yapmış her
    // kullanıcı etiketleyebiliyor, ama etiketleme YAYINA girmiyor: firma/marka sahibi ya da admin
    // onaylayana kadar bekliyor (bkz. src/routes/hotspotTags.js tasarım notu 1).
    // Buton yine de GİZLİ doğar ve yalnızca sunucu "evet" derse açılır — varsayılanın "gizli"
    // olması şart: aksi halde yanıt gecikirse OTURUMSUZ ziyaretçiler butonu bir an için görürdü.
    // Cevap oturum başına bir kez alınır (bkz. HotspotTagger.hasAccess).
    // Bu YALNIZCA arayüz kararıdır; gerçek kapı sunucudadır (src/routes/hotspotTags.js#createTag).
    tagBtn.style.display = 'none';
    lightboxBar.appendChild(tagBtn);
    if(typeof HotspotTagger !== 'undefined'){
      HotspotTagger.hasAccess().then(function(ok){
        // Buton DOM'da kalıcı; galeri bu arada başka bir sahibe geçmiş olabilir (o durumda buton
        // aşağıdaki dalda zaten kaldırılmıştır ve parentElement null'dır).
        if(ok && tagBtn.parentElement) tagBtn.style.display = '';
      });
    }
  }
  // Galeri başka bir sahibe (ör. ürün modalı) geçtiyse önceki projeden kalan buton kaldırılır.
  if(!tagging && tagBtn){ tagBtn.remove(); tagBtn = null; }

  // KALDIRILDI (kullanıcı isteği, 2026-09-16 üçüncü tur madde 2): lightbox'taki "Fotoğraf bana
  // ait" butonu. Akışın KENDİSİ yaşıyor ama artık kişi pop-up'ındaki "Fotoğraflarını Bul"
  // düğmesinden başlıyor (bkz. js/components/photo-finder.js) — orada kullanıcı bir GÖRSEL değil
  // bir PROJE seçiyor. Eski butondan kalan bir DOM düğümü varsa (aynı lightbox elemanı swap'lar
  // arasında korunuyor) temizlenir.
  const staleClaimBtn = lightboxBar.querySelector('.lightbox-claim-btn');
  if(staleClaimBtn) staleClaimBtn.remove();

  // Bu fonksiyon proje-detay.html/urun-detay.html'de sayfa başına yalnızca BİR kez çağrılırdı; proje
  // modalı (bkz. project-modal.js#swap) ise AYNI DOM üzerinde projeden projeye tekrar tekrar çağırır.
  // Durum (images/index) bu yüzden galeri elemanının kendi üzerinde KALICI bir nesnede tutulur
  // (her çağrıda yeniden oluşturulmaz, yalnızca mutasyona uğrar) ve aşağıdaki buton/klavye
  // listener'ları yalnızca İLK çağrıda bağlanıp state'i HER ZAMAN bu canlı nesneden okur — aksi
  // halde (bkz. gerçek bulgu) her swap() yeni bir kapanış/listener seti ekler, N proje sonra aynı ok
  // tuşuna basmak N eski kapanışı BİRDEN tetikleyip birbiriyle çakışan/DOM'dan kopmuş elemanlara
  // başvuran kırık bir gezinmeye dönüşürdü.
  const state = galleryEl._pmGalleryState || (galleryEl._pmGalleryState = {});
  state.images = images;
  state.hotspotsByUrl = hotspotsByUrl;
  // tagging her çağrıda (her projede) DEĞİŞİR ama buton/dinleyicileri DOM'da kalıcıdır — bu yüzden
  // aktif projenin slug'ı state üzerinden CANLI okunur, dinleyicinin kapanışına gömülmez (bkz.
  // yukarıdaki _pmGalleryState gerekçesi: ilk çağrıda bağlanan dinleyiciler sonraki projelerde de
  // doğru çalışmalı — aksi halde N. projede hâlâ 1. projenin slug'ına etiket gönderilirdi).
  state.tagging = tagging;
  state.locked = locked;
  state.credit = credit;
  state.credits = creditsByUrl;
  state.saveTarget = saveTarget;
  // Fotoğraf kredisi etiketi — lightbox DOM'unda kalıcı, metni showLightboxImage her görselde
  // (state'ten) tazeler. Kilitli galeride lightbox zaten açılmaz, etiket önemsizdir.
  let creditEl = lightbox.querySelector('.lightbox-credit');
  if(!creditEl){
    creditEl = document.createElement('div');
    creditEl.className = 'lightbox-credit';
    lightbox.appendChild(creditEl);
  }
  creditEl.textContent = credit ? `© ${credit}` : '';
  creditEl.hidden = !credit;
  // bkz. paintCredit#has-credit — ilk durum burada kurulur, her görselde orada tazelenir.
  lightbox.classList.toggle('has-credit', !!credit);
  // is-locked sınıfı: HotspotTagger.hasAccess() geri çağrısı style.display'i geri açabildiğinden
  // hidden özniteliği yerine CSS sınıfı (display:none !important) kullanılır.
  if(tagBtn) tagBtn.classList.toggle('is-locked', locked);
  galleryEl.classList.toggle('gallery-locked', locked);
  state.galleryIndex = 0;
  state.lightboxIndex = 0;
  // scrollLeft, galleryEl'in İÇERİĞİNE değil KENDİSİNE ait bir özellik — innerHTML'i aşağıda
  // tamamen değiştirmek bunu SIFIRLAMAZ (bkz. gerçek bulgu: proje modalında swap() ile başka bir
  // projeye geçildiğinde şerit, index sıfırlanmasına rağmen ÖNCEKİ projede kaydırılmış olduğu piksel
  // konumunda görünmeye devam ediyordu). state.galleryIndex=0 ile görsel kaydırma konumu arasında
  // tutarlılık için burada açıkça sıfırlanır.
  galleryEl.scrollLeft = 0;
  // Her yeni galeri yüklemesinde (ör. proje modalında swap()) ızgara modu KAPALI başlar — bir önceki
  // projede "Tümünü Gör" açık bırakılmış olsa bile yeni proje her zaman tekli slayt görünümüyle açılır.
  lightbox.classList.remove('grid-mode');

  // Şerit her zaman KÜÇÜK bir önizleme (cdnImg/cdnSrcset, bkz. image-cdn.js) yükler — orijinal
  // çözünürlük yalnızca lightbox açıldığında istenir (bkz. showLightboxImage, state.images ORİJİNAL
  // URL'leri değişmeden tutar, yalnızca burada şerit <img>'inin src/srcset'i küçültülür).
  galleryEl.innerHTML = images.length ? images.map((img, i) => {
    const srcset = cdnSrcset(img, [320, 480, 640]);
    return `<a href="#" class="gallery-item" data-index="${i}"><img src="${escapeAttr(cdnImg(img, 480))}"${srcset ? ` srcset="${escapeAttr(srcset)}" sizes="480px"` : ''} alt="${escapeAttr(title)}" ${i === 0 ? 'loading="eager" fetchpriority="high" decoding="sync"' : 'loading="lazy" decoding="async"'}></a>`;
  }).join('') : placeholderHtml;
  state.galleryItems = Array.from(galleryEl.querySelectorAll('.gallery-item'));
  // Şeritteki işaretçiler — galleryEl.innerHTML yukarıda yeniden yazıldığından her çağrıda yeniden
  // kurulur (eski katmanlar o DOM ile birlikte zaten yok oldu).
  mountThumbHotspots();

  function updateGalleryCounter(){
    const st = galleryEl._pmGalleryState;
    if(galleryCounter) galleryCounter.textContent = `${st.galleryIndex + 1} / ${st.galleryItems.length}`;
  }
  function goToGalleryIndex(i){
    const st = galleryEl._pmGalleryState;
    if(!st.galleryItems.length) return;
    st.galleryIndex = (i + st.galleryItems.length) % st.galleryItems.length;
    galleryEl.scrollTo({ left: st.galleryItems[st.galleryIndex].offsetLeft - galleryEl.offsetLeft, behavior: 'smooth' });
    updateGalleryCounter();
  }
  // openHotspotIndex: şeritteki bir işaretçiden büyütmeye geçilirken (bkz. mountThumbHotspots)
  // hangi ürün kartının hemen açılacağı — normal gezinmede (ok/swipe/klavye) verilmez.
  function showLightboxImage(i, openHotspotIndex){
    const st = galleryEl._pmGalleryState;
    if(!st.images.length) return;
    st.lightboxIndex = (i + st.images.length) % st.images.length;
    const img = st.images[st.lightboxIndex];
    // gerçek bulgu (denetim raporu, AUDIT-006): burada önceden ORİJİNAL, hiç yeniden boyutlandırılmamış
    // görsel yükleniyordu (bkz. yukarıdaki dosya başı yorum) — projects/ altındaki ortalama ~260KB'lık
    // (bazıları çok daha büyük) orijinaller hiçbir üst sınır/srcset olmadan mobilde bile tam boyutuyla
    // indiriliyordu. Şerit/ızgaradaki AYNI cdnImg/cdnSrcset deseni burada da uygulanır — lightbox tam
    // ekran genişliğinde göründüğünden sizes="100vw", üst sınır 2000px (ekranların büyük çoğunluğu için
    // yeterli çözünürlük, yine de orijinalden belirgin küçük).
    const srcset = cdnSrcset(img, [800, 1200, 1600, 2000]);
    lightboxImg.src = cdnImg(img, 1600);
    if(srcset){ lightboxImg.srcset = srcset; lightboxImg.sizes = '100vw'; }
    else { lightboxImg.removeAttribute('srcset'); lightboxImg.removeAttribute('sizes'); }
    if(lightboxCounter) lightboxCounter.textContent = `${st.lightboxIndex + 1} / ${st.images.length}`;
    paintCredit(img);
    paintSaveBtnForImage(img);
    mountLightboxHotspots(img, openHotspotIndex);
  }

  // Sağ alt köşedeki "© ..." etiketi HER görsel değişiminde tazelenir (kullanıcı isteği,
  // 2026-09-16 ikinci tur madde 1) — eskiden metin init'te BİR kez yazılıyordu ve galeri boyunca
  // sabit kalıyordu. Görselin kendi kaydı yoksa künyenin tamamına düşülür (bkz. creditsByUrl notu).
  // state'ten CANLI okunur: bu fonksiyonu çağıran dinleyiciler yalnızca İLK çağrıda bağlanıyor,
  // kapanışa gömülen bir değer N. projede hâlâ 1. projenin künyesini yazardı.
  function paintCredit(url){
    const st = galleryEl._pmGalleryState;
    const el = lightbox.querySelector('.lightbox-credit');
    if(!el || !st) return;
    const name = (st.credits && st.credits[url]) || st.credit || '';
    el.textContent = name ? `© ${name}` : '';
    el.hidden = !name;
    // has-credit — mobilde etiket AKIŞA girdiğinden (bkz. o media sorgusu) görüntüye onun
    // yüksekliği kadar yer açılması gerekir; etiketi OLMAYAN karede görüntü kısalmasın diye
    // sınıf görsel başına toggle edilir (etiket de görsel başına değişiyor).
    lightbox.classList.toggle('has-credit', !!name);
  }

  // Kaydet butonunun HEDEFI HER GORSELDE DEGISIR: kaydedilen sey projenin/urunun kendisi degil
  // GORSELIN KENDISIDIR (kullanici istegi: "Kullanıcılar sadece görsel de kaydedebilsinler").
  // ANAHTAR GORSELIN URL'SI — indeks DEGIL: proje-ekle'de gorseller siralanabiliyor ve indeks
  // tabanli bir anahtar her siralamada baska bir kareye isaret ederdi (image_hotspots/image_credits
  // ile AYNI gerekce, bkz. migrations/0076 ve 0122).
  // item_image de AYNI ham url: Kaydettiklerim satiri onu site kokune gore cozer (safeUrl).
  // wireSaveButton her cagrida yeniden BOYAR ama dinleyiciyi bir kez takar (idempotent).
  function paintSaveBtnForImage(url){
    const st = galleryEl._pmGalleryState;
    const btn = lightbox.querySelector('.lightbox-save-btn');
    if(!btn) return;
    // save-widget.js olmadan buton HİÇBİR ŞEY yapmaz (tıklama yalnızca /api/saved akışını oradan
    // alır) — o dosya yüklenmemişse işlevsiz bir düğme göstermek yerine gizlenir. Kontrol init'te
    // DEĞİL burada: init bir modal açılışında koşuyor olabilir, save-widget ise <script defer>
    // sırasına göre biraz sonra yüklenir; bu fonksiyon ise her lightbox açılışında yeniden çalışır.
    if(!st || !st.saveTarget || typeof wireSaveButton !== 'function'){ btn.style.display = 'none'; return; }
    btn.style.display = '';
    btn.dataset.type = 'image';
    btn.dataset.key = url;
    btn.dataset.image = url;
    btn.dataset.title = st.saveTarget.title || '';
    btn.dataset.meta = st.saveTarget.meta || '';
    btn.dataset.href = st.saveTarget.href || '';
    wireSaveButton(btn);
  }

  // Büyütülmüş görselin işaretçileri. Katman lightbox'ın (position:fixed, yani konumlandırılmış bir
  // kutu) çocuğu olarak img'nin boyandığı dikdörtgene oturur — img max-width/max-height ile
  // küçüldüğünden kendi kutusu ZATEN görselin kendisidir (fit:'contain').
  function mountLightboxHotspots(url, openHotspotIndex){
    if(typeof ImageHotspots === 'undefined' || !lightboxImg) return;
    ImageHotspots.mount(lightbox, lightboxImg, hotspotsFor(url), {
      fit: 'contain',
      openIndex: typeof openHotspotIndex === 'number' ? openHotspotIndex : undefined,
    });
  }

  // ---------- "Ürün Etiketle" işaretleme modu (kullanıcı isteği, 2026-09-05 madde 5) ----------
  // İki adımlı: butona bas -> mod açılır (nişangah imleci + yardım şeridi), sonra görselde ürünün
  // olduğu noktaya tıkla/dokun -> o noktanın YÜZDE koordinatıyla etiketleme formu açılır.
  // Neden iki adım: tek adımda (butona basınca ortaya bir form açmak) marka sahibinin ürünün TAM
  // yerini göstermesi mümkün olmazdı; işaretçinin bütün değeri konumunda.
  function setArmed(on){
    lightbox.classList.toggle('tagging-armed', on);
    const btn = lightbox.querySelector('.lightbox-tag-btn');
    if(btn){
      btn.classList.toggle('armed', on);
      btn.textContent = on ? 'Vazgeç' : 'Ürün Etiketle';
    }
    let hint = lightbox.querySelector('.lightbox-tag-hint');
    if(on){
      if(!hint){
        hint = document.createElement('div');
        hint.className = 'lightbox-tag-hint';
        lightbox.appendChild(hint);
      }
      hint.textContent = 'Ürünün görseldeki yerine dokun.';
    } else if(hint){ hint.remove(); }
  }
  function isArmed(){ return lightbox.classList.contains('tagging-armed'); }

  // Şeritteki küçük görsellerin işaretçileri. Burada kart AÇILMAZ (ankor overflow:hidden ile
  // kırpardı, bkz. image-hotspots.js dosya başı) — işaretçiye tıklamak görseli büyütür ve kartı
  // orada açar. Görsel henüz yüklenmemiş olabileceğinden (naturalWidth 0) mount, ImageHotspots'un
  // kendi 'load' dinleyicisiyle kendini yeniden konumlandırır.
  function mountThumbHotspots(){
    if(locked) return; // önizleme: işaretçi yok (bkz. opts.locked)
    if(typeof ImageHotspots === 'undefined' || !hasHotspots) return;
    const st = galleryEl._pmGalleryState;
    galleryEl.querySelectorAll('a.gallery-item').forEach(a=>{
      const idx = parseInt(a.dataset.index, 10);
      const img = a.querySelector('img');
      if(!img || Number.isNaN(idx)) return;
      ImageHotspots.mount(a, img, hotspotsFor(st.images[idx]), {
        fit: 'cover',
        interactive: false,
        onSelect: (hotspotIndex)=>{
          setGridMode(false);
          lightbox.classList.add('open');
          showLightboxImage(idx, hotspotIndex);
        },
      });
    });
  }

  // İkon-only, metinsiz (bkz. kullanıcı isteği: minimalist) — boyut/stroke-width lightbox-close'daki
  // ("X") svg ile BİREBİR AYNI (26x26, stroke-width 2) ki iki buton görsel olarak eşleşsin.
  // Grid: 3x2 (üstte 3, altta 3) toplam 6 kare. Slaytlara dön: tekli fotoğraf/resim ikonu (çerçeve+dağ+güneş).
  const GRID_TOGGLE_ICON = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="5" height="5"/><rect x="9.5" y="4" width="5" height="5"/><rect x="17" y="4" width="5" height="5"/><rect x="2" y="15" width="5" height="5"/><rect x="9.5" y="15" width="5" height="5"/><rect x="17" y="15" width="5" height="5"/></svg>';
  const SLIDES_TOGGLE_ICON = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5-9 9"/></svg>';
  function setGridMode(on){
    lightbox.classList.toggle('grid-mode', on);
    lightboxGridToggle.innerHTML = on ? SLIDES_TOGGLE_ICON : GRID_TOGGLE_ICON;
    // Metin etiketi kaldırıldığından (bkz. kullanıcı isteği: yalnızca ikon) erişilebilirlik için
    // aria-label state'e göre güncellenir.
    lightboxGridToggle.setAttribute('aria-label', on ? 'Slaytlara dön' : 'Tümünü gör');
  }
  // Izgara HTML'i şerit gibi HER çağrıda (yeni proje/ürün geldiğinde) yeniden üretilir — küçük
  // önizleme boyutları kullanılır (şeritteki AYNI cdnImg/cdnSrcset deseni), orijinal çözünürlük
  // yalnızca tekli lightbox moduna geçildiğinde (showLightboxImage) istenir.
  function renderLightboxGrid(){
    const st = galleryEl._pmGalleryState;
    lightboxGrid.innerHTML = st.images.length ? `<div class="lightbox-grid-list">${st.images.map((img, i) => {
      const srcset = cdnSrcset(img, [240, 360, 480]);
      return `<a href="#" class="lightbox-grid-item" data-index="${i}"><img src="${escapeAttr(cdnImg(img, 360))}"${srcset ? ` srcset="${escapeAttr(srcset)}" sizes="240px"` : ''} alt="${escapeAttr(title)}" loading="lazy" decoding="async"></a>`;
    }).join('')}</div>` : '';
  }
  renderLightboxGrid();
  setGridMode(false);

  const hasMultiple = images.length > 1;
  if(galleryPrevBtn) galleryPrevBtn.style.display = hasMultiple ? '' : 'none';
  if(galleryNextBtn) galleryNextBtn.style.display = hasMultiple ? '' : 'none';
  if(galleryCounter) galleryCounter.style.display = hasMultiple ? '' : 'none';
  if(lightboxPrevBtn) lightboxPrevBtn.style.display = hasMultiple ? '' : 'none';
  if(lightboxNextBtn) lightboxNextBtn.style.display = hasMultiple ? '' : 'none';
  if(lightboxCounter) lightboxCounter.style.display = hasMultiple ? '' : 'none';
  // Tek görselli (ya da görselsiz) projelerde "Tümünü Gör" bir ızgara/tekli ayrımı sunmadığından
  // ok/sayaç butonlarıyla AYNI mantıkla gizlenir.
  if(lightboxGridToggle) lightboxGridToggle.style.display = hasMultiple ? '' : 'none';
  if(hasMultiple) updateGalleryCounter();

  // Şerit öğelerine tıklama HER çağrıda yeniden bağlanır — galleryEl.innerHTML yukarıda zaten
  // sıfırlandığından bu DOM elemanları her seferinde YENİ, eski listener'lar onlarla birlikte
  // zaten yok oldu (leak riski yok, klasik/beklenen davranış).
  // gerçek bulgu (denetim, 2026-08-24): seçici düz `.gallery-item` idi — görselsiz bir proje/ürün
  // için gösterilen baş harfli/logo `placeholderHtml` (bkz. ProjectGallery.render/product-modal.js)
  // de AYNI `.gallery-item` sınıfını taşıyan sade bir <div> (data-index YOK, <a> değil). Bu yüzden
  // placeholder'a tıklamak da lightbox'ı AÇIYORDU — showLightboxImage NaN indeksle çağrılıp
  // `!st.images.length` koşulunda hemen dönüyor (görsel hiç set edilmiyor), ama lightbox.open sınıfı
  // yine de ekleniyor: kullanıcı boş/karanlık, ok/sayaç'sız bir ekranla karşılaşıyordu. Seçici artık
  // yalnızca gerçek <a class="gallery-item"> küçük resimlerini hedefler.
  galleryEl.querySelectorAll('a.gallery-item').forEach(a=>{
    a.addEventListener('click', (e)=>{
      e.preventDefault();
      if(galleryEl._pmGalleryState.locked) return; // önizleme: medya kilitli, büyütme yok
      showLightboxImage(parseInt(a.dataset.index, 10));
      setGridMode(false);
      lightbox.classList.add('open');
    });
  });

  // Butonlar/klavye: yalnızca İLK çağrıda bağlanır (bkz. dosya başı yorum) — state her zaman
  // galleryEl._pmGalleryState üzerinden CANLI okunduğundan ilk çağrıda bağlanan fonksiyonlar
  // sonraki çağrılardaki güncel veriyle de doğru çalışmaya devam eder.
  if(galleryEl.dataset.pmWired) return;
  galleryEl.dataset.pmWired = '1';

  if(galleryPrevBtn) galleryPrevBtn.addEventListener('click', () => goToGalleryIndex(galleryEl._pmGalleryState.galleryIndex - 1));
  if(galleryNextBtn) galleryNextBtn.addEventListener('click', () => goToGalleryIndex(galleryEl._pmGalleryState.galleryIndex + 1));
  let galleryScrollTimer = null;
  galleryEl.addEventListener('scroll', () => {
    clearTimeout(galleryScrollTimer);
    galleryScrollTimer = setTimeout(() => {
      const st = galleryEl._pmGalleryState;
      let closest = 0, closestDist = Infinity;
      st.galleryItems.forEach((item, idx) => {
        const dist = Math.abs((item.offsetLeft - galleryEl.offsetLeft) - galleryEl.scrollLeft);
        if(dist < closestDist){ closestDist = dist; closest = idx; }
      });
      st.galleryIndex = closest;
      updateGalleryCounter();
    }, 100);
  });

  if(lightboxClose) lightboxClose.addEventListener('click', ()=>{ setArmed(false); lightbox.classList.remove('open'); });
  if(lightboxPrevBtn) lightboxPrevBtn.addEventListener('click', (e)=>{ e.stopPropagation(); showLightboxImage(galleryEl._pmGalleryState.lightboxIndex - 1); });
  if(lightboxNextBtn) lightboxNextBtn.addEventListener('click', (e)=>{ e.stopPropagation(); showLightboxImage(galleryEl._pmGalleryState.lightboxIndex + 1); });
  lightboxGridToggle.addEventListener('click', (e)=>{
    e.stopPropagation();
    setArmed(false);
    setGridMode(!lightbox.classList.contains('grid-mode'));
  });

  // "Ürün Etiketle" — buton DOM'da kalıcı olduğundan (bkz. yukarısı) dinleyici de yalnızca burada,
  // bir kez bağlanır; aktif proje state.tagging'den CANLI okunur.
  const tagBtnEl = lightbox.querySelector('.lightbox-tag-btn');
  if(tagBtnEl) tagBtnEl.addEventListener('click', (e)=>{
    e.stopPropagation();
    setArmed(!isArmed());
  });
  // Görselin üzerine tıklama/dokunma — YALNIZCA işaretleme modu açıkken bir anlam taşır. capture
  // fazında dinlenir: ImageHotspots kendi katmanını lightbox'a ekliyor ve orada da tıklama
  // dinleyicileri var; işaretleme modundayken o davranışların (kart açma/kapatma) araya girmemesi
  // için olay burada durdurulur.
  if(lightboxImg) lightboxImg.addEventListener('click', (e)=>{
    if(!isArmed()) return;
    e.preventDefault();
    e.stopPropagation();
    const st = galleryEl._pmGalleryState;
    const tag = st && st.tagging;
    if(!tag || typeof HotspotTagger === 'undefined') { setArmed(false); return; }
    // Koordinat, görselin BOYANDIĞI dikdörtgene göre yüzdedir — image-hotspots.js'in okuduğu ölçüyle
    // birebir aynı (lightbox'ta img max-width/max-height ile küçüldüğünden kendi kutusu zaten
    // görselin kendisidir, yani getBoundingClientRect doğrudan kullanılabilir).
    const rect = lightboxImg.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    setArmed(false);
    HotspotTagger.open({
      hostEl: lightbox,
      projectSlug: tag.projectSlug,
      imageUrl: st.images[st.lightboxIndex],
      x, y,
    });
  }, true);
  // Izgaradaki bir kutucuğa tıklamak o indeksten tekli lightbox moduna döner (bkz. kullanıcı isteği).
  // Tek bir delege dinleyici (lightboxGrid kalıcı, innerHTML her çağrıda değişse de element aynı) —
  // showLightboxImage state'i her zaman CANLI okuduğundan yalnızca İLK çağrıda bağlanması yeterli.
  lightboxGrid.addEventListener('click', (e)=>{
    const a = e.target.closest('.lightbox-grid-item');
    if(!a) return;
    e.preventDefault();
    showLightboxImage(parseInt(a.dataset.index, 10));
    setGridMode(false);
  });
  // gerçek bulgu: yalnızca `e.target === lightbox` kontrol ediliyordu — "Tümünü Gör" ızgara modunda
  // lightboxGrid, lightbox'ı `position:absolute; inset:0` ile TAMAMEN kapladığından (bkz. dosya başı
  // #lightboxGrid oluşturma) tıklama her zaman lightboxGrid'e (ya da bir alt öğesine) düşer, `e.target
  // === lightbox` bu modda ASLA doğru olmaz — arka plana (karartılmış boşluğa) tıklayarak kapatma
  // ızgara modunda tamamen ölüydü (X/Escape ile hâlâ kapanabiliyordu, ama tutarsız bir davranış
  // boşluğuydu). lightboxGrid'in kendisine (bir .lightbox-grid-item'a değil) düşen tıklamalar da
  // artık aynı şekilde kapatır.
  lightbox.addEventListener('click', (e)=>{
    if(e.target !== lightbox && e.target !== lightboxGrid) return;
    // İşaretleme modundayken görselin YANINDAKİ karanlık boşluğa dokunmak lightbox'ı kapatmak yerine
    // yalnızca modu kapatır — dokunmatikte "ürünün yerine dokun" hedefini ıskalamak çok kolay ve
    // ıskalamanın bedeli tüm fotoğrafın kapanması olmamalı.
    if(isArmed()){ setArmed(false); return; }
    lightbox.classList.remove('open');
  });
  // gerçek bulgu: e.stopPropagation() TEK BAŞINA burada işe yaramıyordu — proje modalı (bkz.
  // js/components/modal-shell.js#onKeydown) KENDİ Escape dinleyicisini document'e bu koddan ÖNCE
  // (ModalShell.open() her zaman ensureTemplate()'ten, dolayısıyla bu initDetailGallery çağrısından
  // önce çalışır) bubble fazında bağlıyor; stopPropagation yalnızca üst elemanlara YAYILMAYI durdurur,
  // AYNI elemandaki (document) BAŞKA bir dinleyiciyi durdurmaz — modal-shell'in dinleyicisi bağlanma
  // SIRASINA göre zaten önce çalışıp modalı kapatıyordu, lightbox'ın kendi kapanışı hiç fark
  // etmeksizin. Çözüm: bu dinleyici CAPTURE fazında (üçüncü argüman=true) bağlanır — capture fazı
  // HER ZAMAN bubble fazından önce çalışır (bağlanma sırasından bağımsız olarak), lightbox açıkken
  // burada çağrılan stopPropagation olayın capture'da document'ten hedefe inmesini (dolayısıyla
  // sonraki bubble fazını, yani modal-shell'in dinleyicisini) tamamen durdurur.
  // gerçek bulgu (denetim, 2026-08-24): bu dinleyici hiç kaldırılmıyordu. Modal "sahibi" değiştiğinde
  // (bkz. modal-shell.js#claimContent — ör. bir projeden bir firma/mimar popup'ına geçilip sonra
  // tekrar bir projeye dönüldüğünde) RIGHT_TEMPLATE'in tüm HTML'i (dolayısıyla bu galleryEl/lightbox)
  // baştan kurulur ve initDetailGallery YENİDEN çağrılır — `galleryEl.dataset.pmWired` yeni elemanda
  // henüz yokken bu blok tekrar çalışıp document'e BİR dinleyici DAHA ekliyordu; öncekiler artık kopuk
  // (DOM'dan koparılmış) eski galleryEl/lightbox'a kapalı kalıp asla temizlenmiyordu — modal-shell.js'in
  // ResizeObserver/MutationObserver'lar için zaten çözdüğü AYNI sınırsız birikim sınıfı (bkz. o
  // dosyadaki gridObservers/disconnectGridObservers). Pratikte görünür bir bozulmaya yol açmıyordu
  // (her kopan dinleyici `.classList.contains('open')` kontrolünde hep false alıp no-op kalıyordu),
  // ama modül-seviyesi TEK bir referansla öncekini kaldırıp yenisini eklemek sızıntıyı kökten kapatır.
  if(_detailGalleryKeydownHandler) document.removeEventListener('keydown', _detailGalleryKeydownHandler, true);
  _detailGalleryKeydownHandler = (e)=>{
    if(!lightbox.classList.contains('open')) return;
    // İşaretleme modu açıkken Escape ÖNCE o modu kapatır (lightbox'ı değil) — kullanıcı yanlışlıkla
    // moda girdiyse fotoğrafı kaybetmeden geri dönebilsin.
    if(e.key === 'Escape' && isArmed()){ e.stopPropagation(); setArmed(false); return; }
    if(e.key === 'Escape'){ e.stopPropagation(); setArmed(false); lightbox.classList.remove('open'); return; }
    // Izgara modundayken sol/sağ ok tuşları slayt gezinmesini TETİKLEMEMELİ — tekli görsel zaten
    // gizli, gezinme yalnızca kafa karıştırırdı (bkz. dokunmatik/wheel'deki AYNI koruma aşağıda).
    if(lightbox.classList.contains('grid-mode')) return;
    if(e.key === 'ArrowLeft') showLightboxImage(galleryEl._pmGalleryState.lightboxIndex - 1);
    else if(e.key === 'ArrowRight') showLightboxImage(galleryEl._pmGalleryState.lightboxIndex + 1);
  };
  document.addEventListener('keydown', _detailGalleryKeydownHandler, true);

  // Dokunmatik kaydırma (bkz. kullanıcı isteği: mobil/tablette parmakla görseller arası geçiş) —
  // yatay hareket dikeyden belirgin şekilde baskınsa (aksi halde sayfayı dikey kaydırmaya çalışan bir
  // dokunuş yanlışlıkla görsel değiştirebilirdi) ve eşiği (SWIPE_THRESHOLD) geçiyorsa bir sonraki/
  // önceki görsele geçilir; touchmove'da preventDefault YALNIZCA yatay niyet netleştiğinde çağrılır,
  // aksi halde dikey sayfa kaydırması (varsa) engellenmiş olurdu.
  const SWIPE_THRESHOLD = 40;
  let touchStartX = 0, touchStartY = 0, touchActive = false, touchIntentHorizontal = false;
  lightbox.addEventListener('touchstart', (e)=>{
    // Izgara modunda dokunuş, ızgaranın kendi DİKEY kaydırmasına (overflow-y:auto) bırakılır —
    // tekli görsel zaten gizli olduğundan yatay swipe algılaması burada anlamsız/istenmeyen.
    if(lightbox.classList.contains('grid-mode')) return;
    if(e.touches.length !== 1) return;
    // KULLANICI İSTEĞİ 2026-09-05 madde 4 (tablet/mobilde işaretçilerin düzgün çalışması) —
    // GERÇEK BULGU: bir işaretçi dairesine ya da açık önizleme kartına yapılan dokunuşta parmak
    // birkaç piksel kayıyor (dokunmatikte kaçınılmaz); eşik 40px'e ulaşan bir kaymada touchend
    // görseli DEĞİŞTİRİYOR ve dokunulan işaretçinin kartı hiç açılmıyordu — kullanıcı açısından
    // "işaretçiye basıyorum, fotoğraf atlıyor". Dokunuş bir işaretçi/kart üzerinde BAŞLADIYSA swipe
    // takibi hiç başlatılmaz; kaydırmak isteyen kullanıcı görselin herhangi bir yerinden (daire
    // dışından) başlatabilir. Aynı koruma "Ürün Etiketle" formu (.ht-form) için de geçerli: form
    // içindeki dokunuşlar swipe'a dönüşmemeli.
    if(e.target.closest && e.target.closest('.ih-dot, .ih-card, .ht-form, .lightbox-tag-hint')) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchActive = true;
    touchIntentHorizontal = false;
  }, { passive: true });
  // gerçek bulgu (denetim, 2026-08-24): preventDefault yalnızca yatay niyet netleştiğinde
  // çağrılıyordu — dikey (ya da henüz netleşmemiş) bir dokunuş sürüklemesi hiç engellenmediğinden
  // tarayıcının varsayılan scroll-chaining'i devreye girip lightbox'ın (position:fixed, kendi
  // scroll edilecek içeriği YOK) ALTINDAKİ .modal-shell-body'yi kaydırıyordu — kullanıcı tam ekran
  // fotoğrafa bakarken dikey parmak hareketi görünmez şekilde arkadaki proje/ürün sayfasını
  // kaydırıyor, lightbox kapatıldığında "sayfa sıçramış" gibi hissettiriyordu. Izgara modu dışında
  // lightbox'ın zaten kaydıracak bir içeriği olmadığından tek-parmak sürüklemesi yöne bakılmaksızın
  // engellenir; yatay/dikey ayrımı yalnızca navigasyon KARARI (touchend) için korunur.
  lightbox.addEventListener('touchmove', (e)=>{
    if(!touchActive || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;
    if(!touchIntentHorizontal && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) touchIntentHorizontal = true;
    e.preventDefault();
  }, { passive: false });
  lightbox.addEventListener('touchend', (e)=>{
    if(!touchActive) return;
    touchActive = false;
    if(!touchIntentHorizontal) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if(dx <= -SWIPE_THRESHOLD) showLightboxImage(galleryEl._pmGalleryState.lightboxIndex + 1);
    else if(dx >= SWIPE_THRESHOLD) showLightboxImage(galleryEl._pmGalleryState.lightboxIndex - 1);
  });

  // Trackpad/mouse tekerleği yatay kaydırma (bkz. kullanıcı isteği: Macbook touchpad'i) — deltaX
  // dikey deltaY'den baskınsa yatay bir kaydırma jesti olarak yorumlanır. Ardışık wheel event'leri
  // (bir tek "kaydırma" ondan onlarca event üretebilir) küçük bir zaman aşımıyla debounce edilir —
  // aksi halde tek bir trackpad hareketi aynı anda birden fazla görsel atlardı.
  let wheelLock = false;
  lightbox.addEventListener('wheel', (e)=>{
    // Izgara modunda tekerlek/trackpad, ızgaranın kendi dikey kaydırmasına bırakılır (bkz. touchstart'taki
    // AYNI koruma) — burada erken çıkılmazsa yatay bileşenli bir kaydırma yanlışlıkla slayt değiştirirdi.
    if(lightbox.classList.contains('grid-mode')) return;
    // gerçek bulgu (denetim, 2026-08-24): preventDefault yalnızca yatay-baskın bir kaydırmada
    // çağrılıyordu — dikey tekerlek/trackpad hareketi (touchmove'daki AYNI kök neden) hiç
    // engellenmediğinden tam ekran fotoğrafın ALTINDAKİ .modal-shell-body sessizce kaydırılıyordu.
    // Lightbox'ın (ızgara modu dışında) kendi kaydıracak içeriği olmadığından yön ne olursa olsun
    // önce engellenir; yalnızca navigasyon KARARI hâlâ yatay-baskın kaydırmayla sınırlı.
    e.preventDefault();
    if(Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    if(wheelLock) return;
    wheelLock = true;
    setTimeout(()=>{ wheelLock = false; }, 350);
    if(e.deltaX > 0) showLightboxImage(galleryEl._pmGalleryState.lightboxIndex + 1);
    else showLightboxImage(galleryEl._pmGalleryState.lightboxIndex - 1);
  }, { passive: false });
}
