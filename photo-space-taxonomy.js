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
// `keywords` (2026-09-18): KÜNYE eşleşmesi için anahtar kelimeler — (a) arama kutusunda kullanıcı
// "wc"/"salon" yazınca AI'a gitmeden etikete eşlemek, (b) AI etiketi olmayan görsellerde projenin
// künyesinden (başlık/açıklama/tip/grup) İKİNCİL sonuç üretmek için (bkz. src/lib/photoPool.js#
// keywordSpacesFor, src/routes/photos.js). Küçük harf, Türkçe katlanmış; alt dize eşleşir.
const PHOTO_SPACE_TAXONOMY = [
  { label: 'Oturma Odası', description: 'salon, oturma alanı, misafir odası; kanepe/koltuk grubu, TV ünitesi, şömine', keywords: ['oturma', 'salon', 'living', 'lounge'] },
  { label: 'Mutfak', description: 'mutfak tezgahı, dolaplar, ada, ocak, mutfak-yemek birleşik alanlar', keywords: ['mutfak', 'kitchen'] },
  { label: 'Yatak Odası', description: 'yatak odası, çocuk odası, otel odası; yatak görünüyorsa', keywords: ['yatak', 'bedroom', 'çocuk odası', 'otel odası', 'suit'] },
  { label: 'Tuvalet & Banyo', description: 'banyo, tuvalet, WC, lavabo, duş, küvet, hamam', keywords: ['banyo', 'tuvalet', 'wc', 'lavabo', 'duş', 'küvet', 'hamam', 'bathroom', 'toilet', 'ıslak hacim'] },
  { label: 'Çalışma Odası', description: 'çalışma odası, ev ofisi, ofis çalışma alanı, masa+sandalye, açık ofis, toplantı odası', keywords: ['çalışma odası', 'ofis', 'office', 'toplantı', 'workspace', 'çalışma alanı'] },
  { label: 'Koridor', description: 'koridor, hol, antre, giriş holü, geçiş alanı', keywords: ['koridor', 'hol', 'antre', 'corridor', 'hallway'] },
  { label: 'Merdiven', description: 'merdiven, merdiven kovası, sahanlık; merdiven fotoğrafın ana konusuysa', keywords: ['merdiven', 'stair'] },
  { label: 'Balkon', description: 'balkon, teras, veranda, çatı terası', keywords: ['balkon', 'teras', 'veranda', 'balcony', 'terrace'] },
  { label: 'Bahçe', description: 'bahçe, avlu, peyzaj, dış mekan oturma alanı, çim/bitki alanları', keywords: ['bahçe', 'avlu', 'peyzaj', 'garden', 'courtyard', 'landscape'] },
  { label: 'Havuz', description: 'yüzme havuzu, süs havuzu, havuz kenarı', keywords: ['havuz', 'pool'] },
  { label: 'Resepsiyon', description: 'resepsiyon bankosu, lobi, otel/ofis/klinik giriş-karşılama alanı', keywords: ['resepsiyon', 'lobi', 'reception', 'lobby', 'karşılama'] },
  { label: 'Depo', description: 'depo, kiler, ardiye, garaj, teknik hacim, arşiv', keywords: ['depo', 'kiler', 'garaj', 'ardiye', 'storage', 'warehouse'] },
  // ÇİZİMLER (kind:'drawing') — 2026-09-18 üçüncü tur, kullanıcı isteği: "Arama butonundan çizim
  // seçeneklerini kaldır. Ayrıca arama sonuçlarında çizimler de çıkmasın." Etiketler LİSTEDE KALIR
  // ki AI bir çizimi çizim olarak tanıyıp ETİKETLESİN — sayfa bu etiketi taşıyan görseli hiç
  // göstermez (bkz. src/lib/photoPool.js). Aramada seçenek olarak SUNULMAZ (PHOTO_SPACE_OPTIONS).
  { label: 'Plan Çizimi', kind: 'drawing', description: 'mimari PLAN çizimi (kat planı, vaziyet planı) — fotoğraf DEĞİL, teknik çizim', keywords: ['plan çizimi', 'kat planı', 'vaziyet planı', 'floor plan'] },
  { label: 'Kesit Çizimi', kind: 'drawing', description: 'mimari KESİT çizimi — fotoğraf DEĞİL, teknik çizim', keywords: ['kesit', 'section drawing'] },
  { label: 'Cephe Çizimi', kind: 'drawing', description: 'mimari CEPHE/görünüş çizimi, render ya da 3B görselleştirme — fotoğraf DEĞİL', keywords: ['cephe çizimi', 'görünüş', 'elevation drawing', 'render'] },
];
// TÜM etiketler (AI whitelist'i) vs ARANABİLİR etiketler (dropdown + filtre) — çizimler ilkinde var,
// ikincisinde yok.
const PHOTO_SPACE_LABELS = PHOTO_SPACE_TAXONOMY.map(t => t.label);
const PHOTO_SPACE_DRAWING_LABELS = PHOTO_SPACE_TAXONOMY.filter(t => t.kind === 'drawing').map(t => t.label);
const PHOTO_SPACE_OPTIONS = PHOTO_SPACE_TAXONOMY.filter(t => t.kind !== 'drawing').map(t => t.label);

// Tarayıcıda `module` global'i tanımsız olduğu için bu blok yalnızca Worker'ın esbuild bundle'ında
// (nodejs_compat) çalışır — src/lib/photoSpaceClassify.js ve src/routes/photos.js buradan CJS
// interop ile import eder (bkz. project-taxonomy.js/catalog-taxonomy.js'deki AYNI desen).
if (typeof module !== 'undefined') { module.exports = { PHOTO_SPACE_OPTIONS, PHOTO_SPACE_TAXONOMY, PHOTO_SPACE_LABELS, PHOTO_SPACE_DRAWING_LABELS }; }
