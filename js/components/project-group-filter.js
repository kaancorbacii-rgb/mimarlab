// Pop-up şeritlerinin başlığındaki "gruba göre filtrele" çentiği (kullanıcı isteği, 2026-09-04):
// "'Projeler (sayı)' başlığının yanında sağı gösteren bir çentik olsun; tıklayınca burada yüklü
// projelerin künyelerindeki Gruplara göre bir filtre çıksın … iki grup butonuna tıklarsam ikisine
// ait projeler gözüksün ve başlıktaki sayı da seçilen filtreye göre güncellensin. Bu sırada
// alttaki harita da seçilen filtreye göre güncellensin."
// Aynı gün gelen ek istekler: (1) BAŞLIĞIN KENDİSİNE tıklamak da çentikle aynı şekilde açsın/
// kapatsın, (2) proje pop-up'ındaki "Firmanın Diğer Projeleri" bölümüne de eklensin, (3) marka
// pop-up'ındaki "Ürünler" bölümü de aynı şekilde ama ÜRÜN KATEGORİSİNE göre filtrelensin.
//
// ŞU AN NEREDE KULLANILIYOR
//   * kişi pop-up'ı  — "Projeler"                     (architect-modal.js, alan: type)
//   * kişi pop-up'ı  — "Fotoğrafladığı Projeler"      (architect-modal.js, alan: type)
//   * kişi pop-up'ı  — "Tasarladığı Ürünler"          (architect-modal.js, alan: category)
//   * firma pop-up'ı — "Projeler"                     (office-modal.js,    alan: type)
//   * marka pop-up'ı — "Ürünler"                      (office-modal.js,    alan: category)
//   * proje pop-up'ı — "Firmanın Diğer Projeleri"     (project-modal.js,   alan: type)
//   * ürün pop-up'ı  — "Firmanın Diğer Ürünleri"      (product-modal.js,   alan: category)
//
// "Grup" = projects.type (bkz. js/components/project-meta.js#176 ve js/pages/proje.js#137 —
// künyede "Grup" etiketiyle görünen ALAN budur; "Tür" ayrı bir alandır: category). Ürünlerde ise
// gruplama products.category üzerinden yapılır (kart alt satırında zaten gösterilen değer) — bu
// yüzden alan okuma `groupsOf` seçeneğiyle dışarıdan verilebilir; varsayılan `type`'tır.
//
// NEDEN ORTAK BİR MODÜL: bu şeritlerin hepsi AYNI yapıyı kullanıyor (.related-title başlığı +
// .related-grid-scroll ızgarası, kimisinde altında harita). js/components/related-strip.js'teki
// AYNI gerekçeyle mantık tek yerde durur; çağıranlar yalnızca kendi element'lerini + bir
// yeniden-çizim geri çağrısı geçer.
//
// FİLTRE YALNIZCA İSTEMCİ TARAFINDA: bu şeritler zaten TÜM listeyi elinde tutuyor (sayfalama
// RelatedStrip'te, DOM düzeyinde) — yani filtreleme için ek bir istek gerekmez ve seçim
// değiştiğinde ızgara + başlık sayacı + (varsa) harita anında yeniden çizilir.
(function () {
  var CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

  // Aynı düğüm her profilde YENİDEN kullanıldığından (şablon mountedOnce ile bir kez basılır) her
  // attach() çağrısında önceki dinleyici düşürülmelidir. cloneNode yerine WeakMap: başlık <h2>'si
  // sayaç <span>'ini İÇERİYOR ve onu klonlamak, çağıranların id ile bulduğu düğümü koparırdı.
  var boundClick = new WeakMap();
  function bindClick(el, fn) {
    var prev = boundClick.get(el);
    if (prev) el.removeEventListener('click', prev);
    el.addEventListener('click', fn);
    boundClick.set(el, fn);
  }

  function injectStyles() {
    if (document.getElementById('project-group-filter-styles')) return;
    var el = document.createElement('style');
    el.id = 'project-group-filter-styles';
    el.textContent = [
      /* Başlıktaki çentik — .related-title'ın hemen sağında, metinle aynı optik hizada. Kapalıyken
         sağı gösterir (kullanıcı isteği), açılınca 90° dönüp aşağıyı gösterir. */
      '.pgf-toggle{',
      '  display:inline-flex; align-items:center; justify-content:center; vertical-align:middle;',
      '  width:22px; height:22px; margin-left:6px; padding:0;',
      '  background:none; border:none; border-radius:50%; cursor:pointer;',
      '  color:var(--ink-soft); transition:color .15s, background .15s;',
      '}',
      '.pgf-toggle svg{width:16px; height:16px; display:block; transition:transform .18s ease;}',
      '.pgf-toggle:hover{color:var(--ink); background:var(--paper-alt);}',
      '.pgf-toggle[aria-expanded="true"] svg{transform:rotate(90deg);}',
      '.pgf-toggle[aria-expanded="true"]{color:var(--ink);}',
      /* Başlığın kendisi de aynı düğmeyi tetikler (kullanıcı isteği, 2026-09-04 madde 1-2) —
         yalnızca filtre GERÇEKTEN varken (2+ grup) bu sınıf eklenir, aksi halde başlık sıradan
         bir başlık gibi davranmaya devam eder. user-select:none: art arda tıklarken metnin
         seçilip mavi vurgulanmasını engeller. */
      '.related-title.pgf-title-clickable{cursor:pointer; user-select:none; -webkit-user-select:none;}',
      '.related-title.pgf-title-clickable:hover .pgf-toggle{color:var(--ink); background:var(--paper-alt);}',
      /* Çip satırı — proje.html#.active-chip ile AYNI pil dili (seçili = dolu var(--ink)). */
      '.pgf-chips{display:flex; flex-wrap:wrap; gap:8px; margin:-4px 0 16px;}',
      '.pgf-chip{',
      '  display:inline-flex; align-items:center; gap:6px;',
      '  background:var(--paper-card); border:1px solid var(--line); border-radius:100px;',
      '  padding:5px 12px; font-family:inherit; font-size:12.5px; font-weight:600;',
      '  color:var(--ink-soft); cursor:pointer; transition:background .15s, color .15s, border-color .15s;',
      '}',
      '.pgf-chip:hover{border-color:var(--brass); color:var(--ink);}',
      '.pgf-chip[aria-pressed="true"]{background:var(--ink); border-color:var(--ink); color:var(--paper-card);}',
      '.pgf-chip-count{font-size:11px; font-weight:500; opacity:.7;}',
    ].join('\n');
    document.head.appendChild(el);
  }

  // Varsayılan alan okuma: projects.type — parseCanonicalRow her zaman diziye çözer (bkz.
  // src/lib/canonicalRead.js#JSON_FIELDS). Eski/eksik kayıtlarda alan hiç gelmeyebilir ya da düz
  // metin olabilir (ör. products.category bir STRING'tir); ikisi de sessizce tolere edilir.
  function toGroupList(raw) {
    if (!raw) return [];
    var list = Array.isArray(raw) ? raw : [raw];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var g = String(list[i] || '').trim();
      if (g) out.push(g);
    }
    return out;
  }
  function defaultGroupsOf(item) { return toGroupList(item && item.type); }

  // Sayıya göre azalan, eşitlikte Türkçe alfabetik — kullanıcı en kalabalık grubu ilk görsün.
  function buildGroupList(items, groupsOf) {
    var counts = new Map();
    for (var i = 0; i < items.length; i++) {
      var gs = groupsOf(items[i]);
      for (var j = 0; j < gs.length; j++) counts.set(gs[j], (counts.get(gs[j]) || 0) + 1);
    }
    var out = [];
    counts.forEach(function (count, name) { out.push({ name: name, count: count }); });
    out.sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name, 'tr');
    });
    return out;
  }

  // attach({toggleEl, chipsEl, items, onChange, titleEl, groupsOf})
  //   * Her renderItem()/mount() çağrısında (yani her yeni profilde/projede) yeniden çağrılır;
  //     seçim sıfırlanır, çip satırı kapanır, eski dinleyiciler düşürülür.
  //   * onChange yalnızca SEÇİM DEĞİŞTİĞİNDE çağrılır; ilk (filtresiz) çizimi çağıran yapar.
  //   * titleEl verilirse başlığa tıklamak da açar/kapatır (kullanıcı isteği). Çentik başlığın
  //     İÇİNDE olduğundan dinleyici YALNIZCA başlığa bağlanır — ikisine birden bağlanırsa çentiğe
  //     tıklamak baloncuklanıp iki kez tetiklenir ve panel hiç açılmaz.
  //   * İki veya daha az grup varsa (ör. tüm projeler "Konut") filtre anlamsızdır — çentik hiç
  //     gösterilmez, başlık da tıklanabilir olmaz.
  function attach(opts) {
    injectStyles();
    var toggleEl = opts.toggleEl;
    var chipsEl = opts.chipsEl;
    var titleEl = opts.titleEl || null;
    var groupsOf = opts.groupsOf || defaultGroupsOf;
    var items = Array.isArray(opts.items) ? opts.items : [];
    var onChange = opts.onChange;
    if (!toggleEl || !chipsEl) return;

    toggleEl.type = 'button';
    toggleEl.className = 'pgf-toggle';
    toggleEl.innerHTML = CHEVRON;
    toggleEl.setAttribute('aria-expanded', 'false');
    toggleEl.setAttribute('aria-label', 'Gruba göre filtrele');
    toggleEl.title = 'Gruba göre filtrele';

    chipsEl.innerHTML = '';
    chipsEl.style.display = 'none';
    chipsEl.className = 'pgf-chips';

    var groups = buildGroupList(items, groupsOf);
    if (groups.length < 2) {
      toggleEl.style.display = 'none';
      if (titleEl) { titleEl.classList.remove('pgf-title-clickable'); bindClick(titleEl, function () {}); }
      return;
    }
    toggleEl.style.display = '';

    var selected = new Set();

    function filtered() {
      if (!selected.size) return items;
      return items.filter(function (it) {
        var gs = groupsOf(it);
        for (var i = 0; i < gs.length; i++) if (selected.has(gs[i])) return true;
        return false;
      });
    }

    groups.forEach(function (g) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'pgf-chip';
      chip.setAttribute('aria-pressed', 'false');
      // textContent: grup adları serbest metin (künyeden/katalogdan gelir) — innerHTML'e hiç girmez.
      var label = document.createElement('span');
      label.textContent = g.name;
      var count = document.createElement('span');
      count.className = 'pgf-chip-count';
      count.textContent = String(g.count);
      chip.appendChild(label);
      chip.appendChild(count);
      chip.addEventListener('click', function () {
        if (selected.has(g.name)) selected.delete(g.name);
        else selected.add(g.name);
        chip.setAttribute('aria-pressed', selected.has(g.name) ? 'true' : 'false');
        if (onChange) onChange(filtered());
      });
      chipsEl.appendChild(chip);
    });

    function toggleOpen() {
      var open = toggleEl.getAttribute('aria-expanded') === 'true';
      toggleEl.setAttribute('aria-expanded', open ? 'false' : 'true');
      chipsEl.style.display = open ? 'none' : '';
    }

    if (titleEl) {
      titleEl.classList.add('pgf-title-clickable');
      bindClick(titleEl, toggleOpen);
    } else {
      bindClick(toggleEl, toggleOpen);
    }
  }

  window.ProjectGroupFilter = {
    attach: attach,
    // Ürün kategorisi gibi TEK değerli (dizi olmayan) alanlar için hazır okuyucu üreticisi —
    // çağıranların kendi küçük kopyalarını yazmasına gerek kalmasın.
    byField: function (field) { return function (item) { return toGroupList(item && item[field]); }; },
  };
})();
