// KIRIK GÖRSEL YEDEĞİ — kullanıcı isteği, 2026-09-10: "Ertegün Evi gibi bazı gönderilerde görseller
// kırık. Ürünlerde de kırık görseller var. Bu kırık görsel sorununu çöz."
//
// SORUNUN GERÇEĞİ (ölçüldü): görsel yolları D1'de duruyor ama karşılık gelen R2 nesnesi YOK
// (/media/u/... -> 404). Örneklemede 120 proje + 7 ürün kapak görselinin hiçbiri kırık değildi,
// yani durum SEYREK — ama kırık olduğunda tarayıcının varsayılan davranışı (kırık ikon + alt metni)
// sayfayı bozuk gösteriyor. Kaybolan R2 nesneleri geri getirilemez; doğru davranış, görseli olmayan
// kayıtlar için ZATEN var olan yer tutucuya düşmektir.
//
// NEDEN MERKEZİ BİR DİNLEYİCİ: <img> basan ~30 render noktası var (bkz. js/components/preview-cards.js
// dosya başındaki AYNI gerekçe). Hepsine onerror eklemek yerine `error` olayı BELGE ÜZERİNDE
// YAKALAMA fazında dinlenir — `error` olayı BUBBLE ETMEZ, bu yüzden capture:true ZORUNLUDUR.
// Böylece hangi bileşen basmış olursa olsun her kırık görsel yakalanır, ileride eklenecek yeni
// render noktaları da otomatik kapsanır.
(function () {
  function injectStyles() {
    if (document.getElementById('broken-image-fallback-styles')) return;
    var el = document.createElement('style');
    el.id = 'broken-image-fallback-styles';
    el.textContent = [
      /* Yer tutucu, görselin BULUNDUĞU yeri birebir doldurur: kart yüksekliği değişmez, düzen kaymaz. */
      '.ml-img-fallback{',
      '  display:flex; align-items:center; justify-content:center;',
      '  width:100%; height:100%; min-height:inherit;',
      '  background:var(--paper-alt, #efeae1); color:var(--ink-soft, #6b655c);',
      '  font-family:inherit; font-weight:700; letter-spacing:.04em; text-align:center;',
      '  font-size:clamp(13px, 2.2vw, 22px); padding:6px; box-sizing:border-box;',
      '}',
    ].join('\n');
    document.head.appendChild(el);
  }

  // alt metninden baş harfler — sitedeki mevcut yer tutucu deseniyle (initials()) aynı his.
  function initials(text) {
    var words = String(text || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (!words.length) return '—';
    return words.map(function (w) { return w.charAt(0).toLocaleUpperCase('tr'); }).join('');
  }

  function handle(e) {
    var img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    if (img.dataset.mlFallbackDone === '1') return;
    // Boş/eksik src'de tarayıcı da error atar — orada yapacak bir şey yok.
    if (!img.getAttribute('src')) return;
    img.dataset.mlFallbackDone = '1';
    var box = document.createElement('div');
    box.className = 'ml-img-fallback';
    box.textContent = initials(img.getAttribute('alt'));
    box.setAttribute('aria-label', img.getAttribute('alt') || 'Görsel yüklenemedi');
    // Görselin kendi ölçü sınıflarını (ör. .prevnext-thumb) korumak için sınıfları devralır.
    if (img.className) box.className += ' ' + img.className;
    if (img.parentNode) img.parentNode.replaceChild(box, img);
  }

  // ZATEN BAŞARISIZ OLMUŞ görselleri tarar. Dinleyici `defer` ile geç bağlandığından, HTML'in ilk
  // boyamasında yer alan bir görsel biz dinlemeye başlamadan ÖNCE hata vermiş olabilir; o durumda
  // `error` olayı bir daha atılmaz ve kırık ikon ekranda kalır.
  //
  // `complete && naturalWidth === 0` TEK BAŞINA YETERLİ DEĞİL — YANLIŞ POZİTİF üretir (canlıda
  // ölçüldü: /proje ve /urun'de bu imzayı taşıyan iki görselin İKİSİ de aslında sağlamdı, ayrı bir
  // Image() ile sorunsuz yüklendi; muhtemelen henüz çözülmemiş/ertelenmiş kartlar). O imzaya
  // güvenip doğrudan yer tutucu koymak SAĞLAM görselleri baş harflerle değiştirirdi — kırık
  // görselden çok daha kötü bir regresyon. Bu yüzden imza yalnızca ADAY belirler; karar, URL'yi
  // ayrı bir Image() ile yeniden deneyip GERÇEKTEN hata alıp almadığına bakılarak verilir.
  function verifyThenFallback(img) {
    var src = img.getAttribute('src');
    if (!src || img.dataset.mlFallbackChecked === '1') return;
    img.dataset.mlFallbackChecked = '1';
    var probe = new Image();
    probe.onerror = function () { handle({ target: img }); };
    probe.src = src;
  }

  function sweep() {
    var imgs = document.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (img.complete && img.naturalWidth === 0) verifyThenFallback(img);
    }
  }

  injectStyles();
  // capture:true ŞART — `error` olayı bubble etmez (bkz. dosya başı yorumu).
  window.addEventListener('error', handle, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sweep);
  else sweep();
  // Görsellerin çoğu tembel/asenkron yüklenir; `load` anında bir tarama daha, ilk ekranda
  // dinleyiciden önce düşenleri de kapatır.
  window.addEventListener('load', sweep);
})();
