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
const PRODUCT_TAXONOMY = {
  "Mobilya": ["Koltuk & Kanepe", "Sandalye & Tabure", "Masa", "Yatak & Baza", "Dolap & Depolama", "Ofis Mobilyası"],
  "Aydınlatma": ["İç Mekan Aydınlatma", "Dış Mekan Aydınlatma", "Sarkıt & Avize"],
  "Mutfak & Beyaz Eşya": ["Ankastre Ürünler", "Mutfak Mobilyası", "Tezgah"],
  "Tekstil & Halı": ["Halı", "Perde", "Kumaş & Döşemelik"],
  "Dekorasyon & Aksesuar": ["Aynalar", "Duvar Objeleri", "Vazo & Obje"],
  "Dış Mekan": ["Bahçe Mobilyası", "Pergole & Gölgelendirme"],
};

// Not: Sabit/yapıya monte banyo ürünleri (vitrifiye, armatür vb.) kasıtlı olarak burada değil,
// Malzeme tarafındaki "Banyo" grubunda — inşaat/tadilat aşamasında seçilen bir "yapı malzemesi"
// olarak ele alınıyor, taşınabilir mobilya/ürünlerden ayrı (bkz. MATERIAL_TAXONOMY).
const MATERIAL_TAXONOMY = {
  "Doğal Taş & Zemin": ["Mermer", "Traverten", "Seramik & Porselen Karo", "Laminat & Parke"],
  "Boya & Kaplama": ["İç Cephe Boyası", "Dış Cephe Boyası", "Ahşap Kaplama", "Beton Görünümlü Kaplama"],
  "Cephe & Cam Sistemleri": ["Cephe Sistemleri", "Cam", "Panel & Kompozit"],
  "Sıva & Alçı": ["Alçı Sıva", "Dekoratif Sıva"],
  "Yalıtım": ["Isı Yalıtımı", "Su Yalıtımı", "Ses Yalıtımı"],
  "Kapı & Pencere": ["PVC/Alüminyum Doğrama", "İç Kapı"],
  "Banyo": ["Vitrifiye", "Armatür", "Duş Sistemleri", "Banyo Mobilyası"],
};

// Birleşik Grup/Kategori filtresi (urun.html) ve birleşik Grup seçici (urun-ekle.html) için.
// Grup adları iki taksonomi arasında çakışmaz, kategori (leaf) adları da çakışmaz — bu yüzden basit
// bir merge güvenli.
const CATALOG_TAXONOMY = { ...PRODUCT_TAXONOMY, ...MATERIAL_TAXONOMY };

// Grup adı -> hangi gönderi tipine ait olduğu ('products' | 'materials'). urun-ekle.html'de seçilen
// Grup'a göre yeni bir gönderinin /api/products'a mı /api/materials'a mı POST edileceğini belirler.
const CATALOG_GROUP_KIND = {};
Object.keys(PRODUCT_TAXONOMY).forEach(g => { CATALOG_GROUP_KIND[g] = 'products'; });
Object.keys(MATERIAL_TAXONOMY).forEach(g => { CATALOG_GROUP_KIND[g] = 'materials'; });

// urun.html'deki mega menü (bkz. kullanıcı isteği: Architonic tarzı açılır menü) — sadece görsel
// kolon dizilimi, veri CATALOG_TAXONOMY'den gelir (buradaki grup adları o objedeki anahtarlarla
// birebir eşleşmeli, yoksa mega menüde görünmez). Yeni bir Grup eklendiğinde burada da bir kolona
// eklenmezse menüde çıkmaz ama urun.html filtrelerinde çıkmaya devam eder (bu dosya salt görüntü).
const CATALOG_MENU_COLUMNS = [
  ['Mobilya', 'Dekorasyon & Aksesuar'],
  ['Aydınlatma', 'Tekstil & Halı'],
  ['Mutfak & Beyaz Eşya', 'Dış Mekan', 'Banyo'],
  ['Doğal Taş & Zemin', 'Boya & Kaplama', 'Cephe & Cam Sistemleri'],
  ['Sıva & Alçı', 'Yalıtım', 'Kapı & Pencere'],
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
function catalogBrandFavicon(brand) {
  const domain = brand && CATALOG_BRAND_DOMAINS[brand];
  return domain ? `https://icons.duckduckgo.com/ip3/${domain}.ico` : null;
}

// Kart görseli: gerçek bir fotoğraf varsa onu, yoksa marka/başlık renginden türetilmiş, markanın
// (biliniyorsa) küçük favicon'unu ve baş harflerini içeren güvenli bir yer tutucu döner — hiçbir
// zaman gerçek bir ürün fotoğrafı taklit edilmez (bkz. kullanıcı isteği: telif riski almadan).
function catalogCardMediaHtml(item, escapeHtmlFn, escapeAttrFn) {
  if (item.image) {
    // cdnImg/cdnSrcset (bkz. image-cdn.js) sayfayı çağıran her yerde (urun.html, js/components/
    // project-products.js) zaten yüklü — IMAGE_CDN_ENABLED false olduğu sürece passthrough, srcset boş.
    const srcset = cdnSrcset(item.image, [400, 600, 800]);
    return `<img src="${escapeAttrFn(cdnImg(item.image, 600))}"${srcset ? ` srcset="${escapeAttrFn(srcset)}" sizes="(max-width: 720px) 50vw, (max-width: 960px) 33vw, 400px"` : ''} alt="${escapeAttrFn(item.title)}" loading="lazy" decoding="async">`;
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
if (typeof module !== 'undefined') { module.exports = { CATALOG_TAXONOMY, taxonomyGroupOf }; }
