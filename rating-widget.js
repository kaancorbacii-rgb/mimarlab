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
