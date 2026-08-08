// OfficeModal — firma detay modalının orkestratörü (bkz. js/components/architect-modal.js'teki AYNI
// desen, kendisi js/components/project-modal.js'in open/swap/close/handlePopState state machine'ini
// izler). DOM çerçevesi js/components/modal-shell.js'ten gelir; içerik eskiden ofis-detay.html'in
// kendi sayfası olarak render ettiği her şeyi (kimlik, künye, kurucular/ortaklar, ilgili
// projeler/ürünler/malzemeler, claim/correction kutusu) firma.html'in kartına tıklandığında sayfa
// yenilenmeden açan bir modale taşır. Yorum/puanlama YOK — ofis-detay.html'de de hiç yoktu.
const OfficeModal = (function () {
  // architect-modal.js#injectStyles ile BİREBİR aynı ortak sınıflar (.detail-title/.related-*/
  // .save-btn) — firma.html farklı bir sayfa olduğundan proje.html/mimar.html'in <style>'ını miras
  // alamaz, kendi <style>'ını bir kez enjekte eder (görsel bütünlük için AYNI değerler).
  // .card-edit-btn/.card-delete-btn/.profile-edit-btn ARTIK burada değil — Düzenle/Arşivle/Sil
  // modal-shell.js'in paylaşılan header'ında render edilir, TEK stil kaynağı orası (bkz. kullanıcı
  // isteği). .feedback-card/.feedback-input-wrap o dosyanın KENDİ injectStyles()'ında tanımlı (bkz.
  // js/components/claim-correction-box.js).
  function injectStyles() {
    if (document.getElementById('office-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'office-modal-styles';
    style.textContent = `
      .detail-title{font-family:'Inter', sans-serif; font-size:26px; font-weight:700; margin:0; line-height:1.25;}
      .om-identity{display:flex; align-items:center; gap:16px; margin-bottom:18px;}
      .profile-logo{
        width:64px; height:64px; border-radius:50%; flex-shrink:0;
        border:1px solid var(--line); overflow:hidden; position:relative;
        display:flex; align-items:center; justify-content:center;
        background:var(--walnut); color:var(--paper-card);
        font-family:'IBM Plex Mono', monospace; font-weight:600; font-size:20px;
      }
      .profile-logo img{position:absolute; inset:0; width:100%; height:100%; object-fit:contain; background:var(--paper-card);}
      .detail-title-actions{
        display:flex !important; flex-direction:row !important; flex-wrap:nowrap !important;
        align-items:center !important; justify-content:flex-start !important; width:100% !important;
        gap:4px !important; margin:0 0 18px;
      }
      .save-count{font-size:12px; color:var(--ink-soft); white-space:nowrap;}
      /* Düzenle/Arşivle/Sil artık #om-actions'ın İÇİNDE DEĞİL — modal-shell.js'in paylaşılan
         header'ında, X butonunun yanında render edilir (bkz. kullanıcı isteği). Bu yüzden
         .card-edit-btn/.card-delete-btn/.profile-edit-btn ve #profile-edit-slot'un display:contents
         kuralı buradan kaldırıldı; TEK stil kaynağı artık modal-shell.js#injectStyles. */
      .save-btn{
        display:inline-flex; align-items:center; gap:5px;
        flex-shrink:1 !important; min-width:0 !important; white-space:nowrap !important; overflow:hidden !important; text-overflow:ellipsis;
        height:32px !important; box-sizing:border-box;
        background:var(--paper-card); border:1px solid var(--line); border-radius:100px;
        padding:0 8px !important; font-size:12px !important; font-weight:600; color:var(--ink-soft);
        font-family:inherit; line-height:1; text-decoration:none;
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
      .detail-desc{font-size:15px; line-height:1.7; color:var(--ink); margin-top:18px;}
      .detail-desc-more{background:none; border:none; padding:0; color:var(--walnut); font-weight:600; font-size:14px; text-decoration:underline; text-decoration-color:var(--line); cursor:pointer;}
      .detail-desc-more:hover{color:var(--ink);}
      .detail-info-divider{border:none; border-top:1px solid var(--line-soft); margin:24px 0;}
      .related-section{margin-top:32px; padding-top:28px; border-top:1px solid var(--line);}
      .related-section:first-child{margin-top:0; padding-top:0; border-top:none;}
      .related-title{font-family:'Inter', sans-serif; font-size:17px; font-weight:700; margin:0 0 16px;}
      .related-card{position:relative; display:block; aspect-ratio:4/3; border-radius:12px; overflow:hidden; background:var(--paper-card); border:1px solid var(--line-soft);}
      .related-card img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover;}
      .related-card-placeholder{position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:rgba(255,255,255,0.92); font-family:'Inter', sans-serif; font-size:22px; font-weight:700;}
      .related-card-title{
        position:absolute; left:0; right:0; bottom:0; padding:12px 14px;
        background:linear-gradient(to top, rgba(27,42,61,0.85), rgba(27,42,61,0));
        color:#fff; font-family:'Inter', sans-serif; font-size:13.5px; font-weight:700;
      }
      /* bkz. js/components/architect-modal.js#related-card-title-text — AYNI gerekçe: -webkit-box
         doğrudan .related-card-title'a uygulansaydı altındaki .related-card-subtitle satırını da
         satır sayımına dahil ederdi, bu yüzden yalnızca bu iç sarmalayıcıya uygulanır. */
      /* line-height/max-height + !important (bkz. kullanıcı isteği, gerçek bulgu: son kelimenin
         -webkit-line-clamp'e rağmen 3. satıra taştığı bildirildi) — line-height em cinsinden
         SABİTLENİP max-height tam 2 satırla (2 × 1.25em) sınırlanarak üçüncü satır kesin gizlenir. */
      .related-card-title-text{display:-webkit-box !important; -webkit-line-clamp:2 !important; -webkit-box-orient:vertical !important; overflow:hidden !important; text-overflow:ellipsis !important; word-break:break-word !important; line-height:1.25em !important; max-height:2.5em !important;}
      .related-card-subtitle{font-size:11px; font-weight:500; opacity:0.85; margin-top:2px;}
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
      .prevnext a{flex:1; max-width:48%; padding:14px 18px; border:1px solid var(--line); border-radius:12px; background:var(--paper-card); font-size:13.5px; color:var(--ink-soft);}
      .prevnext a:hover{border-color:var(--walnut);}
      .prevnext a.next{text-align:right; margin-left:auto;}
      .prevnext-label{display:block; font-size:11px; letter-spacing:0.06em; color:var(--sage); margin-bottom:4px;}
      .prevnext-title{font-family:'Inter', sans-serif; font-size:14px; font-weight:700; color:var(--ink);}
      @media (max-width:860px){
        .related-grid-scroll .related-card{flex:0 0 140px;}
        .related-grid-scroll{gap:10px;}
        /* mobil/tablette .modal-shell-left/.modal-shell-right display:contents olduğundan (bkz.
           modal-shell.js) tüm doğrudan çocuklar TEK bir dikey flex akışına katılır — claim/geri
           bildirim kutuları burada order:99 ile akışın EN ALTINA (bkz. kullanıcı isteği) taşınır. */
        #claim-info-card, #correction-info-card{order:99;}
        /* :first-child kuralı masaüstünde sağ panelin İLK bölümü olduğu için gerekliydi (üstte
           gereksiz çizgi olmasın) — ama mobilde birleşik akışta "Kurucular / Ortaklar" artık görsel
           olarak ilk değil, hemen üstünde kimlik/künye bölümünün hr.detail-info-divider'ı var (bkz.
           kullanıcı isteği: "Projeler" başlığıyla BİREBİR aynı boşluk). :first-child sıfırlamasını
           burada geri alıp diğer .related-section'larla eşit boşluk/çizgiye döndürür. */
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
        /* Websitesi/Kaydet — Apple/Google dokunma hedefi standartları (bkz. kullanıcı isteği): pil
           yüksekliği en az 48px, tıklanabilir alan en az 44x44px — "Websitesi" .save-btn sınıfını
           Kaydet ile PAYLAŞTIĞINDAN (bkz. yukarısı, visitBtn.className) tek kural ikisini birden
           kapsar. "Paylaş" burada scoped bir override taşımadığı için share-button.js#injectStyles'daki
           AYNI kırılma noktasındaki generic .share-btn kuralı uygulanır. Satırın tek satırda kalma
           zorunluluğu (üstteki .detail-title-actions flex-wrap:nowrap + flex-shrink:1/min-width:0/
           overflow:hidden/ellipsis) korunur. */
        .save-btn{height:48px !important; min-height:48px !important; padding:0 14px !important; font-size:13.5px !important;}
        .detail-title-actions{gap:8px !important;}
      }
      .prevnext-mobile-divider{display:none;}
    `;
    document.head.appendChild(style);
  }

  const LEFT_TEMPLATE = `
    <div class="om-identity">
      <div class="profile-logo" id="om-logo"></div>
      <h1 class="detail-title"><span id="om-name-text"></span><span id="om-verified-badge-wrap"></span></h1>
    </div>
    <div class="detail-title-actions" id="om-actions"></div>
    <div class="detail-info" id="om-detail-info">
      <div class="detail-meta" id="om-info-facts" style="display:none;"></div>
      <div class="detail-desc" id="om-about"></div>
      <hr class="detail-info-divider">
    </div>
    <div class="feedback-card" id="claim-info-card">
      <div id="claim-card-body">
        <h5>Bu firma sana mı ait?</h5>
        <p>Bilgilerini güncellemek ya da açık pozisyon yayınlamak için bizimle iletişime geç.</p>
      </div>
    </div>
    <div class="feedback-card" id="correction-info-card">
      <h5>Geri Bildirim</h5>
      <p>Hatalı ya da eksik bir bilgi görüyorsan bize bildir.</p>
      <div id="correction-card-extra"></div>
    </div>`;

  const RIGHT_TEMPLATE = `
    <div class="related-section" id="om-founders-section" style="display:none;">
      <h2 class="related-title">Kurucular / Ortaklar</h2>
      <div class="related-grid-scroll" id="om-founders-grid"></div>
    </div>
    <div class="related-section" id="om-related-projects-section" style="display:none;">
      <h2 class="related-title">Projeler</h2>
      <div class="related-grid-scroll" id="om-related-projects-grid"></div>
    </div>
    <div class="related-section" id="om-related-products-section" style="display:none;">
      <h2 class="related-title">Ürünler</h2>
      <div class="related-grid-scroll" id="om-related-products-grid"></div>
    </div>
    <div class="related-section" id="om-related-materials-section" style="display:none;">
      <h2 class="related-title">Malzemeler</h2>
      <div class="related-grid-scroll" id="om-related-materials-grid"></div>
    </div>
    <div class="prevnext" id="om-prevnext"></div>
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

  // bkz. js/components/architect-modal.js#renderTruncatedDesc — BİREBİR aynı desen.
  const DESC_TRUNCATE_AT = 320;
  function renderTruncatedDesc(elId, text) {
    const el = document.getElementById(elId);
    if (text.length <= DESC_TRUNCATE_AT) { el.textContent = text; return; }
    const truncated = text.slice(0, DESC_TRUNCATE_AT).trim();
    el.innerHTML = `${escapeHtml(truncated)}… <button type="button" class="detail-desc-more">Devamını gör...</button>`;
    el.querySelector('.detail-desc-more').addEventListener('click', () => { el.textContent = text; });
  }

  // badgeHtml: yalnızca kurucu/ortak kartlarında geçilir (bkz. kullanıcı isteği: mavi onay rozetinin
  // ilişkili TÜM alanlarda görünmesi) — proje/ürün/malzeme kartlarında rozet anlamsız olduğundan
  // çağıranlar orada bu parametreyi hiç geçmez.
  function cardHtml(href, title, image, subtitle, badgeHtml) {
    const srcset = image ? cdnSrcset(image, [300, 450, 600]) : '';
    return `<a class="related-card" href="${href}">
      ${image ? `<img src="${escapeAttr(cdnImg(image, 450))}"${srcset ? ` srcset="${escapeAttr(srcset)}" sizes="300px"` : ''} alt="${escapeAttr(title)}" loading="lazy" decoding="async">` : `<div class="related-card-placeholder" style="background:${officeColor(title)}">${escapeHtml(initials(title))}</div>`}
      <div class="related-card-title"><span class="related-card-title-text">${escapeHtml(title)}${badgeHtml || ''}</span>${subtitle ? `<div class="related-card-subtitle">${escapeHtml(subtitle)}</div>` : ''}</div>
    </a>`;
  }

  // Kurucular kutusuna yazılmış ama architects tablosunda karşılığı olmayan (bkz.
  // src/routes/office.js#fetchRawFounderNames, `unregistered: true`) isimler — tıklanabilir bir
  // profil kartı DEĞİL, yuvarlak baş harfli pasif bir rozet (bkz. kullanıcı isteği).
  function unregisteredBadgeHtml(name) {
    return `<span class="unregistered-badge" aria-disabled="true">
      <span class="unregistered-badge-avatar" style="background:${officeColor(name)}">${escapeHtml(initials(name))}</span>
      <span class="unregistered-badge-name">${escapeHtml(name)}</span>
    </span>`;
  }

  // Mevcut veri "İl / İlçe" sırasıyla girilmiş (ör. "İstanbul / Beyoğlu") — künyede "İlçe, İl"
  // sırasıyla göstermek için sadece bu kalıba uyan değerleri çevirir (ofis-detay.html ile aynı).
  function formatLocationDistrictFirst(loc) {
    const m = /^([^/]+?)\s*\/\s*(.+)$/.exec(loc || '');
    return m ? `${m[2].trim()}, ${m[1].trim()}` : loc;
  }

  function safeUrl(u) {
    try {
      const parsed = new URL(u, window.location.href);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
    } catch {}
    return '';
  }

  // bkz. js/components/architect-modal.js#renderPrevNext — BİREBİR aynı desen, Firma etiketleriyle.
  // Yön kasıtlı olarak TERS çevrilmiştir (bkz. js/components/project-modal.js#renderPrevNext'teki
  // AYNI gerekçe/kullanıcı isteği) — payload.nextItem/prevItem'in kendisi değişmedi, yalnızca hangisi
  // .prev/.next slotunu doldurduğu swap edildi.
  function renderPrevNext(payload) {
    const el = document.getElementById('om-prevnext');
    let html = '';
    if (payload.nextItem) html += `<a class="prev" href="/firma/${encodeURIComponent(payload.nextItem.slug)}"><span class="prevnext-label">← Önceki Firma</span><span class="prevnext-title">${escapeHtml(payload.nextItem.title)}</span></a>`;
    if (payload.prevItem) html += `<a class="next" href="/firma/${encodeURIComponent(payload.prevItem.slug)}"><span class="prevnext-label">Sonraki Firma →</span><span class="prevnext-title">${escapeHtml(payload.prevItem.title)}</span></a>`;
    el.innerHTML = html;
  }

  function updateHeadMeta(o) {
    document.title = `${o.name} — MİMARLAB`;
    const desc = `${o.name}${o.loc ? ' — ' + o.loc : ''}. MİMARLAB'da firma profilini incele.`;
    const canonicalUrl = `https://mimarlab.com/firma/${encodeURIComponent(slugify(o.name))}`;
    const logo = logoUrl(o);
    const image = logo ? new URL(logo, window.location.origin).href : 'https://mimarlab.com/logos/site/mimarlab-og-image.png';
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

  function renderStructuredData(o) {
    let tag = document.getElementById('om-ld-json');
    if (!tag) {
      tag = document.createElement('script');
      tag.type = 'application/ld+json';
      tag.id = 'om-ld-json';
      document.head.appendChild(tag);
    }
    const data = { '@context': 'https://schema.org', '@type': 'Organization', name: o.name, url: window.location.href };
    if (o.about) data.description = o.about;
    if (o.yil) data.foundingDate = String(o.yil);
    if (o.loc) data.address = { '@type': 'PostalAddress', addressLocality: o.loc };
    const logo = logoUrl(o);
    if (logo) { try { data.logo = new URL(logo, window.location.href).href; } catch {} }
    if (o.website && safeUrl(o.website)) data.sameAs = [safeUrl(o.website)];
    tag.textContent = JSON.stringify(data);
  }

  async function renderItem(payload) {
    const o = payload.item;
    const founders = payload.founders || [];
    const relatedProjectsData = payload.relatedProjects || [];
    currentItem = o;

    updateHeadMeta(o);
    document.getElementById('om-name-text').textContent = o.name;
    renderTruncatedDesc('om-about', o.about || '');

    const infoFacts = [];
    if (o.yil) infoFacts.push(`<div><strong>Kuruluş Yılı:</strong> ${escapeHtml(String(o.yil))}</div>`);
    if (o.loc) infoFacts.push(`<div><strong>Konum:</strong> ${escapeHtml(formatLocationDistrictFirst(o.loc))}</div>`);
    if (o.cats) infoFacts.push(`<div><strong>Hizmet Alanı:</strong> ${escapeHtml(o.cats)}</div>`);
    const infoFactsEl = document.getElementById('om-info-facts');
    infoFactsEl.innerHTML = infoFacts.join('');
    infoFactsEl.style.display = infoFacts.length ? '' : 'none';

    const logoEl = document.getElementById('om-logo');
    logoEl.innerHTML = '';
    logoEl.textContent = initials(o.name);
    logoEl.style.background = officeColor(o.name);
    const officeLogoUrl = logoUrl(o);
    if (officeLogoUrl) {
      const img = document.createElement('img');
      img.src = officeLogoUrl;
      img.alt = '';
      img.decoding = 'async';
      img.fetchPriority = 'high';
      img.onerror = () => img.remove();
      logoEl.appendChild(img);
    }

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'save-btn card-save-btn';
    saveBtn.id = 'om-save-btn';
    saveBtn.setAttribute('aria-label', 'Kaydet');
    saveBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z"/></svg><span class="save-btn-label-default">Kaydet</span><span class="save-btn-label-saved">Kaydedildi</span><span class="save-btn-count" id="om-save-count"></span>`;
    const actionsEl = document.getElementById('om-actions');
    actionsEl.innerHTML = '';
    actionsEl.prepend(saveBtn);
    // Düzenle/Arşivle/Sil artık bu satırda DEĞİL — modal-shell.js'in paylaşılan header'ında, X
    // butonunun yanında render edilir (bkz. kullanıcı isteği) — claim-correction-box.js#
    // renderProfileEditButton hâlâ #profile-edit-slot id'sini arıyor, yalnızca DOM konumu değişti.
    const headerActions = ModalShell.getHeaderActionsSlot();
    if (headerActions) headerActions.innerHTML = '<span id="profile-edit-slot"></span>';
    saveBtn.dataset.key = slugify(o.name);
    saveBtn.dataset.title = o.name;
    saveBtn.dataset.meta = o.loc || '';
    saveBtn.dataset.image = officeLogoUrl || '';
    saveBtn.dataset.href = `/firma/${encodeURIComponent(slugify(o.name))}`;
    wireSaveButtons('office');
    fetch(`/api/public/save-count?type=office&key=${encodeURIComponent(saveBtn.dataset.key)}`)
      .then(r => r.json())
      .then(data => { const el = document.getElementById('om-save-count'); if (el) el.textContent = data.count > 0 ? ` (${data.count})` : ''; })
      .catch(() => {});
    if (typeof ShareWidget !== 'undefined') {
      saveBtn.insertAdjacentHTML('afterend', ShareWidget.html('om-share-btn'));
      ShareWidget.wire('om-share-btn', () => ({ title: o.name, url: `${window.location.origin}/firma/${encodeURIComponent(slugify(o.name))}` }));
    }

    // "Websitesi" — Kaydet ile AYNI satırda, hemen soluna (bkz. kullanıcı isteği) —
    // .save-btn sınıfını (kart bağlamındaki değil, bu enjekte edilen stil) birebir paylaşarak
    // font/boyut/yükseklik/padding/radius otomatik olarak Kaydet'le eş değer kalır.
    const visitUrl = o.website ? safeUrl(o.website) : '';
    if (visitUrl) {
      const visitBtn = document.createElement('a');
      visitBtn.className = 'save-btn';
      visitBtn.href = visitUrl;
      visitBtn.target = '_blank';
      visitBtn.rel = 'noopener';
      visitBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg><span>Websitesi</span>`;
      actionsEl.prepend(visitBtn);
    }

    renderStructuredData(o);
    renderPrevNext(payload);

    document.getElementById('om-founders-section').style.display = founders.length ? '' : 'none';
    // renderFoundersGrid ayrı bir fonksiyon olarak tutulur — aşağıdaki renderVerifiedBadges ile AYNI
    // /api/public/badges gecikmesi burada da var, rozetler geldiğinde tekrar çizilir.
    function renderFoundersGrid() {
      document.getElementById('om-founders-grid').innerHTML = founders.map(a => a.unregistered
        ? unregisteredBadgeHtml(a.name)
        : cardHtml(`/mimar/${encodeURIComponent(slugify(a.name))}`, a.name, a.photo, a.role, verifiedBadgeHtml('architect', a.name, a.badges, 14))
      ).join('');
    }
    renderFoundersGrid();

    document.getElementById('om-related-projects-section').style.display = relatedProjectsData.length ? '' : 'none';
    document.getElementById('om-related-projects-grid').innerHTML = relatedProjectsData.map(p =>
      cardHtml(`/projeler/${encodeURIComponent(p.slug)}`, p.title, p.images && p.images[0])
    ).join('');

    const PROFILE_TYPE = 'office';
    const claimBox = createClaimCorrectionBox({
      profileType: PROFILE_TYPE,
      ready: savedWidgetReady,
      getProfileKey: () => o.name,
      getClaimLinkKey: () => o._claimKey || o.name,
      getStaticBadges: () => o.badges,
      editUrlBase: 'firma-ekle.html',
      listUrl: 'firma.html',
      contentType: 'offices',
      getModerationTarget: () => o.submissionId ? { id: o.submissionId } : { key: o.name },
      labels: {
        claimTitle: 'Bu firma sana mı ait?',
        loginPromptHtml: 'Bilgilerini güncellemek ve Doğrulanmış Profil rozeti almak için <a href="giris-yap.html" class="info-card-link">giriş yap</a>.',
        pendingHtml: '"Bu firma bana ait" talebini aldık, ekibimiz en kısa sürede onaylayacak.',
        claimNoteDescription: 'Bu firmanın sana ait olduğunu doğrulayabileceğimiz bir not ekle.',
        claimButtonText: 'Gönder',
        deleteConfirm: 'Bu firma profilini silmek istediğine emin misin? Profil anında canlı siteden kaldırılır.',
        archiveConfirm: 'Bu firma profilini arşivlemek istediğine emin misin? Profil canlıdan kaldırılıp admin panelindeki Arşiv sekmesine taşınır.',
      },
    });

    async function loadRelatedProducts() {
      try {
        const res = await fetch(`/api/public/profile-content?profileType=office&profileKey=${encodeURIComponent(o.name)}`);
        if (!res.ok) return;
        const data = await res.json();
        const products = data.products || [];
        document.getElementById('om-related-products-section').style.display = products.length ? '' : 'none';
        document.getElementById('om-related-products-grid').innerHTML = products.map(p => cardHtml('urun.html', p.title, p.image, p.category)).join('');
        const materials = data.materials || [];
        document.getElementById('om-related-materials-section').style.display = materials.length ? '' : 'none';
        document.getElementById('om-related-materials-grid').innerHTML = materials.map(m => cardHtml('urun.html', m.title, m.image, m.category)).join('');
      } catch {}
    }

    function renderVerifiedBadges() {
      document.getElementById('om-verified-badge-wrap').innerHTML = verifiedBadgeHtml(PROFILE_TYPE, o.name, o.badges, 20);
      // bkz. kullanıcı isteği: mavi rozet kurucu/ortak kartlarında da görünmeli — isim bazlı
      // dynamicBadges önbelleğine bağlı olduğundan başlıktaki rozetle AYNI anda tazelenir.
      renderFoundersGrid();
    }
    renderVerifiedBadges();
    window.addEventListener('mimarlab-badges-ready', renderVerifiedBadges, { once: true });

    loadRelatedProducts();
    await savedWidgetReady;
    await claimBox.init();

    wireInternalNav();
    ModalShell.scrollToTop();
  }

  function renderNotFound() {
    document.getElementById('om-name-text').textContent = 'Firma bulunamadı';
    const headerActions = ModalShell.getHeaderActionsSlot();
    if (headerActions) headerActions.innerHTML = '';
    ['om-actions', 'om-founders-section', 'om-related-projects-section', 'om-related-products-section',
      'om-related-materials-section', 'om-detail-info', 'om-prevnext'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  function wireInternalNav() {
    const panels = ModalShell.getPanels();
    if (!panels || panels.bodyEl.dataset.omNavWired) return;
    panels.bodyEl.dataset.omNavWired = '1';
    panels.bodyEl.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="/firma/"]');
      if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const m = a.getAttribute('href').match(/^\/firma\/([^/?#]+)/);
      if (!m) return;
      e.preventDefault();
      swap(decodeURIComponent(m[1]));
    });
  }

  async function fetchItem(slug) {
    const res = await fetch(`/api/office/${encodeURIComponent(slug)}`);
    if (!res.ok) return null;
    const payload = await res.json();
    if (!payload || !payload.item || payload.hidden) return null;
    return payload;
  }

  async function open(slug, { pushHistory = true, triggerEl = null } = {}) {
    currentSlug = slug;
    openedViaPush = pushHistory;
    pushCountSinceOpen = pushHistory ? 1 : 0;
    if (pushHistory) history.pushState({ mimarlabModal: 'office', slug, depth: 1 }, '', `/firma/${encodeURIComponent(slug)}`);
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
    const currentDepth = (history.state && history.state.mimarlabModal === 'office') ? history.state.depth : pushCountSinceOpen;
    pushCountSinceOpen = currentDepth + 1;
    history.pushState({ mimarlabModal: 'office', slug, depth: pushCountSinceOpen }, '', `/firma/${encodeURIComponent(slug)}`);
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
    else history.pushState({}, '', '/firma');
    ModalShell.close();
    pushCountSinceOpen = 0;
  }

  function handlePopState(slug) {
    if (!slug) { if (ModalShell.isOpen()) { currentSlug = null; currentItem = null; ModalShell.close(); } return; }
    if (!ModalShell.isOpen()) { openedViaPush = false; open(slug, { pushHistory: false }); return; }
    if (history.state && history.state.mimarlabModal === 'office' && typeof history.state.depth === 'number') {
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
