// PasswordReveal — şifre kutusunun EN SAĞINA bir göz işareti koyar; tıklanınca şifre açık görünür
// (kullanıcı isteği, 2026-09-16 ikinci tur madde 3: "Giriş yap ekranında şifre kutucuğunun en
// sağında bir göz işareti olsun ve buna tıklayınca şifre açık gözüksün.").
//
// NEDEN PAYLAŞILAN BİR MODÜL (iki yüzeye ayrı ayrı yazmak yerine): "Giriş yap ekranı" bu depoda İKİ
// yerde yaşıyor — bağımsız sayfa (giris-yap.html) ve her sayfadan açılan pop-up
// (js/components/auth-modal.js#loginTemplate). İki kopya yazılsaydı düğmenin ölçüsü/davranışı
// zamanla ayrışırdı; bkz. CLAUDE.md'de aynı sınıf ayrışmanın tekrar tekrar kelepçelendiği yerler
// ("Kural İKİ yüzeyde de var").
//
// SÖZLEŞME: wire(input) input'un KENDİSİNİ hiç değiştirmez — id'si, name'i, required'ı, type'ı
// (tıklanana kadar) ve DOM'daki YERİ korunur. Yalnızca ETRAFINA bir sarmalayıcı (.pw-reveal-wrap)
// eklenir ve düğme onun içine konur. Bu şart: formu gönderen kodlar input'a id ile ulaşıyor
// (document.getElementById('login-password').value) ve tarayıcının şifre yöneticisi de aynı
// düğüme bakıyor — input'u yeniden OLUŞTURMAK ikisini de sessizce bozardı.
//
// ERİŞİLEBİLİRLİK: düğme `type="button"` (aksi halde formu GÖNDERİRDİ — varsayılan tür "submit"),
// aria-pressed durumu taşır ve aria-label duruma göre değişir. tabindex VERİLMEZ: düğme input'tan
// hemen sonra geldiğinden doğal sekme sırası zaten doğrudur.
(function () {
  const EYE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12Z"/><circle cx="12" cy="12" r="3.2"/></svg>';
  // Kapalı hâl: aynı göz + üzerinden geçen eğik çizgi. İki ikon AYNI viewBox/stroke değerlerini
  // taşır ki değiştirirken kutu içinde zıplamasın.
  const EYE_OFF = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12Z"/><circle cx="12" cy="12" r="3.2"/><line x1="3" y1="21" x2="21" y2="3"/></svg>';

  function injectStyles() {
    if (document.getElementById('password-reveal-styles')) return;
    const style = document.createElement('style');
    style.id = 'password-reveal-styles';
    // DİKKAT: bu şablon dizesinde ters tırnak ya da // yorumu KULLANMA (bkz. proje notu
    // [[feedback_no_backtick_in_style_template_literals]] — enjekte edilen CSS sessizce bozulur).
    //
    // Sarmalayici position:relative; dugme onun icinde mutlak konumlu. Input'un GENISLIGINE
    // dokunulmaz (sayfa CSS'i width:100% diyor) — yerine sag PADDING'i buradan artirilir, boylece
    // uzun bir sifre dugmenin ALTINA girmez. !important SART: kural sayfanin kendi
    // ".auth-field input" kuralindan sonra enjekte edilse de ozgulluk (specificity) esit degil ve
    // padding kisayolu tek tek uzun yazimi ezebiliyor.
    style.textContent = `
      .pw-reveal-wrap{position:relative; display:block;}
      .pw-reveal-wrap > input{padding-right:44px !important;}
      .pw-reveal-btn{
        position:absolute; top:50%; right:6px; transform:translateY(-50%);
        width:32px; height:32px; padding:0; border:none; background:none; cursor:pointer;
        display:flex; align-items:center; justify-content:center; line-height:0;
        color:var(--ink-soft, #6B7280); border-radius:8px;
      }
      .pw-reveal-btn:hover{color:var(--ink, #1B2A3D);}
      .pw-reveal-btn:focus-visible{box-shadow:0 0 0 2px var(--brass, #C9A227);}
    `;
    document.head.appendChild(style);
  }

  function paint(btn, revealed) {
    btn.innerHTML = revealed ? EYE_OFF : EYE;
    btn.setAttribute('aria-pressed', revealed ? 'true' : 'false');
    btn.setAttribute('aria-label', revealed ? 'Şifreyi gizle' : 'Şifreyi göster');
    btn.title = revealed ? 'Şifreyi gizle' : 'Şifreyi göster';
  }

  // Aynı input'a iki kez düğme takılmaz: login pop-up'ı şablonunu her açılışta yeniden basabilir
  // ve wire() o zaman tekrar çağrılır.
  function wire(input) {
    if (!input || input.dataset.pwRevealed === '1') return null;
    injectStyles();
    input.dataset.pwRevealed = '1';
    const wrap = document.createElement('span');
    wrap.className = 'pw-reveal-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-reveal-btn';
    paint(btn, false);
    wrap.appendChild(btn);
    btn.addEventListener('click', () => {
      const revealed = input.type === 'text';
      input.type = revealed ? 'password' : 'text';
      paint(btn, !revealed);
      // Odak kutuya geri döner ve imleç metnin SONUNA konur — düğmeye bastıktan sonra kullanıcı
      // yazmaya devam edebilsin. setSelectionRange type değişiminden sonra çağrılmalı: tarayıcılar
      // type="password" alanlarında seçim API'sini kısıtlayabiliyor.
      try {
        input.focus();
        const end = input.value.length;
        input.setSelectionRange(end, end);
      } catch (e) { /* seçim API'si kullanılamıyorsa odak yeterli */ }
    });
    return btn;
  }

  // wireAll(root, selector) — bir kabuğun içindeki şifre kutularını topluca bağlar. Varsayılan
  // seçici YOK: bu modül "sayfadaki her şifre kutusunu" kendiliğinden bağlamaz, çağıran hangi
  // kutuyu istediğini açıkça söyler (kullanıcı isteği yalnızca GİRİŞ ekranı içindi).
  function wireAll(root, selector) {
    const scope = root || document;
    return Array.from(scope.querySelectorAll(selector || 'input[type="password"]')).map(wire).filter(Boolean);
  }

  window.PasswordReveal = { wire: wire, wireAll: wireAll };

  // OTOMATİK BAĞLAMA — `data-password-reveal` taşıyan kutular. Bu, SIRALAMA TUZAĞINI yapısal
  // olarak kapatır: bir sayfa bu dosyayı <script defer> ile yüklüyorsa, sayfanın KENDİ satır içi
  // script'i ondan ÖNCE çalışır (defer'li script'ler belge ayrıştırıldıktan sonra, satır içi
  // script'ler ise parse anında koşar) ve orada yazılacak bir PasswordReveal.wire() çağrısı
  // "PasswordReveal is not defined" ile patlardı. İşaret özniteliğiyle sayfa yalnızca NİYETİNİ
  // bildirir, bağlama zamanı bu modülün kendi sorunudur.
  //
  // Dinamik olarak basılan kabuklar (ör. js/components/auth-modal.js#loginTemplate) bu taramaya
  // yetişmez — onlar wire()'ı kendileri çağırır (wire() aynı input'a iki kez takmaz).
  function sweep() { wireAll(document, '[data-password-reveal]'); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sweep);
  else sweep();
})();
