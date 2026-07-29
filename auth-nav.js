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
  function injectStyleOnce() {
    if (document.getElementById('auth-nav-style')) return;
    const style = document.createElement('style');
    style.id = 'auth-nav-style';
    style.textContent = `
      .nav-avatar-wrap{position:relative;}
      .nav-avatar{display:flex; align-items:center; gap:9px; border:1px solid var(--line); border-radius:100px; padding:5px 14px 5px 5px; background:var(--paper-card); font-size:13.5px; font-weight:600; cursor:pointer; color:var(--ink); font-family:inherit;}
      .nav-avatar-circle{width:28px; height:28px; border-radius:50%; background:var(--walnut); color:var(--paper-card); display:flex; align-items:center; justify-content:center; font-family:'IBM Plex Mono', monospace; font-size:12px; font-weight:600; flex-shrink:0;}
      .nav-avatar-menu{display:none; position:absolute; top:calc(100% + 8px); right:0; z-index:95; background:var(--paper-card); border:1px solid var(--line); border-radius:12px; padding:8px; min-width:190px; box-shadow:0 12px 28px rgba(27,42,61,0.15); flex-direction:column;}
      .nav-avatar-menu.open{display:flex;}
      .nav-avatar-menu a, .nav-avatar-menu button{display:block; width:100%; text-align:left; padding:9px 12px; border-radius:8px; font-size:13.5px; font-weight:500; color:var(--ink); background:none; border:none; font-family:inherit; cursor:pointer;}
      .nav-avatar-menu a:hover, .nav-avatar-menu button:hover{background:var(--paper-alt);}
    `;
    document.head.appendChild(style);
  }

  async function initAuthNav() {
    const navRight = document.querySelector('.nav-right');
    if (!navRight) return;
    let user = null;
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        user = data.user;
      }
    } catch (e) { /* backend yoksa sessizce "Giriş Yap" görünmeye devam eder */ }

    if (!user) return;

    injectStyleOnce();
    const adminLink = user.role === 'admin' ? '<a href="admin.html">Admin Paneli</a>' : '';
    navRight.innerHTML = `
      <div class="nav-avatar-wrap">
        <button class="nav-avatar" id="nav-avatar-btn" type="button">
          <span class="nav-avatar-circle">${initials(user.name)}</span> ${escapeHtml(firstName(user.name))}
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
})();
