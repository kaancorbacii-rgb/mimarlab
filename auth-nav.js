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
  // kullanıcı isteği (2026-08-28, Architonic profil sayfası referans alınarak): avatar menüsündeki
  // renkli emojiler (👤🗂️🛠️🚪✦) yerine soyut, tek renkli (currentColor) çizgi ikonlar — hem
  // masaüstü avatar açılır menüsünde hem de mobil çekmecenin hesap bölümünde AYNI ikonlar kullanılır.
  const ICON_ACCOUNT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c1.4-4.1 4.2-6.2 7.5-6.2s6.1 2.1 7.5 6.2"/></svg>';
  const ICON_ACTIVITY = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2l2.4 5.7 6.1.7-4.6 4.2 1.3 6-5.2-3.2-5.2 3.2 1.3-6-4.6-4.2 6.1-.7z"/></svg>';
  const ICON_CONTENT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.2A2 2 0 0 1 5 5.2h3.4l1.8 2.3H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.2z"/></svg>';
  const ICON_ADMIN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6.5" x2="20" y2="6.5"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17.5" x2="20" y2="17.5"/><circle cx="9" cy="6.5" r="1.7" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="10.5" cy="17.5" r="1.7" fill="currentColor" stroke="none"/></svg>';
  // Koleksiyonum (kullanıcı isteği, 2026-08-31) — İçeriklerim ile ÇIKIŞ YAP arasındaki yeni sayfa
  // (bkz. js/components/auth-modal.js#collectionsTemplate). Diğer ikonlarla AYNI 16px/stroke stili.
  const ICON_COLLECTION = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6"/></svg>';
  const ICON_LOGOUT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 21H5.8a1.8 1.8 0 0 1-1.8-1.8V4.8A1.8 1.8 0 0 1 5.8 3H9.5"/><polyline points="15.5 16.5 20.5 12 15.5 7.5"/><line x1="20.2" y1="12" x2="9" y2="12"/></svg>';
  function injectStyleOnce() {
    if (document.getElementById('auth-nav-style')) return;
    const style = document.createElement('style');
    style.id = 'auth-nav-style';
    style.textContent = `
      .nav-avatar-wrap{position:relative;}
      .nav-avatar{display:flex; align-items:center; gap:9px; border:1px solid var(--line); border-radius:100px; padding:5px 14px 5px 5px; background:var(--paper-card); font-size:13.5px; font-weight:600; cursor:pointer; color:var(--ink); font-family:inherit;}
      .nav-avatar-circle{width:28px; height:28px; border-radius:50%; overflow:hidden; background:var(--walnut); color:var(--paper-card); display:flex; align-items:center; justify-content:center; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:12px; font-weight:600; flex-shrink:0;}
      .nav-avatar-menu{display:none; position:absolute; top:calc(100% + 8px); right:0; z-index:95; background:var(--paper-card); border:1px solid var(--line); border-radius:12px; padding:8px; min-width:240px; box-shadow:0 12px 28px rgba(27,42,61,0.15); flex-direction:column;}
      .nav-avatar-menu.open{display:flex;}
      .nav-avatar-menu a, .nav-avatar-menu button{display:flex; align-items:center; gap:10px; width:100%; text-align:left; padding:9px 12px; border-radius:8px; font-size:13.5px; font-weight:500; color:var(--ink); background:none; border:none; font-family:inherit; cursor:pointer;}
      .nav-avatar-menu a:hover, .nav-avatar-menu button:hover{background:var(--paper-alt);}
      .nav-avatar-menu-header{display:flex; align-items:center; gap:11px; padding:8px 12px 12px;}
      .nav-avatar-menu-avatar{width:38px; height:38px; border-radius:50%; overflow:hidden; background:var(--walnut); color:var(--paper-card); display:flex; align-items:center; justify-content:center; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:13px; font-weight:600; flex-shrink:0;}
      .nav-avatar-menu-id{min-width:0;}
      .nav-avatar-menu-name{font-size:13.5px; font-weight:700; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
      .nav-avatar-menu-email{font-size:11.5px; color:var(--ink-soft); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
      .nav-avatar-menu-sep{height:1px; background:var(--line); margin:4px 6px;}
      .nav-avatar-menu a span, .nav-avatar-menu button span{display:flex; flex-shrink:0; color:var(--ink-soft);}
      /* mobil çekmecenin hesap bölümü — masaüstü .nav-avatar-menu-header ile aynı fikir, dokunma
         hedefleri için büyütülmüş (bkz. kullanıcı isteği: hamburger menüde giriş yapılmışsa "Giriş
         Yap" yerine hesap menüsü görünsün). */
      .nav-mobile-account-header{display:flex; align-items:center; gap:12px; padding:6px 4px 14px;}
      .nav-mobile-account-avatar{width:40px; height:40px; border-radius:50%; overflow:hidden; background:var(--walnut); color:var(--paper-card); display:flex; align-items:center; justify-content:center; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:14px; font-weight:600; flex-shrink:0;}
      .nav-mobile-account-id{min-width:0;}
      .nav-mobile-account-name{font-size:14.5px; font-weight:700; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
      .nav-mobile-account-email{font-size:12px; color:var(--ink-soft); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
      .nav-mobile-account-sep{height:1px; background:var(--line); margin:0 4px 8px;}
      .nav-mobile-account-links{display:flex; flex-direction:column; gap:2px;}
      .nav-mobile-account-links .nav-mobile-link span{display:flex; flex-shrink:0; color:var(--ink-soft);}
      /* kullanıcı isteği (2026-08-28): Hesabım/Aktivitelerim/İçeriklerim/Admin/Çıkış Yap punto
         olarak PROJE/ÜRÜN/MİMAR/FİRMA'dan (site-chrome.js#.nav-mobile-link, 17px) birazcık daha küçük
         olsun — ikisi de aynı .nav-mobile-link sınıfını paylaştığından burada, hesap bölümüne özel
         daha spesifik bir seçiciyle geçersiz kılınır. */
      .nav-mobile-account-links .nav-mobile-link{font-size:14px;}
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
    const adminLink = user.role === 'admin' ? `<a href="admin.html"><span>${ICON_ADMIN}</span> Admin Paneli</a><div class="nav-avatar-menu-sep"></div>` : '';
    const avatarInner = user.photoUrl
      ? `<img src="${escapeAttr(user.photoUrl)}" alt="" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`
      : initials(user.name);
    navRight.innerHTML = `
      <div class="nav-avatar-wrap">
        <button class="nav-avatar" id="nav-avatar-btn" type="button">
          <span class="nav-avatar-circle">${avatarInner}</span> ${escapeHtml(firstName(user.name))}
        </button>
        <div class="nav-avatar-menu" id="nav-avatar-menu">
          <div class="nav-avatar-menu-header">
            <span class="nav-avatar-menu-avatar">${avatarInner}</span>
            <div class="nav-avatar-menu-id">
              <div class="nav-avatar-menu-name">${escapeHtml(user.name || '')}</div>
              <div class="nav-avatar-menu-email">${escapeHtml(user.email || '')}</div>
            </div>
          </div>
          <div class="nav-avatar-menu-sep"></div>
          <a href="hesabim.html"><span>${ICON_ACCOUNT}</span> Hesabım</a>
          <div class="nav-avatar-menu-sep"></div>
          <a href="aktivitelerim.html"><span>${ICON_ACTIVITY}</span> Aktivitelerim</a>
          <div class="nav-avatar-menu-sep"></div>
          <a href="koleksiyonum.html"><span>${ICON_COLLECTION}</span> Koleksiyonum</a>
          <div class="nav-avatar-menu-sep"></div>
          <a href="iceriklerim.html"><span>${ICON_CONTENT}</span> İçeriklerim</a>
          <div class="nav-avatar-menu-sep"></div>
          ${adminLink}
          <button type="button" id="nav-logout-btn"><span>${ICON_LOGOUT}</span> Çıkış Yap</button>
        </div>
      </div>`;

    // gerçek bulgu (kullanıcı isteği, 2026-08-28): bu fonksiyon şimdiye dek yalnızca masaüstü
    // .nav-right'ı güncelliyordu — mobil çekmecenin alt kısmındaki "Giriş Yap" düğmesi
    // (site-chrome.js#headerHtml, id="nav-mobile-menu-foot") oturum açılsa da hep statik kalıyordu.
    // Aynı hesap linklerini (Hesabım/Aktivitelerim/İçeriklerim/Admin/Çıkış Yap) burada da, .nav-mobile-link
    // satırlarıyla (tek satır = tek sayfa ismi, bkz. site-chrome.js düzeltmesi) render ediyoruz.
    const mobileFoot = document.getElementById('nav-mobile-menu-foot');
    if (mobileFoot) {
      const mobileAdminLink = user.role === 'admin' ? `<a class="nav-mobile-link" href="admin.html"><span>${ICON_ADMIN}</span> Admin Paneli</a>` : '';
      mobileFoot.innerHTML = `
        <div class="nav-mobile-account-header">
          <span class="nav-mobile-account-avatar">${avatarInner}</span>
          <div class="nav-mobile-account-id">
            <div class="nav-mobile-account-name">${escapeHtml(user.name || '')}</div>
            <div class="nav-mobile-account-email">${escapeHtml(user.email || '')}</div>
          </div>
        </div>
        <div class="nav-mobile-account-sep"></div>
        <div class="nav-mobile-account-links">
          <a class="nav-mobile-link" href="hesabim.html"><span>${ICON_ACCOUNT}</span> Hesabım</a>
          <a class="nav-mobile-link" href="aktivitelerim.html"><span>${ICON_ACTIVITY}</span> Aktivitelerim</a>
          <a class="nav-mobile-link" href="koleksiyonum.html"><span>${ICON_COLLECTION}</span> Koleksiyonum</a>
          <a class="nav-mobile-link" href="iceriklerim.html"><span>${ICON_CONTENT}</span> İçeriklerim</a>
          ${mobileAdminLink}
          <button type="button" class="nav-mobile-link" id="nav-mobile-logout-btn"><span>${ICON_LOGOUT}</span> Çıkış Yap</button>
        </div>`;
      const mobileLogoutBtn = document.getElementById('nav-mobile-logout-btn');
      if (mobileLogoutBtn) {
        mobileLogoutBtn.addEventListener('click', async () => {
          await fetch('/api/auth/logout', { method: 'POST' });
          window.location.href = 'index.html';
        });
      }
    }

    const btn = document.getElementById('nav-avatar-btn');
    const menu = document.getElementById('nav-avatar-menu');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!navRight.contains(e.target)) menu.classList.remove('open');
    });
    // gerçek bulgu (denetim, 2026-08-24): site-chrome.js#wireHamburger ile AYNI boşluk — Hesabım
    // avatar menüsü yalnızca dışarı tıklama ile kapanıyordu, Escape'e hiç yanıt vermiyordu.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.classList.contains('open')) menu.classList.remove('open');
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
