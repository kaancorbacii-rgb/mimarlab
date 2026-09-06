// /gundem — Gündem liste sayfası + /gundem/:slug tek içerik görünümü (kullanıcı isteği, 2026-09-06).
//
// SAYFA SÖZLEŞMESİ (bu depodaki liste sayfası deseni):
//   * Veri: GET /api/gundem (public, önbellekli — bkz. src/routes/gundem.js).
//   * Kaydet: MEVCUT save-widget.js — yeni bir save altyapısı YOK. Kartlar .card-save-btn üretir,
//     wireSaveButtons('gundem') onları /api/saved'a bağlar; giriş yapılmamışsa mevcut davranış
//     (/giris'e yönlendirme) aynen geçerlidir.
//   * Paylaş: MEVCUT ShareWidget (js/components/share-button.js) — Web Share API varsa o, yoksa
//     kopyala/WhatsApp/X/LinkedIn popover'ı. Paylaşılan URL her zaman KALICI item adresidir
//     (/gundem/:slug), sayfa hash'i değil (madde 16).
//   * Karta tıklama: /gundem/:slug (MİMARLAB içi kalıcı route) — kaynak makaleye gitmez. Kaynağa
//     gitmek için kartta AYRICA görünür bir "Kaynağa git →" bağlantısı vardır (madde 2).
//
// GLOBAL'LER: save-widget.js/share-button.js düz <script> (modül DEĞİL) olarak yüklenir ve global
// leksik kapsamı paylaşır. `ShareWidget` bir `const` olduğundan window ÜZERİNDE DEĞİLDİR (bu depoda
// canlıda bir sayfayı öldürmüş bilinen tuzak) — bu yüzden `window.ShareWidget` DEĞİL, `typeof
// ShareWidget !== 'undefined'` ile kontrol edilir. Aynı şey wireSaveButtons için de geçerli
// (o bir function declaration olduğundan window'da OLUR, ama tutarlılık için aynı kontrol kullanılır).

// src/routes/gundem.js#GUNDEM_PAGE_SIZE ve gundem.html <head>'indeki erken fetch URL'si ile
// BİREBİR aynı olmalı — üçü ayrışırsa prefetch boşa gider (bkz. scripts/preflight-check.sh).
const PAGE_SIZE = 12;

const listEl = document.getElementById('gundem-list');
const chipsEl = document.getElementById('gundem-chips');
const moreWrap = document.getElementById('gundem-more-wrap');
const moreBtn = document.getElementById('gundem-more');
const headEl = document.getElementById('gundem-head');
const crumbEl = document.getElementById('gundem-crumb');

// /gundem/:slug ise tek içerik görünümü. decodeURIComponent bilinçli: slug her zaman [a-z0-9-]
// (bkz. src/lib/slugify.js) ama URL'de yine de kodlanmış gelebilir.
const DETAIL_MATCH = /^\/gundem\/([^/?#]+)\/?$/.exec(location.pathname);
const detailSlug = DETAIL_MATCH ? decodeURIComponent(DETAIL_MATCH[1]) : null;

let activeCategory = null;
let page = 1;
let loading = false;
let categories = [];

function escapeHtml(s){ const d = document.createElement('div'); d.textContent = s === undefined || s === null ? '' : s; return d.innerHTML; }
function escapeAttr(s){ return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

function formatDate(ms){
  if(!ms) return '';
  try{ return new Date(ms).toLocaleDateString('tr-TR', { day:'numeric', month:'long', year:'numeric' }); }
  catch(e){ return ''; }
}

function categoryLabel(key){
  const found = categories.find(c => c.key === key);
  return found ? found.label : '';
}

// gundem.html <head>'indeki erken fetch'i devralır (proje/kişi/firma/marka sayfalarındaki AYNI
// listFetch deseni) — URL birebir eşleşmezse normal fetch'e düşer, ikinci bir istek DOĞMAZ.
function listFetch(url){
  const pending = window.__mlPrefetch && window.__mlPrefetch[url];
  if(pending){ delete window.__mlPrefetch[url]; return pending; }
  return fetch(url);
}

const ICON_SAVE = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z"/></svg>';

// Bilgi grafiği rozetleri — sunucu YALNIZCA gerçek bir MİMARLAB kaydına eşleşen adları döndürür
// (bkz. src/lib/gundemEntities.js), bu yüzden burada ek bir doğrulama gerekmez; boşsa hiç basılmaz.
const ENTITY_PATH = { office: '/firma/', architect: '/kisi/', project: '/proje/', product: '/urun/' };
function entitiesHtml(entities){
  if(!entities || !entities.length) return '';
  const badges = entities.map(e => {
    const base = ENTITY_PATH[e.type];
    if(!base) return '';
    // NOT: saf markaların kanonik adresi /marka/:slug'tır; /firma/:slug ile gelen istek sunucuda
    // 301 ile oraya yönlendirilir (bkz. src/index.js#serveDetailPage) — yani burada 'office' için
    // tek önek kullanmak güvenli, kırık bağlantı üretmez.
    return `<a class="gundem-entity" href="${escapeAttr(base + encodeURIComponent(e.key))}">${escapeHtml(e.name)}</a>`;
  }).join('');
  return badges ? `<span class="gundem-entities">${badges}</span>` : '';
}

function cardHtml(item, index){
  const href = '/gundem/' + encodeURIComponent(item.slug);
  const meta = [formatDate(item.date), categoryLabel(item.category), item.sourceName]
    .filter(Boolean);
  const metaHtml = meta.map((part, i) =>
    (i === 1 ? `<span class="gundem-cat">${escapeHtml(part)}</span>` : escapeHtml(part))
  ).join('<span class="sep">·</span>');
  const shareId = 'gundem-share-' + index;
  return `<article class="gundem-card" data-slug="${escapeAttr(item.slug)}">
    <div class="gundem-actions">
      <button class="card-save-btn" type="button"
        data-type="gundem"
        data-key="${escapeAttr(item.slug)}"
        data-title="${escapeAttr(item.title)}"
        data-meta="${escapeAttr(item.sourceName || '')}"
        data-image="${escapeAttr(item.image || '')}"
        data-href="${escapeAttr(href)}"
        aria-label="Kaydet">${ICON_SAVE}</button>
      <span class="gundem-share-slot" id="${shareId}-slot"></span>
    </div>
    <div class="gundem-photo">
      <a class="gundem-photo-link" href="${escapeAttr(href)}" tabindex="-1" aria-hidden="true">
        <img src="${escapeAttr(item.image)}" alt="" width="640" height="400"
             loading="${index < 2 ? 'eager' : 'lazy'}" decoding="async" referrerpolicy="no-referrer">
      </a>
    </div>
    <div class="gundem-body">
      <p class="gundem-meta">${metaHtml}</p>
      <h2 class="gundem-card-title"><a href="${escapeAttr(href)}">${escapeHtml(item.title)}</a></h2>
      <p class="gundem-summary">${escapeHtml(item.summary)}</p>
      <div class="gundem-foot">
        <a class="gundem-source-link" href="${escapeAttr(item.sourceUrl)}"
           rel="nofollow noopener external" target="_blank">Kaynağa git →</a>
        ${entitiesHtml(item.entities)}
      </div>
    </div>
  </article>`;
}

function skeletonHtml(count){
  return Array.from({ length: count }, () => `<div class="gundem-skeleton">
    <div></div>
    <div><div class="sk-line t"></div><div class="sk-line s"></div><div class="sk-line s2"></div><div class="sk-line s3"></div></div>
  </div>`).join('');
}

// Kartlar render edildikten SONRA çalışır: Kaydet butonlarını mevcut widget'a bağlar, Paylaş
// slotlarını ShareWidget ile doldurur. İkisi de yüklenmemişse (defer sırası/ağ hatası) sessizce
// atlanır — sayfanın geri kalanı çalışmaya devam eder.
function wireCardActions(items, offset){
  if(typeof wireSaveButtons === 'function') wireSaveButtons('gundem');
  if(typeof ShareWidget === 'undefined') return;
  items.forEach((item, i) => {
    const id = 'gundem-share-' + (offset + i);
    const slot = document.getElementById(id + '-slot');
    if(!slot) return;
    slot.outerHTML = ShareWidget.html(id);
    // getData tıklama ANINDA okunur (bkz. share-button.js#wire sözleşmesi). type/key
    // "Paylaştıklarım" kaydına gider (bkz. src/routes/shares.js#SHARE_ITEM_TYPES'a eklenen 'gundem').
    ShareWidget.wire(id, () => ({
      title: item.title,
      url: 'https://mimarlab.com/gundem/' + encodeURIComponent(item.slug),
      type: 'gundem',
      key: item.slug,
      meta: item.sourceName || '',
      image: item.image || '',
      href: '/gundem/' + encodeURIComponent(item.slug),
    }));
  });
}

function renderChips(){
  if(!chipsEl || !categories.length || chipsEl.dataset.rendered) return;
  chipsEl.dataset.rendered = '1';
  const all = [{ key: null, label: 'Tümü' }].concat(categories);
  chipsEl.innerHTML = all.map(c =>
    `<button type="button" class="gundem-chip" data-cat="${escapeAttr(c.key || '')}" aria-pressed="${c.key === activeCategory}">${escapeHtml(c.label)}</button>`
  ).join('');
  chipsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.gundem-chip');
    if(!btn) return;
    const next = btn.dataset.cat || null;
    if(next === activeCategory) return;
    activeCategory = next;
    chipsEl.querySelectorAll('.gundem-chip').forEach(b => {
      b.setAttribute('aria-pressed', String((b.dataset.cat || null) === activeCategory));
    });
    // Filtre URL'ye yazılır (paylaşılabilir/geri tuşuyla dönülebilir) ama sayfa YENİLENMEZ.
    const url = activeCategory ? `/gundem?kategori=${encodeURIComponent(activeCategory)}` : '/gundem';
    history.replaceState(null, '', url);
    page = 1;
    listEl.innerHTML = skeletonHtml(3);
    load({ reset: true });
  });
}

function apiUrl(){
  const params = new URLSearchParams();
  if(activeCategory) params.set('category', activeCategory);
  params.set('page', String(page));
  params.set('limit', String(PAGE_SIZE));
  return '/api/gundem?' + params.toString();
}

let renderedCount = 0;

async function load({ reset } = {}){
  if(loading) return;
  loading = true;
  if(moreBtn) moreBtn.disabled = true;
  try{
    const res = await listFetch(apiUrl());
    if(!res.ok) throw new Error('http_' + res.status);
    const data = await res.json();
    categories = data.categories || categories;
    renderChips();

    const items = data.items || [];
    if(reset){ listEl.innerHTML = ''; renderedCount = 0; }
    if(!items.length && renderedCount === 0){
      listEl.innerHTML = `<div class="gundem-status">${activeCategory ? 'Bu kategoride henüz içerik yok.' : 'Gündem içerikleri hazırlanıyor. Kısa süre içinde burada olacak.'}</div>`;
    }else{
      const offset = renderedCount;
      listEl.insertAdjacentHTML('beforeend', items.map((it, i) => cardHtml(it, offset + i)).join(''));
      renderedCount += items.length;
      wireCardActions(items, offset);
    }
    if(moreWrap) moreWrap.hidden = !data.hasMore;
    document.body.classList.add('gundem-ready');
  }catch(err){
    if(renderedCount === 0){
      listEl.innerHTML = '<div class="gundem-status">Gündem şu an yüklenemedi. Lütfen birazdan tekrar dene.</div>';
    }
    // Hata durumunda SSR gövdesi GİZLENMEZ (gundem-ready eklenmez) — JS başarısız olsa bile
    // ziyaretçi sunucudan gelen gerçek içeriği görmeye devam eder.
  }finally{
    loading = false;
    if(moreBtn) moreBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------------------------
// /gundem/:slug — tek içerik görünümü
// ---------------------------------------------------------------------------------------------
async function loadDetail(slug){
  try{
    const res = await fetch('/api/gundem/' + encodeURIComponent(slug));
    const data = await res.json().catch(() => ({}));
    const item = data && data.item;
    if(!item){
      // "Bulunamadı" ile "yüklenemedi" ayrımı (bu depoda bilinen bir kök neden) — 404/410 gerçekten
      // yok demektir, diğer her durum geçici bir hatadır ve SSR gövdesi ekranda BIRAKILIR.
      if(res.status === 404 || res.status === 410){
        listEl.innerHTML = '<div class="gundem-status">Bu Gündem içeriği bulunamadı. <a href="/gundem" style="color:var(--walnut);font-weight:600">Tüm Gündem →</a></div>';
        document.body.classList.add('gundem-ready');
      }
      return;
    }
    categories = data.categories || categories;
    if(headEl){
      const h1 = document.getElementById('entity-h1');
      if(h1) h1.textContent = item.title;
      const lead = headEl.querySelector('.gundem-lead');
      if(lead) lead.remove();
      const eyebrow = headEl.querySelector('.gundem-eyebrow');
      if(eyebrow) eyebrow.innerHTML = '<a href="/gundem">← Gündem</a>';
    }
    if(crumbEl) crumbEl.textContent = item.title;
    listEl.innerHTML = cardHtml(item, 0);
    wireCardActions([item], 0);
    document.body.classList.add('gundem-ready');
  }catch(err){
    /* SSR gövdesi ekranda kalır — bkz. yukarıdaki gerekçe. */
  }
}

// ---------------------------------------------------------------------------------------------
// Başlangıç
// ---------------------------------------------------------------------------------------------
if(detailSlug){
  loadDetail(detailSlug);
}else{
  const initialCat = new URLSearchParams(location.search).get('kategori');
  if(initialCat) activeCategory = initialCat;
  if(moreBtn){
    moreBtn.addEventListener('click', () => { page += 1; load(); });
  }
  load({ reset: true });
}
