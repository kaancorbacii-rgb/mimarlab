// PhotoFinder — kişi pop-up'ındaki "Fotoğraflarını Bul" akışı (kullanıcı isteği, 2026-09-16
// üçüncü tur madde 3: "Kişi popuplarında Fotoğraflarım başlığının yanında 'Fotoğraflarını Bul'
// butonu olsun ve buna tıklayınca sitedeki yüklü tüm projelerden kullanıcı bir projeyi seçebilsin.
// Bu seçim seçilen projenin firmasını yöneticisine ve admine bildirim olarak gitsin. Firma
// yöneticisi veya admin bu bildirime onay verirse proje künyesine fotoğrafçı otomatik olarak
// eklensin.").
//
// js/components/photo-claim.js'in YERİNİ ALIR (o dosya, lightbox'taki "Fotoğraf bana ait"
// butonuyla birlikte kullanıcı isteği/madde 2 ile kaldırıldı). Sunucu tarafı AYNI kaldı
// (src/routes/photoClaims.js + project_photo_claims tablosu); değişen yalnızca giriş noktası ve
// kullanıcının seçtiği şey: bir GÖRSEL değil bir PROJE.
//
// ÖNEMLİ: bu modül künyeye HİÇBİR ŞEY yazmaz. Yayındaki fotoğrafçı bilgisinin tek kaynağı
// projects.photo_credit_text + project_photographers'tır ve oraya yalnızca onaydan geçen talepler
// yazılır. Admin'in gönderdiği talep sunucuda anında uygulanır.
//
// KÜNYEYE YAZILACAK AD BU DOSYADAN GİTMEZ: sunucuya yalnızca KİŞİ PROFİLİNİN anahtarı gönderilir,
// ad canonical architects.name'den okunur (bkz. photoClaims.js#resolveClaimArchitect). Serbest
// metin gönderilseydi herhangi bir üye istediği adı bir projenin künyesine önerebilirdi.
const PhotoFinder = (function () {
  // Bu modül kisi.html/proje.html/index.html gibi farklı sayfalarda çalışır; escapeHtml/escapeAttr
  // globalleri her birinde tanımlı OLMAYABİLİR (bkz. hotspot-tagger.js'teki AYNI gerekçe). Bu
  // yüzden kendi yerel kaçışlayıcısını taşır.
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function injectStyles() {
    if (document.getElementById('photo-finder-styles')) return;
    const style = document.createElement('style');
    style.id = 'photo-finder-styles';
    // DİKKAT: bu şablon dizesinde ters tırnak ya da // yorumu KULLANMA (bkz. proje notu
    // [[feedback_no_backtick_in_style_template_literals]] — enjekte edilen CSS sessizce bozulur;
    // bu tuzağa 2026-09-16 üçüncü turda gallery.js'te bir kez daha düşüldü).
    //
    // z-index 260: kisi pop-up'inin (ModalShell) USTUNDE. Ayni deger image-lightbox.js'te de
    // kullaniliyor — o da bir pop-up'in icinden aciliyor.
    style.textContent = `
      .pf-overlay{
        position:fixed; inset:0; z-index:260; display:none;
        background:rgba(27,42,61,0.55); padding:24px;
        align-items:center; justify-content:center;
        font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .pf-overlay.open{display:flex;}
      .pf-panel{
        width:min(520px, 100%); max-height:min(640px, 86vh); display:flex; flex-direction:column;
        background:var(--paper-card, #fff); color:var(--ink, #1B2A3D);
        border:1px solid var(--line, #E2E0DB); border-radius:16px;
        box-shadow:0 22px 60px rgba(15,19,26,0.35); overflow:hidden;
      }
      .pf-head{padding:18px 20px 12px; border-bottom:1px solid var(--line, #E2E0DB);}
      .pf-head h3{margin:0 0 5px; font-size:16px; font-weight:700;}
      .pf-head p{margin:0 0 12px; font-size:12.5px; line-height:1.5; color:var(--ink-soft, #6B7280);}
      .pf-search{
        width:100%; box-sizing:border-box; height:38px; padding:0 12px; font-size:13.5px;
        border:1px solid var(--line, #E2E0DB); border-radius:9px;
        background:var(--paper, #fff); color:inherit; font-family:inherit;
      }
      .pf-list{flex:1 1 auto; overflow-y:auto; padding:8px;}
      .pf-item{
        display:flex; align-items:center; gap:11px; width:100%; padding:8px 10px; border:none;
        background:none; text-align:left; font-family:inherit; color:inherit; cursor:pointer;
        border-radius:10px;
      }
      .pf-item:hover{background:var(--paper-alt, #F2F1EE);}
      .pf-item[disabled]{opacity:0.55; cursor:default;}
      .pf-thumb{
        flex:0 0 52px; width:52px; height:40px; border-radius:7px; overflow:hidden;
        background:var(--paper-alt, #F2F1EE); display:flex; align-items:center; justify-content:center;
        font-size:12px; font-weight:700; color:var(--ink-soft, #6B7280);
      }
      .pf-thumb img{width:100%; height:100%; object-fit:cover; display:block;}
      .pf-text{min-width:0; flex:1;}
      .pf-title{display:block; font-size:13.5px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
      .pf-sub{display:block; font-size:11.5px; color:var(--ink-soft, #6B7280); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
      .pf-empty{padding:18px 12px; font-size:12.5px; color:var(--ink-soft, #6B7280); text-align:center;}
      .pf-foot{padding:12px 20px 16px; border-top:1px solid var(--line, #E2E0DB);}
      .pf-msg{margin:0 0 10px; font-size:12.5px; line-height:1.45;}
      .pf-msg.err{color:#B84C4C;}
      .pf-msg.ok{color:var(--walnut, #8A6A4B);}
      .pf-close{
        width:100%; height:36px; border-radius:9px; font-size:13px; font-weight:600;
        font-family:inherit; cursor:pointer; border:1px solid var(--line, #E2E0DB);
        background:none; color:inherit;
      }
      @media (max-width:560px){
        .pf-overlay{padding:12px;}
        .pf-panel{max-height:92vh;}
      }
    `;
    document.head.appendChild(style);
  }

  // SİTE KÖKÜ — göreli görsel yollarının çözüm tabanı. `document.baseURI` DEĞİL: D1'deki bazı
  // görsel yolları köke görelidir ve BAŞINDA EĞİK ÇİZGİ YOKTUR ("projects/x.jpg" — legacy_static),
  // bu seçici ise kişi pop-up'ından açılıyor ve o sırada adres pushState ile "/kisi/<slug>" olmuş
  // olabilir. `<base href="/">` TAŞIMAYAN bir belgede (ana sayfa, /arama) baseURI de o anda
  // "/kisi/<slug>" olur ve küçük resim "/kisi/projects/x.jpg"e çözülüp 404 verirdi. Bkz. CLAUDE.md
  // "KIRIK PROFİL FOTOĞRAFI" (2026-09-16 madde 7) — AYNI kök neden, AYNI çözüm.
  // cdnImg türev üretemediği yollarda değeri OLDUĞU GİBİ döndürdüğünden (bkz. image-cdn.js#cdnImg)
  // bu sarmalayıcı onun ARDINDAN uygulanır.
  const SITE_ROOT = window.location.origin + '/';
  function siteUrl(u) {
    try { return new URL(u, SITE_ROOT).href; } catch (e) { return u; }
  }

  let overlay = null;
  let searchInput = null;
  let listEl = null;
  let msgEl = null;
  let ctx = null;          // { architectKey, architectName }
  let searchTimer = null;
  let lastFocused = null;

  function showMsg(text, kind) {
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.style.display = text ? '' : 'none';
    msgEl.className = 'pf-msg' + (kind ? ' ' + kind : '');
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('open');
    clearTimeout(searchTimer);
    ctx = null;
    document.removeEventListener('keydown', onKey, true);
    if (lastFocused && lastFocused.focus) { try { lastFocused.focus(); } catch (e) {} }
    lastFocused = null;
  }

  // capture:true — açık bir ModalShell'in (kişi pop-up'ı) KENDİ Escape dinleyicisinden ÖNCE
  // çalışsın ki Escape önce bu seçiciyi kapatsın, arkadaki pop-up'ı değil (bkz.
  // js/components/image-lightbox.js#onKey'deki AYNI gerekçe ve AYNI çözüm).
  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    close();
  }

  function ensureDom() {
    if (overlay) return;
    injectStyles();
    overlay = document.createElement('div');
    overlay.className = 'pf-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Fotoğraflarını bul');
    overlay.innerHTML =
      '<div class="pf-panel">' +
        '<div class="pf-head">' +
          '<h3>Fotoğraflarını Bul</h3>' +
          '<p class="pf-intro"></p>' +
          '<input type="text" class="pf-search" placeholder="Proje ara…" autocomplete="off">' +
        '</div>' +
        '<div class="pf-list"></div>' +
        '<div class="pf-foot">' +
          '<p class="pf-msg" style="display:none;"></p>' +
          '<button type="button" class="pf-close">Kapat</button>' +
        '</div>' +
      '</div>';
    searchInput = overlay.querySelector('.pf-search');
    listEl = overlay.querySelector('.pf-list');
    msgEl = overlay.querySelector('.pf-msg');
    overlay.querySelector('.pf-close').addEventListener('click', close);
    // Arka plana tıklayınca kapan; panelin KENDİSİNE tıklayınca kapanmasın.
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => load(searchInput.value.trim()), 220);
    });
    document.body.appendChild(overlay);
  }

  function renderList(items) {
    if (!items.length) {
      listEl.innerHTML = '<div class="pf-empty">Bu aramaya uyan proje bulunamadı.</div>';
      return;
    }
    listEl.innerHTML = items.map(it => {
      const src = it.image ? siteUrl(typeof cdnImg === 'function' ? cdnImg(it.image, 160) : it.image) : '';
      // Görseli olmayan projede baş harf yer tutucusu (hotspot-tagger.js#ht-ac-thumb ile AYNI
      // desen) — boş bırakmak satırların hizasını bozuyordu.
      const thumb = src
        ? `<span class="pf-thumb"><img src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()"></span>`
        : `<span class="pf-thumb">${esc((it.title || '?').trim().charAt(0).toLocaleUpperCase('tr'))}</span>`;
      return `<button type="button" class="pf-item" data-slug="${esc(it.slug)}" data-title="${esc(it.title)}">
        ${thumb}
        <span class="pf-text"><span class="pf-title">${esc(it.title)}</span>${it.sub ? `<span class="pf-sub">${esc(it.sub)}</span>` : ''}</span>
      </button>`;
    }).join('');
    listEl.querySelectorAll('.pf-item').forEach(btn => {
      btn.addEventListener('click', () => submit(btn));
    });
  }

  async function load(q) {
    listEl.innerHTML = '<div class="pf-empty">Yükleniyor…</div>';
    try {
      const res = await fetch(`/api/photo-claims/projects?q=${encodeURIComponent(q || '')}`);
      if (res.status === 401) {
        listEl.innerHTML = '<div class="pf-empty">Bu işlem için giriş yapmalısın.</div>';
        return;
      }
      if (!res.ok) throw new Error('x');
      const data = await res.json();
      renderList(data.items || []);
    } catch {
      listEl.innerHTML = '<div class="pf-empty">Projeler yüklenemedi, tekrar dene.</div>';
    }
  }

  async function submit(btn) {
    if (!ctx) return;
    // Listedeki TÜM satırlar kilitlenir: iki projeye aynı anda talep göndermek, ikinci isteğin
    // hız sınırına ya da mükerrer-talep hatasına çarpması demekti.
    const buttons = listEl.querySelectorAll('.pf-item');
    buttons.forEach(b => { b.disabled = true; });
    showMsg('');
    try {
      const res = await fetch('/api/photo-claims', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectSlug: btn.dataset.slug, architectSlug: ctx.architectKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showMsg(data.error || 'Talep gönderilemedi.', 'err');
        buttons.forEach(b => { b.disabled = false; });
        return;
      }
      // Admin'de sunucu talebi ANINDA uygular (bkz. photoClaims.js#createClaim) — mesaj bu iki
      // durumu ayırır, aksi halde admin "onay bekliyor" sanırdı.
      showMsg(data.status === 'approved'
        ? `“${btn.dataset.title}” künyesine eklendi. Sayfayı yenilediğinde görünecek.`
        : `“${btn.dataset.title}” için talebin onaya gönderildi. Firma yöneticisi ya da MİMARLAB onayladığında künyede görünecek.`, 'ok');
      // Onaylanan/gönderilen satır kilitli kalır (aynı projeye ikinci talep zaten reddedilir),
      // diğerleri açılır — kullanıcı tek oturumda birkaç projeyi sahiplenebilir.
      buttons.forEach(b => { if (b !== btn) b.disabled = false; });
    } catch {
      showMsg('Sunucuya ulaşılamadı, tekrar dene.', 'err');
      buttons.forEach(b => { b.disabled = false; });
    }
  }

  // opts: { architectKey, architectName } — architectKey, sunucunun kişi profilini çözeceği
  // anahtar (slug / legacy_key / ad; bkz. photoClaims.js#resolveClaimArchitect).
  function open(opts) {
    if (!opts || !opts.architectKey) return;
    ensureDom();
    ctx = { architectKey: opts.architectKey, architectName: opts.architectName || '' };
    const intro = overlay.querySelector('.pf-intro');
    intro.textContent = ctx.architectName
      ? `Fotoğrafını çektiğin projeyi seç. Talep, projenin firma yöneticilerine ve MİMARLAB yöneticilerine gider; onaylanınca “${ctx.architectName}” projenin fotoğraf künyesine eklenir.`
      : 'Fotoğrafını çektiğin projeyi seç. Talep, projenin firma yöneticilerine ve MİMARLAB yöneticilerine gider; onaylanınca adın projenin fotoğraf künyesine eklenir.';
    searchInput.value = '';
    showMsg('');
    lastFocused = document.activeElement;
    overlay.classList.add('open');
    document.addEventListener('keydown', onKey, true);
    // Sorgusuz açılış: en yeni projeler (bkz. photoClaims.js#listClaimableProjects) — kullanıcı
    // aramaya başlamadan da "sitedeki yüklü projeler"i görmeli.
    load('');
    searchInput.focus();
  }

  return { open, close };
})();
