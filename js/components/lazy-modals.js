// lazy-modals.js — denetim bulgusu (2026-08-14): auth-modal.js (118KB) + info-modal.js (75KB),
// repodaki en büyük 2 JS dosyası, HER sayfada <script defer> ile senkron indirilip parse/exec
// ediliyordu; ziyaretçilerin büyük çoğunluğu Giriş Yap/Üye Ol/Hesabım/Rozet Al/İade Et/İletişim/
// Hakkında/Gizlilik Politikası/Hizmet Şartları/Kariyer popup'larından HİÇBİRİNİ hiç açmıyor. Bu dosya
// ikisini de yalnızca gerçekten gerekince yükler: (a) ilgili nav/footer linkine tıklanınca, (b) o
// linkin temiz URL'ine (ör. /giris, /hakkinda) doğrudan gidilince/F5 yapılınca, ya da (c) tarayıcı
// geri/ileri tuşuyla o URL'e dönülünce. hrefRe/viewByPath eşlemeleri auth-modal.js/info-modal.js'in
// kendi başlarındaki AYNI sabitlerin BİLEREK kopyasıdır — asıl (büyük) modülü indirmeden hangi linkin
// hangi popup'ı açacağını bilmemiz gerekiyor; biri değişirse ikisi birlikte güncellenmeli.
(function () {
  // viewByPath — KANONİK temiz yol -> görünüm (auth-modal.js#VIEW_PATH / info-modal.js#VIEW_PATH'in
  // ters çevrilmiş hâli). hrefRe ise yalnızca ESKİ `*.html` biçimi içindir.
  //
  // KÖK NEDEN (kullanıcı isteği, 2026-09-01 madde 4 ve 8): bu dosya bir tıklamayı YALNIZCA hrefRe
  // (yani `*.html`) ile eşliyordu ve asıl kapı bekçisi burasıdır — modüller çoğu sayfada henüz
  // YÜKLENMEMİŞ olduğundan onların kendi (düzeltilmiş) dinleyicileri hiç çalışmaz. Sitedeki iç
  // bağlantılar 2026-09-01'de temiz URL'lere çevrilince hiçbir tıklama eşleşmiyor, tarayıcı
  // /hesabim'e TAM SAYFA gidiyor, o yol da index.html'i servis ettiğinden kullanıcı önce ana sayfaya
  // ışınlanıyor ve popup'ı kapatınca bulunduğu sayfaya dönemiyordu.
  const MODULES = {
    auth: {
      src: 'js/components/auth-modal.js',
      globalName: 'AuthModal',
      // Profili Düzenle formundaki meslek listesinin PAYLAŞILAN kaynağı (uye-ol.html ve
      // kisi-ekle.html ile aynı dosya, bkz. profession-shared.js). auth-modal.js her sayfada değil
      // TEMBEL yüklendiği için sayfalara ayrı <script> etiketi eklemek işe yaramazdı; bağımlılık
      // burada, modülün kendisinden ÖNCE yüklenir. auth-modal.js'te ayrıca bir yedek kopya var —
      // bu dosya bir nedenle yüklenemezse meslek kutusu boş kalmaz.
      // profession-drawer.js de burada: auth-modal'ın hem Üye Ol hem Profili Düzenle formundaki
      // meslek kutusu bu bileşene bağlı. Çoğu sayfa onu ayrıca yüklüyor ama bağımlılığı burada
      // belirtmek, yüklemeyen bir sayfada da (ör. gelecekte eklenecek yeni bir sayfa) formun
      // çıplak kalmasını önler; zaten sayfada varsa tekrar enjekte edilmez (bkz. querySelector).
      // office-picker.js — Profili Düzenle'deki "Firma veya Marka" çoklu seçim kutusu (kullanıcı
      // isteği, 2026-09-06 madde 1). profession-shared.js ile AYNI gerekçe: auth-modal.js tembel
      // yüklendiğinden sayfalara ayrı <script> koymak işe yaramaz, bağımlılık burada bildirilir.
      deps: ['profession-shared.js', 'office-picker.js', 'js/components/profession-drawer.js', 'js/components/image-crop.js'],
      hrefRe: {
        login: /(^|\/)giris-yap\.html$/, signup: /(^|\/)uye-ol\.html$/,
        account: /(^|\/)hesabim\.html$/, activities: /(^|\/)aktivitelerim\.html$/,
        collections: /(^|\/)koleksiyonum\.html$/, forgot: /(^|\/)sifremi-unuttum\.html$/,
      },
      viewByPath: {
        '/giris': 'login', '/uye-ol': 'signup', '/hesabim': 'account', '/aktivitelerim': 'activities',
        '/koleksiyonum': 'collections', '/sifremi-unuttum': 'forgot',
      },
    },
    info: {
      src: 'js/components/info-modal.js',
      globalName: 'InfoModal',
      hrefRe: {
        'rozet-al': /(^|\/)satin-al\.html$/, 'iade-et': /(^|\/)iade-et\.html$/,
        'iletisim': /(^|\/)iletisim\.html$/, 'hakkinda': /(^|\/)hakkinda\.html$/,
        'gizlilik-politikasi': /(^|\/)gizlilik-politikasi\.html$/,
        'hizmet-sartlari': /(^|\/)hizmet-sartlari\.html$/, 'kariyer': /(^|\/)kariyer\.html$/,
        'cerez-politikasi': /(^|\/)cerez-politikasi\.html$/,
        'neden-mimarlab': /(^|\/)neden-mimarlab\.html$/,
      },
      viewByPath: {
        '/rozet-al': 'rozet-al', '/iade-et': 'iade-et', '/iletisim': 'iletisim', '/hakkinda': 'hakkinda',
        '/gizlilik-politikasi': 'gizlilik-politikasi', '/hizmet-sartlari': 'hizmet-sartlari',
        '/kariyer': 'kariyer', '/cerez-politikasi': 'cerez-politikasi',
        // kullanıcı isteği (2026-09-06 madde 7) — footer'ın Kurumsal sütunundaki "Neden MİMARLAB?"
        // bağlantısı artık tam sayfa gitmek yerine InfoModal popup'ını açar.
        '/neden-mimarlab': 'neden-mimarlab',
      },
    },
  };

  // ---------------------------------------------------------------------------------------------
  // VARLIK POPUP'LARI ARASI GEÇİŞ (kullanıcı isteği, 2026-09-06)
  //
  // ÖLÇÜLEN SORUN (canlı, mimarlab.com): proje/ürün popup'ındaki bir `/kisi/:slug` ya da
  // `/firma/:slug` bağlantısı GERÇEK bir tam sayfa gezinmesiydi — proje.html/urun.html
  // architect-modal.js/office-modal.js YÜKLEMEZ (bilinçli bir ilk-yük bütçesi kararı), bu yüzden
  // tarayıcı yeni bir belge açıyordu: TTFB ~844 ms, DOMContentLoaded ~2097 ms, varlık API'si ancak
  // ~2097 ms'de BAŞLIYOR (~2,5 sn'de bitiyor), üstelik arkadaki liste sayfası da baştan çiziliyor.
  // Aynı belgede açılan bir popup ise ~250-350 ms.
  //
  // ÇÖZÜM, yukarıdaki auth/info deseninin BİREBİR AYNISI (yeni bir paralel sistem DEĞİL): modül
  // yalnızca ilk ihtiyaç anında — bağlantıya tıklanınca — indirilir, ilk sayfa yüküne hiçbir şey
  // eklenmez, sonra popup AYNI belgede açılır. Yan kazanç: kapanış artık zaten var olan
  // goBackAndWait(N) yoluna düşer, yani liste sayfası hiç yeniden yüklenmez (scroll/filtre/sayfa
  // durumu bfcache'e bile ihtiyaç duymadan yerinde kalır).
  //
  // SEO'da HİÇBİR ŞEY DEĞİŞMEZ: URL'ler yine aynı kanonik yollara history.pushState ile yazılır;
  // `/kisi/:slug`'a doğrudan, paylaşılan bir linkle ya da bir botla gelindiğinde sunucu yine
  // SSR meta + #ssr-entity-body + JSON-LD üretir (bkz. src/index.js#injectMeta). Değişen tek şey,
  // SİTE İÇİ bir tıklamanın tarayıcıyı yeni bir belge yüklemeye zorlamaması.
  //
  // preloadedOnly: modül SAYFADA ZATEN VARSA kullan, YOKSA indirme (tarayıcının normal gezinmesine
  // bırak). 'project' için böyle: project-modal.js'in bağımlılık zinciri (galeri/künye/aksiyon/
  // yorum/ilgili/ürünler/hotspot/rating — 10+ dosya) tembel indirilecek kadar küçük değil. Yine de
  // kayıtlı olması ŞART: proje.html'de bir kişi/firma popup'ı açıkken oradaki `/proje/:slug`
  // bağlantısı, ProjectModal'ın kendi (sahip kontrollü) dinleyicisi tarafından ele alınmaz ve
  // ZATEN YÜKLÜ bir modül dururken gereksiz bir tam sayfa yeniden yüklemesine düşerdi.
  // VARLIK POPUP'LARININ PAYLAŞTIĞI ARAYÜZ MODÜLLERİ (performans denetimi, 2026-09-06 madde 4).
  // Bu dört dosya kişi/firma/marka liste sayfalarında <script> etiketiyle SENKRON yükleniyordu —
  // yalnızca modal-shell.js 71 KB, dördü birlikte ~100 KB — oysa hiçbiri LİSTE görünümü için
  // gerekli değil; hepsi ancak bir varlık popup'ı açıldığında devreye giriyor. Etiketleri o
  // sayfalardan kaldırıldı ve bağımlılık olarak buraya taşındı.
  //
  // proje.html/urun.html/en-iyi-100.html'de DAVRANIŞ DEĞİŞMEZ: o sayfalar dördünü kendi <script
  // defer> etiketleriyle zaten yüklüyor ve loadDep aynı src'li bir etiket varsa hiç enjekte etmiyor
  // (bkz. loadDep#querySelector) — yani orada bu liste tamamen no-op'tur.
  const ENTITY_UI_DEPS = [
    'js/components/modal-shell.js',       // popup kabuğunun kendisi (ModalShell) — KORUMASIZ kullanılır
    'js/components/related-strip.js',     // RelatedStrip — "Diğer Projeler"/"İlgili" şeritleri
    'js/components/project-group-filter.js', // ProjectGroupFilter — şeritlerin gruba göre çentiği
    'js/components/share-button.js',      // ShareWidget — başlıktaki Paylaş düğmesi
  ];
  const ENTITY_MODULES = {
    architect: {
      src: 'js/components/architect-modal.js', globalName: 'ArchitectModal',
      owner: 'architect', pathRe: /^\/kisi\/([^/?#]+)/, parallelDeps: true,
      // kisi.html'in architect-modal.js'ten ÖNCE yüklediği ama proje/urun/firma/marka.html'de
      // BULUNMAYAN modüller. MessageWidget/SocialLinks/ConsultationModal architect-modal.js içinde
      // `typeof … !== 'undefined'` ile korunuyor (eksik olsalar çökmez, yalnızca o bölümler
      // görünmez); createClaimCorrectionBox ise KORUMASIZ çağrılıyor — o olmadan popup
      // ReferenceError verirdi. Dördü de yüklenerek popup, /kisi listesinden açılanla BİREBİR aynı
      // olur (kullanıcı isteği: mevcut UI/UX değişmesin).
      // image-lightbox.js: architect-modal.js onu bir GLOBAL olarak çağırmaz (bu yüzden isim
      // taraması boş çıkar) — popup'ın profil fotoğrafına `.img-zoomable` sınıfını basar ve modülün
      // kendi delege click dinleyicisi devreye girer. Yani bağımlılık MARKUP üzerindendir; dosya
      // yoksa fotoğrafa tıklamak sessizce hiçbir şey yapmaz.
      deps: [...ENTITY_UI_DEPS, 'js/components/claim-correction-box.js', 'js/components/message-button.js',
        'js/components/social-links.js', 'js/components/image-lightbox.js'],
      // consultation-modal.js (39 KB — bu grubun EN BÜYÜĞÜ; canlıda ölçüldü: tek başına 663 ms,
      // diğer üç bağımlılığın tamamı ~135 ms) popup'ın RENDER'ı için gerekli DEĞİL: architect-modal.js
      // ona yalnızca "Danışmanlık Al" düğmesinin TIKLAMA dinleyicisi içinde dokunuyor ve o düğme de
      // tek bir profilde (kaan-corbaci) render ediliyor. Bekleyip popup'ı geciktirmek yerine arka
      // planda indirilir — düğme her hâlükârda çizilir, kullanıcı tıklayana kadar modül çoktan
      // gelmiş olur.
      deferredDeps: ['js/components/consultation-modal.js'],
    },
    office: {
      // İKİ ÖNEK: /firma/:slug ve /marka/:slug — ikisi de AYNI `offices` kaydını ve AYNI popup'ı
      // açar, ayrım yalnızca kanonik URL'dedir (kullanıcı isteği, 2026-09-06 madde 2; bkz.
      // office-kind.js#isPureBrandOffice ve js/components/office-modal.js#syncCanonicalBasePath).
      src: 'js/components/office-modal.js', globalName: 'OfficeModal',
      owner: 'office', pathRe: /^\/(?:firma|marka)\/([^/?#]+)/, parallelDeps: true,
      // firma.html/marka.html'in office-modal.js'ten önce yüklediği aynı üçlü (ConsultationModal
      // firma popup'ında kullanılmıyor) + logoyu büyüten image-lightbox (bkz. architect'teki AYNI
      // markup-üzerinden-bağımlılık notu).
      deps: [...ENTITY_UI_DEPS, 'js/components/claim-correction-box.js', 'js/components/message-button.js',
        'js/components/social-links.js', 'js/components/image-lightbox.js'],
    },
    product: {
      src: 'js/components/product-modal.js', globalName: 'ProductModal',
      owner: 'product', pathRe: /^\/urun\/([^/?#]+)/, parallelDeps: true,
      // product-modal.js initDetailGallery (gallery.js) ve mountRateButton (rating-widget.js)
      // çağırıyor; ilki KORUMASIZ. Diğer bağımlılıkları (RelatedStrip/ProjectGroupFilter/
      // ShareWidget/cdnImg/savedWidgetReady) kişi/firma/marka sayfalarında zaten yüklü.
      // ARTIK DEĞİL (2026-09-06 madde 4): RelatedStrip/ProjectGroupFilter/ShareWidget/ModalShell
      // etiketleri o üç sayfadan kaldırıldığından ENTITY_UI_DEPS burada da açıkça listelenmeli —
      // aksi halde bir firma popup'ından tıklanan `/urun/:slug` bağlantısı ModalShell'siz açılmaya
      // çalışıp ReferenceError verirdi. urun.html/proje.html'de dördü de zaten etiketli, no-op.
      deps: [...ENTITY_UI_DEPS, 'js/components/gallery.js', 'rating-widget.js'],
    },
    project: {
      src: 'js/components/project-modal.js', globalName: 'ProjectModal',
      owner: 'project', pathRe: /^\/proje\/([^/?#]+)/, preloadedOnly: true,
    },
  };

  // Bir yol, TEMBEL YÜKLENMİŞ (ya da zaten yüklü) bir varlık modalına mı ait? Sayfaların kendi
  // popstate dinleyicileri bunu sorup kenara çekilir (bkz. aşağıdaki popstate dinleyicisi ve
  // proje.js/kisi.html/firma.html/marka.html/urun.html'deki tek satırlık kapı). Modül yüklü
  // DEĞİLSE false döner — o zaman sayfanın eski davranışı aynen sürer.
  function entityModuleForPath(pathname) {
    for (const key in ENTITY_MODULES) {
      const mod = ENTITY_MODULES[key];
      const m = (pathname || '').match(mod.pathRe);
      if (m && window[mod.globalName]) return { key, mod, slug: decodeURIComponent(m[1]) };
    }
    return null;
  }

  // Bir yol (pathname) hangi modülün hangi görünümüne karşılık geliyor? Sondaki '/' yok sayılır —
  // auth-modal.js/info-modal.js#pathToView ile AYNI normalizasyon.
  function viewForPath(mod, pathname) {
    const path = (pathname || '').replace(/\/+$/, '') || '/';
    return mod.viewByPath[path] || null;
  }

  // Bir <a>'nın hedefi hangi görünüm? Önce kanonik temiz yol, sonra eski *.html biçimi — bkz.
  // js/components/auth-modal.js#hrefToView (BİREBİR aynı sıra/gerekçe).
  function viewForAnchor(mod, a) {
    const raw = a.getAttribute('href') || '';
    if (!raw || raw.startsWith('#')) return null;
    let path;
    try {
      const u = new URL(raw, document.baseURI);
      if (u.origin !== location.origin) return null; // dış bağlantılara dokunma
      path = u.pathname;
    } catch { return null; }
    const cleanView = viewForPath(mod, path);
    if (cleanView) return cleanView;
    for (const v in mod.hrefRe) { if (mod.hrefRe[v].test(path)) return v; }
    return null;
  }

  // auth/info + varlık modalleri TEK bir tabloda toplanır ki loadModule() ikisi için de çalışsın
  // (anahtarlar çakışmıyor). Yukarıdaki auth/info döngüleri hâlâ yalnızca MODULES'ü gezer — o
  // davranış hiç değişmez.
  const ALL_MODULES = Object.assign({}, MODULES, ENTITY_MODULES);

  const pending = {};
  // src'si zaten sayfada varsa (ör. bu betik iki kez dahil edilmişse) tekrar enjekte etmez —
  // window.AuthModal/InfoModal (bkz. o dosyaların sonundaki AYNI not) hazır olana kadar bekler.
  function loadModule(key) {
    if (pending[key]) return pending[key];
    const mod = ALL_MODULES[key];
    if (window[mod.globalName]) { pending[key] = Promise.resolve(window[mod.globalName]); return pending[key]; }
    // Bağımlılıklar modülden ÖNCE ve sırayla yüklenir. Bir bağımlılık yüklenemezse modül YİNE DE
    // yüklenir (bkz. auth-modal.js'teki yedek liste) — yardımcı bir veri dosyası yüzünden tüm
    // Hesabım popup'ını kaybetmek çok daha kötü olurdu.
    const loadDep = (src) => new Promise(res => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const dep = document.createElement('script');
      dep.src = src;
      dep.onload = () => res();
      dep.onerror = () => { dep.remove(); res(); };
      document.head.appendChild(dep);
    });
    // Modülün KENDİ baytlarını bağımlılıklarla AYNI ANDA çekmeye başla. <script> etiketi yine
    // bağımlılıklar bittikten SONRA eklenir (çalışma sırası garantisi bozulmasın) ama o an dosya
    // zaten tarayıcı önbelleğinde olduğundan ikinci bir gidiş-dönüş oluşmaz. Canlıda ölçüldü: bu
    // olmadan architect-modal.js indirmesi bağımlılıklardan SONRA başlıyor ve soğuk önbellekte
    // ~280 ms'lik ek bir seri adım ekliyordu.
    if (!document.querySelector(`link[rel="preload"][href="${mod.src}"]`)) {
      const pre = document.createElement('link');
      pre.rel = 'preload';
      pre.as = 'script';
      pre.href = mod.src;
      document.head.appendChild(pre);
    }
    // deferredDeps: modülün RENDER'ı için gerekmeyen, yalnızca bir kullanıcı etkileşiminde devreye
    // giren bağımlılıklar — indirilir ama BEKLENMEZ (bkz. ENTITY_MODULES.architect'teki gerekçe).
    (mod.deferredDeps || []).forEach(src => { loadDep(src); });
    // parallelDeps: bağımlılıklar BİRBİRİNDEN bağımsızsa hepsi AYNI ANDA indirilir. Varlık
    // modallerinin bağımlılıkları (claim-correction-box/message-button/social-links/
    // consultation-modal/gallery/rating-widget) birbirine hiç dokunmayan ayrı IIFE'ler; sıralı
    // zincir her biri için AYRI bir gidiş-dönüş demekti (yerelde ölçüldü: 4 bağımlılık + modül =
    // 5 ardışık istek, ~57 ms; canlıdaki RTT ile bu birkaç yüz ms'ye çıkardı). auth/info bu
    // bayrağı TAŞIMAZ — orada profession-shared.js → profession-drawer.js sırası korunur.
    const depsReady = mod.parallelDeps
      ? Promise.all((mod.deps || []).map(loadDep))
      : (mod.deps || []).reduce((chain, src) => chain.then(() => loadDep(src)), Promise.resolve());

    pending[key] = depsReady.then(() => new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = mod.src;
      script.onload = () => resolve(window[mod.globalName]);
      // gerçek bulgu: onerror hiç ele alınmıyordu — ağ hatasında (offline/timeout) bu Promise SONSUZA
      // KADAR askıda kalıyordu; e.preventDefault() zaten çağrıldığından tıklama hiçbir şey yapmadan
      // sessizce ölüyordu (kullanıcı linke tekrar tekrar tıklayıp hiçbir tepki görmüyordu). script
      // DOM'dan da kaldırılır ki bir sonraki deneme (pending[key] silindiğinden) temiz bir <script>
      // ile tekrar dener.
      script.onerror = () => { script.remove(); delete pending[key]; reject(new Error('lazy-modals: ' + mod.src + ' yüklenemedi')); };
      document.head.appendChild(script);
    }));
    return pending[key];
  }

  // Doğrudan URL ile açılış (F5/deep-link) — modülün kendi initialView mantığı (bkz. auth-modal.js/
  // info-modal.js dosya sonu) location.pathname'i okuyup popup'ı kendi açar, burada sadece indirmek
  // yeterli.
  for (const key in MODULES) {
    if (viewForPath(MODULES[key], location.pathname)) loadModule(key).catch(() => {});
  }

  // AYNI ŞEY VARLIK MODÜLLERİ İÇİN (performans denetimi, 2026-09-06 madde 4). kişi/firma/marka
  // liste sayfaları artık architect-modal.js/office-modal.js'i <script> etiketiyle yüklemediğinden,
  // `/kisi/:slug` ya da `/firma/:slug` adresine DOĞRUDAN girildiğinde (paylaşılan link, F5, bot
  // olmayan gerçek ziyaret) modülün indirilmesi sayfanın kendi DOMContentLoaded'ını beklerdi. Bu
  // satır indirmeyi bu betik çalışır çalışmaz — yani eski <script> etiketlerinin bulunduğu noktayla
  // pratikte aynı anda — başlatır; sayfanın DOMContentLoaded'daki open() çağrısı aynı pending[key]
  // promise'ine bağlanır, ikinci bir indirme OLUŞMAZ. Sayfaların <head>'indeki senkron betik ayrıca
  // iki büyük dosya için <link rel="preload"> bastığından baytlar bundan da önce yola çıkar.
  //
  // preloadedOnly modüller (project) ATLANIR: onların sözleşmesi "sayfada zaten varsa kullan, yoksa
  // indirme"dir (bkz. ENTITY_MODULES.project) — burada indirmek o kararı sessizce bozardı.
  for (const key in ENTITY_MODULES) {
    const mod = ENTITY_MODULES[key];
    if (mod.preloadedOnly) continue;
    if (mod.pathRe.test(location.pathname)) loadModule(key).catch(() => {});
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    for (const key in MODULES) {
      const mod = MODULES[key];
      // Modül zaten yüklendiyse KENDİ document click listener'ı (bkz. auth-modal.js/info-modal.js
      // dosya sonu) bu tıklamayı zaten yönetecek — burada da işlersek preventDefault sonrası hem
      // burada hem orada open() çağrılıp popup'ın çift açılmasına/view'ın gereksiz re-render'ına
      // yol açardı.
      if (window[mod.globalName]) continue;
      const view = viewForAnchor(mod, a);
      if (!view) continue;
      e.preventDefault();
      // Yükleme başarısız olursa (bkz. loadModule#onerror) preventDefault sonrası kullanıcıyı elleri
      // boş bırakmamak için normal (tam sayfa) navigasyona düşülür.
      const href = a.getAttribute('href');
      loadModule(key).then((Modal) => { if (Modal) Modal.open(view, { triggerEl: a }); }).catch(() => { window.location.href = href; });
      return;
    }
  });

  // GERİ ALINDI (kullanıcı isteği, 2026-09-06: "Giriş Yap butonunun üzerine mouse imleci gelince
  // açılmasını iptal et, tıklayınca açılsın"). Burada kısa bir süre 'mouseover' delegasyonuyla
  // hover'da çekmeceyi açan bir dinleyici vardı; kaldırıldı. Giriş Yap artık YALNIZCA tıklamayla
  // açılır — o tıklama (modül henüz yüklenmemişse) yukarıdaki click dinleyicisi, yüklüyse
  // auth-modal.js'in kendi click dinleyicisi tarafından işlenir. Aynı düğmeye açıkken tekrar
  // tıklamanın çekmeceyi KAPATMASI (aç/kapat) korunuyor, bkz. auth-modal.js#click dinleyicisi.

  // bkz. yukarısı "Doğrudan URL ile açılış" — kullanıcı popup'ı hiç tetiklemeden geri/ileri tuşuyla
  // bu URL'lerden birine dönerse modül henüz yüklenmemiş olabilir; yüklenince kendi initialView
  // mantığı zaten devreye girer (popstate'in kendisini ayrıca dinlemeye gerek yok).
  window.addEventListener('popstate', () => {
    for (const key in MODULES) {
      if (viewForPath(MODULES[key], location.pathname)) loadModule(key).catch(() => {});
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Varlık bağlantısı tıklaması (bkz. ENTITY_MODULES dosya-içi yorumu).
  //
  // KAPSAM BİLEREK DAR: yalnızca AÇIK bir ModalShell popup'ının İÇİNDEN gelen tıklamalar yakalanır.
  // Liste sayfalarının kendi kart davranışı (her sayfanın kendi kart dinleyicisi) hiç değişmez —
  // orada modül zaten yüklü ve zaten aynı belgede açılıyor.
  //
  // e.defaultPrevented kapısı: AYNI TÜR içindeki gezinmeyi (proje→proje, kişi→kişi) ilgili modalın
  // KENDİ bodyEl dinleyicisi swap() ile hâlâ işler ve preventDefault eder — o tıklamalar buraya
  // hiç düşmez. Buraya yalnızca TÜR DEĞİŞTİREN tıklamalar gelir ve onlar open() ile açılır
  // (open(), ensureTemplate/claimContent üzerinden şablonu doğru modala geçirir).
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href]');
    if (!a || (a.target && a.target !== '_self')) return;
    if (!a.closest('.modal-shell-overlay.open')) return;
    let path;
    try {
      const u = new URL(a.getAttribute('href'), document.baseURI);
      if (u.origin !== location.origin) return; // dış bağlantılara dokunma
      path = u.pathname;
    } catch { return; }
    for (const key in ENTITY_MODULES) {
      const mod = ENTITY_MODULES[key];
      const m = path.match(mod.pathRe);
      if (!m) continue;
      // Zaten bu türün popup'ı ekrandaysa tıklamayı o modalın kendi swap()'ı işlemiş olmalıydı;
      // işlememişse (ör. beklenmedik bir DOM yolu) tarayıcının normal gezinmesine bırakmak
      // buradan open() çağırmaktan daha güvenli — çift history girdisi yazmayalım.
      if (window.ModalShell && ModalShell.getContentOwner() === mod.owner) return;
      if (mod.preloadedOnly && !window[mod.globalName]) return; // indirme, tarayıcı gitsin
      e.preventDefault();
      const slug = decodeURIComponent(m[1]);
      const href = a.href;
      // basePath: tıklanan bağlantının kendi öneki. Aynı türün birden fazla öneki olabiliyor
      // (/firma/ ve /marka/, bkz. ENTITY_MODULES.office) — popup açılırken hangi önekle
      // pushState edileceği buradan gelir; kanonik düzeltme veri gelince modalın kendisinde
      // yapılır (bkz. office-modal.js#syncCanonicalBasePath). Bu anahtarı tanımayan modaller
      // (kişi/ürün) fazladan seçeneği yok sayar.
      const basePath = `/${path.split('/')[1]}/`;
      // Yükleme başarısız olursa (offline/timeout, bkz. loadModule#onerror) kullanıcıyı elleri boş
      // bırakmamak için normal tam sayfa gezinmesine düşülür — auth/info dalındaki AYNI güvenlik ağı.
      loadModule(key)
        .then((Modal) => { if (Modal && Modal.open) Modal.open(slug, { triggerEl: a, basePath }); else window.location.href = href; })
        .catch(() => { window.location.href = href; });
      return;
    }
  });

  // Geri/ileri tuşu. Sayfaların KENDİ popstate dinleyicisi yalnızca kendi "yerli" türünü tanır
  // (ör. js/pages/proje.js /proje/ ve /urun/ bilir, /kisi/ bilmez) ve tanımadığı bir yolda son
  // dalına düşüp AÇIK popup'ı kapatırdı. Bu yüzden yerli olsun olmasın, yüklü bir varlık modalına
  // ait TÜM yolları burası üstlenir; sayfalar da `LazyModals.ownsPath()` ile kenara çekilir (bkz.
  // o dosyalardaki tek satırlık kapı). İki dinleyicinin sırası (defer/inline) sayfadan sayfaya
  // değiştiğinden çözüm stopImmediatePropagation gibi sıraya BAĞLI bir yöntem DEĞİL.
  //
  // Yerli türlerde davranış birebir aynıdır: o sayfaların dinleyicisi de tam olarak
  // `Modal.handlePopState(slug)` çağırıp return ediyordu.
  window.addEventListener('popstate', () => {
    const hit = entityModuleForPath(location.pathname);
    if (!hit) return;
    const Modal = window[hit.mod.globalName];
    if (Modal && Modal.handlePopState) Modal.handlePopState(hit.slug);
  });

  // Sayfaların popstate dinleyicilerinin sorduğu tek soru (bkz. yukarısı).
  //
  // load(key): kişi/firma/marka LİSTE sayfalarının kendi kart tıklamaları/popstate/doğrudan-URL
  // yolları için (performans denetimi, 2026-09-06 madde 4). O sayfalar artık architect-modal.js/
  // office-modal.js'i <script> etiketiyle YÜKLEMİYOR, bu yüzden `ArchitectModal.open(...)`ı
  // doğrudan çağıramazlar — aynı loadModule() zincirinden geçerler. YENİ BİR PARALEL SİSTEM
  // DEĞİLDİR: tıklamayı yakalayan, bağımlılıkları çözen, tekilleştiren ve hata durumunda tam sayfa
  // gezinmeye düşen kod tek bir yerde, burada kalır.
  //
  // isLoaded(key): sayfaların "popup şu an açık olabilir mi?" sorusu — modül hiç yüklenmemişse
  // açık bir popup da olamaz, o dallara hiç girilmemelidir.
  window.LazyModals = {
    ownsPath: (pathname) => !!entityModuleForPath(pathname),
    load: (key) => (ALL_MODULES[key] ? loadModule(key) : Promise.resolve(null)),
    isLoaded: (key) => !!(ALL_MODULES[key] && window[ALL_MODULES[key].globalName]),
  };
})();
