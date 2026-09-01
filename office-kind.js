// MİMARLAB — bir `offices` satırının FİRMA mı MARKA mı (ya da ikisi birden) olduğunu belirleyen TEK
// kaynak (kullanıcı isteği, 2026-08-31: "Firma sayfasındaki Ürün seçeneği altındaki firmalar artık
// marka olacak ... Autoban ve +MURAT TABANLIOĞLU aslında firmalar ama ürün tasarımları da var. Bu
// gibi firmalar marka sayfasında da görünebilir sorun yok").
//
// project-taxonomy.js/catalog-taxonomy.js ile AYNI desen: tek dosya, hem tarayıcıda düz <script>
// olarak (firma-ekle.html/marka-ekle.html'in Hizmet Alanı kutucukları) hem Worker'da nodejs_compat
// CJS interop ile (src/routes/office.js, src/lib/submissionTypes.js) okunur — böylece "hangi hizmet
// alanı firmaya, hangisi markaya ait" sorusunun istemci ve sunucu tarafında İKİ AYRI cevabı olamaz.
//
// MODEL: bir ofis satırı iki listede birden yer alabilir. İki ayrı soru vardır:
//   isBrandOffice()     → MARKA sayfasında (marka.html) listelenir mi?
//   isPureBrandOffice() → yalnızca marka mı, yani FİRMA sayfasından (firma.html) çıkarılmalı mı?
// Autoban (cats: "Mimarlık · İç Mimarlık", 7 ürün) → isBrand true, isPureBrand false → İKİSİNDE de.
// VitrA   (cats: "Ürün")                            → isBrand true, isPureBrand true  → yalnızca MARKA.

// firma-ekle.html'deki Hizmet Alanı seçenekleri. 'Ürün'/'Yapı Malzemesi' BİLEREK kaldırıldı (bkz.
// kullanıcı isteği: "Firma sayfasındaki filtrelerdeki ürün seçeneğini kaldır") — bu ikisi artık
// marka tarafının işi, yeni bir firma gönderisi kendini 'Ürün' olarak etiketleyemez.
// 'Fotoğrafçılık' (kullanıcı isteği, 2026-09-01 madde 1: "Firma ekle/düzenle sayfasında hizmet
// alanına fotoğrafçılık da ekle") — mimari fotoğraf stüdyoları (ZM Yasa gibi) artık kişi değil,
// kendi hizmet alanı olan birer FİRMA olarak kaydedilebilir. Bir mimarlık HİZMETİ olduğundan bu
// listeye girer: yalnızca fotoğrafçılık yapan bir stüdyo firma.html'de listelenir ve
// isPureBrandOffice onu marka sanıp firma listesinden düşürmez.
const OFFICE_SERVICE_CATS = [
  'Mimarlık', 'İç Mimarlık', 'Peyzaj Mimarlığı', 'Kentsel Tasarım', 'Restorasyon', 'Uygulama / İnşaat',
  'Fotoğrafçılık',
];

// marka-ekle.html'deki Hizmet Alanı seçenekleri — catalog-taxonomy.js#CATALOG_MENU_COLUMNS'un 7 ürün
// GRUBU (markanın ne ürettiği, ürün kataloğunun kendi taksonomisiyle aynı dil) + 'Yapı Malzemesi'.
const BRAND_CATS = [
  'Mobilya', 'Aydınlatma', 'Dekorasyon & Tamamlayıcılar', 'Mutfak & Banyo',
  'Zemin & Yüzey Kaplama', 'Cephe & Açıklıklar', 'Dış Mekan & Peyzaj', 'Yapı Malzemesi',
];

// Mevcut 20 marka kaydının cats değeri (canlıda doğrulandı: 13 satır '"Ürün"', 7 satır '["Ürün"]').
// Bu kayıtlar marka-ekle.html'den yeniden kaydedilene kadar bu tek değeri taşımaya devam edecek —
// bu yüzden 'Ürün' kalıcı olarak geçerli bir marka işareti sayılır, BRAND_CATS'e taşınmaz (yeni
// gönderilerde seçilebilir bir seçenek DEĞİL, yalnızca geriye dönük tanınan bir değer).
const LEGACY_BRAND_CAT = 'Ürün';

const OFFICE_SERVICE_CAT_SET = new Set(OFFICE_SERVICE_CATS);
const BRAND_CAT_SET = new Set([...BRAND_CATS, LEGACY_BRAND_CAT]);

// offices.cats üç biçimde saklanmış olabilir: düz " · " ayrımlı string ("Mimarlık · İç Mimarlık"),
// JSON dizi (["Ürün"]) ya da NULL (canlıda 57 satır). parseCanonicalRow JSON'u diziye çevirir ama
// string biçimine dokunmaz — bu yüzden üç durumu da TEK noktada normalize eden bir yardımcı gerekir
// (bkz. src/routes/office.js#handleOfficeListRoute'taki AYNI Array.isArray/typeof kontrolü).
function officeCatList(cats) {
  if (Array.isArray(cats)) return cats.map(c => String(c).trim()).filter(Boolean);
  if (typeof cats !== 'string') return [];
  return cats.split(' · ').map(c => c.trim()).filter(Boolean);
}

// MARKA sayfasında listelenir mi? Üç yoldan biri yeterli: (a) cats'inde bir marka kategorisi var,
// (b) eski 'Ürün' işaretini taşıyor, (c) katalogda en az bir ürünü/malzemesi var (Autoban gibi
// kendini hiç 'Ürün' olarak etiketlememiş ama ürün tasarlayan firmalar bu yoldan girer).
function isBrandOffice(cats, productCount) {
  if (productCount > 0) return true;
  return officeCatList(cats).some(c => BRAND_CAT_SET.has(c));
}

// FİRMA sayfasından çıkarılmalı mı? Yalnızca hiçbir mimarlık hizmeti sunmayan saf markalar çıkar —
// bir ofis tek bir mimarlık hizmeti bile veriyorsa (Autoban: Mimarlık) firma listesinde KALIR.
function isPureBrandOffice(cats, productCount) {
  if (!isBrandOffice(cats, productCount)) return false;
  return !officeCatList(cats).some(c => OFFICE_SERVICE_CAT_SET.has(c));
}

// Tarayıcıda `module` global'i tanımsız olduğu için bu blok yalnızca Worker'ın esbuild bundle'ında
// (nodejs_compat) çalışır — bkz. project-taxonomy.js/catalog-taxonomy.js'deki AYNI desen.
if (typeof module !== 'undefined') {
  module.exports = {
    OFFICE_SERVICE_CATS, BRAND_CATS, LEGACY_BRAND_CAT,
    officeCatList, isBrandOffice, isPureBrandOffice,
  };
}
