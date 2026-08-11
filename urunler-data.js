// MİMARLAB — Ürünler veri kaynağı (mobilya gibi tüketici ürünleri).
// Yapı malzemeleri (doğal taş, boya, seramik vb.) malzemeler-data.js'teki materials dizisine
// taşındı (bkz. malzeme.html). category alanı, catalog-taxonomy.js#PRODUCT_TAXONOMY'deki bir alt
// kategori (leaf) ile birebir eşleşmelidir — Grup filtresi (bkz. urun.html) bu eşleşmeden türetilir.
// `image` alanı olmayan kayıtlarda kart, markanın (biliniyorsa) küçük favicon'unu ve baş harflerini
// gösteren güvenli bir yer tutucuyla render edilir — telif riski taşıyan gerçek ürün fotoğrafı
// hiçbir yerde kullanılmaz (bkz. catalog-taxonomy.js#catalogCardMediaHtml).
const products = [
  // --- Mobilya ---
  {title:"Toledo", category:"Koltuk & Kanepe", brand:"Natuzzi", website:"https://www.natuzzi.com/tr/en/shop/natuzzi-editions/of-most-loved/toledo-c301-s",
    image:"projects/urun-natuzzi-chesterfield-deri-koltuk.jpeg", images:["projects/urun-natuzzi-chesterfield-deri-koltuk.jpeg"],
    specs:[
      {label:"Koleksiyon", value:"Neo Heritage (Natuzzi Editions)"},
      {label:"Tasarım Detayı", value:"Oturum, sırtlık ve dış kol panelinde ince işçilikli capitone (tufted) dikişler"},
      {label:"Stil", value:"Minimal ve vintage tarzın sentezi"},
      {label:"Malzeme", value:"Deri veya kumaş döşeme seçeneği"},
      {label:"Ayak Seçenekleri", value:"Ceviz veya venge ahşap ayak; mat siyah veya fırçalanmış pirinç metal ayak"},
      {label:"Taban Yapısı", value:"Açık taban (kolay temizlik)"},
      {label:"Tasarım Kökeni", value:"İtalya'da Natuzzi Design Center tarafından tasarlandı"},
    ]},
  {title:"Legato Köşe Koltuk Takımı", category:"Koltuk & Kanepe", brand:"İstikbal", website:"https://www.istikbal.com.tr/urun/legato-kose-koltuk-takimi",
    image:"projects/urun-istikbal-nova-kose-koltuk-takimi.jpg", images:["projects/urun-istikbal-nova-kose-koltuk-takimi.jpg"],
    specs:[
      {label:"Ölçüler", value:"Genişlik 310 cm, Derinlik 268 cm, Yükseklik 83 cm"},
      {label:"Oturum Ölçüleri", value:"Oturum Derinliği 60 cm, Oturum Genişliği 259 cm, Oturum Yüksekliği 47 cm"},
      {label:"Yatak Ölçüsü", value:"204 x 108 cm"},
      {label:"Fonksiyon", value:"Yataklı / Sandıklı"},
      {label:"Tasarım", value:"Bohem"},
      {label:"Oturum Minderi", value:"32 Dns Soft Sünger"},
      {label:"Kumaş Temizlik Önerisi", value:"Nemli Bezle Silinebilir"},
      {label:"Garanti", value:"2 Yıl"},
    ]},
  {title:"Aura", category:"Sandalye & Tabure", brand:"Nurus", website:"https://nurus.com/tr/product/aura-family-tr/aura-tr/",
    image:"projects/urun-nurus-ally-sandalye.webp", images:["projects/urun-nurus-ally-sandalye.webp"],
    specs:[
      {label:"Başlangıç Fiyatı", value:"22.300 TL'den başlayan fiyatlarla"},
      {label:"Döşeme", value:"Kumaş ve deri döşeme seçenekleri"},
      {label:"Ayak", value:"Alüminyum yıldız ayak"},
      {label:"Tekerlek", value:"Yumuşak veya sert zemin tekerlek seçenekleri"},
      {label:"Mekanizma", value:"Eğim ayarlı sırt mekanizması, ayarlanabilir oturma yüksekliği"},
      {label:"Üretim", value:"%95 dikey entegre üretim (Nurus tesisi)"},
      {label:"Kumaş Sertifikası", value:"Uluslararası sertifikalı kumaşlar"},
    ]},
  {title:"Claris Sabit Yemek Masası", category:"Masa", brand:"Bellona", website:"https://www.bellona.com.tr/urun/claris-sabit-yemek-masasi",
    image:"projects/urun-bellona-cristal-yemek-masasi.jpg", images:["projects/urun-bellona-cristal-yemek-masasi.jpg"],
    specs:[
      {label:"Genişlik", value:"200 cm"},
      {label:"Derinlik", value:"100 cm"},
      {label:"Yükseklik", value:"77,8 cm"},
      {label:"Ayak Yapısı", value:"Origami etkili geometrik form, ortadan tekli ayak"},
      {label:"Renk", value:"Krem"},
      {label:"Ürün Cinsi", value:"Özelleştirilmiş Ürün"},
      {label:"Garanti Süresi", value:"2 Yıl"},
    ]},
  {title:"Next Toplantı Masası", category:"Masa", brand:"Nurus", website:"https://nurus.com/tr/product/next-yonetici-serisi/next-toplanti-masasi/",
    image:"projects/urun-nurus-ondo-toplanti-masasi.webp", images:["projects/urun-nurus-ondo-toplanti-masasi.webp"],
    specs:[
      {label:"Ürün Ailesi", value:"Next Yönetici Serisi"},
      {label:"Ayak Seçenekleri", value:"Çift ayaklı (klasik/simetrik) veya yan dolapla entegre tek ayaklı yapı"},
      {label:"Boyut Seçenekleri", value:"Serinin genelinde farklı boyut ve ayak seçenekleri mevcut"},
      {label:"Kullanım Alanı", value:"Toplantı odaları ve yönetici ofisleri"},
      {label:"Kablo Yönetimi", value:"Masa yüzeyinde entegre kablo kanalı"},
    ]},

  // --- Aydınlatma ---

  // --- Mutfak & Beyaz Eşya ---

  // --- Tekstil & Halı ---

  // --- Dekorasyon & Aksesuar ---
  // --- Dış Mekan ---
];

// Tarayıcıda `module` global'i tanımsız olduğu için bu blok yalnızca Worker'ın esbuild bundle'ında
// (nodejs_compat) çalışır — src/routes/legacyContent.js buradan CJS interop ile import eder.
if (typeof module !== 'undefined') { module.exports = { products }; }
