// ConsultantAddModal — /danisman sidebar'ındaki "Danışman Ekle" butonuyla açılan pop-up başvuru
// formu (bkz. kullanıcı isteği). Yeni bir backend uç noktası GEREKMEZ: mevcut self-serve mimar
// gönderi akışını (POST /api/architects, bkz. src/routes/submissions.js#createSubmission) aynen
// kullanır, yalnızca ek bir consultant_request:true bayrağı + danışmanlığa özgü alanlar (uzmanlık
// etiketleri/saatlik ücret/seans süresi/tecrübe/haftalık müsaitlik, bkz. migrations/
// 0034_consultant_submission_fields.sql) gönderir. Diğer *-ekle.html sayfaları gibi ADMIN ONAYINA
// düşer (status='pending') — onaylanınca src/lib/canonicalSync.js#syncArchitect/applyConsultantFields
// architects.is_consultant=1 yazıp profili /danisman'da canlıya alır (bkz. kullanıcı isteği: "admin
// onayına düşsün"). Haftalık müsaitlik seçici consultant-modal.js#cloneSlotsForEdit/renderEditDays
// ile AYNI gün/saat çip deseni — burada BOŞ bir şablondan başlar (düzenlenecek mevcut bir profil yok).
const ConsultantAddModal = (function () {
  const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Pzt..Paz
  const WEEKDAY_LABELS = { 1: 'Pazartesi', 2: 'Salı', 3: 'Çarşamba', 4: 'Perşembe', 5: 'Cuma', 6: 'Cumartesi', 0: 'Pazar' };

  let overlayEl = null;
  let slotsWorking = [];

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
      .cam-field{margin-bottom:16px;}
      .cam-label{display:block; font-size:12.5px; font-weight:700; color:var(--ink); margin-bottom:6px;}
      .cam-label small{font-weight:500; color:var(--ink-soft); text-transform:none;}
      .cam-field input[type=text], .cam-field input[type=number], .cam-field textarea, .cam-field select{
        width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:10px;
        background:var(--paper); font-family:inherit; font-size:13.5px; color:var(--ink); box-sizing:border-box;
      }
      .cam-field textarea{min-height:80px; resize:vertical;}
      .cam-row{display:grid; grid-template-columns:1fr 1fr; gap:12px;}
      .cam-slots-day{margin-bottom:12px;}
      .cam-slots-day-label{font-size:12.5px; font-weight:700; color:var(--ink); margin-bottom:6px;}
      .cam-slots-times{display:flex; flex-wrap:wrap; gap:6px;}
      .cam-time-chip{display:inline-flex; align-items:center; gap:6px; padding:5px 10px; border-radius:100px; border:1px solid var(--line); background:var(--paper); font-size:12px; font-family:'IBM Plex Mono', monospace;}
      .cam-time-chip button{background:none; border:none; color:var(--ink-soft); padding:0; line-height:1; cursor:pointer;}
      .cam-time-chip button:hover{color:#B84C4C;}
      .cam-add-time-row{display:flex; gap:6px; margin-top:6px;}
      .cam-add-time-row input[type=time]{border:1px solid var(--line); border-radius:8px; padding:5px 8px; font-family:inherit; font-size:12px;}
      .cam-add-time-row button{background:none; border:1px solid var(--line); border-radius:8px; padding:5px 10px; font-size:12px; font-weight:600; color:var(--ink); cursor:pointer;}
      .cam-submit-btn{width:100%; background:var(--ink); color:var(--paper-card); border:none; padding:14px; border-radius:100px; font-weight:600; font-size:15px; margin-top:6px; cursor:pointer;}
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
      @media (max-width:520px){ .cam-row{grid-template-columns:1fr;} }
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

  const TEMPLATE = `
    <div class="cam-modal">
      <button type="button" class="cam-close" id="cam-close" aria-label="Kapat">✕</button>
      <div id="cam-body"></div>
    </div>`;

  function loggedOutHtml() {
    return `
      <h2>Danışman Ekle</h2>
      <p class="cam-hint">Danışman profili başvurusu yapmak için önce giriş yapmalısın.</p>
      <a href="giris-yap.html" class="cam-submit-btn" style="display:block; text-align:center; text-decoration:none; box-sizing:border-box;">Giriş Yap</a>`;
  }

  function formHtml() {
    return `
      <h2>Danışman Ekle</h2>
      <p class="cam-hint">Bilgi gönderiminden sonra talep incelenecek, onaylandığında profilin yayına girecek.</p>
      <div class="cam-field cam-ac-field" id="cam-name-field">
        <label class="cam-label" for="cam-name">Ad Soyad *</label>
        <input type="text" id="cam-name" maxlength="120" autocomplete="off">
        <div class="cam-ac-suggestions" id="cam-name-suggestions"></div>
      </div>
      <div class="cam-row">
        <div class="cam-field">
          <label class="cam-label" for="cam-position">Unvan</label>
          <input type="text" id="cam-position" placeholder="ör. Mimar, Kurucu" maxlength="80">
        </div>
        <div class="cam-field cam-ac-field" id="cam-office-field">
          <label class="cam-label" for="cam-office">Firma</label>
          <input type="text" id="cam-office" maxlength="120" autocomplete="off">
          <div class="cam-ac-suggestions" id="cam-office-suggestions"></div>
        </div>
      </div>
      <div class="cam-field">
        <label class="cam-label" for="cam-about">Hakkında</label>
        <textarea id="cam-about" maxlength="2000" placeholder="Danışmanlık/mentörlük olarak neler sunduğunu anlat..."></textarea>
      </div>
      <div class="cam-field">
        <label class="cam-label" for="cam-tags">Uzmanlık Alanları <small>(virgülle ayır)</small></label>
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
      <div class="cam-field">
        <label class="cam-label" for="cam-experience">Tecrübe (yıl)</label>
        <input type="number" id="cam-experience" min="0" step="1" style="max-width:120px;">
      </div>
      <div class="cam-field">
        <label class="cam-label">Haftalık Müsaitlik</label>
        <div id="cam-slots-days"></div>
      </div>
      <button type="button" class="cam-submit-btn" id="cam-submit-btn">Başvuruyu Gönder</button>
      <div class="cam-notice" id="cam-notice"></div>`;
  }

  // proje-ekle.html'deki wireAutocompleteLive ile AYNI desen: canlı D1 aramasından (bkz.
  // src/routes/architect.js#handleArchitectSearchRoute, src/routes/office.js#handleOfficeSearchRoute)
  // beslenir, 300ms debounce, tek değerli alan (virgülle çoklu isim desteklenmiyor).
  function wireConsultantAutocomplete(inputId, suggestionsId, searchUrl) {
    const input = document.getElementById(inputId);
    const box = document.getElementById(suggestionsId);
    let debounceTimer = null;
    let currentQuery = '';
    function close() { box.classList.remove('show'); box.innerHTML = ''; }
    function renderItems(items) {
      if (!items.length) { close(); return; }
      box.innerHTML = items.map((it, i) => `<div class="cam-ac-suggestion" data-index="${i}">${escapeAttr(it.label)}${it.sub ? `<small>${escapeAttr(it.sub)}</small>` : ''}</div>`).join('');
      box.classList.add('show');
      box.querySelectorAll('.cam-ac-suggestion').forEach((el, i) => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          input.value = items[i].label;
          close();
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

  function wireForm() {
    slotsWorking = emptySlots();
    renderSlotsDays();
    document.getElementById('cam-submit-btn').addEventListener('click', submit);
    wireConsultantAutocomplete('cam-name', 'cam-name-suggestions', '/api/architects/search');
    wireConsultantAutocomplete('cam-office', 'cam-office-suggestions', '/api/offices/search');
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
    const experienceRaw = document.getElementById('cam-experience').value;

    btn.disabled = true;
    btn.textContent = 'Gönderiliyor…';
    try {
      const res = await fetch('/api/architects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          position: document.getElementById('cam-position').value.trim(),
          office: document.getElementById('cam-office').value.trim(),
          about: document.getElementById('cam-about').value.trim(),
          consultant_request: true,
          hourly_rate: Number(hourlyRateRaw),
          session_duration_min: Number(document.getElementById('cam-duration').value),
          consultant_experience_years: experienceRaw ? Number(experienceRaw) : null,
          expertise_tags: expertiseTags,
          available_slots: availableSlots,
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
