// PhotoClaimer — proje galerisinin büyütülmüş görselinde "Fotoğraf bana ait" akışının form tarafı
// (kullanıcı isteği, 2026-09-16 ikinci tur madde 2: "Proje popuplarındaki lightboxta 'Fotoğraf bana
// ait' butonu olsun ve bu butona tıklayınca görseldeki ismin değişmesi için firma yöneticilerine ve
// admine bildirim gitsin. Firma yöneticileri veya admin bildirimi onaylarsa fotoğrafçı bilgisi
// lightboxa ve proje künyesine eklensin.").
//
// js/components/hotspot-tagger.js'in KARDEŞİDİR ve onun desenini birebir izler: aynı hasAccess()
// önbelleği, aynı open/close sözleşmesi, formu host'un (lightbox) İÇİNE mount etme, aynı
// konumlandırma matematiği. Ayrı bir modül olmasının gerekçesi: burada seçilen şey bir ÜRÜN değil
// künyeye yazılacak bir AD, ve form bir noktaya değil GÖRSELİN KENDİSİNE bağlı (işaretçi yok).
//
// ÖNEMLİ: bu modül künyeye HİÇBİR ŞEY yazmaz. Yayındaki fotoğrafçı bilgisinin tek kaynağı
// projects.photo_credit_text + projects.image_credits'tir ve oraya yalnızca onaydan geçen talepler
// yazılır (bkz. src/routes/photoClaims.js). Admin'in gönderdiği talep sunucuda anında uygulanır;
// kullanıcı sayfayı yenilediğinde adı görür.
//
// YETKİ: hasAccess() yalnızca butonun gösterilip gösterilmeyeceğini söyler (arayüz kararı) ve
// cevabı "giriş yapmış her kullanıcı için evet"tir. Gerçek kapı sunucudadır — istemci kodunu
// değiştirerek ne talep açılabilir ne de onaylanabilir.
const PhotoClaimer = (function () {
  // Bu modül proje.html/en-iyi-100.html/kisi.html/index.html gibi farklı sayfalarda çalışır;
  // escapeHtml/escapeAttr globalleri her birinde tanımlı OLMAYABİLİR (bkz. hotspot-tagger.js'teki
  // AYNI gerekçe). Bu yüzden kendi yerel kaçışlayıcısını taşır.
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function injectStyles() {
    if (document.getElementById('photo-claim-styles')) return;
    const style = document.createElement('style');
    style.id = 'photo-claim-styles';
    // DİKKAT: bu şablon dizesinde ters tırnak ya da // yorumu KULLANMA (bkz. proje notu
    // [[feedback_no_backtick_in_style_template_literals]] — enjekte edilen CSS sessizce bozulur).
    // Ölçüler .ht-form'dan birebir kopyalanır: iki form aynı lightbox'ta, aynı butonların
    // yanından açılıyor ve ayrışmış bir görünüm kullanıcıya iki farklı sistem gibi görünürdü.
    style.textContent = `
      .pc-form{
        position:absolute; z-index:6; width:310px; max-width:calc(100vw - 28px);
        background:var(--paper-card, #fff); color:var(--ink, #1B2A3D);
        border-radius:14px; padding:14px; box-shadow:0 18px 44px rgba(15,19,26,0.4);
        font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        text-align:left;
      }
      .pc-form h4{margin:0 0 4px; font-size:14px; font-weight:700;}
      .pc-form .pc-sub{margin:0 0 10px; font-size:11.5px; line-height:1.45; color:var(--ink-soft, #6B7280);}
      .pc-form label{display:block; font-size:11.5px; font-weight:600; margin:0 0 4px;}
      .pc-form input[type="text"], .pc-form textarea{
        width:100%; box-sizing:border-box; padding:0 10px; font-size:13px;
        border:1px solid var(--line, #E2E0DB); border-radius:8px;
        background:var(--paper, #fff); color:inherit; font-family:inherit;
      }
      .pc-form input[type="text"]{height:36px;}
      .pc-form textarea{height:58px; padding:8px 10px; resize:vertical; line-height:1.4;}
      .pc-scope{margin:10px 0 0; font-size:12px; line-height:1.5;}
      .pc-scope label{display:flex; align-items:flex-start; gap:7px; font-weight:500; margin:0 0 5px;}
      .pc-scope input[type="radio"]{margin:2px 0 0; flex:0 0 auto;}
      .pc-msg{margin:9px 0 0; font-size:11.5px; line-height:1.45;}
      .pc-msg.err{color:#B84C4C;}
      .pc-msg.ok{color:var(--walnut, #8A6A4B);}
      .pc-actions{display:flex; gap:8px; margin-top:11px;}
      .pc-actions button{
        flex:1; height:34px; border-radius:8px; font-size:12.5px; font-weight:600;
        font-family:inherit; cursor:pointer; border:1px solid var(--line, #E2E0DB);
      }
      .pc-actions .pc-save{background:var(--ink, #1B2A3D); color:var(--paper-card, #fff); border-color:transparent;}
      .pc-actions .pc-save[disabled]{opacity:0.6; cursor:default;}
      .pc-actions .pc-cancel{background:none; color:inherit;}
      @media (max-width:560px){
        .pc-form{width:min(310px, calc(100vw - 24px)); padding:12px;}
      }
    `;
    document.head.appendChild(style);
  }

  // "Bu ziyaretçiye 'Fotoğraf bana ait' butonu gösterilsin mi" — oturum başına TEK istek, sonuç
  // modül düzeyinde önbelleklenir (hotspot-tagger.js#hasAccess ile AYNI desen). Yanıt ayrıca
  // kullanıcının hesap adını taşır: form künyeye yazılacak adı onunla ÖNDEN DOLDURUR (alan
  // düzenlenebilir — hesap adı ile künyede görünmek istenen ad AYNI ŞEY DEĞİLDİR, bkz. CLAUDE.md
  // "Hesap üyeliği ile kişi profili AYRIDIR"). Hata/oturumsuz durumda `false` — butonu
  // göstermemek, basıldığında "giriş yapmalısın" demekten iyidir.
  let accessPromise = null;
  let defaultName = '';
  function hasAccess() {
    if (!accessPromise) {
      accessPromise = fetch('/api/photo-claims/access')
        .then(r => (r.ok ? r.json() : null))
        .then(d => {
          defaultName = (d && d.name) || '';
          return !!(d && d.canClaim);
        })
        .catch(() => false);
    }
    return accessPromise;
  }
  // Önbellek SAYFA YÜKLEMESİ başınadır ve bilerek geçersizleştirilmez: bu depoda oturum
  // değişimini yayınlayan bir olay YOK (auth-modal.js giriş/çıkışta sayfayı yeniliyor), yani
  // dinlenecek bir sinyal olmadığı hâlde bir dinleyici yazmak ölü kod olurdu.

  let openForm = null;

  function close() {
    if (openForm) { openForm.remove(); openForm = null; }
  }
  function isOpen() { return !!openForm; }

  // Formu görselin sağ/sol boşluğuna yerleştirir ve host'un (lightbox) DIŞINA taşmayacak şekilde
  // çevirir — hotspot-tagger.js#place ile AYNI mantık, ama burada çıpa bir nokta değil görselin
  // MERKEZİ (form tek bir kareye değil, karenin tamamına ait bir talebi taşıyor).
  function place(hostEl, el) {
    const hw = hostEl.clientWidth, hh = hostEl.clientHeight;
    const fw = el.offsetWidth, fh = el.offsetHeight;
    let left = Math.max(8, Math.round((hw - fw) / 2));
    let top = Math.max(8, Math.min(Math.round((hh - fh) / 2), Math.max(8, hh - fh - 8)));
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }

  // opts: { hostEl, projectSlug, imageUrl }
  function open(opts) {
    injectStyles();
    close();
    const hostEl = opts && opts.hostEl;
    if (!hostEl || !opts.projectSlug) return;

    const form = document.createElement('div');
    form.className = 'pc-form';
    // KAPSAM SEÇİMİ (iki radyo): tek bir kare mi, projenin fotoğraflarının tamamı mı. Sunucu bu
    // ayrımı imageUrl'in BOŞ olup olmamasıyla okur (bkz. migrations/0122'deki image_url notu) —
    // ikinci seçenek künyeye ekler ama hiçbir kareye bağlamaz. Görsel URL'si yoksa (galeri boş)
    // yalnızca ikinci seçenek anlamlıdır, o yüzden birinci seçenek hiç çizilmez.
    const hasImage = !!(opts.imageUrl);
    form.innerHTML = `
      <h4>Fotoğraf bana ait</h4>
      <p class="pc-sub">Künyeye yazılmasını istediğin adı gir. Talebin projenin firma yöneticilerine ve MİMARLAB yöneticilerine gider; onaylanınca ad hem büyütülmüş görselde hem proje künyesinde görünür.</p>
      <label for="pc-name-input">Künyedeki ad</label>
      <input type="text" id="pc-name-input" placeholder="Ad soyad ya da stüdyo adı" autocomplete="off" value="${esc(defaultName)}">
      <div class="pc-scope">
        ${hasImage ? `<label><input type="radio" name="pc-scope" value="image" checked><span>Yalnızca bu fotoğraf benim</span></label>` : ''}
        <label><input type="radio" name="pc-scope" value="all"${hasImage ? '' : ' checked'}><span>Bu projedeki fotoğrafların tamamı benim</span></label>
      </div>
      <p class="pc-msg" hidden></p>
      <div class="pc-actions">
        <button type="button" class="pc-save">Gönder</button>
        <button type="button" class="pc-cancel">Vazgeç</button>
      </div>`;
    hostEl.appendChild(form);
    openForm = form;
    // Formun İÇİNDEKİ tıklamalar host'un (lightbox) "boşluğa tıklandı, kapat" dinleyicisine kadar
    // kabarmamalı — hotspot-tagger.js'teki AYNI gerçek bulgu ve AYNI çözüm (dinleyici formun
    // KENDİSİNDE, `closest()` korumasında değil).
    form.addEventListener('click', (e) => e.stopPropagation());
    // Zorlanmış reflow: offsetWidth/offsetHeight ölçümü place() için taze olsun.
    void form.offsetHeight;
    place(hostEl, form);

    const input = form.querySelector('#pc-name-input');
    const msgEl = form.querySelector('.pc-msg');
    const saveBtn = form.querySelector('.pc-save');
    const showMsg = (text, kind) => {
      msgEl.textContent = text || '';
      msgEl.hidden = !text;
      msgEl.className = 'pc-msg' + (kind ? ' ' + kind : '');
    };
    // Escape kutunun içinde de formu kapatır, lightbox'ı değil (bkz. gallery.js'teki AYNI kapı).
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    input.focus();
    input.select();

    saveBtn.addEventListener('click', async () => {
      const name = input.value.trim();
      if (!name) { input.focus(); showMsg('Künyeye yazılacak adı gir.', 'err'); return; }
      const scopeEl = form.querySelector('input[name="pc-scope"]:checked');
      const wholeProject = !scopeEl || scopeEl.value === 'all';
      saveBtn.disabled = true;
      const original = saveBtn.textContent;
      saveBtn.textContent = 'Gönderiliyor…';
      try {
        const res = await fetch('/api/photo-claims', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectSlug: opts.projectSlug,
            // Boş imageUrl = "künyeye ekle, tek bir kareye bağlama" (bkz. yukarıdaki kapsam notu).
            imageUrl: wholeProject ? '' : (opts.imageUrl || ''),
            name,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showMsg(data.error || 'Talep gönderilemedi.', 'err');
          saveBtn.disabled = false; saveBtn.textContent = original;
          return;
        }
        // Admin'de sunucu talebi ANINDA uygular (bkz. src/routes/photoClaims.js#createClaim) —
        // mesaj bu iki durumu ayırır, aksi halde admin "onay bekliyor" sanırdı.
        showMsg(data.status === 'approved'
          ? 'Künyeye eklendi. Sayfayı yenilediğinde görünecek.'
          : 'Talebin onaya gönderildi. Onaylandığında künyede ve görselde görünecek.', 'ok');
        input.disabled = true;
        form.querySelectorAll('input[name="pc-scope"]').forEach(el => { el.disabled = true; });
        saveBtn.remove();
        form.querySelector('.pc-cancel').textContent = 'Kapat';
      } catch {
        showMsg('Sunucuya ulaşılamadı, tekrar dene.', 'err');
        saveBtn.disabled = false; saveBtn.textContent = original;
      }
    });
    form.querySelector('.pc-cancel').addEventListener('click', close);
  }

  return { open, close, isOpen, hasAccess };
})();
