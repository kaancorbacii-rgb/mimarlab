// Proje/Ürün "yeni ekle" linklerine tıklanınca "Yapay Zeka ile Otomatik Ekle" / "Manuel Ekle"
// seçimini sunan paylaşılan modal. proje.html, urun.html ve hesabim.html'e <script src="add-choice.js">
// ile dahil edilir. Hedef sayfalara (proje-ekle.html/urun-ekle.html) giden linkleri event
// delegation ile yakalar — proje.html/urun.html'deki sidebar-add-btn listeleme verisi geldikten
// SONRA JS ile basıldığı için (bkz. o sayfalardaki render fonksiyonları), sabit bir DOM referansı
// yerine document üzerinde delegation kullanmak zorunlu. Yalnızca TAM eşleşen href'leri ("proje-ekle.html",
// "urun-ekle.html") yakalar; ?edit=/?claim= taşıyan düzenleme/sahiplenme linkleri farklı href'e sahip
// olduğundan hiç etkilenmez.

(function () {
  const TARGETS = {
    'proje-ekle.html': { kind: 'project', label: 'Proje' },
    'urun-ekle.html': { kind: 'urun', label: 'Ürün' },
  };

  const style = document.createElement('style');
  style.textContent = `
.add-choice-backdrop{position:fixed;inset:0;background:rgba(27,42,61,0.55);z-index:300;display:flex;align-items:center;justify-content:center;padding:24px;}
.add-choice-modal{background:var(--paper-card);border-radius:16px;max-width:420px;width:100%;padding:28px;position:relative;}
.add-choice-close{position:absolute;top:14px;right:14px;background:none;border:none;font-size:26px;line-height:1;color:var(--ink-soft);cursor:pointer;width:34px;height:34px;border-radius:50%;}
.add-choice-close:hover{background:var(--paper-alt);}
.add-choice-title{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;font-size:19px;font-weight:700;margin:0 0 18px;padding-right:24px;color:var(--ink);}
.add-choice-option{display:block;width:100%;text-align:left;border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:12px;background:none;cursor:pointer;font-family:inherit;}
.add-choice-option:last-child{margin-bottom:0;}
.add-choice-option:hover{border-color:var(--sage);background:var(--paper-alt);}
.add-choice-option-title{font-size:15px;font-weight:600;color:var(--ink);margin-bottom:4px;}
.add-choice-option-desc{font-size:13px;color:var(--ink-soft);line-height:1.4;}
`;
  document.head.appendChild(style);

  const backdrop = document.createElement('div');
  backdrop.className = 'add-choice-backdrop';
  backdrop.style.display = 'none';
  backdrop.innerHTML = `
    <div class="add-choice-modal" role="dialog" aria-modal="true">
      <button type="button" class="add-choice-close" aria-label="Kapat">&times;</button>
      <h3 class="add-choice-title"></h3>
      <button type="button" class="add-choice-option" data-choice="ai">
        <div class="add-choice-option-title">Yapay Zeka ile Otomatik Ekle</div>
        <div class="add-choice-option-desc">Projenin/ürünün yayında olduğu sayfanın linkini yapıştır, bilgileri senin için biz dolduralım.</div>
      </button>
      <button type="button" class="add-choice-option" data-choice="manual">
        <div class="add-choice-option-title">Manuel Ekle</div>
        <div class="add-choice-option-desc">Formu kendin doldur.</div>
      </button>
    </div>`;
  document.body.appendChild(backdrop);

  const titleEl = backdrop.querySelector('.add-choice-title');
  let pendingHref = null;

  function openModal(href, label) {
    pendingHref = href;
    titleEl.textContent = `${label} Ekle`;
    backdrop.style.display = 'flex';
  }
  function closeModal() {
    backdrop.style.display = 'none';
    pendingHref = null;
  }

  backdrop.querySelector('.add-choice-close').addEventListener('click', closeModal);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && backdrop.style.display !== 'none') closeModal();
  });
  backdrop.querySelectorAll('.add-choice-option').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!pendingHref) return;
      const choice = btn.getAttribute('data-choice');
      window.location.href = choice === 'ai' ? `${pendingHref}?ai=1` : pendingHref;
    });
  });

  document.addEventListener('click', (e) => {
    const anchor = e.target.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    const target = href && TARGETS[href];
    if (!target) return;
    e.preventDefault();
    openModal(href, target.label);
  });
})();
