// Serbest anlatı alanları için karakter sayacı (kullanıcı isteği, 2026-09-02: proje/kişi/firma/
// ürün/marka ekle-düzenle sayfalarındaki açıklama/hakkında metinlerine 1500 karakter sınırı).
//
// Tek bir paylaşılan dosya: beş ekle sayfasının her birine aynı satır içi kodu kopyalamak yerine
// `<textarea maxlength>` taşıyan HER alanı kendiliğinden bulur ve altına bir sayaç yazar. Sunucu
// tarafı karşılığı src/lib/submissionTypes.js#NARRATIVE_MAX_LENGTH.
//
// ESKİ GÖNDERİLER BOZULMAZ (kullanıcı isteği: "Bundan önceki gönderiler olduğu gibi kalabilir"):
// HTML'in "too long" kısıtı yalnızca kullanıcı alanı DÜZENLEDİĞİNDE (dirty value flag) geçerli
// olur — JS ile önceden doldurulmuş 1500'den uzun bir değer formu geçersiz YAPMAZ, kullanıcı o
// metne dokunmadığı sürece kaydetme çalışmaya devam eder. Sayaç bu durumu yalnızca görsel olarak
// (kırmızı) belirtir, hiçbir şeyi engellemez ve metni ASLA kırpmaz.
(function () {
  var WARN_RATIO = 0.9;

  function attach(el) {
    var max = parseInt(el.getAttribute('maxlength'), 10);
    if (!max || el.dataset.charCounterBound) return;
    el.dataset.charCounterBound = '1';

    var out = document.createElement('div');
    out.className = 'form-hint char-counter';
    // aria-live: ekran okuyucu kalan karakteri duyursun ama her tuşta değil (polite).
    out.setAttribute('aria-live', 'polite');
    if (el.id) out.id = el.id + '-counter';
    // Sayacı textarea'nın hemen ardına koy; .form-field içindeki mevcut .form-hint akışıyla aynı yer.
    el.parentNode.insertBefore(out, el.nextSibling);

    function render() {
      var n = el.value.length;
      out.textContent = n + ' / ' + max;
      var over = n > max;
      out.style.color = over ? 'var(--bad, #c0392b)' : (n >= max * WARN_RATIO ? 'var(--accent)' : '');
      out.style.fontWeight = over ? '600' : '';
      // Yalnızca ZATEN kayıtlı (uzun) bir metin varsa açıklayıcı ek not — kullanıcı metni
      // kısaltmadan da sayfayı kaydedebileceğini bilsin.
      if (over) out.textContent = n + ' / ' + max + ' — kaydetmek için bu metni kısaltman gerekiyor.';
    }

    el.addEventListener('input', render);
    render();
  }

  function init() {
    var list = document.querySelectorAll('textarea[maxlength]');
    for (var i = 0; i < list.length; i++) attach(list[i]);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Düzenleme modunda alanlar fetch sonrası JS ile doldurulur (bkz. *-ekle.html#prefillForEdit) —
  // o an `input` olayı tetiklenmediğinden sayaç 0'da kalırdı. Görünürlük değişimlerini ve geç
  // doldurmayı yakalamak için kısa bir süre boyunca birkaç kez yeniden çiz.
  var ticks = 0;
  var timer = setInterval(function () {
    var list = document.querySelectorAll('textarea[maxlength]');
    for (var i = 0; i < list.length; i++) {
      attach(list[i]);
      list[i].dispatchEvent(new Event('input'));
    }
    if (++ticks >= 6) clearInterval(timer);
  }, 700);
})();
