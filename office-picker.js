// MİMARLAB — "Firma veya Marka" ÇOKLU SEÇİM kutusu (kullanıcı isteği, 2026-09-06 madde 1 ve 4):
// "Firma başlığı 'Firma veya Marka' olsun ve kullanıcı birden fazla seçenek seçebilsin ... en üste
// arama çubuğu koy" / "Kişi ekle/düzenle sayfasındaki Firma / Marka Adı yazan kutucukta çoktan
// seçilebilir olsun. Burada sitede yüklü tüm firmalar ve markalar alt alta çoktan seçilebilir
// şekilde güncellensin. En üstte de arama çubuğu olsun."
//
// İKİ ÇAĞIRAN, TEK KAYNAK — profession-shared.js/awards-shared.js ile AYNI desen:
//   * kisi-ekle.html            (Firmalar / Markalar bölümü, eski #m-office serbest metin kutusu)
//   * js/components/auth-modal.js (Hesabım > Profili Düzenle, eski #am-edit-office tekil <select>)
// İkisi de aynı veriyi (GET /api/offices/names — firma VE marka ayrımsız tüm adlar) ve aynı
// depolama biçimini kullanır: virgülle ayrılmış tek bir metin. Bu biçim YENİ DEĞİL — architect_
// submissions.office zaten çoklu firmayı böyle taşıyor ve src/lib/canonicalSync.js#syncArchitect
// virgüle göre bölüp her adı ayrı ayrı office_founders'a bağlıyor (ilki architects.office_id'ye
// "birincil firma" olarak yazılır). Yani bu görev bir şema değişikliği DEĞİL, o biçimi serbest
// metin yerine gerçek bir seçim arayüzüne bağlamaktır.
//
// STİL: .dd-* sınıflarının (kisi-ekle.html + auth-modal.js'te İKİ AYRI kopya olarak duran) görsel
// karşılığı burada `.op-*` adıyla, KENDİ <style>'ında tekrarlanır. Bilinçli: bu bileşen hem sıradan
// bir sayfada hem de ModalShell overlay'i içinde render ediliyor ve host sayfanın kuralları modala
// SIZIYOR (bkz. proje notu: ".hero/.btn kuralları modala sızar") — kendi sınıf adlarıyla gelmek,
// iki bağlamda da aynı görünmesinin tek güvenilir yolu.
(function () {
  const OPTIONS_URL = '/api/offices/names';
  let optionsPromise = null;

  // Tüm firma+marka adları — modülün ömrü boyunca TEK istek (kutu her açıldığında yeniden
  // çekilmez; auth-modal.js#allOfficeNamesPromise'in AYNI gerekçesi).
  function loadOfficeOptions() {
    if (!optionsPromise) {
      optionsPromise = fetch(OPTIONS_URL)
        .then(r => (r.ok ? r.json() : { items: [] }))
        .then(d => (d.items || []).filter(i => i && i.name))
        .catch(() => []);
    }
    return optionsPromise;
  }

  // src/routes/office.js#foldTr ile AYNI Türkçe casefold — "İSTANBUL"/"istanbul"/"Istanbul" hepsi
  // aynı anahtara düşsün diye (arama kutusu ve seçili/liste karşılaştırması için).
  function foldTr(s) {
    return String(s || '')
      .replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/Ş/g, 'ş').replace(/Ğ/g, 'ğ')
      .replace(/Ü/g, 'ü').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç')
      .toLowerCase()
      .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g')
      .replace(/ü/g, 'u').replace(/ö/g, 'o');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function injectStyles() {
    if (document.getElementById('office-picker-styles')) return;
    const style = document.createElement('style');
    style.id = 'office-picker-styles';
    style.textContent = `
      .op-field{position:relative;}
      .op-btn{
        width:100%; text-align:left; padding:11px 14px; border-radius:10px; border:1px solid var(--line);
        background:var(--paper); font-family:inherit; font-size:14px; color:var(--ink); cursor:pointer;
        display:flex; align-items:center; justify-content:space-between; gap:8px;
      }
      .op-arrow{flex-shrink:0; opacity:0.5; transition:transform .15s ease;}
      .op-field.open .op-arrow{transform:rotate(180deg);}
      .op-panel{
        display:none; flex-direction:column; position:absolute; top:calc(100% + 6px); left:0; right:0; z-index:60;
        background:var(--paper-card); border:1px solid var(--line); border-radius:12px;
        box-shadow:0 12px 28px rgba(27,42,61,0.15); padding:8px; max-height:300px;
      }
      .op-field.open .op-panel{display:flex;}
      .op-search{
        border:1px solid var(--line); border-radius:8px; padding:8px 10px; font-family:inherit;
        font-size:13px; margin-bottom:6px; background:var(--paper); color:var(--ink); flex-shrink:0;
      }
      .op-options{overflow-y:auto;}
      .op-option{display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:8px; font-size:13.5px; color:var(--ink); cursor:pointer;}
      .op-option:hover{background:var(--paper-alt);}
      .op-option input{accent-color:var(--ink); width:14px; height:14px; flex-shrink:0;}
      .op-option-kind{margin-left:auto; flex-shrink:0; font-size:11px; font-weight:600; color:var(--ink-soft); letter-spacing:0.02em;}
      .op-empty{padding:12px; font-size:12.5px; color:var(--ink-soft); text-align:center;}
      /* Seçilenler düğmenin ALTINDA çıkarılabilir birer çip olarak durur — çoklu seçimde "kaç tane
         seçtim / hangileri" sorusunu paneli açmadan cevaplar. */
      .op-chips{display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;}
      .op-chips:empty{display:none;}
      .op-chip{
        display:inline-flex; align-items:center; gap:6px; padding:5px 8px 5px 10px; border-radius:100px;
        border:1px solid var(--line); background:var(--paper-alt); font-size:12.5px; color:var(--ink);
      }
      .op-chip button{
        border:none; background:none; padding:0; line-height:1; font-size:13px; color:var(--ink-soft); cursor:pointer;
      }
      .op-chip button:hover{color:var(--ink);}
    `;
    document.head.appendChild(style);
  }

  // Panel dışına tıklama + Escape — HER iki dinleyici de bir kez, delegasyonla bağlanır.
  // Escape CAPTURE fazında yakalanır: bu kutu ModalShell overlay'inin içinde de yaşıyor ve onun
  // bubble fazındaki document keydown dinleyicisi Escape'i görürse TÜM popup'ı kapatır (bkz.
  // js/components/auth-modal.js#closeAllAmDropdowns'taki AYNI gerçek bulgu/desen).
  let globalWired = false;
  function wireGlobalHandlers() {
    if (globalWired) return;
    globalWired = true;
    document.addEventListener('click', (e) => {
      document.querySelectorAll('.op-field.open').forEach(f => { if (!f.contains(e.target)) f.classList.remove('open'); });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const open = document.querySelector('.op-field.open');
      if (!open) return;
      e.stopPropagation();
      open.classList.remove('open');
    }, true);
  }

  // mount: içine kutunun render edileceği eleman.
  // opts.placeholder   — hiçbir şey seçili değilken düğmede yazan metin.
  // opts.searchLabel   — arama kutusunun placeholder'ı.
  // opts.input         — (opsiyonel) senkron tutulacak <input type="hidden">/<input>: değeri
  //                      virgülle ayrılmış seçim metnidir. kisi-ekle.html bunu kullanır, böylece o
  //                      sayfadaki mevcut TÜM okuma/yazma noktaları (#m-office.value) dokunulmadan
  //                      çalışmaya devam eder.
  // opts.onChange      — seçim değişince çağrılır (isim dizisiyle).
  function createOfficePicker(mount, opts) {
    const options = opts || {};
    const placeholder = options.placeholder || 'Firma veya marka seç';
    const searchLabel = options.searchLabel || 'Firma veya marka ara...';
    injectStyles();
    wireGlobalHandlers();

    mount.innerHTML = `
      <div class="op-field">
        <button type="button" class="op-btn">
          <span class="op-btn-label">${esc(placeholder)}</span>
          <svg class="op-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="op-panel">
          <input type="text" class="op-search" placeholder="${esc(searchLabel)}" autocomplete="off">
          <div class="op-options"><div class="op-empty">Yükleniyor…</div></div>
        </div>
        <div class="op-chips"></div>
      </div>`;

    const field = mount.querySelector('.op-field');
    const btn = mount.querySelector('.op-btn');
    const label = mount.querySelector('.op-btn-label');
    const search = mount.querySelector('.op-search');
    const list = mount.querySelector('.op-options');
    const chips = mount.querySelector('.op-chips');

    // Kaynak listeye ek olarak, seçili olup listede BULUNMAYAN adlar da (ör. eski serbest metin
    // girişleri, henüz onaylanmamış bir firma gönderisi) seçenek olarak korunur — aksi halde kutuyu
    // bir kez açıp kaydeden kullanıcı, mevcut firmasını sessizce KAYBEDERDİ.
    let items = [];
    let selected = [];
    let loaded = false;

    function selectedKeys() { return new Set(selected.map(foldTr)); }

    function allOptions() {
      const known = new Set(items.map(i => foldTr(i.name)));
      const extras = selected.filter(n => !known.has(foldTr(n))).map(n => ({ name: n, brand: 0, extra: true }));
      return [...extras, ...items];
    }

    function renderChips() {
      chips.innerHTML = selected.map(n =>
        `<span class="op-chip">${esc(n)}<button type="button" data-remove="${esc(n)}" aria-label="${esc(n)} seçimini kaldır">✕</button></span>`
      ).join('');
      chips.querySelectorAll('[data-remove]').forEach(b => {
        b.addEventListener('click', () => {
          const key = foldTr(b.dataset.remove);
          selected = selected.filter(n => foldTr(n) !== key);
          commit();
        });
      });
    }

    function renderLabel() {
      label.textContent = selected.length
        ? (selected.length === 1 ? selected[0] : `${selected.length} seçili`)
        : placeholder;
    }

    function renderList() {
      if (!loaded) { list.innerHTML = '<div class="op-empty">Yükleniyor…</div>'; return; }
      const q = foldTr(search.value.trim());
      const keys = selectedKeys();
      // Arama boşken TÜM liste basılır (kullanıcı isteği: "alt alta çoktan seçilebilir şekilde") —
      // 800 civarı satır tek innerHTML yazımıyla geliyor, panel kendi içinde kaydırılıyor.
      const shown = allOptions().filter(o => !q || foldTr(o.name).includes(q));
      if (!shown.length) { list.innerHTML = '<div class="op-empty">Sonuç bulunamadı.</div>'; return; }
      list.innerHTML = shown.map(o => `
        <label class="op-option">
          <input type="checkbox" value="${esc(o.name)}"${keys.has(foldTr(o.name)) ? ' checked' : ''}>
          <span>${esc(o.name)}</span>
          ${o.brand ? '<span class="op-option-kind">Marka</span>' : ''}
        </label>`).join('');
      list.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.addEventListener('change', () => {
          const key = foldTr(cb.value);
          if (cb.checked) { if (!selectedKeys().has(key)) selected.push(cb.value); }
          else selected = selected.filter(n => foldTr(n) !== key);
          // Liste yeniden çizilmez (kullanıcı arka arkaya birden çok seçim yapıyor olabilir,
          // kaydırma konumu ve panelin açıklığı korunmalı) — yalnızca dışarıdaki gösterimler.
          commitWithoutList();
        });
      });
    }

    function pushToInput() {
      if (!options.input) return;
      options.input.value = selected.join(', ');
    }

    function commitWithoutList() {
      renderLabel();
      renderChips();
      pushToInput();
      if (options.onChange) options.onChange(selected.slice());
    }

    function commit() {
      commitWithoutList();
      renderList();
    }

    btn.addEventListener('click', () => {
      const willOpen = !field.classList.contains('open');
      document.querySelectorAll('.op-field.open').forEach(f => f.classList.remove('open'));
      if (willOpen) {
        field.classList.add('open');
        renderList();
        search.focus();
      }
    });
    search.addEventListener('input', renderList);
    // Arama kutusunda Enter formu göndermemeli (kisi-ekle.html gerçek bir <form> içinde yaşıyor).
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });

    const ready = loadOfficeOptions().then(list => {
      items = list;
      loaded = true;
      renderList();
    });

    const api = {
      ready,
      get() { return selected.slice(); },
      getText() { return selected.join(', '); },
      set(names) {
        const seen = new Set();
        selected = (names || []).map(n => String(n || '').trim()).filter(n => {
          const key = foldTr(n);
          if (!n || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        commit();
      },
      // Virgüllü metinden yükle — architect_submissions.office'in depolama biçimi (bkz. dosya başı).
      setText(text) { api.set(String(text || '').split(',')); },
      // Bağlı input'un GÜNCEL değerinden yeniden yükle: kisi-ekle.html'in prefill fonksiyonları
      // hâlâ doğrudan #m-office.value'ya yazıyor, bu çağrı kutuyu o değere hizalar.
      syncFromInput() { if (options.input) api.setText(options.input.value); },
    };
    if (options.input) api.syncFromInput(); else commit();
    return api;
  }

  window.createOfficePicker = createOfficePicker;
})();
