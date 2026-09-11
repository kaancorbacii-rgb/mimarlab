// ÇOKLU KONUM SEÇİCİ — firma-ekle.html / marka-ekle.html "Ofis / Mağaza Konumları" (kullanıcı isteği,
// 2026-09-11: "aynı proje ekle sayfasında olduğu gibi firma ve markalar ofislerinin ya da
// mağazalarının bulunduğu konumları seçsinler. Birden fazla konum seçebilirler.").
//
// proje-ekle.html'deki TEK noktalı seçicinin (Leaflet + Esri uydu/etiket karoları + aynı-origin
// /api/geocode proxy'si, bkz. src/routes/geocode.js) çoklu karşılığı. İki form sayfası birbirinin
// kopyası olduğundan seçici bir kez burada yazıldı; sayfalar yalnızca mount/get/set çağırır.
// Değer biçimi: [{lat,lng,label?}] — sunucu tarafı src/lib/submissionTypes.js#sanitizeOfficeLocations
// ile yeniden süzer, burada gönderilen hiçbir şeye güvenilmez.
(function () {
  const ESRI_WORLD_IMAGERY_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const ESRI_LABELS_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
  const TURKEY_CENTER = [39.0, 35.0];
  // src/lib/submissionTypes.js#MAX_OFFICE_LOCATIONS ile AYNI tavan.
  const MAX_POINTS = 20;

  // bkz. js/components/office-modal.js#loadOmMapLeaflet — belge genelinde TEK paylaşılan yükleyici
  // (window.__mimarlabLeafletPromise), iki modül aynı anda isterse Leaflet iki kez indirilmez.
  function loadLeaflet() {
    if (window.__mimarlabLeafletPromise) return window.__mimarlabLeafletPromise;
    window.__mimarlabLeafletPromise = new Promise((resolve, reject) => {
      if (window.L) { resolve(window.L); return; }
      if (!document.getElementById('mimarlab-leaflet-css')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.id = 'mimarlab-leaflet-css';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => resolve(window.L);
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return window.__mimarlabLeafletPromise;
  }

  // NOT: bu şablon literal'inde ters tırnak, blok yorum sonu ya da çift eğik çizgi OLMAMALI —
  // enjekte edilen CSS'i sessizce bozar (bkz. depo notu).
  function injectStyles() {
    if (document.getElementById('location-picker-styles')) return;
    const style = document.createElement('style');
    style.id = 'location-picker-styles';
    style.textContent = `
      .mlp-search-row{position:relative; display:flex; gap:8px;}
      .mlp-search-row input[type=text]{flex:1; min-width:0;}
      .mlp-search-btn{flex-shrink:0; background:var(--ink); color:var(--paper-card); border:none; border-radius:10px; padding:0 18px; font-weight:600; font-size:13px; white-space:nowrap; cursor:pointer;}
      .mlp-search-btn:hover{background:var(--walnut);}
      .mlp-search-btn:disabled{opacity:0.6; cursor:default;}
      .mlp-results{display:none; position:absolute; top:calc(100% + 4px); left:0; right:74px; z-index:1001; background:var(--paper-card); border:1px solid var(--line); border-radius:10px; box-shadow:0 12px 28px rgba(27,42,61,0.15); max-height:220px; overflow-y:auto; padding:6px;}
      .mlp-results.show{display:block;}
      .mlp-result{padding:8px 10px; border-radius:8px; font-size:13.5px; color:var(--ink); cursor:pointer; line-height:1.4;}
      .mlp-result:hover{background:var(--paper-alt);}
      .mlp-result-empty{cursor:default; color:var(--ink-soft);}
      .mlp-map{position:relative; z-index:0; height:320px; margin-top:10px; border-radius:12px; overflow:hidden; border:1px solid var(--line); background:var(--paper-alt);}
      .mlp-map .leaflet-container{width:100%; height:100%; font-family:inherit; cursor:crosshair;}
      .mlp-map-error{display:flex; align-items:center; justify-content:center; height:100%; padding:16px; text-align:center; font-size:13px; color:var(--ink-soft);}
      .mlp-list{list-style:none; margin:10px 0 0; padding:0; display:flex; flex-direction:column; gap:6px;}
      .mlp-item{display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid var(--line); border-radius:10px; background:var(--paper-card); font-size:13.5px; color:var(--ink);}
      .mlp-num{width:22px; height:22px; border-radius:50%; flex-shrink:0; display:flex; align-items:center; justify-content:center; background:var(--ink); color:var(--paper-card); font-size:11.5px; font-weight:700;}
      .mlp-label{flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
      .mlp-remove{flex-shrink:0; background:none; border:1px solid var(--line); border-radius:8px; padding:4px 10px; font-size:12.5px; color:var(--ink-soft); cursor:pointer;}
      .mlp-remove:hover{border-color:var(--ink); color:var(--ink);}
      .mlp-limit{margin-top:6px; font-size:12.5px; color:var(--ink-soft);}
      .leaflet-tooltip.mlp-tip{background:var(--ink); color:#fff; border:none; border-radius:10px; padding:1px 7px; font-size:11px; font-weight:700; box-shadow:none;}
      .leaflet-tooltip.mlp-tip::before{display:none;}
      @media (max-width:640px){ .mlp-map{height:260px;} }
    `;
    document.head.appendChild(style);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  // Nominatim display_name'i ("Sokak, Mahalle, İlçe, İl, Bölge, Posta Kodu, Türkiye") listede
  // okunur kalsın diye ilk dört parçaya indirilir.
  function shortName(displayName) {
    return String(displayName || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 4).join(', ');
  }
  function labelFromReverse(data) {
    const a = (data && data.address) || {};
    const parts = [];
    [a.road, a.neighbourhood || a.suburb || a.quarter, a.town || a.county || a.city_district || a.district, a.state || a.province || a.city]
      .forEach(p => { if (p && !parts.includes(p)) parts.push(p); });
    return parts.length ? parts.join(', ') : shortName(data && data.display_name);
  }

  // root: boş bir <div>. opts.onGeocode(address): her işaretlenen/sürüklenen noktanın ters jeokod
  // adresiyle çağrılır (sayfa İl/İlçe'yi doldurmak için kullanır).
  function mount(root, opts) {
    if (!root) return null;
    opts = opts || {};
    injectStyles();
    root.innerHTML = `
      <div class="mlp-search-row">
        <input type="text" class="mlp-search-input" placeholder="Adres, semt ya da ilçe ara..." autocomplete="off">
        <button type="button" class="mlp-search-btn">Ara</button>
        <div class="mlp-results"></div>
      </div>
      <div class="mlp-map"></div>
      <ol class="mlp-list" style="display:none;"></ol>
      <div class="mlp-limit" style="display:none;">En fazla ${MAX_POINTS} konum eklenebilir.</div>`;
    const input = root.querySelector('.mlp-search-input');
    const btn = root.querySelector('.mlp-search-btn');
    const results = root.querySelector('.mlp-results');
    const mapEl = root.querySelector('.mlp-map');
    const listEl = root.querySelector('.mlp-list');
    const limitEl = root.querySelector('.mlp-limit');

    let points = [];
    let map = null;
    let layer = null;
    let searchToken = 0;

    function renderList() {
      listEl.innerHTML = points.map((p, i) => `
        <li class="mlp-item">
          <span class="mlp-num">${i + 1}</span>
          <span class="mlp-label" title="${esc(p.label)}">${esc(p.label || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`)}</span>
          <button type="button" class="mlp-remove" data-i="${i}">Kaldır</button>
        </li>`).join('');
      listEl.style.display = points.length ? '' : 'none';
      limitEl.style.display = points.length >= MAX_POINTS ? '' : 'none';
      listEl.querySelectorAll('.mlp-remove').forEach(b => b.addEventListener('click', () => remove(Number(b.dataset.i))));
    }

    function drawMarkers(fit) {
      if (!map) return;
      const L = window.L;
      layer.clearLayers();
      points.forEach((p, i) => {
        const marker = L.marker([p.lat, p.lng], { draggable: true, title: p.label || '' });
        marker.bindTooltip(String(i + 1), { permanent: true, direction: 'top', offset: [0, -34], className: 'mlp-tip' });
        marker.on('dragend', () => {
          const pos = marker.getLatLng();
          p.lat = pos.lat;
          p.lng = pos.lng;
          p.label = ''; // yeni yerin adresi ters jeokodla gelecek
          renderList();
          geocode(p);
        });
        layer.addLayer(marker);
      });
      if (fit && points.length) {
        if (points.length === 1) map.setView([points[0].lat, points[0].lng], Math.max(map.getZoom(), 14));
        else map.fitBounds(L.latLngBounds(points.map(p => [p.lat, p.lng])), { padding: [30, 30], maxZoom: 15 });
      }
    }

    // Nominatim kullanım politikası gereği yalnızca nokta eklenince/sürüklenince TEK istek. Yanıt
    // dönene kadar nokta silinmiş ya da yeniden sürüklenmişse sonuç sessizce atılır.
    async function geocode(p) {
      const token = p.geoToken = (p.geoToken || 0) + 1;
      try {
        const res = await fetch(`/api/geocode/reverse?lat=${p.lat}&lon=${p.lng}`);
        if (!res.ok) return;
        const data = await res.json();
        if (p.geoToken !== token || !points.includes(p)) return;
        if (!p.label) {
          p.label = labelFromReverse(data);
          renderList();
        }
        if (typeof opts.onGeocode === 'function' && data && data.address) opts.onGeocode(data.address);
      } catch { /* adres opsiyonel — nokta koordinatla kalır */ }
    }

    function add(lat, lng, label, fit) {
      lat = Number(lat);
      lng = Number(lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      if (points.length >= MAX_POINTS) { renderList(); return; }
      const p = { lat, lng, label: label || '' };
      points.push(p);
      renderList();
      drawMarkers(!!fit);
      geocode(p);
    }

    function remove(i) {
      points.splice(i, 1);
      renderList();
      drawMarkers(false);
    }

    function set(list) {
      points = (Array.isArray(list) ? list : [])
        .map(p => ({ lat: Number(p && p.lat), lng: Number(p && p.lng), label: (p && typeof p.label === 'string') ? p.label : '' }))
        .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
        .slice(0, MAX_POINTS);
      renderList();
      drawMarkers(true);
    }

    function get() {
      return points.map(p => {
        const out = { lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 };
        if (p.label) out.label = p.label;
        return out;
      });
    }

    async function runSearch() {
      const q = input.value.trim();
      if (!q) { results.classList.remove('show'); return; }
      const token = ++searchToken;
      btn.disabled = true;
      try {
        const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(q)}`);
        if (token !== searchToken) return;
        const list = res.ok ? await res.json() : [];
        results.innerHTML = (Array.isArray(list) && list.length)
          ? list.map((r, i) => `<div class="mlp-result" data-i="${i}">${esc(r.display_name)}</div>`).join('')
          : '<div class="mlp-result mlp-result-empty">Sonuç bulunamadı</div>';
        results.classList.add('show');
        results.querySelectorAll('[data-i]').forEach(el => {
          el.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const r = list[Number(el.dataset.i)];
            add(parseFloat(r.lat), parseFloat(r.lon), shortName(r.display_name), true);
            results.classList.remove('show');
            input.value = '';
          });
        });
      } catch {
        results.classList.remove('show');
      } finally {
        if (token === searchToken) btn.disabled = false;
      }
    }
    btn.addEventListener('click', runSearch);
    // Enter formu GÖNDERMEMELİ — yalnızca aramayı çalıştırır.
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } });
    input.addEventListener('blur', () => setTimeout(() => results.classList.remove('show'), 150));

    loadLeaflet().then((L) => {
      L.Icon.Default.imagePath = 'https://unpkg.com/leaflet@1.9.4/dist/images/';
      map = L.map(mapEl, { attributionControl: false }).setView(TURKEY_CENTER, 6);
      L.tileLayer(ESRI_WORLD_IMAGERY_URL, { attribution: 'Tiles &copy; Esri', maxZoom: 19 }).addTo(map);
      L.tileLayer(ESRI_LABELS_URL, { maxZoom: 19 }).addTo(map);
      layer = L.layerGroup().addTo(map);
      map.on('click', (e) => add(e.latlng.lat, e.latlng.lng, '', false));
      drawMarkers(true); // harita gelmeden set() ile doldurulmuş noktalar
      setTimeout(() => map.invalidateSize(), 0);
    }).catch(() => {
      mapEl.innerHTML = '<div class="mlp-map-error">Harita yüklenemedi — sayfayı yenileyip tekrar dene. Eklenmiş konumlar korunur.</div>';
    });

    renderList();
    return { get, set };
  }

  window.MultiLocationPicker = { mount };
})();
