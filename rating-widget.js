// Paylaşılan yıldız puanlama widget'ı: kart üzerindeki salt-okunur rozetler (.rating-badge)
// ve detay sayfası / ürün kartındaki tıklanabilir puanlayıcılar (.rating-widget) için ortak kod.
// save-widget.js ile aynı desen: her sayfa <script src="rating-widget.js"> ile dahil eder.

const ratingBulkCache = {}; // targetType -> Map(targetId -> {average, count})

function starSvg(filled, size){
  const s = size || 14;
  return filled
    ? `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l3.09 6.26 6.91 1-5 4.87 1.18 6.87L12 17.98l-6.18 3.52L7 14.63l-5-4.87 6.91-1L12 2.5Z"/></svg>`
    : `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 2.5l3.09 6.26 6.91 1-5 4.87 1.18 6.87L12 17.98l-6.18 3.52L7 14.63l-5-4.87 6.91-1L12 2.5Z"/></svg>`;
}

function renderRatingBadge(average, count){
  const avg = average || 0;
  let stars = '';
  for(let i = 1; i <= 5; i++){
    stars += `<span class="rating-badge-star${i <= Math.round(avg) ? ' filled' : ''}">${starSvg(i <= Math.round(avg))}</span>`;
  }
  const label = count ? `${avg.toFixed(1)} (${count})` : 'Henüz puan yok';
  return `<span class="rating-badge">${stars}<span class="rating-badge-count">${label}</span></span>`;
}

async function loadBulkRatings(targetType){
  if(ratingBulkCache[targetType]) return ratingBulkCache[targetType];
  const map = new Map();
  try{
    const res = await fetch(`/api/ratings/bulk?targetType=${encodeURIComponent(targetType)}`);
    if(res.ok){
      const data = await res.json();
      (data.items || []).forEach(it => map.set(it.target_id, { average: it.average, count: it.count }));
    }
  }catch{}
  ratingBulkCache[targetType] = map;
  return map;
}

function ratingOf(map, key){
  return (map && map.get(key)) || { average: 0, count: 0 };
}

// GET /api/ratings/mine — giriş yapmış kullanıcının TÜM puanladığı hedefleri TEK istekte döner
// (bkz. src/routes/ratings.js#myRatings, hesabim.html'in "Beğendiklerim" kutusunda zaten kullanılan
// AYNI uç) — mountAllRatingWidgets() burada bunu "kendi puanım" (mine) verisini TOPLU çekmek için de
// kullanır (bkz. o fonksiyondaki gerçek bulgu/gerekçe). Sayfa ömrü boyunca bir kez çekilip önbelleğe
// alınır (loadBulkRatings İLE AYNI desen).
let myRatingsPromise = null;
async function loadMyRatings(){
  if(myRatingsPromise) return myRatingsPromise;
  myRatingsPromise = (async () => {
    const map = new Map();
    if(typeof savedWidgetReady !== 'undefined') await savedWidgetReady;
    if(typeof currentUser === 'undefined' || !currentUser) return map;
    try{
      const res = await fetch('/api/ratings/mine');
      if(res.ok){
        const data = await res.json();
        (data.items || []).forEach(it => map.set(it.type + ':' + it.key, it.stars));
      }
    }catch{}
    return map;
  })();
  return myRatingsPromise;
}

// Verilen ortalamaya göre "en az N yıldız" filtre kovalarını döndürür (ör. 4.3 -> ['4+ Yıldız','3+ Yıldız','2+ Yıldız','1+ Yıldız']).
function ratingBuckets(average){
  if(!average) return [];
  const buckets = [];
  for(let n = Math.floor(average); n >= 1; n--) buckets.push(`${n}+ Yıldız`);
  return buckets;
}

// prefetched: mountAllRatingWidgets() ÇOK sayıda widget'ı TEK bir toplu istekle boyarken (bkz. o
// fonksiyondaki gerçek bulgu/gerekçe) her widget için burada AYRICA bir /api/ratings isteği
// atılmasını önlemek üzere {average,count,mine} önceden hesaplanıp verilir — tek başına bir
// popup'ta (project-modal.js/product-modal.js#mountRatingWidget(el) — tek argüman) çağrıldığında bu
// parametre verilmez, davranış AYNEN öncekiyle birebir aynı kalır (kendi GET isteğini kendisi atar).
async function mountRatingWidget(el, prefetched){
  const targetType = el.dataset.type;
  const targetId = el.dataset.key;
  if(!targetType || !targetId) return;

  let current;
  if(prefetched){
    current = prefetched;
  } else {
    if(typeof savedWidgetReady !== 'undefined') await savedWidgetReady;
    current = { average: 0, count: 0, mine: null };
    try{
      const res = await fetch(`/api/ratings?targetType=${encodeURIComponent(targetType)}&targetId=${encodeURIComponent(targetId)}`);
      if(res.ok) current = await res.json();
    }catch{}
  }

  function paint(){
    const highlightUpTo = current.mine || 0;
    let starsHtml = '';
    for(let i = 1; i <= 5; i++){
      starsHtml += `<button type="button" class="rating-star-btn${i <= highlightUpTo ? ' filled' : ''}" data-value="${i}" aria-label="${i} yıldız">${starSvg(i <= highlightUpTo)}</button>`;
    }
    const summary = current.count
      ? `${current.average.toFixed(1)} (${current.count})`
      : 'Puanla';
    el.innerHTML = `<div class="rating-star-row">${starsHtml}</div><span class="rating-summary">${summary}</span>`;
    el.querySelectorAll('.rating-star-btn').forEach(btn=>{
      btn.addEventListener('click', ()=> submit(parseInt(btn.dataset.value)));
    });
  }

  async function submit(stars){
    if(!currentUser){ window.location.href = 'giris-yap.html'; return; }
    el.querySelectorAll('.rating-star-btn').forEach(b => b.disabled = true);
    try{
      const res = await fetch('/api/ratings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType, targetId, stars }),
      });
      if(res.ok){
        current = await res.json();
        // gerçek bulgu: mountAllRatingWidgets()'in TOPLU önbellekleri (ratingBulkCache/
        // myRatingsPromise) sayfa ömrü boyunca kalıcıdır — bir oy verildikten SONRA en-iyi-100.html
        // gibi sayfalar TÜM listeyi yeniden render edip widget'ları YENİDEN monte ettiğinde (bkz. o
        // sayfadaki 'ratingchange' dinleyicisi), önbellek temizlenmezse yeni monte edilen widget'lar
        // BAYAT sayılar gösterirdi (dıştaki ★ rozeti taze, widget'ın kendi "X.X (N)" metni eski) —
        // bu yüzden bir oy her değiştiğinde ilgili türün önbelleği hemen atılır, bir sonraki toplu
        // mount taze veriyi yeniden çeker.
        delete ratingBulkCache[targetType];
        myRatingsPromise = null;
        // en-iyi-100.html gibi sayfalar hızlı oydan hemen sonra kendi görünümlerini (sıra/oy
        // sayısı) yeniden çekmeden güncelleyebilsin diye (bkz. kullanıcı isteği: "hızlı oy hemen
        // yansımalı") — bubbling ile üst konteynerler tek bir delege dinleyiciyle yakalayabilir.
        el.dispatchEvent(new CustomEvent('ratingchange', { bubbles: true, detail: { targetType, targetId, average: current.average, count: current.count } }));
      }
    } finally {
      paint();
    }
  }

  paint();
}

// gerçek bulgu (canlıda doğrulandı, kullanıcı isteği: "kökten çöz"): en-iyi-100.html gibi TEK
// sayfada onlarca .rating-widget aynı anda monte edilince (bkz. o sayfadaki hızlı puanla listesi)
// her biri KENDİ /api/ratings isteğini AYRI ayrı atıyordu — ~100 eşzamanlı GET isteği Cloudflare'in
// rate limiting katmanını tetikleyip bazı isteklere 429 döndürdüğü gözlemlendi. Bu patlama sırasında
// bir proje popup'ı AÇILIRSA (bkz. project-modal.js#fetchItem, /api/project/:slug) o isteğin
// KENDİSİ de aynı patlamaya yakalanıp 429 alabiliyor — fetchItem yalnızca res.ok kontrolü yaptığından
// bunu "proje yok" sanıp popup'ı yanlışlıkla "Proje bulunamadı" gösteriyordu (canlıda tam olarak bu
// senaryo doğrulandı). Kökten çözüm: TÜM widget'lar (kaç tane olursa olsun) TÜR başına TEK bir toplu
// istekle (/api/ratings/bulk) + TEK bir /api/ratings/mine isteğiyle boyanır — hiçbir widget kendi
// başına ayrı bir ağ isteği ATMAZ, sayfa kaç widget monte ederse etsin toplam istek sayısı sabit
// kalır (tür sayısı + 1).
// ---------- Popup tabanlı "Puanla" düğmesi (bkz. kullanıcı isteği: proje popup'ındaki puanlama
// da en-iyi-100.html'deki gibi görünsün/davransın — tek yıldız ikonu + "Puanla" metni, tıklanınca
// 5 yıldızlı bir popup açılır, daha önce oy verilmişse yıldız turuncu). en-iyi-100.html'in KENDİ
// .rate-popup-* uygulaması (o sayfanın <script>'i içinde) BİLEREK dokunulmadan bırakıldı — bu,
// proje popup'ı gibi BAŞKA bağlamlarda da kullanılabilecek AYRI, genel bir sürüm; ikisi de aynı
// /api/ratings sözleşmesini paylaştığından çakışma olmaz (bkz. dosya başındaki targetType/targetId
// açıklaması). TEK popup örneği document.body'ye enjekte edilip tüm çağıranlar arasında paylaşılır.
const RATE_POPUP_PENDING_KEY = 'mimarlab-pending-rating';
let ratePopupApi = null;

function injectRatePopupStyle(){
  if(document.getElementById('rate-popup-shared-style')) return;
  const style = document.createElement('style');
  style.id = 'rate-popup-shared-style';
  style.textContent = `
    .rate-popup-overlay{display:none; position:fixed; inset:0; z-index:400; background:rgba(20,24,30,0.62); backdrop-filter:blur(2px); align-items:center; justify-content:center; padding:20px;}
    .rate-popup-overlay.open{display:flex;}
    .rate-popup{width:100%; max-width:320px; background:var(--paper-card); border-radius:16px; padding:28px 24px 24px; position:relative; text-align:center; box-shadow:0 24px 60px rgba(0,0,0,0.35);}
    .rate-popup-close{position:absolute; top:10px; right:10px; background:none; border:none; color:var(--ink-soft); padding:8px; cursor:pointer; display:flex; border-radius:50%;}
    .rate-popup-close:hover{color:var(--ink); background:var(--paper-alt);}
    .rate-popup-eyebrow{font-size:11px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:var(--accent);}
    .rate-popup-title{margin-top:4px; font-size:17px; font-weight:700; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
    .rate-popup-stars{display:flex; align-items:center; justify-content:center; gap:6px; margin:20px 0 22px;}
    .rate-popup-star{background:none; border:none; padding:2px; color:var(--line); cursor:pointer; display:flex; transition:transform .1s ease;}
    .rate-popup-star:hover{transform:scale(1.15);}
    .rate-popup-star svg{color:inherit; pointer-events:none;}
    .rate-popup-star.filled{color:var(--accent);}
    .rate-popup-submit{width:100%; height:44px; border-radius:100px; border:none; background:var(--ink); color:var(--paper-card); font-size:14px; font-weight:700; cursor:pointer; transition:opacity .15s ease;}
    .rate-popup-submit:disabled{opacity:0.4; cursor:not-allowed;}
    .rate-popup-submit:not(:disabled):hover{opacity:0.88;}
    .rate-popup-notice{margin-top:12px; font-size:12.5px; color:var(--bad, #C0392B); display:none;}
    .rate-popup-notice.show{display:block;}
    .rate-trigger-btn{display:inline-flex; align-items:center; gap:5px; cursor:pointer;}
    .rate-trigger-btn svg{flex-shrink:0;}
    .rate-trigger-icon-filled{color:var(--accent);}
  `;
  document.head.appendChild(style);
}

// Tek paylaşılan popup DOM'unu (ilk çağrıda) kurar ve açma/kapama/oy gönderme mantığını üstlenen
// bir API döner. targetType/targetId her open() çağrısında değişebildiğinden state kapanışta değil
// bu fonksiyonun yerel değişkenlerinde tutulur — birden fazla "Puanla" düğmesi AYNI popup'ı paylaşır.
function ensureRatePopup(){
  if(ratePopupApi) return ratePopupApi;
  injectRatePopupStyle();

  const overlay = document.createElement('div');
  overlay.className = 'rate-popup-overlay';
  overlay.innerHTML = `
    <div class="rate-popup" role="dialog" aria-modal="true" aria-labelledby="rw-rate-popup-title">
      <button type="button" class="rate-popup-close" aria-label="Kapat"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      <div class="rate-popup-eyebrow">Puanla</div>
      <div class="rate-popup-title" id="rw-rate-popup-title"></div>
      <div class="rate-popup-stars"></div>
      <button type="button" class="rate-popup-submit" disabled>Gönder</button>
      <div class="rate-popup-notice"></div>
    </div>`;
  document.body.appendChild(overlay);

  const starsBox = overlay.querySelector('.rate-popup-stars');
  const titleEl = overlay.querySelector('.rate-popup-title');
  const submitBtn = overlay.querySelector('.rate-popup-submit');
  const noticeEl = overlay.querySelector('.rate-popup-notice');

  let starsHtml = '';
  for(let i = 1; i <= 5; i++){
    starsHtml += `<button type="button" class="rate-popup-star" data-value="${i}" aria-label="${i} yıldız">${starSvg(true, 30)}</button>`;
  }
  starsBox.innerHTML = starsHtml;

  const state = { targetType: null, targetId: null, selected: 0, hover: 0, onRated: null };

  function paintStars(){
    const eff = state.hover || state.selected;
    starsBox.querySelectorAll('.rate-popup-star').forEach(btn=>{
      btn.classList.toggle('filled', parseInt(btn.dataset.value, 10) <= eff);
    });
  }
  starsBox.addEventListener('mouseover', (e)=>{
    const btn = e.target.closest('.rate-popup-star');
    if(!btn) return;
    state.hover = parseInt(btn.dataset.value, 10);
    paintStars();
  });
  starsBox.addEventListener('mouseleave', ()=>{ state.hover = 0; paintStars(); });
  starsBox.addEventListener('click', (e)=>{
    const btn = e.target.closest('.rate-popup-star');
    if(!btn) return;
    state.selected = parseInt(btn.dataset.value, 10);
    submitBtn.disabled = false;
    paintStars();
  });

  function close(){
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }
  overlay.querySelector('.rate-popup-close').addEventListener('click', close);
  overlay.addEventListener('click', (e)=>{ if(e.target === overlay) close(); });
  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape' && overlay.classList.contains('open')) close(); });

  // en-iyi-100.html'deki AYNI lazy-load deseni (bkz. o dosyadaki ensureAuthModal) —
  // js/components/lazy-modals.js'in kendi loadModule()'ü IIFE kapanışında dışa açık olmadığından
  // burada tekrarlanır.
  function ensureAuthModal(cb){
    if(window.AuthModal){ cb(window.AuthModal); return; }
    const s = document.createElement('script');
    s.src = 'js/components/auth-modal.js';
    s.onload = ()=> cb(window.AuthModal);
    // gerçek bulgu: onerror hiç ele alınmıyordu — ağ hatasında cb() hiç çağrılmadığından oturumsuz
    // gönder sonrası (401, bkz. yukarısı) puan sessionStorage'a kuyruklanıp popup kapanıyor ama giriş
    // popup'ı hiç açılmıyordu; kullanıcı neden hiçbir şey olmadığını anlamadan kalıyordu. Script
    // yüklenemezse en azından tam sayfa giriş sayfasına yönlendirilir, kuyruklanan puan
    // 'mimarlab:authchange' yerine giriş sonrası sayfa script'lerinin kendi akışıyla ele alınabilir.
    s.onerror = ()=> { window.location.href = 'giris-yap.html'; };
    document.head.appendChild(s);
  }

  function postRating(targetType, targetId, stars){
    return fetch('/api/ratings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetType, targetId, stars }),
    });
  }

  function afterRated(targetType, targetId){
    delete ratingBulkCache[targetType];
    myRatingsPromise = null;
  }

  submitBtn.addEventListener('click', async ()=>{
    if(!state.selected || !state.targetType || !state.targetId) return;
    const targetType = state.targetType, targetId = state.targetId, stars = state.selected, onRated = state.onRated;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Gönderiliyor…';
    let res;
    try{
      res = await postRating(targetType, targetId, stars);
    }catch(e){
      noticeEl.textContent = 'Sunucuya ulaşılamadı, lütfen tekrar dene.';
      noticeEl.classList.add('show');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Gönder';
      return;
    }
    if(res.status === 401){
      // en-iyi-100.html'deki AYNI davranış: oturum kapalıyken Gönder'e basılırsa puan kuyruğa
      // alınır ve giriş popup'ı açılır — giriş/üye ol tamamlandığında aşağıdaki
      // 'mimarlab:authchange' dinleyicisi otomatik gönderir.
      try{ sessionStorage.setItem(RATE_POPUP_PENDING_KEY, JSON.stringify({ targetType, targetId, stars })); }catch(e){}
      close();
      ensureAuthModal((Modal)=>{ if(Modal) Modal.open('login'); });
      return;
    }
    if(res.ok){
      try{ sessionStorage.removeItem(RATE_POPUP_PENDING_KEY); }catch(e){}
      close();
      afterRated(targetType, targetId);
      if(onRated) onRated();
    } else {
      noticeEl.textContent = 'Puan gönderilemedi, lütfen tekrar dene.';
      noticeEl.classList.add('show');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Gönder';
    }
  });

  function trySubmitPending(){
    let raw;
    try{ raw = sessionStorage.getItem(RATE_POPUP_PENDING_KEY); }catch(e){ raw = null; }
    if(!raw) return;
    let pending;
    try{ pending = JSON.parse(raw); }catch(e){ pending = null; }
    if(!pending || !pending.targetType || !pending.targetId || !pending.stars) return;
    try{ sessionStorage.removeItem(RATE_POPUP_PENDING_KEY); }catch(e){}
    postRating(pending.targetType, pending.targetId, pending.stars).then(res=>{
      if(res.ok){
        afterRated(pending.targetType, pending.targetId);
        document.dispatchEvent(new CustomEvent('mimarlab:ratingchange', { detail: pending }));
      }
    }).catch(()=>{});
  }
  window.addEventListener('mimarlab:authchange', trySubmitPending);
  if(typeof savedWidgetReady !== 'undefined'){
    savedWidgetReady.then(()=>{ if(typeof currentUser !== 'undefined' && currentUser) trySubmitPending(); });
  }

  ratePopupApi = {
    async open(targetType, targetId, label, onRated){
      state.targetType = targetType;
      state.targetId = targetId;
      state.selected = 0;
      state.hover = 0;
      state.onRated = onRated || null;
      titleEl.textContent = label || '';
      noticeEl.textContent = '';
      noticeEl.classList.remove('show');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Gönder';
      paintStars();
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
      // Daha önce puanladıysa popup açılışında kendi puanını görsün (en-iyi-100.html'deki AYNI
      // davranış) — sessiz geçer, oturum kapalıyken loadMyRatings() zaten boş Map döner.
      try{
        const mine = await loadMyRatings();
        if(state.targetType !== targetType || state.targetId !== targetId) return; // bayat sonucu atla
        const val = mine.get(targetType + ':' + targetId);
        if(val){ state.selected = val; submitBtn.disabled = false; paintStars(); }
      }catch(e){}
    },
  };
  return ratePopupApi;
}

// el: "Puanla" düğmesi olarak render edilecek eleman (bir <button>, ör. project-modal.js#pm-rating)
// — en-iyi-100.html'deki .top100-rate-btn ile AYNI görünüm (tek yıldız ikonu + "Puanla" metni, oy
// vermişse yıldız turuncu) ama HERHANGİ bir bağlamda kullanılabilecek genel bir sürüm (bkz.
// kullanıcı isteği: proje popup'ındaki puanlama düğmesi de böyle olsun). opts.avgEl verilirse
// (opsiyonel), oy sayısı>0 olduğunda "4.8 (312)" metni oraya yazılır — bu düğme her zaman sabit
// "Puanla" metni gösterdiğinden ortalama/oy sayısı ayrı bir elemanda gösterilir.
async function mountRateButton(el, opts){
  opts = opts || {};
  const targetType = opts.targetType || el.dataset.type;
  const targetId = opts.targetId || el.dataset.key;
  if(!targetType || !targetId) return;
  el.classList.add('rate-trigger-btn');
  if(typeof savedWidgetReady !== 'undefined') await savedWidgetReady;

  async function paint(){
    let current = { average: 0, count: 0 };
    try{
      const res = await fetch(`/api/ratings?targetType=${encodeURIComponent(targetType)}&targetId=${encodeURIComponent(targetId)}`);
      if(res.ok) current = await res.json();
    }catch{}
    const mine = await loadMyRatings();
    const rated = mine.get(targetType + ':' + targetId);
    el.innerHTML = `${starSvg(!!rated, 14)}<span>Puanla</span>`;
    if(rated) el.querySelector('svg').classList.add('rate-trigger-icon-filled');
    if(opts.avgEl){
      if(current.count){
        opts.avgEl.textContent = `${current.average.toFixed(1)} (${current.count})`;
        opts.avgEl.style.display = '';
      } else {
        opts.avgEl.textContent = '';
        opts.avgEl.style.display = 'none';
      }
    }
  }

  // el.onclick ATAMASI (addEventListener DEĞİL) — bu widget SPA modal bağlamında (project-modal.js)
  // her yeni proje açılışında AYNI DOM elemanı için farklı bir targetId ile yeniden monte edilir;
  // atama şekli önceki mount'un kapanışını (stale targetId) otomatik olarak değiştirir, wired-bayrağı/
  // listener temizliği gerekmez (bkz. rating-widget.js'in geri kalanındaki AYNI "wired" deseninin
  // BİLEREK burada kullanılmadığı not).
  el.onclick = ()=>{
    const popup = ensureRatePopup();
    popup.open(targetType, targetId, opts.label || '', paint);
  };
  // Aynı sebeple document seviyesindeki 'mimarlab:ratingchange' dinleyicisi de her mount'ta ESKİ
  // handler kaldırılıp YENİDEN eklenir (targetType/targetId kapanışı güncel kalsın diye) — bu olay
  // yalnızca YUKARIDAKİ pending-oy akışında (giriş sonrası otomatik gönderim) tetiklenir; popup
  // doğrudan açıkken zaten onRated callback'i (paint) kullanılır.
  if(el._rateChangeHandler) document.removeEventListener('mimarlab:ratingchange', el._rateChangeHandler);
  el._rateChangeHandler = (e)=>{
    if(e.detail && e.detail.targetType === targetType && e.detail.targetId === targetId) paint();
  };
  document.addEventListener('mimarlab:ratingchange', el._rateChangeHandler);

  await paint();
}

async function mountAllRatingWidgets(){
  const els = Array.from(document.querySelectorAll('.rating-widget'));
  if(!els.length) return;

  const types = [...new Set(els.map(el => el.dataset.type).filter(Boolean))];
  const [bulkEntries, mineMap] = await Promise.all([
    Promise.all(types.map(t => loadBulkRatings(t).then(m => [t, m]))),
    loadMyRatings(),
  ]);
  const bulkByType = new Map(bulkEntries);

  els.forEach(el => {
    const targetType = el.dataset.type, targetId = el.dataset.key;
    if(!targetType || !targetId) return;
    const rating = ratingOf(bulkByType.get(targetType), targetId);
    mountRatingWidget(el, { average: rating.average, count: rating.count, mine: mineMap.get(targetType + ':' + targetId) || null });
  });
}
