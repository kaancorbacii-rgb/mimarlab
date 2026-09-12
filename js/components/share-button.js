// ShareWidget — pop-up modallarda Kaydet butonunun yanına eklenen "Paylaş" butonu (bkz. kullanıcı
// isteği: font/boyut/yükseklik Kaydet ile birebir aynı pil olsun). save-widget.js/rating-widget.js
// ile AYNI desen — modal-shell.js gibi içerikten bağımsız, her sayfada
// <script src="js/components/share-button.js"> ile dahil edilir, global `ShareWidget` nesnesini
// dışa verir.
//
// PAYLAŞ POPOVER'I (kullanıcı isteği, 2026-09-12: "Tüm popuplardaki Paylaş iconuna tıklayınca ...
// küçük bir popup açılsın ve kullanıcı ister linki kopyalasın isterse sosyal medyalardan gönderiyi
// bir başkasına iletebilsin. Bizim temaya uygun bir tasarım yap.") — Architonic referansı: üstte
// yuvarlak sosyal ikon satırı + kapat ×, altta salt-okunur bağlantı kutusu + "Kopyala" butonu.
//   * Eskiden navigator.share destekleyen tarayıcıda (macOS Safari dahil) popover HİÇ açılmıyordu —
//     artık Paylaş HER ZAMAN bu popover'ı açar; sistem paylaşım sayfası varsa ikon satırının sonunda
//     "Diğer" olarak durur.
//   * Popover <body>'ye taşınıp position:fixed ile butonun yanına yerleştirilir: modal-shell paneli
//     `transform` taşıdığından (açılış animasyonu) içindeki "fixed" bir öğe paneli containing block
//     alır ve panelin overflow:hidden'ı onu keserdi (bkz. modal-shell.js'teki AYNI gerçek bulgu ve
//     site-chrome.js'teki 2026-09-12 alt sayfa notu). Konum görünür alana sıkıştırılır.
const ShareWidget = (function () {
  function injectStyles() {
    if (document.getElementById('share-widget-styles')) return;
    const style = document.createElement('style');
    style.id = 'share-widget-styles';
    // .share-btn artık yalnızca ikon taşıyor (bkz. kullanıcı isteği: "Paylaş" metni kaldırılsın) —
    // sabit kare bir pil olarak Kaydet ile aynı yükseklikte durur ama metin olmadığından genişliği
    // yüksekliğine eşitlenir (kare dokunma hedefi).
    style.textContent = `
      .share-widget{position:relative; display:inline-flex; flex-shrink:0;}
      .share-btn{
        display:inline-flex; align-items:center; justify-content:center;
        flex-shrink:0;
        height:32px !important; width:32px !important; min-width:32px !important; box-sizing:border-box;
        background:var(--paper-card); border:1px solid var(--line); border-radius:100px;
        padding:0 !important; color:var(--ink-soft);
        font-family:inherit; line-height:1;
      }
      .share-btn:hover, .share-btn[aria-expanded="true"]{border-color:var(--walnut); color:var(--ink);}
      .share-btn svg{flex-shrink:0;}
      .share-popover{
        display:none; position:fixed; z-index:400; box-sizing:border-box;
        width:min(348px, calc(100vw - 24px));
        background:var(--paper-card); border:1px solid var(--line); border-radius:16px;
        box-shadow:0 16px 40px rgba(27,42,61,0.22); padding:14px 14px 14px;
        font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:var(--ink);
      }
      .share-popover.open{display:block;}
      .share-popover-head{display:flex; align-items:center; justify-content:space-between; margin:0 0 10px;}
      .share-popover-title{font-size:13px; font-weight:700; color:var(--ink); margin:0;}
      .share-popover-close{
        width:28px; height:28px; border-radius:50%; border:none; background:var(--paper-alt); color:var(--ink-soft);
        display:flex; align-items:center; justify-content:center; cursor:pointer; padding:0; line-height:0;
      }
      .share-popover-close:hover{color:var(--ink);}
      .share-popover-icons{display:flex; flex-wrap:wrap; gap:6px; margin:0 0 12px;}
      .share-icon{
        width:38px; height:38px; border-radius:50%; border:1px solid var(--line); background:var(--paper-card);
        color:var(--ink); display:inline-flex; align-items:center; justify-content:center; padding:0;
        cursor:pointer; text-decoration:none; transition:background .15s, color .15s, border-color .15s;
      }
      /* GERÇEK BULGU (2026-09-12, Instagram turunda görüldü): "Diğer uygulamalar" (…) düğmesi
         navigator.share YOKSA <button hidden> olarak basılıyor ama yukarıdaki display:inline-flex
         tarayıcının [hidden]{display:none} kuralını EZİYOR — masaüstü Chrome/Firefox'ta ölü bir
         düğme olarak görünüyor, tıklanınca (navigator.share undefined) sessizce hiçbir şey
         yapmadan popover'ı kapatıyordu. Aynı sınıf tuzağı site genelinde kayıtlı (bkz. menü ikon
         kuralının display:flex dayatması). */
      .share-icon[hidden]{display:none;}
      .share-icon:hover{background:var(--ink); border-color:var(--ink); color:var(--paper-card);}
      .share-icon svg{display:block;}
      .share-popover-link{display:flex; gap:8px; align-items:stretch;}
      .share-popover-url{
        flex:1; min-width:0; box-sizing:border-box; height:40px; padding:0 12px; border:1px solid var(--line);
        border-radius:10px; background:var(--paper); color:var(--ink-soft); font-family:inherit; font-size:12.5px;
        text-overflow:ellipsis; overflow:hidden; white-space:nowrap;
      }
      .share-popover-url:focus{outline:none; border-color:var(--walnut);}
      .share-popover-copy{
        flex-shrink:0; display:inline-flex; align-items:center; gap:6px; height:40px; padding:0 14px;
        border:none; border-radius:10px; background:var(--walnut); color:#fff; font-family:inherit;
        font-size:13px; font-weight:700; cursor:pointer;
      }
      .share-popover-copy:hover{filter:brightness(0.94);}
      .share-popover-copy.copied{background:var(--ink);}
      /* Puanla/Kaydet/Paylaş(/Websitesi) — Apple/Google dokunma hedefi standartları (bkz. kullanıcı
         isteği): pil yüksekliği en az 48px, tıklanabilir alan en az 44x44px. */
      @media (max-width:860px){
        .share-btn{height:48px !important; width:48px !important; min-width:48px !important;}
        .share-widget{flex-shrink:0 !important; min-width:44px !important;}
        .share-icon{width:40px; height:40px;}
      }
    `;
    document.head.appendChild(style);
  }

  const ICON_SHARE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.6" x2="15.4" y2="6.4"/><line x1="8.6" y1="13.4" x2="15.4" y2="17.6"/></svg>`;
  const ICON_COPY = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  const ICON_CLOSE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  const ICON_INSTAGRAM = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="2.6" y="2.6" width="18.8" height="18.8" rx="5.4"/><circle cx="12" cy="12" r="4.1"/><circle cx="17.4" cy="6.6" r="1.2" fill="currentColor" stroke="none"/></svg>`;
  const ICON_FACEBOOK = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 22v-8.2h2.8l.4-3.2h-3.2V8.5c0-.9.3-1.6 1.6-1.6h1.7V4.1c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.4H7.3v3.2h2.8V22h3.4z"/></svg>`;
  const ICON_X = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.3 2H21l-7.3 8.3L22.2 22h-6.8l-5.3-6.9L4 22H1.3l7.8-8.9L1.5 2h6.9l4.8 6.3L18.3 2z"/></svg>`;
  const ICON_LINKEDIN = `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M4.5 3.5A2 2 0 1 0 4.5 7.5 2 2 0 0 0 4.5 3.5zM3 9h3v12H3zM10 9h2.9v1.6h.1c.4-.8 1.5-1.6 3-1.6 3.2 0 3.8 2.1 3.8 4.9V21h-3v-6.6c0-1.6 0-3.6-2.2-3.6s-2.5 1.7-2.5 3.5V21H10z"/></svg>`;
  const ICON_MAIL = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 6 10 7 10-7"/></svg>`;
  const ICON_WHATSAPP = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.8.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5C10 9 9.5 7.8 9.3 7.3c-.2-.5-.4-.4-.5-.4h-.5c-.2 0-.5.1-.7.3-.2.3-1 1-1 2.3s1 2.7 1.1 2.9c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.7-.7 1.9-1.3.2-.7.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3z"/><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`;
  const ICON_TELEGRAM = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M21.9 4.3 18.7 19.4c-.2 1-.9 1.3-1.7.8l-4.8-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.9 8.9-8c.4-.3-.1-.5-.6-.2l-11 6.9-4.7-1.5c-1-.3-1-1 .2-1.5l18.4-7.1c.9-.3 1.6.2 1.5 1.2z"/></svg>`;
  const ICON_MORE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`;

  // Paylaşım hedefleri — kanal adları src/routes/shares.js#SHARE_CHANNELS ile AYNI (Paylaştıklarım kaydı).
  //
  // INSTAGRAM İLK SIRADA (kullanıcı isteği, 2026-09-12: "Tüm popuplarda paylaş butonlarında ilk
  // sıraya instagram'ı koy") ve `href` TAŞIMAZ — çünkü Instagram'ın diğerleri gibi bir web paylaşım
  // ucu YOKTUR: `?url=` alan bir sharer adresi sunmaz (bir gönderiye bağlantı ancak hikâye/DM/
  // biyografi içinden, uygulamanın kendisinden eklenebilir). Düz bir <a href="instagram.com">
  // kullanıcıyı bağlantıyı KAYBEDEREK Instagram ana sayfasına atardı.
  // Bu yüzden aşağıdaki tıklama dinleyicisinde ÖZEL bir dal var (bkz. action === 'instagram'):
  //   * navigator.share varsa (mobil/tablet, Instagram'ın gerçek hedef olarak göründüğü yer)
  //     sistem paylaşım sayfası açılır — "Instagram'a paylaş"ın tek gerçek çalışan yolu budur;
  //   * yoksa (masaüstü) bağlantı panoya KOPYALANIR ve instagram.com yeni sekmede açılır, kullanıcı
  //     hikâyesine/DM'ine yapıştırır. Kopyalama başarısızsa sekme yine de açılır.
  const TARGETS = [
    { action: 'instagram', label: "Instagram'da paylaş", icon: ICON_INSTAGRAM },
    { action: 'facebook', label: "Facebook'ta paylaş", icon: ICON_FACEBOOK, href: (t, u) => `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { action: 'x', label: "X'te paylaş", icon: ICON_X, href: (t, u) => `https://twitter.com/intent/tweet?text=${t}&url=${u}` },
    { action: 'linkedin', label: "LinkedIn'de paylaş", icon: ICON_LINKEDIN, href: (t, u) => `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
    { action: 'email', label: 'E-postayla gönder', icon: ICON_MAIL, href: (t, u) => `mailto:?subject=${t}&body=${t}%0A%0A${u}` },
    // WhatsApp: `wa.me` DEĞİL `api.whatsapp.com/send` (kullanıcı bildirimi, 2026-09-12: "Mobilde
    // WhatsApp'tan paylaşmaya çalıştığımda konuşmaya herhangi bir link, içerik vs. yansımıyor").
    //
    // ÖLÇÜM: ürettiğimiz href DOĞRUYDU — canlıda `https://wa.me/?text=<başlık>%20<url>` üretiliyor
    // ve o adres WhatsApp tarafından `https://api.whatsapp.com/send/?text=…&type=custom_url&
    // app_absent=0` adresine yönlendirilip AÇILAN SAYFADA metin eksiksiz görünüyor (doğrulandı).
    // Yani kayıp bizim tarafımızda değil, `wa.me` -> UYGULAMA devrinde: wa.me telefon numarasına
    // mesaj göndermek için tasarlanmış bir kısaltma ve mobil uygulama onu bir universal link olarak
    // yakalayıp yolu (`/<numara>`) ayrıştırıyor; yol BOŞ olduğunda uygulama ana ekranda açılıyor ve
    // sorgu dizesi (yani metnimiz) düşüyor — kullanıcının gördüğü "sohbete hiçbir şey yansımıyor".
    // api.whatsapp.com/send, WhatsApp'ın "kullanıcının seçeceği bir sohbete metin gönder" için
    // belgelediği uçtur; wa.me'nin kendisi de zaten oraya yönlendiriyor. Doğrudan oraya giderek hem
    // fazladan bir yönlendirme adımını hem de metni düşüren universal-link yakalamasını atlıyoruz.
    { action: 'whatsapp', label: "WhatsApp'ta paylaş", icon: ICON_WHATSAPP, href: (t, u) => `https://api.whatsapp.com/send?text=${t}%20${u}` },
    { action: 'telegram', label: "Telegram'da paylaş", icon: ICON_TELEGRAM, href: (t, u) => `https://t.me/share/url?url=${u}&text=${t}` },
  ];

  function html(id) {
    const icons = TARGETS.map(tg =>
      `<a class="share-icon" data-action="${tg.action}" target="_blank" rel="noopener" href="#" aria-label="${tg.label}" title="${tg.label}">${tg.icon}</a>`
    ).join('');
    return `
      <span class="share-widget">
        <button class="share-btn" type="button" id="${id}" aria-haspopup="dialog" aria-expanded="false" aria-label="Paylaş">
          ${ICON_SHARE}
        </button>
        <div class="share-popover" id="${id}-popover" role="dialog" aria-label="Paylaş">
          <div class="share-popover-head">
            <p class="share-popover-title">Paylaş</p>
            <button type="button" class="share-popover-close" data-close aria-label="Kapat">${ICON_CLOSE}</button>
          </div>
          <div class="share-popover-icons">
            ${icons}
            <button type="button" class="share-icon" data-action="native" aria-label="Diğer uygulamalar" title="Diğer uygulamalar" hidden>${ICON_MORE}</button>
          </div>
          <div class="share-popover-link">
            <input class="share-popover-url" type="text" readonly aria-label="Bağlantı">
            <button type="button" class="share-popover-copy" data-action="copy">${ICON_COPY}<span>Kopyala</span></button>
          </div>
        </div>
      </span>`;
  }

  // Açık popover'ı kapatır. Popover body'ye taşınmış olabilir — kapanınca butonun yanına geri döner,
  // böylece modal içeriği innerHTML ile sıfırlandığında onunla birlikte temizlenir (body'de yetim kalmaz).
  function closePopover(popover) {
    if (!popover || !popover.classList.contains('open')) return;
    popover.classList.remove('open');
    const btn = document.getElementById(popover.id.replace(/-popover$/, ''));
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      const host = btn.closest('.share-widget');
      if (host && popover.parentElement !== host) host.appendChild(popover);
    }
  }
  function closeAllPopovers() {
    document.querySelectorAll('.share-popover.open').forEach(closePopover);
  }

  // Butonun altına (sığmazsa üstüne) yerleştirir; yatayda görünür alana sıkıştırır. Butonun sağ
  // kenarı ekranın sağ yarısındaysa popover sağa hizalanır (referanstaki gibi), aksi halde sola.
  function positionPopover(btn, popover) {
    const r = btn.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const w = popover.offsetWidth;
    const h = popover.offsetHeight;
    const gap = 8, margin = 12;
    let left = r.right > vw / 2 ? r.right - w : r.left;
    left = Math.max(margin, Math.min(left, vw - w - margin));
    let top = r.bottom + gap;
    if (top + h > vh - margin && r.top - gap - h >= margin) top = r.top - gap - h;
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(Math.max(margin, top))}px`;
  }

  // gerçek bulgu: wire() önceden her çağrıda (yani her modal açılışında) YENİ bir
  // document.addEventListener('click', ...) ekliyordu — modaller innerHTML ile sıfırlandığından
  // btn/popover her seferinde yeni DOM düğümleri oluyor, dataset.shareWired koruması yeni düğümde
  // hiç set olmadığından işe yaramıyor. Sonuç: her modal açılışında document'a bir tane daha kalıcı
  // listener birikiyordu (temizlenmiyordu). Çözüm: TEK bir modül-seviyesi delegated listener seti.
  let globalWired = false;
  function wireGlobal() {
    if (globalWired) return;
    globalWired = true;
    document.addEventListener('click', (e) => {
      document.querySelectorAll('.share-popover.open').forEach(popover => {
        const btn = document.getElementById(popover.id.replace(/-popover$/, ''));
        if (btn && (btn.contains(e.target) || popover.contains(e.target))) return;
        closePopover(popover);
      });
    });
    // Escape önce popover'ı kapatsın, arkadaki pop-up'ı değil (capture — ModalShell'den önce).
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !document.querySelector('.share-popover.open')) return;
      e.stopPropagation();
      closeAllPopovers();
    }, true);
    // Sabit konumlu popover içerik kayınca butondan kopmasın — kaydırma/yeniden boyutlandırmada kapanır.
    window.addEventListener('resize', closeAllPopovers);
    document.addEventListener('scroll', (e) => {
      if (e.target && e.target.closest && e.target.closest('.share-popover')) return;
      closeAllPopovers();
    }, true);
    document.addEventListener('mimarlab-modal-closed', closeAllPopovers);
  }

  // logShare — Aktivitelerim > Paylaştıklarım kutusunu besleyen kayıt (bkz. kullanıcı isteği,
  // 2026-08-31 madde 1: "kullanıcıların paylaş butonuna tıklayarak başkalarına ilettikleri
  // gönderiler"). YALNIZCA paylaşım eylemi gerçekten tamamlandığında çağrılır — butonu açıp
  // popover'ı kapatmak ya da navigator.share()'i iptal etmek sayılmaz.
  // getData() `type`/`key` döndürmüyorsa (ör. en-iyi-100.html'in kendi Paylaş butonu, hangi
  // canonical anahtara ait olduğunu bilmiyor) hiç istek atılmaz — sunucu zaten bu ikisi olmadan
  // satır yazamaz, boşuna 400 dönmesine gerek yok. Giriş yapılmamışsa uç 401 döner; paylaşım
  // eyleminin KENDİSİ bundan etkilenmemeli, bu yüzden hata tamamen yutulur (fire-and-forget).
  function logShare(data, channel) {
    if (!data || !data.type || !data.key) return;
    try {
      fetch('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: data.type, key: data.key, channel,
          title: data.title || '', meta: data.meta || '',
          image: data.image || '', href: data.href || data.url || '',
        }),
      }).catch(() => {});
    } catch { /* fetch yoksa/engellendiyse sessiz */ }
  }

  async function copyText(text, input) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* aşağıdaki yedek */ }
    // Pano API'si izin vermezse (eski tarayıcı/izin reddi) seçili kutu + execCommand yedeği.
    try { input.focus(); input.select(); return document.execCommand('copy'); } catch { return false; }
  }

  // wire(id, getData): id, html(id) ile üretilen butonun DOM id'si; getData tıklama anında
  // {title, url} döndüren bir fonksiyon — modallar prev/next ile AYNI DOM'u yeniden kullandığından
  // (bkz. proje/mimar/firma/ürün modallarının ortak state machine deseni) URL/başlık render anında
  // DEĞİL, tıklama anında okunmalı. getData ayrıca (opsiyonel) {type, key, image, meta} döndürebilir
  // — bunlar yalnızca Paylaştıklarım kaydına gider (bkz. logShare), paylaşım davranışını hiç
  // etkilemez, bu yüzden eski çağıranlar değiştirilmeden çalışmaya devam eder.
  function wire(id, getData) {
    injectStyles();
    const btn = document.getElementById(id);
    const popover = document.getElementById(`${id}-popover`);
    if (!btn || !popover || btn.dataset.shareWired) return;
    btn.dataset.shareWired = '1';
    const urlInput = popover.querySelector('.share-popover-url');
    const copyBtn = popover.querySelector('.share-popover-copy');
    const nativeBtn = popover.querySelector('[data-action="native"]');
    if (nativeBtn && navigator.share) nativeBtn.hidden = false;

    popover.querySelector('[data-close]').addEventListener('click', () => closePopover(popover));
    urlInput.addEventListener('focus', () => urlInput.select());

    popover.querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener('click', async (e) => {
        const data = getData();
        const { title, url } = data;
        const action = el.dataset.action;
        if (action === 'copy') {
          e.preventDefault();
          if (await copyText(url, urlInput)) {
            copyBtn.classList.add('copied');
            copyBtn.querySelector('span').textContent = 'Kopyalandı';
            setTimeout(() => { copyBtn.classList.remove('copied'); copyBtn.querySelector('span').textContent = 'Kopyala'; }, 1600);
            // Kayıt yalnızca kopyalama GERÇEKTEN başarılıysa yazılır.
            logShare(data, 'copy');
          }
          return;
        }
        if (action === 'native') {
          e.preventDefault();
          closePopover(popover);
          // navigator.share() iptal edilirse reject eder — kayıt yalnızca resolve dalında yazılır.
          try { await navigator.share({ title, url }); logShare(data, 'native'); } catch { /* iptal — sessiz */ }
          return;
        }
        if (action === 'instagram') {
          // bkz. TARGETS'taki gerekçe — Instagram'ın web paylaşım ucu yok.
          e.preventDefault();
          if (navigator.share) {
            closePopover(popover);
            try { await navigator.share({ title, url }); logShare(data, 'instagram'); } catch { /* iptal — sessiz */ }
            return;
          }
          const copied = await copyText(url, urlInput);
          if (copied) {
            // Kullanıcı ne olduğunu görsün: panoya kopyalandı + Instagram açılıyor. Kopyala
            // butonunun kendi geri bildirimi yeniden kullanılır (ayrı bir bileşen icat edilmedi).
            copyBtn.classList.add('copied');
            copyBtn.querySelector('span').textContent = 'Bağlantı kopyalandı';
            setTimeout(() => { copyBtn.classList.remove('copied'); copyBtn.querySelector('span').textContent = 'Kopyala'; }, 2200);
          }
          logShare(data, 'instagram');
          window.open('https://www.instagram.com/', '_blank', 'noopener');
          return;
        }
        const target = TARGETS.find(tg => tg.action === action);
        if (!target || !target.href) return;
        // href tıklama anında yazılır (getData güncel URL'yi verir); <a target=_blank> varsayılan
        // davranışıyla yeni sekmede açılır — preventDefault YOK.
        el.href = target.href(encodeURIComponent(title || ''), encodeURIComponent(url || ''));
        logShare(data, action);
        closePopover(popover);
      });
    });

    btn.addEventListener('click', () => {
      const willOpen = !popover.classList.contains('open');
      closeAllPopovers();
      if (!willOpen) return;
      // GLOBAL OVERLAY PROTOKOLÜ (kullanıcı bildirimi, 2026-09-12: "Paylaş butonu tüm popuplarda
      // hatalı"). Popover eskiden overlay-manager.js'in "otomatik grup"undaydı: `.open` sınıfını
      // alır almaz MutationObserver closeOthers'ı tetikliyor, o da KAYITLI 'modal-shell'i
      // kapatıyordu; ModalShell.close() 'mimarlab-modal-closed' yayınlayınca da aşağıdaki dinleyici
      // popover'ı kapatıyordu — sonuç: proje/ürün/kişi/firma/marka pop-up'larının HEPSİNDE Paylaş'a
      // basınca hem pop-up hem panel kayboluyordu (canlıda doğrulandı). Otomatik grubun
      // `el.contains(exceptEl)` koruması burada işe yaramıyor, çünkü popover konumlandırma için
      // BODY'ye taşınıyor (bir alt satır) — yani artık pop-up'ın içinde değil.
      //
      // Artık açıkça kaydolup açılışı ANKRAJIMIZLA (btn) bildiriyoruz: overlay-manager rootEl
      // kontrolünü düğmenin konumuna göre yapar — düğme bir pop-up'ın/çekmecenin içindeyse o
      // kapanmaz, sayfanın gövdesindeki bir karttaysa açık paneller eskisi gibi kapanır.
      // Kayıt burada (wireGlobal'de değil): overlay-manager.js `defer` ile yüklenirken bu dosya
      // bazı sayfalarda daha erken çalışabiliyor; ilk tıklama her koşulda yeterince geç. Map.set
      // idempotenttir.
      if (typeof OverlayManager !== 'undefined') {
        OverlayManager.register('share', closeAllPopovers);
        OverlayManager.notifyOpen('share', btn);
      }
      urlInput.value = getData().url || '';
      document.body.appendChild(popover);
      popover.classList.add('open');
      positionPopover(btn, popover);
      btn.setAttribute('aria-expanded', 'true');
    });

    wireGlobal();
  }

  return { html, wire, injectStyles };
})();
