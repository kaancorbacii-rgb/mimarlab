// ProjectModal — proje detay modalının orkestratörü. Route/history state machine'i, eager/deferred
// içerik sıralamasını ve alt bileşenlerin (ProjectGallery/ProjectMeta/ProjectActions/
// ProjectComments/ArchitectProjects/RelatedProjects/ProjectProducts) tek bir DOM iskeletine
// bağlanmasını yönetir. DOM çerçevesi (overlay/panel/focus-trap/scroll-lock) js/components/
// modal-shell.js'ten gelir — bu dosya yalnızca PROJEYE ÖZGÜ kısmı bilir.
const ProjectModal = (function () {
  const LEFT_TEMPLATE = `
    <h1 class="detail-title" id="pm-title"></h1>
    <div class="pm-rating-save-row" id="pm-rating-save-row">
      <div class="rating-widget" id="pm-rating" data-type="project"></div>
      <div id="pm-save-slot"></div>
    </div>
    <div class="detail-title-actions" id="pm-actions"></div>
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
    <div class="comments-section" id="pm-comments-section" aria-live="polite">
      <h2 class="comments-title">Yorumlar (<span id="pm-comments-count">0</span>)</h2>
      <div class="comment-form-wrap" id="pm-comment-form-wrap"></div>
      <div class="comments-list" id="pm-comments-list"></div>
    </div>`;

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

  function armDeferredSections(item, mySeq) {
    const commentsSection = document.getElementById('pm-comments-section');
    document.getElementById('pm-comments-list').innerHTML = '';
    document.getElementById('pm-comment-form-wrap').innerHTML = `<div class="comment-form"><div class="skeleton-line" style="height:90px;border-radius:12px;"></div></div>`;
    observeOnce(commentsSection, () => { if (mySeq === requestSeq) ProjectComments.mount(commentsSection, item.slug); }, 1200);

    const sameDesignerSection = document.getElementById('pm-same-designer-section');
    const relatedSection = document.getElementById('pm-related-section');
    document.getElementById('pm-same-designer-grid').innerHTML = skeletonCardsHtml(4);
    document.getElementById('pm-related-grid').innerHTML = skeletonCardsHtml(4);
    observeOnce(sameDesignerSection, async () => {
      if (mySeq !== requestSeq) return;
      const result = await ArchitectProjects.mount(item);
      if (mySeq !== requestSeq) return; // bu arada başka bir proje açıldı — yazma sonucu at (bkz. bir sonraki swap kendi armDeferredSections'ını çalıştırıp bölümü zaten doğru veriyle geçersiz kılar)
      await RelatedProjects.mount(item, result ? result.slugs : new Set());
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
  function renderPrevNext(item) {
    const el = document.getElementById('pm-prevnext');
    let html = '';
    if (item.prevProject) html += `<a class="prev" href="/projeler/${encodeURIComponent(item.prevProject.slug)}"><span class="prevnext-label">← Önceki Proje</span><span class="prevnext-title">${escapeHtml(item.prevProject.title)}</span></a>`;
    if (item.nextProject) html += `<a class="next" href="/projeler/${encodeURIComponent(item.nextProject.slug)}"><span class="prevnext-label">Sonraki Proje →</span><span class="prevnext-title">${escapeHtml(item.nextProject.title)}</span></a>`;
    el.innerHTML = html;
  }

  function updateHeadMeta(item) {
    document.title = `${item.title} — MİMARLAB`;
    const rawDesc = item.description || `${item.title}${item.location ? ' — ' + item.location : ''}. MİMARLAB'da proje detaylarını incele.`;
    const desc = rawDesc.length > 200 ? rawDesc.slice(0, 197) + '…' : rawDesc;
    const canonicalUrl = `https://mimarlab.com/projeler/${encodeURIComponent(item.slug)}`;
    const image = (item.images && item.images[0]) ? new URL(item.images[0], window.location.origin).href : 'https://mimarlab.com/logos/site/mimarlab-logo.png';
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

  // Delege edilmiş tıklama dinleyicisi: modal içindeki HERHANGİ bir /projeler/:slug bağlantısına
  // (İlgili Projeler, Diğer Projeler, önceki/sonraki) tıklanınca overlay kapanıp yeniden AÇILMAZ —
  // yalnızca içerik ve URL güncellenir (bkz. kullanıcı isteği).
  function wireInternalNav() {
    const panels = ModalShell.getPanels();
    if (!panels || panels.bodyEl.dataset.pmNavWired) return;
    panels.bodyEl.dataset.pmNavWired = '1';
    panels.bodyEl.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="/projeler/"]');
      if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const m = a.getAttribute('href').match(/^\/projeler\/([^/?#]+)/);
      if (!m) return;
      e.preventDefault();
      swap(decodeURIComponent(m[1]));
    });
  }

  async function fetchItem(slug) {
    const res = await fetch(`/api/project/${encodeURIComponent(slug)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.item || null;
  }

  async function renderItem(item, mySeq) {
    currentItem = item;
    updateHeadMeta(item);
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
    ['pm-rating-save-row', 'pm-actions', 'pm-architect-section', 'pm-office-section', 'pm-meta', 'pm-desc',
      'pm-comments-section', 'pm-same-designer-section', 'pm-related-section', 'pm-products-section',
      'pm-materials-section', 'pm-prevnext', 'pm-gallery-wrap'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  async function open(slug, { pushHistory = true, triggerEl = null } = {}) {
    currentSlug = slug;
    openedViaPush = pushHistory;
    pushCountSinceOpen = pushHistory ? 1 : 0;
    if (pushHistory) history.pushState({ mimarlabModal: 'project', slug, depth: 1 }, '', `/projeler/${encodeURIComponent(slug)}`);
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

  async function swap(slug) {
    if (!ModalShell.isOpen()) return open(slug, { pushHistory: true });
    currentSlug = slug;
    // pushCountSinceOpen'ı doğrudan artırmak yerine mevcut history.state.depth'ten türetilir — bkz.
    // gerçek bulgu: kullanıcı iki proje gezindikten SONRA tarayıcının geri tuşuyla bir öncekine
    // dönüp ORADAN X/Escape'e basarsa, salt artan bir sayaç (her swap()'ta ++) geri navigasyonu asla
    // görmediğinden yanlış (fazla) bir mesafeye göre history.go(-N) çağırıp asıl listenin
    // ÖTESİNE geçerdi. history.state her girdiyle birlikte taşındığından (pushState'in kendi
    // mekanizması) her zaman doğru "buradan modal-öncesi duruma kaç adım var" bilgisini verir.
    const currentDepth = (history.state && history.state.mimarlabModal === 'project') ? history.state.depth : pushCountSinceOpen;
    pushCountSinceOpen = currentDepth + 1;
    history.pushState({ mimarlabModal: 'project', slug, depth: pushCountSinceOpen }, '', `/projeler/${encodeURIComponent(slug)}`);
    const mySeq = ++requestSeq;
    const item = await fetchItem(slug);
    if (mySeq !== requestSeq || currentSlug !== slug) return;
    if (!item) { renderNotFound(); return; }
    await renderItem(item, mySeq);
  }

  // X/backdrop/Escape tetiklediğinde çağrılır (bkz. modal-shell.js#onRequestClose) — geçerli bir
  // aynı-sekme geçmiş girdisi varsa history.back() ile oraya (liste durumu korunarak) dönülür;
  // yoksa (doğrudan /projeler/:slug ile açılmış bir sekme) '/proje' listesine pushState edilir —
  // '/projeler' (slug'sız) hiçbir asset'e karşılık gelmediğinden 404 verirdi (bkz. plan düzeltmesi).
  function close() {
    currentSlug = null;
    currentItem = null;
    // openedViaPush yalnızca İLK open() gerçek bir tıklamadan geldiyse true (bkz. yukarıdaki alan
    // yorumu) — bu durumda pushCountSinceOpen (o zamandan beri yapılan TÜM swap()'lar dahil) kadar
    // tek seferde geri sarılır, böylece birden fazla proje gezildikten sonra bile X/Escape doğrudan
    // asıl listeye döner. Hydration ile açılmışsa (deep link/F5) listeye ait GÜVENLİ bir geçmiş
    // girdisi hiç yok — o durumda doğrudan /proje'ye pushState edilir.
    if (openedViaPush && pushCountSinceOpen > 0) history.go(-pushCountSinceOpen);
    else history.pushState({}, '', '/proje');
    ModalShell.close();
    pushCountSinceOpen = 0;
  }

  // proje.html'in popstate dinleyicisi /projeler/:slug yoluna geri/ileri gidildiğinde bunu çağırır
  // (bkz. proje.html). Burada TEKRAR pushState YAPILMAZ — URL zaten doğru.
  function handlePopState(slug) {
    // ensureTemplate() burada YOK — DOM'u ilk kez ModalShell.open() oluşturur (bkz. open()'daki AYNI
    // gerçek bulgu yorumu); modal zaten açıksa mountedOnce=true olduğundan zaten no-op olurdu.
    if (!slug) { if (ModalShell.isOpen()) { currentSlug = null; currentItem = null; ModalShell.close(); } return; }
    if (!ModalShell.isOpen()) { openedViaPush = false; open(slug, { pushHistory: false }); return; }
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
