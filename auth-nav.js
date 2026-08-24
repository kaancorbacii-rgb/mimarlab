// Her sayfada .nav-right içindeki "Giriş Yap" düğmesini, oturum açıksa hesap menüsüyle değiştirir.
(function () {
  function firstName(name) {
    return (name || '').trim().split(/\s+/)[0] || 'Hesabım';
  }
  function initials(name) {
    return (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  }
  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // mimar-detay.html/ofis-detay.html'deki inline safeUrl() ile aynı — yalnızca http(s) kabul eder
  // (bkz. XSS escaping convention: stored URL'ler her zaman safeUrl'den geçirilir).
  function safeUrl(u) {
    if (!u) return '';
    try {
      const parsed = new URL(u, document.baseURI);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
    } catch {}
    return '';
  }
  function injectStyleOnce() {
    if (document.getElementById('auth-nav-style')) return;
    const style = document.createElement('style');
    style.id = 'auth-nav-style';
    style.textContent = `
      .nav-avatar-wrap{position:relative;}
      .nav-avatar{display:flex; align-items:center; gap:9px; border:1px solid var(--line); border-radius:100px; padding:5px 14px 5px 5px; background:var(--paper-card); font-size:13.5px; font-weight:600; cursor:pointer; color:var(--ink); font-family:inherit;}
      .nav-avatar-circle{width:28px; height:28px; border-radius:50%; overflow:hidden; background:var(--walnut); color:var(--paper-card); display:flex; align-items:center; justify-content:center; font-family:'IBM Plex Mono', monospace; font-size:12px; font-weight:600; flex-shrink:0;}
      .nav-avatar-menu{display:none; position:absolute; top:calc(100% + 8px); right:0; z-index:95; background:var(--paper-card); border:1px solid var(--line); border-radius:12px; padding:8px; min-width:190px; box-shadow:0 12px 28px rgba(27,42,61,0.15); flex-direction:column;}
      .nav-avatar-menu.open{display:flex;}
      .nav-avatar-menu a, .nav-avatar-menu button{display:block; width:100%; text-align:left; padding:9px 12px; border-radius:8px; font-size:13.5px; font-weight:500; color:var(--ink); background:none; border:none; font-family:inherit; cursor:pointer;}
      .nav-avatar-menu a:hover, .nav-avatar-menu button:hover{background:var(--paper-alt);}
    `;
    document.head.appendChild(style);
  }

  function fetchMe() {
    return fetch('/api/auth/me').then(res => (res.ok ? res.json() : { user: null })).catch(() => ({ user: null }));
  }
  // audit bulgusu: auth-nav.js (hemen hemen her sayfada) ve save-widget.js (kart ızgaralı
  // sayfalarda, bkz. o dosyadaki initSavedWidget) AYNI sayfada birbirinden habersiz iki ayrı
  // /api/auth/me isteği atıyordu (ör. /proje'de canlıda doğrulandı). fetchMe() SENKRON başlar
  // (yalnızca çözümü async'tir) — bu yüzden bu satır script'in ilk çalıştığı anda, herhangi bir
  // await'ten ÖNCE window'a atanır; auth-nav.js her zaman save-widget.js'den ÖNCE <script defer>
  // olarak yüklendiğinden (bkz. proje/mimar/firma/urun.html script sırası), o script kendi
  // isteğini atmadan önce bunu bulur ve AYNI Promise'i paylaşır — tek network isteği.
  window.__authMeFetch = window.__authMeFetch || fetchMe();

  // fresh:true — window.refreshAuthNav() login/signup SONRASI (bkz. dosya sonu) çağrıldığında,
  // yukarıdaki paylaşılan promise ARTIK BAYAT (sayfa ilk yüklendiğindeki, login ÖNCESİ) sonucu
  // taşır — bu durumda MUTLAKA taze bir istek atılmalı, aksi halde giriş yapan kullanıcıya hâlâ
  // "Giriş Yap" görünmeye devam ederdi.
  async function initAuthNav(opts) {
    const navRight = document.querySelector('.nav-right');
    if (!navRight) return;
    const data = opts && opts.fresh ? await (window.__authMeFetch = fetchMe()) : await window.__authMeFetch;
    const user = data.user;

    if (!user) return;

    injectStyleOnce();
    const adminLink = user.role === 'admin' ? '<a href="admin.html">Admin Paneli</a>' : '';
    const avatarInner = user.photoUrl
      ? `<img src="${escapeAttr(user.photoUrl)}" alt="" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`
      : initials(user.name);
    navRight.innerHTML = `
      <div class="nav-avatar-wrap">
        <button class="nav-avatar" id="nav-avatar-btn" type="button">
          <span class="nav-avatar-circle">${avatarInner}</span> ${escapeHtml(firstName(user.name))}
        </button>
        <div class="nav-avatar-menu" id="nav-avatar-menu">
          <a href="hesabim.html">Hesabım</a>
          ${adminLink}
          <button type="button" id="nav-logout-btn">Çıkış Yap</button>
        </div>
      </div>`;

    const btn = document.getElementById('nav-avatar-btn');
    const menu = document.getElementById('nav-avatar-menu');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!navRight.contains(e.target)) menu.classList.remove('open');
    });
    document.getElementById('nav-logout-btn').addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = 'index.html';
    });
  }

  // Admin panelin Site Ayarları sekmesinden (bkz. src/routes/admin.js#handleSiteSettingsAdmin,
  // src/routes/public.js#handlePublicSiteSettings) açılıp kapatılan duyuru banner'ı — auth-nav.js
  // hemen her sayfada zaten yüklü olduğundan (bkz. dosya başı yorumu) ayrı bir <script> eklemeye
  // gerek kalmadan buraya eklendi. Kapatma tercihi duyuru METNİNİN hash'iyle saklanır — metin
  // değişirse (yeni bir duyuru) eski "kapatıldı" durumu geçersiz olur, yeniden gösterilir.
  function announcementDismissKey(text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    return `mimarlab-announcement-dismissed-${h}`;
  }
  function injectAnnouncementStyleOnce() {
    if (document.getElementById('announcement-banner-style')) return;
    const style = document.createElement('style');
    style.id = 'announcement-banner-style';
    style.textContent = `
      .announcement-banner{display:flex; align-items:center; justify-content:center; gap:12px; background:var(--walnut); color:var(--paper-card); font-size:13px; font-weight:600; padding:10px 44px 10px 16px; text-align:center; position:relative;}
      .announcement-banner a{color:inherit; text-decoration:underline;}
      .announcement-banner-close{position:absolute; right:10px; top:50%; transform:translateY(-50%); background:none; border:none; color:inherit; font-size:16px; line-height:1; cursor:pointer; padding:6px; opacity:0.8;}
      .announcement-banner-close:hover{opacity:1;}
    `;
    document.head.appendChild(style);
  }
  async function initAnnouncementBanner() {
    let settings;
    try {
      // window.__siteSettingsPromise: index.html'in featured-project inline script'i (defer'sız,
      // bu deferred script'ten ÖNCE çalışır) aynı endpoint'i zaten çekmiş/çekiyor olabilir — varsa
      // onu paylaşıp aynı isteği ikinci kez atmayı önlüyoruz (denetim bulgusu, 2026-08-24). Diğer
      // tüm sayfalarda window.__siteSettingsPromise henüz yok, davranış eskisiyle birebir aynı kalır.
      settings = await (window.__siteSettingsPromise || (window.__siteSettingsPromise = fetch('/api/public/site-settings', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(()=>null)));
    } catch { settings = null; }
    if (!settings || !settings.announcementEnabled || !settings.announcementText) return;
    const dismissKey = announcementDismissKey(settings.announcementText);
    try { if (localStorage.getItem(dismissKey) === '1') return; } catch {}
    if (document.getElementById('announcement-banner')) return;
    injectAnnouncementStyleOnce();
    const link = safeUrl(settings.announcementLink);
    const banner = document.createElement('div');
    banner.className = 'announcement-banner';
    banner.id = 'announcement-banner';
    banner.innerHTML = `<span>${escapeHtml(settings.announcementText)}${link ? ` <a href="${escapeAttr(link)}">Detaylar</a>` : ''}</span><button type="button" class="announcement-banner-close" aria-label="Kapat">&times;</button>`;
    document.body.prepend(banner);
    banner.querySelector('.announcement-banner-close').addEventListener('click', () => {
      try { localStorage.setItem(dismissKey, '1'); } catch {}
      banner.remove();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuthNav);
    document.addEventListener('DOMContentLoaded', initAnnouncementBanner);
  } else {
    initAuthNav();
    initAnnouncementBanner();
  }

  // auth-modal.js login/signup başarılı olduğunda artık sayfayı yeniden YÜKLEMEDEN (bkz. kullanıcı
  // isteği: modal içinde kalınsın) header'ı güncelleyebilsin diye dışa açılır. fresh:true — bkz.
  // initAuthNav yukarısındaki yorum. Header güncellendikten sonra 'mimarlab:authchange' de
  // yayınlanır — sayfa scriptlerinin (bkz. en-iyi-100.html#hızlı puanlama popup'ı) "oturum az önce
  // açıldı" sinyalini dinleyip, modal açık olarak beklettiği bir işlemi (ör. giriş öncesi seçilen
  // puanı) otomatik tamamlayabilmesi için — auth-modal.js'in kendisi login/signup dışındaki
  // sayfalara/işlere hiçbir şekilde bağımlı olmasın diye bu genel amaçlı olay burada, TEK
  // dokunulmayan hook'ta yayınlanır.
  window.refreshAuthNav = () => initAuthNav({ fresh: true }).then(() => {
    window.dispatchEvent(new CustomEvent('mimarlab:authchange'));
  });
})();
