// Pop-up'lardaki yatay kart şeritleri için sayfalama (kullanıcı isteği, 2026-09-02):
// "her 9 gönderiden sonra Devamını Gör butonu olsun, bu sayede sayfa yüklenirken daha hızlı
// yüklenmiş olur. Örneğin Fotoğrafladığı Projeler (85) çok yüksek bir sayı."
//
// NEDEN ORTAK BİR YARDIMCI: proje/kişi/firma/marka/ürün pop-up'larında toplam ~25 farklı yatay
// şerit var (am-*/om-*/pr-* ızgaraları + js/components/project-related.js şeritleri) ve hepsi
// AYNI `.related-grid-scroll` + `.related-card` yapısını kullanıyor. Her birine ayrı sayfalama
// kodu yazmak yerine tek bir çağrı noktası: RelatedStrip.render(grid, items, toHtml).
//
// DAVRANIŞ
//   * İlk PAGE_SIZE (9) kart basılır; geri kalanlar DOM'a HİÇ girmez — asıl kazanç budur,
//     çünkü her kart bir <img> taşır ve 85 kartlık bir şerit 85 lazy görsel düğümü demektir.
//   * Şeridin SONUNA, kartlarla aynı ölçüde bir "Devamını Gör" kartı eklenir — kullanıcı sağa
//     kaydırdığında 9. karttan hemen sonra onu bulur (kullanıcı isteğindeki akış).
//   * Tıklanınca sonraki 9 kart eklenir ve buton yine en sona taşınır; liste bitince kaldırılır.
//   * 9 veya daha az öğe varsa buton HİÇ eklenmez — küçük şeritler (Kurucular, Ekip,
//     Meslektaşlar) bugünkü davranışıyla birebir aynı kalır.
//
// Bölüm başlıklarındaki sayaçlar ("Fotoğrafladığı Projeler (85)") DEĞİŞTİRİLMEZ: onlar toplamı
// gösterir ve kullanıcı için asıl bilgi odur; sayfalama yalnızca render maliyetini böler.
(function () {
  var PAGE_SIZE = 9;

  function render(grid, items, toHtml, opts) {
    if (!grid) return;
    var list = Array.isArray(items) ? items : [];
    var pageSize = (opts && opts.pageSize) || PAGE_SIZE;
    grid.innerHTML = '';
    var shown = 0;

    function appendNext() {
      var slice = list.slice(shown, shown + pageSize);
      // insertAdjacentHTML: mevcut kartların DOM düğümlerini (ve yüklenmiş görsellerini) korur —
      // innerHTML += kullanmak hepsini yeniden oluşturup görselleri yeniden indirtirdi.
      var html = slice.map(function (item, i) { return toHtml(item, shown + i); }).join('');
      var btn = grid.querySelector(':scope > .related-more-btn');
      if (btn) btn.insertAdjacentHTML('beforebegin', html);
      else grid.insertAdjacentHTML('beforeend', html);
      shown += slice.length;
      syncButton();
    }

    function syncButton() {
      var btn = grid.querySelector(':scope > .related-more-btn');
      if (shown >= list.length) { if (btn) btn.remove(); return; }
      var remaining = list.length - shown;
      var label = 'Devamını Gör';
      var sub = '+' + Math.min(pageSize, remaining);
      if (!btn) {
        grid.insertAdjacentHTML('beforeend',
          '<button type="button" class="related-more-btn" aria-label="' + label + '">' +
            '<span class="related-more-plus" aria-hidden="true">›</span>' +
            '<span class="related-more-label"></span>' +
            '<span class="related-more-sub"></span>' +
          '</button>');
        btn = grid.querySelector(':scope > .related-more-btn');
        btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); appendNext(); });
      } else {
        // Butonu her zaman en sona taşı (yeni kartlar önüne eklendiği için sıra zaten doğru,
        // ama savunmacı olarak garanti altına alınır).
        grid.appendChild(btn);
      }
      btn.querySelector('.related-more-label').textContent = label;
      btn.querySelector('.related-more-sub').textContent = sub;
    }

    if (!list.length) return;
    appendNext();
  }

  // Şerit butonunun stili — modal dosyalarının her biri kendi <style>'ını enjekte ettiğinden
  // (bkz. architect-modal.js#injectStyles) ortak kural burada, TEK sefer eklenir.
  function injectStyles() {
    if (document.getElementById('related-strip-styles')) return;
    var el = document.createElement('style');
    el.id = 'related-strip-styles';
    el.textContent = [
      /* .related-card ile AYNI ölçü (flex:0 0 200px, mobilde 140px — bkz. modal dosyalarındaki
         .related-grid-scroll .related-card kuralları) ki şerit hizası bozulmasın. */
      '.related-grid-scroll .related-more-btn{',
      '  flex:0 0 200px; align-self:stretch; min-height:120px;',
      '  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px;',
      '  border:1px dashed var(--line); border-radius:10px; background:transparent;',
      '  color:var(--ink-soft); font-family:inherit; font-size:13px; font-weight:600;',
      '  cursor:pointer; transition:background .15s, color .15s, border-color .15s;',
      '}',
      '.related-grid-scroll .related-more-btn:hover{background:var(--paper-alt); color:var(--ink); border-color:var(--brass);}',
      '.related-grid-scroll .related-more-plus{font-size:22px; line-height:1; font-weight:400;}',
      '.related-grid-scroll .related-more-sub{font-size:11.5px; font-weight:500; opacity:.75;}',
      '@media (max-width: 720px){',
      '  .related-grid-scroll .related-more-btn{flex:0 0 140px; min-height:100px; font-size:12px;}',
      '}',
    ].join('\n');
    document.head.appendChild(el);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectStyles);
  else injectStyles();

  window.RelatedStrip = { render: render, PAGE_SIZE: PAGE_SIZE };
})();
