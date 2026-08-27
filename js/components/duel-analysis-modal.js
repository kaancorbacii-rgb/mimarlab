// Düello Analizi popup'ı — js/components/info-modal.js#renderView İLE AYNI desen (ModalShell'in
// paylaşılan tek-panel/"single" moduyla): claimContent('duel-analysis') + bodyEl'e .dam-single
// eklenip grid tek sütuna indirgenir, içerik yalnızca leftPanelEl'e yazılır (bkz. modal-shell.js#
// claimContent, info-modal.js/auth-modal.js'nin AYNI info-single/am-single deseni). Bilinçli olarak
// info-modal.js'in aksine history.pushState YAPMAZ — bu popup deep-link'lenebilir bir sayfa değil,
// yalnızca duello.html'deki "Tamamla" butonundan veya Aktivitelerim'deki bir kayıttan tetiklenen
// geçici bir görünüm (kullanıcı isteği: sade/premium popup, ayrı bir route'a gerek yok).
const DuelAnalysisModal = (function () {
  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }

  function injectStyles() {
    if (document.getElementById('duel-analysis-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'duel-analysis-modal-styles';
    style.textContent = `
      .modal-shell-body.dam-single{display:block;}
      #dam-panel{font-family:'Inter', sans-serif; color:var(--ink);}
      #dam-panel .content-wrap{max-width:640px; margin:0 auto; padding:8px 4px 24px;}
      #dam-panel .page-head{max-width:640px; margin:0 auto; padding:0 4px 0; text-align:center;}
      #dam-panel .page-head .eyebrow{font-family:'IBM Plex Mono', monospace; font-size:12px; letter-spacing:0.14em; text-transform:uppercase; color:var(--sage); font-weight:600; margin-bottom:10px;}
      #dam-panel .page-head h1{font-family:'Inter', sans-serif; font-size:28px; font-weight:700; margin:0 0 8px;}
      #dam-panel .page-head p{color:var(--ink-soft); font-size:14px; margin:0;}
      #dam-panel .checkout-wrap{max-width:640px; margin:0 auto; padding:24px 4px 24px;}
      #dam-panel .form-section{background:var(--paper-card); border:1px solid var(--line); border-radius:16px; padding:22px; margin-bottom:16px;}
      #dam-panel .form-section h2{font-family:'IBM Plex Mono', monospace; font-size:11.5px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:var(--sage); margin:0 0 8px;}
      #dam-panel .form-section p{font-size:14px; line-height:1.6; color:var(--ink); margin:0 0 12px;}
      #dam-panel .dam-chips{display:flex; flex-wrap:wrap; gap:8px;}
      #dam-panel .dam-chip{display:inline-flex; align-items:center; gap:6px; background:var(--paper); border:1px solid var(--line); border-radius:100px; padding:6px 13px; font-size:12.5px; font-weight:600; color:var(--ink);}
      #dam-panel .dam-chip-count{font-family:'IBM Plex Mono', monospace; color:var(--ink-soft); font-weight:500;}
      #dam-panel .dam-count-line{font-family:'Inter', sans-serif; font-size:20px; font-weight:700; margin:0;}
      #dam-panel .form-submit{width:100%; background:var(--ink); color:var(--paper-card); border:none; padding:14px; border-radius:100px; font-weight:600; font-size:15px; cursor:pointer;}
      #dam-panel .form-submit:hover{background:var(--walnut);}
      #dam-panel .form-submit:disabled{background:var(--paper-alt); color:var(--ink-soft); cursor:default;}
      #dam-panel .form-notice{display:none; margin-top:14px; padding:13px 16px; border-radius:10px; background:rgba(224,138,62,0.12); border:1px solid var(--accent); color:var(--ink); font-size:12.5px; line-height:1.6;}
      #dam-panel .form-notice.success{background:rgba(62,122,85,0.12); border-color:#3E7A55;}
      #dam-panel .form-notice.show{display:block;}
      #dam-panel .dam-empty{text-align:center; color:var(--ink-soft); font-size:14px; padding:40px 20px;}
      #dam-panel .dam-saved-date{text-align:center; font-size:12.5px; color:var(--ink-soft); margin:8px 0 0;}
    `;
    document.head.appendChild(style);
  }

  const SECTIONS = [
    { key: 'topCategory', label: 'En Çok Tercih Ettiğin Yapı Türleri' },
    { key: 'topPeriod', label: 'En Çok Tercih Ettiğin Dönem' },
    { key: 'topDiscipline', label: 'Öne Çıkan Disiplin' },
    { key: 'topCity', label: 'En Çok Tercih Ettiğin Şehirler' },
    { key: 'topDesigner', label: 'Tercih Zincirinde Öne Çıkan İsimler' },
  ];

  function chipsHtml(items) {
    return items.map(it => `<span class="dam-chip">${escapeHtml(it.value)}<span class="dam-chip-count">${it.count}</span></span>`).join('');
  }

  function sectionsHtml(summary) {
    return SECTIONS.map(s => {
      const items = summary[s.key];
      if (!items || !items.length) return '';
      return `<div class="form-section">
        <h2>${escapeHtml(s.label)}</h2>
        <div class="dam-chips">${chipsHtml(items)}</div>
      </div>`;
    }).join('');
  }

  function analysisBodyHtml(summary, opts) {
    const dateLine = opts.createdAt
      ? `<p class="dam-saved-date">${escapeHtml(new Date(opts.createdAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }))} tarihinde kaydedildi</p>`
      : '';
    return `
    <div class="page-head">
      <div class="eyebrow">Mimari Tercih Analizi</div>
      <h1>${opts.mode === 'saved' ? 'Düello Analizin' : 'Düello Analizin'}</h1>
      <p>Düello boyunca yaptığın seçimlere göre</p>
      ${dateLine}
    </div>
    <div class="checkout-wrap">
      <div class="form-section">
        <h2>Seçimlerin</h2>
        <p class="dam-count-line">${summary.choiceCount} proje seçtin</p>
      </div>
      ${sectionsHtml(summary)}
      ${opts.showSave ? `
      <button class="form-submit" id="dam-save-btn" type="button">Kaydet</button>
      <div class="form-notice" id="dam-notice"></div>
      ` : ''}
    </div>`;
  }

  function wireSave(wrap, chain) {
    const btn = wrap.querySelector('#dam-save-btn');
    const notice = wrap.querySelector('#dam-notice');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      notice.classList.remove('show', 'success');
      btn.disabled = true;
      btn.textContent = 'Kaydediliyor…';
      try {
        const res = await fetch('/api/duel/analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slugs: chain }),
        });
        if (res.status === 401) {
          notice.textContent = 'Analizi kaydetmek için giriş yapmalısın.';
          notice.classList.add('show');
          btn.disabled = false;
          btn.textContent = 'Kaydet';
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          notice.textContent = data.error || 'Kaydedilemedi, tekrar dene.';
          notice.classList.add('show');
          btn.disabled = false;
          btn.textContent = 'Kaydet';
          return;
        }
        notice.textContent = 'Analizin Aktivitelerim’e kaydedildi.';
        notice.classList.add('show', 'success');
        btn.textContent = 'Kaydedildi';
      } catch {
        notice.textContent = 'Sunucuya ulaşılamadı, lütfen tekrar dene.';
        notice.classList.add('show');
        btn.disabled = false;
        btn.textContent = 'Kaydet';
      }
    });
  }

  function renderWrap() {
    injectStyles();
    const panels = ModalShell.claimContent('duel-analysis');
    panels.bodyEl.classList.add('dam-single');
    panels.rightPanelEl.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.id = 'dam-panel';
    panels.leftPanelEl.innerHTML = '';
    panels.leftPanelEl.appendChild(wrap);
    ModalShell.setLabel('Düello Analizin');
    ModalShell.scrollToTop();
    return wrap;
  }

  function close() {
    const panels = ModalShell.getPanels();
    if (panels) panels.bodyEl.classList.remove('dam-single');
    ModalShell.close();
  }

  // opts: { mode:'live', chain:[slug,...] } veya { mode:'saved', id }
  function open(opts, { triggerEl = null } = {}) {
    ModalShell.open({ triggerEl, onRequestClose: close });
    const wrap = renderWrap();
    wrap.innerHTML = '<div class="dam-empty">Analiz hazırlanıyor…</div>';

    const req = opts.mode === 'saved'
      ? fetch('/api/duel/analysis/' + encodeURIComponent(opts.id)).then(r => r.json().then(d => ({ ok: r.ok, d })))
      : fetch('/api/duel/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slugs: opts.chain }),
        }).then(r => r.json().then(d => ({ ok: r.ok, d })));

    req.then(({ ok, d }) => {
      if (!ok || !d || (!d.summary)) {
        wrap.innerHTML = '<div class="dam-empty">Analiz için yeterli seçim bulunamadı.</div>';
        return;
      }
      const html = analysisBodyHtml(d.summary, {
        mode: opts.mode,
        createdAt: opts.mode === 'saved' ? d.createdAt : null,
        showSave: opts.mode === 'live',
      });
      wrap.innerHTML = html;
      if (opts.mode === 'live') wireSave(wrap, opts.chain);
    }).catch(() => {
      wrap.innerHTML = '<div class="dam-empty">Analiz yüklenemedi, tekrar dene.</div>';
    });
  }

  return { open, close };
})();
// window.DuelAnalysisModal — auth-modal.js#loadDuelAnalysisModal İLE AYNI gerekçe (bkz. auth-modal.js
// sonundaki AYNI window.AuthModal notu): üstteki `const DuelAnalysisModal` klasik <script> global
// scope'unda kalır, window'un ÖZELLİĞİ değildir — bu satır olmadan auth-modal.js'in dinamik <script>
// enjeksiyonu (Aktivitelerim'den "Analizi Gör") her seferinde window.DuelAnalysisModal'ı undefined
// görüp dosyayı TEKRAR enjekte eder, bu da `const DuelAnalysisModal` için "already declared"
// SyntaxError'ına (ve o sayfadaki TÜM sonraki script'lerin çalışmamasına) yol açardı — duello.html
// zaten <script> ile DOĞRUDAN yüklediğinden bu senaryoyu tetiklemez, ama aynı sayfada hem duello.html
// hem Aktivitelerim popup'ı kullanılabildiğinden bu satır olmadan gizli bir çakışma riski kalırdı.
window.DuelAnalysisModal = DuelAnalysisModal;
