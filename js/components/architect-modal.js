// ArchitectModal — mimar detay modalının orkestratörü (bkz. js/components/project-modal.js'teki
// AYNI open/swap/close/handlePopState state machine deseni). DOM çerçevesi (overlay/panel/focus-trap/
// scroll-lock) js/components/modal-shell.js'ten gelir; içerik eskiden mimar-detay.html'in kendi
// sayfası olarak render ettiği her şeyi (kimlik, künye, ofis kartı, meslektaşlar, ilgili
// projeler/ürünler, claim/correction kutusu) mimar.html'in kartına tıklandığında sayfa yenilenmeden
// açan bir modale taşır. Yorum/puanlama YOK — mimar-detay.html'de de hiç yoktu, kapsam dışı kalmaya
// devam ediyor (bkz. proje hafızası: "comments/ratings stay project/product-only").
const ArchitectModal = (function () {
  // .detail-title/.related-*/.save-btn proje.html'in modal içeriğinde tanımladığı AYNI sınıflar/
  // değerler — mimar.html farklı bir sayfa olduğundan proje.html'in <style>'ını miras alamaz, bu
  // yüzden modal-shell.js'in injectStyles() deseniyle burada KENDİ <style>'ını bir kez enjekte eder
  // (görsel bütünlük için proje modalıyla BİREBİR aynı değerler). .card-edit-btn/.card-delete-btn/
  // .profile-edit-btn ARTIK burada değil — Düzenle/Arşivle/Sil modal-shell.js'in paylaşılan
  // header'ında render edilir (bkz. kullanıcı isteği). .feedback-card/.feedback-input-wrap o
  // dosyanın KENDİ injectStyles()'ında tanımlı (bkz. js/components/claim-correction-box.js).
  function injectStyles() {
    if (document.getElementById('architect-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'architect-modal-styles';
    style.textContent = `
      .detail-title{font-family:'Inter', sans-serif; font-size:26px; font-weight:700; margin:0; line-height:1.25;}
      .am-identity{display:flex; align-items:center; gap:16px; margin-bottom:18px;}
      .profile-logo{
        width:64px; height:64px; border-radius:50%; flex-shrink:0;
        border:1px solid var(--line); overflow:hidden; position:relative;
        display:flex; align-items:center; justify-content:center;
        background:var(--walnut); color:var(--paper-card);
        font-family:'IBM Plex Mono', monospace; font-weight:600; font-size:20px;
      }
      .profile-logo img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover;}
      .detail-title-actions{
        display:flex !important; flex-direction:row !important; flex-wrap:nowrap !important;
        align-items:center !important; justify-content:flex-start !important; width:100% !important;
        gap:4px !important; margin:0 0 18px;
      }
      .save-count{font-size:12px; color:var(--ink-soft); white-space:nowrap;}
      /* Düzenle/Arşivle/Sil artık #am-actions'ın İÇİNDE DEĞİL — modal-shell.js'in paylaşılan
         header'ında, X butonunun yanında render edilir (bkz. kullanıcı isteği). Bu yüzden
         .card-edit-btn/.card-delete-btn/.profile-edit-btn ve #profile-edit-slot'un display:contents
         kuralı buradan kaldırıldı; TEK stil kaynağı artık modal-shell.js#injectStyles. */
      .save-btn{
        display:inline-flex; align-items:center; gap:5px;
        flex-shrink:1 !important; min-width:0 !important; white-space:nowrap !important; overflow:hidden !important; text-overflow:ellipsis;
        height:32px !important; box-sizing:border-box;
        background:var(--paper-card); border:1px solid var(--line); border-radius:100px;
        padding:0 8px !important; font-size:12px !important; font-weight:600; color:var(--ink-soft);
        font-family:inherit; line-height:1;
      }
      .save-btn:hover{border-color:var(--walnut); color:var(--ink);}
      .save-btn.saved{background:var(--ink); color:var(--paper-card); border-color:var(--ink);}
      .save-btn svg{flex-shrink:0;}
      .save-btn-label-saved{display:none;}
      .save-btn.saved .save-btn-label-default{display:none;}
      .save-btn.saved .save-btn-label-saved{display:inline;}
      .save-btn-count{font-weight:600;}
      .detail-info{margin-top:8px;}
      .detail-meta{font-size:14px; line-height:1.9; margin-top:18px;}
      .detail-meta strong{font-weight:600; color:var(--ink);}
      /* bkz. kullanıcı isteği: profile birden fazla sosyal medya eklenebilsin (mimar-ekle.html#social-row) */
      .social-icons{display:flex; gap:12px; margin-top:12px;}
      .social-icons a{color:var(--ink-soft); display:flex;}
      .social-icons a:hover{color:var(--walnut);}
      .detail-desc{font-size:15px; line-height:1.7; color:var(--ink); margin-top:18px;}
      .detail-desc-more{background:none; border:none; padding:0; color:var(--walnut); font-weight:600; font-size:14px; text-decoration:underline; text-decoration-color:var(--line); cursor:pointer;}
      .detail-desc-more:hover{color:var(--ink);}
      .detail-info-divider{border:none; border-top:1px solid var(--line-soft); margin:24px 0;}
      .related-section{margin-top:32px; padding-top:28px; border-top:1px solid var(--line);}
      .related-section:first-child{margin-top:0; padding-top:0; border-top:none;}
      .related-title{font-family:'Inter', sans-serif; font-size:17px; font-weight:700; margin:0 0 16px;}
      /* Kart başlığı artık görselin ÜZERİNDE değil ALTINDA (bkz. kullanıcı isteği: tüm sayfa/
         görünümlerde gönderi başlıkları görselin altında olsun). */
      .related-card{display:block; border-radius:12px; overflow:hidden; background:var(--paper-card); border:1px solid var(--line-soft);}
      .related-card-photo{position:relative; aspect-ratio:4/3; overflow:hidden;}
      .related-card-photo img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover;}
      .related-card-placeholder{position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:rgba(255,255,255,0.92); font-family:'Inter', sans-serif; font-size:22px; font-weight:700;}
      .related-card-title{padding:12px 14px; color:var(--ink); font-family:'Inter', sans-serif; font-size:13.5px; font-weight:700;}
      /* Pop-up içindeki proje/danışman kartlarında tek satır kısıtlaması (bkz. kullanıcı isteği):
         uzun başlıklar tek satıra sığdığı kadar yazılır, sığmayan kelimeler alt satıra kesinlikle
         geçmez, satır sonuna ellipsis eklenir. */
      .related-card-title-text{display:block !important; white-space:nowrap !important; overflow:hidden !important; text-overflow:ellipsis !important; width:100% !important;}
      .related-card-subtitle{font-size:11px; font-weight:500; color:var(--ink-soft); margin-top:2px;}
      .related-grid-scroll{display:flex; gap:16px; overflow-x:auto; scroll-behavior:smooth; scrollbar-width:none; padding-bottom:4px;}
      .related-grid-scroll::-webkit-scrollbar{display:none;}
      .related-grid-scroll .related-card{flex:0 0 200px;}
      .unregistered-badge{
        display:inline-flex; align-items:center; gap:9px; flex:0 0 auto; align-self:center;
        background:var(--paper-card); border:1px solid var(--line-soft);
        border-radius:100px; padding:6px 16px 6px 6px; cursor:default;
      }
      .unregistered-badge-avatar{
        width:32px; height:32px; border-radius:50%; flex-shrink:0;
        display:flex; align-items:center; justify-content:center;
        color:#fff; font-family:'IBM Plex Mono', monospace; font-weight:600; font-size:11.5px;
      }
      .unregistered-badge-name{font-size:13px; font-weight:600; color:var(--ink);}
      .prevnext{margin-top:32px; padding-top:24px; border-top:1px solid var(--line); display:flex; justify-content:space-between; gap:16px;}
      .prevnext a{display:flex; align-items:center; gap:10px; flex:1; max-width:48%; padding:10px 14px; border:1px solid var(--line); border-radius:12px; background:var(--paper-card); font-size:13.5px; color:var(--ink-soft);}
      .prevnext a:hover{border-color:var(--walnut);}
      .prevnext a.next{text-align:right; margin-left:auto; flex-direction:row-reverse;}
      .prevnext-thumb{width:44px; height:44px; border-radius:8px; object-fit:cover; flex-shrink:0; background:var(--paper-alt);}
      .prevnext-thumb-placeholder{display:flex; align-items:center; justify-content:center; color:#fff; font-family:'Inter', sans-serif; font-weight:700; font-size:14px;}
      .prevnext-text{min-width:0; flex:1;}
      .prevnext-label{display:block; font-size:11px; letter-spacing:0.06em; color:var(--sage); margin-bottom:4px;}
      .prevnext-title{font-family:'Inter', sans-serif; font-size:14px; font-weight:700; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
      @media (max-width:860px){
        .related-grid-scroll .related-card{flex:0 0 140px;}
        .related-grid-scroll{gap:10px;}
        /* mobil/tablette .modal-shell-left/.modal-shell-right display:contents olduğundan (bkz.
           modal-shell.js) tüm doğrudan çocuklar TEK bir dikey flex akışına katılır — claim/geri
           bildirim kutuları burada order:99 ile akışın EN ALTINA (bkz. kullanıcı isteği) taşınır. */
        #claim-info-card, #correction-info-card{order:99;}
        /* :first-child kuralı masaüstünde sağ panelin İLK bölümü olduğu için gerekliydi (üstte
           gereksiz çizgi olmasın) — ama mobilde birleşik akışta "Firmalar" artık görsel olarak ilk
           değil, hemen üstünde kimlik/künye bölümünün hr.detail-info-divider'ı var (bkz. kullanıcı
           isteği: "Projeler" başlığıyla BİREBİR aynı boşluk). :first-child sıfırlamasını burada geri
           alıp diğer .related-section'larla eşit boşluk/çizgiye döndürür. */
        .related-section:first-child{margin-top:32px; padding-top:28px; border-top:1px solid var(--line);}
        /* related-section:first-child'ın üstteki border-top'u zaten açıklamadan sonra TEK bir çizgi
           oluşturuyor — detail-info-divider (açıklamanın hemen altındaki hr) burada hala görünür
           kalsaydı üst üste 2 çizgi (bkz. kullanıcı isteği: çift çizgi hatası) belirirdi, bu yüzden
           mobil/tablette gizlenir. */
        .detail-info-divider{display:none;}
        /* Önceki/Sonraki butonlarından hemen sonra, claim/geri bildirim kutularından ÖNCE bir ayırıcı
           (bkz. kullanıcı isteği) — masaüstünde prevnext/claim-card iki AYRI panelde olduğundan bu
           çizgiye gerek yok, yalnızca mobil/tablette (birleşik akışta) gösterilir. */
        .prevnext-mobile-divider{display:block; border:none; border-top:1px solid var(--line); margin:24px 0;}
        /* Kaydet — Apple/Google dokunma hedefi standartları (bkz. kullanıcı isteği): pil yüksekliği
           en az 48px, tıklanabilir alan en az 44x44px. "Paylaş" burada scoped bir override taşımadığı
           için share-button.js#injectStyles'daki AYNI kırılma noktasındaki generic .share-btn kuralı
           uygulanır (bkz. o dosya). Satırın tek satırda kalma zorunluluğu (üstteki
           .detail-title-actions flex-wrap:nowrap + flex-shrink:1/min-width:0/overflow:hidden/
           ellipsis) korunur. */
        .save-btn{height:48px !important; min-height:48px !important; padding:0 14px !important; font-size:13.5px !important;}
        .detail-title-actions{gap:8px !important;}
      }
      .prevnext-mobile-divider{display:none;}
    `;
    document.head.appendChild(style);
  }

  const LEFT_TEMPLATE = `
    <div class="am-identity">
      <div class="profile-logo" id="am-logo"></div>
      <h1 class="detail-title"><span id="am-name-text"></span><span id="am-verified-badge-wrap"></span></h1>
    </div>
    <div class="detail-title-actions" id="am-actions"></div>
    <div id="am-social-links"></div>
    <div class="detail-info" id="am-detail-info">
      <div class="detail-meta" id="am-category"></div>
      <div id="am-social-icons"></div>
      <div class="detail-meta" id="am-info-facts" style="display:none;"></div>
      <div class="detail-desc" id="am-about"></div>
      <hr class="detail-info-divider">
    </div>
    <div class="feedback-card" id="claim-info-card">
      <div id="claim-card-body">
        <h5>Bu profil sana mı ait?</h5>
        <p>Bilgilerini güncellemek ya da fotoğrafını değiştirmek için bizimle iletişime geç.</p>
      </div>
    </div>
    <div class="feedback-card" id="correction-info-card">
      <h5>Geri Bildirim</h5>
      <p>Hatalı ya da eksik bir bilgi görüyorsan bize bildir.</p>
      <div id="correction-card-extra"></div>
    </div>`;

  const RIGHT_TEMPLATE = `
    <div class="related-section" id="am-office-section" style="display:none;">
      <h2 class="related-title">Firmalar</h2>
      <div class="related-grid-scroll" id="am-office-grid"></div>
    </div>
    <div class="related-section" id="am-colleagues-section" style="display:none;">
      <h2 class="related-title">Diğer Firma Ortakları</h2>
      <div class="related-grid-scroll" id="am-colleagues-grid"></div>
    </div>
    <div class="related-section" id="am-related-projects-section" style="display:none;">
      <h2 class="related-title">Projeler</h2>
      <div class="related-grid-scroll" id="am-related-projects-grid"></div>
    </div>
    <div class="related-section" id="am-related-products-section" style="display:none;">
      <h2 class="related-title">Ürünler</h2>
      <div class="related-grid-scroll" id="am-related-products-grid"></div>
    </div>
    <div class="prevnext" id="am-prevnext"></div>
    <hr class="prevnext-mobile-divider">`;

  let mountedOnce = false;
  let currentSlug = null;
  let currentItem = null;
  let openedViaPush = false;
  let pushCountSinceOpen = 0;
  let requestSeq = 0;

  function ensureTemplate() {
    if (mountedOnce) return;
    const panels = ModalShell.getPanels();
    panels.leftPanelEl.innerHTML = LEFT_TEMPLATE;
    panels.rightPanelEl.innerHTML = RIGHT_TEMPLATE;
    ModalShell.wireGridScrollArrows(panels.rightPanelEl);
    mountedOnce = true;
  }

  const DEPT_TO_PROFESSION = {
    'Mimarlık': 'Mimar',
    'İç Mimarlık': 'İç Mimar',
    'İç Mimarlık ve Çevre Tasarımı': 'İç Mimar',
    'Peyzaj Mimarlığı': 'Peyzaj Mimarı',
    'Şehir ve Bölge Planlama': 'Şehir Plancısı',
    'Restorasyon': 'Restoratör',
  };

  // Uzun biyografilerde belirli bir uzunluktan sonra kes + "Devamını gör..." genişletme (bkz.
  // kullanıcı isteği) — js/components/project-meta.js#renderDescription/DESC_TRUNCATE_AT ile
  // BİREBİR aynı desen, bu modül proje modalıyla import paylaşamadığından burada tekrarlanır.
  const DESC_TRUNCATE_AT = 320;
  function safeUrl(u) {
    try {
      const parsed = new URL(u, window.location.href);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
    } catch {}
    return '';
  }

  // bkz. kullanıcı isteği: profile birden fazla sosyal medya bağlantısı eklenebilsin
  // (mimar-ekle.html#social-row, migrations/0036_social_links.sql) — office-modal.js/
  // consultant-modal.js'te AYNI ikon seti/fonksiyon kopyalanır.
  const SOCIAL_ICON_SVG = {
    instagram: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/></svg>',
    linkedin: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M4.5 3.5A2 2 0 1 0 4.5 7.5 2 2 0 0 0 4.5 3.5zM3 9h3v12H3zM10 9h2.9v1.6h.1c.4-.8 1.5-1.6 3-1.6 3.2 0 3.8 2.1 3.8 4.9V21h-3v-6.6c0-1.6 0-3.6-2.2-3.6s-2.5 1.7-2.5 3.5V21H10z"/></svg>',
    x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.3 2H21l-7.3 8.3L22.2 22h-6.8l-5.3-6.9L4 22H1.3l7.8-8.9L1.5 2h6.9l4.8 6.3L18.3 2z"/></svg>',
    youtube: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9l6 3-6 3V9z" fill="currentColor" stroke="none"/></svg>',
    behance: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><text x="12" y="15.5" font-size="9" text-anchor="middle" fill="currentColor" stroke="none" font-family="Arial, sans-serif" font-weight="700">Be</text></svg>',
    website: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/></svg>',
  };
  const SOCIAL_LABELS = { instagram: 'Instagram', linkedin: 'LinkedIn', x: 'X (Twitter)', youtube: 'YouTube', behance: 'Behance', website: 'Web Sitesi' };
  function socialIconsHtml(links) {
    const valid = (links || []).map(s => ({ platform: s.platform, url: safeUrl(s.url) })).filter(s => s.url);
    if (!valid.length) return '';
    return `<div class="social-icons">${valid.map(s => `<a href="${escapeAttr(s.url)}" target="_blank" rel="noopener" aria-label="${escapeAttr(SOCIAL_LABELS[s.platform] || s.platform)}">${SOCIAL_ICON_SVG[s.platform] || SOCIAL_ICON_SVG.website}</a>`).join('')}</div>`;
  }

  function renderTruncatedDesc(elId, text) {
    const el = document.getElementById(elId);
    if (text.length <= DESC_TRUNCATE_AT) { el.textContent = text; return; }
    const truncated = text.slice(0, DESC_TRUNCATE_AT).trim();
    el.innerHTML = `${escapeHtml(truncated)}… <button type="button" class="detail-desc-more">Devamını gör...</button>`;
    el.querySelector('.detail-desc-more').addEventListener('click', () => { el.textContent = text; });
  }

  // badgeHtml: yalnızca firma/meslektaş kartlarında geçilir (bkz. kullanıcı isteği: mavi onay
  // rozetinin ilişkili TÜM alanlarda görünmesi) — proje/ürün kartlarında rozet anlamsız olduğundan
  // çağıranlar orada bu parametreyi hiç geçmez, boş string varsayılanı hiçbir şey render etmez.
  function cardHtml(href, title, image, subtitle, badgeHtml) {
    const srcset = image ? cdnSrcset(image, [300, 450, 600]) : '';
    return `<a class="related-card" href="${href}">
      <div class="related-card-photo">
        ${image ? `<img src="${escapeAttr(cdnImg(image, 450))}"${srcset ? ` srcset="${escapeAttr(srcset)}" sizes="300px"` : ''} alt="${escapeAttr(title)}" loading="lazy" decoding="async">` : `<div class="related-card-placeholder" style="background:${officeColor(title)}">${escapeHtml(initials(title))}</div>`}
      </div>
      <div class="related-card-title"><span class="related-card-title-text">${escapeHtml(title)}${badgeHtml || ''}</span>${subtitle ? `<div class="related-card-subtitle">${escapeHtml(subtitle)}</div>` : ''}</div>
    </a>`;
  }

  // Mimar profiline yazılmış ama offices tablosunda karşılığı olmayan (bkz. src/routes/
  // architect.js#fetchRawOfficeName, `unregistered: true`) firma adı — js/components/
  // office-modal.js#unregisteredBadgeHtml ile BİREBİR aynı, yuvarlak baş harfli pasif rozet.
  function unregisteredBadgeHtml(name) {
    return `<span class="unregistered-badge" aria-disabled="true">
      <span class="unregistered-badge-avatar" style="background:${officeColor(name)}">${escapeHtml(initials(name))}</span>
      <span class="unregistered-badge-name">${escapeHtml(name)}</span>
    </span>`;
  }

  // Önceki/Sonraki Mimar — bkz. js/components/project-modal.js#renderPrevNext'teki AYNI desen,
  // src/routes/architect.js#fetchAdjacentArchitect'in döndürdüğü dairesel/sıralı id komşuları. Yön
  // kasıtlı olarak TERS çevrilmiştir (bkz. AYNI dosyadaki kullanıcı isteği/gerekçe) — payload.nextItem/
  // prevItem'in kendisi değişmedi, yalnızca hangisi .prev/.next slotunu doldurduğu swap edildi.
  // bkz. kullanıcı isteği: Önceki/Sonraki butonlarının içine önizleme görseli eklenmesi.
  function prevNextThumbHtml(item) {
    return item.image
      ? `<img class="prevnext-thumb" src="${escapeAttr(cdnImg(item.image, 120))}" alt="" loading="lazy" decoding="async">`
      : `<div class="prevnext-thumb prevnext-thumb-placeholder" style="background:${officeColor(item.title)}">${escapeHtml(initials(item.title))}</div>`;
  }

  function renderPrevNext(payload) {
    const el = document.getElementById('am-prevnext');
    let html = '';
    if (payload.nextItem) html += `<a class="prev" href="/mimar/${encodeURIComponent(payload.nextItem.slug)}">${prevNextThumbHtml(payload.nextItem)}<span class="prevnext-text"><span class="prevnext-label">← Önceki Mimar</span><span class="prevnext-title">${escapeHtml(payload.nextItem.title)}</span></span></a>`;
    if (payload.prevItem) html += `<a class="next" href="/mimar/${encodeURIComponent(payload.prevItem.slug)}">${prevNextThumbHtml(payload.prevItem)}<span class="prevnext-text"><span class="prevnext-label">Sonraki Mimar →</span><span class="prevnext-title">${escapeHtml(payload.prevItem.title)}</span></span></a>`;
    el.innerHTML = html;
  }

  function updateHeadMeta(a, office) {
    document.title = `${a.name} — MİMARLAB`;
    const desc = office
      ? `${a.name}, ${office.name} bünyesinde ${a.role || 'mimar'} olarak görev yapmaktadır. MİMARLAB'da profilini incele.`
      : `${a.name} — MİMARLAB'da mimar profilini incele.`;
    const canonicalUrl = `https://mimarlab.com/mimar/${encodeURIComponent(slugify(a.name))}`;
    const image = a.photo ? new URL(a.photo, window.location.origin).href : 'https://mimarlab.com/logos/site/mimarlab-og-image.png';
    const setIf = (id, attr, val) => { const el = document.getElementById(id); if (el) el.setAttribute(attr, val); };
    setIf('meta-description', 'content', desc);
    setIf('canonical-link', 'href', canonicalUrl);
    setIf('og-title', 'content', document.title);
    setIf('og-description', 'content', desc);
    setIf('og-url', 'content', canonicalUrl);
    setIf('og-image', 'content', image);
    setIf('twitter-title', 'content', document.title);
    setIf('twitter-description', 'content', desc);
    setIf('twitter-image', 'content', image);
  }

  // displayOffice: office_id ile bağlı TEK firma (office) boşsa, buildArchitectPayload'ın döndürdüğü
  // TÜM firmalar listesine (offices — office_founders ters join'i + eşleşmeyen serbest metin firma adı,
  // bkz. src/routes/architect.js#buildArchitectPayload) düşer (bkz. gerçek bulgu: Şefik Birkiye gibi
  // office_id'si boş ama office_founders'a bağlı ya da yalnızca serbest metinde firma adı geçen
  // mimarlarda unvan yanında hiç firma adı görünmüyordu — kullanıcı isteği). offices[] zaten önce
  // gerçek (kayıtlı) firmaları, "unregistered" serbest-metin adını EN SONA koyar, bu yüzden offices[0]
  // her zaman en iyi adaydır.
  function renderStructuredData(a, displayOffice) {
    let tag = document.getElementById('am-ld-json');
    if (!tag) {
      tag = document.createElement('script');
      tag.type = 'application/ld+json';
      tag.id = 'am-ld-json';
      document.head.appendChild(tag);
    }
    const data = { '@context': 'https://schema.org', '@type': 'Person', name: a.name, url: window.location.href };
    if (a.role) data.jobTitle = a.role;
    if (a.photo) { try { data.image = new URL(a.photo, window.location.href).href; } catch {} }
    if (a.school) data.alumniOf = { '@type': 'CollegeOrUniversity', name: a.school };
    if (displayOffice) {
      data.worksFor = { '@type': 'Organization', name: displayOffice.name };
      // Yalnızca gerçekten kayıtlı (linkli /firma/:slug sayfası olan) bir firma için url ekle —
      // "unregistered" serbest-metin adının kendi sayfası yok, JSON-LD'ye kırık bir URL koymamak için.
      if (!displayOffice.unregistered) data.worksFor.url = new URL('/firma/' + encodeURIComponent(slugify(displayOffice.name)), window.location.href).href;
    }
    tag.textContent = JSON.stringify(data);
  }

  // bkz. js/components/project-modal.js#HIDE_ON_NOT_FOUND_IDS AYNI gerçek bulgu: renderNotFound()
  // bu ID'leri gizliyor, ModalShell'in şablonu sayfa ömrü boyunca tek sefer mount edildiğinden bir
  // sonraki başarılı render bunları geri açmazsa modal kalıcı olarak yarı-boş görünürdü.
  const HIDE_ON_NOT_FOUND_IDS = ['am-actions', 'am-office-section', 'am-colleagues-section', 'am-related-projects-section',
    'am-related-products-section', 'am-detail-info', 'am-prevnext'];

  async function renderItem(payload) {
    HIDE_ON_NOT_FOUND_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    });
    const a = payload.item;
    const office = payload.office;
    const offices = payload.offices || (office ? [office] : []);
    const displayOffice = office || offices[0] || null;
    const colleagues = payload.colleagues || [];
    const relatedProjectsData = payload.relatedProjects || [];
    currentItem = a;

    updateHeadMeta(a, displayOffice);
    document.getElementById('am-name-text').textContent = a.name;
    document.getElementById('am-category').innerHTML = `<strong>${escapeHtml([a.role, displayOffice ? displayOffice.name : null].filter(Boolean).join(' · '))}</strong>`;
    document.getElementById('am-social-icons').innerHTML = socialIconsHtml(a.social_links);
    const aboutText = a.about || (displayOffice
      ? `${a.name}, ${displayOffice.name} bünyesinde${a.role ? ' ' + a.role + ' olarak' : ''} görev yapmaktadır.`
      : (a.role ? `${a.name}, ${a.role} olarak çalışmaktadır.` : `${a.name} — MİMARLAB dizininde yer alan bir mimar.`));
    renderTruncatedDesc('am-about', aboutText);

    const infoFactsEl = document.getElementById('am-info-facts');
    const infoFacts = [];
    if (a.dob) infoFacts.push(`<div><strong>Doğum Tarihi:</strong> ${escapeHtml(String(a.dob))}</div>`);
    // Künyede yalnızca okul/meslek adı gösterilir — a.dept (bölüm) ve a.role (pozisyon/unvan, ör.
    // "Kurucu Ortak") burada BİLEREK dışlanır (bkz. kullanıcı isteği: "Meslek: Kurucu / Mimar" yerine
    // sadece "Meslek: Mimar"). Bu iki alan başka yerlerde (meslektaş kartları, DEPT_TO_PROFESSION
    // fallback'i, üstteki başlık satırı) hâlâ kullanıldığından DB'de DEĞİŞTİRİLMEZ, sadece bu
    // künye satırlarının derlenişinden çıkarılır.
    if (a.school) infoFacts.push(`<div><strong>Üniversite:</strong> ${escapeHtml(a.school)}</div>`);
    const profession = a.profession || DEPT_TO_PROFESSION[a.dept] || null;
    if (profession) infoFacts.push(`<div><strong>Meslek:</strong> ${escapeHtml(profession)}</div>`);
    if (a.awards && a.awards.length) infoFacts.push(`<div><strong>Ödüller:</strong> ${a.awards.map(escapeHtml).join(', ')}</div>`);
    infoFactsEl.innerHTML = infoFacts.join('');
    infoFactsEl.style.display = infoFacts.length ? '' : 'none';

    const logoEl = document.getElementById('am-logo');
    logoEl.innerHTML = '';
    logoEl.textContent = initials(a.name);
    logoEl.style.background = officeColor(a.name);
    if (a.photo) {
      const img = document.createElement('img');
      img.src = a.photo;
      img.alt = '';
      img.decoding = 'async';
      img.fetchPriority = 'high';
      img.onerror = () => img.remove();
      logoEl.appendChild(img);
    }

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'save-btn card-save-btn';
    saveBtn.id = 'am-save-btn';
    saveBtn.setAttribute('aria-label', 'Kaydet');
    saveBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z"/></svg><span class="save-btn-label-default">Kaydet</span><span class="save-btn-label-saved">Kaydedildi</span><span class="save-btn-count" id="am-save-count"></span>`;
    const actionsEl = document.getElementById('am-actions');
    actionsEl.innerHTML = '';
    actionsEl.prepend(saveBtn);
    // Düzenle/Arşivle/Sil artık bu satırda DEĞİL — modal-shell.js'in paylaşılan header'ında, X
    // butonunun yanında render edilir (bkz. kullanıcı isteği) — claim-correction-box.js#
    // renderProfileEditButton hâlâ #profile-edit-slot id'sini arıyor, yalnızca DOM konumu değişti.
    const headerActions = ModalShell.getHeaderActionsSlot();
    if (headerActions) headerActions.innerHTML = '<span id="profile-edit-slot"></span>';
    saveBtn.dataset.key = slugify(a.name);
    saveBtn.dataset.title = a.name;
    saveBtn.dataset.meta = displayOffice ? displayOffice.name : (a.role || '');
    saveBtn.dataset.image = a.photo || '';
    saveBtn.dataset.href = `/mimar/${encodeURIComponent(slugify(a.name))}`;
    wireSaveButtons('architect');
    fetch(`/api/public/save-count?type=architect&key=${encodeURIComponent(saveBtn.dataset.key)}`)
      .then(r => r.json())
      .then(data => { const el = document.getElementById('am-save-count'); if (el) el.textContent = data.count > 0 ? ` (${data.count})` : ''; })
      .catch(() => {});
    if (typeof ShareWidget !== 'undefined') {
      saveBtn.insertAdjacentHTML('afterend', ShareWidget.html('am-share-btn'));
      ShareWidget.wire('am-share-btn', () => ({ title: a.name, url: `${window.location.origin}/mimar/${encodeURIComponent(slugify(a.name))}` }));
    }
    const socialLinksEl = document.getElementById('am-social-links');
    if (socialLinksEl) socialLinksEl.innerHTML = typeof SocialLinks !== 'undefined' ? SocialLinks.html(a.socialPlatform, a.socialUrl) : '';

    renderStructuredData(a, displayOffice);
    renderPrevNext(payload);

    const officeSectionEl = document.getElementById('am-office-section');
    officeSectionEl.style.display = offices.length ? '' : 'none';
    // renderOfficeGrid/renderColleaguesGrid ayrı fonksiyonlar olarak tutulur (yalnızca innerHTML'i
    // yeniden çizer) — aşağıdaki renderVerifiedBadges ile AYNI /api/public/badges gecikmesi burada
    // da var: rozetler ilk çizimde henüz gelmemiş olabilir, 'mimarlab-badges-ready' ile tekrar çizilir.
    function renderOfficeGrid() {
      document.getElementById('am-office-grid').innerHTML = offices.map(off => off.unregistered
        ? unregisteredBadgeHtml(off.name)
        : cardHtml(`/firma/${encodeURIComponent(slugify(off.name))}`, off.name, logoUrl(off), [off.loc, off.yil ? 'K. ' + off.yil : null].filter(Boolean).join(' · '), verifiedBadgeHtml('office', off.name, off.badges, 14))
      ).join('');
    }
    renderOfficeGrid();

    document.getElementById('am-colleagues-section').style.display = colleagues.length ? '' : 'none';
    function renderColleaguesGrid() {
      document.getElementById('am-colleagues-grid').innerHTML = colleagues.map(c =>
        cardHtml(`/mimar/${encodeURIComponent(slugify(c.name))}`, c.name, c.photo, c.role, verifiedBadgeHtml('architect', c.name, c.badges, 14))
      ).join('');
    }
    renderColleaguesGrid();

    document.getElementById('am-related-projects-section').style.display = relatedProjectsData.length ? '' : 'none';
    document.getElementById('am-related-projects-grid').innerHTML = relatedProjectsData.map(p =>
      cardHtml(`/projeler/${encodeURIComponent(p.slug)}`, p.title, p.images && p.images[0])
    ).join('');

    const PROFILE_TYPE = 'architect';
    const claimBox = createClaimCorrectionBox({
      profileType: PROFILE_TYPE,
      ready: savedWidgetReady,
      getProfileKey: () => a.name,
      getClaimLinkKey: () => a._claimKey || a.name,
      getStaticBadges: () => a.badges,
      editUrlBase: 'mimar-ekle.html',
      listUrl: 'mimar.html',
      contentType: 'architects',
      getModerationTarget: () => ({ key: a.name }),
      labels: {
        claimTitle: 'Bu profil sana mı ait?',
        loginPromptHtml: 'Bilgilerini güncellemek ve doğrulanmış üye rozeti almak için <a href="giris-yap.html" class="info-card-link">giriş yap</a>.',
        pendingHtml: '"Bu profil bana ait" talebini aldık, ekibimiz en kısa sürede onaylayacak.',
        claimNoteDescription: 'Bu profilin sana ait olduğunu doğrulayabileceğimiz bir not ekle.',
        claimButtonText: 'Gönder',
        deleteConfirm: 'Bu mimar profilini silmek istediğine emin misin? Profil anında canlı siteden kaldırılır.',
        archiveConfirm: 'Bu mimar profilini arşivlemek istediğine emin misin? Profil canlıdan kaldırılıp admin panelindeki Arşiv sekmesine taşınır.',
      },
    });

    async function loadProfileContent() {
      try {
        const res = await fetch(`/api/public/profile-content?profileType=${PROFILE_TYPE}&profileKey=${encodeURIComponent(a.name)}`);
        if (!res.ok) return;
        const data = await res.json();
        const products = data.products || [];
        document.getElementById('am-related-products-section').style.display = products.length ? '' : 'none';
        document.getElementById('am-related-products-grid').innerHTML = products.map(p => cardHtml('urun.html', p.title, p.image, p.category)).join('');
      } catch {}
    }

    function renderVerifiedBadges() {
      document.getElementById('am-verified-badge-wrap').innerHTML = verifiedBadgeHtml(PROFILE_TYPE, a.name, a.badges, 20);
      // bkz. kullanıcı isteği: mavi rozet firma/meslektaş kartlarında da görünmeli — bu ikisi de
      // isim bazlı dynamicBadges önbelleğine bağlı olduğundan başlıktaki rozetle AYNI anda tazelenir.
      renderOfficeGrid();
      renderColleaguesGrid();
    }
    renderVerifiedBadges();
    window.addEventListener('mimarlab-badges-ready', renderVerifiedBadges, { once: true });

    loadProfileContent();
    await savedWidgetReady;
    await claimBox.init();

    wireInternalNav();
    ModalShell.scrollToTop();
  }

  function renderNotFound() {
    document.getElementById('am-name-text').textContent = 'Mimar bulunamadı';
    const headerActions = ModalShell.getHeaderActionsSlot();
    if (headerActions) headerActions.innerHTML = '';
    HIDE_ON_NOT_FOUND_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  function wireInternalNav() {
    const panels = ModalShell.getPanels();
    if (!panels || panels.bodyEl.dataset.amNavWired) return;
    panels.bodyEl.dataset.amNavWired = '1';
    panels.bodyEl.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="/mimar/"]');
      if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const m = a.getAttribute('href').match(/^\/mimar\/([^/?#]+)/);
      if (!m) return;
      e.preventDefault();
      swap(decodeURIComponent(m[1]));
    });
  }

  async function fetchItem(slug) {
    const res = await fetch(`/api/architect/${encodeURIComponent(slug)}`);
    if (!res.ok) return null;
    const payload = await res.json();
    if (!payload || !payload.item || payload.hidden) return null;
    return payload;
  }

  async function open(slug, { pushHistory = true, triggerEl = null } = {}) {
    currentSlug = slug;
    openedViaPush = pushHistory;
    pushCountSinceOpen = pushHistory ? 1 : 0;
    if (pushHistory) history.pushState({ mimarlabModal: 'architect', slug, depth: 1 }, '', `/mimar/${encodeURIComponent(slug)}`);
    injectStyles();
    ModalShell.open({ triggerEl, onRequestClose: close });
    ensureTemplate();

    const mySeq = ++requestSeq;
    const payload = await fetchItem(slug);
    if (mySeq !== requestSeq || currentSlug !== slug) return;
    if (!payload) { renderNotFound(); return; }
    await renderItem(payload);
  }

  async function swap(slug) {
    if (!ModalShell.isOpen()) return open(slug, { pushHistory: true });
    currentSlug = slug;
    const currentDepth = (history.state && history.state.mimarlabModal === 'architect') ? history.state.depth : pushCountSinceOpen;
    pushCountSinceOpen = currentDepth + 1;
    history.pushState({ mimarlabModal: 'architect', slug, depth: pushCountSinceOpen }, '', `/mimar/${encodeURIComponent(slug)}`);
    const mySeq = ++requestSeq;
    const payload = await fetchItem(slug);
    if (mySeq !== requestSeq || currentSlug !== slug) return;
    if (!payload) { renderNotFound(); return; }
    await renderItem(payload);
  }

  function close() {
    currentSlug = null;
    currentItem = null;
    if (openedViaPush && pushCountSinceOpen > 0) history.go(-pushCountSinceOpen);
    else history.pushState({}, '', '/mimar');
    ModalShell.close();
    pushCountSinceOpen = 0;
  }

  function handlePopState(slug) {
    if (!slug) { if (ModalShell.isOpen()) { currentSlug = null; currentItem = null; ModalShell.close(); } return; }
    if (!ModalShell.isOpen()) { openedViaPush = false; open(slug, { pushHistory: false }); return; }
    if (history.state && history.state.mimarlabModal === 'architect' && typeof history.state.depth === 'number') {
      pushCountSinceOpen = history.state.depth;
    }
    if (slug === currentSlug) return;
    currentSlug = slug;
    (async () => {
      const mySeq = ++requestSeq;
      const payload = await fetchItem(slug);
      if (mySeq !== requestSeq || currentSlug !== slug) return;
      if (!payload) { renderNotFound(); return; }
      await renderItem(payload);
    })();
  }

  function isOpen() { return ModalShell.isOpen(); }
  function getCurrentSlug() { return currentSlug; }

  return { open, swap, close, handlePopState, isOpen, getCurrentSlug };
})();
