// DuplicateNameCheck — proje-ekle.html/kisi-ekle.html/firma-ekle.html/urun-ekle.html'in Proje/
// Mimar/Firma/Ürün Adı kutusuna bağlanır (bkz. kullanıcı isteği: "daha önce siteye yüklenen
// projelerle aynı isimde proje yüklenemesin ... kutu kırmızıya dönsün ve 'Bu proje zaten
// yayınlandı' uyarısı versin"; ikinci istek: uyarının yanında altı çizili "Projeye git./Ürüne
// git./Mimara git./Firmaya git." linki). GET /api/public/check-name (bkz. src/routes/public.js#
// handlePublicCheckName) ile TR-duyarlı TAM isim eşleşmesi arar ve eşleşen kaydın detay linkini
// döner; yalnızca istemci tarafı uyarı içindir — asıl yetkili engelleme createSubmission'da
// sunucu tarafında yapılır (bkz. src/lib/canonicalSync.js#isDuplicateCanonicalName), bu yüzden
// burası ağ hatasında sessizce geçebilir.
const DuplicateNameCheck = (function () {
  const LINK_LABELS = {
    projects: 'Projeye git.',
    // Kullanıcı isteği (2026-09-02): kişi/firma/marka formlarında uyarı tam olarak
    // "Bu profil zaten yüklü, profile git." okunmalı — "profile git." altı çizili bağlantıdır.
    architects: 'profile git.',
    offices: 'profile git.',
    products: 'Ürüne git.',
    materials: 'Ürüne git.',
  };

  // Sahiplenme popup'ının tip başına metinleri. marka-ekle.html de `offices` tipini kullanır
  // (marka, offices tablosunda bir satırdır — bkz. office-kind.js), bu yüzden başlık formun
  // kendi `claimTitle` seçeneğiyle geçersiz kılınabilir; verilmezse buradaki firma metni geçerlidir.
  const CLAIM_CFG = {
    architects: { profileType: 'architect', title: 'Bu profil sana mı ait?', noun: 'profil' },
    offices: { profileType: 'office', title: 'Bu firma sana mı ait?', noun: 'firma' },
  };

  function foldTr(s) {
    return (s || '')
      .replace(/İ/g, 'i').replace(/I/g, 'ı').replace(/Ş/g, 'ş').replace(/Ğ/g, 'ğ').replace(/Ü/g, 'ü').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç')
      .toLowerCase()
      .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o');
  }

  function injectStyles() {
    if (document.getElementById('dup-name-check-styles')) return;
    const style = document.createElement('style');
    style.id = 'dup-name-check-styles';
    style.textContent = `
      .dup-name-warning{display:none; font-size:11.5px; color:#B84C4C; margin-top:5px; line-height:1.5;}
      .dup-name-warning.show{display:block;}
      .dup-name-warning-link{color:#B84C4C; text-decoration:underline; font-weight:600; margin-left:4px;}
      .dup-name-warning-link:hover{color:#8f3838;}
      /* "bu profili sahiplen." — uyarının ikinci bağlantısı (kullanıcı isteği, 2026-09-10 madde 3).
         <a href> DEĞİL <button>: sayfa değiştirmez, aynı sekmede sahiplenme popup'ını açar. Görsel
         olarak diğer bağlantıyla birebir aynı görünmesi için buton varsayılanları sıfırlanır. */
      .dup-name-warning-claim{color:#B84C4C; text-decoration:underline; font-weight:600; margin-left:4px;
        background:none; border:0; padding:0; font:inherit; cursor:pointer;}
      .dup-name-warning-claim:hover{color:#8f3838;}
      .form-field input.dup-name-input-error{border-color:#B84C4C !important; background:rgba(184,76,76,0.06) !important;}
    `;
    document.head.appendChild(style);
  }

  // opts: { input, type, message, brandInput, getExclude, getExcludeBrand }
  // - input: proje/mimar/firma/ürün adı <input>
  // - type: 'projects'|'architects'|'offices'|'products'|'materials', YA DA bunu döndüren bir
  //   fonksiyon — urun-ekle.html'de Ürün/Malzeme tek formda birleştiğinden (bkz. kullanıcı isteği)
  //   tür, gönderim anında seçili kategoriden (CATALOG_CATEGORY_KIND) hesaplanır, sabit değildir.
  // - brandInput: yalnızca products/materials — Firma <input> (doğal anahtar marka+başlık ikilisi)
  // - getExclude()/getExcludeBrand(): düzenleme modunda kaydın YÜKLENDİĞİ ANDAKİ orijinal ad/marka
  //   değerini döner — kendi kaydını çakışma saymamak için (bkz. handlePublicCheckName#exclude).
  function attach(opts) {
    injectStyles();
    const { input, type: typeOpt, message, brandInput, getExclude, getExcludeBrand } = opts;
    const getType = typeof typeOpt === 'function' ? typeOpt : () => typeOpt;
    const hint = document.createElement('div');
    hint.className = 'dup-name-warning';
    const msgSpan = document.createElement('span');
    msgSpan.textContent = message;
    const link = document.createElement('a');
    link.className = 'dup-name-warning-link';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.style.display = 'none';
    // "bu profili sahiplen." — yalnızca kişi/firma/marka formlarında ve profilin ONAYLI bir sahibi
    // YOKKEN gösterilir (bkz. src/routes/public.js#handlePublicCheckName -> claimed). Kullanıcı
    // formu doldurmaya devam etmek zorunda kalmasın diye: aynı isimde bir profil zaten varsa
    // yapılacak doğru şey yeni kayıt açmak değil, var olanı sahiplenmektir.
    const claimBtn = document.createElement('button');
    claimBtn.type = 'button';
    claimBtn.className = 'dup-name-warning-claim';
    claimBtn.textContent = 'bu profili sahiplen.';
    claimBtn.style.display = 'none';
    hint.appendChild(msgSpan);
    hint.appendChild(link);
    hint.appendChild(claimBtn);
    input.insertAdjacentElement('afterend', hint);

    claimBtn.addEventListener('click', () => {
      const cfg = CLAIM_CFG[getType()];
      // MLClaimPopup js/components/preview-cards.js'ten gelir; o script yüklenmemişse (bir sayfa
      // onu dahil etmeyi unutursa) buton hiç gösterilmez — bkz. setError.
      if (!cfg || !claimKey || !window.MLClaimPopup) return;
      window.MLClaimPopup.open({
        profileType: cfg.profileType,
        profileKey: claimKey,
        title: opts.claimTitle || cfg.title,
        description: claimKey + ' — bu ' + (opts.claimNoun || cfg.noun) + ' MİMARLAB\'da zaten kayıtlı. Sahibiysen yeni bir kayıt açmak yerine talep gönder; onaylandığında mevcut profili düzenleyebilirsin.',
      });
    });

    let duplicate = false;
    let debounceTimer = null;
    let requestSeq = 0;
    // Eşleşen kaydın CANONICAL adı — sahiplenme talebinin anahtarı (bkz. src/routes/public.js#
    // handlePublicCheckName'in `name` alanı). Slug DEĞİL: profile_claims.profile_key'in tek kabul
    // edilen biçimi canonical addır (bkz. src/lib/canonicalRead.js#resolveCanonicalName).
    let claimKey = '';

    function clearError() {
      duplicate = false;
      claimKey = '';
      input.classList.remove('dup-name-input-error');
      hint.classList.remove('show');
      link.style.display = 'none';
      link.removeAttribute('href');
      claimBtn.style.display = 'none';
    }
    function setError(href, data) {
      duplicate = true;
      input.classList.add('dup-name-input-error');
      hint.classList.add('show');
      claimKey = (data && data.name) || '';
      const canClaim = !!CLAIM_CFG[getType()] && !!claimKey && !(data && data.claimed) && !!window.MLClaimPopup;
      claimBtn.style.display = canClaim ? '' : 'none';
      // href boşsa (bkz. handlePublicCheckName — eşleşen kayıt hidden_at'lı, detay sayfası zaten
      // "bulunamadı" gösterir) kırık bir linke yönlendirmektense link hiç gösterilmez.
      if (href) {
        link.href = href;
        link.textContent = LINK_LABELS[getType()] || '';
        link.style.display = '';
      } else {
        link.style.display = 'none';
        link.removeAttribute('href');
      }
    }

    async function check() {
      const type = getType();
      const name = input.value.trim();
      if (!name) { clearError(); return; }
      const exclude = (getExclude ? getExclude() : '') || '';
      const brand = brandInput ? brandInput.value.trim() : '';
      if ((type === 'products' || type === 'materials') && !brand) { clearError(); return; }
      if (exclude && foldTr(name) === foldTr(exclude)) {
        const excludeBrand = (getExcludeBrand ? getExcludeBrand() : '') || '';
        if (type !== 'products' && type !== 'materials') { clearError(); return; }
        if (excludeBrand && foldTr(brand) === foldTr(excludeBrand)) { clearError(); return; }
      }
      const params = new URLSearchParams({ type, name });
      if (brand) params.set('brand', brand);
      if (exclude) params.set('exclude', exclude);
      const excludeBrand = getExcludeBrand ? getExcludeBrand() : '';
      if (excludeBrand) params.set('excludeBrand', excludeBrand);
      const seq = ++requestSeq;
      try {
        const res = await fetch('/api/public/check-name?' + params.toString());
        if (!res.ok) return;
        const data = await res.json();
        if (seq !== requestSeq) return; // eskimiş yanıt (daha yeni bir tuş vuruşu araya girdi)
        if (data.exists) setError(data.href, data); else clearError();
      } catch (e) { /* sessizce geç — asıl engelleme sunucu tarafında (bkz. dosya başı yorumu) */ }
    }

    function scheduleCheck() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(check, 450);
    }

    input.addEventListener('input', scheduleCheck);
    input.addEventListener('blur', check);
    if (brandInput) {
      brandInput.addEventListener('input', scheduleCheck);
      brandInput.addEventListener('blur', check);
    }

    return { isDuplicate: () => duplicate };
  }

  return { attach };
})();
