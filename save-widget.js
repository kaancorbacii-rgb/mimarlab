// Paylaşılan "Kaydet" (bookmark) widget'ı: proje/ürün/haber/iş ilanı kartlarındaki
// .card-save-btn butonlarını /api/saved uçlarına bağlar. auth-nav.js gibi her sayfada
// <script src="save-widget.js"> ile dahil edilir.
let currentUser = null;
const savedKeys = new Set();
// Takip Et (bkz. kullanıcı isteği: archello.com/brand/ofist benzeri) — savedKeys/wireSaveButtons İLE
// BİREBİR AYNI iskelet, /api/saved yerine /api/follows. Yalnızca architect-modal.js/office-modal.js
// içindeki tek bir buton için kullanılır (modal-shell.js'in paylaşılan header'ında render edilir),
// bu yüzden wireSaveButtons(type)'ın aksine varsayılan tip almaz — buton zaten kendi dataset.type'ını taşır.
const followedKeys = new Set();
// boardKeys — kullanıcının PANOLARINDA (Koleksiyonum > Panolarım) bulunan içeriklerin "type:key"
// kümesi. Kullanıcı isteği (2026-09-01 madde 10): bir proje/ürün panoya kaydedilince de Kaydet
// butonu "kaydedildi" rengine dönmeli. savedKeys'ten AYRI tutulur çünkü iki kaydetme yolu birbirinden
// bağımsızdır (saved_items vs collection_items, bkz. src/routes/collections.js) — Kaydedilenler'den
// çıkarmak panodaki kopyayı silmez, bu yüzden aynı kümede birleştirilemezler; buton rengi ikisinin
// BİRLEŞİMİNE bakar (bkz. paintSaveBtn).
const boardKeys = new Set();

// Başlık gibi serbest metinlerden kararlı, ASCII bir anahtar üretir (save/rating anahtarları için).
// Türkçe harfleri (ğ,ş,ç,ö,ü,ı) [^a-z0-9] tarafından süzülüp kaybolmasınlar diye önce çevirir.
const SLUGIFY_TR_MAP = { ç:'c', Ç:'c', ğ:'g', Ğ:'g', ı:'i', I:'i', İ:'i', ö:'o', Ö:'o', ş:'s', Ş:'s', ü:'u', Ü:'u' };
function slugify(text){
  return (text || '')
    .split('').map(ch => SLUGIFY_TR_MAP[ch] || ch).join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function paintSaveBtn(btn){
  const type = btn.dataset.type;
  const key = btn.dataset.key;
  const mapKey = type + ':' + key;
  btn.classList.toggle('saved', savedKeys.has(mapKey) || boardKeys.has(mapKey));
}

// ---------------------------------------------------------------------------------------------
// KAYDET HEDEF SEÇİCİ (kullanıcı isteği, 2026-09-01 madde 5) — proje ve ürün POPUP'larındaki Kaydet
// butonu artık doğrudan kaydetmez, önce iki seçenekli küçük bir popup açar: (1) Kaydedilenler
// (saved_items, eski davranışın birebir aynısı) ve (2) Pano — ikinciye basınca kullanıcının
// panolarının CANLI listesi (+ "Yeni Pano Oluştur") gelir, çünkü kullanıcı sürekli yeni pano
// oluşturabiliyor (bkz. src/routes/collections.js, Koleksiyonum > Panolarım).
//
// Yalnızca dataset.saveChooser='1' taşıyan butonlar bu yolu kullanır — ızgara kartlarındaki
// (.card-save-btn) tek tıkla kaydet/kaydı kaldır davranışı BİLEREK değişmedi, istek yalnızca iki
// popup'ın Kaydet butonunu sayıyor (bkz. js/components/project-actions.js / product-modal.js,
// ikisi de header'daki butona bu bayrağı basar).
//
// Panel document.body'nin DOĞRUDAN çocuğu + position:fixed olarak yaşar; .share-popover gibi
// butonun yanına absolute konumlanmıyor çünkü Kaydet, .modal-shell-panel'in (overflow:hidden VE
// açılış animasyonu için transform taşıyan — bkz. modal-shell.js#injectStyles) içindeki header
// satırında duruyor: orada açılan bir katman hem kırpılır hem de transform yüzünden fixed
// konumlandırma viewport'a göre çalışmaz (site-chrome.js#backdrop-filter ve gallery.js lightbox'ıyla
// AYNI kök neden). Konum her açılışta butonun getBoundingClientRect()'inden hesaplanır.
const SAVE_CHOOSER_ID = 'save-target-popup';
let saveChooserBtn = null; // popup'ı açan buton (kapatma/dış tıklama kontrolü için)

function injectSaveChooserStyles(){
  if(document.getElementById('save-target-popup-styles')) return;
  const style = document.createElement('style');
  style.id = 'save-target-popup-styles';
  style.textContent = `
    .save-target-popup{
      position:fixed; z-index:210; width:268px; max-width:calc(100vw - 24px);
      background:var(--paper-card); border:1px solid var(--line); border-radius:14px;
      box-shadow:0 16px 36px rgba(27,42,61,0.22); padding:6px;
      display:flex; flex-direction:column; gap:2px;
      font-family:inherit; color:var(--ink);
    }
    .save-target-head{
      display:flex; align-items:center; gap:8px; padding:8px 10px 6px;
      font-size:11px; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; color:var(--ink-soft);
    }
    .save-target-back{
      background:none; border:none; padding:0; margin:0; cursor:pointer;
      font-family:inherit; font-size:12px; font-weight:700; color:var(--walnut);
    }
    .save-target-back:hover{color:var(--ink);}
    .save-target-list{display:flex; flex-direction:column; gap:2px; max-height:264px; overflow-y:auto;}
    .save-target-item{
      display:flex; align-items:center; justify-content:space-between; gap:10px;
      padding:10px 12px; border-radius:9px; width:100%; box-sizing:border-box;
      font-family:inherit; font-size:13px; font-weight:600; color:var(--ink);
      background:none; border:none; text-align:left; cursor:pointer;
    }
    .save-target-item:hover{background:var(--paper-alt);}
    .save-target-item:disabled{opacity:0.55; cursor:default;}
    .save-target-item-sub{font-size:11px; font-weight:500; color:var(--ink-soft); flex-shrink:0;}
    .save-target-new-row{display:flex; gap:6px; padding:6px 6px 4px;}
    .save-target-new-row input{
      flex:1; min-width:0; padding:8px 10px; border-radius:9px; border:1px solid var(--line);
      background:var(--paper); font-family:inherit; font-size:12.5px; color:var(--ink);
    }
    .save-target-new-row button{
      flex-shrink:0; padding:0 12px; border-radius:9px; border:none;
      background:var(--ink); color:var(--paper-card); font-family:inherit; font-size:12.5px; font-weight:600; cursor:pointer;
    }
    .save-target-msg{padding:8px 12px; font-size:12px; color:var(--ink-soft);}
  `;
  document.head.appendChild(style);
}

function closeSaveChooser(){
  const el = document.getElementById(SAVE_CHOOSER_ID);
  if(el) el.remove();
  if(saveChooserBtn) saveChooserBtn.setAttribute('aria-expanded', 'false');
  saveChooserBtn = null;
}

// Butonun altına, viewport'tan taşmayacak şekilde. Buton çoğu zaman ekranın SAĞ üstünde
// (bkz. modal-shell.js#.modal-shell-header mobil kuralı) olduğundan panel sağa hizalanır ve
// gerekirse sol/alt kenardan içeri çekilir.
function positionSaveChooser(popup, btn){
  const r = btn.getBoundingClientRect();
  const w = popup.offsetWidth;
  const h = popup.offsetHeight;
  let left = r.right - w;
  left = Math.max(12, Math.min(left, window.innerWidth - w - 12));
  let top = r.bottom + 8;
  if(top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 8);
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
}

let saveChooserGlobalWired = false;
function wireSaveChooserGlobals(){
  if(saveChooserGlobalWired) return;
  saveChooserGlobalWired = true;
  document.addEventListener('click', (e)=>{
    const popup = document.getElementById(SAVE_CHOOSER_ID);
    if(!popup) return;
    if(popup.contains(e.target) || (saveChooserBtn && saveChooserBtn.contains(e.target))) return;
    closeSaveChooser();
  });
  // Escape modal-shell.js'in kendi Escape'inden ÖNCE yakalanmalı — aksi halde seçici açıkken
  // Escape'e basmak tüm popup'ı kapatırdı (capture fazı + stopPropagation).
  document.addEventListener('keydown', (e)=>{
    if(e.key !== 'Escape' || !document.getElementById(SAVE_CHOOSER_ID)) return;
    e.stopPropagation();
    closeSaveChooser();
  }, true);
  // Modal kapanınca (X/geri/OverlayManager) geride asılı kalmasın — body'nin çocuğu olduğundan
  // modalın kendi DOM temizliği buna ulaşamaz (bkz. modal-shell.js#close'taki AYNI sinyal).
  document.addEventListener('mimarlab-modal-closed', closeSaveChooser);
  window.addEventListener('resize', closeSaveChooser);
}

function savePayloadOf(btn){
  return {
    type: btn.dataset.type, key: btn.dataset.key,
    title: btn.dataset.title || '', meta: btn.dataset.meta || '',
    image: btn.dataset.image || '', href: btn.dataset.href || '',
  };
}

// Kaydedilenler seçeneği — ızgara kartlarındaki eski tek-tık davranışın BİREBİR aynısı
// (POST/DELETE /api/saved + savedKeys + paintSaveBtn).
async function toggleSavedItem(btn){
  const p = savePayloadOf(btn);
  const mapKey = p.type + ':' + p.key;
  if(savedKeys.has(mapKey)){
    await fetch(`/api/saved/${p.type}/${encodeURIComponent(p.key)}`, { method: 'DELETE' });
    savedKeys.delete(mapKey);
  } else {
    await fetch('/api/saved', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    });
    savedKeys.add(mapKey);
  }
  document.querySelectorAll('.card-save-btn').forEach(paintSaveBtn);
}

async function addToCollection(collectionId, btn){
  const p = savePayloadOf(btn);
  const res = await fetch(`/api/collections/${encodeURIComponent(collectionId)}/items`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'saved', itemType: p.type, itemKey: p.key, title: p.title, meta: p.meta, image: p.image, href: p.href }),
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || 'Panoya eklenemedi.');
  // Panoya girdiği an buton "kaydedildi" rengine döner (bkz. boardKeys/paintSaveBtn) — sayfadaki
  // AYNI içeriğin tüm kopyaları (ızgara kartı + popup header'ı) birlikte boyanır.
  boardKeys.add(p.type + ':' + p.key);
  document.querySelectorAll('.card-save-btn').forEach(paintSaveBtn);
  return data;
}

function openSaveChooser(btn){
  injectSaveChooserStyles();
  wireSaveChooserGlobals();
  // Aynı butona tekrar tıklamak seçiciyi KAPATIR (aç/kapa) — closeSaveChooser() saveChooserBtn'i
  // sıfırladığından karşılaştırma ondan ÖNCE yapılmalı (gerçek bulgu: sonra bakılırsa hep null olur
  // ve panel her tıklamada yeniden açılırdı).
  const wasOpenForSameBtn = !!document.getElementById(SAVE_CHOOSER_ID) && saveChooserBtn === btn;
  closeSaveChooser();
  if(wasOpenForSameBtn) return;

  const popup = document.createElement('div');
  popup.className = 'save-target-popup';
  popup.id = SAVE_CHOOSER_ID;
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', 'Nereye kaydedilsin?');
  document.body.appendChild(popup);
  saveChooserBtn = btn;
  btn.setAttribute('aria-expanded', 'true');

  const isSaved = savedKeys.has(btn.dataset.type + ':' + btn.dataset.key);

  function reposition(){ positionSaveChooser(popup, btn); }

  function renderRoot(){
    popup.innerHTML = `
      <div class="save-target-head">Nereye kaydedilsin?</div>
      <button type="button" class="save-target-item" data-target="saved">${isSaved ? 'Kaydedilenlerden Çıkar' : 'Kaydedilenler'}</button>
      <button type="button" class="save-target-item" data-target="boards">Pano<span class="save-target-item-sub">›</span></button>`;
    reposition();
  }

  function renderMessage(text){
    popup.innerHTML = `<div class="save-target-msg">${escapeChooserText(text)}</div>`;
    reposition();
  }

  async function renderBoards(){
    popup.innerHTML = `
      <div class="save-target-head"><button type="button" class="save-target-back" data-target="root">‹ Geri</button>Panolarım</div>
      <div class="save-target-list" id="save-target-boards"><div class="save-target-msg">Yükleniyor…</div></div>
      <div class="save-target-new-row">
        <input type="text" id="save-target-new-title" placeholder="Yeni pano adı" maxlength="120" autocomplete="off">
        <button type="button" data-target="create">Oluştur</button>
      </div>`;
    reposition();
    let items = [];
    try{
      const res = await fetch('/api/collections');
      const data = res.ok ? await res.json() : { items: [] };
      items = data.items || [];
    }catch{}
    const list = document.getElementById('save-target-boards');
    if(!list || !document.getElementById(SAVE_CHOOSER_ID)) return;
    list.innerHTML = items.length
      ? items.map(c => `<button type="button" class="save-target-item" data-board="${escapeChooserAttr(c.id)}">${escapeChooserText(c.title)}<span class="save-target-item-sub">${c.itemCount || 0}</span></button>`).join('')
      : '<div class="save-target-msg">Henüz panon yok — aşağıdan bir tane oluştur.</div>';
    reposition();
  }

  popup.addEventListener('click', async (e)=>{
    // GERÇEK BULGU (yerel doğrulama): stopPropagation OLMADAN her tıklama seçiciyi kapatıyordu.
    // Bu dinleyici aşağıda innerHTML'i SENKRON olarak yeniden yazıyor; olay document'e kabardığında
    // e.target artık DOM'dan kopmuş oluyor ve dış-tıklama kontrolündeki popup.contains(e.target)
    // false dönüyordu (bkz. wireSaveChooserGlobals). Olayı burada durdurmak hem sorunu kökten
    // çözer hem de dış-tıklama mantığını basit tutar.
    e.stopPropagation();
    const el = e.target.closest('[data-target], [data-board]');
    if(!el) return;
    if(el.dataset.target === 'root'){ renderRoot(); return; }
    if(el.dataset.target === 'boards'){ renderBoards(); return; }
    if(el.dataset.target === 'saved'){
      el.disabled = true;
      try{ await toggleSavedItem(btn); renderMessage(isSaved ? 'Kaydedilenlerden çıkarıldı.' : 'Kaydedilenlere eklendi.'); }
      catch{ renderMessage('Bir şeyler ters gitti, tekrar dene.'); }
      setTimeout(closeSaveChooser, 1100);
      return;
    }
    if(el.dataset.target === 'create'){
      const input = document.getElementById('save-target-new-title');
      const title = (input && input.value || '').trim();
      if(!title){ if(input) input.focus(); return; }
      el.disabled = true;
      try{
        const res = await fetch('/api/collections', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        });
        const data = await res.json().catch(()=>({}));
        if(!res.ok || !data.item) throw new Error(data.error || 'Pano oluşturulamadı.');
        await addToCollection(data.item.id, btn);
        renderMessage(`"${title}" panosuna eklendi.`);
      }catch(err){ renderMessage(err.message || 'Bir şeyler ters gitti, tekrar dene.'); }
      setTimeout(closeSaveChooser, 1300);
      return;
    }
    if(el.dataset.board){
      el.disabled = true;
      try{
        const data = await addToCollection(el.dataset.board, btn);
        renderMessage(data.duplicate ? 'Bu içerik zaten o panoda.' : 'Panoya eklendi.');
      }catch(err){ renderMessage(err.message || 'Bir şeyler ters gitti, tekrar dene.'); }
      setTimeout(closeSaveChooser, 1300);
    }
  });

  renderRoot();
}

// Bu dosya her sayfada yüklendiğinden kendi küçük kaçış yardımcılarını taşır — badge-shared.js'in
// escapeHtml'i her sayfada var ama bu script ondan BAĞIMSIZ yüklenebiliyor (bkz. dosya başı yorumu).
function escapeChooserText(s){ const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }
function escapeChooserAttr(s){ return escapeChooserText(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

// type: bu sayfadaki kartların çoğunluğu için varsayılan tür (ör. 'project', 'product'). Bir kart
// bundan farklı bir türdeyse (ör. urun.html'de ürün+malzeme kartları karışık render edilir), şablon
// butonun kendi data-type'ını önceden basar — burada zaten set edilmiş bir data-type ezilmez.
function wireSaveButtons(type){
  document.querySelectorAll('.card-save-btn').forEach(btn=>{
    if(!btn.dataset.type) btn.dataset.type = type;
    paintSaveBtn(btn);
    // gerçek bulgu (denetim, 2026-08-24): wireSaveButtons() hem sayfa yüklenişinde (ızgara için) hem
    // proje/mimar/firma/ürün modalı her açıldığında (bkz. project-actions.js/architect-modal.js/
    // office-modal.js/product-modal.js) tekrar çağrılıyordu — arkadaki ızgara DOM'dan hiç kaldırılmadığı
    // için her çağrı AYNI kalıcı butonlara BİR listener DAHA ekliyordu. N modal açılışından sonra
    // arkadaki ızgaradaki bir "Kaydet" tıklaması N+1 kez tetiklenip aynı /api/saved isteğini o kadar
    // kez atıyordu. Diğer paylaşılan script'lerdeki AYNI "wired" bayrağı deseni (bkz. site-chrome.js
    // #dataset.navSuggestWired) burada da uygulanır.
    if(btn.dataset.saveWired) return;
    btn.dataset.saveWired = '1';
    btn.addEventListener('click', async (e)=>{
      e.preventDefault();
      e.stopPropagation();
      if(!currentUser){ window.location.href = '/giris'; return; }
      // kullanıcı isteği (2026-09-01 madde 5): proje/ürün popup'ının Kaydet butonu doğrudan
      // kaydetmez, önce "Kaydedilenler / Pano" seçicisini açar (bkz. openSaveChooser). Bayrağı
      // taşımayan tüm kart butonları eski tek-tık davranışını KORUR.
      if(btn.dataset.saveChooser){ openSaveChooser(btn); return; }
      const btnType = btn.dataset.type;
      const key = btn.dataset.key;
      const mapKey = btnType + ':' + key;
      btn.disabled = true;
      try{
        if(savedKeys.has(mapKey)){
          await fetch(`/api/saved/${btnType}/${encodeURIComponent(key)}`, { method: 'DELETE' });
          savedKeys.delete(mapKey);
        } else {
          await fetch('/api/saved', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: btnType, key,
              title: btn.dataset.title || '',
              meta: btn.dataset.meta || '',
              image: btn.dataset.image || '',
              href: btn.dataset.href || '',
            }),
          });
          savedKeys.add(mapKey);
        }
        paintSaveBtn(btn);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

async function initSavedWidget(){
  try{
    // bkz. auth-nav.js#fetchMe/window.__authMeFetch — auth-nav.js her zaman bu script'ten ÖNCE
    // <script defer> olarak yüklendiğinden (proje/mimar/firma/urun.html script sırası), o script
    // AYNI /api/auth/me isteğini zaten başlatmış olur; burada tekrar atmak yerine paylaşılan
    // sonucu bekleriz (audit bulgusu: ikisi bağımsız çalışınca aynı sayfada 2 istek atılıyordu).
    // window.__authMeFetch YOKSA (bu script auth-nav.js olmadan dahil edilirse) kendi isteğini atar.
    const data = window.__authMeFetch ? await window.__authMeFetch : await fetch('/api/auth/me').then(r => r.ok ? r.json() : { user: null }).catch(() => ({ user: null }));
    currentUser = data.user;
  }catch{}
  if(currentUser){
    try{
      const res = await fetch('/api/saved');
      if(res.ok){
        const data = await res.json();
        (data.items || []).forEach(it => savedKeys.add(it.item_type + ':' + it.item_key));
        // collectionKeys — panolardaki içerikler (bkz. src/routes/saved.js#listSaved, boardKeys).
        (data.collectionKeys || []).forEach(k => boardKeys.add(k));
      }
    }catch{}
  }
  document.querySelectorAll('.card-save-btn').forEach(paintSaveBtn);
}
// Sayfa scriptleri, currentUser'ı okumadan önce bunu await edebilir.
const savedWidgetReady = initSavedWidget();

// dataset.followerCount — btn's kendisi taşır (bkz. architect-modal.js/office-modal.js, /api/public/
// follow-count'tan bir kez doldurulur), tıklamada iyimser şekilde ±1 güncellenir (bkz.
// wireFollowButtons) ki sunucuya tekrar sormadan buton anında doğru sayıyı göstersin. 0'sa (bkz.
// kullanıcı isteği: "sayı 0'sa 0'ı gösterme") parantez hiç eklenmez.
function paintFollowBtn(btn){
  const type = btn.dataset.type;
  const key = btn.dataset.key;
  const following = followedKeys.has(type + ':' + key);
  btn.classList.toggle('following', following);
  const label = btn.querySelector('.follow-btn-label');
  const count = parseInt(btn.dataset.followerCount, 10) || 0;
  const countText = count > 0 ? ` (${count})` : '';
  if(label) label.textContent = (following ? 'Takip Ediliyor' : 'Takip Et') + countText;
}

function wireFollowButtons(){
  document.querySelectorAll('.card-follow-btn').forEach(btn=>{
    paintFollowBtn(btn);
    if(btn.dataset.followWired) return;
    btn.dataset.followWired = '1';
    btn.addEventListener('click', async (e)=>{
      e.preventDefault();
      e.stopPropagation();
      if(!currentUser){ window.location.href = '/giris'; return; }
      const btnType = btn.dataset.type;
      const key = btn.dataset.key;
      const mapKey = btnType + ':' + key;
      btn.disabled = true;
      try{
        const prevCount = parseInt(btn.dataset.followerCount, 10) || 0;
        if(followedKeys.has(mapKey)){
          await fetch(`/api/follows/${btnType}/${encodeURIComponent(key)}`, { method: 'DELETE' });
          followedKeys.delete(mapKey);
          btn.dataset.followerCount = String(Math.max(0, prevCount - 1));
        } else {
          await fetch('/api/follows', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: btnType, key, title: btn.dataset.title || '' }),
          });
          followedKeys.add(mapKey);
          btn.dataset.followerCount = String(prevCount + 1);
        }
        paintFollowBtn(btn);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

async function initFollowedWidget(){
  await savedWidgetReady;
  if(currentUser){
    try{
      const res = await fetch('/api/follows');
      if(res.ok){
        const data = await res.json();
        (data.items || []).forEach(it => followedKeys.add(it.followed_type + ':' + it.followed_key));
      }
    }catch{}
  }
  document.querySelectorAll('.card-follow-btn').forEach(paintFollowBtn);
}
const followedWidgetReady = initFollowedWidget();

// gerçek bulgu (denetim, 2026-08-24): auth-modal.js üzerinden (sayfa yeniden yüklenmeden) giriş/
// üye ol tamamlandığında auth-nav.js#window.refreshAuthNav header'ı günceleyip 'mimarlab:authchange'
// yayınlıyordu, ama bu dosyadaki modül-seviyesi `currentUser` YALNIZCA sayfa ilk yüklendiğinde bir
// kez set ediliyordu — sonuç: kullanıcı popup içinden giriş yaptıktan HEMEN sonra (sayfayı hiç
// yenilemeden) bir proje/ürün kartındaki "Kaydet" butonuna tıklarsa currentUser hâlâ null olduğundan
// giris-yap.html'e YÖNLENDİRİLİYORDU — nav'daki avatar doğru görünse bile. rating-widget.js#submit()
// ve claim-correction-box.js/project-actions.js gibi bu dosyanın `currentUser`'ını PAYLAŞAN tüm
// bileşenler aynı sorunu yaşıyordu. initSavedWidget() burada yeniden çağrılır — window.__authMeFetch
// refreshAuthNav() tarafından zaten TAZE bir promise'e güncellenmiş olduğundan (bkz. auth-nav.js
// fresh:true dalı) taze currentUser/savedKeys okunur ve mevcut kartlar yeniden boyanır.
window.addEventListener('mimarlab:authchange', () => {
  savedKeys.clear();
  boardKeys.clear();
  followedKeys.clear();
  // gerçek bulgu: myEditableIdsCache (bkz. aşağısı) burada temizlenmiyordu — modal içinden çıkış
  // yapmadan (sayfa yenilenmeden) farklı bir hesapla giriş yapılırsa (bkz. initAuthNav#fresh:true,
  // auth-nav.js) "Gönderiyi Düzenle" butonları önceki kullanıcının /api/<type>/mine sonucuna göre
  // yanlış kartlarda görünüp/gizlenmeye devam ederdi.
  Object.keys(myEditableIdsCache).forEach(k => delete myEditableIdsCache[k]);
  initSavedWidget();
  initFollowedWidget();
});

// "Düzenle" butonu (etiket kullanıcı isteğiyle "Gönderiyi Düzenle"den kısaltıldı, 2026-09-06
// madde 5): proje/ürün/malzeme/haber/iş ilanı kartlarında/detay sayfalarında,
// gösterilen öğe (source==='member', yani submissionId/id'si olan) mevcut kullanıcının kendi
// gönderisiyse ya da mevcut kullanıcı adminse bir düzenleme linki döner. Admin için sahiplik
// kontrolü yapılmaz — /api/admin/submissions/:type/:id (owner kontrolü yapmayan PATCH, bkz.
// src/routes/admin.js) zaten herhangi bir gönderiyi düzenleyebiliyor, bu yüzden burada admin'e
// tüm gönderiler için buton gösterilir; hangi gönderinin gerçekten var olduğunu asıl PATCH isteği
// belirler. Sahiplik kontrolü için /api/<type>/mine sonuçları önbelleğe alınır (aynı sayfada
// birden çok karta bakılırken her biri için ayrı fetch atılmasın diye).
// products/materials artık aynı sayfada (urun-ekle.html) birleştirildiği için (bkz. kullanıcı
// isteği), o sayfa hangi API'ye (/api/products ya da /api/materials) düzenleme isteği atacağını
// bilmek üzere aşağıdaki linklere eklenen ?stype= parametresini okur (bkz. editSubmissionBtnHtml/
// applyEditButtons).
const EDIT_PAGE_BY_SUBMISSION_TYPE = {
  projects: '/proje-ekle', products: '/urun-ekle', materials: '/urun-ekle',
  news: 'haber-ekle.html', offices: '/firma-ekle', architects: '/kisi-ekle',
};
const myEditableIdsCache = {};
async function myEditableIds(type){
  if(!currentUser) return new Set();
  if(!myEditableIdsCache[type]){
    myEditableIdsCache[type] = (async () => {
      try{
        const res = await fetch(`/api/${type}/mine`);
        const data = res.ok ? await res.json() : { items: [] };
        return new Set((data.items || []).map(it => it.id));
      }catch{ return new Set(); }
    })();
  }
  return myEditableIdsCache[type];
}
async function editSubmissionBtnHtml(type, id){
  if(!id) return '';
  await savedWidgetReady;
  if(!currentUser) return '';
  const editPage = EDIT_PAGE_BY_SUBMISSION_TYPE[type];
  if(!editPage) return '';
  let canEdit = currentUser.role === 'admin';
  if(!canEdit){
    const mine = await myEditableIds(type);
    canEdit = mine.has(id);
  }
  if(!canEdit) return '';
  return `<a class="card-edit-btn" href="${editPage}?edit=${encodeURIComponent(id)}&stype=${encodeURIComponent(type)}">Düzenle</a>`;
}

// Ürün/malzeme/iş ilanı listeleme sayfalarında kartlar tek seferde senkron olarak render edilir
// (grid.innerHTML = ...map(...).join('')) — editSubmissionBtnHtml async olduğundan doğrudan o
// şablonun içine gömülemez. Bunun yerine her kart, kendi id'sini taşıyan boş bir
// <span class="edit-slot" data-type="..." data-id="..."></span> ile render edilir; render'dan
// SONRA çağrılan bu fonksiyon tek bir /api/<type>/mine (ya da admin ise rol kontrolü) sorgusuyla
// tüm slotları tek seferde doldurur.
async function applyEditButtons(type){
  await savedWidgetReady;
  if(!currentUser) return;
  const editPage = EDIT_PAGE_BY_SUBMISSION_TYPE[type];
  if(!editPage) return;
  const isAdmin = currentUser.role === 'admin';
  const mine = isAdmin ? null : await myEditableIds(type);
  document.querySelectorAll(`.edit-slot[data-type="${type}"]`).forEach(slot=>{
    const id = slot.dataset.id;
    if(!id) return;
    if(isAdmin || mine.has(id)){
      slot.innerHTML = `<a class="card-edit-btn" href="${editPage}?edit=${encodeURIComponent(id)}&stype=${encodeURIComponent(type)}">Düzenle</a>`;
    }
  });
}
