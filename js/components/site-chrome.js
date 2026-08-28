// Site genelinde üst menü (nav) ve alt menü (footer) artık TEK kaynaktan üretilir. Önceden her sayfa
// bu markup'ın kendi kopyasını tutuyordu ve zamanla birbirinden sapıyordu — ör. proje-ekle.html,
// mimar-ekle.html, firma-ekle.html gibi sayfalarda "Ürün" açılır menüsü (mega-menu) hiç eklenmemişti,
// bu yüzden o sayfalarda Ürün'ün yanındaki çentik/ok görünmüyordu (bkz. kullanıcı isteği: "üst ve alt
// menüde yapılan değişikliklerin sitedeki tüm sayfalarda eş zamanlı güncellenmesi gerekiyor").
//
// Bu dosya senkron (defer'sız) yüklenir ve header mount noktasının HEMEN ardından çağrılır, çünkü bazı
// sayfalar (ör. urun.html) kendi satır-içi <script>'inde nav elemanlarına (urun-menu-trigger vb.)
// sayfa ayrıştırılırken (deferred script'ler çalışmadan ÖNCE) erişiyor. Footer ise DOMContentLoaded'da
// mount edilir — hiçbir script footer elemanlarına erken erişmiyor.
(function(){
  function escapeHtml(s){ const d = document.createElement('div'); d.textContent = s === undefined || s === null ? '' : s; return d.innerHTML; }
  function escapeAttr(s){ return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  // kullanıcı isteği (2026-08-28): Düello ve En İyi 100 üst menüden kaldırıldı — En İyi 100 artık
  // proje.html içinde Liste/Harita'nın yanında üçüncü bir sekme (bkz. proje.html#view-toggle-top100),
  // Düello ise footerHtml()'in Topluluk sütununda yaşıyor.
  const NAV_ITEMS = [
    { key: 'proje', href: 'proje.html', label: 'Proje' },
    { key: 'urun', href: 'urun.html', label: 'Ürün', mega: true },
    { key: 'mimar', href: 'mimar.html', label: 'Mimar' },
    { key: 'firma', href: 'firma.html', label: 'Firma' },
  ];

  // Işık modunda logo koyu (lacivert/siyah) harflerle, R'daki daire+üçgen ise her zaman mavi (bkz.
  // kullanıcı isteği) — gece modunda koyu harfler nav'ın (artık koyu) zemininde kayboluyordu, bu
  // yüzden aynı logonun harfleri BEYAZA boyanmış, R'si AYNEN mavi kalan ayrı bir PNG'si (aynı 900x150
  // ölçü) hazırlandı (bkz. logos/site/mimarlab-logo-dark.png). Footer logosu buna dahil DEĞİL —
  // footer zemini temadan bağımsız hep koyu kaldığından (bkz. [data-theme="dark"] .site-footer
  // override'ı) o logo zaten hep açık renkli, ayrı bir gece sürümüne ihtiyacı yok.
  const LOGO_LIGHT = 'logos/site/mimarlab-logo.png';
  const LOGO_DARK = 'logos/site/mimarlab-logo-dark.png';
  function currentLogoSrc(){ return currentTheme() === 'dark' ? LOGO_DARK : LOGO_LIGHT; }

  function headerHtml(active){
    const desktopLinks = NAV_ITEMS.map(item => {
      const activeClass = item.key === active ? ' active' : '';
      if(item.mega){
        return `<div class="nav-link-wrap" id="urun-menu-wrap">
        <button class="nav-link nav-link-trigger${activeClass}" id="urun-menu-trigger" type="button" aria-expanded="false" aria-controls="urun-mega-menu">
          ${escapeHtml(item.label)}
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 1l4 4 4-4"/></svg>
        </button>
      </div>`;
      }
      return `<a class="nav-link${activeClass}" href="${escapeAttr(item.href)}">${escapeHtml(item.label)}</a>`;
    }).join('\n      ');

    const mobileLinks = NAV_ITEMS.map(item => {
      const activeClass = item.key === active ? ' active' : '';
      if(item.mega){
        return `<div class="nav-mobile-accordion">
        <button type="button" class="nav-mobile-link nav-mobile-accordion-trigger${activeClass}" id="urun-mobile-trigger" aria-expanded="false" aria-controls="urun-mobile-panel">
          ${escapeHtml(item.label)}
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 1l4 4 4-4"/></svg>
        </button>
        <div class="nav-mobile-accordion-panel" id="urun-mobile-panel"></div>
      </div>`;
      }
      return `<a class="nav-mobile-link${activeClass}" href="${escapeAttr(item.href)}">${escapeHtml(item.label)}</a>`;
    }).join('\n      ');

    return `<nav class="nav">
    <a class="brand" href="index.html">
      <img class="brand-logo" id="brand-logo-img" src="${currentLogoSrc()}" alt="MimarLab">
    </a>
    <div class="nav-search">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" id="f-search-topnav" placeholder="Ara..." aria-label="Ara">
    </div>
    <div class="nav-links">
      ${desktopLinks}
    </div>
    <div class="mega-menu" id="urun-mega-menu"></div>
    <div class="nav-right">
      <a class="nav-rate" href="giris-yap.html">Giriş Yap</a>
    </div>
    <button class="nav-hamburger" id="nav-hamburger" aria-label="Menü">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
    </button>
    <div class="nav-mobile-menu" id="nav-mobile-menu">
      <div class="nav-mobile-search">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="f-search-nav" placeholder="Ara..." aria-label="Ara">
      </div>
      ${mobileLinks}
    </div>
  </nav>`;
  }

  function footerHtml(){
    return `<footer class="site-footer">
    <div class="footer-top">
      <div class="footer-brand">
        <a class="footer-logo" href="index.html">
          <img class="footer-logo-img" src="logos/site/mimarlab-logo-footer.png" alt="MimarLab" loading="lazy" decoding="async">
        </a>
        <p>Mimarlık, iç mimarlık, peyzaj mimarlığı disiplinlerini ve çeşitli firmaları bir araya getiren mimar platformu.</p>
      </div>
      <div class="footer-col"><h4>Ana Menü</h4><a href="proje.html">Proje</a><a href="urun.html">Ürün</a><a href="mimar.html">Mimar</a><a href="firma.html">Firma</a><a href="duello.html">Düello</a><a href="en-iyi-100.html">En İyi 100</a></div>
      <div class="footer-col"><h4>Topluluk</h4><a href="giris-yap.html">Giriş Yap</a><a href="uye-ol.html">Üye Ol</a><a href="satin-al.html">Rozet Al</a><a href="iade-et.html">İade Et</a><a href="duello.html">Düello</a></div>
      <div class="footer-col"><h4>Kurumsal</h4><a href="hakkinda.html">Hakkında</a><a href="iletisim.html">İletişim</a><a href="gizlilik-politikasi.html">Gizlilik Politikası</a><a href="hizmet-sartlari.html">Hizmet Şartları</a></div>
      <div class="footer-col footer-newsletter">
        <h4>Bülten</h4>
        <p class="footer-newsletter-desc">Yeni proje, ürün, mimar ve firmalar e-postana gelsin.</p>
        <form class="footer-newsletter-form" id="footer-newsletter-form">
          <input type="email" class="footer-newsletter-input" id="footer-newsletter-email" placeholder="E-posta adresin" required aria-label="E-posta adresin">
          <button type="submit" class="footer-newsletter-btn">Abone Ol</button>
        </form>
        <div class="footer-newsletter-msg" id="footer-newsletter-msg" role="status" aria-live="polite"></div>
      </div>
    </div>
    <div class="footer-bottom">
      <div class="footer-social">
        <a href="https://www.instagram.com/mimarlabcom/" target="_blank" rel="noopener" aria-label="Instagram"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/></svg></a>
        <a href="https://x.com/mimarlabcom?s=11&amp;t=ijRg66Se2p_FxlB3-aK-6w" target="_blank" rel="noopener" aria-label="X"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.3 2H21l-7.3 8.3L22.2 22h-6.8l-5.3-6.9L4 22H1.3l7.8-8.9L1.5 2h6.9l4.8 6.3L18.3 2z"/></svg></a>
        <a href="https://www.linkedin.com/company/mimarlab/" target="_blank" rel="noopener" aria-label="LinkedIn"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M4.5 3.5A2 2 0 1 0 4.5 7.5 2 2 0 0 0 4.5 3.5zM3 9h3v12H3zM10 9h2.9v1.6h.1c.4-.8 1.5-1.6 3-1.6 3.2 0 3.8 2.1 3.8 4.9V21h-3v-6.6c0-1.6 0-3.6-2.2-3.6s-2.5 1.7-2.5 3.5V21H10z"/></svg></a>
      </div>
      <span class="footer-copyright">© Tüm hakları saklıdır. MİMARLAB, 2026<br>Sitede yer alan tüm görseller ilgili kişi veya firmaya aittir.</span>
      <button type="button" class="footer-theme-toggle" id="footer-theme-toggle" aria-pressed="false" aria-label="Gece modunu değiştir">
        <span class="theme-toggle-icon theme-icon-sun" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8L6 18M18 6l1.8-1.8"/></svg></span>
        <span class="theme-toggle-icon theme-icon-moon" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 14.5a8.5 8.5 0 1 1-9-11 7 7 0 0 0 9 11z"/></svg></span>
        <span class="theme-toggle-knob" aria-hidden="true"></span>
      </button>
    </div>
  </footer>`;
  }

  // Footer'da enjekte edilen ek stiller (bkz. wireNavSearch'teki AYNI "bir kere enjekte et" deseni) —
  // footer'ın kendi :root override'ı (bkz. her sayfanın <style>'ındaki [data-theme="dark"] .site-footer
  // bloğu, kullanıcı isteği: "gece modu") --ink/--paper/--brass-soft'u footer içinde SABİT tuttuğundan,
  // burada var(--paper) vb. kullanmak footer HER ZAMAN aynı (koyu zemin + açık yazı) görünmesini sağlar.
  function injectFooterStyle(){
    if(document.getElementById('footer-extra-style')) return;
    const style = document.createElement('style');
    style.id = 'footer-extra-style';
    style.textContent = `
      .footer-top{grid-template-columns: 1.15fr 0.75fr 0.85fr 0.95fr 1.15fr;}
      /* Alt satır: sosyal ikonlar sol kenara, telif hakkı ortaya, gece/gündüz düğmesi sağ kenara
         (bkz. kullanıcı isteği: "sol ve sağ hizayla eşitle") — grid'in dış iki sütunu 1fr olduğundan
         orta sütun (telif metni) sosyal/toggle genişliklerinden bağımsız her zaman TAM ortada kalır. */
      .footer-bottom{display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:16px; max-width:1080px; margin:0 auto; box-sizing:border-box;}
      .footer-bottom .footer-social{justify-self:start;}
      .footer-copyright{justify-self:center; text-align:center;}
      .footer-bottom .footer-theme-toggle{justify-self:end;}
      .footer-social{display:flex; align-items:center; gap:14px; height:28px;}
      .footer-social a{display:flex; align-items:center; justify-content:center;}
      .footer-social svg{display:block;}
      .footer-theme-toggle{
        position:relative; display:inline-flex; align-items:center; flex-shrink:0;
        width:52px; height:28px; padding:0; border-radius:100px; border:none;
        background:var(--brass); color:#fff; cursor:pointer; overflow:hidden;
        transition: background 0.2s ease;
      }
      [data-theme="dark"] .footer-theme-toggle{background:#333B46;}
      .footer-theme-toggle:hover{opacity:0.92;}
      .footer-theme-toggle .theme-toggle-icon{
        position:absolute; top:50%; transform:translateY(-50%);
        width:14px; height:14px; display:flex; align-items:center; justify-content:center; color:#fff;
      }
      .footer-theme-toggle .theme-icon-sun{left:7px;}
      .footer-theme-toggle .theme-icon-moon{right:7px;}
      .footer-theme-toggle .theme-toggle-knob{
        position:absolute; top:3px; left:3px;
        width:22px; height:22px; border-radius:50%; background:#fff;
        transition: left 0.2s ease;
      }
      [data-theme="dark"] .footer-theme-toggle .theme-toggle-knob{left:27px;}
      .footer-newsletter-desc{font-size:12.5px; color:rgba(237,240,243,0.6); margin:0 0 12px; max-width:260px;}
      .footer-newsletter-form{position:relative;}
      .footer-newsletter-input{width:100%; box-sizing:border-box; height:36px; background:rgba(237,240,243,0.08); border:1px solid rgba(237,240,243,0.2); border-radius:100px; padding:0 92px 0 14px; font-family:inherit; font-size:13px; color:var(--paper); outline:none;}
      .footer-newsletter-input::placeholder{color:rgba(237,240,243,0.45);}
      .footer-newsletter-input:focus-visible{box-shadow:0 0 0 2px var(--brass-soft) inset;}
      .footer-newsletter-btn{position:absolute; top:4px; right:4px; bottom:4px; background:var(--brass-soft); color:var(--ink); border:none; border-radius:100px; padding:0 16px; font-weight:600; font-size:12px; white-space:nowrap; cursor:pointer;}
      .footer-newsletter-btn:hover{opacity:0.9;}
      .footer-newsletter-btn:disabled{opacity:0.6; cursor:default;}
      .footer-newsletter-msg{font-size:12px; margin-top:8px; min-height:16px;}
      .footer-newsletter-msg.ok{color:#8FD6A8;}
      .footer-newsletter-msg.err{color:#E39B9B;}
      @media (max-width: 860px){
        .footer-top{grid-template-columns: 1fr 1fr; column-gap:20px;}
        .footer-brand{grid-column:1 / -1;}
      }
      /* kullanıcı isteği (2026-08-28): mobilde en alt satır artık 3 ayrı satıra yığılır — sırasıyla
         gece/gündüz düğmesi, sosyal ikonlar, © telif metni (bkz. footerHtml() içindeki DOM sırası:
         social, copyright, theme-toggle — masaüstü grid sırası korunur, burada yalnızca CSS order
         özelliğiyle görsel sıra değiştirilir). Aynı gün içindeki önceki "tek satırda kalsın" kararının
         (bkz. git geçmişi) yerini alır. */
      @media (max-width: 560px){
        .footer-bottom{display:flex; flex-direction:column; align-items:center; gap:14px;}
        .footer-theme-toggle{order:1;}
        .footer-social{order:2;}
        .footer-copyright{order:3; text-align:center;}
      }
    `;
    document.head.appendChild(style);
  }

  function currentTheme(){
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(theme){
    if(theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = theme;
    try{ localStorage.setItem('mimarlab-theme', theme); }catch(e){}
    const logoImg = document.getElementById('brand-logo-img');
    if(logoImg) logoImg.src = theme === 'dark' ? LOGO_DARK : LOGO_LIGHT;
  }

  function wireFooterTheme(){
    const btn = document.getElementById('footer-theme-toggle');
    if(!btn || btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.setAttribute('aria-pressed', String(currentTheme() === 'dark'));
    btn.addEventListener('click', ()=>{
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      btn.setAttribute('aria-pressed', String(next === 'dark'));
    });
  }

  const NEWSLETTER_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function wireFooterNewsletter(){
    const form = document.getElementById('footer-newsletter-form');
    const msg = document.getElementById('footer-newsletter-msg');
    if(!form || !msg || form.dataset.wired) return;
    form.dataset.wired = '1';
    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const input = document.getElementById('footer-newsletter-email');
      const email = (input.value || '').trim();
      const btn = form.querySelector('button[type="submit"]');
      msg.textContent = '';
      msg.className = 'footer-newsletter-msg';
      if(!NEWSLETTER_EMAIL_RE.test(email)){
        msg.textContent = 'Geçerli bir e-posta adresi gir.';
        msg.className = 'footer-newsletter-msg err';
        return;
      }
      btn.disabled = true;
      try{
        const res = await fetch('/api/newsletter/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json().catch(()=>({}));
        if(res.ok){
          msg.textContent = 'Abone oldun, teşekkürler!';
          msg.className = 'footer-newsletter-msg ok';
          form.reset();
        } else {
          msg.textContent = data.error || 'Bir şeyler ters gitti, tekrar dene.';
          msg.className = 'footer-newsletter-msg err';
        }
      } catch(err){
        msg.textContent = 'Bağlantı hatası, tekrar dene.';
        msg.className = 'footer-newsletter-msg err';
      } finally {
        btn.disabled = false;
      }
    });
  }

  // kullanıcı isteği (2026-08-28, ekli Architonic ekran görüntüleri referans alınarak): üst
  // menüdeki arama kutusuna tıklayınca artık küçük bir öneri açılır penceresi DEĞİL, tüm ekranı
  // kaplayan bir popup büyüyor — üstte büyük arama kutusu, boşken "Önerilen Aramalar" çipleri +
  // "Görsel ile Ürün Arama" bölümü (bkz. aşağıdaki NAV_SEARCH_RECOMMENDED), yazmaya başlanınca
  // öneriler AYNI /api/public/search-suggest ucundan (eski panelin kullandığı UÇLA BİREBİR AYNI)
  // canlı sonuçlarla değişiyor. Görsel arama bölümü YALNIZCA görsel — hiçbir dosya seçici/URL
  // gönderimi bağlı değil (kullanıcı isteği: "ürün arama kısmı şimdilik aktif olmasın").
  const NAV_SEARCH_RECOMMENDED = ['Villa', 'Ofis Projesi', 'Restorasyon', 'Peyzaj Tasarımı'];
  let navSearchModalApi = null;

  function ensureNavSearchModal(){
    if(navSearchModalApi) return navSearchModalApi;

    if(!document.getElementById('nav-search-modal-style')){
      const style = document.createElement('style');
      style.id = 'nav-search-modal-style';
      style.textContent = `
        .nav-search, .nav-mobile-search{position:relative;}
        .nav-search-modal-overlay{
          display:none; position:fixed; inset:0; z-index:500;
          background:rgba(20,24,30,0.62); backdrop-filter:blur(2px);
          align-items:flex-start; justify-content:center; padding:80px 20px 20px;
          overflow-y:auto;
        }
        .nav-search-modal-overlay.open{display:flex;}
        .nav-search-modal{
          width:100%; max-width:720px; background:var(--paper-card); border-radius:20px;
          padding:28px; position:relative; box-shadow:0 30px 70px rgba(0,0,0,0.35);
        }
        .nav-search-modal-close{
          position:absolute; top:16px; right:16px; background:none; border:none; color:var(--ink-soft);
          padding:8px; cursor:pointer; display:flex; border-radius:50%;
        }
        .nav-search-modal-close:hover{color:var(--ink); background:var(--paper-alt);}
        .nav-search-modal-input-row{
          display:flex; align-items:center; gap:12px; border:1.5px solid var(--line); border-radius:100px;
          padding:14px 20px; margin-right:36px;
        }
        .nav-search-modal-input-row svg{flex-shrink:0; color:var(--ink-soft);}
        .nav-search-modal-input-row input{
          flex:1; min-width:0; border:none; outline:none; background:none; font-family:inherit;
          font-size:15px; color:var(--ink);
        }
        .nav-search-modal-input-row input::placeholder{color:var(--ink-soft);}
        .nav-search-modal-section{margin-top:26px;}
        .nav-search-modal-section-title{font-size:14px; font-weight:700; color:var(--ink); margin:0 0 14px;}
        .nav-search-modal-chips{display:flex; flex-wrap:wrap; gap:10px;}
        .nav-search-modal-chip{
          background:var(--paper); border:1px solid var(--line); border-radius:100px; padding:9px 18px;
          font-family:inherit; font-size:13px; font-weight:600; color:var(--ink); cursor:pointer;
        }
        .nav-search-modal-chip:hover{border-color:var(--walnut); background:var(--paper-alt);}
        .nav-search-modal-results{display:flex; flex-direction:column; gap:2px;}
        .nav-search-modal-row{display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:10px; font-size:13.5px; color:var(--ink);}
        .nav-search-modal-row:hover{background:var(--paper-alt);}
        .nav-search-modal-row-tag{flex-shrink:0; font-family:'IBM Plex Mono', monospace; font-size:10px; text-transform:uppercase; letter-spacing:0.04em; color:var(--ink-soft); background:var(--paper-alt); border-radius:100px; padding:2px 8px;}
        .nav-search-modal-row-title{flex:1; min-width:0; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
        .nav-search-modal-row-meta{flex-shrink:0; font-size:11.5px; color:var(--ink-soft); max-width:140px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
        .nav-search-modal-more{display:block; margin-top:6px; padding:10px 12px; font-size:12.5px; font-weight:600; color:var(--brass); text-align:center;}
        .nav-search-modal-empty{padding:14px 12px; font-size:12.5px; color:var(--ink-soft); text-align:center;}
        .nav-search-modal-image-box{
          display:flex; align-items:center; gap:18px; border:1.5px dashed var(--line); border-radius:14px;
          padding:20px;
        }
        .nav-search-modal-image-drop{flex:1; min-width:0; text-align:center; color:var(--ink-soft); font-size:12.5px; line-height:1.6;}
        .nav-search-modal-image-drop strong{color:var(--walnut); font-weight:600;}
        .nav-search-modal-image-or{flex-shrink:0; font-size:11px; font-weight:600; color:var(--ink-soft); text-transform:uppercase; letter-spacing:0.04em;}
        .nav-search-modal-image-paste{
          flex:1; min-width:0; display:flex; align-items:center; gap:8px; border:1px solid var(--line);
          border-radius:10px; padding:10px 14px; background:var(--paper);
        }
        .nav-search-modal-image-paste svg{flex-shrink:0; color:var(--ink-soft);}
        .nav-search-modal-image-paste input{flex:1; min-width:0; border:none; outline:none; background:none; font-family:inherit; font-size:12.5px; color:var(--ink);}
        .nav-search-modal-image-paste input::placeholder{color:var(--ink-soft);}
        @media (max-width:640px){
          .nav-search-modal-overlay{padding:60px 12px 12px;}
          .nav-search-modal{padding:22px;}
          .nav-search-modal-image-box{flex-direction:column;}
        }
      `;
      document.head.appendChild(style);
    }

    const overlay = document.createElement('div');
    overlay.className = 'nav-search-modal-overlay';
    overlay.innerHTML = `
      <div class="nav-search-modal" role="dialog" aria-modal="true" aria-label="Ara">
        <button type="button" class="nav-search-modal-close" aria-label="Kapat"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        <div class="nav-search-modal-input-row">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="nav-search-modal-input" placeholder="Neye ihtiyacınız olduğunu yazın – bulmanıza yardımcı olalım" aria-label="Ara">
        </div>
        <div class="nav-search-modal-section" id="nav-search-modal-body"></div>
        <div class="nav-search-modal-section">
          <div class="nav-search-modal-section-title">Görsel ile Ürün Arama</div>
          <div class="nav-search-modal-image-box">
            <div class="nav-search-modal-image-drop">
              Görselini buraya sürükle veya <strong>seçmek için tıkla</strong><br>PNG, JPG veya JPEG (Maks. 10mb)
            </div>
            <div class="nav-search-modal-image-or">veya</div>
            <label class="nav-search-modal-image-paste">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              <input type="text" placeholder="Görsel URL'si yapıştır" aria-label="Görsel URL'si yapıştır" disabled>
            </label>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const modalInput = overlay.querySelector('#nav-search-modal-input');
    const body = overlay.querySelector('#nav-search-modal-body');
    let debounceTimer = null;
    let currentQuery = '';

    function renderRecommended(){
      body.innerHTML = `
        <div class="nav-search-modal-section-title">Önerilen Aramalar</div>
        <div class="nav-search-modal-chips">${NAV_SEARCH_RECOMMENDED.map(term =>
          `<button type="button" class="nav-search-modal-chip" data-term="${escapeAttr(term)}">${escapeHtml(term)}</button>`
        ).join('')}</div>`;
      body.querySelectorAll('.nav-search-modal-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          window.location.href = 'arama.html?q=' + encodeURIComponent(btn.dataset.term);
        });
      });
    }

    function renderResults(query, data){
      const items = (data && data.items) || [];
      if(!items.length){
        body.innerHTML = `<div class="nav-search-modal-empty">"${escapeHtml(query)}" için öneri bulunamadı.</div>`;
        return;
      }
      const rows = items.map(it => `<a class="nav-search-modal-row" href="${escapeAttr(it.href)}">
          <span class="nav-search-modal-row-tag">${escapeHtml(it.label)}</span>
          <span class="nav-search-modal-row-title">${escapeHtml(it.title)}</span>
          <span class="nav-search-modal-row-meta">${escapeHtml(it.meta || '')}</span>
        </a>`).join('');
      const moreHref = 'arama.html?q=' + encodeURIComponent(query);
      body.innerHTML = `<div class="nav-search-modal-results">${rows}</div>
        <a class="nav-search-modal-more" href="${escapeAttr(moreHref)}">"${escapeHtml(query)}" için tüm sonuçları gör (${data.total})</a>`;
    }

    modalInput.addEventListener('input', () => {
      const query = modalInput.value.trim();
      clearTimeout(debounceTimer);
      if(query.length < 2){ renderRecommended(); return; }
      debounceTimer = setTimeout(() => {
        currentQuery = query;
        fetch('/api/public/search-suggest?q=' + encodeURIComponent(query))
          .then(res => res.ok ? res.json() : { items: [], total: 0 })
          .then(data => { if(modalInput.value.trim() === currentQuery) renderResults(currentQuery, data); })
          .catch(() => {});
      }, 200);
    });
    modalInput.addEventListener('keydown', (e) => {
      if(e.key === 'Enter' && modalInput.value.trim()){
        window.location.href = 'arama.html?q=' + encodeURIComponent(modalInput.value.trim());
      } else if(e.key === 'Escape'){
        close();
      }
    });

    function close(){
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    }
    overlay.querySelector('.nav-search-modal-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if(e.target === overlay) close(); });

    navSearchModalApi = {
      open(prefill){
        modalInput.value = prefill || '';
        if(modalInput.value.trim().length >= 2) modalInput.dispatchEvent(new Event('input'));
        else renderRecommended();
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
        setTimeout(() => modalInput.focus(), 0);
      },
    };
    return navSearchModalApi;
  }

  function wireNavSearch(){
    document.querySelectorAll('.nav-search, .nav-mobile-search').forEach(wrap=>{
      const inp = wrap.querySelector('input');
      if(!inp || inp.dataset.navSuggestWired) return;
      inp.dataset.navSuggestWired = '1';
      // Kutunun kendisi artık yalnızca bir TETİKLEYİCİ — gerçek yazma popup'ın kendi büyük
      // kutusunda olur (bkz. ensureNavSearchModal), bu yüzden odaklanır odaklanmaz hemen bulanır
      // (klavye/mobil ekran klavyesi kısa bir an bile bu küçük kutuda açılmaz).
      inp.addEventListener('focus', () => {
        inp.blur();
        ensureNavSearchModal().open(inp.value.trim());
      });
    });
  }
  window.wireNavSearch = wireNavSearch;

  function wireHamburger(){
    const navHamburger = document.getElementById('nav-hamburger');
    const navMobileMenu = document.getElementById('nav-mobile-menu');
    if(!navHamburger || !navMobileMenu) return;
    navHamburger.addEventListener('click', ()=>{ navMobileMenu.classList.toggle('open'); });
    document.addEventListener('click', (e)=>{
      if(!navMobileMenu.classList.contains('open')) return;
      if(!navHamburger.contains(e.target) && !navMobileMenu.contains(e.target)) navMobileMenu.classList.remove('open');
    });
    // gerçek bulgu (denetim, 2026-08-24): mega-menü (nav-product-menu.js), arama önerileri paneli
    // (wireNavSearch aşağıda) ve her modal Escape ile kapanırken, sitedeki hemen her sayfada yer alan
    // bu mobil hamburger menüsü yalnızca dışarı tıklama/tekrar tıklama ile kapanıyordu — klavye
    // kullanıcıları (ve Escape'in her yerde çalışmasına alışmış herkes) için tutarsız bir boşluktu.
    document.addEventListener('keydown', (e)=>{
      if(e.key === 'Escape' && navMobileMenu.classList.contains('open')) navMobileMenu.classList.remove('open');
    });
  }

  const headerMount = document.getElementById('site-header-mount');
  if(headerMount){
    const active = headerMount.getAttribute('data-nav-active') || '';
    headerMount.outerHTML = headerHtml(active);
  }
  wireHamburger();
  wireNavSearch();

  function mountFooter(){
    const footerMount = document.getElementById('site-footer-mount');
    if(footerMount) footerMount.outerHTML = footerHtml();
    injectFooterStyle();
    wireFooterTheme();
    wireFooterNewsletter();
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', mountFooter);
  } else {
    mountFooter();
  }
})();
