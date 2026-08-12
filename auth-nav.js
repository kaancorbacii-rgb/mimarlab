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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuthNav);
  } else {
    initAuthNav();
  }

  // auth-modal.js login/signup başarılı olduğunda artık sayfayı yeniden YÜKLEMEDEN (bkz. kullanıcı
  // isteği: modal içinde kalınsın) header'ı güncelleyebilsin diye dışa açılır. fresh:true — bkz.
  // initAuthNav yukarısındaki yorum.
  window.refreshAuthNav = () => initAuthNav({ fresh: true });
})();
