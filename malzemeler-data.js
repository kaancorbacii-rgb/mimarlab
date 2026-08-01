// MİMARLAB — Malzemeler veri kaynağı (yapı malzemeleri: doğal taş, boya, seramik, cam vb.).
// Mobilya gibi tüketici ürünleri urunler-data.js'teki products dizisinde kalır (bkz. urun.html).
// category alanı, catalog-taxonomy.js#MATERIAL_TAXONOMY'deki bir alt kategori (leaf) ile birebir
// eşleşmelidir — Grup filtresi (bkz. malzeme.html) bu eşleşmeden türetilir. Gerçek bir fotoğrafımız
// olmayan kayıtlarda `image` alanı kasıtlı olarak boş bırakılır: kart, markanın (biliniyorsa) küçük
// favicon'unu ve baş harflerini gösteren güvenli bir yer tutucuyla render edilir — telif riski
// taşıyan gerçek ürün fotoğrafı hiçbir yerde kullanılmaz (bkz. catalog-taxonomy.js#catalogCardMediaHtml).
const materials = [
  // --- Mevcut, gerçek görselli kayıtlar (görseller korunuyor, sadece kategori yeni taksonomiye eşlendi) ---
  {title:"Mat Cephe Boyası", category:"Dış Cephe Boyası", brand:null, image:"projects/material-navy-paint.jpg"},
  {title:"Ahşap Cephe Kaplaması", category:"Ahşap Kaplama", brand:null, image:"projects/material-wood-cladding.jpg"},
  {title:"Beton Görünümlü Sıva", category:"Beton Görünümlü Kaplama", brand:null, image:"projects/material-concrete-plaster.jpg"},
  {title:"Mermer Görünümlü Seramik", category:"Seramik & Porselen Karo", brand:null, image:"projects/material-marble-tile.jpg"},
  {title:"Şeffaf Temperli Cam", category:"Cam", brand:null, image:"projects/material-glass-facade.jpg"},
  {title:"Vitrifiye Serisi", category:"Vitrifiye", brand:"VitrA", image:"projects/urun-vitra-vitrifiye.jpg", website:"https://www.vitra.com.tr"},
  {title:"Calacatta Unique Labradorite Porselen Karo", category:"Seramik & Porselen Karo", brand:"Kalebodur", image:"projects/urun-kalebodur-calacatta.jpg", website:"https://www.kalebodur.com"},
  {title:"2026 Yılın Rengi Koleksiyonu", category:"İç Cephe Boyası", brand:"Marshall", image:"projects/urun-marshall-renk2026.jpg", website:"https://www.marshall.com.tr"},
  {title:"Laminat Parke", category:"Laminat & Parke", brand:"Kastamonu Entegre", image:"projects/urun-kastamonu-laminat.jpg", website:"https://www.kastamonu.com.tr"},

  // --- Doğal Taş & Zemin ---
  {title:"Afyon Beyaz Mermer Levha", category:"Mermer", brand:null},
  {title:"Calacatta Mermer Blok", category:"Mermer", brand:null},
  {title:"Ekstra Büyük Format Karo", category:"Seramik & Porselen Karo", brand:"Porcelanosa", website:"https://www.porcelanosa.com"},
  {title:"Beton Doku Serisi Karo", category:"Seramik & Porselen Karo", brand:"Novagres", website:"https://www.novagres.com"},
  {title:"Traverten Desen Karo", category:"Seramik & Porselen Karo", brand:"Ege Seramik", website:"https://www.egeseramik.com"},
  {title:"Meşe Desen Laminat Parke", category:"Laminat & Parke", brand:"Egger", website:"https://www.egger.com"},
  {title:"iQ Vinil Zemin Kaplaması", category:"Laminat & Parke", brand:"Tarkett", website:"https://www.tarkett.com.tr"},

  // --- Boya & Kaplama ---
  {title:"Silver İç Cephe Boyası", category:"İç Cephe Boyası", brand:"Dyo", website:"https://www.dyo.com.tr"},
  {title:"Fasadmaling Dış Cephe Boyası", category:"Dış Cephe Boyası", brand:"Jotun", website:"https://www.jotun.com"},
  {title:"Dış Cephe Silikonlu Boya Serisi", category:"Dış Cephe Boyası", brand:"Filli Boya"},
  {title:"Termoahşap Cephe Kaplaması", category:"Ahşap Kaplama", brand:null},
  {title:"Mikrobeton Duvar Kaplaması", category:"Beton Görünümlü Kaplama", brand:null},

  // --- Cephe & Cam Sistemleri ---
  {title:"AWS Alüminyum Cephe Sistemi", category:"Cephe Sistemleri", brand:"Schüco", website:"https://www.schueco.com"},
  {title:"CW 50 Cephe Sistemi", category:"Cephe Sistemleri", brand:"Reynaers Aluminium", website:"https://www.reynaers.com"},
  {title:"Isıcam Düşük-E Cam", category:"Cam", brand:"Şişecam", website:"https://www.sisecam.com.tr"},
  {title:"Alucobond Kompozit Cephe Paneli", category:"Panel & Kompozit", brand:"Alucobond", website:"https://www.alucobond.com"},
  {title:"Fiber Takviyeli Beton Cephe Paneli", category:"Panel & Kompozit", brand:"Fibrobeton", website:"https://www.fibrobeton.com"},

  // --- Sıva & Alçı ---
  {title:"MP 75 Makine Sıvası", category:"Alçı Sıva", brand:"Knauf", website:"https://www.knauf.com.tr"},
  {title:"Dekoratif Sıva Serisi", category:"Dekoratif Sıva", brand:"Saint-Gobain Weber"},
  {title:"Alçıpan Asma Tavan Sistemi", category:"Alçı Sıva", brand:"Knauf"},

  // --- Yalıtım ---
  {title:"Taşyünü Isı Yalıtım Levhası", category:"Isı Yalıtımı", brand:"Rockwool", website:"https://www.rockwool.com"},
  {title:"XPS Isı Yalıtım Levhası", category:"Isı Yalıtımı", brand:"İzocam", website:"https://www.izocam.com.tr"},
  {title:"Bitümlü Su Yalıtım Membranı", category:"Su Yalıtımı", brand:"İzocam"},
  {title:"Akustik Ses Yalıtım Paneli", category:"Ses Yalıtımı", brand:"Rockwool"},

  // --- Kapı & Pencere ---
  {title:"S67 Isı Yalıtımlı Alüminyum Doğrama", category:"PVC/Alüminyum Doğrama", brand:"Alumil", website:"https://www.alumil.com"},
  {title:"Legend PVC Doğrama Sistemi", category:"PVC/Alüminyum Doğrama", brand:"Egepen Deceuninck", website:"https://www.egepen.com.tr"},
  {title:"Çelik Kapı Serisi", category:"İç Kapı", brand:null},
  {title:"Amerikan Panel İç Kapı", category:"İç Kapı", brand:null},

  // --- Banyo ---
  {title:"Happy D.2 Lavabo Serisi", category:"Vitrifiye", brand:"Duravit", website:"https://www.duravit.com"},
  {title:"Subway 3.0 Serisi", category:"Vitrifiye", brand:"Villeroy & Boch", website:"https://www.villeroy-boch.com"},
  {title:"Talis Lavabo Bataryası", category:"Armatür", brand:"Hansgrohe", website:"https://www.hansgrohe.com.tr"},
  {title:"Eurosmart Banyo Bataryası", category:"Armatür", brand:"GROHE", website:"https://www.grohe.com.tr"},
  {title:"Cam Duşakabin Sistemi", category:"Duş Sistemleri", brand:"VitrA"},
  {title:"Banyo Dolabı Serisi", category:"Banyo Mobilyası", brand:"VitrA"},
];

// Tarayıcıda `module` global'i tanımsız olduğu için bu blok yalnızca Worker'ın esbuild bundle'ında
// (nodejs_compat) çalışır — src/routes/legacyContent.js buradan CJS interop ile import eder.
if (typeof module !== 'undefined') { module.exports = { materials }; }
