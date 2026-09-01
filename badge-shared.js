// MİMARLAB — mimar.html/firma.html için data.js'in kuyruğundaki kendi kendine yeten (architects[]/
// offices[] dizilerine bağımlı OLMAYAN) yardımcı fonksiyon bloğunun BİREBİR kopyası: initials/
// officeColor/logoUrl + rozet sistemi (verifiedBadgeHtml) + escapeHtmlGlobal/escapeAttrGlobal.
//
// data.js'in KENDİSİ ve onu hâlâ tam architects[]/offices[] dizileri için yükleyen ~12 diğer sayfa
// (index.html, arama.html, mimar-detay.html, ofis-detay.html, proje-detay.html, urun-detay.html,
// kisi-ekle.html, firma-ekle.html, proje-ekle.html, urun-ekle.html, hesabim.html, uye-ol.html)
// buradan HİÇ etkilenmez, kasıtlı olarak dokunulmadı. mimar.html/firma.html sayfalama artık
// backend'den (/api/architects, /api/offices) geldiğinden bu iki sayfanın data.js'in ağır (~325KB)
// dizilerine ihtiyacı kalmadı, ama bu küçük yardımcı fonksiyonlara hâlâ ihtiyaç var — data.js'i
// bölüp onu kullanan ~12 sayfanın <script> etiketlerini de güncellemek yerine (regresyon riski,
// kullanıcı onayıyla reddedildi) bu küçük, kendi kendine yeten kopya tercih edildi.

function initials(name){
  return name.replace(/[—.]/g,' ').trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
}

const palette = ['#2B425F','#3E5A78','#5B7A9B','#4F6478','#7C4B4B'];
function officeColor(name){
  let hash = 0;
  for(let i=0;i<name.length;i++) hash = name.charCodeAt(i) + ((hash<<5)-hash);
  return palette[Math.abs(hash) % palette.length];
}

// Ofisin logosu, resmi Instagram hesabından indirilip logos/ klasörüne kaydedildi.
// Instagram hesabı bulunamayan ofisler için site faviconuna geri düşülür.
const NO_LOGO_DOMAINS = new Set(['archdaily.com']);
function officeDomain(website){
  try{ return new URL(website).hostname.replace(/^www\./,''); }
  catch(e){ return null; }
}
// denetim bulgusu (2026-09-01): burası logosu olmayan firmalar için
// `https://icons.duckduckgo.com/ip3/<domain>.ico` dönüyordu — ama site genelindeki CSP'nin img-src
// direktifi bu origin'i HİÇ İÇERMİYOR (bkz. src/index.js#CONTENT_SECURITY_POLICY). Canlıda
// doğrulandı: bu URL'lerle oluşturulan her <img> tarayıcı tarafından ENGELLENİYOR, yani fallback
// hiçbir zaman görsel üretmiyordu; üstelik her engellenen istek ayrıca bir CSP ihlal raporunu
// (POST /api/csp-report) tetikliyor ve ziyaretçinin IP'sini üçüncü tarafa sızdırıyordu. Fallback
// null'a çevrildi — çağıranların hepsi zaten null'da markanın baş harflerinden oluşan renkli yer
// tutucuyu gösteriyor (bkz. firma.html/marka.html#renderGrid, arama.html, office-modal.js).
// officeDomain/NO_LOGO_DOMAINS korunuyor: ikisi de başka yerlerde (ör. website alan adı gösterimi)
// hâlâ anlamlı ve ileride kendi barındırdığımız bir logo çözümüne dönülürse gerekli olacak.
function logoUrl(o){
  return o.logo || null;
}

// Satın alınıp admin tarafından onaylanmış rozetler /api/public/badges'ten gelir; sayfa ilk
// render edildiğinde henüz hazır olmayabileceğinden 'mimarlab-badges-ready' event'i ile
// dinleyen sayfalar rozetler gelince yeniden render edebilir.
const dynamicBadges = { architect: {}, office: {} };
// claim-correction-box.js "Bu profil sana mı ait?" kutusunu rozetli profillerde göstermemek için
// rozetlerin fetch'i bitene kadar bekleyebilsin diye (bkz. o dosya#hasActiveBadge).
let resolveBadgesReady;
const badgesReadyPromise = new Promise(resolve => { resolveBadgesReady = resolve; });
fetch('/api/public/badges').then(r => r.ok ? r.json() : null).then(d => {
  if(d){ Object.assign(dynamicBadges.architect, d.architect || {}); Object.assign(dynamicBadges.office, d.office || {}); }
  window.dispatchEvent(new Event('mimarlab-badges-ready'));
}).catch(()=>{}).finally(()=>{ resolveBadgesReady(); });

// Giriş yapmış kullanıcının KENDİ etkin kişisel rozeti (Doğrulanmış/Altın Üye) — src/routes/
// badges.js#listMyBadges'teki effectivePersonalBadge alanından gelir (kendi rozeti + Kurucu/Ortak
// olunan bir firmanın admin rozetini birleştirir, bkz. src/lib/badgeAccess.js#getPersonalAdminBadge).
// architect-modal.js/office-modal.js#renderMessageIcon bunu kullanır (kullanıcı isteği 2026-08-30:
// "doğrulanmış veya altın üyeler tüm kullanıcılara mesaj gönderebilsin" — GÖNDEREN bu rozete sahipse
// Mesaj Gönder butonu, alıcı profilin kendi rozeti olmasa bile gösterilir). `currentUser` global'ine
// KASITLI OLARAK bakılmaz — bu script save-widget.js'in `let currentUser` deferred script'inden ÖNCE
// çalışır (bkz. [[save_widget_currentuser_collision]]), bu yüzden giriş durumu doğrudan
// /api/badges/mine'ın 401/200 yanıtından çözülür.
let myEffectiveBadge = null;
let resolveMyBadgeReady;
const myEffectiveBadgePromise = new Promise(resolve => { resolveMyBadgeReady = resolve; });
fetch('/api/badges/mine').then(r => r.ok ? r.json() : null).then(d => {
  myEffectiveBadge = (d && d.effectivePersonalBadge) || null;
}).catch(()=>{}).finally(()=>{ resolveMyBadgeReady(myEffectiveBadge); });

// İki satın alınabilir rozet kademesi: Doğrulanmış Üye kimlik doğrulamasını temsil eder
// (Instagram'ın mavi doğrulanmış profil rozeti gibi); Altın Üye daha üst kademe, aylık abonelik
// olarak ödenen bir üyeliktir ve kendi rengiyle ayrı bir rozet olarak gösterilir (bkz.
// auth-modal.js#BADGE_TIERS ve src/routes/badges.js#BADGE_PRICES ile aynı isimler/anahtarlar).
// 'destekci' (Destekçi) ve 'platinum' (Elmas Üye) kullanıcı isteğiyle 2026-08-29'da satın
// alınabilir olmaktan çıkarıldı, bu yüzden burada da yer almıyorlar (bkz. src/routes/
// badges.js#BADGE_PRICES'taki aynı not) — 'destekci' zaten hiçbir görünür rozet vermiyordu.
// 'iz-birakan' (İz Bırakan, bkz. kullanıcı isteği): vefat etmiş mimarlar için — mavi mühür ile
// AYNI ikon, yalnızca rengi siyah/antrasit. admin_badges'ten geldiği ve satın alınabilir bir
// kademe OLMADIĞI için src/routes/badges.js#BADGE_PRICES/ADMIN_GRANTABLE_BADGES'te ayrı ele
// alınır — o profilin diğer TÜM rozetlerinin yerini alır (bkz. handlePublicBadges).
const BADGE_LABELS = { verified:'Doğrulanmış Üye', gold:'Altın Üye', 'iz-birakan':'İz Bırakan' };
const BADGE_COLORS = { verified:'#0095F6', gold:'#D4A72C', 'iz-birakan':'#1B1F24' };

// Native `title` tooltip'i masaüstünde gecikmeli/tutarsız, mobilde ise dokunmayla hiç çalışmıyor;
// bu yüzden kendi tooltip'imizi kuruyoruz. document.body'ye eklenmiş TEK PAYLAŞILAN bir tooltip
// elemanı kullanılır; document koordinatlarında (position:absolute + scrollX/scrollY) konumlanır ve
// çok yüksek bir z-index taşır, böylece hangi kartın/satırın içinde olursa olsun her zaman sayfanın
// en önünde ve tam görünür kalır.
if(!document.getElementById('verified-badge-style')){
  const badgeStyle = document.createElement('style');
  badgeStyle.id = 'verified-badge-style';
  badgeStyle.textContent = `
    .verified-badge-icon{position:relative; cursor:pointer; display:inline-flex; align-items:center; vertical-align:middle; margin-left:var(--space-1, 4px); flex-shrink:0;}
    .verified-badge-tip-floating{
      position:absolute; top:-9999px; left:-9999px;
      background:#1B2A3D; color:#fff; font-family:'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size:11px; font-weight:600;
      line-height:1.3; white-space:nowrap; padding:5px 9px; border-radius:6px;
      opacity:0; pointer-events:none; transition:opacity .12s ease; z-index:99999;
    }
    .verified-badge-tip-floating::after{
      content:''; position:absolute; top:100%; left:50%; transform:translateX(-50%);
      border:5px solid transparent; border-top-color:#1B2A3D;
    }
    .verified-badge-tip-floating.show{opacity:1;}
    .verified-badge-tip-floating.tappable{pointer-events:auto; cursor:pointer;}
  `;
  document.head.appendChild(badgeStyle);
}

let badgeTooltipEl = null;
function ensureBadgeTooltip(){
  if(!badgeTooltipEl){
    badgeTooltipEl = document.createElement('div');
    badgeTooltipEl.className = 'verified-badge-tip-floating';
    document.body.appendChild(badgeTooltipEl);
  }
  return badgeTooltipEl;
}
// tappable: mobil "dokun -> ismi göster" akışında true geçilir; tooltip'i pointer-events:auto
// yapıp üzerine tekrar dokununca kapatılabilir hale getirir (bkz. aşağıdaki click delegasyonu —
// rozetler artık hiçbir yere yönlendirmez). Masaüstü hover akışında (tappable geçilmez) tooltip
// her zaman pointer-events:none kalır — aksi halde fare tooltip'e değince mouseout'un
// `icon.contains` kontrolü tooltip'i içermediğinden yanlışlıkla titreşerek kapanırdı.
function showBadgeTooltip(icon, tappable){
  const tip = ensureBadgeTooltip();
  tip.textContent = icon.dataset.tip || '';
  tip.dataset.badgeType = icon.dataset.badgeType || '';
  tip.classList.toggle('tappable', !!tappable);
  const iconRect = icon.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const left = iconRect.left + window.scrollX + iconRect.width / 2 - tipRect.width / 2;
  const top = iconRect.top + window.scrollY - tipRect.height - 7;
  tip.style.left = `${Math.max(4, left)}px`;
  tip.style.top = `${top}px`;
  tip.classList.add('show');
}
function hideBadgeTooltip(){
  if(badgeTooltipEl) badgeTooltipEl.classList.remove('show');
}

// Masaüstünde imleç üzerine gelince göster/gizle (delegasyonla — rozet ikonları sayfa boyunca
// tekrar tekrar innerHTML ile render edildiğinden tek tek dinleyici eklemek yerine document
// üzerinden delege edilir).
document.addEventListener('mouseover', (e)=>{
  const icon = e.target.closest('.verified-badge-icon');
  if(icon) showBadgeTooltip(icon);
});
document.addEventListener('mouseout', (e)=>{
  const icon = e.target.closest('.verified-badge-icon');
  if(icon && !icon.contains(e.relatedTarget)) hideBadgeTooltip();
});
// Rozete dokunma/tıklama: rozetler artık hiçbir yere yönlendirmez (bkz. kullanıcı isteği: "rozetin
// adını göster ama link verme, tıklayınca bir şey olmasın") — masaüstünde zaten mouseover/mouseout
// ile tooltip gösterilir; TIKLAMA HER ZAMAN aynı tooltip'i açar (bkz. kullanıcı isteği: "tablet ve
// mobilde ... artık ... sitenin her neresinde olursa olsun tıklayınca rozetin ismi gözüksün").
// gerçek bulgu (2026-08-29 audit): önceden burada `window.matchMedia('(hover: none)')` ile "bu bir
// dokunmatik cihaz mı" tespiti yapılıp yalnızca öyleyse tıklamada tooltip gösteriliyordu — ama bazı
// tabletler/hibrit cihazlar (bağlı fare/kalem, bazı Android tarayıcıları) bu sorguyu tutarsız
// yanıtlıyor, bu da "bazen tıklayınca rozetin ismi hiç çıkmıyor" şikayetinin asıl nedeniydi (o
// cihazlarda ne mouseover/mouseout tetikleniyordu ne de tıklama isTouchBadgeUI() true dönüyordu).
// Artık cihaz tespitine hiç güvenilmiyor: tıklama koşulsuz gösterir, masaüstünde salt fare
// kullanan biri için de zararsız bir bonus.
// Rozet <span> olarak kalır (gerçek bir <a> DEĞİL) çünkü çoğunlukla zaten bir kart linkinin (ör.
// mimar/ofis kartı) İÇİNDE render edilir — preventDefault/stopPropagation ile hem kendi (artık yok
// olan) yönlendirmesi hem de dıştaki kart linkinin tetiklenmesi engellenir, "tıklayınca bir şey
// olmasın" (yönlendirme anlamında) garanti edilir.
document.addEventListener('click', (e)=>{
  // Açık, dokunmayla gösterilmiş tooltip'in ÜZERİNE (ismin kendisine) dokunma -> yalnızca kapat.
  if(badgeTooltipEl && badgeTooltipEl.classList.contains('show') && badgeTooltipEl.classList.contains('tappable') && e.target.closest('.verified-badge-tip-floating')){
    e.preventDefault();
    e.stopPropagation();
    hideBadgeTooltip();
    return;
  }
  const badge = e.target.closest('.verified-badge-icon');
  if(badge){
    e.preventDefault();
    e.stopPropagation();
    showBadgeTooltip(badge, true);
    return;
  }
  // Rozet ya da açık tooltip dışında bir yere dokunuldu -> dokunmayla açılmış tooltip'i kapat.
  if(badgeTooltipEl && badgeTooltipEl.classList.contains('tappable')) hideBadgeTooltip();
});
// Sayfa kaydırılınca (kartın kendisi ya da bir üst konteyner) konumu bayatlamasın diye tooltip
// kapatılır — filtre/sayfa değişimiyle tetiklenen bir yeniden render de rozet elemanını DOM'dan
// kaldırabileceğinden aynı güvenlik burada da işe yarar.
window.addEventListener('scroll', ()=>{
  hideBadgeTooltip();
}, { passive:true, capture:true });

// profileType: 'architect' | 'office'; profileKey: mimarın/ofisin adı; staticBadges: API'den gelen
// opsiyonel badges[] alanı — yalnızca o profil için gerçek (satın alınıp onaylanmış) bir rozet
// YOKSA başlangıç/seed değeri olarak kullanılır. Gerçek rozet varsa (dynamicBadges) her zaman
// önceliklidir.
// Bir profilin birden fazla rozeti varsa (ör. Doğrulanmış Mimar + Gold Üye) her biri kendi
// rengi ve üzerine gelince/dokununca kendi adını gösteren ayrı bir ikon olarak yan yana render edilir.
// Doğrulanmış Üye/Altın Üye/İz Bırakan: sekiz köşeli mühür + onay işareti.
const SEAL_BADGE_SVG = '<path d="M12 2 14.5 5.5 19 5l-.5 4.5L22 12l-3.5 2.5.5 4.5-4.5-.5L12 22l-2.5-3.5-4.5.5.5-4.5L2 12l3.5-2.5L5 5l4.5.5Z"/><path d="M9 12.5l2 2 4-4.5" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
// Tek bir rozet türünü ikon olarak render eder — verifiedBadgeHtml (mimar/marka profili, birden
// fazla rozet) ile yorum/gönderi satırlarındaki KİŞİSEL rozet (tek rozet) arasında paylaşılır.
// 'destekci'/'platinum' artık satın alınamıyor (bkz. yukarıdaki BADGE_LABELS notu) — eski bir
// kayıttan bu tipler yine de gelirse (BADGE_LABELS'te karşılığı olmadığından) hiçbir şey render
// etmeden sessizce atlanır, ham tip adını göstermez.
function badgeIconHtml(badgeType, size){
  if(!badgeType || !BADGE_LABELS[badgeType]) return '';
  size = size || 13;
  return `<span class="verified-badge-icon" data-tip="${escapeAttrGlobal(BADGE_LABELS[badgeType])}" data-badge-type="${escapeAttrGlobal(badgeType)}" style="color:${BADGE_COLORS[badgeType] || 'var(--accent)'}"><svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor">${SEAL_BADGE_SVG}</svg></span>`;
}
function verifiedBadgeHtml(profileType, profileKey, staticBadges, size){
  const dynamic = (dynamicBadges[profileType] && dynamicBadges[profileType][profileKey]) || [];
  const badges = dynamic.length ? dynamic : (staticBadges || []);
  return badges.map(b => badgeIconHtml(b, size)).join('');
}
function escapeHtmlGlobal(s){
  const d = document.createElement('div');
  d.textContent = s === undefined || s === null ? '' : s;
  return d.innerHTML;
}
function escapeAttrGlobal(s){
  return escapeHtmlGlobal(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
