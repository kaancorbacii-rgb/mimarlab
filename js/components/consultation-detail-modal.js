// ConsultationDetailModal — "Görüşme Detayı" (kullanıcı isteği, 2026-09-06, Aşama 4): danışmanlık
// veren kişi (şu an yalnızca Kaan Çorbacı) Bildirimler sekmesinde bir "Yeni danışmanlık talebi"
// bildirimine tıkladığında alıcının Ad Soyad/E-posta/Telefon/Not bilgilerini görebileceği popup.
// Güvenlik: bu bilgiler yalnızca GET /api/consultations/:id sunucu tarafında (host'u claim etmiş
// kullanıcı ID eşleşmesiyle) doğrulandıktan sonra döner — bkz. src/routes/consultations.js#
// getConsultationDetail. Bu dosya kendi başına, hesabim.html'in Bildirimler kutusundan çağrılır
// (bkz. hesabim.html#renderNotifications, link formatı `consultation:<id>`).
//
// Görsel dil consultation-modal.js#ensurePopup İLE AYNI desen (singleton overlay, tek seferlik
// enjeksiyon) ama sınıf öneki çakışmasın diye "cnd-" kullanıldı.
const ConsultationDetailModal = (function () {
  let popupApi = null;

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function formatDateTr(isoDate) {
    const d = new Date(`${isoDate}T00:00:00`);
    if (Number.isNaN(d.getTime())) return isoDate;
    return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  const STATUS_LABELS = { pending: 'Ödeme onayı bekleniyor', approved: 'Onaylandı', rejected: 'Reddedildi', cancelled: 'İptal edildi' };

  function ensurePopup() {
    if (popupApi) return popupApi;

    if (!document.getElementById('consultation-detail-modal-style')) {
      const style = document.createElement('style');
      style.id = 'consultation-detail-modal-style';
      style.textContent = `
        .cnd-overlay{display:none; position:fixed; inset:0; z-index:500; background:rgba(20,24,30,0.62); backdrop-filter:blur(2px); align-items:flex-start; justify-content:center; padding:40px 20px; overflow-y:auto;}
        .cnd-overlay.open{display:flex;}
        .cnd-popup{width:100%; max-width:420px; background:var(--paper-card); border-radius:16px; padding:28px 26px 26px; position:relative; box-shadow:0 24px 60px rgba(0,0,0,0.35); margin:auto;}
        .cnd-close{position:absolute; top:12px; right:12px; background:none; border:none; color:var(--ink-soft); padding:8px; cursor:pointer; display:flex; border-radius:50%;}
        .cnd-close:hover{color:var(--ink); background:var(--paper-alt);}
        .cnd-eyebrow{font-size:11px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:var(--sage);}
        .cnd-title{margin:4px 0 16px; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:19px; font-weight:700; color:var(--ink); padding-right:20px;}
        .cnd-row{padding:10px 0; border-bottom:1px solid var(--line-soft);}
        .cnd-row:last-of-type{border-bottom:none;}
        .cnd-row-label{font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; color:var(--ink-soft); margin-bottom:3px;}
        .cnd-row-value{font-size:14px; color:var(--ink); line-height:1.5; word-break:break-word;}
        .cnd-note-value{white-space:pre-wrap;}
        .cnd-state{font-size:13px; color:var(--ink-soft); padding:24px 0; text-align:center;}
        .cnd-state.error{color:#B84C4C;}
      `;
      document.head.appendChild(style);
    }

    const overlay = document.createElement('div');
    overlay.className = 'cnd-overlay';
    overlay.innerHTML = `
      <div class="cnd-popup" role="dialog" aria-modal="true" aria-labelledby="cnd-title">
        <button type="button" class="cnd-close" aria-label="Kapat"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        <div class="cnd-eyebrow">Danışmanlık</div>
        <h3 class="cnd-title" id="cnd-title">Görüşme Detayı</h3>
        <div id="cnd-body"><div class="cnd-state">Yükleniyor…</div></div>
      </div>`;
    document.body.appendChild(overlay);

    const bodyEl = overlay.querySelector('#cnd-body');

    function close() {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    }
    overlay.querySelector('.cnd-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open')) close(); });

    function row(label, value, extraClass) {
      if (!value) return '';
      return `<div class="cnd-row"><div class="cnd-row-label">${esc(label)}</div><div class="cnd-row-value${extraClass ? ' ' + extraClass : ''}">${esc(value)}</div></div>`;
    }

    async function load(id) {
      bodyEl.innerHTML = '<div class="cnd-state">Yükleniyor…</div>';
      try {
        const res = await fetch(`/api/consultations/${encodeURIComponent(id)}`);
        if (res.status === 401) { window.location.href = '/giris'; return; }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          bodyEl.innerHTML = `<div class="cnd-state error">${esc(data.error || 'Görüşme detayı yüklenemedi.')}</div>`;
          return;
        }
        bodyEl.innerHTML = [
          row('Tarih', formatDateTr(data.date)),
          row('Saat', data.time),
          row('Durum', STATUS_LABELS[data.status] || data.status),
          row('Ad Soyad', data.contactName),
          row('E-posta', data.contactEmail),
          row('Telefon', data.contactPhone),
          row('Görüşme İsteği Hakkında Not', data.note, 'cnd-note-value'),
        ].join('');
      } catch {
        bodyEl.innerHTML = '<div class="cnd-state error">Sunucuya ulaşılamadı, lütfen tekrar dene.</div>';
      }
    }

    popupApi = {
      open(id) {
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
        load(id);
      },
    };
    return popupApi;
  }

  return {
    open(id) { ensurePopup().open(id); },
  };
})();
