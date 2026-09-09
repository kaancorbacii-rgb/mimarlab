// Görsel teslim katmanı — R2'de ÖNCEDEN ÜRETİLMİŞ responsive türevler.
//
// GEÇMİŞ
// Faz 2 (2026-08-10): Cloudflare Image Resizing (/cdn-cgi/image/...) açıldı, cdnImg/cdnSrcset
// gerçek resize URL'i üretiyordu. 2026-08-22'de KAPATILDI — "Images Transformed" faturalandırması
// (ücretsiz aylık 5K dönüşüm kotası aşıldı) beklenmedik ~$16/ay maliyete yol açtı, kullanıcı
// isteğiyle devre dışı bırakıldı. O tarihten beri cdnImg orijinal yolu değiştirmeden döndürüyordu,
// yani sitedeki TÜM görseller tam çözünürlükte iniyordu (performans denetimi 2026-09-01: ana
// sayfanın LCP görseli 2400 px / 640 KB idi, 760 CSS px'lik bir slota çiziliyordu).
//
// ŞİMDİ (2026-09-01, görsel performans optimizasyonu)
// Aynı sonuç ÜCRETSİZ olarak elde ediliyor: dönüşüm istek anında (ücretli) yapılmıyor, türevler
// scripts/generate-image-derivatives.js ile BİR KEZ üretilip R2'ye yazılıyor ve mevcut /media/*
// yolundan (bkz. src/routes/upload.js#handleMediaRoute — aynı edge cache, aynı immutable header'lar)
// servis ediliyor. Ek Cloudflare ürünü/aboneliği YOK, yalnızca R2 depolama.
//
// TÜREV URL BİÇİMİ
//   /media/_derived/w<genişlik>/r2/<r2-anahtarı>      (kaynak R2'de: "/media/projects/x.webp")
//   /media/_derived/w<genişlik>/s/<statik-yol>        (kaynak statik varlık: "projects/x.webp")
// "r2"/"s" ayracı ŞART: R2'de de statik varlıklarda da "projects/" öneki var, ayrım olmadan
// Worker hangi kaynağa geri düşeceğini bilemez.
//
// GÜVENLİK AĞI — türev YOKSA görsel KIRILMAZ
// handleMediaRoute, "_derived/..." anahtarı R2'de bulunamazsa 404 DÖNMEZ; yukarıdaki ayraca göre
// orijinali (R2 nesnesi ya da statik varlık) servis eder. Bu sayede bu dosya, migration daha tek
// bir türev üretmeden ÖNCE bile güvenle canlıya alınabilir — davranış aynen bugünkü hâli olur ve
// türevler üretildikçe iyileşme kendiliğinden devreye girer. Migration'ın kapsamadığı görseller
// (ör. harici http URL'leri, SVG) de kalıcı olarak sorunsuz çalışmaya devam eder.
const IMAGE_DERIVATIVES_ENABLED = true;

// Türev merdiveni. Çağrı noktalarındaki GERÇEK CSS slot genişliklerinden türetildi (her biri kendi
// `sizes` özniteliğini zaten taşıyor, bkz. aşağıdaki tablo) — körlemesine seçilmiş değil:
//   48 px   arama.html sonuç satırı avatarı        -> 400 (en küçük basamak; dosya zaten çok küçük)
//   240 px  gallery.js küçük şerit                 -> 400 (1,7x)
//   300 px  ilgili/pop-up kart ızgaraları          -> 400 (1,3x) / 800 (2,7x)
//   400 px  proje/kişi/firma/ürün liste kartları   -> 400 (1x)   / 800 (2x)
//   480 px  gallery.js ana şerit                   -> 800 (1,7x)
//   700 px  ana sayfa karuseli (LCP)               -> 800 (1,14x)/ 1600 (2,3x)
// Üç basamak bilerek: dört basamak R2 yazma sayısını (ve migration süresini) %33 artırırken
// yukarıdaki slotların hiçbirinde anlamlı bir kazanç sağlamıyordu. Işık hızında büyüyen bir
// merdiven yerine ~2x aralıklı üç basamak, her slot için en fazla ~%30 fazla piksel indirir.
const DERIVATIVE_WIDTHS = [400, 800, 1600];

// Bu uzantılar HİÇ dönüştürülmez: SVG çözünürlükten bağımsızdır (yeniden boyutlandırmak anlamsız,
// üstelik rasterleştirme kalite kaybı olur), GIF ise animasyon taşıyabilir (Pillow tek kareye
// indirger — hareketi sessizce yok ederdi).
const DERIVATIVE_SKIP_RE = /\.(svg|gif)(\?|$)/i;

// İstenen genişliği merdivendeki EN KÜÇÜK yeterli basamağa yuvarlar. Merdivenin üstünü aşan
// istekler (ör. gallery.js lightbox'ının 2000 px'i) null döner — çağıran taraf o durumda
// ORİJİNALİ kullanır, çünkü tam ekran görüntüleme zaten tam çözünürlüğün istendiği tek yerdir.
function derivativeWidthFor(width) {
  const w = Number(width) || 0;
  for (const step of DERIVATIVE_WIDTHS) if (w <= step) return step;
  return null;
}

// path: "mimarlar-thumb/foo.jpg" (köke göreli, eğik çizgisiz — STATİK varlık) YA DA
// "/media/u/.../foo.webp" (R2 nesnesi, baştan eğik çizgili) olabilir; ikisi de canlıda gerçekten
// kullanılıyor (bkz. src/routes/upload.js#handleMediaRoute, proje/mimar/firma kayıtlarındaki
// fotoğraf alanları). Harici (http/https/data:) URL'ler bize ait olmadığından hiç dokunulmaz.
// GERÇEK BULGU (canlıda yakalandı): /api/projects'in `images` dizisi bazı satırlarda MUTLAK URL
// taşıyor ("https://mimarlab.com/media/projects/y-evi-bodrum-1.webp"), bazılarında göreli
// ("/media/u/.../x.webp") — veri tarihsel olarak KARIŞIK yazılmış (mimar fotoğrafı/firma logosu ise
// her zaman göreli). İlk denemede mutlak URL'ler "harici" sayılıp hiç dönüştürülmüyordu; sonuç:
// mimar/firma/ürün karuselleri türev alırken ANA SAYFANIN LCP GÖRSELİ (proje karuseli) hâlâ 640 KB'lık
// orijinali indiriyordu. KENDİ origin'imize ait mutlak URL'ler bu yüzden göreli yola indirgenir;
// gerçekten harici olanlar (başka bir host) eskisi gibi hiç dokunulmadan geçer.
function toLocalPath(path) {
  if (typeof path !== 'string' || !path) return null;
  if (path.startsWith('data:') || path.startsWith('blob:')) return null;
  // TELİF KİLİDİ: /api/media/<id> (kilitli medyanın güvenli ucu) BİR TÜREV YOLU DEĞİLDİR ve asla
  // yeniden yazılmamalı — "/media/_derived/w400/s/api/media/<id>" gibi var olmayan bir anahtar
  // üretmek, kilitli her görselin bozuk görünmesine yol açardı. Uç zaten w400 boyutunda güvenli
  // baytları döndürüyor (bkz. src/routes/media.js), küçültülecek bir şey de yok.
  if (path.startsWith('/api/media/')) return null;
  if (!/^(https?:)?\/\//i.test(path)) return path;
  // Protokol-göreli ("//host/...") ve tam URL'ler — tarayıcıda location.origin ile karşılaştırılır.
  try {
    const parsed = new URL(path, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    return parsed.pathname;
  } catch (e) {
    return null;
  }
}

function derivativeUrl(path, width) {
  if (!IMAGE_DERIVATIVES_ENABLED || !path) return null;
  const localPath = toLocalPath(path);
  if (!localPath) return null;
  if (DERIVATIVE_SKIP_RE.test(localPath)) return null;
  const step = derivativeWidthFor(width);
  if (!step) return null;

  const clean = localPath.replace(/^\/+/, '');
  if (clean.startsWith('media/')) {
    // R2 nesnesi — "/media/" öneki soyulup ham R2 anahtarı kullanılır.
    return `/media/_derived/w${step}/r2/${clean.slice('media/'.length)}`;
  }
  // Statik varlık (projects/, miras/, mimarlar-thumb/, logos-thumb/, logos/ ...).
  return `/media/_derived/w${step}/s/${clean}`;
}

// GERİYE DÖNÜK UYUMLU: imza ve dönüş tipi (her zaman kullanılabilir bir görsel yolu) DEĞİŞMEDİ —
// 40+ çağrı noktasının hiçbirine dokunmak gerekmiyor. Merdivenin üstünü aşan genişliklerde ya da
// dönüştürülemeyen kaynaklarda eskisi gibi orijinal yolu döndürür.
function cdnImg(path, width) {
  return derivativeUrl(path, width) || path;
}

// widths: [400, 600, 800] gibi bir dizi — "url 400w, url 800w" üretir.
// Çağrı noktaları merdivenle birebir örtüşmeyen genişlikler veriyor (tarihsel olarak Cloudflare
// Image Resizing keyfi genişlik kabul ediyordu); burada her biri merdivene yuvarlanıp TEKİLLEŞTİRİLİR
// — aksi halde srcset'te aynı URL farklı "w" tanımlayıcılarıyla birden çok kez görünür ve tarayıcı
// yanlış aday seçerdi. Tanımlayıcı olarak istenen değil GERÇEK basamak genişliği yazılır; srcset
// sözleşmesi budur (tarayıcı "w" değerini gerçek piksel genişliği kabul eder, `sizes` ile birlikte
// hangi adayı indireceğine buna göre karar verir — yanlış "w" yazmak seçimi bozar).
function cdnSrcset(path, widths) {
  if (!IMAGE_DERIVATIVES_ENABLED || !path || !Array.isArray(widths)) return '';
  const seen = new Set();
  const parts = [];
  for (const w of widths) {
    const step = derivativeWidthFor(w);
    if (!step || seen.has(step)) continue;
    const url = derivativeUrl(path, step);
    if (!url) continue;
    seen.add(step);
    parts.push(`${url} ${step}w`);
  }
  // Tek adaylı bir srcset tarayıcıya hiçbir seçim şansı vermez ama zarar da vermez; yine de
  // `sizes` ile birlikte doğru çalışması için olduğu gibi bırakılır. Hiç aday yoksa boş dize
  // döner ve çağrı noktaları srcset özniteliğini hiç yazmaz (mevcut davranış).
  return parts.join(', ');
}

// ---------------------------------------------------------------------------------------------
// TELİF KİLİDİ — SİTE GENELİ GÖRSEL DAVRANIŞI (kullanıcı isteği, 2026-09-09 madde 8)
// ---------------------------------------------------------------------------------------------
// Kilitli her görsel, sitedeki TEK bir adres biçiminden gelir: /api/media/<opak id> (bkz.
// src/lib/mediaRights.js#SAFE_MEDIA_PREFIX). Bu, kilidin görsel dilini TEK bir CSS seçicisiyle
// kurmayı mümkün kılıyor:
//
//     img[src^="/api/media/"]
//
// NEDEN BU YOL: proje kapağı ondan fazla ayrı yerde render ediliyor (proje kartları, ana sayfa
// karuseli, kişi/firma pop-up ızgaraları, İlgili Yapılar, arama sonuçları, En İyi 100, Panolarım,
// takip akışı...). Her birine "kilitliyse şu class'ı ekle" mantığı yazmak, yeni bir yüzey
// eklendiğinde sessizce unutulacak bir kural olurdu — bu depodaki tekrar eden kök neden tam olarak
// budur. Adres biçimi ise sunucu tarafından garanti edilir: kilitli olmayan hiçbir görsel bu
// önekten gelmez, kilitli olan hiçbir görsel başka bir önekten gelemez.
//
// BULANIKLIK BİR GÜVENLİK SINIRI DEĞİLDİR (kullanıcı isteği madde 8'in kendi ifadesi). Gerçek
// koruma sunucudadır: bu URL'nin arkasında zaten yalnızca küçük/güvenli baytlar var, orijinal
// dosya hiçbir yoldan servis edilmiyor. Buradaki blur, ziyaretçiye "bu görselin yayın hakkı
// doğrulanmadı" mesajını veren bir SUNUM katmanıdır. Aynı sebeple sağ tık engellenmez; yalnızca
// sürükle-bırak/seçim gibi kazara kopyalamayı azaltan UX önlemleri uygulanır.
//
// scale(1.03): CSS blur, elemanın kenarlarında saydamlığa doğru dağılır ve ince bir hâle bırakır;
// hafif bir büyütme bu hâleyi kutunun dışına taşır. object-fit zaten çağrı noktalarında ayarlı,
// bu yüzden görüntü oranı bozulmaz.
(function injectLockedMediaStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('ml-locked-media-style')) return;
  var css = [
    'img[src^="/api/media/"]{',
    '  filter: blur(7px) saturate(0.85);',
    '  transform: scale(1.03);',
    '  -webkit-user-drag: none;',
    '  user-select: none;',
    '  -webkit-user-select: none;',
    '}',
    'a:has(> img[src^="/api/media/"]), .gallery-item:has(img[src^="/api/media/"]){ overflow: hidden; }',
    '.ml-locked-note{',
    '  position:absolute; left:50%; bottom:12px; transform:translateX(-50%);',
    '  display:inline-flex; align-items:center; gap:6px;',
    '  background:rgba(27,42,61,0.82); color:#fff; border-radius:999px;',
    '  padding:6px 12px; font-size:12px; line-height:1; letter-spacing:0.01em;',
    '  pointer-events:none; z-index:3; max-width:calc(100% - 24px);',
    '}',
    '.ml-locked-note svg{ width:13px; height:13px; flex:0 0 auto; }',
    '.lightbox.grid-mode .ml-locked-note{ display:none; }',
    '@media (max-width:640px){ .ml-locked-note{ font-size:11px; padding:5px 10px; bottom:8px; } }',
  ].join('\n');
  var style = document.createElement('style');
  style.id = 'ml-locked-media-style';
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
})();

// Kilit rozeti (asma kilit ikonu + kısa metin). Galeri/lightbox gibi metnin sığdığı yüzeylerde
// kullanılır; kartlarda yalnızca yukarıdaki blur uygulanır (küçük bir kartta rozet görseli tamamen
// kapatırdı).
function lockedMediaNoteHtml() {
  return '<div class="ml-locked-note">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">'
    + '<rect x="4" y="10" width="16" height="11" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path></svg>'
    + 'Görsel yayın hakkı doğrulanmadı</div>';
}

function isLockedMediaUrl(url) {
  return typeof url === 'string' && url.indexOf('/api/media/') === 0;
}
