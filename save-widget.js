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

function wireSaveButtons(type){
  document.querySelectorAll('.card-save-btn').forEach(btn=>{
    btn.dataset.type = type;
    paintSaveBtn(btn);
    btn.addEventListener('click', async (e)=>{
      e.preventDefault();
      e.stopPropagation();
      if(!currentUser){ window.location.href = 'giris-yap.html'; return; }
      const key = btn.dataset.key;
      const mapKey = type + ':' + key;
      btn.disabled = true;
      try{
        if(savedKeys.has(mapKey)){
          await fetch(`/api/saved/${type}/${encodeURIComponent(key)}`, { method: 'DELETE' });
          savedKeys.delete(mapKey);
        } else {
          await fetch('/api/saved', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type, key,
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
