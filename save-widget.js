// Paylaşılan "Kaydet" (bookmark) widget'ı: proje/ürün/haber/iş ilanı kartlarındaki
// .card-save-btn butonlarını /api/saved uçlarına bağlar. auth-nav.js gibi her sayfada
// <script src="save-widget.js"> ile dahil edilir.
let currentUser = null;
const savedKeys = new Set();

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
  btn.classList.toggle('saved', savedKeys.has(type + ':' + key));
}

// type: bu sayfadaki kartların çoğunluğu için varsayılan tür (ör. 'project', 'product'). Bir kart
// bundan farklı bir türdeyse (ör. urun.html'de ürün+malzeme kartları karışık render edilir), şablon
// butonun kendi data-type'ını önceden basar — burada zaten set edilmiş bir data-type ezilmez.
function wireSaveButtons(type){
  document.querySelectorAll('.card-save-btn').forEach(btn=>{
    if(!btn.dataset.type) btn.dataset.type = type;
    paintSaveBtn(btn);
    btn.addEventListener('click', async (e)=>{
      e.preventDefault();
      e.stopPropagation();
      if(!currentUser){ window.location.href = 'giris-yap.html'; return; }
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
    const meRes = await fetch('/api/auth/me');
    if(meRes.ok) currentUser = (await meRes.json()).user;
  }catch{}
  if(currentUser){
    try{
      const res = await fetch('/api/saved');
      if(res.ok){
        const data = await res.json();
        (data.items || []).forEach(it => savedKeys.add(it.item_type + ':' + it.item_key));
      }
    }catch{}
  }
  document.querySelectorAll('.card-save-btn').forEach(paintSaveBtn);
}
// Sayfa scriptleri, currentUser'ı okumadan önce bunu await edebilir.
const savedWidgetReady = initSavedWidget();

// "Gönderiyi Düzenle" butonu: proje/ürün/malzeme/haber/iş ilanı kartlarında/detay sayfalarında,
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
  projects: 'proje-ekle.html', products: 'urun-ekle.html', materials: 'urun-ekle.html',
  news: 'haber-ekle.html', offices: 'firma-ekle.html', architects: 'mimar-ekle.html',
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
  return `<a class="card-edit-btn" href="${editPage}?edit=${encodeURIComponent(id)}&stype=${encodeURIComponent(type)}">Gönderiyi Düzenle</a>`;
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
      slot.innerHTML = `<a class="card-edit-btn" href="${editPage}?edit=${encodeURIComponent(id)}&stype=${encodeURIComponent(type)}">Gönderiyi Düzenle</a>`;
    }
  });
}
