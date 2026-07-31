// MİMARLAB — Ürünler veri kaynağı (mobilya gibi tüketici ürünleri).
// Yapı malzemeleri (doğal taş, boya, seramik vb.) malzemeler-data.js'teki materials dizisine
// taşındı (bkz. malzeme.html). category alanı, catalog-taxonomy.js#PRODUCT_TAXONOMY'deki bir alt
// kategori (leaf) ile birebir eşleşmelidir — Grup filtresi (bkz. urun.html) bu eşleşmeden türetilir.
// `image` alanı olmayan kayıtlarda kart, markanın (biliniyorsa) küçük favicon'unu ve baş harflerini
// gösteren güvenli bir yer tutucuyla render edilir — telif riski taşıyan gerçek ürün fotoğrafı
// hiçbir yerde kullanılmaz (bkz. catalog-taxonomy.js#catalogCardMediaHtml).
const products = [
  // --- Mobilya ---
  {title:"Chesterfield Deri Koltuk", category:"Koltuk & Kanepe", brand:"Natuzzi", website:"https://www.natuzzi.com"},
  {title:"Nova Köşe Koltuk Takımı", category:"Koltuk & Kanepe", brand:"İstikbal", website:"https://www.istikbal.com.tr"},
  {title:"Ally Sandalye", category:"Sandalye & Tabure", brand:"Nurus", website:"https://www.nurus.com"},
  {title:"Bar Taburesi Serisi", category:"Sandalye & Tabure", brand:"Derin Design", website:"https://www.derindesign.com"},
  {title:"Cristal Yemek Masası", category:"Masa", brand:"Bellona", website:"https://www.bellona.com.tr"},
  {title:"Ondo Toplantı Masası", category:"Masa", brand:"Nurus"},
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
  {title:"Duvar Panosu Serisi", category:"Duvar Objeleri", brand:"Derin Design"},

  // --- Dış Mekan ---
  {title:"Teak Bahçe Oturma Grubu", category:"Bahçe Mobilyası", brand:"Koleksiyon"},
  {title:"Alüminyum Pergole Sistemi", category:"Pergole & Gölgelendirme", brand:"Weinor", website:"https://www.weinor.de"},
  {title:"Bahçe Şezlong Takımı", category:"Bahçe Mobilyası", brand:"Natuzzi"},
];
