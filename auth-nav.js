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
  const ICON_ADMIN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6.5" x2="20" y2="6.5"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17.5" x2="20" y2="17.5"/><circle cx="9" cy="6.5" r="1.7" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="10.5" cy="17.5" r="1.7" fill="currentColor" stroke="none"/></svg>';
  // Koleksiyonum (kullanıcı isteği, 2026-08-31) — ÇIKIŞ YAP'tan önceki yeni sayfa
  // (bkz. js/components/auth-modal.js#collectionsTemplate). Diğer ikonlarla AYNI 16px/stroke stili.
  const ICON_COLLECTION = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6"/></svg>';
  const ICON_LOGOUT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 21H5.8a1.8 1.8 0 0 1-1.8-1.8V4.8A1.8 1.8 0 0 1 5.8 3H9.5"/><polyline points="15.5 16.5 20.5 12 15.5 7.5"/><line x1="20.2" y1="12" x2="9" y2="12"/></svg>';
  function injectStyleOnce() {
    if (document.getElementById('auth-nav-style')) return;
    const style = document.createElement('style');
    style.id = 'auth-nav-style';
    style.textContent = `
      .nav-avatar-wrap{position:relative;}
      /* position:relative — .nav-avatar-alert (bildirim noktası) DÜĞMENİN kendi köşesine çıpalanır.
         Sarmalayıcı .nav-avatar-wrap'e bırakılsaydı nokta, sarmalayıcı bir nedenle düğmeden geniş
         kaldığı her düzende (ör. .nav-right flex olmayan bir barındırıcıda) avatarın uzağına kayardı. */
      .nav-avatar{position:relative; display:flex; align-items:center; gap:9px; border:1px solid var(--line); border-radius:100px; padding:5px 14px 5px 5px; background:var(--paper-card); font-size:13.5px; font-weight:600; cursor:pointer; color:var(--ink); font-family:inherit;}
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
      /* BİLDİRİM/MESAJ NOKTASI (kullanıcı isteği, 2026-09-12 madde 1): "Kullanıcı hesabına bir
         bildirim veya mesaj geldiğinde Hesabım başlığının sağ yanında turuncu bir nokta çıksın."
         Nokta ÜÇ yerde birden gösterilir ve hepsi TEK bir sayıdan (bkz. applyAlertDot) beslenir:
         (a) avatar düğmesinin köşesi — menü KAPALIYKEN de görünsün diye, kullanıcı menüyü açmadan
         yeni bir şey olduğunu anlar; (b) açılır menüdeki "Hesabım" satırı; (c) mobil çekmecedeki
         "Hesabım" satırı. Renk var(--accent) (#E08A3E) — admin panelindeki var(--bad) kırmızı
         noktalardan bilinçli olarak ayrı: bu bir uyarı değil, "yeni içerik var" işareti.

         ELEMENT <i>, <span> DEĞİL — bilerek: yukarıdaki ".nav-avatar-menu a span" ve
         ".nav-mobile-account-links .nav-mobile-link span" kuralları (ikon sarmalayıcıları için)
         display:flex dayatıyor ve ikisi de tek sınıflı ".nav-alert-dot"tan DAHA SPESİFİK
         (0,1,2 > 0,1,0) — bir <span> olsaydı nokta display:none'ı yiyip HER ZAMAN görünürdü.
         <i> o seçicilerin hiçbirine takılmaz, böylece spesifiklik yarışına girmeden doğru çalışır. */
      .nav-alert-dot{display:none; width:7px; height:7px; border-radius:50%; background:var(--accent); flex-shrink:0;}
      .nav-alert-dot.show{display:inline-block;}
      .nav-avatar-alert{display:none; position:absolute; top:-1px; right:-1px; width:9px; height:9px; border-radius:50%; background:var(--accent); border:2px solid var(--paper-card); box-sizing:content-box;}
      .nav-avatar-alert.show{display:block;}
    `;
    document.head.appendChild(style);
  }

  // Oturum ipucu (bkz. src/index.js#ml-auth meta): çerez yoksa istek hiç atılmaz — anonim
  // ziyaretçide 401 üretmez, sayfa başına bir istek eksilir. Meta yoksa (eski önbellek/yerel
  // statik) eski davranış.
  function hasSessionHint() {
    var m = document.querySelector('meta[name="ml-auth"]');
    return !m || m.getAttribute('content') !== '0';
  }
  function fetchMe() {
    if (!hasSessionHint()) return Promise.resolve({ user: null });
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

  // Turuncu nokta (bkz. injectStyleOnce'taki .nav-alert-dot yorumu) — DOM'daki üç noktayı da tek
  // hamlede günceller. Menü/çekmece henüz render edilmemişse (initAuthNav bitmeden çağrıldıysa)
  // querySelectorAll boş döner ve çağrı zararsızca no-op olur.
  let lastUnread = 0;
  function applyAlertDot(hasUnread) {
    lastUnread = hasUnread ? 1 : 0;
    document.querySelectorAll('.nav-alert-dot, .nav-avatar-alert').forEach(el => el.classList.toggle('show', !!hasUnread));
  }

  // Hesabım popup'ı (js/components/auth-modal.js) bildirim/mesaj okuduğunda, sildiğinde ya da
  // listeyi tazelediğinde bunu çağırır — nokta sayfa yenilenmeden söner/yanar. Sayının kendisi yine
  // TEK kaynaktan, /api/auth/me'den gelir (bkz. src/routes/auth.js#me) ki istemcide ikinci bir
  // "okunmamış" tanımı oluşmasın. count parametresi verilirse istek hiç atılmaz.
  window.refreshAuthNavAlert = (count) => {
    if (typeof count === 'number') { applyAlertDot(count > 0); return Promise.resolve(count); }
    return fetch('/api/auth/me', { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then(data => { const n = (data && data.unreadCount) || 0; applyAlertDot(n > 0); return n; })
      .catch(() => lastUnread);
  };

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

    // Oturum açık kullanıcı büyük olasılıkla Hesabım'ı açacak: auth-modal.js (445 KB) + bağımlılıkları
    // boşta zamanda önden indirilir (yalnızca indirme, çalıştırma yok — bkz. lazy-modals.js#
    // preloadModuleAssets; sürümlü URL'ler immutable olduğundan cihaz başına sürüm başına bir kez).
    const preloadAuthModule = () => { if (window.LazyModals && window.LazyModals.preload) window.LazyModals.preload('auth'); };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(preloadAuthModule, { timeout: 4000 });
    else setTimeout(preloadAuthModule, 1500);

    injectStyleOnce();
    const adminLink = user.role === 'admin' ? `<a href="/admin"><span>${ICON_ADMIN}</span> Admin Paneli</a><div class="nav-avatar-menu-sep"></div>` : '';
    const avatarInner = user.photoUrl
      ? `<img src="${escapeAttr(user.photoUrl)}" alt="" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`
      : initials(user.name);
    navRight.innerHTML = `
      <div class="nav-avatar-wrap">
        <button class="nav-avatar" id="nav-avatar-btn" type="button">
          <span class="nav-avatar-circle">${avatarInner}</span> ${escapeHtml(firstName(user.name))}
          <i class="nav-avatar-alert" id="nav-avatar-alert" aria-hidden="true"></i>
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
          <a href="/hesabim"><span>${ICON_ACCOUNT}</span> Hesabım <i class="nav-alert-dot" aria-hidden="true"></i></a>
          <div class="nav-avatar-menu-sep"></div>
          <a href="/aktivitelerim"><span>${ICON_ACTIVITY}</span> Aktivitelerim</a>
          <div class="nav-avatar-menu-sep"></div>
          <a href="/koleksiyonum"><span>${ICON_COLLECTION}</span> Koleksiyonum</a>
          <div class="nav-avatar-menu-sep"></div>
          ${adminLink}
          <button type="button" id="nav-logout-btn"><span>${ICON_LOGOUT}</span> Çıkış Yap</button>
        </div>
      </div>`;

    // gerçek bulgu (kullanıcı isteği, 2026-08-28): bu fonksiyon şimdiye dek yalnızca masaüstü
    // .nav-right'ı güncelliyordu — mobil çekmecenin alt kısmındaki "Giriş Yap" düğmesi
    // (site-chrome.js#headerHtml, id="nav-mobile-menu-foot") oturum açılsa da hep statik kalıyordu.
    // Aynı hesap linklerini (Hesabım/Aktivitelerim/Koleksiyonum/Admin/Çıkış Yap) burada da, .nav-mobile-link
    // satırlarıyla (tek satır = tek sayfa ismi, bkz. site-chrome.js düzeltmesi) render ediyoruz.
    const mobileFoot = document.getElementById('nav-mobile-menu-foot');
    if (mobileFoot) {
      const mobileAdminLink = user.role === 'admin' ? `<a class="nav-mobile-link" href="/admin"><span>${ICON_ADMIN}</span> Admin Paneli</a>` : '';
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
          <a class="nav-mobile-link" href="/hesabim"><span>${ICON_ACCOUNT}</span> Hesabım <i class="nav-alert-dot" aria-hidden="true"></i></a>
          <a class="nav-mobile-link" href="/aktivitelerim"><span>${ICON_ACTIVITY}</span> Aktivitelerim</a>
          <a class="nav-mobile-link" href="/koleksiyonum"><span>${ICON_COLLECTION}</span> Koleksiyonum</a>
          ${mobileAdminLink}
          <button type="button" class="nav-mobile-link" id="nav-mobile-logout-btn"><span>${ICON_LOGOUT}</span> Çıkış Yap</button>
        </div>`;
      const mobileLogoutBtn = document.getElementById('nav-mobile-logout-btn');
      if (mobileLogoutBtn) {
        mobileLogoutBtn.addEventListener('click', async () => {
          await fetch('/api/auth/logout', { method: 'POST' });
          window.location.href = '/';
        });
      }
    }

    // Nokta, menü markup'ı (masaüstü + mobil) yazıldıktan SONRA uygulanır — üç hedefin üçü de
    // artık DOM'da. Sayı zaten yukarıdaki /api/auth/me yanıtından geldiğinden ekstra istek yok.
    applyAlertDot((data.unreadCount || 0) > 0);

    const btn = document.getElementById('nav-avatar-btn');
    const menu = document.getElementById('nav-avatar-menu');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('open');
    });

    // Masaüstünde imleç avatarın üzerine gelince menü kendiliğinden açılır (kullanıcı isteği,
    // 2026-09-02). "Masaüstü" ayrımı pencere genişliğiyle DEĞİL hover yeteneğiyle yapılır: dokunmatik
    // bir cihazda mouseenter ilk dokunuşta sentetik olarak tetiklenir, genişliğe bakılsaydı geniş
    // ekranlı bir tablette tek dokunuş menüyü açıp hemen ardından toggle ile geri kapatırdı.
    // Tıklama davranışı hover'sız cihazlarda AYNEN korunur.
    // .nav-avatar-menu, .nav-avatar-wrap'in İÇİNDEDİR (bkz. yukarıdaki CSS: .nav-avatar-wrap
    // position:relative, menü absolute) — bu yüzden tek bir mouseleave yeterli, ÜRÜN mega
    // menüsündeki gibi ayrı bir gecikme/kardeş-panel sorunu yok. Yine de küçük bir gecikme
    // bırakıldı: menü ile buton arasındaki 8px boşluktan geçerken kapanmasın.
    const avatarWrap = btn.closest('.nav-avatar-wrap');
    if (avatarWrap) {
      const hoverCapable = window.matchMedia('(hover: hover) and (pointer: fine)');
      let closeTimer = null;
      avatarWrap.addEventListener('mouseenter', () => {
        if (!hoverCapable.matches) return;
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
        menu.classList.add('open');
      });
      avatarWrap.addEventListener('mouseleave', () => {
        if (!hoverCapable.matches) return;
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = setTimeout(() => menu.classList.remove('open'), 200);
      });
    }
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
      window.location.href = '/';
    });
  }

  // ---------------------------------------------------------------------------------------------
  // ÜST BİLGİ ÇUBUĞU — duyuru metni + DİL DEĞİŞTİRİCİ (EN/TR)
  // ---------------------------------------------------------------------------------------------
  // Admin panelin Site Ayarları sekmesinden (bkz. src/routes/admin.js#handleSiteSettingsAdmin,
  // src/routes/public.js#handlePublicSiteSettings) açılıp kapatılan duyuru banner'ı — auth-nav.js
  // hemen her sayfada zaten yüklü olduğundan (bkz. dosya başı yorumu) ayrı bir <script> eklemeye
  // gerek kalmadan buraya eklendi.
  //
  // DEĞİŞİKLİK (kullanıcı isteği, 2026-09-13 madde 1): "En üst bilgi çubuğundaki X işaretini
  // kaldır. Bunun yerine ... EN yazsın". Kapatma (×) düğmesi ve onun localStorage'daki "bu duyuru
  // kapatıldı" durumu TAMAMEN kaldırıldı; yerine dil değiştirici geldi.
  //
  // ÇUBUK ARTIK HER ZAMAN GÖRÜNÜR — duyuru kapalıyken bile. Gerekçe: dil değiştirici artık bir
  // DUYURUNUN eklentisi değil, sitenin kalıcı bir işlevi. Eskisi gibi yalnızca duyuru varken
  // çizilseydi, admin duyuruyu kapattığı anda kullanıcının İngilizce'ye geçme (ve İngilizce'den
  // dönme) yolu sessizce kaybolurdu. Duyuru yokken çubuk yalnızca sağdaki EN/TR düğmesini taşır.
  function injectAnnouncementStyleOnce() {
    if (document.getElementById('announcement-banner-style')) return;
    const style = document.createElement('style');
    style.id = 'announcement-banner-style';
    style.textContent = `
      .announcement-banner{display:flex; align-items:center; justify-content:center; gap:12px; background:var(--walnut); color:var(--paper-card); font-size:13px; font-weight:600; padding:10px 56px 10px 16px; text-align:center; position:relative; min-height:38px;}
      .announcement-banner a{color:inherit; text-decoration:underline;}
      /* Duyuru metni yokken çubuk yalnızca düğmeyi taşır — ortalanacak bir metin olmadığından
         yüksekliği min-height verir, içerik kutusu boş kalır. */
      .announcement-banner-lang{position:absolute; right:10px; top:50%; transform:translateY(-50%); background:transparent; border:1px solid currentColor; border-radius:100px; color:inherit; font:inherit; font-size:11px; font-weight:700; letter-spacing:0.08em; line-height:1; cursor:pointer; padding:5px 10px; opacity:0.85;}
      .announcement-banner-lang:hover{opacity:1;}
      .announcement-banner-lang[aria-busy="true"]{opacity:0.5; cursor:progress;}
      .announcement-banner-lang:focus-visible{outline:2px solid currentColor; outline-offset:2px;}
    `;
    document.head.appendChild(style);
  }

  // Düğmenin ÜZERİNDE yazan şey, tıklandığında GEÇİLECEK dildir (kullanıcı isteği: "EN'e tıklayınca
  // site İngilizce'ye dönsün ve EN yerine burada TR yazsın"). Yani Türkçedeyken 'EN', İngilizcedeyken
  // 'TR' yazar.
  function langButtonLabel(current) { return current === 'en' ? 'TR' : 'EN'; }
  function langButtonTitle(current) {
    return current === 'en' ? 'Türkçe\'ye dön' : 'Switch the site to English';
  }

  function syncLangButton(btn) {
    const current = (window.MLTranslate && window.MLTranslate.current())
      || (window.mlCurrentLang ? window.mlCurrentLang() : 'tr');
    btn.textContent = langButtonLabel(current);
    btn.title = langButtonTitle(current);
    btn.setAttribute('aria-label', langButtonTitle(current));
  }

  async function initAnnouncementBanner() {
    if (document.getElementById('announcement-banner')) return;
    injectAnnouncementStyleOnce();

    const banner = document.createElement('div');
    banner.className = 'announcement-banner';
    banner.id = 'announcement-banner';
    // data-no-translate: düğmenin kendisi ("EN"/"TR") çeviri katmanının dışında kalmalı — aksi
    // halde İngilizce moddayken çevirici "TR" etiketini de çevirmeye çalışırdı (bkz.
    // js/translate.js#walk'taki atlama kuralı).
    banner.innerHTML = '<span class="announcement-banner-text"></span>'
      + '<button type="button" class="announcement-banner-lang" id="ml-lang-toggle"'
      + ' data-no-translate translate="no">EN</button>';
    document.body.prepend(banner);

    const btn = banner.querySelector('#ml-lang-toggle');
    syncLangButton(btn);
    // Çevirici dili değiştirdiğinde (başka bir yerden de tetiklenebilir) etiket kendini düzeltsin.
    document.addEventListener('mimarlab:langchange', () => syncLangButton(btn));

    btn.addEventListener('click', async () => {
      if (btn.getAttribute('aria-busy') === 'true') return;
      btn.setAttribute('aria-busy', 'true');
      try {
        // js/translate.js yalnızca gerçekten gerektiğinde indirilir — Türkçe kalan ziyaretçi bu
        // baytları hiç almaz (bkz. o dosyanın başındaki "maliyet: sıfır" notu).
        await window.mlEnsureTranslator();
        const current = window.MLTranslate.current();
        window.MLTranslate.set(current === 'en' ? 'tr' : 'en');
      } catch (_) {
        // Çevirici yüklenemediyse (ağ) dil değişmez; düğme eski hâlinde kalır.
      } finally {
        btn.removeAttribute('aria-busy');
        syncLangButton(btn);
      }
    });

    // Duyuru metni AYRI ve GECİKMELİ: çubuk (ve dil düğmesi) site ayarları isteğini beklemeden
    // çizilir, metin geldiğinde içine yerleşir. Eskiden tam tersiydi ve ayar isteği yavaşsa çubuk
    // hiç görünmüyordu.
    let settings;
    try {
      // window.__siteSettingsPromise: index.html'in featured-project inline script'i (defer'sız,
      // bu deferred script'ten ÖNCE çalışır) aynı endpoint'i zaten çekmiş/çekiyor olabilir — varsa
      // onu paylaşıp aynı isteği ikinci kez atmayı önlüyoruz (denetim bulgusu, 2026-08-24). Diğer
      // tüm sayfalarda window.__siteSettingsPromise henüz yok, davranış eskisiyle birebir aynı kalır.
      settings = await (window.__siteSettingsPromise || (window.__siteSettingsPromise = fetch('/api/public/site-settings', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(()=>null)));
    } catch { settings = null; }
    if (!settings || !settings.announcementEnabled || !settings.announcementText) return;
    const link = safeUrl(settings.announcementLink);
    const textEl = banner.querySelector('.announcement-banner-text');
    if (textEl) {
      textEl.innerHTML = `${escapeHtml(settings.announcementText)}${link ? ` <a href="${escapeAttr(link)}">Detaylar</a>` : ''}`;
    }
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
