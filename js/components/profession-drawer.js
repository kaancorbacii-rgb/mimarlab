// Meslek alanını "çekmece" (açılır panel) hâline getirir — kullanıcı isteği (2026-09-02):
// "Üye ol ve profilini düzenle ekranında meslek kısmı çekmece şeklinde açılsın."
//
// TASARIM KARARI: mevcut onay kutuları DOM'DA AYNEN KALIR, yalnızca açılır bir panelin içine
// sarılır. Böylece bu alanı okuyan tüm mevcut kod (uye-ol.html ve js/components/auth-modal.js'teki
// `querySelectorAll('input[name="profession"]:checked')` çağrıları) hiç değişmeden çalışmaya devam
// eder — checkbox'ları özel bir bileşenle DEĞİŞTİRMEK, gönderim/doldurma mantığının her iki
// kopyasını da yeniden yazmayı gerektirirdi ve sessiz bir regresyon riski taşırdı.
//
// Görsel dil kisi-ekle.html#dd-meslek ile aynı (buton + ok + panel), ama CSS'i kendi içinde
// taşır: uye-ol.html o sayfanın dd-* kurallarını içermiyor.
(function () {
  function injectStyles() {
    if (document.getElementById('profession-drawer-styles')) return;
    const el = document.createElement('style');
    el.id = 'profession-drawer-styles';
    el.textContent = [
      '.pdrawer{position:relative;}',
      /* kisi-ekle.html#.dd-btn ile birebir aynı ölçüler. */
      '.pdrawer-btn{width:100%; display:flex; align-items:center; justify-content:space-between; gap:8px;',
      '  padding:11px 14px; border-radius:10px; border:1px solid var(--line); background:var(--paper);',
      '  font-family:inherit; font-size:14px; color:var(--ink); cursor:pointer; text-align:left;}',
      '.pdrawer-btn:hover{border-color:var(--brass);}',
      '.pdrawer-btn[aria-expanded="true"]{border-color:var(--brass);}',
      '.pdrawer-btn-label{overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}',
      '.pdrawer-btn-label.is-placeholder{color:var(--ink-soft);}',
      '.pdrawer-arrow{flex:0 0 auto; transition:transform .18s ease;}',
      '.pdrawer-btn[aria-expanded="true"] .pdrawer-arrow{transform:rotate(180deg);}',
      /* KULLANICI BİLDİRİMİ (2026-09-02): panel eskiden SATIR İÇİ idi (margin-top + normal akış),
         yani açılınca formun geri kalanını aşağı itiyordu. kisi-ekle.html#dd-meslek ise ÜSTTE
         açılan yüzen bir pencere. İstenen "kişi ekle sayfasındakiyle aynı açılır pencere"
         davranışı buydu — aşağıdaki değerler kisi-ekle.html#.dd-panel ile BİREBİR aynı
         (position/top/z-index/radius/shadow/padding/max-height). */
      '.pdrawer-panel{display:none; flex-direction:column; position:absolute; top:calc(100% + 6px);',
      '  left:0; right:0; z-index:25; background:var(--paper-card); border:1px solid var(--line);',
      '  border-radius:12px; box-shadow:0 12px 28px rgba(27,42,61,0.15); padding:8px;',
      '  max-height:280px; overflow-y:auto;}',
      '.pdrawer-panel.open{display:flex;}',
      /* İçerideki mevcut onay kutusu grubu — dikey listeye çevrilir. */
      '.pdrawer-panel .auth-check-group, .pdrawer-panel .am-check-group{display:flex; flex-direction:column; gap:2px;}',
      '.pdrawer-panel label{display:flex; align-items:center; gap:8px; padding:5px 2px; font-size:13px; cursor:pointer;}',
    ].join('\n');
    document.head.appendChild(el);
  }

  // group: onay kutularını taşıyan mevcut konteyner (#signup-profession / #am-edit-profession).
  function mount(group, opts) {
    if (!group || group.dataset.pdrawerBound) return;
    group.dataset.pdrawerBound = '1';
    injectStyles();
    const placeholder = (opts && opts.placeholder) || 'Meslek seç';

    const wrap = document.createElement('div');
    wrap.className = 'pdrawer';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pdrawer-btn';
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span class="pdrawer-btn-label"></span>'
      + '<svg class="pdrawer-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';
    const panel = document.createElement('div');
    panel.className = 'pdrawer-panel';

    group.parentNode.insertBefore(wrap, group);
    wrap.appendChild(btn);
    wrap.appendChild(panel);
    panel.appendChild(group); // grubu OLDUĞU GİBİ panelin içine taşı

    const label = btn.querySelector('.pdrawer-btn-label');
    function boxes() { return group.querySelectorAll('input[type="checkbox"]'); }
    function syncLabel() {
      const picked = [...boxes()].filter(b => b.checked)
        .map(b => (b.parentElement && b.parentElement.textContent || '').trim());
      label.textContent = picked.length ? picked.join(', ') : placeholder;
      label.classList.toggle('is-placeholder', !picked.length);
      label.title = picked.join(', ');
    }
    function setOpen(open) {
      panel.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    btn.addEventListener('click', (e) => { e.preventDefault(); setOpen(!panel.classList.contains('open')); });
    group.addEventListener('change', syncLabel);
    // Dışarı tıklayınca kapan — panel açıkken formun geri kalanı görünür kalsın.
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) setOpen(false); });
    // Seçimler JS ile doldurulduğunda (Profili Düzenle) `change` tetiklenmez; dışarıdan çağrılabilsin.
    wrap.refresh = syncLabel;
    group._pdrawerRefresh = syncLabel;
    syncLabel();
  }

  window.ProfessionDrawer = { mount: mount };
})();
