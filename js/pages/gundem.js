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
//   * TIKLAMA DAVRANIŞI (kullanıcı isteği, 2026-09-07): kartın kendisi ve başlık TIKLANABİLİR
//     DEĞİLDİR. Yalnızca GÖRSEL tıklanabilir ve tıklanınca mevcut ImageLightbox'ta büyür — yeni bir
//     lightbox yazılmadı. Kaynağa gitmek için meta satırındaki KAYNAK ADI bağlantısı kullanılır;
//     ayrı bir "Kaynağa git" satırı YOKTUR.
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

// detail=true → /gundem/:slug tek içerik görünümü: özet kırpılmaz (bkz. gundem.html#
// .gundem-card--detail), çünkü orada sayfanın KENDİSİ o içeriktir.
function cardHtml(item, index, { detail = false } = {}){
  // href yalnızca Kaydet/Paylaş kaydına gider — kart ARTIK tıklanabilir DEĞİL (kullanıcı isteği
  // 2026-09-07 madde 1: yalnızca görsel tıklanabilir, tıklayınca lightbox'ta büyür).
  const href = '/gundem/' + encodeURIComponent(item.slug);
  // Referans metadata dili: "12 May 2026 News" — tarih normal/gri, kategori KALIN ve koyu,
  // kaynak adı ardından ince bir orta nokta ile. Büyük harf/harf aralığı YOK.
  const metaHtml =
    `<span class="gundem-date">${escapeHtml(formatDate(item.date))}</span>` +
    (item.category ? `<span class="gundem-cat">${escapeHtml(categoryLabel(item.category))}</span>` : '') +
    (item.sourceName
      ? `<a class="gundem-src" href="${escapeAttr(item.sourceUrl)}" rel="nofollow noopener external" target="_blank">${escapeHtml(item.sourceName)}</a>`
      : '');
  const shareId = 'gundem-share-' + index;
  return `<article class="gundem-card${detail ? ' gundem-card--detail' : ''}" data-slug="${escapeAttr(item.slug)}">
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
      <span class="gundem-admin-slot" data-id="${escapeAttr(item.id || '')}"></span>
    </div>
    <div class="gundem-photo">
      <button class="gundem-photo-btn" type="button"
              data-lightbox="${escapeAttr(item.image)}"
              aria-label="${escapeAttr(item.title)} — görseli büyüt">
        <img src="${escapeAttr(item.image)}" alt="${escapeAttr(item.title)}" width="640" height="400"
             loading="${index < 2 ? 'eager' : 'lazy'}" decoding="async" referrerpolicy="no-referrer">
      </button>
    </div>
    <div class="gundem-body">
      <p class="gundem-meta">${metaHtml}</p>
      <h2 class="gundem-card-title">${escapeHtml(item.title)}</h2>
      <p class="gundem-summary">${escapeHtml(item.summary)}</p>
      <div class="gundem-foot">
        ${entitiesHtml(item.entities)}
      </div>
    </div>
  </article>`;
}

// GÖRSEL BÜYÜTME (kullanıcı isteği, 2026-09-07 madde 1) — mevcut js/components/image-lightbox.js
// yeniden kullanılır (window.ImageLightbox.open(url, alt)); yeni bir büyütme katmanı YAZILMADI.
// Delege dinleyici: kartlar sayfalama/filtreyle sürekli yeniden basıldığından her karta ayrı
// listener bağlamak (save-widget.js'te canlıda mükerrer istek üretmiş olan hata) tekrarlanmaz.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.gundem-photo-btn');
  if(!btn) return;
  const url = btn.dataset.lightbox;
  if(!url) return;
  e.preventDefault();
  const img = btn.querySelector('img');
  if(window.ImageLightbox && typeof window.ImageLightbox.open === 'function'){
    window.ImageLightbox.open(url, (img && img.alt) || '');
  }else{
    // Lightbox yüklenmediyse (defer sırası/ağ hatası) görsel yeni sekmede açılır — tıklama
    // sessizce hiçbir şey yapmasın istemiyoruz.
    window.open(url, '_blank', 'noopener');
  }
});

// ---------------------------------------------------------------------------------------------
// ADMİN KONTROLLERİ (kullanıcı isteği, 2026-09-07 madde 5) — YALNIZCA admin görür.
//
// GÜVENLİK NOTU: burada gizlenen şey yalnızca ARAYÜZDÜR. Asıl yetki kontrolü sunucudadır
// (/api/admin/* tamamı requireAdmin arkasında, bkz. src/routes/admin.js) — bu kod tarayıcıda
// değiştirilse bile admin olmayan biri hiçbir şey düzenleyemez.
let isAdminUser = null;
async function ensureAdminFlag(){
  if(isAdminUser !== null) return isAdminUser;
  try{
    // auth-nav.js aynı isteği zaten başlatmış olur — paylaşılan sonucu kullan, ikinci istek atma.
    const data = window.__authMeFetch
      ? await window.__authMeFetch
      : await fetch('/api/auth/me').then(r => r.ok ? r.json() : { user:null }).catch(() => ({ user:null }));
    isAdminUser = !!(data && data.user && data.user.role === 'admin');
  }catch{ isAdminUser = false; }
  return isAdminUser;
}

const ICON_EDIT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const ICON_ARCHIVE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>';
const ICON_DELETE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>';

async function applyAdminControls(){
  if(!(await ensureAdminFlag())) return;
  document.querySelectorAll('.gundem-admin-slot:not([data-wired])').forEach(slot => {
    if(!slot.dataset.id) return;
    slot.dataset.wired = '1';
    slot.innerHTML =
      `<button type="button" class="gundem-admin-btn" data-act="edit" title="Düzenle" aria-label="Düzenle">${ICON_EDIT}</button>` +
      `<button type="button" class="gundem-admin-btn" data-act="archive" title="Arşivle" aria-label="Arşivle">${ICON_ARCHIVE}</button>` +
      `<button type="button" class="gundem-admin-btn danger" data-act="delete" title="Sil" aria-label="Sil">${ICON_DELETE}</button>`;
  });
}

// Delege dinleyici — kartlar sürekli yeniden basıldığından her butona ayrı listener bağlanmaz.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.gundem-admin-btn');
  if(!btn) return;
  e.preventDefault();
  const slot = btn.closest('.gundem-admin-slot');
  const card = btn.closest('.gundem-card');
  const id = slot && slot.dataset.id;
  if(!id || !card) return;
  const act = btn.dataset.act;

  if(act === 'delete'){
    if(!confirm('Bu Gündem içeriği KALICI olarak silinsin mi?\n\nNot: silinen içerik bir sonraki taramada yeniden gelebilir. Geri gelmesini istemiyorsanız "Arşivle" kullanın.')) return;
    const res = await fetch('/api/admin/gundem/' + encodeURIComponent(id), { method:'DELETE' });
    if(res.ok) card.remove(); else alert('Silinemedi.');
    return;
  }
  if(act === 'archive'){
    if(!confirm('Bu içerik arşivlensin mi? Listeden kalkar ama kayıt durur (mükerrer kontrolü onu tanımaya devam eder).')) return;
    const res = await fetch('/api/admin/gundem/' + encodeURIComponent(id) + '/archive', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ archived:true }),
    });
    if(res.ok) card.remove(); else alert('Arşivlenemedi.');
    return;
  }
  if(act === 'edit') openAdminEditor(card, id);
});

// Satır içi düzenleyici — ayrı bir popup/sayfa yerine kartın kendi içinde açılır (düzenlenen şey
// gözle görünürken düzeltilir). Görsel adresi CSP'ye takılırsa sunucu açıkça uyarır (bkz.
// src/routes/gundemAdmin.js#updateGundemItem).
function openAdminEditor(card, id){
  if(card.querySelector('.gundem-editor')) return;
  const titleEl = card.querySelector('.gundem-card-title');
  const summaryEl = card.querySelector('.gundem-summary');
  const imgEl = card.querySelector('.gundem-photo img');
  const box = document.createElement('div');
  box.className = 'gundem-editor';
  box.innerHTML =
    `<label>Başlık<input type="text" data-f="title" value="${escapeAttr(titleEl ? titleEl.textContent.trim() : '')}"></label>` +
    `<label>Özet<textarea data-f="summary" rows="5">${escapeHtml(summaryEl ? summaryEl.textContent.trim() : '')}</textarea></label>` +
    `<label>Görsel adresi<input type="url" data-f="image_url" value="${escapeAttr(imgEl ? imgEl.src : '')}"></label>` +
    `<div class="gundem-editor-actions">` +
      `<button type="button" class="gundem-editor-save">Kaydet</button>` +
      `<button type="button" class="gundem-editor-cancel">Vazgeç</button>` +
      `<span class="gundem-editor-msg" role="status"></span>` +
    `</div>`;
  card.querySelector('.gundem-body').appendChild(box);

  box.querySelector('.gundem-editor-cancel').addEventListener('click', () => box.remove());
  box.querySelector('.gundem-editor-save').addEventListener('click', async () => {
    const msg = box.querySelector('.gundem-editor-msg');
    const payload = {};
    box.querySelectorAll('[data-f]').forEach(f => { payload[f.dataset.f] = f.value.trim(); });
    msg.textContent = 'Kaydediliyor…';
    try{
      const res = await fetch('/api/admin/gundem/' + encodeURIComponent(id), {
        method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if(!res.ok){ msg.textContent = data.error || 'Kaydedilemedi.'; return; }
      if(titleEl) titleEl.textContent = payload.title;
      if(summaryEl) summaryEl.textContent = payload.summary;
      if(imgEl && payload.image_url){
        imgEl.src = payload.image_url;
        const pb = card.querySelector('.gundem-photo-btn');
        if(pb) pb.dataset.lightbox = payload.image_url;
      }
      box.remove();
    }catch{ msg.textContent = 'Kaydedilemedi.'; }
  });
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
  // chip:false olan kategoriler çip üretmez (bkz. src/lib/gundemCategories.js). `categories`
  // dizisinin TAMAMI burada durmaya devam eder — kart etiketi çözümü (catLabel) ona bakar.
  const all = [{ key: null, label: 'Tümü' }].concat(categories.filter(c => c.chip !== false));
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
      applyAdminControls();
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
    }
    // Listeye dönüş yolu: breadcrumb'ın orta basamağı açılır ("Ana Sayfa › Gündem › <başlık>").
    // Başlık bloğundaki eski "← Gündem" bağlantısı, başlık satırı referans düzenine göre yeniden
    // kurulunca kaldırıldı — dönüş yolunun tek sahibi artık burasıdır.
    const crumbParent = document.getElementById('gundem-crumb-parent');
    const crumbSep = document.getElementById('gundem-crumb-parent-sep');
    if(crumbParent) crumbParent.hidden = false;
    if(crumbSep) crumbSep.hidden = false;
    if(crumbEl) crumbEl.textContent = item.title;
    listEl.innerHTML = cardHtml(item, 0, { detail: true });
    wireCardActions([item], 0);
    applyAdminControls();
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
