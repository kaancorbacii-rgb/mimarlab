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
// `keywords`: ARAMA KUTUSU eş anlamlıları — kullanıcı "wc"/"salon" yazınca AI'a gitmeden etikete
// eşlenir (fotograf.html#matchingOptions). Küçük harf; alt dize eşleşir.
// `kunye` (2026-09-18 beşinci tur): PROJE KÜNYESİ ön bilgisi için anahtar kelimeler (başlık +
// açıklama + tip/grup içinde KELİME BAŞINDA aranır, bkz. src/lib/photoPool.js#kunyeSpacesFor).
// `keywords`ten AYRI bir listedir çünkü künye metni serbesttir: "hol" -> "Holding", "salon" ->
// "Salon Alper Derinboğaz" (bir firma adı) gibi sahte eşleşmeler orada gerçek bir risktir; arama
// kutusunda değildir. Künye TEK BAŞINA ASLA sonuç üretmez (ölçüldü: %25-50 isabet) — yalnızca
// GÖRSEL kanıtıyla birlikte ve yalnızca ölçümün desteklediği sınıflarda kullanılır (bkz.
// src/lib/photoSpaceClip.js#CLIP_KUNYE_MIN).
const PHOTO_SPACE_TAXONOMY = [
  { label: 'Oturma Odası', description: 'salon, oturma alanı, misafir odası; kanepe/koltuk grubu, TV ünitesi, şömine', keywords: ['oturma', 'salon', 'living', 'lounge'], kunye: ['oturma odası', 'oturma alanı', 'yaşam alanı', 'living room'] },
  { label: 'Mutfak', description: 'mutfak tezgahı, dolaplar, ada, ocak, mutfak-yemek birleşik alanlar', keywords: ['mutfak', 'kitchen'], kunye: ['mutfak', 'mutfağ', 'kitchen'] },
  { label: 'Yatak Odası', description: 'yatak odası, çocuk odası, otel odası; yatak görünüyorsa', keywords: ['yatak', 'bedroom', 'çocuk odası', 'otel odası', 'suit'], kunye: ['yatak odası', 'yatak odaları', 'çocuk odası', 'otel odası', 'konuk odası', 'misafir odası', 'bedroom'] },
  { label: 'Tuvalet & Banyo', description: 'banyo, tuvalet, WC, lavabo, duş, küvet, hamam', keywords: ['banyo', 'tuvalet', 'wc', 'lavabo', 'duş', 'küvet', 'hamam', 'bathroom', 'toilet', 'ıslak hacim'], kunye: ['banyo', 'tuvalet', 'wc', 'lavabo', 'duş', 'küvet', 'ıslak hacim', 'bathroom'] },
  { label: 'Çalışma Odası', description: 'çalışma odası, ev ofisi, ofis çalışma alanı, masa+sandalye, açık ofis, toplantı odası', keywords: ['çalışma odası', 'ofis', 'office', 'toplantı', 'workspace', 'çalışma alanı'], kunye: ['çalışma odası', 'çalışma alanı', 'ofis', 'toplantı oda', 'toplantı salon', 'açık ofis', 'workspace'] },
  { label: 'Koridor', description: 'koridor, hol, antre, giriş holü, geçiş alanı', keywords: ['koridor', 'hol', 'antre', 'corridor', 'hallway'], kunye: ['koridor', 'antre', 'giriş holü', 'sirkülasyon'] },
  { label: 'Merdiven', description: 'merdiven, merdiven kovası, sahanlık; merdiven fotoğrafın ana konusuysa', keywords: ['merdiven', 'stair'], kunye: ['merdiven', 'stair'] },
  { label: 'Balkon', description: 'balkon, teras, veranda, çatı terası', keywords: ['balkon', 'teras', 'veranda', 'balcony', 'terrace'], kunye: ['balkon', 'teras', 'veranda'] },
  { label: 'Bahçe', description: 'bahçe, avlu, peyzaj, dış mekan oturma alanı, çim/bitki alanları', keywords: ['bahçe', 'avlu', 'peyzaj', 'garden', 'courtyard', 'landscape'], kunye: ['bahçe', 'avlu', 'peyzaj', 'garden', 'courtyard'] },
  { label: 'Havuz', description: 'yüzme havuzu, süs havuzu, havuz kenarı', keywords: ['havuz', 'pool'], kunye: ['havuz', 'pool'] },
  { label: 'Resepsiyon', description: 'resepsiyon bankosu, lobi, otel/ofis/klinik giriş-karşılama alanı', keywords: ['resepsiyon', 'lobi', 'reception', 'lobby', 'karşılama'], kunye: ['resepsiyon', 'lobi', 'karşılama', 'danışma', 'reception', 'lobby'] },
  { label: 'Depo', description: 'depo, kiler, ardiye, garaj, teknik hacim, arşiv', keywords: ['depo', 'kiler', 'garaj', 'ardiye', 'storage', 'warehouse'], kunye: ['depo', 'kiler', 'garaj', 'otopark', 'ardiye'] },
  // ÇİZİMLER (kind:'drawing') — 2026-09-18 üçüncü tur, kullanıcı isteği: "Arama butonundan çizim
  // seçeneklerini kaldır. Ayrıca arama sonuçlarında çizimler de çıkmasın." Etiketler LİSTEDE KALIR
  // ki AI bir çizimi çizim olarak tanıyıp ETİKETLESİN — sayfa bu etiketi taşıyan görseli hiç
  // göstermez (bkz. src/lib/photoPool.js). Aramada seçenek olarak SUNULMAZ (PHOTO_SPACE_OPTIONS).
  { label: 'Plan Çizimi', kind: 'drawing', description: 'mimari PLAN çizimi (kat planı, vaziyet planı) — fotoğraf DEĞİL, teknik çizim', keywords: ['plan çizimi', 'kat planı', 'vaziyet planı', 'floor plan'] },
  { label: 'Kesit Çizimi', kind: 'drawing', description: 'mimari KESİT çizimi — fotoğraf DEĞİL, teknik çizim', keywords: ['kesit', 'section drawing'] },
  { label: 'Cephe Çizimi', kind: 'drawing', description: 'mimari CEPHE/görünüş çizimi, diyagram, eskiz, aksonometri — fotoğraf DEĞİL', keywords: ['cephe çizimi', 'görünüş', 'elevation drawing', 'render'] },
];
// TÜM etiketler (kullanıcının 15'lik listesi) vs ARANABİLİR etiketler (dropdown + filtre) — çizimler
// ilkinde var, ikincisinde yok.
const PHOTO_SPACE_LABELS = PHOTO_SPACE_TAXONOMY.map(t => t.label);
const PHOTO_SPACE_DRAWING_LABELS = PHOTO_SPACE_TAXONOMY.filter(t => t.kind === 'drawing').map(t => t.label);
const PHOTO_SPACE_OPTIONS = PHOTO_SPACE_TAXONOMY.filter(t => t.kind !== 'drawing').map(t => t.label);

// ÇELDİRİCİ ETİKETLER (2026-09-18 beşinci tur) — YALNIZCA AI içindir; kullanıcıya hiçbir yerde
// gösterilmez, aranamaz, çip olarak çizilmez.
//
// KÖK NEDEN (canlı veride ÖLÇÜLDÜ): model KAPALI bir listeye zorlandığında "hiçbiri" demek yerine en
// yakın etikete UYDURUYOR. İlk turun 20'lik listesinde "Dış Cephe" varken Ankara Cumhuriyet
// Müzesi'nin cephe fotoğrafları doğru biçimde "Dış Cephe" etiketleniyordu; liste kullanıcının
// 15'lik listesine indirilince AYNI kareler "Resepsiyon + Çalışma Odası + Bahçe" oldu (etiketlenen
// ilk 282 görselin neredeyse TAMAMI 2-3 etiket aldı, boş dizi hiç dönmedi). Modele "bu bir dış
// cephe / restoran / sergi salonu" diyebileceği bir yer vermek, 12 aranabilir etiketin isabetini
// korumanın tek yoludur. Bu etiketler image_spaces'e de YAZILIR (ileride kullanıcı listeyi
// genişletirse yeniden etiketleme gerekmesin ve "AI baktı, aranabilir bir mekan değil" bilgisi
// kaybolmasın) ama PHOTO_SPACE_LABELS'e GİRMEZ — kullanıcının listesi 15 maddedir.
const PHOTO_SPACE_DISTRACTORS = [
  { label: 'Dış Cephe', description: 'bir binanın DIŞARIDAN görünümü: cephe, sokaktan bina, gece görünümü, hava/drone fotoğrafı, kent silüeti, anıt, köprü, harabe' },
  { label: 'Yemek Alanı', description: 'yemek odası / yemek masası (mutfak tezgahı görünmüyorsa)' },
  { label: 'Restoran / Kafe', description: 'restoran, kafe, bar, yemekhane' },
  { label: 'Mağaza / Showroom', description: 'mağaza, showroom, AVM, kuaför, satış alanı' },
  { label: 'Sergi / Müze', description: 'sergi salonu, müze, galeri' },
  { label: 'İbadet Mekanı', description: 'cami, kilise, türbe iç mekanı; kubbe, mihrap' },
  { label: 'Eğitim Mekanı', description: 'derslik, laboratuvar, kreş, atölye' },
  { label: 'Salon / Oditoryum', description: 'konferans salonu, oditoryum, tiyatro, sinema, amfi' },
  { label: 'Kütüphane', description: 'kütüphane, okuma salonu, kitap rafları ana konuysa' },
  { label: 'Spor / Spa', description: 'spor salonu, fitness, stadyum, spa, masaj odası' },
  { label: 'Sağlık', description: 'hastane odası, muayenehane, klinik birimi' },
  { label: 'Endüstri / Ulaşım', description: 'üretim holü, şantiye, terminal, istasyon' },
  { label: 'Giyinme Odası', description: 'giyinme odası, gardırop, soyunma odası, dolap sistemi' },
  { label: 'Genel İç Mekan', description: 'atrium, fuaye, büyük hol, boş hacim; belirli bir işlevi seçilemeyen iç mekan' },
  { label: 'Detay', description: 'malzeme/doku, mobilya, aydınlatma, kapı-pencere yakın çekimi; maket; insan portresi; logo, yazı, pafta' },
];
const PHOTO_SPACE_DISTRACTOR_LABELS = PHOTO_SPACE_DISTRACTORS.map(t => t.label);
// AI'ın döndürebileceği HER ŞEY (whitelist): kullanıcının 15'i + çeldiriciler.
const PHOTO_SPACE_AI_LABELS = PHOTO_SPACE_LABELS.concat(PHOTO_SPACE_DISTRACTOR_LABELS);

// Tarayıcıda `module` global'i tanımsız olduğu için bu blok yalnızca Worker'ın esbuild bundle'ında
// (nodejs_compat) çalışır — src/lib/photoSpaceClassify.js ve src/routes/photos.js buradan CJS
// interop ile import eder (bkz. project-taxonomy.js/catalog-taxonomy.js'deki AYNI desen).
if (typeof module !== 'undefined') {
  module.exports = {
    PHOTO_SPACE_OPTIONS, PHOTO_SPACE_TAXONOMY, PHOTO_SPACE_LABELS, PHOTO_SPACE_DRAWING_LABELS,
    PHOTO_SPACE_DISTRACTORS, PHOTO_SPACE_DISTRACTOR_LABELS, PHOTO_SPACE_AI_LABELS,
  };
}
