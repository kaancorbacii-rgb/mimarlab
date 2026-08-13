// ProjectModal — proje detay modalının orkestratörü. Route/history state machine'i, eager/deferred
// içerik sıralamasını ve alt bileşenlerin (ProjectGallery/ProjectMeta/ProjectActions/
// ProjectComments/ArchitectProjects/RelatedProjects) tek bir DOM iskeletine
// bağlanmasını yönetir. DOM çerçevesi (overlay/panel/focus-trap/scroll-lock) js/components/
// modal-shell.js'ten gelir — bu dosya yalnızca PROJEYE ÖZGÜ kısmı bilir.
const ProjectModal = (function () {
  const LEFT_TEMPLATE = `
    <h1 class="detail-title" id="pm-title"></h1>
    <div class="pm-rating-save-row" id="pm-rating-save-row">
      <div class="rating-widget" id="pm-rating" data-type="project"></div>
      <div id="pm-save-slot"></div>
    </div>
    <div class="detail-byline" id="pm-byline" style="display:none;">
      <span class="detail-byline-avatar" id="pm-byline-avatar"></span>
      <span id="pm-byline-text"></span>
    </div>
    <div class="detail-info">
      <div class="designer-section" id="pm-architect-section" style="display:none;">
        <div class="designer-label">Mimar:</div>
        <div class="designer-chips" id="pm-architect-chips"></div>
      </div>
      <div class="designer-section" id="pm-office-section" style="display:none;">
        <div class="designer-label">Mimarlık Firması:</div>
        <div class="designer-chips" id="pm-office-chips"></div>
      </div>
      <div class="detail-meta" id="pm-meta"></div>
      <div class="detail-desc" id="pm-desc"></div>
    </div>
    <details class="comments-section" id="pm-comments-section" aria-live="polite">
      <summary class="comments-title">Yorumlar (<span id="pm-comments-count">0</span>)<span class="feedback-card-plus" aria-hidden="true"></span></summary>
      <div class="comment-form-wrap" id="pm-comment-form-wrap"></div>
      <div class="comments-list" id="pm-comments-list"></div>
    </details>
    <hr class="pm-info-divider" id="pm-info-divider">
    <details class="pm-feedback-card" id="pm-feedback-card">
      <summary>Geri Bildirim<span class="feedback-card-plus" aria-hidden="true"></span></summary>
      <p>Hatalı ya da eksik bir bilgi görüyorsan bize bildir.</p>
      <div id="pm-feedback-body"></div>
    </details>`;

  const RIGHT_TEMPLATE = `
    <div class="gallery-wrap" id="pm-gallery-wrap">
      <div class="gallery-media">
        <div class="detail-gallery" id="pm-gallery"></div>
        <button class="gallery-nav gallery-prev" id="pm-gallery-prev" type="button" aria-label="Önceki görsel"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg></button>
        <button class="gallery-nav gallery-next" id="pm-gallery-next" type="button" aria-label="Sonraki görsel"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg></button>
      </div>
      <div class="gallery-counter" id="pm-gallery-counter"></div>
    </div>

    <div class="related-section" id="pm-same-designer-section" aria-live="polite">
      <h2 class="related-title">Mimarın/Firmanın Diğer Projeleri</h2>
      <div class="related-grid-scroll" id="pm-same-designer-grid"></div>
    </div>

    <div class="related-section" id="pm-related-section" aria-live="polite">
      <h2 class="related-title">İlgili Projeler</h2>
      <div class="related-grid-scroll" id="pm-related-grid"></div>
    </div>

    <div class="related-section" id="pm-products-section" aria-live="polite">
      <h2 class="related-title">Kullanılan Ürünler</h2>
      <div class="catalog-grid-scroll" id="pm-products-grid"></div>
    </div>

    <div class="related-section" id="pm-materials-section" aria-live="polite">
      <h2 class="related-title">Kullanılan Malzemeler</h2>
      <div class="catalog-grid-scroll" id="pm-materials-grid"></div>
    </div>

    <div class="prevnext" id="pm-prevnext"></div>

    <div class="lightbox" id="pm-lightbox">
      <button class="lightbox-close" id="pm-lightbox-close" aria-label="Kapat"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      <button class="lightbox-nav lightbox-prev" id="pm-lightbox-prev" aria-label="Önceki görsel"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>
      <img id="pm-lightbox-img" src="" alt="" decoding="async">
      <button class="lightbox-nav lightbox-next" id="pm-lightbox-next" aria-label="Sonraki görsel"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></button>
      <div class="lightbox-counter" id="pm-lightbox-counter"></div>
    </div>`;

  let mountedOnce = false;
  let currentSlug = null;
  let currentItem = null;
  let currentBasePath = '/proje/';
  let openedViaPush = false; // bu açılış gerçek bir tıklamadan mı geldi (history.back güvenli mi)
  let pushCountSinceOpen = 0; // open() + o zamandan beri yapılan swap() sayısı — kapatırken TÜMÜNÜ
  // tek seferde geri sarmak için (bkz. close(), history.go(-N)) — modal içinde birden fazla projeye
  // bakıldıktan sonra X/Escape'e basmak, yalnızca son swap'ı değil doğrudan asıl listeye dönmeli.
  let requestSeq = 0; // yarışan open()/swap() çağrılarından yalnızca sonuncusunun render etmesi için

  function ensureTemplate() {
    if (mountedOnce) return;
    const panels = ModalShell.getPanels();
    panels.leftPanelEl.innerHTML = LEFT_TEMPLATE;
    panels.rightPanelEl.innerHTML = RIGHT_TEMPLATE;
    ModalShell.wireGridScrollArrows(panels.rightPanelEl);
    mountedOnce = true;
  }

  function skeletonCardsHtml(n, className) {
    return Array.from({ length: n }).map(() => `<div class="${className || 'related-card'} skeleton-card"></div>`).join('');
  }

  // Bir bölümü (yorumlar/diğer projeler/ilgili projeler/ürünler) yalnızca kullanıcı ona doğru
  // kaydırdığında yükler (bkz. kullanıcı isteği: deferred/lazy). display:none olan bir elemanın
  // layout kutusu olmadığından IntersectionObserver hiçbir zaman tetiklenmez — bu yüzden bölümler
  // BAŞTAN görünür bir iskelet (skeleton) ile render edilir, veri geldiğinde ya gerçek içerikle
  // değiştirilir ya da (sonuç boşsa) o zaman gizlenir.
  //
  // gerçek bulgu: "İlgili Projeler" bazı durumlarda kalıcı olarak boş/iskelet kalıyordu — bölüm açılış
  // anında zaten görünür alanın İÇİNDE olsa bile IntersectionObserver'ın tetiklenmesi tarayıcı/cihaza
  // göre gözle görülür şekilde gecikebiliyor (bir sonraki layout/compositor turuna kadar). Salt IO'ya
  // güvenmek yerine, timeoutMs verildiğinde bir de zaman aşımı yedeği kurulur — hangisi önce olursa
  // (görünürlük ya da süre) yükleme O ZAMAN tetiklenir, diğeri iptal edilir. Bu, bölümün ekranda asla
  // sonsuza dek boş kalmamasını GARANTİ eder, ekstra bir maliyeti yoktur (küçük JSON istekleri,
  // görsel indirme değil).
  function observeOnce(el, loadFn, timeoutMs) {
    if (!el) return;
    let done = false;
    let timer = null;
    const trigger = () => {
      if (done) return;
      done = true;
      obs.disconnect();
      if (timer) clearTimeout(timer);
      loadFn();
    };
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => { if (entry.isIntersecting) trigger(); });
    }, { rootMargin: '200px' });
    obs.observe(el);
    if (timeoutMs) timer = setTimeout(trigger, timeoutMs);
  }

  // "Bilgi Kaynağı & Geri Bildirim" kutusu — js/components/claim-correction-box.js#loadCorrectionCard
  // ile BİREBİR aynı UX/istek deseni (boş not koruması, gönderim sırasında disable, başarı/hata mesajı),
  // ama profil sahiplenme semantiğinden bağımsız olduğundan burada kendi başına, sade tutulur. /api/corrections
  // artık 'project'/'product' profileType'larını da kabul ediyor (bkz. src/routes/claims.js#CORRECTION_PROFILE_TYPES).
  function wireFeedbackBox(item) {
    const body = document.getElementById('pm-feedback-body');
    if (!body) return;
    if (!currentUser) {
      body.innerHTML = `<p style="margin-top:10px; font-size:13px; color:var(--ink-soft);">Bir bildirim göndermek için <a href="giris-yap.html" style="color:var(--walnut); font-weight:600; text-decoration:underline;">giriş yap</a>.</p>`;
      return;
    }
    body.innerHTML = `
      <div class="feedback-input-wrap">
        <textarea id="pm-feedback-note" placeholder=""></textarea>
        <button type="button" class="comment-submit-btn" id="pm-feedback-btn">Bildir</button>
      </div>
      <p id="pm-feedback-result" style="display:none;"></p>`;
    document.getElementById('pm-feedback-btn').addEventListener('click', async (e) => {
      const btn = e.target;
      const note = document.getElementById('pm-feedback-note').value.trim();
      const feedback = document.getElementById('pm-feedback-result');
      if (!note) {
        feedback.textContent = 'Lütfen bir not yaz.';
        feedback.style.display = '';
        return;
      }
      btn.disabled = true; btn.textContent = 'Gönderiliyor…';
      try {
        const res = await fetch('/api/corrections', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileType: 'project', profileKey: item.slug, note }),
        });
        feedback.textContent = res.ok ? 'Teşekkürler, önerini aldık.' : 'Bir şeyler ters gitti, tekrar dene.';
        feedback.style.display = '';
        if (res.ok) document.getElementById('pm-feedback-note').value = '';
      } catch {
        feedback.textContent = 'Sunucuya ulaşılamadı, tekrar dene.';
        feedback.style.display = '';
      } finally {
        btn.disabled = false; btn.textContent = 'Bildir';
      }
    });
  }

  function armDeferredSections(item, mySeq) {
    const commentsSection = document.getElementById('pm-comments-section');
    document.getElementById('pm-comments-list').innerHTML = '';
    document.getElementById('pm-comment-form-wrap').innerHTML = `<div class="comment-form"><div class="skeleton-line" style="height:90px;border-radius:12px;"></div></div>`;
    observeOnce(commentsSection, () => { if (mySeq === requestSeq) ProjectComments.mount(commentsSection, item.slug); }, 1200);
    document.getElementById('pm-feedback-body').innerHTML = '';
    savedWidgetReady.then(() => { if (mySeq === requestSeq) wireFeedbackBox(item); });

    const sameDesignerSection = document.getElementById('pm-same-designer-section');
    const relatedSection = document.getElementById('pm-related-section');
    document.getElementById('pm-same-designer-grid').innerHTML = skeletonCardsHtml(4);
    document.getElementById('pm-related-grid').innerHTML = skeletonCardsHtml(4);
    // ArchitectProjects/RelatedProjects artık PARALEL yüklenir (bkz. kullanıcı isteği: ana renderı
    // bloklamadan Promise.allSettled ile arka planda yükleme) — RelatedProjects kendi /api/projects
    // sorgularını ArchitectProjects'in (çok projeli mimarlarda yavaş olabilen, sayfalanmış) fetch'i
    // TAMAMEN bitmeden başlatır, yalnızca dışlama seti için architectSlugsPromise'i bekler (bkz.
    // js/components/project-related.js#mount dosya başı yorumu).
    observeOnce(sameDesignerSection, () => {
      if (mySeq !== requestSeq) return;
      const architectSlugsPromise = ArchitectProjects.mount(item).then(r => (mySeq === requestSeq && r) ? r.slugs : new Set());
      const relatedPromise = RelatedProjects.mount(item, architectSlugsPromise);
      Promise.allSettled([architectSlugsPromise, relatedPromise]);
    }, 600);

    const productsSection = document.getElementById('pm-products-section');
    const materialsSection = document.getElementById('pm-materials-section');
    document.getElementById('pm-products-grid').innerHTML = skeletonCardsHtml(4, 'catalog-card');
    document.getElementById('pm-materials-grid').innerHTML = skeletonCardsHtml(4, 'catalog-card');
    observeOnce(productsSection, () => { if (mySeq === requestSeq) ProjectProducts.mount(item); }, 1200);
  }

  // Önceki/Sonraki Proje — bkz. src/routes/project.js#fetchAdjacentProject: dairesel/sıralı
  // gezinme artık sunucuda id sırasına göre hesaplanıp item.prevProject/nextProject olarak gelir,
  // istemci hafızasındaki eski `navList` (yalnızca karttan tıklanarak açıldığında dolu olan, F5/
  // doğrudan URL girişinde boş kalan) yöntemi yerine HER AÇILIŞTA eksiksiz çıkar (bkz. kullanıcı isteği).
  // Yön kasıtlı olarak TERS çevrilmiştir (bkz. kullanıcı isteği): "Önceki" butonu artık kronolojik
  // olarak SONRAKİ (id büyüyen) projeye, "Sonraki" butonu artık kronolojik olarak ÖNCEKİ (id küçülen)
  // projeye gider — item.nextProject/item.prevProject'in KENDİSİ (bkz. src/routes/project.js#
  // fetchAdjacentProject) değişmedi, yalnızca hangisinin .prev/.next slotunu doldurduğu swap edildi.
  // bkz. kullanıcı isteği: Önceki/Sonraki butonlarının içine önizleme görseli eklenmesi.
  function prevNextThumbHtml(item) {
    return item.image
      ? `<img class="prevnext-thumb" src="${escapeAttr(cdnImg(item.image, 120))}" alt="" loading="lazy" decoding="async">`
      : `<div class="prevnext-thumb prevnext-thumb-placeholder" style="background:${officeColor(item.title)}">${escapeHtml(initials(item.title))}</div>`;
  }

  function renderPrevNext(item) {
    const el = document.getElementById('pm-prevnext');
    let html = '';
    if (item.nextProject) html += `<a class="prev" href="/proje/${encodeURIComponent(item.nextProject.slug)}">${prevNextThumbHtml(item.nextProject)}<span class="prevnext-text"><span class="prevnext-label">← Önceki Proje</span><span class="prevnext-title">${escapeHtml(item.nextProject.title)}</span></span></a>`;
    if (item.prevProject) html += `<a class="next" href="/proje/${encodeURIComponent(item.prevProject.slug)}">${prevNextThumbHtml(item.prevProject)}<span class="prevnext-text"><span class="prevnext-label">Sonraki Proje →</span><span class="prevnext-title">${escapeHtml(item.prevProject.title)}</span></span></a>`;
    el.innerHTML = html;
  }

  function updateHeadMeta(item) {
    document.title = `${item.title} — MİMARLAB`;
    const rawDesc = item.description || `${item.title}${item.location ? ' — ' + item.location : ''}. MİMARLAB'da proje detaylarını incele.`;
    const desc = rawDesc.length > 200 ? rawDesc.slice(0, 197) + '…' : rawDesc;
    const canonicalUrl = `https://mimarlab.com/proje/${encodeURIComponent(item.slug)}`;
    const image = (item.images && item.images[0]) ? new URL(item.images[0], window.location.origin).href : 'https://mimarlab.com/logos/site/mimarlab-og-image.png';
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

  // Delege edilmiş tıklama dinleyicisi: modal içindeki HERHANGİ bir /proje/:slug bağlantısına
  // (İlgili Projeler, Diğer Projeleri, önceki/sonraki) tıklanınca overlay kapanıp yeniden AÇILMAZ —
  // yalnızca içerik ve URL güncellenir (bkz. kullanıcı isteği).
  function wireInternalNav() {
    const panels = ModalShell.getPanels();
    if (!panels || panels.bodyEl.dataset.pmNavWired) return;
    panels.bodyEl.dataset.pmNavWired = '1';
    panels.bodyEl.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="/proje/"]');
      if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const m = a.getAttribute('href').match(/^(\/proje\/)([^/?#]+)/);
      if (!m) return;
      e.preventDefault();
      swap(decodeURIComponent(m[2]), m[1]);
    });
  }

  async function fetchItem(slug) {
    const res = await fetch(`/api/project/${encodeURIComponent(slug)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.item || null;
  }

  // "X tarafından" satırı — yalnızca üye gönderisi kökenli projelerde dolu (bkz. src/routes/
  // project.js#fetchOwnerByline item.ownerName alanı), statik/admin kökenli projelerde gizli kalır.
  function renderByline(item) {
    const wrap = document.getElementById('pm-byline');
    if (!item.ownerName) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    const avatar = document.getElementById('pm-byline-avatar');
    avatar.style.background = officeColor(item.ownerName);
    avatar.innerHTML = escapeHtml(initials(item.ownerName)) + (item.ownerPhoto ? `<img src="${escapeAttr(item.ownerPhoto)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : '');
    document.getElementById('pm-byline-text').innerHTML = `<strong>${escapeHtml(item.ownerName)}</strong>${badgeIconHtml(item.ownerBadge, 14)} tarafından`;
  }

  // renderNotFound() bu ID'leri gizler (bkz. aşağısı); ModalShell'in şablonu sayfa ömrü boyunca
  // TEK SEFER mount edip yeniden kullandığı için (bkz. ensureTemplate#mountedOnce), bir kez 404/ağ
  // hatası alınıp bu bölümler gizlendikten sonra bir sonraki BAŞARILI render bunları geri
  // AÇMAZSA aynı sekmede açılan sıradaki projeler kalıcı olarak yarı-boş görünürdü (gerçek bulgu —
  // bkz. kullanıcı isteği: "bazı sayfalar boş geliyor"). Bu yüzden her başarılı renderItem() en
  // başta hepsini görünür durumuna sıfırlar; ilgili alt render fonksiyonları (renderByline,
  // ProjectMeta.render, RelatedProjects.mount vb.) kendi koşuluna göre tekrar gizleyebilir.
  const HIDE_ON_NOT_FOUND_IDS = ['pm-rating-save-row', 'pm-byline', 'pm-architect-section', 'pm-office-section',
    'pm-meta', 'pm-desc', 'pm-comments-section', 'pm-info-divider', 'pm-feedback-card', 'pm-same-designer-section',
    'pm-related-section', 'pm-products-section', 'pm-materials-section', 'pm-prevnext', 'pm-gallery-wrap'];

  async function renderItem(item, mySeq) {
    currentItem = item;
    HIDE_ON_NOT_FOUND_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    });
    updateHeadMeta(item);
    renderByline(item);
    ProjectMeta.render(item);
    ProjectGallery.render(item);
    ProjectActions.render(item);
    if (typeof mountRatingWidget === 'function') {
      const ratingEl = document.getElementById('pm-rating');
      ratingEl.dataset.key = item.slug;
      mountRatingWidget(ratingEl);
    }
    renderPrevNext(item);
    armDeferredSections(item, mySeq);
    wireInternalNav();
    ModalShell.scrollToTop();
  }

  function renderNotFound() {
    document.getElementById('pm-title').textContent = 'Proje bulunamadı';
    const headerActions = ModalShell.getHeaderActionsSlot();
    if (headerActions) headerActions.innerHTML = '';
    HIDE_ON_NOT_FOUND_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  async function open(slug, { pushHistory = true, triggerEl = null, basePath = '/proje/' } = {}) {
    await ModalShell.waitForPendingNav();
    currentSlug = slug;
    currentBasePath = basePath;
    openedViaPush = pushHistory;
    pushCountSinceOpen = pushHistory ? 1 : 0;
    if (pushHistory) history.pushState({ mimarlabModal: 'project', slug, depth: 1 }, '', `${currentBasePath}${encodeURIComponent(slug)}`);
    // ModalShell.open() ÖNCE çağrılır (overlay/panel DOM'unu ilk kez o oluşturur) — ensureTemplate()
    // panellere innerHTML basmaya çalıştığında panel elemanları henüz yoksa (bkz. gerçek bulgu) null
    // referans hatası verirdi.
    ModalShell.open({ triggerEl, onRequestClose: close });
    ensureTemplate();

    const mySeq = ++requestSeq;
    const item = await fetchItem(slug);
    if (mySeq !== requestSeq || currentSlug !== slug) return; // bu arada başka bir open/swap tetiklendi
    if (!item) { renderNotFound(); return; }
    await renderItem(item, mySeq);
  }

  async function swap(slug, basePath) {
    if (!ModalShell.isOpen()) return open(slug, { pushHistory: true, basePath: basePath || '/proje/' });
    await ModalShell.waitForPendingNav();
    if (basePath) currentBasePath = basePath;
    currentSlug = slug;
    // pushCountSinceOpen'ı doğrudan artırmak yerine mevcut history.state.depth'ten türetilir — bkz.
    // gerçek bulgu: kullanıcı iki proje gezindikten SONRA tarayıcının geri tuşuyla bir öncekine
    // dönüp ORADAN X/Escape'e basarsa, salt artan bir sayaç (her swap()'ta ++) geri navigasyonu asla
    // görmediğinden yanlış (fazla) bir mesafeye göre history.go(-N) çağırıp asıl listenin
    // ÖTESİNE geçerdi. history.state her girdiyle birlikte taşındığından (pushState'in kendi
    // mekanizması) her zaman doğru "buradan modal-öncesi duruma kaç adım var" bilgisini verir.
    const currentDepth = (history.state && history.state.mimarlabModal === 'project') ? history.state.depth : pushCountSinceOpen;
    pushCountSinceOpen = currentDepth + 1;
    history.pushState({ mimarlabModal: 'project', slug, depth: pushCountSinceOpen }, '', `${currentBasePath}${encodeURIComponent(slug)}`);
    const mySeq = ++requestSeq;
    const item = await fetchItem(slug);
    if (mySeq !== requestSeq || currentSlug !== slug) return;
    if (!item) { renderNotFound(); return; }
    await renderItem(item, mySeq);
  }

  // X/backdrop/Escape tetiklediğinde çağrılır (bkz. modal-shell.js#onRequestClose) — geçerli bir
  // aynı-sekme geçmiş girdisi varsa history.back() ile oraya (liste durumu korunarak) dönülür;
  // yoksa (doğrudan /proje/:slug ile açılmış bir sekme) /proje listesine pushState edilir.
  function close() {
    const listPath = currentBasePath.replace(/\/$/, '') || '/proje';
    currentSlug = null;
    currentItem = null;
    // openedViaPush yalnızca İLK open() gerçek bir tıklamadan geldiyse true (bkz. yukarıdaki alan
    // yorumu) — bu durumda pushCountSinceOpen (o zamandan beri yapılan TÜM swap()'lar dahil) kadar
    // tek seferde geri sarılır, böylece birden fazla proje gezildikten sonra bile X/Escape doğrudan
    // asıl listeye döner. Hydration ile açılmışsa (deep link/F5) listeye ait GÜVENLİ bir geçmiş
    // girdisi hiç yok — o durumda doğrudan listPath'e pushState edilir.
    if (openedViaPush && pushCountSinceOpen > 0) ModalShell.goBackAndWait(pushCountSinceOpen);
    else history.pushState({}, '', listPath);
    ModalShell.close();
    pushCountSinceOpen = 0;
  }

  // proje.html'in popstate dinleyicisi /proje/:slug yoluna geri/ileri gidildiğinde bunu çağırır
  // (bkz. o dosya). Burada TEKRAR pushState YAPILMAZ — URL zaten doğru.
  function handlePopState(slug, basePath) {
    // ensureTemplate() burada YOK — DOM'u ilk kez ModalShell.open() oluşturur (bkz. open()'daki AYNI
    // gerçek bulgu yorumu); modal zaten açıksa mountedOnce=true olduğundan zaten no-op olurdu.
    // wasCurrentPopSuperseded(): bu popstate, kapatılmakta olan BAŞKA bir modalın (ör. proje.html'de
    // aynı sayfada birlikte yaşayan ProductModal) gecikmiş history.go(-N)'i tarafından tetiklenmiş
    // olabilir — o sırada kullanıcı zaten YENİ bir open()/swap() başlatıp bu döngüye katıldıysa (bkz.
    // ModalShell.waitForPendingNav) bu geç gelen popstate artık bayat demektir, reaktif olarak
    // burada bir şey açıp/kapatmamalıyız (aksi halde az önce açılan modalın üzerine yazardık).
    if (ModalShell.wasCurrentPopSuperseded()) return;
    if (!slug) { if (ModalShell.isOpen()) { currentSlug = null; currentItem = null; ModalShell.close(); } return; }
    if (basePath) currentBasePath = basePath;
    if (!ModalShell.isOpen()) { openedViaPush = false; open(slug, { pushHistory: false, basePath: basePath || '/proje/' }); return; }
    // Geri/ileri ile bu projeye gelindi — history.state.depth (bkz. swap()'taki AYNI mekanizma)
    // pushCountSinceOpen'ı YENİDEN senkronlar, böylece buradan sonra X/Escape'e basılırsa
    // history.go(-N) doğru mesafeyi kullanır (geri navigasyon sırasında biriken sayaç sapmasını önler).
    if (history.state && history.state.mimarlabModal === 'project' && typeof history.state.depth === 'number') {
      pushCountSinceOpen = history.state.depth;
    }
    if (slug === currentSlug) return;
    currentSlug = slug;
    (async () => {
      const mySeq = ++requestSeq;
      const item = await fetchItem(slug);
      if (mySeq !== requestSeq || currentSlug !== slug) return;
      if (!item) { renderNotFound(); return; }
      await renderItem(item, mySeq);
    })();
  }

  function isOpen() { return ModalShell.isOpen(); }
  function getCurrentSlug() { return currentSlug; }

  return { open, swap, close, handlePopState, isOpen, getCurrentSlug };
})();
