// MİMARLAB — tek bir Ürün sayfasında (urun.html/urun-ekle.html) birleştirilmiş mobilya/dekorasyon
// ürünleri ve yapı malzemeleri arasında paylaşılan kategori taksonomisi ve firma meta verisi.
// Malzeme sayfası kaldırıldı (bkz. kullanıcı isteği) — kayıtlar backend'de hâlâ iki ayrı tabloda
// (product_submissions/material_submissions) tutulur, PRODUCT_TAXONOMY/MATERIAL_TAXONOMY bu ayrımı
// (yeni gönderi hangi tabloya gidecek) belirlemek için hâlâ ayrı ayrı tutuluyor; CATALOG_TAXONOMY
// ve CATALOG_GROUP_KIND ikisini tek bir Grup/Kategori filtre listesinde birleştirir.
//
// Her ürün/malzeme kaydı tek bir "category" (alt kategori/leaf) değeri taşır — Grup (üst kategori)
// bu dosyadaki haritadan türetilir, ayrı bir DB alanı gerektirmez (bkz. src/lib/submissionTypes.js
// — category zaten serbest metin bir alan, whitelist yok).
// 2026-08-23 revizyonu (bkz. kullanıcı isteği: "fotoğrafta görünmeyen kaba inşaat kalemleri
// menüden çıkarılsın") — taksonomi 13 ana kategoriden 7 mimari sütuna sadeleştirildi:
//   - Tamamen kaldırıldı (fotoğrafta hiç görünmez): Alçı Sıva, Isı/Su/Ses Yalıtımı, İç/Dış Cephe
//     Boyası, Kumaş & Döşemelik (koltuk/sandalyenin bir varyantı, bağımsız ürün değil).
//   - "Sıva & Alçı" ve "Yalıtım" ana kategorileri bu yüzden tamamen kalktı (Dekoratif Sıva hariç,
//     o doku olarak görünür kaldığından Zemin & Yüzey Kaplama altına taşındı).
//   - Mermer + Traverten -> tek "Doğal Taş (Mermer & Traverten)" başlığında birleşti.
//   - PVC/Alüminyum Doğrama + İç Kapı, ayrı bir "Kapı & Pencere" ana kategorisi yerine Cephe grubuna
//     taşındı (Cephe & Açıklıklar).
//   - Mutfak & Beyaz Eşya + Banyo, Doğal Taş & Zemin + Boya & Kaplama, Dekorasyon & Aksesuar +
//     Tekstil & Halı (Kumaş & Döşemelik'siz) birer ana kategoride birleştirildi.
// Bu birleşmelerden biri (Mutfak & Banyo), kategori (leaf) kind'i artık GRUP seviyesinde değil
// (bkz. aşağıdaki CATALOG_CATEGORY_KIND) — Mutfak & Banyo altında hem taşınabilir mobilya/ankastre
// (kind: products) hem yapıya monte sabit ürünler (vitrifiye/armatür/duş, kind: materials) bir arada
// görünür olması gerektiğinden, eskiden olduğu gibi TEK bir grup->kind eşlemesi artık yeterli değil.
const PRODUCT_TAXONOMY = {
  "Mobilya": ["Koltuk & Kanepe", "Sandalye & Tabure", "Masa", "Yatak & Baza", "Dolap & Depolama", "Ofis Mobilyası"],
  "Aydınlatma": ["İç Mekan Aydınlatma", "Dış Mekan Aydınlatma", "Sarkıt & Avize"],
  "Mutfak & Banyo": ["Mutfak Mobilyası", "Ankastre Ürünler", "Tezgah"],
  "Dekorasyon & Tamamlayıcılar": ["Aynalar", "Duvar Objeleri", "Akustik Panel", "Vazo & Obje", "Halı", "Perde"],
  "Dış Mekan & Peyzaj": ["Bahçe Mobilyası", "Pergole & Gölgelendirme"],
};

// Not: Sabit/yapıya monte banyo ürünleri (vitrifiye, armatür vb.) kasıtlı olarak PRODUCT_TAXONOMY'de
// değil — inşaat/tadilat aşamasında seçilen bir "yapı malzemesi" olarak ele alınıyor, taşınabilir
// mobilya/ürünlerden ayrı (kind: materials). "Mutfak & Banyo" grubu görsel/filtre olarak TEK başlık
// olsa da, bu satırdaki dört kategori PRODUCT_TAXONOMY'deki üç kategoriden farklı bir kind taşır —
// bkz. CATALOG_CATEGORY_KIND (grup değil kategori seviyesinde ayrım).
const MATERIAL_TAXONOMY = {
  "Mutfak & Banyo": ["Vitrifiye", "Armatür", "Duş Sistemleri", "Banyo Mobilyası"],
  "Zemin & Yüzey Kaplama": ["Doğal Taş (Mermer & Traverten)", "Seramik & Porselen Karo", "Laminat & Parke", "Ahşap Kaplama", "Beton Görünümlü Kaplama", "Dekoratif Sıva"],
  "Cephe & Açıklıklar": ["Cephe Sistemleri", "Cam", "Panel & Kompozit", "PVC/Alüminyum Doğrama", "İç Kapı"],
};

// Birleşik Grup/Kategori filtresi (urun.html) ve birleşik Grup seçici (urun-ekle.html) için.
// "Mutfak & Banyo" HER İKİ taksonomide de bir grup taşıdığından (bkz. yukarıdaki not) artık basit
// bir `{...PRODUCT_TAXONOMY, ...MATERIAL_TAXONOMY}` spread'i GÜVENLİ DEĞİL — MATERIAL_TAXONOMY'de
// aynı adla bir grup olsaydı PRODUCT_TAXONOMY'dekini sessizce ezerdi. Bunun yerine her iki
// taksonomideki aynı adlı grupların kategori dizileri birleştirilir (concat), farklı adlı gruplar
// olduğu gibi kopyalanır.
const CATALOG_TAXONOMY = {};
for (const [group, cats] of Object.entries(PRODUCT_TAXONOMY)) {
  CATALOG_TAXONOMY[group] = [...cats];
}
for (const [group, cats] of Object.entries(MATERIAL_TAXONOMY)) {
  CATALOG_TAXONOMY[group] = CATALOG_TAXONOMY[group] ? [...CATALOG_TAXONOMY[group], ...cats] : [...cats];
}

// Kategori (leaf) adı -> hangi gönderi tipine ait olduğu ('products' | 'materials'). urun-ekle.html'de
// seçilen KATEGORİYE göre (artık Grup'a göre DEĞİL, bkz. yukarıdaki not) yeni bir gönderinin
// /api/products'a mı /api/materials'a mı POST edileceğini belirler — bir Grup (ör. Mutfak & Banyo)
// hem products hem materials kategorileri barındırabildiğinden bu ayrım grup değil kategori seviyesinde
// yapılmak ZORUNDA.
const CATALOG_CATEGORY_KIND = {};
Object.values(PRODUCT_TAXONOMY).forEach(cats => cats.forEach(c => { CATALOG_CATEGORY_KIND[c] = 'products'; }));
Object.values(MATERIAL_TAXONOMY).forEach(cats => cats.forEach(c => { CATALOG_CATEGORY_KIND[c] = 'materials'; }));

// urun.html'deki mega menü (bkz. kullanıcı isteği: Architonic tarzı açılır menü) — sadece görsel
// kolon dizilimi, veri CATALOG_TAXONOMY'den gelir (buradaki grup adları o objedeki anahtarlarla
// birebir eşleşmeli, yoksa mega menüde görünmez). Yeni bir Grup eklendiğinde burada da bir kolona
// eklenmezse menüde çıkmaz ama urun.html filtrelerinde çıkmaya devam eder (bu dosya salt görüntü).
const CATALOG_MENU_COLUMNS = [
  ['Mobilya'],
  ['Aydınlatma', 'Dekorasyon & Tamamlayıcılar'],
  ['Mutfak & Banyo'],
  ['Zemin & Yüzey Kaplama'],
  ['Cephe & Açıklıklar', 'Dış Mekan & Peyzaj'],
];

function taxonomyGroupOf(taxonomy, category) {
  for (const [group, cats] of Object.entries(taxonomy)) {
    if (cats.includes(category)) return group;
  }
  return null;
}

// Bilinen marka -> resmi web sitesi alan adı. Gerçek ürün fotoğrafı KULLANILMAZ (telif riski) —
// yalnızca markanın küçük favicon'u, ofis profillerinde zaten kullanılan aynı DuckDuckGo ikon
// proxy tekniğiyle (bkz. data.js#logoUrl) kart üzerinde küçük bir rozet olarak gösterilir. Yanlış/
// eksik bir alan adı sorun yaratmaz — <img onerror> ile sessizce kaldırılır (bkz. catalogCardMediaHtml).
const CATALOG_BRAND_DOMAINS = {
  "VitrA": "vitra.com.tr", "Kalebodur": "kalebodur.com", "Marshall": "marshall.com.tr",
  "Dyo": "dyo.com.tr", "Jotun": "jotun.com", "Filli Boya": "fillipoya.com.tr",
  "Kastamonu Entegre": "kastamonu.com.tr", "Egger": "egger.com", "Tarkett": "tarkett.com.tr",
  "Schüco": "schueco.com", "Reynaers Aluminium": "reynaers.com", "Şişecam": "sisecam.com.tr",
  "Knauf": "knauf.com.tr", "Saint-Gobain Weber": "weber.com.tr", "Rockwool": "rockwool.com",
  "İzocam": "izocam.com.tr", "Alumil": "alumil.com", "Egepen Deceuninck": "egepen.com.tr",
  "Alucobond": "alucobond.com", "Fibrobeton": "fibrobeton.com", "Novagres": "novagres.com",
  "Ege Seramik": "egeseramik.com", "Porcelanosa": "porcelanosa.com",
  "Duravit": "duravit.com", "Villeroy & Boch": "villeroy-boch.com",
  "Hansgrohe": "hansgrohe.com.tr", "GROHE": "grohe.com.tr",
  "Artemide": "artemide.com", "Flos": "flos.com", "Louis Poulsen": "louispoulsen.com",
  "Erco": "erco.com", "Modus Aydınlatma": "modus.com.tr",
  "Natuzzi": "natuzzi.com", "Nurus": "nurus.com", "Bene": "bene.com",
  "Bellona": "bellona.com.tr", "İstikbal": "istikbal.com.tr", "Doğtaş": "dogtas.com.tr",
  "Kilim": "kilim.com", "Merinos": "merinos.com.tr", "Taç Tekstil": "tac.com.tr",
  "Koleksiyon": "coleksiyon.com.tr", "Derin Design": "derindesign.com", "Zara Home": "zarahome.com",
  "Miele": "miele.com.tr", "Bosch": "bosch-home.com.tr", "Gaggenau": "gaggenau.com",
  "Belenco": "belenco.com", "Weinor": "weinor.de", "Nef Mutfak": "nef.com.tr",
  "NG Kütahya Seramik": "ngkutahyaseramik.com.tr", "Tuna Office": "tunaofis.com",
  "Kaleseramik": "kale.com.tr", "Normod": "normod.com", "Lazzoni": "lazzoni.com",
  "Kale": "kale.com.tr", "Çanakkale Seramik": "kale.com.tr", "Bocchi": "bocchi.com.tr",
  "Creavit": "creavit.com.tr", "Feltouch": "feltouch.tr", "Mikodam": "mikodam.com",
  "Heper": "heperlighting.com", "Lamp83": "lamp83.com.tr", "Avolux": "avolux.com",
  "Fiberli": "fiberli.com.tr", "B&T Design": "bt.design", "Ersa Mobilya": "ersamobilya.com",
  "Bürotime": "burotime.com", "Hamm Design": "hamm.com.tr", "Autoban": "autoban.com",
  "Parla Design": "parladesign.com", "Sandalyeci": "sandalyeci.com", "Tuna Ofis": "tunaofis.com",
  "Uniqka": "uniqka.com",
};

const CATALOG_PALETTE = ['#2B425F', '#3E5A78', '#5B7A9B', '#4F6478', '#7C4B4B'];
function catalogColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return CATALOG_PALETTE[Math.abs(hash) % CATALOG_PALETTE.length];
}
function catalogInitials(name) {
  return (name || '?').replace(/[—.]/g, ' ').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}
// denetim bulgusu (2026-09-01) — bkz. badge-shared.js#logoUrl'deki AYNI kök neden: site CSP'sinin
// img-src'si icons.duckduckgo.com'u içermiyor, bu yüzden dönen URL canlıda HER ZAMAN engelleniyor
// (canlıda doğrulandı) ve yalnızca kırık bir <img> + bir CSP ihlal raporu üretiyordu. null dönülünce
// çağıranlar (catalogCardMediaHtml, product-modal.js#placeholderHtml) zaten markanın baş harflerinden
// oluşan renkli yer tutucuyu tek başına gösteriyor.
function catalogBrandFavicon(brand) {
  return null;
}

// Kart görseli: gerçek bir fotoğraf varsa onu, yoksa marka/başlık renginden türetilmiş, markanın
// (biliniyorsa) küçük favicon'unu ve baş harflerini içeren güvenli bir yer tutucu döner — hiçbir
// zaman gerçek bir ürün fotoğrafı taklit edilmez (bkz. kullanıcı isteği: telif riski almadan).
// eager (opsiyonel, varsayılan false) — denetim bulgusu (2026-09-01): bu fonksiyon HER görseli
// koşulsuz loading="lazy" ile basıyordu, oysa proje/mimar/firma/marka listeleri ilk satırı
// eager+fetchpriority="high" ile istiyor (bkz. js/pages/proje.js#render). /urun sayfasının LCP
// görseli bu yüzden gereksiz yere geciktiriliyordu. Parametre verilmeyen çağıranlar (js/components/
// project-products.js) ESKİ davranışı birebir korur.
function catalogCardMediaHtml(item, escapeHtmlFn, escapeAttrFn, eager) {
  if (item.image) {
    // cdnImg/cdnSrcset (bkz. image-cdn.js) sayfayı çağıran her yerde (urun.html, js/components/
    // project-products.js) zaten yüklü — IMAGE_CDN_ENABLED false olduğu sürece passthrough, srcset boş.
    const srcset = cdnSrcset(item.image, [400, 600, 800]);
    const loadAttrs = eager ? 'loading="eager" fetchpriority="high" decoding="sync"' : 'loading="lazy" fetchpriority="low" decoding="async"';
    return `<img src="${escapeAttrFn(cdnImg(item.image, 600))}"${srcset ? ` srcset="${escapeAttrFn(srcset)}" sizes="(max-width: 720px) 50vw, (max-width: 960px) 33vw, 400px"` : ''} alt="${escapeAttrFn(item.title)}" ${loadAttrs}>`;
  }
  const label = item.brand || item.title;
  const favicon = catalogBrandFavicon(item.brand);
  return `<div class="catalog-placeholder" style="background:${catalogColor(label)}">
    ${favicon ? `<img class="catalog-placeholder-favicon" src="${escapeAttrFn(favicon)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
    <span class="catalog-placeholder-initials">${escapeHtmlFn(catalogInitials(label))}</span>
  </div>`;
}

// Tarayıcıda `module` global'i tanımsız olduğu için bu blok yalnızca Worker'ın esbuild bundle'ında
// (nodejs_compat) çalışır — src/routes/product.js buradan CJS interop ile import eder (bkz.
// src/routes/project.js'in il-ilce-data.js için kullandığı AYNI desen — bu dosya da canonical veri
// DEĞİL, salt statik bir taksonomi referans tablosu).
if (typeof module !== 'undefined') { module.exports = { CATALOG_TAXONOMY, CATALOG_MENU_COLUMNS, taxonomyGroupOf }; }
