// MİMARLAB — Malzemeler veri kaynağı (yapı malzemeleri: doğal taş, boya, seramik, cam vb.).
// Mobilya gibi tüketici ürünleri urunler-data.js'teki products dizisinde kalır (bkz. urun.html).
// category alanı, catalog-taxonomy.js#MATERIAL_TAXONOMY'deki bir alt kategori (leaf) ile birebir
// eşleşmelidir — Grup filtresi (bkz. malzeme.html) bu eşleşmeden türetilir. Gerçek bir fotoğrafımız
// olmayan kayıtlarda `image` alanı kasıtlı olarak boş bırakılır: kart, markanın (biliniyorsa) küçük
// favicon'unu ve baş harflerini gösteren güvenli bir yer tutucuyla render edilir — telif riski
// taşıyan gerçek ürün fotoğrafı hiçbir yerde kullanılmaz (bkz. catalog-taxonomy.js#catalogCardMediaHtml).
const materials = [
  // --- Mevcut, gerçek görselli kayıtlar (görseller korunuyor, sadece kategori yeni taksonomiye eşlendi) ---
  {title:"Vitrifiye Serisi", category:"Vitrifiye", brand:"VitrA", image:"projects/urun-vitra-vitrifiye.jpg", website:"https://www.vitra.com.tr"},
  {title:"Calacatta Unique Labradorite Porselen Karo", category:"Seramik & Porselen Karo", brand:"Kalebodur", image:"projects/urun-kalebodur-calacatta.jpg", website:"https://www.kalebodur.com"},
  {title:"2026 Yılın Rengi Koleksiyonu", category:"İç Cephe Boyası", brand:"Marshall", image:"projects/urun-marshall-renk2026.jpg", website:"https://www.marshall.com.tr"},
  {title:"Laminat Parke", category:"Laminat & Parke", brand:"Kastamonu Entegre", image:"projects/urun-kastamonu-laminat.jpg", website:"https://www.kastamonu.com.tr"},

  // --- Doğal Taş & Zemin ---

  // --- Boya & Kaplama ---

  // --- Cephe & Cam Sistemleri ---

  // --- Sıva & Alçı ---

  // --- Yalıtım ---

  // --- Kapı & Pencere ---

  // --- Banyo ---
];

// Tarayıcıda `module` global'i tanımsız olduğu için bu blok yalnızca Worker'ın esbuild bundle'ında
// (nodejs_compat) çalışır — src/routes/legacyContent.js buradan CJS interop ile import eder.
if (typeof module !== 'undefined') { module.exports = { materials }; }
