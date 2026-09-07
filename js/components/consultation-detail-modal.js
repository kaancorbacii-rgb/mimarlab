// ConsultationDetailModal — "Görüşme Detayı" (kullanıcı isteği, 2026-09-06, Aşama 4): danışmanlık
// veren kişi VE danışmanlık alan kişi, Bildirimler kutusundan bir danışmanlık bildirimine
// tıkladığında bu popup açılır — hem detayları gösterir hem de (kullanıcı isteği, 2026-09-06 ikinci
// tur) alıcının bir kereye mahsus tarih değiştirmesine VE her iki tarafın "Görüşme Gerçekleşti/
// Değerlendir/İptal Et" aksiyonlarını admin değerlendirmesine göndermesine izin verir.
// Güvenlik: bu bilgiler yalnızca GET /api/consultations/:id sunucu tarafında (alıcı YA DA host'u
// claim etmiş kullanıcı eşleşmesiyle) doğrulandıktan sonra döner — bkz. src/routes/consultations.js#
// getConsultationDetail. Bu dosya kendi başına, hesabim.html'in Bildirimler kutusundan çağrılır
// (bkz. auth-modal.js#renderNotifList, link formatı `consultation:<id>`).
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

  const STATUS_LABELS = { pending: 'Ödeme onayı bekleniyor', approved: 'Onaylandı', rejected: 'Reddedildi', cancelled: 'İptal edildi', completed: 'Görüşme Gerçekleşti' };
  // "Görüşme Gerçekleşti"/"Değerlendir"/"İptal Et" (kullanıcı isteği, 2026-09-06) — hem alıcı HEM
  // danışman aynı üç aksiyona erişir, tıklayınca bir sebep kutusu açılır ve admin değerlendirmesine
  // gider (bkz. src/routes/consultations.js#createConsultationAction).
  // Sıra kullanıcı isteği (2026-09-06): İptal Et → Mesaj Gönder → Değerlendir. "Tarihi Değiştir"
  // bunların ÖNÜNE, aynı ızgaranın ilk hücresine girer (bkz. actionsHtml) — ayrı bir buton değil,
  // aksiyon ızgarasının parçası.
  // 'message' ("Mesaj Gönder", eski adı "Görüşme Gerçekleşti") admin kuyruğuna DÜŞMEZ — yazılan
  // metin doğrudan karşı tarafın mesaj kutusuna gider (bkz. consultations.js'in 'message' dalı),
  // bu yüzden yer tutucusu ve başarı metni de diğerlerinden farklıdır (bkz. wireActions).
  const ACTION_LABELS = { cancel: 'İptal Et', message: 'Mesaj Gönder', review: 'Değerlendir' };
  // Hangi aksiyon hangi sunucu bayrağına bağlı (kullanıcı isteği, 2026-09-06): İptal Et yalnızca
  // görüşmeye 2 günden fazla varken, Değerlendir yalnızca görüşmeden sonra. Mesaj Gönder'in kapısı
  // yok. Sunucu aynı kuralları POST'ta TEKRAR uygular (bkz. createConsultationAction).
  const ACTION_GATES = { cancel: 'canCancel', review: 'canReview' };
  const ACTION_DISABLED_TITLES = {
    cancel: 'Görüşmeye 2 günden az kaldığı için iptal edilemez.',
    review: 'Değerlendirme yalnızca görüşme gerçekleştikten sonra yapılabilir.',
  };
  // "Tarihi Değiştir" (kullanıcı isteği, 2026-09-08): artık KOŞULSUZ olarak ızgaranın 1. satır
  // 1. sütununda durur — kapısı kapalıysa gizlenmez, PASİFLEŞTİRİLİR ve sebebi title'da görünür
  // (diğer üç butonla AYNI davranış). Kural: yalnızca 1 kez ve görüşmeden en az 3 gün önce; tek
  // gerçek kaynak sunucudur (bkz. src/routes/consultations.js#canReschedule/rescheduleReason,
  // updateConsultationRequest aynı kontrolleri POST'ta tekrar uygular).
  const RESCHEDULE_FALLBACK_TITLE = 'Görüşme tarihi yalnızca bir kez, görüşmeden en az 3 gün önce değiştirilebilir.';

  // consultation-modal.js (takvim/yeniden planlama akışı) her sayfada statik <script> ile
  // yüklenmez — auth-modal.js#ensureConsultationDetailModalLoaded İLE AYNI tembel yükleme deseni,
  // yalnızca "Tarihi Değiştir" tıklanınca devreye girer.
  // Görüşme odası popup'ı (kullanıcı isteği, 2026-09-08) — consultation-modal.js ile AYNI tembel
  // yükleme deseni; betik yüklenemezse tam sayfa yola düşülür (bkz. wireRoomButton'daki catch).
  let meetingRoomLoad = null;
  function ensureMeetingRoomLoaded() {
    if (typeof MeetingRoom !== 'undefined') return Promise.resolve();
    if (!meetingRoomLoad) {
      meetingRoomLoad = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/js/components/meeting-room.js';
        script.onload = () => resolve();
        script.onerror = () => { script.remove(); meetingRoomLoad = null; reject(new Error('meeting-room yüklenemedi')); };
        document.head.appendChild(script);
      });
    }
    return meetingRoomLoad;
  }

  let consultationModalLoad = null;
  function ensureConsultationModalLoaded() {
    if (typeof ConsultationModal !== 'undefined') return Promise.resolve();
    if (!consultationModalLoad) {
      consultationModalLoad = new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = '/js/components/consultation-modal.js';
        script.onload = () => resolve();
        document.head.appendChild(script);
      });
    }
    return consultationModalLoad;
  }

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
        .cnd-actions-title{font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; color:var(--ink-soft); margin:20px 0 8px;}
        .cnd-actions-grid{display:grid; grid-template-columns:1fr 1fr; gap:8px;}
        .cnd-action-btn{padding:11px 8px; border:1px solid var(--line); border-radius:10px; background:var(--paper); color:var(--ink); font-size:12.5px; font-weight:600; cursor:pointer; font-family:inherit;}
        .cnd-action-btn:disabled{opacity:0.5; cursor:default;}
        .cnd-action-btn:hover{border-color:var(--walnut); color:var(--walnut);}
        .cnd-action-btn.active{background:var(--ink); color:var(--paper-card); border-color:var(--ink);}
        .cnd-action-form{display:none; margin-top:10px; border:1px dashed var(--line); border-radius:10px; padding:12px;}
        .cnd-action-form.open{display:block;}
        .cnd-action-form textarea{width:100%; box-sizing:border-box; min-height:70px; padding:9px 12px; border:1px solid var(--line); border-radius:10px; background:var(--paper); color:var(--ink); font-family:inherit; font-size:12.5px; resize:vertical; margin-bottom:8px;}
        .cnd-action-submit{background:var(--ink); color:var(--paper-card); border:none; padding:9px 18px; border-radius:100px; font-weight:600; font-size:12.5px; cursor:pointer; font-family:inherit;}
        .cnd-action-submit:hover{background:var(--walnut);}
        .cnd-action-submit:disabled{opacity:0.5; cursor:default;}
        .cnd-action-feedback{font-size:12px; color:var(--ink-soft); margin-top:8px; min-height:1em;}
        .cnd-room{margin-top:16px; padding:14px; border:1px solid var(--line); border-radius:12px; background:var(--paper);}
        .cnd-room-title{font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; color:var(--ink-soft); margin-bottom:6px;}
        .cnd-room-text{font-size:13px; color:var(--ink-soft); line-height:1.5; margin-bottom:10px;}
        .cnd-room-btn{display:inline-block; background:var(--ink); color:var(--paper-card); border:none; padding:10px 18px; border-radius:100px; font-size:12.5px; font-weight:600; font-family:inherit; cursor:pointer;}
        .cnd-room-btn:hover{background:var(--walnut);}
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
    // ModalShell (Hesabım popup'ı) X/backdrop'tan kapanırsa bu overlay de kapanmalı — aksi halde
    // document.body.style.overflow 'hidden'da asılı kalır (bkz. consultation-modal.js#ensurePopup
    // İLE AYNI 'mimarlab-modal-closed' temizliği; bu dosyada eskiden EKSİKTİ).
    document.addEventListener('mimarlab-modal-closed', close);

    function row(label, value, extraClass) {
      if (!value) return '';
      return `<div class="cnd-row"><div class="cnd-row-label">${esc(label)}</div><div class="cnd-row-value${extraClass ? ' ' + extraClass : ''}">${esc(value)}</div></div>`;
    }

    // Görüşme odası (Güvenli Görüşme Gateway'i, 2026-09-08) — yalnızca ONAYLI rezervasyonda, sunucu
    // roomUrl döndürdüyse. Bu bağlantı /gorusme/:room_uuid'dir, Google Meet adresi DEĞİL: Meet
    // adresi yalnızca o sayfada, yalnızca katılım penceresinde ve sunucu yetkiyi yeniden kurduktan
    // sonra görünür (bkz. src/routes/consultations.js#getRoomState).
    const MEET_STATUS_TEXT = {
      ready: 'Google Meet odan hazır. Görüşme saatinden 15 dakika önce katılabilirsin.',
      pending: 'Google Meet odası hazırlanıyor — hazır olunca bildirim alacaksın.',
      creating: 'Google Meet odası hazırlanıyor — hazır olunca bildirim alacaksın.',
      failed: 'Google Meet odası henüz oluşturulamadı; otomatik olarak yeniden denenecek.',
    };
    function roomHtml(data) {
      if (!data.roomUrl) return '';
      const text = MEET_STATUS_TEXT[data.meetStatus] || MEET_STATUS_TEXT.pending;
      // Buton bir <a> DEĞİL <button>: görüşme odası artık site içinde POPUP olarak açılır
      // (kullanıcı isteği, 2026-09-08). href korunmuş bir tam sayfa yolu olarak DA gerekli
      // olmadığı için verilmez — aynı oda /gorusme/:room_uuid adresinden doğrudan da açılabilir
      // (bildirim linki, paylaşılan adres, F5) ve orada AYNI bileşen tam sayfa olarak çizilir.
      return `
        <div class="cnd-room">
          <div class="cnd-room-title">Görüşme Odası</div>
          <div class="cnd-room-text">${esc(text)}</div>
          <button type="button" class="cnd-room-btn" id="cnd-room-btn" data-room-uuid="${esc(data.roomUuid || '')}" data-room-url="${esc(data.roomUrl)}">Görüşme Odasına Git</button>
        </div>`;
    }

    // "Tarihi Değiştir" ızgaranın 1. satır 1. sütunudur (kullanıcı isteği, 2026-09-06:
    // 1-Tarihi Değiştir 2-İptal Et 3-Mesaj Gönder 4-Değerlendir) — data-action-type YOK, bu yüzden
    // sebep formunu açan delege dinleyicisi (wireActions) onu görmezden gelir; kendi ayrı id'li
    // dinleyicisi (cnd-reschedule-btn) takvimi açar.
    // DEĞİŞTİ (kullanıcı isteği, 2026-09-08): buton artık canReschedule false iken ızgaradan
    // KALDIRILMAZ, diğer üçüyle AYNI şekilde pasifleştirilir ve sebebi title'da görünür (sunucudan
    // gelen rescheduleReason; yoksa genel kural metni). Kapı: yalnızca 1 kez + görüşmeden en az
    // 3 GÜN önce + alıcı + talep açık (pending ya da approved).
    function actionsHtml(data) {
      const gated = Object.entries(ACTION_LABELS).map(([type, label]) => {
        const gate = ACTION_GATES[type];
        const disabled = gate ? !data[gate] : false;
        return `<button type="button" class="cnd-action-btn" data-action-type="${esc(type)}"${disabled ? ` disabled title="${esc(ACTION_DISABLED_TITLES[type] || '')}"` : ''}>${esc(label)}</button>`;
      }).join('');
      const rescheduleTitle = data.rescheduleReason || RESCHEDULE_FALLBACK_TITLE;
      return `
        <div class="cnd-actions-title">Görüşme Aksiyonları</div>
        <div class="cnd-actions-grid">
          <button type="button" class="cnd-action-btn" id="cnd-reschedule-btn"${data.canReschedule ? '' : ` disabled title="${esc(rescheduleTitle)}"`}>Tarihi Değiştir</button>
          ${gated}
        </div>
        <div class="cnd-action-form" id="cnd-action-form">
          <textarea id="cnd-action-note" maxlength="2000" placeholder="Sebebini yaz…"></textarea>
          <button type="button" class="cnd-action-submit" id="cnd-action-submit">Gönder</button>
          <div class="cnd-action-feedback" id="cnd-action-feedback"></div>
        </div>`;
    }

    // Üç aksiyon butonu (Görüşme Gerçekleşti/Değerlendir/İptal Et) TEK bir sebep formunu paylaşır —
    // birine tıklamak formu açar/hedef aksiyonu değiştirir, tekrar tıklamak kapatır (kullanıcı
    // isteği: "her birine tıklayınca bir yazı yazma kutucuğu açılsın").
    function wireActions(id) {
      const grid = bodyEl.querySelector('.cnd-actions-grid');
      const form = bodyEl.querySelector('#cnd-action-form');
      const noteEl = bodyEl.querySelector('#cnd-action-note');
      const submitBtn = bodyEl.querySelector('#cnd-action-submit');
      const feedbackEl = bodyEl.querySelector('#cnd-action-feedback');
      if (!grid) return;
      let activeType = null;
      grid.addEventListener('click', (e) => {
        const btn = e.target.closest('.cnd-action-btn');
        if (!btn) return;
        const type = btn.dataset.actionType;
        // "Tarihi Değiştir" aynı ızgarada ve AYNI .cnd-action-btn sınıfında ama data-action-type'ı
        // YOK — sebep formunu açmamalı, kendi dinleyicisi takvimi açar (bkz. cnd-reschedule-btn).
        if (!type) return;
        const opening = activeType !== type;
        grid.querySelectorAll('.cnd-action-btn').forEach(b => b.classList.toggle('active', opening && b === btn));
        activeType = opening ? type : null;
        form.classList.toggle('open', opening);
        feedbackEl.textContent = '';
        noteEl.value = '';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Gönder';
        // "Mesaj Gönder" bir SEBEP değil, karşı tarafa gidecek mesajın kendisidir — yer tutucu da
        // buna göre değişir (diğer ikisi admin değerlendirmesine gerekçe yazdırır).
        noteEl.placeholder = type === 'message' ? 'Mesajını yaz…' : 'Sebebini yaz…';
        if (opening) noteEl.focus();
      });
      submitBtn.addEventListener('click', async () => {
        if (!activeType) return;
        const note = noteEl.value.trim();
        if (!note) { noteEl.focus(); return; }
        submitBtn.disabled = true;
        submitBtn.textContent = 'Gönderiliyor…';
        try {
          const res = await fetch(`/api/consultations/${encodeURIComponent(id)}/actions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actionType: activeType, note }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            feedbackEl.textContent = data.error || 'Gönderilemedi, tekrar dene.';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Gönder';
            return;
          }
          feedbackEl.textContent = data.sent
            ? 'Mesajın gönderildi — Hesabım > Mesajlar\'dan takip edebilirsin.'
            : 'Talebin admin değerlendirmesine gönderildi.';
          noteEl.value = '';
        } catch {
          feedbackEl.textContent = 'Sunucuya ulaşılamadı, tekrar dene.';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Gönder';
        }
      });
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
        ].join('')
          + roomHtml(data)
          // "Tarihi Değiştir" HER ZAMAN ızgaranın ilk hücresindedir; tıklanabilirliği sunucunun
          // canReschedule bayrağına bağlıdır (bkz. getConsultationDetail: alıcı + açık talep +
          // değiştirilmemiş + görüşmeye en az 3 gün kalmış).
          + actionsHtml(data);

        const roomBtn = bodyEl.querySelector('#cnd-room-btn');
        if (roomBtn) {
          roomBtn.addEventListener('click', () => {
            const uuid = roomBtn.dataset.roomUuid;
            const url = roomBtn.dataset.roomUrl;
            if (!uuid) { window.location.href = url; return; }
            ensureMeetingRoomLoaded()
              .then(() => { close(); MeetingRoom.open(uuid); })
              .catch(() => { window.location.href = url; });
          });
        }

        const rescheduleBtn = bodyEl.querySelector('#cnd-reschedule-btn');
        if (rescheduleBtn && !rescheduleBtn.disabled) {
          rescheduleBtn.addEventListener('click', async () => {
            rescheduleBtn.disabled = true;
            rescheduleBtn.textContent = 'Yükleniyor…';
            await ensureConsultationModalLoaded();
            close();
            ConsultationModal.openReschedule({
              requestId: data.id, hostSlug: data.hostSlug, hostName: data.hostName,
              date: data.date, time: data.time, hasRescheduled: data.hasRescheduled,
            });
          });
        }
        wireActions(id);
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
