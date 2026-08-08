// ConsultantAddModal — /danisman sidebar'ındaki "Danışman Ekle" butonuyla açılan pop-up başvuru
// formu (bkz. kullanıcı isteği). Yeni bir backend uç noktası GEREKMEZ: mevcut self-serve mimar
// gönderi akışını (POST /api/architects, bkz. src/routes/submissions.js#createSubmission) aynen
// kullanır, yalnızca ek bir consultant_request:true bayrağı + danışmanlığa özgü alanlar (uzmanlık
// etiketleri/saatlik ücret/seans süresi/haftalık müsaitlik, bkz. migrations/
// 0034_consultant_submission_fields.sql) gönderir. Diğer *-ekle.html sayfaları gibi ADMIN ONAYINA
// düşer (status='pending') — onaylanınca src/lib/canonicalSync.js#syncArchitect/applyConsultantFields
// architects.is_consultant=1 yazıp profili /danisman'da canlıya alır (bkz. kullanıcı isteği: "admin
// onayına düşsün"). Kutu sırası ve alanlar danisman-ekle.html'in Kişisel Bilgiler/Firmalar/
// Danışmanlık Bilgileri/Haftalık Müsaitlik/Fotoğraf sıralamasıyla BİREBİR AYNI (bkz. kullanıcı
// isteği: "pop-up ve sayfanın tasarımı aynı olsun").
const ConsultantAddModal = (function () {
  const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Pzt..Paz
  const WEEKDAY_LABELS = { 1: 'Pazartesi', 2: 'Salı', 3: 'Çarşamba', 4: 'Perşembe', 5: 'Cuma', 6: 'Cumartesi', 0: 'Pazar' };
  const MESLEK_OPTIONS = ['Mimar', 'İç Mimar', 'Peyzaj Mimarı', 'Şehir Plancısı', 'Restoratör', 'Tasarımcı', 'Öğrenci', 'Diğer'];
  const POZISYON_OPTIONS = ['Kurucu', 'Kurucu Ortak', 'Ortak', 'Ekip Lideri', 'Çalışan', 'Akademisyen', 'Freelance', 'Öğrenci', 'Emekli', 'İşsiz'];
  const ODUL_OPTIONS = ['Pritzker Mimarlık Ödülü', 'Ulusal Mimarlık Ödülleri', 'TürkSMD Mimarlık Ödülleri', 'Ağa Han Mimarlık Ödülü', 'EU Mies Award', 'World Architecture Festival Ödülleri', 'International Architecture Awards'];

  let overlayEl = null;
  let slotsWorking = [];
  let meslekDropdown = null;
  let pozisyonDropdown = null;
  let odullerDropdown = null;
  let selectedFiles = [];
  let existingPhotoUrl = null;
  let universitySuggestions = null; // lazy: ilk açılışta çekilir

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s === undefined || s === null ? '' : s;
    return d.innerHTML;
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function trLower(s) {
    return (s || '').replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/Ş/g, 'ş').replace(/Ğ/g, 'ğ').replace(/Ü/g, 'ü').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç').toLowerCase();
  }

  function injectStyles() {
    if (document.getElementById('consultant-add-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'consultant-add-modal-styles';
    style.textContent = `
      .cam-overlay{
        display:none; position:fixed; inset:0; z-index:200;
        background:rgba(27,42,61,0.55); backdrop-filter:blur(2px);
        align-items:center; justify-content:center; padding:20px;
      }
      .cam-overlay.open{display:flex;}
      .cam-modal{
        width:100%; max-width:520px; max-height:88vh; overflow-y:auto;
        background:var(--paper-card); border-radius:18px; padding:28px;
        position:relative; box-shadow:0 24px 60px rgba(27,42,61,0.35);
      }
      .cam-close{
        position:absolute; top:16px; right:16px; width:32px; height:32px; border-radius:50%;
        border:1px solid var(--line); background:var(--paper); color:var(--ink-soft);
        display:flex; align-items:center; justify-content:center;
      }
      .cam-close:hover{color:var(--ink); border-color:var(--walnut);}
      .cam-modal h2{font-family:'Inter', sans-serif; font-size:20px; font-weight:700; margin:0 0 6px;}
      .cam-modal p.cam-hint{font-size:12.5px; color:var(--ink-soft); margin:0 0 20px; line-height:1.6;}
      .cam-section-title{font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--ink); margin:22px 0 12px; padding-top:18px; border-top:1px solid var(--line);}
      .cam-section-title:first-of-type{margin-top:0; padding-top:0; border-top:none;}
      .cam-field{margin-bottom:16px;}
      .cam-label{display:block; font-size:12.5px; font-weight:700; color:var(--ink); margin-bottom:6px;}
      .cam-label small{font-weight:500; color:var(--ink-soft); text-transform:none;}
      .cam-field input[type=text], .cam-field input[type=number], .cam-field textarea, .cam-field select{
        width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:10px;
        background:var(--paper); font-family:inherit; font-size:13.5px; color:var(--ink); box-sizing:border-box;
      }
      .cam-field textarea{min-height:80px; resize:vertical;}
      .cam-row{display:grid; grid-template-columns:1fr 1fr; gap:12px;}
      .cam-dd-field{position:relative;}
      .cam-dd-btn{
        width:100%; text-align:left; padding:10px 12px; border-radius:10px; border:1px solid var(--line);
        background:var(--paper); font-family:inherit; font-size:13.5px; color:var(--ink);
        display:flex; align-items:center; justify-content:space-between; gap:8px; cursor:pointer; box-sizing:border-box;
      }
      .cam-dd-btn-arrow{flex-shrink:0; opacity:0.5; transition:transform .15s ease;}
      .cam-dd-field.open .cam-dd-btn-arrow{transform:rotate(180deg);}
      .cam-dd-panel{
        display:none; flex-direction:column; position:absolute; top:calc(100% + 6px); left:0; right:0; z-index:25;
        background:var(--paper-card); border:1px solid var(--line); border-radius:12px;
        box-shadow:0 12px 28px rgba(27,42,61,0.15); padding:8px; max-height:220px;
      }
      .cam-dd-field.open .cam-dd-panel{display:flex;}
      .cam-dd-options{overflow-y:auto;}
      .cam-dd-option{display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:8px; font-size:13px; color:var(--ink); cursor:pointer;}
      .cam-dd-option:hover{background:var(--paper-alt);}
      .cam-dd-option.selected{background:var(--paper-alt); font-weight:600;}
      .cam-dd-option input{accent-color:var(--ink); width:14px; height:14px; flex-shrink:0;}
      .cam-slots-days-grid{display:grid; grid-template-columns:1fr 1fr; gap:0 16px;}
      .cam-slots-day{margin-bottom:12px;}
      .cam-slots-day-label{font-size:12.5px; font-weight:700; color:var(--ink); margin-bottom:6px;}
      .cam-slots-times{display:flex; flex-wrap:wrap; gap:6px;}
      .cam-time-chip{display:inline-flex; align-items:center; gap:6px; padding:5px 10px; border-radius:100px; border:1px solid var(--line); background:var(--paper); font-size:12px; font-family:'IBM Plex Mono', monospace;}
      .cam-time-chip button{background:none; border:none; color:var(--ink-soft); padding:0; line-height:1; cursor:pointer;}
      .cam-time-chip button:hover{color:#B84C4C;}
      .cam-add-time-row{display:flex; gap:6px; margin-top:6px;}
      .cam-add-time-row input[type=time]{border:1px solid var(--line); border-radius:8px; padding:5px 8px; font-family:inherit; font-size:12px;}
      .cam-add-time-row button{background:none; border:1px solid var(--line); border-radius:8px; padding:5px 10px; font-size:12px; font-weight:600; color:var(--ink); cursor:pointer;}
      .cam-image-drop{display:block; border:2px dashed var(--line); border-radius:14px; padding:22px; text-align:center; color:var(--ink-soft); cursor:pointer; transition:border-color .15s ease, background .15s ease;}
      .cam-image-drop:hover, .cam-image-drop.dragover{border-color:var(--brass); background:var(--paper-alt);}
      .cam-image-drop svg{margin-bottom:6px; color:var(--brass);}
      .cam-image-drop strong{color:var(--ink); display:block; margin-bottom:2px; font-size:13px;}
      .cam-image-drop span{font-size:11.5px;}
      .cam-image-spec-hint{font-size:11px; color:var(--ink-soft); margin:8px 2px 0; line-height:1.5;}
      .cam-image-preview-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(80px,1fr)); gap:8px; margin-top:12px;}
      .cam-image-preview-item{position:relative; aspect-ratio:1/1; border-radius:10px; overflow:hidden; border:1px solid var(--line); background:var(--paper);}
      .cam-image-preview-item img{width:100%; height:100%; object-fit:cover;}
      .cam-image-preview-remove{position:absolute; top:4px; right:4px; width:20px; height:20px; border-radius:50%; background:rgba(27,42,61,0.75); color:#fff; border:none; display:flex; align-items:center; justify-content:center; font-size:11px; cursor:pointer;}
      .cam-submit-btn{width:100%; background:var(--ink); color:var(--paper-card); border:none; padding:14px; border-radius:100px; font-weight:600; font-size:15px; margin-top:22px; cursor:pointer;}
      .cam-submit-btn:hover{background:var(--walnut);}
      .cam-submit-btn:disabled{background:var(--paper-alt); color:var(--ink-soft); cursor:default;}
      .cam-notice{display:none; margin-top:14px; padding:12px 14px; border-radius:10px; background:rgba(224,138,62,0.12); border:1px solid var(--accent); color:var(--ink); font-size:12.5px; line-height:1.6;}
      .cam-notice.success{background:rgba(62,122,85,0.12); border-color:#3E7A55;}
      .cam-notice.show{display:block;}
      .cam-ac-field{position:relative;}
      .cam-ac-suggestions{
        display:none; position:absolute; top:calc(100% + 4px); left:0; right:0; z-index:25;
        background:var(--paper-card); border:1px solid var(--line); border-radius:10px;
        box-shadow:0 12px 28px rgba(27,42,61,0.15); max-height:220px; overflow-y:auto; padding:6px;
      }
      .cam-ac-suggestions.show{display:block;}
      .cam-ac-suggestion{padding:8px 10px; border-radius:8px; font-size:13.5px; color:var(--ink); cursor:pointer;}
      .cam-ac-suggestion:hover{background:var(--paper-alt);}
      .cam-ac-suggestion small{display:block; color:var(--ink-soft); font-size:11px; margin-top:1px;}
      @media (max-width:520px){ .cam-row{grid-template-columns:1fr;} .cam-slots-days-grid{grid-template-columns:1fr;} }
    `;
    document.head.appendChild(style);
  }

  function emptySlots() {
    return WEEKDAY_ORDER.map(weekday => ({ weekday, times: [] }));
  }

  function renderSlotsDays() {
    const container = document.getElementById('cam-slots-days');
    if (!container) return;
    container.innerHTML = slotsWorking.map(day => `
      <div class="cam-slots-day" data-weekday="${day.weekday}">
        <div class="cam-slots-day-label">${WEEKDAY_LABELS[day.weekday]}</div>
        <div class="cam-slots-times">
          ${day.times.map(t => `<span class="cam-time-chip">${escapeHtml(t)}<button type="button" data-remove-time="${escapeAttr(t)}">✕</button></span>`).join('') || '<span style="font-size:11.5px;color:var(--ink-soft);">Saat eklenmedi</span>'}
        </div>
        <div class="cam-add-time-row">
          <input type="time" class="cam-time-input">
          <button type="button" class="cam-add-time-btn">+ Saat Ekle</button>
        </div>
      </div>`).join('');
    container.querySelectorAll('.cam-slots-day').forEach(dayEl => {
      const weekday = parseInt(dayEl.dataset.weekday, 10);
      const day = slotsWorking.find(d => d.weekday === weekday);
      dayEl.querySelectorAll('[data-remove-time]').forEach(btn => {
        btn.addEventListener('click', () => {
          day.times = day.times.filter(t => t !== btn.dataset.removeTime);
          renderSlotsDays();
        });
      });
      dayEl.querySelector('.cam-add-time-btn').addEventListener('click', () => {
        const input = dayEl.querySelector('.cam-time-input');
        const val = input.value;
        if (!val || day.times.includes(val)) return;
        day.times.push(val);
        day.times.sort();
        renderSlotsDays();
      });
    });
  }

  // ---------- AÇILIR PANEL: tek seçimlik (Meslek, Pozisyon) — mimar-ekle.html#wireSingleDropdown
  // ile AYNI desen, cam- namespace'ine taşınmış ----------
  function closeAllDropdowns() {
    document.querySelectorAll('.cam-dd-field.open').forEach(f => f.classList.remove('open'));
  }
  function wireSingleDropdown(fieldId, btnId, labelId, optionsId, options, placeholderText) {
    const field = document.getElementById(fieldId);
    const btn = document.getElementById(btnId);
    const label = document.getElementById(labelId);
    const container = document.getElementById(optionsId);
    let selected = null;
    function render() {
      container.innerHTML = options.map(o => `<div class="cam-dd-option${o === selected ? ' selected' : ''}" data-value="${escapeAttr(o)}">${escapeHtml(o)}</div>`).join('');
      container.querySelectorAll('[data-value]').forEach(el => {
        el.addEventListener('click', () => {
          selected = el.dataset.value;
          label.textContent = selected;
          field.classList.remove('open');
          render();
        });
      });
    }
    btn.addEventListener('click', () => {
      const willOpen = !field.classList.contains('open');
      closeAllDropdowns();
      if (willOpen) field.classList.add('open');
    });
    render();
    return {
      get: () => selected,
      set(v) { selected = v || null; label.textContent = selected || placeholderText; render(); },
    };
  }
  // ---------- AÇILIR PANEL: çok seçimlik (Ödüller) — mimar-ekle.html#wireMultiDropdown ile AYNI ----------
  function wireMultiDropdown(fieldId, btnId, labelId, optionsId, options, name, placeholderText) {
    const field = document.getElementById(fieldId);
    const btn = document.getElementById(btnId);
    const label = document.getElementById(labelId);
    const container = document.getElementById(optionsId);
    container.innerHTML = options.map(o => `<label class="cam-dd-option"><input type="checkbox" name="${escapeAttr(name)}" value="${escapeAttr(o)}"> ${escapeHtml(o)}</label>`).join('');
    function updateLabel() {
      const checked = Array.from(field.querySelectorAll('input:checked')).map(i => i.value);
      label.textContent = checked.length ? (checked.length === 1 ? checked[0] : `${checked.length} seçili`) : placeholderText;
    }
    btn.addEventListener('click', () => {
      const willOpen = !field.classList.contains('open');
      closeAllDropdowns();
      if (willOpen) field.classList.add('open');
    });
    field.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', updateLabel));
    updateLabel();
    return {
      getChecked: () => Array.from(field.querySelectorAll('input:checked')).map(i => i.value),
    };
  }

  const TEMPLATE = `
    <div class="cam-modal">
      <button type="button" class="cam-close" id="cam-close" aria-label="Kapat">✕</button>
      <div id="cam-body"></div>
    </div>`;

  function loggedOutHtml() {
    return `
      <h2>Danışman Ekle</h2>
      <p class="cam-hint">Danışman profili başvurusu yapmak için önce giriş yapmalısın.</p>
      <a href="giris-yap.html" class="cam-submit-btn" style="display:block; text-align:center; text-decoration:none; box-sizing:border-box; margin-top:0;">Giriş Yap</a>`;
  }

  // Kutu sırası — danisman-ekle.html ile BİREBİR AYNI: Kişisel Bilgiler, Firmalar, Danışmanlık
  // Bilgileri, Haftalık Müsaitlik, Fotoğraf (bkz. kullanıcı isteği).
  function formHtml() {
    return `
      <h2>Danışman Ekle</h2>
      <p class="cam-hint">Bilgi gönderiminden sonra talep incelenecek, onaylandığında profilin yayına girecek.</p>

      <div class="cam-section-title">Kişisel Bilgiler</div>
      <div class="cam-field cam-ac-field" id="cam-name-field">
        <label class="cam-label" for="cam-name">Ad Soyad *</label>
        <input type="text" id="cam-name" maxlength="120" autocomplete="off">
        <div class="cam-ac-suggestions" id="cam-name-suggestions"></div>
      </div>
      <div class="cam-row">
        <div class="cam-field">
          <label class="cam-label" for="cam-dob">Doğum Yılı <small>(opsiyonel)</small></label>
          <input type="number" id="cam-dob" placeholder="ör. 1975" min="1000" max="2026" inputmode="numeric">
        </div>
        <div class="cam-field cam-ac-field" id="cam-school-field">
          <label class="cam-label" for="cam-school">Üniversite <small>(opsiyonel)</small></label>
          <input type="text" id="cam-school" placeholder="ör. MSGSÜ" autocomplete="off">
          <div class="cam-ac-suggestions" id="cam-school-suggestions"></div>
        </div>
      </div>
      <div class="cam-row">
        <div class="cam-field">
          <label class="cam-label">Meslek <small>(opsiyonel)</small></label>
          <div class="cam-dd-field" id="cam-dd-meslek">
            <button type="button" class="cam-dd-btn" id="cam-dd-meslek-btn">
              <span id="cam-dd-meslek-btn-label">Meslek seç</span>
              <svg class="cam-dd-btn-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="cam-dd-panel"><div class="cam-dd-options" id="cam-dd-meslek-options"></div></div>
          </div>
        </div>
        <div class="cam-field">
          <label class="cam-label">Ödüller <small>(opsiyonel)</small></label>
          <div class="cam-dd-field" id="cam-dd-oduller">
            <button type="button" class="cam-dd-btn" id="cam-dd-oduller-btn">
              <span id="cam-dd-oduller-btn-label">Ödül seç</span>
              <svg class="cam-dd-btn-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="cam-dd-panel"><div class="cam-dd-options" id="cam-dd-oduller-options"></div></div>
          </div>
        </div>
      </div>
      <div class="cam-field">
        <label class="cam-label" for="cam-about">Açıklama <small>(opsiyonel)</small></label>
        <textarea id="cam-about" maxlength="2000" placeholder="Danışmanlık/mentörlük olarak neler sunduğunu anlat..."></textarea>
      </div>

      <div class="cam-section-title">Firmalar</div>
      <div class="cam-row">
        <div class="cam-field">
          <label class="cam-label">Pozisyon <small>(opsiyonel)</small></label>
          <div class="cam-dd-field" id="cam-dd-pozisyon">
            <button type="button" class="cam-dd-btn" id="cam-dd-pozisyon-btn">
              <span id="cam-dd-pozisyon-btn-label">Pozisyon seç</span>
              <svg class="cam-dd-btn-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="cam-dd-panel"><div class="cam-dd-options" id="cam-dd-pozisyon-options"></div></div>
          </div>
        </div>
        <div class="cam-field cam-ac-field" id="cam-office-field">
          <label class="cam-label" for="cam-office">Varsa Firma Adı <small>(opsiyonel)</small></label>
          <input type="text" id="cam-office" maxlength="120" autocomplete="off">
          <div class="cam-ac-suggestions" id="cam-office-suggestions"></div>
        </div>
      </div>

      <div class="cam-section-title">Danışmanlık Bilgileri</div>
      <div class="cam-field">
        <label class="cam-label" for="cam-tags">Uzmanlık Alanları <small>(virgülle ayır, opsiyonel)</small></label>
        <input type="text" id="cam-tags" placeholder="ör. Portfolyo Mentörlüğü, Konut Mimarisi">
      </div>
      <div class="cam-row">
        <div class="cam-field">
          <label class="cam-label" for="cam-rate">Saatlik Ücret (₺) *</label>
          <input type="number" id="cam-rate" min="0" step="1">
        </div>
        <div class="cam-field">
          <label class="cam-label" for="cam-duration">Görüşme Süresi</label>
          <select id="cam-duration">
            <option value="30">30 dk</option>
            <option value="45" selected>45 dk</option>
            <option value="60">60 dk</option>
            <option value="90">90 dk</option>
          </select>
        </div>
      </div>
      <div class="cam-section-title">Haftalık Müsaitlik <small>(opsiyonel)</small></div>
      <div class="cam-slots-days-grid" id="cam-slots-days"></div>

      <div class="cam-section-title">Fotoğraf <small>(opsiyonel)</small></div>
      <label class="cam-image-drop" id="cam-image-drop">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/><polyline points="7 9 12 4 17 9"/><line x1="12" y1="4" x2="12" y2="16"/></svg>
        <strong>Fotoğrafı sürükleyip bırak</strong>
        <span>ya da bilgisayarından seçmek için tıkla</span>
        <input type="file" id="cam-image-input" accept="image/*" style="display:none;">
      </label>
      <p class="cam-image-spec-hint">Görsel 72 DPI çözünürlükte, min. 1.000–maks. 2.000 piksel genişliğinde ve en fazla 2 MB boyutunda olmalıdır.</p>
      <div class="cam-image-preview-grid" id="cam-image-preview-grid"></div>

      <button type="button" class="cam-submit-btn" id="cam-submit-btn">Başvuruyu Gönder</button>
      <div class="cam-notice" id="cam-notice"></div>`;
  }

  // proje-ekle.html'deki wireAutocompleteLive ile AYNI desen: canlı D1 aramasından (bkz.
  // src/routes/architect.js#handleArchitectSearchRoute, src/routes/office.js#handleOfficeSearchRoute)
  // beslenir, 300ms debounce, tek değerli alan (virgülle çoklu isim desteklenmiyor).
  function wireConsultantAutocomplete(inputId, suggestionsId, searchUrl, onSelect) {
    const input = document.getElementById(inputId);
    const box = document.getElementById(suggestionsId);
    let debounceTimer = null;
    let currentQuery = '';
    function close() { box.classList.remove('show'); box.innerHTML = ''; }
    function renderItems(items) {
      if (!items.length) { close(); return; }
      box.innerHTML = items.map((it, i) => `<div class="cam-ac-suggestion" data-index="${i}">${escapeHtml(it.label)}${it.sub ? `<small>${escapeHtml(it.sub)}</small>` : ''}</div>`).join('');
      box.classList.add('show');
      box.querySelectorAll('.cam-ac-suggestion').forEach((el, i) => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          input.value = items[i].label;
          close();
          if (onSelect) onSelect(items[i]);
        });
      });
    }
    function fetchSuggestions(q) {
      currentQuery = q;
      fetch(`${searchUrl}?q=${encodeURIComponent(q)}`)
        .then(res => res.ok ? res.json() : { items: [] })
        .then(data => { if (q === currentQuery) renderItems((data.items || []).slice(0, 8)); })
        .catch(() => {});
    }
    function onInput() {
      const q = input.value.trim();
      if (!q) { close(); currentQuery = ''; return; }
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => fetchSuggestions(q), 300);
    }
    input.addEventListener('input', onInput);
    input.addEventListener('focus', onInput);
    input.addEventListener('blur', () => setTimeout(close, 150));
  }

  // ---------- OTOMATİK TAMAMLAMA: Üniversite — mimar-ekle.html#wireAutocomplete ile AYNI desen,
  // canonical D1'den tek seferlik çekilen okul listesi (ilk açılışta lazy fetch edilir) ----------
  function wireStaticAutocomplete(inputId, suggestionsId, getItems) {
    const input = document.getElementById(inputId);
    const box = document.getElementById(suggestionsId);
    function close() { box.classList.remove('show'); box.innerHTML = ''; }
    function renderSuggestions() {
      const q = trLower(input.value.trim());
      if (!q) { close(); return; }
      const items = getItems().filter(it => trLower(it.label).includes(q)).slice(0, 8);
      if (!items.length) { close(); return; }
      box.innerHTML = items.map((it, i) => `<div class="cam-ac-suggestion" data-index="${i}">${escapeHtml(it.label)}</div>`).join('');
      box.classList.add('show');
      box.querySelectorAll('.cam-ac-suggestion').forEach((el, i) => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          input.value = items[i].label;
          close();
        });
      });
    }
    input.addEventListener('input', renderSuggestions);
    input.addEventListener('focus', renderSuggestions);
    input.addEventListener('blur', () => setTimeout(close, 150));
  }
  function ensureUniversitySuggestions() {
    if (universitySuggestions) return;
    universitySuggestions = [];
    fetch('/api/architects/schools').then(r => r.ok ? r.json() : { items: [] })
      .then(d => { universitySuggestions = (d.items || []).map(s => ({ label: s })); }).catch(() => {});
  }

  // ---------- Fotoğraf yükleme kutusu — mimar-ekle.html/danisman-ekle.html#dropZone ile AYNI ----------
  function renderPreviews() {
    const previewGrid = document.getElementById('cam-image-preview-grid');
    if (!previewGrid) return;
    if (selectedFiles.length) {
      previewGrid.innerHTML = selectedFiles.map((file, i) => {
        const url = URL.createObjectURL(file);
        return `<div class="cam-image-preview-item"><img src="${url}" alt=""><button type="button" class="cam-image-preview-remove" data-index="${i}" aria-label="Kaldır">✕</button></div>`;
      }).join('');
      previewGrid.querySelectorAll('.cam-image-preview-remove').forEach(btn => {
        btn.addEventListener('click', () => { selectedFiles.splice(parseInt(btn.dataset.index), 1); renderPreviews(); });
      });
    } else if (existingPhotoUrl) {
      previewGrid.innerHTML = `<div class="cam-image-preview-item"><img src="${escapeAttr(existingPhotoUrl)}" alt=""><button type="button" class="cam-image-preview-remove" id="cam-remove-existing-photo" aria-label="Kaldır">✕</button></div>`;
      document.getElementById('cam-remove-existing-photo').addEventListener('click', () => { existingPhotoUrl = null; renderPreviews(); });
    } else {
      previewGrid.innerHTML = '';
    }
  }
  function addFiles(fileList) {
    selectedFiles = Array.from(fileList).filter(f => f.type.startsWith('image/')).slice(0, 1);
    renderPreviews();
  }
  function wireImageDrop() {
    const dropZone = document.getElementById('cam-image-drop');
    const fileInput = document.getElementById('cam-image-input');
    selectedFiles = [];
    existingPhotoUrl = null;
    renderPreviews();
    fileInput.addEventListener('change', (e) => addFiles(e.target.files));
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); addFiles(e.dataTransfer.files); });
  }
  async function uploadFiles(files) {
    const urls = [];
    for (const file of files) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('context', 'architect');
      const res = await fetch('/api/uploads', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Görsel yüklenemedi.');
      urls.push(data.url);
    }
    return urls;
  }

  // Ad Soyad'dan var olan bir mimar seçilince profildeki bilgileri otomatik doldur — danisman-ekle.html#
  // prefillFromArchitect ile AYNI desen/uç nokta (bkz. kullanıcı isteği: "Eğer bir kişi ad soyad
  // kısmından bir mimar profilini seçerse bilgiler otomatik olarak mimar profilinden çekerek dolsun").
  async function prefillFromArchitect(name) {
    try {
      const res = await fetch(`/api/architect/${encodeURIComponent(name)}`);
      if (!res.ok) return;
      const payload = await res.json();
      const a = payload && payload.item;
      if (!a) return;
      if (a.dob) document.getElementById('cam-dob').value = String(a.dob).slice(0, 4);
      document.getElementById('cam-school').value = a.school || '';
      document.getElementById('cam-office').value = a.office || '';
      document.getElementById('cam-about').value = a.about || '';
      meslekDropdown.set(a.profession || null);
      pozisyonDropdown.set(a.role || null);
      odullerDropdown.setChecked(a.awards || []);
      existingPhotoUrl = a.photo || null;
      renderPreviews();
    } catch {}
  }

  function wireForm() {
    slotsWorking = emptySlots();
    renderSlotsDays();
    meslekDropdown = wireSingleDropdown('cam-dd-meslek', 'cam-dd-meslek-btn', 'cam-dd-meslek-btn-label', 'cam-dd-meslek-options', MESLEK_OPTIONS, 'Meslek seç');
    pozisyonDropdown = wireSingleDropdown('cam-dd-pozisyon', 'cam-dd-pozisyon-btn', 'cam-dd-pozisyon-btn-label', 'cam-dd-pozisyon-options', POZISYON_OPTIONS, 'Pozisyon seç');
    odullerDropdown = wireMultiDropdown('cam-dd-oduller', 'cam-dd-oduller-btn', 'cam-dd-oduller-btn-label', 'cam-dd-oduller-options', ODUL_OPTIONS, 'award', 'Ödül seç');
    document.getElementById('cam-submit-btn').addEventListener('click', submit);
    wireConsultantAutocomplete('cam-name', 'cam-name-suggestions', '/api/architects/search', (item) => prefillFromArchitect(item.label));
    wireConsultantAutocomplete('cam-office', 'cam-office-suggestions', '/api/offices/search');
    ensureUniversitySuggestions();
    wireStaticAutocomplete('cam-school', 'cam-school-suggestions', () => universitySuggestions || []);
    wireImageDrop();
  }

  async function submit() {
    const btn = document.getElementById('cam-submit-btn');
    const notice = document.getElementById('cam-notice');
    notice.classList.remove('show', 'success');
    const name = document.getElementById('cam-name').value.trim();
    const hourlyRateRaw = document.getElementById('cam-rate').value;
    if (!name) {
      notice.textContent = 'Ad Soyad zorunlu.';
      notice.classList.add('show');
      return;
    }
    if (!hourlyRateRaw) {
      notice.textContent = 'Saatlik ücret zorunlu.';
      notice.classList.add('show');
      return;
    }
    const availableSlots = slotsWorking.filter(d => d.times.length).map(d => ({
      weekday: d.weekday, times: d.times.map(time => ({ time, available: true })),
    }));
    const expertiseTags = document.getElementById('cam-tags').value.split(',').map(s => s.trim()).filter(Boolean);
    const dobRaw = document.getElementById('cam-dob').value;
    const dob = dobRaw ? String(dobRaw).slice(0, 4) : null;
    const school = document.getElementById('cam-school').value.trim();

    btn.disabled = true;
    btn.textContent = 'Gönderiliyor…';
    let photoUrl = existingPhotoUrl;
    try {
      if (selectedFiles.length) photoUrl = (await uploadFiles(selectedFiles))[0];
    } catch (err) {
      notice.textContent = err.message || 'Görsel yüklenemedi, tekrar dene.';
      notice.classList.add('show');
      btn.disabled = false; btn.textContent = 'Başvuruyu Gönder';
      return;
    }
    try {
      const res = await fetch('/api/architects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          position: pozisyonDropdown.get() || '',
          profession: meslekDropdown.get() || '',
          dob,
          school: school || null,
          awards: odullerDropdown.getChecked(),
          office: document.getElementById('cam-office').value.trim(),
          about: document.getElementById('cam-about').value.trim(),
          consultant_request: true,
          hourly_rate: Number(hourlyRateRaw),
          session_duration_min: Number(document.getElementById('cam-duration').value),
          expertise_tags: expertiseTags,
          available_slots: availableSlots,
          photo_url: photoUrl,
        }),
      });
      if (res.status === 401) { window.location.href = 'giris-yap.html'; return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        notice.textContent = data.error || 'Başvuru gönderilemedi, tekrar dene.';
        notice.classList.add('show');
        btn.disabled = false; btn.textContent = 'Başvuruyu Gönder';
        return;
      }
      document.getElementById('cam-body').innerHTML = `
        <h2>Başvurun alındı</h2>
        <p class="cam-hint">Danışman profili başvurun admin onayına düştü. Onaylandığında profilin /danisman'da yayına girecek — sonucu bildirimlerinden takip edebilirsin.</p>`;
    } catch {
      notice.textContent = 'Sunucuya ulaşılamadı, tekrar dene.';
      notice.classList.add('show');
      btn.disabled = false; btn.textContent = 'Başvuruyu Gönder';
    }
  }

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    injectStyles();
    const el = document.createElement('div');
    el.className = 'cam-overlay';
    el.id = 'cam-overlay';
    el.innerHTML = TEMPLATE;
    document.body.appendChild(el);
    overlayEl = el;
    el.addEventListener('click', (e) => { if (e.target === el) close(); });
    document.getElementById('cam-close').addEventListener('click', close);
    document.addEventListener('click', (e) => {
      document.querySelectorAll('.cam-dd-field.open').forEach(f => { if (!f.contains(e.target)) f.classList.remove('open'); });
    });
    return el;
  }

  function close() {
    if (overlayEl) overlayEl.classList.remove('open');
  }

  async function open() {
    const el = ensureOverlay();
    await savedWidgetReady;
    const body = document.getElementById('cam-body');
    if (!currentUser) {
      body.innerHTML = loggedOutHtml();
    } else {
      body.innerHTML = formHtml();
      wireForm();
    }
    el.classList.add('open');
  }

  return { open, close };
})();
