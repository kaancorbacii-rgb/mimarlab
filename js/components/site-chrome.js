// Site genelinde üst menü (nav) ve alt menü (footer) artık TEK kaynaktan üretilir. Önceden her sayfa
// bu markup'ın kendi kopyasını tutuyordu ve zamanla birbirinden sapıyordu — ör. proje-ekle.html,
// kisi-ekle.html, firma-ekle.html gibi sayfalarda "Ürün" açılır menüsü (mega-menu) hiç eklenmemişti,
// bu yüzden o sayfalarda Ürün'ün yanındaki çentik/ok görünmüyordu (bkz. kullanıcı isteği: "üst ve alt
// menüde yapılan değişikliklerin sitedeki tüm sayfalarda eş zamanlı güncellenmesi gerekiyor").
//
// Bu dosya senkron (defer'sız) yüklenir ve header mount noktasının HEMEN ardından çağrılır, çünkü bazı
// sayfalar (ör. urun.html) kendi satır-içi <script>'inde nav elemanlarına (urun-menu-trigger vb.)
// sayfa ayrıştırılırken (deferred script'ler çalışmadan ÖNCE) erişiyor. Footer ise DOMContentLoaded'da
// mount edilir — hiçbir script footer elemanlarına erken erişmiyor.
(function(){
  // ---------------------------------------------------------------------------------------------
  // UNICODE NFC NORMALİZASYONU — SİTE GENELİ METİN GİRİŞİ (kullanıcı isteği, 2026-09-10:
  // "doçem yazınca çıkmıyor ama docem yazınca çıkıyor ... kökten çöz").
  //
  // KÖK NEDEN: "ç" harfinin ekranda BİREBİR AYNI görünen iki Unicode gösterimi var — birleşik
  // U+00E7 ve ayrışık 'c' + U+0327 (birleşme çengeli). Ayrışık hâl macOS'tan kopyala-yapıştırda,
  // bazı klavye/IME'lerde ve PDF/web alıntılarında düzenli olarak geliyor. Türkçe katlaması (foldTr)
  // yalnızca birleşik hâli tanıdığından, ayrışık yazılan "doçem" sorgusu hiçbir kayda dönüşmüyor,
  // kullanıcı ise kutuda doğru yazdığını gördüğü için sorunu "Türkçe karakterle arama bozuk" diye
  // yaşıyordu. Canlıda doğrulandı (2026-09-10): aynı görünen iki sorgudan biri 1, diğeri 0 sonuç
  // veriyordu.
  //
  // NEDEN BURADA (tek yer): site-chrome.js sitedeki 31 HTML sayfasının HEPSİNDE senkron yükleniyor
  // ve yakalama (capture) fazındaki tek bir dinleyici, sayfaların kendi arama/otomatik-tamamlama
  // kutularının 'input' işleyicilerinden ÖNCE çalışır. Alternatif, her sayfadaki her katlama
  // kopyasına (arama, office-picker, duplicate-name-check, auth-modal, proje.js, ...) ayrı ayrı
  // normalize eklemekti — bir sonraki kutuda yine unutulurdu. Sunucu tarafındaki eşi:
  // src/index.js (sorgu dizesi) ve src/lib/http.js#readJson (JSON gövdeleri).
  //
  // KAYIPSIZ: NFC salt kanonik BİRLEŞTİRMEdir — hiçbir karakter atılmaz, kullanıcının yazdığı metin
  // anlamca değişmez, yalnızca aynı görünen iki gösterimden kanonik olanı seçilir (W3C'nin metin
  // girişi için önerdiği biçim). Şifre kutuları BİLEREK DIŞARIDA (aşağıdaki izin listesinde yoklar):
  // mevcut bir hesabın parolası ayrışık hâlde belirlenmiş olabilir ve onu girişte sessizce
  // değiştirmek o hesabı kilitlerdi.
  //
  // TİP İZİN LİSTESİ (kara liste DEĞİL): yalnızca serbest metin taşıyan kutulara dokunulur.
  // <input type="file"> özellikle önemli — .value'ya YAZMAK SecurityError fırlatır ve macOS dosya
  // adları düzenli olarak ayrışık gelir ("Şişli.jpg"), yani kara listede unutulsaydı görsel yükleme
  // akışı ilk Türkçe dosya adında kırılırdı.
  const NORMALIZE_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', '']);
  const COMBINING_MARKS_RE = /[\u0300-\u036f]/;
  document.addEventListener('input', function(e){
    const el = e.target;
    if(!el) return;
    const tag = el.tagName;
    if(tag !== 'TEXTAREA' && !(tag === 'INPUT' && NORMALIZE_INPUT_TYPES.has((el.type || '').toLowerCase()))) return;
    const value = el.value;
    if(typeof value !== 'string' || !COMBINING_MARKS_RE.test(value)) return;
    const normalized = value.normalize('NFC');
    if(normalized === value) return;
    // İmleç, birleşen karakter sayısı kadar sola kayar — aksi halde kullanıcı yazmaya devam
    // ettiğinde harfler yanlış yere düşerdi. setSelectionRange bazı input tiplerinde (email,
    // number) fırlatır; oradaki tek kayıp imleç konumu olur, değerin düzelmesi yine de kalır.
    const caret = el.selectionStart;
    el.value = normalized;
    try {
      const pos = caret == null ? normalized.length : Math.max(0, caret - (value.length - normalized.length));
      el.setSelectionRange(pos, pos);
    } catch (_) {}
  }, true);

  // ---------------------------------------------------------------------------------------------
  // LİSTE AĞ DAYANIKLILIĞI (kullanıcı isteği, 2026-09-10: "mobilde kişiler sayfası hiçbir gönderi
  // olmadan takılı kaldı"). Hub sayfalarının canlı liste isteğinde zaman aşımı, yeniden deneme ve
  // görünür bir hata/tekrar-dene durumu YOKTU: mobil ağda askıda kalan tek bir fetch, boş bir grid'i
  // sonsuza kadar boş bırakıyordu (ekranda ne iskelet ne hata). Üç yardımcı, 31 sayfada senkron
  // yüklenen bu dosyadan tek kaynak olarak verilir; hub sayfaları listFetch/render içinden çağırır.
  //   mlFetch(url, {timeoutMs, retries, init}) — AbortController zaman aşımı + 5xx/ağ hatasında
  //     bir kez daha dener. Var olan fetch(url) çağrısının yerine geçer; yanıtı aynen döndürür.
  //   mlListSkeleton(grid, n) — grid BOŞKEN (ilk yükleme) n adet iskelet kart basar; veri gelince
  //     render zaten innerHTML'i ezer.
  //   mlListError(el, text, onRetry) — "yüklenemedi" metni + Tekrar dene düğmesi.
  (function(){
    const style = document.createElement('style');
    style.id = 'ml-net-style';
    style.textContent = '.ml-skel{display:block;border-radius:14px;aspect-ratio:4/5;background:linear-gradient(100deg,rgba(0,0,0,.05) 30%,rgba(0,0,0,.09) 50%,rgba(0,0,0,.05) 70%);background-size:200% 100%;animation:ml-skel 1.2s ease-in-out infinite}'
      + '@keyframes ml-skel{0%{background-position:120% 0}100%{background-position:-80% 0}}'
      + '.ml-retry-btn{display:inline-block;margin-left:8px;padding:6px 14px;border-radius:100px;border:1px solid currentColor;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer}';
    (document.head || document.documentElement).appendChild(style);
  })();
  // ---------------------------------------------------------------------------------------------
  // DOKUNMATİKTE ODAKLANINCA EKRAN YAKINLAŞMASINI ENGELLE (kullanıcı isteği, 2026-09-14: "Mobilde
  // bir şey yazmak için bir kutucuğa tıklandığında o kutucuğa doğru ekran yaklaşıyor. Örneğin arama
  // popupındaki arama çubuğuna tıkladığımızda oluyor.").
  //
  // NEDENİ TARAYICI DAVRANIŞI, BİZİM KODUMUZ DEĞİL: iOS Safari/WebKit, odaklanan bir form alanının
  // yazı puntosu 16 px'in ALTINDAysa alanı okunur kılmak için sayfayı otomatik büyütür (ve odak
  // bırakılınca eski ölçeğe DÖNMEZ — kullanıcı elle uzaklaştırmak zorunda kalır). Sitedeki alanların
  // çoğu 12,5-13,5 px, yani eşiğin altında. Tek çözüm alanları 16 px'e çıkarmaktır.
  //
  // NEDEN `user-scalable=no` / `maximum-scale=1` DEĞİL: o da yakınlaşmayı durdurur ama aynı zamanda
  // kullanıcının PARMAKLA yakınlaştırmasını da tamamen kapatır — az gören kullanıcılar için gerçek
  // bir erişilebilirlik kaybı (WCAG 1.4.4). Punto yükseltmek aynı sonucu bedelsiz verir.
  //
  // KAPSAM `(hover:none) and (pointer:coarse)`: yalnızca dokunmatik cihazlar (telefon + tablet).
  //   * Genişlik eşiği KULLANILMADI çünkü iPad de (768-1024 px) aynı şekilde yakınlaştırır;
  //     max-width:640px onu kaçırırdı.
  //   * Masaüstü hiç etkilenmez — daraltılmış bir masaüstü penceresi bile, çünkü orada hover var.
  // !important ŞART: alanların puntosu ya sayfa içi <style> bloklarındaki daha yüksek özgüllüklü
  // kurallardan (ör. .dash-field input) ya da doğrudan inline style'dan geliyor; bu dosya 31 sayfaya
  // sonradan enjekte edildiğinden !important olmadan hiçbirini ezemez.
  // checkbox/radio/range METİN taşımaz — punto onlarda yalnızca yerleşimi bozabilir, dışarıda bırakıldı.
  // Sabit 16px KÜÇÜLTME riski taşımıyor: depodaki hiçbir input/select/textarea 16 px'ten BÜYÜK bir
  // punto taşımıyor (en büyüğü tam 16 px), yani kural yalnızca eşiğin altındakileri yukarı çeker.
  (function(){
    const style = document.createElement('style');
    style.id = 'ml-no-zoom-style';
    style.textContent = '@media (hover:none) and (pointer:coarse){'
      + 'input:not([type=checkbox]):not([type=radio]):not([type=range]),select,textarea'
      + '{font-size:16px !important;}}';
    (document.head || document.documentElement).appendChild(style);
  })();

  window.mlFetch = function(url, opts){
    opts = opts || {};
    const timeoutMs = opts.timeoutMs || 12000;
    const retries = opts.retries == null ? 1 : opts.retries;
    const init = opts.init || {};
    function attempt(n){
      const ac = ('AbortController' in window) ? new AbortController() : null;
      const timer = setTimeout(function(){ if(ac) ac.abort(); }, timeoutMs);
      const req = Object.assign({}, init, ac ? { signal: ac.signal } : {});
      return fetch(url, req).then(function(r){
        clearTimeout(timer);
        if(r.status >= 500 && n < retries) return attempt(n + 1);
        return r;
      }, function(err){
        clearTimeout(timer);
        if(n < retries) return attempt(n + 1);
        throw err;
      });
    }
    return attempt(0);
  };
  window.mlListSkeleton = function(grid, count){
    if(!grid || grid.children.length) return;
    let html = '';
    for(let i = 0; i < (count || 8); i++) html += '<div class="ml-skel" aria-hidden="true"></div>';
    grid.innerHTML = html;
  };
  window.mlListError = function(el, text, onRetry){
    if(!el) return;
    el.textContent = text;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ml-retry-btn';
    btn.textContent = 'Tekrar dene';
    btn.addEventListener('click', function(){ onRetry && onRetry(); });
    el.appendChild(btn);
    el.style.display = 'block';
  };

  function escapeHtml(s){ const d = document.createElement('div'); d.textContent = s === undefined || s === null ? '' : s; return d.innerHTML; }
  function escapeAttr(s){ return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  // kullanıcı isteği (2026-08-28): Düello ve En İyi 100 üst menüden kaldırıldı — En İyi 100 artık
  // proje.html içinde Liste/Harita'nın yanında üçüncü bir sekme (bkz. proje.html#view-toggle-top100).
  // Düello özelliği ise 2026-08-29'da tamamen kaldırıldı (bkz. kullanıcı isteği: "Takip Et"
  // özelliğine yer açmak için) — footerHtml()'in Topluluk sütunundaki link de bu yüzden gitti.
  // Sıra kullanıcı isteğiyle sabitlendi (2026-08-31): PROJE · KİŞİ · FİRMA · ÜRÜN.
  // 2026-09-17: KİŞİ ile FİRMA'nın YERİ DEĞİŞTİ (kullanıcı isteği: "Ana menüdeki ve footerdaki KİŞİ
  // ile FİRMA'nın yerlerini değiştir") — artık PROJE · FİRMA · KİŞİ · ÜRÜN · GÜNDEM. Sıra HEM üst
  // menüde HEM mobil çekmecede bu diziden okunur (tek kaynak); footer'ın "Ana Menü" sütunu AYRI bir
  // listedir (bkz. footerHtml) ve orada da aynı takas yapıldı — ikisi ayrışırsa aynı site iki farklı
  // sıra gösterir.
  // MARKA üst menüden KALDIRILDI (kullanıcı isteği, 2026-09-14 madde 1: "Ana menüden ve footer
  // menüsünden marka sayfasını kaldır"). /marka SAYFASI DURUYOR — yalnızca menü bağlantısı gitti:
  // marka.html, canlı /marka/:slug adresleri ve o sayfaya giden diğer bağlantılar (ör. Hesabım >
  // Takip Ettiklerim) çalışmaya devam eder. Geri eklenmeden önce buraya bakın, durumu varsaymayın.
  const NAV_ITEMS = [
    { key: 'proje', href: '/proje', label: 'Proje' },
    // FOTOĞRAF (kullanıcı isteği, 2026-09-17 ikinci tur madde 12: "Sayfayı Ana Menüye ve footer
    // menüsüne FOTOĞRAF olarak PROJE'den sonra ekle") — ilk turda bilerek menüsüzdü.
    { key: 'fotograf', href: '/fotograf', label: 'Fotoğraf' },
    { key: 'firma', href: '/firma', label: 'Firma' },
    { key: 'kisi', href: '/kisi', label: 'Kişi' },
    // ÜRÜN üst menüden ve footer'dan KALDIRILDI (kullanıcı isteği, 2026-09-19: "ÜRÜN başlığını ana
    // menü ve footer menüsünden kaldırıp proje sayfasındaki En İyi 100 başlığının yanına koy").
    // Ürün açılır menüsü artık /proje sonuç çubuğunda yaşar (proje.html#view-toggle-urun,
    // js/components/nav-product-menu.js#initInline). /urun SAYFASI DURUYOR. headerHtml'deki
    // `mega` dalı genel kaldı; geri eklenmeden önce buraya bakın, durumu varsaymayın.
    // 'gundem' (kullanıcı isteği, 2026-09-06) — beş İÇERİK listesinin ardından altıncı sıraya
    // eklendi. "Neden MİMARLAB?"in bilerek dışarıda bırakılmasıyla (aşağıdaki not) ÇELİŞMEZ: o bir
    // kurumsal anlatım sayfası, bu ise sitenin altıncı içerik akışıdır ve gündelik olarak değişir —
    // yalnızca footer'dan erişilebilir olsaydı ziyaretçinin her gün geri geleceği tek sayfa
    // pratikte keşfedilemez olurdu.
    { key: 'gundem', href: '/gundem', label: 'Gündem' },
    // "Neden MİMARLAB?" (bkz. neden-mimarlab.html) BİLEREK burada DEĞİL — kullanıcı isteği
    // (2026-09-01): sayfaya yalnızca footer'ın Kurumsal sütunundan girilir, üst menü beş içerik
    // listesiyle sınırlı kalır. Nav'a eklenmiş, sonra aynı gün kaldırılmıştır; geri eklenmeden önce
    // bkz. feedback_urun_nav_removed_intentionally deseni (durumu varsaymayın, buraya bakın).
  ];

  // Işık modunda logo koyu (lacivert/siyah) harflerle, R'daki daire+üçgen ise her zaman mavi (bkz.
  // kullanıcı isteği) — gece modunda koyu harfler nav'ın (artık koyu) zemininde kayboluyordu, bu
  // yüzden aynı logonun harfleri BEYAZA boyanmış, R'si AYNEN mavi kalan ayrı bir PNG'si (aynı 900x150
  // ölçü) hazırlandı (bkz. logos/site/mimarlab-logo-dark.png). Footer logosu buna dahil DEĞİL —
  // footer zemini temadan bağımsız hep koyu kaldığından (bkz. [data-theme="dark"] .site-footer
  // override'ı) o logo zaten hep açık renkli, ayrı bir gece sürümüne ihtiyacı yok.
  const LOGO_LIGHT = 'logos/site/mimarlab-logo.png';
  const LOGO_DARK = 'logos/site/mimarlab-logo-dark.png';
  function currentLogoSrc(){ return currentTheme() === 'dark' ? LOGO_DARK : LOGO_LIGHT; }
  // Footer logosu GECE GÖRÜNÜMÜNDE üst menüdekiyle aynı beyaz harfli logoya döner (kullanıcı isteği,
  // 2026-09-02). Eskiden sabit mimarlab-logo-footer.png idi ve temaya hiç tepki vermiyordu — koyu
  // zeminde koyu harfli bir logo neredeyse görünmez oluyordu. Gündüz görünümünde footer'a özel
  // dosya (farklı oran/renk için hazırlanmış) OLDUĞU GİBİ korunur.
  const LOGO_FOOTER_LIGHT = 'logos/site/mimarlab-logo-footer.png';
  function currentFooterLogoSrc(){ return currentTheme() === 'dark' ? LOGO_DARK : LOGO_FOOTER_LIGHT; }

  // Nav/hamburger CSS'i her sayfanın KENDİ <style>'ında (25 sayfada kopyalanmış hâlde) yaşıyor —
  // bkz. site-chrome.js'in üstündeki dosya yorumu: yalnızca markup TEK kaynaktan üretiliyor, görsel
  // kurallar hâlâ dağınık. 25 dosyayı tek tek düzenlemek yerine (bkz. kullanıcı isteği: "üst ve alt
  // menüde yapılan değişikliklerin sitedeki tüm sayfalarda eş zamanlı güncellenmesi gerekiyor"), bu
  // stil BURADA enjekte edilir — script <head>'e senkron olarak eklendiğinden, sayfanın kendi
  // <style>'ından SONRA DOM'a girer ve eşit özgüllükteki (specificity) aynı seçicileri kaynak sırası
  // gereği ezer (2026-08-28 kullanıcı isteği: arama kutusu mobil/tabletde de görünür kalsın, Giriş
  // Yap düğmesi hamburger çekmecesine taşınsın, hamburger artık sağdan kayan bir çekmece olsun).
  function injectHeaderStyle(){
    if(document.getElementById('nav-header-extra-style')) return;
    const style = document.createElement('style');
    style.id = 'nav-header-extra-style';
    style.textContent = `
      /* kullanıcı isteği (2026-08-30): arama çubuğu masaüstünde Giriş Yap butonuyla (.nav-rate,
         36px), tablet/mobilde hamburger düğmesiyle (.nav-hamburger, 38px) AYNI yükseklikte olsun —
         yatay padding/border-radius her sayfanın KENDİ <style>'ındaki değerlerle DEĞİŞMEDEN kalır.
         2026-09-19: görsel arama kaldırıldı (ücretli AI). Yüksekliği eskiden içerideki 26px'lik
         kamera düğmesi (.nav-search-visual-btn) belirliyordu (26 + 4/5px dikey padding + 1px
         kenarlık = masaüstü 36px, ≤960px 38px — ölçüldü). Düğme gidince pil yalnızca ~18px'lik
         input'a göre küçülürdü; bu yüzden AYNI ölçü artık açık height ile verilir. padding-right:6px
         de düğmeye yer açmak içindi, kaldırıldı (sayfanın kendi yatay padding'i geçerli). */
      .nav-search{box-sizing:border-box; height:36px; padding-top:4px; padding-bottom:4px;}
      @media (max-width:960px){
        .nav-search{height:38px; padding-top:5px; padding-bottom:5px;}
      }
      .nav-mobile-overlay{display:none; position:fixed; inset:0; z-index:120; background:rgba(15,19,26,0.55);}
      .nav-mobile-overlay.open{display:block;}
      .nav-mobile-menu{
        display:flex; flex-direction:column;
        position:fixed; top:0; right:0; bottom:0; left:auto;
        /* kullanıcı isteği (2026-08-28): tablet + mobilde çekmece ekranın %90'ını kaplasın — eski
           320px/78vw üst sınırları tamamen kaldırıldı, tek bir oran her iki kırılma noktasında geçerli. */
        width:90vw; max-height:none; height:100%;
        background:var(--paper-card); border:none;
        /* kullanıcı isteği (2026-08-28, Architonic ekran görüntüsü referans alınarak): çekmece sağ
           kenara yapışık kaldığından sağ köşeler zaten görünmüyor — yalnızca sol (menünün açık
           kenarındaki) köşeler Architonic'teki gibi oval/büyük radius'lu olsun. */
        border-radius:28px 0 0 28px; padding:0; margin:0; min-width:0;
        box-shadow:-10px 0 32px rgba(15,19,26,0.22);
        transform:translateX(100%); transition:transform 0.3s ease;
        z-index:130;
        /* kullanıcı isteği (2026-08-28): Hesabım/Aktivitelerim/İçeriklerim/Giriş Yap/Üye Ol/Rozet Al/
           İade Et artık AYRI bir popup DEĞİL, bu ÇEKMECENİN İÇİNDE kayan bir "alt sayfa" (bkz. aşağıdaki
           .nav-mobile-menu-panels/.nav-mobile-menu-main/.nav-mobile-menu-subpage) — kaydırma artık bu
           İKİ İÇ panelin kendisinde olur, dıştaki çekmecenin KENDİSİ overflow:hidden olmalı, aksi halde
           ekran dışındaki (henüz kaymamış) alt sayfa paneli çekmecede yatay bir kaydırma çubuğu yaratır. */
        overflow:hidden;
      }
      .nav-mobile-menu.open{transform:translateX(0);}
      .nav-mobile-menu-head{
        display:flex; align-items:center; justify-content:space-between; gap:10px; flex-shrink:0;
        padding:18px 16px 14px; border-bottom:1px solid var(--line);
        /* .nav-mobile-menu-head-center'in genis ekranlarda mutlak konumla TAM ortalanabilmesi icin
           kapsayici blok (bkz. asagidaki min-width:620px kurali). */
        position:relative;
      }
      .nav-mobile-menu-head-left{display:flex; align-items:center; gap:10px; min-width:0; flex-shrink:0;}
      /* Cekmece basligindaki ORTA yuva (kullanici istegi, 2026-08-31 madde 3): Hesabim/Aktivitelerim/
         Koleksiyonum/Iceriklerim alt sayfalarindaki uc gecis butonu, ayri bir satirda DEGIL, "Menu"
         breadcrumb'i ile X arasinda AYNI satirda dursun. flex:1 + justify-content:center, butonlari o
         iki sabit ucun arasinda kalan bosluga ortalar; min-width:0 ise dar telefonlarda satirin
         cekmeceden tasmasini engeller (butonlarin kendisi @media ile kuculur, bkz. auth-modal.js#
         .dash-nav-row). Bos oldugunda (ana menu, Giris Yap/Uye Ol gibi gecis butonu OLMAYAN alt
         sayfalar) hicbir yer kaplamaz, baslik eski space-between duzenine doner. */
      .nav-mobile-menu-head-center{display:flex; align-items:center; justify-content:center; flex:1 1 auto; min-width:0;}
      .nav-mobile-menu-head-center:empty{display:none;}
      /* 620px'ten genis ekranlarda (tablet) yuva akistan CIKARILIP cekmecenin tam ortasina demirlenir
         — istek "sayfanin ortasi" diyor, akis icinde kalan bir flex ogesi ise "Menu" (~70px) ile X
         (~34px) esit genislikte OLMADIGINDAN merkezden ~18px kayiyordu. Dar telefonlarda bu kural
         BILEREK devre disi: orada tam ortalama, satirin iki yanindan ayni payi (en genis olan
         "Menu" kadar) istedigi icin butonlara kalan yer etiketleri kirpacak kadar daralirdi —
         okunur etiket, birkac pikselik matematiksel merkezden onemli (bkz. auth-modal.js#
         .dash-nav-row media kurallari, ayni gerekce).
         top/bottom degerleri .nav-mobile-menu-head'in KENDI dikey padding'iyle ayni (18/14) —
         boylece satir, baslik satirinin icerik kutusunda breadcrumb/X ile tam ayni eksende durur.
         max-width, iki yanda 110px'lik simetrik bir pay birakir (en genis kenar olan "Menu" +
         padding + bosluk); asilirsa butonlar zaten kendi @media kurallariyla kuculuyor. */
      @media (min-width:620px){
        .nav-mobile-menu-head-center:not(:empty){
          position:absolute; left:50%; top:18px; bottom:14px; transform:translateX(-50%);
          max-width:calc(100% - 220px);
        }
      }
      /* Dar telefonlarda baslik satirinin kendi yatay padding'i ve ic bosluklari kisilir — olculen
         gercek deger: 390px'lik bir ekranda uc gecis butonu bu daralma OLMADAN toplam ~15px
         kirpiliyordu. Yalnizca alt sayfa acikken uygulanir, ana menunun gorunumu degismez. */
      @media (max-width:560px){
        .nav-mobile-menu.subpage-active .nav-mobile-menu-head{padding-left:10px; padding-right:10px; gap:6px;}
      }
      /* 340px ve alti (iPhone SE 1. nesil sinifi) — bu genislikte "Menu" kelimesinin kapladigi ~50px,
         uc gecis butonunun etiketlerini okunmaz bir puntoya inmeden sigdirmayi imkansiz kiliyor
         (olculdu: 320px'te toplam ~19px eksik kaliyordu). Kelime gizlenir, geri okunun KENDISI ve
         butonun aria-label'i ("Menuye don") oldugu gibi kalir — dokunma hedefi de kuculmez. */
      @media (max-width:340px){
        .nav-mobile-menu.subpage-active .nav-mobile-breadcrumb span{display:none;}
      }
      .nav-mobile-menu-logo{height:22px; width:auto; display:block;}
      /* Menü ana listesinden Hesabım/Giriş Yap vb. bir alt sayfaya geçilince (bkz. NavDrawer.showSubpage
         aşağıda) logo yerine bu "‹ Menü" breadcrumb'u görünür olur — tıklanınca ana listeye döner,
         çekmece KAPANMAZ (kullanıcı isteği: "üstte Menü breadcrumb/back ile hamburger ana menüsüne
         dönülsün"). Çekmecenin sağındaki X ise her durumda çekmeceyi TAMAMEN kapatır (bkz. wireNavDrawer). */
      .nav-mobile-breadcrumb{
        display:none; align-items:center; gap:6px; background:none; border:none; padding:6px 4px;
        margin:0; font-family:inherit; font-size:14.5px; font-weight:700; color:var(--ink); cursor:pointer;
      }
      .nav-mobile-breadcrumb:hover{color:var(--walnut);}
      .nav-mobile-menu.subpage-active .nav-mobile-menu-logo{display:none;}
      .nav-mobile-menu.subpage-active .nav-mobile-breadcrumb{display:flex;}
      .nav-mobile-menu-close{
        background:none; border:1px solid var(--line); border-radius:8px; padding:7px;
        color:var(--ink); display:flex; align-items:center; justify-content:center; flex-shrink:0;
      }
      .nav-mobile-menu-close:hover{background:var(--paper-alt);}
      /* Ana menü listesi ve alt sayfa (Hesabım/Giriş Yap/Rozet Al vb.) AYNI çekmece içinde yan yana iki
         panel olarak durur, .subpage-active sınıfı ikisini de yatayda kaydırır (bkz. kullanıcı isteği:
         yeni popup yerine aynı drawer içinde alt sayfa) — panels sarmalayıcı overflow:hidden ile
         kaymayan paneli tamamen gizler, her iki panel kendi İÇİNDE bağımsız kaydırılabilir. */
      .nav-mobile-menu-panels{position:relative; flex:1; min-height:0; overflow:hidden;}
      .nav-mobile-menu-main, .nav-mobile-menu-subpage{
        position:absolute; inset:0; display:flex; flex-direction:column;
        overflow-y:auto; -webkit-overflow-scrolling:touch;
        transition:transform 0.3s ease;
      }
      .nav-mobile-menu-main{transform:translateX(0);}
      .nav-mobile-menu-subpage{transform:translateX(100%);}
      .nav-mobile-menu.subpage-active .nav-mobile-menu-main{transform:translateX(-100%);}
      /* transform:none — translateX(0) DEĞİL (kullanıcı bildirimi, 2026-09-12: Hesabım > Profili
         Düzenle'de aşağı kaydırınca pop-up yukarıda kalıp kesiliyordu). transform taşıyan bir ata,
         position:fixed torunları için containing block olur; alt sayfa AYNI ZAMANDA kaydırma kutusu
         olduğundan Profili Düzenle/dizin sorusu gibi "fixed" overlay'ler alt sayfanın içeriğiyle
         birlikte kayıyordu. none ile containing block kaymayan çekmecenin kendisi olur; geçiş
         (translateX(100%) -> none) aynı şekilde animasyonlu kalır. */
      .nav-mobile-menu.subpage-active .nav-mobile-menu-subpage{transform:none;}
      .nav-mobile-subpage-body{flex:1; min-height:0; padding:18px 16px 28px; box-sizing:border-box;}
      /* kullanıcı isteği (2026-09-01 madde 1): Hesabım/Aktivitelerim/Koleksiyonum/İçeriklerim artık
         MASAÜSTÜNDE de bu çekmecede açılıyor (bkz. auth-modal.js#isMobileDrawer'daki DESKTOP_DRAWER_VIEWS).
         Çekmecenin kendisi/animasyonu/genişliği (90vw) her kırılma noktasında AYNI kalır — istek
         "tablet ve mobildeki gibi" diyor; yalnızca iç boşluk, masaüstünde eskiden bu içeriği
         barındıran ModalShell panelinin (.modal-shell-right, 32px) boşluğuna eşitlenir, aksi halde
         geniş ekranda 16px'lik telefon payı içeriği kenara yapıştırıyordu. */
      @media (min-width:961px){
        .nav-mobile-subpage-body{padding:24px 32px 40px;}
      }
      .nav-mobile-menu-links{padding:10px; flex:1;}
      .nav-mobile-menu-foot{padding:14px 16px 22px; border-top:1px solid var(--line); flex-shrink:0;}
      .nav-mobile-menu-foot .nav-mobile-cta{margin-top:0; display:flex; align-items:center; justify-content:center;}
      /* kullanıcı isteği (2026-08-28): iki CTA (Giriş Yap + Üye Ol) alt alta dizildiğinde aralarında
         boşluk olsun — ilk kural yukarıda TÜM .nav-mobile-cta'ların margin-top'unu sıfırladığından
         (tek CTA'lık eski tasarım için), ikinciye özel bir boşluk komşu-kardeş seçiciyle eklenir. */
      .nav-mobile-menu-foot .nav-mobile-cta + .nav-mobile-cta{margin-top:10px;}
      /* kullanıcı isteği (2026-08-28, Architonic ekran görüntüsü referans alınarak): drawer'daki her
         satırda TEK bir sayfa ismi bulunmalı — .nav-mobile-link bir <a> olduğundan display kuralı
         hiçbir sayfanın kendi <style>'ında tanımlı değildi (bkz. proje.html#.nav-mobile-link), bu
         yüzden varsayılan inline akışta ardışık linkler (Proje/Ürün/Mimar/Firma) aynı satıra
         sığdıkları kadar yan yana diziliyordu. display:flex + width:100% her linki kendi satırına
         zorlar; font-size de aynı istekle (14.5px → 16px, sonra kullanıcı isteğiyle 17px'e) büyütüldü.
         background/border/text-align/cursor reset'i BURADA eklendi çünkü .nav-mobile-link bazen bir
         <button> olarak kullanılıyor (ör. auth-nav.js#nav-mobile-logout-btn) — reset olmadan o satır
         tarayıcının varsayılan gri buton çerçeve/arkaplanıyla diğer satırlardan (<a>) farklı
         görünüyordu (kullanıcı isteği: "Çıkış yap butonuna özel bir arka plan... yapma"). */
      .nav-mobile-link{display:flex; align-items:center; gap:10px; width:100%; box-sizing:border-box; font-size:17px; background:none; border:none; text-align:left; cursor:pointer;}
      /* .nav-mobile-cta yalnızca index.html'in KENDİ <style>'ında tam tanımlıydı (diğer 24 sayfada
         hiç yoktu) — burada TEK kaynaktan enjekte edilerek her sayfada aynı görünüm garanti edilir. */
      .nav-mobile-cta{
        width:100%; margin-top:6px;
        background:var(--ink); color:var(--paper-card);
        border:none; padding:12px 14px; border-radius:8px;
        font-size:15px; font-weight:600; box-sizing:border-box;
      }
      .nav-mobile-cta:hover{background:var(--walnut);}
      /* kullanıcı isteği (2026-08-28): Üye Ol, Giriş Yap'ın dolu (koyu) tasarımıyla KONTRAST oluşturan
         çerçeveli/boş bir ikincil buton — masaüstündeki .nav-rate ile aynı fikir. Bu kural yukarıdaki
         tam .nav-mobile-cta tanımından SONRA gelmeli — ikisi de eşit özgüllükte (tek sınıf) olduğundan
         kaynak sırasında SONRAKİ kazanır; önce gelseydi .nav-mobile-cta'nın background:var(--ink)
         kuralı bunu ezerdi (gerçek bulgu, ilk sürümde tam bunun olduğu görüldü). */
      .nav-mobile-cta-secondary{background:none; color:var(--ink); border:1.5px solid var(--ink);}
      .nav-mobile-cta-secondary:hover{background:var(--paper-alt);}
      @media (max-width:960px){
        .nav-search{display:flex;}
        .nav-right{display:none;}
        /* kullanıcı isteği: tablette hamburger düğmesi arama kutusuna yapışmasın, en sağda dursun —
           .nav-right gizlenince onun eski margin-left:auto'suyla sağa itilen tek eleman kalmıyordu
           (bkz. proje.html vb. sayfalardaki @media (max-width:960px) .nav-right{margin-left:auto}
           kuralı, artık gizli bir elemanın margin'i akışa hiç katkı yapmıyor). */
        .nav-hamburger{margin-left:auto;}
        /* kullanıcı isteği (2026-08-30): mobil görünümde ana menüdeki logo biraz küçültülsün —
           .brand-logo her sayfanın KENDİ <style>'ında height:24px olarak tanımlı (bkz. dosya başı
           yorumu, ".nav-mobile-cta" İLE AYNI "TEK kaynaktan enjekte et" deseni); bu <style> DOM'a
           her sayfanın kendi inline <style>'ından SONRA eklendiğinden, eşit özgüllükte kaynak sırası
           bu kuralı kazandırır. */
        .brand-logo{height:19px;}
      }
    `;
    document.head.appendChild(style);
  }

  function headerHtml(active){
    const desktopLinks = NAV_ITEMS.map(item => {
      const activeClass = item.key === active ? ' active' : '';
      if(item.mega){
        // denetim bulgusu (2026-09-01): bu öğe bir <button>'dı — yani masaüstü ana menüsünde /urun'e
        // giden TARANABİLİR hiçbir bağlantı yoktu (diğer 4 nav öğesinin hepsi <a href>). Google için
        // ürün listeleme sayfasına tek iç bağlantı footer'daki bağlantıydı; kullanıcı için de
        // Cmd/orta tıkla yeni sekmede açmak mümkün değildi. Artık gerçek bir <a href="/urun">:
        // düz sol tıklama (aşağıdaki dinleyicilerde preventDefault ile) YİNE mega menüyü açar,
        // Cmd/Ctrl/Shift/orta tıkta tarayıcının doğal davranışı çalışır.
        return `<div class="nav-link-wrap" id="urun-menu-wrap">
        <a class="nav-link nav-link-trigger${activeClass}" id="urun-menu-trigger" href="${escapeAttr(item.href)}" aria-expanded="false" aria-controls="urun-mega-menu">
          ${escapeHtml(item.label)}
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 1l4 4 4-4"/></svg>
        </a>
      </div>`;
      }
      return `<a class="nav-link${activeClass}" href="${escapeAttr(item.href)}">${escapeHtml(item.label)}</a>`;
    }).join('\n      ');

    const mobileLinks = NAV_ITEMS.map(item => {
      const activeClass = item.key === active ? ' active' : '';
      if(item.mega){
        return `<div class="nav-mobile-accordion">
        <button type="button" class="nav-mobile-link nav-mobile-accordion-trigger${activeClass}" id="urun-mobile-trigger" aria-expanded="false" aria-controls="urun-mobile-panel">
          ${escapeHtml(item.label)}
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 1l4 4 4-4"/></svg>
        </button>
        <div class="nav-mobile-accordion-panel" id="urun-mobile-panel"></div>
      </div>`;
      }
      return `<a class="nav-mobile-link${activeClass}" href="${escapeAttr(item.href)}">${escapeHtml(item.label)}</a>`;
    }).join('\n      ');

    return `<nav class="nav">
    <a class="brand" href="/">
      <img class="brand-logo" id="brand-logo-img" src="${currentLogoSrc()}" alt="MimarLab">
    </a>
    <div class="nav-search">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" id="f-search-topnav" placeholder="Aradığını yaz, bulmana yardımcı olalım" aria-label="Ara">
      <!-- 2026-09-19: görsel arama (kamera) düğmesi kaldırıldı (ücretli AI). -->
    </div>
    <div class="nav-links">
      ${desktopLinks}
    </div>
    <div class="mega-menu" id="urun-mega-menu"></div>
    <div class="nav-right">
      <a class="nav-rate" href="/giris">Giriş Yap</a>
    </div>
    <button class="nav-hamburger" id="nav-hamburger" aria-label="Menü">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
    </button>
    <div class="nav-mobile-overlay" id="nav-mobile-overlay"></div>
    <div class="nav-mobile-menu" id="nav-mobile-menu">
      <div class="nav-mobile-menu-head">
        <div class="nav-mobile-menu-head-left" id="nav-mobile-menu-head-left">
          <img class="nav-mobile-menu-logo" id="nav-mobile-menu-logo" src="${currentLogoSrc()}" alt="MimarLab">
          <button type="button" class="nav-mobile-breadcrumb" id="nav-mobile-breadcrumb" aria-label="Menüye dön">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            <span>Menü</span>
          </button>
        </div>
        <div class="nav-mobile-menu-head-center" id="nav-mobile-menu-head-center"></div>
        <button type="button" class="nav-mobile-menu-close" id="nav-mobile-menu-close" aria-label="Kapat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="nav-mobile-menu-panels" id="nav-mobile-menu-panels">
        <div class="nav-mobile-menu-main" id="nav-mobile-menu-main">
          <div class="nav-mobile-menu-links">
            ${mobileLinks}
          </div>
          <div class="nav-mobile-menu-foot" id="nav-mobile-menu-foot">
            <a class="nav-mobile-cta" href="/giris">Giriş Yap</a>
            <a class="nav-mobile-cta nav-mobile-cta-secondary" href="/uye-ol">Üye Ol</a>
          </div>
        </div>
        <div class="nav-mobile-menu-subpage" id="nav-mobile-menu-subpage">
          <div class="nav-mobile-subpage-body" id="nav-mobile-subpage-body"></div>
        </div>
      </div>
    </div>
  </nav>`;
  }

  function footerHtml(){
    return `<footer class="site-footer">
    <!-- 2026-09-19: bülten kaldırıldı (e-posta gönderim maliyeti). Eski "Bültene Abone Ol" bandı
         (.footer-subscribe + /api/newsletter/subscribe formu) footer'dan tamamen çıktı. -->
    <div class="footer-top">
      <div class="footer-brand">
        <a class="footer-logo" href="/">
          <img class="footer-logo-img" id="footer-logo-img" src="${currentFooterLogoSrc()}" alt="MimarLab" loading="lazy" decoding="async">
        </a>
        <p>Mimarlık, iç mimarlık, peyzaj mimarlığı, restorasyon, şehir planlama, fotoğrafçılık, tasarım gibi farklı disiplinleri ve çeşitli üreticileri bir araya getiren mimar platformu.</p>
      </div>
      <!-- Sıra NAV_ITEMS ile AYNI (bkz. oradaki 2026-09-17/2026-09-19 notları): Proje · Fotoğraf ·
           Firma · Kişi · Gündem (Ürün 2026-09-19'da kaldırıldı — /proje'deki Ürün menüsüne taşındı). -->
      <div class="footer-col"><h4>Ana Menü</h4><a href="/proje">Proje</a><a href="/fotograf">Fotoğraf</a><a href="/firma">Firma</a><a href="/kisi">Kişi</a><a href="/gundem">Gündem</a></div>
      <div class="footer-col"><h4>Topluluk</h4><a href="/giris">Giriş Yap</a><a href="/uye-ol">Üye Ol</a><a href="/rozet-al">Rozet Al</a><a href="/iade-et">İade Et</a><button type="button" class="footer-add-content" id="footer-add-content">Sen de Ekle</button></div>
      <!-- Sıra (kullanıcı isteği, 2026-09-12): İletişim, Hakkında, Neden MİMARLAB?, sonrası aynı. -->
      <div class="footer-col"><h4>Kurumsal</h4><a href="/iletisim">İletişim</a><a href="/hakkinda">Hakkında</a><a href="/neden-mimarlab">Neden MİMARLAB?</a><a href="/gizlilik-politikasi">Gizlilik Politikası</a><a href="/hizmet-sartlari">Hizmet Şartları</a><a href="/cerez-politikasi">Çerez Politikası</a></div>
    </div>
    <div class="footer-bottom">
      <div class="footer-social">
        <a href="https://www.instagram.com/mimarlabcom/" target="_blank" rel="noopener" aria-label="Instagram"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/></svg></a>
        <a href="https://x.com/mimarlabcom?s=11&amp;t=ijRg66Se2p_FxlB3-aK-6w" target="_blank" rel="noopener" aria-label="X"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.3 2H21l-7.3 8.3L22.2 22h-6.8l-5.3-6.9L4 22H1.3l7.8-8.9L1.5 2h6.9l4.8 6.3L18.3 2z"/></svg></a>
        <a href="https://www.linkedin.com/company/mimarlab/" target="_blank" rel="noopener" aria-label="LinkedIn"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M4.5 3.5A2 2 0 1 0 4.5 7.5 2 2 0 0 0 4.5 3.5zM3 9h3v12H3zM10 9h2.9v1.6h.1c.4-.8 1.5-1.6 3-1.6 3.2 0 3.8 2.1 3.8 4.9V21h-3v-6.6c0-1.6 0-3.6-2.2-3.6s-2.5 1.7-2.5 3.5V21H10z"/></svg></a>
      </div>
      <span class="footer-copyright">© Tüm hakları saklıdır. MİMARLAB, 2026<br>Sitede yer alan görseller ilgili kişilere ya da firmalara aittir.</span>
      <!-- kullanıcı isteği (2026-09-06 madde 8): sağa/sola kayan pil (knob'lu switch) tasarımı
           bırakıldı — artık TEK dairesel bir düğme. İki ikon da DOM'da kalır, hangisinin görüneceğine
           CSS karar verir (bkz. injectFooterStyle): gündüzken ay (tıkla → geceye geç), geceyken güneş.
           Renkler de temayla birlikte değişir, böylece düğmenin durumu bir bakışta okunur. -->
      <button type="button" class="footer-theme-toggle" id="footer-theme-toggle" aria-pressed="false" aria-label="Gece modunu değiştir">
        <span class="theme-toggle-icon theme-icon-sun" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8L6 18M18 6l1.8-1.8"/></svg></span>
        <span class="theme-toggle-icon theme-icon-moon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 14.5a8.5 8.5 0 1 1-9-11 7 7 0 0 0 9 11z"/></svg></span>
      </button>
    </div>
    <p class="footer-archive-note">MİMARLAB, açık kaynaklardan derlenen bilgilerle oluşturuldu. Hata, eksiklik veya güncellemesi gereken bir durum olduğunu düşünüyorsan <a href="/iletisim">bizimle iletişime geç</a>.</p>
  </footer>`;
  }

  // Footer'da enjekte edilen ek stiller (bkz. wireNavSearch'teki AYNI "bir kere enjekte et" deseni) —
  // footer'ın kendi :root override'ı (bkz. her sayfanın <style>'ındaki [data-theme="dark"] .site-footer
  // bloğu, kullanıcı isteği: "gece modu") --ink/--paper/--brass-soft'u footer içinde SABİT tuttuğundan,
  // burada var(--paper) vb. kullanmak footer HER ZAMAN aynı (koyu zemin + açık yazı) görünmesini sağlar.
  function injectFooterStyle(){
    if(document.getElementById('footer-extra-style')) return;
    const style = document.createElement('style');
    style.id = 'footer-extra-style';
    style.textContent = `
      /* Topluluk sütununun son satırındaki "İçerik Ekle" (kullanıcı isteği, 2026-08-31) — bir sayfaya
         gitmediği (popup açtığı) için <a> değil <button>; sütundaki <a> kardeşleriyle GÖRSEL olarak
         birebir aynı görünmesi gerektiğinden buton varsayılanları (arkaplan/kenarlık/hizalama/font)
         burada sıfırlanır. Ölçüler her sayfanın kendi .footer-col a kuralıyla AYNI (13.5px, 11px alt
         boşluk) — o kural her sayfanın <style>'ında tanımlı, buraya kopyalanmaz, yalnızca eşlenir. */
      .footer-add-content{
        display:block; width:100%; text-align:left; padding:0; margin:0 0 11px;
        background:none; border:none; font-family:inherit; font-size:13.5px;
        color:rgba(237,240,243,0.85); cursor:pointer;
      }
      .footer-add-content:hover{color:#EDF0F3;}
      /* "İçerik Ekle" popup'ı — site genelinde tek bir hafif overlay. ModalShell KULLANILMAZ: bu
         popup proje/mimar/firma/ürün modallarının paylaştığı o tek overlay'i sahiplenirse (bkz.
         modal-shell.js#claimContent) altta açık bir detay popup'ının içeriğini silerdi; burada
         gerekli olan tek şey beş bağlantı taşıyan küçük bir kart. */
      .add-content-overlay{
        display:none; position:fixed; inset:0; z-index:210; align-items:center; justify-content:center;
        padding:20px; background:rgba(27,42,61,0.5); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
      }
      [data-theme="dark"] .add-content-overlay{background:rgba(255,255,255,0.16);}
      .add-content-overlay.open{display:flex;}
      .add-content-panel{
        position:relative; width:100%; max-width:380px; background:var(--paper-card); color:var(--ink);
        border-radius:18px; padding:26px 24px 24px; box-shadow:0 24px 60px rgba(27,42,61,0.3);
      }
      .add-content-close{
        position:absolute; top:14px; right:14px; width:32px; height:32px; border-radius:50%; border:none;
        background:var(--paper-alt); color:var(--ink-soft); display:flex; align-items:center; justify-content:center; cursor:pointer;
      }
      .add-content-close:hover{color:var(--ink);}
      .add-content-panel h2{
        font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size:19px; font-weight:700; margin:0 0 4px; padding-right:34px;
      }
      .add-content-panel p{font-size:12.5px; color:var(--ink-soft); margin:0 0 18px; line-height:1.55;}
      .add-content-list{display:flex; flex-direction:column; gap:9px;}
      .add-content-list a{
        display:flex; align-items:center; justify-content:space-between; gap:10px;
        padding:12px 18px; border-radius:100px; border:1.5px solid var(--ink);
        font-size:13.5px; font-weight:600; color:var(--ink); text-decoration:none;
      }
      .add-content-list a:hover{background:var(--ink); color:var(--paper-card);}
      /* 2026-09-19: bülten kaldırıldı — .footer-subscribe / .footer-newsletter-* kuralları silindi. */
      /* FOOTER MENÜSÜ SÜTUNLARA ORTALANIR (kullanıcı isteği, 2026-09-12: "logo, açıklama,
         başlıkların ve sayfa isimlerinin sütunlara ortalanmasını istiyorum ... Masaüstü
         görünümde 4 sütun olarak görünen bu kısım yine sütunlara göre hizalansınlar").
         Sütunlar EŞİT genişliğe çekilir: eski 1.3/0.9/1/1.15 oranları SOLA hizalı metin için
         ayarlanmıştı (farklı uzunluktaki sütunlar arasındaki boşluk gözle eşit dursun diye);
         içerik ortalandığında o eşitliği veren şey sütun MERKEZLERİNİN eşit aralıklı olmasıdır,
         yani eşit sütunlar. Hizalama grid'in kendisine değil, hücrenin İÇİNE yazılır
         (text-align) — kutular tam hücre genişliğinde kalır, yalnızca içerikleri ortalanır. */
      .footer-top{grid-template-columns:repeat(4, 1fr); text-align:center;}
      /* Logo bir flex kutusu, açıklama ise max-width taşıyan bir blok: ikisi text-align'dan
         etkilenmez, kendi ortalamalarını ister. */
      .footer-top .footer-logo{justify-content:center;}
      .footer-top .footer-brand p{margin-left:auto; margin-right:auto;}
      /* LOGO ALTINDAKİ TANITIM YAZISI BEYAZ (kullanıcı isteği, 2026-09-13: "Footer menüsünde
         logonun altındaki yazı da beyaz renk olsun").
         NEDEN BURADA VE NEDEN BU SEÇİCİ: .footer-brand p kuralının kendisi 32 AYRI HTML
         dosyasında ayrı ayrı yazılı (rgba(237,240,243,0.6)) — 32 kopyayı tek tek düzenlemek bu
         depodaki bilinen tuzağın ta kendisi: biri unutulur ve o sayfada yazı gri kalır. Footer'ı
         zaten TEK yerden basan bu bileşen, stilini de <head>'e SONRADAN enjekte eder; sayfa
         CSS'inden daha yüksek özgüllükle (.site-footer .footer-brand p = 0,2,1) yazıldığında
         kural yükleme sırasından bağımsız olarak her sayfada kazanır. */
      .site-footer .footer-brand p{color:#fff;}
      /* SÜTUN BAĞLANTILARI BEYAZ (kullanıcı isteği, 2026-09-13: "Ana Menü, Topluluk, Kurumsal
         başlıkları altındaki menü isimlerini de beyaz renk yap"). Başlıkların (h4) kendi soluk
         tonu korunur — istenen yalnızca altlarındaki isimler.
         Bir üstteki .footer-brand p ile AYNI gerekçe: .footer-col a kuralı 32 ayrı HTML
         dosyasında rgba(237,240,243,0.85) olarak yazılı, tek tek düzenlemek bir sayfayı unutma
         riski demek. Footer'ı tek yerden basan bu bileşen stilini de sonradan enjekte eder ve
         .site-footer .footer-col a (0,3,1) sayfa CSS'inden (0,1,1) yüksek özgüllükte kazanır.
         "Sen de Ekle" <a> değil <button> olduğu için ayrıca eşlenir (bkz. .footer-add-content). */
      .site-footer .footer-col a,
      .site-footer .footer-col .footer-add-content{color:#fff;}
      /* :hover yine sayfa CSS'indeki --brass-soft'a gider; buradaki tek istisna butondu
         (kendi kuralı #EDF0F3 diyordu), o da kardeşleriyle aynı davranışa çekilir. */
      .site-footer .footer-col a:hover,
      .site-footer .footer-col .footer-add-content:hover{color:var(--brass-soft);}
      /* "Sen de Ekle" sütundaki <a> kardeşleriyle birebir aynı görünmeli (bkz. .footer-add-content
         kuralı) — o kural text-align:left yazdığı için burada ortaya çekilir. */
      .footer-top .footer-add-content{text-align:center;}
      /* ALT SATIR — ÜSTTEKİ SÜTUNLARLA HİZALI (kullanıcı isteği, 2026-09-12: "sosyal simgeleri
         1. sütuna göre ortala, gece-gündüz butonunu da 4. sütuna göre ortala").
         Raylar .footer-top ile BİREBİR aynı — repeat(4, 1fr) + 32px gap, bkz. bu bloğun birkaç
         satır yukarısındaki .footer-top kuralı (sayfa CSS'indeki 2fr 1fr 1fr 1fr'i zaten o ezer) —
         ve iki kapsayıcı aynı max-width/padding'i taşıdığı için sütun merkezleri tam tutar:
         sosyal ikonlar marka sütununun (1), düğme Kurumsal sütununun (4) ortasına oturur.
         Satır GÖRSEL OLARAK yine ÜÇ parçadır: telif metni ortadaki iki rayı birlikte kaplar (2/4).
         Dört ray eşit olduğundan bu span'in ortası sayfanın tam ortasıdır, yani telif metni
         eskisi gibi ortada kalır. Önceki "1fr auto 1fr + sola/sağa yasla" düzeninin yerini alır. */
      .footer-bottom{display:grid; grid-template-columns:repeat(4, 1fr); align-items:center; gap:32px; max-width:1080px; margin:0 auto; box-sizing:border-box;}
      .footer-bottom .footer-social{grid-column:1; justify-self:center;}
      .footer-copyright{grid-column:2 / 4; justify-self:center; text-align:center;}
      /* Arsiv ibaresi (kullanici istegi 2026-09-07): footer'in EN ALTINDA, sayfayi ortalayan
         tek satirlik not. Sitedeki kayitlarin kamuya acik kaynaklardan derlendigini ve hata
         bildiriminin nasil yapilacagini soyler. Renkler footer'in kendi sabit paletinden gelir
         (bkz. .footer-bottom'un sayfa CSS'indeki AYNI rgba degerleri) - footer zemini temadan
         bagimsiz hep koyu kaldigindan degisken yerine sabit rgba kullanilir. */
      .footer-archive-note{
        max-width:1080px; margin:0 auto; padding:16px 32px 22px;
        border-top:1px solid rgba(237,240,243,0.12);
        text-align:center; font-size:11.5px; line-height:1.7;
        color:rgba(237,240,243,0.45); box-sizing:border-box;
      }
      .footer-archive-note a{color:rgba(237,240,243,0.72); text-decoration:underline; text-underline-offset:2px;}
      .footer-archive-note a:hover{color:rgba(237,240,243,0.95);}
      /* Gece/gündüz düğmesi: Kurumsal sütununun (4) ortası — bkz. yukarıdaki ray açıklaması.
         2026-09-01'deki "sağ kenara yapışmasın" kararının devamı, yalnızca referans sütun netleşti. */
      .footer-bottom .footer-theme-toggle{grid-column:4; justify-self:center;}
      .footer-social{display:flex; align-items:center; gap:14px; height:28px;}
      .footer-social a{display:flex; align-items:center; justify-content:center;}
      .footer-social svg{display:block;}
      /* Gece/gündüz düğmesi — TEK dairesel buton (kullanıcı isteği, 2026-09-06 madde 8; eski
         kaydırmalı pil + knob tasarımının yerini aldı). Aynı anda yalnızca BİR ikon görünür ve
         gösterilen ikon "tıklarsan ne olacağı"nı anlatır: gündüzken ay (koyu lacivert zemin),
         geceyken güneş (sıcak amber zemin). Renkler BİLEREK sabit hex: footer'ın kendi tema
         override'ı (bkz. bu dosyanın başındaki not) --ink/--paper'ı footer içinde her iki temada da
         AYNI tutuyor, yani token kullanmak düğmeyi temaya duyarsız bırakırdı. */
      .footer-theme-toggle{
        display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
        width:34px; height:34px; padding:0; border-radius:50%; border:none;
        background:#3E5C7E; color:#F2F6FA; cursor:pointer;
        transition: background 0.2s ease, color 0.2s ease, transform 0.15s ease;
      }
      [data-theme="dark"] .footer-theme-toggle{background:#F0C070; color:#2A1F0E;}
      .footer-theme-toggle:hover{transform:scale(1.08);}
      .footer-theme-toggle .theme-toggle-icon{display:flex; align-items:center; justify-content:center;}
      .footer-theme-toggle .theme-icon-sun{display:none;}
      [data-theme="dark"] .footer-theme-toggle .theme-icon-sun{display:flex;}
      [data-theme="dark"] .footer-theme-toggle .theme-icon-moon{display:none;}
      @media (max-width: 860px){
        /* Tablet/mobil: aynı ortalama, iki sütunda (kullanıcı isteği — ekli görselde bu kısım
           sol baştan hizalıydı). text-align/justify-content kuralları yukarıdaki taban bloktan
           gelir, burada yalnızca sütun sayısı ve boşluklar değişir. */
        .footer-top{grid-template-columns: 1fr 1fr; column-gap:20px; row-gap:28px;}
        .footer-brand{grid-column:auto;}
      }
      /* TABLET (561–860px; kullanıcı isteği, 2026-09-12): alt satır ÜÇ SÜTUN kalır ve üç öğe de
         kendi sütununun ortasına hizalanır. Masaüstündeki 4 raylı hizalama burada bırakılır: üstteki
         ızgara da bu genişlikte 2 sütuna indiğinden (bkz. sayfa CSS'indeki .footer-top kuralı)
         referans sütunlar artık yok. Yan sütunlar 1fr, orta ray auto: telif metni kendi doğal
         genişliğini alır, ikonlar ve düğme iki yanında ortalanır.
         MOBİL bu kuralın DIŞINDA: ≤560px'te aşağıdaki blok eski yığılmış tasarımı korur. */
      @media (max-width: 860px){
        .footer-bottom{grid-template-columns:1fr auto 1fr; gap:16px;}
        .footer-bottom .footer-social{grid-column:1; justify-self:center;}
        .footer-copyright{grid-column:2; justify-self:center; text-align:center;}
        .footer-bottom .footer-theme-toggle{grid-column:3; justify-self:center;}
      }
      /* MOBİL (≤560px) TASARIMI DEĞİŞMEZ (kullanıcı isteği, 2026-09-12: "Mobil görünümdeki footer
         menü tasarımını değiştirme"). 2026-08-28'de kararlaştırılan yığılmış düzen aynen korunur:
         en alt satır üç AYRI satıra iner — sırasıyla gece/gündüz düğmesi, sosyal ikonlar, © telif
         metni (DOM sırası social, copyright, theme-toggle olduğundan görsel sıra CSS order ile
         kurulur). Bir üstteki ≤860px bloğunun üç sütunlu ızgarası burada display:flex ile
         devre dışı kalır; o blok yalnızca TABLET aralığında (561–860px) geçerlidir. */
      @media (max-width: 560px){
        .footer-bottom{display:flex; flex-direction:column; align-items:center; gap:14px;}
        .footer-theme-toggle{order:1;}
        .footer-social{order:2;}
        .footer-copyright{order:3; text-align:center;}
      }
    `;
    document.head.appendChild(style);
  }

  function currentTheme(){
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(theme){
    if(theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = theme;
    try{ localStorage.setItem('mimarlab-theme', theme); }catch(e){}
    const logoImg = document.getElementById('brand-logo-img');
    if(logoImg) logoImg.src = theme === 'dark' ? LOGO_DARK : LOGO_LIGHT;
    // Çekmece (hamburger) ve footer logoları da AYNI anda güncellenmeli — eskiden yalnızca başlık
    // logosu değişiyordu, tema düğmesine basıldığında diğer ikisi eski temada kalıyordu.
    const drawerLogo = document.getElementById('nav-mobile-menu-logo');
    if(drawerLogo) drawerLogo.src = theme === 'dark' ? LOGO_DARK : LOGO_LIGHT;
    const footerLogo = document.getElementById('footer-logo-img');
    if(footerLogo) footerLogo.src = theme === 'dark' ? LOGO_DARK : LOGO_FOOTER_LIGHT;
  }

  function wireFooterTheme(){
    const btn = document.getElementById('footer-theme-toggle');
    if(!btn || btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.setAttribute('aria-pressed', String(currentTheme() === 'dark'));
    btn.addEventListener('click', ()=>{
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      btn.setAttribute('aria-pressed', String(next === 'dark'));
    });
  }

  // 2026-09-19: bülten kaldırıldı — wireFooterNewsletter (/api/newsletter/subscribe) silindi.

  // kullanıcı isteği (2026-08-28, ekli Architonic ekran görüntüleri referans alınarak): üst
  // menüdeki arama kutusuna tıklayınca artık küçük bir öneri açılır penceresi DEĞİL, tüm ekranı
  // kaplayan bir popup büyüyor — üstte büyük arama kutusu, boşken "Önerilen Aramalar" çipleri
  // (bkz. aşağıdaki NAV_SEARCH_RECOMMENDED), yazmaya başlanınca öneriler AYNI
  // /api/public/search-suggest ucundan (eski panelin kullandığı UÇLA BİREBİR AYNI) canlı sonuçlarla
  // değişiyor. 2026-09-19: görsel arama kaldırıldı (ücretli AI) — popup'taki "Görsel ile Proje ve
  // Ürün Arama" bölümü artık yok; popup yalnızca metin aramasını taşır.
  // kullanıcı isteği (2026-08-30, düzeltme): sabit örnek terimler yerine, PROJE gönderilerindeki
  // en kalabalık 5 "Grup" değeri gösterilsin — proje.js#FILTER_GROUPS'ta "Grup" etiketi `type`
  // anahtarına karşılık gelir (bkz. js/pages/proje.js#FILTER_GROUPS, "Tür"/discipline ile
  // KARIŞTIRILMAMALI). /api/projects/filters zaten options'ı count'a göre azalan sırada döndürür
  // (bkz. src/routes/project.js#handleProjectFiltersRoute), burada ekstra sıralama gerekmez.
  // (İlk sürümde yanlışlıkla ürün havuzunun Grup taksonomisi kullanılmıştı, kullanıcı isteğiyle
  // proje gönderilerine düzeltildi.)
  // GERÇEK BULGU (kullanıcı bildirimi, 2026-09-06): popup açılırken önce ESKİ öneri butonları çok
  // kısa süre görünüp sonra doğrusuna dönüşüyordu. Sebep: open() önce bu diziyle BOYAR, sonra
  // /api/projects/filters dönünce YENİDEN boyardı — yani her sayfa yüklemesindeki ilk açılışta
  // gözle görülür bir "yanlış içerik" karesi vardı. Üç katmanlı çözüm:
  //   1) Varsayılan dizi artık gerçek ilk-beş Grup değeriyle AYNI (bkz. project-taxonomy.js#
  //      PROJECT_GROUP_OPTIONS) — fetch hiç dönmese bile doğru tasarım görünür.
  //   2) Son bilinen değerler sessionStorage'da saklanır; sonraki sayfa yüklemelerinde ilk boyama
  //      zaten sunucunun gerçek sıralamasıyla yapılır.
  //   3) loadRecommendedTerms artık DEĞER DEĞİŞMEDİYSE onLoaded'ı hiç çağırmaz (bkz. aşağıdaki
  //      sameTerms kontrolü) — ikinci boyama, dolayısıyla DOM titremesi, tamamen ortadan kalkar.
  const NAV_SEARCH_TERMS_CACHE_KEY = 'mimarlab:navSearchTerms';
  const NAV_SEARCH_RECOMMENDED_DEFAULT = ['Ofis / İş Merkezi', 'Konut', 'Turizm / Otel', 'Müze', 'Kafe / Restoran'];
  let NAV_SEARCH_RECOMMENDED = NAV_SEARCH_RECOMMENDED_DEFAULT;
  try {
    const cached = JSON.parse(sessionStorage.getItem(NAV_SEARCH_TERMS_CACHE_KEY) || 'null');
    if (Array.isArray(cached) && cached.length) NAV_SEARCH_RECOMMENDED = cached;
  } catch {}
  let recommendedTermsLoaded = false;
  function sameTerms(a, b){ return a.length === b.length && a.every((v, i) => v === b[i]); }
  function loadRecommendedTerms(onLoaded){
    if(recommendedTermsLoaded) return;
    fetch('/api/projects/filters')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        const options = (data && data.filters && data.filters.type && data.filters.type.options) || [];
        if(!options.length) return;
        recommendedTermsLoaded = true;
        const next = options.slice(0, 5);
        try { sessionStorage.setItem(NAV_SEARCH_TERMS_CACHE_KEY, JSON.stringify(next)); } catch {}
        // Değişmediyse yeniden boyama YOK — aksi halde aynı içerik yeniden yazılıp gözle görülür
        // bir DOM titremesi (ve chip dinleyicilerinin gereksiz yeniden bağlanması) olurdu.
        if(sameTerms(NAV_SEARCH_RECOMMENDED, next)) return;
        NAV_SEARCH_RECOMMENDED = next;
        if(onLoaded) onLoaded();
      })
      .catch(() => {});
  }
  let navSearchModalApi = null;

  function ensureNavSearchModal(){
    if(navSearchModalApi) return navSearchModalApi;

    if(!document.getElementById('nav-search-modal-style')){
      const style = document.createElement('style');
      style.id = 'nav-search-modal-style';
      style.textContent = `
        .nav-search, .nav-mobile-search{position:relative;}
        .nav-search-modal-overlay{
          display:none; position:fixed; inset:0; z-index:500;
          background:rgba(20,24,30,0.62); backdrop-filter:blur(2px);
          align-items:flex-start; justify-content:center; padding:80px 20px 20px;
          overflow-y:auto;
        }
        .nav-search-modal-overlay.open{display:flex;}
        .nav-search-modal{
          width:100%; max-width:720px; background:var(--paper-card); border-radius:20px;
          padding:28px; position:relative; box-shadow:0 30px 70px rgba(0,0,0,0.35);
        }
        .nav-search-modal-close{
          position:absolute; top:16px; right:16px; background:none; border:none; color:var(--ink-soft);
          padding:8px; cursor:pointer; display:flex; border-radius:50%;
        }
        .nav-search-modal-close:hover{color:var(--ink); background:var(--paper-alt);}
        .nav-search-modal-input-row{
          display:flex; align-items:center; gap:12px; border:1.5px solid var(--line); border-radius:100px;
          padding:14px 20px; margin-right:36px;
        }
        .nav-search-modal-input-row svg{flex-shrink:0; color:var(--ink-soft);}
        .nav-search-modal-input-row input{
          flex:1; min-width:0; border:none; outline:none; background:none; font-family:inherit;
          font-size:15px; color:var(--ink);
        }
        .nav-search-modal-input-row input::placeholder{color:var(--ink-soft);}
        .nav-search-modal-input-row input:focus-visible{box-shadow:none;}
        .nav-search-modal-section{margin-top:26px;}
        .nav-search-modal-section-title{font-size:14px; font-weight:700; color:var(--ink); margin:0 0 14px;}
        .nav-search-modal-chips{display:flex; flex-wrap:wrap; gap:10px;}
        .nav-search-modal-chip{
          background:var(--paper); border:1px solid var(--line); border-radius:100px; padding:9px 18px;
          font-family:inherit; font-size:13px; font-weight:600; color:var(--ink); cursor:pointer;
        }
        .nav-search-modal-chip:hover{border-color:var(--walnut); background:var(--paper-alt);}
        .nav-search-modal-results{display:flex; flex-direction:column; gap:2px;}
        .nav-search-modal-row{display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:10px; font-size:13.5px; color:var(--ink);}
        .nav-search-modal-row:hover{background:var(--paper-alt);}
        .nav-search-modal-row-tag{flex-shrink:0; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:10px; text-transform:uppercase; letter-spacing:0.04em; color:var(--ink-soft); background:var(--paper-alt); border-radius:100px; padding:2px 8px;}
        .nav-search-modal-row-title{flex:1; min-width:0; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
        .nav-search-modal-row-meta{flex-shrink:0; font-size:11.5px; color:var(--ink-soft); max-width:140px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
        .nav-search-modal-row-thumb{flex-shrink:0; width:40px; height:40px; border-radius:8px; object-fit:cover; background:var(--paper-alt); border:1px solid var(--line-soft);}
        .nav-search-modal-row-thumb-ph{display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:700; color:var(--ink-soft);}
        @media (max-width: 480px){ .nav-search-modal-row-meta{max-width:80px;} .nav-search-modal-row-thumb{width:34px; height:34px;} }
        .nav-search-modal-more{display:block; margin-top:6px; padding:10px 12px; font-size:12.5px; font-weight:600; color:var(--brass); text-align:center;}
        .nav-search-modal-empty{padding:14px 12px; font-size:12.5px; color:var(--ink-soft); text-align:center;}
        /* 2026-09-19: görsel arama kaldırıldı (ücretli AI) — .nav-search-modal-image-* ve .nav-vs-*
           kuralları silindi. */
        @media (max-width:640px){
          .nav-search-modal-overlay{padding:60px 12px 12px;}
          /* X, arama çubuğuyla AYNI yatay bantta duruyordu (ölçüldü: kapat 76-110 px, çubuk
             82-129 px) ve çubuk ona yer açmak için margin-right:36px ile kısaltılıyordu —
             mobilde zaten dar olan alanın 36 px'i gidiyordu (kullanıcı isteği, 2026-09-14:
             "X butonu arama çubuğunun üzerine geliyor ve çubuğu daraltıyor"). Artık X kutunun
             üst şeridine çekilir (8-42 px) ve modalın üst iç boşluğu 48 px'e çıkarak ona yer
             açar; çubuk margin'i sıfırlanıp kenardan kenara uzar. Masaüstünde düzen aynı kalır:
             orada 720 px genişlikte 36 px'lik pay sorun değil. */
          .nav-search-modal{padding:48px 22px 22px;}
          .nav-search-modal-close{top:8px; right:12px;}
          .nav-search-modal-input-row{margin-right:0;}
          /* Önerilen aramalar mobilde TEK SATIR + yatay kaydırma (kullanıcı isteği, 2026-09-14).
             Beş chip sarmalandığında ("Ofis / İş Merkezi", "Turizm / Otel"... uzun etiketler) üç
             satıra kadar çıkıp popup'ın yarısını yiyordu. Negatif margin + eşit padding, satırın
             modalın 22 px'lik iç boşluğunu AŞIP ekran kenarına kadar uzanmasını sağlar: son chip
             kenarda yarım görünür, yani "sağa kaydırılabilir" olduğu okumadan anlaşılır.
             scroll-padding aynı değerde, klavye/odak ile gelen chip kenara yapışmasın diye. */
          .nav-search-modal-chips{
            flex-wrap:nowrap; overflow-x:auto; overscroll-behavior-x:contain;
            -webkit-overflow-scrolling:touch; scrollbar-width:none;
            margin-inline:-22px; padding-inline:22px; scroll-padding-inline:22px;
          }
          .nav-search-modal-chips::-webkit-scrollbar{display:none;}
          .nav-search-modal-chip{flex:0 0 auto; white-space:nowrap;}
          /* Buradaki eski font-size:13px KALDIRILDI (2026-09-14). Amacı "Aradığını yaz, bulmana
             yardımcı olalım" placeholder'ının mobilde kırpılmamasıydı (kullanıcı isteği,
             2026-08-30) ama 16 px altındaki her alan iOS'ta odaklanınca ekranı yakınlaştırıyor
             (bkz. ml-no-zoom-style) — yani bu kural tam da kullanıcının şikayet ettiği davranışın
             kaynağıydı ve zaten o kuralca eziliyor. Placeholder artık PUNTOYU değil METNİ kısaltarak
             sığdırılıyor (bkz. syncSearchPlaceholder). */
        }
      `;
      document.head.appendChild(style);
    }

    const overlay = document.createElement('div');
    overlay.className = 'nav-search-modal-overlay';
    overlay.innerHTML = `
      <div class="nav-search-modal" role="dialog" aria-modal="true" aria-label="Ara">
        <button type="button" class="nav-search-modal-close" aria-label="Kapat"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        <div class="nav-search-modal-input-row">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="nav-search-modal-input" placeholder="Aradığını yaz, bulmana yardımcı olalım" aria-label="Ara">
        </div>
        <div class="nav-search-modal-section" id="nav-search-modal-body"></div>
        <!-- 2026-09-19: görsel arama kaldırıldı (ücretli AI) — "Görsel ile Proje ve Ürün Arama"
             bölümü (görsel bırakma kutusu, URL yapıştırma, durum/sonuç alanları) silindi. -->
      </div>`;
    document.body.appendChild(overlay);

    const modalInput = overlay.querySelector('#nav-search-modal-input');
    const body = overlay.querySelector('#nav-search-modal-body');

    // Placeholder DAR EKRANDA kısalır (kullanıcı isteği, 2026-08-30: mobilde kırpılmasın).
    // Eskiden punto 13 px'e düşürülerek sığdırılıyordu; o çözüm iOS'un odakta yakınlaştırma
    // davranışını tetiklediği için bırakıldı (bkz. ml-no-zoom-style). ÖLÇÜLDÜ (Inter, 16 px):
    // tam metin 278 px, 390 px'lik bir ekranda çubuğun metne ayırdığı alan 254 px — sığmıyor;
    // kısa metin 212 px, rahatça sığıyor. Eşik modalın kendi mobil kırılımıyla (640px) AYNI
    // tutuldu, ayrı bir sihirli sayı üretilmesin.
    const SEARCH_PLACEHOLDER_FULL = 'Aradığını yaz, bulmana yardımcı olalım';
    const SEARCH_PLACEHOLDER_SHORT = 'Aradığını yaz, yardımcı olalım';
    const narrowMq = window.matchMedia('(max-width:640px)');
    function syncSearchPlaceholder(){
      modalInput.placeholder = narrowMq.matches ? SEARCH_PLACEHOLDER_SHORT : SEARCH_PLACEHOLDER_FULL;
    }
    syncSearchPlaceholder();
    // Ekran döndürüldüğünde/pencere yeniden boyutlandığında da doğru kalsın.
    if (narrowMq.addEventListener) narrowMq.addEventListener('change', syncSearchPlaceholder);
    else if (narrowMq.addListener) narrowMq.addListener(syncSearchPlaceholder);
    let debounceTimer = null;
    let currentQuery = '';

    // 2026-09-19: görsel arama kaldırıldı (ücretli AI) — görsel seçme/sürükle-bırak/URL yapıştırma,
    // /api/ai/visual-search + /api/ai/image-proxy çağrıları, image-clip-embed.js (CLIP) tembel
    // yüklemesi/ısıtması ve sonuç çizimi (vsRender) tamamen silindi.

    function renderRecommended(){
      body.innerHTML = `
        <div class="nav-search-modal-section-title">Önerilen Aramalar</div>
        <div class="nav-search-modal-chips">${NAV_SEARCH_RECOMMENDED.map(term =>
          `<button type="button" class="nav-search-modal-chip" data-term="${escapeAttr(term)}">${escapeHtml(term)}</button>`
        ).join('')}</div>`;
      body.querySelectorAll('.nav-search-modal-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          window.location.href = '/arama?q=' + encodeURIComponent(btn.dataset.term);
        });
      });
    }

    function renderResults(query, data){
      const items = (data && data.items) || [];
      if(!items.length){
        body.innerHTML = `<div class="nav-search-modal-empty">"${escapeHtml(query)}" için öneri bulunamadı.</div>`;
        return;
      }
      // Önizleme görseli satırın EN SAĞINDA (kullanıcı isteği, 2026-09-02). Görseli olmayan
      // kayıtlarda baş harfli renkli bir kutu gösterilir ki satır yükseklikleri oynamasın.
      // cdnImg 96 px'lik türevi ister (DPR 2'de 40 px'lik kutuya fazlasıyla yeter, bkz.
      // image-cdn.js merdiveni — 400 px en küçük basamaktır ve türev yoksa orijinale düşer).
      const rows = items.map(it => {
        const img = it.image
          ? `<img class="nav-search-modal-row-thumb" src="${escapeAttr(typeof cdnImg === 'function' ? cdnImg(it.image, 96) : it.image)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`
          : `<span class="nav-search-modal-row-thumb nav-search-modal-row-thumb-ph">${escapeHtml((it.title || '?').trim().charAt(0).toLocaleUpperCase('tr'))}</span>`;
        return `<a class="nav-search-modal-row" href="${escapeAttr(it.href)}">
          <span class="nav-search-modal-row-tag">${escapeHtml(it.label)}</span>
          <span class="nav-search-modal-row-title">${escapeHtml(it.title)}</span>
          <span class="nav-search-modal-row-meta">${escapeHtml(it.meta || '')}</span>
          ${img}
        </a>`;
      }).join('');
      const moreHref = '/arama?q=' + encodeURIComponent(query);
      // total artık GERÇEK eşleşme sayısı (eskiden grup başına 20'de kırpılıyordu: "cami" için
      // pencere 21 derken sayfa 70 buluyordu). Sunucu aday sınırına takıldıysa (capped) sayı bir
      // alt sınırdır ve "+" ile gösterilir — uydurma bir kesinlik verilmez.
      const totalLabel = data.capped ? `${data.total}+` : String(data.total);
      body.innerHTML = `<div class="nav-search-modal-results">${rows}</div>
        <a class="nav-search-modal-more" href="${escapeAttr(moreHref)}">"${escapeHtml(query)}" için tüm sonuçları gör (${totalLabel})</a>`;
    }

    modalInput.addEventListener('input', () => {
      const query = modalInput.value.trim();
      clearTimeout(debounceTimer);
      if(query.length < 2){ renderRecommended(); return; }
      debounceTimer = setTimeout(() => {
        currentQuery = query;
        fetch('/api/public/search-suggest?q=' + encodeURIComponent(query))
          .then(res => res.ok ? res.json() : { items: [], total: 0 })
          .then(data => { if(modalInput.value.trim() === currentQuery) renderResults(currentQuery, data); })
          .catch(() => {});
      }, 200);
    });
    modalInput.addEventListener('keydown', (e) => {
      if(e.key === 'Enter' && modalInput.value.trim()){
        window.location.href = '/arama?q=' + encodeURIComponent(modalInput.value.trim());
      } else if(e.key === 'Escape'){
        close();
      }
    });

    function close(){
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    }
    overlay.querySelector('.nav-search-modal-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if(e.target === overlay) close(); });

    navSearchModalApi = {
      open(prefill){
        modalInput.value = prefill || '';
        if(modalInput.value.trim().length >= 2) modalInput.dispatchEvent(new Event('input'));
        else renderRecommended();
        loadRecommendedTerms(() => { if(!modalInput.value.trim()) renderRecommended(); });
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
        setTimeout(() => modalInput.focus(), 0);
      },
    };
    return navSearchModalApi;
  }

  function wireNavSearch(){
    document.querySelectorAll('.nav-search, .nav-mobile-search').forEach(wrap=>{
      const inp = wrap.querySelector('input');
      if(!inp || inp.dataset.navSuggestWired) return;
      inp.dataset.navSuggestWired = '1';
      // Kutunun kendisi artık yalnızca bir TETİKLEYİCİ — gerçek yazma popup'ın kendi büyük
      // kutusunda olur (bkz. ensureNavSearchModal), bu yüzden odaklanır odaklanmaz hemen bulanır
      // (klavye/mobil ekran klavyesi kısa bir an bile bu küçük kutuda açılmaz).
      inp.addEventListener('focus', () => {
        inp.blur();
        ensureNavSearchModal().open(inp.value.trim());
      });
      // Önerilen aramaları popup AÇILMADAN ÖNCE, kutuya ilk yaklaşıldığında getir (kullanıcı
      // isteği, 2026-09-06: eski tasarım hiç görünmesin). Böylece open() çalıştığında değerler
      // çoğunlukla hazırdır ve tek bir doğru boyama olur; loadRecommendedTerms zaten kendi
      // recommendedTermsLoaded bayrağıyla tekilleştiriyor, bu yüzden fazladan istek doğmaz.
      const warm = () => loadRecommendedTerms();
      inp.addEventListener('pointerenter', warm, { once: true });
      inp.addEventListener('pointerdown', warm, { once: true });
    });
  }
  window.wireNavSearch = wireNavSearch;

  // kullanıcı isteği (2026-08-28, ekli Architonic ekran görüntüleri referans alınarak): mobil/
  // tablette hamburger artık üst menüde açılan küçük bir dropdown DEĞİL, sağdan kayarak giren tam
  // yükseklikte bir çekmece (drawer) — koyu bir overlay arkasını kaplar, kapatma X düğmesi ve alt
  // kısımda Giriş Yap düğmesi içerir (bkz. yukarıdaki headerHtml() içindeki YENİ drawer markup'ı).
  //
  // NavDrawer (2026-08-28 kullanıcı isteği): Hesabım/Aktivitelerim/İçeriklerim/Giriş Yap/Üye Ol/
  // Rozet Al/İade Et artık tıklanınca AYRI bir ModalShell popup'ı DEĞİL, AYNI bu çekmecenin içinde
  // kayan bir "alt sayfa" açar — js/components/auth-modal.js ve js/components/info-modal.js (Rozet
  // Al/İade Et için, diğer InfoModal görünümleri hariç) mobil genişlikte kendi ModalShell.open()
  // çağrısı yerine bu API'yi kullanır. Çekmecenin KENDİSİ (DOM/animasyon/Escape/overlay/X) burada,
  // TEK sahipte kalır; auth/info modal dosyaları yalnızca içerik mount edip geri/kapama isteklerini
  // (onBack/onRequestFullClose) buraya devreder — üçü de aynı history push/pop mantığını (bkz. o
  // dosyalardaki open/swap/close) korur, yalnızca GÖRSEL barındırıcı (ModalShell vs. bu çekmece)
  // değişir. window.NavDrawer olarak dışa açılır çünkü auth-modal.js/info-modal.js lazy-modals.js
  // tarafından SONRADAN <script> enjeksiyonuyla yüklenir (bkz. o dosya) — bu modül ise site-chrome.js
  // ile HER sayfada senkron/en erken yüklendiğinden global'e güvenle erişilebilir.
  //
  // gerçek bulgu: bu fonksiyon henüz ÇAĞRILMADAN (aşağıda headerMount.outerHTML ile markup DOM'a
  // yazılıp nav-mobile-menu document.body'ye taşınmadan) çalıştırılırsa document.getElementById
  // aramalarının HEPSİ null döner — bu yüzden eskiden burada yaşayan wireHamburger() gibi bu da
  // yalnızca bir FONKSİYON TANIMI, gerçek çağrı dosya sonunda (mount'tan SONRA) yapılır.
  function initNavDrawer(){
    const navHamburger = document.getElementById('nav-hamburger');
    const navMobileMenu = document.getElementById('nav-mobile-menu');
    const navMobileOverlay = document.getElementById('nav-mobile-overlay');
    const navMobileClose = document.getElementById('nav-mobile-menu-close');
    const navMobileBreadcrumb = document.getElementById('nav-mobile-breadcrumb');
    const navMobileSubpageBody = document.getElementById('nav-mobile-subpage-body');
    // Alt sayfanın başlık satırına (breadcrumb ile X arasına) buton yazabildiği yuva — bkz.
    // getHeadCenterEl/CSS'teki .nav-mobile-menu-head-center. İçeriği tıpkı alt sayfa gövdesi gibi
    // her kapanışta/geri dönüşte temizlenir (aksi halde ana menüde geçiş butonları asılı kalırdı).
    const navMobileHeadCenter = document.getElementById('nav-mobile-menu-head-center');
    let subpageActive = false;
    let subpageCloseHandler = null; // X/overlay/Escape ile "tam kapat" isteğinde çağrılır (bkz. showSubpage)
    let subpageBackHandler = null; // breadcrumb "Menü" tıklamasında çağrılır (bkz. showSubpage)

    function openDrawer(){
      if(!navMobileMenu) return;
      // bkz. js/overlay-manager.js — çekmece artık otomatik grupta DEĞİL, register()'lı bir panel;
      // açılışını kendisi bildirir (altta açık kalmış bir modal/avatar menüsü/Paylaş popover'ı
      // kapansın diye). Eskiden bunu `.open` sınıfını izleyen MutationObserver yapıyordu.
      //
      // KAYIT NEDEN BURADA (ilk açılışta), initNavDrawer'ın gövdesinde DEĞİL: overlay-manager.js
      // her sayfada `defer` ile yüklenirken bu dosya <body> içinde SENKRON çalışıyor — yani
      // initNavDrawer çağrıldığı anda `OverlayManager` HENÜZ TANIMLI DEĞİL ve oradaki bir kayıt
      // sessizce atlanırdı (register'lar `typeof ... undefined` ile korunuyor). İlk openDrawer()
      // ise her zaman kullanıcı etkileşiminden sonra, defer'lı betikler çalıştıktan SONRA olur.
      // Map.set idempotenttir, tekrar tekrar çağrılması zararsızdır.
      // closeDrawer (requestClose DEĞİL): başka bir panel devraldığında history'e dokunulmadan
      // yalnızca görsel/durum temizliği yapılmalı; history'i o an üstteki popup yönetir. rootEl
      // olarak çekmece verilir ki İÇİNDE açılan arama öneri paneli ya da Paylaş popover'ı altındaki
      // çekmeceyi kapatmasın (otomatik gruptaki AYNI koruma).
      if(typeof OverlayManager !== 'undefined'){
        OverlayManager.register('nav-drawer', closeDrawer, navMobileMenu);
        OverlayManager.notifyOpen('nav-drawer');
      }
      navMobileMenu.classList.add('open');
      if(navMobileOverlay) navMobileOverlay.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
    // Çekmeceyi HER durumda (ana menü ya da alt sayfa göstersin) tamamen kapatır — auth-modal.js/
    // info-modal.js kendi close()'ları İÇİNDE (history geri sarma sonrası) bunu çağırır; doğrudan X/
    // overlay/Escape'ten değil (bkz. requestClose aşağıda — önce alt sayfa sahibine haber verir).
    function closeDrawer(){
      if(!navMobileMenu) return;
      navMobileMenu.classList.remove('open', 'subpage-active');
      if(navMobileOverlay) navMobileOverlay.classList.remove('open');
      document.body.style.overflow = '';
      subpageActive = false;
      subpageCloseHandler = null;
      subpageBackHandler = null;
      // gerçek bulgu: alt sayfa içeriği (ör. #am-panel/#im-panel) burada TEMİZLENMEZSE, aynı görünüm
      // hemen ardından masaüstü genişliğinde ModalShell İÇİNDE AYNI id ile yeniden render edildiğinde
      // (ör. resize ya da ardışık farklı bir bağlantı tıklaması) belgede İKİ tane aynı id'li eleman
      // kalır — querySelector/getElementById bu ÇEKMECEDEKİ ESKİ (görünmez ama hâlâ DOM'da duran)
      // kopyayı bulup yeni ModalShell popup'ının GÖRÜNMEYEN bir hayalet içerikle karışmasına yol açar.
      if(navMobileSubpageBody) navMobileSubpageBody.innerHTML = '';
      if(navMobileHeadCenter) navMobileHeadCenter.innerHTML = '';
      // ÇEKMECE KAPANDI BİLDİRİMİ (kullanıcı bildirimi, 2026-09-12 madde 3). closeDrawer() yalnızca
      // alt sayfa SAHİBİNİN kendi close()'undan değil, OverlayManager'dan da çağrılabilir (üstüne bir
      // varlık popup'ı açıldığında) — o durumda auth-modal.js/info-modal.js'in `currentView`'i
      // ekranda hiçbir şey yokken "açık" kalıyor ve geri dönüşte (popstate) kendilerini yeniden
      // açmıyorlardı. İki modül de bu olayı dinleyip durumlarını bırakır; history'e DOKUNULMAZ
      // (o an zinciri yöneten taraf üstteki popup'tır).
      document.dispatchEvent(new CustomEvent('mimarlab-navdrawer-closed'));
    }
    // Yalnızca alt sayfayı gizleyip ana menüye döner — çekmece AÇIK kalır (bkz. kullanıcı isteği:
    // "breadcrumb/back ile hamburger ana menüsüne dönülsün", çekmecenin kendisi kapanmaz).
    function hideSubpage(){
      if(!navMobileMenu) return;
      navMobileMenu.classList.remove('subpage-active');
      subpageActive = false;
      subpageCloseHandler = null;
      subpageBackHandler = null;
      // bkz. closeDrawer()'daki AYNI gerçek bulgu/gerekçe — ana menüye dönüldüğünde de eski alt sayfa
      // içeriği (id çakışması ihtimaline karşı) hemen temizlenir.
      if(navMobileSubpageBody) navMobileSubpageBody.innerHTML = '';
      if(navMobileHeadCenter) navMobileHeadCenter.innerHTML = '';
    }
    // opts.onBack: breadcrumb "Menü" tıklanınca. opts.onRequestFullClose: X/overlay/Escape ile
    // TAMAMEN kapatma isteğinde. İkisi de auth-modal.js/info-modal.js'in KENDİ close()/backToMenu()
    // fonksiyonlarıdır — bu modül URL/history hiçbir şey bilmez, yalnızca görsel host'tur.
    function showSubpage(opts){
      if(!navMobileMenu) return;
      opts = opts || {};
      openDrawer();
      subpageActive = true;
      subpageCloseHandler = opts.onRequestFullClose || null;
      subpageBackHandler = opts.onBack || null;
      navMobileMenu.classList.add('subpage-active');
      if(navMobileBreadcrumb) navMobileBreadcrumb.focus();
    }
    function getSubpageBodyEl(){ return navMobileSubpageBody; }
    function getHeadCenterEl(){ return navMobileHeadCenter; }
    function isSubpageActive(){ return subpageActive; }
    function isDrawerOpen(){ return !!(navMobileMenu && navMobileMenu.classList.contains('open')); }

    // X / dış tıklama / Escape — alt sayfa açıksa GERÇEK kapatma işini (history geri sarma dahil)
    // onu mount eden modüle devreder (o da işini bitirince closeDrawer()'ı KENDİSİ çağırır); alt
    // sayfa yoksa (yalnızca ana menü açık) doğrudan kapatılır.
    function requestClose(){
      if(subpageActive && subpageCloseHandler){ subpageCloseHandler(); return; }
      closeDrawer();
    }

    if(navMobileBreadcrumb) navMobileBreadcrumb.addEventListener('click', ()=>{ if(subpageBackHandler) subpageBackHandler(); });
    if(navHamburger && navMobileMenu){
      navHamburger.addEventListener('click', ()=>{
        if(navMobileMenu.classList.contains('open')) requestClose(); else openDrawer();
      });
    }
    if(navMobileClose) navMobileClose.addEventListener('click', requestClose);
    if(navMobileOverlay) navMobileOverlay.addEventListener('click', requestClose);
    // gerçek bulgu (denetim, 2026-08-24): mega-menü (nav-product-menu.js), arama önerileri paneli
    // (wireNavSearch aşağıda) ve her modal Escape ile kapanırken, sitedeki hemen her sayfada yer alan
    // bu mobil hamburger menüsü yalnızca dışarı tıklama/tekrar tıklama ile kapanıyordu — klavye
    // kullanıcıları (ve Escape'in her yerde çalışmasına alışmış herkes) için tutarsız bir boşluktu.
    document.addEventListener('keydown', (e)=>{
      if(e.key === 'Escape' && navMobileMenu && navMobileMenu.classList.contains('open')) requestClose();
    });

    return { openDrawer, closeDrawer, hideSubpage, showSubpage, getSubpageBodyEl, getHeadCenterEl, isSubpageActive, isDrawerOpen };
  }

  const headerMount = document.getElementById('site-header-mount');
  if(headerMount){
    const active = headerMount.getAttribute('data-nav-active') || '';
    headerMount.outerHTML = headerHtml(active);
  }
  // gerçek bulgu (2026-08-28): .nav'da backdrop-filter var — CSS'e göre backdrop-filter/filter
  // taşıyan bir atanın İÇİNDEKİ position:fixed torunları artık viewport'a göre değil O ATA'ya göre
  // konumlanır (yeni bir containing block oluşturuyor). Çekmece/overlay <nav> İÇİNDE doğduğundan
  // (bkz. headerHtml()) "fixed" tam ekran yerine yalnızca nav çubuğunun 66px'lik kutusuna
  // hapsoluyordu. Arama modal'ının zaten document.body'ye eklenmesiyle AYNI çözüm: ikisini de
  // mount'tan hemen sonra body'nin doğrudan çocuğu yapıyoruz.
  const navMobileMenuEl = document.getElementById('nav-mobile-menu');
  const navMobileOverlayEl = document.getElementById('nav-mobile-overlay');
  if(navMobileMenuEl) document.body.appendChild(navMobileMenuEl);
  if(navMobileOverlayEl) document.body.appendChild(navMobileOverlayEl);
  injectHeaderStyle();
  window.NavDrawer = initNavDrawer();
  wireNavSearch();

  // 2026-09-19: görsel arama kaldırıldı (ücretli AI) — geri dönüşte sonuçları yeniden açan
  // tryRestoreVisualSearch (sessionStorage) ve nav'daki kamera düğmesinin dinleyicisi silindi.

  // "İçerik Ekle" (kullanıcı isteği, 2026-08-31): footer'ın Topluluk sütunundaki son satır, ekleme
  // sayfalarına (proje/mimar/firma/ürün) götüren bağlantıları taşıyan küçük bir popup açar.
  // Bağlantılar sıradan <a href> — tıklanınca tarayıcı normal şekilde o sayfaya gider, ayrı bir
  // yönlendirme koduna gerek yok.
  // "Marka Ekle" BİLEREK YOK (kullanıcı isteği, 2026-09-14 madde 1) — nav/footer'daki Marka
  // bağlantılarıyla birlikte kaldırıldı. /marka-ekle sayfasının KENDİSİ duruyor: mevcut bir markayı
  // düzenleme akışı (bkz. auth-modal.js#claimEditPageForOffice) oraya gitmeye devam eder.
  const ADD_CONTENT_LINKS = [
    { href: '/proje-ekle', label: 'Proje Ekle' },
    { href: '/kisi-ekle', label: 'Kişi Ekle' },
    { href: '/firma-ekle', label: 'Firma Ekle' },
    { href: '/urun-ekle', label: 'Ürün Ekle' },
    // Gündem kullanıcı gönderisi (kullanıcı isteği, 2026-09-11) — haber/etkinlik/yarışma.
    { href: '/gundem-ekle', label: 'Gündem İçeriği Ekle' },
  ];
  const ADD_CONTENT_ARROW = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>';

  function wireAddContent(){
    const trigger = document.getElementById('footer-add-content');
    if(!trigger || document.getElementById('add-content-overlay')) return;
    const overlay = document.createElement('div');
    overlay.className = 'add-content-overlay';
    overlay.id = 'add-content-overlay';
    overlay.innerHTML = `
      <div class="add-content-panel" role="dialog" aria-modal="true" aria-label="Sen de Ekle">
        <button type="button" class="add-content-close" aria-label="Kapat">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <h2>Sen de Ekle</h2>
        <p>Platforma eklemek istediğin içerik türünü seç.</p>
        <div class="add-content-list">
          ${ADD_CONTENT_LINKS.map(l => `<a href="${escapeAttr(l.href)}">${escapeHtml(l.label)}${ADD_CONTENT_ARROW}</a>`).join('')}
        </div>
      </div>`;
    document.body.appendChild(overlay);

    function close(){ overlay.classList.remove('open'); }
    function open(){
      // Altta açık kalmış hamburger/arama/popup panelleri kapansın (bkz. js/overlay-manager.js) —
      // footer görünür olduğu için pratikte nadiren gerekir, ama tutarlılık için diğer overlay'lerle
      // AYNI protokol izlenir.
      if(typeof OverlayManager !== 'undefined') OverlayManager.notifyOpen('add-content');
      overlay.classList.add('open');
    }
    trigger.addEventListener('click', open);
    overlay.querySelector('.add-content-close').addEventListener('click', close);
    overlay.addEventListener('click', (e)=>{ if(e.target === overlay) close(); });
    document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape' && overlay.classList.contains('open')) close(); });
    if(typeof OverlayManager !== 'undefined') OverlayManager.register('add-content', close);
  }


  // ===========================================================================================
  // ÇEREZ ONAY BANDI + ANALİTİĞİN ONAYA BAĞLANMASI
  // (kullanıcı isteği, 2026-09-13 denetim listesi: "Cookie banner")
  // ===========================================================================================
  // ÖNCEKİ DURUM — ASIL SORUN BANNER'IN YOKLUĞU DEĞİLDİ: Google Analytics (gtag) 30 sayfanın her
  // birinde <head> içinde KOŞULSUZ yükleniyordu. Yani ziyaretçi daha hiçbir şey seçmeden üçüncü
  // taraf analitik çerezleri yazılıyordu. Sadece bir bant eklemek bunu düzeltmezdi; bant "kabul
  // et"e basılana kadar analitiğin HİÇ YÜKLENMEMESİ gerekiyordu. Bu yüzden gtag parçacığı 30
  // sayfadan KALDIRILDI ve yükleme buraya, tek yere alındı.
  //
  // NEDEN BURADA (ayrı bir dosya + 32 <script> etiketi yerine): site-chrome.js sitedeki 32 HTML
  // sayfasının HEPSİNDE zaten yüklü. Yeni bir dosyayı 32 sayfaya tek tek eklemek bu depodaki
  // bilinen tuzak: biri unutulur ve o sayfada bant hiç çıkmaz (bkz. .footer-brand p kuralının 32
  // kopyası). Bant, footer ile AYNI tek kaynaktan basılır.
  //
  // ZORUNLU ÇEREZLER ONAYA TABİ DEĞİL: oturum çerezi (__Host-mimarlab_session) ve tema tercihi
  // hizmetin çalışması için gerekli; KVKK m.5/2 ve GDPR m.6/1-f kapsamında açık rıza aranmaz.
  // Onaya bağlanan tek şey ANALİTİKTİR (Google Analytics). Bu ayrım bilerek yapıldı: oturumu da
  // onaya bağlamak, "reddet" diyen kullanıcının siteye giriş yapamaması demek olurdu.
  //
  // "REDDET" GERÇEKTEN REDDEDER: kabul edilmediği sürece googletagmanager.com'a HİÇBİR istek
  // gitmez (script etiketi hiç oluşturulmaz). Google'ın "consent mode" deseni tercih edilmedi;
  // o desende script yine yüklenir ve çerezsiz de olsa ping gönderir.
  var CONSENT_KEY = 'mimarlab-cookie-consent';
  var GA_ID = 'G-L4902Z57B8';
  var gaLoaded = false;

  function readConsent(){
    try {
      var raw = localStorage.getItem(CONSENT_KEY);
      if(!raw) return null;
      var parsed = JSON.parse(raw);
      if(!parsed || typeof parsed !== 'object') return null;
      return { analytics: parsed.analytics === true, ts: parsed.ts || 0 };
    } catch(e){ return null; }   // gizli mod / engellenmiş depolama: karar YOK sayılır
  }

  function writeConsent(analytics){
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ v: 1, analytics: !!analytics, ts: Date.now() })); } catch(e){}
    if(analytics) loadAnalytics();
    try { document.dispatchEvent(new CustomEvent('mimarlab:consent-change', { detail: { analytics: !!analytics } })); } catch(e){}
  }

  // Analitiği YALNIZCA onay varsa yükler. İki kez çağrılsa bile tek kez yükler (gaLoaded).
  function loadAnalytics(){
    if(gaLoaded || !GA_ID) return;
    gaLoaded = true;
    window.dataLayer = window.dataLayer || [];
    // gtag GLOBAL olmalı: neden-mimarlab.html gibi sayfalar `typeof gtag === 'function'` kontrolüyle
    // olay gönderiyor (onay yoksa o kontrol false kalır ve olay sessizce atlanır — doğru davranış).
    window.gtag = function(){ window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
    document.head.appendChild(s);
  }

  function injectConsentStyle(){
    if(document.getElementById('cookie-consent-style')) return;
    var st = document.createElement('style');
    st.id = 'cookie-consent-style';
    st.textContent = [
      '.cc-bar{position:fixed; left:0; right:0; bottom:0; z-index:2147483000; display:flex; gap:16px;',
      '  align-items:center; justify-content:center; flex-wrap:wrap;',
      '  padding:14px 20px calc(14px + env(safe-area-inset-bottom, 0px));',
      '  background:#1B2A3D; color:#EDF0F3; box-shadow:0 -6px 24px rgba(0,0,0,0.22);}',
      '.cc-text{font-size:13.5px; line-height:1.6; margin:0; max-width:70ch;}',
      '.cc-text a{color:#AFC5D8; text-decoration:underline;}',
      '.cc-actions{display:flex; gap:8px; flex-wrap:wrap;}',
      '.cc-btn{border:none; cursor:pointer; border-radius:100px; padding:9px 20px; font-size:13px;',
      '  font-weight:700; font-family:inherit; white-space:nowrap;}',
      '.cc-accept{background:#EDF0F3; color:#1B2A3D;}',
      '.cc-accept:hover{background:#fff;}',
      '.cc-reject{background:transparent; color:#EDF0F3; border:1px solid rgba(237,240,243,0.45);}',
      '.cc-reject:hover{background:rgba(237,240,243,0.12);}',
      '@media (max-width:640px){',
      '  .cc-bar{flex-direction:column; align-items:stretch; gap:12px; text-align:left;}',
      '  .cc-actions{justify-content:stretch;}',
      '  .cc-btn{flex:1 1 auto;}',
      '}',
      /* "Çerez tercihimi değiştir" kutusu. Kural BURADA (sayfa CSS'inde değil) çünkü kutu iki
         yerde basılıyor ve bunlardan biri POPUP (info-modal.js#cerezTemplate) — popup, Çerez
         Politikası sayfasının değil, o an açık olan SAYFANIN CSS'i altında render edilir; kuralı
         cerez-politikasi.html'de bırakmak, popup kopyasının stilsiz çıkması demekti. */
      '.cookie-pref{margin-top:18px; padding:16px 18px; background:var(--paper-card, #F8FAFB);',
      '  border:1px solid var(--line, rgba(27,42,61,0.14)); border-radius:12px;}',
      '.cookie-pref-state{margin:0 0 12px; font-size:13.5px; color:var(--ink-soft, #4E6478);}',
      '.cookie-pref-btn{border:none; background:var(--ink, #1B2A3D); color:var(--paper, #EDF0F3);',
      '  border-radius:100px; padding:9px 20px; font-size:13px; font-weight:700; cursor:pointer;',
      '  font-family:inherit;}',
      '.cookie-pref-btn:hover{background:var(--walnut, #2B425F);}',
    ].join('\n');
    document.head.appendChild(st);
  }

  function showConsentBar(){
    if(document.querySelector('.cc-bar')) return;
    injectConsentStyle();
    var bar = document.createElement('div');
    bar.className = 'cc-bar';
    // role="region" + aria-label: bant bir DIALOG DEĞİL — odağı hapsetmez ve sayfayı bloke etmez.
    // role="dialog" verilseydi ekran okuyucu kullanıcısı, karar verene kadar sayfada gezinemezdi.
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Çerez tercihi');
    bar.innerHTML =
      '<p class="cc-text">Zorunlu çerezleri kullanıyoruz. İsteğe bağlı <strong>analitik çerezlerle</strong> ' +
      'siteyi nasıl kullandığınızı anlamak istiyoruz. ' +
      '<a href="/cerez-politikasi">Çerez Politikası</a>.</p>' +
      '<div class="cc-actions">' +
        '<button type="button" class="cc-btn cc-reject">Reddet</button>' +
        '<button type="button" class="cc-btn cc-accept">Kabul Et</button>' +
      '</div>';
    document.body.appendChild(bar);
    var decide = function(analytics){ writeConsent(analytics); bar.remove(); };
    bar.querySelector('.cc-accept').addEventListener('click', function(){ decide(true); });
    bar.querySelector('.cc-reject').addEventListener('click', function(){ decide(false); });
  }

  function initConsent(){
    var stored = readConsent();
    if(stored){ if(stored.analytics) loadAnalytics(); return; }
    showConsentBar();
  }

  // -------------------------------------------------------------------------------------------
  // "ÇEREZ TERCİHİMİ DEĞİŞTİR" KUTUSU — İKİ AYRI YERDE BASILIR, MANTIK BURADA TEKTİR
  // -------------------------------------------------------------------------------------------
  // GERÇEK BULGU (bu değişiklik tarayıcıda doğrulanırken yakalandı): /cerez-politikasi adresi
  // kullanıcıya statik cerez-politikasi.html DOSYASINI GÖSTERMİYOR — içerik
  // js/components/info-modal.js#cerezTemplate() içinden POPUP olarak basılıyor; statik dosya
  // yalnızca SEO/JS'siz ziyaretçi kabuğu. Yani kutuyu sadece statik dosyaya koymak, kullanıcıların
  // BÜYÜK ÇOĞUNLUĞUNUN onu hiç görmemesi demekti.
  //
  // Bu yüzden iki kopyada YALNIZCA İŞARETLEME duruyor; durum metnini yazan ve butonu bağlayan kod
  // burada, tek yerde. Bağlama DELEGE dinleyiciyle yapılır (popup içeriği sonradan basılıyor) ve
  // etiket, içerik DOM'a girdiğinde MutationObserver ile boyanır — bu depodaki aynı desen
  // (bkz. js/components/card-carousel.js, preview-cards.js).
  function paintConsentLabels(){
    var nodes = document.querySelectorAll('[data-cookie-pref-state]');
    if(!nodes.length) return;
    var c = readConsent();
    var text = !c
      ? 'Analitik çerezler için henüz bir tercih belirtmediniz.'
      : (c.analytics
          ? 'Analitik çerezlere izin verdiniz.'
          : 'Analitik çerezleri reddettiniz; Google Analytics yüklenmiyor.');
    for(var i = 0; i < nodes.length; i++) nodes[i].textContent = text;
  }

  function wireConsentPrefBox(){
    document.addEventListener('click', function(e){
      var btn = e.target && e.target.closest ? e.target.closest('[data-cookie-pref-btn]') : null;
      if(!btn) return;
      e.preventDefault();
      window.MimarlabConsent.reopen();
    });
    document.addEventListener('mimarlab:consent-change', paintConsentLabels);
    paintConsentLabels();
    if('MutationObserver' in window){
      var pending = false;
      new MutationObserver(function(){
        if(pending) return;
        pending = true;
        setTimeout(function(){ pending = false; paintConsentLabels(); }, 0);
      }).observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  // Çerez Politikası sayfasının (ve ileride Hesabım'ın) tercihi yeniden sorabilmesi için küçük bir
  // genel arayüz. Kararı DEĞİŞTİRMEK, onay bandını yeniden açmakla aynı şeydir.
  window.MimarlabConsent = {
    get: readConsent,
    set: writeConsent,
    reopen: function(){
      try { localStorage.removeItem(CONSENT_KEY); } catch(e){}
      showConsentBar();
    },
  };

  function mountFooter(){
    const footerMount = document.getElementById('site-footer-mount');
    if(footerMount) footerMount.outerHTML = footerHtml();
    injectFooterStyle();
    wireFooterTheme();
    wireAddContent();
    initConsent();
    wireConsentPrefBox();
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', mountFooter);
  } else {
    mountFooter();
  }
})();
