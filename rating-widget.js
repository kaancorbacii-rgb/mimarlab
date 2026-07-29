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

// Verilen ortalamaya göre "en az N yıldız" filtre kovalarını döndürür (ör. 4.3 -> ['4+ Yıldız','3+ Yıldız','2+ Yıldız','1+ Yıldız']).
function ratingBuckets(average){
  if(!average) return [];
  const buckets = [];
  for(let n = Math.floor(average); n >= 1; n--) buckets.push(`${n}+ Yıldız`);
  return buckets;
}

async function mountRatingWidget(el){
  const targetType = el.dataset.type;
  const targetId = el.dataset.key;
  if(!targetType || !targetId) return;

  if(typeof savedWidgetReady !== 'undefined') await savedWidgetReady;

  let current = { average: 0, count: 0, mine: null };
  try{
    const res = await fetch(`/api/ratings?targetType=${encodeURIComponent(targetType)}&targetId=${encodeURIComponent(targetId)}`);
    if(res.ok) current = await res.json();
  }catch{}

  function paint(){
    const highlightUpTo = current.mine || 0;
    let starsHtml = '';
    for(let i = 1; i <= 5; i++){
      starsHtml += `<button type="button" class="rating-star-btn${i <= highlightUpTo ? ' filled' : ''}" data-value="${i}" aria-label="${i} yıldız">${starSvg(i <= highlightUpTo)}</button>`;
    }
    const summary = current.count
      ? `${current.average.toFixed(1)} · ${current.count} oy${current.mine ? ` · senin puanın: ${current.mine}` : ''}`
      : (currentUser ? 'Henüz puan yok · ilk puanı sen ver' : 'Henüz puan yok');
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
      if(res.ok) current = await res.json();
    } finally {
      paint();
    }
  }

  paint();
}

function mountAllRatingWidgets(){
  document.querySelectorAll('.rating-widget').forEach(el => mountRatingWidget(el));
}
