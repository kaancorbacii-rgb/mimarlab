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
  {title:"Nova Yatak Serisi", category:"Yatak & Baza", brand:"İstikbal"},
  {title:"Comfort Baza Seti", category:"Yatak & Baza", brand:"Bellona"},
  {title:"Modüler Gardırop Sistemi", category:"Dolap & Depolama", brand:"Doğtaş", website:"https://www.dogtas.com.tr"},
  {title:"Açık Raf Kitaplık Sistemi", category:"Dolap & Depolama", brand:"Koleksiyon"},
  {title:"Ally Çalışma İstasyonu", category:"Ofis Mobilyası", brand:"Nurus"},
  {title:"Parcs Ofis Mobilya Sistemi", category:"Ofis Mobilyası", brand:"Bene", website:"https://www.bene.com"},

  // --- Aydınlatma ---
  {title:"Tolomeo Masa Lambası", category:"İç Mekan Aydınlatma", brand:"Artemide", website:"https://www.artemide.com"},
  {title:"Spot Aydınlatma Sistemi", category:"İç Mekan Aydınlatma", brand:"Modus Aydınlatma", website:"https://www.modus.com.tr"},
  {title:"IC Lights Sarkıt", category:"Sarkıt & Avize", brand:"Flos", website:"https://www.flos.com"},
  {title:"PH5 Sarkıt Aydınlatma", category:"Sarkıt & Avize", brand:"Louis Poulsen", website:"https://www.louispoulsen.com"},
  {title:"Mimari Dış Cephe Projektörü", category:"Dış Mekan Aydınlatma", brand:"Erco", website:"https://www.erco.com"},
  {title:"LED Bahçe Spot Serisi", category:"Dış Mekan Aydınlatma", brand:"Modus Aydınlatma"},

  // --- Mutfak & Beyaz Eşya ---
  {title:"Ankastre Set (Fırın + Ocak)", category:"Ankastre Ürünler", brand:"Bosch", website:"https://www.bosch-home.com.tr"},
  {title:"Vario Ankastre Fırın", category:"Ankastre Ürünler", brand:"Gaggenau", website:"https://www.gaggenau.com"},
  {title:"Ankastre Bulaşık Makinesi", category:"Ankastre Ürünler", brand:"Miele", website:"https://www.miele.com.tr"},
  {title:"Kelebek Mutfak Sistemi", category:"Mutfak Mobilyası", brand:"Doğtaş"},
  {title:"Kuvars Kompozit Mutfak Tezgahı", category:"Tezgah", brand:"Belenco", website:"https://www.belenco.com"},

  // --- Tekstil & Halı ---
  {title:"El Dokuması Yün Halı", category:"Halı", brand:"Kilim", website:"https://www.kilim.com"},
  {title:"Modern Desen Halı Koleksiyonu", category:"Halı", brand:"Merinos", website:"https://www.merinos.com.tr"},
  {title:"Blackout Perde Kumaşı", category:"Perde", brand:"Taç Tekstil", website:"https://www.tac.com.tr"},

  // --- Dekorasyon & Aksesuar ---
  {title:"Işıklı Ayna Serisi", category:"Aynalar", brand:"Koleksiyon"},
  {title:"Seramik Vazo Koleksiyonu", category:"Vazo & Obje", brand:"Zara Home", website:"https://www.zarahome.com"},
  // --- Dış Mekan ---
  {title:"Teak Bahçe Oturma Grubu", category:"Bahçe Mobilyası", brand:"Koleksiyon"},
  {title:"Alüminyum Pergole Sistemi", category:"Pergole & Gölgelendirme", brand:"Weinor", website:"https://www.weinor.de"},
  {title:"Bahçe Şezlong Takımı", category:"Bahçe Mobilyası", brand:"Natuzzi"},
];

// Tarayıcıda `module` global'i tanımsız olduğu için bu blok yalnızca Worker'ın esbuild bundle'ında
// (nodejs_compat) çalışır — src/routes/legacyContent.js buradan CJS interop ile import eder.
if (typeof module !== 'undefined') { module.exports = { products }; }
