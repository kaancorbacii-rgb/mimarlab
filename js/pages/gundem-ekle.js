// /gundem-ekle — Gündem içeriği ekle / düzenle (kullanıcı isteği, 2026-09-11).
//
// Sözleşme src/routes/gundemSubmit.js'te:
//   GET  /api/gundem-submissions/mine  → { profiles, items, categories, limits, userName }
//   GET  /api/gundem-submissions/:id   → { item, profiles, categories, limits }   (?edit=<id>)
//   POST /api/gundem-submissions       → yeni gönderi (status=pending)
//   PATCH/DELETE /api/gundem-submissions/:id
// Görseller MEVCUT yükleme hattından geçer (image-upload.js#buildUploadForm → /api/uploads) — yeni
// bir yükleme altyapısı YOK; türevler (w400/w800) aynı sözleşmeyle tarayıcıda üretilir.
(function(){
  'use strict';

  const MAX_IMAGES = 3;
  const TEXT_MAX = 1000;
  const TITLE_MAX = 140;
  const STATUS_LABELS = { pending: 'Onay bekliyor', published: 'Yayında', rejected: 'Reddedildi', archived: 'Arşivlendi' };

  const $ = (id) => document.getElementById(id);
  const form = $('ge-form');
  const loadingEl = $('ge-loading');
  const loginEl = $('ge-login');
  const catsEl = $('ge-cats');
  const profileEl = $('ge-profile');
  const headlineEl = $('ge-headline');
  const textEl = $('ge-text');
  const imagesEl = $('ge-images');
  const msgEl = $('ge-msg');
  const submitEl = $('ge-submit');
  const mineWrap = $('ge-mine');
  const mineList = $('ge-mine-list');

  const editId = new URLSearchParams(location.search).get('edit');
  // images: { url: string|null, preview: string, loading: bool }
  let images = [];
  let categories = [];
  let isAdmin = false;
  let editItem = null;

  function escapeHtml(s){ const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function escapeAttr(s){ return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function chars(s){ return [...(s || '')].length; }
  function thumb(url){ return (typeof cdnImg === 'function' && url && url.startsWith('/media/')) ? cdnImg(url, 400) : url; }
  function formatDate(ms){
    if(!ms) return '';
    try{ return new Date(ms).toLocaleDateString('tr-TR', { day:'numeric', month:'long', year:'numeric' }); }catch(e){ return ''; }
  }
  function setMsg(text, kind){
    msgEl.textContent = text || '';
    msgEl.className = 'ge-msg' + (kind ? ' ' + kind : '');
  }

  // ------------------------------------------------------------------ sayaçlar
  function updateCounts(){
    const t = chars(headlineEl.value);
    const x = chars(textEl.value);
    const hc = $('ge-headline-count');
    const tc = $('ge-text-count');
    hc.textContent = `${t} / ${TITLE_MAX}`;
    tc.textContent = `${x} / ${TEXT_MAX}`;
    hc.classList.toggle('over', t > TITLE_MAX);
    tc.classList.toggle('over', x > TEXT_MAX);
  }
  headlineEl.addEventListener('input', updateCounts);
  textEl.addEventListener('input', updateCounts);

  // ------------------------------------------------------------------ kategoriler + profil
  function renderCategories(selected){
    catsEl.innerHTML = categories.map((c, i) =>
      `<label class="ge-cat"><input type="radio" name="ge-category" value="${escapeAttr(c.key)}"${(selected ? selected === c.key : i === 0) ? ' checked' : ''}><span>${escapeHtml(c.label)}</span></label>`
    ).join('');
  }

  function renderProfiles(profiles, userName, current){
    const opts = [];
    const typeLabel = (t) => t === 'architect' ? 'Kişi' : 'Firma / Marka';
    (profiles || []).forEach(p => {
      const val = `${p.type}:${p.key}`;
      opts.push(`<option value="${escapeAttr(val)}">${escapeHtml(typeLabel(p.type) + ': ' + p.name)}</option>`);
    });
    opts.push(`<option value="">Kendi adıma${userName ? ' (' + escapeHtml(userName) + ')' : ''} — profilsiz</option>`);
    profileEl.innerHTML = opts.join('');
    if(current === null){
      profileEl.value = '';
    }else if(current){
      profileEl.value = `${current.type}:${current.key}`;
    }
    // Profil yoksa ipucu farklılaşır — içerik yalnızca Gündem'de görünür.
    $('ge-profile-hint').textContent = (profiles && profiles.length)
      ? 'Onaylanınca içerik seçtiğin profilin sayfasındaki Gündem bölümünde de görünür.'
      : 'Hesabına bağlı bir kişi/firma/marka profili yok — içerik yalnızca Gündem sayfasında, adınla yayınlanır.';
  }

  function selectedProfile(){
    const v = profileEl.value;
    if(!v) return null;
    const i = v.indexOf(':');
    return { type: v.slice(0, i), key: v.slice(i + 1) };
  }

  // ------------------------------------------------------------------ görseller
  function renderImages(){
    const cells = images.map((img, i) => `
      <div class="ge-img${img.loading ? ' loading' : ''}" data-i="${i}">
        ${img.preview ? `<img src="${escapeAttr(img.preview)}" alt="">` : ''}
        ${img.loading ? '' : `<div class="ge-img-tools">
          ${i > 0 ? `<button type="button" data-act="cover" data-i="${i}" title="Kapak yap">Kapak yap</button>` : ''}
          <button type="button" class="ge-img-remove" data-act="remove" data-i="${i}" aria-label="Görseli kaldır">×</button>
        </div>`}
        ${i === 0 && !img.loading ? '<span class="ge-cover-tag">Kapak</span>' : ''}
      </div>`);
    if(images.length < MAX_IMAGES){
      cells.push(`<label class="ge-add-img"><input type="file" id="ge-file" accept="image/jpeg,image/png,image/webp" multiple>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Görsel ekle</label>`);
    }
    imagesEl.innerHTML = cells.join('');
  }

  imagesEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if(!btn) return;
    e.preventDefault();
    const i = Number(btn.dataset.i);
    if(btn.dataset.act === 'remove') images.splice(i, 1);
    if(btn.dataset.act === 'cover'){ const [img] = images.splice(i, 1); images.unshift(img); }
    renderImages();
  });

  imagesEl.addEventListener('change', async (e) => {
    if(!e.target || e.target.id !== 'ge-file') return;
    const files = [...(e.target.files || [])].slice(0, MAX_IMAGES - images.length);
    if(!files.length) return;
    setMsg('');
    const slots = files.map(file => {
      const slot = { url: null, preview: URL.createObjectURL(file), loading: true };
      images.push(slot);
      return { slot, file };
    });
    renderImages();
    await Promise.all(slots.map(async ({ slot, file }) => {
      try{
        const body = (window.MimarlabUpload && window.MimarlabUpload.buildUploadForm)
          ? await window.MimarlabUpload.buildUploadForm(file, { context: 'gundem', maxEdge: 1600 })
          : (() => { const f = new FormData(); f.append('file', file); f.append('context', 'gundem'); return f; })();
        const res = await fetch('/api/uploads', { method: 'POST', body });
        const data = await res.json().catch(() => ({}));
        if(!res.ok || !data.url) throw new Error(data.error || 'Görsel yüklenemedi.');
        slot.url = data.url;
        slot.loading = false;
      }catch(err){
        images = images.filter(x => x !== slot);
        setMsg(err.message || 'Görsel yüklenemedi.', 'error');
      }
    }));
    renderImages();
  });

  // ------------------------------------------------------------------ gönder / kaydet
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if(images.some(i => i.loading)){ setMsg('Görseller yüklenirken bekle.', 'error'); return; }
    const cat = form.querySelector('input[name="ge-category"]:checked');
    const payload = {
      category: cat ? cat.value : '',
      title: headlineEl.value.trim(),
      text: textEl.value.trim(),
      images: images.map(i => i.url).filter(Boolean),
      profile: selectedProfile(),
    };
    if(!payload.category){ setMsg('Kategori seç.', 'error'); return; }
    if(chars(payload.title) < 3){ setMsg('Başlık yaz.', 'error'); headlineEl.focus(); return; }
    if(chars(payload.text) < 20){ setMsg('Metin en az 20 karakter olmalı.', 'error'); textEl.focus(); return; }
    if(chars(payload.text) > TEXT_MAX){ setMsg(`Metin en fazla ${TEXT_MAX} karakter olabilir.`, 'error'); textEl.focus(); return; }
    if(!payload.images.length){ setMsg('En az bir görsel ekle.', 'error'); return; }
    // Admin başkasının gönderisini düzenlerken gönderen korunur (sunucu da aynı kuralı uygular).
    if(editItem && profileEl.disabled) delete payload.profile;

    submitEl.disabled = true;
    setMsg(editItem ? 'Kaydediliyor…' : 'Gönderiliyor…');
    try{
      const res = await fetch(editItem ? '/api/gundem-submissions/' + encodeURIComponent(editItem.id) : '/api/gundem-submissions', {
        method: editItem ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if(res.status === 401){ showLogin(); return; }
      if(!res.ok){ setMsg(data.error || 'Gönderilemedi.', 'error'); return; }
      if(editItem){
        setMsg(data.status === 'pending' ? 'Kaydedildi. Düzenleme admin onayına gönderildi.' : 'Kaydedildi.', 'ok');
        editItem.status = data.status;
      }else{
        setMsg('Gönderildi! İçeriğin admin onayından sonra yayınlanacak.', 'ok');
        form.reset();
        images = [];
        renderImages();
        renderCategories();
        updateCounts();
      }
      loadMine();
    }catch(err){
      setMsg('Bağlantı hatası — tekrar dene.', 'error');
    }finally{
      submitEl.disabled = false;
    }
  });

  // ------------------------------------------------------------------ gönderilerim
  function mineRowHtml(it){
    const img = it.images && it.images[0];
    const cat = (categories.find(c => c.key === it.category) || {}).label || '';
    const view = it.status === 'published' ? `<a href="/gundem/${encodeURIComponent(it.slug)}">Görüntüle</a>` : '';
    return `<div class="ge-row" data-id="${escapeAttr(it.id)}">
      ${img ? `<img src="${escapeAttr(thumb(img))}" alt="" loading="lazy" decoding="async">` : ''}
      <div class="ge-row-main">
        <p class="ge-row-title">${escapeHtml(it.title)}</p>
        <div class="ge-row-meta">
          <span class="ge-status ${escapeAttr(it.status)}">${escapeHtml(STATUS_LABELS[it.status] || it.status)}</span>
          ${cat ? `<span>${escapeHtml(cat)}</span>` : ''}
          <span>${escapeHtml(it.submitterName || '')}</span>
          <span>${escapeHtml(formatDate(it.createdAt))}</span>
        </div>
      </div>
      <div class="ge-row-actions">
        ${view}
        <a href="/gundem-ekle?edit=${encodeURIComponent(it.id)}">Düzenle</a>
        <button type="button" class="danger" data-del="${escapeAttr(it.id)}">Sil</button>
      </div>
    </div>`;
  }

  async function loadMine(){
    try{
      const res = await fetch('/api/gundem-submissions/mine', { cache: 'no-store' });
      if(!res.ok) return null;
      const data = await res.json();
      const items = data.items || [];
      mineWrap.hidden = false;
      mineList.innerHTML = items.length
        ? items.map(mineRowHtml).join('')
        : '<div class="ge-empty">Henüz Gündem içeriği göndermedin.</div>';
      return data;
    }catch(e){ return null; }
  }

  mineList.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-del]');
    if(!btn) return;
    if(!confirm('Bu gönderi silinsin mi? Bu işlem geri alınamaz.')) return;
    btn.disabled = true;
    const res = await fetch('/api/gundem-submissions/' + encodeURIComponent(btn.dataset.del), { method: 'DELETE' });
    if(res.ok){
      if(editItem && editItem.id === btn.dataset.del){ location.href = '/gundem-ekle'; return; }
      loadMine();
    }else{
      btn.disabled = false;
      alert('Silinemedi.');
    }
  });

  // ------------------------------------------------------------------ başlangıç
  function showLogin(){
    loadingEl.hidden = true;
    form.hidden = true;
    mineWrap.hidden = true;
    loginEl.hidden = false;
  }

  async function init(){
    try{
      const me = window.__authMeFetch ? await window.__authMeFetch : null;
      isAdmin = !!(me && me.user && me.user.role === 'admin');
    }catch(e){ /* rol yalnızca buton metnini etkiler; yetki sunucuda */ }

    const mine = await loadMine();
    if(!mine){
      // 401 ya da ağ hatası — oturum yoksa giriş kutusu.
      const probe = await fetch('/api/gundem-submissions/mine', { cache: 'no-store' }).catch(() => null);
      if(probe && probe.status === 401){ showLogin(); return; }
      loadingEl.textContent = 'Sayfa şu an yüklenemedi. Lütfen birazdan tekrar dene.';
      return;
    }
    categories = (mine && mine.categories) || [
      { key: 'haber', label: 'Haber' }, { key: 'etkinlik', label: 'Etkinlik' }, { key: 'yarisma', label: 'Yarışma' },
    ];

    if(editId){
      const res = await fetch('/api/gundem-submissions/' + encodeURIComponent(editId), { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if(!res.ok || !data.item){
        loadingEl.textContent = 'Bu gönderi bulunamadı ya da düzenleme yetkin yok.';
        return;
      }
      editItem = data.item;
      $('ge-title').textContent = 'Gündem İçeriğini Düzenle';
      $('ge-crumb').textContent = 'Düzenle';
      document.title = 'Gündem İçeriğini Düzenle — MİMARLAB';
      $('ge-lead').textContent = STATUS_LABELS[editItem.status]
        ? `Durum: ${STATUS_LABELS[editItem.status]}.`
        : '';
      renderCategories(editItem.category);
      const ownsIt = mine && (mine.items || []).some(x => x.id === editItem.id);
      if(ownsIt){
        renderProfiles(data.profiles || mine.profiles, mine.userName, editItem.profile);
      }else{
        // Admin başkasının gönderisini düzenliyor: gönderen değiştirilemez.
        profileEl.innerHTML = `<option>${escapeHtml(editItem.submitterName || '—')}</option>`;
        profileEl.disabled = true;
        $('ge-profile-hint').textContent = 'Gönderen, düzenleme sırasında değiştirilemez.';
      }
      headlineEl.value = editItem.title || '';
      textEl.value = editItem.text || '';
      images = (editItem.images || []).map(u => ({ url: u, preview: thumb(u), loading: false }));
      submitEl.textContent = (isAdmin && !ownsIt) ? 'Kaydet' : 'Kaydet ve Onaya Gönder';
      $('ge-cancel').href = isAdmin && !ownsIt ? '/admin' : '/gundem-ekle';
    }else{
      renderCategories();
      renderProfiles(mine.profiles, mine.userName, undefined);
    }
    renderImages();
    updateCounts();
    loadingEl.hidden = true;
    form.hidden = false;
  }

  init();
})();
