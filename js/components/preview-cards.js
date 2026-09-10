// ÖNİZLEME ("soluk") KARTLARI — kullanıcı isteği, 2026-09-10:
// "Arşivlediğin Kişi, firma, marka, ürün ve projeleri canlıya geri al ama bunlar sadece ilgili
//  sayfalarda ve popuplarda önizleme şeklinde soluk olarak görünsünler. Yani üzerlerine
//  tıklanamasın."
//
// NEDEN TEK, MERKEZİ BİR BİLEŞEN (her render noktasına `if (item.preview)` eklemek yerine):
// bu depoda kart basan ~30 ayrı yer var — liste sayfaları (proje/kisi/firma/marka/urun), ana sayfa
// karuseli, popup içindeki şeritler (İlgili Projeler, Şehirdeki Diğer Projeler, Firmanın Diğer
// Ürünleri, Kurucular/Ekip...), arama önerileri, hesabım kutuları. Hepsine tek tek kontrol
// serpiştirmek hem riskli hem de ileride eklenecek YENİ bir render noktasında sessizce unutulur —
// bu, bu depodaki tekrar eden kök nedendir (bkz. proje notu: "doğru yardımcı, kod yolu taşınınca
// bypass edildi"). Bu dosya bunun yerine SONUÇTAKİ DOM'a bakar: hangi bileşen basmış olursa olsun,
// önizleme durumundaki bir kayda giden her bağlantıyı yakalar.
//
// VERİ KAYNAĞI: /api/public/preview (bkz. src/routes/legacyContent.js#handlePublicPreview) —
// /api/public/hidden ile AYNI desen: tek, önbelleklenmiş, herkese açık bir D1 sinyali.
//
// GÜVENLİK NOTU: bu YALNIZCA görsel/etkileşim katmanıdır. Asıl koruma sunucuda: önizleme
// satırlarının hidden_at'i DOLU kalır, dolayısıyla detay uçları 410, sitemap/arama/JSON-LD hariç
// (bkz. migrations/0107_preview_state.sql). Yani bu dosya devre dışı kalsa bile kimse önizleme
// içeriğinin detayına ulaşamaz — burada engellenen yalnızca "ölü bağlantıya tıklama" deneyimidir.
(function () {
  var PREFIX_BY_KIND = {
    projects: ['/proje/'],
    architects: ['/kisi/'],
    // Firma ve marka AYNI offices tablosundan gelir, iki farklı URL öneki taşır (bkz.
    // src/lib/officeUrl.js) — hangi önekin kullanıldığı karta göre değişebildiğinden ikisi de taranır.
    offices: ['/firma/', '/marka/'],
    products: ['/urun/'],
  };

  var previewHrefs = null;   // Set<string> — "/proje/slug" biçiminde
  var pending = false;

  function injectStyles() {
    if (document.getElementById('preview-cards-styles')) return;
    var el = document.createElement('style');
    el.id = 'preview-cards-styles';
    el.textContent = [
      /* Kart TAMAMEN kaybolmaz, "önizleme" olduğu belli olacak kadar soluklaşır ve tıklama alır
         ama hiçbir şey yapmaz (pointer-events:none kullanılmaz: o zaman imleç bile değişmez ve
         kullanıcı kartın neden tepkisiz olduğunu anlamaz — cursor:default + başlık ipucu daha açık). */
      '.ml-preview-card{opacity:.45; filter:grayscale(.35); cursor:default;}',
      '.ml-preview-card:hover{opacity:.55;}',
      /* Kart içindeki alt butonlar (kaydet/paylaş) da devre dışı görünsün. */
      '.ml-preview-card *{pointer-events:none;}',
    ].join('\n');
    document.head.appendChild(el);
  }

  function hrefKey(href) {
    if (!href) return null;
    var path;
    try { path = new URL(href, document.baseURI).pathname; } catch (e) { return null; }
    return path.replace(/\/+$/, '');
  }

  function markAll(root) {
    if (!previewHrefs || !previewHrefs.size) return;
    var scope = (root && root.querySelectorAll) ? root : document;
    var links = scope.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (a.dataset.mlPreviewChecked === '1') continue;
      var key = hrefKey(a.getAttribute('href'));
      if (!key) continue;
      // Yalnızca ilgilendiğimiz önekleri taşıyan bağlantılar işaretlenir (nav/footer bağlantıları
      // boşuna gezilmesin diye ucuz bir ön eleme).
      var relevant = false;
      for (var k in PREFIX_BY_KIND) {
        var prefixes = PREFIX_BY_KIND[k];
        for (var j = 0; j < prefixes.length; j++) { if (key.indexOf(prefixes[j]) === 0) { relevant = true; break; } }
        if (relevant) break;
      }
      if (!relevant) continue;
      a.dataset.mlPreviewChecked = '1';
      if (!previewHrefs.has(key)) continue;
      a.classList.add('ml-preview-card');
      a.setAttribute('aria-disabled', 'true');
      if (!a.getAttribute('title')) a.setAttribute('title', 'Bu içerik önizleme modunda — henüz yayında değil.');
    }
  }

  function scheduleMark() {
    if (pending) return;
    pending = true;
    // Kartlar toplu basılır (innerHTML) — her düğüm için ayrı tarama yapmak yerine tek bir
    // mikro-görevde bir kez taranır.
    requestAnimationFrame(function () { pending = false; markAll(document); });
  }

  // Tıklamayı YAKALAMA fazında durdurur: kartın kendi dinleyicisi (ör. proje.html'in popup açan
  // delegated handler'ı) çalışmadan önce. Sayfa geçişi de (varsayılan davranış) engellenir.
  function guard(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !a.classList.contains('ml-preview-card')) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }

  function start() {
    injectStyles();
    document.addEventListener('click', guard, true);
    document.addEventListener('auxclick', guard, true); // orta tık / yeni sekme
    fetch('/api/public/preview')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        previewHrefs = new Set();
        Object.keys(PREFIX_BY_KIND).forEach(function (kind) {
          (data[kind] || []).forEach(function (slug) {
            PREFIX_BY_KIND[kind].forEach(function (prefix) {
              previewHrefs.add(prefix + encodeURIComponent(slug));
              // Bazı render noktaları slug'ı encode ETMEDEN yazıyor — iki biçim de eşlensin.
              previewHrefs.add(prefix + slug);
            });
          });
        });
        markAll(document);
        // Kartlar tembel/asenkron basıldığından (liste sayfalaması, popup şeritleri, sonsuz kaydırma)
        // DOM'u izlemek şart — tek seferlik bir tarama yalnızca ilk ekranı kapsardı.
        if ('MutationObserver' in window) {
          new MutationObserver(scheduleMark).observe(document.documentElement, { childList: true, subtree: true });
        }
      })
      .catch(function () { /* sinyal alınamadıysa kartlar normal görünür — sunucu tarafı koruma zaten yerinde */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
