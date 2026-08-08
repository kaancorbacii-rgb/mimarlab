// Global Overlay Manager — hamburger menü, Hesabım avatar menüsü, arama önerileri paneli, Paylaş
// popover'ları ve modal (proje/mimar/firma/ürün detay) arasındaki z-index/çakışma sorunlarını çözer
// (bkz. kullanıcı isteği): sistemde aynı anda yalnızca TEK BİR panel açık kalabilir — biri açılınca
// açık olan DİĞER TÜM paneller otomatik kapanır. Her sayfada <script src="js/overlay-manager.js">
// ile (auth-nav.js'ten ÖNCE) dahil edilir, save-widget.js/rating-widget.js ile AYNI global-nesne
// deseni: `OverlayManager`.
//
// İki entegrasyon yolu sunar:
//   1) register(id, closeFn) + notifyOpen(id) — kendi kapatma mantığı olan (history/scroll/focus
//      gibi yan etkileri olan) bileşenler için, bkz. modal-shell.js#open/close. closeFn çağrıldığında
//      panel GERÇEKTEN kendi close() akışından geçer, salt bir CSS sınıfı silinmez.
//   2) Otomatik grup — hamburger/avatar/arama/paylaş popover'ları her sayfada ayrı inline
//      script'lerle (bkz. her *.html dosyasının sonundaki <script>, share-button.js) kendi `.open`
//      sınıflarını toggle'lıyor; bu paneller register EDİLMEDEN, bilinen seçicilerdeki `.open` sınıf
//      değişiklikleri bir MutationObserver ile izlenir — side-effect'siz sade CSS toggle'lar olduğundan
//      diğerlerini kapatmak için sınıflarını kaldırmak güvenlidir (bkz. AUTO_SELECTOR).
const OverlayManager = (function () {
  const registry = new Map(); // id -> closeFn
  const AUTO_SELECTOR = '.nav-mobile-menu, .nav-avatar-menu, .nav-search-suggest, .share-popover';

  function register(id, closeFn) { registry.set(id, closeFn); }
  function unregister(id) { registry.delete(id); }

  function closeOthers(exceptEl, exceptId) {
    registry.forEach((closeFn, id) => {
      if (id === exceptId) return;
      closeFn();
    });
    document.querySelectorAll(AUTO_SELECTOR).forEach(el => {
      if (el === exceptEl) return;
      // exceptEl'in ÜST kapsayıcısını kapatma — gerçek bulgu: hamburger menüsü içindeki arama
      // kutusunun .nav-search-suggest paneli .nav-mobile-search'ün (dolayısıyla .nav-mobile-menu'nün)
      // İÇİNDE render ediliyor; panel .open olunca bu kontrol olmadan kendi ebeveyni olan
      // .nav-mobile-menu de "diğer panel" sayılıp kapatılıyor, kullanıcı arama kutusuna yazar yazmaz
      // hamburger menüsü kapanıyordu.
      if (exceptEl && el.contains(exceptEl)) return;
      el.classList.remove('open');
    });
  }

  // notifyOpen(id): register() ile kayıtlı bir panel kendi açılışını bildirir — diğer TÜM kayıtlı
  // panelleri (kendisi hariç) VE otomatik gruptaki tüm panelleri kapatır.
  function notifyOpen(id) {
    closeOthers(null, id);
  }

  function closeAll() { closeOthers(null, null); }

  let observing = false;
  function observeAuto() {
    if (observing) return;
    observing = true;
    const obs = new MutationObserver(mutations => {
      mutations.forEach(m => {
        const el = m.target;
        if (!(el instanceof Element) || !el.classList.contains('open')) return;
        if (el.matches(AUTO_SELECTOR)) closeOthers(el, null);
      });
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observeAuto);
  else observeAuto();

  return { register, unregister, notifyOpen, closeAll };
})();
