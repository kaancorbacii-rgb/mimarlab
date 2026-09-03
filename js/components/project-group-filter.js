// "Projeler (N)" başlığının yanındaki grup filtresi (kullanıcı isteği, 2026-09-04):
// "Firma ve Kişi popuplarında 'Projeler (sayı)' başlığının yanında sağı gösteren bir çentik olsun;
// tıklayınca burada yüklü projelerin künyelerindeki Gruplara göre bir filtre çıksın … iki grup
// butonuna tıklarsam ikisine ait projeler gözüksün ve başlıktaki sayı da seçilen filtreye göre
// güncellensin. Bu sırada alttaki harita da seçilen filtreye göre güncellensin."
//
// "Grup" = projects.type (bkz. js/components/project-meta.js#176 ve js/pages/proje.js#137 —
// künyede "Grup" etiketiyle görünen ALAN budur; "Tür" ayrı bir alandır: category). Bu yüzden
// veri tarafında src/lib/projectPool.js#PROJECT_CARD_COLUMNS'a p.type eklendi ve iki pop-up
// yükünde de (architect.js/office.js) kart nesnesine `type` dizisi taşınır.
//
// NEDEN ORTAK BİR MODÜL: kişi (architect-modal.js) ve firma/marka (office-modal.js) pop-up'ları
// bu bölümü BİREBİR aynı yapıyla render ediyor (aynı .related-title + .related-grid-scroll +
// harita üçlüsü). js/components/related-strip.js'teki AYNI gerekçeyle mantık tek yerde durur;
// iki modal yalnızca kendi element id'lerini geçer.
//
// FİLTRE YALNIZCA İSTEMCİ TARAFINDA: pop-up zaten o profilin TÜM projelerini tek yükte alıyor
// (sayfalama RelatedStrip'te, DOM düzeyinde) — yani filtreleme için ek bir istek gerekmez ve
// seçim değiştiğinde ızgara + başlık sayacı + harita anında yeniden çizilir.
(function () {
  var CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

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

  // projects[].type künyedeki Grup dizisidir (parseCanonicalRow her zaman diziye çözer, bkz.
  // src/lib/canonicalRead.js#JSON_FIELDS). Eski/eksik kayıtlarda alan hiç gelmeyebilir ya da düz
  // metin olabilir — ikisi de sessizce tolere edilir.
  function groupsOf(project) {
    var raw = project && project.type;
    if (!raw) return [];
    var list = Array.isArray(raw) ? raw : [raw];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var g = String(list[i] || '').trim();
      if (g) out.push(g);
    }
    return out;
  }

  // Sayıya göre azalan, eşitlikte Türkçe alfabetik — kullanıcı en kalabalık grubu ilk görsün.
  function buildGroupList(projects) {
    var counts = new Map();
    for (var i = 0; i < projects.length; i++) {
      var gs = groupsOf(projects[i]);
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

  // attach({toggleEl, chipsEl, projects, onChange})
  //   * Her renderItem() çağrısında (yani her yeni profilde) yeniden çağrılır; seçim sıfırlanır,
  //     çip satırı kapanır ve eski dinleyiciler cloneNode ile temizlenir (aynı düğüm yeniden
  //     kullanılıyor — mountedOnce sayesinde şablon yalnızca bir kez basılır).
  //   * onChange yalnızca SEÇİM DEĞİŞTİĞİNDE çağrılır; ilk (filtresiz) çizimi çağıran yapar.
  //   * İki veya daha az grup varsa (ör. tüm projeler "Konut") filtre anlamsızdır — çentik hiç
  //     gösterilmez.
  function attach(opts) {
    injectStyles();
    var toggleEl = opts.toggleEl;
    var chipsEl = opts.chipsEl;
    var projects = Array.isArray(opts.projects) ? opts.projects : [];
    var onChange = opts.onChange;
    if (!toggleEl || !chipsEl) return;

    // Eski dinleyicileri düşür (bkz. yukarıdaki gerekçe) — düğümü klonlayıp yerine koymak, tek tek
    // removeEventListener tutmaktan daha az hataya açık.
    var freshToggle = toggleEl.cloneNode(false);
    toggleEl.parentNode.replaceChild(freshToggle, toggleEl);
    toggleEl = freshToggle;
    toggleEl.type = 'button';
    toggleEl.className = 'pgf-toggle';
    toggleEl.innerHTML = CHEVRON;
    toggleEl.setAttribute('aria-expanded', 'false');
    toggleEl.setAttribute('aria-label', 'Gruba göre filtrele');
    toggleEl.title = 'Gruba göre filtrele';

    chipsEl.innerHTML = '';
    chipsEl.style.display = 'none';
    chipsEl.className = 'pgf-chips';

    var groups = buildGroupList(projects);
    if (groups.length < 2) { toggleEl.style.display = 'none'; return; }
    toggleEl.style.display = '';

    var selected = new Set();

    function filtered() {
      if (!selected.size) return projects;
      return projects.filter(function (p) {
        var gs = groupsOf(p);
        for (var i = 0; i < gs.length; i++) if (selected.has(gs[i])) return true;
        return false;
      });
    }

    groups.forEach(function (g) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'pgf-chip';
      chip.setAttribute('aria-pressed', 'false');
      // textContent: grup adları serbest metin (künyeden gelir) — innerHTML'e hiç girmez.
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

    toggleEl.addEventListener('click', function () {
      var open = toggleEl.getAttribute('aria-expanded') === 'true';
      toggleEl.setAttribute('aria-expanded', open ? 'false' : 'true');
      chipsEl.style.display = open ? 'none' : '';
    });
  }

  window.ProjectGroupFilter = { attach: attach };
})();
