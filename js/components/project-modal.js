// ProjectModal — proje detay modalının orkestratörü. Route/history state machine'i, eager/deferred
// içerik sıralamasını ve alt bileşenlerin (ProjectGallery/ProjectMeta/ProjectActions/
// ProjectComments/ArchitectProjects/RelatedProjects) tek bir DOM iskeletine
// bağlanmasını yönetir. DOM çerçevesi (overlay/panel/focus-trap/scroll-lock) js/components/
// modal-shell.js'ten gelir — bu dosya yalnızca PROJEYE ÖZGÜ kısmı bilir.
const ProjectModal = (function () {
  const LEFT_TEMPLATE = `
    <h1 class="detail-title" id="pm-title"></h1>
    <div class="pm-loading-skeleton" id="pm-loading-left">
      <div class="skeleton-line" style="height:28px; width:72%; border-radius:8px; margin-bottom:14px;"></div>
      <div class="skeleton-line" style="height:13px; width:42%; border-radius:6px; margin-bottom:24px;"></div>
      <div class="skeleton-line" style="height:12px; width:94%; border-radius:6px; margin-bottom:8px;"></div>
      <div class="skeleton-line" style="height:12px; width:87%; border-radius:6px; margin-bottom:8px;"></div>
      <div class="skeleton-line" style="height:12px; width:58%; border-radius:6px;"></div>
    </div>
    <div class="pm-top-rank" id="pm-top-rank" style="display:none;"></div>
    <div class="detail-byline" id="pm-byline" style="display:none;">
      <span class="detail-byline-avatar" id="pm-byline-avatar"></span>
      <span id="pm-byline-text"></span>
    </div>
    <div class="detail-info">
      <div class="designer-section" id="pm-architect-section" style="display:none;">
        <div class="designer-label">${ProjectMeta.metaIconHtml('architect')}Mimar:</div>
        <div class="designer-chips" id="pm-architect-chips"></div>
      </div>
      <div class="designer-section" id="pm-office-section" style="display:none;">
        <div class="designer-label">${ProjectMeta.metaIconHtml('office')}Mimarlık Firması:</div>
        <div class="designer-chips" id="pm-office-chips"></div>
      </div>
      <div class="detail-meta" id="pm-meta"></div>
      <div class="detail-desc" id="pm-desc"></div>
    </div>
    <hr class="pm-info-divider" id="pm-info-divider">
    <details class="comments-section" id="pm-map-section" aria-live="polite" open>
      <summary class="comments-title">Harita<span class="feedback-card-plus" aria-hidden="true"></span></summary>
      <div class="pm-map-wrap" id="pm-map-wrap"></div>
    </details>
    <details class="comments-section" id="pm-comments-section" aria-live="polite">
      <summary class="comments-title">Yorumlar<span id="pm-comments-count" style="display:none;">0</span><span class="feedback-card-plus" aria-hidden="true"></span></summary>
      <div class="comment-form-wrap" id="pm-comment-form-wrap"></div>
      <div class="comments-list" id="pm-comments-list"></div>
    </details>
    <details class="pm-feedback-card" id="pm-feedback-card">
      <summary>Geri Bildirim<span class="feedback-card-plus" aria-hidden="true"></span></summary>
      <p>Hatalı ya da eksik bir bilgi görüyorsan bize bildir.</p>
      <div id="pm-feedback-body"></div>
    </details>`;

  const RIGHT_TEMPLATE = `
    <div class="skeleton-card pm-loading-skeleton" id="pm-loading-right" style="width:min(88%, 760px); aspect-ratio:2/1; border-radius:14px;"></div>
    <div class="gallery-wrap" id="pm-gallery-wrap">
      <div class="gallery-media">
        <div class="detail-gallery" id="pm-gallery"></div>
        <button class="gallery-nav gallery-prev" id="pm-gallery-prev" type="button" aria-label="Önceki görsel"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg></button>
        <button class="gallery-nav gallery-next" id="pm-gallery-next" type="button" aria-label="Sonraki görsel"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg></button>
      </div>
      <div class="gallery-counter" id="pm-gallery-counter"></div>
    </div>

    <!-- Kullanılan Ürünler, öneri şeritlerinin (Diğer Projeler/Benzer Projeler/Şehirdeki Diğer
         Projeler) ÜSTÜNDE (kullanıcı isteği, 2026-08-31) — projenin kendi gerçek künye bilgisi,
         algoritmik önerilerden önce gelir. "Kullanılan Malzemeler" AYRI bir bölüm olarak KALDIRILDI:
         malzemeler de bu ızgaraya karışır (bkz. js/components/project-products.js#mount, kullanıcı
         isteği: "Malzemeler diye bir kısım olmasın, malzemeler de ürünler kısmına dahil edilsin"). -->
    <div class="related-section" id="pm-products-section" aria-live="polite">
      <h2 class="related-title">Kullanılan Ürünler</h2>
      <div class="related-grid-scroll" id="pm-products-grid"></div>
    </div>

    <div class="related-section" id="pm-same-designer-section" aria-live="polite">
      <h2 class="related-title"><span id="pm-same-designer-title">Mimarın Diğer Projeleri</span><span id="pm-same-designer-count"></span></h2>
      <div class="related-grid-scroll" id="pm-same-designer-grid"></div>
    </div>

    <div class="related-section" id="pm-related-section" aria-live="polite">
      <h2 class="related-title">Benzer Projeler</h2>
      <div class="related-grid-scroll" id="pm-related-grid"></div>
    </div>

    <div class="related-section" id="pm-city-section" aria-live="polite">
      <h2 class="related-title">Şehirdeki Diğer Projeler</h2>
      <div class="related-grid-scroll" id="pm-city-grid"></div>
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
  // En İyi 100 rozeti (bkz. renderTopRankBadge, kullanıcı isteği: "puanları proje popuplarına da
  // ekle") — en-iyi-100.html'in kendi tıklama işleyicisi open()'a topRank'i doğrudan verir (o anda
  // ZATEN elindeki satır verisinden, ekstra istek gerekmez). BAŞKA bir sayfadan (ör. proje.html)
  // açılan popup'larda topRank verilmediğinden rozet hiç görünmüyordu — gerçek bulgu (kullanıcı
  // isteği: "her iki sayfadan da aynı proje popup'ı açınca tüm bilgilerin bire bir aynı olması
  // gerekiyor"). Kökten çözüm: topRank verilmediğinde fetchTop100Map() ile TEK seferlik (istemci
  // ömrü boyunca önbelleğe alınan) /api/public/top100 listesinden slug'a göre arama yapılır — proje
  // gerçekten Top100'deyse rozet HANGİ sayfadan açılırsa açılsın aynı şekilde dolar.
  let currentTopRank = null;
  let top100LookupMap = null;
  let top100LookupPromise = null;
  function fetchTop100Map() {
    if (top100LookupMap) return Promise.resolve(top100LookupMap);
    if (!top100LookupPromise) {
      top100LookupPromise = fetch('/api/public/top100')
        .then(res => res.ok ? res.json() : { items: [] })
        .then(data => {
          top100LookupMap = new Map();
          (data.items || []).forEach(it => { if (it.slug) top100LookupMap.set(it.slug, { rank: it.rank, avg: it.avg, count: it.count }); });
          return top100LookupMap;
        })
        .catch(() => { top100LookupMap = new Map(); return top100LookupMap; });
    }
    return top100LookupPromise;
  }
  let openedViaPush = false; // bu açılış gerçek bir tıklamadan mı geldi (history.back güvenli mi)
  let pushCountSinceOpen = 0; // open() + o zamandan beri yapılan swap() sayısı — kapatırken TÜMÜNÜ
  // tek seferde geri sarmak için (bkz. close(), history.go(-N)) — modal içinde birden fazla projeye
  // bakıldıktan sonra X/Escape'e basmak, yalnızca son swap'ı değil doğrudan asıl listeye dönmeli.
  let requestSeq = 0; // yarışan open()/swap() çağrılarından yalnızca sonuncusunun render etmesi için

  // bkz. js/components/modal-shell.js#claimContent — sahip DEĞİŞTİYSE (Hesabım/başka bir detay
  // modalından geçildiyse) panelleri boşaltıp isNewOwner:true döner, bu durumda mountedOnce true
  // olsa da şablon KOŞULSUZ yeniden kurulur (bkz. office-modal.js#ensureTemplate AYNI gerçek bulgu).
  function ensureTemplate() {
    const panels = ModalShell.claimContent('project');
    if (mountedOnce && !panels.isNewOwner) return;
    panels.leftPanelEl.innerHTML = LEFT_TEMPLATE;
    panels.rightPanelEl.innerHTML = RIGHT_TEMPLATE;
    ModalShell.wireGridScrollArrows(panels.rightPanelEl);
    mountedOnce = true;
    // GERÇEK BULGU: leftPanelEl.innerHTML üzerine yazmak #pm-map-wrap düğümünü DOM'dan tamamen
    // kopartır — o düğüme bağlı accordionMap varsa artık hiçbir yere render edemeyeceği (detached)
    // bir Leaflet nesnesine dönüşür; sıfırlanmazsa bir sonraki loadMapForCurrentItem() çağrısı
    // mapLoadedSlug ZATEN AYNI sanıp haritayı hiç yeniden kurmaz (bkz. o fonksiyondaki erken dönüş).
    if (accordionMap) { try { accordionMap.remove(); } catch { /* zaten kopmuş olabilir */ } accordionMap = null; }
    mapLoadedSlug = null;
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
    document.getElementById('pm-city-grid').innerHTML = skeletonCardsHtml(4);
    // ArchitectProjects/RelatedProjects/CityProjects artık PARALEL yüklenir (bkz. kullanıcı isteği: ana
    // renderı bloklamadan Promise.allSettled ile arka planda yükleme) — RelatedProjects/CityProjects
    // kendi /api/projects sorgularını ArchitectProjects'in (çok projeli mimarlarda yavaş olabilen,
    // sayfalanmış) fetch'i TAMAMEN bitmeden başlatır, yalnızca dışlama seti için architectSlugsPromise'i
    // bekler (bkz. js/components/project-related.js#mount dosya başı yorumu). CityProjects — MİMARLAB
    // AI Faz 2, Proje↔Şehir ilişkisi (bkz. o dosyadaki dosya başı yorum) — architectSlugsPromise'e EK
    // olarak artık RelatedProjects'in de kendi gösterdiği slug'ları bekler (kullanıcı isteği: "ilgili
    // projelerle proje çakışması hiçbir zaman olmasın" — gerçek bulgu: Ayasofya popup'ında Sokullu
    // Mehmed Paşa Camii hem İlgili Projeler'de hem Şehirdeki Diğer Projeler'de birden çıkıyordu),
    // böylece iki bölüm arasında ASLA çakışma olmaz.
    observeOnce(sameDesignerSection, () => {
      if (mySeq !== requestSeq) return;
      const architectSlugsPromise = ArchitectProjects.mount(item).then(r => (mySeq === requestSeq && r) ? r.slugs : new Set());
      const relatedSlugsPromise = RelatedProjects.mount(item, architectSlugsPromise).then(r => (mySeq === requestSeq && r) ? r.slugs : new Set());
      const cityExcludePromise = Promise.all([architectSlugsPromise, relatedSlugsPromise]).then(([a, r]) => new Set([...a, ...r]));
      const cityPromise = CityProjects.mount(item, cityExcludePromise);
      Promise.allSettled([architectSlugsPromise, relatedSlugsPromise, cityPromise]);
    }, 600);

    const productsSection = document.getElementById('pm-products-section');
    // İskelet kartlar da artık .related-card (bkz. project-products.js dosya başı yorumu — .catalog-*
    // sınıflarının hiçbir CSS karşılığı yoktu, iskeletler de stilsiz/dev görünüyordu).
    document.getElementById('pm-products-grid').innerHTML = skeletonCardsHtml(4);
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

  // gerçek bulgu (denetim raporu, 2026-08-16): js/components/architect-modal.js#pageTitle ile AYNI
  // sızıntı/gerekçe — src/lib/seo.js#pageTitle SSR <title>'ı kırpar ama modal açılışı client-side
  // document.title'ı uzun/kırpılmamış başlıkla eziyordu.
  const TITLE_SUFFIX = ' — MİMARLAB';
  const TITLE_MAX = 60;
  function pageTitle(name) {
    const maxNameLen = TITLE_MAX - TITLE_SUFFIX.length;
    return `${name && name.length > maxNameLen ? name.slice(0, maxNameLen - 1) + '…' : name}${TITLE_SUFFIX}`;
  }

  function updateHeadMeta(item) {
    document.title = pageTitle(item.title);
    ModalShell.setLabel(item.title);
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

  // gerçek bulgu (denetim, 2026-08-24): fetch() burada try/catch İÇİNDE DEĞİLDİ — çevrimdışı/DNS/
  // zaman aşımı gibi bir ağ hatasında fetch() reddi hiç yakalanmadan open()/swap()'ın Promise.all(...)
  // satırından yukarı fırlıyor, hem onlar hem de bunları ateşleyen click handler'lar (async, kimse
  // await/catch etmiyor) yakalayan olmadan bir unhandled rejection'a dönüşüyordu — renderNotFound()
  // ASLA çağrılmıyor, modal ModalShell.open()'ın açtığı iskelet (skeleton) durumunda SONSUZA KADAR
  // kalıyordu (X ile kapatılabilir ama başka hiçbir şey çalışmıyordu). 404/gizli kayıt yolu (res.ok
  // false) zaten null döndürüp renderNotFound()'ı doğru tetikliyordu — ağ hatasını da AYNI null yola
  // yönlendirmek, kod değişikliği gerektirmeden open()/swap()'ın var olan "öğe yok" davranışını devreye sokar.
  // ARTIK {status:'ok'|'missing'|'error', item?} döner — bkz. modal-shell.js#fetchEntity'deki kökten
  // bulgu (kullanıcı isteği, 2026-09-01 madde 4): her başarısızlığı null'a indirgemek, geçici bir
  // 429/5xx/ağ hatasında yayında olan bir projeyi "Proje bulunamadı" olarak gösteriyordu.
  function fetchItem(slug) {
    return ModalShell.fetchEntity(`/api/project/${encodeURIComponent(slug)}`);
  }

  // "X tarafından" satırı — yalnızca üye gönderisi kökenli projelerde dolu (bkz. src/routes/
  // project.js#fetchOwnerByline item.ownerName alanı), statik/admin kökenli projelerde gizli kalır.
  function renderByline(item) {
    const wrap = document.getElementById('pm-byline');
    if (!item.ownerName) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    const avatar = document.getElementById('pm-byline-avatar');
    avatar.style.background = officeColor(item.ownerName);
    // cdnImg (bkz. image-cdn.js, bu sayfada — proje.html — her zaman yüklü) — denetim bulgusu
    // (2026-08-14): bu küçük (~24-64px) avatar önceden yükleme çözünürlüğünde isteniyordu.
    avatar.innerHTML = escapeHtml(initials(item.ownerName)) + (item.ownerPhoto ? `<img src="${escapeAttr(cdnImg(item.ownerPhoto, 96))}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : '');
    const ownerNameHtml = `<strong>${escapeHtml(item.ownerName)}</strong>${badgeIconHtml(item.ownerBadge, 14)}`;
    document.getElementById('pm-byline-text').innerHTML = item.ownerArchitectSlug
      ? `<a href="/mimar/${encodeURIComponent(item.ownerArchitectSlug)}">${ownerNameHtml}</a> tarafından`
      : `${ownerNameHtml} tarafından`;
  }

  // renderNotFound() bu ID'leri gizler (bkz. aşağısı); ModalShell'in şablonu sayfa ömrü boyunca
  // TEK SEFER mount edip yeniden kullandığı için (bkz. ensureTemplate#mountedOnce), bir kez 404/ağ
  // hatası alınıp bu bölümler gizlendikten sonra bir sonraki BAŞARILI render bunları geri
  // AÇMAZSA aynı sekmede açılan sıradaki projeler kalıcı olarak yarı-boş görünürdü (gerçek bulgu —
  // bkz. kullanıcı isteği: "bazı sayfalar boş geliyor"). Bu yüzden her başarılı renderItem() en
  // başta hepsini görünür durumuna sıfırlar; ilgili alt render fonksiyonları (renderByline,
  // ProjectMeta.render, RelatedProjects.mount vb.) kendi koşuluna göre tekrar gizleyebilir.
  const HIDE_ON_NOT_FOUND_IDS = ['pm-byline', 'pm-architect-section', 'pm-office-section',
    'pm-meta', 'pm-desc', 'pm-map-section', 'pm-comments-section', 'pm-info-divider', 'pm-feedback-card', 'pm-same-designer-section',
    'pm-related-section', 'pm-city-section', 'pm-products-section', 'pm-prevnext', 'pm-gallery-wrap', 'pm-top-rank'];

  // ---------- Harita akordeonu — Leaflet + Esri World Imagery (uydu), anahtarsız/ücretsiz (bkz.
  // kullanıcı isteği: Google Maps iframe'i tamamen kaldır) — proje geneliyle AYNI yığın (bkz.
  // proje-ekle.html, js/pages/proje.js#loadLeaflet). Konum hiyerarşisi: projenin kayıtlı koordinatı
  // (lat,lng) varsa doğrudan o noktaya pin konur; yoksa il-ilce-data.js#parseLocationFull ile
  // çözümlenen il adı TR_PROVINCE_CENTER'daki merkez koordinatına düşer (Leaflet'in Google embed'in
  // aksine metin adresini kendiliğinden çözemediği için — bkz. aşağıdaki gerçek bulgu); o da yoksa
  // Türkiye geneli gösterilir.
  //
  // GERÇEK BULGU: eski keyless Google embed (`maps.google.com/maps?q=<metin>&output=embed`) adres
  // METNİNİ (ör. "Kadıköy, İstanbul, Türkiye") kendi tarafında geocode ediyordu — Leaflet salt bir
  // karo çizici, hiçbir geocoding yapmaz. Proje sayfası genelinde HER popup açılışında canlı bir
  // Nominatim isteği atmak (yüksek trafikli genel popup, proje-ekle.html'in düşük frekanslı form
  // kullanımından FARKLI) kullanım politikasını ihlal eder — bu yüzden il merkezleri için küçük,
  // statik bir koordinat tablosu (81 il) kullanılır, ekstra ağ isteği gerekmez.
  const TR_PROVINCE_CENTER = {
    "Adana":[37.0000,35.3213],"Adıyaman":[37.7648,38.2786],"Afyonkarahisar":[38.7507,30.5567],"Ağrı":[39.7191,43.0503],
    "Aksaray":[38.3687,34.0360],"Amasya":[40.6499,35.8353],"Ankara":[39.9334,32.8597],"Antalya":[36.8969,30.7133],
    "Ardahan":[41.1105,42.7022],"Artvin":[41.1828,41.8183],"Aydın":[37.8560,27.8416],"Balıkesir":[39.6484,27.8826],
    "Bartın":[41.6344,32.3375],"Batman":[37.8812,41.1351],"Bayburt":[40.2552,40.2249],"Bilecik":[40.1451,29.9792],
    "Bingöl":[38.8855,40.4966],"Bitlis":[38.4006,42.1095],"Bolu":[40.5760,31.5788],"Burdur":[37.7203,30.2908],
    "Bursa":[40.1826,29.0665],"Çanakkale":[40.1553,26.4142],"Çankırı":[40.6013,33.6134],"Çorum":[40.5506,34.9556],
    "Denizli":[37.7765,29.0864],"Diyarbakır":[37.9144,40.2306],"Düzce":[40.8438,31.1565],"Edirne":[41.6771,26.5557],
    "Elazığ":[38.6810,39.2264],"Erzincan":[39.7500,39.5000],"Erzurum":[39.9000,41.2700],"Eskişehir":[39.7767,30.5206],
    "Gaziantep":[37.0662,37.3833],"Giresun":[40.9128,38.3895],"Gümüşhane":[40.4386,39.5086],"Hakkari":[37.5744,43.7408],
    "Hatay":[36.2023,36.1600],"Iğdır":[39.9167,44.0333],"Isparta":[37.7648,30.5566],"İstanbul":[41.0082,28.9784],
    "İzmir":[38.4237,27.1428],"Kahramanmaraş":[37.5858,36.9371],"Karabük":[41.2061,32.6204],"Karaman":[37.1759,33.2287],
    "Kars":[40.6013,43.0975],"Kastamonu":[41.3887,33.7827],"Kayseri":[38.7312,35.4787],"Kırıkkale":[39.8468,33.5153],
    "Kırklareli":[41.7333,27.2167],"Kırşehir":[39.1425,34.1709],"Kilis":[36.7184,37.1212],"Kocaeli":[40.8533,29.8815],
    "Konya":[37.8746,32.4932],"Kütahya":[39.4242,29.9833],"Malatya":[38.3552,38.3095],"Manisa":[38.6191,27.4289],
    "Mardin":[37.3212,40.7245],"Mersin":[36.8121,34.6415],"Muğla":[37.2153,28.3636],"Muş":[38.9462,41.7539],
    "Nevşehir":[38.6939,34.6857],"Niğde":[37.9667,34.6833],"Ordu":[40.9862,37.8797],"Osmaniye":[37.0742,36.2478],
    "Rize":[41.0201,40.5234],"Sakarya":[40.6940,30.4358],"Samsun":[41.2867,36.3300],"Siirt":[37.9333,41.9500],
    "Sinop":[42.0231,35.1531],"Sivas":[39.7477,37.0179],"Şanlıurfa":[37.1591,38.7969],"Şırnak":[37.4187,42.4918],
    "Tekirdağ":[40.9833,27.5167],"Tokat":[40.3167,36.5500],"Trabzon":[41.0027,39.7168],"Tunceli":[39.1079,39.5401],
    "Uşak":[38.6823,29.4082],"Van":[38.4891,43.4089],"Yalova":[40.6500,29.2667],"Yozgat":[39.8181,34.8147],
    "Zonguldak":[41.4564,31.7987],
  };
  const ESRI_WORLD_IMAGERY_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  // Uydu görüntüsünün üstüne il/ilçe/yerleşim adlarını çizen hibrit etiket katmanı (bkz. kullanıcı
  // isteği: hibrit uydu haritası varsayılan) — proje-ekle.html/js/pages/proje.js İLE AYNI ikinci katman.
  const ESRI_LABELS_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

  function mapViewForItem(item) {
    if (item.lat != null && item.lng != null) return { center: [item.lat, item.lng], zoom: 15 };
    const loc = (typeof parseLocationFull === 'function') ? parseLocationFull(item.location || '') : { city: null, district: null };
    const provinceCenter = loc.city && TR_PROVINCE_CENTER[loc.city];
    if (provinceCenter) return { center: provinceCenter, zoom: loc.district ? 11 : 8 };
    return { center: [39.0, 35.0], zoom: 5 };
  }

  // unpkg CDN'den (proje-ekle.html/js/pages/proje.js İLE AYNI sürüm/kaynak) yalnızca akordeon İLK
  // kez açıldığında dinamik eklenir — bu bileşen index/proje/mimar/firma/urun gibi Leaflet YÜKLEMEYEN
  // birçok sayfadan açılabildiğinden, kendi kendine yeten bir yükleyicisi olması gerekir (proje.js'in
  // sayfa-özel loadLeaflet'ine bağımlı kalınamaz).
  let leafletPromise = null;
  function loadLeaflet() {
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise((resolve, reject) => {
      if (window.L) { resolve(window.L); return; }
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => resolve(window.L);
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return leafletPromise;
  }

  function buildLeafletMap(container, item) {
    const { center, zoom } = mapViewForItem(item);
    const map = L.map(container, { attributionControl: false }).setView(center, zoom);
    L.tileLayer(ESRI_WORLD_IMAGERY_URL, { attribution: 'Tiles &copy; Esri', maxZoom: 19 }).addTo(map);
    L.tileLayer(ESRI_LABELS_URL, { maxZoom: 19 }).addTo(map);
    const marker = L.marker(center).addTo(map);
    return { map, marker };
  }

  // Haritayı büyütülmüş bir popup'ta (bkz. kullanıcı isteği: "haritanın sağ üst tarafına büyütme
  // iconu... tıklayınca harita popup şeklinde büyüsün") gösterir — mevcut galeri lightbox'ı
  // (#pm-lightbox, bkz. yukarısı) İLE AYNI overlay/backdrop/close deseni, ama ayrı bir eleman
  // (#pm-map-lightbox): ikisi farklı state taşıdığından (görsel index/sayaç vs kendi Leaflet
  // örneği) paylaşılan galeri state'ine karışmaması için bilerek ayrıldı. ensureMapLightbox()'un
  // oluşturduğu overlay TÜM sayfa ömrü boyunca DOM'da kalır (bkz. o fonksiyondaki AYNI not) — bu
  // yüzden lightboxMap/lightboxMarker yalnızca İLK açılışta kurulur, sonraki her açılışta setView/
  // setLatLng ile güncellenir (map.remove()+yeniden L.map() çağırmaya gerek yok).
  let lightboxMap = null;
  let lightboxMarker = null;
  function openMapLightbox() {
    if (!currentItem) return;
    const item = currentItem;
    const overlay = ensureMapLightbox();
    const frame = overlay.querySelector('#pm-map-lightbox-frame');
    if (!frame) return;
    overlay.classList.add('open');
    loadLeaflet().then(() => {
      if (currentItem !== item) return; // bu arada başka bir proje açıldı, bu yanıt bayat
      const { center, zoom } = mapViewForItem(item);
      if (!lightboxMap) {
        const inner = document.createElement('div');
        inner.style.width = '100%';
        inner.style.height = '100%';
        frame.innerHTML = '';
        frame.appendChild(inner);
        const built = buildLeafletMap(inner, item);
        lightboxMap = built.map;
        lightboxMarker = built.marker;
      } else {
        lightboxMap.setView(center, zoom);
        lightboxMarker.setLatLng(center);
      }
      // bkz. loadMapForCurrentItem'daki AYNI gerçek bulgu — overlay display:none'dan flex'e
      // GEÇTİKTEN hemen sonra çağrılırsa Leaflet konteyner boyutunu hâlâ 0 görebilir, bu yüzden bir
      // sonraki task'a (setTimeout 0) ertelenir.
      setTimeout(() => lightboxMap && lightboxMap.invalidateSize(), 0);
    });
  }

  function closeMapLightbox() {
    const overlay = document.getElementById('pm-map-lightbox');
    if (overlay) overlay.classList.remove('open');
  }

  const MAP_EXPAND_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6"/></svg>';

  // Harita yalnızca kutucuk gerçekten AÇILDIĞINDA yüklenir (bkz. kullanıcı isteği: açılır-kapanır
  // akordeon) — Yorumlar/Geri Bildirim de aynı şekilde varsayılan kapalı, ama bunlar zaten hafif; bir
  // Leaflet haritasını her proje açılışında (kutunun kapalı kalacağı çoğu durumda) önceden kurmak
  // gereksiz ağ/CPU maliyeti olurdu. AYNI proje için akordeon kapat/aç: harita YENİDEN KURULMAZ
  // (mapLoadedSlug eşleşir), yalnızca invalidateSize() ile boyutu düzeltilir (bkz. kullanıcı isteği)
  // — <details> kapalıyken içeriği görünmez olduğundan Leaflet'in karo boyutu hesaplaması bayatlar,
  // tekrar açılınca gri/kırık karolar görünür; invalidateSize bunu GERÇEK boyuta göre yeniden çizer.
  let mapLoadedSlug = null;
  let accordionMap = null;
  function loadMapForCurrentItem() {
    const wrap = document.getElementById('pm-map-wrap');
    if (!wrap || !currentItem) return;
    if (mapLoadedSlug === currentItem.slug) {
      if (accordionMap) setTimeout(() => accordionMap.invalidateSize(), 0);
      return;
    }
    mapLoadedSlug = currentItem.slug;
    if (accordionMap) { try { accordionMap.remove(); } catch { /* zaten kopmuş olabilir */ } accordionMap = null; }
    wrap.innerHTML = `<button type="button" class="pm-map-expand-btn" aria-label="Haritayı büyüt">${MAP_EXPAND_ICON}</button><div class="pm-map-inner" id="pm-map-inner" style="width:100%; height:100%;"></div>`;
    // wrap.innerHTML her yeni projede/açılışta baştan yazıldığından (bkz. yukarısı) düğme de her
    // seferinde yeniden oluşuyor — dataset bayraklı tek seferlik bağlama deseni burada GEREKMEZ,
    // doğrudan bağlamak yeterli ve daha basit.
    const expandBtn = wrap.querySelector('.pm-map-expand-btn');
    if (expandBtn) expandBtn.addEventListener('click', openMapLightbox);
    const item = currentItem;
    loadLeaflet().then(() => {
      if (mapLoadedSlug !== item.slug) return; // bu arada başka bir proje açıldı, bu yanıt bayat
      const inner = document.getElementById('pm-map-inner');
      if (!inner) return;
      const built = buildLeafletMap(inner, item);
      accordionMap = built.map;
      setTimeout(() => accordionMap && accordionMap.invalidateSize(), 0);
    });
  }

  // dataset bayrağı (bkz. wireInternalNav#pmNavWired İLE AYNI desen) — ensureTemplate() sahip
  // değiştiğinde (bkz. o fonksiyondaki isNewOwner yorumu) şablonu koşulsuz yeniden kurduğundan, DOM
  // düğümü YENİLENDİĞİNDE dinleyici de yeniden bağlanmalı; modül seviyesinde bir bayrak (ör.
  // `let wired`) bu durumda ESKİ düğüme bağlı kalıp YENİ düğümü hiç dinlemezdi.
  function wireMapSection() {
    const section = document.getElementById('pm-map-section');
    if (!section || section.dataset.pmMapWired) return;
    section.dataset.pmMapWired = '1';
    section.addEventListener('toggle', () => { if (section.open) loadMapForCurrentItem(); });
  }

  // bkz. js/components/gallery.js#initDetailGallery — AYNI Escape/backdrop-click kapama deseni.
  // keydown capture'ı (üçüncü argüman `true`) ModalShell'in KENDİ Escape dinleyicisinden ÖNCE
  // çalışır (bkz. o dosyadaki AYNI gerekçe yorumu) — overlay açıkken Escape'in modalı da kapatıp
  // haritayı üstünde bırakmaması için e.stopPropagation() ile olay modala hiç ulaşmaz. Yalnızca BİR
  // kez bağlanır (dataset bayrağı) — galeri'nin aksine bu overlay item değiştiğinde yeniden
  // oluşturulmadığından tekrar bağlamaya gerek yok.
  // gerçek bulgu: overlay ÖNCEDEN LEFT_TEMPLATE'e (dolayısıyla .modal-shell-left'e) gömülüydü —
  // modal-shell.js#.modal-shell-panel'in kendi (açılış animasyonu için) SÜREKLİ uygulanan
  // transform:scale(...) kuralı, İÇİNDEKİ position:fixed elemanların containing block'unu (CSS
  // spec gereği) viewport yerine O panele çeviriyor; panelin üstündeki scrollable/overflow'lu
  // ata(lar) da bu artık-absolute-gibi-davranan overlay'i görünmez şekilde kırpıyordu (backdrop
  // hiç boyanmıyordu, computed style'lar doğru görünse bile). Kalıcı çözüm: overlay'i şablonun
  // İÇİNE koymak yerine document.body'nin DOĞRUDAN çocuğu olarak TEK SEFER oluşturup eklemek —
  // böylece gerçek position:fixed/viewport davranışına kavuşur, .modal-shell-overlay'in kendi
  // z-index'inden (150) yüksek 210 ile HER ZAMAN üstte kalır.
  function ensureMapLightbox() {
    let overlay = document.getElementById('pm-map-lightbox');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'pm-map-lightbox';
    overlay.id = 'pm-map-lightbox';
    overlay.innerHTML = `
      <button type="button" class="pm-map-lightbox-close" id="pm-map-lightbox-close" aria-label="Kapat"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      <div class="pm-map-lightbox-frame" id="pm-map-lightbox-frame"></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#pm-map-lightbox-close').addEventListener('click', closeMapLightbox);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeMapLightbox(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('open')) { e.stopPropagation(); closeMapLightbox(); }
    }, true);
    return overlay;
  }
  function wireMapLightbox() { ensureMapLightbox(); }

  // Modal, ProjectModal.close()'tan GEÇMEYEN bir yolla kapanırsa (OverlayManager — hamburger/arama/
  // avatar/Paylaş panellerinden biri açıldığında ModalShell.close() DOĞRUDAN çağrılır) büyütülmüş
  // harita ekranda asılı kalıyordu (yerel doğrulamada üretildi). bkz. modal-shell.js#close'taki
  // 'mimarlab-modal-closed' yorumu.
  document.addEventListener('mimarlab-modal-closed', closeMapLightbox);

  // Puan/oy sayısı artık AYRICA burada gösterilmiyor (bkz. kullanıcı isteği: "puanları proje
  // popuplarına entegre et") — src/routes/ratings.js#summarize artık 'project' hedefi için
  // top100_entries taban puanını gerçek oylarla harmanladığından, hemen altındaki #pm-rating
  // (rating-widget) ZATEN bu popup'ta AYNI (En İyi 100 listesindeki) ortalama/oy sayısını
  // gösteriyor — burada ikinci kez tekrarlamak, hızlı oy sonrası sadece BU rozetin bayat kalıp
  // widget'la çelişmesine yol açan eski gerçek bulguyu (200 oy sabit kalırken widget 201'e
  // atlaması) yeniden yaratırdı. Rozet artık yalnızca sıra numarasını taşıyor.
  function renderTopRankBadge() {
    const el = document.getElementById('pm-top-rank');
    if (!el) return;
    if (!currentTopRank) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = '';
    // kullanıcı isteği: rozete tıklayınca En İyi 100 sayfasına gitsin.
    el.innerHTML = `<a class="pm-top-rank-badge" href="/en-iyi-100">En İyi 100: #${currentTopRank.rank}</a>`;
  }

  // gerçek bulgu (kullanıcı isteği, 2026-08-24): open()/swap() ModalShell.open()+ensureTemplate()'ı
  // fetchItem() TAMAMLANMADAN ÖNCE senkron çalıştırıyordu — bu ikisi arasındaki (yavaş bağlantıda
  // gözle görülür) pencerede panel ya tamamen BOŞ bir iskelet (ilk açılış: boş h1, resimsiz galeri
  // üzerinde havada duran ok butonları, altı boş bölüm başlıkları) ya da ÖNCEKİ projenin bayat
  // içeriğini (swap/handlePopState: URL zaten yeni projeye geçmiş ama başlık/galeri/açıklama hâlâ
  // eskisi) gösteriyordu — kullanıcının "popup açılırken kısa süreliğine bozuk hali gözüküyor" dediği
  // tam olarak bu. renderLoading() renderNotFound() İLE AYNI HIDE_ON_NOT_FOUND_IDS setini gizleyip
  // (bayat/yarım içerik hiç görünmez) yerine LEFT/RIGHT_TEMPLATE'e gömülü skeleton-line/skeleton-card
  // yer tutucularını gösterir — fetch'in kendisi HİÇBİR şekilde geciktirilmez (senkron DOM mount'tan
  // hemen sonra çağrılır), yalnızca ARADAKİ görünüm artık "boş/bozuk" değil, kasıtlı bir yükleniyor
  // durumu olur.
  function renderLoading() {
    ModalShell.clearLoadError(); // bir önceki denemenin hata kutusu yeni yüklemede asılı kalmasın
    const headerActions = ModalShell.getHeaderActionsSlot();
    if (headerActions) headerActions.innerHTML = '';
    const adminActions = ModalShell.getAdminActionsSlot();
    if (adminActions) adminActions.innerHTML = '';
    // pm-title HIDE_ON_NOT_FOUND_IDS'te DEĞİL (renderNotFound() onu gizlemek yerine "Proje bulunamadı"
    // metniyle DOLDURUR) — burada da aynı şekilde ELLE boşaltılmazsa bir önceki projenin başlığı,
    // altındaki skeleton çubuğunun ÜSTÜNDE bayat metin olarak asılı kalırdı (gerçek bulgu, bu düzeltme
    // ilk halinde test edilirken yakalandı).
    const title = document.getElementById('pm-title');
    if (title) title.textContent = '';
    HIDE_ON_NOT_FOUND_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('pm-force-hidden');
    });
    const loadLeft = document.getElementById('pm-loading-left');
    const loadRight = document.getElementById('pm-loading-right');
    if (loadLeft) loadLeft.style.display = '';
    if (loadRight) loadRight.style.display = '';
  }

  function hideLoadingSkeleton() {
    const loadLeft = document.getElementById('pm-loading-left');
    const loadRight = document.getElementById('pm-loading-right');
    if (loadLeft) loadLeft.style.display = 'none';
    if (loadRight) loadRight.style.display = 'none';
  }

  async function renderItem(item, mySeq) {
    currentItem = item;
    hideLoadingSkeleton();
    HIDE_ON_NOT_FOUND_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('pm-force-hidden');
    });
    updateHeadMeta(item);
    renderTopRankBadge();
    renderByline(item);
    ProjectMeta.render(item);
    // "Mimarın/Firmanın Diğer Projeleri" başlığı duruma göre değişir (bkz. kullanıcı isteği): projede
    // bir mimarlık firması varsa (item.designerDetails'te type==='office' — ProjectMeta.render'ın
    // AYNI kaynağı, bkz. js/components/project-meta.js#renderDesigners) "Firmanın Diğer Projeleri",
    // yoksa "Mimarın Diğer Projeleri".
    const sameDesignerTitleEl = document.getElementById('pm-same-designer-title');
    if (sameDesignerTitleEl) {
      const hasOffice = (item.designerDetails || []).some(d => d.type === 'office');
      sameDesignerTitleEl.textContent = hasOffice ? 'Firmanın Diğer Projeleri' : 'Mimarın Diğer Projeleri';
    }
    ProjectGallery.render(item);
    ProjectActions.render(item);
    // Puanla — X/Kaydet/Paylaş'ın EN DIŞINDA (bkz. kullanıcı isteği: "Puanla'yı da üste al, X,
    // Kaydet, Paylaş'ın en dış tarafına, yan yana") — ProjectActions.render() headerActions'ı
    // Kaydet+Paylaş ile YENİDEN yazdığından (her renderItem'da, proje değişse bile), Puanla ARDINDAN
    // eklenmelidir ki DOM sırası (dolayısıyla görsel sıra) hep X→Kaydet→Paylaş→Puanla kalsın.
    if (typeof mountRateButton === 'function') {
      const headerActions = ModalShell.getHeaderActionsSlot();
      if (headerActions) {
        headerActions.insertAdjacentHTML('beforeend', `<button type="button" class="rating-widget" id="pm-rating" data-type="project" aria-label="Puanla"></button><span class="pm-rating-avg" id="pm-rating-avg" style="display:none;"></span>`);
      }
      const ratingEl = document.getElementById('pm-rating');
      ratingEl.dataset.key = item.slug;
      mountRateButton(ratingEl, {
        targetType: 'project', targetId: item.slug, label: item.title,
        avgEl: document.getElementById('pm-rating-avg'),
      });
    }
    renderPrevNext(item);
    armDeferredSections(item, mySeq);
    wireInternalNav();
    wireMapSection();
    wireMapLightbox();
    closeMapLightbox(); // önceki projenin büyütülmüş haritası açık kalmış olabilir (bkz. kullanıcı isteği)
    // Proje değiştiyse (open() ya da swap()) önceki projenin gömülü haritası bayat kalır — bir
    // sonraki açılışta (ya da kutucuk zaten açık durumda kaldıysa hemen şimdi) yeni projenin
    // konumuyla yeniden yüklensin diye önbellek anahtarı sıfırlanır.
    const mapWrap = document.getElementById('pm-map-wrap');
    if (mapWrap) mapWrap.innerHTML = '';
    mapLoadedSlug = null;
    const mapSection = document.getElementById('pm-map-section');
    if (mapSection && mapSection.open) loadMapForCurrentItem();
    ModalShell.scrollToTop();
  }

  // status: 'missing' (kayıt gerçekten yok — sunucu 404/410 dedi) | 'error' (geçici sorun).
  // İkinci durumda "bulunamadı" DEMEZ, tekrar denenebilir bir hata kutusu gösterir (bkz.
  // modal-shell.js#showLoadError ve fetchEntity'deki kökten bulgu).
  function renderNotFound(status) {
    hideLoadingSkeleton();
    ModalShell.clearLoadError();
    const titleEl = document.getElementById('pm-title');
    const headerActions = ModalShell.getHeaderActionsSlot();
    if (headerActions) headerActions.innerHTML = '';
    const adminActions = ModalShell.getAdminActionsSlot();
    if (adminActions) adminActions.innerHTML = '';
    HIDE_ON_NOT_FOUND_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('pm-force-hidden');
    });
    closeMapLightbox();
    if (status === 'error') {
      const slug = currentSlug;
      ModalShell.showLoadError(titleEl, 'Proje şu an yüklenemedi', () => { if (slug) open(slug, { pushHistory: false, basePath: currentBasePath }); });
      return;
    }
    titleEl.textContent = 'Proje bulunamadı';
  }

  async function open(slug, { pushHistory = true, triggerEl = null, basePath = '/proje/', topRank = null } = {}) {
    await ModalShell.waitForPendingNav();
    currentSlug = slug;
    currentBasePath = basePath;
    currentTopRank = topRank;
    openedViaPush = pushHistory;
    pushCountSinceOpen = pushHistory ? 1 : 0;
    if (pushHistory) history.pushState({ mimarlabModal: 'project', slug, depth: 1 }, '', `${currentBasePath}${encodeURIComponent(slug)}`);
    // ModalShell.open() ÖNCE çağrılır (overlay/panel DOM'unu ilk kez o oluşturur) — ensureTemplate()
    // panellere innerHTML basmaya çalıştığında panel elemanları henüz yoksa (bkz. gerçek bulgu) null
    // referans hatası verirdi.
    ModalShell.open({ triggerEl, onRequestClose: close });
    ensureTemplate();
    renderLoading();

    const mySeq = ++requestSeq;
    // gerçek bulgu (kullanıcı isteği: "popup'ın yavaş açılmasını önle"): top100 rozeti için
    // /api/public/top100'ün TAMAMI önceden burada fetchItem() İLE BİRLİKTE (Promise.all) beklenip
    // renderItem()'ı bloke ediyordu — rozet salt dekoratif küçük bir öğe olduğu halde, ana içerik
    // yalnızca İKİSİ de bitince göründüğünden top100 isteği yavaşsa/büyükse asıl proje verisi hazır
    // olsa bile ekranda tutuluyordu. Artık asıl render yalnızca fetchItem()'a bağlı; top100 araması
    // renderItem() SONRASINDA arka planda çalışır, sonucu geldiğinde rozeti ayrıca günceller.
    const result = await fetchItem(slug);
    if (mySeq !== requestSeq || currentSlug !== slug) return; // bu arada başka bir open/swap tetiklendi
    if (result.status !== 'ok') { renderNotFound(result.status); return; }
    const item = result.item;
    await renderItem(item, mySeq);
    if (!topRank) {
      fetchTop100Map().then(map => {
        if (mySeq === requestSeq && currentSlug === slug) { currentTopRank = map.get(slug) || null; renderTopRankBadge(); }
      });
    }
  }

  async function swap(slug, basePath) {
    if (!ModalShell.isOpen()) return open(slug, { pushHistory: true, basePath: basePath || '/proje/' });
    await ModalShell.waitForPendingNav();
    if (basePath) currentBasePath = basePath;
    currentSlug = slug;
    currentTopRank = null;
    // pushCountSinceOpen'ı doğrudan artırmak yerine mevcut history.state.depth'ten türetilir — bkz.
    // gerçek bulgu: kullanıcı iki proje gezindikten SONRA tarayıcının geri tuşuyla bir öncekine
    // dönüp ORADAN X/Escape'e basarsa, salt artan bir sayaç (her swap()'ta ++) geri navigasyonu asla
    // görmediğinden yanlış (fazla) bir mesafeye göre history.go(-N) çağırıp asıl listenin
    // ÖTESİNE geçerdi. history.state her girdiyle birlikte taşındığından (pushState'in kendi
    // mekanizması) her zaman doğru "buradan modal-öncesi duruma kaç adım var" bilgisini verir.
    const currentDepth = (history.state && history.state.mimarlabModal === 'project') ? history.state.depth : pushCountSinceOpen;
    pushCountSinceOpen = currentDepth + 1;
    history.pushState({ mimarlabModal: 'project', slug, depth: pushCountSinceOpen }, '', `${currentBasePath}${encodeURIComponent(slug)}`);
    // bkz. open()'daki AYNI gerçek bulgu yorumu — swap() URL/pushState'i HEMEN güncelliyordu ama
    // panel bir önceki projenin içeriğini fetchItem() bitene kadar göstermeye devam ediyordu (URL
    // yeni projeyi gösterirken başlık/galeri/açıklama hâlâ eskisi — kullanıcının fark ettiği "bozuk"
    // görünümün asıl kaynaklarından biri). renderLoading() bunu da aynı yükleniyor iskeletine çevirir.
    renderLoading();
    const mySeq = ++requestSeq;
    const result = await fetchItem(slug);
    if (mySeq !== requestSeq || currentSlug !== slug) return;
    if (result.status !== 'ok') { renderNotFound(result.status); return; }
    const item = result.item;
    await renderItem(item, mySeq);
    // gerçek bulgu (kullanıcı isteği: iki açılış yolunun bire bir aynı görünmesi): rozet ÖNCEDEN
    // koşulsuz null'a sabitleniyordu ("geçilen projede anlamsız" varsayımıyla) — oysa geçilen proje de
    // Top100'de olabilir, o zaman da rozetin görünmesi gerekir. open() İLE AYNI arama, AMA artık
    // renderItem()'ı bloke etmeden arka planda (bkz. open()'daki "yavaş açılmasını önle" yorumu).
    fetchTop100Map().then(map => {
      if (mySeq === requestSeq && currentSlug === slug) { currentTopRank = map.get(slug) || null; renderTopRankBadge(); }
    });
  }

  // X/backdrop/Escape tetiklediğinde çağrılır (bkz. modal-shell.js#onRequestClose) — geçerli bir
  // aynı-sekme geçmiş girdisi varsa history.back() ile oraya (liste durumu korunarak) dönülür;
  // yoksa (doğrudan /proje/:slug ile açılmış bir sekme) /proje listesine pushState edilir.
  function close() {
    const listPath = currentBasePath.replace(/\/$/, '') || '/proje';
    currentSlug = null;
    currentItem = null;
    closeMapLightbox(); // modal şablonu (bkz. ensureTemplate#mountedOnce) yeniden kullanıldığından 'open' sınıfı sıfırlanmazsa bir sonraki açılışta anlık görünürdü
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
    renderLoading(); // bkz. open()/swap()'taki AYNI gerçek bulgu — geri/ileri ile geçişte de eski proje içeriği bir an bayat kalmasın
    (async () => {
      const mySeq = ++requestSeq;
      const result = await fetchItem(slug);
      if (mySeq !== requestSeq || currentSlug !== slug) return;
      if (result.status !== 'ok') { renderNotFound(result.status); return; }
      const item = result.item;
      await renderItem(item, mySeq);
    })();
  }

  function isOpen() { return ModalShell.isOpen(); }
  function getCurrentSlug() { return currentSlug; }

  return { open, swap, close, handlePopState, isOpen, getCurrentSlug };
})();
