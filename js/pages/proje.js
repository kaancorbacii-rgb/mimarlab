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

// ---------- HARİTA GÖRÜNÜMÜ (bkz. kullanıcı isteği: "Projeler sayfasındaki haritada tüm projelerin
// gözükmesi gerekiyor... filtreler haritaya da işlemeli") ----------
// currentItems: render()'ın en son çektiği (filtrelenmiş/SAYFALANMIŞ, 24'lük) kart listesi — Harita
// görünümü artık BUNU paylaşmaz, kendi `all=1` isteğini atar (bkz. refreshMap) ki aktif filtre/arama
// ile eşleşen projelerin TAMAMI (24'lük sayfa sınırı olmadan) pinlenebilsin. leafletMap/mapMarkers
// yalnızca kullanıcı Harita sekmesine İLK kez geçtiğinde (bkz. loadLeaflet) kurulur. Leaflet + Esri
// World Imagery (uydu karoları) — anahtarsız/ücretsiz, bkz. proje-ekle.html'deki AYNI yığın/gerekçe
// (src/index.js CSP yorumu).
let currentItems = [];
let leafletMap = null;
let mapMarkers = [];
let leafletPromise = null;
// mapViewActive: kullanıcı şu an Harita sekmesinde mi (bkz. wireViewToggle#setView) — render()
// bunu okuyarak Harita GÖRÜNMÜYORKEN gereksiz "tüm filtrelenmiş projeler" isteği atmaz; Liste'den
// Harita'ya her dönüşte (mapLoaded olsa bile, çünkü aradan filtre değişmiş olabilir) refreshMap()
// yeniden çağrılır.
let mapViewActive = false;
let mapRequestId = 0;

// proje.html Leaflet CSS/JS'i sayfa yüklenişinde HİÇ içermiyor (proje-ekle.html'in aksine) — script
// tag'ı yalnızca kullanıcı Harita'ya İLK kez geçtiğinde dinamik eklenir, her /proje ziyaretinde değil.
function loadLeaflet(){
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

// mapWrap henüz kurulmamışsa (Harita sekmesi hiç açılmadıysa) no-op — wireViewToggle map'i ilk
// kurduğunda zaten currentItems'ın en güncel halini kendisi geçiriyor, burada TEKRAR çağırmaya
// gerek yok; bu fonksiyon yalnızca map ZATEN AÇIKKEN filtre/sayfa değişince senkron kalmayı sağlar.
// GERÇEK BULGU (kullanıcı isteği): burada eskiden marker'ların bounding box'ına `fitBounds` yapılıyordu
// — o anki (sayfalanmış/filtrelenmiş) birkaç proje tesadüfen tek bir şehirde kümelenince harita
// YANLIŞLIKLA sokak seviyesine yakınlaşıyordu. Artık HİÇBİR zaman fitBounds edilmiyor; görünüm her
// zaman wireViewToggle'ın kurduğu sabit "tüm Türkiye" varsayılanında kalır, marker sayısı/konumu
// zoom/merkezi ETKİLEMEZ.
function syncMapMarkers(items){
  if (!leafletMap) return;
  mapMarkers.forEach(m => leafletMap.removeLayer(m));
  mapMarkers = [];
  (items || []).forEach(p => {
    if (p.lat == null || p.lng == null) return;
    const marker = L.marker([p.lat, p.lng], { title: p.title }).addTo(leafletMap);
    // Marker'a tıklamak artık DOĞRUDAN proje popup'ını açmaz (bkz. kullanıcı isteği) — önce
    // haritanın üzerinde projenin kapak görseli + başlığını taşıyan küçük bir Leaflet popup'ı
    // açılır (bindPopup'ın varsayılan marker-tıklama davranışı), ProjectModal YALNIZCA bu küçük
    // kartın içindeki görsele/başlığa (tek bağlantı, .pm-map-marker-card) tıklanınca açılır.
    const cardImg = p.images && p.images[0];
    const photoHtml = cardImg
      ? `<img class="pm-map-marker-card-photo" src="${escapeAttr(cdnImg(cardImg, 300))}" alt="${escapeAttr(p.title)}">`
      : `<div class="pm-map-marker-card-photo pm-map-marker-card-placeholder" style="background:${officeColor(p.title)}">${escapeHtml(initials(p.title))}</div>`;
    const popupHtml = `<a class="pm-map-marker-card" href="/proje/${encodeURIComponent(p.slug)}">${photoHtml}<div class="pm-map-marker-card-title">${escapeHtml(p.title)}</div></a>`;
    marker.bindPopup(popupHtml, { minWidth: 160, maxWidth: 200, className: 'pm-project-popup' });
    // Leaflet popup içeriği HER popupopen'da (bkz. Leaflet Popup#_updateContent) yeniden DOM'a
    // basıldığından (eski düğümler kapanışta kaldırılır) burada tekrar tekrar dinleyici eklemek
    // birikmeli/çift tetiklemeye yol AÇMAZ — her açılış kendi taze <a> düğümünü alır.
    marker.on('popupopen', (e) => {
      const el = e.popup.getElement()?.querySelector('.pm-map-marker-card');
      if (el) el.addEventListener('click', (ev) => { ev.preventDefault(); ProjectModal.open(p.slug, { triggerEl: el }); });
    });
    mapMarkers.push(marker);
  });
}

// Harita artık o anki sayfanın (24'lük dilim) DEĞİL, aktif filtre/arama ile eşleşen TÜM projelerin
// (bkz. kullanıcı isteği: "1429 projenin tamamı haritaya işlensin... filtreler haritaya da işlemeli")
// pinlerini gösterir — bu yüzden kart listesinin sayfalanmış /api/projects isteğinden AYRI, kendi
// `all=1` isteğini atar (bkz. src/routes/project.js#handleProjectListRoute üstündeki wantAll dalı).
// Yalnızca Harita GÖRÜNÜRKEN (mapViewActive) çağrılır — Liste'deyken her filtre değişiminde gereksiz
// ek bir istek atılmaz, kullanıcı Harita'ya dönünce (bkz. wireViewToggle#setView) taze veriyle çağrılır.
async function refreshMap(){
  if (!leafletMap || !mapViewActive) return;
  const myRequest = ++mapRequestId;
  const params = currentQueryParams();
  params.set('all', '1');
  let data = null;
  try{
    const res = await fetch(`/api/projects?${params.toString()}`);
    if(res.ok) data = await res.json();
  }catch(err){ console.error('Harita için proje listesi alınamadı:', err); }
  if(myRequest !== mapRequestId) return; // bu arada başka bir refreshMap() tetiklendi, bu yanıt bayat
  if(!leafletMap) return; // bu arada Harita'dan çıkılmış olabilir (map instance ayakta kalır ama gereksiz)
  syncMapMarkers(data ? data.items : []);
}

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
// gerçek bulgu (denetim, 2026-08-24): grup içi "Ara..." kutusuna (bkz. buildSidebar#filter-search-input)
// yazılan metin hiçbir state'te tutulmuyordu, yalnızca DOM'da yaşıyordu — buildSidebar() sidebar.innerHTML'i
// checkbox tıklanan grup FARKLI olsa bile HER checkbox değişiminde TAMAMEN yeniden kurduğundan, bir
// grubu daraltıp bir sonucu işaretlemek o kutudaki yazıyı sessizce siliyor, liste tam listeye geri
// dönüyordu. Grup anahtarına göre son yazılan metni burada saklayıp buildSidebar() sonunda geri uygularız.
const groupSearchQueries = {};

// ---------- EN İYİ 100 SEKMESİ (bkz. kullanıcı isteği: "Liste ve Harita başlıklarının soluna
// En İyi 100 başlığını ekle... Filtreler ve sıralama butonu En İyi 100 listesinde de etkin
// çalışsın") — Harita gibi üçüncü bir view-toggle sekmesi, ama kendi /api/public/top100
// verisini (en-iyi-100.html'in kullandığı AYNI uç, bkz. src/routes/top100.js#computeTop100)
// TEK seferde çekip mevcut sol filtre çubuğu/Sıralama/arama ile İSTEMCİ tarafında filtreler.
// top100 item'ları (bkz. computeTop100) discipline/category/type/location/dateBucket/awards
// alanlarını taşır — bu yüzden FILTER_GROUPS'un 9 grubundan 6'sı (discipline/category/type/
// location/district/award) burada da aynen çalışır. designer/designerOffice ÇALIŞMAZ (top100
// sorgusu project_designers'a hiç JOIN etmiyor, bkz. o dosya) — bu iki grup işaretliyken bu
// sekmeye geçilirse sessizce yok sayılır, sonuç boşalmaz ama bu iki grup açısından daraltılmaz.
let TOP100_ITEMS = null;
let top100LoadPromise = null;
let top100ViewActive = false;
function loadTop100(){
  if(top100LoadPromise) return top100LoadPromise;
  top100LoadPromise = fetch('/api/public/top100')
    .then(res => res.ok ? res.json() : { items: [] })
    // date: projectDate — render()'ın kart şablonu /api/projects'in `date` alanını okur (bkz.
    // src/lib/projectPool.js#date:p.project_date), top100 payload'ı AYNI ham değeri `projectDate`
    // adıyla taşıyor (bkz. src/routes/top100.js#items).
    // title: it.name — render()'ın paylaşılan kart şablonu (bkz. renderCards) `title` okur,
    // top100 payload'ı AYNI değeri `name` adıyla taşır (bkz. src/routes/top100.js#items). Slug'ı
    // hiç çözülemeyen (canonical projects'te artık bulunamayan) girdiler atlanır — en-iyi-100.html'in
    // kendi renderTop100()'ünün AKSİNE burada linksiz bir kart göstermek yerine (bu sayfanın kart
    // şablonu koşulsuz <a href> ile sarmalı, bkz. renderCards) baştan filtrelemek daha basit/güvenli.
    .then(data => { TOP100_ITEMS = (data.items || []).filter(it => it.slug).map(it => ({ ...it, title: it.name, date: it.projectDate })); })
    .catch(() => { TOP100_ITEMS = []; });
  return top100LoadPromise;
}
const TOP100_FILTER_GETTERS = {
  discipline: it => it.discipline || [],
  category: it => it.category || [],
  type: it => it.type || [],
  location: it => { const loc = parseLocation(it.location || ''); return loc.city ? [loc.city] : []; },
  district: it => { const loc = parseLocation(it.location || ''); return loc.district ? [loc.district] : []; },
  dateBucket: it => it.dateBucket ? [it.dateBucket] : [],
  award: it => it.awards || [],
};
function passesTop100ActiveFilters(it){
  return Object.keys(TOP100_FILTER_GETTERS).every(key => {
    const active = activeFilters[key];
    if(!active || active.size === 0) return true;
    return TOP100_FILTER_GETTERS[key](it).some(v => active.has(v));
  });
}
function passesTop100Search(it){
  const q = localSearchQuery.trim();
  return !q || trLower(it.name || '').includes(trLower(q));
}
// src/routes/project.js#parseProjectDateYear/en-iyi-100.html'deki AYNI serbest-metin proje tarihi
// ayrıştırma mantığı — Sıralama'nın En Yeni/En Eski seçenekleri top100 sekmesinde de çalışsın diye.
function foldTr(s){
  return (s || '').replace(/İ/g,'i').replace(/I/g,'ı').replace(/Ş/g,'ş').replace(/Ğ/g,'ğ').replace(/Ü/g,'ü').replace(/Ö/g,'ö').replace(/Ç/g,'ç').toLowerCase()
    .replace(/ı/g,'i').replace(/ş/g,'s').replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ö/g,'o');
}
function parseProjectDateYear(dateStr){
  if(!dateStr) return null;
  const hasCenturyWordAnywhere = /yuzyil|\byy\b/.test(foldTr(dateStr));
  let best = null;
  String(dateStr).split('/').forEach(rawSegment => {
    const folded = foldTr(rawSegment);
    const isBC = /\bmo\b/.test(folded);
    const isCenturyFragment = hasCenturyWordAnywhere && /^\s*(ms\s*)?\d{1,2}\.\s*$/.test(folded);
    const isCentury = isCenturyFragment || /yuzyil|\byy\b/.test(folded);
    const nums = (rawSegment.match(/\d+/g) || []).map(n => parseInt(n, 10));
    if(!nums.length) return;
    let year;
    if(isCentury){
      const century = isBC ? Math.max(...nums) : Math.min(...nums);
      year = isBC ? -(century * 100) : (century - 1) * 100 + 1;
    } else {
      const magnitude = isBC ? Math.max(...nums) : Math.min(...nums);
      year = isBC ? -magnitude : magnitude;
    }
    if(best === null || year < best) best = year;
  });
  return best;
}
function sortTop100Items(items){
  const sort = document.getElementById('g-sort').value;
  const sorted = items.slice();
  if(sort === 'name_asc') sorted.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'tr'));
  else if(sort === 'date_desc' || sort === 'date_asc') sorted.sort((a, b) => {
    const ya = parseProjectDateYear(a.date), yb = parseProjectDateYear(b.date);
    if(ya === null && yb === null) return 0;
    if(ya === null) return 1;
    if(yb === null) return -1;
    return sort === 'date_desc' ? yb - ya : ya - yb;
  });
  else if(sort === 'rating_desc') sorted.sort((a, b) => b.avg - a.avg);
  else sorted.sort((a, b) => a.rank - b.rank);
  return sorted;
}

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
// gerçek bulgu (denetim, 2026-08-24): render() kendi renderRequestId'siyle bayat yanıtlara karşı
// korunuyordu (bkz. o fonksiyon), ama buildSidebar()'ın hiç eşdeğeri yoktu. İki filtre kutusu art
// arda hızlıca işaretlendiğinde iki örtüşen /api/projects/filters isteği atılır; ilki (eski filtre
// kombinasyonuna göre) SONRA dönerse sidebar.innerHTML'i EN SON yazan o olur — checkbox'ların işaretli
// durumu her zaman canlı activeFilters'tan okunduğu için yanlış görünmez, ama yanındaki sayaçlar
// (facet counts) sessizce bayat/eksik bir filtre kombinasyonunu yansıtmaya devam eder.
let sidebarRequestId = 0;
async function buildSidebar(){
  const mySidebarRequest = ++sidebarRequestId;
  const sidebar = document.getElementById('sidebar');
  let filtersData = {};
  try{
    const res = await fetch(`/api/projects/filters?${currentQueryParams().toString()}`);
    if(res.ok){ const data = await res.json(); filtersData = data.filters || {}; }
  }catch(err){ console.error('Filtre seçenekleri alınamadı:', err); }
  if(mySidebarRequest !== sidebarRequestId) return; // bu arada başka bir buildSidebar() tetiklendi, bu yanıt bayat

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
  // gerçek bulgu (denetim, 2026-08-24): mimar.html/firma.html'deki AYNI "Filtreleri temizle" butonu
  // sıralamayı (g-sort) ve üst/mobil nav arama kutularını (f-search-topnav/f-search-nav) da açıkça
  // sıfırlıyor — buradaki (checkbox tabanlı sidebar'a özgü) sürüm yalnızca activeFilters/
  // localSearchQuery'i temizleyip bunları hiç dokunmuyordu. Sonuç: proje.html'de "Filtreleri temizle"ye
  // basmak filtreleri/aramayı sıfırlamış GÖRÜNÜYOR ama aktif bir sıralama varsa listede sessizce
  // uygulanmaya devam ediyor, üstteki arama kutusunda da eski metin kalıyordu.
  if(resetBtn) resetBtn.addEventListener('click', ()=>{
    FILTER_GROUPS.forEach(g => activeFilters[g.key].clear());
    localSearchQuery = '';
    Object.keys(groupSearchQueries).forEach(k => delete groupSearchQueries[k]);
    currentPage = 1;
    const sortEl = document.getElementById('g-sort');
    if(sortEl) sortEl.value = '';
    const topNavSearch = document.getElementById('f-search-topnav');
    if(topNavSearch) topNavSearch.value = '';
    const mobileNavSearch = document.getElementById('f-search-nav');
    if(mobileNavSearch) mobileNavSearch.value = '';
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
  function applyGroupSearchFilter(input) {
    const body = input.closest('.filter-group-body');
    const q = trLower(input.value.trim());
    body.querySelectorAll('.filter-opt').forEach(opt => {
      const label = trLower(opt.querySelector('span').textContent);
      opt.style.display = !q || label.includes(q) ? '' : 'none';
    });
  }
  sidebar.querySelectorAll('.filter-search-input').forEach(input => {
    const groupKey = input.closest('.filter-group').dataset.key;
    // bkz. dosya başı #groupSearchQueries — bu grup için önceden yazılmış bir sorgu varsa (bir başka
    // grubun checkbox'ı değiştiği için buildSidebar() bu DOM'u az önce sıfırdan kurmuş olabilir) geri
    // uygulanır, aksi halde eskisiyle birebir aynı boş/temiz kutu davranışı korunur.
    if(groupSearchQueries[groupKey]){
      input.value = groupSearchQueries[groupKey];
      applyGroupSearchFilter(input);
    }
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('input', () => {
      groupSearchQueries[groupKey] = input.value;
      applyGroupSearchFilter(input);
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

// renderCards() — render()'ın kart-ızgarası şablonu, hem normal /api/projects sonuçları hem de
// En İyi 100 sekmesinin istemci-taraflı filtrelenmiş top100 alt kümesi (bkz. TOP100_ITEMS/render()
// aşağıdaki top100ViewActive dalı) için ORTAK — ikisi de AYNI {slug,title,location,images,date}
// alan adlarını taşıdığından (bkz. loadTop100'deki title/date normalize eşlemesi) tek şablon yeter.
function renderCards(items){
  const grid = document.getElementById('card-grid');
  // .content-grid ≤720px'de 2 sütuna düşüyor (bkz. proje.html'deki @media 720px), aksi halde 3 —
  // sabit bir eşik yerine gerçek sütun sayısına göre hesaplanır (denetim bulgusu, 2026-08-14).
  const eagerCardCount = window.innerWidth <= 720 ? 2 : 3;
  grid.innerHTML = items.map((p, i) => {
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

// ---------- EN İYİ 100 SATIR TASARIMI — en-iyi-100.html#renderTop100() İLE BİREBİR AYNI (bkz.
// kullanıcı isteği: "proje sayfasındaki En İyi 100 sekmesi ekteki görseldekiyle bire bir aynı
// tasarımda olsun") — yalnızca satır şablonu buraya taşındı, Tip/Grup/Yer/Yıl filtreleri/arama/
// sıralama bu sayfanın ZATEN var olan sol filtre çubuğu/#g-sort'undan gelir (bkz. loadTop100/
// passesTop100ActiveFilters/sortTop100Items yukarısı), en-iyi-100.html'in kendi toolbar'ı burada yok.
const DELTA_ICONS = {
  up: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4l9 14H3z"/></svg>',
  down: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 20 3 6h18z"/></svg>',
  flat: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="4" y1="12" x2="20" y2="12"/></svg>',
};
const ICON_SAVE = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z"/></svg>';
const ICON_STAR = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2.5l3.09 6.26 6.91 1-5 4.87 1.18 6.87L12 17.98l-6.18 3.52L7 14.63l-5-4.87 6.91-1L12 2.5Z"/></svg>';
const ICON_STAR_FILLED = '<svg class="top100-rate-icon-filled" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l3.09 6.26 6.91 1-5 4.87 1.18 6.87L12 17.98l-6.18 3.52L7 14.63l-5-4.87 6.91-1L12 2.5Z"/></svg>';

// en-iyi-100.html#ROMAN_BEFORE_RE/firstSentence İLE BİREBİR AYNI — Roma rakamlı padişah/hükümdar
// sıra numaralarındaki ("I. Justinianus" vb.) kısaltma noktasını cümle sonu SAYMAZ.
const ROMAN_BEFORE_RE = /(^|\s)[IVXLCDM]{1,4}$/;
function firstSentence(text){
  if(!text) return '';
  const t = text.trim();
  let end = -1;
  for(let i = 0; i < t.length && i < 260; i++){
    const ch = t[i];
    if(ch === '.' || ch === '!' || ch === '?'){
      const before = t.slice(0, i);
      if(ROMAN_BEFORE_RE.test(before) || /\d$/.test(before)) continue;
      end = i + 1;
      break;
    }
  }
  if(end === -1) return t.length > 160 ? t.slice(0, 160).trim() + '…' : t;
  return t.slice(0, end);
}

const TOP100_EAGER_ROW_COUNT = 4;
function renderTop100Rows(items){
  const list = document.getElementById('top100-list');
  const rows = items.map((item, i) => {
    const rankClass = item.rank <= 3 ? ' top3' : '';
    const posterImgAttrs = i < TOP100_EAGER_ROW_COUNT ? 'loading="eager" fetchpriority="high" decoding="sync"' : 'loading="lazy" fetchpriority="low" decoding="async"';
    const posterInner = item.image
      ? `<img src="${escapeAttr(cdnImg(item.image, 220))}" alt="" ${posterImgAttrs}>`
      : `<div class="top100-poster-placeholder" style="background:${officeColor(item.name)}">${escapeHtml(initials(item.name))}</div>`;
    const posterHtml = item.slug
      ? `<a class="top100-poster-link top100-poster" href="/proje/${encodeURIComponent(item.slug)}">${posterInner}</a>`
      : `<span class="top100-poster">${posterInner}</span>`;
    const loc = item.location ? parseLocation(item.location) : null;
    const submetaParts = [];
    if(loc && loc.city) submetaParts.push(loc.city);
    if(item.projectDate) submetaParts.push(item.projectDate);
    const submeta = submetaParts.join(' · ');
    const desc = firstSentence(item.description);
    const nameHtml = item.slug
      ? `<a class="top100-name-link" href="/proje/${encodeURIComponent(item.slug)}">${escapeHtml(item.name)}</a>`
      : escapeHtml(item.name);
    const quickActions = item.slug
      ? `<span class="top100-quick-actions">` +
          `<button class="top100-action-btn top100-rate-btn" type="button" data-slug="${escapeAttr(item.slug)}" data-name="${escapeAttr(item.name)}" aria-label="Puanla">${ICON_STAR}<span>Puanla</span></button>` +
          `<button class="card-save-btn top100-action-btn" type="button" data-key="${escapeAttr(item.slug)}" data-title="${escapeAttr(item.name)}" data-meta="${escapeAttr(submeta)}" data-image="${escapeAttr(item.image || '')}" data-href="/proje/${encodeURIComponent(item.slug)}" aria-label="Kaydet">${ICON_SAVE}<span class="top100-save-label">Kaydet</span></button>` +
          `<span class="top100-share-slot" id="top100-share-slot-${item.rank}"></span>` +
        `</span>`
      : '';
    return `<li class="top100-row${rankClass}" data-slug="${escapeAttr(item.slug || '')}" data-rank="${item.rank}" data-avg="${item.avg}" data-count="${item.count}">` +
      `<span class="top100-rank-wrap">` +
        `<span class="top100-rank">${item.rank}</span>` +
        `<span class="top100-delta ${item.delta}" title="${item.delta === 'up' ? 'Sıralamada yükseldi' : item.delta === 'down' ? 'Sıralamada düştü' : 'Sıralaması sabit'}">${DELTA_ICONS[item.delta]}</span>` +
      `</span>` +
      posterHtml +
      `<span class="top100-body">` +
        `<span class="top100-name">${nameHtml}</span>` +
        (submeta ? `<span class="top100-submeta">${escapeHtml(submeta)}</span>` : '') +
        (desc ? `<span class="top100-desc">${escapeHtml(desc)}</span>` : '') +
        quickActions +
      `</span>` +
      `<span class="top100-rating">` +
        `<span class="top100-avg"><span class="top100-avg-star">★</span> ${item.avg.toFixed(2)}</span>` +
        `<span class="top100-votes">${item.count} oy</span>` +
      `</span>` +
    `</li>`;
  }).join('');
  list.innerHTML = rows;
  wireTop100QuickActions(items);
}

// save-widget.js/rating-widget.js/share-button.js İLE AYNI kayıt/puan/paylaş bileşenlerini satırlara
// bağlar — proje.js bu üçünden SONRA defer ile yüklendiğinden (bkz. proje.html script sırası)
// en-iyi-100.html'deki whenReady()/domReady koruması burada gerekmiyor, globaller garanti tanımlı.
function wireTop100QuickActions(items){
  if(typeof wireSaveButtons === 'function') wireSaveButtons('project');
  paintRatedTop100Stars();
  if(typeof ShareWidget !== 'undefined'){
    items.forEach(item => {
      if(!item.slug) return;
      const slot = document.getElementById('top100-share-slot-' + item.rank);
      if(!slot) return;
      slot.outerHTML = ShareWidget.html('top100-share-' + item.rank);
      ShareWidget.wire('top100-share-' + item.rank, () => ({ title: item.name, url: 'https://mimarlab.com/proje/' + item.slug }));
    });
  }
}

// İsim/görsele tıklayınca proje modalı açılsın (bkz. #card-grid'in AYNI deseni yukarısı), Puanla
// düğmesi hızlı puanlama popup'ını açsın (bkz. aşağıdaki openRatePopup) — TEK delege dinleyici,
// #top100-list konteynerinin kendisi hiç değişmediğinden bir kez bağlanması yeterli.
document.getElementById('top100-list').addEventListener('click', (e) => {
  if(e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const rateBtn = e.target.closest('.top100-rate-btn');
  if(rateBtn){
    e.preventDefault();
    openRatePopup(rateBtn.dataset.slug, rateBtn.dataset.name);
    return;
  }
  if(e.target.closest('.card-save-btn') || e.target.closest('.share-btn')) return;
  const a = e.target.closest('a.top100-name-link, a.top100-poster-link');
  if(!a) return;
  const m = (a.getAttribute('href') || '').match(/^\/proje\/([^/?#]+)/);
  if(!m) return;
  e.preventDefault();
  ProjectModal.open(decodeURIComponent(m[1]), { triggerEl: a });
});

// ---------- HIZLI PUANLA POPUP'I — en-iyi-100.html#Hızlı Puanla popup'ı İLE BİREBİR AYNI davranış
// (bkz. kullanıcı isteği). Sunucu tarafı yıldız ikonu/oturum önbelleği rating-widget.js'in dışa açtığı
// starSvg()/loadMyRatings()/myRatingsPromise globallerinden ödünç alınır.
const PENDING_TOP100_RATING_KEY = 'mimarlab-pending-top100-rating';
const ratePopupOverlay = document.getElementById('rate-popup-overlay');
const ratePopupTitle = document.getElementById('rate-popup-title');
const ratePopupStars = document.getElementById('rate-popup-stars');
const ratePopupSubmit = document.getElementById('rate-popup-submit');
const ratePopupNotice = document.getElementById('rate-popup-notice');
let ratePopupSlug = null;
let ratePopupSelected = 0;
let ratePopupHover = 0;

function buildRatePopupStars(){
  let html = '';
  for(let i = 1; i <= 5; i++){
    html += `<button type="button" class="rate-popup-star" data-value="${i}" aria-label="${i} yıldız">${starSvg(true, 30)}</button>`;
  }
  ratePopupStars.innerHTML = html;
}
buildRatePopupStars();
function paintRatePopupStars(){
  const eff = ratePopupHover || ratePopupSelected;
  ratePopupStars.querySelectorAll('.rate-popup-star').forEach(btn => {
    const v = parseInt(btn.dataset.value, 10);
    btn.classList.toggle('filled', v <= eff);
  });
}
ratePopupStars.addEventListener('mouseover', (e) => {
  const btn = e.target.closest('.rate-popup-star');
  if(!btn) return;
  ratePopupHover = parseInt(btn.dataset.value, 10);
  paintRatePopupStars();
});
ratePopupStars.addEventListener('mouseleave', () => { ratePopupHover = 0; paintRatePopupStars(); });
ratePopupStars.addEventListener('click', (e) => {
  const btn = e.target.closest('.rate-popup-star');
  if(!btn) return;
  ratePopupSelected = parseInt(btn.dataset.value, 10);
  ratePopupSubmit.disabled = false;
  paintRatePopupStars();
});

function closeRatePopup(){
  ratePopupOverlay.classList.remove('open');
  document.body.style.overflow = '';
}
document.getElementById('rate-popup-close').addEventListener('click', closeRatePopup);
ratePopupOverlay.addEventListener('click', (e) => { if(e.target === ratePopupOverlay) closeRatePopup(); });
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && ratePopupOverlay.classList.contains('open')) closeRatePopup();
});

async function openRatePopup(slug, name){
  ratePopupSlug = slug;
  ratePopupSelected = 0;
  ratePopupHover = 0;
  ratePopupTitle.textContent = name;
  ratePopupNotice.textContent = '';
  ratePopupNotice.classList.remove('show');
  ratePopupSubmit.disabled = true;
  ratePopupSubmit.textContent = 'Gönder';
  paintRatePopupStars();
  ratePopupOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  // Daha önce puanladıysa popup açılışında kendi puanını görsün — oturum kapalıyken loadMyRatings()
  // sessizce boş bir Map döner (bkz. rating-widget.js).
  try{
    const mine = await loadMyRatings();
    if(ratePopupSlug !== slug) return; // bu arada başka bir satır açılmışsa bayat sonucu ATLA
    const val = mine.get('project:' + slug);
    if(val){ ratePopupSelected = val; ratePopupSubmit.disabled = false; paintRatePopupStars(); }
  }catch(e){}
}

async function submitTop100Rating(slug, stars){
  return fetch('/api/ratings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetType: 'project', targetId: slug, stars }),
  });
}

// Hızlı oy verince puan/oy sayısı VE listedeki sıra anında güncellensin diye /api/public/top100
// (önbelleksiz) yeniden çekilip TÜM liste tazelenir — aktif filtre/sıralama seçimleri korunur (bkz.
// en-iyi-100.html#refreshTop100AfterRating İLE AYNI gerekçe: tek bir satırın istemci tarafında elle
// yeniden hesaplanması diğer 99 satırın güncel puanını bilmediğinden güvenilir değil).
function refreshTop100AfterRating(){
  myRatingsPromise = null;
  top100LoadPromise = null;
  loadTop100().then(() => { if(top100ViewActive) render(); });
}

function paintRatedTop100Stars(){
  if(typeof loadMyRatings !== 'function') return;
  loadMyRatings().then(mine => {
    document.querySelectorAll('.top100-rate-btn').forEach(btn => {
      const slug = btn.dataset.slug;
      if(!slug) return;
      const rated = mine.get('project:' + slug);
      const icon = btn.querySelector('svg');
      if(!icon) return;
      if(rated && !icon.classList.contains('top100-rate-icon-filled')) icon.outerHTML = ICON_STAR_FILLED;
      else if(!rated && icon.classList.contains('top100-rate-icon-filled')) icon.outerHTML = ICON_STAR;
    });
  }).catch(() => {});
}

// bkz. en-iyi-100.html#ensureAuthModal İLE AYNI gerekçe — AuthModal büyük (118KB) olduğundan proje.html
// da js/components/lazy-modals.js ile TEMBEL yükler (bkz. o dosya), doğrudan <script> etiketi yok.
function ensureAuthModal(cb){
  if(window.AuthModal){ cb(window.AuthModal); return; }
  const s = document.createElement('script');
  s.src = 'js/components/auth-modal.js';
  s.onload = () => cb(window.AuthModal);
  document.head.appendChild(s);
}

ratePopupSubmit.addEventListener('click', async () => {
  if(!ratePopupSelected || !ratePopupSlug) return;
  const slug = ratePopupSlug, stars = ratePopupSelected;
  ratePopupSubmit.disabled = true;
  ratePopupSubmit.textContent = 'Gönderiliyor…';
  let res;
  try{
    res = await submitTop100Rating(slug, stars);
  }catch(e){
    ratePopupNotice.textContent = 'Sunucuya ulaşılamadı, lütfen tekrar dene.';
    ratePopupNotice.classList.add('show');
    ratePopupSubmit.disabled = false;
    ratePopupSubmit.textContent = 'Gönder';
    return;
  }
  if(res.status === 401){
    // Kişi hesabına girmeden Gönder'e bastı — puanı kuyruğa al, giriş popup'ını aç (bkz. kullanıcı
    // isteği, en-iyi-100.html'deki AYNI davranış). Giriş/Üye Ol başarılı olduğunda auth-nav.js'in
    // yaydığı 'mimarlab:authchange' bu puanı otomatik gönderip listeyi tazeler.
    try{ sessionStorage.setItem(PENDING_TOP100_RATING_KEY, JSON.stringify({ slug, stars })); }catch(e){}
    closeRatePopup();
    ensureAuthModal(Modal => { if(Modal) Modal.open('login'); });
    return;
  }
  if(res.ok){
    try{ sessionStorage.removeItem(PENDING_TOP100_RATING_KEY); }catch(e){}
    closeRatePopup();
    refreshTop100AfterRating();
  } else {
    ratePopupNotice.textContent = 'Puan gönderilemedi, lütfen tekrar dene.';
    ratePopupNotice.classList.add('show');
    ratePopupSubmit.disabled = false;
    ratePopupSubmit.textContent = 'Gönder';
  }
});

function trySubmitPendingTop100Rating(){
  let raw;
  try{ raw = sessionStorage.getItem(PENDING_TOP100_RATING_KEY); }catch(e){ raw = null; }
  if(!raw) return;
  let pending;
  try{ pending = JSON.parse(raw); }catch(e){ pending = null; }
  if(!pending || !pending.slug || !pending.stars) return;
  try{ sessionStorage.removeItem(PENDING_TOP100_RATING_KEY); }catch(e){}
  submitTop100Rating(pending.slug, pending.stars).then(res => { if(res.ok) refreshTop100AfterRating(); }).catch(() => {});
}
window.addEventListener('mimarlab:authchange', trySubmitPendingTop100Rating);
// Sayfa AÇILIŞINDA da kontrol edilir — Google/LinkedIn ile giriş next=%2F... üzerinden sayfayı
// YENİDEN yüklediğinden, o akışta 'mimarlab:authchange' bu sayfada YAKALANAMAZ (bkz. en-iyi-100.html
// İLE AYNI gerekçe).
if(typeof savedWidgetReady !== 'undefined'){
  savedWidgetReady.then(() => { if(currentUser) trySubmitPendingTop100Rating(); });
}

// render() — normal (Liste) görünümde /api/projects'ten yalnızca mevcut sayfanın kartlarını çeker
// (bkz. kullanıcı isteği: "Her sayfa geçişinde sadece o sayfadaki proje verisini çek ve render et"),
// En İyi 100 sekmesi aktifken (top100ViewActive) İSE TOP100_ITEMS'ı (bkz. loadTop100, tek seferlik,
// tüm liste hafızada) sol filtre çubuğu/arama/sıralama ile istemci tarafında filtreleyip AYNI
// PAGE_SIZE'lık sayfalara böler — iki dal da AYNI renderCards()/renderPagination()/renderActiveChips()
// paylaşılan yardımcılarını kullanır, yalnızca veri kaynağı değişir.
let renderRequestId = 0;
async function render(){
  const myRequest = ++renderRequestId;
  const grid = document.getElementById('card-grid');
  const top100List = document.getElementById('top100-list');
  const empty = document.getElementById('empty-state');
  grid.style.opacity = '0.5';
  top100List.style.opacity = '0.5';

  if(top100ViewActive){
    await loadTop100();
    if(myRequest !== renderRequestId) return; // bu arada başka bir render() tetiklendi, bu yanıt bayat
    top100List.style.opacity = '1';
    const filtered = (TOP100_ITEMS || []).filter(it => passesTop100ActiveFilters(it) && passesTop100Search(it));
    const sorted = sortTop100Items(filtered);
    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    if(currentPage > totalPages) currentPage = totalPages;
    const pageItems = sorted.slice((currentPage - 1) * PAGE_SIZE, (currentPage - 1) * PAGE_SIZE + PAGE_SIZE);
    document.getElementById('result-count').textContent = `${sorted.length} proje listeleniyor`;
    renderActiveChips();
    renderPagination(totalPages);
    currentItems = pageItems;
    if(pageItems.length === 0){ top100List.innerHTML=''; empty.textContent = 'Bu kritere uyan proje bulunamadı.'; empty.style.display='block'; return; }
    empty.style.display = 'none';
    renderTop100Rows(pageItems);
    return;
  }

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

  currentItems = data.items;
  refreshMap();

  if(data.items.length === 0){ grid.innerHTML=''; empty.textContent = 'Bu kritere uyan proje bulunamadı.'; empty.style.display='block'; return; }
  empty.style.display = 'none';
  renderCards(data.items);
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

// ---------- LİSTE / HARİTA GÖRÜNÜM TOGGLE'I ----------
// bkz. kullanıcı isteği: Harita seçilince Sıralama dropdown'ı, aktif filtre chip'leri, kart ızgarası
// ve sayfalama gizlenip yerine tüm alanı kaplayan, o anki filtrelenmiş listedeki koordinatlı
// projeler için pin'ler taşıyan gerçek bir Leaflet + Esri World Imagery uydu haritası gelir (bkz.
// syncMapMarkers); sol Filtreler kenar çubuğu (bkz. .grid-sidebar, bu blok İÇİNDE değil) hiç
// dokunulmadan yerinde kalır. Leaflet CSS/JS'i yalnızca Harita İLK kez açıldığında dinamik eklenir
// (bkz. project-modal.js#loadMapForCurrentItem İLE AYNI gecikmeli-yükleme deseni) — Liste/Harita
// arasında ileri geri geçişte tekrar tekrar yeniden istenmez; sonraki her render() (filtre/sayfa
// değişimi) ise syncMapMarkers ile marker'ları senkron tutar.
(function wireViewToggle() {
  const toggleWrap = document.getElementById('view-toggle');
  const listBtn = document.getElementById('view-toggle-list');
  const mapBtn = document.getElementById('view-toggle-map');
  const top100Btn = document.getElementById('view-toggle-top100');
  const sortWrap = document.getElementById('sort-select-wrap');
  const mapWrap = document.getElementById('map-view-wrap');
  const toggledEls = [
    document.getElementById('active-chips'),
    document.getElementById('empty-state'),
    document.getElementById('pagination'),
  ].filter(Boolean);
  const cardGridEl = document.getElementById('card-grid');
  const top100ListEl = document.getElementById('top100-list');
  if (!listBtn || !mapBtn || !top100Btn || !sortWrap || !mapWrap) return;

  let mapLoaded = false;
  // contentSource: Harita SIRASINDA DEĞİŞMEZ — Harita, altındaki Liste/Top100 verisinin üstüne
  // bindirilen bağımsız bir görünüm (bkz. aşağıdaki mapWrap/toggledEls). gerçek bulgu: bu ayrım
  // olmadan top100ViewActive'i doğrudan (view==='top100') olarak hesaplamak, Harita'ya her
  // geçişte top100ViewActive'i SESSİZCE false'a düşürüyordu — En İyi 100'deyken Harita'ya
  // gidip bir filtre değiştirip Liste/En İyi 100'e dönmek grid'i yanlış veri kaynağıyla
  // (top100 yerine sunucu Liste sonucuyla) doldurmuş oluyordu.
  let contentSource = 'list';
  function setView(view) {
    const isMap = view === 'map';
    if (!isMap) contentSource = view;
    const isTop100 = contentSource === 'top100';
    mapViewActive = isMap;
    top100ViewActive = isTop100;
    listBtn.classList.toggle('active', !isMap && contentSource === 'list');
    mapBtn.classList.toggle('active', isMap);
    top100Btn.classList.toggle('active', !isMap && isTop100);
    // Varsayılan DOM/görsel sırası En İyi 100, Harita, Liste (bkz. kullanıcı isteği: "Liste ve
    // Harita başlıklarının soluna En İyi 100 başlığını ekle") — hangi sekme aktifse o sekme, mevcut
    // Harita/Liste ikilisindeki AYNI kalıpla (bkz. proje.html#.view-toggle.is-map-view/.is-top100-view),
    // Sıralama'nın hemen soluna (en sağa) kayar.
    if (toggleWrap) {
      toggleWrap.classList.toggle('is-map-view', isMap);
      toggleWrap.classList.toggle('is-top100-view', isTop100 && !isMap);
    }
    sortWrap.style.display = isMap ? 'none' : '';
    mapWrap.style.display = isMap ? '' : 'none';
    // #card-grid (Liste) ve #top100-list (En İyi 100) ARTIK ayrı elemanlar (bkz. kullanıcı isteği:
    // top100 satırları en-iyi-100.html'in .top100-list tasarımıyla bire bir aynı olsun) — hangisinin
    // görünür olacağı burada AÇIKÇA hesaplanır, aşağıdaki toggledEls'in dataset-cache'li restore
    // deseninden BİLEREK dışarıda tutulur (o desen yalnızca "map açıkken sakla, kapanınca geri getir"
    // için doğru; iki farklı görünüm arasında geçişte pmPrevDisplay bayat bir değeri yanlışlıkla geri
    // yazabilirdi, bkz. gerçek bulgu).
    if (cardGridEl) cardGridEl.style.display = (!isMap && !isTop100) ? '' : 'none';
    if (top100ListEl) top100ListEl.style.display = (!isMap && isTop100) ? '' : 'none';
    // render()'ın kendi mantığı (bkz. yukarısı: empty.style.display='block'/'none') her filtre/sayfa
    // değişiminde bu elemanların display'ini BAĞIMSIZ olarak yönetiyor — Harita'ya geçerken önceki
    // inline değeri kaydedip Liste'ye dönüldüğünde AYNEN geri koymak, render()'ı burada taklit etmeye
    // ya da yeniden tetiklemeye gerek bırakmaz (gerçek bulgu: koşulsuz 'block' geri yazmak, sonucu
    // gerçekten boş olan bir filtrede boş-durum kutusunu Liste'ye dönünce YANLIŞLIKLA açardı).
    toggledEls.forEach(el => {
      if (isMap) {
        if (el.style.display !== 'none') el.dataset.pmPrevDisplay = el.style.display;
        el.style.display = 'none';
      } else {
        el.style.display = el.dataset.pmPrevDisplay || '';
      }
    });
    if (isMap && !mapLoaded) {
      mapLoaded = true;
      loadLeaflet().then((L) => {
        leafletMap = L.map(mapWrap).setView([39.0, 35.0], 6);
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
          attribution: 'Tiles &copy; Esri',
          maxZoom: 19,
        }).addTo(leafletMap);
        // Uydu görüntüsünün üstüne il/ilçe/yerleşim adlarını çizen hibrit etiket katmanı (bkz.
        // kullanıcı isteği: hibrit uydu haritası varsayılan) — proje-ekle.html/project-modal.js İLE AYNI.
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 19,
        }).addTo(leafletMap);
        refreshMap();
      });
    } else if (isMap) {
      // Harita zaten kuruluydu (bkz. yukarıdaki mapLoaded) — Liste'deyken filtre değişmiş olabileceği
      // için (render() harita GÖRÜNMÜYORKEN refreshMap() içinde no-op'a düşer, bkz. mapViewActive
      // koruması) her Harita'ya dönüşte taze veriyle yeniden çekilir.
      refreshMap();
    } else {
      // Liste/En İyi 100'e her geçişte (Harita'dan dönüş dahil) yeniden çizilir. Harita<->Liste'nin
      // ESKİ "grid'i olduğu gibi bırak" kısayolu artık güvenli DEĞİL: iki ayrı veri kaynağı var
      // (sunucudan sayfalanmış /api/projects <-> istemcide filtrelenmiş TOP100_ITEMS alt kümesi,
      // bkz. render()) ve Harita GÖRÜNÜRKEN de filtre değişebiliyor (render() her filtre/sıralama
      // değişiminde view'dan bağımsız tetiklenir, bkz. checkbox/g-sort dinleyicileri) — grid'in o an
      // hangi kaynaktan dolu olduğu görünmeyen Harita sekmesindeyken bile top100ViewActive'in GÜNCEL
      // değerine göre değişir, bu yüzden her Liste/Top100 gösteriminde taze bir render() ile
      // garanti altına alınır (küçük bir ek istek/hesap maliyeti karşılığında doğruluk).
      render();
    }
  }
  listBtn.addEventListener('click', () => setView('list'));
  mapBtn.addEventListener('click', () => setView('map'));
  top100Btn.addEventListener('click', () => setView('top100'));
})();

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
  if (!m) return;
  // bkz. proje.html <head>'deki pm-boot-loading senkron script'i AYNI gerçek bulgu — o script ilk
  // boyamadan önce çıplak SSR içeriğini bir "boot veil" (blur/karartma) ile örttü; ProjectModal.open()
  // artık renderItem()/renderNotFound() tamamlanana kadar çözülmeyen bir Promise döndürüyor (bkz. o
  // dosyadaki değişiklik), bu yüzden GERÇEK modal tam opak açılana kadar veil kaldırılmaz — aradaki
  // hiçbir noktada çıplak içerik bir an bile görünmez.
  // gerçek bulgu (kullanıcı isteği: veil'in ASLA sonsuza kadar takılı kalmaması gerekiyor): defer
  // script bir ağ hatasıyla (reklam engelleyici, CDN sorunu) hiç yüklenmezse ProjectModal tanımsız
  // kalır ve .open(...) çağrısı SENKRON olarak fırlar — .finally() zincirine hiç ulaşılmadan veil
  // sonsuza dek sayfayı kaplı bırakırdı (orijinal bozuk-flash'tan DAHA KÖTÜ bir regresyon). try/catch
  // + 8sn'lik savunma amaçlı zaman aşımı, bu köşe durumunda bile veil'in kalkmasını garanti eder.
  const clearBootVeil = () => document.documentElement.classList.remove('pm-boot-loading');
  const bootVeilSafety = setTimeout(clearBootVeil, 8000);
  try {
    ProjectModal.open(decodeURIComponent(m[1]), { pushHistory:false }).finally(() => {
      clearTimeout(bootVeilSafety);
      clearBootVeil();
    });
  } catch (e) {
    clearTimeout(bootVeilSafety);
    clearBootVeil();
  }
});

// wireNavSearch() ve hamburger menü artık js/components/site-chrome.js tarafından merkezi olarak
// çalıştırılıyor (bkz. kullanıcı isteği: üst/alt menü tüm sayfalarda tek kaynaktan güncellensin).
