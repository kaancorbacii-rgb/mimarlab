// MİMARLAB — "Firma veya Marka" ÇOKLU SEÇİM kutusu (kullanıcı isteği, 2026-09-06 madde 1 ve 4):
// "Firma başlığı 'Firma veya Marka' olsun ve kullanıcı birden fazla seçenek seçebilsin ... en üste
// arama çubuğu koy" / "Kişi ekle/düzenle sayfasındaki Firma / Marka Adı yazan kutucukta çoktan
// seçilebilir olsun. Burada sitede yüklü tüm firmalar ve markalar alt alta çoktan seçilebilir
// şekilde güncellensin. En üstte de arama çubuğu olsun."
//
// GENELLEŞTİRİLDİ (kullanıcı isteği, 2026-09-15 beşinci tur madde 2: "proje ekle/düzenle sayfasında
// firma seçiminde yaptığın gibi mimar seçiminde de siteye yüklü kişiler arasından çoklu seçim
// yapılabilsin, ayrıca manuel olarak elle de giriş yapılabilsin"). Gövde (createNamePicker) artık
// kaynağa bağlı değil; iki sarmalayıcı aynı davranışı iki uca bağlar:
//   * createOfficePicker    -> GET /api/offices/names    (firmalar)
//   * createArchitectPicker -> GET /api/architects/names (kişiler, bkz. src/routes/architect.js)
// Mimar kutusu için ikinci bir dosya AÇILMADI: istek birebir "firma seçiminde yaptığın gibi" idi ve
// iki kopya, çoklu seçim/arama/elle ekleme/Türkçe katlamayla tekilleştirme davranışının zamanla
// ayrışacağı tek yer olurdu.
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
  const OFFICE_OPTIONS_URL = '/api/offices/names';
  // KİŞİ kaynağı (kullanıcı isteği, 2026-09-15 beşinci tur madde 2: "firma seçiminde yaptığın gibi
  // mimar seçiminde de siteye yüklü kişiler arasından çoklu seçim yapılabilsin, ayrıca manuel
  // olarak elle de giriş yapılabilsin") — bkz. src/routes/architect.js#handleArchitectNamesRoute.
  const ARCHITECT_OPTIONS_URL = '/api/architects/names';
  // ÜNİVERSİTE kaynağı (kullanıcı isteği, 2026-09-16 altıncı tur madde 4: "Kişi ekle sayfasındaki
  // üniversiteler de çoktan seçmeli olsun. Kişi isterse birden fazla seçebilsin, listeye kendi de
  // manuel olarak bir üniversite yazabilsin") — sitedeki DÖRT üniversite kutusunun ZATEN ortak
  // kaynağı (bkz. src/routes/architect.js#handleArchitectSchoolsRoute: YÖK listesi + D1'de gerçekten
  // girilmiş okulların birleşimi). O uç adları DÜZ METİN dizisi olarak döner, bu yüzden loadOptions
  // string öğeleri de kabul eder (aşağısı).
  const SCHOOL_OPTIONS_URL = '/api/architects/schools';
  // URL başına TEK istek — aynı sayfada iki kutu (Mimar + Firma) yaşadığından önbellek artık tek
  // bir değişken değil, kaynak adresine göre anahtarlı bir harita.
  const optionsPromises = new Map();
  // Kutu örneklerini birbirinden ayıran sayaç (bkz. singleGroupName).
  let pickerSeq = 0;

  // Bir kaynaktaki tüm adlar — modülün ömrü boyunca TEK istek (kutu her açıldığında yeniden
  // çekilmez; auth-modal.js#allOfficeNamesPromise'in AYNI gerekçesi).
  function loadOptions(url) {
    if (!optionsPromises.has(url)) {
      optionsPromises.set(url, fetch(url)
        .then(r => (r.ok ? r.json() : { items: [] }))
        // DÜZ METİN ÖĞELER de kabul edilir: /api/architects/schools yanıtı {items:["A","B"]}
        // biçiminde (bkz. SCHOOL_OPTIONS_URL). Ad/firma uçları {items:[{name,...}]} döndürmeye
        // devam ediyor; normalizasyon burada yapılır ki gövdenin tamamı tek bir şekil görsün.
        .then(d => (d.items || []).map(i => (typeof i === 'string' ? { name: i } : i)).filter(i => i && i.name))
        .catch(() => []));
    }
    return optionsPromises.get(url);
  }

  // BİRDEN FAZLA KAYNAK, TEK LİSTE (kullanıcı isteği, 2026-09-15 yedinci tur madde 4: "fotoğrafçı
  // seçimi de ... kişi listesinden ya da manuel olarak yazma şeklinde olsun ... ama burada
  // firmalardan da seçim olabilsin çünkü fotoğrafçı bir kişi de olabilir firmada. Ama hepsi aynı
  // listenin içinde olsun ayrı bir kutucuk olarak ayırma.").
  // Kaynaklar AYRI AYRI önbelleklenir (yukarıdaki loadOptions), yani /api/architects/names zaten
  // Mimar kutusu için çekilmişse ikinci kez istenmez. Birleşimde Türkçe katlamayla tekilleştirme
  // yapılır — aynı ad hem kişi hem firma olarak kayıtlıysa (bu depoda mümkün, bkz. proje notu
  // "Duplicate name key limitation") listede TEK satır görünür; seçim zaten ADLA taşındığından
  // iki satırın birbirinden farkı olmazdı.
  function loadMergedOptions(urls) {
    return Promise.all(urls.map(loadOptions)).then(lists => {
      const seen = new Set();
      const out = [];
      for (const list of lists) {
        for (const item of list) {
          const key = foldTr(item.name);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          out.push(item);
        }
      }
      return out.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    });
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
      /* Elle firma ekleme satırı (bkz. allowCustom) — seçeneklerle AYNI satır yüksekliği/dolgusu,
         ama bir <button>: tıklanınca yazılan adı seçime katar. Marka etiketi (.op-option-kind)
         KALDIRILDI (kullanıcı isteği, 2026-09-15 madde 4): marka kavramı sitede yok, listedeki her
         satır bir firmadır. */
      .op-option-add{width:100%; text-align:left; background:none; border:1px dashed var(--line); font-family:inherit; font-weight:600; color:var(--walnut); margin-bottom:4px;}
      .op-option-add:hover{background:var(--paper-alt); color:var(--ink);}
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
  // opts.allowCustom   — true ise arama kutusuna yazılan, listede KARŞILIĞI OLMAYAN bir ad "+ «...»
  //                      ekle" satırıyla seçime katılabilir (kullanıcı isteği, 2026-09-15 madde 3 —
  //                      proje-ekle.html). Varsayılan KAPALI: kişi künyesindeki firma kutusu (kisi-ekle
  //                      + Hesabım) sitede kayıtlı firmalara bağlanmak içindir, orada serbest metin
  //                      firma talebi/üyelik zincirini (bkz. claimedProfiles.js#ensurePendingOfficeClaims)
  //                      karşılığı olmayan bir adla doldururdu.
  //
  // GENEL AD KUTUSU (2026-09-15, beşinci tur): gövde artık kaynağa bağlı değil — opts.optionsUrl
  // hangi uçtan besleneceğini söyler. İki hazır sarmalayıcısı var: createOfficePicker (firmalar) ve
  // createArchitectPicker (kişiler). Mimar kutusu için ayrı bir bileşen YAZILMADI çünkü istek
  // birebir "firma seçiminde yaptığın gibi" idi; iki kopya, davranışın (çoklu seçim, arama, elle
  // ekleme, Türkçe katlamayla tekilleştirme) zamanla ayrışacağı TEK yer olurdu.
  function createNamePicker(mount, opts) {
    const options = opts || {};
    // optionsUrls (dizi) verilirse kaynaklar tek listede birleşir; yoksa tek kaynak.
    const optionsUrls = Array.isArray(options.optionsUrls) && options.optionsUrls.length
      ? options.optionsUrls
      : [options.optionsUrl || OFFICE_OPTIONS_URL];
    // TEK SEÇİM (opts.single): kutunun taşıdığı alan şema gereği tek değerliyse kullanılır —
    // bugün yalnızca urun-ekle.html'in "Firma" kutusu (products.brand_office_id TEK kolondur ve
    // /urun marka filtresi, ürün pop-up'ının marka çipi, products.brand_name_raw hep o tek değeri
    // okur). Seçenekler yine aynı panel/arama/elle-ekleme davranışını taşır, yalnızca yeni seçim
    // eskisinin YERİNE geçer.
    const single = !!options.single;
    // Radio grubu adı ÖRNEĞE ÖZEL: sabit bir ad kullanılsaydı aynı sayfadaki iki tek-seçimli kutu
    // tek bir radio grubu olur, birinden seçim yapmak diğerininkini sessizce iptal ederdi.
    const singleGroupName = `op-single-${++pickerSeq}`;
    // Etiketler "Firma veya marka" -> "Firma" (kullanıcı isteği, 2026-09-14 madde 2 ve 4): marka
    // kavramı sitede kaldırıldı, ürün üreten kayıtlar artık "Üretim ve Satış" hizmet alanlı
    // FİRMALAR (bkz. office-kind.js). Kutunun beslendiği uç (/api/offices/search) DEĞİŞMEDİ —
    // aynı offices satırları listelenmeye devam ediyor, yalnızca ekrandaki dil tek kelimeye indi.
    const placeholder = options.placeholder || 'Firma seç';
    const searchLabel = options.searchLabel || 'Firma ara...';
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

    // PANEL AÇILMADAN LİSTE BASILMAZ (2026-09-16 altıncı tur madde 2 — ölçülerek eklendi).
    // Liste DOM'a tek innerHTML yazımıyla girer ama seçenek başına iki eleman (label + input)
    // oluşuyor: yıl kutusunda 2027 seçenek = ~4000 eleman, proje-ekle'de İKİ yıl kutusu var.
    // Ölçüm (Chromium, 390px): kapalı panellerin listesini basmak renderDateRows()'u 46 ms'ye
    // çıkarıyordu ve sayfa açılışına ~8000 gereksiz düğüm ekliyordu — kullanıcı kutuyu hiç
    // açmadan. Bayrak, ilk açılışa kadar çizimi tamamen erteler; açıldıktan sonra renderList
    // eskisi gibi HER seçimde/aramada çalışır (kutu içeriği canlı kalır).
    let listOpened = false;
    function renderList() {
      if (!listOpened) return;
      renderListNow();
    }
    function renderListNow() {
      if (!loaded) { list.innerHTML = '<div class="op-empty">Yükleniyor…</div>'; return; }
      const q = foldTr(search.value.trim());
      const keys = selectedKeys();
      // Arama boşken TÜM liste basılır (kullanıcı isteği: "alt alta çoktan seçilebilir şekilde") —
      // 800 civarı satır tek innerHTML yazımıyla geliyor, panel kendi içinde kaydırılıyor.
      const shown = allOptions().filter(o => !q || foldTr(o.name).includes(q));
      // ELLE FİRMA EKLEME (kullanıcı isteği, 2026-09-15 madde 3: "proje ekle sayfasında firma seçim
      // kısmına manuel olarak da sitede kayıtlı olmasa dahi firma ismi girilebilsin"). Yalnızca
      // allowCustom veren çağıran (bugün proje-ekle.html) için: aranan metin hiçbir kayıtla TAM
      // eşleşmiyorsa listenin başına "…ekle" satırı çıkar. Seçim, listede olmayan adları zaten
      // koruyan `extras` yoluna düşer (bkz. allOptions) — yani ek bir durum/alan gerekmez.
      // Ad künyeye yazıldığı gibi kaydedilir; eşleşen bir firma kaydı yoksa profil bağlantısı
      // kurulmaz ama isim künyede ve filtrelerde görünür (bkz. migrations/
      // 0120_project_designer_names_raw.sql).
      const typed = search.value.trim();
      const canAddTyped = !!(options.allowCustom && typed
        && !allOptions().some(o => foldTr(o.name) === foldTr(typed))
        && !keys.has(foldTr(typed)));
      const addRow = canAddTyped
        ? `<button type="button" class="op-option op-option-add" data-add="${esc(typed)}">+ &laquo;${esc(typed)}&raquo; ekle</button>`
        : '';
      if (!shown.length && !addRow) { list.innerHTML = '<div class="op-empty">Sonuç bulunamadı.</div>'; return; }
      list.innerHTML = addRow + shown.map(o => `
        <label class="op-option">
          <input type="${single ? 'radio' : 'checkbox'}"${single ? ` name="${singleGroupName}"` : ''} value="${esc(o.name)}"${keys.has(foldTr(o.name)) ? ' checked' : ''}>
          <span>${esc(o.name)}</span>
        </label>`).join('');
      const addBtn = list.querySelector('[data-add]');
      if (addBtn) {
        addBtn.addEventListener('click', () => {
          const name = addBtn.dataset.add;
          if (single) selected = [name];
          else if (!selectedKeys().has(foldTr(name))) selected.push(name);
          search.value = '';
          commit();          // liste yeniden çizilir: yeni ad artık `extras` içinde ve işaretli
          search.focus();
        });
      }
      list.querySelectorAll('input[type=checkbox], input[type=radio]').forEach(cb => {
        cb.addEventListener('change', () => {
          const key = foldTr(cb.value);
          // Tek seçimde yeni seçim eskisinin YERİNE geçer; panel de kapanır (seçilecek ikinci bir
          // şey yok, açık kalması yalnızca kullanıcıyı bekletirdi).
          if (single) {
            selected = cb.checked ? [cb.value] : [];
            commitWithoutList();
            field.classList.remove('open');
            return;
          }
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
      const next = selected.join(', ');
      if (options.input.value === next) return;
      options.input.value = next;
      // GERÇEK BULGU (2026-09-15, yedinci tur): bağlı input artık type="hidden" ve ona programatik
      // `.value =` ATAMASI hiçbir olay tetiklemez — o input'u dinleyen mevcut kodlar sessizce
      // çalışmaz olurdu (ör. urun-ekle.html'deki DuplicateNameCheck, Firma kutusunu 'input'/'blur'
      // ile izliyor). Kutu değeri her yazdığında olayı KENDİSİ yayar, böylece "gizli input +
      // picker" deseni, yerini aldığı görünür metin kutusuyla aynı sözleşmeyi taşır.
      options.input.dispatchEvent(new Event('input', { bubbles: true }));
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
        listOpened = true;
        renderListNow();
        search.focus();
      }
    });
    search.addEventListener('input', renderList);
    // Arama kutusunda Enter formu göndermemeli (kisi-ekle.html gerçek bir <form> içinde yaşıyor).
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      // Enter, açık duran "+ «...» ekle" satırına basmakla aynı şeyi yapar (allowCustom'suz
      // çağıranlarda böyle bir satır hiç çizilmediğinden davranış eskisi gibi: yalnızca engelle).
      const addBtn = list.querySelector('[data-add]');
      if (addBtn) addBtn.click();
    });

    // STATİK LİSTE (opts.items): kaynağı bir uç OLMAYAN kutular için — bugün yalnızca yıl kutuları
    // (bkz. createYearPicker). İki farkı var ve ikisi de kasıtlı: (1) hiç fetch yapılmaz, (2) sıra
    // ÇAĞIRANIN verdiği sıradır — loadMergedOptions'ın localeCompare sıralaması yıllarda yanlış
    // olurdu ("10", "2"den önce gelir).
    const staticItems = Array.isArray(options.items)
      ? options.items.map(i => (typeof i === 'string' ? { name: i } : i)).filter(i => i && i.name)
      : null;
    const ready = (staticItems ? Promise.resolve(staticItems) : loadMergedOptions(optionsUrls)).then(list => {
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
        if (single) selected = selected.slice(0, 1);
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

  // "BU KİŞİ HANGİ FİRMA/MARKALARDA GÖREVLİ?" — İKİ YÜZEYİN ORTAK CEVABI (kullanıcı isteği,
  // 2026-09-08: "Bir kişi bir firma veya markaya admin tarafından dahi olsa görevlendiriliyorsa
  // [kişi ekle/düzenle] sayfasında da profilini düzenle sayfasında olduğu gibi firma ve marka
  // bilgileri gözüksün ... iki sayfa birbiriyle entegre, aynı bilgilere sahip olsun").
  //
  // GERÇEK BULGU: bir kişinin firma bağı DÖRT ayrı yerde yaşıyor ve iki sayfa bunların FARKLI alt
  // kümelerini okuyordu — "MİMARLAB Robotu" Profili Düzenle'de iki firma görürken kisi-ekle.html'de
  // kutu boş açılıyordu:
  //   1. kişi kaydının virgüllü `office` metni (architect_submissions.office / canonical item.office —
  //      ikincisi yalnızca BİRİNCİL firmayı, architects.office_id'yi döndürür, bkz. src/routes/
  //      architect.js#buildArchitectPayload);
  //   2. office_founders bağları — admin ya da firma yetkilisi kişiyi firmanın Kurucular/Ekip kutusuna
  //      yazdığında oluşur, kişi kaydının `office` alanına HİÇ yazılmaz (/api/architect/:key yanıtının
  //      üst düzey `offices` dizisi; kişinin kendi hesabı için /api/claims/mine -> officeLinks);
  //   3. profile_claims('office') satırları — ARTIK KAYNAK DEĞİL, bkz. aşağıdaki KALDIRILDI notu.
  // Bu fonksiyon (1) ve (2)'yi TEK listeye indirger; hem kisi-ekle.html'in ön-doldurma yolları hem
  // js/components/auth-modal.js#prefillFirmaSelect başka bir şey okumaz. Sıra: kişi kaydının kendi
  // metni önce (ilk ad canonicalSync#syncArchitect'te "birincil firma" olur, o yüzden korunur),
  // sonra kanonik founders bağları, en son hesabın officeLinks'i. Tekilleştirme Türkçe casefold ile
  // ("MİMARLAB" ↔ "Mimarlab" tek çip).
  //
  // KALDIRILDI — profile_claims('office') (kullanıcı bildirimi, 2026-09-14: "Birçok firmada Yönetici
  // rolünde olan warchdb@gmail.com hesabıyla Kaan Çorbacı profilini düzenledim ve otomatik olarak o
  // hesabın yönetici olduğu diğer 2 firma Kaan Çorbacı'nın profilinde gözükmeye başladı. Ben böyle
  // bir ekleme yapmadım, bu sorunu kökten çöz").
  //
  // KÖK NEDEN: bu liste bir zamanlar hesabın onaylı/beklemedeki TÜM ofis taleplerini de içeriyordu.
  // Oysa bir profile_claims('office') satırı GÖREV BEYANI DEĞİL, yalnızca YETKİDİR — atama anında
  // dondurulan değer her zaman 'Yönetici'dir ve bu bilinçli olarak künyeye hiç yazılmaz (bkz.
  // src/routes/admin.js#normalizeOfficePosition: "atama artık bir ünvan değil, yalnızca yetkidir ...
  // firma pop-up'ının Kurucular/Ekip listelerinde görünmez", src/routes/office.js#buildOfficePeople).
  // Yani "bu hesap bu firmanın içeriklerini yönetebilir" bilgisi, kutuya "bu KİŞİ bu firmada
  // görevlidir" diye yazılıyordu. Sonuç bir DÖNGÜYDÜ: n firmanın yöneticisi olan bir hesap herhangi
  // bir kişi profilini (kendi profili dahil) açtığında kutu o n firmayla ön-doluyor, Kaydet o metni
  // architect_submissions.office'e yazıyor, canonicalSync#syncArchitect her adı office_founders'a
  // bağlıyor (yönetici zaten ONAYLI talebe sahip olduğundan splitAdminApprovedOffices kapısı da
  // açık) ve firmalar kişinin pop-up'ında "Firma" olarak beliriyordu — kullanıcı hiçbir seçim
  // yapmadan. Kutuda kalan iki kaynak da YAPISAL bağlardır (kişinin kendi kaydındaki metin +
  // office_founders), yani yalnızca birinin gerçekten o kişiyi firmaya bağladığı durumda dolarlar.
  //
  // Bu, 2026-09-08'deki "admin atamasıyla gelen firma da kutuda görünsün" isteğini BOZMAZ: admin bir
  // kişiyi bir firmanın Kurucular/Ekip kutusuna yazdığında oluşan bağ office_founders satırıdır ve o
  // hâlâ (2) üzerinden okunur. Kaybolan tek şey, kişiyle hiçbir yapısal bağı olmayan salt yetki
  // satırıydı. Kullanıcının kendi seçtiği (henüz onaylanmamış) firmalar da kaybolmaz: seçim aynı
  // Kaydet'te kişi kaydının `office` metnine yazılır (bkz. kisi-ekle.html#payload.office ve
  // auth-modal.js#submitArchitectSyncIfNeeded), yani (1) üzerinden geri okunur.
  //
  // Kaydetme tarafında bu birleşim GÜVENLİDİR: canonicalSync#syncOfficeFounderLink form metninde
  // OLMAYAN bağları siler — yani admin'in office_founders'a eklediği bir firmanın kutuda görünmemesi
  // yalnızca kozmetik bir eksik değildi, kullanıcı formu kaydettiği anda o atama sessizce siliniyordu.
  // Birleşim sayesinde kaydedilen metin admin atamasını da taşır.
  //
  // src.officeTexts  — virgüllü metinler (kayıt alanları), src.offices — /api/architect/:key `offices`
  // (unregistered olanlar atlanır: picker yalnızca kayıtlı adları listeler), src.officeLinks —
  // /api/claims/mine officeLinks. src.claims KABUL EDİLMEZ (bkz. yukarıdaki KALDIRILDI notu) —
  // verilse bile yok sayılır ki eski bir çağıran sessizce döngüyü geri getirmesin.
  function mergeOfficeMembershipNames(src) {
    const s = src || {};
    const out = [];
    const seen = new Set();
    const push = (n) => {
      const t = String(n == null ? '' : n).trim();
      if (!t) return;
      const key = foldTr(t);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(t);
    };
    (s.officeTexts || []).forEach(txt => String(txt == null ? '' : txt).split(',').forEach(push));
    (s.offices || []).forEach(o => { if (o && !o.unregistered) push(o.name); });
    (s.officeLinks || []).forEach(l => push(l && l.name));
    return out;
  }

  // Firma kutusu — üç çağıranı var: kisi-ekle.html, js/components/auth-modal.js, proje-ekle.html.
  function createOfficePicker(mount, opts) {
    return createNamePicker(mount, { ...(opts || {}), optionsUrl: OFFICE_OPTIONS_URL });
  }

  // KİŞİ (Mimar) kutusu — bugün TEK çağıranı proje-ekle.html'dir (kullanıcı isteği, 2026-09-15
  // beşinci tur madde 2). Varsayılan etiketleri firma sürümünden ayrıdır; gerisi (allowCustom,
  // input senkronu, onChange) AYNI sözleşmedir.
  //
  // AYNI AD İKİ KEZ YAZILAMAZ (aynı isteğin 3. maddesi: "bir projede aynı isim mimar kutucuğuna
  // 2 kere yazılamasın ... Türkçe ve İngilizce karakterler farklı olduğu için yazılabilmiş ama
  // bunu da engelle") — bu kutunun tekilleştirmesi ZATEN foldTr üzerinden çalışıyor, yani
  // "Ayça Akkaya Kul" ile "Ayca Akkaya Kul" tek anahtara düşer ve ikincisi seçime hiç katılmaz.
  // Serbest metin girişi de aynı kapıdan geçer (bkz. renderList#canAddTyped ve api.set).
  function createArchitectPicker(mount, opts) {
    return createNamePicker(mount, {
      placeholder: 'Kişi seç',
      searchLabel: 'Kişi ara...',
      ...(opts || {}),
      optionsUrl: ARCHITECT_OPTIONS_URL,
    });
  }

  // KİŞİ + FİRMA, TEK LİSTE — proje-ekle.html'in "Fotoğrafçı" kutusu (kullanıcı isteği, 2026-09-15
  // yedinci tur madde 4). Fotoğrafçı bir kişi de olabilir bir firma da olabilir ve kullanıcı hangisi
  // olduğunu ayırmak zorunda bırakılmamalı; bu yüzden TEK kutu, iki kaynağın birleşimi (bkz.
  // loadMergedOptions). Sunucu tarafında bu zaten böyleydi: künyedeki "Fotoğraf" satırı hem
  // architects hem offices eşleşmelerini gösterir (bkz. src/routes/project.js#photographerDetails +
  // photographerOffices) — kutu yalnızca o gerçeğe uydu.
  function createPersonOrOfficePicker(mount, opts) {
    return createNamePicker(mount, {
      placeholder: 'Kişi ya da firma seç',
      searchLabel: 'Kişi ya da firma ara...',
      ...(opts || {}),
      optionsUrls: [ARCHITECT_OPTIONS_URL, OFFICE_OPTIONS_URL],
    });
  }

  // ÜNİVERSİTE kutusu (madde 4). allowCustom AÇIK: kullanıcı isteği "listeye kendi de manuel
  // olarak bir üniversite yazabilsin" — yurt dışı kurumları ve YÖK listesinde olmayan okullar bu
  // yoldan girilir (uç zaten D1'de girilmiş okulları da döndürdüğü için bir sonraki kullanıcıya
  // liste öğesi olarak görünürler). Seçim ÇOKLUDUR (single verilmez): architects.school virgüllü
  // tek bir metindir ve okuyan her yüzey (kişi pop-up'ı künyesi, /kisi Üniversite filtresi,
  // /api/architects/schools) o biçimi parçalarına ayırır.
  function createSchoolPicker(mount, opts) {
    return createNamePicker(mount, {
      placeholder: 'Üniversite seç veya yaz',
      searchLabel: 'Üniversite ara ya da yaz...',
      allowCustom: true,
      ...(opts || {}),
      optionsUrl: SCHOOL_OPTIONS_URL,
    });
  }

  // YIL kutusu (kullanıcı isteği, 2026-09-16 altıncı tur madde 2: "tarih kısmında tarih listeden
  // seçilebilir olsun. 2 kutucukta da sadece birer tane tarih seçilebilsin. Tarihleri MÖ
  // seçeneğinden başlat ve 1'den günümüze kadar getir" + "Ürün ekle sayfasındaki yıl kutucuğunda
  // da aynı mantık olsun ama oradaki tarihleri 1299'dan başlat").
  //   from    — listenin başladığı yıl (proje: 1, ürün: 1299)
  //   bc      — true ise listenin SON öğesi "MÖ" olur (yalnızca proje tarafında; bkz. aşağıdaki
  //             AZALAN sıra notu — sekizinci turda liste tersine döndüğü için "MÖ" de sona geçti)
  // SIRA AZALAN — GÜNÜMÜZDEN GEÇMİŞE (kullanıcı isteği, 2026-09-16 sekizinci tur madde 4: "açılan
  // tarihler günümüzden geçmişe doğru olsun ... Ürün sayfasındaki Yıl kutucuğunda da tarihler
  // günümüzden eskiye doğru olsun"). Altıncı turda liste ARTAN'dı (MÖ, 1, 2, ... bugün), yani
  // gerçekte kullanılan yılların hepsi listenin en DİBİNDE kalıyordu. Kapsam (from ... bugün)
  // DEĞİŞMEDİ, yalnızca yön döndü.
  // "MÖ" artık listenin SON öğesidir: azalan sıralamada en eski değer en sona düşer — MÖ, from'dan
  // da eskisini ifade ettiğinden başta durması sırayı bozardı.
  // Arama kutusu zaten açık olduğundan ("2024" yazmak tek satıra indirir) uzun liste bir sorun değil.
  // single: TEK seçim — "2 kutucukta da sadece birer tane tarih seçilebilsin".
  // allowCustom AÇIK ve BU BİR VERİ KORUMASIDIR, kolaylık değil: canlı veride "MÖ 5500-3500",
  // "19. yy", "4-5. yüzyıl" gibi künyeler var (bkz. src/routes/project.js#parseProjectDateYear) ve
  // kutu bunları listede bulamazdı. createNamePicker seçili-ama-listede-olmayan değerleri zaten
  // seçenek olarak KORUR (bkz. allOptions/extras), yani var olan bir kaydı düzenleyen kullanıcı
  // tarihini kaybetmez; allowCustom aynı biçimi YENİ kayıtlarda da yazılabilir tutar.
  const YEAR_BC_OPTION = 'MÖ';
  function yearOptionList(from, bc) {
    const now = new Date().getFullYear();
    const out = [];
    for (let y = now; y >= from; y--) out.push(String(y));
    if (bc) out.push(YEAR_BC_OPTION);
    return out;
  }
  function createYearPicker(mount, opts) {
    const o = opts || {};
    return createNamePicker(mount, {
      placeholder: 'Yıl seç',
      searchLabel: 'Yıl ara ya da yaz...',
      allowCustom: true,
      ...o,
      single: true,
      items: yearOptionList(o.from || 1, !!o.bc),
    });
  }

  window.createNamePicker = createNamePicker;
  window.createSchoolPicker = createSchoolPicker;
  window.createYearPicker = createYearPicker;
  window.createPersonOrOfficePicker = createPersonOrOfficePicker;
  window.createOfficePicker = createOfficePicker;
  window.createArchitectPicker = createArchitectPicker;
  window.mergeOfficeMembershipNames = mergeOfficeMembershipNames;
})();
