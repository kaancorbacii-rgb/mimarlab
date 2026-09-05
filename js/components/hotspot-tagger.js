// HotspotTagger — proje galerisinin büyütülmüş görselinde "Ürün Etiketle" akışının form tarafı
// (kullanıcı isteği, 2026-09-05 madde 5). Marka sahibi görselde ürünün olduğu noktaya dokunur,
// burası o noktaya bir form açar ve seçilen ürünü POST /api/hotspot-tags ile ONAY KUYRUĞUNA yollar.
//
// ÖNEMLİ: bu modül hiçbir zaman doğrudan bir işaretçi ÇİZMEZ. Yayındaki işaretçilerin tek kaynağı
// projects.image_hotspots'tur (bkz. migrations/0076) ve oraya yalnızca onaydan geçen öneriler
// yazılır (bkz. src/routes/hotspotTags.js). Admin'in gönderdiği etiketleme sunucuda anında
// uygulanır; kullanıcı sayfayı yenilediğinde işaretçiyi görür.
//
// Yetki İSTEMCİDE sorulmaz: butona basan herkese form açılır, ürün listesi sunucudan gelir ve
// sunucu yalnızca kullanıcının kendi ürünlerini döner (admin'e hepsi). Etiketlenebilir ürünü
// olmayan hesap boş liste yerine açıklayıcı bir mesaj görür. Böylece "buton her görselde gözüksün"
// isteği, yetki kararını istemciye taşımadan karşılanır.
const HotspotTagger = (function () {
  // Bu modül proje.html/en-iyi-100.html/kisi.html/index.html gibi farklı sayfalarda çalışır;
  // escapeHtml/escapeAttr globalleri her birinde tanımlı OLMAYABİLİR (bkz. proje notu:
  // proje-ekle.html'de escapeHtml yok). Bu yüzden kendi yerel kaçışlayıcısını taşır.
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function injectStyles() {
    if (document.getElementById('hotspot-tagger-styles')) return;
    const style = document.createElement('style');
    style.id = 'hotspot-tagger-styles';
    // DİKKAT: bu şablon dizesinde ters tırnak ya da // yorumu KULLANMA (bkz. proje notu
    // [[feedback_no_backtick_in_style_template_literals]]).
    style.textContent = `
      .ht-form{
        position:absolute; z-index:6; width:290px; max-width:calc(100vw - 28px);
        background:var(--paper-card, #fff); color:var(--ink, #1B2A3D);
        border-radius:14px; padding:14px; box-shadow:0 18px 44px rgba(15,19,26,0.4);
        font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        text-align:left;
      }
      .ht-form h4{margin:0 0 4px; font-size:14px; font-weight:700;}
      .ht-form .ht-sub{margin:0 0 10px; font-size:11.5px; line-height:1.45; color:var(--ink-soft, #6B7280);}
      .ht-ac{position:relative;}
      .ht-form input[type="text"]{
        width:100%; box-sizing:border-box; height:36px; padding:0 10px; font-size:13px;
        border:1px solid var(--line, #E2E0DB); border-radius:8px;
        background:var(--paper, #fff); color:inherit; font-family:inherit;
      }
      .ht-ac-list{
        position:absolute; left:0; right:0; top:40px; z-index:2; max-height:200px; overflow-y:auto;
        background:var(--paper-card, #fff); border:1px solid var(--line, #E2E0DB); border-radius:8px;
        box-shadow:0 10px 26px rgba(15,19,26,0.2);
      }
      .ht-ac-list button{
        display:flex; align-items:center; gap:9px; width:100%; padding:8px 10px; border:none;
        background:none; text-align:left; font-size:12.5px; font-family:inherit; color:inherit; cursor:pointer;
      }
      .ht-ac-list button:hover{background:var(--paper-alt, #F2F1EE);}
      .ht-ac-list img{width:30px; height:30px; border-radius:6px; object-fit:contain; flex:0 0 30px; background:var(--paper-alt, #F2F1EE);}
      .ht-ac-sub{display:block; font-size:11px; color:var(--ink-soft, #6B7280);}
      .ht-msg{margin:9px 0 0; font-size:11.5px; line-height:1.45;}
      .ht-msg.err{color:#B84C4C;}
      .ht-msg.ok{color:var(--walnut, #8A6A4B);}
      .ht-actions{display:flex; gap:8px; margin-top:11px;}
      .ht-actions button{
        flex:1; height:34px; border-radius:8px; font-size:12.5px; font-weight:600;
        font-family:inherit; cursor:pointer; border:1px solid var(--line, #E2E0DB);
      }
      .ht-actions .ht-save{background:var(--ink, #1B2A3D); color:var(--paper-card, #fff); border-color:transparent;}
      .ht-actions .ht-save[disabled]{opacity:0.6; cursor:default;}
      .ht-actions .ht-cancel{background:none; color:inherit;}
      /* Formun bagli oldugu nokta — kullanici tam olarak nereyi isaretledigini gorsun. */
      .ht-pin{
        position:absolute; z-index:5; width:22px; height:22px; margin:-11px 0 0 -11px;
        border-radius:50%; border:2.5px solid #fff; background:var(--accent, #E08A3E);
        box-shadow:0 2px 10px rgba(15,19,26,0.45); pointer-events:none;
      }
      @media (max-width:560px){
        .ht-form{width:min(300px, calc(100vw - 24px)); padding:12px;}
      }
    `;
    document.head.appendChild(style);
  }

  let openForm = null;
  let openPin = null;

  function close() {
    if (openForm) { openForm.remove(); openForm = null; }
    if (openPin) { openPin.remove(); openPin = null; }
  }

  // Formu tıklanan noktanın yanına koyar ve host'un (lightbox) DIŞINA taşmayacak şekilde çevirir —
  // js/components/image-hotspots.js#placeCard ile AYNI mantık, ama burada host her zaman lightbox
  // (position:fixed, tam ekran) olduğundan sınırlar doğrudan host'un kutusudur.
  function place(hostEl, el, px, py) {
    const hw = hostEl.clientWidth, hh = hostEl.clientHeight;
    const fw = el.offsetWidth, fh = el.offsetHeight;
    const GAP = 18;
    let left = px + GAP;
    if (left + fw > hw - 8) left = px - GAP - fw;
    left = Math.max(8, Math.min(left, Math.max(8, hw - fw - 8)));
    let top = py - fh / 2;
    top = Math.max(8, Math.min(top, Math.max(8, hh - fh - 8)));
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }

  // opts: { hostEl, projectSlug, imageUrl, x, y } — x/y GÖRSELE göre yüzde (bkz. gallery.js'teki
  // hesaplama), form konumu ise host'a göre px olduğundan görselin boyandığı dikdörtgenden çevrilir.
  function open(opts) {
    injectStyles();
    close();
    const hostEl = opts.hostEl;
    const imgEl = hostEl.querySelector('img');
    if (!hostEl || !imgEl) return;

    const rect = imgEl.getBoundingClientRect();
    const hostRect = hostEl.getBoundingClientRect();
    const px = (rect.left - hostRect.left) + (opts.x / 100) * rect.width;
    const py = (rect.top - hostRect.top) + (opts.y / 100) * rect.height;

    openPin = document.createElement('div');
    openPin.className = 'ht-pin';
    openPin.style.left = px + 'px';
    openPin.style.top = py + 'px';
    hostEl.appendChild(openPin);

    const form = document.createElement('div');
    form.className = 'ht-form';
    form.innerHTML = `
      <h4>Ürün Etiketle</h4>
      <p class="ht-sub">Bu noktadaki ürünü seç. Etiketlemen marka sahibinin ve yöneticinin onayına gider; onaylanınca projede işaretçi olarak görünür.</p>
      <div class="ht-ac"><input type="text" placeholder="Ürün adı yaz ve listeden seç" autocomplete="off"></div>
      <p class="ht-msg" hidden></p>
      <div class="ht-actions">
        <button type="button" class="ht-save">Gönder</button>
        <button type="button" class="ht-cancel">Vazgeç</button>
      </div>`;
    hostEl.appendChild(form);
    openForm = form;
    // Formun İÇİNDEKİ tıklamalar host'un (lightbox) "boşluğa tıklandı, kapat" dinleyicisine kadar
    // kabarmamalı — bkz. proje-ekle.html#openHotspotForm'daki AYNI gerçek bulgu: öneri listesindeki
    // bir seçenek kendi handler'ında DOM'dan kaldırıldığı için kabarma sırasında e.target kopuk bir
    // düğüm oluyor ve `closest('.ht-form')` koruması null dönüyor. Dinleyiciyi formun KENDİSİNE
    // koymak bu tuzağı yapısal olarak kapatır (olay yolu gönderim anında hesaplanır).
    form.addEventListener('click', (e) => e.stopPropagation());
    // Zorlanmış reflow: offsetWidth/offsetHeight ölçümü place() için taze olsun.
    void form.offsetHeight;
    place(hostEl, form, px, py);

    const input = form.querySelector('input[type="text"]');
    const msgEl = form.querySelector('.ht-msg');
    const saveBtn = form.querySelector('.ht-save');
    const acWrap = form.querySelector('.ht-ac');
    const showMsg = (text, kind) => {
      msgEl.textContent = text || '';
      msgEl.hidden = !text;
      msgEl.className = 'ht-msg' + (kind ? ' ' + kind : '');
    };

    let chosen = null;
    let acList = null, acTimer = null;
    function closeAc() { if (acList) { acList.remove(); acList = null; } }

    async function search(q) {
      closeAc();
      let data = null;
      try {
        const res = await fetch(`/api/hotspot-tags/my-products?q=${encodeURIComponent(q)}`);
        if (res.status === 401) { showMsg('Ürün etiketlemek için giriş yapmalısın.', 'err'); return; }
        if (!res.ok) return;
        data = await res.json();
      } catch { return; }
      const items = data.items || [];
      if (!items.length) {
        // Sorgu boşken hiç ürün dönmemesi "bu hesabın etiketleyebileceği ürün yok" demektir;
        // sorguyla dönmemesi ise sadece "eşleşme yok".
        showMsg(q
          ? 'Bu aramaya uyan ürünün yok.'
          : 'Etiketleyebileceğin bir ürün bulunamadı. Yalnızca sahiplendiğin ürünleri ya da marka profiline bağlı ürünleri işaretleyebilirsin.', 'err');
        return;
      }
      showMsg('');
      if (!openForm) return;
      acList = document.createElement('div');
      acList.className = 'ht-ac-list';
      acList.innerHTML = items.map(it => `
        <button type="button" data-slug="${esc(it.slug)}" data-title="${esc(it.title)}">
          ${it.image ? `<img src="${esc(typeof cdnImg === 'function' ? cdnImg(it.image, 120) : it.image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
          <span>${esc(it.title)}${it.brand ? `<span class="ht-ac-sub">${esc(it.brand)}</span>` : ''}</span>
        </button>`).join('');
      acWrap.appendChild(acList);
      acList.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          chosen = { slug: btn.dataset.slug, title: btn.dataset.title };
          input.value = btn.dataset.title;
          showMsg('');
          closeAc();
        });
      });
    }

    input.addEventListener('input', () => {
      // Elle yazılan her değişiklik seçimi geçersizleştirir — kutudaki metin ile gerçekten
      // gönderilen slug asla ayrışmasın (bkz. proje-ekle.html#openHotspotForm'daki AYNI kural).
      chosen = null;
      showMsg('');
      clearTimeout(acTimer);
      const q = input.value.trim();
      acTimer = setTimeout(() => search(q), 220);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeAc(); } });
    // Açılışta (sorgusuz) listeyi doldur — marka sahibinin ürün sayısı genelde az, hemen görsün.
    search('');
    input.focus();

    saveBtn.addEventListener('click', async () => {
      if (!chosen) { input.focus(); showMsg('Listeden bir ürün seç.', 'err'); return; }
      saveBtn.disabled = true;
      const original = saveBtn.textContent;
      saveBtn.textContent = 'Gönderiliyor…';
      try {
        const res = await fetch('/api/hotspot-tags', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectSlug: opts.projectSlug, imageUrl: opts.imageUrl,
            x: opts.x, y: opts.y, productSlug: chosen.slug,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showMsg(data.error || 'Etiketleme gönderilemedi.', 'err');
          saveBtn.disabled = false; saveBtn.textContent = original;
          return;
        }
        // Admin'de sunucu etiketlemeyi ANINDA uygular (kullanıcı isteği) — mesaj bu iki durumu
        // ayırır, aksi halde admin "onay bekliyor" sanırdı.
        showMsg(data.status === 'approved'
          ? 'Etiketleme eklendi. Sayfayı yenilediğinde işaretçi görünecek.'
          : 'Etiketlemen onaya gönderildi. Onaylandığında projede görünür olacak.', 'ok');
        input.disabled = true;
        saveBtn.remove();
        form.querySelector('.ht-cancel').textContent = 'Kapat';
      } catch {
        showMsg('Sunucuya ulaşılamadı, tekrar dene.', 'err');
        saveBtn.disabled = false; saveBtn.textContent = original;
      }
    });
    form.querySelector('.ht-cancel').addEventListener('click', close);
  }

  return { open, close };
})();
