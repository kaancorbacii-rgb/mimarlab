// proje.html'in sayfa-özel mantığı — önceden proje.html içinde ~29KB'lık inline <script> bloğuydu,
// harici dosyaya çıkarıldı ki tarayıcı bunu HTML'den bağımsız cache'leyebilsin (gerçek bulgu:
// denetim raporu — dosyanın %33'ü tek bir inline blok). <script defer> ile yüklenir; bu dosyanın
// TÜM üst-seviye kodu (aşağıdaki iki DOMContentLoaded listener'ı ve olay dinleyici kayıtları hariç
// hiçbir şey component script'lerini/ProjectModal gibi diğer defer'lı globalleri hemen çağırmaz)
// zaten inline'ken de bu sırayla çalışacak şekilde tasarlanmıştı (bkz. aşağıdaki "İlk otomatik
// render()" ve "Doğrudan /proje/:slug" yorumları — ikisi de geçmişte tam bu race condition'dan
// ("X is not defined") ötürü bilerek DOMContentLoaded'a bağlanmıştı) — defer'a taşınması yürütme
// sırasını DEĞİŞTİRMEZ, yalnızca dosyanın kendisini paylaşılabilir/cache'lenebilir hale getirir.
//
// Faz 3 sonrası: proje.html artık projeler-data.js'in tüm veri setini indirmiyor — sayfalama,
// filtreleme ve sıralama backend'de (/api/projects, /api/projects/filters) canonical D1 tablosu
// üzerinden yapılıyor (bkz. src/routes/project.js#handleProjectListRoute). Bu sayfa yalnızca
// il-ilce-data.js'i (parseLocation için, küçük statik referans tablosu) yükler.
const PAGE_SIZE = 24;
let currentPage = 1;

// kullanıcı isteği ("popup kapatınca bazen bilgiler ekranda kalıyor") — bkz. modal-shell.js#
// resetSsrEntity yorumu: bu sayfanın statik/jenerik <title>/#entity-h1/meta değerleri, /proje/:slug
// ile doğrudan açılışta sunucunun HTML'e gömdüğü GERÇEK proje içeriğinin üzerine ProjectModal
// kapanınca geri yazılabilsin diye burada bir kez kaydedilir.
ModalShell.setSsrDefaults({
  title: 'Projeler — MİMARLAB',
  h1: 'Projeler',
  description: "Türkiye'den öne çıkan mimarlık, iç mimarlık ve peyzaj mimarlığı projeleri.",
  canonicalUrl: 'https://mimarlab.com/proje',
  ogType: 'website',
  image: 'https://mimarlab.com/logos/site/mimarlab-og-image.png',
});

// il-ilce-data.js#parseLocationFull artık 81 ilin tamamında ilçe -> il çözümlemesi yapıyor
// (eskiden yalnızca İstanbul ilçeleri tanınırdı) — bu dosyadaki tüm çağrılar (filtre, künye linki
// çözümü) parseLocation adıyla değişmeden çalışsın diye burada aynı isimle yeniden dışa verilir.
const parseLocation = parseLocationFull;

// Sunucudaki src/routes/project.js#buildFilterGroups ile AYNI grup listesi — burada yalnızca
// sidebar'ın nasıl çizileceğini (etiket/iç içelik) bilmesi için metadata tutulur, gerçek
// seçenek/sayaç hesabı artık /api/projects/filters'tan gelir.
const FILTER_GROUPS = [
  { key: 'discipline', label: 'Tür' },
  { key: 'category', label: 'Tip' },
  { key: 'type', label: 'Grup' },
  { key: 'location', label: 'Yer' },
  { key: 'district', label: 'İlçe', nested: true, parentKey: 'location', parentValue: 'İstanbul' },
  { key: 'dateBucket', label: 'Yıl' },
  { key: 'designer', label: 'Mimar' },
  { key: 'designerOffice', label: 'Firma' },
  { key: 'award', label: 'Ödül' },
];

const activeFilters = {};
FILTER_GROUPS.forEach(g => activeFilters[g.key] = new Set());
let localSearchQuery = '';

// proje-detay.html künyesindeki Tür/Tip/Yer/Yıl değerleri buraya bu filtreyi önceden uygulanmış
// şekilde bağlanır (bkz. o dosyadaki filterLinkHtml) — ve artık ?page=N ile doğrudan girilen bir
// link de o sayfa numarasıyla açılır (bkz. kullanıcı isteği). "location" parametresi künyedeki ham
// `location` alanı (ör. "Üsküdar") olarak gelir; hangi filtre grubuna (şehir mi, ilçe mi) karşılık
// geldiği burada parseLocation() ile aynı mantıkla çözülür. Aynı grup için birden fazla değer
// (?category=Konut&category=Ticari) desteklenir (getAll) — URL artık geri/ileri ve paylaşılan
// linkler için TEK doğruluk kaynağı olduğundan (bkz. syncBrowserUrl), yalnızca ilk değeri almak
// (eski .get() kullanımı) çoklu seçimi sessizce kaybederdi.
function applyInitialFiltersFromQuery(){
  const params = new URLSearchParams(window.location.search);
  FILTER_GROUPS.forEach(g => {
    if(g.nested || g.key === 'location') return;
    params.getAll(g.key).forEach(v => activeFilters[g.key].add(v));
  });
  const locParam = params.get('location');
  if(locParam){
    const parsed = parseLocation(locParam);
    if(parsed.city) activeFilters.location.add(parsed.city);
    if(parsed.district) activeFilters.district.add(parsed.district);
  }
  const searchParam = params.get('search');
  localSearchQuery = searchParam || '';
  document.getElementById('g-sort').value = params.get('sort') || '';
  const pageParam = parseInt(params.get('page'), 10);
  currentPage = (pageParam > 1) ? pageParam : 1;
}

function trLower(s){
  return s.replace(/İ/g,'i').replace(/I/g,'ı').replace(/Ş/g,'ş').replace(/Ğ/g,'ğ').replace(/Ü/g,'ü').replace(/Ö/g,'ö').replace(/Ç/g,'ç').toLowerCase();
}

// Aktif filtreler/arama/sıralama/sayfa numarasından ?query string üretir — hem tarayıcı URL'ini
// senkronlamak hem de /api/projects ve /api/projects/filters isteklerinin gövdesini kurmak için
// TEK noktadan kullanılır.
function currentQueryParams(){
  const params = new URLSearchParams();
  params.set('buildStatus', 'built');
  FILTER_GROUPS.forEach(g => { activeFilters[g.key].forEach(v => params.append(g.key, v)); });
  if(localSearchQuery.trim()) params.set('search', localSearchQuery.trim());
  const sort = document.getElementById('g-sort').value;
  if(sort) params.set('sort', sort);
  return params;
}

// push=true: gerçek bir geçmiş girdisi (sayfa/filtre/sıralama değişimi — geri tuşu bir önceki
// duruma döner, link paylaşılabilir, bkz. kullanıcı isteği). push=false: replaceState (serbest
// metin arama kutusunda her debounce tetiklemesinde YENİ bir geçmiş girdisi açmamak için — aksi
// halde "istanbul" yazarken 8 harf 8 ayrı geri tuşu adımına dönüşürdü).
function syncBrowserUrl(push){
  const params = currentQueryParams();
  if(currentPage > 1) params.set('page', String(currentPage));
  const qs = params.toString();
  const newUrl = location.pathname + (qs ? '?' + qs : '');
  if(newUrl === location.pathname + location.search) return;
  if(push) history.pushState({}, '', newUrl);
  else history.replaceState({}, '', newUrl);
}

function optRow(g, opt, count, nested){
  return `
        <label class="filter-opt${nested ? ' filter-opt-nested' : ''}">
          <input type="checkbox" data-key="${g.key}" value="${escapeAttr(opt)}" ${activeFilters[g.key].has(opt)?'checked':''}>
          <span>${escapeHtml(opt)}</span>
          <span class="filter-opt-count">(${count})</span>
        </label>`;
}

// Sidebar artık kendi kendine (client-side computeOptions ile) hesap yapmıyor — /api/projects/filters
// (bkz. src/routes/project.js#handleProjectFiltersRoute) TEK doğruluk kaynağı: hem hangi seçeneklerin
// var olduğunu hem de faceted (diğer aktif filtrelerle bağımlı) sayaçları döner.
async function buildSidebar(){
  const sidebar = document.getElementById('sidebar');
  let filtersData = {};
  try{
    const res = await fetch(`/api/projects/filters?${currentQueryParams().toString()}`);
    if(res.ok){ const data = await res.json(); filtersData = data.filters || {}; }
  }catch(err){ console.error('Filtre seçenekleri alınamadı:', err); }

  let html = `<div class="sidebar-head"><span class="sidebar-head-title">Filtreler</span><button class="sidebar-close-btn" id="g-reset" title="Filtreleri temizle" aria-label="Filtreleri temizle">✕</button></div>
    <div class="sidebar-search">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" id="g-local-search" placeholder="Proje ara..." value="${escapeAttr(localSearchQuery)}">
    </div>`;
  FILTER_GROUPS.forEach(g => {
    if(g.nested) return; // ana grubun (örn. Yer) seçeneklerinin arasına gömülü olarak ayrıca çiziliyor
    const groupData = filtersData[g.key];
    const options = groupData ? groupData.options : [];
    if(options.length === 0) return;
    // Bu gruba bağlı iç içe bir alt grup var mı? (örn. Yer -> İlçe, "İstanbul" seçeneğinin altında)
    const childGroup = FILTER_GROUPS.find(cg => cg.nested && cg.parentKey === g.key);
    const childData = childGroup ? filtersData[childGroup.key] : null;
    html += `<div class="filter-group" data-key="${g.key}">
      <button class="filter-group-head" data-toggle="${g.key}">${escapeHtml(g.label)} <span class="filter-group-toggle">+</span></button>
      <div class="filter-group-body" id="fg-${g.key}">
        <div class="filter-search-row"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input type="text" class="filter-search-input" placeholder="Ara..." autocomplete="off"></div>
        ${options.map(opt => {
          let row = optRow(g, opt, groupData.counts[opt], false);
          if(childGroup && opt === childGroup.parentValue && childData && childData.options.length){
            row += childData.options.map(cOpt => optRow(childGroup, cOpt, childData.counts[cOpt], true)).join('');
          }
          return row;
        }).join('')}
      </div>
    </div>`;
  });
  html += `<div class="sidebar-add"><a class="sidebar-add-btn" href="proje-ekle.html"><span class="sidebar-add-icon">+</span> Proje Ekle</a></div>`;
  sidebar.innerHTML = html;

  // Bir künye linkinden (?category=...) ya da doğrudan URL'den önceden seçili gelen bir filtre
  // varsa, ilgili akordeon grubunu kapalı bırakmak yerine açık göster (ana grup + varsa nested/iç grubu).
  FILTER_GROUPS.forEach(g => {
    if(activeFilters[g.key].size === 0) return;
    const openKey = (g.nested && g.parentKey) ? g.parentKey : g.key;
    const grp = sidebar.querySelector(`.filter-group[data-key="${openKey}"]`);
    if(grp) grp.classList.add('open');
  });

  sidebar.querySelectorAll('[data-toggle]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      btn.parentElement.classList.toggle('open');
    });
  });
  const resetBtn = document.getElementById('g-reset');
  if(resetBtn) resetBtn.addEventListener('click', ()=>{
    FILTER_GROUPS.forEach(g => activeFilters[g.key].clear());
    localSearchQuery = '';
    currentPage = 1;
    syncBrowserUrl(true);
    buildSidebar();
    render();
  });
  sidebar.querySelectorAll('input[type=checkbox]').forEach(cb=>{
    cb.addEventListener('change', ()=>{
      const key = cb.dataset.key, val = cb.value;
      if(cb.checked) activeFilters[key].add(val); else activeFilters[key].delete(val);
      currentPage = 1;
      syncBrowserUrl(true);
      buildSidebar();
      render();
      // restore open state for the group just interacted with (iç içe bir grupsa ana grubunu aç)
      const fg = FILTER_GROUPS.find(f => f.key === key);
      const openKey = (fg && fg.nested && fg.parentKey) ? fg.parentKey : key;
      const grp = sidebar.querySelector(`.filter-group[data-key="${openKey}"]`);
      if(grp) grp.classList.add('open');
    });
  });
  const localSearchInput = document.getElementById('g-local-search');
  let searchDebounce = null;
  if(localSearchInput) localSearchInput.addEventListener('input', ()=>{
    localSearchQuery = localSearchInput.value;
    currentPage = 1;
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(()=>{ syncBrowserUrl(false); render(); }, 300);
  });
  // Her grubun kendi arama kutusu YALNIZCA o grubun altındaki .filter-opt satırlarını gösterip
  // gizler — activeFilters/genel arama kutusundan bağımsız, seçim/sayaç mantığını etkilemez.
  sidebar.querySelectorAll('.filter-search-input').forEach(input => {
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('input', () => {
      const body = input.closest('.filter-group-body');
      const q = trLower(input.value.trim());
      body.querySelectorAll('.filter-opt').forEach(opt => {
        const label = trLower(opt.querySelector('span').textContent);
        opt.style.display = !q || label.includes(q) ? '' : 'none';
      });
    });
  });
}

function renderActiveChips(){
  const wrap = document.getElementById('active-chips');
  let chips = [];
  FILTER_GROUPS.forEach(g=>{
    activeFilters[g.key].forEach(v=>{
      chips.push({key:g.key, val:v});
    });
  });
  if(chips.length === 0){ wrap.innerHTML = ''; return; }
  wrap.innerHTML = chips.map(c=>`
    <span class="active-chip" data-key="${c.key}" data-val="${escapeAttr(c.val)}">
      ${escapeHtml(c.val)}
      <button aria-label="Kaldır"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </span>`).join('');
  wrap.querySelectorAll('.active-chip button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const chip = btn.parentElement;
      activeFilters[chip.dataset.key].delete(chip.dataset.val);
      currentPage = 1;
      syncBrowserUrl(true);
      buildSidebar(); render();
    });
  });
}

function getPageWindowSize(){
  const w = window.innerWidth;
  if(w <= 480) return 3;
  if(w <= 720) return 5;
  return 9;
}
// Mevcut sayfayı her zaman ortalayan kayan pencere; ilk ve son sayfa (bkz. kullanıcı isteği:
// "1. ve son sayfa her zaman görünür olsun") ayrıca her zaman ayrı buton olarak eklenir, pencereye
// dahil değillerse aralarına '...' konur. Pencere bir uca yaklaştığında diğer ucu genişletip N
// sayfa göstermeye devam eder (bkz. start===2/end===totalPages-1 dallari).
function getPageList(totalPages, currentPage){
  const N = getPageWindowSize();
  if(totalPages <= N + 2){ const pages=[]; for(let p=1;p<=totalPages;p++) pages.push(p); return pages; }
  const half = Math.floor(N / 2);
  let start = Math.max(2, currentPage - half);
  let end = Math.min(totalPages - 1, currentPage + half);
  if(start === 2) end = Math.min(totalPages - 1, start + N - 1);
  if(end === totalPages - 1) start = Math.max(2, end - N + 1);
  const pages = [1];
  if(start > 2) pages.push('...');
  for(let p=start; p<=end; p++) pages.push(p);
  if(end < totalPages - 1) pages.push('...');
  pages.push(totalPages);
  return pages;
}
// Sayfa/gezinme butonlarının HEPSİ buradan geçer — URL'i (?page=N) günceller, mevcut sayfayı
// yeniden çeker ve en üste yumuşak kaydırır (bkz. kullanıcı isteği).
function goToPage(p){
  currentPage = p;
  syncBrowserUrl(true);
  render();
  window.scrollTo({top:0, behavior:'smooth'});
}
function renderPagination(totalPages){
  const el = document.getElementById('pagination');
  if(totalPages <= 1){ el.innerHTML=''; return; }
  let html = `<button class="page-btn page-btn-arrow" id="page-prev" aria-label="Önceki" ${currentPage===1?'disabled':''}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg></button>`;
  getPageList(totalPages, currentPage).forEach(p=>{
    if(p==='...') html += `<span class="page-ellipsis">…</span>`;
    else html += `<button class="page-btn${p===currentPage?' active':''}" data-page="${p}">${p}</button>`;
  });
  html += `<button class="page-btn page-btn-arrow" id="page-next" aria-label="Sonraki" ${currentPage===totalPages?'disabled':''}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg></button>`;
  el.innerHTML = html;
  el.querySelectorAll('[data-page]').forEach(btn=>{
    btn.addEventListener('click', ()=> goToPage(parseInt(btn.dataset.page)));
  });
  const prevBtn=document.getElementById('page-prev'), nextBtn=document.getElementById('page-next');
  if(prevBtn) prevBtn.addEventListener('click', ()=>{ if(currentPage>1) goToPage(currentPage-1); });
  if(nextBtn) nextBtn.addEventListener('click', ()=>{ if(currentPage<totalPages) goToPage(currentPage+1); });
}

// render() artık yalnızca mevcut sayfanın kartlarını /api/projects'ten çeker (bkz. kullanıcı
// isteği: "Her sayfa geçişinde sadece o sayfadaki proje verisini çek ve render et") — tüm veri
// seti hiçbir zaman tarayıcıya inmiyor.
let renderRequestId = 0;
async function render(){
  const myRequest = ++renderRequestId;
  const grid = document.getElementById('card-grid');
  const empty = document.getElementById('empty-state');
  grid.style.opacity = '0.5';

  const params = currentQueryParams();
  params.set('page', String(currentPage));
  params.set('limit', String(PAGE_SIZE));

  let data = null;
  try{
    const res = await fetch(`/api/projects?${params.toString()}`);
    if(res.ok) data = await res.json();
  }catch(err){
    console.error('Proje listesi alınamadı:', err);
  }
  if(myRequest !== renderRequestId) return; // bu arada başka bir render() tetiklendi, bu yanıt bayat
  grid.style.opacity = '1';

  if(!data){
    grid.innerHTML = '';
    empty.textContent = 'Projeler yüklenemedi, lütfen sayfayı yenile.';
    empty.style.display = 'block';
    document.getElementById('pagination').innerHTML = '';
    document.getElementById('result-count').textContent = '';
    return;
  }

  currentPage = data.page;
  document.getElementById('result-count').textContent = `${data.total} proje listeleniyor`;
  renderActiveChips();
  renderPagination(data.totalPages);

  if(data.items.length === 0){ grid.innerHTML=''; empty.textContent = 'Bu kritere uyan proje bulunamadı.'; empty.style.display='block'; return; }
  empty.style.display = 'none';

  // .content-grid ≤720px'de 2 sütuna düşüyor (bkz. proje.html'deki @media 720px), aksi halde 3 —
  // sabit bir eşik yerine gerçek sütun sayısına göre hesaplanır (denetim bulgusu, 2026-08-14).
  const eagerCardCount = window.innerWidth <= 720 ? 2 : 3;
  grid.innerHTML = data.items.map((p, i) => {
    const loc = parseLocation(p.location);
    // Kart altyazısında yalnızca İL gösterilir, ilçe ATLANIR (bkz. kullanıcı isteği: "İl · Yıl",
    // ör. "İstanbul · 2024") — ilçe bilgisi hâlâ modalin "Yer:" satırında (bkz. project-meta.js)
    // tam haliyle görünmeye devam eder, yalnızca kart özetindeki kısa format sadeleştirilir.
    const locLabel = loc.city;
    // İlk sıradaki (i<eagerCardCount, yukarıda hesaplandı) kartlar sayfa açılışında ZATEN katlanma
    // çizgisinin üstünde görünür — bunları da loading="lazy" ile geciktirmek tarayıcının layout'u
    // bekleyip isteği ERTELEMESİNE yol açıp ilk yüklenmeyi YAVAŞLATIYORDU (bkz. kullanıcı isteği:
    // "ilk yüklenme hızını artır"); ilk satır eager + fetchpriority="high" ile hemen istenir,
    // alttaki (katlanma çizgisinin altındaki) kartlar lazy kalır. sizes, grid'in kırılma
    // noktalarındaki gerçek kart genişliğine karşılık gelir — srcset cdnSrcset() ile üretilir ama
    // IMAGE_CDN_ENABLED false olduğu sürece boş döner (bkz. image-cdn.js#IMAGE_CDN_ENABLED, zone
    // onayı bekleniyor), o ana kadar davranış değişmez.
    const aboveFold = i < eagerCardCount;
    const imgAttrs = aboveFold
      ? `loading="eager" fetchpriority="high"`
      : `loading="lazy" fetchpriority="low"`;
    const cardImg = p.images && p.images[0];
    const cardSrcset = cardImg ? cdnSrcset(cardImg, [400, 600, 800]) : '';
    return `
    <a class="content-card" href="/proje/${encodeURIComponent(p.slug)}">
      <div class="content-card-photo">
        ${cardImg ? `<img src="${escapeAttr(cdnImg(cardImg, 600))}"${cardSrcset ? ` srcset="${escapeAttr(cardSrcset)}"` : ''} alt="${escapeAttr(p.title)}" ${imgAttrs} decoding="async" sizes="(max-width: 720px) 50vw, (max-width: 960px) 33vw, 400px">` : `<div class="content-card-placeholder" style="background:${officeColor(p.title)}">${escapeHtml(initials(p.title))}</div>`}
        <button class="card-save-btn" type="button" data-key="${escapeAttr(p.slug)}" data-title="${escapeAttr(p.title)}" data-meta="${escapeAttr(p.location||'')}" data-image="${escapeAttr((p.images && p.images[0])||'')}" data-href="/proje/${encodeURIComponent(p.slug)}" aria-label="Kaydet">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z"/></svg>
        </button>
      </div>
      <div class="content-card-info">
        <div class="content-card-title">${escapeHtml(p.title)}</div>
        <div class="content-card-by">${escapeHtml(locLabel)}${p.date ? ' · ' + escapeHtml(p.date) : ''}</div>
      </div>
    </a>`;
  }).join('');
  wireSaveButtons('project');
}

function escapeHtml(s){ const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function escapeAttr(s){ return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

// data.js'teki initials()/officeColor() ile birebir aynı — bu sayfa performans için data.js'i
// yüklemiyor, görseli olmayan proje kartları için sadece bu iki küçük saf fonksiyon gerekiyor.
function initials(name){
  return (name || '?').replace(/[—.]/g,' ').trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
}
const CARD_PALETTE = ['#2B425F','#3E5A78','#5B7A9B','#4F6478','#7C4B4B'];
function officeColor(name){
  let hash = 0;
  for(let i=0;i<name.length;i++) hash = name.charCodeAt(i) + ((hash<<5)-hash);
  return CARD_PALETTE[Math.abs(hash) % CARD_PALETTE.length];
}

document.getElementById('g-sort').addEventListener('change', ()=>{ currentPage = 1; syncBrowserUrl(true); render(); });

// Kart tıklaması: proje modalı (bkz. js/components/project-modal.js) sayfa yenilenmeden açılsın diye
// düz sol tıklamalar burada yakalanır — orta tık/Ctrl/Cmd/Shift/Alt ile açma (yeni sekme vb.)
// tarayıcının kendi doğal davranışına bırakılır (bkz. kullanıcı isteği). Tek bir delege dinleyici
// #card-grid üzerine BİR KEZ bağlanır — grid.innerHTML her render()'da değişse de konteynerin
// kendisi hiç değişmediğinden yeniden bağlamaya gerek yok.
document.getElementById('card-grid').addEventListener('click', (e)=>{
  if(e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a.content-card');
  if(!a || e.target.closest('.card-save-btn')) return;
  const m = (a.getAttribute('href') || '').match(/^\/proje\/([^/?#]+)/);
  if(!m) return;
  const slug = decodeURIComponent(m[1]);
  e.preventDefault();
  ProjectModal.open(slug, { triggerEl: a });
});

// Tarayıcı geri/ileri tuşu: /proje/:slug yoluna gidiliyorsa/dönülüyorsa yalnızca proje modalını
// güncelle (bkz. ProjectModal.handlePopState) — listeyi burada YENİDEN ÇİZME, modal kapanana kadar
// arka plandaki liste durumu zaten sabit kalmalı (bkz. kullanıcı isteği). Diğer TÜM durumlarda
// (ör. /proje?filtre=...) eski davranış aynen korunur; modal açıksa önce (URL zaten doğru olduğundan
// history'e TEKRAR yazmadan) kapatılır.
window.addEventListener('popstate', ()=>{
  const m = location.pathname.match(/^\/proje\/([^/]+)\/?$/);
  if(m){ ProjectModal.handlePopState(decodeURIComponent(m[1])); return; }
  // Modal kapanırken buraya (bare /proje) dönülüyorsa arka plandaki liste modal açıkken hiç
  // değişmedi (etkileşim kilitliydi) — filtreleri sıfırlayıp grid'i YENİDEN ÇEKMEYE gerek yok;
  // bunu yapmak modal-shell.js'in geri yüklediği scroll konumunu, grid yeniden render olurken
  // (async fetch + layout shift) bozuyordu (bkz. kullanıcı isteği: scroll konumu tam korunmalı).
  if(ProjectModal.isOpen()){ ProjectModal.handlePopState(null); return; }
  FILTER_GROUPS.forEach(g => activeFilters[g.key].clear());
  applyInitialFiltersFromQuery();
  buildSidebar();
  render();
});

// İlk otomatik render() DOMContentLoaded'a ertelenir — render() içindeki cdnImg() (image-cdn.js,
// defer ile yüklenir) de tıpkı aşağıdaki ProjectModal yorumunda anlatılan AYNI riskle karşı
// karşıya: /api/projects isteği bazen deferred script'ten daha hızlı dönebiliyor, bu da
// "cdnImg is not defined" hatasıyla proje listesini sessizce boş bırakabiliyordu (bkz.
// urun.html'deki BİREBİR AYNI gerçek bulgu/düzeltme — orada catalogCardMediaHtml ile yaşandı).
// Deferred script'ler DOMContentLoaded'dan ÖNCE çalışmayı garanti eder.
document.addEventListener('DOMContentLoaded', () => {
  applyInitialFiltersFromQuery();
  buildSidebar();
  render();
});

// Doğrudan /proje/:slug adresine girildiğinde ya da o adreste F5 yapıldığında proje modalı
// otomatik açılsın (bkz. kullanıcı isteği) — pushHistory:false: URL zaten doğru, YENİ bir geçmiş
// girdisi açılmaz (bkz. ProjectModal.open). ESKİDEN render()'ın .then()'ine bağlıydı (bkz. gerçek
// bulgu: "Ertegün Evi carousel'den tıklanınca açılmıyor" raporu — aslında TÜM projelerde/mimar/
// firma sayfalarında genel bir sorundu) — /api/projects edge cache'ten render()'ın kendisinden
// DAHA HIZLI dönebildiğinden, bu callback bazen ProjectModal (defer script) henüz tanımlanmadan
// tetikleniyor, "ProjectModal is not defined" hatasıyla SESSİZCE (unhandled promise rejection,
// konsolda görünmüyor) modalı hiç açmıyordu. DOMContentLoaded'a bağlamak deferred script'lerin
// (ProjectModal dahil) KESİN olarak tanımlanmış olmasını garantiler — render()/network
// zamanlamasından tamamen bağımsız.
document.addEventListener('DOMContentLoaded', () => {
  const m = location.pathname.match(/^\/proje\/([^/]+)\/?$/);
  if(m) ProjectModal.open(decodeURIComponent(m[1]), { pushHistory:false });
});

// wireNavSearch() ve hamburger menü artık js/components/site-chrome.js tarafından merkezi olarak
// çalıştırılıyor (bkz. kullanıcı isteği: üst/alt menü tüm sayfalarda tek kaynaktan güncellensin).
