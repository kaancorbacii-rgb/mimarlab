// FOTOĞRAF sayfasının (bkz. /fotograf, kullanıcı isteği 2026-09-17: "Kişi arama butonundan
// istediği mekanı seçerek ... yatak odasıyla alakalı tüm fotoğraflar ... sıralanacak. Mekan
// filtremesini yapay zeka yapsın") "Mekana Göre Ara" filtresinin TEK kaynağı — hem AI sınıflandırma
// promptunun (bkz. src/lib/photoSpaceClassify.js) izin verilen SABİT çıktı listesi, hem istemcideki
// arama kutusunun (fotograf.html) seçenek listesi BURADAN gelir. Model bu listenin DIŞINDA bir
// etiket üretirse süzülür (project-taxonomy.js#PROJECT_GROUP_OPTIONS ile AYNI whitelist ilkesi —
// "AI kendi bilgisinden proje veya ürün uydurmamalı", bkz. src/lib/visionAnalyze.js dosya başı).
//
// Referans: https://co-architecture.com/photos (kullanıcının verdiği örnek site) — Bathroom/
// Bedroom/Courtyard/Deck/Dining room/Garden/Kitchen... listesi Türkçeleştirilip MİMARLAB'ın proje
// fotoğraf çeşitliliğine (ofis/ticari/kentsel projeler dahil) göre genişletildi. Sıra alfabetiktir
// (TR) — arama kutusundaki dropdown bu sırayla çizilir.
const PHOTO_SPACE_OPTIONS = [
  'Avlu',
  'Bahçe',
  'Balkon',
  'Banyo',
  'Çalışma Odası / Ofis',
  'Çatı',
  'Dış Cephe',
  'Giriş / Antre',
  'Havuz',
  'Koridor',
  'Lobi',
  'Merdiven',
  'Mutfak',
  'Otopark / Garaj',
  'Oturma Odası',
  'Spor Alanı',
  'Teras',
  'Toplantı Odası',
  'Yatak Odası',
  'Yemek Odası',
];

// Tarayıcıda `module` global'i tanımsız olduğu için bu blok yalnızca Worker'ın esbuild bundle'ında
// (nodejs_compat) çalışır — src/lib/photoSpaceClassify.js ve src/routes/photos.js buradan CJS
// interop ile import eder (bkz. project-taxonomy.js/catalog-taxonomy.js'deki AYNI desen).
if (typeof module !== 'undefined') { module.exports = { PHOTO_SPACE_OPTIONS }; }
