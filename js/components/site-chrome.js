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
  function escapeHtml(s){ const d = document.createElement('div'); d.textContent = s === undefined || s === null ? '' : s; return d.innerHTML; }
  function escapeAttr(s){ return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  // kullanıcı isteği (2026-08-28): Düello ve En İyi 100 üst menüden kaldırıldı — En İyi 100 artık
  // proje.html içinde Liste/Harita'nın yanında üçüncü bir sekme (bkz. proje.html#view-toggle-top100).
  // Düello özelliği ise 2026-08-29'da tamamen kaldırıldı (bkz. kullanıcı isteği: "Takip Et"
  // özelliğine yer açmak için) — footerHtml()'in Topluluk sütunundaki link de bu yüzden gitti.
  // Sıra kullanıcı isteğiyle sabitlendi (2026-08-31): PROJE · KİŞİ · FİRMA · ÜRÜN · MARKA.
  // 'marka' — üretici ürün firmalarının listesi (bkz. marka.html dosya başı yorumu); firma.html'le
  // AYNI `offices` verisini ?brands=1 ile daraltır, ayrı bir tablo/tip DEĞİL.
  const NAV_ITEMS = [
    { key: 'proje', href: '/proje', label: 'Proje' },
    { key: 'mimar', href: '/mimar', label: 'Kişi' },
    { key: 'firma', href: '/firma', label: 'Firma' },
    { key: 'urun', href: '/urun', label: 'Ürün', mega: true },
    { key: 'marka', href: '/marka', label: 'Marka' },
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
         .nav-search'ün yüksekliğini asıl belirleyen, içindeki 26px'lik .nav-search-visual-btn (bkz.
         aşağısı); dikey padding buna göre daraltılır (9px → 4px/5px), yatay padding/border-radius
         her sayfanın KENDİ <style>'ındaki değerlerle DEĞİŞMEDEN kalır. */
      .nav-search{padding-right:6px; padding-top:4px; padding-bottom:4px;}
      @media (max-width:960px){
        .nav-search{padding-top:5px; padding-bottom:5px;}
      }
      .nav-search-visual-btn{
        flex-shrink:0; display:flex; align-items:center; justify-content:center;
        width:26px; height:26px; border-radius:8px; border:none;
        background:var(--paper-alt); color:var(--ink-soft); padding:0;
      }
      .nav-search-visual-btn:hover{background:var(--brass-soft); color:var(--ink);}
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
      .nav-mobile-menu.subpage-active .nav-mobile-menu-subpage{transform:translateX(0);}
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
      <input type="text" id="f-search-topnav" placeholder="İhtiyacını yaz, bulmana yardımcı olalım..." aria-label="Ara">
      <button type="button" class="nav-search-visual-btn" id="nav-search-visual-btn" aria-label="Görsel ile ara">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3.2"/></svg>
      </button>
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
    <div class="footer-subscribe">
      <div class="footer-subscribe-inner">
        <h4 class="footer-subscribe-join-title">MİMARLAB'da yok musun?</h4>
        <h4 class="footer-subscribe-news-title">Bültene Abone Ol</h4>
        <p class="footer-subscribe-join-desc">Kişi veya firma bilgilerini hemen doldur.</p>
        <p class="footer-newsletter-desc">Yeni proje, ürün, mimar ve firmalar e-postana gelsin.</p>
        <div class="footer-subscribe-join-action">
          <a class="footer-subscribe-btn" href="/uye-ol">Üye Ol</a>
        </div>
        <div class="footer-subscribe-news-action">
          <form class="footer-newsletter-form" id="footer-newsletter-form">
            <input type="email" class="footer-newsletter-input" id="footer-newsletter-email" placeholder="E-posta adresin" required aria-label="E-posta adresin">
            <button type="submit" class="footer-subscribe-btn footer-newsletter-btn" aria-label="Abone Ol">
              <span class="footer-newsletter-btn-text">Abone Ol</span>
              <svg class="footer-newsletter-btn-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="12" x2="20" y2="12"/><polyline points="13 5 20 12 13 19"/></svg>
            </button>
          </form>
          <div class="footer-newsletter-msg" id="footer-newsletter-msg" role="status" aria-live="polite"></div>
        </div>
      </div>
    </div>
    <div class="footer-top">
      <div class="footer-brand">
        <a class="footer-logo" href="/">
          <img class="footer-logo-img" src="logos/site/mimarlab-logo-footer.png" alt="MimarLab" loading="lazy" decoding="async">
        </a>
        <p>Mimarlık, iç mimarlık, peyzaj mimarlığı disiplinlerini ve çeşitli firmaları bir araya getiren mimar platformu.</p>
      </div>
      <div class="footer-col"><h4>Ana Menü</h4><a href="/proje">Proje</a><a href="/mimar">Mimar</a><a href="/firma">Firma</a><a href="/urun">Ürün</a><a href="/marka">Marka</a></div>
      <div class="footer-col"><h4>Topluluk</h4><a href="/giris">Giriş Yap</a><a href="/uye-ol">Üye Ol</a><a href="/rozet-al">Rozet Al</a><a href="/iade-et">İade Et</a><button type="button" class="footer-add-content" id="footer-add-content">İçerik Ekle</button></div>
      <div class="footer-col"><h4>Kurumsal</h4><a href="/neden-mimarlab">Neden MİMARLAB?</a><a href="/hakkinda">Hakkında</a><a href="/iletisim">İletişim</a><a href="/gizlilik-politikasi">Gizlilik Politikası</a><a href="/hizmet-sartlari">Hizmet Şartları</a><a href="/cerez-politikasi">Çerez Politikası</a></div>
    </div>
    <div class="footer-bottom">
      <div class="footer-social">
        <a href="https://www.instagram.com/mimarlabcom/" target="_blank" rel="noopener" aria-label="Instagram"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/></svg></a>
        <a href="https://x.com/mimarlabcom?s=11&amp;t=ijRg66Se2p_FxlB3-aK-6w" target="_blank" rel="noopener" aria-label="X"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.3 2H21l-7.3 8.3L22.2 22h-6.8l-5.3-6.9L4 22H1.3l7.8-8.9L1.5 2h6.9l4.8 6.3L18.3 2z"/></svg></a>
        <a href="https://www.linkedin.com/company/mimarlab/" target="_blank" rel="noopener" aria-label="LinkedIn"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M4.5 3.5A2 2 0 1 0 4.5 7.5 2 2 0 0 0 4.5 3.5zM3 9h3v12H3zM10 9h2.9v1.6h.1c.4-.8 1.5-1.6 3-1.6 3.2 0 3.8 2.1 3.8 4.9V21h-3v-6.6c0-1.6 0-3.6-2.2-3.6s-2.5 1.7-2.5 3.5V21H10z"/></svg></a>
      </div>
      <span class="footer-copyright">© Tüm hakları saklıdır. MİMARLAB, 2026<br>Sitede yer alan tüm görseller ilgili kişi veya firmaya aittir.</span>
      <button type="button" class="footer-theme-toggle" id="footer-theme-toggle" aria-pressed="false" aria-label="Gece modunu değiştir">
        <span class="theme-toggle-icon theme-icon-sun" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8L6 18M18 6l1.8-1.8"/></svg></span>
        <span class="theme-toggle-icon theme-icon-moon" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 14.5a8.5 8.5 0 1 1-9-11 7 7 0 0 0 9 11z"/></svg></span>
        <span class="theme-toggle-knob" aria-hidden="true"></span>
      </button>
    </div>
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
      .footer-subscribe{background:#4E6478; border-bottom:1px solid rgba(237,240,243,0.12);}
      /* kullanıcı isteği: iki sütundaki başlık/açıklama/buton satırları TÜM görünümlerde aynı hizada
         ve aynı büyüklükte olmalı — bu yüzden iki .footer-subscribe-join/.footer-subscribe-news
         SARMALAYICISI yerine 6 öğe DOĞRUDAN grid'in çocuğu (satır-öncelikli otomatik yerleşim: h4/h4
         → satır1, p/p → satır2, action/action → satır3), her satırın yüksekliği iki sütundaki en uzun
         içeriğe göre PAYLAŞILA belirlenir (bağımsız iki flex sütunda metin uzunluğu farkı satırları
         kaydırırdı). kullanıcı isteği (sonraki tur): ortadaki dikey ayırıcı çizgi kaldırıldı — sütunlar
         artık yalnızca column-gap ile ayrılıyor, footer-top'un (Ana Menü/Topluluk/Kurumsal) AYNI
         deseni kullandığı gibi. */
      .footer-subscribe-inner{max-width:1080px; margin:0 auto; padding:34px 32px; display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); column-gap:48px; align-items:start;}
      .footer-subscribe-join-title, .footer-subscribe-news-title{font-size:16px; font-weight:700; color:var(--paper); margin:0 0 8px;}
      .footer-subscribe-btn{display:inline-flex; align-items:center; justify-content:center; height:40px; padding:0 26px; background:var(--brass-soft); color:var(--ink); font-weight:700; font-size:13px; border-radius:100px; border:none; cursor:pointer; white-space:nowrap;}
      .footer-subscribe-btn:hover{opacity:0.9;}
      .footer-subscribe-btn:disabled{opacity:0.6; cursor:default;}
      .footer-top{grid-template-columns: 1.3fr 0.9fr 1fr 1.15fr;}
      /* Alt satır: sosyal ikonlar sol kenara, telif hakkı ortaya, gece/gündüz düğmesi sağ kenara
         (bkz. kullanıcı isteği: "sol ve sağ hizayla eşitle") — grid'in dış iki sütunu 1fr olduğundan
         orta sütun (telif metni) sosyal/toggle genişliklerinden bağımsız her zaman TAM ortada kalır. */
      .footer-bottom{display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:16px; max-width:1080px; margin:0 auto; box-sizing:border-box;}
      .footer-bottom .footer-social{justify-self:start;}
      .footer-copyright{justify-self:center; text-align:center;}
      .footer-bottom .footer-theme-toggle{justify-self:end;}
      .footer-social{display:flex; align-items:center; gap:14px; height:28px;}
      .footer-social a{display:flex; align-items:center; justify-content:center;}
      .footer-social svg{display:block;}
      .footer-theme-toggle{
        position:relative; display:inline-flex; align-items:center; flex-shrink:0;
        width:52px; height:28px; padding:0; border-radius:100px; border:none;
        background:var(--brass); color:#fff; cursor:pointer; overflow:hidden;
        transition: background 0.2s ease;
      }
      [data-theme="dark"] .footer-theme-toggle{background:#333B46;}
      .footer-theme-toggle:hover{opacity:0.92;}
      .footer-theme-toggle .theme-toggle-icon{
        position:absolute; top:50%; transform:translateY(-50%);
        width:14px; height:14px; display:flex; align-items:center; justify-content:center; color:#fff;
      }
      .footer-theme-toggle .theme-icon-sun{left:7px;}
      .footer-theme-toggle .theme-icon-moon{right:7px;}
      .footer-theme-toggle .theme-toggle-knob{
        position:absolute; top:3px; left:3px;
        width:22px; height:22px; border-radius:50%; background:#fff;
        transition: left 0.2s ease;
      }
      [data-theme="dark"] .footer-theme-toggle .theme-toggle-knob{left:27px;}
      .footer-subscribe-join-desc, .footer-newsletter-desc{font-size:12.5px; color:rgba(237,240,243,0.6); margin:0 0 16px; max-width:340px;}
      /* kullanıcı isteği (2026-08-30): abone ol gönder butonu artık TÜM görünümlerde (masaüstü/
         tablet/mobil) input'un sağ ucuna gömülü dairesel bir ikon — eskiden yalnızca mobilde
         (≤560px) böyleydi, masaüstünde ayrı metin butonu vardı; artık üç görünüm de aynı deseni
         kullanıyor. */
      .footer-newsletter-form{position:relative; display:block;}
      .footer-newsletter-input{box-sizing:border-box; height:40px; width:100%; background:rgba(237,240,243,0.08); border:1px solid rgba(237,240,243,0.2); border-radius:100px; padding:0 48px 0 16px; font-family:inherit; font-size:13px; color:var(--paper); outline:none;}
      .footer-newsletter-input::placeholder{color:rgba(237,240,243,0.45);}
      .footer-newsletter-input:focus-visible{box-shadow:0 0 0 2px var(--brass-soft) inset;}
      .footer-newsletter-btn-text{display:none;}
      .footer-newsletter-btn-icon{display:block;}
      .footer-newsletter-btn{position:absolute; top:50%; right:3px; transform:translateY(-50%); width:34px; height:34px; padding:0; border-radius:50%;}
      .footer-newsletter-msg{font-size:12px; margin-top:8px; min-height:16px;}
      .footer-newsletter-msg.ok{color:#8FD6A8;}
      .footer-newsletter-msg.err{color:#E39B9B;}
      @media (max-width: 860px){
        .footer-top{grid-template-columns: 1fr 1fr; column-gap:20px; row-gap:28px;}
        .footer-brand{grid-column:auto;}
        /* kullanıcı isteği: tablet/mobilde sütun başları footer-top'un (Ana Menü/Topluluk/Kurumsal)
           sütun başlarıyla AYNI hizadan başlasın — footer-top HER ZAMAN 32px yatay padding + 20px
           column-gap kullanır (bkz. .footer-top{padding:48px 32px 32px;} temel kuralı, bu satırlarda
           değişmez), o yüzden burada da BİREBİR aynı değerler kullanılıyor. */
        .footer-subscribe-inner{column-gap:20px; padding:26px 32px;}
        .footer-subscribe-join-title, .footer-subscribe-news-title{font-size:14.5px;}
      }
      @media (max-width: 560px){
        .footer-subscribe-join-title, .footer-subscribe-news-title{font-size:13px;}
        .footer-subscribe-btn{padding:0 14px; font-size:12px; height:34px;}
        .footer-newsletter-input{height:34px; padding:0 40px 0 12px;}
        .footer-newsletter-btn{width:28px; height:28px;}
      }
      /* kullanıcı isteği (2026-08-28): mobilde en alt satır artık 3 ayrı satıra yığılır — sırasıyla
         gece/gündüz düğmesi, sosyal ikonlar, © telif metni (bkz. footerHtml() içindeki DOM sırası:
         social, copyright, theme-toggle — masaüstü grid sırası korunur, burada yalnızca CSS order
         özelliğiyle görsel sıra değiştirilir). Aynı gün içindeki önceki "tek satırda kalsın" kararının
         (bkz. git geçmişi) yerini alır. */
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

  const NEWSLETTER_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function wireFooterNewsletter(){
    const form = document.getElementById('footer-newsletter-form');
    const msg = document.getElementById('footer-newsletter-msg');
    if(!form || !msg || form.dataset.wired) return;
    form.dataset.wired = '1';
    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const input = document.getElementById('footer-newsletter-email');
      const email = (input.value || '').trim();
      const btn = form.querySelector('button[type="submit"]');
      msg.textContent = '';
      msg.className = 'footer-newsletter-msg';
      if(!NEWSLETTER_EMAIL_RE.test(email)){
        msg.textContent = 'Geçerli bir e-posta adresi gir.';
        msg.className = 'footer-newsletter-msg err';
        return;
      }
      btn.disabled = true;
      try{
        const res = await fetch('/api/newsletter/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json().catch(()=>({}));
        if(res.ok){
          msg.textContent = 'Abone oldun, teşekkürler!';
          msg.className = 'footer-newsletter-msg ok';
          form.reset();
        } else {
          msg.textContent = data.error || 'Bir şeyler ters gitti, tekrar dene.';
          msg.className = 'footer-newsletter-msg err';
        }
      } catch(err){
        msg.textContent = 'Bağlantı hatası, tekrar dene.';
        msg.className = 'footer-newsletter-msg err';
      } finally {
        btn.disabled = false;
      }
    });
  }

  // kullanıcı isteği (2026-08-28, ekli Architonic ekran görüntüleri referans alınarak): üst
  // menüdeki arama kutusuna tıklayınca artık küçük bir öneri açılır penceresi DEĞİL, tüm ekranı
  // kaplayan bir popup büyüyor — üstte büyük arama kutusu, boşken "Önerilen Aramalar" çipleri +
  // "Görsel ile Ürün Arama" bölümü (bkz. aşağıdaki NAV_SEARCH_RECOMMENDED), yazmaya başlanınca
  // öneriler AYNI /api/public/search-suggest ucundan (eski panelin kullandığı UÇLA BİREBİR AYNI)
  // canlı sonuçlarla değişiyor. Görsel arama bölümü YALNIZCA görsel — hiçbir dosya seçici/URL
  // gönderimi bağlı değil (kullanıcı isteği: "ürün arama kısmı şimdilik aktif olmasın").
  // kullanıcı isteği (2026-08-30, düzeltme): sabit örnek terimler yerine, PROJE gönderilerindeki
  // en kalabalık 5 "Grup" değeri gösterilsin — proje.js#FILTER_GROUPS'ta "Grup" etiketi `type`
  // anahtarına karşılık gelir (bkz. js/pages/proje.js#FILTER_GROUPS, "Tür"/discipline ile
  // KARIŞTIRILMAMALI). /api/projects/filters zaten options'ı count'a göre azalan sırada döndürür
  // (bkz. src/routes/project.js#handleProjectFiltersRoute), burada ekstra sıralama gerekmez.
  // (İlk sürümde yanlışlıkla ürün havuzunun Grup taksonomisi kullanılmıştı, kullanıcı isteğiyle
  // proje gönderilerine düzeltildi.)
  let NAV_SEARCH_RECOMMENDED = ['Villa', 'Ofis Projesi', 'Restorasyon', 'Peyzaj Tasarımı'];
  let recommendedTermsLoaded = false;
  function loadRecommendedTerms(onLoaded){
    if(recommendedTermsLoaded) return;
    fetch('/api/projects/filters')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        const options = (data && data.filters && data.filters.type && data.filters.type.options) || [];
        if(!options.length) return;
        recommendedTermsLoaded = true;
        NAV_SEARCH_RECOMMENDED = options.slice(0, 5);
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
        .nav-search-modal-more{display:block; margin-top:6px; padding:10px 12px; font-size:12.5px; font-weight:600; color:var(--brass); text-align:center;}
        .nav-search-modal-empty{padding:14px 12px; font-size:12.5px; color:var(--ink-soft); text-align:center;}
        .nav-search-modal-image-box{
          display:flex; align-items:center; gap:18px; border:1.5px dashed var(--line); border-radius:14px;
          padding:20px;
        }
        .nav-search-modal-image-drop{
          flex:1; min-width:0; text-align:center; color:var(--ink-soft); font-size:12.5px; line-height:1.6;
          cursor:pointer; border-radius:10px; padding:6px; transition:background .15s ease, box-shadow .15s ease;
          display:flex; align-items:center; justify-content:center;
        }
        .nav-search-modal-image-drop.dragover{background:var(--paper-alt); box-shadow:0 0 0 1.5px var(--walnut) inset;}
        .nav-search-modal-image-drop strong{color:var(--walnut); font-weight:600;}
        .nav-search-modal-image-preview{display:flex; align-items:center; gap:10px; text-align:left; width:100%;}
        .nav-search-modal-image-preview[hidden]{display:none;}
        .nav-search-modal-image-preview img{width:44px; height:44px; object-fit:cover; border-radius:8px; flex-shrink:0; background:var(--paper-alt);}
        .nav-search-modal-image-preview-name{flex:1; min-width:0; font-size:12.5px; color:var(--ink); font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
        .nav-search-modal-image-remove{flex-shrink:0; background:none; border:none; color:var(--ink-soft); padding:5px; border-radius:50%; display:flex;}
        .nav-search-modal-image-remove:hover{background:var(--paper-alt); color:var(--ink);}
        .nav-search-modal-image-error{margin-top:10px; font-size:12px; color:var(--rust); text-align:center;}
        .nav-search-modal-image-or{flex-shrink:0; font-size:11px; font-weight:600; color:var(--ink-soft); text-transform:uppercase; letter-spacing:0.04em;}
        .nav-search-modal-image-paste{
          flex:1; min-width:0; display:flex; align-items:center; gap:8px; border:1px solid var(--line);
          border-radius:10px; padding:10px 14px; background:var(--paper);
        }
        .nav-search-modal-image-paste svg{flex-shrink:0; color:var(--ink-soft);}
        .nav-search-modal-image-paste input{flex:1; min-width:0; border:none; outline:none; background:none; font-family:inherit; font-size:12.5px; color:var(--ink);}
        .nav-search-modal-image-paste input::placeholder{color:var(--ink-soft);}
        .nav-search-modal-image-paste input:focus-visible{box-shadow:none;}
        @media (max-width:640px){
          .nav-search-modal-overlay{padding:60px 12px 12px;}
          .nav-search-modal{padding:22px;}
          .nav-search-modal-image-box{flex-direction:column;}
          /* kullanıcı isteği (2026-08-30): "İhtiyacını yaz, bulmana yardımcı olalım..." placeholder'ı
             mobilde kutunun genişliğine sığmadığından kırpılıyordu — yalnızca mobilde punto küçültüldü. */
          .nav-search-modal-input-row input{font-size:13px;}
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
          <input type="text" id="nav-search-modal-input" placeholder="İhtiyacını yaz, bulmana yardımcı olalım..." aria-label="Ara">
        </div>
        <div class="nav-search-modal-section" id="nav-search-modal-body"></div>
        <div class="nav-search-modal-section">
          <div class="nav-search-modal-section-title">Görsel ile Ürün Arama</div>
          <div class="nav-search-modal-image-box">
            <div class="nav-search-modal-image-drop" id="nav-search-modal-image-drop" role="button" tabindex="0" aria-label="Görsel seç">
              <span class="nav-search-modal-image-drop-text" id="nav-search-modal-image-drop-text">Görselini buraya sürükle veya <strong>seçmek için tıkla</strong><br>PNG, JPG veya JPEG (Maks. 10mb)</span>
              <div class="nav-search-modal-image-preview" id="nav-search-modal-image-preview" hidden>
                <img id="nav-search-modal-image-preview-img" alt="">
                <span class="nav-search-modal-image-preview-name" id="nav-search-modal-image-preview-name"></span>
                <button type="button" class="nav-search-modal-image-remove" id="nav-search-modal-image-remove" aria-label="Görseli kaldır">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <input type="file" accept="image/png,image/jpeg" id="nav-search-modal-image-input" hidden>
            </div>
            <div class="nav-search-modal-image-or">veya</div>
            <label class="nav-search-modal-image-paste">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              <input type="text" id="nav-search-modal-image-url" placeholder="Görsel URL'si yapıştır" aria-label="Görsel URL'si yapıştır">
            </label>
          </div>
          <div class="nav-search-modal-image-error" id="nav-search-modal-image-error" hidden></div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const modalInput = overlay.querySelector('#nav-search-modal-input');
    const body = overlay.querySelector('#nav-search-modal-body');
    let debounceTimer = null;
    let currentQuery = '';

    // kullanıcı isteği (2026-08-28): "Görsel ile Ürün Arama" görsel yükleme/sürükle-bırakla dosya
    // seçilip önizlenebiliyor — ama arama tarafı henüz bağlı değil, bu yüzden seçilen görsel hiçbir
    // yere gönderilmez, yalnızca istemci tarafında önizlenir.
    // gerçek bulgu (2026-08-30, kullanıcı isteği: "görsel yükleme... aktif değil"): #nav-search-modal-
    // image-drop eskiden bir <label> idi ve dosya input'u İÇİNDE barındırıyordu — tıklamanın native
    // label→input yönlendirmesiyle dosya seçiciyi açması bekleniyordu, ama bu yönlendirme (özellikle
    // otomasyon/CDP kaynaklı sentetik tıklamalarda, muhtemelen bazı gerçek tarayıcı/uzantı
    // kombinasyonlarında da) güvenilir şekilde tetiklenmiyordu — tıklayınca HİÇBİR ŞEY olmuyordu.
    // Artık düz bir <div role="button"> — tıklama/klavye (Enter/Space) input.click()'i AÇIKÇA çağırır,
    // native label davranışına hiç güvenilmez.
    const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
    const imageDrop = overlay.querySelector('#nav-search-modal-image-drop');
    const imageInput = overlay.querySelector('#nav-search-modal-image-input');
    const imageDropText = overlay.querySelector('#nav-search-modal-image-drop-text');
    const imagePreview = overlay.querySelector('#nav-search-modal-image-preview');
    const imagePreviewImg = overlay.querySelector('#nav-search-modal-image-preview-img');
    const imagePreviewName = overlay.querySelector('#nav-search-modal-image-preview-name');
    const imageRemoveBtn = overlay.querySelector('#nav-search-modal-image-remove');
    const imageError = overlay.querySelector('#nav-search-modal-image-error');
    let imagePreviewUrl = null;

    function showImageError(message){
      imageError.textContent = message;
      imageError.hidden = false;
    }
    function clearImage(){
      imageInput.value = '';
      if(imagePreviewUrl){ URL.revokeObjectURL(imagePreviewUrl); imagePreviewUrl = null; }
      imagePreview.hidden = true;
      imageDropText.hidden = false;
      imageError.hidden = true;
    }
    function acceptImageFile(file){
      if(!file) return;
      imageError.hidden = true;
      if(!/^image\/(png|jpe?g)$/.test(file.type)){
        showImageError('Yalnızca PNG, JPG veya JPEG dosyaları desteklenir.');
        return;
      }
      if(file.size > IMAGE_MAX_BYTES){
        showImageError('Görsel 10mb\'tan küçük olmalı.');
        return;
      }
      if(imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
      imagePreviewUrl = URL.createObjectURL(file);
      imagePreviewImg.src = imagePreviewUrl;
      imagePreviewName.textContent = file.name;
      imageDropText.hidden = true;
      imagePreview.hidden = false;
    }
    imageInput.addEventListener('change', () => acceptImageFile(imageInput.files && imageInput.files[0]));
    imageRemoveBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); clearImage(); });
    // imageRemoveBtn kendi handler'ında stopPropagation() çağırdığından ("Görseli kaldır" tıklaması
    // buraya hiç ulaşmaz) — burası yalnızca kutunun geri kalanına (metin/önizleme alanı) tıklanınca çalışır.
    imageDrop.addEventListener('click', () => imageInput.click());
    imageDrop.addEventListener('keydown', (e) => {
      if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); imageInput.click(); }
    });
    imageDrop.addEventListener('dragover', (e) => { e.preventDefault(); imageDrop.classList.add('dragover'); });
    imageDrop.addEventListener('dragleave', () => imageDrop.classList.remove('dragover'));
    imageDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      imageDrop.classList.remove('dragover');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      acceptImageFile(file);
    });

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
      const rows = items.map(it => `<a class="nav-search-modal-row" href="${escapeAttr(it.href)}">
          <span class="nav-search-modal-row-tag">${escapeHtml(it.label)}</span>
          <span class="nav-search-modal-row-title">${escapeHtml(it.title)}</span>
          <span class="nav-search-modal-row-meta">${escapeHtml(it.meta || '')}</span>
        </a>`).join('');
      const moreHref = '/arama?q=' + encodeURIComponent(query);
      body.innerHTML = `<div class="nav-search-modal-results">${rows}</div>
        <a class="nav-search-modal-more" href="${escapeAttr(moreHref)}">"${escapeHtml(query)}" için tüm sonuçları gör (${data.total})</a>`;
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

  const navSearchVisualBtn = document.getElementById('nav-search-visual-btn');
  if(navSearchVisualBtn){
    navSearchVisualBtn.addEventListener('click', (e)=>{
      e.preventDefault();
      ensureNavSearchModal().open('');
    });
  }

  // "İçerik Ekle" (kullanıcı isteği, 2026-08-31): footer'ın Topluluk sütunundaki son satır, beş
  // ekleme sayfasına (proje/mimar/firma/ürün/marka) götüren bağlantıları taşıyan küçük bir popup
  // açar. Bağlantılar sıradan <a href> — tıklanınca tarayıcı normal şekilde o sayfaya gider, ayrı
  // bir yönlendirme koduna gerek yok.
  const ADD_CONTENT_LINKS = [
    { href: '/proje-ekle', label: 'Proje Ekle' },
    { href: '/kisi-ekle', label: 'Kişi Ekle' },
    { href: '/firma-ekle', label: 'Firma Ekle' },
    { href: '/urun-ekle', label: 'Ürün Ekle' },
    { href: '/marka-ekle', label: 'Marka Ekle' },
  ];
  const ADD_CONTENT_ARROW = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>';

  function wireAddContent(){
    const trigger = document.getElementById('footer-add-content');
    if(!trigger || document.getElementById('add-content-overlay')) return;
    const overlay = document.createElement('div');
    overlay.className = 'add-content-overlay';
    overlay.id = 'add-content-overlay';
    overlay.innerHTML = `
      <div class="add-content-panel" role="dialog" aria-modal="true" aria-label="İçerik Ekle">
        <button type="button" class="add-content-close" aria-label="Kapat">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <h2>İçerik Ekle</h2>
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

  function mountFooter(){
    const footerMount = document.getElementById('site-footer-mount');
    if(footerMount) footerMount.outerHTML = footerHtml();
    injectFooterStyle();
    wireFooterTheme();
    wireFooterNewsletter();
    wireAddContent();
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', mountFooter);
  } else {
    mountFooter();
  }
})();
