// InfoModal — Rozet Al/İade Et/İletişim/Hakkında/Gizlilik Politikası/Hizmet Şartları/Kariyer'i
// satin-al.html/iade-et.html/iletisim.html/hakkinda.html/gizlilik-politikasi.html/
// hizmet-sartlari.html/kariyer.html'in kendi tasarımını BİREBİR koruyarak (bkz. kullanıcı isteği)
// js/components/modal-shell.js üzerinde bir popup'a dönüştürür — js/components/auth-modal.js ile
// AYNI open/swap/close/handlePopState state machine deseni (bkz. o dosyanın başındaki yorum,
// birebir aynı gerekçe). Yedi görünüm TEK bir ModalShell mount'unu paylaşır, tek sütun (32/68
// ızgara değil) — bkz. aşağıdaki .modal-shell-body.info-single kuralı, auth-modal.js'teki
// .am-single ile AYNI amaç ama dosyalar arası bağımlılık olmasın diye kendi sınıfı var.
// Her sayfada modal-shell.js + auth-modal.js'ten HEMEN SONRA <script defer> ile dahil edilir
// (Rozet Al/İade Et giriş gerektirir — bkz. wireRozetAl/wireIadeEt, AuthModal'a değil doğrudan
// /giris'e yönlendirir, orijinal sayfaların DAVRANIŞI birebir korunur).
const InfoModal = (function () {
  const VIEW_PATH = {
    'rozet-al': '/rozet-al', 'iade-et': '/iade-et', 'iletisim': '/iletisim', 'hakkinda': '/hakkinda',
    'gizlilik-politikasi': '/gizlilik-politikasi', 'hizmet-sartlari': '/hizmet-sartlari', 'kariyer': '/kariyer',
    'cerez-politikasi': '/cerez-politikasi',
  };
  const HREF_VIEW_RE = {
    'rozet-al': /(^|\/)satin-al\.html$/, 'iade-et': /(^|\/)iade-et\.html$/, 'iletisim': /(^|\/)iletisim\.html$/,
    'hakkinda': /(^|\/)hakkinda\.html$/, 'gizlilik-politikasi': /(^|\/)gizlilik-politikasi\.html$/,
    'hizmet-sartlari': /(^|\/)hizmet-sartlari\.html$/, 'kariyer': /(^|\/)kariyer\.html$/,
    'cerez-politikasi': /(^|\/)cerez-politikasi\.html$/,
  };

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s === undefined || s === null ? '' : s; return d.innerHTML; }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  // Yedi sayfanın "---------- CONTENT ----------" / "checkout-wrap" bölümlerinin BİREBİR kopyası
  // (bkz. o dosyalardaki <style> blokları) — yalnızca her kuralın başına #im-panel eklenerek
  // scope'landı (bkz. js/components/auth-modal.js#STYLES'teki AYNI teknik/gerekçe). Nav/breadcrumb/
  // footer stilleri host sayfada zaten yüklü olduğundan buraya kopyalanmadı.
  const STYLES = `
    #im-panel{ font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:var(--ink); }
    #im-panel .content-wrap{max-width:760px; margin:0 auto; padding:8px 4px 24px;}
    #im-panel .content-eyebrow{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:12px; letter-spacing:0.14em; text-transform:uppercase; color:var(--sage); font-weight:600; margin-bottom:12px;}
    #im-panel .content-title{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:clamp(28px, 4vw, 38px); font-weight:700; margin:0 0 18px; letter-spacing:-0.01em;}
    #im-panel .content-lead{font-size:16px; line-height:1.7; color:var(--ink-soft); margin:0 0 36px;}
    #im-panel .content-updated{font-size:12.5px; color:var(--ink-soft); margin:0 0 24px;}
    #im-panel .content-toc{background:var(--paper-card); border:1px solid var(--line); border-radius:14px; padding:20px 24px; margin:0 0 36px;}
    #im-panel .content-toc h2{font-size:14px; margin:0 0 10px;}
    #im-panel .content-toc ol{margin:0; padding-left:20px; font-size:13.5px; line-height:1.9; color:var(--ink-soft); columns:2; column-gap:24px;}
    #im-panel .content-toc a{color:var(--ink-soft); font-weight:500; cursor:pointer;}
    #im-panel .content-section{margin-bottom:32px;}
    #im-panel .content-section h2{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:19px; font-weight:700; margin:0 0 10px;}
    #im-panel .content-section p{font-size:14.5px; line-height:1.75; color:var(--ink-soft); margin:0 0 12px;}
    #im-panel .content-section a{color:var(--walnut); font-weight:600; cursor:pointer;}
    #im-panel .content-section a:hover{text-decoration:underline;}
    #im-panel .content-section ul{margin:0; padding-left:20px; font-size:14.5px; line-height:1.8; color:var(--ink-soft);}
    #im-panel .cookie-table-wrap{overflow-x:auto; margin:0 0 16px; border:1px solid var(--line); border-radius:12px;}
    #im-panel .cookie-table{width:100%; border-collapse:collapse; font-size:13px;}
    #im-panel .cookie-table th, #im-panel .cookie-table td{text-align:left; padding:10px 14px; border-bottom:1px solid var(--line); vertical-align:top;}
    #im-panel .cookie-table th{background:var(--paper-card); color:var(--ink); font-weight:700; white-space:nowrap;}
    #im-panel .cookie-table td{color:var(--ink-soft);}
    #im-panel .cookie-table tr:last-child td{border-bottom:none;}
    #im-panel .cookie-badge{display:inline-block; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:10.5px; text-transform:uppercase; letter-spacing:0.04em; background:var(--paper-alt); color:var(--ink); border-radius:100px; padding:3px 9px; white-space:nowrap;}

    #im-panel .contact-card{background:var(--paper-card); border:1px solid var(--line); border-radius:16px; padding:24px; margin-bottom:32px; display:flex; align-items:center; gap:16px;}
    #im-panel .contact-card svg{flex-shrink:0; color:var(--walnut);}
    #im-panel .contact-card-email{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:19px; font-weight:700;}
    #im-panel .contact-card-email:hover{text-decoration:underline;}
    #im-panel .contact-card p{margin:2px 0 0; font-size:12.5px; color:var(--ink-soft);}
    #im-panel .contact-form-field{margin-bottom:14px;}
    #im-panel .contact-form-field label{display:block; font-size:13px; font-weight:600; margin-bottom:6px;}
    #im-panel .contact-form-field input, #im-panel .contact-form-field textarea{width:100%; padding:11px 14px; border-radius:10px; border:1px solid var(--line); background:var(--paper-card); font-family:inherit; font-size:14px; color:var(--ink);}
    #im-panel .contact-form-field textarea{min-height:120px; resize:vertical; line-height:1.5;}
    #im-panel .contact-form-field input:focus-visible, #im-panel .contact-form-field textarea:focus-visible{box-shadow:0 0 0 2px var(--brass);}
    #im-panel .contact-submit{background:var(--ink); color:var(--paper-card); border:none; padding:13px 26px; border-radius:100px; font-weight:600; font-size:14.5px;}
    #im-panel .contact-submit:hover{background:var(--walnut);}
    #im-panel .contact-submit:disabled{opacity:0.6; cursor:not-allowed;}
    #im-panel .contact-notice{display:none; margin-top:14px; padding:13px 16px; border-radius:10px; background:rgba(224,138,62,0.12); border:1px solid var(--accent); color:var(--ink); font-size:12.5px; line-height:1.6;}
    #im-panel .contact-notice.show{display:block;}
    #im-panel .contact-notice.success{background:rgba(62,122,85,0.12); border-color:#3E7A55;}

    #im-panel .jobs-card{background:var(--paper-card); border:1px dashed var(--brass); border-radius:14px; padding:22px; margin-bottom:32px;}
    #im-panel .jobs-card strong{display:block; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:16px; font-weight:700; margin-bottom:6px;}
    #im-panel .jobs-card p{margin:0; font-size:13.5px; color:var(--ink-soft); line-height:1.6;}
    #im-panel .jobs-card a{color:var(--walnut); font-weight:600;}
    #im-panel .cta-card{background:var(--ink); color:var(--paper-card); border-radius:16px; padding:28px; text-align:center;}
    #im-panel .cta-card p{color:rgba(237,240,243,0.7); font-size:13.5px; margin:6px 0 18px;}
    #im-panel .cta-btn{display:inline-block; background:var(--paper-card); color:var(--ink); padding:12px 24px; border-radius:100px; font-weight:600; font-size:14px;}
    #im-panel .cta-btn:hover{background:var(--brass-soft);}

    #im-panel .page-head{max-width:820px; margin:0 auto; padding:0 4px 0; text-align:center;}
    #im-panel .page-head .eyebrow{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:12px; letter-spacing:0.14em; text-transform:uppercase; color:var(--sage); font-weight:600; margin-bottom:10px;}
    #im-panel .page-head h1{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:30px; font-weight:700; margin:0 0 8px;}
    #im-panel .page-head p{color:var(--ink-soft); font-size:14.5px; margin:0;}
    #im-panel .checkout-wrap{max-width:820px; margin:0 auto; padding:24px 4px 24px;}
    #im-panel .form-section{background:var(--paper-card); border:1px solid var(--line); border-radius:16px; padding:26px; margin-bottom:20px;}
    #im-panel .form-section h2{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:17px; font-weight:700; margin:0 0 4px;}
    #im-panel .form-section .section-hint{font-size:12.5px; color:var(--ink-soft); margin:0 0 18px; line-height:1.6;}
    #im-panel .form-submit{width:100%; background:var(--ink); color:var(--paper-card); border:none; padding:14px; border-radius:100px; font-weight:600; font-size:15px;}
    #im-panel .form-submit:hover{background:var(--walnut);}
    #im-panel .form-submit:disabled{background:var(--paper-alt); color:var(--ink-soft); cursor:default;}
    #im-panel .form-notice{display:none; margin-top:16px; padding:13px 16px; border-radius:10px; background:rgba(224,138,62,0.12); border:1px solid var(--accent); color:var(--ink); font-size:12.5px; line-height:1.6;}
    #im-panel .form-notice.success{background:rgba(62,122,85,0.12); border-color:#3E7A55;}
    #im-panel .form-notice.show{display:block;}
    #im-panel .target-option{display:flex; align-items:center; gap:9px; font-size:14px; font-weight:500; cursor:pointer; padding:9px 4px;}
    #im-panel .target-option input{width:17px; height:17px; accent-color:var(--walnut); flex-shrink:0;}
    #im-panel .target-office-select{width:100%; padding:11px 14px; border-radius:10px; border:1px solid var(--line); background:var(--paper); font-family:inherit; font-size:14px; color:var(--ink);}

    #im-panel .tier-grid{display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:8px;}
    #im-panel .tier-card{position:relative; text-align:left; background:var(--paper-card); border:2px solid var(--line-soft); border-radius:14px; padding:16px; cursor:pointer; transition:border-color .15s ease, box-shadow .15s ease;}
    #im-panel .tier-card:hover{border-color:var(--brass);}
    #im-panel .tier-card.selected{border-color:var(--ink); box-shadow:0 4px 16px rgba(27,42,61,0.08);}
    #im-panel .tier-card-check{position:absolute; top:14px; right:14px; width:20px; height:20px; border-radius:50%; border:1.5px solid var(--line); background:var(--paper); display:flex; align-items:center; justify-content:center;}
    #im-panel .tier-card.selected .tier-card-check{background:var(--ink); border-color:var(--ink); color:var(--paper-card);}
    #im-panel .tier-card-name{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:16px; font-weight:700; margin-bottom:4px; padding-right:26px;}
    #im-panel .tier-card-price{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:13.5px; color:var(--sage); margin-bottom:6px;}
    #im-panel .tier-card-perks{font-size:12px; color:var(--ink-soft); line-height:1.5; margin:0; padding-left:15px;}
    #im-panel .tier-card-perks li{margin-bottom:3px;}
    #im-panel .tier-card-perks li:last-child{margin-bottom:0;}
    #im-panel .payment-option-disabled{opacity:0.55; cursor:default;}
    #im-panel .payment-option-disabled input{cursor:default;}
    #im-panel .payment-soon-tag{font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; color:var(--ink-soft); background:var(--paper-alt); padding:3px 9px; border-radius:100px;}
    #im-panel .havale-box{margin-top:14px; border:1px solid var(--line); border-radius:12px; padding:16px 18px; background:var(--paper);}
    #im-panel .havale-row{display:flex; align-items:center; gap:10px; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--line-soft); font-size:13.5px;}
    #im-panel .havale-row:last-of-type{border-bottom:none;}
    #im-panel .havale-row-label{color:var(--ink-soft); flex-shrink:0;}
    #im-panel .havale-row-value{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-weight:600; text-align:right; word-break:break-word;}
    #im-panel .havale-copy-btn{flex-shrink:0; background:none; border:1px solid var(--line); border-radius:100px; padding:5px 12px; font-size:11.5px; font-weight:600; color:var(--ink);}
    #im-panel .havale-copy-btn:hover{background:var(--paper-alt);}
    #im-panel .havale-hint{font-size:12.5px; color:var(--ink-soft); line-height:1.6; margin:12px 0 0;}
    #im-panel .summary-row{display:flex; align-items:center; justify-content:space-between; padding:12px 0; border-bottom:1px solid var(--line-soft); font-size:14px;}
    #im-panel .summary-row:last-child{border-bottom:none;}
    #im-panel .summary-row-label{color:var(--ink-soft);}
    #im-panel .summary-row-value{font-weight:600;}
    #im-panel .summary-total{font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:20px; font-weight:600;}
    #im-panel .already-has{text-align:center; padding:10px 4px;}
    #im-panel .already-has strong{display:block; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:17px; margin-bottom:6px;}
    #im-panel .already-has p{color:var(--ink-soft); font-size:13.5px; margin:0 0 16px; line-height:1.6;}

    #im-panel .field{margin-bottom:14px;}
    #im-panel .field:last-child{margin-bottom:0;}
    #im-panel .field label{display:block; font-size:13px; font-weight:600; margin-bottom:6px;}
    #im-panel .field input, #im-panel .field select, #im-panel .field textarea{width:100%; padding:11px 14px; border-radius:10px; border:1px solid var(--line); background:var(--paper); font-family:inherit; font-size:14px; color:var(--ink);}
    #im-panel .field textarea{resize:vertical; min-height:90px; line-height:1.5;}
    #im-panel .field input:focus-visible, #im-panel .field select:focus-visible, #im-panel .field textarea:focus-visible{box-shadow:0 0 0 2px var(--brass);}
    #im-panel .field-hint{font-size:12px; color:var(--ink-soft); margin:6px 0 0;}
    #im-panel .order-empty{text-align:center; padding:10px 4px;}
    #im-panel .order-empty p{color:var(--ink-soft); font-size:13.5px; margin:0 0 16px; line-height:1.6;}

    @media (max-width:720px){ #im-panel .tier-grid{grid-template-columns:1fr;} }

    /* Rozet Al/İade Et/İletişim/Hakkında/vb. modal-shell'in 32/68 ızgarasına DEĞİL, ortalı tek sütun
       biçimine ihtiyaç duyar (bkz. dosya başı yorumu — js/components/auth-modal.js#.am-single ile
       AYNI amaç, dosyalar arası bağımlılık olmasın diye ayrı sınıf). */
    .modal-shell-body.info-single{display:block;}
  `;
  function ensureStyles() {
    if (document.getElementById('info-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'info-modal-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------------------------------
  // HAKKINDA — hakkinda.html#content-wrap ile BİREBİR aynı işaretleme (bkz. o dosya). Tamamen
  // statik, wiring gerekmez.
  // ---------------------------------------------------------------------------------------------
  function hakkindaTemplate() {
    return `
    <div class="content-wrap">
      <div class="content-eyebrow">Kurumsal</div>
      <h1 class="content-title">MİMARLAB Hakkında</h1>
      <p class="content-lead">MİMARLAB; mimarlık, iç mimarlık, peyzaj mimarlığı ve restorasyon alanlarındaki projeleri, mimarları ve firmaları tek bir yerde toplayan bağımsız bir dizin ve topluluk platformudur.</p>

      <div class="content-section">
        <h2>Ne sunuyoruz?</h2>
        <p>Türkiye'deki mimarlık ekosistemini tek bir çatı altında topluyoruz:</p>
        <ul>
          <li><strong>Proje arşivi</strong> — geçmişten günümüze öne çıkan projeleri tür, tip, yer, yıl ve mimarına göre filtreleyerek keşfedebilirsiniz.</li>
          <li><strong>Mimar ve firma profilleri</strong> — bireysel mimarların ve mimarlık ofislerinin/markalarının profillerini inceleyebilirsiniz.</li>
          <li><strong>Ürün ve malzeme kataloğu</strong> — projelerde kullanılan mobilya, aydınlatma, aksesuar ve yapı malzemelerini marka, kategori ve puanına göre filtreleyerek keşfedebilirsiniz.</li>
          <li><strong>Puanlama, yorum ve kaydetme</strong> — projelere ve profillere puan verebilir, yorum yapabilir, beğendiğiniz içerikleri hesabınıza kaydedebilirsiniz.</li>
        </ul>
        <p>İçeriklerin bir kısmı halka açık kaynaklardan derlenir, bir kısmı ise üyelerimizin gönderdiği ve ekibimizin incelemesinden geçen katkılardan oluşur.</p>
      </div>

      <div class="content-section">
        <h2>Bağımsızlık ve doğruluk</h2>
        <p>MİMARLAB'da yer alan firma ve mimar profillerinin büyük çoğunluğu, ilgili kişi veya kurumla resmi bir bağlantımız olmadan, halka açık kaynaklardan derlenmiştir. Bir profilin sahibiyseniz, ilgili detay sayfasından profili sahiplenme talebinde bulunabilir; onaylandığında profilinize gelen istenmeyen yorumları yönetebilir ve Doğrulanmış Profil rozeti alabilirsiniz.</p>
      </div>

      <div class="content-section">
        <h2>Üyelik, katkı ve rozetler</h2>
        <p>Üye olarak proje, mimar veya firma gönderebilir; içerik yayına alınmadan önce ekibimizin incelemesinden geçmesini bekleyebilirsiniz. Hesabınızdan gönderdiğiniz içerikleri, kaydettiğiniz öğeleri ve profil bilgilerinizi yönetebilirsiniz.</p>
        <p>Profilinizi öne çıkarmak isteyenler için aylık kiralanan iki rozet kademesi sunuyoruz — Doğrulanmış Üye ve Altın Üye. Kademeye göre profilinizde doğrulanmış rozet ve kendi içeriğinize gelen yorumları yönetme yetkisi gibi ayrıcalıklar kazanırsınız; güncel ayrıcalıklar ve fiyatlar için <a href="/rozet-al">Rozet Al</a> sayfasını, iade talepleri için <a href="/iade-et">İade Et</a> sayfasını inceleyebilirsiniz.</p>
      </div>

      <div class="content-section">
        <h2>İletişim</h2>
        <p>Sorularınız, düzeltme talepleriniz ya da iş birliği önerileriniz için <a href="/iletisim">iletişim sayfamızdan</a> ya da doğrudan <a href="mailto:info@mimarlab.com">info@mimarlab.com</a> adresinden bize ulaşabilirsiniz.</p>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------------------------------------
  // İLETİŞİM — iletisim.html#content-wrap ile BİREBİR aynı işaretleme/mantık (bkz. o dosya).
  // ---------------------------------------------------------------------------------------------
  function iletisimTemplate() {
    return `
    <div class="content-wrap">
      <div class="content-eyebrow">İletişim</div>
      <h1 class="content-title">Bize Ulaşın</h1>
      <p class="content-lead">Sorularınız, düzeltme talepleriniz, iş birliği önerileriniz ya da geri bildirimleriniz için bize e-posta ile ulaşabilirsiniz.</p>

      <a class="contact-card" href="mailto:info@mimarlab.com">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 6 10 7 10-7"/></svg>
        <div>
          <div class="contact-card-email">info@mimarlab.com</div>
          <p>Tüm konular için tek iletişim adresimiz</p>
        </div>
      </a>

      <div class="content-section">
        <h2>Bize yaz</h2>
        <p>Formu doldurup gönder, mesajın ekibimize ulaşsın.</p>
        <form id="im-contact-form">
          <div class="contact-form-field">
            <label for="im-contact-name">Ad Soyad</label>
            <input type="text" id="im-contact-name" placeholder="Adın Soyadın" required>
          </div>
          <div class="contact-form-field">
            <label for="im-contact-email">E-posta</label>
            <input type="email" id="im-contact-email" placeholder="ornek@eposta.com" required>
          </div>
          <div class="contact-form-field">
            <label for="im-contact-message">Mesajın</label>
            <textarea id="im-contact-message" placeholder="Mesajını yaz..." required></textarea>
          </div>
          <button class="contact-submit" type="submit">Gönder</button>
          <div class="contact-notice" id="im-contact-notice"></div>
        </form>
      </div>

      <div class="content-section">
        <h2>Genel sorular</h2>
        <p>Platform, üyelik ya da içeriklerle ilgili genel sorularınızı doğrudan e-posta ile iletebilirsiniz.</p>
      </div>

      <div class="content-section">
        <h2>Profil düzeltme ve içerik talepleri</h2>
        <p>Bir ofis, mimar ya da proje kaydında hatalı ya da eksik bilgi gördüyseniz, ya da bir profilin sahibiyseniz ve profili sahiplenmek istiyorsanız, ilgili detay sayfasındaki "Bu profil sana mı ait?" bölümünden talepte bulunabilir, ya da bize e-posta ile yazabilirsiniz.</p>
      </div>
    </div>`;
  }

  function wireIletisim() {
    document.getElementById('im-contact-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const notice = document.getElementById('im-contact-notice');
      const submitBtn = e.target.querySelector('.contact-submit');
      notice.classList.remove('show', 'success');
      submitBtn.disabled = true;
      try {
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: document.getElementById('im-contact-name').value,
            email: document.getElementById('im-contact-email').value,
            message: document.getElementById('im-contact-message').value,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          notice.textContent = data.error || 'Bir şeyler ters gitti, tekrar dene.';
          notice.classList.add('show');
          return;
        }
        notice.textContent = 'Mesajın alındı, en kısa sürede dönüş yapacağız.';
        notice.classList.add('show', 'success');
        e.target.reset();
      } catch {
        notice.textContent = 'Sunucuya ulaşılamadı, lütfen tekrar dene.';
        notice.classList.add('show');
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  // ---------------------------------------------------------------------------------------------
  // KARİYER — kariyer.html#content-wrap ile BİREBİR aynı işaretleme (bkz. o dosya). Statik.
  // ---------------------------------------------------------------------------------------------
  function kariyerTemplate() {
    return `
    <div class="content-wrap">
      <div class="content-eyebrow">Kariyer</div>
      <h1 class="content-title">MİMARLAB'da Kariyer</h1>
      <p class="content-lead">MİMARLAB, küçük ve bağımsız bir ekip tarafından geliştirilip yürütülüyor.</p>

      <div class="jobs-card">
        <strong>Şu anda açık bir pozisyonumuz yok</strong>
        <p>Bu sayfada güncel olarak yayınlanmış bir iş ilanımız bulunmuyor. Yine de platforma katkıda bulunmak, içerik/ortaklık/teknik konularda birlikte çalışmak isterseniz bize yazmaktan çekinmeyin.</p>
      </div>

      <div class="content-section">
        <h2>Mimarlık sektöründe iş mi arıyorsunuz?</h2>
        <p>MİMARLAB'ın kendisi değil, platformdaki ofislerin açtığı pozisyonlar için  sayfamıza göz atabilirsiniz.</p>
      </div>

      <div class="cta-card">
        <div style="font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:19px; font-weight:700;">Bize katkıda bulunmak ister misiniz?</div>
        <p>İçerik, ortaklık ya da teknik konularda ilginizi bizimle paylaşın.</p>
        <a class="cta-btn" href="mailto:info@mimarlab.com">info@mimarlab.com</a>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------------------------------------
  // GİZLİLİK POLİTİKASI — gizlilik-politikasi.html#content-wrap ile BİREBİR aynı içerik (bkz. o
  // dosya). Sayfa içi TOC bağlantıları (#toplanan-veriler vb.) modal içinde de çalışsın diye tüm
  // anchor id'leri im- önekiyle benzersizleştirildi (bkz. dosya başı yorumu — başka bir sayfada
  // AYNI genel isimli bir #id olması ihtimaline karşı, host sayfa ne olursa olsun güvenli).
  // ---------------------------------------------------------------------------------------------
  function gizlilikTemplate() {
    return `
    <div class="content-wrap">
      <div class="content-eyebrow">Kurumsal</div>
      <h1 class="content-title">Gizlilik Politikası</h1>
      <p class="content-updated">Son güncelleme: 28 Ağustos 2026</p>
      <p class="content-lead">Bu Gizlilik Politikası, MİMARLAB'ı (mimarlab.com) kullanırken hangi kişisel verilerinizi topladığımızı, bunları neden ve nasıl işlediğimizi, kimlerle paylaştığımızı ve 6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) ile Avrupa Birliği Genel Veri Koruma Tüzüğü (GDPR) kapsamındaki haklarınızı açıklar. Veri sorumlusu MİMARLAB'dır; bize <a href="#im-iletisim-gz">iletişim</a> bölümündeki adresten ulaşabilirsiniz.</p>

      <div class="content-toc">
        <h2>Bu sayfada</h2>
        <ol>
          <li><a href="#im-toplanan-veriler">Topladığımız veriler</a></li>
          <li><a href="#im-kullanim-amaclari">Kullanım amaçları</a></li>
          <li><a href="#im-uyelik-profil">Üyelik ve profil yönetimi</a></li>
          <li><a href="#im-favoriler">Favoriler / Kaydedilenler</a></li>
          <li><a href="#im-claim">Mimar/Firma sahiplik (claim) talepleri</a></li>
          <li><a href="#im-ugc">Kullanıcı içerikleri ve telif hakları</a></li>
          <li><a href="#im-cerezler">Çerezler ve analytics</a></li>
          <li><a href="#im-altyapi">Altyapı ve veri saklama</a></li>
          <li><a href="#im-paylasim">Üçüncü taraflarla paylaşım</a></li>
          <li><a href="#im-yurtdisi">Yurt dışına veri aktarımı</a></li>
          <li><a href="#im-guvenlik">Veri güvenliği ve saklama süresi</a></li>
          <li><a href="#im-haklar">KVKK / GDPR kapsamındaki haklarınız</a></li>
          <li><a href="#im-cocuklar">Çocukların gizliliği</a></li>
          <li><a href="#im-degisiklikler">Politikadaki değişiklikler</a></li>
          <li><a href="#im-iletisim-gz">İletişim</a></li>
        </ol>
      </div>

      <div class="content-section" id="im-toplanan-veriler">
        <h2>1. Topladığımız veriler</h2>
        <p>MİMARLAB'ı ziyaret eden herkesten değil, yalnızca gerçekleştirdiğiniz işlemle orantılı veriler toplarız:</p>
        <ul>
          <li><strong>Hesap verileri</strong> — üye olurken ad soyad, e-posta adresi ve şifrenizin güvenli (hash'lenmiş) hâli.</li>
          <li><strong>Profil verileri</strong> — mimar/firma profilinizi sahiplendiyseniz (claim) veya düzenlediyseniz eklediğiniz fotoğraf, biyografi, üniversite/bölüm, web sitesi gibi bilgiler.</li>
          <li><strong>Kullanıcı içerikleri</strong> — gönderdiğiniz proje/ürün/mimar/firma/iş ilanı formları, yorumlar, puanlamalar ve yüklediğiniz görseller.</li>
          <li><strong>Kullanım verileri</strong> — kaydettiğiniz (favorilediğiniz) içerikler, bildirim tercihleri, oturum durumu.</li>
          <li><strong>Teknik veriler</strong> — IP adresi, tarayıcı/cihaz bilgisi, ziyaret edilen sayfalar; bunlar Cloudflare edge altyapısı ve Google Analytics aracılığıyla toplanır (bkz. <a href="#im-cerezler">Çerezler ve analytics</a>).</li>
          <li><strong>Ödeme verileri</strong> — rozet satın alımlarında kart bilgileriniz bizim sunucularımıza hiç ulaşmaz; ödeme doğrudan iyzico'nun güvenli altyapısında işlenir, biz yalnızca işlemin sonucunu (başarılı/başarısız, tutar, tarih) saklarız.</li>
        </ul>
        <p>Sitede yer alan proje/mimar/firma profillerinin büyük bir kısmı, ilgili kişi veya kurumla üyelik ilişkisi olmadan halka açık kaynaklardan derlenmiştir; bu durum <a href="/hakkinda">Hakkında</a> sayfasında ayrıca açıklanır.</p>
      </div>

      <div class="content-section" id="im-kullanim-amaclari">
        <h2>2. Kullanım amaçları</h2>
        <ul>
          <li>Hesabınızı oluşturmak, kimliğinizi doğrulamak ve size hizmet sunmak,</li>
          <li>Gönderdiğiniz içerikleri (proje, ürün, profil, yorum) inceleyip yayına almak,</li>
          <li>Sahiplik (claim) ve düzeltme taleplerinizi değerlendirmek,</li>
          <li>Rozet/üyelik satın alımlarınızı ve iade taleplerinizi işleme almak,</li>
          <li>Platformun güvenliğini sağlamak, kötüye kullanımı önlemek ve hataları teşhis etmek,</li>
          <li>Yasal yükümlülüklerimizi yerine getirmek,</li>
          <li>Açık rızanız varsa ürün/hizmetlerimiz hakkında sizinle iletişime geçmek.</li>
        </ul>
      </div>

      <div class="content-section" id="im-uyelik-profil">
        <h2>3. Üyelik ve profil yönetimi</h2>
        <p>Üye olduğunuzda oluşturduğunuz hesap, oturumunuzu (session) sunucu tarafında yönetmemizi sağlar; şifreniz asla düz metin olarak saklanmaz. <a href="/hesabim">Hesabım</a> sayfanızdan e-posta ve şifre bilgilerinizi güncelleyebilir, gönderdiğiniz içerikleri ve rozet aboneliğinizi görüntüleyebilir, hesabınızı silme talebinde bulunabilirsiniz. Hesap silme talebi, yasal saklama yükümlülüğü bulunan kayıtlar (örn. ödeme geçmişi) dışındaki tüm kişisel verilerinizin silinmesiyle sonuçlanır.</p>
      </div>

      <div class="content-section" id="im-favoriler">
        <h2>4. Favoriler / Kaydedilenler</h2>
        <p>Proje, ürün, mimar veya firma kartlarındaki "Kaydet" butonuyla oluşturduğunuz favori listesi hesabınıza bağlı olarak saklanır ve yalnızca siz görebilirsiniz; bu liste üçüncü taraflarla paylaşılmaz ve içerikleri kişiselleştirme veya öneri amacıyla kullanılmaz — yalnızca sizin daha sonra tekrar erişebilmeniz için tutulur.</p>
      </div>

      <div class="content-section" id="im-claim">
        <h2>5. Mimar/Firma sahiplik (claim) talepleri</h2>
        <p>Halka açık kaynaklardan derlenmiş bir mimar veya firma profilinin sahibi olduğunuzu düşünüyorsanız, ilgili profildeki "Bu profil sana mı ait?" bağlantısı üzerinden sahiplik talebinde bulunabilirsiniz. Bu süreçte kimliğinizi/yetkinizi doğrulamamıza yardımcı olacak bilgiler (ör. kurumsal e-posta, web sitesi bağlantısı) talep edebiliriz. Talep onaylandığında profil hesabınıza bağlanır; artık profilinize gelen yorumları yönetebilir, bilgilerini güncelleyebilir ve (varsa) rozet kademenize uygun ayrıcalıklardan yararlanabilirsiniz. Doğrulama amacıyla paylaştığınız bilgiler yalnızca talebi değerlendiren ekibimizle sınırlı tutulur.</p>
      </div>

      <div class="content-section" id="im-ugc">
        <h2>6. Kullanıcı içerikleri (UGC) ve telif hakları</h2>
        <p>Platforma gönderdiğiniz proje, ürün, yorum, puanlama ve görseller "kullanıcı tarafından oluşturulan içerik" (UGC) sayılır. Bu içerikleri göndererek, içeriği yayınlamak, göstermek ve platformumuzda tanıtmak için MİMARLAB'a münhasır olmayan, dünya çapında, telifsiz bir kullanım hakkı verirsiniz; içeriğin mülkiyeti ve telif hakkı sizde (veya gerçek hak sahibinde) kalmaya devam eder.</p>
        <p>Yalnızca yayınlama hakkına sahip olduğunuz içerikleri yüklemekle yükümlüsünüz. Bir içeriğin telif hakkınızı ihlal ettiğini düşünüyorsanız, ilgili sayfanın bağlantısı ve hak sahipliğinizi gösteren bilgilerle birlikte <a href="/iletisim">iletişim sayfamızdan</a> bize ulaşın; bildirimi inceleyip gerekirse içeriği kaldırırız. Ayrıntılı UGC ve telif kuralları için <a href="/hizmet-sartlari">Hizmet Şartları</a> sayfasına bakabilirsiniz.</p>
      </div>

      <div class="content-section" id="im-cerezler">
        <h2>7. Çerezler ve analytics</h2>
        <p>MİMARLAB, sitenin çalışması için gerekli <strong>oturum çerezleri</strong> (giriş durumunuzu hatırlamak için) kullanır; bunlar devre dışı bırakılamaz çünkü hesabınızla ilgili özellikler bunlara bağlıdır. Ayrıca site trafiğini anlamak için <strong>Google Analytics</strong> kullanıyoruz. Kullandığımız çerezlerin tam listesi, süreleri ve devre dışı bırakma yöntemleri için ayrı <a href="/cerez-politikasi">Çerez Politikası</a> sayfamıza bakabilirsiniz.</p>
      </div>

      <div class="content-section" id="im-altyapi">
        <h2>8. Altyapı ve veri saklama</h2>
        <p>MİMARLAB, Cloudflare'in küresel edge altyapısı üzerinde çalışır:</p>
        <ul>
          <li><strong>Cloudflare Workers</strong> — sunucu tarafı mantığımızı (API uçları, oturum doğrulama, önbellekleme) kullanıcıya en yakın veri merkezinde çalıştırır.</li>
          <li><strong>Cloudflare D1</strong> — hesap, profil, içerik, yorum ve puanlama verilerinizin saklandığı ilişkisel veritabanı.</li>
          <li><strong>Cloudflare R2</strong> — yüklediğiniz görsellerin (proje fotoğrafları, profil fotoğrafları/logolar) saklandığı nesne depolama servisi.</li>
          <li><strong>Cloudflare KV</strong> — sayfa yükleme hızını artırmak için kullanılan, kişisel veri içermeyen kısa ömürlü önbellek (facet/filtre sayaçları gibi).</li>
        </ul>
        <p>Bu servis sağlayıcıların tamamı, kendi güvenlik ve veri koruma standartlarına tabidir; MİMARLAB, verilerinizi bu altyapı dışında üçüncü taraf sunucularda depolamaz.</p>
      </div>

      <div class="content-section" id="im-paylasim">
        <h2>9. Üçüncü taraflarla paylaşım</h2>
        <p>Kişisel verilerinizi pazarlama amacıyla satmayız veya kiralamayız. Verileriniz yalnızca şu durumlarda paylaşılabilir:</p>
        <ul>
          <li>Yukarıda belirtilen altyapı sağlayıcılarımızla (Cloudflare) ve ödeme işlemleriniz için iyzico ile, hizmeti sunabilmek amacıyla,</li>
          <li>Yasal bir yükümlülük, mahkeme kararı veya yetkili bir kamu kurumunun talebi doğrultusunda,</li>
          <li>Platformun, kullanıcıların veya üçüncü kişilerin haklarını, güvenliğini veya mülkiyetini korumak için gerekli olduğunda,</li>
          <li>Açık rızanızı aldığımız diğer durumlarda.</li>
        </ul>
      </div>

      <div class="content-section" id="im-yurtdisi">
        <h2>10. Yurt dışına veri aktarımı</h2>
        <p>MİMARLAB'ın kullandığı Cloudflare ve Google Analytics altyapıları küresel ölçekte çalışır; bu nedenle verileriniz, işlemin gerçekleştiği veri merkezine bağlı olarak Türkiye dışına (ör. Avrupa Birliği veya ABD'deki sunuculara) aktarılabilir. Bu aktarımlar, ilgili sağlayıcıların (Cloudflare, Google) standart sözleşme hükümleri ve kendi veri koruma taahhütleri çerçevesinde, yalnızca hizmetin sunulabilmesi için gerekli ölçüde gerçekleşir; verileriniz bu altyapı sağlayıcıları dışında üçüncü bir ülkeye ayrıca aktarılmaz.</p>
      </div>

      <div class="content-section" id="im-guvenlik">
        <h2>11. Veri güvenliği ve saklama süresi</h2>
        <p>Şifreleriniz hash'lenerek saklanır, veri trafiği HTTPS ile şifrelenir ve erişim yalnızca yetkili ekip üyeleriyle sınırlıdır. Verilerinizi, hesabınız aktif olduğu sürece ve yasal saklama yükümlülüklerimizin gerektirdiği süre boyunca saklarız; hesap silme talebinizin ardından yasal zorunluluk bulunmayan veriler makul bir süre içinde silinir.</p>
      </div>

      <div class="content-section" id="im-haklar">
        <h2>12. KVKK / GDPR kapsamındaki haklarınız</h2>
        <p>KVKK'nın 11. maddesi ve (Avrupa Ekonomik Alanı'ndaki kullanıcılar için) GDPR kapsamında aşağıdaki haklara sahipsiniz:</p>
        <ul>
          <li>Verilerinizin işlenip işlenmediğini öğrenme,</li>
          <li>İşlenen verileriniz hakkında bilgi talep etme,</li>
          <li>Verilerinizin işlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme,</li>
          <li>Eksik veya yanlış işlenmişse düzeltilmesini isteme,</li>
          <li>Yasal şartlar oluştuğunda silinmesini veya yok edilmesini isteme,</li>
          <li>Verilerinizin taşınabilir bir formatta size veya başka bir hizmete aktarılmasını isteme (GDPR),</li>
          <li>İşlemeye itiraz etme ve rızanızı istediğiniz zaman geri çekme.</li>
        </ul>
        <p>Bu haklarınızı kullanmak için <a href="#im-iletisim-gz">iletişim</a> bölümündeki adresten bize ulaşabilirsiniz; talebiniz kimlik doğrulamasının ardından yasal süreler içinde sonuçlandırılır.</p>
      </div>

      <div class="content-section" id="im-cocuklar">
        <h2>13. Çocukların gizliliği</h2>
        <p>MİMARLAB, 18 yaşından küçük kullanıcılara yönelik değildir; bilerek 18 yaş altı kullanıcılardan veri toplamayız. Bir çocuğa ait veri topladığımızı fark edersek bu veriyi derhal sileriz.</p>
      </div>

      <div class="content-section" id="im-degisiklikler">
        <h2>14. Politikadaki değişiklikler</h2>
        <p>Bu politikayı zaman zaman güncelleyebiliriz; önemli değişikliklerde sayfanın üst kısmındaki "son güncelleme" tarihini değiştirir, gerektiğinde sitede veya e-posta yoluyla bilgilendirme yaparız. Politikayı düzenli aralıklarla gözden geçirmenizi öneririz.</p>
      </div>

      <div class="content-section" id="im-iletisim-gz">
        <h2>15. İletişim</h2>
        <p>Gizlilik politikamız veya kişisel verilerinizle ilgili sorularınız için <a href="/iletisim">iletişim sayfamızdan</a> ya da doğrudan <a href="mailto:info@mimarlab.com">info@mimarlab.com</a> adresinden bize ulaşabilirsiniz. Platform kullanım kurallarımız için <a href="/hizmet-sartlari">Hizmet Şartları</a>, çerez kullanımımız için <a href="/cerez-politikasi">Çerez Politikası</a> sayfasına göz atabilirsiniz.</p>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------------------------------------
  // HİZMET ŞARTLARI — hizmet-sartlari.html#content-wrap ile BİREBİR aynı içerik (bkz. o dosya).
  // Aynı gerekçeyle TOC anchor id'leri im- önekiyle benzersizleştirildi (bkz. gizlilikTemplate).
  // ---------------------------------------------------------------------------------------------
  function hizmetTemplate() {
    return `
    <div class="content-wrap">
      <div class="content-eyebrow">Kurumsal</div>
      <h1 class="content-title">Hizmet Şartları</h1>
      <p class="content-updated">Son güncelleme: 28 Ağustos 2026</p>
      <p class="content-lead">Bu Hizmet Şartları, MİMARLAB'ı (mimarlab.com) kullanımınızı düzenleyen kuralları içerir. Siteyi ziyaret ederek, üye olarak veya içerik göndererek bu şartları kabul etmiş sayılırsınız. Kişisel verilerinizin nasıl işlendiğini öğrenmek için <a href="/gizlilik-politikasi">Gizlilik Politikası</a> sayfamıza bakabilirsiniz.</p>

      <div class="content-toc">
        <h2>Bu sayfada</h2>
        <ol>
          <li><a href="#im-tanimlar">Tanımlar</a></li>
          <li><a href="#im-uyelik-hs">Üyelik ve hesap</a></li>
          <li><a href="#im-ugc-hs">Kullanıcı içerikleri ve lisans</a></li>
          <li><a href="#im-telif">Telif hakları ve ihlal bildirimi</a></li>
          <li><a href="#im-claim-hs">Mimar/Firma sahiplik (claim) süreci</a></li>
          <li><a href="#im-topluluk">Puanlama, yorum ve topluluk kuralları</a></li>
          <li><a href="#im-rozet">Rozet/üyelik paketleri ve ödemeler</a></li>
          <li><a href="#im-yasaklar">Yasaklı kullanımlar</a></li>
          <li><a href="#im-fikri-mulkiyet">Fikri mülkiyet</a></li>
          <li><a href="#im-sorumluluk">Sorumluluğun sınırlandırılması</a></li>
          <li><a href="#im-degisiklik">Hizmetin değiştirilmesi ve sonlandırılması</a></li>
          <li><a href="#im-hukuk">Uygulanacak hukuk</a></li>
          <li><a href="#im-iletisim-hs">İletişim</a></li>
        </ol>
      </div>

      <div class="content-section" id="im-tanimlar">
        <h2>1. Tanımlar</h2>
        <p>"MİMARLAB", "biz", "bize" ifadeleri mimarlab.com platformunu; "Kullanıcı", "siz" ifadeleri siteyi ziyaret eden veya kullanan herkesi; "İçerik" ifadesi platformda yer alan proje, ürün, profil, yorum, puanlama, görsel ve metinleri; "Üye" ifadesi hesap oluşturmuş kullanıcıları ifade eder.</p>
      </div>

      <div class="content-section" id="im-uyelik-hs">
        <h2>2. Üyelik ve hesap</h2>
        <p>Üye olmak için doğru ve güncel bilgiler vermeniz gerekir. Hesabınızın ve şifrenizin gizliliğinden siz sorumlusunuz; hesabınız üzerinden gerçekleştirilen tüm işlemlerden sorumlu tutulursunuz. Hesabınızda yetkisiz bir erişim şüphesi varsa derhal <a href="/iletisim">bize bildirin</a>. MİMARLAB, şartları ihlal eden hesapları uyarmadan askıya alma veya kapatma hakkını saklı tutar.</p>
      </div>

      <div class="content-section" id="im-ugc-hs">
        <h2>3. Kullanıcı içerikleri ve lisans</h2>
        <p>Platforma proje, ürün, profil, yorum, puanlama veya görsel gönderdiğinizde (Kullanıcı İçeriği), bu içeriğin sizin tarafınızdan oluşturulduğunu veya yayınlama hakkına sahip olduğunuzu beyan etmiş olursunuz. İçeriğin mülkiyeti sizde kalır; ancak içeriği platformda göstermek, saklamak, biçimlendirmek (ör. görsel boyutlandırma/optimize etme) ve tanıtım amacıyla kullanmak üzere bize dünya çapında, telifsiz, münhasır olmayan bir lisans vermiş olursunuz.</p>
        <p>Gönderdiğiniz proje/ürün/profil/iş ilanı içerikleri yayına alınmadan önce ekibimizin incelemesinden geçer; MİMARLAB, kurallara aykırı, yanıltıcı veya hak ihlali içeren içerikleri yayınlamayı reddetme ya da sonradan kaldırma hakkını saklı tutar.</p>
      </div>

      <div class="content-section" id="im-telif">
        <h2>4. Telif hakları ve ihlal bildirimi</h2>
        <p>Sitede yer alan proje fotoğrafları ve görseller, ilgili mimar, firma, fotoğrafçı veya hak sahibine aittir; künyelerde belirtilen fotoğraf kaynağı bilgisi bu nedenle korunur. Yalnızca kendinize ait olan veya yayınlama izniniz bulunan içerikleri yükleyebilirsiniz.</p>
        <p>Bir içeriğin telif hakkınızı ihlal ettiğini düşünüyorsanız, (a) ihlal edildiğini iddia ettiğiniz eserin tanımını, (b) ihlal eden içeriğin bulunduğu sayfanın bağlantısını ve (c) hak sahipliğinizi gösteren bilgileri <a href="mailto:info@mimarlab.com">info@mimarlab.com</a> adresine ileterek bildirimde bulunabilirsiniz. Bildirimi inceleyip haklı bulunması durumunda içeriği makul bir süre içinde kaldırırız.</p>
      </div>

      <div class="content-section" id="im-claim-hs">
        <h2>5. Mimar/Firma sahiplik (claim) süreci</h2>
        <p>Sitede halka açık kaynaklardan derlenmiş bir mimar/firma profilinin gerçek sahibi veya yetkilisiyseniz, profil üzerinden sahiplik talebinde bulunabilirsiniz. Talebiniz incelenirken kimliğinizi/yetkinizi doğrulayacak belge veya bilgi isteyebiliriz; yanlış beyanla sahiplik talebinde bulunmak bu şartların ihlali sayılır ve hesabınızın kapatılmasına yol açabilir. Onaylanan talepler profilinizi hesabınıza bağlar; sahiplendiğiniz profildeki bilgileri güncelleme ve gelen yorumları yönetme yetkisi kazanırsınız. MİMARLAB, uyuşmazlık (aynı profil için birden fazla talep) durumunda ek doğrulama isteme veya talebi reddetme hakkını saklı tutar.</p>
      </div>

      <div class="content-section" id="im-topluluk">
        <h2>6. Puanlama, yorum ve topluluk kuralları</h2>
        <p>Projelere yıldız puanı verebilir ve yorum yazabilirsiniz. Yorumlarınızın gerçek deneyiminize dayanması, hakaret, ayrımcılık, taciz, spam veya yanıltıcı bilgi içermemesi gerekir. Bu kurallara aykırı yorumları/puanlamaları kaldırma ve tekrarlayan ihlallerde hesabı kısıtlama hakkımız saklıdır. Bir profilin sahibiyseniz, kendi profilinize gelen uygunsuz yorumları yönetme (gizleme/bildirme) ayrıcalığından yararlanabilirsiniz.</p>
      </div>

      <div class="content-section" id="im-rozet">
        <h2>7. Rozet/üyelik paketleri ve ödemeler</h2>
        <p>Profilinizi öne çıkarmak veya ek ayrıcalıklar (doğrulanmış rozet, yorum yönetimi vb.) kazanmak için aylık kiralanan rozet kademeleri sunuyoruz; güncel kademeler ve fiyatlar <a href="/rozet-al">Rozet Al</a> sayfasında yer alır. Ödemeleriniz iyzico'nun güvenli altyapısı üzerinden işlenir; kart bilgileriniz MİMARLAB sunucularında saklanmaz. Rozet abonelikleri aylık yenilenir; iptal ve iade koşulları için <a href="/iade-et">İade Et</a> sayfasına bakabilirsiniz.</p>
      </div>

      <div class="content-section" id="im-yasaklar">
        <h2>8. Yasaklı kullanımlar</h2>
        <ul>
          <li>Sahte hesap oluşturmak veya başka bir kişi/kurum adına yetkisiz şekilde profil sahiplenmek,</li>
          <li>Hak ihlali içeren, yanıltıcı veya izinsiz içerik yüklemek,</li>
          <li>Platformu kötüye kullanmak, otomatikleştirilmiş araçlarla (bot/scraper) aşırı yük bindirmek veya güvenlik açıklarını istismar etmeye çalışmak,</li>
          <li>Diğer kullanıcıları taciz etmek, spam göndermek veya yanıltıcı ticari içerik paylaşmak,</li>
          <li>Yürürlükteki yasalara aykırı herhangi bir faaliyette bulunmak.</li>
        </ul>
      </div>

      <div class="content-section" id="im-fikri-mulkiyet">
        <h2>9. Fikri mülkiyet</h2>
        <p>MİMARLAB adı, logosu, arayüz tasarımı ve yazılımı MİMARLAB'a aittir ve telif/marka hakları ile korunur. Kullanıcı İçerikleri dışında, sitenin görsel tasarımı ve kodu izinsiz kopyalanamaz, çoğaltılamaz veya ticari amaçla kullanılamaz.</p>
      </div>

      <div class="content-section" id="im-sorumluluk">
        <h2>10. Sorumluluğun sınırlandırılması</h2>
        <p>MİMARLAB, sitede yer alan halka açık kaynaklardan derlenmiş profil bilgilerinin veya kullanıcılar tarafından gönderilen içeriklerin doğruluğunu garanti etmez; içerikler "olduğu gibi" sunulur. Platform kullanımından doğabilecek dolaylı, arızi veya sonuç niteliğindeki zararlardan, yürürlükteki mevzuatın izin verdiği azami ölçüde sorumlu tutulamayız. Bir bilginin hatalı olduğunu düşünüyorsanız <a href="/iletisim">bize bildirin</a>.</p>
      </div>

      <div class="content-section" id="im-degisiklik">
        <h2>11. Hizmetin değiştirilmesi ve sonlandırılması</h2>
        <p>MİMARLAB, hizmetin herhangi bir bölümünü önceden bildirmeksizin değiştirme, geçici olarak durdurma veya sonlandırma hakkını saklı tutar. Bu şartları ihlal eden hesapları askıya alabilir veya kapatabiliriz. Bu şartlarda yapılacak önemli değişikliklerde sayfanın üst kısmındaki "son güncelleme" tarihi güncellenir.</p>
      </div>

      <div class="content-section" id="im-hukuk">
        <h2>12. Uygulanacak hukuk</h2>
        <p>Bu şartlar Türkiye Cumhuriyeti kanunlarına tabidir. Bu şartlardan doğabilecek uyuşmazlıklarda Türkiye mahkemeleri ve icra daireleri yetkilidir.</p>
      </div>

      <div class="content-section" id="im-iletisim-hs">
        <h2>13. İletişim</h2>
        <p>Hizmet şartlarımızla ilgili sorularınız için <a href="/iletisim">iletişim sayfamızdan</a> ya da doğrudan <a href="mailto:info@mimarlab.com">info@mimarlab.com</a> adresinden bize ulaşabilirsiniz. Kişisel verilerinizin işlenmesi hakkında bilgi için <a href="/gizlilik-politikasi">Gizlilik Politikası</a>, çerez kullanımımız için <a href="/cerez-politikasi">Çerez Politikası</a> sayfamıza bakabilirsiniz.</p>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------------------------------------
  // ÇEREZ POLİTİKASI — cerez-politikasi.html#content-wrap ile BİREBİR aynı içerik (bkz. o dosya,
  // 2026-08-28'de Architonic'in çerez politikası sayfası yapı referansı alınarak eklendi). Aynı
  // gerekçeyle TOC anchor id'leri im- önekiyle benzersizleştirildi (bkz. gizlilikTemplate).
  // ---------------------------------------------------------------------------------------------
  function cerezTemplate() {
    return `
    <div class="content-wrap">
      <div class="content-eyebrow">Kurumsal</div>
      <h1 class="content-title">Çerez Politikası</h1>
      <p class="content-updated">Son güncelleme: 28 Ağustos 2026</p>
      <p class="content-lead">Bu Çerez Politikası, MİMARLAB'ı (mimarlab.com) ziyaret ettiğinizde tarayıcınızda hangi çerezlerin ve benzer teknolojilerin kullanıldığını, bunları hangi amaçla kullandığımızı ve nasıl kontrol edebileceğinizi açıklar. Kişisel verilerinizin genel olarak nasıl işlendiği için <a href="/gizlilik-politikasi">Gizlilik Politikası</a> sayfamıza bakabilirsiniz.</p>

      <div class="content-toc">
        <h2>Bu sayfada</h2>
        <ol>
          <li><a href="#im-cz-nedir">Çerez nedir?</a></li>
          <li><a href="#im-cz-kullandiklarimiz">Kullandığımız çerezler</a></li>
          <li><a href="#im-cz-ucuncu-taraf">Üçüncü taraf çerezleri</a></li>
          <li><a href="#im-cz-reddetmeyecegimiz">Kullanmadığımız çerez türleri</a></li>
          <li><a href="#im-cz-kontrol">Çerezleri nasıl kontrol edebilirsiniz?</a></li>
          <li><a href="#im-cz-degisiklikler">Politikadaki değişiklikler</a></li>
          <li><a href="#im-cz-iletisim">İletişim</a></li>
        </ol>
      </div>

      <div class="content-section" id="im-cz-nedir">
        <h2>1. Çerez nedir?</h2>
        <p>Çerezler, bir web sitesini ziyaret ettiğinizde tarayıcınıza kaydedilen küçük metin dosyalarıdır. Oturum çerezleri tarayıcınızı kapattığınızda silinir; kalıcı çerezler ise belirli bir süre (genellikle birkaç gün ile birkaç yıl arasında) cihazınızda saklanır ve sizi tekrar ziyaretinizde tanımaya yarar. Çerezlere ek olarak, tarayıcınızın <code>localStorage</code> gibi benzer depolama teknolojilerini de (ör. tema tercihinizi hatırlamak için) sınırlı ölçüde kullanırız.</p>
      </div>

      <div class="content-section" id="im-cz-kullandiklarimiz">
        <h2>2. Kullandığımız çerezler</h2>
        <p>MİMARLAB'da çerezleri üç kategoride topluyoruz: sitenin çalışması için zorunlu olanlar, tercihinizi hatırlayan işlevsel bir yerel depolama kaydı ve site trafiğini anlamamızı sağlayan performans/analitik çerezleri.</p>
        <div class="cookie-table-wrap">
          <table class="cookie-table">
            <thead>
              <tr><th>Ad</th><th>Tür</th><th>Amaç</th><th>Süre</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><code>mimarlab_session</code></td>
                <td><span class="cookie-badge">Zorunlu</span></td>
                <td>Giriş yaptığınızda oturumunuzu (kimliğinizi) sunucu tarafında hatırlar; hesap gerektiren tüm özellikler (favoriler, profil, gönderiler) buna bağlıdır. HttpOnly'dir, JavaScript ile okunamaz.</td>
                <td>30 gün</td>
              </tr>
              <tr>
                <td><code>mimarlab-theme</code></td>
                <td><span class="cookie-badge">İşlevsel</span></td>
                <td>Açık/koyu tema tercihinizi tarayıcınızda (yerel depolama olarak, çerez değil) hatırlar.</td>
                <td>Siz silene kadar</td>
              </tr>
              <tr>
                <td><code>_ga</code>, <code>_ga_*</code></td>
                <td><span class="cookie-badge">Performans</span></td>
                <td>Google Analytics tarafından, ziyaretçileri ayırt etmek ve site trafiğini/kullanım eğilimlerini anonimleştirilmiş biçimde ölçmek için ayarlanır.</td>
                <td>Google'ın varsayılanı, en fazla 2 yıl</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="content-section" id="im-cz-ucuncu-taraf">
        <h2>3. Üçüncü taraf çerezleri</h2>
        <p>Yukarıdaki tabloda listelenen <strong>Google Analytics</strong> çerezleri, Google LLC tarafından işletilir ve verileriniz Google'ın kendi gizlilik politikasına tabi olarak işlenir. Bu çerezler tarayıcınıza yalnızca sitemizi ziyaret ettiğinizde, bizim adımıza istatistiksel ölçüm amacıyla yerleştirilir; MİMARLAB bu verileri reklam veya kişiselleştirme amacıyla kullanmaz veya satmaz.</p>
      </div>

      <div class="content-section" id="im-cz-reddetmeyecegimiz">
        <h2>4. Kullanmadığımız çerez türleri</h2>
        <p>MİMARLAB şu anda <strong>reklam/pazarlama çerezleri</strong> veya sosyal medya izleme piksel'leri kullanmamaktadır — sitede üçüncü taraf reklam ağı bulunmaz. Bu durum değişirse, bu sayfa güncellenir ve gerekiyorsa siteye açık rıza alan bir çerez bildirimi eklenir.</p>
      </div>

      <div class="content-section" id="im-cz-kontrol">
        <h2>5. Çerezleri nasıl kontrol edebilirsiniz?</h2>
        <p>Tarayıcınızın ayarlarından çerezleri görüntüleyebilir, engelleyebilir veya silebilirsiniz — bu ayarlar genellikle tarayıcının "Gizlilik" veya "Güvenlik" bölümünde yer alır. <code>mimarlab_session</code> gibi zorunlu çerezleri engellemeniz durumunda, giriş yapmayı ve hesabınızla ilgili özellikleri kullanmayı gerektiren sayfalar düzgün çalışmayabilir.</p>
        <p>Google Analytics çerezlerini devre dışı bırakmak isterseniz, Google'ın <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener">Analytics devre dışı bırakma eklentisini</a> kullanabilirsiniz; bu durumda temel site işlevleri etkilenmez, yalnızca kullanım verileriniz Analytics'e iletilmez.</p>
      </div>

      <div class="content-section" id="im-cz-degisiklikler">
        <h2>6. Politikadaki değişiklikler</h2>
        <p>Kullandığımız çerezler zaman içinde değişebilir; önemli değişikliklerde bu sayfanın üst kısmındaki "son güncelleme" tarihini güncelleriz. Politikayı düzenli aralıklarla gözden geçirmenizi öneririz.</p>
      </div>

      <div class="content-section" id="im-cz-iletisim">
        <h2>7. İletişim</h2>
        <p>Çerez politikamızla ilgili sorularınız için <a href="/iletisim">iletişim sayfamızdan</a> ya da doğrudan <a href="mailto:info@mimarlab.com">info@mimarlab.com</a> adresinden bize ulaşabilirsiniz. Kişisel verilerinizin genel olarak işlenmesi hakkında <a href="/gizlilik-politikasi">Gizlilik Politikası</a>, platform kullanım kurallarımız için <a href="/hizmet-sartlari">Hizmet Şartları</a> sayfalarına bakabilirsiniz.</p>
      </div>
    </div>`;
  }

  // Sayfa içi TOC bağlantıları (#im-...) modal içindeyken de aynı panel'in içinde kaydırsın diye
  // (bkz. kullanıcı isteği: tasarım/davranış birebir korunsun) — tarayıcının varsayılan anchor
  // kaydırması document.body'yi hedef alır, modal-shell'in KENDİ scroll konteyneri (.modal-shell-body)
  // olduğundan hiçbir şey olmaz; bu yüzden delege edilmiş bir tıklama dinleyicisiyle elle kaydırılır.
  function wireInPanelAnchors(root) {
    root.querySelectorAll('a[href^="#im-"]').forEach(a => {
      a.addEventListener('click', (e) => {
        const target = document.getElementById(a.getAttribute('href').slice(1));
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  // ---------------------------------------------------------------------------------------------
  // ROZET AL (= Ödeme Sayfası) — satin-al.html#checkout-wrap ile BİREBİR aynı işaretleme/mantık
  // (bkz. o dosya — kod tabanında bundan ayrı bir "ödeme sayfası" yok, kart bilgisi iyzico'nun
  // hosted sayfasında girilir, havale/EFT ise doğrudan bu formda). Giriş yapılmamışsa orijinal
  // davranış BİREBİR korunur: tam sayfa yönlendirme (artık '/giris'e, bkz. kullanıcı isteği:
  // "preserve design 1:1" — bu, hesabim görünümünün aksine bir modal swap'ı DEĞİL, çünkü orijinal
  // sayfa da zaten aynı şekilde tam yönlendirme yapıyordu).
  // ---------------------------------------------------------------------------------------------
  function rozetAlTemplate() {
    return `
    <div class="page-head">
      <div class="eyebrow">Rozet Satın Al</div>
      <h1>Bir kademe seç</h1>
      <p>Rozetler aylık kiralanır. Kendin için ayrı, firman için ayrı rozet alabilirsin.</p>
    </div>
    <div class="checkout-wrap">
      <div class="form-section" id="im-target-section">
        <h2>Kimin için?</h2>
        <p class="section-hint">Kendi hesabın için mi, yoksa sahiplendiğin bir firma profili için mi rozet almak istiyorsun?</p>
        <label class="target-option"><input type="radio" name="im-badge-target" id="im-target-self" value="self" checked> Kendim için</label>
        <label class="target-option"><input type="radio" name="im-badge-target" id="im-target-office" value="office"> Bir firmam için</label>
        <div id="im-target-office-wrap" style="display:none; margin-top:10px;">
          <select class="target-office-select" id="im-target-office-select"></select>
          <p id="im-target-office-empty" style="display:none; font-size:12.5px; color:var(--ink-soft); margin-top:8px;">Rozet alabilmen için önce bir firma profilini sahiplenip onaylatman gerekiyor. <a href="/firma" style="color:var(--walnut); font-weight:600;">Firmanı bul</a>.</p>
        </div>
      </div>

      <div class="form-section">
        <h2>Kademe</h2>
        <p class="section-hint">Devam etmeden önce dilediğin kademeyi seçebilirsin.</p>
        <div class="tier-grid" id="im-tier-grid"></div>
      </div>

      <div class="form-section" id="im-payment-section">
        <h2>Ödeme Yöntemi</h2>
        <p class="section-hint">Şu anda yalnızca havale/EFT ile ödeme alıyoruz.</p>
        <label class="target-option"><input type="radio" name="im-payment-method" id="im-payment-havale" value="havale" checked> Havale / EFT</label>
        <label class="target-option payment-option-disabled"><input type="radio" name="im-payment-method" id="im-payment-card" value="card" disabled> Kredi / Banka Kartı <span class="payment-soon-tag">Şu an aktif değil</span></label>

        <div class="havale-box" id="im-havale-box">
          <div class="havale-row">
            <span class="havale-row-label">IBAN</span>
            <span class="havale-row-value" id="im-havale-iban">TR22 0004 6001 7088 8000 2482 94</span>
            <button type="button" class="havale-copy-btn" id="im-havale-copy-btn">Kopyala</button>
          </div>
          <div class="havale-row"><span class="havale-row-label">Hesap Sahibi</span><span class="havale-row-value">Kaan Çorbacı</span></div>
          <div class="havale-row"><span class="havale-row-label">Tutar</span><span class="havale-row-value" id="im-havale-amount">—</span></div>
          <div class="havale-row"><span class="havale-row-label">Açıklama</span><span class="havale-row-value">info@mimarlab.com</span></div>
          <p class="havale-hint">Ödemeni yukarıdaki IBAN'a gönderirken açıklama kısmına e-posta adresini yaz. Ödemeyi tamamladıktan sonra aşağıdaki butona tıkla, satın alımın onaylandığında rozetin hemen aktifleşecek.</p>
        </div>
      </div>

      <div class="form-section" id="im-summary-section">
        <h2>Sipariş Özeti</h2>
        <div class="summary-row">
          <span class="summary-row-label" id="im-summary-tier-label">—</span>
          <span class="summary-row-value summary-total" id="im-summary-tier-price">—</span>
        </div>
        <div class="summary-row">
          <span class="summary-row-label">Yenileme</span>
          <span class="summary-row-value">Aylık, elle iptal edilene kadar</span>
        </div>
        <button class="form-submit" id="im-confirm-btn" type="button" style="margin-top:18px;">Ödemeyi Yaptım</button>
        <div class="form-notice" id="im-rozet-notice"></div>
      </div>

      <div class="form-section" id="im-already-has-section" style="display:none;">
        <div class="already-has">
          <strong id="im-already-has-title">Zaten aktif bir rozetin var</strong>
          <p id="im-already-has-text">Aynı ya da daha düşük bir kademeye geçemezsin. Bunun için mevcut rozetinin süresi dolmalı. Daha yüksek bir kademeye yükseltebilirsin.</p>
          <a class="form-submit" href="/hesabim" style="display:inline-block; width:auto; padding:12px 28px;">Hesabım'a Dön</a>
        </div>
      </div>
    </div>`;
  }

  function mountRozetAl() {
    fetch('/api/auth/me').then(res => { if (!res.ok) window.location.href = '/giris'; }).catch(() => {});

    // "Mesaj" perk'i her iki kademede de listelenir — bkz. architect-modal.js/office-modal.js#
    // renderMessageIcon (kullanıcı isteği 2026-08-30: doğrulanmış/altın üyeler artık TÜM kullanıcılara
    // mesaj gönderip TÜM kullanıcılardan mesaj alabilir — gönderen taraf rozetliyse alıcı profilin
    // kendi rozeti olması ARANMAZ, bkz. badge-shared.js#myEffectiveBadge; alıcı taraf da firma pozisyon
    // kısıtlaması olmadan mesaj alabilir, bkz. src/routes/messages.js#resolveRecipients).
    const BADGE_TIERS = [
      { type: 'verified', label: 'Doğrulanmış Üye', selfPrice: 49, officePrice: 129, perks: ['Doğrulanmış Üye rozeti verir.', 'Tüm kullanıcılara mesaj gönderip tüm kullanıcılardan mesaj alabilme özelliğini açar.'] },
      { type: 'gold', label: 'Altın Üye', selfPrice: 99, officePrice: 199, perks: ['Altın Üye rozeti verir.', 'Tüm kullanıcılara mesaj gönderip tüm kullanıcılardan mesaj alabilme özelliğini açar.'] },
    ];
    const BADGE_STATUS_LABELS = { pending: 'İnceleniyor', active: 'Aktif' };
    const BADGE_RANK = { gold: 2, verified: 1 };

    const params = new URLSearchParams(window.location.search);
    let selectedTier = BADGE_TIERS.find(t => t.type === params.get('tier')) ? params.get('tier') : BADGE_TIERS[0].type;
    let selectedTargetType = 'self';
    let selectedTargetKey = null;

    function priceForTier(tier) {
      return selectedTargetType === 'self' ? tier.selfPrice : tier.officePrice;
    }
    function formatTRY(n) { return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL'; }

    function renderTierGrid() {
      const grid = document.getElementById('im-tier-grid');
      grid.innerHTML = BADGE_TIERS.map(t => `
        <button type="button" class="tier-card${t.type === selectedTier ? ' selected' : ''}" data-type="${t.type}">
          <span class="tier-card-check">${t.type === selectedTier ? '✓' : ''}</span>
          <div class="tier-card-name">${t.label}</div>
          <div class="tier-card-price">${formatTRY(priceForTier(t))} / ay</div>
          <ul class="tier-card-perks">${t.perks.map(p => `<li>${p}</li>`).join('')}</ul>
        </button>`).join('');
      grid.querySelectorAll('.tier-card').forEach(card => {
        card.addEventListener('click', () => {
          selectedTier = card.dataset.type;
          renderTierGrid();
          renderSummary();
          updateExistingBadgePanel();
        });
      });
    }

    function renderSummary() {
      const tier = BADGE_TIERS.find(t => t.type === selectedTier);
      const priceLabel = formatTRY(priceForTier(tier));
      document.getElementById('im-summary-tier-label').textContent = tier.label;
      document.getElementById('im-summary-tier-price').textContent = `${priceLabel} / ay`;
      document.getElementById('im-havale-amount').textContent = priceLabel;
    }

    renderTierGrid();
    renderSummary();

    let myBadges = [];
    let myAdminBadges = { self: null, offices: {} };
    async function loadMyBadges() {
      try {
        const res = await fetch('/api/badges/mine');
        if (res.ok) {
          const data = await res.json();
          myBadges = data.items || [];
          myAdminBadges = data.adminBadges || { self: null, offices: {} };
        }
      } catch {}
      updateExistingBadgePanel();
    }

    function updateExistingBadgePanel() {
      const now = Date.now();
      const matches = (b) => b.target_type === selectedTargetType && (b.target_key || null) === selectedTargetKey;
      const activeBadge = myBadges.find(b => matches(b) && b.status === 'active' && (!b.expires_at || b.expires_at > now));
      const pendingBadge = myBadges.find(b => matches(b) && b.status === 'pending');
      // admin'in doğrudan verdiği rozet (bkz. satin-al.html'deki AYNI mantık, src/routes/badges.js#
      // getAdminBadgeForTarget sunucu tarafında da uygular).
      const adminBadgeType = selectedTargetType === 'office'
        ? (selectedTargetKey ? myAdminBadges.offices[selectedTargetKey] : null)
        : myAdminBadges.self;
      const activeRank = activeBadge ? (BADGE_RANK[activeBadge.badge_type] || 0) : 0;
      const adminRank = adminBadgeType ? (BADGE_RANK[adminBadgeType] ?? Infinity) : 0;
      const blockingRank = Math.max(activeRank, adminRank);
      const isDowngradeOrSame = blockingRank > 0 && (BADGE_RANK[selectedTier] || 0) <= blockingRank;
      let blocking = pendingBadge || null;
      if (!blocking && isDowngradeOrSame) {
        blocking = adminRank >= activeRank ? { badge_type: adminBadgeType, status: 'active', admin: true } : activeBadge;
      }

      const paymentSection = document.getElementById('im-payment-section');
      const summarySection = document.getElementById('im-summary-section');
      const alreadyHasSection = document.getElementById('im-already-has-section');
      if (!blocking) {
        paymentSection.style.display = '';
        summarySection.style.display = '';
        alreadyHasSection.style.display = 'none';
        return;
      }
      const tier = BADGE_TIERS.find(t => t.type === blocking.badge_type);
      paymentSection.style.display = 'none';
      summarySection.style.display = 'none';
      alreadyHasSection.style.display = 'block';
      const targetLabel = selectedTargetType === 'office' ? ` (${selectedTargetKey})` : '';
      document.getElementById('im-already-has-title').textContent =
        `${tier ? tier.label : blocking.badge_type} Rozetin${targetLabel} ${blocking.admin ? 'aktif' : (BADGE_STATUS_LABELS[blocking.status] || blocking.status.toLowerCase())}`;
      document.getElementById('im-already-has-text').textContent = blocking === pendingBadge
        ? 'Ödeme onayı bekleniyor. Sonucu Hesabım sayfandan takip edebilirsin.'
        : 'Aynı ya da daha düşük bir kademeye geçemezsin. Bunun için mevcut rozetinin süresi dolmalı. Daha yüksek bir kademeye yükseltebilirsin.';
    }
    loadMyBadges();

    async function loadClaimedOffices() {
      const select = document.getElementById('im-target-office-select');
      const empty = document.getElementById('im-target-office-empty');
      try {
        const res = await fetch('/api/claims/mine');
        const items = res.ok ? (await res.json()).items || [] : [];
        const offices = items.filter(c => c.profile_type === 'office' && c.status === 'approved');
        if (!offices.length) {
          select.style.display = 'none';
          empty.style.display = 'block';
          return;
        }
        select.style.display = '';
        empty.style.display = 'none';
        select.innerHTML = offices.map(o => `<option value="${escapeAttr(o.profile_key)}">${escapeHtml(o.profile_key)}</option>`).join('');
        selectedTargetKey = select.value || null;
      } catch {
        select.style.display = 'none';
        empty.style.display = 'block';
      }
    }
    document.getElementById('im-target-office-select').addEventListener('change', (e) => {
      selectedTargetKey = e.target.value || null;
      updateExistingBadgePanel();
    });
    document.querySelectorAll('input[name="im-badge-target"]').forEach(radio => {
      radio.addEventListener('change', () => {
        selectedTargetType = radio.value;
        document.getElementById('im-target-office-wrap').style.display = selectedTargetType === 'office' ? '' : 'none';
        if (selectedTargetType === 'office') {
          selectedTargetKey = document.getElementById('im-target-office-select').value || null;
          loadClaimedOffices();
        } else {
          selectedTargetKey = null;
        }
        renderTierGrid();
        renderSummary();
        updateExistingBadgePanel();
      });
    });

    const HAVALE_IBAN_RAW = 'TR220004600170888000248294';
    const havaleCopyBtn = document.getElementById('im-havale-copy-btn');
    havaleCopyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(HAVALE_IBAN_RAW);
        const original = havaleCopyBtn.textContent;
        havaleCopyBtn.textContent = 'Kopyalandı';
        setTimeout(() => { havaleCopyBtn.textContent = original; }, 1500);
      } catch {}
    });

    const ORIGINAL_BTN_LABEL = 'Ödemeyi Yaptım';
    document.getElementById('im-confirm-btn').addEventListener('click', async () => {
      const btn = document.getElementById('im-confirm-btn');
      const notice = document.getElementById('im-rozet-notice');
      notice.classList.remove('show', 'success');

      if (selectedTargetType === 'office' && !selectedTargetKey) { notice.textContent = 'Rozet almak için önce onaylı bir firma profiline sahip olmalısın.'; notice.classList.add('show'); return; }

      btn.disabled = true;
      btn.textContent = 'Gönderiliyor…';
      try {
        const res = await fetch('/api/badges', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ badgeType: selectedTier, targetType: selectedTargetType, targetKey: selectedTargetKey }),
        });
        if (res.status === 401) { window.location.href = '/giris'; return; }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          notice.textContent = data.error || 'Talep gönderilemedi, tekrar dene.';
          notice.classList.add('show');
          btn.disabled = false;
          btn.textContent = ORIGINAL_BTN_LABEL;
          return;
        }
        notice.textContent = 'Talebin alındı. Ödemen kontrol edilip onaylandığında rozetin aktif olacak — sonucu Hesabım sayfandan takip edebilirsin.';
        notice.classList.add('show', 'success');
        btn.textContent = 'Talebin Gönderildi';
        loadMyBadges();
      } catch {
        notice.textContent = 'Sunucuya ulaşılamadı, lütfen tekrar dene.';
        notice.classList.add('show');
        btn.disabled = false;
        btn.textContent = ORIGINAL_BTN_LABEL;
      }
    });
  }

  // ---------------------------------------------------------------------------------------------
  // İADE ET — iade-et.html#checkout-wrap ile BİREBİR aynı işaretleme/mantık (bkz. o dosya).
  // ---------------------------------------------------------------------------------------------
  function iadeEtTemplate() {
    return `
    <div class="page-head">
      <div class="eyebrow">İade Talebi</div>
      <h1>Rozet İadesi Talep Et</h1>
      <p>Satın aldığın bir rozet için iade istiyorsan aşağıdaki formu doldur. Talebin ekibimize ulaşır, onaylandığında iade tutarını belirttiğin IBAN'a göndeririz.</p>
    </div>
    <div class="checkout-wrap">
      <div class="form-section" id="im-order-section">
        <h2>Hangi Rozet İçin?</h2>
        <p class="section-hint">Satın aldığın rozetlerden hangisi için iade istiyorsun?</p>
        <div class="order-empty" id="im-order-empty" style="display:none;">
          <p>Henüz bir rozet satın alımın yok.</p>
          <a class="form-submit" href="/rozet-al" style="display:inline-block; width:auto; padding:12px 28px;">Rozet Satın Al</a>
        </div>
        <div class="field" id="im-order-field" style="margin-bottom:0;">
          <select id="im-order-select"></select>
        </div>
      </div>

      <div class="form-section" id="im-refund-section">
        <h2>İade Bilgilerin</h2>
        <p class="section-hint">İade tutarı, girdiğin IBAN'a havale/EFT ile gönderilir.</p>
        <div class="field">
          <label for="im-refund-iban">İade Alacağın IBAN</label>
          <input type="text" id="im-refund-iban" placeholder="TR.. .. .... .... .... .... ..">
        </div>
        <div class="field">
          <label for="im-refund-account-name">Hesap Sahibi Adı Soyadı</label>
          <input type="text" id="im-refund-account-name" autocomplete="name">
        </div>
        <div class="field">
          <label for="im-refund-reason">Sebep</label>
          <textarea id="im-refund-reason" placeholder="İade istemenin sebebini kısaca yaz."></textarea>
        </div>
        <button class="form-submit" id="im-refund-submit-btn" type="button" style="margin-top:6px;">İade Talebini Gönder</button>
        <div class="form-notice" id="im-iade-notice"></div>
      </div>
    </div>`;
  }

  function mountIadeEt() {
    const BADGE_TYPE_LABELS = { destekci: 'Destekçi', verified: 'Doğrulanmış Üye', gold: 'Altın Üye', platinum: 'Elmas Üye' };
    const BADGE_STATUS_LABELS = { pending: 'Onay Bekliyor', active: 'Aktif' };
    let iadeUser = null;
    let myOrders = [];

    function isValidIban(v) {
      const s = (v || '').replace(/\s+/g, '').toUpperCase();
      if (!/^TR\d{24}$/.test(s)) return false;
      const rearranged = s.slice(4) + s.slice(0, 4);
      const numeric = rearranged.replace(/[A-Z]/g, ch => (ch.charCodeAt(0) - 55).toString());
      let remainder = numeric;
      while (remainder.length > 9) {
        const block = remainder.slice(0, 9);
        remainder = (parseInt(block, 10) % 97).toString() + remainder.slice(block.length);
      }
      return parseInt(remainder, 10) % 97 === 1;
    }

    function orderLabel(b) {
      const tierLabel = BADGE_TYPE_LABELS[b.badge_type] || b.badge_type;
      const targetLabel = b.target_type === 'office' ? `Firma: ${b.target_key}` : 'Kendisi için';
      const statusLabel = BADGE_STATUS_LABELS[b.status] || b.status;
      const dateStr = new Date(b.created_at).toLocaleDateString('tr-TR');
      return `${tierLabel} — ${targetLabel} — ${statusLabel} (${dateStr})`;
    }

    async function loadMyOrders() {
      try {
        const res = await fetch('/api/badges/mine');
        const items = res.ok ? (await res.json()).items || [] : [];
        myOrders = items.filter(b => b.status !== 'rejected');
      } catch {
        myOrders = [];
      }
      const orderEmpty = document.getElementById('im-order-empty');
      const orderField = document.getElementById('im-order-field');
      const refundSection = document.getElementById('im-refund-section');
      if (!myOrders.length) {
        orderEmpty.style.display = 'block';
        orderField.style.display = 'none';
        refundSection.style.display = 'none';
        return;
      }
      orderEmpty.style.display = 'none';
      orderField.style.display = '';
      refundSection.style.display = '';
      document.getElementById('im-order-select').innerHTML = myOrders.map(b => `<option value="${escapeAttr(b.id)}">${escapeHtml(orderLabel(b))}</option>`).join('');
    }
    loadMyOrders();

    document.getElementById('im-refund-submit-btn').addEventListener('click', async () => {
      const btn = document.getElementById('im-refund-submit-btn');
      const notice = document.getElementById('im-iade-notice');
      notice.classList.remove('show', 'success');

      const orderId = document.getElementById('im-order-select').value;
      const order = myOrders.find(b => b.id === orderId);
      const iban = document.getElementById('im-refund-iban').value.trim();
      const accountName = document.getElementById('im-refund-account-name').value.trim();
      const reason = document.getElementById('im-refund-reason').value.trim();

      if (!order) { notice.textContent = 'Lütfen iade istediğin rozeti seç.'; notice.classList.add('show'); return; }
      if (!isValidIban(iban)) { notice.textContent = 'Geçerli bir IBAN gir (TR ile başlayan 26 karakter).'; notice.classList.add('show'); return; }
      if (!accountName) { notice.textContent = 'Hesap sahibinin adı soyadı gerekli.'; notice.classList.add('show'); return; }
      if (reason.length < 8) { notice.textContent = 'Sebebi biraz daha ayrıntılı yazar mısın?'; notice.classList.add('show'); return; }
      if (!iadeUser) { notice.textContent = 'Bu işlem için giriş yapmalısın.'; notice.classList.add('show'); return; }

      const message = [
        'İade Talebi',
        `Rozet: ${orderLabel(order)}`,
        `Tutar: ${Number(order.price_try).toFixed(2)} TL`,
        `İade IBAN: ${iban.replace(/\s+/g, '').toUpperCase()}`,
        `Hesap Sahibi: ${accountName}`,
        `Sebep: ${reason}`,
      ].join('\n');

      btn.disabled = true;
      btn.textContent = 'Gönderiliyor…';
      try {
        const res = await fetch('/api/contact', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: iadeUser.name, email: iadeUser.email, message }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          notice.textContent = data.error || 'Talep gönderilemedi, tekrar dene.';
          notice.classList.add('show');
          btn.disabled = false;
          btn.textContent = 'İade Talebini Gönder';
          return;
        }
        notice.textContent = 'İade talebin alındı. Ekibimiz en kısa sürede seninle iletişime geçecek.';
        notice.classList.add('show', 'success');
        btn.textContent = 'Talebin Gönderildi';
      } catch {
        notice.textContent = 'Sunucuya ulaşılamadı, lütfen tekrar dene.';
        notice.classList.add('show');
        btn.disabled = false;
        btn.textContent = 'İade Talebini Gönder';
      }
    });

    fetch('/api/auth/me').then(async res => {
      if (!res.ok) { window.location.href = '/giris'; return; }
      const data = await res.json().catch(() => ({}));
      iadeUser = data.user || null;
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Ortak modal-shell state machine — js/components/auth-modal.js#open/swap/close/handlePopState
  // ile AYNI desen (bkz. o dosyanın başındaki yorum).
  // ---------------------------------------------------------------------------------------------
  let currentView = null;
  let openedViaPush = false;
  let pushCountSinceOpen = 0;

  // kullanıcı isteği (2026-08-28): yalnızca Rozet Al/İade Et — İletişim/Hakkında/Gizlilik Politikası/
  // Hizmet Şartları/Çerez Politikası/Kariyer'in HİÇBİRİ değil — tablet/mobilde (≤960px, bkz.
  // site-chrome.js#NavDrawer AYNI kırılma noktası) artık ayrı bir ModalShell popup'ı yerine hamburger
  // çekmecesinin İÇİNDE kayan bir alt sayfa olarak açılır (bkz. js/components/auth-modal.js#
  // isMobileDrawer'daki AYNI mekanizma/gerekçe). Diğer beş görünüm HER genişlikte eskisi gibi
  // ModalShell popup'ında kalmaya devam eder.
  const MOBILE_DRAWER_VIEWS = new Set(['rozet-al', 'iade-et']);
  function isMobileDrawer(view) {
    return MOBILE_DRAWER_VIEWS.has(view) && !!(window.NavDrawer && window.matchMedia('(max-width:960px)').matches);
  }
  function currentHostIsMobile() {
    return !!(window.NavDrawer && window.NavDrawer.isSubpageActive());
  }
  function activateHost(mobile) {
    if (mobile) window.NavDrawer.showSubpage({ onBack: backToMenu, onRequestFullClose: close });
    else ModalShell.open({ triggerEl: null, onRequestClose: close });
  }
  function deactivateHost(mobile) {
    if (mobile) window.NavDrawer.closeDrawer();
    else { ModalShell.close(); unmountSingleColumn(); }
  }

  function renderView(view) {
    ensureStyles();
    const mobile = isMobileDrawer(view);
    let hostEl;
    if (mobile) {
      hostEl = window.NavDrawer.getSubpageBodyEl();
      hostEl.innerHTML = '';
    } else {
      // bkz. js/components/modal-shell.js#claimContent — auth-modal.js#renderView'daki AYNI gerçek
      // bulgu: sahip değiştiyse paneller zaten boşaltılmış/bodyEl temel sınıfa sıfırlanmış olur.
      const panels = ModalShell.claimContent('info');
      panels.bodyEl.classList.add('info-single');
      panels.rightPanelEl.innerHTML = '';
      panels.leftPanelEl.innerHTML = '';
      hostEl = panels.leftPanelEl;
    }
    const wrap = document.createElement('div');
    wrap.id = 'im-panel';
    hostEl.appendChild(wrap);
    if (view === 'rozet-al') { wrap.innerHTML = rozetAlTemplate(); mountRozetAl(); }
    else if (view === 'iade-et') { wrap.innerHTML = iadeEtTemplate(); mountIadeEt(); }
    else if (view === 'iletisim') { wrap.innerHTML = iletisimTemplate(); wireIletisim(); }
    else if (view === 'hakkinda') { wrap.innerHTML = hakkindaTemplate(); }
    else if (view === 'gizlilik-politikasi') { wrap.innerHTML = gizlilikTemplate(); wireInPanelAnchors(wrap); }
    else if (view === 'hizmet-sartlari') { wrap.innerHTML = hizmetTemplate(); wireInPanelAnchors(wrap); }
    else if (view === 'cerez-politikasi') { wrap.innerHTML = cerezTemplate(); wireInPanelAnchors(wrap); }
    else { wrap.innerHTML = kariyerTemplate(); }
    if (mobile) {
      hostEl.scrollTop = 0;
    } else {
      // denetim bulgusu (AUDIT-009): bkz. auth-modal.js#renderView'daki AYNI gerekçe — bu modal da
      // document.title'ı değiştirmiyor, src/index.js#INFO_MODAL_META'daki başlıklarla (- MİMARLAB
      // soneki hariç) tutarlı sabit bir Türkçe etiket haritası.
      const INFO_VIEW_LABELS = {
        'rozet-al': 'Rozet Satın Al', 'iade-et': 'Rozet İadesi Talep Et', 'iletisim': 'İletişim',
        'hakkinda': 'Hakkında', 'gizlilik-politikasi': 'Gizlilik Politikası', 'hizmet-sartlari': 'Hizmet Şartları',
        'cerez-politikasi': 'Çerez Politikası',
      };
      ModalShell.setLabel(INFO_VIEW_LABELS[view] || 'Kariyer');
      ModalShell.scrollToTop();
    }
  }

  function isOpen() { return currentView !== null; }

  function open(view, { pushHistory = true, triggerEl = null } = {}) {
    currentView = view;
    openedViaPush = pushHistory;
    pushCountSinceOpen = pushHistory ? 1 : 0;
    if (pushHistory) history.pushState({ mimarlabModal: 'info', view, depth: 1 }, '', VIEW_PATH[view]);
    if (isMobileDrawer(view)) window.NavDrawer.showSubpage({ onBack: backToMenu, onRequestFullClose: close });
    else ModalShell.open({ triggerEl, onRequestClose: close });
    renderView(view);
  }

  function swap(view) {
    if (!isOpen()) return open(view, { pushHistory: true });
    const wasMobile = currentHostIsMobile();
    currentView = view;
    const currentDepth = (history.state && history.state.mimarlabModal === 'info') ? history.state.depth : pushCountSinceOpen;
    pushCountSinceOpen = currentDepth + 1;
    history.pushState({ mimarlabModal: 'info', view, depth: pushCountSinceOpen }, '', VIEW_PATH[view]);
    const willBeMobile = isMobileDrawer(view);
    if (wasMobile !== willBeMobile) { deactivateHost(wasMobile); activateHost(willBeMobile); }
    renderView(view);
  }

  // .info-single sınıfı (bkz. renderView()) paylaşılan modal-shell bodyEl'e eklenir — proje/mimar/
  // firma/ürün/auth modalları da AYNI bodyEl'i kullandığından (bkz. js/components/auth-modal.js#
  // unmountSingleColumn AYNI gerekçe) kapatırken KALDIRILMAZSA bir sonraki açılan başka bir modalın
  // ızgarasını bozardı.
  function unmountSingleColumn() {
    const panels = ModalShell.getPanels();
    if (panels) panels.bodyEl.classList.remove('info-single');
  }

  // bkz. js/components/auth-modal.js#backToMenu — BİREBİR aynı gerekçe, yalnızca Rozet Al/İade Et'in
  // mobil çekmece breadcrumb'ından ("‹ Menü") çağrılır.
  function backToMenu() {
    currentView = null;
    if (openedViaPush && pushCountSinceOpen > 0) history.go(-pushCountSinceOpen);
    else history.pushState({}, '', '/');
    if (window.NavDrawer) window.NavDrawer.hideSubpage();
    pushCountSinceOpen = 0;
  }

  function close() {
    const mobile = currentHostIsMobile();
    currentView = null;
    if (openedViaPush && pushCountSinceOpen > 0) history.go(-pushCountSinceOpen);
    else history.pushState({}, '', '/');
    deactivateHost(mobile);
    pushCountSinceOpen = 0;
  }

  function handlePopState(view) {
    if (!view) { if (isOpen()) { currentView = null; deactivateHost(currentHostIsMobile()); } return; }
    if (!isOpen()) { openedViaPush = false; open(view, { pushHistory: false }); return; }
    if (history.state && history.state.mimarlabModal === 'info' && typeof history.state.depth === 'number') {
      pushCountSinceOpen = history.state.depth;
    }
    if (view === currentView) return;
    const wasMobile = currentHostIsMobile();
    currentView = view;
    const willBeMobile = isMobileDrawer(view);
    if (wasMobile !== willBeMobile) { deactivateHost(wasMobile); activateHost(willBeMobile); }
    renderView(view);
  }

  // bkz. js/components/auth-modal.js'in dosya sonundaki AYNI resize dinleyicisi/gerekçe — yalnızca
  // Rozet Al/İade Et için (isMobileDrawer(currentView) diğer beş görünümde her zaman false döner).
  window.addEventListener('resize', () => {
    if (!isOpen() || !window.NavDrawer) return;
    const wasMobile = currentHostIsMobile();
    const willBeMobile = isMobileDrawer(currentView);
    if (wasMobile === willBeMobile) return;
    deactivateHost(wasMobile);
    activateHost(willBeMobile);
    renderView(currentView);
  });

  function pathToView(pathname) {
    const path = pathname.replace(/\/$/, '') || '/';
    for (const key in VIEW_PATH) { if (VIEW_PATH[key] === path) return key; }
    return null;
  }

  // Header/footer'daki MEVCUT bağlantılar (bkz. dosya başı yorumu) — hiçbir sayfanın href'i
  // değiştirilmedi, yalnızca burada delege edilip preventDefault edilir. AuthModal'ınkiyle AYNI
  // desen — iki modül birbirinden habersiz, aynı VIEW_PATH mantığını kendi görünümleri için
  // bağımsızca uygular; ModalShell tek paylaşılan singleton'dur.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const href = a.getAttribute('href');
    let view = null;
    for (const key in HREF_VIEW_RE) { if (HREF_VIEW_RE[key].test(href)) { view = key; break; } }
    if (!view) return;
    e.preventDefault();
    if (isOpen()) swap(view); else open(view, { triggerEl: a });
  });

  window.addEventListener('popstate', () => {
    const view = pathToView(location.pathname);
    if (view) { handlePopState(view); return; }
    if (isOpen()) handlePopState(null);
  });

  // Doğrudan URL ile açılış (F5/deep-link) — bkz. kullanıcı isteği: "Sayfa yenilendiğinde veya
  // doğrudan URL'ye gidildiğinde modal açık olarak render edilsin".
  const initialView = pathToView(location.pathname);
  if (initialView) open(initialView, { pushHistory: false });

  return { open, swap, close, handlePopState, isOpen };
})();
// bkz. auth-modal.js sonundaki AYNI window.AuthModal notu — lazy-modals.js'in dinamik yüklemesi için.
window.InfoModal = InfoModal;
