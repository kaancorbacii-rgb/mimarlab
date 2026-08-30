// Paylaşılan "Bu profil sana mı ait?" (claim) + "Geri Bildirim" (correction) yan sütun kutuları ve
// bunlara bağlı "Düzenle" butonu (Arşivle/Sil kaldırıldı, bkz. kullanıcı isteği 2026-08-30): mimar-
// detay.html ve ofis-detay.html'de birebir aynı akışı (yalnızca metin/anahtar/uç nokta farklarıyla)
// tekilleştirir (bkz.
// docs/architecture-roadmap.md Faz 2). save-widget.js gibi diğer paylaşılan script'lerle aynı
// desen: her sayfa <script src="js/components/claim-correction-box.js"> ile dahil eder ve
// createClaimCorrectionBox(config) çağırıp döneni kullanır — bu dosya `currentUser` (save-widget.js)
// ile `escapeAttr`/`escapeHtml` (her sayfanın kendi inline script'i) global'lerinin zaten
// tanımlı olduğunu varsayar. Görsel stili js/components/product-modal.js#wireFeedbackBox'daki
// .pr-feedback-card/.feedback-input-wrap deseniyle BİREBİR aynı (bkz. kullanıcı isteği) —
// tekilleştirmek için o desen buraya .feedback-card/.feedback-input-wrap adıyla taşındı.
//
// config alanları:
//   profileType        'architect' | 'office'
//   ready              (Promise, opsiyonel) currentUser hazır olana kadar beklenir — savedWidgetReady
//   getProfileKey()    claim/correction API çağrılarında kullanılacak GÜNCEL profil anahtarını döner
//   getClaimLinkKey()  (opsiyonel) "Düzenle" linkindeki ?claim= parametresi için anahtar döner;
//                      verilmezse getProfileKey() kullanılır (ofis yeniden adlandırmasında bunlar
//                      farklıdır, bkz. data.js#renameOfficeEverywhere / _claimKey)
//   editUrlBase        'mimar-ekle.html' | 'firma-ekle.html'
//   labels             { claimTitle, loginPromptHtml, pendingHtml, claimNoteDescription,
//                         claimButtonText }
//   onEditClick        (opsiyonel) verilirse "Düzenle" bir <a href> yerine <button> olur ve
//                      tıklanınca bu callback çağrılır (sayfa değiştirmeden inline düzenleme
//                      açmak için, bkz. kullanıcı isteği) — verilmezse mevcut link davranışı korunur.
//   isStale()          (opsiyonel) çağrılan sayfa (architect-modal.js/office-modal.js) her
//                      renderItem() başında GÜNCELLENEN kendi currentItem'ıyla karşılaştırıp bu
//                      claimBox örneğinin hâlâ EKRANDA GÖRÜNEN profile mi ait olduğunu söyler — bkz.
//                      loadClaimCard/renderProfileEditButton içindeki gerçek bulgu. Verilmezse hiç
//                      kontrol edilmez (eski davranış, yalnızca product/project profillerinde
//                      claim-correction-box kullanılmadığından bu callback'e zaten ihtiyaç yok).
function createClaimCorrectionBox(config){
  let isProfileOwner = false;
  const getClaimLinkKey = config.getClaimLinkKey || config.getProfileKey;

  // product-modal.js#injectStyles'daki AYNI .pr-feedback-card kuralları — burada iki kutu (claim +
  // geri bildirim) AYNI sayfada yan yana durduğundan ID yerine class seçiciler kullanılır. Claim
  // kutusunun CTA'sı ("Bu profil/firma bana ait") "Bildir"den uzun olduğundan --wide varyantı
  // metnin buton altına gizlenmemesi için textarea'nın sağ iç boşluğunu büyütür.
  function injectStyles(){
    if(document.getElementById('claim-correction-box-styles')) return;
    const style = document.createElement('style');
    style.id = 'claim-correction-box-styles';
    style.textContent = `
      .feedback-card{margin-top:20px; padding:18px; border:1px solid var(--line); border-radius:14px; background:var(--paper);}
      .feedback-card[open]{padding-bottom:18px;}
      .feedback-card h5{margin:0 0 6px; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:14px; font-weight:700;}
      .feedback-card p{margin:0 0 10px; font-size:13px; color:var(--ink-soft); line-height:1.5;}
      .feedback-card .info-card-link{font-weight:700; text-decoration:underline;}
      /* Kartlar ilk açılışta kapalı (bkz. kullanıcı isteği: "Geri Bildirim +" ön başlığı, tıklanınca
         açılsın) — native <details>/<summary> kullanılır, JS state yönetimi gerekmez. summary'nin
         varsayılan üçgen imleci kaldırılıp yerine dönen bir "+" konur. */
      .feedback-card > summary{list-style:none; cursor:pointer; display:flex; align-items:center; justify-content:space-between; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:14px; font-weight:700; color:var(--ink);}
      .feedback-card > summary::-webkit-details-marker{display:none;}
      .feedback-card[open] > summary{margin-bottom:6px;}
      .feedback-card-plus{flex-shrink:0; width:18px; height:18px; position:relative; margin-left:10px;}
      .feedback-card-plus::before, .feedback-card-plus::after{content:''; position:absolute; top:50%; left:50%; background:var(--ink-soft); transform:translate(-50%,-50%); transition:transform 0.15s ease;}
      .feedback-card-plus::before{width:12px; height:2px;}
      .feedback-card-plus::after{width:2px; height:12px;}
      .feedback-card[open] .feedback-card-plus::after{transform:translate(-50%,-50%) rotate(90deg); opacity:0;}
      .feedback-input-wrap{position:relative;}
      .feedback-input-wrap textarea{width:100%; min-height:64px; padding:9px 92px 40px 12px; border:1px solid var(--line); border-radius:10px; background:var(--paper-card); font-family:inherit; font-size:12.5px; color:var(--ink); resize:vertical;}
      .feedback-input-wrap--wide textarea{padding-right:160px;}
      .feedback-input-wrap button{position:absolute; right:6px; bottom:6px; background:var(--ink); color:var(--paper-card); padding:7px 14px; border-radius:100px; font-weight:600; font-size:12px; border:none;}
      .feedback-input-wrap button:hover{background:var(--walnut);}
      .feedback-input-wrap button:disabled{opacity:0.5; cursor:not-allowed;}
      .feedback-result{margin:8px 0 0; font-size:12px; color:var(--sage);}
    `;
    document.head.appendChild(style);
  }

  // Onaylı bir rozeti (Doğrulanmış/Altın/Elmas Üye) olan profillerde "Bu profil sana mı ait?"
  // daveti anlamsız — kimliği zaten doğrulanmış demektir. badge-shared.js#dynamicBadges (satın
  // alınıp onaylanmış gerçek rozetler) VE config.getStaticBadges (seed/statik rozet) birlikte
  // kontrol edilir, tıpkı verifiedBadgeHtml'in kendisi gibi.
  async function hasActiveBadge(profileKey){
    if(typeof badgesReadyPromise !== 'undefined') await badgesReadyPromise;
    const dynamic = (typeof dynamicBadges !== 'undefined' && dynamicBadges[config.profileType] && dynamicBadges[config.profileType][profileKey]) || [];
    const staticBadges = config.getStaticBadges ? (config.getStaticBadges() || []) : [];
    return (dynamic.length ? dynamic : staticBadges).length > 0;
  }

  async function loadClaimCard(){
    isProfileOwner = false;
    const card = document.getElementById('claim-info-card');
    const body = document.getElementById('claim-card-body');
    // Bu fonksiyon TÜM ClaimCorrectionBox çağıranları için (init() üzerinden) çalışır, ama yalnızca
    // architect-modal.js/office-modal.js şablonlarında bir #claim-info-card elemanı var — project/
    // product profilleri (yalnızca loadCorrectionCard'ı kullanır, bkz. src/routes/claims.js#
    // PROFILE_TYPES'ın architect/office ile sınırlı olması) bu kutuyu DOM'a hiç koymaz.
    // isProfileOwner hesaplaması yine de aşağıda çalışmalı ki Düzenle butonu doğru görünürlükte
    // kalsın, yalnızca görünür kart güncellemeleri atlanır.
    if(!card || !body){
      if(config.ready) await config.ready;
      if(!currentUser) return;
      try{
        const res = await fetch(`/api/claims/status?profileType=${config.profileType}&profileKey=${encodeURIComponent(config.getProfileKey())}`);
        const data = res.ok ? await res.json() : { status: 'none' };
        isProfileOwner = data.status === 'approved';
      }catch{}
      return;
    }
    card.style.display = '';
    if(config.ready) await config.ready;
    // gerçek bulgu (denetim, 2026-08-24): bu fonksiyonun aşağıdaki 2-3 sıralı await'i sürerken
    // kullanıcı hızlıca BAŞKA bir mimara/firmaya geçerse (ör. "Diğer Firma Ortakları"/"Kurucular"
    // ızgarasından), architect-modal.js/office-modal.js her renderItem() başında YENİ bir claimBox
    // örneği oluşturup #claim-info-card/#claim-card-body/#profile-edit-slot'u (owner DEĞİŞMEDİĞİ
    // sürece claimContent() tarafından TEMİZLENMEYEN, kalıcı/paylaşılan elemanlar) yeniden doldurmayı
    // dener — ama bu ESKİ çağrı da hâlâ sürüyorsa, geç dönen yanıtı en SON yazan o olup admin/sahip
    // butonlarını (runProfileModeration'a ESKİ profilin key'iyle kapatılmış) YENİ görünen profilin
    // header'ına yazabiliyordu (bkz. isStale kontrolü ve dosya başı config.isStale yorumu).
    if(config.isStale && config.isStale()) return;
    const profileKey = config.getProfileKey();

    // Bu profil BAŞKA bir hesap tarafından da olsa zaten onaylı şekilde sahiplenildiyse (bkz.
    // /api/public/claim-status, auth gerektirmez), kutucuğu kimden bakılırsa bakılsın gizle —
    // aksi halde her ziyaretçi, profil zaten sahiplenilmiş olsa bile "sana mı ait?" davetini görürdü.
    let alreadyClaimed = false;
    try{
      const claimStatusRes = await fetch(`/api/public/claim-status?profileType=${config.profileType}&profileKey=${encodeURIComponent(profileKey)}`);
      if(claimStatusRes.ok) alreadyClaimed = !!(await claimStatusRes.json()).claimed;
    }catch{}
    const badged = await hasActiveBadge(profileKey);
    if(config.isStale && config.isStale()) return;

    if(!currentUser){
      // Anonim ziyaretçi asla profil sahibi olamayacağından (isProfileOwner burada hep false kalır),
      // rozetli bir profilde davet kutusunu göstermeden hemen çıkabiliriz.
      if(alreadyClaimed || badged){ card.style.display = 'none'; return; }
      body.innerHTML = `<p>${config.labels.loginPromptHtml}</p>`;
      return;
    }
    try{
      const res = await fetch(`/api/claims/status?profileType=${config.profileType}&profileKey=${encodeURIComponent(profileKey)}`);
      const data = res.ok ? await res.json() : { status: 'none' };
      if(config.isStale && config.isStale()) return;
      if(data.status === 'approved'){
        isProfileOwner = true;
        card.style.display = 'none';
      } else if(data.status === 'pending'){
        body.innerHTML = `<p>${config.labels.pendingHtml}</p>`;
      } else if(alreadyClaimed){
        card.style.display = 'none';
      } else {
        body.innerHTML = `<p>${config.labels.claimNoteDescription}</p>
          <div class="feedback-input-wrap feedback-input-wrap--wide">
            <textarea id="claim-note" placeholder=""></textarea>
            <button type="button" id="claim-btn">${config.labels.claimButtonText}</button>
          </div>`;
        document.getElementById('claim-btn').addEventListener('click', async (e)=>{
          const btn = e.target;
          btn.disabled = true; btn.textContent = 'Gönderiliyor…';
          const note = document.getElementById('claim-note').value;
          // gerçek bulgu (denetim, 2026-08-24): burada try/catch YOKTU — aşağıdaki correction-btn
          // handler'ının aksine. Ağ hatasında (offline/timeout) fetch reddi hiç yakalanmadığından
          // loadClaimCard() (butonu yeniden normal duruma döndüren TEK yer) hiç çalışmıyor, buton
          // sayfa yenilenene kadar kalıcı olarak "Gönderiliyor…" yazıp devre dışı kalıyordu.
          try{
            const res = await fetch('/api/claims', {
              method:'POST', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ profileType: config.profileType, profileKey: config.getProfileKey(), note }),
            });
            if(!res.ok){ btn.disabled = false; btn.textContent = config.labels.claimButtonText; return; }
            loadClaimCard();
          }catch{
            btn.disabled = false; btn.textContent = config.labels.claimButtonText;
          }
        });
      }
    }catch{}

    // isProfileOwner (yukarıda) bu bloktan ETKİLENMEDEN doğru hesaplanmış olsun diye kutunun
    // görünürlüğü en son burada, tüm dallardan SONRA zorlanır — sahibi olsa bile "Düzenle" butonu
    // (renderProfileEditButton) hâlâ görünür kalmalı, yalnızca bu davet kutusu gizlenir.
    if(!isProfileOwner && badged) card.style.display = 'none';
  }

  function loadCorrectionCard(){
    const extra = document.getElementById('correction-card-extra');
    if(!extra) return;
    if(!currentUser){
      extra.innerHTML = `<p style="margin-top:10px;">Bir bildirim göndermek için <a href="giris-yap.html" class="info-card-link">giriş yap</a>.</p>`;
      return;
    }
    extra.innerHTML = `
      <div class="feedback-input-wrap">
        <textarea id="correction-note" placeholder=""></textarea>
        <button type="button" id="correction-btn">Bildir</button>
      </div>
      <p id="correction-feedback" class="feedback-result" style="display:none;"></p>`;
    document.getElementById('correction-btn').addEventListener('click', async (e)=>{
      const btn = e.target;
      const note = document.getElementById('correction-note').value.trim();
      const feedback = document.getElementById('correction-feedback');
      if(!note){
        feedback.textContent = 'Lütfen bir not yaz.';
        feedback.style.display = '';
        return;
      }
      btn.disabled = true; btn.textContent = 'Gönderiliyor…';
      try{
        const res = await fetch('/api/corrections', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ profileType: config.profileType, profileKey: config.getProfileKey(), note }),
        });
        feedback.textContent = res.ok ? 'Teşekkürler, önerini aldık.' : 'Bir şeyler ters gitti, tekrar dene.';
        feedback.style.display = '';
        if(res.ok) document.getElementById('correction-note').value = '';
      } catch {
        feedback.textContent = 'Sunucuya ulaşılamadı, tekrar dene.';
        feedback.style.display = '';
      } finally {
        btn.disabled = false; btn.textContent = 'Bildir';
      }
    });
  }

  // Profilin onaylı sahibi (isProfileOwner, bkz. loadClaimCard) ya da admin ise modal-shell.js'in
  // paylaşılan header'ında, X butonunun yanında bir "Düzenle" butonu gösterir (bkz. kullanıcı
  // isteği) — admin hiçbir profili sahiplenmeden de düzenleyebilir (bkz. src/routes/
  // submissions.js#verifyClaimedProfileKey admin bypass). Arşivle/Sil kaldırıldı (bkz. kullanıcı
  // isteği, 2026-08-30) — #profile-edit-slot artık yalnızca Düzenle'yi taşıyor.
  // architect-modal.js/office-modal.js tarafından header'ın İÇİNE yazılıyor (bkz. o dosyalar).
  // Firma düzenleme yetkisi artık yalnızca onaylı bir sahiplenmeye değil pozisyona da bağlı (bkz.
  // kullanıcı isteği: "Firma düzenleme yetkisi sadece admin, firma kurucusu, kurucu ortağı, ortağı
  // ve ekip liderinde olsun") — src/routes/submissions.js#OFFICE_EDIT_POSITIONS ile BİREBİR aynı
  // liste; sunucu tarafı asıl kapı, bu yalnızca artık kaydedemeyecek bir Ekip Üyesi'ne baştan
  // yanıltıcı bir "Düzenle" butonu göstermemek için.
  const OFFICE_EDIT_POSITIONS = new Set(['Kurucu', 'Kurucu Ortak', 'Ortak', 'Ekip Lideri']);
  function renderProfileEditButton(){
    const slot = document.getElementById('profile-edit-slot');
    if(!slot) return;
    const canEditByPosition = config.profileType !== 'office' || OFFICE_EDIT_POSITIONS.has(currentUser && currentUser.position);
    if(!currentUser || !((isProfileOwner && canEditByPosition) || currentUser.role === 'admin')){ slot.innerHTML = ''; return; }
    // editButtonText — opsiyonel, verilmezse mimar/firma modallarındaki AYNI "Düzenle" varsayılanı
    // korunur (bkz. kullanıcı isteği: danışman modalında "Profili Düzenle" yazsın — diğer çağıranlar
    // etkilenmesin diye buraya bir varsayılan değerle eklendi).
    const editLabel = (config.labels && config.labels.editButtonText) || 'Düzenle';
    const editButtonHtml = config.onEditClick
      ? `<button type="button" class="profile-edit-btn" id="profile-edit-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
          ${editLabel}
        </button>`
      : `<a class="profile-edit-btn" href="${config.editUrlBase}?claim=${encodeURIComponent(getClaimLinkKey())}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
          ${editLabel}
        </a>`;
    slot.innerHTML = editButtonHtml;
    if(config.onEditClick) document.getElementById('profile-edit-btn').addEventListener('click', () => config.onEditClick());
  }

  async function init(){
    injectStyles();
    await loadClaimCard();
    // gerçek bulgu (bkz. loadClaimCard içindeki AYNI isStale yorumu): loadClaimCard() kendi İÇİNDEKİ
    // yazımları zaten korur, ama kendisi normal döndüğünde (erken return olmadan) init() burada yine
    // de devam edip renderProfileEditButton()/loadCorrectionCard()'ı çağırırdı — bu ikisi
    // #profile-edit-slot/#correction-card-extra'ya (claimContent() sahip DEĞİŞMEDİĞİ sürece TEMİZLENMEYEN,
    // paylaşılan elemanlar) YAZAR; await loadClaimCard() dönene kadar geçen sürede kullanıcı zaten
    // BAŞKA bir profile geçmiş olabilir. Tek bir kontrol burada her iki yazımı da kapsar.
    if(config.isStale && config.isStale()) return;
    renderProfileEditButton();
    loadCorrectionCard();
  }

  return { init, loadClaimCard, loadCorrectionCard, renderProfileEditButton, isOwner: () => isProfileOwner };
}
