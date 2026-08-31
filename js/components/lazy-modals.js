// lazy-modals.js — denetim bulgusu (2026-08-14): auth-modal.js (118KB) + info-modal.js (75KB),
// repodaki en büyük 2 JS dosyası, HER sayfada <script defer> ile senkron indirilip parse/exec
// ediliyordu; ziyaretçilerin büyük çoğunluğu Giriş Yap/Üye Ol/Hesabım/Rozet Al/İade Et/İletişim/
// Hakkında/Gizlilik Politikası/Hizmet Şartları/Kariyer popup'larından HİÇBİRİNİ hiç açmıyor. Bu dosya
// ikisini de yalnızca gerçekten gerekince yükler: (a) ilgili nav/footer linkine tıklanınca, (b) o
// linkin temiz URL'ine (ör. /giris, /hakkinda) doğrudan gidilince/F5 yapılınca, ya da (c) tarayıcı
// geri/ileri tuşuyla o URL'e dönülünce. HREF_VIEW_RE/pathRe eşlemeleri auth-modal.js/info-modal.js'in
// kendi başlarındaki AYNI sabitlerin BİLEREK kopyasıdır — asıl (büyük) modülü indirmeden hangi linkin
// hangi popup'ı açacağını bilmemiz gerekiyor; biri değişirse ikisi birlikte güncellenmeli.
(function () {
  const MODULES = {
    auth: {
      src: 'js/components/auth-modal.js',
      globalName: 'AuthModal',
      hrefRe: {
        login: /(^|\/)giris-yap\.html$/, signup: /(^|\/)uye-ol\.html$/,
        account: /(^|\/)hesabim\.html$/, activities: /(^|\/)aktivitelerim\.html$/, contents: /(^|\/)iceriklerim\.html$/,
        collections: /(^|\/)koleksiyonum\.html$/, forgot: /(^|\/)sifremi-unuttum\.html$/,
      },
      pathRe: /^\/(giris|uye-ol|hesabim|aktivitelerim|iceriklerim|koleksiyonum|sifremi-unuttum)\/?$/,
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
      },
      pathRe: /^\/(rozet-al|iade-et|iletisim|hakkinda|gizlilik-politikasi|hizmet-sartlari|kariyer|cerez-politikasi)\/?$/,
    },
  };

  const pending = {};
  // src'si zaten sayfada varsa (ör. bu betik iki kez dahil edilmişse) tekrar enjekte etmez —
  // window.AuthModal/InfoModal (bkz. o dosyaların sonundaki AYNI not) hazır olana kadar bekler.
  function loadModule(key) {
    if (pending[key]) return pending[key];
    const mod = MODULES[key];
    if (window[mod.globalName]) { pending[key] = Promise.resolve(window[mod.globalName]); return pending[key]; }
    pending[key] = new Promise((resolve, reject) => {
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
    });
    return pending[key];
  }

  // Doğrudan URL ile açılış (F5/deep-link) — modülün kendi initialView mantığı (bkz. auth-modal.js/
  // info-modal.js dosya sonu) location.pathname'i okuyup popup'ı kendi açar, burada sadece indirmek
  // yeterli.
  for (const key in MODULES) {
    if (MODULES[key].pathRe.test(location.pathname)) loadModule(key).catch(() => {});
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const href = a.getAttribute('href');
    for (const key in MODULES) {
      const mod = MODULES[key];
      // Modül zaten yüklendiyse KENDİ document click listener'ı (bkz. auth-modal.js/info-modal.js
      // dosya sonu) bu tıklamayı zaten yönetecek — burada da işlersek preventDefault sonrası hem
      // burada hem orada open() çağrılıp popup'ın çift açılmasına/view'ın gereksiz re-render'ına
      // yol açardı.
      if (window[mod.globalName]) continue;
      let view = null;
      for (const v in mod.hrefRe) { if (mod.hrefRe[v].test(href)) { view = v; break; } }
      if (!view) continue;
      e.preventDefault();
      // Yükleme başarısız olursa (bkz. loadModule#onerror) preventDefault sonrası kullanıcıyı elleri
      // boş bırakmamak için normal (tam sayfa) navigasyona düşülür.
      loadModule(key).then((Modal) => { if (Modal) Modal.open(view, { triggerEl: a }); }).catch(() => { window.location.href = href; });
      return;
    }
  });

  // bkz. yukarısı "Doğrudan URL ile açılış" — kullanıcı popup'ı hiç tetiklemeden geri/ileri tuşuyla
  // bu URL'lerden birine dönerse modül henüz yüklenmemiş olabilir; yüklenince kendi initialView
  // mantığı zaten devreye girer (popstate'in kendisini ayrıca dinlemeye gerek yok).
  window.addEventListener('popstate', () => {
    for (const key in MODULES) {
      if (MODULES[key].pathRe.test(location.pathname)) loadModule(key).catch(() => {});
    }
  });
})();
