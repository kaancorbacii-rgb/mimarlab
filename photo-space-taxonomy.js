// FOTOĞRAF sayfasının (bkz. /fotograf, kullanıcı isteği 2026-09-17: "Kişi arama butonundan
// istediği mekanı seçerek ... Mekan filtremesini yapay zeka yapsın") "Mekana Göre Ara" filtresinin
// TEK kaynağı — hem AI sınıflandırma promptunun (bkz. src/lib/photoSpaceClassify.js) izin verilen
// SABİT çıktı listesi, hem istemcideki arama kutusunun (fotograf.html) seçenek listesi BURADAN
// gelir. Model bu listenin DIŞINDA bir etiket üretirse süzülür (project-taxonomy.js#
// PROJECT_GROUP_OPTIONS ile AYNI whitelist ilkesi).
//
// SIRA KULLANICININ VERDİĞİ SIRADIR, alfabetik DEĞİL (kullanıcı isteği, 2026-09-17 ikinci tur
// madde 3: "Arama çubuğunda mekanları 1- Oturma Odası 2- Mutfak ... 15- Cephe Çizimi şeklinde
// sırala") — dropdown bu diziyi OLDUĞU GİBİ çizer, yeniden sıralamaz. Son üç madde fotoğraf değil
// ÇİZİM türüdür (plan/kesit/cephe); sınıflandırma promptu bu ayrımı açıkça yapar (bkz.
// photoSpaceClassify.js#PROMPT).
//
// `description` yalnızca AI promptu içindir: modele her etiketin ne anlama geldiğini söyler
// (ör. "Tuvalet & Banyo" hem WC hem banyo; "Resepsiyon" otel/ofis giriş bankosu). Kullanıcıya
// gösterilmez.
const PHOTO_SPACE_TAXONOMY = [
  { label: 'Oturma Odası', description: 'salon, oturma alanı, misafir odası; kanepe/koltuk grubu, TV ünitesi, şömine' },
  { label: 'Mutfak', description: 'mutfak tezgahı, dolaplar, ada, ocak, mutfak-yemek birleşik alanlar' },
  { label: 'Yatak Odası', description: 'yatak odası, çocuk odası, otel odası; yatak görünüyorsa' },
  { label: 'Tuvalet & Banyo', description: 'banyo, tuvalet, WC, lavabo, duş, küvet' },
  { label: 'Çalışma Odası', description: 'çalışma odası, ev ofisi, ofis çalışma alanı, masa+sandalye, açık ofis, toplantı odası' },
  { label: 'Koridor', description: 'koridor, hol, antre, giriş holü, geçiş alanı' },
  { label: 'Merdiven', description: 'merdiven, merdiven kovası, sahanlık; merdiven fotoğrafın ana konusuysa' },
  { label: 'Balkon', description: 'balkon, teras, veranda, çatı terası' },
  { label: 'Bahçe', description: 'bahçe, avlu, peyzaj, dış mekan oturma alanı, çim/bitki alanları' },
  { label: 'Havuz', description: 'yüzme havuzu, süs havuzu, havuz kenarı' },
  { label: 'Resepsiyon', description: 'resepsiyon bankosu, lobi, otel/ofis/klinik giriş-karşılama alanı' },
  { label: 'Depo', description: 'depo, kiler, ardiye, garaj, teknik hacim, arşiv' },
  { label: 'Plan Çizimi', description: 'mimari PLAN çizimi (kat planı, vaziyet planı) — fotoğraf DEĞİL, teknik çizim' },
  { label: 'Kesit Çizimi', description: 'mimari KESİT çizimi — fotoğraf DEĞİL, teknik çizim' },
  { label: 'Cephe Çizimi', description: 'mimari CEPHE/görünüş çizimi ya da render — fotoğraf DEĞİL, teknik çizim' },
];
const PHOTO_SPACE_OPTIONS = PHOTO_SPACE_TAXONOMY.map(t => t.label);

// Tarayıcıda `module` global'i tanımsız olduğu için bu blok yalnızca Worker'ın esbuild bundle'ında
// (nodejs_compat) çalışır — src/lib/photoSpaceClassify.js ve src/routes/photos.js buradan CJS
// interop ile import eder (bkz. project-taxonomy.js/catalog-taxonomy.js'deki AYNI desen).
if (typeof module !== 'undefined') { module.exports = { PHOTO_SPACE_OPTIONS, PHOTO_SPACE_TAXONOMY }; }
