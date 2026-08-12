// DuplicateNameCheck — proje-ekle.html/mimar-ekle.html/firma-ekle.html/urun-ekle.html'in Proje/
// Mimar/Firma/Ürün Adı kutusuna bağlanır (bkz. kullanıcı isteği: "daha önce siteye yüklenen
// projelerle aynı isimde proje yüklenemesin ... kutu kırmızıya dönsün ve 'Bu proje zaten
// yayınlandı' uyarısı versin"). GET /api/public/check-name (bkz. src/routes/public.js#
// handlePublicCheckName) ile TR-duyarlı TAM isim eşleşmesi arar; yalnızca istemci tarafı uyarı
// içindir — asıl yetkili engelleme createSubmission'da sunucu tarafında yapılır (bkz.
// src/lib/canonicalSync.js#isDuplicateCanonicalName), bu yüzden burası ağ hatasında sessizce
// geçebilir.
const DuplicateNameCheck = (function () {
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
      .form-field input.dup-name-input-error{border-color:#B84C4C !important; background:rgba(184,76,76,0.06) !important;}
    `;
    document.head.appendChild(style);
  }

  // opts: { input, type, message, brandInput, getExclude, getExcludeBrand }
  // - input: proje/mimar/firma/ürün adı <input>
  // - type: 'projects'|'architects'|'offices'|'products'|'materials', YA DA bunu döndüren bir
  //   fonksiyon — urun-ekle.html'de Ürün/Malzeme tek formda birleştiğinden (bkz. kullanıcı isteği)
  //   tür, gönderim anında seçili Grup'tan (CATALOG_GROUP_KIND) hesaplanır, sabit değildir.
  // - brandInput: yalnızca products/materials — Firma <input> (doğal anahtar marka+başlık ikilisi)
  // - getExclude()/getExcludeBrand(): düzenleme modunda kaydın YÜKLENDİĞİ ANDAKİ orijinal ad/marka
  //   değerini döner — kendi kaydını çakışma saymamak için (bkz. handlePublicCheckName#exclude).
  function attach(opts) {
    injectStyles();
    const { input, type: typeOpt, message, brandInput, getExclude, getExcludeBrand } = opts;
    const getType = typeof typeOpt === 'function' ? typeOpt : () => typeOpt;
    const hint = document.createElement('div');
    hint.className = 'dup-name-warning';
    hint.textContent = message;
    input.insertAdjacentElement('afterend', hint);

    let duplicate = false;
    let debounceTimer = null;
    let requestSeq = 0;

    function clearError() {
      duplicate = false;
      input.classList.remove('dup-name-input-error');
      hint.classList.remove('show');
    }
    function setError() {
      duplicate = true;
      input.classList.add('dup-name-input-error');
      hint.classList.add('show');
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
        if (data.exists) setError(); else clearError();
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
