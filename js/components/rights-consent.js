// Telif ve Sorumluluk Beyanı — içerik yayınlamadan ÖNCE zorunlu onay kutucuğu
// (kullanıcı isteği, 2026-09-10 madde 1: "bir proje, kişi, firma, marka ya da ürün yayınlamak için
// her türlü telif sorumluluğunu üzerlerine almak için gönder butonunun üzerine bir okudum kabul
// ediyorum metni ekle. Kullanıcılar bu metne tik atmadan içerik yayınlayamasınlar.").
//
// NEDEN ORTAK BİR BİLEŞEN: aynı metin ALTI ayrı yüzeyde görünmek zorunda — proje-ekle.html,
// kisi-ekle.html, firma-ekle.html, marka-ekle.html, urun-ekle.html ve Hesabım > Arşivim kutusundaki
// "Yayına Al" akışı (bkz. js/components/auth-modal.js#renderArchive). Metin hukuki bir beyan
// olduğundan altı kopya TUTULAMAZ: biri güncellenip diğerleri unutulursa kullanıcıların bir kısmı
// başka bir metni onaylamış olur. Metnin sürümü (TEXT_VERSION) sunucuya da gönderilir ve
// rights_acceptances tablosuna yazılır (bkz. src/lib/rightsConsent.js) — hangi kullanıcının hangi
// metni onayladığı sonradan kanıtlanabilir olsun diye.
//
// SÜRÜMLEME KURALI: aşağıdaki metinlerden HERHANGİ BİRİ değişirse TEXT_VERSION de artırılmalı ve
// AYNI sabit src/lib/rightsConsent.js#RIGHTS_TEXT_VERSION'da güncellenmeli (iki taraf bilerek
// bağımsız kopya tutar — istemci sunucuya güvenilmeyen bir sürüm dizesi gönderemesin diye sunucu
// kendi sabitini yazar, istemciden geleni yalnızca doğrular).
(function () {
  var TEXT_VERSION = '2026-09-10';

  var SHORT_TEXT = 'Sisteme yüklediğim tüm proje, metin, fotoğraf, video ve diğer görsellerin yayın haklarına sahip olduğumu veya gerekli izinleri aldığımı; içeriklerden doğabilecek telif, marka, kişilik hakkı, KVKK ve diğer hukuki ihlallerden kaynaklanan tüm sorumluluğun şahsıma/firmama ait olduğunu kabul ve beyan ederim.';

  var INTRO = 'MİMARLAB, kullanıcıların kendi içeriklerini yükleyip paylaşabildiği bir dijital platformdur. Kullanıcılar, platforma içerik yükleyerek aşağıdaki şartları kabul ve beyan eder:';

  var CLAUSES = [
    ['Telif ve Yayın Hakları', 'Yüklediğim proje, fotoğraf, render, çizim, video ve metinlerin yayınlanması için gerekli haklara sahip olduğumu veya eser sahibi, fotoğrafçı, işveren, ortak müellif ve diğer ilgili hak sahiplerinden gerekli izinleri aldığımı beyan ederim.'],
    ['Hukuki ve Mali Sorumluluk', 'Yüklediğim içeriklerin üçüncü kişilerin telif, marka, kişilik, ticari sır, kişisel veri ve diğer haklarını ihlal etmesi halinde doğabilecek tüm hukuki ve mali sorumluluğun şahsıma/firmama ait olduğunu kabul ederim.'],
    ['MİMARLAB’ın Rolü', 'MİMARLAB, kullanıcılar tarafından yüklenen içeriklerin hak sahipliğini ve hukuka uygunluğunu önceden doğrulama yükümlülüğünü üstlenmez. İçeriğin hak sahipliği ve hukuka uygunluğuna ilişkin sorumluluk içeriği yükleyen kullanıcıya aittir.'],
    ['Üçüncü Kişi Talepleri', 'Yüklediğim içerik nedeniyle MİMARLAB’ın üçüncü kişiler tarafından herhangi bir talep, dava, tazminat veya masrafa maruz kalması halinde, yürürlükteki mevzuatın izin verdiği ölçüde MİMARLAB’ın uğradığı zarar, masraf ve makul hukuki giderleri karşılayacağımı kabul ve taahhüt ederim.'],
    ['İçeriğin Kaldırılması', 'MİMARLAB, telif veya diğer hak ihlali iddiası bulunan ya da hukuka aykırı olduğu değerlendirilen içerikleri inceleme, erişime kapatma, yayından kaldırma veya hesabı askıya alma hakkını saklı tutar.'],
  ];

  var CONFIRM_TEXT = 'Yukarıdaki Telif ve Sorumluluk Beyanı’nı okudum, kabul ediyorum ve yüklediğim içeriğin yayınlanması için gerekli haklara sahip olduğumu beyan ediyorum.';

  var WARN_TEXT = 'İçeriği yayınlayabilmek için Telif ve Sorumluluk Beyanı’nı onaylaman gerekiyor.';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Stil, bu depodaki diğer paylaşılan bileşenlerle AYNI desende TEK sefer enjekte edilir
  // (bkz. js/components/related-strip.js#injectStyles). Sınıf adları `.rc-` önekli — bileşen beş
  // farklı formun ve bir modalın içine giriyor, hiçbirinin kendi kurallarına karışmamalı.
  // UYARI: bu şablon dizisinde ters tırnak/`*/`/`//` KULLANILMAZ (bkz. depo kuralı).
  function injectStyles() {
    if (document.getElementById('rights-consent-styles')) return;
    var el = document.createElement('style');
    el.id = 'rights-consent-styles';
    el.textContent = [
      '.rc-box{border:1px solid var(--line, #dcd7cd); border-radius:12px; background:var(--paper-alt, #f6f3ee); padding:14px 16px; margin:18px 0 14px;}',
      '.rc-box.rc-invalid{border-color:#B3261E; box-shadow:0 0 0 3px rgba(179,38,30,.10);}',
      '.rc-check{display:flex; align-items:flex-start; gap:10px; cursor:pointer; margin:0;}',
      '.rc-check input[type="checkbox"]{flex:0 0 auto; width:18px; height:18px; margin:1px 0 0; accent-color:var(--walnut, #7a5c3e); cursor:pointer;}',
      '.rc-check-text{font-size:13px; line-height:1.55; color:var(--ink, #1d1b18);}',
      '.rc-details{margin-top:10px; border-top:1px solid var(--line-soft, #e6e1d8); padding-top:8px;}',
      '.rc-details > summary{list-style:none; cursor:pointer; display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:700; color:var(--walnut, #7a5c3e);}',
      '.rc-details > summary::-webkit-details-marker{display:none;}',
      '.rc-details-chevron{transition:transform .18s ease;}',
      '.rc-details[open] .rc-details-chevron{transform:rotate(180deg);}',
      '.rc-details-body{font-size:12.5px; line-height:1.6; color:var(--ink-soft, #6b655c); padding-top:8px;}',
      '.rc-details-body p{margin:0 0 10px;}',
      '.rc-details-body ul{margin:0 0 10px; padding-left:18px;}',
      '.rc-details-body li{margin:0 0 8px;}',
      '.rc-details-body li strong{color:var(--ink, #1d1b18);}',
      '.rc-confirm{display:block; margin-top:4px; padding:10px 12px; border:1px dashed var(--line, #dcd7cd); border-radius:9px; background:var(--paper, #fffdf9); font-size:12.5px; line-height:1.55; color:var(--ink, #1d1b18); cursor:pointer;}',
      '.rc-confirm:hover{border-color:var(--walnut, #7a5c3e);}',
      '.rc-confirm-mark{font-weight:700; margin-right:6px;}',
      '.rc-warning{margin:10px 0 0; font-size:12.5px; font-weight:600; color:#B3261E;}',
      '@media (max-width: 620px){',
      '  .rc-box{padding:12px 13px;}',
      '  .rc-check-text{font-size:12.5px;}',
      '}',
    ].join('\n');
    document.head.appendChild(el);
  }

  var seq = 0;

  function boxHtml(inputId) {
    return '' +
      '<label class="rc-check" for="' + esc(inputId) + '">' +
        '<input type="checkbox" id="' + esc(inputId) + '" data-rights-consent-input="1">' +
        '<span class="rc-check-text">' + esc(SHORT_TEXT) + '</span>' +
      '</label>' +
      '<details class="rc-details">' +
        '<summary>Detaylı Sorumluluk Beyanı' +
          '<svg class="rc-details-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>' +
        '</summary>' +
        '<div class="rc-details-body">' +
          '<p>' + esc(INTRO) + '</p>' +
          '<ul>' + CLAUSES.map(function (c) {
            return '<li><strong>' + esc(c[0]) + ':</strong> ' + esc(c[1]) + '</li>';
          }).join('') + '</ul>' +
          '<label class="rc-confirm" for="' + esc(inputId) + '"><span class="rc-confirm-mark" data-rights-consent-mark="1">☐</span>' + esc(CONFIRM_TEXT) + '</label>' +
        '</div>' +
      '</details>' +
      '<p class="rc-warning" hidden>' + esc(WARN_TEXT) + '</p>';
  }

  // Bir kutuyu verilen kaba yerleştirir ve kabı döndürür. Kap zaten bir kutu taşıyorsa (ör. aynı
  // popup ikinci kez açıldı) yeniden kurulmaz — kullanıcının önceki işareti korunmalı DEĞİL, ama
  // ikinci bir input kimliği yaratmak da istenmez; bu yüzden mevcut kutu bulunup sıfırlanır.
  function mount(container) {
    if (!container) return null;
    injectStyles();
    var existing = container.querySelector('[data-rights-consent-input]');
    if (!existing) {
      container.classList.add('rc-box');
      container.innerHTML = boxHtml('rc-consent-' + (++seq));
      wireBox(container);
    }
    return container;
  }

  function wireBox(box) {
    var input = box.querySelector('[data-rights-consent-input]');
    if (!input || input.dataset.rcWired === '1') return;
    input.dataset.rcWired = '1';
    input.addEventListener('change', function () {
      syncBox(box);
      if (input.checked) clearWarning(box);
    });
    syncBox(box);
  }

  // Detay panelindeki kapanış cümlesi AYNI checkbox'a bağlı bir <label> (ikinci bir kontrol DEĞİL) —
  // baştaki ☐/☑ işareti kutunun durumunu yansıtır ki kullanıcı paneli açtığında onayının nerede
  // durduğunu görebilsin.
  function syncBox(box) {
    var input = box.querySelector('[data-rights-consent-input]');
    var mark = box.querySelector('[data-rights-consent-mark]');
    if (mark && input) mark.textContent = input.checked ? '☑' : '☐';
  }

  function clearWarning(box) {
    box.classList.remove('rc-invalid');
    var w = box.querySelector('.rc-warning');
    if (w) w.hidden = true;
  }

  function showWarning(box) {
    box.classList.add('rc-invalid');
    var w = box.querySelector('.rc-warning');
    if (w) w.hidden = false;
    try { box.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { box.scrollIntoView(); }
    var input = box.querySelector('[data-rights-consent-input]');
    if (input) { try { input.focus({ preventScroll: true }); } catch { /* eski tarayıcı */ } }
  }

  // root'un KENDİSİ bir kutu olabilir (ör. RightsConsent.require(document.getElementById('am-rights-consent')))
  // — querySelectorAll kökü kendisi dahil ETMEZ, bu yüzden ayrıca kontrol edilir; aksi halde "kutu
  // bulunamadı" -> "engelleme" dalına düşer ve kapı sessizce açık kalırdı.
  function boxesIn(root) {
    var scope = root || document;
    var found = Array.prototype.slice.call(scope.querySelectorAll ? scope.querySelectorAll('.rc-box') : []);
    if (scope.classList && scope.classList.contains('rc-box')) found.unshift(scope);
    return found;
  }

  function isAccepted(root) {
    var boxes = boxesIn(root);
    if (!boxes.length) return true; // kutu hiç kurulmadıysa (ör. bu yüzeyde yok) engelleme
    return boxes.every(function (b) {
      var input = b.querySelector('[data-rights-consent-input]');
      return !!(input && input.checked);
    });
  }

  // Onaylanmamışsa uyarıyı gösterip false döner — çağıran gönderimi durdurur.
  function requireAccepted(root) {
    var boxes = boxesIn(root);
    var missing = boxes.filter(function (b) {
      var input = b.querySelector('[data-rights-consent-input]');
      return !(input && input.checked);
    });
    if (!missing.length) return true;
    showWarning(missing[0]);
    return false;
  }

  function reset(root) {
    boxesIn(root).forEach(function (b) {
      var input = b.querySelector('[data-rights-consent-input]');
      if (input) input.checked = false;
      syncBox(b);
      clearWarning(b);
    });
  }

  // Gönderilen her payload'a eklenen alanlar — sunucu tarafı bunu ZORUNLU kılar
  // (bkz. src/lib/rightsConsent.js#assertRightsAccepted).
  function payload() {
    return { rightsAccepted: true, rightsTextVersion: TEXT_VERSION };
  }

  // data-rights-consent taşıyan tüm kapları kurar. Sayfa yüklendiğinde otomatik çalışır; sonradan
  // DOM'a giren kaplar için (ör. popup şablonu) elle çağrılabilir.
  function autoMount(root) {
    var scope = root || document;
    Array.prototype.slice.call(scope.querySelectorAll('[data-rights-consent]')).forEach(mount);
  }

  // SON SAVUNMA HATTI: formun KENDİ submit dinleyicisi çalışmadan önce, document üzerinde YAKALAMA
  // (capture) fazında durdurulur. Yakalama fazı hedefe inerken çalıştığından formun kendi
  // dinleyicisinden ÖNCEdir — kayıt sırası ne olursa olsun gönderim gerçekten engellenir. (Aynı
  // dinleyiciyi formun kendisine bağlamak yeterli olmazdı: aynı elemandaki dinleyiciler capture
  // bayrağından bağımsız olarak KAYIT SIRASINA göre çalışır, form kendi dinleyicisini önce
  // bağlamışsa bizimki geç kalırdı.)
  function guard(e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    if (!form.querySelector('.rc-box')) return;
    if (requireAccepted(form)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }

  function init() {
    injectStyles();
    autoMount(document);
    document.addEventListener('submit', guard, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.RightsConsent = {
    TEXT_VERSION: TEXT_VERSION,
    SHORT_TEXT: SHORT_TEXT,
    mount: mount,
    autoMount: autoMount,
    isAccepted: isAccepted,
    require: requireAccepted,
    reset: reset,
    payload: payload,
  };
})();
