// MİMARLAB — proje künyesindeki Tip (category) ve Grup (type) alanları için TEK kaynak taksonomi
// (bkz. kullanıcı isteği: Tip'te "Konut" "Konaklama" olarak değişti; Grup artık serbest metin/
// autocomplete değil, sabit 40 seçenekten biri/birkaçı). proje-ekle.html (checkbox render) VE
// src/lib/submissionTypes.js (backend whitelist doğrulaması) AYNI bu dosyayı kullanır — taraflardan
// biri diğerinden bağımsız yeni bir değer icat edemez (bkz. catalog-taxonomy.js'deki AYNI desen:
// tek dosya, hem tarayıcıda düz <script> hem Worker'da nodejs_compat CJS interop ile import edilir).
const PROJECT_CATEGORY_OPTIONS = ['Konaklama', 'Ticari', 'Kültürel', 'Dini', 'Eğitim', 'Kamu', 'Altyapı'];

// Grup — 40 sabit seçenek (bkz. kullanıcı isteği, sıra talep edildiği gibi korunmuştur).
const PROJECT_GROUP_OPTIONS = [
  'Konut', 'Toplu Konut', 'Ofis / İş Merkezi', 'AVM', 'Mağaza / Ticaret', 'Kafe / Restoran', 'Banka',
  'Kamu / İdari Yapı', 'Eğitim', 'Yükseköğretim', 'Ar-Ge / Araştırma', 'Sağlık', 'Ulaşım', 'Spor',
  'Kültür Merkezi', 'Müze', 'Sergi Alanı', 'Performans / Etkinlik', 'Kütüphane', 'Dini Yapı',
  'Yurt / Konukevi', 'Sanayi / Üretim', 'Depo / Lojistik', 'Karma Kullanım', 'Kentsel Tasarım',
  'Meydan / Pazar / Çarşı', 'Anıt / Simge Yapı', 'Mezar / Türbe', 'Han / Kervansaray', 'Kale / Sur',
  'Arkeolojik Alan', 'Su Yapısı', 'Kule', 'Terminal / İstasyon', 'Askeri Yapı', 'Turizm / Otel',
  'Rekreasyon / Park', 'Tarım / Kırsal Yapı', 'Altyapı / Teknik Yapı', 'Diğer',
];

// Tarayıcıda `module` global'i tanımsız olduğu için bu blok yalnızca Worker'ın esbuild bundle'ında
// (nodejs_compat) çalışır — src/lib/submissionTypes.js buradan CJS interop ile import eder (bkz.
// catalog-taxonomy.js'deki AYNI desen).
if (typeof module !== 'undefined') { module.exports = { PROJECT_CATEGORY_OPTIONS, PROJECT_GROUP_OPTIONS }; }
