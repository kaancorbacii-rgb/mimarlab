// MeetingRoom — Güvenli Görüşme Gateway'inin TEK render kaynağı (kullanıcı isteği, 2026-09-08:
// "görüşme odası da popup şeklinde açılsın").
//
// AYNI kart iki yerde çizilir ve ikisi de BU dosyadan gelir:
//   * MeetingRoom.mount(el, uuid)  -> /gorusme/:room_uuid tam sayfası (gorusme.html; doğrudan
//                                     bağlantı, F5 ve paylaşılan adres için — sunucu yetkiyi
//                                     sayfayı servis etmeden ÖNCE de kurar, bkz.
//                                     src/index.js#serveMeetingRoomPage)
//   * MeetingRoom.open(uuid)       -> site içi popup (Bildirimler ve "Görüşme Detayı" popup'ından)
// İkinci bir kopya YAZILMAMALI: bu depodaki tekrar eden kök neden "aynı ekran iki yerde ayrı ayrı
// çizildi, biri güncellenince diğeri sessizce eskidi"dir.
//
// GÜVENLİK: bu dosya hiçbir yetki kararı VERMEZ. Erişim de, katılım penceresi de, Google Meet
// adresinin dönüp dönmeyeceği de HER istekte sunucuda belirlenir (GET /api/consultations/room/:uuid,
// bkz. src/routes/consultations.js#getRoomState). Buradaki saat yalnızca geri sayımı çizmek ve
// pencere sınırında sunucuya YENİDEN sormak içindir; `meetLink` yanıtta yoksa buton pasiftir çünkü
// gidilecek bir adres yoktur — istemci tarafında "açma" imkânı hiç yoktur.
const MeetingRoom = (function () {
  const API_BASE = '/api/consultations/room/';

  function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function pad(n) { return String(n).padStart(2, '0'); }

  function injectStyles() {
    if (document.getElementById('meeting-room-styles')) return;
    const style = document.createElement('style');
    style.id = 'meeting-room-styles';
    // NOT: bu şablon dizesinde CSS yorumu (yıldız-eğik çizgi) ya da ters tırnak KULLANILMAZ —
    // enjekte edilen CSS'i sessizce bozar (bkz. proje notu: style template literal kuralı).
    style.textContent = `
      .room-lead{font-size:14px; color:var(--ink-soft); line-height:1.6; margin:0 0 22px;}
      .room-card{background:var(--paper-card); border:1px solid var(--line-soft); border-radius:18px; padding:24px; box-shadow:0 18px 44px rgba(27,42,61,0.08);}
      .room-host{display:flex; align-items:center; gap:14px; padding-bottom:18px; border-bottom:1px solid var(--line-soft); margin-bottom:18px;}
      .room-avatar{width:56px; height:56px; border-radius:50%; background:var(--paper-alt); flex-shrink:0; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:18px; color:var(--walnut); overflow:hidden;}
      .room-avatar img{width:100%; height:100%; object-fit:cover; display:block;}
      .room-host-label{font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:var(--ink-soft); margin-bottom:3px;}
      .room-host-name{font-size:17px; font-weight:700; line-height:1.25; color:var(--ink);}
      .room-host-name a{color:inherit; text-decoration:none;}
      .room-host-name a:hover{color:var(--walnut);}
      .room-host-pos{font-size:13px; color:var(--ink-soft); margin-top:2px;}
      .room-grid{display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; margin-bottom:18px;}
      .room-cell{background:var(--paper); border:1px solid var(--line-soft); border-radius:12px; padding:12px 14px; min-width:0;}
      .room-cell-label{font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:var(--ink-soft); margin-bottom:4px;}
      .room-cell-value{font-size:15px; font-weight:600; line-height:1.3; word-break:break-word; color:var(--ink);}
      .room-cell-sub{font-size:11.5px; color:var(--ink-soft); margin-top:2px;}
      .room-status{display:flex; align-items:flex-start; gap:10px; padding:14px 16px; border-radius:12px; background:var(--paper); border:1px solid var(--line-soft); margin-bottom:14px;}
      .room-dot{width:10px; height:10px; border-radius:50%; background:var(--brass); flex-shrink:0; margin-top:5px;}
      .room-status.open .room-dot, .room-status.soon .room-dot{background:var(--good, #2F8A55); box-shadow:0 0 0 4px rgba(47,138,85,0.18);}
      .room-status.ended .room-dot, .room-status.failed .room-dot, .room-status.closed .room-dot{background:var(--bad, #B84C4C);}
      .room-status-text{font-size:14px; font-weight:600; line-height:1.4; color:var(--ink);}
      .room-status-sub{font-size:12.5px; color:var(--ink-soft); font-weight:500; margin-top:2px; line-height:1.5;}
      .room-countdown{font-variant-numeric:tabular-nums; font-size:clamp(28px, 6vw, 36px); font-weight:700; letter-spacing:0.02em; text-align:center; padding:6px 0 4px; color:var(--ink);}
      .room-countdown-label{font-size:11.5px; text-transform:uppercase; letter-spacing:0.08em; color:var(--ink-soft); text-align:center; margin-bottom:14px; font-weight:600;}
      .room-join{display:flex; align-items:center; justify-content:center; gap:10px; width:100%; padding:15px 20px; border-radius:100px; border:none; background:var(--ink); color:var(--paper-card); font-size:15px; font-weight:700; text-align:center; text-decoration:none; box-sizing:border-box;}
      .room-join:hover{background:var(--walnut); color:var(--paper-card);}
      .room-join[aria-disabled="true"]{opacity:0.45; cursor:not-allowed; pointer-events:none;}
      .room-join svg{flex-shrink:0;}
      .room-hint{font-size:12px; color:var(--ink-soft); text-align:center; margin-top:12px; line-height:1.55;}
      .room-state{text-align:center; padding:36px 12px;}
      .room-state h2{font-size:19px; margin:0 0 8px; color:var(--ink);}
      .room-state p{font-size:14px; color:var(--ink-soft); line-height:1.6; margin:0 0 20px;}
      .room-state a.room-state-btn{display:inline-block; background:var(--ink); color:var(--paper-card); padding:11px 22px; border-radius:100px; font-size:14px; font-weight:600; text-decoration:none;}
      .room-state a.room-state-btn:hover{background:var(--walnut); color:var(--paper-card);}

      .mrm-overlay{display:none; position:fixed; inset:0; z-index:500; background:rgba(20,24,30,0.62); backdrop-filter:blur(2px); align-items:flex-start; justify-content:center; padding:40px 20px; overflow-y:auto;}
      .mrm-overlay.open{display:flex;}
      .mrm-popup{width:100%; max-width:460px; background:var(--paper-card); border-radius:16px; padding:28px 26px 26px; position:relative; box-shadow:0 24px 60px rgba(0,0,0,0.35); margin:auto;}
      .mrm-close{position:absolute; top:12px; right:12px; background:none; border:none; color:var(--ink-soft); padding:8px; cursor:pointer; display:flex; border-radius:50%;}
      .mrm-close:hover{color:var(--ink); background:var(--paper-alt);}
      .mrm-eyebrow{font-size:11px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:var(--sage);}
      .mrm-title{margin:4px 0 14px; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:19px; font-weight:700; color:var(--ink); padding-right:20px;}
      .mrm-popup .room-card{box-shadow:none; border:none; border-radius:0; padding:0; background:none;}
      .mrm-popup .room-lead{font-size:13px; margin-bottom:16px;}
      .mrm-popup .room-state{padding:24px 4px;}

      @media (max-width:560px){
        .room-card{padding:18px; border-radius:14px;}
        .room-grid{grid-template-columns:1fr 1fr;}
        .room-grid .room-cell:first-child{grid-column:1 / -1;}
        .room-avatar{width:48px; height:48px; font-size:16px;}
        .mrm-overlay{padding:20px 12px;}
        .mrm-popup{padding:24px 18px 20px;}
      }
    `;
    document.head.appendChild(style);
  }

  function fmtDate(iso) {
    const d = new Date(`${iso}T00:00:00`);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  function endTime(time, durationMin) {
    const [h, mi] = String(time).split(':').map(Number);
    const total = h * 60 + mi + durationMin;
    return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
  }
  function initials(name) {
    return (name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';
  }
  function photoSrc(url) {
    if (!url) return null;
    if (/^https?:\/\//i.test(url) || url.startsWith('/')) return url;
    return '/' + url;
  }
  function stateHtml(title, text, btnHref, btnText) {
    return `<div class="room-state"><h2>${esc(title)}</h2><p>${esc(text)}</p>${btnHref ? `<a class="room-state-btn" href="${esc(btnHref)}">${esc(btnText)}</a>` : ''}</div>`;
  }

  // Durum metinleri — sunucunun `phase` alanına göre (tek gerçek kaynak sunucudur, bkz.
  // src/lib/consultationMeet.js#meetingWindow). Kullanıcı isteğindeki senaryolarla birebir:
  // 19:00 "beklniyor", 19:45 "15 dakika içinde başlayacak", 19:45-20:45 katıl aktif, sonrası "sona erdi".
  const PHASE_TEXT = {
    waiting: { text: 'Görüşme saati bekleniyor.', sub: 'Katılım bağlantısı görüşmeden 15 dakika önce açılır.' },
    soon: { text: '15 dakika içinde görüşmeniz başlayacak.', sub: 'Google Meet bağlantısı aktif — hazır olduğunda katılabilirsin.' },
    open: { text: 'Görüşme devam ediyor.', sub: 'Google Meet bağlantısı aktif.' },
    ended: { text: 'Bu görüşme sona ermiştir.', sub: 'Katılım bağlantısı artık aktif değil.' },
    not_approved: { text: 'Ödeme onayı bekleniyor.', sub: 'Onaylandığında görüşme odası burada aktifleşir.' },
    closed: { text: 'Bu görüşme aktif değil.', sub: 'Rezervasyon iptal edilmiş ya da reddedilmiş.' },
  };

  const JOIN_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/></svg>';

  // Bir "oturum": tek bir konteynere bağlı render + zamanlayıcılar. Popup kapanınca ya da yeniden
  // yüklenince stop() ile temizlenir — aksi halde saniyede bir çalışan interval arkada yaşamaya
  // devam ederdi.
  function createSession(container, roomUuid, opts) {
    const options = opts || {};
    let tickTimer = null;
    let refreshTimer = null;

    function stop() {
      if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
      if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
    }

    function render(data) {
      stop();
      const offset = data.serverNow - Date.now(); // sunucu saati - istemci saati
      const serverNow = () => Date.now() + offset;
      const status = data.status;
      let phase = data.phase;
      if (status !== 'approved') phase = status === 'pending' ? 'not_approved' : 'closed';
      const meetReady = data.meetStatus === 'ready';
      // Buton YALNIZCA sunucu adresi gönderdiyse aktif olur — istemci tarafında "açma" yolu yoktur.
      const joinable = (phase === 'soon' || phase === 'open') && !!data.meetLink;
      const who = data.isHost
        ? `${esc(data.contactName || 'Kullanıcı')} ile danışmanlık görüşmen`
        : `${esc(data.host.name)} ile danışmanlık görüşmen`;

      let statusCls = phase;
      let statusText = (PHASE_TEXT[phase] || PHASE_TEXT.waiting).text;
      let statusSub = (PHASE_TEXT[phase] || PHASE_TEXT.waiting).sub;
      if (status === 'approved' && (phase === 'waiting' || phase === 'soon' || phase === 'open') && !meetReady) {
        statusSub = data.meetStatus === 'failed'
          ? 'Google Meet odası henüz oluşturulamadı; otomatik olarak yeniden deneniyor. Sorun sürerse bizimle iletişime geç.'
          : 'Google Meet odası hazırlanıyor — hazır olunca bildirim alacaksın.';
        if (phase !== 'waiting') statusCls = 'failed';
      }

      const photo = photoSrc(data.host.photoUrl);
      const showCountdown = status === 'approved' && phase !== 'ended';
      container.innerHTML = `
        <p class="room-lead">${who} — ${esc(fmtDate(data.date))}, ${esc(data.time)} (İstanbul, GMT+3).</p>
        <div class="room-card">
          <div class="room-host">
            <div class="room-avatar">${photo ? `<img src="${esc(photo)}" alt="" loading="lazy" onerror="this.remove()">` : esc(initials(data.host.name))}</div>
            <div>
              <div class="room-host-label">Danışman</div>
              <div class="room-host-name"><a href="/kisi/${encodeURIComponent(data.host.slug)}">${esc(data.host.name)}</a></div>
              ${data.host.position ? `<div class="room-host-pos">${esc(data.host.position)}</div>` : ''}
            </div>
          </div>
          <div class="room-grid">
            <div class="room-cell"><div class="room-cell-label">Tarih</div><div class="room-cell-value">${esc(fmtDate(data.date))}</div></div>
            <div class="room-cell"><div class="room-cell-label">Başlangıç</div><div class="room-cell-value">${esc(data.time)}</div><div class="room-cell-sub">İstanbul (GMT+3)</div></div>
            <div class="room-cell"><div class="room-cell-label">Süre</div><div class="room-cell-value">${esc(String(data.durationMin))} dk</div><div class="room-cell-sub">${esc(data.time)}–${esc(endTime(data.time, data.durationMin))}</div></div>
          </div>
          <div class="room-status ${esc(statusCls)}"><span class="room-dot"></span><div><div class="room-status-text" data-room-status-text>${esc(statusText)}</div><div class="room-status-sub">${esc(statusSub)}</div></div></div>
          ${showCountdown ? `<div class="room-countdown" data-room-countdown>--:--:--</div><div class="room-countdown-label">${phase === 'open' ? 'Görüşmenin bitmesine' : 'Görüşmeye kalan süre'}</div>` : ''}
          <a class="room-join" data-room-join ${joinable ? `href="${esc(data.meetLink)}" target="_blank" rel="noopener noreferrer"` : 'href="#" aria-disabled="true" tabindex="-1"'}>
            ${JOIN_ICON}
            Google Meet Görüşmesine Katıl
          </a>
          <div class="room-hint">${joinable ? 'Bağlantı yeni sekmede Google Meet’te açılır.' : (phase === 'ended' ? 'Görüşme süresi doldu.' : 'Bu düğme yalnızca görüşmeden 15 dakika önce ile görüşme bitişi arasında aktiftir.')}</div>
        </div>`;

      if (typeof options.onTitle === 'function') options.onTitle(data);

      const cd = container.querySelector('[data-room-countdown]');
      if (showCountdown) {
        // Sınırlar SUNUCUNUN verdiği anlardır; geri sayım yalnızca görsel. Bir sınır geçilince
        // sunucuya yeniden sorulur — Meet bağlantısı ancak o yanıtla gelir ya da gider.
        const target = phase === 'open' ? data.endsAt : data.startsAt;
        const boundary = phase === 'waiting' ? data.joinOpensAt : (phase === 'soon' ? data.startsAt : data.endsAt);
        const tick = () => {
          const now = serverNow();
          let diff = Math.max(0, target - now);
          const h = Math.floor(diff / 3600000); diff -= h * 3600000;
          const mi = Math.floor(diff / 60000); diff -= mi * 60000;
          const sec = Math.floor(diff / 1000);
          if (cd) cd.textContent = h >= 24 ? `${Math.floor(h / 24)} gün ${pad(h % 24)}:${pad(mi)}:${pad(sec)}` : `${pad(h)}:${pad(mi)}:${pad(sec)}`;
          if (now >= boundary) { stop(); load(); }
        };
        tick();
        tickTimer = setInterval(tick, 1000);
        // Meet henüz hazır değilse sunucu arka planda yeniden dener — birkaç dakikada bir yokla.
        if (!meetReady) refreshTimer = setTimeout(load, 3 * 60 * 1000);
      }
    }

    async function load() {
      stop();
      container.innerHTML = '<div class="room-state"><p>Yükleniyor…</p></div>';
      const loginPath = `/giris?next=${encodeURIComponent(`/gorusme/${roomUuid}`)}`;
      try {
        const res = await fetch(API_BASE + encodeURIComponent(roomUuid), { cache: 'no-store' });
        if (res.status === 401) { window.location.href = loginPath; return; }
        const data = await res.json().catch(() => ({}));
        if (res.status === 403) {
          container.innerHTML = stateHtml('Bu görüşmeye erişimin yok', 'Bu görüşme odası yalnızca rezervasyonu yapan kişi ve danışman tarafından görüntülenebilir.', '/hesabim', 'Hesabıma Dön');
          return;
        }
        if (res.status === 404) {
          container.innerHTML = stateHtml('Görüşme odası bulunamadı', 'Bu bağlantı geçersiz ya da kaldırılmış.', '/hesabim', 'Hesabıma Dön');
          return;
        }
        if (!res.ok) {
          container.innerHTML = stateHtml('Bir sorun oluştu', data.error || 'Görüşme bilgileri alınamadı, lütfen tekrar dene.');
          return;
        }
        render(data);
      } catch {
        container.innerHTML = stateHtml('Sunucuya ulaşılamadı', 'Lütfen bağlantını kontrol edip sayfayı yenile.');
      }
    }

    return { load, stop };
  }

  // ---- Tam sayfa (gorusme.html) -----------------------------------------------------------------
  function mount(container, roomUuid, opts) {
    injectStyles();
    if (!container) return null;
    const session = createSession(container, roomUuid, opts);
    session.load();
    return session;
  }

  // ---- Popup ------------------------------------------------------------------------------------
  // consultation-detail-modal.js#ensurePopup İLE AYNI desen (singleton overlay, tek seferlik
  // enjeksiyon, 'mimarlab-modal-closed' temizliği) — sınıf öneki çakışmasın diye "mrm-".
  let popup = null;
  function ensurePopup() {
    if (popup) return popup;
    injectStyles();

    const overlay = document.createElement('div');
    overlay.className = 'mrm-overlay';
    overlay.innerHTML = `
      <div class="mrm-popup" role="dialog" aria-modal="true" aria-labelledby="mrm-title">
        <button type="button" class="mrm-close" aria-label="Kapat"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        <div class="mrm-eyebrow">Danışmanlık</div>
        <h3 class="mrm-title" id="mrm-title">Görüşme Odası</h3>
        <div id="mrm-body"><div class="room-state"><p>Yükleniyor…</p></div></div>
      </div>`;
    document.body.appendChild(overlay);

    const bodyEl = overlay.querySelector('#mrm-body');
    let session = null;

    function close() {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
      // Geri sayım/yoklama zamanlayıcıları kapanışta MUTLAKA durdurulur (bkz. createSession#stop).
      if (session) { session.stop(); session = null; }
    }
    overlay.querySelector('.mrm-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open')) close(); });
    // ModalShell (Hesabım popup'ı) X/backdrop'tan kapanırsa bu overlay de kapanmalı — aksi halde
    // document.body.style.overflow 'hidden'da asılı kalır (bkz. consultation-detail-modal.js'teki
    // AYNI temizlik).
    document.addEventListener('mimarlab-modal-closed', close);

    popup = {
      open(roomUuid) {
        if (session) session.stop();
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
        session = createSession(bodyEl, roomUuid, {});
        session.load();
      },
      close,
    };
    return popup;
  }

  return {
    mount,
    open(roomUuid) { ensurePopup().open(roomUuid); },
    close() { if (popup) popup.close(); },
  };
})();
